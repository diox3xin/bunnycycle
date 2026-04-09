// BunnyCycle v1.0.0 — Full index.js
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const EXT = "bunnycycle";

// ========================
// DEFAULTS
// ========================
const DEFAULTS = {
    enabled: true,
    panelCollapsed: false,
    autoSyncCharacters: true,
    autoParseCharInfo: true,
    autoDetectIntimacy: true,
    autoRollOnSex: true,
    showStatusWidget: true,
    parseFullChat: true,
    useLLMParsing: true,
    modules: {
        cycle: true,
        pregnancy: true,
        labor: true,
        baby: true,
        intimacy: true,
        auOverlay: false
    },
    worldDate: {
        year: 2025,
        month: 1,
        day: 1,
        hour: 12,
        minute: 0,
        frozen: false
    },
    autoTimeProgress: true,
    promptInjectionEnabled: true,
    promptInjectionPosition: "authornote",
    auPreset: "realism",
    auSettings: {
        omegaverse: {
            heatCycleLength: 30,
            heatDuration: 5,
            heatFertilityBonus: 0.35,
            rutCycleLength: 35,
            rutDuration: 4,
            knotEnabled: true,
            bondingEnabled: true,
            suppressantsAvailable: true,
            maleOmegaPregnancy: true,
            pregnancyWeeks: 36
        },
        fantasy: {
            pregnancyByRace: { human: 40, elf: 60, dwarf: 35, orc: 32 }
        },
        oviposition: {
            enabled: false,
            eggCountMin: 1,
            eggCountMax: 6,
            gestationDays: 14,
            layingDuration: 3,
            incubationDays: 21,
            fertilizationChance: 0.7,
            shellType: "hard"
        }
    },
    chatProfiles: {},
    currentChatId: null,
    characters: {},
    relationships: [],
    diceLog: [],
    intimacyLog: []
};

// ========================
// UTILITIES
// ========================
function deepMerge(target, source) {
    var result = {};
    var keys = Object.keys(target);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        result[k] = target[k];
    }
    var skeys = Object.keys(source);
    for (var j = 0; j < skeys.length; j++) {
        var sk = skeys[j];
        if (
            source[sk] &&
            typeof source[sk] === "object" &&
            !Array.isArray(source[sk]) &&
            result[sk] &&
            typeof result[sk] === "object" &&
            !Array.isArray(result[sk])
        ) {
            result[sk] = deepMerge(result[sk], source[sk]);
        } else {
            result[sk] = source[sk];
        }
    }
    return result;
}

function S() {
    return extension_settings[EXT];
}

function formatDate(d) {
    if (!d) return "-";
    var mm = String(d.month).padStart(2, "0");
    var dd = String(d.day).padStart(2, "0");
    var hh = String(d.hour).padStart(2, "0");
    var mi = String(d.minute).padStart(2, "0");
    return d.year + "/" + mm + "/" + dd + " " + hh + ":" + mi;
}

function addDaysToDate(d, n) {
    var dt = new Date(d.year, d.month - 1, d.day, d.hour, d.minute);
    dt.setDate(dt.getDate() + n);
    return {
        year: dt.getFullYear(),
        month: dt.getMonth() + 1,
        day: dt.getDate(),
        hour: dt.getHours(),
        minute: dt.getMinutes(),
        frozen: d.frozen
    };
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function roll100() {
    return Math.floor(Math.random() * 100) + 1;
}

function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function canGetPregnant(p) {
    if (!p || !p._enabled) return false;
    if (p.bioSex === "F") return true;
    var s = S();
    if (
        p.bioSex === "M" &&
        s.modules.auOverlay &&
        s.auPreset === "omegaverse" &&
        s.auSettings.omegaverse.maleOmegaPregnancy &&
        p.secondarySex === "omega"
    ) {
        return true;
    }
    return false;
}

// ========================
// LLM CALLER
// ========================
var LLM = {
    call: async function (sys, usr) {
        try {
            // Method 1: SillyTavern context
            if (typeof window.SillyTavern !== "undefined") {
                var ctx = window.SillyTavern.getContext();
                if (ctx && typeof ctx.generateRaw === "function") {
                    var resp = await ctx.generateRaw(
                        sys + "\n\n" + usr,
                        "",
                        false,
                        false,
                        "[BunnyCycle]"
                    );
                    if (resp) return resp;
                }
            }
            // Method 2: Global generateRaw
            if (typeof generateRaw === "function") {
                var resp2 = await generateRaw(
                    sys + "\n\n" + usr,
                    "",
                    false,
                    false
                );
                if (resp2) return resp2;
            }
            // Method 3: Fetch API
            var fetchResp = await fetch("/api/backends/chat/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [
                        { role: "system", content: sys },
                        { role: "user", content: usr }
                    ],
                    max_tokens: 500,
                    temperature: 0.05,
                    stream: false
                })
            });
            if (fetchResp.ok) {
                var data = await fetchResp.json();
                return (
                    (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) ||
                    data.content ||
                    data.response ||
                    ""
                );
            }
            return null;
        } catch (err) {
            console.warn("[BunnyCycle] LLM call failed:", err.message);
            return null;
        }
    },

    parseJSON: function (text) {
        if (!text) return null;
        var clean = text.trim().replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "");
        var match = clean.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try {
            return JSON.parse(match[0]);
        } catch (e) {
            console.warn("[BunnyCycle] JSON parse error:", e.message);
            return null;
        }
    }
};

// ========================
// CHARACTER ANALYZER (LLM)
// ========================
var CharAnalyzer = {
    _cache: {},

    SYSTEM: "You analyze character sheets. Determine biological sex from description context. Extract eye color, hair color even from poetic descriptions. Respond with ONLY valid JSON, no other text.",

    analyze: async function (name, charObj, isUser) {
        var cacheKey = "c_" + name + "_" + ((charObj && charObj.data && charObj.data.description) ? charObj.data.description.length : 0);
        if (this._cache[cacheKey]) return this._cache[cacheKey];

        var desc = "";
        var pers = "";
        var other = "";

        if (isUser) {
            try {
                if (typeof power_user !== "undefined" && power_user.persona_description) {
                    desc = power_user.persona_description;
                }
                var ctx = getContext();
                if (ctx && ctx.persona) desc += "\n" + ctx.persona;
            } catch (e) { /* ignore */ }
            other = "(USER character)";
        } else if (charObj) {
            desc = (charObj.description || "") + "\n" + ((charObj.data && charObj.data.description) || "");
            pers = (charObj.personality || "") + "\n" + ((charObj.data && charObj.data.personality) || "");
            var depth = (charObj.data && charObj.data.extensions && charObj.data.extensions.depth_prompt && charObj.data.extensions.depth_prompt.prompt) || "";
            var tags = ((charObj.tags || (charObj.data && charObj.data.tags)) || []).join(", ");
            var notes = (charObj.data && charObj.data.creator_notes) || "";
            var scenario = charObj.scenario || ((charObj.data && charObj.data.scenario) || "");
            other = [depth, scenario, tags ? "Tags: " + tags : "", notes ? "Notes: " + notes : ""].filter(Boolean).join("\n");
        }

        // Check lorebook
        try {
            var ctx2 = getContext();
            if (ctx2 && ctx2.worldInfo) {
                var entries = Object.values(ctx2.worldInfo);
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i];
                    var keys = (entry.key || []).join(" ");
                    if (keys.toLowerCase().indexOf(name.toLowerCase()) !== -1) {
                        other += "\nLorebook: " + (entry.content || "").substring(0, 500);
                    }
                }
            }
        } catch (e) { /* ignore */ }

        if (desc.length < 10 && other.length < 10) return null;

        var userPrompt = "Character: " + name +
            "\nDescription:\n" + desc.substring(0, 3000) +
            "\nPersonality: " + pers.substring(0, 1000) +
            "\nOther: " + other.substring(0, 1500) +
            '\n\nReturn JSON: {"biologicalSex":"M" or "F" or null,"sexConfidence":0-100,"secondarySex":"alpha"/"beta"/"omega"/null,"race":string or null,"eyeColor":string or null,"hairColor":string or null,"canLayEggs":false,"reasoning":"brief"}';

        var raw = await LLM.call(this.SYSTEM, userPrompt);
        var parsed = LLM.parseJSON(raw);
        if (parsed) {
            this._cache[cacheKey] = parsed;
            console.log("[BunnyCycle] Character analysis for " + name + ":", parsed);
        }
        return parsed;
    },

    clearCache: function () {
        this._cache = {};
    }
};

// ========================
// CHAT ANALYZER (LLM)
// ========================
var ChatAnalyzer = {
    _cache: {},
    _lastMessageCount: 0,

    SYSTEM: "You analyze roleplay chat history. Only report ACTUAL events. A child exists ONLY if explicitly born or physically present. Metaphors do NOT count. Sex must be explicitly described. Return ONLY valid JSON.",

    analyze: async function (messages, characterNames) {
        if (!messages || !messages.length) return null;

        var cacheKey = "ch_" + characterNames.sort().join("_") + "_" + messages.length;
        if (this._cache[cacheKey]) return this._cache[cacheKey];

        var recent = messages.slice(-60);
        var msgTexts = [];
        for (var i = 0; i < recent.length; i++) {
            var m = recent[i];
            var sender = m.is_user ? (m.name || "User") : (m.name || "AI");
            var text = (m.mes || "").substring(0, 500);
            msgTexts.push("[" + (messages.length - recent.length + i) + "] " + sender + ": " + text);
        }

        var userPrompt = "Characters: " + characterNames.join(", ") +
            "\nMessages:\n" + msgTexts.join("\n\n").substring(0, 12000) +
            '\n\nReturn JSON:\n{"events":[],"children":[{"name":"","sex":"M"|"F"|null,"mother":""|null,"father":""|null,"exists":true|false,"evidence":""}],"currentStates":{"charName":{"pregnant":false,"pregnancyWeek":null,"inLabor":false,"inHeat":false,"inRut":false,"hasGivenBirth":false}}}';

        var raw = await LLM.call(this.SYSTEM, userPrompt);
        var parsed = LLM.parseJSON(raw);
        if (parsed) {
            this._cache[cacheKey] = parsed;
            this._lastMessageCount = messages.length;
            console.log("[BunnyCycle] Chat analysis:", parsed);
        }
        return parsed;
    },

    shouldReanalyze: function (messages) {
        if (!messages || !messages.length) return false;
        return messages.length - this._lastMessageCount >= 5;
    },

    clearCache: function () {
        this._cache = {};
        this._lastMessageCount = 0;
    }
};

// ========================
// SEX SCENE DETECTOR (regex, realtime)
// ========================
var SexDetect = {
    PATTERNS: [
        /вошё?л\s*(в\s*неё|внутрь)/i,
        /проник\w*\s*(в\s*неё|внутрь)/i,
        /член\s*(?:вошёл|внутри)/i,
        /кончил\s*(внутрь|в\s*неё|глубоко)/i,
        /трахал|ебал|выебал/i,
        /фрикци/i,
        /узел\s*(?:набух|внутри)/i,
        /(?:thrust|pushed|slid)\s*inside/i,
        /penetrat/i,
        /fuck(?:ed|ing)\s/i,
        /cum\w*\s*inside/i,
        /creampie/i,
        /knot\w*\s*inside/i
    ],

    detect: function (text, chars) {
        if (!text) return null;

        var score = 0;
        for (var i = 0; i < this.PATTERNS.length; i++) {
            if (this.PATTERNS[i].test(text)) score++;
        }
        if (score < 3) return null;

        var type = "vaginal";
        if (/анал|anal/i.test(text)) type = "anal";
        if (/минет|blowjob/i.test(text)) type = "oral";

        var ejac = "unknown";
        if (/кончил\s*(?:внутрь|в\s*неё)|cum\w*\s*inside|creampie/i.test(text)) ejac = "inside";
        else if (/кончил\s*наружу|pull\w*\s*out/i.test(text)) ejac = "outside";

        var hasCondom = /презерватив|condom/i.test(text);
        var noCondom = /без\s*(?:презерватива|защиты)|bareback/i.test(text);

        var participants = [];
        var names = Object.keys(chars);
        for (var j = 0; j < names.length; j++) {
            if (text.toLowerCase().indexOf(names[j].toLowerCase()) !== -1 || chars[names[j]]._isUser) {
                participants.push(names[j]);
            }
        }
        if (participants.length < 2 && names.length >= 2) {
            for (var k = 0; k < names.length; k++) {
                if (participants.indexOf(names[k]) === -1) {
                    participants.push(names[k]);
                }
                if (participants.length >= 2) break;
            }
        }

        var target = null;
        for (var m = 0; m < participants.length; m++) {
            if (chars[participants[m]] && canGetPregnant(chars[participants[m]])) {
                target = participants[m];
                break;
            }
        }

        return {
            detected: true,
            type: type,
            condom: hasCondom && !noCondom,
            noCondom: noCondom,
            ejac: ejac,
            participants: participants,
            target: target
        };
    }
};

// ========================
// CYCLE MANAGER
// ========================
function CycleManager(profile) {
    this.p = profile;
    this.c = profile.cycle;
}

CycleManager.prototype.phase = function () {
    if (!this.c || !this.c.enabled) return "unknown";
    var d = this.c.currentDay;
    var len = this.c.length;
    var mDur = this.c.menstruationDuration;
    var ovDay = Math.round(len - 14);
    if (d <= mDur) return "menstruation";
    if (d < ovDay - 2) return "follicular";
    if (d <= ovDay + 1) return "ovulation";
    return "luteal";
};

CycleManager.prototype.label = function (ph) {
    var map = {
        menstruation: "Менструация",
        follicular: "Фолликулярная",
        ovulation: "Овуляция",
        luteal: "Лютеиновая",
        unknown: "-"
    };
    return map[ph] || ph;
};

CycleManager.prototype.emoji = function (ph) {
    var map = { menstruation: "🔴", follicular: "🌸", ovulation: "🥚", luteal: "🌙" };
    return map[ph] || "?";
};

CycleManager.prototype.fertility = function () {
    var baseMap = { ovulation: 0.25, follicular: 0.08, luteal: 0.02, menstruation: 0.01 };
    var base = baseMap[this.phase()] || 0.05;
    var bonus = 0;
    var s = S();
    if (s.modules.auOverlay && s.auPreset === "omegaverse" && this.p.heat && this.p.heat.active) {
        bonus = s.auSettings.omegaverse.heatFertilityBonus;
    }
    return Math.min(base + bonus, 0.95);
};

CycleManager.prototype.libido = function () {
    if ((this.p.heat && this.p.heat.active) || (this.p.rut && this.p.rut.active)) return "экстремальное";
    var map = { ovulation: "высокое", follicular: "среднее", luteal: "низкое", menstruation: "низкое" };
    return map[this.phase()] || "среднее";
};

CycleManager.prototype.symptoms = function () {
    var ph = this.phase();
    var result = [];
    if (ph === "menstruation") { result.push("кровотечение"); result.push("спазмы"); }
    if (ph === "ovulation") result.push("повышенное либидо");
    if (ph === "luteal") result.push("ПМС");
    if (ph === "follicular") result.push("прилив энергии");
    return result;
};

CycleManager.prototype.advance = function (days) {
    for (var i = 0; i < days; i++) {
        this.c.currentDay++;
        if (this.c.currentDay > this.c.length) {
            this.c.currentDay = 1;
            this.c.cycleCount++;
            if (this.c.irregularity > 0) {
                this.c.length = clamp(
                    this.c.baseLength + Math.floor(Math.random() * this.c.irregularity * 2) - this.c.irregularity,
                    21,
                    45
                );
            }
        }
    }
};

CycleManager.prototype.setDay = function (d) {
    this.c.currentDay = clamp(d, 1, this.c.length);
};

CycleManager.prototype.setPhase = function (ph) {
    var ovDay = Math.round(this.c.length - 14);
    var map = {
        menstruation: 1,
        follicular: this.c.menstruationDuration + 1,
        ovulation: ovDay,
        luteal: ovDay + 2
    };
    if (map[ph]) this.c.currentDay = map[ph];
};

// ========================
// HEAT/RUT MANAGER
// ========================
function HeatRutManager(profile) {
    this.p = profile;
}

HeatRutManager.prototype.heatPhase = function () {
    var h = this.p.heat;
    if (!h) return "rest";
    if (h.active) {
        if (h.currentDay <= 1) return "preHeat";
        if (h.currentDay <= h.duration - 1) return "heat";
        return "postHeat";
    }
    if ((h.cycleDays - (h.daysSinceLast || 0)) <= 3) return "preHeat";
    return "rest";
};

HeatRutManager.prototype.rutPhase = function () {
    var r = this.p.rut;
    if (!r) return "rest";
    if (r.active) {
        if (r.currentDay <= 1) return "preRut";
        if (r.currentDay <= r.duration - 1) return "rut";
        return "postRut";
    }
    if ((r.cycleDays - (r.daysSinceLast || 0)) <= 3) return "preRut";
    return "rest";
};

HeatRutManager.prototype.heatLabel = function (ph) {
    var map = { preHeat: "Предтечка", heat: "Течка", postHeat: "Посттечка", rest: "Покой" };
    return map[ph] || ph;
};

HeatRutManager.prototype.rutLabel = function (ph) {
    var map = { preRut: "Предгон", rut: "Гон", postRut: "Постгон", rest: "Покой" };
    return map[ph] || ph;
};

HeatRutManager.prototype.heatDaysLeft = function () {
    var h = this.p.heat;
    if (!h || h.active) return 0;
    return Math.max(0, h.cycleDays - (h.daysSinceLast || 0));
};

HeatRutManager.prototype.rutDaysLeft = function () {
    var r = this.p.rut;
    if (!r || r.active) return 0;
    return Math.max(0, r.cycleDays - (r.daysSinceLast || 0));
};

HeatRutManager.prototype.advanceHeat = function (days) {
    var h = this.p.heat;
    if (!h || h.onSuppressants) return;
    var cfg = S().auSettings.omegaverse || {};
    h.cycleDays = cfg.heatCycleLength || 30;
    h.duration = cfg.heatDuration || 5;
    for (var i = 0; i < days; i++) {
        if (h.active) {
            h.currentDay++;
            if (h.currentDay > h.duration) {
                h.active = false;
                h.currentDay = 0;
                h.daysSinceLast = 0;
            }
        } else {
            h.daysSinceLast = (h.daysSinceLast || 0) + 1;
            if (h.daysSinceLast >= h.cycleDays) {
                h.active = true;
                h.currentDay = 1;
            }
        }
    }
};

HeatRutManager.prototype.advanceRut = function (days) {
    var r = this.p.rut;
    if (!r) return;
    var cfg = S().auSettings.omegaverse || {};
    r.cycleDays = cfg.rutCycleLength || 35;
    r.duration = cfg.rutDuration || 4;
    for (var i = 0; i < days; i++) {
        if (r.active) {
            r.currentDay++;
            if (r.currentDay > r.duration) {
                r.active = false;
                r.currentDay = 0;
                r.daysSinceLast = 0;
            }
        } else {
            r.daysSinceLast = (r.daysSinceLast || 0) + 1;
            if (r.daysSinceLast >= r.cycleDays) {
                r.active = true;
                r.currentDay = 1;
            }
        }
    }
};

// ========================
// PREGNANCY MANAGER
// ========================
function PregManager(profile) {
    this.p = profile;
    this.pr = profile.pregnancy;
}

PregManager.prototype.isActive = function () {
    return this.pr && this.pr.active;
};

PregManager.prototype.start = function (father, count) {
    var s = S();
    this.pr.active = true;
    this.pr.week = 1;
    this.pr.day = 0;
    this.pr.father = father;
    this.pr.fetusCount = count || 1;
    this.pr.fetusSexes = [];
    while (this.pr.fetusSexes.length < this.pr.fetusCount) {
        this.pr.fetusSexes.push(Math.random() < 0.5 ? "M" : "F");
    }
    this.pr.complications = [];
    this.pr.weightGain = 0;
    var maxWeeks = 40;
    if (s.modules.auOverlay && s.auPreset === "omegaverse") {
        maxWeeks = s.auSettings.omegaverse.pregnancyWeeks || 36;
    }
    this.pr.maxWeeks = maxWeeks;
    if (this.p.cycle) this.p.cycle.enabled = false;
};

PregManager.prototype.advanceDay = function (days) {
    if (!this.isActive()) return;
    this.pr.day += days;
    while (this.pr.day >= 7) {
        this.pr.day -= 7;
        this.pr.week++;
    }
};

PregManager.prototype.trimester = function () {
    if (this.pr.week <= 12) return 1;
    if (this.pr.week <= 27) return 2;
    return 3;
};

PregManager.prototype.size = function () {
    var map = [
        [4, "маковое зерно"], [8, "малина"], [12, "лайм"],
        [16, "авокадо"], [20, "банан"], [28, "баклажан"],
        [36, "дыня"], [40, "арбуз"]
    ];
    var result = "эмбрион";
    for (var i = 0; i < map.length; i++) {
        if (this.pr.week >= map[i][0]) result = map[i][1];
    }
    return result;
};

PregManager.prototype.symptoms = function () {
    var w = this.pr.week;
    var result = [];
    if (w >= 4 && w <= 14) result.push("тошнота");
    if (w >= 14) result.push("рост живота");
    if (w >= 18) result.push("шевеления");
    if (w >= 28) result.push("одышка");
    return result;
};

PregManager.prototype.movements = function () {
    var w = this.pr.week;
    if (w < 16) return "нет";
    if (w < 22) return "бабочки";
    if (w < 28) return "толчки";
    return "активные";
};

// ========================
// LABOR MANAGER
// ========================
var LABOR_STAGES = ["latent", "active", "transition", "pushing", "birth", "placenta"];
var LABOR_LABELS = {
    latent: "Латентная",
    active: "Активная",
    transition: "Переходная",
    pushing: "Потуги",
    birth: "Рождение",
    placenta: "Плацента"
};

function LaborManager(profile) {
    this.p = profile;
    this.l = profile.labor;
}

LaborManager.prototype.start = function () {
    this.l.active = true;
    this.l.stage = "latent";
    this.l.dilation = 0;
    this.l.hoursElapsed = 0;
    this.l.babiesDelivered = 0;
    this.l.totalBabies = (this.p.pregnancy && this.p.pregnancy.fetusCount) || 1;
    this.l.complications = [];
};

LaborManager.prototype.advance = function () {
    var idx = LABOR_STAGES.indexOf(this.l.stage);
    if (idx >= LABOR_STAGES.length - 1) return;
    this.l.stage = LABOR_STAGES[idx + 1];
    if (this.l.stage === "active") { this.l.dilation = 5; this.l.hoursElapsed += 5; }
    if (this.l.stage === "transition") { this.l.dilation = 8; this.l.hoursElapsed += 2; }
    if (this.l.stage === "pushing") this.l.dilation = 10;
};

LaborManager.prototype.description = function () {
    var map = {
        latent: "Лёгкие схватки, 0-3 см",
        active: "Сильные схватки, 4-7 см",
        transition: "Пик интенсивности, 7-10 см",
        pushing: "Полное раскрытие, потуги",
        birth: "Рождение ребёнка",
        placenta: "Рождение плаценты"
    };
    return map[this.l.stage] || "";
};

LaborManager.prototype.deliver = function () {
    this.l.babiesDelivered++;
    if (this.l.babiesDelivered >= this.l.totalBabies) {
        this.l.stage = "placenta";
    }
};

LaborManager.prototype.end = function () {
    this.l.active = false;
    this.p.pregnancy.active = false;
    if (this.p.cycle) {
        this.p.cycle.enabled = true;
        this.p.cycle.currentDay = 1;
    }
};

// ========================
// BABY MANAGER
// ========================
function BabyManager(baby) {
    this.b = baby;
}

BabyManager.generate = function (mother, fatherName, overrides) {
    var s = S();
    var ov = overrides || {};
    var sex = ov.sex || (Math.random() < 0.5 ? "M" : "F");
    var bw = 3200 + Math.floor(Math.random() * 800) - 400;
    return {
        name: ov.name || "",
        sex: sex,
        secondarySex: null,
        birthWeight: bw,
        currentWeight: bw,
        ageDays: ov.ageDays || 0,
        eyeColor: ov.eyeColor || (mother ? mother.eyeColor : "") || "",
        hairColor: ov.hairColor || (mother ? mother.hairColor : "") || "",
        mother: (mother ? mother.name : ov.mother) || "?",
        father: fatherName || ov.father || "?",
        state: "новорождённый",
        birthDate: JSON.parse(JSON.stringify(s.worldDate))
    };
};

BabyManager.prototype.age = function () {
    var d = this.b.ageDays;
    if (d < 1) return "новорождённый";
    if (d < 30) return d + " дн.";
    if (d < 365) return Math.floor(d / 30) + " мес.";
    return Math.floor(d / 365) + " г.";
};

BabyManager.prototype.update = function () {
    this.b.currentWeight = this.b.birthWeight + this.b.ageDays * (this.b.ageDays < 120 ? 30 : 7);
    if (this.b.ageDays < 28) this.b.state = "новорождённый";
    else if (this.b.ageDays < 365) this.b.state = "младенец";
    else this.b.state = "ребёнок";
};

// ========================
// OVIPOSITION MANAGER
// ========================
var OVI_PHASES = { none: "Нет", carrying: "Вынашивание", laying: "Откладывание", incubating: "Инкубация", hatched: "Вылупление" };

function OviManager(profile) {
    this.p = profile;
    if (!profile.oviposition) {
        profile.oviposition = {
            active: false, phase: "none", eggCount: 0, fertilizedCount: 0,
            gestationDay: 0, gestationMax: 14, layingDay: 0, layingMax: 3,
            incubationDay: 0, incubationMax: 21, eggs: []
        };
    }
    this.o = profile.oviposition;
}

OviManager.prototype.startCarrying = function () {
    var cfg = S().auSettings.oviposition;
    var count = cfg.eggCountMin + Math.floor(Math.random() * (cfg.eggCountMax - cfg.eggCountMin + 1));
    this.o.active = true;
    this.o.phase = "carrying";
    this.o.eggCount = count;
    this.o.gestationDay = 0;
    this.o.gestationMax = cfg.gestationDays || 14;
    this.o.layingMax = cfg.layingDuration || 3;
    this.o.incubationMax = cfg.incubationDays || 21;
    this.o.eggs = [];
    for (var i = 0; i < count; i++) {
        this.o.eggs.push({ fertilized: Math.random() < (cfg.fertilizationChance || 0.7) });
    }
    this.o.fertilizedCount = this.o.eggs.filter(function (e) { return e.fertilized; }).length;
    if (this.p.cycle) this.p.cycle.enabled = false;
};

OviManager.prototype.advance = function (days) {
    if (!this.o.active) return;
    for (var i = 0; i < days; i++) {
        if (this.o.phase === "carrying") {
            this.o.gestationDay++;
            if (this.o.gestationDay >= this.o.gestationMax) { this.o.phase = "laying"; this.o.layingDay = 0; }
        } else if (this.o.phase === "laying") {
            this.o.layingDay++;
            if (this.o.layingDay >= this.o.layingMax) { this.o.phase = "incubating"; this.o.incubationDay = 0; if (this.p.cycle) this.p.cycle.enabled = true; }
        } else if (this.o.phase === "incubating") {
            this.o.incubationDay++;
            if (this.o.incubationDay >= this.o.incubationMax) this.o.phase = "hatched";
        }
    }
};

OviManager.prototype.progress = function () {
    if (this.o.phase === "carrying") return Math.round((this.o.gestationDay / this.o.gestationMax) * 100);
    if (this.o.phase === "laying") return Math.round((this.o.layingDay / this.o.layingMax) * 100);
    if (this.o.phase === "incubating") return Math.round((this.o.incubationDay / this.o.incubationMax) * 100);
    return 100;
};

OviManager.prototype.end = function () {
    this.o.active = false;
    this.o.phase = "none";
    this.o.eggs = [];
    if (this.p.cycle) this.p.cycle.enabled = true;
};

// ========================
// INTIMACY / DICE
// ========================
var Intimacy = {
    log: function (entry) {
        var s = S();
        entry.ts = formatDate(s.worldDate);
        s.intimacyLog.push(entry);
        if (s.intimacyLog.length > 100) s.intimacyLog = s.intimacyLog.slice(-100);
        saveSettingsDebounced();
    },

    roll: function (targetName, data) {
        var s = S();
        var p = s.characters[targetName];
        if (!p || !canGetPregnant(p)) {
            return { result: false, chance: 0, roll: 0, reason: "not_eligible" };
        }

        var fertility = 0.05;
        if (p.cycle && p.cycle.enabled) {
            fertility = new CycleManager(p).fertility();
        }

        var contraEff = { none: 0, condom: 0.85, pill: 0.91, iud: 0.99, withdrawal: 0.73 };
        var ce = contraEff[p.contraception] || 0;

        if (data.noCondom) {
            // no reduction
        } else if (data.condom) {
            fertility *= 0.15;
        } else {
            fertility *= (1 - ce);
        }

        if (data.ejac === "outside") fertility *= 0.05;
        if (data.type === "anal" || data.type === "oral") fertility = 0;
        if (p.pregnancy && p.pregnancy.active) fertility = 0;

        var chance = Math.round(clamp(fertility, 0, 0.95) * 100);
        var diceRoll = roll100();
        var success = diceRoll <= chance;

        var entry = {
            ts: formatDate(s.worldDate),
            target: targetName,
            parts: data.parts || [],
            chance: chance,
            roll: diceRoll,
            result: success,
            type: data.type,
            ejac: data.ejac,
            auto: data.auto || false
        };

        s.diceLog.push(entry);
        if (s.diceLog.length > 50) s.diceLog = s.diceLog.slice(-50);
        saveSettingsDebounced();
        return entry;
    }
};

// ========================
// RELATIONSHIPS
// ========================
var REL_TYPES = ["мать", "отец", "ребёнок", "партнёр", "супруг(а)", "брат", "сестра", "друг", "другое"];

var Rels = {
    get: function () { return S().relationships || []; },
    add: function (c1, c2, type, notes) {
        var s = S();
        if (!s.relationships) s.relationships = [];
        var exists = s.relationships.some(function (r) {
            return r.char1 === c1 && r.char2 === c2 && r.type === type;
        });
        if (exists) return;
        s.relationships.push({ id: makeId(), char1: c1, char2: c2, type: type, notes: notes || "" });
        saveSettingsDebounced();
    },
    remove: function (id) {
        var s = S();
        s.relationships = (s.relationships || []).filter(function (r) { return r.id !== id; });
        saveSettingsDebounced();
    },
    addBirth: function (mother, father, babyName) {
        if (mother) {
            this.add(mother, babyName, "мать", "");
            this.add(babyName, mother, "ребёнок", "");
        }
        if (father && father !== "?") {
            this.add(father, babyName, "отец", "");
            this.add(babyName, father, "ребёнок", "");
        }
    },
    toPrompt: function () {
        var r = this.get();
        if (!r.length) return "";
        return "Relationships:\n" + r.map(function (x) { return x.char1 + " > " + x.char2 + ": " + x.type; }).join("\n");
    }
};

// ========================
// PROFILES
// ========================
var Profiles = {
    id: function () {
        var ctx = getContext();
        if (!ctx) return null;
        if (ctx.groupId) return "g_" + ctx.groupId;
        if (ctx.characterId !== undefined && ctx.characters) {
            var ch = ctx.characters[ctx.characterId];
            if (ch) return "c_" + ch.avatar + "_" + (ctx.chatId || "0");
        }
        return null;
    },
    save: function () {
        var s = S();
        var cid = this.id();
        if (!cid) return;
        s.currentChatId = cid;
        if (!s.chatProfiles) s.chatProfiles = {};
        s.chatProfiles[cid] = {
            characters: JSON.parse(JSON.stringify(s.characters)),
            relationships: JSON.parse(JSON.stringify(s.relationships || [])),
            worldDate: JSON.parse(JSON.stringify(s.worldDate)),
            diceLog: JSON.parse(JSON.stringify(s.diceLog || [])),
            intimacyLog: JSON.parse(JSON.stringify(s.intimacyLog || []))
        };
        saveSettingsDebounced();
    },
    load: function () {
        var s = S();
        var cid = this.id();
        if (!cid || s.currentChatId === cid) return false;
        // Save current before switching
        if (s.currentChatId && Object.keys(s.characters).length > 0) {
            if (!s.chatProfiles) s.chatProfiles = {};
            s.chatProfiles[s.currentChatId] = {
                characters: JSON.parse(JSON.stringify(s.characters)),
                relationships: JSON.parse(JSON.stringify(s.relationships || [])),
                worldDate: JSON.parse(JSON.stringify(s.worldDate)),
                diceLog: JSON.parse(JSON.stringify(s.diceLog || [])),
                intimacyLog: JSON.parse(JSON.stringify(s.intimacyLog || []))
            };
        }
        s.currentChatId = cid;
        if (s.chatProfiles && s.chatProfiles[cid]) {
            var pr = s.chatProfiles[cid];
            s.characters = JSON.parse(JSON.stringify(pr.characters || {}));
            s.relationships = JSON.parse(JSON.stringify(pr.relationships || []));
            s.worldDate = JSON.parse(JSON.stringify(pr.worldDate || DEFAULTS.worldDate));
            s.diceLog = JSON.parse(JSON.stringify(pr.diceLog || []));
            s.intimacyLog = JSON.parse(JSON.stringify(pr.intimacyLog || []));
        } else {
            s.characters = {};
            s.relationships = [];
            s.diceLog = [];
            s.intimacyLog = [];
        }
        saveSettingsDebounced();
        return true;
    },
    list: function () {
        var s = S();
        var profiles = s.chatProfiles || {};
        return Object.keys(profiles).map(function (id) {
            var p = profiles[id];
            return {
                id: id,
                count: Object.keys(p.characters || {}).length,
                date: p.worldDate ? formatDate(p.worldDate) : "-",
                isCurrent: id === s.currentChatId
            };
        });
    },
    del: function (id) {
        var s = S();
        if (s.chatProfiles && s.chatProfiles[id]) {
            delete s.chatProfiles[id];
            saveSettingsDebounced();
        }
    }
};

// ========================
// PROMPT INJECTION
// ========================
var Prompt = {
    generate: function () {
        var s = S();
        if (!s.promptInjectionEnabled) return "";
        var lines = ["[BunnyCycle]", "Date: " + formatDate(s.worldDate)];
        var relText = Rels.toPrompt();
        if (relText) lines.push(relText);

        var charNames = Object.keys(s.characters);
        for (var i = 0; i < charNames.length; i++) {
            var name = charNames[i];
            var p = s.characters[name];
            if (!p._enabled) continue;

            lines.push("--- " + name + " ---");
            lines.push("Sex: " + p.bioSex + (p.secondarySex ? "/" + p.secondarySex : ""));

            if (s.modules.cycle && p.cycle && p.cycle.enabled && !(p.pregnancy && p.pregnancy.active)) {
                var cm = new CycleManager(p);
                lines.push("Cycle D" + p.cycle.currentDay + "/" + p.cycle.length + " " + cm.label(cm.phase()) + " Fert:" + Math.round(cm.fertility() * 100) + "%");
            }
            if (s.modules.pregnancy && p.pregnancy && p.pregnancy.active) {
                var pm = new PregManager(p);
                lines.push("PREGNANT W" + p.pregnancy.week + "/" + p.pregnancy.maxWeeks + " " + pm.size());
            }
            if (s.modules.labor && p.labor && p.labor.active) {
                lines.push("LABOR: " + LABOR_LABELS[p.labor.stage]);
            }
            if (p.heat && p.heat.active) lines.push("IN HEAT");
            if (p.rut && p.rut.active) lines.push("IN RUT");
            if (s.modules.baby && p.babies && p.babies.length > 0) {
                for (var j = 0; j < p.babies.length; j++) {
                    var b = p.babies[j];
                    lines.push("Child: " + (b.name || "?") + " " + new BabyManager(b).age());
                }
            }
        }
        lines.push("[/BunnyCycle]");
        return lines.join("\n");
    }
};

// ========================
// TIME PARSER
// ========================
var TimeParse = {
    parse: function (msg) {
        if (!msg) return null;
        var days = 0;
        var patterns = [
            [/прошл[оа]\s+(\d+)\s+(?:дн|дней|день)/gi, 1],
            [/через\s+(\d+)\s+(?:дн|дней|день)/gi, 1],
            [/спустя\s+(\d+)\s+(?:дн|дней|день)/gi, 1],
            [/прошл[оа]\s+(\d+)\s+(?:недел|нед)/gi, 7],
            [/через\s+(\d+)\s+(?:недел|нед)/gi, 7],
            [/прошл[оа]\s+(\d+)\s+(?:месяц|мес)/gi, 30],
            [/(\d+)\s+days?\s+(?:later|passed)/gi, 1],
            [/(\d+)\s+weeks?\s+later/gi, 7],
            [/(\d+)\s+months?\s+later/gi, 30]
        ];
        for (var i = 0; i < patterns.length; i++) {
            var re = patterns[i][0];
            var mult = patterns[i][1];
            var match;
            while ((match = re.exec(msg)) !== null) {
                days += parseInt(match[1]) * mult;
            }
        }
        if (/на следующ\w+\s+(?:день|утро)|next\s+day/i.test(msg)) days += 1;
        return days > 0 ? { days: days } : null;
    },

    apply: function (parsed) {
        var s = S();
        if (parsed.days > 0) {
            s.worldDate = addDaysToDate(s.worldDate, parsed.days);
            this.advanceAll(parsed.days);
        }
        saveSettingsDebounced();
        Profiles.save();
    },

    advanceAll: function (days) {
        var s = S();
        var charNames = Object.keys(s.characters);
        for (var i = 0; i < charNames.length; i++) {
            var p = s.characters[charNames[i]];
            if (!p._enabled) continue;

            if (s.modules.cycle && p.cycle && p.cycle.enabled && !(p.pregnancy && p.pregnancy.active)) {
                new CycleManager(p).advance(days);
            }
            if (s.modules.pregnancy && p.pregnancy && p.pregnancy.active) {
                new PregManager(p).advanceDay(days);
            }
            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.secondarySex) {
                var hr = new HeatRutManager(p);
                if (p.secondarySex === "omega") hr.advanceHeat(days);
                if (p.secondarySex === "alpha") hr.advanceRut(days);
            }
            if (s.auSettings.oviposition && s.auSettings.oviposition.enabled && p.oviposition && p.oviposition.active) {
                new OviManager(p).advance(days);
            }
            if (s.modules.baby && p.babies && p.babies.length > 0) {
                for (var j = 0; j < p.babies.length; j++) {
                    p.babies[j].ageDays += days;
                    new BabyManager(p.babies[j]).update();
                }
            }
        }
    }
};

// ========================
// CHARACTER PROFILE FACTORY
// ========================
function makeProfile(name, isUser, sex) {
    var isMale = (sex || "F") === "M";
    return {
        name: name,
        bioSex: sex || "F",
        secondarySex: null,
        race: "human",
        contraception: "none",
        eyeColor: "",
        hairColor: "",
        pregnancyDifficulty: "normal",
        _isUser: isUser,
        _enabled: true,
        _canLayEggs: false,
        _mB: false, _mS: false, _mR: false, _mE: false, _mH: false, _mP: false, _mCyc: false,
        _sexSource: "",
        _sexConfidence: 0,
        cycle: {
            enabled: !isMale,
            currentDay: Math.floor(Math.random() * 28) + 1,
            baseLength: 28,
            length: 28,
            menstruationDuration: 5,
            irregularity: 2,
            symptomIntensity: "moderate",
            cycleCount: 0
        },
        pregnancy: {
            active: false, week: 0, day: 0, maxWeeks: 40,
            father: null, fetusCount: 1, fetusSexes: [],
            complications: [], weightGain: 0
        },
        labor: {
            active: false, stage: "latent", dilation: 0,
            hoursElapsed: 0, babiesDelivered: 0, totalBabies: 1,
            complications: []
        },
        heat: {
            active: false, currentDay: 0, cycleDays: 30,
            duration: 5, intensity: "moderate",
            daysSinceLast: Math.floor(Math.random() * 25),
            onSuppressants: false
        },
        rut: {
            active: false, currentDay: 0, cycleDays: 35,
            duration: 4, intensity: "moderate",
            daysSinceLast: Math.floor(Math.random() * 30)
        },
        oviposition: null,
        babies: []
    };
}

// ========================
// GET ACTIVE CHARACTERS
// ========================
function getActiveChars() {
    var ctx = getContext();
    var result = [];
    if (!ctx) return result;

    if (ctx.characterId !== undefined && ctx.characters) {
        var ch = ctx.characters[ctx.characterId];
        if (ch) result.push({ name: ch.name, obj: ch, isUser: false });
    }
    if (ctx.groups && ctx.groupId) {
        var group = ctx.groups.find(function (g) { return g.id === ctx.groupId; });
        if (group && group.members) {
            for (var i = 0; i < group.members.length; i++) {
                var avatar = group.members[i];
                var found = ctx.characters.find(function (c) { return c.avatar === avatar; });
                if (found && !result.some(function (r) { return r.name === found.name; })) {
                    result.push({ name: found.name, obj: found, isUser: false });
                }
            }
        }
    }
    if (ctx.name1) {
        result.push({ name: ctx.name1, obj: null, isUser: true });
    }
    return result;
}

// ========================
// SYNC CHARACTERS
// ========================
var syncLock = false;

async function syncChars() {
    var s = S();
    if (!s.autoSyncCharacters || syncLock) return;
    syncLock = true;

    try {
        var active = getActiveChars();
        var ctx = getContext();
        var msgs = (ctx && ctx.chat) || [];
        var changed = false;

        // Step 1: Create profiles for new characters
        for (var i = 0; i < active.length; i++) {
            var c = active[i];
            if (!s.characters[c.name]) {
                s.characters[c.name] = makeProfile(c.name, c.isUser, "F");
                changed = true;
            }
        }

        // Step 2: LLM analysis for character data
        if (s.autoParseCharInfo && s.useLLMParsing) {
            for (var j = 0; j < active.length; j++) {
                var ch = active[j];
                var pr = s.characters[ch.name];
                if (pr._mB && pr._mE && pr._mH) continue;

                var analysis = await CharAnalyzer.analyze(ch.name, ch.obj, ch.isUser);
                if (analysis) {
                    if (analysis.biologicalSex && !pr._mB) {
                        pr.bioSex = analysis.biologicalSex;
                        pr._sexSource = "llm";
                        pr._sexConfidence = analysis.sexConfidence || 90;
                        if (analysis.biologicalSex === "M" && !pr._mCyc) pr.cycle.enabled = false;
                        if (analysis.biologicalSex === "F" && !pr._mCyc) pr.cycle.enabled = true;
                        changed = true;
                    }
                    if (analysis.secondarySex && !pr._mS) {
                        pr.secondarySex = analysis.secondarySex;
                        if (analysis.secondarySex === "omega" && pr.bioSex === "M") pr.cycle.enabled = true;
                        changed = true;
                    }
                    if (analysis.race && !pr._mR) { pr.race = analysis.race; changed = true; }
                    if (analysis.eyeColor && !pr._mE) { pr.eyeColor = analysis.eyeColor; changed = true; }
                    if (analysis.hairColor && !pr._mH) { pr.hairColor = analysis.hairColor; changed = true; }
                    if (analysis.canLayEggs) { pr._canLayEggs = true; changed = true; }
                }
            }
        }

        // Step 3: LLM chat analysis
        if (s.parseFullChat && s.useLLMParsing && msgs.length > 0) {
            if (ChatAnalyzer.shouldReanalyze(msgs) || Object.keys(ChatAnalyzer._cache).length === 0) {
                var charNames = Object.keys(s.characters);
                var chatResult = await ChatAnalyzer.analyze(msgs, charNames);

                if (chatResult && chatResult.currentStates) {
                    var stateNames = Object.keys(chatResult.currentStates);
                    for (var si = 0; si < stateNames.length; si++) {
                        var sName = stateNames[si];
                        var state = chatResult.currentStates[sName];
                        var sp = s.characters[sName];
                        if (!sp) continue;

                        if (state.pregnant && !sp.pregnancy.active && !sp._mP && canGetPregnant(sp)) {
                            sp.pregnancy.active = true;
                            sp.pregnancy.week = state.pregnancyWeek || 4;
                            if (sp.cycle) sp.cycle.enabled = false;
                            changed = true;
                        }
                        if (state.hasGivenBirth && sp.pregnancy.active) {
                            sp.pregnancy.active = false;
                            if (sp.labor.active) sp.labor.active = false;
                            if (sp.cycle) sp.cycle.enabled = true;
                            changed = true;
                        }
                        if (state.inHeat && sp.secondarySex === "omega" && sp.heat && !sp.heat.active) {
                            sp.heat.active = true;
                            sp.heat.currentDay = 1;
                            changed = true;
                        }
                        if (state.inRut && sp.secondarySex === "alpha" && sp.rut && !sp.rut.active) {
                            sp.rut.active = true;
                            sp.rut.currentDay = 1;
                            changed = true;
                        }
                    }
                }

                if (chatResult && chatResult.children) {
                    for (var ci = 0; ci < chatResult.children.length; ci++) {
                        var child = chatResult.children[ci];
                        if (!child.exists || !child.name) continue;
                        var motherProfile = child.mother ? s.characters[child.mother] : null;
                        var fatherProfile = child.father ? s.characters[child.father] : null;
                        var attachTo = motherProfile || fatherProfile;
                        if (!attachTo) continue;
                        var alreadyExists = attachTo.babies.some(function (b) { return b.name === child.name; });
                        if (!alreadyExists) {
                            attachTo.babies.push({
                                name: child.name,
                                sex: child.sex || "F",
                                secondarySex: null,
                                birthWeight: 3200,
                                currentWeight: 5000,
                                ageDays: 30,
                                eyeColor: "",
                                hairColor: "",
                                mother: child.mother || "?",
                                father: child.father || "?",
                                state: "младенец",
                                birthDate: JSON.parse(JSON.stringify(s.worldDate))
                            });
                            Rels.addBirth(child.mother, child.father, child.name);
                            changed = true;
                        }
                    }
                }
            }
        }

        if (changed) saveSettingsDebounced();
    } finally {
        syncLock = false;
    }
}

// ========================
// HTML GENERATION
// ========================
function charOptions() {
    var names = Object.keys(S().characters);
    var html = "";
    for (var i = 0; i < names.length; i++) {
        html += '<option value="' + names[i] + '">' + names[i] + '</option>';
    }
    return html;
}

function relTypeOptions() {
    var html = "";
    for (var i = 0; i < REL_TYPES.length; i++) {
        html += '<option value="' + REL_TYPES[i] + '">' + REL_TYPES[i] + '</option>';
    }
    return html;
}

function generateHTML() {
    var s = S();
    var co = charOptions();
    var rto = relTypeOptions();
    var h = [];

    // Panel wrapper
    h.push('<div id="bunnycycle-panel" class="lifecycle-panel');
    if (s.panelCollapsed) h.push(' collapsed');
    h.push('">');

    // Header
    h.push('<div id="bunnycycle-header-toggle" class="lifecycle-header">');
    h.push('<div class="lifecycle-header-title">');
    h.push('<span class="lc-collapse-arrow">');
    h.push(s.panelCollapsed ? '▶' : '▼');
    h.push('</span>');
    h.push('<h3>🐰 BunnyCycle</h3>');
    h.push('<span class="lc-version">v1.0</span>');
    h.push('</div>');
    h.push('<div class="lifecycle-header-actions">');
    h.push('<label class="lc-switch">');
    h.push('<input type="checkbox" id="lc-enabled"');
    if (s.enabled) h.push(' checked');
    h.push('>');
    h.push('<span class="lc-switch-slider"></span>');
    h.push('</label>');
    h.push('</div>');
    h.push('</div>');

    // Body
    h.push('<div class="lifecycle-body">');

    // Dashboard
    h.push('<div class="lc-dashboard">');
    h.push('<div class="lc-dashboard-date" id="lc-dash-date"></div>');
    h.push('<div id="lc-dash-items"></div>');
    h.push('</div>');

    // Tabs bar
    h.push('<div class="lifecycle-tabs">');
    var tabs = [
        ["chars", "👥", "Перс"],
        ["rels", "💞", "Семья"],
        ["cycle", "🔴", "Цикл"],
        ["hr", "🔥", "Течка"],
        ["intim", "💕", "Интим"],
        ["preg", "🤰", "Берем"],
        ["labor", "🏥", "Роды"],
        ["baby", "👶", "Дети"],
        ["ovi", "🥚", "Яйца"],
        ["profs", "💾", "Проф"],
        ["sett", "⚙️", "Настр"]
    ];
    for (var t = 0; t < tabs.length; t++) {
        h.push('<button class="lifecycle-tab');
        if (t === 0) h.push(' active');
        h.push('" data-tab="' + tabs[t][0] + '">');
        h.push('<span class="tab-icon">' + tabs[t][1] + '</span>' + tabs[t][2]);
        h.push('</button>');
    }
    h.push('</div>');

    // === TAB: Characters ===
    h.push('<div class="lifecycle-tab-content active" data-tab="chars">');
    h.push('<div class="lc-btn-group" style="margin-bottom:8px">');
    h.push('<button class="lc-btn lc-btn-primary" id="lc-sync">🔄 Синхр.</button>');
    h.push('<button class="lc-btn" id="lc-add-m">➕</button>');
    h.push('<button class="lc-btn" id="lc-reparse">📖 AI</button>');
    h.push('</div>');
    h.push('<div id="lc-char-list"></div>');

    // Editor
    h.push('<div id="lc-char-editor" class="lc-editor hidden">');
    h.push('<div class="lc-editor-title" id="lc-editor-title"></div>');
    h.push('<div class="lc-editor-grid">');

    var edFields = [
        ['Пол', '<select class="lc-select" id="lc-ed-bio"><option value="F">♀</option><option value="M">♂</option></select>'],
        ['2-й пол', '<select class="lc-select" id="lc-ed-sec"><option value="">-</option><option value="alpha">α</option><option value="beta">β</option><option value="omega">Ω</option></select>'],
        ['Раса', '<select class="lc-select" id="lc-ed-race"><option value="human">Человек</option><option value="elf">Эльф</option><option value="orc">Орк</option><option value="demon">Демон</option><option value="vampire">Вампир</option></select>'],
        ['Контрацепция', '<select class="lc-select" id="lc-ed-contra"><option value="none">Нет</option><option value="condom">Презерв.</option><option value="pill">Таблетки</option><option value="iud">ВМС</option><option value="withdrawal">ППА</option></select>'],
        ['Глаза', '<input class="lc-input" id="lc-ed-eyes">'],
        ['Волосы', '<input class="lc-input" id="lc-ed-hair">'],
        ['Сложность', '<select class="lc-select" id="lc-ed-diff"><option value="easy">Лёгкие</option><option value="normal">Обычные</option><option value="hard">Тяжёлые</option></select>'],
        ['Включён', '<input type="checkbox" id="lc-ed-on">'],
        ['Цикл', '<input type="checkbox" id="lc-ed-cyc">'],
        ['Длина цикла', '<input type="number" class="lc-input" id="lc-ed-clen" min="21" max="45">'],
        ['Менструация', '<input type="number" class="lc-input" id="lc-ed-mdur" min="2" max="10">'],
        ['Нерегулярность', '<input type="number" class="lc-input" id="lc-ed-irreg" min="0" max="7">']
    ];
    for (var ef = 0; ef < edFields.length; ef++) {
        h.push('<div class="lc-editor-field"><label>' + edFields[ef][0] + '</label>' + edFields[ef][1] + '</div>');
    }
    h.push('</div>');
    h.push('<div class="lc-editor-actions">');
    h.push('<button class="lc-btn lc-btn-success" id="lc-ed-save">💾 Сохранить</button>');
    h.push('<button class="lc-btn" id="lc-ed-cancel">Отмена</button>');
    h.push('</div>');
    h.push('</div>'); // editor
    h.push('</div>'); // chars tab

    // === TAB: Relationships ===
    h.push('<div class="lifecycle-tab-content" data-tab="rels">');
    h.push('<div class="lc-row" style="margin-bottom:8px;flex-wrap:wrap">');
    h.push('<select class="lc-select lc-char-select" id="lc-rel-c1">' + co + '</select>');
    h.push('<select class="lc-select" id="lc-rel-tp">' + rto + '</select>');
    h.push('<select class="lc-select lc-char-select" id="lc-rel-c2">' + co + '</select>');
    h.push('<input class="lc-input" id="lc-rel-n" placeholder="Заметка" style="max-width:80px">');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-rel-add">➕</button>');
    h.push('</div>');
    h.push('<div id="lc-rel-list"></div>');
    h.push('</div>');

    // === TAB: Cycle ===
    h.push('<div class="lifecycle-tab-content" data-tab="cycle">');
    h.push('<select class="lc-select lc-char-select" id="lc-cyc-char" style="margin-bottom:6px">' + co + '</select>');
    h.push('<div id="lc-cyc-panel"></div>');
    h.push('</div>');

    // === TAB: Heat/Rut ===
    h.push('<div class="lifecycle-tab-content" data-tab="hr">');
    h.push('<select class="lc-select lc-char-select" id="lc-hr-char" style="margin-bottom:6px">' + co + '</select>');
    h.push('<div id="lc-hr-panel"></div>');
    h.push('</div>');

    // === TAB: Intimacy ===
    h.push('<div class="lifecycle-tab-content" data-tab="intim">');
    h.push('<div class="lc-section">');
    h.push('<div class="lc-row"><label>Цель</label><select class="lc-select lc-char-select" id="lc-int-t">' + co + '</select></div>');
    h.push('<div class="lc-row"><label>Партнёр</label><select class="lc-select lc-char-select" id="lc-int-p">' + co + '</select></div>');
    h.push('<div class="lc-row"><label>Тип</label><select class="lc-select" id="lc-int-tp"><option value="vaginal">Вагин.</option><option value="anal">Анал.</option><option value="oral">Орал.</option></select></div>');
    h.push('<div class="lc-row"><label>Эякуляция</label><select class="lc-select" id="lc-int-ej"><option value="inside">Внутрь</option><option value="outside">Наружу</option><option value="unknown">?</option></select></div>');
    h.push('<div class="lc-btn-group"><button class="lc-btn" id="lc-int-log">📝 Записать</button><button class="lc-btn lc-btn-primary" id="lc-int-roll">🎲 Бросок</button></div>');
    h.push('</div>');
    h.push('<div id="lc-dice-log" class="lc-scroll"></div>');
    h.push('<div id="lc-intim-log" class="lc-scroll"></div>');
    h.push('</div>');

    // === TAB: Pregnancy ===
    h.push('<div class="lifecycle-tab-content" data-tab="preg">');
    h.push('<select class="lc-select lc-char-select" id="lc-preg-char" style="margin-bottom:6px">' + co + '</select>');
    h.push('<div id="lc-preg-panel"></div>');
    h.push('<div class="lc-btn-group" style="margin-top:6px">');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-preg-adv">+1 нед</button>');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-preg-set">Уст. нед.</button>');
    h.push('<button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-preg-labor">→ Роды</button>');
    h.push('<button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-preg-end">Прервать</button>');
    h.push('</div>');
    h.push('</div>');

    // === TAB: Labor ===
    h.push('<div class="lifecycle-tab-content" data-tab="labor">');
    h.push('<select class="lc-select lc-char-select" id="lc-labor-char" style="margin-bottom:6px">' + co + '</select>');
    h.push('<div id="lc-labor-panel"></div>');
    h.push('<div class="lc-btn-group" style="margin-top:6px">');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-labor-adv">→ Стадия</button>');
    h.push('<button class="lc-btn lc-btn-sm lc-btn-success" id="lc-labor-deliver">👶 Родить</button>');
    h.push('<button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-labor-end">Завершить</button>');
    h.push('</div>');
    h.push('</div>');

    // === TAB: Baby ===
    h.push('<div class="lifecycle-tab-content" data-tab="baby">');
    h.push('<div class="lc-row" style="margin-bottom:6px">');
    h.push('<select class="lc-select lc-char-select" id="lc-baby-par">' + co + '</select>');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-baby-create">➕ Создать</button>');
    h.push('</div>');
    h.push('<div id="lc-baby-list"></div>');
    h.push('</div>');

    // === TAB: Oviposition ===
    h.push('<div class="lifecycle-tab-content" data-tab="ovi">');
    h.push('<select class="lc-select lc-char-select" id="lc-ovi-char" style="margin-bottom:6px">' + co + '</select>');
    h.push('<div id="lc-ovi-panel"></div>');
    h.push('<div class="lc-btn-group" style="margin-top:6px">');
    h.push('<button class="lc-btn lc-btn-sm lc-btn-primary" id="lc-ovi-start">🥚 Начать</button>');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-ovi-adv">+1 день</button>');
    h.push('<button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-ovi-end">Завершить</button>');
    h.push('</div>');
    h.push('</div>');

    // === TAB: Profiles ===
    h.push('<div class="lifecycle-tab-content" data-tab="profs">');
    h.push('<div class="lc-info-row" id="lc-prof-cur"></div>');
    h.push('<div class="lc-btn-group" style="margin-bottom:6px">');
    h.push('<button class="lc-btn lc-btn-sm lc-btn-success" id="lc-prof-save">💾 Сохр.</button>');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-prof-reload">🔄 Загр.</button>');
    h.push('</div>');
    h.push('<div id="lc-prof-list"></div>');
    h.push('</div>');

    // === TAB: Settings ===
    h.push('<div class="lifecycle-tab-content" data-tab="sett">');

    // Modules
    h.push('<div class="lc-section"><h4>Модули</h4>');
    var modChecks = [
        ["lc-mc", s.modules.cycle, "🔴 Цикл"],
        ["lc-mp", s.modules.pregnancy, "🤰 Беременность"],
        ["lc-ml", s.modules.labor, "🏥 Роды"],
        ["lc-mb", s.modules.baby, "👶 Дети"],
        ["lc-mi", s.modules.intimacy, "💕 Интимность"],
        ["lc-mau", s.modules.auOverlay, "🌐 AU Оверлей"],
        ["lc-ovi-on", s.auSettings.oviposition.enabled, "🥚 Oviposition"]
    ];
    for (var mc = 0; mc < modChecks.length; mc++) {
        h.push('<label class="lc-checkbox"><input type="checkbox" id="' + modChecks[mc][0] + '"');
        if (modChecks[mc][1]) h.push(' checked');
        h.push('><span>' + modChecks[mc][2] + '</span></label>');
    }
    h.push('</div>');

    // Automation
    h.push('<div class="lc-section"><h4>Автоматизация</h4>');
    var autoChecks = [
        ["lc-sa", s.autoSyncCharacters, "Авто-синхр."],
        ["lc-sp", s.autoParseCharInfo, "Парсинг карточек"],
        ["lc-sllm", s.useLLMParsing, "🧠 AI-анализ (LLM)"],
        ["lc-sc", s.parseFullChat, "Парсинг чата"],
        ["lc-sd", s.autoDetectIntimacy, "Детекция секса"],
        ["lc-sr", s.autoRollOnSex, "Авто-бросок"],
        ["lc-sw", s.showStatusWidget, "Виджет статуса"],
        ["lc-st", s.autoTimeProgress, "Авто-время"]
    ];
    for (var ac = 0; ac < autoChecks.length; ac++) {
        h.push('<label class="lc-checkbox"><input type="checkbox" id="' + autoChecks[ac][0] + '"');
        if (autoChecks[ac][1]) h.push(' checked');
        h.push('><span>' + autoChecks[ac][2] + '</span></label>');
    }
    h.push('</div>');

    // Prompt
    h.push('<div class="lc-section"><h4>Промпт</h4>');
    h.push('<label class="lc-checkbox"><input type="checkbox" id="lc-pon"');
    if (s.promptInjectionEnabled) h.push(' checked');
    h.push('><span>Инъекция в промпт</span></label>');
    h.push('<div class="lc-row"><label>Позиция</label><select class="lc-select" id="lc-ppos">');
    h.push('<option value="authornote"' + (s.promptInjectionPosition === "authornote" ? " selected" : "") + '>Author Note</option>');
    h.push('<option value="system"' + (s.promptInjectionPosition === "system" ? " selected" : "") + '>System</option>');
    h.push('</select></div>');
    h.push('<div class="lc-row"><label>AU пресет</label><select class="lc-select" id="lc-aup">');
    h.push('<option value="realism"' + (s.auPreset === "realism" ? " selected" : "") + '>Реализм</option>');
    h.push('<option value="omegaverse"' + (s.auPreset === "omegaverse" ? " selected" : "") + '>Омегаверс</option>');
    h.push('<option value="fantasy"' + (s.auPreset === "fantasy" ? " selected" : "") + '>Фэнтези</option>');
    h.push('</select></div>');
    h.push('</div>');

    // Date
    h.push('<div class="lc-section"><h4>Дата мира</h4>');
    h.push('<div class="lc-row">');
    h.push('<input type="number" class="lc-input" id="lc-dy" value="' + s.worldDate.year + '" style="width:65px">');
    h.push('<input type="number" class="lc-input" id="lc-dm" value="' + s.worldDate.month + '" min="1" max="12" style="width:42px">');
    h.push('<input type="number" class="lc-input" id="lc-dd" value="' + s.worldDate.day + '" min="1" max="31" style="width:42px">');
    h.push('<input type="number" class="lc-input" id="lc-dh" value="' + s.worldDate.hour + '" min="0" max="23" style="width:42px">');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-da">OK</button>');
    h.push('</div>');
    h.push('<div class="lc-btn-group" style="margin-top:4px">');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-d1">+1 день</button>');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-d7">+7 дней</button>');
    h.push('<label class="lc-checkbox"><input type="checkbox" id="lc-df"');
    if (s.worldDate.frozen) h.push(' checked');
    h.push('><span>❄️ Заморозка</span></label>');
    h.push('</div>');
    h.push('</div>');

    // Export/Import/Reset
    h.push('<div class="lc-section"><h4>Данные</h4>');
    h.push('<div class="lc-btn-group">');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-exp">📤 Экспорт</button>');
    h.push('<button class="lc-btn lc-btn-sm" id="lc-imp">📥 Импорт</button>');
    h.push('<button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-rst">🗑️ Сброс</button>');
    h.push('</div>');
    h.push('</div>');

    h.push('</div>'); // settings tab

    h.push('</div>'); // lifecycle-body
    h.push('</div>'); // panel

    return h.join("");
}

// ========================
// RENDER FUNCTIONS
// ========================
function rebuild() {
    renderDashboard();
    renderCharList();
    renderCycle();
    renderHeatRut();
    renderPregnancy();
    renderLabor();
    renderBabies();
    renderOvi();
    renderRelations();
    renderProfiles();
    renderDiceLog();
    renderIntimLog();
    updateSelects();
}

function updateSelects() {
    var opts = charOptions();
    var selects = document.querySelectorAll(".lc-char-select");
    for (var i = 0; i < selects.length; i++) {
        var val = selects[i].value;
        selects[i].innerHTML = opts;
        if (Object.keys(S().characters).indexOf(val) !== -1) {
            selects[i].value = val;
        }
    }
}

function renderDashboard() {
    var s = S();
    var dateEl = document.getElementById("lc-dash-date");
    var itemsEl = document.getElementById("lc-dash-items");
    if (!dateEl || !itemsEl) return;

    dateEl.textContent = "\uD83D\uDCC5 " + formatDate(s.worldDate) + (s.worldDate.frozen ? " \u2744\uFE0F" : "");

    var html = "";
    var names = Object.keys(s.characters);
    for (var i = 0; i < names.length; i++) {
        var n = names[i];
        var p = s.characters[n];
        if (!p._enabled) continue;

        var tags = [];
        if (s.modules.cycle && p.cycle && p.cycle.enabled && !(p.pregnancy && p.pregnancy.active)) {
            var cm = new CycleManager(p);
            var ph = cm.phase();
            tags.push(cm.emoji(ph) + cm.label(ph));
        }
        if (s.modules.pregnancy && p.pregnancy && p.pregnancy.active) tags.push("\uD83E\uDD30" + p.pregnancy.week + "\u043D");
        if (p.labor && p.labor.active) tags.push("\uD83C\uDFE5");
        if (p.heat && p.heat.active) tags.push("\uD83D\uDD25");
        if (p.rut && p.rut.active) tags.push("\uD83D\uDCA2");
        if (p.oviposition && p.oviposition.active) tags.push("\uD83E\uDD5A");
        if (p.babies && p.babies.length > 0) tags.push("\uD83D\uDC76\u00D7" + p.babies.length);

        if (tags.length > 0) {
            html += '<div class="lc-dash-item"><span class="lc-dash-name">' + n + '</span> ' + tags.join(" ") + '</div>';
        }
    }
    itemsEl.innerHTML = html || '<div class="lc-dash-empty">Нет данных</div>';
}

function renderCharList() {
    var s = S();
    var el = document.getElementById("lc-char-list");
    if (!el) return;

    var html = "";
    var names = Object.keys(s.characters);
    for (var i = 0; i < names.length; i++) {
        var n = names[i];
        var p = s.characters[n];
        var sexIcon = p.bioSex === "F" ? "\u2640" : "\u2642";
        var secText = p.secondarySex ? " " + p.secondarySex : "";
        var srcBadge = p._sexSource ? ' <span class="lc-tag lc-tag-auto">' + p._sexSource + " " + (p._sexConfidence || "?") + '%</span>' : "";
        var eyeBadge = p.eyeColor ? ' <span class="lc-tag">\uD83D\uDC41\uFE0F' + p.eyeColor + '</span>' : "";
        var hairBadge = p.hairColor ? ' <span class="lc-tag">\uD83D\uDC87' + p.hairColor + '</span>' : "";

        html += '<div class="lc-char-card">';
        html += '<div class="lc-char-card-header">';
        html += '<span class="lc-char-card-name">' + sexIcon + ' ' + n + secText + '</span>';
        html += srcBadge + eyeBadge + hairBadge;
        html += '</div>';
        html += '<div class="lc-char-card-actions">';
        html += '<button class="lc-btn lc-btn-sm lc-edit-char" data-char="' + n + '">\u270F\uFE0F</button>';
        html += '<button class="lc-btn lc-btn-sm lc-btn-danger lc-del-char" data-char="' + n + '">\u2715</button>';
        html += '</div>';
        html += '</div>';
    }
    el.innerHTML = html || '<div class="lc-empty">Нажмите "Синхр." для загрузки персонажей</div>';
}

function renderCycle() {
    var s = S();
    var el = document.getElementById("lc-cyc-panel");
    var sel = document.getElementById("lc-cyc-char");
    if (!el || !sel) return;

    var p = s.characters[sel.value];
    if (!p || !p.cycle || !p.cycle.enabled || (p.pregnancy && p.pregnancy.active)) {
        el.innerHTML = '<div class="lc-empty">Цикл отключён или беременность</div>';
        return;
    }

    var cm = new CycleManager(p);
    var phase = cm.phase();
    var fert = cm.fertility();
    var fertClass = "low";
    if (fert >= 0.2) fertClass = "peak";
    else if (fert >= 0.1) fertClass = "high";
    else if (fert >= 0.05) fertClass = "med";

    var html = '<div class="lc-cycle-calendar">';
    for (var d = 1; d <= p.cycle.length; d++) {
        var ovDay = Math.round(p.cycle.length - 14);
        var cls = "lut";
        if (d <= p.cycle.menstruationDuration) cls = "mens";
        else if (d < ovDay - 2) cls = "foll";
        else if (d <= ovDay + 1) cls = "ovul";
        html += '<div class="lc-cal-day ' + cls + (d === p.cycle.currentDay ? ' today' : '') + '">' + d + '</div>';
    }
    html += '</div>';

    html += '<div class="lc-cycle-info">';
    html += '<div class="lc-info-row">' + cm.emoji(phase) + ' ' + cm.label(phase);
    html += ' | <span class="lc-fert-badge ' + fertClass + '">' + Math.round(fert * 100) + '%</span>';
    html += ' | Либидо: ' + cm.libido() + '</div>';

    var sym = cm.symptoms();
    if (sym.length > 0) {
        html += '<div class="lc-info-row">Симптомы: ' + sym.join(", ") + '</div>';
    }

    html += '<div class="lc-row" style="margin-top:6px">';
    html += '<input type="number" class="lc-input" id="lc-cyc-day" min="1" max="' + p.cycle.length + '" value="' + p.cycle.currentDay + '" style="width:50px">';
    html += '<button class="lc-btn lc-btn-sm" id="lc-cyc-setday">Уст.</button>';
    html += '<button class="lc-btn lc-btn-sm" id="lc-cyc-mens">М</button>';
    html += '<button class="lc-btn lc-btn-sm" id="lc-cyc-foll">Ф</button>';
    html += '<button class="lc-btn lc-btn-sm" id="lc-cyc-ovul">О</button>';
    html += '<button class="lc-btn lc-btn-sm" id="lc-cyc-lut">Л</button>';
    html += '<button class="lc-btn lc-btn-sm" id="lc-cyc-skip">\u23ED</button>';
    html += '</div>';
    html += '</div>';

    el.innerHTML = html;
}

function renderHeatRut() {
    var s = S();
    var el = document.getElementById("lc-hr-panel");
    var sel = document.getElementById("lc-hr-char");
    if (!el || !sel) return;

    var p = s.characters[sel.value];
    if (!p || !s.modules.auOverlay || s.auPreset !== "omegaverse" || !p.secondarySex) {
        el.innerHTML = '<div class="lc-empty">AU не активен или нет 2-го пола</div>';
        return;
    }

    var hr = new HeatRutManager(p);
    var html = "";

    if (p.secondarySex === "omega") {
        var hPh = hr.heatPhase();
        html += '<div class="lc-section"><h4>\uD83D\uDD25 ' + hr.heatLabel(hPh) + '</h4>';
        if (!p.heat || !p.heat.active) {
            html += '<div class="lc-info-row">До течки: ' + hr.heatDaysLeft() + ' дн.</div>';
        }
        html += '<div class="lc-btn-group">';
        html += '<button class="lc-btn lc-btn-sm" id="lc-hr-th">\uD83D\uDD25 Запустить</button>';
        html += '<button class="lc-btn lc-btn-sm" id="lc-hr-sh">\u23F9 Стоп</button>';
        html += '<button class="lc-btn lc-btn-sm" id="lc-hr-su">\uD83D\uDC8A Супрессанты</button>';
        html += '</div></div>';
    }

    if (p.secondarySex === "alpha") {
        var rPh = hr.rutPhase();
        html += '<div class="lc-section"><h4>\uD83D\uDCA2 ' + hr.rutLabel(rPh) + '</h4>';
        if (!p.rut || !p.rut.active) {
            html += '<div class="lc-info-row">До гона: ' + hr.rutDaysLeft() + ' дн.</div>';
        }
        html += '<div class="lc-btn-group">';
        html += '<button class="lc-btn lc-btn-sm" id="lc-hr-tr">\uD83D\uDCA2 Запустить</button>';
        html += '<button class="lc-btn lc-btn-sm" id="lc-hr-sr">\u23F9 Стоп</button>';
        html += '</div></div>';
    }

    el.innerHTML = html;
    bindHeatRutButtons(p);
}

function renderPregnancy() {
    var s = S();
    var el = document.getElementById("lc-preg-panel");
    var sel = document.getElementById("lc-preg-char");
    if (!el || !sel) return;

    var p = s.characters[sel.value];
    if (!p || !p.pregnancy || !p.pregnancy.active) {
        el.innerHTML = '<div class="lc-empty">Нет беременности</div>';
        return;
    }

    var pm = new PregManager(p);
    var pr = p.pregnancy;
    var progress = Math.round((pr.week / pr.maxWeeks) * 100);

    var html = '<div class="lc-preg-header">';
    html += '<span class="lc-preg-week">Неделя ' + pr.week + ' / ' + pr.maxWeeks + '</span>';
    html += '<span class="lc-preg-trim">Триместр ' + pm.trimester() + '</span>';
    html += '</div>';
    html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:' + progress + '%"></div></div>';
    html += '<div class="lc-info-row">Размер: ' + pm.size() + ' | Плодов: ' + pr.fetusCount + ' | Движения: ' + pm.movements() + '</div>';

    var sym = pm.symptoms();
    html += '<div class="lc-info-row">Симптомы: ' + (sym.length > 0 ? sym.join(", ") : "нет") + '</div>';

    el.innerHTML = html;
}

function renderLabor() {
    var s = S();
    var el = document.getElementById("lc-labor-panel");
    var sel = document.getElementById("lc-labor-char");
    if (!el || !sel) return;

    var p = s.characters[sel.value];
    if (!p || !p.labor || !p.labor.active) {
        el.innerHTML = '<div class="lc-empty">Нет активных родов</div>';
        return;
    }

    var lm = new LaborManager(p);
    var progress = Math.round((p.labor.dilation / 10) * 100);

    var html = '<div class="lc-labor-stage">' + LABOR_LABELS[p.labor.stage] + '</div>';
    html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:' + progress + '%"></div></div>';
    html += '<div class="lc-info-row">Раскрытие: ' + p.labor.dilation + '/10 см | Время: ' + p.labor.hoursElapsed + ' ч</div>';
    html += '<div class="lc-labor-desc">' + lm.description() + '</div>';

    el.innerHTML = html;
}

function renderBabies() {
    var s = S();
    var el = document.getElementById("lc-baby-list");
    var sel = document.getElementById("lc-baby-par");
    if (!el || !sel) return;

    var p = s.characters[sel.value];
    if (!p || !p.babies || p.babies.length === 0) {
        el.innerHTML = '<div class="lc-empty">Нет детей</div>';
        return;
    }

    var html = "";
    for (var i = 0; i < p.babies.length; i++) {
        var b = p.babies[i];
        var bm = new BabyManager(b);
        var sexIcon = b.sex === "M" ? "\u2642" : "\u2640";

        html += '<div class="lc-baby-card">';
        html += '<div class="lc-baby-header">';
        html += '<span class="lc-baby-name">' + sexIcon + ' ' + (b.name || "?") + '</span>';
        html += '<span class="lc-baby-sex">' + bm.age() + '</span>';
        html += '</div>';
        html += '<div class="lc-baby-details">Мать: ' + b.mother + ' | Отец: ' + b.father + '</div>';
        html += '<div class="lc-baby-actions">';
        html += '<button class="lc-btn lc-btn-sm lc-baby-edit" data-p="' + sel.value + '" data-i="' + i + '">\u270F\uFE0F</button>';
        html += '<button class="lc-btn lc-btn-sm lc-btn-danger lc-baby-del" data-p="' + sel.value + '" data-i="' + i + '">\u2715</button>';
        html += '</div>';
        html += '</div>';
    }
    el.innerHTML = html;
}

function renderOvi() {
    var s = S();
    var el = document.getElementById("lc-ovi-panel");
    var sel = document.getElementById("lc-ovi-char");
    if (!el || !sel) return;

    var p = s.characters[sel.value];
    if (!p || !p.oviposition || !p.oviposition.active) {
        el.innerHTML = '<div class="lc-empty">Нет кладки</div>';
        return;
    }

    var om = new OviManager(p);
    var prog = om.progress();
    var html = '<div class="lc-ovi-phase">' + (OVI_PHASES[p.oviposition.phase] || p.oviposition.phase) + '</div>';
    html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill ovi" style="width:' + prog + '%"></div></div>';
    html += '<div class="lc-info-row">Яиц: ' + p.oviposition.eggCount + ' (' + p.oviposition.fertilizedCount + ' оплодотворённых)</div>';

    el.innerHTML = html;
}

function renderRelations() {
    var el = document.getElementById("lc-rel-list");
    if (!el) return;

    var rels = S().relationships || [];
    if (rels.length === 0) {
        el.innerHTML = '<div class="lc-empty">Нет связей</div>';
        return;
    }

    var html = "";
    for (var i = 0; i < rels.length; i++) {
        var r = rels[i];
        html += '<div class="lc-dice-entry">' + r.char1 + ' \u2192 ' + r.char2 + ': <strong>' + r.type + '</strong>';
        if (r.notes) html += ' <span style="color:#666">(' + r.notes + ')</span>';
        html += ' <button class="lc-btn lc-btn-sm lc-btn-danger lc-del-rel" data-id="' + r.id + '">\u2715</button>';
        html += '</div>';
    }
    el.innerHTML = html;

    var delBtns = el.querySelectorAll(".lc-del-rel");
    for (var j = 0; j < delBtns.length; j++) {
        delBtns[j].addEventListener("click", function () {
            Rels.remove(this.dataset.id);
            renderRelations();
        });
    }
}

function renderProfiles() {
    var s = S();
    var curEl = document.getElementById("lc-prof-cur");
    if (curEl) {
        curEl.textContent = "Текущий: " + (s.currentChatId || "-") + " (" + Object.keys(s.characters).length + " перс.)";
    }

    var el = document.getElementById("lc-prof-list");
    if (!el) return;

    var list = Profiles.list();
    if (list.length === 0) {
        el.innerHTML = '<div class="lc-empty">Нет сохранённых профилей</div>';
        return;
    }

    var html = "";
    for (var i = 0; i < list.length; i++) {
        var p = list[i];
        html += '<div class="lc-profile-card' + (p.isCurrent ? ' current' : '') + '">';
        html += '<span>' + p.id.substring(0, 25) + ' (' + p.count + ' перс.)</span>';
        html += '<div class="lc-btn-group">';
        html += '<button class="lc-btn lc-btn-sm lc-prof-load" data-id="' + p.id + '">\uD83D\uDCC2</button>';
        html += '<button class="lc-btn lc-btn-sm lc-btn-danger lc-prof-del" data-id="' + p.id + '">\u2715</button>';
        html += '</div>';
        html += '</div>';
    }
    el.innerHTML = html;
}

function renderDiceLog() {
    var el = document.getElementById("lc-dice-log");
    if (!el) return;

    var logs = S().diceLog;
    if (!logs || logs.length === 0) {
        el.innerHTML = '<div class="lc-empty">Нет бросков</div>';
        return;
    }

    var html = "";
    var items = logs.slice().reverse().slice(0, 15);
    for (var i = 0; i < items.length; i++) {
        var e = items[i];
        var cls = e.result ? "lc-dice-success" : "lc-dice-fail";
        html += '<div class="lc-dice-entry ' + cls + '">';
        html += '<span class="lc-dice-ts">' + e.ts + '</span> ';
        html += e.target + ': \uD83C\uDFB2' + e.roll + '/' + e.chance + '% ';
        html += (e.result ? '\u2713' : '\u2717');
        html += '</div>';
    }
    el.innerHTML = html;
}

function renderIntimLog() {
    var el = document.getElementById("lc-intim-log");
    if (!el) return;

    var logs = S().intimacyLog;
    if (!logs || logs.length === 0) {
        el.innerHTML = '<div class="lc-empty">Нет записей</div>';
        return;
    }

    var html = "";
    var items = logs.slice().reverse().slice(0, 15);
    for (var i = 0; i < items.length; i++) {
        var e = items[i];
        html += '<div class="lc-intim-entry">';
        html += '<span class="lc-intim-ts">' + e.ts + '</span> ';
        html += (e.parts || []).join(" + ") + ' ' + (e.type || "");
        html += '</div>';
    }
    el.innerHTML = html;
}

// ========================
// POPUPS
// ========================
function showDicePopup(result, targetName, isAuto) {
    var oldOverlay = document.querySelector(".lc-overlay");
    var oldPopup = document.querySelector(".lc-popup");
    if (oldOverlay) oldOverlay.remove();
    if (oldPopup) oldPopup.remove();

    var resultClass = result.result ? "success" : "fail";

    var overlay = document.createElement("div");
    overlay.className = "lc-overlay";

    var popup = document.createElement("div");
    popup.className = "lc-popup";

    var html = '<div class="lc-popup-title">\uD83C\uDFB2 Бросок на зачатие</div>';
    if (isAuto) html += '<div class="lc-popup-auto">Авто-детекция</div>';
    html += '<div class="lc-popup-details"><strong>' + targetName + '</strong> | Шанс: ' + result.chance + '%</div>';
    html += '<div class="lc-popup-result ' + resultClass + '">' + result.roll + ' / ' + result.chance + '</div>';
    html += '<div class="lc-popup-verdict ' + resultClass + '">' + (result.result ? '\u2713 ЗАЧАТИЕ!' : '\u2717 Не произошло') + '</div>';
    html += '<div class="lc-popup-actions">';
    html += '<button class="lc-btn lc-btn-success" id="lc-dp-ok">\u2713 OK</button>';
    html += '<button class="lc-btn" id="lc-dp-re">\uD83C\uDFB2 Переброс</button>';
    html += '<button class="lc-btn lc-btn-danger" id="lc-dp-no">\u2715 Отмена</button>';
    html += '</div>';

    popup.innerHTML = html;
    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    document.getElementById("lc-dp-ok").addEventListener("click", function () {
        if (result.result) {
            var p = S().characters[targetName];
            if (p && canGetPregnant(p)) {
                var fatherName = (result.parts || []).find(function (x) { return x !== targetName; }) || "?";
                new PregManager(p).start(fatherName, 1);
                saveSettingsDebounced();
                rebuild();
            }
        }
        overlay.remove();
        popup.remove();
    });

    document.getElementById("lc-dp-re").addEventListener("click", function () {
        overlay.remove();
        popup.remove();
        var newResult = Intimacy.roll(targetName, {
            parts: result.parts,
            type: result.type,
            ejac: result.ejac,
            auto: isAuto
        });
        showDicePopup(newResult, targetName, isAuto);
    });

    document.getElementById("lc-dp-no").addEventListener("click", function () {
        overlay.remove();
        popup.remove();
    });

    overlay.addEventListener("click", function () {
        overlay.remove();
        popup.remove();
    });
}

function showBabyForm(parentName, fatherName, existingBaby, babyIndex, isStandalone) {
    var s = S();
    var isEdit = !!existingBaby;
    var baby = existingBaby || {};

    var oldOverlay = document.querySelector(".lc-overlay");
    var oldPopup = document.querySelector(".lc-popup");
    if (oldOverlay) oldOverlay.remove();
    if (oldPopup) oldPopup.remove();

    var overlay = document.createElement("div");
    overlay.className = "lc-overlay";

    var form = document.createElement("div");
    form.className = "lc-popup";
    form.style.maxWidth = "400px";

    var html = '<div class="lc-popup-title">' + (isEdit ? '\u270F\uFE0F Редактирование' : '\uD83D\uDC76 Новый ребёнок') + '</div>';
    html += '<div class="lc-editor-grid">';
    html += '<div class="lc-editor-field"><label>Имя</label><input class="lc-input" id="lc-bf-name" value="' + (baby.name || '') + '"></div>';
    html += '<div class="lc-editor-field"><label>Пол</label><select class="lc-select" id="lc-bf-sex"><option value="random">\uD83C\uDFB2</option><option value="M"' + (baby.sex === "M" ? ' selected' : '') + '>\u2642</option><option value="F"' + (baby.sex === "F" ? ' selected' : '') + '>\u2640</option></select></div>';
    html += '<div class="lc-editor-field"><label>Глаза</label><input class="lc-input" id="lc-bf-eyes" value="' + (baby.eyeColor || '') + '"></div>';
    html += '<div class="lc-editor-field"><label>Волосы</label><input class="lc-input" id="lc-bf-hair" value="' + (baby.hairColor || '') + '"></div>';

    if (isEdit) {
        html += '<div class="lc-editor-field"><label>Возраст (дни)</label><input type="number" class="lc-input" id="lc-bf-age" value="' + (baby.ageDays || 0) + '"></div>';
    }

    if (isStandalone) {
        var co = charOptions();
        html += '<div class="lc-editor-field"><label>Мать</label><select class="lc-select" id="lc-bf-mo">' + co + '</select></div>';
        html += '<div class="lc-editor-field"><label>Отец</label><select class="lc-select" id="lc-bf-fa">' + co + '</select></div>';
        html += '<div class="lc-editor-field"><label>Привязать к</label><select class="lc-select" id="lc-bf-to">' + co + '</select></div>';
    }

    html += '</div>';
    html += '<div class="lc-popup-actions">';
    html += '<button class="lc-btn lc-btn-success" id="lc-bf-save">\uD83D\uDCBE Сохранить</button>';
    html += '<button class="lc-btn" id="lc-bf-cancel">Отмена</button>';
    html += '</div>';

    form.innerHTML = html;
    document.body.appendChild(overlay);
    document.body.appendChild(form);

    document.getElementById("lc-bf-save").addEventListener("click", function () {
        var name = (document.getElementById("lc-bf-name").value || "").trim() || "Малыш";
        var sex = document.getElementById("lc-bf-sex").value;
        if (sex === "random") sex = Math.random() < 0.5 ? "M" : "F";
        var eyes = (document.getElementById("lc-bf-eyes").value || "").trim();
        var hair = (document.getElementById("lc-bf-hair").value || "").trim();

        if (isEdit) {
            var editBaby = s.characters[parentName] && s.characters[parentName].babies && s.characters[parentName].babies[babyIndex];
            if (editBaby) {
                editBaby.name = name;
                editBaby.sex = sex;
                if (eyes) editBaby.eyeColor = eyes;
                if (hair) editBaby.hairColor = hair;
                var ageInput = document.getElementById("lc-bf-age");
                if (ageInput) {
                    editBaby.ageDays = parseInt(ageInput.value) || 0;
                    new BabyManager(editBaby).update();
                }
                saveSettingsDebounced();
                rebuild();
            }
        } else if (isStandalone) {
            var moVal = document.getElementById("lc-bf-mo") ? document.getElementById("lc-bf-mo").value : "?";
            var faVal = document.getElementById("lc-bf-fa") ? document.getElementById("lc-bf-fa").value : "?";
            var toVal = document.getElementById("lc-bf-to") ? document.getElementById("lc-bf-to").value : null;
            if (toVal && s.characters[toVal]) {
                var newBaby = BabyManager.generate(s.characters[moVal], faVal, { name: name, sex: sex, eyeColor: eyes, hairColor: hair });
                newBaby.mother = moVal;
                newBaby.father = faVal;
                s.characters[toVal].babies.push(newBaby);
                Rels.addBirth(moVal, faVal, name);
                saveSettingsDebounced();
                rebuild();
            }
        } else {
            var mother = s.characters[parentName];
            if (mother) {
                var newBaby2 = BabyManager.generate(mother, fatherName, { name: name, sex: sex, eyeColor: eyes, hairColor: hair });
                mother.babies.push(newBaby2);
                Rels.addBirth(parentName, fatherName, name);
                var lm = new LaborManager(mother);
                lm.deliver();
                if (lm.l.babiesDelivered >= lm.l.totalBabies) lm.end();
                saveSettingsDebounced();
                rebuild();
            }
        }

        overlay.remove();
        form.remove();
    });

    document.getElementById("lc-bf-cancel").addEventListener("click", function () {
        overlay.remove();
        form.remove();
    });

    overlay.addEventListener("click", function () {
        overlay.remove();
        form.remove();
    });
}

// ========================
// EDITOR
// ========================
var currentEditName = null;

function openEditor(name) {
    var s = S();
    var p = s.characters[name];
    if (!p) return;

    currentEditName = name;
    var editorEl = document.getElementById("lc-char-editor");
    if (editorEl) editorEl.classList.remove("hidden");

    document.getElementById("lc-editor-title").textContent = "\u270F\uFE0F " + name;
    document.getElementById("lc-ed-bio").value = p.bioSex;
    document.getElementById("lc-ed-sec").value = p.secondarySex || "";
    document.getElementById("lc-ed-race").value = p.race || "human";
    document.getElementById("lc-ed-contra").value = p.contraception;
    document.getElementById("lc-ed-eyes").value = p.eyeColor || "";
    document.getElementById("lc-ed-hair").value = p.hairColor || "";
    document.getElementById("lc-ed-diff").value = p.pregnancyDifficulty || "normal";
    document.getElementById("lc-ed-on").checked = p._enabled !== false;
    document.getElementById("lc-ed-cyc").checked = !!(p.cycle && p.cycle.enabled);
    document.getElementById("lc-ed-clen").value = (p.cycle && p.cycle.baseLength) || 28;
    document.getElementById("lc-ed-mdur").value = (p.cycle && p.cycle.menstruationDuration) || 5;
    document.getElementById("lc-ed-irreg").value = (p.cycle && p.cycle.irregularity) || 2;
}

function closeEditor() {
    currentEditName = null;
    var editorEl = document.getElementById("lc-char-editor");
    if (editorEl) editorEl.classList.add("hidden");
}

function saveEditor() {
    if (!currentEditName) return;
    var s = S();
    var p = s.characters[currentEditName];
    if (!p) return;

    p.bioSex = document.getElementById("lc-ed-bio").value;
    p._mB = true;
    p.secondarySex = document.getElementById("lc-ed-sec").value || null;
    p._mS = true;
    p.race = document.getElementById("lc-ed-race").value;
    p._mR = true;
    p.contraception = document.getElementById("lc-ed-contra").value;
    p.eyeColor = document.getElementById("lc-ed-eyes").value;
    p._mE = !!p.eyeColor;
    p.hairColor = document.getElementById("lc-ed-hair").value;
    p._mH = !!p.hairColor;
    p.pregnancyDifficulty = document.getElementById("lc-ed-diff").value;
    p._enabled = document.getElementById("lc-ed-on").checked;
    p.cycle.enabled = document.getElementById("lc-ed-cyc").checked;
    p._mCyc = true;

    var len = parseInt(document.getElementById("lc-ed-clen").value);
    if (len >= 21 && len <= 45) {
        p.cycle.baseLength = len;
        p.cycle.length = len;
    }
    p.cycle.menstruationDuration = parseInt(document.getElementById("lc-ed-mdur").value) || 5;
    p.cycle.irregularity = parseInt(document.getElementById("lc-ed-irreg").value) || 2;

    saveSettingsDebounced();
    Profiles.save();
    closeEditor();
    rebuild();
    toastr.success(currentEditName + " сохранён!");
}

// ========================
// STATUS WIDGET
// ========================
function generateWidget() {
    var s = S();
    if (!s.enabled || !s.showStatusWidget) return "";

    var charEntries = Object.keys(s.characters).filter(function (n) { return s.characters[n]._enabled; });
    if (charEntries.length === 0) return "";

    var h = '<div class="lc-status-widget"><div class="lc-sw-header"><span>\uD83D\uDC30 BunnyCycle</span></div><div class="lc-sw-body">';
    h += '<div class="lc-sw-date">' + formatDate(s.worldDate) + '</div>';

    for (var i = 0; i < charEntries.length; i++) {
        var name = charEntries[i];
        var p = s.characters[name];
        var sexIcon = p.bioSex === "F" ? "\u2640" : "\u2642";
        h += '<div class="lc-sw-char"><div class="lc-sw-char-name">' + sexIcon + ' ' + name;
        if (p.secondarySex) h += ' <span class="lc-sw-sec-badge">' + p.secondarySex + '</span>';
        h += '</div>';

        if (s.modules.labor && p.labor && p.labor.active) {
            h += '<div class="lc-sw-block lc-sw-labor-block"><div class="lc-sw-block-title">\uD83C\uDFE5 ' + LABOR_LABELS[p.labor.stage] + '</div>';
            h += '<div class="lc-sw-row">' + p.labor.dilation + '/10 \u0441\u043C</div></div>';
        } else if (s.modules.pregnancy && p.pregnancy && p.pregnancy.active) {
            var pm = new PregManager(p);
            h += '<div class="lc-sw-block lc-sw-preg-block"><div class="lc-sw-block-title">\uD83E\uDD30 W' + p.pregnancy.week + '/' + p.pregnancy.maxWeeks + '</div>';
            h += '<div class="lc-sw-row">' + pm.size() + '</div></div>';
        }

        if (p.heat && p.heat.active) {
            h += '<div class="lc-sw-block lc-sw-heat-block"><div class="lc-sw-block-title">\uD83D\uDD25 Течка</div></div>';
        }
        if (p.rut && p.rut.active) {
            h += '<div class="lc-sw-block lc-sw-rut-block"><div class="lc-sw-block-title">\uD83D\uDCA2 Гон</div></div>';
        }

        if (s.modules.cycle && p.cycle && p.cycle.enabled && !(p.pregnancy && p.pregnancy.active) && !(p.labor && p.labor.active)) {
            var cm = new CycleManager(p);
            var fert = cm.fertility();
            var fertCls = "low";
            if (fert >= 0.2) fertCls = "peak";
            else if (fert >= 0.1) fertCls = "high";
            else if (fert >= 0.05) fertCls = "med";
            h += '<div class="lc-sw-block lc-sw-cycle-block"><div class="lc-sw-row">' + cm.emoji(cm.phase()) + ' ' + cm.label(cm.phase()) + ' <span class="lc-sw-fert ' + fertCls + '">' + Math.round(fert * 100) + '%</span></div></div>';
        }

        if (s.modules.baby && p.babies && p.babies.length > 0) {
            h += '<div class="lc-sw-block lc-sw-baby-block">';
            for (var j = 0; j < p.babies.length; j++) {
                var b = p.babies[j];
                var bSex = b.sex === "M" ? "\u2642" : "\u2640";
                h += '<div class="lc-sw-baby-row">' + bSex + ' ' + (b.name || "?") + ' (' + new BabyManager(b).age() + ')</div>';
            }
            h += '</div>';
        }

        h += '</div>';
    }

    h += '</div></div>';
    return h;
}

function injectWidget(messageIndex) {
    var s = S();
    if (!s.enabled || !s.showStatusWidget) return;

    var widgetHtml = generateWidget();
    if (!widgetHtml) return;

    setTimeout(function () {
        var msgEl = document.querySelector('#chat .mes[mesid="' + messageIndex + '"]');
        if (!msgEl) return;
        var textEl = msgEl.querySelector(".mes_text");
        if (!textEl) return;
        var existing = textEl.querySelectorAll(".lc-status-widget");
        for (var i = 0; i < existing.length; i++) existing[i].remove();
        textEl.insertAdjacentHTML("beforeend", widgetHtml);
    }, 300);
}

// ========================
// BIND EVENTS
// ========================
function bindHeatRutButtons(profile) {
    var el;
    el = document.getElementById("lc-hr-th");
    if (el) el.addEventListener("click", function () { profile.heat.active = true; profile.heat.currentDay = 1; saveSettingsDebounced(); renderHeatRut(); renderDashboard(); });
    el = document.getElementById("lc-hr-sh");
    if (el) el.addEventListener("click", function () { profile.heat.active = false; profile.heat.currentDay = 0; profile.heat.daysSinceLast = 0; saveSettingsDebounced(); renderHeatRut(); renderDashboard(); });
    el = document.getElementById("lc-hr-su");
    if (el) el.addEventListener("click", function () { profile.heat.onSuppressants = !profile.heat.onSuppressants; saveSettingsDebounced(); renderHeatRut(); });
    el = document.getElementById("lc-hr-tr");
    if (el) el.addEventListener("click", function () { profile.rut.active = true; profile.rut.currentDay = 1; saveSettingsDebounced(); renderHeatRut(); renderDashboard(); });
    el = document.getElementById("lc-hr-sr");
    if (el) el.addEventListener("click", function () { profile.rut.active = false; profile.rut.currentDay = 0; profile.rut.daysSinceLast = 0; saveSettingsDebounced(); renderHeatRut(); renderDashboard(); });
}

function bindAll() {
    var s = S();

    // Header toggle
    var headerEl = document.getElementById("bunnycycle-header-toggle");
    if (headerEl) {
        headerEl.addEventListener("click", function (e) {
            if (e.target.closest(".lc-switch")) return;
            s.panelCollapsed = !s.panelCollapsed;
            var panelEl = document.getElementById("bunnycycle-panel");
            if (panelEl) panelEl.classList.toggle("collapsed", s.panelCollapsed);
            var arrowEl = this.querySelector(".lc-collapse-arrow");
            if (arrowEl) arrowEl.innerHTML = s.panelCollapsed ? "▶" : "▼";
            saveSettingsDebounced();
        });
    }

    // Enabled toggle
    var enabledEl = document.getElementById("lc-enabled");
    if (enabledEl) enabledEl.addEventListener("change", function () { s.enabled = this.checked; saveSettingsDebounced(); });

    // Tabs
    var tabButtons = document.querySelectorAll(".lifecycle-tab");
    for (var ti = 0; ti < tabButtons.length; ti++) {
        tabButtons[ti].addEventListener("click", function () {
            var allTabs = document.querySelectorAll(".lifecycle-tab");
            for (var j = 0; j < allTabs.length; j++) allTabs[j].classList.remove("active");
            var allPanels = document.querySelectorAll(".lifecycle-tab-content");
            for (var k = 0; k < allPanels.length; k++) allPanels[k].classList.remove("active");
            this.classList.add("active");
            var targetPanel = document.querySelector('.lifecycle-tab-content[data-tab="' + this.dataset.tab + '"]');
            if (targetPanel) targetPanel.classList.add("active");
            rebuild();
        });
    }

    // Sync
    var syncBtn = document.getElementById("lc-sync");
    if (syncBtn) syncBtn.addEventListener("click", async function () { toastr.info("Сканирование..."); await syncChars(); rebuild(); toastr.success("Готово!"); });

    // Add manual
    var addBtn = document.getElementById("lc-add-m");
    if (addBtn) addBtn.addEventListener("click", function () { var n = prompt("Имя персонажа:"); if (n && n.trim()) { s.characters[n.trim()] = makeProfile(n.trim(), false, "F"); saveSettingsDebounced(); rebuild(); } });

    // AI Reparse
    var reparseBtn = document.getElementById("lc-reparse");
    if (reparseBtn) reparseBtn.addEventListener("click", async function () {
        CharAnalyzer.clearCache();
        ChatAnalyzer.clearCache();
        var names = Object.keys(s.characters);
        for (var i = 0; i < names.length; i++) {
            var p = s.characters[names[i]];
            p._mB = false; p._mE = false; p._mH = false; p._mR = false; p._mS = false; p._sexConfidence = 0;
        }
        toastr.info("AI анализирует...");
        await syncChars();
        rebuild();
        toastr.success("AI-скан завершён!");
    });

    // Char list clicks
    var charList = document.getElementById("lc-char-list");
    if (charList) charList.addEventListener("click", function (e) {
        var editBtn = e.target.closest(".lc-edit-char");
        var delBtn = e.target.closest(".lc-del-char");
        if (editBtn) openEditor(editBtn.dataset.char);
        if (delBtn && confirm("Удалить персонажа?")) { delete s.characters[delBtn.dataset.char]; saveSettingsDebounced(); rebuild(); }
    });

    // Editor
    var edSave = document.getElementById("lc-ed-save");
    if (edSave) edSave.addEventListener("click", saveEditor);
    var edCancel = document.getElementById("lc-ed-cancel");
    if (edCancel) edCancel.addEventListener("click", closeEditor);

    // Relations
    var relAdd = document.getElementById("lc-rel-add");
    if (relAdd) relAdd.addEventListener("click", function () {
        var c1 = document.getElementById("lc-rel-c1");
        var c2 = document.getElementById("lc-rel-c2");
        var tp = document.getElementById("lc-rel-tp");
        var notes = document.getElementById("lc-rel-n");
        if (!c1 || !c2 || !tp || c1.value === c2.value) return;
        Rels.add(c1.value, c2.value, tp.value, notes ? notes.value : "");
        if (notes) notes.value = "";
        renderRelations();
    });

    // Cycle
    var cycChar = document.getElementById("lc-cyc-char");
    if (cycChar) cycChar.addEventListener("change", renderCycle);

    var cycSetDay = document.getElementById("lc-cyc-setday");
    if (cycSetDay) cycSetDay.addEventListener("click", function () {
        var selVal = document.getElementById("lc-cyc-char");
        var dayInput = document.getElementById("lc-cyc-day");
        if (!selVal || !dayInput) return;
        var p = s.characters[selVal.value];
        if (!p || !p.cycle || !p.cycle.enabled) return;
        var d = parseInt(dayInput.value);
        if (d >= 1 && d <= p.cycle.length) { new CycleManager(p).setDay(d); saveSettingsDebounced(); renderCycle(); renderDashboard(); }
    });

    var phaseButtons = [
        ["lc-cyc-mens", "menstruation"],
        ["lc-cyc-foll", "follicular"],
        ["lc-cyc-ovul", "ovulation"],
        ["lc-cyc-lut", "luteal"]
    ];
    for (var pi = 0; pi < phaseButtons.length; pi++) {
        (function (btnId, phase) {
            var btn = document.getElementById(btnId);
            if (btn) btn.addEventListener("click", function () {
                var selVal = document.getElementById("lc-cyc-char");
                if (!selVal) return;
                var p = s.characters[selVal.value];
                if (!p || !p.cycle || !p.cycle.enabled) return;
                new CycleManager(p).setPhase(phase);
                saveSettingsDebounced();
                renderCycle();
                renderDashboard();
            });
        })(phaseButtons[pi][0], phaseButtons[pi][1]);
    }

    var cycSkip = document.getElementById("lc-cyc-skip");
    if (cycSkip) cycSkip.addEventListener("click", function () {
        var selVal = document.getElementById("lc-cyc-char");
        if (!selVal) return;
        var p = s.characters[selVal.value];
        if (!p || !p.cycle || !p.cycle.enabled) return;
        p.cycle.currentDay = 1;
        p.cycle.cycleCount++;
        saveSettingsDebounced();
        renderCycle();
        renderDashboard();
    });

    // Heat/Rut
    var hrChar = document.getElementById("lc-hr-char");
    if (hrChar) hrChar.addEventListener("change", renderHeatRut);

    // Intimacy
    var intLog = document.getElementById("lc-int-log");
    if (intLog) intLog.addEventListener("click", function () {
        var t = document.getElementById("lc-int-t");
        if (!t || !t.value) return;
        var pEl = document.getElementById("lc-int-p");
        var tpEl = document.getElementById("lc-int-tp");
        var ejEl = document.getElementById("lc-int-ej");
        Intimacy.log({
            parts: [t.value, pEl ? pEl.value : ""].filter(Boolean),
            type: tpEl ? tpEl.value : "vaginal",
            ejac: ejEl ? ejEl.value : "unknown"
        });
        renderIntimLog();
    });

    var intRoll = document.getElementById("lc-int-roll");
    if (intRoll) intRoll.addEventListener("click", function () {
        var t = document.getElementById("lc-int-t");
        if (!t || !t.value) return;
        var pEl = document.getElementById("lc-int-p");
        var tpEl = document.getElementById("lc-int-tp");
        var ejEl = document.getElementById("lc-int-ej");
        var result = Intimacy.roll(t.value, {
            parts: [t.value, pEl ? pEl.value : ""].filter(Boolean),
            type: tpEl ? tpEl.value : "vaginal",
            ejac: ejEl ? ejEl.value : "unknown"
        });
        if (result.reason === "not_eligible") { toastr.warning("Этот персонаж не может забеременеть!"); return; }
        showDicePopup(result, t.value, false);
        renderDiceLog();
    });

    // Pregnancy
    var pregChar = document.getElementById("lc-preg-char");
    if (pregChar) pregChar.addEventListener("change", renderPregnancy);

    var pregAdv = document.getElementById("lc-preg-adv");
    if (pregAdv) pregAdv.addEventListener("click", function () {
        var sel = document.getElementById("lc-preg-char");
        if (!sel) return;
        var p = s.characters[sel.value];
        if (p && p.pregnancy && p.pregnancy.active) { new PregManager(p).advanceDay(7); saveSettingsDebounced(); renderPregnancy(); renderDashboard(); }
    });

    var pregSet = document.getElementById("lc-preg-set");
    if (pregSet) pregSet.addEventListener("click", function () {
        var sel = document.getElementById("lc-preg-char");
        if (!sel) return;
        var p = s.characters[sel.value];
        if (!p || !p.pregnancy || !p.pregnancy.active) return;
        var w = prompt("Установить неделю:");
        if (w) { p.pregnancy.week = clamp(parseInt(w), 1, p.pregnancy.maxWeeks); saveSettingsDebounced(); renderPregnancy(); }
    });

    var pregLabor = document.getElementById("lc-preg-labor");
    if (pregLabor) pregLabor.addEventListener("click", function () {
        var sel = document.getElementById("lc-preg-char");
        if (!sel) return;
        var p = s.characters[sel.value];
        if (!p || !p.pregnancy || !p.pregnancy.active) return;
        new LaborManager(p).start();
        saveSettingsDebounced();
        renderLabor();
        renderDashboard();
    });

    var pregEnd = document.getElementById("lc-preg-end");
    if (pregEnd) pregEnd.addEventListener("click", function () {
        var sel = document.getElementById("lc-preg-char");
        if (!sel) return;
        var p = s.characters[sel.value];
        if (!p || !p.pregnancy || !p.pregnancy.active || !confirm("Прервать беременность?")) return;
        p.pregnancy.active = false;
        if (p.cycle) p.cycle.enabled = true;
        saveSettingsDebounced();
        renderPregnancy();
        renderDashboard();
    });

    // Labor
    var laborChar = document.getElementById("lc-labor-char");
    if (laborChar) laborChar.addEventListener("change", renderLabor);

    var laborAdv = document.getElementById("lc-labor-adv");
    if (laborAdv) laborAdv.addEventListener("click", function () {
        var sel = document.getElementById("lc-labor-char");
        if (!sel) return;
        var p = s.characters[sel.value];
        if (p && p.labor && p.labor.active) { new LaborManager(p).advance(); saveSettingsDebounced(); renderLabor(); }
    });

    var laborDeliver = document.getElementById("lc-labor-deliver");
    if (laborDeliver) laborDeliver.addEventListener("click", function () {
        var sel = document.getElementById("lc-labor-char");
        if (!sel) return;
        var p = s.characters[sel.value];
        if (p && p.labor && p.labor.active) {
            showBabyForm(sel.value, (p.pregnancy && p.pregnancy.father) || "?");
        }
    });

    var laborEnd = document.getElementById("lc-labor-end");
    if (laborEnd) laborEnd.addEventListener("click", function () {
        var sel = document.getElementById("lc-labor-char");
        if (!sel) return;
        var p = s.characters[sel.value];
        if (p && p.labor && p.labor.active && confirm("Завершить роды?")) {
            new LaborManager(p).end();
            saveSettingsDebounced();
            renderLabor();
            renderDashboard();
        }
    });

    // Baby
    var babyPar = document.getElementById("lc-baby-par");
    if (babyPar) babyPar.addEventListener("change", renderBabies);

    var babyCreate = document.getElementById("lc-baby-create");
    if (babyCreate) babyCreate.addEventListener("click", function () { showBabyForm(null, null, null, null, true); });

    var babyList = document.getElementById("lc-baby-list");
    if (babyList) babyList.addEventListener("click", function (e) {
        var editBtn = e.target.closest(".lc-baby-edit");
        var delBtn = e.target.closest(".lc-baby-del");
        if (editBtn) {
            var baby = s.characters[editBtn.dataset.p] && s.characters[editBtn.dataset.p].babies && s.characters[editBtn.dataset.p].babies[parseInt(editBtn.dataset.i)];
            if (baby) showBabyForm(editBtn.dataset.p, baby.father, baby, parseInt(editBtn.dataset.i));
        }
        if (delBtn && confirm("Удалить ребёнка?")) {
            if (s.characters[delBtn.dataset.p] && s.characters[delBtn.dataset.p].babies) {
                s.characters[delBtn.dataset.p].babies.splice(parseInt(delBtn.dataset.i), 1);
                saveSettingsDebounced();
                renderBabies();
            }
        }
    });

    // Ovi
    var oviChar = document.getElementById("lc-ovi-char");
    if (oviChar) oviChar.addEventListener("change", renderOvi);

    var oviStart = document.getElementById("lc-ovi-start");
    if (oviStart) oviStart.addEventListener("click", function () {
        var sel = document.getElementById("lc-ovi-char");
        if (!sel) return;
        var p = s.characters[sel.value];
        if (p) { new OviManager(p).startCarrying(); saveSettingsDebounced(); renderOvi(); renderDashboard(); }
    });

    var oviAdv = document.getElementById("lc-ovi-adv");
    if (oviAdv) oviAdv.addEventListener("click", function () {
        var sel = document.getElementById("lc-ovi-char");
        if (!sel) return;
        var p = s.characters[sel.value];
        if (p && p.oviposition && p.oviposition.active) { new OviManager(p).advance(1); saveSettingsDebounced(); renderOvi(); renderDashboard(); }
    });

    var oviEnd = document.getElementById("lc-ovi-end");
    if (oviEnd) oviEnd.addEventListener("click", function () {
        var sel = document.getElementById("lc-ovi-char");
        if (!sel) return;
        var p = s.characters[sel.value];
        if (p && p.oviposition && p.oviposition.active) { new OviManager(p).end(); saveSettingsDebounced(); renderOvi(); renderDashboard(); }
    });

    // Profiles
    var profSave = document.getElementById("lc-prof-save");
    if (profSave) profSave.addEventListener("click", function () { Profiles.save(); renderProfiles(); toastr.success("Профиль сохранён!"); });

    var profReload = document.getElementById("lc-prof-reload");
    if (profReload) profReload.addEventListener("click", async function () { Profiles.load(); await syncChars(); rebuild(); toastr.info("Перезагружено!"); });

    var profList = document.getElementById("lc-prof-list");
    if (profList) profList.addEventListener("click", function (e) {
        var loadBtn = e.target.closest(".lc-prof-load");
        var delBtn = e.target.closest(".lc-prof-del");
        if (loadBtn) {
            var pr = s.chatProfiles && s.chatProfiles[loadBtn.dataset.id];
            if (pr) {
                s.characters = JSON.parse(JSON.stringify(pr.characters || {}));
                s.relationships = JSON.parse(JSON.stringify(pr.relationships || []));
                s.worldDate = JSON.parse(JSON.stringify(pr.worldDate || DEFAULTS.worldDate));
                s.currentChatId = loadBtn.dataset.id;
                saveSettingsDebounced();
                rebuild();
                toastr.success("Профиль загружен!");
            }
        }
        if (delBtn && confirm("Удалить профиль?")) { Profiles.del(delBtn.dataset.id); renderProfiles(); }
    });

    // Settings: Modules
    var moduleBindings = { "lc-mc": "cycle", "lc-mp": "pregnancy", "lc-ml": "labor", "lc-mb": "baby", "lc-mi": "intimacy" };
    var modKeys = Object.keys(moduleBindings);
    for (var mi = 0; mi < modKeys.length; mi++) {
        (function (id, key) {
            var el = document.getElementById(id);
            if (el) el.addEventListener("change", function () { s.modules[key] = this.checked; saveSettingsDebounced(); });
        })(modKeys[mi], moduleBindings[modKeys[mi]]);
    }

    var mauEl = document.getElementById("lc-mau");
    if (mauEl) mauEl.addEventListener("change", function () { s.modules.auOverlay = this.checked; saveSettingsDebounced(); });

    var oviOnEl = document.getElementById("lc-ovi-on");
    if (oviOnEl) oviOnEl.addEventListener("change", function () { s.auSettings.oviposition.enabled = this.checked; saveSettingsDebounced(); });

    var llmEl = document.getElementById("lc-sllm");
    if (llmEl) llmEl.addEventListener("change", function () { s.useLLMParsing = this.checked; saveSettingsDebounced(); });

    // Settings: Automation
    var autoBindings = {
        "lc-sa": "autoSyncCharacters", "lc-sp": "autoParseCharInfo",
        "lc-sc": "parseFullChat", "lc-sd": "autoDetectIntimacy",
        "lc-sr": "autoRollOnSex", "lc-sw": "showStatusWidget",
        "lc-st": "autoTimeProgress"
    };
    var autoKeys = Object.keys(autoBindings);
    for (var ai = 0; ai < autoKeys.length; ai++) {
        (function (id, key) {
            var el = document.getElementById(id);
            if (el) el.addEventListener("change", function () { s[key] = this.checked; saveSettingsDebounced(); });
        })(autoKeys[ai], autoBindings[autoKeys[ai]]);
    }

    // Settings: Prompt
    var ponEl = document.getElementById("lc-pon");
    if (ponEl) ponEl.addEventListener("change", function () { s.promptInjectionEnabled = this.checked; saveSettingsDebounced(); });

    var pposEl = document.getElementById("lc-ppos");
    if (pposEl) pposEl.addEventListener("change", function () { s.promptInjectionPosition = this.value; saveSettingsDebounced(); });

    var aupEl = document.getElementById("lc-aup");
    if (aupEl) aupEl.addEventListener("change", function () { s.auPreset = this.value; saveSettingsDebounced(); });

    // Settings: Date
    var dateApply = document.getElementById("lc-da");
    if (dateApply) dateApply.addEventListener("click", function () {
        s.worldDate.year = parseInt(document.getElementById("lc-dy").value) || 2025;
        s.worldDate.month = clamp(parseInt(document.getElementById("lc-dm").value) || 1, 1, 12);
        s.worldDate.day = clamp(parseInt(document.getElementById("lc-dd").value) || 1, 1, 31);
        s.worldDate.hour = clamp(parseInt(document.getElementById("lc-dh").value) || 12, 0, 23);
        saveSettingsDebounced();
        renderDashboard();
    });

    var d1Btn = document.getElementById("lc-d1");
    if (d1Btn) d1Btn.addEventListener("click", function () { TimeParse.apply({ days: 1 }); rebuild(); });

    var d7Btn = document.getElementById("lc-d7");
    if (d7Btn) d7Btn.addEventListener("click", function () { TimeParse.apply({ days: 7 }); rebuild(); });

    var dfEl = document.getElementById("lc-df");
    if (dfEl) dfEl.addEventListener("change", function () { s.worldDate.frozen = this.checked; saveSettingsDebounced(); });

    // Export
    var expBtn = document.getElementById("lc-exp");
    if (expBtn) expBtn.addEventListener("click", function () {
        var blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "bunnycycle_" + Date.now() + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // Import
    var impBtn = document.getElementById("lc-imp");
    if (impBtn) impBtn.addEventListener("click", function () {
        var input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.addEventListener("change", function (e) {
            var file = e.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function (ev) {
                try {
                    extension_settings[EXT] = deepMerge(DEFAULTS, JSON.parse(ev.target.result));
                    saveSettingsDebounced();
                    var oldPanel = document.getElementById("bunnycycle-panel");
                    if (oldPanel) oldPanel.remove();
                    init();
                    toastr.success("Импортировано!");
                } catch (err) {
                    toastr.error("Ошибка JSON: " + err.message);
                }
            };
            reader.readAsText(file);
        });
        input.click();
    });

    // Reset
    var rstBtn = document.getElementById("lc-rst");
    if (rstBtn) rstBtn.addEventListener("click", function () {
        if (!confirm("Полный сброс всех данных BunnyCycle?")) return;
        extension_settings[EXT] = JSON.parse(JSON.stringify(DEFAULTS));
        saveSettingsDebounced();
        var oldPanel = document.getElementById("bunnycycle-panel");
        if (oldPanel) oldPanel.remove();
        init();
    });
}

// ========================
// MESSAGE HOOK
// ========================
async function onMessageReceived(messageIndex) {
    var s = S();
    if (!s.enabled) return;

    var ctx = getContext();
    if (!ctx || !ctx.chat || messageIndex < 0) return;

    var msg = ctx.chat[messageIndex];
    if (!msg || !msg.mes || msg.is_user) return;

    if (s.autoSyncCharacters) await syncChars();

    if (s.autoTimeProgress && !s.worldDate.frozen) {
        var timeResult = TimeParse.parse(msg.mes);
        if (timeResult) {
            TimeParse.apply(timeResult);
            rebuild();
        }
    }

    if (s.autoDetectIntimacy && s.modules.intimacy) {
        var detection = SexDetect.detect(msg.mes, s.characters);
        if (detection && detection.detected) {
            Intimacy.log({
                parts: detection.participants,
                type: detection.type,
                ejac: detection.ejac,
                auto: true
            });

            if (s.autoRollOnSex && detection.target && detection.type === "vaginal" && (detection.ejac === "inside" || detection.ejac === "unknown")) {
                var rollResult = Intimacy.roll(detection.target, {
                    parts: detection.participants,
                    type: detection.type,
                    ejac: detection.ejac,
                    condom: detection.condom,
                    noCondom: detection.noCondom,
                    auto: true
                });
                if (rollResult.reason !== "not_eligible") {
                    showDicePopup(rollResult, detection.target, true);
                }
            }
        }
    }

    if (s.showStatusWidget) injectWidget(messageIndex);
    renderDashboard();
}

// ========================
// INITIALIZATION
// ========================
async function init() {
    try {
        console.log("[BunnyCycle] Initializing...");

        if (!extension_settings[EXT]) {
            extension_settings[EXT] = JSON.parse(JSON.stringify(DEFAULTS));
        } else {
            extension_settings[EXT] = deepMerge(
                JSON.parse(JSON.stringify(DEFAULTS)),
                extension_settings[EXT]
            );
        }

        // Remove old panel if exists
        var oldPanel = document.getElementById("bunnycycle-panel");
        if (oldPanel) oldPanel.remove();

        // Find container
        var container = document.getElementById("extensions_settings2") || document.getElementById("extensions_settings");
        if (!container) {
            console.warn("[BunnyCycle] No extensions container found!");
            return;
        }

        // Insert HTML
        var html = generateHTML();
        container.insertAdjacentHTML("beforeend", html);
        console.log("[BunnyCycle] HTML inserted");

        // Load profile
        Profiles.load();

        // Sync characters
        await syncChars();

        // Bind events
        bindAll();

        // Initial render
        rebuild();

        // Register event listeners
        if (eventSource) {
            eventSource.on(event_types.MESSAGE_RECEIVED, function (idx) {
                onMessageReceived(idx);
            });

            eventSource.on(event_types.CHAT_CHANGED, async function () {
                ChatAnalyzer.clearCache();
                Profiles.load();
                await syncChars();
                rebuild();
            });

            eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, function (data) {
                var s = S();
                if (!s.enabled || !s.promptInjectionEnabled) return;
                var injection = Prompt.generate();
                if (!injection) return;
                if (s.promptInjectionPosition === "system" && data.systemPrompt !== undefined) {
                    data.systemPrompt += "\n\n" + injection;
                } else if (s.promptInjectionPosition === "authornote") {
                    data.authorNote = (data.authorNote || "") + "\n\n" + injection;
                }
            });
        }

        console.log("[BunnyCycle v1.0.0] Successfully loaded!");
    } catch (err) {
        console.error("[BunnyCycle] Initialization error:", err);
    }
}

// Start
jQuery(async function () {
    await init();
});

// Global API
window.BunnyCycle = {
    getSettings: function () { return S(); },
    sync: syncChars,
    advanceTime: function (days) { TimeParse.apply({ days: days }); rebuild(); },
    rollDice: function (target, data) { return Intimacy.roll(target, data); },
    canGetPregnant: canGetPregnant,
    CharAnalyzer: CharAnalyzer,
    ChatAnalyzer: ChatAnalyzer
};
