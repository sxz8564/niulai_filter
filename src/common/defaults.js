/*
 * Critter Cam — shared settings contract.
 *
 * Loaded as a classic script in every world the extension touches (the MAIN
 * world content script, the popup, the preview page), so it must never touch
 * `chrome.*` — the MAIN world has no extension APIs.
 */
(function () {
  'use strict';

  var NS = (globalThis.__CritterCam = globalThis.__CritterCam || {});
  if (NS.DEFAULTS) return;

  var DEFAULTS = {
    /** Master switch. When false the camera is passed through untouched. */
    enabled: true,
    /** Render the avatar as a lit 3D model; falls back to flat art without WebGL. */
    render3d: true,
    /** Id of the animal in the animal registry. */
    animal: 'niulai',
    /*
     * Id in the background registry, or 'none' to keep the room you are in.
     * A scene replaces the camera picture outright: the head is drawn over
     * your face anyway, so there is nothing of you to keep behind it.
     */
    background: 'none',
    /** Head width as a multiple of the detected face width. */
    size: 1.62,
    /** Offset from the detected face centre, in head widths. */
    offsetX: 0,
    offsetY: -0.1,
    /*
     * Where the head sits along the axis you look down, in head widths. The
     * camera is orthographic, so this does not move the head on screen or
     * change its size: it moves the point the head turns about. Positive puts
     * the pivot behind the face, so turning swings the muzzle further.
     */
    offsetZ: 0,
    /** Rotate the head with the head tilt. */
    followTilt: true,
    /** Drive mouth/eyes/brows from the face's expression. */
    animate: true,
    /** 0 = snap to the detector, 0.95 = very floaty. */
    smoothing: 0.55,
    /** Face detections attempted per second. */
    detectFps: 20,
    /** Skip detection entirely and pin the head to a fixed spot. */
    manual: false,
    /** What to do when the face is lost: 'fade' | 'keep' | 'hide'. */
    onLost: 'fade',
    /** Draw the tracker box on top of the output. */
    debug: false
  };

  var RANGES = {
    size: [0.8, 3.0],
    offsetX: [-0.8, 0.8],
    offsetY: [-0.8, 0.8],
    offsetZ: [-0.8, 0.8],
    smoothing: [0, 0.95],
    detectFps: [5, 30]
  };

  function clampNumber(value, fallback, range) {
    var n = typeof value === 'number' ? value : parseFloat(value);
    if (!isFinite(n)) return fallback;
    return Math.min(range[1], Math.max(range[0], n));
  }

  /** Coerces anything (storage, a page message) into a usable settings object. */
  function normalize(raw) {
    var input = raw && typeof raw === 'object' ? raw : {};
    var out = {};
    for (var key in DEFAULTS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) continue;
      var fallback = DEFAULTS[key];
      var value = input[key];
      if (RANGES[key]) out[key] = clampNumber(value, fallback, RANGES[key]);
      else if (typeof fallback === 'boolean') out[key] = value === undefined ? fallback : !!value;
      else out[key] = typeof value === 'string' && value ? value : fallback;
    }
    if (['fade', 'keep', 'hide'].indexOf(out.onLost) === -1) out.onLost = DEFAULTS.onLost;
    return out;
  }

  NS.DEFAULTS = DEFAULTS;
  NS.RANGES = RANGES;
  NS.normalizeSettings = normalize;
  NS.STORAGE_KEY = 'settings';
  NS.CHANNEL = 'crittercam';
})();
