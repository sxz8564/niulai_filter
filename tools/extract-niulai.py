#!/usr/bin/env python3
"""
Derives Niulai's head geometry and palette from the three-view reference in
docs/reference/, and writes src/core/niulai-shape.js.

The front view gives a half-width per height; the side view gives a depth
range per height. Together they define a stack of elliptical cross-sections
that the renderer lofts into the head, so the silhouette matches the reference
from the front and in profile rather than being modelled by eye.

    python3 tools/extract-niulai.py
"""
import json
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs/reference/niulai-turnaround.jpg')
OUT = os.path.join(ROOT, 'src/core/niulai-shape.js')

im = Image.open(SRC).convert('RGB')
px = im.load()
W, H = im.size

# The sheet's background is pure white; the muzzle's lightest pink is not, so
# the test has to be strict or the muzzle reads as a hole in the silhouette.
def is_bg(c):
    return c[0] > 246 and c[1] > 246 and c[2] > 246

FRONT = (75, 404)
SIDE = (591, 874)

def row_runs(x0, x1, y, minlen=3):
    out, start = [], None
    for x in range(x0, x1):
        solid = not is_bg(px[x, y])
        if solid and start is None:
            start = x
        elif not solid and start is not None:
            if x - start >= minlen:
                out.append((start, x - 1))
            start = None
    if start is not None and x1 - start >= minlen:
        out.append((start, x1 - 1))
    return out

def body_run(x0, x1, y, centre):
    """Outer silhouette extent for a row.

    Scanning inward from both edges rather than taking a contiguous run,
    because specular highlights on the muzzle are near-white and would
    otherwise split the figure into fragments."""
    left = None
    for x in range(x0, x1):
        if not is_bg(px[x, y]):
            left = x
            break
    if left is None:
        return None
    right = None
    for x in range(x1 - 1, x0 - 1, -1):
        if not is_bg(px[x, y]):
            right = x
            break
    return (left, right)

def interior(x, y, pad=3):
    """True when a pixel is well inside the silhouette, not on its edge.

    Antialiasing along the outline blends fur into white, producing pale
    pixels that would otherwise be mistaken for muzzle."""
    for dy in range(-pad, pad + 1):
        for dx in range(-pad, pad + 1):
            if is_bg(px[x + dx, y + dy]):
                return False
    return True

# --- vertical extent of the head -------------------------------------------
FRONT_CENTRE = 241
HEAD_TOP = 76
HEAD_BOTTOM = 292           # below this the chest flares out behind the chin
SCALE = 180.0               # px per head width, from the widest skull row
ORIGIN_Y = 188              # image row treated as the model's y = 0

def to_model_y(img_y):
    return -(img_y - ORIGIN_Y) / SCALE

# --- cross-sections ---------------------------------------------------------
EAR_ZONE = (119, 186)       # rows where the ears touch the skull outline

def clean_front(img_y):
    run = body_run(FRONT[0], FRONT[1], img_y, FRONT_CENTRE)
    return None if not run else (run[1] - run[0]) / 2.0 / SCALE

above = clean_front(EAR_ZONE[0] - 2)
below = clean_front(EAR_ZONE[1] + 2)

sections = []
for img_y in range(HEAD_TOP, HEAD_BOTTOM + 1, 4):
    front = body_run(FRONT[0], FRONT[1], img_y, FRONT_CENTRE)
    side = body_run(SIDE[0], SIDE[1], img_y, 716)
    if not front or not side:
        continue
    half_width = (front[1] - front[0]) / 2.0 / SCALE
    centre_x = ((front[0] + front[1]) / 2.0 - FRONT_CENTRE) / SCALE
    if EAR_ZONE[0] <= img_y <= EAR_ZONE[1] and above and below:
        t = (img_y - EAR_ZONE[0]) / float(EAR_ZONE[1] - EAR_ZONE[0])
        half_width = above + (below - above) * t
        centre_x = 0.0
    # Side panel: the character faces left, so smaller x is further forward.
    z_front = (716 - side[0]) / SCALE
    z_back = (716 - side[1]) / SCALE
    sections.append({
        'y': round(to_model_y(img_y), 4),
        'a': round(half_width, 4),
        'cx': round(centre_x, 4),
        'zc': round((z_front + z_back) / 2.0, 4),
        'b': round((z_front - z_back) / 2.0, 4)
    })

# --- muzzle outline, as a front-view polygon --------------------------------
def is_muzzle(x, y):
    """Pale and desaturated, unlike the vivid orange fur, and well inside
    the silhouette so outline antialiasing cannot qualify."""
    r, g, b = px[x, y]
    if r < 195:
        return False
    if max(r, g, b) - min(r, g, b) > 48:
        return False
    return interior(x, y)

muzzle_rows = []
for img_y in range(140, HEAD_BOTTOM + 12, 3):
    xs = [x for x in range(150, 340) if is_muzzle(x, img_y)]
    if len(xs) > 8:
        muzzle_rows.append((img_y, min(xs), max(xs)))

# --- ears --------------------------------------------------------------------
# Ear extent: everything outside the interpolated skull width in the ear zone.
ear_pts = []
for img_y in range(100, 200):
    run = body_run(FRONT[0], FRONT[1], img_y, FRONT_CENTRE)
    if not run:
        continue
    if EAR_ZONE[0] <= img_y <= EAR_ZONE[1] and above and below:
        t = (img_y - EAR_ZONE[0]) / float(EAR_ZONE[1] - EAR_ZONE[0])
        skull_half = (above + (below - above) * t) * SCALE
    else:
        skull_half = (run[1] - run[0]) / 2.0
    if run[0] < FRONT_CENTRE - skull_half - 4:
        ear_pts.append((run[0], img_y))
ear = None
if ear_pts:
    tip_x = min(p[0] for p in ear_pts)
    ys = [p[1] for p in ear_pts]
    tip_y = [p[1] for p in ear_pts if p[0] <= tip_x + 3]
    ear = {
        'tipX': round((tip_x - FRONT_CENTRE) / SCALE, 4),
        'tipY': round(to_model_y(sum(tip_y) / len(tip_y)), 4),
        'topY': round(to_model_y(min(ys)), 4),
        'bottomY': round(to_model_y(max(ys)), 4)
    }

# --- eyes and brows ----------------------------------------------------------
def dark_blobs(y0, y1, thresh):
    pts = []
    for y in range(y0, y1):
        for x in range(160, 330):
            r, g, b = px[x, y]
            if r + g + b < thresh and interior(x, y, 2):
                pts.append((x, y))
    return pts

def span(vals, lo=0.04, hi=0.96):
    vals = sorted(vals)
    return vals[int(len(vals) * lo)], vals[min(len(vals) - 1, int(len(vals) * hi))]

def blob_box(pts, left):
    side = [p for p in pts if (p[0] < FRONT_CENTRE) == left]
    if len(side) < 12:
        return None
    xs = [p[0] for p in side]
    ys = [p[1] for p in side]
    # Keep only pixels near the centroid, then measure with percentiles, so a
    # few stray shadow pixels cannot inflate the feature.
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)
    near = [p for p in side if abs(p[0] - cx) < 26 and abs(p[1] - cy) < 18]
    if len(near) < 12:
        near = side
    xs = [p[0] for p in near]
    ys = [p[1] for p in near]
    x0, x1 = span(xs)
    y0, y1 = span(ys)
    return {
        'x': round(((x0 + x1) / 2.0 - FRONT_CENTRE) / SCALE, 4),
        'y': round(to_model_y((y0 + y1) / 2.0), 4),
        'halfW': round((x1 - x0) / 2.0 / SCALE, 4),
        'halfH': round((y1 - y0) / 2.0 / SCALE, 4)
    }

eye_pts = dark_blobs(148, 178, 235)
brow_pts = dark_blobs(120, 146, 350)
features = {
    'eye': blob_box(eye_pts, True),
    'brow': blob_box(brow_pts, True)
}

# --- palette -----------------------------------------------------------------
def median_patch(x, y, r=5):
    vals = []
    for yy in range(y - r, y + r + 1):
        for xx in range(x - r, x + r + 1):
            vals.append(px[xx, yy])
    vals.sort(key=lambda c: c[0] + c[1] + c[2])
    return vals[len(vals) // 2]

def hexc(c):
    return '#%02x%02x%02x' % c

muzzle_mid = muzzle_rows[len(muzzle_rows) // 2] if muzzle_rows else None
muzzle_x = (muzzle_mid[1] + muzzle_mid[2]) // 2 if muzzle_mid else 240
muzzle_y = muzzle_mid[0] if muzzle_mid else 240

colors = {
    'fur': hexc(median_patch(222, 118)),
    'furLit': hexc(median_patch(206, 96)),
    'furShade': hexc(median_patch(168, 205)),
    'muzzle': hexc(median_patch(muzzle_x, muzzle_y)),
    'muzzleShade': hexc(median_patch(muzzle_x, muzzle_y + 34)),
}

# Trim the chest: below the jaw the silhouette widens again, and that flare
# belongs to the body, not the head.
narrowest = min(range(len(sections)), key=lambda i: sections[i]['a'] if sections[i]['y'] < -0.2 else 9)
sections = sections[:narrowest + 1]

# Smooth: the measurements are quantised to whole pixels, which shows up as
# hard bands on the lofted surface.
def smoothed(key, window=2):
    out = []
    for i in range(len(sections)):
        lo = max(0, i - window)
        hi = min(len(sections), i + window + 1)
        vals = [sections[j][key] for j in range(lo, hi)]
        out.append(sum(vals) / len(vals))
    return out

for key in ('a', 'b', 'zc', 'cx'):
    vals = smoothed(key)
    for i, v in enumerate(vals):
        sections[i][key] = round(v, 4)

# The character is symmetric; measured asymmetry is highlight noise.
for sec in sections:
    sec['cx'] = 0.0

muzzle_sym = []
for y, a, b in muzzle_rows:
    half = (abs(a - FRONT_CENTRE) + abs(b - FRONT_CENTRE)) / 2.0 / SCALE
    my = to_model_y(y)
    # Rows above the eyeline are highlights and the pale patch between the
    # eyes, not muzzle; they would otherwise square off its top.
    if my > 0.0:
        continue
    muzzle_sym.append([round(my, 4), round(half, 4)])
muzzle_sym.sort(key=lambda r: -r[0])

sm = []
for i in range(len(muzzle_sym)):
    lo = max(0, i - 3); hi = min(len(muzzle_sym), i + 4)
    sm.append([muzzle_sym[i][0], round(sum(m[1] for m in muzzle_sym[lo:hi]) / (hi - lo), 4)])
muzzle_sym = sm

# Close the outline top and bottom so the painted region is a rounded form
# rather than a band with cut ends.
if muzzle_sym:
    muzzle_sym.insert(0, [round(muzzle_sym[0][0] + 0.055, 4), 0.02])
    muzzle_sym.append([round(muzzle_sym[-1][0] - 0.035, 4), 0.02])

# Below the jaw the front silhouette is chest, not head - but the pale muzzle
# still reads as the head's own outline there, so continue the sections with
# the muzzle's width and taper the depth to close the chin.
last = sections[-1]
for y, half in muzzle_sym:
    if y >= last['y'] - 0.005:
        continue
    if half < 0.06:
        continue          # the outline's synthetic closing rows, not silhouette
    t = min(1.0, (last['y'] - y) / 0.26)
    ease = min(1.0, t * 2.4)          # blend off the jaw width over ~0.11
    sections.append({
        'y': y,
        'a': round(last['a'] + (half - last['a']) * ease, 4),
        'cx': 0.0,
        'zc': round(last['zc'] * (1 - t * 0.5), 4),
        'b': round(max(last['b'] * (1 - t * 0.55), half * 0.75), 4)
    })

data = {
    'scale': SCALE,
    'sections': sections,
    'muzzleRows': muzzle_sym,
    'ear': ear,
    'features': features,
    'colors': colors
}

with open(OUT, 'w') as fh:
    fh.write('/*\n')
    fh.write(' * Niulai head shape, extracted from docs/reference/niulai-turnaround.jpg\n')
    fh.write(' * by tools/extract-niulai.py. Do not hand-edit: re-run the extractor.\n')
    fh.write(' *\n')
    fh.write(' * Cross-sections combine the front view (half width per height) with the\n')
    fh.write(' * side view (depth range per height); the renderer lofts them into a head\n')
    fh.write(' * whose silhouette matches the reference from both directions.\n')
    fh.write(' */\n')
    fh.write('(function () {\n  "use strict";\n')
    fh.write('  var NS = (globalThis.__CritterCam = globalThis.__CritterCam || {});\n')
    fh.write('  NS.niulaiShape = ')
    fh.write(json.dumps(data, indent=2).replace('\n', '\n  '))
    fh.write(';\n})();\n')

print(f'{len(sections)} cross-sections, {len(muzzle_rows)} muzzle rows')
print('ear:', ear)
print('features:', features)
print('colors:', colors)
print('wrote', os.path.relpath(OUT, ROOT))
