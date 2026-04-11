/**
 * BunnyCycle v3.0 — LLM Caller
 */

import { getContext } from '/scripts/extensions.js';

export const LLM = {
    async call(systemPrompt, userPrompt) {
        try {
            // Метод 1: SillyTavern context
            if (typeof window.SillyTavern !== 'undefined') {
                const ctx = window.SillyTavern.getContext();
                if (ctx?.generateRaw) {
                    const resp = await ctx.generateRaw(systemPrompt + '\n\n' + userPrompt, '', false, false, '[BunnyCycle]');
                    if (resp) return resp;
                }
            }
            // Метод 2: глобальный generateRaw
            if (typeof generateRaw === 'function') {
                const resp = await generateRaw(systemPrompt + '\n\n' + userPrompt, '', false, false);
                if (resp) return resp;
            }
            // Метод 3: fetch
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
                })
            });
            if (fetchResp.ok) {
                const data = await fetchResp.json();
                return data?.choices?.[0]?.message?.content || data?.content || data?.response || '';
            }
            return null;
        } catch (err) {
            console.warn('[BunnyCycle] LLM call failed:', err.message);
            return null;
        }
    },

    parseJSON(text) {
        if (!text) return null;
        const clean = text.trim().replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '');
        const match = clean.match(/{[\s\S]*}/);
        if (!match) return null;
        try { return JSON.parse(match[0]); } catch { return null; }
    }
};
