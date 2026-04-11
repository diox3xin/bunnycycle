/**
 * BunnyCycle v3.0 — Менеджер детей
 */

import { makeId, randomFrom } from '../utils/helpers.js';

const MILESTONES = [
    { day: 1, label: 'Рождение' }, { day: 7, label: 'Пуповина отпала' },
    { day: 14, label: 'Первая улыбка' }, { day: 30, label: 'Держит голову' },
    { day: 60, label: 'Следит глазами' }, { day: 90, label: 'Гулит, смеётся' },
    { day: 120, label: 'Переворачивается' }, { day: 150, label: 'Хватает игрушки' },
    { day: 180, label: 'Сидит с поддержкой' }, { day: 210, label: 'Ползает' },
    { day: 270, label: 'Стоит у опоры' }, { day: 300, label: 'Первые слова' },
    { day: 365, label: 'Первые шаги' }, { day: 540, label: 'Бегает' },
    { day: 730, label: 'Говорит фразами' }
];

const WEIGHT_CURVE = [
    [0, 3200], [7, 3100], [14, 3300], [30, 4200], [60, 5500],
    [90, 6400], [120, 7000], [180, 7700], [270, 8500],
    [365, 9500], [540, 11000], [730, 12500]
];

export class BabyManager {
    constructor(baby) { this.b = baby; }

    get ageDays() { return this.b.ageDays || 0; }

    get ageLabel() {
        const d = this.ageDays;
        if (d < 7) return `${d} дн.`;
        if (d < 30) return `${Math.floor(d / 7)} нед.`;
        if (d < 365) return `${Math.floor(d / 30)} мес.`;
        const years = Math.floor(d / 365);
        const months = Math.floor((d % 365) / 30);
        return months > 0 ? `${years} г. ${months} мес.` : `${years} г.`;
    }

    get milestones() {
        return MILESTONES.filter(m => this.ageDays >= m.day).map(m => m.label);
    }

    get nextMilestone() {
        return MILESTONES.find(m => this.ageDays < m.day) || null;
    }

    get expectedWeight() {
        let prev = WEIGHT_CURVE[0];
        for (const point of WEIGHT_CURVE) {
            if (this.ageDays >= point[0]) prev = point;
            else break;
        }
        return prev[1];
    }

    get ageEmoji() {
        const d = this.ageDays;
        if (d < 30) return '👶';
        if (d < 180) return '🍼';
        if (d < 365) return '🧒';
        return '👦';
    }

    advance(days) {
        this.b.ageDays = (this.b.ageDays || 0) + days;
        this.b.currentWeight = this.expectedWeight + Math.floor(Math.random() * 400 - 200);
    }

    update() {
        this.b.currentWeight = this.expectedWeight + Math.floor(Math.random() * 400 - 200);
    }

    static generate(motherProfile, fatherName, overrides = {}) {
        const sex = overrides.sex || (Math.random() < 0.5 ? 'M' : 'F');

        // Наследование внешности
        let eyeColor = overrides.eyeColor || '';
        let hairColor = overrides.hairColor || '';
        if (!eyeColor && motherProfile?.eyeColor) eyeColor = motherProfile.eyeColor;
        if (!hairColor && motherProfile?.hairColor) hairColor = motherProfile.hairColor;

        return {
            id: makeId(),
            name: overrides.name || '',
            sex,
            mother: motherProfile?.name || '?',
            father: fatherName || '?',
            birthDate: new Date().toISOString(),
            ageDays: 0,
            birthWeight: 2800 + Math.floor(Math.random() * 1200),
            currentWeight: 3200,
            eyeColor,
            hairColor,
            race: motherProfile?.race || 'human',
            secondarySex: null,
            healthy: true,
            notes: ''
        };
    }

    toPromptData() {
        return {
            name: this.b.name || '?',
            sex: this.b.sex === 'M' ? 'мальчик' : 'девочка',
            age: this.ageLabel,
            weight: `${this.b.currentWeight}г`,
            milestones: this.milestones.slice(-3),
            nextMilestone: this.nextMilestone?.label || '—'
        };
    }
}
