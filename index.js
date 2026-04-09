// ============================================================
// LifeCycle Extension v0.3.1 — index.js (Full + AU)
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
        name, bioSex: "F", secondarySex: null, race: "human",
        contraception: "none", eyeColor: "", hairColor: "",
        pregnancyDifficulty: "normal",
        _isUser: isUser, _enabled: true,
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

        // Max weeks based on AU
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
            latent: "Лёгкие схватки каждые 15-20 мин, раскрытие 0-3 см. Можно ходить и разговаривать.",
            active: "Сильные схватки каждые 3-5 мин по 50-60 сек, раскрытие 4-7 см. Сложно говорить.",
            transition: "Пиковые схватки каждые 1-2 мин по 60-90 сек, раскрытие 7-10 см. Тошнота, дрожь, паника.",
            pushing: "Полное раскрытие. Рефлекторные потуги, давление вниз. Головка прорезывается.",
            birth: "Выход головки, разворот плечиков, скольжение тела. Первый крик.",
            placenta: "Рождение плаценты, сокращение матки, прикладывание к груди.",
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

        // Heat bonus already included in CycleManager.fertility()

        const contraEff = { none: 0, condom: 0.85, pill: 0.91, iud: 0.99, withdrawal: 0.73, patch: 0.91, injection: 0.94 }[p.contraception] || 0;
        fert *= (1 - contraEff);

        if (data.ejaculation === "outside") fert *= 0.05;
        if (data.ejaculation === "na") fert = 0;
        if (data.type === "anal" || data.type === "oral") fert = 0;
        if (p.pregnancy?.active) fert = 0;

        // Bio sex check
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
            contraception: p.contraception, actType: data.type, ejaculation: data.ejaculation,
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
        ];

        for (const [re, mult] of pats) {
            let m; while ((m = re.exec(msg)) !== null) days += parseInt(m[1]) * mult;
        }

        if (sens !== "low") {
            if (/на следующ(?:ий|ее|ую)\s+(?:день|утро)/i.test(msg)) days += 1;
            if (/через\s+пару\s+дней/i.test(msg)) days += 2;
            if (/через\s+несколько\s+дней/i.test(msg)) days += 3;
            if (/на следующ(?:ей|ую)\s+неделе/i.test(msg)) days += 7;
        }

        if (sens === "high") {
            if (/прошёл\s+месяц/i.test(msg) || /прошла\s+неделя/i.test(msg)) {
                if (/месяц/i.test(msg)) days += 30;
                if (/неделя/i.test(msg)) days += 7;
            }
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

            // Cycle
            if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
                new CycleManager(p).advance(days);
            }

            // Pregnancy
            if (s.modules.pregnancy && p.pregnancy?.active) {
                new PregnancyManager(p).advanceDay(days);
            }

            // AU Omegaverse: Heat & Rut
            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.secondarySex) {
                const auS = s.auSettings.omegaverse;

                // Omega heat
                if (p.secondarySex === "omega" && p.heat && !p.heat.onSuppressants) {
                    if (p.heat.active) {
                        p.heat.currentDay += days;
                        if (p.heat.currentDay > p.heat.duration) {
                            p.heat.active = false;
                            p.heat.currentDay = 0;
                            p.heat.daysSinceLast = 0;
                        }
                    } else {
                        p.heat.daysSinceLast = (p.heat.daysSinceLast || 0) + days;
                        if (p.heat.daysSinceLast >= auS.heatCycleLength) {
                            p.heat.active = true;
                            p.heat.currentDay = 1;
                            p.heat.duration = auS.heatDuration;
                            p.heat.intensity = "severe";
                        }
                    }
                }

                // Alpha rut
                if (p.secondarySex === "alpha" && p.rut) {
                    if (p.rut.active) {
                        p.rut.currentDay += days;
                        if (p.rut.currentDay > p.rut.duration) {
                            p.rut.active = false;
                            p.rut.currentDay = 0;
                            p.rut.daysSinceLast = 0;
                        }
                    } else {
                        p.rut.daysSinceLast = (p.rut.daysSinceLast || 0) + days;
                        if (p.rut.daysSinceLast >= auS.heatCycleLength + 5) {
                            p.rut.active = true;
                            p.rut.currentDay = 1;
                            p.rut.duration = auS.rutDuration;
                            p.rut.intensity = "moderate";
                        }
                    }
                }
            }

            // Baby aging
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

            // AU secondary sex
            if (s.modules.auOverlay && s.auPreset === "omegaverse" && p.secondarySex) {
                lines.push("Secondary Sex: " + p.secondarySex);
            }

            // Heat
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

            // Cycle
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

            // Pregnancy
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

            // Labor
            if (s.modules.labor && p.labor?.active) {
                const lm = new LaborManager(p);
                lines.push("IN LABOR: " + LABOR_LABELS[p.labor.stage] + ", Dilation: " + p.labor.dilation + "cm");
                lines.push("Contractions: every " + p.labor.contractionInterval + "min, " + p.labor.contractionDuration + "sec");
                if (det !== "low") {
                    lines.push(lm.description());
                }
            }

            // Babies
            if (s.modules.baby && p.babies?.length > 0 && det !== "low") {
                p.babies.forEach(b => {
                    const bm = new BabyManager(b);
                    lines.push("Baby: " + (b.name || "unnamed") + " (" + (b.sex === "M" ? "boy" : "girl") + ", " + bm.ageLabel() + ", " + b.state + ")");
                });
            }

            if (p.contraception && p.contraception !== "none") lines.push("Contraception: " + p.contraception);
        });

        lines.push("\n[AI Instructions]");
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
// DICE POPUP
// ==========================================

function showDicePopup(result, target) {
    document.querySelector(".lc-overlay")?.remove();
    document.querySelector(".lc-popup")?.remove();

    const ov = document.createElement("div"); ov.className = "lc-overlay";
    const pop = document.createElement("div"); pop.className = "lc-popup";

    const cls = result.result ? "success" : "fail";
    const txt = result.result ? "ЗАЧАТИЕ ПРОИЗОШЛО!" : "Зачатие не произошло";

    pop.innerHTML = `<div class="lc-popup-title">🎲 Бросок фертильности</div>
        <div class="lc-popup-details">
            <div><strong>Персонаж:</strong> ${target}</div>
            <div><strong>Шанс:</strong> ${result.chance}%</div>
            <div><strong>Контрацепция:</strong> ${result.contraception}</div>
            <div><strong>Тип акта:</strong> ${result.actType}</div>
            <div><strong>Эякуляция:</strong> ${result.ejaculation}</div>
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
            if (p) {
                new PregnancyManager(p).start(result.participants?.find(x => x !== target) || "?", 1);
                saveSettingsDebounced();
                rebuildUI();
            }
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
        rd.onload = ev => { try { cb(JSON.parse(ev.target.result)); } catch (err) { toastr.error("JSON ошибка: " + err.message); } };
        rd.readAsText(f);
    });
    inp.click();
}

// ==========================================
// HTML GENERATION
// ==========================================

function buildCharSelect(id, extraCls) {
    const names = Object.keys(extension_settings[extensionName].characters);
    const opts = names.map(n => '<option value="' + n + '">' + n + '</option>').join("");
    return '<select id="' + id + '" class="lc-select ' + (extraCls || "lc-char-select") + '">' + opts + '</select>';
}

function generateHTML() {
    const s = extension_settings[extensionName];

    return '<div class="lifecycle-panel" id="lifecycle-panel">' +

        // HEADER
        '<div class="lifecycle-header">' +
            '<div class="lifecycle-header-title"><h3>LifeCycle</h3><span class="lc-version">v0.3.1</span></div>' +
            '<div class="lifecycle-header-actions"><label class="lc-switch"><input type="checkbox" id="lc-enabled" ' + (s.enabled ? "checked" : "") + '><span class="lc-switch-slider"></span></label></div>' +
        '</div>' +

        // DASHBOARD
        '<div class="lc-dashboard" id="lc-dashboard">' +
            '<div class="lc-dashboard-date" id="lc-dashboard-date"></div>' +
            '<div id="lc-dashboard-items"></div>' +
        '</div>' +

        // TABS
        '<div class="lifecycle-tabs">' +
            '<button class="lifecycle-tab active" data-tab="chars"><span class="tab-icon">👥</span>Персонажи</button>' +
            '<button class="lifecycle-tab" data-tab="cycle"><span class="tab-icon">🔴</span>Цикл</button>' +
            '<button class="lifecycle-tab" data-tab="intim"><span class="tab-icon">🔥</span>Интим</button>' +
            '<button class="lifecycle-tab" data-tab="preg"><span class="tab-icon">🤰</span>Берем.</button>' +
            '<button class="lifecycle-tab" data-tab="labor"><span class="tab-icon">🏥</span>Роды</button>' +
            '<button class="lifecycle-tab" data-tab="babies"><span class="tab-icon">👶</span>Малыши</button>' +
            '<button class="lifecycle-tab" data-tab="settings"><span class="tab-icon">⚙️</span>Настройки</button>' +
        '</div>' +

        // TAB: CHARACTERS
        '<div class="lifecycle-tab-content active" data-tab="chars">' +
            '<div class="lc-btn-group" style="margin-bottom:8px">' +
                '<button id="lc-sync-chars" class="lc-btn lc-btn-primary">🔄 Синхронизировать</button>' +
                '<button id="lc-add-manual" class="lc-btn">+ Вручную</button>' +
            '</div>' +
            '<div id="lc-char-list"></div>' +

            // INLINE EDITOR
            '<div id="lc-char-editor" class="lc-editor hidden">' +
                '<div class="lc-editor-title" id="lc-editor-title">Редактирование</div>' +
                '<div class="lc-editor-grid">' +
                    '<div class="lc-editor-field"><label>Биол. пол</label><select id="lc-edit-bio-sex" class="lc-select"><option value="F">Женский</option><option value="M">Мужской</option></select></div>' +
                    '<div class="lc-editor-field"><label>Втор. пол (AU)</label><select id="lc-edit-sec-sex" class="lc-select"><option value="">Нет</option><option value="alpha">Альфа</option><option value="beta">Бета</option><option value="omega">Омега</option></select></div>' +
                    '<div class="lc-editor-field"><label>Раса (AU)</label><select id="lc-edit-race" class="lc-select"><option value="human">Человек</option><option value="elf">Эльф</option><option value="dwarf">Дварф</option><option value="orc">Орк</option><option value="halfling">Полурослик</option></select></div>' +
                    '<div class="lc-editor-field"><label>Контрацепция</label><select id="lc-edit-contra" class="lc-select"><option value="none">Нет</option><option value="condom">Презерватив</option><option value="pill">ОК</option><option value="iud">ВМС</option><option value="patch">Пластырь</option><option value="injection">Инъекция</option><option value="withdrawal">Прерванный</option></select></div>' +
                    '<div class="lc-editor-field"><label>Сложность берем.</label><select id="lc-edit-difficulty" class="lc-select"><option value="easy">Лёгкая</option><option value="normal">Нормальная</option><option value="hard">Тяжёлая</option><option value="complicated">С осложнениями</option></select></div>' +
                    '<div class="lc-editor-field"><label>Цвет глаз</label><input type="text" id="lc-edit-eyes" class="lc-input" placeholder="карие"></div>' +
                    '<div class="lc-editor-field"><label>Цвет волос</label><input type="text" id="lc-edit-hair" class="lc-input" placeholder="тёмные"></div>' +
                    '<div class="lc-editor-field full-width"><label class="lc-checkbox"><input type="checkbox" id="lc-edit-enabled" checked><span>Трекинг включён</span></label></div>' +
                    '<div class="lc-editor-field full-width" style="margin-top:6px"><h5 style="margin:0 0 4px;font-size:11px;color:var(--SmartThemeBodyColor)">Настройки цикла</h5></div>' +
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
                '<div class="lc-section-title"><h4>Новый акт</h4></div>' +
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

            // General
            '<div class="lc-section">' +
                '<div class="lc-section-title"><h4>Общие</h4></div>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-sync" ' + (s.autoSyncCharacters ? "checked" : "") + '><span>Авто-синхронизация персонажей</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-time" ' + (s.autoTimeProgress ? "checked" : "") + '><span>Авто-парсинг времени</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-time-confirm" ' + (s.timeParserConfirmation ? "checked" : "") + '><span>Подтверждение сдвига</span></label>' +
                '<div class="lc-row"><label>Чувствительность:</label><select id="lc-time-sens" class="lc-select">' +
                    '<option value="low"' + (s.timeParserSensitivity === "low" ? " selected" : "") + '>Низкая</option>' +
                    '<option value="medium"' + (s.timeParserSensitivity === "medium" ? " selected" : "") + '>Средняя</option>' +
                    '<option value="high"' + (s.timeParserSensitivity === "high" ? " selected" : "") + '>Высокая</option>' +
                '</select></div>' +
            '</div>' +

            // World date
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

            // Modules
            '<div class="lc-section">' +
                '<div class="lc-section-title"><h4>Модули</h4></div>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-cycle" ' + (s.modules.cycle ? "checked" : "") + '><span>Цикл</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-preg" ' + (s.modules.pregnancy ? "checked" : "") + '><span>Беременность</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-labor" ' + (s.modules.labor ? "checked" : "") + '><span>Роды</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-baby" ' + (s.modules.baby ? "checked" : "") + '><span>Малыши</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-intim" ' + (s.modules.intimacy ? "checked" : "") + '><span>Интим-трекер</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-mod-au" ' + (s.modules.auOverlay ? "checked" : "") + '><span>AU-оверлей</span></label>' +
            '</div>' +

            // Prompt injection
            '<div class="lc-section">' +
                '<div class="lc-section-title"><h4>Инъекция в промпт</h4></div>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-prompt-on" ' + (s.promptInjectionEnabled ? "checked" : "") + '><span>Включена</span></label>' +
                '<div class="lc-row"><label>Позиция:</label><select id="lc-prompt-pos" class="lc-select">' +
                    '<option value="system"' + (s.promptInjectionPosition === "system" ? " selected" : "") + '>System Prompt</option>' +
                    '<option value="authornote"' + (s.promptInjectionPosition === "authornote" ? " selected" : "") + '>Author Note</option>' +
                    '<option value="endofchat"' + (s.promptInjectionPosition === "endofchat" ? " selected" : "") + '>End of Chat</option>' +
                '</select></div>' +
                '<div class="lc-row"><label>Детальность:</label><select id="lc-prompt-detail" class="lc-select">' +
                    '<option value="low"' + (s.promptInjectionDetail === "low" ? " selected" : "") + '>Минимальная</option>' +
                    '<option value="medium"' + (s.promptInjectionDetail === "medium" ? " selected" : "") + '>Средняя</option>' +
                    '<option value="high"' + (s.promptInjectionDetail === "high" ? " selected" : "") + '>Подробная</option>' +
                '</select></div>' +
            '</div>' +

            // AU Settings
            '<div class="lc-section">' +
                '<div class="lc-section-title"><h4>AU-пресет</h4></div>' +
                '<div class="lc-row"><label>Пресет:</label><select id="lc-au-preset" class="lc-select">' +
                    '<option value="realism"' + (s.auPreset === "realism" ? " selected" : "") + '>Реализм</option>' +
                    '<option value="omegaverse"' + (s.auPreset === "omegaverse" ? " selected" : "") + '>Омегаверс</option>' +
                    '<option value="fantasy"' + (s.auPreset === "fantasy" ? " selected" : "") + '>Фэнтези</option>' +
                    '<option value="scifi"' + (s.auPreset === "scifi" ? " selected" : "") + '>Sci-Fi</option>' +
                '</select></div>' +
                '<div id="lc-au-panel"></div>' +
            '</div>' +

            // Export/Import
            '<div class="lc-section">' +
                '<div class="lc-section-title"><h4>Данные</h4></div>' +
                '<div class="lc-btn-group">' +
                    '<button id="lc-export" class="lc-btn">📤 Экспорт</button>' +
                    '<button id="lc-import" class="lc-btn">📥 Импорт</button>' +
                    '<button id="lc-reset" class="lc-btn lc-btn-danger">🗑 Сброс</button>' +
                '</div>' +
            '</div>' +

        '</div>' + // end settings tab

    '</div>'; // end panel
}

// ==========================================
// AU SETTINGS RENDER
// ==========================================

function renderAUSettings() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-au-panel");
    if (!el) return;

    if (!s.modules.auOverlay) {
        el.innerHTML = '<div class="lc-info-note">AU-оверлей выключен. Включите в "Модули".</div>';
        return;
    }

    if (s.auPreset === "realism") {
        el.innerHTML = '<div class="lc-info-note">Реализм: стандартная биология, без AU-модификаций.</div>';
        return;
    }

    if (s.auPreset === "omegaverse") {
        const au = s.auSettings.omegaverse;
        el.innerHTML =
            '<div class="lc-section" style="margin-top:8px">' +
                '<div class="lc-section-title"><h4>Омегаверс</h4></div>' +
                '<div class="lc-row"><label>Цикл течки (дни)</label><input type="number" id="lc-au-ov-heat-cycle" class="lc-input" style="width:60px" min="7" max="180" value="' + au.heatCycleLength + '"></div>' +
                '<div class="lc-row"><label>Длит. течки (дни)</label><input type="number" id="lc-au-ov-heat-dur" class="lc-input" style="width:60px" min="1" max="14" value="' + au.heatDuration + '"></div>' +
                '<div class="lc-row"><label>Бонус ферт. в течку</label><input type="number" id="lc-au-ov-heat-fert" class="lc-input" style="width:60px" min="0" max="1" step="0.05" value="' + au.heatFertilityBonus + '"></div>' +
                '<div class="lc-row"><label>Длит. гона (дни)</label><input type="number" id="lc-au-ov-rut-dur" class="lc-input" style="width:60px" min="1" max="14" value="' + au.rutDuration + '"></div>' +
                '<div class="lc-row"><label>Берем. (недели)</label><input type="number" id="lc-au-ov-preg-weeks" class="lc-input" style="width:60px" min="20" max="50" value="' + (au.pregnancyWeeks || 36) + '"></div>' +
                '<div class="lc-row"><label>Узел длит. (мин)</label><input type="number" id="lc-au-ov-knot-dur" class="lc-input" style="width:60px" min="5" max="60" value="' + (au.knotDurationMin || 15) + '"></div>' +
                '<hr class="lc-sep">' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-au-ov-knot" ' + (au.knotEnabled ? "checked" : "") + '><span>Узел (Knot)</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-au-ov-bond" ' + (au.bondingEnabled ? "checked" : "") + '><span>Связь / Метка (Bond)</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-au-ov-suppress" ' + (au.suppressantsAvailable ? "checked" : "") + '><span>Подавители доступны</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-au-ov-mpreg" ' + (au.maleOmegaPregnancy ? "checked" : "") + '><span>Мужская беременность (омеги)</span></label>' +
                '<div class="lc-row" style="margin-top:6px"><label>Тип связи:</label><select id="lc-au-ov-bond-type" class="lc-select">' +
                    '<option value="bite_mark"' + (au.bondType === "bite_mark" ? " selected" : "") + '>Укус</option>' +
                    '<option value="magical"' + (au.bondType === "magical" ? " selected" : "") + '>Магическая</option>' +
                    '<option value="mental"' + (au.bondType === "mental" ? " selected" : "") + '>Ментальная</option>' +
                    '<option value="scent"' + (au.bondType === "scent" ? " selected" : "") + '>Запаховая метка</option>' +
                '</select></div>' +
            '</div>';

        document.getElementById("lc-au-ov-heat-cycle")?.addEventListener("change", function() { au.heatCycleLength = parseInt(this.value) || 30; saveSettingsDebounced(); });
        document.getElementById("lc-au-ov-heat-dur")?.addEventListener("change", function() { au.heatDuration = parseInt(this.value) || 5; saveSettingsDebounced(); });
        document.getElementById("lc-au-ov-heat-fert")?.addEventListener("change", function() { au.heatFertilityBonus = parseFloat(this.value) || 0.35; saveSettingsDebounced(); });
        document.getElementById("lc-au-ov-rut-dur")?.addEventListener("change", function() { au.rutDuration = parseInt(this.value) || 4; saveSettingsDebounced(); });
        document.getElementById("lc-au-ov-preg-weeks")?.addEventListener("change", function() { au.pregnancyWeeks = parseInt(this.value) || 36; saveSettingsDebounced(); });
        document.getElementById("lc-au-ov-knot-dur")?.addEventListener("change", function() { au.knotDurationMin = parseInt(this.value) || 15; saveSettingsDebounced(); });
        document.getElementById("lc-au-ov-knot")?.addEventListener("change", function() { au.knotEnabled = this.checked; saveSettingsDebounced(); });
        document.getElementById("lc-au-ov-bond")?.addEventListener("change", function() { au.bondingEnabled = this.checked; saveSettingsDebounced(); });
        document.getElementById("lc-au-ov-suppress")?.addEventListener("change", function() { au.suppressantsAvailable = this.checked; saveSettingsDebounced(); });
        document.getElementById("lc-au-ov-mpreg")?.addEventListener("change", function() { au.maleOmegaPregnancy = this.checked; saveSettingsDebounced(); });
        document.getElementById("lc-au-ov-bond-type")?.addEventListener("change", function() { au.bondType = this.value; saveSettingsDebounced(); });
        return;
    }

    if (s.auPreset === "fantasy") {
        const au = s.auSettings.fantasy;
        const raceLabels = { human: "Человек", elf: "Эльф", dwarf: "Дварф", orc: "Орк", halfling: "Полурослик" };
        let raceRows = "";
        Object.entries(au.pregnancyByRace).forEach(([race, weeks]) => {
            raceRows += '<div class="lc-row"><label>' + (raceLabels[race] || race) + '</label>' +
                '<input type="number" class="lc-input lc-au-fantasy-race" data-race="' + race + '" style="width:60px" min="10" max="120" value="' + weeks + '">' +
                '<span style="font-size:10px;color:var(--SmartThemeQuoteColor)">нед.</span></div>';
        });

        el.innerHTML =
            '<div class="lc-section" style="margin-top:8px">' +
                '<div class="lc-section-title"><h4>Фэнтези</h4></div>' +
                '<p class="lc-section-hint" style="font-size:10px;color:var(--SmartThemeQuoteColor);margin-bottom:6px">Длительность беременности по расам:</p>' +
                raceRows +
                '<div class="lc-row" style="margin-top:6px">' +
                    '<input type="text" id="lc-au-fant-new-race" class="lc-input" placeholder="dragon" style="width:80px">' +
                    '<input type="number" id="lc-au-fant-new-wk" class="lc-input" placeholder="40" style="width:50px" min="10" max="120">' +
                    '<button id="lc-au-fant-add" class="lc-btn lc-btn-sm">+ Раса</button>' +
                '</div>' +
                '<hr class="lc-sep">' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-au-fant-features" ' + (au.nonHumanFeatures ? "checked" : "") + '><span>Нечеловеческие черты у детей</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-au-fant-magic" ' + (au.magicalComplications ? "checked" : "") + '><span>Магические осложнения</span></label>' +
            '</div>';

        document.querySelectorAll(".lc-au-fantasy-race").forEach(inp => {
            inp.addEventListener("change", function() { au.pregnancyByRace[this.dataset.race] = parseInt(this.value) || 40; saveSettingsDebounced(); });
        });
        document.getElementById("lc-au-fant-add")?.addEventListener("click", () => {
            const rn = document.getElementById("lc-au-fant-new-race")?.value?.trim();
            const rw = parseInt(document.getElementById("lc-au-fant-new-wk")?.value) || 40;
            if (!rn) { toastr.warning("Введите расу!"); return; }
            au.pregnancyByRace[rn] = rw; saveSettingsDebounced(); renderAUSettings(); toastr.success("Раса добавлена!");
        });
        document.getElementById("lc-au-fant-features")?.addEventListener("change", function() { au.nonHumanFeatures = this.checked; saveSettingsDebounced(); });
        document.getElementById("lc-au-fant-magic")?.addEventListener("change", function() { au.magicalComplications = this.checked; saveSettingsDebounced(); });
        return;
    }

    if (s.auPreset === "scifi") {
        const au = s.auSettings.scifi;
        el.innerHTML =
            '<div class="lc-section" style="margin-top:8px">' +
                '<div class="lc-section-title"><h4>Sci-Fi</h4></div>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-au-scifi-womb" ' + (au.artificialWomb ? "checked" : "") + '><span>Искусственная матка</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-au-scifi-gene" ' + (au.geneticModification ? "checked" : "") + '><span>Генная модификация</span></label>' +
                '<label class="lc-checkbox"><input type="checkbox" id="lc-au-scifi-growth" ' + (au.acceleratedGrowth ? "checked" : "") + '><span>Ускоренный рост</span></label>' +
            '</div>';

        document.getElementById("lc-au-scifi-womb")?.addEventListener("change", function() { au.artificialWomb = this.checked; saveSettingsDebounced(); });
        document.getElementById("lc-au-scifi-gene")?.addEventListener("change", function() { au.geneticModification = this.checked; saveSettingsDebounced(); });
        document.getElementById("lc-au-scifi-growth")?.addEventListener("change", function() { au.acceleratedGrowth = this.checked; saveSettingsDebounced(); });
        return;
    }

    el.innerHTML = '<div class="lc-info-note">Выберите AU-пресет.</div>';
}

// ==========================================
// UI REFRESH FUNCTIONS
// ==========================================

function rebuildUI() {
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
        sel.innerHTML = names.map(n => '<option value="' + n + '">' + n + '</option>').join("");
        if (names.includes(cur)) sel.value = cur;
    });
}

function refreshCharList() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-char-list");
    if (!el) return;

    if (Object.keys(s.characters).length === 0) {
        el.innerHTML = '<div class="lc-empty"><div class="lc-empty-text">Нет персонажей. Нажмите "Синхронизировать".</div></div>';
        return;
    }

    let html = "";
    Object.entries(s.characters).forEach(([name, p]) => {
        let tags = "";
        if (p._isUser) tags += '<span class="lc-tag lc-tag-neutral">USER</span>';
        if (!p._enabled) tags += '<span class="lc-tag lc-tag-neutral">OFF</span>';

        if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
            const cm = new CycleManager(p);
            tags += '<span class="lc-tag lc-tag-cycle">' + cm.phaseLabel(cm.phase()) + '</span>';
        }
        if (s.modules.pregnancy && p.pregnancy?.active) tags += '<span class="lc-tag lc-tag-preg">Нед.' + p.pregnancy.week + '</span>';
        if (s.modules.labor && p.labor?.active) tags += '<span class="lc-tag lc-tag-labor">' + LABOR_LABELS[p.labor.stage] + '</span>';

        // AU tags
        if (s.modules.auOverlay && s.auPreset === "omegaverse") {
            if (p.secondarySex) tags += '<span class="lc-tag lc-tag-neutral">' + p.secondarySex + '</span>';
            if (p.heat?.active) tags += '<span class="lc-tag lc-tag-heat">Течка д.' + p.heat.currentDay + '</span>';
            if (p.rut?.active) tags += '<span class="lc-tag lc-tag-rut">Гон д.' + p.rut.currentDay + '</span>';
            if (p.heat?.onSuppressants) tags += '<span class="lc-tag lc-tag-neutral">💊</span>';
        }

        if (p.babies?.length > 0) tags += '<span class="lc-tag lc-tag-baby">👶' + p.babies.length + '</span>';

        const sex = p.bioSex === "M" ? "М" : "Ж";
        const sec = p.secondarySex ? " / " + p.secondarySex : "";
        const contra = p.contraception !== "none" ? " | " + p.contraception : "";

        html += '<div class="lc-char-card">' +
            '<div class="lc-char-card-header"><span class="lc-char-card-name">' + name + '</span><div class="lc-char-card-tags">' + tags + '</div></div>' +
            '<div class="lc-char-card-meta">' + sex + sec + contra + '</div>' +
            '<div class="lc-char-card-actions">' +
                '<button class="lc-btn lc-btn-sm lc-edit-char" data-char="' + name + '">✏️ Ред.</button>' +
                '<button class="lc-btn lc-btn-sm lc-btn-danger lc-delete-char" data-char="' + name + '">🗑</button>' +
            '</div></div>';
    });
    el.innerHTML = html;

    el.querySelectorAll(".lc-edit-char").forEach(btn => btn.addEventListener("click", function() { openEditor(this.dataset.char); }));
    el.querySelectorAll(".lc-delete-char").forEach(btn => btn.addEventListener("click", function() {
        if (confirm('Удалить "' + this.dataset.char + '"?')) { delete s.characters[this.dataset.char]; saveSettingsDebounced(); closeEditor(); rebuildUI(); }
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

        if (s.modules.auOverlay && s.auPreset === "omegaverse") {
            if (p.heat?.active) parts.push("🔥 Течка д." + p.heat.currentDay);
            if (p.rut?.active) parts.push("💢 Гон д." + p.rut.currentDay);
            if (p.heat?.onSuppressants) parts.push("💊");
        }

        if (p.babies?.length > 0) parts.push("👶" + p.babies.length);

        html += '<div class="lc-dashboard-item"><span class="lc-dashboard-char">' + name + '</span><span class="lc-dashboard-status">' + (parts.join(" · ") || "—") + '</span></div>';
    });

    itemsEl.innerHTML = html || '<div class="lc-dashboard-item" style="color:var(--SmartThemeQuoteColor)">Нет персонажей</div>';
}

function refreshCyclePanel() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-cycle-panel");
    if (!el) return;
    const name = document.getElementById("lc-cycle-char")?.value;
    const p = s.characters[name];
    if (!p || !p.cycle) { el.innerHTML = ""; return; }
    if (p.pregnancy?.active) { el.innerHTML = '<div class="lc-info-note">Цикл приостановлен (беременность)</div>'; return; }

    const cm = new CycleManager(p);
    const ph = cm.phase();
    const fert = cm.fertility();
    let fertLabel = "Низкая", fertCls = "low";
    if (fert >= 0.2) { fertLabel = "ПИКОВАЯ"; fertCls = "peak"; }
    else if (fert >= 0.1) { fertLabel = "Высокая"; fertCls = "high"; }
    else if (fert >= 0.05) { fertLabel = "Средняя"; fertCls = "med"; }

    const c = p.cycle;
    const ovDay = Math.round(c.length - 14);

    // Calendar
    let calHtml = '<div class="lc-cycle-calendar">';
    for (let i = 1; i <= c.length; i++) {
        let cls = "lc-cycle-day";
        if (i <= c.menstruationDuration) cls += " mens";
        else if (i >= ovDay - 2 && i <= ovDay + 1) cls += " ovul";
        else if (i < ovDay - 2) cls += " foll";
        else cls += " lut";
        if (i === c.currentDay) cls += " current";
        calHtml += '<div class="' + cls + '" title="День ' + i + '"></div>';
    }
    calHtml += '</div>';
    calHtml += '<div class="lc-cycle-legend">' +
        '<span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot mens"></span>Менстр.</span>' +
        '<span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot foll"></span>Фоллик.</span>' +
        '<span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot ovul"></span>Овуляция</span>' +
        '<span class="lc-cycle-legend-item"><span class="lc-cycle-legend-dot lut"></span>Лютеин.</span>' +
    '</div>';

    el.innerHTML = calHtml +
        '<div class="lc-info" style="margin-top:8px">' +
            '<div><strong>Фаза:</strong> ' + cm.phaseLabel(ph) + '</div>' +
            '<div><strong>День:</strong> ' + c.currentDay + ' / ' + c.length + '</div>' +
            '<div><strong>Фертильность:</strong> <span class="lc-fertility-dot ' + fertCls + '"></span><span class="' + fertCls + '">' + fertLabel + ' (' + Math.round(fert * 100) + '%)</span></div>' +
            '<div><strong>Либидо:</strong> ' + cm.libido() + '</div>' +
            '<div><strong>Симптомы:</strong> ' + (cm.symptoms().join(", ") || "нет") + '</div>' +
            '<div><strong>Выделения:</strong> ' + cm.discharge() + '</div>' +
        '</div>' +
        '<div class="lc-btn-group" style="margin-top:8px">' +
            '<button class="lc-btn lc-btn-sm" id="lc-cyc-to-mens">→ Менстр.</button>' +
            '<button class="lc-btn lc-btn-sm" id="lc-cyc-to-ovul">→ Овуляция</button>' +
            '<button class="lc-btn lc-btn-sm" id="lc-cyc-set-day">Уст. день</button>' +
            '<button class="lc-btn lc-btn-sm" id="lc-cyc-skip">Пропустить</button>' +
        '</div>';

    document.getElementById("lc-cyc-to-mens")?.addEventListener("click", () => { p.cycle.currentDay = 1; saveSettingsDebounced(); rebuildUI(); });
    document.getElementById("lc-cyc-to-ovul")?.addEventListener("click", () => { p.cycle.currentDay = ovDay; saveSettingsDebounced(); rebuildUI(); });
    document.getElementById("lc-cyc-set-day")?.addEventListener("click", () => {
        const d = parseInt(prompt("День (1-" + c.length + "):", c.currentDay));
        if (d >= 1 && d <= c.length) { p.cycle.currentDay = d; saveSettingsDebounced(); rebuildUI(); }
    });
    document.getElementById("lc-cyc-skip")?.addEventListener("click", () => { p.cycle.currentDay = 1; p.cycle.cycleCount++; saveSettingsDebounced(); rebuildUI(); });
}

function refreshPregPanel() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-preg-panel");
    if (!el) return;
    const name = document.getElementById("lc-preg-char")?.value;
    const p = s.characters[name];
    if (!p) { el.innerHTML = ""; return; }

    if (!p.pregnancy?.active) {
        el.innerHTML = '<div class="lc-info-note">' + name + ' не беременна.</div>';
        return;
    }

    const pm = new PregnancyManager(p);
    const pr = p.pregnancy;
    const prog = Math.round((pr.week / pr.maxWeeks) * 100);

    el.innerHTML =
        '<div class="lc-progress"><div class="lc-progress-track"><div class="lc-progress-fill preg" style="width:' + prog + '%"></div></div><div class="lc-progress-label">' + pr.week + ' / ' + pr.maxWeeks + ' нед. (' + prog + '%)</div></div>' +
        '<div class="lc-info">' +
            '<div><strong>Триместр:</strong> ' + pm.trimester() + '</div>' +
            '<div><strong>Размер плода:</strong> ~' + pm.fetalSize() + '</div>' +
            '<div><strong>Плодов:</strong> ' + pr.fetusCount + '</div>' +
            '<div><strong>Отец:</strong> ' + (pr.father || "?") + '</div>' +
            '<div><strong>Симптомы:</strong> ' + (pm.symptoms().join(", ") || "нет") + '</div>' +
            '<div><strong>Шевеления:</strong> ' + pm.movements() + '</div>' +
            '<div><strong>Прибавка:</strong> +' + pm.weightGain() + ' кг</div>' +
            '<div><strong>Тело:</strong> ' + (pm.bodyChanges().join(", ") || "пока нет") + '</div>' +
            '<div><strong>Эмоции:</strong> ' + pm.emotionalState() + '</div>' +
        '</div>';
}

function refreshLaborPanel() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-labor-panel");
    if (!el) return;
    const name = document.getElementById("lc-labor-char")?.value;
    const p = s.characters[name];
    if (!p) { el.innerHTML = ""; return; }

    if (!p.labor?.active) {
        el.innerHTML = '<div class="lc-info-note">' + name + ' не в родах.</div>';
        return;
    }

    const lm = new LaborManager(p);
    const l = p.labor;
    const curIdx = LABOR_STAGES.indexOf(l.stage);
    const dilProg = Math.round((l.dilation / 10) * 100);

    let stHtml = '<div class="lc-labor-stages">';
    LABOR_STAGES.forEach((st, i) => {
        let cls = "lc-labor-dot";
        if (i < curIdx) cls += " done";
        if (i === curIdx) cls += " now";
        stHtml += '<div class="' + cls + '" title="' + LABOR_LABELS[st] + '"></div>';
    });
    stHtml += '</div><div class="lc-labor-labels">';
    LABOR_STAGES.forEach(st => stHtml += '<span>' + LABOR_LABELS[st] + '</span>');
    stHtml += '</div>';

    el.innerHTML = stHtml +
        '<div class="lc-progress" style="margin-top:8px"><div class="lc-progress-track"><div class="lc-progress-fill labor" style="width:' + dilProg + '%"></div></div><div class="lc-progress-label">Раскрытие: ' + l.dilation + '/10 см</div></div>' +
        '<div class="lc-info" style="margin-top:6px">' +
            '<div><strong>Стадия:</strong> ' + LABOR_LABELS[l.stage] + '</div>' +
            '<div><strong>Часов:</strong> ' + l.hoursElapsed.toFixed(1) + '</div>' +
            '<div>' + lm.description() + '</div>' +
            '<div><strong>Рождено:</strong> ' + l.babiesDelivered + ' / ' + l.totalBabies + '</div>' +
        '</div>';
}

function refreshBabyList() {
    const s = extension_settings[extensionName];
    const el = document.getElementById("lc-baby-list");
    if (!el) return;
    const name = document.getElementById("lc-baby-parent")?.value;
    const p = s.characters[name];
    if (!p || !p.babies || p.babies.length === 0) { el.innerHTML = '<div class="lc-empty"><div class="lc-empty-text">Нет малышей</div></div>'; return; }

    let html = "";
    p.babies.forEach((b, i) => {
        const bm = new BabyManager(b);
        const wKg = (b.currentWeight / 1000).toFixed(1);
        const ms = bm.milestones();
        let extras = "";
        if (b.secondarySex) extras += " | " + b.secondarySex;
        if (b.nonHumanFeatures?.length > 0) extras += " | " + b.nonHumanFeatures.join(", ");

        html += '<div class="lc-baby-card">' +
            '<div class="lc-baby-header"><span class="lc-baby-name">' + (b.name || "Безымянный") + ' (' + (b.sex === "M" ? "♂" : "♀") + ')</span><span class="lc-baby-age">' + bm.ageLabel() + '</span></div>' +
            '<div class="lc-baby-body">' +
                '<div>Вес: ' + wKg + ' кг | Глаза: ' + b.eyeColor + ' | Волосы: ' + b.hairColor + extras + '</div>' +
                '<div>Состояние: ' + b.state + '</div>' +
                (ms.length > 0 ? '<div>Вехи: ' + ms.join(", ") + '</div>' : '') +
            '</div>' +
            '<div class="lc-btn-group" style="margin-top:4px">' +
                '<button class="lc-btn lc-btn-sm lc-set-baby-age" data-parent="' + name + '" data-idx="' + i + '">Уст. возраст</button>' +
                '<button class="lc-btn lc-btn-sm lc-btn-danger lc-remove-baby" data-parent="' + name + '" data-idx="' + i + '">🗑</button>' +
            '</div></div>';
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
        if (s.diceLog.length === 0) diceEl.innerHTML = '<div class="lc-log-empty">Пусто</div>';
        else diceEl.innerHTML = [...s.diceLog].reverse().slice(0, 20).map(e =>
            '<div class="lc-log-entry"><span class="' + (e.result ? "lc-log-success" : "lc-log-fail") + '">' + (e.result ? "✅" : "❌") + '</span> ' + e.targetChar + ': ' + e.chance + '% | 🎲' + e.roll + ' | ' + e.timestamp + '</div>'
        ).join("");
    }
    const intimEl = document.getElementById("lc-intim-log-list");
    if (intimEl) {
        if (s.intimacyLog.length === 0) intimEl.innerHTML = '<div class="lc-log-empty">Пусто</div>';
        else intimEl.innerHTML = [...s.intimacyLog].reverse().slice(0, 20).map(e =>
            '<div class="lc-log-entry">' + (e.participants || []).join(" + ") + ' | ' + e.type + ' | ' + e.ejaculation + ' | ' + e.timestamp + '</div>'
        ).join("");
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
    document.getElementById("lc-edit-race").value = p.race || "human";
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
    p.race = document.getElementById("lc-edit-race").value || "human";
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
        document.querySelector('.lifecycle-tab-content[data-tab="' + this.dataset.tab + '"]')?.classList.add("active");
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
    document.getElementById("lc-intim-log-btn")?.addEventListener("click", () => {
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

    document.getElementById("lc-intim-roll-btn")?.addEventListener("click", () => {
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
        const p = s.characters[name]; if (!p?.pregnancy?.active) return;
        new PregnancyManager(p).advanceDay(7); saveSettingsDebounced(); rebuildUI();
    });
    document.getElementById("lc-preg-set-week")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name]; if (!p?.pregnancy?.active) return;
        const w = parseInt(prompt("Неделя:", p.pregnancy.week));
        if (w >= 1 && w <= p.pregnancy.maxWeeks) { p.pregnancy.week = w; p.pregnancy.day = 0; saveSettingsDebounced(); rebuildUI(); }
    });
    document.getElementById("lc-preg-to-labor")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name]; if (!p?.pregnancy?.active) return;
        new LaborManager(p).start(); saveSettingsDebounced(); rebuildUI(); toastr.info(name + ": роды начались!");
    });
    document.getElementById("lc-preg-end")?.addEventListener("click", () => {
        const name = document.getElementById("lc-preg-char")?.value;
        const p = s.characters[name]; if (!p?.pregnancy?.active) return;
        if (confirm("Прервать беременность?")) { p.pregnancy.active = false; if (p.cycle) p.cycle.enabled = true; saveSettingsDebounced(); rebuildUI(); }
    });

    // Labor
    document.getElementById("lc-labor-char")?.addEventListener("change", refreshLaborPanel);
    document.getElementById("lc-labor-advance")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name]; if (!p?.labor?.active) return;
        new LaborManager(p).advance(); saveSettingsDebounced(); rebuildUI();
    });
    document.getElementById("lc-labor-deliver")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name]; if (!p?.labor?.active) return;
        const baby = BabyManager.generate(p, p.pregnancy?.father || "?");
        baby.name = prompt("Имя ребёнка:", "") || "Малыш " + ((p.babies?.length || 0) + 1);
        if (!p.babies) p.babies = [];
        p.babies.push(baby);
        new LaborManager(p).deliver(); saveSettingsDebounced(); rebuildUI();
        toastr.success(name + " родила " + (baby.sex === "M" ? "мальчика" : "девочку") + ": " + baby.name + "!");
    });
    document.getElementById("lc-labor-set-dil")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name]; if (!p?.labor?.active) return;
        const d = parseInt(prompt("Раскрытие (0-10):", p.labor.dilation));
        if (d >= 0 && d <= 10) { p.labor.dilation = d; saveSettingsDebounced(); rebuildUI(); }
    });
    document.getElementById("lc-labor-end")?.addEventListener("click", () => {
        const name = document.getElementById("lc-labor-char")?.value;
        const p = s.characters[name]; if (!p?.labor?.active) return;
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

    // Modules (with AU re-render)
    const mods = { "lc-mod-cycle": "cycle", "lc-mod-preg": "pregnancy", "lc-mod-labor": "labor", "lc-mod-baby": "baby", "lc-mod-intim": "intimacy" };
    for (const [id, key] of Object.entries(mods)) {
        document.getElementById(id)?.addEventListener("change", function() { s.modules[key] = this.checked; saveSettingsDebounced(); rebuildUI(); });
    }
    // AU module toggle with re-render
    document.getElementById("lc-mod-au")?.addEventListener("change", function() {
        s.modules.auOverlay = this.checked;
        saveSettingsDebounced();
        renderAUSettings();
        rebuildUI();
    });

    // Prompt injection
    document.getElementById("lc-prompt-on")?.addEventListener("change", function() { s.promptInjectionEnabled = this.checked; saveSettingsDebounced(); });
    document.getElementById("lc-prompt-pos")?.addEventListener("change", function() { s.promptInjectionPosition = this.value; saveSettingsDebounced(); });
    document.getElementById("lc-prompt-detail")?.addEventListener("change", function() { s.promptInjectionDetail = this.value; saveSettingsDebounced(); });

    // AU preset with re-render
    document.getElementById("lc-au-preset")?.addEventListener("change", function() {
        s.auPreset = this.value;
        saveSettingsDebounced();
        renderAUSettings();
    });

    // Export/Import
    document.getElementById("lc-export")?.addEventListener("click", () => downloadJSON(s, "lifecycle-backup.json"));
    document.getElementById("lc-import")?.addEventListener("click", () => uploadJSON(data => { Object.assign(s, deepMerge(defaultSettings, data)); saveSettingsDebounced(); rebuildUI(); renderAUSettings(); toastr.success("Импортировано!"); }));
    document.getElementById("lc-reset")?.addEventListener("click", () => { if (confirm("СБРОС ВСЕХ ДАННЫХ?")) { Object.assign(s, JSON.parse(JSON.stringify(defaultSettings))); saveSettingsDebounced(); rebuildUI(); renderAUSettings(); toastr.info("Сброшено."); } });
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
                if (confirm("LifeCycle: +" + days + " дн. Применить?")) { TimeParser.apply(days); rebuildUI(); }
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
    renderAUSettings();

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessage);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // Prompt injection hook
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

    console.log("[LifeCycle] v0.3.1 loaded!");
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
    getCharStatus: name => {
        const s = extension_settings[extensionName];
        const p = s.characters[name];
        if (!p) return null;
        const r = { name };
        if (p.cycle?.enabled) { const cm = new CycleManager(p); r.cycle = { phase: cm.phaseLabel(cm.phase()), fertility: cm.fertility(), libido: cm.libido() }; }
        if (p.pregnancy?.active) { const pm = new PregnancyManager(p); r.pregnancy = { week: p.pregnancy.week, trimester: pm.trimester(), fetalSize: pm.fetalSize() }; }
        if (p.labor?.active) r.labor = { stage: p.labor.stage, dilation: p.labor.dilation };
        if (p.heat?.active) r.heat = { day: p.heat.currentDay, duration: p.heat.duration };
        if (p.rut?.active) r.rut = { day: p.rut.currentDay, duration: p.rut.duration };
        if (p.babies?.length > 0) r.babies = p.babies.map(b => ({ name: b.name, age: new BabyManager(b).ageLabel() }));
        return r;
    },
};
