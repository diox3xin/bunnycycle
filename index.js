// ============================================================
// LifeCycle Extension v0.7.0 — index.js
// + Manual cycle day, per-chat profiles, baby creator,
// + pregnancy/labor config, smart male detection, complications
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
    // PER-CHAT PROFILES
    chatProfiles: {},  // { chatId: { characters:{}, relationships:[], worldDate:{}, diceLog:[], intimacyLog:[] } }
    currentChatId: null,
    // Active data (loaded from profile or default)
    characters: {},
    relationships: [],
    diceLog: [], intimacyLog: [],
    // Complications lists
    pregnancyComplications: ["токсикоз","гестационный диабет","преэклампсия","предлежание плаценты","маловодие","многоводие","анемия","угроза преждевременных родов","задержка развития плода"],
    laborComplications: ["слабость родовой деятельности","стремительные роды","обвитие пуповиной","разрывы","кровотечение","дистоция плечиков","гипоксия плода"],
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
// CHAT PROFILE MANAGER — per-chat isolation
// ==========================================

class ChatProfileManager {
    static getCurrentChatId() {
        const ctx = getContext();
        if (!ctx) return null;
        // Group chat
        if (ctx.groupId) return "group_" + ctx.groupId;
        // Solo chat
        if (ctx.characterId !== undefined && ctx.characters) {
            const c = ctx.characters[ctx.characterId];
            if (c) return "char_" + c.avatar + "_" + (ctx.chatId || "default");
        }
        return null;
    }

    static save() {
        const s = extension_settings[extensionName];
        const chatId = this.getCurrentChatId();
        if (!chatId) return;
        s.currentChatId = chatId;
        if (!s.chatProfiles) s.chatProfiles = {};
        s.chatProfiles[chatId] = {
            characters: JSON.parse(JSON.stringify(s.characters)),
            relationships: JSON.parse(JSON.stringify(s.relationships || [])),
            worldDate: { ...s.worldDate },
            diceLog: [...(s.diceLog || [])],
            intimacyLog: [...(s.intimacyLog || [])],
            _savedAt: Date.now(),
        };
        saveSettingsDebounced();
    }

    static load() {
        const s = extension_settings[extensionName];
        const chatId = this.getCurrentChatId();
        if (!chatId) return false;

        if (s.currentChatId !== chatId) {
            // SAVE previous profile first
            if (s.currentChatId && Object.keys(s.characters).length > 0) {
                if (!s.chatProfiles) s.chatProfiles = {};
                s.chatProfiles[s.currentChatId] = {
                    characters: JSON.parse(JSON.stringify(s.characters)),
                    relationships: JSON.parse(JSON.stringify(s.relationships || [])),
                    worldDate: { ...s.worldDate },
                    diceLog: [...(s.diceLog || [])],
                    intimacyLog: [...(s.intimacyLog || [])],
                };
            }

            s.currentChatId = chatId;

            // Load existing profile or start fresh
            if (s.chatProfiles?.[chatId]) {
                const profile = s.chatProfiles[chatId];
                s.characters = JSON.parse(JSON.stringify(profile.characters || {}));
                s.relationships = JSON.parse(JSON.stringify(profile.relationships || []));
                s.worldDate = { ...(profile.worldDate || defaultSettings.worldDate) };
                s.diceLog = [...(profile.diceLog || [])];
                s.intimacyLog = [...(profile.intimacyLog || [])];
                saveSettingsDebounced();
                return true;
            } else {
                // Fresh chat — reset character data
                s.characters = {};
                s.relationships = [];
                s.diceLog = [];
                s.intimacyLog = [];
                saveSettingsDebounced();
                return true;
            }
        }
        return false;
    }

    static listProfiles() {
        const s = extension_settings[extensionName];
        return Object.entries(s.chatProfiles || {}).map(([id, p]) => ({
            id,
            charCount: Object.keys(p.characters || {}).length,
            date: p.worldDate ? fmt(p.worldDate) : "—",
            savedAt: p._savedAt ? new Date(p._savedAt).toLocaleString() : "—",
        }));
    }

    static deleteProfile(chatId) {
        const s = extension_settings[extensionName];
        if (s.chatProfiles?.[chatId]) {
            delete s.chatProfiles[chatId];
            saveSettingsDebounced();
        }
    }
}

// ==========================================
// RELATIONSHIP MANAGER
// ==========================================

const REL_TYPES = ["мать","отец","ребёнок","партнёр","супруг(а)","брат","сестра","сводный брат","сводная сестра","дедушка","бабушка","внук","внучка","дядя","тётя","племянник","племянница","друг","возлюбленный(ая)","бывший(ая)","опекун","подопечный","другое"];

class RelationshipManager {
    static get(){return extension_settings[extensionName].relationships||[];}
    static add(c1,c2,type,notes){const s=extension_settings[extensionName];if(!s.relationships)s.relationships=[];if(s.relationships.find(r=>r.char1===c1&&r.char2===c2&&r.type===type))return;s.relationships.push({id:uid(),char1:c1,char2:c2,type,notes:notes||"",created:fmt(s.worldDate)});saveSettingsDebounced();}
    static remove(id){const s=extension_settings[extensionName];s.relationships=(s.relationships||[]).filter(r=>r.id!==id);saveSettingsDebounced();}
    static getFor(n){return(extension_settings[extensionName].relationships||[]).filter(r=>r.char1===n||r.char2===n);}
    static getReciprocalType(t){const m={"мать":"ребёнок","отец":"ребёнок","ребёнок":"мать","партнёр":"партнёр","супруг(а)":"супруг(а)","брат":"брат","сестра":"сестра"};return m[t]||t;}
    static addBirthRelationships(mother,father,baby){if(mother){this.add(mother,baby,"мать","");this.add(baby,mother,"ребёнок","");}if(father&&father!=="?"){this.add(father,baby,"отец","");this.add(baby,father,"ребёнок","");}const s=extension_settings[extensionName];if(mother&&s.characters[mother]?.babies){for(const sib of s.characters[mother].babies){if(sib.name&&sib.name!==baby){this.add(baby,sib.name,"брат/сестра","");this.add(sib.name,baby,"брат/сестра","");}}}}
    static toPromptText(){const r=this.get();if(r.length===0)return"";return"Relationships:\n"+r.map(x=>x.char1+" → "+x.char2+": "+x.type+(x.notes?" ("+x.notes+")":"")).join("\n");}
}

// ==========================================
// ENHANCED CHAR INFO PARSER — improved accuracy
// ==========================================

class CharInfoParser {
    static SEX_F = [
        /\b(?:female|woman|girl)\b/i,
        /\b(?:she|her|hers)\b/i,
        /\b(?:девушка|женщина|девочка)\b/i,
        /\b(?:она|её|ей|ней)\b/i,
        /\bshe\/her\b/i,
        /\b(?:фем(?:ейл)?|самка)\b/i,
        /(?:пол|sex|gender)\s*[:=\-]\s*(?:f|ж|female|женский)/i,
    ];
    static SEX_M = [
        /\b(?:male|man|boy)\b/i,
        /\b(?:he|him|his)\b/i,
        /\b(?:мужчина|парень|мальчик)\b/i,
        /\b(?:он|его|ему|нему)\b/i,
        /\bhe\/him\b/i,
        /\b(?:маск|самец)\b/i,
        /(?:пол|sex|gender)\s*[:=\-]\s*(?:m|м|male|мужской)/i,
    ];
    static SEC = { alpha:/\b(alpha|альфа)\b/i, beta:/\b(beta|бета)\b/i, omega:/\b(omega|омега)\b/i };
    static RACE = { human:/\b(human|человек)\b/i, elf:/\b(elf|эльф)\b/i, dwarf:/\b(dwarf|дварф|гном)\b/i, orc:/\b(orc|орк)\b/i, demon:/\b(demon|демон)\b/i, vampire:/\b(vampire|вампир)\b/i, neko:/\b(neko|неко)\b/i, kitsune:/\b(kitsune|кицунэ)\b/i };
    static EYE = /\b(голуб\S*|сер\S*|зелен\S*|кар\S*|чёрн\S*|янтарн\S*|золот\S*|фиолетов\S*|красн\S*|blue|green|brown|hazel|grey|amber|gold|red|violet)\s*(?:eye|eyes|глаз)/i;
    static HAIR = /\b(блонд\S*|русы\S*|рыж\S*|чёрн\S*|бел\S*|серебрист\S*|розов\S*|каштанов\S*|платинов\S*|blonde?|brunette?|black|white|silver|pink)\s*(?:hair|волос)/i;

    static parse(charObj) {
        if (!charObj) return {};
        const texts = [charObj.description, charObj.personality, charObj.scenario, charObj.first_mes, charObj.data?.description, charObj.data?.personality, charObj.data?.extensions?.depth_prompt?.prompt].filter(Boolean);
        const t = texts.join("\n");
        const info = {};

        // IMPROVED sex detection: count weighted matches
        let fScore = 0, mScore = 0;
        // Direct sex declarations have highest weight
        if (/(?:пол|sex|gender)\s*[:=\-]\s*(?:f|ж|female|женский)/i.test(t)) fScore += 50;
        if (/(?:пол|sex|gender)\s*[:=\-]\s*(?:m|м|male|мужской)/i.test(t)) mScore += 50;
        // Explicit labels
        if (/\b(?:female|woman|girl|девушка|женщина)\b/i.test(t)) fScore += 10;
        if (/\b(?:male|man|boy|мужчина|парень)\b/i.test(t)) mScore += 10;
        // she/her vs he/him in DESCRIPTION (not dialogue)
        const descOnly = (charObj.description || "") + "\n" + (charObj.data?.description || "");
        const sheCount = (descOnly.match(/\b(she|her|она|её|ей)\b/gi) || []).length;
        const heCount = (descOnly.match(/\b(he|him|его|ему|он)\b/gi) || []).length;
        fScore += sheCount * 2;
        mScore += heCount * 2;

        if (fScore > mScore && fScore >= 4) info.bioSex = "F";
        else if (mScore > fScore && mScore >= 4) info.bioSex = "M";

        for (const [s, p] of Object.entries(this.SEC)) if (p.test(t)) { info.secondarySex = s; break; }
        for (const [r, p] of Object.entries(this.RACE)) if (p.test(t)) { info.race = r; break; }
        let m = t.match(this.EYE); if (m) info.eyeColor = m[1].trim();
        m = t.match(this.HAIR); if (m) info.hairColor = m[1].trim();
        return info;
    }
}

// ==========================================
// IMPROVED CHAT HISTORY PARSER
// ==========================================

class ChatHistoryParser {
    static CHILD_PATS = [
        /(?:родил[аи]?\s*(?:здоров\w+\s*)?(?:мальчик\w*|девочк\w*|сын\w*|дочь?\w*|boy|girl)?\s*(?:,?\s*)?(?:по\s*имени|которо\w+\s*назвал\w*|и\s*назвал\w*|named?)\s*["«]?([А-ЯЁA-Z][\wа-яёА-ЯЁ]{1,19})["»]?)/gi,
        /(?:малыш|ребён\w+|baby|child|infant|новорождённ\w*)\s+(?:по\s*имени|named?)\s*["«]?([А-ЯЁA-Z][\wа-яёА-ЯЁ]{1,19})["»]?/gi,
        /(?:их|наш[аеу]?|her|his|their)\s+(?:сын\w*|дочь?\w*|дочер\w*|son|daughter)\s+["«]?([А-ЯЁA-Z][\wа-яёА-ЯЁ]{1,19})["»]?/gi,
        /(?:назвал[аи]?\s*(?:его|её|ребёнка|малыша|малышку)?)\s*["«]([А-ЯЁA-Z][\wа-яёА-ЯЁ]{1,19})["»]/gi,
    ];
    static CHILD_SEX = { M:/(?:мальчик|сын|boy|son|he\b|его\b)/i, F:/(?:девочк|дочь|дочер|girl|daughter|she\b|её\b)/i };
    static PREG = [/(?:беременн|pregnant|ожида\w+\s*ребёнк|expecting|забеременел|зачал)/i, /(?:тест.*(?:положительн|две\s*полоск)|pregnancy\s*test\s*positive)/i, /(\d{1,2})\s*(?:недел[ьяию]|week)\s*(?:беременност|pregnan)/i];
    static SEC = { alpha:/\b(альфа|alpha)\b/i, beta:/\b(бета|beta)\b/i, omega:/\b(омега|omega)\b/i };
    static HEAT = [/(?:течк[аеуи]|heat|in\s*heat|estrus)/i, /(?:начал(?:ась|ся)\s*течка)/i, /(?:слик|slick|самосмазк)/i];
    static RUT = [/(?:гон[а-яё]*|rut(?:ting)?|in\s*rut)/i];

    // Improved: also detect character sex from context more carefully
    static EXPLICIT_SEX = {
        F: [/(?:она|she)\s+(?:была|is|was|стала|became)/i, /(?:у\s+(?:неё|нее))\b/i, /(?:её|her)\s+(?:грудь|живот|матк|лон|тело|body|breast|womb)/i],
        M: [/(?:он|he)\s+(?:был|is|was|стал|became)/i, /(?:у\s+него)\b/i, /(?:его|his)\s+(?:член|cock|dick|тело|body)/i],
    };

    static parseFullChat(msgs, chars) {
        if (!msgs?.length) return {};
        const res = {}, names = Object.keys(chars);
        const full = msgs.map(m => m.mes || "").join("\n");

        for (const name of names) {
            const info = {};
            const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Get text near this character's name
            const nameRe = new RegExp('(?:.{0,150})' + escapedName + '(?:.{0,150})', 'gi');
            const nearMatches = [];
            let nm;
            while ((nm = nameRe.exec(full)) !== null) nearMatches.push(nm[0]);
            const nearText = nearMatches.join("\n");

            // Secondary sex near name
            for (const [s, p] of Object.entries(this.SEC)) {
                const r1 = new RegExp(escapedName + "[\\s\\-]*" + p.source, "i");
                const r2 = new RegExp(p.source + "[\\s\\-]*" + escapedName, "i");
                if (r1.test(full) || r2.test(full)) { info.secondarySex = s; break; }
                // Also check near text
                if (p.test(nearText)) { info.secondarySex = s; break; }
            }

            // Bio sex from context near name — improved
            let fScore = 0, mScore = 0;
            for (const p of this.EXPLICIT_SEX.F) { const matches = nearText.match(new RegExp(p.source, "gi")); if (matches) fScore += matches.length * 3; }
            for (const p of this.EXPLICIT_SEX.M) { const matches = nearText.match(new RegExp(p.source, "gi")); if (matches) mScore += matches.length * 3; }
            // Simple pronouns
            const fPron = (nearText.match(/\b(она|её|ей|she|her)\b/gi) || []).length;
            const mPron = (nearText.match(/\b(он|его|ему|he|him)\b/gi) || []).length;
            fScore += fPron;
            mScore += mPron;
            if (fScore > mScore * 1.5 && fScore >= 3) info.bioSex = "F";
            else if (mScore > fScore * 1.5 && mScore >= 3) info.bioSex = "M";

            // Pregnancy
            for (const p of this.PREG) { if (p.test(nearText)) { info.isPregnant = true; const wm = nearText.match(/(\d{1,2})\s*(?:недел|week)/i); if (wm) info.pregWeek = parseInt(wm[1]); break; } }
            // Heat/Rut
            for (const p of this.HEAT) { if (p.test(nearText)) { info.inHeat = true; break; } }
            for (const p of this.RUT) { if (p.test(nearText)) { info.inRut = true; break; } }

            // Children
            info.children = [];
            for (const pat of this.CHILD_PATS) {
                let m; const re = new RegExp(pat.source, pat.flags);
                while ((m = re.exec(full)) !== null) {
                    const cn = m[1]?.trim();
                    if (cn?.length >= 2 && cn.length <= 20 && !names.includes(cn) && !info.children.find(c => c.name === cn)) {
                        const sur = full.substring(Math.max(0, m.index - 150), Math.min(full.length, m.index + m[0].length + 150));
                        let cs = null; if (this.CHILD_SEX.M.test(sur)) cs = "M"; else if (this.CHILD_SEX.F.test(sur)) cs = "F";
                        info.children.push({ name: cn, sex: cs });
                    }
                }
            }

            if (Object.keys(info).length > 0) res[name] = info;
        }
        return res;
    }
}

// ==========================================
// INTIMACY DETECTOR (same as v0.6.0)
// ==========================================

class IntimacyDetector {
    static SRU=[/вошё?л\s*(в\s*неё|внутрь)/i,/проник/i,/трахал|ебал|ебёт|выебал/i,/кончил\s*(внутрь|в\s*неё|наружу|на)/i,/член\s*(?:вошёл|внутри)/i,/фрикци/i,/без\s*(?:презерватива|защиты)/i,/наполнил/i,/узел\s*(?:набух|внутри|застрял)/i];
    static SEN=[/(?:thrust|pushed|slid)\s*inside/i,/penetrat/i,/fuck(?:ed|ing)/i,/cum(?:ming|med)?\s*inside/i,/raw|bareback|without\s*condom/i,/creampie/i,/knot.*(?:inside|stuck)/i];
    static CON=[/презерватив|кондом/i,/condom/i]; static NCO=[/без\s*(?:презерватива|защиты)/i,/raw|bareback/i];
    static EIN=[/кончил\s*(?:внутрь|в\s*неё|глубоко)/i,/наполнил/i,/cum.*inside/i,/creampie/i,/узел.*внутри/i];
    static EOU=[/кончил\s*(?:наружу|на\s*живот)/i,/pull.*out/i];
    static ANL=[/анал/i,/в\s*(?:задн|попу|анус)/i,/anal/i]; static ORL=[/минет|отсос/i,/blowjob|oral/i];
    static detect(t,ch){if(!t)return null;let sc=0;for(const p of[...this.SRU,...this.SEN])if(p.test(t))sc++;if(sc<2)return null;let tp="vaginal";for(const p of this.ANL)if(p.test(t)){tp="anal";break;}for(const p of this.ORL)if(p.test(t)){tp="oral";break;}let co=false,nc=false;for(const p of this.CON)if(p.test(t)){co=true;break;}for(const p of this.NCO)if(p.test(t)){nc=true;break;}let ej="unknown";for(const p of this.EIN)if(p.test(t)){ej="inside";break;}if(ej==="unknown")for(const p of this.EOU)if(p.test(t)){ej="outside";break;}const pa=[],nm=Object.keys(ch);for(const n of nm)if(t.toLowerCase().includes(n.toLowerCase())||ch[n]._isUser)pa.push(n);if(pa.length<2&&nm.length>=2)for(const n of nm){if(!pa.includes(n))pa.push(n);if(pa.length>=2)break;}let tg=null;const s=extension_settings[extensionName];for(const n of pa){const p=ch[n];if(!p)continue;if(p.bioSex==="F"){tg=n;break;}if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.secondarySex==="omega"&&s.auSettings.omegaverse.maleOmegaPregnancy){tg=n;break;}}return{detected:true,sc,tp,co:co&&!nc,nc,ej,pa,tg};}
}

// ==========================================
// CHARACTER SYNC — FIXED: males don't get cycle by default
// ==========================================

function getActiveChars(){const c=getContext(),r=[];if(!c)return r;if(c.characterId!==undefined&&c.characters){const x=c.characters[c.characterId];if(x)r.push({name:x.name,obj:x,isUser:false});}if(c.groups&&c.groupId){const g=c.groups.find(x=>x.id===c.groupId);if(g?.members)for(const av of g.members){const x=c.characters.find(y=>y.avatar===av);if(x&&!r.find(y=>y.name===x.name))r.push({name:x.name,obj:x,isUser:false});}}if(c.name1)r.push({name:c.name1,obj:null,isUser:true});return r;}

function syncChars(){
    const s=extension_settings[extensionName];if(!s.autoSyncCharacters)return;const a=getActiveChars();let ch=false;
    for(const c of a){
        if(!s.characters[c.name]){
            // Parse sex BEFORE creating profile so we know if male
            let detectedSex = "F"; // default
            if(c.obj && s.autoParseCharInfo){
                const parsed = CharInfoParser.parse(c.obj);
                if(parsed.bioSex) detectedSex = parsed.bioSex;
            }
            s.characters[c.name]=makeProfile(c.name,c.isUser,detectedSex);
            ch=true;
        }
        if(s.autoParseCharInfo&&c.obj&&!c.isUser){
            const p=CharInfoParser.parse(c.obj),pr=s.characters[c.name];
            if(p.bioSex&&!pr._mB){pr.bioSex=p.bioSex;
                // FIX: Disable cycle for males unless omega
                if(p.bioSex==="M"&&!pr._mCyc){pr.cycle.enabled=false;}
                ch=true;}
            if(p.secondarySex&&!pr._mS){pr.secondarySex=p.secondarySex;
                // Enable cycle for omega males
                if(p.secondarySex==="omega"&&pr.bioSex==="M"){pr.cycle.enabled=true;}
                ch=true;}
            if(p.race&&!pr._mR){pr.race=p.race;ch=true;}
            if(p.eyeColor&&!pr._mE){pr.eyeColor=p.eyeColor;ch=true;}
            if(p.hairColor&&!pr._mH){pr.hairColor=p.hairColor;ch=true;}
        }
    }
    if(s.parseFullChat){const ctx=getContext();if(ctx?.chat?.length>0){const cd=ChatHistoryParser.parseFullChat(ctx.chat,s.characters);for(const[n,i]of Object.entries(cd)){const p=s.characters[n];if(!p)continue;if(i.secondarySex&&!p._mS){p.secondarySex=i.secondarySex;ch=true;}if(i.bioSex&&!p._mB){p.bioSex=i.bioSex;if(i.bioSex==="M"&&!p._mCyc)p.cycle.enabled=false;ch=true;}if(i.isPregnant&&!p.pregnancy?.active&&!p._mP){p.pregnancy.active=true;p.pregnancy.week=i.pregWeek||4;if(p.cycle)p.cycle.enabled=false;ch=true;}if(i.inHeat&&p.secondarySex==="omega"&&!p.heat?.active){p.heat.active=true;p.heat.currentDay=1;ch=true;}if(i.inRut&&p.secondarySex==="alpha"&&!p.rut?.active){p.rut.active=true;p.rut.currentDay=1;ch=true;}if(i.children?.length>0)for(const c of i.children)if(!p.babies.find(b=>b.name===c.name)){p.babies.push({name:c.name,sex:c.sex||(Math.random()<0.5?"M":"F"),secondarySex:null,birthWeight:3200,currentWeight:5000,ageDays:30,eyeColor:p.eyeColor||"",hairColor:p.hairColor||"",mother:p.bioSex==="F"?n:"?",father:p.bioSex==="M"?n:"?",nonHumanFeatures:[],state:"младенец",birthDate:{...s.worldDate}});ch=true;RelationshipManager.addBirthRelationships(p.bioSex==="F"?n:null,p.bioSex==="M"?n:null,c.name);}}}}
    if(ch){saveSettingsDebounced();ChatProfileManager.save();}
}

// FIXED: makeProfile accepts detectedSex — males get cycle disabled
function makeProfile(n, u, detectedSex) {
    const isMale = (detectedSex || "F") === "M";
    return {
        name:n, bioSex: detectedSex || "F", secondarySex:null, race:"human",
        contraception:"none", eyeColor:"", hairColor:"", pregnancyDifficulty:"normal",
        _isUser:u, _enabled:true,
        _mB:false, _mS:false, _mR:false, _mE:false, _mH:false, _mP:false, _mCyc:false,
        cycle:{
            enabled: !isMale, // DISABLED for males by default
            currentDay: Math.floor(Math.random()*28)+1,
            baseLength:28, length:28, menstruationDuration:5,
            irregularity:2, symptomIntensity:"moderate", cycleCount:0,
        },
        pregnancy:{ active:false, week:0, day:0, maxWeeks:40, father:null, fetusCount:1, fetusSexes:[], complications:[], complicationsEnabled:true, weightGain:0 },
        labor:{ active:false, stage:"latent", dilation:0, contractionInterval:0, contractionDuration:0, hoursElapsed:0, babiesDelivered:0, totalBabies:1, difficulty:"normal", complications:[], complicationsEnabled:true },
        heat:{ active:false, currentDay:0, cycleDays:30, duration:5, intensity:"moderate", daysSinceLast:Math.floor(Math.random()*25), onSuppressants:false, phase:"rest" },
        rut:{ active:false, currentDay:0, cycleDays:35, duration:4, intensity:"moderate", daysSinceLast:Math.floor(Math.random()*30), phase:"rest" },
        babies:[],
    };
}

// ==========================================
// CYCLE MANAGER — with MANUAL DAY SETTING
// ==========================================

class CycleManager {
    constructor(p){this.p=p;this.c=p.cycle;}
    phase(){if(!this.c?.enabled)return"unknown";const d=this.c.currentDay,l=this.c.length,m=this.c.menstruationDuration,o=Math.round(l-14);if(d<=m)return"menstruation";if(d<o-2)return"follicular";if(d<=o+1)return"ovulation";return"luteal";}
    label(p){return{menstruation:"Менструация",follicular:"Фолликулярная",ovulation:"Овуляция",luteal:"Лютеиновая",unknown:"—"}[p]||p;}
    emoji(p){return{menstruation:"🔴",follicular:"🌸",ovulation:"🥚",luteal:"🌙",unknown:"❓"}[p]||"❓";}
    fertility(){const b={ovulation:0.25,follicular:0.08,luteal:0.02,menstruation:0.01,unknown:0.05}[this.phase()]||0.05;const s=extension_settings[extensionName];let bo=0;if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&this.p.heat?.active)bo=s.auSettings.omegaverse.heatFertilityBonus;return Math.min(b+bo,0.95);}
    libido(){if(this.p.heat?.active||this.p.rut?.active)return"экстремальное";return{ovulation:"высокое",follicular:"среднее",luteal:"низкое",menstruation:"низкое"}[this.phase()]||"среднее";}
    symptoms(){const p=this.phase(),i=this.c.symptomIntensity,r=[];if(p==="menstruation"){r.push("кровотечение");if(i!=="mild")r.push("спазмы");}if(p==="ovulation")r.push("↑ либидо");if(p==="luteal")r.push("ПМС");if(p==="follicular")r.push("энергия");return r;}
    discharge(){return{menstruation:"менструальные",follicular:"скудные",ovulation:"обильные",luteal:"густые"}[this.phase()]||"обычные";}
    advance(d){for(let i=0;i<d;i++){this.c.currentDay++;if(this.c.currentDay>this.c.length){this.c.currentDay=1;this.c.cycleCount++;if(this.c.irregularity>0)this.c.length=clamp(this.c.baseLength+Math.floor(Math.random()*this.c.irregularity*2)-this.c.irregularity,21,45);}}}
    // NEW: Set specific day
    setDay(day) { this.c.currentDay = clamp(day, 1, this.c.length); }
    // NEW: Set to specific phase
    setToPhase(phase) {
        const ov = Math.round(this.c.length - 14);
        switch(phase) {
            case "menstruation": this.c.currentDay = 1; break;
            case "follicular": this.c.currentDay = this.c.menstruationDuration + 1; break;
            case "ovulation": this.c.currentDay = ov; break;
            case "luteal": this.c.currentDay = ov + 2; break;
        }
    }
}

// ==========================================
// HEAT/RUT MANAGER (same as v0.6.0)
// ==========================================

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
    advanceRut(d){const r=this.p.rut;if(!r)return;const a=extension_settings[extensionName].auSettings?.omegaverse;r.cycleDays=a?.rutCycleLength||35;r.duration=a?.rutDuration||4;for(let i=0;i<d;i++){if(r.active){r.currentDay++;if(r.currentDay>r.duration){r.active=false;r.currentDay=0;r.daysSinceLast=0;}}else{r.daysSinceLast=(r.daysSinceLast||0)+1;if(r.daysSinceLast>=r.cycleDays){r.active=true;r.currentDay=1;r.intensity="moderate";}}}}
}

// ==========================================
// PREGNANCY MANAGER — with complications + fetus config
// ==========================================

class PregnancyManager {
    constructor(p){this.p=p;this.pr=p.pregnancy;}
    active(){return this.pr?.active;}
    start(f,count,sexes){
        const s=extension_settings[extensionName];
        this.pr.active=true;this.pr.week=1;this.pr.day=0;this.pr.father=f;
        this.pr.fetusCount=count||1;
        this.pr.fetusSexes=sexes||[];
        // Fill missing sexes
        while(this.pr.fetusSexes.length<this.pr.fetusCount){this.pr.fetusSexes.push(Math.random()<0.5?"M":"F");}
        this.pr.weightGain=0;this.pr.complications=[];
        let m=40;if(s.modules.auOverlay&&s.auPreset==="omegaverse")m=s.auSettings.omegaverse.pregnancyWeeks||36;else if(s.modules.auOverlay&&s.auPreset==="fantasy"&&this.p.race)m=s.auSettings.fantasy.pregnancyByRace[this.p.race]||40;if(count>1)m=Math.max(28,m-(count-1)*3);this.pr.maxWeeks=m;if(this.p.cycle)this.p.cycle.enabled=false;
    }
    advanceDay(d){
        if(!this.active())return;this.pr.day+=d;while(this.pr.day>=7){this.pr.day-=7;this.pr.week++;}this.pr.weightGain=this.wg();
        // Random complications
        if(this.pr.complicationsEnabled && this.pr.week > 8 && Math.random() < 0.02) {
            const s = extension_settings[extensionName];
            const pool = s.pregnancyComplications || [];
            if(pool.length > 0 && this.pr.complications.length < 3) {
                const comp = pool[Math.floor(Math.random() * pool.length)];
                if(!this.pr.complications.includes(comp)) this.pr.complications.push(comp);
            }
        }
    }
    tri(){return this.pr.week<=12?1:this.pr.week<=27?2:3;}
    size(){const sz=[[4,"маковое зерно"],[8,"малина"],[12,"лайм"],[16,"авокадо"],[20,"банан"],[28,"баклажан"],[36,"дыня"],[40,"арбуз"]];let r="эмбрион";for(const[w,n]of sz)if(this.pr.week>=w)r=n;return r;}
    symptoms(){const w=this.pr.week,r=[];if(w>=4&&w<=14)r.push("тошнота","усталость");if(w>=14&&w<=27){r.push("рост живота");if(w>=18)r.push("шевеления");}if(w>=28){r.push("одышка","отёки");if(w>=32)r.push("тренировочные схватки");}if(this.pr.fetusCount>1)r.push("многоплодная");return r;}
    moves(){const w=this.pr.week;if(w<16)return"нет";if(w<22)return"бабочки";if(w<28)return"толчки";return"активные";}
    wg(){const w=this.pr.week;let b;if(w<=12)b=w*0.2;else if(w<=27)b=2.4+(w-12)*0.45;else b=9.15+(w-27)*0.4;return Math.round(b*(1+(this.pr.fetusCount-1)*0.3)*10)/10;}
    body(){const w=this.pr.week,r=[];if(w>=6)r.push("грудь↑");if(w>=12)r.push("живот");if(w>=24)r.push("растяжки");return r;}
    emo(){return{1:"тревога",2:"привязанность",3:"гнездование"}[this.tri()]||"";}
    addComplication(comp){if(!this.pr.complications.includes(comp))this.pr.complications.push(comp);}
    removeComplication(comp){this.pr.complications=this.pr.complications.filter(c=>c!==comp);}
    clearComplications(){this.pr.complications=[];}
}

// ==========================================
// LABOR MANAGER — with difficulty + complications
// ==========================================

const LS=["latent","active","transition","pushing","birth","placenta"];
const LL={latent:"Латентная",active:"Активная",transition:"Переходная",pushing:"Потуги",birth:"Рождение",placenta:"Плацента"};
const LABOR_DIFFICULTY={easy:{speedMult:0.7,compChance:0.02},normal:{speedMult:1,compChance:0.05},hard:{speedMult:1.5,compChance:0.1},extreme:{speedMult:2,compChance:0.2}};

class LaborManager {
    constructor(p){this.p=p;this.l=p.labor;}
    start(difficulty){
        this.l.active=true;this.l.stage="latent";this.l.dilation=0;this.l.contractionInterval=20;this.l.contractionDuration=30;
        this.l.hoursElapsed=0;this.l.babiesDelivered=0;this.l.totalBabies=this.p.pregnancy?.fetusCount||1;
        this.l.difficulty=difficulty||"normal";this.l.complications=[];
    }
    advance(){
        const i=LS.indexOf(this.l.stage);if(i>=LS.length-1)return;
        this.l.stage=LS[i+1];
        const diff=LABOR_DIFFICULTY[this.l.difficulty]||LABOR_DIFFICULTY.normal;
        if(this.l.stage==="active"){this.l.dilation=5;this.l.contractionInterval=5;this.l.contractionDuration=50;this.l.hoursElapsed+=Math.round((4+Math.floor(Math.random()*6))*diff.speedMult);}
        if(this.l.stage==="transition"){this.l.dilation=8;this.l.contractionInterval=2;this.l.contractionDuration=70;this.l.hoursElapsed+=Math.round((2+Math.floor(Math.random()*3))*diff.speedMult);}
        if(this.l.stage==="pushing"){this.l.dilation=10;this.l.hoursElapsed+=Math.round(1*diff.speedMult);}
        if(this.l.stage==="birth")this.l.hoursElapsed+=0.5;
        if(this.l.stage==="placenta")this.l.hoursElapsed+=0.25;
        // Random complications
        if(this.l.complicationsEnabled && Math.random() < diff.compChance) {
            const s=extension_settings[extensionName];
            const pool=s.laborComplications||[];
            if(pool.length>0&&this.l.complications.length<3){
                const comp=pool[Math.floor(Math.random()*pool.length)];
                if(!this.l.complications.includes(comp))this.l.complications.push(comp);
            }
        }
    }
    desc(){return{latent:"Лёгкие схватки, 0-3 см",active:"Сильные схватки, 4-7 см",transition:"Пиковые схватки, 7-10 см",pushing:"Потуги",birth:"Рождение",placenta:"Плацента"}[this.l.stage]||"";}
    deliver(){this.l.babiesDelivered++;if(this.l.babiesDelivered>=this.l.totalBabies)this.l.stage="placenta";}
    end(){this.l.active=false;this.p.pregnancy.active=false;if(this.p.cycle){this.p.cycle.enabled=true;this.p.cycle.currentDay=1;}}
    addComplication(c){if(!this.l.complications.includes(c))this.l.complications.push(c);}
    removeComplication(c){this.l.complications=this.l.complications.filter(x=>x!==c);}
    clearComplications(){this.l.complications=[];}
}

// ==========================================
// BABY MANAGER — with standalone baby creator
// ==========================================

class BabyManager {
    constructor(b){this.b=b;}
    static gen(mother,father,overrides){
        const s=extension_settings[extensionName],fp=s.characters[father];
        const sex=overrides?.sex||(Math.random()<0.5?"M":"F");
        let sec=overrides?.secondarySex||null;
        if(!sec&&s.modules.auOverlay&&s.auPreset==="omegaverse"){const r=Math.random();sec=r<0.25?"alpha":r<0.75?"beta":"omega";}
        const nf=[];if(s.modules.auOverlay&&s.auPreset==="fantasy"&&s.auSettings.fantasy.nonHumanFeatures){if(Math.random()<0.3)nf.push("заострённые уши");}
        const bw=3200+Math.floor(Math.random()*800)-400;
        return{name:overrides?.name||"",sex,secondarySex:sec,birthWeight:mother?.pregnancy?.fetusCount>1?Math.round(bw*0.85):bw,currentWeight:bw,ageDays:overrides?.ageDays||0,eyeColor:overrides?.eyeColor||(Math.random()<0.5?(mother?.eyeColor||""):(fp?.eyeColor||"")),hairColor:overrides?.hairColor||(Math.random()<0.5?(mother?.hairColor||""):(fp?.hairColor||"")),mother:mother?.name||overrides?.mother||"?",father:father||overrides?.father||"?",nonHumanFeatures:nf,state:"новорождённый",birthDate:{...s.worldDate}};
    }
    // Create standalone baby (not from birth)
    static createStandalone(data) {
        const s = extension_settings[extensionName];
        const baby = {
            name: data.name || "Малыш",
            sex: data.sex || "F",
            secondarySex: data.secondarySex || null,
            birthWeight: data.birthWeight || 3200,
            currentWeight: data.birthWeight || 3200,
            ageDays: data.ageDays || 0,
            eyeColor: data.eyeColor || "",
            hairColor: data.hairColor || "",
            mother: data.mother || "?",
            father: data.father || "?",
            nonHumanFeatures: [],
            state: "новорождённый",
            birthDate: { ...s.worldDate },
        };
        new BabyManager(baby).update();
        return baby;
    }
    age(){const d=this.b.ageDays;if(d<1)return"новорождённый";if(d<7)return d+" дн.";if(d<30)return Math.floor(d/7)+" нед.";if(d<365)return Math.floor(d/30)+" мес.";const y=Math.floor(d/365),m=Math.floor((d%365)/30);return m>0?y+" г. "+m+" мес.":y+" г.";}
    milestones(){const d=this.b.ageDays,r=[];if(d>=42)r.push("улыбка");if(d>=90)r.push("голову");if(d>=180)r.push("сидит");if(d>=240)r.push("ползает");if(d>=365)r.push("ходит");if(d>=730)r.push("бегает");return r;}
    update(){this.b.currentWeight=this.b.birthWeight+this.b.ageDays*(this.b.ageDays<120?30:this.b.ageDays<365?15:7);if(this.b.ageDays<28)this.b.state="новорождённый";else if(this.b.ageDays<365)this.b.state="младенец";else if(this.b.ageDays<1095)this.b.state="малыш";else this.b.state="ребёнок";}
}

// ==========================================
// INTIMACY + DICE + TIME PARSER + PROMPT INJECTOR
// (same as v0.6.0 compact)
// ==========================================

class IntimacyManager {
    static log(e){const s=extension_settings[extensionName];e.ts=fmt(s.worldDate);s.intimacyLog.push(e);if(s.intimacyLog.length>100)s.intimacyLog=s.intimacyLog.slice(-100);saveSettingsDebounced();}
    static roll(tg,d){const s=extension_settings[extensionName],p=s.characters[tg];if(!p)return{result:false,chance:0,roll:0};let f=0.05;if(p.cycle?.enabled)f=new CycleManager(p).fertility();const ce={none:0,condom:0.85,pill:0.91,iud:0.99,withdrawal:0.73}[p.contraception]||0;if(d.nc){}else if(d.co)f*=0.15;else f*=(1-ce);if(d.ej==="outside")f*=0.05;if(d.tp==="anal"||d.tp==="oral")f=0;if(p.pregnancy?.active)f=0;if(p.bioSex==="M"&&!(s.modules.auOverlay&&s.auPreset==="omegaverse"&&s.auSettings.omegaverse.maleOmegaPregnancy&&p.secondarySex==="omega"))f=0;const ch=Math.round(clamp(f,0,0.95)*100),r=dice(100),res=r<=ch;const entry={ts:fmt(s.worldDate),target:tg,pa:d.pa||[],chance:ch,roll:r,result:res,contra:d.nc?"нет":(d.co?"да":p.contraception),type:d.tp,ejac:d.ej,auto:d.auto||false};s.diceLog.push(entry);if(s.diceLog.length>50)s.diceLog=s.diceLog.slice(-50);saveSettingsDebounced();return entry;}
}

class EnhancedTimeParser {
    static MONTHS_RU={"январ":1,"феврал":2,"март":3,"апрел":4,"ма[йя]":5,"июн":6,"июл":7,"август":8,"сентябр":9,"октябр":10,"ноябр":11,"декабр":12};
    static MONTHS_EN={"january":1,"february":2,"march":3,"april":4,"may":5,"june":6,"july":7,"august":8,"september":9,"october":10,"november":11,"december":12};
    static TOD={"утр":8,"рассвет":6,"morning":8,"dawn":6,"день":13,"полдень":12,"noon":12,"afternoon":14,"вечер":19,"закат":18,"evening":19,"ночь":23,"полночь":0,"night":23,"midnight":0};
    static parse(msg){if(!msg)return null;const s=extension_settings[extensionName];let r={days:0,setDate:null,setTime:null};const rp=[[/прошл[оа]\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/через\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/спустя\s+(\d+)\s+(?:дн|дней|день)/gi,1],[/прошл[оа]\s+(\d+)\s+(?:недел|нед)/gi,7],[/через\s+(\d+)\s+(?:недел|нед)/gi,7],[/прошл[оа]\s+(\d+)\s+(?:месяц|мес)/gi,30],[/через\s+(\d+)\s+(?:месяц|мес)/gi,30],[/(\d+)\s+(?:days?)\s+(?:later|passed)/gi,1],[/(\d+)\s+(?:weeks?)\s+later/gi,7],[/(\d+)\s+(?:months?)\s+later/gi,30]];for(const[re,m]of rp){let x;while((x=re.exec(msg))!==null)r.days+=parseInt(x[1])*m;}if(s.timeParserSensitivity!=="low"){if(/на следующ\w+\s+(?:день|утро)|next\s+(?:day|morning)/i.test(msg))r.days+=1;if(/через\s+пару\s+дней/i.test(msg))r.days+=2;if(/на следующ\w+\s+неделе|next\s+week/i.test(msg))r.days+=7;}if(s.timeParserSensitivity==="high"){if(/прошёл\s+месяц|a\s+month\s+later/i.test(msg))r.days+=30;if(/прошла\s+неделя|a\s+week\s+later/i.test(msg))r.days+=7;}for(const[mp,mn]of Object.entries(this.MONTHS_RU)){const re=new RegExp("(\\d{1,2})\\s+"+mp+"\\w*(?:\\s+(\\d{4}))?","i");const m=msg.match(re);if(m){r.setDate={day:parseInt(m[1]),month:mn,year:m[2]?parseInt(m[2]):s.worldDate.year};break;}}if(!r.setDate)for(const[mn,num]of Object.entries(this.MONTHS_EN)){const re=new RegExp(mn+"\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(\\d{4}))?","i");const m=msg.match(re);if(m){r.setDate={day:parseInt(m[1]),month:num,year:m[2]?parseInt(m[2]):s.worldDate.year};break;}}if(!r.setDate){const iso=msg.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);if(iso)r.setDate={year:parseInt(iso[1]),month:parseInt(iso[2]),day:parseInt(iso[3])};}for(const[kw,hr]of Object.entries(this.TOD)){if(new RegExp("\\b"+kw+"\\w*\\b","i").test(msg)){r.setTime={hour:hr};break;}}const hru=msg.match(/в\s+(\d{1,2})\s*(?:час|:(\d{2}))/i);if(hru)r.setTime={hour:parseInt(hru[1]),minute:hru[2]?parseInt(hru[2]):0};const hen=msg.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);if(hen){let h=parseInt(hen[1]);if(hen[3]?.toLowerCase()==="pm"&&h<12)h+=12;r.setTime={hour:h,minute:hen[2]?parseInt(hen[2]):0};}return(r.days>0||r.setDate||r.setTime)?r:null;}
    static apply(p){const s=extension_settings[extensionName];let da=0;if(p.setDate){const c=new Date(s.worldDate.year,s.worldDate.month-1,s.worldDate.day),t=new Date(p.setDate.year,p.setDate.month-1,p.setDate.day),d=Math.round((t-c)/(1000*60*60*24));if(d>0)da=d;s.worldDate.year=p.setDate.year;s.worldDate.month=p.setDate.month;s.worldDate.day=p.setDate.day;}if(p.days>0){s.worldDate=addDays(s.worldDate,p.days);da+=p.days;}if(p.setTime){s.worldDate.hour=p.setTime.hour;if(p.setTime.minute!==undefined)s.worldDate.minute=p.setTime.minute;}if(da>0)this.advanceAll(da);saveSettingsDebounced();ChatProfileManager.save();}
    static advanceAll(d){const s=extension_settings[extensionName];Object.values(s.characters).forEach(p=>{if(!p._enabled)return;if(s.modules.cycle&&p.cycle?.enabled&&!p.pregnancy?.active)new CycleManager(p).advance(d);if(s.modules.pregnancy&&p.pregnancy?.active)new PregnancyManager(p).advanceDay(d);if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.secondarySex){const hr=new HeatRutManager(p);if(p.secondarySex==="omega")hr.advanceHeat(d);if(p.secondarySex==="alpha")hr.advanceRut(d);}if(s.modules.baby&&p.babies?.length>0)p.babies.forEach(b=>{b.ageDays+=d;new BabyManager(b).update();});});saveSettingsDebounced();}
    static formatDesc(p){const pa=[];if(p.days>0)pa.push("+"+p.days+" дн.");if(p.setDate)pa.push(p.setDate.day+"/"+p.setDate.month+"/"+p.setDate.year);if(p.setTime)pa.push(p.setTime.hour+":00");return pa.join(", ");}
}

class PromptInjector {
    static gen(){const s=extension_settings[extensionName];if(!s.promptInjectionEnabled)return"";const d=s.promptInjectionDetail,l=["[LifeCycle]","Date: "+fmt(s.worldDate)];const rt=RelationshipManager.toPromptText();if(rt)l.push("\n"+rt);Object.entries(s.characters).forEach(([n,p])=>{if(!p._enabled)return;l.push("\n--- "+n+" ---");l.push("Sex: "+p.bioSex+(p.secondarySex?" / "+p.secondarySex:""));if(s.modules.auOverlay&&s.auPreset==="omegaverse"){const hr=new HeatRutManager(p);if(p.heat?.active)l.push("IN HEAT ("+HeatRutManager.HP[hr.heatPhase()]+"): Day "+p.heat.currentDay+"/"+p.heat.duration+", Symptoms: "+hr.heatSymptoms().join(", "));else if(p.secondarySex==="omega")l.push("Heat in "+hr.heatDaysLeft()+"d");if(p.rut?.active)l.push("IN RUT: Day "+p.rut.currentDay+"/"+p.rut.duration);else if(p.secondarySex==="alpha")l.push("Rut in "+hr.rutDaysLeft()+"d");}if(s.modules.cycle&&p.cycle?.enabled&&!p.pregnancy?.active){const cm=new CycleManager(p);l.push("Cycle: Day "+p.cycle.currentDay+"/"+p.cycle.length+" "+cm.label(cm.phase()));if(d!=="low")l.push("Fert: "+Math.round(cm.fertility()*100)+"%, Libido: "+cm.libido());}if(s.modules.pregnancy&&p.pregnancy?.active){const pm=new PregnancyManager(p);l.push("PREGNANT Wk"+p.pregnancy.week+"/"+p.pregnancy.maxWeeks+" T"+pm.tri()+", Size: "+pm.size()+", Moves: "+pm.moves());if(p.pregnancy.complications.length>0)l.push("Complications: "+p.pregnancy.complications.join(", "));}if(s.modules.labor&&p.labor?.active){l.push("IN LABOR: "+LL[p.labor.stage]+" "+p.labor.dilation+"cm ("+p.labor.difficulty+")");if(p.labor.complications.length>0)l.push("Complications: "+p.labor.complications.join(", "));}if(s.modules.baby&&p.babies?.length>0&&d!=="low")p.babies.forEach(b=>{l.push("Child: "+(b.name||"?")+(" ("+(b.sex==="M"?"♂":"♀")+", "+new BabyManager(b).age()+")"));});if(p.contraception!=="none")l.push("Contraception: "+p.contraception);});l.push("\n[Reflect all states naturally. Complications = describe symptoms/effects.]\n[/LifeCycle]");return l.join("\n");}
}

// ==========================================
// STATUS WIDGET (same structure as v0.6.0 + complications)
// ==========================================

class StatusWidget {
    static generate(){const s=extension_settings[extensionName];if(!s.enabled||!s.showStatusWidget)return"";const ch=Object.entries(s.characters).filter(([_,p])=>p._enabled);if(ch.length===0)return"";let h='<div class="lc-status-widget"><div class="lc-sw-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'\':\'none\'"><span>🌿 LifeCycle</span><span class="lc-sw-arrow">▼</span></div><div class="lc-sw-body"><div class="lc-sw-date">'+fmt(s.worldDate)+'</div>';for(const[n,p]of ch){h+='<div class="lc-sw-char"><div class="lc-sw-char-name">'+n+(p.secondarySex?' <span class="lc-sw-sec-badge">'+p.secondarySex+'</span>':'')+'</div>';const rl=RelationshipManager.getFor(n);if(rl.length>0){h+='<div class="lc-sw-rels">';for(const r of rl.slice(0,4)){const o=r.char1===n?r.char2:r.char1;const t=r.char1===n?r.type:RelationshipManager.getReciprocalType(r.type);h+='<span class="lc-sw-rel-tag">'+t+': '+o+'</span>';}h+='</div>';}
        if(s.modules.labor&&p.labor?.active){const lm=new LaborManager(p);h+='<div class="lc-sw-block lc-sw-labor-block"><div class="lc-sw-block-title">🏥 РОДЫ ('+p.labor.difficulty+')</div><div class="lc-sw-row">'+LL[p.labor.stage]+' · '+p.labor.dilation+'/10</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:'+(p.labor.dilation*10)+'%"></div></div>';if(p.labor.complications.length>0)h+='<div class="lc-sw-symptoms">⚠️ '+p.labor.complications.join(', ')+'</div>';h+='</div>';}
        else if(s.modules.pregnancy&&p.pregnancy?.active){const pm=new PregnancyManager(p);const pr=Math.round((p.pregnancy.week/p.pregnancy.maxWeeks)*100);h+='<div class="lc-sw-block lc-sw-preg-block"><div class="lc-sw-block-title">🤰 Нед.'+p.pregnancy.week+'/'+p.pregnancy.maxWeeks+' T'+pm.tri()+'</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:'+pr+'%"></div></div><div class="lc-sw-row">~'+pm.size()+' · Плодов: '+p.pregnancy.fetusCount+' ('+p.pregnancy.fetusSexes.map(x=>x==="M"?"♂":"♀").join("")+')</div>';if(p.pregnancy.complications.length>0)h+='<div class="lc-sw-symptoms">⚠️ '+p.pregnancy.complications.join(', ')+'</div>';h+='</div>';}
        if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.heat?.active){const hr=new HeatRutManager(p);h+='<div class="lc-sw-block lc-sw-heat-block"><div class="lc-sw-block-title">🔥 '+HeatRutManager.HP[hr.heatPhase()]+' д.'+p.heat.currentDay+'/'+p.heat.duration+'</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill heat" style="width:'+hr.heatProg()+'%"></div></div><div class="lc-sw-symptoms">'+hr.heatSymptoms().join(' · ')+'</div></div>';}
        if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.rut?.active){const hr=new HeatRutManager(p);h+='<div class="lc-sw-block lc-sw-rut-block"><div class="lc-sw-block-title">💢 '+HeatRutManager.RP[hr.rutPhase()]+' д.'+p.rut.currentDay+'/'+p.rut.duration+'</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill rut" style="width:'+hr.rutProg()+'%"></div></div></div>';}
        if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.secondarySex==="omega"&&!p.heat?.active&&!p.pregnancy?.active){const hr=new HeatRutManager(p);h+='<div class="lc-sw-block lc-sw-cycle-block"><div class="lc-sw-block-title">🔮 Течка через '+hr.heatDaysLeft()+' дн.'+(hr.heatDaysLeft()<=3?' ⚠️':'')+'</div></div>';}
        if(s.modules.auOverlay&&s.auPreset==="omegaverse"&&p.secondarySex==="alpha"&&!p.rut?.active){const hr=new HeatRutManager(p);h+='<div class="lc-sw-block lc-sw-cycle-block"><div class="lc-sw-block-title">⚡ Гон через '+hr.rutDaysLeft()+' дн.</div></div>';}
        if(s.modules.cycle&&p.cycle?.enabled&&!p.pregnancy?.active&&!p.labor?.active){const cm=new CycleManager(p),ph=cm.phase(),f=cm.fertility();let fc="low";if(f>=0.2)fc="peak";else if(f>=0.1)fc="high";else if(f>=0.05)fc="med";h+='<div class="lc-sw-block lc-sw-cycle-block"><div class="lc-sw-block-title">'+cm.emoji(ph)+' '+cm.label(ph)+'</div><div class="lc-sw-row">День '+p.cycle.currentDay+'/'+p.cycle.length+' · <span class="lc-sw-fert '+fc+'">'+Math.round(f*100)+'%</span> · '+cm.libido()+'</div></div>';}
        if(s.modules.baby&&p.babies?.length>0){h+='<div class="lc-sw-block lc-sw-baby-block">';for(const b of p.babies)h+='<div class="lc-sw-baby-row">👶 <strong>'+(b.name||'?')+'</strong> ('+(b.sex==="M"?'♂':'♀')+') '+new BabyManager(b).age()+'</div>';h+='</div>';}
        h+='</div>';}
    if(s.diceLog.length>0){const la=s.diceLog[s.diceLog.length-1];h+='<div class="lc-sw-dice">🎲 <span class="'+(la.result?'lc-sw-dice-win':'lc-sw-dice-lose')+'">'+la.roll+'/'+la.chance+'% '+(la.result?'✅':'❌')+'</span></div>';}
    h+='</div></div>';return h;}
    static inject(idx){const s=extension_settings[extensionName];if(!s.enabled||!s.showStatusWidget)return;const w=StatusWidget.generate();if(!w)return;setTimeout(()=>{const el=document.querySelector('#chat .mes[mesid="'+idx+'"]');if(!el)return;const mt=el.querySelector('.mes_text');if(!mt)return;mt.querySelectorAll('.lc-status-widget').forEach(x=>x.remove());mt.insertAdjacentHTML('beforeend',w);},300);}
}

// ==========================================
// POPUP FORMS (Baby form, Pregnancy config, Baby creator)
// ==========================================

function showDice(res,tg,auto){document.querySelector(".lc-overlay")?.remove();document.querySelector(".lc-popup")?.remove();const ov=document.createElement("div");ov.className="lc-overlay";const po=document.createElement("div");po.className="lc-popup";po.innerHTML='<div class="lc-popup-title">🎲 Бросок</div>'+(auto?'<div class="lc-popup-auto">⚡ Авто</div>':'')+'<div class="lc-popup-details"><div>Цель: <strong>'+tg+'</strong></div><div>'+res.type+' | '+res.ejac+' | '+res.contra+'</div><div>Шанс: '+res.chance+'%</div></div><div class="lc-popup-result '+(res.result?'success':'fail')+'">'+res.roll+' / '+res.chance+'</div><div class="lc-popup-verdict '+(res.result?'success':'fail')+'">'+(res.result?'✅ ЗАЧАТИЕ!':'❌ Нет')+'</div><div class="lc-popup-actions"><button id="lc-d-ok" class="lc-btn lc-btn-success">ОК</button><button id="lc-d-re" class="lc-btn">🎲</button><button id="lc-d-no" class="lc-btn lc-btn-danger">✕</button></div>';document.body.appendChild(ov);document.body.appendChild(po);document.getElementById("lc-d-ok").addEventListener("click",()=>{if(res.result){const p=extension_settings[extensionName].characters[tg];if(p){showPregnancyConfig(tg,res.pa?.find(x=>x!==tg)||"?");}}ov.remove();po.remove();});document.getElementById("lc-d-re").addEventListener("click",()=>{ov.remove();po.remove();const nr=IntimacyManager.roll(tg,{pa:res.pa,tp:res.type,ej:res.ejac,co:false,nc:res.contra==="нет",auto});showDice(nr,tg,auto);});document.getElementById("lc-d-no").addEventListener("click",()=>{ov.remove();po.remove();});ov.addEventListener("click",()=>{ov.remove();po.remove();});}

// NEW: Pregnancy configuration popup
function showPregnancyConfig(motherName, fatherName) {
    document.querySelector(".lc-overlay")?.remove();document.querySelector(".lc-popup")?.remove();
    const ov=document.createElement("div");ov.className="lc-overlay";
    const po=document.createElement("div");po.className="lc-popup";po.style.maxWidth="420px";
    po.innerHTML='<div class="lc-popup-title">🤰 Настройка беременности</div><div class="lc-popup-details"><div>Мать: <strong>'+motherName+'</strong> · Отец: <strong>'+fatherName+'</strong></div></div><div class="lc-editor-grid"><div class="lc-editor-field"><label>Кол-во плодов</label><input type="number" id="lc-pc-count" class="lc-input" min="1" max="6" value="1"></div><div class="lc-editor-field"><label>Пол 1-го</label><select id="lc-pc-sex1" class="lc-select"><option value="random">🎲</option><option value="M">♂</option><option value="F">♀</option></select></div><div class="lc-editor-field"><label>Осложнения</label><select id="lc-pc-comp" class="lc-select"><option value="on">Вкл.</option><option value="off">Выкл.</option><option value="random">Случайно</option></select></div></div><div class="lc-popup-actions"><button id="lc-pc-ok" class="lc-btn lc-btn-success">✅ Начать</button><button id="lc-pc-no" class="lc-btn">Отмена</button></div>';
    document.body.appendChild(ov);document.body.appendChild(po);
    document.getElementById("lc-pc-ok").addEventListener("click",()=>{
        const s=extension_settings[extensionName],p=s.characters[motherName];if(!p)return;
        const count=parseInt(document.getElementById("lc-pc-count").value)||1;
        const sex1=document.getElementById("lc-pc-sex1").value;
        const compMode=document.getElementById("lc-pc-comp").value;
        const sexes=[];for(let i=0;i<count;i++){if(i===0&&sex1!=="random")sexes.push(sex1);else sexes.push(Math.random()<0.5?"M":"F");}
        new PregnancyManager(p).start(fatherName,count,sexes);
        p.pregnancy.complicationsEnabled = compMode==="on"||(compMode==="random"&&Math.random()<0.5);
        if(compMode==="random"&&Math.random()<0.15){const pool=s.pregnancyComplications||[];if(pool.length>0)p.pregnancy.complications.push(pool[Math.floor(Math.random()*pool.length)]);}
        saveSettingsDebounced();ChatProfileManager.save();rebuildUI();ov.remove();po.remove();toastr.success(motherName+": беременность!");
    });
    document.getElementById("lc-pc-no").addEventListener("click",()=>{ov.remove();po.remove();});
}

// Baby form (for birth OR edit OR standalone creation)
function showBabyForm(parentName, fatherName, existingBaby, babyIndex, isStandalone) {
    const s=extension_settings[extensionName];const isEdit=!!existingBaby;const b=existingBaby||{};
    document.querySelector(".lc-overlay")?.remove();document.querySelector(".lc-popup")?.remove();
    const ov=document.createElement("div");ov.className="lc-overlay";const fm=document.createElement("div");fm.className="lc-popup";fm.style.maxWidth="420px";
    // Build parent selects for standalone
    const charOpts=Object.keys(s.characters).map(n=>'<option value="'+n+'">'+n+'</option>').join("");
    fm.innerHTML='<div class="lc-popup-title">'+(isStandalone?'👶 Создать ребёнка':isEdit?'✏️ Редактировать':'👶 Рождение')+'</div><div class="lc-editor-grid"><div class="lc-editor-field"><label>Имя</label><input type="text" id="lc-bf-name" class="lc-input" value="'+(b.name||'')+'" placeholder="Имя"></div><div class="lc-editor-field"><label>Пол</label><select id="lc-bf-sex" class="lc-select"><option value="M"'+(b.sex==="M"?' selected':'')+'>♂</option><option value="F"'+(b.sex==="F"?' selected':'')+'>♀</option><option value="random">🎲</option></select></div><div class="lc-editor-field"><label>Втор. пол</label><select id="lc-bf-sec" class="lc-select"><option value="">нет</option><option value="alpha"'+(b.secondarySex==="alpha"?' selected':'')+'>α</option><option value="beta"'+(b.secondarySex==="beta"?' selected':'')+'>β</option><option value="omega"'+(b.secondarySex==="omega"?' selected':'')+'>Ω</option><option value="random">🎲</option></select></div><div class="lc-editor-field"><label>Глаза</label><input type="text" id="lc-bf-eyes" class="lc-input" value="'+(b.eyeColor||'')+'"></div><div class="lc-editor-field"><label>Волосы</label><input type="text" id="lc-bf-hair" class="lc-input" value="'+(b.hairColor||'')+'"></div>'+(isEdit?'<div class="lc-editor-field"><label>Возраст (дни)</label><input type="number" id="lc-bf-age" class="lc-input" value="'+(b.ageDays||0)+'"></div>':'')+(isStandalone?'<div class="lc-editor-field"><label>Мать</label><select id="lc-bf-mother" class="lc-select"><option value="?">—</option>'+charOpts+'</select></div><div class="lc-editor-field"><label>Отец</label><select id="lc-bf-father" class="lc-select"><option value="?">—</option>'+charOpts+'</select></div><div class="lc-editor-field"><label>Записать к</label><select id="lc-bf-addto" class="lc-select">'+charOpts+'</select></div><div class="lc-editor-field"><label>Возраст (дни)</label><input type="number" id="lc-bf-age" class="lc-input" value="0"></div>':'')+'</div><div class="lc-popup-actions"><button id="lc-bf-save" class="lc-btn lc-btn-success">'+(isEdit?'💾':isStandalone?'✅ Создать':'👶 Родить')+'</button><button id="lc-bf-cancel" class="lc-btn">✕</button></div>';
    document.body.appendChild(ov);document.body.appendChild(fm);
    document.getElementById("lc-bf-save").addEventListener("click",()=>{
        const nm=document.getElementById("lc-bf-name").value.trim()||"Малыш";
        let sx=document.getElementById("lc-bf-sex").value;if(sx==="random")sx=Math.random()<0.5?"M":"F";
        let sc=document.getElementById("lc-bf-sec").value;if(sc==="random"){const r=Math.random();sc=r<0.25?"alpha":r<0.75?"beta":"omega";}
        const ey=document.getElementById("lc-bf-eyes").value.trim(),hr=document.getElementById("lc-bf-hair").value.trim();
        if(isEdit){const mo=s.characters[parentName];if(mo?.babies?.[babyIndex]){const bb=mo.babies[babyIndex];bb.name=nm;bb.sex=sx;bb.secondarySex=sc||null;if(ey)bb.eyeColor=ey;if(hr)bb.hairColor=hr;const ag=document.getElementById("lc-bf-age")?.value;if(ag!==undefined){bb.ageDays=parseInt(ag)||0;new BabyManager(bb).update();}saveSettingsDebounced();rebuildUI();toastr.success("Обновлён: "+nm);}}
        else if(isStandalone){const motherN=document.getElementById("lc-bf-mother").value;const fatherN=document.getElementById("lc-bf-father").value;const addTo=document.getElementById("lc-bf-addto").value;const ageDays=parseInt(document.getElementById("lc-bf-age")?.value)||0;const baby=BabyManager.createStandalone({name:nm,sex:sx,secondarySex:sc||null,eyeColor:ey,hairColor:hr,mother:motherN,father:fatherN,ageDays});if(s.characters[addTo]){s.characters[addTo].babies.push(baby);RelationshipManager.addBirthRelationships(motherN!=="?"?motherN:null,fatherN!=="?"?fatherN:null,nm);saveSettingsDebounced();rebuildUI();toastr.success("Создан: "+nm);}}
        else{const mo=s.characters[parentName];if(mo){const baby=BabyManager.gen(mo,fatherName,{name:nm,sex:sx,secondarySex:sc||null,eyeColor:ey,hairColor:hr});mo.babies.push(baby);RelationshipManager.addBirthRelationships(parentName,fatherName,nm);new LaborManager(mo).deliver();if(mo.labor.babiesDelivered>=mo.labor.totalBabies)new LaborManager(mo).end();saveSettingsDebounced();rebuildUI();toastr.success("Родился: "+nm+" ("+(sx==="M"?"♂":"♀")+")!");}}
        ov.remove();fm.remove();
    });
    document.getElementById("lc-bf-cancel").addEventListener("click",()=>{ov.remove();fm.remove();});
    ov.addEventListener("click",()=>{ov.remove();fm.remove();});
}

// ==========================================
// JSON HELPERS
// ==========================================

function downloadJSON(d,fn){const b=new Blob([JSON.stringify(d,null,2)],{type:"application/json"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=fn;document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(u);}
function uploadJSON(cb){const i=document.createElement("input");i.type="file";i.accept=".json";i.addEventListener("change",e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{cb(JSON.parse(ev.target.result));}catch(er){toastr.error("JSON: "+er.message);}};r.readAsText(f);});i.click();}

// ==========================================
// HTML GENERATION (с cycle day setter, pregnancy config, labor config, baby creator, chat profiles)
// ==========================================

function buildSel(id){const n=Object.keys(extension_settings[extensionName].characters);return'<select id="'+id+'" class="lc-select lc-char-select">'+n.map(x=>'<option value="'+x+'">'+x+'</option>').join("")+'</select>';}

function generateHTML(){
    const s=extension_settings[extensionName];
    return '<div id="lifecycle-panel" class="lifecycle-panel'+(s.panelCollapsed?' collapsed':'')+'"><div class="lifecycle-header" id="lifecycle-header-toggle"><div class="lifecycle-header-title"><span class="lc-collapse-arrow">'+(s.panelCollapsed?'▶':'▼')+'</span><h3>LifeCycle</h3><span class="lc-version">v0.7</span></div><div class="lifecycle-header-actions"><label class="lc-switch"><input type="checkbox" id="lc-enabled" '+(s.enabled?'checked':'')+'><span class="lc-switch-slider"></span></label></div></div><div class="lifecycle-body" id="lifecycle-body"><div class="lc-dashboard"><div id="lc-dashboard-date" class="lc-dashboard-date"></div><div id="lc-dashboard-items"></div></div>'+
    '<div class="lifecycle-tabs">'+
        '<button class="lifecycle-tab active" data-tab="chars"><span class="tab-icon">👥</span>Перс.</button>'+
        '<button class="lifecycle-tab" data-tab="rels"><span class="tab-icon">💞</span>Семья</button>'+
        '<button class="lifecycle-tab" data-tab="cycle"><span class="tab-icon">🔴</span>Цикл</button>'+
        '<button class="lifecycle-tab" data-tab="heatrut"><span class="tab-icon">🔥</span>Течка</button>'+
        '<button class="lifecycle-tab" data-tab="intim"><span class="tab-icon">💕</span>Интим</button>'+
        '<button class="lifecycle-tab" data-tab="preg"><span class="tab-icon">🤰</span>Берем.</button>'+
        '<button class="lifecycle-tab" data-tab="labor"><span class="tab-icon">🏥</span>Роды</button>'+
        '<button class="lifecycle-tab" data-tab="babies"><span class="tab-icon">👶</span>Дети</button>'+
        '<button class="lifecycle-tab" data-tab="profiles"><span class="tab-icon">💾</span>Профили</button>'+
        '<button class="lifecycle-tab" data-tab="settings"><span class="tab-icon">⚙️</span>Настр.</button>'+
    '</div>'+
    // CHARS
    '<div class="lifecycle-tab-content active" data-tab="chars"><div class="lc-btn-group" style="margin-bottom:8px"><button id="lc-sync" class="lc-btn lc-btn-primary">🔄</button><button id="lc-add-m" class="lc-btn">+</button><button id="lc-reparse" class="lc-btn">📖</button></div><div id="lc-char-list"></div><div id="lc-char-editor" class="lc-editor hidden"><div id="lc-editor-title" class="lc-editor-title"></div><div class="lc-editor-grid"><div class="lc-editor-field"><label>Биол. пол</label><select id="lc-edit-bio-sex" class="lc-select"><option value="F">F</option><option value="M">M</option></select></div><div class="lc-editor-field"><label>Втор. пол</label><select id="lc-edit-sec-sex" class="lc-select"><option value="">—</option><option value="alpha">α</option><option value="beta">β</option><option value="omega">Ω</option></select></div><div class="lc-editor-field"><label>Раса</label><input type="text" id="lc-edit-race" class="lc-input"></div><div class="lc-editor-field"><label>Контрацепция</label><select id="lc-edit-contra" class="lc-select"><option value="none">нет</option><option value="condom">презерватив</option><option value="pill">таблетки</option><option value="iud">ВМС</option><option value="withdrawal">ППА</option></select></div><div class="lc-editor-field"><label>Глаза</label><input type="text" id="lc-edit-eyes" class="lc-input"></div><div class="lc-editor-field"><label>Волосы</label><input type="text" id="lc-edit-hair" class="lc-input"></div><div class="lc-editor-field"><label>Сложность</label><select id="lc-edit-diff" class="lc-select"><option value="easy">лёгкая</option><option value="normal">обычная</option><option value="severe">тяжёлая</option></select></div><div class="lc-editor-field"><label>Вкл.</label><input type="checkbox" id="lc-edit-enabled" checked></div><div class="lc-editor-field"><label>Цикл</label><input type="checkbox" id="lc-edit-cycle-on"></div><div class="lc-editor-field"><label>Длина цикла</label><input type="number" id="lc-edit-cycle-len" class="lc-input" min="21" max="45"></div><div class="lc-editor-field"><label>Менструация (дн.)</label><input type="number" id="lc-edit-mens-dur" class="lc-input" min="2" max="8"></div><div class="lc-editor-field"><label>Нерегулярность</label><input type="number" id="lc-edit-irreg" class="lc-input" min="0" max="10"></div></div><div class="lc-editor-actions"><button id="lc-editor-save" class="lc-btn lc-btn-success">💾</button><button id="lc-editor-cancel" class="lc-btn">✕</button></div></div></div>'+
    // RELATIONSHIPS
    '<div class="lifecycle-tab-content" data-tab="rels"><div class="lc-section"><h4>Добавить</h4><div class="lc-row">'+buildSel("lc-rel-c1")+'<select id="lc-rel-tp" class="lc-select">'+REL_TYPES.map(t=>'<option>'+t+'</option>').join("")+'</select>'+buildSel("lc-rel-c2")+'</div><div class="lc-row"><input type="text" id="lc-rel-n" class="lc-input" placeholder="Заметка"><button id="lc-rel-add" class="lc-btn lc-btn-success">+</button></div></div><div id="lc-rel-list"></div></div>'+
    // CYCLE — with manual day setter!
    '<div class="lifecycle-tab-content" data-tab="cycle">'+buildSel("lc-cycle-char")+'<div id="lc-cycle-panel"></div><div class="lc-section" style="margin-top:8px"><h4>Управление циклом</h4><div class="lc-row"><label>День цикла:</label><input type="number" id="lc-cycle-day-input" class="lc-input" style="width:60px" min="1" max="45"><button id="lc-cycle-set-day" class="lc-btn lc-btn-sm">Уст.</button></div><div class="lc-btn-group"><button id="lc-cyc-mens" class="lc-btn lc-btn-sm">→Менстр.</button><button id="lc-cyc-foll" class="lc-btn lc-btn-sm">→Фоллик.</button><button id="lc-cyc-ovul" class="lc-btn lc-btn-sm">→Овуляция</button><button id="lc-cyc-lut" class="lc-btn lc-btn-sm">→Лютеин.</button><button id="lc-cyc-skip" class="lc-btn lc-btn-sm">Пропустить</button></div></div></div>'+
    // HEAT/RUT
    '<div class="lifecycle-tab-content" data-tab="heatrut">'+buildSel("lc-hr-char")+'<div id="lc-hr-panel"></div></div>'+
    // INTIMACY
    '<div class="lifecycle-tab-content" data-tab="intim"><div class="lc-section"><div class="lc-row">'+buildSel("lc-intim-t")+buildSel("lc-intim-p")+'</div><div class="lc-row"><select id="lc-intim-tp" class="lc-select"><option value="vaginal">Вагин.</option><option value="anal">Анал.</option><option value="oral">Орал.</option></select><select id="lc-intim-ej" class="lc-select"><option value="inside">Внутрь</option><option value="outside">Снаружи</option></select></div><div class="lc-btn-group"><button id="lc-intim-log" class="lc-btn">📝</button><button id="lc-intim-roll" class="lc-btn lc-btn-primary">🎲</button></div></div><div class="lc-section"><h4>Броски</h4><div id="lc-dice-log" class="lc-scroll"></div></div><div class="lc-section"><h4>Акты</h4><div id="lc-intim-log-list" class="lc-scroll"></div></div></div>'+
    // PREGNANCY — with config controls
    '<div class="lifecycle-tab-content" data-tab="preg">'+buildSel("lc-preg-char")+'<div id="lc-preg-panel"></div><div class="lc-section" style="margin-top:8px"><h4>Управление</h4><div class="lc-btn-group"><button id="lc-preg-adv" class="lc-btn">+1нед</button><button id="lc-preg-set" class="lc-btn">Уст.нед</button><button id="lc-preg-to-labor" class="lc-btn lc-btn-danger">→Роды</button><button id="lc-preg-end" class="lc-btn lc-btn-danger">Прервать</button></div><div class="lc-row" style="margin-top:6px"><label>Плодов:</label><input type="number" id="lc-preg-fc" class="lc-input" style="width:50px" min="1" max="6"><button id="lc-preg-fc-set" class="lc-btn lc-btn-sm">Уст.</button></div><div class="lc-row"><label>Пол плодов:</label><span id="lc-preg-sexes"></span><button id="lc-preg-sex-toggle" class="lc-btn lc-btn-sm">Сменить</button></div><div class="lc-row"><label>Осложнения:</label><button id="lc-preg-comp-add" class="lc-btn lc-btn-sm">+Рандом</button><button id="lc-preg-comp-clear" class="lc-btn lc-btn-sm lc-btn-danger">Убрать все</button><label class="lc-checkbox"><input type="checkbox" id="lc-preg-comp-on"><span>Авто-осложн.</span></label></div><div id="lc-preg-comp-list"></div></div></div>'+
    // LABOR — with difficulty + complications
    '<div class="lifecycle-tab-content" data-tab="labor">'+buildSel("lc-labor-char")+'<div id="lc-labor-panel"></div><div class="lc-section" style="margin-top:8px"><h4>Управление</h4><div class="lc-row"><label>Сложность:</label><select id="lc-labor-diff" class="lc-select"><option value="easy">Лёгкие</option><option value="normal">Обычные</option><option value="hard">Тяжёлые</option><option value="extreme">Экстремальные</option></select></div><div class="lc-btn-group"><button id="lc-labor-adv" class="lc-btn">→Стадия</button><button id="lc-labor-deliver" class="lc-btn lc-btn-success">👶 Родить</button><button id="lc-labor-end" class="lc-btn lc-btn-danger">Завершить</button></div><div class="lc-row"><label>Осложнения:</label><button id="lc-labor-comp-add" class="lc-btn lc-btn-sm">+Рандом</button><button id="lc-labor-comp-clear" class="lc-btn lc-btn-sm lc-btn-danger">Убрать все</button><label class="lc-checkbox"><input type="checkbox" id="lc-labor-comp-on"><span>Авто-осложн.</span></label></div><div id="lc-labor-comp-list"></div></div></div>'+
    // BABIES — with standalone creator
    '<div class="lifecycle-tab-content" data-tab="babies">'+buildSel("lc-baby-parent")+'<div class="lc-btn-group" style="margin:6px 0"><button id="lc-baby-create" class="lc-btn lc-btn-primary">➕ Создать ребёнка</button></div><div id="lc-baby-list"></div></div>'+
    // CHAT PROFILES
    '<div class="lifecycle-tab-content" data-tab="profiles"><div class="lc-section"><h4>Текущий чат</h4><div id="lc-profile-current" class="lc-info"></div><div class="lc-btn-group"><button id="lc-profile-save" class="lc-btn lc-btn-success">💾 Сохранить</button><button id="lc-profile-reload" class="lc-btn">🔄 Перезагрузить</button></div></div><div class="lc-section"><h4>Сохранённые профили</h4><div id="lc-profile-list" class="lc-scroll"></div></div></div>'+
    // SETTINGS
    '<div class="lifecycle-tab-content" data-tab="settings"><div class="lc-section"><h4>Авто</h4><label class="lc-checkbox"><input type="checkbox" id="lc-s-sync" '+(s.autoSyncCharacters?'checked':'')+'><span>Синхр.</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-s-parse" '+(s.autoParseCharInfo?'checked':'')+'><span>Карточки</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-s-chat" '+(s.parseFullChat?'checked':'')+'><span>Чат</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-s-det" '+(s.autoDetectIntimacy?'checked':'')+'><span>Детекция</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-s-roll" '+(s.autoRollOnSex?'checked':'')+'><span>Бросок</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-s-wid" '+(s.showStatusWidget?'checked':'')+'><span>Виджет</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-s-time" '+(s.autoTimeProgress?'checked':'')+'><span>Время</span></label></div><div class="lc-section"><h4>Дата</h4><div class="lc-row"><input type="number" id="lc-dy" class="lc-input" style="width:65px" value="'+s.worldDate.year+'"><input type="number" id="lc-dm" class="lc-input" style="width:45px" value="'+s.worldDate.month+'"><input type="number" id="lc-dd" class="lc-input" style="width:45px" value="'+s.worldDate.day+'"><input type="number" id="lc-dh" class="lc-input" style="width:45px" value="'+s.worldDate.hour+'">:<input type="number" id="lc-dmin" class="lc-input" style="width:45px" value="'+s.worldDate.minute+'"></div><div class="lc-btn-group"><button id="lc-da" class="lc-btn">Прим.</button><button id="lc-d1" class="lc-btn">+1д</button><button id="lc-d7" class="lc-btn">+7д</button></div><label class="lc-checkbox"><input type="checkbox" id="lc-df" '+(s.worldDate.frozen?'checked':'')+'><span>❄️</span></label></div><div class="lc-section"><h4>Модули</h4><label class="lc-checkbox"><input type="checkbox" id="lc-mc" '+(s.modules.cycle?'checked':'')+'><span>Цикл</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-mp" '+(s.modules.pregnancy?'checked':'')+'><span>Берем.</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-ml" '+(s.modules.labor?'checked':'')+'><span>Роды</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-mb" '+(s.modules.baby?'checked':'')+'><span>Дети</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-mi" '+(s.modules.intimacy?'checked':'')+'><span>Интим</span></label><label class="lc-checkbox"><input type="checkbox" id="lc-mau" '+(s.modules.auOverlay?'checked':'')+'><span>AU</span></label></div><div class="lc-section"><h4>Промпт</h4><label class="lc-checkbox"><input type="checkbox" id="lc-pon" '+(s.promptInjectionEnabled?'checked':'')+'><span>Вкл.</span></label><div class="lc-row"><select id="lc-ppos" class="lc-select"><option value="system"'+(s.promptInjectionPosition==="system"?" selected":"")+'>Sys</option><option value="authornote"'+(s.promptInjectionPosition==="authornote"?" selected":"")+'>AN</option><option value="endofchat"'+(s.promptInjectionPosition==="endofchat"?" selected":"")+'>EoC</option></select><select id="lc-pdet" class="lc-select"><option value="low"'+(s.promptInjectionDetail==="low"?" selected":"")+'>Низ</option><option value="medium"'+(s.promptInjectionDetail==="medium"?" selected":"")+'>Ср</option><option value="high"'+(s.promptInjectionDetail==="high"?" selected":"")+'>Выс</option></select></div></div><div class="lc-section"><h4>AU</h4><select id="lc-aup" class="lc-select"><option value="realism"'+(s.auPreset==="realism"?" selected":"")+'>Реализм</option><option value="omegaverse"'+(s.auPreset==="omegaverse"?" selected":"")+'>Омегаверс</option><option value="fantasy"'+(s.auPreset==="fantasy"?" selected":"")+'>Фэнтези</option><option value="scifi"'+(s.auPreset==="scifi"?" selected":"")+'>Sci-Fi</option></select><div id="lc-au-panel"></div></div><div class="lc-section"><div class="lc-btn-group"><button id="lc-exp" class="lc-btn">📤</button><button id="lc-imp" class="lc-btn">📥</button><button id="lc-rst" class="lc-btn lc-btn-danger">🗑️</button></div></div></div>'+
    '</div></div>';
}

// ==========================================
// RENDER FUNCTIONS
// ==========================================

function rebuildUI(){renderDash();renderCharList();renderCycle();renderHR();renderPreg();renderLabor();renderBabies();renderDiceLog();renderIntimLog();renderRels();renderProfiles();updateSels();}
function updateSels(){const n=Object.keys(extension_settings[extensionName].characters);const o=n.map(x=>'<option value="'+x+'">'+x+'</option>').join("");document.querySelectorAll(".lc-char-select").forEach(s=>{const v=s.value;s.innerHTML=o;if(n.includes(v))s.value=v;});}

function renderDash(){const s=extension_settings[extensionName];const de=document.getElementById("lc-dashboard-date"),ie=document.getElementById("lc-dashboard-items");if(!de||!ie)return;de.textContent="📅 "+fmt(s.worldDate)+(s.worldDate.frozen?" ❄️":"");let h="";Object.entries(s.characters).forEach(([n,p])=>{if(!p._enabled)return;let pa=[];if(s.modules.cycle&&p.cycle?.enabled&&!p.pregnancy?.active){const cm=new CycleManager(p);pa.push(cm.emoji(cm.phase())+cm.label(cm.phase()));}if(s.modules.pregnancy&&p.pregnancy?.active)pa.push("🤰Нед."+p.pregnancy.week);if(s.modules.labor&&p.labor?.active)pa.push("🏥");if(p.heat?.active)pa.push("🔥");if(p.rut?.active)pa.push("💢");if(p.babies?.length>0)pa.push("👶×"+p.babies.length);if(pa.length>0)h+='<div class="lc-dash-item"><span class="lc-dash-name">'+n+'</span> '+pa.join(' · ')+'</div>';});ie.innerHTML=h||'<div class="lc-dash-empty">Нет событий</div>';}

function renderCharList(){const s=extension_settings[extensionName],el=document.getElementById("lc-char-list");if(!el)return;let h="";Object.entries(s.characters).forEach(([n,p])=>{const sx=p.bioSex==="F"?"♀":"♂";const sec=p.secondarySex?" · "+p.secondarySex:"";h+='<div class="lc-char-card"><div class="lc-char-card-header"><span class="lc-char-card-name">'+n+'</span><span class="lc-char-card-info">'+sx+sec+' · '+(p.race||"human")+(p.cycle?.enabled?'':' · цикл выкл.')+'</span></div><div class="lc-char-card-actions"><button class="lc-btn lc-btn-sm lc-edit-char" data-char="'+n+'">✏️</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-del-char" data-char="'+n+'">🗑️</button></div></div>';});el.innerHTML=h||'<div class="lc-empty">Нажмите 🔄</div>';}

function renderRels(){const s=extension_settings[extensionName],el=document.getElementById("lc-rel-list");if(!el)return;const rels=s.relationships||[];if(rels.length===0){el.innerHTML='<div class="lc-empty">Нет связей</div>';return;}let h="";for(const r of rels){h+='<div class="lc-char-card"><span>'+r.char1+' → '+r.char2+': <strong>'+r.type+'</strong>'+(r.notes?' ('+r.notes+')':'')+'</span><button class="lc-btn lc-btn-sm lc-btn-danger lc-del-rel" data-id="'+r.id+'" style="margin-left:auto">🗑️</button></div>';}el.innerHTML=h;el.querySelectorAll(".lc-del-rel").forEach(b=>b.addEventListener("click",function(){RelationshipManager.remove(this.dataset.id);renderRels();}));}

function renderCycle(){
    const s=extension_settings[extensionName],el=document.getElementById("lc-cycle-panel"),sel=document.getElementById("lc-cycle-char");if(!el||!sel)return;
    const p=s.characters[sel.value];
    if(!p?.cycle?.enabled||p.pregnancy?.active){el.innerHTML='<div class="lc-info">Неактивен'+(p?.bioSex==="M"&&!p?.secondarySex?' (мужской пол)':'')+'</div>';return;}
    const cm=new CycleManager(p),ph=cm.phase(),f=cm.fertility();
    let fc="low";if(f>=0.2)fc="peak";else if(f>=0.1)fc="high";else if(f>=0.05)fc="med";
    let cal='<div class="lc-cycle-calendar">';for(let d=1;d<=p.cycle.length;d++){const ov=Math.round(p.cycle.length-14);let c="lc-cal-day";if(d<=p.cycle.menstruationDuration)c+=" mens";else if(d>=ov-2&&d<=ov+1)c+=" ovul";else if(d<ov-2)c+=" foll";else c+=" lut";if(d===p.cycle.currentDay)c+=" today";cal+='<div class="'+c+'">'+d+'</div>';}cal+='</div>';
    el.innerHTML=cal+'<div class="lc-cycle-info"><div>'+cm.emoji(ph)+' '+cm.label(ph)+' · День '+p.cycle.currentDay+'/'+p.cycle.length+'</div><div>Ферт.: <span class="lc-fert-badge '+fc+'">'+Math.round(f*100)+'%</span> · Либидо: '+cm.libido()+'</div><div>Выделения: '+cm.discharge()+'</div></div>';
    // Set current day input
    const dayInput = document.getElementById("lc-cycle-day-input");
    if(dayInput) dayInput.value = p.cycle.currentDay;
}

function renderHR(){const s=extension_settings[extensionName],el=document.getElementById("lc-hr-panel"),sel=document.getElementById("lc-hr-char");if(!el||!sel)return;const p=s.characters[sel.value];if(!p||!s.modules.auOverlay||s.auPreset!=="omegaverse"||!p.secondarySex){el.innerHTML='<div class="lc-info">AU Омегаверс + α/Ω</div>';return;}const hr=new HeatRutManager(p);let h="";if(p.secondarySex==="omega"){h+='<div class="lc-section"><h4>🔥 '+HeatRutManager.HP[hr.heatPhase()]+'</h4>';if(p.heat.active)h+='<div class="lc-info-row">День '+p.heat.currentDay+'/'+p.heat.duration+'</div>';else h+='<div class="lc-info-row">До след.: '+hr.heatDaysLeft()+' дн.</div>';h+='<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill '+(p.heat.active?'heat':'heat-cycle')+'" style="width:'+hr.heatProg()+'%"></div></div>';const hs=hr.heatSymptoms();if(hs.length)h+='<div class="lc-info-row">'+hs.join(', ')+'</div>';h+='<div class="lc-btn-group"><button id="lc-hr-th" class="lc-btn">🔥</button><button id="lc-hr-sh" class="lc-btn">⏹</button><button id="lc-hr-su" class="lc-btn">'+(p.heat.onSuppressants?'💊✓':'💊')+'</button></div></div>';}if(p.secondarySex==="alpha"){h+='<div class="lc-section"><h4>💢 '+HeatRutManager.RP[hr.rutPhase()]+'</h4>';if(p.rut.active)h+='<div class="lc-info-row">День '+p.rut.currentDay+'/'+p.rut.duration+'</div>';else h+='<div class="lc-info-row">До след.: '+hr.rutDaysLeft()+' дн.</div>';h+='<div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill '+(p.rut.active?'rut':'rut-cycle')+'" style="width:'+hr.rutProg()+'%"></div></div>';h+='<div class="lc-btn-group"><button id="lc-hr-tr" class="lc-btn">💢</button><button id="lc-hr-sr" class="lc-btn">⏹</button></div></div>';}el.innerHTML=h;document.getElementById("lc-hr-th")?.addEventListener("click",()=>{p.heat.active=true;p.heat.currentDay=1;saveSettingsDebounced();renderHR();renderDash();});document.getElementById("lc-hr-sh")?.addEventListener("click",()=>{p.heat.active=false;p.heat.currentDay=0;p.heat.daysSinceLast=0;saveSettingsDebounced();renderHR();renderDash();});document.getElementById("lc-hr-su")?.addEventListener("click",()=>{p.heat.onSuppressants=!p.heat.onSuppressants;saveSettingsDebounced();renderHR();});document.getElementById("lc-hr-tr")?.addEventListener("click",()=>{p.rut.active=true;p.rut.currentDay=1;saveSettingsDebounced();renderHR();renderDash();});document.getElementById("lc-hr-sr")?.addEventListener("click",()=>{p.rut.active=false;p.rut.currentDay=0;p.rut.daysSinceLast=0;saveSettingsDebounced();renderHR();renderDash();});}

function renderPreg(){
    const s=extension_settings[extensionName],el=document.getElementById("lc-preg-panel"),sel=document.getElementById("lc-preg-char");if(!el||!sel)return;const p=s.characters[sel.value];if(!p?.pregnancy?.active){el.innerHTML='<div class="lc-info">Неактивна</div>';return;}const pm=new PregnancyManager(p),pr=p.pregnancy,pg=Math.round((pr.week/pr.maxWeeks)*100);
    el.innerHTML='<div class="lc-preg-header"><span class="lc-preg-week">Нед. '+pr.week+'/'+pr.maxWeeks+'</span><span class="lc-preg-trim">T'+pm.tri()+'</span></div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill preg" style="width:'+pg+'%"></div></div><div class="lc-info-row">~'+pm.size()+' · Плодов: '+pr.fetusCount+' ('+pr.fetusSexes.map(x=>x==="M"?"♂":"♀").join("")+') · Отец: '+(pr.father||'?')+'</div><div class="lc-info-row">Движения: '+pm.moves()+' · +'+pm.wg()+' кг</div><div class="lc-info-row">'+pm.symptoms().join(', ')+'</div>'+(pr.complications.length>0?'<div class="lc-info-row" style="color:#e87070">⚠️ '+pr.complications.join(', ')+'</div>':'');
    // Update config controls
    document.getElementById("lc-preg-fc").value=pr.fetusCount;
    document.getElementById("lc-preg-sexes").textContent=pr.fetusSexes.map(x=>x==="M"?"♂":"♀").join(" ");
    document.getElementById("lc-preg-comp-on").checked=pr.complicationsEnabled;
    let compH="";pr.complications.forEach((c,i)=>{compH+='<span class="lc-tag">'+c+' <button class="lc-btn lc-btn-sm lc-preg-comp-rm" data-i="'+i+'" style="padding:0 3px;font-size:8px">✕</button></span>';});document.getElementById("lc-preg-comp-list").innerHTML=compH;
    document.querySelectorAll(".lc-preg-comp-rm").forEach(b=>b.addEventListener("click",function(){pr.complications.splice(parseInt(this.dataset.i),1);saveSettingsDebounced();renderPreg();}));
}

function renderLabor(){
    const s=extension_settings[extensionName],el=document.getElementById("lc-labor-panel"),sel=document.getElementById("lc-labor-char");if(!el||!sel)return;const p=s.characters[sel.value];if(!p?.labor?.active){el.innerHTML='<div class="lc-info">Неактивны</div>';return;}const lm=new LaborManager(p);
    el.innerHTML='<div class="lc-labor-stage">'+LL[p.labor.stage]+' ('+p.labor.difficulty+')</div><div class="lc-info-row">Раскрытие: '+p.labor.dilation+'/10</div><div class="lc-sw-mini-progress"><div class="lc-sw-mini-fill labor" style="width:'+(p.labor.dilation*10)+'%"></div></div><div class="lc-labor-desc">'+lm.desc()+'</div>'+(p.labor.complications.length>0?'<div class="lc-info-row" style="color:#e87070">⚠️ '+p.labor.complications.join(', ')+'</div>':'');
    document.getElementById("lc-labor-diff").value=p.labor.difficulty;
    document.getElementById("lc-labor-comp-on").checked=p.labor.complicationsEnabled;
    let compH="";p.labor.complications.forEach((c,i)=>{compH+='<span class="lc-tag">'+c+' <button class="lc-btn lc-btn-sm lc-labor-comp-rm" data-i="'+i+'" style="padding:0 3px;font-size:8px">✕</button></span>';});document.getElementById("lc-labor-comp-list").innerHTML=compH;
    document.querySelectorAll(".lc-labor-comp-rm").forEach(b=>b.addEventListener("click",function(){p.labor.complications.splice(parseInt(this.dataset.i),1);saveSettingsDebounced();renderLabor();}));
}

function renderBabies(){const s=extension_settings[extensionName],el=document.getElementById("lc-baby-list"),sel=document.getElementById("lc-baby-parent");if(!el||!sel)return;const pN=sel.value,p=s.characters[pN];if(!p?.babies?.length){el.innerHTML='<div class="lc-empty">Нет детей</div>';return;}let h="";p.babies.forEach((b,i)=>{const bm=new BabyManager(b);const rl=RelationshipManager.getFor(b.name).filter(r=>r.char1===b.name);h+='<div class="lc-baby-card"><div class="lc-baby-header"><span class="lc-baby-name">'+(b.name||'#'+(i+1))+'</span><span class="lc-baby-sex">'+(b.sex==="M"?'♂':'♀')+(b.secondarySex?' · '+b.secondarySex:'')+'</span></div><div class="lc-baby-details"><div>'+bm.age()+' · '+b.state+' · Мать: '+b.mother+' · Отец: '+b.father+'</div>'+(rl.length>0?'<div>'+rl.map(r=>r.type+': '+r.char2).join(', ')+'</div>':'')+'</div><div class="lc-baby-actions"><button class="lc-btn lc-btn-sm lc-baby-edit" data-p="'+pN+'" data-i="'+i+'">✏️</button><button class="lc-btn lc-btn-sm lc-btn-danger lc-baby-del" data-p="'+pN+'" data-i="'+i+'">🗑️</button></div></div>';});el.innerHTML=h;el.querySelectorAll(".lc-baby-edit").forEach(b=>b.addEventListener("click",function(){const baby=s.characters[this.dataset.p]?.babies?.[parseInt(this.dataset.i)];if(baby)showBabyForm(this.dataset.p,baby.father,baby,parseInt(this.dataset.i));}));el.querySelectorAll(".lc-baby-del").forEach(b=>b.addEventListener("click",function(){if(confirm("Удалить?")){s.characters[this.dataset.p].babies.splice(parseInt(this.dataset.i),1);saveSettingsDebounced();renderBabies();}}));}

function renderProfiles(){
    const s=extension_settings[extensionName];
    const curEl=document.getElementById("lc-profile-current");
    if(curEl)curEl.textContent="Текущий: "+(s.currentChatId||"не определён")+" ("+Object.keys(s.characters).length+" перс.)";
    const listEl=document.getElementById("lc-profile-list");
    if(!listEl)return;
    const profiles=ChatProfileManager.listProfiles();
    if(profiles.length===0){listEl.innerHTML='<div class="lc-empty">Нет профилей</div>';return;}
    let h="";for(const p of profiles){const isCur=p.id===s.currentChatId;h+='<div class="lc-char-card'+(isCur?' active':'')+'"><div class="lc-char-card-header"><span class="lc-char-card-name">'+(isCur?'▶ ':'')+p.id+'</span><span class="lc-char-card-info">'+p.charCount+' перс. · '+p.date+'</span></div><div class="lc-char-card-actions">'+(isCur?'':'<button class="lc-btn lc-btn-sm lc-profile-load" data-id="'+p.id+'">📂</button>')+'<button class="lc-btn lc-btn-sm lc-btn-danger lc-profile-del" data-id="'+p.id+'">🗑️</button></div></div>';}
    listEl.innerHTML=h;
    listEl.querySelectorAll(".lc-profile-load").forEach(b=>b.addEventListener("click",function(){const prof=s.chatProfiles[this.dataset.id];if(prof){s.characters=JSON.parse(JSON.stringify(prof.characters||{}));s.relationships=JSON.parse(JSON.stringify(prof.relationships||[]));s.worldDate={...(prof.worldDate||defaultSettings.worldDate)};s.currentChatId=this.dataset.id;saveSettingsDebounced();rebuildUI();toastr.success("Профиль загружен!");}}));
    listEl.querySelectorAll(".lc-profile-del").forEach(b=>b.addEventListener("click",function(){if(confirm("Удалить профиль?")){ChatProfileManager.deleteProfile(this.dataset.id);renderProfiles();}}));
}

function renderDiceLog(){const s=extension_settings[extensionName],el=document.getElementById("lc-dice-log");if(!el)return;if(s.diceLog.length===0){el.innerHTML='<div class="lc-empty">Пусто</div>';return;}el.innerHTML=[...s.diceLog].reverse().slice(0,20).map(d=>'<div class="lc-dice-entry '+(d.result?'lc-dice-success':'lc-dice-fail')+'">'+d.ts+' 🎲'+d.roll+'/'+d.chance+'% '+(d.result?'✅':'❌')+' '+d.target+(d.auto?' <span class="lc-tag lc-tag-auto">авто</span>':'')+'</div>').join("");}

function renderIntimLog(){const s=extension_settings[extensionName],el=document.getElementById("lc-intim-log-list");if(!el)return;if(s.intimacyLog.length===0){el.innerHTML='<div class="lc-empty">Пусто</div>';return;}el.innerHTML=[...s.intimacyLog].reverse().slice(0,20).map(e=>'<div class="lc-intim-entry">'+e.ts+' '+(e.pa||[]).join('×')+' | '+e.type+'</div>').join("");}

function renderAU(){const s=extension_settings[extensionName],el=document.getElementById("lc-au-panel");if(!el)return;if(!s.modules.auOverlay||s.auPreset==="realism"){el.innerHTML="";return;}if(s.auPreset==="omegaverse"){const a=s.auSettings.omegaverse;el.innerHTML='<div class="lc-editor-grid"><div class="lc-editor-field"><label>Цикл течки</label><input type="number" id="lc-au-hc" class="lc-input" value="'+a.heatCycleLength+'"></div><div class="lc-editor-field"><label>Длит. течки</label><input type="number" id="lc-au-hd" class="lc-input" value="'+a.heatDuration+'"></div><div class="lc-editor-field"><label>Цикл гона</label><input type="number" id="lc-au-rc" class="lc-input" value="'+a.rutCycleLength+'"></div><div class="lc-editor-field"><label>Длит. гона</label><input type="number" id="lc-au-rd" class="lc-input" value="'+a.rutDuration+'"></div></div><label class="lc-checkbox"><input type="checkbox" id="lc-au-mpreg" '+(a.maleOmegaPregnancy?'checked':'')+'><span>М-берем.</span></label>';setTimeout(()=>{document.getElementById("lc-au-hc")?.addEventListener("change",function(){a.heatCycleLength=parseInt(this.value);saveSettingsDebounced();});document.getElementById("lc-au-hd")?.addEventListener("change",function(){a.heatDuration=parseInt(this.value);saveSettingsDebounced();});document.getElementById("lc-au-rc")?.addEventListener("change",function(){a.rutCycleLength=parseInt(this.value);saveSettingsDebounced();});document.getElementById("lc-au-rd")?.addEventListener("change",function(){a.rutDuration=parseInt(this.value);saveSettingsDebounced();});document.getElementById("lc-au-mpreg")?.addEventListener("change",function(){a.maleOmegaPregnancy=this.checked;saveSettingsDebounced();});},50);}}

// ==========================================
// CHAR EDITOR
// ==========================================

let editCh=null;
function openEd(n){const s=extension_settings[extensionName],p=s.characters[n];if(!p)return;editCh=n;document.getElementById("lc-char-editor")?.classList.remove("hidden");document.getElementById("lc-editor-title").textContent="✏️ "+n;document.getElementById("lc-edit-bio-sex").value=p.bioSex;document.getElementById("lc-edit-sec-sex").value=p.secondarySex||"";document.getElementById("lc-edit-race").value=p.race||"human";document.getElementById("lc-edit-contra").value=p.contraception;document.getElementById("lc-edit-eyes").value=p.eyeColor;document.getElementById("lc-edit-hair").value=p.hairColor;document.getElementById("lc-edit-diff").value=p.pregnancyDifficulty;document.getElementById("lc-edit-enabled").checked=p._enabled!==false;document.getElementById("lc-edit-cycle-on").checked=p.cycle?.enabled;document.getElementById("lc-edit-cycle-len").value=p.cycle?.baseLength||28;document.getElementById("lc-edit-mens-dur").value=p.cycle?.menstruationDuration||5;document.getElementById("lc-edit-irreg").value=p.cycle?.irregularity||2;}
function closeEd(){editCh=null;document.getElementById("lc-char-editor")?.classList.add("hidden");}
function saveEd(){if(!editCh)return;const s=extension_settings[extensionName],p=s.characters[editCh];if(!p)return;p.bioSex=document.getElementById("lc-edit-bio-sex").value;p._mB=true;p.secondarySex=document.getElementById("lc-edit-sec-sex").value||null;p._mS=true;p.race=document.getElementById("lc-edit-race").value;p._mR=true;p.contraception=document.getElementById("lc-edit-contra").value;p.eyeColor=document.getElementById("lc-edit-eyes").value;p._mE=!!p.eyeColor;p.hairColor=document.getElementById("lc-edit-hair").value;p._mH=!!p.hairColor;p.pregnancyDifficulty=document.getElementById("lc-edit-diff").value;p._enabled=document.getElementById("lc-edit-enabled").checked;p.cycle.enabled=document.getElementById("lc-edit-cycle-on").checked;p._mCyc=true;const l=parseInt(document.getElementById("lc-edit-cycle-len").value);if(l>=21&&l<=45){p.cycle.baseLength=l;p.cycle.length=l;}p.cycle.menstruationDuration=parseInt(document.getElementById("lc-edit-mens-dur").value)||5;p.cycle.irregularity=parseInt(document.getElementById("lc-edit-irreg").value)||2;saveSettingsDebounced();ChatProfileManager.save();closeEd();rebuildUI();toastr.success(editCh+": ОК!");}

// ==========================================
// BIND ALL EVENTS
// ==========================================

function bindAll(){
    const s=extension_settings[extensionName];
    document.getElementById("lifecycle-header-toggle")?.addEventListener("click",function(e){if(e.target.closest(".lc-switch"))return;s.panelCollapsed=!s.panelCollapsed;document.getElementById("lifecycle-panel")?.classList.toggle("collapsed",s.panelCollapsed);this.querySelector(".lc-collapse-arrow").textContent=s.panelCollapsed?"▶":"▼";saveSettingsDebounced();});
    document.getElementById("lc-enabled")?.addEventListener("change",function(){s.enabled=this.checked;saveSettingsDebounced();});
    document.querySelectorAll(".lifecycle-tab").forEach(t=>t.addEventListener("click",function(){document.querySelectorAll(".lifecycle-tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".lifecycle-tab-content").forEach(x=>x.classList.remove("active"));this.classList.add("active");document.querySelector('.lifecycle-tab-content[data-tab="'+this.dataset.tab+'"]')?.classList.add("active");rebuildUI();}));

    // Chars
    document.getElementById("lc-sync")?.addEventListener("click",()=>{syncChars();rebuildUI();toastr.success("Синхр.!");});
    document.getElementById("lc-add-m")?.addEventListener("click",()=>{const n=prompt("Имя:");if(!n?.trim())return;if(s.characters[n.trim()])return;s.characters[n.trim()]=makeProfile(n.trim(),false,"F");saveSettingsDebounced();rebuildUI();});
    document.getElementById("lc-reparse")?.addEventListener("click",()=>{syncChars();rebuildUI();toastr.success("Перечитано!");});
    document.getElementById("lc-char-list")?.addEventListener("click",function(e){const eb=e.target.closest(".lc-edit-char"),db=e.target.closest(".lc-del-char");if(eb)openEd(eb.dataset.char);if(db&&confirm("Удалить?")){delete s.characters[db.dataset.char];saveSettingsDebounced();rebuildUI();}});
    document.getElementById("lc-editor-save")?.addEventListener("click",saveEd);
    document.getElementById("lc-editor-cancel")?.addEventListener("click",closeEd);

    // Relationships
    document.getElementById("lc-rel-add")?.addEventListener("click",()=>{const c1=document.getElementById("lc-rel-c1")?.value,c2=document.getElementById("lc-rel-c2")?.value,tp=document.getElementById("lc-rel-tp")?.value;if(!c1||!c2||c1===c2)return;RelationshipManager.add(c1,c2,tp,document.getElementById("lc-rel-n")?.value);document.getElementById("lc-rel-n").value="";renderRels();});

    // Selects
    document.getElementById("lc-cycle-char")?.addEventListener("change",renderCycle);
    document.getElementById("lc-hr-char")?.addEventListener("change",renderHR);
    document.getElementById("lc-preg-char")?.addEventListener("change",renderPreg);
    document.getElementById("lc-labor-char")?.addEventListener("change",renderLabor);
    document.getElementById("lc-baby-parent")?.addEventListener("change",renderBabies);

    // CYCLE CONTROLS — manual day, phase jumps
    document.getElementById("lc-cycle-set-day")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-cycle-char")?.value];if(!p?.cycle?.enabled)return;const d=parseInt(document.getElementById("lc-cycle-day-input")?.value);if(d>=1&&d<=p.cycle.length){new CycleManager(p).setDay(d);saveSettingsDebounced();renderCycle();renderDash();}});
    document.getElementById("lc-cyc-mens")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-cycle-char")?.value];if(!p?.cycle?.enabled)return;new CycleManager(p).setToPhase("menstruation");saveSettingsDebounced();renderCycle();renderDash();});
    document.getElementById("lc-cyc-foll")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-cycle-char")?.value];if(!p?.cycle?.enabled)return;new CycleManager(p).setToPhase("follicular");saveSettingsDebounced();renderCycle();renderDash();});
    document.getElementById("lc-cyc-ovul")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-cycle-char")?.value];if(!p?.cycle?.enabled)return;new CycleManager(p).setToPhase("ovulation");saveSettingsDebounced();renderCycle();renderDash();});
    document.getElementById("lc-cyc-lut")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-cycle-char")?.value];if(!p?.cycle?.enabled)return;new CycleManager(p).setToPhase("luteal");saveSettingsDebounced();renderCycle();renderDash();});
    document.getElementById("lc-cyc-skip")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-cycle-char")?.value];if(!p?.cycle?.enabled)return;p.cycle.currentDay=1;p.cycle.cycleCount++;saveSettingsDebounced();renderCycle();renderDash();});

    // Intimacy
    document.getElementById("lc-intim-log")?.addEventListener("click",()=>{const t=document.getElementById("lc-intim-t")?.value;if(!t)return;IntimacyManager.log({pa:[t,document.getElementById("lc-intim-p")?.value].filter(Boolean),type:document.getElementById("lc-intim-tp")?.value,ejac:document.getElementById("lc-intim-ej")?.value});renderIntimLog();});
    document.getElementById("lc-intim-roll")?.addEventListener("click",()=>{const t=document.getElementById("lc-intim-t")?.value;if(!t)return;const r=IntimacyManager.roll(t,{pa:[t,document.getElementById("lc-intim-p")?.value].filter(Boolean),tp:document.getElementById("lc-intim-tp")?.value,ej:document.getElementById("lc-intim-ej")?.value});showDice(r,t,false);renderDiceLog();});

    // PREGNANCY controls
    document.getElementById("lc-preg-adv")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active)return;new PregnancyManager(p).advanceDay(7);saveSettingsDebounced();renderPreg();renderDash();});
    document.getElementById("lc-preg-set")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active)return;const w=prompt("Неделя:");if(w){p.pregnancy.week=clamp(parseInt(w),1,p.pregnancy.maxWeeks);saveSettingsDebounced();renderPreg();}});
    document.getElementById("lc-preg-to-labor")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active)return;new LaborManager(p).start(p.labor?.difficulty||"normal");saveSettingsDebounced();renderLabor();renderDash();toastr.warning("Роды!");});
    document.getElementById("lc-preg-end")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active||!confirm("Прервать?"))return;p.pregnancy.active=false;if(p.cycle)p.cycle.enabled=true;saveSettingsDebounced();renderPreg();renderDash();});
    document.getElementById("lc-preg-fc-set")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active)return;const c=parseInt(document.getElementById("lc-preg-fc")?.value)||1;p.pregnancy.fetusCount=clamp(c,1,6);while(p.pregnancy.fetusSexes.length<p.pregnancy.fetusCount)p.pregnancy.fetusSexes.push(Math.random()<0.5?"M":"F");p.pregnancy.fetusSexes=p.pregnancy.fetusSexes.slice(0,p.pregnancy.fetusCount);saveSettingsDebounced();renderPreg();});
    document.getElementById("lc-preg-sex-toggle")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active||!p.pregnancy.fetusSexes.length)return;p.pregnancy.fetusSexes[0]=p.pregnancy.fetusSexes[0]==="M"?"F":"M";saveSettingsDebounced();renderPreg();});
    document.getElementById("lc-preg-comp-add")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active)return;const pool=s.pregnancyComplications||[];if(pool.length===0)return;const comp=pool[Math.floor(Math.random()*pool.length)];if(!p.pregnancy.complications.includes(comp)){p.pregnancy.complications.push(comp);saveSettingsDebounced();renderPreg();}});
    document.getElementById("lc-preg-comp-clear")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-preg-char")?.value];if(!p?.pregnancy?.active)return;p.pregnancy.complications=[];saveSettingsDebounced();renderPreg();});
    document.getElementById("lc-preg-comp-on")?.addEventListener("change",function(){const p=s.characters[document.getElementById("lc-preg-char")?.value];if(p?.pregnancy)p.pregnancy.complicationsEnabled=this.checked;saveSettingsDebounced();});

    // LABOR controls
    document.getElementById("lc-labor-adv")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-labor-char")?.value];if(!p?.labor?.active)return;new LaborManager(p).advance();saveSettingsDebounced();renderLabor();});
    document.getElementById("lc-labor-deliver")?.addEventListener("click",()=>{const cn=document.getElementById("lc-labor-char")?.value;const p=s.characters[cn];if(!p?.labor?.active)return;showBabyForm(cn,p.pregnancy?.father||"?",null,null);});
    document.getElementById("lc-labor-end")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-labor-char")?.value];if(!p?.labor?.active||!confirm("Завершить?"))return;new LaborManager(p).end();saveSettingsDebounced();renderLabor();renderDash();});
    document.getElementById("lc-labor-diff")?.addEventListener("change",function(){const p=s.characters[document.getElementById("lc-labor-char")?.value];if(p?.labor)p.labor.difficulty=this.value;saveSettingsDebounced();renderLabor();});
    document.getElementById("lc-labor-comp-add")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-labor-char")?.value];if(!p?.labor?.active)return;const pool=s.laborComplications||[];if(pool.length===0)return;const comp=pool[Math.floor(Math.random()*pool.length)];if(!p.labor.complications.includes(comp)){p.labor.complications.push(comp);saveSettingsDebounced();renderLabor();}});
    document.getElementById("lc-labor-comp-clear")?.addEventListener("click",()=>{const p=s.characters[document.getElementById("lc-labor-char")?.value];if(!p?.labor?.active)return;p.labor.complications=[];saveSettingsDebounced();renderLabor();});
    document.getElementById("lc-labor-comp-on")?.addEventListener("change",function(){const p=s.characters[document.getElementById("lc-labor-char")?.value];if(p?.labor)p.labor.complicationsEnabled=this.checked;saveSettingsDebounced();});

    // BABY creator
    document.getElementById("lc-baby-create")?.addEventListener("click",()=>{showBabyForm(null,null,null,null,true);});

    // Profiles
    document.getElementById("lc-profile-save")?.addEventListener("click",()=>{ChatProfileManager.save();renderProfiles();toastr.success("Профиль сохранён!");});
    document.getElementById("lc-profile-reload")?.addEventListener("click",()=>{ChatProfileManager.load();rebuildUI();toastr.info("Профиль перезагружен!");});

    // Settings
    const chk={"lc-s-sync":"autoSyncCharacters","lc-s-parse":"autoParseCharInfo","lc-s-chat":"parseFullChat","lc-s-det":"autoDetectIntimacy","lc-s-roll":"autoRollOnSex","lc-s-wid":"showStatusWidget","lc-s-time":"autoTimeProgress"};
    for(const[id,key]of Object.entries(chk))document.getElementById(id)?.addEventListener("change",function(){s[key]=this.checked;saveSettingsDebounced();});
    const mod={"lc-mc":"cycle","lc-mp":"pregnancy","lc-ml":"labor","lc-mb":"baby","lc-mi":"intimacy"};
    for(const[id,key]of Object.entries(mod))document.getElementById(id)?.addEventListener("change",function(){s.modules[key]=this.checked;saveSettingsDebounced();});
    document.getElementById("lc-mau")?.addEventListener("change",function(){s.modules.auOverlay=this.checked;saveSettingsDebounced();renderAU();});
    document.getElementById("lc-pon")?.addEventListener("change",function(){s.promptInjectionEnabled=this.checked;saveSettingsDebounced();});
    document.getElementById("lc-ppos")?.addEventListener("change",function(){s.promptInjectionPosition=this.value;saveSettingsDebounced();});
    document.getElementById("lc-pdet")?.addEventListener("change",function(){s.promptInjectionDetail=this.value;saveSettingsDebounced();});
    document.getElementById("lc-aup")?.addEventListener("change",function(){s.auPreset=this.value;saveSettingsDebounced();renderAU();});
    document.getElementById("lc-da")?.addEventListener("click",()=>{s.worldDate.year=parseInt(document.getElementById("lc-dy")?.value)||2025;s.worldDate.month=clamp(parseInt(document.getElementById("lc-dm")?.value)||1,1,12);s.worldDate.day=clamp(parseInt(document.getElementById("lc-dd")?.value)||1,1,31);s.worldDate.hour=clamp(parseInt(document.getElementById("lc-dh")?.value)||12,0,23);s.worldDate.minute=clamp(parseInt(document.getElementById("lc-dmin")?.value)||0,0,59);saveSettingsDebounced();renderDash();});
    document.getElementById("lc-d1")?.addEventListener("click",()=>{EnhancedTimeParser.apply({days:1});rebuildUI();});
    document.getElementById("lc-d7")?.addEventListener("click",()=>{EnhancedTimeParser.apply({days:7});rebuildUI();});
    document.getElementById("lc-df")?.addEventListener("change",function(){s.worldDate.frozen=this.checked;saveSettingsDebounced();});
    document.getElementById("lc-exp")?.addEventListener("click",()=>downloadJSON(s,"lifecycle_"+Date.now()+".json"));
    document.getElementById("lc-imp")?.addEventListener("click",()=>uploadJSON(d=>{extension_settings[extensionName]=deepMerge(defaultSettings,d);saveSettingsDebounced();document.getElementById("lifecycle-panel")?.remove();init();}));
    document.getElementById("lc-rst")?.addEventListener("click",()=>{if(!confirm("СБРОС?"))return;extension_settings[extensionName]=JSON.parse(JSON.stringify(defaultSettings));saveSettingsDebounced();document.getElementById("lifecycle-panel")?.remove();init();});
}

// ==========================================
// MESSAGE HOOKS
// ==========================================

function onMsg(idx){const s=extension_settings[extensionName];if(!s.enabled)return;const ctx=getContext();if(!ctx?.chat||idx<0)return;const msg=ctx.chat[idx];if(!msg?.mes||msg.is_user)return;const text=msg.mes;if(s.autoSyncCharacters)syncChars();if(s.autoTimeProgress&&!s.worldDate.frozen){const p=EnhancedTimeParser.parse(text);if(p){if(s.timeParserConfirmation){if(confirm("LifeCycle: "+EnhancedTimeParser.formatDesc(p))){EnhancedTimeParser.apply(p);rebuildUI();}}else{EnhancedTimeParser.apply(p);rebuildUI();}}}if(s.autoDetectIntimacy&&s.modules.intimacy){const det=IntimacyDetector.detect(text,s.characters);if(det?.detected){IntimacyManager.log({pa:det.pa,type:det.tp,ejac:det.ej,auto:true});if(s.autoRollOnSex&&det.tg&&det.tp==="vaginal"&&(det.ej==="inside"||det.ej==="unknown")){const r=IntimacyManager.roll(det.tg,{pa:det.pa,tp:det.tp,ej:det.ej,co:det.co,nc:det.nc,auto:true});showDice(r,det.tg,true);}}}if(s.showStatusWidget)StatusWidget.inject(idx);renderDash();}

// ==========================================
// INIT
// ==========================================

async function init(){
    if(!extension_settings[extensionName])extension_settings[extensionName]=JSON.parse(JSON.stringify(defaultSettings));
    else extension_settings[extensionName]=deepMerge(JSON.parse(JSON.stringify(defaultSettings)),extension_settings[extensionName]);
    document.getElementById("lifecycle-panel")?.remove();
    const target=document.getElementById("extensions_settings2")||document.getElementById("extensions_settings");
    if(target)target.insertAdjacentHTML("beforeend",generateHTML());
    // Load per-chat profile
    ChatProfileManager.load();
    syncChars();bindAll();rebuildUI();renderAU();
    if(eventSource){
        eventSource.on(event_types.MESSAGE_RECEIVED,onMsg);
        eventSource.on(event_types.CHAT_CHANGED,()=>{ChatProfileManager.load();syncChars();rebuildUI();});
        eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS,(d)=>{const s=extension_settings[extensionName];if(!s.enabled||!s.promptInjectionEnabled)return;const inj=PromptInjector.gen();if(!inj)return;if(s.promptInjectionPosition==="system"&&d.systemPrompt!==undefined)d.systemPrompt+="\n\n"+inj;else if(s.promptInjectionPosition==="authornote")d.authorNote=(d.authorNote||"")+"\n\n"+inj;else if(d.chat&&Array.isArray(d.chat))d.chat.push({role:"system",content:inj});});
    }
    console.log("[LifeCycle v0.7.0] Loaded!");
}

jQuery(async()=>{await init();});

window.LifeCycle={getSettings:()=>extension_settings[extensionName],sync:syncChars,advanceTime:d=>{EnhancedTimeParser.apply({days:d});rebuildUI();},rollDice:(c,d)=>IntimacyManager.roll(c,d),addRelationship:(a,b,t,n)=>RelationshipManager.add(a,b,t,n),getRelationships:n=>RelationshipManager.getFor(n)};
