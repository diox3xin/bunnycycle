/**
 * BunnyCycle v3.0 — Движок беременности
 */

import { getSettings } from './stateManager.js';
import { randomFrom } from '../utils/helpers.js';

export const PREG_COMPLICATIONS = [
    'Преэклампсия', 'Гестационный диабет', 'Предлежание плаценты',
    'Многоводие', 'Маловодие', 'Тонус матки', 'Анемия',
    'Тяжёлый токсикоз', 'Угроза преждевременных родов', 'ЗВУР',
    'Резус-конфликт', 'Истмико-цервикальная недостаточность',
    'Отёки', 'Гипертонус', 'Низкая плацентация'
];

const SIZE_MAP = [
    [4, 'маковое зерно', '🌰'], [8, 'малина', '🫐'], [12, 'лайм', '🍋'],
    [16, 'авокадо', '🥑'], [20, 'банан', '🍌'], [24, 'кукуруза', '🌽'],
    [28, 'баклажан', '🍆'], [32, 'ананас', '🍍'], [36, 'дыня', '🍈'],
    [40, 'арбуз', '🍉']
];

const SYMPTOM_MAP = [
    { from: 4, to: 14, symptoms: ['тошнота', 'усталость', 'чувствительность к запахам'] },
    { from: 6, to: 12, symptoms: ['утренняя рвота'] },
    { from: 10, to: 40, symptoms: ['частое мочеиспускание'] },
    { from: 14, to: 40, symptoms: ['рост живота'] },
    { from: 16, to: 22, symptoms: ['первые шевеления (бабочки)'] },
    { from: 18, to: 40, symptoms: ['шевеления плода'] },
    { from: 20, to: 40, symptoms: ['боль в пояснице'] },
    { from: 24, to: 40, symptoms: ['изжога'] },
    { from: 28, to: 40, symptoms: ['одышка', 'отёки ног'] },
    { from: 32, to: 40, symptoms: ['тренировочные схватки'] },
    { from: 36, to: 40, symptoms: ['давление на таз', 'усиление выделений'] },
    { from: 38, to: 40, symptoms: ['опущение живота', 'предвестники родов'] },
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
        return ['', 'Первый триместр', 'Второй триместр', 'Третий триместр'][this.trimester];
    }

    get progress() {
        return Math.round((this.pr.week / this.pr.maxWeeks) * 100);
    }

    get size() {
        let result = { name: 'эмбрион', emoji: '🫧' };
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
        // Влияние здоровья
        if (this.p.health) {
            if (this.p.health.stress > 50) result.push('тревожность');
            if (this.p.health.immunity < 40) result.push('частые простуды');
            if (this.p.health.energy < 30) result.push('сильная слабость');
        }
        // Осложнения добавляют симптомы
        if (this.pr.complications.includes('Тяжёлый токсикоз')) result.push('неукротимая рвота');
        if (this.pr.complications.includes('Преэклампсия')) result.push('головная боль', 'мушки перед глазами');
        if (this.pr.complications.includes('Анемия')) result.push('бледность', 'головокружение');
        return [...new Set(result)];
    }

    get movements() {
        const w = this.pr.week;
        if (w < 16) return { label: 'нет', emoji: '—', intensity: 0 };
        if (w < 22) return { label: 'бабочки', emoji: '🦋', intensity: 1 };
        if (w < 28) return { label: 'толчки', emoji: '👋', intensity: 2 };
        if (w < 36) return { label: 'активные', emoji: '🤸', intensity: 3 };
        return { label: 'сильные, реже', emoji: '💪', intensity: 2 };
    }

    get bellySize() {
        const w = this.pr.week;
        if (w < 12) return 'незаметен';
        if (w < 16) return 'чуть округлился';
        if (w < 20) return 'заметен в облегающем';
        if (w < 28) return 'явно виден';
        if (w < 36) return 'большой';
        return 'огромный';
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

        // Определяем срок
        let maxWeeks = 40;
        if (s.modules.auOverlay) {
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

        // Выключаем цикл
        if (this.p.cycle) this.p.cycle.enabled = false;

        // Влияние на здоровье
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

        // Авто-осложнения с шансом
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

    // Для промпта
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
