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
/* A match page: price plan marker, an unrelated video elsewhere, and the player call for match `id`. */
const watch = (id, url, plan = '') => "<script>window.pricePlanID = '" + plan + "';</script>" +
    '<a href="https://vod.usf.sport/usf9/other-match.mp4">related</a>' +
    (url ? "<script>setupPlayer( 'media-1', '" + id + "', '2026-11-14 08:55:00', '2026-11-14 08:55:00', '" + url + "', 'x');</script>" : '');
const MP4 = 'https://vod.usf.sport/usf1/cam-1.mp4';
const HLS = 'https://media.usf.sport/hls/cam.m3u8';
const NOW = Date.parse('2026-11-14T12:00:00');

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

test('a match page gives the video of that match only, and nothing when it has a price or no price marker', () => {
    const { LetsPlay } = load([]);
    assert.deepEqual({ ...LetsPlay.parseWatch(watch('aaa1=', MP4), 'aaa1=') }, { url: MP4, live: false });
    assert.deepEqual({ ...LetsPlay.parseWatch(watch('aaa1=', HLS), 'aaa1=') }, { url: HLS, live: true });
    assert.equal(LetsPlay.parseWatch(watch('aaa1=', MP4, 'plan-7'), 'aaa1='), null, 'paid');
    assert.equal(LetsPlay.parseWatch(watch('aaa1=', MP4).replace(/window\.pricePlanID[^;]*;/, ''), 'aaa1='), null, 'no marker: fail closed');
    assert.equal(LetsPlay.parseWatch(watch('aaa1=', ''), 'aaa1='), null, 'no player: the unrelated video is ignored');
    assert.equal(LetsPlay.parseWatch(watch('zzz9=', MP4), 'aaa1='), null, 'player for another match');
    assert.equal(LetsPlay.parseWatch(watch('aaa1=', 'https://vod.usf.sport/usf015/.mp4'), 'aaa1='), null, 'no file name (seen on the site)');
    assert.equal(LetsPlay.parseWatch(watch('aaa1=', MP4).replace("'';", '"";'), 'aaa1=') && true, true, 'double quotes ok');
});

test('a refresh adds followed matches as their own films category, and live ones under live TV', () => {
    const ctx = load([{ source: 'letsplay', team: 'VOC JO15-1' }]);
    const pages = {
        '/search?query=VOC%20JO15-1': SEARCH,
        '/watch/voc-jo15-1-club-a-jo15-1~aaa1=': watch('aaa1=', HLS),
        '/watch/club-b-jo15-1-voc-jo15-1~bbb1=': watch('bbb1=', MP4),
        '/watch/voc-jo15-1-club-d-jo15-1~eee1=': watch('eee1=', 'https://vod.usf.sport/usf1/paid.mp4', 'p1')
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
    ctx.App.refreshFollowedTeams(() => {}, get, NOW);
    assert.ok(!asked.includes('/watch/club-b-jo15-1-voc-jo15-1~bbb1='), 'finished recordings are not fetched again');
    assert.ok(asked.includes('/watch/voc-jo15-1-club-a-jo15-1~aaa1='), 'a live match is checked again');
    assert.ok(!asked.includes('/watch/voc-jo15-1-club-d-jo15-1~eee1='), 'a paid match is not fetched again within a day');
});

test('a live match that ended without a recording leaves Live; errors never block later refreshes', () => {
    const ctx = load([{ team: 'VOC JO15-1' }]);
    const one = card('voc-jo15-1-club-a-jo15-1', 'aaa1=', 'VOC JO15-1 - Club A JO15-1', 'Zaterdag 14 november 2026 09:55 uur');
    ctx.App.refreshFollowedTeams(() => {}, (url, ok) => ok(url.includes('/search') ? one : watch('aaa1=', HLS)), NOW);
    assert.equal(ctx.App.normalizeCatalog({}).live.items.length, 1);
    ctx.App.refreshFollowedTeams(() => {}, (url, ok) => ok(url.includes('/search') ? one : watch('aaa1=', '')), NOW);
    assert.equal(ctx.App.normalizeCatalog({}).live.items.length, 0);
    let finished = false;
    ctx.App.refreshFollowedTeams(() => { finished = true; }, () => { throw new Error('network stack'); }, NOW);
    assert.equal(finished, true, 'a throwing request still finishes the run');
    let again = null;
    ctx.App.refreshFollowedTeams((c) => { again = c; }, (url, ok) => ok(url.includes('/search') ? one : watch('aaa1=', MP4)), NOW);
    assert.equal(again, true, 'a match from today is checked again, so its recording appears');
    assert.equal(ctx.App.normalizeCatalog({}).vod.items.length, 1);
});

test('team groups follow the order of the followed list, newest match first within a team', () => {
    const ctx = load([{ team: 'VOC JO15-1' }, { team: 'VOC JO14-1' }]);
    const pages = card('voc-jo15-1-x', 'a1=', 'VOC JO15-1 - X', 'Zaterdag 7 november 2026 11:00 uur') +
        card('voc-jo14-1-y', 'b1=', 'VOC JO14-1 - Y', 'Zaterdag 14 november 2026 11:00 uur') +
        card('voc-jo15-1-z', 'a2=', 'VOC JO15-1 - Z', 'Zaterdag 14 november 2026 11:00 uur');
    ctx.App.refreshFollowedTeams(() => {}, (url, ok) => {
        const id = url.split('~')[1];
        ok(url.includes('/search') ? pages : watch(id, 'https://vod.usf.sport/usf1/' + id.replace('=', '') + '.mp4'));
    }, NOW);
    const vod = ctx.App.normalizeCatalog({}).vod;
    assert.deepEqual([...vod.categories].map((c) => c.name), ['VOC JO15-1', 'VOC JO14-1']);
    assert.deepEqual([...vod.items].map((i) => i.name.slice(0, 14)), ['VOC JO15-1 - Z', 'VOC JO15-1 - X', 'VOC JO14-1 - Y']);
});

test('remembered matches survive a restart, and nothing runs without followed teams', () => {
    const storage = new Map();
    const first = load([{ source: 'letsplay', team: 'VOC JO15-1' }], storage);
    first.App.refreshFollowedTeams(() => {}, (url, ok, fail) => {
        const id = url.split('~')[1];
        url.includes('/search') ? ok(SEARCH) : ok(watch(id, 'https://vod.usf.sport/usf1/' + id + '.mp4'));
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

test('a recording listed both by hand and through a followed team appears once', () => {
    const storage = new Map();
    const first = load([{ team: 'VOC JO15-1' }], storage);
    first.App.refreshFollowedTeams(() => {}, (url, ok) => ok(url.includes('/search')
        ? card('voc-jo15-1-club-b-jo15-1', 'bbb1=', 'VOC JO15-1 - Club B', 'Zaterdag 7 november 2026 11:00 uur')
        : watch('bbb1=', MP4)));
    const ctx = load([{ team: 'VOC JO15-1' }], storage);
    ctx.PersonalList.push({ name: 'by hand', url: MP4 });
    const items = ctx.App.normalizeCatalog({}).vod.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'by hand');
});
