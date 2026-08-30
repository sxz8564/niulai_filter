/*
 * Critter Cam — face detector worker.
 *
 * Runs MediaPipe's FaceLandmarker off the main thread. It lives in a module
 * worker loaded from the extension's own origin, which means the WebAssembly
 * runtime is governed by the extension's CSP rather than the host page's — so
 * the detector works even on sites with a strict policy, like Google Meet.
 *
 * Input:  ImageBitmap frames (transferred, so no pixel copies).
 * Output: one smoothing-friendly pose object per frame, in coordinates
 *         normalized to the frame (0..1 across the width / height).
 *
 * This is a classic worker on purpose: MediaPipe pulls in its wasm loader with
 * importScripts(), which does not exist in module workers.
 *
 * On a host page the worker is built from a blob and this file arrives with
 * the vision bundle already concatenated ahead of it — a page-origin worker
 * cannot reach across to chrome-extension:// for anything. So import only when
 * the bundle is not already here, and take the wasm and the model from
 * whatever the client hands over.
 */

if (!self.Vision) {
  importScripts(new URL('../../vendor/tasks-vision/vision_bundle.js', self.location.href).href);
}

const { FilesetResolver, FaceLandmarker, ImageSegmenter } = self.Vision;

/** Landmark indices from MediaPipe's canonical face mesh. */
const LM = {
  foreheadTop: 10,
  chin: 152,
  noseTip: 1,
  eyeOuterImageLeft: 33,   // the subject's right eye
  eyeOuterImageRight: 263, // the subject's left eye
  cheekImageLeft: 234,
  cheekImageRight: 454
};

let landmarker = null;
let delegateInUse = null;
let lastTimestamp = 0;
let busy = false;

/*
 * Body segmentation, for replacing the room behind you. It is a second model
 * on every frame, so it is built the first time a background is chosen and
 * torn down when the last one is turned off — nobody pays for a feature they
 * are not using.
 */
let segmenter = null;
let segmenterPromise = null;
let segmentWanted = false;
let maskCanvas = null;
let maskCtx = null;
let segFileset = null;
let segModel = null;

/**
 * Nose height as a fraction of the eye-to-chin span when looking straight
 * ahead. Seeded from MediaPipe's canonical face and then adapted slowly, so
 * the neutral pose is right for any face shape.
 */
const NEUTRAL_NOSE_RATIO = 0.31;
let noseRatioBaseline = NEUTRAL_NOSE_RATIO;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Rescales a blendshape's useful range to 0..1 (raw values rarely reach 1). */
function ramp(v, from, to) { return clamp((v - from) / (to - from), 0, 1); }

function blendshapeMap(result) {
  const out = {};
  const sets = result.faceBlendshapes;
  if (!sets || !sets.length) return out;
  for (const cat of sets[0].categories) out[cat.categoryName] = cat.score;
  return out;
}

function poseFromLandmarks(marks, width, height) {
  const px = (i) => ({ x: marks[i].x * width, y: marks[i].y * height });

  const forehead = px(LM.foreheadTop);
  const chin = px(LM.chin);
  const nose = px(LM.noseTip);
  const eyeL = px(LM.eyeOuterImageLeft);
  const eyeR = px(LM.eyeOuterImageRight);
  const cheekL = px(LM.cheekImageLeft);
  const cheekR = px(LM.cheekImageRight);

  const roll = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);

  const centerX = (forehead.x + chin.x + cheekL.x + cheekR.x) / 4;
  const centerY = (forehead.y + chin.y) / 2;

  // Work in a de-rotated frame so tilt doesn't contaminate yaw/pitch.
  const cos = Math.cos(-roll);
  const sin = Math.sin(-roll);
  const flat = (p) => {
    const dx = p.x - centerX;
    const dy = p.y - centerY;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  };
  const fNose = flat(nose);
  const fChin = flat(chin);
  const fForehead = flat(forehead);
  const fCheekL = flat(cheekL);
  const fCheekR = flat(cheekR);
  const eyeMidY = (flat(eyeL).y + flat(eyeR).y) / 2;

  const cheekWidth = Math.hypot(fCheekR.x - fCheekL.x, fCheekR.y - fCheekL.y);
  const headLength = Math.hypot(fChin.x - fForehead.x, fChin.y - fForehead.y);

  // Yaw shrinks the cheek span; pitch shrinks the head length. Taking the
  // larger of the two estimates keeps the head size stable through both.
  const faceWidth = Math.max(cheekWidth, headLength * 0.74);

  const distLeft = Math.abs(fNose.x - fCheekL.x);
  const distRight = Math.abs(fCheekR.x - fNose.x);
  const span = distLeft + distRight;
  const yaw = span > 1 ? clamp(((distLeft - distRight) / span) * 1.7, -1, 1) : 0;

  const vertical = fChin.y - eyeMidY;
  let pitch = 0;
  if (Math.abs(vertical) > 1) {
    const ratio = (fNose.y - eyeMidY) / vertical;
    pitch = clamp((ratio - noseRatioBaseline) * 4, -1, 1);
    // ~25 s time constant: long enough that a held pose still reads as a pose.
    noseRatioBaseline = clamp(noseRatioBaseline + (ratio - noseRatioBaseline) * 0.002, 0.2, 0.45);
  }

  return {
    cx: centerX / width,
    cy: centerY / height,
    w: faceWidth / width,
    roll,
    yaw,
    pitch
  };
}

/**
 * Builds the segmenter on demand. Its model arrives with `init` — as a buffer
 * from a host page, as a URL on an extension page — and is kept so the model
 * can be rebuilt without another round trip when a background is turned back
 * on.
 */
function ensureSegmenter() {
  if (segmenter) return Promise.resolve(segmenter);
  if (segmenterPromise) return segmenterPromise;
  if (!ImageSegmenter || !segFileset || !segModel) return Promise.resolve(null);
  const options = {
    baseOptions: Object.assign({ delegate: delegateInUse || 'GPU' }, segModel),
    runningMode: 'VIDEO',
    // 0 for the room, 255 for you, which is an alpha channel already.
    outputCategoryMask: true,
    outputConfidenceMasks: false
  };
  segmenterPromise = ImageSegmenter.createFromOptions(segFileset, options)
    .catch(function () {
      options.baseOptions.delegate = 'CPU';
      return ImageSegmenter.createFromOptions(segFileset, options);
    })
    .then(function (built) {
      segmenter = built;
      segmenterPromise = null;
      return built;
    })
    .catch(function (error) {
      segmenterPromise = null;
      self.postMessage({ type: 'segmentError', message: String(error && error.message || error) });
      return null;
    });
  return segmenterPromise;
}

function closeSegmenter() {
  if (segmenter) {
    try { segmenter.close(); } catch (error) { /* already gone */ }
    segmenter = null;
  }
}

/**
 * Runs segmentation and hands back a transferable bitmap whose alpha is the
 * mask. Building it here keeps the pixel loop off the render thread, and an
 * ImageBitmap moves without a copy where a byte array would not.
 */
function segment(bitmap, ts) {
  if (!segmenter) return null;
  const result = segmenter.segmentForVideo(bitmap, ts);
  const mask = result && result.categoryMask;
  if (!mask) return null;
  try {
    const w = mask.width;
    const h = mask.height;
    const values = mask.getAsUint8Array();
    if (!maskCanvas || maskCanvas.width !== w || maskCanvas.height !== h) {
      maskCanvas = new OffscreenCanvas(w, h);
      maskCtx = maskCanvas.getContext('2d');
    }
    const image = maskCtx.createImageData(w, h);
    const data = image.data;
    for (let i = 0, p = 0; i < values.length; i++, p += 4) {
      data[p] = 255;
      data[p + 1] = 255;
      data[p + 2] = 255;
      data[p + 3] = values[i];
    }
    maskCtx.putImageData(image, 0, 0);
    return maskCanvas.transferToImageBitmap();
  } finally {
    mask.close();
    if (result.close) result.close();
  }
}

async function init(config) {
  // Either a directory to resolve against, or the two files themselves as
  // blob URLs, which is what a page-origin worker can actually load.
  const fileset = config.wasmLoaderPath
    ? { wasmLoaderPath: config.wasmLoaderPath, wasmBinaryPath: config.wasmBinaryPath }
    : await FilesetResolver.forVisionTasks(config.wasmDir);
  segFileset = fileset;
  if (config.segmenterBuffer) segModel = { modelAssetBuffer: new Uint8Array(config.segmenterBuffer) };
  else if (config.segmenterUrl) segModel = { modelAssetPath: config.segmenterUrl };
  const model = config.modelBuffer
    ? { modelAssetBuffer: new Uint8Array(config.modelBuffer) }
    : { modelAssetPath: config.modelUrl };
  const options = {
    baseOptions: Object.assign({ delegate: 'GPU' }, model),
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    minFaceDetectionConfidence: 0.4,
    minFacePresenceConfidence: 0.4,
    minTrackingConfidence: 0.4
  };

  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, options);
    delegateInUse = 'GPU';
  } catch (gpuError) {
    // Some machines (VMs, blocklisted drivers) have no usable WebGL here.
    options.baseOptions.delegate = 'CPU';
    landmarker = await FaceLandmarker.createFromOptions(fileset, options);
    delegateInUse = 'CPU';
  }
  return delegateInUse;
}

function detect(bitmap, timestamp) {
  // MediaPipe requires strictly increasing timestamps in VIDEO mode.
  const ts = timestamp > lastTimestamp ? timestamp : lastTimestamp + 1;
  lastTimestamp = ts;

  const result = landmarker.detectForVideo(bitmap, ts);
  const faces = result.faceLandmarks;
  if (!faces || !faces.length) return null;

  const pose = poseFromLandmarks(faces[0], bitmap.width, bitmap.height);
  const shapes = blendshapeMap(result);

  // MediaPipe names sides from the subject's point of view; the canvas works
  // in image space, so left and right swap here.
  pose.jawOpen = ramp(shapes.jawOpen || 0, 0.06, 0.55);
  pose.blinkL = ramp(shapes.eyeBlinkRight || 0, 0.35, 0.75);
  pose.blinkR = ramp(shapes.eyeBlinkLeft || 0, 0.35, 0.75);
  pose.smile = ramp(((shapes.mouthSmileLeft || 0) + (shapes.mouthSmileRight || 0)) / 2, 0.08, 0.6);
  pose.brow = ramp(Math.max(shapes.browInnerUp || 0, ((shapes.browOuterUpLeft || 0) + (shapes.browOuterUpRight || 0)) / 2), 0.15, 0.7);
  return pose;
}

// Exposed so tools/pose-test.mjs can exercise the geometry without a camera.
self.__critterCamInternals = {
  poseFromLandmarks,
  resetBaseline: () => { noseRatioBaseline = NEUTRAL_NOSE_RATIO; }
};

self.onmessage = async (event) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === 'init') {
    try {
      const delegate = await init(msg);
      self.postMessage({ type: 'ready', delegate });
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error && error.message || error) });
    }
    return;
  }

  if (msg.type === 'frame') {
    const bitmap = msg.bitmap;
    if (!landmarker || busy) {
      // Always answer, even when skipping: the client waits for one reply per
      // frame it sends, and silence would stall the pump.
      if (bitmap && bitmap.close) bitmap.close();
      self.postMessage({ type: 'dropped' });
      return;
    }
    busy = true;
    const started = performance.now();
    try {
      const face = detect(bitmap, msg.ts);
      // Both models read the same frame, so segmenting costs no extra capture.
      // The timestamp has to keep rising for each, and detect() already
      // advanced it, so reuse the value it settled on.
      let mask = null;
      if (segmentWanted) {
        try { mask = segment(bitmap, lastTimestamp); } catch (error) { mask = null; }
      }
      const message = { type: 'result', face, ts: msg.ts, cost: performance.now() - started, mask };
      self.postMessage(message, mask ? [mask] : []);
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error && error.message || error) });
    } finally {
      busy = false;
      if (bitmap && bitmap.close) bitmap.close();
    }
    return;
  }

  if (msg.type === 'segment') {
    segmentWanted = !!msg.on;
    if (segmentWanted) ensureSegmenter();
    else closeSegmenter();
    return;
  }

  if (msg.type === 'close') {
    if (landmarker) landmarker.close();
    landmarker = null;
    closeSegmenter();
    self.close();
  }
};
