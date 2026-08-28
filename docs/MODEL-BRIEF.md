# Model brief — prompt for a 3D-generating agent

Paste everything below the rule into whatever agent or tool is making the
model, and attach `docs/reference/niulai-turnaround.jpg` alongside it. The
brief is self-contained: it does not assume the other agent can see this
repository.

Swap **§4 Character** to commission a different avatar. Everything else is the
ingestion contract and should be left as-is.

When the file comes back, verify it before wiring it in:

```bash
node tools/validate-avatar.mjs path/to/head.glb
```

That checks the same requirements the brief states, and exits non-zero if
anything would stop the extension loading the file.

---

## Task

Produce a single **`.glb`** file containing the **head only** of the character
described in §4. It will be used as a live avatar in a webcam filter: face
tracking positions, scales and rotates it in real time over a video call.

Return only the `.glb` file. No scene, no rig beyond what §3 asks for, no
animation clips.

## 1. Format — a file failing any of these cannot be loaded

- **glTF 2.0**, binary container (`.glb`). One file.
- **Textures embedded.** External `.bin` or image files will not resolve.
- **No compression.** Draco and Meshopt are not supported; the decoders are
  not present and a compressed file loads as nothing. Turn both off on export.
- **Under 8 MB**, ideally under 4 MB.
- No cameras or lights in the file — the host supplies its own three-point rig.

## 2. Orientation, scale, origin

- The face looks down **+Z**. The top of the head is **+Y**.
- Roughly **1 unit wide** at the widest point of the head.
- Origin near the centre of the head.

Scale and centring are corrected automatically on load, so approximate is
fine — but **facing is not corrected**, so +Z matters. Model the head only: a
full body gets scaled down by its total width until the head is tiny.

## 3. Rig for expression — optional but strongly wanted

Add **morph targets** (blend shapes / shape keys), each reading 0 at rest and
1 at full expression, named exactly:

| Name | Effect |
| --- | --- |
| `jawOpen` | Mouth opens as if speaking |
| `eyeBlinkLeft` | Left eye closes |
| `eyeBlinkRight` | Right eye closes |
| `browInnerUp` | Brows raise |
| `mouthSmile` | Corners of the mouth lift |

ARKit and Ready Player Me naming is accepted unchanged. If morph targets are
not possible, name the jaw bone or node `Jaw` and it will be rotated instead.
Any channel you omit is simply skipped — a model with only `jawOpen` still
animates its mouth.

## 4. Character — Niulai

An orange bull calf: friendly, chunky, matte, with a large pale muzzle. See the
attached three-view reference sheet (front, side, back).

**Colours**, sampled from the reference — match these:

| Part | Hex |
| --- | --- |
| Fur | `#f77213` |
| Fur, lit | `#fe8a25` |
| Fur, shadow | `#cb4810` |
| Muzzle | `#e7d2cf` |
| Muzzle, shadow | `#d8bbb7` |

**Proportions**, measured from the reference. One unit = head width; `y` is
height above (+) or below (−) the head's centre:

| Feature | Measurement |
| --- | --- |
| Head | 1.00 wide × 1.26 tall × 1.16 deep |
| Widest | at y +0.04, just above centre |
| Deepest | at y −0.11, where the muzzle projects |
| Muzzle | spans y +0.02 down to −0.67; widest 0.66 across at y −0.25 |
| Ears | tips reach x ±0.78 at y +0.34, rising ~32° above horizontal from the upper sides |
| Eyes | centres at x ±0.22, y +0.15; small — 0.094 wide × 0.061 tall |
| Brows | at x ±0.21, y +0.29; about 0.25 wide and thin |

Character notes: the eyes are small and dark, set wide; the brows are thin dark
arcs well clear of them; the muzzle is a large soft pale mass with a gentle
smile and small nostrils; the ears are large, pointed, and angle up and out;
the surface is matte with a subtly crinkled, clay-like texture, not glossy.

## 5. Self-check before returning

- [ ] Single `.glb`, textures embedded, no Draco or Meshopt
- [ ] Under 8 MB
- [ ] 5,000–40,000 triangles (150,000 is a hard ceiling)
- [ ] Textures at most 2048², ideally 1024²
- [ ] Head only — no body, no neck stump below the jaw
- [ ] Facing +Z, +Y up
- [ ] Roughly 1 unit wide
- [ ] Morph targets named exactly as in §3, 0 at rest and 1 at full
- [ ] Materials are PBR metallic-roughness, opaque, metalness 0
- [ ] Colours match the table in §4

State in your reply: the triangle count, the bounding-box dimensions, and the
list of morph target names you exported.
