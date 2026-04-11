/**
 * BunnyCycle v3.0 — Движок родов
 */

import { randomFrom } from '../utils/helpers.js';

export const LABOR_STAGES = ['latent', 'active', 'transition', 'pushing', 'birth', 'placenta'];

export const LABOR_LABELS = {
    latent: 'Латентная фаза', active: 'Активная фаза',
    transition: 'Переходная фаза', pushing: 'Потуги',
    birth: 'Рождение', placenta: 'Выход плаценты'
};

export const LABOR_DESCRIPTIONS = {
    latent: 'Лёгкие нерегулярные схватки, раскрытие 0–3 см. Можно ходить, дышать, отвлекаться.',
    active: 'Схватки сильнее и чаще (каждые 3–5 мин). Раскрытие 4–7 см. Боль нарастает.',
    transition: 'Пик интенсивности. Схватки каждые 1–2 мин. Раскрытие 7–10 см. Тремор, тошнота, паника.',
    pushing: 'Полное раскрытие. Непреодолимые потуги. Давление и жжение.',
    birth: 'Головка прорезывается. Рождение ребёнка.',
    placenta: 'Мягкие схватки. Выход плаценты. Облегчение.'
};

export const LABOR_COMPLICATIONS = [
    'Слабость родовой деятельности', 'Стремительные роды',
    'Разрыв промежности', 'Кровотечение', 'Обвитие пуповиной',
    'Дистоция плечиков', 'Гипоксия плода', 'Отслойка плаценты',
    'Выпадение пуповины', 'Разрыв матки', 'Эмболия', 'Задержка плаценты'
];

export class LaborEngine {
    constructor(profile) {
        this.p = profile;
        this.l = profile.labor;
    }

    get isActive() { return this.l?.active; }

    get stageIndex() { return LABOR_STAGES.indexOf(this.l.stage); }
    get stageLabel() { return LABOR_LABELS[this.l.stage] || ''; }
    get stageDescription() { return LABOR_DESCRIPTIONS[this.l.stage] || ''; }

    get dilationProgress() { return Math.round((this.l.dilation / 10) * 100); }

    get painLevel() {
        const idx = this.stageIndex;
        if (idx <= 0) return 'умеренная';
        if (idx === 1) return 'сильная';
        if (idx === 2) return 'невыносимая';
        if (idx === 3) return 'невыносимая + давление';
        if (idx === 4) return 'жжение + облегчение';
        return 'умеренная';
    }

    get contractionInfo() {
        const stage = this.l.stage;
        if (stage === 'latent') return { interval: '10–20 мин', duration: '30–45 сек' };
        if (stage === 'active') return { interval: '3–5 мин', duration: '45–60 сек' };
        if (stage === 'transition') return { interval: '1–2 мин', duration: '60–90 сек' };
        if (stage === 'pushing') return { interval: 'непрерывно', duration: 'потуги' };
        return { interval: '—', duration: '—' };
    }

    get isComplete() {
        return this.l.babiesDelivered >= this.l.totalBabies && this.l.stage === 'placenta';
    }

    start() {
        this.l.active = true;
        this.l.stage = 'latent';
        this.l.dilation = 0;
        this.l.hoursElapsed = 0;
        this.l.babiesDelivered = 0;
        this.l.totalBabies = this.p.pregnancy?.fetusCount || 1;
        this.l.complications = [];

        // Влияние на здоровье
        if (this.p.health) {
            this.p.health.pain = 40;
            this.p.health.energy = Math.max(this.p.health.energy - 20, 10);
            this.p.health.stress = Math.min(this.p.health.stress + 30, 100);
        }
    }

    advance() {
        const idx = this.stageIndex;
        if (idx >= LABOR_STAGES.length - 1) return;

        this.l.stage = LABOR_STAGES[idx + 1];

        switch (this.l.stage) {
            case 'active':
                this.l.dilation = 5;
                this.l.hoursElapsed += 4 + Math.floor(Math.random() * 4);
                break;
            case 'transition':
                this.l.dilation = 8;
                this.l.hoursElapsed += 1 + Math.floor(Math.random() * 2);
                break;
            case 'pushing':
                this.l.dilation = 10;
                this.l.hoursElapsed += 1;
                break;
            case 'birth':
                this.l.hoursElapsed += Math.random() < 0.5 ? 1 : 0;
                break;
            case 'placenta':
                this.l.hoursElapsed += 0.5;
                break;
        }

        // Обновляем здоровье
        if (this.p.health) {
            const painMap = { latent: 30, active: 55, transition: 80, pushing: 90, birth: 70, placenta: 30 };
            this.p.health.pain = painMap[this.l.stage] || 50;
            this.p.health.energy = Math.max(this.p.health.energy - 10, 5);
        }
    }

    deliver() {
        this.l.babiesDelivered++;
        if (this.l.babiesDelivered >= this.l.totalBabies) {
            this.l.stage = 'placenta';
        }
    }

    end() {
        this.l.active = false;
        if (this.p.pregnancy) {
            this.p.pregnancy.active = false;
        }
        if (this.p.cycle) {
            this.p.cycle.enabled = true;
            this.p.cycle.currentDay = 1;
        }
        // Послеродовое состояние
        if (this.p.health) {
            this.p.health.pain = 25;
            this.p.health.energy = 20;
            this.p.health.bloodLoss = Math.min(this.p.health.bloodLoss + 15, 100);
            this.p.mood = { current: 'exhausted', intensity: 'strong' };
        }
    }

    addRandomComplication() {
        const available = LABOR_COMPLICATIONS.filter(c => !this.l.complications.includes(c));
        if (!available.length) return null;
        const comp = randomFrom(available);
        this.l.complications.push(comp);

        // Осложнения влияют на здоровье
        if (this.p.health) {
            if (comp === 'Кровотечение') this.p.health.bloodLoss = Math.min(this.p.health.bloodLoss + 30, 100);
            if (comp === 'Гипоксия плода') this.p.health.stress = Math.min(this.p.health.stress + 20, 100);
        }
        return comp;
    }

    removeComplication(comp) {
        this.l.complications = this.l.complications.filter(c => c !== comp);
    }

    clearComplications() { this.l.complications = []; }

    toPromptData() {
        return {
            stage: this.stageLabel,
            dilation: this.l.dilation,
            hours: this.l.hoursElapsed,
            contractions: this.contractionInfo,
            pain: this.painLevel,
            delivered: this.l.babiesDelivered,
            total: this.l.totalBabies,
            complications: this.l.complications,
            description: this.stageDescription
        };
    }
}
