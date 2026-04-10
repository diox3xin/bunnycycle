// BunnyCycle v1.2.0 — Full index.js (Manual Pregnancy + Complications)
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
    "Выпадение пуповины", "Разрыв матки", "Эмболия",
    "Задержка плаценты"
];

// ========================
// DEFAULTS
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
    worldDate: {
        year: 2025, month: 1, day: 1, hour: 12, minute: 0, frozen: false
    },
    autoTimeProgress: true,
    promptInjectionEnabled: true,
    promptInjectionPosition: "authornote",
    auPreset: "realism",
    auSettings: {
        omegaverse: {
            heatCycleLength: 30, heatDuration: 5, heatFertilityBonus: 0.35,
            preHeatDays: 1, postHeatDays: 1, heatIntensity: "moderate",
            rutCycleLength: 35, rutDuration: 4, preRutDays: 1, postRutDays: 1, rutIntensity: "moderate",
            knotEnabled: true, knotDurationMin: 30,
            bondingEnabled: true, bondingType: "bite",
            bondEffectEmpathy: true, bondEffectProximity: true, bondEffectProtective: true,
            bondBreakable: false, bondWithdrawalDays: 7,
            suppressantsAvailable: true, suppressantEffectiveness: 0.85, suppressantSideEffects: true,
            slickEnabled: true, scentEnabled: true, nestingEnabled: true, purringEnabled: true,
            maleOmegaPregnancy: true, pregnancyWeeks: 36, twinChance: 0.1,
            alphaCommandVoice: true, omegaSubmission: true
        },
        fantasy: {
            pregnancyByRace: { human: 40, elf: 60, dwarf: 35, orc: 32, demon: 28, vampire: 50, werewolf: 9, fairy: 20, dragon: 80, halfling: 38 },
            magicPregnancy: false, acceleratedPregnancy: false, accelerationFactor: 1.0
        },
        oviposition: {
            enabled: false, eggCountMin: 1, eggCountMax: 6, gestationDays: 14,
            layingDuration: 3, incubationDays: 21, fertilizationChance: 0.7,
            shellType: "hard", eggSize: "medium", painLevel: "moderate", aftercareDays: 2
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
    return d.year + "/" + String(d.month).padStart(2,"0") + "/" + String(d.day).padStart(2,"0") + " " + String(d.hour).padStart(2,"0") + ":" + String(d.minute).padStart(2,"0");
}
function addDaysToDate(d, n) {
    var dt = new Date(d.year, d.month - 1, d.day, d.hour, d.minute);
    dt.setDate(dt.getDate() + n);
    return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate(), hour: dt.getHours(), minute: dt.getMinutes(), frozen: d.frozen };
}
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
function roll100() { return Math.floor(Math.random() * 100) + 1; }
function makeId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
function canGetPregnant(p) {
    if (!p || !p._enabled) return false;
    if (p.bioSex === "F") return true;
    var s = S();
    if (p.bioSex === "M" && s.modules.auOverlay && s.auPreset === "omegaverse" && s.auSettings.omegaverse.maleOmegaPregnancy && p.secondarySex === "omega") return true;
    return false;
}
function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ========================
// LLM CALLER
// ========================
var LLM = {
    call: async function (sys, usr) {
        try {
            if (typeof window.SillyTavern !== "undefined") {
                var ctx = window.SillyTavern.getContext();
                if (ctx && typeof ctx.generateRaw === "function") { var resp = await ctx.generateRaw(sys + "\n\n" + usr, "", false, false, "[BunnyCycle]"); if (resp) return resp; }
            }
            if (typeof generateRaw === "function") { var resp2 = await generateRaw(sys + "\n\n" + usr, "", false, false); if (resp2) return resp2; }
            var fetchResp = await fetch("/api/backends/chat/generate", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ messages: [{ role: "system", content: sys }, { role: "user", content: usr }], max_tokens: 500, temperature: 0.05, stream: false })
            });
            if (fetchResp.ok) { var data = await fetchResp.json(); return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || data.content || data.response || ""; }
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
        var recent = messages.slice(-60); var msgTexts = [];
        for (var i = 0; i < recent.length; i++) { var m = recent[i]; msgTexts.push("[" + i + "] " + (m.is_user ? (m.name || "User") : (m.name || "AI")) + ": " + (m.mes || "").substring(0, 500)); }
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
    PATTERNS: [/вошё?л\s*(в\s*неё|внутрь)/i, /проник\w*\s*(в\s*неё|внутрь)/i, /член\s*(?:вошёл|внутри)/i, /кончил\s*(внутрь|в\s*неё|глубоко)/i, /трахал|ебал|выебал/i, /фрикци/i, /узел\s*(?:набух|внутри)/i, /(?:thrust|pushed|slid)\s*inside/i, /penetrat/i, /fuck(?:ed|ing)\s/i, /cum\w*\s*inside/i, /creampie/i, /knot\w*\s*inside/i],
    detect: function (text, chars) {
        if (!text) return null; var score = 0;
        for (var i = 0; i < this.PATTERNS.length; i++) { if (this.PATTERNS[i].test(text)) score++; }
        if (score < 3) return null;
        var type = "vaginal"; if (/анал|anal/i.test(text)) type = "anal"; if (/минет|blowjob/i.test(text)) type = "oral";
        var ejac = "unknown"; if (/кончил\s*(?:внутрь|в\s*неё)|cum\w*\s*inside|creampie/i.test(text)) ejac = "inside"; else if (/кончил\s*наружу|pull\w*\s*out/i.test(text)) ejac = "outside";
        var hasCondom = /презерватив|condom/i.test(text); var noCondom = /без\s*(?:презерватива|защиты)|bareback/i.test(text);
        var participants = []; var names = Object.keys(chars);
        for (var j = 0; j < names.length; j++) { if (text.toLowerCase().indexOf(names[j].toLowerCase()) !== -1 || chars[names[j]]._isUser) participants.push(names[j]); }
        if (participants.length < 2 && names.length >= 2) { for (var k = 0; k < names.length; k++) { if (participants.indexOf(names[k]) === -1) participants.push(names[k]); if (participants.length >= 2) break; } }
        var target = null; for (var m = 0; m < participants.length; m++) { if (chars[participants[m]] && canGetPregnant(chars[participants[m]])) { target = participants[m]; break; } }
        return { detected: true, type: type, condom: hasCondom && !noCondom, noCondom: noCondom, ejac: ejac, participants: participants, target: target };
    }
};

// ========================
// CYCLE MANAGER
// ========================
function CycleManager(profile) { this.p = profile; this.c = profile.cycle; }
CycleManager.prototype.phase = function () { if (!this.c || !this.c.enabled) return "unknown"; var d = this.c.currentDay, len = this.c.length; var ovDay = Math.round(len - 14); if (d <= this.c.menstruationDuration) return "menstruation"; if (d < ovDay - 2) return "follicular"; if (d <= ovDay + 1) return "ovulation"; return "luteal"; };
CycleManager.prototype.label = function (ph) { return ({menstruation:"Менструация",follicular:"Фолликулярная",ovulation:"Овуляция",luteal:"Лютеиновая",unknown:"-"})[ph]||ph; };
CycleManager.prototype.emoji = function (ph) { return ({menstruation:"\uD83D\uDD34",follicular:"\uD83C\uDF38",ovulation:"\uD83E\uDD5A",luteal:"\uD83C\uDF19"})[ph]||"?"; };
CycleManager.prototype.fertility = function () { var base = ({ovulation:0.25,follicular:0.08,luteal:0.02,menstruation:0.01})[this.phase()]||0.05; var s = S(); if (s.modules.auOverlay && s.auPreset === "omegaverse" && this.p.heat && this.p.heat.active) base += s.auSettings.omegaverse.heatFertilityBonus; return Math.min(base, 0.95); };
CycleManager.prototype.libido = function () { if ((this.p.heat && this.p.heat.active)||(this.p.rut && this.p.rut.active)) return "экстремальное"; return ({ovulation:"высокое",follicular:"среднее",luteal:"низкое",menstruation:"низкое"})[this.phase()]||"среднее"; };
CycleManager.prototype.symptoms = function () { var ph = this.phase(), r = []; if (ph==="menstruation"){r.push("кровотечение");r.push("спазмы");} if (ph==="ovulation") r.push("повышенное либидо"); if (ph==="luteal") r.push("ПМС"); if (ph==="follicular") r.push("прилив энергии"); return r; };
CycleManager.prototype.discharge = function () { return ({menstruation:"менструальные",follicular:"скудные",ovulation:"обильные, тягучие",luteal:"густые, кремообразные"})[this.phase()]||"обычные"; };
CycleManager.prototype.advance = function (days) { for (var i = 0; i < days; i++) { this.c.currentDay++; if (this.c.currentDay > this.c.length) { this.c.currentDay = 1; this.c.cycleCount++; if (this.c.irregularity > 0) this.c.length = clamp(this.c.baseLength + Math.floor(Math.random()*this.c.irregularity*2)-this.c.irregularity, 21, 45); } } };
CycleManager.prototype.setDay = function (d) { this.c.currentDay = clamp(d, 1, this.c.length); };
CycleManager.prototype.setPhase = function (ph) { var ovDay = Math.round(this.c.length - 14); var map = {menstruation:1,follicular:this.c.menstruationDuration+1,ovulation:ovDay,luteal:ovDay+2}; if (map[ph]) this.c.currentDay = map[ph]; };

// ========================
// HEAT/RUT MANAGER
// ========================
function HeatRutManager(profile) { this.p = profile; }
HeatRutManager.prototype.heatPhase = function () { var h = this.p.heat; if (!h) return "rest"; var cfg = S().auSettings.omegaverse||{}; if (h.active) { if (h.currentDay <= (cfg.preHeatDays||1)) return "preHeat"; if (h.currentDay <= h.duration-(cfg.postHeatDays||1)) return "heat"; return "postHeat"; } if ((h.cycleDays-(h.daysSinceLast||0))<=3) return "preHeat"; return "rest"; };
HeatRutManager.prototype.rutPhase = function () { var r = this.p.rut; if (!r) return "rest"; var cfg = S().auSettings.omegaverse||{}; if (r.active) { if (r.currentDay <= (cfg.preRutDays||1)) return "preRut"; if (r.currentDay <= r.duration-(cfg.postRutDays||1)) return "rut"; return "postRut"; } if ((r.cycleDays-(r.daysSinceLast||0))<=3) return "preRut"; return "rest"; };
HeatRutManager.prototype.heatLabel = function (ph) { return ({preHeat:"Предтечка",heat:"Течка",postHeat:"Посттечка",rest:"Покой"})[ph]||ph; };
HeatRutManager.prototype.rutLabel = function (ph) { return ({preRut:"Предгон",rut:"Гон",postRut:"Постгон",rest:"Покой"})[ph]||ph; };
HeatRutManager.prototype.heatDaysLeft = function () { var h = this.p.heat; if (!h||h.active) return 0; return Math.max(0, h.cycleDays-(h.daysSinceLast||0)); };
HeatRutManager.prototype.rutDaysLeft = function () { var r = this.p.rut; if (!r||r.active) return 0; return Math.max(0, r.cycleDays-(r.daysSinceLast||0)); };
HeatRutManager.prototype.advanceHeat = function (days) { var h = this.p.heat; if (!h||h.onSuppressants) return; var cfg = S().auSettings.omegaverse||{}; h.cycleDays = cfg.heatCycleLength||30; h.duration = cfg.heatDuration||5; for (var i=0;i<days;i++) { if (h.active) { h.currentDay++; if (h.currentDay > h.duration) {h.active=false;h.currentDay=0;h.daysSinceLast=0;} } else { h.daysSinceLast=(h.daysSinceLast||0)+1; if (h.daysSinceLast>=h.cycleDays){h.active=true;h.currentDay=1;} } } };
HeatRutManager.prototype.advanceRut = function (days) { var r = this.p.rut; if (!r) return; var cfg = S().auSettings.omegaverse||{}; r.cycleDays = cfg.rutCycleLength||35; r.duration = cfg.rutDuration||4; for (var i=0;i<days;i++) { if (r.active) { r.currentDay++; if (r.currentDay > r.duration){r.active=false;r.currentDay=0;r.daysSinceLast=0;} } else { r.daysSinceLast=(r.daysSinceLast||0)+1; if (r.daysSinceLast>=r.cycleDays){r.active=true;r.currentDay=1;} } } };

// ========================
// BOND MANAGER
// ========================
function BondManager(profile) {
    this.p = profile;
    if (!profile.bond) profile.bond = {bonded:false,partner:null,type:null,strength:0,daysSinceSeparation:0,withdrawalActive:false,markLocation:""};
    this.b = profile.bond;
}
BondManager.prototype.canBond = function () { var s = S(); return s.modules.auOverlay && s.auPreset === "omegaverse" && s.auSettings.omegaverse.bondingEnabled && !this.b.bonded; };
BondManager.prototype.createBond = function (partnerName) { var cfg = S().auSettings.omegaverse; this.b.bonded=true; this.b.partner=partnerName; this.b.type=cfg.bondingType||"bite"; this.b.strength=50; this.b.daysSinceSeparation=0; this.b.withdrawalActive=false; Rels.add(this.p.name,partnerName,"связь (бонд)",this.b.type); Rels.add(partnerName,this.p.name,"связь (бонд)",this.b.type); saveSettingsDebounced(); };
BondManager.prototype.breakBond = function () { var cfg = S().auSettings.omegaverse; if (!cfg.bondBreakable&&this.b.bonded){toastr.warning("Связь нельзя разорвать!");return false;} var partner=this.b.partner; this.b.bonded=false;this.b.partner=null;this.b.strength=0;this.b.withdrawalActive=true;this.b.daysSinceSeparation=0; if(partner){var s=S();var pp=s.characters[partner];if(pp&&pp.bond&&pp.bond.bonded&&pp.bond.partner===this.p.name){pp.bond.bonded=false;pp.bond.partner=null;pp.bond.strength=0;pp.bond.withdrawalActive=true;pp.bond.daysSinceSeparation=0;}} saveSettingsDebounced();return true; };
BondManager.prototype.advance = function (days) { if(!this.b.bonded&&!this.b.withdrawalActive)return; var cfg=S().auSettings.omegaverse; if(this.b.bonded)this.b.strength=Math.min(100,this.b.strength+days*2); if(this.b.withdrawalActive){this.b.daysSinceSeparation+=days;if(this.b.daysSinceSeparation>=(cfg.bondWithdrawalDays||7))this.b.withdrawalActive=false;} };
BondManager.prototype.statusLabel = function () { if(this.b.bonded) return "Связан с "+this.b.partner+" ("+this.b.strength+"%)"; if(this.b.withdrawalActive) return "Ломка (день "+this.b.daysSinceSeparation+")"; return "Нет связи"; };

// ========================
// PREGNANCY MANAGER (UPDATED - manual sex/count/complications)
// ========================
function PregManager(profile) { this.p = profile; this.pr = profile.pregnancy; }
PregManager.prototype.isActive = function () { return this.pr && this.pr.active; };

// START with manual options: father, count, sexes array, week
PregManager.prototype.start = function (father, count, sexes, startWeek) {
    var s = S();
    this.pr.active = true;
    this.pr.week = startWeek || 1;
    this.pr.day = 0;
    this.pr.father = father || "?";
    this.pr.fetusCount = count || 1;
    // Set sexes: use provided array or generate random
    this.pr.fetusSexes = [];
    for (var i = 0; i < this.pr.fetusCount; i++) {
        if (sexes && sexes[i]) {
            this.pr.fetusSexes.push(sexes[i]);
        } else {
            this.pr.fetusSexes.push(Math.random() < 0.5 ? "M" : "F");
        }
    }
    this.pr.complications = [];
    this.pr.weightGain = 0;
    var maxWeeks = 40;
    if (s.modules.auOverlay) {
        if (s.auPreset === "omegaverse") maxWeeks = s.auSettings.omegaverse.pregnancyWeeks || 36;
        if (s.auPreset === "fantasy") {
            var raceWeeks = s.auSettings.fantasy.pregnancyByRace[this.p.race];
            if (raceWeeks) maxWeeks = raceWeeks;
            if (s.auSettings.fantasy.acceleratedPregnancy) maxWeeks = Math.max(4, Math.round(maxWeeks / (s.auSettings.fantasy.accelerationFactor || 1)));
        }
    }
    this.pr.maxWeeks = maxWeeks;
    if (this.p.cycle) this.p.cycle.enabled = false;
};

PregManager.prototype.advanceDay = function (days) { if (!this.isActive()) return; this.pr.day += days; while (this.pr.day >= 7) { this.pr.day -= 7; this.pr.week++; } };
PregManager.prototype.trimester = function () { if (this.pr.week <= 12) return 1; if (this.pr.week <= 27) return 2; return 3; };
PregManager.prototype.size = function () { var map = [[4,"маковое зерно"],[8,"малина"],[12,"лайм"],[16,"авокадо"],[20,"банан"],[28,"баклажан"],[36,"дыня"],[40,"арбуз"]]; var r = "эмбрион"; for (var i=0;i<map.length;i++){if(this.pr.week>=map[i][0])r=map[i][1];} return r; };
PregManager.prototype.symptoms = function () { var w=this.pr.week,r=[]; if(w>=4&&w<=14)r.push("тошнота"); if(w>=14)r.push("рост живота"); if(w>=18)r.push("шевеления"); if(w>=28)r.push("одышка"); return r; };
PregManager.prototype.movements = function () { var w=this.pr.week; if(w<16)return "нет"; if(w<22)return "бабочки"; if(w<28)return "толчки"; return "активные"; };

// Add random complication
PregManager.prototype.addRandomComplication = function () {
    var available = PREG_COMPLICATIONS.filter(function (c) { return this.pr.complications.indexOf(c) === -1; }.bind(this));
    if (available.length === 0) return null;
    var comp = randomFrom(available);
    this.pr.complications.push(comp);
    return comp;
};

// Remove all complications
PregManager.prototype.clearComplications = function () { this.pr.complications = []; };

// Remove specific complication
PregManager.prototype.removeComplication = function (comp) { this.pr.complications = this.pr.complications.filter(function (c) { return c !== comp; }); };

// ========================
// LABOR MANAGER (UPDATED - complications)
// ========================
var LABOR_STAGES = ["latent","active","transition","pushing","birth","placenta"];
var LABOR_LABELS = {latent:"Латентная",active:"Активная",transition:"Переходная",pushing:"Потуги",birth:"Рождение",placenta:"Плацента"};

function LaborManager(profile) { this.p = profile; this.l = profile.labor; }
LaborManager.prototype.start = function () { this.l.active=true; this.l.stage="latent"; this.l.dilation=0; this.l.hoursElapsed=0; this.l.babiesDelivered=0; this.l.totalBabies=(this.p.pregnancy&&this.p.pregnancy.fetusCount)||1; this.l.complications=[]; };
LaborManager.prototype.advance = function () { var idx=LABOR_STAGES.indexOf(this.l.stage); if(idx>=LABOR_STAGES.length-1)return; this.l.stage=LABOR_STAGES[idx+1]; if(this.l.stage==="active"){this.l.dilation=5;this.l.hoursElapsed+=5;} if(this.l.stage==="transition"){this.l.dilation=8;this.l.hoursElapsed+=2;} if(this.l.stage==="pushing")this.l.dilation=10; };
LaborManager.prototype.description = function () { return ({latent:"Лёгкие схватки, 0-3 см",active:"Сильные схватки, 4-7 см",transition:"Пик интенсивности, 7-10 см",pushing:"Полное раскрытие, потуги",birth:"Рождение ребёнка",placenta:"Рождение плаценты"})[this.l.stage]||""; };
LaborManager.prototype.deliver = function () { this.l.babiesDelivered++; if(this.l.babiesDelivered>=this.l.totalBabies)this.l.stage="placenta"; };
LaborManager.prototype.end = function () { this.l.active=false; this.p.pregnancy.active=false; if(this.p.cycle){this.p.cycle.enabled=true;this.p.cycle.currentDay=1;} };

// Add random labor complication
LaborManager.prototype.addRandomComplication = function () {
    var available = LABOR_COMPLICATIONS.filter(function (c) { return this.l.complications.indexOf(c) === -1; }.bind(this));
    if (available.length === 0) return null;
    var comp = randomFrom(available);
    this.l.complications.push(comp);
    return comp;
};
LaborManager.prototype.clearComplications = function () { this.l.complications = []; };
LaborManager.prototype.removeComplication = function (comp) { this.l.complications = this.l.complications.filter(function (c) { return c !== comp; }); };

// ========================
// BABY MANAGER
// ========================
function BabyManager(baby) { this.b = baby; }
BabyManager.generate = function (mother, fatherName, overrides) { var s=S(); var ov=overrides||{}; var sex=ov.sex||(Math.random()<0.5?"M":"F"); var bw=3200+Math.floor(Math.random()*800)-400; return {name:ov.name||"",sex:sex,secondarySex:null,birthWeight:bw,currentWeight:bw,ageDays:ov.ageDays||0,eyeColor:ov.eyeColor||(mother?mother.eyeColor:"")||"",hairColor:ov.hairColor||(mother?mother.hairColor:"")||"",mother:(mother?mother.name:ov.mother)||"?",father:fatherName||ov.father||"?",state:"новорождённый",birthDate:JSON.parse(JSON.stringify(s.worldDate))}; };
BabyManager.prototype.age = function () { var d=this.b.ageDays; if(d<1)return "новорождённый"; if(d<30)return d+" дн."; if(d<365)return Math.floor(d/30)+" мес."; return Math.floor(d/365)+" г."; };
BabyManager.prototype.update = function () { this.b.currentWeight=this.b.birthWeight+this.b.ageDays*(this.b.ageDays<120?30:7); if(this.b.ageDays<28)this.b.state="новорождённый"; else if(this.b.ageDays<365)this.b.state="младенец"; else this.b.state="ребёнок"; };
BabyManager.prototype.milestones = function () { var d=this.b.ageDays,r=[]; if(d>=42)r.push("улыбка");if(d>=90)r.push("голову");if(d>=180)r.push("сидит");if(d>=270)r.push("ползает");if(d>=365)r.push("шаги");if(d>=450)r.push("слова"); return r; };

// ========================
// OVIPOSITION MANAGER
// ========================
var OVI_PHASES = {none:"Нет",carrying:"Вынашивание",laying:"Откладывание",incubating:"Инкубация",hatched:"Вылупление"};
function OviManager(profile) { this.p=profile; if(!profile.oviposition)profile.oviposition={active:false,phase:"none",eggCount:0,fertilizedCount:0,gestationDay:0,gestationMax:14,layingDay:0,layingMax:3,incubationDay:0,incubationMax:21,eggs:[]}; this.o=profile.oviposition; }
OviManager.prototype.startCarrying = function () { var cfg=S().auSettings.oviposition; var count=cfg.eggCountMin+Math.floor(Math.random()*(cfg.eggCountMax-cfg.eggCountMin+1)); this.o.active=true;this.o.phase="carrying";this.o.eggCount=count;this.o.gestationDay=0;this.o.gestationMax=cfg.gestationDays||14;this.o.layingMax=cfg.layingDuration||3;this.o.incubationMax=cfg.incubationDays||21;this.o.eggs=[]; for(var i=0;i<count;i++)this.o.eggs.push({fertilized:Math.random()<(cfg.fertilizationChance||0.7)}); this.o.fertilizedCount=this.o.eggs.filter(function(e){return e.fertilized;}).length; if(this.p.cycle)this.p.cycle.enabled=false; };
OviManager.prototype.advance = function (days) { if(!this.o.active)return; for(var i=0;i<days;i++){if(this.o.phase==="carrying"){this.o.gestationDay++;if(this.o.gestationDay>=this.o.gestationMax){this.o.phase="laying";this.o.layingDay=0;}} else if(this.o.phase==="laying"){this.o.layingDay++;if(this.o.layingDay>=this.o.layingMax){this.o.phase="incubating";this.o.incubationDay=0;if(this.p.cycle)this.p.cycle.enabled=true;}} else if(this.o.phase==="incubating"){this.o.incubationDay++;if(this.o.incubationDay>=this.o.incubationMax)this.o.phase="hatched";}} };
OviManager.prototype.progress = function () { if(this.o.phase==="carrying")return Math.round((this.o.gestationDay/this.o.gestationMax)*100); if(this.o.phase==="laying")return Math.round((this.o.layingDay/this.o.layingMax)*100); if(this.o.phase==="incubating")return Math.round((this.o.incubationDay/this.o.incubationMax)*100); return 100; };
OviManager.prototype.end = function () { this.o.active=false;this.o.phase="none";this.o.eggs=[];if(this.p.cycle)this.p.cycle.enabled=true; };

// ========================
// INTIMACY / DICE
// ========================
var Intimacy = {
    log: function (entry) { var s=S(); entry.ts=formatDate(s.worldDate); s.intimacyLog.push(entry); if(s.intimacyLog.length>100)s.intimacyLog=s.intimacyLog.slice(-100); saveSettingsDebounced(); },
    roll: function (targetName, data) {
        var s=S(); var p=s.characters[targetName]; if(!p||!canGetPregnant(p)) return {result:false,chance:0,roll:0,reason:"not_eligible"};
        var fertility=0.05; if(p.cycle&&p.cycle.enabled)fertility=new CycleManager(p).fertility();
        var contraEff={none:0,condom:0.85,pill:0.91,iud:0.99,withdrawal:0.73}; var ce=contraEff[p.contraception]||0;
        if(data.noCondom){} else if(data.condom){fertility*=0.15;} else {fertility*=(1-ce);}
        if(data.ejac==="outside")fertility*=0.05; if(data.type==="anal"||data.type==="oral")fertility=0; if(p.pregnancy&&p.pregnancy.active)fertility=0;
        var chance=Math.round(clamp(fertility,0,0.95)*100); var diceRoll=roll100(); var success=diceRoll<=chance;
        var entry={ts:formatDate(s.worldDate),target:targetName,parts:data.parts||[],chance:chance,roll:diceRoll,result:success,type:data.type,ejac:data.ejac,auto:data.auto||false};
        s.diceLog.push(entry); if(s.diceLog.length>50)s.diceLog=s.diceLog.slice(-50); saveSettingsDebounced(); return entry;
    }
};

// ========================
// RELATIONSHIPS
// ========================
var REL_TYPES = ["мать","отец","ребёнок","партнёр","супруг(а)","связь (бонд)","брат","сестра","друг","другое"];
var Rels = {
    get: function () { return S().relationships || []; },
    add: function (c1,c2,type,notes) { var s=S(); if(!s.relationships)s.relationships=[]; if(s.relationships.some(function(r){return r.char1===c1&&r.char2===c2&&r.type===type;})) return; s.relationships.push({id:makeId(),char1:c1,char2:c2,type:type,notes:notes||""}); saveSettingsDebounced(); },
    remove: function (id) { var s=S(); s.relationships=(s.relationships||[]).filter(function(r){return r.id!==id;}); saveSettingsDebounced(); },
    addBirth: function (mother,father,babyName) { if(mother){this.add(mother,babyName,"мать","");this.add(babyName,mother,"ребёнок","");} if(father&&father!=="?"){this.add(father,babyName,"отец","");this.add(babyName,father,"ребёнок","");} },
    toPrompt: function () { var r=this.get(); if(!r.length)return ""; return "Relationships:\n"+r.map(function(x){return x.char1+" > "+x.char2+": "+x.type;}).join("\n"); }
};

// ========================
// PROFILES
// ========================
var Profiles = {
    id: function () { var ctx=getContext(); if(!ctx)return null; if(ctx.groupId)return "g_"+ctx.groupId; if(ctx.characterId!==undefined&&ctx.characters){var ch=ctx.characters[ctx.characterId];if(ch)return "c_"+ch.avatar+"_"+(ctx.chatId||"0");} return null; },
    save: function () { var s=S(); var cid=this.id(); if(!cid)return; s.currentChatId=cid; if(!s.chatProfiles)s.chatProfiles={}; s.chatProfiles[cid]={characters:JSON.parse(JSON.stringify(s.characters)),relationships:JSON.parse(JSON.stringify(s.relationships||[])),worldDate:JSON.parse(JSON.stringify(s.worldDate)),diceLog:JSON.parse(JSON.stringify(s.diceLog||[])),intimacyLog:JSON.parse(JSON.stringify(s.intimacyLog||[]))}; saveSettingsDebounced(); },
    load: function () { var s=S(); var cid=this.id(); if(!cid||s.currentChatId===cid)return false; if(s.currentChatId&&Object.keys(s.characters).length>0){if(!s.chatProfiles)s.chatProfiles={};s.chatProfiles[s.currentChatId]={characters:JSON.parse(JSON.stringify(s.characters)),relationships:JSON.parse(JSON.stringify(s.relationships||[])),worldDate:JSON.parse(JSON.stringify(s.worldDate)),diceLog:JSON.parse(JSON.stringify(s.diceLog||[])),intimacyLog:JSON.parse(JSON.stringify(s.intimacyLog||[]))};} s.currentChatId=cid; if(s.chatProfiles&&s.chatProfiles[cid]){var pr=s.chatProfiles[cid];s.characters=JSON.parse(JSON.stringify(pr.characters||{}));s.relationships=JSON.parse(JSON.stringify(pr.relationships||[]));s.worldDate=JSON.parse(JSON.stringify(pr.worldDate||DEFAULTS.worldDate));s.diceLog=JSON.parse(JSON.stringify(pr.diceLog||[]));s.intimacyLog=JSON.parse(JSON.stringify(pr.intimacyLog||[]));}else{s.characters={};s.relationships=[];s.diceLog=[];s.intimacyLog=[];} saveSettingsDebounced();return true; },
    list: function () { var s=S(); var p=s.chatProfiles||{}; return Object.keys(p).map(function(id){var pr=p[id];return {id:id,count:Object.keys(pr.characters||{}).length,date:pr.worldDate?formatDate(pr.worldDate):"-",isCurrent:id===s.currentChatId};}); },
    del: function (id) { var s=S(); if(s.chatProfiles&&s.chatProfiles[id]){delete s.chatProfiles[id];saveSettingsDebounced();} }
};

// ========================
// PROMPT INJECTION
// ========================
var Prompt = {
    generate: function () {
        var s=S(); if(!s.promptInjectionEnabled)return ""; var lines=["[BunnyCycle]","Date: "+formatDate(s.worldDate)]; var relText=Rels.toPrompt(); if(relText)lines.push(relText);
        var charNames=Object.keys(s.characters);
        for(var i=0;i<charNames.length;i++){var name=charNames[i];var p=s.characters[name];if(!p._enabled)continue; lines.push("--- "+name+" ---"); lines.push("Sex: "+p.bioSex+(p.secondarySex?"/"+p.secondarySex:""));
        if(s.modules.cycle&&p.cycle&&p.cycle.enabled&&!(p.pregnancy&&p.pregnancy.active)){var cm=new CycleManager(p);lines.push("Cycle D"+p.cycle.currentDay+"/"+p.cycle.length+" "+cm.label(cm.phase())+" Fert:"+Math.round(cm.fertility()*100)+"%");}
        if(s.modules.pregnancy&&p.pregnancy&&p.pregnancy.active){var pm=new PregManager(p);lines.push("PREGNANT W"+p.pregnancy.week+"/"+p.pregnancy.maxWeeks+" "+pm.size()+" fetuses:"+p.pregnancy.fetusCount+(p.pregnancy.complications.length>0?" COMPLICATIONS:"+p.pregnancy.complications.join(","):""));}
        if(s.modules.labor&&p.labor&&p.labor.active){lines.push("LABOR: "+LABOR_LABELS[p.labor.stage]+(p.labor.complications.length>0?" COMPLICATIONS:"+p.labor.complications.join(","):""));}
        if(p.heat&&p.heat.active)lines.push("IN HEAT D"+p.heat.currentDay+"/"+p.heat.duration);
        if(p.rut&&p.rut.active)lines.push("IN RUT D"+p.rut.currentDay+"/"+p.rut.duration);
        if(p.bond&&p.bond.bonded)lines.push("BONDED to "+p.bond.partner);
        if(s.modules.baby&&p.babies&&p.babies.length>0){for(var j=0;j<p.babies.length;j++){var b=p.babies[j];lines.push("Child: "+(b.name||"?")+" "+new BabyManager(b).age());}}
        } lines.push("[/BunnyCycle]"); return lines.join("\n");
    }
};

// ========================
// TIME PARSER
// ========================
var TimeParse = {
    parse: function (msg) { if(!msg)return null; var days=0; var patterns=[[/прошл[оа]\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/через\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/спустя\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/прошл[оа]\s+(\d+)\s+(?:недел|нед)/gi,7],[/через\s+(\d+)\s+(?:недел|нед)/gi,7],[/прошл[оа]\s+(\d+)\s+(?:месяц|мес)/gi,30],[/(\d+)\s+days?\s+(?:later|passed)/gi,1],[/(\d+)\s+weeks?\s+later/gi,7],[/(\d+)\s+months?\s+later/gi,30]]; for(var i=0;i<patterns.length;i++){var re=patterns[i][0];var mult=patterns[i][1];var match;while((match=re.exec(msg))!==null)days+=parseInt(match[1])*mult;} if(/на следующ\w+\s+(?:день|утро)|next\s+day/i.test(msg))days+=1; return days>0?{days:days}:null; },
    apply: function (parsed) { var s=S(); if(parsed.days>0){s.worldDate=addDaysToDate(s.worldDate,parsed.days);this.advanceAll(parsed.days);} saveSettingsDebounced();Profiles.save(); },
    advanceAll: function (days) { var s=S(); var charNames=Object.keys(s.characters); for(var i=0;i<charNames.length;i++){var p=s.characters[charNames[i]];if(!p._enabled)continue; if(s.modules.cycle&&p.cycle&&p.cycle.enabled&&!(p.pregnancy&&p.pregnancy.active))new CycleManager(p).advance(days); if(s.modules.pregnancy&&p.pregnancy&&p.pregnancy.active)new PregManager(p).advanceDay(days); if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.secondarySex){var hr=new HeatRutManager(p);if(p.secondarySex==="omega")hr.advanceHeat(days);if(p.secondarySex==="alpha")hr.advanceRut(days);} if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.bond)new BondManager(p).advance(days); if(s.auSettings.oviposition&&s.auSettings.oviposition.enabled&&p.oviposition&&p.oviposition.active)new OviManager(p).advance(days); if(s.modules.baby&&p.babies&&p.babies.length>0){for(var j=0;j<p.babies.length;j++){p.babies[j].ageDays+=days;new BabyManager(p.babies[j]).update();}}} }
};

// ========================
// PROFILE FACTORY
// ========================
function makeProfile(name, isUser, sex) {
    var isMale = (sex||"F")==="M";
    return {name:name,bioSex:sex||"F",secondarySex:null,race:"human",contraception:"none",eyeColor:"",hairColor:"",pregnancyDifficulty:"normal",_isUser:isUser,_enabled:true,_canLayEggs:false,_mB:false,_mS:false,_mR:false,_mE:false,_mH:false,_mP:false,_mCyc:false,_sexSource:"",_sexConfidence:0,
    cycle:{enabled:!isMale,currentDay:Math.floor(Math.random()*28)+1,baseLength:28,length:28,menstruationDuration:5,irregularity:2,symptomIntensity:"moderate",cycleCount:0},
    pregnancy:{active:false,week:0,day:0,maxWeeks:40,father:null,fetusCount:1,fetusSexes:[],complications:[],weightGain:0},
    labor:{active:false,stage:"latent",dilation:0,hoursElapsed:0,babiesDelivered:0,totalBabies:1,complications:[]},
    heat:{active:false,currentDay:0,cycleDays:30,duration:5,intensity:"moderate",daysSinceLast:Math.floor(Math.random()*25),onSuppressants:false},
    rut:{active:false,currentDay:0,cycleDays:35,duration:4,intensity:"moderate",daysSinceLast:Math.floor(Math.random()*30)},
    bond:{bonded:false,partner:null,type:null,strength:0,daysSinceSeparation:0,withdrawalActive:false,markLocation:""},
    oviposition:null, babies:[]};
}

// ========================
// GET ACTIVE CHARACTERS
// ========================
function getActiveChars() { var ctx=getContext();var result=[];if(!ctx)return result; if(ctx.characterId!==undefined&&ctx.characters){var ch=ctx.characters[ctx.characterId];if(ch)result.push({name:ch.name,obj:ch,isUser:false});} if(ctx.groups&&ctx.groupId){var group=ctx.groups.find(function(g){return g.id===ctx.groupId;});if(group&&group.members){for(var i=0;i<group.members.length;i++){var avatar=group.members[i];var found=ctx.characters.find(function(c){return c.avatar===avatar;});if(found&&!result.some(function(r){return r.name===found.name;}))result.push({name:found.name,obj:found,isUser:false});}}} if(ctx.name1)result.push({name:ctx.name1,obj:null,isUser:true}); return result; }

// ========================
// SYNC
// ========================
var syncLock = false;
async function syncChars() {
    var s=S(); if(!s.autoSyncCharacters||syncLock)return; syncLock=true;
    try {
        var active=getActiveChars(); var changed=false;
        for(var i=0;i<active.length;i++){if(!s.characters[active[i].name]){s.characters[active[i].name]=makeProfile(active[i].name,active[i].isUser,"F");changed=true;}}
        var allNames=Object.keys(s.characters); for(var bn=0;bn<allNames.length;bn++){if(!s.characters[allNames[bn]].bond)s.characters[allNames[bn]].bond={bonded:false,partner:null,type:null,strength:0,daysSinceSeparation:0,withdrawalActive:false,markLocation:""}; if(!s.characters[allNames[bn]].labor.complications)s.characters[allNames[bn]].labor.complications=[];}
        if(s.autoParseCharInfo&&s.useLLMParsing){for(var j=0;j<active.length;j++){var ch=active[j];var pr=s.characters[ch.name];if(pr._mB&&pr._mE&&pr._mH)continue;var analysis=await CharAnalyzer.analyze(ch.name,ch.obj,ch.isUser);if(analysis){if(analysis.biologicalSex&&!pr._mB){pr.bioSex=analysis.biologicalSex;pr._sexSource="llm";pr._sexConfidence=analysis.sexConfidence||90;if(analysis.biologicalSex==="M"&&!pr._mCyc)pr.cycle.enabled=false;if(analysis.biologicalSex==="F"&&!pr._mCyc)pr.cycle.enabled=true;changed=true;}if(analysis.secondarySex&&!pr._mS){pr.secondarySex=analysis.secondarySex;changed=true;}if(analysis.race&&!pr._mR){pr.race=analysis.race;changed=true;}if(analysis.eyeColor&&!pr._mE){pr.eyeColor=analysis.eyeColor;changed=true;}if(analysis.hairColor&&!pr._mH){pr.hairColor=analysis.hairColor;changed=true;}}}}
        if(changed)saveSettingsDebounced();
    } finally { syncLock=false; }
}

// ========================
// HELPER: charOptions / relTypeOptions
// ========================
function charOptions() { var names=Object.keys(S().characters); var h=""; for(var i=0;i<names.length;i++) h+='<option value="'+names[i]+'">'+names[i]+'</option>'; return h; }
function relTypeOptions() { var h=""; for(var i=0;i<REL_TYPES.length;i++) h+='<option value="'+REL_TYPES[i]+'">'+REL_TYPES[i]+'</option>'; return h; }

// ========================
// RENDER PREGNANCY (FULL with manual setup + complications)
// ========================
function renderPregnancy() {
    var s = S();
    var el = document.getElementById("lc-preg-panel");
    var sel = document.getElementById("lc-preg-char");
    if (!el || !sel) return;
    var p = s.characters[sel.value];
    if (!p) { el.innerHTML = '<div class="lc-empty">Выберите персонажа</div>'; return; }

    var html = "";

    if (!p.pregnancy || !p.pregnancy.active) {
        // === NO ACTIVE PREGNANCY: Show manual start form ===
        html += '<div class="lc-section">';
        html += '<h4>\u2795 Начать беременность вручную</h4>';
        html += '<div class="lc-editor-grid">';
        // Father
        html += '<div class="lc-editor-field"><label>Отец</label><select class="lc-select lc-char-select" id="lc-preg-father">' + charOptions() + '</select></div>';
        // Start week
        html += '<div class="lc-editor-field"><label>Начальная неделя</label><input type="number" class="lc-input" id="lc-preg-startweek" min="1" max="42" value="1"></div>';
        // Fetus count
        html += '<div class="lc-editor-field"><label>Кол-во плодов</label><input type="number" class="lc-input" id="lc-preg-fcount" min="1" max="8" value="1"></div>';
        html += '</div>';

        // Fetus sexes
        html += '<div id="lc-preg-sexes-area" style="margin-top:6px">';
        html += '<label style="font-size:10px;color:#7a7272;text-transform:uppercase">Пол плодов</label>';
        html += '<div id="lc-preg-sexes-list"></div>';
        html += '</div>';

        html += '<div class="lc-btn-group" style="margin-top:8px">';
        html += '<button class="lc-btn lc-btn-primary" id="lc-preg-start-manual">\uD83E\uDD30 Начать беременность</button>';
        html += '</div>';
        html += '</div>';
    } else {
        // === ACTIVE PREGNANCY: Show info + controls ===
        var pm = new PregManager(p);
        var pr = p.pregnancy;
        var progress = Math.round((pr.week / pr.maxWeeks) * 100);

        html += '<div class="lc-preg-header">';
        html += '<span class="lc-preg-week">Неделя ' + pr.week + ' / ' + pr.maxWeeks + '</span>';
        html += '<span class="lc-preg-trim">Триместр ' + pm.trimester() + '</span>';
        html += '</div>';
        html += '<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:' + progress + '%"></div></div>';

        // Fetus info
        html += '<div class="lc-info-row">Размер: ' + pm.size() + ' | Движения: ' + pm.movements() + '</div>';
        html += '<div class="lc-info-row">Отец: ' + (pr.father || "?") + '</div>';
        html += '<div class="lc-info-row">Плодов: <strong>' + pr.fetusCount + '</strong> | Пол: ';
        for (var fi = 0; fi < pr.fetusSexes.length; fi++) {
            html += (pr.fetusSexes[fi] === "M" ? "\u2642" : "\u2640");
            if (fi < pr.fetusSexes.length - 1) html += ", ";
        }
        html += '</div>';

        // Symptoms
        var sym = pm.symptoms();
        if (sym.length > 0) html += '<div class="lc-info-row">Симптомы: ' + sym.join(", ") + '</div>';

        // === COMPLICATIONS SECTION ===
        html += '<div class="lc-section" style="margin-top:8px">';
        html += '<h4>\u26A0\uFE0F Осложнения беременности</h4>';
        if (pr.complications.length > 0) {
            for (var ci = 0; ci < pr.complications.length; ci++) {
                html += '<div class="lc-dice-entry" style="display:flex;justify-content:space-between;align-items:center">';
                html += '<span>' + pr.complications[ci] + '</span>';
                html += '<button class="lc-btn lc-btn-sm lc-btn-danger lc-preg-rm-comp" data-comp="' + pr.complications[ci] + '">\u2715</button>';
                html += '</div>';
            }
        } else {
            html += '<div class="lc-empty">Нет осложнений</div>';
        }
        html += '<div class="lc-btn-group" style="margin-top:4px">';
        html += '<button class="lc-btn lc-btn-sm" id="lc-preg-rand-comp">\uD83C\uDFB2 Рандом осложнение</button>';
        html += '<button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-preg-clear-comp">\uD83E\uDDF9 Убрать все</button>';
        html += '</div>';
        html += '</div>';

        // === MANUAL EDIT SECTION ===
        html += '<div class="lc-section" style="margin-top:8px">';
        html += '<h4>\u270F\uFE0F Ручная настройка</h4>';
        html += '<div class="lc-editor-grid">';
        html += '<div class="lc-editor-field"><label>Неделя</label><div class="lc-row"><input type="number" class="lc-input" id="lc-preg-setweek" min="1" max="' + pr.maxWeeks + '" value="' + pr.week + '" style="width:60px"><button class="lc-btn lc-btn-sm" id="lc-preg-applyweek">OK</button></div></div>';
        html += '<div class="lc-editor-field"><label>Кол-во плодов</label><div class="lc-row"><input type="number" class="lc-input" id="lc-preg-editcount" min="1" max="8" value="' + pr.fetusCount + '" style="width:60px"><button class="lc-btn lc-btn-sm" id="lc-preg-applycount">OK</button></div></div>';
        html += '<div class="lc-editor-field"><label>Отец</label><div class="lc-row"><select class="lc-select lc-char-select" id="lc-preg-editfather">' + charOptions() + '</select><button class="lc-btn lc-btn-sm" id="lc-preg-applyfather">OK</button></div></div>';
        html += '</div>';

        // Edit fetus sexes
        html += '<div style="margin-top:6px"><label style="font-size:10px;color:#7a7272;text-transform:uppercase">Пол плодов (изменить)</label>';
        html += '<div class="lc-row" id="lc-preg-edit-sexes">';
        for (var si = 0; si < pr.fetusSexes.length; si++) {
            html += '<select class="lc-select lc-preg-sex-sel" data-idx="' + si + '" style="width:55px">';
            html += '<option value="M"' + (pr.fetusSexes[si] === "M" ? " selected" : "") + '>\u2642</option>';
            html += '<option value="F"' + (pr.fetusSexes[si] === "F" ? " selected" : "") + '>\u2640</option>';
            html += '</select>';
        }
        html += '<button class="lc-btn lc-btn-sm" id="lc-preg-applysexes">\u2713</button>';
        html += '</div></div>';
        html += '</div>';

        // === ACTION BUTTONS ===
        html += '<div class="lc-btn-group" style="margin-top:8px">';
        html += '<button class="lc-btn lc-btn-sm" id="lc-preg-adv">+1 нед</button>';
        html += '<button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-preg-labor">\u2192 Роды</button>';
        html += '<button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-preg-end">Прервать</button>';
        html += '</div>';
    }

    el.innerHTML = html;
    bindPregnancyButtons(p, sel.value);
}

// Render fetus sex selectors for new pregnancy form
function renderFetusSexSelectors() {
    var countInput = document.getElementById("lc-preg-fcount");
    var area = document.getElementById("lc-preg-sexes-list");
    if (!countInput || !area) return;
    var count = parseInt(countInput.value) || 1;
    var html = '<div class="lc-row">';
    for (var i = 0; i < count; i++) {
        html += '<select class="lc-select lc-new-fetus-sex" data-idx="' + i + '" style="width:65px">';
        html += '<option value="random">\uD83C\uDFB2</option>';
        html += '<option value="M">\u2642 М</option>';
        html += '<option value="F">\u2640 Ж</option>';
        html += '</select>';
    }
    html += '</div>';
    area.innerHTML = html;
}

// ========================
// RENDER LABOR (FULL with complications)
// ========================
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
    html += '<div class="lc-info-row">Родилось: ' + p.labor.babiesDelivered + ' / ' + p.labor.totalBabies + '</div>';

    // === LABOR COMPLICATIONS ===
    html += '<div class="lc-section" style="margin-top:8px">';
    html += '<h4>\u26A0\uFE0F Осложнения родов</h4>';
    if (p.labor.complications && p.labor.complications.length > 0) {
        for (var ci = 0; ci < p.labor.complications.length; ci++) {
            html += '<div class="lc-dice-entry" style="display:flex;justify-content:space-between;align-items:center">';
            html += '<span>' + p.labor.complications[ci] + '</span>';
            html += '<button class="lc-btn lc-btn-sm lc-btn-danger lc-labor-rm-comp" data-comp="' + p.labor.complications[ci] + '">\u2715</button>';
            html += '</div>';
        }
    } else {
        html += '<div class="lc-empty">Нет осложнений</div>';
    }
    html += '<div class="lc-btn-group" style="margin-top:4px">';
    html += '<button class="lc-btn lc-btn-sm" id="lc-labor-rand-comp">\uD83C\uDFB2 Рандом осложнение</button>';
    html += '<button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-labor-clear-comp">\uD83E\uDDF9 Убрать все</button>';
    html += '</div>';
    html += '</div>';

    // === ACTION BUTTONS ===
    html += '<div class="lc-btn-group" style="margin-top:8px">';
    html += '<button class="lc-btn lc-btn-sm" id="lc-labor-adv">\u2192 Стадия</button>';
    html += '<button class="lc-btn lc-btn-sm lc-btn-success" id="lc-labor-deliver">\uD83D\uDC76 Родить</button>';
    html += '<button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-labor-end">Завершить</button>';
    html += '</div>';

    el.innerHTML = html;
    bindLaborButtons(p, sel.value);
}

// ========================
// BIND PREGNANCY BUTTONS
// ========================
function bindPregnancyButtons(p, charName) {
    var s = S();

    // New pregnancy form
    var fcountInput = document.getElementById("lc-preg-fcount");
    if (fcountInput) {
        renderFetusSexSelectors();
        fcountInput.addEventListener("change", renderFetusSexSelectors);
    }

    var startBtn = document.getElementById("lc-preg-start-manual");
    if (startBtn) startBtn.addEventListener("click", function () {
        var father = document.getElementById("lc-preg-father");
        var weekInput = document.getElementById("lc-preg-startweek");
        var countInput2 = document.getElementById("lc-preg-fcount");
        var fatherVal = father ? father.value : "?";
        var week = weekInput ? parseInt(weekInput.value) || 1 : 1;
        var count = countInput2 ? parseInt(countInput2.value) || 1 : 1;

        // Collect sexes
        var sexSelects = document.querySelectorAll(".lc-new-fetus-sex");
        var sexes = [];
        for (var i = 0; i < sexSelects.length; i++) {
            var val = sexSelects[i].value;
            if (val === "random") sexes.push(Math.random() < 0.5 ? "M" : "F");
            else sexes.push(val);
        }
        while (sexes.length < count) sexes.push(Math.random() < 0.5 ? "M" : "F");

        new PregManager(p).start(fatherVal, count, sexes, week);
        saveSettingsDebounced();
        rebuild();
        toastr.success("\uD83E\uDD30 Беременность установлена!");
    });

    // Active pregnancy buttons
    var advBtn = document.getElementById("lc-preg-adv");
    if (advBtn) advBtn.addEventListener("click", function () { new PregManager(p).advanceDay(7); saveSettingsDebounced(); renderPregnancy(); renderDashboard(); });

    var laborBtn = document.getElementById("lc-preg-labor");
    if (laborBtn) laborBtn.addEventListener("click", function () { new LaborManager(p).start(); saveSettingsDebounced(); rebuild(); });

    var endBtn = document.getElementById("lc-preg-end");
    if (endBtn) endBtn.addEventListener("click", function () { if (!confirm("Прервать беременность?")) return; p.pregnancy.active = false; if (p.cycle) p.cycle.enabled = true; saveSettingsDebounced(); rebuild(); });

    // Set week
    var applyWeek = document.getElementById("lc-preg-applyweek");
    if (applyWeek) applyWeek.addEventListener("click", function () { var inp = document.getElementById("lc-preg-setweek"); if (inp) { p.pregnancy.week = clamp(parseInt(inp.value)||1, 1, p.pregnancy.maxWeeks); saveSettingsDebounced(); renderPregnancy(); } });

    // Set count
    var applyCount = document.getElementById("lc-preg-applycount");
    if (applyCount) applyCount.addEventListener("click", function () {
        var inp = document.getElementById("lc-preg-editcount");
        if (inp) {
            var newCount = clamp(parseInt(inp.value)||1, 1, 8);
            p.pregnancy.fetusCount = newCount;
            while (p.pregnancy.fetusSexes.length < newCount) p.pregnancy.fetusSexes.push(Math.random() < 0.5 ? "M" : "F");
            p.pregnancy.fetusSexes = p.pregnancy.fetusSexes.slice(0, newCount);
            saveSettingsDebounced(); renderPregnancy();
        }
    });

    // Set father
    var applyFather = document.getElementById("lc-preg-applyfather");
    if (applyFather) applyFather.addEventListener("click", function () { var sel2 = document.getElementById("lc-preg-editfather"); if (sel2) { p.pregnancy.father = sel2.value; saveSettingsDebounced(); renderPregnancy(); } });

    // Apply sexes
    var applySexes = document.getElementById("lc-preg-applysexes");
    if (applySexes) applySexes.addEventListener("click", function () {
        var selects = document.querySelectorAll(".lc-preg-sex-sel");
        for (var i = 0; i < selects.length; i++) {
            var idx = parseInt(selects[i].dataset.idx);
            if (idx >= 0 && idx < p.pregnancy.fetusSexes.length) p.pregnancy.fetusSexes[idx] = selects[i].value;
        }
        saveSettingsDebounced(); renderPregnancy();
        toastr.success("Пол плодов обновлён!");
    });

    // Complications
    var randComp = document.getElementById("lc-preg-rand-comp");
    if (randComp) randComp.addEventListener("click", function () {
        var comp = new PregManager(p).addRandomComplication();
        if (comp) { saveSettingsDebounced(); renderPregnancy(); toastr.info("\u26A0\uFE0F " + comp); }
        else toastr.warning("Все осложнения уже добавлены!");
    });

    var clearComp = document.getElementById("lc-preg-clear-comp");
    if (clearComp) clearComp.addEventListener("click", function () {
        new PregManager(p).clearComplications();
        saveSettingsDebounced(); renderPregnancy();
        toastr.success("Осложнения убраны!");
    });

    // Remove individual complications
    var rmBtns = document.querySelectorAll(".lc-preg-rm-comp");
    for (var ri = 0; ri < rmBtns.length; ri++) {
        rmBtns[ri].addEventListener("click", function () {
            new PregManager(p).removeComplication(this.dataset.comp);
            saveSettingsDebounced(); renderPregnancy();
        });
    }
}

// ========================
// BIND LABOR BUTTONS
// ========================
function bindLaborButtons(p, charName) {
    var advBtn = document.getElementById("lc-labor-adv");
    if (advBtn) advBtn.addEventListener("click", function () { new LaborManager(p).advance(); saveSettingsDebounced(); renderLabor(); });

    var deliverBtn = document.getElementById("lc-labor-deliver");
    if (deliverBtn) deliverBtn.addEventListener("click", function () {
        showBabyForm(charName, (p.pregnancy && p.pregnancy.father) || "?");
    });

    var endBtn = document.getElementById("lc-labor-end");
    if (endBtn) endBtn.addEventListener("click", function () { if (!confirm("Завершить роды?")) return; new LaborManager(p).end(); saveSettingsDebounced(); rebuild(); });

    // Labor complications
    var randComp = document.getElementById("lc-labor-rand-comp");
    if (randComp) randComp.addEventListener("click", function () {
        var comp = new LaborManager(p).addRandomComplication();
        if (comp) { saveSettingsDebounced(); renderLabor(); toastr.info("\u26A0\uFE0F " + comp); }
        else toastr.warning("Все осложнения уже добавлены!");
    });

    var clearComp = document.getElementById("lc-labor-clear-comp");
    if (clearComp) clearComp.addEventListener("click", function () {
        new LaborManager(p).clearComplications();
        saveSettingsDebounced(); renderLabor();
        toastr.success("Осложнения убраны!");
    });

    var rmBtns = document.querySelectorAll(".lc-labor-rm-comp");
    for (var ri = 0; ri < rmBtns.length; ri++) {
        rmBtns[ri].addEventListener("click", function () {
            new LaborManager(p).removeComplication(this.dataset.comp);
            saveSettingsDebounced(); renderLabor();
        });
    }
}

// ========================
// OTHER RENDER FUNCTIONS (compact)
// ========================
function renderDashboard() {
    var s=S();var dateEl=document.getElementById("lc-dash-date");var itemsEl=document.getElementById("lc-dash-items");if(!dateEl||!itemsEl)return;
    dateEl.textContent="\uD83D\uDCC5 "+formatDate(s.worldDate)+(s.worldDate.frozen?" \u2744\uFE0F":"");
    var html="";var names=Object.keys(s.characters);
    for(var i=0;i<names.length;i++){var n=names[i];var p=s.characters[n];if(!p._enabled)continue;var tags=[];
    if(s.modules.cycle&&p.cycle&&p.cycle.enabled&&!(p.pregnancy&&p.pregnancy.active)){var cm=new CycleManager(p);tags.push(cm.emoji(cm.phase())+cm.label(cm.phase()));}
    if(s.modules.pregnancy&&p.pregnancy&&p.pregnancy.active){var wk=p.pregnancy.week+"н";if(p.pregnancy.complications.length>0)wk+="\u26A0";tags.push("\uD83E\uDD30"+wk);}
    if(p.labor&&p.labor.active){var lt="\uD83C\uDFE5";if(p.labor.complications&&p.labor.complications.length>0)lt+="\u26A0";tags.push(lt);}
    if(p.heat&&p.heat.active)tags.push("\uD83D\uDD25");if(p.rut&&p.rut.active)tags.push("\uD83D\uDCA2");
    if(p.bond&&p.bond.bonded)tags.push("\uD83D\uDC9E");if(p.oviposition&&p.oviposition.active)tags.push("\uD83E\uDD5A");
    if(p.babies&&p.babies.length>0)tags.push("\uD83D\uDC76\u00D7"+p.babies.length);
    if(tags.length>0)html+='<div class="lc-dash-item"><span class="lc-dash-name">'+n+'</span> '+tags.join(" ")+'</div>';}
    itemsEl.innerHTML=html||'<div class="lc-dash-empty">Нет данных</div>';
}

function renderCharList() {
    var s=S();var el=document.getElementById("lc-char-list");if(!el)return;var html="";var names=Object.keys(s.characters);
    for(var i=0;i<names.length;i++){var n=names[i];var p=s.characters[n];var sx=p.bioSex==="F"?"\u2640":"\u2642";
    html+='<div class="lc-char-card"><div class="lc-char-card-header"><span class="lc-char-card-name">'+sx+' '+n+(p.secondarySex?' '+p.secondarySex:'')+'</span>';
    if(p._sexSource)html+=' <span class="lc-tag lc-tag-auto">'+p._sexSource+'</span>';
    html+='</div><div class="lc-char-card-actions"><button class="lc-btn lc-btn-sm lc-edit-char" data-char="'+n+'">\u270F\uFE0F</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-del-char" data-char="'+n+'">\u2715</button></div></div>';}
    el.innerHTML=html||'<div class="lc-empty">Нажмите Синхр.</div>';
}

function renderCycle() {
    var s=S();var el=document.getElementById("lc-cyc-panel");var sel=document.getElementById("lc-cyc-char");if(!el||!sel)return;
    var p=s.characters[sel.value];if(!p||!p.cycle||!p.cycle.enabled||(p.pregnancy&&p.pregnancy.active)){el.innerHTML='<div class="lc-empty">Цикл отключён</div>';return;}
    var cm=new CycleManager(p);var phase=cm.phase();var fert=cm.fertility();var fc=fert>=0.2?"peak":fert>=0.1?"high":fert>=0.05?"med":"low";
    var html='<div class="lc-cycle-calendar">';
    for(var d=1;d<=p.cycle.length;d++){var ovDay=Math.round(p.cycle.length-14);var cls=d<=p.cycle.menstruationDuration?"mens":d<ovDay-2?"foll":d<=ovDay+1?"ovul":"lut";html+='<div class="lc-cal-day '+cls+(d===p.cycle.currentDay?' today':'')+'">'+d+'</div>';}
    html+='</div>';
    html+='<div class="lc-info-row">'+cm.emoji(phase)+' '+cm.label(phase)+' | <span class="lc-fert-badge '+fc+'">'+Math.round(fert*100)+'%</span> | Либидо: '+cm.libido()+'</div>';
    html+='<div class="lc-row" style="margin-top:6px"><input type="number" class="lc-input" id="lc-cyc-day" min="1" max="'+p.cycle.length+'" value="'+p.cycle.currentDay+'" style="width:50px"><button class="lc-btn lc-btn-sm" id="lc-cyc-setday">Уст.</button>';
    html+='<button class="lc-btn lc-btn-sm" id="lc-cyc-mens">М</button><button class="lc-btn lc-btn-sm" id="lc-cyc-ovul">О</button><button class="lc-btn lc-btn-sm" id="lc-cyc-skip">\u23ED</button></div>';
    el.innerHTML=html;
}

function renderHeatRut() {
    var s=S();var el=document.getElementById("lc-hr-panel");var sel=document.getElementById("lc-hr-char");if(!el||!sel)return;
    var p=s.characters[sel.value];if(!p||!s.modules.auOverlay||s.auPreset!=="omegaverse"||!p.secondarySex){el.innerHTML='<div class="lc-empty">AU не активен</div>';return;}
    var hr=new HeatRutManager(p);var html="";
    if(p.secondarySex==="omega"){var hPh=hr.heatPhase();html+='<div class="lc-section"><h4>\uD83D\uDD25 '+hr.heatLabel(hPh)+'</h4>';if(!p.heat.active)html+='<div class="lc-info-row">До течки: '+hr.heatDaysLeft()+' дн.</div>';html+='<div class="lc-btn-group"><button class="lc-btn lc-btn-sm" id="lc-hr-th">\uD83D\uDD25</button><button class="lc-btn lc-btn-sm" id="lc-hr-sh">\u23F9</button><button class="lc-btn lc-btn-sm" id="lc-hr-su">\uD83D\uDC8A</button></div></div>';}
    if(p.secondarySex==="alpha"){var rPh=hr.rutPhase();html+='<div class="lc-section"><h4>\uD83D\uDCA2 '+hr.rutLabel(rPh)+'</h4>';if(!p.rut.active)html+='<div class="lc-info-row">До гона: '+hr.rutDaysLeft()+' дн.</div>';html+='<div class="lc-btn-group"><button class="lc-btn lc-btn-sm" id="lc-hr-tr">\uD83D\uDCA2</button><button class="lc-btn lc-btn-sm" id="lc-hr-sr">\u23F9</button></div></div>';}
    el.innerHTML=html;bindHeatRutButtons(p);
}

function renderBabies() {
    var s=S();var el=document.getElementById("lc-baby-list");var sel=document.getElementById("lc-baby-par");if(!el||!sel)return;
    var p=s.characters[sel.value];if(!p||!p.babies||p.babies.length===0){el.innerHTML='<div class="lc-empty">Нет детей</div>';return;}
    var html="";for(var i=0;i<p.babies.length;i++){var b=p.babies[i];var bm=new BabyManager(b);html+='<div class="lc-baby-card"><div class="lc-baby-header"><span class="lc-baby-name">'+(b.sex==="M"?"\u2642":"\u2640")+' '+(b.name||"?")+' '+bm.age()+'</span></div><div class="lc-baby-details">Мать: '+b.mother+' | Отец: '+b.father+'</div><div class="lc-baby-actions"><button class="lc-btn lc-btn-sm lc-baby-edit" data-p="'+sel.value+'" data-i="'+i+'">\u270F\uFE0F</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-baby-del" data-p="'+sel.value+'" data-i="'+i+'">\u2715</button></div></div>';}
    el.innerHTML=html;
}

function renderOvi() {
    var s=S();var el=document.getElementById("lc-ovi-panel");var sel=document.getElementById("lc-ovi-char");if(!el||!sel)return;
    var p=s.characters[sel.value];if(!p||!p.oviposition||!p.oviposition.active){el.innerHTML='<div class="lc-empty">Нет кладки</div>';return;}
    var om=new OviManager(p);var prog=om.progress();
    el.innerHTML='<div class="lc-ovi-phase">'+(OVI_PHASES[p.oviposition.phase]||"")+'</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill ovi" style="width:'+prog+'%"></div></div><div class="lc-info-row">Яиц: '+p.oviposition.eggCount+' (оплод.: '+p.oviposition.fertilizedCount+')</div>';
}

function renderRelations() {
    var el=document.getElementById("lc-rel-list");if(!el)return;var rels=S().relationships||[];
    if(!rels.length){el.innerHTML='<div class="lc-empty">Нет связей</div>';return;}
    var html="";for(var i=0;i<rels.length;i++){var r=rels[i];html+='<div class="lc-dice-entry">'+r.char1+' \u2192 '+r.char2+': <strong>'+r.type+'</strong> <button class="lc-btn lc-btn-sm lc-btn-danger lc-del-rel" data-id="'+r.id+'">\u2715</button></div>';}
    el.innerHTML=html;var btns=el.querySelectorAll(".lc-del-rel");for(var j=0;j<btns.length;j++)btns[j].addEventListener("click",function(){Rels.remove(this.dataset.id);renderRelations();});
}

function renderProfiles() {
    var s=S();var el=document.getElementById("lc-prof-list");if(!el)return;var list=Profiles.list();
    if(!list.length){el.innerHTML='<div class="lc-empty">Нет профилей</div>';return;}
    var html="";for(var i=0;i<list.length;i++){var p=list[i];html+='<div class="lc-profile-card'+(p.isCurrent?' current':'')+'"><span>'+p.id.substring(0,20)+' ('+p.count+')</span><div class="lc-btn-group"><button class="lc-btn lc-btn-sm lc-prof-load" data-id="'+p.id+'">\uD83D\uDCC2</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-prof-del" data-id="'+p.id+'">\u2715</button></div></div>';}
    el.innerHTML=html;
}

function renderDiceLog() { var el=document.getElementById("lc-dice-log");if(!el)return;var logs=S().diceLog;if(!logs||!logs.length){el.innerHTML='<div class="lc-empty">Нет бросков</div>';return;} var html="";var items=logs.slice().reverse().slice(0,15);for(var i=0;i<items.length;i++){var e=items[i];html+='<div class="lc-dice-entry '+(e.result?"lc-dice-success":"lc-dice-fail")+'"><span class="lc-dice-ts">'+e.ts+'</span> '+e.target+': \uD83C\uDFB2'+e.roll+'/'+e.chance+'% '+(e.result?'\u2713':'\u2717')+'</div>';} el.innerHTML=html; }
function renderIntimLog() { var el=document.getElementById("lc-intim-log");if(!el)return;var logs=S().intimacyLog;if(!logs||!logs.length){el.innerHTML='<div class="lc-empty">Нет записей</div>';return;} var html="";var items=logs.slice().reverse().slice(0,15);for(var i=0;i<items.length;i++){var e=items[i];html+='<div class="lc-intim-entry"><span class="lc-intim-ts">'+e.ts+'</span> '+(e.parts||[]).join(" + ")+'</div>';} el.innerHTML=html; }

function updateSelects() { var opts=charOptions();var selects=document.querySelectorAll(".lc-char-select");for(var i=0;i<selects.length;i++){var val=selects[i].value;selects[i].innerHTML=opts;if(Object.keys(S().characters).indexOf(val)!==-1)selects[i].value=val;} }

function rebuild() { renderDashboard();renderCharList();renderCycle();renderHeatRut();renderPregnancy();renderLabor();renderBabies();renderOvi();renderRelations();renderProfiles();renderDiceLog();renderIntimLog();updateSelects(); }

// ========================
// INJECT WIDGET
// ========================
function injectWidget(messageIndex) {
    var s=S();if(!s.enabled||!s.showStatusWidget)return;var ctx=getContext();if(!ctx||!ctx.chat)return;
    var widgetHtml=generateWidget();if(!widgetHtml)return;
    try{var msgEl=document.querySelector('#chat .mes[mesid="'+messageIndex+'"]');if(!msgEl)return;var existing=msgEl.querySelector(".lc-status-widget");if(existing)existing.remove();var mesText=msgEl.querySelector(".mes_text");if(mesText)mesText.insertAdjacentHTML("afterend",widgetHtml);}catch(e){}
}

function generateWidget() {
    var s=S();if(!s.enabled||!s.showStatusWidget)return "";
    var chars=Object.keys(s.characters).filter(function(n){return s.characters[n]._enabled;});if(!chars.length)return "";
    var h=['<div class="lc-status-widget"><div class="lc-sw-header" onclick="var b=this.nextElementSibling;var a=this.querySelector(\'.lc-sw-arrow\');if(b.style.display===\'none\'){b.style.display=\'block\';a.textContent=\'\\u25BC\';}else{b.style.display=\'none\';a.textContent=\'\\u25B6\';}"><span>\uD83D\uDC30 BunnyCycle</span><span class="lc-sw-arrow">\u25BC</span></div><div class="lc-sw-body"><div class="lc-sw-date">'+formatDate(s.worldDate)+'</div>'];
    for(var i=0;i<chars.length;i++){var name=chars[i];var p=s.characters[name];var parts=[];
    if(s.modules.pregnancy&&p.pregnancy&&p.pregnancy.active){parts.push('\uD83E\uDD30 W'+p.pregnancy.week+'/'+p.pregnancy.maxWeeks+(p.pregnancy.complications.length>0?' \u26A0\uFE0F':''));}
    if(s.modules.labor&&p.labor&&p.labor.active){parts.push('\uD83C\uDFE5 '+LABOR_LABELS[p.labor.stage]+(p.labor.complications&&p.labor.complications.length>0?' \u26A0\uFE0F':''));}
    if(p.heat&&p.heat.active)parts.push('\uD83D\uDD25');if(p.rut&&p.rut.active)parts.push('\uD83D\uDCA2');
    if(s.modules.cycle&&p.cycle&&p.cycle.enabled&&!(p.pregnancy&&p.pregnancy.active)){var cm=new CycleManager(p);parts.push(cm.emoji(cm.phase())+' '+cm.label(cm.phase()));}
    if(parts.length>0)h.push('<div class="lc-sw-char"><div class="lc-sw-char-name">'+(p.bioSex==="F"?"\u2640":"\u2642")+' '+name+'</div><div class="lc-sw-detail-block"><div class="lc-sw-detail-row">'+parts.join(' | ')+'</div></div></div>');
    }
    h.push('</div></div>');return h.join("");
}

// ========================
// POPUPS
// ========================
function showDicePopup(result, targetName, isAuto) {
    var old1=document.querySelector(".lc-overlay");var old2=document.querySelector(".lc-popup");if(old1)old1.remove();if(old2)old2.remove();
    var overlay=document.createElement("div");overlay.className="lc-overlay";
    var popup=document.createElement("div");popup.className="lc-popup";
    popup.innerHTML='<div class="lc-popup-title">\uD83C\uDFB2 Бросок на зачатие</div><div class="lc-popup-details"><strong>'+targetName+'</strong> | Шанс: '+result.chance+'%</div><div class="lc-popup-result '+(result.result?"success":"fail")+'">'+result.roll+' / '+result.chance+'</div><div class="lc-popup-verdict '+(result.result?"success":"fail")+'">'+(result.result?'\u2713 ЗАЧАТИЕ!':'\u2717 Не произошло')+'</div><div class="lc-popup-actions"><button class="lc-btn lc-btn-success" id="lc-dp-ok">\u2713 OK</button><button class="lc-btn" id="lc-dp-re">\uD83C\uDFB2 Переброс</button><button class="lc-btn lc-btn-danger" id="lc-dp-no">\u2715 Отмена</button></div>';
    document.body.appendChild(overlay);document.body.appendChild(popup);
    document.getElementById("lc-dp-ok").addEventListener("click",function(){if(result.result){var p=S().characters[targetName];if(p&&canGetPregnant(p)){var father=(result.parts||[]).find(function(x){return x!==targetName;})||"?";new PregManager(p).start(father,1,null,1);saveSettingsDebounced();rebuild();}}overlay.remove();popup.remove();});
    document.getElementById("lc-dp-re").addEventListener("click",function(){overlay.remove();popup.remove();var nr=Intimacy.roll(targetName,{parts:result.parts,type:result.type,ejac:result.ejac,auto:isAuto});showDicePopup(nr,targetName,isAuto);});
    document.getElementById("lc-dp-no").addEventListener("click",function(){overlay.remove();popup.remove();});
    overlay.addEventListener("click",function(){overlay.remove();popup.remove();});
}

function showBabyForm(parentName, fatherName, existingBaby, babyIndex, isStandalone) {
    var s=S();var isEdit=!!existingBaby;var baby=existingBaby||{};
    var old1=document.querySelector(".lc-overlay");var old2=document.querySelector(".lc-popup");if(old1)old1.remove();if(old2)old2.remove();
    var overlay=document.createElement("div");overlay.className="lc-overlay";
    var form=document.createElement("div");form.className="lc-popup";form.style.maxWidth="400px";
    var html='<div class="lc-popup-title">'+(isEdit?'\u270F\uFE0F Редактирование':'\uD83D\uDC76 Новый ребёнок')+'</div><div class="lc-editor-grid">';
    html+='<div class="lc-editor-field"><label>Имя</label><input class="lc-input" id="lc-bf-name" value="'+(baby.name||'')+'"></div>';
    html+='<div class="lc-editor-field"><label>Пол</label><select class="lc-select" id="lc-bf-sex"><option value="random">\uD83C\uDFB2</option><option value="M"'+(baby.sex==="M"?' selected':'')+'>♂</option><option value="F"'+(baby.sex==="F"?' selected':'')+'>♀</option></select></div>';
    html+='<div class="lc-editor-field"><label>Глаза</label><input class="lc-input" id="lc-bf-eyes" value="'+(baby.eyeColor||'')+'"></div>';
    html+='<div class="lc-editor-field"><label>Волосы</label><input class="lc-input" id="lc-bf-hair" value="'+(baby.hairColor||'')+'"></div>';
    if(isEdit)html+='<div class="lc-editor-field"><label>Возраст(дни)</label><input type="number" class="lc-input" id="lc-bf-age" value="'+(baby.ageDays||0)+'"></div>';
    if(isStandalone){var co=charOptions();html+='<div class="lc-editor-field"><label>Мать</label><select class="lc-select" id="lc-bf-mo">'+co+'</select></div><div class="lc-editor-field"><label>Отец</label><select class="lc-select" id="lc-bf-fa">'+co+'</select></div><div class="lc-editor-field"><label>Привязать к</label><select class="lc-select" id="lc-bf-to">'+co+'</select></div>';}
    html+='</div><div class="lc-popup-actions"><button class="lc-btn lc-btn-success" id="lc-bf-save">\uD83D\uDCBE</button><button class="lc-btn" id="lc-bf-cancel">Отмена</button></div>';
    form.innerHTML=html;document.body.appendChild(overlay);document.body.appendChild(form);
    document.getElementById("lc-bf-save").addEventListener("click",function(){
        var name=(document.getElementById("lc-bf-name").value||"").trim()||"Малыш";var sex=document.getElementById("lc-bf-sex").value;if(sex==="random")sex=Math.random()<0.5?"M":"F";
        var eyes=(document.getElementById("lc-bf-eyes").value||"").trim();var hair=(document.getElementById("lc-bf-hair").value||"").trim();
        if(isEdit){var eb=s.characters[parentName]&&s.characters[parentName].babies[babyIndex];if(eb){eb.name=name;eb.sex=sex;if(eyes)eb.eyeColor=eyes;if(hair)eb.hairColor=hair;var ai=document.getElementById("lc-bf-age");if(ai){eb.ageDays=parseInt(ai.value)||0;new BabyManager(eb).update();}saveSettingsDebounced();rebuild();}}
        else if(isStandalone){var mo=document.getElementById("lc-bf-mo")?document.getElementById("lc-bf-mo").value:"?";var fa=document.getElementById("lc-bf-fa")?document.getElementById("lc-bf-fa").value:"?";var to=document.getElementById("lc-bf-to")?document.getElementById("lc-bf-to").value:null;if(to&&s.characters[to]){var nb=BabyManager.generate(s.characters[mo],fa,{name:name,sex:sex,eyeColor:eyes,hairColor:hair});nb.mother=mo;nb.father=fa;s.characters[to].babies.push(nb);Rels.addBirth(mo,fa,name);saveSettingsDebounced();rebuild();}}
        else{var mother=s.characters[parentName];if(mother){var nb2=BabyManager.generate(mother,fatherName,{name:name,sex:sex,eyeColor:eyes,hairColor:hair});mother.babies.push(nb2);Rels.addBirth(parentName,fatherName,name);var lm=new LaborManager(mother);lm.deliver();if(lm.l.babiesDelivered>=lm.l.totalBabies)lm.end();saveSettingsDebounced();rebuild();}}
        overlay.remove();form.remove();});
    document.getElementById("lc-bf-cancel").addEventListener("click",function(){overlay.remove();form.remove();});
    overlay.addEventListener("click",function(){overlay.remove();form.remove();});
}

// ========================
// EDITOR
// ========================
var currentEditName = null;
function openEditor(name) {
    var s=S();var p=s.characters[name];if(!p)return;currentEditName=name;
    var ed=document.getElementById("lc-char-editor");if(ed)ed.classList.remove("hidden");
    document.getElementById("lc-editor-title").textContent="\u270F\uFE0F "+name;
    document.getElementById("lc-ed-bio").value=p.bioSex;document.getElementById("lc-ed-sec").value=p.secondarySex||"";
    document.getElementById("lc-ed-race").value=p.race||"human";document.getElementById("lc-ed-contra").value=p.contraception;
    document.getElementById("lc-ed-eyes").value=p.eyeColor||"";document.getElementById("lc-ed-hair").value=p.hairColor||"";
    document.getElementById("lc-ed-diff").value=p.pregnancyDifficulty||"normal";document.getElementById("lc-ed-on").checked=p._enabled!==false;
    document.getElementById("lc-ed-cyc").checked=!!(p.cycle&&p.cycle.enabled);document.getElementById("lc-ed-clen").value=(p.cycle&&p.cycle.baseLength)||28;
    document.getElementById("lc-ed-mdur").value=(p.cycle&&p.cycle.menstruationDuration)||5;document.getElementById("lc-ed-irreg").value=(p.cycle&&p.cycle.irregularity)||2;
}
function closeEditor(){currentEditName=null;var ed=document.getElementById("lc-char-editor");if(ed)ed.classList.add("hidden");}
function saveEditor(){
    if(!currentEditName)return;var s=S();var p=s.characters[currentEditName];if(!p)return;
    p.bioSex=document.getElementById("lc-ed-bio").value;p._mB=true;p.secondarySex=document.getElementById("lc-ed-sec").value||null;p._mS=true;
    p.race=document.getElementById("lc-ed-race").value;p._mR=true;p.contraception=document.getElementById("lc-ed-contra").value;
    p.eyeColor=document.getElementById("lc-ed-eyes").value;p._mE=!!p.eyeColor;p.hairColor=document.getElementById("lc-ed-hair").value;p._mH=!!p.hairColor;
    p.pregnancyDifficulty=document.getElementById("lc-ed-diff").value;p._enabled=document.getElementById("lc-ed-on").checked;
    p.cycle.enabled=document.getElementById("lc-ed-cyc").checked;p._mCyc=true;
    var len=parseInt(document.getElementById("lc-ed-clen").value);if(len>=21&&len<=45){p.cycle.baseLength=len;p.cycle.length=len;}
    p.cycle.menstruationDuration=parseInt(document.getElementById("lc-ed-mdur").value)||5;p.cycle.irregularity=parseInt(document.getElementById("lc-ed-irreg").value)||2;
    saveSettingsDebounced();Profiles.save();closeEditor();rebuild();toastr.success(currentEditName+" сохранён!");
}

// ========================
// HEAT/RUT BUTTON BINDINGS
// ========================
function bindHeatRutButtons(profile) {
    var el;
    el=document.getElementById("lc-hr-th");if(el)el.addEventListener("click",function(){profile.heat.active=true;profile.heat.currentDay=1;saveSettingsDebounced();renderHeatRut();renderDashboard();});
    el=document.getElementById("lc-hr-sh");if(el)el.addEventListener("click",function(){profile.heat.active=false;profile.heat.currentDay=0;profile.heat.daysSinceLast=0;saveSettingsDebounced();renderHeatRut();renderDashboard();});
    el=document.getElementById("lc-hr-su");if(el)el.addEventListener("click",function(){profile.heat.onSuppressants=!profile.heat.onSuppressants;saveSettingsDebounced();renderHeatRut();});
    el=document.getElementById("lc-hr-tr");if(el)el.addEventListener("click",function(){profile.rut.active=true;profile.rut.currentDay=1;saveSettingsDebounced();renderHeatRut();renderDashboard();});
    el=document.getElementById("lc-hr-sr");if(el)el.addEventListener("click",function(){profile.rut.active=false;profile.rut.currentDay=0;profile.rut.daysSinceLast=0;saveSettingsDebounced();renderHeatRut();renderDashboard();});
}

// ========================
// HTML GENERATION
// ========================
function generateHTML() {
    var s = S(); var co = charOptions(); var rto = relTypeOptions();
    var h = '';

    // Panel wrapper
    h += '<div id="bunnycycle-panel" class="lifecycle-panel' + (s.panelCollapsed ? ' collapsed' : '') + '">';

    // Header
    h += '<div id="bunnycycle-header-toggle" class="lifecycle-header"><div class="lifecycle-header-title"><span class="lc-collapse-arrow">' + (s.panelCollapsed ? '\u25B6' : '\u25BC') + '</span><h3>\uD83D\uDC30 BunnyCycle</h3><span class="lc-version">v1.2</span></div><div class="lifecycle-header-actions"><label class="lc-switch"><input type="checkbox" id="lc-enabled"' + (s.enabled ? ' checked' : '') + '><span class="lc-switch-slider"></span></label></div></div>';

    // Body
    h += '<div class="lifecycle-body">';

    // Dashboard
    h += '<div class="lc-dashboard"><div class="lc-dashboard-date" id="lc-dash-date"></div><div id="lc-dash-items"></div></div>';

    // Tabs
    h += '<div class="lifecycle-tabs">';
    var tabs = [["chars","\uD83D\uDC65","Перс"],["rels","\uD83D\uDC9E","Семья"],["cycle","\uD83D\uDD34","Цикл"],["hr","\uD83D\uDD25","Течка"],["intim","\uD83D\uDC95","Интим"],["preg","\uD83E\uDD30","Берем"],["labor","\uD83C\uDFE5","Роды"],["baby","\uD83D\uDC76","Дети"],["ovi","\uD83E\uDD5A","Яйца"],["profs","\uD83D\uDCBE","Проф"],["sett","\u2699\uFE0F","Настр"]];
    for (var t = 0; t < tabs.length; t++) { h += '<button class="lifecycle-tab' + (t === 0 ? ' active' : '') + '" data-tab="' + tabs[t][0] + '"><span class="tab-icon">' + tabs[t][1] + '</span>' + tabs[t][2] + '</button>'; }
    h += '</div>';

    // TAB: Characters
    h += '<div class="lifecycle-tab-content active" data-tab="chars">';
    h += '<div class="lc-btn-group" style="margin-bottom:8px"><button class="lc-btn lc-btn-primary" id="lc-sync">\uD83D\uDD04 Синхр.</button><button class="lc-btn" id="lc-add-m">\u2795</button><button class="lc-btn" id="lc-reparse">\uD83D\uDCD6 AI</button></div>';
    h += '<div id="lc-char-list"></div>';
    // Editor
    h += '<div id="lc-char-editor" class="lc-editor hidden"><div class="lc-editor-title" id="lc-editor-title"></div><div class="lc-editor-grid">';
    h += '<div class="lc-editor-field"><label>Пол</label><select class="lc-select" id="lc-ed-bio"><option value="F">\u2640</option><option value="M">\u2642</option></select></div>';
    h += '<div class="lc-editor-field"><label>2-й пол</label><select class="lc-select" id="lc-ed-sec"><option value="">-</option><option value="alpha">\u03B1</option><option value="beta">\u03B2</option><option value="omega">\u03A9</option></select></div>';
    h += '<div class="lc-editor-field"><label>Раса</label><select class="lc-select" id="lc-ed-race"><option value="human">Человек</option><option value="elf">Эльф</option><option value="orc">Орк</option><option value="demon">Демон</option><option value="vampire">Вампир</option></select></div>';
    h += '<div class="lc-editor-field"><label>Контрацепция</label><select class="lc-select" id="lc-ed-contra"><option value="none">Нет</option><option value="condom">Презерв.</option><option value="pill">Таблетки</option><option value="iud">ВМС</option><option value="withdrawal">ППА</option></select></div>';
    h += '<div class="lc-editor-field"><label>Глаза</label><input class="lc-input" id="lc-ed-eyes"></div>';
    h += '<div class="lc-editor-field"><label>Волосы</label><input class="lc-input" id="lc-ed-hair"></div>';
    h += '<div class="lc-editor-field"><label>Сложность</label><select class="lc-select" id="lc-ed-diff"><option value="easy">Лёгкие</option><option value="normal">Обычные</option><option value="hard">Тяжёлые</option></select></div>';
    h += '<div class="lc-editor-field"><label>Включён</label><input type="checkbox" id="lc-ed-on"></div>';
    h += '<div class="lc-editor-field"><label>Цикл</label><input type="checkbox" id="lc-ed-cyc"></div>';
    h += '<div class="lc-editor-field"><label>Длина цикла</label><input type="number" class="lc-input" id="lc-ed-clen" min="21" max="45"></div>';
    h += '<div class="lc-editor-field"><label>Менструация</label><input type="number" class="lc-input" id="lc-ed-mdur" min="2" max="10"></div>';
    h += '<div class="lc-editor-field"><label>Нерегулярность</label><input type="number" class="lc-input" id="lc-ed-irreg" min="0" max="7"></div>';
    h += '</div><div class="lc-editor-actions"><button class="lc-btn lc-btn-success" id="lc-ed-save">\uD83D\uDCBE Сохранить</button><button class="lc-btn" id="lc-ed-cancel">Отмена</button></div></div>';
    h += '</div>'; // chars tab

    // TAB: Relationships
    h += '<div class="lifecycle-tab-content" data-tab="rels"><div class="lc-row" style="margin-bottom:8px;flex-wrap:wrap"><select class="lc-select lc-char-select" id="lc-rel-c1">' + co + '</select><select class="lc-select" id="lc-rel-tp">' + rto + '</select><select class="lc-select lc-char-select" id="lc-rel-c2">' + co + '</select><input class="lc-input" id="lc-rel-n" placeholder="Заметка" style="max-width:80px"><button class="lc-btn lc-btn-sm" id="lc-rel-add">\u2795</button></div><div id="lc-rel-list"></div></div>';

    // TAB: Cycle
    h += '<div class="lifecycle-tab-content" data-tab="cycle"><select class="lc-select lc-char-select" id="lc-cyc-char" style="margin-bottom:6px">' + co + '</select><div id="lc-cyc-panel"></div></div>';

    // TAB: Heat/Rut
    h += '<div class="lifecycle-tab-content" data-tab="hr"><select class="lc-select lc-char-select" id="lc-hr-char" style="margin-bottom:6px">' + co + '</select><div id="lc-hr-panel"></div></div>';

    // TAB: Intimacy
    h += '<div class="lifecycle-tab-content" data-tab="intim"><div class="lc-section">';
    h += '<div class="lc-row"><label>Цель</label><select class="lc-select lc-char-select" id="lc-int-t">' + co + '</select></div>';
    h += '<div class="lc-row"><label>Партнёр</label><select class="lc-select lc-char-select" id="lc-int-p">' + co + '</select></div>';
    h += '<div class="lc-row"><label>Тип</label><select class="lc-select" id="lc-int-tp"><option value="vaginal">Вагин.</option><option value="anal">Анал.</option><option value="oral">Орал.</option></select></div>';
    h += '<div class="lc-row"><label>Эякуляция</label><select class="lc-select" id="lc-int-ej"><option value="inside">Внутрь</option><option value="outside">Наружу</option><option value="unknown">?</option></select></div>';
    h += '<div class="lc-btn-group"><button class="lc-btn" id="lc-int-log">\uD83D\uDCDD Записать</button><button class="lc-btn lc-btn-primary" id="lc-int-roll">\uD83C\uDFB2 Бросок</button></div></div>';
    h += '<div id="lc-dice-log" class="lc-scroll"></div><div id="lc-intim-log" class="lc-scroll"></div></div>';

    // TAB: Pregnancy (dynamic content rendered by renderPregnancy)
    h += '<div class="lifecycle-tab-content" data-tab="preg"><select class="lc-select lc-char-select" id="lc-preg-char" style="margin-bottom:6px">' + co + '</select><div id="lc-preg-panel"></div></div>';

    // TAB: Labor (dynamic content rendered by renderLabor)
    h += '<div class="lifecycle-tab-content" data-tab="labor"><select class="lc-select lc-char-select" id="lc-labor-char" style="margin-bottom:6px">' + co + '</select><div id="lc-labor-panel"></div></div>';

    // TAB: Baby
    h += '<div class="lifecycle-tab-content" data-tab="baby"><div class="lc-row" style="margin-bottom:6px"><select class="lc-select lc-char-select" id="lc-baby-par">' + co + '</select><button class="lc-btn lc-btn-sm" id="lc-baby-create">\u2795 Создать</button></div><div id="lc-baby-list"></div></div>';

    // TAB: Ovi
    h += '<div class="lifecycle-tab-content" data-tab="ovi"><select class="lc-select lc-char-select" id="lc-ovi-char" style="margin-bottom:6px">' + co + '</select><div id="lc-ovi-panel"></div><div class="lc-btn-group" style="margin-top:6px"><button class="lc-btn lc-btn-sm lc-btn-primary" id="lc-ovi-start">\uD83E\uDD5A Начать</button><button class="lc-btn lc-btn-sm" id="lc-ovi-adv">+1 день</button><button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-ovi-end">Завершить</button></div></div>';

    // TAB: Profiles
    h += '<div class="lifecycle-tab-content" data-tab="profs"><div class="lc-info-row" id="lc-prof-cur"></div><div class="lc-btn-group" style="margin-bottom:6px"><button class="lc-btn lc-btn-sm lc-btn-success" id="lc-prof-save">\uD83D\uDCBE Сохр.</button><button class="lc-btn lc-btn-sm" id="lc-prof-reload">\uD83D\uDD04 Загр.</button></div><div id="lc-prof-list"></div></div>';

    // TAB: Settings
    h += '<div class="lifecycle-tab-content" data-tab="sett">';
    // Modules
    h += '<div class="lc-section"><h4>Модули</h4>';
    var mods=[["lc-mc",s.modules.cycle,"\uD83D\uDD34 Цикл"],["lc-mp",s.modules.pregnancy,"\uD83E\uDD30 Беременность"],["lc-ml",s.modules.labor,"\uD83C\uDFE5 Роды"],["lc-mb",s.modules.baby,"\uD83D\uDC76 Дети"],["lc-mi",s.modules.intimacy,"\uD83D\uDC95 Интимность"],["lc-mau",s.modules.auOverlay,"\uD83C\uDF10 AU"],["lc-ovi-on",s.auSettings.oviposition.enabled,"\uD83E\uDD5A Ovi"]];
    for(var mc=0;mc<mods.length;mc++)h+='<label class="lc-checkbox"><input type="checkbox" id="'+mods[mc][0]+'"'+(mods[mc][1]?' checked':'')+'><span>'+mods[mc][2]+'</span></label>';
    h += '</div>';
    // Automation
    h += '<div class="lc-section"><h4>Автоматизация</h4>';
    var autos=[["lc-sa",s.autoSyncCharacters,"Авто-синхр"],["lc-sp",s.autoParseCharInfo,"Парсинг карточек"],["lc-sllm",s.useLLMParsing,"\uD83E\uDDE0 AI-анализ"],["lc-sc",s.parseFullChat,"Парсинг чата"],["lc-sd",s.autoDetectIntimacy,"Детекция секса"],["lc-sr",s.autoRollOnSex,"Авто-бросок"],["lc-sw",s.showStatusWidget,"Виджет"],["lc-st",s.autoTimeProgress,"Авто-время"]];
    for(var ac=0;ac<autos.length;ac++)h+='<label class="lc-checkbox"><input type="checkbox" id="'+autos[ac][0]+'"'+(autos[ac][1]?' checked':'')+'><span>'+autos[ac][2]+'</span></label>';
    h += '</div>';
    // Prompt
    h += '<div class="lc-section"><h4>Промпт</h4>';
    h += '<label class="lc-checkbox"><input type="checkbox" id="lc-pon"'+(s.promptInjectionEnabled?' checked':'')+'><span>Инъекция</span></label>';
    h += '<div class="lc-row"><label>Позиция</label><select class="lc-select" id="lc-ppos"><option value="authornote"'+(s.promptInjectionPosition==="authornote"?" selected":"")+'>Author Note</option><option value="system"'+(s.promptInjectionPosition==="system"?" selected":"")+'>System</option></select></div>';
    h += '<div class="lc-row"><label>AU</label><select class="lc-select" id="lc-aup"><option value="realism"'+(s.auPreset==="realism"?" selected":"")+'>Реализм</option><option value="omegaverse"'+(s.auPreset==="omegaverse"?" selected":"")+'>Омегаверс</option><option value="fantasy"'+(s.auPreset==="fantasy"?" selected":"")+'>Фэнтези</option></select></div></div>';
    // Date
    h += '<div class="lc-section"><h4>Дата мира</h4><div class="lc-row">';
    h += '<input type="number" class="lc-input" id="lc-dy" value="'+s.worldDate.year+'" style="width:65px">';
    h += '<input type="number" class="lc-input" id="lc-dm" value="'+s.worldDate.month+'" min="1" max="12" style="width:42px">';
    h += '<input type="number" class="lc-input" id="lc-dd" value="'+s.worldDate.day+'" min="1" max="31" style="width:42px">';
    h += '<input type="number" class="lc-input" id="lc-dh" value="'+s.worldDate.hour+'" min="0" max="23" style="width:42px">';
    h += '<button class="lc-btn lc-btn-sm" id="lc-da">OK</button></div>';
    h += '<div class="lc-btn-group" style="margin-top:4px"><button class="lc-btn lc-btn-sm" id="lc-d1">+1 день</button><button class="lc-btn lc-btn-sm" id="lc-d7">+7 дней</button><label class="lc-checkbox"><input type="checkbox" id="lc-df"'+(s.worldDate.frozen?' checked':'')+'><span>\u2744\uFE0F Заморозка</span></label></div></div>';
    // Export/Import/Reset
    h += '<div class="lc-section"><h4>Данные</h4><div class="lc-btn-group"><button class="lc-btn lc-btn-sm" id="lc-exp">\uD83D\uDCE4 Экспорт</button><button class="lc-btn lc-btn-sm" id="lc-imp">\uD83D\uDCE5 Импорт</button><button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-rst">\uD83D\uDDD1\uFE0F Сброс</button></div></div>';
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

    // Header
    var headerEl=document.getElementById("bunnycycle-header-toggle");
    if(headerEl)headerEl.addEventListener("click",function(e){if(e.target.closest(".lc-switch"))return;s.panelCollapsed=!s.panelCollapsed;var p=document.getElementById("bunnycycle-panel");if(p)p.classList.toggle("collapsed",s.panelCollapsed);var a=this.querySelector(".lc-collapse-arrow");if(a)a.innerHTML=s.panelCollapsed?"\u25B6":"\u25BC";saveSettingsDebounced();});

    // Enabled
    var enEl=document.getElementById("lc-enabled");if(enEl)enEl.addEventListener("change",function(){s.enabled=this.checked;saveSettingsDebounced();});

    // Tabs
    var tabBtns=document.querySelectorAll(".lifecycle-tab");
    for(var ti=0;ti<tabBtns.length;ti++)tabBtns[ti].addEventListener("click",function(){var all=document.querySelectorAll(".lifecycle-tab");for(var j=0;j<all.length;j++)all[j].classList.remove("active");var panels=document.querySelectorAll(".lifecycle-tab-content");for(var k=0;k<panels.length;k++)panels[k].classList.remove("active");this.classList.add("active");var tp=document.querySelector('.lifecycle-tab-content[data-tab="'+this.dataset.tab+'"]');if(tp)tp.classList.add("active");rebuild();});

    // Sync/Add/Reparse
    var syncBtn=document.getElementById("lc-sync");if(syncBtn)syncBtn.addEventListener("click",async function(){toastr.info("Сканирование...");await syncChars();rebuild();toastr.success("Готово!");});
    var addBtn=document.getElementById("lc-add-m");if(addBtn)addBtn.addEventListener("click",function(){var n=prompt("Имя персонажа:");if(n&&n.trim()){s.characters[n.trim()]=makeProfile(n.trim(),false,"F");saveSettingsDebounced();rebuild();}});
    var repBtn=document.getElementById("lc-reparse");if(repBtn)repBtn.addEventListener("click",async function(){CharAnalyzer.clearCache();ChatAnalyzer.clearCache();var ns=Object.keys(s.characters);for(var i=0;i<ns.length;i++){var p=s.characters[ns[i]];p._mB=false;p._mE=false;p._mH=false;p._mR=false;p._mS=false;}toastr.info("AI анализирует...");await syncChars();rebuild();toastr.success("AI-скан завершён!");});

    // Char list
    var charList=document.getElementById("lc-char-list");if(charList)charList.addEventListener("click",function(e){var eb=e.target.closest(".lc-edit-char");var db=e.target.closest(".lc-del-char");if(eb)openEditor(eb.dataset.char);if(db&&confirm("Удалить?")){delete s.characters[db.dataset.char];saveSettingsDebounced();rebuild();}});

    // Editor
    var edSave=document.getElementById("lc-ed-save");if(edSave)edSave.addEventListener("click",saveEditor);
    var edCancel=document.getElementById("lc-ed-cancel");if(edCancel)edCancel.addEventListener("click",closeEditor);

    // Relations
    var relAdd=document.getElementById("lc-rel-add");if(relAdd)relAdd.addEventListener("click",function(){var c1=document.getElementById("lc-rel-c1");var c2=document.getElementById("lc-rel-c2");var tp=document.getElementById("lc-rel-tp");var n=document.getElementById("lc-rel-n");if(!c1||!c2||!tp||c1.value===c2.value)return;Rels.add(c1.value,c2.value,tp.value,n?n.value:"");if(n)n.value="";renderRelations();});

    // Cycle
    var cycChar=document.getElementById("lc-cyc-char");if(cycChar)cycChar.addEventListener("change",renderCycle);
    // Cycle buttons are bound inside renderCycle via delegation... let's bind them here
    document.addEventListener("click",function(e){
        if(e.target.id==="lc-cyc-setday"){var sel=document.getElementById("lc-cyc-char");var inp=document.getElementById("lc-cyc-day");if(!sel||!inp)return;var p=s.characters[sel.value];if(!p||!p.cycle)return;var d=parseInt(inp.value);if(d>=1&&d<=p.cycle.length){new CycleManager(p).setDay(d);saveSettingsDebounced();renderCycle();renderDashboard();}}
        if(e.target.id==="lc-cyc-mens"){var sel2=document.getElementById("lc-cyc-char");if(sel2&&s.characters[sel2.value]){new CycleManager(s.characters[sel2.value]).setPhase("menstruation");saveSettingsDebounced();renderCycle();renderDashboard();}}
        if(e.target.id==="lc-cyc-ovul"){var sel3=document.getElementById("lc-cyc-char");if(sel3&&s.characters[sel3.value]){new CycleManager(s.characters[sel3.value]).setPhase("ovulation");saveSettingsDebounced();renderCycle();renderDashboard();}}
        if(e.target.id==="lc-cyc-skip"){var sel4=document.getElementById("lc-cyc-char");if(sel4&&s.characters[sel4.value]){s.characters[sel4.value].cycle.currentDay=1;s.characters[sel4.value].cycle.cycleCount++;saveSettingsDebounced();renderCycle();renderDashboard();}}
    });

    // Heat/Rut
    var hrChar=document.getElementById("lc-hr-char");if(hrChar)hrChar.addEventListener("change",renderHeatRut);

    // Intimacy
    var intLog=document.getElementById("lc-int-log");if(intLog)intLog.addEventListener("click",function(){var t=document.getElementById("lc-int-t");if(!t||!t.value)return;Intimacy.log({parts:[t.value,(document.getElementById("lc-int-p")||{}).value].filter(Boolean),type:(document.getElementById("lc-int-tp")||{}).value||"vaginal",ejac:(document.getElementById("lc-int-ej")||{}).value||"unknown"});renderIntimLog();});
    var intRoll=document.getElementById("lc-int-roll");if(intRoll)intRoll.addEventListener("click",function(){var t=document.getElementById("lc-int-t");if(!t||!t.value)return;var result=Intimacy.roll(t.value,{parts:[t.value,(document.getElementById("lc-int-p")||{}).value].filter(Boolean),type:(document.getElementById("lc-int-tp")||{}).value||"vaginal",ejac:(document.getElementById("lc-int-ej")||{}).value||"unknown"});if(result.reason==="not_eligible"){toastr.warning("Не может забеременеть!");return;}showDicePopup(result,t.value,false);renderDiceLog();});

    // Pregnancy char selector
    var pregChar=document.getElementById("lc-preg-char");if(pregChar)pregChar.addEventListener("change",renderPregnancy);

    // Labor char selector
    var laborChar=document.getElementById("lc-labor-char");if(laborChar)laborChar.addEventListener("change",renderLabor);

    // Baby
    var babyPar=document.getElementById("lc-baby-par");if(babyPar)babyPar.addEventListener("change",renderBabies);
    var babyCreate=document.getElementById("lc-baby-create");if(babyCreate)babyCreate.addEventListener("click",function(){showBabyForm(null,null,null,null,true);});
    var babyList=document.getElementById("lc-baby-list");if(babyList)babyList.addEventListener("click",function(e){var eb=e.target.closest(".lc-baby-edit");var db=e.target.closest(".lc-baby-del");if(eb){var baby=s.characters[eb.dataset.p]&&s.characters[eb.dataset.p].babies[parseInt(eb.dataset.i)];if(baby)showBabyForm(eb.dataset.p,baby.father,baby,parseInt(eb.dataset.i));}if(db&&confirm("Удалить?")){if(s.characters[db.dataset.p])s.characters[db.dataset.p].babies.splice(parseInt(db.dataset.i),1);saveSettingsDebounced();renderBabies();}});

    // Ovi
    var oviChar=document.getElementById("lc-ovi-char");if(oviChar)oviChar.addEventListener("change",renderOvi);
    var oviStart=document.getElementById("lc-ovi-start");if(oviStart)oviStart.addEventListener("click",function(){var sel=document.getElementById("lc-ovi-char");if(!sel)return;var p=s.characters[sel.value];if(p){new OviManager(p).startCarrying();saveSettingsDebounced();renderOvi();renderDashboard();}});
    var oviAdv=document.getElementById("lc-ovi-adv");if(oviAdv)oviAdv.addEventListener("click",function(){var sel=document.getElementById("lc-ovi-char");if(!sel)return;var p=s.characters[sel.value];if(p&&p.oviposition&&p.oviposition.active){new OviManager(p).advance(1);saveSettingsDebounced();renderOvi();renderDashboard();}});
    var oviEnd=document.getElementById("lc-ovi-end");if(oviEnd)oviEnd.addEventListener("click",function(){var sel=document.getElementById("lc-ovi-char");if(!sel)return;var p=s.characters[sel.value];if(p&&p.oviposition&&p.oviposition.active){new OviManager(p).end();saveSettingsDebounced();renderOvi();renderDashboard();}});

    // Profiles
    var profSave=document.getElementById("lc-prof-save");if(profSave)profSave.addEventListener("click",function(){Profiles.save();renderProfiles();toastr.success("Сохранено!");});
    var profReload=document.getElementById("lc-prof-reload");if(profReload)profReload.addEventListener("click",async function(){Profiles.load();await syncChars();rebuild();toastr.info("Перезагружено!");});
    var profList=document.getElementById("lc-prof-list");if(profList)profList.addEventListener("click",function(e){var lb=e.target.closest(".lc-prof-load");var db=e.target.closest(".lc-prof-del");if(lb){var pr=s.chatProfiles&&s.chatProfiles[lb.dataset.id];if(pr){s.characters=JSON.parse(JSON.stringify(pr.characters||{}));s.relationships=JSON.parse(JSON.stringify(pr.relationships||[]));s.worldDate=JSON.parse(JSON.stringify(pr.worldDate||DEFAULTS.worldDate));s.currentChatId=lb.dataset.id;saveSettingsDebounced();rebuild();toastr.success("Загружено!");}}if(db&&confirm("Удалить?")){Profiles.del(db.dataset.id);renderProfiles();}});

    // Settings: Modules
    var modMap={"lc-mc":"cycle","lc-mp":"pregnancy","lc-ml":"labor","lc-mb":"baby","lc-mi":"intimacy"};
    Object.keys(modMap).forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener("change",function(){s.modules[modMap[id]]=this.checked;saveSettingsDebounced();});});
    var mauEl=document.getElementById("lc-mau");if(mauEl)mauEl.addEventListener("change",function(){s.modules.auOverlay=this.checked;saveSettingsDebounced();});
    var oviOnEl=document.getElementById("lc-ovi-on");if(oviOnEl)oviOnEl.addEventListener("change",function(){s.auSettings.oviposition.enabled=this.checked;saveSettingsDebounced();});
    var llmEl=document.getElementById("lc-sllm");if(llmEl)llmEl.addEventListener("change",function(){s.useLLMParsing=this.checked;saveSettingsDebounced();});

    // Settings: Automation
    var autoMap={"lc-sa":"autoSyncCharacters","lc-sp":"autoParseCharInfo","lc-sc":"parseFullChat","lc-sd":"autoDetectIntimacy","lc-sr":"autoRollOnSex","lc-sw":"showStatusWidget","lc-st":"autoTimeProgress"};
    Object.keys(autoMap).forEach(function(id){var el=document.getElementById(id);if(el)el.addEventListener("change",function(){s[autoMap[id]]=this.checked;saveSettingsDebounced();});});

    // Settings: Prompt
    var ponEl=document.getElementById("lc-pon");if(ponEl)ponEl.addEventListener("change",function(){s.promptInjectionEnabled=this.checked;saveSettingsDebounced();});
    var pposEl=document.getElementById("lc-ppos");if(pposEl)pposEl.addEventListener("change",function(){s.promptInjectionPosition=this.value;saveSettingsDebounced();});
    var aupEl=document.getElementById("lc-aup");if(aupEl)aupEl.addEventListener("change",function(){s.auPreset=this.value;saveSettingsDebounced();});

    // Settings: Date
    var daBtn=document.getElementById("lc-da");if(daBtn)daBtn.addEventListener("click",function(){s.worldDate.year=parseInt(document.getElementById("lc-dy").value)||2025;s.worldDate.month=clamp(parseInt(document.getElementById("lc-dm").value)||1,1,12);s.worldDate.day=clamp(parseInt(document.getElementById("lc-dd").value)||1,1,31);s.worldDate.hour=clamp(parseInt(document.getElementById("lc-dh").value)||12,0,23);saveSettingsDebounced();renderDashboard();});
    var d1Btn=document.getElementById("lc-d1");if(d1Btn)d1Btn.addEventListener("click",function(){TimeParse.apply({days:1});rebuild();});
    var d7Btn=document.getElementById("lc-d7");if(d7Btn)d7Btn.addEventListener("click",function(){TimeParse.apply({days:7});rebuild();});
    var dfEl=document.getElementById("lc-df");if(dfEl)dfEl.addEventListener("change",function(){s.worldDate.frozen=this.checked;saveSettingsDebounced();});

    // Export
    var expBtn=document.getElementById("lc-exp");if(expBtn)expBtn.addEventListener("click",function(){var blob=new Blob([JSON.stringify(s,null,2)],{type:"application/json"});var url=URL.createObjectURL(blob);var a=document.createElement("a");a.href=url;a.download="bunnycycle_"+Date.now()+".json";document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);});
    // Import
    var impBtn=document.getElementById("lc-imp");if(impBtn)impBtn.addEventListener("click",function(){var input=document.createElement("input");input.type="file";input.accept=".json";input.addEventListener("change",function(e){var file=e.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(ev){try{extension_settings[EXT]=deepMerge(DEFAULTS,JSON.parse(ev.target.result));saveSettingsDebounced();var op=document.getElementById("bunnycycle-panel");if(op)op.remove();init();toastr.success("Импортировано!");}catch(err){toastr.error("Ошибка: "+err.message);}};reader.readAsText(file);});input.click();});
    // Reset
    var rstBtn=document.getElementById("lc-rst");if(rstBtn)rstBtn.addEventListener("click",function(){if(!confirm("Полный сброс?"))return;extension_settings[EXT]=JSON.parse(JSON.stringify(DEFAULTS));saveSettingsDebounced();var op=document.getElementById("bunnycycle-panel");if(op)op.remove();init();});
}

// ========================
// MESSAGE HOOK
// ========================
async function onMessageReceived(messageIndex) {
    var s=S();if(!s.enabled)return;var ctx=getContext();if(!ctx||!ctx.chat||messageIndex<0)return;
    var msg=ctx.chat[messageIndex];if(!msg||!msg.mes||msg.is_user)return;
    if(s.autoSyncCharacters)await syncChars();
    if(s.autoTimeProgress&&!s.worldDate.frozen){var tr=TimeParse.parse(msg.mes);if(tr){TimeParse.apply(tr);rebuild();}}
    if(s.autoDetectIntimacy&&s.modules.intimacy){var det=SexDetect.detect(msg.mes,s.characters);if(det&&det.detected){Intimacy.log({parts:det.participants,type:det.type,ejac:det.ejac,auto:true});if(s.autoRollOnSex&&det.target&&det.type==="vaginal"&&(det.ejac==="inside"||det.ejac==="unknown")){var rr=Intimacy.roll(det.target,{parts:det.participants,type:det.type,ejac:det.ejac,condom:det.condom,noCondom:det.noCondom,auto:true});if(rr.reason!=="not_eligible")showDicePopup(rr,det.target,true);}}}
    if(s.showStatusWidget)injectWidget(messageIndex);renderDashboard();
}

// ========================
// INITIALIZATION
// ========================
async function init() {
    try{
        console.log("[BunnyCycle] Initializing v1.2.0...");
        if(!extension_settings[EXT])extension_settings[EXT]=JSON.parse(JSON.stringify(DEFAULTS));
        else extension_settings[EXT]=deepMerge(JSON.parse(JSON.stringify(DEFAULTS)),extension_settings[EXT]);
        var oldPanel=document.getElementById("bunnycycle-panel");if(oldPanel)oldPanel.remove();
        var container=document.getElementById("extensions_settings2")||document.getElementById("extensions_settings");
        if(!container){console.warn("[BunnyCycle] No container!");return;}
        container.insertAdjacentHTML("beforeend",generateHTML());
        Profiles.load();await syncChars();bindAll();rebuild();
        if(eventSource){
            eventSource.on(event_types.MESSAGE_RECEIVED,function(idx){onMessageReceived(idx);});
            eventSource.on(event_types.CHAT_CHANGED,async function(){ChatAnalyzer.clearCache();Profiles.load();await syncChars();rebuild();});
            eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS,function(data){var s=S();if(!s.enabled||!s.promptInjectionEnabled)return;var inj=Prompt.generate();if(!inj)return;if(s.promptInjectionPosition==="system"&&data.systemPrompt!==undefined)data.systemPrompt+="\n\n"+inj;else if(s.promptInjectionPosition==="authornote")data.authorNote=(data.authorNote||"")+"\n\n"+inj;});
        }
        console.log("[BunnyCycle v1.2.0] Loaded!");
    }catch(err){console.error("[BunnyCycle] Init error:",err);}
}

jQuery(async function(){await init();});

window.BunnyCycle = {
    getSettings: function(){return S();}, sync: syncChars,
    advanceTime: function(days){TimeParse.apply({days:days});rebuild();},
    rollDice: function(target,data){return Intimacy.roll(target,data);},
    canGetPregnant: canGetPregnant, CharAnalyzer: CharAnalyzer, ChatAnalyzer: ChatAnalyzer, BondManager: BondManager
};
