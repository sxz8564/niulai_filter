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

A copy of the Apache License 2.0 is included in `vendor/LICENSE-Apache-2.0.txt`.

Everything else in this repository — the animal artwork, the camera pipeline
and the interface — is covered by the licence in `LICENSE`.
