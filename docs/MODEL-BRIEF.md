# Model brief — technical requirements for the 3D file

Paste everything below the rule into whatever is producing the model, together
with your own description of the character. This document specifies **only what
the file must be** so the extension can ingest it; the look of the model is
yours to direct.

When the file comes back, check it before wiring it in:

```bash
npm run validate:avatar -- path/to/head.glb
```

That verifies every requirement below and exits non-zero on anything that would
stop the model loading.

---

## Deliverable

A single **`.glb`** file containing the **head only** of the character. It will
be used as a live avatar in a webcam filter: face tracking positions, scales
and rotates it in real time. Return the `.glb` and nothing else.

## Format — a file failing any of these cannot be loaded

| | |
| --- | --- |
| Container | **glTF 2.0 binary (`.glb`)**, one self-contained file |
| Textures | **Embedded.** External `.bin` or image files will not resolve |
| Compression | **None.** Draco and Meshopt are unsupported — the decoders are absent, and a compressed file loads as nothing. Turn both off on export |
| File size | Under **8 MB**, ideally under 4 MB |
| Contents | Mesh and materials only. No cameras, no lights, no animation clips |

## Orientation, scale, origin

| | |
| --- | --- |
| Facing | The face looks down **+Z** |
| Up axis | **+Y** |
| Width | About **1 unit** at the widest point of the head |
| Origin | Near the centre of the head |

Scale and centring are corrected automatically on load, so approximate is fine.
**Facing is not corrected** — a model built facing −Z shows the back of its
head.

Model the **head only**. A full body is scaled down by its total width until
the head is tiny.

## Budget

| | Target | Hard ceiling |
| --- | --- | --- |
| Triangles | 5,000–40,000 | 150,000 |
| Texture size | 1024² | 2048² |
| Materials | 1–4 | 8 |

This runs every frame alongside face tracking on the viewer's machine.

## Materials

PBR metallic-roughness, opaque (or alpha-cutout), metalness 0 unless the
character is genuinely metallic. Blended transparency may sort incorrectly
against the camera image.

## Rig for expression — optional but wanted

Add **morph targets** (blend shapes / shape keys), each 0 at rest and 1 at full
expression, named exactly:

| Name | Effect |
| --- | --- |
| `jawOpen` | Mouth opens as if speaking |
| `eyeBlinkLeft` | Left eye closes |
| `eyeBlinkRight` | Right eye closes |
| `browInnerUp` | Brows raise |
| `mouthSmile` | Corners of the mouth lift |

ARKit and Ready Player Me naming is accepted unchanged — `eyeBlink_L`,
`eyeBlinkLeft` and `EyeBlinkL` all work. If morph targets are not possible,
name the jaw bone or node `Jaw` and it will be rotated instead. Any channel
omitted is skipped: a model with only `jawOpen` still animates its mouth.

If neither is possible, **sculpt the mouth open** — modelled with an interior:
lips parted, teeth and tongue as geometry. The jaw can then be swung shut to
make the resting pose, and opening it restores what you sculpted. Nothing can
add a mouth cavity to a head sculpted with its lips sealed, so that choice is
made once, by you, and cannot be undone later.

## Self-check before returning the file

- [ ] Single `.glb`, textures embedded, no Draco or Meshopt
- [ ] Under 8 MB
- [ ] 5,000–40,000 triangles
- [ ] Textures at most 2048²
- [ ] Head only — no body
- [ ] Facing +Z, +Y up, roughly 1 unit wide
- [ ] Morph targets named as above, 0 at rest and 1 at full
- [ ] Materials PBR metallic-roughness, opaque

State in your reply: triangle count, bounding-box dimensions, and the morph
target names exported.

## Exporting from Blender

File → Export → glTF 2.0, then: Format **glTF Binary (.glb)**; Transform
**+Y Up** ✅; Data → Mesh **Apply Modifiers** ✅; Data → **Shape Keys** ✅
(this is what exports morph targets); Compression ❌ off.
