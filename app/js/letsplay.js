/* Household build: follow club teams on Let's Play (letsplay.sport). On the TV, the app searches the
 * team, keeps that team's free matches and reads each new match page once for its video address.
 * Finished matches are remembered; a match that is live now is checked again on the next run.
 * Teams come from PersonalFollow in js/personal-list.js (written by packaging, empty in the repo). */
var App = App || {};
var LetsPlay = (function () {
    'use strict';
    var SITE = 'https://letsplay.sport';
    var MONTHS = { januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8,
        september: 9, oktober: 10, november: 11, december: 12 };

    function decode(s) {
        return String(s).replace(/&amp;/g, '&').replace(/&#0?39;/g, '\'').replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    }

    function teamSlug(team) {
        return String(team).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    }

    /* "Zaterdag 14 november 2026 09:55 uur" → "2026-11-14T09:55" (local time), '' if not a date. */
    function parseDate(text) {
        var m = /(\d{1,2})\s+([a-z]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i.exec(String(text || ''));
        if (!m || !MONTHS[m[2].toLowerCase()]) { return ''; }
        function two(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
        return m[3] + '-' + two(MONTHS[m[2].toLowerCase()]) + '-' + two(m[1]) +
            (m[4] ? 'T' + two(m[4]) + ':' + m[5] : '');
    }

    /* Matches of one team in a search result page, without summaries and short clips. */
    function parseSearch(html, team) {
        var slug = teamSlug(team);
        var own = new RegExp('(^|-)' + slug.replace(/-/g, '\\-') + '(-|$)');
        var out = [], seen = {};
        var cards = String(html).split('class="asset card');
        for (var i = 1; i < cards.length; i++) {
            var card = cards[i];
            var link = /href="\/watch\/([^"~]+)~([^"]+)"\s+aria-label="([^"]*)"/.exec(card);
            if (!link) { continue; }
            var name = link[1], id = link[2];
            if (seen[id] || /^clip-/.test(name) || /-summary$/.test(name) || !own.test(name)) { continue; }
            seen[id] = true;
            var desc = /class="asset-description">([^<]*)</.exec(card);
            var thumb = /<img[^>]+src="(https:\/\/[^"]+)"/.exec(card);
            out.push({
                id: id, path: '/watch/' + name + '~' + id, name: decode(link[3]),
                date: desc ? parseDate(decode(desc[1])) : '', thumb: thumb ? decode(thumb[1]) : ''
            });
        }
        return out;
    }

    /* Video address of a free match page: { url, live } or null (paid, or nothing to play yet). */
    function parseWatch(html) {
        html = String(html);
        var plan = /window\.pricePlanID\s*=\s*'([^']*)'/.exec(html);
        if (plan && plan[1]) { return null; }
        var mp4 = /https:\/\/vod\.usf\.sport\/[^"'\s`]+\.mp4/.exec(html);
        if (mp4) { return { url: mp4[0], live: false }; }
        var hls = /https:\/\/media\.usf\.sport\/hls\/[^"'\s`]+\.m3u8/.exec(html);
        if (hls) { return { url: hls[0], live: true }; }
        return null;
    }

    return { SITE: SITE, teamSlug: teamSlug, parseDate: parseDate, parseSearch: parseSearch, parseWatch: parseWatch };
})();

(function (App) {
    'use strict';
    var CACHE_KEY = 'chouette-tv.household.letsplay';
    var MAX_PAGES_PER_RUN = 25;
    var REFRESH_MS = 2 * 60 * 60 * 1000;
    var running = false;

    function follows() {
        return typeof PersonalFollow !== 'undefined' && Object.prototype.toString.call(PersonalFollow) === '[object Array]'
            ? PersonalFollow : [];
    }

    function loadCache() {
        try {
            var data = JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null');
            if (data && data.matches && typeof data.matches === 'object') { return data; }
        } catch (e) { /* start empty */ }
        return { matches: {} };
    }

    function saveCache(data) {
        try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* kept in memory only */ }
    }

    var cache = null;
    function getCache() { if (!cache) { cache = loadCache(); } return cache; }

    /* Followed matches as personal-list entries (newest first), for personal.js. */
    App.followedEntries = function () {
        var list = [], matches = getCache().matches, teams = follows(), byTeam = {}, i, id, m;
        for (i = 0; i < teams.length; i++) { byTeam[LetsPlay.teamSlug(teams[i].team)] = teams[i].team; }
        for (id in matches) {
            if (!Object.prototype.hasOwnProperty.call(matches, id)) { continue; }
            m = matches[id];
            if (!m || !m.url || !byTeam[m.team]) { continue; }
            list.push({ name: m.name + (m.date ? ' · ' + m.date.slice(8, 10) + '-' + m.date.slice(5, 7) + '-' + m.date.slice(0, 4) : ''),
                url: m.url, date: m.date, logo: m.thumb || '', live: !!m.live, group: byTeam[m.team] });
        }
        list.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
        return list;
    };

    function reapplyCatalog() {
        if (!App.catalog || typeof App.applyCatalogSoft !== 'function') { return; }
        var creds = App.xtreamCreds || {};
        App.applyCatalogSoft({ live: App.catalog.live, vod: App.catalog.vod, series: App.catalog.series,
            epgUrl: App.headerEpgUrl || '', base: creds.base || '', username: creds.username || '', password: creds.password || '' });
    }

    /* One pass over all followed teams. get(url, onDone, onError) is injectable for tests. */
    App.refreshFollowedTeams = function (done, get) {
        get = get || function (url, ok, fail) { Http.get(url, { timeoutMs: 30000, label: 'Let\'s Play' }, ok, fail); };
        done = done || function () {};
        var teams = follows();
        if (running || !teams.length) { done(false); return; }
        running = true;
        var data = getCache(), changed = false, pages = 0, queue = [];
        var t = 0;
        function finish() {
            running = false;
            if (changed) { saveCache(data); reapplyCatalog(); }
            done(changed);
        }
        function resolveNext() {
            if (!queue.length || pages >= MAX_PAGES_PER_RUN) { nextTeam(); return; }
            var match = queue.shift();
            pages++;
            get(LetsPlay.SITE + match.path, function (html) {
                var found = LetsPlay.parseWatch(html);
                var old = data.matches[match.id];
                if (found && (!old || old.url !== found.url || !!old.live !== found.live)) {
                    data.matches[match.id] = { team: match.team, name: match.name, date: match.date,
                        thumb: match.thumb, url: found.url, live: found.live };
                    changed = true;
                }
                resolveNext();
            }, function () { resolveNext(); });
        }
        function nextTeam() {
            if (t >= teams.length) { finish(); return; }
            var team = teams[t++].team;
            get(LetsPlay.SITE + '/search?query=' + encodeURIComponent(team), function (html) {
                var found = LetsPlay.parseSearch(html, team);
                for (var i = 0; i < found.length; i++) {
                    var known = data.matches[found[i].id];
                    if (known && known.url && !known.live) { continue; }
                    found[i].team = LetsPlay.teamSlug(team);
                    queue.push(found[i]);
                }
                resolveNext();
            }, function () { nextTeam(); });
        }
        nextTeam();
    };

    App._resetFollowCache = function () { cache = null; running = false; };

    if (typeof window !== 'undefined' && window.addEventListener && follows().length) {
        window.addEventListener('load', function () {
            setTimeout(function () { App.refreshFollowedTeams(); }, 8000);
            setInterval(function () { if (!App.backgroundSuspended) { App.refreshFollowedTeams(); } }, REFRESH_MS);
        });
    }
})(App);
