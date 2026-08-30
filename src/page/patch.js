/*
 * Critter Cam — camera interception (page MAIN world).
 *
 * Replaces `getUserMedia` so that anything asking for the webcam receives a
 * canvas stream instead: the real camera frame with an animal head drawn over
 * it. Because the swap happens at the getUserMedia layer, Google Meet (and any
 * other site) needs no cooperation and no virtual camera driver.
 *
 * This world has no `chrome.*` APIs, so settings and face poses arrive by
 * postMessage from the content-script bridge.
 */
(function () {
  'use strict';

  var NS = globalThis.__CritterCam;
  if (!NS || !NS.createCompositor || NS.patched) return;
  NS.patched = true;

  var CHANNEL = NS.CHANNEL || 'crittercam';
  var STARTUP_TIMEOUT_MS = 4000;

  // Settings arrive from the bridge moments later; until then nothing is drawn.
  var compositor = NS.createCompositor();

  var pipelines = new Map();
  var nextId = 0;

  /* ------------------------------------------------------------ messaging */

  function send(type, payload) {
    try {
      window.postMessage(Object.assign({ ch: CHANNEL, dir: 'page', type: type }, payload || {}), '*');
    } catch (error) { /* the page may have torn down */ }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var msg = event.data;
    if (!msg || msg.ch !== CHANNEL || msg.dir !== 'ext') return;

    if (msg.type === 'settings') {
      compositor.setSettings(msg.settings);
      announcePipelines();
    } else if (msg.type === 'face') {
      compositor.onFace(msg.face || null);
      compositor.setMask(msg.mask || null);
    } else if (msg.type === 'backgrounds') {
      if (NS.backgrounds) NS.backgrounds.registerAll(msg.registry);
    } else if (msg.type === 'backgroundData') {
      if (NS.backgrounds) NS.backgrounds.provide(msg.id, msg.buffer);
    } else if (msg.type === 'models') {
      if (NS.avatarModels) NS.avatarModels.registerAll(msg.registry);
    } else if (msg.type === 'modelData') {
      if (NS.avatarModels) NS.avatarModels.provide(msg.id, msg.buffer);
    }
  }, false);

  /** Tells the bridge which camera elements are live and worth tracking. */
  function announcePipelines() {
    pipelines.forEach(function (pipeline) {
      if (pipeline.stopped || !pipeline.outputTrack) return;
      send('pipeline', {
        id: pipeline.id,
        active: true,
        videoId: pipeline.video.id,
        width: pipeline.canvas.width,
        height: pipeline.canvas.height
      });
    });
  }

  send('hello');

  /* ------------------------------------------------------------- pipeline */

  function hideElement(el) {
    el.style.cssText = [
      'position:fixed', 'left:-10000px', 'top:0', 'width:2px', 'height:2px',
      'opacity:0.001', 'pointer-events:none', 'z-index:-2147483648'
    ].join(';') + ';';
    el.setAttribute('aria-hidden', 'true');
  }

  function attachToDom(el) {
    var root = document.documentElement || document.body || document;
    root.appendChild(el);
  }

  function waitForVideo(video) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (!settled) { settled = true; reject(new Error('camera element timed out')); }
      }, STARTUP_TIMEOUT_MS);

      function ready() {
        if (settled) return;
        if (video.readyState >= 2 && video.videoWidth > 0) {
          settled = true;
          clearTimeout(timer);
          resolve();
        }
      }
      video.addEventListener('loadeddata', ready);
      video.addEventListener('canplay', ready);
      video.addEventListener('playing', ready);
      video.play().then(ready, function () { /* autoplay is fine muted; keep waiting */ });
      ready();
    });
  }

  function createPipeline(sourceTrack) {
    var id = ++nextId;
    var video = document.createElement('video');
    video.id = 'crittercam-source-' + id;
    video.setAttribute('data-crittercam', 'source');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = new MediaStream([sourceTrack]);
    hideElement(video);
    attachToDom(video);

    var canvas = document.createElement('canvas');
    canvas.id = 'crittercam-output-' + id;
    canvas.setAttribute('data-crittercam', 'output');
    hideElement(canvas);
    attachToDom(canvas);

    var ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

    var pipeline = {
      id: id,
      video: video,
      canvas: canvas,
      ctx: ctx,
      sourceTrack: sourceTrack,
      outputTrack: null,
      stopped: false,
      rvfc: 0,
      raf: 0,
      frames: 0
    };
    pipelines.set(id, pipeline);
    return pipeline;
  }

  function syncCanvasSize(pipeline) {
    var w = pipeline.video.videoWidth || 640;
    var h = pipeline.video.videoHeight || 480;
    if (pipeline.canvas.width !== w || pipeline.canvas.height !== h) {
      pipeline.canvas.width = w;
      pipeline.canvas.height = h;
    }
  }

  function renderLoop(pipeline) {
    if (pipeline.stopped) return;
    try {
      syncCanvasSize(pipeline);
      // The compositor paints the frame itself: with a background chosen it
      // has to put the scene down before the camera's own pixels.
      compositor.drawFrame(pipeline.ctx, pipeline.canvas.width, pipeline.canvas.height, pipeline.video);
      pipeline.frames++;
    } catch (error) {
      // A single bad frame (e.g. mid-resize) must never kill the camera.
    }
    scheduleFrame(pipeline);
  }

  function scheduleFrame(pipeline) {
    if (pipeline.stopped) return;
    var video = pipeline.video;
    if (typeof video.requestVideoFrameCallback === 'function') {
      pipeline.rvfc = video.requestVideoFrameCallback(function () { renderLoop(pipeline); });
    } else {
      pipeline.raf = requestAnimationFrame(function () { renderLoop(pipeline); });
    }
  }

  function stopPipeline(pipeline) {
    if (pipeline.stopped) return;
    pipeline.stopped = true;
    if (pipeline.rvfc && typeof pipeline.video.cancelVideoFrameCallback === 'function') {
      pipeline.video.cancelVideoFrameCallback(pipeline.rvfc);
    }
    if (pipeline.raf) cancelAnimationFrame(pipeline.raf);
    try { pipeline.sourceTrack.stop(); } catch (error) { /* already stopped */ }
    try { pipeline.video.pause(); pipeline.video.srcObject = null; } catch (error) { /* detached */ }
    if (pipeline.video.parentNode) pipeline.video.parentNode.removeChild(pipeline.video);
    if (pipeline.canvas.parentNode) pipeline.canvas.parentNode.removeChild(pipeline.canvas);
    pipelines.delete(pipeline.id);
    send('pipeline', { id: pipeline.id, active: false });
    if (pipelines.size === 0) compositor.reset();
  }

  /** Makes the canvas track answer questions about the real camera track. */
  function proxyTrackMetadata(outputTrack, sourceTrack, pipeline) {
    try {
      Object.defineProperty(outputTrack, 'label', {
        configurable: true,
        get: function () { return sourceTrack.label; }
      });
    } catch (error) { /* non-configurable in some builds */ }

    var canvasSettings = outputTrack.getSettings.bind(outputTrack);
    outputTrack.getSettings = function () {
      var base = {};
      try { base = sourceTrack.getSettings(); } catch (error) { /* ignore */ }
      return Object.assign({}, base, canvasSettings(), {
        width: pipeline.canvas.width,
        height: pipeline.canvas.height
      });
    };
    outputTrack.getCapabilities = function () {
      try { return sourceTrack.getCapabilities(); } catch (error) { return {}; }
    };
    outputTrack.getConstraints = function () {
      try { return sourceTrack.getConstraints(); } catch (error) { return {}; }
    };
    outputTrack.applyConstraints = function (constraints) {
      try { return sourceTrack.applyConstraints(constraints); } catch (error) { return Promise.resolve(); }
    };

    var nativeStop = outputTrack.stop.bind(outputTrack);
    outputTrack.stop = function () {
      nativeStop();
      stopPipeline(pipeline);
    };
  }

  async function buildFilteredStream(stream) {
    var sourceTrack = stream.getVideoTracks()[0];
    if (!sourceTrack) return stream;

    var pipeline = createPipeline(sourceTrack);
    try {
      await waitForVideo(pipeline.video);
    } catch (error) {
      stopPipelineWithoutStoppingSource(pipeline);
      return stream; // hand back the untouched camera rather than a black frame
    }

    syncCanvasSize(pipeline);
    // Paint one frame before capture so the first frame is never blank.
    try { pipeline.ctx.drawImage(pipeline.video, 0, 0, pipeline.canvas.width, pipeline.canvas.height); } catch (error) { /* ignore */ }

    var sourceSettings = {};
    try { sourceSettings = sourceTrack.getSettings(); } catch (error) { /* ignore */ }
    var fps = Math.min(60, Math.max(15, Math.round(sourceSettings.frameRate || 30)));

    var captured = pipeline.canvas.captureStream(fps);
    var outputTrack = captured.getVideoTracks()[0];
    if (!outputTrack) {
      stopPipelineWithoutStoppingSource(pipeline);
      return stream;
    }
    pipeline.outputTrack = outputTrack;
    proxyTrackMetadata(outputTrack, sourceTrack, pipeline);

    sourceTrack.addEventListener('ended', function () { stopPipeline(pipeline); });

    scheduleFrame(pipeline);
    send('pipeline', {
      id: pipeline.id,
      active: true,
      videoId: pipeline.video.id,
      width: pipeline.canvas.width,
      height: pipeline.canvas.height
    });

    var result = new MediaStream([outputTrack].concat(stream.getAudioTracks()));
    return result;
  }

  /** Tears down our scaffolding but leaves the real camera running. */
  function stopPipelineWithoutStoppingSource(pipeline) {
    pipeline.stopped = true;
    try { pipeline.video.srcObject = null; } catch (error) { /* ignore */ }
    if (pipeline.video.parentNode) pipeline.video.parentNode.removeChild(pipeline.video);
    if (pipeline.canvas.parentNode) pipeline.canvas.parentNode.removeChild(pipeline.canvas);
    pipelines.delete(pipeline.id);
  }

  function wantsVideo(constraints) {
    return !!(constraints && constraints.video);
  }

  /* ---------------------------------------------------------------- patch */

  var mediaDevices = navigator.mediaDevices;
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') return;

  var proto = Object.getPrototypeOf(mediaDevices) || MediaDevices.prototype;
  var original = proto.getUserMedia;

  function patchedGetUserMedia(constraints) {
    var self = this;
    var stream = original.call(self, constraints);
    if (!wantsVideo(constraints)) return stream;
    return stream.then(function (realStream) {
      return buildFilteredStream(realStream).catch(function () { return realStream; });
    });
  }
  patchedGetUserMedia.toString = function () { return 'function getUserMedia() { [native code] }'; };

  try {
    Object.defineProperty(proto, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: patchedGetUserMedia
    });
  } catch (error) {
    mediaDevices.getUserMedia = patchedGetUserMedia;
  }
  if (Object.prototype.hasOwnProperty.call(mediaDevices, 'getUserMedia')) {
    mediaDevices.getUserMedia = patchedGetUserMedia;
  }

  // Legacy callback API, still used by a few older web clients.
  ['getUserMedia', 'webkitGetUserMedia', 'mozGetUserMedia'].forEach(function (name) {
    if (typeof navigator[name] !== 'function') return;
    navigator[name] = function (constraints, success, failure) {
      patchedGetUserMedia.call(mediaDevices, constraints).then(success, failure);
    };
  });

  NS.debugInfo = function () {
    return {
      pipelines: pipelines.size,
      stats: compositor.getStats(),
      settings: compositor.getSettings()
    };
  };

  // Let the popup show a live frame rate.
  setInterval(function () {
    if (!pipelines.size) return;
    send('stats', { stats: compositor.getStats(), pipelines: pipelines.size });
  }, 1000);
})();
