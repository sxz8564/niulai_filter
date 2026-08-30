# Privacy policy — Critter Cam

Last updated: 29 August 2026

## The short version

Critter Cam does not collect, transmit, or store your camera feed, your face,
or anything about you. There is no server, no analytics, and no network
request to anywhere outside the extension itself.

## What the extension does with your camera

When a meeting site asks for your webcam, Critter Cam intercepts that request
and returns a filtered video stream instead of the raw one. To build it, the
extension:

1. receives the real camera stream from Chrome,
2. draws each frame to a canvas inside the page you are already on,
3. runs face detection on those frames to find where your head is,
4. if you have chosen a scene, runs body segmentation on the same frames to
   tell you apart from the room behind you, and paints the scene there,
5. draws an animal head over it and hands the meeting the result.

Every one of those steps happens on your own machine, inside the browser tab.
Frames are never uploaded, never saved to disk, and never leave the page. The
meeting site receives the filtered video exactly as it would have received your
camera — that, and nothing more, is what other people on the call see.

Face detection runs locally through MediaPipe Face Landmarker, and background
separation through MediaPipe's Selfie Segmenter. The inference runtime and both
model files are packaged inside the extension, so no part of either contacts a
remote service. The segmenter only runs while a scene is selected. The
extension makes no network requests of any kind; it works with the network
disconnected.

## What is stored

Your settings — the chosen avatar, head size, position, and the tracking
toggles — are stored with `chrome.storage.sync`. If you have Chrome Sync
enabled, Chrome copies that data between your own signed-in browsers, under
Google's terms rather than ours. It contains no personal information: an
avatar name, a few numbers, and some true/false values.

Nothing else is stored. No face data, no landmarks, no images, no identifiers,
and no history of when or where you used the extension.

## Permissions, and why each is needed

- **`storage`** — to remember your settings between sessions.
- **Site access on the listed meeting sites** (Google Meet, Zoom web, Microsoft
  Teams, Webex, Whereby, Discord, Gather) — the filter has to run inside the
  meeting page itself, because that is where the camera is requested. The
  extension runs on those sites only. It cannot read or act on any other site.

The extension does not request access to your browsing history, your tabs, your
bookmarks, your files, or any site beyond the ones listed above.

## Third parties

There are none. No data is sold, shared, or disclosed, because none is
collected.

## Changes

Any change to this policy will be committed to the repository, so its history
is public and auditable:
https://github.com/sxz8564/niulai_filter

## Contact

Open an issue at https://github.com/sxz8564/niulai_filter/issues
