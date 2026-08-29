# Avatar model specification

Critter Cam can use your own 3D head models instead of its built-in animals.
This document is the contract: hand it to a modeller, paste it into a 3D
generator, or follow it yourself. A conforming example is committed at
[`docs/reference/example-head.glb`](reference/example-head.glb) — inspect it in
any glTF viewer to see the conventions applied.

The short version: **export a head as `.glb`, facing +Z, +Y up, roughly one
unit wide, uncompressed, under 8 MB.** Everything else is optional.

---

## 1. Format

| | |
| --- | --- |
| **Container** | `.glb` (preferred — one self-contained file) or `.gltf` with embedded buffers |
| **Version** | glTF 2.0 |
| **Textures** | Embedded in the file. External `.bin`/image references will not resolve |
| **Compression** | **None.** Draco and Meshopt decoders are not bundled, and a compressed model fails to load |
| **File size** | Under 8 MB. The extension ships the file, and every user downloads it |

Chrome extensions may not fetch remote code or assets, so the model is bundled
with the extension rather than downloaded at runtime.

## 2. Orientation, scale and origin

These three are what make a model line up with a face. Get them right and no
configuration is needed.

| | Requirement |
| --- | --- |
| **Facing** | The face looks down **+Z** (toward the camera) |
| **Up axis** | **+Y** up. Blender's glTF exporter does this conversion for you — leave *+Y Up* ticked |
| **Width** | About **1 unit** across at the widest point of the head. The loader measures and rescales anyway, so this is a convenience, not a hard rule |
| **Origin** | Centred on the head. The loader re-centres on the bounding box, so an origin at the feet or the neck is corrected automatically |

The loader normalises whatever you give it: it measures the bounding box,
scales so the width is one unit, and centres it. Use `scale`, `offset` and
`rotation` in the registry entry (§5) only when you want to override that.

**Model the head only.** A full body will be scaled down until the head is
tiny, because the fit is driven by overall width.

## 3. Budget

| | Recommended | Hard ceiling |
| --- | --- | --- |
| Triangles | 5k–40k | 150k |
| Texture size | 1024² | 2048² |
| Materials | 1–4 | 8 |
| File size | under 4 MB | 8 MB |

This runs every frame alongside face tracking, on whatever machine the user
has. A model that would be unremarkable in a game engine can still cost you
frames here.

## 4. Rigging for expression (optional)

Without any rig the head still tracks position, scale, tilt and turn. To make
the mouth and eyes follow the wearer, add **morph targets** (shape keys in
Blender) named from the table below. Matching is case-insensitive and ignores
separators, so `eyeBlink_L`, `eyeBlinkLeft` and `EyeBlinkL` are all accepted.

| Expression | Accepted names |
| --- | --- |
| Mouth opens | `jawOpen`, `mouthOpen`, `viseme_aa` |
| Left eye closes | `eyeBlinkLeft`, `eyeBlink_L`, `blinkLeft` |
| Right eye closes | `eyeBlinkRight`, `eyeBlink_R`, `blinkRight` |
| Brows raise | `browInnerUp`, `browUp`, `browRaise` |
| Smile | `mouthSmile`, `mouthSmileLeft`, `smile` |

Each target should read 0 at rest and 1 at full expression. ARKit and Ready
Player Me naming both work unchanged, so a model built for those pipelines
needs no extra work.

**If you have no morph targets**, name a bone or node `Jaw` (or `lowerJaw`,
`chin`) and the mouth will animate by rotating it. Nodes named `EarL` / `EarR`
sway with head movement.

Anything absent is skipped — a model with only `jawOpen` animates its mouth and
leaves the eyes alone.

## 5. Registry entry

Put the file in `models/avatars/` and add an entry to
`models/avatars/index.json`:

```json
[
  {
    "id": "niulai",
    "name": "Niulai",
    "file": "niulai.glb",
    "scale": 1.0,
    "offset": [0, -0.05, 0],
    "rotation": [0, 0, 0],
    "tint": "#fa650e",
    "jawDegrees": 16,
    "morphs": { "jawOpen": "mouth_open" },
    "nodes": { "jaw": "Bone_Jaw" }
  }
]
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique key, stored in settings. Must not collide with a built-in animal (`monkey`, `cat`, `fox`, …) — a clash is refused with a console warning. Changing it resets anyone using that avatar |
| `name` | yes | Label in the picker |
| `file` | yes | Filename inside `models/avatars/` |
| `scale` | no | Multiplier on the automatic fit. `1.2` makes the head 20% bigger |
| `offset` | no | `[x, y, z]` shift after fitting, in head widths. Negative `y` moves it down |
| `rotation` | no | `[x, y, z]` degrees, applied before measuring. Use when the export faces the wrong way |
| `tint` | no | Swatch colour in the picker, the flat-art fallback colour, and the colour applied to any untextured material in the model |
| `jawDegrees` | no | Rotation applied to a jaw *bone* at full open. Default 16 |
| `morphs` | no | Explicit morph names, when auto-matching picks the wrong target |
| `nodes` | no | Explicit node names for `jaw`, `earLeft`, `earRight` |

## 6. Commissioning and checking a model

To have someone else — or an AI 3D tool — build the model, hand them
[`MODEL-BRIEF.md`](MODEL-BRIEF.md). It restates this contract as a
self-contained prompt covering the file requirements only; pair it with your
own description of the character.

When a model comes back, check it before wiring it in:

```bash
node tools/validate-avatar.mjs path/to/head.glb
```

It reports bounds, triangle count, materials and which expression channels it
found, and exits non-zero for anything that would stop the model loading —
compression, external textures, an oversized file.

To see what the file actually contains, render it from four sides:

```bash
node tools/render-avatar.mjs path/to/head.glb sheet.png
```

Generators often return something other than a head: a full body, or a
turnaround with three figures standing side by side (the validator flags this
as *much wider than tall*). Cut the head out rather than re-prompting:

```bash
node tools/crop-avatar.mjs incoming.glb --list          # what is in there
node tools/crop-avatar.mjs incoming.glb head.glb --figure 0 --top 0.30
```

`--figure` picks a figure left to right, `--top` the fraction of its height to
keep, and `--box x0,y0,z0,x1,y1,z1` overrides both. Triangles are kept whole by
their centroid, node transforms are baked, the result is recentred, and normals,
UVs, vertex colours and the material — textures and all — come across with the
geometry. A source without normals gets smooth ones. `--slim` keeps only the
base colour map, dropping metallic-roughness, normal, occlusion and emissive.

Generators texture for print, not for video: 2K or 4K maps of a whole body,
several megabytes that every camera page then downloads. Shrink them:

```bash
node tools/shrink-textures.mjs head.glb head-small.glb --max 1024
```

Geometry, materials and UVs are untouched — only the image bytes change, so it
is safe to run after cropping. On the model shipped here, 1024px maps took the
file from 5.0 MB to 311 KB with no visible difference at video-call size.

### Rigging a head that came back without one

Most generators return a sculpt with no morph targets at all, and a face that
never moves reads as a mask. Rather than re-prompting for a rig that may never
arrive, build the shapes from the mesh that is already there:

```bash
node tools/rig-avatar.mjs head.glb rigged.glb
node tools/render-avatar.mjs rigged.glb rig-sheet.png --rig
```

It writes the five channels this extension drives — `jawOpen`,
`eyeBlinkLeft`, `eyeBlinkRight`, `browInnerUp`, `mouthSmile` — as deformations
of the existing geometry: the lower face hinges about a pivot behind the
muzzle, each eye region squashes about its own centre, the brow band lifts,
the mouth corners lift and widen.

The face is located by reading the base-colour texture. Every vertex is
sampled at its own UV; on a character painted with dark eyes and brows against
coloured fur, the dark pixels *are* the eyes and the pale ones the muzzle, and
that is far more reliable than guessing from the silhouette. A model with no
texture gets a jaw but no eyes — `--report` says what was found before you
commit to it:

```
eye left     0.063, 0.021, 0.087  radius 0.036, 12 brow verts
muzzle       0.001, -0.077, 0.125  y -0.155..0.032
```

`--rig` on the renderer draws each shape at rest, half and full, which is the
only way to judge one. Tune with `--jaw`, `--blink`, `--brow`, `--smile`, and
`--hinge` if the jaw swings the whole muzzle instead of dropping the chin.

An authored rig always beats a derived one, so ask for morph targets first;
this is what to do when the answer is no.

`render-avatar.mjs`, `shrink-textures.mjs` and `rig-avatar.mjs` need a
browser; if Playwright cannot download its own Chromium, point
`PLAYWRIGHT_CHROMIUM` at one already on disk.

## 7. Testing a model

Iterate without touching the registry:

1. Open the extension's **Live preview** page (toolbar popup → Live preview).
2. Under **Imported model**, choose your `.glb`.
3. It loads immediately, becomes the selected avatar, and a report appears:

```
size  1.04 x 1.31 x 0.98  (scaled by 0.962)
jaw   1 morph target(s)
blink 1 left, 1 right
brow  none
smile none
```

Read that report before anything else — it tells you whether the loader found
your rig. `jaw none - mouth will not move` means the naming did not match, and
the fix is a rename or a `morphs` override, not a re-export of the geometry.

Then start the camera and check the fit against your own face.

Once it is right, copy the file into `models/avatars/`, add its registry entry,
and reload the extension at `chrome://extensions`.

## 8. Troubleshooting

| Symptom | Cause |
| --- | --- |
| Nothing appears | Compression. Re-export with Draco and Meshopt off |
| Head faces away | Exported facing −Z. Set `"rotation": [0, 180, 0]` |
| Lying on its back | Exported Z-up. Set `"rotation": [-90, 0, 0]`, or tick *+Y Up* on export |
| Far too small | A full body was exported; the fit scales by total width. Export the head alone |
| Sits too high or low | Adjust `offset[1]`, or use the popup's **Up / down** slider |
| Mouth never opens | No matching morph target — check the preview report, then rename, set `morphs`, or build the shapes with `tools/rig-avatar.mjs` |
| Black or untextured | Textures referenced externally. Re-export with images embedded. A model with no materials at all is coloured by `tint` |
| Faceted, like cut glass | The export had no normals. They are computed on load, but exporting them is better |
| Does not appear in the picker | The `id` collides with a built-in animal — check the console and rename it |
| Frame rate drops | Over budget (§3). Decimate the mesh, and shrink textures with `tools/shrink-textures.mjs` |

## 9. Exporting from Blender

File → Export → **glTF 2.0 (.glb/.gltf)**, then:

- **Format**: glTF Binary (`.glb`)
- **Include**: Selected Objects, if the scene holds more than the head
- **Transform**: +Y Up ✅
- **Data → Mesh**: Apply Modifiers ✅, UVs ✅, Normals ✅
- **Data → Shape Keys**: ✅ — this is what exports morph targets
- **Compression**: ❌ off

Shape key names come across verbatim, so name them per §4 before exporting.

## 10. What is not supported

- Draco / Meshopt compression
- Skeletal animation clips (the head is posed by face tracking, not played back)
- External texture or buffer files
- Cameras and lights inside the model — the extension supplies its own
- Transparency-sorted materials; opaque and alpha-cutout are reliable, blended
  materials may sort oddly against the camera image
