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
      toPage('face', { face: face });
    }
  });

  function toPage(type, payload) {
    window.postMessage(Object.assign({ ch: CHANNEL, dir: 'ext', type: type }, payload || {}), '*');
  }

  function pushSettings() {
    detector.setFps(settings.detectFps);
    toPage('settings', { settings: settings });
    updateDetectorRunState();
  }

  /** Detection is pure overhead when the mask is off or pinned manually. */
  function shouldDetect() {
    return !!activePipeline && settings.enabled && !settings.manual;
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
      render: pageStats
    });
    return true;
  });
})();
