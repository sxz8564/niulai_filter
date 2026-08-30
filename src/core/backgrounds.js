/*
 * Critter Cam — background registry.
 *
 * Holds the scenes the compositor can paint behind you, and turns their bytes
 * into something drawable. It runs in the page's MAIN world alongside the
 * compositor, so it must not touch `chrome.*`: a host page cannot fetch
 * chrome-extension:// URLs of its own, so the bridge reads each image and
 * hands the bytes over, exactly as it does for avatar models. Extension pages
 * fetch their own and call `provide` with the result.
 */
(function () {
  'use strict';

  var NS = (globalThis.__CritterCam = globalThis.__CritterCam || {});
  if (NS.backgrounds) return;

  var entries = [];
  var byId = {};
  var images = {};   // id -> ImageBitmap, once decoded
  var pending = {};  // id -> Promise, so bytes are decoded once

  function registerAll(list) {
    if (!Array.isArray(list)) return;
    list.forEach(function (entry) {
      if (!entry || !entry.id || byId[entry.id]) return;
      var record = { id: entry.id, name: entry.name || entry.id, file: entry.file };
      byId[entry.id] = record;
      entries.push(record);
    });
  }

  /** Accepts an ArrayBuffer, a Blob or a decoded bitmap for one scene. */
  function provide(id, data) {
    if (!id || !data || images[id] || pending[id]) return pending[id] || null;
    if (typeof ImageBitmap !== 'undefined' && data instanceof ImageBitmap) {
      images[id] = data;
      return Promise.resolve(data);
    }
    var blob = data instanceof Blob ? data : new Blob([data], { type: 'image/webp' });
    pending[id] = createImageBitmap(blob).then(function (bitmap) {
      images[id] = bitmap;
      delete pending[id];
      return bitmap;
    }).catch(function (error) {
      delete pending[id];
      throw error;
    });
    return pending[id];
  }

  NS.backgrounds = {
    registerAll: registerAll,
    provide: provide,
    list: function () { return entries.slice(); },
    get: function (id) { return byId[id] || null; },
    /** The decoded scene for `id`, or null if it is 'none' or not here yet. */
    image: function (id) {
      if (!id || id === 'none') return null;
      return images[id] || null;
    },
    /** True once `id` can be drawn, so callers can wait before switching. */
    ready: function (id) { return !!(id && id !== 'none' && images[id]); }
  };
})();
