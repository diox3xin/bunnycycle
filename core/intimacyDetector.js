/**
 * BunnyCycle v3.0 — Детектор интимности + кубик зачатия
 */

import { getSettings, canGetPregnant } from './stateManager.js';
import { CycleEngine } from './cycleEngine.js';
import { roll100, makeId } from '../utils/helpers.js';

// ========================
// ДЕТЕКТОР СЕКСА В ТЕКСТЕ
// ========================

const EXPLICIT_PATTERNS = [
    /вош[её]л\s*в\s*(неё|нее|него)/i,
    /вошла\s*в\s*(неё|нее|него)/i,
    /проник\w*\s*(в\s*(неё|нее|него))?/i,
    /толч[оо]к\w*/i,
    /фрикци\w*/i,
    /внутр[ьи]\s*(неё|нее|него)/i,
    /кончи[лт]\w*/i,
    /оргаз\w*/i,
    /стон\w+/i,
    /трахн?\w*/i,
    /секс\w*/i,
    /совокупл\w*/i,
    /половой\s*акт/i,
    /занял\w*\s*(?:с\s*ней|с\s*ним)\s*любовь/i,
    /вагин\w*/i,
    /пенис\w*/i,
    /член\w*\s*(?:вош[её]л|проник|внутри)/i,
    /насади\w*/i,
    /сперм\w*/i,
    /семя\w*\s*(?:внутр|вну|глуб)/i,
    /эякул\w*/i,
    /излился\s*внутр/i,
];

const CONTEXT_PATTERNS = [
    /сним\w*\s*(?:одежд|труси|юбк|штан|бель)/i,
    /раздел\w*/i,
    /обнаж[её]н\w*/i,
    /наг[оа]\w*/i,
    /лежал\w*\s*(?:под|на|рядом)/i,
    /бёдра\s*(?:раздвин|развел|обхватил)/i,
    /ноги\s*(?:раздвин|развел|обхватил|обвил)/i,
    /поцелу\w*\s*(?:ниже|живот|грудь|шею|бедр)/i,
    /стону\w*|стон\w*|охну\w*/i,
];

const EJAC_INSIDE = [
    /кончи\w*\s*(?:в\s*(?:неё|нее|него)|внутр)/i,
    /излился?\s*внутр/i,
    /спусти\w*\s*внутр/i,
    /семя\w*\s*(?:внутр|заполн|хлын)/i,
    /сперм\w*\s*(?:внутр|заполн|хлын|потекл|горяч)/i,
    /наполни\w*\s*(?:собой|семенем)/i,
    /(?:горяч|тёпл)\w*\s*(?:внутри|наполн)/i,
    /без\s*(?:презерватив|защит)/i,
];

const EJAC_OUTSIDE = [
    /кончи\w*\s*(?:на\s|снаружи)/i,
    /выта[шщ]и\w*\s*(?:из|перед)/i,
    /вытащи\w*\s*(?:в\s*последн)/i,
    /успел\s*выта[шщ]ить/i,
    /презерватив/i,
];

const CONDOM_PATTERNS = [
    /презерватив\w*/i,
    /надел\w*\s*(?:на\s*)?(?:резинк|кондом|защит)/i,
];

const NO_CONDOM = [
    /без\s*(?:презерватив|резинк|защит)/i,
    /снял\s*презерватив/i,
    /(?:сорвал|порвал)\s*(?:презерватив|резинк)/i,
];

const TYPE_ANAL = [
    /анал\w*/i,
    /в\s*(?:задн|попу|зад)/i,
];

const TYPE_ORAL = [
    /в\s*рот/i,
    /минет\w*/i,
    /фелляци\w*/i,
    /оральн\w*/i,
    /сос[ёе]\w*\s*(?:член|пенис)/i,
];

export const SexDetector = {
    detect(text, characters) {
        const s = getSettings();
        const minScore = s.sexDetectMinScore || 2;

        let score = 0;
        for (const p of EXPLICIT_PATTERNS) {
            if (p.test(text)) score += 2;
        }
        for (const p of CONTEXT_PATTERNS) {
            if (p.test(text)) score += 1;
        }

        if (score < minScore) {
            return { detected: false, score, minScore, reason: 'low_score' };
        }

        // Тип контакта
        let type = 'vaginal';
        for (const p of TYPE_ANAL) { if (p.test(text)) { type = 'anal'; break; } }
        for (const p of TYPE_ORAL) { if (p.test(text)) { type = 'oral'; break; } }

        // Эякуляция
        let ejac = 'unknown';
        for (const p of EJAC_INSIDE) { if (p.test(text)) { ejac = 'inside'; break; } }
        for (const p of EJAC_OUTSIDE) { if (p.test(text)) { ejac = 'outside'; break; } }

        // Презерватив
        let condom = false;
        let noCondom = false;
        for (const p of CONDOM_PATTERNS) { if (p.test(text)) condom = true; }
        for (const p of NO_CONDOM) { if (p.test(text)) noCondom = true; }

        // Определяем участников
        const charNames = Object.keys(characters || {});
        const participants = charNames.filter(n => text.includes(n));

        // Кто может забеременеть?
        let target = null;
        for (const name of participants) {
            const p = characters[name];
            if (p && canGetPregnant(p)) { target = name; break; }
        }

        return {
            detected: true, score, minScore, type, ejac,
            condom, noCondom,
            participants, target
        };
    }
};

// ========================
// КУБИК ЗАЧАТИЯ
// ========================
export const ConceptionDice = {
    roll(targetName, data, characters) {
        const s = getSettings();
        const p = characters[targetName];
        if (!p || !canGetPregnant(p)) {
            return { reason: 'not_eligible', result: false };
        }

        // Базовый шанс из фертильности
        const ce = new CycleEngine(p);
        let chance = Math.round(ce.fertility * 100);

        // Контрацепция
        const contraMap = { condom: 0.05, pill: 0.03, iud: 0.01, withdrawal: 0.2, none: 1 };
        const contraFactor = contraMap[p.contraception] || 1;

        // Детекция презерватива из текста
        if (data.condom && !data.noCondom) chance = Math.round(chance * 0.05);
        else chance = Math.round(chance * contraFactor);

        // Модификаторы
        if (data.ejac === 'outside') chance = Math.round(chance * 0.1);
        if (data.ejac === 'inside') chance = Math.round(chance * 1.2);
        if (data.type === 'anal' || data.type === 'oral') chance = 0;

        // Здоровье влияет на зачатие
        if (p.health) {
            if (p.health.stress > 70) chance = Math.round(chance * 0.7);
            if (p.health.immunity < 30) chance = Math.round(chance * 0.8);
        }

        // Минимум / максимум
        chance = Math.max(1, Math.min(95, chance));

        const rollVal = roll100();
        const result = rollVal <= chance;

        // Логируем
        const entry = {
            ts: new Date().toLocaleString('ru'),
            target: targetName,
            roll: rollVal,
            chance,
            result,
            type: data.type || 'vaginal',
            ejac: data.ejac || 'unknown',
            auto: data.auto || false,
            parts: data.parts || []
        };
        if (!s.diceLog) s.diceLog = [];
        s.diceLog.push(entry);
        if (s.diceLog.length > 100) s.diceLog = s.diceLog.slice(-100);

        return { ...entry, reason: 'rolled' };
    }
};

// ========================
// ЛОГ ИНТИМНОСТИ
// ========================
export const IntimacyLog = {
    add(data) {
        const s = getSettings();
        if (!s.intimacyLog) s.intimacyLog = [];
        s.intimacyLog.push({
            ts: new Date().toLocaleString('ru'),
            parts: data.parts || [],
            type: data.type || 'vaginal',
            ejac: data.ejac || 'unknown',
            auto: data.auto || false
        });
        if (s.intimacyLog.length > 100) s.intimacyLog = s.intimacyLog.slice(-100);
    }
};
