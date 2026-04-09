// ============================================================
// BunnyCycle Extension v1.0.0 — index.js (FULL)
// LLM-assisted character + chat analysis
// ============================================================

import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const EXT = "bunnycycle";

// ==========================================
// 1. DEFAULTS
// ==========================================

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
            heatCycleLength: 30, heatDuration: 5, heatFertilityBonus: 0.35,
            rutCycleLength: 35, rutDuration: 4, knotEnabled: true,
            bondingEnabled: true, suppressantsAvailable: true,
            maleOmegaPregnancy: true, pregnancyWeeks: 36,
        },
        fantasy: { pregnancyByRace: { human: 40, elf: 60, dwarf: 35, orc: 32 }, nonHumanFeatures: true },
        oviposition: {
            enabled: false, eggCountMin: 1, eggCountMax: 6,
            gestationDays: 14, layingDuration: 3, incubationDays: 21,
            eggSize: "medium", fertilizationChance: 0.7, shellType: "hard",
            nestingInstinct: true, canLayUnfertilized: true, eggAppearance: "перламутровые",
        },
    },
    chatProfiles: {},
    currentChatId: null,
    characters: {},
    relationships: [],
    diceLog: [],
    intimacyLog: [],
    pregnancyComplications: ["токсикоз", "гестационный диабет", "преэклампсия", "предлежание плаценты", "маловодие", "анемия"],
    laborComplications: ["слабость родовой деятельности", "стремительные роды", "обвитие пуповиной", "разрывы", "кровотечение"],
};

// ==========================================
// 2. UTILITY
// ==========================================

function deep(t, s) {
    const r = { ...t };
    for (const k of Object.keys(s)) {
        if (s[k] && typeof s[k] === "object" && !Array.isArray(s[k]) && t[k] && typeof t[k] === "object" && !Array.isArray(t[k])) {
            r[k] = deep(t[k], s[k]);
        } else {
            r[k] = s[k];
        }
    }
    return r;
}

function S() { return extension_settings[EXT]; }
function fmt(d) {
    if (!d) return "—";
    const p = n => String(n).padStart(2, "0");
    return `${d.year}/${p(d.month)}/${p(d.day)} ${p(d.hour)}:${p(d.minute)}`;
}
function addDays(d, n) {
    const dt = new Date(d.year, d.month - 1, d.day, d.hour, d.minute);
    dt.setDate(dt.getDate() + n);
    return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate(), hour: dt.getHours(), minute: dt.getMinutes(), frozen: d.frozen };
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function roll100() { return Math.floor(Math.random() * 100) + 1; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
function esc(s) { return (s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function canGetPregnant(p) {
    if (!p || !p._enabled) return false;
    if (p.bioSex === "F") return true;
    const s = S();
    if (p.bioSex === "M" && s.modules.auOverlay && s.auPreset === "omegaverse" && s.auSettings.omegaverse.maleOmegaPregnancy && p.secondarySex === "omega") return true;
    if (s.modules.auOverlay && s.auSettings.oviposition?.enabled && p._canLayEggs) return true;
    return false;
}

// ==========================================
// 3. LLM CALLER
// ==========================================

const LLM = {
    async call(systemPrompt, userPrompt) {
        try {
            if (typeof window.SillyTavern !== "undefined") {
                const ctx = window.SillyTavern.getContext();
                if (ctx?.generateRaw) {
                    const resp = await ctx.generateRaw(systemPrompt + "\n\n" + userPrompt, "", false, false, "[BunnyCycle]");
                    if (resp) return resp;
                }
            }
            if (typeof generateRaw === "function") {
                const resp = await generateRaw(systemPrompt + "\n\n" + userPrompt, "", false, false);
                if (resp) return resp;
            }
            const resp = await fetch("/api/backends/chat/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
                    max_tokens: 500, temperature: 0.05, stream: false,
                }),
            });
            if (resp.ok) {
                const data = await resp.json();
                return data?.choices?.[0]?.message?.content || data?.content || data?.response || "";
            }
            return null;
        } catch (err) {
            console.warn("[BunnyCycle] LLM call failed:", err.message);
            return null;
        }
    },
    parseJSON(text) {
        if (!text) return null;
        let clean = text.trim().replace(/```(?:json)?\s*/gi, <q>""</q>).replace(/```\s*/g, "");
        const m = clean.match(/{[\s\S]*}/);
        if (!m) return null;
        try { return JSON.parse(m[0]); }
        catch (e) { console.warn("[BunnyCycle] JSON parse fail:", e.message); return null; }
    },
};

// ==========================================
// 4. CHARACTER ANALYZER (LLM)
// ==========================================

const CharAnalyzer = {
    _cache: {},
    SYS: `You analyze character sheets and extract structured data.
RULES:
- Determine biological sex from description context, NOT from dialogue lines
- "she/her/она/её" describing THIS character = Female
- "he/him/он/его" describing THIS character = Male
- Extract eye color, hair color even from poetic descriptions ("orbs of emerald" = green)
- Look for omegaverse secondary sex (alpha/beta/omega)
- Identify non-human races
- Respond with ONLY valid JSON, no other text`,

    TMPL: `Character: {{name}}
Description:
{{desc}}
Personality: {{pers}}
Other: {{other}}

Return JSON:
{"biologicalSex":"M"or"F"or null,"sexConfidence":0-100,"secondarySex":"alpha"/"beta"/"omega"/null,"race":string or null,"eyeColor":string or null,"hairColor":string or null,"canLayEggs":bool,"reasoning":"brief why"}`,

    async analyze(name, charObj, isUser) {
        const ck = "char_" + name + "_" + (charObj?.data?.description?.length || 0);
        if (this._cache[ck]) return this._cache[ck];

        let desc = "", pers = "", other = "";
        if (isUser) {
            try {
                if (typeof power_user !== "undefined" && power_user.persona_description) desc = power_user.persona_description;
                const ctx = getContext(); if (ctx?.persona) desc += "\n" + ctx.persona;
            } catch (e) { /**/ }
            other = "(This is the USER's character)";
        } else if (charObj) {
            desc = (charObj.description || "") + "\n" + (charObj.data?.description || "");
            pers = (charObj.personality || "") + "\n" + (charObj.data?.personality || "");
            const depth = charObj.data?.extensions?.depth_prompt?.prompt || "";
            const tags = (charObj.tags || charObj.data?.tags || []).join(", ");
            const notes = charObj.data?.creator_notes || "";
            const scen = charObj.scenario || charObj.data?.scenario || "";
            other = [depth, scen, tags ? "Tags: " + tags : "", notes ? "Notes: " + notes : ""].filter(Boolean).join("\n");
        }
        try {
            const ctx = getContext();
            if (ctx?.worldInfo) {
                for (const entry of Object.values(ctx.worldInfo)) {
                    const keys = (entry.key || []).join(" ");
                    if (keys.toLowerCase().includes(name.toLowerCase())) other += "\nLorebook: " + (entry.content || "").substring(0, 500);
                }
            }
        } catch (e) { /**/ }

        if (desc.length < 10 && other.length < 10) return null;
        const prompt = this.TMPL.replace("{{name}}", name).replace("{{desc}}", desc.substring(0, 3000)).replace("{{pers}}", pers.substring(0, 1000)).replace("{{other}}", other.substring(0, 1500));
        const raw = await LLM.call(this.SYS, prompt);
        const parsed = LLM.parseJSON(raw);
        if (parsed) { this._cache[ck] = parsed; console.log("[BunnyCycle] Char analysis:", name, parsed); }
        return parsed;
    },
    clearCache() { this._cache = {}; },
};

// ==========================================
// 5. CHAT ANALYZER (LLM)
// ==========================================

const ChatAnalyzer = {
    _cache: {},
    _lastMsgCount: 0,
    SYS: `You analyze roleplay chat history and extract story events.
RULES:
- Only report events that ACTUALLY HAPPENED in the story
- Do NOT infer or guess. Only explicit events
- A child exists ONLY if explicitly born or physically present in scenes
- "I wish I had a son" or "my son" as metaphor does NOT count as a real child
- Sexual intercourse must be EXPLICITLY described (penetration etc), not just kissing
- Pregnancy must be EXPLICITLY stated or tested
- Return ONLY valid JSON, no other text`,

    TMPL: `Characters: {{chars}}
Recent messages (last {{count}}):
{{messages}}

Return JSON:
{
"events":[{"type":"sex"|"pregnancy_start"|"pregnancy_end"|"labor_start"|"birth"|"heat"|"rut","characters":["name"],"details":"brief","msgIndex":number}],
"children":[{"name":"name","sex":"M"|"F"|null,"mother":"name"|null,"father":"name"|null,"exists":true|false,"evidence":"why"}],
"currentStates":{"charName":{"pregnant":bool,"pregnancyWeek":number|null,"inLabor":bool,"inHeat":bool,"inRut":bool,"hasGivenBirth":bool}}
}
ONLY include children with exists:true if they PHYSICALLY EXIST. NOT hypothetical.`,

    async analyze(msgs, charNames) {
        if (!msgs?.length) return null;
        const ck = "chat_" + charNames.sort().join("_") + "_" + msgs.length;
        if (this._cache[ck]) return this._cache[ck];
        const recent = msgs.slice(-60);
        const msgText = recent.map((m, i) => {
            const sender = m.is_user ? (m.name || "User") : (m.name || "AI");
            return `[${msgs.length - recent.length + i}] ${sender}: ${(m.mes || "").substring(0, 500)}`;
        }).join("\n\n");
        const prompt = this.TMPL.replace("{{chars}}", charNames.join(", ")).replace("{{count}}", String(recent.length)).replace("{{messages}}", msgText.substring(0, 12000));
        const raw = await LLM.call(this.SYS, prompt);
        const parsed = LLM.parseJSON(raw);
        if (parsed) { this._cache[ck] = parsed; this._lastMsgCount = msgs.length; console.log("[BunnyCycle] Chat analysis:", parsed); }
        return parsed;
    },
    shouldReanalyze(msgs) { return !msgs?.length ? false : msgs.length - this._lastMsgCount >= 5; },
    clearCache() { this._cache = {}; this._lastMsgCount = 0; },
};

// ==========================================
// 6. REALTIME SEX DETECTOR (regex, per-message)
// ==========================================

const SexDetect = {
    STRONG: [/вошё?л\s*(в\s*неё|внутрь)/i, /проник\w*\s*(в\s*неё|внутрь)/i, /член\s*(?:вошёл|внутри|скользнул)/i, /кончил\s*(внутрь|в\s*неё|глубоко)/i, /трахал|ебал|ебёт|выебал/i, /фрикци\w+/i, /узел\s*(?:набух|внутри|застрял)/i, /(?:thrust|pushed|slid)\s*(?:deep\s*)?inside/i, /penetrat\w*\s*(?:her|him)/i, /fuck(?:ed|ing)\s/i, /cum(?:ming|med)?\s*(?:inside|deep)/i, /creampie/i, /knot\w*\s*(?:inside|stuck)/i],
    ANAL: [/анал/i, /anal/i], ORAL: [/минет|отсос/i, /blowjob|oral\s*sex/i],
    EJ_IN: [/кончил\s*(?:внутрь|в\s*неё|глубоко)/i, /cum\w*\s*inside/i, /creampie/i],
    EJ_OUT: [/кончил\s*(?:наружу|на\s*живот)/i, /pull\w*\s*out/i],
    CONTRA: [/презерватив/i, /condom/i], NO_CONTRA: [/без\s*(?:презерватива|защиты)/i, /raw|bareback/i],

    detect(text, chars) {
        if (!text) return null;
        let sc = 0;
        for (const p of this.STRONG) if (p.test(text)) sc++;
        if (sc < 3) return null;
        let tp = "vaginal";
        for (const p of this.ANAL) if (p.test(text)) { tp = "anal"; break; }
        for (const p of this.ORAL) if (p.test(text)) { tp = "oral"; break; }
        let co = false, nc = false;
        for (const p of this.CONTRA) if (p.test(text)) { co = true; break; }
        for (const p of this.NO_CONTRA) if (p.test(text)) { nc = true; break; }
        let ej = "unknown";
        for (const p of this.EJ_IN) if (p.test(text)) { ej = "inside"; break; }
        if (ej === "unknown") for (const p of this.EJ_OUT) if (p.test(text)) { ej = "outside"; break; }
        const parts = [], names = Object.keys(chars);
        for (const n of names) if (text.toLowerCase().includes(n.toLowerCase()) || chars[n]._isUser) parts.push(n);
        if (parts.length < 2 && names.length >= 2) for (const n of names) { if (!parts.includes(n)) parts.push(n); if (parts.length >= 2) break; }
        let target = null;
        for (const n of parts) { if (chars[n] && canGetPregnant(chars[n])) { target = n; break; } }
        return { detected: true, tp, co: co && !nc, nc, ej, parts, target };
    },
};

// ==========================================
// 7. CORE MANAGERS
// ==========================================

class CycleManager {
    constructor(p) { this.p = p; this.c = p.cycle; }
    phase() {
        if (!this.c?.enabled) return "unknown";
        const d = this.c.currentDay, l = this.c.length, m = this.c.menstruationDuration, ov = Math.round(l - 14);
        if (d <= m) return "menstruation"; if (d < ov - 2) return "follicular";
        if (d <= ov + 1) return "ovulation"; return "luteal";
    }
    label(ph) { return { menstruation: "Менструация", follicular: "Фолликулярная", ovulation: "Овуляция", luteal: "Лютеиновая", unknown: "—" }[ph] || ph; }
    emoji(ph) { return { menstruation: "🔴", follicular: "🌸", ovulation: "🥚", luteal: "🌙" }[ph] || "❓"; }
    fertility() {
        const base = { ovulation: 0.25, follicular: 0.08, luteal: 0.02, menstruation: 0.01 }[this.phase()] || 0.05;
        let bonus = 0;
        const s = S();
        if (s.modules.auOverlay && s.auPreset === "omegaverse" && this.p.heat?.active) bonus = s.auSettings.omegaverse.heatFertilityBonus;
        return Math.min(base + bonus, 0.95);
    }
    libido() {
        if (this.p.heat?.active || this.p.rut?.active) return "экстремальное";
        return { ovulation: "высокое", follicular: "среднее", luteal: "низкое", menstruation: "низкое" }[this.phase()] || "среднее";
    }
    symptoms() {
        const ph = this.phase(), r = [];
        if (ph === "menstruation") r.push("кровотечение", "спазмы");
        if (ph === "ovulation") r.push("↑ либидо");
        if (ph === "luteal") r.push("ПМС");
        if (ph === "follicular") r.push("прилив энергии");
        return r;
    }
    discharge() { return { menstruation: "менструальные", follicular: "скудные", ovulation: "обильные", luteal: "густые" }[this.phase()] || "обычные"; }
    advance(days) {
        for (let i = 0; i < days; i++) {
            this.c.currentDay++;
            if (this.c.currentDay > this.c.length) {
                this.c.currentDay = 1; this.c.cycleCount++;
                if (this.c.irregularity > 0) this.c.length = clamp(this.c.baseLength + Math.floor(Math.random() * this.c.irregularity * 2) - this.c.irregularity, 21, 45);
            }
        }
    }
    setDay(d) { this.c.currentDay = clamp(d, 1, this.c.length); }
    setPhase(ph) { const ov = Math.round(this.c.length - 14); const map = { menstruation: 1, follicular: this.c.menstruationDuration + 1, ovulation: ov, luteal: ov + 2 }; if (map[ph]) this.c.currentDay = map[ph]; }
}

class HeatRutManager {
    constructor(p) { this.p = p; }
    static HP = { preHeat: "Предтечка", heat: "Течка", postHeat: "Посттечка", rest: "Покой" };
    static RP = { preRut: "Предгон", rut: "Гон", postRut: "Постгон", rest: "Покой" };
    hPhase() { const h = this.p.heat; if (!h) return "rest"; if (h.active) { if (h.currentDay <= 1) return "preHeat"; if (h.currentDay <= h.duration - 1) return "heat"; return "postHeat"; } if ((h.cycleDays - (h.daysSinceLast || 0)) <= 3) return "preHeat"; return "rest"; }
    rPhase() { const r = this.p.rut; if (!r) return "rest"; if (r.active) { if (r.currentDay <= 1) return "preRut"; if (r.currentDay <= r.duration - 1) return "rut"; return "postRut"; } if ((r.cycleDays - (r.daysSinceLast || 0)) <= 3) return "preRut"; return "rest"; }
    hSym() { const p = this.hPhase(); if (p === "preHeat") return ["жар", "беспокойство"]; if (p === "heat") return ["сильный жар", "самосмазка", "феромоны", "затуманенность"]; if (p === "postHeat") return ["усталость"]; return []; }
    rSym() { const p = this.rPhase(); if (p === "preRut") return ["раздражительность", "агрессия"]; if (p === "rut") return ["экстремальная агрессия", "набухание узла", "влечение"]; if (p === "postRut") return ["усталость"]; return []; }
    hLeft() { const h = this.p.heat; if (!h || h.active) return 0; return Math.max(0, h.cycleDays - (h.daysSinceLast || 0)); }
    rLeft() { const r = this.p.rut; if (!r || r.active) return 0; return Math.max(0, r.cycleDays - (r.daysSinceLast || 0)); }
    advH(d) { const h = this.p.heat; if (!h || h.onSuppressants) return; const a = S().auSettings?.omegaverse; h.cycleDays = a?.heatCycleLength || 30; h.duration = a?.heatDuration || 5; for (let i = 0; i < d; i++) { if (h.active) { h.currentDay++; if (h.currentDay > h.duration) { h.active = false; h.currentDay = 0; h.daysSinceLast = 0; } } else { h.daysSinceLast = (h.daysSinceLast || 0) + 1; if (h.daysSinceLast >= h.cycleDays) { h.active = true; h.currentDay = 1; h.intensity = "severe"; } } } }
    advR(d) { const r = this.p.rut; if (!r) return; const a = S().auSettings?.omegaverse; r.cycleDays = a?.rutCycleLength || 35; r.duration = a?.rutDuration || 4; for (let i = 0; i < d; i++) { if (r.active) { r.currentDay++; if (r.currentDay > r.duration) { r.active = false; r.currentDay = 0; r.daysSinceLast = 0; } } else { r.daysSinceLast = (r.daysSinceLast || 0) + 1; if (r.daysSinceLast >= r.cycleDays) { r.active = true; r.currentDay = 1; } } } }
}

class PregManager {
    constructor(p) { this.p = p; this.pr = p.pregnancy; }
    active() { return this.pr?.active; }
    start(father, count, sexes) {
        const s = S(); this.pr.active = true; this.pr.week = 1; this.pr.day = 0;
        this.pr.father = father; this.pr.fetusCount = count || 1;
        this.pr.fetusSexes = sexes || [];
        while (this.pr.fetusSexes.length < this.pr.fetusCount) this.pr.fetusSexes.push(Math.random() < 0.5 ? "M" : "F");
        this.pr.complications = []; this.pr.complicationsEnabled = true; this.pr.weightGain = 0;
        let mw = 40;
        if (s.modules.auOverlay && s.auPreset === "omegaverse") mw = s.auSettings.omegaverse.pregnancyWeeks || 36;
        if (count > 1) mw = Math.max(28, mw - (count - 1) * 3);
        this.pr.maxWeeks = mw; if (this.p.cycle) this.p.cycle.enabled = false;
    }
    advDay(d) { if (!this.active()) return; this.pr.day += d; while (this.pr.day >= 7) { this.pr.day -= 7; this.pr.week++; } this.pr.weightGain = this._wg(); }
    tri() { return this.pr.week <= 12 ? 1 : this.pr.week <= 27 ? 2 : 3; }
    size() { const map = [[4, "маковое зерно"], [8, "малина"], [12, "лайм"], [16, "авокадо"], [20, "банан"], [28, "баклажан"], [36, "дыня"], [40, "арбуз"]]; let r = "эмбрион"; for (const [w, n] of map) if (this.pr.week >= w) r = n; return r; }
    symptoms() { const w = this.pr.week, r = []; if (w >= 4 && w <= 14) r.push("тошнота"); if (w >= 14) r.push("рост живота"); if (w >= 18) r.push("шевеления"); if (w >= 28) r.push("одышка"); if (w >= 32) r.push("трен. схватки"); return r; }
    moves() { const w = this.pr.week; if (w < 16) return "нет"; if (w < 22) return "бабочки"; if (w < 28) return "толчки"; return "активные"; }
    _wg() { const w = this.pr.week; let b = w <= 12 ? w * 0.2 : w <= 27 ? 2.4 + (w - 12) * 0.45 : 9.15 + (w - 27) * 0.4; return Math.round(b * (1 + (this.pr.fetusCount - 1) * 0.3) * 10) / 10; }
}

const LABOR_STAGES = ["latent", "active", "transition", "pushing", "birth", "placenta"];
const LABOR_LABELS = { latent: "Латентная", active: "Активная", transition: "Переходная", pushing: "Потуги", birth: "Рождение", placenta: "Плацента" };

class LaborManager {
    constructor(p) { this.p = p; this.l = p.labor; }
    start(diff) { this.l.active = true; this.l.stage = "latent"; this.l.dilation = 0; this.l.hoursElapsed = 0; this.l.babiesDelivered = 0; this.l.totalBabies = this.p.pregnancy?.fetusCount || 1; this.l.difficulty = diff || "normal"; this.l.complications = []; this.l.complicationsEnabled = true; }
    advance() { const i = LABOR_STAGES.indexOf(this.l.stage); if (i >= LABOR_STAGES.length - 1) return; this.l.stage = LABOR_STAGES[i + 1]; if (this.l.stage === "active") { this.l.dilation = 5; this.l.hoursElapsed += 5; } if (this.l.stage === "transition") { this.l.dilation = 8; this.l.hoursElapsed += 2; } if (this.l.stage === "pushing") this.l.dilation = 10; }
    desc() { return { latent: "Лёгкие схватки, 0-3 см", active: "Сильные схватки, 4-7 см", transition: "Пик, 7-10 см, дрожь", pushing: "Полное раскрытие, потуги", birth: "Рождение ребёнка", placenta: "Рождение плаценты" }[this.l.stage] || ""; }
    deliver() { this.l.babiesDelivered++; if (this.l.babiesDelivered >= this.l.totalBabies) this.l.stage = "placenta"; }
    end() { this.l.active = false; this.p.pregnancy.active = false; if (this.p.cycle) { this.p.cycle.enabled = true; this.p.cycle.currentDay = 1; } }
}

class BabyManager {
    constructor(b) { this.b = b; }
    static gen(mo, fa, ov) {
        const s = S(), fp = s.characters[fa]; const sex = ov?.sex || (Math.random() < 0.5 ? "M" : "F");
        let sec = ov?.secondarySex || null;
        if (!sec && s.modules.auOverlay && s.auPreset === "omegaverse") { const r = Math.random(); sec = r < 0.25 ? "alpha" : r < 0.75 ? "beta" : "omega"; }
        const bw = 3200 + Math.floor(Math.random() * 800) - 400;
        return { name: ov?.name || "", sex, secondarySex: sec, birthWeight: mo?.pregnancy?.fetusCount > 1 ? Math.round(bw * 0.85) : bw, currentWeight: bw, ageDays: ov?.ageDays || 0, eyeColor: ov?.eyeColor || (Math.random() < 0.5 ? (mo?.eyeColor || "") : (fp?.eyeColor || "")), hairColor: ov?.hairColor || (Math.random() < 0.5 ? (mo?.hairColor || "") : (fp?.hairColor || "")), mother: mo?.name || ov?.mother || "?", father: fa || ov?.father || "?", nonHumanFeatures: [], state: "новорождённый", birthDate: { ...s.worldDate } };
    }
    age() { const d = this.b.ageDays; if (d < 1) return "новорождённый"; if (d < 7) return d + " дн."; if (d < 30) return Math.floor(d / 7) + " нед."; if (d < 365) return Math.floor(d / 30) + " мес."; const y = Math.floor(d / 365), m = Math.floor((d % 365) / 30); return m > 0 ? y + " г. " + m + " мес." : y + " г."; }
    milestones() { const d = this.b.ageDays, r = []; if (d >= 42) r.push("улыбка"); if (d >= 90) r.push("голову"); if (d >= 180) r.push("сидит"); if (d >= 365) r.push("ходит"); if (d >= 730) r.push("бегает"); return r; }
    update() { this.b.currentWeight = this.b.birthWeight + this.b.ageDays * (this.b.ageDays < 120 ? 30 : 7); if (this.b.ageDays < 28) this.b.state = "новорождённый"; else if (this.b.ageDays < 365) this.b.state = "младенец"; else if (this.b.ageDays < 1095) this.b.state = "малыш"; else this.b.state = "ребёнок"; }
}

class OviManager {
    constructor(p) { this.p = p; if (!p.oviposition) p.oviposition = { active: false, phase: "none", eggCount: 0, fertilizedCount: 0, gestationDay: 0, gestationMax: 14, layingDay: 0, layingMax: 3, incubationDay: 0, incubationMax: 21, eggs: [] }; this.o = p.oviposition; }
    static PHASES = { none: "Нет", carrying: "Вынашивание", laying: "Откладывание", incubating: "Инкубация", hatched: "Вылупление" };
    startCarrying(count, father) { const cfg = S().auSettings.oviposition; const c = count || (cfg.eggCountMin + Math.floor(Math.random() * (cfg.eggCountMax - cfg.eggCountMin + 1))); this.o.active = true; this.o.phase = "carrying"; this.o.eggCount = c; this.o.gestationDay = 0; this.o.gestationMax = cfg.gestationDays || 14; this.o.layingMax = cfg.layingDuration || 3; this.o.incubationMax = cfg.incubationDays || 21; this.o.eggs = []; for (let i = 0; i < c; i++) this.o.eggs.push({ fertilized: Math.random() < (cfg.fertilizationChance || 0.7), size: 10 + Math.floor(Math.random() * 10), shell: cfg.shellType || "hard", father: father || "?" }); this.o.fertilizedCount = this.o.eggs.filter(e => e.fertilized).length; if (this.p.cycle) this.p.cycle.enabled = false; }
    advance(days) { if (!this.o.active) return; for (let i = 0; i < days; i++) { if (this.o.phase === "carrying") { this.o.gestationDay++; if (this.o.gestationDay >= this.o.gestationMax) { this.o.phase = "laying"; this.o.layingDay = 0; } } else if (this.o.phase === "laying") { this.o.layingDay++; if (this.o.layingDay >= this.o.layingMax) { this.o.phase = "incubating"; this.o.incubationDay = 0; if (this.p.cycle) this.p.cycle.enabled = true; } } else if (this.o.phase === "incubating") { this.o.incubationDay++; if (this.o.incubationDay >= this.o.incubationMax) this.o.phase = "hatched"; } } }
    symptoms() { if (this.o.phase === "carrying") return ["тяжесть", "давление", "живот увеличивается"]; if (this.o.phase === "laying") return ["спазмы", "расширение путей"]; if (this.o.phase === "incubating") return ["защита гнезда", "повышенная температура"]; return []; }
    progress() { if (this.o.phase === "carrying") return Math.round((this.o.gestationDay / this.o.gestationMax) * 100); if (this.o.phase === "laying") return Math.round((this.o.layingDay / this.o.layingMax) * 100); if (this.o.phase === "incubating") return Math.round((this.o.incubationDay / this.o.incubationMax) * 100); return 100; }
    end() { this.o.active = false; this.o.phase = "none"; this.o.eggs = []; if (this.p.cycle) this.p.cycle.enabled = true; }
    promptText() { if (!this.o.active) return ""; if (this.o.phase === "carrying") return `CARRYING ${this.o.eggCount} EGGS (${this.o.fertilizedCount} fertile), Day ${this.o.gestationDay}/${this.o.gestationMax}. ${this.symptoms().join(", ")}`; if (this.o.phase === "laying") return `LAYING EGGS Day ${this.o.layingDay}/${this.o.layingMax}. ${this.symptoms().join(", ")}`; if (this.o.phase === "incubating") return `INCUBATING ${this.o.fertilizedCount} eggs, Day ${this.o.incubationDay}/${this.o.incubationMax}`; if (this.o.phase === "hatched") return `HATCHING! ${this.o.fertilizedCount} offspring.`; return ""; }
}

// ==========================================
// 8. INTIMACY + RELS + PROFILES + PROMPT
// ==========================================

const Intimacy = {
    log(e) { const s = S(); e.ts = fmt(s.worldDate); s.intimacyLog.push(e); if (s.intimacyLog.length > 100) s.intimacyLog = s.intimacyLog.slice(-100); saveSettingsDebounced(); },
    roll(tg, d) {
        const s = S(), p = s.characters[tg];
        if (!p || !canGetPregnant(p)) return { result: false, chance: 0, roll: 0, reason: "not_eligible" };
        let f = 0.05; if (p.cycle?.enabled) f = new CycleManager(p).fertility();
        const ce = { none: 0, condom: 0.85, pill: 0.91, iud: 0.99, withdrawal: 0.73 }[p.contraception] || 0;
        if (d.nc) { } else if (d.co) f *= 0.15; else f *= (1 - ce);
        if (d.ej === "outside") f *= 0.05; if (d.tp === "anal" || d.tp === "oral") f = 0;
        if (p.pregnancy?.active || p.oviposition?.active) f = 0;
        const ch = Math.round(clamp(f, 0, 0.95) * 100), r = roll100(), res = r <= ch;
        const entry = { ts: fmt(s.worldDate), target: tg, parts: d.parts || [], chance: ch, roll: r, result: res, type: d.tp, ejac: d.ej, auto: d.auto || false };
        s.diceLog.push(entry); if (s.diceLog.length > 50) s.diceLog = s.diceLog.slice(-50); saveSettingsDebounced(); return entry;
    },
};

const REL_TYPES = ["мать", "отец", "ребёнок", "партнёр", "супруг(а)", "брат", "сестра", "дедушка", "бабушка", "внук", "внучка", "друг", "возлюбленный(ая)", "другое"];
const Rels = {
    get() { return S().relationships || []; },
    add(c1, c2, type, notes) { const s = S(); if (!s.relationships) s.relationships = []; if (s.relationships.find(r => r.char1 === c1 && r.char2 === c2 && r.type === type)) return; s.relationships.push({ id: uid(), char1: c1, char2: c2, type, notes: notes || "" }); saveSettingsDebounced(); },
    remove(id) { const s = S(); s.relationships = (s.relationships || []).filter(r => r.id !== id); saveSettingsDebounced(); },
    getFor(n) { return (S().relationships || []).filter(r => r.char1 === n || r.char2 === n); },
    addBirth(mo, fa, baby) { if (mo) { this.add(mo, baby, "мать", ""); this.add(baby, mo, "ребёнок", ""); } if (fa && fa !== "?") { this.add(fa, baby, "отец", ""); this.add(baby, fa, "ребёнок", ""); } },
    toPrompt() { const r = this.get(); if (!r.length) return ""; return "Relationships:\n" + r.map(x => x.char1 + " → " + x.char2 + ": " + x.type).join("\n"); },
};

const Profiles = {
    id() { const ctx = getContext(); if (!ctx) return null; if (ctx.groupId) return "grp_" + ctx.groupId; if (ctx.characterId !== undefined && ctx.characters) { const c = ctx.characters[ctx.characterId]; if (c) return "chr_" + c.avatar + "_" + (ctx.chatId || "0"); } return null; },
    save() { const s = S(), cid = this.id(); if (!cid) return; s.currentChatId = cid; if (!s.chatProfiles) s.chatProfiles = {}; s.chatProfiles[cid] = { characters: JSON.parse(JSON.stringify(s.characters)), relationships: JSON.parse(JSON.stringify(s.relationships || [])), worldDate: { ...s.worldDate }, diceLog: [...(s.diceLog || [])], intimacyLog: [...(s.intimacyLog || [])], _ts: Date.now() }; saveSettingsDebounced(); },
    load() { const s = S(), cid = this.id(); if (!cid || s.currentChatId === cid) return false; if (s.currentChatId && Object.keys(s.characters).length > 0) { if (!s.chatProfiles) s.chatProfiles = {}; s.chatProfiles[s.currentChatId] = { characters: JSON.parse(JSON.stringify(s.characters)), relationships: JSON.parse(JSON.stringify(s.relationships || [])), worldDate: { ...s.worldDate }, diceLog: [...(s.diceLog || [])], intimacyLog: [...(s.intimacyLog || [])] }; } s.currentChatId = cid; if (s.chatProfiles?.[cid]) { const pr = s.chatProfiles[cid]; s.characters = JSON.parse(JSON.stringify(pr.characters || {})); s.relationships = JSON.parse(JSON.stringify(pr.relationships || [])); s.worldDate = { ...(pr.worldDate || DEFAULTS.worldDate) }; s.diceLog = [...(pr.diceLog || [])]; s.intimacyLog = [...(pr.intimacyLog || [])]; } else { s.characters = {}; s.relationships = []; s.diceLog = []; s.intimacyLog = []; } saveSettingsDebounced(); return true; },
    list() { return Object.entries(S().chatProfiles || {}).map(([id, p]) => ({ id, count: Object.keys(p.characters || {}).length, date: p.worldDate ? fmt(p.worldDate) : "—", isCurrent: id === S().currentChatId })); },
    del(id) { const s = S(); if (s.chatProfiles?.[id]) { delete s.chatProfiles[id]; saveSettingsDebounced(); } },
};

const Prompt = {
    gen() {
        const s = S(); if (!s.promptInjectionEnabled) return "";
        const lines = ["[BunnyCycle]", "Date: " + fmt(s.worldDate)];
        const rt = Rels.toPrompt(); if (rt) lines.push("\n" + rt);
        Object.entries(s.characters).forEach(([n, p]) => {
            if (!p._enabled) return; lines.push("\n--- " + n + " ---");
            lines.push("Sex: " + p.bioSex + (p.secondarySex ? " / " + p.secondarySex : ""));
            if (s.modules.auOverlay && s.auPreset === "omegaverse") { const hr = new HeatRutManager(p); if (p.heat?.active) lines.push("IN HEAT: " + hr.hSym().join(", ")); else if (p.secondarySex === "omega") lines.push("Heat in " + hr.hLeft() + "d"); if (p.rut?.active) lines.push("IN RUT: " + hr.rSym().join(", ")); else if (p.secondarySex === "alpha") lines.push("Rut in " + hr.rLeft() + "d"); }
            if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) { const cm = new CycleManager(p); lines.push("Cycle Day " + p.cycle.currentDay + "/" + p.cycle.length + " " + cm.label(cm.phase()) + ", Fert: " + Math.round(cm.fertility() * 100) + "%"); }
            if (s.modules.pregnancy && p.pregnancy?.active) { const pm = new PregManager(p); lines.push("PREGNANT Wk" + p.pregnancy.week + "/" + p.pregnancy.maxWeeks + " T" + pm.tri() + ", " + pm.size()); if (p.pregnancy.complications?.length > 0) lines.push("Comp: " + p.pregnancy.complications.join(", ")); }
            if (s.modules.labor && p.labor?.active) lines.push("LABOR: " + LABOR_LABELS[p.labor.stage] + " " + p.labor.dilation + "cm");
            if (s.auSettings.oviposition?.enabled && p.oviposition?.active) lines.push(new OviManager(p).promptText());
            if (s.modules.baby && p.babies?.length > 0) p.babies.forEach(b => lines.push("Child: " + (b.name || "?") + " (" + (b.sex === "M" ? "♂" : "♀") + ", " + new BabyManager(b).age() + ")"));
            if (p.contraception !== "none") lines.push("Contraception: " + p.contraception);
        });
        lines.push("\n[Reflect all states naturally.]\n[/BunnyCycle]"); return lines.join("\n");
    },
};

// ==========================================
// 9. MAKE PROFILE + GET ACTIVE + SYNC
// ==========================================

function makeProfile(name, isUser, sex) {
    const male = (sex || "F") === "M";
    return {
        name, bioSex: sex || "F", secondarySex: null, race: "human", contraception: "none",
        eyeColor: "", hairColor: "", pregnancyDifficulty: "normal",
        _isUser: isUser, _enabled: true, _canLayEggs: false,
        _mB: false, _mS: false, _mR: false, _mE: false, _mH: false, _mP: false, _mCyc: false,
        _sexSource: "", _sexConfidence: 0, _sexReasoning: "",
        cycle: { enabled: !male, currentDay: Math.floor(Math.random() * 28) + 1, baseLength: 28, length: 28, menstruationDuration: 5, irregularity: 2, symptomIntensity: "moderate", cycleCount: 0 },
        pregnancy: { active: false, week: 0, day: 0, maxWeeks: 40, father: null, fetusCount: 1, fetusSexes: [], complications: [], complicationsEnabled: true, weightGain: 0 },
        labor: { active: false, stage: "latent", dilation: 0, hoursElapsed: 0, babiesDelivered: 0, totalBabies: 1, difficulty: "normal", complications: [], complicationsEnabled: true },
        heat: { active: false, currentDay: 0, cycleDays: 30, duration: 5, intensity: "moderate", daysSinceLast: Math.floor(Math.random() * 25), onSuppressants: false },
        rut: { active: false, currentDay: 0, cycleDays: 35, duration: 4, intensity: "moderate", daysSinceLast: Math.floor(Math.random() * 30) },
        oviposition: null, babies: [],
    };
}

function getActive() {
    const ctx = getContext(), r = [];
    if (!ctx) return r;
    if (ctx.characterId !== undefined && ctx.characters) { const c = ctx.characters[ctx.characterId]; if (c) r.push({ name: c.name, obj: c, isUser: false }); }
    if (ctx.groups && ctx.groupId) { const g = ctx.groups.find(x => x.id === ctx.groupId); if (g?.members) for (const av of g.members) { const c = ctx.characters.find(y => y.avatar === av); if (c && !r.find(y => y.name === c.name)) r.push({ name: c.name, obj: c, isUser: false }); } }
    if (ctx.name1) r.push({ name: ctx.name1, obj: null, isUser: true });
    return r;
}

function _regexSex(text) {
    if (!text) return null; let fS = 0, mS = 0;
    if (/(?:пол|sex|gender)\s*[:=\-–—]\s*(?:f|ж|female|женский)/i.test(text)) fS += 100;
    if (/(?:пол|sex|gender)\s*[:=\-–—]\s*(?:m|м|male|мужской)/i.test(text)) mS += 100;
    if (/\b(?:female|woman|girl|девушка|женщина)\b/i.test(text)) fS += 10;
    if (/\b(?:male|man|boy|мужчина|парень)\b/i.test(text)) mS += 10;
    const clean = text.replace(/"[^"]*"/g, "").replace(/«[^»]*»/g, "");
    fS += (clean.match(/\b(she|her|она|её|ей)\b/gi) || []).length * 2;
    mS += (clean.match(/\b(he|him|он|его|ему)\b/gi) || []).length * 2;
    if (fS > mS && fS >= 4) return "F"; if (mS > fS && mS >= 4) return "M"; return null;
}

let _syncLock = false;
async function syncChars() {
    const s = S(); if (!s.autoSyncCharacters || _syncLock) return; _syncLock = true;
    try {
        const active = getActive(), ctx = getContext(), msgs = ctx?.chat || [];
        let changed = false;

        for (const c of active) {
            if (!s.characters[c.name]) { s.characters[c.name] = makeProfile(c.name, c.isUser, "F"); changed = true; }
            const pr = s.characters[c.name];
            if (pr._mB && pr._mE && pr._mH && pr._mR && pr._mS) continue;

            if (s.autoParseCharInfo && s.useLLMParsing) {
                const analysis = await CharAnalyzer.analyze(c.name, c.obj, c.isUser);
                if (analysis) {
                    if (analysis.biologicalSex && !pr._mB) { pr.bioSex = analysis.biologicalSex; pr._sexSource = "llm"; pr._sexConfidence = analysis.sexConfidence || 90; pr._sexReasoning = analysis.reasoning || ""; if (analysis.biologicalSex === "M" && !pr._mCyc) pr.cycle.enabled = false; if (analysis.biologicalSex === "F" && !pr._mCyc) pr.cycle.enabled = true; changed = true; }
                    if (analysis.secondarySex && !pr._mS) { pr.secondarySex = analysis.secondarySex; if (analysis.secondarySex === "omega" && pr.bioSex === "M") pr.cycle.enabled = true; changed = true; }
                    if (analysis.race && !pr._mR) { pr.race = analysis.race; changed = true; }
                    if (analysis.eyeColor && !pr._mE) { pr.eyeColor = analysis.eyeColor; changed = true; }
                    if (analysis.hairColor && !pr._mH) { pr.hairColor = analysis.hairColor; changed = true; }
                    if (analysis.canLayEggs) { pr._canLayEggs = true; changed = true; }
                }
            }
            if (!s.useLLMParsing && c.obj && !c.isUser && !pr._mB) {
                const txt = [c.obj.description, c.obj.data?.description, c.obj.personality, c.obj.data?.personality].filter(Boolean).join("\n");
                const sex = _regexSex(txt); if (sex) { pr.bioSex = sex; pr._sexSource = "regex"; pr._sexConfidence = 50; if (sex === "M" && !pr._mCyc) pr.cycle.enabled = false; changed = true; }
            }
        }

        if (s.parseFullChat && s.useLLMParsing && msgs.length > 0 && (ChatAnalyzer.shouldReanalyze(msgs) || !Object.keys(ChatAnalyzer._cache).length)) {
            const chatResult = await ChatAnalyzer.analyze(msgs, Object.keys(s.characters));
            if (chatResult) {
                if (chatResult.currentStates) {
                    for (const [name, st] of Object.entries(chatResult.currentStates)) {
                        const p = s.characters[name]; if (!p) continue;
                        if (st.pregnant && !p.pregnancy?.active && !p._mP && canGetPregnant(p)) { p.pregnancy.active = true; p.pregnancy.week = st.pregnancyWeek || 4; if (p.cycle) p.cycle.enabled = false; changed = true; }
                        if (st.hasGivenBirth && p.pregnancy?.active) { p.pregnancy.active = false; if (p.labor?.active) p.labor.active = false; if (p.cycle && (p.bioSex === "F" || p.secondarySex === "omega")) p.cycle.enabled = true; changed = true; }
                        if (st.pregnant === false && p.pregnancy?.active) { p.pregnancy.active = false; if (p.cycle) p.cycle.enabled = true; changed = true; }
                        if (st.inLabor && !p.labor?.active && p.pregnancy?.active) { p.labor.active = true; p.labor.stage = "active"; p.labor.dilation = 4; changed = true; }
                        if (st.inHeat && p.secondarySex === "omega" && !p.heat?.active) { p.heat.active = true; p.heat.currentDay = 1; changed = true; }
                        if (st.inRut && p.secondarySex === "alpha" && !p.rut?.active) { p.rut.active = true; p.rut.currentDay = 1; changed = true; }
                    }
                }
                if (chatResult.children) {
                    for (const child of chatResult.children) {
                        if (!child.exists || !child.name) continue;
                        const moP = child.mother && s.characters[child.mother];
                        const faP = child.father && s.characters[child.father];
                        const att = moP || faP; if (!att) continue;
                        const attN = moP ? child.mother : child.father;
                        if (!att.babies.find(b => b.name === child.name)) {
                            att.babies.push({ name: child.name, sex: child.sex || (Math.random() < 0.5 ? "M" : "F"), secondarySex: null, birthWeight: 3200, currentWeight: 5000, ageDays: 30, eyeColor: "", hairColor: "", mother: child.mother || "?", father: child.father || "?", nonHumanFeatures: [], state: "младенец", birthDate: { ...s.worldDate } });
                            Rels.addBirth(child.mother, child.father, child.name);
                            changed = true;
                        }
                    }
                }
            }
        }
        if (changed) saveSettingsDebounced();
    } finally { _syncLock = false; }
}

// ==========================================
// 10. HTML GENERATION
// ==========================================

function charOpts() {
    return Object.keys(S().characters).map(n => `<option value="${n}">${n}</option>`).join("");
}

function relTypeOpts() {
    return REL_TYPES.map(t => `<option value="${t}">${t}</option>`).join("");
}

function genHTML() {
    const s = S();
    return `
<div id="bunnycycle-panel" class="lifecycle-panel${s.panelCollapsed ? ' collapsed' : ''}">
    <div id="bunnycycle-header-toggle" class="lifecycle-header">
        <div class="lifecycle-header-title">
            <span class="lc-collapse-arrow">${s.panelCollapsed ? '▶' : '▼'}</span>
            <h3>🐰 BunnyCycle</h3>
            <span class="lc-version">v1.0.0</span>
        </div>
        <div class="lifecycle-header-actions">
            <label class="lc-switch"><input type="checkbox" id="lc-enabled" ${s.enabled ? 'checked' : ''}><span class="lc-switch-slider"></span></label>
        </div>
    </div>
    <div class="lifecycle-body">
        <div class="lc-dashboard">
            <div class="lc-dashboard-date" id="lc-dash-date"></div>
            <div id="lc-dash-items"></div>
        </div>
        <div class="lifecycle-tabs">
            <button class="lifecycle-tab active" data-tab="chars"><span class="tab-icon">👥</span>Перс</button>
            <button class="lifecycle-tab" data-tab="rels"><span class="tab-icon">💞</span>Семья</button>
            <button class="lifecycle-tab" data-tab="cycle"><span class="tab-icon">🔴</span>Цикл</button>
            <button class="lifecycle-tab" data-tab="hr"><span class="tab-icon">🔥</span>Течка</button>
            <button class="lifecycle-tab" data-tab="intim"><span class="tab-icon">💕</span>Интим</button>
            <button class="lifecycle-tab" data-tab="preg"><span class="tab-icon">🤰</span>Берем</button>
            <button class="lifecycle-tab" data-tab="labor"><span class="tab-icon">🏥</span>Роды</button>
            <button class="lifecycle-tab" data-tab="baby"><span class="tab-icon">👶</span>Дети</button>
            <button class="lifecycle-tab" data-tab="ovi"><span class="tab-icon">🥚</span>Яйца</button>
            <button class="lifecycle-tab" data-tab="profs"><span class="tab-icon">💾</span>Проф</button>
            <button class="lifecycle-tab" data-tab="settings"><span class="tab-icon">⚙️</span>Настр</button>
        </div>

        <div class="lifecycle-tab-content active" data-tab="chars">
            <div class="lc-btn-group" style="margin-bottom:8px">
                <button class="lc-btn lc-btn-primary" id="lc-sync">🔄 Синхр.</button>
                <button class="lc-btn" id="lc-add-m">➕ Вручную</button>
                <button class="lc-btn" id="lc-reparse">📖 AI-скан</button>
            </div>
            <div id="lc-char-list"></div>
            <div id="lc-char-editor" class="lc-editor hidden">
                <div class="lc-editor-title" id="lc-editor-title"></div>
                <div class="lc-editor-grid">
                    <div class="lc-editor-field"><label>Пол</label><select class="lc-select" id="lc-ed-bio"><option value="F">♀ Женский</option><option value="M">♂ Мужской</option></select></div>
                    <div class="lc-editor-field"><label>2й пол</label><select class="lc-select" id="lc-ed-sec"><option value="">—</option><option value="alpha">Alpha</option><option value="beta">Beta</option><option value="omega">Omega</option></select></div>
                    <div class="lc-editor-field"><label>Раса</label><select class="lc-select" id="lc-ed-race"><option value="human">Человек</option><option value="elf">Эльф</option><option value="orc">Орк</option><option value="demon">Демон</option><option value="vampire">Вампир</option><option value="dragon">Дракон</option><option value="neko">Неко</option></select></div>
                    <div class="lc-editor-field"><label>Контрацепция</label><select class="lc-select" id="lc-ed-contra"><option value="none">Нет</option><option value="condom">Презерватив</option><option value="pill">Таблетки</option><option value="iud">ВМС</option><option value="withdrawal">ППА</option></select></div>
                    <div class="lc-editor-field"><label>Глаза</label><input class="lc-input" id="lc-ed-eyes" placeholder="голубые"></div>
                    <div class="lc-editor-field"><label>Волосы</label><input class="lc-input" id="lc-ed-hair" placeholder="чёрные"></div>
                    <div class="lc-editor-field"><label>Сложность родов</label><select class="lc-select" id="lc-ed-diff"><option value="easy">Лёгкие</option><option value="normal">Обычные</option><option value="hard">Тяжёлые</option></select></div>
                    <div class="lc-editor-field"><label>Активен</label><input type="checkbox" id="lc-ed-on"></div>
                    <div class="lc-editor-field"><label>Цикл вкл</label><input type="checkbox" id="lc-ed-cyc"></div>
                    <div class="lc-editor-field"><label>Длина цикла</label><input type="number" class="lc-input" id="lc-ed-clen" min="21" max="45"></div>
                    <div class="lc-editor-field"><label>Дн. менстр.</label><input type="number" class="lc-input" id="lc-ed-mdur" min="2" max="10"></div>
                    <div class="lc-editor-field"><label>Нерегулярность</label><input type="number" class="lc-input" id="lc-ed-irreg" min="0" max="7"></div>
                </div>
                <div class="lc-editor-actions">
                    <button class="lc-btn lc-btn-success" id="lc-ed-save">💾 Сохранить</button>
                    <button class="lc-btn" id="lc-ed-cancel">Отмена</button>
                </div>
            </div>
        </div>

        <div class="lifecycle-tab-content" data-tab="rels">
            <div class="lc-row" style="margin-bottom:8px">
                <select class="lc-select lc-char-select" id="lc-rel-c1">${charOpts()}</select>
                <select class="lc-select" id="lc-rel-tp">${relTypeOpts()}</select>
                <select class="lc-select lc-char-select" id="lc-rel-c2">${charOpts()}</select>
                <input class="lc-input" id="lc-rel-n" placeholder="Заметка" style="max-width:100px">
                <button class="lc-btn lc-btn-sm" id="lc-rel-add">➕</button>
            </div>
            <div id="lc-rel-list"></div>
        </div>

        <div class="lifecycle-tab-content" data-tab="cycle">
            <select class="lc-select lc-char-select" id="lc-cyc-char" style="margin-bottom:6px">${charOpts()}</select>
            <div id="lc-cyc-panel"></div>
        </div>

        <div class="lifecycle-tab-content" data-tab="hr">
            <select class="lc-select lc-char-select" id="lc-hr-char" style="margin-bottom:6px">${charOpts()}</select>
            <div id="lc-hr-panel"></div>
        </div>

        <div class="lifecycle-tab-content" data-tab="intim">
            <div class="lc-section">
                <div class="lc-row"><label>Цель</label><select class="lc-select lc-char-select" id="lc-int-t">${charOpts()}</select></div>
                <div class="lc-row"><label>Партнёр</label><select class="lc-select lc-char-select" id="lc-int-p">${charOpts()}</select></div>
                <div class="lc-row"><label>Тип</label><select class="lc-select" id="lc-int-tp"><option value="vaginal">Вагинальный</option><option value="anal">Анальный</option><option value="oral">Оральный</option></select></div>
                <div class="lc-row"><label>Эякуляция</label><select class="lc-select" id="lc-int-ej"><option value="inside">Внутрь</option><option value="outside">Наружу</option><option value="unknown">Неизвестно</option></select></div>
                <div class="lc-btn-group"><button class="lc-btn" id="lc-int-log">📝 Записать</button><button class="lc-btn lc-btn-primary" id="lc-int-roll">🎲 Бросок</button></div>
            </div>
            <h4 style="margin-top:8px">🎲 Броски</h4>
            <div id="lc-dice-log" class="lc-scroll"></div>
            <h4 style="margin-top:8px">📝 Лог</h4>
            <div id="lc-intim-log" class="lc-scroll"></div>
        </div>

        <div class="lifecycle-tab-content" data-tab="preg">
            <select class="lc-select lc-char-select" id="lc-preg-char" style="margin-bottom:6px">${charOpts()}</select>
            <div id="lc-preg-panel"></div>
            <div class="lc-btn-group" style="margin-top:6px">
                <button class="lc-btn lc-btn-sm" id="lc-preg-adv">+1 нед.</button>
                <button class="lc-btn lc-btn-sm" id="lc-preg-set">Уст. нед.</button>
                <button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-preg-labor">→ Роды</button>
                <button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-preg-end">Прервать</button>
            </div>
        </div>

        <div class="lifecycle-tab-content" data-tab="labor">
            <select class="lc-select lc-char-select" id="lc-labor-char" style="margin-bottom:6px">${charOpts()}</select>
            <div id="lc-labor-panel"></div>
            <div class="lc-btn-group" style="margin-top:6px">
                <button class="lc-btn lc-btn-sm" id="lc-labor-adv">→ Стадия</button>
                <button class="lc-btn lc-btn-sm lc-btn-success" id="lc-labor-deliver">👶 Родить</button>
                <button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-labor-end">Завершить</button>
            </div>
        </div>

        <div class="lifecycle-tab-content" data-tab="baby">
            <div class="lc-row" style="margin-bottom:6px">
                <select class="lc-select lc-char-select" id="lc-baby-par">${charOpts()}</select>
                <button class="lc-btn lc-btn-sm" id="lc-baby-create">➕ Создать</button>
            </div>
            <div id="lc-baby-list"></div>
        </div>

        <div class="lifecycle-tab-content" data-tab="ovi">
            <select class="lc-select lc-char-select" id="lc-ovi-char" style="margin-bottom:6px">${charOpts()}</select>
            <div id="lc-ovi-panel"></div>
            <div class="lc-btn-group" style="margin-top:6px">
                <button class="lc-btn lc-btn-sm lc-btn-primary" id="lc-ovi-start">🥚 Начать</button>
                <button class="lc-btn lc-btn-sm" id="lc-ovi-adv">→ +1 день</button>
                <button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-ovi-end">Завершить</button>
            </div>
        </div>

        <div class="lifecycle-tab-content" data-tab="profs">
            <div class="lc-info-row" id="lc-prof-cur"></div>
            <div class="lc-btn-group" style="margin-bottom:6px">
                <button class="lc-btn lc-btn-sm lc-btn-success" id="lc-prof-save">💾 Сохранить</button>
                <button class="lc-btn lc-btn-sm" id="lc-prof-reload">🔄 Перезагрузить</button>
            </div>
            <div id="lc-prof-list"></div>
        </div>

        <div class="lifecycle-tab-content" data-tab="settings">
            <div class="lc-section">
                <h4>Модули</h4>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mc" ${s.modules.cycle?'checked':''}><span>🔴 Цикл</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mp" ${s.modules.pregnancy?'checked':''}><span>🤰 Беременность</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-ml" ${s.modules.labor?'checked':''}><span>🏥 Роды</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mb" ${s.modules.baby?'checked':''}><span>👶 Дети</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mi" ${s.modules.intimacy?'checked':''}><span>💕 Интимность</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mau" ${s.modules.auOverlay?'checked':''}><span>🌐 AU Оверлей</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-ovi-on" ${s.auSettings.oviposition.enabled?'checked':''}><span>🥚 Oviposition</span></label>
            </div>
            <div class="lc-section">
                <h4>Автоматизация</h4>
                <label class="lc-checkbox"><input type="checkbox" id="lc-sa" ${s.autoSyncCharacters?'checked':''}><span>Авто-синхр. персонажей</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-sp" ${s.autoParseCharInfo?'checked':''}><span>Авто-парсинг карточек</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-sllm" ${s.useLLMParsing?'checked':''}><span>🧠 AI-анализ (LLM)</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-sc" ${s.parseFullChat?'checked':''}><span>Парсинг чата</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-sd" ${s.autoDetectIntimacy?'checked':''}><span>Авто-детекция секса</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-sr" ${s.autoRollOnSex?'checked':''}><span>Авто-бросок</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-sw" ${s.showStatusWidget?'checked':''}><span>Виджет статуса</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-st" ${s.autoTimeProgress?'checked':''}><span>Авто-время</span></label>
            </div>
            <div class="lc-section">
                <h4>Промпт</h4>
                <label class="lc-checkbox"><input type="checkbox" id="lc-pon" ${s.promptInjectionEnabled?'checked':''}><span>Инъекция в промпт</span></label>
                <div class="lc-row"><label>Позиция</label><select class="lc-select" id="lc-ppos"><option value="authornote" ${s.promptInjectionPosition==='authornote'?'selected':''}>Author's Note</option><option value="system" ${s.promptInjectionPosition==='system'?'selected':''}>System</option></select></div>
                <div class="lc-row"><label>Детализация</label><select class="lc-select" id="lc-pdet"><option value="low" ${s.promptInjectionDetail==='low'?'selected':''}>Низкая</option><option value="medium" ${s.promptInjectionDetail==='medium'?'selected':''}>Средняя</option><option value="high" ${s.promptInjectionDetail==='high'?'selected':''}>Высокая</option></select></div>
                <div class="lc-row"><label>AU Пресет</label><select class="lc-select" id="lc-aup"><option value="realism" ${s.auPreset==='realism'?'selected':''}>Реализм</option><option value="omegaverse" ${s.auPreset==='omegaverse'?'selected':''}>Омегаверс</option><option value="fantasy" ${s.auPreset==='fantasy'?'selected':''}>Фэнтези</option></select></div>
            </div>
            <div class="lc-section">
                <h4>Дата мира</h4>
                <div class="lc-row">
                    <input type="number" class="lc-input" id="lc-dy" value="${s.worldDate.year}" style="width:70px">
                    <input type="number" class="lc-input" id="lc-dm" value="${s.worldDate.month}" min="1" max="12" style="width:45px">
                    <input type="number" class="lc-input" id="lc-dd" value="${s.worldDate.day}" min="1" max="31" style="width:45px">
                    <input type="number" class="lc-input" id="lc-dh" value="${s.worldDate.hour}" min="0" max="23" style="width:45px">
                    <button class="lc-btn lc-btn-sm" id="lc-da">Уст.</button>
                </div>
                <div class="lc-btn-group">
                    <button class="lc-btn lc-btn-sm" id="lc-d1">+1 день</button>
                    <button class="lc-btn lc-btn-sm" id="lc-d7">+7 дней</button>
                    <label class="lc-checkbox"><input type="checkbox" id="lc-df" ${s.worldDate.frozen?'checked':''}><span>❄️ Заморозить</span></label>
                </div>
            </div>
            <div class="lc-section">
                <h4>Данные</h4>
                <div class="lc-btn-group">
                    <button class="lc-btn lc-btn-sm" id="lc-exp">📤 Экспорт</button>
                    <button class="lc-btn lc-btn-sm" id="lc-imp">📥 Импорт</button>
                    <button class="lc-btn lc-btn-sm lc-btn-danger" id="lc-rst">🗑️ Сброс</button>
                </div>
            </div>
        </div>
    </div>
</div>`;
}

// ==========================================
// 11. RENDER FUNCTIONS
// ==========================================

function rebuild() { renderDash(); renderChars(); renderCycle(); renderHR(); renderPreg(); renderLabor(); renderBabies(); renderOvi(); renderRels(); renderProfs(); renderDice(); renderIntim(); updateSels(); }

function updateSels() {
    const opts = charOpts();
    document.querySelectorAll(".lc-char-select").forEach(sel => { const v = sel.value; sel.innerHTML = opts; if (Object.keys(S().characters).includes(v)) sel.value = v; });
}

function renderDash() {
    const s = S(), de = document.getElementById("lc-dash-date"), ie = document.getElementById("lc-dash-items");
    if (!de || !ie) return;
    de.textContent = "📅 " + fmt(s.worldDate) + (s.worldDate.frozen ? " ❄️" : "");
    let h = "";
    Object.entries(s.characters).forEach(([n, p]) => {
        if (!p._enabled) return; const tags = [];
        if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) { const cm = new CycleManager(p); tags.push(cm.emoji(cm.phase()) + cm.label(cm.phase())); }
        if (s.modules.pregnancy && p.pregnancy?.active) tags.push("🤰" + p.pregnancy.week + "н");
        if (p.labor?.active) tags.push("🏥"); if (p.heat?.active) tags.push("🔥");
        if (p.rut?.active) tags.push("💢"); if (p.oviposition?.active) tags.push("🥚");
        if (p.babies?.length > 0) tags.push("👶×" + p.babies.length);
        if (tags.length > 0) h += `<div class="lc-dash-item"><span class="lc-dash-name">${n}</span>${tags.join(" ")}</div>`;
    });
    ie.innerHTML = h || '<div class="lc-dash-empty">Нет данных</div>';
}

function renderChars() {
    const s = S(), el = document.getElementById("lc-char-list"); if (!el) return;
    let h = "";
    Object.entries(s.characters).forEach(([n, p]) => {
        const sx = p.bioSex === "F" ? "♀" : "♂";
        const sec = p.secondarySex ? " · " + p.secondarySex : "";
        const canP = canGetPregnant(p) ? " 🤰?" : "";
        const src = p._sexSource ? `<span class="lc-tag lc-tag-auto">${p._sexSource} ${p._sexConfidence || "?"}%</span>` : "";
        h += `<div class="lc-char-card"><div class="lc-char-card-header"><span class="lc-char-card-name">${sx} ${n}${sec}${canP}</span> ${src}${p.eyeColor ? '<span class="lc-tag">👁️' + p.eyeColor + '</span>' : ''}${p.hairColor ? '<span class="lc-tag">💇' + p.hairColor + '</span>' : ''}</div><div class="lc-char-card-actions"><button class="lc-btn lc-btn-sm lc-edit-char" data-char="${n}">✏️</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-del-char" data-char="${n}">✕</button></div></div>`;
    });
    el.innerHTML = h || '<div class="lc-empty">Нажмите "🔄 Синхр."</div>';
}

function renderCycle() {
    const s = S(), el = document.getElementById("lc-cyc-panel"), sel = document.getElementById("lc-cyc-char");
    if (!el || !sel) return; const p = s.characters[sel.value];
    if (!p?.cycle?.enabled || p.pregnancy?.active) { el.innerHTML = '<div class="lc-empty">Цикл отключён</div>'; return; }
    const cm = new CycleManager(p), ph = cm.phase(), f = cm.fertility();
    let fc = "low"; if (f >= 0.2) fc = "peak"; else if (f >= 0.1) fc = "high"; else if (f >= 0.05) fc = "med";
    let cal = '<div class="lc-cycle-calendar">';
    for (let d = 1; d <= p.cycle.length; d++) {
        const ov = Math.round(p.cycle.length - 14); let cls = "lut";
        if (d <= p.cycle.menstruationDuration) cls = "mens"; else if (d < ov - 2) cls = "foll"; else if (d <= ov + 1) cls = "ovul";
        cal += `<div class="lc-cal-day ${cls}${d === p.cycle.currentDay ? ' today' : ''}">${d}</div>`;
    }
    cal += '</div>';
    el.innerHTML = cal + `<div class="lc-cycle-info"><div class="lc-info-row"><span class="lc-label">Фаза:</span> ${cm.emoji(ph)} ${cm.label(ph)}</div><div class="lc-info-row"><span class="lc-label">Фертильность:</span> <span class="lc-fert-badge ${fc}">${Math.round(f * 100)}%</span></div><div class="lc-info-row"><span class="lc-label">Либидо:</span> ${cm.libido()} | <span class="lc-label">Выделения:</span> ${cm.discharge()}</div>${cm.symptoms().length > 0 ? '<div class="lc-info-row"><span class="lc-label">Симптомы:</span> ' + cm.symptoms().join(", ") + '</div>' : ''}<div class="lc-row" style="margin-top:6px"><input type="number" class="lc-input" id="lc-cyc-day" min="1" max="${p.cycle.length}" style="width:60px"><button class="lc-btn lc-btn-sm" id="lc-cyc-setday">Уст.</button><button class="lc-btn lc-btn-sm" id="lc-cyc-mens">→Менстр.</button><button class="lc-btn lc-btn-sm" id="lc-cyc-foll">→Фолл.</button><button class="lc-btn lc-btn-sm" id="lc-cyc-ovul">→Овул.</button><button class="lc-btn lc-btn-sm" id="lc-cyc-lut">→Лют.</button><button class="lc-btn lc-btn-sm" id="lc-cyc-skip">Пропуск</button></div></div>`;
    const dayInput = document.getElementById("lc-cyc-day"); if (dayInput) dayInput.value = p.cycle.currentDay;
}

function renderHR() {
    const s = S(), el = document.getElementById("lc-hr-panel"), sel = document.getElementById("lc-hr-char");
    if (!el || !sel) return; const p = s.characters[sel.value];
    if (!p || !s.modules.auOverlay || s.auPreset !== "omegaverse" || !p.secondarySex) { el.innerHTML = '<div class="lc-empty">AU Омегаверс не активен</div>'; return; }
    const hr = new HeatRutManager(p); let h = "";
    if (p.secondarySex === "omega") {
        h += `<div class="lc-section"><h4>🔥 Течка: ${HeatRutManager.HP[hr.hPhase()]}</h4>`;
        if (p.heat?.active) h += `<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill heat" style="width:${Math.round((p.heat.currentDay / p.heat.duration) * 100)}%"></div></div>`;
        else h += `<div class="lc-info-row">До течки: ${hr.hLeft()} дн.</div>`;
        const hs = hr.hSym(); if (hs.length) h += `<div class="lc-info-row"><span class="lc-label">Симптомы:</span> ${hs.join(", ")}</div>`;
        h += `<div class="lc-btn-group" style="margin-top:4px"><button class="lc-btn lc-btn-sm" id="lc-hr-th">🔥 Запуск</button><button class="lc-btn lc-btn-sm" id="lc-hr-sh">⏹ Стоп</button><button class="lc-btn lc-btn-sm" id="lc-hr-su">💊 Супресс.</button></div></div>`;
    }
    if (p.secondarySex === "alpha") {
        h += `<div class="lc-section"><h4>💢 Гон: ${HeatRutManager.RP[hr.rPhase()]}</h4>`;
        if (p.rut?.active) h += `<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill rut" style="width:${Math.round((p.rut.currentDay / p.rut.duration) * 100)}%"></div></div>`;
        else h += `<div class="lc-info-row">До гона: ${hr.rLeft()} дн.</div>`;
        h += `<div class="lc-btn-group" style="margin-top:4px"><button class="lc-btn lc-btn-sm" id="lc-hr-tr">💢 Запуск</button><button class="lc-btn lc-btn-sm" id="lc-hr-sr">⏹ Стоп</button></div></div>`;
    }
    el.innerHTML = h; bindHR(p);
}

function renderPreg() {
    const s = S(), el = document.getElementById("lc-preg-panel"), sel = document.getElementById("lc-preg-char");
    if (!el || !sel) return; const p = s.characters[sel.value];
    if (!p?.pregnancy?.active) { el.innerHTML = '<div class="lc-empty">Нет беременности</div>'; return; }
    const pm = new PregManager(p), pr = p.pregnancy, prog = Math.round((pr.week / pr.maxWeeks) * 100);
    el.innerHTML = `<div class="lc-preg-header"><span class="lc-preg-week">Неделя ${pr.week}/${pr.maxWeeks}</span><span class="lc-preg-trim">Триместр ${pm.tri()}</span></div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:${prog}%"></div></div><div class="lc-info-row"><span class="lc-label">Размер:</span> ${pm.size()} | <span class="lc-label">Плодов:</span> ${pr.fetusCount} (${pr.fetusSexes.map(x => x === 'M' ? '♂' : '♀').join(",")})</div><div class="lc-info-row"><span class="lc-label">Шевеления:</span> ${pm.moves()} | <span class="lc-label">Набор:</span> +${pm._wg()} кг</div><div class="lc-info-row"><span class="lc-label">Симптомы:</span> ${pm.symptoms().join(", ") || "нет"}</div>${pr.complications?.length > 0 ? '<div class="lc-info-row"><span class="lc-label">Осложнения:</span> ' + pr.complications.join(", ") + '</div>' : ''}`;
}

function renderLabor() {
    const s = S(), el = document.getElementById("lc-labor-panel"), sel = document.getElementById("lc-labor-char");
    if (!el || !sel) return; const p = s.characters[sel.value];
    if (!p?.labor?.active) { el.innerHTML = '<div class="lc-empty">Роды не начались</div>'; return; }
    const lm = new LaborManager(p), prog = Math.round((p.labor.dilation / 10) * 100);
    el.innerHTML = `<div class="lc-labor-stage">${LABOR_LABELS[p.labor.stage]}</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:${prog}%"></div></div><div class="lc-info-row"><span class="lc-label">Раскрытие:</span> ${p.labor.dilation}/10 см | <span class="lc-label">Часов:</span> ${p.labor.hoursElapsed}</div><div class="lc-labor-desc">${lm.desc()}</div>`;
}

function renderBabies() {
    const s = S(), el = document.getElementById("lc-baby-list"), sel = document.getElementById("lc-baby-par");
    if (!el || !sel) return; const p = s.characters[sel.value];
    if (!p?.babies?.length) { el.innerHTML = '<div class="lc-empty">Нет детей</div>'; return; }
    el.innerHTML = p.babies.map((b, i) => {
        const bm = new BabyManager(b), ms = bm.milestones();
        return `<div class="lc-baby-card"><div class="lc-baby-header"><span class="lc-baby-name">${b.sex === 'M' ? '♂' : '♀'} ${b.name || '?'}</span><span class="lc-baby-sex">${bm.age()}</span></div><div class="lc-baby-details"><span class="lc-label">Вес:</span> ${Math.round(b.currentWeight)}г | <span class="lc-label">Мать:</span> ${b.mother} | <span class="lc-label">Отец:</span> ${b.father}${ms.length ? '<br><span class="lc-label">Вехи:</span> ' + ms.join(", ") : ''}</div><div class="lc-baby-actions"><button class="lc-btn lc-btn-sm lc-baby-edit" data-p="${sel.value}" data-i="${i}">✏️</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-baby-del" data-p="${sel.value}" data-i="${i}">✕</button></div></div>`;
    }).join("");
}

function renderOvi() {
    const s = S(), el = document.getElementById("lc-ovi-panel"), sel = document.getElementById("lc-ovi-char");
    if (!el || !sel) return; const p = s.characters[sel.value];
    if (!p?.oviposition?.active) { el.innerHTML = '<div class="lc-empty">Нет активной кладки</div>'; return; }
    const om = new OviManager(p), prog = om.progress(), sym = om.symptoms();
    el.innerHTML = `<div class="lc-ovi-phase">${OviManager.PHASES[p.oviposition.phase]}</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill ovi" style="width:${prog}%"></div></div><div class="lc-info-row"><span class="lc-label">Яиц:</span> ${p.oviposition.eggCount} (${p.oviposition.fertilizedCount} фертильных)</div>${sym.length ? '<div class="lc-info-row"><span class="lc-label">Симптомы:</span> ' + sym.join(", ") + '</div>' : ''}<div class="lc-ovi-eggs-grid">${p.oviposition.eggs.map((e, i) => `<div class="lc-ovi-egg-card ${e.fertilized ? 'fertilized' : 'unfertilized'}"><span class="lc-ovi-egg-icon">🥚</span><div class="lc-ovi-egg-info">#${i + 1} ${e.fertilized ? '✓' : '✗'}<br>${e.size}см</div></div>`).join("")}</div>`;
}

function renderRels() {
    const el = document.getElementById("lc-rel-list"); if (!el) return;
    const rels = S().relationships || [];
    if (!rels.length) { el.innerHTML = '<div class="lc-empty">Нет связей</div>'; return; }
    el.innerHTML = rels.map(r => `<div class="lc-dice-entry">${r.char1} → ${r.char2}: <strong>${r.type}</strong> ${r.notes ? '(' + r.notes + ')' : ''} <button class="lc-btn lc-btn-sm lc-btn-danger lc-del-rel" data-id="${r.id}">✕</button></div>`).join("");
    el.querySelectorAll(".lc-del-rel").forEach(b => b.addEventListener("click", function () { Rels.remove(this.dataset.id); renderRels(); }));
}

function renderProfs() {
    const s = S(), cur = document.getElementById("lc-prof-cur");
    if (cur) cur.textContent = "Текущий: " + (s.currentChatId || "—") + " (" + Object.keys(s.characters).length + " перс.)";
    const el = document.getElementById("lc-prof-list"); if (!el) return;
    const list = Profiles.list();
    if (!list.length) { el.innerHTML = '<div class="lc-empty">Нет профилей</div>'; return; }
    el.innerHTML = list.map(p => `<div class="lc-profile-card${p.isCurrent ? ' current' : ''}"><div class="lc-profile-card-info"><span class="lc-profile-card-name">${p.id.substring(0, 25)}</span><br>${p.count} перс. | ${p.date}</div><div class="lc-btn-group"><button class="lc-btn lc-btn-sm lc-prof-load" data-id="${p.id}">📂</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-prof-del" data-id="${p.id}">✕</button></div></div>`).join("");
}

function renderDice() {
    const el = document.getElementById("lc-dice-log"); if (!el) return;
    const d = S().diceLog;
    if (!d.length) { el.innerHTML = '<div class="lc-empty">Нет бросков</div>'; return; }
    el.innerHTML = [...d].reverse().slice(0, 20).map(e => `<div class="lc-dice-entry ${e.result ? 'lc-dice-success' : 'lc-dice-fail'}"><span class="lc-dice-ts">${e.ts}</span> ${e.target}: 🎲${e.roll}/${e.chance}% → ${e.result ? '✓ ЗАЧАТИЕ' : '✗ нет'}</div>`).join("");
}

function renderIntim() {
    const el = document.getElementById("lc-intim-log"); if (!el) return;
    const d = S().intimacyLog;
    if (!d.length) { el.innerHTML = '<div class="lc-empty">Нет записей</div>'; return; }
    el.innerHTML = [...d].reverse().slice(0, 20).map(e => `<div class="lc-intim-entry"><span class="lc-intim-ts">${e.ts}</span> ${(e.parts || []).join("+")} ${e.type || ""} ${e.ejac || ""} ${e.auto ? '🤖' : ''}</div>`).join("");
}

// ==========================================
// 12. POPUPS
// ==========================================

function showDicePopup(res, tg, auto) {
    document.querySelector(".lc-overlay")?.remove(); document.querySelector(".lc-popup")?.remove();
    const cls = res.result ? "success" : "fail";
    const ov = document.createElement("div"); ov.className = "lc-overlay";
    const po = document.createElement("div"); po.className = "lc-popup";
    po.innerHTML = `<div class="lc-popup-title">🎲 Бросок на зачатие</div>${auto ? '<div class="lc-popup-auto">Авто-детекция</div>' : ''}<div class="lc-popup-details"><strong>Цель:</strong> ${tg}<br><strong>Шанс:</strong> ${res.chance}%</div><div class="lc-popup-result ${cls}">${res.roll} / ${res.chance}</div><div class="lc-popup-verdict ${cls}">${res.result ? '✓ ЗАЧАТИЕ!' : '✗ Не в этот раз'}</div><div class="lc-popup-actions"><button class="lc-btn lc-btn-success" id="lc-dp-ok">✓ OK</button><button class="lc-btn" id="lc-dp-re">🎲 Ребросок</button><button class="lc-btn lc-btn-danger" id="lc-dp-no">✕ Отмена</button></div>`;
    document.body.appendChild(ov); document.body.appendChild(po);
    document.getElementById("lc-dp-ok").addEventListener("click", () => { if (res.result) { const p = S().characters[tg]; if (p && canGetPregnant(p)) { new PregManager(p).start(res.parts?.find(x => x !== tg) || "?", 1); saveSettingsDebounced(); rebuild(); } } ov.remove(); po.remove(); });
    document.getElementById("lc-dp-re").addEventListener("click", () => { ov.remove(); po.remove(); const nr = Intimacy.roll(tg, { parts: res.parts, tp: res.type, ej: res.ejac, auto }); showDicePopup(nr, tg, auto); });
    document.getElementById("lc-dp-no").addEventListener("click", () => { ov.remove(); po.remove(); });
    ov.addEventListener("click", () => { ov.remove(); po.remove(); });
}

function showBabyForm(parent, father, existing, idx, standalone) {
    const s = S(), isEdit = !!existing, b = existing || {};
    document.querySelector(".lc-overlay")?.remove(); document.querySelector(".lc-popup")?.remove();
    const ov = document.createElement("div"); ov.className = "lc-overlay";
    const fm = document.createElement("div"); fm.className = "lc-popup"; fm.style.maxWidth = "420px";
    fm.innerHTML = `<div class="lc-popup-title">${isEdit ? '✏️ Редактировать' : '👶 Новый ребёнок'}</div><div class="lc-editor-grid"><div class="lc-editor-field"><label>Имя</label><input class="lc-input" id="lc-bf-name" value="${b.name || ''}"></div><div class="lc-editor-field"><label>Пол</label><select class="lc-select" id="lc-bf-sex"><option value="random">🎲</option><option value="M" ${b.sex === 'M' ? 'selected' : ''}>♂</option><option value="F" ${b.sex === 'F' ? 'selected' : ''}>♀</option></select></div><div class="lc-editor-field"><label>2й пол</label><select class="lc-select" id="lc-bf-sec"><option value="random">🎲</option><option value="alpha">α</option><option value="beta">β</option><option value="omega">Ω</option><option value="">—</option></select></div><div class="lc-editor-field"><label>Глаза</label><input class="lc-input" id="lc-bf-eyes" value="${b.eyeColor || ''}"></div><div class="lc-editor-field"><label>Волосы</label><input class="lc-input" id="lc-bf-hair" value="${b.hairColor || ''}"></div>${isEdit ? '<div class="lc-editor-field"><label>Возраст (дни)</label><input type="number" class="lc-input" id="lc-bf-age" value="' + (b.ageDays || 0) + '"></div>' : ''}${standalone ? '<div class="lc-editor-field"><label>Мать</label><select class="lc-select lc-char-select" id="lc-bf-mo">' + charOpts() + '</select></div><div class="lc-editor-field"><label>Отец</label><select class="lc-select lc-char-select" id="lc-bf-fa">' + charOpts() + '</select></div><div class="lc-editor-field"><label>Записать к</label><select class="lc-select lc-char-select" id="lc-bf-to">' + charOpts() + '</select></div>' : ''}</div><div class="lc-popup-actions"><button class="lc-btn lc-btn-success" id="lc-bf-save">💾</button><button class="lc-btn" id="lc-bf-cancel">Отмена</button></div>`;
    document.body.appendChild(ov); document.body.appendChild(fm);
    document.getElementById("lc-bf-save").addEventListener("click", () => {
        const name = document.getElementById("lc-bf-name").value.trim() || "Малыш";
        let sex = document.getElementById("lc-bf-sex").value; if (sex === "random") sex = Math.random() < 0.5 ? "M" : "F";
        let sec = document.getElementById("lc-bf-sec").value; if (sec === "random") { const r = Math.random(); sec = r < 0.25 ? "alpha" : r < 0.75 ? "beta" : "omega"; }
        const eyes = document.getElementById("lc-bf-eyes").value.trim(), hair = document.getElementById("lc-bf-hair").value.trim();
        if (isEdit) { const baby = s.characters[parent]?.babies?.[idx]; if (baby) { baby.name = name; baby.sex = sex; baby.secondarySex = sec || null; if (eyes) baby.eyeColor = eyes; if (hair) baby.hairColor = hair; const ageEl = document.getElementById("lc-bf-age"); if (ageEl) { baby.ageDays = parseInt(ageEl.value) || 0; new BabyManager(baby).update(); } saveSettingsDebounced(); rebuild(); } }
        else if (standalone) { const mo = document.getElementById("lc-bf-mo")?.value || "?", fa = document.getElementById("lc-bf-fa")?.value || "?", to = document.getElementById("lc-bf-to")?.value; if (to && s.characters[to]) { const baby = BabyManager.gen(s.characters[mo], fa, { name, sex, secondarySex: sec || null, eyeColor: eyes, hairColor: hair }); baby.mother = mo; baby.father = fa; s.characters[to].babies.push(baby); Rels.addBirth(mo, fa, name); saveSettingsDebounced(); rebuild(); toastr.success("Создан: " + name); } }
        else { const mo = s.characters[parent]; if (mo) { const baby = BabyManager.gen(mo, father, { name, sex, secondarySex: sec || null, eyeColor: eyes, hairColor: hair }); mo.babies.push(baby); Rels.addBirth(parent, father, name); const lm = new LaborManager(mo); lm.deliver(); if (lm.l.babiesDelivered >= lm.l.totalBabies) lm.end(); saveSettingsDebounced(); rebuild(); toastr.success("Родился: " + name); } }
        ov.remove(); fm.remove();
    });
    document.getElementById("lc-bf-cancel").addEventListener("click", () => { ov.remove(); fm.remove(); });
    ov.addEventListener("click", () => { ov.remove(); fm.remove(); });
}

// ==========================================
// 13. EDITOR
// ==========================================

let editName = null;
function openEditor(name) {
    const s = S(), p = s.characters[name]; if (!p) return; editName = name;
    document.getElementById("lc-char-editor")?.classList.remove("hidden");
    document.getElementById("lc-editor-title").textContent = "✏️ " + name;
    document.getElementById("lc-ed-bio").value = p.bioSex;
    document.getElementById("lc-ed-sec").value = p.secondarySex || "";
    document.getElementById("lc-ed-race").value = p.race || "human";
    document.getElementById("lc-ed-contra").value = p.contraception;
    document.getElementById("lc-ed-eyes").value = p.eyeColor;
    document.getElementById("lc-ed-hair").value = p.hairColor;
    document.getElementById("lc-ed-diff").value = p.pregnancyDifficulty;
    document.getElementById("lc-ed-on").checked = p._enabled !== false;
    document.getElementById("lc-ed-cyc").checked = p.cycle?.enabled;
    document.getElementById("lc-ed-clen").value = p.cycle?.baseLength || 28;
    document.getElementById("lc-ed-mdur").value = p.cycle?.menstruationDuration || 5;
    document.getElementById("lc-ed-irreg").value = p.cycle?.irregularity || 2;
}
function closeEditor() { editName = null; document.getElementById("lc-char-editor")?.classList.add("hidden"); }
function saveEditor() {
    if (!editName) return; const s = S(), p = s.characters[editName]; if (!p) return;
    p.bioSex = document.getElementById("lc-ed-bio").value; p._mB = true;
    p.secondarySex = document.getElementById("lc-ed-sec").value || null; p._mS = true;
    p.race = document.getElementById("lc-ed-race").value; p._mR = true;
    p.contraception = document.getElementById("lc-ed-contra").value;
    p.eyeColor = document.getElementById("lc-ed-eyes").value; p._mE = !!p.eyeColor;
    p.hairColor = document.getElementById("lc-ed-hair").value; p._mH = !!p.hairColor;
    p.pregnancyDifficulty = document.getElementById("lc-ed-diff").value;
    p._enabled = document.getElementById("lc-ed-on").checked;
    p.cycle.enabled = document.getElementById("lc-ed-cyc").checked; p._mCyc = true;
    const len = parseInt(document.getElementById("lc-ed-clen").value);
    if (len >= 21 && len <= 45) { p.cycle.baseLength = len; p.cycle.length = len; }
    p.cycle.menstruationDuration = parseInt(document.getElementById("lc-ed-mdur").value) || 5;
    p.cycle.irregularity = parseInt(document.getElementById("lc-ed-irreg").value) || 2;
    saveSettingsDebounced(); Profiles.save(); closeEditor(); rebuild();
    toastr.success(editName + ": сохранено!");
}

// ==========================================
// 14. STATUS WIDGET
// ==========================================

function genWidget() {
    const s = S(); if (!s.enabled || !s.showStatusWidget) return "";
    const chars = Object.entries(s.characters).filter(([_, p]) => p._enabled);
    if (!chars.length) return "";
    let h = '<div class="lc-status-widget"><div class="lc-sw-header"><span>🐰 BunnyCycle</span><span class="lc-sw-arrow">▼</span></div><div class="lc-sw-body"><div class="lc-sw-date">' + fmt(s.worldDate) + '</div>';
    for (const [n, p] of chars) {
        h += `<div class="lc-sw-char"><div class="lc-sw-char-name">${p.bioSex === 'F' ? '♀' : '♂'} ${n}${p.secondarySex ? ' <span class="lc-sw-sec-badge">' + p.secondarySex + '</span>' : ''}</div>`;
        if (s.modules.labor && p.labor?.active) {
            const prog = Math.round((p.labor.dilation / 10) * 100);
            h += `<div class="lc-sw-block lc-sw-labor-block"><div class="lc-sw-block-title">🏥 ${LABOR_LABELS[p.labor.stage]}</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:${prog}%"></div></div><div class="lc-sw-row">Раскрытие: ${p.labor.dilation}/10 см</div></div>`;
        } else if (s.modules.pregnancy && p.pregnancy?.active) {
            const pm = new PregManager(p), prog = Math.round((p.pregnancy.week / p.pregnancy.maxWeeks) * 100);
            h += `<div class="lc-sw-block lc-sw-preg-block"><div class="lc-sw-block-title">🤰 Неделя ${p.pregnancy.week}/${p.pregnancy.maxWeeks} (T${pm.tri()})</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:${prog}%"></div></div><div class="lc-sw-row">${pm.size()} | Движ: ${pm.moves()}</div></div>`;
        }
        if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.heat?.active) {
            h += `<div class="lc-sw-block lc-sw-heat-block"><div class="lc-sw-block-title">🔥 Течка</div><div class="lc-sw-symptoms">${new HeatRutManager(p).hSym().join(", ")}</div></div>`;
        }
        if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.rut?.active) {
            h += `<div class="lc-sw-block lc-sw-rut-block"><div class="lc-sw-block-title">💢 Гон</div><div class="lc-sw-symptoms">${new HeatRutManager(p).rSym().join(", ")}</div></div>`;
        }
        if (s.auSettings.oviposition?.enabled && p.oviposition?.active) {
            const om = new OviManager(p), prog = om.progress();
            h += `<div class="lc-sw-block lc-sw-ovi-block"><div class="lc-sw-block-title">🥚 ${OviManager.PHASES[p.oviposition.phase]}</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill ovi" style="width:${prog}%"></div></div><div class="lc-sw-row">${p.oviposition.eggCount} яиц (${p.oviposition.fertilizedCount} ферт.)</div></div>`;
        }
        if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active && !p.labor?.active) {
            const cm = new CycleManager(p), f = cm.fertility();
            let fc = "low"; if (f >= 0.2) fc = "peak"; else if (f >= 0.1) fc = "high"; else if (f >= 0.05) fc = "med";
            h += `<div class="lc-sw-block lc-sw-cycle-block"><div class="lc-sw-row">${cm.emoji(cm.phase())} ${cm.label(cm.phase())} | <span class="lc-sw-fert ${fc}">${Math.round(f * 100)}%</span></div></div>`;
        }
        if (s.modules.baby && p.babies?.length > 0) {
            h += '<div class="lc-sw-block lc-sw-baby-block">';
            p.babies.forEach(b => { h += `<div class="lc-sw-baby-row">${b.sex === 'M' ? '♂' : '♀'} <strong>${b.name || '?'}</strong> (${new BabyManager(b).age()})</div>`; });
            h += '</div>';
        }
        h += '</div>';
    }
    h += '</div></div>';
    return h;
}

function injectWidget(msgIdx) {
    const s = S(); if (!s.enabled || !s.showStatusWidget) return;
    const w = genWidget(); if (!w) return;
    setTimeout(() => {
        const el = document.querySelector(`#chat .mes[mesid="${msgIdx}"]`);
        if (!el) return; const mt = el.querySelector(".mes_text"); if (!mt) return;
        mt.querySelectorAll(".lc-status-widget").forEach(x => x.remove());
        mt.insertAdjacentHTML("beforeend", w);
    }, 300);
}

// ==========================================
// 15. BIND ALL
// ==========================================

function bindHR(p) {
    document.getElementById("lc-hr-th")?.addEventListener("click", () => { p.heat.active = true; p.heat.currentDay = 1; saveSettingsDebounced(); renderHR(); renderDash(); });
    document.getElementById("lc-hr-sh")?.addEventListener("click", () => { p.heat.active = false; p.heat.currentDay = 0; p.heat.daysSinceLast = 0; saveSettingsDebounced(); renderHR(); renderDash(); });
    document.getElementById("lc-hr-su")?.addEventListener("click", () => { p.heat.onSuppressants = !p.heat.onSuppressants; saveSettingsDebounced(); renderHR(); });
    document.getElementById("lc-hr-tr")?.addEventListener("click", () => { p.rut.active = true; p.rut.currentDay = 1; saveSettingsDebounced(); renderHR(); renderDash(); });
    document.getElementById("lc-hr-sr")?.addEventListener("click", () => { p.rut.active = false; p.rut.currentDay = 0; p.rut.daysSinceLast = 0; saveSettingsDebounced(); renderHR(); renderDash(); });
}

function bindAll() {
    const s = S();
    document.getElementById("bunnycycle-header-toggle")?.addEventListener("click", function (e) { if (e.target.closest(".lc-switch")) return; s.panelCollapsed = !s.panelCollapsed; document.getElementById("bunnycycle-panel")?.classList.toggle("collapsed", s.panelCollapsed); this.querySelector(".lc-collapse-arrow").textContent = s.panelCollapsed ? "▶" : "▼"; saveSettingsDebounced(); });
    document.getElementById("lc-enabled")?.addEventListener("change", function () { s.enabled = this.checked; saveSettingsDebounced(); });

    // Tabs
    document.querySelectorAll(".lifecycle-tab").forEach(t => t.addEventListener("click", function () { document.querySelectorAll(".lifecycle-tab").forEach(x => x.classList.remove("active")); document.querySelectorAll(".lifecycle-tab-content").forEach(x => x.classList.remove("active")); this.classList.add("active"); document.querySelector(`.lifecycle-tab-content[data-tab="${this.dataset.tab}"]`)?.classList.add("active"); rebuild(); }));

    // Chars — async buttons
    document.getElementById("lc-sync")?.addEventListener("click", async () => { toastr.info("Сканирование..."); await syncChars(); rebuild(); toastr.success("Готово!"); });
    document.getElementById("lc-add-m")?.addEventListener("click", () => { const n = prompt("Имя:"); if (n?.trim()) { s.characters[n.trim()] = makeProfile(n.trim(), false, "F"); saveSettingsDebounced(); rebuild(); } });
    document.getElementById("lc-reparse")?.addEventListener("click", async () => {
        CharAnalyzer.clearCache(); ChatAnalyzer.clearCache();
        Object.values(s.characters).forEach(p => { p._mB = false; p._mE = false; p._mH = false; p._mR = false; p._mS = false; p._sexConfidence = 0; });
        toastr.info("AI анализирует...");
        await syncChars(); rebuild();
        toastr.success("AI-скан завершён!");
    });
    document.getElementById("lc-char-list")?.addEventListener("click", function (e) { const eb = e.target.closest(".lc-edit-char"), db = e.target.closest(".lc-del-char"); if (eb) openEditor(eb.dataset.char); if (db && confirm("Удалить?")) { delete s.characters[db.dataset.char]; saveSettingsDebounced(); rebuild(); } });
    document.getElementById("lc-ed-save")?.addEventListener("click", saveEditor);
    document.getElementById("lc-ed-cancel")?.addEventListener("click", closeEditor);

    // Rels
    document.getElementById("lc-rel-add")?.addEventListener("click", () => { const c1 = document.getElementById("lc-rel-c1")?.value, c2 = document.getElementById("lc-rel-c2")?.value, tp = document.getElementById("lc-rel-tp")?.value; if (!c1 || !c2 || c1 === c2) return; Rels.add(c1, c2, tp, document.getElementById("lc-rel-n")?.value); document.getElementById("lc-rel-n").value = ""; renderRels(); });

    // Cycle
    document.getElementById("lc-cyc-char")?.addEventListener("change", renderCycle);
    document.getElementById("lc-cyc-setday")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-cyc-char")?.value]; if (!p?.cycle?.enabled) return; const d = parseInt(document.getElementById("lc-cyc-day")?.value); if (d >= 1 && d <= p.cycle.length) { new CycleManager(p).setDay(d); saveSettingsDebounced(); renderCycle(); renderDash(); } });
    ["mens", "foll", "ovul", "lut"].forEach(ph => { document.getElementById("lc-cyc-" + ph)?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-cyc-char")?.value]; if (!p?.cycle?.enabled) return; new CycleManager(p).setPhase({ mens: "menstruation", foll: "follicular", ovul: "ovulation", lut: "luteal" }[ph]); saveSettingsDebounced(); renderCycle(); renderDash(); }); });
    document.getElementById("lc-cyc-skip")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-cyc-char")?.value]; if (!p?.cycle?.enabled) return; p.cycle.currentDay = 1; p.cycle.cycleCount++; saveSettingsDebounced(); renderCycle(); renderDash(); });

    // HR
    document.getElementById("lc-hr-char")?.addEventListener("change", renderHR);

    // Intimacy
    document.getElementById("lc-int-log")?.addEventListener("click", () => { const t = document.getElementById("lc-int-t")?.value; if (!t) return; Intimacy.log({ parts: [t, document.getElementById("lc-int-p")?.value].filter(Boolean), type: document.getElementById("lc-int-tp")?.value, ejac: document.getElementById("lc-int-ej")?.value }); renderIntim(); });
    document.getElementById("lc-int-roll")?.addEventListener("click", () => { const t = document.getElementById("lc-int-t")?.value; if (!t) return; const r = Intimacy.roll(t, { parts: [t, document.getElementById("lc-int-p")?.value].filter(Boolean), tp: document.getElementById("lc-int-tp")?.value, ej: document.getElementById("lc-int-ej")?.value }); if (r.reason === "not_eligible") { toastr.warning("Не может забеременеть!"); return; } showDicePopup(r, t, false); renderDice(); });

    // Preg
    document.getElementById("lc-preg-char")?.addEventListener("change", renderPreg);
    document.getElementById("lc-preg-adv")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-preg-char")?.value]; if (p?.pregnancy?.active) { new PregManager(p).advDay(7); saveSettingsDebounced(); renderPreg(); renderDash(); } });
    document.getElementById("lc-preg-set")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-preg-char")?.value]; if (!p?.pregnancy?.active) return; const w = prompt("Неделя:"); if (w) { p.pregnancy.week = clamp(parseInt(w), 1, p.pregnancy.maxWeeks); saveSettingsDebounced(); renderPreg(); } });
    document.getElementById("lc-preg-labor")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-preg-char")?.value]; if (!p?.pregnancy?.active) return; new LaborManager(p).start(); saveSettingsDebounced(); renderLabor(); renderDash(); });
    document.getElementById("lc-preg-end")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-preg-char")?.value]; if (!p?.pregnancy?.active || !confirm("Прервать?")) return; p.pregnancy.active = false; if (p.cycle) p.cycle.enabled = true; saveSettingsDebounced(); renderPreg(); renderDash(); });

    // Labor
    document.getElementById("lc-labor-char")?.addEventListener("change", renderLabor);
    document.getElementById("lc-labor-adv")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-labor-char")?.value]; if (p?.labor?.active) { new LaborManager(p).advance(); saveSettingsDebounced(); renderLabor(); } });
    document.getElementById("lc-labor-deliver")?.addEventListener("click", () => { const cn = document.getElementById("lc-labor-char")?.value; const p = s.characters[cn]; if (p?.labor?.active) showBabyForm(cn, p.pregnancy?.father || "?"); });
    document.getElementById("lc-labor-end")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-labor-char")?.value]; if (p?.labor?.active && confirm("Завершить?")) { new LaborManager(p).end(); saveSettingsDebounced(); renderLabor(); renderDash(); } });

    // Baby
    document.getElementById("lc-baby-par")?.addEventListener("change", renderBabies);
    document.getElementById("lc-baby-create")?.addEventListener("click", () => showBabyForm(null, null, null, null, true));
    document.getElementById("lc-baby-list")?.addEventListener("click", function (e) { const eb = e.target.closest(".lc-baby-edit"), db = e.target.closest(".lc-baby-del"); if (eb) { const baby = s.characters[eb.dataset.p]?.babies?.[parseInt(eb.dataset.i)]; if (baby) showBabyForm(eb.dataset.p, baby.father, baby, parseInt(eb.dataset.i)); } if (db && confirm("Удалить?")) { s.characters[db.dataset.p]?.babies?.splice(parseInt(db.dataset.i), 1); saveSettingsDebounced(); renderBabies(); } });

    // Ovi
    document.getElementById("lc-ovi-char")?.addEventListener("change", renderOvi);
    document.getElementById("lc-ovi-start")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-ovi-char")?.value]; if (p) { new OviManager(p).startCarrying(); saveSettingsDebounced(); renderOvi(); renderDash(); } });
    document.getElementById("lc-ovi-adv")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-ovi-char")?.value]; if (p?.oviposition?.active) { new OviManager(p).advance(1); saveSettingsDebounced(); renderOvi(); renderDash(); } });
    document.getElementById("lc-ovi-end")?.addEventListener("click", () => { const p = s.characters[document.getElementById("lc-ovi-char")?.value]; if (p?.oviposition?.active) { new OviManager(p).end(); saveSettingsDebounced(); renderOvi(); renderDash(); } });

    // Profiles
    document.getElementById("lc-prof-save")?.addEventListener("click", () => { Profiles.save(); renderProfs(); toastr.success("Сохранено!"); });
    document.getElementById("lc-prof-reload")?.addEventListener("click", async () => { Profiles.load(); await syncChars(); rebuild(); toastr.info("Перезагружено!"); });
    document.getElementById("lc-prof-list")?.addEventListener("click", function (e) { const lb = e.target.closest(".lc-prof-load"), db = e.target.closest(".lc-prof-del"); if (lb) { const pr = s.chatProfiles[lb.dataset.id]; if (pr) { s.characters = JSON.parse(JSON.stringify(pr.characters || {})); s.relationships = JSON.parse(JSON.stringify(pr.relationships || [])); s.worldDate = { ...(pr.worldDate || DEFAULTS.worldDate) }; s.currentChatId = lb.dataset.id; saveSettingsDebounced(); rebuild(); toastr.success("Загружено!"); } } if (db && confirm("Удалить?")) { Profiles.del(db.dataset.id); renderProfs(); } });

    // Settings
    const mods = { "lc-mc": "cycle", "lc-mp": "pregnancy", "lc-ml": "labor", "lc-mb": "baby", "lc-mi": "intimacy" };
    for (const [id, key] of Object.entries(mods)) document.getElementById(id)?.addEventListener("change", function () { s.modules[key] = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-mau")?.addEventListener("change", function () { s.modules.auOverlay = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-ovi-on")?.addEventListener("change", function () { s.auSettings.oviposition.enabled = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-sllm")?.addEventListener("change", function () { s.useLLMParsing = this.checked; saveSettingsDebounced(); });
    const autos = { "lc-sa": "autoSyncCharacters", "lc-sp": "autoParseCharInfo", "lc-sc": "parseFullChat", "lc-sd": "autoDetectIntimacy", "lc-sr": "autoRollOnSex", "lc-sw": "showStatusWidget", "lc-st": "autoTimeProgress" };
    for (const [id, key] of Object.entries(autos)) document.getElementById(id)?.addEventListener("change", function () { s[key] = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-pon")?.addEventListener("change", function () { s.promptInjectionEnabled = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-ppos")?.addEventListener("change", function () { s.promptInjectionPosition = this.value; saveSettingsDebounced(); });
    document.getElementById("lc-pdet")?.addEventListener("change", function () { s.promptInjectionDetail = this.value; saveSettingsDebounced(); });
    document.getElementById("lc-aup")?.addEventListener("change", function () { s.auPreset = this.value; saveSettingsDebounced(); });
    document.getElementById("lc-da")?.addEventListener("click", () => { s.worldDate.year = parseInt(document.getElementById("lc-dy")?.value) || 2025; s.worldDate.month = clamp(parseInt(document.getElementById("lc-dm")?.value) || 1, 1, 12); s.worldDate.day = clamp(parseInt(document.getElementById("lc-dd")?.value) || 1, 1, 31); s.worldDate.hour = clamp(parseInt(document.getElementById("lc-dh")?.value) || 12, 0, 23); saveSettingsDebounced(); renderDash(); });
    document.getElementById("lc-d1")?.addEventListener("click", () => { TimeParse.apply({ days: 1 }); rebuild(); });
    document.getElementById("lc-d7")?.addEventListener("click", () => { TimeParse.apply({ days: 7 }); rebuild(); });
    document.getElementById("lc-df")?.addEventListener("change", function () { s.worldDate.frozen = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-exp")?.addEventListener("click", () => { const b = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "bunnycycle_" + Date.now() + ".json"; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); });
    document.getElementById("lc-imp")?.addEventListener("click", () => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json"; inp.addEventListener("change", e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { try { extension_settings[EXT] = deep(DEFAULTS, JSON.parse(ev.target.result)); saveSettingsDebounced(); document.getElementById("bunnycycle-panel")?.remove(); init(); } catch (er) { toastr.error("JSON: " + er.message); } }; r.readAsText(f); }); inp.click(); });
    document.getElementById("lc-rst")?.addEventListener("click", () => { if (!confirm("Полный сброс?")) return; extension_settings[EXT] = JSON.parse(JSON.stringify(DEFAULTS)); saveSettingsDebounced(); document.getElementById("bunnycycle-panel")?.remove(); init(); });
}

// ==========================================
// 16. MESSAGE HOOK
// ==========================================

async function onMessage(msgIdx) {
    const s = S(); if (!s.enabled) return;
    const ctx = getContext(); if (!ctx?.chat || msgIdx < 0) return;
    const msg = ctx.chat[msgIdx]; if (!msg?.mes || msg.is_user) return;

    if (s.autoSyncCharacters) await syncChars();

    if (s.autoTimeProgress && !s.worldDate.frozen) {
        const tp = TimeParse.parse(msg.mes);
        if (tp) { TimeParse.apply(tp); rebuild(); }
    }

    if (s.autoDetectIntimacy && s.modules.intimacy) {
        const det = SexDetect.detect(msg.mes, s.characters);
        if (det?.detected) {
            Intimacy.log({ parts: det.parts, type: det.tp, ejac: det.ej, auto: true });
            if (s.autoRollOnSex && det.target && det.tp === "vaginal" && (det.ej === "inside" || det.ej === "unknown")) {
                const r = Intimacy.roll(det.target, { parts: det.parts, tp: det.tp, ej: det.ej, co: det.co, nc: det.nc, auto: true });
                if (r.reason !== "not_eligible") showDicePopup(r, det.target, true);
            }
        }
    }

    if (s.showStatusWidget) injectWidget(msgIdx);
    renderDash();
}

// ==========================================
// 17. INIT
// ==========================================

async function init() {
    try {
        if (!extension_settings[EXT]) extension_settings[EXT] = JSON.parse(JSON.stringify(DEFAULTS));
        else extension_settings[EXT] = deep(JSON.parse(JSON.stringify(DEFAULTS)), extension_settings[EXT]);

        document.getElementById("bunnycycle-panel")?.remove();
        const target = document.getElementById("extensions_settings2") || document.getElementById("extensions_settings");
        if (target) target.insertAdjacentHTML("beforeend", genHTML());
        else { console.warn("[BunnyCycle] Container not found!"); return; }

        Profiles.load();
        await syncChars();
        bindAll();
        rebuild();

        if (eventSource) {
            eventSource.on(event_types.MESSAGE_RECEIVED, (idx) => onMessage(idx));
            eventSource.on(event_types.CHAT_CHANGED, async () => { ChatAnalyzer.clearCache(); Profiles.load(); await syncChars(); rebuild(); });
            eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (data) => {
                const s = S(); if (!s.enabled || !s.promptInjectionEnabled) return;
                const inj = Prompt.gen(); if (!inj) return;
                if (s.promptInjectionPosition === "system" && data.systemPrompt !== undefined) data.systemPrompt += "\n\n" + inj;
                else if (s.promptInjectionPosition === "authornote") data.authorNote = (data.authorNote || "") + "\n\n" + inj;
            });
        }
        console.log("[BunnyCycle v1.0.0] Loaded with LLM analysis!");
    } catch (err) { console.error("[BunnyCycle] Init error:", err); }
}

jQuery(async () => { await init(); });

window.BunnyCycle = {
    getSettings: () => S(), sync: syncChars,
    advanceTime: d => { TimeParse.apply({ days: d }); rebuild(); },
    rollDice: (c, d) => Intimacy.roll(c, d),
    addRelationship: (a, b, t, n) => Rels.add(a, b, t, n),
    canGetPregnant, CharAnalyzer, ChatAnalyzer,
};
