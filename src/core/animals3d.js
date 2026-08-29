/*
 * Critter Cam — 3D avatar renderer.
 *
 * Builds a lit 3D head per animal and renders it to an offscreen WebGL canvas,
 * which the compositor draws over the camera frame. Real geometry and lighting
 * give the volume that flat vector shapes cannot.
 *
 * Heads are built from the same specs as the 2D renderer in animals.js, so a
 * new animal needs no separate 3D description; `model3d` on a spec overrides
 * the derived proportions where an animal needs a specific shape.
 *
 * Runs in the page's MAIN world, so it must not touch `chrome.*`.
 */
(function () {
  'use strict';

  var NS = (globalThis.__CritterCam = globalThis.__CritterCam || {});
  if (NS.avatar3d) return;

  var DEG = Math.PI / 180;
  var MAX_YAW = 34 * DEG;
  var MAX_PITCH = 24 * DEG;

  function T() { return globalThis.THREE; }

  function isSupported() {
    if (!T() || typeof document === 'undefined') return false;
    try {
      var probe = document.createElement('canvas');
      return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
    } catch (error) {
      return false;
    }
  }

  /* ------------------------------------------------------------- geometry */

  function material(color, opts) {
    var three = T();
    var params = {
      color: new three.Color(color),
      roughness: opts && opts.roughness !== undefined ? opts.roughness : 0.78,
      metalness: 0,
      flatShading: false
    };
    return new three.MeshStandardMaterial(params);
  }

  function ellipsoid(rx, ry, rz, mat, segments) {
    var three = T();
    var mesh = new three.Mesh(new three.SphereGeometry(1, segments || 36, segments || 26), mat);
    mesh.scale.set(rx, ry, rz);
    return mesh;
  }

  /** Revolves a [radius, y] profile into a solid — good for tapered heads. */
  function lathe(profile, mat, segments) {
    var three = T();
    var points = [];
    for (var i = 0; i < profile.length; i++) {
      points.push(new three.Vector2(Math.max(profile[i][0], 0.0001), profile[i][1]));
    }
    return new three.Mesh(new three.LatheGeometry(points, segments || 40), mat);
  }

  function cone(radius, height, mat, segments) {
    var three = T();
    return new three.Mesh(new three.ConeGeometry(radius, height, segments || 20), mat);
  }

  /** Derives 3D proportions from an animal's 2D spec, with per-animal overrides. */
  function proportions(spec) {
    var m = spec.model3d || {};
    var skull = m.skull || null;
    var head = spec.head || { w: 1, h: 1 };
    var eyes = spec.eyes || { x: 0.2, y: 0, r: 0.08 };
    var ear = spec.ear || { type: 'none' };
    var muzzle = spec.muzzle;
    var nose = spec.nose || { y: 0.15, w: 0.08, h: 0.06 };

    if (!skull) skull = { rx: head.w * 0.5, ry: head.h * 0.46, rz: 0.44, y: -0.02 };
    var faceZ = (skull.rz || 0.42) * 0.82;

    return {
      skull: skull,
      snout: m.snout || {
        rx: muzzle ? muzzle.w * 0.46 : 0.24,
        ry: muzzle ? muzzle.h * 0.44 : 0.18,
        rz: 0.30,
        y: muzzle ? muzzle.y : nose.y + 0.05,
        z: faceZ * 0.72
      },
      eyes: m.eyes || {
        x: eyes.x, y: eyes.y, z: faceZ,
        r: eyes.r * 1.2,
        aspect: eyes.aspect || 0.92,
        tilt: eyes.tilt || 0,
        iris: (eyes.iris || 0.5) * eyes.r * 0.95,
        irisOffset: eyes.irisOffset || 0
      },
      ear: m.ear || (ear.type === 'none' ? null : {
        type: ear.type, w: ear.w, h: ear.h,
        x: ear.x, y: ear.y, z: -0.02,
        tilt: ear.tilt || 0, spread: 0.35
      }),
      nose: m.nose || (nose.hidden ? null : { y: nose.y, z: faceZ * 0.78, r: Math.max(nose.w, 0.05) * 0.9 }),
      brow: m.brow || null,
      horn: m.horn || null,
      mouth: m.mouth === null ? null : (m.mouth || (spec.mouth ? {
        y: spec.mouth.y, z: faceZ * 0.72, w: spec.mouth.w * 1.2, h: 0.045
      } : null)),
      jaw: m.jaw || { pivotY: 0.05, maxAngle: 20 * DEG }
    };
  }

  /**
   * Builds the head. Returns the group plus the parts that animate, so the
   * renderer can pose them per frame without rebuilding geometry.
   */
  function buildHead(spec) {
    var three = T();

    if (spec.model && NS.avatarModels) {
      // Model bytes may not have arrived yet: hand back an empty group now and
      // fill it in when they do, so no frame is blocked on a download.
      var shell = new three.Group();
      var shellParts = { lids: [], ears: [], brows: [], animate: function () {} };
      NS.avatarModels.request(spec.model.id)
        .then(function (buffer) { return NS.avatarModels.parse(buffer, spec.model); })
        .then(function (built) {
          shell.add(built.group);
          shellParts.animate = built.parts.animate;
          NS.avatarModels.lastReport = built.report;
        })
        .catch(function (error) {
          NS.avatarModels.lastError = String(error && error.message || error);
        });
      return { group: shell, parts: shellParts };
    }

    var P = proportions(spec);
    var group = new three.Group();
    var parts = { ears: [], lids: [], irises: [], jaw: null, brows: [] };

    var furMat = material(spec.fur);
    var shadeMat = material(spec.furShade || spec.fur, { roughness: 0.85 });
    var skinMat = material(spec.muzzleColor || spec.inner || '#dda684', { roughness: 0.62 });
    var darkMat = material(spec.eye || '#2a1c10', { roughness: 0.35 });
    var whiteMat = material(spec.eyeWhite || '#f6ece0', { roughness: 0.3 });

    // Skull: a lathed profile when the animal supplies one, else an ellipsoid.
    var skull;
    if (P.skull.profile) {
      skull = lathe(P.skull.profile, furMat, 44);
      skull.scale.set(P.skull.sx || 1, 1, P.skull.sz || 0.85);
    } else {
      skull = ellipsoid(P.skull.rx, P.skull.ry, P.skull.rz, furMat);
    }
    skull.position.y = -(P.skull.y || 0);
    group.add(skull);

    // Snout, forward of the face.
    var jaw = new three.Group();
    var snout = ellipsoid(P.snout.rx, P.snout.ry, P.snout.rz, skinMat);
    snout.position.set(0, -P.snout.y, P.snout.z);
    jaw.add(snout);
    group.add(jaw);
    parts.jaw = jaw;
    parts.jawPivot = P.jaw;

    if (P.nose) {
      var nostrilMat = material('#5a3320', { roughness: 0.45 });
      for (var ns = -1; ns <= 1; ns += 2) {
        var nostril = ellipsoid(P.nose.r * 0.30, P.nose.r * 0.42, P.nose.r * 0.22, nostrilMat, 16);
        nostril.position.set(ns * P.nose.r * 0.85, -P.nose.y, P.snout.z + P.snout.rz * 0.78);
        jaw.add(nostril);
      }
    }

    // Eyes: sclera, iris, and a fur-coloured lid that slides down to blink.
    for (var side = -1; side <= 1; side += 2) {
      var eye = new three.Group();
      eye.position.set(side * P.eyes.x, -P.eyes.y, P.eyes.z);
      eye.rotation.z = side * (P.eyes.tilt || 0);

      var eyeRy = P.eyes.r * (P.eyes.aspect === undefined ? 0.92 : P.eyes.aspect);
      var ball = ellipsoid(P.eyes.r, eyeRy, P.eyes.r * 0.62, whiteMat, 24);
      eye.add(ball);

      var irisRy = Math.min(P.eyes.iris, eyeRy * 0.86);
      var iris = ellipsoid(P.eyes.iris, irisRy, P.eyes.iris * 0.6, darkMat, 22);
      iris.position.set(0, -(eyeRy - irisRy) * P.eyes.irisOffset, P.eyes.r * 0.5);
      eye.add(iris);
      parts.irises.push(iris);

      if (P.eyes.gloss !== false) {
        var spark = ellipsoid(P.eyes.iris * 0.30, P.eyes.iris * 0.30, P.eyes.iris * 0.2,
          material('#ffffff', { roughness: 0.15 }), 14);
        spark.position.set(-P.eyes.iris * 0.36, irisRy * 0.34, P.eyes.r * 0.72);
        eye.add(spark);
      }

      parts.lids.push({ group: eye });

      group.add(eye);
    }

    // Brows.
    if (P.brow) {
      for (var bs = -1; bs <= 1; bs += 2) {
        var brow = new three.Mesh(
          new three.BoxGeometry(P.brow.w, P.brow.h, P.brow.d || 0.06),
          material(P.brow.color || spec.furShade)
        );
        brow.position.set(bs * P.brow.x, -P.brow.y, P.brow.z);
        brow.rotation.z = -bs * (P.brow.tilt || 0);
        brow.rotation.x = -0.25;
        group.add(brow);
        parts.brows.push({ mesh: brow, baseY: -P.brow.y });
      }
    }

    // Ears.
    if (P.ear) {
      for (var es = -1; es <= 1; es += 2) {
        var pivot = new three.Group();
        pivot.position.set(es * P.ear.x, -P.ear.y, P.ear.z);
        var shell;
        if (P.ear.type === 'round') {
          shell = ellipsoid(P.ear.w * 0.5, P.ear.h * 0.5, P.ear.w * 0.22, furMat, 24);
          shell.position.y = P.ear.h * 0.34;
        } else if (P.ear.type === 'leaf') {
          // A leaf: narrow at the base, widest around a third of the way out,
          // tapering to a soft point. A lathed profile is the only one of
          // these primitives that can actually taper.
          var w2 = P.ear.w * 0.5;
          var h2 = P.ear.h;
          shell = lathe([
            [0.30 * w2, 0.00], [0.72 * w2, 0.10 * h2], [0.96 * w2, 0.26 * h2],
            [1.00 * w2, 0.44 * h2], [0.90 * w2, 0.62 * h2], [0.66 * w2, 0.80 * h2],
            [0.34 * w2, 0.93 * h2], [0.00, 1.00 * h2]
          ], furMat, 26);
          shell.scale.z = 0.42;
        } else if (P.ear.type === 'long' || P.ear.type === 'floppy') {
          shell = ellipsoid(P.ear.w * 0.5, P.ear.h * 0.5, P.ear.w * 0.34, furMat, 24);
          shell.position.y = P.ear.type === 'floppy' ? -P.ear.h * 0.4 : P.ear.h * 0.45;
        } else {
          shell = cone(P.ear.w * 0.55, P.ear.h, furMat, 18);
          shell.scale.z = 0.42;
          shell.position.y = P.ear.h * 0.42;
        }
        pivot.add(shell);

        var innerMat = material(spec.inner || '#d79c82', { roughness: 0.7 });
        var innerShell = shell.clone();
        innerShell.material = innerMat;
        innerShell.scale.multiplyScalar(0.72);
        innerShell.position.z += P.ear.w * 0.14;
        innerShell.position.y = shell.position.y * 0.94;
        pivot.add(innerShell);

        pivot.rotation.z = -es * (P.ear.tilt || 0);
        pivot.rotation.y = es * P.ear.spread;
        group.add(pivot);
        parts.ears.push({ pivot: pivot, side: es, baseZ: pivot.rotation.z });
      }
    }

    // Horns.
    if (P.horn) {
      var hornMat = material(P.horn.color || '#e6d6b4', { roughness: 0.55 });
      for (var hs = -1; hs <= 1; hs += 2) {
        var horn = cone(P.horn.r, P.horn.h, hornMat, 16);
        horn.position.set(hs * P.horn.x, -P.horn.y, P.horn.z || 0);
        horn.rotation.z = -hs * (P.horn.tilt || 0.9);
        group.add(horn);
      }
    }

    if (P.mouth) {
      var mouthMat = material(spec.mouthColor || '#4a2a16', { roughness: 0.6 });
      var mouth = ellipsoid(P.mouth.w, P.mouth.h, P.snout.rz * 0.7, mouthMat, 20);
      mouth.position.set(0, -P.mouth.y, P.mouth.z);
      jaw.add(mouth);
    }

    if (spec.build3d) spec.build3d(three, group, parts, spec, { material: material, ellipsoid: ellipsoid, cone: cone });

    return { group: group, parts: parts };
  }

  /* ------------------------------------------------------------- renderer */

  function createRenderer() {
    var three = T();
    if (!three || !isSupported()) return null;

    var canvas = document.createElement('canvas');
    var renderer;
    try {
      renderer = new three.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
      });
    } catch (error) {
      return null;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = three.SRGBColorSpace;
    renderer.toneMapping = three.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    var scene = new three.Scene();
    var camera = new three.OrthographicCamera(-1, 1, 1, -1, -100, 100);
    scene.add(camera);

    // Three-point-ish lighting: soft sky fill, a key from upper front-left,
    // and a dim rim so the silhouette separates from the camera image.
    var hemi = new three.HemisphereLight(0xdfe8ff, 0x5a4632, 0.72);
    scene.add(hemi);
    var key = new three.DirectionalLight(0xfff0d8, 1.35);
    key.position.set(-0.55, 0.85, 1.1);
    scene.add(key);
    var rim = new three.DirectionalLight(0xa8c4ff, 0.45);
    rim.position.set(0.7, 0.25, -0.8);
    scene.add(rim);

    var head = null;
    var headId = null;
    var pixelRatio = 1;
    var sized = { w: 0, h: 0 };

    function ensureHead(spec) {
      if (headId === spec.id && head) return head;
      if (head) scene.remove(head.group);
      head = buildHead(spec);
      headId = spec.id;
      scene.add(head.group);
      return head;
    }

    function resize(width, height) {
      if (sized.w === width && sized.h === height) return;
      sized.w = width;
      sized.h = height;
      // Keep the buffer sane on very large cameras; the head is small on screen.
      pixelRatio = Math.min(1, 1280 / Math.max(width, 1));
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.near = -Math.max(width, height) * 4;
      camera.far = Math.max(width, height) * 4;
      camera.updateProjectionMatrix();
    }

    /**
     * Poses and renders the head.
     * @param {object} spec animal spec
     * @param {object} pose {x, y, size} in pixels, plus roll/yaw/pitch
     * @param {object} params expression values
     * @returns {HTMLCanvasElement|null} the layer to composite, or null
     */
    function render(spec, pose, params, width, height) {
      if (!(width > 0) || !(height > 0)) return null;
      resize(width, height);
      var built = ensureHead(spec);
      var group = built.group;
      var parts = built.parts;

      group.position.set(pose.x - width / 2, -(pose.y - height / 2), 0);
      group.scale.setScalar(pose.size);
      group.rotation.set(
        (params.pitch || 0) * MAX_PITCH,
        (params.yaw || 0) * MAX_YAW,
        -(pose.roll || 0)
      );

      // Imported models drive their own expression channels; the built-in
      // animals have none and are posed piece by piece below.
      if (parts.animate) parts.animate(params);

      if (parts.jaw) {
        parts.jaw.rotation.x = -(params.jawOpen || 0) * parts.jawPivot.maxAngle;
      }
      for (var i = 0; i < parts.lids.length; i++) {
        var blink = i === 0 ? (params.blinkL || 0) : (params.blinkR || 0);
        parts.lids[i].group.scale.y = 1 - 0.92 * blink;
      }
      for (var e = 0; e < parts.ears.length; e++) {
        var ear = parts.ears[e];
        ear.pivot.rotation.z = ear.baseZ - ear.side * (params.earSwing || 0) * 0.6;
      }
      for (var b = 0; b < parts.brows.length; b++) {
        parts.brows[b].mesh.position.y = parts.brows[b].baseY + (params.brow || 0) * 0.05;
      }

      renderer.render(scene, camera);
      return canvas;
    }

    return {
      render: render,
      /** Renders one head centred in a square, for pickers and previews. */
      thumbnail: function (spec, size) {
        var scale = spec.thumbScale ? spec.thumbScale * 0.78 : 0.46;
        render(spec, { x: size / 2, y: size * (spec.thumbCentre || 0.54), size: size * scale, roll: 0 }, {}, size, size);
        return canvas;
      },
      dispose: function () {
        if (head) scene.remove(head.group);
        head = null;
        headId = null;
        try { renderer.dispose(); } catch (error) { /* context already gone */ }
      }
    };
  }

  var shared = null;
  var sharedTried = false;

  NS.avatar3d = {
    isSupported: isSupported,
    createRenderer: createRenderer,
    buildHead: buildHead,
    /** Lazily created renderer for thumbnail grids. */
    sharedRenderer: function () {
      if (sharedTried) return shared;
      sharedTried = true;
      shared = createRenderer();
      return shared;
    },
    /**
     * Paints one head into a 2D canvas, in 3D where available and flat
     * otherwise. Used by the popup and preview pickers.
     */
    paintThumb: function (ctx, spec, size, params) {
      var renderer = this.sharedRenderer();
      if (renderer) {
        try {
          var layer = renderer.thumbnail(spec, size);
          ctx.drawImage(layer, 0, 0, size, size);
          return true;
        } catch (error) { /* fall through to flat art */ }
      }
      return false;
    }
  };
})();
