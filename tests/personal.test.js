'use strict';
/* Household build: private recordings appear under Films → Mijn lijst, whatever the catalog source. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { frenchI18n } = require('./i18n-fixture');

function load(list) {
    const ctx = vm.createContext({ App: {}, I18n: frenchI18n(), PersonalList: list });
    for (const f of ['catalog.js', 'personal.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js', f), 'utf8'), ctx, { filename: f });
    }
    return ctx.App;
}
const entry = { name: 'VOC JO15-1 - DSV JO15-1', url: 'https://example.invalid/match.mp4', date: '2026-10-31' };

test('personal recordings are added as films in their own category, first in the list', () => {
    const App = load([entry]);
    const cat = App.normalizeCatalog({ vod: { categories: [{ id: '7', name: 'Docs' }], items: [{ id: '1', name: 'Doc', categoryId: '7' }] } });
    assert.equal(cat.vod.categories[0].id, 'personal');
    assert.equal(cat.vod.categories[0].name, 'Mijn lijst');
    const mine = cat.vod.items.filter((i) => i.categoryId === 'personal');
    assert.equal(mine.length, 1);
    assert.equal(mine[0].kind, 'vod');
    assert.equal(mine[0].url, entry.url);
    assert.match(mine[0].id, /^personal-/);
    assert.equal(cat.vod.items.length, 2);
});

test('normalizing twice (cached catalog) does not duplicate entries, and ids are stable', () => {
    const App = load([entry]);
    const once = App.normalizeCatalog({});
    const twice = App.normalizeCatalog(once);
    assert.equal(twice.vod.items.length, 1);
    assert.equal(twice.vod.categories.length, 1);
    assert.equal(load([entry]).normalizeCatalog({}).vod.items[0].id, once.vod.items[0].id);
});

test('an empty or missing list leaves the catalog as it was and drops stale personal entries', () => {
    const withOld = load([entry]).normalizeCatalog({});
    const App = load([]);
    const cleaned = App.normalizeCatalog(withOld);
    assert.equal(cleaned.vod.items.length, 0);
    assert.equal(cleaned.vod.categories.length, 0);
    assert.equal(load(undefined).normalizeCatalog({}).vod.items.length, 0);
});

test('entries without an http(s) address are ignored', () => {
    const App = load([{ name: 'x', url: 'javascript:alert(1)' }, { name: '', url: 'https://example.invalid/a.mp4' }, entry]);
    const items = App.normalizeCatalog({}).vod.items;
    assert.deepEqual([...items].map((i) => i.url), ['https://example.invalid/a.mp4', entry.url]);
    assert.equal(items[0].name, 'a.mp4');
});
