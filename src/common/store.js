/*
 * Critter Cam — settings storage helper for extension pages (popup, preview).
 * Content scripts read storage directly; this is the shared read/write path
 * for the UI surfaces.
 */
(function () {
  'use strict';

  var NS = (globalThis.__CritterCam = globalThis.__CritterCam || {});
  if (NS.store) return;

  var KEY = NS.STORAGE_KEY || 'settings';

  NS.store = {
    load: function () {
      return chrome.storage.sync.get(KEY).then(function (stored) {
        return NS.normalizeSettings(stored && stored[KEY]);
      });
    },
    save: function (settings) {
      var payload = {};
      payload[KEY] = NS.normalizeSettings(settings);
      return chrome.storage.sync.set(payload);
    },
    /** Merges a partial update into whatever is stored. */
    patch: function (changes) {
      return this.load().then(function (current) {
        return NS.store.save(Object.assign({}, current, changes)).then(function () {
          return NS.normalizeSettings(Object.assign({}, current, changes));
        });
      });
    },
    onChange: function (handler) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'sync' || !changes[KEY]) return;
        handler(NS.normalizeSettings(changes[KEY].newValue));
      });
    }
  };
})();
