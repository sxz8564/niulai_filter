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

> Replaces your head with an animated animal, live in your webcam feed, so
> everyone on your video call sees the animal, not you.

A single brand name used in a sentence is ordinary and not what the spam policy
targets — but after a keyword-spam rejection there is no reason to keep one in
the one field that appears under the title. Changing it means editing
`manifest.json`, bumping the version and re-uploading, so do it in the same
round as any other package change rather than on its own.

**Description:**

> Critter Cam puts an animated animal head over yours in your webcam feed.
> Because it works on the camera itself, everyone on the call sees it — not
> just you.
>
> No virtual camera driver, no separate app, nothing to install outside Chrome.
>
> What it does
>
> • Real face tracking. The head follows your position, turns and tilts with
>   you, and its mouth, eyes and brows follow your own.
> • Six characters to choose from, each textured and rigged, with a mouth that
>   opens onto a modelled interior when you speak.
> • Bring your own. Drop a .glb model in and it appears in the picker.
> • Five painted scenes that stand in for the room behind you, or leave your
>   own room as it is. Off unless you pick one.
> • Entirely offline. Face tracking and background separation both run on your
>   machine, no frame ever leaves your computer, and the extension makes no
>   network requests at all.
>
> How to use it
>
> Open the preview from the toolbar, start your camera and pick a head. Adjust
> the size and position until you are covered, then join your meeting — reload
> the tab if it was already open, because the camera is hooked as a page loads.
>
> Critter Cam runs only on the video-calling sites it declares, which Chrome
> lists for you when you install it. It cannot see or act on any other site.

Do not list the supported sites by name here. A run of brand names reads as
keyword stuffing to the store's spam review, whatever the intent behind it —
that exact line got the first submission rejected. Chrome already shows the
site list at install, and the permission justification below is the right place
to enumerate them, because that field is asking which sites and why.

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

## Filling the form

The dashboard blocks publishing until every field below has an answer. Nothing
here is about the package — it is all listing metadata. Do the email first,
because verification is a round trip through your inbox.

### Settings page

- **Publisher contact email** — set it, then click through the verification
  mail. Publishing is blocked until it is verified.

### Store listing tab

- **Language** — English (United States), unless you plan to localise.
- **Category** — Communication. If the dropdown offers no such entry, use
  Social & Communication, or Just for Fun; nothing in review turns on it.
- **Icon** — upload `dist/store/icon-128.png`. This is separate from the icons
  inside the package; the manifest ones do not fill it in.
- **Screenshots** — upload `dist/store/1-live-preview.png` and
  `2-controls.png`. At least one is required.
- **Small promo tile** — `dist/store/promo-440x280.png`.
- **Marquee promo tile** — `dist/store/promo-1400x560.png`.
- **Detailed description** — the description under "Listing copy" above.

### Privacy practices tab

**Single purpose:**

> Critter Cam replaces the user's face with an animated animal head in their
> webcam video before it reaches a video-calling website. That is the
> extension's only function.

**Justification — `storage`:**

> Stores the user's chosen avatar and fit settings — head size, position,
> smoothing and a few toggles — so those choices persist between sessions. No
> other data is stored, and none is transmitted.

**Justification — host permissions:**

> The filter works by replacing getUserMedia inside the meeting page, which is
> the only place the camera is requested, so the extension's content scripts
> must run on the video-calling sites the user joins: Google Meet, Zoom on the
> web, Microsoft Teams, Webex, Whereby, Discord and Gather. The extension
> requests no other host access, reads no page content, and does nothing on any
> other site.

**Remote code** — answer **No, I am not using remote code**. If a justification
box appears anyway:

> All JavaScript, the WebAssembly face-tracking runtime and the face-landmark
> model are packaged inside the extension. It makes no network requests of any
> kind and evaluates no code fetched at runtime.

**Data usage** — leave every collected-data category unticked, then certify all
three statements. They are true and testable: no network requests, camera
frames processed in the page and discarded, and the only stored data is the
settings object.

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
