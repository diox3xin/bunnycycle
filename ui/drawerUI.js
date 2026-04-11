/**
 * BunnyCycle v3.0 — Drawer UI: рендеринг всех вкладок
 */

import { getSettings, saveSettings, canGetPregnant, ensureProfileFields, makeProfile } from '../core/stateManager.js';
import { CycleEngine } from '../core/cycleEngine.js';
import { PregnancyEngine } from '../core/pregnancyEngine.js';
import { LaborEngine, LABOR_STAGES } from '../core/laborEngine.js';
import { HealthSystem, DISEASE_DATABASE, SEVERITY_LABELS, MENTAL_STATE_LABELS } from '../core/healthSystem.js';
import { HeatRutEngine, BondEngine, OviEngine } from '../core/auEngine.js';
import { BabyManager } from '../core/babyManager.js';
import { RelationshipManager } from '../core/relationshipManager.js';
import { formatDate, escapeHtml, clamp } from '../utils/helpers.js';

// ========================
// РЕНДЕР ДАШБОРДА
// ========================
export function renderDashboard() {
    const s = getSettings();

    // Дата
    const dateEl = document.getElementById('bc-world-date');
    if (dateEl) {
        dateEl.textContent = formatDate(s.worldDate) + (s.worldDate.frozen ? ' ❄' : '');
    }

    // Персонажи — мини-карточки
    const dashChars = document.getElementById('bc-dash-chars');
    if (dashChars) {
        const chars = Object.keys(s.characters);
        if (!chars.length) {
            dashChars.innerHTML = '<div class="bc-empty">Нет персонажей. Откройте чат.</div>';
        } else {
            let html = '';
            for (const name of chars) {
                const p = s.characters[name];
                if (!p._enabled) continue;
                ensureProfileFields(p);
                html += renderDashCharCard(name, p);
            }
            dashChars.innerHTML = html;
        }
    }

    // Последние броски
    const dashDice = document.getElementById('bc-dash-dice');
    if (dashDice) {
        const log = (s.diceLog || []).slice(-5).reverse();
        if (!log.length) {
            dashDice.innerHTML = '<div class="bc-empty">Нет бросков</div>';
        } else {
            dashDice.innerHTML = log.map(e => `
                <div class="bc-dice-entry ${e.result ? 'bc-success' : 'bc-fail'}">
                    <span class="bc-dice-icon">${e.result ? '🎯' : '🎲'}</span>
                    <span>${escapeHtml(e.target)}: ${e.roll}/${e.chance} → ${e.result ? 'ЗАЧАТИЕ!' : 'нет'}</span>
                    <span class="bc-dice-ts">${e.ts}</span>
                </div>
            `).join('');
        }
    }
}

function renderDashCharCard(name, p) {
    const ce = new CycleEngine(p);
    const hs = new HealthSystem(p);
    const status = hs.overallStatus;

    let badges = '';
    if (p.pregnancy?.active) {
        const pe = new PregnancyEngine(p);
        badges += `<span class="bc-badge bc-badge-preg">🤰 ${pe.pr.week} нед.</span>`;
    }
    if (p.labor?.active) badges += `<span class="bc-badge bc-badge-labor">🏥 Роды</span>`;
    if (p.heat?.active) badges += `<span class="bc-badge bc-badge-heat">🔥 Течка</span>`;
    if (p.rut?.active) badges += `<span class="bc-badge bc-badge-heat">🔥 Гон</span>`;
    if (p.cycle?.enabled && !p.pregnancy?.active) {
        badges += `<span class="bc-badge" style="background:${ce.phaseColor}">${ce.phaseEmoji} ${ce.phaseLabel}</span>`;
    }

    const condCount = (p.health?.conditions?.length || 0) + (p.health?.injuries?.length || 0);
    if (condCount > 0) badges += `<span class="bc-badge bc-badge-health" style="background:${status.color}">${status.emoji} ${condCount}</span>`;

    return `
        <div class="bc-dash-card">
            <div class="bc-dash-card-head">
                <span class="bc-dash-name">${escapeHtml(name)}</span>
                <span class="bc-dash-sex">${p.bioSex === 'M' ? '♂' : '♀'}${p.secondarySex ? '/' + p.secondarySex[0].toUpperCase() : ''}</span>
            </div>
            <div class="bc-dash-badges">${badges}</div>
        </div>
    `;
}

// ========================
// РЕНДЕР СПИСКА ПЕРСОНАЖЕЙ
// ========================
export function renderCharList() {
    const s = getSettings();
    const el = document.getElementById('bc-char-list');
    if (!el) return;

    const chars = Object.keys(s.characters);
    if (!chars.length) { el.innerHTML = '<div class="bc-empty">Нет персонажей</div>'; return; }

    el.innerHTML = chars.map(name => {
        const p = s.characters[name];
        return `
            <div class="bc-char-row">
                <span class="bc-char-icon">${p.bioSex === 'M' ? '♂' : '♀'}</span>
                <span class="bc-char-name">${escapeHtml(name)}</span>
                <span class="bc-char-info">${p.race}${p._isUser ? ' 👤' : ''}</span>
                <button class="bc-icon-btn bc-edit-char" data-char="${escapeHtml(name)}" title="Редактировать"><i class="fa-solid fa-pen"></i></button>
                <button class="bc-icon-btn bc-del-char" data-char="${escapeHtml(name)}" title="Удалить"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
    }).join('');
}

// ========================
// РЕНДЕР ЦИКЛА
// ========================
export function renderCycle() {
    const s = getSettings();
    const sel = document.getElementById('bc-cycle-char');
    const panel = document.getElementById('bc-cycle-panel');
    if (!sel || !panel) return;

    const p = s.characters[sel.value];
    if (!p || !p.cycle) { panel.innerHTML = '<div class="bc-empty">Выберите персонажа</div>'; return; }

    const ce = new CycleEngine(p);
    const cal = ce.getFullCalendar();

    let calHtml = '<div class="bc-calendar">';
    for (const d of cal) {
        const phaseClass = `bc-cal-${d.phase}`;
        calHtml += `<div class="bc-cal-day ${phaseClass} ${d.isToday ? 'bc-cal-today' : ''}">${d.day}</div>`;
    }
    calHtml += '</div>';

    panel.innerHTML = `
        <div class="bc-cycle-info">
            <div class="bc-stat-row">
                <span class="bc-stat-label">Фаза</span>
                <span class="bc-stat-value" style="color:${ce.phaseColor}">${ce.phaseEmoji} ${ce.phaseLabel}</span>
            </div>
            <div class="bc-stat-row">
                <span class="bc-stat-label">День</span>
                <span class="bc-stat-value">${ce.c.currentDay} / ${ce.c.length}</span>
            </div>
            <div class="bc-stat-row">
                <span class="bc-stat-label">Фертильность</span>
                <span class="bc-stat-value">${Math.round(ce.fertility * 100)}% (${ce.fertilityLevel})</span>
            </div>
            <div class="bc-stat-row">
                <span class="bc-stat-label">Либидо</span>
                <span class="bc-stat-value">${ce.libido}</span>
            </div>
            <div class="bc-stat-row">
                <span class="bc-stat-label">Овуляция через</span>
                <span class="bc-stat-value">${ce.daysToOvulation} дн.</span>
            </div>
            <div class="bc-stat-row">
                <span class="bc-stat-label">Менструация через</span>
                <span class="bc-stat-value">${ce.daysToMenstruation} дн.</span>
            </div>
            <div class="bc-stat-row">
                <span class="bc-stat-label">Симптомы</span>
                <span class="bc-stat-value">${ce.symptoms.join(', ') || '—'}</span>
            </div>
            <div class="bc-stat-row">
                <span class="bc-stat-label">Выделения</span>
                <span class="bc-stat-value">${ce.discharge}</span>
            </div>
        </div>
        <div class="bc-section-head" style="margin-top:8px">Календарь цикла</div>
        ${calHtml}
        <div class="bc-btn-group" style="margin-top:8px">
            <button class="bc-btn-sm bc-cyc-set-phase" data-phase="menstruation">🔴 Менс.</button>
            <button class="bc-btn-sm bc-cyc-set-phase" data-phase="follicular">🌸 Фолл.</button>
            <button class="bc-btn-sm bc-cyc-set-phase" data-phase="ovulation">🥚 Овул.</button>
            <button class="bc-btn-sm bc-cyc-set-phase" data-phase="luteal">🌙 Лют.</button>
        </div>
    `;
}

// ========================
// РЕНДЕР БЕРЕМЕННОСТИ
// ========================
export function renderPregnancy() {
    const s = getSettings();
    const sel = document.getElementById('bc-preg-char');
    const panel = document.getElementById('bc-preg-panel');
    const laborPanel = document.getElementById('bc-labor-panel');
    if (!sel || !panel) return;

    const p = s.characters[sel.value];
    if (!p) { panel.innerHTML = '<div class="bc-empty">Выберите персонажа</div>'; return; }

    if (!p.pregnancy?.active) {
        panel.innerHTML = `
            <div class="bc-empty">Не беременна</div>
            ${canGetPregnant(p) ? '<button class="bc-btn" id="bc-start-preg"><i class="fa-solid fa-baby"></i> Начать беременность</button>' : ''}
        `;
        if (laborPanel) laborPanel.style.display = 'none';
        return;
    }

    const pe = new PregnancyEngine(p);
    const size = pe.size;

    panel.innerHTML = `
        <div class="bc-preg-header">
            <span class="bc-preg-emoji">${size.emoji}</span>
            <span class="bc-preg-title">${pe.trimesterLabel}</span>
            <span class="bc-preg-weeks">${pe.pr.week}/${pe.pr.maxWeeks} нед.</span>
        </div>
        <div class="bc-progress-bar">
            <div class="bc-progress-fill bc-progress-preg" style="width:${pe.progress}%"></div>
            <span class="bc-progress-text">${pe.progress}%</span>
        </div>
        <div class="bc-stat-row"><span class="bc-stat-label">Размер плода</span><span class="bc-stat-value">${size.name}</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Живот</span><span class="bc-stat-value">${pe.bellySize}</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Шевеления</span><span class="bc-stat-value">${pe.movements.emoji} ${pe.movements.label}</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Плодов</span><span class="bc-stat-value">${pe.pr.fetusCount} (${pe.pr.fetusSexes.map(s => s === 'M' ? '♂' : '♀').join(', ')})</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Отец</span><span class="bc-stat-value">${escapeHtml(pe.pr.father)}</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Набор веса</span><span class="bc-stat-value">~${pe.weightGainEstimate} кг</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">До родов</span><span class="bc-stat-value">~${pe.dueDate} нед.</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Высокий риск?</span><span class="bc-stat-value">${pe.isHighRisk ? '⚠ Да' : '✓ Нет'}</span></div>
        ${pe.symptoms.length ? `<div class="bc-stat-row"><span class="bc-stat-label">Симптомы</span><span class="bc-stat-value">${pe.symptoms.join(', ')}</span></div>` : ''}
        ${pe.pr.complications.length ? `
            <div class="bc-stat-row">
                <span class="bc-stat-label">⚠ Осложнения</span>
                <span class="bc-stat-value bc-danger-text">${pe.pr.complications.map((c, i) =>
                    `${escapeHtml(c)} <button class="bc-icon-btn bc-rm-preg-comp" data-idx="${i}" title="Убрать"><i class="fa-solid fa-xmark"></i></button>`
                ).join(', ')}</span>
            </div>
            <button class="bc-btn-sm bc-rm-all-preg-comp">✕ Убрать все осложнения</button>
        ` : ''}
        <div class="bc-btn-group" style="margin-top:8px">
            <button class="bc-btn-sm" id="bc-preg-advance">+1 неделя</button>
            <button class="bc-btn-sm" id="bc-preg-complication">+ Осложнение</button>
            ${pe.pr.week >= pe.pr.maxWeeks - 4 ? '<button class="bc-btn primary" id="bc-start-labor"><i class="fa-solid fa-hospital"></i> Начать роды</button>' : ''}
            <button class="bc-btn-sm bc-danger" id="bc-end-preg">Прервать</button>
        </div>
    `;

    // Роды
    if (laborPanel && p.labor?.active) {
        laborPanel.style.display = '';
        renderLabor(sel.value);
    }
}

function renderLabor(charName) {
    const s = getSettings();
    const panel = document.getElementById('bc-labor-panel');
    if (!panel) return;
    const p = s.characters[charName];
    if (!p?.labor?.active) { panel.style.display = 'none'; return; }

    const le = new LaborEngine(p);
    panel.innerHTML = `
        <div class="bc-section-head" style="color:#e04050"><i class="fa-solid fa-hospital"></i> РОДЫ</div>
        <div class="bc-stat-row"><span class="bc-stat-label">Стадия</span><span class="bc-stat-value">${le.stageLabel}</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Раскрытие</span><span class="bc-stat-value">${le.l.dilation}/10 см</span></div>
        <div class="bc-progress-bar"><div class="bc-progress-fill bc-progress-labor" style="width:${le.dilationProgress}%"></div></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Боль</span><span class="bc-stat-value">${le.painLevel}</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Схватки</span><span class="bc-stat-value">каждые ${le.contractionInfo.interval}</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Часов прошло</span><span class="bc-stat-value">${le.l.hoursElapsed}</span></div>
        <div class="bc-stat-row"><span class="bc-stat-label">Родилось</span><span class="bc-stat-value">${le.l.babiesDelivered}/${le.l.totalBabies}</span></div>
        ${le.l.complications.length ? `
            <div class="bc-stat-row">
                <span class="bc-stat-label">⚠ Осложнения</span>
                <span class="bc-stat-value bc-danger-text">${le.l.complications.map((c, i) =>
                    `${escapeHtml(c)} <button class="bc-icon-btn bc-rm-labor-comp" data-idx="${i}" title="Убрать"><i class="fa-solid fa-xmark"></i></button>`
                ).join(', ')}</span>
            </div>
            <button class="bc-btn-sm bc-rm-all-labor-comp">✕ Убрать все осложнения</button>
        ` : ''}
        <p class="bc-info-text">${le.stageDescription}</p>
        <div class="bc-btn-group">
            <button class="bc-btn primary" id="bc-labor-advance">Следующая стадия</button>
            <button class="bc-btn-sm" id="bc-labor-complication">+ Осложнение</button>
            <button class="bc-btn-sm" id="bc-labor-deliver">Рождение</button>
            <button class="bc-btn-sm bc-danger" id="bc-labor-end">Завершить</button>
        </div>
    `;
}

// ========================
// РЕНДЕР ЗДОРОВЬЯ
// ========================
export function renderHealth() {
    const s = getSettings();
    const sel = document.getElementById('bc-health-char');
    if (!sel) return;

    const p = s.characters[sel.value];
    if (!p) return;
    ensureProfileFields(p);

    const hs = new HealthSystem(p);
    const status = hs.overallStatus;
    const mental = hs.mentalStateInfo;

    // Показатели
    const barsEl = document.getElementById('bc-health-bars');
    if (barsEl) {
        barsEl.innerHTML = `
            <div class="bc-health-status" style="border-color:${status.color}">
                ${status.emoji} Общее: <strong>${status.label}</strong>
            </div>
            ${renderBar('Иммунитет', p.health.immunity, '#60c060', '🛡️')}
            ${renderBar('Энергия', p.health.energy, '#50a0f0', '⚡')}
            ${renderBar('Стресс', p.health.stress, '#f0c850', '😰')}
            ${renderBar('Боль', p.health.pain, '#e04050', '🤕')}
            ${renderBar('Кровопотеря', p.health.bloodLoss, '#c02030', '🩸')}
        `;
    }

    // Болезни
    const condEl = document.getElementById('bc-health-conditions');
    if (condEl) {
        if (!p.health.conditions.length) {
            condEl.innerHTML = '<div class="bc-empty">Здоров 🟢</div>';
        } else {
            condEl.innerHTML = p.health.conditions.map(c => {
                const sev = SEVERITY_LABELS[c.severity] || SEVERITY_LABELS.mild;
                return `
                    <div class="bc-condition-row">
                        <span class="bc-cond-sev" style="color:${sev.color}">${sev.emoji}</span>
                        <span class="bc-cond-label">${escapeHtml(c.label)}</span>
                        <span class="bc-cond-day">день ${c.day}/${c.maxDays < 999 ? c.maxDays : '∞'}</span>
                        ${c.note ? `<span class="bc-cond-note">${escapeHtml(c.note)}</span>` : ''}
                        <button class="bc-icon-btn bc-rm-cond" data-id="${c.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                `;
            }).join('');
        }
    }

    // Травмы
    const injEl = document.getElementById('bc-health-injuries');
    if (injEl) {
        if (!p.health.injuries.length) {
            injEl.innerHTML = '<div class="bc-empty">Нет травм ✓</div>';
        } else {
            injEl.innerHTML = p.health.injuries.map(i => {
                const sev = SEVERITY_LABELS[i.severity] || SEVERITY_LABELS.mild;
                return `
                    <div class="bc-condition-row">
                        <span class="bc-cond-sev" style="color:${sev.color}">${sev.emoji}</span>
                        <span class="bc-cond-label">${escapeHtml(i.label)} — ${escapeHtml(i.location)}</span>
                        <span class="bc-cond-day">день ${i.day}/${i.healDays}</span>
                        ${i.infected ? '<span class="bc-badge bc-badge-danger">ИНФЕКЦИЯ</span>' : ''}
                        <button class="bc-icon-btn bc-rm-injury" data-id="${i.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
                    </div>
                `;
            }).join('');
        }
    }

    // Лекарства
    const medEl = document.getElementById('bc-health-meds');
    if (medEl) {
        if (!p.health.medications.length) {
            medEl.innerHTML = '<div class="bc-empty">Нет лекарств</div>';
        } else {
            medEl.innerHTML = p.health.medications.map(m => `
                <div class="bc-condition-row">
                    <span class="bc-cond-sev">💊</span>
                    <span class="bc-cond-label">${escapeHtml(m.name)}</span>
                    <span class="bc-cond-day">${m.daysLeft} дн. осталось</span>
                    <button class="bc-icon-btn bc-rm-med" data-id="${m.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
                </div>
            `).join('');
        }
    }

    // Ментальное
    const mentalEl = document.getElementById('bc-health-mental');
    if (mentalEl) {
        mentalEl.innerHTML = `
            <div class="bc-mental-status" style="border-color:${mental.color}">
                ${mental.emoji} ${mental.label}
            </div>
            ${p.health.allergies?.length ? `<div class="bc-stat-row"><span class="bc-stat-label">Аллергии</span><span class="bc-stat-value">${p.health.allergies.join(', ')}</span></div>` : ''}
        `;
    }

    // История
    const histEl = document.getElementById('bc-health-history');
    if (histEl) {
        if (!p.health.history?.length) {
            histEl.innerHTML = '<div class="bc-empty">Нет истории</div>';
        } else {
            histEl.innerHTML = p.health.history.slice(-10).reverse().map(h => `
                <div class="bc-history-row">
                    <span>${escapeHtml(h.label)}</span>
                    <span class="bc-cond-day">${h.outcome} (${h.daysActive} дн.)</span>
                </div>
            `).join('');
        }
    }
}

function renderBar(label, value, color, emoji) {
    return `
        <div class="bc-bar-row">
            <span class="bc-bar-label">${emoji} ${label}</span>
            <div class="bc-bar-track">
                <div class="bc-bar-fill" style="width:${value}%;background:${color}"></div>
            </div>
            <span class="bc-bar-value">${value}%</span>
        </div>
    `;
}

// ========================
// ЗАПОЛНЕНИЕ СЕЛЕКТОВ ПЕРСОНАЖЕЙ
// ========================
export function populateCharSelects() {
    const s = getSettings();
    const names = Object.keys(s.characters);
    const options = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');

    const selectors = [
        'bc-cycle-char', 'bc-preg-char', 'bc-health-char',
        'bc-intim-target', 'bc-intim-partner', 'bc-baby-parent',
        'bc-ovi-char'
    ];
    for (const id of selectors) {
        const el = document.getElementById(id);
        if (el) {
            const prev = el.value;
            el.innerHTML = options;
            if (prev && names.includes(prev)) el.value = prev;
        }
    }
}

// ========================
// РЕНДЕР РЕДАКТОРА ПЕРСОНАЖА
// ========================
export function renderCharEditor(charName) {
    const s = getSettings();
    const p = s.characters[charName];
    if (!p) return;
    ensureProfileFields(p);

    const el = document.getElementById('bc-char-editor');
    if (!el) return;
    el.style.display = '';

    const sexOptions = ['F', 'M'].map(v => `<option value="${v}" ${p.bioSex === v ? 'selected' : ''}>${v === 'F' ? '♀ Женский' : '♂ Мужской'}</option>`).join('');
    const sec = ['', 'alpha', 'beta', 'omega'].map(v => `<option value="${v}" ${(p.secondarySex || '') === v ? 'selected' : ''}>${v ? v[0].toUpperCase() + v.slice(1) : '—'}</option>`).join('');
    const races = ['human','elf','dwarf','orc','demon','vampire','werewolf','fairy','dragon','halfling','other'].map(v => `<option value="${v}" ${p.race === v ? 'selected' : ''}>${v}</option>`).join('');
    const contras = ['none','condom','pill','iud','implant','injection','natural','magic'].map(v => `<option value="${v}" ${p.contraception === v ? 'selected' : ''}>${v}</option>`).join('');
    const diffs = ['easy','normal','hard','impossible'].map(v => `<option value="${v}" ${p.pregnancyDifficulty === v ? 'selected' : ''}>${v === 'easy' ? 'Лёгкая' : v === 'normal' ? 'Нормальная' : v === 'hard' ? 'Тяжёлая' : 'Невозможна'}</option>`).join('');
    const symInt = ['mild','moderate','strong'].map(v => `<option value="${v}" ${p.cycle?.symptomIntensity === v ? 'selected' : ''}>${v === 'mild' ? 'Слабые' : v === 'moderate' ? 'Умеренные' : 'Сильные'}</option>`).join('');

    el.innerHTML = `
        <div class="bc-section-head"><i class="fa-solid fa-pen"></i> Редактор: ${escapeHtml(charName)}
            <button class="bc-icon-btn bc-close-editor" title="Закрыть"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <input type="hidden" id="bc-edit-name" value="${escapeHtml(charName)}">

        <div class="bc-row"><label>Пол</label><select class="bc-select bc-ed" data-field="bioSex">${sexOptions}</select></div>
        <div class="bc-row"><label>Вторичный пол</label><select class="bc-select bc-ed" data-field="secondarySex">${sec}</select></div>
        <div class="bc-row"><label>Раса</label><select class="bc-select bc-ed" data-field="race">${races}</select></div>
        <div class="bc-row"><label>Возраст</label><input class="bc-input bc-ed" data-field="age" type="number" value="${p.age || ''}" min="0" max="9999" placeholder="—"></div>
        <div class="bc-row"><label>Цвет глаз</label><input class="bc-input bc-ed" data-field="eyeColor" value="${escapeHtml(p.eyeColor || '')}"></div>
        <div class="bc-row"><label>Цвет волос</label><input class="bc-input bc-ed" data-field="hairColor" value="${escapeHtml(p.hairColor || '')}"></div>
        <div class="bc-row"><label>Контрацепция</label><select class="bc-select bc-ed" data-field="contraception">${contras}</select></div>
        <div class="bc-row"><label>Сложность берем.</label><select class="bc-select bc-ed" data-field="pregnancyDifficulty">${diffs}</select></div>

        <div class="bc-section-head" style="margin-top:8px"><i class="fa-solid fa-circle-notch"></i> Цикл</div>
        <label class="bc-checkbox"><input type="checkbox" class="bc-ed-cyc" data-field="enabled" ${p.cycle?.enabled ? 'checked' : ''}> Цикл включён</label>
        <div class="bc-row"><label>Длина цикла (дн.)</label><input class="bc-input bc-ed-cyc" data-field="baseLength" type="number" value="${p.cycle?.baseLength || 28}" min="20" max="45"></div>
        <div class="bc-row"><label>Длит. менструации</label><input class="bc-input bc-ed-cyc" data-field="menstruationDuration" type="number" value="${p.cycle?.menstruationDuration || 5}" min="2" max="10"></div>
        <div class="bc-row"><label>Нерегулярность (±дн.)</label><input class="bc-input bc-ed-cyc" data-field="irregularity" type="number" value="${p.cycle?.irregularity || 2}" min="0" max="10"></div>
        <div class="bc-row"><label>Интенсивность симптомов</label><select class="bc-select bc-ed-cyc" data-field="symptomIntensity">${symInt}</select></div>
        <div class="bc-row"><label>Текущий день</label><input class="bc-input bc-ed-cyc" data-field="currentDay" type="number" value="${p.cycle?.currentDay || 1}" min="1" max="45"></div>

        <div class="bc-btn-group" style="margin-top:8px">
            <button class="bc-btn primary bc-save-editor">💾 Сохранить</button>
            <button class="bc-btn bc-close-editor">Закрыть</button>
        </div>
    `;
}

export function hideCharEditor() {
    const el = document.getElementById('bc-char-editor');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

// ========================
// РЕНДЕР AU НАСТРОЕК
// ========================
export function renderAuSettings() {
    const s = getSettings();
    const el = document.getElementById('bc-au-settings');
    if (!el) return;

    const preset = s.auPreset;
    let html = '';

    if (preset === 'omegaverse') {
        const o = s.auSettings.omegaverse;
        html = `
            <div class="bc-section-head"><i class="fa-solid fa-fire"></i> Течка (Omega)</div>
            <div class="bc-row"><label>Цикл течки (дн.)</label><input class="bc-input bc-au-ov" data-field="heatCycleLength" type="number" value="${o.heatCycleLength}" min="7" max="90"></div>
            <div class="bc-row"><label>Длительность (дн.)</label><input class="bc-input bc-au-ov" data-field="heatDuration" type="number" value="${o.heatDuration}" min="1" max="14"></div>
            <div class="bc-row"><label>Пре-течка (дн.)</label><input class="bc-input bc-au-ov" data-field="preHeatDays" type="number" value="${o.preHeatDays}" min="0" max="5"></div>
            <div class="bc-row"><label>Пост-течка (дн.)</label><input class="bc-input bc-au-ov" data-field="postHeatDays" type="number" value="${o.postHeatDays}" min="0" max="5"></div>
            <div class="bc-row"><label>Интенсивность</label><select class="bc-select bc-au-ov" data-field="heatIntensity">
                <option value="mild" ${o.heatIntensity==='mild'?'selected':''}>Слабая</option>
                <option value="moderate" ${o.heatIntensity==='moderate'?'selected':''}>Умеренная</option>
                <option value="strong" ${o.heatIntensity==='strong'?'selected':''}>Сильная</option>
                <option value="overwhelming" ${o.heatIntensity==='overwhelming'?'selected':''}>Невыносимая</option>
            </select></div>
            <div class="bc-row"><label>Бонус фертильности</label><input class="bc-input bc-au-ov" data-field="heatFertilityBonus" type="number" value="${o.heatFertilityBonus}" min="0" max="1" step="0.05"></div>

            <div class="bc-section-head"><i class="fa-solid fa-fire-flame-curved"></i> Гон (Alpha)</div>
            <div class="bc-row"><label>Цикл гона (дн.)</label><input class="bc-input bc-au-ov" data-field="rutCycleLength" type="number" value="${o.rutCycleLength}" min="7" max="90"></div>
            <div class="bc-row"><label>Длительность (дн.)</label><input class="bc-input bc-au-ov" data-field="rutDuration" type="number" value="${o.rutDuration}" min="1" max="14"></div>
            <div class="bc-row"><label>Пре-гон (дн.)</label><input class="bc-input bc-au-ov" data-field="preRutDays" type="number" value="${o.preRutDays}" min="0" max="5"></div>
            <div class="bc-row"><label>Пост-гон (дн.)</label><input class="bc-input bc-au-ov" data-field="postRutDays" type="number" value="${o.postRutDays}" min="0" max="5"></div>
            <div class="bc-row"><label>Интенсивность</label><select class="bc-select bc-au-ov" data-field="rutIntensity">
                <option value="mild" ${o.rutIntensity==='mild'?'selected':''}>Слабая</option>
                <option value="moderate" ${o.rutIntensity==='moderate'?'selected':''}>Умеренная</option>
                <option value="strong" ${o.rutIntensity==='strong'?'selected':''}>Сильная</option>
                <option value="overwhelming" ${o.rutIntensity==='overwhelming'?'selected':''}>Невыносимая</option>
            </select></div>

            <div class="bc-section-head"><i class="fa-solid fa-link"></i> Связь / Вязка</div>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="knotEnabled" ${o.knotEnabled?'checked':''}> Вязка (knot)</label>
            <div class="bc-row"><label>Мин. длительность (мин.)</label><input class="bc-input bc-au-ov" data-field="knotDurationMin" type="number" value="${o.knotDurationMin}" min="5" max="120"></div>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="bondingEnabled" ${o.bondingEnabled?'checked':''}> Связь (bonding)</label>
            <div class="bc-row"><label>Тип связи</label><select class="bc-select bc-au-ov" data-field="bondingType">
                <option value="bite" ${o.bondingType==='bite'?'selected':''}>Укус</option>
                <option value="mark" ${o.bondingType==='mark'?'selected':''}>Метка</option>
                <option value="scent" ${o.bondingType==='scent'?'selected':''}>Запах</option>
                <option value="magic" ${o.bondingType==='magic'?'selected':''}>Магия</option>
            </select></div>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="bondEffectEmpathy" ${o.bondEffectEmpathy?'checked':''}> Эмпатия через связь</label>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="bondEffectProximity" ${o.bondEffectProximity?'checked':''}> Тяга к близости</label>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="bondEffectProtective" ${o.bondEffectProtective?'checked':''}> Защитный инстинкт</label>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="bondBreakable" ${o.bondBreakable?'checked':''}> Связь можно разорвать</label>
            <div class="bc-row"><label>Абстиненция (дн.)</label><input class="bc-input bc-au-ov" data-field="bondWithdrawalDays" type="number" value="${o.bondWithdrawalDays}" min="1" max="30"></div>

            <div class="bc-section-head"><i class="fa-solid fa-flask"></i> Супрессанты и прочее</div>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="suppressantsAvailable" ${o.suppressantsAvailable?'checked':''}> Супрессанты доступны</label>
            <div class="bc-row"><label>Эффективность</label><input class="bc-input bc-au-ov" data-field="suppressantEffectiveness" type="number" value="${o.suppressantEffectiveness}" min="0" max="1" step="0.05"></div>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="suppressantSideEffects" ${o.suppressantSideEffects?'checked':''}> Побочные эффекты</label>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="slickEnabled" ${o.slickEnabled?'checked':''}> Смазка (slick)</label>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="scentEnabled" ${o.scentEnabled?'checked':''}> Запахи (scent)</label>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="nestingEnabled" ${o.nestingEnabled?'checked':''}> Гнездование</label>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="purringEnabled" ${o.purringEnabled?'checked':''}> Мурлыканье</label>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="maleOmegaPregnancy" ${o.maleOmegaPregnancy?'checked':''}> Мужская омега-беременность</label>
            <div class="bc-row"><label>Длит. беременности (нед.)</label><input class="bc-input bc-au-ov" data-field="pregnancyWeeks" type="number" value="${o.pregnancyWeeks}" min="20" max="50"></div>
            <div class="bc-row"><label>Шанс двойни</label><input class="bc-input bc-au-ov" data-field="twinChance" type="number" value="${o.twinChance}" min="0" max="1" step="0.05"></div>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="alphaCommandVoice" ${o.alphaCommandVoice?'checked':''}> Командный голос (альфа)</label>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-ov" data-field="omegaSubmission" ${o.omegaSubmission?'checked':''}> Подчинение (омега)</label>
        `;
    } else if (preset === 'fantasy') {
        const f = s.auSettings.fantasy;
        const raceWeeks = f.pregnancyByRace || {};
        html = `
            <div class="bc-section-head"><i class="fa-solid fa-hat-wizard"></i> Фэнтези: сроки по расам</div>
            ${Object.entries(raceWeeks).map(([r, w]) => `
                <div class="bc-row"><label>${r}</label><input class="bc-input bc-au-fan-race" data-race="${r}" type="number" value="${w}" min="5" max="200"> нед.</div>
            `).join('')}
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-fan" data-field="magicPregnancy" ${f.magicPregnancy?'checked':''}> Магическая беременность</label>
            <label class="bc-checkbox"><input type="checkbox" class="bc-au-fan" data-field="acceleratedPregnancy" ${f.acceleratedPregnancy?'checked':''}> Ускоренная беременность</label>
            <div class="bc-row"><label>Фактор ускорения</label><input class="bc-input bc-au-fan" data-field="accelerationFactor" type="number" value="${f.accelerationFactor}" min="0.1" max="10" step="0.1"></div>
        `;
    }

    // Овипозиция (для всех пресетов)
    const ovi = s.auSettings.oviposition;
    html += `
        <div class="bc-section-head" style="margin-top:8px"><i class="fa-solid fa-egg"></i> Овипозиция</div>
        <label class="bc-checkbox"><input type="checkbox" class="bc-au-ovi" data-field="enabled" ${ovi.enabled?'checked':''}> Включена</label>
        <div class="bc-row"><label>Мин. яиц</label><input class="bc-input bc-au-ovi" data-field="eggCountMin" type="number" value="${ovi.eggCountMin}" min="1" max="20"></div>
        <div class="bc-row"><label>Макс. яиц</label><input class="bc-input bc-au-ovi" data-field="eggCountMax" type="number" value="${ovi.eggCountMax}" min="1" max="20"></div>
        <div class="bc-row"><label>Вынашивание (дн.)</label><input class="bc-input bc-au-ovi" data-field="gestationDays" type="number" value="${ovi.gestationDays}" min="1" max="90"></div>
        <div class="bc-row"><label>Откладывание (дн.)</label><input class="bc-input bc-au-ovi" data-field="layingDuration" type="number" value="${ovi.layingDuration}" min="1" max="10"></div>
        <div class="bc-row"><label>Инкубация (дн.)</label><input class="bc-input bc-au-ovi" data-field="incubationDays" type="number" value="${ovi.incubationDays}" min="1" max="90"></div>
        <div class="bc-row"><label>Шанс оплодотворения</label><input class="bc-input bc-au-ovi" data-field="fertilizationChance" type="number" value="${ovi.fertilizationChance}" min="0" max="1" step="0.05"></div>
        <div class="bc-row"><label>Тип скорлупы</label><select class="bc-select bc-au-ovi" data-field="shellType">
            <option value="hard" ${ovi.shellType==='hard'?'selected':''}>Твёрдая</option>
            <option value="soft" ${ovi.shellType==='soft'?'selected':''}>Мягкая</option>
            <option value="leathery" ${ovi.shellType==='leathery'?'selected':''}>Кожистая</option>
        </select></div>
        <div class="bc-row"><label>Размер яиц</label><select class="bc-select bc-au-ovi" data-field="eggSize">
            <option value="small" ${ovi.eggSize==='small'?'selected':''}>Маленькие</option>
            <option value="medium" ${ovi.eggSize==='medium'?'selected':''}>Средние</option>
            <option value="large" ${ovi.eggSize==='large'?'selected':''}>Большие</option>
        </select></div>
        <div class="bc-row"><label>Болезненность</label><select class="bc-select bc-au-ovi" data-field="painLevel">
            <option value="none" ${ovi.painLevel==='none'?'selected':''}>Нет</option>
            <option value="mild" ${ovi.painLevel==='mild'?'selected':''}>Слабая</option>
            <option value="moderate" ${ovi.painLevel==='moderate'?'selected':''}>Умеренная</option>
            <option value="severe" ${ovi.painLevel==='severe'?'selected':''}>Сильная</option>
        </select></div>
    `;

    el.innerHTML = html;
}

// ========================
// РЕНДЕР СПИСКА ПРОФИЛЕЙ
// ========================
export function renderProfileList() {
    const s = getSettings();
    const el = document.getElementById('bc-prof-list');
    if (!el) return;

    const profiles = Object.keys(s.chatProfiles || {});
    if (!profiles.length) {
        el.innerHTML = '<div class="bc-empty">Нет сохранённых профилей</div>';
        return;
    }

    el.innerHTML = profiles.map(id => {
        const pr = s.chatProfiles[id];
        const count = Object.keys(pr.characters || {}).length;
        const isCurrent = id === s.currentChatId;
        return `
            <div class="bc-prof-row ${isCurrent ? 'bc-prof-current' : ''}">
                <span class="bc-prof-id">${escapeHtml(id.substring(0, 20))}...</span>
                <span class="bc-prof-count">${count} перс.</span>
                <button class="bc-icon-btn bc-prof-load-one" data-id="${escapeHtml(id)}" title="Загрузить"><i class="fa-solid fa-download"></i></button>
                <button class="bc-icon-btn bc-prof-del" data-id="${escapeHtml(id)}" title="Удалить"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
    }).join('');
}

// ========================
// РЕНДЕР ОТНОШЕНИЙ
// ========================
export function renderRelList() {
    const s = getSettings();
    const el = document.getElementById('bc-rel-list');
    if (!el) return;

    const rels = s.relationships || [];
    if (!rels.length) {
        el.innerHTML = '<div class="bc-empty">Нет отношений</div>';
        return;
    }

    el.innerHTML = rels.map(r => `
        <div class="bc-rel-row">
            <span class="bc-rel-pair">${escapeHtml(r.char1)} ↔ ${escapeHtml(r.char2)}</span>
            <span class="bc-rel-type">${escapeHtml(r.type)}</span>
            ${r.notes ? `<span class="bc-rel-note">${escapeHtml(r.notes)}</span>` : ''}
            <span class="bc-rel-str">💪 ${r.strength || 50}%</span>
            <button class="bc-icon-btn bc-rel-del" data-id="${r.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
        </div>
    `).join('');
}

// ========================
// РЕНДЕР ДЕТЕЙ
// ========================
export function renderBabyList() {
    const s = getSettings();
    const sel = document.getElementById('bc-baby-parent');
    const el = document.getElementById('bc-baby-list');
    if (!el) return;

    // Собираем всех детей от всех персонажей
    let allBabies = [];
    const parentFilter = sel?.value;

    for (const [name, p] of Object.entries(s.characters || {})) {
        if (p.babies?.length) {
            for (const baby of p.babies) {
                if (!parentFilter || name === parentFilter || baby.father === parentFilter) {
                    allBabies.push({ ...baby, _motherName: name });
                }
            }
        }
    }

    if (!allBabies.length) {
        el.innerHTML = '<div class="bc-empty">Нет детей</div>';
        return;
    }

    el.innerHTML = allBabies.map(b => {
        const bm = new BabyManager(b);
        return `
            <div class="bc-baby-row">
                <span class="bc-baby-icon">${bm.ageEmoji}</span>
                <span class="bc-baby-name">${escapeHtml(b.name || '?')} ${b.sex === 'M' ? '♂' : '♀'}</span>
                <span class="bc-baby-age">${bm.ageLabel}</span>
                <span class="bc-baby-parents">${escapeHtml(b._motherName)} × ${escapeHtml(b.father)}</span>
                <span class="bc-baby-weight">${b.currentWeight || b.birthWeight}г</span>
                ${bm.nextMilestone ? `<span class="bc-baby-next">→ ${bm.nextMilestone.label}</span>` : ''}
                <button class="bc-icon-btn bc-baby-del" data-mother="${escapeHtml(b._motherName)}" data-id="${b.id}" title="Удалить"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `;
    }).join('');
}

// ========================
// РЕНДЕР СЕМЕЙНОГО ДРЕВА
// ========================
export function renderFamilyTree() {
    const el = document.getElementById('bc-family-tree');
    if (!el) return;

    const tree = RelationshipManager.buildFamilyTree();
    const names = Object.keys(tree);
    if (!names.length) {
        el.innerHTML = '<div class="bc-empty">Нет данных</div>';
        return;
    }

    let html = '';
    for (const name of names) {
        const node = tree[name];
        let parts = [`<strong>${escapeHtml(name)}</strong> ${node.sex === 'M' ? '♂' : '♀'}`];
        if (node.partners.length) parts.push(`❤️ ${node.partners.map(escapeHtml).join(', ')}`);
        if (node.children.length) parts.push(`👶 ${node.children.map(escapeHtml).join(', ')}`);
        if (node.parents.length) parts.push(`👤 родители: ${node.parents.map(escapeHtml).join(', ')}`);
        html += `<div class="bc-tree-node">${parts.join(' | ')}</div>`;
    }
    el.innerHTML = html;
}

// ========================
// ПОЛНЫЙ REBUILD
// ========================
export function rebuild() {
    populateCharSelects();
    renderDashboard();
    renderCharList();
    renderCycle();
    renderPregnancy();
    renderHealth();
    renderAuSettings();
    renderProfileList();
    renderRelList();
    renderBabyList();
    renderFamilyTree();
}
