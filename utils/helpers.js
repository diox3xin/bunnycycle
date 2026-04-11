/**
 * BunnyCycle v3.0 — Утилиты
 */

export function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
            result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
            result[key] = deepMerge(result[key], source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

export function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

export function roll100() {
    return Math.floor(Math.random() * 100) + 1;
}

export function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

export function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function formatDate(d) {
    if (!d) return '—';
    return `${d.year}/${String(d.month).padStart(2, '0')}/${String(d.day).padStart(2, '0')} ${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`;
}

export function addDaysToDate(d, n) {
    const dt = new Date(d.year, d.month - 1, d.day, d.hour, d.minute);
    dt.setDate(dt.getDate() + n);
    return {
        year: dt.getFullYear(),
        month: dt.getMonth() + 1,
        day: dt.getDate(),
        hour: dt.getHours(),
        minute: dt.getMinutes(),
        frozen: d.frozen
    };
}

export function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function daysBetween(d1, d2) {
    const a = new Date(d1.year, d1.month - 1, d1.day);
    const b = new Date(d2.year, d2.month - 1, d2.day);
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
}
