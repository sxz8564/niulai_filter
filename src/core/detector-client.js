/*
 * Critter Cam — detector client.
 *
 * Pumps frames from a <video> element into the detector worker and reports
 * poses back. Used both by the content-script bridge (tracking the hidden
 * camera element the page patch creates) and by the preview page.
 *
 * Needs `chrome.runtime.getURL`, so this only runs in extension contexts —
 * never in the page's MAIN world.
 */
(function () {
  'use strict';

  var NS = (globalThis.__CritterCam = globalThis.__CritterCam || {});
  if (NS.createDetectorClient) return;

  var DETECT_WIDTH = 320; // enough for the 192px detector input, cheap to scale

  function createDetectorClient(options) {
    var onFace = (options && options.onFace) || function () {};
    var onStatus = (options && options.onStatus) || function () {};

    var worker = null;
    var scratch = null;
    var scratchCtx = null;
    var video = null;
    var running = false;
    var inFlight = false;
    var rvfcHandle = 0;
    var timer = 0;
    var lastSentAt = 0;
    var sentAt = 0;
    var fps = 20;
    var status = { state: 'idle', delegate: null, error: null, cost: 0, faces: 0, processed: 0, lastFaceAt: 0 };

    function publish(patch) {
      if (patch) for (var k in patch) status[k] = patch[k];
      onStatus(status);
    }

    /*
     * Everything the worker needs, fetched here rather than there.
     *
     * A content script's isolated world builds workers against the *page's*
     * origin, so `new Worker('chrome-extension://…')` is refused on every real
     * site, and a blob worker cannot importScripts or fetch across origins
     * either. But the content script itself may read its own extension's
     * files. So it reads them all, hands the worker its code as a blob and its
     * wasm as blob URLs, and nothing inside the worker ever crosses an origin.
     *
     * On an extension page — the preview, the popup — none of this is needed
     * and the worker is loaded straight from its URL.
     */
    var EXTENSION_PAGE = location.protocol === 'chrome-extension:';
    var LOADER_SENTINEL = 'crittercam:inlined-wasm-loader';

    function workerFromBlob() {
      var url = function (path) { return chrome.runtime.getURL(path); };
      return Promise.all([
        fetch(url('vendor/tasks-vision/vision_bundle.js')).then(function (r) { return r.text(); }),
        fetch(url('vendor/tasks-vision/wasm/vision_wasm_internal.js')).then(function (r) { return r.text(); }),
        fetch(url('src/core/detector.worker.js')).then(function (r) { return r.text(); }),
        fetch(url('vendor/tasks-vision/wasm/vision_wasm_internal.wasm')).then(function (r) { return r.blob(); }),
        fetch(url('models/face_landmarker.task')).then(function (r) { return r.arrayBuffer(); })
      ]).then(function (parts) {
        /*
         * MediaPipe loads its wasm glue with importScripts. That would be a
         * blob: URL here, which a page's script-src usually does not allow, so
         * the glue is inlined ahead of the bundle and the import is answered
         * from inside instead of over the network.
         */
        var preamble = 'self.__critterInlined = ' + JSON.stringify(LOADER_SENTINEL) + ';\n' +
          'var __critterImport = self.importScripts.bind(self);\n' +
          'self.importScripts = function () {\n' +
          '  var rest = Array.prototype.filter.call(arguments, function (u) {\n' +
          '    return String(u) !== self.__critterInlined;\n' +
          '  });\n' +
          '  if (rest.length) __critterImport.apply(self, rest);\n' +
          '};\n';
        var source = preamble + parts[1] + '\n;\n' + parts[0] + '\n;\n' + parts[2];
        return {
          worker: new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))),
          init: {
            type: 'init',
            wasmLoaderPath: LOADER_SENTINEL,
            wasmBinaryPath: URL.createObjectURL(parts[3]),
            modelBuffer: parts[4]
          }
        };
      });
    }

    function attachHandlers(instance) {
      instance.onerror = function (event) {
        publish({ state: 'error', error: (event && event.message) || 'Detector worker crashed' });
      };
      instance.onmessage = function (event) {
        var msg = event.data || {};
        if (msg.type === 'ready') {
          publish({ state: 'ready', delegate: msg.delegate, error: null });
        } else if (msg.type === 'result') {
          inFlight = false;
          status.cost = msg.cost;
          status.processed++;
          if (msg.face) {
            status.faces = 1;
            status.lastFaceAt = Date.now();
          } else {
            status.faces = 0;
          }
          onFace(msg.face || null);
        } else if (msg.type === 'dropped') {
          inFlight = false;
        } else if (msg.type === 'error') {
          inFlight = false;
          publish({ state: 'error', error: msg.message });
        }
      };
    }

    var starting = false;

    function ensureWorker() {
      if (worker) return true;
      if (starting) return true;
      starting = true;
      publish({ state: 'loading', error: null });

      if (EXTENSION_PAGE) {
        try {
          worker = new Worker(chrome.runtime.getURL('src/core/detector.worker.js'));
        } catch (error) {
          starting = false;
          publish({ state: 'error', error: 'Could not start the detector worker: ' + error.message });
          return false;
        }
        attachHandlers(worker);
        worker.postMessage({
          type: 'init',
          wasmDir: chrome.runtime.getURL('vendor/tasks-vision/wasm'),
          modelUrl: chrome.runtime.getURL('models/face_landmarker.task')
        });
        starting = false;
        return true;
      }

      workerFromBlob().then(function (built) {
        worker = built.worker;
        attachHandlers(worker);
        worker.postMessage(built.init, [built.init.modelBuffer]);
        starting = false;
      }).catch(function (error) {
        starting = false;
        publish({ state: 'error', error: 'Could not start the detector worker: ' + (error.message || error) });
      });
      return true;
    }

    var INFLIGHT_TIMEOUT_MS = 5000; // first inference can be slow while shaders compile

    function sendFrame() {
      if (!worker || !video || status.state !== 'ready') return;
      var now = performance.now();
      if (inFlight) {
        // A reply went missing (worker restart, lost message): unblock rather
        // than freezing the tracker for the rest of the call.
        if (now - sentAt > INFLIGHT_TIMEOUT_MS) inFlight = false;
        else return;
      }
      if (video.readyState < 2 || !video.videoWidth) return;

      var minGap = 1000 / Math.max(1, fps);
      if (now - lastSentAt < minGap - 1) return;
      lastSentAt = now;

      var w = DETECT_WIDTH;
      var h = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * w));
      if (!scratch || scratch.width !== w || scratch.height !== h) {
        scratch = new OffscreenCanvas(w, h);
        scratchCtx = scratch.getContext('2d', { alpha: false, willReadFrequently: false });
      }

      try {
        scratchCtx.drawImage(video, 0, 0, w, h);
      } catch (error) {
        return; // frame not decodable yet
      }

      var bitmap = scratch.transferToImageBitmap();
      inFlight = true;
      sentAt = now;
      worker.postMessage({ type: 'frame', bitmap: bitmap, ts: Math.round(now) }, [bitmap]);
    }

    function pump() {
      if (!running) return;
      sendFrame();
      schedule();
    }

    function schedule() {
      if (!running || !video) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        // Tied to decoded frames, so it keeps ticking in a background tab.
        rvfcHandle = video.requestVideoFrameCallback(pump);
      } else {
        timer = setTimeout(pump, Math.max(8, 1000 / Math.max(1, fps)));
      }
    }

    return {
      /** Starts tracking a video element (usually the hidden camera element). */
      attach: function (element) {
        if (video === element && running) return;
        this.detach();
        video = element;
        if (!video) return;
        if (!ensureWorker()) return;
        running = true;
        schedule();
      },
      detach: function () {
        running = false;
        if (video && rvfcHandle && typeof video.cancelVideoFrameCallback === 'function') {
          video.cancelVideoFrameCallback(rvfcHandle);
        }
        clearTimeout(timer);
        rvfcHandle = 0;
        timer = 0;
        inFlight = false;
        video = null;
      },
      setFps: function (value) {
        fps = Math.max(1, Math.min(30, value || 20));
      },
      getStatus: function () { return status; },
      destroy: function () {
        this.detach();
        if (worker) {
          try { worker.postMessage({ type: 'close' }); } catch (error) { /* already gone */ }
          worker.terminate();
          worker = null;
        }
        publish({ state: 'idle', delegate: null });
      }
    };
  }

  NS.createDetectorClient = createDetectorClient;
})();
