# Critter Cam

A Chrome extension that replaces your head with an animated animal, live in
your webcam feed — so Google Meet (and anything else in the browser) sends the
animal out to everyone on the call.

There is no virtual camera driver and nothing to install outside Chrome. The
extension intercepts `getUserMedia`, draws the animal head onto the camera
frames on a canvas, and hands the meeting the filtered stream instead.

![Twelve animal heads](docs/animals.png)

## What it does

- **13 animals** — Niulai the orange calf, plus shiba, cat, fox, wolf, panda,
  bear, koala, tiger, bunny, pig, frog and monkey — rendered as lit 3D models,
  so the head has real volume and turns with you in three dimensions.
- **Real face tracking** with MediaPipe Face Landmarker: the head follows your
  position, size and tilt, turns with you, and its mouth, eyes and brows follow
  your own.
- **Runs in the meeting, not just the preview.** Everyone on the call sees the
  animal.
- **Fully offline.** The model and runtime are bundled; nothing is uploaded and
  no frame ever leaves your machine.

## Install

1. Clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the repository folder.
4. The live preview page opens automatically. Click **Start camera**, pick an
   animal, and adjust the size and position.

## Use it in Google Meet

1. Open or reload **meet.google.com**. The filter hooks the camera as the page
   loads, so a tab that was already open needs a reload.
2. Join and turn your camera on. Your self-view shows the animal head, and that
   is exactly what the other participants receive.
3. Change animals or nudge the fit from the toolbar popup at any time — changes
   apply live.

Also works on Zoom web, Microsoft Teams, Webex, Whereby, Discord and Gather.
Native desktop apps cannot be filtered this way; use the browser version of the
meeting.

To add another site, add its URL pattern to `host_permissions`, both
`content_scripts` entries and `web_accessible_resources` in `manifest.json`.

## Settings

| Setting | What it does |
| --- | --- |
| 3D avatar | Lit 3D model. Turn it off for flat art — lighter on old machines, and the automatic fallback where WebGL is unavailable. |
| Head size | Head width as a multiple of your detected face width. Raise it until your own head is fully covered. |
| Up / down, Left / right | Nudges the head off the detected face centre. |
| Tilt with my head | Rotates the animal as you tilt. |
| Mouth & eyes follow me | Drives the mouth, blinks and brows from your expression. |
| Smoothing | Higher is calmer but lags slightly; lower snaps to the tracker. |
| Tracking rate | Face detections per second. Lower it to save CPU. |
| When my face is lost | Fade out, stay put, or hide immediately. |
| Pin in place | Skips tracking entirely and parks the head at a fixed spot. Useful on slow machines. |
| Show tracker overlay | Draws the tracker box and pose numbers — for debugging fit. |

## How it works

```
Google Meet
    │  navigator.mediaDevices.getUserMedia()
    ▼
src/page/patch.js          MAIN world — swaps in a canvas stream
    │  real camera track → hidden <video> → <canvas> → captureStream()
    │                                          ▲
    │                            src/core/compositor.js draws the head
    │                                          │ smoothed pose
    ├── postMessage ──► src/content/bridge.js  │  isolated world
    │                        │                 │
    │                        ▼                 │
    │            src/core/detector.worker.js ──┘
    │            MediaPipe Face Landmarker on extension-origin worker
    ▼
filtered MediaStream → the meeting
```

Three details are load-bearing:

- **The patch runs in the page's MAIN world** at `document_start`, because it
  has to replace `getUserMedia` before the meeting app captures a reference to
  it. That world has no `chrome.*` APIs, so settings and face poses arrive by
  `postMessage` from the content-script bridge.
- **The detector runs in a worker created from the extension's origin.** Google
  Meet's content security policy governs anything the page loads, but not an
  extension-origin worker, so the WebAssembly runtime loads reliably there. It
  is a *classic* worker: MediaPipe loads its wasm with `importScripts()`, which
  module workers do not have.
- **The camera is never dropped on failure.** If the pipeline cannot start, the
  original camera stream is handed back untouched rather than a black frame.

## Development

```bash
npm install          # Playwright, for the dev tools only
npm run test:pose    # head-pose geometry checks, no camera needed
npm run test:smoke   # loads the extension in Chromium with a fake camera
npm run icons        # regenerates icons/*.png from the Niulai renderer
```

`tools/smoke-test.mjs` is the useful one: it loads the unpacked extension,
checks that the MediaPipe worker starts, that `getUserMedia` is intercepted on
a real host page, and that the animal head reaches the outgoing stream. It
writes screenshots to `.smoke/`.

### Adding an animal

Animals in `src/core/animals.js` are data, not drawing code. Copy an entry in
`SPECS` and change the palette and the ear/eye/muzzle numbers. The picker, the
preview and the icons all pick it up automatically.

Each spec drives two renderers. `src/core/animals3d.js` builds a lit 3D head
from the same numbers, so a new animal gets a 3D model for free; add a
`model3d` block to override the derived proportions and a `build3d` function
for parts the generic builder has no concept of. The flat vector art in
`animals.js` stays as the fallback for machines without WebGL, where a
`markings` function adds anything distinctive.

The Three.js bundle in `vendor/three/` is built from `tools/three-entry/` with
`npm run build:three`; only the classes the renderer uses are pulled in.

Niulai is the exception to all of the above: its head is not modelled from
numbers at all. `tools/extract-niulai.py` scans the three-view reference in
`docs/reference/` and writes `src/core/niulai-shape.js` — a half-width per
height from the front view, a depth range per height from the side view, the
muzzle outline, feature positions, and a sampled palette.
`src/core/niulai-model.js` lofts those cross-sections into a surface, so the
silhouette matches the reference head-on and in profile by construction, and
paints the muzzle onto it from the measured pale region. Re-run the extractor
after changing the reference:

```bash
python3 tools/extract-niulai.py   # needs Pillow
```

## Privacy

Everything runs locally. The camera frames go to a canvas in your own browser,
the face model runs on your machine, and the extension makes no network
requests. The only stored data is your settings, in `chrome.storage.sync`.

## Licence

MIT — see [LICENSE](LICENSE). Bundled MediaPipe components are Apache 2.0; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
