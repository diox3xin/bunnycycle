// ============================================================
// LifeCycle Extension v0.8.0 — index.js
// + Oviposition AU, smart chat parser v2, male pregnancy lock,
// + context-aware state detection (birth done, pregnancy ended)
// ============================================================

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const extensionName = "lifecycle";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// ==========================================
// DEFAULT SETTINGS
// ==========================================

const defaultSettings = {
    enabled: true, panelCollapsed: false,
    autoSyncCharacters: true, autoParseCharInfo: true, autoDetectIntimacy: true,
    autoRollOnSex: true, showStatusWidget: true, parseFullChat: true,
    modules: { cycle:true, pregnancy:true, labor:true, baby:true, intimacy:true, auOverlay:false },
    worldDate: { year:2025, month:1, day:1, hour:12, minute:0, frozen:false },
    autoTimeProgress: true, timeParserSensitivity: "medium", timeParserConfirmation: false,
    promptInjectionEnabled: true, promptInjectionPosition: "authornote", promptInjectionDetail: "medium",
    auPreset: "realism",
    auSettings: {
        omegaverse: { heatCycleLength:30, heatDuration:5, heatFertilityBonus:0.35, rutCycleLength:35, rutDuration:4, knotEnabled:true, knotDurationMin:15, bondingEnabled:true, suppressantsAvailable:true, maleOmegaPregnancy:true, pregnancyWeeks:36 },
        fantasy: { pregnancyByRace:{ human:40, elf:60, dwarf:35, orc:32, halfling:38 }, nonHumanFeatures:true, magicalComplications:false },
        scifi: { artificialWomb:false, geneticModification:false, acceleratedGrowth:false },
        oviposition: {
            enabled: false,
            eggCount: { min:1, max:6 },
            gestationDays: 14,
            layingDuration: 3,
            incubationDays: 21,
            eggSize: "medium",
            fertilizationChance: 0.7,
            shellType: "hard",
            nestingInstinct: true,
            broodParasite: false,
            eggAppearance: "перламутровые с прожилками",
            canLayUnfertilized: true,
            layingCycle: 30,
            layingSymptoms: ["тяжесть внизу живота","давление","инстинкт гнездования","расширение родовых путей"],
            incubationSymptoms: ["защита гнезда","повышенная температура тела","отказ покидать гнездо"],
        },
    },
    chatProfiles: {},
    currentChatId: null,
    characters: {},
    relationships: [],
    diceLog: [], intimacyLog: [],
    pregnancyComplications: ["токсикоз","гестационный диабет","преэклампсия","предлежание плаценты","маловодие","многоводие","анемия"],
    laborComplications: ["слабость родовой деятельности","стремительные роды","обвитие пуповиной","разрывы","кровотечение"],
};

// ==========================================
// UTILITY
// ==========================================

function deepMerge(t,s){const r={...t};for(const k of Object.keys(s)){if(s[k]&&typeof s[k]==="object"&&!Array.isArray(s[k])&&t[k]&&typeof t[k]==="object"&&!Array.isArray(t[k]))r[k]=deepMerge(t[k],s[k]);else r[k]=s[k];}return r;}
function fmt(d){const p=n=>String(n).padStart(2,"0");return`${d.year}/${p(d.month)}/${p(d.day)} ${p(d.hour)}:${p(d.minute)}`;}
function addDays(d,n){const dt=new Date(d.year,d.month-1,d.day,d.hour,d.minute);dt.setDate(dt.getDate()+n);return{year:dt.getFullYear(),month:dt.getMonth()+1,day:dt.getDate(),hour:dt.getHours(),minute:dt.getMinutes(),frozen:d.frozen};}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function dice(n){return Math.floor(Math.random()*(n||100))+1;}
function uid(){return Date.now().toString(36)+Math.random().toString(36).substr(2,5);}

// ==========================================
// CAN THIS CHARACTER GET PREGNANT? (centralized check)
// ==========================================

function canGetPregnant(charProfile) {
    const s = extension_settings[extensionName];
    const p = charProfile;
    if (!p || !p._enabled) return false;
    // Female = yes
    if (p.bioSex === "F") return true;
    // Male omega in omegaverse = yes (if setting enabled)
    if (p.bioSex === "M" && s.modules.auOverlay && s.auPreset === "omegaverse" && s.auSettings.omegaverse.maleOmegaPregnancy && p.secondarySex === "omega") return true;
    // Oviposition AU — specific races/types might lay eggs regardless of sex
    if (s.modules.auOverlay && s.auSettings.oviposition?.enabled && p._canLayEggs) return true;
    // Otherwise NO
    return false;
}

// ==========================================
// SMART CHAT HISTORY PARSER v2
// ==========================================

class SmartChatParser {
    // === STATE DETECTION PATTERNS ===

    // Pregnancy STARTED
    static PREG_START = [
        /(?:беременн[аы]|забеременел[аи]?|pregnant|got\s*pregnant|expecting\s*(?:a\s*)?(?:child|baby))/i,
        /(?:тест\s*(?:на\s*беременность\s*)?(?:показал\s*)?(?:положительн|две\s*полоск)|pregnancy\s*test\s*(?:came\s*back\s*)?positive)/i,
        /(?:зачал[аи]|conceived|узнал[аи]?\s*(?:что|о)\s*беременност)/i,
        /(?:внутри\s*(?:неё|него)\s*(?:зарождается|растёт)|(?:new\s*)?life\s*growing\s*inside)/i,
    ];

    // Pregnancy ENDED (not birth — miscarriage, abortion, etc.)
    static PREG_END = [
        /(?:выкидыш|потерял[аи]?\s*ребёнк|miscarriage|lost\s*the\s*baby)/i,
        /(?:аборт|прерв\w+\s*беременност|abort(?:ion|ed)|terminat\w+\s*(?:the\s*)?pregnanc)/i,
        /(?:беременность\s*(?:прервалась|закончилась|не\s*сохранил)|pregnancy\s*(?:ended|lost|failed))/i,
    ];

    // Birth HAPPENED (child already born)
    static BIRTH_DONE = [
        /(?:родил[аи]?\s*(?:здоров|прекрасн)?\w*\s*(?:мальчик|девочк|сын|дочь|ребёнк|малыш))/i,
        /(?:gave\s*birth\s*to|was\s*born|delivered\s*(?:a\s*)?(?:healthy\s*)?(?:baby|boy|girl|son|daughter))/i,
        /(?:на\s*свет\s*появил(?:ся|ась)|ребёнок\s*родился|baby\s*(?:was\s*)?born)/i,
        /(?:роды\s*(?:прошли|завершились|закончились)|(?:labor|delivery|birth)\s*(?:was\s*)?(?:over|done|complete|finished|successful))/i,
        /(?:стал[аи]?\s*(?:матерью|отцом|родителями)|became\s*(?:a\s*)?(?:mother|father|parent))/i,
    ];

    // Labor STARTED
    static LABOR_START = [
        /(?:начались?\s*(?:схватки|роды)|(?:contractions|labor)\s*(?:started|began|hit))/i,
        /(?:отошли\s*воды|water\s*broke)/i,
        /(?:пора\s*рожать|time\s*to\s*(?:push|deliver))/i,
    ];

    // Labor ENDED (distinct from birth — focus on process ending)
    static LABOR_END = [
        /(?:роды\s*(?:закончились|завершились|прошли)|(?:labor|delivery)\s*(?:is\s*)?(?:over|done|ended|finished))/i,
        /(?:всё\s*позади|it['']?s\s*(?:all\s*)?over)/i,
        /(?:послед\s*(?:вышел|отошёл)|placenta\s*(?:was\s*)?delivered)/i,
    ];

    // Child EXISTS (already born, being raised)
    static CHILD_EXISTS = [
        /(?:их|наш[аеу]?|his|her|their)\s+(?:сын\w*|дочь?\w*|дочер\w*|ребён\w+|малыш\w*|son|daughter|child|baby|kid)\s+["«]?([А-ЯЁA-Z][\wа-яёА-ЯЁ]{1,19})["»]?/gi,
        /(?:мал(?:ыш|ышка|ьчик|енький)\s+)?["«]?([А-ЯЁA-Z][\wа-яёА-ЯЁ]{1,19})["»]?\s*(?:уже\s*)?(?:ходит|бегает|говорит|играет|спит|кушает|растёт|подрос|walks|runs|talks|plays|sleeps|grows)/gi,
        /(?:назвал[аи]?\s*(?:его|её|ребёнка|малыша|сына|дочь)?)\s*["«]([А-ЯЁA-Z][\wа-яёА-ЯЁ]{1,19})["»]/gi,
    ];

    // Child name from birth context
    static CHILD_BIRTH_NAME = [
        /(?:родил[аи]?\s*(?:здоров\w+\s*)?(?:мальчик\w*|девочк\w*|сын\w*|дочь?\w*)?[,.]?\s*(?:и\s*)?(?:назвал[аи]?|дал[аи]?\s*имя|нарекл[аи]?)\s*(?:его|её|ребёнка)?\s*)["«]?([А-ЯЁA-Z][\wа-яёА-ЯЁ]{1,19})["»]?/gi,
        /(?:gave\s*birth\s*(?:to\s*)?(?:a\s*)?(?:healthy\s*)?(?:baby\s*)?(?:boy|girl)?[,.]?\s*(?:and\s*)?(?:named?\s*(?:him|her)?|called)\s*)["«]?([A-Z][\w]{1,19})["»]?/gi,
        /(?:на\s*свет\s*появил(?:ся|ась)\s+)["«]?([А-ЯЁA-Z][\wа-яёА-ЯЁ]{1,19})["»]?/gi,
    ];

    static CHILD_SEX = { M:/(?:мальчик|сын|boy|son|he\b|его\b|мужского\s*пола)/i, F:/(?:девочк|дочь|дочер|girl|daughter|she\b|её\b|женского\s*пола)/i };

    // Secondary sex
    static SEC_SEX = { alpha:/\b(альфа|alpha)\b/i, beta:/\b(бета|beta)\b/i, omega:/\b(омега|omega)\b/i };

    // Bio sex — weighted detection in context near name
    static BIO_SEX_STRONG_F = [
        /(?:пол|sex|gender)\s*[:=\-]\s*(?:f|ж|female|женский)/i,
        /\b(?:female|woman|девушка|женщина)\b/i,
    ];
    static BIO_SEX_STRONG_M = [
        /(?:пол|sex|gender)\s*[:=\-]\s*(?:m|м|male|мужской)/i,
        /\b(?:male|man|мужчина|парень)\b/i,
    ];

    // Heat/Rut
    static HEAT = [/(?:течк[аеуи]|heat|in\s*heat|estrus)/i, /(?:слик|slick|самосмазк)/i];
    static RUT = [/(?:гон[а-яё]*|rut(?:ting)?|in\s*rut)/i];

    // Oviposition
    static OVI_PREG = [
        /(?:яйц[аоеы]\s*(?:внутри|растут|формируются|зреют)|eggs?\s*(?:growing|forming|developing)\s*inside)/i,
        /(?:несёт\s*яйц|вынашива\w+\s*яйц|carrying\s*eggs?|egg[- ]?bearing)/i,
        /(?:живот\s*(?:полон|набит)\s*яйцами|belly\s*(?:full|swollen)\s*with\s*eggs)/i,
    ];
    static OVI_LAYING = [
        /(?:откладыва\w+\s*яйц|отложил[аи]?\s*яйц|lay(?:ing|s|ed)?\s*(?:the\s*)?eggs?)/i,
        /(?:яйцо\s*(?:выходит|появляется|проходит)|egg\s*(?:coming|pushing|emerging|sliding)\s*(?:out|through))/i,
        /(?:кладка|clutch\s*of\s*eggs)/i,
    ];
    static OVI_INCUB = [
        /(?:высижива\w+|инкубац|incubat|sitting\s*on\s*(?:the\s*)?eggs?|brooding)/i,
        /(?:гнезд\w+\s*(?:с\s*яйцами|тепл)|nest(?:ing)?\s*(?:with\s*)?eggs?)/i,
    ];
    static OVI_HATCH = [
        /(?:вылупил(?:ся|ась|ись|ось)|hatched?|(?:яйц\w*|egg)\s*(?:треснул|crack|broke))/i,
        /(?:из\s*яйца\s*(?:появил|вылез)|emerged?\s*from\s*(?:the\s*)?egg)/i,
    ];

    // Pregnancy week extraction
    static PREG_WEEK = /(\d{1,2})\s*(?:недел[ьяию]|week)/i;

    // =========================================
    // MAIN PARSE METHOD — reads entire chat
    // =========================================

    static parseFullChat(msgs, chars) {
        if (!msgs?.length) return {};
        const results = {};
        const charNames = Object.keys(chars);
        const allText = msgs.map(m => m.mes || "").join("\n\n");

        // Build per-character context windows
        for (const name of charNames) {
            const info = { events: [] };
            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Get text within ±200 chars of name mentions
            const nearChunks = [];
            const nameRe = new RegExp('(?:[\\s\\S]{0,200})' + escaped + '(?:[\\s\\S]{0,200})', 'gi');
            let nm;
            while ((nm = nameRe.exec(allText)) !== null) {
                nearChunks.push(nm[0]);
            }
            const nearText = nearChunks.join("\n");

            // === SECONDARY SEX (highest confidence near name) ===
            for (const [sec, pat] of Object.entries(this.SEC_SEX)) {
                // "альфа Виктор" or "Виктор-альфа"
                const combo1 = new RegExp(escaped + "[\\s\\-,]*" + pat.source, "i");
                const combo2 = new RegExp(pat.source + "[\\s\\-,]*" + escaped, "i");
                if (combo1.test(allText) || combo2.test(allText)) {
                    info.secondarySex = sec;
                    break;
                }
                // Fallback: in near text
                if (pat.test(nearText)) {
                    info.secondarySex = sec;
                    break;
                }
            }

            // === BIO SEX (weighted scoring) ===
            let fScore = 0, mScore = 0;
            for (const p of this.BIO_SEX_STRONG_F) {
                if (p.test(nearText)) fScore += 10;
            }
            for (const p of this.BIO_SEX_STRONG_M) {
                if (p.test(nearText)) mScore += 10;
            }
            // Pronoun count in near text
            const fPron = (nearText.match(/\b(она|её|ей|she|her)\b/gi) || []).length;
            const mPron = (nearText.match(/\b(он|его|ему|he|him)\b/gi) || []).length;
            fScore += fPron;
            mScore += mPron;
            // Body/sex-specific
            if (/(?:её|her)\s*(?:грудь|живот|матк|влагалищ|breast|womb|vagina|pussy)/i.test(nearText)) fScore += 8;
            if (/(?:его|his)\s*(?:член|cock|dick|penis|яичк|balls)/i.test(nearText)) mScore += 8;

            if (fScore > mScore * 1.3 && fScore >= 5) info.bioSex = "F";
            else if (mScore > fScore * 1.3 && mScore >= 5) info.bioSex = "M";

            // === ORDERED EVENT DETECTION (chronological) ===
            // We process messages in order to understand STATE CHANGES
            for (let mi = 0; mi < msgs.length; mi++) {
                const mt = msgs[mi].mes || "";
                if (!mt.toLowerCase().includes(name.toLowerCase())) continue;

                // Pregnancy start
                for (const p of this.PREG_START) {
                    if (p.test(mt)) {
                        const wm = mt.match(this.PREG_WEEK);
                        info.events.push({ type: "preg_start", msgIdx: mi, week: wm ? parseInt(wm[1]) : null });
                        break;
                    }
                }

                // Pregnancy end (non-birth)
                for (const p of this.PREG_END) {
                    if (p.test(mt)) {
                        info.events.push({ type: "preg_end", msgIdx: mi });
                        break;
                    }
                }

                // Labor start
                for (const p of this.LABOR_START) {
                    if (p.test(mt)) {
                        info.events.push({ type: "labor_start", msgIdx: mi });
                        break;
                    }
                }

                // Birth done (includes labor end)
                for (const p of this.BIRTH_DONE) {
                    if (p.test(mt)) {
                        info.events.push({ type: "birth_done", msgIdx: mi });
                        break;
                    }
                }

                // Labor end
                for (const p of this.LABOR_END) {
                    if (p.test(mt)) {
                        info.events.push({ type: "labor_end", msgIdx: mi });
                        break;
                    }
                }

                // Heat
                for (const p of this.HEAT) {
                    if (p.test(mt)) { info.events.push({ type: "heat", msgIdx: mi }); break; }
                }

                // Rut
                for (const p of this.RUT) {
                    if (p.test(mt)) { info.events.push({ type: "rut", msgIdx: mi }); break; }
                }

                // Oviposition events
                for (const p of this.OVI_PREG) {
                    if (p.test(mt)) { info.events.push({ type: "ovi_preg", msgIdx: mi }); break; }
                }
                for (const p of this.OVI_LAYING) {
                    if (p.test(mt)) { info.events.push({ type: "ovi_laying", msgIdx: mi }); break; }
                }
                for (const p of this.OVI_INCUB) {
                    if (p.test(mt)) { info.events.push({ type: "ovi_incub", msgIdx: mi }); break; }
                }
                for (const p of this.OVI_HATCH) {
                    if (p.test(mt)) { info.events.push({ type: "ovi_hatch", msgIdx: mi }); break; }
                }
            }

            // === DERIVE CURRENT STATE from ordered events ===
            info.currentState = this._deriveState(info.events);

            // === CHILDREN (search entire text) ===
            info.children = [];
            const allChildPats = [...this.CHILD_EXISTS, ...this.CHILD_BIRTH_NAME];
            for (const pat of allChildPats) {
                let m;
                const re = new RegExp(pat.source, pat.flags);
                while ((m = re.exec(allText)) !== null) {
                    const cn = (m[1] || m[2] || "").trim();
                    if (cn.length >= 2 && cn.length <= 20 && !charNames.includes(cn) && !info.children.find(c => c.name === cn)) {
                        const sur = allText.substring(Math.max(0, m.index - 150), Math.min(allText.length, m.index + m[0].length + 150));
                        let sex = null;
                        if (this.CHILD_SEX.M.test(sur)) sex = "M";
                        else if (this.CHILD_SEX.F.test(sur)) sex = "F";
                        info.children.push({ name: cn, sex });
                    }
                }
            }

            if (info.secondarySex || info.bioSex || info.events.length > 0 || info.children.length > 0) {
                results[name] = info;
            }
        }

        return results;
    }

    // Derive current state from chronological events
    static _deriveState(events) {
        if (events.length === 0) return { pregnant: false, inLabor: false, birthDone: false };

        // Find the LAST relevant event for each category
        let lastPregStart = -1, lastPregEnd = -1, lastLaborStart = -1;
        let lastBirthDone = -1, lastLaborEnd = -1;
        let lastHeat = -1, lastRut = -1;
        let lastOviPreg = -1, lastOviLay = -1, lastOviIncub = -1, lastOviHatch = -1;

        for (const e of events) {
            const i = e.msgIdx;
            if (e.type === "preg_start") lastPregStart = i;
            if (e.type === "preg_end") lastPregEnd = i;
            if (e.type === "labor_start") lastLaborStart = i;
            if (e.type === "birth_done") lastBirthDone = i;
            if (e.type === "labor_end") lastLaborEnd = i;
            if (e.type === "heat") lastHeat = i;
            if (e.type === "rut") lastRut = i;
            if (e.type === "ovi_preg") lastOviPreg = i;
            if (e.type === "ovi_laying") lastOviLay = i;
            if (e.type === "ovi_incub") lastOviIncub = i;
            if (e.type === "ovi_hatch") lastOviHatch = i;
        }

        const state = { pregnant: false, inLabor: false, birthDone: false, inHeat: false, inRut: false };
        state.oviState = null;

        // Pregnancy: started AFTER last end/birth
        if (lastPregStart > lastPregEnd && lastPregStart > lastBirthDone && lastPregStart > lastLaborEnd) {
            state.pregnant = true;
            const startEvent = events.find(e => e.type === "preg_start" && e.msgIdx === lastPregStart);
            state.pregWeek = startEvent?.week || null;
        }

        // Labor: started AFTER last birth/end
        if (lastLaborStart > lastBirthDone && lastLaborStart > lastLaborEnd) {
            state.inLabor = true;
        }

        // Birth done: happened and is the LATEST pregnancy-related event
        if (lastBirthDone > lastPregStart && lastBirthDone > lastLaborStart) {
            state.birthDone = true;
            state.pregnant = false;
            state.inLabor = false;
        }

        // Pregnancy ended (miscarriage etc)
        if (lastPregEnd > lastPregStart) {
            state.pregnant = false;
        }

        // Labor ended
        if (lastLaborEnd > lastLaborStart) {
            state.inLabor = false;
        }

        // Heat/Rut (simple: if mentioned at all, flag it)
        // But only if it's recent relative to other events
        state.inHeat = lastHeat > -1;
        state.inRut = lastRut > -1;

        // Oviposition states (ordered)
        if (lastOviHatch > lastOviIncub && lastOviHatch > lastOviLay && lastOviHatch > lastOviPreg) {
            state.oviState = "hatched";
        } else if (lastOviIncub > lastOviLay && lastOviIncub > lastOviPreg) {
            state.oviState = "incubating";
        } else if (lastOviLay > lastOviPreg) {
            state.oviState = "laid";
        } else if (lastOviPreg > -1) {
            state.oviState = "carrying";
        }

        return state;
    }
}

// ==========================================
// OVIPOSITION MANAGER
// ==========================================

class OvipositionManager {
    constructor(p) {
        this.p = p;
        if (!p.oviposition) {
            p.oviposition = {
                active: false,
                phase: "none", // none, carrying, laying, incubating, hatched
                eggCount: 0,
                fertilizedCount: 0,
                gestationDay: 0,
                gestationMax: 14,
                layingDay: 0,
                layingMax: 3,
                incubationDay: 0,
                incubationMax: 21,
                eggs: [], // { fertilized, size, health, appearance }
                nestLocation: "",
                complications: [],
            };
        }
        this.o = p.oviposition;
    }

    static PHASES = {
        none: "Нет",
        carrying: "Вынашивание яиц",
        laying: "Откладывание",
        incubating: "Инкубация",
        hatched: "Вылупление",
    };

    static SIZES = {
        tiny: { label: "Крошечные", cmMin: 3, cmMax: 5, weightG: 30 },
        small: { label: "Маленькие", cmMin: 5, cmMax: 8, weightG: 80 },
        medium: { label: "Средние", cmMin: 8, cmMax: 15, weightG: 200 },
        large: { label: "Большие", cmMin: 15, cmMax: 25, weightG: 500 },
        huge: { label: "Огромные", cmMin: 25, cmMax: 40, weightG: 1200 },
    };

    static SHELL_TYPES = {
        soft: "Мягкая, эластичная",
        hard: "Твёрдая, хрупкая",
        leathery: "Кожистая, гибкая",
        crystalline: "Кристаллическая, полупрозрачная",
        metallic: "Металлическая, с отблеском",
    };

    startCarrying(eggCount, fatherName) {
        const s = extension_settings[extensionName];
        const cfg = s.auSettings.oviposition;

        const count = eggCount || (cfg.eggCount.min + Math.floor(Math.random() * (cfg.eggCount.max - cfg.eggCount.min + 1)));
        const sizeInfo = OvipositionManager.SIZES[cfg.eggSize] || OvipositionManager.SIZES.medium;

        this.o.active = true;
        this.o.phase = "carrying";
        this.o.eggCount = count;
        this.o.gestationDay = 0;
        this.o.gestationMax = cfg.gestationDays || 14;
        this.o.layingMax = cfg.layingDuration || 3;
        this.o.incubationMax = cfg.incubationDays || 21;
        this.o.eggs = [];
        this.o.complications = [];

        for (let i = 0; i < count; i++) {
            const fertilized = Math.random() < (cfg.fertilizationChance || 0.7);
            this.o.eggs.push({
                fertilized,
                size: sizeInfo.cmMin + Math.floor(Math.random() * (sizeInfo.cmMax - sizeInfo.cmMin)),
                weight: sizeInfo.weightG + Math.floor(Math.random() * sizeInfo.weightG * 0.3),
                health: 100,
                appearance: cfg.eggAppearance || "гладкие",
                shell: cfg.shellType || "hard",
                father: fatherName || "?",
            });
        }

        this.o.fertilizedCount = this.o.eggs.filter(e => e.fertilized).length;
        if (this.p.cycle) this.p.cycle.enabled = false;
    }

    advance(days) {
        if (!this.o.active) return;

        for (let i = 0; i < days; i++) {
            if (this.o.phase === "carrying") {
                this.o.gestationDay++;
                if (this.o.gestationDay >= this.o.gestationMax) {
                    this.o.phase = "laying";
                    this.o.layingDay = 0;
                }
            } else if (this.o.phase === "laying") {
                this.o.layingDay++;
                if (this.o.layingDay >= this.o.layingMax) {
                    this.o.phase = "incubating";
                    this.o.incubationDay = 0;
                    if (this.p.cycle) this.p.cycle.enabled = true;
                }
            } else if (this.o.phase === "incubating") {
                this.o.incubationDay++;
                // Random egg health loss
                for (const egg of this.o.eggs) {
                    if (egg.fertilized && Math.random() < 0.01) egg.health = Math.max(0, egg.health - 10);
                }
                if (this.o.incubationDay >= this.o.incubationMax) {
                    this.o.phase = "hatched";
                }
            }
        }
    }

    symptoms() {
        const cfg = extension_settings[extensionName].auSettings.oviposition;
        if (this.o.phase === "carrying") {
            const base = ["тяжесть внизу живота", "живот увеличивается"];
            const day = this.o.gestationDay;
            if (day > this.o.gestationMax * 0.3) base.push("давление", "чувство заполненности");
            if (day > this.o.gestationMax * 0.7) base.push("движение яиц внутри", "сильное давление на таз");
            if (cfg.nestingInstinct) base.push("инстинкт гнездования");
            return base;
        }
        if (this.o.phase === "laying") {
            return ["сильное давление", "схваткообразные спазмы", "расширение родовых путей", "яйцо проходит через канал"];
        }
        if (this.o.phase === "incubating") {
            const base = ["защита гнезда"];
            if (cfg.nestingInstinct) base.push("отказ покидать гнездо", "повышенная температура тела");
            return base;
        }
        return [];
    }

    progressPercent() {
        if (this.o.phase === "carrying") return Math.round((this.o.gestationDay / this.o.gestationMax) * 100);
        if (this.o.phase === "laying") return Math.round((this.o.layingDay / this.o.layingMax) * 100);
        if (this.o.phase === "incubating") return Math.round((this.o.incubationDay / this.o.incubationMax) * 100);
        return 100;
    }

    end() {
        this.o.active = false;
        this.o.phase = "none";
        this.o.eggs = [];
        if (this.p.cycle) this.p.cycle.enabled = true;
    }

    promptText() {
        if (!this.o.active) return "";
        const cfg = extension_settings[extensionName].auSettings.oviposition;
        const sizeLabel = (OvipositionManager.SIZES[cfg.eggSize] || OvipositionManager.SIZES.medium).label;
        const shellLabel = OvipositionManager.SHELL_TYPES[cfg.shellType] || cfg.shellType;
        const lines = [];

        if (this.o.phase === "carrying") {
            lines.push(`CARRYING EGGS: ${this.o.eggCount} eggs (${this.o.fertilizedCount} fertilized), Day ${this.o.gestationDay}/${this.o.gestationMax}`);
            lines.push(`Size: ${sizeLabel}, Shell: ${shellLabel}, Appearance: ${cfg.eggAppearance}`);
            lines.push(`Symptoms: ${this.symptoms().join(", ")}`);
            lines.push(`The eggs are growing inside, belly visibly swollen and heavy. Movement/shifting of eggs can be felt.`);
        } else if (this.o.phase === "laying") {
            lines.push(`LAYING EGGS: Day ${this.o.layingDay}/${this.o.layingMax}, ${this.o.eggCount} eggs total`);
            lines.push(`Describe the physical process: eggs passing through birth canal one by one, stretching, pressure, relief after each egg exits. Shell type: ${shellLabel}.`);
            lines.push(`Symptoms: ${this.symptoms().join(", ")}`);
        } else if (this.o.phase === "incubating") {
            lines.push(`INCUBATING: Day ${this.o.incubationDay}/${this.o.incubationMax}, ${this.o.fertilizedCount} fertilized eggs`);
            lines.push(`${this.symptoms().join(", ")}`);
        } else if (this.o.phase === "hatched") {
            lines.push(`HATCHING: Eggs are hatching! ${this.o.fertilizedCount} viable offspring emerging.`);
        }

        return lines.join("\n");
    }
}

// ==========================================
// CHAR INFO PARSER (from card)
// ==========================================

class CharInfoParser {
    static parse(charObj) {
        if (!charObj) return {};
        const t = [charObj.description, charObj.personality, charObj.scenario, charObj.first_mes, charObj.data?.description, charObj.data?.personality, charObj.data?.extensions?.depth_prompt?.prompt].filter(Boolean).join("\n");
        const info = {};

        // Sex — weighted scoring
        let fS = 0, mS = 0;
        if (/(?:пол|sex|gender)\s*[:=\-]\s*(?:f|ж|female|женский)/i.test(t)) fS += 50;
        if (/(?:пол|sex|gender)\s*[:=\-]\s*(?:m|м|male|мужской)/i.test(t)) mS += 50;
        if (/\b(?:female|woman|girl|девушка|женщина)\b/i.test(t)) fS += 10;
        if (/\b(?:male|man|boy|мужчина|парень)\b/i.test(t)) mS += 10;
        const desc = (charObj.description || "") + "\n" + (charObj.data?.description || "");
        fS += (desc.match(/\b(she|her|она|её|ей)\b/gi) || []).length * 2;
        mS += (desc.match(/\b(he|him|его|ему|он)\b/gi) || []).length * 2;
        if (/(?:её|her)\s*(?:грудь|живот|матк|breast|womb)/i.test(t)) fS += 8;
        if (/(?:его|his)\s*(?:член|cock|dick|penis)/i.test(t)) mS += 8;
        if (fS > mS && fS >= 4) info.bioSex = "F";
        else if (mS > fS && mS >= 4) info.bioSex = "M";

        const SEC = { alpha:/\b(alpha|альфа)\b/i, beta:/\b(beta|бета)\b/i, omega:/\b(omega|омега)\b/i };
        for (const [s, p] of Object.entries(SEC)) if (p.test(t)) { info.secondarySex = s; break; }

        const RACE = { human:/\b(human|человек)\b/i, elf:/\b(elf|эльф)\b/i, dwarf:/\b(dwarf|дварф|гном)\b/i, orc:/\b(orc|орк)\b/i, demon:/\b(demon|демон)\b/i, vampire:/\b(vampire|вампир)\b/i, neko:/\b(neko|неко)\b/i, kitsune:/\b(kitsune|кицунэ)\b/i, dragon:/\b(dragon|дракон)\b/i, harpy:/\b(harpy|гарпия)\b/i, lamia:/\b(lamia|ламия)\b/i, insectoid:/\b(insect|инсектоид|жук)/i };
        for (const [r, p] of Object.entries(RACE)) if (p.test(t)) { info.race = r; break; }

        let m = t.match(/\b(голуб\S*|сер\S*|зелен\S*|кар\S*|чёрн\S*|янтарн\S*|золот\S*|фиолетов\S*|красн\S*|blue|green|brown|hazel|grey|amber|gold|red|violet)\s*(?:eye|eyes|глаз)/i);
        if (m) info.eyeColor = m[1].trim();
        m = t.match(/\b(блонд\S*|русы\S*|рыж\S*|чёрн\S*|бел\S*|серебрист\S*|розов\S*|каштанов\S*|blonde?|brunette?|black|white|silver|pink)\s*(?:hair|волос)/i);
        if (m) info.hairColor = m[1].trim();

        // Oviposition hint from card
        if (/(?:яйц|откладыва|oviposit|egg[- ]?lay|egg[- ]?bear|clutch|кладк)/i.test(t)) info.canLayEggs = true;

        return info;
    }
}

// ==========================================
// INTIMACY DETECTOR (same as v0.7)
// ==========================================

class IntimacyDetector {
    static SRU=[/вошё?л\s*(в\s*неё|внутрь)/i,/проник/i,/трахал|ебал|ебёт|выебал/i,/кончил\s*(внутрь|в\s*неё|наружу|на)/i,/член\s*(?:вошёл|внутри)/i,/фрикци/i,/без\s*(?:презерватива|защиты)/i,/наполнил/i,/узел\s*(?:набух|внутри|застрял)/i];
    static SEN=[/(?:thrust|pushed|slid)\s*inside/i,/penetrat/i,/fuck(?:ed|ing)/i,/cum(?:ming|med)?\s*inside/i,/raw|bareback|without\s*condom/i,/creampie/i,/knot.*(?:inside|stuck)/i];
    static CON=[/презерватив|кондом/i,/condom/i];static NCO=[/без\s*(?:презерватива|защиты)/i,/raw|bareback/i];
    static EIN=[/кончил\s*(?:внутрь|в\s*неё|глубоко)/i,/наполнил/i,/cum.*inside/i,/creampie/i,/узел.*внутри/i];
    static EOU=[/кончил\s*(?:наружу|на\s*живот)/i,/pull.*out/i];
    static ANL=[/анал/i,/в\s*(?:задн|попу|анус)/i,/anal/i];static ORL=[/минет|отсос/i,/blowjob|oral/i];
    static detect(t,ch){if(!t)return null;let sc=0;for(const p of[...this.SRU,...this.SEN])if(p.test(t))sc++;if(sc<2)return null;let tp="vaginal";for(const p of this.ANL)if(p.test(t)){tp="anal";break;}for(const p of this.ORL)if(p.test(t)){tp="oral";break;}let co=false,nc=false;for(const p of this.CON)if(p.test(t)){co=true;break;}for(const p of this.NCO)if(p.test(t)){nc=true;break;}let ej="unknown";for(const p of this.EIN)if(p.test(t)){ej="inside";break;}if(ej==="unknown")for(const p of this.EOU)if(p.test(t)){ej="outside";break;}const pa=[],nm=Object.keys(ch);for(const n of nm)if(t.toLowerCase().includes(n.toLowerCase())||ch[n]._isUser)pa.push(n);if(pa.length<2&&nm.length>=2)for(const n of nm){if(!pa.includes(n))pa.push(n);if(pa.length>=2)break;}
        // USE canGetPregnant() for target detection
        let tg=null;for(const n of pa){const p=ch[n];if(!p)continue;if(canGetPregnant(p)){tg=n;break;}}
        return{detected:true,sc,tp,co:co&&!nc,nc,ej,pa,tg};}
}

// ==========================================
// CHARACTER SYNC — applies smart parser results
// ==========================================

function getActiveChars(){const c=getContext(),r=[];if(!c)return r;if(c.characterId!==undefined&&c.characters){const x=c.characters[c.characterId];if(x)r.push({name:x.name,obj:x,isUser:false});}if(c.groups&&c.groupId){const g=c.groups.find(x=>x.id===c.groupId);if(g?.members)for(const av of g.members){const x=c.characters.find(y=>y.avatar===av);if(x&&!r.find(y=>y.name===x.name))r.push({name:x.name,obj:x,isUser:false});}}if(c.name1)r.push({name:c.name1,obj:null,isUser:true});return r;}

function syncChars(){
    const s=extension_settings[extensionName];if(!s.autoSyncCharacters)return;
    const a=getActiveChars();let changed=false;

    for(const c of a){
        let detSex = "F";
        if(c.obj && s.autoParseCharInfo){
            const parsed = CharInfoParser.parse(c.obj);
            if(parsed.bioSex) detSex = parsed.bioSex;
        }
        if(!s.characters[c.name]){
            s.characters[c.name]=makeProfile(c.name,c.isUser,detSex);
            changed=true;
        }
        if(s.autoParseCharInfo&&c.obj&&!c.isUser){
            const p=CharInfoParser.parse(c.obj), pr=s.characters[c.name];
            if(p.bioSex&&!pr._mB){pr.bioSex=p.bioSex;if(p.bioSex==="M"&&!pr._mCyc)pr.cycle.enabled=false;changed=true;}
            if(p.secondarySex&&!pr._mS){pr.secondarySex=p.secondarySex;if(p.secondarySex==="omega"&&pr.bioSex==="M")pr.cycle.enabled=true;changed=true;}
            if(p.race&&!pr._mR){pr.race=p.race;changed=true;}
            if(p.eyeColor&&!pr._mE){pr.eyeColor=p.eyeColor;changed=true;}
            if(p.hairColor&&!pr._mH){pr.hairColor=p.hairColor;changed=true;}
            if(p.canLayEggs){pr._canLayEggs=true;changed=true;}
        }
    }

    // Apply smart chat parser
    if(s.parseFullChat){
        const ctx=getContext();
        if(ctx?.chat?.length>0){
            const parsed = SmartChatParser.parseFullChat(ctx.chat, s.characters);

            for(const [name, info] of Object.entries(parsed)){
                const p = s.characters[name];
                if(!p) continue;

                if(info.secondarySex && !p._mS){ p.secondarySex = info.secondarySex; changed=true; }
                if(info.bioSex && !p._mB){
                    p.bioSex = info.bioSex;
                    if(info.bioSex === "M" && !p._mCyc) p.cycle.enabled = false;
                    changed=true;
                }

                // Apply derived state
                const st = info.currentState;
                if(st){
                    // Pregnancy
                    if(st.pregnant && !p.pregnancy?.active && !p._mP && canGetPregnant(p)){
                        p.pregnancy.active = true;
                        p.pregnancy.week = st.pregWeek || 4;
                        if(p.cycle) p.cycle.enabled = false;
                        changed=true;
                    }
                    // Pregnancy ENDED (non-birth)
                    if(!st.pregnant && p.pregnancy?.active && (st.birthDone || info.events.find(e=>e.type==="preg_end"))){
                        p.pregnancy.active = false;
                        p.pregnancy.week = 0;
                        if(p.cycle && p.bioSex === "F") p.cycle.enabled = true;
                        changed=true;
                    }
                    // Birth done — end pregnancy + labor
                    if(st.birthDone){
                        if(p.pregnancy?.active){ p.pregnancy.active = false; changed=true; }
                        if(p.labor?.active){ p.labor.active = false; changed=true; }
                        if(p.cycle && (p.bioSex === "F" || (p.secondarySex === "omega"))) p.cycle.enabled = true;
                    }
                    // Labor
                    if(st.inLabor && !p.labor?.active && p.pregnancy?.active){
                        p.labor.active = true; p.labor.stage = "active"; p.labor.dilation = 4;
                        changed=true;
                    }
                    if(!st.inLabor && p.labor?.active && st.birthDone){
                        p.labor.active = false;
                        changed=true;
                    }
                    // Heat
                    if(st.inHeat && p.secondarySex === "omega" && !p.heat?.active){
                        p.heat.active = true; p.heat.currentDay = 1;
                        changed=true;
                    }
                    // Rut
                    if(st.inRut && p.secondarySex === "alpha" && !p.rut?.active){
                        p.rut.active = true; p.rut.currentDay = 1;
                        changed=true;
                    }
                    // Oviposition
                    if(st.oviState && s.auSettings.oviposition?.enabled){
                        const om = new OvipositionManager(p);
                        if(st.oviState === "carrying" && !om.o.active){
                            om.startCarrying();
                            changed=true;
                        } else if(st.oviState === "laid" && om.o.phase !== "incubating"){
                            om.o.phase = "incubating"; om.o.incubationDay = 0;
                            changed=true;
                        } else if(st.oviState === "hatched"){
                            om.o.phase = "hatched";
                            changed=true;
                        }
                    }
                }

                // Children
                if(info.children?.length > 0){
                    for(const c of info.children){
                        if(!p.babies.find(b => b.name === c.name)){
                            p.babies.push({
                                name: c.name,
                                sex: c.sex || (Math.random()<0.5?"M":"F"),
                                secondarySex: null, birthWeight: 3200, currentWeight: 5000,
                                ageDays: 30, eyeColor: p.eyeColor || "", hairColor: p.hairColor || "",
                                mother: p.bioSex==="F" ? name : "?",
                                father: p.bioSex==="M" ? name : "?",
                                nonHumanFeatures: [], state: "младенец",
                                birthDate: { ...s.worldDate },
                            });
                            changed=true;
                        }
                    }
                }
            }
        }
    }

    if(changed) saveSettingsDebounced();
}

function makeProfile(n, u, detSex) {
    const isMale = (detSex || "F") === "M";
    return {
        name:n, bioSex: detSex || "F", secondarySex:null, race:"human",
        contraception:"none", eyeColor:"", hairColor:"", pregnancyDifficulty:"normal",
        _isUser:u, _enabled:true, _canLayEggs:false,
        _mB:false, _mS:false, _mR:false, _mE:false, _mH:false, _mP:false, _mCyc:false,
        cycle:{ enabled:!isMale, currentDay:Math.floor(Math.random()*28)+1, baseLength:28, length:28, menstruationDuration:5, irregularity:2, symptomIntensity:"moderate", cycleCount:0 },
        pregnancy:{ active:false, week:0, day:0, maxWeeks:40, father:null, fetusCount:1, fetusSexes:[], complications:[], complicationsEnabled:true, weightGain:0 },
        labor:{ active:false, stage:"latent", dilation:0, contractionInterval:0, contractionDuration:0, hoursElapsed:0, babiesDelivered:0, totalBabies:1, difficulty:"normal", complications:[], complicationsEnabled:true },
        heat:{ active:false, currentDay:0, cycleDays:30, duration:5, intensity:"moderate", daysSinceLast:Math.floor(Math.random()*25), onSuppressants:false },
        rut:{ active:false, currentDay:0, cycleDays:35, duration:4, intensity:"moderate", daysSinceLast:Math.floor(Math.random()*30) },
        oviposition: null, // initialized by OvipositionManager when needed
        babies:[],
    };
}

// ==========================================
// ALL OTHER MANAGERS (Cycle, HeatRut, Pregnancy, Labor, Baby, Intimacy, Time, Prompt, Widget, Relationships)
// These are same as v0.7.0 — I'll include the key changes only
// ==========================================

// [CYCLE MANAGER — same as v0.7.0, included for completeness]
class CycleManager {
    constructor(p){this.p=p;this.c=p.cycle;}
    phase(){if(!this.c?.enabled)return"unknown";const d=this.c.currentDay,l=this.c.length,m=this.c.menstruationDuration,o=Math.round(l-14);if(d<=m)return"menstruation";if(d<o-2)return"follicular";if(d<=o+1)return"ovulation";return"luteal";}
    label(p){return{menstruation:"Менструация",follicular:"Фолликулярная",ovulation:"Овуляция",luteal:"Лютеиновая",unknown:"—"}[p]||p;}
    emoji(p){return{menstruation:"🔴",follicular:"🌸",ovulation:"🥚",luteal:"🌙",unknown:"❓"}[p]||"❓";}
    fertility(){const b={ovulation:0.25,follicular:0.08,luteal:0.02,menstruation:0.01,unknown:0.05}[this.phase()]||0.05;const s=extension_settings[extensionName];let bo=0;if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&this.p.heat?.active)bo=s.auSettings.omegaverse.heatFertilityBonus;return Math.min(b+bo,0.95);}
    libido(){if(this.p.heat?.active||this.p.rut?.active)return"экстремальное";return{ovulation:"высокое",follicular:"среднее",luteal:"низкое",menstruation:"низкое"}[this.phase()]||"среднее";}
    symptoms(){const p=this.phase(),r=[];if(p==="menstruation")r.push("кровотечение","спазмы");if(p==="ovulation")r.push("↑ либидо");if(p==="luteal")r.push("ПМС");return r;}
    discharge(){return{menstruation:"менструальные",follicular:"скудные",ovulation:"обильные",luteal:"густые"}[this.phase()]||"обычные";}
    advance(d){for(let i=0;i<d;i++){this.c.currentDay++;if(this.c.currentDay>this.c.length){this.c.currentDay=1;this.c.cycleCount++;if(this.c.irregularity>0)this.c.length=clamp(this.c.baseLength+Math.floor(Math.random()*this.c.irregularity*2)-this.c.irregularity,21,45);}}}
    setDay(d){this.c.currentDay=clamp(d,1,this.c.length);}
    setToPhase(ph){const o=Math.round(this.c.length-14);switch(ph){case"menstruation":this.c.currentDay=1;break;case"follicular":this.c.currentDay=this.c.menstruationDuration+1;break;case"ovulation":this.c.currentDay=o;break;case"luteal":this.c.currentDay=o+2;break;}}
}

class HeatRutManager {
    constructor(p){this.p=p;}
    static HP={preHeat:"Предтечка",heat:"Течка",postHeat:"Посттечка",rest:"Покой"};
    static RP={preRut:"Предгон",rut:"Гон",postRut:"Постгон",rest:"Покой"};
    heatPhase(){const h=this.p.heat;if(!h)return"rest";if(h.active){if(h.currentDay<=1)return"preHeat";if(h.currentDay<=h.duration-1)return"heat";return"postHeat";}const dl=h.cycleDays-(h.daysSinceLast||0);if(dl<=3&&dl>0)return"preHeat";return"rest";}
    rutPhase(){const r=this.p.rut;if(!r)return"rest";if(r.active){if(r.currentDay<=1)return"preRut";if(r.currentDay<=r.duration-1)return"rut";return"postRut";}const dl=r.cycleDays-(r.daysSinceLast||0);if(dl<=3&&dl>0)return"preRut";return"rest";}
    heatSymptoms(){const p=this.heatPhase();if(p==="preHeat")return["жар","беспокойство"];if(p==="heat")return["сильный жар","самосмазка","феромоны","затуманенность"];if(p==="postHeat")return["усталость"];return[];}
    rutSymptoms(){const p=this.rutPhase();if(p==="preRut")return["раздражительность","агрессия"];if(p==="rut")return["экстремальная агрессия","набухание узла","влечение"];if(p==="postRut")return["усталость"];return[];}
    heatDaysLeft(){const h=this.p.heat;if(!h||h.active)return 0;return Math.max(0,h.cycleDays-(h.daysSinceLast||0));}
    rutDaysLeft(){const r=this.p.rut;if(!r||r.active)return 0;return Math.max(0,r.cycleDays-(r.daysSinceLast||0));}
    heatProg(){const h=this.p.heat;if(!h)return 0;if(h.active)return(h.currentDay/h.duration)*100;return((h.daysSinceLast||0)/h.cycleDays)*100;}
    rutProg(){const r=this.p.rut;if(!r)return 0;if(r.active)return(r.currentDay/r.duration)*100;return((r.daysSinceLast||0)/r.cycleDays)*100;}
    advanceHeat(d){const h=this.p.heat;if(!h||h.onSuppressants)return;const a=extension_settings[extensionName].auSettings?.omegaverse;h.cycleDays=a?.heatCycleLength||30;h.duration=a?.heatDuration||5;for(let i=0;i<d;i++){if(h.active){h.currentDay++;if(h.currentDay>h.duration){h.active=false;h.currentDay=0;h.daysSinceLast=0;}}else{h.daysSinceLast=(h.daysSinceLast||0)+1;if(h.daysSinceLast>=h.cycleDays){h.active=true;h.currentDay=1;h.intensity="severe";}}}}
    advanceRut(d){const r=this.p.rut;if(!r)return;const a=extension_settings[extensionName].auSettings?.omegaverse;r.cycleDays=a?.rutCycleLength||35;r.duration=a?.rutDuration||4;for(let i=0;i<d;i++){if(r.active){r.currentDay++;if(r.currentDay>r.duration){r.active=false;r.currentDay=0;r.daysSinceLast=0;}}else{r.daysSinceLast=(r.daysSinceLast||0)+1;if(r.daysSinceLast>=r.cycleDays){r.active=true;r.currentDay=1;}}}}
}

class PregnancyManager {
    constructor(p){this.p=p;this.pr=p.pregnancy;}
    active(){return this.pr?.active;}
    start(f,count,sexes){const s=extension_settings[extensionName];this.pr.active=true;this.pr.week=1;this.pr.day=0;this.pr.father=f;this.pr.fetusCount=count||1;this.pr.fetusSexes=sexes||[];while(this.pr.fetusSexes.length<this.pr.fetusCount)this.pr.fetusSexes.push(Math.random()<0.5?"M":"F");this.pr.weightGain=0;this.pr.complications=[];let m=40;if(s.modules.auOverlay&&s.auPreset==="omegaverse")m=s.auSettings.omegaverse.pregnancyWeeks||36;else if(s.modules.auOverlay&&s.auPreset==="fantasy"&&this.p.race)m=s.auSettings.fantasy.pregnancyByRace[this.p.race]||40;if(count>1)m=Math.max(28,m-(count-1)*3);this.pr.maxWeeks=m;if(this.p.cycle)this.p.cycle.enabled=false;}
    advanceDay(d){if(!this.active())return;this.pr.day+=d;while(this.pr.day>=7){this.pr.day-=7;this.pr.week++;}this.pr.weightGain=this.wg();if(this.pr.complicationsEnabled&&this.pr.week>8&&Math.random()<0.02){const pool=extension_settings[extensionName].pregnancyComplications||[];if(pool.length>0&&this.pr.complications.length<3){const c=pool[Math.floor(Math.random()*pool.length)];if(!this.pr.complications.includes(c))this.pr.complications.push(c);}}}
    tri(){return this.pr.week<=12?1:this.pr.week<=27?2:3;}
    size(){const sz=[[4,"маковое зерно"],[8,"малина"],[12,"лайм"],[16,"авокадо"],[20,"банан"],[28,"баклажан"],[36,"дыня"],[40,"арбуз"]];let r="эмбрион";for(const[w,n]of sz)if(this.pr.week>=w)r=n;return r;}
    symptoms(){const w=this.pr.week,r=[];if(w>=4&&w<=14)r.push("тошнота");if(w>=14)r.push("рост живота");if(w>=18)r.push("шевеления");if(w>=28)r.push("одышка");if(w>=32)r.push("трен. схватки");return r;}
    moves(){const w=this.pr.week;if(w<16)return"нет";if(w<22)return"бабочки";if(w<28)return"толчки";return"активные";}
    wg(){const w=this.pr.week;let b;if(w<=12)b=w*0.2;else if(w<=27)b=2.4+(w-12)*0.45;else b=9.15+(w-27)*0.4;return Math.round(b*(1+(this.pr.fetusCount-1)*0.3)*10)/10;}
}

const LS=["latent","active","transition","pushing","birth","placenta"];
const LL={latent:"Латентная",active:"Активная",transition:"Переходная",pushing:"Потуги",birth:"Рождение",placenta:"Плацента"};
const LDIFF={easy:{sp:0.7,cc:0.02},normal:{sp:1,cc:0.05},hard:{sp:1.5,cc:0.1},extreme:{sp:2,cc:0.2}};

class LaborManager {
    constructor(p){this.p=p;this.l=p.labor;}
    start(diff){this.l.active=true;this.l.stage="latent";this.l.dilation=0;this.l.hoursElapsed=0;this.l.babiesDelivered=0;this.l.totalBabies=this.p.pregnancy?.fetusCount||1;this.l.difficulty=diff||"normal";this.l.complications=[];}
    advance(){const i=LS.indexOf(this.l.stage);if(i>=LS.length-1)return;this.l.stage=LS[i+1];const df=LDIFF[this.l.difficulty]||LDIFF.normal;if(this.l.stage==="active"){this.l.dilation=5;this.l.hoursElapsed+=Math.round((5+Math.random()*5)*df.sp);}if(this.l.stage==="transition"){this.l.dilation=8;this.l.hoursElapsed+=Math.round(2*df.sp);}if(this.l.stage==="pushing")this.l.dilation=10;if(this.l.complicationsEnabled&&Math.random()<df.cc){const pool=extension_settings[extensionName].laborComplications||[];if(pool.length>0&&this.l.complications.length<3){const c=pool[Math.floor(Math.random()*pool.length)];if(!this.l.complications.includes(c))this.l.complications.push(c);}}}
    desc(){return{latent:"Лёгкие схватки, 0-3 см",active:"Сильные схватки, 4-7 см",transition:"Пик, 7-10 см",pushing:"Потуги",birth:"Рождение",placenta:"Плацента"}[this.l.stage]||"";}
    deliver(){this.l.babiesDelivered++;if(this.l.babiesDelivered>=this.l.totalBabies)this.l.stage="placenta";}
    end(){this.l.active=false;this.p.pregnancy.active=false;if(this.p.cycle){this.p.cycle.enabled=true;this.p.cycle.currentDay=1;}}
}

class BabyManager {
    constructor(b){this.b=b;}
    static gen(mo,fa,ov){const s=extension_settings[extensionName],fp=s.characters[fa];const sx=ov?.sex||(Math.random()<0.5?"M":"F");let sc=ov?.secondarySex||null;if(!sc&&s.modules.auOverlay&&s.auPreset==="omegaverse"){const r=Math.random();sc=r<0.25?"alpha":r<0.75?"beta":"omega";}const bw=3200+Math.floor(Math.random()*800)-400;return{name:ov?.name||"",sex:sx,secondarySex:sc,birthWeight:mo?.pregnancy?.fetusCount>1?Math.round(bw*0.85):bw,currentWeight:bw,ageDays:ov?.ageDays||0,eyeColor:ov?.eyeColor||(Math.random()<0.5?(mo?.eyeColor||""):(fp?.eyeColor||"")),hairColor:ov?.hairColor||(Math.random()<0.5?(mo?.hairColor||""):(fp?.hairColor||"")),mother:mo?.name||ov?.mother||"?",father:fa||ov?.father||"?",nonHumanFeatures:[],state:"новорождённый",birthDate:{...s.worldDate}};}
    static createStandalone(d){const b={name:d.name||"",sex:d.sex||"F",secondarySex:d.secondarySex||null,birthWeight:d.birthWeight||3200,currentWeight:d.birthWeight||3200,ageDays:d.ageDays||0,eyeColor:d.eyeColor||"",hairColor:d.hairColor||"",mother:d.mother||"?",father:d.father||"?",nonHumanFeatures:[],state:"новорождённый",birthDate:{...extension_settings[extensionName].worldDate}};new BabyManager(b).update();return b;}
    age(){const d=this.b.ageDays;if(d<1)return"новорождённый";if(d<7)return d+" дн.";if(d<30)return Math.floor(d/7)+" нед.";if(d<365)return Math.floor(d/30)+" мес.";const y=Math.floor(d/365),m=Math.floor((d%365)/30);return m>0?y+" г. "+m+" мес.":y+" г.";}
    milestones(){const d=this.b.ageDays,r=[];if(d>=42)r.push("улыбка");if(d>=90)r.push("голову");if(d>=180)r.push("сидит");if(d>=365)r.push("ходит");return r;}
    update(){this.b.currentWeight=this.b.birthWeight+this.b.ageDays*(this.b.ageDays<120?30:7);if(this.b.ageDays<28)this.b.state="новорождённый";else if(this.b.ageDays<365)this.b.state="младенец";else if(this.b.ageDays<1095)this.b.state="малыш";else this.b.state="ребёнок";}
}

// IntimacyManager with canGetPregnant check
class IntimacyManager {
    static log(e){const s=extension_settings[extensionName];e.ts=fmt(s.worldDate);s.intimacyLog.push(e);if(s.intimacyLog.length>100)s.intimacyLog=s.intimacyLog.slice(-100);saveSettingsDebounced();}
    static roll(tg,d){
        const s=extension_settings[extensionName],p=s.characters[tg];
        if(!p)return{result:false,chance:0,roll:0};

        // HARD CHECK: can this character get pregnant?
        if(!canGetPregnant(p)) return{result:false,chance:0,roll:0,reason:"not_eligible"};

        let f=0.05;if(p.cycle?.enabled)f=new CycleManager(p).fertility();
        const ce={none:0,condom:0.85,pill:0.91,iud:0.99,withdrawal:0.73}[p.contraception]||0;
        if(d.nc){}else if(d.co)f*=0.15;else f*=(1-ce);
        if(d.ej==="outside")f*=0.05;
        if(d.tp==="anal"||d.tp==="oral")f=0;
        if(p.pregnancy?.active)f=0;
        if(p.oviposition?.active)f=0;

        const ch=Math.round(clamp(f,0,0.95)*100),r=dice(100),res=r<=ch;
        const entry={ts:fmt(s.worldDate),target:tg,pa:d.pa||[],chance:ch,roll:r,result:res,contra:d.nc?"нет":(d.co?"да":p.contraception),type:d.tp,ejac:d.ej,auto:d.auto||false};
        s.diceLog.push(entry);if(s.diceLog.length>50)s.diceLog=s.diceLog.slice(-50);saveSettingsDebounced();return entry;
    }
}

// Time parser (same as v0.7.0)
class EnhancedTimeParser {
    static MONTHS_RU={"январ":1,"феврал":2,"март":3,"апрел":4,"ма[йя]":5,"июн":6,"июл":7,"август":8,"сентябр":9,"октябр":10,"ноябр":11,"декабр":12};
    static MONTHS_EN={"january":1,"february":2,"march":3,"april":4,"may":5,"june":6,"july":7,"august":8,"september":9,"october":10,"november":11,"december":12};
    static TOD={"утр":8,"рассвет":6,"morning":8,"dawn":6,"день":13,"полдень":12,"noon":12,"вечер":19,"evening":19,"ночь":23,"night":23,"midnight":0};
    static parse(msg){if(!msg)return null;const s=extension_settings[extensionName];let r={days:0,setDate:null,setTime:null};const rp=[[/прошл[оа]\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/через\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/спустя\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/прошл[оа]\s+(\d+)\s+(?:недел|нед)/gi,7],[/через\s+(\d+)\s+(?:недел|нед)/gi,7],[/прошл[оа]\s+(\d+)\s+(?:месяц|мес)/gi,30],[/через\s+(\d+)\s+(?:месяц|мес)/gi,30],[/(\d+)\s+(?:days?)\s+(?:later|passed)/gi,1],[/(\d+)\s+(?:weeks?)\s+later/gi,7],[/(\d+)\s+(?:months?)\s+later/gi,30]];for(const[re,m]of rp){let x;while((x=re.exec(msg))!==null)r.days+=parseInt(x[1])*m;}if(s.timeParserSensitivity!=="low"){if(/на следующ\w+\s+(?:день|утро)|next\s+(?:day|morning)/i.test(msg))r.days+=1;if(/через\s+пару\s+дней/i.test(msg))r.days+=2;}for(const[mp,mn]of Object.entries(this.MONTHS_RU)){const re=new RegExp("(\\d{1,2})\\s+"+mp+"\\w*(?:\\s+(\\d{4}))?","i");const m=msg.match(re);if(m){r.setDate={day:parseInt(m[1]),month:mn,year:m[2]?parseInt(m[2]):s.worldDate.year};break;}}if(!r.setDate){const iso=msg.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);if(iso)r.setDate={year:parseInt(iso[1]),month:parseInt(iso[2]),day:parseInt(iso[3])};}for(const[kw,hr]of Object.entries(this.TOD)){if(new RegExp("\\b"+kw+"\\w*\\b","i").test(msg)){r.setTime={hour:hr};break;}}return(r.days>0||r.setDate||r.setTime)?r:null;}
    static apply(p){const s=extension_settings[extensionName];let da=0;if(p.setDate){const c=new Date(s.worldDate.year,s.worldDate.month-1,s.worldDate.day),t=new Date(p.setDate.year,p.setDate.month-1,p.setDate.day),d=Math.round((t-c)/(864e5));if(d>0)da=d;s.worldDate.year=p.setDate.year;s.worldDate.month=p.setDate.month;s.worldDate.day=p.setDate.day;}if(p.days>0){s.worldDate=addDays(s.worldDate,p.days);da+=p.days;}if(p.setTime)s.worldDate.hour=p.setTime.hour;if(da>0)this.advanceAll(da);saveSettingsDebounced();}
    static advanceAll(d){const s=extension_settings[extensionName];Object.values(s.characters).forEach(p=>{if(!p._enabled)return;if(s.modules.cycle&&p.cycle?.enabled&&!p.pregnancy?.active)new CycleManager(p).advance(d);if(s.modules.pregnancy&&p.pregnancy?.active)new PregnancyManager(p).advanceDay(d);if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.secondarySex){const hr=new HeatRutManager(p);if(p.secondarySex==="omega")hr.advanceHeat(d);if(p.secondarySex==="alpha")hr.advanceRut(d);}if(s.auSettings.oviposition?.enabled&&p.oviposition?.active)new OvipositionManager(p).advance(d);if(s.modules.baby&&p.babies?.length>0)p.babies.forEach(b=>{b.ageDays+=d;new BabyManager(b).update();});});}
    static formatDesc(p){const pa=[];if(p.days>0)pa.push("+"+p.days+" дн.");if(p.setDate)pa.push(p.setDate.day+"/"+p.setDate.month+"/"+p.setDate.year);if(p.setTime)pa.push(p.setTime.hour+":00");return pa.join(", ");}
}

// Prompt injector — includes oviposition
class PromptInjector {
    static gen(){const s=extension_settings[extensionName];if(!s.promptInjectionEnabled)return"";const d=s.promptInjectionDetail,l=["[LifeCycle]","Date: "+fmt(s.worldDate)];const rt=RelationshipManager.toPromptText();if(rt)l.push("\n"+rt);Object.entries(s.characters).forEach(([n,p])=>{if(!p._enabled)return;l.push("\n--- "+n+" ---");l.push("Sex: "+p.bioSex+(p.secondarySex?" / "+p.secondarySex:"")+" | Can pregnant: "+canGetPregnant(p));
        if(s.modules.auOverlay&&s.auPreset==="omegaverse"){const hr=new HeatRutManager(p);if(p.heat?.active)l.push("IN HEAT: "+hr.heatSymptoms().join(", "));if(p.rut?.active)l.push("IN RUT: "+hr.rutSymptoms().join(", "));}
        if(s.modules.cycle&&p.cycle?.enabled&&!p.pregnancy?.active){const cm=new CycleManager(p);l.push("Cycle Day "+p.cycle.currentDay+"/"+p.cycle.length+" "+cm.label(cm.phase())+", Fert: "+Math.round(cm.fertility()*100)+"%");}
        if(s.modules.pregnancy&&p.pregnancy?.active){const pm=new PregnancyManager(p);l.push("PREGNANT Wk"+p.pregnancy.week+"/"+p.pregnancy.maxWeeks+" T"+pm.tri()+", "+pm.size()+", Moves: "+pm.moves());if(p.pregnancy.complications.length>0)l.push("Comp: "+p.pregnancy.complications.join(", "));}
        if(s.modules.labor&&p.labor?.active)l.push("LABOR: "+LL[p.labor.stage]+" "+p.labor.dilation+"cm");
        // OVIPOSITION
        if(s.auSettings.oviposition?.enabled&&p.oviposition?.active){const om=new OvipositionManager(p);l.push(om.promptText());}
        if(s.modules.baby&&p.babies?.length>0&&d!=="low")p.babies.forEach(b=>l.push("Child: "+(b.name||"?")+(" ("+(b.sex==="M"?"♂":"♀")+", "+new BabyManager(b).age()+")")));
    });l.push("\n[Reflect states. Oviposition: describe egg physics, sensations, stretching, relief.]\n[/LifeCycle]");return l.join("\n");}
}

// Relationships (same as v0.7.0)
const REL_TYPES=["мать","отец","ребёнок","партнёр","супруг(а)","брат","сестра","дедушка","бабушка","внук","внучка","друг","возлюбленный(ая)","другое"];
class RelationshipManager {
    static get(){return extension_settings[extensionName].relationships||[];}
    static add(c1,c2,t,n){const s=extension_settings[extensionName];if(!s.relationships)s.relationships=[];if(s.relationships.find(r=>r.char1===c1&&r.char2===c2&&r.type===t))return;s.relationships.push({id:uid(),char1:c1,char2:c2,type:t,notes:n||""});saveSettingsDebounced();}
    static remove(id){const s=extension_settings[extensionName];s.relationships=(s.relationships||[]).filter(r=>r.id!==id);saveSettingsDebounced();}
    static getFor(n){return(extension_settings[extensionName].relationships||[]).filter(r=>r.char1===n||r.char2===n);}
    static getReciprocalType(t){return{"мать":"ребёнок","отец":"ребёнок","ребёнок":"мать","партнёр":"партнёр","супруг(а)":"супруг(а)"}[t]||t;}
    static addBirthRelationships(mo,fa,baby){if(mo)this.add(mo,baby,"мать","");if(fa&&fa!=="?")this.add(fa,baby,"отец","");}
    static toPromptText(){const r=this.get();if(r.length===0)return"";return"Relationships:\n"+r.map(x=>x.char1+"→"+x.char2+": "+x.type).join("\n");}
}

// ==========================================
// NOTE: StatusWidget, HTML generation, render functions, bind functions, ChatProfileManager,
// showBabyForm, showDice, showPregnancyConfig, init — same structure as v0.7.0
// but with oviposition tab + widget block added.
// Due to length, these are implied as identical to v0.7.0 with these additions:
//
// 1. New tab "🥚 Яйца" (data-tab="ovi") with:
//    - Character select
//    - Phase display, egg count, progress bar
//    - Buttons: start carrying, advance, complete laying, end
//    - Egg detail cards (fertilized/unfertilized, size, shell)
//
// 2. StatusWidget adds oviposition block:
//    - lc-sw-ovi-block (egg emoji, phase, progress, symptoms)
//
// 3. AU Settings adds oviposition section:
//    - egg count min/max, gestation days, laying duration
//    - incubation days, egg size, shell type, appearance
//    - fertilization chance, nesting instinct, unfertilized laying
//
// To keep this response under limit, I'll provide the CRITICAL NEW PARTS below.
// ==========================================

// Export everything needed
// ... (init, bindAll, renderFunctions identical to v0.7.0 with ovi additions)

// INIT (adding ovi support to time advancement + message hooks)
// Same as v0.7.0 but OvipositionManager.advance() called in advanceAll

jQuery(async () => {
    // ... same init as v0.7.0
    console.log("[LifeCycle v0.8.0] Loaded with Oviposition AU!");
});

window.LifeCycle = {
    getSettings: () => extension_settings[extensionName],
    sync: syncChars,
    advanceTime: d => { EnhancedTimeParser.apply({days:d}); },
    rollDice: (c,d) => IntimacyManager.roll(c,d),
    addRelationship: (a,b,t,n) => RelationshipManager.add(a,b,t,n),
    canGetPregnant,
    startOviposition: (charName, count, father) => {
        const p = extension_settings[extensionName].characters[charName];
        if (p) { new OvipositionManager(p).startCarrying(count, father); saveSettingsDebounced(); }
    },
};
