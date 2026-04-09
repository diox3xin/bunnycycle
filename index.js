// LifeCycle Extension for SillyTavern
// index.js — Main Entry Point
// Version: 0.1.0-alpha

import { extension_settings, getContext, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { generateQuietPrompt } from "../../../../script.js";

const extensionName = "lifecycle";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const defaultSettings = {
    enabled: true,
    language: "ru",
    // ====== ГЛОБАЛЬНЫЕ ======
    globalDifficultyMultiplier: 1.0, // 0.1=минимальный, 1.0=реалистичный, 3.0=драматичный, 100.0=гарантированный
    autoTimeProgress: true,
    timeParserSensitivity: "medium", // low, medium, high
    timeParserConfirmation: true,
    promptInjectionPosition: "system", // system, authornote, endofchat
    autoInjectRelevantOnly: true,

    // ====== МОДУЛИ ВКЛ/ВЫКЛ ======
    modules: {
        cycle: true,
        intimacy: true,
        pregnancy: true,
        labor: true,
        baby: true,
        auOverlay: false,
    },

    // ====== AU ОВЕРЛЕЙ ======
    auPreset: "realism", // realism, omegaverse, fantasy, scifi, custom
    auSettings: {
        omegaverse: {
            secondarySexes: true,
            heat: {
                frequencyMonths: 3,
                durationDays: 5,
                intensity: "severe",
                symptoms: ["fever", "slick", "brain_fog", "pheromones", "sensitivity"],
                suppressants: true,
                suppressantSideEffects: ["headache", "nausea", "mood_swings"],
            },
            rut: {
                frequencyMonths: 3,
                durationDays: 4,
                intensity: "moderate",
                symptoms: ["aggression", "high_libido", "possessiveness", "knot_swelling"],
                syncWithPartnerHeat: true,
            },
            knot: {
                enabled: true,
                size: "medium",
                lockDurationMin: 15,
                sensationDescription: "",
            },
            bond: {
                enabled: true,
                type: "bite_mark",
                effects: ["emotion_sync", "separation_pain", "cycle_sync"],
            },
            whoCanConceive: "all_omegas",
            malePregnancy: {
                enabled: true,
                birthMethod: "magical_birth_canal",
            },
            pregnancyDurationWeeks: 36,
        },
        fantasy: {
            pregnancyByRace: {
                human: 40,
                elf: 52,
                werewolf: 22,
                dragon_egg: 8,
                dragon_incubation: 26,
            },
            litterSize: { min: 1, max: 1 },
            nonHumanFeatures: true,
            magicalComplications: false,
        },
        scifi: {
            artificialWomb: false,
            geneticModification: false,
            acceleratedGrowth: false,
        },
    },

    // ====== ПЕРСОНАЖИ ======
    characters: {},

    // ====== ТЕКУЩАЯ ДАТА МИРА ======
    worldDate: {
        year: 2025,
        month: 1,
        day: 1,
        hour: 12,
        minute: 0,
        dayCounter: 1,
        frozen: false,
    },

    // ====== ЛОГ ИНТИМА ======
    intimacyLog: [],

    // ====== ЛОГ БРОСКОВ ======
    diceLog: [],
};

// ==========================================
// КОНСТАНТЫ
// ==========================================

const CYCLE_PHASES = {
    MENSTRUATION: "menstruation",
    FOLLICULAR_EARLY: "follicular_early",
    FOLLICULAR_LATE: "follicular_late",
    OVULATION: "ovulation",
    LUTEAL_EARLY: "luteal_early",
    LUTEAL_LATE: "luteal_late",
};

const PHASE_FERTILITY_BASE = {
    [CYCLE_PHASES.MENSTRUATION]: 0.02,
    [CYCLE_PHASES.FOLLICULAR_EARLY]: 0.05,
    [CYCLE_PHASES.FOLLICULAR_LATE]: 0.15,
    [CYCLE_PHASES.OVULATION]: 0.25,
    [CYCLE_PHASES.LUTEAL_EARLY]: 0.10,
    [CYCLE_PHASES.LUTEAL_LATE]: 0.03,
};

const PHASE_LIBIDO = {
    [CYCLE_PHASES.MENSTRUATION]: "low",
    [CYCLE_PHASES.FOLLICULAR_EARLY]: "medium",
    [CYCLE_PHASES.FOLLICULAR_LATE]: "medium",
    [CYCLE_PHASES.OVULATION]: "high",
    [CYCLE_PHASES.LUTEAL_EARLY]: "medium",
    [CYCLE_PHASES.LUTEAL_LATE]: "low",
};

const CONTRACEPTION_MULTIPLIER = {
    none: 1.0,
    condom: 0.02,
    pill: 0.01,
    iud: 0.005,
    patch: 0.01,
    injection: 0.005,
    withdrawal: 0.20,
    custom: 1.0,
};

const ACT_TYPE_MULTIPLIER = {
    vaginal_internal: 1.0,
    vaginal_external: 0.15,
    anal: 0.0,
    oral: 0.0,
    other: 0.0,
};

const SYMPTOM_POOLS = {
    pms: [
        "вздутие живота", "раздражительность", "болезненность груди",
        "тяга к сладкому", "перепады настроения", "акне",
        "усталость", "бессонница", "отёки", "головная боль",
        "боль в пояснице", "плаксивость",
    ],
    menstruation: [
        "спазмы внизу живота", "головная боль", "боль в пояснице",
        "тошнота", "слабость", "повышенная чувствительность",
        "сонливость", "жидкий стул", "ноющая боль",
    ],
    ovulation: [
        "повышенное либидо", "лёгкая боль внизу живота (миттельшмерц)",
        "прозрачные тягучие выделения", "прилив энергии",
        "обострённое обоняние", "лёгкая отёчность",
    ],
    follicular: [
        "улучшение настроения", "прилив энергии", "чистая кожа",
        "повышенная мотивация", "хороший аппетит",
    ],
    luteal_early: [
        "лёгкая усталость", "повышенный аппетит", "нормальное настроение",
    ],
};

const PREGNANCY_SYMPTOMS = {
    trimester1: [
        "тошнота", "рвота", "сильная усталость", "частое мочеиспускание",
        "болезненность груди", "отвращение к некоторым запахам",
        "головокружение", "эмоциональная нестабильность", "сонливость",
        "слюнотечение", "запоры", "изжога",
    ],
    trimester2: [
        "возвращение энергии", "рост живота", "изжога",
        "заложенность носа", "боль в круглой связке",
        "пигментация кожи", "зуд живота", "увеличение груди",
        "боли в спине", "появление молозива",
    ],
    trimester3: [
        "одышка", "отёки ног", "бессонница",
        "частое мочеиспускание", "сильные боли в спине",
        "тренировочные схватки", "ощущение тяжести",
        "давление на мочевой пузырь", "сильная усталость",
        "гнездование", "изжога", "геморрой",
    ],
};

const FETAL_SIZE_COMPARISONS = [
    "маковое зёрнышко", "кунжутное семечко", "чечевица", "черника",
    "малина", "оливка", "виноградина", "кумкват",
    "инжир", "лайм", "слива", "персик",
    "лимон", "нектарин", "яблоко", "авокадо",
    "репа", "гранат", "манго", "банан",
    "папайя", "кукурузный початок", "грейпфрут", "дыня-канталупа",
    "цветная капуста", "кочанный салат", "баклажан", "кабачок",
    "кокос", "ананас", "тыква-баттернат", "хикама",
    "мускусная дыня", "капуста", "мускатная тыква", "медовая дыня",
    "швейцарский мангольд", "лук-порей", "тыква", "арбуз",
];

const LABOR_STAGES = {
    LATENT: "latent",
    ACTIVE: "active",
    TRANSITION: "transition",
    PUSHING: "pushing",
    BIRTH: "birth",
    PLACENTA: "placenta",
    COMPLETE: "complete",
};

const BABY_MILESTONES = {
    "0-1m": {
        skills: ["рефлексы", "плач", "сосание"],
        cantDo: ["держать голову"],
        teeth: 0,
        schedule: "Сон 16-20ч, кормление каждые 2-3ч",
    },
    "2-3m": {
        skills: ["улыбка", "гуление", "держит голову"],
        cantDo: ["переворачиваться"],
        teeth: 0,
        schedule: "Сон 14-17ч, кормление каждые 3-4ч",
    },
    "4-6m": {
        skills: ["переворачивается", "хватает игрушки", "смеётся"],
        cantDo: ["сидеть"],
        teeth: "0-2",
        schedule: "Сон 12-16ч, начало прикорма",
    },
    "7-9m": {
        skills: ["сидит", "ползает", "лепечет (ма-ма, ба-ба)"],
        cantDo: ["ходить"],
        teeth: "2-4",
        schedule: "Сон 12-14ч, 3 приёма пищи + молоко",
    },
    "10-12m": {
        skills: ["встаёт", "первые шаги", "первые слова"],
        cantDo: ["говорить предложениями"],
        teeth: "4-8",
        schedule: "Сон 12-14ч, 2 дневных сна",
    },
    "1-2y": {
        skills: ["ходит", "бегает", "20-50 слов", "истерики"],
        cantDo: ["одеваться", "считать"],
        teeth: "8-16",
        schedule: "Сон 11-14ч, 1 дневной сон",
    },
    "2-3y": {
        skills: ["фразы", "рисует", "прыгает", "приучение к горшку"],
        cantDo: ["читать", "писать"],
        teeth: "16-20",
        schedule: "Сон 10-13ч",
    },
};

const EYE_COLORS = [
    "карие", "голубые", "зелёные", "серые", "ореховые",
    "янтарные", "тёмно-карие", "серо-голубые", "серо-зелёные",
];

const HAIR_COLORS = [
    "чёрные", "тёмно-каштановые", "каштановые", "русые",
    "светло-русые", "блондин", "рыжие", "медные", "пепельные",
];

// ==========================================
// УТИЛИТЫ
// ==========================================

function deepMerge(target, source) {
    const output = Object.assign({}, target);
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target)) {
                    Object.assign(output, { [key]: source[key] });
                } else {
                    output[key] = deepMerge(target[key], source[key]);
                }
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
}

function isObject(item) {
    return (item && typeof item === "object" && !Array.isArray(item));
}

function randomFromArray(arr, count = 1) {
    const shuffled = [...arr].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.min(count, arr.length));
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function formatDate(worldDate) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${worldDate.year}/${pad(worldDate.month)}/${pad(worldDate.day)} ${pad(worldDate.hour)}:${pad(worldDate.minute)}`;
}

function getTimeOfDay(hour) {
    if (hour >= 5 && hour < 12) return "Утро";
    if (hour >= 12 && hour < 17) return "День";
    if (hour >= 17 && hour < 22) return "Вечер";
    return "Ночь";
}

function daysBetween(date1, date2) {
    const d1 = new Date(date1.year, date1.month - 1, date1.day);
    const d2 = new Date(date2.year, date2.month - 1, date2.day);
    return Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));
}

function addDays(worldDate, days) {
    const d = new Date(worldDate.year, worldDate.month - 1, worldDate.day);
    d.setDate(d.getDate() + days);
    return {
        ...worldDate,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        dayCounter: worldDate.dayCounter + days,
    };
}

// ==========================================
// КЛАСС: ЦИКЛ
// ==========================================

class CycleManager {
    constructor(characterProfile) {
        this.profile = characterProfile;
    }

    getCurrentPhase() {
        const cycle = this.profile.cycle;
        if (!cycle || !cycle.enabled) return null;

        const day = cycle.currentDay;
        const length = cycle.length;
        const mensDuration = cycle.menstruationDuration;
        const ovulationDay = Math.round(length - 14);

        if (day <= mensDuration) {
            return CYCLE_PHASES.MENSTRUATION;
        } else if (day <= ovulationDay - 5) {
            return CYCLE_PHASES.FOLLICULAR_EARLY;
        } else if (day <= ovulationDay - 1) {
            return CYCLE_PHASES.FOLLICULAR_LATE;
        } else if (day <= ovulationDay + 1) {
            return CYCLE_PHASES.OVULATION;
        } else if (day <= ovulationDay + 7) {
            return CYCLE_PHASES.LUTEAL_EARLY;
        } else {
            return CYCLE_PHASES.LUTEAL_LATE;
        }
    }

    getPhaseLabel(phase) {
        const labels = {
            [CYCLE_PHASES.MENSTRUATION]: "Менструация",
            [CYCLE_PHASES.FOLLICULAR_EARLY]: "Фолликулярная (ранняя)",
            [CYCLE_PHASES.FOLLICULAR_LATE]: "Фолликулярная (поздняя)",
            [CYCLE_PHASES.OVULATION]: "Овуляция",
            [CYCLE_PHASES.LUTEAL_EARLY]: "Лютеиновая (ранняя)",
            [CYCLE_PHASES.LUTEAL_LATE]: "Лютеиновая (поздняя)",
        };
        return labels[phase] || "Неизвестно";
    }

    getFertility() {
        const phase = this.getCurrentPhase();
        if (!phase) return 0;
        return PHASE_FERTILITY_BASE[phase] || 0;
    }

    getLibido() {
        const phase = this.getCurrentPhase();
        if (!phase) return "medium";
        return PHASE_LIBIDO[phase] || "medium";
    }

    getSymptoms() {
        const phase = this.getCurrentPhase();
        const cycle = this.profile.cycle;
        const intensity = cycle.symptomIntensity || "moderate";

        let pool = [];
        let count = 2;

        switch (phase) {
            case CYCLE_PHASES.MENSTRUATION:
                pool = SYMPTOM_POOLS.menstruation;
                count = intensity === "severe" ? 4 : intensity === "moderate" ? 3 : 1;
                break;
            case CYCLE_PHASES.FOLLICULAR_EARLY:
            case CYCLE_PHASES.FOLLICULAR_LATE:
                pool = SYMPTOM_POOLS.follicular;
                count = 2;
                break;
            case CYCLE_PHASES.OVULATION:
                pool = SYMPTOM_POOLS.ovulation;
                count = intensity === "severe" ? 4 : 2;
                break;
            case CYCLE_PHASES.LUTEAL_EARLY:
                pool = SYMPTOM_POOLS.luteal_early;
                count = 1;
                break;
            case CYCLE_PHASES.LUTEAL_LATE:
                pool = SYMPTOM_POOLS.pms;
                count = intensity === "severe" ? 5 : intensity === "moderate" ? 3 : 2;
                break;
        }

        return randomFromArray(pool, count);
    }

    getDischarge() {
        const phase = this.getCurrentPhase();
        const descriptions = {
            [CYCLE_PHASES.MENSTRUATION]: "менструальные выделения",
            [CYCLE_PHASES.FOLLICULAR_EARLY]: "скудные, сухо",
            [CYCLE_PHASES.FOLLICULAR_LATE]: "белые кремообразные",
            [CYCLE_PHASES.OVULATION]: "прозрачные, тягучие, обильные (как яичный белок)",
            [CYCLE_PHASES.LUTEAL_EARLY]: "густые, белые",
            [CYCLE_PHASES.LUTEAL_LATE]: "густые, уменьшающиеся",
        };
        return descriptions[phase] || "нормальные";
    }

    advanceDay(days = 1) {
        const cycle = this.profile.cycle;
        if (!cycle || !cycle.enabled) return;

        const irregularity = cycle.irregularity || 0;

        cycle.currentDay += days;

        while (cycle.currentDay > cycle.length) {
            cycle.currentDay -= cycle.length;
            // Применяем нерегулярность к новому циклу
            if (irregularity > 0) {
                const variation = randomInt(-irregularity, irregularity);
                cycle.length = clamp(cycle.baseLength + variation, 21, 45);
            }
            cycle.cycleCount = (cycle.cycleCount || 0) + 1;
        }
    }

    generateBlock() {
        const cycle = this.profile.cycle;
        if (!cycle || !cycle.enabled) return "";

        const phase = this.getCurrentPhase();
        const fertility = this.getFertility();
        const libido = this.getLibido();
        const symptoms = this.getSymptoms();
        const discharge = this.getDischarge();
        const contraception = this.profile.contraception || "none";

        let fertilityLabel = "Низкая";
        if (fertility >= 0.20) fertilityLabel = "ПИКОВАЯ";
        else if (fertility >= 0.10) fertilityLabel = "Высокая";
        else if (fertility >= 0.05) fertilityLabel = "Средняя";

        return `[CYCLE: ${this.profile.name} | День ${cycle.currentDay}/${cycle.length} | Фаза: ${this.getPhaseLabel(phase)} | Выделения: ${discharge} | Симптомы: ${symptoms.join(", ")} | Либидо: ${libido} | Фертильность: ${fertilityLabel} (${(fertility * 100).toFixed(1)}%) | Контрацепция: ${contraception}]`;
    }
}

// ==========================================
// КЛАСС: БЕРЕМЕННОСТЬ
// ==========================================

class PregnancyManager {
    constructor(characterProfile) {
        this.profile = characterProfile;
    }

    isPregnant() {
        return this.profile.pregnancy && this.profile.pregnancy.active;
    }

    startPregnancy(fatherName = "unknown", fetusCount = 1) {
        this.profile.pregnancy = {
            active: true,
            week: 1,
            day: 1,
            maxWeeks: this.getMaxWeeks(),
            fetusCount: fetusCount,
            fatherName: fatherName,
            difficulty: this.profile.pregnancyDifficulty || "normal",
            complications: [],
            weightGain: 0,
            startDate: { ...extension_settings[extensionName].worldDate },
        };

        // Отключаем цикл
        if (this.profile.cycle) {
            this.profile.cycle.enabled = false;
            this.profile.cycle.pausedForPregnancy = true;
        }

        return true;
    }

    getMaxWeeks() {
        const settings = extension_settings[extensionName];
        if (settings.auPreset === "omegaverse") {
            return settings.auSettings.omegaverse.pregnancyDurationWeeks || 36;
        }
        if (settings.auPreset === "fantasy" && this.profile.race) {
            const byRace = settings.auSettings.fantasy.pregnancyByRace;
            return byRace[this.profile.race] || 40;
        }
        return 40;
    }

    getTrimester() {
        if (!this.isPregnant()) return 0;
        const week = this.profile.pregnancy.week;
        if (week <= 13) return 1;
        if (week <= 27) return 2;
        return 3;
    }

    getFetalSize() {
        if (!this.isPregnant()) return "";
        const week = this.profile.pregnancy.week;
        const index = clamp(week - 1, 0, FETAL_SIZE_COMPARISONS.length - 1);
        return FETAL_SIZE_COMPARISONS[index];
    }

    getSymptoms() {
        if (!this.isPregnant()) return [];
        const trimester = this.getTrimester();
        const difficulty = this.profile.pregnancy.difficulty;
        let count = 3;
        if (difficulty === "easy") count = 2;
        if (difficulty === "hard") count = 5;
        if (difficulty === "complicated") count = 6;

        let pool;
        switch (trimester) {
            case 1: pool = PREGNANCY_SYMPTOMS.trimester1; break;
            case 2: pool = PREGNANCY_SYMPTOMS.trimester2; break;
            case 3: pool = PREGNANCY_SYMPTOMS.trimester3; break;
            default: pool = [];
        }

        return randomFromArray(pool, count);
    }

    getMovements() {
        if (!this.isPregnant()) return "нет";
        const week = this.profile.pregnancy.week;
        if (week < 16) return "нет";
        if (week < 20) return "возможно лёгкие (не все чувствуют)";
        if (week < 24) return "редкие, лёгкие";
        if (week < 30) return "регулярные, ощутимые";
        if (week < 36) return "активные, иногда сильные";
        return "сильные, иногда болезненные, возможно реже (мало места)";
    }

    getWeightGain() {
        if (!this.isPregnant()) return 0;
        const week = this.profile.pregnancy.week;
        const fetusCount = this.profile.pregnancy.fetusCount;
        let base;

        if (week <= 13) {
            base = week * 0.15;
        } else if (week <= 27) {
            base = 2 + (week - 13) * 0.45;
        } else {
            base = 8.3 + (week - 27) * 0.35;
        }

        return Math.round(base * (1 + (fetusCount - 1) * 0.4) * 10) / 10;
    }

    getBodyChanges() {
        if (!this.isPregnant()) return [];
        const week = this.profile.pregnancy.week;
        const changes = [];

        if (week >= 4) changes.push("увеличение груди");
        if (week >= 12) changes.push("живот начинает округляться");
        if (week >= 16) changes.push("заметный живот");
        if (week >= 20) changes.push("тёмная линия на животе (linea nigra)");
        if (week >= 22) changes.push("возможны растяжки");
        if (week >= 28) changes.push("большой живот");
        if (week >= 30) changes.push("отёки ног и рук");
        if (week >= 32) changes.push("пупок выпирает");
        if (week >= 36) changes.push("живот опускается");

        return changes;
    }

    getEmotionalState() {
        if (!this.isPregnant()) return "нормальное";
        const trimester = this.getTrimester();
        const states = {
            1: ["тревожность", "плаксивость", "эмоциональные качели", "счастье вперемешку со страхом"],
            2: ["спокойствие", "энергичность", "привязанность к плоду", "мечтательность"],
            3: ["нетерпение", "страх перед родами", "гнездование", "усталость от беременности", "нежность"],
        };
        return randomFromArray(states[trimester] || [], 2);
    }

    getNextAppointment() {
        if (!this.isPregnant()) return "";
        const week = this.profile.pregnancy.week;
        const appointments = [
            { week: 8, desc: "Первое УЗИ, подтверждение беременности" },
            { week: 12, desc: "Скрининг первого триместра" },
            { week: 16, desc: "Плановый осмотр" },
            { week: 20, desc: "УЗИ анатомии (можно узнать пол)" },
            { week: 24, desc: "Глюкозотолерантный тест" },
            { week: 28, desc: "Третий триместр, осмотр каждые 2 недели" },
            { week: 32, desc: "УЗИ роста, положение плода" },
            { week: 36, desc: "Еженедельные осмотры, проверка готовности" },
            { week: 38, desc: "Осмотр, обсуждение плана родов" },
            { week: 40, desc: "ПДР (предполагаемая дата родов)" },
        ];

        const next = appointments.find(a => a.week > week);
        return next ? `Неделя ${next.week}: ${next.desc}` : "Роды скоро!";
    }

    advanceWeek(weeks = 1) {
        if (!this.isPregnant()) return;

        this.profile.pregnancy.week += weeks;
        this.profile.pregnancy.weightGain = this.getWeightGain();

        // Проверка на автоматический старт родов
        if (this.profile.pregnancy.week >= 37) {
            const chance = (this.profile.pregnancy.week - 36) * 10;
            if (randomInt(1, 100) <= chance || this.profile.pregnancy.week >= 42) {
                return "labor_trigger";
            }
        }

        return "ok";
    }

    advanceDay(days = 1) {
        if (!this.isPregnant()) return;

        this.profile.pregnancy.day += days;
        const weeksToAdvance = Math.floor(this.profile.pregnancy.day / 7);
        if (weeksToAdvance > 0) {
            this.profile.pregnancy.day -= weeksToAdvance * 7;
            return this.advanceWeek(weeksToAdvance);
        }
        return "ok";
    }

    endPregnancy(reason = "birth") {
        if (!this.isPregnant()) return;

        this.profile.pregnancy.active = false;
        this.profile.pregnancy.endReason = reason;
        this.profile.pregnancy.endDate = { ...extension_settings[extensionName].worldDate };

        // Восстановить цикл (с задержкой на послеродовой период)
        if (this.profile.cycle && this.profile.cycle.pausedForPregnancy) {
            this.profile.cycle.postpartumDays = 0;
            this.profile.cycle.awaitingReturn = true;
        }
    }

    generateBlock() {
        if (!this.isPregnant()) return "";

        const preg = this.profile.pregnancy;
        const trimester = this.getTrimester();
        const fetalSize = this.getFetalSize();
        const symptoms = this.getSymptoms();
        const movements = this.getMovements();
        const weightGain = this.getWeightGain();
        const bodyChanges = this.getBodyChanges();
        const emotions = this.getEmotionalState();
        const nextAppt = this.getNextAppointment();

        return `[PREG: ${this.profile.name} | Неделя ${preg.week}/${preg.maxWeeks} | Триместр ${trimester} | Плодов: ${preg.fetusCount} | Размер плода: ~${fetalSize} | Симптомы: ${symptoms.join(", ")} | Шевеления: ${movements} | Прибавка: +${weightGain} кг | Тело: ${bodyChanges.join(", ")} | Эмоции: ${emotions.join(", ")} | Отец: ${preg.fatherName} | След. приём: ${nextAppt}]`;
    }
}

// ==========================================
// КЛАСС: РОДЫ
// ==========================================

class LaborManager {
    constructor(characterProfile) {
        this.profile = characterProfile;
    }

    isInLabor() {
        return this.profile.labor && this.profile.labor.active;
    }

    startLabor(options = {}) {
        this.profile.labor = {
            active: true,
            stage: LABOR_STAGES.LATENT,
            dilation: 0,
            contractionIntervalMin: 30,
            contractionDurationSec: 30,
            contractionIntensity: "слабые",
            type: options.type || "natural",
            painRelief: options.painRelief || "none",
            hoursElapsed: 0,
            complications: [],
            fetalHeartRate: randomInt(130, 150),
            motherState: {
                fatigue: 10,
                painLevel: 20,
                awareness: 100,
            },
            attendees: options.attendees || ["врач", "акушерка"],
            startDate: { ...extension_settings[extensionName].worldDate },
        };

        return true;
    }

    advanceStage() {
        if (!this.isInLabor()) return null;

        const labor = this.profile.labor;
        const currentStage = labor.stage;

        switch (currentStage) {
            case LABOR_STAGES.LATENT:
                labor.stage = LABOR_STAGES.ACTIVE;
                labor.dilation = randomInt(4, 5);
                labor.contractionIntervalMin = randomInt(3, 5);
                labor.contractionDurationSec = 60;
                labor.contractionIntensity = "сильные";
                labor.hoursElapsed += randomInt(4, 12);
                labor.motherState.fatigue = clamp(labor.motherState.fatigue + 20, 0, 100);
                labor.motherState.painLevel = clamp(labor.motherState.painLevel + 25, 0, 100);
                break;

            case LABOR_STAGES.ACTIVE:
                labor.stage = LABOR_STAGES.TRANSITION;
                labor.dilation = randomInt(8, 9);
                labor.contractionIntervalMin = randomInt(1, 2);
                labor.contractionDurationSec = 90;
                labor.contractionIntensity = "пиковые, невыносимые";
                labor.hoursElapsed += randomInt(2, 5);
                labor.motherState.fatigue = clamp(labor.motherState.fatigue + 25, 0, 100);
                labor.motherState.painLevel = clamp(labor.motherState.painLevel + 30, 0, 100);
                labor.motherState.awareness = clamp(labor.motherState.awareness - 15, 0, 100);
                labor.fetalHeartRate = randomInt(120, 160);
                break;

            case LABOR_STAGES.TRANSITION:
                labor.stage = LABOR_STAGES.PUSHING;
                labor.dilation = 10;
                labor.contractionIntensity = "потужные, рефлекторное давление вниз";
                labor.hoursElapsed += randomInt(1, 2);
                labor.motherState.fatigue = clamp(labor.motherState.fatigue + 15, 0, 100);
                labor.motherState.painLevel = 90;
                break;

            case LABOR_STAGES.PUSHING:
                labor.stage = LABOR_STAGES.BIRTH;
                labor.hoursElapsed += randomInt(0, 2) + 0.5;
                labor.motherState.fatigue = clamp(labor.motherState.fatigue + 20, 0, 100);
                labor.motherState.painLevel = 100;
                break;

            case LABOR_STAGES.BIRTH:
                labor.stage = LABOR_STAGES.PLACENTA;
                labor.hoursElapsed += 0.25;
                labor.motherState.painLevel = 40;
                break;

            case LABOR_STAGES.PLACENTA:
                labor.stage = LABOR_STAGES.COMPLETE;
                labor.active = false;
                labor.hoursElapsed += 0.25;
                labor.motherState.painLevel = 20;
                labor.endDate = { ...extension_settings[extensionName].worldDate };
                break;
        }

        // Применить обезболивание
        if (labor.painRelief === "epidural") {
            labor.motherState.painLevel = Math.max(labor.motherState.painLevel - 50, 10);
        } else if (labor.painRelief === "gas") {
            labor.motherState.painLevel = Math.max(labor.motherState.painLevel - 20, 15);
        }

        return labor.stage;
    }

    getStageDescription() {
        if (!this.isInLabor()) return "";
        const labor = this.profile.labor;

        const descriptions = {
            [LABOR_STAGES.LATENT]: `Латентная фаза. Раскрытие ${labor.dilation} см. Схватки каждые ${labor.contractionIntervalMin} мин по ${labor.contractionDurationSec} сек, ${labor.contractionIntensity}. Можно ходить, разговаривать между схватками.`,
            [LABOR_STAGES.ACTIVE]: `Активная фаза. Раскрытие ${labor.dilation} см. Схватки каждые ${labor.contractionIntervalMin} мин по ${labor.contractionDurationSec} сек, ${labor.contractionIntensity}. Сложно говорить во время схватки, нарастающая боль.`,
            [LABOR_STAGES.TRANSITION]: `Переходная фаза. Раскрытие ${labor.dilation} см. Схватки каждые ${labor.contractionIntervalMin} мин по ${labor.contractionDurationSec} сек, ${labor.contractionIntensity}. Самый тяжёлый этап: тошнота, дрожь, паника, ощущение "не могу больше".`,
            [LABOR_STAGES.PUSHING]: `Потужной период. Полное раскрытие (10 см). Рефлекторные потуги, мощное давление вниз. Головка видна при потугах, растяжение промежности.`,
            [LABOR_STAGES.BIRTH]: `Рождение! Выход головки, разворот плечиков, скольжение тела. Первый вдох, первый крик.`,
            [LABOR_STAGES.PLACENTA]: `Рождение плаценты. Лёгкие схватки, отделение плаценты от стенки матки. Прикладывание к груди.`,
            [LABOR_STAGES.COMPLETE]: `Роды завершены.`,
        };

        return descriptions[labor.stage] || "";
    }

    generateBlock() {
        if (!this.isInLabor()) return "";
        const labor = this.profile.labor;

        const stageLabels = {
            [LABOR_STAGES.LATENT]: "Латентная",
            [LABOR_STAGES.ACTIVE]: "Активная",
            [LABOR_STAGES.TRANSITION]: "Переходная",
            [LABOR_STAGES.PUSHING]: "Потуги",
            [LABOR_STAGES.BIRTH]: "Рождение",
            [LABOR_STAGES.PLACENTA]: "Плацента",
        };

        const painReliefLabels = {
            none: "Нет",
            epidural: "Эпидуральная",
            gas: "Газ (энтонокс)",
            medication: "Медикаментозное",
        };

        return `[LABOR: ${this.profile.name} | Стадия: ${stageLabels[labor.stage]} | Раскрытие: ${labor.dilation}/10 см | Схватки: каждые ${labor.contractionIntervalMin} мин, ${labor.contractionIntensity} | Обезболивание: ${painReliefLabels[labor.painRelief] || labor.painRelief} | Часов прошло: ${labor.hoursElapsed.toFixed(1)} | Усталость: ${labor.motherState.fatigue}% | Боль: ${labor.motherState.painLevel}% | ЧСС плода: ${labor.fetalHeartRate} | Присутствуют: ${labor.attendees.join(", ")}]`;
    }
}

// ==========================================
// КЛАСС: МАЛЫШ
// ==========================================

class BabyManager {
    constructor(babyProfile) {
        this.baby = babyProfile;
    }

    static generateBaby(name, parents, options = {}) {
        const sex = options.sex || (Math.random() > 0.5 ? "M" : "F");
        const sexLabel = sex === "M" ? "мальчик" : "девочка";

        // Генетика внешности
        const parent1Features = parents[0] || {};
        const parent2Features = parents[1] || {};

        const eyeColor = Math.random() > 0.5
            ? (parent1Features.eyeColor || randomFromArray(EYE_COLORS)[0])
            : (parent2Features.eyeColor || randomFromArray(EYE_COLORS)[0]);

        const hairColor = Math.random() > 0.5
            ? (parent1Features.hairColor || randomFromArray(HAIR_COLORS)[0])
            : (parent2Features.hairColor || randomFromArray(HAIR_COLORS)[0]);

        // Вес и рост
        const weightG = options.weight || randomInt(2800, 4200);
        const heightCm = options.height || randomInt(46, 56);

        const baby = {
            name: name,
            sex: sex,
            sexLabel: sexLabel,
            eyeColor: eyeColor,
            hairColor: hairColor,
            birthWeight: weightG,
            birthHeight: heightCm,
            currentWeight: weightG,
            currentHeight: heightCm,
            ageDays: 0,
            teeth: 0,
            state: "здоров",
            parents: [parents[0]?.name || "unknown", parents[1]?.name || "unknown"],
            birthDate: { ...extension_settings[extensionName].worldDate },
            nonHumanFeatures: options.nonHumanFeatures || [],
            milestones: [],
        };

        return baby;
    }

    getAgeLabel() {
        const days = this.baby.ageDays;
        if (days < 7) return `${days} дн.`;
        if (days < 30) return `${Math.floor(days / 7)} нед.`;
        if (days < 365) return `${Math.floor(days / 30)} мес.`;
        const years = Math.floor(days / 365);
        const months = Math.floor((days % 365) / 30);
        return months > 0 ? `${years} г. ${months} мес.` : `${years} г.`;
    }

    getMilestoneCategory() {
        const days = this.baby.ageDays;
        if (days <= 30) return "0-1m";
        if (days <= 90) return "2-3m";
        if (days <= 180) return "4-6m";
        if (days <= 270) return "7-9m";
        if (days <= 365) return "10-12m";
        if (days <= 730) return "1-2y";
        return "2-3y";
    }

    getCurrentMilestones() {
        const category = this.getMilestoneCategory();
        return BABY_MILESTONES[category] || BABY_MILESTONES["0-1m"];
    }

    updateGrowth() {
        const days = this.baby.ageDays;
        // Приблизительная кривая роста
        if (days <= 365) {
            this.baby.currentWeight = this.baby.birthWeight + days * 22;
            this.baby.currentHeight = this.baby.birthHeight + days * 0.07;
        } else {
            this.baby.currentWeight = this.baby.birthWeight + 365 * 22 + (days - 365) * 8;
            this.baby.currentHeight = this.baby.birthHeight + 365 * 0.07 + (days - 365) * 0.03;
        }
        this.baby.currentWeight = Math.round(this.baby.currentWeight);
        this.baby.currentHeight = Math.round(this.baby.currentHeight * 10) / 10;
    }

    advanceDay(days = 1) {
        this.baby.ageDays += days;
        this.updateGrowth();

        // Обновить зубы
        const months = Math.floor(this.baby.ageDays / 30);
        if (months >= 6 && months <= 30) {
            this.baby.teeth = clamp(Math.floor((months - 5) * 0.7), 0, 20);
        }

        // Случайные состояния
        if (randomInt(1, 100) <= 15) {
            const states = ["колики", "простуда", "режутся зубы", "капризничает", "плохо спал"];
            this.baby.state = randomFromArray(states)[0];
        } else {
            this.baby.state = "здоров";
        }
    }

    generateBlock() {
        const milestones = this.getCurrentMilestones();
        const weightKg = (this.baby.currentWeight / 1000).toFixed(1);

        let featuresStr = "";
        if (this.baby.nonHumanFeatures.length > 0) {
            featuresStr = ` | Особенности: ${this.baby.nonHumanFeatures.join(", ")}`;
        }

        return `[BABY: ${this.baby.name} (${this.baby.sexLabel}) | Возраст: ${this.getAgeLabel()} | Рост: ${this.baby.currentHeight} см, Вес: ${weightKg} кг | Глаза: ${this.baby.eyeColor}, Волосы: ${this.baby.hairColor} | Умеет: ${milestones.skills.join(", ")} | Ещё не умеет: ${milestones.cantDo.join(", ")} | Зубы: ${this.baby.teeth} | График: ${milestones.schedule} | Состояние: ${this.baby.state}${featuresStr}]`;
    }
}

// ==========================================
// КЛАСС: ИНТИМ-ТРЕКЕР & DICE ROLL
// ==========================================

class IntimacyManager {
    static logIntimacy(entry) {
        const settings = extension_settings[extensionName];
        const log = {
            id: Date.now(),
            date: { ...settings.worldDate },
            participants: entry.participants || [],
            type: entry.type || "vaginal_internal",
            contraception: entry.contraception || "none",
            ejaculation: entry.ejaculation || "internal",
            notes: entry.notes || "",
        };

        settings.intimacyLog.push(log);
        saveSettingsDebounced();
        return log;
    }

    static calculatePregnancyChance(characterName, intimacyEntry) {
        const settings = extension_settings[extensionName];
        const profile = settings.characters[characterName];
        if (!profile) return { chance: 0, roll: 0, result: false };

        const cycleManager = new CycleManager(profile);
        const fertility = cycleManager.getFertility();

        const contraceptionMult = CONTRACEPTION_MULTIPLIER[intimacyEntry.contraception] || 1.0;
        const actMult = ACT_TYPE_MULTIPLIER[intimacyEntry.type] || 0;

        let ejaculationMult = 1.0;
        if (intimacyEntry.ejaculation === "external") ejaculationMult = 0.15;
        if (intimacyEntry.ejaculation === "na") ejaculationMult = 0;

        const difficultyMult = settings.globalDifficultyMultiplier;

        const finalChance = clamp(
            fertility * 100 * contraceptionMult * actMult * ejaculationMult * difficultyMult,
            0,
            100
        );

        const roll = randomInt(1, 100);
        const result = roll <= finalChance;

        const diceEntry = {
            id: Date.now(),
            date: { ...settings.worldDate },
            character: characterName,
            participants: intimacyEntry.participants,
            phase: cycleManager.getPhaseLabel(cycleManager.getCurrentPhase()),
            baseFertility: (fertility * 100).toFixed(1) + "%",
            contraception: intimacyEntry.contraception,
            contraceptionMult: contraceptionMult,
            actType: intimacyEntry.type,
            ejaculation: intimacyEntry.ejaculation,
            difficultyMult: difficultyMult,
            finalChance: finalChance.toFixed(2) + "%",
            roll: roll,
            threshold: Math.ceil(finalChance),
            result: result,
        };

        settings.diceLog.push(diceEntry);
        saveSettingsDebounced();

        return diceEntry;
    }
}

// ==========================================
// КЛАСС: ОМЕГАВЕРС ОВЕРЛЕЙ
// ==========================================

class OmegaverseManager {
    constructor(characterProfile) {
        this.profile = characterProfile;
    }

    isOmega() {
        return this.profile.secondarySex === "omega";
    }

    isAlpha() {
        return this.profile.secondarySex === "alpha";
    }

    isBeta() {
        return this.profile.secondarySex === "beta";
    }

    getHeatState() {
        if (!this.isOmega()) return null;
        const heat = this.profile.heat;
        if (!heat) return null;

        return {
            active: heat.active || false,
            day: heat.currentDay || 0,
            duration: heat.duration || 5,
            intensity: heat.intensity || "moderate",
            suppressants: heat.onSuppressants || false,
        };
    }

    getRutState() {
        if (!this.isAlpha()) return null;
        const rut = this.profile.rut;
        if (!rut) return null;

        return {
            active: rut.active || false,
            day: rut.currentDay || 0,
            duration: rut.duration || 4,
            intensity: rut.intensity || "moderate",
        };
    }

    getHeatSymptoms() {
        const auSettings = extension_settings[extensionName].auSettings.omegaverse.heat;
        const heat = this.getHeatState();
        if (!heat || !heat.active) return [];

        const symptoms = [];
        const pool = auSettings.symptoms || [];

        const symptomDescriptions = {
            fever: "жар, повышенная температура тела",
            slick: "обильная самосмазка",
            brain_fog: "помутнение сознания, сложно сосредоточиться",
            pheromones: "усиленные феромоны, привлекающие альф",
            sensitivity: "обострённая чувствительность всего тела",
        };

        pool.forEach(s => {
            if (symptomDescriptions[s]) symptoms.push(symptomDescriptions[s]);
        });

        if (heat.suppressants) {
            symptoms.push("(подавители: симптомы ослаблены)");
        }

        return symptoms;
    }

    getRutSymptoms() {
        const auSettings = extension_settings[extensionName].auSettings.omegaverse.rut;
        const rut = this.getRutState();
        if (!rut || !rut.active) return [];

        const symptoms = [];
        const pool = auSettings.symptoms || [];

        const symptomDescriptions = {
            aggression: "повышенная агрессивность и раздражительность",
            high_libido: "крайне высокое либидо",
            possessiveness: "собственничество, желание защищать/удерживать партнёра",
            knot_swelling: "набухание узла у основания",
        };

        pool.forEach(s => {
            if (symptomDescriptions[s]) symptoms.push(symptomDescriptions[s]);
        });

        return symptoms;
    }

    advanceDay(days = 1) {
        const auSettings = extension_settings[extensionName].auSettings.omegaverse;

        if (this.isOmega() && this.profile.heat) {
            const heat = this.profile.heat;
            if (heat.active) {
                heat.currentDay += days;
                if (heat.currentDay > heat.duration) {
                    heat.active = false;
                    heat.currentDay = 0;
                    heat.daysSinceLast = 0;
                }
            } else {
                heat.daysSinceLast = (heat.daysSinceLast || 0) + days;
                const freqDays = (auSettings.heat.frequencyMonths || 3) * 30;
                if (heat.daysSinceLast >= freqDays && !heat.onSuppressants) {
                    heat.active = true;
                    heat.currentDay = 1;
                    heat.duration = auSettings.heat.durationDays || 5;
                    heat.intensity = auSettings.heat.intensity || "moderate";
                }
            }
        }

        if (this.isAlpha() && this.profile.rut) {
            const rut = this.profile.rut;
            if (rut.active) {
                rut.currentDay += days;
                if (rut.currentDay > rut.duration) {
                    rut.active = false;
                    rut.currentDay = 0;
                    rut.daysSinceLast = 0;
                }
            } else {
                rut.daysSinceLast = (rut.daysSinceLast || 0) + days;
                const freqDays = (auSettings.rut.frequencyMonths || 3) * 30;
                if (rut.daysSinceLast >= freqDays) {
                    rut.active = true;
                    rut.currentDay = 1;
                    rut.duration = auSettings.rut.durationDays || 4;
                    rut.intensity = auSettings.rut.intensity || "moderate";
                }
            }
        }
    }

    generateBlock() {
        const parts = [];

        if (this.isOmega()) {
            const heat = this.getHeatState();
            const symptoms = this.getHeatSymptoms();
            if (heat && heat.active) {
                parts.push(`[HEAT: ${this.profile.name} | День ${heat.day}/${heat.duration} | Интенсивность: ${heat.intensity} | Подавители: ${heat.suppressants ? "да" : "нет"} | Симптомы: ${symptoms.join(", ")}]`);
            } else if (heat) {
                const auSettings = extension_settings[extensionName].auSettings.omegaverse;
                const freqDays = (auSettings.heat.frequencyMonths || 3) * 30;
                const daysUntil = freqDays - (this.profile.heat.daysSinceLast || 0);
                parts.push(`[HEAT: ${this.profile.name} | Неактивна | До следующей: ~${Math.max(0, daysUntil)} дн. | Подавители: ${heat.suppressants ? "да" : "нет"}]`);
            }
        }

        if (this.isAlpha()) {
            const rut = this.getRutState();
            const symptoms = this.getRutSymptoms();
            if (rut && rut.active) {
                parts.push(`[RUT: ${this.profile.name} | День ${rut.day}/${rut.duration} | Интенсивность: ${rut.intensity} | Симптомы: ${symptoms.join(", ")}]`);
            } else if (rut) {
                const auSettings = extension_settings[extensionName].auSettings.omegaverse;
                const freqDays = (auSettings.rut.frequencyMonths || 3) * 30;
                const daysUntil = freqDays - (this.profile.rut.daysSinceLast || 0);
                parts.push(`[RUT: ${this.profile.name} | Неактивен | До следующего: ~${Math.max(0, daysUntil)} дн.]`);
            }
        }

        return parts.join("\n");
    }
}

// ==========================================
// ВРЕМЕННОЙ ПАРСЕР
// ==========================================

class TimeParser {
    static parseMessage(messageText) {
        const settings = extension_settings[extensionName];
        const sensitivity = settings.timeParserSensitivity;
        let result = null;

        // === УРОВЕНЬ LOW: только явные даты ===
        // Формат: DD.MM.YYYY, YYYY/MM/DD, DD/MM/YYYY
        const datePatterns = [
            /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/g,
            /(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/g,
        ];

        for (const pattern of datePatterns) {
            const match = pattern.exec(messageText);
            if (match) {
                let year, month, day;
                if (match[1].length === 4) {
                    year = parseInt(match[1]);
                    month = parseInt(match[2]);
                    day = parseInt(match[3]);
                } else {
                    day = parseInt(match[1]);
                    month = parseInt(match[2]);
                    year = parseInt(match[3]);
                }
                if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                    result = { type: "explicit", days: null, date: { year, month, day } };
                }
            }
        }

        if (sensitivity === "low" && !result) return null;

        // === УРОВЕНЬ MEDIUM: относительные указатели ===
        const relativePatterns = [
            { regex: /на следующ(?:ий|ее|ую) (?:день|утро)/i, days: 1 },
            { regex: /(?:на )?следующ(?:ий|ее|ую) день/i, days: 1 },
            { regex: /через (\d+) (?:день|дня|дней)/i, extract: true },
            { regex: /через (\d+) недел[ьюи]/i, extract: true, multiply: 7 },
            { regex: /через (\d+) месяц(?:а|ев)?/i, extract: true, multiply: 30 },
            { regex: /спустя (\d+) (?:день|дня|дней)/i, extract: true },
            { regex: /спустя (\d+) недел[ьюи]/i, extract: true, multiply: 7 },
            { regex: /(?:прошла|прошло|прошёл) (\d+) (?:день|дня|дней)/i, extract: true },
            { regex: /(?:прошла|прошло|прошёл) (\d+) недел[ьюи]/i, extract: true, multiply: 7 },
            { regex: /(?:прошла|прошло|прошёл) (\d+) месяц(?:а|ев)?/i, extract: true, multiply: 30 },
            { regex: /(?:прошла|прошло|прошёл) месяц/i, days: 30 },
            { regex: /(?:прошла|прошло|прошёл) неделя/i, days: 7 },
            { regex: /next (?:day|morning)/i, days: 1 },
            { regex: /(\d+) days? later/i, extract: true },
            { regex: /(\d+) weeks? later/i, extract: true, multiply: 7 },
            { regex: /a week later/i, days: 7 },
            { regex: /a month later/i, days: 30 },
        ];

        if (!result) {
            for (const pat of relativePatterns) {
                const match = pat.regex.exec(messageText);
                if (match) {
                    let days;
                    if (pat.extract) {
                        days = parseInt(match[1]) * (pat.multiply || 1);
                    } else {
                        days = pat.days;
                    }
                    result = { type: "relative", days: days, date: null };
                    break;
                }
            }
        }

        if (sensitivity === "medium" && !result) return null;

        // === УРОВЕНЬ HIGH: контекстные подсказки ===
        if (!result) {
            const contextPatterns = [
                { regex: /утром|на рассвете|утреннее солнце/i, timeOfDay: 8 },
                { regex: /днём|в полдень|полуденное/i, timeOfDay: 13 },
                { regex: /вечером|на закате|вечернее/i, timeOfDay: 19 },
                { regex: /ночью|в полночь|глубокой ночью/i, timeOfDay: 23 },
                { regex: /in the morning|at dawn/i, timeOfDay: 8 },
                { regex: /in the evening|at sunset/i, timeOfDay: 19 },
                { regex: /at night|midnight/i, timeOfDay: 23 },
            ];

            for (const pat of contextPatterns) {
                const match = pat.regex.exec(messageText);
                if (match) {
                    const currentHour = settings.worldDate.hour;
                    // Только если время суток изменилось назад, значит прошёл день
                    if (pat.timeOfDay < currentHour && pat.timeOfDay < 12 && currentHour >= 17) {
                        result = { type: "context_newday", days: 1, date: null, newHour: pat.timeOfDay };
                    } else {
                        result = { type: "context_time", days: 0, date: null, newHour: pat.timeOfDay };
                    }
                    break;
                }
            }
        }

        return result;
    }

    static applyTimeChange(parseResult) {
        const settings = extension_settings[extensionName];
        if (!parseResult) return;

        if (parseResult.type === "explicit" && parseResult.date) {
            const oldDate = { ...settings.worldDate };
            settings.worldDate.year = parseResult.date.year;
            settings.worldDate.month = parseResult.date.month;
            settings.worldDate.day = parseResult.date.day;

            const daysPassed = daysBetween(oldDate, settings.worldDate);
            if (daysPassed > 0) {
                TimeParser.advanceAllCharacters(daysPassed);
            }
        } else if (parseResult.days && parseResult.days > 0) {
            const newDate = addDays(settings.worldDate, parseResult.days);
            settings.worldDate = newDate;
            TimeParser.advanceAllCharacters(parseResult.days);
        }

        if (parseResult.newHour !== undefined) {
            settings.worldDate.hour = parseResult.newHour;
        }

        saveSettingsDebounced();
    }

    static advanceAllCharacters(days) {
        const settings = extension_settings[extensionName];

        Object.keys(settings.characters).forEach(charName => {
            const profile = settings.characters[charName];

            // Цикл
            if (settings.modules.cycle && profile.cycle && profile.cycle.enabled) {
                const cycleManager = new CycleManager(profile);
                cycleManager.advanceDay(days);
            }

            // Беременность
            if (settings.modules.pregnancy) {
                const pregManager = new PregnancyManager(profile);
                if (pregManager.isPregnant()) {
                    const result = pregManager.advanceDay(days);
                    if (result === "labor_trigger") {
                        // Автоматический старт родов
                        if (settings.modules.labor) {
                            const laborManager = new LaborManager(profile);
                            laborManager.startLabor();
                        }
                    }
                }
            }

            // Омегаверс
            if (settings.modules.auOverlay && settings.auPreset === "omegaverse") {
                const omegaManager = new OmegaverseManager(profile);
                omegaManager.advanceDay(days);
            }

            // Малыши
            if (settings.modules.baby && profile.babies) {
                profile.babies.forEach(babyData => {
                    const babyManager = new BabyManager(babyData);
                    babyManager.advanceDay(days);
                });
            }
        });
    }
}

// ==========================================
// ИНЪЕКЦИЯ В ПРОМПТ
// ==========================================

class PromptInjector {
    static generateInjection(relevantCharacters = null) {
        const settings = extension_settings[extensionName];
        if (!settings.enabled) return "";

        const blocks = [];
        blocks.push("[SYSTEM NOTE: LifeCycle Extension Active]");
        blocks.push(`Дата мира: ${formatDate(settings.worldDate)} | ${getTimeOfDay(settings.worldDate.hour)}`);
        blocks.push("");

        const characters = relevantCharacters
            ? relevantCharacters
            : Object.keys(settings.characters);

        characters.forEach(charName => {
            const profile = settings.characters[charName];
            if (!profile) return;

            blocks.push(`=== Персонаж: ${charName} ===`);

            if (profile.bioSex) {
                blocks.push(`Биологический пол: ${profile.bioSex}`);
            }
            if (settings.modules.auOverlay && profile.secondarySex) {
                blocks.push(`Вторичный пол: ${profile.secondarySex}`);
            }

            // Цикл
            if (settings.modules.cycle) {
                const cycleManager = new CycleManager(profile);
                const cycleBlock = cycleManager.generateBlock();
                if (cycleBlock) blocks.push(cycleBlock);
            }

            // Омегаверс
            if (settings.modules.auOverlay && settings.auPreset === "omegaverse") {
                const omegaManager = new OmegaverseManager(profile);
                const omegaBlock = omegaManager.generateBlock();
                if (omegaBlock) blocks.push(omegaBlock);
            }

            // Беременность
            if (settings.modules.pregnancy) {
                const pregManager = new PregnancyManager(profile);
                const pregBlock = pregManager.generateBlock();
                if (pregBlock) blocks.push(pregBlock);
            }

            // Роды
            if (settings.modules.labor) {
                const laborManager = new LaborManager(profile);
                const laborBlock = laborManager.generateBlock();
                if (laborBlock) blocks.push(laborBlock);
            }

            // Малыши
            if (settings.modules.baby && profile.babies) {
                profile.babies.forEach(babyData => {
                    const babyManager = new BabyManager(babyData);
                    blocks.push(babyManager.generateBlock());
                });
            }

            blocks.push("");
        });

        // Последний интим
        if (settings.modules.intimacy && settings.intimacyLog.length > 0) {
            const lastEntry = settings.intimacyLog[settings.intimacyLog.length - 1];
            blocks.push(`[LAST INTIMACY: ${lastEntry.participants.join(" + ")} | Тип: ${lastEntry.type} | Контрацепция: ${lastEntry.contraception} | Эякуляция: ${lastEntry.ejaculation}]`);
        }

        // Инструкции для AI
        blocks.push("");
        blocks.push("[INSTRUCTIONS FOR AI]");
        blocks.push("- Учитывай текущую фазу цикла персонажа в описании поведения, самочувствия и реакций.");
        blocks.push("- Либидо персонажа влияет на инициативность и физические реакции.");
        blocks.push("- Симптомы беременности должны проявляться естественно в повествовании.");
        blocks.push("- Если идут роды, описывай ощущения и прогрессию реалистично и детально.");
        blocks.push("- Шевеления малыша, его звуки и поведение должны соответствовать возрасту.");
        blocks.push("- Не забывай обновлять данные в блоках трекинга в конце каждого сообщения.");

        return blocks.join("\n");
    }
}

// ==========================================
// UI: HTML ГЕНЕРАЦИЯ
// ==========================================

function generateSettingsHTML() {
    return `
    <div id="lifecycle-settings" class="lifecycle-panel">
        <div class="lifecycle-header">
            <h3>🩸🍼 LifeCycle Extension</h3>
            <label class="lifecycle-toggle">
                <input type="checkbox" id="lifecycle-enabled" ${extension_settings[extensionName].enabled ? "checked" : ""}>
                <span>Активно</span>
            </label>
        </div>

        <!-- Вкладки -->
        <div class="lifecycle-tabs">
            <button class="lifecycle-tab active" data-tab="global">⚙️ Общее</button>
            <button class="lifecycle-tab" data-tab="characters">👤 Персонажи</button>
            <button class="lifecycle-tab" data-tab="cycle">🔴 Цикл</button>
            <button class="lifecycle-tab" data-tab="intimacy">🔥 Интим</button>
            <button class="lifecycle-tab" data-tab="pregnancy">🤰 Берем.</button>
            <button class="lifecycle-tab" data-tab="labor">🏥 Роды</button>
            <button class="lifecycle-tab" data-tab="baby">👶 Малыш</button>
            <button class="lifecycle-tab" data-tab="au">⚗️ AU</button>
            <button class="lifecycle-tab" data-tab="logs">📋 Логи</button>
        </div>

        <!-- GLOBAL TAB -->
        <div class="lifecycle-tab-content active" id="tab-global">
            <div class="lifecycle-section">
                <h4>📅 Мировая дата</h4>
                <div class="lifecycle-row">
                    <label>Дата:</label>
                    <input type="number" id="lc-world-year" min="1" max="9999" value="${extension_settings[extensionName].worldDate.year}" style="width:60px">
                    <span>/</span>
                    <input type="number" id="lc-world-month" min="1" max="12" value="${extension_settings[extensionName].worldDate.month}" style="width:40px">
                    <span>/</span>
                    <input type="number" id="lc-world-day" min="1" max="31" value="${extension_settings[extensionName].worldDate.day}" style="width:40px">
                    <input type="number" id="lc-world-hour" min="0" max="23" value="${extension_settings[extensionName].worldDate.hour}" style="width:40px">
                    <span>:</span>
                    <input type="number" id="lc-world-minute" min="0" max="59" value="${extension_settings[extensionName].worldDate.minute}" style="width:40px">
                </div>
                <div class="lifecycle-row">
                    <button id="lc-freeze-time" class="lifecycle-btn ${extension_settings[extensionName].worldDate.frozen ? "active" : ""}">
                        ${extension_settings[extensionName].worldDate.frozen ? "⏸️ Время заморожено" : "▶️ Время идёт"}
                    </button>
                    <button id="lc-advance-day" class="lifecycle-btn">+1 день</button>
                    <button id="lc-advance-week" class="lifecycle-btn">+7 дней</button>
                </div>
            </div>

            <div class="lifecycle-section">
                <h4>🎲 Сложность зачатия</h4>
                <div class="lifecycle-row">
                    <input type="range" id="lc-difficulty" min="0.1" max="100" step="0.1"
                        value="${extension_settings[extensionName].globalDifficultyMultiplier}">
                    <span id="lc-difficulty-label">${extension_settings[extensionName].globalDifficultyMultiplier}x</span>
                </div>
                <div class="lifecycle-presets">
                    <button class="lifecycle-btn-sm" data-difficulty="0.1">Минимум</button>
                    <button class="lifecycle-btn-sm" data-difficulty="1.0">Реализм</button>
                    <button class="lifecycle-btn-sm" data-difficulty="3.0">Драма</button>
                    <button class="lifecycle-btn-sm" data-difficulty="100">Гарант</button>
                </div>
            </div>

            <div class="lifecycle-section">
                <h4>⏱️ Парсер времени</h4>
                <div class="lifecycle-row">
                    <label>Чувствительность:</label>
                    <select id="lc-parser-sensitivity">
                        <option value="low" ${extension_settings[extensionName].timeParserSensitivity === "low" ? "selected" : ""}>Низкая (явные даты)</option>
                        <option value="medium" ${extension_settings[extensionName].timeParserSensitivity === "medium" ? "selected" : ""}>Средняя (+относительные)</option>
                        <option value="high" ${extension_settings[extensionName].timeParserSensitivity === "high" ? "selected" : ""}>Высокая (+контекст)</option>
                    </select>
                </div>
                <div class="lifecycle-row">
                    <label>
                        <input type="checkbox" id="lc-parser-confirm" ${extension_settings[extensionName].timeParserConfirmation ? "checked" : ""}>
                        Подтверждение перед сменой времени
                    </label>
                </div>
            </div>

            <div class="lifecycle-section">
                <h4>📦 Модули</h4>
                ${Object.entries(extension_settings[extensionName].modules).map(([key, val]) => `
                    <div class="lifecycle-row">
                        <label>
                            <input type="checkbox" class="lc-module-toggle" data-module="${key}" ${val ? "checked" : ""}>
                            ${getModuleLabel(key)}
                        </label>
                    </div>
                `).join("")}
            </div>

            <div class="lifecycle-section">
                <h4>💉 Инъекция в промпт</h4>
                <select id="lc-injection-position">
                    <option value="system" ${extension_settings[extensionName].promptInjectionPosition === "system" ? "selected" : ""}>System Prompt</option>
                    <option value="authornote" ${extension_settings[extensionName].promptInjectionPosition === "authornote" ? "selected" : ""}>Author's Note</option>
                    <option value="endofchat" ${extension_settings[extensionName].promptInjectionPosition === "endofchat" ? "selected" : ""}>End of Chat</option>
                </select>
            </div>

            <div class="lifecycle-section">
                <h4>💾 Шаблоны</h4>
                <div class="lifecycle-row">
                    <button id="lc-export-au" class="lifecycle-btn">📤 Экспорт AU</button>
                    <button id="lc-import-au" class="lifecycle-btn">📥 Импорт AU</button>
                </div>
                <div class="lifecycle-row">
                    <button id="lc-export-char" class="lifecycle-btn">📤 Экспорт персонажа</button>
                    <button id="lc-import-char" class="lifecycle-btn">📥 Импорт персонажа</button>
                </div>
            </div>
        </div>

        <!-- CHARACTERS TAB -->
        <div class="lifecycle-tab-content" id="tab-characters">
            <div class="lifecycle-section">
                <h4>👤 Управление персонажами</h4>
                <div class="lifecycle-row">
                    <input type="text" id="lc-new-char-name" placeholder="Имя персонажа">
                    <button id="lc-add-character" class="lifecycle-btn">+ Добавить</button>
                </div>
                <div id="lc-character-list"></div>
            </div>
        </div>

        <!-- CYCLE TAB -->
        <div class="lifecycle-tab-content" id="tab-cycle">
            <div class="lifecycle-section">
                <h4>🔴 Настройки цикла</h4>
                <div class="lifecycle-row">
                    <label>Персонаж:</label>
                    <select id="lc-cycle-char-select" class="lc-char-select"></select>
                </div>
                <div id="lc-cycle-settings-panel"></div>
            </div>
        </div>

        <!-- INTIMACY TAB -->
        <div class="lifecycle-tab-content" id="tab-intimacy">
            <div class="lifecycle-section">
                <h4>🔥 Логировать интим</h4>
                <div class="lifecycle-row">
                    <label>Участник 1:</label>
                    <select id="lc-intim-char1" class="lc-char-select"></select>
                </div>
                <div class="lifecycle-row">
                    <label>Участник 2:</label>
                    <select id="lc-intim-char2" class="lc-char-select"></select>
                </div>
                <div class="lifecycle-row">
                    <label>Тип:</label>
                    <select id="lc-intim-type">
                        <option value="vaginal_internal">Вагинальный (внутрь)</option>
                        <option value="vaginal_external">Вагинальный (наружу)</option>
                        <option value="anal">Анальный</option>
                        <option value="oral">Оральный</option>
                        <option value="other">Другое</option>
                    </select>
                </div>
                <div class="lifecycle-row">
                    <label>Контрацепция:</label>
                    <select id="lc-intim-contra">
                        <option value="none">Нет</option>
                        <option value="condom">Презерватив</option>
                        <option value="pill">ОК (таблетки)</option>
                        <option value="iud">ВМС (спираль)</option>
                        <option value="patch">Пластырь</option>
                        <option value="injection">Инъекция</option>
                        <option value="withdrawal">Прерванный акт</option>
                    </select>
                </div>
                <div class="lifecycle-row">
                    <button id="lc-log-intimacy" class="lifecycle-btn lifecycle-btn-primary">📝 Залогировать</button>
                    <button id="lc-roll-dice" class="lifecycle-btn lifecycle-btn-danger">🎲 Бросить кубик</button>
                </div>
            </div>
        </div>

        <!-- PREGNANCY TAB -->
        <div class="lifecycle-tab-content" id="tab-pregnancy">
            <div class="lifecycle-section">
                <h4>🤰 Беременность</h4>
                <div class="lifecycle-row">
                    <label>Персонаж:</label>
                    <select id="lc-preg-char-select" class="lc-char-select"></select>
                </div>
                <div id="lc-preg-panel"></div>
                <div class="lifecycle-row">
                    <button id="lc-start-pregnancy" class="lifecycle-btn">▶️ Начать беременность</button>
                    <button id="lc-set-preg-week" class="lifecycle-btn">📅 Установить неделю</button>
                    <button id="lc-end-pregnancy" class="lifecycle-btn lifecycle-btn-danger">⏹️ Прервать</button>
                </div>
            </div>
        </div>

        <!-- LABOR TAB -->
        <div class="lifecycle-tab-content" id="tab-labor">
            <div class="lifecycle-section">
                <h4>🏥 Роды</h4>
                <div class="lifecycle-row">
                    <label>Персонаж:</label>
                    <select id="lc-labor-char-select" class="lc-char-select"></select>
                </div>
                <div id="lc-labor-panel"></div>
                <div class="lifecycle-row">
                    <button id="lc-start-labor" class="lifecycle-btn">▶️ Начать роды</button>
                    <button id="lc-advance-labor" class="lifecycle-btn lifecycle-btn-primary">⏩ Следующая стадия</button>
                    <button id="lc-finish-labor" class="lifecycle-btn">✅ Завершить роды</button>
                </div>
            </div>
        </div>

        <!-- BABY TAB -->
        <div class="lifecycle-tab-content" id="tab-baby">
            <div class="lifecycle-section">
                <h4>👶 Малыши</h4>
                <div class="lifecycle-row">
                    <label>Родитель:</label>
                    <select id="lc-baby-parent-select" class="lc-char-select"></select>
                </div>
                <div id="lc-baby-list"></div>
                <div class="lifecycle-row">
                    <button id="lc-add-baby-manual" class="lifecycle-btn">+ Добавить малыша вручную</button>
                </div>
            </div>
        </div>

        <!-- AU TAB -->
        <div class="lifecycle-tab-content" id="tab-au">
            <div class="lifecycle-section">
                <h4>⚗️ AU-Оверлей</h4>
                <div class="lifecycle-row">
                    <label>Пресет:</label>
                    <select id="lc-au-preset">
                        <option value="realism" ${extension_settings[extensionName].auPreset === "realism" ? "selected" : ""}>🔵 Реализм</option>
                        <option value="omegaverse" ${extension_settings[extensionName].auPreset === "omegaverse" ? "selected" : ""}>🔴 Омегаверс</option>
                        <option value="fantasy" ${extension_settings[extensionName].auPreset === "fantasy" ? "selected" : ""}>🟣 Фэнтези</option>
                        <option value="scifi" ${extension_settings[extensionName].auPreset === "scifi" ? "selected" : ""}>🟢 Sci-Fi</option>
                        <option value="custom" ${extension_settings[extensionName].auPreset === "custom" ? "selected" : ""}>⚪ Кастом</option>
                    </select>
                </div>
                <div id="lc-au-settings-panel"></div>
            </div>
        </div>

        <!-- LOGS TAB -->
        <div class="lifecycle-tab-content" id="tab-logs">
            <div class="lifecycle-section">
                <h4>📋 Лог бросков</h4>
                <div id="lc-dice-log"></div>
            </div>
            <div class="lifecycle-section">
                <h4>📋 Лог интима</h4>
                <div id="lc-intimacy-log"></div>
            </div>
        </div>

        <!-- СВОДНАЯ ПАНЕЛЬ (всегда видна) -->
        <div id="lc-dashboard" class="lifecycle-dashboard"></div>
    </div>`;
}

function getModuleLabel(key) {
    const labels = {
        cycle: "🔴 Цикл",
        intimacy: "🔥 Интим-трекер",
        pregnancy: "🤰 Беременность",
        labor: "🏥 Роды",
        baby: "👶 Малыш",
        auOverlay: "⚗️ AU-Оверлей",
    };
    return labels[key] || key;
}

// ==========================================
// UI: CSS
// ==========================================

function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
        .lifecycle-panel {
            padding: 10px;
            font-family: inherit;
        }
        .lifecycle-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--SmartThemeBorderColor);
        }
        .lifecycle-header h3 {
            margin: 0;
            font-size: 16px;
        }
        .lifecycle-toggle {
            display: flex;
            align-items: center;
            gap: 5px;
            cursor: pointer;
        }
        .lifecycle-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 2px;
            margin-bottom: 10px;
        }
        .lifecycle-tab {
            padding: 4px 8px;
            font-size: 11px;
            border: 1px solid var(--SmartThemeBorderColor);
            background: var(--SmartThemeBlurTintColor);
            color: var(--SmartThemeBodyColor);
            cursor: pointer;
            border-radius: 4px;
            transition: background 0.2s;
        }
        .lifecycle-tab.active {
            background: var(--SmartThemeQuoteColor);
            color: var(--SmartThemeBodyColor);
            font-weight: bold;
        }
        .lifecycle-tab:hover {
            opacity: 0.8;
        }
        .lifecycle-tab-content {
            display: none;
        }
        .lifecycle-tab-content.active {
            display: block;
        }
        .lifecycle-section {
            margin-bottom: 12px;
            padding: 8px;
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 6px;
            background: var(--SmartThemeBlurTintColor);
        }
        .lifecycle-section h4 {
            margin: 0 0 8px 0;
            font-size: 13px;
        }
        .lifecycle-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 6px;
            flex-wrap: wrap;
        }
        .lifecycle-row label {
            font-size: 12px;
            min-width: 80px;
        }
        .lifecycle-row input[type="number"],
        .lifecycle-row input[type="text"],
        .lifecycle-row select {
            padding: 3px 6px;
            font-size: 12px;
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 4px;
            background: var(--SmartThemeBlurTintColor);
            color: var(--SmartThemeBodyColor);
        }
        .lifecycle-row input[type="range"] {
            flex: 1;
        }
        .lifecycle-btn {
            padding: 4px 10px;
            font-size: 11px;
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 4px;
            background: var(--SmartThemeBlurTintColor);
            color: var(--SmartThemeBodyColor);
            cursor: pointer;
            transition: all 0.2s;
        }
        .lifecycle-btn:hover {
            opacity: 0.7;
        }
        .lifecycle-btn.active {
            background: var(--SmartThemeQuoteColor);
        }
        .lifecycle-btn-primary {
            background: #4a90d9;
            color: white;
            border-color: #3a7bc8;
        }
        .lifecycle-btn-danger {
            background: #d94a4a;
            color: white;
            border-color: #c83a3a;
        }
        .lifecycle-btn-sm {
            padding: 2px 6px;
            font-size: 10px;
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 3px;
            background: var(--SmartThemeBlurTintColor);
            color: var(--SmartThemeBodyColor);
            cursor: pointer;
        }
        .lifecycle-presets {
            display: flex;
            gap: 4px;
            margin-top: 4px;
        }
        .lifecycle-dashboard {
            margin-top: 10px;
            padding: 8px;
            border: 2px solid var(--SmartThemeQuoteColor);
            border-radius: 8px;
            background: var(--SmartThemeBlurTintColor);
            font-size: 11px;
        }
        .lifecycle-dashboard-item {
            padding: 3px 0;
            border-bottom: 1px solid var(--SmartThemeBorderColor);
        }
        .lifecycle-dashboard-item:last-child {
            border-bottom: none;
        }

        /* Dice Roll Popup */
        .lc-dice-popup {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 10000;
            background: var(--SmartThemeBlurTintColor);
            border: 2px solid var(--SmartThemeQuoteColor);
            border-radius: 12px;
            padding: 20px;
            min-width: 320px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            font-family: monospace;
        }
        .lc-dice-popup h3 {
            text-align: center;
            margin: 0 0 12px 0;
        }
        .lc-dice-popup .dice-result {
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            margin: 10px 0;
        }
        .lc-dice-popup .dice-success {
            color: #4caf50;
        }
        .lc-dice-popup .dice-fail {
            color: #f44336;
        }
        .lc-dice-popup .dice-details {
            font-size: 12px;
            margin: 8px 0;
        }
        .lc-dice-popup .dice-actions {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-top: 12px;
        }
        .lc-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
        }

        /* Character card in list */
        .lc-char-card {
            padding: 8px;
            margin: 4px 0;
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 6px;
            background: var(--SmartThemeBlurTintColor);
        }
        .lc-char-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .lc-char-card-name {
            font-weight: bold;
            font-size: 13px;
        }
        .lc-char-card-tags {
            display: flex;
            gap: 4px;
        }
        .lc-tag {
            padding: 1px 5px;
            font-size: 9px;
            border-radius: 3px;
            color: white;
        }
        .lc-tag-cycle { background: #e91e63; }
        .lc-tag-preg { background: #ff9800; }
        .lc-tag-labor { background: #f44336; }
        .lc-tag-heat { background: #9c27b0; }
        .lc-tag-rut { background: #2196f3; }
    `;
    document.head.appendChild(style);
}

// ==========================================
// UI: ОБРАБОТЧИКИ СОБЫТИЙ
// ==========================================

function bindEvents() {
    const settings = extension_settings[extensionName];

    // Вкладки
    document.querySelectorAll(".lifecycle-tab").forEach(tab => {
        tab.addEventListener("click", function() {
            document.querySelectorAll(".lifecycle-tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".lifecycle-tab-content").forEach(c => c.classList.remove("active"));
            this.classList.add("active");
            const tabId = "tab-" + this.dataset.tab;
            document.getElementById(tabId)?.classList.add("active");
        });
    });

    // Enabled toggle
    document.getElementById("lifecycle-enabled")?.addEventListener("change", function() {
        settings.enabled = this.checked;
        saveSettingsDebounced();
    });

    // Мировая дата
    ["lc-world-year", "lc-world-month", "lc-world-day", "lc-world-hour", "lc-world-minute"].forEach(id => {
        document.getElementById(id)?.addEventListener("change", function() {
            const field = id.replace("lc-world-", "");
            settings.worldDate[field] = parseInt(this.value) || 0;
            saveSettingsDebounced();
            updateDashboard();
        });
    });

    // Заморозка времени
    document.getElementById("lc-freeze-time")?.addEventListener("click", function() {
        settings.worldDate.frozen = !settings.worldDate.frozen;
        this.textContent = settings.worldDate.frozen ? "⏸️ Время заморожено" : "▶️ Время идёт";
        this.classList.toggle("active", settings.worldDate.frozen);
        saveSettingsDebounced();
    });

    // Продвижение времени
    document.getElementById("lc-advance-day")?.addEventListener("click", () => {
        const newDate = addDays(settings.worldDate, 1);
        settings.worldDate = newDate;
        TimeParser.advanceAllCharacters(1);
        saveSettingsDebounced();
        updateUI();
    });

    document.getElementById("lc-advance-week")?.addEventListener("click", () => {
        const newDate = addDays(settings.worldDate, 7);
        settings.worldDate = newDate;
        TimeParser.advanceAllCharacters(7);
        saveSettingsDebounced();
        updateUI();
    });

    // Сложность
    document.getElementById("lc-difficulty")?.addEventListener("input", function() {
        settings.globalDifficultyMultiplier = parseFloat(this.value);
        document.getElementById("lc-difficulty-label").textContent = this.value + "x";
        saveSettingsDebounced();
    });

    document.querySelectorAll("[data-difficulty]").forEach(btn => {
        btn.addEventListener("click", function() {
            const val = parseFloat(this.dataset.difficulty);
            settings.globalDifficultyMultiplier = val;
            document.getElementById("lc-difficulty").value = val;
            document.getElementById("lc-difficulty-label").textContent = val + "x";
            saveSettingsDebounced();
        });
    });

    // Чувствительность парсера
    document.getElementById("lc-parser-sensitivity")?.addEventListener("change", function() {
        settings.timeParserSensitivity = this.value;
        saveSettingsDebounced();
    });

    document.getElementById("lc-parser-confirm")?.addEventListener("change", function() {
        settings.timeParserConfirmation = this.checked;
        saveSettingsDebounced();
    });

    // Модули
    document.querySelectorAll(".lc-module-toggle").forEach(toggle => {
        toggle.addEventListener("change", function() {
            settings.modules[this.dataset.module] = this.checked;
            saveSettingsDebounced();
        });
    });

    // Позиция инъекции
    document.getElementById("lc-injection-position")?.addEventListener("change", function() {
        settings.promptInjectionPosition = this.value;
        saveSettingsDebounced();
    });

    // AU пресет
    document.getElementById("lc-au-preset")?.addEventListener("change", function() {
        settings.auPreset = this.value;
        saveSettingsDebounced();
        renderAUSettings();
    });

    // Добавить персонажа
    document.getElementById("lc-add-character")?.addEventListener("click", () => {
        const nameInput = document.getElementById("lc-new-char-name");
        const name = nameInput?.value?.trim();
        if (!name) return;
        if (settings.characters[name]) {
            alert("Персонаж с таким именем уже существует!");
            return;
        }
        settings.characters[name] = createDefaultCharacterProfile(name);
        nameInput.value = "";
        saveSettingsDebounced();
        updateUI();
    });

    // Логировать интим
    document.getElementById("lc-log-intimacy")?.addEventListener("click", () => {
        const char1 = document.getElementById("lc-intim-char1")?.value;
        const char2 = document.getElementById("lc-intim-char2")?.value;
        const type = document.getElementById("lc-intim-type")?.value;
        const contra = document.getElementById("lc-intim-contra")?.value;

        if (!char1 || !char2) {
            alert("Выберите обоих участников!");
            return;
        }

        const ejaculation = type.includes("internal") ? "internal" : "external";

        IntimacyManager.logIntimacy({
            participants: [char1, char2],
            type: type,
            contraception: contra,
            ejaculation: ejaculation,
        });

        updateLogs();
        alert("✅ Залогировано!");
    });

    // Бросить кубик
    document.getElementById("lc-roll-dice")?.addEventListener("click", () => {
        const char1 = document.getElementById("lc-intim-char1")?.value;
        const char2 = document.getElementById("lc-intim-char2")?.value;
        const type = document.getElementById("lc-intim-type")?.value;
        const contra = document.getElementById("lc-intim-contra")?.value;

        if (!char1 || !char2) {
            alert("Выберите обоих участников!");
            return;
        }

        const ejaculation = type === "vaginal_internal" ? "internal" : "external";

        // Определяем, кто может забеременеть
        const profile1 = settings.characters[char1];
        const profile2 = settings.characters[char2];
        let targetChar = null;

        if (profile1?.bioSex === "F" || profile1?.secondarySex === "omega") targetChar = char1;
        else if (profile2?.bioSex === "F" || profile2?.secondarySex === "omega") targetChar = char2;

        if (!targetChar) {
            alert("Ни один из участников не может забеременеть по текущим настройкам.");
            return;
        }

        const diceResult = IntimacyManager.calculatePregnancyChance(targetChar, {
            participants: [char1, char2],
            type: type,
            contraception: contra,
            ejaculation: ejaculation,
        });

        showDicePopup(diceResult, targetChar);
    });

    // Начать беременность вручную
    document.getElementById("lc-start-pregnancy")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-preg-char-select")?.value;
        if (!charName) return;

        const fatherName = prompt("Имя отца (или оставьте пустым):", "") || "unknown";
        const fetusCount = parseInt(prompt("Количество плодов:", "1")) || 1;

        const profile = settings.characters[charName];
        if (!profile) return;

        const pregManager = new PregnancyManager(profile);
        pregManager.startPregnancy(fatherName, fetusCount);
        saveSettingsDebounced();
        updateUI();
        alert(`✅ Беременность ${charName} начата!`);
    });

    // Установить неделю беременности
    document.getElementById("lc-set-preg-week")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-preg-char-select")?.value;
        if (!charName) return;

        const profile = settings.characters[charName];
        if (!profile?.pregnancy?.active) {
            alert("Персонаж не беременен!");
            return;
        }

        const week = parseInt(prompt("Установить неделю (1-42):", profile.pregnancy.week));
        if (week && week >= 1 && week <= 42) {
            profile.pregnancy.week = week;
            profile.pregnancy.weightGain = new PregnancyManager(profile).getWeightGain();
            saveSettingsDebounced();
            updateUI();
        }
    });

    // Прервать беременность
    document.getElementById("lc-end-pregnancy")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-preg-char-select")?.value;
        if (!charName) return;

        const reason = prompt("Причина (birth/miscarriage/abortion/stillbirth):", "miscarriage");
        const profile = settings.characters[charName];
        if (!profile) return;

        const pregManager = new PregnancyManager(profile);
        pregManager.endPregnancy(reason);
        saveSettingsDebounced();
        updateUI();
    });

    // Начать роды
    document.getElementById("lc-start-labor")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-labor-char-select")?.value;
        if (!charName) return;

        const profile = settings.characters[charName];
        if (!profile) return;

        const painRelief = prompt("Обезболивание (none/epidural/gas/medication):", "none") || "none";
        const attendees = (prompt("Присутствующие (через запятую):", "врач, акушерка") || "врач, акушерка").split(",").map(s => s.trim());

        const laborManager = new LaborManager(profile);
        laborManager.startLabor({ painRelief, attendees });
        saveSettingsDebounced();
        updateUI();
        alert(`✅ Роды ${charName} начались!`);
    });

    // Следующая стадия родов
    document.getElementById("lc-advance-labor")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-labor-char-select")?.value;
        if (!charName) return;

        const profile = settings.characters[charName];
        if (!profile?.labor?.active) {
            alert("Персонаж не в родах!");
            return;
        }

        const laborManager = new LaborManager(profile);
        const newStage = laborManager.advanceStage();

        if (newStage === LABOR_STAGES.COMPLETE) {
            // Генерируем малыша
            const babyName = prompt("Имя малыша:", "");
            if (babyName) {
                const pregManager = new PregnancyManager(profile);
                const fatherName = profile.pregnancy?.fatherName || "unknown";
                const fatherProfile = settings.characters[fatherName] || {};

                const baby = BabyManager.generateBaby(babyName, [
                    { name: charName, eyeColor: profile.eyeColor, hairColor: profile.hairColor },
                    { name: fatherName, eyeColor: fatherProfile.eyeColor, hairColor: fatherProfile.hairColor },
                ]);

                if (!profile.babies) profile.babies = [];
                profile.babies.push(baby);

                pregManager.endPregnancy("birth");
            }
        }

        saveSettingsDebounced();
        updateUI();
    });

    // Завершить роды
    document.getElementById("lc-finish-labor")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-labor-char-select")?.value;
        if (!charName) return;

        const profile = settings.characters[charName];
        if (!profile) return;

        if (profile.labor) {
            profile.labor.active = false;
            profile.labor.stage = LABOR_STAGES.COMPLETE;
        }

        saveSettingsDebounced();
        updateUI();
    });

    // Добавить малыша вручную
    document.getElementById("lc-add-baby-manual")?.addEventListener("click", () => {
        const parentName = document.getElementById("lc-baby-parent-select")?.value;
        if (!parentName) return;

        const babyName = prompt("Имя малыша:", "");
        if (!babyName) return;

        const sex = prompt("Пол (M/F):", "F") || "F";
        const profile = settings.characters[parentName];
        if (!profile) return;

        const baby = BabyManager.generateBaby(babyName, [
            { name: parentName, eyeColor: profile.eyeColor, hairColor: profile.hairColor },
        ], { sex });

        if (!profile.babies) profile.babies = [];
        profile.babies.push(baby);

        saveSettingsDebounced();
        updateUI();
        alert(`✅ Малыш ${babyName} добавлен!`);
    });

    // Экспорт AU
    document.getElementById("lc-export-au")?.addEventListener("click", () => {
        const template = {
            template_name: settings.auPreset + "_export",
            template_version: "1.0",
            au_type: settings.auPreset,
            settings: settings.auSettings,
            globalDifficultyMultiplier: settings.globalDifficultyMultiplier,
        };
        downloadJSON(template, `lifecycle_au_${settings.auPreset}.json`);
    });

    // Импорт AU
    document.getElementById("lc-import-au")?.addEventListener("click", () => {
        uploadJSON((data) => {
            if (data.settings) {
                settings.auSettings = deepMerge(settings.auSettings, data.settings);
            }
            if (data.au_type) {
                settings.auPreset = data.au_type;
            }
            if (data.globalDifficultyMultiplier !== undefined) {
                settings.globalDifficultyMultiplier = data.globalDifficultyMultiplier;
            }
            saveSettingsDebounced();
            updateUI();
            alert("✅ AU-шаблон импортирован!");
        });
    });

    // Экспорт персонажа
    document.getElementById("lc-export-char")?.addEventListener("click", () => {
        const charName = prompt("Имя персонажа для экспорта:", "");
        if (!charName || !settings.characters[charName]) {
            alert("Персонаж не найден!");
            return;
        }
        const template = {
            character_template_name: charName + "_export",
            data: settings.characters[charName],
        };
        downloadJSON(template, `lifecycle_char_${charName}.json`);
    });

    // Импорт персонажа
    document.getElementById("lc-import-char")?.addEventListener("click", () => {
        uploadJSON((data) => {
            if (data.data && data.data.name) {
                settings.characters[data.data.name] = data.data;
                saveSettingsDebounced();
                updateUI();
                alert(`✅ Персонаж ${data.data.name} импортирован!`);
            }
        });
    });
}

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ UI
// ==========================================

function createDefaultCharacterProfile(name) {
    return {
        name: name,
        bioSex: "F",
        secondarySex: null,
        race: "human",
        eyeColor: randomFromArray(EYE_COLORS)[0],
        hairColor: randomFromArray(HAIR_COLORS)[0],
        contraception: "none",
        customContraceptionEffectiveness: 0,
        pregnancyDifficulty: "normal",
        cycle: {
            enabled: true,
            length: 28,
            baseLength: 28,
            currentDay: randomInt(1, 28),
            menstruationDuration: 5,
            irregularity: 2,
            symptomIntensity: "moderate",
            cycleCount: 0,
            pausedForPregnancy: false,
            awaitingReturn: false,
            postpartumDays: 0,
        },
        pregnancy: {
            active: false,
            week: 0,
            day: 0,
            maxWeeks: 40,
            fetusCount: 0,
            fatherName: "",
            difficulty: "normal",
            complications: [],
            weightGain: 0,
        },
        labor: {
            active: false,
        },
        heat: {
            active: false,
            currentDay: 0,
            duration: 5,
            intensity: "moderate",
                        daysSinceLast: 0,
            onSuppressants: false,
        },
        rut: {
            active: false,
            currentDay: 0,
            duration: 4,
            intensity: "moderate",
            daysSinceLast: 0,
        },
        babies: [],
    };
}

function showDicePopup(diceResult, targetChar) {
    // Удаляем старый попап если есть
    document.querySelector(".lc-overlay")?.remove();
    document.querySelector(".lc-dice-popup")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "lc-overlay";

    const popup = document.createElement("div");
    popup.className = "lc-dice-popup";

    const resultClass = diceResult.result ? "dice-success" : "dice-fail";
    const resultText = diceResult.result ? "✅ ЗАЧАТИЕ ПРОИЗОШЛО!" : "❌ Зачатие не произошло";
    const resultEmoji = diceResult.result ? "🎉" : "🎲";

    popup.innerHTML = `
        <h3>${resultEmoji} БРОСОК ФЕРТИЛЬНОСТИ</h3>
        <div class="dice-details">
            <div>Персонаж: <strong>${targetChar}</strong></div>
            <div>Фаза цикла: <strong>${diceResult.phase}</strong></div>
            <div>Базовая фертильность: <strong>${diceResult.baseFertility}</strong></div>
            <div>Контрацепция: <strong>${diceResult.contraception}</strong> (×${diceResult.contraceptionMult})</div>
            <div>Тип акта: <strong>${diceResult.actType}</strong></div>
            <div>Эякуляция: <strong>${diceResult.ejaculation}</strong></div>
            <div>Множитель сложности: <strong>${diceResult.difficultyMult}×</strong></div>
            <hr>
            <div>Итоговый порог: <strong>${diceResult.finalChance}</strong></div>
        </div>
        <div class="dice-result ${resultClass}">
            🎲 Бросок: ${diceResult.roll} / 100
        </div>
        <div class="dice-result ${resultClass}" style="font-size:18px;">
            ${resultText}
        </div>
        <div class="dice-actions">
            <button class="lifecycle-btn lifecycle-btn-primary" id="lc-dice-accept">Принять</button>
            <button class="lifecycle-btn" id="lc-dice-reroll">Перебросить</button>
            <button class="lifecycle-btn lifecycle-btn-danger" id="lc-dice-cancel">Отмена</button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    // Обработчики кнопок попапа
    document.getElementById("lc-dice-accept")?.addEventListener("click", () => {
        if (diceResult.result) {
            // Запустить беременность
            const settings = extension_settings[extensionName];
            const profile = settings.characters[targetChar];
            if (profile) {
                const pregManager = new PregnancyManager(profile);
                const fatherName = diceResult.participants.find(p => p !== targetChar) || "unknown";
                pregManager.startPregnancy(fatherName, 1);
                saveSettingsDebounced();
                updateUI();
            }
        }
        overlay.remove();
        popup.remove();
    });

    document.getElementById("lc-dice-reroll")?.addEventListener("click", () => {
        overlay.remove();
        popup.remove();
        // Перебросить
        const settings = extension_settings[extensionName];
        const newResult = IntimacyManager.calculatePregnancyChance(targetChar, {
            participants: diceResult.participants,
            type: diceResult.actType,
            contraception: diceResult.contraception,
            ejaculation: diceResult.ejaculation,
        });
        showDicePopup(newResult, targetChar);
    });

    document.getElementById("lc-dice-cancel")?.addEventListener("click", () => {
        overlay.remove();
        popup.remove();
    });

    overlay.addEventListener("click", () => {
        overlay.remove();
        popup.remove();
    });
}

function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function uploadJSON(callback) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                callback(data);
            } catch (err) {
                alert("Ошибка парсинга JSON: " + err.message);
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

// ==========================================
// UI: ОБНОВЛЕНИЕ ИНТЕРФЕЙСА
// ==========================================

function updateUI() {
    updateCharacterSelects();
    updateCharacterList();
    updateDashboard();
    updateLogs();
    updatePregnancyPanel();
    updateLaborPanel();
    updateBabyList();
    updateCyclePanel();
}

function updateCharacterSelects() {
    const settings = extension_settings[extensionName];
    const charNames = Object.keys(settings.characters);

    document.querySelectorAll(".lc-char-select").forEach(select => {
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- Выбрать --</option>';
        charNames.forEach(name => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        });
        if (charNames.includes(currentVal)) {
            select.value = currentVal;
        }
    });
}

function updateCharacterList() {
    const settings = extension_settings[extensionName];
    const container = document.getElementById("lc-character-list");
    if (!container) return;

    container.innerHTML = "";

    Object.entries(settings.characters).forEach(([name, profile]) => {
        const card = document.createElement("div");
        card.className = "lc-char-card";

        let tags = "";
        if (profile.cycle?.enabled && !profile.pregnancy?.active) {
            const cm = new CycleManager(profile);
            const phase = cm.getCurrentPhase();
            const phaseLabel = cm.getPhaseLabel(phase);
            tags += `<span class="lc-tag lc-tag-cycle">${phaseLabel}</span>`;
        }
        if (profile.pregnancy?.active) {
            tags += `<span class="lc-tag lc-tag-preg">🤰 Нед. ${profile.pregnancy.week}</span>`;
        }
        if (profile.labor?.active) {
            tags += `<span class="lc-tag lc-tag-labor">🏥 Роды</span>`;
        }
        if (settings.modules.auOverlay && settings.auPreset === "omegaverse") {
            if (profile.heat?.active) {
                tags += `<span class="lc-tag lc-tag-heat">🔥 Течка</span>`;
            }
            if (profile.rut?.active) {
                tags += `<span class="lc-tag lc-tag-rut">💢 Гон</span>`;
            }
        }
        if (profile.babies?.length > 0) {
            tags += `<span class="lc-tag" style="background:#4caf50">👶 ×${profile.babies.length}</span>`;
        }

        card.innerHTML = `
            <div class="lc-char-card-header">
                <span class="lc-char-card-name">${name}</span>
                <div class="lc-char-card-tags">${tags}</div>
            </div>
            <div style="font-size:11px; margin-top:4px; color: var(--SmartThemeBodyColor); opacity:0.7;">
                Пол: ${profile.bioSex || "?"}
                ${profile.secondarySex ? " | Втор. пол: " + profile.secondarySex : ""}
                | Контрацепция: ${profile.contraception || "нет"}
            </div>
            <div style="margin-top:4px; display:flex; gap:4px;">
                <button class="lifecycle-btn-sm lc-edit-char" data-char="${name}">✏️ Настройки</button>
                <button class="lifecycle-btn-sm lc-delete-char" data-char="${name}" style="color:#f44336;">🗑️ Удалить</button>
            </div>
        `;

        container.appendChild(card);
    });

    // Привязка событий для кнопок персонажей
    document.querySelectorAll(".lc-delete-char").forEach(btn => {
        btn.addEventListener("click", function() {
            const charName = this.dataset.char;
            if (confirm(`Удалить персонажа "${charName}"? Все данные будут потеряны!`)) {
                delete settings.characters[charName];
                saveSettingsDebounced();
                updateUI();
            }
        });
    });

    document.querySelectorAll(".lc-edit-char").forEach(btn => {
        btn.addEventListener("click", function() {
            const charName = this.dataset.char;
            openCharacterEditor(charName);
        });
    });
}

function openCharacterEditor(charName) {
    const settings = extension_settings[extensionName];
    const profile = settings.characters[charName];
    if (!profile) return;

    // Простой промпт-диалог для редактирования (в будущем можно заменить на полноценный модал)
    const bioSex = prompt(`[${charName}] Биологический пол (M/F):`, profile.bioSex) || profile.bioSex;
    const secondarySex = prompt(`[${charName}] Вторичный пол (alpha/beta/omega/null):`, profile.secondarySex || "null");
    const contraception = prompt(`[${charName}] Контрацепция (none/condom/pill/iud/patch/injection/withdrawal):`, profile.contraception) || "none";
    const eyeColor = prompt(`[${charName}] Цвет глаз:`, profile.eyeColor) || profile.eyeColor;
    const hairColor = prompt(`[${charName}] Цвет волос:`, profile.hairColor) || profile.hairColor;
    const difficulty = prompt(`[${charName}] Сложность беременности (easy/normal/hard/complicated):`, profile.pregnancyDifficulty) || "normal";

    profile.bioSex = bioSex;
    profile.secondarySex = secondarySex === "null" ? null : secondarySex;
    profile.contraception = contraception;
    profile.eyeColor = eyeColor;
    profile.hairColor = hairColor;
    profile.pregnancyDifficulty = difficulty;

    // Настройки цикла
    if (profile.cycle) {
        const cycleLength = parseInt(prompt(`[${charName}] Длина цикла (21-45):`, profile.cycle.baseLength));
        const mensDuration = parseInt(prompt(`[${charName}] Длительность менструации (2-8):`, profile.cycle.menstruationDuration));
        const irregularity = parseInt(prompt(`[${charName}] Нерегулярность (0=нет, 2=лёгкая, 5=средняя, 10=хаотичная):`, profile.cycle.irregularity));
        const intensity = prompt(`[${charName}] Интенсивность симптомов (mild/moderate/severe):`, profile.cycle.symptomIntensity);

        if (cycleLength >= 21 && cycleLength <= 45) {
            profile.cycle.baseLength = cycleLength;
            profile.cycle.length = cycleLength;
        }
        if (mensDuration >= 2 && mensDuration <= 8) {
            profile.cycle.menstruationDuration = mensDuration;
        }
        if (irregularity >= 0) {
            profile.cycle.irregularity = irregularity;
        }
        if (["mild", "moderate", "severe"].includes(intensity)) {
            profile.cycle.symptomIntensity = intensity;
        }
    }

    saveSettingsDebounced();
    updateUI();
}

function updateDashboard() {
    const settings = extension_settings[extensionName];
    const container = document.getElementById("lc-dashboard");
    if (!container) return;

    let html = `<div style="font-weight:bold; margin-bottom:6px;">📊 СВОДКА LifeCycle</div>`;
    html += `<div class="lifecycle-dashboard-item">📅 ${formatDate(settings.worldDate)} | ${getTimeOfDay(settings.worldDate.hour)} | День #${settings.worldDate.dayCounter}${settings.worldDate.frozen ? " | ⏸️ ЗАМОРОЖЕНО" : ""}</div>`;

    Object.entries(settings.characters).forEach(([name, profile]) => {
        let status = [];

        if (settings.modules.cycle && profile.cycle?.enabled && !profile.pregnancy?.active) {
            const cm = new CycleManager(profile);
            const phase = cm.getCurrentPhase();
            status.push(cm.getPhaseLabel(phase));
        }

        if (settings.modules.pregnancy && profile.pregnancy?.active) {
            status.push(`🤰 Нед. ${profile.pregnancy.week}/${profile.pregnancy.maxWeeks}`);
        }

        if (settings.modules.labor && profile.labor?.active) {
            const stageLabels = {
                latent: "Латентная",
                active: "Активная",
                transition: "Переходная",
                pushing: "Потуги",
                birth: "Рождение",
                placenta: "Плацента",
            };
            status.push(`🏥 ${stageLabels[profile.labor.stage] || profile.labor.stage}`);
        }

        if (settings.modules.auOverlay && settings.auPreset === "omegaverse") {
            if (profile.heat?.active) status.push(`🔥 Течка д.${profile.heat.currentDay}`);
            if (profile.rut?.active) status.push(`💢 Гон д.${profile.rut.currentDay}`);
        }

        if (profile.babies?.length > 0) {
            profile.babies.forEach(b => {
                const bm = new BabyManager(b);
                status.push(`👶 ${b.name} (${bm.getAgeLabel()})`);
            });
        }

        const statusStr = status.length > 0 ? status.join(" | ") : "—";
        html += `<div class="lifecycle-dashboard-item"><strong>${name}:</strong> ${statusStr}</div>`;
    });

    container.innerHTML = html;
}

function updateLogs() {
    const settings = extension_settings[extensionName];

    // Лог бросков
    const diceContainer = document.getElementById("lc-dice-log");
    if (diceContainer) {
        if (settings.diceLog.length === 0) {
            diceContainer.innerHTML = '<div style="font-size:11px; opacity:0.6;">Бросков пока нет</div>';
        } else {
            let html = "";
            [...settings.diceLog].reverse().slice(0, 20).forEach(entry => {
                const resultIcon = entry.result ? "✅" : "❌";
                const color = entry.result ? "#4caf50" : "#f44336";
                html += `<div style="font-size:10px; padding:3px 0; border-bottom:1px solid var(--SmartThemeBorderColor);">
                    <span style="color:${color}">${resultIcon}</span>
                    ${entry.character} | ${entry.phase} |
                    Шанс: ${entry.finalChance} | 🎲 ${entry.roll}/${entry.threshold}
                    | ${formatDate(entry.date)}
                </div>`;
            });
            diceContainer.innerHTML = html;
        }
    }

    // Лог интима
    const intimContainer = document.getElementById("lc-intimacy-log");
    if (intimContainer) {
        if (settings.intimacyLog.length === 0) {
            intimContainer.innerHTML = '<div style="font-size:11px; opacity:0.6;">Записей пока нет</div>';
        } else {
            let html = "";
            [...settings.intimacyLog].reverse().slice(0, 20).forEach(entry => {
                html += `<div style="font-size:10px; padding:3px 0; border-bottom:1px solid var(--SmartThemeBorderColor);">
                    ${entry.participants.join(" + ")} | ${entry.type} | Контрацепция: ${entry.contraception}
                    | ${formatDate(entry.date)}
                </div>`;
            });
            intimContainer.innerHTML = html;
        }
    }
}

function updatePregnancyPanel() {
    const settings = extension_settings[extensionName];
    const container = document.getElementById("lc-preg-panel");
    if (!container) return;

    const charName = document.getElementById("lc-preg-char-select")?.value;
    if (!charName || !settings.characters[charName]) {
        container.innerHTML = '<div style="font-size:11px; opacity:0.6;">Выберите персонажа</div>';
        return;
    }

    const profile = settings.characters[charName];
    const pregManager = new PregnancyManager(profile);

    if (!pregManager.isPregnant()) {
        container.innerHTML = '<div style="font-size:11px;">Не беременна. Используйте кнопку ниже для запуска.</div>';
        return;
    }

    const preg = profile.pregnancy;
    const trimester = pregManager.getTrimester();
    const fetalSize = pregManager.getFetalSize();
    const symptoms = pregManager.getSymptoms();
    const movements = pregManager.getMovements();
    const weightGain = pregManager.getWeightGain();
    const bodyChanges = pregManager.getBodyChanges();
    const emotions = pregManager.getEmotionalState();
    const nextAppt = pregManager.getNextAppointment();

    // Полоска прогресса
    const progress = Math.round((preg.week / preg.maxWeeks) * 100);

    container.innerHTML = `
        <div style="margin-bottom:8px;">
            <div style="background:var(--SmartThemeBorderColor); border-radius:4px; height:12px; overflow:hidden;">
                <div style="background: linear-gradient(90deg, #ff9800, #f44336); height:100%; width:${progress}%; transition: width 0.3s;"></div>
            </div>
            <div style="font-size:10px; text-align:center; margin-top:2px;">Неделя ${preg.week} / ${preg.maxWeeks} (${progress}%)</div>
        </div>
        <div style="font-size:11px;">
            <div><strong>Триместр:</strong> ${trimester}</div>
            <div><strong>Плодов:</strong> ${preg.fetusCount}</div>
            <div><strong>Отец:</strong> ${preg.fatherName}</div>
            <div><strong>Размер плода:</strong> ~${fetalSize}</div>
            <div><strong>Шевеления:</strong> ${movements}</div>
            <div><strong>Прибавка:</strong> +${weightGain} кг</div>
            <div><strong>Симптомы:</strong> ${symptoms.join(", ")}</div>
            <div><strong>Тело:</strong> ${bodyChanges.join(", ")}</div>
            <div><strong>Эмоции:</strong> ${emotions.join(", ")}</div>
            <div><strong>След. приём:</strong> ${nextAppt}</div>
        </div>
    `;
}

function updateLaborPanel() {
    const settings = extension_settings[extensionName];
    const container = document.getElementById("lc-labor-panel");
    if (!container) return;

    const charName = document.getElementById("lc-labor-char-select")?.value;
    if (!charName || !settings.characters[charName]) {
        container.innerHTML = '<div style="font-size:11px; opacity:0.6;">Выберите персонажа</div>';
        return;
    }

    const profile = settings.characters[charName];
    const laborManager = new LaborManager(profile);

    if (!laborManager.isInLabor()) {
        container.innerHTML = '<div style="font-size:11px;">Не в родах. Используйте кнопку ниже для запуска.</div>';
        return;
    }

    const labor = profile.labor;
    const description = laborManager.getStageDescription();

    // Полоска раскрытия
    const dilProgress = Math.round((labor.dilation / 10) * 100);

    container.innerHTML = `
        <div style="margin-bottom:6px;">
            <div style="font-size:10px;">Раскрытие: ${labor.dilation}/10 см</div>
            <div style="background:var(--SmartThemeBorderColor); border-radius:4px; height:10px; overflow:hidden;">
                <div style="background: linear-gradient(90deg, #f44336, #ff5722); height:100%; width:${dilProgress}%; transition: width 0.3s;"></div>
            </div>
        </div>
        <div style="font-size:11px;">
            <div><strong>Стадия:</strong> ${labor.stage}</div>
            <div><strong>Часов прошло:</strong> ${labor.hoursElapsed.toFixed(1)}</div>
            <div><strong>Схватки:</strong> каждые ${labor.contractionIntervalMin} мин, ${labor.contractionIntensity}</div>
            <div><strong>Обезболивание:</strong> ${labor.painRelief}</div>
            <div><strong>Боль:</strong> ${labor.motherState.painLevel}%</div>
            <div><strong>Усталость:</strong> ${labor.motherState.fatigue}%</div>
            <div><strong>ЧСС плода:</strong> ${labor.fetalHeartRate} уд/мин</div>
            <div><strong>Присутствуют:</strong> ${labor.attendees.join(", ")}</div>
            <div style="margin-top:6px; padding:4px; background:var(--SmartThemeBlurTintColor); border-radius:4px; font-size:10px;">
                ${description}
            </div>
        </div>
    `;
}

function updateBabyList() {
    const settings = extension_settings[extensionName];
    const container = document.getElementById("lc-baby-list");
    if (!container) return;

    const parentName = document.getElementById("lc-baby-parent-select")?.value;
    if (!parentName || !settings.characters[parentName]) {
        container.innerHTML = '<div style="font-size:11px; opacity:0.6;">Выберите родителя</div>';
        return;
    }

    const profile = settings.characters[parentName];
    if (!profile.babies || profile.babies.length === 0) {
        container.innerHTML = '<div style="font-size:11px;">Малышей нет.</div>';
        return;
    }

    let html = "";
    profile.babies.forEach((baby, index) => {
        const bm = new BabyManager(baby);
        const milestones = bm.getCurrentMilestones();
        const weightKg = (baby.currentWeight / 1000).toFixed(1);

        html += `
        <div class="lc-char-card" style="margin:4px 0;">
            <div class="lc-char-card-header">
                <span class="lc-char-card-name">👶 ${baby.name} (${baby.sexLabel})</span>
                <span style="font-size:10px;">${bm.getAgeLabel()}</span>
            </div>
            <div style="font-size:10px; margin-top:4px;">
                <div>👀 Глаза: ${baby.eyeColor} | 💇 Волосы: ${baby.hairColor}</div>
                <div>📏 ${baby.currentHeight} см | ⚖️ ${weightKg} кг | 🦷 Зубов: ${baby.teeth}</div>
                <div>✅ Умеет: ${milestones.skills.join(", ")}</div>
                <div>⏳ Ещё нет: ${milestones.cantDo.join(", ")}</div>
                <div>📋 ${milestones.schedule}</div>
                <div>💊 Состояние: ${baby.state}</div>
                ${baby.nonHumanFeatures.length > 0 ? `<div>✨ Особенности: ${baby.nonHumanFeatures.join(", ")}</div>` : ""}
            </div>
            <div style="margin-top:4px;">
                <button class="lifecycle-btn-sm lc-set-baby-age" data-parent="${parentName}" data-index="${index}">📅 Установить возраст</button>
                <button class="lifecycle-btn-sm lc-remove-baby" data-parent="${parentName}" data-index="${index}" style="color:#f44336;">🗑️</button>
            </div>
        </div>`;
    });

    container.innerHTML = html;

    // Привязка событий
    document.querySelectorAll(".lc-set-baby-age").forEach(btn => {
        btn.addEventListener("click", function() {
            const parent = this.dataset.parent;
            const idx = parseInt(this.dataset.index);
            const profile = settings.characters[parent];
            if (!profile?.babies?.[idx]) return;

            const input = prompt("Возраст в днях:", profile.babies[idx].ageDays);
            const days = parseInt(input);
            if (days >= 0) {
                profile.babies[idx].ageDays = days;
                const bm = new BabyManager(profile.babies[idx]);
                bm.updateGrowth();
                saveSettingsDebounced();
                updateUI();
            }
        });
    });

    document.querySelectorAll(".lc-remove-baby").forEach(btn => {
        btn.addEventListener("click", function() {
            const parent = this.dataset.parent;
            const idx = parseInt(this.dataset.index);
            const profile = settings.characters[parent];
            if (!profile?.babies?.[idx]) return;

            if (confirm(`Удалить малыша "${profile.babies[idx].name}"?`)) {
                profile.babies.splice(idx, 1);
                saveSettingsDebounced();
                updateUI();
            }
        });
    });
}

function updateCyclePanel() {
    const settings = extension_settings[extensionName];
    const container = document.getElementById("lc-cycle-settings-panel");
    if (!container) return;

    const charName = document.getElementById("lc-cycle-char-select")?.value;
    if (!charName || !settings.characters[charName]) {
        container.innerHTML = '<div style="font-size:11px; opacity:0.6;">Выберите персонажа</div>';
        return;
    }

    const profile = settings.characters[charName];
    const cycle = profile.cycle;

    if (!cycle) {
        container.innerHTML = '<div style="font-size:11px;">Цикл не настроен.</div>';
        return;
    }

    const cm = new CycleManager(profile);
    const phase = cm.getCurrentPhase();
    const phaseLabel = cm.getPhaseLabel(phase);
    const fertility = cm.getFertility();
    const libido = cm.getLibido();
    const symptoms = cm.getSymptoms();
    const discharge = cm.getDischarge();

    let fertilityLabel = "Низкая";
    let fertColor = "#4caf50";
    if (fertility >= 0.20) { fertilityLabel = "ПИКОВАЯ"; fertColor = "#f44336"; }
    else if (fertility >= 0.10) { fertilityLabel = "Высокая"; fertColor = "#ff9800"; }
    else if (fertility >= 0.05) { fertilityLabel = "Средняя"; fertColor = "#ffc107"; }

    // Визуальный календарь цикла
    const dayInCycle = cycle.currentDay;
    const cycleLength = cycle.length;
    const mensDur = cycle.menstruationDuration;
    const ovDay = Math.round(cycleLength - 14);

    let calendarHTML = '<div style="display:flex; flex-wrap:wrap; gap:1px; margin:6px 0;">';
    for (let d = 1; d <= cycleLength; d++) {
        let bgColor = "var(--SmartThemeBorderColor)";
        if (d <= mensDur) bgColor = "#e91e63";
        else if (d >= ovDay - 1 && d <= ovDay + 1) bgColor = "#4caf50";
        else if (d > mensDur && d < ovDay - 1) bgColor = "#2196f3";
        else bgColor = "#ff9800";

        let border = d === dayInCycle ? "2px solid white" : "none";
        let size = d === dayInCycle ? "12px" : "8px";

        calendarHTML += `<div style="width:${size}; height:${size}; border-radius:2px; background:${bgColor}; border:${border};" title="День ${d}"></div>`;
    }
    calendarHTML += '</div>';
    calendarHTML += '<div style="font-size:9px; display:flex; gap:8px;">';
    calendarHTML += '<span><span style="color:#e91e63;">■</span> Менструация</span>';
    calendarHTML += '<span><span style="color:#2196f3;">■</span> Фолликулярная</span>';
    calendarHTML += '<span><span style="color:#4caf50;">■</span> Овуляция</span>';
    calendarHTML += '<span><span style="color:#ff9800;">■</span> Лютеиновая</span>';
    calendarHTML += '</div>';

    container.innerHTML = `
        ${calendarHTML}
        <div style="font-size:11px; margin-top:6px;">
            <div><strong>День:</strong> ${dayInCycle} / ${cycleLength} (цикл #${cycle.cycleCount || 1})</div>
            <div><strong>Фаза:</strong> ${phaseLabel}</div>
            <div><strong>Фертильность:</strong> <span style="color:${fertColor}; font-weight:bold;">${fertilityLabel} (${(fertility * 100).toFixed(1)}%)</span></div>
            <div><strong>Либидо:</strong> ${libido}</div>
            <div><strong>Выделения:</strong> ${discharge}</div>
            <div><strong>Симптомы:</strong> ${symptoms.join(", ") || "нет"}</div>
            <div><strong>Контрацепция:</strong> ${profile.contraception || "нет"}</div>
        </div>
        <div style="margin-top:6px; display:flex; gap:4px; flex-wrap:wrap;">
            <button class="lifecycle-btn-sm" id="lc-cycle-to-mens" data-char="${charName}">→ Менструация</button>
            <button class="lifecycle-btn-sm" id="lc-cycle-to-ovul" data-char="${charName}">→ Овуляция</button>
            <button class="lifecycle-btn-sm" id="lc-cycle-set-day" data-char="${charName}">Установить день</button>
            <button class="lifecycle-btn-sm" id="lc-cycle-skip" data-char="${charName}">Пропустить цикл</button>
        </div>
    `;

    // Привязка кнопок управления циклом
    document.getElementById("lc-cycle-to-mens")?.addEventListener("click", () => {
        profile.cycle.currentDay = 1;
        saveSettingsDebounced();
        updateUI();
    });

    document.getElementById("lc-cycle-to-ovul")?.addEventListener("click", () => {
        profile.cycle.currentDay = Math.round(profile.cycle.length - 14);
        saveSettingsDebounced();
        updateUI();
    });

    document.getElementById("lc-cycle-set-day")?.addEventListener("click", () => {
        const day = parseInt(prompt(`Установить день цикла (1-${profile.cycle.length}):`, profile.cycle.currentDay));
        if (day >= 1 && day <= profile.cycle.length) {
            profile.cycle.currentDay = day;
            saveSettingsDebounced();
            updateUI();
        }
    });

    document.getElementById("lc-cycle-skip")?.addEventListener("click", () => {
        profile.cycle.currentDay = 1;
        profile.cycle.cycleCount = (profile.cycle.cycleCount || 0) + 1;
        saveSettingsDebounced();
        updateUI();
    });
}

function renderAUSettings() {
    const settings = extension_settings[extensionName];
    const container = document.getElementById("lc-au-settings-panel");
    if (!container) return;

    if (settings.auPreset === "omegaverse") {
        const au = settings.auSettings.omegaverse;
        container.innerHTML = `
        <div style="font-size:11px;">
            <h5 style="margin:8px 0 4px;">🔥 Течка (Heat)</h5>
            <div class="lifecycle-row">
                <label>Частота (мес):</label>
                <input type="number" class="lc-au-input" data-path="omegaverse.heat.frequencyMonths" value="${au.heat.frequencyMonths}" min="1" max="12" style="width:50px">
            </div>
            <div class="lifecycle-row">
                <label>Длительность (дн):</label>
                <input type="number" class="lc-au-input" data-path="omegaverse.heat.durationDays" value="${au.heat.durationDays}" min="1" max="14" style="width:50px">
            </div>
            <div class="lifecycle-row">
                <label>Интенсивность:</label>
                <select class="lc-au-input" data-path="omegaverse.heat.intensity">
                    <option value="mild" ${au.heat.intensity === "mild" ? "selected" : ""}>Лёгкая</option>
                    <option value="moderate" ${au.heat.intensity === "moderate" ? "selected" : ""}>Средняя</option>
                    <option value="severe" ${au.heat.intensity === "severe" ? "selected" : ""}>Невыносимая</option>
                </select>
            </div>
            <div class="lifecycle-row">
                <label><input type="checkbox" class="lc-au-check" data-path="omegaverse.heat.suppressants" ${au.heat.suppressants ? "checked" : ""}> Подавители доступны</label>
            </div>

            <h5 style="margin:8px 0 4px;">💢 Гон (Rut)</h5>
            <div class="lifecycle-row">
                <label>Частота (мес):</label>
                <input type="number" class="lc-au-input" data-path="omegaverse.rut.frequencyMonths" value="${au.rut.frequencyMonths}" min="1" max="12" style="width:50px">
            </div>
            <div class="lifecycle-row">
                <label>Длительность (дн):</label>
                <input type="number" class="lc-au-input" data-path="omegaverse.rut.durationDays" value="${au.rut.durationDays}" min="1" max="14" style="width:50px">
            </div>
            <div class="lifecycle-row">
                <label>Интенсивность:</label>
                <select class="lc-au-input" data-path="omegaverse.rut.intensity">
                    <option value="mild" ${au.rut.intensity === "mild" ? "selected" : ""}>Лёгкая</option>
                    <option value="moderate" ${au.rut.intensity === "moderate" ? "selected" : ""}>Средняя</option>
                    <option value="severe" ${au.rut.intensity === "severe" ? "selected" : ""}>Сильная</option>
                </select>
            </div>
            <div class="lifecycle-row">
                <label><input type="checkbox" class="lc-au-check" data-path="omegaverse.rut.syncWithPartnerHeat" ${au.rut.syncWithPartnerHeat ? "checked" : ""}> Синхронизация с течкой партнёра</label>
            </div>

            <h5 style="margin:8px 0 4px;">🔗 Узел (Knot)</h5>
            <div class="lifecycle-row">
                <label><input type="checkbox" class="lc-au-check" data-path="omegaverse.knot.enabled" ${au.knot.enabled ? "checked" : ""}> Включён</label>
            </div>
            <div class="lifecycle-row">
                <label>Размер:</label>
                <select class="lc-au-input" data-path="omegaverse.knot.size">
                    <option value="small" ${au.knot.size === "small" ? "selected" : ""}>Маленький</option>
                    <option value="medium" ${au.knot.size === "medium" ? "selected" : ""}>Средний</option>
                    <option value="large" ${au.knot.size === "large" ? "selected" : ""}>Большой</option>
                </select>
            </div>
            <div class="lifecycle-row">
                <label>Сцепка (мин):</label>
                <input type="number" class="lc-au-input" data-path="omegaverse.knot.lockDurationMin" value="${au.knot.lockDurationMin}" min="5" max="60" style="width:50px">
            </div>

            <h5 style="margin:8px 0 4px;">💕 Связь (Bond)</h5>
            <div class="lifecycle-row">
                <label><input type="checkbox" class="lc-au-check" data-path="omegaverse.bond.enabled" ${au.bond.enabled ? "checked" : ""}> Включена</label>
            </div>
            <div class="lifecycle-row">
                <label>Тип:</label>
                <select class="lc-au-input" data-path="omegaverse.bond.type">
                    <option value="bite_mark" ${au.bond.type === "bite_mark" ? "selected" : ""}>Укус (метка)</option>
                    <option value="magical" ${au.bond.type === "magical" ? "selected" : ""}>Магическая</option>
                    <option value="mental" ${au.bond.type === "mental" ? "selected" : ""}>Ментальная</option>
                    <option value="scent" ${au.bond.type === "scent" ? "selected" : ""}>Запаховая</option>
                </select>
            </div>

            <h5 style="margin:8px 0 4px;">🤰 Беременность</h5>
            <div class="lifecycle-row">
                <label>Кто может забеременеть:</label>
                <select class="lc-au-input" data-path="omegaverse.whoCanConceive">
                    <option value="females_only" ${au.whoCanConceive === "females_only" ? "selected" : ""}>Только женщины</option>
                    <option value="females_and_male_omegas" ${au.whoCanConceive === "females_and_male_omegas" ? "selected" : ""}>Женщины + муж. омеги</option>
                    <option value="all_omegas" ${au.whoCanConceive === "all_omegas" ? "selected" : ""}>Все омеги</option>
                    <option value="custom" ${au.whoCanConceive === "custom" ? "selected" : ""}>Кастом</option>
                </select>
            </div>
            <div class="lifecycle-row">
                <label><input type="checkbox" class="lc-au-check" data-path="omegaverse.malePregnancy.enabled" ${au.malePregnancy.enabled ? "checked" : ""}> Мужская беременность</label>
            </div>
            <div class="lifecycle-row">
                <label>Способ родов (муж.):</label>
                <select class="lc-au-input" data-path="omegaverse.malePregnancy.birthMethod">
                    <option value="caesarean" ${au.malePregnancy.birthMethod === "caesarean" ? "selected" : ""}>Кесарево</option>
                    <option value="magical_birth_canal" ${au.malePregnancy.birthMethod === "magical_birth_canal" ? "selected" : ""}>Магический родовой канал</option>
                    <option value="anal" ${au.malePregnancy.birthMethod === "anal" ? "selected" : ""}>Анальные</option>
                    <option value="custom" ${au.malePregnancy.birthMethod === "custom" ? "selected" : ""}>Кастом</option>
                </select>
            </div>
            <div class="lifecycle-row">
                <label>Длительность (нед):</label>
                <input type="number" class="lc-au-input" data-path="omegaverse.pregnancyDurationWeeks" value="${au.pregnancyDurationWeeks}" min="20" max="60" style="width:50px">
            </div>
        </div>`;

        // Привязка обработчиков для AU инпутов
        bindAUInputs();
    } else if (settings.auPreset === "realism") {
        container.innerHTML = '<div style="font-size:11px; padding:8px;">Режим реализма. Все параметры соответствуют реальной биологии. Дополнительных настроек нет.</div>';
    } else if (settings.auPreset === "fantasy") {
        const au = settings.auSettings.fantasy;
        let raceHTML = "";
        Object.entries(au.pregnancyByRace).forEach(([race, weeks]) => {
            raceHTML += `<div class="lifecycle-row">
                <label>${race}:</label>
                <input type="number" class="lc-au-race-input" data-race="${race}" value="${weeks}" min="4" max="100" style="width:50px"> нед.
            </div>`;
        });

        container.innerHTML = `
        <div style="font-size:11px;">
            <h5 style="margin:8px 0 4px;">🧬 Длительность беременности по расе</h5>
            ${raceHTML}
            <div class="lifecycle-row">
                <label><input type="checkbox" id="lc-au-fantasy-features" ${au.nonHumanFeatures ? "checked" : ""}> Нечеловеческие черты у детей</label>
            </div>
            <div class="lifecycle-row">
                <label><input type="checkbox" id="lc-au-fantasy-magic" ${au.magicalComplications ? "checked" : ""}> Магические осложнения</label>
            </div>
        </div>`;

        document.querySelectorAll(".lc-au-race-input").forEach(input => {
            input.addEventListener("change", function() {
                settings.auSettings.fantasy.pregnancyByRace[this.dataset.race] = parseInt(this.value) || 40;
                saveSettingsDebounced();
            });
        });

        document.getElementById("lc-au-fantasy-features")?.addEventListener("change", function() {
            settings.auSettings.fantasy.nonHumanFeatures = this.checked;
            saveSettingsDebounced();
        });

        document.getElementById("lc-au-fantasy-magic")?.addEventListener("change", function() {
            settings.auSettings.fantasy.magicalComplications = this.checked;
            saveSettingsDebounced();
        });
    } else if (settings.auPreset === "scifi") {
        const au = settings.auSettings.scifi;
        container.innerHTML = `
        <div style="font-size:11px;">
            <div class="lifecycle-row">
                <label><input type="checkbox" id="lc-au-scifi-womb" ${au.artificialWomb ? "checked" : ""}> Искусственная матка</label>
            </div>
            <div class="lifecycle-row">
                <label><input type="checkbox" id="lc-au-scifi-gene" ${au.geneticModification ? "checked" : ""}> Генная модификация</label>
            </div>
            <div class="lifecycle-row">
                <label><input type="checkbox" id="lc-au-scifi-growth" ${au.acceleratedGrowth ? "checked" : ""}> Ускоренный рост</label>
            </div>
        </div>`;

        document.getElementById("lc-au-scifi-womb")?.addEventListener("change", function() {
            settings.auSettings.scifi.artificialWomb = this.checked;
            saveSettingsDebounced();
        });
        document.getElementById("lc-au-scifi-gene")?.addEventListener("change", function() {
            settings.auSettings.scifi.geneticModification = this.checked;
            saveSettingsDebounced();
        });
        document.getElementById("lc-au-scifi-growth")?.addEventListener("change", function() {
            settings.auSettings.scifi.acceleratedGrowth = this.checked;
            saveSettingsDebounced();
        });
    } else {
        container.innerHTML = '<div style="font-size:11px; padding:8px;">Кастомный режим. Настройте параметры вручную через экспорт/импорт JSON.</div>';
    }
}

function bindAUInputs() {
    const settings = extension_settings[extensionName];

    document.querySelectorAll(".lc-au-input").forEach(input => {
        input.addEventListener("change", function() {
            const path = this.dataset.path.split(".");
            let obj = settings.auSettings;
            for (let i = 0; i < path.length - 1; i++) {
                obj = obj[path[i]];
            }
            const lastKey = path[path.length - 1];
            const val = this.type === "number" ? parseInt(this.value) : this.value;
            obj[lastKey] = val;
            saveSettingsDebounced();
        });
    });

    document.querySelectorAll(".lc-au-check").forEach(input => {
        input.addEventListener("change", function() {
            const path = this.dataset.path.split(".");
            let obj = settings.auSettings;
            for (let i = 0; i < path.length - 1; i++) {
                obj = obj[path[i]];
            }
            obj[path[path.length - 1]] = this.checked;
            saveSettingsDebounced();
        });
    });
}

// ==========================================
// ХУКИ СОБЫТИЙ SILLYTAVERN
// ==========================================

function onMessageReceived(messageIndex) {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || settings.worldDate.frozen) return;

    const context = getContext();
    if (!context.chat || messageIndex < 0) return;

    const message = context.chat[messageIndex];
    if (!message || !message.mes) return;

    // Парсим время из сообщения AI
    if (settings.autoTimeProgress && !message.is_user) {
        const parseResult = TimeParser.parseMessage(message.mes);

        if (parseResult) {
            if (settings.timeParserConfirmation && parseResult.days && parseResult.days > 0) {
                const confirmed = confirm(
                    `⏱️ LifeCycle: Обнаружен сдвиг времени: +${parseResult.days} дн.\n` +
                    `Текущая дата: ${formatDate(settings.worldDate)}\n` +
                    `Применить?`
                );
                if (confirmed) {
                    TimeParser.applyTimeChange(parseResult);
                    updateUI();
                }
            } else {
                TimeParser.applyTimeChange(parseResult);
                updateUI();
            }
        }
    }
}

function onChatChanged() {
    updateUI();
}

function getPromptInjection() {
    const settings = extension_settings[extensionName];
    if (!settings.enabled) return "";

    return PromptInjector.generateInjection();
}

// ==========================================
// ИНИЦИАЛИЗАЦИЯ РАСШИРЕНИЯ
// ==========================================

jQuery(async () => {
    // Загрузка настроек
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`).catch(() => null);

    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    extension_settings[extensionName] = deepMerge(defaultSettings, extension_settings[extensionName]);

    // Инъекция стилей
    injectStyles();

    // Рендер UI
    const settingsContainer = settingsHtml
        ? $(settingsHtml)
        : $(generateSettingsHTML());

    $("#extensions_settings").append(settingsContainer);

    // Привязка событий UI
    bindEvents();

    // Привязка событий для селектов с отложенным обновлением
    document.getElementById("lc-cycle-char-select")?.addEventListener("change", updateCyclePanel);
    document.getElementById("lc-preg-char-select")?.addEventListener("change", updatePregnancyPanel);
    document.getElementById("lc-labor-char-select")?.addEventListener("change", updateLaborPanel);
    document.getElementById("lc-baby-parent-select")?.addEventListener("change", updateBabyList);

    // Первичное обновление UI
    updateUI();
    renderAUSettings();

    // Подписка на события SillyTavern
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageIndex) => {
        onMessageReceived(messageIndex);
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        onChatChanged();
    });

    // Инъекция в промпт через хук
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (eventData) => {
        const settings = extension_settings[extensionName];
        if (!settings.enabled) return;

        const injection = getPromptInjection();
        if (!injection) return;

        const position = settings.promptInjectionPosition;

        switch (position) {
            case "system":
                if (eventData.systemPrompt) {
                    eventData.systemPrompt += "\n\n" + injection;
                }
                break;
            case "authornote":
                if (eventData.authorNote !== undefined) {
                    eventData.authorNote = (eventData.authorNote || "") + "\n\n" + injection;
                }
                break;
            case "endofchat":
                if (eventData.chat && Array.isArray(eventData.chat)) {
                    eventData.chat.push({
                        role: "system",
                        content: injection,
                    });
                }
                break;
        }
    });

    console.log("[LifeCycle] Extension loaded successfully! v0.1.0-alpha");
});

// ==========================================
// ЭКСПОРТ ДЛЯ ВНЕШНЕГО ДОСТУПА
// ==========================================

window.LifeCycle = {
    CycleManager,
    PregnancyManager,
    LaborManager,
    BabyManager,
    IntimacyManager,
    OmegaverseManager,
    TimeParser,
    PromptInjector,
    getSettings: () => extension_settings[extensionName],
    getInjection: getPromptInjection,
    advanceTime: (days) => {
        const settings = extension_settings[extensionName];
        const newDate = addDays(settings.worldDate, days);
        settings.worldDate = newDate;
        TimeParser.advanceAllCharacters(days);
        saveSettingsDebounced();
        updateUI();
    },
    rollDice: (charName, intimacyEntry) => {
        return IntimacyManager.calculatePregnancyChance(charName, intimacyEntry);
    },
    getCharacterStatus: (charName) => {
        const settings = extension_settings[extensionName];
        const profile = settings.characters[charName];
        if (!profile) return null;

        const result = { name: charName };

        if (profile.cycle?.enabled) {
            const cm = new CycleManager(profile);
            result.cycle = {
                phase: cm.getPhaseLabel(cm.getCurrentPhase()),
                day: profile.cycle.currentDay,
                length: profile.cycle.length,
                fertility: cm.getFertility(),
                libido: cm.getLibido(),
                symptoms: cm.getSymptoms(),
            };
        }

        if (profile.pregnancy?.active) {
            const pm = new PregnancyManager(profile);
            result.pregnancy = {
                week: profile.pregnancy.week,
                trimester: pm.getTrimester(),
                fetalSize: pm.getFetalSize(),
                symptoms: pm.getSymptoms(),
                movements: pm.getMovements(),
            };
        }

        if (profile.labor?.active) {
            result.labor = {
                stage: profile.labor.stage,
                dilation: profile.labor.dilation,
                hoursElapsed: profile.labor.hoursElapsed,
            };
        }

        if (profile.babies?.length > 0) {
            result.babies = profile.babies.map(b => {
                const bm = new BabyManager(b);
                return {
                    name: b.name,
                    age: bm.getAgeLabel(),
                    state: b.state,
                };
            });
        }

        return result;
    },
};
