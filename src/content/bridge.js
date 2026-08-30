/*
 * Critter Cam — content bridge (isolated world).
 *
 * The page patch runs in the MAIN world and has no extension APIs; this script
 * has them but cannot touch the page's JavaScript objects. They talk over
 * postMessage. The bridge also owns the face detector, because the worker must
 * be created from the extension's origin to escape the host page's CSP.
 */
(function () {
  'use strict';

  var NS = globalThis.__CritterCam;
  if (!NS || NS.bridged) return;
  NS.bridged = true;

  var CHANNEL = NS.CHANNEL;
  var IDLE_SHUTDOWN_MS = 45000;

  var settings = NS.normalizeSettings({});
  var activePipeline = null;
  var idleTimer = 0;
  var pageStats = null;

  var detector = NS.createDetectorClient({
    onFace: function (face) {
      pendingFace = { face: face };
    },
    /*
     * The mask rides along with the pose so the page sees one message per
     * frame, and it is transferred rather than copied — a bitmap crossing
     * worlds by value every frame would be a needless megabyte a second.
     */
    onMask: function (mask) {
      var payload = pendingFace || { face: null };
      pendingFace = null;
      payload.mask = mask || null;
      window.postMessage(
        Object.assign({ ch: CHANNEL, dir: 'ext', type: 'face' }, payload),
        '*',
        mask ? [mask] : []
      );
    }
  });

  // onFace always fires first and onMask right after it, for the same frame.
  var pendingFace = null;

  function toPage(type, payload) {
    window.postMessage(Object.assign({ ch: CHANNEL, dir: 'ext', type: type }, payload || {}), '*');
  }

  function pushSettings() {
    detector.setFps(settings.detectFps);
    detector.setSegment(settings.enabled && settings.background !== 'none');
    toPage('settings', { settings: settings });
    updateDetectorRunState();
    ensureModelBytes(settings.animal);
    ensureBackgroundBytes(settings.background);
  }

  /* ------------------------------------------------------- avatar models */

  var registry = [];
  var sentModels = {};

  /*
   * The page cannot reliably fetch extension URLs - a host page's CSP governs
   * requests made from its own world - so the bridge reads model files and
   * passes the bytes across.
   */
  function ensureModelBytes(animalId) {
    var entry = registry.filter(function (e) { return e.id === animalId; })[0];
    if (!entry || sentModels[entry.id]) return;
    sentModels[entry.id] = true;
    fetch(chrome.runtime.getURL('models/avatars/' + entry.file))
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.arrayBuffer();
      })
      .then(function (buffer) {
        window.postMessage({ ch: CHANNEL, dir: 'ext', type: 'modelData', id: entry.id, buffer: buffer }, '*', [buffer]);
      })
      .catch(function (error) {
        sentModels[entry.id] = false;
        modelError = entry.id + ': ' + error.message;
      });
  }

  var modelError = null;

  /* ---------------------------------------------------------- backgrounds */

  var backgroundRegistry = [];
  var sentBackgrounds = {};

  /** Same reason as the models: the page cannot read the extension's files. */
  function ensureBackgroundBytes(id) {
    if (!id || id === 'none') return;
    var entry = backgroundRegistry.filter(function (e) { return e.id === id; })[0];
    if (!entry || sentBackgrounds[entry.id]) return;
    sentBackgrounds[entry.id] = true;
    fetch(chrome.runtime.getURL('models/backgrounds/' + entry.file))
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.arrayBuffer();
      })
      .then(function (buffer) {
        window.postMessage(
          { ch: CHANNEL, dir: 'ext', type: 'backgroundData', id: entry.id, buffer: buffer },
          '*', [buffer]);
      })
      .catch(function () { sentBackgrounds[entry.id] = false; });
  }

  fetch(chrome.runtime.getURL('models/backgrounds/index.json'))
    .then(function (response) { return response.ok ? response.json() : []; })
    .then(function (entries) {
      backgroundRegistry = Array.isArray(entries) ? entries : [];
      if (backgroundRegistry.length) {
        toPage('backgrounds', { registry: backgroundRegistry });
        ensureBackgroundBytes(settings.background);
      }
    })
    .catch(function () { backgroundRegistry = []; });

  fetch(chrome.runtime.getURL('models/avatars/index.json'))
    .then(function (response) { return response.ok ? response.json() : []; })
    .then(function (entries) {
      registry = Array.isArray(entries) ? entries : [];
      if (registry.length) {
        toPage('models', { registry: registry });
        ensureModelBytes(settings.animal);
      }
    })
    .catch(function () { registry = []; });

  /*
   * Detection is pure overhead when the head is off or pinned in place — but
   * the same frames feed the segmenter, so a chosen scene keeps the pump
   * running even when the face is not being tracked.
   */
  function shouldDetect() {
    if (!activePipeline || !settings.enabled) return false;
    return !settings.manual || settings.background !== 'none';
  }

  function updateDetectorRunState() {
    if (shouldDetect()) {
      clearTimeout(idleTimer);
      var video = document.getElementById(activePipeline.videoId);
      if (video) detector.attach(video);
    } else {
      detector.detach();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () { detector.destroy(); }, IDLE_SHUTDOWN_MS);
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var msg = event.data;
    if (!msg || msg.ch !== CHANNEL || msg.dir !== 'page') return;

    if (msg.type === 'hello') {
      pushSettings();
      if (registry.length) toPage('models', { registry: registry });
      if (backgroundRegistry.length) toPage('backgrounds', { registry: backgroundRegistry });
      return;
    }

    if (msg.type === 'pipeline') {
      if (msg.active) {
        activePipeline = { id: msg.id, videoId: msg.videoId, width: msg.width, height: msg.height };
        // The element is created just before this message, but give the DOM a tick.
        setTimeout(updateDetectorRunState, 0);
      } else if (activePipeline && activePipeline.id === msg.id) {
        activePipeline = null;
        updateDetectorRunState();
      }
      return;
    }

    if (msg.type === 'stats') {
      pageStats = msg.stats;
      pageStats.pipelines = msg.pipelines;
    }
  }, false);

  /* ------------------------------------------------------------- settings */

  chrome.storage.sync.get(NS.STORAGE_KEY, function (stored) {
    if (chrome.runtime.lastError) return;
    settings = NS.normalizeSettings(stored && stored[NS.STORAGE_KEY]);
    pushSettings();
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'sync' || !changes[NS.STORAGE_KEY]) return;
    settings = NS.normalizeSettings(changes[NS.STORAGE_KEY].newValue);
    pushSettings();
  });

  /* --------------------------------------------------------- popup status */

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== 'crittercam:getStatus') return undefined;
    var detector_ = detector.getStatus();
    sendResponse({
      present: true,
      camera: !!activePipeline,
      resolution: activePipeline ? activePipeline.width + '×' + activePipeline.height : null,
      detector: {
        state: detector_.state,
        delegate: detector_.delegate,
        error: detector_.error,
        cost: Math.round(detector_.cost || 0),
        processed: detector_.processed
      },
      models: { count: registry.length, error: modelError },
      render: pageStats
    });
    return true;
  });
})();
