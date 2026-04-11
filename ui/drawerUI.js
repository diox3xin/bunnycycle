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
        ${pe.pr.complications.length ? `<div class="bc-stat-row"><span class="bc-stat-label">⚠ Осложнения</span><span class="bc-stat-value bc-danger-text">${pe.pr.complications.join(', ')}</span></div>` : ''}
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
        ${le.l.complications.length ? `<div class="bc-stat-row"><span class="bc-stat-label">⚠ Осложнения</span><span class="bc-stat-value bc-danger-text">${le.l.complications.join(', ')}</span></div>` : ''}
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
// ПОЛНЫЙ REBUILD
// ========================
export function rebuild() {
    populateCharSelects();
    renderDashboard();
    renderCharList();
    renderCycle();
    renderPregnancy();
    renderHealth();
}
