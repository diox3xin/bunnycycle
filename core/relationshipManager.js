/**
 * BunnyCycle v3.0 — Менеджер отношений
 */

import { getSettings, saveSettings } from './stateManager.js';
import { makeId } from '../utils/helpers.js';

const RELATION_TYPES = [
    'партнёры', 'супруги', 'любовники', 'друзья', 'враги',
    'родитель-ребёнок', 'брат-сестра', 'коллеги', 'наставник-ученик',
    'хозяин-слуга', 'альфа-омега', 'одностороннее'
];

export const RelationshipManager = {
    getAll() {
        return getSettings().relationships || [];
    },

    add(char1, char2, type, notes) {
        const s = getSettings();
        if (!s.relationships) s.relationships = [];
        s.relationships.push({
            id: makeId(),
            char1, char2,
            type: type || 'друзья',
            notes: notes || '',
            strength: 50
        });
        saveSettings();
    },

    remove(id) {
        const s = getSettings();
        s.relationships = (s.relationships || []).filter(r => r.id !== id);
        saveSettings();
    },

    update(id, updates) {
        const s = getSettings();
        const rel = (s.relationships || []).find(r => r.id === id);
        if (rel) {
            Object.assign(rel, updates);
            saveSettings();
        }
    },

    getForCharacter(name) {
        return (getSettings().relationships || []).filter(r => r.char1 === name || r.char2 === name);
    },

    getTypes() {
        return RELATION_TYPES;
    },

    buildFamilyTree() {
        const s = getSettings();
        const tree = {};
        for (const name of Object.keys(s.characters || {})) {
            tree[name] = {
                name,
                sex: s.characters[name].bioSex,
                children: [],
                partners: [],
                parents: []
            };
        }

        // Дети
        for (const name of Object.keys(s.characters || {})) {
            const p = s.characters[name];
            if (p.babies?.length) {
                for (const baby of p.babies) {
                    if (tree[name]) tree[name].children.push(baby.name || '?');
                    if (baby.father && tree[baby.father]) tree[baby.father].children.push(baby.name || '?');
                }
            }
        }

        // Отношения
        for (const rel of (s.relationships || [])) {
            if (rel.type === 'партнёры' || rel.type === 'супруги' || rel.type === 'любовники') {
                if (tree[rel.char1]) tree[rel.char1].partners.push(rel.char2);
                if (tree[rel.char2]) tree[rel.char2].partners.push(rel.char1);
            }
            if (rel.type === 'родитель-ребёнок') {
                if (tree[rel.char1]) tree[rel.char1].children.push(rel.char2);
                if (tree[rel.char2]) tree[rel.char2].parents.push(rel.char1);
            }
        }

        return tree;
    },

    toPromptData() {
        const rels = getSettings().relationships || [];
        if (!rels.length) return '';
        return rels.map(r => `${r.char1} ↔ ${r.char2}: ${r.type}${r.notes ? ` (${r.notes})` : ''}`).join('\n');
    }
};
