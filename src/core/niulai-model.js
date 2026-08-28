/*
 * Critter Cam — Niulai's head, built from the reference turnaround.
 *
 * The shape is not modelled by eye. `src/core/niulai-shape.js` carries
 * cross-sections extracted from the three-view sheet by
 * tools/extract-niulai.py — a half-width per height from the front view and a
 * depth range per height from the side view — and this file lofts them into a
 * surface. The silhouette therefore matches the reference both head-on and in
 * profile by construction.
 *
 * Colours come from the same extraction: the muzzle is painted onto the loft
 * from the front view's pale region rather than modelled as a separate ball.
 */
(function () {
  'use strict';

  var NS = (globalThis.__CritterCam = globalThis.__CritterCam || {});
  if (NS.buildNiulaiHead) return;

  var TAU = Math.PI * 2;
  var SEGMENTS = 56;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function smoothstep(edge0, edge1, x) {
    var t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  /** Sections sorted from the crown down. */
  function ordered(shape) {
    return shape.sections.slice().sort(function (a, b) { return b.y - a.y; });
  }

  function sectionAt(secs, y) {
    if (y >= secs[0].y) return secs[0];
    if (y <= secs[secs.length - 1].y) return secs[secs.length - 1];
    for (var i = 0; i < secs.length - 1; i++) {
      var s0 = secs[i], s1 = secs[i + 1];
      if (y <= s0.y && y >= s1.y) {
        var t = (s0.y - y) / (s0.y - s1.y || 1);
        return {
          y: y,
          a: s0.a + (s1.a - s0.a) * t,
          b: s0.b + (s1.b - s0.b) * t,
          cx: s0.cx + (s1.cx - s0.cx) * t,
          zc: s0.zc + (s1.zc - s0.zc) * t
        };
      }
    }
    return secs[secs.length - 1];
  }

  /** Depth of the head's surface at a point on its front, for placing features. */
  function surfaceZ(secs, x, y) {
    var s = sectionAt(secs, y);
    var sin = clamp((x - s.cx) / (s.a || 1), -1, 1);
    return s.zc + s.b * Math.sqrt(Math.max(0, 1 - sin * sin));
  }

  /**
   * Half-width of the muzzle at a height, from the front view's pale region.
   * Rows are [y, halfWidth]; the character is symmetric, so one number does.
   */
  function muzzleHalf(rows, y) {
    if (y > rows[0][0] || y < rows[rows.length - 1][0]) return 0;
    for (var i = 0; i < rows.length - 1; i++) {
      var r0 = rows[i], r1 = rows[i + 1];
      if (y <= r0[0] && y >= r1[0]) {
        var t = (r0[0] - y) / (r0[0] - r1[0] || 1);
        return r0[1] + (r1[1] - r0[1]) * t;
      }
    }
    return 0;
  }

  /**
   * Lofts the cross-sections into a head, painting the muzzle from the
   * extracted front-view region.
   */
  function loftHead(three, shape, colors) {
    var secs = ordered(shape);
    var rings = secs.length;
    var positions = [];
    var colorList = [];
    var indices = [];

    var fur = new three.Color(colors.fur);
    var furShade = new three.Color(colors.furShade);
    var muzzle = new three.Color(colors.muzzle);

    for (var i = 0; i < rings; i++) {
      var s = secs[i];
      for (var j = 0; j <= SEGMENTS; j++) {
        var phi = (j / SEGMENTS) * TAU;
        var sin = Math.sin(phi);
        var cos = Math.cos(phi);          // +1 at the front of the head
        var x = s.cx + s.a * sin;
        var z = s.zc + s.b * cos;
        positions.push(x, s.y, z);

        // Muzzle where the surface faces forward and the point falls inside
        // the pale region measured off the front view.
        var blend = 0;
        var half = muzzleHalf(shape.muzzleRows, s.y);
        if (half > 0 && cos > 0) {
          var inside = half - Math.abs(x);
          blend = smoothstep(-0.055, 0.075, inside) * smoothstep(0.02, 0.40, cos);
        }
        var base = fur.clone().lerp(furShade, smoothstep(0.35, 0.95, Math.abs(sin)) * 0.45);
        var c = base.lerp(muzzle, blend);
        colorList.push(c.r, c.g, c.b);
      }
    }

    for (var r = 0; r < rings - 1; r++) {
      for (var q = 0; q < SEGMENTS; q++) {
        var a0 = r * (SEGMENTS + 1) + q;
        var b0 = a0 + SEGMENTS + 1;
        indices.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
      }
    }

    /*
     * Close the crown and the jaw with a domed cap: a quarter-ellipse of extra
     * rings rather than a single pole vertex, which would leave a cone.
     */
    function cap(ringIndex, sec, height, flip) {
      var STEPS = 5;
      var prevRow = ringIndex;
      for (var k = 1; k <= STEPS; k++) {
        var t = k / STEPS;
        var shrink = Math.cos(t * Math.PI / 2);
        var rise = Math.sin(t * Math.PI / 2) * height;
        var rowStart = positions.length / 3;
        var last = k === STEPS;
        var count = last ? 1 : SEGMENTS + 1;
        for (var q = 0; q < count; q++) {
          var phi = (q / SEGMENTS) * TAU;
          var rx = last ? 0 : sec.a * shrink;
          var rz = last ? 0 : sec.b * shrink;
          positions.push(sec.cx + rx * Math.sin(phi),
                         sec.y + (flip ? -rise : rise),
                         sec.zc + rz * Math.cos(phi));
          colorList.push(fur.r, fur.g, fur.b);
        }
        for (var q2 = 0; q2 < SEGMENTS; q2++) {
          var a1 = prevRow + q2;
          var b1 = last ? rowStart : rowStart + q2;
          var b2 = last ? rowStart : rowStart + q2 + 1;
          if (flip) indices.push(a1, b1, a1 + 1, a1 + 1, b1, b2);
          else indices.push(a1, a1 + 1, b1, a1 + 1, b2, b1);
        }
        prevRow = rowStart;
      }
    }
    cap(0, secs[0], 0.055, false);
    cap((rings - 1) * (SEGMENTS + 1), secs[rings - 1], 0.065, true);

    var geo = new three.BufferGeometry();
    geo.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new three.Float32BufferAttribute(colorList, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  /** A tapering leaf, revolved then flattened — the reference ear shape. */
  function earGeometry(three, length, width) {
    var pts = [];
    var profile = [
      [0.34, 0.00], [0.72, 0.12], [0.95, 0.30], [1.00, 0.48],
      [0.88, 0.66], [0.62, 0.82], [0.32, 0.93], [0.00, 1.00]
    ];
    for (var i = 0; i < profile.length; i++) {
      pts.push(new three.Vector2(Math.max(profile[i][0] * width * 0.5, 0.0006), profile[i][1] * length));
    }
    return new three.LatheGeometry(pts, 24);
  }

  function buildNiulaiHead(three, kit) {
    var shape = NS.niulaiShape;
    var colors = shape.colors;
    var secs = ordered(shape);
    var group = new three.Group();
    var parts = { lids: [], ears: [], brows: [], irises: [] };

    var skinMat = kit.material(colors.muzzle, { roughness: 0.66 });
    var furMat = kit.material(colors.fur, { roughness: 0.8 });

    var headMat = new three.MeshStandardMaterial({
      vertexColors: true, roughness: 0.82, metalness: 0
    });
    var head = new three.Mesh(loftHead(three, shape, colors), headMat);
    group.add(head);

    // --- ears: base on the skull edge, tip where the front view puts it ----
    var earTipX = Math.abs(shape.ear.tipX);
    var earTipY = shape.ear.tipY;
    var earBaseY = (shape.ear.topY + shape.ear.bottomY) / 2;
    var baseSec = sectionAt(secs, earBaseY);
    var earBaseX = baseSec.a * 0.94;
    var dx = earTipX - earBaseX;
    var dy = earTipY - earBaseY;
    var earLength = Math.sqrt(dx * dx + dy * dy);
    var earWidth = (shape.ear.topY - shape.ear.bottomY) * 0.62;
    var earGeo = earGeometry(three, earLength, earWidth);

    for (var es = -1; es <= 1; es += 2) {
      var pivot = new three.Group();
      pivot.position.set(es * earBaseX, earBaseY, baseSec.zc - 0.02);
      pivot.rotation.z = -es * Math.atan2(dx, dy);
      pivot.rotation.y = es * 0.42;

      var shell = new three.Mesh(earGeo, furMat);
      shell.scale.z = 0.34;
      pivot.add(shell);

      var innerMat = kit.material(colors.muzzle, { roughness: 0.7 });
      var inner = new three.Mesh(earGeo, innerMat);
      inner.scale.set(0.66, 0.86, 0.20);
      inner.position.set(0, earLength * 0.06, earWidth * 0.10);
      pivot.add(inner);

      group.add(pivot);
      parts.ears.push({ pivot: pivot, side: es, baseZ: pivot.rotation.z });
    }

    // --- eyes -------------------------------------------------------------
    var eye = shape.features.eye;
    var eyeX = Math.abs(eye.x);
    var eyeZ = surfaceZ(secs, eyeX, eye.y);
    var darkMat = kit.material('#191110', { roughness: 0.32 });
    var glossMat = kit.material('#ffffff', { roughness: 0.12 });

    for (var s2 = -1; s2 <= 1; s2 += 2) {
      var socket = new three.Group();
      socket.position.set(s2 * eyeX, eye.y, eyeZ - eye.halfW * 0.35);

      var ball = kit.ellipsoid(eye.halfW, eye.halfH, eye.halfW * 0.62, darkMat, 24);
      socket.add(ball);
      var spark = kit.ellipsoid(eye.halfW * 0.26, eye.halfH * 0.30, eye.halfW * 0.2, glossMat, 12);
      spark.position.set(-s2 * eye.halfW * 0.28, eye.halfH * 0.34, eye.halfW * 0.5);
      socket.add(spark);

      group.add(socket);
      parts.lids.push({ group: socket });
    }

    // --- brows ------------------------------------------------------------
    var brow = shape.features.brow;
    var browX = Math.abs(brow.x);
    var browZ = surfaceZ(secs, browX, brow.y);
    var browMat = kit.material('#4b4750', { roughness: 0.6 });
    for (var s3 = -1; s3 <= 1; s3 += 2) {
      var bar = kit.ellipsoid(brow.halfW * 0.86, 0.021, 0.03, browMat, 18);
      bar.position.set(s3 * browX, brow.y, browZ - 0.01);
      bar.rotation.z = -s3 * 0.10;
      group.add(bar);
      parts.brows.push({ mesh: bar, baseY: brow.y });
    }

    // --- mouth ------------------------------------------------------------
    var mouthY = -0.29;
    var mouthZ = surfaceZ(secs, 0, mouthY);
    var jaw = new three.Group();
    var smileGeo = new three.TorusGeometry(0.135, 0.011, 8, 26, 1.95);
    var smile = new three.Mesh(smileGeo, kit.material(colors.muzzleShade, { roughness: 0.75 }));
    smile.position.set(0, mouthY + 0.03, mouthZ - 0.012);
    smile.rotation.z = (Math.PI - 1.95) / 2 + Math.PI;
    jaw.add(smile);

    var open = kit.ellipsoid(0.115, 0.012, 0.05, kit.material('#5c2018', { roughness: 0.6 }), 20);
    // `ellipsoid` sizes the mesh through its scale, so the animation has to
    // multiply that base rather than assign a fresh scale.
    var openBase = open.scale.clone();
    open.position.set(0, mouthY - 0.01, mouthZ - 0.03);
    jaw.add(open);
    group.add(jaw);
    parts.jaw = jaw;
    parts.mouthOpen = open;

    // Nostrils, set into the front of the muzzle.
    var nostrilMat = kit.material(colors.muzzleShade, { roughness: 0.7 });
    for (var n = -1; n <= 1; n += 2) {
      var nz = surfaceZ(secs, 0.055, -0.10);
      var hole = kit.ellipsoid(0.026, 0.019, 0.016, nostrilMat, 14);
      hole.position.set(n * 0.055, -0.10, nz - 0.008);
      group.add(hole);
    }

    /** Custom posing: the head is one lofted surface, so the jaw is implied. */
    parts.animate = function (params) {
      for (var i = 0; i < parts.lids.length; i++) {
        var blink = i === 0 ? (params.blinkL || 0) : (params.blinkR || 0);
        parts.lids[i].group.scale.y = 1 - 0.9 * blink;
      }
      for (var e = 0; e < parts.ears.length; e++) {
        var ear = parts.ears[e];
        ear.pivot.rotation.z = ear.baseZ - ear.side * (params.earSwing || 0) * 0.5;
      }
      for (var b = 0; b < parts.brows.length; b++) {
        parts.brows[b].mesh.position.y = parts.brows[b].baseY + (params.brow || 0) * 0.045;
      }
      var jawOpen = params.jawOpen || 0;
      parts.mouthOpen.scale.set(
        openBase.x * (1 + jawOpen * 0.35),
        openBase.y * (1 + jawOpen * 9),
        openBase.z * (1 + jawOpen * 0.8)
      );
      parts.mouthOpen.position.y = mouthY - 0.01 - jawOpen * 0.055;
      smile.scale.set(1 - jawOpen * 0.5, 1 - jawOpen * 0.5, 1);
    };

    return { group: group, parts: parts };
  }

  NS.buildNiulaiHead = buildNiulaiHead;
})();
