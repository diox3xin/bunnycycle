// ============================================================
// LifeCycle Extension v0.4.0 — index.js (Full Rewrite)
// Auto-detect sex scenes, auto-dice, auto-parse characters,
// collapsible panel, status widget after every message
// ============================================================

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "lifecycle";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// ==========================================
// DEFAULT SETTINGS
// ==========================================

const defaultSettings = {
    enabled: true,
    panelCollapsed: false,
    autoSyncCharacters: true,
    autoParseCharInfo: true,
    autoDetectIntimacy: true,
    autoRollOnSex: true,
    showStatusWidget: true,
    modules: {
        cycle: true,
        pregnancy: true,
        labor: true,
        baby: true,
        intimacy: true,
        auOverlay: false,
    },
    worldDate: { year: 2025, month: 1, day: 1, hour: 12, minute: 0, frozen: false },
    autoTimeProgress: true,
    timeParserSensitivity: "medium",
    timeParserConfirmation: false,
    promptInjectionEnabled: true,
    promptInjectionPosition: "authornote",
    promptInjectionDetail: "medium",
    auPreset: "realism",
    auSettings: {
        omegaverse: {
            heatCycleLength: 30,
            heatDuration: 5,
            heatFertilityBonus: 0.35,
            rutDuration: 4,
            knotEnabled: true,
            knotDurationMin: 15,
            bondingEnabled: true,
            bondType: "bite_mark",
            suppressantsAvailable: true,
            maleOmegaPregnancy: true,
            pregnancyWeeks: 36,
        },
        fantasy: {
            pregnancyByRace: { human: 40, elf: 60, dwarf: 35, orc: 32, halfling: 38 },
            nonHumanFeatures: true,
            magicalComplications: false,
        },
        scifi: {
            artificialWomb: false,
            geneticModification: false,
            acceleratedGrowth: false,
        },
    },
    characters: {},
    diceLog: [],
    intimacyLog: [],
    lastWidgetHTML: "",
};

// ==========================================
// UTILITY
// ==========================================

function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) &&
            target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
            result[key] = deepMerge(target[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

function formatDate(d) {
    const pad = n => String(n).padStart(2, "0");
    return `${d.year}/${pad(d.month)}/${pad(d.day)} ${pad(d.hour)}:${pad(d.minute)}`;
}

function addDays(d, days) {
    const dt = new Date(d.year, d.month - 1, d.day, d.hour, d.minute);
    dt.setDate(dt.getDate() + days);
    return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate(), hour: dt.getHours(), minute: dt.getMinutes(), frozen: d.frozen };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rollDice(sides) { return Math.floor(Math.random() * (sides || 100)) + 1; }

// ==========================================
// CHARACTER INFO PARSER (auto-extract from card)
// ==========================================

class CharInfoParser {
    static SEX_PATTERNS = {
        F: /\b(female|woman|girl|девушка|женщина|девочка|she\/her|фем|самка|женский\s*пол)\b/i,
        M: /\b(male|man|boy|мужчина|парень|мальчик|he\/him|маск|самец|мужской\s*пол)\b/i,
    };

    static SECONDARY_SEX_PATTERNS = {
        alpha: /\b(alpha|альфа)\b/i,
        beta: /\b(beta|бета)\b/i,
        omega: /\b(omega|омега)\b/i,
    };

    static RACE_PATTERNS = {
        human: /\b(human|человек|людской)\b/i,
        elf: /\b(elf|elven|эльф|эльфийк[аи])\b/i,
        dwarf: /\b(dwarf|дварф|гном)\b/i,
        orc: /\b(orc|орк)\b/i,
        halfling: /\b(halfling|полурослик|хоббит)\b/i,
        demon: /\b(demon|демон)\b/i,
        vampire: /\b(vampire|вампир)\b/i,
        werewolf: /\b(werewolf|оборотень|ликантроп)\b/i,
        dragon: /\b(dragon|дракон)\b/i,
        neko: /\b(neko|неко|кошко(девочка|мальчик|человек))\b/i,
        kitsune: /\b(kitsune|кицунэ|лис(ица|а)?)\b/i,
    };

    static EYE_PATTERN = /(?:(?:eye|eyes|глаз[аы]?|цвет\s*глаз)\s*[:\-=]?\s*)([\wа-яё\s\-]+?)(?:[,.\n;|]|$)/i;
    static EYE_COLOR_PATTERN = /\b((?:голуб|синь|сер|зелён|зелен|карь|кари|чёрн|черн|жёлт|желт|красн|фиолетов|янтарн|золот|ореховь|бирюзов|лавандов|гетерохром)\S*|blue|green|brown|hazel|grey|gray|amber|gold|red|violet|purple|heterochrom\S*)\s*(?:eye|eyes|глаз)/i;
    static HAIR_PATTERN = /(?:(?:hair|волос[аы]?|цвет\s*волос)\s*[:\-=]?\s*)([\wа-яё\s\-]+?)(?:[,.\n;|]|$)/i;
    static HAIR_COLOR_PATTERN = /\b((?:блонд|русь|русы|рыж|чёрн|черн|тёмн|темн|белый|бел|серебрист|розов|голуб|зелён|зелен|фиолетов|пепельн|каштанов|платинов|медн|золотист|лиловь|пшеничн)\S*|blonde?|brunette?|redhead|black|white|silver|pink|blue|green|purple|ash|chestnut|platinum|copper|golden)\s*(?:hair|волос)/i;

    static parseFromText(text) {
        if (!text) return {};
        const info = {};

        // Bio sex
        for (const [sex, pat] of Object.entries(this.SEX_PATTERNS)) {
            if (pat.test(text)) { info.bioSex = sex; break; }
        }

        // Secondary sex (omegaverse)
        for (const [sec, pat] of Object.entries(this.SECONDARY_SEX_PATTERNS)) {
            if (pat.test(text)) { info.secondarySex = sec; break; }
        }

        // Race
        for (const [race, pat] of Object.entries(this.RACE_PATTERNS)) {
            if (pat.test(text)) { info.race = race; break; }
        }

        // Eye color
        let eyeMatch = text.match(this.EYE_COLOR_PATTERN);
        if (eyeMatch) info.eyeColor = eyeMatch[1].trim();
        else {
            eyeMatch = text.match(this.EYE_PATTERN);
            if (eyeMatch) info.eyeColor = eyeMatch[1].trim().substring(0, 30);
        }

        // Hair color
        let hairMatch = text.match(this.HAIR_COLOR_PATTERN);
        if (hairMatch) info.hairColor = hairMatch[1].trim();
        else {
            hairMatch = text.match(this.HAIR_PATTERN);
            if (hairMatch) info.hairColor = hairMatch[1].trim().substring(0, 30);
        }

        return info;
    }

    static parseCharacter(charObj) {
        if (!charObj) return {};
        const texts = [
            charObj.description || "",
            charObj.personality || "",
            charObj.scenario || "",
            charObj.first_mes || "",
            (charObj.data?.description) || "",
            (charObj.data?.personality) || "",
        ].join("\n");
        return this.parseFromText(texts);
    }
}

// ==========================================
// INTIMACY AUTO-DETECTOR (parses messages for sex scenes)
// ==========================================

class IntimacyDetector {
    static SEX_KEYWORDS_RU = [
        /вошё?л\s*(в\s*неё|внутрь|в\s*него|глубже)/i,
        /проник\s*(в\s*неё|внутрь|в\s*него)/i,
        /вставил/i,
        /трахал|трахнул|трахает|ебал|ебёт|выебал/i,
        /кончил\s*(внутрь|в\s*неё|в\s*него|наружу|на\s*живот|на\s*лицо|на\s*спину)/i,
        /сперма|семя\s*(?:внутри|хлынул|наполнил)/i,
        /кончила|оргазм/i,
        /член\s*(?:вошёл|скольз|внутри|погруж|двигал)/i,
        /насадил(?:а|ась)?/i,
        /толчки?\s*(?:бёдер|бедр|внутри|глубок)/i,
        /фрикци[ия]/i,
        /вагинальн|анальн/i,
        /без\s*(?:преза?ерватива|защиты|резинки)/i,
        /внутрь\s*(?:неё|него|меня)/i,
        /наполнил\s*(?:её|его|спермой)/i,
        /кнот|узел\s*(?:набух|вошёл|внутри|раздул|застрял)/i,
        /сцеп(?:ка|ились|лены)/i,
    ];

    static SEX_KEYWORDS_EN = [
        /(?:thrust|pushed|slid)\s*(?:inside|into|deeper|in)/i,
        /penetrat/i,
        /fuck(?:ed|ing|s)/i,
        /cum(?:ming|med|s)?\s*(?:inside|in(?:to)?|deep)/i,
        /came\s*(?:inside|in(?:to)?)/i,
        /sperm|semen|seed\s*(?:inside|fill)/i,
        /orgasm/i,
        /cock\s*(?:enter|inside|slid|push|buried|throb)/i,
        /rode\s*(?:him|her|them)/i,
        /raw|bareback|without\s*(?:a\s*)?(?:condom|protection)/i,
        /bred|breed|impregnate|creampie/i,
        /fill(?:ed|ing)?\s*(?:her|him|them)\s*(?:up|with|womb)/i,
        /knot(?:ted|ting|s)?\s*(?:inside|swell|lock|stuck|caught)/i,
    ];

    static CONTRACEPTION_KEYWORDS = [
        /презерватив|кондом|резинк[аеу]/i,
        /condom/i,
        /надел\s*(?:защиту|резинку|презерватив)/i,
        /put\s*(?:on|a)\s*condom/i,
        /wrapped/i,
    ];

    static NO_CONTRACEPTION_KEYWORDS = [
        /без\s*(?:преза?ерватива|защиты|резинки|кондома)/i,
        /(?:raw|bareback|without\s*(?:a\s*)?(?:condom|protection))/i,
        /сорвал\s*презерватив|снял\s*презерватив/i,
        /(?:took|pulled|ripped)\s*(?:off|away)\s*(?:the\s*)?condom/i,
        /не\s*(?:надел|использовал)\s*(?:презерватив|защиту)/i,
    ];

    static EJACULATION_INSIDE = [
        /кончил\s*(?:внутрь|в\s*неё|в\s*него|глубоко)/i,
        /наполнил\s*(?:её|его|спермой|семенем)/i,
        /сперма\s*(?:хлынула?|заполнила?|внутри)/i,
        /cum(?:ming|med)?\s*(?:inside|in(?:to)?|deep)/i,
        /came\s*(?:inside|in(?:to)?|deep)/i,
        /fill(?:ed|ing)?\s*(?:her|him|them|womb)/i,
        /bred|breed|creampie/i,
        /seed\s*(?:fill|flood|pour|spill|deep)/i,
        /узел\s*(?:внутри|застрял|набух|раздул)/i,
        /knot(?:ted|ting)?\s*(?:inside|lock|caught|stuck)/i,
    ];

    static EJACULATION_OUTSIDE = [
        /кончил\s*(?:наружу|на\s*живот|на\s*лицо|на\s*спину|на\s*грудь|снаружи)/i,
        /вытащил\s*(?:и\s*кончил|перед|в\s*последний)/i,
        /cum(?:ming|med)?\s*(?:on|outside|over|across)/i,
        /pull(?:ed|ing)?\s*out/i,
    ];

    static ANAL_KEYWORDS = [
        /анал(?:ьн)?/i,
        /в\s*(?:задн(?:ий|юю)|попу|попку|анус)/i,
        /anal/i,
        /(?:ass|anus|backdoor|rear)/i,
    ];

    static ORAL_KEYWORDS = [
        /(?:отсос|минет|куннилингус|фелляци)/i,
        /взял[аи]?\s*в\s*рот/i,
        /(?:blowjob|oral|fellatio|cunnilingus)/i,
        /(?:suck(?:ed|ing)?)\s*(?:his|her|cock|dick|clit)/i,
    ];

    static detect(message, characters) {
        if (!message) return null;
        const text = message;

        // Check if sex scene
        const allSexPatterns = [...this.SEX_KEYWORDS_RU, ...this.SEX_KEYWORDS_EN];
        let sexScore = 0;
        for (const pat of allSexPatterns) {
            if (pat.test(text)) sexScore++;
        }

        if (sexScore < 2) return null; // Need at least 2 matches to be confident

        // Determine act type
        let actType = "vaginal";
        for (const pat of this.ANAL_KEYWORDS) {
            if (pat.test(text)) { actType = "anal"; break; }
        }
        for (const pat of this.ORAL_KEYWORDS) {
            if (pat.test(text)) { actType = "oral"; break; }
        }

        // Determine contraception
        let hasContraception = false;
        let noContraception = false;
        for (const pat of this.CONTRACEPTION_KEYWORDS) {
            if (pat.test(text)) { hasContraception = true; break; }
        }
        for (const pat of this.NO_CONTRACEPTION_KEYWORDS) {
            if (pat.test(text)) { noContraception = true; break; }
        }

        // Determine ejaculation
        let ejaculation = "unknown";
        for (const pat of this.EJACULATION_INSIDE) {
            if (pat.test(text)) { ejaculation = "inside"; break; }
        }
        if (ejaculation === "unknown") {
            for (const pat of this.EJACULATION_OUTSIDE) {
                if (pat.test(text)) { ejaculation = "outside"; break; }
            }
        }

        // Determine participants from known character names
        const participants = [];
        const charNames = Object.keys(characters);
        for (const name of charNames) {
            if (text.toLowerCase().includes(name.toLowerCase()) || characters[name]._isUser) {
                participants.push(name);
            }
        }

        // If we can't determine participants, use all active chars
        if (participants.length < 2 && charNames.length >= 2) {
            for (const name of charNames) {
                if (!participants.includes(name)) participants.push(name);
                if (participants.length >= 2) break;
            }
        }

        // Determine target (who can get pregnant)
        let target = null;
        for (const name of participants) {
            const p = characters[name];
            if (!p) continue;
            const s = extension_settings[extensionName];
            if (p.bioSex === "F") { target = name; break; }
            if (s.modules.auOverlay && s.auPreset === "omegaverse" &&
                p.bioSex === "M" && p.secondarySex === "omega" &&
                s.auSettings.omegaverse.maleOmegaPregnancy) {
                target = name;
                break;
            }
        }

        return {
            detected: true,
            sexScore,
            actType,
            hasContraception: hasContraception && !noContraception,
            noContraception,
            ejaculation,
            participants,
            target,
        };
    }
}

// ==========================================
// CHARACTER SYNC
// ==========================================

function getActiveCharacters() {
    const ctx = getContext();
    const chars = [];
    if (!ctx) return chars;

    if (ctx.characterId !== undefined && ctx.characters) {
        const c = ctx.characters[ctx.characterId];
        if (c) chars.push({ name: c.name, avatar: c.avatar, isUser: false, charObj: c });
    }

    if (ctx.groups && ctx.groupId) {
        const group = ctx.groups.find(g => g.id === ctx.groupId);
        if (group && group.members) {
            for (const av of group.members) {
                const c = ctx.characters.find(ch => ch.avatar === av);
                if (c && !chars.find(x => x.name === c.name)) {
                    chars.push({ name: c.name, avatar: c.avatar, isUser: false, charObj: c });
                }
            }
        }
    }

    if (ctx.name1) chars.push({ name: ctx.name1, avatar: null, isUser: true, charObj: null });
    return chars;
}

function syncCharacters() {
    const s = extension_settings[extensionName];
    if (!s.autoSyncCharacters) return;
    const active = getActiveCharacters();
    let changed = false;

    for (const c of active) {
        if (!s.characters[c.name]) {
            s.characters[c.name] = makeProfile(c.name, c.isUser);
            changed = true;
        }

        // Auto-parse character info from card
        if (s.autoParseCharInfo && c.charObj && !c.isUser) {
            const parsed = CharInfoParser.parseCharacter(c.charObj);
            const p = s.characters[c.name];
            if (parsed.bioSex && !p._manualBioSex) { p.bioSex = parsed.bioSex; changed = true; }
            if (parsed.secondarySex && !p._manualSecSex) { p.secondarySex = parsed.secondarySex; changed = true; }
            if (parsed.race && !p._manualRace) { p.race = parsed.race; changed = true; }
            if (parsed.eyeColor && !p._manualEyes) { p.eyeColor = parsed.eyeColor; changed = true; }
            if (parsed.hairColor && !p._manualHair) { p.hairColor = parsed.hairColor; changed = true; }
        }
    }
    if (changed) saveSettingsDebounced();
}

function makeProfile(name, isUser) {
    return {
        name, bioSex: "F", secondarySex: null, race: "human",
        contraception: "none", eyeColor: "", hairColor: "",
        pregnancyDifficulty: "normal",
        _isUser: isUser, _enabled: true,
        _manualBioSex: false, _manualSecSex: false,
        _manualRace: false, _manualEyes: false, _manualHair: false,
        cycle: {
            enabled: true,
            currentDay: Math.floor(Math.random() * 28) + 1,
            baseLength: 28, length: 28,
            menstruationDuration: 5, irregularity: 2,
            symptomIntensity: "moderate", cycleCount: 0,
        },
        pregnancy: {
            active: false, week: 0, day: 0, maxWeeks: 40,
            father: null, fetusCount: 1, complications: [], weightGain: 0,
        },
        labor: {
            active: false, stage: "latent", dilation: 0,
            contractionInterval: 0, contractionDuration: 0,
            hoursElapsed: 0, babiesDelivered: 0, totalBabies: 1,
        },
        heat: {
            active: false, currentDay: 0, duration: 5,
            intensity: "moderate", daysSinceLast: 0, onSuppressants: false,
        },
        rut: {
            active: false, currentDay: 0, duration: 4,
            intensity: "moderate", daysSinceLast: 0,
        },
        babies: [],
    };
}

// ==========================================
// CYCLE MANAGER
// ==========================================

class CycleManager {
    constructor(p) { this.p = p; this.c = p.cycle; }

    phase() {
        if (!this.c || !this.c.enabled) return "unknown";
        const d = this.c.currentDay, l = this.c.length, m = this.c.menstruationDuration;
        const ov = Math.round(l - 14);
        if (d <= m) return "menstruation";
        if (d < ov - 2) return "follicular";
        if (d <= ov + 1) return "ovulation";
        return "luteal";
    }

    phaseLabel(ph) {
        return { menstruation: "Менструация", follicular: "Фолликулярная", ovulation: "Овуляция", luteal: "Лютеиновая", unknown: "—" }[ph] || ph;
    }

    phaseEmoji(ph) {
        return { menstruation: "🔴", follicular: "🌸", ovulation: "🥚", luteal: "🌙", unknown: "❓" }[ph] || "❓";
    }

    fertility() {
        const ph = this.phase();
        const base = { ovulation: 0.25, follicular: 0.08, luteal: 0.02, menstruation: 0.01, unknown: 0.05 }[ph] || 0.05;
        const s = extension_settings[extensionName];
        let bonus = 0;
        if (s.modules.auOverlay && s.auPreset === "omegaverse" && this.p.heat?.active) {
            bonus = s.auSettings.omegaverse.heatFertilityBonus;
        }
        return Math.min(base + bonus, 0.95);
    }

    libido() {
        const base = { ovulation: "высокое", follicular: "среднее", luteal: "низкое", menstruation: "низкое" }[this.phase()] || "среднее";
        if (this.p.heat?.active) return "экстремальное";
        if (this.p.rut?.active) return "экстремальное";
        return base;
    }

    symptoms() {
        const ph = this.phase(), int = this.c.symptomIntensity, r = [];
        if (ph === "menstruation") { r.push("кровотечение"); if (int !== "mild") r.push("спазмы"); if (int === "severe") r.push("сильная боль"); }
        if (ph === "ovulation") { r.push("повышенное либидо"); if (int !== "mild") r.push("чувствительность груди"); }
        if (ph === "luteal") { r.push("ПМС"); if (int !== "mild") r.push("перепады настроения"); }
        if (ph === "follicular") r.push("прилив энергии");
        return r;
    }

    discharge() {
        return { menstruation: "менструальные", follicular: "скудные", ovulation: "обильные, прозрачные, тягучие", luteal: "густые, белые" }[this.phase()] || "обычные";
    }

    advance(days) {
        for (let i = 0; i < days; i++) {
            this.c.currentDay++;
            if (this.c.currentDay > this.c.length) {
                this.c.currentDay = 1;
                this.c.cycleCount++;
                if (this.c.irregularity > 0) {
                    const v = Math.floor(Math.random() * this.c.irregularity * 2) - this.c.irregularity;
                    this.c.length = clamp(this.c.baseLength + v, 21, 45);
                }
            }
        }
    }
}

// ==========================================
// PREGNANCY MANAGER
// ==========================================

class PregnancyManager {
    constructor(p) { this.p = p; this.pr = p.pregnancy; }
    active() { return this.pr && this.pr.active; }

    start(father, count) {
        const s = extension_settings[extensionName];
        this.pr.active = true; this.pr.week = 1; this.pr.day = 0;
        this.pr.father = father; this.pr.fetusCount = count || 1;
        this.pr.weightGain = 0; this.pr.complications = [];

        let maxW = 40;
        if (s.modules.auOverlay && s.auPreset === "omegaverse") {
            maxW = s.auSettings.omegaverse.pregnancyWeeks || 36;
        } else if (s.modules.auOverlay && s.auPreset === "fantasy" && this.p.race) {
            maxW = s.auSettings.fantasy.pregnancyByRace[this.p.race] || 40;
        }
        if (count > 1) maxW = Math.max(28, maxW - (count - 1) * 3);
        this.pr.maxWeeks = maxW;

        if (this.p.cycle) this.p.cycle.enabled = false;
    }

    advanceDay(days) {
        if (!this.active()) return;
        this.pr.day += days;
        while (this.pr.day >= 7) { this.pr.day -= 7; this.pr.week++; }
        this.pr.weightGain = this.weightGain();
    }

    trimester() { return this.pr.week <= 12 ? 1 : this.pr.week <= 27 ? 2 : 3; }

    fetalSize() {
        const w = this.pr.week;
        const sizes = [[4,"маковое зерно"],[6,"черника"],[8,"малина"],[10,"кумкват"],[12,"лайм"],[14,"лимон"],[16,"авокадо"],[18,"перец"],[20,"банан"],[22,"папайя"],[24,"кукуруза"],[26,"кабачок"],[28,"баклажан"],[30,"капуста"],[32,"тыква"],[34,"ананас"],[36,"дыня"],[38,"лук-порей"],[40,"арбуз"]];
        let r = "эмбрион";
        for (const [wk, sz] of sizes) { if (w >= wk) r = sz; }
        return r;
    }

    symptoms() {
        const w = this.pr.week, r = [], diff = this.p.pregnancyDifficulty;
        if (w >= 4 && w <= 14) {
            r.push("тошнота", "усталость");
            if (diff !== "easy") r.push("утренняя рвота");
            if (diff === "severe" || diff === "complicated") r.push("сильный токсикоз");
        }
        if (w >= 14 && w <= 27) {
            r.push("рост живота");
            if (w >= 18) r.push("первые шевеления");
        }
        if (w >= 28) {
            r.push("одышка", "отёки", "боли в спине");
            if (w >= 32) r.push("тренировочные схватки");
            if (w >= 36) r.push("давление в тазу", "гнездование");
        }
        if (this.pr.fetusCount > 1) r.push("многоплодная (повышенная нагрузка)");
        return r;
    }

    movements() {
        const w = this.pr.week;
        if (w < 16) return "нет";
        if (w < 22) return "лёгкие (бабочки)";
        if (w < 28) return "заметные толчки";
        if (w < 34) return "активные, видно снаружи";
        return "сильные, но реже (мало места)";
    }

    weightGain() {
        const w = this.pr.week, fc = this.pr.fetusCount;
        let base;
        if (w <= 12) base = w * 0.2;
        else if (w <= 27) base = 2.4 + (w - 12) * 0.45;
        else base = 9.15 + (w - 27) * 0.4;
        return Math.round(base * (1 + (fc - 1) * 0.3) * 10) / 10;
    }

    bodyChanges() {
        const w = this.pr.week, r = [];
        if (w >= 6) r.push("грудь увеличивается");
        if (w >= 12) r.push("живот округляется");
        if (w >= 16) r.push("живот заметен");
        if (w >= 20) r.push("linea nigra");
        if (w >= 24) r.push("растяжки");
        if (w >= 28) r.push("пупок выпирает");
        if (w >= 32) r.push("живот большой");
        if (w >= 36) r.push("живот опускается");
        return r;
    }

    emotionalState() {
        const t = this.trimester();
        return { 1: "тревога, перепады", 2: "стабильнее, привязанность", 3: "нетерпение, страх, гнездование" }[t] || "стабильно";
    }
}

// ==========================================
// LABOR MANAGER
// ==========================================

const LABOR_STAGES = ["latent", "active", "transition", "pushing", "birth", "placenta"];
const LABOR_LABELS = { latent: "Латентная", active: "Активная", transition: "Переходная", pushing: "Потуги", birth: "Рождение", placenta: "Плацента" };

class LaborManager {
    constructor(p) { this.p = p; this.l = p.labor; }
    isActive() { return this.l && this.l.active; }

    start() {
        this.l.active = true; this.l.stage = "latent"; this.l.dilation = 0;
        this.l.contractionInterval = 20; this.l.contractionDuration = 30;
        this.l.hoursElapsed = 0; this.l.babiesDelivered = 0;
        this.l.totalBabies = this.p.pregnancy?.fetusCount || 1;
    }

    advance() {
        const idx = LABOR_STAGES.indexOf(this.l.stage);
        if (idx < LABOR_STAGES.length - 1) {
            this.l.stage = LABOR_STAGES[idx + 1];
            if (this.l.stage === "active") { this.l.dilation = 5; this.l.contractionInterval = 5; this.l.contractionDuration = 50; this.l.hoursElapsed += 4 + Math.floor(Math.random() * 6); }
            if (this.l.stage === "transition") { this.l.dilation = 8; this.l.contractionInterval = 2; this.l.contractionDuration = 70; this.l.hoursElapsed += 2 + Math.floor(Math.random() * 3); }
            if (this.l.stage === "pushing") { this.l.dilation = 10; this.l.hoursElapsed += 1; }
            if (this.l.stage === "birth") { this.l.hoursElapsed += 0.5; }
            if (this.l.stage === "placenta") { this.l.hoursElapsed += 0.25; }
        }
    }

    description() {
        return {
            latent: "Лёгкие схватки каждые 15-20 мин, раскрытие 0-3 см.",
            active: "Сильные схватки каждые 3-5 мин по 50-60 сек, раскрытие 4-7 см.",
            transition: "Пиковые схватки каждые 1-2 мин, раскрытие 7-10 см. Тошнота, дрожь.",
            pushing: "Полное раскрытие. Рефлекторные потуги.",
            birth: "Выход головки, разворот плечиков, первый крик.",
            placenta: "Рождение плаценты, сокращение матки.",
        }[this.l.stage] || "";
    }

    deliver() {
        this.l.babiesDelivered++;
        if (this.l.babiesDelivered >= this.l.totalBabies) this.l.stage = "placenta";
    }

    end() {
        this.l.active = false;
        this.p.pregnancy.active = false;
        if (this.p.cycle) { this.p.cycle.enabled = true; this.p.cycle.currentDay = 1; }
    }
}

// ==========================================
// BABY MANAGER
// ==========================================

class BabyManager {
    constructor(b) { this.b = b; }

    static generate(mother, fatherName) {
        const s = extension_settings[extensionName];
        const sex = Math.random() < 0.5 ? "M" : "F";
        const fp = s.characters[fatherName];

        let secondarySex = null;
        if (s.modules.auOverlay && s.auPreset === "omegaverse") {
            const r = Math.random();
            secondarySex = r < 0.25 ? "alpha" : r < 0.75 ? "beta" : "omega";
        }

        const nonHumanFeatures = [];
        if (s.modules.auOverlay && s.auPreset === "fantasy" && s.auSettings.fantasy.nonHumanFeatures) {
            if (Math.random() < 0.3) nonHumanFeatures.push("заострённые уши");
            if (Math.random() < 0.2) nonHumanFeatures.push("необычный цвет глаз");
            if (Math.random() < 0.1) nonHumanFeatures.push("хвост");
        }

        const bw = 3200 + Math.floor(Math.random() * 800) - 400;
        return {
            name: "", sex, secondarySex,
            birthWeight: mother.pregnancy?.fetusCount > 1 ? Math.round(bw * 0.85) : bw,
            currentWeight: bw, ageDays: 0,
            eyeColor: Math.random() < 0.5 ? (mother.eyeColor || "карие") : (fp?.eyeColor || "карие"),
            hairColor: Math.random() < 0.5 ? (mother.hairColor || "тёмные") : (fp?.hairColor || "тёмные"),
            mother: mother.name, father: fatherName,
            nonHumanFeatures, state: "новорождённый",
            birthDate: { ...s.worldDate },
        };
    }

    ageLabel() {
        const d = this.b.ageDays;
        if (d < 1) return "новорождённый";
        if (d < 7) return d + " дн.";
        if (d < 30) return Math.floor(d / 7) + " нед.";
        if (d < 365) return Math.floor(d / 30) + " мес.";
        const y = Math.floor(d / 365), m = Math.floor((d % 365) / 30);
        return m > 0 ? y + " г. " + m + " мес." : y + " г.";
    }

    milestones() {
        const d = this.b.ageDays, r = [];
        if (d >= 42) r.push("улыбка");
        if (d >= 90) r.push("держит голову");
        if (d >= 150) r.push("переворачивается");
        if (d >= 180) r.push("сидит");
        if (d >= 240) r.push("ползает");
        if (d >= 300) r.push("встаёт");
        if (d >= 365) r.push("первые шаги, слова");
        if (d >= 545) r.push("фразы");
        if (d >= 730) r.push("бегает");
        return r;
    }

    update() {
        const d = this.b.ageDays;
        this.b.currentWeight = this.b.birthWeight + d * (d < 120 ? 30 : d < 365 ? 15 : 7);
        if (d < 28) this.b.state = "новорождённый";
        else if (d < 365) this.b.state = "младенец";
        else if (d < 1095) this.b.state = "малыш";
        else this.b.state = "ребёнок";
    }
}

// ==========================================
// INTIMACY + DICE
// ==========================================

class IntimacyManager {
    static log(entry) {
        const s = extension_settings[extensionName];
        entry.timestamp = formatDate(s.worldDate);
        s.intimacyLog.push(entry);
        if (s.intimacyLog.length > 100) s.intimacyLog = s.intimacyLog.slice(-100);
        saveSettingsDebounced();
    }

    static roll(targetChar, data) {
        const s = extension_settings[extensionName];
        const p = s.characters[targetChar];
        if (!p) return { result: false, chance: 0, roll: 0 };

        let fert = 0.05;
        if (p.cycle?.enabled) fert = new CycleManager(p).fertility();

        const contraEff = { none: 0, condom: 0.85, pill: 0.91, iud: 0.99, withdrawal: 0.73, patch: 0.91, injection: 0.94 }[p.contraception] || 0;

        // If scene explicitly says no contraception, override
        if (data.noContraception) {
            // Don't apply contraception even if character has it set
        } else if (data.hasContraception) {
            fert *= (1 - 0.85); // Assume condom if detected
        } else {
            fert *= (1 - contraEff);
        }

        if (data.ejaculation === "outside") fert *= 0.05;
        if (data.ejaculation === "na" || data.ejaculation === "unknown") {
            // Unknown ejaculation: assume inside for vaginal
            if (data.type !== "vaginal") fert = 0;
        }
        if (data.type === "anal" || data.type === "oral") fert = 0;
        if (p.pregnancy?.active) fert = 0;

        if (p.bioSex === "M") {
            if (s.modules.auOverlay && s.auPreset === "omegaverse" && s.auSettings.omegaverse.maleOmegaPregnancy && p.secondarySex === "omega") {
                // Male omega can get pregnant
            } else {
                fert = 0;
            }
        }

        const chance = Math.round(clamp(fert, 0, 0.95) * 100);
        const r = rollDice(100);
        const result = r <= chance;

        const entry = {
            timestamp: formatDate(s.worldDate), targetChar,
            participants: data.participants || [], chance, roll: r, result,
            contraception: data.noContraception ? "нет (в сцене)" : (data.hasContraception ? "есть (в сцене)" : p.contraception),
            actType: data.type, ejaculation: data.ejaculation,
            autoDetected: data.autoDetected || false,
        };
        s.diceLog.push(entry);
        if (s.diceLog.length > 50) s.diceLog = s.diceLog.slice(-50);
        saveSettingsDebounced();
        return entry;
    }
}

// ==========================================
// TIME PARSER
// ==========================================

class TimeParser {
    static parse(msg) {
        const sens = extension_settings[extensionName].timeParserSensitivity;
        let days = 0;

        const pats = [
            [/прошл[оа]\s+(\d+)\s+(?:дн|дней|день)/gi, 1],
            [/через\s+(\d+)\s+(?:дн|дней|день)/gi, 1],
            [/спустя\s+(\d+)\s+(?:дн|дней|день)/gi, 1],
            [/прошл[оа]\s+(\d+)\s+(?:недел|нед)/gi, 7],
            [/через\s+(\d+)\s+(?:недел|нед)/gi, 7],
            [/спустя\s+(\d+)\s+(?:недел|нед)/gi, 7],
            [/прошл[оа]\s+(\d+)\s+(?:месяц|мес)/gi, 30],
            [/через\s+(\d+)\s+(?:месяц|мес)/gi, 30],
            [/спустя\s+(\d+)\s+(?:месяц|мес)/gi, 30],
            [/(\d+)\s+(?:days?|дн[ейя]?)\s+(?:later|passed|спустя|прошл)/gi, 1],
            [/(\d+)\s+(?:weeks?|недел[ьиюя]?)\s+(?:later|passed|спустя|прошл)/gi, 7],
            [/(\d+)\s+(?:months?|месяц\w*)\s+(?:later|passed|спустя|прошл)/gi, 30],
        ];

        for (const [re, mult] of pats) {
            let m; while ((m = re.exec(msg)) !== null) days += parseInt(m[1]) * mult;
        }

        if (sens !== "low") {
            if (/на следующ(?:ий|ее|ую)\s+(?:день|утро)/i.test(msg)) days += 1;
            if (/next\s+(?:day|morning)/i.test(msg)) days += 1;
            if (/через\s+пару\s+дней/i.test(msg)) days += 2;
            if (/через\s+несколько\s+дней/i.test(msg)) days += 3;
            if (/a\s+few\s+days\s+later/i.test(msg)) days += 3;
            if (/на следующ(?:ей|ую)\s+неделе/i.test(msg)) days += 7;
            if (/next\s+week/i.test(msg)) days += 7;
        }

        if (sens === "high") {
            if (/прошёл\s+месяц/i.test(msg) || /a\s+month\s+(?:later|passed)/i.test(msg)) days += 30;
            if (/прошла\s+неделя/i.test(msg) || /a\s+week\s+(?:later|passed)/i.test(msg)) days += 7;
        }

        return days > 0 ? days : null;
    }

    static apply(days) {
        const s = extension_settings[extensionName];
        s.worldDate = addDays(s.worldDate, days);
        TimeParser.advanceAll(days);
        saveSettingsDebounced();
    }

    static advanceAll(days) {
        const s = extension_settings[extensionName];
        Object.values(s.characters).forEach(p => {
            if (!p._enabled) return;

            if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
                new CycleManager(p).advance(days);
            }

            if (s.modules.pregnancy && p.pregnancy?.active) {
                new PregnancyManager(p).advanceDay(days);
            }

            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.secondarySex) {
                const auS = s.auSettings.omegaverse;
                if (p.secondarySex === "omega" && p.heat && !p.heat.onSuppressants) {
                    if (p.heat.active) {
                        p.heat.currentDay += days;
                        if (p.heat.currentDay > p.heat.duration) { p.heat.active = false; p.heat.currentDay = 0; p.heat.daysSinceLast = 0; }
                    } else {
                        p.heat.daysSinceLast = (p.heat.daysSinceLast || 0) + days;
                        if (p.heat.daysSinceLast >= auS.heatCycleLength) { p.heat.active = true; p.heat.currentDay = 1; p.heat.duration = auS.heatDuration; p.heat.intensity = "severe"; }
                    }
                }
                if (p.secondarySex === "alpha" && p.rut) {
                    if (p.rut.active) {
                        p.rut.currentDay += days;
                        if (p.rut.currentDay > p.rut.duration) { p.rut.active = false; p.rut.currentDay = 0; p.rut.daysSinceLast = 0; }
                    } else {
                        p.rut.daysSinceLast = (p.rut.daysSinceLast || 0) + days;
                        if (p.rut.daysSinceLast >= auS.heatCycleLength + 5) { p.rut.active = true; p.rut.currentDay = 1; p.rut.duration = auS.rutDuration; p.rut.intensity = "moderate"; }
                    }
                }
            }

            if (s.modules.baby && p.babies?.length > 0) {
                p.babies.forEach(b => { b.ageDays += days; new BabyManager(b).update(); });
            }
        });
        saveSettingsDebounced();
    }
}

// ==========================================
// PROMPT INJECTOR
// ==========================================

class PromptInjector {
    static generate() {
        const s = extension_settings[extensionName];
        if (!s.promptInjectionEnabled) return "";
        const det = s.promptInjectionDetail;
        const lines = ["[LifeCycle System Data]", "World Date: " + formatDate(s.worldDate)];

        Object.entries(s.characters).forEach(([name, p]) => {
            if (!p._enabled) return;
            lines.push("\n--- " + name + " ---");
            lines.push("Bio Sex: " + p.bioSex);

            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.secondarySex) {
                lines.push("Secondary Sex: " + p.secondarySex);
            }

            if (s.modules.auOverlay && s.auPreset === "omegaverse") {
                if (p.heat?.active) {
                    lines.push("IN HEAT: Day " + p.heat.currentDay + "/" + p.heat.duration + " - heightened arousal, self-lubrication, pheromones, foggy thinking, desperation for physical contact");
                }
                if (p.rut?.active) {
                    lines.push("IN RUT: Day " + p.rut.currentDay + "/" + p.rut.duration + " - aggression, extreme libido, possessiveness, knot swelling");
                }
                if (p.heat?.onSuppressants) {
                    lines.push("On heat suppressants (symptoms reduced but not eliminated)");
                }
            }

            if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
                const cm = new CycleManager(p);
                const ph = cm.phase();
                lines.push("Cycle: Day " + p.cycle.currentDay + "/" + p.cycle.length + ", Phase: " + cm.phaseLabel(ph));
                if (det !== "low") {
                    lines.push("Fertility: " + Math.round(cm.fertility() * 100) + "%");
                    lines.push("Libido: " + cm.libido());
                    const sym = cm.symptoms();
                    if (sym.length) lines.push("Symptoms: " + sym.join(", "));
                }
                if (det === "high") {
                    lines.push("Discharge: " + cm.discharge());
                }
            }

            if (s.modules.pregnancy && p.pregnancy?.active) {
                const pm = new PregnancyManager(p);
                lines.push("PREGNANT: Week " + p.pregnancy.week + "/" + p.pregnancy.maxWeeks + ", Trimester " + pm.trimester());
                lines.push("Fetal size: ~" + pm.fetalSize());
                lines.push("Fetuses: " + p.pregnancy.fetusCount);
                if (det !== "low") {
                    lines.push("Symptoms: " + pm.symptoms().join(", "));
                    lines.push("Movements: " + pm.movements());
                    lines.push("Weight gain: +" + pm.weightGain() + " kg");
                }
                if (det === "high") {
                    lines.push("Body changes: " + pm.bodyChanges().join(", "));
                    lines.push("Emotions: " + pm.emotionalState());
                }
            }

            if (s.modules.labor && p.labor?.active) {
                const lm = new LaborManager(p);
                lines.push("IN LABOR: " + LABOR_LABELS[p.labor.stage] + ", Dilation: " + p.labor.dilation + "cm");
                lines.push("Contractions: every " + p.labor.contractionInterval + "min, " + p.labor.contractionDuration + "sec");
                if (det !== "low") lines.push(lm.description());
            }

            if (s.modules.baby && p.babies?.length > 0 && det !== "low") {
                p.babies.forEach(b => {
                    const bm = new BabyManager(b);
                    lines.push("Baby: " + (b.name || "unnamed") + " (" + (b.sex === "M" ? "boy" : "girl") + ", " + bm.ageLabel() + ", " + b.state + ")");
                });
            }

            if (p.contraception && p.contraception !== "none") lines.push("Contraception: " + p.contraception);
        });

        lines.push("\n[Instructions for AI]");
        lines.push("- Reflect cycle symptoms, libido level, and physical state naturally in character behavior");
        lines.push("- If a character is in heat/rut, show the physiological effects (heat flush, slick, scent, desperation/aggression)");
        lines.push("- Pregnancy symptoms should manifest organically in actions and dialogue");
        lines.push("- During labor, describe pain, breathing, contractions in visceral detail");
        lines.push("- Baby behavior must match developmental stage");
        lines.push("[/LifeCycle System Data]");

        return lines.join("\n");
    }
}

// ==========================================
// STATUS WIDGET (appended after every AI message)
// ==========================================

class StatusWidget {
    static generate() {
        const s = extension_settings[extensionName];
        if (!s.enabled || !s.showStatusWidget) return "";

        const chars = Object.entries(s.characters).filter(([_, p]) => p._enabled);
        if (chars.length === 0) return "";

        let html = '<div class="lc-status-widget">';
        html += '<div class="lc-sw-header" id="lc-sw-toggle">📊 LifeCycle Status <span class="lc-sw-arrow">▼</span></div>';
        html += '<div class="lc-sw-body">';
        html += '<div class="lc-sw-date">' + formatDate(s.worldDate) + '</div>';

        for (const [name, p] of chars) {
            html += '<div class="lc-sw-char">';
            html += '<div class="lc-sw-char-name">' + name + '</div>';

            // Cycle
            if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
                const cm = new CycleManager(p);
                const ph = cm.phase();
                const fert = cm.fertility();
                let fertClass = "low";
                if (fert >= 0.2) fertClass = "peak";
                else if (fert >= 0.1) fertClass = "high";
                else if (fert >= 0.05) fertClass = "med";

                html += '<div class="lc-sw-row">' + cm.phaseEmoji(ph) + ' <span class="lc-sw-label">' + cm.phaseLabel(ph) + '</span> (д.' + p.cycle.currentDay + '/' + p.cycle.length + ') <span class="lc-sw-fert ' + fertClass + '">♥ ' + Math.round(fert * 100) + '%</span></div>';

                const sym = cm.symptoms();
                if (sym.length > 0) {
                    html += '<div class="lc-sw-symptoms">' + sym.join(', ') + '</div>';
                }
            }

            // Heat
            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.heat?.active) {
                html += '<div class="lc-sw-row lc-sw-heat">🔥 Течка: д.' + p.heat.currentDay + '/' + p.heat.duration + '</div>';
            }

            // Rut
            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.rut?.active) {
                html += '<div class="lc-sw-row lc-sw-rut">💢 Гон: д.' + p.rut.currentDay + '/' + p.rut.duration + '</div>';
            }

            // Pregnancy
            if (s.modules.pregnancy && p.pregnancy?.active) {
                const pm = new PregnancyManager(p);
                const pr = p.pregnancy;
                const prog = Math.round((pr.week / pr.maxWeeks) * 100);
                html += '<div class="lc-sw-row">🤰 <span class="lc-sw-label">Нед. ' + pr.week + '/' + pr.maxWeeks + '</span> (Т' + pm.trimester() + ') ~' + pm.fetalSize() + '</div>';
                html += '<div class="lc-sw-progress"><div class="lc-sw-progress-fill" style="width:' + prog + '%"></div></div>';
                const sym = pm.symptoms();
                if (sym.length > 0) html += '<div class="lc-sw-symptoms">' + sym.slice(0, 3).join(', ') + '</div>';
            }

            // Labor
            if (s.modules.labor && p.labor?.active) {
                html += '<div class="lc-sw-row lc-sw-labor">🏥 ' + LABOR_LABELS[p.labor.stage] + ' | Раскрытие: ' + p.labor.dilation + '/10 см</div>';
            }

            // Babies
            if (s.modules.baby && p.babies?.length > 0) {
                for (const b of p.babies) {
                    const bm = new BabyManager(b);
                    html += '<div class="lc-sw-row">👶 ' + (b.name || '?') + ' (' + (b.sex === 'M' ? '♂' : '♀') + ') ' + bm.ageLabel() + '</div>';
                }
            }

            html += '</div>'; // end sw-char
        }

        // Last dice roll
        if (s.diceLog.length > 0) {
            const last = s.diceLog[s.diceLog.length - 1];
            html += '<div class="lc-sw-dice-last">';
            html += '<div class="lc-sw-dice-title">Последний бросок:</div>';
            html += '<div class="' + (last.result ? 'lc-sw-dice-success' : 'lc-sw-dice-fail') + '">';
            html += '🎲 ' + last.roll + ' / ' + last.chance + '% ' + (last.result ? '✅ Зачатие!' : '❌ Нет') + ' (' + last.targetChar + ')';
            html += '</div></div>';
        }

        html += '</div>'; // end sw-body
        html += '</div>'; // end widget

        return html;
    }

    static inject(messageIdx) {
        const s = extension_settings[extensionName];
        if (!s.enabled || !s.showStatusWidget) return;

        const ctx = getContext();
        if (!ctx.chat || messageIdx < 0) return;

        const widgetHTML = StatusWidget.generate();
        if (!widgetHTML) return;

        s.lastWidgetHTML = widgetHTML;

        // Insert widget into the chat message DOM
        setTimeout(() => {
            const msgEl = document.querySelector(`#chat .mes[mesid="${messageIdx}"]`);
            if (!msgEl) return;
            const mesText = msgEl.querySelector('.mes_text');
            if (!mesText) return;

            // Remove old widget if exists
            mesText.querySelectorAll('.lc-status-widget').forEach(w => w.remove());
            mesText.insertAdjacentHTML('beforeend', widgetHTML);

            // Bind toggle
            mesText.querySelectorAll('.lc-sw-header').forEach(hdr => {
                hdr.addEventListener('click', function() {
                    const body = this.nextElementSibling;
                    const arrow = this.querySelector('.lc-sw-arrow');
                    if (body.style.display === 'none') {
                        body.style.display = '';
                        arrow.textContent = '▼';
                    } else {
                        body.style.display = 'none';
                        arrow.textContent = '▶';
                    }
                });
            });
        }, 200);
    }
}

// ==========================================
// DICE POPUP (for auto and manual rolls)
// ==========================================

function showDicePopup(result, target, isAuto) {
    document.querySelector(".lc-overlay")?.remove();
    document.querySelector(".lc-popup")?.remove();

    const ov = document.createElement("div"); ov.className = "lc-overlay";
    const pop = document.createElement("div"); pop.className = "lc-popup";

    const cls = result.result ? "success" : "fail";
    const txt = result.result ? "ЗАЧАТИЕ ПРОИЗОШЛО!" : "Зачатие не произошло";
    const autoLabel = isAuto ? '<div class="lc-popup-auto">🤖 Авто-определение</div>' : '';

    pop.innerHTML = '<div class="lc-popup-title">🎲 Бросок фертильности</div>' + autoLabel +
        '<div class="lc-popup-details">' +
            '<div><strong>Персонаж:</strong> ' + target + '</div>' +
            '<div><strong>Шанс:</strong> ' + result.chance + '%</div>' +
            '<div><strong>Контрацепция:</strong> ' + result.contraception + '</div>' +
            '<div><strong>Тип акта:</strong> ' + result.actType + '</div>' +
            '<div><strong>Эякуляция:</strong> ' + result.ejaculation + '</div>' +
            '<hr class="lc-sep">' +
            '<div><strong>Порог:</strong> ≤' + result.chance + '</div>' +
        '</div>' +
        '<div class="lc-popup-result ' + cls + '">🎲 ' + result.roll + '</div>' +
        '<div class="lc-popup-verdict ' + cls + '">' + txt + '</div>' +
        '<div class="lc-popup-actions">' +
            '<button id="lc-dice-accept" class="lc-btn lc-btn-success">Принять</button>' +
            '<button id="lc-dice-reroll" class="lc-btn">Перебросить</button>' +
            '<button id="lc-dice-cancel" class="lc-btn lc-btn-danger">Отмена</button>' +
        '</div>';

    document.body.appendChild(ov);
    document.body.appendChild(pop);

    document.getElementById("lc-dice-accept").addEventListener("click", () => {
        if (result.result) {
            const s = extension_settings[extensionName];
            const p = s.characters[target];
            if (p) {
                const father = result.participants?.find(x => x !== target) || "?";
                new PregnancyManager(p).start(father, 1);
                saveSettingsDebounced();
                rebuildUI();
            }
        }
        ov.remove(); pop.remove();
    });

    document.getElementById("lc-dice-reroll").addEventListener("click", () => {
        ov.remove(); pop.remove();
        const nr = IntimacyManager.roll(target, {
            participants: result.participants,
            type: result.actType,
            ejaculation: result.ejaculation,
            hasContraception: false,
            noContraception: result.contraception === "нет (в сцене)",
        });
        showDicePopup(nr, target, isAuto);
    });

    document.getElementById("lc-dice-cancel").addEventListener("click", () => { ov.remove(); pop.remove(); });
    ov.addEventListener("click", () => { ov.remove(); pop.remove(); });
}

// ==========================================
// JSON HELPERS
// ==========================================

function downloadJSON(data, fn) {
    const b = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const u = URL.createObjectURL(b);
    const a = document.createElement("a"); a.href = u; a.download = fn;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u);
}

function uploadJSON(cb) {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json";
    inp.addEventListener("change", e => {
        const f = e.target.files[0]; if (!f) return;
        const rd = new FileReader();
        rd.onload = ev => { try { cb(JSON.parse(ev.target.result)); } catch (err) { toastr.error("JSON ошибка: " + err.message); } };
        rd.readAsText(f);
    });
    inp.click();
}

// ==========================================
// HTML GENERATION (collapsible panel)
// ==========================================

function buildCharSelect(id, extraCls) {
    const names = Object.keys(extension_settings[extensionName].characters);
    const opts = names.map(n => '<option value="' + n + '">' + n + '</option>').join("");
    return '<select id="' + id + '" class="lc-select ' + (extraCls || "lc-char-select") + '">' + opts + '</select>';
}

function generateHTML() {
    const s = extension_settings[extensionName];
    const collapsed = s.panelCollapsed ? ' collapsed' : '';

    return '<div class="lifecycle-panel' + collapsed + '" id="lifecycle-panel">' +

        // HEADER (clickable to collapse)
        '<div class="lifecycle-header" id="lifecycle-header-toggle">' +
            '<div class="lifecycle-header-title">' +
                '<span class="lc-collapse-arrow">' + (s.panelCollapsed ? '▶' : '▼') + '</span>' +
                '<h3>LifeCycle</h3><span class="lc-version">v0.4.0</span>' +
            '</div>' +
            '<div class="lifecycle-header-actions">' +
                '<label class="lc-switch" onclick="event.stopPropagation()"><input type="checkbox" id="lc-enabled" ' + (s.enabled ? "checked" : "") + '><span class="lc-switch-slider"></span></label>' +
            '</div>' +
        '</div>' +

        // COLLAPSIBLE BODY
        '<div class="lifecycle-body" id="lifecycle-body">' +

            // DASHBOARD
            '<div class="lc-dashboard" id="lc-dashboard">' +
                '<div class="lc-dashboard-date" id="lc-dashboard-date"></div>' +
                '<div id="lc-dashboard-items"></div>' +
            '</div>' +

            // TABS
            '<div class="lifecycle-tabs">' +
                '<button class="lifecycle-tab active" data-tab="chars"><span class="tab-icon">👥</span>Перс.</button>' +
                '<button class="lifecycle-tab" data-tab="cycle"><span class="tab-icon">🔴</span>Цикл</button>' +
                '<button class="lifecycle-tab" data-tab="intim"><span class="tab-icon">🔥</span>Интим</button>' +
                '<button class="lifecycle-tab" data-tab="preg"><span class="tab-icon">🤰</span>Берем.</button>' +
                '<button class="lifecycle-tab" data-tab="labor"><span class="tab-icon">🏥</span>Роды</button>' +
                '<button class="lifecycle-tab" data-tab="babies"><span class="tab-icon">👶</span>Малыши</button>' +
                '<button class="lifecycle-tab" data-tab="settings"><span class="tab-icon">⚙️</span>Настр.</button>' +
            '</div>' +

            // TAB: CHARACTERS
            '<div class="lifecycle-tab-content active" data-tab="chars">' +
                '<div class="lc-btn-group" style="margin-bottom:8px">' +
                    '<button id="lc-sync-chars" class="lc-btn lc-btn-primary">🔄 Синхронизация</button>' +
                    '<button id="lc-add-manual" class="lc-btn">+ Вручную</button>' +
                '</div>' +
                '<div id="lc-char-list"></div>' +
                '<div id="lc-char-editor" class="lc-editor hidden">' +
                    '<div class="lc-editor-title" id="lc-editor-title">Редактирование</div>' +
                    '<div class="lc-editor-grid">' +
                        '<div class="lc-editor-field"><label>Биол. пол</label><select id="lc-edit-bio-sex" class="lc-select"><option value="F">Женский</option><option value="M">Мужской</option></select></div>' +
                        '<div class="lc-editor-field"><label>Втор. пол (AU)</label><select id="lc-edit-sec-sex" class="lc-select"><option value="">Нет</option><option value="alpha">Альфа</option><option value="beta">Бета</option><option value="omega">Омега</option></select></div>' +
                        '<div class="lc-editor-field"><label>Раса</label><select id="lc-edit-race" class="lc-select"><option value="human">Человек</option><option value="elf">Эльф</option><option value="dwarf">Дварф</option><option value="orc">Орк</option><option value="halfling">Полурослик</option><option value="demon">Демон</option><option value="vampire">Вампир</option><option value="werewolf">Оборотень</option><option value="dragon">Дракон</option><option value="neko">Неко</option><option value="kitsune">Кицунэ</option></select></div>' +
                        '<div class="lc-editor-field"><label>Контрацепция</label><select id="lc-edit-contra" class="lc-select"><option value="none">Нет</option><option value="condom">Презерватив</option><option value="pill">ОК</option><option value="iud">ВМС</option><option value="patch">Пластырь</option><option value="injection">Инъекция</option><option value="withdrawal">Прерванный</option></select></div>' +
                        '<div class="lc-editor-field"><label>Сложность берем.</label><select id="lc-edit-difficulty" class="lc-select"><option value="easy">Лёгкая</option><option value="normal">Нормальная</option><option value="hard">Тяжёлая</option><option value="complicated">С осложнениями</option></select></div>' +
                        '<div class="lc-editor-field"><label>Цвет глаз</label><input type="text" id="lc-edit-eyes" class="lc-input" placeholder="карие"></div>' +
                        '<div class="lc-editor-field"><label>Цвет волос</label><input type="text" id="lc-edit-hair" class="lc-input" placeholder="тёмные"></div>' +
                        '<div class="lc-editor-field full-width"><label class="lc-checkbox"><input type="checkbox" id="lc-edit-enabled" checked><span>Трекинг включён</span></label></div>' +
                        '<div class="lc-editor-field full-width" style="margin-top:6px"><h5 style="margin:0 0 4px;font-size:11px">Настройки цикла</h5></div>' +
                        '<div class="lc-editor-field full-width"><label class="lc-checkbox"><input type="checkbox" id="lc-edit-cycle-on"><span>Цикл включён</span></label></div>' +
                        '<div class="lc-editor-field"><label>Длина цикла</label><input type="number" id="lc-edit-cycle-len" class="lc-input" min="21" max="45" value="28"></div>' +
                        '<div class="lc-editor-field"><label>Менструация (дн.)</label><input type="number" id="lc-edit-mens-dur" class="lc-input" min="2" max="8" value="5"></div>' +
                        '<div class="lc-editor-field"><label>Нерегулярность</label><input type="number" id="lc-edit-irreg" class="lc-input" min="0" max="10" value="2"></div>' +
                        '<div class="lc-editor-field"><label>Симптомы</label><select id="lc-edit-symptom-int" class="lc-select"><option value="mild">Лёгкие</option><option value="moderate">Умеренные</option><option value="severe">Тяжёлые</option></select></div>' +
                    '</div>' +
                    '<div class="lc-editor-actions">' +
                        '<button id="lc-editor-save" class="lc-btn lc-btn-success">Сохранить</button>' +
                        '<button id="lc-editor-cancel" class="lc-btn">Отмена</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            // TAB: CYCLE
            '<div class="lifecycle-tab-content" data-tab="cycle">' +
                '<div class="lc-row" style="margin-bottom:8px"><label>Персонаж:</label>' + buildCharSelect("lc-cycle-char", "lc-char-select") + '</div>' +
                '<div id="lc-cycle-panel"></div>' +
            '</div>' +

            // TAB: INTIMACY
            '<div class="lifecycle-tab-content" data-tab="intim">' +
                '<div class="lc-section">' +
                    '<div class="lc-section-title"><h4>Авто-определение</h4></div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-detect-intim" ' + (s.autoDetectIntimacy ? "checked" : "") + '><span>Автоматически определять секс-сцены</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-roll" ' + (s.autoRollOnSex ? "checked" : "") + '><span>Автоматически кидать кубик</span></label>' +
                '</div>' +
                '<div class="lc-section">' +
                    '<div class="lc-section-title"><h4>Ручной бросок</h4></div>' +
                    '<div class="lc-row"><label>Цель (берем.):</label>' + buildCharSelect("lc-intim-target", "lc-char-select") + '</div>' +
                    '<div class="lc-row"><label>Партнёр:</label>' + buildCharSelect("lc-intim-partner", "lc-char-select") + '</div>' +
                    '<div class="lc-row"><label>Тип:</label><select id="lc-intim-type" class="lc-select"><option value="vaginal">Вагинальный</option><option value="anal">Анальный</option><option value="oral">Оральный</option></select></div>' +
                    '<div class="lc-row"><label>Эякуляция:</label><select id="lc-intim-ejac" class="lc-select"><option value="inside">Внутрь</option><option value="outside">Наружу</option><option value="na">Н/П</option></select></div>' +
                    '<div class="lc-btn-group" style="margin-top:8px">' +
                        '<button id="lc-intim-log-btn" class="lc-btn">📝 Записать</button>' +
                        '<button id="lc-intim-roll-btn" class="lc-btn lc-btn-primary">🎲 Бросить кубик</button>' +
                    '</div>' +
                '</div>' +
                '<div class="lc-section"><div class="lc-section-title"><h4>Лог бросков</h4></div><div id="lc-dice-log" class="lc-scroll"></div></div>' +
                '<div class="lc-section"><div class="lc-section-title"><h4>Лог актов</h4></div><div id="lc-intim-log-list" class="lc-scroll"></div></div>' +
            '</div>' +

            // TAB: PREGNANCY
            '<div class="lifecycle-tab-content" data-tab="preg">' +
                '<div class="lc-row" style="margin-bottom:8px"><label>Персонаж:</label>' + buildCharSelect("lc-preg-char", "lc-char-select") + '</div>' +
                '<div id="lc-preg-panel"></div>' +
                '<div class="lc-btn-group" style="margin-top:8px">' +
                    '<button id="lc-preg-advance" class="lc-btn">+1 неделя</button>' +
                    '<button id="lc-preg-set-week" class="lc-btn">Уст. неделю</button>' +
                    '<button id="lc-preg-to-labor" class="lc-btn lc-btn-primary">Начать роды</button>' +
                    '<button id="lc-preg-end" class="lc-btn lc-btn-danger">Прервать</button>' +
                '</div>' +
            '</div>' +

            // TAB: LABOR
            '<div class="lifecycle-tab-content" data-tab="labor">' +
                '<div class="lc-row" style="margin-bottom:8px"><label>Персонаж:</label>' + buildCharSelect("lc-labor-char", "lc-char-select") + '</div>' +
                '<div id="lc-labor-panel"></div>' +
                '<div class="lc-btn-group" style="margin-top:8px">' +
                    '<button id="lc-labor-advance" class="lc-btn lc-btn-primary">След. стадия</button>' +
                    '<button id="lc-labor-deliver" class="lc-btn lc-btn-success">Родить</button>' +
                    '<button id="lc-labor-set-dil" class="lc-btn">Уст. раскрытие</button>' +
                    '<button id="lc-labor-end" class="lc-btn lc-btn-danger">Завершить</button>' +
                '</div>' +
            '</div>' +

            // TAB: BABIES
            '<div class="lifecycle-tab-content" data-tab="babies">' +
                '<div class="lc-row" style="margin-bottom:8px"><label>Родитель:</label>' + buildCharSelect("lc-baby-parent", "lc-char-select") + '</div>' +
                '<div id="lc-baby-list"></div>' +
            '</div>' +

            // TAB: SETTINGS
            '<div class="lifecycle-tab-content" data-tab="settings">' +

                '<div class="lc-section">' +
                    '<div class="lc-section-title"><h4>Автоматика</h4></div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-sync" ' + (s.autoSyncCharacters ? "checked" : "") + '><span>Авто-синхронизация персонажей</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-parse-info" ' + (s.autoParseCharInfo ? "checked" : "") + '><span>Авто-определение пола/расы/внешности из карточки</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-time" ' + (s.autoTimeProgress ? "checked" : "") + '><span>Авто-парсинг времени</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-time-confirm" ' + (s.timeParserConfirmation ? "checked" : "") + '><span>Подтверждение сдвига времени</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-show-widget" ' + (s.showStatusWidget ? "checked" : "") + '><span>Окно статуса после каждого ответа</span></label>' +
                    '<div class="lc-row"><label>Чувствительность таймера:</label><select id="lc-time-sens" class="lc-select">' +
                        '<option value="low"' + (s.timeParserSensitivity === "low" ? " selected" : "") + '>Низкая</option>' +
                        '<option value="medium"' + (s.timeParserSensitivity === "medium" ? " selected" : "") + '>Средняя</option>' +
                        '<option value="high"' + (s.timeParserSensitivity === "high" ? " selected" : "") + '>Высокая</option>' +
                    '</select></div>' +
                '</div>' +

                '<div class="lc-section">' +
                    '<div class="lc-section-title"><h4>Дата мира</h4></div>' +
                    '<div class="lc-row">' +
                        '<input type="number" id="lc-date-y" class="lc-input" style="width:60px" value="' + s.worldDate.year + '">' +
                        '<span>/</span>' +
                        '<input type="number" id="lc-date-m" class="lc-input" style="width:40px" min="1" max="12" value="' + s.worldDate.month + '">' +
                        '<span>/</span>' +
                        '<input type="number" id="lc-date-d" class="lc-input" style="width:40px" min="1" max="31" value="' + s.worldDate.day + '">' +
                        '<input type="number" id="lc-date-h" class="lc-input" style="width:40px" min="0" max="23" value="' + s.worldDate.hour + '"><span>ч</span>' +
                    '</div>' +
                    '<div class="lc-btn-group" style="margin-top:6px">' +
                        '<button id="lc-date-apply" class="lc-btn lc-btn-primary">Применить</button>' +
                        '<button id="lc-date-plus1" class="lc-btn">+1 день</button>' +
                        '<button id="lc-date-plus7" class="lc-btn">+7 дней</button>' +
                    '</div>' +
                    '<label class="lc-checkbox" style="margin-top:6px"><input type="checkbox" id="lc-date-frozen" ' + (s.worldDate.frozen ? "checked" : "") + '><span>Заморозить время</span></label>' +
                '</div>' +

                '<div class="lc-section">' +
                    '<div class="lc-section-title"><h4>Модули</h4></div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-cycle" ' + (s.modules.cycle ? "checked" : "") + '><span>Цикл</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-preg" ' + (s.modules.pregnancy ? "checked" : "") + '><span>Беременность</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-labor" ' + (s.modules.labor ? "checked" : "") + '><span>Роды</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-baby" ' + (s.modules.baby ? "checked" : "") + '><span>Малыши</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-intim" ' + (s.modules.intimacy ? "checked" : "") + '><span>Интим-трекер</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-au" ' + (s.modules.auOverlay ? "checked" : "") + '><span>AU-оверлей</span></label>' +
                '</div>' +

                '<div class="lc-section">' +
                    '<div class="lc-section-title"><h4>Инъекция в промпт</h4></div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-prompt-on" ' + (s.promptInjectionEnabled ? "checked" : "") + '><span>Включена</span></label>' +
                    '<div class="lc-row"><label>Позиция:</label><select id="lc-prompt-pos" class="lc-select">' +
                        '<option value="system"' + (s.promptInjectionPosition === "system" ? " selected" : "") + '>System</option>' +
                        '<option value="authornote"' + (s.promptInjectionPosition === "authornote" ? " selected" : "") + '>Author Note</option>' +
                        '<option value="endofchat"' + (s.promptInjectionPosition === "endofchat" ? " selected" : "") + '>End of Chat</option>' +
                    '</select></div>' +
                    '<div class="lc-row"><label>Детальность:</label><select id="lc-prompt-detail" class="lc-select">' +
                        '<option value="low"' + (s.promptInjectionDetail === "low" ? " selected" : "") + '>Мин.</option>' +
                        '<option value="medium"' + (s.promptInjectionDetail === "medium" ? " selected" : "") + '>Средняя</option>' +
                        '<option value="high"' + (s.promptInjectionDetail === "high" ? " selected" : "") + '>Подробная</option>' +
                    '</select></div>' +
                '</div>' +

                '<div class="lc-section">' +
                    '<div class="lc-section-title"><h4>AU-пресет</h4></div>' +
                    '<div class="lc-row"><label>Пресет:</label><select id="lc-au-preset" class="lc-select">' +
                        '<option value="realism"' + (s.auPreset === "realism" ? " selected" : "") + '>Реализм</option>' +
                        '<option value="omegaverse"' + (s.auPreset === "omegaverse" ? " selected" : "") + '>Омегаверс</option>' +
                        '<option value="fantasy"' + (s.auPreset === "fantasy" ? " selected" : "") + '>Фэнтези</option>' +
                                                '<option value="scifi"' + (s.auPreset === "scifi" ? " selected" : "") + '>Sci-Fi</option>' +
                    '</select></div>' +
                '</div>' +

                // AU: OMEGAVERSE SETTINGS
                '<div class="lc-section lc-au-omegaverse-section" style="' + (s.auPreset === "omegaverse" && s.modules.auOverlay ? "" : "display:none") + '">' +
                    '<div class="lc-section-title"><h4>Омегаверс</h4></div>' +
                    '<div class="lc-editor-grid">' +
                        '<div class="lc-editor-field"><label>Цикл течки (дн.)</label><input type="number" id="lc-au-heat-cycle" class="lc-input" min="14" max="90" value="' + s.auSettings.omegaverse.heatCycleLength + '"></div>' +
                        '<div class="lc-editor-field"><label>Длит. течки (дн.)</label><input type="number" id="lc-au-heat-dur" class="lc-input" min="1" max="14" value="' + s.auSettings.omegaverse.heatDuration + '"></div>' +
                        '<div class="lc-editor-field"><label>Бонус ферт. в течку</label><input type="number" id="lc-au-heat-fert" class="lc-input" min="0" max="1" step="0.05" value="' + s.auSettings.omegaverse.heatFertilityBonus + '"></div>' +
                        '<div class="lc-editor-field"><label>Длит. гона (дн.)</label><input type="number" id="lc-au-rut-dur" class="lc-input" min="1" max="14" value="' + s.auSettings.omegaverse.rutDuration + '"></div>' +
                        '<div class="lc-editor-field"><label>Мин. длит. узла (мин.)</label><input type="number" id="lc-au-knot-dur" class="lc-input" min="5" max="120" value="' + s.auSettings.omegaverse.knotDurationMin + '"></div>' +
                        '<div class="lc-editor-field"><label>Недель берем.</label><input type="number" id="lc-au-preg-weeks" class="lc-input" min="20" max="50" value="' + s.auSettings.omegaverse.pregnancyWeeks + '"></div>' +
                    '</div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-au-knot" ' + (s.auSettings.omegaverse.knotEnabled ? "checked" : "") + '><span>Узел (кнот)</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-au-bond" ' + (s.auSettings.omegaverse.bondingEnabled ? "checked" : "") + '><span>Связь (бондинг)</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-au-suppress" ' + (s.auSettings.omegaverse.suppressantsAvailable ? "checked" : "") + '><span>Супрессанты</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-au-mpreg" ' + (s.auSettings.omegaverse.maleOmegaPregnancy ? "checked" : "") + '><span>Мужская омега-беременность</span></label>' +
                '</div>' +

                // AU: FANTASY SETTINGS
                '<div class="lc-section lc-au-fantasy-section" style="' + (s.auPreset === "fantasy" && s.modules.auOverlay ? "" : "display:none") + '">' +
                    '<div class="lc-section-title"><h4>Фэнтези</h4></div>' +
                    '<div class="lc-editor-grid">' +
                        '<div class="lc-editor-field"><label>Человек (нед.)</label><input type="number" id="lc-au-f-human" class="lc-input" value="' + s.auSettings.fantasy.pregnancyByRace.human + '"></div>' +
                        '<div class="lc-editor-field"><label>Эльф (нед.)</label><input type="number" id="lc-au-f-elf" class="lc-input" value="' + s.auSettings.fantasy.pregnancyByRace.elf + '"></div>' +
                        '<div class="lc-editor-field"><label>Дварф (нед.)</label><input type="number" id="lc-au-f-dwarf" class="lc-input" value="' + s.auSettings.fantasy.pregnancyByRace.dwarf + '"></div>' +
                        '<div class="lc-editor-field"><label>Орк (нед.)</label><input type="number" id="lc-au-f-orc" class="lc-input" value="' + s.auSettings.fantasy.pregnancyByRace.orc + '"></div>' +
                        '<div class="lc-editor-field"><label>Полурослик (нед.)</label><input type="number" id="lc-au-f-halfling" class="lc-input" value="' + s.auSettings.fantasy.pregnancyByRace.halfling + '"></div>' +
                    '</div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-au-f-features" ' + (s.auSettings.fantasy.nonHumanFeatures ? "checked" : "") + '><span>Нечеловеческие черты у потомства</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-au-f-magic" ' + (s.auSettings.fantasy.magicalComplications ? "checked" : "") + '><span>Магические осложнения</span></label>' +
                '</div>' +

                // AU: SCIFI SETTINGS
                '<div class="lc-section lc-au-scifi-section" style="' + (s.auPreset === "scifi" && s.modules.auOverlay ? "" : "display:none") + '">' +
                    '<div class="lc-section-title"><h4>Sci-Fi</h4></div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-au-s-artwomb" ' + (s.auSettings.scifi.artificialWomb ? "checked" : "") + '><span>Искусственная матка</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-au-s-genetic" ' + (s.auSettings.scifi.geneticModification ? "checked" : "") + '><span>Генная модификация</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-au-s-accel" ' + (s.auSettings.scifi.acceleratedGrowth ? "checked" : "") + '><span>Ускоренный рост</span></label>' +
                '</div>' +

                // IMPORT/EXPORT
                '<div class="lc-section">' +
                    '<div class="lc-section-title"><h4>Данные</h4></div>' +
                    '<div class="lc-btn-group">' +
                        '<button id="lc-export" class="lc-btn">📤 Экспорт</button>' +
                        '<button id="lc-import" class="lc-btn">📥 Импорт</button>' +
                        '<button id="lc-reset" class="lc-btn lc-btn-danger">🗑️ Сброс</button>' +
                    '</div>' +
                '</div>' +

            '</div>' + // end tab settings

        '</div>' + // end lifecycle-body
    '</div>'; // end lifecycle-panel
}

// ==========================================
// RENDER FUNCTIONS
// ==========================================

function renderDashboard() {
    const s = extension_settings[extensionName];
    const dateEl = document.getElementById("lc-dashboard-date");
    const itemsEl = document.getElementById("lc-dashboard-items");
    if (!dateEl || !itemsEl) return;

    dateEl.textContent = "📅 " + formatDate(s.worldDate) + (s.worldDate.frozen ? " ❄️" : "");

    let html = "";
    Object.entries(s.characters).forEach(([name, p]) => {
        if (!p._enabled) return;

        let badges = [];
        if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
            const cm = new CycleManager(p);
            const ph = cm.phase();
            badges.push(cm.phaseEmoji(ph) + " " + cm.phaseLabel(ph));
        }
        if (s.modules.pregnancy && p.pregnancy?.active) {
            badges.push("🤰 Нед." + p.pregnancy.week);
        }
        if (s.modules.labor && p.labor?.active) {
            badges.push("🏥 Роды");
        }
        if (p.heat?.active) badges.push("🔥 Течка");
        if (p.rut?.active) badges.push("💢 Гон");
        if (p.babies?.length > 0) badges.push("👶×" + p.babies.length);

        if (badges.length > 0) {
            html += '<div class="lc-dash-item"><span class="lc-dash-name">' + name + '</span> ' + badges.join(' | ') + '</div>';
        }
    });

    itemsEl.innerHTML = html || '<div class="lc-dash-empty">Нет активных событий</div>';
}

function renderCharList() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-char-list");
    if (!el) return;

    let html = "";
    Object.entries(s.characters).forEach(([name, p]) => {
        const sexLabel = p.bioSex === "F" ? "♀" : "♂";
        const secLabel = p.secondarySex ? " (" + p.secondarySex + ")" : "";
        const raceLabel = p.race || "human";
        const enabledCls = p._enabled ? "" : " disabled";

        html += '<div class="lc-char-card' + enabledCls + '" data-char="' + name + '">' +
            '<div class="lc-char-card-header">' +
                '<span class="lc-char-card-name">' + name + '</span>' +
                '<span class="lc-char-card-info">' + sexLabel + secLabel + ' | ' + raceLabel + '</span>' +
            '</div>' +
            '<div class="lc-char-card-details">';

        if (p.eyeColor) html += '<span class="lc-tag">👁️ ' + p.eyeColor + '</span>';
        if (p.hairColor) html += '<span class="lc-tag">💇 ' + p.hairColor + '</span>';
        if (p.contraception && p.contraception !== "none") html += '<span class="lc-tag">💊 ' + p.contraception + '</span>';
        if (p._isUser) html += '<span class="lc-tag lc-tag-user">👤 User</span>';

        html += '</div>' +
            '<div class="lc-char-card-actions">' +
                '<button class="lc-btn lc-btn-sm lc-edit-char" data-char="' + name + '">✏️</button>' +
                '<button class="lc-btn lc-btn-sm lc-btn-danger lc-del-char" data-char="' + name + '">🗑️</button>' +
            '</div>' +
        '</div>';
    });

    el.innerHTML = html || '<div class="lc-empty">Персонажи не загружены. Нажмите «Синхронизация».</div>';
}

function renderCyclePanel() {
    const s = extension_settings[extensionName];
    const sel = document.getElementById("lc-cycle-char");
    const panel = document.getElementById("lc-cycle-panel");
    if (!sel || !panel) return;

    const name = sel.value;
    const p = s.characters[name];
    if (!p) { panel.innerHTML = '<div class="lc-empty">Персонаж не найден</div>'; return; }

    if (p.pregnancy?.active) {
        panel.innerHTML = '<div class="lc-info">Цикл приостановлен (беременность)</div>';
        return;
    }

    if (!p.cycle?.enabled) {
        panel.innerHTML = '<div class="lc-info">Цикл отключён для этого персонажа</div>';
        return;
    }

    const cm = new CycleManager(p);
    const ph = cm.phase();
    const fert = cm.fertility();
    const lib = cm.libido();
    const sym = cm.symptoms();
    const disc = cm.discharge();

    // Calendar visualization
    let cal = '<div class="lc-cycle-calendar">';
    for (let d = 1; d <= p.cycle.length; d++) {
        let cls = "lc-cal-day";
        const ov = Math.round(p.cycle.length - 14);
        if (d <= p.cycle.menstruationDuration) cls += " mens";
        else if (d >= ov - 2 && d <= ov + 1) cls += " ovul";
        else if (d < ov - 2) cls += " foll";
        else cls += " lut";
        if (d === p.cycle.currentDay) cls += " today";
        cal += '<div class="' + cls + '">' + d + '</div>';
    }
    cal += '</div>';

    let fertClass = "low";
    if (fert >= 0.2) fertClass = "peak";
    else if (fert >= 0.1) fertClass = "high";
    else if (fert >= 0.05) fertClass = "med";

    panel.innerHTML = cal +
        '<div class="lc-cycle-info">' +
            '<div class="lc-info-row"><span class="lc-label">Фаза:</span> ' + cm.phaseEmoji(ph) + ' ' + cm.phaseLabel(ph) + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">День:</span> ' + p.cycle.currentDay + ' / ' + p.cycle.length + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">Фертильность:</span> <span class="lc-fert-badge ' + fertClass + '">' + Math.round(fert * 100) + '%</span></div>' +
            '<div class="lc-info-row"><span class="lc-label">Либидо:</span> ' + lib + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">Выделения:</span> ' + disc + '</div>' +
            (sym.length > 0 ? '<div class="lc-info-row"><span class="lc-label">Симптомы:</span> ' + sym.join(', ') + '</div>' : '') +
        '</div>' +
        '<div class="lc-btn-group" style="margin-top:8px">' +
            '<button id="lc-cycle-plus1" class="lc-btn">+1 день</button>' +
            '<button id="lc-cycle-plus7" class="lc-btn">+7 дней</button>' +
            '<button id="lc-cycle-set" class="lc-btn">Уст. день</button>' +
        '</div>';

    document.getElementById("lc-cycle-plus1")?.addEventListener("click", () => {
        new CycleManager(p).advance(1);
        if (!s.worldDate.frozen) s.worldDate = addDays(s.worldDate, 1);
        saveSettingsDebounced(); renderCyclePanel(); renderDashboard();
    });
    document.getElementById("lc-cycle-plus7")?.addEventListener("click", () => {
        new CycleManager(p).advance(7);
        if (!s.worldDate.frozen) s.worldDate = addDays(s.worldDate, 7);
        saveSettingsDebounced(); renderCyclePanel(); renderDashboard();
    });
    document.getElementById("lc-cycle-set")?.addEventListener("click", () => {
        const v = prompt("Установить день цикла (1-" + p.cycle.length + "):");
        if (v && !isNaN(v)) {
            p.cycle.currentDay = clamp(parseInt(v), 1, p.cycle.length);
            saveSettingsDebounced(); renderCyclePanel(); renderDashboard();
        }
    });
}

function renderPregPanel() {
    const s = extension_settings[extensionName];
    const sel = document.getElementById("lc-preg-char");
    const panel = document.getElementById("lc-preg-panel");
    if (!sel || !panel) return;

    const name = sel.value;
    const p = s.characters[name];
    if (!p) { panel.innerHTML = '<div class="lc-empty">Персонаж не найден</div>'; return; }

    if (!p.pregnancy?.active) {
        panel.innerHTML = '<div class="lc-info">Беременность не активна</div>';
        return;
    }

    const pm = new PregnancyManager(p);
    const pr = p.pregnancy;
    const prog = Math.round((pr.week / pr.maxWeeks) * 100);

    panel.innerHTML =
        '<div class="lc-preg-header">' +
            '<div class="lc-preg-week">Неделя ' + pr.week + ' / ' + pr.maxWeeks + '</div>' +
            '<div class="lc-preg-trim">Триместр ' + pm.trimester() + '</div>' +
        '</div>' +
        '<div class="lc-sw-progress" style="margin:8px 0"><div class="lc-sw-progress-fill" style="width:' + prog + '%"></div></div>' +
        '<div class="lc-preg-info">' +
            '<div class="lc-info-row"><span class="lc-label">Размер плода:</span> ~' + pm.fetalSize() + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">Кол-во:</span> ' + pr.fetusCount + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">Отец:</span> ' + (pr.father || '?') + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">Шевеления:</span> ' + pm.movements() + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">Прибавка веса:</span> +' + pm.weightGain() + ' кг</div>' +
            '<div class="lc-info-row"><span class="lc-label">Симптомы:</span> ' + pm.symptoms().join(', ') + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">Тело:</span> ' + pm.bodyChanges().join(', ') + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">Эмоции:</span> ' + pm.emotionalState() + '</div>' +
        '</div>';
}

function renderLaborPanel() {
    const s = extension_settings[extensionName];
    const sel = document.getElementById("lc-labor-char");
    const panel = document.getElementById("lc-labor-panel");
    if (!sel || !panel) return;

    const name = sel.value;
    const p = s.characters[name];
    if (!p) { panel.innerHTML = '<div class="lc-empty">Персонаж не найден</div>'; return; }

    if (!p.labor?.active) {
        panel.innerHTML = '<div class="lc-info">Роды не активны</div>';
        return;
    }

    const lm = new LaborManager(p);

    panel.innerHTML =
        '<div class="lc-labor-info">' +
            '<div class="lc-info-row lc-labor-stage"><span class="lc-label">Стадия:</span> ' + LABOR_LABELS[p.labor.stage] + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">Раскрытие:</span> ' + p.labor.dilation + ' / 10 см</div>' +
            '<div class="lc-sw-progress" style="margin:4px 0"><div class="lc-sw-progress-fill" style="width:' + (p.labor.dilation * 10) + '%"></div></div>' +
            '<div class="lc-info-row"><span class="lc-label">Схватки:</span> каждые ' + p.labor.contractionInterval + ' мин, ' + p.labor.contractionDuration + ' сек</div>' +
            '<div class="lc-info-row"><span class="lc-label">Часов прошло:</span> ' + p.labor.hoursElapsed.toFixed(1) + '</div>' +
            '<div class="lc-info-row"><span class="lc-label">Родилось:</span> ' + p.labor.babiesDelivered + ' / ' + p.labor.totalBabies + '</div>' +
            '<div class="lc-labor-desc">' + lm.description() + '</div>' +
        '</div>';
}

function renderBabyList() {
    const s = extension_settings[extensionName];
    const sel = document.getElementById("lc-baby-parent");
    const list = document.getElementById("lc-baby-list");
    if (!sel || !list) return;

    const name = sel.value;
    const p = s.characters[name];
    if (!p || !p.babies || p.babies.length === 0) {
        list.innerHTML = '<div class="lc-empty">Нет малышей</div>';
        return;
    }

    let html = "";
    p.babies.forEach((b, i) => {
        const bm = new BabyManager(b);
        const ms = bm.milestones();
        const secSex = b.secondarySex ? ' | ' + b.secondarySex : '';

        html += '<div class="lc-baby-card">' +
            '<div class="lc-baby-header">' +
                '<span class="lc-baby-name">' + (b.name || 'Без имени #' + (i + 1)) + '</span>' +
                '<span class="lc-baby-sex">' + (b.sex === 'M' ? '♂' : '♀') + secSex + '</span>' +
            '</div>' +
            '<div class="lc-baby-details">' +
                '<div class="lc-info-row"><span class="lc-label">Возраст:</span> ' + bm.ageLabel() + '</div>' +
                '<div class="lc-info-row"><span class="lc-label">Стадия:</span> ' + b.state + '</div>' +
                '<div class="lc-info-row"><span class="lc-label">Вес:</span> ' + (b.currentWeight / 1000).toFixed(1) + ' кг</div>' +
                '<div class="lc-info-row"><span class="lc-label">Глаза:</span> ' + (b.eyeColor || '?') + '</div>' +
                '<div class="lc-info-row"><span class="lc-label">Волосы:</span> ' + (b.hairColor || '?') + '</div>' +
                '<div class="lc-info-row"><span class="lc-label">Мать:</span> ' + (b.mother || '?') + '</div>' +
                '<div class="lc-info-row"><span class="lc-label">Отец:</span> ' + (b.father || '?') + '</div>' +
                (b.nonHumanFeatures?.length > 0 ? '<div class="lc-info-row"><span class="lc-label">Особенности:</span> ' + b.nonHumanFeatures.join(', ') + '</div>' : '') +
                (ms.length > 0 ? '<div class="lc-info-row"><span class="lc-label">Вехи:</span> ' + ms.join(', ') + '</div>' : '') +
            '</div>' +
            '<div class="lc-baby-actions">' +
                '<button class="lc-btn lc-btn-sm lc-baby-rename" data-parent="' + name + '" data-idx="' + i + '">✏️ Имя</button>' +
            '</div>' +
        '</div>';
    });

    list.innerHTML = html;

    list.querySelectorAll(".lc-baby-rename").forEach(btn => {
        btn.addEventListener("click", function() {
            const pName = this.dataset.parent;
            const idx = parseInt(this.dataset.idx);
            const baby = s.characters[pName]?.babies?.[idx];
            if (!baby) return;
            const newName = prompt("Имя малыша:", baby.name || "");
            if (newName !== null) {
                baby.name = newName;
                saveSettingsDebounced();
                renderBabyList();
            }
        });
    });
}

function renderDiceLog() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-dice-log");
    if (!el) return;

    if (s.diceLog.length === 0) {
        el.innerHTML = '<div class="lc-empty">Бросков пока нет</div>';
        return;
    }

    let html = "";
    for (let i = s.diceLog.length - 1; i >= Math.max(0, s.diceLog.length - 20); i--) {
        const d = s.diceLog[i];
        const cls = d.result ? "lc-dice-success" : "lc-dice-fail";
        const autoTag = d.autoDetected ? ' <span class="lc-tag lc-tag-auto">авто</span>' : '';
        html += '<div class="lc-dice-entry ' + cls + '">' +
            '<span class="lc-dice-ts">' + d.timestamp + '</span>' + autoTag +
            ' 🎲 ' + d.roll + '/' + d.chance + '% ' +
            (d.result ? '✅' : '❌') + ' ' + d.targetChar +
            ' (' + d.actType + ', ' + d.ejaculation + ', контр: ' + d.contraception + ')' +
        '</div>';
    }
    el.innerHTML = html;
}

function renderIntimLog() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-intim-log-list");
    if (!el) return;

    if (s.intimacyLog.length === 0) {
        el.innerHTML = '<div class="lc-empty">Лог пуст</div>';
        return;
    }

    let html = "";
    for (let i = s.intimacyLog.length - 1; i >= Math.max(0, s.intimacyLog.length - 20); i--) {
        const e = s.intimacyLog[i];
        html += '<div class="lc-intim-entry">' +
            '<span class="lc-intim-ts">' + e.timestamp + '</span> ' +
            (e.participants || []).join(' × ') + ' | ' + (e.type || '?') + ' | ' + (e.ejaculation || '?') +
        '</div>';
    }
    el.innerHTML = html;
}

// ==========================================
// REBUILD ALL UI
// ==========================================

function rebuildUI() {
    renderDashboard();
    renderCharList();
    renderCyclePanel();
    renderPregPanel();
    renderLaborPanel();
    renderBabyList();
    renderDiceLog();
    renderIntimLog();
    updateAllSelects();
}

function updateAllSelects() {
    const s = extension_settings[extensionName];
    const names = Object.keys(s.characters);
    const opts = names.map(n => '<option value="' + n + '">' + n + '</option>').join("");

    document.querySelectorAll(".lc-char-select").forEach(sel => {
        const prev = sel.value;
        sel.innerHTML = opts;
        if (names.includes(prev)) sel.value = prev;
    });
}

// ==========================================
// CHARACTER EDITOR
// ==========================================

let currentEditChar = null;

function openCharEditor(name) {
    const s = extension_settings[extensionName];
    const p = s.characters[name];
    if (!p) return;
    currentEditChar = name;

    const editor = document.getElementById("lc-char-editor");
    const title = document.getElementById("lc-editor-title");
    if (!editor || !title) return;

    title.textContent = "Редактирование: " + name;

    document.getElementById("lc-edit-bio-sex").value = p.bioSex || "F";
    document.getElementById("lc-edit-sec-sex").value = p.secondarySex || "";
    document.getElementById("lc-edit-race").value = p.race || "human";
    document.getElementById("lc-edit-contra").value = p.contraception || "none";
    document.getElementById("lc-edit-difficulty").value = p.pregnancyDifficulty || "normal";
    document.getElementById("lc-edit-eyes").value = p.eyeColor || "";
    document.getElementById("lc-edit-hair").value = p.hairColor || "";
    document.getElementById("lc-edit-enabled").checked = p._enabled !== false;
    document.getElementById("lc-edit-cycle-on").checked = p.cycle?.enabled !== false;
    document.getElementById("lc-edit-cycle-len").value = p.cycle?.baseLength || 28;
    document.getElementById("lc-edit-mens-dur").value = p.cycle?.menstruationDuration || 5;
    document.getElementById("lc-edit-irreg").value = p.cycle?.irregularity || 2;
    document.getElementById("lc-edit-symptom-int").value = p.cycle?.symptomIntensity || "moderate";

    editor.classList.remove("hidden");
}

function closeCharEditor() {
    currentEditChar = null;
    document.getElementById("lc-char-editor")?.classList.add("hidden");
}

function saveCharEditor() {
    if (!currentEditChar) return;
    const s = extension_settings[extensionName];
    const p = s.characters[currentEditChar];
    if (!p) return;

    p.bioSex = document.getElementById("lc-edit-bio-sex").value;
    p._manualBioSex = true;
    p.secondarySex = document.getElementById("lc-edit-sec-sex").value || null;
    p._manualSecSex = true;
    p.race = document.getElementById("lc-edit-race").value;
    p._manualRace = true;
    p.contraception = document.getElementById("lc-edit-contra").value;
    p.pregnancyDifficulty = document.getElementById("lc-edit-difficulty").value;
    p.eyeColor = document.getElementById("lc-edit-eyes").value;
    p._manualEyes = !!p.eyeColor;
    p.hairColor = document.getElementById("lc-edit-hair").value;
    p._manualHair = !!p.hairColor;
    p._enabled = document.getElementById("lc-edit-enabled").checked;

    if (!p.cycle) p.cycle = makeProfile("", false).cycle;
    p.cycle.enabled = document.getElementById("lc-edit-cycle-on").checked;
    p.cycle.baseLength = parseInt(document.getElementById("lc-edit-cycle-len").value) || 28;
    p.cycle.length = p.cycle.baseLength;
    p.cycle.menstruationDuration = parseInt(document.getElementById("lc-edit-mens-dur").value) || 5;
    p.cycle.irregularity = parseInt(document.getElementById("lc-edit-irreg").value) || 2;
    p.cycle.symptomIntensity = document.getElementById("lc-edit-symptom-int").value;

    saveSettingsDebounced();
    closeCharEditor();
    rebuildUI();
    toastr.success("Персонаж «" + currentEditChar + "» обновлён!");
}

// ==========================================
// EVENT HANDLERS
// ==========================================

function bindEvents() {
    const s = extension_settings[extensionName];

    // Collapse toggle
    document.getElementById("lifecycle-header-toggle")?.addEventListener("click", function(e) {
        if (e.target.closest(".lc-switch")) return;
        const panel = document.getElementById("lifecycle-panel");
        const body = document.getElementById("lifecycle-body");
        const arrow = this.querySelector(".lc-collapse-arrow");
        if (!panel || !body) return;

        s.panelCollapsed = !s.panelCollapsed;
        panel.classList.toggle("collapsed", s.panelCollapsed);
        if (arrow) arrow.textContent = s.panelCollapsed ? "▶" : "▼";
        saveSettingsDebounced();
    });

    // Enable toggle
    document.getElementById("lc-enabled")?.addEventListener("change", function() {
        s.enabled = this.checked;
        saveSettingsDebounced();
    });

    // Tabs
    document.querySelectorAll(".lifecycle-tab").forEach(tab => {
        tab.addEventListener("click", function() {
            const target = this.dataset.tab;
            document.querySelectorAll(".lifecycle-tab").forEach(t => t.classList.remove("active"));
            document.querySelectorAll(".lifecycle-tab-content").forEach(c => c.classList.remove("active"));
            this.classList.add("active");
            document.querySelector('.lifecycle-tab-content[data-tab="' + target + '"]')?.classList.add("active");

            if (target === "cycle") renderCyclePanel();
            if (target === "preg") renderPregPanel();
            if (target === "labor") renderLaborPanel();
            if (target === "babies") renderBabyList();
            if (target === "intim") { renderDiceLog(); renderIntimLog(); }
        });
    });

    // Sync characters
    document.getElementById("lc-sync-chars")?.addEventListener("click", () => {
        syncCharacters();
        rebuildUI();
        toastr.success("Персонажи синхронизированы!");
    });

    // Add manual character
    document.getElementById("lc-add-manual")?.addEventListener("click", () => {
        const name = prompt("Имя нового персонажа:");
        if (!name || name.trim() === "") return;
        if (s.characters[name.trim()]) { toastr.warning("Персонаж уже существует!"); return; }
        s.characters[name.trim()] = makeProfile(name.trim(), false);
        saveSettingsDebounced();
        rebuildUI();
        toastr.success("Добавлен: " + name.trim());
    });

    // Char list click handlers (edit / delete)
    document.getElementById("lc-char-list")?.addEventListener("click", function(e) {
        const editBtn = e.target.closest(".lc-edit-char");
        const delBtn = e.target.closest(".lc-del-char");
        if (editBtn) openCharEditor(editBtn.dataset.char);
        if (delBtn) {
            const charName = delBtn.dataset.char;
            if (confirm("Удалить «" + charName + "»?")) {
                delete s.characters[charName];
                saveSettingsDebounced();
                rebuildUI();
            }
        }
    });

    // Editor save/cancel
    document.getElementById("lc-editor-save")?.addEventListener("click", saveCharEditor);
    document.getElementById("lc-editor-cancel")?.addEventListener("click", closeCharEditor);

    // Character selects change handlers
    document.getElementById("lc-cycle-char")?.addEventListener("change", renderCyclePanel);
    document.getElementById("lc-preg-char")?.addEventListener("change", renderPregPanel);
    document.getElementById("lc-labor-char")?.addEventListener("change", renderLaborPanel);
    document.getElementById("lc-baby-parent")?.addEventListener("change", renderBabyList);

    // Intimacy manual controls
    document.getElementById("lc-intim-log-btn")?.addEventListener("click", () => {
        const target = document.getElementById("lc-intim-target")?.value;
        const partner = document.getElementById("lc-intim-partner")?.value;
        const type = document.getElementById("lc-intim-type")?.value;
        const ejac = document.getElementById("lc-intim-ejac")?.value;
        if (!target) return;

        IntimacyManager.log({
            participants: [target, partner].filter(Boolean),
            type: type || "vaginal",
            ejaculation: ejac || "inside",
        });
        renderIntimLog();
        toastr.info("Акт записан!");
    });

    document.getElementById("lc-intim-roll-btn")?.addEventListener("click", () => {
        const target = document.getElementById("lc-intim-target")?.value;
        const partner = document.getElementById("lc-intim-partner")?.value;
        const type = document.getElementById("lc-intim-type")?.value;
        const ejac = document.getElementById("lc-intim-ejac")?.value;
        if (!target) return;

        const result = IntimacyManager.roll(target, {
            participants: [target, partner].filter(Boolean),
            type: type || "vaginal",
            ejaculation: ejac || "inside",
            hasContraception: false,
            noContraception: false,
        });
        showDicePopup(result, target, false);
        renderDiceLog();
    });

    // Auto-detect toggles
    document.getElementById("lc-auto-detect-intim")?.addEventListener("change", function() {
        s.autoDetectIntimacy = this.checked; saveSettingsDebounced();
    });
    document.getElementById("lc-auto-roll")?.addEventListener("change", function() {
        s.autoRollOnSex = this.checked; saveSettingsDebounced();
    });

    // Pregnancy buttons
    document.getElementById("lc-preg-advance")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name];
        if (!p?.pregnancy?.active) return;
        new PregnancyManager(p).advanceDay(7);
        if (!s.worldDate.frozen) s.worldDate = addDays(s.worldDate, 7);
        saveSettingsDebounced(); renderPregPanel(); renderDashboard();
    });

    document.getElementById("lc-preg-set-week")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name];
        if (!p?.pregnancy?.active) return;
        const w = prompt("Установить неделю (1-" + p.pregnancy.maxWeeks + "):");
        if (w && !isNaN(w)) {
            p.pregnancy.week = clamp(parseInt(w), 1, p.pregnancy.maxWeeks);
            p.pregnancy.day = 0;
            p.pregnancy.weightGain = new PregnancyManager(p).weightGain();
            saveSettingsDebounced(); renderPregPanel(); renderDashboard();
        }
    });

    document.getElementById("lc-preg-to-labor")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name];
        if (!p?.pregnancy?.active) return;
        new LaborManager(p).start();
        saveSettingsDebounced(); renderPregPanel(); renderLaborPanel(); renderDashboard();
        toastr.warning("Роды начались для " + name + "!");
    });

    document.getElementById("lc-preg-end")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name];
        if (!p?.pregnancy?.active) return;
        if (!confirm("Прервать беременность «" + name + "»?")) return;
        p.pregnancy.active = false;
        p.pregnancy.week = 0; p.pregnancy.day = 0;
        if (p.cycle) p.cycle.enabled = true;
        saveSettingsDebounced(); renderPregPanel(); renderDashboard();
    });

    // Labor buttons
    document.getElementById("lc-labor-advance")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name];
        if (!p?.labor?.active) return;
        new LaborManager(p).advance();
        saveSettingsDebounced(); renderLaborPanel(); renderDashboard();
    });

    document.getElementById("lc-labor-deliver")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name];
        if (!p?.labor?.active) return;

        const lm = new LaborManager(p);
        lm.deliver();

        const baby = BabyManager.generate(p, p.pregnancy?.father);
        p.babies.push(baby);
        saveSettingsDebounced();

        toastr.success("Родился малыш! (" + (baby.sex === "M" ? "мальчик" : "девочка") + ")");

        if (lm.l.babiesDelivered >= lm.l.totalBabies) {
            lm.end();
            toastr.info("Роды завершены для " + name);
        }

        renderLaborPanel(); renderBabyList(); renderDashboard();
    });

    document.getElementById("lc-labor-set-dil")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name];
        if (!p?.labor?.active) return;
        const v = prompt("Раскрытие (0-10 см):");
        if (v && !isNaN(v)) {
            p.labor.dilation = clamp(parseInt(v), 0, 10);
            saveSettingsDebounced(); renderLaborPanel();
        }
    });

    document.getElementById("lc-labor-end")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name];
        if (!p?.labor?.active) return;
        if (!confirm("Завершить роды «" + name + "»?")) return;
        new LaborManager(p).end();
        saveSettingsDebounced(); renderLaborPanel(); renderPregPanel(); renderDashboard();
    });

    // Settings: Modules
    document.getElementById("lc-mod-cycle")?.addEventListener("change", function() { s.modules.cycle = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-mod-preg")?.addEventListener("change", function() { s.modules.pregnancy = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-mod-labor")?.addEventListener("change", function() { s.modules.labor = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-mod-baby")?.addEventListener("change", function() { s.modules.baby = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-mod-intim")?.addEventListener("change", function() { s.modules.intimacy = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-mod-au")?.addEventListener("change", function() {
        s.modules.auOverlay = this.checked; saveSettingsDebounced();
        toggleAUSections();
    });

    // Settings: Auto
    document.getElementById("lc-auto-sync")?.addEventListener("change", function() { s.autoSyncCharacters = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-auto-parse-info")?.addEventListener("change", function() { s.autoParseCharInfo = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-auto-time")?.addEventListener("change", function() { s.autoTimeProgress = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-time-confirm")?.addEventListener("change", function() { s.timeParserConfirmation = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-show-widget")?.addEventListener("change", function() { s.showStatusWidget = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-time-sens")?.addEventListener("change", function() { s.timeParserSensitivity = this.value; saveSettingsDebounced(); });

    // Settings: Date
    document.getElementById("lc-date-apply")?.addEventListener("click", () => {
        s.worldDate.year = parseInt(document.getElementById("lc-date-y")?.value) || 2025;
        s.worldDate.month = clamp(parseInt(document.getElementById("lc-date-m")?.value) || 1, 1, 12);
        s.worldDate.day = clamp(parseInt(document.getElementById("lc-date-d")?.value) || 1, 1, 31);
        s.worldDate.hour = clamp(parseInt(document.getElementById("lc-date-h")?.value) || 12, 0, 23);
        saveSettingsDebounced(); renderDashboard();
        toastr.info("Дата обновлена: " + formatDate(s.worldDate));
    });

    document.getElementById("lc-date-plus1")?.addEventListener("click", () => {
        TimeParser.apply(1);
        document.getElementById("lc-date-y").value = s.worldDate.year;
        document.getElementById("lc-date-m").value = s.worldDate.month;
        document.getElementById("lc-date-d").value = s.worldDate.day;
        renderDashboard(); rebuildUI();
    });

    document.getElementById("lc-date-plus7")?.addEventListener("click", () => {
        TimeParser.apply(7);
        document.getElementById("lc-date-y").value = s.worldDate.year;
        document.getElementById("lc-date-m").value = s.worldDate.month;
        document.getElementById("lc-date-d").value = s.worldDate.day;
        renderDashboard(); rebuildUI();
    });

    document.getElementById("lc-date-frozen")?.addEventListener("change", function() {
        s.worldDate.frozen = this.checked; saveSettingsDebounced(); renderDashboard();
    });

    // Settings: Prompt injection
    document.getElementById("lc-prompt-on")?.addEventListener("change", function() { s.promptInjectionEnabled = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-prompt-pos")?.addEventListener("change", function() { s.promptInjectionPosition = this.value; saveSettingsDebounced(); });
    document.getElementById("lc-prompt-detail")?.addEventListener("change", function() { s.promptInjectionDetail = this.value; saveSettingsDebounced(); });

    // Settings: AU preset
    document.getElementById("lc-au-preset")?.addEventListener("change", function() {
        s.auPreset = this.value; saveSettingsDebounced();
        toggleAUSections();
    });

    // AU: Omegaverse settings
    document.getElementById("lc-au-heat-cycle")?.addEventListener("change", function() { s.auSettings.omegaverse.heatCycleLength = parseInt(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-heat-dur")?.addEventListener("change", function() { s.auSettings.omegaverse.heatDuration = parseInt(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-heat-fert")?.addEventListener("change", function() { s.auSettings.omegaverse.heatFertilityBonus = parseFloat(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-rut-dur")?.addEventListener("change", function() { s.auSettings.omegaverse.rutDuration = parseInt(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-knot-dur")?.addEventListener("change", function() { s.auSettings.omegaverse.knotDurationMin = parseInt(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-preg-weeks")?.addEventListener("change", function() { s.auSettings.omegaverse.pregnancyWeeks = parseInt(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-knot")?.addEventListener("change", function() { s.auSettings.omegaverse.knotEnabled = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-au-bond")?.addEventListener("change", function() { s.auSettings.omegaverse.bondingEnabled = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-au-suppress")?.addEventListener("change", function() { s.auSettings.omegaverse.suppressantsAvailable = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-au-mpreg")?.addEventListener("change", function() { s.auSettings.omegaverse.maleOmegaPregnancy = this.checked; saveSettingsDebounced(); });

    // AU: Fantasy settings
    document.getElementById("lc-au-f-human")?.addEventListener("change", function() { s.auSettings.fantasy.pregnancyByRace.human = parseInt(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-f-elf")?.addEventListener("change", function() { s.auSettings.fantasy.pregnancyByRace.elf = parseInt(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-f-dwarf")?.addEventListener("change", function() { s.auSettings.fantasy.pregnancyByRace.dwarf = parseInt(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-f-orc")?.addEventListener("change", function() { s.auSettings.fantasy.pregnancyByRace.orc = parseInt(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-f-halfling")?.addEventListener("change", function() { s.auSettings.fantasy.pregnancyByRace.halfling = parseInt(this.value); saveSettingsDebounced(); });
    document.getElementById("lc-au-f-features")?.addEventListener("change", function() { s.auSettings.fantasy.nonHumanFeatures = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-au-f-magic")?.addEventListener("change", function() { s.auSettings.fantasy.magicalComplications = this.checked; saveSettingsDebounced(); });

    // AU: Scifi settings
    document.getElementById("lc-au-s-artwomb")?.addEventListener("change", function() { s.auSettings.scifi.artificialWomb = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-au-s-genetic")?.addEventListener("change", function() { s.auSettings.scifi.geneticModification = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-au-s-accel")?.addEventListener("change", function() { s.auSettings.scifi.acceleratedGrowth = this.checked; saveSettingsDebounced(); });

    // Export/Import/Reset
    document.getElementById("lc-export")?.addEventListener("click", () => {
        downloadJSON(extension_settings[extensionName], "lifecycle_backup_" + Date.now() + ".json");
        toastr.info("Экспорт завершён!");
    });

    document.getElementById("lc-import")?.addEventListener("click", () => {
        uploadJSON(data => {
            extension_settings[extensionName] = deepMerge(defaultSettings, data);
            saveSettingsDebounced();
            document.getElementById("lifecycle-panel")?.remove();
            init();
            toastr.success("Импорт завершён!");
        });
    });

    document.getElementById("lc-reset")?.addEventListener("click", () => {
        if (!confirm("Сбросить ВСЕ данные LifeCycle? Это необратимо!")) return;
        extension_settings[extensionName] = JSON.parse(JSON.stringify(defaultSettings));
        saveSettingsDebounced();
        document.getElementById("lifecycle-panel")?.remove();
        init();
        toastr.warning("Данные сброшены!");
    });
}

function toggleAUSections() {
    const s = extension_settings[extensionName];
    const show = s.modules.auOverlay;
    document.querySelector(".lc-au-omegaverse-section")?.setAttribute("style", show && s.auPreset === "omegaverse" ? "" : "display:none");
    document.querySelector(".lc-au-fantasy-section")?.setAttribute("style", show && s.auPreset === "fantasy" ? "" : "display:none");
    document.querySelector(".lc-au-scifi-section")?.setAttribute("style", show && s.auPreset === "scifi" ? "" : "display:none");
}

// ==========================================
// MESSAGE HOOKS (auto-detect sex, auto-time, widget, prompt injection)
// ==========================================

function onMessageReceived(messageIdx) {
    const s = extension_settings[extensionName];
    if (!s.enabled) return;

    const ctx = getContext();
    if (!ctx.chat || messageIdx < 0 || messageIdx >= ctx.chat.length) return;
    const msg = ctx.chat[messageIdx];
    if (!msg || msg.is_user) return;

    const text = msg.mes || "";

    // Auto time parsing
    if (s.autoTimeProgress && !s.worldDate.frozen) {
        const days = TimeParser.parse(text);
        if (days) {
            if (s.timeParserConfirmation) {
                if (confirm("Обнаружен сдвиг времени: +" + days + " дн. Применить?")) {
                    TimeParser.apply(days);
                    rebuildUI();
                }
            } else {
                TimeParser.apply(days);
                rebuildUI();
            }
        }
    }

    // Auto-detect intimacy
    if (s.autoDetectIntimacy && s.modules.intimacy) {
        syncCharacters();
        const detection = IntimacyDetector.detect(text, s.characters);

        if (detection && detection.detected) {
            IntimacyManager.log({
                participants: detection.participants,
                type: detection.actType,
                ejaculation: detection.ejaculation,
                contraception: detection.hasContraception ? "да" : (detection.noContraception ? "нет" : "не указано"),
                autoDetected: true,
            });

            if (s.autoRollOnSex && detection.target) {
                // Only roll if vaginal + inside ejaculation (or unknown for vaginal)
                const shouldRoll = detection.actType === "vaginal" &&
                    (detection.ejaculation === "inside" || detection.ejaculation === "unknown");

                if (shouldRoll) {
                    const result = IntimacyManager.roll(detection.target, {
                        participants: detection.participants,
                        type: detection.actType,
                        ejaculation: detection.ejaculation,
                        hasContraception: detection.hasContraception,
                        noContraception: detection.noContraception,
                        autoDetected: true,
                    });
                    showDicePopup(result, detection.target, true);
                    renderDiceLog();
                }
            }

            renderIntimLog();
        }
    }

    // Status widget
    if (s.showStatusWidget) {
        StatusWidget.inject(messageIdx);
    }

    renderDashboard();
}

function onUserMessageSent(messageIdx) {
    const s = extension_settings[extensionName];
    if (!s.enabled) return;

    const ctx = getContext();
    if (!ctx.chat || messageIdx < 0 || messageIdx >= ctx.chat.length) return;
    const msg = ctx.chat[messageIdx];
    if (!msg || !msg.is_user) return;

    const text = msg.mes || "";

    // Auto time parsing from user messages too
    if (s.autoTimeProgress && !s.worldDate.frozen) {
        const days = TimeParser.parse(text);
        if (days) {
            if (s.timeParserConfirmation) {
                if (confirm("Обнаружен сдвиг времени: +" + days + " дн. Применить?")) {
                    TimeParser.apply(days);
                    rebuildUI();
                }
            } else {
                TimeParser.apply(days);
                rebuildUI();
            }
        }
    }
}

// ==========================================
// PROMPT INJECTION HOOK
// ==========================================

function onPromptGenerate(eventData) {
    const s = extension_settings[extensionName];
    if (!s.enabled || !s.promptInjectionEnabled) return;

    syncCharacters();
    const prompt = PromptInjector.generate();
    if (!prompt) return;

    const pos = s.promptInjectionPosition;

    if (pos === "system") {
        if (eventData.systemPrompt !== undefined) {
            eventData.systemPrompt += "\n\n" + prompt;
        }
    } else if (pos === "authornote") {
        if (eventData.extensionPrompts !== undefined) {
            const anKey = Object.keys(eventData.extensionPrompts).find(k => k.includes("author") || k.includes("note"));
            if (anKey) {
                eventData.extensionPrompts[anKey] = (eventData.extensionPrompts[anKey] || "") + "\n\n" + prompt;
            } else {
                eventData.extensionPrompts["lifecycle_injection"] = prompt;
            }
        }
    } else if (pos === "endofchat") {
        if (eventData.mesExamples !== undefined) {
            eventData.mesExamples += "\n\n" + prompt;
        }
    }

    // Fallback: try to use chat_completion_prompt_manager if available
    try {
        if (typeof SillyTavern !== "undefined" && SillyTavern.getContext) {
            const stCtx = SillyTavern.getContext();
            if (stCtx && typeof stCtx.setExtensionPrompt === "function") {
                const insertAt = pos === "system" ? 0 : pos === "authornote" ? 1 : 2;
                stCtx.setExtensionPrompt(extensionName, prompt, insertAt, 0);
            }
        }
    } catch (e) { /* silently fail */ }
}

// ==========================================
// INIT
// ==========================================

async function init() {
    // Merge settings
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = JSON.parse(JSON.stringify(defaultSettings));
    } else {
        extension_settings[extensionName] = deepMerge(
            JSON.parse(JSON.stringify(defaultSettings)),
            extension_settings[extensionName]
        );
    }

    // Load CSS
    const cssLink = document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.href = extensionFolderPath + "/style.css";
    document.head.appendChild(cssLink);

    // Remove old panel if exists
    document.getElementById("lifecycle-panel")?.remove();

    // Insert HTML into extensions panel
    const settingsContainer = document.getElementById("extensions_settings2") || document.getElementById("extensions_settings");
    if (settingsContainer) {
        settingsContainer.insertAdjacentHTML("beforeend", generateHTML());
    }

    // Sync characters
    syncCharacters();

    // Bind events
    bindEvents();

    // Initial render
    rebuildUI();
    toggleAUSections();

    // Subscribe to events
    if (eventSource) {
        eventSource.on(event_types.MESSAGE_RECEIVED, (messageIdx) => {
            onMessageReceived(messageIdx);
        });

        eventSource.on(event_types.MESSAGE_SENT, (messageIdx) => {
            onUserMessageSent(messageIdx);
        });

        // Prompt injection
        eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (eventData) => {
            onPromptGenerate(eventData);
        });

        // Character change
        eventSource.on(event_types.CHAT_CHANGED, () => {
            syncCharacters();
            rebuildUI();
        });
    }

    console.log("[LifeCycle v0.4.0] Initialized successfully!");
}

// ==========================================
// ENTRY POINT
// ==========================================

jQuery(async () => {
    await init();
});
