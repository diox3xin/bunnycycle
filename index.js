// ============================================================
// LifeCycle Extension v0.5.0 — index.js
// Full chat history parsing, contextual widget,
// heat/rut cycle tracking, auto-everything
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
    parseFullChat: true,
    modules: { cycle: true, pregnancy: true, labor: true, baby: true, intimacy: true, auOverlay: false },
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
            heatCycleLength: 30, heatDuration: 5, heatFertilityBonus: 0.35,
            rutCycleLength: 35, rutDuration: 4,
            knotEnabled: true, knotDurationMin: 15,
            bondingEnabled: true, bondType: "bite_mark",
            suppressantsAvailable: true, maleOmegaPregnancy: true, pregnancyWeeks: 36,
        },
        fantasy: {
            pregnancyByRace: { human: 40, elf: 60, dwarf: 35, orc: 32, halfling: 38 },
            nonHumanFeatures: true, magicalComplications: false,
        },
        scifi: { artificialWomb: false, geneticModification: false, acceleratedGrowth: false },
    },
    characters: {},
    diceLog: [],
    intimacyLog: [],
    _chatParsed: false,
};

// ==========================================
// UTILITY
// ==========================================

function deepMerge(target, source) {
    const r = { ...target };
    for (const k of Object.keys(source)) {
        if (source[k] && typeof source[k] === "object" && !Array.isArray(source[k]) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
            r[k] = deepMerge(target[k], source[k]);
        } else { r[k] = source[k]; }
    }
    return r;
}

function fmt(d) {
    const p = n => String(n).padStart(2, "0");
    return `${d.year}/${p(d.month)}/${p(d.day)} ${p(d.hour)}:${p(d.minute)}`;
}

function addDays(d, days) {
    const dt = new Date(d.year, d.month - 1, d.day, d.hour, d.minute);
    dt.setDate(dt.getDate() + days);
    return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate(), hour: dt.getHours(), minute: dt.getMinutes(), frozen: d.frozen };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dice(n) { return Math.floor(Math.random() * (n || 100)) + 1; }

// ==========================================
// CHAT HISTORY PARSER — reads ENTIRE chat
// ==========================================

class ChatHistoryParser {
    static CHILD_PATTERNS = [
        /(?:родил[аи]?|появил(?:ся|ась)|born|gave\s*birth)\s*(?:to\s*)?(?:(?:мальчик|девочк|сын|дочь|boy|girl|son|daughter)[аеу]?\s*)?(?:по\s*имени\s*|named?\s*|назвал[аи]?\s*)["«]?(\w[\w\s]{1,20})["»]?/gi,
        /(?:малыш|ребён(?:ок|ка)|baby|child|infant)\s+(?:по\s*имени\s*|named?\s*)["«]?(\w[\w\s]{1,20})["»]?/gi,
        /(?:их|наш[аеу]?|her|his|their)\s+(?:сын|дочь|son|daughter|ребён\w+|малыш\w*|baby)\s+["«]?(\w{2,20})["»]?/gi,
    ];

    static CHILD_SEX_PATTERNS = {
        M: /(?:мальчик|сын|boy|son|he)\b/i,
        F: /(?:девочк|дочь|дочер|girl|daughter|she)\b/i,
    };

    static PREGNANCY_PATTERNS = [
        /(?:беременн|pregnant|ожида(?:ет|ла|ть)\s*ребёнк|expecting|carrying\s*(?:a\s*)?(?:child|baby))/i,
        /(?:тест\s*(?:на\s*беременность|показал)\s*(?:положительн|две\s*полоск))/i,
        /(?:pregnancy\s*test\s*(?:positive|two\s*lines))/i,
        /(?:токсикоз|утренняя\s*тошнота|morning\s*sickness)/i,
        /(?:живот\s*(?:рос|округл|заметн)|(?:belly|bump)\s*(?:grow|showing|visible))/i,
        /(?:(\d{1,2})\s*(?:недел[ьяию]|week)\s*(?:беременност|pregnant|of\s*pregnancy))/i,
    ];

    static SECONDARY_SEX_CONTEXT = {
        alpha: /\b(альфа|alpha)\b/i,
        beta: /\b(бета|beta)\b/i,
        omega: /\b(омега|omega)\b/i,
    };

    static HEAT_PATTERNS = [
        /(?:течк[аеуи]|heat|in\s*heat|estrus)/i,
        /(?:начал(?:ась|ся)\s*течка|heat\s*(?:started|began|hit))/i,
        /(?:запах\s*(?:течки|омеги)|scent\s*of\s*(?:heat|omega))/i,
        /(?:слик|slick|самосмазк|self[- ]?lubricat)/i,
    ];

    static RUT_PATTERNS = [
        /(?:гон[а-яё]*|rut(?:ting)?|in\s*rut)/i,
        /(?:начал(?:ся)?\s*гон|rut\s*(?:started|began|hit))/i,
        /(?:альфа.*(?:агрессивн|possessiv|доминант))/i,
    ];

    static BIO_SEX_CONTEXT = {
        F: /\b(она|её|ей|she|her|hers|девушк|женщин)\b/i,
        M: /\b(он|его|ему|he|him|his|парень|мужчин)\b/i,
    };

    static parseFullChat(chatMessages, characters) {
        if (!chatMessages || chatMessages.length === 0) return {};
        const results = {};
        const charNames = Object.keys(characters);
        const fullText = chatMessages.map(m => m.mes || "").join("\n");

        for (const name of charNames) {
            const info = {};

            // Find text chunks relevant to this character
            const relevant = [];
            for (const msg of chatMessages) {
                const t = msg.mes || "";
                if (t.toLowerCase().includes(name.toLowerCase())) relevant.push(t);
            }
            const charText = relevant.join("\n");

            // Secondary sex from context
            for (const [sec, pat] of Object.entries(this.SECONDARY_SEX_CONTEXT)) {
                // Check if pattern is near character name
                const nameRe = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "[\\s\\-]*" + pat.source, "i");
                const nameRe2 = new RegExp(pat.source + "[\\s\\-]*" + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), "i");
                if (nameRe.test(fullText) || nameRe2.test(fullText)) {
                    info.secondarySex = sec;
                    break;
                }
            }
            // Also check just in character's relevant text
            if (!info.secondarySex) {
                for (const [sec, pat] of Object.entries(this.SECONDARY_SEX_CONTEXT)) {
                    if (pat.test(charText)) { info.secondarySex = sec; break; }
                }
            }

            // Bio sex from context
            if (charText.length > 0) {
                let fCount = 0, mCount = 0;
                const fMatches = charText.match(/\b(она|её|ей|she|her)\b/gi);
                const mMatches = charText.match(/\b(он|его|ему|he|him)\b/gi);
                if (fMatches) fCount = fMatches.length;
                if (mMatches) mCount = mMatches.length;
                if (fCount > mCount * 2) info.bioSex = "F";
                else if (mCount > fCount * 2) info.bioSex = "M";
            }

            // Pregnancy detection
            for (const pat of this.PREGNANCY_PATTERNS) {
                if (pat.test(charText)) {
                    info.isPregnant = true;
                    // Try to get week number
                    const weekMatch = charText.match(/(\d{1,2})\s*(?:недел[ьяию]|week)/i);
                    if (weekMatch) info.pregnancyWeek = parseInt(weekMatch[1]);
                    break;
                }
            }

            // Heat detection
            for (const pat of this.HEAT_PATTERNS) {
                if (pat.test(charText)) { info.inHeat = true; break; }
            }

            // Rut detection
            for (const pat of this.RUT_PATTERNS) {
                if (pat.test(charText)) { info.inRut = true; break; }
            }

            // Children detection
            info.children = [];
            for (const pat of this.CHILD_PATTERNS) {
                let m;
                const re = new RegExp(pat.source, pat.flags);
                while ((m = re.exec(fullText)) !== null) {
                    const childName = m[1]?.trim();
                    if (childName && childName.length >= 2 && childName.length <= 20 && !charNames.includes(childName)) {
                        // Determine sex from surrounding context
                        const surroundStart = Math.max(0, m.index - 100);
                        const surroundEnd = Math.min(fullText.length, m.index + m[0].length + 100);
                        const surrounding = fullText.substring(surroundStart, surroundEnd);
                        let childSex = null;
                        if (this.CHILD_SEX_PATTERNS.M.test(surrounding)) childSex = "M";
                        else if (this.CHILD_SEX_PATTERNS.F.test(surrounding)) childSex = "F";

                        if (!info.children.find(c => c.name === childName)) {
                            info.children.push({ name: childName, sex: childSex });
                        }
                    }
                }
            }

            if (Object.keys(info).length > 0) results[name] = info;
        }

        return results;
    }
}

// ==========================================
// CHAR INFO PARSER (from card description)
// ==========================================

class CharInfoParser {
    static SEX = { F: /\b(female|woman|girl|девушка|женщина|she\/her|фем|самка)\b/i, M: /\b(male|man|boy|мужчина|парень|he\/him|маск|самец)\b/i };
    static SEC_SEX = { alpha: /\b(alpha|альфа)\b/i, beta: /\b(beta|бета)\b/i, omega: /\b(omega|омега)\b/i };
    static RACE = { human:/\b(human|человек)\b/i, elf:/\b(elf|эльф)\b/i, dwarf:/\b(dwarf|дварф|гном)\b/i, orc:/\b(orc|орк)\b/i, demon:/\b(demon|демон)\b/i, vampire:/\b(vampire|вампир)\b/i, werewolf:/\b(werewolf|оборотень)\b/i, neko:/\b(neko|неко)\b/i, kitsune:/\b(kitsune|кицунэ)\b/i };
    static EYE = /\b(голуб\S*|сини\S*|сер\S*|зелён\S*|зелен\S*|кар\S*|чёрн\S*|черн\S*|янтарн\S*|золот\S*|фиолетов\S*|красн\S*|гетерохром\S*|blue|green|brown|hazel|grey|gray|amber|gold|red|violet|purple)\s*(?:eye|eyes|глаз)/i;
    static HAIR = /\b(блонд\S*|русы\S*|рыж\S*|чёрн\S*|черн\S*|бел\S*|серебрист\S*|розов\S*|голуб\S*|фиолетов\S*|каштанов\S*|платинов\S*|медн\S*|золотист\S*|пшеничн\S*|blonde?|brunette?|redhead|black|white|silver|pink|blue|green|purple)\s*(?:hair|волос)/i;

    static parse(charObj) {
        if (!charObj) return {};
        const t = [charObj.description, charObj.personality, charObj.scenario, charObj.first_mes, charObj.data?.description, charObj.data?.personality, charObj.data?.extensions?.depth_prompt?.prompt].filter(Boolean).join("\n");
        const info = {};
        for (const [s, p] of Object.entries(this.SEX)) { if (p.test(t)) { info.bioSex = s; break; } }
        for (const [s, p] of Object.entries(this.SEC_SEX)) { if (p.test(t)) { info.secondarySex = s; break; } }
        for (const [r, p] of Object.entries(this.RACE)) { if (p.test(t)) { info.race = r; break; } }
        let m = t.match(this.EYE); if (m) info.eyeColor = m[1].trim();
        m = t.match(this.HAIR); if (m) info.hairColor = m[1].trim();
        return info;
    }
}

// ==========================================
// INTIMACY AUTO-DETECTOR
// ==========================================

class IntimacyDetector {
    static SEX_RU = [/вошё?л\s*(в\s*неё|внутрь|в\s*него)/i,/проник/i,/трахал|трахнул|ебал|ебёт|выебал/i,/кончил\s*(внутрь|в\s*неё|в\s*него|наружу|на)/i,/член\s*(?:вошёл|внутри|двигал)/i,/фрикци/i,/без\s*(?:презерватива|защиты|резинки)/i,/наполнил\s*(?:её|его|спермой)/i,/узел\s*(?:набух|вошёл|внутри|раздул|застрял)/i,/сцеп(?:ка|ились)/i];
    static SEX_EN = [/(?:thrust|pushed|slid)\s*(?:inside|into|deeper)/i,/penetrat/i,/fuck(?:ed|ing)/i,/cum(?:ming|med)?\s*(?:inside|in(?:to)?|deep)/i,/came\s*inside/i,/raw|bareback|without\s*condom/i,/bred|breed|creampie/i,/knot(?:ted|ting)?\s*(?:inside|swell|lock|stuck)/i];
    static CONTRA = [/презерватив|кондом|резинк/i,/condom/i,/надел\s*(?:защиту|резинку|презерватив)/i];
    static NO_CONTRA = [/без\s*(?:презерватива|защиты|резинки)/i,/raw|bareback|without\s*(?:a\s*)?condom/i,/снял\s*презерватив/i];
    static EJAC_IN = [/кончил\s*(?:внутрь|в\s*неё|в\s*него|глубоко)/i,/наполнил/i,/cum(?:ming|med)?\s*(?:inside|in(?:to)?|deep)/i,/creampie/i,/узел.*внутри|knot.*inside/i];
    static EJAC_OUT = [/кончил\s*(?:наружу|на\s*живот|на\s*лицо|снаружи)/i,/pull(?:ed)?\s*out/i];
    static ANAL = [/анал/i,/в\s*(?:задн|попу|попку|анус)/i,/anal/i];
    static ORAL = [/минет|отсос|куннилингус/i,/blowjob|oral|fellatio/i];

    static detect(text, characters) {
        if (!text) return null;
        let score = 0;
        for (const p of [...this.SEX_RU, ...this.SEX_EN]) { if (p.test(text)) score++; }
        if (score < 2) return null;

        let type = "vaginal";
        for (const p of this.ANAL) { if (p.test(text)) { type = "anal"; break; } }
        for (const p of this.ORAL) { if (p.test(text)) { type = "oral"; break; } }

        let contra = false, noCon = false;
        for (const p of this.CONTRA) { if (p.test(text)) { contra = true; break; } }
        for (const p of this.NO_CONTRA) { if (p.test(text)) { noCon = true; break; } }

        let ejac = "unknown";
        for (const p of this.EJAC_IN) { if (p.test(text)) { ejac = "inside"; break; } }
        if (ejac === "unknown") for (const p of this.EJAC_OUT) { if (p.test(text)) { ejac = "outside"; break; } }

        const parts = [];
        const names = Object.keys(characters);
        for (const n of names) {
            if (text.toLowerCase().includes(n.toLowerCase()) || characters[n]._isUser) parts.push(n);
        }
        if (parts.length < 2 && names.length >= 2) { for (const n of names) { if (!parts.includes(n)) parts.push(n); if (parts.length >= 2) break; } }

        let target = null;
        const s = extension_settings[extensionName];
        for (const n of parts) {
            const p = characters[n]; if (!p) continue;
            if (p.bioSex === "F") { target = n; break; }
            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.secondarySex === "omega" && s.auSettings.omegaverse.maleOmegaPregnancy) { target = n; break; }
        }

        return { detected: true, score, type, contra: contra && !noCon, noCon, ejac, parts, target };
    }
}

// ==========================================
// CHARACTER SYNC + FULL CHAT PARSE
// ==========================================

function getActiveChars() {
    const ctx = getContext(); const chars = []; if (!ctx) return chars;
    if (ctx.characterId !== undefined && ctx.characters) {
        const c = ctx.characters[ctx.characterId];
        if (c) chars.push({ name: c.name, avatar: c.avatar, isUser: false, obj: c });
    }
    if (ctx.groups && ctx.groupId) {
        const g = ctx.groups.find(x => x.id === ctx.groupId);
        if (g?.members) for (const av of g.members) {
            const c = ctx.characters.find(x => x.avatar === av);
            if (c && !chars.find(x => x.name === c.name)) chars.push({ name: c.name, avatar: c.avatar, isUser: false, obj: c });
        }
    }
    if (ctx.name1) chars.push({ name: ctx.name1, avatar: null, isUser: true, obj: null });
    return chars;
}

function syncChars() {
    const s = extension_settings[extensionName];
    if (!s.autoSyncCharacters) return;
    const active = getActiveChars();
    let changed = false;

    for (const c of active) {
        if (!s.characters[c.name]) {
            s.characters[c.name] = makeProfile(c.name, c.isUser);
            changed = true;
        }
        // Parse from card
        if (s.autoParseCharInfo && c.obj && !c.isUser) {
            const parsed = CharInfoParser.parse(c.obj);
            const p = s.characters[c.name];
            if (parsed.bioSex && !p._mBio) { p.bioSex = parsed.bioSex; changed = true; }
            if (parsed.secondarySex && !p._mSec) { p.secondarySex = parsed.secondarySex; changed = true; }
            if (parsed.race && !p._mRace) { p.race = parsed.race; changed = true; }
            if (parsed.eyeColor && !p._mEyes) { p.eyeColor = parsed.eyeColor; changed = true; }
            if (parsed.hairColor && !p._mHair) { p.hairColor = parsed.hairColor; changed = true; }
        }
    }

    // Parse full chat history
    if (s.parseFullChat) {
        const ctx = getContext();
        if (ctx?.chat && ctx.chat.length > 0) {
            const chatData = ChatHistoryParser.parseFullChat(ctx.chat, s.characters);

            for (const [name, info] of Object.entries(chatData)) {
                const p = s.characters[name];
                if (!p) continue;

                if (info.secondarySex && !p._mSec) { p.secondarySex = info.secondarySex; changed = true; }
                if (info.bioSex && !p._mBio) { p.bioSex = info.bioSex; changed = true; }

                if (info.isPregnant && !p.pregnancy?.active && !p._mPreg) {
                    p.pregnancy.active = true;
                    p.pregnancy.week = info.pregnancyWeek || 4;
                    p.pregnancy.day = 0;
                    if (p.cycle) p.cycle.enabled = false;
                    changed = true;
                }

                if (info.inHeat && p.secondarySex === "omega" && !p.heat?.active) {
                    p.heat.active = true; p.heat.currentDay = 1;
                    changed = true;
                }

                if (info.inRut && p.secondarySex === "alpha" && !p.rut?.active) {
                    p.rut.active = true; p.rut.currentDay = 1;
                    changed = true;
                }

                // Children
                if (info.children?.length > 0) {
                    for (const child of info.children) {
                        if (!p.babies.find(b => b.name === child.name)) {
                            p.babies.push({
                                name: child.name, sex: child.sex || (Math.random() < 0.5 ? "M" : "F"),
                                secondarySex: null, birthWeight: 3200, currentWeight: 5000,
                                ageDays: 30, eyeColor: p.eyeColor || "", hairColor: p.hairColor || "",
                                mother: p.bioSex === "F" ? name : "?", father: p.bioSex === "M" ? name : "?",
                                nonHumanFeatures: [], state: "младенец",
                                birthDate: { ...s.worldDate },
                            });
                            changed = true;
                        }
                    }
                }
            }
        }
    }

    if (changed) saveSettingsDebounced();
}

function makeProfile(name, isUser) {
    return {
        name, bioSex: "F", secondarySex: null, race: "human",
        contraception: "none", eyeColor: "", hairColor: "", pregnancyDifficulty: "normal",
        _isUser: isUser, _enabled: true,
        _mBio: false, _mSec: false, _mRace: false, _mEyes: false, _mHair: false, _mPreg: false,
        cycle: {
            enabled: true, currentDay: Math.floor(Math.random() * 28) + 1,
            baseLength: 28, length: 28, menstruationDuration: 5,
            irregularity: 2, symptomIntensity: "moderate", cycleCount: 0,
        },
        pregnancy: { active: false, week: 0, day: 0, maxWeeks: 40, father: null, fetusCount: 1, complications: [], weightGain: 0 },
        labor: { active: false, stage: "latent", dilation: 0, contractionInterval: 0, contractionDuration: 0, hoursElapsed: 0, babiesDelivered: 0, totalBabies: 1 },
        heat: { active: false, currentDay: 0, cycleDays: 30, duration: 5, intensity: "moderate", daysSinceLast: Math.floor(Math.random() * 25), onSuppressants: false, phase: "rest" },
        rut: { active: false, currentDay: 0, cycleDays: 35, duration: 4, intensity: "moderate", daysSinceLast: Math.floor(Math.random() * 30), phase: "rest" },
        babies: [],
    };
}

// ==========================================
// CYCLE MANAGER
// ==========================================

class CycleManager {
    constructor(p) { this.p = p; this.c = p.cycle; }
    phase() {
        if (!this.c?.enabled) return "unknown";
        const d = this.c.currentDay, l = this.c.length, m = this.c.menstruationDuration, ov = Math.round(l - 14);
        if (d <= m) return "menstruation";
        if (d < ov - 2) return "follicular";
        if (d <= ov + 1) return "ovulation";
        return "luteal";
    }
    label(ph) { return { menstruation:"Менструация", follicular:"Фолликулярная", ovulation:"Овуляция", luteal:"Лютеиновая", unknown:"—" }[ph]||ph; }
    emoji(ph) { return { menstruation:"🔴", follicular:"🌸", ovulation:"🥚", luteal:"🌙", unknown:"❓" }[ph]||"❓"; }
    fertility() {
        const b = { ovulation:0.25, follicular:0.08, luteal:0.02, menstruation:0.01, unknown:0.05 }[this.phase()]||0.05;
        const s = extension_settings[extensionName];
        let bonus = 0;
        if (s.modules.auOverlay && s.auPreset === "omegaverse" && this.p.heat?.active) bonus = s.auSettings.omegaverse.heatFertilityBonus;
        return Math.min(b + bonus, 0.95);
    }
    libido() {
        if (this.p.heat?.active || this.p.rut?.active) return "экстремальное";
        return { ovulation:"высокое", follicular:"среднее", luteal:"низкое", menstruation:"низкое" }[this.phase()]||"среднее";
    }
    symptoms() {
        const ph = this.phase(), i = this.c.symptomIntensity, r = [];
        if (ph === "menstruation") { r.push("кровотечение"); if (i !== "mild") r.push("спазмы"); if (i === "severe") r.push("сильная боль"); }
        if (ph === "ovulation") { r.push("↑ либидо"); if (i !== "mild") r.push("чувствительность груди"); }
        if (ph === "luteal") { r.push("ПМС"); if (i !== "mild") r.push("перепады настроения"); }
        if (ph === "follicular") r.push("прилив энергии");
        return r;
    }
    discharge() { return { menstruation:"менструальные", follicular:"скудные", ovulation:"обильные, тягучие", luteal:"густые, белые" }[this.phase()]||"обычные"; }
    advance(days) {
        for (let i = 0; i < days; i++) {
            this.c.currentDay++;
            if (this.c.currentDay > this.c.length) {
                this.c.currentDay = 1; this.c.cycleCount++;
                if (this.c.irregularity > 0) { this.c.length = clamp(this.c.baseLength + Math.floor(Math.random() * this.c.irregularity * 2) - this.c.irregularity, 21, 45); }
            }
        }
    }
}

// ==========================================
// HEAT/RUT CYCLE MANAGER (separate tracking)
// ==========================================

class HeatRutManager {
    constructor(p) { this.p = p; }

    static HEAT_PHASES = { preHeat:"Предтечка", heat:"Течка", postHeat:"Посттечка", rest:"Покой" };
    static RUT_PHASES = { preRut:"Предгон", rut:"Гон", postRut:"Постгон", rest:"Покой" };

    heatPhase() {
        const h = this.p.heat; if (!h) return "rest";
        if (h.active) {
            if (h.currentDay <= 1) return "preHeat";
            if (h.currentDay <= h.duration - 1) return "heat";
            return "postHeat";
        }
        // Days until next heat
        const daysLeft = h.cycleDays - h.daysSinceLast;
        if (daysLeft <= 3 && daysLeft > 0) return "preHeat";
        return "rest";
    }

    rutPhase() {
        const r = this.p.rut; if (!r) return "rest";
        if (r.active) {
            if (r.currentDay <= 1) return "preRut";
            if (r.currentDay <= r.duration - 1) return "rut";
            return "postRut";
        }
        const daysLeft = r.cycleDays - r.daysSinceLast;
        if (daysLeft <= 3 && daysLeft > 0) return "preRut";
        return "rest";
    }

    heatSymptoms() {
        const phase = this.heatPhase();
        const h = this.p.heat;
        if (phase === "preHeat") return ["лёгкий жар", "беспокойство", "повышенная чувствительность", "слабый запах"];
        if (phase === "heat") {
            const base = ["сильный жар", "обильная самосмазка", "интенсивные феромоны", "затуманенное сознание", "потребность в близости"];
            if (h?.intensity === "severe") base.push("болезненные спазмы", "дрожь", "невозможность концентрироваться");
            return base;
        }
        if (phase === "postHeat") return ["утихающий жар", "усталость", "остаточная чувствительность"];
        return [];
    }

    rutSymptoms() {
        const phase = this.rutPhase();
        if (phase === "preRut") return ["раздражительность", "повышенная агрессия", "территориальность"];
        if (phase === "rut") return ["экстремальная агрессия", "доминантное поведение", "набухание узла", "навязчивое влечение", "рычание"];
        if (phase === "postRut") return ["усталость", "утихающая агрессия", "ясность сознания"];
        return [];
    }

    heatDaysUntilNext() {
        const h = this.p.heat;
        if (!h || h.active) return 0;
        return Math.max(0, h.cycleDays - (h.daysSinceLast || 0));
    }

    rutDaysUntilNext() {
        const r = this.p.rut;
        if (!r || r.active) return 0;
        return Math.max(0, r.cycleDays - (r.daysSinceLast || 0));
    }

    heatProgress() {
        const h = this.p.heat;
        if (!h) return 0;
        if (h.active) return (h.currentDay / h.duration) * 100;
        return ((h.daysSinceLast || 0) / h.cycleDays) * 100;
    }

    rutProgress() {
        const r = this.p.rut;
        if (!r) return 0;
        if (r.active) return (r.currentDay / r.duration) * 100;
        return ((r.daysSinceLast || 0) / r.cycleDays) * 100;
    }

    advanceHeat(days) {
        const h = this.p.heat;
        if (!h || h.onSuppressants) return;
        const auS = extension_settings[extensionName].auSettings?.omegaverse;
        h.cycleDays = auS?.heatCycleLength || 30;
        h.duration = auS?.heatDuration || 5;

        for (let i = 0; i < days; i++) {
            if (h.active) {
                h.currentDay++;
                if (h.currentDay > h.duration) { h.active = false; h.currentDay = 0; h.daysSinceLast = 0; h.phase = "rest"; }
                else { h.phase = this.heatPhase(); }
            } else {
                h.daysSinceLast = (h.daysSinceLast || 0) + 1;
                if (h.daysSinceLast >= h.cycleDays) { h.active = true; h.currentDay = 1; h.intensity = "severe"; h.phase = "preHeat"; }
                else { h.phase = this.heatPhase(); }
            }
        }
    }

    advanceRut(days) {
        const r = this.p.rut;
        if (!r) return;
        const auS = extension_settings[extensionName].auSettings?.omegaverse;
        r.cycleDays = auS?.rutCycleLength || 35;
        r.duration = auS?.rutDuration || 4;

        for (let i = 0; i < days; i++) {
            if (r.active) {
                r.currentDay++;
                if (r.currentDay > r.duration) { r.active = false; r.currentDay = 0; r.daysSinceLast = 0; r.phase = "rest"; }
                else { r.phase = this.rutPhase(); }
            } else {
                r.daysSinceLast = (r.daysSinceLast || 0) + 1;
                if (r.daysSinceLast >= r.cycleDays) { r.active = true; r.currentDay = 1; r.intensity = "moderate"; r.phase = "preRut"; }
                else { r.phase = this.rutPhase(); }
            }
        }
    }
}

// ==========================================
// PREGNANCY MANAGER
// ==========================================

class PregnancyManager {
    constructor(p) { this.p = p; this.pr = p.pregnancy; }
    active() { return this.pr?.active; }
    start(father, count) {
        const s = extension_settings[extensionName];
        this.pr.active = true; this.pr.week = 1; this.pr.day = 0; this.pr.father = father; this.pr.fetusCount = count || 1; this.pr.weightGain = 0;
        let mw = 40;
        if (s.modules.auOverlay && s.auPreset === "omegaverse") mw = s.auSettings.omegaverse.pregnancyWeeks || 36;
        else if (s.modules.auOverlay && s.auPreset === "fantasy" && this.p.race) mw = s.auSettings.fantasy.pregnancyByRace[this.p.race] || 40;
        if (count > 1) mw = Math.max(28, mw - (count - 1) * 3);
        this.pr.maxWeeks = mw;
        if (this.p.cycle) this.p.cycle.enabled = false;
    }
    advanceDay(d) { if (!this.active()) return; this.pr.day += d; while (this.pr.day >= 7) { this.pr.day -= 7; this.pr.week++; } this.pr.weightGain = this.weightGain(); }
    trimester() { return this.pr.week <= 12 ? 1 : this.pr.week <= 27 ? 2 : 3; }
    fetalSize() {
        const sizes = [[4,"маковое зерно"],[6,"черника"],[8,"малина"],[10,"кумкват"],[12,"лайм"],[14,"лимон"],[16,"авокадо"],[18,"перец"],[20,"банан"],[24,"кукуруза"],[28,"баклажан"],[32,"тыква"],[36,"дыня"],[40,"арбуз"]];
        let r = "эмбрион"; for (const [w, n] of sizes) if (this.pr.week >= w) r = n; return r;
    }
    symptoms() {
        const w = this.pr.week, r = [], d = this.p.pregnancyDifficulty;
        if (w >= 4 && w <= 14) { r.push("тошнота","усталость"); if (d !== "easy") r.push("рвота"); }
        if (w >= 14 && w <= 27) { r.push("рост живота"); if (w >= 18) r.push("шевеления"); }
        if (w >= 28) { r.push("одышка","отёки"); if (w >= 32) r.push("тренировочные схватки"); if (w >= 36) r.push("гнездование"); }
        if (this.pr.fetusCount > 1) r.push("многоплодная"); return r;
    }
    movements() { const w = this.pr.week; if (w < 16) return "нет"; if (w < 22) return "бабочки"; if (w < 28) return "толчки"; if (w < 34) return "активные"; return "реже (мало места)"; }
    weightGain() {
        const w = this.pr.week; let b; if (w <= 12) b = w * 0.2; else if (w <= 27) b = 2.4 + (w-12) * 0.45; else b = 9.15 + (w-27) * 0.4;
        return Math.round(b * (1 + (this.pr.fetusCount - 1) * 0.3) * 10) / 10;
    }
    bodyChanges() {
        const w = this.pr.week, r = [];
        if (w >= 6) r.push("грудь ↑"); if (w >= 12) r.push("живот округляется"); if (w >= 20) r.push("linea nigra"); if (w >= 24) r.push("растяжки"); if (w >= 28) r.push("пупок выпирает"); if (w >= 36) r.push("живот опускается"); return r;
    }
    emotion() { return { 1:"тревога, перепады", 2:"стабильнее, привязанность", 3:"нетерпение, гнездование" }[this.trimester()]||"стабильно"; }
}

// ==========================================
// LABOR MANAGER
// ==========================================

const L_STAGES = ["latent","active","transition","pushing","birth","placenta"];
const L_LABELS = { latent:"Латентная", active:"Активная", transition:"Переходная", pushing:"Потуги", birth:"Рождение", placenta:"Плацента" };

class LaborManager {
    constructor(p) { this.p = p; this.l = p.labor; }
    isActive() { return this.l?.active; }
    start() { this.l.active = true; this.l.stage = "latent"; this.l.dilation = 0; this.l.contractionInterval = 20; this.l.contractionDuration = 30; this.l.hoursElapsed = 0; this.l.babiesDelivered = 0; this.l.totalBabies = this.p.pregnancy?.fetusCount || 1; }
    advance() {
        const i = L_STAGES.indexOf(this.l.stage);
        if (i < L_STAGES.length - 1) {
            this.l.stage = L_STAGES[i + 1];
            if (this.l.stage === "active") { this.l.dilation = 5; this.l.contractionInterval = 5; this.l.contractionDuration = 50; this.l.hoursElapsed += 4 + Math.floor(Math.random()*6); }
            if (this.l.stage === "transition") { this.l.dilation = 8; this.l.contractionInterval = 2; this.l.contractionDuration = 70; this.l.hoursElapsed += 2; }
            if (this.l.stage === "pushing") { this.l.dilation = 10; this.l.hoursElapsed += 1; }
        }
    }
    desc() { return { latent:"Лёгкие схватки, раскрытие 0-3 см", active:"Сильные схватки каждые 3-5 мин, 4-7 см", transition:"Пиковые схватки, 7-10 см, тошнота, дрожь", pushing:"Полное раскрытие, потуги", birth:"Рождение ребёнка", placenta:"Рождение плаценты" }[this.l.stage]||""; }
    deliver() { this.l.babiesDelivered++; if (this.l.babiesDelivered >= this.l.totalBabies) this.l.stage = "placenta"; }
    end() { this.l.active = false; this.p.pregnancy.active = false; if (this.p.cycle) { this.p.cycle.enabled = true; this.p.cycle.currentDay = 1; } }
}

// ==========================================
// BABY MANAGER
// ==========================================

class BabyManager {
    constructor(b) { this.b = b; }
    static gen(mother, father) {
        const s = extension_settings[extensionName]; const fp = s.characters[father];
        const sex = Math.random() < 0.5 ? "M" : "F";
        let sec = null;
        if (s.modules.auOverlay && s.auPreset === "omegaverse") { const r = Math.random(); sec = r < 0.25 ? "alpha" : r < 0.75 ? "beta" : "omega"; }
        const nf = [];
        if (s.modules.auOverlay && s.auPreset === "fantasy" && s.auSettings.fantasy.nonHumanFeatures) { if (Math.random() < 0.3) nf.push("заострённые уши"); if (Math.random() < 0.1) nf.push("хвост"); }
        const bw = 3200 + Math.floor(Math.random()*800) - 400;
        return { name: "", sex, secondarySex: sec, birthWeight: mother.pregnancy?.fetusCount > 1 ? Math.round(bw*0.85) : bw, currentWeight: bw, ageDays: 0,
            eyeColor: Math.random() < 0.5 ? (mother.eyeColor||"") : (fp?.eyeColor||""), hairColor: Math.random() < 0.5 ? (mother.hairColor||"") : (fp?.hairColor||""),
            mother: mother.name, father, nonHumanFeatures: nf, state: "новорождённый", birthDate: { ...s.worldDate } };
    }
    age() { const d = this.b.ageDays; if (d < 1) return "новорождённый"; if (d < 7) return d + " дн."; if (d < 30) return Math.floor(d/7) + " нед."; if (d < 365) return Math.floor(d/30) + " мес."; const y = Math.floor(d/365), m = Math.floor((d%365)/30); return m > 0 ? y + " г. " + m + " мес." : y + " г."; }
    milestones() { const d = this.b.ageDays, r = []; if (d>=42) r.push("улыбка"); if (d>=90) r.push("держит голову"); if (d>=180) r.push("сидит"); if (d>=240) r.push("ползает"); if (d>=365) r.push("ходит, слова"); if (d>=730) r.push("бегает, фразы"); return r; }
    update() { this.b.currentWeight = this.b.birthWeight + this.b.ageDays * (this.b.ageDays < 120 ? 30 : this.b.ageDays < 365 ? 15 : 7); if (this.b.ageDays < 28) this.b.state = "новорождённый"; else if (this.b.ageDays < 365) this.b.state = "младенец"; else if (this.b.ageDays < 1095) this.b.state = "малыш"; else this.b.state = "ребёнок"; }
}

// ==========================================
// INTIMACY + DICE
// ==========================================

class IntimacyManager {
    static log(entry) { const s = extension_settings[extensionName]; entry.ts = fmt(s.worldDate); s.intimacyLog.push(entry); if (s.intimacyLog.length > 100) s.intimacyLog = s.intimacyLog.slice(-100); saveSettingsDebounced(); }
    static roll(target, data) {
        const s = extension_settings[extensionName]; const p = s.characters[target]; if (!p) return { result: false, chance: 0, roll: 0 };
        let f = 0.05; if (p.cycle?.enabled) f = new CycleManager(p).fertility();
        const ce = { none:0, condom:0.85, pill:0.91, iud:0.99, withdrawal:0.73 }[p.contraception] || 0;
        if (data.noCon) { /* no reduction */ } else if (data.contra) f *= 0.15; else f *= (1 - ce);
        if (data.ejac === "outside") f *= 0.05;
        if (data.type === "anal" || data.type === "oral") f = 0;
        if (p.pregnancy?.active) f = 0;
        if (p.bioSex === "M" && !(s.modules.auOverlay && s.auPreset === "omegaverse" && s.auSettings.omegaverse.maleOmegaPregnancy && p.secondarySex === "omega")) f = 0;
        const ch = Math.round(clamp(f, 0, 0.95) * 100), r = dice(100), res = r <= ch;
        const entry = { ts: fmt(s.worldDate), target, parts: data.parts || [], chance: ch, roll: r, result: res, contra: data.noCon ? "нет" : (data.contra ? "да" : p.contraception), type: data.type, ejac: data.ejac, auto: data.auto || false };
        s.diceLog.push(entry); if (s.diceLog.length > 50) s.diceLog = s.diceLog.slice(-50); saveSettingsDebounced();
        return entry;
    }
}

// ==========================================
// TIME PARSER
// ==========================================

class TimeParser {
    static parse(msg) {
        const sens = extension_settings[extensionName].timeParserSensitivity; let days = 0;
        const pats = [[/прошл[оа]\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/через\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/спустя\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/прошл[оа]\s+(\d+)\s+(?:недел|нед)/gi,7],[/через\s+(\d+)\s+(?:недел|нед)/gi,7],[/прошл[оа]\s+(\d+)\s+(?:месяц|мес)/gi,30],[/через\s+(\d+)\s+(?:месяц|мес)/gi,30],[/(\d+)\s+(?:days?)\s+(?:later|passed)/gi,1],[/(\d+)\s+(?:weeks?)\s+later/gi,7],[/(\d+)\s+(?:months?)\s+later/gi,30]];
        for (const [re, m] of pats) { let x; while ((x = re.exec(msg)) !== null) days += parseInt(x[1]) * m; }
        if (sens !== "low") { if (/на следующ\w+\s+(?:день|утро)|next\s+(?:day|morning)/i.test(msg)) days += 1; if (/через\s+пару\s+дней|a\s+few\s+days/i.test(msg)) days += 2; if (/на следующ\w+\s+неделе|next\s+week/i.test(msg)) days += 7; }
        if (sens === "high") { if (/прошёл\s+месяц|a\s+month\s+later/i.test(msg)) days += 30; if (/прошла\s+неделя|a\s+week\s+later/i.test(msg)) days += 7; }
        return days > 0 ? days : null;
    }
    static apply(d) { const s = extension_settings[extensionName]; s.worldDate = addDays(s.worldDate, d); TimeParser.advanceAll(d); saveSettingsDebounced(); }
    static advanceAll(days) {
        const s = extension_settings[extensionName];
        Object.values(s.characters).forEach(p => {
            if (!p._enabled) return;
            if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) new CycleManager(p).advance(days);
            if (s.modules.pregnancy && p.pregnancy?.active) new PregnancyManager(p).advanceDay(days);
            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.secondarySex) {
                const hrm = new HeatRutManager(p);
                if (p.secondarySex === "omega") hrm.advanceHeat(days);
                if (p.secondarySex === "alpha") hrm.advanceRut(days);
            }
            if (s.modules.baby && p.babies?.length > 0) p.babies.forEach(b => { b.ageDays += days; new BabyManager(b).update(); });
        });
        saveSettingsDebounced();
    }
}

// ==========================================
// PROMPT INJECTOR
// ==========================================

class PromptInjector {
    static gen() {
        const s = extension_settings[extensionName]; if (!s.promptInjectionEnabled) return "";
        const d = s.promptInjectionDetail, lines = ["[LifeCycle System]", "Date: " + fmt(s.worldDate)];
        Object.entries(s.characters).forEach(([name, p]) => {
            if (!p._enabled) return;
            lines.push("\n--- " + name + " ---");
            lines.push("Sex: " + p.bioSex + (p.secondarySex ? " / " + p.secondarySex : ""));

            if (s.modules.auOverlay && s.auPreset === "omegaverse") {
                const hrm = new HeatRutManager(p);
                if (p.heat?.active) {
                    const ph = HeatRutManager.HEAT_PHASES[hrm.heatPhase()];
                    lines.push("IN HEAT (" + ph + "): Day " + p.heat.currentDay + "/" + p.heat.duration);
                    lines.push("Heat symptoms: " + hrm.heatSymptoms().join(", "));
                } else if (p.secondarySex === "omega") {
                    lines.push("Heat cycle: " + hrm.heatDaysUntilNext() + " days until next heat");
                }
                if (p.rut?.active) {
                    const ph = HeatRutManager.RUT_PHASES[hrm.rutPhase()];
                    lines.push("IN RUT (" + ph + "): Day " + p.rut.currentDay + "/" + p.rut.duration);
                    lines.push("Rut symptoms: " + hrm.rutSymptoms().join(", "));
                } else if (p.secondarySex === "alpha") {
                    lines.push("Rut cycle: " + hrm.rutDaysUntilNext() + " days until next rut");
                }
                if (p.heat?.onSuppressants) lines.push("On suppressants (symptoms reduced)");
            }

            if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
                const cm = new CycleManager(p);
                lines.push("Cycle: Day " + p.cycle.currentDay + "/" + p.cycle.length + " (" + cm.label(cm.phase()) + ")");
                if (d !== "low") { lines.push("Fertility: " + Math.round(cm.fertility()*100) + "%, Libido: " + cm.libido()); const sy = cm.symptoms(); if (sy.length) lines.push("Symptoms: " + sy.join(", ")); }
                if (d === "high") lines.push("Discharge: " + cm.discharge());
            }

            if (s.modules.pregnancy && p.pregnancy?.active) {
                const pm = new PregnancyManager(p);
                lines.push("PREGNANT: Week " + p.pregnancy.week + "/" + p.pregnancy.maxWeeks + " (T" + pm.trimester() + ")");
                lines.push("Size: ~" + pm.fetalSize() + ", Fetuses: " + p.pregnancy.fetusCount);
                if (d !== "low") { lines.push("Symptoms: " + pm.symptoms().join(", ")); lines.push("Movements: " + pm.movements() + ", +Weight: " + pm.weightGain() + "kg"); }
                if (d === "high") { lines.push("Body: " + pm.bodyChanges().join(", ")); lines.push("Emotions: " + pm.emotion()); }
            }

            if (s.modules.labor && p.labor?.active) {
                lines.push("IN LABOR: " + L_LABELS[p.labor.stage] + " (" + p.labor.dilation + "cm)");
                lines.push(new LaborManager(p).desc());
            }

            if (s.modules.baby && p.babies?.length > 0 && d !== "low") {
                p.babies.forEach(b => { const bm = new BabyManager(b); lines.push("Child: " + (b.name||"?") + " (" + (b.sex==="M"?"♂":"♀") + ", " + bm.age() + ")"); });
            }
            if (p.contraception !== "none") lines.push("Contraception: " + p.contraception);
        });

        lines.push("\n[Instructions]");
        lines.push("Reflect all physical states naturally. Heat/rut = show physiological effects. Pregnancy = organic symptoms. Labor = visceral detail. Baby = match developmental stage.");
        lines.push("[/LifeCycle System]");
        return lines.join("\n");
    }
}

// ==========================================
// CONTEXTUAL STATUS WIDGET
// ==========================================

class StatusWidget {
    static generate() {
        const s = extension_settings[extensionName];
        if (!s.enabled || !s.showStatusWidget) return "";
        const chars = Object.entries(s.characters).filter(([_,p]) => p._enabled);
        if (chars.length === 0) return "";

        let html = '<div class="lc-status-widget">';
        html += '<div class="lc-sw-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'\':\'none\';this.querySelector(\'.lc-sw-arrow\').textContent=this.nextElementSibling.style.display===\'none\'?\'▶\':\'▼\'">';
        html += '<span>🌿 LifeCycle</span><span class="lc-sw-arrow">▼</span></div>';
        html += '<div class="lc-sw-body">';
        html += '<div class="lc-sw-date">' + fmt(s.worldDate) + '</div>';

        for (const [name, p] of chars) {
            // Determine which context to show
            const hasLabor = s.modules.labor && p.labor?.active;
            const hasPreg = s.modules.pregnancy && p.pregnancy?.active;
            const hasHeat = s.modules.auOverlay && s.auPreset === "omegaverse" && p.heat?.active;
            const hasRut = s.modules.auOverlay && s.auPreset === "omegaverse" && p.rut?.active;
            const hasCycle = s.modules.cycle && p.cycle?.enabled && !hasPreg;
            const hasBabies = s.modules.baby && p.babies?.length > 0;
            const isOmega = s.modules.auOverlay && s.auPreset === "omegaverse" && p.secondarySex === "omega" && !hasHeat;
            const isAlpha = s.modules.auOverlay && s.auPreset === "omegaverse" && p.secondarySex === "alpha" && !hasRut;

            html += '<div class="lc-sw-char">';
            html += '<div class="lc-sw-char-name">' + name;
            if (p.secondarySex) html += ' <span class="lc-sw-sec-badge">' + p.secondarySex + '</span>';
            html += '</div>';

            // === LABOR (highest priority) ===
            if (hasLabor) {
                const lm = new LaborManager(p);
                html += '<div class="lc-sw-block lc-sw-labor-block">';
                html += '<div class="lc-sw-block-title">🏥 РОДЫ</div>';
                html += '<div class="lc-sw-row">Стадия: <strong>' + L_LABELS[p.labor.stage] + '</strong></div>';
                html += '<div class="lc-sw-row">Раскрытие: ' + p.labor.dilation + '/10 см</div>';
                html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:' + (p.labor.dilation*10) + '%"></div></div>';
                html += '<div class="lc-sw-row">Схватки: каждые ' + p.labor.contractionInterval + ' мин</div>';
                html += '<div class="lc-sw-row lc-sw-desc">' + lm.desc() + '</div>';
                html += '</div>';
            }

            // === PREGNANCY ===
            else if (hasPreg) {
                const pm = new PregnancyManager(p);
                const prog = Math.round((p.pregnancy.week / p.pregnancy.maxWeeks) * 100);
                html += '<div class="lc-sw-block lc-sw-preg-block">';
                html += '<div class="lc-sw-block-title">🤰 БЕРЕМЕННОСТЬ</div>';
                html += '<div class="lc-sw-row">Неделя <strong>' + p.pregnancy.week + '/' + p.pregnancy.maxWeeks + '</strong> · Триместр ' + pm.trimester() + '</div>';
                html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:' + prog + '%"></div></div>';
                html += '<div class="lc-sw-row">Размер плода: ~' + pm.fetalSize() + '</div>';
                html += '<div class="lc-sw-row">Шевеления: ' + pm.movements() + '</div>';
                html += '<div class="lc-sw-row">Прибавка: +' + pm.weightGain() + ' кг</div>';
                const sym = pm.symptoms();
                if (sym.length > 0) html += '<div class="lc-sw-symptoms">' + sym.join(' · ') + '</div>';
                html += '</div>';
            }

            // === HEAT ===
            if (hasHeat) {
                const hrm = new HeatRutManager(p);
                const ph = HeatRutManager.HEAT_PHASES[hrm.heatPhase()];
                html += '<div class="lc-sw-block lc-sw-heat-block">';
                html += '<div class="lc-sw-block-title">🔥 ТЕЧКА — ' + ph + '</div>';
                html += '<div class="lc-sw-row">День ' + p.heat.currentDay + '/' + p.heat.duration + '</div>';
                html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill heat" style="width:' + hrm.heatProgress() + '%"></div></div>';
                const hs = hrm.heatSymptoms();
                if (hs.length > 0) html += '<div class="lc-sw-symptoms">' + hs.join(' · ') + '</div>';
                html += '</div>';
            }

            // === RUT ===
            if (hasRut) {
                const hrm = new HeatRutManager(p);
                const ph = HeatRutManager.RUT_PHASES[hrm.rutPhase()];
                html += '<div class="lc-sw-block lc-sw-rut-block">';
                html += '<div class="lc-sw-block-title">💢 ГОН — ' + ph + '</div>';
                html += '<div class="lc-sw-row">День ' + p.rut.currentDay + '/' + p.rut.duration + '</div>';
                html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill rut" style="width:' + hrm.rutProgress() + '%"></div></div>';
                const rs = hrm.rutSymptoms();
                if (rs.length > 0) html += '<div class="lc-sw-symptoms">' + rs.join(' · ') + '</div>';
                html += '</div>';
            }

            // === HEAT/RUT CYCLE (not active, but tracking) ===
            if (isOmega && !hasPreg && !hasLabor) {
                const hrm = new HeatRutManager(p);
                const daysLeft = hrm.heatDaysUntilNext();
                html += '<div class="lc-sw-block lc-sw-cycle-block">';
                html += '<div class="lc-sw-block-title">🔮 Цикл течки</div>';
                html += '<div class="lc-sw-row">До следующей: ' + daysLeft + ' дн.' + (daysLeft <= 3 ? ' ⚠️' : '') + '</div>';
                html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill heat-cycle" style="width:' + hrm.heatProgress() + '%"></div></div>';
                if (p.heat?.onSuppressants) html += '<div class="lc-sw-row">💊 Супрессанты активны</div>';
                html += '</div>';
            }

            if (isAlpha && !hasPreg && !hasLabor) {
                const hrm = new HeatRutManager(p);
                const daysLeft = hrm.rutDaysUntilNext();
                html += '<div class="lc-sw-block lc-sw-cycle-block">';
                html += '<div class="lc-sw-block-title">⚡ Цикл гона</div>';
                html += '<div class="lc-sw-row">До следующего: ' + daysLeft + ' дн.' + (daysLeft <= 3 ? ' ⚠️' : '') + '</div>';
                html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill rut-cycle" style="width:' + hrm.rutProgress() + '%"></div></div>';
                html += '</div>';
            }

            // === MENSTRUAL CYCLE ===
            if (hasCycle && !hasLabor) {
                const cm = new CycleManager(p);
                const ph = cm.phase();
                const fert = cm.fertility();
                let fc = "low"; if (fert >= 0.2) fc = "peak"; else if (fert >= 0.1) fc = "high"; else if (fert >= 0.05) fc = "med";

                html += '<div class="lc-sw-block lc-sw-cycle-block">';
                html += '<div class="lc-sw-block-title">' + cm.emoji(ph) + ' ' + cm.label(ph) + '</div>';
                html += '<div class="lc-sw-row">День ' + p.cycle.currentDay + '/' + p.cycle.length + ' · Фертильность: <span class="lc-sw-fert ' + fc + '">' + Math.round(fert*100) + '%</span></div>';
                html += '<div class="lc-sw-row">Либидо: ' + cm.libido() + ' · Выделения: ' + cm.discharge() + '</div>';
                const sy = cm.symptoms();
                if (sy.length > 0) html += '<div class="lc-sw-symptoms">' + sy.join(' · ') + '</div>';
                html += '</div>';
            }

            // === BABIES ===
            if (hasBabies) {
                html += '<div class="lc-sw-block lc-sw-baby-block">';
                for (const b of p.babies) {
                    const bm = new BabyManager(b);
                    const ms = bm.milestones();
                    html += '<div class="lc-sw-baby-row">';
                    html += '👶 <strong>' + (b.name || '?') + '</strong> (' + (b.sex === "M" ? '♂' : '♀') + ') — ' + bm.age() + ' · ' + b.state;
                    if (ms.length > 0) html += '<br><span class="lc-sw-milestones">Вехи: ' + ms.join(', ') + '</span>';
                    html += '</div>';
                }
                html += '</div>';
            }

            html += '</div>'; // end sw-char
        }

        // Last dice
        if (s.diceLog.length > 0) {
            const last = s.diceLog[s.diceLog.length - 1];
            html += '<div class="lc-sw-dice">';
            html += '<span class="lc-sw-dice-label">Последний бросок:</span> ';
            html += '<span class="' + (last.result ? 'lc-sw-dice-win' : 'lc-sw-dice-lose') + '">🎲 ' + last.roll + '/' + last.chance + '% — ' + (last.result ? '✅ Зачатие!' : '❌ Нет') + '</span>';
            if (last.auto) html += ' <span class="lc-tag lc-tag-auto">авто</span>';
            html += '</div>';
        }

        html += '</div></div>';
        return html;
    }

    static inject(msgIdx) {
        const s = extension_settings[extensionName];
        if (!s.enabled || !s.showStatusWidget) return;
        const w = StatusWidget.generate();
        if (!w) return;
        setTimeout(() => {
            const el = document.querySelector('#chat .mes[mesid="' + msgIdx + '"]');
            if (!el) return;
            const mt = el.querySelector('.mes_text');
            if (!mt) return;
            mt.querySelectorAll('.lc-status-widget').forEach(x => x.remove());
            mt.insertAdjacentHTML('beforeend', w);
        }, 300);
    }
}

// ==========================================
// DICE POPUP
// ==========================================

function showDicePopup(res, target, isAuto) {
    document.querySelector(".lc-overlay")?.remove();
    document.querySelector(".lc-popup")?.remove();
    const ov = document.createElement("div"); ov.className = "lc-overlay";
    const pop = document.createElement("div"); pop.className = "lc-popup";
    const cls = res.result ? "success" : "fail";
    pop.innerHTML = '<div class="lc-popup-title">🎲 Бросок на зачатие</div>' +
        (isAuto ? '<div class="lc-popup-auto">⚡ Авто-детекция</div>' : '') +
        '<div class="lc-popup-details">' +
            '<div>Цель: <strong>' + target + '</strong></div>' +
            '<div>Тип: ' + res.type + ' | Эякуляция: ' + res.ejac + '</div>' +
            '<div>Контрацепция: ' + res.contra + '</div>' +
            '<div>Шанс: ' + res.chance + '%</div>' +
        '</div>' +
        '<div class="lc-popup-result ' + cls + '">' + res.roll + ' / ' + res.chance + '</div>' +
        '<div class="lc-popup-verdict ' + cls + '">' + (res.result ? '✅ ЗАЧАТИЕ!' : '❌ Нет зачатия') + '</div>' +
        '<div class="lc-popup-actions">' +
            '<button id="lc-d-ok" class="lc-btn lc-btn-success">Принять</button>' +
            '<button id="lc-d-re" class="lc-btn">🎲 Перебросить</button>' +
            '<button id="lc-d-no" class="lc-btn lc-btn-danger">Отмена</button>' +
        '</div>';
    document.body.appendChild(ov); document.body.appendChild(pop);
    document.getElementById("lc-d-ok").addEventListener("click", () => {
        if (res.result) { const p = extension_settings[extensionName].characters[target]; if (p) { new PregnancyManager(p).start(res.parts?.find(x => x !== target)||"?", 1); saveSettingsDebounced(); rebuildUI(); } }
        ov.remove(); pop.remove();
    });
    document.getElementById("lc-d-re").addEventListener("click", () => { ov.remove(); pop.remove(); const nr = IntimacyManager.roll(target, { parts: res.parts, type: res.type, ejac: res.ejac, contra: false, noCon: res.contra === "нет", auto: isAuto }); showDicePopup(nr, target, isAuto); });
    document.getElementById("lc-d-no").addEventListener("click", () => { ov.remove(); pop.remove(); });
    ov.addEventListener("click", () => { ov.remove(); pop.remove(); });
}

// ==========================================
// HTML GENERATION, BIND, RENDER, INIT
// (abbreviated — same structure as v0.4.0
//  but with heat/rut tab added)
// ==========================================

function downloadJSON(d, fn) { const b = new Blob([JSON.stringify(d,null,2)],{type:"application/json"}); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href=u; a.download=fn; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); }
function uploadJSON(cb) { const i = document.createElement("input"); i.type="file"; i.accept=".json"; i.addEventListener("change",e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { try { cb(JSON.parse(ev.target.result)); } catch(er) { toastr.error("JSON: "+er.message); } }; r.readAsText(f); }); i.click(); }

function buildSel(id) {
    const n = Object.keys(extension_settings[extensionName].characters);
    return '<select id="'+id+'" class="lc-select lc-char-select">' + n.map(x => '<option value="'+x+'">'+x+'</option>').join("") + '</select>';
}

function generateHTML() {
    const s = extension_settings[extensionName];
    return '<div id="lifecycle-panel" class="lifecycle-panel' + (s.panelCollapsed ? ' collapsed' : '') + '">' +
        '<div class="lifecycle-header" id="lifecycle-header-toggle"><div class="lifecycle-header-title"><span class="lc-collapse-arrow">' + (s.panelCollapsed ? '▶' : '▼') + '</span><h3>LifeCycle</h3><span class="lc-version">v0.5</span></div><div class="lifecycle-header-actions"><label class="lc-switch"><input type="checkbox" id="lc-enabled" ' + (s.enabled ? 'checked' : '') + '><span class="lc-switch-slider"></span></label></div></div>' +
        '<div class="lifecycle-body" id="lifecycle-body">' +
            '<div class="lc-dashboard"><div id="lc-dashboard-date" class="lc-dashboard-date"></div><div id="lc-dashboard-items"></div></div>' +
            '<div class="lifecycle-tabs">' +
                '<button class="lifecycle-tab active" data-tab="chars"><span class="tab-icon">👥</span>Перс.</button>' +
                '<button class="lifecycle-tab" data-tab="cycle"><span class="tab-icon">🔴</span>Цикл</button>' +
                '<button class="lifecycle-tab" data-tab="heatrut"><span class="tab-icon">🔥</span>Течка</button>' +
                '<button class="lifecycle-tab" data-tab="intim"><span class="tab-icon">💕</span>Интим</button>' +
                '<button class="lifecycle-tab" data-tab="preg"><span class="tab-icon">🤰</span>Берем.</button>' +
                '<button class="lifecycle-tab" data-tab="labor"><span class="tab-icon">🏥</span>Роды</button>' +
                '<button class="lifecycle-tab" data-tab="babies"><span class="tab-icon">👶</span>Дети</button>' +
                '<button class="lifecycle-tab" data-tab="settings"><span class="tab-icon">⚙️</span>Настр.</button>' +
            '</div>' +

            // CHARACTERS TAB
            '<div class="lifecycle-tab-content active" data-tab="chars">' +
                '<div class="lc-btn-group" style="margin-bottom:8px"><button id="lc-sync-chars" class="lc-btn lc-btn-primary">🔄 Синхронизация</button><button id="lc-add-manual" class="lc-btn">+ Вручную</button><button id="lc-reparse-chat" class="lc-btn">📖 Перечитать чат</button></div>' +
                '<div id="lc-char-list"></div>' +
                '<div id="lc-char-editor" class="lc-editor hidden">' +
                    '<div id="lc-editor-title" class="lc-editor-title"></div>' +
                    '<div class="lc-editor-grid">' +
                        '<div class="lc-editor-field"><label>Биол. пол</label><select id="lc-edit-bio-sex" class="lc-select"><option value="F">F</option><option value="M">M</option></select></div>' +
                        '<div class="lc-editor-field"><label>Вторичный пол</label><select id="lc-edit-sec-sex" class="lc-select"><option value="">нет</option><option value="alpha">Alpha</option><option value="beta">Beta</option><option value="omega">Omega</option></select></div>' +
                        '<div class="lc-editor-field"><label>Раса</label><input type="text" id="lc-edit-race" class="lc-input" placeholder="human"></div>' +
                        '<div class="lc-editor-field"><label>Контрацепция</label><select id="lc-edit-contra" class="lc-select"><option value="none">нет</option><option value="condom">презерватив</option><option value="pill">таблетки</option><option value="iud">ВМС</option><option value="withdrawal">ППА</option></select></div>' +
                        '<div class="lc-editor-field"><label>Цвет глаз</label><input type="text" id="lc-edit-eyes" class="lc-input"></div>' +
                        '<div class="lc-editor-field"><label>Цвет волос</label><input type="text" id="lc-edit-hair" class="lc-input"></div>' +
                        '<div class="lc-editor-field"><label>Сложность берем.</label><select id="lc-edit-diff" class="lc-select"><option value="easy">лёгкая</option><option value="normal">обычная</option><option value="severe">тяжёлая</option></select></div>' +
                        '<div class="lc-editor-field"><label>Активен</label><input type="checkbox" id="lc-edit-enabled" checked></div>' +
                        '<div class="lc-editor-field"><label>Цикл вкл.</label><input type="checkbox" id="lc-edit-cycle-on" checked></div>' +
                        '<div class="lc-editor-field"><label>Длина цикла</label><input type="number" id="lc-edit-cycle-len" class="lc-input" min="21" max="45" value="28"></div>' +
                        '<div class="lc-editor-field"><label>Дни менстр.</label><input type="number" id="lc-edit-mens-dur" class="lc-input" min="2" max="8" value="5"></div>' +
                        '<div class="lc-editor-field"><label>Нерегулярность</label><input type="number" id="lc-edit-irreg" class="lc-input" min="0" max="10" value="2"></div>' +
                    '</div>' +
                    '<div class="lc-editor-actions"><button id="lc-editor-save" class="lc-btn lc-btn-success">💾 Сохранить</button><button id="lc-editor-cancel" class="lc-btn">Отмена</button></div>' +
                '</div>' +
            '</div>' +

            // CYCLE TAB
            '<div class="lifecycle-tab-content" data-tab="cycle">' + buildSel("lc-cycle-char") + '<div id="lc-cycle-panel"></div></div>' +

            // HEAT/RUT TAB (NEW!)
            '<div class="lifecycle-tab-content" data-tab="heatrut">' + buildSel("lc-hr-char") + '<div id="lc-hr-panel"></div></div>' +

            // INTIMACY TAB
            '<div class="lifecycle-tab-content" data-tab="intim">' +
                '<div class="lc-section"><div class="lc-row">' + buildSel("lc-intim-target") + buildSel("lc-intim-partner") + '</div>' +
                '<div class="lc-row"><select id="lc-intim-type" class="lc-select"><option value="vaginal">Вагинальный</option><option value="anal">Анальный</option><option value="oral">Оральный</option></select>' +
                '<select id="lc-intim-ejac" class="lc-select"><option value="inside">Внутрь</option><option value="outside">Снаружи</option></select></div>' +
                '<div class="lc-btn-group"><button id="lc-intim-log-btn" class="lc-btn">📝 Записать</button><button id="lc-intim-roll-btn" class="lc-btn lc-btn-primary">🎲 Бросок</button></div></div>' +
                '<div class="lc-section"><div class="lc-section-title"><h4>Лог бросков</h4></div><div id="lc-dice-log" class="lc-scroll"></div></div>' +
                '<div class="lc-section"><div class="lc-section-title"><h4>Лог актов</h4></div><div id="lc-intim-log-list" class="lc-scroll"></div></div>' +
            '</div>' +

            // PREGNANCY TAB
            '<div class="lifecycle-tab-content" data-tab="preg">' + buildSel("lc-preg-char") + '<div id="lc-preg-panel"></div>' +
                '<div class="lc-btn-group" style="margin-top:6px"><button id="lc-preg-advance" class="lc-btn">+1 нед.</button><button id="lc-preg-set-week" class="lc-btn">Уст. нед.</button><button id="lc-preg-to-labor" class="lc-btn lc-btn-danger">→ Роды</button><button id="lc-preg-end" class="lc-btn lc-btn-danger">Прервать</button></div>' +
            '</div>' +

            // LABOR TAB
            '<div class="lifecycle-tab-content" data-tab="labor">' + buildSel("lc-labor-char") + '<div id="lc-labor-panel"></div>' +
                '<div class="lc-btn-group" style="margin-top:6px"><button id="lc-labor-advance" class="lc-btn">→ След. стадия</button><button id="lc-labor-deliver" class="lc-btn lc-btn-success">Родить</button><button id="lc-labor-end" class="lc-btn lc-btn-danger">Завершить</button></div>' +
            '</div>' +

            // BABIES TAB
            '<div class="lifecycle-tab-content" data-tab="babies">' + buildSel("lc-baby-parent") + '<div id="lc-baby-list"></div></div>' +

            // SETTINGS TAB (same as v0.4.0 but with heat/rut cycle settings)
            '<div class="lifecycle-tab-content" data-tab="settings">' +
                '<div class="lc-section"><div class="lc-section-title"><h4>Автоматизация</h4></div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-sync" ' + (s.autoSyncCharacters?'checked':'') + '><span>Авто-синхронизация персонажей</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-parse" ' + (s.autoParseCharInfo?'checked':'') + '><span>Авто-парсинг инфы из карточек</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-parse-chat" ' + (s.parseFullChat?'checked':'') + '><span>Парсить историю чата (дети, берем., течка)</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-detect" ' + (s.autoDetectIntimacy?'checked':'') + '><span>Авто-детекция секс-сцен</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-roll" ' + (s.autoRollOnSex?'checked':'') + '><span>Авто-бросок при незащищённом сексе</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-show-widget" ' + (s.showStatusWidget?'checked':'') + '><span>Виджет после каждого ответа</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-time" ' + (s.autoTimeProgress?'checked':'') + '><span>Авто-время из текста</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-time-confirm" ' + (s.timeParserConfirmation?'checked':'') + '><span>Подтверждение сдвига времени</span></label>' +
                '</div>' +
                '<div class="lc-section"><div class="lc-section-title"><h4>Дата мира</h4></div>' +
                    '<div class="lc-row"><input type="number" id="lc-date-y" class="lc-input" style="width:70px" value="'+s.worldDate.year+'"><input type="number" id="lc-date-m" class="lc-input" style="width:50px" value="'+s.worldDate.month+'"><input type="number" id="lc-date-d" class="lc-input" style="width:50px" value="'+s.worldDate.day+'"><input type="number" id="lc-date-h" class="lc-input" style="width:50px" value="'+s.worldDate.hour+'"></div>' +
                    '<div class="lc-btn-group"><button id="lc-date-apply" class="lc-btn">Применить</button><button id="lc-date-plus1" class="lc-btn">+1д</button><button id="lc-date-plus7" class="lc-btn">+7д</button></div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-date-frozen" ' + (s.worldDate.frozen?'checked':'') + '><span>Заморозить время</span></label>' +
                '</div>' +
                '<div class="lc-section"><div class="lc-section-title"><h4>Модули</h4></div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-cycle" ' + (s.modules.cycle?'checked':'') + '><span>Менструальный цикл</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-preg" ' + (s.modules.pregnancy?'checked':'') + '><span>Беременность</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-labor" ' + (s.modules.labor?'checked':'') + '><span>Роды</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-baby" ' + (s.modules.baby?'checked':'') + '><span>Дети</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-intim" ' + (s.modules.intimacy?'checked':'') + '><span>Интим</span></label>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-au" ' + (s.modules.auOverlay?'checked':'') + '><span>AU (Омегаверс/Фэнтези/Sci-Fi)</span></label>' +
                '</div>' +
                '<div class="lc-section"><div class="lc-section-title"><h4>Инъекция в промпт</h4></div>' +
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-prompt-on" ' + (s.promptInjectionEnabled?'checked':'') + '><span>Включить</span></label>' +
                    '<div class="lc-row"><label>Позиция:</label><select id="lc-prompt-pos" class="lc-select"><option value="system"' + (s.promptInjectionPosition==="system"?" selected":"") + '>System</option><option value="authornote"' + (s.promptInjectionPosition==="authornote"?" selected":"") + '>Author Note</option><option value="endofchat"' + (s.promptInjectionPosition==="endofchat"?" selected":"") + '>End of Chat</option></select></div>' +
                    '<div class="lc-row"><label>Детальность:</label><select id="lc-prompt-detail" class="lc-select"><option value="low"' + (s.promptInjectionDetail==="low"?" selected":"") + '>Низкая</option><option value="medium"' + (s.promptInjectionDetail==="medium"?" selected":"") + '>Средняя</option><option value="high"' + (s.promptInjectionDetail==="high"?" selected":"") + '>Высокая</option></select></div>' +
                '</div>' +
                '<div class="lc-section"><div class="lc-section-title"><h4>AU Пресет</h4></div>' +
                    '<div class="lc-row"><select id="lc-au-preset" class="lc-select"><option value="realism"' + (s.auPreset==="realism"?" selected":"") + '>Реализм</option><option value="omegaverse"' + (s.auPreset==="omegaverse"?" selected":"") + '>Омегаверс</option><option value="fantasy"' + (s.auPreset==="fantasy"?" selected":"") + '>Фэнтези</option><option value="scifi"' + (s.auPreset==="scifi"?" selected":"") + '>Sci-Fi</option></select></div>' +
                    '<div id="lc-au-panel"></div>' +
                '</div>' +
                '<div class="lc-section"><div class="lc-btn-group"><button id="lc-export" class="lc-btn">📤 Экспорт</button><button id="lc-import" class="lc-btn">📥 Импорт</button><button id="lc-reset" class="lc-btn lc-btn-danger">🗑️ Сброс</button></div></div>' +
            '</div>' +
        '</div></div>';
}

// ==========================================
// RENDER FUNCTIONS (cycle, preg, labor, baby, dashboard, heat/rut)
// ==========================================

function rebuildUI() { renderDash(); renderCharList(); renderCycle(); renderHeatRut(); renderPreg(); renderLabor(); renderBabies(); renderDiceLog(); renderIntimLog(); updateSelects(); }

function updateSelects() {
    const n = Object.keys(extension_settings[extensionName].characters);
    const o = n.map(x => '<option value="'+x+'">'+x+'</option>').join("");
    document.querySelectorAll(".lc-char-select").forEach(s => { const v = s.value; s.innerHTML = o; if (n.includes(v)) s.value = v; });
}

function renderDash() {
    const s = extension_settings[extensionName];
    const de = document.getElementById("lc-dashboard-date"), ie = document.getElementById("lc-dashboard-items");
    if (!de || !ie) return;
    de.textContent = "📅 " + fmt(s.worldDate) + (s.worldDate.frozen ? " ❄️" : "");
    let h = "";
    Object.entries(s.characters).forEach(([name, p]) => {
        if (!p._enabled) return;
        let parts = [];
        if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) { const cm = new CycleManager(p); parts.push(cm.emoji(cm.phase()) + cm.label(cm.phase())); }
        if (s.modules.pregnancy && p.pregnancy?.active) parts.push("🤰 Нед." + p.pregnancy.week);
        if (s.modules.labor && p.labor?.active) parts.push("🏥 " + L_LABELS[p.labor.stage]);
        if (p.heat?.active) parts.push("🔥 Течка д." + p.heat.currentDay);
        if (p.rut?.active) parts.push("💢 Гон д." + p.rut.currentDay);
        if (p.babies?.length > 0) parts.push("👶×" + p.babies.length);
        if (parts.length > 0) h += '<div class="lc-dash-item"><span class="lc-dash-name">' + name + '</span> ' + parts.join(' · ') + '</div>';
    });
    ie.innerHTML = h || '<div class="lc-dash-empty">Нет событий</div>';
}

function renderCharList() {
    const s = extension_settings[extensionName], el = document.getElementById("lc-char-list"); if (!el) return;
    let h = "";
    Object.entries(s.characters).forEach(([name, p]) => {
        const sx = p.bioSex === "F" ? "♀" : "♂"; const sec = p.secondarySex ? " · " + p.secondarySex : "";
        h += '<div class="lc-char-card"><div class="lc-char-card-header"><span class="lc-char-card-name">' + name + '</span><span class="lc-char-card-info">' + sx + sec + ' · ' + (p.race||"human") + '</span></div>';
        if (p.eyeColor || p.hairColor) h += '<div class="lc-char-card-details">' + (p.eyeColor ? '<span class="lc-tag">👁️'+p.eyeColor+'</span>' : '') + (p.hairColor ? '<span class="lc-tag">💇'+p.hairColor+'</span>' : '') + '</div>';
        h += '<div class="lc-char-card-actions"><button class="lc-btn lc-btn-sm lc-edit-char" data-char="'+name+'">✏️</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-del-char" data-char="'+name+'">🗑️</button></div></div>';
    });
    el.innerHTML = h || '<div class="lc-empty">Нажмите «Синхронизация»</div>';
}

function renderCycle() {
    const s = extension_settings[extensionName], el = document.getElementById("lc-cycle-panel"), sel = document.getElementById("lc-cycle-char"); if (!el || !sel) return;
    const p = s.characters[sel.value]; if (!p?.cycle?.enabled || p.pregnancy?.active) { el.innerHTML = '<div class="lc-info">Цикл неактивен</div>'; return; }
    const cm = new CycleManager(p), ph = cm.phase(), f = cm.fertility();
    let fc = "low"; if (f >= 0.2) fc = "peak"; else if (f >= 0.1) fc = "high"; else if (f >= 0.05) fc = "med";
    let cal = '<div class="lc-cycle-calendar">';
    for (let d = 1; d <= p.cycle.length; d++) { const ov = Math.round(p.cycle.length - 14); let c = "lc-cal-day"; if (d <= p.cycle.menstruationDuration) c += " mens"; else if (d >= ov-2 && d <= ov+1) c += " ovul"; else if (d < ov-2) c += " foll"; else c += " lut"; if (d === p.cycle.currentDay) c += " today"; cal += '<div class="'+c+'">'+d+'</div>'; }
    cal += '</div>';
    el.innerHTML = cal + '<div class="lc-cycle-info"><div>' + cm.emoji(ph) + ' ' + cm.label(ph) + ' · День ' + p.cycle.currentDay + '/' + p.cycle.length + '</div><div>Фертильность: <span class="lc-fert-badge '+fc+'">' + Math.round(f*100) + '%</span> · Либидо: ' + cm.libido() + '</div><div>Выделения: ' + cm.discharge() + '</div>' + (cm.symptoms().length > 0 ? '<div>Симптомы: ' + cm.symptoms().join(', ') + '</div>' : '') + '</div>';
}

function renderHeatRut() {
    const s = extension_settings[extensionName], el = document.getElementById("lc-hr-panel"), sel = document.getElementById("lc-hr-char"); if (!el || !sel) return;
    const p = s.characters[sel.value];
    if (!p) { el.innerHTML = '<div class="lc-info">Выберите персонажа</div>'; return; }
    if (!s.modules.auOverlay || s.auPreset !== "omegaverse") { el.innerHTML = '<div class="lc-info">Включите AU-оверлей (Омегаверс) в настройках</div>'; return; }
    if (!p.secondarySex || (p.secondarySex !== "omega" && p.secondarySex !== "alpha")) { el.innerHTML = '<div class="lc-info">Персонаж не альфа/омега</div>'; return; }

    const hrm = new HeatRutManager(p);
    let h = '';

    if (p.secondarySex === "omega") {
        const hph = HeatRutManager.HEAT_PHASES[hrm.heatPhase()];
        h += '<div class="lc-section"><div class="lc-section-title"><h4>🔥 Цикл течки</h4></div>';
        h += '<div class="lc-info-row">Фаза: <strong>' + hph + '</strong></div>';
        if (p.heat.active) {
            h += '<div class="lc-info-row">День: ' + p.heat.currentDay + ' / ' + p.heat.duration + '</div>';
            h += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill heat" style="width:' + hrm.heatProgress() + '%"></div></div>';
            h += '<div class="lc-info-row">Интенсивность: ' + p.heat.intensity + '</div>';
        } else {
            h += '<div class="lc-info-row">До следующей: ' + hrm.heatDaysUntilNext() + ' дн.</div>';
            h += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill heat-cycle" style="width:' + hrm.heatProgress() + '%"></div></div>';
        }
        const hs = hrm.heatSymptoms();
        if (hs.length > 0) h += '<div class="lc-info-row">Симптомы: ' + hs.join(', ') + '</div>';
        h += '<div class="lc-btn-group" style="margin-top:6px">';
        h += '<button id="lc-hr-trigger-heat" class="lc-btn">Запустить течку</button>';
        h += '<button id="lc-hr-stop-heat" class="lc-btn">Остановить</button>';
        h += '<button id="lc-hr-suppress" class="lc-btn">' + (p.heat.onSuppressants ? '💊 Снять супрессанты' : '💊 Супрессанты') + '</button>';
        h += '</div></div>';
    }

    if (p.secondarySex === "alpha") {
        const rph = HeatRutManager.RUT_PHASES[hrm.rutPhase()];
        h += '<div class="lc-section"><div class="lc-section-title"><h4>💢 Цикл гона</h4></div>';
        h += '<div class="lc-info-row">Фаза: <strong>' + rph + '</strong></div>';
        if (p.rut.active) {
            h += '<div class="lc-info-row">День: ' + p.rut.currentDay + ' / ' + p.rut.duration + '</div>';
            h += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill rut" style="width:' + hrm.rutProgress() + '%"></div></div>';
        } else {
            h += '<div class="lc-info-row">До следующего: ' + hrm.rutDaysUntilNext() + ' дн.</div>';
            h += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill rut-cycle" style="width:' + hrm.rutProgress() + '%"></div></div>';
        }
        const rs = hrm.rutSymptoms();
        if (rs.length > 0) h += '<div class="lc-info-row">Симптомы: ' + rs.join(', ') + '</div>';
        h += '<div class="lc-btn-group" style="margin-top:6px">';
        h += '<button id="lc-hr-trigger-rut" class="lc-btn">Запустить гон</button>';
        h += '<button id="lc-hr-stop-rut" class="lc-btn">Остановить</button>';
        h += '</div></div>';
    }

    el.innerHTML = h;

    // Bind heat/rut buttons
    document.getElementById("lc-hr-trigger-heat")?.addEventListener("click", () => { p.heat.active = true; p.heat.currentDay = 1; p.heat.intensity = "severe"; saveSettingsDebounced(); renderHeatRut(); renderDash(); });
    document.getElementById("lc-hr-stop-heat")?.addEventListener("click", () => { p.heat.active = false; p.heat.currentDay = 0; p.heat.daysSinceLast = 0; saveSettingsDebounced(); renderHeatRut(); renderDash(); });
    document.getElementById("lc-hr-suppress")?.addEventListener("click", () => { p.heat.onSuppressants = !p.heat.onSuppressants; saveSettingsDebounced(); renderHeatRut(); });
    document.getElementById("lc-hr-trigger-rut")?.addEventListener("click", () => { p.rut.active = true; p.rut.currentDay = 1; p.rut.intensity = "moderate"; saveSettingsDebounced(); renderHeatRut(); renderDash(); });
    document.getElementById("lc-hr-stop-rut")?.addEventListener("click", () => { p.rut.active = false; p.rut.currentDay = 0; p.rut.daysSinceLast = 0; saveSettingsDebounced(); renderHeatRut(); renderDash(); });
}

function renderPreg() {
    const s = extension_settings[extensionName], el = document.getElementById("lc-preg-panel"), sel = document.getElementById("lc-preg-char"); if (!el || !sel) return;
    const p = s.characters[sel.value]; if (!p?.pregnancy?.active) { el.innerHTML = '<div class="lc-info">Беременность неактивна</div>'; return; }
    const pm = new PregnancyManager(p), pr = p.pregnancy, prog = Math.round((pr.week/pr.maxWeeks)*100);
    el.innerHTML = '<div class="lc-preg-header"><span class="lc-preg-week">Неделя '+pr.week+'/'+pr.maxWeeks+'</span><span class="lc-preg-trim">Триместр '+pm.trimester()+'</span></div>' +
        '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:'+prog+'%"></div></div>' +
        '<div class="lc-info-row">Размер: ~'+pm.fetalSize()+' · Плодов: '+pr.fetusCount+'</div>' +
        '<div class="lc-info-row">Отец: '+(pr.father||'?')+'</div>' +
        '<div class="lc-info-row">Шевеления: '+pm.movements()+'</div>' +
        '<div class="lc-info-row">Вес: +'+pm.weightGain()+' кг</div>' +
        '<div class="lc-info-row">Симптомы: '+pm.symptoms().join(', ')+'</div>' +
        '<div class="lc-info-row">Тело: '+pm.bodyChanges().join(', ')+'</div>' +
        '<div class="lc-info-row">Эмоции: '+pm.emotion()+'</div>';
}

function renderLabor() {
    const s = extension_settings[extensionName], el = document.getElementById("lc-labor-panel"), sel = document.getElementById("lc-labor-char"); if (!el || !sel) return;
    const p = s.characters[sel.value]; if (!p?.labor?.active) { el.innerHTML = '<div class="lc-info">Роды неактивны</div>'; return; }
    const lm = new LaborManager(p);
    el.innerHTML = '<div class="lc-info-row lc-labor-stage">Стадия: '+L_LABELS[p.labor.stage]+'</div>' +
        '<div class="lc-info-row">Раскрытие: '+p.labor.dilation+'/10 см</div>' +
        '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:'+(p.labor.dilation*10)+'%"></div></div>' +
        '<div class="lc-info-row">Схватки: каждые '+p.labor.contractionInterval+' мин</div>' +
        '<div class="lc-info-row">Часов: '+p.labor.hoursElapsed.toFixed(1)+'</div>' +
        '<div class="lc-labor-desc">'+lm.desc()+'</div>';
}

function renderBabies() {
    const s = extension_settings[extensionName], el = document.getElementById("lc-baby-list"), sel = document.getElementById("lc-baby-parent"); if (!el || !sel) return;
    const p = s.characters[sel.value]; if (!p?.babies?.length) { el.innerHTML = '<div class="lc-empty">Нет малышей</div>'; return; }
    let h = "";
    p.babies.forEach((b, i) => { const bm = new BabyManager(b); const ms = bm.milestones();
        h += '<div class="lc-baby-card"><div class="lc-baby-header"><span class="lc-baby-name">'+(b.name||'#'+(i+1))+'</span><span class="lc-baby-sex">'+(b.sex==="M"?'♂':'♀')+(b.secondarySex?' · '+b.secondarySex:'')+'</span></div>';
        h += '<div class="lc-baby-details"><div class="lc-info-row">Возраст: '+bm.age()+' · '+b.state+'</div><div class="lc-info-row">Вес: '+(b.currentWeight/1000).toFixed(1)+' кг</div>';
        if (ms.length > 0) h += '<div class="lc-info-row">Вехи: '+ms.join(', ')+'</div>';
        h += '</div><div class="lc-baby-actions"><button class="lc-btn lc-btn-sm lc-baby-rename" data-p="'+sel.value+'" data-i="'+i+'">✏️</button></div></div>';
    });
    el.innerHTML = h;
    el.querySelectorAll(".lc-baby-rename").forEach(btn => btn.addEventListener("click", function() { const baby = s.characters[this.dataset.p]?.babies?.[+this.dataset.i]; if (!baby) return; const n = prompt("Имя:", baby.name); if (n !== null) { baby.name = n; saveSettingsDebounced(); renderBabies(); } }));
}

function renderDiceLog() {
    const s = extension_settings[extensionName], el = document.getElementById("lc-dice-log"); if (!el) return;
    if (s.diceLog.length === 0) { el.innerHTML = '<div class="lc-empty">Нет бросков</div>'; return; }
    el.innerHTML = [...s.diceLog].reverse().slice(0,20).map(d => '<div class="lc-dice-entry '+(d.result?'lc-dice-success':'lc-dice-fail')+'">'+d.ts+' 🎲 '+d.roll+'/'+d.chance+'% '+(d.result?'✅':'❌')+' '+d.target+(d.auto?' <span class="lc-tag lc-tag-auto">авто</span>':'')+'</div>').join("");
}

function renderIntimLog() {
    const s = extension_settings[extensionName], el = document.getElementById("lc-intim-log-list"); if (!el) return;
    if (s.intimacyLog.length === 0) { el.innerHTML = '<div class="lc-empty">Лог пуст</div>'; return; }
    el.innerHTML = [...s.intimacyLog].reverse().slice(0,20).map(e => '<div class="lc-intim-entry">'+e.ts+' '+(e.parts||[]).join('×')+' | '+e.type+' | '+e.ejac+'</div>').join("");
}

function renderAU() {
    const s = extension_settings[extensionName], el = document.getElementById("lc-au-panel"); if (!el) return;
    if (!s.modules.auOverlay || s.auPreset === "realism") { el.innerHTML = ''; return; }
    if (s.auPreset === "omegaverse") {
        const a = s.auSettings.omegaverse;
        el.innerHTML = '<div class="lc-editor-grid">' +
            '<div class="lc-editor-field"><label>Цикл течки (дн.)</label><input type="number" id="lc-au-hc" class="lc-input" value="'+a.heatCycleLength+'"></div>' +
            '<div class="lc-editor-field"><label>Длит. течки</label><input type="number" id="lc-au-hd" class="lc-input" value="'+a.heatDuration+'"></div>' +
            '<div class="lc-editor-field"><label>Бонус ферт.</label><input type="number" id="lc-au-hf" class="lc-input" step="0.05" value="'+a.heatFertilityBonus+'"></div>' +
            '<div class="lc-editor-field"><label>Цикл гона (дн.)</label><input type="number" id="lc-au-rc" class="lc-input" value="'+a.rutCycleLength+'"></div>' +
            '<div class="lc-editor-field"><label>Длит. гона</label><input type="number" id="lc-au-rd" class="lc-input" value="'+a.rutDuration+'"></div>' +
            '<div class="lc-editor-field"><label>Недель берем.</label><input type="number" id="lc-au-pw" class="lc-input" value="'+a.pregnancyWeeks+'"></div>' +
        '</div>' +
        '<label class="lc-checkbox"><input type="checkbox" id="lc-au-knot" '+(a.knotEnabled?'checked':'')+'><span>Узел</span></label>' +
        '<label class="lc-checkbox"><input type="checkbox" id="lc-au-bond" '+(a.bondingEnabled?'checked':'')+'><span>Связь</span></label>' +
        '<label class="lc-checkbox"><input type="checkbox" id="lc-au-suppress" '+(a.suppressantsAvailable?'checked':'')+'><span>Супрессанты</span></label>' +
        '<label class="lc-checkbox"><input type="checkbox" id="lc-au-mpreg" '+(a.maleOmegaPregnancy?'checked':'')+'><span>Мужская беременность (омега)</span></label>';

        // Bind AU inputs
        setTimeout(() => {
            document.getElementById("lc-au-hc")?.addEventListener("change", function() { a.heatCycleLength = parseInt(this.value); saveSettingsDebounced(); });
            document.getElementById("lc-au-hd")?.addEventListener("change", function() { a.heatDuration = parseInt(this.value); saveSettingsDebounced(); });
            document.getElementById("lc-au-hf")?.addEventListener("change", function() { a.heatFertilityBonus = parseFloat(this.value); saveSettingsDebounced(); });
            document.getElementById("lc-au-rc")?.addEventListener("change", function() { a.rutCycleLength = parseInt(this.value); saveSettingsDebounced(); });
            document.getElementById("lc-au-rd")?.addEventListener("change", function() { a.rutDuration = parseInt(this.value); saveSettingsDebounced(); });
            document.getElementById("lc-au-pw")?.addEventListener("change", function() { a.pregnancyWeeks = parseInt(this.value); saveSettingsDebounced(); });
            document.getElementById("lc-au-knot")?.addEventListener("change", function() { a.knotEnabled = this.checked; saveSettingsDebounced(); });
            document.getElementById("lc-au-bond")?.addEventListener("change", function() { a.bondingEnabled = this.checked; saveSettingsDebounced(); });
            document.getElementById("lc-au-suppress")?.addEventListener("change", function() { a.suppressantsAvailable = this.checked; saveSettingsDebounced(); });
            document.getElementById("lc-au-mpreg")?.addEventListener("change", function() { a.maleOmegaPregnancy = this.checked; saveSettingsDebounced(); });
        }, 100);
    }
}

// ==========================================
// CHARACTER EDITOR
// ==========================================

let editChar = null;
function openEditor(name) {
    const s = extension_settings[extensionName], p = s.characters[name]; if (!p) return; editChar = name;
    document.getElementById("lc-char-editor")?.classList.remove("hidden");
    document.getElementById("lc-editor-title").textContent = "✏️ " + name;
    document.getElementById("lc-edit-bio-sex").value = p.bioSex; document.getElementById("lc-edit-sec-sex").value = p.secondarySex || "";
    document.getElementById("lc-edit-race").value = p.race || "human"; document.getElementById("lc-edit-contra").value = p.contraception;
    document.getElementById("lc-edit-eyes").value = p.eyeColor; document.getElementById("lc-edit-hair").value = p.hairColor;
    document.getElementById("lc-edit-diff").value = p.pregnancyDifficulty; document.getElementById("lc-edit-enabled").checked = p._enabled !== false;
    document.getElementById("lc-edit-cycle-on").checked = p.cycle?.enabled; document.getElementById("lc-edit-cycle-len").value = p.cycle?.baseLength || 28;
    document.getElementById("lc-edit-mens-dur").value = p.cycle?.menstruationDuration || 5; document.getElementById("lc-edit-irreg").value = p.cycle?.irregularity || 2;
}
function closeEditor() { editChar = null; document.getElementById("lc-char-editor")?.classList.add("hidden"); }
function saveEditor() {
    if (!editChar) return; const s = extension_settings[extensionName], p = s.characters[editChar]; if (!p) return;
    p.bioSex = document.getElementById("lc-edit-bio-sex").value; p._mBio = true;
    p.secondarySex = document.getElementById("lc-edit-sec-sex").value || null; p._mSec = true;
    p.race = document.getElementById("lc-edit-race").value; p._mRace = true;
    p.contraception = document.getElementById("lc-edit-contra").value;
    p.eyeColor = document.getElementById("lc-edit-eyes").value; p._mEyes = !!p.eyeColor;
    p.hairColor = document.getElementById("lc-edit-hair").value; p._mHair = !!p.hairColor;
    p.pregnancyDifficulty = document.getElementById("lc-edit-diff").value;
    p._enabled = document.getElementById("lc-edit-enabled").checked;
    if (p.cycle) { p.cycle.enabled = document.getElementById("lc-edit-cycle-on").checked; const l = parseInt(document.getElementById("lc-edit-cycle-len").value); if (l >= 21 && l <= 45) { p.cycle.baseLength = l; p.cycle.length = l; } p.cycle.menstruationDuration = parseInt(document.getElementById("lc-edit-mens-dur").value) || 5; p.cycle.irregularity = parseInt(document.getElementById("lc-edit-irreg").value) || 2; }
    saveSettingsDebounced(); closeEditor(); rebuildUI(); toastr.success(editChar + ": сохранено!");
}

// ==========================================
// BIND ALL EVENTS
// ==========================================

function bindAll() {
    const s = extension_settings[extensionName];
    document.getElementById("lifecycle-header-toggle")?.addEventListener("click", function(e) {
        if (e.target.closest(".lc-switch")) return;
        s.panelCollapsed = !s.panelCollapsed;
        document.getElementById("lifecycle-panel")?.classList.toggle("collapsed", s.panelCollapsed);
        this.querySelector(".lc-collapse-arrow").textContent = s.panelCollapsed ? "▶" : "▼";
        saveSettingsDebounced();
    });
    document.getElementById("lc-enabled")?.addEventListener("change", function() { s.enabled = this.checked; saveSettingsDebounced(); });

    // Tabs
    document.querySelectorAll(".lifecycle-tab").forEach(t => t.addEventListener("click", function() {
        document.querySelectorAll(".lifecycle-tab").forEach(x => x.classList.remove("active"));
        document.querySelectorAll(".lifecycle-tab-content").forEach(x => x.classList.remove("active"));
        this.classList.add("active");
        document.querySelector('.lifecycle-tab-content[data-tab="'+this.dataset.tab+'"]')?.classList.add("active");
        rebuildUI();
    }));

    // Characters
    document.getElementById("lc-sync-chars")?.addEventListener("click", () => { syncChars(); rebuildUI(); toastr.success("Синхронизировано!"); });
    document.getElementById("lc-add-manual")?.addEventListener("click", () => { const n = prompt("Имя:"); if (!n?.trim()) return; if (s.characters[n.trim()]) return; s.characters[n.trim()] = makeProfile(n.trim(), false); saveSettingsDebounced(); rebuildUI(); });
    document.getElementById("lc-reparse-chat")?.addEventListener("click", () => { s._chatParsed = false; syncChars(); rebuildUI(); toastr.success("Чат перечитан!"); });
    document.getElementById("lc-char-list")?.addEventListener("click", function(e) {
        const eb = e.target.closest(".lc-edit-char"), db = e.target.closest(".lc-del-char");
        if (eb) openEditor(eb.dataset.char);
        if (db && confirm('Удалить "'+db.dataset.char+'"?')) { delete s.characters[db.dataset.char]; saveSettingsDebounced(); rebuildUI(); }
    });
    document.getElementById("lc-editor-save")?.addEventListener("click", saveEditor);
    document.getElementById("lc-editor-cancel")?.addEventListener("click", closeEditor);

    // Select changes
    document.getElementById("lc-cycle-char")?.addEventListener("change", renderCycle);
    document.getElementById("lc-hr-char")?.addEventListener("change", renderHeatRut);
    document.getElementById("lc-preg-char")?.addEventListener("change", renderPreg);
    document.getElementById("lc-labor-char")?.addEventListener("change", renderLabor);
    document.getElementById("lc-baby-parent")?.addEventListener("change", renderBabies);

    // Intimacy
    document.getElementById("lc-intim-log-btn")?.addEventListener("click", () => {
        const t = document.getElementById("lc-intim-target")?.value, p = document.getElementById("lc-intim-partner")?.value; if (!t) return;
        IntimacyManager.log({ parts: [t,p].filter(Boolean), type: document.getElementById("lc-intim-type")?.value, ejac: document.getElementById("lc-intim-ejac")?.value }); renderIntimLog(); toastr.info("Записано!");
    });
    document.getElementById("lc-intim-roll-btn")?.addEventListener("click", () => {
        const t = document.getElementById("lc-intim-target")?.value; if (!t) return;
        const r = IntimacyManager.roll(t, { parts: [t, document.getElementById("lc-intim-partner")?.value].filter(Boolean), type: document.getElementById("lc-intim-type")?.value, ejac: document.getElementById("lc-intim-ejac")?.value }); showDicePopup(r, t, false); renderDiceLog();
    });

    // Pregnancy
    document.getElementById("lc-preg-advance")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-preg-char")?.value]; if (!p?.pregnancy?.active) return; new PregnancyManager(p).advanceDay(7); saveSettingsDebounced(); renderPreg(); renderDash(); });
    document.getElementById("lc-preg-set-week")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-preg-char")?.value]; if (!p?.pregnancy?.active) return; const w = prompt("Неделя:"); if (w) { p.pregnancy.week = clamp(parseInt(w),1,p.pregnancy.maxWeeks); saveSettingsDebounced(); renderPreg(); } });
    document.getElementById("lc-preg-to-labor")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-preg-char")?.value]; if (!p?.pregnancy?.active) return; new LaborManager(p).start(); saveSettingsDebounced(); renderLabor(); renderDash(); toastr.warning("Роды!"); });
    document.getElementById("lc-preg-end")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-preg-char")?.value]; if (!p?.pregnancy?.active || !confirm("Прервать?")) return; p.pregnancy.active = false; if (p.cycle) p.cycle.enabled = true; saveSettingsDebounced(); renderPreg(); renderDash(); });

    // Labor
    document.getElementById("lc-labor-advance")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-labor-char")?.value]; if (!p?.labor?.active) return; new LaborManager(p).advance(); saveSettingsDebounced(); renderLabor(); });
    document.getElementById("lc-labor-deliver")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-labor-char")?.value]; if (!p?.labor?.active) return; const lm = new LaborManager(p); lm.deliver(); const b = BabyManager.gen(p, p.pregnancy?.father); b.name = prompt("Имя:") || "Малыш"; p.babies.push(b); if (lm.l.babiesDelivered >= lm.l.totalBabies) lm.end(); saveSettingsDebounced(); renderLabor(); renderBabies(); renderDash(); toastr.success("Родился!"); });
    document.getElementById("lc-labor-end")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-labor-char")?.value]; if (!p?.labor?.active || !confirm("Завершить?")) return; new LaborManager(p).end(); saveSettingsDebounced(); renderLabor(); renderDash(); });

    // Settings checkboxes
    const checks = { "lc-auto-sync":"autoSyncCharacters", "lc-auto-parse":"autoParseCharInfo", "lc-parse-chat":"parseFullChat", "lc-auto-detect":"autoDetectIntimacy", "lc-auto-roll":"autoRollOnSex", "lc-show-widget":"showStatusWidget", "lc-auto-time":"autoTimeProgress", "lc-time-confirm":"timeParserConfirmation" };
    for (const [id, key] of Object.entries(checks)) document.getElementById(id)?.addEventListener("change", function() { s[key] = this.checked; saveSettingsDebounced(); });
    const mods = { "lc-mod-cycle":"cycle", "lc-mod-preg":"pregnancy", "lc-mod-labor":"labor", "lc-mod-baby":"baby", "lc-mod-intim":"intimacy" };
    for (const [id, key] of Object.entries(mods)) document.getElementById(id)?.addEventListener("change", function() { s.modules[key] = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-mod-au")?.addEventListener("change", function() { s.modules.auOverlay = this.checked; saveSettingsDebounced(); renderAU(); });
    document.getElementById("lc-prompt-on")?.addEventListener("change", function() { s.promptInjectionEnabled = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-prompt-pos")?.addEventListener("change", function() { s.promptInjectionPosition = this.value; saveSettingsDebounced(); });
    document.getElementById("lc-prompt-detail")?.addEventListener("change", function() { s.promptInjectionDetail = this.value; saveSettingsDebounced(); });
    document.getElementById("lc-au-preset")?.addEventListener("change", function() { s.auPreset = this.value; saveSettingsDebounced(); renderAU(); });

    // Date
    document.getElementById("lc-date-apply")?.addEventListener("click", () => { s.worldDate.year = parseInt(document.getElementById("lc-date-y")?.value)||2025; s.worldDate.month = clamp(parseInt(document.getElementById("lc-date-m")?.value)||1,1,12); s.worldDate.day = clamp(parseInt(document.getElementById("lc-date-d")?.value)||1,1,31); s.worldDate.hour = clamp(parseInt(document.getElementById("lc-date-h")?.value)||12,0,23); saveSettingsDebounced(); renderDash(); });
    document.getElementById("lc-date-plus1")?.addEventListener("click", () => { TimeParser.apply(1); rebuildUI(); });
    document.getElementById("lc-date-plus7")?.addEventListener("click", () => { TimeParser.apply(7); rebuildUI(); });
    document.getElementById("lc-date-frozen")?.addEventListener("change", function() { s.worldDate.frozen = this.checked; saveSettingsDebounced(); });

    // Export/Import/Reset
    document.getElementById("lc-export")?.addEventListener("click", () => downloadJSON(s, "lifecycle_"+Date.now()+".json"));
    document.getElementById("lc-import")?.addEventListener("click", () => uploadJSON(d => { extension_settings[extensionName] = deepMerge(defaultSettings, d); saveSettingsDebounced(); document.getElementById("lifecycle-panel")?.remove(); init(); }));
    document.getElementById("lc-reset")?.addEventListener("click", () => { if (!confirm("СБРОС?")) return; extension_settings[extensionName] = JSON.parse(JSON.stringify(defaultSettings)); saveSettingsDebounced(); document.getElementById("lifecycle-panel")?.remove(); init(); });
}

// ==========================================
// MESSAGE HOOKS
// ==========================================

function onMsg(idx) {
    const s = extension_settings[extensionName]; if (!s.enabled) return;
    const ctx = getContext(); if (!ctx?.chat || idx < 0) return;
    const msg = ctx.chat[idx]; if (!msg?.mes || msg.is_user) return;
    const text = msg.mes;

    if (s.autoSyncCharacters) syncChars();
    if (s.autoTimeProgress && !s.worldDate.frozen) { const d = TimeParser.parse(text); if (d) { if (s.timeParserConfirmation) { if (confirm("LifeCycle: +" + d + " дн.?")) { TimeParser.apply(d); rebuildUI(); } } else { TimeParser.apply(d); rebuildUI(); } } }

    if (s.autoDetectIntimacy && s.modules.intimacy) {
        const det = IntimacyDetector.detect(text, s.characters);
        if (det?.detected) {
            IntimacyManager.log({ parts: det.parts, type: det.type, ejac: det.ejac, auto: true });
            if (s.autoRollOnSex && det.target && det.type === "vaginal" && (det.ejac === "inside" || det.ejac === "unknown")) {
                const r = IntimacyManager.roll(det.target, { parts: det.parts, type: det.type, ejac: det.ejac, contra: det.contra, noCon: det.noCon, auto: true });
                showDicePopup(r, det.target, true);
            }
        }
    }

    if (s.showStatusWidget) StatusWidget.inject(idx);
    renderDash();
}

// ==========================================
// INIT
// ==========================================

async function init() {
    if (!extension_settings[extensionName]) extension_settings[extensionName] = JSON.parse(JSON.stringify(defaultSettings));
    else extension_settings[extensionName] = deepMerge(JSON.parse(JSON.stringify(defaultSettings)), extension_settings[extensionName]);

    document.getElementById("lifecycle-panel")?.remove();
    const target = document.getElementById("extensions_settings2") || document.getElementById("extensions_settings");
    if (target) target.insertAdjacentHTML("beforeend", generateHTML());

    syncChars(); bindAll(); rebuildUI(); renderAU();

    if (eventSource) {
        eventSource.on(event_types.MESSAGE_RECEIVED, onMsg);
        eventSource.on(event_types.CHAT_CHANGED, () => { syncChars(); rebuildUI(); });
        eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (data) => {
            const s = extension_settings[extensionName]; if (!s.enabled || !s.promptInjectionEnabled) return;
            const inj = PromptInjector.gen(); if (!inj) return;
            if (s.promptInjectionPosition === "system" && data.systemPrompt !== undefined) data.systemPrompt += "\n\n" + inj;
            else if (s.promptInjectionPosition === "authornote") data.authorNote = (data.authorNote || "") + "\n\n" + inj;
            else if (data.chat && Array.isArray(data.chat)) data.chat.push({ role: "system", content: inj });
        });
    }
    console.log("[LifeCycle v0.5.0] Loaded!");
}

jQuery(async () => { await init(); });

window.LifeCycle = {
    getSettings: () => extension_settings[extensionName],
    sync: syncChars,
    advanceTime: d => { TimeParser.apply(d); rebuildUI(); },
    rollDice: (c, d) => IntimacyManager.roll(c, d),
    getStatus: n => {
        const p = extension_settings[extensionName].characters[n]; if (!p) return null;
        const r = { name: n };
        if (p.cycle?.enabled) { const cm = new CycleManager(p); r.cycle = { phase: cm.label(cm.phase()), fertility: cm.fertility() }; }
        if (p.pregnancy?.active) r.pregnancy = { week: p.pregnancy.week, trimester: new PregnancyManager(p).trimester() };
        if (p.heat?.active) r.heat = { day: p.heat.currentDay, phase: new HeatRutManager(p).heatPhase() };
        if (p.rut?.active) r.rut = { day: p.rut.currentDay, phase: new HeatRutManager(p).rutPhase() };
        if (p.babies?.length > 0) r.babies = p.babies.map(b => ({ name: b.name, age: new BabyManager(b).age() }));
        return r;
    },
};
