/**
 * BunnyCycle v3.0 вЂ” Р”РІРёР¶РѕРє Р±РµСЂРµРјРµРЅРЅРѕСЃС‚Рё
 */

import { getSettings } from './stateManager.js';
import { randomFrom } from '../utils/helpers.js';

export const PREG_COMPLICATIONS = [
    'РџСЂРµСЌРєР»Р°РјРїСЃРёСЏ', 'Р“РµСЃС‚Р°С†РёРѕРЅРЅС‹Р№ РґРёР°Р±РµС‚', 'РџСЂРµРґР»РµР¶Р°РЅРёРµ РїР»Р°С†РµРЅС‚С‹',
    'РњРЅРѕРіРѕРІРѕРґРёРµ', 'РњР°Р»РѕРІРѕРґРёРµ', 'РўРѕРЅСѓСЃ РјР°С‚РєРё', 'РђРЅРµРјРёСЏ',
    'РўСЏР¶С‘Р»С‹Р№ С‚РѕРєСЃРёРєРѕР·', 'РЈРіСЂРѕР·Р° РїСЂРµР¶РґРµРІСЂРµРјРµРЅРЅС‹С… СЂРѕРґРѕРІ', 'Р—Р’РЈР ',
    'Р РµР·СѓСЃ-РєРѕРЅС„Р»РёРєС‚', 'РСЃС‚РјРёРєРѕ-С†РµСЂРІРёРєР°Р»СЊРЅР°СЏ РЅРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕСЃС‚СЊ',
    'РћС‚С‘РєРё', 'Р“РёРїРµСЂС‚РѕРЅСѓСЃ', 'РќРёР·РєР°СЏ РїР»Р°С†РµРЅС‚Р°С†РёСЏ'
];

const SIZE_MAP = [
    [4, 'РјР°РєРѕРІРѕРµ Р·РµСЂРЅРѕ', 'рџЊ°'], [8, 'РјР°Р»РёРЅР°', 'рџ«ђ'], [12, 'Р»Р°Р№Рј', 'рџЌ‹'],
    [16, 'Р°РІРѕРєР°РґРѕ', 'рџҐ‘'], [20, 'Р±Р°РЅР°РЅ', 'рџЌЊ'], [24, 'РєСѓРєСѓСЂСѓР·Р°', 'рџЊЅ'],
    [28, 'Р±Р°РєР»Р°Р¶Р°РЅ', 'рџЌ†'], [32, 'Р°РЅР°РЅР°СЃ', 'рџЌЌ'], [36, 'РґС‹РЅСЏ', 'рџЌ€'],
    [40, 'Р°СЂР±СѓР·', 'рџЌ‰']
];

const SYMPTOM_MAP = [
    { from: 4, to: 14, symptoms: ['С‚РѕС€РЅРѕС‚Р°', 'СѓСЃС‚Р°Р»РѕСЃС‚СЊ', 'С‡СѓРІСЃС‚РІРёС‚РµР»СЊРЅРѕСЃС‚СЊ Рє Р·Р°РїР°С…Р°Рј'] },
    { from: 6, to: 12, symptoms: ['СѓС‚СЂРµРЅРЅСЏСЏ СЂРІРѕС‚Р°'] },
    { from: 10, to: 40, symptoms: ['С‡Р°СЃС‚РѕРµ РјРѕС‡РµРёСЃРїСѓСЃРєР°РЅРёРµ'] },
    { from: 14, to: 40, symptoms: ['СЂРѕСЃС‚ Р¶РёРІРѕС‚Р°'] },
    { from: 16, to: 22, symptoms: ['РїРµСЂРІС‹Рµ С€РµРІРµР»РµРЅРёСЏ (Р±Р°Р±РѕС‡РєРё)'] },
    { from: 18, to: 40, symptoms: ['С€РµРІРµР»РµРЅРёСЏ РїР»РѕРґР°'] },
    { from: 20, to: 40, symptoms: ['Р±РѕР»СЊ РІ РїРѕСЏСЃРЅРёС†Рµ'] },
    { from: 24, to: 40, symptoms: ['РёР·Р¶РѕРіР°'] },
    { from: 28, to: 40, symptoms: ['РѕРґС‹С€РєР°', 'РѕС‚С‘РєРё РЅРѕРі'] },
    { from: 32, to: 40, symptoms: ['С‚СЂРµРЅРёСЂРѕРІРѕС‡РЅС‹Рµ СЃС…РІР°С‚РєРё'] },
    { from: 36, to: 40, symptoms: ['РґР°РІР»РµРЅРёРµ РЅР° С‚Р°Р·', 'СѓСЃРёР»РµРЅРёРµ РІС‹РґРµР»РµРЅРёР№'] },
    { from: 38, to: 40, symptoms: ['РѕРїСѓС‰РµРЅРёРµ Р¶РёРІРѕС‚Р°', 'РїСЂРµРґРІРµСЃС‚РЅРёРєРё СЂРѕРґРѕРІ'] },
];

export class PregnancyEngine {
    constructor(profile) {
        this.p = profile;
        this.pr = profile.pregnancy;
    }

    get isActive() { return this.pr?.active; }

    get trimester() {
        if (this.pr.week <= 12) return 1;
        if (this.pr.week <= 27) return 2;
        return 3;
    }

    get trimesterLabel() {
        return ['', 'РџРµСЂРІС‹Р№ С‚СЂРёРјРµСЃС‚СЂ', 'Р’С‚РѕСЂРѕР№ С‚СЂРёРјРµСЃС‚СЂ', 'РўСЂРµС‚РёР№ С‚СЂРёРјРµСЃС‚СЂ'][this.trimester];
    }

    get progress() {
        return Math.round((this.pr.week / this.pr.maxWeeks) * 100);
    }

    get size() {
        let result = { name: 'СЌРјР±СЂРёРѕРЅ', emoji: 'рџ«§' };
        for (const [week, name, emoji] of SIZE_MAP) {
            if (this.pr.week >= week) result = { name, emoji };
        }
        return result;
    }

    get symptoms() {
        const w = this.pr.week;
        const result = [];
        for (const entry of SYMPTOM_MAP) {
            if (w >= entry.from && w <= entry.to) {
                result.push(...entry.symptoms);
            }
        }
        // Р’Р»РёСЏРЅРёРµ Р·РґРѕСЂРѕРІСЊСЏ
        if (this.p.health) {
            if (this.p.health.stress > 50) result.push('С‚СЂРµРІРѕР¶РЅРѕСЃС‚СЊ');
            if (this.p.health.immunity < 40) result.push('С‡Р°СЃС‚С‹Рµ РїСЂРѕСЃС‚СѓРґС‹');
            if (this.p.health.energy < 30) result.push('СЃРёР»СЊРЅР°СЏ СЃР»Р°Р±РѕСЃС‚СЊ');
        }
        // РћСЃР»РѕР¶РЅРµРЅРёСЏ РґРѕР±Р°РІР»СЏСЋС‚ СЃРёРјРїС‚РѕРјС‹
        if (this.pr.complications.includes('РўСЏР¶С‘Р»С‹Р№ С‚РѕРєСЃРёРєРѕР·')) result.push('РЅРµСѓРєСЂРѕС‚РёРјР°СЏ СЂРІРѕС‚Р°');
        if (this.pr.complications.includes('РџСЂРµСЌРєР»Р°РјРїСЃРёСЏ')) result.push('РіРѕР»РѕРІРЅР°СЏ Р±РѕР»СЊ', 'РјСѓС€РєРё РїРµСЂРµРґ РіР»Р°Р·Р°РјРё');
        if (this.pr.complications.includes('РђРЅРµРјРёСЏ')) result.push('Р±Р»РµРґРЅРѕСЃС‚СЊ', 'РіРѕР»РѕРІРѕРєСЂСѓР¶РµРЅРёРµ');
        return [...new Set(result)];
    }

    get movements() {
        const w = this.pr.week;
        if (w < 16) return { label: 'РЅРµС‚', emoji: 'вЂ”', intensity: 0 };
        if (w < 22) return { label: 'Р±Р°Р±РѕС‡РєРё', emoji: 'рџ¦‹', intensity: 1 };
        if (w < 28) return { label: 'С‚РѕР»С‡РєРё', emoji: 'рџ‘‹', intensity: 2 };
        if (w < 36) return { label: 'Р°РєС‚РёРІРЅС‹Рµ', emoji: 'рџ¤ё', intensity: 3 };
        return { label: 'СЃРёР»СЊРЅС‹Рµ, СЂРµР¶Рµ', emoji: 'рџ’Є', intensity: 2 };
    }

    get bellySize() {
        const w = this.pr.week;
        if (w < 12) return 'РЅРµР·Р°РјРµС‚РµРЅ';
        if (w < 16) return 'С‡СѓС‚СЊ РѕРєСЂСѓРіР»РёР»СЃСЏ';
        if (w < 20) return 'Р·Р°РјРµС‚РµРЅ РІ РѕР±Р»РµРіР°СЋС‰РµРј';
        if (w < 28) return 'СЏРІРЅРѕ РІРёРґРµРЅ';
        if (w < 36) return 'Р±РѕР»СЊС€РѕР№';
        return 'РѕРіСЂРѕРјРЅС‹Р№';
    }

    get weightGainEstimate() {
        const w = this.pr.week;
        const base = this.pr.fetusCount > 1 ? 1.5 : 1;
        if (w < 12) return Math.round(w * 0.1 * base * 10) / 10;
        if (w < 28) return Math.round((1 + (w - 12) * 0.4) * base * 10) / 10;
        return Math.round((7 + (w - 28) * 0.5) * base * 10) / 10;
    }

    get isHighRisk() {
        return this.pr.complications.length > 0 || this.pr.fetusCount > 1 ||
            this.p.pregnancyDifficulty === 'hard' ||
            (this.p.health && (this.p.health.immunity < 40 || this.p.health.stress > 70));
    }

    get dueDate() {
        return this.pr.maxWeeks - this.pr.week;
    }

    start(father, count, sexes, startWeek) {
        const s = getSettings();
        this.pr.active = true;
        this.pr.week = startWeek || 1;
        this.pr.day = 0;
        this.pr.father = father || '?';

        let baseCount = count || 1;
        if (s.modules.auOverlay && s.auPreset === 'omegaverse' && !count &&
            Math.random() < (s.auSettings.omegaverse.twinChance || 0)) {
            baseCount = 2;
        }
        this.pr.fetusCount = baseCount;
        this.pr.fetusSexes = [];
        for (let i = 0; i < this.pr.fetusCount; i++) {
            this.pr.fetusSexes.push(sexes?.[i] || (Math.random() < 0.5 ? 'M' : 'F'));
        }
        this.pr.complications = [];
        this.pr.weightGain = 0;

        // РћРїСЂРµРґРµР»СЏРµРј СЃСЂРѕРє
        let maxWeeks = this.p._pregMaxWeeks || 40;
        if (!this.p._pregMaxWeeks && s.modules.auOverlay) {
            if (s.auPreset === 'omegaverse') maxWeeks = s.auSettings.omegaverse.pregnancyWeeks || 36;
            if (s.auPreset === 'fantasy') {
                const rw = s.auSettings.fantasy.pregnancyByRace[this.p.race];
                if (rw) maxWeeks = rw;
                if (s.auSettings.fantasy.acceleratedPregnancy) {
                    maxWeeks = Math.max(4, Math.round(maxWeeks / (s.auSettings.fantasy.accelerationFactor || 1)));
                }
            }
        }
        this.pr.maxWeeks = maxWeeks;

        // Р’С‹РєР»СЋС‡Р°РµРј С†РёРєР»
        if (this.p.cycle) this.p.cycle.enabled = false;

        // Р’Р»РёСЏРЅРёРµ РЅР° Р·РґРѕСЂРѕРІСЊРµ
        if (this.p.health) {
            this.p.health.energy = Math.max(this.p.health.energy - 10, 20);
        }
    }

    advanceDay(days) {
        if (!this.isActive) return;
        this.pr.day += days;
        while (this.pr.day >= 7) {
            this.pr.day -= 7;
            this.pr.week++;
        }
        this.pr.weightGain = this.weightGainEstimate;

        // РђРІС‚Рѕ-РѕСЃР»РѕР¶РЅРµРЅРёСЏ СЃ С€Р°РЅСЃРѕРј
        const s = getSettings();
        if (s.healthSettings.autoGenerateEvents && days >= 7) {
            const chance = s.healthSettings.complicationChance * (this.pr.fetusCount > 1 ? 1.5 : 1);
            if (this.pr.week > 12 && Math.random() < chance * 0.3) {
                this.addRandomComplication();
            }
        }
    }

    addRandomComplication() {
        const available = PREG_COMPLICATIONS.filter(c => !this.pr.complications.includes(c));
        if (!available.length) return null;
        const comp = randomFrom(available);
        this.pr.complications.push(comp);
        return comp;
    }

    removeComplication(comp) {
        this.pr.complications = this.pr.complications.filter(c => c !== comp);
    }

    clearComplications() {
        this.pr.complications = [];
    }

    end() {
        this.pr.active = false;
        this.pr.week = 0;
        this.pr.day = 0;
        this.pr.complications = [];
        if (this.p.cycle) this.p.cycle.enabled = true;
    }

    // Р”Р»СЏ РїСЂРѕРјРїС‚Р°
    toPromptData() {
        return {
            week: this.pr.week,
            maxWeeks: this.pr.maxWeeks,
            trimester: this.trimester,
            size: this.size.name,
            fetusCount: this.pr.fetusCount,
            fetusSexes: this.pr.fetusSexes,
            father: this.pr.father,
            symptoms: this.symptoms,
            movements: this.movements.label,
            belly: this.bellySize,
            complications: this.pr.complications,
            highRisk: this.isHighRisk,
            dueWeeks: this.dueDate
        };
    }
}

