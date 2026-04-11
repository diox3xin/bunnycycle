/**
 * BunnyCycle v3.0 — Центральное хранилище состояний
 */

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { deepMerge } from '../utils/helpers.js';

const EXT = 'bunnycycle';

// ========================
// ДЕФОЛТНЫЕ НАСТРОЙКИ
// ========================
export const DEFAULTS = {
    enabled: true,
    panelCollapsed: false,

    // Модули
    modules: {
        cycle: true,
        pregnancy: true,
        labor: true,
        baby: true,
        intimacy: true,
        health: true,
        auOverlay: false
    },

    // Автоматизация
    autoSyncCharacters: true,
    autoParseCharInfo: true,
    autoDetectIntimacy: true,
    autoRollOnSex: true,
    autoTimeProgress: true,
    useLLMParsing: true,
    parseFullChat: true,
    useResponseTags: true,

    // UI
    showStatusWidget: true,
    showWidgetAlways: false,
    showLauncherButton: true,
    drawerPosition: 'right',

    // Промпт
    promptInjectionEnabled: true,
    promptInjectionPosition: 'authornote',
    promptRPMode: true,
    sexDetectMinScore: 2,

    // Время мира
    worldDate: { year: 2025, month: 1, day: 1, hour: 12, minute: 0, frozen: false },

    // AU
    auPreset: 'realism',
    auSettings: {
        omegaverse: {
            heatCycleLength: 30, heatDuration: 5, heatFertilityBonus: 0.35,
            preHeatDays: 1, postHeatDays: 1, heatIntensity: 'moderate',
            rutCycleLength: 35, rutDuration: 4, preRutDays: 1, postRutDays: 1, rutIntensity: 'moderate',
            knotEnabled: true, knotDurationMin: 30,
            bondingEnabled: true, bondingType: 'bite',
            bondEffectEmpathy: true, bondEffectProximity: true, bondEffectProtective: true,
            bondBreakable: false, bondWithdrawalDays: 7,
            suppressantsAvailable: true, suppressantEffectiveness: 0.85, suppressantSideEffects: true,
            slickEnabled: true, scentEnabled: true, nestingEnabled: true, purringEnabled: true,
            maleOmegaPregnancy: true, pregnancyWeeks: 36, twinChance: 0.1,
            alphaCommandVoice: true, omegaSubmission: true
        },
        fantasy: {
            pregnancyByRace: {
                human: 40, elf: 60, dwarf: 35, orc: 32, demon: 28,
                vampire: 50, werewolf: 9, fairy: 20, dragon: 80, halfling: 38
            },
            magicPregnancy: false, acceleratedPregnancy: false, accelerationFactor: 1.0
        },
        oviposition: {
            enabled: false,
            eggCountMin: 1, eggCountMax: 6, gestationDays: 14,
            layingDuration: 3, incubationDays: 21, fertilizationChance: 0.7,
            shellType: 'hard', eggSize: 'medium', painLevel: 'moderate', aftercareDays: 2
        }
    },

    // Кастомный AU (текст → в промпт)
    customAu: {
        diseases: '',
        pregnancyRules: '',
        treatment: '',
        worldRules: ''
    },

    // Настройки здоровья
    healthSettings: {
        autoGenerateEvents: true,
        complicationChance: 0.15,
        diseaseChance: 0.08,
        healingRate: 'normal',
        enableTrauma: true,
        enableMentalHealth: true,
        enableImmunity: true,
        seasonalDiseases: true
    },

    // Данные
    characters: {},
    relationships: [],
    diceLog: [],
    intimacyLog: [],
    healthLog: [],
    chatProfiles: {},
    currentChatId: null,

    // Отладка
    debugTrace: false
};

// ========================
// API ХРАНИЛИЩА
// ========================
export function getSettings() {
    return extension_settings[EXT];
}

export function initSettings() {
    if (!extension_settings[EXT]) {
        extension_settings[EXT] = JSON.parse(JSON.stringify(DEFAULTS));
    } else {
        extension_settings[EXT] = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), extension_settings[EXT]);
    }
    return extension_settings[EXT];
}

export function saveSettings() {
    saveSettingsDebounced();
}

export function resetSettings() {
    extension_settings[EXT] = JSON.parse(JSON.stringify(DEFAULTS));
    saveSettingsDebounced();
}

// ========================
// ФАБРИКА ПРОФИЛЕЙ ПЕРСОНАЖЕЙ
// ========================
export function makeProfile(name, isUser, sex) {
    const isMale = (sex || 'F') === 'M';
    return {
        name,
        bioSex: sex || 'F',
        secondarySex: null,
        race: 'human',
        contraception: 'none',
        eyeColor: '',
        hairColor: '',
        age: null,
        pregnancyDifficulty: 'normal',
        _isUser: isUser,
        _enabled: true,
        _canLayEggs: false,
        // Ручные правки (чтобы LLM не перезаписывал)
        _mB: false, _mS: false, _mR: false, _mE: false, _mH: false, _mP: false, _mCyc: false,
        _sexSource: '',
        _sexConfidence: 0,

        // Цикл
        cycle: {
            enabled: !isMale,
            currentDay: Math.floor(Math.random() * 28) + 1,
            baseLength: 28, length: 28,
            menstruationDuration: 5,
            irregularity: 2,
            symptomIntensity: 'moderate',
            cycleCount: 0
        },

        // Беременность
        pregnancy: {
            active: false, week: 0, day: 0, maxWeeks: 40,
            father: null, fetusCount: 1, fetusSexes: [],
            complications: [], weightGain: 0
        },

        // Роды
        labor: {
            active: false, stage: 'latent', dilation: 0,
            hoursElapsed: 0, babiesDelivered: 0, totalBabies: 1,
            complications: []
        },

        // AU
        heat: {
            active: false, currentDay: 0, cycleDays: 30, duration: 5,
            intensity: 'moderate', daysSinceLast: Math.floor(Math.random() * 25),
            onSuppressants: false
        },
        rut: {
            active: false, currentDay: 0, cycleDays: 35, duration: 4,
            intensity: 'moderate', daysSinceLast: Math.floor(Math.random() * 30)
        },
        bond: {
            bonded: false, partner: null, type: null, strength: 0,
            daysSinceSeparation: 0, withdrawalActive: false, markLocation: ''
        },
        oviposition: null,

        // Дети
        babies: [],

        // Здоровье (масштабная система)
        health: {
            conditions: [],       // Активные состояния [{id, type, label, severity, day, maxDays, note, effects, treatable}]
            immunity: 70,         // 0-100 иммунитет
            stress: 20,           // 0-100 стресс
            energy: 80,           // 0-100 энергия
            pain: 0,              // 0-100 боль
            bloodLoss: 0,         // 0-100 кровопотеря
            mentalState: 'stable', // stable, anxious, depressed, euphoric, traumatized, numb
            allergies: [],        // аллергии
            chronicConditions: [], // хронические болезни
            injuries: [],         // травмы [{id, type, location, severity, day, healDays, scarring}]
            medications: [],      // лекарства [{id, name, effect, daysLeft, sideEffects}]
            lastCheckup: null,    // дата последнего осмотра
            history: []           // история болезней [{label, resolvedDate, outcome}]
        },

        // Эмоции (для виджета)
        mood: {
            current: 'neutral',   // neutral, happy, sad, angry, scared, aroused, exhausted, in_pain
            intensity: 'mild'     // mild, moderate, strong, overwhelming
        }
    };
}

// ========================
// ПРОВЕРКИ
// ========================
export function canGetPregnant(p) {
    if (!p || !p._enabled) return false;
    if (p.bioSex === 'F') return true;
    const s = getSettings();
    if (p.bioSex === 'M' && s.modules.auOverlay && s.auPreset === 'omegaverse' &&
        s.auSettings.omegaverse.maleOmegaPregnancy && p.secondarySex === 'omega') return true;
    return false;
}

export function ensureProfileFields(p) {
    if (!p.bond) p.bond = { bonded: false, partner: null, type: null, strength: 0, daysSinceSeparation: 0, withdrawalActive: false, markLocation: '' };
    if (!p.labor.complications) p.labor.complications = [];
    if (!p.pregnancy.complications) p.pregnancy.complications = [];
    if (!p.pregnancy.fetusSexes) p.pregnancy.fetusSexes = [];
    if (!p.health) p.health = makeProfile('', false, 'F').health;
    if (p.health.immunity === undefined) p.health.immunity = 70;
    if (p.health.stress === undefined) p.health.stress = 20;
    if (p.health.energy === undefined) p.health.energy = 80;
    if (p.health.pain === undefined) p.health.pain = 0;
    if (p.health.bloodLoss === undefined) p.health.bloodLoss = 0;
    if (!p.health.mentalState) p.health.mentalState = 'stable';
    if (!p.health.injuries) p.health.injuries = [];
    if (!p.health.medications) p.health.medications = [];
    if (!p.health.allergies) p.health.allergies = [];
    if (!p.health.chronicConditions) p.health.chronicConditions = [];
    if (!p.health.history) p.health.history = [];
    if (!p.mood) p.mood = { current: 'neutral', intensity: 'mild' };
}
