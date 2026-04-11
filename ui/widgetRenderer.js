/**
 * BunnyCycle v3.0 — Виджет в сообщениях
 */

import { getSettings, ensureProfileFields, canGetPregnant } from '../core/stateManager.js';
import { CycleEngine } from '../core/cycleEngine.js';
import { PregnancyEngine } from '../core/pregnancyEngine.js';
import { HealthSystem } from '../core/healthSystem.js';
import { formatDate, escapeHtml } from '../utils/helpers.js';

export function renderWidget(msgId) {
    const s = getSettings();
    if (!s.enabled || !s.showStatusWidget) return '';

    const chars = Object.keys(s.characters);
    if (!chars.length) return '';

    const date = formatDate(s.worldDate);
    let summaryParts = [];
    let charCards = '';
    let events = '';

    for (const name of chars) {
        const p = s.characters[name];
        if (!p._enabled) continue;
        ensureProfileFields(p);

        const ce = new CycleEngine(p);
        const hs = new HealthSystem(p);
        const status = hs.overallStatus;

        // Мини-карточка
        let mini = `<div class="bc-wchar">`;
        mini += `<span class="bc-wchar-name">${escapeHtml(name)}</span>`;

        if (p.pregnancy?.active) {
            const pe = new PregnancyEngine(p);
            mini += `<span class="bc-wchar-badge bc-badge-preg">${pe.size.emoji} ${pe.pr.week}нед</span>`;
            summaryParts.push(`${name}: 🤰${pe.pr.week}нед`);
        } else if (p.cycle?.enabled) {
            const miniCal = ce.getMiniCalendar();
            mini += '<span class="bc-wchar-minical">';
            for (const d of miniCal) {
                const cls = d.isToday ? 'bc-mc-today' : '';
                const phClass = `bc-mc-${d.phase}`;
                mini += `<span class="bc-mc-dot ${cls} ${phClass}"></span>`;
            }
            mini += '</span>';
            mini += `<span class="bc-wchar-badge" style="background:${ce.phaseColor}">${ce.phaseEmoji}</span>`;
        }

        // Здоровье в мини
        if (status.level !== 'good') {
            mini += `<span class="bc-wchar-badge" style="background:${status.color}">${status.emoji}</span>`;
        }

        // Настроение
        if (p.mood?.current && p.mood.current !== 'neutral') {
            const moodEmoji = { happy: '😊', sad: '😢', angry: '😠', scared: '😨', aroused: '🥵', exhausted: '😩', in_pain: '🤕' };
            mini += `<span class="bc-wchar-badge">${moodEmoji[p.mood.current] || '😐'}</span>`;
        }

        if (p.labor?.active) {
            mini += `<span class="bc-wchar-badge bc-badge-labor">🏥</span>`;
            summaryParts.push(`${name}: 🏥РОДЫ`);
        }

        if (p.heat?.active) mini += `<span class="bc-wchar-badge bc-badge-heat">🔥</span>`;
        if (p.rut?.active) mini += `<span class="bc-wchar-badge bc-badge-heat">🔥</span>`;

        mini += '</div>';
        charCards += mini;
    }

    // События
    const diceLog = (s.diceLog || []).slice(-3);
    if (diceLog.length) {
        events += diceLog.map(e =>
            `<div class="bc-wevent ${e.result ? 'bc-wsuccess' : ''}">${e.result ? '🎯' : '🎲'} ${escapeHtml(e.target)}: ${e.roll}/${e.chance}</div>`
        ).join('');
    }

    const summary = summaryParts.length ? summaryParts.join(' | ') : `${chars.length} перс.`;

    return `
        <div class="bc-widget" data-msg-id="${msgId || ''}">
            <div class="bc-widget-header">
                <span class="bc-widget-icon">🐰</span>
                <span class="bc-widget-date">${date}</span>
                <span class="bc-widget-divider">|</span>
                <span class="bc-widget-summary">${escapeHtml(summary)}</span>
                <button class="bc-widget-toggle" title="Развернуть"><i class="fa-solid fa-chevron-down"></i></button>
            </div>
            <div class="bc-widget-body" style="display:none;">
                <div class="bc-widget-chars">${charCards}</div>
                ${events ? `<div class="bc-widget-events">${events}</div>` : ''}
            </div>
        </div>
    `;
}

export function attachWidgetListeners() {
    document.addEventListener('click', e => {
        const toggle = e.target.closest('.bc-widget-toggle');
        if (toggle) {
            const widget = toggle.closest('.bc-widget');
            if (widget) {
                const body = widget.querySelector('.bc-widget-body');
                const icon = toggle.querySelector('i');
                if (body) {
                    const visible = body.style.display !== 'none';
                    body.style.display = visible ? 'none' : '';
                    if (icon) {
                        icon.className = visible ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
                    }
                }
            }
        }
    });
}

export function injectWidgets() {
    const s = getSettings();
    if (!s.enabled || !s.showStatusWidget) return;

    const messages = document.querySelectorAll('.mes[mesid]');
    for (const msg of messages) {
        if (msg.querySelector('.bc-widget')) continue;

        const mesId = msg.getAttribute('mesid');
        const textEl = msg.querySelector('.mes_text');
        if (!textEl) continue;

        // Только для последнего сообщения (или всегда если showWidgetAlways)
        if (!s.showWidgetAlways) {
            const allMes = document.querySelectorAll('.mes[mesid]');
            const lastMes = allMes[allMes.length - 1];
            if (msg !== lastMes) continue;
        }

        const widget = renderWidget(mesId);
        if (widget) {
            const div = document.createElement('div');
            div.innerHTML = widget;
            textEl.insertAdjacentElement('afterend', div.firstElementChild);
        }
    }
}
