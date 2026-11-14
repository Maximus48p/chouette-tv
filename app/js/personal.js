/* Household build: private recordings (e.g. club matches) under Films → "Mijn lijst".
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
        var name = entry.name ? String(entry.name) : url.split('?')[0].split('/').pop();
        var ext = (url.split('?')[0].match(/\.([a-z0-9]{2,4})$/i) || [])[1] || 'mp4';
        var added = entry.date ? Date.parse(entry.date) : NaN;
        return {
            kind: 'vod', id: 'personal-' + hash(url), name: name, url: url, categoryId: CATEGORY,
            logo: entry.logo || '', extension: ext.toLowerCase(),
            addedAt: isNaN(added) ? 0 : Math.floor(added / 1000), userAgent: '', referrer: ''
        };
    }

    App.mergePersonalList = function (catalog) {
        var vod = catalog.vod;
        var items = [], categories = [], i, item;
        for (i = 0; i < vod.items.length; i++) {
            if (!vod.items[i] || vod.items[i].categoryId !== CATEGORY) { items.push(vod.items[i]); }
        }
        for (i = 0; i < vod.categories.length; i++) {
            if (!vod.categories[i] || vod.categories[i].id !== CATEGORY) { categories.push(vod.categories[i]); }
        }
        var mine = [];
        var entries = list();
        for (i = 0; i < entries.length; i++) {
            item = toItem(entries[i]);
            if (item) { mine.push(item); }
        }
        if (mine.length) { categories.unshift({ id: CATEGORY, name: 'Mijn lijst' }); }
        var out = {};
        for (var k in catalog) { if (Object.prototype.hasOwnProperty.call(catalog, k)) { out[k] = catalog[k]; } }
        out.vod = { categories: categories, items: items.concat(mine), _categoryCounts: null, _recent: null, _searchItems: null };
        return out;
    };

    var normalize = App.normalizeCatalog;
    App.normalizeCatalog = function (cat) {
        return App.mergePersonalList(normalize(cat));
    };
})(App);
