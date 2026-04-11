/**
 * BunnyCycle v3.0 — Менеджер профилей и синхронизация персонажей
 */

import { getContext } from '../../../../extensions.js';
import { getSettings, saveSettings, makeProfile, ensureProfileFields } from './stateManager.js';
import { LLM } from '../utils/llmCaller.js';

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
        if (ctx.name2) charNames.add(ctx.name2);

        // Юзер
        if (ctx.name1) charNames.add(ctx.name1);

        // Групповые персонажи
        if (ctx.groups) {
            const group = ctx.groups.find(g => g.id === ctx.groupId);
            if (group?.members) {
                for (const m of group.members) {
                    const ch = ctx.characters?.find(c => c.avatar === m);
                    if (ch?.name) charNames.add(ch.name);
                }
            }
        }

        // Создаём отсутствующих
        for (const name of charNames) {
            if (!s.characters[name]) {
                const isUser = name === ctx.name1;
                s.characters[name] = makeProfile(name, isUser, 'F');
            }
            ensureProfileFields(s.characters[name]);
        }

        // Парсинг карточек
        if (s.autoParseCharInfo) {
            await parseCharacterCards(ctx, charNames);
        }

        // Сохраняем текущий чат
        s.currentChatId = ctx.chatId || null;

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

        // Парсинг пола из текста
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

        // Парсинг расы
        if (!profile._mR && profile.race === 'human') {
            const race = guessRace(cardText);
            if (race) profile.race = race;
        }

        // Парсинг глаз/волос
        if (!profile._mE) {
            const eyes = guessColor(cardText, 'глаз');
            if (eyes) profile.eyeColor = eyes;
        }
        if (!profile._mH) {
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

    // Прямые указания
    if (/(?:^|\s)(?:он|мужчина|парень|мужской|мальчик|male|boy|man|he\b)/i.test(lower)) {
        return { value: 'M', confidence: 2, source: 'card-keywords' };
    }
    if (/(?:^|\s)(?:она|женщина|девушка|женский|девочка|female|girl|woman|she\b)/i.test(lower)) {
        return { value: 'F', confidence: 2, source: 'card-keywords' };
    }

    // Местоимения
    const heCount = (lower.match(/\bон\b|\bего\b|\bему\b/g) || []).length;
    const sheCount = (lower.match(/\bона\b|\bеё\b|\bей\b/g) || []).length;

    if (heCount > sheCount + 3) return { value: 'M', confidence: 1, source: 'pronouns' };
    if (sheCount > heCount + 3) return { value: 'F', confidence: 1, source: 'pronouns' };

    return { value: 'F', confidence: 0, source: 'default' };
}

function guessRace(text) {
    const lower = text.toLowerCase();
    const races = [
        { pattern: /эльф|elf/i, value: 'elf' },
        { pattern: /дварф|гном|dwarf/i, value: 'dwarf' },
        { pattern: /орк|orc/i, value: 'orc' },
        { pattern: /демон|demon|суккуб|инкуб/i, value: 'demon' },
        { pattern: /вампир|vampire/i, value: 'vampire' },
        { pattern: /оборотень|werewolf|ликантроп/i, value: 'werewolf' },
        { pattern: /фея|fairy|фэйри/i, value: 'fairy' },
        { pattern: /дракон|dragon/i, value: 'dragon' },
        { pattern: /полурослик|halfling|хоббит/i, value: 'halfling' },
    ];
    for (const r of races) {
        if (r.pattern.test(lower)) return r.value;
    }
    return null;
}

function guessColor(text, target) {
    const re = new RegExp(`(\\S+)\\s+${target}`, 'i');
    const match = text.match(re);
    return match ? match[1] : null;
}

function guessSecondarySex(text) {
    const lower = text.toLowerCase();
    if (/альфа|alpha/i.test(lower)) return 'alpha';
    if (/омега|omega/i.test(lower)) return 'omega';
    if (/бета|beta/i.test(lower)) return 'beta';
    return null;
}

// ========================
// ПРОФИЛИ (сохранение/загрузка по чату)
// ========================
export const ProfileManager = {
    save() {
        const s = getSettings();
        if (!s.currentChatId) return;
        if (!s.chatProfiles) s.chatProfiles = {};
        s.chatProfiles[s.currentChatId] = {
            characters: JSON.parse(JSON.stringify(s.characters)),
            relationships: JSON.parse(JSON.stringify(s.relationships || [])),
            worldDate: JSON.parse(JSON.stringify(s.worldDate))
        };
        saveSettings();
    },

    load() {
        const s = getSettings();
        try {
            const ctx = getContext();
            if (ctx?.chatId && s.chatProfiles?.[ctx.chatId]) {
                const pr = s.chatProfiles[ctx.chatId];
                s.characters = JSON.parse(JSON.stringify(pr.characters || {}));
                s.relationships = JSON.parse(JSON.stringify(pr.relationships || []));
                if (pr.worldDate) s.worldDate = JSON.parse(JSON.stringify(pr.worldDate));
                s.currentChatId = ctx.chatId;
            }
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
