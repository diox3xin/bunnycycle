/**
 * BunnyCycle v3.0 — LLM Caller с поддержкой кастомного API
 */

import { getContext } from '/scripts/extensions.js';
import { getSettings } from '../core/stateManager.js';

export const LLM = {
    /**
     * Вызов LLM. Приоритет:
     * 1. Кастомный API (если включён и настроен)
     * 2. SillyTavern generateRaw
     * 3. Прямой fetch на бэкенд ST
     */
    async call(systemPrompt, userPrompt) {
        const s = getSettings();

        // === МЕТОД 1: Кастомный API ===
        if (s.aiApi?.enabled && s.aiApi?.url && s.aiApi?.key) {
            try {
                const result = await this._callCustomApi(systemPrompt, userPrompt, s.aiApi);
                if (result) return result;
                console.warn('[BunnyCycle] Кастомный API не дал ответа, пробуем SillyTavern...');
            } catch (err) {
                console.warn('[BunnyCycle] Кастомный API ошибка:', err.message, '— пробуем SillyTavern...');
            }
        }

        // === МЕТОД 2: SillyTavern generateRaw (правильный способ) ===
        try {
            // Пробуем через SillyTavern.getContext
            const stCtx = typeof window.SillyTavern !== 'undefined' ? window.SillyTavern?.getContext?.() : null;
            const genFn = stCtx?.generateRaw || (typeof window.generateRaw === 'function' ? window.generateRaw : null);
            
            if (genFn) {
                const combined = `${systemPrompt}\n\n${userPrompt}`;
                const resp = await Promise.race([
                    genFn(combined, '', false, false, '[BunnyCycle]'),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Таймаут 30с')), 30000))
                ]);
                if (resp) return resp;
            }
        } catch (e) {
            console.warn('[BunnyCycle] SillyTavern generateRaw failed:', e.message);
        }

        // === МЕТОД 3: fetch на ST backend (с таймаутом) ===
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000);
            
            const fetchResp = await fetch('/api/backends/chat/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: 600,
                    temperature: 0.05,
                    stream: false
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (fetchResp.ok) {
                const data = await fetchResp.json();
                return data?.choices?.[0]?.message?.content || data?.content || data?.response || '';
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.warn('[BunnyCycle] ST backend: таймаут запроса');
            } else {
                console.warn('[BunnyCycle] ST backend fetch failed:', e.message);
            }
        }

        return null;
    },

    /**
     * Вызов кастомного OpenAI-совместимого API
     */
    async _callCustomApi(systemPrompt, userPrompt, apiConfig) {
        let url = apiConfig.url.trim();
        // Нормализуем URL
        if (!url.endsWith('/')) url += '/';
        if (!url.endsWith('chat/completions') && !url.endsWith('chat/completions/')) {
            // Проверяем стандартные варианты
            if (url.endsWith('v1/')) {
                url += 'chat/completions';
            } else if (url.endsWith('v1')) {
                url += '/chat/completions';
            } else {
                // Пробуем как есть + /v1/chat/completions или /chat/completions
                if (!url.includes('/v1')) {
                    url += 'v1/chat/completions';
                } else {
                    url += 'chat/completions';
                }
            }
        }

        console.log('[BunnyCycle] Вызов кастомного API:', url, 'модель:', apiConfig.model);

        const resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiConfig.key}`
            },
            body: JSON.stringify({
                model: apiConfig.model || 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: apiConfig.maxTokens || 800,
                temperature: apiConfig.temperature || 0.05,
                stream: false
            })
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(`API ${resp.status}: ${errText.substring(0, 200)}`);
        }

        const data = await resp.json();

        // OpenAI-совместимый формат
        const content = data?.choices?.[0]?.message?.content
            || data?.content
            || data?.response
            || data?.result
            || '';

        return content || null;
    },

    /**
     * Тест подключения к кастомному API
     */
    async testConnection(apiConfig) {
        try {
            const result = await this._callCustomApi(
                'You are a test bot. Respond with exactly: {"status":"ok"}',
                'Test connection. Respond with exactly: {"status":"ok"}',
                apiConfig
            );
            if (result && result.includes('ok')) {
                return { success: true, message: 'Подключение успешно!', response: result };
            }
            return { success: false, message: 'Ответ получен, но неожиданный формат', response: result };
        } catch (err) {
            return { success: false, message: err.message };
        }
    },

    /**
     * Парсинг JSON из ответа LLM
     */
    parseJSON(text) {
        if (!text) return null;
        const clean = text.trim().replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
        const match = clean.match(/{[\s\S]*}/);
        if (!match) return null;
        try { return JSON.parse(match[0]); } catch { return null; }
    }
};
