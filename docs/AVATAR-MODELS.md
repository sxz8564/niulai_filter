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
| `id` | yes | Unique key, stored in settings. Changing it resets anyone using that avatar |
| `name` | yes | Label in the picker |
| `file` | yes | Filename inside `models/avatars/` |
| `scale` | no | Multiplier on the automatic fit. `1.2` makes the head 20% bigger |
| `offset` | no | `[x, y, z]` shift after fitting, in head widths. Negative `y` moves it down |
| `rotation` | no | `[x, y, z]` degrees, applied before measuring. Use when the export faces the wrong way |
| `tint` | no | Swatch colour in the picker, and the flat-art fallback colour |
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
| Mouth never opens | No matching morph target — check the preview report, then rename or set `morphs` |
| Black or untextured | Textures referenced externally. Re-export with images embedded |
| Frame rate drops | Over budget (§3). Decimate the mesh and shrink textures |

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
