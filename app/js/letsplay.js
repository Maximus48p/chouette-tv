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

    function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }

    /* Video of match `id` on its page: { url, live } or null. Fails closed: the page must declare an
     * empty price plan, and the address must be the one the player gets for this match id
     * (player call: '<media>', '<id>', '<start>', '<end>', '<url>'), never another video on the page. */
    function parseWatch(html, id) {
        html = String(html);
        var plan = /window\.pricePlanID\s*=\s*(['"])([^'"]*)\1/.exec(html);
        if (!plan || plan[2]) { return null; }
        var player = new RegExp('[\'"]' + escapeRe(id) + '[\'"]\\s*,\\s*[\'"][^\'"]*[\'"]\\s*,\\s*[\'"][^\'"]*[\'"]\\s*,\\s*' +
            '[\'"](https:\\/\\/(?:vod\\.usf\\.sport\\/(?:[^\'"\\s]+\\/)?[^\'"\\s\\/]+\\.mp4|media\\.usf\\.sport\\/hls\\/[^\'"\\s\\/]+\\.m3u8))[\'"]').exec(html);
        if (!player) { return null; }
        return { url: player[1], live: /\.m3u8$/.test(player[1]) };
    }

    return { SITE: SITE, teamSlug: teamSlug, parseDate: parseDate, parseSearch: parseSearch, parseWatch: parseWatch };
})();

(function (App) {
    'use strict';
    var CACHE_KEY = 'chouette-tv.household.letsplay';
    var MAX_PAGES_PER_RUN = 60;
    var RETRY_EMPTY_MS = 24 * 60 * 60 * 1000;
    var RECENT_MS = 48 * 60 * 60 * 1000;
    var REFRESH_MS = 2 * 60 * 60 * 1000;
    var REAPPLY_RETRY_MS = 60 * 1000;
    var running = false, reapplyTimer = null;

    function follows() {
        return typeof PersonalFollow !== 'undefined' && Object.prototype.toString.call(PersonalFollow) === '[object Array]'
            ? PersonalFollow : [];
    }

    function followedSlugs() {
        var bySlug = {}, teams = follows();
        for (var i = 0; i < teams.length; i++) {
            if (teams[i] && teams[i].team) { bySlug[LetsPlay.teamSlug(teams[i].team)] = String(teams[i].team); }
        }
        return bySlug;
    }

    function teamOrder() {
        var order = {}, teams = follows();
        for (var i = 0; i < teams.length; i++) {
            if (teams[i] && teams[i].team && order[LetsPlay.teamSlug(teams[i].team)] === undefined) {
                order[LetsPlay.teamSlug(teams[i].team)] = i;
            }
        }
        return order;
    }

    function loadCache() {
        try {
            var data = JSON.parse(window.localStorage.getItem(CACHE_KEY) || 'null');
            if (data && data.matches && typeof data.matches === 'object') { return data; }
        } catch (e) { /* start empty */ }
        return { matches: {} };
    }

    /* Only matches of followed teams are kept. */
    function saveCache(data) {
        var keep = {}, bySlug = followedSlugs(), id;
        for (id in data.matches) {
            if (Object.prototype.hasOwnProperty.call(data.matches, id) && data.matches[id] && bySlug[data.matches[id].team]) {
                keep[id] = data.matches[id];
            }
        }
        data.matches = keep;
        try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) { /* kept in memory only */ }
    }

    var cache = null;
    function getCache() { if (!cache) { cache = loadCache(); } return cache; }

    /* Followed matches with a video, as personal-list entries for personal.js: teams in the order they
     * are followed, newest match first within a team. */
    App.followedEntries = function () {
        var list = [], matches = getCache().matches, bySlug = followedSlugs(), order = teamOrder(), id, m;
        for (id in matches) {
            if (!Object.prototype.hasOwnProperty.call(matches, id)) { continue; }
            m = matches[id];
            if (!m || !m.url || !bySlug[m.team]) { continue; }
            list.push({ name: m.name + (m.date ? ' · ' + m.date.slice(8, 10) + '-' + m.date.slice(5, 7) + '-' + m.date.slice(0, 4) : ''),
                url: m.url, date: m.date || '', logo: m.thumb || '', live: !!m.live, group: bySlug[m.team], rank: order[m.team] });
        }
        list.sort(function (a, b) {
            if (a.rank !== b.rank) { return a.rank - b.rank; }
            return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
        });
        return list;
    };

    /* Redraw the catalog only while browsing and no catalog load is running; otherwise try again later. */
    function reapplyCatalog() {
        if (!App.catalog || typeof App.applyCatalogSoft !== 'function') { return; }
        clearTimeout(reapplyTimer);
        var playing = typeof App.playingItem === 'function' && App.playingItem();
        if (App.catalogRequestActive || App.catalogRefreshing || App.uiState !== 'browse' || playing) {
            reapplyTimer = setTimeout(reapplyCatalog, REAPPLY_RETRY_MS);
            return;
        }
        var creds = App.xtreamCreds || {};
        App.applyCatalogSoft({ live: App.catalog.live, vod: App.catalog.vod, series: App.catalog.series,
            epgUrl: App.headerEpgUrl || '', base: creds.base || '', username: creds.username || '', password: creds.password || '' });
    }

    /* Live matches and matches from the last two days (or still to come) are checked every run, so a
     * recording shows up soon after the match; older ones without a video once a day. */
    function needsCheck(known, now) {
        if (!known) { return true; }
        if (known.url) { return !!known.live; }
        var when = known.date ? Date.parse(known.date) : NaN;
        if (!isNaN(when) && when > now - RECENT_MS) { return true; }
        return !known.checked || now - known.checked >= RETRY_EMPTY_MS;
    }

    /* One pass over all followed teams. get(url, onDone, onError) and now (ms) are injectable for tests. */
    App.refreshFollowedTeams = function (done, get, nowMs) {
        get = get || function (url, ok, fail) { Http.get(url, { timeoutMs: 30000, label: 'Let\'s Play' }, ok, fail); };
        done = done || function () {};
        var teams = follows();
        if (running || !teams.length) { done(false); return; }
        running = true;
        var data = getCache(), changed = false, pages = 0, queue = [], t = 0, now = nowMs || new Date().getTime();

        function finish() {
            running = false;
            if (changed) { saveCache(data); reapplyCatalog(); }
            done(changed);
        }
        /* A request whose callbacks throw, or that throws itself, still moves the run on. */
        function request(url, onText, next) {
            var moved = false;
            function step(fn, arg) {
                if (moved) { return; }
                moved = true;
                try { if (fn) { fn(arg); } } catch (e) { /* skip this page */ }
                next();
            }
            try {
                get(url, function (text) { step(onText, text); }, function () { step(null); });
            } catch (e2) { step(null); }
        }
        function record(match, found) {
            var old = data.matches[match.id];
            if (found) {
                if (!old || old.url !== found.url || !!old.live !== found.live) {
                    data.matches[match.id] = { team: match.team, name: match.name, date: match.date,
                        thumb: match.thumb, url: found.url, live: found.live };
                    changed = true;
                }
            } else {
                /* Paid, no video yet, or a live match that ended unrecorded (it leaves Live): look again tomorrow. */
                data.matches[match.id] = { team: match.team, name: match.name, date: match.date, url: '', checked: now };
                changed = true;
            }
        }
        function resolveNext() {
            if (!queue.length || pages >= MAX_PAGES_PER_RUN) { nextTeam(); return; }
            var match = queue.shift();
            pages++;
            request(LetsPlay.SITE + match.path, function (html) {
                record(match, LetsPlay.parseWatch(html, match.id));
            }, resolveNext);
        }
        function nextTeam() {
            queue = [];
            if (t >= teams.length) { finish(); return; }
            var team = teams[t++] && teams[t - 1].team;
            if (!team) { nextTeam(); return; }
            request(LetsPlay.SITE + '/search?query=' + encodeURIComponent(team), function (html) {
                var found = LetsPlay.parseSearch(html, team);
                for (var i = 0; i < found.length; i++) {
                    if (!needsCheck(data.matches[found[i].id], now)) { continue; }
                    found[i].team = LetsPlay.teamSlug(team);
                    queue.push(found[i]);
                }
            }, resolveNext);
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
