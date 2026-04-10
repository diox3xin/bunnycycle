// BunnyCycle v1.3.0 — Full index.js (ALL FEATURES)
// PART 1/3: Core + Managers
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const EXT = "bunnycycle";

// ========================
// COMPLICATIONS LISTS
// ========================
var PREG_COMPLICATIONS = [
    "Преэклампсия", "Гестационный диабет", "Предлежание плаценты",
    "Многоводие", "Маловодие", "Тонус матки", "Анемия",
    "Тяжёлый токсикоз", "Угроза преждевременных родов", "ЗВУР",
    "Резус-конфликт", "Истмико-цервикальная недостаточность",
    "Отёки", "Гипертонус", "Низкая плацентация"
];
var LABOR_COMPLICATIONS = [
    "Слабость родовой деятельности", "Стремительные роды",
    "Разрыв промежности", "Кровотечение", "Обвитие пуповиной",
    "Дистоция плечиков", "Гипоксия плода", "Отслойка плаценты",
    "Выпадение пуповины", "Разрыв матки", "Эмболия", "Задержка плаценты"
];

// ========================
// DEFAULTS (FULL — all AU settings included)
// ========================
var DEFAULTS = {
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
    worldDate: { year: 2025, month: 1, day: 1, hour: 12, minute: 0, frozen: false },
    autoTimeProgress: true,
    promptInjectionEnabled: true,
    promptInjectionPosition: "authornote",
    auPreset: "realism",
    auSettings: {
        omegaverse: {
            heatCycleLength: 30,
            heatDuration: 5,
            heatFertilityBonus: 0.35,
            preHeatDays: 1,
            postHeatDays: 1,
            heatIntensity: "moderate",
            rutCycleLength: 35,
            rutDuration: 4,
            preRutDays: 1,
            postRutDays: 1,
            rutIntensity: "moderate",
            knotEnabled: true,
            knotDurationMin: 30,
            bondingEnabled: true,
            bondingType: "bite",
            bondEffectEmpathy: true,
            bondEffectProximity: true,
            bondEffectProtective: true,
            bondBreakable: false,
            bondWithdrawalDays: 7,
            suppressantsAvailable: true,
            suppressantEffectiveness: 0.85,
            suppressantSideEffects: true,
            slickEnabled: true,
            scentEnabled: true,
            nestingEnabled: true,
            purringEnabled: true,
            maleOmegaPregnancy: true,
            pregnancyWeeks: 36,
            twinChance: 0.1,
            alphaCommandVoice: true,
            omegaSubmission: true
        },
        fantasy: {
            pregnancyByRace: {
                human: 40, elf: 60, dwarf: 35, orc: 32, demon: 28,
                vampire: 50, werewolf: 9, fairy: 20, dragon: 80, halfling: 38
            },
            magicPregnancy: false,
            acceleratedPregnancy: false,
            accelerationFactor: 1.0
        },
        oviposition: {
            enabled: false,
            eggCountMin: 1,
            eggCountMax: 6,
            gestationDays: 14,
            layingDuration: 3,
            incubationDays: 21,
            fertilizationChance: 0.7,
            shellType: "hard",
            eggSize: "medium",
            painLevel: "moderate",
            aftercareDays: 2
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
    for (var i = 0; i < keys.length; i++) result[keys[i]] = target[keys[i]];
    var skeys = Object.keys(source);
    for (var j = 0; j < skeys.length; j++) {
        var sk = skeys[j];
        if (source[sk] && typeof source[sk] === "object" && !Array.isArray(source[sk]) && result[sk] && typeof result[sk] === "object" && !Array.isArray(result[sk])) {
            result[sk] = deepMerge(result[sk], source[sk]);
        } else { result[sk] = source[sk]; }
    }
    return result;
}
function S() { return extension_settings[EXT]; }
function formatDate(d) {
    if (!d) return "-";
    return d.year + "/" + String(d.month).padStart(2, "0") + "/" + String(d.day).padStart(2, "0") + " " + String(d.hour).padStart(2, "0") + ":" + String(d.minute).padStart(2, "0");
}
function addDaysToDate(d, n) {
    var dt = new Date(d.year, d.month - 1, d.day, d.hour, d.minute);
    dt.setDate(dt.getDate() + n);
    return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate(), hour: dt.getHours(), minute: dt.getMinutes(), frozen: d.frozen };
}
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
function roll100() { return Math.floor(Math.random() * 100) + 1; }
function makeId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function canGetPregnant(p) {
    if (!p || !p._enabled) return false;
    if (p.bioSex === "F") return true;
    var s = S();
    if (p.bioSex === "M" && s.modules.auOverlay && s.auPreset === "omegaverse" && s.auSettings.omegaverse.maleOmegaPregnancy && p.secondarySex === "omega") return true;
    return false;
}

// ========================
// LLM CALLER
// ========================
var LLM = {
    call: async function (sys, usr) {
        try {
            if (typeof window.SillyTavern !== "undefined") {
                var ctx = window.SillyTavern.getContext();
                if (ctx && typeof ctx.generateRaw === "function") {
                    var resp = await ctx.generateRaw(sys + "\n\n" + usr, "", false, false, "[BunnyCycle]");
                    if (resp) return resp;
                }
            }
            if (typeof generateRaw === "function") {
                var resp2 = await generateRaw(sys + "\n\n" + usr, "", false, false);
                if (resp2) return resp2;
            }
            var fetchResp = await fetch("/api/backends/chat/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: [{ role: "system", content: sys }, { role: "user", content: usr }], max_tokens: 500, temperature: 0.05, stream: false })
            });
            if (fetchResp.ok) {
                var data = await fetchResp.json();
                return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || data.content || data.response || "";
            }
            return null;
        } catch (err) { console.warn("[BunnyCycle] LLM call failed:", err.message); return null; }
    },
    parseJSON: function (text) {
        if (!text) return null;
        var clean = text.trim().replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "");
        var match = clean.match(/{[\s\S]*}/);
        if (!match) return null;
        try { return JSON.parse(match[0]); } catch (e) { return null; }
    }
};

// ========================
// CHARACTER ANALYZER
// ========================
var CharAnalyzer = {
    _cache: {},
    SYSTEM: "You analyze character sheets. Determine biological sex from description context. Extract eye color, hair color. Respond with ONLY valid JSON.",
    analyze: async function (name, charObj, isUser) {
        var cacheKey = "c_" + name + "_" + ((charObj && charObj.data && charObj.data.description) ? charObj.data.description.length : 0);
        if (this._cache[cacheKey]) return this._cache[cacheKey];
        var desc = "", pers = "", other = "";
        if (isUser) {
            try { if (typeof power_user !== "undefined" && power_user.persona_description) desc = power_user.persona_description; var ctx = getContext(); if (ctx && ctx.persona) desc += "\n" + ctx.persona; } catch (e) {}
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
        try {
            var ctx2 = getContext();
            if (ctx2 && ctx2.worldInfo) {
                var entries = Object.values(ctx2.worldInfo);
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i]; var keys = (entry.key || []).join(" ");
                    if (keys.toLowerCase().indexOf(name.toLowerCase()) !== -1) other += "\nLorebook: " + (entry.content || "").substring(0, 500);
                }
            }
        } catch (e) {}
        if (desc.length < 10 && other.length < 10) return null;
        var userPrompt = "Character: " + name + "\nDescription:\n" + desc.substring(0, 3000) + "\nPersonality: " + pers.substring(0, 1000) + "\nOther: " + other.substring(0, 1500) +
            '\n\nReturn JSON: {"biologicalSex":"M" or "F" or null,"sexConfidence":0-100,"secondarySex":"alpha"/"beta"/"omega"/null,"race":string or null,"eyeColor":string or null,"hairColor":string or null,"canLayEggs":false,"reasoning":"brief"}';
        var raw = await LLM.call(this.SYSTEM, userPrompt);
        var parsed = LLM.parseJSON(raw);
        if (parsed) { this._cache[cacheKey] = parsed; }
        return parsed;
    },
    clearCache: function () { this._cache = {}; }
};

// ========================
// CHAT ANALYZER
// ========================
var ChatAnalyzer = {
    _cache: {}, _lastMessageCount: 0,
    SYSTEM: "You analyze roleplay chat. Only report ACTUAL events. Return ONLY valid JSON.",
    analyze: async function (messages, characterNames) {
        if (!messages || !messages.length) return null;
        var cacheKey = "ch_" + characterNames.sort().join("_") + "_" + messages.length;
        if (this._cache[cacheKey]) return this._cache[cacheKey];
        var recent = messages.slice(-60);
        var msgTexts = [];
        for (var i = 0; i < recent.length; i++) {
            var m = recent[i];
            msgTexts.push("[" + i + "] " + (m.is_user ? (m.name || "User") : (m.name || "AI")) + ": " + (m.mes || "").substring(0, 500));
        }
        var userPrompt = "Characters: " + characterNames.join(", ") + "\nMessages:\n" + msgTexts.join("\n\n").substring(0, 12000) +
            '\n\nReturn JSON:\n{"events":[],"children":[{"name":"","sex":"M"|"F"|null,"mother":""|null,"father":""|null,"exists":true|false}],"currentStates":{"charName":{"pregnant":false,"pregnancyWeek":null,"inLabor":false,"inHeat":false,"inRut":false,"hasGivenBirth":false}}}';
        var raw = await LLM.call(this.SYSTEM, userPrompt);
        var parsed = LLM.parseJSON(raw);
        if (parsed) { this._cache[cacheKey] = parsed; this._lastMessageCount = messages.length; }
        return parsed;
    },
    shouldReanalyze: function (messages) { return messages && messages.length - this._lastMessageCount >= 5; },
    clearCache: function () { this._cache = {}; this._lastMessageCount = 0; }
};

// ========================
// SEX DETECTOR
// ========================
var SexDetect = {
    PATTERNS: [
        /вошё?л\s*(в\s*неё|внутрь)/i, /проник\w*\s*(в\s*неё|внутрь)/i,
        /член\s*(?:вошёл|внутри)/i, /кончил\s*(внутрь|в\s*неё|глубоко)/i,
        /трахал|ебал|выебал/i, /фрикци/i, /узел\s*(?:набух|внутри)/i,
        /(?:thrust|pushed|slid)\s*inside/i, /penetrat/i, /fuck(?:ed|ing)\s/i,
        /cum\w*\s*inside/i, /creampie/i, /knot\w*\s*inside/i
    ],
    detect: function (text, chars) {
        if (!text) return null;
        var score = 0;
        for (var i = 0; i < this.PATTERNS.length; i++) { if (this.PATTERNS[i].test(text)) score++; }
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
            if (text.toLowerCase().indexOf(names[j].toLowerCase()) !== -1 || chars[names[j]]._isUser) participants.push(names[j]);
        }
        if (participants.length < 2 && names.length >= 2) {
            for (var k = 0; k < names.length; k++) { if (participants.indexOf(names[k]) === -1) participants.push(names[k]); if (participants.length >= 2) break; }
        }
        var target = null;
        for (var m = 0; m < participants.length; m++) { if (chars[participants[m]] && canGetPregnant(chars[participants[m]])) { target = participants[m]; break; } }
        return { detected: true, type: type, condom: hasCondom && !noCondom, noCondom: noCondom, ejac: ejac, participants: participants, target: target };
    }
};

// ========================
// CYCLE MANAGER
// ========================
function CycleManager(profile) { this.p = profile; this.c = profile.cycle; }
CycleManager.prototype.phase = function () {
    if (!this.c || !this.c.enabled) return "unknown";
    var d = this.c.currentDay, len = this.c.length;
    var ovDay = Math.round(len - 14);
    if (d <= this.c.menstruationDuration) return "menstruation";
    if (d < ovDay - 2) return "follicular";
    if (d <= ovDay + 1) return "ovulation";
    return "luteal";
};
CycleManager.prototype.label = function (ph) { return ({ menstruation: "Менструация", follicular: "Фолликулярная", ovulation: "Овуляция", luteal: "Лютеиновая", unknown: "-" })[ph] || ph; };
CycleManager.prototype.emoji = function (ph) { return ({ menstruation: "\uD83D\uDD34", follicular: "\uD83C\uDF38", ovulation: "\uD83E\uDD5A", luteal: "\uD83C\uDF19" })[ph] || "?"; };
CycleManager.prototype.fertility = function () {
    var base = ({ ovulation: 0.25, follicular: 0.08, luteal: 0.02, menstruation: 0.01 })[this.phase()] || 0.05;
    var s = S();
    if (s.modules.auOverlay && s.auPreset === "omegaverse" && this.p.heat && this.p.heat.active) base += s.auSettings.omegaverse.heatFertilityBonus;
    return Math.min(base, 0.95);
};
CycleManager.prototype.libido = function () {
    if ((this.p.heat && this.p.heat.active) || (this.p.rut && this.p.rut.active)) return "экстремальное";
    return ({ ovulation: "высокое", follicular: "среднее", luteal: "низкое", menstruation: "низкое" })[this.phase()] || "среднее";
};
CycleManager.prototype.symptoms = function () {
    var ph = this.phase(), r = [];
    if (ph === "menstruation") { r.push("кровотечение"); r.push("спазмы"); }
    if (ph === "ovulation") r.push("повышенное либидо");
    if (ph === "luteal") r.push("ПМС");
    if (ph === "follicular") r.push("прилив энергии");
    return r;
};
CycleManager.prototype.discharge = function () {
    return ({ menstruation: "менструальные", follicular: "скудные", ovulation: "обильные, тягучие", luteal: "густые, кремообразные" })[this.phase()] || "обычные";
};
CycleManager.prototype.advance = function (days) {
    for (var i = 0; i < days; i++) {
        this.c.currentDay++;
        if (this.c.currentDay > this.c.length) {
            this.c.currentDay = 1; this.c.cycleCount++;
            if (this.c.irregularity > 0) this.c.length = clamp(this.c.baseLength + Math.floor(Math.random() * this.c.irregularity * 2) - this.c.irregularity, 21, 45);
        }
    }
};
CycleManager.prototype.setDay = function (d) { this.c.currentDay = clamp(d, 1, this.c.length); };
CycleManager.prototype.setPhase = function (ph) {
    var ovDay = Math.round(this.c.length - 14);
    var map = { menstruation: 1, follicular: this.c.menstruationDuration + 1, ovulation: ovDay, luteal: ovDay + 2 };
    if (map[ph]) this.c.currentDay = map[ph];
};

// ========================
// HEAT/RUT MANAGER
// ========================
function HeatRutManager(profile) { this.p = profile; }
HeatRutManager.prototype.heatPhase = function () {
    var h = this.p.heat; if (!h) return "rest";
    var cfg = S().auSettings.omegaverse || {};
    if (h.active) {
        if (h.currentDay <= (cfg.preHeatDays || 1)) return "preHeat";
        if (h.currentDay <= h.duration - (cfg.postHeatDays || 1)) return "heat";
        return "postHeat";
    }
    if ((h.cycleDays - (h.daysSinceLast || 0)) <= 3) return "preHeat";
    return "rest";
};
HeatRutManager.prototype.rutPhase = function () {
    var r = this.p.rut; if (!r) return "rest";
    var cfg = S().auSettings.omegaverse || {};
    if (r.active) {
        if (r.currentDay <= (cfg.preRutDays || 1)) return "preRut";
        if (r.currentDay <= r.duration - (cfg.postRutDays || 1)) return "rut";
        return "postRut";
    }
    if ((r.cycleDays - (r.daysSinceLast || 0)) <= 3) return "preRut";
    return "rest";
};
HeatRutManager.prototype.heatLabel = function (ph) { return ({ preHeat: "Предтечка", heat: "Течка", postHeat: "Посттечка", rest: "Покой" })[ph] || ph; };
HeatRutManager.prototype.rutLabel = function (ph) { return ({ preRut: "Предгон", rut: "Гон", postRut: "Постгон", rest: "Покой" })[ph] || ph; };
HeatRutManager.prototype.heatDaysLeft = function () { var h = this.p.heat; if (!h || h.active) return 0; return Math.max(0, h.cycleDays - (h.daysSinceLast || 0)); };
HeatRutManager.prototype.rutDaysLeft = function () { var r = this.p.rut; if (!r || r.active) return 0; return Math.max(0, r.cycleDays - (r.daysSinceLast || 0)); };
HeatRutManager.prototype.advanceHeat = function (days) {
    var h = this.p.heat; if (!h || h.onSuppressants) return;
    var cfg = S().auSettings.omegaverse || {};
    h.cycleDays = cfg.heatCycleLength || 30; h.duration = cfg.heatDuration || 5;
    for (var i = 0; i < days; i++) {
        if (h.active) { h.currentDay++; if (h.currentDay > h.duration) { h.active = false; h.currentDay = 0; h.daysSinceLast = 0; } }
        else { h.daysSinceLast = (h.daysSinceLast || 0) + 1; if (h.daysSinceLast >= h.cycleDays) { h.active = true; h.currentDay = 1; } }
    }
};
HeatRutManager.prototype.advanceRut = function (days) {
    var r = this.p.rut; if (!r) return;
    var cfg = S().auSettings.omegaverse || {};
    r.cycleDays = cfg.rutCycleLength || 35; r.duration = cfg.rutDuration || 4;
    for (var i = 0; i < days; i++) {
        if (r.active) { r.currentDay++; if (r.currentDay > r.duration) { r.active = false; r.currentDay = 0; r.daysSinceLast = 0; } }
        else { r.daysSinceLast = (r.daysSinceLast || 0) + 1; if (r.daysSinceLast >= r.cycleDays) { r.active = true; r.currentDay = 1; } }
    }
};

// ========================
// BOND MANAGER
// ========================
function BondManager(profile) {
    this.p = profile;
    if (!profile.bond) profile.bond = { bonded: false, partner: null, type: null, strength: 0, daysSinceSeparation: 0, withdrawalActive: false, markLocation: "" };
    this.b = profile.bond;
}
BondManager.prototype.canBond = function () {
    var s = S();
    return s.modules.auOverlay && s.auPreset === "omegaverse" && s.auSettings.omegaverse.bondingEnabled && !this.b.bonded;
};
BondManager.prototype.createBond = function (partnerName) {
    var cfg = S().auSettings.omegaverse;
    this.b.bonded = true; this.b.partner = partnerName; this.b.type = cfg.bondingType || "bite";
    this.b.strength = 50; this.b.daysSinceSeparation = 0; this.b.withdrawalActive = false;
    this.b.markLocation = this.b.type === "bite" ? "шея" : "";
    Rels.add(this.p.name, partnerName, "связь (бонд)", this.b.type);
    Rels.add(partnerName, this.p.name, "связь (бонд)", this.b.type);
    saveSettingsDebounced();
};
BondManager.prototype.breakBond = function () {
    var cfg = S().auSettings.omegaverse;
    if (!cfg.bondBreakable && this.b.bonded) { toastr.warning("Связь нельзя разорвать!"); return false; }
    var partner = this.b.partner;
    this.b.bonded = false; this.b.partner = null; this.b.strength = 0; this.b.withdrawalActive = true; this.b.daysSinceSeparation = 0;
    if (partner) {
        var s = S(); var pp = s.characters[partner];
        if (pp && pp.bond && pp.bond.bonded && pp.bond.partner === this.p.name) {
            pp.bond.bonded = false; pp.bond.partner = null; pp.bond.strength = 0;
            pp.bond.withdrawalActive = true; pp.bond.daysSinceSeparation = 0;
        }
    }
    saveSettingsDebounced(); return true;
};
BondManager.prototype.advance = function (days) {
    if (!this.b.bonded && !this.b.withdrawalActive) return;
    var cfg = S().auSettings.omegaverse;
    if (this.b.bonded) this.b.strength = Math.min(100, this.b.strength + days * 2);
    if (this.b.withdrawalActive) { this.b.daysSinceSeparation += days; if (this.b.daysSinceSeparation >= (cfg.bondWithdrawalDays || 7)) this.b.withdrawalActive = false; }
};
BondManager.prototype.statusLabel = function () {
    if (this.b.bonded) return "Связан с " + this.b.partner + " (" + this.b.strength + "%)";
    if (this.b.withdrawalActive) return "Ломка (день " + this.b.daysSinceSeparation + ")";
    return "Нет связи";
};
BondManager.prototype.effects = function () {
    if (!this.b.bonded) return [];
    var cfg = S().auSettings.omegaverse; var result = [];
    if (cfg.bondEffectEmpathy) result.push("эмпатия");
    if (cfg.bondEffectProximity) result.push("тяга к партнёру");
    if (cfg.bondEffectProtective) result.push("защитный инстинкт");
    return result;
};

// ========================
// PREGNANCY MANAGER (with manual start + complications)
// ========================
function PregManager(profile) { this.p = profile; this.pr = profile.pregnancy; }
PregManager.prototype.isActive = function () { return this.pr && this.pr.active; };
PregManager.prototype.start = function (father, count, sexes, startWeek) {
    var s = S();
    this.pr.active = true; this.pr.week = startWeek || 1; this.pr.day = 0; this.pr.father = father || "?";
    var baseCount = count || 1;
    if (s.modules.auOverlay && s.auPreset === "omegaverse" && !count && Math.random() < (s.auSettings.omegaverse.twinChance || 0)) baseCount = 2;
    this.pr.fetusCount = baseCount;
    this.pr.fetusSexes = [];
    for (var i = 0; i < this.pr.fetusCount; i++) {
        if (sexes && sexes[i]) this.pr.fetusSexes.push(sexes[i]);
        else this.pr.fetusSexes.push(Math.random() < 0.5 ? "M" : "F");
    }
    this.pr.complications = []; this.pr.weightGain = 0;
    var maxWeeks = 40;
    if (s.modules.auOverlay) {
        if (s.auPreset === "omegaverse") maxWeeks = s.auSettings.omegaverse.pregnancyWeeks || 36;
        if (s.auPreset === "fantasy") {
            var rw = s.auSettings.fantasy.pregnancyByRace[this.p.race];
            if (rw) maxWeeks = rw;
            if (s.auSettings.fantasy.acceleratedPregnancy) maxWeeks = Math.max(4, Math.round(maxWeeks / (s.auSettings.fantasy.accelerationFactor || 1)));
        }
    }
    this.pr.maxWeeks = maxWeeks;
    if (this.p.cycle) this.p.cycle.enabled = false;
};
PregManager.prototype.advanceDay = function (days) { if (!this.isActive()) return; this.pr.day += days; while (this.pr.day >= 7) { this.pr.day -= 7; this.pr.week++; } };
PregManager.prototype.trimester = function () { if (this.pr.week <= 12) return 1; if (this.pr.week <= 27) return 2; return 3; };
PregManager.prototype.size = function () { var map = [[4, "маковое зерно"], [8, "малина"], [12, "лайм"], [16, "авокадо"], [20, "банан"], [28, "баклажан"], [36, "дыня"], [40, "арбуз"]]; var r = "эмбрион"; for (var i = 0; i < map.length; i++) { if (this.pr.week >= map[i][0]) r = map[i][1]; } return r; };
PregManager.prototype.symptoms = function () { var w = this.pr.week, r = []; if (w >= 4 && w <= 14) r.push("тошнота"); if (w >= 14) r.push("рост живота"); if (w >= 18) r.push("шевеления"); if (w >= 28) r.push("одышка"); return r; };
PregManager.prototype.movements = function () { var w = this.pr.week; if (w < 16) return "нет"; if (w < 22) return "бабочки"; if (w < 28) return "толчки"; return "активные"; };
PregManager.prototype.addRandomComplication = function () {
    var available = PREG_COMPLICATIONS.filter(function (c) { return this.pr.complications.indexOf(c) === -1; }.bind(this));
    if (available.length === 0) return null;
    var comp = randomFrom(available); this.pr.complications.push(comp); return comp;
};
PregManager.prototype.clearComplications = function () { this.pr.complications = []; };
PregManager.prototype.removeComplication = function (comp) { this.pr.complications = this.pr.complications.filter(function (c) { return c !== comp; }); };

// ========================
// LABOR MANAGER (with complications)
// ========================
var LABOR_STAGES = ["latent", "active", "transition", "pushing", "birth", "placenta"];
var LABOR_LABELS = { latent: "Латентная", active: "Активная", transition: "Переходная", pushing: "Потуги", birth: "Рождение", placenta: "Плацента" };

function LaborManager(profile) { this.p = profile; this.l = profile.labor; }
LaborManager.prototype.start = function () {
    this.l.active = true; this.l.stage = "latent"; this.l.dilation = 0; this.l.hoursElapsed = 0;
    this.l.babiesDelivered = 0; this.l.totalBabies = (this.p.pregnancy && this.p.pregnancy.fetusCount) || 1; this.l.complications = [];
};
LaborManager.prototype.advance = function () {
    var idx = LABOR_STAGES.indexOf(this.l.stage); if (idx >= LABOR_STAGES.length - 1) return;
    this.l.stage = LABOR_STAGES[idx + 1];
    if (this.l.stage === "active") { this.l.dilation = 5; this.l.hoursElapsed += 5; }
    if (this.l.stage === "transition") { this.l.dilation = 8; this.l.hoursElapsed += 2; }
    if (this.l.stage === "pushing") this.l.dilation = 10;
};
LaborManager.prototype.description = function () {
    return ({ latent: "Лёгкие схватки, 0-3 см", active: "Сильные схватки, 4-7 см", transition: "Пик интенсивности, 7-10 см", pushing: "Полное раскрытие, потуги", birth: "Рождение ребёнка", placenta: "Рождение плаценты" })[this.l.stage] || "";
};
LaborManager.prototype.deliver = function () { this.l.babiesDelivered++; if (this.l.babiesDelivered >= this.l.totalBabies) this.l.stage = "placenta"; };
LaborManager.prototype.end = function () { this.l.active = false; this.p.pregnancy.active = false; if (this.p.cycle) { this.p.cycle.enabled = true; this.p.cycle.currentDay = 1; } };
LaborManager.prototype.addRandomComplication = function () {
    var available = LABOR_COMPLICATIONS.filter(function (c) { return this.l.complications.indexOf(c) === -1; }.bind(this));
    if (available.length === 0) return null;
    var comp = randomFrom(available); this.l.complications.push(comp); return comp;
};
LaborManager.prototype.clearComplications = function () { this.l.complications = []; };
LaborManager.prototype.removeComplication = function (comp) { this.l.complications = this.l.complications.filter(function (c) { return c !== comp; }); };

// ========================
// BABY MANAGER
// ========================
function BabyManager(baby) { this.b = baby; }
BabyManager.generate = function (mother, fatherName, overrides) {
    var s = S(); var ov = overrides || {};
    var sex = ov.sex || (Math.random() < 0.5 ? "M" : "F");
    var bw = 3200 + Math.floor(Math.random() * 800) - 400;
    return {
        name: ov.name || "", sex: sex, secondarySex: null, birthWeight: bw, currentWeight: bw,
        ageDays: ov.ageDays || 0, eyeColor: ov.eyeColor || (mother ? mother.eyeColor : "") || "",
        hairColor: ov.hairColor || (mother ? mother.hairColor : "") || "",
        mother: (mother ? mother.name : ov.mother) || "?", father: fatherName || ov.father || "?",
        state: "новорождённый", birthDate: JSON.parse(JSON.stringify(s.worldDate))
    };
};
BabyManager.prototype.age = function () { var d = this.b.ageDays; if (d < 1) return "новорождённый"; if (d < 30) return d + " дн."; if (d < 365) return Math.floor(d / 30) + " мес."; return Math.floor(d / 365) + " г."; };
BabyManager.prototype.update = function () { this.b.currentWeight = this.b.birthWeight + this.b.ageDays * (this.b.ageDays < 120 ? 30 : 7); if (this.b.ageDays < 28) this.b.state = "новорождённый"; else if (this.b.ageDays < 365) this.b.state = "младенец"; else this.b.state = "ребёнок"; };
BabyManager.prototype.milestones = function () {
    var d = this.b.ageDays, r = [];
    if (d >= 42) r.push("улыбка"); if (d >= 90) r.push("голову"); if (d >= 150) r.push("переворачивается");
    if (d >= 180) r.push("сидит"); if (d >= 270) r.push("ползает"); if (d >= 365) r.push("шаги");
    if (d >= 450) r.push("слова"); if (d >= 730) r.push("фразы");
    return r;
};

// ========================
// OVIPOSITION MANAGER
// ========================
var OVI_PHASES = { none: "Нет", carrying: "Вынашивание", laying: "Откладывание", incubating: "Инкубация", hatched: "Вылупление" };
function OviManager(profile) {
    this.p = profile;
    if (!profile.oviposition) profile.oviposition = { active: false, phase: "none", eggCount: 0, fertilizedCount: 0, gestationDay: 0, gestationMax: 14, layingDay: 0, layingMax: 3, incubationDay: 0, incubationMax: 21, eggs: [] };
    this.o = profile.oviposition;
}
OviManager.prototype.startCarrying = function () {
    var cfg = S().auSettings.oviposition;
    var count = cfg.eggCountMin + Math.floor(Math.random() * (cfg.eggCountMax - cfg.eggCountMin + 1));
    this.o.active = true; this.o.phase = "carrying"; this.o.eggCount = count; this.o.gestationDay = 0;
    this.o.gestationMax = cfg.gestationDays || 14; this.o.layingMax = cfg.layingDuration || 3; this.o.incubationMax = cfg.incubationDays || 21;
    this.o.eggs = [];
    for (var i = 0; i < count; i++) this.o.eggs.push({ fertilized: Math.random() < (cfg.fertilizationChance || 0.7) });
    this.o.fertilizedCount = this.o.eggs.filter(function (e) { return e.fertilized; }).length;
    if (this.p.cycle) this.p.cycle.enabled = false;
};
OviManager.prototype.advance = function (days) {
    if (!this.o.active) return;
    for (var i = 0; i < days; i++) {
        if (this.o.phase === "carrying") { this.o.gestationDay++; if (this.o.gestationDay >= this.o.gestationMax) { this.o.phase = "laying"; this.o.layingDay = 0; } }
        else if (this.o.phase === "laying") { this.o.layingDay++; if (this.o.layingDay >= this.o.layingMax) { this.o.phase = "incubating"; this.o.incubationDay = 0; if (this.p.cycle) this.p.cycle.enabled = true; } }
        else if (this.o.phase === "incubating") { this.o.incubationDay++; if (this.o.incubationDay >= this.o.incubationMax) this.o.phase = "hatched"; }
    }
};
OviManager.prototype.progress = function () {
    if (this.o.phase === "carrying") return Math.round((this.o.gestationDay / this.o.gestationMax) * 100);
    if (this.o.phase === "laying") return Math.round((this.o.layingDay / this.o.layingMax) * 100);
    if (this.o.phase === "incubating") return Math.round((this.o.incubationDay / this.o.incubationMax) * 100);
    return 100;
};
OviManager.prototype.end = function () { this.o.active = false; this.o.phase = "none"; this.o.eggs = []; if (this.p.cycle) this.p.cycle.enabled = true; };

// === END OF PART 1 ===
// Continue with PART 2...
// === PART 2/3: Systems + Rendering ===

// ========================
// INTIMACY / DICE
// ========================
var Intimacy = {
    log: function (entry) {
        var s = S(); entry.ts = formatDate(s.worldDate);
        s.intimacyLog.push(entry);
        if (s.intimacyLog.length > 100) s.intimacyLog = s.intimacyLog.slice(-100);
        saveSettingsDebounced();
    },
    roll: function (targetName, data) {
        var s = S(); var p = s.characters[targetName];
        if (!p || !canGetPregnant(p)) return { result: false, chance: 0, roll: 0, reason: "not_eligible" };
        var fertility = 0.05;
        if (p.cycle && p.cycle.enabled) fertility = new CycleManager(p).fertility();
        var contraEff = { none: 0, condom: 0.85, pill: 0.91, iud: 0.99, withdrawal: 0.73 };
        var ce = contraEff[p.contraception] || 0;
        if (data.noCondom) { /* no reduction */ }
        else if (data.condom) { fertility *= 0.15; }
        else { fertility *= (1 - ce); }
        if (data.ejac === "outside") fertility *= 0.05;
        if (data.type === "anal" || data.type === "oral") fertility = 0;
        if (p.pregnancy && p.pregnancy.active) fertility = 0;
        var chance = Math.round(clamp(fertility, 0, 0.95) * 100);
        var diceRoll = roll100();
        var success = diceRoll <= chance;
        var entry = {
            ts: formatDate(s.worldDate), target: targetName, parts: data.parts || [],
            chance: chance, roll: diceRoll, result: success, type: data.type, ejac: data.ejac, auto: data.auto || false
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
var REL_TYPES = ["мать", "отец", "ребёнок", "партнёр", "супруг(а)", "связь (бонд)", "брат", "сестра", "друг", "другое"];
var Rels = {
    get: function () { return S().relationships || []; },
    add: function (c1, c2, type, notes) {
        var s = S(); if (!s.relationships) s.relationships = [];
        if (s.relationships.some(function (r) { return r.char1 === c1 && r.char2 === c2 && r.type === type; })) return;
        s.relationships.push({ id: makeId(), char1: c1, char2: c2, type: type, notes: notes || "" });
        saveSettingsDebounced();
    },
    remove: function (id) { var s = S(); s.relationships = (s.relationships || []).filter(function (r) { return r.id !== id; }); saveSettingsDebounced(); },
    addBirth: function (mother, father, babyName) {
        if (mother) { this.add(mother, babyName, "мать", ""); this.add(babyName, mother, "ребёнок", ""); }
        if (father && father !== "?") { this.add(father, babyName, "отец", ""); this.add(babyName, father, "ребёнок", ""); }
    },
    toPrompt: function () {
        var r = this.get(); if (!r.length) return "";
        return "Relationships:\n" + r.map(function (x) { return x.char1 + " > " + x.char2 + ": " + x.type; }).join("\n");
    }
};

// ========================
// PROFILES
// ========================
var Profiles = {
    id: function () {
        var ctx = getContext(); if (!ctx) return null;
        if (ctx.groupId) return "g_" + ctx.groupId;
        if (ctx.characterId !== undefined && ctx.characters) { var ch = ctx.characters[ctx.characterId]; if (ch) return "c_" + ch.avatar + "_" + (ctx.chatId || "0"); }
        return null;
    },
    save: function () {
        var s = S(); var cid = this.id(); if (!cid) return; s.currentChatId = cid;
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
        var s = S(); var cid = this.id(); if (!cid || s.currentChatId === cid) return false;
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
        } else { s.characters = {}; s.relationships = []; s.diceLog = []; s.intimacyLog = []; }
        saveSettingsDebounced(); return true;
    },
    list: function () {
        var s = S(); var p = s.chatProfiles || {};
        return Object.keys(p).map(function (id) {
            var pr = p[id];
            return { id: id, count: Object.keys(pr.characters || {}).length, date: pr.worldDate ? formatDate(pr.worldDate) : "-", isCurrent: id === s.currentChatId };
        });
    },
    del: function (id) { var s = S(); if (s.chatProfiles && s.chatProfiles[id]) { delete s.chatProfiles[id]; saveSettingsDebounced(); } }
};

// ========================
// PROMPT INJECTION (includes complications + bond info)
// ========================
var Prompt = {
    generate: function () {
        var s = S(); if (!s.promptInjectionEnabled) return "";
        var lines = ["[BunnyCycle]", "Date: " + formatDate(s.worldDate)];
        var relText = Rels.toPrompt(); if (relText) lines.push(relText);
        var charNames = Object.keys(s.characters);
        for (var i = 0; i < charNames.length; i++) {
            var name = charNames[i]; var p = s.characters[name]; if (!p._enabled) continue;
            lines.push("--- " + name + " ---");
            lines.push("Sex: " + p.bioSex + (p.secondarySex ? "/" + p.secondarySex : ""));
            if (s.modules.cycle && p.cycle && p.cycle.enabled && !(p.pregnancy && p.pregnancy.active)) {
                var cm = new CycleManager(p);
                lines.push("Cycle D" + p.cycle.currentDay + "/" + p.cycle.length + " " + cm.label(cm.phase()) + " Fert:" + Math.round(cm.fertility() * 100) + "%");
            }
            if (s.modules.pregnancy && p.pregnancy && p.pregnancy.active) {
                var pm = new PregManager(p);
                var pregLine = "PREGNANT W" + p.pregnancy.week + "/" + p.pregnancy.maxWeeks + " " + pm.size() + " fetuses:" + p.pregnancy.fetusCount;
                pregLine += " sexes:[" + p.pregnancy.fetusSexes.join(",") + "]";
                if (p.pregnancy.complications.length > 0) pregLine += " COMPLICATIONS:" + p.pregnancy.complications.join(",");
                lines.push(pregLine);
            }
            if (s.modules.labor && p.labor && p.labor.active) {
                var laborLine = "LABOR: " + LABOR_LABELS[p.labor.stage] + " dilation:" + p.labor.dilation + "cm";
                if (p.labor.complications && p.labor.complications.length > 0) laborLine += " COMPLICATIONS:" + p.labor.complications.join(",");
                lines.push(laborLine);
            }
            if (p.heat && p.heat.active) lines.push("IN HEAT D" + p.heat.currentDay + "/" + p.heat.duration);
            if (p.rut && p.rut.active) lines.push("IN RUT D" + p.rut.currentDay + "/" + p.rut.duration);
            if (p.bond && p.bond.bonded) lines.push("BONDED to " + p.bond.partner + " (" + p.bond.type + ", " + p.bond.strength + "%)");
            if (p.bond && p.bond.withdrawalActive) lines.push("BOND WITHDRAWAL day " + p.bond.daysSinceSeparation);
            if (p.oviposition && p.oviposition.active) lines.push("OVI: " + OVI_PHASES[p.oviposition.phase] + " eggs:" + p.oviposition.eggCount);
            if (s.modules.baby && p.babies && p.babies.length > 0) {
                for (var j = 0; j < p.babies.length; j++) {
                    var b = p.babies[j]; lines.push("Child: " + (b.name || "?") + " " + new BabyManager(b).age());
                }
            }
        }
        if (s.modules.auOverlay) {
            var cfg = s.auSettings[s.auPreset];
            if (s.auPreset === "omegaverse" && cfg) {
                lines.push("[AU:Omegaverse] knot:" + (cfg.knotEnabled ? "yes" : "no") + " slick:" + (cfg.slickEnabled ? "yes" : "no") + " scent:" + (cfg.scentEnabled ? "yes" : "no") + " nesting:" + (cfg.nestingEnabled ? "yes" : "no"));
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
        if (!msg) return null; var days = 0;
        var patterns = [
            [/прошл[оа]\s+(\d+)\s+(?:дн|дней|день)/gi, 1], [/через\s+(\d+)\s+(?:дн|дней|день)/gi, 1],
            [/спустя\s+(\d+)\s+(?:дн|дней|день)/gi, 1], [/прошл[оа]\s+(\d+)\s+(?:недел|нед)/gi, 7],
            [/через\s+(\d+)\s+(?:недел|нед)/gi, 7], [/прошл[оа]\s+(\d+)\s+(?:месяц|мес)/gi, 30],
            [/(\d+)\s+days?\s+(?:later|passed)/gi, 1], [/(\d+)\s+weeks?\s+later/gi, 7], [/(\d+)\s+months?\s+later/gi, 30]
        ];
        for (var i = 0; i < patterns.length; i++) { var re = patterns[i][0]; var mult = patterns[i][1]; var match; while ((match = re.exec(msg)) !== null) days += parseInt(match[1]) * mult; }
        if (/на следующ\w+\s+(?:день|утро)|next\s+day/i.test(msg)) days += 1;
        return days > 0 ? { days: days } : null;
    },
    apply: function (parsed) {
        var s = S();
        if (parsed.days > 0) { s.worldDate = addDaysToDate(s.worldDate, parsed.days); this.advanceAll(parsed.days); }
        saveSettingsDebounced(); Profiles.save();
    },
    advanceAll: function (days) {
        var s = S(); var charNames = Object.keys(s.characters);
        for (var i = 0; i < charNames.length; i++) {
            var p = s.characters[charNames[i]]; if (!p._enabled) continue;
            if (s.modules.cycle && p.cycle && p.cycle.enabled && !(p.pregnancy && p.pregnancy.active)) new CycleManager(p).advance(days);
            if (s.modules.pregnancy && p.pregnancy && p.pregnancy.active) new PregManager(p).advanceDay(days);
            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.secondarySex) {
                var hr = new HeatRutManager(p);
                if (p.secondarySex === "omega") hr.advanceHeat(days);
                if (p.secondarySex === "alpha") hr.advanceRut(days);
            }
            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.bond) new BondManager(p).advance(days);
            if (s.auSettings.oviposition && s.auSettings.oviposition.enabled && p.oviposition && p.oviposition.active) new OviManager(p).advance(days);
            if (s.modules.baby && p.babies && p.babies.length > 0) {
                for (var j = 0; j < p.babies.length; j++) { p.babies[j].ageDays += days; new BabyManager(p.babies[j]).update(); }
            }
        }
    }
};

// ========================
// PROFILE FACTORY (with bond field)
// ========================
function makeProfile(name, isUser, sex) {
    var isMale = (sex || "F") === "M";
    return {
        name: name, bioSex: sex || "F", secondarySex: null, race: "human", contraception: "none",
        eyeColor: "", hairColor: "", pregnancyDifficulty: "normal",
        _isUser: isUser, _enabled: true, _canLayEggs: false,
        _mB: false, _mS: false, _mR: false, _mE: false, _mH: false, _mP: false, _mCyc: false,
        _sexSource: "", _sexConfidence: 0,
        cycle: { enabled: !isMale, currentDay: Math.floor(Math.random() * 28) + 1, baseLength: 28, length: 28, menstruationDuration: 5, irregularity: 2, symptomIntensity: "moderate", cycleCount: 0 },
        pregnancy: { active: false, week: 0, day: 0, maxWeeks: 40, father: null, fetusCount: 1, fetusSexes: [], complications: [], weightGain: 0 },
        labor: { active: false, stage: "latent", dilation: 0, hoursElapsed: 0, babiesDelivered: 0, totalBabies: 1, complications: [] },
        heat: { active: false, currentDay: 0, cycleDays: 30, duration: 5, intensity: "moderate", daysSinceLast: Math.floor(Math.random() * 25), onSuppressants: false },
        rut: { active: false, currentDay: 0, cycleDays: 35, duration: 4, intensity: "moderate", daysSinceLast: Math.floor(Math.random() * 30) },
        bond: { bonded: false, partner: null, type: null, strength: 0, daysSinceSeparation: 0, withdrawalActive: false, markLocation: "" },
        oviposition: null,
        babies: []
    };
}

// ========================
// GET ACTIVE CHARACTERS
// ========================
function getActiveChars() {
    var ctx = getContext(); var result = []; if (!ctx) return result;
    if (ctx.characterId !== undefined && ctx.characters) {
        var ch = ctx.characters[ctx.characterId]; if (ch) result.push({ name: ch.name, obj: ch, isUser: false });
    }
    if (ctx.groups && ctx.groupId) {
        var group = ctx.groups.find(function (g) { return g.id === ctx.groupId; });
        if (group && group.members) {
            for (var i = 0; i < group.members.length; i++) {
                var avatar = group.members[i]; var found = ctx.characters.find(function (c) { return c.avatar === avatar; });
                if (found && !result.some(function (r) { return r.name === found.name; })) result.push({ name: found.name, obj: found, isUser: false });
            }
        }
    }
    if (ctx.name1) result.push({ name: ctx.name1, obj: null, isUser: true });
    return result;
}

// ========================
// SYNC CHARACTERS
// ========================
var syncLock = false;
async function syncChars() {
    var s = S(); if (!s.autoSyncCharacters || syncLock) return; syncLock = true;
    try {
        var active = getActiveChars(); var ctx = getContext(); var msgs = (ctx && ctx.chat) || []; var changed = false;
        for (var i = 0; i < active.length; i++) {
            if (!s.characters[active[i].name]) { s.characters[active[i].name] = makeProfile(active[i].name, active[i].isUser, "F"); changed = true; }
        }
        // Ensure new fields exist on old profiles
        var allNames = Object.keys(s.characters);
        for (var bn = 0; bn < allNames.length; bn++) {
            var pp = s.characters[allNames[bn]];
            if (!pp.bond) pp.bond = { bonded: false, partner: null, type: null, strength: 0, daysSinceSeparation: 0, withdrawalActive: false, markLocation: "" };
            if (!pp.labor.complications) pp.labor.complications = [];
            if (!pp.pregnancy.complications) pp.pregnancy.complications = [];
            if (!pp.pregnancy.fetusSexes) pp.pregnancy.fetusSexes = [];
        }
        if (s.autoParseCharInfo && s.useLLMParsing) {
            for (var j = 0; j < active.length; j++) {
                var ch = active[j]; var pr = s.characters[ch.name];
                if (pr._mB && pr._mE && pr._mH) continue;
                var analysis = await CharAnalyzer.analyze(ch.name, ch.obj, ch.isUser);
                if (analysis) {
                    if (analysis.biologicalSex && !pr._mB) { pr.bioSex = analysis.biologicalSex; pr._sexSource = "llm"; pr._sexConfidence = analysis.sexConfidence || 90; if (analysis.biologicalSex === "M" && !pr._mCyc) pr.cycle.enabled = false; if (analysis.biologicalSex === "F" && !pr._mCyc) pr.cycle.enabled = true; changed = true; }
                    if (analysis.secondarySex && !pr._mS) { pr.secondarySex = analysis.secondarySex; changed = true; }
                    if (analysis.race && !pr._mR) { pr.race = analysis.race; changed = true; }
                    if (analysis.eyeColor && !pr._mE) { pr.eyeColor = analysis.eyeColor; changed = true; }
                    if (analysis.hairColor && !pr._mH) { pr.hairColor = analysis.hairColor; changed = true; }
                    if (analysis.canLayEggs) { pr._canLayEggs = true; changed = true; }
                }
            }
        }
        if (s.parseFullChat && s.useLLMParsing && msgs.length > 0 && ChatAnalyzer.shouldReanalyze(msgs)) {
            var charNames = Object.keys(s.characters);
            var chatResult = await ChatAnalyzer.analyze(msgs, charNames);
            if (chatResult && chatResult.currentStates) {
                var stateNames = Object.keys(chatResult.currentStates);
                for (var si = 0; si < stateNames.length; si++) {
                    var sName = stateNames[si]; var state = chatResult.currentStates[sName]; var sp = s.characters[sName]; if (!sp) continue;
                    if (state.pregnant && !sp.pregnancy.active && !sp._mP && canGetPregnant(sp)) { sp.pregnancy.active = true; sp.pregnancy.week = state.pregnancyWeek || 4; if (sp.cycle) sp.cycle.enabled = false; changed = true; }
                    if (state.hasGivenBirth && sp.pregnancy.active) { sp.pregnancy.active = false; if (sp.labor.active) sp.labor.active = false; if (sp.cycle) sp.cycle.enabled = true; changed = true; }
                    if (state.inHeat && sp.secondarySex === "omega" && sp.heat && !sp.heat.active) { sp.heat.active = true; sp.heat.currentDay = 1; changed = true; }
                    if (state.inRut && sp.secondarySex === "alpha" && sp.rut && !sp.rut.active) { sp.rut.active = true; sp.rut.currentDay = 1; changed = true; }
                }
            }
            if (chatResult && chatResult.children) {
                for (var ci = 0; ci < chatResult.children.length; ci++) {
                    var child = chatResult.children[ci]; if (!child.exists || !child.name) continue;
                    var motherProfile = child.mother ? s.characters[child.mother] : null;
                    var fatherProfile = child.father ? s.characters[child.father] : null;
                    var attachTo = motherProfile || fatherProfile; if (!attachTo) continue;
                    if (!attachTo.babies.some(function (b) { return b.name === child.name; })) {
                        attachTo.babies.push(BabyManager.generate(motherProfile, child.father, { name: child.name, sex: child.sex || "F", ageDays: 30, mother: child.mother, father: child.father }));
                        Rels.addBirth(child.mother, child.father, child.name); changed = true;
                    }
                }
            }
        }
        if (changed) saveSettingsDebounced();
    } finally { syncLock = false; }
}

// ========================
// HELPER FUNCTIONS
// ========================
function charOptions() { var names = Object.keys(S().characters); var h = ""; for (var i = 0; i < names.length; i++) h += '<option value="' + names[i] + '">' + names[i] + '</option>'; return h; }
function relTypeOptions() { var h = ""; for (var i = 0; i < REL_TYPES.length; i++) h += '<option value="' + REL_TYPES[i] + '">' + REL_TYPES[i] + '</option>'; return h; }

// ========================
// RENDER: DASHBOARD
// ========================
function renderDashboard() {
    var s = S(); var dateEl = document.getElementById("lc-dash-date"); var itemsEl = document.getElementById("lc-dash-items");
    if (!dateEl || !itemsEl) return;
    dateEl.textContent = "\uD83D\uDCC5 " + formatDate(s.worldDate) + (s.worldDate.frozen ? " \u2744\uFE0F" : "");
    var html = ""; var names = Object.keys(s.characters);
    for (var i = 0; i < names.length; i++) {
        var n = names[i]; var p = s.characters[n]; if (!p._enabled) continue; var tags = [];
        if (s.modules.cycle && p.cycle && p.cycle.enabled && !(p.pregnancy && p.pregnancy.active)) { var cm = new CycleManager(p); tags.push(cm.emoji(cm.phase()) + cm.label(cm.phase())); }
        if (s.modules.pregnancy && p.pregnancy && p.pregnancy.active) { var wk = p.pregnancy.week + "н"; if (p.pregnancy.complications.length > 0) wk += "\u26A0"; tags.push("\uD83E\uDD30" + wk); }
        if (p.labor && p.labor.active) { var lt = "\uD83C\uDFE5"; if (p.labor.complications && p.labor.complications.length > 0) lt += "\u26A0"; tags.push(lt); }
        if (p.heat && p.heat.active) tags.push("\uD83D\uDD25");
        if (p.rut && p.rut.active) tags.push("\uD83D\uDCA2");
        if (p.bond && p.bond.bonded) tags.push("\uD83D\uDC9E");
        if (p.bond && p.bond.withdrawalActive) tags.push("\uD83D\uDC94");
        if (p.oviposition && p.oviposition.active) tags.push("\uD83E\uDD5A");
        if (p.babies && p.babies.length > 0) tags.push("\uD83D\uDC76\u00D7" + p.babies.length);
        if (tags.length > 0) html += '<div class="lc-dash-item"><span class="lc-dash-name">' + n + '</span> ' + tags.join(" ") + '</div>';
    }
    itemsEl.innerHTML = html || '<div class="lc-dash-empty">Нет данных</div>';
}

// ========================
// RENDER: CHAR LIST
// ========================
function renderCharList() {
    var s = S(); var el = document.getElementById("lc-char-list"); if (!el) return; var html = ""; var names = Object.keys(s.characters);
    for (var i = 0; i < names.length; i++) {
        var n = names[i]; var p = s.characters[n]; var sx = p.bioSex === "F" ? "\u2640" : "\u2642";
        html += '<div class="lc-char-card"><div class="lc-char-card-header"><span class="lc-char-card-name">' + sx + ' ' + n + (p.secondarySex ? ' <span class="lc-sw-sec-badge">' + p.secondarySex + '</span>' : '') + '</span>';
        if (p._sexSource) html += ' <span class="lc-tag lc-tag-auto">' + p._sexSource + '</span>';
        if (p.eyeColor) html += ' <span class="lc-tag">\uD83D\uDC41 ' + p.eyeColor + '</span>';
        if (p.hairColor) html += ' <span class="lc-tag">\uD83D\uDC87 ' + p.hairColor + '</span>';
        if (p.bond && p.bond.bonded) html += ' <span class="lc-tag">\uD83D\uDC9E ' + p.bond.partner + '</span>';
        html += '</div><div class="lc-char-card-actions"><button class="lc-btn lc-btn-sm lc-edit-char" data-char="' + n + '">\u270F\uFE0F</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-del-char" data-char="' + n + '">\u2715</button></div></div>';
    }
    el.innerHTML = html || '<div class="lc-empty">Нажмите Синхр.</div>';
}

// ========================
// RENDER: CYCLE
// ========================
function renderCycle() {
    var s = S(); var el = document.getElementById("lc-cyc-panel"); var sel = document.getElementById("lc-cyc-char"); if (!el || !sel) return;
    var p = s.characters[sel.value];
    if (!p || !p.cycle || !p.cycle.enabled || (p.pregnancy && p.pregnancy.active)) { el.innerHTML = '<div class="lc-empty">Цикл отключён</div>'; return; }
    var cm = new CycleManager(p); var phase = cm.phase(); var fert = cm.fertility();
    var fc = fert >= 0.2 ? "peak" : fert >= 0.1 ? "high" : fert >= 0.05 ? "med" : "low";
    var html = '<div class="lc-cycle-calendar">';
    for (var d = 1; d <= p.cycle.length; d++) {
        var ovDay = Math.round(p.cycle.length - 14);
        var cls = d <= p.cycle.menstruationDuration ? "mens" : d < ovDay - 2 ? "foll" : d <= ovDay + 1 ? "ovul" : "lut";
        html += '<div class="lc-cal-day ' + cls + (d === p.cycle.currentDay ? ' today' : '') + '">' + d + '</div>';
    }
    html += '</div>';
    html += '<div class="lc-info-row">' + cm.emoji(phase) + ' ' + cm.label(phase) + ' | <span class="lc-fert-badge ' + fc + '">' + Math.round(fert * 100) + '%</span> | Либидо: ' + cm.libido() + '</div>';
    html += '<div class="lc-info-row">Выделения: ' + cm.discharge() + '</div>';
    var sym = cm.symptoms(); if (sym.length > 0) html += '<div class="lc-info-row">Симптомы: ' + sym.join(", ") + '</div>';
    html += '<div class="lc-row" style="margin-top:6px"><input type="number" class="lc-input" id="lc-cyc-day" min="1" max="' + p.cycle.length + '" value="' + p.cycle.currentDay + '" style="width:50px"><button class="lc-btn lc-btn-sm" id="lc-cyc-setday">Уст.</button>';
    html += '<button class="lc-btn lc-btn-sm" id="lc-cyc-mens">\uD83D\uDD34</button><button class="lc-btn lc-btn-sm" id="lc-cyc-foll">\uD83C\uDF38</button><button class="lc-btn lc-btn-sm" id="lc-cyc-ovul">\uD83E\uDD5A</button><button class="lc-btn lc-btn-sm" id="lc-cyc-lut">\uD83C\uDF19</button><button class="lc-btn lc-btn-sm" id="lc-cyc-skip">\u23ED</button></div>';
    el.innerHTML = html;
}

// ========================
// RENDER: HEAT/RUT (with bond status)
// ========================
function renderHeatRut() {
    var s = S(); var el = document.getElementById("lc-hr-panel"); var sel = document.getElementById("lc-hr-char"); if (!el || !sel) return;
    var p = s.characters[sel.value];
    if (!p || !s.modules.auOverlay || s.auPreset !== "omegaverse" || !p.secondarySex) { el.innerHTML = '<div class="lc-empty">AU не активен</div>'; return; }
    var hr = new HeatRutManager(p); var html = "";
    if (p.secondarySex === "omega") {
        var hPh = hr.heatPhase();
        html += '<div class="lc-section"><h4>\uD83D\uDD25 ' + hr.heatLabel(hPh) + '</h4>';
        if (p.heat.active) html += '<div class="lc-info-row">День ' + p.heat.currentDay + '/' + p.heat.duration + '</div>';
        else html += '<div class="lc-info-row">До течки: ' + hr.heatDaysLeft() + ' дн.' + (p.heat.onSuppressants ? ' \uD83D\uDC8A(суппр.)' : '') + '</div>';
        html += '<div class="lc-btn-group"><button class="lc-btn lc-btn-sm" id="lc-hr-th">\uD83D\uDD25 Вкл</button><button class="lc-btn lc-btn-sm" id="lc-hr-sh">\u23F9 Откл</button><button class="lc-btn lc-btn-sm" id="lc-hr-su">\uD83D\uDC8A Суппр.</button></div></div>';
    }
    if (p.secondarySex === "alpha") {
        var rPh = hr.rutPhase();
        html += '<div class="lc-section"><h4>\uD83D\uDCA2 ' + hr.rutLabel(rPh) + '</h4>';
        if (p.rut.active) html += '<div class="lc-info-row">День ' + p.rut.currentDay + '/' + p.rut.duration + '</div>';
        else html += '<div class="lc-info-row">До гона: ' + hr.rutDaysLeft() + ' дн.</div>';
        html += '<div class="lc-btn-group"><button class="lc-btn lc-btn-sm" id="lc-hr-tr">\uD83D\uDCA2 Вкл</button><button class="lc-btn lc-btn-sm" id="lc-hr-sr">\u23F9 Откл</button></div></div>';
    }
    // Bond status
    if (p.bond) {
        var bm = new BondManager(p);
        html += '<div class="lc-section"><h4>\uD83D\uDC9E Связь (бонд)</h4>';
        html += '<div class="lc-info-row">' + bm.statusLabel() + '</div>';
        var eff = bm.effects();
        if (eff.length > 0) html += '<div class="lc-info-row">Эффекты: ' + eff.join(", ") + '</div>';
        html += '</div>';
    }
    el.innerHTML = html;
    bindHeatRutButtons(p);
}

// ========================
// RENDER: PREGNANCY (FULL — manual setup + complications)
// ========================
function renderPregnancy() {
    var s = S(); var el = document.getElementById("lc-preg-panel"); var sel = document.getElementById("lc-preg-char"); if (!el || !sel) return;
    var p = s.characters[sel.value];
    if (!p) { el.innerHTML = '<div class="lc-empty">Выберите персонажа</div>'; return; }
    var html = "";

    if (!p.pregnancy || !p.pregnancy.active) {
        // === MANUAL START FORM ===
        html += '<div class="lc-section"><h4>\u2795 Начать беременность вручную</h4>';
        html += '<div class="lc-editor-grid">';
        html += '<div class="lc-editor-field"><label>Отец</label><select class="lc-select lc-char-select" id="lc-preg-father">' + charOptions() + '</select></div>';
        html += '<div class="lc-editor-field"><label>Начальная неделя</label><input type="number" class="lc-input" id="lc-preg-startweek" min="1" max="42" value="1"></div>';
        html += '<div class="lc-editor-field"><label>Кол-во плодов</label><input type="number" class="lc-input" id="lc-preg-fcount" min="1" max="8" value="1"></div>';
        html += '</div>';
        html += '<div id="lc-preg-sexes-area" style="margin-top:6px"><label style="font-size:10px;color:#7a7272;text-transform:uppercase">Пол плодов</label><div id="lc-preg-sexes-list"></div></div>';
        html += '<div class="lc-btn-group" style="margin-top:8px"><button class="lc-btn lc-btn-primary" id="lc-preg-start-manual">\uD83E\uDD30 Начать беременность</button></div></div>';
    } else {
        // === ACTIVE PREGNANCY INFO ===
        var pm = new PregManager(p); var pr = p.pregnancy; var progress = Math.round((pr.week / pr.maxWeeks) * 100);
        html += '<div class="lc-preg-header"><span class="lc-preg-week">Неделя ' + pr.week + ' / ' + pr.maxWeeks + '</span><span class="lc-preg-trim">Триместр ' + pm.trimester() + '</span></div>';
        html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:' + progress + '%"></div></div>';
        html += '<div class="lc-info-row">Размер: ' + pm.size() + ' | Движения: ' + pm.movements() + '</div>';
        html += '<div class="lc-info-row">Отец: ' + (pr.father || "?") + '</div>';
        html += '<div class="lc-info-row">Плодов: <strong>' + pr.fetusCount + '</strong> | Пол: ';
        for (var fi = 0; fi < pr.fetusSexes.length; fi++) { html += (pr.fetusSexes[fi] === "M" ? "\u2642" : "\u2640"); if (fi < pr.fetusSexes.length - 1) html += ", "; }
        html += '</div>';
        var sym = pm.symptoms(); if (sym.length > 0) html += '<div class="lc-info-row">Симптомы: ' + sym.join(", ") + '</div>';

        // === COMPLICATIONS ===
        html += '<div class="lc-section" style="margin-top:8px"><h4>\u26A0\uFE0F Осложнения беременности</h4>';
        if (pr.complications.length > 0) {
            for (var ci = 0; ci < pr.complications.length; ci++) {
                html += '<div class="lc-dice-entry" style="display:flex;justify-content:space-between;align-items:center"><span>' + pr.complications[ci] + '</span>';
                html += '<button class="lc-btn lc-btn-sm lc-btn-danger lc-preg-rm-comp" data-comp="' + pr.complications[ci] + '">\u2715</button></div>';
            }
        } else { html += '<div class="lc-empty">Нет осложнений</div>'; }
        html += '<div class="lc-btn-group" style="margin-top:4px"><button class="lc-btn lc-btn-sm" id="lc-preg-rand-comp">\uD83C\uDFB2 Рандом</button><button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-preg-clear-comp">\uD83E\uDDF9 Убрать все</button></div></div>';

        // === MANUAL EDIT ===
        html += '<div class="lc-section" style="margin-top:8px"><h4>\u270F\uFE0F Ручная настройка</h4><div class="lc-editor-grid">';
        html += '<div class="lc-editor-field"><label>Неделя</label><div class="lc-row"><input type="number" class="lc-input" id="lc-preg-setweek" min="1" max="' + pr.maxWeeks + '" value="' + pr.week + '" style="width:60px"><button class="lc-btn lc-btn-sm" id="lc-preg-applyweek">OK</button></div></div>';
        html += '<div class="lc-editor-field"><label>Кол-во плодов</label><div class="lc-row"><input type="number" class="lc-input" id="lc-preg-editcount" min="1" max="8" value="' + pr.fetusCount + '" style="width:60px"><button class="lc-btn lc-btn-sm" id="lc-preg-applycount">OK</button></div></div>';
        html += '<div class="lc-editor-field"><label>Отец</label><div class="lc-row"><select class="lc-select lc-char-select" id="lc-preg-editfather">' + charOptions() + '</select><button class="lc-btn lc-btn-sm" id="lc-preg-applyfather">OK</button></div></div>';
        html += '</div>';
        // Edit fetus sexes
        html += '<div style="margin-top:6px"><label style="font-size:10px;color:#7a7272;text-transform:uppercase">Пол плодов</label><div class="lc-row" id="lc-preg-edit-sexes">';
        for (var si = 0; si < pr.fetusSexes.length; si++) {
            html += '<select class="lc-select lc-preg-sex-sel" data-idx="' + si + '" style="width:55px"><option value="M"' + (pr.fetusSexes[si] === "M" ? " selected" : "") + '>\u2642</option><option value="F"' + (pr.fetusSexes[si] === "F" ? " selected" : "") + '>\u2640</option></select>';
        }
        html += '<button class="lc-btn lc-btn-sm" id="lc-preg-applysexes">\u2713</button></div></div></div>';

        // === ACTION BUTTONS ===
        html += '<div class="lc-btn-group" style="margin-top:8px"><button class="lc-btn lc-btn-sm" id="lc-preg-adv">+1 нед</button><button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-preg-labor">\u2192 Роды</button><button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-preg-end">Прервать</button></div>';
    }
    el.innerHTML = html;
    bindPregnancyButtons(p, sel.value);
}

function renderFetusSexSelectors() {
    var countInput = document.getElementById("lc-preg-fcount"); var area = document.getElementById("lc-preg-sexes-list"); if (!countInput || !area) return;
    var count = parseInt(countInput.value) || 1; var html = '<div class="lc-row">';
    for (var i = 0; i < count; i++) {
        html += '<select class="lc-select lc-new-fetus-sex" data-idx="' + i + '" style="width:65px"><option value="random">\uD83C\uDFB2</option><option value="M">\u2642 М</option><option value="F">\u2640 Ж</option></select>';
    }
    html += '</div>'; area.innerHTML = html;
}

// ========================
// RENDER: LABOR (with complications)
// ========================
function renderLabor() {
    var s = S(); var el = document.getElementById("lc-labor-panel"); var sel = document.getElementById("lc-labor-char"); if (!el || !sel) return;
    var p = s.characters[sel.value];
    if (!p || !p.labor || !p.labor.active) { el.innerHTML = '<div class="lc-empty">Нет активных родов</div>'; return; }
    var lm = new LaborManager(p); var progress = Math.round((p.labor.dilation / 10) * 100);
    var html = '<div class="lc-labor-stage">' + LABOR_LABELS[p.labor.stage] + '</div>';
    html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:' + progress + '%"></div></div>';
    html += '<div class="lc-info-row">Раскрытие: ' + p.labor.dilation + '/10 см | Время: ' + p.labor.hoursElapsed + ' ч</div>';
    html += '<div class="lc-labor-desc">' + lm.description() + '</div>';
    html += '<div class="lc-info-row">Родилось: ' + p.labor.babiesDelivered + ' / ' + p.labor.totalBabies + '</div>';

    // Complications
    html += '<div class="lc-section" style="margin-top:8px"><h4>\u26A0\uFE0F Осложнения родов</h4>';
    if (p.labor.complications && p.labor.complications.length > 0) {
        for (var ci = 0; ci < p.labor.complications.length; ci++) {
            html += '<div class="lc-dice-entry" style="display:flex;justify-content:space-between;align-items:center"><span>' + p.labor.complications[ci] + '</span>';
            html += '<button class="lc-btn lc-btn-sm lc-btn-danger lc-labor-rm-comp" data-comp="' + p.labor.complications[ci] + '">\u2715</button></div>';
        }
    } else { html += '<div class="lc-empty">Нет осложнений</div>'; }
    html += '<div class="lc-btn-group" style="margin-top:4px"><button class="lc-btn lc-btn-sm" id="lc-labor-rand-comp">\uD83C\uDFB2 Рандом</button><button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-labor-clear-comp">\uD83E\uDDF9 Убрать все</button></div></div>';

    html += '<div class="lc-btn-group" style="margin-top:8px"><button class="lc-btn lc-btn-sm" id="lc-labor-adv">\u2192 Стадия</button><button class="lc-btn lc-btn-sm lc-btn-success" id="lc-labor-deliver">\uD83D\uDC76 Родить</button><button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-labor-end">Завершить</button></div>';
    el.innerHTML = html;
    bindLaborButtons(p, sel.value);
}

// ========================
// RENDER: BABIES
// ========================
function renderBabies() {
    var s = S(); var el = document.getElementById("lc-baby-list"); var sel = document.getElementById("lc-baby-par"); if (!el || !sel) return;
    var p = s.characters[sel.value];
    if (!p || !p.babies || p.babies.length === 0) { el.innerHTML = '<div class="lc-empty">Нет детей</div>'; return; }
    var html = "";
    for (var i = 0; i < p.babies.length; i++) {
        var b = p.babies[i]; var bm = new BabyManager(b);
        html += '<div class="lc-baby-card"><div class="lc-baby-header"><span class="lc-baby-name">' + (b.sex === "M" ? "\u2642" : "\u2640") + ' ' + (b.name || "?") + '</span><span class="lc-tag">' + bm.age() + '</span></div>';
        html += '<div class="lc-baby-details">Мать: ' + b.mother + ' | Отец: ' + b.father + ' | Вес: ' + b.currentWeight + 'г</div>';
        var ms = bm.milestones(); if (ms.length > 0) html += '<div class="lc-baby-details">Вехи: ' + ms.join(", ") + '</div>';
        html += '<div class="lc-baby-actions"><button class="lc-btn lc-btn-sm lc-baby-edit" data-p="' + sel.value + '" data-i="' + i + '">\u270F\uFE0F</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-baby-del" data-p="' + sel.value + '" data-i="' + i + '">\u2715</button></div></div>';
    }
    el.innerHTML = html;
}

// ========================
// RENDER: OVI
// ========================
function renderOvi() {
    var s = S(); var el = document.getElementById("lc-ovi-panel"); var sel = document.getElementById("lc-ovi-char"); if (!el || !sel) return;
    var p = s.characters[sel.value];
    if (!p || !p.oviposition || !p.oviposition.active) { el.innerHTML = '<div class="lc-empty">Нет кладки</div>'; return; }
    var om = new OviManager(p); var prog = om.progress();
    var html = '<div class="lc-ovi-phase">' + (OVI_PHASES[p.oviposition.phase] || "") + '</div>';
    html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill ovi" style="width:' + prog + '%"></div></div>';
    html += '<div class="lc-info-row">Яиц: ' + p.oviposition.eggCount + ' (оплод.: ' + p.oviposition.fertilizedCount + ')</div>';
    el.innerHTML = html;
}

// ========================
// RENDER: RELATIONS
// ========================
function renderRelations() {
    var el = document.getElementById("lc-rel-list"); if (!el) return; var rels = S().relationships || [];
    if (!rels.length) { el.innerHTML = '<div class="lc-empty">Нет связей</div>'; return; }
    var html = "";
    for (var i = 0; i < rels.length; i++) {
        var r = rels[i];
        html += '<div class="lc-rel-entry"><span>' + r.char1 + ' \u2192 ' + r.char2 + ': <strong>' + r.type + '</strong>' + (r.notes ? ' (' + r.notes + ')' : '') + '</span>';
        html += '<button class="lc-btn lc-btn-sm lc-btn-danger lc-del-rel" data-id="' + r.id + '">\u2715</button></div>';
    }
    el.innerHTML = html;
    var btns = el.querySelectorAll(".lc-del-rel");
    for (var j = 0; j < btns.length; j++) btns[j].addEventListener("click", function () { Rels.remove(this.dataset.id); renderRelations(); });
}

// ========================
// RENDER: PROFILES
// ========================
function renderProfiles() {
    var s = S(); var curEl = document.getElementById("lc-prof-cur");
    if (curEl) curEl.textContent = "Текущий: " + (s.currentChatId || "-") + " (" + Object.keys(s.characters).length + " перс.)";
    var el = document.getElementById("lc-prof-list"); if (!el) return; var list = Profiles.list();
    if (!list.length) { el.innerHTML = '<div class="lc-empty">Нет профилей</div>'; return; }
    var html = "";
    for (var i = 0; i < list.length; i++) {
        var p = list[i];
        html += '<div class="lc-profile-card' + (p.isCurrent ? ' current' : '') + '"><span>' + p.id.substring(0, 25) + ' (' + p.count + ' перс.)</span>';
        html += '<div class="lc-btn-group"><button class="lc-btn lc-btn-sm lc-prof-load" data-id="' + p.id + '">\uD83D\uDCC2</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-prof-del" data-id="' + p.id + '">\u2715</button></div></div>';
    }
    el.innerHTML = html;
}

// ========================
// RENDER: DICE LOG + INTIMACY LOG
// ========================
function renderDiceLog() {
    var el = document.getElementById("lc-dice-log"); if (!el) return; var logs = S().diceLog;
    if (!logs || !logs.length) { el.innerHTML = '<div class="lc-empty">Нет бросков</div>'; return; }
    var html = ""; var items = logs.slice().reverse().slice(0, 15);
    for (var i = 0; i < items.length; i++) {
        var e = items[i];
        html += '<div class="lc-dice-entry ' + (e.result ? "lc-dice-success" : "lc-dice-fail") + '"><span class="lc-dice-ts">' + e.ts + '</span> ' + e.target + ': \uD83C\uDFB2' + e.roll + '/' + e.chance + '% ' + (e.result ? '\u2713' : '\u2717') + (e.auto ? ' (авто)' : '') + '</div>';
    }
    el.innerHTML = html;
}
function renderIntimLog() {
    var el = document.getElementById("lc-intim-log"); if (!el) return; var logs = S().intimacyLog;
    if (!logs || !logs.length) { el.innerHTML = '<div class="lc-empty">Нет записей</div>'; return; }
    var html = ""; var items = logs.slice().reverse().slice(0, 15);
    for (var i = 0; i < items.length; i++) {
        var e = items[i];
        html += '<div class="lc-intim-entry"><span class="lc-intim-ts">' + e.ts + '</span> ' + (e.parts || []).join(" + ") + ' | ' + (e.type || "?") + ' | ' + (e.ejac || "?") + '</div>';
    }
    el.innerHTML = html;
}

// ========================
// RENDER: AU SETTINGS (FULL — omegaverse/fantasy/ovi)
// ========================
function renderAuSettings() {
    var el = document.getElementById("lc-au-panel"); if (!el) return;
    var s = S(); var preset = s.auPreset; var h = [];

    h.push('<div class="lc-section"><h4>\uD83C\uDF10 Пресет: <strong>' + preset + '</strong></h4></div>');

    if (preset === "omegaverse") {
        var ov = s.auSettings.omegaverse;
        // Heat settings
        h.push('<div class="lc-section"><h4>\uD83D\uDD25 Течка (Heat)</h4><div class="lc-editor-grid">');
        h.push('<div class="lc-editor-field"><label>Длина цикла (дни)</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.heatCycleLength" value="' + ov.heatCycleLength + '"></div>');
        h.push('<div class="lc-editor-field"><label>Длительность</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.heatDuration" value="' + ov.heatDuration + '"></div>');
        h.push('<div class="lc-editor-field"><label>Бонус фертильности</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.heatFertilityBonus" value="' + ov.heatFertilityBonus + '" step="0.05"></div>');
        h.push('<div class="lc-editor-field"><label>Предтечка (дни)</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.preHeatDays" value="' + ov.preHeatDays + '"></div>');
        h.push('<div class="lc-editor-field"><label>Посттечка (дни)</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.postHeatDays" value="' + ov.postHeatDays + '"></div>');
        h.push('<div class="lc-editor-field"><label>Интенсивность</label><select class="lc-select lc-au-sel" data-path="omegaverse.heatIntensity"><option value="mild"' + (ov.heatIntensity === "mild" ? " selected" : "") + '>Слабая</option><option value="moderate"' + (ov.heatIntensity === "moderate" ? " selected" : "") + '>Средняя</option><option value="intense"' + (ov.heatIntensity === "intense" ? " selected" : "") + '>Сильная</option></select></div>');
        h.push('</div></div>');

        // Rut settings
        h.push('<div class="lc-section"><h4>\uD83D\uDCA2 Гон (Rut)</h4><div class="lc-editor-grid">');
        h.push('<div class="lc-editor-field"><label>Длина цикла</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.rutCycleLength" value="' + ov.rutCycleLength + '"></div>');
        h.push('<div class="lc-editor-field"><label>Длительность</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.rutDuration" value="' + ov.rutDuration + '"></div>');
        h.push('<div class="lc-editor-field"><label>Предгон</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.preRutDays" value="' + ov.preRutDays + '"></div>');
        h.push('<div class="lc-editor-field"><label>Постгон</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.postRutDays" value="' + ov.postRutDays + '"></div>');
        h.push('<div class="lc-editor-field"><label>Интенсивность</label><select class="lc-select lc-au-sel" data-path="omegaverse.rutIntensity"><option value="mild"' + (ov.rutIntensity === "mild" ? " selected" : "") + '>Слабая</option><option value="moderate"' + (ov.rutIntensity === "moderate" ? " selected" : "") + '>Средняя</option><option value="intense"' + (ov.rutIntensity === "intense" ? " selected" : "") + '>Сильная</option></select></div>');
        h.push('</div></div>');

        // Knot
        h.push('<div class="lc-section"><h4>\uD83D\uDD17 Узел (Knot)</h4>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.knotEnabled"' + (ov.knotEnabled ? ' checked' : '') + '><span>Узел включён</span></label>');
        h.push('<div class="lc-editor-field"><label>Мин. длительность (мин)</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.knotDurationMin" value="' + ov.knotDurationMin + '"></div></div>');

        // Bonding
        h.push('<div class="lc-section"><h4>\uD83D\uDC9E Бондинг (Bonding)</h4>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.bondingEnabled"' + (ov.bondingEnabled ? ' checked' : '') + '><span>Бондинг включён</span></label>');
        h.push('<div class="lc-editor-field"><label>Тип связи</label><select class="lc-select lc-au-sel" data-path="omegaverse.bondingType"><option value="bite"' + (ov.bondingType === "bite" ? " selected" : "") + '>Укус</option><option value="scent"' + (ov.bondingType === "scent" ? " selected" : "") + '>Запах</option><option value="mental"' + (ov.bondingType === "mental" ? " selected" : "") + '>Ментальная</option></select></div>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.bondEffectEmpathy"' + (ov.bondEffectEmpathy ? ' checked' : '') + '><span>Эмпатия</span></label>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.bondEffectProximity"' + (ov.bondEffectProximity ? ' checked' : '') + '><span>Тяга к партнёру</span></label>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.bondEffectProtective"' + (ov.bondEffectProtective ? ' checked' : '') + '><span>Защитный инстинкт</span></label>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.bondBreakable"' + (ov.bondBreakable ? ' checked' : '') + '><span>Можно разорвать</span></label>');
        h.push('<div class="lc-editor-field"><label>Дни ломки</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.bondWithdrawalDays" value="' + ov.bondWithdrawalDays + '"></div>');
        // Bond create/break actions
        h.push('<div class="lc-row" style="margin-top:6px"><select class="lc-select lc-char-select" id="lc-bond-c1">' + charOptions() + '</select><span>\u2194</span><select class="lc-select lc-char-select" id="lc-bond-c2">' + charOptions() + '</select><button class="lc-btn lc-btn-sm lc-btn-primary" id="lc-bond-create">\uD83D\uDC9E</button><button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-bond-break">\uD83D\uDC94</button></div>');
        h.push('</div>');

        // Suppressants
        h.push('<div class="lc-section"><h4>\uD83D\uDC8A Супрессанты</h4>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.suppressantsAvailable"' + (ov.suppressantsAvailable ? ' checked' : '') + '><span>Доступны</span></label>');
        h.push('<div class="lc-editor-field"><label>Эффективность</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.suppressantEffectiveness" value="' + ov.suppressantEffectiveness + '" step="0.05" min="0" max="1"></div>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.suppressantSideEffects"' + (ov.suppressantSideEffects ? ' checked' : '') + '><span>Побочки</span></label></div>');

        // Physiology
        h.push('<div class="lc-section"><h4>\uD83E\uDDBF Физиология</h4>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.slickEnabled"' + (ov.slickEnabled ? ' checked' : '') + '><span>Самосмазка (slick)</span></label>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.scentEnabled"' + (ov.scentEnabled ? ' checked' : '') + '><span>Феромоны/запах</span></label>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.nestingEnabled"' + (ov.nestingEnabled ? ' checked' : '') + '><span>Гнездование</span></label>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.purringEnabled"' + (ov.purringEnabled ? ' checked' : '') + '><span>Мурлыканье</span></label></div>');

        // OV Pregnancy
        h.push('<div class="lc-section"><h4>\uD83E\uDD30 Беременность (OV)</h4>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.maleOmegaPregnancy"' + (ov.maleOmegaPregnancy ? ' checked' : '') + '><span>Мпрег (омега-мужчины)</span></label>');
        h.push('<div class="lc-editor-field"><label>Срок (недели)</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.pregnancyWeeks" value="' + ov.pregnancyWeeks + '"></div>');
        h.push('<div class="lc-editor-field"><label>Шанс двойни</label><input type="number" class="lc-input lc-au-inp" data-path="omegaverse.twinChance" value="' + ov.twinChance + '" step="0.05" min="0" max="1"></div></div>');

        // Hierarchy
        h.push('<div class="lc-section"><h4>\uD83D\uDC51 Иерархия</h4>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.alphaCommandVoice"' + (ov.alphaCommandVoice ? ' checked' : '') + '><span>Голос альфы</span></label>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="omegaverse.omegaSubmission"' + (ov.omegaSubmission ? ' checked' : '') + '><span>Подчинение омеги</span></label></div>');

    } else if (preset === "fantasy") {
        var fan = s.auSettings.fantasy;
        h.push('<div class="lc-section"><h4>\uD83E\uDDD9 Фэнтези: сроки по расам (недели)</h4><div class="lc-editor-grid">');
        var races = Object.keys(fan.pregnancyByRace);
        for (var ri = 0; ri < races.length; ri++) {
            h.push('<div class="lc-editor-field"><label>' + races[ri] + '</label><input type="number" class="lc-input lc-au-race" data-race="' + races[ri] + '" value="' + fan.pregnancyByRace[races[ri]] + '"></div>');
        }
        h.push('</div></div>');
        h.push('<div class="lc-section">');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="fantasy.magicPregnancy"' + (fan.magicPregnancy ? ' checked' : '') + '><span>Магическая беременность</span></label>');
        h.push('<label class="lc-checkbox"><input type="checkbox" class="lc-au-chk" data-path="fantasy.acceleratedPregnancy"' + (fan.acceleratedPregnancy ? ' checked' : '') + '><span>Ускоренная</span></label>');
        h.push('<div class="lc-editor-field"><label>Множитель ускорения</label><input type="number" class="lc-input lc-au-inp" data-path="fantasy.accelerationFactor" value="' + fan.accelerationFactor + '" step="0.5" min="1"></div>');
        h.push('</div>');

    } else if (preset === "realism") {
        h.push('<div class="lc-section"><div class="lc-info-row">Реалистичный режим: стандартные параметры, без AU-фич.</div></div>');
    }

    // Oviposition (always visible if enabled)
    if (s.auSettings.oviposition.enabled) {
        var ovi = s.auSettings.oviposition;
        h.push('<div class="lc-section"><h4>\uD83E\uDD5A Овипозиция</h4><div class="lc-editor-grid">');
        h.push('<div class="lc-editor-field"><label>Мин. яиц</label><input type="number" class="lc-input lc-au-inp" data-path="oviposition.eggCountMin" value="' + ovi.eggCountMin + '"></div>');
        h.push('<div class="lc-editor-field"><label>Макс. яиц</label><input type="number" class="lc-input lc-au-inp" data-path="oviposition.eggCountMax" value="' + ovi.eggCountMax + '"></div>');
        h.push('<div class="lc-editor-field"><label>Гестация (дни)</label><input type="number" class="lc-input lc-au-inp" data-path="oviposition.gestationDays" value="' + ovi.gestationDays + '"></div>');
        h.push('<div class="lc-editor-field"><label>Откладка (дни)</label><input type="number" class="lc-input lc-au-inp" data-path="oviposition.layingDuration" value="' + ovi.layingDuration + '"></div>');
        h.push('<div class="lc-editor-field"><label>Инкубация (дни)</label><input type="number" class="lc-input lc-au-inp" data-path="oviposition.incubationDays" value="' + ovi.incubationDays + '"></div>');
        h.push('<div class="lc-editor-field"><label>Шанс оплодотворения</label><input type="number" class="lc-input lc-au-inp" data-path="oviposition.fertilizationChance" value="' + ovi.fertilizationChance + '" step="0.1" min="0" max="1"></div>');
        h.push('<div class="lc-editor-field"><label>Размер яиц</label><select class="lc-select lc-au-sel" data-path="oviposition.eggSize"><option value="small"' + (ovi.eggSize === "small" ? " selected" : "") + '>Малые</option><option value="medium"' + (ovi.eggSize === "medium" ? " selected" : "") + '>Средние</option><option value="large"' + (ovi.eggSize === "large" ? " selected" : "") + '>Большие</option></select></div>');
        h.push('<div class="lc-editor-field"><label>Болезненность</label><select class="lc-select lc-au-sel" data-path="oviposition.painLevel"><option value="none"' + (ovi.painLevel === "none" ? " selected" : "") + '>Нет</option><option value="mild"' + (ovi.painLevel === "mild" ? " selected" : "") + '>Слабая</option><option value="moderate"' + (ovi.painLevel === "moderate" ? " selected" : "") + '>Средняя</option><option value="severe"' + (ovi.painLevel === "severe" ? " selected" : "") + '>Сильная</option></select></div>');
        h.push('<div class="lc-editor-field"><label>Уход после (дни)</label><input type="number" class="lc-input lc-au-inp" data-path="oviposition.aftercareDays" value="' + ovi.aftercareDays + '"></div>');
        h.push('<div class="lc-editor-field"><label>Тип скорлупы</label><select class="lc-select lc-au-sel" data-path="oviposition.shellType"><option value="soft"' + (ovi.shellType === "soft" ? " selected" : "") + '>Мягкая</option><option value="hard"' + (ovi.shellType === "hard" ? " selected" : "") + '>Твёрдая</option></select></div>');
        h.push('</div></div>');
    }

    el.innerHTML = h.join("");
    bindAuInputs();
}

// ========================
// BIND AU INPUTS
// ========================
function bindAuInputs() {
    var s = S();
    var inputs = document.querySelectorAll(".lc-au-inp");
    for (var i = 0; i < inputs.length; i++) {
        inputs[i].addEventListener("change", function () {
            var path = this.dataset.path.split("."); var val = parseFloat(this.value); if (isNaN(val)) val = this.value;
            if (path.length === 2) s.auSettings[path[0]][path[1]] = val;
            saveSettingsDebounced();
        });
    }
    var selects = document.querySelectorAll(".lc-au-sel");
    for (var j = 0; j < selects.length; j++) {
        selects[j].addEventListener("change", function () {
            var path = this.dataset.path.split(".");
            if (path.length === 2) s.auSettings[path[0]][path[1]] = this.value;
            saveSettingsDebounced();
        });
    }
    var checks = document.querySelectorAll(".lc-au-chk");
    for (var k = 0; k < checks.length; k++) {
        checks[k].addEventListener("change", function () {
            var path = this.dataset.path.split(".");
            if (path.length === 2) s.auSettings[path[0]][path[1]] = this.checked;
            saveSettingsDebounced();
        });
    }
    var raceInputs = document.querySelectorAll(".lc-au-race");
    for (var r = 0; r < raceInputs.length; r++) {
        raceInputs[r].addEventListener("change", function () {
            s.auSettings.fantasy.pregnancyByRace[this.dataset.race] = parseInt(this.value) || 40;
            saveSettingsDebounced();
        });
    }
    // Bond create/break
    var bondCreate = document.getElementById("lc-bond-create");
    if (bondCreate) bondCreate.addEventListener("click", function () {
        var c1 = document.getElementById("lc-bond-c1"); var c2 = document.getElementById("lc-bond-c2");
        if (!c1 || !c2 || c1.value === c2.value) { toastr.warning("Выберите двух разных персонажей!"); return; }
        var p1 = s.characters[c1.value]; var p2 = s.characters[c2.value]; if (!p1 || !p2) return;
        var bm1 = new BondManager(p1); if (!bm1.canBond()) { toastr.warning(c1.value + " уже связан или бондинг отключён!"); return; }
        var bm2 = new BondManager(p2); if (!bm2.canBond()) { toastr.warning(c2.value + " уже связан!"); return; }
        bm1.createBond(c2.value); bm2.createBond(c1.value);
        toastr.success("\uD83D\uDC9E Связь создана!"); rebuild();
    });
    var bondBreak = document.getElementById("lc-bond-break");
    if (bondBreak) bondBreak.addEventListener("click", function () {
        var c1 = document.getElementById("lc-bond-c1"); if (!c1) return;
        var p = s.characters[c1.value]; if (!p || !p.bond || !p.bond.bonded) { toastr.warning("Нет связи!"); return; }
        if (!confirm("Разорвать связь?")) return;
        if (new BondManager(p).breakBond()) { toastr.info("\uD83D\uDC94 Связь разорвана"); rebuild(); }
    });
}

// ========================
// WIDGET GENERATION
// ========================
function generateWidget() {
    var s = S(); if (!s.enabled || !s.showStatusWidget) return "";
    var chars = Object.keys(s.characters).filter(function (n) { return s.characters[n]._enabled; });
    if (!chars.length) return "";
    var hasContent = false;
    for (var check = 0; check < chars.length; check++) {
        var cp = s.characters[chars[check]];
        if (s.modules.cycle && cp.cycle && cp.cycle.enabled && !(cp.pregnancy && cp.pregnancy.active)) hasContent = true;
        if (s.modules.pregnancy && cp.pregnancy && cp.pregnancy.active) hasContent = true;
        if (s.modules.labor && cp.labor && cp.labor.active) hasContent = true;
        if (cp.heat && cp.heat.active) hasContent = true;
        if (cp.rut && cp.rut.active) hasContent = true;
        if (cp.bond && (cp.bond.bonded || cp.bond.withdrawalActive)) hasContent = true;
        if (cp.oviposition && cp.oviposition.active) hasContent = true;
        if (s.modules.baby && cp.babies && cp.babies.length > 0) hasContent = true;
    }
    if (!hasContent) return "";
    var h = [];
    h.push('<div class="lc-status-widget"><div class="lc-sw-header" onclick="var b=this.nextElementSibling;var a=this.querySelector(\'.lc-sw-arrow\');if(b.style.display===\'none\'){b.style.display=\'block\';a.textContent=\'\\u25BC\';}else{b.style.display=\'none\';a.textContent=\'\\u25B6\';}"><span>\uD83D\uDC30 BunnyCycle</span><span class="lc-sw-arrow">\u25BC</span></div>');
    h.push('<div class="lc-sw-body"><div class="lc-sw-date">' + formatDate(s.worldDate) + '</div>');
    for (var i = 0; i < chars.length; i++) {
        var name = chars[i]; var p = s.characters[name]; var hasAny = false; var ch = [];

        if (s.modules.labor && p.labor && p.labor.active) {
            hasAny = true; var lm = new LaborManager(p);
            ch.push('<div class="lc-sw-detail-block lc-sw-labor-block"><div class="lc-sw-detail-title">\uD83C\uDFE5 ' + LABOR_LABELS[p.labor.stage] + '</div>');
            ch.push('<div class="lc-sw-detail-row">Раскрытие: ' + p.labor.dilation + '/10 см</div>');
            ch.push('<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:' + Math.round((p.labor.dilation / 10) * 100) + '%"></div></div>');
            if (p.labor.complications && p.labor.complications.length > 0) ch.push('<div class="lc-sw-detail-row lc-sw-warn">\u26A0 ' + p.labor.complications.join(", ") + '</div>');
            ch.push('</div>');
        }
        if (s.modules.pregnancy && p.pregnancy && p.pregnancy.active && !(p.labor && p.labor.active)) {
            hasAny = true; var pm = new PregManager(p);
            ch.push('<div class="lc-sw-detail-block lc-sw-preg-block"><div class="lc-sw-detail-title">\uD83E\uDD30 Неделя ' + p.pregnancy.week + '/' + p.pregnancy.maxWeeks + '</div>');
            ch.push('<div class="lc-sw-detail-row">Размер: ' + pm.size() + ' | Плодов: ' + p.pregnancy.fetusCount + '</div>');
            ch.push('<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:' + Math.round((p.pregnancy.week / p.pregnancy.maxWeeks) * 100) + '%"></div></div>');
            if (p.pregnancy.complications.length > 0) ch.push('<div class="lc-sw-detail-row lc-sw-warn">\u26A0 ' + p.pregnancy.complications.join(", ") + '</div>');
            ch.push('</div>');
        }
        if (p.heat && p.heat.active) { hasAny = true; ch.push('<div class="lc-sw-detail-block lc-sw-heat-block"><div class="lc-sw-detail-title">\uD83D\uDD25 Течка D' + p.heat.currentDay + '/' + p.heat.duration + '</div></div>'); }
        if (p.rut && p.rut.active) { hasAny = true; ch.push('<div class="lc-sw-detail-block lc-sw-rut-block"><div class="lc-sw-detail-title">\uD83D\uDCA2 Гон D' + p.rut.currentDay + '/' + p.rut.duration + '</div></div>'); }
        if (p.bond && p.bond.bonded) { hasAny = true; ch.push('<div class="lc-sw-detail-block lc-sw-bond-block"><div class="lc-sw-detail-title">\uD83D\uDC9E Связь: ' + p.bond.partner + ' (' + p.bond.strength + '%)</div></div>'); }
        if (p.bond && p.bond.withdrawalActive) { hasAny = true; ch.push('<div class="lc-sw-detail-block lc-sw-bond-block"><div class="lc-sw-detail-title">\uD83D\uDC94 Ломка (день ' + p.bond.daysSinceSeparation + ')</div></div>'); }
        if (s.modules.cycle && p.cycle && p.cycle.enabled && !(p.pregnancy && p.pregnancy.active) && !(p.labor && p.labor.active)) {
            hasAny = true; var cm = new CycleManager(p); var fert = cm.fertility();
            var fc = fert >= 0.2 ? "peak" : fert >= 0.1 ? "high" : fert >= 0.05 ? "med" : "low";
            ch.push('<div class="lc-sw-detail-block lc-sw-cycle-block"><div class="lc-sw-detail-title">' + cm.emoji(cm.phase()) + ' ' + cm.label(cm.phase()) + '</div>');
            ch.push('<div class="lc-sw-detail-row">Фертильность: <span class="lc-sw-fert ' + fc + '">' + Math.round(fert * 100) + '%</span> | Либидо: ' + cm.libido() + '</div></div>');
        }
        if (p.oviposition && p.oviposition.active) { hasAny = true; ch.push('<div class="lc-sw-detail-block lc-sw-ovi-block"><div class="lc-sw-detail-title">\uD83E\uDD5A ' + (OVI_PHASES[p.oviposition.phase] || "") + '</div><div class="lc-sw-detail-row">Яиц: ' + p.oviposition.eggCount + '</div></div>'); }
        if (s.modules.baby && p.babies && p.babies.length > 0) {
            hasAny = true;
            ch.push('<div class="lc-sw-detail-block lc-sw-baby-block"><div class="lc-sw-detail-title">\uD83D\uDC76 Дети (' + p.babies.length + ')</div>');
            for (var j = 0; j < p.babies.length; j++) {
                var b = p.babies[j]; ch.push('<div class="lc-sw-baby-card">' + (b.sex === "M" ? "\u2642" : "\u2640") + ' ' + (b.name || "?") + ' ' + new BabyManager(b).age() + '</div>');
            }
            ch.push('</div>');
        }
        if (hasAny) {
            h.push('<div class="lc-sw-char"><div class="lc-sw-char-name">' + (p.bioSex === "F" ? "\u2640" : "\u2642") + ' ' + name + (p.secondarySex ? ' <span class="lc-sw-sec-badge">' + p.secondarySex + '</span>' : '') + '</div>' + ch.join("") + '</div>');
        }
    }
    h.push('</div></div>');
    return h.join("");
}

function injectWidget(messageIndex) {
    var s = S(); if (!s.enabled || !s.showStatusWidget) return;
    var widgetHtml = generateWidget(); if (!widgetHtml) return;
    try {
        var msgEl = document.querySelector('#chat .mes[mesid="' + messageIndex + '"]'); if (!msgEl) return;
        var existing = msgEl.querySelector(".lc-status-widget"); if (existing) existing.remove();
        var mesText = msgEl.querySelector(".mes_text"); if (mesText) mesText.insertAdjacentHTML("afterend", widgetHtml);
    } catch (e) { console.warn("[BunnyCycle] Widget injection failed:", e.message); }
}

function updateSelects() {
    var opts = charOptions(); var selects = document.querySelectorAll(".lc-char-select");
    for (var i = 0; i < selects.length; i++) { var val = selects[i].value; selects[i].innerHTML = opts; if (Object.keys(S().characters).indexOf(val) !== -1) selects[i].value = val; }
}

function rebuild() {
    renderDashboard(); renderCharList(); renderCycle(); renderHeatRut(); renderPregnancy(); renderLabor(); renderBabies(); renderOvi(); renderRelations(); renderProfiles(); renderDiceLog(); renderIntimLog(); renderAuSettings(); updateSelects();
}

// === END OF PART 2 ===
// Continue with PART 3...
// === PART 3/3: Bindings + HTML + Popups + Editor + Init ===

// ========================
// BIND PREGNANCY BUTTONS
// ========================
function bindPregnancyButtons(p, charName) {
    var s = S();
    var fcountInput = document.getElementById("lc-preg-fcount");
    if (fcountInput) {
        renderFetusSexSelectors();
        fcountInput.addEventListener("change", renderFetusSexSelectors);
    }
    var startBtn = document.getElementById("lc-preg-start-manual");
    if (startBtn) startBtn.addEventListener("click", function () {
        if (!canGetPregnant(p)) { toastr.warning("Этот персонаж не может забеременеть!"); return; }
        var father = document.getElementById("lc-preg-father");
        var weekInput = document.getElementById("lc-preg-startweek");
        var countInput = document.getElementById("lc-preg-fcount");
        var fatherVal = father ? father.value : "?";
        var week = weekInput ? parseInt(weekInput.value) || 1 : 1;
        var count = countInput ? parseInt(countInput.value) || 1 : 1;
        var sexSelects = document.querySelectorAll(".lc-new-fetus-sex");
        var sexes = [];
        for (var i = 0; i < sexSelects.length; i++) {
            var val = sexSelects[i].value;
            sexes.push(val === "random" ? (Math.random() < 0.5 ? "M" : "F") : val);
        }
        while (sexes.length < count) sexes.push(Math.random() < 0.5 ? "M" : "F");
        new PregManager(p).start(fatherVal, count, sexes, week);
        saveSettingsDebounced(); rebuild();
        toastr.success("\uD83E\uDD30 Беременность установлена!");
    });
    var advBtn = document.getElementById("lc-preg-adv");
    if (advBtn) advBtn.addEventListener("click", function () { new PregManager(p).advanceDay(7); saveSettingsDebounced(); renderPregnancy(); renderDashboard(); });
    var laborBtn = document.getElementById("lc-preg-labor");
    if (laborBtn) laborBtn.addEventListener("click", function () { new LaborManager(p).start(); saveSettingsDebounced(); rebuild(); });
    var endBtn = document.getElementById("lc-preg-end");
    if (endBtn) endBtn.addEventListener("click", function () { if (!confirm("Прервать беременность?")) return; p.pregnancy.active = false; p.pregnancy.complications = []; if (p.cycle) p.cycle.enabled = true; saveSettingsDebounced(); rebuild(); });
    var applyWeek = document.getElementById("lc-preg-applyweek");
    if (applyWeek) applyWeek.addEventListener("click", function () { var inp = document.getElementById("lc-preg-setweek"); if (inp) { p.pregnancy.week = clamp(parseInt(inp.value) || 1, 1, p.pregnancy.maxWeeks); saveSettingsDebounced(); renderPregnancy(); } });
    var applyCount = document.getElementById("lc-preg-applycount");
    if (applyCount) applyCount.addEventListener("click", function () {
        var inp = document.getElementById("lc-preg-editcount"); if (!inp) return;
        var newCount = clamp(parseInt(inp.value) || 1, 1, 8);
        p.pregnancy.fetusCount = newCount;
        while (p.pregnancy.fetusSexes.length < newCount) p.pregnancy.fetusSexes.push(Math.random() < 0.5 ? "M" : "F");
        p.pregnancy.fetusSexes = p.pregnancy.fetusSexes.slice(0, newCount);
        saveSettingsDebounced(); renderPregnancy();
    });
    var applyFather = document.getElementById("lc-preg-applyfather");
    if (applyFather) applyFather.addEventListener("click", function () { var sel = document.getElementById("lc-preg-editfather"); if (sel) { p.pregnancy.father = sel.value; saveSettingsDebounced(); renderPregnancy(); } });
    var applySexes = document.getElementById("lc-preg-applysexes");
    if (applySexes) applySexes.addEventListener("click", function () {
        var selects = document.querySelectorAll(".lc-preg-sex-sel");
        for (var i = 0; i < selects.length; i++) {
            var idx = parseInt(selects[i].dataset.idx);
            if (idx >= 0 && idx < p.pregnancy.fetusSexes.length) p.pregnancy.fetusSexes[idx] = selects[i].value;
        }
        saveSettingsDebounced(); renderPregnancy(); toastr.success("Пол обновлён!");
    });
    var randComp = document.getElementById("lc-preg-rand-comp");
    if (randComp) randComp.addEventListener("click", function () {
        var comp = new PregManager(p).addRandomComplication();
        if (comp) { saveSettingsDebounced(); renderPregnancy(); toastr.info("\u26A0\uFE0F " + comp); }
        else toastr.warning("Все осложнения уже добавлены!");
    });
    var clearComp = document.getElementById("lc-preg-clear-comp");
    if (clearComp) clearComp.addEventListener("click", function () { new PregManager(p).clearComplications(); saveSettingsDebounced(); renderPregnancy(); toastr.success("Осложнения убраны!"); });
    var rmBtns = document.querySelectorAll(".lc-preg-rm-comp");
    for (var ri = 0; ri < rmBtns.length; ri++) {
        rmBtns[ri].addEventListener("click", function () { new PregManager(p).removeComplication(this.dataset.comp); saveSettingsDebounced(); renderPregnancy(); });
    }
}

// ========================
// BIND LABOR BUTTONS
// ========================
function bindLaborButtons(p, charName) {
    var advBtn = document.getElementById("lc-labor-adv");
    if (advBtn) advBtn.addEventListener("click", function () { new LaborManager(p).advance(); saveSettingsDebounced(); renderLabor(); });
    var deliverBtn = document.getElementById("lc-labor-deliver");
    if (deliverBtn) deliverBtn.addEventListener("click", function () { showBabyForm(charName, (p.pregnancy && p.pregnancy.father) || "?"); });
    var endBtn = document.getElementById("lc-labor-end");
    if (endBtn) endBtn.addEventListener("click", function () { if (!confirm("Завершить роды?")) return; new LaborManager(p).end(); saveSettingsDebounced(); rebuild(); });
    var randComp = document.getElementById("lc-labor-rand-comp");
    if (randComp) randComp.addEventListener("click", function () {
        var comp = new LaborManager(p).addRandomComplication();
        if (comp) { saveSettingsDebounced(); renderLabor(); toastr.info("\u26A0\uFE0F " + comp); }
        else toastr.warning("Все осложнения уже добавлены!");
    });
    var clearComp = document.getElementById("lc-labor-clear-comp");
    if (clearComp) clearComp.addEventListener("click", function () { new LaborManager(p).clearComplications(); saveSettingsDebounced(); renderLabor(); toastr.success("Осложнения убраны!"); });
    var rmBtns = document.querySelectorAll(".lc-labor-rm-comp");
    for (var ri = 0; ri < rmBtns.length; ri++) {
        rmBtns[ri].addEventListener("click", function () { new LaborManager(p).removeComplication(this.dataset.comp); saveSettingsDebounced(); renderLabor(); });
    }
}

// ========================
// BIND HEAT/RUT BUTTONS
// ========================
function bindHeatRutButtons(profile) {
    var el;
    el = document.getElementById("lc-hr-th"); if (el) el.addEventListener("click", function () { profile.heat.active = true; profile.heat.currentDay = 1; saveSettingsDebounced(); renderHeatRut(); renderDashboard(); });
    el = document.getElementById("lc-hr-sh"); if (el) el.addEventListener("click", function () { profile.heat.active = false; profile.heat.currentDay = 0; profile.heat.daysSinceLast = 0; saveSettingsDebounced(); renderHeatRut(); renderDashboard(); });
    el = document.getElementById("lc-hr-su"); if (el) el.addEventListener("click", function () { profile.heat.onSuppressants = !profile.heat.onSuppressants; saveSettingsDebounced(); renderHeatRut(); });
    el = document.getElementById("lc-hr-tr"); if (el) el.addEventListener("click", function () { profile.rut.active = true; profile.rut.currentDay = 1; saveSettingsDebounced(); renderHeatRut(); renderDashboard(); });
    el = document.getElementById("lc-hr-sr"); if (el) el.addEventListener("click", function () { profile.rut.active = false; profile.rut.currentDay = 0; profile.rut.daysSinceLast = 0; saveSettingsDebounced(); renderHeatRut(); renderDashboard(); });
}

// ========================
// POPUPS
// ========================
function showDicePopup(result, targetName, isAuto) {
    var oldO = document.querySelector(".lc-overlay"); var oldP = document.querySelector(".lc-popup"); if (oldO) oldO.remove(); if (oldP) oldP.remove();
    var overlay = document.createElement("div"); overlay.className = "lc-overlay";
    var popup = document.createElement("div"); popup.className = "lc-popup";
    var html = '<div class="lc-popup-title">\uD83C\uDFB2 Бросок на зачатие</div>';
    if (isAuto) html += '<div class="lc-popup-auto">\u26A1 Авто-определение</div>';
    html += '<div class="lc-popup-details">' + targetName + ' | Шанс: ' + result.chance + '% | Тип: ' + (result.type || "?") + '</div>';
    html += '<div class="lc-popup-result ' + (result.result ? "success" : "fail") + '">' + result.roll + ' / ' + result.chance + '</div>';
    html += '<div class="lc-popup-verdict ' + (result.result ? "success" : "fail") + '">' + (result.result ? "\uD83E\uDD30 ЗАЧАТИЕ!" : "\u2716 Не в этот раз") + '</div>';
    html += '<div class="lc-popup-actions"><button class="lc-btn lc-btn-primary" id="lc-dp-ok">' + (result.result ? "\u2713 Принять" : "OK") + '</button><button class="lc-btn" id="lc-dp-re">\uD83C\uDFB2 Перебросить</button><button class="lc-btn lc-btn-danger" id="lc-dp-no">Отмена</button></div>';
    popup.innerHTML = html; document.body.appendChild(overlay); document.body.appendChild(popup);
    document.getElementById("lc-dp-ok").addEventListener("click", function () {
        if (result.result) {
            var p = S().characters[targetName];
            if (p && canGetPregnant(p)) {
                var fatherName = (result.parts || []).find(function (x) { return x !== targetName; }) || "?";
                new PregManager(p).start(fatherName, 1); saveSettingsDebounced(); rebuild();
            }
        }
        overlay.remove(); popup.remove();
    });
    document.getElementById("lc-dp-re").addEventListener("click", function () {
        overlay.remove(); popup.remove();
        var newResult = Intimacy.roll(targetName, { parts: result.parts, type: result.type, ejac: result.ejac, auto: isAuto });
        showDicePopup(newResult, targetName, isAuto);
    });
    document.getElementById("lc-dp-no").addEventListener("click", function () { overlay.remove(); popup.remove(); });
    overlay.addEventListener("click", function () { overlay.remove(); popup.remove(); });
}

function showBabyForm(parentName, fatherName, existingBaby, babyIndex, isStandalone) {
    var s = S(); var isEdit = !!existingBaby; var baby = existingBaby || {};
    var oldO = document.querySelector(".lc-overlay"); var oldP = document.querySelector(".lc-popup"); if (oldO) oldO.remove(); if (oldP) oldP.remove();
    var overlay = document.createElement("div"); overlay.className = "lc-overlay";
    var form = document.createElement("div"); form.className = "lc-popup"; form.style.maxWidth = "400px";
    var html = '<div class="lc-popup-title">' + (isEdit ? "\u270F\uFE0F Редактировать" : "\uD83D\uDC76 Новый ребёнок") + '</div>';
    html += '<div class="lc-editor-grid">';
    html += '<div class="lc-editor-field"><label>Имя</label><input class="lc-input" id="lc-bf-name" value="' + (baby.name || "") + '" placeholder="Имя"></div>';
    html += '<div class="lc-editor-field"><label>Пол</label><select class="lc-select" id="lc-bf-sex"><option value="random">\uD83C\uDFB2</option><option value="M"' + (baby.sex === "M" ? " selected" : "") + '>\u2642 М</option><option value="F"' + (baby.sex === "F" ? " selected" : "") + '>\u2640 Ж</option></select></div>';
    html += '<div class="lc-editor-field"><label>Глаза</label><input class="lc-input" id="lc-bf-eyes" value="' + (baby.eyeColor || "") + '"></div>';
    html += '<div class="lc-editor-field"><label>Волосы</label><input class="lc-input" id="lc-bf-hair" value="' + (baby.hairColor || "") + '"></div>';
    if (isEdit) html += '<div class="lc-editor-field"><label>Возраст (дни)</label><input type="number" class="lc-input" id="lc-bf-age" value="' + (baby.ageDays || 0) + '"></div>';
    if (isStandalone) {
        var co = charOptions();
        html += '<div class="lc-editor-field"><label>Мать</label><select class="lc-select" id="lc-bf-mo">' + co + '</select></div>';
        html += '<div class="lc-editor-field"><label>Отец</label><select class="lc-select" id="lc-bf-fa">' + co + '</select></div>';
        html += '<div class="lc-editor-field"><label>Прикрепить к</label><select class="lc-select" id="lc-bf-to">' + co + '</select></div>';
    }
    html += '</div>';
    html += '<div class="lc-popup-actions" style="margin-top:10px"><button class="lc-btn lc-btn-primary" id="lc-bf-save">\u2713 Сохранить</button><button class="lc-btn" id="lc-bf-cancel">Отмена</button></div>';
    form.innerHTML = html; document.body.appendChild(overlay); document.body.appendChild(form);

    document.getElementById("lc-bf-save").addEventListener("click", function () {
        var name = (document.getElementById("lc-bf-name").value || "").trim() || "Малыш";
        var sex = document.getElementById("lc-bf-sex").value;
        if (sex === "random") sex = Math.random() < 0.5 ? "M" : "F";
        var eyes = (document.getElementById("lc-bf-eyes").value || "").trim();
        var hair = (document.getElementById("lc-bf-hair").value || "").trim();
        if (isEdit) {
            var editBaby = s.characters[parentName] && s.characters[parentName].babies && s.characters[parentName].babies[babyIndex];
            if (editBaby) {
                editBaby.name = name; editBaby.sex = sex;
                if (eyes) editBaby.eyeColor = eyes; if (hair) editBaby.hairColor = hair;
                var ageInput = document.getElementById("lc-bf-age");
                if (ageInput) { editBaby.ageDays = parseInt(ageInput.value) || 0; new BabyManager(editBaby).update(); }
                saveSettingsDebounced(); rebuild();
            }
        } else if (isStandalone) {
            var moVal = document.getElementById("lc-bf-mo") ? document.getElementById("lc-bf-mo").value : "?";
            var faVal = document.getElementById("lc-bf-fa") ? document.getElementById("lc-bf-fa").value : "?";
            var toVal = document.getElementById("lc-bf-to") ? document.getElementById("lc-bf-to").value : null;
            if (toVal && s.characters[toVal]) {
                var newBaby = BabyManager.generate(s.characters[moVal], faVal, { name: name, sex: sex, eyeColor: eyes, hairColor: hair });
                newBaby.mother = moVal; newBaby.father = faVal;
                s.characters[toVal].babies.push(newBaby);
                Rels.addBirth(moVal, faVal, name); saveSettingsDebounced(); rebuild();
            }
        } else {
            var mother = s.characters[parentName];
            if (mother) {
                var newBaby2 = BabyManager.generate(mother, fatherName, { name: name, sex: sex, eyeColor: eyes, hairColor: hair });
                mother.babies.push(newBaby2); Rels.addBirth(parentName, fatherName, name);
                var lm = new LaborManager(mother); lm.deliver();
                if (lm.l.babiesDelivered >= lm.l.totalBabies) lm.end();
                saveSettingsDebounced(); rebuild();
            }
        }
        overlay.remove(); form.remove();
    });
    document.getElementById("lc-bf-cancel").addEventListener("click", function () { overlay.remove(); form.remove(); });
    overlay.addEventListener("click", function () { overlay.remove(); form.remove(); });
}

// ========================
// EDITOR
// ========================
var currentEditName = null;
function openEditor(name) {
    var s = S(); var p = s.characters[name]; if (!p) return; currentEditName = name;
    var ed = document.getElementById("lc-char-editor"); if (ed) ed.classList.remove("hidden");
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
function closeEditor() { currentEditName = null; var ed = document.getElementById("lc-char-editor"); if (ed) ed.classList.add("hidden"); }
function saveEditor() {
    if (!currentEditName) return; var s = S(); var p = s.characters[currentEditName]; if (!p) return;
    p.bioSex = document.getElementById("lc-ed-bio").value; p._mB = true;
    p.secondarySex = document.getElementById("lc-ed-sec").value || null; p._mS = true;
    p.race = document.getElementById("lc-ed-race").value; p._mR = true;
    p.contraception = document.getElementById("lc-ed-contra").value;
    p.eyeColor = document.getElementById("lc-ed-eyes").value; p._mE = !!p.eyeColor;
    p.hairColor = document.getElementById("lc-ed-hair").value; p._mH = !!p.hairColor;
    p.pregnancyDifficulty = document.getElementById("lc-ed-diff").value;
    p._enabled = document.getElementById("lc-ed-on").checked;
    p.cycle.enabled = document.getElementById("lc-ed-cyc").checked; p._mCyc = true;
    var len = parseInt(document.getElementById("lc-ed-clen").value);
    if (len >= 21 && len <= 45) { p.cycle.baseLength = len; p.cycle.length = len; }
    p.cycle.menstruationDuration = parseInt(document.getElementById("lc-ed-mdur").value) || 5;
    p.cycle.irregularity = parseInt(document.getElementById("lc-ed-irreg").value) || 2;
    saveSettingsDebounced(); Profiles.save(); closeEditor(); rebuild();
    toastr.success(currentEditName + " сохранён!");
}

// ========================
// HTML GENERATION
// ========================
function generateHTML() {
    var s = S(); var co = charOptions(); var rto = relTypeOptions();
    var h = '<div id="bunnycycle-panel"' + (s.panelCollapsed ? ' class="collapsed"' : '') + '>';

    // Header
    h += '<div class="lifecycle-header" id="bunnycycle-header-toggle"><div class="lifecycle-header-title"><span class="lc-collapse-arrow">' + (s.panelCollapsed ? '\u25B6' : '\u25BC') + '</span><h3>\uD83D\uDC30 BunnyCycle</h3><span class="lc-version">v1.3</span></div>';
    h += '<div class="lifecycle-header-actions"><label class="lc-switch"><input type="checkbox" id="lc-enabled"' + (s.enabled ? ' checked' : '') + '><span class="lc-switch-slider"></span></label></div></div>';

    // Body
    h += '<div class="lifecycle-body">';

    // Dashboard
    h += '<div class="lc-dashboard"><div class="lc-dashboard-date" id="lc-dash-date"></div><div id="lc-dash-items"></div></div>';

    // Tabs
    h += '<div class="lifecycle-tabs">';
    var tabs = [["chars", "\uD83D\uDC64", "Перс."], ["rel", "\uD83D\uDD17", "Связи"], ["cycle", "\uD83D\uDD34", "Цикл"], ["hr", "\uD83D\uDD25", "Течка"], ["intim", "\uD83C\uDFB2", "Секс"], ["preg", "\uD83E\uDD30", "Берем."], ["labor", "\uD83C\uDFE5", "Роды"], ["baby", "\uD83D\uDC76", "Дети"], ["ovi", "\uD83E\uDD5A", "Ови"], ["au", "\uD83C\uDF10", "AU"], ["profiles", "\uD83D\uDCBE", "Профили"], ["settings", "\u2699\uFE0F", "Настр."]];
    for (var ti = 0; ti < tabs.length; ti++) {
        h += '<button class="lifecycle-tab' + (ti === 0 ? ' active' : '') + '" data-tab="' + tabs[ti][0] + '"><span class="tab-icon">' + tabs[ti][1] + '</span> ' + tabs[ti][2] + '</button>';
    }
    h += '</div>';

    // TAB: Characters
    h += '<div class="lifecycle-tab-content active" data-tab="chars">';
    h += '<div class="lc-btn-group" style="margin-bottom:8px"><button class="lc-btn lc-btn-primary" id="lc-sync">\uD83D\uDD04 Синхр.</button><button class="lc-btn" id="lc-add-m">\u2795 Добавить</button><button class="lc-btn lc-btn-success" id="lc-reparse">\uD83E\uDD16 AI-скан</button></div>';
    h += '<div id="lc-char-list"></div>';
    // Editor
    h += '<div class="lc-editor hidden" id="lc-char-editor"><div class="lc-editor-title" id="lc-editor-title"></div><div class="lc-editor-grid">';
    h += '<div class="lc-editor-field"><label>Био. пол</label><select class="lc-select" id="lc-ed-bio"><option value="F">\u2640 Ж</option><option value="M">\u2642 М</option></select></div>';
    h += '<div class="lc-editor-field"><label>Вторичный</label><select class="lc-select" id="lc-ed-sec"><option value="">-</option><option value="alpha">\u03B1</option><option value="beta">\u03B2</option><option value="omega">\u03A9</option></select></div>';
    h += '<div class="lc-editor-field"><label>Раса</label><input class="lc-input" id="lc-ed-race" value="human"></div>';
    h += '<div class="lc-editor-field"><label>Контрацепция</label><select class="lc-select" id="lc-ed-contra"><option value="none">Нет</option><option value="condom">Презерватив</option><option value="pill">Таблетки</option><option value="iud">Спираль</option><option value="withdrawal">ППА</option></select></div>';
    h += '<div class="lc-editor-field"><label>Глаза</label><input class="lc-input" id="lc-ed-eyes"></div>';
    h += '<div class="lc-editor-field"><label>Волосы</label><input class="lc-input" id="lc-ed-hair"></div>';
    h += '<div class="lc-editor-field"><label>Сложность берем.</label><select class="lc-select" id="lc-ed-diff"><option value="easy">Лёгкая</option><option value="normal">Норма</option><option value="hard">Тяжёлая</option></select></div>';
    h += '<div class="lc-editor-field"><label>Включён</label><input type="checkbox" id="lc-ed-on" checked></div>';
    h += '</div><hr class="lc-hr">';
    h += '<div class="lc-editor-grid">';
    h += '<div class="lc-editor-field"><label>Цикл вкл</label><input type="checkbox" id="lc-ed-cyc"></div>';
    h += '<div class="lc-editor-field"><label>Длина цикла</label><input type="number" class="lc-input" id="lc-ed-clen" min="21" max="45"></div>';
    h += '<div class="lc-editor-field"><label>Дни менстр.</label><input type="number" class="lc-input" id="lc-ed-mdur" min="2" max="10"></div>';
    h += '<div class="lc-editor-field"><label>Нерегулярность</label><input type="number" class="lc-input" id="lc-ed-irreg" min="0" max="7"></div>';
    h += '</div>';
    h += '<div class="lc-editor-actions"><button class="lc-btn lc-btn-primary" id="lc-ed-save">\u2713 Сохранить</button><button class="lc-btn" id="lc-ed-cancel">Отмена</button></div></div>';
    h += '</div>'; // chars tab

    // TAB: Relationships
    h += '<div class="lifecycle-tab-content" data-tab="rel">';
    h += '<div class="lc-row"><select class="lc-select lc-char-select" id="lc-rel-c1">' + co + '</select><span>\u2192</span><select class="lc-select lc-char-select" id="lc-rel-c2">' + co + '</select><select class="lc-select" id="lc-rel-tp">' + rto + '</select></div>';
    h += '<div class="lc-row"><input class="lc-input" id="lc-rel-n" placeholder="Заметки" style="flex:1"><button class="lc-btn lc-btn-primary" id="lc-rel-add">\u2795</button></div>';
    h += '<div id="lc-rel-list" class="lc-scroll"></div></div>';

    // TAB: Cycle
    h += '<div class="lifecycle-tab-content" data-tab="cycle">';
    h += '<div class="lc-row"><select class="lc-select lc-char-select" id="lc-cyc-char">' + co + '</select></div>';
    h += '<div id="lc-cyc-panel"></div></div>';

    // TAB: Heat/Rut
    h += '<div class="lifecycle-tab-content" data-tab="hr">';
    h += '<div class="lc-row"><select class="lc-select lc-char-select" id="lc-hr-char">' + co + '</select></div>';
    h += '<div id="lc-hr-panel"></div></div>';

    // TAB: Intimacy
    h += '<div class="lifecycle-tab-content" data-tab="intim">';
    h += '<div class="lc-section"><h4>\uD83C\uDFB2 Бросок / Лог</h4>';
    h += '<div class="lc-row"><label>Цель</label><select class="lc-select lc-char-select" id="lc-int-t">' + co + '</select></div>';
    h += '<div class="lc-row"><label>Партнёр</label><select class="lc-select lc-char-select" id="lc-int-p">' + co + '</select></div>';
    h += '<div class="lc-row"><label>Тип</label><select class="lc-select" id="lc-int-tp"><option value="vaginal">Вагинальный</option><option value="anal">Анальный</option><option value="oral">Оральный</option></select></div>';
    h += '<div class="lc-row"><label>Эякуляция</label><select class="lc-select" id="lc-int-ej"><option value="inside">Внутрь</option><option value="outside">Наружу</option><option value="unknown">Неизвестно</option></select></div>';
    h += '<div class="lc-btn-group"><button class="lc-btn lc-btn-primary" id="lc-int-roll">\uD83C\uDFB2 Бросок</button><button class="lc-btn" id="lc-int-log">\uD83D\uDCDD Лог</button></div></div>';
    h += '<div class="lc-section"><h4>Броски</h4><div id="lc-dice-log" class="lc-scroll"></div></div>';
    h += '<div class="lc-section"><h4>Контакты</h4><div id="lc-intim-log" class="lc-scroll"></div></div>';
    h += '</div>'; // intim tab

    // TAB: Pregnancy
    h += '<div class="lifecycle-tab-content" data-tab="preg">';
    h += '<div class="lc-row"><select class="lc-select lc-char-select" id="lc-preg-char">' + co + '</select></div>';
    h += '<div id="lc-preg-panel"></div></div>';

    // TAB: Labor
    h += '<div class="lifecycle-tab-content" data-tab="labor">';
    h += '<div class="lc-row"><select class="lc-select lc-char-select" id="lc-labor-char">' + co + '</select></div>';
    h += '<div id="lc-labor-panel"></div></div>';

    // TAB: Baby
    h += '<div class="lifecycle-tab-content" data-tab="baby">';
    h += '<div class="lc-row"><select class="lc-select lc-char-select" id="lc-baby-par">' + co + '</select><button class="lc-btn lc-btn-sm" id="lc-baby-create">\u2795 Создать</button></div>';
    h += '<div id="lc-baby-list"></div></div>';

    // TAB: Ovi
    h += '<div class="lifecycle-tab-content" data-tab="ovi">';
    h += '<div class="lc-row"><select class="lc-select lc-char-select" id="lc-ovi-char">' + co + '</select></div>';
    h += '<div class="lc-btn-group" style="margin-bottom:6px"><button class="lc-btn lc-btn-sm" id="lc-ovi-start">\uD83E\uDD5A Начать</button><button class="lc-btn lc-btn-sm" id="lc-ovi-adv">+1 день</button><button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-ovi-end">Завершить</button></div>';
    h += '<div id="lc-ovi-panel"></div></div>';

    // TAB: AU Settings
    h += '<div class="lifecycle-tab-content" data-tab="au"><div id="lc-au-panel"></div></div>';

    // TAB: Profiles
    h += '<div class="lifecycle-tab-content" data-tab="profiles">';
    h += '<div class="lc-info-row" id="lc-prof-cur"></div>';
    h += '<div class="lc-btn-group" style="margin-bottom:6px"><button class="lc-btn lc-btn-primary" id="lc-prof-save">\uD83D\uDCBE Сохранить</button><button class="lc-btn" id="lc-prof-reload">\uD83D\uDD04 Перезагр.</button></div>';
    h += '<div id="lc-prof-list" class="lc-scroll"></div></div>';

    // TAB: Settings
    h += '<div class="lifecycle-tab-content" data-tab="settings">';
    // Modules
    h += '<div class="lc-section"><h4>Модули</h4>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-mc"' + (s.modules.cycle ? ' checked' : '') + '>Цикл</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-mp"' + (s.modules.pregnancy ? ' checked' : '') + '>Беременность</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-ml"' + (s.modules.labor ? ' checked' : '') + '>Роды</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-mb"' + (s.modules.baby ? ' checked' : '') + '>Дети</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-mi"' + (s.modules.intimacy ? ' checked' : '') + '>Интим</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-mau"' + (s.modules.auOverlay ? ' checked' : '') + '>AU оверлей</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-ovi-on"' + (s.auSettings.oviposition.enabled ? ' checked' : '') + '>Овипозиция</label></div>';
    // Automation
    h += '<div class="lc-section"><h4>Автоматизация</h4>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-sa"' + (s.autoSyncCharacters ? ' checked' : '') + '>Авто-синхр. персонажей</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-sp"' + (s.autoParseCharInfo ? ' checked' : '') + '>Авто-парсинг карточек</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-sc"' + (s.parseFullChat ? ' checked' : '') + '>Парсинг чата</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-sd"' + (s.autoDetectIntimacy ? ' checked' : '') + '>Авто-детект секса</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-sr"' + (s.autoRollOnSex ? ' checked' : '') + '>Авто-бросок</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-sw"' + (s.showStatusWidget ? ' checked' : '') + '>Виджет в чате</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-st"' + (s.autoTimeProgress ? ' checked' : '') + '>Авто-время</label>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-sllm"' + (s.useLLMParsing ? ' checked' : '') + '>LLM парсинг</label></div>';
    // Prompt
    h += '<div class="lc-section"><h4>Промпт</h4>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-pon"' + (s.promptInjectionEnabled ? ' checked' : '') + '>Инъекция промпта</label>';
    h += '<div class="lc-row"><label>Позиция</label><select class="lc-select" id="lc-ppos"><option value="authornote"' + (s.promptInjectionPosition === "authornote" ? " selected" : "") + '>Author Note</option><option value="system"' + (s.promptInjectionPosition === "system" ? " selected" : "") + '>System</option></select></div>';
    h += '<div class="lc-row"><label>AU пресет</label><select class="lc-select" id="lc-aup"><option value="realism"' + (s.auPreset === "realism" ? " selected" : "") + '>Реализм</option><option value="omegaverse"' + (s.auPreset === "omegaverse" ? " selected" : "") + '>Омегаверс</option><option value="fantasy"' + (s.auPreset === "fantasy" ? " selected" : "") + '>Фэнтези</option></select></div></div>';
    // Date
    h += '<div class="lc-section"><h4>Дата мира</h4>';
    h += '<div class="lc-row"><input type="number" class="lc-input" id="lc-dy" value="' + s.worldDate.year + '" style="width:70px" placeholder="Год"><input type="number" class="lc-input" id="lc-dm" value="' + s.worldDate.month + '" style="width:45px" placeholder="М"><input type="number" class="lc-input" id="lc-dd" value="' + s.worldDate.day + '" style="width:45px" placeholder="Д"><input type="number" class="lc-input" id="lc-dh" value="' + s.worldDate.hour + '" style="width:45px" placeholder="Ч"><button class="lc-btn lc-btn-sm" id="lc-da">\u2713</button></div>';
    h += '<div class="lc-btn-group"><button class="lc-btn lc-btn-sm" id="lc-d1">+1д</button><button class="lc-btn lc-btn-sm" id="lc-d7">+7д</button><label class="lc-checkbox"><input type="checkbox" id="lc-df"' + (s.worldDate.frozen ? ' checked' : '') + '>\u2744 Заморозить</label></div></div>';
    // Export/Import/Reset
    h += '<div class="lc-section"><h4>Данные</h4>';
    h += '<div class="lc-btn-group"><button class="lc-btn lc-btn-sm" id="lc-exp">\uD83D\uDCE4 Экспорт</button><button class="lc-btn lc-btn-sm" id="lc-imp">\uD83D\uDCE5 Импорт</button><button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-rst">\u26A0 Сброс</button></div></div>';
    h += '</div>'; // settings tab

    h += '</div>'; // body
    h += '</div>'; // panel

    return h;
}

// ========================
// BIND ALL
// ========================
function bindAll() {
    var s = S();

    // Header toggle
    var headerEl = document.getElementById("bunnycycle-header-toggle");
    if (headerEl) headerEl.addEventListener("click", function (e) {
        if (e.target.closest(".lc-switch")) return;
        s.panelCollapsed = !s.panelCollapsed;
        var panel = document.getElementById("bunnycycle-panel");
        if (panel) panel.classList.toggle("collapsed", s.panelCollapsed);
        var arrow = this.querySelector(".lc-collapse-arrow");
        if (arrow) arrow.innerHTML = s.panelCollapsed ? "\u25B6" : "\u25BC";
        saveSettingsDebounced();
    });

    // Enabled
    var enEl = document.getElementById("lc-enabled");
    if (enEl) enEl.addEventListener("change", function () { s.enabled = this.checked; saveSettingsDebounced(); });

    // Tabs
    var tabBtns = document.querySelectorAll(".lifecycle-tab");
    for (var ti = 0; ti < tabBtns.length; ti++) {
        tabBtns[ti].addEventListener("click", function () {
            document.querySelectorAll(".lifecycle-tab").forEach(function (t) { t.classList.remove("active"); });
            document.querySelectorAll(".lifecycle-tab-content").forEach(function (p) { p.classList.remove("active"); });
            this.classList.add("active");
            var target = document.querySelector('.lifecycle-tab-content[data-tab="' + this.dataset.tab + '"]');
            if (target) target.classList.add("active");
            rebuild();
        });
    }

    // Sync / Add / Reparse
    var syncBtn = document.getElementById("lc-sync");
    if (syncBtn) syncBtn.addEventListener("click", async function () { toastr.info("Сканирование..."); await syncChars(); rebuild(); toastr.success("Готово!"); });
    var addBtn = document.getElementById("lc-add-m");
    if (addBtn) addBtn.addEventListener("click", function () { var n = prompt("Имя персонажа:"); if (n && n.trim()) { s.characters[n.trim()] = makeProfile(n.trim(), false, "F"); saveSettingsDebounced(); rebuild(); } });
    var reparseBtn = document.getElementById("lc-reparse");
    if (reparseBtn) reparseBtn.addEventListener("click", async function () {
        CharAnalyzer.clearCache(); ChatAnalyzer.clearCache();
        Object.keys(s.characters).forEach(function (name) { var p = s.characters[name]; p._mB = false; p._mE = false; p._mH = false; p._mR = false; p._mS = false; p._sexConfidence = 0; });
        toastr.info("AI анализирует..."); await syncChars(); rebuild(); toastr.success("AI-скан завершён!");
    });

    // Char list
    var charList = document.getElementById("lc-char-list");
    if (charList) charList.addEventListener("click", function (e) {
        var editBtn = e.target.closest(".lc-edit-char"); var delBtn = e.target.closest(".lc-del-char");
        if (editBtn) openEditor(editBtn.dataset.char);
        if (delBtn && confirm("Удалить персонажа?")) { delete s.characters[delBtn.dataset.char]; saveSettingsDebounced(); rebuild(); }
    });

    // Editor
    var edSave = document.getElementById("lc-ed-save"); if (edSave) edSave.addEventListener("click", saveEditor);
    var edCancel = document.getElementById("lc-ed-cancel"); if (edCancel) edCancel.addEventListener("click", closeEditor);

    // Relations
    var relAdd = document.getElementById("lc-rel-add");
    if (relAdd) relAdd.addEventListener("click", function () {
        var c1 = document.getElementById("lc-rel-c1"); var c2 = document.getElementById("lc-rel-c2"); var tp = document.getElementById("lc-rel-tp"); var notes = document.getElementById("lc-rel-n");
        if (!c1 || !c2 || !tp || c1.value === c2.value) return;
        Rels.add(c1.value, c2.value, tp.value, notes ? notes.value : "");
        if (notes) notes.value = ""; renderRelations();
    });

    // Cycle
    var cycChar = document.getElementById("lc-cyc-char"); if (cycChar) cycChar.addEventListener("change", renderCycle);
    // Cycle buttons are inside renderCycle, need delegation
    var cycPanel = document.getElementById("lc-cyc-panel");
    if (cycPanel) cycPanel.addEventListener("click", function (e) {
        var sel = document.getElementById("lc-cyc-char"); if (!sel) return;
        var p = s.characters[sel.value]; if (!p || !p.cycle || !p.cycle.enabled) return;
        if (e.target.id === "lc-cyc-setday") { var inp = document.getElementById("lc-cyc-day"); if (inp) { var d = parseInt(inp.value); if (d >= 1 && d <= p.cycle.length) { new CycleManager(p).setDay(d); saveSettingsDebounced(); renderCycle(); renderDashboard(); } } }
        if (e.target.id === "lc-cyc-mens") { new CycleManager(p).setPhase("menstruation"); saveSettingsDebounced(); renderCycle(); renderDashboard(); }
        if (e.target.id === "lc-cyc-foll") { new CycleManager(p).setPhase("follicular"); saveSettingsDebounced(); renderCycle(); renderDashboard(); }
        if (e.target.id === "lc-cyc-ovul") { new CycleManager(p).setPhase("ovulation"); saveSettingsDebounced(); renderCycle(); renderDashboard(); }
        if (e.target.id === "lc-cyc-lut") { new CycleManager(p).setPhase("luteal"); saveSettingsDebounced(); renderCycle(); renderDashboard(); }
        if (e.target.id === "lc-cyc-skip") { p.cycle.currentDay = 1; p.cycle.cycleCount++; saveSettingsDebounced(); renderCycle(); renderDashboard(); }
    });

    // Heat/Rut
    var hrChar = document.getElementById("lc-hr-char"); if (hrChar) hrChar.addEventListener("change", renderHeatRut);

    // Intimacy
    var intLog = document.getElementById("lc-int-log");
    if (intLog) intLog.addEventListener("click", function () {
        var t = document.getElementById("lc-int-t"); if (!t || !t.value) return;
        Intimacy.log({ parts: [t.value, (document.getElementById("lc-int-p") || {}).value].filter(Boolean), type: (document.getElementById("lc-int-tp") || {}).value || "vaginal", ejac: (document.getElementById("lc-int-ej") || {}).value || "unknown" });
        renderIntimLog();
    });
    var intRoll = document.getElementById("lc-int-roll");
    if (intRoll) intRoll.addEventListener("click", function () {
        var t = document.getElementById("lc-int-t"); if (!t || !t.value) return;
        var result = Intimacy.roll(t.value, { parts: [t.value, (document.getElementById("lc-int-p") || {}).value].filter(Boolean), type: (document.getElementById("lc-int-tp") || {}).value || "vaginal", ejac: (document.getElementById("lc-int-ej") || {}).value || "unknown" });
        if (result.reason === "not_eligible") { toastr.warning("Не может забеременеть!"); return; }
        showDicePopup(result, t.value, false); renderDiceLog();
    });

    // Pregnancy char selector
    var pregChar = document.getElementById("lc-preg-char"); if (pregChar) pregChar.addEventListener("change", renderPregnancy);

    // Labor char selector
    var laborChar = document.getElementById("lc-labor-char"); if (laborChar) laborChar.addEventListener("change", renderLabor);

    // Baby
    var babyPar = document.getElementById("lc-baby-par"); if (babyPar) babyPar.addEventListener("change", renderBabies);
    var babyCreate = document.getElementById("lc-baby-create");
    if (babyCreate) babyCreate.addEventListener("click", function () { showBabyForm(null, null, null, null, true); });
    var babyList = document.getElementById("lc-baby-list");
    if (babyList) babyList.addEventListener("click", function (e) {
        var eb = e.target.closest(".lc-baby-edit"); var db = e.target.closest(".lc-baby-del");
        if (eb) { var baby = s.characters[eb.dataset.p] && s.characters[eb.dataset.p].babies[parseInt(eb.dataset.i)]; if (baby) showBabyForm(eb.dataset.p, baby.father, baby, parseInt(eb.dataset.i)); }
        if (db && confirm("Удалить?")) { if (s.characters[db.dataset.p]) s.characters[db.dataset.p].babies.splice(parseInt(db.dataset.i), 1); saveSettingsDebounced(); renderBabies(); }
    });

    // Ovi
    var oviChar = document.getElementById("lc-ovi-char"); if (oviChar) oviChar.addEventListener("change", renderOvi);
    var oviStart = document.getElementById("lc-ovi-start");
    if (oviStart) oviStart.addEventListener("click", function () { var sel = document.getElementById("lc-ovi-char"); if (!sel) return; var p = s.characters[sel.value]; if (p) { new OviManager(p).startCarrying(); saveSettingsDebounced(); renderOvi(); renderDashboard(); } });
    var oviAdv = document.getElementById("lc-ovi-adv");
    if (oviAdv) oviAdv.addEventListener("click", function () { var sel = document.getElementById("lc-ovi-char"); if (!sel) return; var p = s.characters[sel.value]; if (p && p.oviposition && p.oviposition.active) { new OviManager(p).advance(1); saveSettingsDebounced(); renderOvi(); renderDashboard(); } });
    var oviEnd = document.getElementById("lc-ovi-end");
    if (oviEnd) oviEnd.addEventListener("click", function () { var sel = document.getElementById("lc-ovi-char"); if (!sel) return; var p = s.characters[sel.value]; if (p && p.oviposition && p.oviposition.active) { new OviManager(p).end(); saveSettingsDebounced(); renderOvi(); renderDashboard(); } });

    // Profiles
    var profSave = document.getElementById("lc-prof-save");
    if (profSave) profSave.addEventListener("click", function () { Profiles.save(); renderProfiles(); toastr.success("Сохранено!"); });
    var profReload = document.getElementById("lc-prof-reload");
    if (profReload) profReload.addEventListener("click", async function () { Profiles.load(); await syncChars(); rebuild(); toastr.info("Перезагружено!"); });
    var profList = document.getElementById("lc-prof-list");
    if (profList) profList.addEventListener("click", function (e) {
        var lb = e.target.closest(".lc-prof-load"); var db = e.target.closest(".lc-prof-del");
        if (lb) {
            var pr = s.chatProfiles && s.chatProfiles[lb.dataset.id];
            if (pr) { s.characters = JSON.parse(JSON.stringify(pr.characters || {})); s.relationships = JSON.parse(JSON.stringify(pr.relationships || [])); s.worldDate = JSON.parse(JSON.stringify(pr.worldDate || DEFAULTS.worldDate)); s.currentChatId = lb.dataset.id; saveSettingsDebounced(); rebuild(); toastr.success("Загружено!"); }
        }
        if (db && confirm("Удалить?")) { Profiles.del(db.dataset.id); renderProfiles(); }
    });

    // Settings: Modules
    var modMap = { "lc-mc": "cycle", "lc-mp": "pregnancy", "lc-ml": "labor", "lc-mb": "baby", "lc-mi": "intimacy" };
    Object.keys(modMap).forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener("change", function () { s.modules[modMap[id]] = this.checked; saveSettingsDebounced(); }); });
    var mauEl = document.getElementById("lc-mau"); if (mauEl) mauEl.addEventListener("change", function () { s.modules.auOverlay = this.checked; saveSettingsDebounced(); renderAuSettings(); });
    var oviOnEl = document.getElementById("lc-ovi-on"); if (oviOnEl) oviOnEl.addEventListener("change", function () { s.auSettings.oviposition.enabled = this.checked; saveSettingsDebounced(); renderAuSettings(); });
    var llmEl = document.getElementById("lc-sllm"); if (llmEl) llmEl.addEventListener("change", function () { s.useLLMParsing = this.checked; saveSettingsDebounced(); });

    // Settings: Automation
    var autoMap = { "lc-sa": "autoSyncCharacters", "lc-sp": "autoParseCharInfo", "lc-sc": "parseFullChat", "lc-sd": "autoDetectIntimacy", "lc-sr": "autoRollOnSex", "lc-sw": "showStatusWidget", "lc-st": "autoTimeProgress" };
    Object.keys(autoMap).forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener("change", function () { s[autoMap[id]] = this.checked; saveSettingsDebounced(); }); });

    // Settings: Prompt
    var ponEl = document.getElementById("lc-pon"); if (ponEl) ponEl.addEventListener("change", function () { s.promptInjectionEnabled = this.checked; saveSettingsDebounced(); });
    var pposEl = document.getElementById("lc-ppos"); if (pposEl) pposEl.addEventListener("change", function () { s.promptInjectionPosition = this.value; saveSettingsDebounced(); });
    var aupEl = document.getElementById("lc-aup"); if (aupEl) aupEl.addEventListener("change", function () { s.auPreset = this.value; saveSettingsDebounced(); renderAuSettings(); });

    // Settings: Date
    var daBtn = document.getElementById("lc-da");
    if (daBtn) daBtn.addEventListener("click", function () {
        s.worldDate.year = parseInt(document.getElementById("lc-dy").value) || 2025;
        s.worldDate.month = clamp(parseInt(document.getElementById("lc-dm").value) || 1, 1, 12);
        s.worldDate.day = clamp(parseInt(document.getElementById("lc-dd").value) || 1, 1, 31);
        s.worldDate.hour = clamp(parseInt(document.getElementById("lc-dh").value) || 12, 0, 23);
        saveSettingsDebounced(); renderDashboard();
    });
    var d1Btn = document.getElementById("lc-d1"); if (d1Btn) d1Btn.addEventListener("click", function () { TimeParse.apply({ days: 1 }); rebuild(); });
    var d7Btn = document.getElementById("lc-d7"); if (d7Btn) d7Btn.addEventListener("click", function () { TimeParse.apply({ days: 7 }); rebuild(); });
    var dfEl = document.getElementById("lc-df"); if (dfEl) dfEl.addEventListener("change", function () { s.worldDate.frozen = this.checked; saveSettingsDebounced(); });

    // Export
    var expBtn = document.getElementById("lc-exp");
    if (expBtn) expBtn.addEventListener("click", function () {
        var blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob); var a = document.createElement("a");
        a.href = url; a.download = "bunnycycle_" + Date.now() + ".json";
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    });
    // Import
    var impBtn = document.getElementById("lc-imp");
    if (impBtn) impBtn.addEventListener("click", function () {
        var input = document.createElement("input"); input.type = "file"; input.accept = ".json";
        input.addEventListener("change", function (e) {
            var file = e.target.files[0]; if (!file) return;
            var reader = new FileReader();
            reader.onload = function (ev) {
                try {
                    extension_settings[EXT] = deepMerge(DEFAULTS, JSON.parse(ev.target.result));
                    saveSettingsDebounced();
                    var op = document.getElementById("bunnycycle-panel"); if (op) op.remove();
                    init(); toastr.success("Импортировано!");
                } catch (err) { toastr.error("Ошибка: " + err.message); }
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
        var op = document.getElementById("bunnycycle-panel"); if (op) op.remove();
        init();
    });
}

// ========================
// MESSAGE HOOK
// ========================
async function onMessageReceived(messageIndex) {
    var s = S(); if (!s.enabled) return;
    var ctx = getContext(); if (!ctx || !ctx.chat || messageIndex < 0) return;
    var msg = ctx.chat[messageIndex]; if (!msg || !msg.mes || msg.is_user) return;

    if (s.autoSyncCharacters) await syncChars();

    if (s.autoTimeProgress && !s.worldDate.frozen) {
        var timeResult = TimeParse.parse(msg.mes);
        if (timeResult) { TimeParse.apply(timeResult); rebuild(); }
    }

    if (s.autoDetectIntimacy && s.modules.intimacy) {
        var detection = SexDetect.detect(msg.mes, s.characters);
        if (detection && detection.detected) {
            Intimacy.log({ parts: detection.participants, type: detection.type, ejac: detection.ejac, auto: true });
            if (s.autoRollOnSex && detection.target && detection.type === "vaginal" && (detection.ejac === "inside" || detection.ejac === "unknown")) {
                var rollResult = Intimacy.roll(detection.target, {
                    parts: detection.participants, type: detection.type, ejac: detection.ejac,
                    condom: detection.condom, noCondom: detection.noCondom, auto: true
                });
                if (rollResult.reason !== "not_eligible") showDicePopup(rollResult, detection.target, true);
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
        console.log("[BunnyCycle] Initializing v1.3.0...");

        if (!extension_settings[EXT]) {
            extension_settings[EXT] = JSON.parse(JSON.stringify(DEFAULTS));
        } else {
            extension_settings[EXT] = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), extension_settings[EXT]);
        }

        var oldPanel = document.getElementById("bunnycycle-panel");
        if (oldPanel) oldPanel.remove();

        var container = document.getElementById("extensions_settings2") || document.getElementById("extensions_settings");
        if (!container) { console.warn("[BunnyCycle] No extensions container!"); return; }

        container.insertAdjacentHTML("beforeend", generateHTML());
        console.log("[BunnyCycle] HTML inserted");

        Profiles.load();
        await syncChars();
        bindAll();
        rebuild();

        if (eventSource) {
            eventSource.on(event_types.MESSAGE_RECEIVED, function (idx) { onMessageReceived(idx); });
            eventSource.on(event_types.CHAT_CHANGED, async function () { ChatAnalyzer.clearCache(); Profiles.load(); await syncChars(); rebuild(); });
            eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, function (data) {
                var s = S(); if (!s.enabled || !s.promptInjectionEnabled) return;
                var injection = Prompt.generate(); if (!injection) return;
                if (s.promptInjectionPosition === "system" && data.systemPrompt !== undefined) data.systemPrompt += "\n\n" + injection;
                else if (s.promptInjectionPosition === "authornote") data.authorNote = (data.authorNote || "") + "\n\n" + injection;
            });
        }

        console.log("[BunnyCycle v1.3.0] Successfully loaded!");
    } catch (err) {
        console.error("[BunnyCycle] Init error:", err);
    }
}

// Start
jQuery(async function () { await init(); });

// Global API
window.BunnyCycle = {
    getSettings: function () { return S(); },
    sync: syncChars,
    advanceTime: function (days) { TimeParse.apply({ days: days }); rebuild(); },
    rollDice: function (target, data) { return Intimacy.roll(target, data); },
    canGetPregnant: canGetPregnant,
    CharAnalyzer: CharAnalyzer,
    ChatAnalyzer: ChatAnalyzer,
    BondManager: BondManager
};
