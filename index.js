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

import { rebuild, renderDashboard, renderCharList, renderCycle, renderPregnancy, renderHealth, populateCharSelects, renderCharEditor, hideCharEditor, renderAuSettings, renderProfileList, renderRelList, renderBabyList, renderFamilyTree, renderOviposition } from './ui/drawerUI.js';
import { injectWidgets, attachWidgetListeners } from './ui/widgetRenderer.js';
import { showAddCharPopup, showAddDiseasePopup, showAddInjuryPopup, showAddMedPopup, showAddRelPopup, showDiceResult, showStartPregPopup, showConfirm, showCreateBabyPopup, showNotice } from './ui/popupManager.js';
import { LLM } from './utils/llmCaller.js';

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
    const drawerHtml = await $.get(`/scripts/extensions/third-party/${EXT}/assets/templates/drawer.html`);
    $('#extensions_settings2').append(drawerHtml);

    // 3. Загрузка CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/scripts/extensions/third-party/${EXT}/assets/styles/main.css`;
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
        const s = getSettings();
        const beforeCount = Object.keys(s.characters).length;
        await syncCharacters();
        rebuild();
        const afterCount = Object.keys(s.characters).length;
        const newChars = afterCount - beforeCount;
        const charSummary = Object.entries(s.characters).map(([n, p]) => {
            let info = `${n} (${p.bioSex === 'M' ? '♂' : '♀'}`;
            if (p.eyeColor) info += `, глаза: ${p.eyeColor}`;
            if (p.hairColor) info += `, волосы: ${p.hairColor}`;
            if (p.race !== 'human') info += `, ${p.race}`;
            info += ')';
            return info;
        }).join('<br>');
        showNotice(`✅ Синхронизация завершена!<br>${afterCount} перс.${newChars > 0 ? ` (+${newChars} новых)` : ''}<br><br>${charSummary}`, 4000);
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

    // === CHARACTER EDITOR ===
    $d.on('click', '.bc-edit-char', function () {
        const name = $(this).data('char');
        renderCharEditor(name);
    });
    $d.on('click', '.bc-close-editor', () => hideCharEditor());
    $d.on('click', '.bc-save-editor', () => {
        const s = getSettings();
        const name = $('#bc-edit-name').val();
        const p = s.characters[name];
        if (!p) return;
        // Основные поля
        $('.bc-ed').each(function () {
            const field = $(this).data('field');
            const val = this.type === 'number' ? (parseFloat(this.value) || 0) : this.value;
            p[field] = val;
        });
        // Цикл
        if (!p.cycle) p.cycle = {};
        $('.bc-ed-cyc').each(function () {
            const field = $(this).data('field');
            if (this.type === 'checkbox') {
                p.cycle[field] = this.checked;
            } else if (this.type === 'number') {
                p.cycle[field] = parseInt(this.value) || 0;
            } else {
                p.cycle[field] = this.value;
            }
        });
        saveSettings();
        hideCharEditor();
        rebuild();
    });

    // === PREGNANCY COMPLICATIONS REMOVE ===
    $d.on('click', '.bc-rm-preg-comp', function () {
        const idx = parseInt($(this).data('idx'));
        const s = getSettings();
        const p = s.characters[$('#bc-preg-char').val()];
        if (p?.pregnancy?.complications) {
            p.pregnancy.complications.splice(idx, 1);
            saveSettings();
            renderPregnancy();
        }
    });
    $d.on('click', '.bc-rm-all-preg-comp', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-preg-char').val()];
        if (p?.pregnancy) {
            p.pregnancy.complications = [];
            saveSettings();
            renderPregnancy();
        }
    });

    // === LABOR COMPLICATIONS REMOVE ===
    $d.on('click', '.bc-rm-labor-comp', function () {
        const idx = parseInt($(this).data('idx'));
        const s = getSettings();
        const p = s.characters[$('#bc-preg-char').val()];
        if (p?.labor?.complications) {
            p.labor.complications.splice(idx, 1);
            saveSettings();
            renderPregnancy();
        }
    });
    $d.on('click', '.bc-rm-all-labor-comp', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-preg-char').val()];
        if (p?.labor) {
            p.labor.complications = [];
            saveSettings();
            renderPregnancy();
        }
    });

    // === AU SETTINGS (Omegaverse) ===
    $d.on('change input', '.bc-au-ov', function () {
        const s = getSettings();
        if (!s.auSettings) s.auSettings = {};
        if (!s.auSettings.omegaverse) s.auSettings.omegaverse = {};
        const field = $(this).data('field');
        if (this.type === 'checkbox') {
            s.auSettings.omegaverse[field] = this.checked;
        } else if (this.type === 'number') {
            s.auSettings.omegaverse[field] = parseFloat(this.value) || 0;
        } else {
            s.auSettings.omegaverse[field] = this.value;
        }
        saveSettings();
    });

    // === AU SETTINGS (Fantasy) ===
    $d.on('change input', '.bc-au-fan', function () {
        const s = getSettings();
        if (!s.auSettings?.fantasy) return;
        const field = $(this).data('field');
        if (this.type === 'checkbox') {
            s.auSettings.fantasy[field] = this.checked;
        } else if (this.type === 'number') {
            s.auSettings.fantasy[field] = parseFloat(this.value) || 0;
        } else {
            s.auSettings.fantasy[field] = this.value;
        }
        saveSettings();
    });
    $d.on('change input', '.bc-au-fan-race', function () {
        const s = getSettings();
        const race = $(this).data('race');
        if (s.auSettings?.fantasy?.pregnancyByRace) {
            s.auSettings.fantasy.pregnancyByRace[race] = parseInt(this.value) || 40;
            saveSettings();
        }
    });

    // === AU SETTINGS (Oviposition) ===
    $d.on('change input', '.bc-au-ovi', function () {
        const s = getSettings();
        if (!s.auSettings) s.auSettings = {};
        if (!s.auSettings.oviposition) s.auSettings.oviposition = {};
        const field = $(this).data('field');
        if (this.type === 'checkbox') {
            s.auSettings.oviposition[field] = this.checked;
        } else if (this.type === 'number') {
            s.auSettings.oviposition[field] = parseFloat(this.value) || 0;
        } else {
            s.auSettings.oviposition[field] = this.value;
        }
        saveSettings();
    });

    // AU preset change → re-render AU settings
    $d.on('change', '#bc-au-preset', function () {
        getSettings().auPreset = this.value;
        saveSettings();
        renderAuSettings();
        renderOviposition();
    });

    // === OVIPOSITION ===
    $d.on('change', '#bc-ovi-char', renderOviposition);
    $d.on('click', '#bc-ovi-start', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-ovi-char').val()];
        if (p) {
            new OviEngine(p).startCarrying();
            saveSettings();
            renderOviposition();
            showNotice(`🥚 Вынашивание начато! ${p.oviposition.eggCount} яиц (${p.oviposition.fertilizedCount} оплодотворены)`, 3000);
        }
    });
    $d.on('click', '#bc-ovi-advance', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-ovi-char').val()];
        if (p?.oviposition?.active) {
            new OviEngine(p).advance(1);
            saveSettings();
            renderOviposition();
        }
    });
    $d.on('click', '#bc-ovi-advance-5', () => {
        const s = getSettings();
        const p = s.characters[$('#bc-ovi-char').val()];
        if (p?.oviposition?.active) {
            new OviEngine(p).advance(5);
            saveSettings();
            renderOviposition();
        }
    });
    $d.on('click', '#bc-ovi-hatch', () => {
        const s = getSettings();
        const charName = $('#bc-ovi-char').val();
        const p = s.characters[charName];
        if (p?.oviposition?.active && p.oviposition.phase === 'hatching') {
            const count = p.oviposition.fertilizedCount || 1;
            if (!p.babies) p.babies = [];
            for (let i = 0; i < count; i++) {
                const baby = BabyManager.generate(p, '?', {
                    name: `Детёныш ${p.babies.length + 1}`,
                    sex: Math.random() < 0.5 ? 'M' : 'F'
                });
                baby.ageDays = 0;
                baby.birthWeight = 50 + Math.floor(Math.random() * 100); // яичные детёныши легче
                baby.currentWeight = baby.birthWeight;
                baby.notes = '🥚 Из яйца';
                p.babies.push(baby);
            }
            new OviEngine(p).end();
            saveSettings();
            renderOviposition();
            renderBabyList();
            renderFamilyTree();
            showNotice(`🐣 Вылупилось ${count} детёнышей!`, 3000);
        }
    });
    $d.on('click', '#bc-ovi-end', () => {
        showConfirm('Завершить/сбросить кладку?', () => {
            const s = getSettings();
            const p = s.characters[$('#bc-ovi-char').val()];
            if (p) { new OviEngine(p).end(); saveSettings(); renderOviposition(); }
        });
    });

    // === PROFILE LIST ACTIONS ===
    $d.on('click', '.bc-prof-load-one', function () {
        const id = $(this).data('id');
        const s = getSettings();
        if (s.chatProfiles?.[id]) {
            Object.assign(s, { characters: JSON.parse(JSON.stringify(s.chatProfiles[id].characters || {})) });
            saveSettings();
            rebuild();
        }
    });
    $d.on('click', '.bc-prof-del', function () {
        const id = $(this).data('id');
        showConfirm(`Удалить профиль?`, () => {
            const s = getSettings();
            if (s.chatProfiles?.[id]) {
                delete s.chatProfiles[id];
                saveSettings();
                renderProfileList();
            }
        });
    });

    // === FAMILY: RELATIONSHIPS ===
    $d.on('click', '#bc-rel-add', () => showAddRelPopup(() => { renderRelList(); renderFamilyTree(); }));
    $d.on('click', '.bc-rel-del', function () {
        const id = $(this).data('id');
        RelationshipManager.remove(id);
        renderRelList();
        renderFamilyTree();
    });

    // === FAMILY: BABIES ===
    $d.on('change', '#bc-baby-parent', renderBabyList);
    $d.on('click', '#bc-baby-create', () => {
        const parentName = $('#bc-baby-parent').val();
        if (!parentName) return;
        showCreateBabyPopup(parentName, (data) => {
            const s = getSettings();
            const p = s.characters[parentName];
            if (!p) return;
            const baby = BabyManager.generate(p, data.father, {
                name: data.name,
                sex: data.sex
            });
            baby.ageDays = data.ageDays || 0;
            baby.birthWeight = data.weight || 3200;
            baby.currentWeight = data.weight || 3200;
            if (data.note) baby.notes = data.note;
            if (!p.babies) p.babies = [];
            p.babies.push(baby);
            saveSettings();
            renderBabyList();
            renderFamilyTree();
        });
    });
    $d.on('click', '.bc-baby-del', function () {
        const motherName = $(this).data('mother');
        const id = $(this).data('id');
        const s = getSettings();
        const p = s.characters[motherName];
        if (p?.babies) {
            p.babies = p.babies.filter(b => b.id !== id);
            saveSettings();
            renderBabyList();
            renderFamilyTree();
        }
    });

    // === AI REPARSE ===
    $d.on('click', '#bc-reparse', async function () {
        const btn = $(this);
        btn.prop('disabled', true).find('i').addClass('fa-spin');
        try {
            await aiReparse();
            rebuild();
        } catch (e) {
            console.error('[BunnyCycle] AI reparse error:', e);
        }
        btn.prop('disabled', false).find('i').removeClass('fa-spin');
    });

    // === INTIMACY LOG ===
    $d.on('click', '#bc-intim-log', () => {
        const s = getSettings();
        const log = (s.intimacyLog || []).slice(-20).reverse();
        if (!log.length) {
            showConfirm('Лог интимности пуст.', () => {});
            return;
        }
        const html = log.map(e => `<div class="bc-history-row">
            <span>${(e.parts || []).join(' × ')} — ${e.type || '?'} (${e.ejac || '?'})</span>
            <span class="bc-cond-day">${e.auto ? 'авто' : 'ручной'}</span>
        </div>`).join('');
        // Reuse popup
        import('./ui/popupManager.js').then(m => {
            // Simple: just show confirm-like with HTML
        });
    });

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

// ========================
// AI REPARSE (ИИ-анализ чата)
// ========================
async function aiReparse() {
    const s = getSettings();
    const ctx = getContext();
    if (!ctx?.chat?.length) { LOG('AI reparse: нет чата'); return; }

    // Берём последние 30 сообщений
    const msgs = ctx.chat.slice(-30).map(m => `${m.name || '?'}: ${m.mes || ''}`).join('\n');
    const charNames = Object.keys(s.characters);

    const systemPrompt = `You are a JSON extractor for an RP chat. Extract character info from the conversation.
Known characters: ${charNames.join(', ')}
Return ONLY valid JSON, no markdown, no explanation.`;

    const userPrompt = `Analyze this RP chat and extract:
- For each character: sex (M/F), pregnancy status (active: true/false, week number, father name), children (name, sex, father/mother), relationships between characters
- Only include data explicitly mentioned or strongly implied in the text

Return JSON format:
{
  "characters": {
    "Name": { "bioSex": "F", "pregnant": false, "pregnancyWeek": 0, "father": "" }
  },
  "children": [
    { "name": "ChildName", "sex": "F", "mother": "MotherName", "father": "FatherName", "ageDays": 0 }
  ],
  "relationships": [
    { "char1": "Name1", "char2": "Name2", "type": "партнёры" }
  ]
}

Chat:
${msgs}`;

    LOG('🤖 AI reparse запущен...');
    showNotice('🤖 ИИ-анализ запущен...', 0);

    const response = await LLM.call(systemPrompt, userPrompt);
    if (!response) {
        LOG('AI reparse: нет ответа от LLM');
        showNotice('❌ ИИ-анализ: нет ответа от LLM. Проверьте подключение API.', 4000);
        return;
    }

    const data = LLM.parseJSON(response);
    if (!data) {
        LOG('AI reparse: не удалось разобрать JSON', response);
        showNotice('❌ ИИ-анализ: не удалось разобрать ответ LLM.', 4000);
        return;
    }

    LOG('AI reparse результат:', data);

    // Применяем данные
    if (data.characters) {
        for (const [name, info] of Object.entries(data.characters)) {
            const p = s.characters[name];
            if (!p) continue;

            // Пол
            if (info.bioSex && !p._mB) {
                p.bioSex = info.bioSex;
                p._sexSource = 'ai_reparse';
                p._sexConfidence = 3;
                if (info.bioSex === 'M') p.cycle.enabled = false;
            }

            // Беременность
            if (info.pregnant && !p.pregnancy?.active) {
                ensureProfileFields(p);
                new PregnancyEngine(p).start(info.father || '?', 1, null, info.pregnancyWeek || 1);
            }
        }
    }

    // Дети
    if (data.children?.length) {
        for (const child of data.children) {
            const motherName = child.mother;
            const p = s.characters[motherName];
            if (!p) continue;
            if (!p.babies) p.babies = [];

            // Проверяем нет ли уже такого ребёнка
            const exists = p.babies.some(b => b.name === child.name);
            if (exists) continue;

            const baby = BabyManager.generate(p, child.father || '?', {
                name: child.name || '?',
                sex: child.sex || (Math.random() < 0.5 ? 'M' : 'F')
            });
            baby.ageDays = child.ageDays || 0;
            p.babies.push(baby);
            LOG(`👶 AI добавил ребёнка: ${child.name} (${motherName})`);
        }
    }

    // Отношения
    if (data.relationships?.length) {
        for (const rel of data.relationships) {
            if (!rel.char1 || !rel.char2) continue;
            // Проверяем нет ли уже такого
            const existing = (s.relationships || []).find(r =>
                (r.char1 === rel.char1 && r.char2 === rel.char2) ||
                (r.char1 === rel.char2 && r.char2 === rel.char1)
            );
            if (!existing) {
                RelationshipManager.add(rel.char1, rel.char2, rel.type || 'друзья', 'AI-detected');
                LOG(`❤️ AI добавил отношение: ${rel.char1} ↔ ${rel.char2} (${rel.type})`);
            }
        }
    }

    saveSettings();
    LOG('✅ AI reparse завершён');

    // Сводка
    const charCount = data.characters ? Object.keys(data.characters).length : 0;
    const childCount = data.children?.length || 0;
    const relCount = data.relationships?.length || 0;
    let summary = '✅ ИИ-анализ завершён!';
    if (charCount) summary += `<br>👤 Персонажей обновлено: ${charCount}`;
    if (childCount) summary += `<br>👶 Детей найдено: ${childCount}`;
    if (relCount) summary += `<br>❤️ Отношений найдено: ${relCount}`;
    if (!charCount && !childCount && !relCount) summary += '<br>Новых данных не обнаружено.';
    showNotice(summary, 5000);
}
