/**
 * BunnyCycle v3.0 — Генератор промпта и парсер тегов ответа
 */

import { getSettings, canGetPregnant } from './stateManager.js';
import { CycleEngine } from './cycleEngine.js';
import { PregnancyEngine } from './pregnancyEngine.js';
import { LaborEngine } from './laborEngine.js';
import { HealthSystem } from './healthSystem.js';
import { HeatRutEngine, BondEngine, OviEngine } from './auEngine.js';
import { BabyManager } from './babyManager.js';
import { RelationshipManager } from './relationshipManager.js';
import { formatDate } from '../utils/helpers.js';

// ========================
// ГЕНЕРАЦИЯ ПРОМПТА
// ========================
export function generatePrompt() {
    const s = getSettings();
    if (!s.enabled || !s.promptInjectionEnabled) return '';

    const parts = [];

    parts.push('[BunnyCycle — Система состояний персонажей]');
    parts.push(`Дата мира: ${formatDate(s.worldDate)}${s.worldDate.frozen ? ' ❄ ЗАМОРОЖЕНО' : ''}`);

    // --- Персонажи ---
    const chars = s.characters;
    for (const name of Object.keys(chars)) {
        const p = chars[name];
        if (!p._enabled) continue;

        const charParts = [`\n━━━ ${name} (${p.bioSex === 'M' ? 'М' : 'Ж'}${p.secondarySex ? '/' + p.secondarySex : ''}, ${p.race}) ━━━`];

        // Цикл
        if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
            const ce = new CycleEngine(p);
            const cd = ce.toPromptData();
            charParts.push(`Цикл: день ${cd.day}/${cd.length}, фаза: ${cd.phase}, фертильность: ${cd.fertility}%`);
            charParts.push(`Либидо: ${cd.libido}. Выделения: ${cd.discharge}`);
            if (cd.symptoms.length) charParts.push(`Симптомы: ${cd.symptoms.join(', ')}`);
        }

        // Беременность
        if (s.modules.pregnancy && p.pregnancy?.active) {
            const pe = new PregnancyEngine(p);
            const pd = pe.toPromptData();
            charParts.push(`🤰 БЕРЕМЕННА: ${pd.week} нед. из ${pd.maxWeeks} (${pe.trimesterLabel})`);
            charParts.push(`Размер плода: ${pd.size}. Живот: ${pd.belly}. Плодов: ${pd.fetusCount}`);
            charParts.push(`Шевеления: ${pd.movements}. Вес набран: ~${pe.weightGainEstimate} кг`);
            if (pd.symptoms.length) charParts.push(`Симптомы: ${pd.symptoms.join(', ')}`);
            if (pd.complications.length) charParts.push(`⚠ Осложнения: ${pd.complications.join(', ')}`);
            if (pd.dueWeeks <= 4) charParts.push(`⏰ До родов: ~${pd.dueWeeks} нед.!`);
        }

        // Роды
        if (s.modules.labor && p.labor?.active) {
            const le = new LaborEngine(p);
            const ld = le.toPromptData();
            charParts.push(`🏥 РОДЫ В ПРОЦЕССЕ: ${ld.stage}`);
            charParts.push(`Раскрытие: ${ld.dilation}/10 см. Боль: ${ld.pain}`);
            charParts.push(`Схватки: каждые ${ld.contractions.interval}, по ${ld.contractions.duration}`);
            charParts.push(`${ld.description}`);
            if (ld.complications.length) charParts.push(`⚠ Осложнения: ${ld.complications.join(', ')}`);
        }

        // Здоровье
        if (s.modules.health && p.health) {
            const hs = new HealthSystem(p);
            const hd = hs.toPromptData();
            charParts.push(`Здоровье: ${hd.overall} | Иммунитет: ${hd.immunity}% | Энергия: ${hd.energy}% | Стресс: ${hd.stress}% | Боль: ${hd.pain}%`);
            charParts.push(`Ментальное: ${hd.mentalState}`);
            if (hd.conditions.length) charParts.push(`Болезни: ${hd.conditions.join('; ')}`);
            if (hd.injuries.length) charParts.push(`Травмы: ${hd.injuries.join('; ')}`);
            if (hd.medications.length) charParts.push(`Лекарства: ${hd.medications.join(', ')}`);
            if (hd.symptoms.length) charParts.push(`Текущие симптомы: ${hd.symptoms.join(', ')}`);
        }

        // AU: Heat/Rut
        if (s.modules.auOverlay && s.auPreset === 'omegaverse' && p.secondarySex) {
            const hre = new HeatRutEngine(p);
            const hrd = hre.toPromptData();
            if (hrd.heat?.active) charParts.push(`🔥 ТЕЧКА: фаза ${hrd.heat.phase}, день ${hrd.heat.day}, интенсивность: ${hrd.heat.intensity}`);
            else if (hrd.heat) charParts.push(`До течки: ~${hrd.heat.daysLeft} дн.`);
            if (hrd.rut?.active) charParts.push(`🔥 ГОН: фаза ${hrd.rut.phase}, день ${hrd.rut.day}`);
            else if (hrd.rut) charParts.push(`До гона: ~${hrd.rut.daysLeft} дн.`);
        }

        // Bond
        if (s.modules.auOverlay && s.auPreset === 'omegaverse' && p.bond?.bonded) {
            const be = new BondEngine(p);
            charParts.push(`Связь: ${be.statusLabel}. Эффекты: ${be.effects.join(', ') || 'нет'}`);
        }

        // Ovi
        if (s.modules.auOverlay && s.auSettings.oviposition.enabled && p.oviposition?.active) {
            const oe = new OviEngine(p);
            charParts.push(`🥚 Овипозиция: ${oe.phaseLabel}, яиц: ${p.oviposition.eggCount} (опл.: ${p.oviposition.fertilizedCount})`);
        }

        // Дети
        if (s.modules.baby && p.babies?.length) {
            charParts.push(`Дети (${p.babies.length}):`);
            for (const baby of p.babies) {
                const bm = new BabyManager(baby);
                const bd = bm.toPromptData();
                charParts.push(`  • ${bd.name || '?'} (${bd.sex}), ${bd.age}, ${bd.weight}`);
            }
        }

        // Контрацепция
        if (canGetPregnant(p) && p.contraception && p.contraception !== 'none') {
            charParts.push(`Контрацепция: ${p.contraception}`);
        }

        // Настроение
        if (p.mood && p.mood.current !== 'neutral') {
            const moodLabels = {
                happy: 'счастлива', sad: 'грустна', angry: 'злится', scared: 'напугана',
                aroused: 'возбуждена', exhausted: 'измотана', in_pain: 'испытывает боль'
            };
            charParts.push(`Настроение: ${moodLabels[p.mood.current] || p.mood.current} (${p.mood.intensity})`);
        }

        parts.push(charParts.join('\n'));
    }

    // --- Отношения ---
    const relPrompt = RelationshipManager.toPromptData();
    if (relPrompt) {
        parts.push(`\nОтношения:\n${relPrompt}`);
    }

    // --- AU текст ---
    if (s.customAu) {
        const auParts = [];
        if (s.customAu.diseases) auParts.push(`Болезни мира: ${s.customAu.diseases}`);
        if (s.customAu.pregnancyRules) auParts.push(`Беременность в этом мире: ${s.customAu.pregnancyRules}`);
        if (s.customAu.treatment) auParts.push(`Лечение: ${s.customAu.treatment}`);
        if (s.customAu.worldRules) auParts.push(`Правила мира: ${s.customAu.worldRules}`);
        if (auParts.length) parts.push(`\nAU правила:\n${auParts.join('\n')}`);
    }

    // --- Режиссура ---
    if (s.promptRPMode) {
        parts.push(generateDirectorNotes());
    }

    parts.push('[/BunnyCycle]');
    return parts.join('\n');
}

// ========================
// РЕЖИССЁРСКИЕ ЗАМЕТКИ
// ========================
function generateDirectorNotes() {
    const s = getSettings();
    const notes = ['\n[Режиссура BunnyCycle]'];
    const chars = s.characters;

    for (const name of Object.keys(chars)) {
        const p = chars[name];
        if (!p._enabled) continue;
        const cn = [];

        // Беременность — режиссура
        if (p.pregnancy?.active) {
            const pe = new PregnancyEngine(p);
            if (pe.pr.week < 12) {
                cn.push(`${name} на раннем сроке: может ещё не знать о беременности. Тошнота, усталость, чувствительность.`);
            } else if (pe.pr.week >= 36) {
                cn.push(`${name} на позднем сроке: огромный живот, трудно двигаться, одышка, тренировочные схватки. Может начаться в любой момент.`);
            } else if (pe.pr.week >= 20) {
                cn.push(`${name}: ребёнок активно шевелится, живот заметен всем. Периодические неудобства.`);
            }
            if (pe.isHighRisk) {
                cn.push(`⚠ ${name}: высокий риск! Осложнения: ${pe.pr.complications.join(', ')}. Персонаж должен быть осторожен.`);
            }
        }

        // Роды — режиссура
        if (p.labor?.active) {
            const le = new LaborEngine(p);
            cn.push(`🏥 ${name}: РОДЫ! ${le.stageDescription} Боль: ${le.painLevel}. ОПИСЫВАЙ ПРОЦЕСС ДЕТАЛЬНО, ФИЗИОЛОГИЧНО.`);
        }

        // Здоровье — режиссура
        if (s.modules.health && p.health) {
            const hs = new HealthSystem(p);
            if (hs.overallStatus.level === 'critical') {
                cn.push(`⛔ ${name}: КРИТИЧЕСКОЕ СОСТОЯНИЕ! Персонаж может потерять сознание, нуждается в срочной помощи.`);
            } else if (hs.overallStatus.level === 'poor') {
                cn.push(`${name}: плохое самочувствие. Симптомы: ${hs.allSymptoms.slice(0, 5).join(', ')}. Персонаж ослаблен, это видно.`);
            }
            if (p.health.pain > 60) {
                cn.push(`${name}: сильная боль (${p.health.pain}%), это влияет на поведение, речь, движения.`);
            }
            if (p.health.mentalState !== 'stable') {
                cn.push(`${name}: ментальное состояние — ${hs.mentalStateInfo.label}. Отражай это в поведении и диалогах.`);
            }
        }

        // Цикл — режиссура
        if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
            const ce = new CycleEngine(p);
            if (ce.phase === 'menstruation') {
                cn.push(`${name}: менструация. Возможны спазмы, раздражительность, нужна гигиена.`);
            } else if (ce.phase === 'ovulation') {
                cn.push(`${name}: овуляция. Повышенное либидо, привлекательность, отзывчивость к прикосновениям.`);
            }
        }

        // Течка/гон — режиссура
        if (s.modules.auOverlay && s.auPreset === 'omegaverse') {
            if (p.heat?.active) {
                cn.push(`🔥 ${name}: В ТЕЧКЕ! Описывай характерные проявления: жар, потливость, повышенная чувствительность, потребность в альфе, выделение смазки.`);
            }
            if (p.rut?.active) {
                cn.push(`🔥 ${name}: В ГОНУ! Описывай агрессивность, доминантность, собственничество, усиленное либидо.`);
            }
        }

        if (cn.length) notes.push(cn.join('\n'));
    }

    notes.push('[/Режиссура]');
    return notes.length > 2 ? notes.join('\n') : '';
}

// ========================
// ПАРСЕР ТЕГОВ ИЗ ОТВЕТА БОТА
// ========================
export function parseResponseTags(text) {
    const result = {
        time: null,
        health: [],
        mood: [],
        intimacy: null,
        pregnancy: null,
        injury: null,
        raw: ''
    };

    // Ищем теги <bunnycycle>...</bunnycycle>
    const tagMatch = text.match(/<bunnycycle>([\s\S]*?)<\/bunnycycle>/i);
    if (!tagMatch) return null;

    const content = tagMatch[1].trim();
    result.raw = content;

    // Парсим строки
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // time: +N дней
        const timeMatch = trimmed.match(/^time:\s*\+?(\d+)\s*(дн|день|дня|недел|месяц|час)/i);
        if (timeMatch) {
            let days = parseInt(timeMatch[1]);
            if (/недел/i.test(timeMatch[2])) days *= 7;
            if (/месяц/i.test(timeMatch[2])) days *= 30;
            if (/час/i.test(timeMatch[2])) days = days >= 12 ? 1 : 0;
            result.time = { days };
        }

        // health: Имя: состояние (severity)
        const healthMatch = trimmed.match(/^health:\s*(.+?):\s*(.+?)(?:\s*\((\w+)\))?$/i);
        if (healthMatch) {
            result.health.push({
                name: healthMatch[1].trim(),
                condition: healthMatch[2].trim(),
                severity: healthMatch[3]?.trim() || 'mild'
            });
        }

        // mood: Имя: настроение
        const moodMatch = trimmed.match(/^mood:\s*(.+?):\s*(.+)$/i);
        if (moodMatch) {
            result.mood.push({
                name: moodMatch[1].trim(),
                mood: moodMatch[2].trim()
            });
        }

        // intimacy: тип, эякуляция, участники: ...
        const intimMatch = trimmed.match(/^intimacy:\s*(.+)/i);
        if (intimMatch) {
            const parts = intimMatch[1].split(',').map(p => p.trim());
            result.intimacy = {
                type: parts[0] || 'vaginal',
                ejac: parts[1] || 'unknown',
                participants: parts.slice(2).map(p => p.replace(/участники:\s*/i, '').trim()).filter(Boolean)
            };
        }

        // injury: Имя: тип — локация (severity)
        const injuryMatch = trimmed.match(/^injury:\s*(.+?):\s*(.+?)\s*—\s*(.+?)(?:\s*\((\w+)\))?$/i);
        if (injuryMatch) {
            result.injury = {
                name: injuryMatch[1].trim(),
                type: injuryMatch[2].trim(),
                location: injuryMatch[3].trim(),
                severity: injuryMatch[4]?.trim() || 'mild'
            };
        }

        // pregnancy_progress: заметно / шевеление и т.д. (для режиссуры, не меняет данные)
    }

    return result;
}

// ========================
// УДАЛИТЬ ТЕГИ ИЗ ОТОБРАЖАЕМОГО ТЕКСТА
// ========================
export function stripTags(text) {
    return text.replace(/<bunnycycle>[\s\S]*?<\/bunnycycle>/gi, '').trim();
}
