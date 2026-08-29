# Publishing to the Chrome Web Store

Everything here is prepared. What is left needs your Google account, so it
cannot be automated from the repository.

## Build the upload

```bash
npm run package        # dist/critter-cam-<version>.zip
npm run store:shots    # screenshots, 1280x800
npm run store:promo    # store icon and both promo tiles
```

`store:promo` renders the avatar through the extension's own renderer, so the
artwork cannot drift from what the product actually shows.

`package` refuses to build if the manifest would fail review — an over-long
name or description, a missing icon size, a `web_accessible_resources` entry
that matches nothing, or a dev-only file that crept into a shipped directory.

Verify the zip itself, not the repository, before uploading it:

```bash
unzip -q dist/critter-cam-1.0.0.zip -d /tmp/storebuild
CRITTER_EXTENSION_DIR=/tmp/storebuild npm run test:smoke
```

That loads the unpacked upload as the extension and runs the full suite
against it. A file left out of the package fails here rather than in review.

## What you have to do yourself

1. Register at https://chrome.google.com/webstore/devconsole — one-off 5 USD
   fee, paid once per developer account, not per extension.
2. **New item → upload** `dist/critter-cam-<version>.zip`.
3. Fill in the listing, using the copy below.
4. Publish the repository (or host `PRIVACY.md` somewhere public) so the
   privacy-policy URL resolves. A URL that 404s is a rejection.
5. Submit. First review usually lands within a few days; extensions that touch
   the camera are looked at more closely than most.

## Listing copy

**Category:** Social & Communication · **Language:** English

**Summary** (132 characters, already in the manifest):

> Replaces your head with an animated animal, live in your webcam feed, so it
> works in Google Meet and other video calls.

**Description:**

> Critter Cam puts an animated animal head over yours in your webcam feed —
> and because it works on the camera itself, everyone on the call sees it, not
> just you.
>
> No virtual camera driver, no separate app, nothing to install outside Chrome.
>
> • Real face tracking. The head follows your position, turns and tilts with
>   you, and its mouth, eyes and brows follow your own.
> • Thirteen heads: Niulai, a textured 3D character whose mouth opens onto a
>   modelled interior, plus shiba, cat, fox, wolf, panda, bear, koala, tiger,
>   bunny, pig, frog and monkey.
> • Bring your own. Drop a .glb model in and it appears in the picker.
> • Works in Google Meet, Zoom on the web, Microsoft Teams, Webex, Whereby,
>   Discord and Gather.
> • Entirely offline. Face tracking runs on your machine; no frame ever leaves
>   your computer, and the extension makes no network requests at all.
>
> Tune the fit in the live preview — size, position, depth, smoothing — then
> join a meeting. Reload a meeting tab you already had open, because the camera
> is hooked as the page loads.

## Graphics

Every file below is produced by `npm run store:promo` (and `store:shots`) into
`dist/store/`, at exactly the sizes the dashboard accepts.

| Field | File | Size |
| --- | --- | --- |
| Store icon | `icon-128.png` | 128 x 128 |
| Screenshots | `1-live-preview.png`, `2-controls.png` | 1280 x 800 |
| Small promo tile | `promo-440x280.png` | 440 x 280 |
| Marquee promo tile | `promo-1400x560.png` | 1400 x 560 |

The marquee tile is optional, and only matters if the store ever features the
extension — but it costs nothing to supply and a listing without one looks
unfinished next to those that have it.

## URLs

| Field | Use |
| --- | --- |
| Homepage / Official URL | `https://github.com/sxz8564/niulai_filter` |
| Support URL | `https://github.com/sxz8564/niulai_filter/issues` |
| Privacy policy | `https://github.com/sxz8564/niulai_filter/blob/main/PRIVACY.md` |

All three need the repository to be public — a URL the reviewer cannot open is
a rejection.

One caveat on the official URL: where the dashboard asks for a *verified*
domain, github.com cannot be verified, because domain verification goes through
Google Search Console and you do not own github.com. If you hit that, publish
the repository to GitHub Pages — `sxz8564.github.io` is a domain you can verify
there — and point the field at that instead.

## Dashboard answers

**Single purpose** — the store asks for one sentence, and a vague answer is a
common rejection:

> Replaces the user's face with an animated animal head in their webcam video
> before it reaches a video-calling website.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's chosen avatar and fit settings so they persist between sessions. Nothing else is stored. |
| Host access to the meeting sites | The filter replaces `getUserMedia` inside the meeting page, which is the only place the camera is requested. The extension runs on the listed video-calling sites and nowhere else. |

**Are you using remote code?** — **No.** Every script, the WebAssembly runtime
and the face model are packaged in the upload. Nothing is fetched at runtime.

**Data use** — declare that the extension collects none of the listed
categories, and certify all three statements. They are true: the camera frames
are processed in the page and discarded, and the only stored data is the
settings object, which holds an avatar name, a few numbers and some toggles.
Note that `chrome.storage.sync` means Chrome may copy those settings between
the user's own signed-in browsers.

**Privacy policy URL** — point at `PRIVACY.md` in the public repository.

## Before you submit

- [ ] Retake the screenshots on a machine with a real camera. The ones the
      tool produces here come from Chrome's fake capture device, which is a
      flat green field — accurate, but it looks broken in a listing.
- [ ] Consider shortening the extension name. "Critter Cam — AR animal head
      for your webcam" is 44 characters against a 45 limit, and the store
      truncates long names in most places it shows them. "Critter Cam" with
      the rest as the summary reads better.
- [ ] Decide whether to publish publicly or unlisted. Unlisted still goes
      through review, but the item is reachable only by link — a reasonable
      way to hand it to a few people first.
- [ ] Bump `version` in `manifest.json` for every upload. The store rejects a
      version it has already seen.
