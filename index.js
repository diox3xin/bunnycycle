// ============================================================
// LifeCycle Extension v0.6.0 — index.js
// + Inline baby editor, relationships, enhanced time parsing
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
        omegaverse: { heatCycleLength:30, heatDuration:5, heatFertilityBonus:0.35, rutCycleLength:35, rutDuration:4, knotEnabled:true, knotDurationMin:15, bondingEnabled:true, bondType:"bite_mark", suppressantsAvailable:true, maleOmegaPregnancy:true, pregnancyWeeks:36 },
        fantasy: { pregnancyByRace:{ human:40, elf:60, dwarf:35, orc:32, halfling:38 }, nonHumanFeatures:true, magicalComplications:false },
        scifi: { artificialWomb:false, geneticModification:false, acceleratedGrowth:false },
    },
    characters: {},
    relationships: [],
    diceLog: [], intimacyLog: [],
    _pendingBaby: null,
};

// ==========================================
// UTILITY
// ==========================================

function deepMerge(t, s) { const r={...t}; for (const k of Object.keys(s)) { if (s[k]&&typeof s[k]==="object"&&!Array.isArray(s[k])&&t[k]&&typeof t[k]==="object"&&!Array.isArray(t[k])) r[k]=deepMerge(t[k],s[k]); else r[k]=s[k]; } return r; }
function fmt(d) { const p=n=>String(n).padStart(2,"0"); return `${d.year}/${p(d.month)}/${p(d.day)} ${p(d.hour)}:${p(d.minute)}`; }
function addDays(d,n) { const dt=new Date(d.year,d.month-1,d.day,d.hour,d.minute); dt.setDate(dt.getDate()+n); return{year:dt.getFullYear(),month:dt.getMonth()+1,day:dt.getDate(),hour:dt.getHours(),minute:dt.getMinutes(),frozen:d.frozen}; }
function clamp(v,lo,hi) { return Math.max(lo,Math.min(hi,v)); }
function dice(n) { return Math.floor(Math.random()*(n||100))+1; }
function uid() { return Date.now().toString(36)+Math.random().toString(36).substr(2,5); }

// ==========================================
// RELATIONSHIP MANAGER
// ==========================================

const REL_TYPES = [
    "мать","отец","ребёнок","партнёр","супруг(а)","брат","сестра",
    "сводный брат","сводная сестра","дедушка","бабушка","внук","внучка",
    "дядя","тётя","племянник","племянница","друг","возлюбленный(ая)",
    "бывший(ая)","опекун","подопечный","другое"
];

class RelationshipManager {
    static get() { return extension_settings[extensionName].relationships || []; }

    static add(char1, char2, type, notes) {
        const s = extension_settings[extensionName];
        if (!s.relationships) s.relationships = [];
        // Check duplicate
        const exists = s.relationships.find(r => r.char1 === char1 && r.char2 === char2 && r.type === type);
        if (exists) return;
        s.relationships.push({ id: uid(), char1, char2, type, notes: notes || "", created: fmt(s.worldDate) });
        saveSettingsDebounced();
    }

    static remove(id) {
        const s = extension_settings[extensionName];
        s.relationships = (s.relationships || []).filter(r => r.id !== id);
        saveSettingsDebounced();
    }

    static update(id, data) {
        const s = extension_settings[extensionName];
        const r = (s.relationships || []).find(x => x.id === id);
        if (r) { Object.assign(r, data); saveSettingsDebounced(); }
    }

    static getFor(charName) {
        return (extension_settings[extensionName].relationships || []).filter(r => r.char1 === charName || r.char2 === charName);
    }

    static getReciprocalType(type) {
        const map = { "мать":"ребёнок", "отец":"ребёнок", "ребёнок":"мать", "партнёр":"партнёр",
            "супруг(а)":"супруг(а)", "брат":"брат", "сестра":"сестра", "дедушка":"внук",
            "бабушка":"внучка", "внук":"дедушка", "внучка":"бабушка" };
        return map[type] || type;
    }

    static addBirthRelationships(mother, father, babyName) {
        if (mother) {
            this.add(mother, babyName, "мать", "биологическая мать");
            this.add(babyName, mother, "ребёнок", "");
        }
        if (father && father !== "?") {
            this.add(father, babyName, "отец", "биологический отец");
            this.add(babyName, father, "ребёнок", "");
        }
        // Sibling relationships
        const s = extension_settings[extensionName];
        if (mother && s.characters[mother]?.babies) {
            for (const sib of s.characters[mother].babies) {
                if (sib.name && sib.name !== babyName) {
                    const sibType = "брат/сестра";
                    if (!s.relationships.find(r => r.char1 === babyName && r.char2 === sib.name && r.type === sibType)) {
                        this.add(babyName, sib.name, sibType, "");
                        this.add(sib.name, babyName, sibType, "");
                    }
                }
            }
        }
    }

    static toPromptText() {
        const rels = this.get();
        if (rels.length === 0) return "";
        const lines = ["Family/Relationships:"];
        for (const r of rels) {
            lines.push(`${r.char1} → ${r.char2}: ${r.type}${r.notes ? " (" + r.notes + ")" : ""}`);
        }
        return lines.join("\n");
    }
}

// ==========================================
// ENHANCED TIME PARSER
// ==========================================

class EnhancedTimeParser {
    static MONTHS_RU = { "январ":1,"феврал":2,"март":3,"апрел":4,"ма[йя]":5,"июн":6,"июл":7,"август":8,"сентябр":9,"октябр":10,"ноябр":11,"декабр":12 };
    static MONTHS_EN = { "january":1,"february":2,"march":3,"april":4,"may":5,"june":6,"july":7,"august":8,"september":9,"october":10,"november":11,"december":12 };
    static TIME_OF_DAY = {
        "утр":8, "рассвет":6, "morning":8, "dawn":6,
        "день":13, "полдень":12, "noon":12, "afternoon":14,
        "вечер":19, "закат":18, "evening":19, "sunset":18, "dusk":18,
        "ночь":23, "полночь":0, "night":23, "midnight":0,
    };

    static parse(msg) {
        if (!msg) return null;
        const s = extension_settings[extensionName];
        const sens = s.timeParserSensitivity;
        let result = { days: 0, setDate: null, setTime: null };

        // === RELATIVE TIME (days/weeks/months) ===
        const relPats = [
            [/прошл[оа]\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/через\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/спустя\s+(\d+)\s+(?:дн|дней|день)/gi,1],
            [/прошл[оа]\s+(\d+)\s+(?:недел|нед)/gi,7],[/через\s+(\d+)\s+(?:недел|нед)/gi,7],[/спустя\s+(\d+)\s+(?:недел|нед)/gi,7],
            [/прошл[оа]\s+(\d+)\s+(?:месяц|мес)/gi,30],[/через\s+(\d+)\s+(?:месяц|мес)/gi,30],[/спустя\s+(\d+)\s+(?:месяц|мес)/gi,30],
            [/(\d+)\s+(?:days?)\s+(?:later|passed)/gi,1],[/(\d+)\s+(?:weeks?)\s+later/gi,7],[/(\d+)\s+(?:months?)\s+later/gi,30],
        ];
        for (const [re, m] of relPats) { let x; while ((x = re.exec(msg)) !== null) result.days += parseInt(x[1]) * m; }

        if (sens !== "low") {
            if (/на следующ\w+\s+(?:день|утро)|next\s+(?:day|morning)/i.test(msg)) result.days += 1;
            if (/через\s+пару\s+дней|a\s+(?:couple|few)\s+days/i.test(msg)) result.days += 2;
            if (/через\s+несколько\s+дней/i.test(msg)) result.days += 3;
            if (/на следующ\w+\s+неделе|next\s+week/i.test(msg)) result.days += 7;
        }
        if (sens === "high") {
            if (/прошёл\s+месяц|a\s+month\s+later/i.test(msg)) result.days += 30;
            if (/прошла\s+неделя|a\s+week\s+later/i.test(msg)) result.days += 7;
        }

        // === ABSOLUTE DATE ===
        // Format: "15 января", "5 марта 2026", "January 15th", "March 5, 2026"
        // Russian: число + месяц
        for (const [mPat, mNum] of Object.entries(this.MONTHS_RU)) {
            const re = new RegExp("(\\d{1,2})\\s+" + mPat + "\\w*(?:\\s+(\\d{4}))?", "i");
            const m = msg.match(re);
            if (m) {
                result.setDate = { day: parseInt(m[1]), month: mNum, year: m[2] ? parseInt(m[2]) : s.worldDate.year };
                break;
            }
        }
        // English: month + number
        if (!result.setDate) {
            for (const [mName, mNum] of Object.entries(this.MONTHS_EN)) {
                const re = new RegExp(mName + "\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(\\d{4}))?", "i");
                const m = msg.match(re);
                if (m) {
                    result.setDate = { day: parseInt(m[1]), month: mNum, year: m[2] ? parseInt(m[2]) : s.worldDate.year };
                    break;
                }
            }
        }
        // ISO-like: 2026/03/15 or 2026-03-15
        if (!result.setDate) {
            const isoMatch = msg.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
            if (isoMatch) {
                result.setDate = { year: parseInt(isoMatch[1]), month: parseInt(isoMatch[2]), day: parseInt(isoMatch[3]) };
            }
        }

        // === TIME OF DAY ===
        for (const [keyword, hour] of Object.entries(this.TIME_OF_DAY)) {
            const re = new RegExp("\\b" + keyword + "\\w*\\b", "i");
            if (re.test(msg)) { result.setTime = { hour }; break; }
        }
        // Specific hour: "в 3 часа", "в 15:00", "at 5pm"
        const hourRu = msg.match(/в\s+(\d{1,2})\s*(?:час|:(\d{2}))/i);
        if (hourRu) result.setTime = { hour: parseInt(hourRu[1]), minute: hourRu[2] ? parseInt(hourRu[2]) : 0 };
        const hourEn = msg.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (hourEn) {
            let h = parseInt(hourEn[1]);
            if (hourEn[3]?.toLowerCase() === "pm" && h < 12) h += 12;
            if (hourEn[3]?.toLowerCase() === "am" && h === 12) h = 0;
            result.setTime = { hour: h, minute: hourEn[2] ? parseInt(hourEn[2]) : 0 };
        }

        // === YEAR MENTIONS ===
        const yearMatch = msg.match(/(\d{4})\s*(?:год|year)/i);
        if (yearMatch && !result.setDate) {
            result.setDate = { ...s.worldDate, year: parseInt(yearMatch[1]) };
        }

        const hasChanges = result.days > 0 || result.setDate || result.setTime;
        return hasChanges ? result : null;
    }

    static apply(parsed) {
        const s = extension_settings[extensionName];
        let daysAdvanced = 0;

        if (parsed.setDate) {
            // Calculate days between current date and target date
            const current = new Date(s.worldDate.year, s.worldDate.month - 1, s.worldDate.day);
            const target = new Date(parsed.setDate.year, parsed.setDate.month - 1, parsed.setDate.day);
            const diff = Math.round((target - current) / (1000 * 60 * 60 * 24));
            if (diff > 0) daysAdvanced = diff;
            s.worldDate.year = parsed.setDate.year;
            s.worldDate.month = parsed.setDate.month;
            s.worldDate.day = parsed.setDate.day;
        }

        if (parsed.days > 0) {
            s.worldDate = addDays(s.worldDate, parsed.days);
            daysAdvanced += parsed.days;
        }

        if (parsed.setTime) {
            s.worldDate.hour = parsed.setTime.hour;
            if (parsed.setTime.minute !== undefined) s.worldDate.minute = parsed.setTime.minute;
        }

        if (daysAdvanced > 0) {
            this.advanceAll(daysAdvanced);
        }

        saveSettingsDebounced();
    }

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

    static formatDescription(parsed) {
        const parts = [];
        if (parsed.days > 0) parts.push("+" + parsed.days + " дн.");
        if (parsed.setDate) parts.push("дата: " + parsed.setDate.day + "/" + parsed.setDate.month + "/" + parsed.setDate.year);
        if (parsed.setTime) parts.push("время: " + parsed.setTime.hour + ":00");
        return parts.join(", ");
    }
}

// ==========================================
// CHAT HISTORY PARSER
// ==========================================

class ChatHistoryParser {
    static CHILD_PATS = [/(?:родил[аи]?|gave\s*birth)\s*(?:to\s*)?(?:мальчик|девочк|сын|дочь|boy|girl)?\s*(?:по\s*имени\s*|named?\s*)["«]?(\w[\w\s]{1,20})["»]?/gi, /(?:малыш|ребён\w+|baby|child)\s+(?:по\s*имени\s*|named?\s*)["«]?(\w[\w\s]{1,20})["»]?/gi, /(?:их|наш\w*|her|his|their)\s+(?:сын|дочь|son|daughter|baby)\s+["«]?(\w{2,20})["»]?/gi];
    static CHILD_SEX = { M:/(?:мальчик|сын|boy|son)\b/i, F:/(?:девочк|дочь|girl|daughter)\b/i };
    static PREG_PATS = [/(?:беременн|pregnant|ожида\w+\s*ребёнк|expecting)/i, /(?:тест.*(?:положительн|две\s*полоск)|pregnancy\s*test\s*positive)/i, /(?:(\d{1,2})\s*(?:недел[ьяию]|week)\s*(?:беременност|pregnan))/i];
    static SEC_SEX = { alpha:/\b(альфа|alpha)\b/i, beta:/\b(бета|beta)\b/i, omega:/\b(омега|omega)\b/i };
    static HEAT = [/(?:течк[аеуи]|heat|in\s*heat|estrus)/i];
    static RUT = [/(?:гон[а-яё]*|rut(?:ting)?|in\s*rut)/i];

    static parseFullChat(msgs, chars) {
        if (!msgs?.length) return {};
        const res = {}; const names = Object.keys(chars);
        const full = msgs.map(m => m.mes || "").join("\n");
        for (const name of names) {
            const info = {}; const rel = [];
            for (const msg of msgs) { const t = msg.mes || ""; if (t.toLowerCase().includes(name.toLowerCase())) rel.push(t); }
            const ct = rel.join("\n");

            for (const [s, p] of Object.entries(this.SEC_SEX)) {
                const r1 = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+"[\\s\\-]*"+p.source,"i");
                const r2 = new RegExp(p.source+"[\\s\\-]*"+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),"i");
                if (r1.test(full) || r2.test(full) || p.test(ct)) { info.secondarySex = s; break; }
            }

            let fc=0, mc=0;
            const fm = ct.match(/\b(она|её|ей|she|her)\b/gi); if (fm) fc = fm.length;
            const mm = ct.match(/\b(он|его|ему|he|him)\b/gi); if (mm) mc = mm.length;
            if (fc > mc * 2) info.bioSex = "F"; else if (mc > fc * 2) info.bioSex = "M";

            for (const p of this.PREG_PATS) { if (p.test(ct)) { info.isPregnant = true; const wm = ct.match(/(\d{1,2})\s*(?:недел|week)/i); if (wm) info.pregWeek = parseInt(wm[1]); break; } }
            for (const p of this.HEAT) { if (p.test(ct)) { info.inHeat = true; break; } }
            for (const p of this.RUT) { if (p.test(ct)) { info.inRut = true; break; } }

            info.children = [];
            for (const pat of this.CHILD_PATS) {
                let m; const re = new RegExp(pat.source, pat.flags);
                while ((m = re.exec(full)) !== null) {
                    const cn = m[1]?.trim();
                    if (cn?.length >= 2 && cn.length <= 20 && !names.includes(cn)) {
                        const sur = full.substring(Math.max(0,m.index-100), Math.min(full.length, m.index+m[0].length+100));
                        let cs = null; if (this.CHILD_SEX.M.test(sur)) cs = "M"; else if (this.CHILD_SEX.F.test(sur)) cs = "F";
                        if (!info.children.find(c => c.name === cn)) info.children.push({ name: cn, sex: cs });
                    }
                }
            }
            if (Object.keys(info).length > 0) res[name] = info;
        }
        return res;
    }
}

// ==========================================
// CHAR INFO PARSER
// ==========================================

class CharInfoParser {
    static SEX = { F:/\b(female|woman|girl|девушка|женщина|she\/her)\b/i, M:/\b(male|man|boy|мужчина|парень|he\/him)\b/i };
    static SEC = { alpha:/\b(alpha|альфа)\b/i, beta:/\b(beta|бета)\b/i, omega:/\b(omega|омега)\b/i };
    static RACE = { human:/\b(human|человек)\b/i, elf:/\b(elf|эльф)\b/i, dwarf:/\b(dwarf|дварф)\b/i, orc:/\b(orc|орк)\b/i, demon:/\b(demon|демон)\b/i, vampire:/\b(vampire|вампир)\b/i, neko:/\b(neko|неко)\b/i };
    static EYE = /\b(голуб\S*|сер\S*|зелен\S*|кар\S*|чёрн\S*|янтарн\S*|золот\S*|фиолетов\S*|красн\S*|blue|green|brown|hazel|grey|amber|gold|red|violet)\s*(?:eye|eyes|глаз)/i;
    static HAIR = /\b(блонд\S*|русы\S*|рыж\S*|чёрн\S*|бел\S*|серебрист\S*|розов\S*|каштанов\S*|платинов\S*|blonde?|brunette?|black|white|silver|pink)\s*(?:hair|волос)/i;
    static parse(o) { if (!o) return {}; const t=[o.description,o.personality,o.scenario,o.first_mes,o.data?.description,o.data?.personality].filter(Boolean).join("\n"); const i={}; for (const [s,p] of Object.entries(this.SEX)) if (p.test(t)){i.bioSex=s;break;} for (const [s,p] of Object.entries(this.SEC)) if (p.test(t)){i.secondarySex=s;break;} for (const [r,p] of Object.entries(this.RACE)) if (p.test(t)){i.race=r;break;} let m=t.match(this.EYE); if(m) i.eyeColor=m[1].trim(); m=t.match(this.HAIR); if(m) i.hairColor=m[1].trim(); return i; }
}

// ==========================================
// INTIMACY DETECTOR
// ==========================================

class IntimacyDetector {
    static SRU=[/вошё?л\s*(в\s*неё|внутрь)/i,/проник/i,/трахал|ебал|ебёт|выебал/i,/кончил\s*(внутрь|в\s*неё|наружу|на)/i,/член\s*(?:вошёл|внутри)/i,/фрикци/i,/без\s*(?:презерватива|защиты)/i,/наполнил/i,/узел\s*(?:набух|внутри|застрял)/i];
    static SEN=[/(?:thrust|pushed|slid)\s*inside/i,/penetrat/i,/fuck(?:ed|ing)/i,/cum(?:ming|med)?\s*inside/i,/raw|bareback|without\s*condom/i,/creampie/i,/knot.*(?:inside|stuck)/i];
    static CON=[/презерватив|кондом/i,/condom/i]; static NCO=[/без\s*(?:презерватива|защиты)/i,/raw|bareback/i];
    static EIN=[/кончил\s*(?:внутрь|в\s*неё|глубоко)/i,/наполнил/i,/cum.*inside/i,/creampie/i,/узел.*внутри/i];
    static EOU=[/кончил\s*(?:наружу|на\s*живот)/i,/pull.*out/i];
    static ANL=[/анал/i,/в\s*(?:задн|попу|анус)/i,/anal/i]; static ORL=[/минет|отсос/i,/blowjob|oral/i];
    static detect(t,ch) { if(!t) return null; let sc=0; for(const p of [...this.SRU,...this.SEN]) if(p.test(t)) sc++; if(sc<2) return null;
        let tp="vaginal"; for(const p of this.ANL) if(p.test(t)){tp="anal";break;} for(const p of this.ORL) if(p.test(t)){tp="oral";break;}
        let co=false,nc=false; for(const p of this.CON) if(p.test(t)){co=true;break;} for(const p of this.NCO) if(p.test(t)){nc=true;break;}
        let ej="unknown"; for(const p of this.EIN) if(p.test(t)){ej="inside";break;} if(ej==="unknown") for(const p of this.EOU) if(p.test(t)){ej="outside";break;}
        const pa=[],nm=Object.keys(ch); for(const n of nm) if(t.toLowerCase().includes(n.toLowerCase())||ch[n]._isUser) pa.push(n);
        if(pa.length<2&&nm.length>=2) for(const n of nm){if(!pa.includes(n)) pa.push(n); if(pa.length>=2) break;}
        let tg=null; const s=extension_settings[extensionName]; for(const n of pa){const p=ch[n]; if(!p) continue; if(p.bioSex==="F"){tg=n;break;} if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.secondarySex==="omega"&&s.auSettings.omegaverse.maleOmegaPregnancy){tg=n;break;}}
        return{detected:true,sc,tp,co:co&&!nc,nc,ej,pa,tg};
    }
}

// ==========================================
// CHARACTER SYNC
// ==========================================

function getActiveChars() { const c=getContext(),r=[]; if(!c) return r; if(c.characterId!==undefined&&c.characters){const x=c.characters[c.characterId]; if(x) r.push({name:x.name,obj:x,isUser:false});} if(c.groups&&c.groupId){const g=c.groups.find(x=>x.id===c.groupId); if(g?.members) for(const av of g.members){const x=c.characters.find(y=>y.avatar===av); if(x&&!r.find(y=>y.name===x.name)) r.push({name:x.name,obj:x,isUser:false});}} if(c.name1) r.push({name:c.name1,obj:null,isUser:true}); return r; }

function syncChars() {
    const s=extension_settings[extensionName]; if(!s.autoSyncCharacters) return; const a=getActiveChars(); let ch=false;
    for(const c of a) {
        if(!s.characters[c.name]){s.characters[c.name]=makeProfile(c.name,c.isUser);ch=true;}
        if(s.autoParseCharInfo&&c.obj&&!c.isUser){const p=CharInfoParser.parse(c.obj),pr=s.characters[c.name]; if(p.bioSex&&!pr._mB){pr.bioSex=p.bioSex;ch=true;} if(p.secondarySex&&!pr._mS){pr.secondarySex=p.secondarySex;ch=true;} if(p.race&&!pr._mR){pr.race=p.race;ch=true;} if(p.eyeColor&&!pr._mE){pr.eyeColor=p.eyeColor;ch=true;} if(p.hairColor&&!pr._mH){pr.hairColor=p.hairColor;ch=true;}}
    }
    if(s.parseFullChat){const ctx=getContext(); if(ctx?.chat?.length>0){const cd=ChatHistoryParser.parseFullChat(ctx.chat,s.characters);
        for(const [n,i] of Object.entries(cd)){const p=s.characters[n]; if(!p) continue;
            if(i.secondarySex&&!p._mS){p.secondarySex=i.secondarySex;ch=true;}
            if(i.bioSex&&!p._mB){p.bioSex=i.bioSex;ch=true;}
            if(i.isPregnant&&!p.pregnancy?.active&&!p._mP){p.pregnancy.active=true;p.pregnancy.week=i.pregWeek||4;if(p.cycle)p.cycle.enabled=false;ch=true;}
            if(i.inHeat&&p.secondarySex==="omega"&&!p.heat?.active){p.heat.active=true;p.heat.currentDay=1;ch=true;}
            if(i.inRut&&p.secondarySex==="alpha"&&!p.rut?.active){p.rut.active=true;p.rut.currentDay=1;ch=true;}
            if(i.children?.length>0) for(const c of i.children) if(!p.babies.find(b=>b.name===c.name)){p.babies.push({name:c.name,sex:c.sex||(Math.random()<0.5?"M":"F"),secondarySex:null,birthWeight:3200,currentWeight:5000,ageDays:30,eyeColor:p.eyeColor||"",hairColor:p.hairColor||"",mother:p.bioSex==="F"?n:"?",father:p.bioSex==="M"?n:"?",nonHumanFeatures:[],state:"младенец",birthDate:{...s.worldDate}});ch=true;RelationshipManager.addBirthRelationships(p.bioSex==="F"?n:null,p.bioSex==="M"?n:null,c.name);}
        }
    }}
    if(ch) saveSettingsDebounced();
}

function makeProfile(n,u) { return { name:n,bioSex:"F",secondarySex:null,race:"human",contraception:"none",eyeColor:"",hairColor:"",pregnancyDifficulty:"normal",_isUser:u,_enabled:true,_mB:false,_mS:false,_mR:false,_mE:false,_mH:false,_mP:false, cycle:{enabled:true,currentDay:Math.floor(Math.random()*28)+1,baseLength:28,length:28,menstruationDuration:5,irregularity:2,symptomIntensity:"moderate",cycleCount:0}, pregnancy:{active:false,week:0,day:0,maxWeeks:40,father:null,fetusCount:1,complications:[],weightGain:0}, labor:{active:false,stage:"latent",dilation:0,contractionInterval:0,contractionDuration:0,hoursElapsed:0,babiesDelivered:0,totalBabies:1}, heat:{active:false,currentDay:0,cycleDays:30,duration:5,intensity:"moderate",daysSinceLast:Math.floor(Math.random()*25),onSuppressants:false,phase:"rest"}, rut:{active:false,currentDay:0,cycleDays:35,duration:4,intensity:"moderate",daysSinceLast:Math.floor(Math.random()*30),phase:"rest"}, babies:[] }; }

// ==========================================
// CYCLE, PREGNANCY, LABOR, BABY, HEAT/RUT MANAGERS
// (same as v0.5.0 — compact)
// ==========================================

class CycleManager {
    constructor(p){this.p=p;this.c=p.cycle;}
    phase(){if(!this.c?.enabled)return"unknown";const d=this.c.currentDay,l=this.c.length,m=this.c.menstruationDuration,o=Math.round(l-14);if(d<=m)return"menstruation";if(d<o-2)return"follicular";if(d<=o+1)return"ovulation";return"luteal";}
    label(p){return{menstruation:"Менструация",follicular:"Фолликулярная",ovulation:"Овуляция",luteal:"Лютеиновая",unknown:"—"}[p]||p;}
    emoji(p){return{menstruation:"🔴",follicular:"🌸",ovulation:"🥚",luteal:"🌙",unknown:"❓"}[p]||"❓";}
    fertility(){const b={ovulation:0.25,follicular:0.08,luteal:0.02,menstruation:0.01,unknown:0.05}[this.phase()]||0.05;const s=extension_settings[extensionName];let bo=0;if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&this.p.heat?.active)bo=s.auSettings.omegaverse.heatFertilityBonus;return Math.min(b+bo,0.95);}
    libido(){if(this.p.heat?.active||this.p.rut?.active)return"экстремальное";return{ovulation:"высокое",follicular:"среднее",luteal:"низкое",menstruation:"низкое"}[this.phase()]||"среднее";}
    symptoms(){const p=this.phase(),i=this.c.symptomIntensity,r=[];if(p==="menstruation"){r.push("кровотечение");if(i!=="mild")r.push("спазмы");}if(p==="ovulation")r.push("↑ либидо");if(p==="luteal")r.push("ПМС");if(p==="follicular")r.push("энергия");return r;}
    discharge(){return{menstruation:"менструальные",follicular:"скудные",ovulation:"обильные, тягучие",luteal:"густые"}[this.phase()]||"обычные";}
    advance(d){for(let i=0;i<d;i++){this.c.currentDay++;if(this.c.currentDay>this.c.length){this.c.currentDay=1;this.c.cycleCount++;if(this.c.irregularity>0)this.c.length=clamp(this.c.baseLength+Math.floor(Math.random()*this.c.irregularity*2)-this.c.irregularity,21,45);}}}
}

class HeatRutManager {
    constructor(p){this.p=p;}
    static HP={preHeat:"Предтечка",heat:"Течка",postHeat:"Посттечка",rest:"Покой"};
    static RP={preRut:"Предгон",rut:"Гон",postRut:"Постгон",rest:"Покой"};
    heatPhase(){const h=this.p.heat;if(!h)return"rest";if(h.active){if(h.currentDay<=1)return"preHeat";if(h.currentDay<=h.duration-1)return"heat";return"postHeat";}const dl=h.cycleDays-(h.daysSinceLast||0);if(dl<=3&&dl>0)return"preHeat";return"rest";}
    rutPhase(){const r=this.p.rut;if(!r)return"rest";if(r.active){if(r.currentDay<=1)return"preRut";if(r.currentDay<=r.duration-1)return"rut";return"postRut";}const dl=r.cycleDays-(r.daysSinceLast||0);if(dl<=3&&dl>0)return"preRut";return"rest";}
    heatSymptoms(){const p=this.heatPhase();if(p==="preHeat")return["жар","беспокойство"];if(p==="heat")return["сильный жар","самосмазка","феромоны","затуманенность","потребность в близости"];if(p==="postHeat")return["усталость","остаточная чувствительность"];return[];}
    rutSymptoms(){const p=this.rutPhase();if(p==="preRut")return["раздражительность","агрессия"];if(p==="rut")return["экстремальная агрессия","набухание узла","навязчивое влечение"];if(p==="postRut")return["усталость"];return[];}
    heatDaysLeft(){const h=this.p.heat;if(!h||h.active)return 0;return Math.max(0,h.cycleDays-(h.daysSinceLast||0));}
    rutDaysLeft(){const r=this.p.rut;if(!r||r.active)return 0;return Math.max(0,r.cycleDays-(r.daysSinceLast||0));}
    heatProg(){const h=this.p.heat;if(!h)return 0;if(h.active)return(h.currentDay/h.duration)*100;return((h.daysSinceLast||0)/h.cycleDays)*100;}
    rutProg(){const r=this.p.rut;if(!r)return 0;if(r.active)return(r.currentDay/r.duration)*100;return((r.daysSinceLast||0)/r.cycleDays)*100;}
    advanceHeat(d){const h=this.p.heat;if(!h||h.onSuppressants)return;const a=extension_settings[extensionName].auSettings?.omegaverse;h.cycleDays=a?.heatCycleLength||30;h.duration=a?.heatDuration||5;for(let i=0;i<d;i++){if(h.active){h.currentDay++;if(h.currentDay>h.duration){h.active=false;h.currentDay=0;h.daysSinceLast=0;}}else{h.daysSinceLast=(h.daysSinceLast||0)+1;if(h.daysSinceLast>=h.cycleDays){h.active=true;h.currentDay=1;h.intensity="severe";}}}}
    advanceRut(d){const r=this.p.rut;if(!r)return;const a=extension_settings[extensionName].auSettings?.omegaverse;r.cycleDays=a?.rutCycleLength||35;r.duration=a?.rutDuration||4;for(let i=0;i<d;i++){if(r.active){r.currentDay++;if(r.currentDay>r.duration){r.active=false;r.currentDay=0;r.daysSinceLast=0;}}else{r.daysSinceLast=(r.daysSinceLast||0)+1;if(r.daysSinceLast>=r.cycleDays){r.active=true;r.currentDay=1;r.intensity="moderate";}}}}
}

class PregnancyManager {
    constructor(p){this.p=p;this.pr=p.pregnancy;}
    active(){return this.pr?.active;}
    start(f,c){const s=extension_settings[extensionName];this.pr.active=true;this.pr.week=1;this.pr.day=0;this.pr.father=f;this.pr.fetusCount=c||1;this.pr.weightGain=0;let m=40;if(s.modules.auOverlay&&s.auPreset==="omegaverse")m=s.auSettings.omegaverse.pregnancyWeeks||36;else if(s.modules.auOverlay&&s.auPreset==="fantasy"&&this.p.race)m=s.auSettings.fantasy.pregnancyByRace[this.p.race]||40;if(c>1)m=Math.max(28,m-(c-1)*3);this.pr.maxWeeks=m;if(this.p.cycle)this.p.cycle.enabled=false;}
    advanceDay(d){if(!this.active())return;this.pr.day+=d;while(this.pr.day>=7){this.pr.day-=7;this.pr.week++;}this.pr.weightGain=this.wg();}
    tri(){return this.pr.week<=12?1:this.pr.week<=27?2:3;}
    size(){const sz=[[4,"маковое зерно"],[8,"малина"],[12,"лайм"],[16,"авокадо"],[20,"банан"],[28,"баклажан"],[36,"дыня"],[40,"арбуз"]];let r="эмбрион";for(const[w,n]of sz)if(this.pr.week>=w)r=n;return r;}
    symptoms(){const w=this.pr.week,r=[];if(w>=4&&w<=14)r.push("тошнота","усталость");if(w>=14&&w<=27){r.push("рост живота");if(w>=18)r.push("шевеления");}if(w>=28){r.push("одышка","отёки");if(w>=32)r.push("тренировочные схватки");}return r;}
    moves(){const w=this.pr.week;if(w<16)return"нет";if(w<22)return"бабочки";if(w<28)return"толчки";if(w<34)return"активные";return"реже";}
    wg(){const w=this.pr.week;let b;if(w<=12)b=w*0.2;else if(w<=27)b=2.4+(w-12)*0.45;else b=9.15+(w-27)*0.4;return Math.round(b*(1+(this.pr.fetusCount-1)*0.3)*10)/10;}
    body(){const w=this.pr.week,r=[];if(w>=6)r.push("грудь↑");if(w>=12)r.push("живот округляется");if(w>=24)r.push("растяжки");if(w>=36)r.push("живот опускается");return r;}
    emo(){return{1:"тревога",2:"привязанность",3:"гнездование"}[this.tri()]||"стабильно";}
}

const LS=["latent","active","transition","pushing","birth","placenta"];
const LL={latent:"Латентная",active:"Активная",transition:"Переходная",pushing:"Потуги",birth:"Рождение",placenta:"Плацента"};

class LaborManager {
    constructor(p){this.p=p;this.l=p.labor;}
    start(){this.l.active=true;this.l.stage="latent";this.l.dilation=0;this.l.contractionInterval=20;this.l.contractionDuration=30;this.l.hoursElapsed=0;this.l.babiesDelivered=0;this.l.totalBabies=this.p.pregnancy?.fetusCount||1;}
    advance(){const i=LS.indexOf(this.l.stage);if(i<LS.length-1){this.l.stage=LS[i+1];if(this.l.stage==="active"){this.l.dilation=5;this.l.contractionInterval=5;this.l.hoursElapsed+=5;}if(this.l.stage==="transition"){this.l.dilation=8;this.l.contractionInterval=2;this.l.hoursElapsed+=2;}if(this.l.stage==="pushing"){this.l.dilation=10;this.l.hoursElapsed+=1;}}}
    desc(){return{latent:"Лёгкие схватки, 0-3 см",active:"Сильные схватки, 4-7 см",transition:"Пиковые схватки, 7-10 см",pushing:"Потуги",birth:"Рождение",placenta:"Плацента"}[this.l.stage]||"";}
    deliver(){this.l.babiesDelivered++;if(this.l.babiesDelivered>=this.l.totalBabies)this.l.stage="placenta";}
    end(){this.l.active=false;this.p.pregnancy.active=false;if(this.p.cycle){this.p.cycle.enabled=true;this.p.cycle.currentDay=1;}}
}

class BabyManager {
    constructor(b){this.b=b;}
    static gen(mother,father,overrides){
        const s=extension_settings[extensionName],fp=s.characters[father];
        const sex=overrides?.sex||(Math.random()<0.5?"M":"F");
        let sec=overrides?.secondarySex||null;
        if(!sec&&s.modules.auOverlay&&s.auPreset==="omegaverse"){const r=Math.random();sec=r<0.25?"alpha":r<0.75?"beta":"omega";}
        const nf=[];if(s.modules.auOverlay&&s.auPreset==="fantasy"&&s.auSettings.fantasy.nonHumanFeatures){if(Math.random()<0.3)nf.push("заострённые уши");}
        const bw=3200+Math.floor(Math.random()*800)-400;
        return{
            name:overrides?.name||"",
            sex, secondarySex:sec,
            birthWeight:mother.pregnancy?.fetusCount>1?Math.round(bw*0.85):bw,
            currentWeight:bw,ageDays:0,
            eyeColor:overrides?.eyeColor||(Math.random()<0.5?(mother.eyeColor||""):(fp?.eyeColor||"")),
            hairColor:overrides?.hairColor||(Math.random()<0.5?(mother.hairColor||""):(fp?.hairColor||"")),
            mother:mother.name,father,nonHumanFeatures:nf,state:"новорождённый",
            birthDate:{...s.worldDate}
        };
    }
    age(){const d=this.b.ageDays;if(d<1)return"новорождённый";if(d<7)return d+" дн.";if(d<30)return Math.floor(d/7)+" нед.";if(d<365)return Math.floor(d/30)+" мес.";const y=Math.floor(d/365),m=Math.floor((d%365)/30);return m>0?y+" г. "+m+" мес.":y+" г.";}
    milestones(){const d=this.b.ageDays,r=[];if(d>=42)r.push("улыбка");if(d>=90)r.push("голову");if(d>=180)r.push("сидит");if(d>=240)r.push("ползает");if(d>=365)r.push("ходит");if(d>=730)r.push("бегает");return r;}
    update(){this.b.currentWeight=this.b.birthWeight+this.b.ageDays*(this.b.ageDays<120?30:this.b.ageDays<365?15:7);if(this.b.ageDays<28)this.b.state="новорождённый";else if(this.b.ageDays<365)this.b.state="младенец";else if(this.b.ageDays<1095)this.b.state="малыш";else this.b.state="ребёнок";}
}

// ==========================================
// INTIMACY + DICE
// ==========================================

class IntimacyManager {
    static log(e){const s=extension_settings[extensionName];e.ts=fmt(s.worldDate);s.intimacyLog.push(e);if(s.intimacyLog.length>100)s.intimacyLog=s.intimacyLog.slice(-100);saveSettingsDebounced();}
    static roll(tg,d){const s=extension_settings[extensionName],p=s.characters[tg];if(!p)return{result:false,chance:0,roll:0};let f=0.05;if(p.cycle?.enabled)f=new CycleManager(p).fertility();const ce={none:0,condom:0.85,pill:0.91,iud:0.99,withdrawal:0.73}[p.contraception]||0;if(d.nc){}else if(d.co)f*=0.15;else f*=(1-ce);if(d.ej==="outside")f*=0.05;if(d.tp==="anal"||d.tp==="oral")f=0;if(p.pregnancy?.active)f=0;if(p.bioSex==="M"&&!(s.modules.auOverlay&&s.auPreset==="omegaverse"&&s.auSettings.omegaverse.maleOmegaPregnancy&&p.secondarySex==="omega"))f=0;const ch=Math.round(clamp(f,0,0.95)*100),r=dice(100),res=r<=ch;const entry={ts:fmt(s.worldDate),target:tg,pa:d.pa||[],chance:ch,roll:r,result:res,contra:d.nc?"нет":(d.co?"да":p.contraception),type:d.tp,ejac:d.ej,auto:d.auto||false};s.diceLog.push(entry);if(s.diceLog.length>50)s.diceLog=s.diceLog.slice(-50);saveSettingsDebounced();return entry;}
}

// ==========================================
// PROMPT INJECTOR
// ==========================================

class PromptInjector {
    static gen(){const s=extension_settings[extensionName];if(!s.promptInjectionEnabled)return"";const d=s.promptInjectionDetail,l=["[LifeCycle System]","Date: "+fmt(s.worldDate)];
        // Relationships
        const relText=RelationshipManager.toPromptText();if(relText)l.push("\n"+relText);
        Object.entries(s.characters).forEach(([n,p])=>{if(!p._enabled)return;l.push("\n--- "+n+" ---");l.push("Sex: "+p.bioSex+(p.secondarySex?" / "+p.secondarySex:""));
            if(s.modules.auOverlay&&s.auPreset==="omegaverse"){const hr=new HeatRutManager(p);if(p.heat?.active)l.push("IN HEAT ("+HeatRutManager.HP[hr.heatPhase()]+"): Day "+p.heat.currentDay+"/"+p.heat.duration+"\nSymptoms: "+hr.heatSymptoms().join(", "));else if(p.secondarySex==="omega")l.push("Heat cycle: "+hr.heatDaysLeft()+" days until next");if(p.rut?.active)l.push("IN RUT ("+HeatRutManager.RP[hr.rutPhase()]+"): Day "+p.rut.currentDay+"/"+p.rut.duration+"\nSymptoms: "+hr.rutSymptoms().join(", "));else if(p.secondarySex==="alpha")l.push("Rut cycle: "+hr.rutDaysLeft()+" days until next");if(p.heat?.onSuppressants)l.push("On suppressants");}
            if(s.modules.cycle&&p.cycle?.enabled&&!p.pregnancy?.active){const cm=new CycleManager(p);l.push("Cycle: Day "+p.cycle.currentDay+"/"+p.cycle.length+" ("+cm.label(cm.phase())+")");if(d!=="low")l.push("Fertility: "+Math.round(cm.fertility()*100)+"%, Libido: "+cm.libido());}
            if(s.modules.pregnancy&&p.pregnancy?.active){const pm=new PregnancyManager(p);l.push("PREGNANT: Wk "+p.pregnancy.week+"/"+p.pregnancy.maxWeeks+" T"+pm.tri());l.push("Size: ~"+pm.size()+", Moves: "+pm.moves());if(d!=="low")l.push("Symptoms: "+pm.symptoms().join(", "));}
            if(s.modules.labor&&p.labor?.active)l.push("IN LABOR: "+LL[p.labor.stage]+" "+p.labor.dilation+"cm");
            if(s.modules.baby&&p.babies?.length>0&&d!=="low")p.babies.forEach(b=>{const bm=new BabyManager(b);l.push("Child: "+(b.name||"?")+" ("+(b.sex==="M"?"♂":"♀")+", "+bm.age()+")");});
            if(p.contraception!=="none")l.push("Contraception: "+p.contraception);
        });
        l.push("\n[Instructions]\nReflect all states naturally. Relationships affect character dynamics.\n[/LifeCycle System]");return l.join("\n");
    }
}

// ==========================================
// STATUS WIDGET (same structure as v0.5.0 — with relationships)
// ==========================================

class StatusWidget {
    static generate(){const s=extension_settings[extensionName];if(!s.enabled||!s.showStatusWidget)return"";const ch=Object.entries(s.characters).filter(([_,p])=>p._enabled);if(ch.length===0)return"";
        let h='<div class="lc-status-widget"><div class="lc-sw-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'\':\'none\';this.querySelector(\'.lc-sw-arrow\').textContent=this.nextElementSibling.style.display===\'none\'?\'▶\':\'▼\'"><span>🌿 LifeCycle</span><span class="lc-sw-arrow">▼</span></div><div class="lc-sw-body"><div class="lc-sw-date">'+fmt(s.worldDate)+'</div>';
        for(const [n,p] of ch){
            h+='<div class="lc-sw-char"><div class="lc-sw-char-name">'+n+(p.secondarySex?' <span class="lc-sw-sec-badge">'+p.secondarySex+'</span>':'')+'</div>';
            // Relationships
            const rels=RelationshipManager.getFor(n);
            if(rels.length>0){h+='<div class="lc-sw-rels">';for(const r of rels.slice(0,4)){const other=r.char1===n?r.char2:r.char1;const tp=r.char1===n?r.type:RelationshipManager.getReciprocalType(r.type);h+='<span class="lc-sw-rel-tag">'+tp+': '+other+'</span>';}h+='</div>';}
            if(s.modules.labor&&p.labor?.active){const lm=new LaborManager(p);h+='<div class="lc-sw-block lc-sw-labor-block"><div class="lc-sw-block-title">🏥 РОДЫ</div><div class="lc-sw-row">'+LL[p.labor.stage]+' · '+p.labor.dilation+'/10 см</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:'+(p.labor.dilation*10)+'%"></div></div></div>';}
            else if(s.modules.pregnancy&&p.pregnancy?.active){const pm=new PregnancyManager(p);const pr=Math.round((p.pregnancy.week/p.pregnancy.maxWeeks)*100);h+='<div class="lc-sw-block lc-sw-preg-block"><div class="lc-sw-block-title">🤰 Неделя '+p.pregnancy.week+'/'+p.pregnancy.maxWeeks+' · T'+pm.tri()+'</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:'+pr+'%"></div></div><div class="lc-sw-row">~'+pm.size()+' · '+pm.moves()+'</div><div class="lc-sw-symptoms">'+pm.symptoms().join(' · ')+'</div></div>';}
            if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.heat?.active){const hr=new HeatRutManager(p);h+='<div class="lc-sw-block lc-sw-heat-block"><div class="lc-sw-block-title">🔥 '+HeatRutManager.HP[hr.heatPhase()]+' · День '+p.heat.currentDay+'/'+p.heat.duration+'</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill heat" style="width:'+hr.heatProg()+'%"></div></div><div class="lc-sw-symptoms">'+hr.heatSymptoms().join(' · ')+'</div></div>';}
            if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.rut?.active){const hr=new HeatRutManager(p);h+='<div class="lc-sw-block lc-sw-rut-block"><div class="lc-sw-block-title">💢 '+HeatRutManager.RP[hr.rutPhase()]+' · День '+p.rut.currentDay+'/'+p.rut.duration+'</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill rut" style="width:'+hr.rutProg()+'%"></div></div><div class="lc-sw-symptoms">'+hr.rutSymptoms().join(' · ')+'</div></div>';}
            if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.secondarySex==="omega"&&!p.heat?.active&&!p.pregnancy?.active){const hr=new HeatRutManager(p);h+='<div class="lc-sw-block lc-sw-cycle-block"><div class="lc-sw-block-title">🔮 Течка через '+hr.heatDaysLeft()+' дн.'+(hr.heatDaysLeft()<=3?' ⚠️':'')+'</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill heat-cycle" style="width:'+hr.heatProg()+'%"></div></div></div>';}
            if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.secondarySex==="alpha"&&!p.rut?.active){const hr=new HeatRutManager(p);h+='<div class="lc-sw-block lc-sw-cycle-block"><div class="lc-sw-block-title">⚡ Гон через '+hr.rutDaysLeft()+' дн.</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill rut-cycle" style="width:'+hr.rutProg()+'%"></div></div></div>';}
            if(s.modules.cycle&&p.cycle?.enabled&&!p.pregnancy?.active&&!p.labor?.active){const cm=new CycleManager(p),ph=cm.phase(),f=cm.fertility();let fc="low";if(f>=0.2)fc="peak";else if(f>=0.1)fc="high";else if(f>=0.05)fc="med";h+='<div class="lc-sw-block lc-sw-cycle-block"><div class="lc-sw-block-title">'+cm.emoji(ph)+' '+cm.label(ph)+'</div><div class="lc-sw-row">День '+p.cycle.currentDay+'/'+p.cycle.length+' · <span class="lc-sw-fert '+fc+'">'+Math.round(f*100)+'%</span> · '+cm.libido()+'</div></div>';}
            if(s.modules.baby&&p.babies?.length>0){h+='<div class="lc-sw-block lc-sw-baby-block">';for(const b of p.babies){const bm=new BabyManager(b);h+='<div class="lc-sw-baby-row">👶 <strong>'+(b.name||'?')+'</strong> ('+(b.sex==="M"?'♂':'♀')+') '+bm.age()+'</div>';}h+='</div>';}
            h+='</div>';
        }
        if(s.diceLog.length>0){const la=s.diceLog[s.diceLog.length-1];h+='<div class="lc-sw-dice"><span class="lc-sw-dice-label">🎲</span> <span class="'+(la.result?'lc-sw-dice-win':'lc-sw-dice-lose')+'">'+la.roll+'/'+la.chance+'% '+(la.result?'✅':'❌')+'</span></div>';}
        h+='</div></div>';return h;
    }
    static inject(idx){const s=extension_settings[extensionName];if(!s.enabled||!s.showStatusWidget)return;const w=StatusWidget.generate();if(!w)return;setTimeout(()=>{const el=document.querySelector('#chat .mes[mesid="'+idx+'"]');if(!el)return;const mt=el.querySelector('.mes_text');if(!mt)return;mt.querySelectorAll('.lc-status-widget').forEach(x=>x.remove());mt.insertAdjacentHTML('beforeend',w);},300);}
}

// ==========================================
// DICE POPUP
// ==========================================

function showDice(res,tg,auto){document.querySelector(".lc-overlay")?.remove();document.querySelector(".lc-popup")?.remove();const ov=document.createElement("div");ov.className="lc-overlay";const po=document.createElement("div");po.className="lc-popup";po.innerHTML='<div class="lc-popup-title">🎲 Бросок</div>'+(auto?'<div class="lc-popup-auto">⚡ Авто</div>':'')+'<div class="lc-popup-details"><div>Цель: <strong>'+tg+'</strong></div><div>'+res.type+' | '+res.ejac+' | Контр.: '+res.contra+'</div><div>Шанс: '+res.chance+'%</div></div><div class="lc-popup-result '+(res.result?'success':'fail')+'">'+res.roll+' / '+res.chance+'</div><div class="lc-popup-verdict '+(res.result?'success':'fail')+'">'+(res.result?'✅ ЗАЧАТИЕ!':'❌ Нет')+'</div><div class="lc-popup-actions"><button id="lc-d-ok" class="lc-btn lc-btn-success">ОК</button><button id="lc-d-re" class="lc-btn">🎲</button><button id="lc-d-no" class="lc-btn lc-btn-danger">✕</button></div>';
    document.body.appendChild(ov);document.body.appendChild(po);
    document.getElementById("lc-d-ok").addEventListener("click",()=>{if(res.result){const p=extension_settings[extensionName].characters[tg];if(p){new PregnancyManager(p).start(res.pa?.find(x=>x!==tg)||"?",1);saveSettingsDebounced();rebuildUI();}}ov.remove();po.remove();});
    document.getElementById("lc-d-re").addEventListener("click",()=>{ov.remove();po.remove();const nr=IntimacyManager.roll(tg,{pa:res.pa,tp:res.type,ej:res.ejac,co:false,nc:res.contra==="нет",auto});showDice(nr,tg,auto);});
    document.getElementById("lc-d-no").addEventListener("click",()=>{ov.remove();po.remove();});
    ov.addEventListener("click",()=>{ov.remove();po.remove();});
}

// ==========================================
// BABY CREATION/EDIT FORM (inline, no prompt()!)
// ==========================================

function showBabyForm(motherName, fatherName, existingBaby, babyIndex) {
    const s = extension_settings[extensionName];
    const isEdit = !!existingBaby;
    const b = existingBaby || {};

    document.getElementById("lc-baby-form-overlay")?.remove();

    const ov = document.createElement("div"); ov.className = "lc-overlay"; ov.id = "lc-baby-form-overlay";
    const fm = document.createElement("div"); fm.className = "lc-popup"; fm.style.maxWidth = "400px";

    fm.innerHTML =
        '<div class="lc-popup-title">' + (isEdit ? '✏️ Редактировать ребёнка' : '👶 Новый ребёнок') + '</div>' +
        '<div class="lc-editor-grid">' +
            '<div class="lc-editor-field"><label>Имя</label><input type="text" id="lc-bf-name" class="lc-input" value="' + (b.name || '') + '" placeholder="Имя малыша"></div>' +
            '<div class="lc-editor-field"><label>Пол</label><select id="lc-bf-sex" class="lc-select"><option value="M"' + (b.sex === "M" ? ' selected' : '') + '>♂ Мальчик</option><option value="F"' + (b.sex === "F" ? ' selected' : '') + '>♀ Девочка</option><option value="random">🎲 Случайно</option></select></div>' +
            '<div class="lc-editor-field"><label>Вторичный пол</label><select id="lc-bf-sec" class="lc-select"><option value="">нет</option><option value="alpha"' + (b.secondarySex === "alpha" ? ' selected' : '') + '>Alpha</option><option value="beta"' + (b.secondarySex === "beta" ? ' selected' : '') + '>Beta</option><option value="omega"' + (b.secondarySex === "omega" ? ' selected' : '') + '>Omega</option><option value="random">🎲 Случайно</option></select></div>' +
            '<div class="lc-editor-field"><label>Цвет глаз</label><input type="text" id="lc-bf-eyes" class="lc-input" value="' + (b.eyeColor || '') + '" placeholder="авто"></div>' +
            '<div class="lc-editor-field"><label>Цвет волос</label><input type="text" id="lc-bf-hair" class="lc-input" value="' + (b.hairColor || '') + '" placeholder="авто"></div>' +
            (isEdit ? '<div class="lc-editor-field"><label>Возраст (дни)</label><input type="number" id="lc-bf-age" class="lc-input" value="' + (b.ageDays || 0) + '" min="0"></div>' : '') +
        '</div>' +
        '<div class="lc-popup-actions" style="margin-top:12px">' +
            '<button id="lc-bf-save" class="lc-btn lc-btn-success">' + (isEdit ? '💾 Сохранить' : '👶 Родить!') + '</button>' +
            '<button id="lc-bf-cancel" class="lc-btn">Отмена</button>' +
        '</div>';

    document.body.appendChild(ov);
    document.body.appendChild(fm);

    document.getElementById("lc-bf-save").addEventListener("click", () => {
        const nameVal = document.getElementById("lc-bf-name").value.trim() || "Малыш";
        let sexVal = document.getElementById("lc-bf-sex").value;
        if (sexVal === "random") sexVal = Math.random() < 0.5 ? "M" : "F";
        let secVal = document.getElementById("lc-bf-sec").value;
        if (secVal === "random") { const r = Math.random(); secVal = r < 0.25 ? "alpha" : r < 0.75 ? "beta" : "omega"; }
        const eyesVal = document.getElementById("lc-bf-eyes").value.trim();
        const hairVal = document.getElementById("lc-bf-hair").value.trim();

        if (isEdit) {
            const mother = s.characters[motherName];
            if (mother?.babies?.[babyIndex]) {
                const baby = mother.babies[babyIndex];
                baby.name = nameVal;
                baby.sex = sexVal;
                baby.secondarySex = secVal || null;
                if (eyesVal) baby.eyeColor = eyesVal;
                if (hairVal) baby.hairColor = hairVal;
                const ageVal = document.getElementById("lc-bf-age")?.value;
                if (ageVal !== undefined) { baby.ageDays = parseInt(ageVal) || 0; new BabyManager(baby).update(); }
                saveSettingsDebounced();
                rebuildUI();
                toastr.success("Ребёнок обновлён: " + nameVal);
            }
        } else {
            const mother = s.characters[motherName];
            if (mother) {
                const baby = BabyManager.gen(mother, fatherName, { name: nameVal, sex: sexVal, secondarySex: secVal || null, eyeColor: eyesVal, hairColor: hairVal });
                mother.babies.push(baby);
                RelationshipManager.addBirthRelationships(motherName, fatherName, nameVal);
                const lm = new LaborManager(mother);
                lm.deliver();
                if (lm.l.babiesDelivered >= lm.l.totalBabies) lm.end();
                saveSettingsDebounced();
                rebuildUI();
                toastr.success("Родился: " + nameVal + " (" + (sexVal === "M" ? "♂" : "♀") + ")!");
            }
        }

        ov.remove(); fm.remove();
    });

    document.getElementById("lc-bf-cancel").addEventListener("click", () => { ov.remove(); fm.remove(); });
    ov.addEventListener("click", () => { ov.remove(); fm.remove(); });
}

// ==========================================
// JSON HELPERS
// ==========================================

function downloadJSON(d,fn){const b=new Blob([JSON.stringify(d,null,2)],{type:"application/json"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=fn;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u);}
function uploadJSON(cb){const i=document.createElement("input");i.type="file";i.accept=".json";i.addEventListener("change",e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{cb(JSON.parse(ev.target.result));}catch(er){toastr.error("JSON: "+er.message);}};r.readAsText(f);});i.click();}

// ==========================================
// HTML + RENDER + BIND (with relationships tab & baby form)
// ==========================================

function buildSel(id){const n=Object.keys(extension_settings[extensionName].characters);return'<select id="'+id+'" class="lc-select lc-char-select">'+n.map(x=>'<option value="'+x+'">'+x+'</option>').join("")+'</select>';}

function generateHTML(){
    const s=extension_settings[extensionName];
    return '<div id="lifecycle-panel" class="lifecycle-panel'+(s.panelCollapsed?' collapsed':'')+'">'+
        '<div class="lifecycle-header" id="lifecycle-header-toggle"><div class="lifecycle-header-title"><span class="lc-collapse-arrow">'+(s.panelCollapsed?'▶':'▼')+'</span><h3>LifeCycle</h3><span class="lc-version">v0.6</span></div><div class="lifecycle-header-actions"><label class="lc-switch"><input type="checkbox" id="lc-enabled" '+(s.enabled?'checked':'')+'><span class="lc-switch-slider"></span></label></div></div>'+
        '<div class="lifecycle-body" id="lifecycle-body">'+
            '<div class="lc-dashboard"><div id="lc-dashboard-date" class="lc-dashboard-date"></div><div id="lc-dashboard-items"></div></div>'+
            '<div class="lifecycle-tabs">'+
                '<button class="lifecycle-tab active" data-tab="chars"><span class="tab-icon">👥</span>Перс.</button>'+
                '<button class="lifecycle-tab" data-tab="rels"><span class="tab-icon">💞</span>Семья</button>'+
                '<button class="lifecycle-tab" data-tab="cycle"><span class="tab-icon">🔴</span>Цикл</button>'+
                '<button class="lifecycle-tab" data-tab="heatrut"><span class="tab-icon">🔥</span>Течка</button>'+
                '<button class="lifecycle-tab" data-tab="intim"><span class="tab-icon">💕</span>Интим</button>'+
                '<button class="lifecycle-tab" data-tab="preg"><span class="tab-icon">🤰</span>Берем.</button>'+
                '<button class="lifecycle-tab" data-tab="labor"><span class="tab-icon">🏥</span>Роды</button>'+
                '<button class="lifecycle-tab" data-tab="babies"><span class="tab-icon">👶</span>Дети</button>'+
                '<button class="lifecycle-tab" data-tab="settings"><span class="tab-icon">⚙️</span>Настр.</button>'+
            '</div>'+
            // CHARS
            '<div class="lifecycle-tab-content active" data-tab="chars"><div class="lc-btn-group" style="margin-bottom:8px"><button id="lc-sync-chars" class="lc-btn lc-btn-primary">🔄 Синхр.</button><button id="lc-add-manual" class="lc-btn">+ Вручную</button><button id="lc-reparse" class="lc-btn">📖 Перечитать</button></div><div id="lc-char-list"></div><div id="lc-char-editor" class="lc-editor hidden"><div id="lc-editor-title" class="lc-editor-title"></div><div class="lc-editor-grid"><div class="lc-editor-field"><label>Биол. пол</label><select id="lc-edit-bio-sex" class="lc-select"><option value="F">F</option><option value="M">M</option></select></div><div class="lc-editor-field"><label>Втор. пол</label><select id="lc-edit-sec-sex" class="lc-select"><option value="">нет</option><option value="alpha">Alpha</option><option value="beta">Beta</option><option value="omega">Omega</option></select></div><div class="lc-editor-field"><label>Раса</label><input type="text" id="lc-edit-race" class="lc-input"></div><div class="lc-editor-field"><label>Контрацепция</label><select id="lc-edit-contra" class="lc-select"><option value="none">нет</option><option value="condom">презерватив</option><option value="pill">таблетки</option><option value="iud">ВМС</option><option value="withdrawal">ППА</option></select></div><div class="lc-editor-field"><label>Глаза</label><input type="text" id="lc-edit-eyes" class="lc-input"></div><div class="lc-editor-field"><label>Волосы</label><input type="text" id="lc-edit-hair" class="lc-input"></div><div class="lc-editor-field"><label>Сложн.</label><select id="lc-edit-diff" class="lc-select"><option value="easy">лёгкая</option><option value="normal">обычная</option><option value="severe">тяжёлая</option></select></div><div class="lc-editor-field"><label>Вкл.</label><input type="checkbox" id="lc-edit-enabled" checked></div><div class="lc-editor-field"><label>Цикл</label><input type="checkbox" id="lc-edit-cycle-on" checked></div><div class="lc-editor-field"><label>Длина</label><input type="number" id="lc-edit-cycle-len" class="lc-input" min="21" max="45" value="28"></div></div><div class="lc-editor-actions"><button id="lc-editor-save" class="lc-btn lc-btn-success">💾</button><button id="lc-editor-cancel" class="lc-btn">✕</button></div></div></div>'+
            // RELATIONSHIPS
            '<div class="lifecycle-tab-content" data-tab="rels"><div class="lc-section"><div class="lc-section-title"><h4>Добавить связь</h4></div><div class="lc-row">'+buildSel("lc-rel-char1")+'<select id="lc-rel-type" class="lc-select">'+REL_TYPES.map(t=>'<option value="'+t+'">'+t+'</option>').join("")+'</select>'+buildSel("lc-rel-char2")+'</div><div class="lc-row"><input type="text" id="lc-rel-notes" class="lc-input" placeholder="Заметка (необязательно)"><button id="lc-rel-add" class="lc-btn lc-btn-success">+ Добавить</button></div></div><div id="lc-rel-list"></div></div>'+
            // CYCLE
            '<div class="lifecycle-tab-content" data-tab="cycle">'+buildSel("lc-cycle-char")+'<div id="lc-cycle-panel"></div></div>'+
            // HEAT/RUT
            '<div class="lifecycle-tab-content" data-tab="heatrut">'+buildSel("lc-hr-char")+'<div id="lc-hr-panel"></div></div>'+
            // INTIMACY
            '<div class="lifecycle-tab-content" data-tab="intim"><div class="lc-section"><div class="lc-row">'+buildSel("lc-intim-target")+buildSel("lc-intim-partner")+'</div><div class="lc-row"><select id="lc-intim-type" class="lc-select"><option value="vaginal">Вагинальный</option><option value="anal">Анальный</option><option value="oral">Оральный</option></select><select id="lc-intim-ejac" class="lc-select"><option value="inside">Внутрь</option><option value="outside">Снаружи</option></select></div><div class="lc-btn-group"><button id="lc-intim-log-btn" class="lc-btn">📝</button><button id="lc-intim-roll-btn" class="lc-btn lc-btn-primary">🎲</button></div></div><div class="lc-section"><h4>Лог бросков</h4><div id="lc-dice-log" class="lc-scroll"></div></div><div class="lc-section"><h4>Лог актов</h4><div id="lc-intim-log-list" class="lc-scroll"></div></div></div>'+
            // PREGNANCY
            '<div class="lifecycle-tab-content" data-tab="preg">'+buildSel("lc-preg-char")+'<div id="lc-preg-panel"></div><div class="lc-btn-group" style="margin-top:6px"><button id="lc-preg-advance" class="lc-btn">+1нед</button><button id="lc-preg-set" class="lc-btn">Уст.нед</button><button id="lc-preg-to-labor" class="lc-btn lc-btn-danger">→Роды</button><button id="lc-preg-end" class="lc-btn lc-btn-danger">Прервать</button></div></div>'+
            // LABOR (with inline baby form button)
            '<div class="lifecycle-tab-content" data-tab="labor">'+buildSel("lc-labor-char")+'<div id="lc-labor-panel"></div><div class="lc-btn-group" style="margin-top:6px"><button id="lc-labor-advance" class="lc-btn">→Стадия</button><button id="lc-labor-deliver" class="lc-btn lc-btn-success">👶 Родить</button><button id="lc-labor-end" class="lc-btn lc-btn-danger">Завершить</button></div></div>'+
            // BABIES (with edit button)
            '<div class="lifecycle-tab-content" data-tab="babies">'+buildSel("lc-baby-parent")+'<div id="lc-baby-list"></div></div>'+
            // SETTINGS
            '<div class="lifecycle-tab-content" data-tab="settings">'+
                '<div class="lc-section"><h4>Автоматизация</h4>'+
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-sync" '+(s.autoSyncCharacters?'checked':'')+'><span>Авто-синхр.</span></label>'+
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-parse" '+(s.autoParseCharInfo?'checked':'')+'><span>Авто-парсинг карточек</span></label>'+
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-parse-chat" '+(s.parseFullChat?'checked':'')+'><span>Парсить чат</span></label>'+
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-detect" '+(s.autoDetectIntimacy?'checked':'')+'><span>Авто-детекция секса</span></label>'+
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-roll" '+(s.autoRollOnSex?'checked':'')+'><span>Авто-бросок</span></label>'+
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-show-widget" '+(s.showStatusWidget?'checked':'')+'><span>Виджет</span></label>'+
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-auto-time" '+(s.autoTimeProgress?'checked':'')+'><span>Авто-время</span></label>'+
                    '<label class="lc-checkbox"><input type="checkbox" id="lc-time-confirm" '+(s.timeParserConfirmation?'checked':'')+'><span>Подтверждение времени</span></label>'+
                '</div>'+
                '<div class="lc-section"><h4>Дата мира</h4><div class="lc-row"><input type="number" id="lc-date-y" class="lc-input" style="width:70px" value="'+s.worldDate.year+'"><input type="number" id="lc-date-m" class="lc-input" style="width:50px" value="'+s.worldDate.month+'"><input type="number" id="lc-date-d" class="lc-input" style="width:50px" value="'+s.worldDate.day+'"><input type="number" id="lc-date-h" class="lc-input" style="width:50px" value="'+s.worldDate.hour+'">:<input type="number" id="lc-date-min" class="lc-input" style="width:50px" value="'+s.worldDate.minute+'"></div><div class="lc-btn-group"><button id="lc-date-apply" class="lc-btn">Применить</button><button id="lc-date-plus1" class="lc-btn">+1д</button><button id="lc-date-plus7" class="lc-btn">+7д</button></div><label class="lc-checkbox"><input type="checkbox" id="lc-date-frozen" '+(s.worldDate.frozen?'checked':'')+'><span>Заморозить</span></label></div>'+
                '<div class="lc-section"><h4>Модули</h4><label class="lc-checkbox"><input type="checkbox" id="lc-mod-cycle" '+(s.modules.cycle?'checked':'')+'><span>Цикл</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-mod-preg" '+(s.modules.pregnancy?'checked':'')+'><span>Беременность</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-mod-labor" '+(s.modules.labor?'checked':'')+'><span>Роды</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-mod-baby" '+(s.modules.baby?'checked':'')+'><span>Дети</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-mod-intim" '+(s.modules.intimacy?'checked':'')+'><span>Интим</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-mod-au" '+(s.modules.auOverlay?'checked':'')+'><span>AU</span></label></div>'+
                '<div class="lc-section"><h4>Промпт</h4><label class="lc-checkbox"><input type="checkbox" id="lc-prompt-on" '+(s.promptInjectionEnabled?'checked':'')+'><span>Вкл.</span></label><div class="lc-row"><select id="lc-prompt-pos" class="lc-select"><option value="system"'+(s.promptInjectionPosition==="system"?" selected":"")+'>System</option><option value="authornote"'+(s.promptInjectionPosition==="authornote"?" selected":"")+'>AN</option><option value="endofchat"'+(s.promptInjectionPosition==="endofchat"?" selected":"")+'>EoC</option></select><select id="lc-prompt-detail" class="lc-select"><option value="low"'+(s.promptInjectionDetail==="low"?" selected":"")+'>Низк.</option><option value="medium"'+(s.promptInjectionDetail==="medium"?" selected":"")+'>Средн.</option><option value="high"'+(s.promptInjectionDetail==="high"?" selected":"")+'>Выс.</option></select></div></div>'+
                '<div class="lc-section"><h4>AU</h4><select id="lc-au-preset" class="lc-select"><option value="realism"'+(s.auPreset==="realism"?" selected":"")+'>Реализм</option><option value="omegaverse"'+(s.auPreset==="omegaverse"?" selected":"")+'>Омегаверс</option><option value="fantasy"'+(s.auPreset==="fantasy"?" selected":"")+'>Фэнтези</option><option value="scifi"'+(s.auPreset==="scifi"?" selected":"")+'>Sci-Fi</option></select><div id="lc-au-panel"></div></div>'+
                '<div class="lc-section"><div class="lc-btn-group"><button id="lc-export" class="lc-btn">📤</button><button id="lc-import" class="lc-btn">📥</button><button id="lc-reset" class="lc-btn lc-btn-danger">🗑️</button></div></div>'+
            '</div>'+
        '</div></div>';
}

// ==========================================
// RENDER FUNCTIONS
// ==========================================

function rebuildUI(){renderDash();renderCharList();renderCycle();renderHR();renderPreg();renderLabor();renderBabies();renderDiceLog();renderIntimLog();renderRels();updateSels();}
function updateSels(){const n=Object.keys(extension_settings[extensionName].characters);const o=n.map(x=>'<option value="'+x+'">'+x+'</option>').join("");document.querySelectorAll(".lc-char-select").forEach(s=>{const v=s.value;s.innerHTML=o;if(n.includes(v))s.value=v;});}

function renderDash(){const s=extension_settings[extensionName];const de=document.getElementById("lc-dashboard-date"),ie=document.getElementById("lc-dashboard-items");if(!de||!ie)return;de.textContent="📅 "+fmt(s.worldDate)+(s.worldDate.frozen?" ❄️":"");let h="";Object.entries(s.characters).forEach(([n,p])=>{if(!p._enabled)return;let pa=[];if(s.modules.cycle&&p.cycle?.enabled&&!p.pregnancy?.active){const cm=new CycleManager(p);pa.push(cm.emoji(cm.phase())+cm.label(cm.phase()));}if(s.modules.pregnancy&&p.pregnancy?.active)pa.push("🤰Нед."+p.pregnancy.week);if(s.modules.labor&&p.labor?.active)pa.push("🏥");if(p.heat?.active)pa.push("🔥Течка");if(p.rut?.active)pa.push("💢Гон");if(p.babies?.length>0)pa.push("👶×"+p.babies.length);if(pa.length>0)h+='<div class="lc-dash-item"><span class="lc-dash-name">'+n+'</span> '+pa.join(' · ')+'</div>';});ie.innerHTML=h||'<div class="lc-dash-empty">Нет событий</div>';}

function renderCharList(){const s=extension_settings[extensionName],el=document.getElementById("lc-char-list");if(!el)return;let h="";Object.entries(s.characters).forEach(([n,p])=>{const sx=p.bioSex==="F"?"♀":"♂";const sec=p.secondarySex?" · "+p.secondarySex:"";h+='<div class="lc-char-card"><div class="lc-char-card-header"><span class="lc-char-card-name">'+n+'</span><span class="lc-char-card-info">'+sx+sec+' · '+(p.race||"human")+'</span></div>'+(p.eyeColor||p.hairColor?'<div class="lc-char-card-details">'+(p.eyeColor?'<span class="lc-tag">👁️'+p.eyeColor+'</span>':'')+(p.hairColor?'<span class="lc-tag">💇'+p.hairColor+'</span>':'')+'</div>':'')+'<div class="lc-char-card-actions"><button class="lc-btn lc-btn-sm lc-edit-char" data-char="'+n+'">✏️</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-del-char" data-char="'+n+'">🗑️</button></div></div>';});el.innerHTML=h||'<div class="lc-empty">Нажмите Синхр.</div>';}

function renderRels(){const s=extension_settings[extensionName],el=document.getElementById("lc-rel-list");if(!el)return;const rels=s.relationships||[];if(rels.length===0){el.innerHTML='<div class="lc-empty">Нет связей</div>';return;}let h="";for(const r of rels){h+='<div class="lc-char-card"><div class="lc-char-card-header"><span class="lc-char-card-name">'+r.char1+' → '+r.char2+'</span><span class="lc-char-card-info">'+r.type+'</span></div>'+(r.notes?'<div class="lc-char-card-details"><span class="lc-tag">'+r.notes+'</span></div>':'')+'<div class="lc-char-card-actions"><button class="lc-btn lc-btn-sm lc-btn-danger lc-del-rel" data-id="'+r.id+'">🗑️</button></div></div>';}el.innerHTML=h;el.querySelectorAll(".lc-del-rel").forEach(b=>b.addEventListener("click",function(){RelationshipManager.remove(this.dataset.id);renderRels();}));}

function renderCycle(){const s=extension_settings[extensionName],el=document.getElementById("lc-cycle-panel"),sel=document.getElementById("lc-cycle-char");if(!el||!sel)return;const p=s.characters[sel.value];if(!p?.cycle?.enabled||p.pregnancy?.active){el.innerHTML='<div class="lc-info">Неактивен</div>';return;}const cm=new CycleManager(p),ph=cm.phase(),f=cm.fertility();let fc="low";if(f>=0.2)fc="peak";else if(f>=0.1)fc="high";else if(f>=0.05)fc="med";let cal='<div class="lc-cycle-calendar">';for(let d=1;d<=p.cycle.length;d++){const ov=Math.round(p.cycle.length-14);let c="lc-cal-day";if(d<=p.cycle.menstruationDuration)c+=" mens";else if(d>=ov-2&&d<=ov+1)c+=" ovul";else if(d<ov-2)c+=" foll";else c+=" lut";if(d===p.cycle.currentDay)c+=" today";cal+='<div class="'+c+'">'+d+'</div>';}cal+='</div>';el.innerHTML=cal+'<div class="lc-cycle-info"><div>'+cm.emoji(ph)+' '+cm.label(ph)+' · День '+p.cycle.currentDay+'/'+p.cycle.length+'</div><div>Ферт.: <span class="lc-fert-badge '+fc+'">'+Math.round(f*100)+'%</span> · Либидо: '+cm.libido()+'</div><div>Выделения: '+cm.discharge()+'</div></div>';}

function renderHR(){const s=extension_settings[extensionName],el=document.getElementById("lc-hr-panel"),sel=document.getElementById("lc-hr-char");if(!el||!sel)return;const p=s.characters[sel.value];if(!p||!s.modules.auOverlay||s.auPreset!=="omegaverse"||!p.secondarySex){el.innerHTML='<div class="lc-info">Включите AU Омегаверс + альфа/омега</div>';return;}const hr=new HeatRutManager(p);let h="";if(p.secondarySex==="omega"){h+='<div class="lc-section"><h4>🔥 Течка — '+HeatRutManager.HP[hr.heatPhase()]+'</h4>';if(p.heat.active)h+='<div class="lc-info-row">День '+p.heat.currentDay+'/'+p.heat.duration+'</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill heat" style="width:'+hr.heatProg()+'%"></div></div>';else h+='<div class="lc-info-row">До следующей: '+hr.heatDaysLeft()+' дн.</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill heat-cycle" style="width:'+hr.heatProg()+'%"></div></div>';const hs=hr.heatSymptoms();if(hs.length)h+='<div class="lc-info-row">'+hs.join(', ')+'</div>';h+='<div class="lc-btn-group"><button id="lc-hr-th" class="lc-btn">🔥 Запустить</button><button id="lc-hr-sh" class="lc-btn">⏹ Стоп</button><button id="lc-hr-su" class="lc-btn">'+(p.heat.onSuppressants?'💊 Снять':'💊 Супр.')+'</button></div></div>';}
    if(p.secondarySex==="alpha"){h+='<div class="lc-section"><h4>💢 Гон — '+HeatRutManager.RP[hr.rutPhase()]+'</h4>';if(p.rut.active)h+='<div class="lc-info-row">День '+p.rut.currentDay+'/'+p.rut.duration+'</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill rut" style="width:'+hr.rutProg()+'%"></div></div>';else h+='<div class="lc-info-row">До следующего: '+hr.rutDaysLeft()+' дн.</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill rut-cycle" style="width:'+hr.rutProg()+'%"></div></div>';const rs=hr.rutSymptoms();if(rs.length)h+='<div class="lc-info-row">'+rs.join(', ')+'</div>';h+='<div class="lc-btn-group"><button id="lc-hr-tr" class="lc-btn">💢 Запустить</button><button id="lc-hr-sr" class="lc-btn">⏹ Стоп</button></div></div>';}
    el.innerHTML=h;
    document.getElementById("lc-hr-th")?.addEventListener("click",()=>{p.heat.active=true;p.heat.currentDay=1;p.heat.intensity="severe";saveSettingsDebounced();renderHR();renderDash();});
    document.getElementById("lc-hr-sh")?.addEventListener("click",()=>{p.heat.active=false;p.heat.currentDay=0;p.heat.daysSinceLast=0;saveSettingsDebounced();renderHR();renderDash();});
    document.getElementById("lc-hr-su")?.addEventListener("click",()=>{p.heat.onSuppressants=!p.heat.onSuppressants;saveSettingsDebounced();renderHR();});
    document.getElementById("lc-hr-tr")?.addEventListener("click",()=>{p.rut.active=true;p.rut.currentDay=1;saveSettingsDebounced();renderHR();renderDash();});
    document.getElementById("lc-hr-sr")?.addEventListener("click",()=>{p.rut.active=false;p.rut.currentDay=0;p.rut.daysSinceLast=0;saveSettingsDebounced();renderHR();renderDash();});
}

function renderPreg(){const s=extension_settings[extensionName],el=document.getElementById("lc-preg-panel"),sel=document.getElementById("lc-preg-char");if(!el||!sel)return;const p=s.characters[sel.value];if(!p?.pregnancy?.active){el.innerHTML='<div class="lc-info">Неактивна</div>';return;}const pm=new PregnancyManager(p),pr=p.pregnancy,pg=Math.round((pr.week/pr.maxWeeks)*100);el.innerHTML='<div class="lc-preg-header"><span class="lc-preg-week">Нед. '+pr.week+'/'+pr.maxWeeks+'</span><span class="lc-preg-trim">T'+pm.tri()+'</span></div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:'+pg+'%"></div></div><div class="lc-info-row">~'+pm.size()+' · Плодов: '+pr.fetusCount+' · Отец: '+(pr.father||'?')+'</div><div class="lc-info-row">Шевеления: '+pm.moves()+' · +'+pm.wg()+' кг</div><div class="lc-info-row">'+pm.symptoms().join(', ')+'</div>';}

function renderLabor(){const s=extension_settings[extensionName],el=document.getElementById("lc-labor-panel"),sel=document.getElementById("lc-labor-char");if(!el||!sel)return;const p=s.characters[sel.value];if(!p?.labor?.active){el.innerHTML='<div class="lc-info">Неактивны</div>';return;}const lm=new LaborManager(p);el.innerHTML='<div class="lc-labor-stage">'+LL[p.labor.stage]+'</div><div class="lc-info-row">Раскрытие: '+p.labor.dilation+'/10</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:'+(p.labor.dilation*10)+'%"></div></div><div class="lc-labor-desc">'+lm.desc()+'</div>';}

function renderBabies(){
    const s=extension_settings[extensionName],el=document.getElementById("lc-baby-list"),sel=document.getElementById("lc-baby-parent");if(!el||!sel)return;
    const pName=sel.value, p=s.characters[pName];
    if(!p?.babies?.length){el.innerHTML='<div class="lc-empty">Нет детей</div>';return;}
    let h="";
    p.babies.forEach((b,i)=>{const bm=new BabyManager(b);const ms=bm.milestones();
        // Show relationships for this baby
        const bRels=RelationshipManager.getFor(b.name).filter(r=>r.char1===b.name);
        let relStr="";if(bRels.length>0)relStr='<div class="lc-info-row">'+bRels.map(r=>r.type+": "+r.char2).join(', ')+'</div>';
        h+='<div class="lc-baby-card"><div class="lc-baby-header"><span class="lc-baby-name">'+(b.name||'#'+(i+1))+'</span><span class="lc-baby-sex">'+(b.sex==="M"?'♂':'♀')+(b.secondarySex?' · '+b.secondarySex:'')+'</span></div><div class="lc-baby-details"><div class="lc-info-row">'+bm.age()+' · '+b.state+' · '+(b.currentWeight/1000).toFixed(1)+' кг</div>'+(b.eyeColor||b.hairColor?'<div class="lc-info-row">'+(b.eyeColor?'👁️'+b.eyeColor+' ':'')+(b.hairColor?'💇'+b.hairColor:'')+'</div>':'')+(ms.length>0?'<div class="lc-info-row">Вехи: '+ms.join(', ')+'</div>':'')+relStr+'</div><div class="lc-baby-actions"><button class="lc-btn lc-btn-sm lc-baby-edit" data-p="'+pName+'" data-i="'+i+'">✏️</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-baby-del" data-p="'+pName+'" data-i="'+i+'">🗑️</button></div></div>';
    });
    el.innerHTML=h;
    // INLINE EDIT via baby form
    el.querySelectorAll(".lc-baby-edit").forEach(btn=>btn.addEventListener("click",function(){
        const parentName=this.dataset.p, idx=parseInt(this.dataset.i);
        const baby=s.characters[parentName]?.babies?.[idx];
        if(baby) showBabyForm(parentName, baby.father, baby, idx);
    }));
    el.querySelectorAll(".lc-baby-del").forEach(btn=>btn.addEventListener("click",function(){
        const parentName=this.dataset.p, idx=parseInt(this.dataset.i);
        if(confirm("Удалить?")) { s.characters[parentName].babies.splice(idx,1); saveSettingsDebounced(); renderBabies(); }
    }));
}

function renderDiceLog(){const s=extension_settings[extensionName],el=document.getElementById("lc-dice-log");if(!el)return;if(s.diceLog.length===0){el.innerHTML='<div class="lc-empty">Пусто</div>';return;}el.innerHTML=[...s.diceLog].reverse().slice(0,20).map(d=>'<div class="lc-dice-entry '+(d.result?'lc-dice-success':'lc-dice-fail')+'">'+d.ts+' 🎲'+d.roll+'/'+d.chance+'% '+(d.result?'✅':'❌')+' '+d.target+(d.auto?' <span class="lc-tag lc-tag-auto">авто</span>':'')+'</div>').join("");}

function renderIntimLog(){const s=extension_settings[extensionName],el=document.getElementById("lc-intim-log-list");if(!el)return;if(s.intimacyLog.length===0){el.innerHTML='<div class="lc-empty">Пусто</div>';return;}el.innerHTML=[...s.intimacyLog].reverse().slice(0,20).map(e=>'<div class="lc-intim-entry">'+e.ts+' '+(e.pa||[]).join('×')+' | '+e.type+' | '+e.ejac+'</div>').join("");}

function renderAU(){const s=extension_settings[extensionName],el=document.getElementById("lc-au-panel");if(!el)return;if(!s.modules.auOverlay||s.auPreset==="realism"){el.innerHTML="";return;}if(s.auPreset==="omegaverse"){const a=s.auSettings.omegaverse;el.innerHTML='<div class="lc-editor-grid"><div class="lc-editor-field"><label>Цикл течки</label><input type="number" id="lc-au-hc" class="lc-input" value="'+a.heatCycleLength+'"></div><div class="lc-editor-field"><label>Длит. течки</label><input type="number" id="lc-au-hd" class="lc-input" value="'+a.heatDuration+'"></div><div class="lc-editor-field"><label>Цикл гона</label><input type="number" id="lc-au-rc" class="lc-input" value="'+a.rutCycleLength+'"></div><div class="lc-editor-field"><label>Длит. гона</label><input type="number" id="lc-au-rd" class="lc-input" value="'+a.rutDuration+'"></div><div class="lc-editor-field"><label>Нед. берем.</label><input type="number" id="lc-au-pw" class="lc-input" value="'+a.pregnancyWeeks+'"></div></div><label class="lc-checkbox"><input type="checkbox" id="lc-au-knot" '+(a.knotEnabled?'checked':'')+'><span>Узел</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-au-bond" '+(a.bondingEnabled?'checked':'')+'><span>Связь</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-au-mpreg" '+(a.maleOmegaPregnancy?'checked':'')+'><span>Мужская берем.</span></label>';setTimeout(()=>{document.getElementById("lc-au-hc")?.addEventListener("change",function(){a.heatCycleLength=parseInt(this.value);saveSettingsDebounced();});document.getElementById("lc-au-hd")?.addEventListener("change",function(){a.heatDuration=parseInt(this.value);saveSettingsDebounced();});document.getElementById("lc-au-rc")?.addEventListener("change",function(){a.rutCycleLength=parseInt(this.value);saveSettingsDebounced();});document.getElementById("lc-au-rd")?.addEventListener("change",function(){a.rutDuration=parseInt(this.value);saveSettingsDebounced();});document.getElementById("lc-au-pw")?.addEventListener("change",function(){a.pregnancyWeeks=parseInt(this.value);saveSettingsDebounced();});document.getElementById("lc-au-knot")?.addEventListener("change",function(){a.knotEnabled=this.checked;saveSettingsDebounced();});document.getElementById("lc-au-bond")?.addEventListener("change",function(){a.bondingEnabled=this.checked;saveSettingsDebounced();});document.getElementById("lc-au-mpreg")?.addEventListener("change",function(){a.maleOmegaPregnancy=this.checked;saveSettingsDebounced();});},50);}}

// ==========================================
// CHAR EDITOR
// ==========================================

let editCh=null;
function openEd(n){const s=extension_settings[extensionName],p=s.characters[n];if(!p)return;editCh=n;document.getElementById("lc-char-editor")?.classList.remove("hidden");document.getElementById("lc-editor-title").textContent="✏️ "+n;document.getElementById("lc-edit-bio-sex").value=p.bioSex;document.getElementById("lc-edit-sec-sex").value=p.secondarySex||"";document.getElementById("lc-edit-race").value=p.race||"human";document.getElementById("lc-edit-contra").value=p.contraception;document.getElementById("lc-edit-eyes").value=p.eyeColor;document.getElementById("lc-edit-hair").value=p.hairColor;document.getElementById("lc-edit-diff").value=p.pregnancyDifficulty;document.getElementById("lc-edit-enabled").checked=p._enabled!==false;document.getElementById("lc-edit-cycle-on").checked=p.cycle?.enabled;document.getElementById("lc-edit-cycle-len").value=p.cycle?.baseLength||28;}
function closeEd(){editCh=null;document.getElementById("lc-char-editor")?.classList.add("hidden");}
function saveEd(){if(!editCh)return;const s=extension_settings[extensionName],p=s.characters[editCh];if(!p)return;p.bioSex=document.getElementById("lc-edit-bio-sex").value;p._mB=true;p.secondarySex=document.getElementById("lc-edit-sec-sex").value||null;p._mS=true;p.race=document.getElementById("lc-edit-race").value;p._mR=true;p.contraception=document.getElementById("lc-edit-contra").value;p.eyeColor=document.getElementById("lc-edit-eyes").value;p._mE=!!p.eyeColor;p.hairColor=document.getElementById("lc-edit-hair").value;p._mH=!!p.hairColor;p.pregnancyDifficulty=document.getElementById("lc-edit-diff").value;p._enabled=document.getElementById("lc-edit-enabled").checked;if(p.cycle){p.cycle.enabled=document.getElementById("lc-edit-cycle-on").checked;const l=parseInt(document.getElementById("lc-edit-cycle-len").value);if(l>=21&&l<=45){p.cycle.baseLength=l;p.cycle.length=l;}}saveSettingsDebounced();closeEd();rebuildUI();toastr.success(editCh+": ОК!");}

// ==========================================
// BIND ALL
// ==========================================

function bindAll(){
    const s=extension_settings[extensionName];
    document.getElementById("lifecycle-header-toggle")?.addEventListener("click",function(e){if(e.target.closest(".lc-switch"))return;s.panelCollapsed=!s.panelCollapsed;document.getElementById("lifecycle-panel")?.classList.toggle("collapsed",s.panelCollapsed);this.querySelector(".lc-collapse-arrow").textContent=s.panelCollapsed?"▶":"▼";saveSettingsDebounced();});
    document.getElementById("lc-enabled")?.addEventListener("change",function(){s.enabled=this.checked;saveSettingsDebounced();});
    document.querySelectorAll(".lifecycle-tab").forEach(t=>t.addEventListener("click",function(){document.querySelectorAll(".lifecycle-tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".lifecycle-tab-content").forEach(x=>x.classList.remove("active"));this.classList.add("active");document.querySelector('.lifecycle-tab-content[data-tab="'+this.dataset.tab+'"]')?.classList.add("active");rebuildUI();}));
    document.getElementById("lc-sync-chars")?.addEventListener("click",()=>{syncChars();rebuildUI();toastr.success("Синхр.!");});
    document.getElementById("lc-add-manual")?.addEventListener("click",()=>{const n=prompt("Имя:");if(!n?.trim())return;if(s.characters[n.trim()])return;s.characters[n.trim()]=makeProfile(n.trim(),false);saveSettingsDebounced();rebuildUI();});
    document.getElementById("lc-reparse")?.addEventListener("click",()=>{syncChars();rebuildUI();toastr.success("Перечитано!");});
    document.getElementById("lc-char-list")?.addEventListener("click",function(e){const eb=e.target.closest(".lc-edit-char"),db=e.target.closest(".lc-del-char");if(eb)openEd(eb.dataset.char);if(db&&confirm("Удалить?")){delete s.characters[db.dataset.char];saveSettingsDebounced();rebuildUI();}});
    document.getElementById("lc-editor-save")?.addEventListener("click",saveEd);
    document.getElementById("lc-editor-cancel")?.addEventListener("click",closeEd);

    // Relationships
    document.getElementById("lc-rel-add")?.addEventListener("click",()=>{const c1=document.getElementById("lc-rel-char1")?.value,c2=document.getElementById("lc-rel-char2")?.value,tp=document.getElementById("lc-rel-type")?.value,nt=document.getElementById("lc-rel-notes")?.value;if(!c1||!c2){toastr.warning("Выберите персонажей!");return;}if(c1===c2){toastr.warning("Нельзя создать связь с собой!");return;}RelationshipManager.add(c1,c2,tp,nt);document.getElementById("lc-rel-notes").value="";renderRels();toastr.success("Связь добавлена!");});

    // Selects
    document.getElementById("lc-cycle-char")?.addEventListener("change",renderCycle);
    document.getElementById("lc-hr-char")?.addEventListener("change",renderHR);
    document.getElementById("lc-preg-char")?.addEventListener("change",renderPreg);
    document.getElementById("lc-labor-char")?.addEventListener("change",renderLabor);
    document.getElementById("lc-baby-parent")?.addEventListener("change",renderBabies);

    // Intimacy
    document.getElementById("lc-intim-log-btn")?.addEventListener("click",()=>{const t=document.getElementById("lc-intim-target")?.value;if(!t)return;IntimacyManager.log({pa:[t,document.getElementById("lc-intim-partner")?.value].filter(Boolean),type:document.getElementById("lc-intim-type")?.value,ejac:document.getElementById("lc-intim-ejac")?.value});renderIntimLog();});
    document.getElementById("lc-intim-roll-btn")?.addEventListener("click",()=>{const t=document.getElementById("lc-intim-target")?.value;if(!t)return;const r=IntimacyManager.roll(t,{pa:[t,document.getElementById("lc-intim-partner")?.value].filter(Boolean),tp:document.getElementById("lc-intim-type")?.value,ej:document.getElementById("lc-intim-ejac")?.value});showDice(r,t,false);renderDiceLog();});

    // Pregnancy
    document.getElementById("lc-preg-advance")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active)return;new PregnancyManager(p).advanceDay(7);saveSettingsDebounced();renderPreg();renderDash();});
    document.getElementById("lc-preg-set")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active)return;const w=prompt("Неделя:");if(w){p.pregnancy.week=clamp(parseInt(w),1,p.pregnancy.maxWeeks);saveSettingsDebounced();renderPreg();}});
    document.getElementById("lc-preg-to-labor")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active)return;new LaborManager(p).start();saveSettingsDebounced();renderLabor();renderDash();});
    document.getElementById("lc-preg-end")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active||!confirm("Прервать?"))return;p.pregnancy.active=false;if(p.cycle)p.cycle.enabled=true;saveSettingsDebounced();renderPreg();renderDash();});

    // Labor — USE BABY FORM instead of prompt()!
    document.getElementById("lc-labor-advance")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-labor-char")?.value];if(!p?.labor?.active)return;new LaborManager(p).advance();saveSettingsDebounced();renderLabor();});
    document.getElementById("lc-labor-deliver")?.addEventListener("click",()=>{
        const charName=document.getElementById("lc-labor-char")?.value;
        const p=s.characters[charName];
        if(!p?.labor?.active)return;
        // OPEN INLINE BABY FORM!
        showBabyForm(charName, p.pregnancy?.father || "?", null, null);
    });
    document.getElementById("lc-labor-end")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-labor-char")?.value];if(!p?.labor?.active||!confirm("Завершить?"))return;new LaborManager(p).end();saveSettingsDebounced();renderLabor();renderDash();});

    // Settings
    const chk={"lc-auto-sync":"autoSyncCharacters","lc-auto-parse":"autoParseCharInfo","lc-parse-chat":"parseFullChat","lc-auto-detect":"autoDetectIntimacy","lc-auto-roll":"autoRollOnSex","lc-show-widget":"showStatusWidget","lc-auto-time":"autoTimeProgress","lc-time-confirm":"timeParserConfirmation"};
    for(const[id,key]of Object.entries(chk))document.getElementById(id)?.addEventListener("change",function(){s[key]=this.checked;saveSettingsDebounced();});
    const mod={"lc-mod-cycle":"cycle","lc-mod-preg":"pregnancy","lc-mod-labor":"labor","lc-mod-baby":"baby","lc-mod-intim":"intimacy"};
    for(const[id,key]of Object.entries(mod))document.getElementById(id)?.addEventListener("change",function(){s.modules[key]=this.checked;saveSettingsDebounced();});
    document.getElementById("lc-mod-au")?.addEventListener("change",function(){s.modules.auOverlay=this.checked;saveSettingsDebounced();renderAU();});
    document.getElementById("lc-prompt-on")?.addEventListener("change",function(){s.promptInjectionEnabled=this.checked;saveSettingsDebounced();});
    document.getElementById("lc-prompt-pos")?.addEventListener("change",function(){s.promptInjectionPosition=this.value;saveSettingsDebounced();});
    document.getElementById("lc-prompt-detail")?.addEventListener("change",function(){s.promptInjectionDetail=this.value;saveSettingsDebounced();});
    document.getElementById("lc-au-preset")?.addEventListener("change",function(){s.auPreset=this.value;saveSettingsDebounced();renderAU();});

    // Date
    document.getElementById("lc-date-apply")?.addEventListener("click",()=>{s.worldDate.year=parseInt(document.getElementById("lc-date-y")?.value)||2025;s.worldDate.month=clamp(parseInt(document.getElementById("lc-date-m")?.value)||1,1,12);s.worldDate.day=clamp(parseInt(document.getElementById("lc-date-d")?.value)||1,1,31);s.worldDate.hour=clamp(parseInt(document.getElementById("lc-date-h")?.value)||12,0,23);s.worldDate.minute=clamp(parseInt(document.getElementById("lc-date-min")?.value)||0,0,59);saveSettingsDebounced();renderDash();});
    document.getElementById("lc-date-plus1")?.addEventListener("click",()=>{EnhancedTimeParser.apply({days:1});rebuildUI();});
    document.getElementById("lc-date-plus7")?.addEventListener("click",()=>{EnhancedTimeParser.apply({days:7});rebuildUI();});
    document.getElementById("lc-date-frozen")?.addEventListener("change",function(){s.worldDate.frozen=this.checked;saveSettingsDebounced();});

    // Export/Import/Reset
    document.getElementById("lc-export")?.addEventListener("click",()=>downloadJSON(s,"lifecycle_"+Date.now()+".json"));
    document.getElementById("lc-import")?.addEventListener("click",()=>uploadJSON(d=>{extension_settings[extensionName]=deepMerge(defaultSettings,d);saveSettingsDebounced();document.getElementById("lifecycle-panel")?.remove();init();}));
    document.getElementById("lc-reset")?.addEventListener("click",()=>{if(!confirm("СБРОС?"))return;extension_settings[extensionName]=JSON.parse(JSON.stringify(defaultSettings));saveSettingsDebounced();document.getElementById("lifecycle-panel")?.remove();init();});
}

// ==========================================
// MESSAGE HOOKS
// ==========================================

function onMsg(idx){
    const s=extension_settings[extensionName];if(!s.enabled)return;
    const ctx=getContext();if(!ctx?.chat||idx<0)return;
    const msg=ctx.chat[idx];if(!msg?.mes||msg.is_user)return;
    const text=msg.mes;

    if(s.autoSyncCharacters)syncChars();

    // Enhanced time parsing
    if(s.autoTimeProgress&&!s.worldDate.frozen){
        const parsed=EnhancedTimeParser.parse(text);
        if(parsed){
            const desc=EnhancedTimeParser.formatDescription(parsed);
            if(s.timeParserConfirmation){
                if(confirm("LifeCycle: "+desc+"\nПрименить?")){EnhancedTimeParser.apply(parsed);rebuildUI();}
            }else{EnhancedTimeParser.apply(parsed);rebuildUI();}
        }
    }

    // Auto-detect intimacy
    if(s.autoDetectIntimacy&&s.modules.intimacy){
        const det=IntimacyDetector.detect(text,s.characters);
        if(det?.detected){
            IntimacyManager.log({pa:det.pa,type:det.tp,ejac:det.ej,auto:true});
            if(s.autoRollOnSex&&det.tg&&det.tp==="vaginal"&&(det.ej==="inside"||det.ej==="unknown")){
                const r=IntimacyManager.roll(det.tg,{pa:det.pa,tp:det.tp,ej:det.ej,co:det.co,nc:det.nc,auto:true});
                showDice(r,det.tg,true);
            }
        }
    }

    if(s.showStatusWidget)StatusWidget.inject(idx);
    renderDash();
}

// ==========================================
// INIT
// ==========================================

async function init(){
    if(!extension_settings[extensionName])extension_settings[extensionName]=JSON.parse(JSON.stringify(defaultSettings));
    else extension_settings[extensionName]=deepMerge(JSON.parse(JSON.stringify(defaultSettings)),extension_settings[extensionName]);
    document.getElementById("lifecycle-panel")?.remove();
    const target=document.getElementById("extensions_settings2")||document.getElementById("extensions_settings");
    if(target)target.insertAdjacentHTML("beforeend",generateHTML());
    syncChars();bindAll();rebuildUI();renderAU();
    if(eventSource){
        eventSource.on(event_types.MESSAGE_RECEIVED,onMsg);
        eventSource.on(event_types.CHAT_CHANGED,()=>{syncChars();rebuildUI();});
        eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS,(d)=>{const s=extension_settings[extensionName];if(!s.enabled||!s.promptInjectionEnabled)return;const inj=PromptInjector.gen();if(!inj)return;if(s.promptInjectionPosition==="system"&&d.systemPrompt!==undefined)d.systemPrompt+="\n\n"+inj;else if(s.promptInjectionPosition==="authornote")d.authorNote=(d.authorNote||"")+"\n\n"+inj;else if(d.chat&&Array.isArray(d.chat))d.chat.push({role:"system",content:inj});});
    }
    console.log("[LifeCycle v0.6.0] Loaded!");
}

jQuery(async()=>{await init();});

window.LifeCycle={getSettings:()=>extension_settings[extensionName],sync:syncChars,advanceTime:d=>{EnhancedTimeParser.apply({days:d});rebuildUI();},rollDice:(c,d)=>IntimacyManager.roll(c,d),addRelationship:(a,b,t,n)=>RelationshipManager.add(a,b,t,n),getRelationships:n=>RelationshipManager.getFor(n)};
