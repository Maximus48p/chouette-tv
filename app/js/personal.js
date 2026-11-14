/* Household build: private recordings (Films) and live streams (Live tv), each under "Mijn lijst".
 * The list comes from js/personal-list.js, which packaging writes from a private M3U outside the
 * repository; the committed file is empty. Applied in normalizeCatalog so cached and refreshed
 * catalogs both carry the current list, without duplicates. */
var App = App || {};
(function (App) {
    'use strict';
    var CATEGORY = 'personal';

    function list() {
        var own = typeof PersonalList !== 'undefined' && Object.prototype.toString.call(PersonalList) === '[object Array]'
            ? PersonalList : [];
        return typeof App.followedEntries === 'function' ? own.concat(App.followedEntries()) : own;
    }

    function isPersonal(categoryId) {
        return typeof categoryId === 'string' && (categoryId === CATEGORY || categoryId.indexOf(CATEGORY + '-') === 0);
    }

    /* Plain entries go to "Mijn lijst"; entries with a group (a followed team) get a category each. */
    function categoryOf(entry) {
        if (!entry.group) { return { id: CATEGORY, name: 'Mijn lijst' }; }
        return { id: CATEGORY + '-' + String(entry.group).toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: String(entry.group) };
    }

    function hash(s) {
        var h = 5381;
        for (var i = 0; i < s.length; i++) { h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; }
        return h.toString(36);
    }

    function toItem(entry) {
        var url = entry && typeof entry.url === 'string' ? entry.url : '';
        if (!/^https?:\/\//i.test(url)) { return null; }
        var path = url.split('?')[0];
        var name = entry.name ? String(entry.name) : path.split('/').pop();
        var id = 'personal-' + hash(url);
        var categoryId = categoryOf(entry).id;
        if (entry.live) {
            return { kind: 'live', id: id, name: name, url: url, categoryId: categoryId,
                logo: entry.logo || '', userAgent: '', referrer: '' };
        }
        var ext = (path.match(/\.([a-z0-9]{2,4})$/i) || [])[1] || 'mp4';
        var added = entry.date ? Date.parse(entry.date) : NaN;
        return {
            kind: 'vod', id: id, name: name, url: url, categoryId: categoryId,
            logo: entry.logo || '', extension: ext.toLowerCase(),
            addedAt: isNaN(added) ? 0 : Math.floor(added / 1000), userAgent: '', referrer: ''
        };
    }

    /* Copy of a bucket without earlier personal entries, plus the current ones first. */
    function withPersonal(bucket, mine, cats) {
        var items = [], categories = [], i;
        for (i = 0; i < bucket.items.length; i++) {
            if (!bucket.items[i] || !isPersonal(bucket.items[i].categoryId)) { items.push(bucket.items[i]); }
        }
        for (i = 0; i < bucket.categories.length; i++) {
            if (!bucket.categories[i] || !isPersonal(bucket.categories[i].id)) { categories.push(bucket.categories[i]); }
        }
        categories = cats.concat(categories);
        return { categories: categories, items: items.concat(mine), _categoryCounts: null, _recent: null, _searchItems: null };
    }

    App.mergePersonalList = function (catalog) {
        var live = [], vod = [], entries = list(), item, cat;
        var liveCats = [], vodCats = [], seen = {}, ids = {};
        for (var i = 0; i < entries.length; i++) {
            item = toItem(entries[i]);
            /* One item per address: a hand-made entry wins over the same video found through a followed team. */
            if (!item || ids[item.id]) { continue; }
            ids[item.id] = true;
            (item.kind === 'live' ? live : vod).push(item);
            if (!seen[item.kind + item.categoryId]) {
                seen[item.kind + item.categoryId] = true;
                cat = categoryOf(entries[i]);
                (item.kind === 'live' ? liveCats : vodCats).push(cat);
            }
        }
        var out = {};
        for (var k in catalog) { if (Object.prototype.hasOwnProperty.call(catalog, k)) { out[k] = catalog[k]; } }
        out.live = withPersonal(catalog.live, live, liveCats);
        out.vod = withPersonal(catalog.vod, vod, vodCats);
        return out;
    };

    var normalize = App.normalizeCatalog;
    App.normalizeCatalog = function (cat) {
        return App.mergePersonalList(normalize(cat));
    };
})(App);
