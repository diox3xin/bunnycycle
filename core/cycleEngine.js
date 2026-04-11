/**
 * BunnyCycle v3.0 — Движок менструального цикла
 */

import { getSettings } from './stateManager.js';
import { clamp } from '../utils/helpers.js';

export class CycleEngine {
    constructor(profile) {
        this.p = profile;
        this.c = profile.cycle;
    }

    get phase() {
        if (!this.c || !this.c.enabled) return 'unknown';
        const d = this.c.currentDay;
        const ovDay = Math.round(this.c.length - 14);
        if (d <= this.c.menstruationDuration) return 'menstruation';
        if (d < ovDay - 2) return 'follicular';
        if (d <= ovDay + 1) return 'ovulation';
        return 'luteal';
    }

    get phaseLabel() {
        return {
            menstruation: 'Менструация', follicular: 'Фолликулярная',
            ovulation: 'Овуляция', luteal: 'Лютеиновая', unknown: '—'
        }[this.phase] || this.phase;
    }

    get phaseEmoji() {
        return {
            menstruation: '🔴', follicular: '🌸',
            ovulation: '🥚', luteal: '🌙'
        }[this.phase] || '❓';
    }

    get phaseColor() {
        return {
            menstruation: '#ff6478', follicular: '#c88cff',
            ovulation: '#64dc8c', luteal: '#f0c850'
        }[this.phase] || '#888';
    }

    get fertility() {
        const base = {
            ovulation: 0.25, follicular: 0.08, luteal: 0.02, menstruation: 0.01
        }[this.phase] || 0.05;

        const s = getSettings();
        let fert = base;

        // Бонус от течки (омегаверс)
        if (s.modules.auOverlay && s.auPreset === 'omegaverse' &&
            this.p.heat?.active) {
            fert += s.auSettings.omegaverse.heatFertilityBonus;
        }

        // Влияние здоровья на фертильность
        if (this.p.health) {
            if (this.p.health.stress > 70) fert *= 0.7;
            if (this.p.health.energy < 30) fert *= 0.8;
            if (this.p.health.immunity < 40) fert *= 0.85;
        }

        return Math.min(fert, 0.95);
    }

    get fertilityLevel() {
        const f = this.fertility;
        if (f >= 0.2) return 'peak';
        if (f >= 0.1) return 'high';
        if (f >= 0.05) return 'medium';
        return 'low';
    }

    get libido() {
        if (this.p.heat?.active || this.p.rut?.active) return 'экстремальное';
        if (this.p.health?.pain > 60) return 'отсутствует';
        if (this.p.health?.energy < 20) return 'отсутствует';
        return {
            ovulation: 'высокое', follicular: 'среднее',
            luteal: 'низкое', menstruation: 'низкое'
        }[this.phase] || 'среднее';
    }

    get symptoms() {
        const ph = this.phase;
        const r = [];
        if (ph === 'menstruation') { r.push('кровотечение', 'спазмы'); }
        if (ph === 'ovulation') r.push('повышенное либидо');
        if (ph === 'luteal') r.push('ПМС', 'чувствительность груди');
        if (ph === 'follicular') r.push('прилив энергии');

        // Влияние здоровья на симптомы
        if (this.p.health) {
            if (this.p.health.stress > 60 && ph === 'luteal') r.push('раздражительность');
            if (this.p.health.immunity < 50 && ph === 'menstruation') r.push('слабость');
        }
        return r;
    }

    get discharge() {
        return {
            menstruation: 'менструальные', follicular: 'скудные',
            ovulation: 'обильные, тягучие', luteal: 'густые, кремообразные'
        }[this.phase] || 'обычные';
    }

    get ovulationDay() {
        return Math.round(this.c.length - 14);
    }

    get daysToOvulation() {
        const ov = this.ovulationDay;
        if (this.c.currentDay <= ov) return ov - this.c.currentDay;
        return this.c.length - this.c.currentDay + ov;
    }

    get daysToMenstruation() {
        if (this.c.currentDay <= this.c.length) return this.c.length - this.c.currentDay + 1;
        return 0;
    }

    advance(days) {
        for (let i = 0; i < days; i++) {
            this.c.currentDay++;
            if (this.c.currentDay > this.c.length) {
                this.c.currentDay = 1;
                this.c.cycleCount++;
                if (this.c.irregularity > 0) {
                    this.c.length = clamp(
                        this.c.baseLength + Math.floor(Math.random() * this.c.irregularity * 2) - this.c.irregularity,
                        21, 45
                    );
                }
            }
        }
    }

    setDay(d) {
        this.c.currentDay = clamp(d, 1, this.c.length);
    }

    setPhase(ph) {
        const ovDay = this.ovulationDay;
        const map = {
            menstruation: 1,
            follicular: this.c.menstruationDuration + 1,
            ovulation: ovDay,
            luteal: ovDay + 2
        };
        if (map[ph]) this.c.currentDay = map[ph];
    }

    // Для виджета — мини-календарь ±3 дня
    getMiniCalendar() {
        const days = [];
        const ovDay = this.ovulationDay;
        for (let offset = -3; offset <= 3; offset++) {
            let d = this.c.currentDay + offset;
            if (d < 1) d += this.c.length;
            if (d > this.c.length) d -= this.c.length;

            let phase;
            if (d <= this.c.menstruationDuration) phase = 'mens';
            else if (d < ovDay - 2) phase = 'foll';
            else if (d <= ovDay + 1) phase = 'ovul';
            else phase = 'lut';

            days.push({ day: d, phase, isToday: offset === 0 });
        }
        return days;
    }

    // Полный календарь цикла
    getFullCalendar() {
        const days = [];
        const ovDay = this.ovulationDay;
        for (let d = 1; d <= this.c.length; d++) {
            let phase;
            if (d <= this.c.menstruationDuration) phase = 'mens';
            else if (d < ovDay - 2) phase = 'foll';
            else if (d <= ovDay + 1) phase = 'ovul';
            else phase = 'lut';
            days.push({ day: d, phase, isToday: d === this.c.currentDay });
        }
        return days;
    }

    // Данные для промпта
    toPromptData() {
        return {
            day: this.c.currentDay,
            length: this.c.length,
            phase: this.phaseLabel,
            fertility: Math.round(this.fertility * 100),
            libido: this.libido,
            symptoms: this.symptoms,
            discharge: this.discharge
        };
    }
}
