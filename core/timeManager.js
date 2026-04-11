/**
 * BunnyCycle v3.0 — Менеджер времени мира
 */

import { getSettings, saveSettings } from './stateManager.js';
import { addDaysToDate, clamp } from '../utils/helpers.js';
import { CycleEngine } from './cycleEngine.js';
import { PregnancyEngine } from './pregnancyEngine.js';
import { HealthSystem } from './healthSystem.js';
import { HeatRutEngine, BondEngine } from './auEngine.js';
import { BabyManager } from './babyManager.js';

// ========================
// ПАРСИНГ ВРЕМЕНИ ИЗ ТЕКСТА
// ========================
const TIME_PATTERNS = [
    { re: /прошл[оа]\s*(\d+)\s*дн/i, unit: 'days' },
    { re: /(\d+)\s*дн\w*\s*спустя/i, unit: 'days' },
    { re: /на\s*следующ\w+\s*день/i, unit: 'days', fixed: 1 },
    { re: /через\s*(\d+)\s*дн/i, unit: 'days' },
    { re: /через\s*(\d+)\s*недел/i, unit: 'weeks' },
    { re: /(\d+)\s*недел\w*\s*спустя/i, unit: 'weeks' },
    { re: /через\s*(\d+)\s*месяц/i, unit: 'months' },
    { re: /(\d+)\s*месяц\w*\s*спустя/i, unit: 'months' },
    { re: /на\s*следующ\w+\s*утр/i, unit: 'days', fixed: 1 },
    { re: /через\s*пару\s*дней/i, unit: 'days', fixed: 2 },
    { re: /через\s*несколько\s*дней/i, unit: 'days', fixed: 3 },
    { re: /через\s*пару\s*недель/i, unit: 'weeks', fixed: 2 },
    { re: /(?:вечер|утро|ночь)\s*(?:следующего|того\s*же)\s*дня/i, unit: 'days', fixed: 0 },
    { re: /(?:спустя|через)\s*час/i, unit: 'hours', fixed: 1 },
    { re: /через\s*(\d+)\s*час/i, unit: 'hours' },
];

export const TimeManager = {
    parse(text) {
        for (const pat of TIME_PATTERNS) {
            const match = text.match(pat.re);
            if (match) {
                let val = pat.fixed !== undefined ? pat.fixed : parseInt(match[1]) || 1;
                let days = 0;
                if (pat.unit === 'days') days = val;
                else if (pat.unit === 'weeks') days = val * 7;
                else if (pat.unit === 'months') days = val * 30;
                else if (pat.unit === 'hours') days = val >= 12 ? 1 : 0;
                if (days > 0) return { days, source: match[0] };
            }
        }
        return null;
    },

    apply(timeDelta) {
        const s = getSettings();
        if (s.worldDate.frozen || !timeDelta) return;

        const days = timeDelta.days || 0;
        if (days <= 0) return;

        // Двигаем дату
        const newDate = addDaysToDate(s.worldDate, days);
        s.worldDate.year = newDate.year;
        s.worldDate.month = newDate.month;
        s.worldDate.day = newDate.day;
        s.worldDate.hour = newDate.hour;
        s.worldDate.minute = newDate.minute;

        // Прогрессируем всех персонажей
        const chars = s.characters;
        for (const name of Object.keys(chars)) {
            const p = chars[name];
            if (!p._enabled) continue;

            // Цикл
            if (s.modules.cycle && p.cycle?.enabled && !(p.pregnancy?.active)) {
                new CycleEngine(p).advance(days);
            }

            // Беременность
            if (s.modules.pregnancy && p.pregnancy?.active) {
                new PregnancyEngine(p).advanceDay(days);
            }

            // Здоровье
            if (s.modules.health && p.health) {
                new HealthSystem(p).advance(days);
            }

            // AU: heat/rut, bond
            if (s.modules.auOverlay && s.auPreset === 'omegaverse') {
                if (p.secondarySex) new HeatRutEngine(p).advance(days);
                if (p.bond) new BondEngine(p).advance(days);
            }

            // Дети
            if (s.modules.baby && p.babies?.length) {
                for (const baby of p.babies) {
                    new BabyManager(baby).advance(days);
                }
            }
        }

        saveSettings();
    },

    setDate(year, month, day, hour) {
        const s = getSettings();
        s.worldDate.year = year || s.worldDate.year;
        s.worldDate.month = clamp(month || s.worldDate.month, 1, 12);
        s.worldDate.day = clamp(day || s.worldDate.day, 1, 31);
        s.worldDate.hour = clamp(hour ?? s.worldDate.hour, 0, 23);
        saveSettings();
    },

    toggleFreeze() {
        const s = getSettings();
        s.worldDate.frozen = !s.worldDate.frozen;
        saveSettings();
    }
};
