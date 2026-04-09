// ============================================================
// LifeCycle Extension v0.3.0 — index.js (Production-Ready)
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
    autoSyncCharacters: true,
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
    timeParserConfirmation: true,
    promptInjectionEnabled: true,
    promptInjectionPosition: "authornote",
    promptInjectionDetail: "medium",
    auPreset: "realism",
    auSettings: {
        omegaverse: {
            heatCycleLength: 30, heatDuration: 5, heatFertilityBonus: 0.35,
            rutDuration: 4, knotEnabled: true, bondingEnabled: true,
            suppressantsAvailable: true, maleOmegaPregnancy: true,
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
    activeTab: "dashboard",
    editingCharacter: null,
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
// CHARACTER SYNC
// ==========================================

function getActiveCharacters() {
    const ctx = getContext();
    const chars = [];
    if (!ctx) return chars;

    if (ctx.characterId !== undefined && ctx.characters) {
        const c = ctx.characters[ctx.characterId];
        if (c) chars.push({ name: c.name, avatar: c.avatar, isUser: false });
    }

    if (ctx.groups && ctx.groupId) {
        const group = ctx.groups.find(g => g.id === ctx.groupId);
        if (group && group.members) {
            for (const av of group.members) {
                const c = ctx.characters.find(ch => ch.avatar === av);
                if (c && !chars.find(x => x.name === c.name)) {
                    chars.push({ name: c.name, avatar: c.avatar, isUser: false });
                }
            }
        }
    }

    if (ctx.name1) chars.push({ name: ctx.name1, avatar: null, isUser: true });
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
    }
    if (changed) saveSettingsDebounced();
}

function makeProfile(name, isUser) {
    return {
        name, bioSex: "F", secondarySex: null, contraception: "none",
        eyeColor: "", hairColor: "", pregnancyDifficulty: "normal",
        _isUser: isUser, _enabled: true,
        cycle: { enabled: true, currentDay: Math.floor(Math.random() * 28) + 1, baseLength: 28, length: 28, menstruationDuration: 5, irregularity: 2, symptomIntensity: "moderate", cycleCount: 0 },
        pregnancy: { active: false, week: 0, day: 0, maxWeeks: 40, father: null, fetusCount: 1, complications: [], weightGain: 0 },
        labor: { active: false, stage: "latent", dilation: 0, contractionInterval: 0, contractionDuration: 0, hoursElapsed: 0, babiesDelivered: 0, totalBabies: 1 },
        heat: { active: false, currentDay: 0, duration: 5, daysSinceLast: 0, onSuppressants: false },
        rut: { active: false, currentDay: 0, duration: 4, daysSinceLast: 0 },
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

    fertility() {
        const ph = this.phase();
        const base = { ovulation: 0.25, follicular: 0.08, luteal: 0.02, menstruation: 0.01, unknown: 0.05 }[ph] || 0.05;
        const s = extension_settings[extensionName];
        let bonus = 0;
        if (s.modules.auOverlay && s.auPreset === "omegaverse" && this.p.heat?.active) bonus = s.auSettings.omegaverse.heatFertilityBonus;
        return Math.min(base + bonus, 0.95);
    }

    libido() { return { ovulation: "высокое", follicular: "среднее", luteal: "низкое", menstruation: "низкое" }[this.phase()] || "среднее"; }

    symptoms() {
        const ph = this.phase(), int = this.c.symptomIntensity, r = [];
        if (ph === "menstruation") { r.push("кровотечение"); if (int !== "mild") r.push("спазмы"); if (int === "severe") r.push("сильная боль"); }
        if (ph === "ovulation") { r.push("повышенное либидо"); if (int !== "mild") r.push("чувствительность груди"); }
        if (ph === "luteal") { r.push("ПМС"); if (int !== "mild") r.push("перепады настроения"); }
        if (ph === "follicular") r.push("прилив энергии");
        return r;
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
        this.pr.active = true; this.pr.week = 1; this.pr.day = 0;
        this.pr.father = father; this.pr.fetusCount = count || 1;
        this.pr.maxWeeks = count > 1 ? Math.max(28, 40 - (count - 1) * 3) : 40;
        this.pr.weightGain = 0;
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
        const sizes = [[4,"маковое зерно"],[6,"черника"],[8,"малина"],[10,"кумкват"],[12,"лайм"],[14,"лимон"],[16,"авокадо"],[20,"банан"],[24,"кукуруза"],[28,"баклажан"],[32,"тыква"],[36,"ананас"],[40,"арбуз"]];
        let r = "эмбрион";
        for (const [wk, sz] of sizes) { if (w >= wk) r = sz; }
        return r;
    }

    symptoms() {
        const w = this.pr.week, r = [];
        if (w >= 4 && w <= 14) { r.push("тошнота", "усталость"); }
        if (w >= 16 && w <= 27) { r.push("рост живота", "шевеления"); }
        if (w >= 28) { r.push("одышка", "отёки", "тренировочные схватки"); }
        return r;
    }

    movements() {
        const w = this.pr.week;
        if (w < 16) return "нет"; if (w < 22) return "лёгкие"; if (w < 30) return "активные"; return "сильные";
    }

    weightGain() {
        const w = this.pr.week;
        if (w <= 12) return Math.round(w * 0.2 * 10) / 10;
        if (w <= 27) return Math.round((2.4 + (w - 12) * 0.45) * 10) / 10;
        return Math.round((9.15 + (w - 27) * 0.4) * 10) / 10;
    }

    bodyChanges() {
        const w = this.pr.week, r = [];
        if (w >= 6) r.push("грудь увеличивается");
        if (w >= 16) r.push("живот заметен");
        if (w >= 24) r.push("растяжки");
        if (w >= 32) r.push("живот большой");
        if (w >= 36) r.push("живот опускается");
        return r;
    }
}

// ==========================================
// LABOR MANAGER
// ==========================================

const LABOR_STAGES = ["latent","active","transition","pushing","birth","placenta"];
const LABOR_LABELS = { latent:"Латентная", active:"Активная", transition:"Переходная", pushing:"Потуги", birth:"Рождение", placenta:"Плацента" };

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
            if (this.l.stage === "active") { this.l.dilation = 5; this.l.contractionInterval = 5; this.l.contractionDuration = 50; }
            if (this.l.stage === "transition") { this.l.dilation = 8; this.l.contractionInterval = 2; this.l.contractionDuration = 70; }
            if (this.l.stage === "pushing") { this.l.dilation = 10; }
        }
    }

    description() {
        return { latent:"Лёгкие схватки, раскрытие до 3-4 см.", active:"Сильные схватки, раскрытие 4-7 см.", transition:"Пиковые схватки, раскрытие 7-10 см. Самая тяжёлая фаза.", pushing:"Полное раскрытие, потуги.", birth:"Ребёнок рождается.", placenta:"Рождение плаценты." }[this.l.stage] || "";
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
        return {
            name: "", sex,
            birthWeight: 3200 + Math.floor(Math.random() * 800) - 400,
            currentWeight: 3200,
            ageDays: 0,
            eyeColor: Math.random() < 0.5 ? (mother.eyeColor || "карие") : (fp?.eyeColor || "карие"),
            hairColor: Math.random() < 0.5 ? (mother.hairColor || "тёмные") : (fp?.hairColor || "тёмные"),
            mother: mother.name, father: fatherName,
            state: "новорождённый",
            birthDate: { ...s.worldDate },
        };
    }

    ageLabel() {
        const d = this.b.ageDays;
        if (d < 1) return "новорождённый";
        if (d < 7) return d + " дн.";
        if (d < 30) return Math.floor(d / 7) + " нед.";
        if (d < 365) return Math.floor(d / 30) + " мес.";
        return Math.floor(d / 365) + " г.";
    }

    update() {
        this.b.currentWeight = this.b.birthWeight + this.b.ageDays * (this.b.ageDays < 120 ? 30 : 12);
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

        const contraEff = { none:0, condom:0.85, pill:0.91, iud:0.99, withdrawal:0.73 }[p.contraception] || 0;
        fert *= (1 - contraEff);

        if (data.ejaculation === "outside") fert *= 0.05;
        if (data.type === "anal" || data.type === "oral") fert = 0;
        if (p.pregnancy?.active) fert = 0;
        if (p.bioSex === "M" && p.secondarySex !== "omega") fert = 0;

        const chance = Math.round(clamp(fert, 0, 0.95) * 100);
        const r = rollDice(100);
        const result = r <= chance;

        const entry = { timestamp: formatDate(s.worldDate), targetChar, participants: data.participants || [], chance, roll: r, result, contraception: p.contraception, actType: data.type, ejaculation: data.ejaculation };
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
            [/прошл[оа]\s+(\d+)\s+(?:месяц|мес)/gi, 30],
            [/через\s+(\d+)\s+(?:месяц|мес)/gi, 30],
        ];

        for (const [re, mult] of pats) {
            let m; while ((m = re.exec(msg)) !== null) days += parseInt(m[1]) * mult;
        }

        if (sens !== "low") {
            if (/на следующ(?:ий|ее|ую)\s+(?:день|утро)/i.test(msg)) days += 1;
            if (/через\s+пару\s+дней/i.test(msg)) days += 2;
            if (/через\s+несколько\s+дней/i.test(msg)) days += 3;
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
            if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) new CycleManager(p).advance(days);
            if (s.modules.pregnancy && p.pregnancy?.active) new PregnancyManager(p).advanceDay(days);
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
        const lines = ["[LifeCycle System Data]", "World Date: " + formatDate(s.worldDate)];

        Object.entries(s.characters).forEach(([name, p]) => {
            if (!p._enabled) return;
            lines.push("\n--- " + name + " ---");
            lines.push("Bio Sex: " + p.bioSex);
            if (p.secondarySex) lines.push("Secondary Sex: " + p.secondarySex);

            if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
                const cm = new CycleManager(p);
                lines.push("Cycle: Day " + p.cycle.currentDay + "/" + p.cycle.length + ", Phase: " + cm.phaseLabel(cm.phase()));
                lines.push("Fertility: " + Math.round(cm.fertility() * 100) + "%");
                const sym = cm.symptoms();
                if (sym.length) lines.push("Symptoms: " + sym.join(", "));
            }

            if (s.modules.pregnancy && p.pregnancy?.active) {
                const pm = new PregnancyManager(p);
                lines.push("PREGNANT: Week " + p.pregnancy.week + ", Trimester " + pm.trimester());
                lines.push("Fetal size: " + pm.fetalSize());
                lines.push("Symptoms: " + pm.symptoms().join(", "));
                lines.push("Movements: " + pm.movements());
                lines.push("Weight gain: +" + pm.weightGain() + " kg");
            }

            if (s.modules.labor && p.labor?.active) {
                lines.push("IN LABOR: " + LABOR_LABELS[p.labor.stage] + ", Dilation: " + p.labor.dilation + "cm");
            }

            if (p.contraception !== "none") lines.push("Contraception: " + p.contraception);
        });

        lines.push("\n[/LifeCycle System Data]");
        return lines.join("\n");
    }
}

// ==========================================
// DICE POPUP
// ==========================================

function showDicePopup(result, target) {
    document.querySelector(".lc-overlay")?.remove();
    document.querySelector(".lc-popup")?.remove();

    const ov = document.createElement("div"); ov.className = "lc-overlay";
    const pop = document.createElement("div"); pop.className = "lc-popup";

    const cls = result.result ? "success" : "fail";
    const txt = result.result ? "ЗАЧАТИЕ!" : "Нет зачатия";

    pop.innerHTML = `
        <div class="lc-popup-title">🎲 Бросок фертильности</div>
        <div class="lc-popup-details">
            <div><strong>Персонаж:</strong> ${target}</div>
            <div><strong>Шанс:</strong> ${result.chance}%</div>
            <div><strong>Контрацепция:</strong> ${result.contraception}</div>
            <div><strong>Тип:</strong> ${result.actType}</div>
            <hr class="lc-sep">
            <div><strong>Порог:</strong> ≤${result.chance}</div>
        </div>
        <div class="lc-popup-result ${cls}">🎲 ${result.roll}</div>
        <div class="lc-popup-verdict ${cls}">${txt}</div>
        <div class="lc-popup-actions">
            <button id="lc-dice-accept" class="lc-btn lc-btn-success">Принять</button>
            <button id="lc-dice-reroll" class="lc-btn">Перебросить</button>
            <button id="lc-dice-cancel" class="lc-btn lc-btn-danger">Отмена</button>
        </div>`;

    document.body.appendChild(ov);
    document.body.appendChild(pop);

    document.getElementById("lc-dice-accept").addEventListener("click", () => {
        if (result.result) {
            const s = extension_settings[extensionName];
            const p = s.characters[target];
            if (p) { new PregnancyManager(p).start(result.participants?.find(x => x !== target) || "?", 1); saveSettingsDebounced(); rebuildUI(); }
        }
        ov.remove(); pop.remove();
    });
    document.getElementById("lc-dice-reroll").addEventListener("click", () => {
        ov.remove(); pop.remove();
        const nr = IntimacyManager.roll(target, { participants: result.participants, type: result.actType, ejaculation: result.ejaculation });
        showDicePopup(nr, target);
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
        rd.onload = ev => { try { cb(JSON.parse(ev.target.result)); } catch (err) { toastr.error("JSON parse error: " + err.message); } };
        rd.readAsText(f);
    });
    inp.click();
}

// ==========================================
// HTML GENERATION
// ==========================================

function buildCharSelect(id, extraClass) {
    const s = extension_settings[extensionName];
    const names = Object.keys(s.characters);
    let opts = names.map(n => `<option value="${n}">${n}</option>`).join("");
    return `<select id="${id}" class="lc-select ${extraClass || "lc-char-select"}">${opts}</select>`;
}

function generateHTML() {
    const s = extension_settings[extensionName];

    return `<div class="lifecycle-panel" id="lifecycle-panel">
        <div class="lifecycle-header">
            <div class="lifecycle-header-title">
                <h3>LifeCycle</h3>
                <span class="lc-version">v0.3</span>
            </div>
            <div class="lifecycle-header-actions">
                <label class="lc-switch"><input type="checkbox" id="lc-enabled" ${s.enabled ? "checked" : ""}><span class="lc-switch-slider"></span></label>
            </div>
        </div>

        <div class="lc-dashboard" id="lc-dashboard">
            <div class="lc-dashboard-date" id="lc-dashboard-date"></div>
            <div id="lc-dashboard-items"></div>
        </div>

        <div class="lifecycle-tabs">
            <button class="lifecycle-tab active" data-tab="chars"><span class="tab-icon">👥</span>Персонажи</button>
            <button class="lifecycle-tab" data-tab="cycle"><span class="tab-icon">🔴</span>Цикл</button>
            <button class="lifecycle-tab" data-tab="intim"><span class="tab-icon">🔥</span>Интим</button>
            <button class="lifecycle-tab" data-tab="preg"><span class="tab-icon">🤰</span>Беремен.</button>
            <button class="lifecycle-tab" data-tab="labor"><span class="tab-icon">🏥</span>Роды</button>
            <button class="lifecycle-tab" data-tab="babies"><span class="tab-icon">👶</span>Малыши</button>
            <button class="lifecycle-tab" data-tab="settings"><span class="tab-icon">⚙️</span>Настройки</button>
        </div>

        <!-- CHARACTERS TAB -->
        <div class="lifecycle-tab-content active" data-tab="chars">
            <div class="lc-btn-group" style="margin-bottom:8px">
                <button id="lc-sync-chars" class="lc-btn lc-btn-primary">🔄 Синхронизировать</button>
                <button id="lc-add-manual" class="lc-btn">+ Добавить вручную</button>
            </div>
            <div id="lc-char-list"></div>
            <div id="lc-char-editor" class="lc-editor hidden">
                <div class="lc-editor-title" id="lc-editor-title">Редактирование</div>
                <div class="lc-editor-grid">
                    <div class="lc-editor-field">
                        <label>Биол. пол</label>
                        <select id="lc-edit-bio-sex" class="lc-select"><option value="F">Женский</option><option value="M">Мужской</option></select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Втор. пол (AU)</label>
                        <select id="lc-edit-sec-sex" class="lc-select"><option value="">Нет</option><option value="alpha">Альфа</option><option value="beta">Бета</option><option value="omega">Омега</option></select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Контрацепция</label>
                        <select id="lc-edit-contra" class="lc-select"><option value="none">Нет</option><option value="condom">Презерватив</option><option value="pill">ОК (таблетки)</option><option value="iud">ВМС</option><option value="withdrawal">Прерванный акт</option></select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Сложность берем.</label>
                        <select id="lc-edit-difficulty" class="lc-select"><option value="easy">Лёгкая</option><option value="normal">Нормальная</option><option value="hard">Тяжёлая</option><option value="complicated">С осложнениями</option></select>
                    </div>
                    <div class="lc-editor-field">
                        <label>Цвет глаз</label>
                        <input type="text" id="lc-edit-eyes" class="lc-input" placeholder="карие">
                    </div>
                    <div class="lc-editor-field">
                        <label>Цвет волос</label>
                        <input type="text" id="lc-edit-hair" class="lc-input" placeholder="тёмные">
                    </div>
                    <div class="lc-editor-field full-width">
                        <label class="lc-checkbox"><input type="checkbox" id="lc-edit-cycle-on"><span>Цикл включён</span></label>
                    </div>
                    <div class="lc-editor-field">
                        <label>Длина цикла (дни)</label>
                        <input type="number" id="lc-edit-cycle-len" class="lc-input" min="21" max="45" value="28">
                    </div>
                    <div class="lc-editor-field">
                        <label>Менструация (дни)</label>
                        <input type="number" id="lc-edit-mens-dur" class="lc-input" min="2" max="8" value="5">
                    </div>
                    <div class="lc-editor-field">
                        <label>Нерегулярность</label>
                        <input type="number" id="lc-edit-irreg" class="lc-input" min="0" max="10" value="2">
                    </div>
                    <div class="lc-editor-field">
                        <label>Симптомы</label>
                        <select id="lc-edit-symptom-int" class="lc-select"><option value="mild">Лёгкие</option><option value="moderate">Умеренные</option><option value="severe">Тяжёлые</option></select>
                    </div>
                    <div class="lc-editor-field full-width">
                        <label class="lc-checkbox"><input type="checkbox" id="lc-edit-enabled" checked><span>Трекинг включён</span></label>
                    </div>
                </div>
                <div class="lc-editor-actions">
                    <button id="lc-editor-save" class="lc-btn lc-btn-success">Сохранить</button>
                    <button id="lc-editor-cancel" class="lc-btn">Отмена</button>
                </div>
            </div>
        </div>

        <!-- CYCLE TAB -->
        <div class="lifecycle-tab-content" data-tab="cycle">
            <div class="lc-row" style="margin-bottom:8px"><label>Персонаж:</label>${buildCharSelect("lc-cycle-char", "lc-char-select")}</div>
            <div id="lc-cycle-panel"></div>
        </div>

        <!-- INTIMACY TAB -->
        <div class="lifecycle-tab-content" data-tab="intim">
            <div class="lc-section">
                <div class="lc-row"><label>Цель (берем.):</label>${buildCharSelect("lc-intim-target", "lc-char-select")}</div>
                <div class="lc-row"><label>Партнёр:</label>${buildCharSelect("lc-intim-partner", "lc-char-select")}</div>
                <div class="lc-row"><label>Тип акта:</label>
                    <select id="lc-intim-type" class="lc-select">
                        <option value="vaginal">Вагинальный</option><option value="anal">Анальный</option><option value="oral">Оральный</option>
                    </select>
                </div>
                <div class="lc-row"><label>Эякуляция:</label>
                    <select id="lc-intim-ejac" class="lc-select">
                        <option value="inside">Внутрь</option><option value="outside">Наружу</option><option value="na">Н/П</option>
                    </select>
                </div>
                <div class="lc-btn-group" style="margin-top:8px">
                    <button id="lc-intim-log" class="lc-btn">📝 Записать</button>
                    <button id="lc-intim-roll" class="lc-btn lc-btn-primary">🎲 Бросить кубик</button>
                </div>
            </div>
            <div class="lc-section"><div class="lc-section-title"><h4>Лог бросков</h4></div><div id="lc-dice-log" class="lc-scroll"></div></div>
            <div class="lc-section"><div class="lc-section-title"><h4>Лог актов</h4></div><div id="lc-intim-log-list" class="lc-scroll"></div></div>
        </div>

        <!-- PREGNANCY TAB -->
        <div class="lifecycle-tab-content" data-tab="preg">
            <div class="lc-row" style="margin-bottom:8px"><label>Персонаж:</label>${buildCharSelect("lc-preg-char", "lc-char-select")}</div>
            <div id="lc-preg-panel"></div>
            <div class="lc-btn-group" style="margin-top:8px">
                <button id="lc-preg-advance" class="lc-btn">+1 неделя</button>
                <button id="lc-preg-set-week" class="lc-btn">Уст. неделю</button>
                <button id="lc-preg-to-labor" class="lc-btn lc-btn-primary">Начать роды</button>
                <button id="lc-preg-end" class="lc-btn lc-btn-danger">Прервать</button>
            </div>
        </div>

        <!-- LABOR TAB -->
        <div class="lifecycle-tab-content" data-tab="labor">
            <div class="lc-row" style="margin-bottom:8px"><label>Персонаж:</label>${buildCharSelect("lc-labor-char", "lc-char-select")}</div>
            <div id="lc-labor-panel"></div>
            <div class="lc-btn-group" style="margin-top:8px">
                <button id="lc-labor-advance" class="lc-btn lc-btn-primary">След. стадия</button>
                <button id="lc-labor-deliver" class="lc-btn lc-btn-success">Родить</button>
                <button id="lc-labor-set-dil" class="lc-btn">Уст. раскрытие</button>
                <button id="lc-labor-end" class="lc-btn lc-btn-danger">Завершить</button>
            </div>
        </div>

        <!-- BABIES TAB -->
        <div class="lifecycle-tab-content" data-tab="babies">
            <div class="lc-row" style="margin-bottom:8px"><label>Родитель:</label>${buildCharSelect("lc-baby-parent", "lc-char-select")}</div>
            <div id="lc-baby-list"></div>
        </div>

        <!-- SETTINGS TAB -->
        <div class="lifecycle-tab-content" data-tab="settings">
            <div class="lc-section">
                <div class="lc-section-title"><h4>Общие</h4></div>
                <label class="lc-checkbox"><input type="checkbox" id="lc-auto-sync" ${s.autoSyncCharacters ? "checked" : ""}><span>Авто-синхронизация персонажей</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-auto-time" ${s.autoTimeProgress ? "checked" : ""}><span>Авто-парсинг времени</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-time-confirm" ${s.timeParserConfirmation ? "checked" : ""}><span>Подтверждение сдвига времени</span></label>
                <div class="lc-row"><label>Чувствительность:</label>
                    <select id="lc-time-sens" class="lc-select">
                        <option value="low" ${s.timeParserSensitivity === "low" ? "selected" : ""}>Низкая</option>
                        <option value="medium" ${s.timeParserSensitivity === "medium" ? "selected" : ""}>Средняя</option>
                        <option value="high" ${s.timeParserSensitivity === "high" ? "selected" : ""}>Высокая</option>
                    </select>
                </div>
            </div>

            <div class="lc-section">
                <div class="lc-section-title"><h4>Дата мира</h4></div>
                <div class="lc-row">
                    <input type="number" id="lc-date-y" class="lc-input" style="width:60px" value="${s.worldDate.year}">
                    <span>/</span>
                    <input type="number" id="lc-date-m" class="lc-input" style="width:40px" min="1" max="12" value="${s.worldDate.month}">
                    <span>/</span>
                    <input type="number" id="lc-date-d" class="lc-input" style="width:40px" min="1" max="31" value="${s.worldDate.day}">
                    <input type="number" id="lc-date-h" class="lc-input" style="width:40px" min="0" max="23" value="${s.worldDate.hour}">
                    <span>ч</span>
                </div>
                <div class="lc-btn-group" style="margin-top:6px">
                    <button id="lc-date-apply" class="lc-btn lc-btn-primary">Применить</button>
                    <button id="lc-date-plus1" class="lc-btn">+1 день</button>
                    <button id="lc-date-plus7" class="lc-btn">+7 дней</button>
                </div>
                <label class="lc-checkbox" style="margin-top:6px"><input type="checkbox" id="lc-date-frozen" ${s.worldDate.frozen ? "checked" : ""}><span>Заморозить время</span></label>
            </div>

            <div class="lc-section">
                <div class="lc-section-title"><h4>Модули</h4></div>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-cycle" ${s.modules.cycle ? "checked" : ""}><span>Цикл</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-preg" ${s.modules.pregnancy ? "checked" : ""}><span>Беременность</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-labor" ${s.modules.labor ? "checked" : ""}><span>Роды</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-baby" ${s.modules.baby ? "checked" : ""}><span>Малыши</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-intim" ${s.modules.intimacy ? "checked" : ""}><span>Интим-трекер</span></label>
                <label class="lc-checkbox"><input type="checkbox" id="lc-mod-au" ${s.modules.auOverlay ? "checked" : ""}><span>AU-оверлей</span></label>
            </div>

            <div class="lc-section">
                <div class="lc-section-title"><h4>Инъекция в промпт</h4></div>
                <label class="lc-checkbox"><input type="checkbox" id="lc-prompt-on" ${s.promptInjectionEnabled ? "checked" : ""}><span>Включена</span></label>
                <div class="lc-row"><label>Позиция:</label>
                    <select id="lc-prompt-pos" class="lc-select">
                        <option value="system" ${s.promptInjectionPosition === "system" ? "selected" : ""}>System Prompt</option>
                        <option value="authornote" ${s.promptInjectionPosition === "authornote" ? "selected" : ""}>Author's Note</option>
                        <option value="endofchat" ${s.promptInjectionPosition === "endofchat" ? "selected" : ""}>End of Chat</option>
                    </select>
                </div>
                <div class="lc-row"><label>Детальность:</label>
                    <select id="lc-prompt-detail" class="lc-select">
                        <option value="low" ${s.promptInjectionDetail === "low" ? "selected" : ""}>Минимальная</option>
                        <option value="medium" ${s.promptInjectionDetail === "medium" ? "selected" : ""}>Средняя</option>
                        <option value="high" ${s.promptInjectionDetail === "high" ? "selected" : ""}>Подробная</option>
                    </select>
                </div>
            </div>

            <div class="lc-section">
                <div class="lc-section-title"><h4>AU-пресет</h4></div>
                <div class="lc-row"><label>Пресет:</label>
                    <select id="lc-au-preset" class="lc-select">
                        <option value="realism" ${s.auPreset === "realism" ? "selected" : ""}>Реализм</option>
                        <option value="omegaverse" ${s.auPreset === "omegaverse" ? "selected" : ""}>Омегаверс</option>
                        <option value="fantasy" ${s.auPreset === "fantasy" ? "selected" : ""}>Фэнтези</option>
                        <option value="scifi" ${s.auPreset === "scifi" ? "selected" : ""}>Sci-Fi</option>
                    </select>
                </div>
                <div id="lc-au-panel"></div>
            </div>

            <div class="lc-section">
                <div class="lc-section-title"><h4>Данные</h4></div>
                <div class="lc-btn-group">
                    <button id="lc-export" class="lc-btn">📤 Экспорт</button>
                    <button id="lc-import" class="lc-btn">📥 Импорт</button>
                    <button id="lc-reset" class="lc-btn lc-btn-danger">🗑 Сброс</button>
                </div>
            </div>
        </div>
    </div>`;
}

// ==========================================
// UI UPDATE
// ==========================================

function rebuildUI() {
    const s = extension_settings[extensionName];
    refreshSelects();
    refreshCharList();
    refreshDashboard();
    refreshCyclePanel();
    refreshPregPanel();
    refreshLaborPanel();
    refreshBabyList();
    refreshLogs();
}

function refreshSelects() {
    const names = Object.keys(extension_settings[extensionName].characters);
    document.querySelectorAll(".lc-char-select").forEach(sel => {
        const cur = sel.value;
        sel.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join("");
        if (names.includes(cur)) sel.value = cur;
    });
}

function refreshCharList() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-char-list");
    if (!el) return;

    if (Object.keys(s.characters).length === 0) {
        el.innerHTML = `<div class="lc-empty"><div class="lc-empty-text">Нет персонажей. Нажмите "Синхронизировать".</div></div>`;
        return;
    }

    let html = "";
    Object.entries(s.characters).forEach(([name, p]) => {
        let tags = "";
        if (p._isUser) tags += `<span class="lc-tag lc-tag-neutral">USER</span>`;
        if (!p._enabled) tags += `<span class="lc-tag lc-tag-neutral">OFF</span>`;

        if (p.cycle?.enabled && !p.pregnancy?.active) {
            const cm = new CycleManager(p);
            tags += `<span class="lc-tag lc-tag-cycle">${cm.phaseLabel(cm.phase())}</span>`;
        }
        if (p.pregnancy?.active) tags += `<span class="lc-tag lc-tag-preg">Нед.${p.pregnancy.week}</span>`;
        if (p.labor?.active) tags += `<span class="lc-tag lc-tag-labor">${LABOR_LABELS[p.labor.stage]}</span>`;
        if (p.babies?.length > 0) tags += `<span class="lc-tag lc-tag-baby">👶${p.babies.length}</span>`;

        const sex = p.bioSex === "M" ? "М" : "Ж";
        const sec = p.secondarySex ? " / " + p.secondarySex : "";
        const contra = p.contraception !== "none" ? " | " + p.contraception : "";

        html += `<div class="lc-char-card">
            <div class="lc-char-card-header">
                <span class="lc-char-card-name">${name}</span>
                <div class="lc-char-card-tags">${tags}</div>
            </div>
            <div class="lc-char-card-meta">${sex}${sec}${contra}</div>
            <div class="lc-char-card-actions">
                <button class="lc-btn lc-btn-sm lc-edit-char" data-char="${name}">✏️ Редактировать</button>
                <button class="lc-btn lc-btn-sm lc-btn-danger lc-delete-char" data-char="${name}">🗑</button>
            </div>
        </div>`;
    });
    el.innerHTML = html;

    el.querySelectorAll(".lc-edit-char").forEach(btn => btn.addEventListener("click", function() { openEditor(this.dataset.char); }));
    el.querySelectorAll(".lc-delete-char").forEach(btn => btn.addEventListener("click", function() {
        if (confirm(`Удалить "${this.dataset.char}"?`)) { delete s.characters[this.dataset.char]; saveSettingsDebounced(); closeEditor(); rebuildUI(); }
    }));
}

function refreshDashboard() {
    const s = extension_settings[extensionName];
    const dateEl = document.getElementById("lc-dashboard-date");
    const itemsEl = document.getElementById("lc-dashboard-items");
    if (!dateEl || !itemsEl) return;

    dateEl.textContent = formatDate(s.worldDate) + (s.worldDate.frozen ? " ❄️" : "");

    let html = "";
    Object.entries(s.characters).forEach(([name, p]) => {
        if (!p._enabled) return;
        let parts = [];
        if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
            const cm = new CycleManager(p);
            parts.push(cm.phaseLabel(cm.phase()));
        }
        if (s.modules.pregnancy && p.pregnancy?.active) parts.push("Нед." + p.pregnancy.week);
        if (s.modules.labor && p.labor?.active) parts.push(LABOR_LABELS[p.labor.stage]);
        if (p.babies?.length > 0) parts.push("👶" + p.babies.length);

        html += `<div class="lc-dashboard-item"><span class="lc-dashboard-char">${name}</span><span class="lc-dashboard-status">${parts.join(" · ") || "—"}</span></div>`;
    });
    itemsEl.innerHTML = html || `<div class="lc-dashboard-item" style="color:var(--SmartThemeQuoteColor)">Нет активных персонажей</div>`;
}

function refreshCyclePanel() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-cycle-panel");
    if (!el) return;
    const name = document.getElementById("lc-cycle-char")?.value;
    const p = s.characters[name];
    if (!p || !p.cycle) { el.innerHTML = ""; return; }
    if (p.pregnancy?.active) { el.innerHTML = `<div class="lc-info-note">Цикл приостановлен (беременность)</div>`; return; }

    const cm = new CycleManager(p);
    const ph = cm.phase();
    const fert = cm.fertility();
    let fertLabel = "Низкая", fertCls = "low";
    if (fert >= 0.2) { fertLabel = "ПИКОВАЯ"; fertCls = "peak"; }
    else if (fert >= 0.1) { fertLabel = "Высокая"; fertCls = "high"; }
    else if (fert >= 0.05) { fertLabel = "Средняя"; fertCls = "med"; }

    const c = p.cycle;
    const ovDay = Math.round(c.length - 14);
    let calHtml = `<div class="lc-cycle-calendar">`;
    for (let i = 1; i <= c.length; i++) {
        let cls = "lc-cycle-day";
        if (i <= c.menstruationDuration) cls += " mens";
        else if (i >= ovDay - 2 && i <= ovDay + 1) cls += " ovul";
        else if (i < ovDay - 2) cls += " foll";
        else cls += " lut";
        if (i === c.currentDay) cls += " current";
        calHtml += `<div class="${cls}" title="День ${i}"></div>`;
    }
    calHtml += `</div>`;
    calHtml += `<div class="lc-cycle-legend">
        <span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot mens"></span>Менстр.</span>
        <span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot foll"></span>Фоллик.</span>
        <span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot ovul"></span>Овуляция</span>
        <span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot lut"></span>Лютеин.</span>
    </div>`;

    el.innerHTML = `
        ${calHtml}
        <div class="lc-info" style="margin-top:8px">
            <div><strong>Фаза:</strong> ${cm.phaseLabel(ph)}</div>
            <div><strong>День:</strong> ${c.currentDay} / ${c.length}</div>
            <div><strong>Фертильность:</strong> <span class="lc-fertility-dot ${fertCls}"></span><span class="${fertCls}">${fertLabel} (${Math.round(fert * 100)}%)</span></div>
            <div><strong>Либидо:</strong> ${cm.libido()}</div>
            <div><strong>Симптомы:</strong> ${cm.symptoms().join(", ") || "нет"}</div>
        </div>
        <div class="lc-btn-group" style="margin-top:8px">
            <button class="lc-btn lc-btn-sm" id="lc-cycle-to-mens">→ Менстр.</button>
            <button class="lc-btn lc-btn-sm" id="lc-cycle-to-ovul">→ Овуляция</button>
            <button class="lc-btn lc-btn-sm" id="lc-cycle-set-day">Уст. день</button>
            <button class="lc-btn lc-btn-sm" id="lc-cycle-skip">Пропустить цикл</button>
        </div>`;

    document.getElementById("lc-cycle-to-mens")?.addEventListener("click", () => { p.cycle.currentDay = 1; saveSettingsDebounced(); rebuildUI(); });
    document.getElementById("lc-cycle-to-ovul")?.addEventListener("click", () => { p.cycle.currentDay = ovDay; saveSettingsDebounced(); rebuildUI(); });
    document.getElementById("lc-cycle-set-day")?.addEventListener("click", () => {
        const d = parseInt(prompt("День цикла (1-" + c.length + "):", c.currentDay));
        if (d >= 1 && d <= c.length) { p.cycle.currentDay = d; saveSettingsDebounced(); rebuildUI(); }
    });
    document.getElementById("lc-cycle-skip")?.addEventListener("click", () => { p.cycle.currentDay = 1; p.cycle.cycleCount++; saveSettingsDebounced(); rebuildUI(); });
}

function refreshPregPanel() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-preg-panel");
    if (!el) return;
    const name = document.getElementById("lc-preg-char")?.value;
    const p = s.characters[name];
    if (!p) { el.innerHTML = ""; return; }

    if (!p.pregnancy?.active) {
        el.innerHTML = `<div class="lc-info-note">${name} не беременна.</div>`;
        return;
    }

    const pm = new PregnancyManager(p);
    const pr = p.pregnancy;
    const prog = Math.round((pr.week / pr.maxWeeks) * 100);

    el.innerHTML = `
        <div class="lc-progress"><div class="lc-progress-track"><div class="lc-progress-fill preg" style="width:${prog}%"></div></div><div class="lc-progress-label">${pr.week} / ${pr.maxWeeks} нед. (${prog}%)</div></div>
        <div class="lc-info">
            <div><strong>Триместр:</strong> ${pm.trimester()}</div>
            <div><strong>Размер плода:</strong> ${pm.fetalSize()}</div>
            <div><strong>Плодов:</strong> ${pr.fetusCount}</div>
            <div><strong>Отец:</strong> ${pr.father || "?"}</div>
            <div><strong>Симптомы:</strong> ${pm.symptoms().join(", ") || "нет"}</div>
            <div><strong>Шевеления:</strong> ${pm.movements()}</div>
            <div><strong>Прибавка:</strong> +${pm.weightGain()} кг</div>
            <div><strong>Изменения тела:</strong> ${pm.bodyChanges().join(", ") || "пока нет"}</div>
        </div>`;
}

function refreshLaborPanel() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-labor-panel");
    if (!el) return;
    const name = document.getElementById("lc-labor-char")?.value;
    const p = s.characters[name];
    if (!p) { el.innerHTML = ""; return; }

    if (!p.labor?.active) {
        el.innerHTML = `<div class="lc-info-note">${name} не в родах.</div>`;
        return;
    }

    const lm = new LaborManager(p);
    const l = p.labor;
    const curIdx = LABOR_STAGES.indexOf(l.stage);
    const dilProg = Math.round((l.dilation / 10) * 100);

    let stagesHtml = `<div class="lc-labor-stages">`;
    LABOR_STAGES.forEach((st, i) => {
        let cls = "lc-labor-dot";
        if (i < curIdx) cls += " done";
        if (i === curIdx) cls += " now";
        stagesHtml += `<div class="${cls}" title="${LABOR_LABELS[st]}"></div>`;
    });
    stagesHtml += `</div><div class="lc-labor-labels">`;
    LABOR_STAGES.forEach(st => { stagesHtml += `<span>${LABOR_LABELS[st]}</span>`; });
    stagesHtml += `</div>`;

    el.innerHTML = `
        ${stagesHtml}
        <div class="lc-progress" style="margin-top:8px"><div class="lc-progress-track"><div class="lc-progress-fill labor" style="width:${dilProg}%"></div></div><div class="lc-progress-label">Раскрытие: ${l.dilation}/10 см</div></div>
        <div class="lc-info" style="margin-top:6px">
            <div><strong>Стадия:</strong> ${LABOR_LABELS[l.stage]}</div>
            <div><strong>Описание:</strong> ${lm.description()}</div>
            <div><strong>Рождено:</strong> ${l.babiesDelivered} / ${l.totalBabies}</div>
        </div>`;
}

function refreshBabyList() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-baby-list");
    if (!el) return;
    const name = document.getElementById("lc-baby-parent")?.value;
    const p = s.characters[name];
    if (!p || !p.babies || p.babies.length === 0) { el.innerHTML = `<div class="lc-empty"><div class="lc-empty-text">Нет малышей</div></div>`; return; }

    let html = "";
    p.babies.forEach((b, i) => {
        const bm = new BabyManager(b);
        const wKg = (b.currentWeight / 1000).toFixed(1);
        html += `<div class="lc-baby-card">
            <div class="lc-baby-header"><span class="lc-baby-name">${b.name || "Безымянный"} (${b.sex === "M" ? "♂" : "♀"})</span><span class="lc-baby-age">${bm.ageLabel()}</span></div>
            <div class="lc-baby-body">
                <div>Вес: ${wKg} кг | Глаза: ${b.eyeColor} | Волосы: ${b.hairColor}</div>
                <div>Состояние: ${b.state}</div>
            </div>
            <div class="lc-btn-group" style="margin-top:4px">
                <button class="lc-btn lc-btn-sm lc-set-baby-age" data-parent="${name}" data-idx="${i}">Уст. возраст</button>
                <button class="lc-btn lc-btn-sm lc-btn-danger lc-remove-baby" data-parent="${name}" data-idx="${i}">🗑</button>
            </div>
        </div>`;
    });
    el.innerHTML = html;

    el.querySelectorAll(".lc-set-baby-age").forEach(btn => btn.addEventListener("click", function() {
        const pr = s.characters[this.dataset.parent]; const idx = +this.dataset.idx;
        if (!pr?.babies?.[idx]) return;
        const d = parseInt(prompt("Возраст (дни):", pr.babies[idx].ageDays));
        if (d >= 0) { pr.babies[idx].ageDays = d; new BabyManager(pr.babies[idx]).update(); saveSettingsDebounced(); rebuildUI(); }
    }));
    el.querySelectorAll(".lc-remove-baby").forEach(btn => btn.addEventListener("click", function() {
        const pr = s.characters[this.dataset.parent]; const idx = +this.dataset.idx;
        if (pr?.babies?.[idx] && confirm("Удалить?")) { pr.babies.splice(idx, 1); saveSettingsDebounced(); rebuildUI(); }
    }));
}

function refreshLogs() {
    const s = extension_settings[extensionName];
    const diceEl = document.getElementById("lc-dice-log");
    if (diceEl) {
        if (s.diceLog.length === 0) { diceEl.innerHTML = `<div class="lc-log-empty">Пусто</div>`; }
        else {
            diceEl.innerHTML = [...s.diceLog].reverse().slice(0, 20).map(e =>
                `<div class="lc-log-entry"><span class="${e.result ? "lc-log-success" : "lc-log-fail"}">${e.result ? "✅" : "❌"}</span> ${e.targetChar}: ${e.chance}% | 🎲${e.roll} | ${e.timestamp}</div>`
            ).join("");
        }
    }
    const intimEl = document.getElementById("lc-intim-log-list");
    if (intimEl) {
        if (s.intimacyLog.length === 0) { intimEl.innerHTML = `<div class="lc-log-empty">Пусто</div>`; }
        else {
            intimEl.innerHTML = [...s.intimacyLog].reverse().slice(0, 20).map(e =>
                `<div class="lc-log-entry">${(e.participants || []).join(" + ")} | ${e.type} | ${e.ejaculation} | ${e.timestamp}</div>`
            ).join("");
        }
    }
}

// ==========================================
// CHARACTER EDITOR
// ==========================================

function openEditor(name) {
    const s = extension_settings[extensionName];
    const p = s.characters[name];
    if (!p) return;
    s.editingCharacter = name;

    const ed = document.getElementById("lc-char-editor");
    if (!ed) return;
    ed.classList.remove("hidden");

    document.getElementById("lc-editor-title").textContent = "Редактирование: " + name;
    document.getElementById("lc-edit-bio-sex").value = p.bioSex || "F";
    document.getElementById("lc-edit-sec-sex").value = p.secondarySex || "";
    document.getElementById("lc-edit-contra").value = p.contraception || "none";
    document.getElementById("lc-edit-difficulty").value = p.pregnancyDifficulty || "normal";
    document.getElementById("lc-edit-eyes").value = p.eyeColor || "";
    document.getElementById("lc-edit-hair").value = p.hairColor || "";
    document.getElementById("lc-edit-enabled").checked = p._enabled !== false;

    if (p.cycle) {
        document.getElementById("lc-edit-cycle-on").checked = p.cycle.enabled;
        document.getElementById("lc-edit-cycle-len").value = p.cycle.baseLength || 28;
        document.getElementById("lc-edit-mens-dur").value = p.cycle.menstruationDuration || 5;
        document.getElementById("lc-edit-irreg").value = p.cycle.irregularity ?? 2;
        document.getElementById("lc-edit-symptom-int").value = p.cycle.symptomIntensity || "moderate";
    }
}

function saveEditor() {
    const s = extension_settings[extensionName];
    const name = s.editingCharacter;
    const p = s.characters[name];
    if (!p) return;

    p.bioSex = document.getElementById("lc-edit-bio-sex").value;
    p.secondarySex = document.getElementById("lc-edit-sec-sex").value || null;
    p.contraception = document.getElementById("lc-edit-contra").value;
    p.pregnancyDifficulty = document.getElementById("lc-edit-difficulty").value;
    p.eyeColor = document.getElementById("lc-edit-eyes").value;
    p.hairColor = document.getElementById("lc-edit-hair").value;
    p._enabled = document.getElementById("lc-edit-enabled").checked;

    if (p.cycle) {
        p.cycle.enabled = document.getElementById("lc-edit-cycle-on").checked;
        const len = parseInt(document.getElementById("lc-edit-cycle-len").value);
        if (len >= 21 && len <= 45) { p.cycle.baseLength = len; p.cycle.length = len; }
        const md = parseInt(document.getElementById("lc-edit-mens-dur").value);
        if (md >= 2 && md <= 8) p.cycle.menstruationDuration = md;
        const ir = parseInt(document.getElementById("lc-edit-irreg").value);
        if (ir >= 0 && ir <= 10) p.cycle.irregularity = ir;
        p.cycle.symptomIntensity = document.getElementById("lc-edit-symptom-int").value;
    }

    saveSettingsDebounced();
    closeEditor();
    rebuildUI();
    toastr.success(name + ": сохранено!");
}

function closeEditor() {
    extension_settings[extensionName].editingCharacter = null;
    document.getElementById("lc-char-editor")?.classList.add("hidden");
}

// ==========================================
// BIND ALL EVENTS
// ==========================================

function bindAll() {
    const s = extension_settings[extensionName];

    // Header
    document.getElementById("lc-enabled")?.addEventListener("change", function() { s.enabled = this.checked; saveSettingsDebounced(); });

    // Tabs
    document.querySelectorAll(".lifecycle-tab").forEach(tab => tab.addEventListener("click", function() {
        document.querySelectorAll(".lifecycle-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".lifecycle-tab-content").forEach(c => c.classList.remove("active"));
        this.classList.add("active");
        document.querySelector(`.lifecycle-tab-content[data-tab="${this.dataset.tab}"]`)?.classList.add("active");
        rebuildUI();
    }));

    // Characters
    document.getElementById("lc-sync-chars")?.addEventListener("click", () => { syncCharacters(); rebuildUI(); toastr.success("Синхронизировано!"); });
    document.getElementById("lc-add-manual")?.addEventListener("click", () => {
        const n = prompt("Имя:"); if (!n?.trim()) return;
        if (s.characters[n.trim()]) { toastr.warning("Уже существует!"); return; }
        s.characters[n.trim()] = makeProfile(n.trim(), false); saveSettingsDebounced(); rebuildUI();
    });

    // Editor
    document.getElementById("lc-editor-save")?.addEventListener("click", saveEditor);
    document.getElementById("lc-editor-cancel")?.addEventListener("click", closeEditor);

    // Cycle
    document.getElementById("lc-cycle-char")?.addEventListener("change", refreshCyclePanel);

    // Intimacy
    document.getElementById("lc-intim-log")?.addEventListener("click", () => {
        const target = document.getElementById("lc-intim-target")?.value;
        const partner = document.getElementById("lc-intim-partner")?.value;
        if (!target || !partner) { toastr.warning("Выберите участников!"); return; }
        IntimacyManager.log({
            participants: [target, partner],
            type: document.getElementById("lc-intim-type")?.value || "vaginal",
            ejaculation: document.getElementById("lc-intim-ejac")?.value || "inside",
        });
        toastr.success("Записано!"); rebuildUI();
    });

    document.getElementById("lc-intim-roll")?.addEventListener("click", () => {
        const target = document.getElementById("lc-intim-target")?.value;
        const partner = document.getElementById("lc-intim-partner")?.value;
        if (!target) { toastr.warning("Выберите цель!"); return; }
        const r = IntimacyManager.roll(target, {
            participants: [target, partner],
            type: document.getElementById("lc-intim-type")?.value || "vaginal",
            ejaculation: document.getElementById("lc-intim-ejac")?.value || "inside",
        });
        showDicePopup(r, target);
    });

    // Pregnancy
    document.getElementById("lc-preg-char")?.addEventListener("change", refreshPregPanel);
    document.getElementById("lc-preg-advance")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name];
        if (!p?.pregnancy?.active) return;
        new PregnancyManager(p).advanceDay(7); saveSettingsDebounced(); rebuildUI();
    });
    document.getElementById("lc-preg-set-week")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name];
        if (!p?.pregnancy?.active) return;
        const w = parseInt(prompt("Неделя:", p.pregnancy.week));
        if (w >= 1 && w <= p.pregnancy.maxWeeks) { p.pregnancy.week = w; p.pregnancy.day = 0; saveSettingsDebounced(); rebuildUI(); }
    });
    document.getElementById("lc-preg-to-labor")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name];
        if (!p?.pregnancy?.active) return;
        new LaborManager(p).start(); saveSettingsDebounced(); rebuildUI(); toastr.info(name + ": роды начались!");
    });
    document.getElementById("lc-preg-end")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name];
        if (!p?.pregnancy?.active) return;
        if (confirm("Прервать беременность?")) { p.pregnancy.active = false; if (p.cycle) p.cycle.enabled = true; saveSettingsDebounced(); rebuildUI(); }
    });

    // Labor
    document.getElementById("lc-labor-char")?.addEventListener("change", refreshLaborPanel);
    document.getElementById("lc-labor-advance")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name];
        if (!p?.labor?.active) return;
        new LaborManager(p).advance(); saveSettingsDebounced(); rebuildUI();
    });
    document.getElementById("lc-labor-deliver")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name];
        if (!p?.labor?.active) return;
        const baby = BabyManager.generate(p, p.pregnancy?.father || "?");
        baby.name = prompt("Имя ребёнка:", "") || "Малыш " + ((p.babies?.length || 0) + 1);
        if (!p.babies) p.babies = [];
        p.babies.push(baby);
        new LaborManager(p).deliver(); saveSettingsDebounced(); rebuildUI();
        toastr.success(name + " родила " + (baby.sex === "M" ? "мальчика" : "девочку") + ": " + baby.name + "!");
    });
    document.getElementById("lc-labor-set-dil")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name];
        if (!p?.labor?.active) return;
        const d = parseInt(prompt("Раскрытие (0-10):", p.labor.dilation));
        if (d >= 0 && d <= 10) { p.labor.dilation = d; saveSettingsDebounced(); rebuildUI(); }
    });
    document.getElementById("lc-labor-end")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name];
        if (!p?.labor?.active) return;
        if (confirm("Завершить роды?")) { new LaborManager(p).end(); saveSettingsDebounced(); rebuildUI(); }
    });

    // Babies
    document.getElementById("lc-baby-parent")?.addEventListener("change", refreshBabyList);

    // Settings
    document.getElementById("lc-auto-sync")?.addEventListener("change", function() { s.autoSyncCharacters = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-auto-time")?.addEventListener("change", function() { s.autoTimeProgress = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-time-confirm")?.addEventListener("change", function() { s.timeParserConfirmation = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-time-sens")?.addEventListener("change", function() { s.timeParserSensitivity = this.value; saveSettingsDebounced(); });

    // Date
    document.getElementById("lc-date-apply")?.addEventListener("click", () => {
        s.worldDate.year = parseInt(document.getElementById("lc-date-y")?.value) || 2025;
        s.worldDate.month = clamp(parseInt(document.getElementById("lc-date-m")?.value) || 1, 1, 12);
        s.worldDate.day = clamp(parseInt(document.getElementById("lc-date-d")?.value) || 1, 1, 31);
        s.worldDate.hour = clamp(parseInt(document.getElementById("lc-date-h")?.value) || 12, 0, 23);
        saveSettingsDebounced(); rebuildUI();
    });
    document.getElementById("lc-date-plus1")?.addEventListener("click", () => { s.worldDate = addDays(s.worldDate, 1); TimeParser.advanceAll(1); saveSettingsDebounced(); rebuildUI(); });
    document.getElementById("lc-date-plus7")?.addEventListener("click", () => { s.worldDate = addDays(s.worldDate, 7); TimeParser.advanceAll(7); saveSettingsDebounced(); rebuildUI(); });
    document.getElementById("lc-date-frozen")?.addEventListener("change", function() { s.worldDate.frozen = this.checked; saveSettingsDebounced(); });

    // Modules
    const mods = { "lc-mod-cycle": "cycle", "lc-mod-preg": "pregnancy", "lc-mod-labor": "labor", "lc-mod-baby": "baby", "lc-mod-intim": "intimacy", "lc-mod-au": "auOverlay" };
    for (const [id, key] of Object.entries(mods)) {
        document.getElementById(id)?.addEventListener("change", function() { s.modules[key] = this.checked; saveSettingsDebounced(); rebuildUI(); });
    }

    // Prompt injection
    document.getElementById("lc-prompt-on")?.addEventListener("change", function() { s.promptInjectionEnabled = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-prompt-pos")?.addEventListener("change", function() { s.promptInjectionPosition = this.value; saveSettingsDebounced(); });
    document.getElementById("lc-prompt-detail")?.addEventListener("change", function() { s.promptInjectionDetail = this.value; saveSettingsDebounced(); });

    // AU
    document.getElementById("lc-au-preset")?.addEventListener("change", function() { s.auPreset = this.value; saveSettingsDebounced(); });

    // Export / Import
    document.getElementById("lc-export")?.addEventListener("click", () => downloadJSON(s, "lifecycle-backup.json"));
    document.getElementById("lc-import")?.addEventListener("click", () => uploadJSON(data => { Object.assign(s, deepMerge(defaultSettings, data)); saveSettingsDebounced(); rebuildUI(); toastr.success("Импортировано!"); }));
    document.getElementById("lc-reset")?.addEventListener("click", () => { if (confirm("СБРОС ВСЕХ ДАННЫХ?")) { Object.assign(s, JSON.parse(JSON.stringify(defaultSettings))); saveSettingsDebounced(); rebuildUI(); toastr.info("Сброшено."); } });
}

// ==========================================
// ST EVENT HOOKS
// ==========================================

function onMessage(idx) {
    const s = extension_settings[extensionName];
    if (!s.enabled || s.worldDate.frozen) return;
    const ctx = getContext();
    if (!ctx.chat || idx < 0) return;
    const msg = ctx.chat[idx];
    if (!msg || !msg.mes) return;

    if (s.autoSyncCharacters) syncCharacters();

    if (s.autoTimeProgress && !msg.is_user) {
        const days = TimeParser.parse(msg.mes);
        if (days) {
            if (s.timeParserConfirmation) {
                if (confirm("LifeCycle: обнаружен сдвиг +" + days + " дн. Применить?")) { TimeParser.apply(days); rebuildUI(); }
            } else { TimeParser.apply(days); rebuildUI(); }
        }
    }
}

function onChatChanged() {
    const s = extension_settings[extensionName];
    if (s.autoSyncCharacters) syncCharacters();
    rebuildUI();
}

// ==========================================
// INIT
// ==========================================

jQuery(async () => {
    if (!extension_settings[extensionName]) extension_settings[extensionName] = {};
    extension_settings[extensionName] = deepMerge(defaultSettings, extension_settings[extensionName]);

    const html = generateHTML();
    $("#extensions_settings").append(html);

    bindAll();
    syncCharacters();
    rebuildUI();

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessage);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // Prompt injection
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (data) => {
        const s = extension_settings[extensionName];
        if (!s.enabled || !s.promptInjectionEnabled) return;
        const inj = PromptInjector.generate();
        if (!inj) return;
        switch (s.promptInjectionPosition) {
            case "system": if (data.systemPrompt !== undefined) data.systemPrompt += "\n\n" + inj; break;
            case "authornote": data.authorNote = (data.authorNote || "") + "\n\n" + inj; break;
            case "endofchat": if (data.chat && Array.isArray(data.chat)) data.chat.push({ role: "system", content: inj }); break;
        }
    });

    console.log("[LifeCycle] v0.3.0 loaded!");
});

// ==========================================
// GLOBAL API
// ==========================================

window.LifeCycle = {
    getSettings: () => extension_settings[extensionName],
    getInjection: () => PromptInjector.generate(),
    syncCharacters,
    advanceTime: d => { const s = extension_settings[extensionName]; s.worldDate = addDays(s.worldDate, d); TimeParser.advanceAll(d); saveSettingsDebounced(); rebuildUI(); },
    rollDice: (char, data) => IntimacyManager.roll(char, data),
};
