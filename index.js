// ============================================================
// LifeCycle Extension v0.2.0 — index.js (Full Rewrite)
// Auto-pulls characters from SillyTavern context
// All settings inline (no prompt() dialogs)
// ============================================================

import {
    extension_settings,
    getContext,
    saveSettingsDebounced,
} from "../../../extensions.js";

import {
    eventSource,
    event_types,
} from "../../../../script.js";

const extensionName = "lifecycle";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// ==========================================
// DEFAULT SETTINGS
// ==========================================

const defaultSettings = {
    enabled: true,
    autoSyncCharacters: true,

    // Modules toggle
    modules: {
        cycle: true,
        pregnancy: true,
        labor: true,
        baby: true,
        intimacy: true,
        auOverlay: false,
    },

    // World date
    worldDate: {
        year: 2025,
        month: 1,
        day: 1,
        hour: 12,
        minute: 0,
        frozen: false,
    },

    // Time parser
    autoTimeProgress: true,
    timeParserSensitivity: "medium",
    timeParserConfirmation: true,

    // Prompt injection
    promptInjectionEnabled: true,
    promptInjectionPosition: "authornote",
    promptInjectionDetail: "medium",

    // AU overlay
    auPreset: "realism",
    auSettings: {
        omegaverse: {
            heatCycleLength: 30,
            heatDuration: 5,
            heatFertilityBonus: 0.35,
            rutDuration: 4,
            knotEnabled: true,
            bondingEnabled: true,
            suppressantsAvailable: true,
            maleOmegaPregnancy: true,
        },
        fantasy: {
            pregnancyByRace: {
                human: 40,
                elf: 60,
                dwarf: 35,
                orc: 32,
                halfling: 38,
            },
            nonHumanFeatures: true,
            magicalComplications: false,
        },
        scifi: {
            artificialWomb: false,
            geneticModification: false,
            acceleratedGrowth: false,
        },
    },

    // Character profiles (auto-populated from context)
    characters: {},

    // Logs
    diceLog: [],
    intimacyLog: [],

    // UI state
    activeTab: "dashboard",
    editingCharacter: null,
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (
            source[key] &&
            typeof source[key] === "object" &&
            !Array.isArray(source[key]) &&
            target[key] &&
            typeof target[key] === "object" &&
            !Array.isArray(target[key])
        ) {
            result[key] = deepMerge(target[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

function formatDate(dateObj) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${dateObj.year}/${pad(dateObj.month)}/${pad(dateObj.day)} ${pad(dateObj.hour)}:${pad(dateObj.minute)}`;
}

function addDays(dateObj, days) {
    const d = new Date(dateObj.year, dateObj.month - 1, dateObj.day, dateObj.hour, dateObj.minute);
    d.setDate(d.getDate() + days);
    return {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        hour: d.getHours(),
        minute: d.getMinutes(),
        frozen: dateObj.frozen,
    };
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function rollDice(sides = 100) {
    return Math.floor(Math.random() * sides) + 1;
}

// ==========================================
// CHARACTER SYNC FROM SILLYTAVERN CONTEXT
// ==========================================

function getActiveCharacters() {
    const context = getContext();
    const chars = [];

    if (!context) return chars;

    // Get current character (1-on-1 chat)
    if (context.characterId !== undefined && context.characters) {
        const charIndex = context.characterId;
        const charData = context.characters[charIndex];
        if (charData) {
            chars.push({
                name: charData.name,
                avatar: charData.avatar,
                description: charData.description || "",
                personality: charData.personality || "",
                isUser: false,
            });
        }
    }

    // Get group members (group chat)
    if (context.groups && context.groupId) {
        const group = context.groups.find(g => g.id === context.groupId);
        if (group && group.members) {
            for (const memberAvatar of group.members) {
                const charData = context.characters.find(c => c.avatar === memberAvatar);
                if (charData) {
                    chars.push({
                        name: charData.name,
                        avatar: charData.avatar,
                        description: charData.description || "",
                        personality: charData.personality || "",
                        isUser: false,
                    });
                }
            }
        }
    }

    // Add user/persona
    if (context.name1) {
        chars.push({
            name: context.name1,
            avatar: null,
            description: "",
            personality: "",
            isUser: true,
        });
    }

    return chars;
}

function syncCharactersFromContext() {
    const settings = extension_settings[extensionName];
    if (!settings.autoSyncCharacters) return;

    const activeChars = getActiveCharacters();
    if (activeChars.length === 0) return;

    let changed = false;

    for (const char of activeChars) {
        if (!settings.characters[char.name]) {
            // Create new profile for this character
            settings.characters[char.name] = createDefaultProfile(char.name, char.isUser);
            settings.characters[char.name]._avatar = char.avatar;
            settings.characters[char.name]._isUser = char.isUser;
            settings.characters[char.name]._synced = true;
            changed = true;
        } else {
            // Update avatar reference
            if (char.avatar && settings.characters[char.name]._avatar !== char.avatar) {
                settings.characters[char.name]._avatar = char.avatar;
                changed = true;
            }
        }
    }

    if (changed) {
        saveSettingsDebounced();
    }
}

function createDefaultProfile(name, isUser = false) {
    return {
        name: name,
        bioSex: "F",
        secondarySex: null,
        contraception: "none",
        eyeColor: "",
        hairColor: "",
        pregnancyDifficulty: "normal",
        _avatar: null,
        _isUser: isUser,
        _synced: true,
        _enabled: true,

        cycle: {
            enabled: true,
            currentDay: 1,
            baseLength: 28,
            length: 28,
            menstruationDuration: 5,
            irregularity: 2,
            symptomIntensity: "moderate",
            cycleCount: 0,
            lastOvulation: null,
        },

        pregnancy: {
            active: false,
            week: 0,
            day: 0,
            maxWeeks: 40,
            father: null,
            fetusCount: 1,
            complications: [],
            symptoms: [],
            weightGain: 0,
            started: null,
        },

        labor: {
            active: false,
            stage: "latent",
            dilation: 0,
            effacement: 0,
            contractionInterval: 0,
            contractionDuration: 0,
            hoursElapsed: 0,
            pushCount: 0,
            complications: [],
            babiesDelivered: 0,
            totalBabies: 1,
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

// ==========================================
// CYCLE MANAGER
// ==========================================

class CycleManager {
    constructor(profile) {
        this.profile = profile;
        this.cycle = profile.cycle;
    }

    getCurrentPhase() {
        if (!this.cycle || !this.cycle.enabled) return "unknown";
        const day = this.cycle.currentDay;
        const len = this.cycle.length;
        const mensDur = this.cycle.menstruationDuration;
        const ovulationDay = Math.round(len - 14);

        if (day <= mensDur) return "menstruation";
        if (day < ovulationDay - 2) return "follicular";
        if (day >= ovulationDay - 2 && day <= ovulationDay + 1) return "ovulation";
        return "luteal";
    }

    getPhaseLabel(phase) {
        const labels = {
            menstruation: "Менструация",
            follicular: "Фолликулярная",
            ovulation: "Овуляция",
            luteal: "Лютеиновая",
            unknown: "Неизвестно",
        };
        return labels[phase] || phase;
    }

    getFertility() {
        const phase = this.getCurrentPhase();
        const settings = extension_settings[extensionName];

        let baseFertility = 0;
        switch (phase) {
            case "ovulation": baseFertility = 0.25; break;
            case "follicular":
                const ovDay = Math.round(this.cycle.length - 14);
                const daysToOv = ovDay - this.cycle.currentDay;
                if (daysToOv <= 4) baseFertility = 0.12;
                else baseFertility = 0.03;
                break;
            case "luteal": baseFertility = 0.02; break;
            case "menstruation": baseFertility = 0.01; break;
            default: baseFertility = 0.05;
        }

        // AU bonus
        if (settings.modules.auOverlay && settings.auPreset === "omegaverse") {
            if (this.profile.heat?.active) {
                baseFertility += settings.auSettings.omegaverse.heatFertilityBonus;
            }
        }

        return Math.min(baseFertility, 0.95);
    }

    getLibido() {
        const phase = this.getCurrentPhase();
        switch (phase) {
            case "ovulation": return "high";
            case "follicular": return "medium";
            case "luteal": return "low-medium";
            case "menstruation": return "low";
            default: return "medium";
        }
    }

    getSymptoms() {
        const phase = this.getCurrentPhase();
        const intensity = this.cycle.symptomIntensity;
        const symptoms = [];

        switch (phase) {
            case "menstruation":
                symptoms.push("кровотечение");
                if (intensity !== "mild") symptoms.push("спазмы");
                if (intensity === "severe") symptoms.push("сильная боль", "тошнота");
                break;
            case "follicular":
                symptoms.push("прилив энергии");
                break;
            case "ovulation":
                symptoms.push("повышенное либидо", "овуляторная боль");
                if (intensity !== "mild") symptoms.push("чувствительность груди");
                break;
            case "luteal":
                symptoms.push("ПМС");
                if (intensity !== "mild") symptoms.push("вздутие", "перепады настроения");
                if (intensity === "severe") symptoms.push("раздражительность", "головная боль");
                break;
        }

        return symptoms;
    }

    getDischarge() {
        const phase = this.getCurrentPhase();
        switch (phase) {
            case "menstruation": return "менструальные выделения";
            case "follicular": return "скудные, сухо";
            case "ovulation": return "обильные, прозрачные, тягучие (яичный белок)";
            case "luteal": return "густые, белые/кремовые";
            default: return "обычные";
        }
    }

    advanceDay(days = 1) {
        for (let i = 0; i < days; i++) {
            this.cycle.currentDay++;
            if (this.cycle.currentDay > this.cycle.length) {
                this.cycle.currentDay = 1;
                this.cycle.cycleCount = (this.cycle.cycleCount || 0) + 1;

                // Apply irregularity
                if (this.cycle.irregularity > 0) {
                    const variance = Math.floor(Math.random() * this.cycle.irregularity * 2) - this.cycle.irregularity;
                    this.cycle.length = clamp(this.cycle.baseLength + variance, 21, 45);
                }
            }
        }
    }
}

// ==========================================
// PREGNANCY MANAGER
// ==========================================

class PregnancyManager {
    constructor(profile) {
        this.profile = profile;
        this.preg = profile.pregnancy;
    }

    isPregnant() {
        return this.preg && this.preg.active;
    }

    startPregnancy(fatherName, fetusCount = 1) {
        const settings = extension_settings[extensionName];
        this.preg.active = true;
        this.preg.week = 1;
        this.preg.day = 0;
        this.preg.father = fatherName;
        this.preg.fetusCount = fetusCount;
        this.preg.complications = [];
        this.preg.symptoms = [];
        this.preg.weightGain = 0;
        this.preg.started = { ...settings.worldDate };

        // Disable cycle during pregnancy
        if (this.profile.cycle) {
            this.profile.cycle.enabled = false;
        }

        // Set max weeks based on AU
        if (settings.auPreset === "fantasy" && this.profile.race) {
            const raceWeeks = settings.auSettings.fantasy.pregnancyByRace[this.profile.race];
            if (raceWeeks) this.preg.maxWeeks = raceWeeks;
        } else {
            this.preg.maxWeeks = 40;
        }

        // Multi-fetus adjusts duration
        if (fetusCount > 1) {
            this.preg.maxWeeks = Math.max(28, this.preg.maxWeeks - (fetusCount - 1) * 3);
        }
    }

    advanceDay(days = 1) {
        if (!this.isPregnant()) return;
        this.preg.day += days;
        while (this.preg.day >= 7) {
            this.preg.day -= 7;
            this.preg.week++;
        }

        this.preg.weightGain = this.getWeightGain();
    }

    getTrimester() {
        if (this.preg.week <= 12) return 1;
        if (this.preg.week <= 27) return 2;
        return 3;
    }

    getFetalSize() {
        const w = this.preg.week;
        const sizes = {
            4: "маковое зерно (2мм)",
            5: "кунжутное семя (3мм)",
            6: "чечевица (5мм)",
            7: "черника (8мм)",
            8: "малина (1.5см)",
            9: "виноградина (2.3см)",
            10: "кумкват (3см)",
            11: "инжир (4см)",
            12: "лайм (5.5см)",
            13: "стручок гороха (7см)",
            14: "лимон (8.5см)",
            16: "авокадо (11.5см)",
            18: "болгарский перец (14см)",
            20: "банан (16.5см)",
            22: "папайя (19см)",
            24: "початок кукурузы (21см)",
            26: "кабачок (23см)",
            28: "баклажан (25см)",
            30: "кочан капусты (27см)",
            32: "тыква-хоккайдо (29см)",
            34: "ананас (32см)",
            36: "папайя крупная (34см)",
            38: "лук-порей (36см)",
            40: "арбуз (38-40см)",
        };

        let closest = "";
        let closestWeek = 0;
        for (const [week, size] of Object.entries(sizes)) {
            if (parseInt(week) <= w) {
                closest = size;
                closestWeek = parseInt(week);
            }
        }
        return closest || "эмбрион";
    }

    getSymptoms() {
        const w = this.preg.week;
        const symptoms = [];
        const difficulty = this.profile.pregnancyDifficulty || "normal";

        if (w >= 4 && w <= 14) {
            symptoms.push("тошнота");
            if (difficulty !== "easy") symptoms.push("утренняя рвота");
            if (w >= 6) symptoms.push("усталость", "чувствительность груди");
            if (difficulty === "severe" || difficulty === "complicated") symptoms.push("сильный токсикоз");
        }
        if (w >= 12 && w <= 20) {
            symptoms.push("улучшение самочувствия");
            if (w >= 16) symptoms.push("рост живота заметен");
        }
        if (w >= 20) {
            symptoms.push("боль в пояснице");
            if (w >= 24) symptoms.push("отёки ног");
            if (w >= 28) symptoms.push("одышка", "частое мочеиспускание");
            if (w >= 32) symptoms.push("тренировочные схватки");
            if (w >= 36) symptoms.push("опущение живота", "давление в тазу");
        }

        if (this.preg.fetusCount > 1) {
            symptoms.push("увеличенная нагрузка (многоплодная)");
        }

        return symptoms;
    }

    getMovements() {
        const w = this.preg.week;
        if (w < 16) return "нет ощущений";
        if (w < 20) return "лёгкие трепетания (бабочки)";
        if (w < 24) return "заметные толчки";
        if (w < 30) return "активные движения, толчки, повороты";
        if (w < 36) return "сильные толчки, видно снаружи";
        return "менее активные (мало места), но ощутимые";
    }

    getWeightGain() {
        const w = this.preg.week;
        if (w <= 12) return Math.round(w * 0.2 * 10) / 10;
        if (w <= 27) return Math.round((2.4 + (w - 12) * 0.45) * 10) / 10;
        return Math.round((9.15 + (w - 27) * 0.4) * 10) / 10;
    }

    getBodyChanges() {
        const w = this.preg.week;
        const changes = [];

        if (w >= 6) changes.push("грудь увеличивается");
        if (w >= 12) changes.push("живот начинает округляться");
        if (w >= 16) changes.push("тёмная линия на животе (linea nigra)");
        if (w >= 20) changes.push("живот явно виден");
        if (w >= 24) changes.push("растяжки могут появиться");
        if (w >= 28) changes.push("пупок выпирает");
        if (w >= 32) changes.push("живот большой, затрудняет движение");
        if (w >= 36) changes.push("живот опускается");

        return changes;
    }

    getEmotionalState() {
        const trimester = this.getTrimester();
        switch (trimester) {
            case 1: return "тревога, перепады настроения, усталость";
            case 2: return "стабильнее, прилив энергии, привязанность к ребёнку";
            case 3: return "нетерпение, тревога перед родами, гнездование";
            default: return "стабильное";
        }
    }

    getNextAppointment() {
        const w = this.preg.week;
        if (w < 28) return `неделя ${Math.ceil((w + 1) / 4) * 4}`;
        if (w < 36) return `неделя ${w + 2}`;
        return `неделя ${w + 1}`;
    }
}

// ==========================================
// LABOR MANAGER
// ==========================================

class LaborManager {
    constructor(profile) {
        this.profile = profile;
        this.labor = profile.labor;
    }

    isInLabor() {
        return this.labor && this.labor.active;
    }

    startLabor() {
        this.labor.active = true;
        this.labor.stage = "latent";
        this.labor.dilation = 0;
        this.labor.effacement = 0;
        this.labor.contractionInterval = 20;
        this.labor.contractionDuration = 30;
        this.labor.hoursElapsed = 0;
        this.labor.pushCount = 0;
        this.labor.complications = [];
        this.labor.babiesDelivered = 0;
        this.labor.totalBabies = this.profile.pregnancy?.fetusCount || 1;
    }

    advanceStage() {
        const stages = ["latent", "active", "transition", "pushing", "birth", "placenta"];
        const currentIndex = stages.indexOf(this.labor.stage);

        if (currentIndex < stages.length - 1) {
            this.labor.stage = stages[currentIndex + 1];
            this.updateStageParameters();
        }
    }

    updateStageParameters() {
        switch (this.labor.stage) {
            case "latent":
                this.labor.dilation = clamp(this.labor.dilation, 0, 3);
                this.labor.contractionInterval = 15;
                this.labor.contractionDuration = 30;
                break;
            case "active":
                this.labor.dilation = clamp(this.labor.dilation, 4, 7);
                this.labor.contractionInterval = 5;
                this.labor.contractionDuration = 50;
                break;
            case "transition":
                this.labor.dilation = clamp(this.labor.dilation, 7, 10);
                this.labor.contractionInterval = 2;
                this.labor.contractionDuration = 70;
                break;
            case "pushing":
                this.labor.dilation = 10;
                this.labor.effacement = 100;
                break;
            case "birth":
                this.labor.dilation = 10;
                break;
            case "placenta":
                break;
        }
    }

    getStageDescription() {
        const descriptions = {
            latent: "Латентная фаза: лёгкие нерегулярные схватки, раскрытие шейки матки до 3-4 см. Можно двигаться, разговаривать.",
            active: "Активная фаза: схватки усиливаются, раскрытие 4-7 см. Интервалы сокращаются. Дыхательные техники.",
            transition: "Переходная фаза: самая интенсивная. Раскрытие 7-10 см. Схватки очень частые и сильные. Позывы тужиться.",
            pushing: "Потуги: полное раскрытие. Активные потуги, ребёнок продвигается по родовому каналу.",
            birth: "Рождение: головка прорезывается, ребёнок появляется на свет.",
            placenta: "Рождение плаценты: послед выходит в течение 5-30 минут после рождения ребёнка.",
        };
        return descriptions[this.labor.stage] || "";
    }

    completeBirth() {
        this.labor.babiesDelivered++;
        if (this.labor.babiesDelivered >= this.labor.totalBabies) {
            this.labor.stage = "placenta";
        } else {
            this.labor.stage = "pushing";
        }
    }

    endLabor() {
        this.labor.active = false;
        this.profile.pregnancy.active = false;
        // Re-enable cycle
        if (this.profile.cycle) {
            this.profile.cycle.enabled = true;
            this.profile.cycle.currentDay = 1;
        }
    }
}

// ==========================================
// BABY MANAGER
// ==========================================

class BabyManager {
    constructor(baby) {
        this.baby = baby;
    }

    static generateBaby(motherProfile, fatherName) {
        const settings = extension_settings[extensionName];
        const sexRoll = Math.random();
        const sex = sexRoll < 0.5 ? "M" : "F";

        // Genetics
        const motherEye = motherProfile.eyeColor || "карие";
        const fatherProfile = settings.characters[fatherName];
        const fatherEye = fatherProfile?.eyeColor || "карие";
        const eyeColor = Math.random() < 0.5 ? motherEye : fatherEye;

        const motherHair = motherProfile.hairColor || "тёмные";
        const fatherHair = fatherProfile?.hairColor || "тёмные";
        const hairColor = Math.random() < 0.5 ? motherHair : fatherHair;

        // Secondary sex (omegaverse)
        let secondarySex = null;
        if (settings.modules.auOverlay && settings.auPreset === "omegaverse") {
            const roll = Math.random();
            if (roll < 0.25) secondarySex = "alpha";
            else if (roll < 0.75) secondarySex = "beta";
            else secondarySex = "omega";
        }

        // Non-human features (fantasy)
        const nonHumanFeatures = [];
        if (settings.modules.auOverlay && settings.auPreset === "fantasy" && settings.auSettings.fantasy.nonHumanFeatures) {
            if (Math.random() < 0.3) nonHumanFeatures.push("заострённые уши");
            if (Math.random() < 0.2) nonHumanFeatures.push("необычный цвет глаз");
        }

        // Weight
        const baseWeight = 3200 + Math.floor(Math.random() * 800) - 400;
        const weight = motherProfile.pregnancy?.fetusCount > 1
            ? Math.round(baseWeight * 0.85)
            : baseWeight;

        return {
            name: "",
            sex: sex,
            secondarySex: secondarySex,
            birthWeight: weight,
            currentWeight: weight,
            birthDate: { ...settings.worldDate },
            ageDays: 0,
            eyeColor: eyeColor,
            hairColor: hairColor,
            mother: motherProfile.name,
            father: fatherName,
            nonHumanFeatures: nonHumanFeatures,
            state: "newborn",
            milestones: [],
        };
    }

    getAgeLabel() {
        const days = this.baby.ageDays;
        if (days < 1) return "новорождённый";
        if (days < 7) return `${days} дн.`;
        if (days < 30) return `${Math.floor(days / 7)} нед.`;
        if (days < 365) return `${Math.floor(days / 30)} мес.`;
        const years = Math.floor(days / 365);
        const months = Math.floor((days % 365) / 30);
        return months > 0 ? `${years} г. ${months} мес.` : `${years} г.`;
    }

    getCurrentMilestones() {
        const days = this.baby.ageDays;
        const milestones = [];

        if (days >= 1) milestones.push("пуповина обработана");
        if (days >= 14) milestones.push("фокусирует взгляд");
        if (days >= 42) milestones.push("первая улыбка");
        if (days >= 90) milestones.push("держит голову");
        if (days >= 120) milestones.push("хватает предметы");
        if (days >= 150) milestones.push("переворачивается");
        if (days >= 180) milestones.push("сидит с поддержкой");
        if (days >= 240) milestones.push("ползает");
        if (days >= 270) milestones.push("сидит сам");
        if (days >= 300) milestones.push("встаёт у опоры");
        if (days >= 365) milestones.push("первые шаги");
        if (days >= 365) milestones.push("первые слова");
        if (days >= 545) milestones.push("фразы из 2 слов");
        if (days >= 730) milestones.push("бегает");

        return milestones;
    }

    updateGrowth() {
        const days = this.baby.ageDays;
        // Approximate weight gain
        if (days <= 120) {
            this.baby.currentWeight = this.baby.birthWeight + days * 30;
        } else if (days <= 365) {
            this.baby.currentWeight = this.baby.birthWeight + 3600 + (days - 120) * 15;
        } else {
            this.baby.currentWeight = this.baby.birthWeight + 7275 + (days - 365) * 7;
        }

        // State
        if (days < 28) this.baby.state = "newborn";
        else if (days < 365) this.baby.state = "infant";
        else if (days < 1095) this.baby.state = "toddler";
        else this.baby.state = "child";
    }
}

// ==========================================
// INTIMACY MANAGER
// ==========================================

class IntimacyManager {
    static logIntimacy(entry) {
        const settings = extension_settings[extensionName];
        entry.timestamp = formatDate(settings.worldDate);
        settings.intimacyLog.push(entry);
        if (settings.intimacyLog.length > 100) {
            settings.intimacyLog = settings.intimacyLog.slice(-100);
        }
        saveSettingsDebounced();
    }

    static calculatePregnancyChance(targetChar, intimacyData) {
        const settings = extension_settings[extensionName];
        const profile = settings.characters[targetChar];
        if (!profile) return { result: false, chance: 0, roll: 0 };

        // Base fertility from cycle
        let fertility = 0.05;
        if (profile.cycle?.enabled) {
            const cm = new CycleManager(profile);
            fertility = cm.getFertility();
        }

        // Contraception effectiveness
        const contraceptionEffectiveness = {
            none: 0,
            condom: 0.85,
            pill: 0.91,
            iud: 0.99,
            patch: 0.91,
            injection: 0.94,
            withdrawal: 0.73,
        };
        const contraEff = contraceptionEffectiveness[profile.contraception] || 0;

        // Adjust fertility by contraception
        fertility = fertility * (1 - contraEff);

        // Ejaculation type modifier
        if (intimacyData.ejaculation === "outside") fertility *= 0.05;
        if (intimacyData.ejaculation === "oral" || intimacyData.ejaculation === "other") fertility = 0;

        // Act type
        if (intimacyData.type === "anal" || intimacyData.type === "oral" || intimacyData.type === "manual") {
            fertility = 0;
        }

        // Bio sex check
        if (profile.bioSex === "M" && !settings.auSettings?.omegaverse?.maleOmegaPregnancy) {
            fertility = 0;
        }
        if (profile.bioSex === "M" && settings.modules.auOverlay && settings.auPreset === "omegaverse") {
            if (profile.secondarySex !== "omega") fertility = 0;
        }

        // Already pregnant
        if (profile.pregnancy?.active) fertility = 0;

        // Clamp
        const chance = clamp(fertility, 0, 0.95);
        const percentChance = Math.round(chance * 100);

        // Roll
        const roll = rollDice(100);
        const result = roll <= percentChance;

        // Log
        const diceEntry = {
            timestamp: formatDate(settings.worldDate),
            targetChar: targetChar,
            participants: intimacyData.participants || [],
            chance: percentChance,
            roll: roll,
            result: result,
            contraception: profile.contraception,
            actType: intimacyData.type,
            ejaculation: intimacyData.ejaculation,
        };
        settings.diceLog.push(diceEntry);
        if (settings.diceLog.length > 50) {
            settings.diceLog = settings.diceLog.slice(-50);
        }
        saveSettingsDebounced();

        return diceEntry;
    }
}

// ==========================================
// OMEGAVERSE MANAGER
// ==========================================

class OmegaverseManager {
    constructor(profile) {
        this.profile = profile;
        this.settings = extension_settings[extensionName].auSettings.omegaverse;
    }

    advanceDay(days = 1) {
        if (!this.profile.secondarySex) return;

        if (this.profile.secondarySex === "omega") {
            this.advanceHeat(days);
        }
        if (this.profile.secondarySex === "alpha") {
            this.advanceRut(days);
        }
    }

    advanceHeat(days) {
        const heat = this.profile.heat;
        if (!heat) return;
        if (heat.onSuppressants) return;

        if (heat.active) {
            heat.currentDay += days;
            if (heat.currentDay > heat.duration) {
                heat.active = false;
                heat.currentDay = 0;
                heat.daysSinceLast = 0;
            }
        } else {
            heat.daysSinceLast += days;
            if (heat.daysSinceLast >= this.settings.heatCycleLength) {
                heat.active = true;
                heat.currentDay = 1;
                heat.duration = this.settings.heatDuration;
            }
        }
    }

    advanceRut(days) {
        const rut = this.profile.rut;
        if (!rut) return;

        if (rut.active) {
            rut.currentDay += days;
            if (rut.currentDay > rut.duration) {
                rut.active = false;
                rut.currentDay = 0;
                rut.daysSinceLast = 0;
            }
        } else {
            rut.daysSinceLast += days;
            if (rut.daysSinceLast >= this.settings.heatCycleLength + 5) {
                rut.active = true;
                rut.currentDay = 1;
                rut.duration = this.settings.rutDuration;
            }
        }
    }
}

// ==========================================
// TIME PARSER
// ==========================================

class TimeParser {
    static parseMessage(message) {
        const settings = extension_settings[extensionName];
        const sensitivity = settings.timeParserSensitivity;

        let days = 0;
        let hours = 0;

        // Explicit time markers
        const dayPatterns = [
            /прошл[оа]\s+(\d+)\s+(?:дн|дней|день)/gi,
            /через\s+(\d+)\s+(?:дн|дней|день)/gi,
            /спустя\s+(\d+)\s+(?:дн|дней|день)/gi,
            /(\d+)\s+(?:дн|дней|день)\s+спустя/gi,
        ];

        const weekPatterns = [
            /прошл[оа]\s+(\d+)\s+(?:недел|нед)/gi,
            /через\s+(\d+)\s+(?:недел|нед)/gi,
            /спустя\s+(\d+)\s+(?:недел|нед)/gi,
        ];

        const monthPatterns = [
            /прошл[оа]\s+(\d+)\s+(?:месяц|мес)/gi,
            /через\s+(\d+)\s+(?:месяц|мес)/gi,
            /спустя\s+(\d+)\s+(?:месяц|мес)/gi,
        ];

        const hourPatterns = [
            /прошл[оа]\s+(\d+)\s+(?:час|ч\.)/gi,
            /через\s+(\d+)\s+(?:час|ч\.)/gi,
            /спустя\s+(\d+)\s+(?:час|ч\.)/gi,
        ];

        for (const pat of dayPatterns) {
            let m;
            while ((m = pat.exec(message)) !== null) {
                days += parseInt(m[1]);
            }
        }

        for (const pat of weekPatterns) {
            let m;
            while ((m = pat.exec(message)) !== null) {
                days += parseInt(m[1]) * 7;
            }
        }

        for (const pat of monthPatterns) {
            let m;
            while ((m = pat.exec(message)) !== null) {
                days += parseInt(m[1]) * 30;
            }
        }

        for (const pat of hourPatterns) {
            let m;
            while ((m = pat.exec(message)) !== null) {
                hours += parseInt(m[1]);
            }
        }

        // Contextual markers (medium/high sensitivity)
        if (sensitivity !== "low") {
            if (/на следующ(?:ий|ее|ую)\s+(?:день|утро)/i.test(message)) days += 1;
            if (/на следующ(?:ей|ую)\s+неделе/i.test(message)) days += 7;
            if (/через\s+пару\s+дней/i.test(message)) days += 2;
            if (/через\s+несколько\s+дней/i.test(message)) days += 3;
        }

        // Implicit markers (high sensitivity only)
        if (sensitivity === "high") {
            if (/(?:вечер(?:ом)?|ночь(?:ю)?)\s+того\s+же\s+дня/i.test(message)) hours += 6;
            if (/утром/i.test(message) && !/это(?:го)?\s+утр/i.test(message)) hours += 8;
        }

        days += Math.floor(hours / 24);
        hours = hours % 24;

        if (days === 0 && hours === 0) return null;

        return { days, hours };
    }

    static applyTimeChange(parseResult) {
        const settings = extension_settings[extensionName];

        if (parseResult.days > 0) {
            settings.worldDate = addDays(settings.worldDate, parseResult.days);
            TimeParser.advanceAllCharacters(parseResult.days);
        }

        if (parseResult.hours > 0) {
            settings.worldDate.hour += parseResult.hours;
            if (settings.worldDate.hour >= 24) {
                const extraDays = Math.floor(settings.worldDate.hour / 24);
                settings.worldDate.hour = settings.worldDate.hour % 24;
                settings.worldDate = addDays(settings.worldDate, extraDays);
                TimeParser.advanceAllCharacters(extraDays);
            }
        }

        saveSettingsDebounced();
    }

    static advanceAllCharacters(days) {
        const settings = extension_settings[extensionName];

        Object.values(settings.characters).forEach((profile) => {
            if (!profile._enabled) return;

            // Cycle
            if (settings.modules.cycle && profile.cycle?.enabled && !profile.pregnancy?.active) {
                const cm = new CycleManager(profile);
                cm.advanceDay(days);
            }

            // Pregnancy
            if (settings.modules.pregnancy && profile.pregnancy?.active) {
                const pm = new PregnancyManager(profile);
                pm.advanceDay(days);
            }

            // AU
            if (settings.modules.auOverlay && settings.auPreset === "omegaverse") {
                const om = new OmegaverseManager(profile);
                om.advanceDay(days);
            }

            // Baby aging
            if (settings.modules.baby && profile.babies?.length > 0) {
                profile.babies.forEach((baby) => {
                    baby.ageDays += days;
                    const bm = new BabyManager(baby);
                    bm.updateGrowth();
                });
            }
        });

        saveSettingsDebounced();
    }
}

// ==========================================
// PROMPT INJECTOR
// ==========================================

class PromptInjector {
    static generateInjection() {
        const settings = extension_settings[extensionName];
        if (!settings.promptInjectionEnabled) return "";

        const detail = settings.promptInjectionDetail;
        let lines = [];

        lines.push(`[LifeCycle System Data]`);
        lines.push(`World Date: ${formatDate(settings.worldDate)}`);

        Object.entries(settings.characters).forEach(([name, profile]) => {
            if (!profile._enabled) return;

            let charLines = [];
            charLines.push(`\n--- ${name} ---`);
            charLines.push(`Bio Sex: ${profile.bioSex}`);

            if (profile.secondarySex) {
                charLines.push(`Secondary Sex: ${profile.secondarySex}`);
            }

            // Cycle
            if (settings.modules.cycle && profile.cycle?.enabled && !profile.pregnancy?.active) {
                const cm = new CycleManager(profile);
                const phase = cm.getCurrentPhase();
                charLines.push(`Menstrual Cycle: Day ${profile.cycle.currentDay}/${profile.cycle.length}, Phase: ${cm.getPhaseLabel(phase)}`);

                if (detail === "high") {
                    charLines.push(`Fertility: ${Math.round(cm.getFertility() * 100)}%`);
                    charLines.push(`Libido: ${cm.getLibido()}`);
                    const symptoms = cm.getSymptoms();
                    if (symptoms.length) charLines.push(`Symptoms: ${symptoms.join(", ")}`);
                    charLines.push(`Discharge: ${cm.getDischarge()}`);
                } else if (detail === "medium") {
                    charLines.push(`Fertility: ${Math.round(cm.getFertility() * 100)}%`);
                    const symptoms = cm.getSymptoms();
                    if (symptoms.length) charLines.push(`Symptoms: ${symptoms.join(", ")}`);
                }
            }

            // Pregnancy
            if (settings.modules.pregnancy && profile.pregnancy?.active) {
                const pm = new PregnancyManager(profile);
                charLines.push(`PREGNANT: Week ${profile.pregnancy.week}, Trimester ${pm.getTrimester()}`);
                charLines.push(`Fetal size: ${pm.getFetalSize()}`);
                charLines.push(`Fetus count: ${profile.pregnancy.fetusCount}`);

                if (detail !== "low") {
                    charLines.push(`Symptoms: ${pm.getSymptoms().join(", ")}`);
                    charLines.push(`Movements: ${pm.getMovements()}`);
                    charLines.push(`Weight gain: +${pm.getWeightGain()} kg`);
                }
                if (detail === "high") {
                    charLines.push(`Body changes: ${pm.getBodyChanges().join(", ")}`);
                    charLines.push(`Emotional state: ${pm.getEmotionalState()}`);
                }
            }

            // Labor
            if (settings.modules.labor && profile.labor?.active) {
                const lm = new LaborManager(profile);
                charLines.push(`IN LABOR: Stage: ${profile.labor.stage}, Dilation: ${profile.labor.dilation}cm`);
                if (detail !== "low") {
                    charLines.push(`Contractions: every ${profile.labor.contractionInterval}min, ${profile.labor.contractionDuration}sec`);
                    charLines.push(`${lm.getStageDescription()}`);
                }
            }

            // Heat/Rut
            if (settings.modules.auOverlay && settings.auPreset === "omegaverse") {
                if (profile.heat?.active) {
                    charLines.push(`IN HEAT: Day ${profile.heat.currentDay}/${profile.heat.duration}, Intensity: ${profile.heat.intensity}`);
                }
                if (profile.rut?.active) {
                    charLines.push(`IN RUT: Day ${profile.rut.currentDay}/${profile.rut.duration}`);
                }
            }

            // Babies
            if (settings.modules.baby && profile.babies?.length > 0 && detail !== "low") {
                profile.babies.forEach((baby) => {
                    const bm = new BabyManager(baby);
                    charLines.push(`Baby: ${baby.name || "безымянный"} (${baby.sex === "M" ? "мальчик" : "девочка"}, ${bm.getAgeLabel()})`);
                });
            }

            if (profile.contraception && profile.contraception !== "none") {
                charLines.push(`Contraception: ${profile.contraception}`);
            }

            lines.push(charLines.join("\n"));
        });

        lines.push(`\n[/LifeCycle System Data]`);
        return lines.join("\n");
    }
}

// ==========================================
// POPUPS
// ==========================================

function showDicePopup(diceResult, targetChar) {
    document.querySelector(".lc-overlay")?.remove();
    document.querySelector(".lc-popup")?.remove();

    const overlay = document.createElement("div");
    overlay.className = "lc-overlay";

    const popup = document.createElement("div");
    popup.className = "lc-popup";

    const resultClass = diceResult.result ? "success" : "fail";
    const resultText = diceResult.result ? "ЗАЧАТИЕ ПРОИЗОШЛО!" : "Зачатие не произошло";
    const resultIcon = diceResult.result ? "✅" : "❌";

    popup.innerHTML = `
        <h3 class="lc-popup-title">🎲 Бросок на зачатие</h3>
        <div class="lc-popup-details">
            <div><strong>Цель:</strong> ${targetChar}</div>
            <div><strong>Шанс:</strong> ${diceResult.chance}%</div>
            <div><strong>Контрацепция:</strong> ${diceResult.contraception || "нет"}</div>
            <div><strong>Тип:</strong> ${diceResult.actType || "vaginal"}</div>
            <div><strong>Эякуляция:</strong> ${diceResult.ejaculation || "inside"}</div>
            <hr>
            <div><strong>Бросок:</strong> ${diceResult.roll} из 100</div>
            <div><strong>Нужно:</strong> ≤ ${diceResult.chance}</div>
        </div>
        <div class="lc-popup-result ${resultClass}">${diceResult.roll}</div>
        <div class="lc-popup-verdict ${resultClass}">${resultIcon} ${resultText}</div>
        <div class="lc-popup-actions">
            <button class="lc-btn lc-btn-success" id="lc-dice-accept">Принять</button>
            <button class="lc-btn" id="lc-dice-reroll">Перебросить</button>
            <button class="lc-btn lc-btn-danger" id="lc-dice-cancel">Отмена</button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    document.getElementById("lc-dice-accept")?.addEventListener("click", () => {
        if (diceResult.result) {
            const settings = extension_settings[extensionName];
            const profile = settings.characters[targetChar];
            if (profile) {
                const pregManager = new PregnancyManager(profile);
                const fatherName = diceResult.participants?.find(p => p !== targetChar) || "unknown";
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

// ==========================================
// JSON EXPORT / IMPORT
// ==========================================

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
                toastr.error("Ошибка парсинга JSON: " + err.message);
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

// ==========================================
// GENERATE SETTINGS HTML (all inline, no settings.html needed)
// ==========================================

function generateSettingsHTML() {
    return `
    <div class="lifecycle-panel" id="lc-panel">
        <!-- HEADER -->
        <div class="lifecycle-header">
            <div class="lifecycle-header-title">
                <h3>LifeCycle</h3>
                <span class="lc-version">v0.2.0</span>
            </div>
            <div class="lifecycle-header-actions">
                <label class="lc-switch" data-tip="Вкл/Выкл расширение">
                    <input type="checkbox" id="lc-enabled">
                    <span class="lc-switch-slider"></span>
                </label>
            </div>
        </div>

        <!-- DASHBOARD (always visible) -->
        <div class="lc-dashboard" id="lc-dashboard">
            <div class="lc-dashboard-date" id="lc-dashboard-date"></div>
            <div id="lc-dashboard-items"></div>
        </div>

        <!-- TABS -->
        <div class="lifecycle-tabs" id="lc-tabs">
            <button class="lifecycle-tab active" data-tab="characters">
                <span class="tab-icon">👤</span>Персонажи
            </button>
            <button class="lifecycle-tab" data-tab="cycle">
                <span class="tab-icon">🔄</span>Цикл
            </button>
            <button class="lifecycle-tab" data-tab="intimacy">
                <span class="tab-icon">💕</span>Интим
            </button>
            <button class="lifecycle-tab" data-tab="pregnancy">
                <span class="tab-icon">🤰</span>Берем.
            </button>
            <button class="lifecycle-tab" data-tab="labor">
                <span class="tab-icon">🏥</span>Роды
            </button>
            <button class="lifecycle-tab" data-tab="babies">
                <span class="tab-icon">👶</span>Дети
            </button>
            <button class="lifecycle-tab" data-tab="settings">
                <span class="tab-icon">⚙️</span>Настр.
            </button>
        </div>

        <!-- TAB: CHARACTERS -->
        <div class="lifecycle-tab-content active" id="lc-tab-characters" data-tab="characters">
            <div class="lc-section">
                <div class="lc-section-title">
                    <h4>Персонажи из чата</h4>
                </div>
                <p class="lc-section-hint">Персонажи подтягиваются автоматически из текущего чата. Нажмите "Синхронизировать" для обновления.</p>
                <div class="lc-btn-group" style="margin-bottom:8px">
                    <button class="lc-btn lc-btn-primary" id="lc-sync-chars">🔄 Синхронизировать</button>
                    <button class="lc-btn" id="lc-add-char-manual">+ Добавить вручную</button>
                </div>
                <div id="lc-character-list"></div>
            </div>

            <!-- Inline editor (hidden by default) -->
            <div class="lc-editor hidden" id="lc-char-editor">
                <div class="lc-editor-title" id="lc-editor-title">Редактирование</div>
                <div class="lc-editor-grid">
                    <div class="lc-editor-field">
                        <label>Имя</label>
                        <input type="text" class="lc-input" id="lc-edit-name" readonly>
                    </div>
                    <div class="lc-editor-field">
                        <label>Биол. пол</label>
                        <select class="lc-select" id="lc-edit-bio-sex">
                            <option value="F">Женский (F)</option>
                            <option value="M">Мужской (M)</option>
                        </select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Вторичный пол</label>
                        <select class="lc-select" id="lc-edit-secondary-sex">
                            <option value="">Нет</option>
                            <option value="alpha">Альфа</option>
                            <option value="beta">Бета</option>
                            <option value="omega">Омега</option>
                        </select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Контрацепция</label>
                        <select class="lc-select" id="lc-edit-contraception">
                            <option value="none">Нет</option>
                            <option value="condom">Презерватив</option>
                            <option value="pill">Таблетки (КОК)</option>
                            <option value="iud">Спираль (ВМС)</option>
                            <option value="patch">Пластырь</option>
                            <option value="injection">Инъекция</option>
                            <option value="withdrawal">Прерванный акт</option>
                        </select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Цвет глаз</label>
                        <input type="text" class="lc-input" id="lc-edit-eye-color" placeholder="карие">
                    </div>
                    <div class="lc-editor-field">
                        <label>Цвет волос</label>
                        <input type="text" class="lc-input" id="lc-edit-hair-color" placeholder="тёмные">
                    </div>
                    <div class="lc-editor-field">
                        <label>Сложность берем.</label>
                        <select class="lc-select" id="lc-edit-preg-difficulty">
                            <option value="easy">Лёгкая</option>
                            <option value="normal">Обычная</option>
                            <option value="hard">Сложная</option>
                            <option value="complicated">С осложнениями</option>
                        </select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Трекинг</label>
                        <label class="lc-checkbox">
                            <input type="checkbox" id="lc-edit-enabled">
                            <span>Включён</span>
                        </label>
                    </div>

                    <!-- Cycle settings -->
                    <div class="lc-editor-field full-width">
                        <label style="font-weight:600;margin-top:6px">Настройки цикла</label>
                    </div>
                    <div class="lc-editor-field">
                        <label>Вкл. цикл</label>
                        <label class="lc-checkbox">
                            <input type="checkbox" id="lc-edit-cycle-enabled">
                            <span>Активен</span>
                        </label>
                    </div>
                    <div class="lc-editor-field">
                        <label>Длина цикла</label>
                        <input type="number" class="lc-input" id="lc-edit-cycle-length" min="21" max="45" value="28">
                    </div>
                    <div class="lc-editor-field">
                        <label>Длит. менструации</label>
                        <input type="number" class="lc-input" id="lc-edit-mens-duration" min="2" max="8" value="5">
                    </div>
                    <div class="lc-editor-field">
                        <label>Нерегулярность</label>
                        <input type="number" class="lc-input" id="lc-edit-irregularity" min="0" max="10" value="2">
                    </div>
                    <div class="lc-editor-field">
                        <label>Интенсивность</label>
                        <select class="lc-select" id="lc-edit-symptom-intensity">
                            <option value="mild">Лёгкая</option>
                            <option value="moderate">Умеренная</option>
                            <option value="severe">Сильная</option>
                        </select>
                    </div>
                </div>
                <div class="lc-editor-actions">
                    <button class="lc-btn lc-btn-success" id="lc-editor-save">Сохранить</button>
                    <button class="lc-btn" id="lc-editor-cancel">Отмена</button>
                </div>
            </div>
        </div>

        <!-- TAB: CYCLE -->
        <div class="lifecycle-tab-content" id="lc-tab-cycle" data-tab="cycle">
            <div class="lc-section">
                <div class="lc-row">
                    <label>Персонаж:</label>
                    <select class="lc-select lc-char-select lc-flex" id="lc-cycle-char-select"></select>
                </div>
                <div id="lc-cycle-settings-panel"></div>
            </div>
        </div>

        <!-- TAB: INTIMACY -->
        <div class="lifecycle-tab-content" id="lc-tab-intimacy" data-tab="intimacy">
            <div class="lc-section">
                <div class="lc-section-title"><h4>Новый акт</h4></div>
                <div class="lc-editor-grid">
                    <div class="lc-editor-field">
                        <label>Кто может забеременеть</label>
                        <select class="lc-select lc-char-select" id="lc-intim-target"></select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Партнёр</label>
                        <select class="lc-select lc-char-select" id="lc-intim-partner"></select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Тип акта</label>
                        <select class="lc-select" id="lc-intim-type">
                            <option value="vaginal">Вагинальный</option>
                            <option value="anal">Анальный</option>
                            <option value="oral">Оральный</option>
                            <option value="manual">Мануальный</option>
                        </select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Эякуляция</label>
                        <select class="lc-select" id="lc-intim-ejaculation">
                            <option value="inside">Внутрь</option>
                            <option value="outside">Снаружи</option>
                            <option value="oral">В рот</option>
                            <option value="other">Другое</option>
                        </select>
                    </div>
                </div>
                <div class="lc-btn-group" style="margin-top:8px">
                    <button class="lc-btn lc-btn-primary" id="lc-intim-log">📝 Записать акт</button>
                    <button class="lc-btn lc-btn-success" id="lc-intim-roll">🎲 Бросить на зачатие</button>
                </div>
            </div>
            <hr class="lc-sep">
            <div class="lc-section">
                <div class="lc-section-title"><h4>Лог интима</h4></div>
                <div class="lc-scroll" id="lc-intimacy-log"></div>
            </div>
            <div class="lc-section">
                <div class="lc-section-title"><h4>Лог бросков</h4></div>
                <div class="lc-scroll" id="lc-dice-log"></div>
            </div>
        </div>

        <!-- TAB: PREGNANCY -->
        <div class="lifecycle-tab-content" id="lc-tab-pregnancy" data-tab="pregnancy">
            <div class="lc-section">
                <div class="lc-row">
                    <label>Персонаж:</label>
                    <select class="lc-select lc-char-select lc-flex" id="lc-preg-char-select"></select>
                </div>
                <div id="lc-preg-panel"></div>
                <div class="lc-btn-group" style="margin-top:8px">
                    <button class="lc-btn" id="lc-preg-advance-week">+1 неделя</button>
                    <button class="lc-btn" id="lc-preg-set-week">Установить неделю</button>
                    <button class="lc-btn lc-btn-danger" id="lc-preg-end">Прервать</button>
                    <button class="lc-btn lc-btn-primary" id="lc-preg-start-labor">Начать роды</button>
                </div>
            </div>
        </div>

        <!-- TAB: LABOR -->
        <div class="lifecycle-tab-content" id="lc-tab-labor" data-tab="labor">
            <div class="lc-section">
                <div class="lc-row">
                    <label>Персонаж:</label>
                    <select class="lc-select lc-char-select lc-flex" id="lc-labor-char-select"></select>
                </div>
                <div id="lc-labor-panel"></div>
                <div class="lc-btn-group" style="margin-top:8px">
                    <button class="lc-btn lc-btn-primary" id="lc-labor-advance">Следующая стадия</button>
                    <button class="lc-btn lc-btn-success" id="lc-labor-deliver">Родить</button>
                    <button class="lc-btn" id="lc-labor-set-dilation">Установить раскрытие</button>
                    <button class="lc-btn lc-btn-danger" id="lc-labor-end">Завершить роды</button>
                </div>
            </div>
        </div>

        <!-- TAB: BABIES -->
        <div class="lifecycle-tab-content" id="lc-tab-babies" data-tab="babies">
            <div class="lc-section">
                <div class="lc-row">
                    <label>Родитель:</label>
                    <select class="lc-select lc-char-select lc-flex" id="lc-baby-parent-select"></select>
                </div>
                <div id="lc-baby-list"></div>
            </div>
        </div>

        <!-- TAB: SETTINGS -->
        <div class="lifecycle-tab-content" id="lc-tab-settings" data-tab="settings">
            <!-- General -->
            <div class="lc-section">
                <div class="lc-section-title"><h4>Общие</h4></div>
                <label class="lc-checkbox">
                    <input type="checkbox" id="lc-auto-sync">
                    <span>Авто-синхронизация персонажей из чата</span>
                </label>
                <label class="lc-checkbox">
                    <input type="checkbox" id="lc-auto-time">
                    <span>Авто-прогрессия времени из сообщений AI</span>
                </label>
                <label class="lc-checkbox">
                    <input type="checkbox" id="lc-time-confirm">
                    <span>Подтверждать сдвиг времени</span>
                </label>
                <div class="lc-row">
                    <label>Чувствительность парсера:</label>
                    <select class="lc-select lc-flex" id="lc-time-sensitivity">
                        <option value="low">Низкая</option>
                        <option value="medium">Средняя</option>
                        <option value="high">Высокая</option>
                    </select>
                </div>
            </div>

            <!-- World date -->
            <div class="lc-section">
                <div class="lc-section-title"><h4>Мировая дата</h4></div>
                <div class="lc-editor-grid">
                    <div class="lc-editor-field">
                        <label>Год</label>
                        <input type="number" class="lc-input" id="lc-date-year" min="1" max="9999">
                    </div>
                    <div class="lc-editor-field">
                        <label>Месяц</label>
                        <input type="number" class="lc-input" id="lc-date-month" min="1" max="12">
                    </div>
                    <div class="lc-editor-field">
                        <label>День</label>
                        <input type="number" class="lc-input" id="lc-date-day" min="1" max="31">
                    </div>
                    <div class="lc-editor-field">
                        <label>Час</label>
                        <input type="number" class="lc-input" id="lc-date-hour" min="0" max="23">
                    </div>
                </div>
                <div class="lc-btn-group" style="margin-top:6px">
                    <button class="lc-btn" id="lc-date-apply">Применить дату</button>
                    <button class="lc-btn" id="lc-date-advance-1">+1 день</button>
                    <button class="lc-btn" id="lc-date-advance-7">+7 дней</button>
                    <label class="lc-checkbox" style="margin-left:8px;margin-bottom:0">
                        <input type="checkbox" id="lc-date-frozen">
                        <span>Заморозить время</span>
                    </label>
                </div>
            </div>

            <!-- Modules -->
            <div class="lc-section">
                <div class="lc-section-title"><h4>Модули</h4></div>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-cycle"><span>Менструальный цикл</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-pregnancy"><span>Беременность</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-labor"><span>Роды</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-baby"><span>Развитие ребёнка</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-intimacy"><span>Интимный трекер</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-au"><span>AU-оверлей</span></label>
            </div>

            <!-- Prompt injection -->
            <div class="lc-section">
                <div class="lc-section-title"><h4>Инъекция в промпт</h4></div>
                <label class="lc-checkbox">
                    <input type="checkbox" id="lc-prompt-enabled">
                    <span>Включить инъекцию</span>
                </label>
                <div class="lc-row">
                    <label>Позиция:</label>
                    <select class="lc-select lc-flex" id="lc-prompt-position">
                        <option value="system">System prompt</option>
                        <option value="authornote">Author's note</option>
                        <option value="endofchat">Конец чата</option>
                    </select>
                </div>
                <div class="lc-row">
                    <label>Детализация:</label>
                    <select class="lc-select lc-flex" id="lc-prompt-detail">
                        <option value="low">Минимальная</option>
                        <option value="medium">Средняя</option>
                        <option value="high">Полная</option>
                    </select>
                </div>
            </div>

            <!-- AU Settings -->
            <div class="lc-section">
                <div class="lc-section-title"><h4>AU-оверлей</h4></div>
                <div class="lc-row">
                    <label>Пресет:</label>
                    <select class="lc-select lc-flex" id="lc-au-preset">
                        <option value="realism">Реализм</option>
                        <option value="omegaverse">Омегаверс</option>
                        <option value="fantasy">Фэнтези</option>
                        <option value="scifi">Sci-Fi</option>
                    </select>
                </div>
                <div id="lc-au-settings-panel"></div>
            </div>

            <!-- Export / Import -->
            <div class="lc-section">
                <div class="lc-section-title"><h4>Данные</h4></div>
                <div class="lc-btn-group">
                    <button class="lc-btn" id="lc-export">📤 Экспорт</button>
                    <button class="lc-btn" id="lc-import">📥 Импорт</button>
                    <button class="lc-btn lc-btn-danger" id="lc-reset-all">🗑️ Сбросить всё</button>
                </div>
            </div>
        </div>
    </div>
    `;
}

// ==========================================
// BIND ALL UI EVENTS
// ==========================================

function bindEvents() {
    const settings = extension_settings[extensionName];

    // === HEADER ===
    const enabledCheckbox = document.getElementById("lc-enabled");
    if (enabledCheckbox) {
        enabledCheckbox.checked = settings.enabled;
        enabledCheckbox.addEventListener("change", function () {
            settings.enabled = this.checked;
            saveSettingsDebounced();
        });
    }

    // === TABS ===
    document.querySelectorAll(".lifecycle-tab").forEach((tab) => {
        tab.addEventListener("click", function () {
            const tabName = this.dataset.tab;
            document.querySelectorAll(".lifecycle-tab").forEach((t) => t.classList.remove("active"));
            document.querySelectorAll(".lifecycle-tab-content").forEach((c) => c.classList.remove("active"));
            this.classList.add("active");
            const content = document.querySelector(`.lifecycle-tab-content[data-tab="${tabName}"]`);
            if (content) content.classList.add("active");
            settings.activeTab = tabName;
            updateUI();
        });
    });

    // === SYNC CHARACTERS ===
    document.getElementById("lc-sync-chars")?.addEventListener("click", () => {
        syncCharactersFromContext();
        updateUI();
        toastr.success("Персонажи синхронизированы!");
    });

    // === ADD CHARACTER MANUALLY ===
    document.getElementById("lc-add-char-manual")?.addEventListener("click", () => {
        const name = prompt("Имя нового персонажа:");
        if (!name || name.trim() === "") return;
        if (settings.characters[name.trim()]) {
            toastr.warning("Персонаж уже существует!");
            return;
        }
        settings.characters[name.trim()] = createDefaultProfile(name.trim(), false);
        saveSettingsDebounced();
        updateUI();
        toastr.success(`Персонаж "${name.trim()}" добавлен!`);
    });

    // === CHARACTER EDITOR ===
    document.getElementById("lc-editor-save")?.addEventListener("click", () => {
        saveCharacterEditor();
    });

    document.getElementById("lc-editor-cancel")?.addEventListener("click", () => {
        closeCharacterEditor();
    });

    // === CYCLE PANEL ===
    document.getElementById("lc-cycle-char-select")?.addEventListener("change", updateCyclePanel);

    // === INTIMACY ===
    document.getElementById("lc-intim-log")?.addEventListener("click", () => {
        const target = document.getElementById("lc-intim-target")?.value;
        const partner = document.getElementById("lc-intim-partner")?.value;
        const type = document.getElementById("lc-intim-type")?.value;
        const ejaculation = document.getElementById("lc-intim-ejaculation")?.value;

        if (!target || !partner) {
            toastr.warning("Выберите обоих участников!");
            return;
        }

        IntimacyManager.logIntimacy({
            participants: [target, partner],
            type: type,
            ejaculation: ejaculation,
        });

        toastr.success("Акт записан!");
        updateUI();
    });

    document.getElementById("lc-intim-roll")?.addEventListener("click", () => {
        const target = document.getElementById("lc-intim-target")?.value;
        const partner = document.getElementById("lc-intim-partner")?.value;
        const type = document.getElementById("lc-intim-type")?.value;
        const ejaculation = document.getElementById("lc-intim-ejaculation")?.value;

        if (!target) {
            toastr.warning("Выберите целевого персонажа!");
            return;
        }

        const result = IntimacyManager.calculatePregnancyChance(target, {
            participants: [target, partner],
            type: type,
            ejaculation: ejaculation,
        });

        showDicePopup(result, target);
    });

    // === PREGNANCY ===
    document.getElementById("lc-preg-char-select")?.addEventListener("change", updatePregnancyPanel);

    document.getElementById("lc-preg-advance-week")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-preg-char-select")?.value;
        const profile = settings.characters[charName];
        if (!profile?.pregnancy?.active) return;
        const pm = new PregnancyManager(profile);
        pm.advanceDay(7);
        saveSettingsDebounced();
        updateUI();
    });

    document.getElementById("lc-preg-set-week")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-preg-char-select")?.value;
        const profile = settings.characters[charName];
        if (!profile?.pregnancy?.active) return;
        const week = parseInt(prompt(`Установить неделю (1-${profile.pregnancy.maxWeeks}):`, profile.pregnancy.week));
        if (week >= 1 && week <= profile.pregnancy.maxWeeks) {
            profile.pregnancy.week = week;
            profile.pregnancy.day = 0;
            saveSettingsDebounced();
            updateUI();
        }
    });

    document.getElementById("lc-preg-end")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-preg-char-select")?.value;
        const profile = settings.characters[charName];
        if (!profile?.pregnancy?.active) return;
        if (confirm(`Прервать беременность ${charName}?`)) {
            profile.pregnancy.active = false;
            if (profile.cycle) profile.cycle.enabled = true;
            saveSettingsDebounced();
            updateUI();
        }
    });

    document.getElementById("lc-preg-start-labor")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-preg-char-select")?.value;
        const profile = settings.characters[charName];
        if (!profile?.pregnancy?.active) return;
        const lm = new LaborManager(profile);
        lm.startLabor();
        saveSettingsDebounced();
        updateUI();
        toastr.info(`${charName}: роды начались!`);
    });

    // === LABOR ===
    document.getElementById("lc-labor-char-select")?.addEventListener("change", updateLaborPanel);

    document.getElementById("lc-labor-advance")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-labor-char-select")?.value;
        const profile = settings.characters[charName];
        if (!profile?.labor?.active) return;
        const lm = new LaborManager(profile);
        lm.advanceStage();
        saveSettingsDebounced();
        updateUI();
    });

    document.getElementById("lc-labor-deliver")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-labor-char-select")?.value;
        const profile = settings.characters[charName];
        if (!profile?.labor?.active) return;

        const baby = BabyManager.generateBaby(profile, profile.pregnancy?.father || "unknown");
        const babyName = prompt("Имя ребёнка:", "");
        baby.name = babyName || `Малыш ${(profile.babies?.length || 0) + 1}`;

        if (!profile.babies) profile.babies = [];
        profile.babies.push(baby);

        const lm = new LaborManager(profile);
        lm.completeBirth();
        saveSettingsDebounced();
        updateUI();
        toastr.success(`${charName} родила ${baby.sex === "M" ? "мальчика" : "девочку"}: ${baby.name}!`);
    });

    document.getElementById("lc-labor-set-dilation")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-labor-char-select")?.value;
        const profile = settings.characters[charName];
        if (!profile?.labor?.active) return;
        const dilation = parseInt(prompt("Раскрытие (0-10 см):", profile.labor.dilation));
        if (dilation >= 0 && dilation <= 10) {
            profile.labor.dilation = dilation;
            saveSettingsDebounced();
            updateUI();
        }
    });

    document.getElementById("lc-labor-end")?.addEventListener("click", () => {
        const charName = document.getElementById("lc-labor-char-select")?.value;
        const profile = settings.characters[charName];
        if (!profile?.labor?.active) return;
        if (confirm(`Завершить роды ${charName}?`)) {
            const lm = new LaborManager(profile);
            lm.endLabor();
            saveSettingsDebounced();
            updateUI();
        }
    });

    // === BABIES ===
    document.getElementById("lc-baby-parent-select")?.addEventListener("change", updateBabyList);

    // === SETTINGS ===
    document.getElementById("lc-auto-sync")?.addEventListener("change", function () {
        settings.autoSyncCharacters = this.checked;
        saveSettingsDebounced();
    });

    document.getElementById("lc-auto-time")?.addEventListener("change", function () {
        settings.autoTimeProgress = this.checked;
        saveSettingsDebounced();
    });

    document.getElementById("lc-time-confirm")?.addEventListener("change", function () {
        settings.timeParserConfirmation = this.checked;
        saveSettingsDebounced();
    });

    document.getElementById("lc-time-sensitivity")?.addEventListener("change", function () {
        settings.timeParserSensitivity = this.value;
        saveSettingsDebounced();
    });

    // Date
    document.getElementById("lc-date-apply")?.addEventListener("click", () => {
        settings.worldDate.year = parseInt(document.getElementById("lc-date-year")?.value) || 2025;
        settings.worldDate.month = clamp(parseInt(document.getElementById("lc-date-month")?.value) || 1, 1, 12);
        settings.worldDate.day = clamp(parseInt(document.getElementById("lc-date-day")?.value) || 1, 1, 31);
        settings.worldDate.hour = clamp(parseInt(document.getElementById("lc-date-hour")?.value) || 12, 0, 23);
        saveSettingsDebounced();
        updateUI();
    });

    document.getElementById("lc-date-advance-1")?.addEventListener("click", () => {
        settings.worldDate = addDays(settings.worldDate, 1);
        TimeParser.advanceAllCharacters(1);
        saveSettingsDebounced();
        updateUI();
    });

    document.getElementById("lc-date-advance-7")?.addEventListener("click", () => {
        settings.worldDate = addDays(settings.worldDate, 7);
        TimeParser.advanceAllCharacters(7);
        saveSettingsDebounced();
        updateUI();
    });

    document.getElementById("lc-date-frozen")?.addEventListener("change", function () {
        settings.worldDate.frozen = this.checked;
        saveSettingsDebounced();
    });

    // Modules
    const moduleBindings = {
        "lc-mod-cycle": "cycle",
        "lc-mod-pregnancy": "pregnancy",
        "lc-mod-labor": "labor",
        "lc-mod-baby": "baby",
        "lc-mod-intimacy": "intimacy",
        "lc-mod-au": "auOverlay",
    };

    for (const [elemId, modKey] of Object.entries(moduleBindings)) {
        const elem = document.getElementById(elemId);
        if (elem) {
            elem.checked = settings.modules[modKey];
            elem.addEventListener("change", function () {
                settings.modules[modKey] = this.checked;
                saveSettingsDebounced();
                updateUI();
            });
        }
    }

    // Prompt injection
    document.getElementById("lc-prompt-enabled")?.addEventListener("change", function () {
        settings.promptInjectionEnabled = this.checked;
        saveSettingsDebounced();
    });

    document.getElementById("lc-prompt-position")?.addEventListener("change", function () {
        settings.promptInjectionPosition = this.value;
        saveSettingsDebounced();
    });

    document.getElementById("lc-prompt-detail")?.addEventListener("change", function () {
        settings.promptInjectionDetail = this.value;
        saveSettingsDebounced();
    });

    // AU
    document.getElementById("lc-au-preset")?.addEventListener("change", function () {
        settings.auPreset = this.value;
        saveSettingsDebounced();
        renderAUSettings();
    });

    // Export/Import
    document.getElementById("lc-export")?.addEventListener("click", () => {
        downloadJSON(settings, `lifecycle-backup-${Date.now()}.json`);
    });

    document.getElementById("lc-import")?.addEventListener("click", () => {
        uploadJSON((data) => {
            Object.assign(settings, deepMerge(defaultSettings, data));
            saveSettingsDebounced();
            updateUI();
            renderAUSettings();
            toastr.success("Данные импортированы!");
        });
    });

    document.getElementById("lc-reset-all")?.addEventListener("click", () => {
        if (confirm("Сбросить ВСЕ данные LifeCycle? Это действие необратимо!")) {
            Object.assign(settings, JSON.parse(JSON.stringify(defaultSettings)));
            saveSettingsDebounced();
            updateUI();
            renderAUSettings();
            toastr.info("Данные сброшены.");
        }
    });
}

// ==========================================
// CHARACTER EDITOR (inline)
// ==========================================

function openCharacterEditor(charName) {
    const settings = extension_settings[extensionName];
    const profile = settings.characters[charName];
    if (!profile) return;

    settings.editingCharacter = charName;

    const editor = document.getElementById("lc-char-editor");
    if (!editor) return;
    editor.classList.remove("hidden");

    document.getElementById("lc-editor-title").textContent = `Редактирование: ${charName}`;
    document.getElementById("lc-edit-name").value = charName;
    document.getElementById("lc-edit-bio-sex").value = profile.bioSex || "F";
    document.getElementById("lc-edit-secondary-sex").value = profile.secondarySex || "";
    document.getElementById("lc-edit-contraception").value = profile.contraception || "none";
    document.getElementById("lc-edit-eye-color").value = profile.eyeColor || "";
    document.getElementById("lc-edit-hair-color").value = profile.hairColor || "";
    document.getElementById("lc-edit-preg-difficulty").value = profile.pregnancyDifficulty || "normal";
    document.getElementById("lc-edit-enabled").checked = profile._enabled !== false;

    if (profile.cycle) {
        document.getElementById("lc-edit-cycle-enabled").checked = profile.cycle.enabled;
        document.getElementById("lc-edit-cycle-length").value = profile.cycle.baseLength || 28;
        document.getElementById("lc-edit-mens-duration").value = profile.cycle.menstruationDuration || 5;
        document.getElementById("lc-edit-irregularity").value = profile.cycle.irregularity || 0;
        document.getElementById("lc-edit-symptom-intensity").value = profile.cycle.symptomIntensity || "moderate";
    }
}

function saveCharacterEditor() {
    const settings = extension_settings[extensionName];
    const charName = settings.editingCharacter;
    if (!charName || !settings.characters[charName]) return;

    const profile = settings.characters[charName];

    profile.bioSex = document.getElementById("lc-edit-bio-sex")?.value || "F";
    profile.secondarySex = document.getElementById("lc-edit-secondary-sex")?.value || null;
    if (profile.secondarySex === "") profile.secondarySex = null;
    profile.contraception = document.getElementById("lc-edit-contraception")?.value || "none";
    profile.eyeColor = document.getElementById("lc-edit-eye-color")?.value || "";
    profile.hairColor = document.getElementById("lc-edit-hair-color")?.value || "";
    profile.pregnancyDifficulty = document.getElementById("lc-edit-preg-difficulty")?.value || "normal";
    profile._enabled = document.getElementById("lc-edit-enabled")?.checked !== false;

    if (profile.cycle) {
        profile.cycle.enabled = document.getElementById("lc-edit-cycle-enabled")?.checked;
        const newLength = parseInt(document.getElementById("lc-edit-cycle-length")?.value);
        if (newLength >= 21 && newLength <= 45) {
            profile.cycle.baseLength = newLength;
            profile.cycle.length = newLength;
        }
        const mensDur = parseInt(document.getElementById("lc-edit-mens-duration")?.value);
        if (mensDur >= 2 && mensDur <= 8) {
            profile.cycle.menstruationDuration = mensDur;
        }
        const irreg = parseInt(document.getElementById("lc-edit-irregularity")?.value);
        if (irreg >= 0 && irreg <= 10) {
            profile.cycle.irregularity = irreg;
        }
        profile.cycle.symptomIntensity = document.getElementById("lc-edit-symptom-intensity")?.value || "moderate";
    }

    saveSettingsDebounced();
    closeCharacterEditor();
    updateUI();
    toastr.success(`${charName}: сохранено!`);
}

function closeCharacterEditor() {
    const settings = extension_settings[extensionName];
    settings.editingCharacter = null;
    const editor = document.getElementById("lc-char-editor");
    if (editor) editor.classList.add("hidden");
}

// ==========================================
// UI UPDATE FUNCTIONS
// ==========================================

function updateUI() {
    const settings = extension_settings[extensionName];

    // Sync settings inputs
    const enabledCb = document.getElementById("lc-enabled");
    if (enabledCb) enabledCb.checked = settings.enabled;

    const autoSync = document.getElementById("lc-auto-sync");
    if (autoSync) autoSync.checked = settings.autoSyncCharacters;

    const autoTime = document.getElementById("lc-auto-time");
    if (autoTime) autoTime.checked = settings.autoTimeProgress;

    const timeConfirm = document.getElementById("lc-time-confirm");
    if (timeConfirm) timeConfirm.checked = settings.timeParserConfirmation;

    const timeSens = document.getElementById("lc-time-sensitivity");
    if (timeSens) timeSens.value = settings.timeParserSensitivity;

    const promptEnabled = document.getElementById("lc-prompt-enabled");
    if (promptEnabled) promptEnabled.checked = settings.promptInjectionEnabled;

    const promptPos = document.getElementById("lc-prompt-position");
    if (promptPos) promptPos.value = settings.promptInjectionPosition;

    const promptDetail = document.getElementById("lc-prompt-detail");
    if (promptDetail) promptDetail.value = settings.promptInjectionDetail;

    const auPreset = document.getElementById("lc-au-preset");
    if (auPreset) auPreset.value = settings.auPreset;

    const dateFrozen = document.getElementById("lc-date-frozen");
    if (dateFrozen) dateFrozen.checked = settings.worldDate.frozen;

    // Date inputs
    const dateYear = document.getElementById("lc-date-year");
    if (dateYear) dateYear.value = settings.worldDate.year;
    const dateMonth = document.getElementById("lc-date-month");
    if (dateMonth) dateMonth.value = settings.worldDate.month;
    const dateDay = document.getElementById("lc-date-day");
    if (dateDay) dateDay.value = settings.worldDate.day;
    const dateHour = document.getElementById("lc-date-hour");
    if (dateHour) dateHour.value = settings.worldDate.hour;

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

    document.querySelectorAll(".lc-char-select").forEach((select) => {
        const currentVal = select.value;
        select.innerHTML = "";
        charNames.forEach((name) => {
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

    if (Object.keys(settings.characters).length === 0) {
        container.innerHTML = `
            <div class="lc-empty">
                <div class="lc-empty-icon">👤</div>
                <div class="lc-empty-text">Нет персонажей. Нажмите "Синхронизировать" чтобы подтянуть из чата.</div>
            </div>
        `;
        return;
    }

    Object.entries(settings.characters).forEach(([name, profile]) => {
        const card = document.createElement("div");
        card.className = "lc-char-card";

        let tagsHTML = "";
        const isUser = profile._isUser ? `<span class="lc-tag lc-tag-neutral">USER</span>` : "";
        const isDisabled = profile._enabled === false ? `<span class="lc-tag lc-tag-neutral">ВЫКЛ</span>` : "";

        if (profile.cycle?.enabled && !profile.pregnancy?.active) {
            const cm = new CycleManager(profile);
            const phase = cm.getCurrentPhase();
            tagsHTML += `<span class="lc-tag lc-tag-cycle">${cm.getPhaseLabel(phase)}</span>`;
        }
        if (profile.pregnancy?.active) {
            tagsHTML += `<span class="lc-tag lc-tag-preg">Нед. ${profile.pregnancy.week}</span>`;
        }
        if (profile.labor?.active) {
            tagsHTML += `<span class="lc-tag lc-tag-labor">Роды</span>`;
        }
        if (settings.modules.auOverlay && settings.auPreset === "omegaverse") {
            if (profile.heat?.active) tagsHTML += `<span class="lc-tag lc-tag-heat">Течка</span>`;
            if (profile.rut?.active) tagsHTML += `<span class="lc-tag lc-tag-rut">Гон</span>`;
        }
        if (profile.babies?.length > 0) {
            tagsHTML += `<span class="lc-tag lc-tag-baby">${profile.babies.length} 👶</span>`;
        }

        const sexLabel = profile.bioSex === "M" ? "М" : "Ж";
        const secSex = profile.secondarySex ? ` / ${profile.secondarySex}` : "";
        const contra = profile.contraception !== "none" ? ` | 💊 ${profile.contraception}` : "";

        card.innerHTML = `
            <div class="lc-char-card-header">
                <span class="lc-char-card-name">${name}</span>
                <div class="lc-char-card-tags">${isUser}${isDisabled}${tagsHTML}</div>
            </div>
            <div class="lc-char-card-meta">${sexLabel}${secSex}${contra}</div>
            <div class="lc-char-card-actions">
                <button class="lc-btn-sm lc-edit-char" data-char="${name}">✏️ Редактировать</button>
                <button class="lc-btn-sm lc-delete-char" data-char="${name}" style="color:#d07070">🗑️ Удалить</button>
            </div>
        `;

        container.appendChild(card);
    });

    // Bind card buttons
    document.querySelectorAll(".lc-edit-char").forEach((btn) => {
        btn.addEventListener("click", function () {
            openCharacterEditor(this.dataset.char);
        });
    });

    document.querySelectorAll(".lc-delete-char").forEach((btn) => {
        btn.addEventListener("click", function () {
            const charName = this.dataset.char;
            if (confirm(`Удалить "${charName}" из трекера?`)) {
                delete settings.characters[charName];
                saveSettingsDebounced();
                closeCharacterEditor();
                updateUI();
            }
        });
    });
}

function updateDashboard() {
    const settings = extension_settings[extensionName];
    const dateEl = document.getElementById("lc-dashboard-date");
    const itemsEl = document.getElementById("lc-dashboard-items");
    if (!dateEl || !itemsEl) return;

    const frozenLabel = settings.worldDate.frozen ? " ❄️ ЗАМОРОЖЕНО" : "";
    dateEl.textContent = `📅 ${formatDate(settings.worldDate)}${frozenLabel}`;

    let html = "";
    Object.entries(settings.characters).forEach(([name, profile]) => {
        if (!profile._enabled) return;
        let statusParts = [];

        if (settings.modules.cycle && profile.cycle?.enabled && !profile.pregnancy?.active) {
            const cm = new CycleManager(profile);
            statusParts.push(cm.getPhaseLabel(cm.getCurrentPhase()));
        }

        if (settings.modules.pregnancy && profile.pregnancy?.active) {
            statusParts.push(`Нед. ${profile.pregnancy.week}/${profile.pregnancy.maxWeeks}`);
        }

        if (settings.modules.labor && profile.labor?.active) {
            statusParts.push(`Роды: ${profile.labor.stage}`);
        }

        if (settings.modules.auOverlay && settings.auPreset === "omegaverse") {
            if (profile.heat?.active) statusParts.push(`Течка д.${profile.heat.currentDay}`);
            if (profile.rut?.active) statusParts.push(`Гон д.${profile.rut.currentDay}`);
        }

        if (profile.babies?.length > 0) {
            statusParts.push(`👶 ${profile.babies.length}`);
        }

        const status = statusParts.length > 0 ? statusParts.join(" · ") : "нет данных";

        html += `
            <div class="lc-dashboard-item">
                <span class="lc-dashboard-char">${name}</span>
                <span class="lc-dashboard-status">${status}</span>
            </div>
        `;
    });

    if (html === "") {
        html = `<div class="lc-dashboard-item" style="color:var(--SmartThemeQuoteColor,#5a5252);font-style:italic">Нет активных персонажей</div>`;
    }

    itemsEl.innerHTML = html;
}

function updateLogs() {
    const settings = extension_settings[extensionName];

    // Dice log
    const diceContainer = document.getElementById("lc-dice-log");
    if (diceContainer) {
        if (settings.diceLog.length === 0) {
            diceContainer.innerHTML = `<div class="lc-log-empty">Бросков пока нет</div>`;
        } else {
            let html = "";
            [...settings.diceLog].reverse().slice(0, 20).forEach((entry) => {
                const icon = entry.result ? `<span class="lc-log-success">✅</span>` : `<span class="lc-log-fail">❌</span>`;
                html += `<div class="lc-log-entry">${icon} ${entry.timestamp} | ${entry.targetChar} | Шанс: ${entry.chance}% | Бросок: ${entry.roll}</div>`;
            });
            diceContainer.innerHTML = html;
        }
    }

    // Intimacy log
    const intimContainer = document.getElementById("lc-intimacy-log");
    if (intimContainer) {
        if (settings.intimacyLog.length === 0) {
            intimContainer.innerHTML = `<div class="lc-log-empty">Записей нет</div>`;
        } else {
            let html = "";
            [...settings.intimacyLog].reverse().slice(0, 20).forEach((entry) => {
                html += `<div class="lc-log-entry">${entry.timestamp} | ${(entry.participants || []).join(" + ")} | ${entry.type} | ${entry.ejaculation}</div>`;
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
        container.innerHTML = `<div class="lc-log-empty">Выберите персонажа</div>`;
        return;
    }

    const profile = settings.characters[charName];

    if (!profile.pregnancy?.active) {
        container.innerHTML = `<div class="lc-info-note">Не беременна. Используйте вкладку "Интим" для броска на зачатие.</div>`;
        return;
    }

    const pm = new PregnancyManager(profile);
    const preg = profile.pregnancy;
    const progress = Math.round((preg.week / preg.maxWeeks) * 100);

    container.innerHTML = `
        <div class="lc-progress" style="margin-top:8px">
            <div class="lc-progress-track">
                <div class="lc-progress-fill preg" style="width:${progress}%"></div>
            </div>
            <div class="lc-progress-label">Неделя ${preg.week} из ${preg.maxWeeks} (${progress}%)</div>
        </div>
        <div class="lc-info">
            <div><strong>Триместр:</strong> ${pm.getTrimester()}</div>
            <div><strong>Размер плода:</strong> ${pm.getFetalSize()}</div>
            <div><strong>Кол-во плодов:</strong> ${preg.fetusCount}</div>
            <div><strong>Отец:</strong> ${preg.father || "неизвестен"}</div>
            <div><strong>Шевеления:</strong> ${pm.getMovements()}</div>
            <div><strong>Прибавка в весе:</strong> +${pm.getWeightGain()} кг</div>
            <div><strong>Симптомы:</strong> ${pm.getSymptoms().join(", ") || "нет"}</div>
            <div><strong>Изменения тела:</strong> ${pm.getBodyChanges().join(", ") || "нет"}</div>
            <div><strong>Эмоц. состояние:</strong> ${pm.getEmotionalState()}</div>
        </div>
    `;
}

function updateLaborPanel() {
    const settings = extension_settings[extensionName];
    const container = document.getElementById("lc-labor-panel");
    if (!container) return;

    const charName = document.getElementById("lc-labor-char-select")?.value;
    if (!charName || !settings.characters[charName]) {
        container.innerHTML = `<div class="lc-log-empty">Выберите персонажа</div>`;
        return;
    }

    const profile = settings.characters[charName];

    if (!profile.labor?.active) {
        container.innerHTML = `<div class="lc-info-note">Роды не начались. Запустите через вкладку "Беременность".</div>`;
        return;
    }

    const lm = new LaborManager(profile);
    const labor = profile.labor;
    const stages = ["latent", "active", "transition", "pushing", "birth", "placenta"];
    const stageLabels = ["Латент.", "Актив.", "Переход.", "Потуги", "Рожд.", "Плацента"];
    const currentIdx = stages.indexOf(labor.stage);
    const dilProgress = Math.round((labor.dilation / 10) * 100);

    let stagesHTML = `<div class="lc-labor-stages">`;
    stages.forEach((s, i) => {
        let cls = "";
        if (i < currentIdx) cls = "done";
        else if (i === currentIdx) cls = "now";
        stagesHTML += `<div class="lc-labor-dot ${cls}"></div>`;
    });
    stagesHTML += `</div>`;
    stagesHTML += `<div class="lc-labor-labels">`;
    stageLabels.forEach((l) => {
        stagesHTML += `<span>${l}</span>`;
    });
    stagesHTML += `</div>`;

    container.innerHTML = `
        ${stagesHTML}
        <div class="lc-progress" style="margin-top:8px">
            <div class="lc-progress-track">
                <div class="lc-progress-fill labor" style="width:${dilProgress}%"></div>
            </div>
            <div class="lc-progress-label">Раскрытие: ${labor.dilation}/10 см</div>
        </div>
        <div class="lc-info">
            <div><strong>Стадия:</strong> ${lm.getStageDescription()}</div>
            <div><strong>Схватки:</strong> каждые ${labor.contractionInterval} мин, длительность ${labor.contractionDuration} сек</div>
            <div><strong>Часов прошло:</strong> ${labor.hoursElapsed}</div>
            <div><strong>Рождено:</strong> ${labor.babiesDelivered}/${labor.totalBabies}</div>
        </div>
    `;
}

function updateBabyList() {
    const settings = extension_settings[extensionName];
    const container = document.getElementById("lc-baby-list");
    if (!container) return;

    const parentName = document.getElementById("lc-baby-parent-select")?.value;
    if (!parentName || !settings.characters[parentName]) {
        container.innerHTML = `<div class="lc-log-empty">Выберите родителя</div>`;
        return;
    }

    const profile = settings.characters[parentName];
    if (!profile.babies || profile.babies.length === 0) {
        container.innerHTML = `<div class="lc-empty"><div class="lc-empty-icon">👶</div><div class="lc-empty-text">Нет детей</div></div>`;
        return;
    }

    let html = "";
    profile.babies.forEach((baby, index) => {
        const bm = new BabyManager(baby);
        const milestones = bm.getCurrentMilestones();
        const weightKg = (baby.currentWeight / 1000).toFixed(1);

        html += `
        <div class="lc-baby-card">
            <div class="lc-baby-header">
                <span class="lc-baby-name">${baby.name || "Безымянный"} (${baby.sex === "M" ? "♂" : "♀"})</span>
                <span class="lc-baby-age">${bm.getAgeLabel()}</span>
            </div>
            <div class="lc-baby-body">
                <div>Вес: ${weightKg} кг | Состояние: ${baby.state}</div>
                <div>Глаза: ${baby.eyeColor} | Волосы: ${baby.hairColor}</div>
                <div>Мать: ${baby.mother} | Отец: ${baby.father}</div>
                ${baby.secondarySex ? `<div>Вторичный пол: ${baby.secondarySex}</div>` : ""}
                ${baby.nonHumanFeatures?.length > 0 ? `<div>Особенности: ${baby.nonHumanFeatures.join(", ")}</div>` : ""}
                <div>Навыки: ${milestones.slice(-3).join(", ") || "нет"}</div>
            </div>
            <div class="lc-char-card-actions" style="margin-top:4px">
                <button class="lc-btn-sm lc-set-baby-age" data-parent="${parentName}" data-index="${index}">📅 Возраст</button>
                <button class="lc-btn-sm lc-remove-baby" data-parent="${parentName}" data-index="${index}" style="color:#d07070">🗑️ Удалить</button>
            </div>
        </div>`;
    });

    container.innerHTML = html;

    // Bind baby buttons
    document.querySelectorAll(".lc-set-baby-age").forEach((btn) => {
        btn.addEventListener("click", function () {
            const parent = this.dataset.parent;
            const idx = parseInt(this.dataset.index);
            const prof = settings.characters[parent];
            if (!prof?.babies?.[idx]) return;
            const input = prompt("Возраст в днях:", prof.babies[idx].ageDays);
            const days = parseInt(input);
            if (days >= 0) {
                prof.babies[idx].ageDays = days;
                const bm = new BabyManager(prof.babies[idx]);
                bm.updateGrowth();
                saveSettingsDebounced();
                updateUI();
            }
        });
    });

    document.querySelectorAll(".lc-remove-baby").forEach((btn) => {
        btn.addEventListener("click", function () {
            const parent = this.dataset.parent;
            const idx = parseInt(this.dataset.index);
            const prof = settings.characters[parent];
            if (!prof?.babies?.[idx]) return;
            if (confirm(`Удалить "${prof.babies[idx].name}"?`)) {
                prof.babies.splice(idx, 1);
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
        container.innerHTML = `<div class="lc-log-empty">Выберите персонажа</div>`;
        return;
    }

    const profile = settings.characters[charName];
    const cycle = profile.cycle;

    if (!cycle) {
        container.innerHTML = `<div class="lc-info-note">Цикл не настроен</div>`;
        return;
    }

    if (profile.pregnancy?.active) {
        container.innerHTML = `<div class="lc-info-note">Цикл приостановлен: персонаж беременна (неделя ${profile.pregnancy.week})</div>`;
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
    let fertClass = "low";
    if (fertility >= 0.20) { fertilityLabel = "ПИКОВАЯ"; fertClass = "peak"; }
    else if (fertility >= 0.10) { fertilityLabel = "Высокая"; fertClass = "high"; }
    else if (fertility >= 0.05) { fertilityLabel = "Средняя"; fertClass = "med"; }

    // Mini calendar
    const dayInCycle = cycle.currentDay;
    const cycleLength = cycle.length;
    const mensDur = cycle.menstruationDuration;
    const ovDay = Math.round(cycleLength - 14);

    let calendarHTML = `<div class="lc-cycle-calendar">`;
    for (let d = 1; d <= cycleLength; d++) {
        let phaseClass = "lut";
        if (d <= mensDur) phaseClass = "mens";
        else if (d < ovDay - 2) phaseClass = "foll";
        else if (d >= ovDay - 2 && d <= ovDay + 1) phaseClass = "ovul";

        const currentClass = d === dayInCycle ? " current" : "";
        calendarHTML += `<div class="lc-cycle-day ${phaseClass}${currentClass}" title="День ${d}"></div>`;
    }
    calendarHTML += `</div>`;
    calendarHTML += `
        <div class="lc-cycle-legend">
            <span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot mens"></span>Менстр.</span>
            <span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot foll"></span>Фоллик.</span>
            <span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot ovul"></span>Овуляция</span>
            <span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot lut"></span>Лютеин.</span>
        </div>
    `;

    container.innerHTML = `
        ${calendarHTML}
        <div class="lc-info" style="margin-top:8px">
            <div><strong>День цикла:</strong> ${dayInCycle} / ${cycleLength}</div>
            <div><strong>Фаза:</strong> ${phaseLabel}</div>
            <div><strong>Фертильность:</strong> <span class="lc-fertility-dot ${fertClass}"></span><span class="${fertClass}">${fertilityLabel} (${Math.round(fertility * 100)}%)</span></div>
            <div><strong>Либидо:</strong> ${libido}</div>
            <div><strong>Симптомы:</strong> ${symptoms.join(", ") || "нет"}</div>
            <div><strong>Выделения:</strong> ${discharge}</div>
        </div>
        <div class="lc-btn-group" style="margin-top:8px">
            <button class="lc-btn-sm" id="lc-cycle-to-mens">К менстр.</button>
            <button class="lc-btn-sm" id="lc-cycle-to-ovul">К овуляции</button>
            <button class="lc-btn-sm" id="lc-cycle-set-day">Установить день</button>
            <button class="lc-btn-sm" id="lc-cycle-skip">Пропустить цикл</button>
        </div>
    `;

    // Bind cycle buttons
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
        const day = parseInt(prompt(`День цикла (1-${profile.cycle.length}):`, profile.cycle.currentDay));
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

// ==========================================
// AU SETTINGS RENDER
// ==========================================

function renderAUSettings() {
    const settings = extension_settings[extensionName];
    const container = document.getElementById("lc-au-settings-panel");
    if (!container) return;

    if (settings.auPreset === "omegaverse") {
        const au = settings.auSettings.omegaverse;
        container.innerHTML = `
        <div class="lc-au-panel">
            <h5>Омегаверс</h5>
            <div class="lc-editor-grid">
                <div class="lc-editor-field">
                    <label>Цикл течки (дни)</label>
                    <input type="number" class="lc-input lc-au-input" data-path="omegaverse.heatCycleLength" value="${au.heatCycleLength}" min="14" max="90">
                </div>
                <div class="lc-editor-field">
                    <label>Длит. течки (дни)</label>
                    <input type="number" class="lc-input lc-au-input" data-path="omegaverse.heatDuration" value="${au.heatDuration}" min="1" max="14">
                </div>
                <div class="lc-editor-field">
                    <label>Бонус ферт. в течку</label>
                    <input type="number" class="lc-input lc-au-input" data-path="omegaverse.heatFertilityBonus" value="${au.heatFertilityBonus}" min="0" max="1" step="0.05">
                </div>
                <div class="lc-editor-field">
                    <label>Длит. гона (дни)</label>
                    <input type="number" class="lc-input lc-au-input" data-path="omegaverse.rutDuration" value="${au.rutDuration}" min="1" max="10">
                </div>
                <div class="lc-editor-field full-width">
                    <label class="lc-checkbox"><input type="checkbox" class="lc-au-check" data-path="omegaverse.knotEnabled" ${au.knotEnabled ? "checked" : ""}><span>Узел (knot)</span></label>
                    <label class="lc-checkbox"><input type="checkbox" class="lc-au-check" data-path="omegaverse.bondingEnabled" ${au.bondingEnabled ? "checked" : ""}><span>Связь (bonding)</span></label>
                    <label class="lc-checkbox"><input type="checkbox" class="lc-au-check" data-path="omegaverse.suppressantsAvailable" ${au.suppressantsAvailable ? "checked" : ""}><span>Подавители доступны</span></label>
                    <label class="lc-checkbox"><input type="checkbox" class="lc-au-check" data-path="omegaverse.maleOmegaPregnancy" ${au.maleOmegaPregnancy ? "checked" : ""}><span>M-Омега беременность</span></label>
                </div>
            </div>
        </div>`;
        bindAUInputs();
    } else if (settings.auPreset === "fantasy") {
        const au = settings.auSettings.fantasy;
        let raceHTML = "";
        Object.entries(au.pregnancyByRace).forEach(([race, weeks]) => {
            raceHTML += `
            <div class="lc-editor-field">
                <label>${race}</label>
                <input type="number" class="lc-input lc-au-race-input" data-race="${race}" value="${weeks}" min="10" max="120">
            </div>`;
        });

        container.innerHTML = `
        <div class="lc-au-panel">
            <h5>Фэнтези</h5>
            <div class="lc-editor-grid">${raceHTML}</div>
            <label class="lc-checkbox"><input type="checkbox" id="lc-au-fantasy-features" ${au.nonHumanFeatures ? "checked" : ""}><span>Нечеловеческие черты у детей</span></label>
            <label class="lc-checkbox"><input type="checkbox" id="lc-au-fantasy-magic" ${au.magicalComplications ? "checked" : ""}><span>Магические осложнения</span></label>
        </div>`;

        document.querySelectorAll(".lc-au-race-input").forEach((input) => {
            input.addEventListener("change", function () {
                settings.auSettings.fantasy.pregnancyByRace[this.dataset.race] = parseInt(this.value) || 40;
                saveSettingsDebounced();
            });
        });
        document.getElementById("lc-au-fantasy-features")?.addEventListener("change", function () {
            settings.auSettings.fantasy.nonHumanFeatures = this.checked;
            saveSettingsDebounced();
        });
        document.getElementById("lc-au-fantasy-magic")?.addEventListener("change", function () {
            settings.auSettings.fantasy.magicalComplications = this.checked;
            saveSettingsDebounced();
        });
    } else if (settings.auPreset === "scifi") {
        const au = settings.auSettings.scifi;
        container.innerHTML = `
        <div class="lc-au-panel">
            <h5>Sci-Fi</h5>
            <label class="lc-checkbox"><input type="checkbox" id="lc-au-scifi-womb" ${au.artificialWomb ? "checked" : ""}><span>Искусственная матка</span></label>
            <label class="lc-checkbox"><input type="checkbox" id="lc-au-scifi-gene" ${au.geneticModification ? "checked" : ""}><span>Генетическая модификация</span></label>
            <label class="lc-checkbox"><input type="checkbox" id="lc-au-scifi-growth" ${au.acceleratedGrowth ? "checked" : ""}><span>Ускоренный рост</span></label>
        </div>`;

        document.getElementById("lc-au-scifi-womb")?.addEventListener("change", function () {
            settings.auSettings.scifi.artificialWomb = this.checked;
            saveSettingsDebounced();
        });
        document.getElementById("lc-au-scifi-gene")?.addEventListener("change", function () {
            settings.auSettings.scifi.geneticModification = this.checked;
            saveSettingsDebounced();
        });
        document.getElementById("lc-au-scifi-growth")?.addEventListener("change", function () {
            settings.auSettings.scifi.acceleratedGrowth = this.checked;
            saveSettingsDebounced();
        });
    } else {
        container.innerHTML = `<div class="lc-info-note">Реалистичный режим: AU-модификации отключены.</div>`;
    }
}

function bindAUInputs() {
    const settings = extension_settings[extensionName];

    document.querySelectorAll(".lc-au-input").forEach((input) => {
        input.addEventListener("change", function () {
            const path = this.dataset.path.split(".");
            let obj = settings.auSettings;
            for (let i = 0; i < path.length - 1; i++) {
                obj = obj[path[i]];
            }
            const lastKey = path[path.length - 1];
            obj[lastKey] = this.type === "number" ? parseFloat(this.value) : this.value;
            saveSettingsDebounced();
        });
    });

    document.querySelectorAll(".lc-au-check").forEach((input) => {
        input.addEventListener("change", function () {
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
// SILLYTAVERN EVENT HOOKS
// ==========================================

function onMessageReceived(messageIndex) {
    const settings = extension_settings[extensionName];
    if (!settings.enabled || settings.worldDate.frozen) return;

    const context = getContext();
    if (!context.chat || messageIndex < 0) return;

    const message = context.chat[messageIndex];
    if (!message || !message.mes) return;

    // Auto-sync characters on every message
    if (settings.autoSyncCharacters) {
        syncCharactersFromContext();
    }

    // Parse time from AI message
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
    const settings = extension_settings[extensionName];
    if (settings.autoSyncCharacters) {
        syncCharactersFromContext();
    }
    updateUI();
}

function getPromptInjection() {
    const settings = extension_settings[extensionName];
    if (!settings.enabled) return "";
    return PromptInjector.generateInjection();
}

// ==========================================
// INITIALIZATION
// ==========================================

jQuery(async () => {
    // Initialize settings
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    extension_settings[extensionName] = deepMerge(defaultSettings, extension_settings[extensionName]);

    // Generate and inject UI
    const settingsContainer = $(generateSettingsHTML());
    $("#extensions_settings").append(settingsContainer);

    // Bind all events
    bindEvents();

    // Initial sync
    syncCharactersFromContext();

    // Initial UI update
    updateUI();
    renderAUSettings();

    // Subscribe to SillyTavern events
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageIndex) => {
        onMessageReceived(messageIndex);
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        onChatChanged();
    });

    // Prompt injection hook
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (eventData) => {
        const settings = extension_settings[extensionName];
        if (!settings.enabled || !settings.promptInjectionEnabled) return;

        const injection = getPromptInjection();
        if (!injection) return;

        const position = settings.promptInjectionPosition;

        switch (position) {
            case "system":
                if (eventData.systemPrompt !== undefined) {
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

    console.log("[LifeCycle] Extension loaded successfully! v0.2.0");
});

// ==========================================
// GLOBAL API
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
    syncCharacters: syncCharactersFromContext,
    advanceTime: (days) => {
        const settings = extension_settings[extensionName];
        settings.worldDate = addDays(settings.worldDate, days);
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
            result.babies = profile.babies.map((b) => {
                const bm = new BabyManager(b);
                return { name: b.name, age: bm.getAgeLabel(), state: b.state };
            });
        }

        return result;
    },
};
