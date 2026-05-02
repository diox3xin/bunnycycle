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
        let cardText = '';
        const ch = ctx.characters?.find(c => c.name === name);
        if (ch) {
            cardText = [ch.description, ch.personality, ch.scenario, ch.mes_example].filter(Boolean).join('\n');
        }

        if (!cardText) continue;

        // Парсинг пола из текста — только если не было ручной правки и уверенность низкая
        if (!profile._mB && profile._sexConfidence < 3) {
            const sex = guessSex(cardText, name);
            if (sex.confidence > profile._sexConfidence) {
                profile.bioSex = sex.value;
                profile._sexSource = sex.source;
                profile._sexConfidence = sex.confidence;
                if (sex.value === 'M') {
                    profile.cycle.enabled = false;
                }
            }
        }

        // Парсинг расы — только если не было ручной правки И раса ещё дефолтная (null или human)
        if (!profile._mR && (!profile.race || profile.race === 'human')) {
            const race = guessRace(cardText);
            if (race) profile.race = race;
        }

        // Парсинг глаз/волос — только если не было ручной правки И поле пустое
        if (!profile._mE && !profile.eyeColor) {
            const eyes = guessColor(cardText, 'глаз');
            if (eyes) profile.eyeColor = eyes;
        }
        if (!profile._mH && !profile.hairColor) {
            const hair = guessColor(cardText, 'волос');
            if (hair) profile.hairColor = hair;
        }

        // Парсинг вторичного пола (омегаверс)
        if (!profile._mS && s.modules.auOverlay && s.auPreset === 'omegaverse') {
            const sec = guessSecondarySex(cardText);
            if (sec) profile.secondarySex = sec;
        }
    }
}

// ========================
// ЭВРИСТИКИ
// ========================
function guessSex(text, name) {
    const lower = text.toLowerCase();

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
    const patterns = [
        new RegExp(`(\\S+)\\s+${target}`, 'i'),
        new RegExp(`${target}\\s*[:—–-]\\s*(\\S+)`, 'i'),
        new RegExp(`цвет\\s+${target}\\s*[:—–-]\\s*([^,\\.\\n]+)`, 'i'),
        new RegExp(`${target === 'глаз' ? '(?:eyes?|глаз)' : '(?:hair|волос)'}\\s*[:—–-]\\s*([^,\\.\\n]+)`, 'i'),
        new RegExp(`(\\S+)\\s+${target === 'глаз' ? 'eyes?' : 'hair'}`, 'i'),
        new RegExp(`${target === 'глаз' ? 'eye' : 'hair'}\\s*color\\s*[:—–-]\\s*([^,\\.\\n]+)`, 'i'),
        new RegExp(`с\\s+(\\S+(?:ми|ыми|ими))\\s+${target}`, 'i'),
    ];
    for (const re of patterns) {
        const match = text.match(re);
        if (match) {
            const val = (match[1] || '').trim();
            // Фильтруем мусор
            if (val && val.length > 1 && val.length < 30 && !/^[(\[{<]/.test(val)) return val;
        }
    }
    return null;
}

function guessSecondarySex(text) {
    const lower = text.toLowerCase();
    if (/\b(?:альфа|alpha)\b/i.test(lower)) return 'alpha';
    if (/\b(?:омега|omega)\b/i.test(lower)) return 'omega';
    if (/\b(?:бета|beta)\b/i.test(lower)) return 'beta';
    return null;
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
