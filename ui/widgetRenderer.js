/**
 * BunnyCycle v3.0 — Виджет в сообщениях (подробный, живой)
 */

import { getSettings, ensureProfileFields, canGetPregnant } from '../core/stateManager.js';
import { CycleEngine } from '../core/cycleEngine.js';
import { PregnancyEngine } from '../core/pregnancyEngine.js';
import { LaborEngine } from '../core/laborEngine.js';
import { HealthSystem } from '../core/healthSystem.js';
import { HeatRutEngine, BondEngine, OviEngine } from '../core/auEngine.js';
import { BabyManager } from '../core/babyManager.js';
import { formatDate, escapeHtml } from '../utils/helpers.js';

// ========================
// РЕНДЕР ВИДЖЕТА
// ========================
export function renderWidget(msgId) {
    const s = getSettings();
    if (!s.enabled || !s.showStatusWidget) return '';

    const chars = Object.keys(s.characters);
    if (!chars.length) return '';

    const date = formatDate(s.worldDate);
    let charBlocks = '';
    let hasContent = false;

    for (const name of chars) {
        const p = s.characters[name];
        if (!p._enabled) continue;
        ensureProfileFields(p);

        const block = renderCharBlock(name, p, s);
        if (block) {
            charBlocks += block;
            hasContent = true;
        }
    }

    if (!hasContent) return '';

    return `
        <div class="bc-widget" data-msg-id="${msgId || ''}">
            <div class="bc-widget-header">
                <span class="bc-widget-icon">🐰</span>
                <span class="bc-widget-date">${date}${s.worldDate.frozen ? ' ❄' : ''}</span>
                <button class="bc-widget-toggle" title="Развернуть/свернуть"><i class="fa-solid fa-chevron-down"></i></button>
            </div>
            <div class="bc-widget-body" style="display:none;">
                ${charBlocks}
            </div>
        </div>
    `;
}

// ========================
// БЛОК ОДНОГО ПЕРСОНАЖА
// ========================
function renderCharBlock(name, p, s) {
    const lines = [];
    const ce = new CycleEngine(p);
    const hs = new HealthSystem(p);
    const status = hs.overallStatus;

    // === ЗАГОЛОВОК ПЕРСОНАЖА ===
    const sexIcon = p.bioSex === 'M' ? '♂' : '♀';
    const secSex = p.secondarySex ? ` / ${p.secondarySex[0].toUpperCase() + p.secondarySex.slice(1)}` : '';
    let headerBadges = '';

    // === ЦИКЛ ===
    if (s.modules.cycle && p.cycle?.enabled && !p.pregnancy?.active) {
        const phase = ce.phase;
        const fertPct = Math.round(ce.fertility * 100);

        // Описание состояния организма по фазам
        const cycleDesc = {
            menstruation: () => {
                const dayInPhase = ce.c.currentDay;
                const intensity = dayInPhase <= 2 ? 'обильные' : dayInPhase <= 4 ? 'умеренные' : 'скудные';
                const cramps = p.cycle.symptomIntensity === 'strong' ? 'сильные спазмы внизу живота' :
                    p.cycle.symptomIntensity === 'moderate' ? 'тянущие ощущения внизу живота' : 'лёгкий дискомфорт';
                return `🔴 <b>Менструация</b> (день ${dayInPhase}) — выделения ${intensity}, ${cramps}. Энергия снижена, возможна раздражительность. Фертильность: ${fertPct}%`;
            },
            follicular: () => {
                return `🌸 <b>Фолликулярная фаза</b> (день ${ce.c.currentDay}) — организм восстанавливается, энергия растёт, настроение улучшается. Выделения: ${ce.discharge}. Фертильность: ${fertPct}%`;
            },
            ovulation: () => {
                return `🥚 <b>Овуляция</b> (день ${ce.c.currentDay}) — пик фертильности (${fertPct}%)! Повышенное либидо (${ce.libido}), кожа светится, тело притягивает. Выделения: ${ce.discharge}. Лёгкая боль в боку (миттельшмерц).`;
            },
            luteal: () => {
                const daysToMens = ce.daysToMenstruation;
                const pms = daysToMens <= 5 ? ' ПМС: перепады настроения, вздутие, чувствительность груди.' : '';
                return `🌙 <b>Лютеиновая фаза</b> (день ${ce.c.currentDay}) — прогестерон повышен, возможна сонливость и повышенный аппетит. До менструации: ${daysToMens} дн.${pms} Фертильность: ${fertPct}%`;
            }
        };

        const desc = cycleDesc[phase];
        if (desc) lines.push(desc());

        if (ce.symptoms.length) {
            lines.push(`<span class="bc-w-dim">Симптомы: ${ce.symptoms.join(', ')}</span>`);
        }

        headerBadges += `<span class="bc-wbadge" style="background:${ce.phaseColor}">${ce.phaseEmoji} д.${ce.c.currentDay}</span>`;
    }

    // === БЕРЕМЕННОСТЬ ===
    if (s.modules.pregnancy && p.pregnancy?.active) {
        const pe = new PregnancyEngine(p);
        const w = pe.pr.week;
        const size = pe.size;
        const trimLabel = pe.trimesterLabel;
        const fetusCount = pe.pr.fetusCount;
        const plural = fetusCount > 1 ? `${fetusCount} плода` : '';

        let pregDesc = `🤰 <b>Беременность — ${w} неделя</b> (${trimLabel})`;

        if (w <= 4) {
            pregDesc += ` — Эмбрион только имплантировался. Размер: ${size.name}. Возможна задержка менструации, лёгкая тошнота, необъяснимая усталость.`;
        } else if (w <= 8) {
            pregDesc += ` — Эмбрион размером с ${size.name}. Токсикоз, чувствительность к запахам, набухание груди. Живот ещё не заметен.`;
        } else if (w <= 12) {
            pregDesc += ` — Плод размером с ${size.name}. ${plural ? plural + '.' : ''} Токсикоз ослабевает, но усталость остаётся. Живот чуть округлился.`;
        } else if (w <= 16) {
            pregDesc += ` — Плод: ${size.name}. Живот: ${pe.bellySize}. Энергия возвращается, «медовый месяц» беременности. Грудь увеличивается.`;
        } else if (w <= 20) {
            pregDesc += ` — Плод: ${size.name}. Живот: ${pe.bellySize}. Первые шевеления! ${pe.movements.emoji} ${pe.movements.label}. Окружающие замечают беременность.`;
        } else if (w <= 28) {
            pregDesc += ` — Плод: ${size.name}. Живот: ${pe.bellySize}. ${pe.movements.emoji} ${pe.movements.label}. Одышка при нагрузке, отёки ног, частые позывы в туалет. Набрано ~${pe.weightGainEstimate} кг.`;
        } else if (w <= 36) {
            pregDesc += ` — Плод: ${size.name}. Живот: ${pe.bellySize}. ${pe.movements.emoji} ${pe.movements.label}. Тяжело двигаться, боль в пояснице, тренировочные схватки. Гнездование.`;
        } else {
            pregDesc += ` — Плод: ${size.name}. Живот: ${pe.bellySize}. ${pe.movements.emoji} Малыш готовится к выходу! Опущение живота, давление на таз, пробка может отойти. ⏰ Роды могут начаться в любой момент!`;
        }

        lines.push(pregDesc);

        if (pe.pr.complications.length) {
            lines.push(`<span class="bc-w-warn">⚠ Осложнения: ${pe.pr.complications.join(', ')}</span>`);
        }
        if (pe.symptoms.length) {
            lines.push(`<span class="bc-w-dim">Ощущения: ${pe.symptoms.join(', ')}</span>`);
        }

        const dueW = pe.dueDate;
        lines.push(`<span class="bc-w-dim">Отец: ${escapeHtml(pe.pr.father)} | До родов: ~${dueW} нед. | ${fetusCount > 1 ? 'Многоплодная!' : 'Одноплодная'}</span>`);

        headerBadges += `<span class="bc-wbadge bc-badge-preg">${size.emoji} ${w}нед</span>`;
    }

    // === РОДЫ ===
    if (s.modules.labor && p.labor?.active) {
        const le = new LaborEngine(p);
        let laborDesc = `🏥 <b>РОДЫ!</b> Стадия: ${le.stageLabel}. `;
        laborDesc += `Раскрытие: ${le.l.dilation}/10 см. Боль: ${le.painLevel}. `;
        laborDesc += `Схватки каждые ${le.contractionInfo.interval}. `;
        laborDesc += le.stageDescription;
        if (le.l.complications.length) {
            laborDesc += ` ⚠ ${le.l.complications.join(', ')}!`;
        }
        lines.push(laborDesc);
        headerBadges += `<span class="bc-wbadge bc-badge-labor">🏥 Роды</span>`;
    }

    // === ЗДОРОВЬЕ ===
    if (s.modules.health && p.health) {
        const healthLines = [];

        // Общее состояние (только если не идеальное)
        if (status.level !== 'good') {
            healthLines.push(`${status.emoji} Состояние: <b>${status.label}</b>`);
        }

        // Болезни
        if (p.health.conditions.length) {
            for (const c of p.health.conditions) {
                const sevEmoji = { mild: '🟡', moderate: '🟠', severe: '🔴', critical: '⛔' }[c.severity] || '🟡';
                healthLines.push(`${sevEmoji} ${c.label} (день ${c.day}${c.maxDays < 999 ? '/' + c.maxDays : ''})${c.note ? ' — ' + c.note : ''}`);
            }
        }

        // Травмы
        if (p.health.injuries.length) {
            for (const i of p.health.injuries) {
                healthLines.push(`🩹 ${i.label} (${i.location}) — день ${i.day}/${i.healDays}${i.infected ? ' ⚠ ИНФЕКЦИЯ!' : ''}`);
            }
        }

        // Лекарства
        if (p.health.medications.length) {
            healthLines.push(`💊 Лекарства: ${p.health.medications.map(m => m.name).join(', ')}`);
        }

        // Показатели (только значимые отклонения)
        const warnings = [];
        if (p.health.pain > 30) warnings.push(`🤕 Боль: ${p.health.pain}%`);
        if (p.health.stress > 50) warnings.push(`😰 Стресс: ${p.health.stress}%`);
        if (p.health.energy < 40) warnings.push(`⚡ Энергия: ${p.health.energy}%`);
        if (p.health.immunity < 50) warnings.push(`🛡️ Иммунитет: ${p.health.immunity}%`);
        if (p.health.bloodLoss > 20) warnings.push(`🩸 Кровопотеря: ${p.health.bloodLoss}%`);

        if (warnings.length) healthLines.push(`<span class="bc-w-dim">${warnings.join(' | ')}</span>`);

        // Ментальное (если не стабильно)
        if (p.health.mentalState && p.health.mentalState !== 'stable') {
            const mentalLabels = { anxious: '😟 Тревожность', depressed: '😞 Подавленность', manic: '⚡ Мания', dissociated: '🌫️ Диссоциация', traumatized: '💔 Травма' };
            healthLines.push(mentalLabels[p.health.mentalState] || p.health.mentalState);
        }

        if (healthLines.length) {
            lines.push(healthLines.join('<br>'));
            headerBadges += `<span class="bc-wbadge" style="background:${status.color}">${status.emoji}</span>`;
        }
    }

    // === ТЕЧКА / ГОН (Omegaverse) ===
    if (s.modules.auOverlay && s.auPreset === 'omegaverse') {
        if (p.heat?.active) {
            const hre = new HeatRutEngine(p);
            const phase = hre.heatPhase;
            let heatDesc = `🔥 <b>ТЕЧКА</b> — `;
            if (phase === 'pre_heat') {
                heatDesc += `Предтечка (день ${p.heat.currentDay}). Нарастающий жар, лёгкое беспокойство, обострение обоняния. Запах меняется — альфы начинают реагировать.`;
            } else if (phase === 'peak_heat') {
                const intensity = p.heat.intensity || 'moderate';
                const intensityDesc = { mild: 'Терпимый жар', moderate: 'Сильный жар и потребность в близости', strong: 'Невыносимый жар, тело горит, сознание затуманено', overwhelming: 'Пик — полная потеря контроля, тело требует альфу' }[intensity] || '';
                heatDesc += `ПИК (день ${p.heat.currentDay}). ${intensityDesc}. Обильная смазка, повышенная чувствительность, феромоны на максимуме.`;
            } else if (phase === 'post_heat') {
                heatDesc += `Посттечка (день ${p.heat.currentDay}). Жар отступает, слабость, сонливость. Тело восстанавливается.`;
            }
            lines.push(heatDesc);
            headerBadges += `<span class="bc-wbadge bc-badge-heat">🔥 Течка</span>`;
        } else if (p.heat && !p.heat.active) {
            const hre = new HeatRutEngine(p);
            const daysLeft = hre.heatDaysLeft;
            if (daysLeft <= 5 && daysLeft > 0) {
                lines.push(`<span class="bc-w-dim">🔥 До течки: ${daysLeft} дн. — могут появиться первые признаки: лёгкий жар, беспокойство.</span>`);
            }
        }

        if (p.rut?.active) {
            const hre = new HeatRutEngine(p);
            const phase = hre.rutPhase;
            let rutDesc = `🔥 <b>ГОН</b> — `;
            if (phase === 'pre_rut') {
                rutDesc += `Пре-гон (день ${p.rut.currentDay}). Нарастающая агрессия, повышенный тестостерон, обострённое обоняние на омег.`;
            } else if (phase === 'peak_rut') {
                rutDesc += `ПИК (день ${p.rut.currentDay}). Доминантность зашкаливает, собственничество, командный голос активируется. Физическая сила на максимуме.`;
            } else if (phase === 'post_rut') {
                rutDesc += `Пост-гон (день ${p.rut.currentDay}). Агрессия спадает, усталость, потребность в покое и еде.`;
            }
            lines.push(rutDesc);
            headerBadges += `<span class="bc-wbadge bc-badge-heat">🔥 Гон</span>`;
        }

        // Связь
        if (p.bond?.bonded) {
            const be = new BondEngine(p);
            const effects = be.effects;
            lines.push(`<span class="bc-w-dim">🔗 Связь с ${escapeHtml(p.bond.partner)} (${p.bond.type}): ${effects.length ? effects.join(', ') : 'стабильна'}</span>`);
        }
        if (p.bond?.withdrawalActive) {
            lines.push(`<span class="bc-w-warn">💔 Абстиненция связи! Тревога, боль, тоска. День ${p.bond.daysSinceSeparation}.</span>`);
        }
    }

    // === ОВИПОЗИЦИЯ ===
    if (s.modules.auOverlay && s.auSettings?.oviposition?.enabled && p.oviposition?.active) {
        const oe = new OviEngine(p);
        const o = p.oviposition;
        const oviS = s.auSettings.oviposition;
        let oviDesc = `🥚 <b>Кладка — ${oe.phaseLabel}</b> (${oe.progress}%) — `;

        if (o.phase === 'gestation') {
            oviDesc += `${o.eggCount} яиц формируются внутри. Живот увеличивается, ощущение тяжести и наполненности. `;
            if (oviS.painLevel !== 'none') oviDesc += `Дискомфорт: ${oviS.painLevel === 'severe' ? 'сильный' : oviS.painLevel === 'moderate' ? 'умеренный' : 'лёгкий'}. `;
            oviDesc += `День ${o.daysActive}/${oviS.gestationDays}.`;
        } else if (o.phase === 'laying') {
            oviDesc += `Процесс кладки! Яйца выходят одно за другим. `;
            oviDesc += oviS.eggSize === 'large' ? 'Крупные яйца — процесс тяжёлый и болезненный. ' : '';
            oviDesc += `Скорлупа: ${oviS.shellType === 'hard' ? 'твёрдая' : oviS.shellType === 'soft' ? 'мягкая' : 'кожистая'}. `;
            oviDesc += `${o.eggCount} яиц.`;
        } else if (o.phase === 'incubation') {
            oviDesc += `Яйца отложены и инкубируются. ${o.fertilizedCount} из ${o.eggCount} оплодотворены. Нуждаются в тепле и заботе.`;
        } else if (o.phase === 'hatching') {
            oviDesc += `Яйца трещат! 🐣 ${o.fertilizedCount} детёнышей готовы вылупиться!`;
        }

        lines.push(oviDesc);
        headerBadges += `<span class="bc-wbadge" style="background:#e0a050">🥚</span>`;
    }

    // === НАСТРОЕНИЕ ===
    if (p.mood?.current && p.mood.current !== 'neutral') {
        const moodDescs = {
            happy: '😊 В хорошем настроении',
            sad: '😢 Грустит, подавлена',
            angry: '😠 Злится, раздражена',
            scared: '😨 Напугана, тревожна',
            aroused: '🥵 Возбуждена',
            exhausted: '😩 Измотана, без сил',
            in_pain: '🤕 Страдает от боли'
        };
        lines.push(`<span class="bc-w-dim">${moodDescs[p.mood.current] || p.mood.current}</span>`);
    }

    // === ДЕТИ (кратко, если есть) ===
    if (s.modules.baby && p.babies?.length) {
        const babyList = p.babies.map(b => {
            const bm = new BabyManager(b);
            return `${b.name || '?'} (${b.sex === 'M' ? '♂' : '♀'}, ${bm.ageLabel})`;
        }).join(', ');
        lines.push(`<span class="bc-w-dim">👶 Дети: ${babyList}</span>`);
    }

    // Если ничего значимого — пропускаем
    if (!lines.length) return '';

    return `
        <div class="bc-wchar-block">
            <div class="bc-wchar-head">
                <span class="bc-wchar-name">${escapeHtml(name)}</span>
                <span class="bc-wchar-sex">${sexIcon}${secSex}</span>
                ${headerBadges}
            </div>
            <div class="bc-wchar-details">
                ${lines.join('<br>')}
            </div>
        </div>
    `;
}

// ========================
// СЛУШАТЕЛИ
// ========================
export function attachWidgetListeners() {
    document.addEventListener('click', e => {
        const toggle = e.target.closest('.bc-widget-toggle');
        if (toggle) {
            const widget = toggle.closest('.bc-widget');
            if (widget) {
                const body = widget.querySelector('.bc-widget-body');
                const icon = toggle.querySelector('i');
                if (body) {
                    const visible = body.style.display !== 'none';
                    body.style.display = visible ? 'none' : '';
                    if (icon) {
                        icon.className = visible ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
                    }
                }
            }
        }
    });
}

// ========================
// ИНЪЕКЦИЯ В СООБЩЕНИЯ
// ========================
export function injectWidgets() {
    const s = getSettings();
    if (!s.enabled || !s.showStatusWidget) return;

    const messages = document.querySelectorAll('.mes[mesid]');
    for (const msg of messages) {
        if (msg.querySelector('.bc-widget')) continue;

        const mesId = msg.getAttribute('mesid');
        const textEl = msg.querySelector('.mes_text');
        if (!textEl) continue;

        // Только для последнего сообщения (или всегда если showWidgetAlways)
        if (!s.showWidgetAlways) {
            const allMes = document.querySelectorAll('.mes[mesid]');
            const lastMes = allMes[allMes.length - 1];
            if (msg !== lastMes) continue;
        }

        const widget = renderWidget(mesId);
        if (widget) {
            const div = document.createElement('div');
            div.innerHTML = widget;
            textEl.insertAdjacentElement('afterend', div.firstElementChild);
        }
    }
}
