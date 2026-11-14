'use strict';
/* Household build: following club teams on Let's Play. Fixtures mimic the site's markup with fake ids. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { frenchI18n } = require('./i18n-fixture');

function card(slug, id, title, when) {
    return '<div role="button" class="asset card border-0 position-relative " > <a class="stretched-link text-decoration-none" ' +
        'href="/watch/' + slug + '~' + id + '" aria-label="' + title + '"></a> <div class="card-body"><img class="img-fluid" ' +
        'src="https://thumbs.example.invalid/' + id + '.jpg"></div> <span class="asset-title">' + title + '</span> ' +
        '<p class="asset-description">' + when + '</p></div>';
}
const SEARCH = card('voc-jo15-1-club-a-jo15-1', 'aaa1=', 'VOC JO15-1 - Club A JO15-1', 'Zaterdag 14 november 2026 09:55 uur') +
    card('voc-jo15-1-club-a-jo15-1-summary', 'aaa2=', 'Samenvatting', 'Zaterdag 14 november 2026 09:55 uur') +
    card('club-b-jo15-1-voc-jo15-1', 'bbb1=', 'Club B JO15-1 - VOC JO15-1', 'Zaterdag 7 november 2026 11:00 uur') +
    card('voc-jo15-10-club-c-jo15-1', 'ccc1=', 'VOC JO15-10 - Club C', 'Zaterdag 7 november 2026 11:00 uur') +
    card('clip-voc-jo15-1-goal', 'ddd1=', 'Goal', 'Zaterdag 7 november 2026 11:00 uur') +
    card('voc-jo15-1-club-d-jo15-1', 'eee1=', 'VOC JO15-1 - Club D &amp; Co', 'Zaterdag 31 oktober 2026 08:55 uur');
const watch = (body, plan = '') => "<script>window.pricePlanID = '" + plan + "';</script>" + body;
const MP4 = 'https://vod.usf.sport/usf1/cam-1.mp4';
const HLS = 'https://media.usf.sport/hls/cam.m3u8';

function load(follow, storage = new Map()) {
    const ctx = vm.createContext({
        App: {}, I18n: frenchI18n(), PersonalList: [], PersonalFollow: follow,
        window: { localStorage: { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) } }
    });
    for (const f of ['catalog.js', 'letsplay.js', 'personal.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js', f), 'utf8'), ctx, { filename: f });
    }
    return ctx;
}

test('search keeps only the followed team, home and away, without summaries, clips or JO15-10', () => {
    const { LetsPlay } = load([]);
    const found = LetsPlay.parseSearch(SEARCH, 'VOC JO15-1');
    assert.deepEqual([...found].map((m) => m.id), ['aaa1=', 'bbb1=', 'eee1=']);
    assert.equal(found[0].date, '2026-11-14T09:55');
    assert.equal(found[2].name, 'VOC JO15-1 - Club D & Co');
    assert.equal(found[0].path, '/watch/voc-jo15-1-club-a-jo15-1~aaa1=');
    assert.equal(found[0].thumb, 'https://thumbs.example.invalid/aaa1=.jpg');
});

test('a match page gives its recording, else its live stream, and nothing when it has a price', () => {
    const { LetsPlay } = load([]);
    assert.deepEqual({ ...LetsPlay.parseWatch(watch('src="' + MP4 + '" also ' + HLS)) }, { url: MP4, live: false });
    assert.deepEqual({ ...LetsPlay.parseWatch(watch("url: '" + HLS + "'")) }, { url: HLS, live: true });
    assert.equal(LetsPlay.parseWatch(watch('src="' + MP4 + '"', 'plan-7')), null);
    assert.equal(LetsPlay.parseWatch(watch('nothing yet')), null);
});

test('a refresh adds followed matches as their own films category, and live ones under live TV', () => {
    const ctx = load([{ source: 'letsplay', team: 'VOC JO15-1' }]);
    const pages = {
        '/search?query=VOC%20JO15-1': SEARCH,
        '/watch/voc-jo15-1-club-a-jo15-1~aaa1=': watch("'" + HLS + "'"),
        '/watch/club-b-jo15-1-voc-jo15-1~bbb1=': watch('"' + MP4 + '"'),
        '/watch/voc-jo15-1-club-d-jo15-1~eee1=': watch('paid "' + MP4 + '"', 'p1')
    };
    const asked = [];
    const get = (url, ok, fail) => { const p = url.replace('https://letsplay.sport', ''); asked.push(p); pages[p] ? ok(pages[p]) : fail('404'); };
    let changed;
    ctx.App.refreshFollowedTeams((c) => { changed = c; }, get);
    assert.equal(changed, true);
    const cat = ctx.App.normalizeCatalog({});
    assert.equal(cat.vod.categories[0].name, 'VOC JO15-1');
    assert.equal(cat.vod.items.length, 1);
    assert.equal(cat.vod.items[0].url, MP4);
    assert.match(cat.vod.items[0].name, /Club B JO15-1 - VOC JO15-1 · 07-11-2026/);
    assert.equal(cat.live.items.length, 1);
    assert.equal(cat.live.items[0].url, HLS);
    assert.equal(cat.live.categories[0].name, 'VOC JO15-1');

    asked.length = 0;
    ctx.App.refreshFollowedTeams(() => {}, get);
    assert.ok(!asked.includes('/watch/club-b-jo15-1-voc-jo15-1~bbb1='), 'finished recordings are not fetched again');
    assert.ok(asked.includes('/watch/voc-jo15-1-club-a-jo15-1~aaa1='), 'a live match is checked again');
});

test('remembered matches survive a restart, and nothing runs without followed teams', () => {
    const storage = new Map();
    const first = load([{ source: 'letsplay', team: 'VOC JO15-1' }], storage);
    first.App.refreshFollowedTeams(() => {}, (url, ok, fail) => {
        url.includes('/search') ? ok(SEARCH) : ok(watch('"https://vod.usf.sport/usf1/' + url.split('~')[1] + '.mp4"'));
    });
    const again = load([{ source: 'letsplay', team: 'VOC JO15-1' }], storage);
    const films = again.App.normalizeCatalog({}).vod.items;
    assert.equal(films.length, 3);
    assert.deepEqual([...films].map((f) => f.name.slice(-10)), ['14-11-2026', '07-11-2026', '31-10-2026'], 'newest first');
    let ran = null;
    load([], storage).App.refreshFollowedTeams((c) => { ran = c; }, () => assert.fail('no requests'));
    assert.equal(ran, false);
    assert.equal(load([], storage).App.normalizeCatalog({}).vod.items.length, 0, 'unfollowed teams disappear');
});
