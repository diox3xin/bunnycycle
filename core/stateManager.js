/**
 * BunnyCycle v3.0 вЂ” Р¦РµРЅС‚СЂР°Р»СЊРЅРѕРµ С…СЂР°РЅРёР»РёС‰Рµ СЃРѕСЃС‚РѕСЏРЅРёР№
 */

import { extension_settings } from '/scripts/extensions.js';
import { saveSettingsDebounced } from '/script.js';
import { deepMerge } from '../utils/helpers.js';

const EXT = 'bunnycycle';

// ========================
// Р”Р•Р¤РћР›РўРќР«Р• РќРђРЎРўР РћР™РљР
// ========================
export const DEFAULTS = {
    enabled: true,
    panelCollapsed: false,

    // РњРѕРґСѓР»Рё
    modules: {
        cycle: true,
        pregnancy: true,
        labor: true,
        baby: true,
        intimacy: true,
        health: true,
        auOverlay: false
    },

    // РђРІС‚РѕРјР°С‚РёР·Р°С†РёСЏ
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

    // РџСЂРѕРјРїС‚
    promptInjectionEnabled: true,
    promptInjectionPosition: 'authornote',
    promptRPMode: true,
    sexDetectMinScore: 2,

    // API РґР»СЏ РР-Р°РЅР°Р»РёР·Р°
    aiApi: {
        enabled: false,        // РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РєР°СЃС‚РѕРјРЅС‹Р№ API РІРјРµСЃС‚Рѕ SillyTavern
        url: '',               // Р±Р°Р·РѕРІС‹Р№ URL (РЅР°РїСЂ. https://api.openai.com/v1)
        key: '',               // API РєР»СЋС‡
        model: 'gpt-4o-mini',  // РјРѕРґРµР»СЊ
        maxTokens: 800,
        temperature: 0.05
    },

    // Р’СЂРµРјСЏ РјРёСЂР°
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

    // РљР°СЃС‚РѕРјРЅС‹Р№ AU (С‚РµРєСЃС‚ в†’ РІ РїСЂРѕРјРїС‚)
    customAu: {
        diseases: '',
        pregnancyRules: '',
        treatment: '',
        worldRules: ''
    },

    // РќР°СЃС‚СЂРѕР№РєРё Р·РґРѕСЂРѕРІСЊСЏ
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

    // Р”Р°РЅРЅС‹Рµ
    characters: {},
    relationships: [],
    diceLog: [],
    intimacyLog: [],
    healthLog: [],
    chatProfiles: {},
    currentChatId: null,

    // РћС‚Р»Р°РґРєР°
    debugTrace: false
};

// ========================
// API РҐР РђРќРР›РР©Рђ
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
// Р¤РђР‘Р РРљРђ РџР РћР¤РР›Р•Р™ РџР•Р РЎРћРќРђР–Р•Р™
// ========================
export function makeProfile(name, isUser, sex) {
    const isMale = sex === 'M';
    const resolvedSex = sex || null; // null = РїРѕР» РЅРµ РѕРїСЂРµРґРµР»С‘РЅ
    return {
        name,
        bioSex: resolvedSex,
        secondarySex: null,
        race: 'human',
        _customRace: '',
        contraception: 'none',
        eyeColor: '',
        hairColor: '',
        age: null,
        pregnancyDifficulty: 'normal',
        _isUser: isUser,
        _isNPC: false,
        _enabled: true,
        _canLayEggs: false,
        _canGetPregnant: null,
        _pregMaxWeeks: null,
        // Р СѓС‡РЅС‹Рµ РїСЂР°РІРєРё (С‡С‚РѕР±С‹ LLM РЅРµ РїРµСЂРµР·Р°РїРёСЃС‹РІР°Р»)
        _mB: false, _mS: false, _mR: false, _mE: false, _mH: false, _mP: false, _mCyc: false,
        _sexSource: '',
        _sexConfidence: 0,

        // Р¦РёРєР»
        cycle: {
            enabled: !isMale,
            currentDay: Math.floor(Math.random() * 28) + 1,
            baseLength: 28, length: 28,
            menstruationDuration: 5,
            irregularity: 2,
            symptomIntensity: 'moderate',
            cycleCount: 0
        },

        // Р‘РµСЂРµРјРµРЅРЅРѕСЃС‚СЊ
        pregnancy: {
            active: false, week: 0, day: 0, maxWeeks: 40,
            father: null, fetusCount: 1, fetusSexes: [],
            complications: [], weightGain: 0
        },

        // Р РѕРґС‹
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

        // Р”РµС‚Рё
        babies: [],

        // Р—РґРѕСЂРѕРІСЊРµ (РјР°СЃС€С‚Р°Р±РЅР°СЏ СЃРёСЃС‚РµРјР°)
        health: {
            conditions: [],       // РђРєС‚РёРІРЅС‹Рµ СЃРѕСЃС‚РѕСЏРЅРёСЏ [{id, type, label, severity, day, maxDays, note, effects, treatable}]
            immunity: 70,         // 0-100 РёРјРјСѓРЅРёС‚РµС‚
            stress: 20,           // 0-100 СЃС‚СЂРµСЃСЃ
            energy: 80,           // 0-100 СЌРЅРµСЂРіРёСЏ
            pain: 0,              // 0-100 Р±РѕР»СЊ
            bloodLoss: 0,         // 0-100 РєСЂРѕРІРѕРїРѕС‚РµСЂСЏ
            mentalState: 'stable', // stable, anxious, depressed, euphoric, traumatized, numb
            allergies: [],        // Р°Р»Р»РµСЂРіРёРё
            chronicConditions: [], // С…СЂРѕРЅРёС‡РµСЃРєРёРµ Р±РѕР»РµР·РЅРё
            injuries: [],         // С‚СЂР°РІРјС‹ [{id, type, location, severity, day, healDays, scarring}]
            medications: [],      // Р»РµРєР°СЂСЃС‚РІР° [{id, name, effect, daysLeft, sideEffects}]
            lastCheckup: null,    // РґР°С‚Р° РїРѕСЃР»РµРґРЅРµРіРѕ РѕСЃРјРѕС‚СЂР°
            history: []           // РёСЃС‚РѕСЂРёСЏ Р±РѕР»РµР·РЅРµР№ [{label, resolvedDate, outcome}]
        },

        // Р­РјРѕС†РёРё (РґР»СЏ РІРёРґР¶РµС‚Р°)
        mood: {
            current: 'neutral',   // neutral, happy, sad, angry, scared, aroused, exhausted, in_pain
            intensity: 'mild'     // mild, moderate, strong, overwhelming
        }
    };
}

// ========================
// РџР РћР’Р•Р РљР
// ========================
export function canGetPregnant(p) {
    if (!p || !p._enabled) return false;
    if (p._canGetPregnant !== undefined && p._canGetPregnant !== null) return !!p._canGetPregnant;
    if (p.bioSex === 'F') return true;
    const s = getSettings();
    if (p.bioSex === 'M' && s.modules.auOverlay && s.auPreset === 'omegaverse' &&
        s.auSettings.omegaverse.maleOmegaPregnancy && p.secondarySex === 'omega') return true;
    return false;
}

export function ensureProfileFields(p) {
    if (!p.bond) p.bond = { bonded: false, partner: null, type: null, strength: 0, daysSinceSeparation: 0, withdrawalActive: false, markLocation: '' };
    if (!p.heat) p.heat = { active: false, currentDay: 0, cycleDays: 30, duration: 5, intensity: 'moderate', daysSinceLast: 0, onSuppressants: false };
    if (!p.rut) p.rut = { active: false, currentDay: 0, cycleDays: 35, duration: 4, intensity: 'moderate', daysSinceLast: 0 };
    if (!p.labor.complications) p.labor.complications = [];
    if (!p.pregnancy.complications) p.pregnancy.complications = [];
    if (!p.pregnancy.fetusSexes) p.pregnancy.fetusSexes = [];
    if (p._canGetPregnant === undefined) p._canGetPregnant = null;
    if (p._pregMaxWeeks === undefined) p._pregMaxWeeks = null;
    if (p._customRace === undefined) p._customRace = "";
    if (p._isNPC === undefined) p._isNPC = false;
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
