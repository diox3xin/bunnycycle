/**
 * BunnyCycle v3.0 — Масштабная система здоровья
 * Болезни, травмы, раны, ментальное здоровье, иммунитет, лечение
 */

import { getSettings } from './stateManager.js';
import { makeId, randomFrom, clamp } from '../utils/helpers.js';

// ========================
// БАЗА БОЛЕЗНЕЙ
// ========================
export const DISEASE_DATABASE = {
    // Инфекционные
    infections: [
        { id: 'cold', label: 'Простуда', severity: 'mild', duration: [5, 10], symptoms: ['насморк', 'чихание', 'лёгкая слабость'], treatable: true, contagious: true },
        { id: 'flu', label: 'Грипп', severity: 'moderate', duration: [7, 14], symptoms: ['жар', 'ломота', 'головная боль', 'слабость'], treatable: true, contagious: true },
        { id: 'pneumonia', label: 'Пневмония', severity: 'severe', duration: [14, 30], symptoms: ['кашель', 'высокая температура', 'одышка', 'боль в груди'], treatable: true, contagious: false },
        { id: 'stomach_flu', label: 'Кишечная инфекция', severity: 'moderate', duration: [3, 7], symptoms: ['рвота', 'диарея', 'боль в животе', 'обезвоживание'], treatable: true, contagious: true },
        { id: 'uti', label: 'Цистит', severity: 'mild', duration: [5, 10], symptoms: ['жжение при мочеиспускании', 'частые позывы', 'боль внизу живота'], treatable: true, contagious: false },
        { id: 'tonsillitis', label: 'Ангина', severity: 'moderate', duration: [7, 14], symptoms: ['боль в горле', 'жар', 'отёк миндалин'], treatable: true, contagious: true },
        { id: 'bronchitis', label: 'Бронхит', severity: 'moderate', duration: [10, 21], symptoms: ['кашель', 'мокрота', 'одышка'], treatable: true, contagious: false },
        { id: 'fever_unknown', label: 'Лихорадка неясного генеза', severity: 'moderate', duration: [3, 10], symptoms: ['высокая температура', 'озноб', 'потливость'], treatable: true, contagious: false },
    ],
    // Травмы
    injuries: [
        { id: 'bruise', label: 'Ушиб', severity: 'mild', duration: [3, 7], symptoms: ['синяк', 'припухлость', 'боль при касании'], treatable: true },
        { id: 'sprain', label: 'Растяжение', severity: 'mild', duration: [7, 14], symptoms: ['отёк', 'боль при движении', 'ограничение подвижности'], treatable: true },
        { id: 'cut', label: 'Порез', severity: 'mild', duration: [3, 10], symptoms: ['кровотечение', 'боль', 'риск инфекции'], treatable: true },
        { id: 'fracture', label: 'Перелом', severity: 'severe', duration: [30, 90], symptoms: ['острая боль', 'деформация', 'невозможность двигаться'], treatable: true },
        { id: 'concussion', label: 'Сотрясение мозга', severity: 'moderate', duration: [7, 21], symptoms: ['головная боль', 'тошнота', 'головокружение', 'светобоязнь'], treatable: true },
        { id: 'burn', label: 'Ожог', severity: 'moderate', duration: [10, 30], symptoms: ['покраснение', 'волдыри', 'сильная боль'], treatable: true },
        { id: 'deep_wound', label: 'Глубокая рана', severity: 'severe', duration: [14, 45], symptoms: ['обильное кровотечение', 'риск заражения', 'швы'], treatable: true },
        { id: 'dislocation', label: 'Вывих', severity: 'moderate', duration: [7, 21], symptoms: ['деформация сустава', 'острая боль', 'отёк'], treatable: true },
    ],
    // Хронические
    chronic: [
        { id: 'migraine', label: 'Мигрень', severity: 'moderate', duration: [1, 3], symptoms: ['пульсирующая головная боль', 'светобоязнь', 'тошнота'], treatable: true, recurring: true },
        { id: 'anemia_chronic', label: 'Хроническая анемия', severity: 'mild', duration: [30, 999], symptoms: ['бледность', 'усталость', 'одышка при нагрузке'], treatable: true },
        { id: 'asthma', label: 'Астма', severity: 'moderate', duration: [0, 999], symptoms: ['приступы удушья', 'хрипы', 'кашель'], treatable: true, recurring: true },
        { id: 'allergy_seasonal', label: 'Сезонная аллергия', severity: 'mild', duration: [14, 60], symptoms: ['чихание', 'зуд глаз', 'заложенность'], treatable: true, recurring: true },
    ],
    // Психическое здоровье
    mental: [
        { id: 'panic_attack', label: 'Паническая атака', severity: 'moderate', duration: [0, 1], symptoms: ['тахикардия', 'удушье', 'страх смерти', 'тремор'], treatable: true, recurring: true },
        { id: 'ptsd_episode', label: 'ПТСР (обострение)', severity: 'severe', duration: [7, 30], symptoms: ['флешбэки', 'кошмары', 'избегание', 'гиперреакция'], treatable: true },
        { id: 'depression', label: 'Депрессивный эпизод', severity: 'moderate', duration: [14, 90], symptoms: ['апатия', 'бессонница', 'потеря аппетита', 'тоска'], treatable: true },
        { id: 'anxiety', label: 'Тревожное расстройство', severity: 'mild', duration: [7, 60], symptoms: ['постоянная тревога', 'напряжение', 'бессонница'], treatable: true },
        { id: 'burnout', label: 'Эмоциональное выгорание', severity: 'moderate', duration: [14, 60], symptoms: ['апатия', 'цинизм', 'истощение', 'безразличие'], treatable: true },
        { id: 'postpartum', label: 'Послеродовая депрессия', severity: 'severe', duration: [14, 180], symptoms: ['тоска', 'плаксивость', 'чувство вины', 'отстранённость от ребёнка'], treatable: true },
    ],
    // Отравления и состояния
    conditions: [
        { id: 'food_poison', label: 'Пищевое отравление', severity: 'moderate', duration: [1, 5], symptoms: ['рвота', 'диарея', 'слабость', 'обезвоживание'], treatable: true },
        { id: 'dehydration', label: 'Обезвоживание', severity: 'moderate', duration: [1, 3], symptoms: ['сухость во рту', 'головокружение', 'тёмная моча'], treatable: true },
        { id: 'exhaustion', label: 'Физическое истощение', severity: 'mild', duration: [2, 7], symptoms: ['слабость', 'невозможность двигаться', 'мышечная боль'], treatable: true },
        { id: 'hypothermia', label: 'Переохлаждение', severity: 'severe', duration: [1, 5], symptoms: ['дрожь', 'бледность', 'сонливость', 'замедление сознания'], treatable: true },
        { id: 'heatstroke', label: 'Тепловой удар', severity: 'moderate', duration: [1, 3], symptoms: ['жар', 'спутанность сознания', 'тошнота'], treatable: true },
        { id: 'insomnia', label: 'Бессонница', severity: 'mild', duration: [3, 14], symptoms: ['невозможность уснуть', 'раздражительность', 'снижение концентрации'], treatable: true },
        { id: 'hangover', label: 'Похмелье', severity: 'mild', duration: [1, 2], symptoms: ['головная боль', 'тошнота', 'сухость во рту'], treatable: true },
    ],
    // Женское здоровье
    gynecological: [
        { id: 'endometriosis', label: 'Эндометриоз (обострение)', severity: 'moderate', duration: [3, 14], symptoms: ['сильная боль при менструации', 'хроническая тазовая боль'], treatable: true },
        { id: 'ovarian_cyst', label: 'Киста яичника', severity: 'moderate', duration: [14, 60], symptoms: ['боль внизу живота', 'нарушение цикла', 'вздутие'], treatable: true },
        { id: 'mastitis', label: 'Мастит', severity: 'moderate', duration: [7, 14], symptoms: ['боль в груди', 'покраснение', 'жар', 'озноб'], treatable: true },
        { id: 'thrush', label: 'Молочница', severity: 'mild', duration: [5, 14], symptoms: ['зуд', 'выделения', 'дискомфорт'], treatable: true },
    ]
};

// ========================
// МЕТКИ ТЯЖЕСТИ
// ========================
export const SEVERITY_LABELS = {
    mild: { label: 'Лёгкая', emoji: '🟡', color: '#f0c850' },
    moderate: { label: 'Средняя', emoji: '🟠', color: '#f09040' },
    severe: { label: 'Тяжёлая', emoji: '🔴', color: '#e04050' },
    critical: { label: 'Критическая', emoji: '⛔', color: '#c02030' }
};

export const MENTAL_STATE_LABELS = {
    stable: { label: 'Стабильное', emoji: '😐', color: '#80c080' },
    anxious: { label: 'Тревожное', emoji: '😰', color: '#f0c850' },
    depressed: { label: 'Подавленное', emoji: '😔', color: '#6080a0' },
    euphoric: { label: 'Эйфория', emoji: '🤩', color: '#f080c0' },
    traumatized: { label: 'Травмированное', emoji: '😨', color: '#c04050' },
    numb: { label: 'Оцепенение', emoji: '😶', color: '#808080' },
    angry: { label: 'Злость', emoji: '😠', color: '#e06040' },
    grieving: { label: 'Горе', emoji: '😢', color: '#5060a0' }
};

// ========================
// ДВИЖОК ЗДОРОВЬЯ
// ========================
export class HealthSystem {
    constructor(profile) {
        this.p = profile;
        this.h = profile.health;
    }

    // === СОСТОЯНИЯ ===

    addCondition(diseaseId, overrides = {}) {
        const allDiseases = Object.values(DISEASE_DATABASE).flat();
        const template = allDiseases.find(d => d.id === diseaseId);
        if (!template) return null;

        const dur = template.duration;
        const maxDays = dur[0] + Math.floor(Math.random() * (dur[1] - dur[0] + 1));

        const condition = {
            id: makeId(),
            type: template.id,
            label: overrides.label || template.label,
            severity: overrides.severity || template.severity,
            day: 0,
            maxDays,
            symptoms: [...template.symptoms],
            treatable: template.treatable,
            note: overrides.note || '',
            effects: overrides.effects || [],
            contagious: template.contagious || false,
            recurring: template.recurring || false,
            source: overrides.source || 'auto' // auto / manual / rp_detected
        };

        this.h.conditions.push(condition);
        this._applyConditionEffects(condition);
        return condition;
    }

    addCustomCondition(label, severity, note, category) {
        const condition = {
            id: makeId(),
            type: 'custom',
            label,
            severity: severity || 'mild',
            day: 0,
            maxDays: 999,
            symptoms: [],
            treatable: true,
            note: note || '',
            effects: [],
            contagious: false,
            recurring: false,
            source: 'manual',
            category: category || 'custom'
        };
        this.h.conditions.push(condition);
        return condition;
    }

    removeCondition(condId) {
        const idx = this.h.conditions.findIndex(c => c.id === condId);
        if (idx !== -1) {
            const cond = this.h.conditions[idx];
            this.h.history.push({
                label: cond.label,
                resolvedDate: new Date().toISOString(),
                outcome: 'resolved',
                daysActive: cond.day
            });
            this.h.conditions.splice(idx, 1);
        }
    }

    // === ТРАВМЫ ===

    addInjury(type, location, severity, overrides = {}) {
        const templates = DISEASE_DATABASE.injuries;
        const template = templates.find(t => t.id === type);

        const injury = {
            id: makeId(),
            type: type || 'custom',
            label: overrides.label || template?.label || type,
            location: location || 'тело',
            severity: severity || 'mild',
            day: 0,
            healDays: overrides.healDays || (template ? template.duration[0] + Math.floor(Math.random() * (template.duration[1] - template.duration[0])) : 14),
            scarring: overrides.scarring || (severity === 'severe'),
            bleeding: overrides.bleeding || false,
            infected: false,
            note: overrides.note || ''
        };

        this.h.injuries.push(injury);

        // Влияние на показатели
        const painMap = { mild: 15, moderate: 35, severe: 60 };
        this.h.pain = clamp(this.h.pain + (painMap[severity] || 20), 0, 100);
        if (injury.bleeding) this.h.bloodLoss = clamp(this.h.bloodLoss + 20, 0, 100);

        return injury;
    }

    removeInjury(injuryId) {
        this.h.injuries = this.h.injuries.filter(i => i.id !== injuryId);
    }

    // === ЛЕКАРСТВА ===

    addMedication(name, effect, days, sideEffects = []) {
        const med = {
            id: makeId(),
            name,
            effect,
            daysLeft: days,
            sideEffects,
            startDay: 0
        };
        this.h.medications.push(med);
        return med;
    }

    removeMedication(medId) {
        this.h.medications = this.h.medications.filter(m => m.id !== medId);
    }

    // === ПРОГРЕССИЯ ===

    advance(days) {
        const s = getSettings();

        for (let i = 0; i < days; i++) {
            // Прогрессия болезней
            for (let j = this.h.conditions.length - 1; j >= 0; j--) {
                const c = this.h.conditions[j];
                c.day++;
                if (c.day >= c.maxDays && c.maxDays < 999) {
                    this.h.history.push({ label: c.label, outcome: 'healed', daysActive: c.day });
                    this.h.conditions.splice(j, 1);
                }
            }

            // Прогрессия травм
            for (let j = this.h.injuries.length - 1; j >= 0; j--) {
                const inj = this.h.injuries[j];
                inj.day++;
                // Шанс инфицирования раны
                if (!inj.infected && inj.bleeding && inj.day < 3 && Math.random() < 0.1) {
                    inj.infected = true;
                    inj.healDays += 7;
                }
                if (inj.day >= inj.healDays) {
                    this.h.injuries.splice(j, 1);
                }
            }

            // Прогрессия лекарств
            for (let j = this.h.medications.length - 1; j >= 0; j--) {
                this.h.medications[j].daysLeft--;
                if (this.h.medications[j].daysLeft <= 0) {
                    this.h.medications.splice(j, 1);
                }
            }

            // Восстановление показателей
            const healRate = { slow: 0.5, normal: 1, fast: 2 }[s.healthSettings.healingRate] || 1;
            this.h.pain = clamp(this.h.pain - 3 * healRate, 0, 100);
            this.h.bloodLoss = clamp(this.h.bloodLoss - 2 * healRate, 0, 100);
            this.h.energy = clamp(this.h.energy + 2 * healRate, 0, 100);

            // Стресс медленно снижается если нет активных тяжёлых состояний
            const hasSevere = this.h.conditions.some(c => c.severity === 'severe' || c.severity === 'critical');
            if (!hasSevere) {
                this.h.stress = clamp(this.h.stress - 1, 0, 100);
            }

            // Иммунитет восстанавливается
            if (!this.h.conditions.length && this.h.immunity < 70) {
                this.h.immunity = clamp(this.h.immunity + 1, 0, 100);
            }

            // Случайные болезни
            if (s.healthSettings.autoGenerateEvents && s.modules.health) {
                this._rollRandomDisease();
            }
        }

        // Обновляем ментальное состояние
        this._updateMentalState();
    }

    _applyConditionEffects(cond) {
        if (cond.severity === 'severe' || cond.severity === 'critical') {
            this.h.energy = clamp(this.h.energy - 20, 0, 100);
            this.h.stress = clamp(this.h.stress + 15, 0, 100);
        }
        if (cond.severity === 'moderate') {
            this.h.energy = clamp(this.h.energy - 10, 0, 100);
        }
        // Снижение иммунитета от болезни
        this.h.immunity = clamp(this.h.immunity - 5, 0, 100);
    }

    _rollRandomDisease() {
        const s = getSettings();
        const chance = s.healthSettings.diseaseChance;

        // Базовый шанс 0.08 = ~8% в день (очень мало)
        // Модифицируется иммунитетом и стрессом
        let modifier = 1;
        if (this.h.immunity < 40) modifier += 0.5;
        if (this.h.immunity < 20) modifier += 1;
        if (this.h.stress > 70) modifier += 0.3;
        if (this.h.energy < 20) modifier += 0.3;

        // Беременность повышает уязвимость
        if (this.p.pregnancy?.active) modifier += 0.2;

        // Очень низкий базовый шанс
        if (Math.random() > chance * modifier * 0.01) return;

        // Не добавляем если уже много болезней
        if (this.h.conditions.length >= 3) return;

        // Выбираем категорию
        const categories = ['infections', 'conditions'];
        if (s.healthSettings.enableMentalHealth && this.h.stress > 60) categories.push('mental');
        if (this.p.bioSex === 'F') categories.push('gynecological');

        const cat = randomFrom(categories);
        const diseases = DISEASE_DATABASE[cat];
        if (!diseases?.length) return;

        // Не добавляем дубликаты
        const available = diseases.filter(d => !this.h.conditions.some(c => c.type === d.id));
        if (!available.length) return;

        const disease = randomFrom(available);
        this.addCondition(disease.id, { source: 'auto' });
    }

    _updateMentalState() {
        const stress = this.h.stress;
        const pain = this.h.pain;
        const energy = this.h.energy;

        const hasMentalCond = this.h.conditions.some(c => {
            const template = Object.values(DISEASE_DATABASE).flat().find(d => d.id === c.type);
            return template && DISEASE_DATABASE.mental?.some(m => m.id === c.type);
        });

        if (hasMentalCond) return; // Не перезаписываем если есть конкретный диагноз

        if (stress > 80 && pain > 50) this.h.mentalState = 'traumatized';
        else if (stress > 70) this.h.mentalState = 'anxious';
        else if (energy < 15) this.h.mentalState = 'numb';
        else if (stress > 50 && energy < 30) this.h.mentalState = 'depressed';
        else this.h.mentalState = 'stable';
    }

    // === ГЕНЕРАТОРЫ ===

    generateRandomInjury(context) {
        const templates = DISEASE_DATABASE.injuries;
        const template = randomFrom(templates);
        const locations = ['голова', 'рука', 'нога', 'торс', 'спина', 'плечо', 'колено', 'запястье'];
        return this.addInjury(template.id, randomFrom(locations), template.severity);
    }

    generateContextualDisease(rpContext) {
        // Генерирует болезнь на основе контекста РП
        let pool = [];

        if (/дожд|ливень|мокр|промок|холод|мороз|снег/i.test(rpContext)) {
            pool.push('cold', 'pneumonia', 'hypothermia');
        }
        if (/ед[аоу]|пищ|еда|ресторан|кухн|готов|грязн/i.test(rpContext)) {
            pool.push('food_poison', 'stomach_flu');
        }
        if (/стресс|нервн|переживан|плач|крик|ссор/i.test(rpContext)) {
            pool.push('panic_attack', 'anxiety', 'insomnia', 'migraine');
        }
        if (/драк|удар|пад|упал|столкн|авар/i.test(rpContext)) {
            pool.push('bruise', 'concussion', 'sprain', 'cut');
        }
        if (/жар[аоу]?(?:\s|,|$)|солнц|пустын|зной/i.test(rpContext)) {
            pool.push('heatstroke', 'dehydration');
        }
        if (/алкогол|пьян|выпил|бар|вино|водк/i.test(rpContext)) {
            pool.push('hangover', 'food_poison');
        }
        if (/усталос|не спал|работ.*без.*отды|переутомлен/i.test(rpContext)) {
            pool.push('exhaustion', 'burnout', 'insomnia');
        }
        if (/род(?:ы|ила|ов)|после.*род/i.test(rpContext) && this.p.bioSex === 'F') {
            pool.push('postpartum', 'mastitis');
        }

        if (!pool.length) pool = ['cold', 'headache', 'exhaustion'];

        // Убираем дубликаты
        pool = pool.filter(id => !this.h.conditions.some(c => c.type === id));
        if (!pool.length) return null;

        return this.addCondition(randomFrom(pool), { source: 'rp_detected' });
    }

    // === СТАТУС ===

    get overallStatus() {
        const critical = this.h.conditions.some(c => c.severity === 'critical');
        const severe = this.h.conditions.some(c => c.severity === 'severe') || this.h.injuries.some(i => i.severity === 'severe');
        const moderate = this.h.conditions.some(c => c.severity === 'moderate') || this.h.injuries.some(i => i.severity === 'moderate');
        const any = this.h.conditions.length > 0 || this.h.injuries.length > 0;

        if (critical || this.h.bloodLoss > 70 || this.h.pain > 90) return { level: 'critical', label: 'Критическое', emoji: '⛔', color: '#c02030' };
        if (severe || this.h.bloodLoss > 40 || this.h.pain > 70) return { level: 'poor', label: 'Плохое', emoji: '🔴', color: '#e04050' };
        if (moderate || this.h.energy < 25 || this.h.stress > 75) return { level: 'fair', label: 'Удовлетворительное', emoji: '🟠', color: '#f09040' };
        if (any || this.h.energy < 50) return { level: 'okay', label: 'Нормальное', emoji: '🟡', color: '#f0c850' };
        return { level: 'good', label: 'Хорошее', emoji: '🟢', color: '#60c060' };
    }

    get mentalStateInfo() {
        return MENTAL_STATE_LABELS[this.h.mentalState] || MENTAL_STATE_LABELS.stable;
    }

    get allSymptoms() {
        const symptoms = [];
        for (const c of this.h.conditions) {
            symptoms.push(...(c.symptoms || []));
        }
        for (const i of this.h.injuries) {
            if (i.infected) symptoms.push('воспаление раны');
            if (i.bleeding) symptoms.push('кровотечение');
        }
        return [...new Set(symptoms)];
    }

    get activeMedicationNames() {
        return this.h.medications.map(m => m.name);
    }

    // === ДЛЯ ПРОМПТА ===

    toPromptData() {
        const data = {
            overall: this.overallStatus.label,
            immunity: this.h.immunity,
            stress: this.h.stress,
            energy: this.h.energy,
            pain: this.h.pain,
            bloodLoss: this.h.bloodLoss,
            mentalState: this.mentalStateInfo.label,
            conditions: this.h.conditions.map(c => `${c.label} (${SEVERITY_LABELS[c.severity]?.label || c.severity}${c.note ? `, ${c.note}` : ''})`),
            injuries: this.h.injuries.map(i => `${i.label} — ${i.location} (${SEVERITY_LABELS[i.severity]?.label || i.severity}${i.infected ? ', ИНФИЦИРОВАНО' : ''})`),
            medications: this.h.medications.map(m => `${m.name} (${m.daysLeft} дн.)`),
            symptoms: this.allSymptoms
        };
        return data;
    }
}
