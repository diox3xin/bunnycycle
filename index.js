/**
 * BunnyCycle v3.0 — Главная точка входа
 * Полная система: цикл, беременность, роды, здоровье, AU, дети, время
 */

import { renderExtensionTemplateAsync, getContext, extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '/script.js';

import { initSettings, getSettings, saveSettings, ensureProfileFields } from './core/stateManager.js';
import { syncCharacters, ProfileManager } from './core/profileManager.js';
import { CycleEngine } from './core/cycleEngine.js';
import { PregnancyEngine } from './core/pregnancyEngine.js';
import { LaborEngine } from './core/laborEngine.js';
import { HealthSystem, DISEASE_DATABASE } from './core/healthSystem.js';
import { BabyManager } from './core/babyManager.js';
import { HeatRutEngine, BondEngine, OviEngine } from './core/auEngine.js';
import { SexDetector, ConceptionDice, IntimacyLog } from './core/intimacyDetector.js';
import { TimeManager } from './core/timeManager.js';
import { generatePrompt, parseResponseTags, stripTags } from './core/promptBuilder.js';
import { RelationshipManager } from './core/relationshipManager.js';

import { rebuild, renderDashboard, renderCharList, renderCycle, renderPregnancy, renderHealth, populateCharSelects } from './ui/drawerUI.js';
import { injectWidgets, attachWidgetListeners } from './ui/widgetRenderer.js';
import { showAddCharPopup, showAddDiseasePopup, showAddInjuryPopup, showAddMedPopup, showAddRelPopup, showDiceResult, showStartPregPopup, showConfirm } from './ui/popupManager.js';

const EXT = 'bunnycycle';
const LOG = (...args) => console.log('[BunnyCycle]', ...args);

// ========================
// ИНИЦИАЛИЗАЦИЯ
// ========================
jQuery(async () => {
    LOG('v3.0 — Загрузка...');

    // 1. Инициализация настроек
    initSettings();

    // 2. Загрузка HTML шаблона
    const drawerHtml = await $.get(`/scripts/extensions/third_party/${EXT}/assets/templates/drawer.html`);
    $('#extensions_settings2').append(drawerHtml);

    // 3. Загрузка CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/scripts/extensions/third_party/${EXT}/assets/styles/main.css`;
    document.head.appendChild(link);

    // 4. Инициализация UI
    initTabs();
    initDrawerEvents();
    attachWidgetListeners();

    // 5. Первичная синхронизация
    const s = getSettings();
    if (s.autoSyncCharacters) {
        await syncCharacters();
    }

    // 6. Загрузка профиля текущего чата
    ProfileManager.load();

    // 7. Первый рендер
    rebuild();
    loadSettingsToUI();

    // 8. События SillyTavern
    registerEvents();

    LOG('✓ Загружен');
});

// ========================
// ВКЛАДКИ
// ========================
function initTabs() {
    $(document).on('click', '.bc-tab', function () {
        const tab = $(this).data('tab');
        $('.bc-tab').removeClass('active');
        $(this).addClass('active');
        $('.bc-tab-content').removeClass('active');
        $(`.bc-tab-content[data-tab="${tab}"]`).addClass('active');

        // Рендерим при открытии вкладки
        if (tab === 'dashboard') renderDashboard();
        if (tab === 'chars') renderCharList();
        if (tab === 'cycle') renderCycle();
        if (tab === 'preg') renderPregnancy();
        if (tab === 'health') renderHealth();
    });
}

// ========================
// СОБЫТИЯ DRAWER
// ========================
function initDrawerEvents() {
    const $d = $(document);

    // === ENABLED ===
    $d.on('change', '#bc-enabled', function () {
        getSettings().enabled = this.checked;
        saveSettings();
    });

    // === SYNC ===
    $d.on('click', '#bc-sync', async () => {
        await syncCharacters();
        rebuild();
    });

    // === TIME ===
    $d.on('click', '#bc-time-1d', () => { TimeManager.apply({ days: 1 }); rebuild(); });
    $d.on('click', '#bc-time-7d', () => { TimeManager.apply({ days: 7 }); rebuild(); });
    $d.on('click', '#bc-time-30d', () => { TimeManager.apply({ days: 30 }); rebuild(); });
    $d.on('click', '#bc-freeze-toggle', () => { TimeManager.toggleFreeze(); renderDashboard(); });

    // === CHARACTERS ===
    $d.on('click', '#bc-add-char', () => showAddCharPopup(rebuild));
    $d.on('click', '.bc-del-char', function () {
        const name = $(this).data('char');
        showConfirm(`Удалить персонажа «${name}»?`, () => {
            delete getSettings().characters[name];
            saveSettings();
            rebuild();
        });
    });

    // === CYCLE ===
    $d.on('change', '#bc-cycle-char', renderCycle);
    $d.on('click', '.bc-cyc-set-phase', function () {
        const phase = $(this).data('phase');
        const s = getSettings();
        const p = s.characters[$('#bc-cycle-char').val()];
        if (p?.cycle) { new CycleEngine(p).setPhase(phase); saveSettings(); renderCycle(); }
    });

    // === PREGNANCY ===
    $d.on('change', '#bc-preg-char', renderPregnancy);
    $d.on('click', '#bc-start-preg', () => {
        const charName = $('#bc-preg-char').val();
        showStartPregPopup(charName, (data) => {
            const s = getSettings();
            const p = s.characters[charName];
            if (p) {
                new PregnancyEngine(p).start(data.father, data.count, null, data.week);
                saveSettings();
                renderPregnancy();
            }
        });
    });
    $d.on('click', '#bc-preg-advance', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-preg-char').val()];
        if (p?.pregnancy?.active) { new PregnancyEngine(p).advanceDay(7); saveSettings(); renderPregnancy(); }
    });
    $d.on('click', '#bc-preg-complication', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-preg-char').val()];
        if (p?.pregnancy?.active) {
            const comp = new PregnancyEngine(p).addRandomComplication();
            if (comp) { saveSettings(); renderPregnancy(); }
        }
    });
    $d.on('click', '#bc-end-preg', () => {
        showConfirm('Прервать беременность?', () => {
            const s = getSettings();
            const p = s.characters[$('#bc-preg-char').val()];
            if (p) { new PregnancyEngine(p).end(); saveSettings(); renderPregnancy(); }
        });
    });

    // === LABOR ===
    $d.on('click', '#bc-start-labor', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-preg-char').val()];
        if (p) { new LaborEngine(p).start(); saveSettings(); renderPregnancy(); }
    });
    $d.on('click', '#bc-labor-advance', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-preg-char').val()];
        if (p?.labor?.active) { new LaborEngine(p).advance(); saveSettings(); renderPregnancy(); }
    });
    $d.on('click', '#bc-labor-complication', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-preg-char').val()];
        if (p?.labor?.active) { new LaborEngine(p).addRandomComplication(); saveSettings(); renderPregnancy(); }
    });
    $d.on('click', '#bc-labor-deliver', () => {
        const s = getSettings();
        const charName = $('#bc-preg-char').val();
        const p = s.characters[charName];
        if (p?.labor?.active) {
            const le = new LaborEngine(p);
            le.deliver();
            // Создаём ребёнка
            const baby = BabyManager.generate(p, p.pregnancy?.father);
            if (!p.babies) p.babies = [];
            p.babies.push(baby);
            saveSettings();
            renderPregnancy();
        }
    });
    $d.on('click', '#bc-labor-end', () => {
        showConfirm('Завершить роды?', () => {
            const s = getSettings();
            const p = s.characters[$('#bc-preg-char').val()];
            if (p) { new LaborEngine(p).end(); saveSettings(); renderPregnancy(); }
        });
    });

    // === HEALTH ===
    $d.on('change', '#bc-health-char', renderHealth);
    $d.on('click', '#bc-health-add-cond', () => {
        const charName = $('#bc-health-char').val();
        showAddDiseasePopup(charName, renderHealth);
    });
    $d.on('click', '#bc-health-add-injury', () => {
        const charName = $('#bc-health-char').val();
        showAddInjuryPopup(charName, renderHealth);
    });
    $d.on('click', '#bc-health-add-med', () => {
        const charName = $('#bc-health-char').val();
        showAddMedPopup(charName, renderHealth);
    });
    $d.on('click', '#bc-health-random-disease', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-health-char').val()];
        if (p) { new HealthSystem(p).generateContextualDisease(''); saveSettings(); renderHealth(); }
    });
    $d.on('click', '#bc-health-random-injury', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-health-char').val()];
        if (p) { new HealthSystem(p).generateRandomInjury(); saveSettings(); renderHealth(); }
    });
    $d.on('click', '.bc-rm-cond', function () {
        const id = $(this).data('id');
        const s = getSettings();
        const p = s.characters[$('#bc-health-char').val()];
        if (p) { new HealthSystem(p).removeCondition(id); saveSettings(); renderHealth(); }
    });
    $d.on('click', '.bc-rm-injury', function () {
        const id = $(this).data('id');
        const s = getSettings();
        const p = s.characters[$('#bc-health-char').val()];
        if (p) { new HealthSystem(p).removeInjury(id); saveSettings(); renderHealth(); }
    });
    $d.on('click', '.bc-rm-med', function () {
        const id = $(this).data('id');
        const s = getSettings();
        const p = s.characters[$('#bc-health-char').val()];
        if (p) { new HealthSystem(p).removeMedication(id); saveSettings(); renderHealth(); }
    });

    // === INTIMACY DICE ===
    $d.on('click', '#bc-intim-roll', () => {
        const s = getSettings();
        const target = $('#bc-intim-target').val();
        const partner = $('#bc-intim-partner').val();
        const type = $('#bc-intim-type').val();
        const ejac = $('#bc-intim-ejac').val();
        if (!target) return;
        const result = ConceptionDice.roll(target, {
            type, ejac,
            condom: false, noCondom: false,
            auto: false, parts: [target, partner].filter(Boolean)
        }, s.characters);

        IntimacyLog.add({ parts: [target, partner].filter(Boolean), type, ejac, auto: false });

        showDiceResult(result);

        // Если зачатие — автостарт беременности
        if (result.result) {
            const p = s.characters[target];
            if (p && !p.pregnancy?.active) {
                new PregnancyEngine(p).start(partner || '?');
            }
        }
        saveSettings();
        rebuild();
    });

    // === FAMILY ===
    $d.on('click', '#bc-rel-add', () => showAddRelPopup(rebuild));

    // === SETTINGS ===
    $d.on('change', '#bc-mod-cycle', function () { getSettings().modules.cycle = this.checked; saveSettings(); });
    $d.on('change', '#bc-mod-preg', function () { getSettings().modules.pregnancy = this.checked; saveSettings(); });
    $d.on('change', '#bc-mod-labor', function () { getSettings().modules.labor = this.checked; saveSettings(); });
    $d.on('change', '#bc-mod-baby', function () { getSettings().modules.baby = this.checked; saveSettings(); });
    $d.on('change', '#bc-mod-intim', function () { getSettings().modules.intimacy = this.checked; saveSettings(); });
    $d.on('change', '#bc-mod-health', function () { getSettings().modules.health = this.checked; saveSettings(); });
    $d.on('change', '#bc-mod-au', function () { getSettings().modules.auOverlay = this.checked; saveSettings(); });

    $d.on('change', '#bc-auto-sync', function () { getSettings().autoSyncCharacters = this.checked; saveSettings(); });
    $d.on('change', '#bc-auto-parse', function () { getSettings().autoParseCharInfo = this.checked; saveSettings(); });
    $d.on('change', '#bc-auto-detect', function () { getSettings().autoDetectIntimacy = this.checked; saveSettings(); });
    $d.on('change', '#bc-auto-roll', function () { getSettings().autoRollOnSex = this.checked; saveSettings(); });
    $d.on('change', '#bc-auto-time', function () { getSettings().autoTimeProgress = this.checked; saveSettings(); });
    $d.on('change', '#bc-use-tags', function () { getSettings().useResponseTags = this.checked; saveSettings(); });
    $d.on('change', '#bc-widget', function () { getSettings().showStatusWidget = this.checked; saveSettings(); });
    $d.on('change', '#bc-widget-always', function () { getSettings().showWidgetAlways = this.checked; saveSettings(); });
    $d.on('change', '#bc-prompt-on', function () { getSettings().promptInjectionEnabled = this.checked; saveSettings(); });
    $d.on('change', '#bc-prompt-pos', function () { getSettings().promptInjectionPosition = this.value; saveSettings(); });
    $d.on('change', '#bc-prompt-rp', function () { getSettings().promptRPMode = this.checked; saveSettings(); });
    $d.on('change', '#bc-detect-sens', function () { getSettings().sexDetectMinScore = parseInt(this.value) || 2; saveSettings(); });

    // Health settings
    $d.on('change', '#bc-health-auto', function () { getSettings().healthSettings.autoGenerateEvents = this.checked; saveSettings(); });
    $d.on('input', '#bc-health-comp-chance', function () {
        const val = parseInt(this.value);
        getSettings().healthSettings.complicationChance = val / 100;
        $('#bc-health-comp-val').text(val + '%');
        saveSettings();
    });
    $d.on('input', '#bc-health-disease-chance', function () {
        const val = parseInt(this.value);
        getSettings().healthSettings.diseaseChance = val / 100;
        $('#bc-health-disease-val').text(val + '%');
        saveSettings();
    });
    $d.on('change', '#bc-health-heal-rate', function () { getSettings().healthSettings.healingRate = this.value; saveSettings(); });
    $d.on('change', '#bc-health-trauma', function () { getSettings().healthSettings.enableTrauma = this.checked; saveSettings(); });
    $d.on('change', '#bc-health-mental', function () { getSettings().healthSettings.enableMentalHealth = this.checked; saveSettings(); });
    $d.on('change', '#bc-health-immunity', function () { getSettings().healthSettings.enableImmunity = this.checked; saveSettings(); });

    // AU
    $d.on('change', '#bc-au-preset', function () { getSettings().auPreset = this.value; saveSettings(); });
    $d.on('input', '#bc-cau-dis', function () { getSettings().customAu.diseases = this.value; saveSettings(); });
    $d.on('input', '#bc-cau-pre', function () { getSettings().customAu.pregnancyRules = this.value; saveSettings(); });
    $d.on('input', '#bc-cau-tre', function () { getSettings().customAu.treatment = this.value; saveSettings(); });
    $d.on('input', '#bc-cau-wor', function () { getSettings().customAu.worldRules = this.value; saveSettings(); });

    // Date
    $d.on('click', '#bc-date-apply', () => {
        const y = parseInt($('#bc-date-y').val());
        const m = parseInt($('#bc-date-m').val());
        const d = parseInt($('#bc-date-d').val());
        const h = parseInt($('#bc-date-h').val());
        TimeManager.setDate(y || undefined, m || undefined, d || undefined, h);
        renderDashboard();
    });
    $d.on('change', '#bc-date-freeze', function () {
        getSettings().worldDate.frozen = this.checked;
        saveSettings();
        renderDashboard();
    });

    // Data
    $d.on('click', '#bc-export', () => {
        const data = JSON.stringify(getSettings(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'bunnycycle_export.json'; a.click();
        URL.revokeObjectURL(url);
    });
    $d.on('click', '#bc-import', () => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const text = await file.text();
            try {
                const data = JSON.parse(text);
                Object.assign(extension_settings[EXT], data);
                saveSettings();
                rebuild();
                loadSettingsToUI();
            } catch (err) { console.error('[BunnyCycle] Import error:', err); }
        };
        input.click();
    });
    $d.on('click', '#bc-reset', () => {
        showConfirm('Сбросить ВСЕ настройки BunnyCycle? Это необратимо!', () => {
            import('./core/stateManager.js').then(m => m.resetSettings());
            rebuild();
            loadSettingsToUI();
        });
    });

    // Profiles
    $d.on('click', '#bc-prof-save', () => { ProfileManager.save(); });
    $d.on('click', '#bc-prof-reload', () => { ProfileManager.load(); rebuild(); });

    // Debug
    $d.on('change', '#bc-debug', function () { getSettings().debugTrace = this.checked; saveSettings(); });
}

// ========================
// ЗАГРУЗКА НАСТРОЕК В UI
// ========================
function loadSettingsToUI() {
    const s = getSettings();
    $('#bc-enabled').prop('checked', s.enabled);
    $('#bc-mod-cycle').prop('checked', s.modules.cycle);
    $('#bc-mod-preg').prop('checked', s.modules.pregnancy);
    $('#bc-mod-labor').prop('checked', s.modules.labor);
    $('#bc-mod-baby').prop('checked', s.modules.baby);
    $('#bc-mod-intim').prop('checked', s.modules.intimacy);
    $('#bc-mod-health').prop('checked', s.modules.health);
    $('#bc-mod-au').prop('checked', s.modules.auOverlay);
    $('#bc-auto-sync').prop('checked', s.autoSyncCharacters);
    $('#bc-auto-parse').prop('checked', s.autoParseCharInfo);
    $('#bc-auto-detect').prop('checked', s.autoDetectIntimacy);
    $('#bc-auto-roll').prop('checked', s.autoRollOnSex);
    $('#bc-auto-time').prop('checked', s.autoTimeProgress);
    $('#bc-use-tags').prop('checked', s.useResponseTags);
    $('#bc-widget').prop('checked', s.showStatusWidget);
    $('#bc-widget-always').prop('checked', s.showWidgetAlways);
    $('#bc-prompt-on').prop('checked', s.promptInjectionEnabled);
    $('#bc-prompt-pos').val(s.promptInjectionPosition);
    $('#bc-prompt-rp').prop('checked', s.promptRPMode);
    $('#bc-detect-sens').val(String(s.sexDetectMinScore));
    $('#bc-au-preset').val(s.auPreset);
    $('#bc-cau-dis').val(s.customAu?.diseases || '');
    $('#bc-cau-pre').val(s.customAu?.pregnancyRules || '');
    $('#bc-cau-tre').val(s.customAu?.treatment || '');
    $('#bc-cau-wor').val(s.customAu?.worldRules || '');
    $('#bc-health-auto').prop('checked', s.healthSettings?.autoGenerateEvents);
    $('#bc-health-comp-chance').val(Math.round((s.healthSettings?.complicationChance || 0.15) * 100));
    $('#bc-health-comp-val').text(Math.round((s.healthSettings?.complicationChance || 0.15) * 100) + '%');
    $('#bc-health-disease-chance').val(Math.round((s.healthSettings?.diseaseChance || 0.08) * 100));
    $('#bc-health-disease-val').text(Math.round((s.healthSettings?.diseaseChance || 0.08) * 100) + '%');
    $('#bc-health-heal-rate').val(s.healthSettings?.healingRate || 'normal');
    $('#bc-health-trauma').prop('checked', s.healthSettings?.enableTrauma);
    $('#bc-health-mental').prop('checked', s.healthSettings?.enableMentalHealth);
    $('#bc-health-immunity').prop('checked', s.healthSettings?.enableImmunity);
    $('#bc-date-freeze').prop('checked', s.worldDate?.frozen);
    $('#bc-debug').prop('checked', s.debugTrace);
}

// ========================
// СОБЫТИЯ SILLYTAVERN
// ========================
function registerEvents() {
    // Новое сообщение от бота
    eventSource.on(event_types.MESSAGE_RECEIVED, (msgId) => {
        processNewMessage(msgId);
    });

    // Смена чата
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        const s = getSettings();
        ProfileManager.load();
        if (s.autoSyncCharacters) await syncCharacters();
        rebuild();
    });

    // Инъекция промпта
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (data) => {
        const s = getSettings();
        if (!s.enabled || !s.promptInjectionEnabled) return;

        const prompt = generatePrompt();
        if (!prompt) return;

        if (s.promptInjectionPosition === 'authornote') {
            if (data.extensionPrompts) {
                data.extensionPrompts.push({
                    extension: EXT,
                    prompt: prompt,
                    position: 'IN_PROMPT'
                });
            }
        }
    });

    // После генерации — обработка ответа
    eventSource.on(event_types.MESSAGE_SENT, () => {
        // При отправке сообщения юзером — можем инжектить виджет
        setTimeout(() => injectWidgets(), 500);
    });
}

// ========================
// ОБРАБОТКА НОВОГО СООБЩЕНИЯ
// ========================
function processNewMessage(msgId) {
    const s = getSettings();
    if (!s.enabled) return;

    try {
        const ctx = getContext();
        const chat = ctx?.chat;
        if (!chat?.length) return;

        const msg = chat[chat.length - 1];
        const text = msg?.mes || '';

        // 1. Парсинг тегов <bunnycycle>
        if (s.useResponseTags) {
            const tags = parseResponseTags(text);
            if (tags) {
                applyResponseTags(tags);
            }
        }

        // 2. Парсинг времени
        if (s.autoTimeProgress) {
            const time = TimeManager.parse(text);
            if (time) {
                TimeManager.apply(time);
                if (s.debugTrace) LOG('Время:', time);
            }
        }

        // 3. Детекция секса
        if (s.autoDetectIntimacy && s.modules.intimacy) {
            const detection = SexDetector.detect(text, s.characters);
            if (detection.detected) {
                if (s.debugTrace) LOG('Секс обнаружен:', detection);
                IntimacyLog.add(detection);

                // Авто-бросок кубика
                if (s.autoRollOnSex && detection.target) {
                    const result = ConceptionDice.roll(detection.target, detection, s.characters);
                    if (s.debugTrace) LOG('Авто-бросок:', result);

                    if (result.result) {
                        const p = s.characters[detection.target];
                        if (p && !p.pregnancy?.active) {
                            new PregnancyEngine(p).start(
                                detection.participants.find(n => n !== detection.target) || '?'
                            );
                            LOG('🎯 ЗАЧАТИЕ:', detection.target);
                        }
                    }
                }
            }
        }

        // 4. Сохранение и виджеты
        saveSettings();
        rebuild();
        setTimeout(() => injectWidgets(), 300);

    } catch (err) {
        console.error('[BunnyCycle] processNewMessage error:', err);
    }
}

// ========================
// ПРИМЕНЕНИЕ ТЕГОВ ИЗ ОТВЕТА
// ========================
function applyResponseTags(tags) {
    const s = getSettings();

    // Время
    if (tags.time) {
        TimeManager.apply(tags.time);
    }

    // Здоровье
    for (const h of tags.health) {
        const p = s.characters[h.name];
        if (p) {
            // Пытаемся найти болезнь в базе
            const allDiseases = Object.values(DISEASE_DATABASE).flat();
            const match = allDiseases.find(d => d.label.toLowerCase().includes(h.condition.toLowerCase()));
            if (match) {
                new HealthSystem(p).addCondition(match.id, { severity: h.severity, source: 'rp_detected' });
            } else {
                new HealthSystem(p).addCustomCondition(h.condition, h.severity, '', 'rp_detected');
            }
        }
    }

    // Настроение
    for (const m of tags.mood) {
        const p = s.characters[m.name];
        if (p) {
            p.mood = { current: m.mood, intensity: 'moderate' };
        }
    }

    // Травмы
    if (tags.injury) {
        const p = s.characters[tags.injury.name];
        if (p) {
            new HealthSystem(p).addInjury(
                tags.injury.type, tags.injury.location,
                tags.injury.severity, { source: 'rp_detected' }
            );
        }
    }
}
