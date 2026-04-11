/**
 * BunnyCycle v3.0 — AU движок (Omegaverse, Fantasy, Oviposition, Bond)
 */

import { getSettings } from './stateManager.js';
import { clamp, randomFrom } from '../utils/helpers.js';

// ========================
// HEAT / RUT MANAGER
// ========================
export class HeatRutEngine {
    constructor(profile) {
        this.p = profile;
    }

    // --- HEAT (Omega) ---

    get heatPhase() {
        if (!this.p.heat) return 'none';
        if (this.p.heat.active) {
            const d = this.p.heat.currentDay;
            const dur = this.p.heat.duration;
            const s = getSettings().auSettings.omegaverse;
            if (d <= (s.preHeatDays || 1)) return 'pre_heat';
            if (d > dur - (s.postHeatDays || 1)) return 'post_heat';
            return 'peak_heat';
        }
        return 'none';
    }

    get heatLabel() {
        return { none: 'Нет течки', pre_heat: 'Предтечка', peak_heat: 'Пик течки', post_heat: 'Посттечка' }[this.heatPhase] || '—';
    }

    get heatDaysLeft() {
        if (this.p.heat.active) return 0;
        const s = getSettings().auSettings.omegaverse;
        const cycleDays = s.heatCycleLength || 30;
        return Math.max(0, cycleDays - (this.p.heat.daysSinceLast || 0));
    }

    triggerHeat() {
        this.p.heat.active = true;
        this.p.heat.currentDay = 1;
        this.p.heat.intensity = getSettings().auSettings.omegaverse.heatIntensity || 'moderate';
    }

    endHeat() {
        this.p.heat.active = false;
        this.p.heat.currentDay = 0;
        this.p.heat.daysSinceLast = 0;
    }

    toggleSuppressants() {
        this.p.heat.onSuppressants = !this.p.heat.onSuppressants;
    }

    // --- RUT (Alpha) ---

    get rutPhase() {
        if (!this.p.rut) return 'none';
        if (this.p.rut.active) {
            const d = this.p.rut.currentDay;
            const s = getSettings().auSettings.omegaverse;
            if (d <= (s.preRutDays || 1)) return 'pre_rut';
            if (d > this.p.rut.duration - (s.postRutDays || 1)) return 'post_rut';
            return 'peak_rut';
        }
        return 'none';
    }

    get rutLabel() {
        return { none: 'Нет гона', pre_rut: 'Предгон', peak_rut: 'Пик гона', post_rut: 'Постгон' }[this.rutPhase] || '—';
    }

    get rutDaysLeft() {
        if (this.p.rut.active) return 0;
        const s = getSettings().auSettings.omegaverse;
        return Math.max(0, (s.rutCycleLength || 35) - (this.p.rut.daysSinceLast || 0));
    }

    triggerRut() {
        this.p.rut.active = true;
        this.p.rut.currentDay = 1;
        this.p.rut.intensity = getSettings().auSettings.omegaverse.rutIntensity || 'moderate';
    }

    endRut() {
        this.p.rut.active = false;
        this.p.rut.currentDay = 0;
        this.p.rut.daysSinceLast = 0;
    }

    // --- Advance ---

    advance(days) {
        const s = getSettings().auSettings.omegaverse;

        for (let i = 0; i < days; i++) {
            // Heat
            if (this.p.heat) {
                if (this.p.heat.active) {
                    this.p.heat.currentDay++;
                    if (this.p.heat.currentDay > (s.heatDuration || 5)) {
                        this.endHeat();
                    }
                } else {
                    this.p.heat.daysSinceLast = (this.p.heat.daysSinceLast || 0) + 1;
                    if (!this.p.heat.onSuppressants && this.p.heat.daysSinceLast >= (s.heatCycleLength || 30)) {
                        this.triggerHeat();
                    }
                }
            }

            // Rut
            if (this.p.rut) {
                if (this.p.rut.active) {
                    this.p.rut.currentDay++;
                    if (this.p.rut.currentDay > (s.rutDuration || 4)) {
                        this.endRut();
                    }
                } else {
                    this.p.rut.daysSinceLast = (this.p.rut.daysSinceLast || 0) + 1;
                    if (this.p.rut.daysSinceLast >= (s.rutCycleLength || 35)) {
                        this.triggerRut();
                    }
                }
            }
        }
    }

    toPromptData() {
        const data = {};
        if (this.p.secondarySex === 'omega' && this.p.heat) {
            data.heat = {
                active: this.p.heat.active,
                phase: this.heatLabel,
                day: this.p.heat.currentDay,
                duration: this.p.heat.duration,
                intensity: this.p.heat.intensity,
                suppressants: this.p.heat.onSuppressants,
                daysLeft: this.heatDaysLeft
            };
        }
        if (this.p.secondarySex === 'alpha' && this.p.rut) {
            data.rut = {
                active: this.p.rut.active,
                phase: this.rutLabel,
                day: this.p.rut.currentDay,
                duration: this.p.rut.duration,
                daysLeft: this.rutDaysLeft
            };
        }
        return data;
    }
}

// ========================
// BOND MANAGER
// ========================
export class BondEngine {
    constructor(profile) {
        this.p = profile;
        this.b = profile.bond;
    }

    get isBonded() { return this.b?.bonded; }

    get statusLabel() {
        if (!this.b) return 'Нет связи';
        if (this.b.withdrawalActive) return `💔 Ломка (день ${this.b.daysSinceSeparation})`;
        if (this.b.bonded) return `💞 Связь: ${this.b.partner} (${this.b.strength}%)`;
        return 'Нет связи';
    }

    get effects() {
        const s = getSettings().auSettings.omegaverse;
        const eff = [];
        if (!this.b?.bonded) return eff;
        if (s.bondEffectEmpathy) eff.push('эмпатия');
        if (s.bondEffectProximity) eff.push('тяга к партнёру');
        if (s.bondEffectProtective) eff.push('защитный инстинкт');
        if (this.b.withdrawalActive) eff.push('ломка', 'тревога', 'боль');
        return eff;
    }

    canBond() {
        const s = getSettings().auSettings.omegaverse;
        return s.bondingEnabled && !this.b.bonded;
    }

    createBond(partnerName) {
        this.b.bonded = true;
        this.b.partner = partnerName;
        this.b.type = getSettings().auSettings.omegaverse.bondingType || 'bite';
        this.b.strength = 100;
        this.b.withdrawalActive = false;
        this.b.daysSinceSeparation = 0;
    }

    breakBond() {
        const s = getSettings().auSettings.omegaverse;
        if (!s.bondBreakable && this.b.bonded) return false;
        this.b.bonded = false;
        this.b.partner = null;
        this.b.withdrawalActive = true;
        this.b.daysSinceSeparation = 0;
        return true;
    }

    advance(days) {
        if (this.b.withdrawalActive) {
            this.b.daysSinceSeparation += days;
            const s = getSettings().auSettings.omegaverse;
            if (this.b.daysSinceSeparation >= (s.bondWithdrawalDays || 7)) {
                this.b.withdrawalActive = false;
            }
        }
    }
}

// ========================
// OVIPOSITION ENGINE
// ========================
export class OviEngine {
    constructor(profile) {
        this.p = profile;
        this.o = profile.oviposition;
    }

    get isActive() { return this.o?.active; }

    get phaseLabel() {
        if (!this.o) return '';
        return { gestation: 'Гестация', laying: 'Кладка', incubation: 'Инкубация', hatching: 'Вылупление' }[this.o.phase] || '';
    }

    get progress() {
        if (!this.o?.active) return 0;
        const s = getSettings().auSettings.oviposition;
        const total = (s.gestationDays || 14) + (s.layingDuration || 3) + (s.incubationDays || 21);
        return Math.round((this.o.daysActive / total) * 100);
    }

    startCarrying() {
        const s = getSettings().auSettings.oviposition;
        const count = (s.eggCountMin || 1) + Math.floor(Math.random() * ((s.eggCountMax || 6) - (s.eggCountMin || 1) + 1));
        const fertilized = Math.round(count * (s.fertilizationChance || 0.7));

        this.p.oviposition = {
            active: true,
            phase: 'gestation',
            daysActive: 0,
            eggCount: count,
            fertilizedCount: fertilized,
            laid: false
        };
        this.o = this.p.oviposition;
    }

    advance(days) {
        if (!this.isActive) return;
        const s = getSettings().auSettings.oviposition;

        this.o.daysActive += days;

        if (this.o.phase === 'gestation' && this.o.daysActive >= (s.gestationDays || 14)) {
            this.o.phase = 'laying';
        }
        if (this.o.phase === 'laying' && this.o.daysActive >= (s.gestationDays || 14) + (s.layingDuration || 3)) {
            this.o.phase = 'incubation';
            this.o.laid = true;
        }
        if (this.o.phase === 'incubation' && this.o.daysActive >= (s.gestationDays || 14) + (s.layingDuration || 3) + (s.incubationDays || 21)) {
            this.o.phase = 'hatching';
        }
    }

    end() {
        this.p.oviposition = { active: false, phase: null, daysActive: 0, eggCount: 0, fertilizedCount: 0, laid: false };
        this.o = this.p.oviposition;
    }
}
