/**
 * BunnyCycle v3.0 — Менеджер профилей и синхронизация персонажей
 */

import { getContext } from '/scripts/extensions.js';
import { getSettings, saveSettings, makeProfile, ensureProfileFields } from './stateManager.js';
import { LLM } from '../utils/llmCaller.js';

// Имена, которые нужно игнорировать при синхронизации
const SYSTEM_NAMES = new Set([
    'system', 'System', 'SillyTavern', 'sillytavern',
    'Narrator', 'narrator', 'Рассказчик', 'рассказчик',
    'Example', 'example', 'Пример', 'пример',
]);

// ========================
// СИНХРОНИЗАЦИЯ
// ========================
export async function syncCharacters() {
    const s = getSettings();
    try {
        const ctx = getContext();
        if (!ctx) return;

        const charNames = new Set();

        // Персонаж карточки
        if (ctx.name2 && !SYSTEM_NAMES.has(ctx.name2)) charNames.add(ctx.name2);

        // Юзер — только если имя задано и не системное
        if (ctx.name1 && !SYSTEM_NAMES.has(ctx.name1) && ctx.name1 !== 'You') {
            charNames.add(ctx.name1);
        }

        // Групповые персонажи
        if (ctx.groups) {
            const group = ctx.groups.find(g => g.id === ctx.groupId);
            if (group?.members) {
                for (const m of group.members) {
                    const ch = ctx.characters?.find(c => c.avatar === m);
                    if (ch?.name && !SYSTEM_NAMES.has(ch.name)) charNames.add(ch.name);
                }
            }
        }

        // Создаём отсутствующих — БЕЗ дефолтного пола, ставим null чтобы определить позже
        for (const name of charNames) {
            if (!s.characters[name]) {
                const isUser = name === ctx.name1;
                s.characters[name] = makeProfile(name, isUser, null); // пол определим из карточки
            }
            ensureProfileFields(s.characters[name]);
        }

        // Парсинг карточек
        if (s.autoParseCharInfo) {
            await parseCharacterCards(ctx, charNames);
        }

        // Сохраняем текущий чат и автосохраняем профиль
        const oldChatId = s.currentChatId;
        s.currentChatId = ctx.chatId || null;

        // Автосохранение профиля при переключении чата
        if (s.currentChatId) {
            autoSaveProfile();
        }

        // Детекция NPC из контекста чата
        try {
            const chat = ctx.chat || [];
            const lastMessages = chat.slice(-20);
            const knownNames = new Set(Object.keys(s.characters));
            
            for (const msg of lastMessages) {
                if (!msg?.mes) continue;
                // Извлекаем имена из формата "Имя:" в начале строк бота
                if (msg.is_user === false && msg.name && !SYSTEM_NAMES.has(msg.name) && !knownNames.has(msg.name)) {
                    // Бот может писать от имени NPC
                }
                
                // Ищем NPC имена в тексте (формат **Имя** говорит:, или "Имя:" в начале строки)
                const npcPatterns = [
                    /\*\*([А-ЯЁA-Z][а-яёa-z]{2,}(?:\s[А-ЯЁA-Z][а-яёa-z]+)?)\*\*\s*(?:—|:|говорит|сказал|прошептал|крикнул)/g,
                    /^([А-ЯЁA-Z][а-яёa-z]{2,}(?:\s[А-ЯЁA-Z][а-яёa-z]+)?)\s*:\s/gm,
                ];
                
                for (const pattern of npcPatterns) {
                    let match;
                    while ((match = pattern.exec(msg.mes)) !== null) {
                        const npcName = match[1].trim();
                        if (npcName.length >= 2 && npcName.length <= 30 && 
                            !SYSTEM_NAMES.has(npcName) && !knownNames.has(npcName)) {
                            // Создаём NPC
                            s.characters[npcName] = makeProfile(npcName, false, null);
                            s.characters[npcName]._isNPC = true;
                            knownNames.add(npcName);
                            console.log(`[BunnyCycle] NPC обнаружен из чата: ${npcName}`);
                        }
                    }
                }
            }
        } catch (npcErr) {
            console.warn('[BunnyCycle] NPC detection error:', npcErr);
        }

        saveSettings();
    } catch (err) {
        console.warn('[BunnyCycle] Sync error:', err);
    }
}

// ========================
// ПАРСИНГ КАРТОЧЕК
// ========================
async function parseCharacterCards(ctx, charNames) {
    const s = getSettings();

    for (const name of charNames) {
        const profile = s.characters[name];
        if (!profile) continue;

        // Ищем карточку
        let cardText = "";
        const ch = ctx.characters?.find(c => c.name === name);
        if (ch) {
            cardText = [ch.description, ch.personality, ch.scenario, ch.mes_example].filter(Boolean).join('\n');
        }

        if (!cardText) continue;

        const missingFieldCount = [
            !profile.bioSex,
            !profile.secondarySex,
            !profile.age,
            !profile.eyeColor,
            !profile.hairColor,
            (!profile.race || profile.race === "human")
        ].filter(Boolean).length;

        if (s.useLLMParsing && missingFieldCount >= 2 && cardText.length > 80) {
            const llmData = await extractCharacterInfoWithLLM(name, cardText);
            if (llmData) {
                if (!profile._mB && llmData.bioSex && (!profile.bioSex || profile._sexConfidence < 3)) {
                    profile.bioSex = llmData.bioSex;
                    profile._sexSource = "llm_card";
                    profile._sexConfidence = 3;
                    if (llmData.bioSex === "M") profile.cycle.enabled = false;
                }
                if (!profile._mS && llmData.secondarySex && !profile.secondarySex) profile.secondarySex = llmData.secondarySex;
                if (!profile._mR && llmData.race && (!profile.race || profile.race === "human")) profile.race = llmData.race;
                if (!profile._mE && llmData.eyeColor && !profile.eyeColor) profile.eyeColor = llmData.eyeColor;
                if (!profile._mH && llmData.hairColor && !profile.hairColor) profile.hairColor = llmData.hairColor;
                if (llmData.age && !profile.age) profile.age = llmData.age;
            }
        }

        // Парсинг пола из текста — только если не было ручной правки и уверенность низкая
        if (!profile._mB && profile._sexConfidence < 3) {
            const sex = guessSex(cardText, name);
            if (sex.confidence > profile._sexConfidence) {
                profile.bioSex = sex.value;
                profile._sexSource = sex.source;
                profile._sexConfidence = sex.confidence;
                if (sex.value === "M") {
                    profile.cycle.enabled = false;
                }
            }
        }

        if (!profile._mR && (!profile.race || profile.race === "human")) {
            const race = guessRace(cardText);
            if (race) profile.race = race;
        }

        if (!profile._mE && !profile.eyeColor) {
            const eyes = guessColor(cardText, "глаз");
            if (eyes) profile.eyeColor = eyes;
        }
        if (!profile._mH && !profile.hairColor) {
            const hair = guessColor(cardText, "волос");
            if (hair) profile.hairColor = hair;
        }

        if (!profile._mS && s.modules.auOverlay && s.auPreset === "omegaverse") {
            const sec = guessSecondarySex(cardText);
            if (sec) profile.secondarySex = sec;
        }

        if (!profile.age) {
            const age = guessAge(cardText);
            if (age) profile.age = age;
        }
    }
}

// ========================
// ЭВРИСТИКИ
// ========================
function guessSex(text, name) {
    const lower = text.toLowerCase();

    if (/(?:female\s+omega|omega\s+female|женщина-омега|девушка-омега)/i.test(text)) {
        return { value: 'F', confidence: 3, source: 'abo-card' };
    }
    if (/(?:male\s+omega|omega\s+male|male\s+alpha|alpha\s+male|мужчина-омега|парень-омега|мужчина-альфа|парень-альфа)/i.test(text)) {
        return { value: 'M', confidence: 3, source: 'abo-card' };
    }

    // Прямые указания (высокая уверенность)
    // Мужские — без \b для кириллицы!
    const maleStrong = /(?:мужчина|парень|мужской|мальчик|юноша|принц|король|лорд|\bmale\b|\bboy\b|\bman\b|\blord\b|\bprince\b|\bking\b|\bhe is\b)/i;
    // Женские
    const femaleStrong = /(?:женщина|девушка|женский|девочка|принцесса|королева|леди|\bfemale\b|\bgirl\b|\bwoman\b|\blady\b|\bprincess\b|\bqueen\b|\bshe is\b)/i;

    if (maleStrong.test(text)) {
        return { value: 'M', confidence: 2, source: 'card-keywords' };
    }
    if (femaleStrong.test(text)) {
        return { value: 'F', confidence: 2, source: 'card-keywords' };
    }

    // Местоимения (he/him/his vs she/her/hers) — английские более надёжны
    const heCountEn = (lower.match(/\bhe\b|\bhis\b|\bhim\b/g) || []).length;
    const sheCountEn = (lower.match(/\bshe\b|\bher\b|\bhers\b/g) || []).length;

    // Русские местоимения
    const heCountRu = (lower.match(/\bон\b|\bего\b|\bему\b|\bнего\b|\bним\b/g) || []).length;
    const sheCountRu = (lower.match(/\bона\b|\bеё\b|\bей\b|\bнеё\b|\bней\b/g) || []).length;

    const heCount = heCountEn + heCountRu;
    const sheCount = sheCountEn + sheCountRu;

    if (heCount > sheCount + 2) return { value: 'M', confidence: 1, source: 'pronouns' };
    if (sheCount > heCount + 2) return { value: 'F', confidence: 1, source: 'pronouns' };

    // НЕ ЗНАЕМ — возвращаем null (вместо дефолта F!)
    return { value: null, confidence: 0, source: 'unknown' };
}

function guessRace(text) {
    // НЕ используем \b для кириллицы — он не работает с Unicode!
    const races = [
        { pattern: /(?:эльф|эльфийк|эльфийск|эльфов|elf|elven|half-elf|полуэльф)/i, value: 'elf' },
        { pattern: /(?:дварф|гном|dwarf|dwarven)/i, value: 'dwarf' },
        { pattern: /(?:орк|orc|orcish|полуорк|half-orc)/i, value: 'orc' },
        { pattern: /(?:демон|demon|суккуб|инкуб|succub|incub|дьявол|devil)/i, value: 'demon' },
        { pattern: /(?:вампир|vampire|vampiric|носферату)/i, value: 'vampire' },
        { pattern: /(?:оборотень|werewolf|ликантроп|lycanthrop|волколак)/i, value: 'werewolf' },
        { pattern: /(?:фея|fairy|фэйри|fae|пикси|pixie)/i, value: 'fairy' },
        { pattern: /(?:дракон|dragon|dragonborn|драконид)/i, value: 'dragon' },
        { pattern: /(?:полурослик|halfling|хоббит|hobbit|gnome)/i, value: 'halfling' },
        { pattern: /(?:кошко|neko|неко|кемономими|catgirl|catboy|кицунэ|kitsune)/i, value: 'neko' },
        { pattern: /(?:ангел|angel|серафим|seraph|архангел)/i, value: 'angel' },
        { pattern: /(?:тифлинг|tiefling)/i, value: 'tiefling' },
        { pattern: /(?:русалк|mermaid|сирен|siren)/i, value: 'mermaid' },
        { pattern: /(?:зверолюд|kemono|антро|anthro|furry)/i, value: 'beastkin' },
    ];
    for (const r of races) {
        if (r.pattern.test(text)) return r.value;
    }
    return null;
}

function guessColor(text, target) {
    const targetWord = target === 'глаз' ? '(?:глаз(?:а)?|eye(?:s)?)' : '(?:волос(?:ы)?|hair)';
    const colorWord = '(?:черн(?:ые|ый|ая|ое)?|black|бел(?:ые|ый|ая|ое)?|white|голуб(?:ые|ой|ая)?|blue|син(?:ие|ий|яя)?|green|зел[её]н(?:ые|ый|ая)?|кар(?:ие|ий|яя)?|brown|amber|янтарн(?:ые|ый|ая)?|gray|grey|сер(?:ые|ый|ая)?|silver|серебрист(?:ые|ый|ая)?|blond|blonde|блонд(?:ин|инка)?|светл(?:ые|ый|ая)?|рус(?:ые|ый|ая)?|рыж(?:ие|ий|ая)?|red|красн(?:ые|ый|ая)?|pink|розов(?:ые|ый|ая)?|purple|фиолетов(?:ые|ый|ая)?|gold(?:en)?|золотист(?:ые|ый|ая)?)';
    const patterns = [
        new RegExp(`(${colorWord}(?:\\s+${colorWord})?)\\s+${targetWord}`, 'i'),
        new RegExp(`${targetWord}[^\\n\\.,;]{0,24}?(${colorWord}(?:\\s+${colorWord})?)`, 'i'),
        new RegExp(`${targetWord}\\s*[:—–-]\\s*([^,\\.\\n]+)`, 'i'),
        new RegExp(`цвет\\s+${targetWord}\\s*[:—–-]\\s*([^,\\.\\n]+)`, 'i'),
    ];
    for (const re of patterns) {
        const match = text.match(re);
        if (match) {
            const val = (match[1] || '').trim().replace(/["'`]/g, '');
            if (val && val.length > 1 && val.length < 30 && !/^[(\[{<]/.test(val)) return val.split(/\s+/).slice(0, 2).join(' ');
        }
    }
    return null;
}

function guessSecondarySex(text) {
    const lower = text.toLowerCase();
    if (/(?:альфа|alpha|a\/b\/o\s*alpha)/i.test(lower)) return 'alpha';
    if (/(?:омега|omega|a\/b\/o\s*omega)/i.test(lower)) return 'omega';
    if (/(?:бета|beta|a\/b\/o\s*beta)/i.test(lower)) return 'beta';
    if (/(?:secondary\s+gender|designation|dynamic)\s*[:—–-]?\s*alpha/i.test(lower)) return 'alpha';
    if (/(?:secondary\s+gender|designation|dynamic)\s*[:—–-]?\s*omega/i.test(lower)) return 'omega';
    if (/(?:secondary\s+gender|designation|dynamic)\s*[:—–-]?\s*beta/i.test(lower)) return 'beta';
    return null;
}


function guessAge(text) {
    const patterns = [
        /(?:возраст|age)\s*[:—–-]?\s*(\d{1,3})/i,
        /(\d{1,3})\s*(?:лет|года|год|years? old)/i,
        /(\d{1,3})\s*(?:y\/o|yo)\b/i,
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (m) {
            const age = parseInt(m[1], 10);
            if (age >= 1 && age <= 999) return age;
        }
    }
    return null;
}

async function extractCharacterInfoWithLLM(name, cardText) {
    try {
        const systemPrompt = 'Extract structured roleplay character profile data. Return ONLY valid JSON and infer values only when strongly supported by the card.';
        const userPrompt = `Character name: ${name}\n\nExtract these fields if they are explicitly stated or strongly implied:\n- bioSex: M/F/null\n- secondarySex: alpha/beta/omega/null\n- race: one short word in english lowercase or null\n- age: number or null\n- eyeColor: short string or null\n- hairColor: short string or null\n\nReturn JSON exactly like:\n{"bioSex":null,"secondarySex":null,"race":null,"age":null,"eyeColor":null,"hairColor":null}\n\nCard:\n${cardText}`;
        const response = await LLM.call(systemPrompt, userPrompt);
        const data = LLM.parseJSON(response);
        return data || null;
    } catch {
        return null;
    }
}

// ========================
// АВТОСОХРАНЕНИЕ/ЗАГРУЗКА ПРОФИЛЯ ПО ЧАТУ
// ========================
function autoSaveProfile() {
    const s = getSettings();
    if (!s.currentChatId) return;
    if (!s.chatProfiles) s.chatProfiles = {};
    
    // Не сохраняем пустые профили
    if (Object.keys(s.characters).length === 0) return;
    
    s.chatProfiles[s.currentChatId] = {
        characters: JSON.parse(JSON.stringify(s.characters)),
        relationships: JSON.parse(JSON.stringify(s.relationships || [])),
        worldDate: JSON.parse(JSON.stringify(s.worldDate))
    };
}

export const ProfileManager = {
    save() {
        autoSaveProfile();
        saveSettings();
    },

    load() {
        const s = getSettings();
        try {
            const ctx = getContext();
            if (!ctx?.chatId) return;
            
            // Автосохраняем текущий профиль перед загрузкой нового
            if (s.currentChatId && s.currentChatId !== ctx.chatId) {
                autoSaveProfile();
            }
            
            if (s.chatProfiles?.[ctx.chatId]) {
                const pr = s.chatProfiles[ctx.chatId];
                s.characters = JSON.parse(JSON.stringify(pr.characters || {}));
                s.relationships = JSON.parse(JSON.stringify(pr.relationships || []));
                if (pr.worldDate) s.worldDate = JSON.parse(JSON.stringify(pr.worldDate));
            } else {
                // Новый чат — чистые данные
                s.characters = {};
                s.relationships = [];
            }
            s.currentChatId = ctx.chatId;
            saveSettings();
        } catch (e) {
            console.warn('[BunnyCycle] Profile load error:', e);
        }
    },

    list() {
        const s = getSettings();
        return Object.keys(s.chatProfiles || {}).map(id => ({
            id,
            count: Object.keys(s.chatProfiles[id].characters || {}).length,
            isCurrent: id === s.currentChatId
        }));
    },

    del(id) {
        const s = getSettings();
        if (s.chatProfiles?.[id]) delete s.chatProfiles[id];
        saveSettings();
    }
};
