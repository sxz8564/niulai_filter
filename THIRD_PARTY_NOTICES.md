# Third-party notices

Critter Cam bundles the following third-party components. They are vendored
rather than fetched at runtime, because Chrome extensions may not load remote
code and the filter has to keep working offline.

## MediaPipe Tasks Vision

- Files: `vendor/tasks-vision/vision_bundle.js`, `vendor/tasks-vision/wasm/*`
- Package: `@mediapipe/tasks-vision` 1.0.1
- Copyright 2023 The MediaPipe Authors
- Licence: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0

## MediaPipe Face Landmarker model

- File: `models/face_landmarker.task`
- Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- Copyright 2023 The MediaPipe Authors
- Licence: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0

## Three.js

- File: `vendor/three/three.iife.js`
- Package: `three` 0.185.1, tree-shaken to the classes this extension uses
- Copyright 2010-2025 Three.js Authors
- Licence: MIT — https://github.com/mrdoob/three.js/blob/dev/LICENSE

The bundle keeps its licence banner; `npm run build:three` reproduces it.

A copy of the Apache License 2.0 is included in `vendor/LICENSE-Apache-2.0.txt`.

## Niulai

- File: `models/avatars/niulai.glb`
- The character is the repository owner's own. The mesh was generated with
  Meshy AI from that design, then cropped, retextured and rigged by the tools
  in `tools/`. Check the terms of whichever generator plan produced a model
  before redistributing it.

## Scenes

- Files: `models/backgrounds/*.webp`
- Supplied by the repository owner and re-encoded to WebP at 1600x900 by the
  tools here. Like the character models, check the terms of whichever generator
  produced them before redistributing.

Everything else in this repository — the animal artwork, the camera pipeline
and the interface — is covered by the licence in `LICENSE`, which is MIT: it
lets anyone reuse it, the character included.
