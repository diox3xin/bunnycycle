/**
 * BunnyCycle v3.0 — Менеджер попапов и диалогов
 */

import { getSettings, saveSettings, makeProfile, ensureProfileFields } from '../core/stateManager.js';
import { DISEASE_DATABASE, HealthSystem } from '../core/healthSystem.js';
import { RelationshipManager } from '../core/relationshipManager.js';
import { escapeHtml } from '../utils/helpers.js';

let _popupEl = null;

function getPopupContainer() {
    if (_popupEl) return _popupEl;
    _popupEl = document.createElement('div');
    _popupEl.id = 'bc-popup-overlay';
    _popupEl.className = 'bc-popup-overlay';
    _popupEl.style.display = 'none';
    _popupEl.addEventListener('click', e => { if (e.target === _popupEl) closePopup(); });
    document.body.appendChild(_popupEl);
    return _popupEl;
}

function showPopup(html, options = {}) {
    const container = getPopupContainer();
    container.innerHTML = `
        <div class="bc-popup ${options.wide ? 'bc-popup-wide' : ''}">
            <div class="bc-popup-head">
                <span>${options.title || ''}</span>
                <button class="bc-icon-btn bc-popup-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="bc-popup-body">${html}</div>
        </div>
    `;
    container.style.display = 'flex';
    container.querySelector('.bc-popup-close')?.addEventListener('click', closePopup);
    return container.querySelector('.bc-popup');
}

export function closePopup() {
    const container = getPopupContainer();
    container.style.display = 'none';
    container.innerHTML = '';
}

// ========================
// ДОБАВИТЬ ПЕРСОНАЖА
// ========================
export function showAddCharPopup(onDone) {
    const html = `
        <label class="bc-label">Имя</label>
        <input class="bc-input" id="bc-pop-name" placeholder="Имя персонажа">
        <label class="bc-label">Пол</label>
        <select class="bc-select" id="bc-pop-sex">
            <option value="F">Женский</option>
            <option value="M">Мужской</option>
        </select>
        <label class="bc-checkbox"><input type="checkbox" id="bc-pop-isuser"> Это персонаж игрока</label>
        <div class="bc-btn-group" style="margin-top:12px">
            <button class="bc-btn primary" id="bc-pop-ok">Создать</button>
            <button class="bc-btn" id="bc-pop-cancel">Отмена</button>
        </div>
    `;
    const popup = showPopup(html, { title: '➕ Новый персонаж' });
    popup.querySelector('#bc-pop-ok')?.addEventListener('click', () => {
        const name = popup.querySelector('#bc-pop-name')?.value?.trim();
        const sex = popup.querySelector('#bc-pop-sex')?.value;
        const isUser = popup.querySelector('#bc-pop-isuser')?.checked;
        if (!name) return;
        const s = getSettings();
        s.characters[name] = makeProfile(name, isUser, sex);
        saveSettings();
        closePopup();
        if (onDone) onDone();
    });
    popup.querySelector('#bc-pop-cancel')?.addEventListener('click', closePopup);
}

// ========================
// ДОБАВИТЬ БОЛЕЗНЬ
// ========================
export function showAddDiseasePopup(charName, onDone) {
    const allDiseases = Object.entries(DISEASE_DATABASE).map(([cat, list]) =>
        list.map(d => ({ ...d, category: cat }))
    ).flat();

    const options = allDiseases.map(d =>
        `<option value="${d.id}">[${d.category}] ${d.label} (${d.severity})</option>`
    ).join('');

    const html = `
        <label class="bc-label">Болезнь из базы</label>
        <select class="bc-select" id="bc-pop-disease">${options}</select>
        <label class="bc-label" style="margin-top:8px">— или своя —</label>
        <input class="bc-input" id="bc-pop-custom-label" placeholder="Название">
        <select class="bc-select" id="bc-pop-custom-sev">
            <option value="mild">Лёгкая</option>
            <option value="moderate">Средняя</option>
            <option value="severe">Тяжёлая</option>
            <option value="critical">Критическая</option>
        </select>
        <input class="bc-input" id="bc-pop-custom-note" placeholder="Заметка (опционально)">
        <div class="bc-btn-group" style="margin-top:12px">
            <button class="bc-btn primary" id="bc-pop-add-db">Из базы</button>
            <button class="bc-btn" id="bc-pop-add-custom">Свою</button>
        </div>
    `;
    const popup = showPopup(html, { title: `🦠 Добавить болезнь — ${escapeHtml(charName)}` });

    popup.querySelector('#bc-pop-add-db')?.addEventListener('click', () => {
        const id = popup.querySelector('#bc-pop-disease')?.value;
        if (!id) return;
        const s = getSettings();
        const p = s.characters[charName];
        if (p) { new HealthSystem(p).addCondition(id); saveSettings(); }
        closePopup();
        if (onDone) onDone();
    });

    popup.querySelector('#bc-pop-add-custom')?.addEventListener('click', () => {
        const label = popup.querySelector('#bc-pop-custom-label')?.value?.trim();
        const sev = popup.querySelector('#bc-pop-custom-sev')?.value;
        const note = popup.querySelector('#bc-pop-custom-note')?.value?.trim();
        if (!label) return;
        const s = getSettings();
        const p = s.characters[charName];
        if (p) { new HealthSystem(p).addCustomCondition(label, sev, note); saveSettings(); }
        closePopup();
        if (onDone) onDone();
    });
}

// ========================
// ДОБАВИТЬ ТРАВМУ
// ========================
export function showAddInjuryPopup(charName, onDone) {
    const injuries = DISEASE_DATABASE.injuries || [];
    const options = injuries.map(i => `<option value="${i.id}">${i.label} (${i.severity})</option>`).join('');
    const locations = ['голова', 'лицо', 'шея', 'грудь', 'живот', 'спина', 'правая рука', 'левая рука', 'правая нога', 'левая нога', 'таз', 'плечо', 'колено', 'запястье'];

    const html = `
        <label class="bc-label">Тип</label>
        <select class="bc-select" id="bc-pop-inj-type">${options}<option value="custom">Свой...</option></select>
        <input class="bc-input" id="bc-pop-inj-custom" placeholder="Свой тип (если выбрано «Свой»)" style="display:none">
        <label class="bc-label">Локация</label>
        <select class="bc-select" id="bc-pop-inj-loc">${locations.map(l => `<option value="${l}">${l}</option>`).join('')}</select>
        <label class="bc-label">Тяжесть</label>
        <select class="bc-select" id="bc-pop-inj-sev">
            <option value="mild">Лёгкая</option>
            <option value="moderate">Средняя</option>
            <option value="severe">Тяжёлая</option>
        </select>
        <label class="bc-checkbox"><input type="checkbox" id="bc-pop-inj-bleed"> Кровотечение</label>
        <div class="bc-btn-group" style="margin-top:12px">
            <button class="bc-btn primary" id="bc-pop-inj-ok">Добавить</button>
        </div>
    `;
    const popup = showPopup(html, { title: `🩹 Добавить травму — ${escapeHtml(charName)}` });

    popup.querySelector('#bc-pop-inj-type')?.addEventListener('change', e => {
        const custom = popup.querySelector('#bc-pop-inj-custom');
        if (custom) custom.style.display = e.target.value === 'custom' ? '' : 'none';
    });

    popup.querySelector('#bc-pop-inj-ok')?.addEventListener('click', () => {
        let type = popup.querySelector('#bc-pop-inj-type')?.value;
        if (type === 'custom') type = popup.querySelector('#bc-pop-inj-custom')?.value?.trim() || 'custom';
        const loc = popup.querySelector('#bc-pop-inj-loc')?.value;
        const sev = popup.querySelector('#bc-pop-inj-sev')?.value;
        const bleed = popup.querySelector('#bc-pop-inj-bleed')?.checked;

        const s = getSettings();
        const p = s.characters[charName];
        if (p) { new HealthSystem(p).addInjury(type, loc, sev, { bleeding: bleed }); saveSettings(); }
        closePopup();
        if (onDone) onDone();
    });
}

// ========================
// ДОБАВИТЬ ЛЕКАРСТВО
// ========================
export function showAddMedPopup(charName, onDone) {
    const html = `
        <label class="bc-label">Название</label>
        <input class="bc-input" id="bc-pop-med-name" placeholder="Ибупрофен, антибиотик, зелье...">
        <label class="bc-label">Эффект</label>
        <input class="bc-input" id="bc-pop-med-effect" placeholder="обезболивание, антибиотик...">
        <label class="bc-label">Дней приёма</label>
        <input class="bc-input" id="bc-pop-med-days" type="number" value="7" min="1">
        <div class="bc-btn-group" style="margin-top:12px">
            <button class="bc-btn primary" id="bc-pop-med-ok">Добавить</button>
        </div>
    `;
    const popup = showPopup(html, { title: `💊 Лекарство — ${escapeHtml(charName)}` });

    popup.querySelector('#bc-pop-med-ok')?.addEventListener('click', () => {
        const name = popup.querySelector('#bc-pop-med-name')?.value?.trim();
        const effect = popup.querySelector('#bc-pop-med-effect')?.value?.trim();
        const days = parseInt(popup.querySelector('#bc-pop-med-days')?.value) || 7;
        if (!name) return;

        const s = getSettings();
        const p = s.characters[charName];
        if (p) { new HealthSystem(p).addMedication(name, effect, days); saveSettings(); }
        closePopup();
        if (onDone) onDone();
    });
}

// ========================
// ДОБАВИТЬ ОТНОШЕНИЯ
// ========================
export function showAddRelPopup(onDone) {
    const s = getSettings();
    const names = Object.keys(s.characters);
    const options = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    const types = RelationshipManager.getTypes();
    const typeOptions = types.map(t => `<option value="${t}">${t}</option>`).join('');

    const html = `
        <div class="bc-row">
            <select class="bc-select" id="bc-pop-rel1">${options}</select>
            <span>↔</span>
            <select class="bc-select" id="bc-pop-rel2">${options}</select>
        </div>
        <label class="bc-label">Тип</label>
        <select class="bc-select" id="bc-pop-rel-type">${typeOptions}</select>
        <label class="bc-label">Заметка</label>
        <input class="bc-input" id="bc-pop-rel-note" placeholder="">
        <div class="bc-btn-group" style="margin-top:12px">
            <button class="bc-btn primary" id="bc-pop-rel-ok">Добавить</button>
        </div>
    `;
    const popup = showPopup(html, { title: '❤️ Добавить отношения' });

    popup.querySelector('#bc-pop-rel-ok')?.addEventListener('click', () => {
        const c1 = popup.querySelector('#bc-pop-rel1')?.value;
        const c2 = popup.querySelector('#bc-pop-rel2')?.value;
        const type = popup.querySelector('#bc-pop-rel-type')?.value;
        const note = popup.querySelector('#bc-pop-rel-note')?.value?.trim();
        if (c1 && c2) { RelationshipManager.add(c1, c2, type, note); }
        closePopup();
        if (onDone) onDone();
    });
}

// ========================
// РЕЗУЛЬТАТ БРОСКА КУБИКА
// ========================
export function showDiceResult(result) {
    const html = `
        <div class="bc-dice-result ${result.result ? 'bc-dice-success' : 'bc-dice-miss'}">
            <div class="bc-dice-big">${result.result ? '🎯' : '🎲'}</div>
            <div class="bc-dice-roll">${result.roll} / ${result.chance}</div>
            <div class="bc-dice-outcome">${result.result ? '✨ ЗАЧАТИЕ!' : 'Мимо...'}</div>
            <div class="bc-dice-detail">
                Цель: ${escapeHtml(result.target || '?')}<br>
                Тип: ${result.type} | Эякуляция: ${result.ejac}
            </div>
        </div>
    `;
    showPopup(html, { title: '🎲 Бросок кубика зачатия' });
}

// ========================
// НАЧАТЬ БЕРЕМЕННОСТЬ
// ========================
export function showStartPregPopup(charName, onDone) {
    const s = getSettings();
    const names = Object.keys(s.characters).filter(n => n !== charName);
    const fatherOptions = names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('') +
        '<option value="?">Неизвестный</option>';

    const html = `
        <label class="bc-label">Отец</label>
        <select class="bc-select" id="bc-pop-preg-father">${fatherOptions}</select>
        <label class="bc-label">Количество плодов</label>
        <input class="bc-input" id="bc-pop-preg-count" type="number" value="1" min="1" max="4">
        <label class="bc-label">Неделя (начать с)</label>
        <input class="bc-input" id="bc-pop-preg-week" type="number" value="1" min="1" max="40">
        <div class="bc-btn-group" style="margin-top:12px">
            <button class="bc-btn primary" id="bc-pop-preg-ok">Начать</button>
        </div>
    `;
    const popup = showPopup(html, { title: `🤰 Беременность — ${escapeHtml(charName)}` });

    popup.querySelector('#bc-pop-preg-ok')?.addEventListener('click', () => {
        const father = popup.querySelector('#bc-pop-preg-father')?.value;
        const count = parseInt(popup.querySelector('#bc-pop-preg-count')?.value) || 1;
        const week = parseInt(popup.querySelector('#bc-pop-preg-week')?.value) || 1;
        closePopup();
        if (onDone) onDone({ father, count, week });
    });
}

// ========================
// ПОДТВЕРЖДЕНИЕ
// ========================
export function showConfirm(text, onOk) {
    const html = `
        <p>${text}</p>
        <div class="bc-btn-group" style="margin-top:12px">
            <button class="bc-btn primary" id="bc-pop-yes">Да</button>
            <button class="bc-btn" id="bc-pop-no">Нет</button>
        </div>
    `;
    const popup = showPopup(html, { title: '❓ Подтверждение' });
    popup.querySelector('#bc-pop-yes')?.addEventListener('click', () => { closePopup(); if (onOk) onOk(); });
    popup.querySelector('#bc-pop-no')?.addEventListener('click', closePopup);
}
