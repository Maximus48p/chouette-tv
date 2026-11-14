/* Household build: private recordings (Films) and live streams (Live tv), each under "Mijn lijst".
 * The list comes from js/personal-list.js, which packaging writes from a private M3U outside the
 * repository; the committed file is empty. Applied in normalizeCatalog so cached and refreshed
 * catalogs both carry the current list, without duplicates. */
var App = App || {};
(function (App) {
    'use strict';
    var CATEGORY = 'personal';

    function list() {
        return typeof PersonalList !== 'undefined' && Object.prototype.toString.call(PersonalList) === '[object Array]'
            ? PersonalList : [];
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
        if (entry.live) {
            return { kind: 'live', id: id, name: name, url: url, categoryId: CATEGORY,
                logo: entry.logo || '', userAgent: '', referrer: '' };
        }
        var ext = (path.match(/\.([a-z0-9]{2,4})$/i) || [])[1] || 'mp4';
        var added = entry.date ? Date.parse(entry.date) : NaN;
        return {
            kind: 'vod', id: id, name: name, url: url, categoryId: CATEGORY,
            logo: entry.logo || '', extension: ext.toLowerCase(),
            addedAt: isNaN(added) ? 0 : Math.floor(added / 1000), userAgent: '', referrer: ''
        };
    }

    /* Copy of a bucket without earlier personal entries, plus the current ones first. */
    function withPersonal(bucket, mine) {
        var items = [], categories = [], i;
        for (i = 0; i < bucket.items.length; i++) {
            if (!bucket.items[i] || bucket.items[i].categoryId !== CATEGORY) { items.push(bucket.items[i]); }
        }
        for (i = 0; i < bucket.categories.length; i++) {
            if (!bucket.categories[i] || bucket.categories[i].id !== CATEGORY) { categories.push(bucket.categories[i]); }
        }
        if (mine.length) { categories.unshift({ id: CATEGORY, name: 'Mijn lijst' }); }
        return { categories: categories, items: items.concat(mine), _categoryCounts: null, _recent: null, _searchItems: null };
    }

    App.mergePersonalList = function (catalog) {
        var live = [], vod = [], entries = list(), item;
        for (var i = 0; i < entries.length; i++) {
            item = toItem(entries[i]);
            if (item) { (item.kind === 'live' ? live : vod).push(item); }
        }
        var out = {};
        for (var k in catalog) { if (Object.prototype.hasOwnProperty.call(catalog, k)) { out[k] = catalog[k]; } }
        out.live = withPersonal(catalog.live, live);
        out.vod = withPersonal(catalog.vod, vod);
        return out;
    };

    var normalize = App.normalizeCatalog;
    App.normalizeCatalog = function (cat) {
        return App.mergePersonalList(normalize(cat));
    };
})(App);
