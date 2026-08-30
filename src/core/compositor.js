/*
 * Critter Cam — compositor.
 *
 * Owns the animation state that sits between the face detector (which is
 * jittery and runs at its own rate) and the render loop (which runs at camera
 * frame rate). Smooths the pose, animates ears with a little spring, and draws
 * the animal head over a frame that has already been painted to the canvas.
 *
 * Runs in the page's MAIN world, so it must not touch `chrome.*`.
 */
(function () {
  'use strict';

  var NS = (globalThis.__CritterCam = globalThis.__CritterCam || {});
  if (NS.createCompositor) return;

  var MANUAL_FACE = { cx: 0.5, cy: 0.44, w: 0.26, roll: 0, yaw: 0, pitch: 0 };
  var HOLD_MS = 600;   // how long a lost face stays on screen before fading
  var FADE_MS = 450;

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /** Frame-rate independent smoothing: `smoothing` is the fraction kept per 60Hz frame. */
  function factorFor(smoothing, dtMs) {
    if (smoothing <= 0) return 1;
    return 1 - Math.pow(smoothing, Math.max(dtMs, 1) / 16.667);
  }

  function createCompositor(getAnimals) {
    var animals = getAnimals || function () { return NS.animals; };

    var renderer3d = null;
    var tried3d = false;

    /*
     * The newest body mask, as an ImageBitmap whose alpha is you. It arrives
     * at the detector's rate and is drawn at the camera's, so a frame is
     * usually painted with a mask a little older than it — which is fine, and
     * far cheaper than segmenting every frame.
     */
    var mask = null;
    var scene = null;      // offscreen canvas the person is cut out on
    var sceneCtx = null;

    function setMask(bitmap) {
      if (mask && mask.close) mask.close();
      mask = bitmap || null;
    }

    function get3d() {
      // A context lost mid-call would otherwise leave the meeting on flat art
      // until the tab is reloaded. Drop the dead renderer and build another.
      if (renderer3d && renderer3d.isLost && renderer3d.isLost()) {
        try { renderer3d.dispose(); } catch (error) { /* the context is already gone */ }
        renderer3d = null;
        tried3d = false;
      }
      if (tried3d) return renderer3d;
      tried3d = true;
      if (NS.avatar3d && NS.avatar3d.isSupported()) {
        try { renderer3d = NS.avatar3d.createRenderer(); } catch (error) { renderer3d = null; }
      }
      return renderer3d;
    }

    var state = {
      settings: NS.normalizeSettings ? NS.normalizeSettings({}) : {},
      // Smoothed pose, in normalized frame coordinates.
      cx: 0.5, cy: 0.45, w: 0.26, roll: 0, yaw: 0, pitch: 0,
      jawOpen: 0, blinkL: 0, blinkR: 0, smile: 0, brow: 0,
      swing: 0, swingVel: 0,
      opacity: 0,
      seeded: false,
      lastFace: null,
      lastFaceAt: 0,
      lastDrawAt: 0,
      lastRoll: 0,
      lastCx: 0.5,
      frames: 0,
      fps: 0,
      fpsAt: 0
    };

    function setSettings(next) {
      state.settings = NS.normalizeSettings ? NS.normalizeSettings(next) : next || {};
    }

    /** Feeds a detector result. `face` is null when no face was found. */
    function onFace(face) {
      if (face) {
        state.lastFace = face;
        state.lastFaceAt = performance.now();
      } else {
        state.lastFace = null;
      }
    }

    function targetFace() {
      if (state.settings.manual) return MANUAL_FACE;
      return state.lastFace;
    }

    function step(now) {
      var dt = state.lastDrawAt ? now - state.lastDrawAt : 16.7;
      state.lastDrawAt = now;
      dt = clamp(dt, 1, 100);

      var face = targetFace();
      var poseK = factorFor(state.settings.smoothing, dt);
      // Expressions need to keep up with speech, so they smooth about half as much.
      var exprK = factorFor(state.settings.smoothing * 0.55, dt);

      if (face) {
        if (!state.seeded) {
          state.cx = face.cx; state.cy = face.cy; state.w = face.w;
          state.roll = face.roll || 0; state.yaw = face.yaw || 0; state.pitch = face.pitch || 0;
          state.lastRoll = state.roll; state.lastCx = state.cx;
          state.seeded = true;
        }
        state.cx = lerp(state.cx, face.cx, poseK);
        state.cy = lerp(state.cy, face.cy, poseK);
        state.w = lerp(state.w, face.w, poseK);
        state.roll = lerp(state.roll, face.roll || 0, poseK);
        state.yaw = lerp(state.yaw, face.yaw || 0, poseK);
        state.pitch = lerp(state.pitch, face.pitch || 0, poseK);

        var animate = state.settings.animate && !state.settings.manual;
        state.jawOpen = lerp(state.jawOpen, animate ? (face.jawOpen || 0) : 0, exprK);
        state.blinkL = lerp(state.blinkL, animate ? (face.blinkL || 0) : 0, exprK);
        state.blinkR = lerp(state.blinkR, animate ? (face.blinkR || 0) : 0, exprK);
        state.smile = lerp(state.smile, animate ? (face.smile || 0) : 0, exprK);
        state.brow = lerp(state.brow, animate ? (face.brow || 0) : 0, exprK);
      }

      // Ear spring, driven by how fast the head is tilting and sliding.
      var rollVel = (state.roll - state.lastRoll) / dt * 1000;
      var cxVel = (state.cx - state.lastCx) / dt * 1000;
      state.lastRoll = state.roll;
      state.lastCx = state.cx;
      var drive = clamp(-rollVel * 0.22 - cxVel * 0.55, -0.6, 0.6);
      var h = dt / 1000;
      state.swingVel += (drive - state.swing) * 90 * h - state.swingVel * 9 * h;
      state.swing = clamp(state.swing + state.swingVel * h, -0.45, 0.45);

      // Visibility.
      var wantVisible = state.seeded && (state.settings.manual || !!state.lastFace);
      var targetOpacity = 1;
      if (!wantVisible) {
        var lost = now - state.lastFaceAt;
        if (state.settings.onLost === 'keep') targetOpacity = state.seeded ? 1 : 0;
        else if (state.settings.onLost === 'hide') targetOpacity = 0;
        else targetOpacity = lost < HOLD_MS ? 1 : clamp(1 - (lost - HOLD_MS) / FADE_MS, 0, 1);
      }
      var fadeK = factorFor(0.72, dt);
      state.opacity = lerp(state.opacity, targetOpacity, targetOpacity > state.opacity ? Math.min(1, fadeK * 2.2) : fadeK);

      state.frames++;
      if (now - state.fpsAt >= 1000) {
        state.fps = Math.round((state.frames * 1000) / (now - state.fpsAt));
        state.frames = 0;
        state.fpsAt = now;
      }
    }

    /** Draws `image` scaled to cover the canvas, cropping the overflow. */
    function drawCover(ctx, image, width, height) {
      var iw = image.width || 1;
      var ih = image.height || 1;
      var scale = Math.max(width / iw, height / ih);
      var w = iw * scale;
      var h = ih * scale;
      ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
    }

    /**
     * Paints the camera frame, over a chosen scene when there is one.
     *
     * The scene goes down first, then the frame with everything but you erased
     * from it. The mask is a fraction of the frame's size, so scaling it up
     * feathers the edge, which is what keeps the cut-out from looking like
     * scissors work.
     */
    function paintSource(ctx, source, width, height) {
      var backdrop = state.settings.enabled && NS.backgrounds
        ? NS.backgrounds.image(state.settings.background)
        : null;
      if (!backdrop || !mask) {
        ctx.drawImage(source, 0, 0, width, height);
        return;
      }
      if (!scene || scene.width !== width || scene.height !== height) {
        scene = document.createElement('canvas');
        scene.width = width;
        scene.height = height;
        sceneCtx = scene.getContext('2d');
      }
      sceneCtx.globalCompositeOperation = 'copy';
      sceneCtx.drawImage(source, 0, 0, width, height);
      sceneCtx.globalCompositeOperation = 'destination-in';
      sceneCtx.drawImage(mask, 0, 0, width, height);
      sceneCtx.globalCompositeOperation = 'source-over';

      drawCover(ctx, backdrop, width, height);
      ctx.drawImage(scene, 0, 0, width, height);
    }

    /**
     * Paints the frame and draws the head over it.
     * @param {CanvasRenderingContext2D} ctx output context
     * @param {number} width  canvas width in px
     * @param {number} height canvas height in px
     * @param {HTMLVideoElement} [source] the camera frame. Callers that have
     *   already painted it themselves may leave this out, but then a chosen
     *   background is not applied — the frame is already down.
     */
    function drawFrame(ctx, width, height, source) {
      var now = performance.now();
      step(now);
      if (source) paintSource(ctx, source, width, height);

      var s = state.settings;
      if (!s.enabled || state.opacity <= 0.003 || !state.seeded) return;

      var headW = state.w * width * s.size;
      if (!(headW > 0) || !isFinite(headW)) return;

      var x = state.cx * width + s.offsetX * headW;
      var y = state.cy * height + s.offsetY * headW;

      var params = {
        jawOpen: state.jawOpen,
        blinkL: state.blinkL,
        blinkR: state.blinkR,
        smile: state.smile,
        brow: state.brow,
        yaw: state.yaw,
        pitch: state.pitch,
        earSwing: state.swing
      };

      if (s.render3d !== false) {
        var renderer = get3d();
        if (renderer) {
          var layer = null;
          try {
            layer = renderer.render(
              animals().get(s.animal),
              { x: x, y: y, size: headW, depth: s.offsetZ || 0, roll: s.followTilt ? state.roll : 0 },
              params, width, height
            );
          } catch (error) {
            renderer3d = null; // a lost context must not take the camera down
          }
          if (layer) {
            ctx.save();
            ctx.globalAlpha = state.opacity;
            ctx.drawImage(layer, 0, 0, width, height);
            ctx.restore();
            if (s.debug) drawDebug(ctx, width, height, headW);
            return;
          }
        }
      }

      ctx.save();
      ctx.globalAlpha = state.opacity;
      ctx.translate(x, y);
      if (s.followTilt) ctx.rotate(state.roll);
      ctx.scale(headW, headW);

      // A soft contact shadow helps the head sit on the shoulders.
      ctx.save();
      ctx.globalAlpha = state.opacity * 0.22;
      ctx.filter = 'blur(' + (headW * 0.03).toFixed(2) + 'px)';
      ctx.beginPath();
      ctx.ellipse(0, 0.34, 0.44, 0.30, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();

      animals().draw(ctx, animals().get(s.animal), params);
      ctx.restore();

      if (s.debug) drawDebug(ctx, width, height, headW);
    }

    function drawDebug(ctx, width, height, headW) {
      var fw = state.w * width;
      ctx.save();
      ctx.strokeStyle = '#43e08a';
      ctx.lineWidth = Math.max(1, width / 480);
      ctx.strokeRect(state.cx * width - fw / 2, state.cy * height - fw / 2, fw, fw);
      ctx.fillStyle = '#43e08a';
      ctx.font = Math.round(width / 40) + 'px system-ui, sans-serif';
      ctx.fillText(
        'fps ' + state.fps + '  yaw ' + state.yaw.toFixed(2) + '  pitch ' + state.pitch.toFixed(2) +
        '  roll ' + state.roll.toFixed(2) + '  jaw ' + state.jawOpen.toFixed(2) +
        (state.lastFace ? '' : '  [no face]'),
        8, height - 10
      );
      ctx.restore();
    }

    return {
      setSettings: setSettings,
      onFace: onFace,
      setMask: setMask,
      drawFrame: drawFrame,
      getSettings: function () { return state.settings; },
      getStats: function () {
        return {
          fps: state.fps,
          tracking: !!state.lastFace,
          seeded: state.seeded,
          opacity: state.opacity
        };
      },
      reset: function () {
        state.seeded = false;
        state.lastFace = null;
        state.opacity = 0;
      }
    };
  }

  NS.createCompositor = createCompositor;
})();
