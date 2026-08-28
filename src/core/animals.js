/*
 * Critter Cam — animal head renderers.
 *
 * Every animal is vector art drawn with the Canvas 2D API, so the extension
 * ships no image assets and the heads stay sharp at any webcam resolution.
 *
 * Drawing space: the caller sets up a transform where (0, 0) is the centre of
 * the head, +y points down (screen coordinates) and 1 unit is one head width.
 * A renderer draws roughly within x in [-0.75, 0.75] and y in [-0.95, 0.75];
 * ears and other flourishes may reach past the head outline.
 *
 * Animals are data ("specs") interpreted by one shared renderer, so a new
 * animal is usually a colour palette plus a few shape numbers.
 */
(function () {
  'use strict';

  var NS = (globalThis.__CritterCam = globalThis.__CritterCam || {});
  if (NS.animals) return;

  var TAU = Math.PI * 2;

  /* ---------------------------------------------------------------- utils */

  function ellipse(ctx, x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(rx), Math.abs(ry), rot || 0, 0, TAU);
  }

  function fillEllipse(ctx, x, y, rx, ry, rot, color) {
    ellipse(ctx, x, y, rx, ry, rot);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /** Rounded head outline: wide at the cheeks, narrower at the chin. */
  function headPath(ctx, H) {
    var hw = H.w / 2;
    var hh = H.h / 2;
    var jaw = H.jaw;
    var chin = H.chin;
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.bezierCurveTo(hw * 0.74, -hh, hw, -hh * 0.46, hw, -hh * 0.02);
    ctx.bezierCurveTo(hw, hh * 0.40, hw * jaw, hh * 0.80, hw * chin, hh * 0.94);
    ctx.bezierCurveTo(hw * chin * 0.6, hh * 1.03, -hw * chin * 0.6, hh * 1.03, -hw * chin, hh * 0.94);
    ctx.bezierCurveTo(-hw * jaw, hh * 0.80, -hw, hh * 0.40, -hw, -hh * 0.02);
    ctx.bezierCurveTo(-hw, -hh * 0.46, -hw * 0.74, -hh, 0, -hh);
    ctx.closePath();
  }

  /* ------------------------------------------------------------------ ears */

  /** Ear outline in local space: base at (0, 0), growing up (or down if floppy). */
  function earPath(ctx, type, w, h) {
    var halfW = w / 2;
    ctx.beginPath();
    switch (type) {
      case 'round':
        ctx.ellipse(0, -h * 0.42, halfW, h * 0.5, 0, 0, TAU);
        break;
      case 'long':
        ctx.moveTo(-halfW, 0.04);
        ctx.bezierCurveTo(-halfW * 1.05, -h * 0.62, -halfW * 0.86, -h, 0, -h);
        ctx.bezierCurveTo(halfW * 0.86, -h, halfW * 1.05, -h * 0.62, halfW, 0.04);
        ctx.quadraticCurveTo(0, 0.13, -halfW, 0.04);
        break;
      case 'floppy':
        ctx.moveTo(-halfW, -0.02);
        ctx.bezierCurveTo(-halfW * 1.25, h * 0.42, -halfW * 1.05, h, 0, h);
        ctx.bezierCurveTo(halfW * 1.05, h, halfW * 1.25, h * 0.42, halfW, -0.02);
        ctx.quadraticCurveTo(0, -0.12, -halfW, -0.02);
        break;
      case 'spike':
        ctx.moveTo(-halfW, 0.03);
        ctx.quadraticCurveTo(-halfW * 0.55, -h * 0.55, 0, -h);
        ctx.quadraticCurveTo(halfW * 0.55, -h * 0.55, halfW, 0.03);
        ctx.quadraticCurveTo(0, 0.10, -halfW, 0.03);
        break;
      case 'tuft':
        ctx.moveTo(-halfW, 0.05);
        ctx.quadraticCurveTo(-halfW * 0.95, -h * 0.85, -halfW * 0.1, -h);
        ctx.quadraticCurveTo(halfW * 0.5, -h * 0.7, halfW, 0.05);
        ctx.quadraticCurveTo(0, 0.14, -halfW, 0.05);
        break;
      default: // 'triangle'
        ctx.moveTo(-halfW, 0.05);
        ctx.quadraticCurveTo(-halfW * 0.80, -h * 0.74, 0, -h);
        ctx.quadraticCurveTo(halfW * 0.80, -h * 0.74, halfW, 0.05);
        ctx.quadraticCurveTo(0, 0.15, -halfW, 0.05);
        break;
    }
    ctx.closePath();
  }

  function drawEar(ctx, spec, side, p) {
    var E = spec.ear;
    if (!E || E.type === 'none') return;
    ctx.save();
    ctx.translate(E.x * side + p.yaw * 0.04 * side, E.y + p.pitch * 0.03);
    ctx.rotate((E.tilt + p.earSwing * (E.swing === undefined ? 1 : E.swing)) * side);
    ctx.scale(1 - 0.14 * Math.abs(p.yaw), 1);

    earPath(ctx, E.type, E.w, E.h);
    ctx.fillStyle = E.color || spec.fur;
    ctx.fill();
    ctx.strokeStyle = E.edge || spec.furShade;
    ctx.lineWidth = 0.012;
    ctx.stroke();

    if (E.inner !== 0) {
      var t = E.inner === undefined ? 0.58 : E.inner;
      ctx.save();
      ctx.translate(0, E.type === 'floppy' ? 0.02 : -0.01);
      ctx.scale(t, t);
      earPath(ctx, E.type, E.w, E.h);
      ctx.fillStyle = E.innerColor || spec.inner;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ eyes */

  function drawEye(ctx, spec, side, p) {
    var E = spec.eyes;
    var open = clamp01(1 - (side < 0 ? p.blinkL : p.blinkR));
    var x = E.x * side;
    var y = E.y - p.brow * 0.012;
    var r = E.r;

    if (E.style === 'bulge') {
      // Frog-style eye sitting proud of the head.
      fillEllipse(ctx, x, y, r * 1.16, r * 1.16, 0, spec.fur);
      ctx.strokeStyle = spec.furShade;
      ctx.lineWidth = 0.012;
      ctx.stroke();
      if (open < 0.2) {
        ctx.beginPath();
        ctx.moveTo(x - r * 0.85, y);
        ctx.quadraticCurveTo(x, y + r * 0.42, x + r * 0.85, y);
        ctx.strokeStyle = spec.mouth;
        ctx.lineWidth = 0.018;
        ctx.lineCap = 'round';
        ctx.stroke();
        return;
      }
      fillEllipse(ctx, x, y, r * 0.86, r * 0.86 * open, 0, spec.eyeWhite || '#fff8e8');
      fillEllipse(ctx, x, y, r * 0.34, r * 0.5 * open, 0, spec.eye);
      fillEllipse(ctx, x - r * 0.24, y - r * 0.3 * open, r * 0.16, r * 0.16 * open, 0, 'rgba(255,255,255,0.9)');
      return;
    }

    if (open < 0.14) {
      // Closed: a happy upward arc reads better than a flat line.
      ctx.beginPath();
      ctx.moveTo(x - r * 1.0, y + r * 0.1);
      ctx.quadraticCurveTo(x, y - r * 0.85, x + r * 1.0, y + r * 0.1);
      ctx.strokeStyle = E.lid || spec.eye;
      ctx.lineWidth = 0.022;
      ctx.lineCap = 'round';
      ctx.stroke();
      return;
    }

    var ry = r * (E.aspect || 1) * mix(0.18, 1, open);
    var tilt = (E.tilt || 0) * side;

    if (E.white) {
      fillEllipse(ctx, x, y, r * 1.02, ry * 1.02, tilt, spec.eyeWhite || '#ffffff');
      ctx.strokeStyle = 'rgba(0,0,0,0.16)';
      ctx.lineWidth = 0.008;
      ctx.stroke();
      var px = x + p.yaw * r * 0.34;
      var iris = r * (E.iris || 0.46);
      var irisRy = Math.min(ry * 0.92, iris);
      // `irisOffset` of 1 rests the iris on the lower lid, 0 centres it.
      var py = y + p.pitch * ry * 0.2 + (ry - irisRy) * (E.irisOffset || 0) * open;
      fillEllipse(ctx, px, py, iris, irisRy, tilt, spec.eye);
      if (E.gloss !== false) {
        fillEllipse(ctx, px - iris * 0.34, py - irisRy * 0.3, r * 0.16, r * 0.16 * open, 0, 'rgba(255,255,255,0.92)');
      } else {
        fillEllipse(ctx, px + iris * 0.3, py - irisRy * 0.3, r * 0.1, r * 0.08 * open, 0, 'rgba(255,255,255,0.5)');
      }
      if (E.hood) {
        // Heavy upper lid, which is what makes an eye read as a real animal's
        // rather than a cartoon dot.
        ctx.beginPath();
        ctx.moveTo(x - r * 1.04, y - ry * 0.18);
        ctx.quadraticCurveTo(x, y - ry * 1.5, x + r * 1.04, y - ry * 0.18);
        ctx.strokeStyle = E.hoodColor || spec.furShade;
        ctx.lineWidth = 0.019;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      return;
    }

    fillEllipse(ctx, x, y, r, ry, 0, spec.eye);
    if (E.pupil === 'slit') {
      fillEllipse(ctx, x, y, r * 0.62, ry * 0.94, 0, spec.eyeWhite || '#f7d66a');
      fillEllipse(ctx, x, y, r * 0.17, ry * 0.88, 0, spec.eye);
    }
    // Two highlights: a big one plus a small one reads as wet and alive.
    fillEllipse(ctx, x - r * 0.3, y - ry * 0.34, r * 0.22, r * 0.22 * open, 0, 'rgba(255,255,255,0.92)');
    fillEllipse(ctx, x + r * 0.3, y + ry * 0.28, r * 0.11, r * 0.11 * open, 0, 'rgba(255,255,255,0.5)');
  }

  function drawBrows(ctx, spec, p) {
    var B = spec.brows;
    if (!B) return;
    var lift = p.brow * 0.045;
    for (var s = -1; s <= 1; s += 2) {
      ctx.save();
      ctx.translate(spec.eyes.x * s, spec.eyes.y - spec.eyes.r * 1.5 - lift);
      ctx.rotate(-0.12 * s);
      ctx.beginPath();
      ctx.moveTo(-B.w / 2, 0);
      ctx.quadraticCurveTo(0, -B.h, B.w / 2, 0.006);
      ctx.strokeStyle = B.color || spec.furShade;
      ctx.lineWidth = B.weight || 0.026;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ----------------------------------------------------------- nose, mouth */

  function drawNose(ctx, spec) {
    var N = spec.nose;
    if (N.hidden) return;
    var w = N.w;
    var h = N.h;
    var y = N.y;
    ctx.fillStyle = N.color || spec.noseColor;
    if (N.type === 'snout') {
      // `plate: false` skips the snout disc, for animals whose muzzle already
      // supplies the mass and only needs nostrils on top of it.
      if (N.plate !== false) {
        fillEllipse(ctx, 0, y, w, h, 0, N.color || spec.noseColor);
        ctx.strokeStyle = 'rgba(0,0,0,0.14)';
        ctx.lineWidth = 0.01;
        ctx.stroke();
      }
      var tilt = N.tilt || 0;
      var nostril = N.nostrilColor || 'rgba(0,0,0,0.45)';
      var nr = N.nostrilR || w * 0.16;
      fillEllipse(ctx, -w * 0.36, y, nr, h * 0.42, -tilt, nostril);
      fillEllipse(ctx, w * 0.36, y, nr, h * 0.42, tilt, nostril);
      return;
    }
    if (N.type === 'round') {
      fillEllipse(ctx, 0, y, w, h, 0, N.color || spec.noseColor);
    } else {
      // Rounded downward triangle — the classic cat/dog nose.
      ctx.beginPath();
      ctx.moveTo(-w, y - h * 0.62);
      ctx.quadraticCurveTo(0, y - h * 0.95, w, y - h * 0.62);
      ctx.quadraticCurveTo(w * 0.72, y + h * 0.42, 0, y + h);
      ctx.quadraticCurveTo(-w * 0.72, y + h * 0.42, -w, y - h * 0.62);
      ctx.closePath();
      ctx.fillStyle = N.color || spec.noseColor;
      ctx.fill();
    }
    fillEllipse(ctx, -w * 0.3, y - h * 0.28, w * 0.22, h * 0.16, -0.3, 'rgba(255,255,255,0.35)');
  }

  function openMouthPath(ctx, w, top, oh) {
    ctx.beginPath();
    ctx.moveTo(-w, top);
    ctx.quadraticCurveTo(0, top - 0.03, w, top);
    ctx.quadraticCurveTo(w * 0.72, top + oh, 0, top + oh);
    ctx.quadraticCurveTo(-w * 0.72, top + oh, -w, top);
    ctx.closePath();
  }

  function drawMouth(ctx, spec, p) {
    var M = spec.mouth;
    var openAmt = clamp01(p.jawOpen);
    var w = M.w * (1 + p.smile * 0.22);
    var top = M.y;
    var lineColor = M.color || spec.mouthColor;

    if (spec.mouthStyle === 'wide') {
      // Frog: a grin spanning most of the head.
      var grin = function () {
        ctx.beginPath();
        ctx.moveTo(-w, top - 0.02);
        ctx.quadraticCurveTo(0, top + M.depth * (1 + openAmt * 3.2), w, top - 0.02);
        if (openAmt > 0.06) {
          ctx.quadraticCurveTo(0, top - 0.02 - openAmt * 0.02, -w, top - 0.02);
          ctx.closePath();
        }
      };
      grin();
      if (openAmt > 0.06) {
        ctx.fillStyle = spec.mouthInner || '#5c2230';
        ctx.fill();
        ctx.save();
        ctx.clip();
        fillEllipse(ctx, 0, top + M.depth * openAmt * 2.1, w * 0.44, M.depth * openAmt * 1.5, 0, spec.tongue);
        ctx.restore();
        grin();
      }
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 0.02;
      ctx.lineCap = 'round';
      ctx.stroke();
      return;
    }

    var stemTop = spec.nose.y + spec.nose.h * 0.9;

    if (spec.mouthStyle === 'shade') {
      if (openAmt > 0.05) {
        var shadeOpen = M.depth + openAmt * (M.maxOpen || 0.2);
        openMouthPath(ctx, w, top, shadeOpen);
        ctx.fillStyle = spec.mouthInner || '#5c2230';
        ctx.fill();
        ctx.save();
        ctx.clip();
        fillEllipse(ctx, 0, top + shadeOpen * 0.8, w * 0.6, shadeOpen * 0.5, 0, spec.tongue);
        ctx.restore();
        return;
      }
      // Closed: a soft band of shadow with a lit lower lip under it. Soft
      // edges everywhere, so nothing reads as a drawn line.
      var shadow = M.shade || 'rgba(150,86,46,';
      var bandR = w * 1.2;
      var bandK = (M.depth * 2.6) / bandR;
      ctx.save();
      ctx.translate(0, top);
      ctx.scale(1, bandK);
      var band = ctx.createRadialGradient(0, 0, bandR * 0.04, 0, 0, bandR);
      band.addColorStop(0, shadow + (0.5 - p.smile * 0.15).toFixed(2) + ')');
      band.addColorStop(0.5, shadow + '0.26)');
      band.addColorStop(1, shadow + '0)');
      ctx.fillStyle = band;
      ctx.beginPath();
      ctx.arc(0, 0, bandR, 0, TAU);
      ctx.fill();
      ctx.restore();

      var lipR = w * 0.95;
      var lipK = (M.depth * 2.0) / lipR;
      ctx.save();
      ctx.translate(0, top + M.depth * 1.7);
      ctx.scale(1, lipK);
      var lip = ctx.createRadialGradient(0, 0, lipR * 0.04, 0, 0, lipR);
      lip.addColorStop(0, 'rgba(255,248,226,0.55)');
      lip.addColorStop(1, 'rgba(255,248,226,0)');
      ctx.fillStyle = lip;
      ctx.beginPath();
      ctx.arc(0, 0, lipR, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (spec.mouthStyle === 'line') {
      if (openAmt > 0.05) {
        var lineOpen = M.depth + openAmt * (M.maxOpen || 0.2);
        openMouthPath(ctx, w, top, lineOpen);
        ctx.fillStyle = spec.mouthInner || '#5c2230';
        ctx.fill();
        ctx.save();
        ctx.clip();
        fillEllipse(ctx, 0, top + lineOpen * 0.8, w * 0.6, lineOpen * 0.5, 0, spec.tongue);
        ctx.restore();
        openMouthPath(ctx, w, top, lineOpen);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 0.016;
        ctx.stroke();
      } else {
        // Level line with the corners set slightly low; a smile lifts them.
        var corner = top - 0.012 - p.smile * 0.07;
        ctx.beginPath();
        ctx.moveTo(-w, corner);
        ctx.quadraticCurveTo(-w * 0.5, top + 0.012, 0, top + 0.012);
        ctx.quadraticCurveTo(w * 0.5, top + 0.012, w, corner);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 0.018;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      if (spec.philtrum !== false) {
        ctx.beginPath();
        ctx.moveTo(0, stemTop);
        ctx.lineTo(0, top - 0.02);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 0.015;
        ctx.stroke();
      }
      return;
    }

    if (openAmt > 0.05) {
      var oh = M.depth + openAmt * (M.maxOpen || 0.26);
      openMouthPath(ctx, w, top, oh);
      ctx.fillStyle = spec.mouthInner || '#5c2230';
      ctx.fill();
      ctx.save();
      ctx.clip();
      fillEllipse(ctx, 0, top + oh * 0.78, w * 0.62, oh * 0.55, 0, spec.tongue);
      if (spec.teeth) {
        ctx.fillStyle = '#fffaf2';
        ctx.fillRect(-w * 0.5, top - 0.004, w, 0.035);
      }
      ctx.restore();
      openMouthPath(ctx, w, top, oh);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 0.016;
      ctx.stroke();
    } else {
      // Closed: the "w" every cartoon animal wears.
      ctx.beginPath();
      ctx.moveTo(0, stemTop);
      ctx.lineTo(0, top - 0.012);
      ctx.moveTo(-w, top - M.depth * 0.5);
      ctx.quadraticCurveTo(-w * 0.42, top + M.depth, 0, top - 0.012);
      ctx.quadraticCurveTo(w * 0.42, top + M.depth, w, top - M.depth * 0.5);
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 0.02;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    if (spec.teethClosed && openAmt <= 0.05) {
      ctx.fillStyle = '#fffaf2';
      ctx.beginPath();
      ctx.moveTo(-0.052, top);
      ctx.lineTo(0.052, top);
      ctx.lineTo(0.052, top + 0.075);
      ctx.quadraticCurveTo(0, top + 0.095, -0.052, top + 0.075);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.006;
      ctx.stroke();
    }
  }

  function drawWhiskers(ctx, spec) {
    var W = spec.whiskers;
    if (!W) return;
    var y0 = spec.mouth.y - 0.03;
    ctx.strokeStyle = W.color || 'rgba(255,255,255,0.75)';
    ctx.lineWidth = W.weight || 0.011;
    ctx.lineCap = 'round';
    for (var s = -1; s <= 1; s += 2) {
      for (var i = 0; i < 3; i++) {
        var y = y0 + (i - 1) * 0.045;
        ctx.beginPath();
        ctx.moveTo(s * W.x, y);
        ctx.quadraticCurveTo(s * (W.x + W.len * 0.55), y + (i - 1) * 0.03 - 0.02, s * (W.x + W.len), y + (i - 1) * 0.055 - 0.03);
        ctx.stroke();
      }
    }
  }

  /* ------------------------------------------------------------ head + all */

  function drawHead(ctx, spec, p) {
    var H = spec.head;
    // An animal whose skull is not a rounded blob can supply its own outline.
    var outline = spec.headShape || headPath;

    var g = ctx.createLinearGradient(0, -H.h / 2, 0, H.h / 2);
    g.addColorStop(0, spec.furLight || spec.fur);
    g.addColorStop(0.52, spec.fur);
    g.addColorStop(1, spec.furShade);

    if (spec.unionOutline) {
      // The silhouette is the union of several shapes: stroke first, then let
      // the fill cover every seam so only the outer edge survives.
      outline(ctx, H);
      ctx.strokeStyle = spec.outline || spec.furShade;
      ctx.lineWidth = 0.028;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    outline(ctx, H);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.clip();

    // Soft ambient occlusion around the jaw so the head reads as a volume.
    var rg = ctx.createRadialGradient(-H.w * 0.22, -H.h * 0.3, 0.02, 0, H.h * 0.12, H.w * 0.86);
    rg.addColorStop(0, 'rgba(255,255,255,0.22)');
    rg.addColorStop(0.55, 'rgba(255,255,255,0)');
    rg.addColorStop(1, 'rgba(0,0,0,0.16)');
    ctx.fillStyle = rg;
    ctx.fillRect(-1, -1, 2, 2);

    if (spec.markings) spec.markings(ctx, spec, p);
    ctx.restore();

    if (!spec.unionOutline) {
      outline(ctx, H);
      ctx.strokeStyle = spec.outline || spec.furShade;
      ctx.lineWidth = 0.014;
      ctx.stroke();
    }
  }

  function drawMuzzle(ctx, spec) {
    var M = spec.muzzle;
    if (!M) return;
    fillEllipse(ctx, 0, M.y, M.w / 2, M.h / 2, 0, M.color || spec.muzzleColor);
    if (M.shade !== false) {
      ctx.strokeStyle = 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 0.01;
      ctx.stroke();
    }
  }

  /**
   * Draws one animal head.
   * @param {CanvasRenderingContext2D} ctx transformed so 1 unit = head width
   * @param {object} spec animal spec
   * @param {object} params {jawOpen, blinkL, blinkR, smile, brow, yaw, pitch, earSwing}
   */
  function drawAnimal(ctx, spec, params) {
    var p = {
      jawOpen: params && params.jawOpen || 0,
      blinkL: params && params.blinkL || 0,
      blinkR: params && params.blinkR || 0,
      smile: params && params.smile || 0,
      brow: params && params.brow || 0,
      yaw: params && params.yaw || 0,
      pitch: params && params.pitch || 0,
      earSwing: params && params.earSwing || 0
    };

    ctx.save();
    ctx.lineJoin = 'round';
    // Cheap pseudo-3D: squash toward the turn and slide the whole head a little.
    ctx.translate(p.yaw * 0.022, p.pitch * 0.02);
    ctx.scale(1 - 0.11 * Math.abs(p.yaw), 1 - 0.04 * Math.abs(p.pitch));

    drawEar(ctx, spec, -1, p);
    drawEar(ctx, spec, 1, p);
    if (spec.behind) spec.behind(ctx, spec, p);
    drawHead(ctx, spec, p);

    // Facial features shift with head turn to fake parallax.
    ctx.save();
    ctx.translate(p.yaw * 0.115, p.pitch * 0.085);
    if (spec.faceExtras) spec.faceExtras(ctx, spec, p);
    drawMuzzle(ctx, spec);
    drawBrows(ctx, spec, p);
    drawEye(ctx, spec, -1, p);
    drawEye(ctx, spec, 1, p);
    drawWhiskers(ctx, spec);
    drawNose(ctx, spec);
    drawMouth(ctx, spec, p);
    if (spec.overlay) spec.overlay(ctx, spec, p);
    ctx.restore();

    ctx.restore();
  }

  /* ------------------------------------------------------- marking helpers */

  function stripe(ctx, x, y, len, angle, weight, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.quadraticCurveTo(0, -weight * 0.6, len / 2, 0);
    ctx.quadraticCurveTo(0, weight * 0.6, -len / 2, 0);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function base(overrides) {
    var spec = {
      fur: '#c9a06a',
      furLight: '#dcb783',
      furShade: '#a67e4d',
      inner: '#e8a9a2',
      muzzleColor: '#fdf6ec',
      noseColor: '#33262a',
      mouthColor: '#4a3630',
      mouthInner: '#6b2733',
      tongue: '#ef7f92',
      eye: '#241a18',
      eyeWhite: '#ffffff',
      head: { w: 1, h: 1.04, jaw: 0.80, chin: 0.46 },
      ear: { type: 'triangle', w: 0.30, h: 0.34, x: 0.33, y: -0.40, tilt: -0.30, inner: 0.56 },
      eyes: { x: 0.205, y: -0.02, r: 0.082, aspect: 1, pupil: 'round' },
      muzzle: { w: 0.46, h: 0.30, y: 0.21 },
      nose: { w: 0.072, h: 0.055, y: 0.13, type: 'triangle' },
      mouth: { y: 0.235, w: 0.115, depth: 0.055, maxOpen: 0.24 },
      brows: null,
      whiskers: null
    };
    for (var k in overrides) {
      if (Object.prototype.hasOwnProperty.call(overrides, k)) spec[k] = overrides[k];
    }
    return spec;
  }

  /* --------------------------------------------------------------- animals */

  var SPECS = [
    base({
      id: 'niulai', name: 'Niulai', emoji: '\ud83d\udc02',
      fur: '#fa650e', furLight: '#fd7f28', furShade: '#d24f08',
      inner: '#efd3d3', outline: '#a83f05',
      mouthColor: '#5a2a10', mouthInner: '#5c2018', tongue: '#cf6b7c',
      eye: '#191110', eyeWhite: '#f2e6e2',
      /*
       * Corrections from the reference, feature by feature:
       *   brows   flat, with a slight frown - not arched
       *   muzzle  very long and skin-coloured - not a round pad, and with no
       *           nostrils and no philtrum groove, neither of which the
       *           reference has
       *   ears    pointy and on the sides of the head - not rounded on top
       *   eyes    flat - not round
       */
      head: { w: 1.0, h: 1.29 },
      thumbScale: 0.46,
      thumbCentre: 0.50,
      ear: { type: 'spike', w: 0.30, h: 0.38, x: 0.44, y: -0.24, tilt: 1.10, inner: 0.58, innerColor: '#f2e2c6', swing: 0.6 },
      eyes: { x: 0.255, y: -0.305, r: 0.098, aspect: 0.56, white: true, iris: 0.40, irisOffset: 0.85, gloss: false, hood: true, hoodColor: '#7a3506' },
      brows: null,
      muzzle: null,
      nose: { hidden: true, y: 0.16, h: 0.10, w: 0.1, type: 'round' },
      mouth: { y: 0.42, w: 0.185, depth: 0.038, maxOpen: 0.10, shade: 'rgba(176,140,104,' },
      mouthStyle: 'shade',
      philtrum: false,

      /*
       * 3D build. The head is three masses - a broad cranium, a tapering lower
       * face, and a long snout - so the silhouette reads as the reference's
       * inverted trapezoid from any angle, not just head-on.
       */
      model3d: {
        /*
         * Measured off the three-view turnaround by scanning the front frame.
         * The head is 180px wide and spans y 76..300, so one head width is
         * 180px and the origin sits at image y=188. Everything below is in
         * head widths from that centre:
         *
         *   head      1.00 wide x 1.24 tall, widest at the vertical centre
         *   ears      tips reach +/-0.77, about 32 degrees above horizontal
         *   eyes      +/-0.22, y -0.147, only 0.117 across - much smaller
         *             than they look at a glance, and flat (aspect 0.52)
         *   brows     +/-0.22, y -0.33, 0.106 wide and barely 0.018 thick
         *   muzzle    0.744 wide x 0.78 tall, centred 0.22 below the origin
         */
        skull: {
          sx: 1.0, sz: 0.90,
          profile: [
            [0.00, -0.622], [0.300, -0.600], [0.400, -0.500], [0.447, -0.400],
            [0.472, -0.250], [0.500, -0.010], [0.490, 0.140], [0.480, 0.240],
            [0.414, 0.433], [0.339, 0.489], [0.258, 0.545], [0.147, 0.600],
            [0.00, 0.625]
          ]
        },
        snout: { rx: 0.40, ry: 0.40, rz: 0.42, y: 0.222, z: 0.181 },
        eyes: { x: 0.22, y: -0.147, z: 0.375, r: 0.064, aspect: 0.52, iris: 0.052, irisOffset: 0.2 },
        ear: { type: 'leaf', w: 0.20, h: 0.41, x: 0.40, y: -0.10, z: -0.02, tilt: 1.01, spread: 0.34 },
        nose: null,
        mouth: null,
        brow: { x: 0.22, y: -0.33, z: 0.345, w: 0.106, h: 0.019, d: 0.05, tilt: -0.10, color: '#4b4750' },
        jaw: { pivotY: 0.10, maxAngle: 13 * Math.PI / 180 }
      },
      build3d: function (three, group, parts, spec, kit) {
        var skin = kit.material('#f4e2e2', { roughness: 0.66 });

        // Nose bridge, blending the top of the muzzle up toward the eyes.
        var bridge = kit.ellipsoid(0.145, 0.135, 0.36, skin);
        bridge.position.set(0, 0.010, 0.145);
        parts.jaw.add(bridge);

        // Nostrils, small and set into the top of the muzzle.
        var nostril = kit.material('#d9b6b8', { roughness: 0.7 });
        for (var n = -1; n <= 1; n += 2) {
          var hole = kit.ellipsoid(0.030, 0.022, 0.02, nostril, 16);
          hole.position.set(n * 0.068, -0.135, 0.572);
          parts.jaw.add(hole);
        }

        // Smiling mouth: an arc of tube, which curves where a flattened
        // ellipsoid could only sit straight.
        var smileGeo = new three.TorusGeometry(0.145, 0.0125, 8, 26, 2.0);
        var smile = new three.Mesh(smileGeo, kit.material('#cf9e9e', { roughness: 0.75 }));
        smile.position.set(0, -0.30, 0.545);
        smile.rotation.z = (Math.PI - 2.1) / 2 + Math.PI;
        smile.rotation.x = -0.25;
        parts.jaw.add(smile);
      },

      headShape: function (ctx) {
        ctx.beginPath();
        ctx.moveTo(0, -0.66);
        ctx.bezierCurveTo(0.26, -0.66, 0.475, -0.585, 0.505, -0.45); // top corner
        ctx.bezierCurveTo(0.432, -0.16, 0.352, 0.16, 0.292, 0.50);   // tapering side
        ctx.bezierCurveTo(0.282, 0.61, 0.160, 0.665, 0, 0.665);      // rounded base
        ctx.bezierCurveTo(-0.160, 0.665, -0.282, 0.61, -0.292, 0.50);
        ctx.bezierCurveTo(-0.352, 0.16, -0.432, -0.16, -0.505, -0.45);
        ctx.bezierCurveTo(-0.475, -0.585, -0.26, -0.66, 0, -0.66);
        ctx.closePath();
      },

      markings: function (ctx) {
        // Volume: lit forehead, shaded jaw.
        var dome = ctx.createRadialGradient(-0.10, -0.46, 0.04, 0, -0.24, 0.66);
        dome.addColorStop(0, 'rgba(255,196,120,0.45)');
        dome.addColorStop(0.6, 'rgba(255,170,90,0)');
        dome.addColorStop(1, 'rgba(120,42,2,0.28)');
        ctx.fillStyle = dome;
        ctx.fillRect(-0.7, -0.9, 1.4, 1.8);

        // The long skin-coloured muzzle. Clipped to the head, so it takes the
        // silhouette and runs all the way to the chin.
        ctx.beginPath();
        ctx.moveTo(-0.262, 0.03);
        ctx.bezierCurveTo(-0.19, -0.115, 0.19, -0.115, 0.262, 0.03);
        ctx.bezierCurveTo(0.272, 0.19, 0.252, 0.37, 0.226, 0.50);
        ctx.bezierCurveTo(0.206, 0.60, 0.112, 0.655, 0, 0.655);
        ctx.bezierCurveTo(-0.112, 0.655, -0.206, 0.60, -0.226, 0.50);
        ctx.bezierCurveTo(-0.252, 0.37, -0.272, 0.19, -0.262, 0.03);
        ctx.closePath();
        var skin = ctx.createLinearGradient(0, -0.09, 0, 0.66);
        skin.addColorStop(0, '#e2d2bc');
        skin.addColorStop(0.32, '#eddfcb');
        skin.addColorStop(0.72, '#f2e7d6');
        skin.addColorStop(1, '#f7efe1');
        ctx.fillStyle = skin;
        ctx.fill();

        // Fade the top edge into the fur, clipped to the muzzle so the blend
        // follows its curve instead of ruling a line across the face.
        ctx.save();
        ctx.clip();
        var fade = ctx.createLinearGradient(0, -0.12, 0, 0.24);
        fade.addColorStop(0, 'rgba(240,126,36,1)');
        fade.addColorStop(0.35, 'rgba(243,166,110,0.55)');
        fade.addColorStop(0.7, 'rgba(228,168,120,0.18)');
        fade.addColorStop(1, 'rgba(230,180,130,0)');
        ctx.fillStyle = fade;
        ctx.fillRect(-0.32, -0.13, 0.64, 0.40);

        var sides = ctx.createLinearGradient(-0.28, 0, 0.28, 0);
        sides.addColorStop(0, 'rgba(221,110,32,0.75)');
        sides.addColorStop(0.22, 'rgba(226,150,96,0)');
        sides.addColorStop(0.78, 'rgba(226,150,96,0)');
        sides.addColorStop(1, 'rgba(221,110,32,0.75)');
        ctx.fillStyle = sides;
        ctx.fillRect(-0.30, -0.12, 0.60, 0.82);
        ctx.restore();

        // Shadow under the brow ridge.
        var ridge = ctx.createLinearGradient(0, -0.50, 0, -0.20);
        ridge.addColorStop(0, 'rgba(92,34,4,0.4)');
        ridge.addColorStop(1, 'rgba(92,34,4,0)');
        ctx.fillStyle = ridge;
        ctx.fillRect(-0.5, -0.50, 1, 0.32);

        // Fur strokes down the cheeks.
        ctx.strokeStyle = 'rgba(120,44,4,0.28)';
        ctx.lineWidth = 0.014;
        ctx.lineCap = 'round';
        for (var k = 0; k < 4; k++) {
          var t = -0.30 + k * 0.09;
          for (var sg = -1; sg <= 1; sg += 2) {
            ctx.beginPath();
            ctx.moveTo(sg * 0.49, t);
            ctx.quadraticCurveTo(sg * 0.44, t + 0.045, sg * 0.41, t + 0.08);
            ctx.stroke();
          }
        }
      },

      faceExtras: function (ctx, spec, p) {
        // Flat brows with a slight frown: the inner ends sit a little lower.
        var browY = -0.425 - p.brow * 0.05;
        for (var side = -1; side <= 1; side += 2) {
          stripe(ctx, side * 0.255, browY, 0.25, -side * 0.07, 0.062, '#5e2a08');
        }
      }
    }),

    base({
      id: 'shiba', name: 'Shiba', emoji: '🐕',
      fur: '#e0a45c', furLight: '#f0c087', furShade: '#b97f39',
      inner: '#f0b7a8', muzzleColor: '#fffaf2',
      ear: { type: 'triangle', w: 0.29, h: 0.33, x: 0.345, y: -0.40, tilt: -0.26, inner: 0.54 },
      muzzle: { w: 0.50, h: 0.32, y: 0.215 },
      eyes: { x: 0.205, y: -0.025, r: 0.077, aspect: 0.94, pupil: 'round' },
      markings: function (ctx, s) {
        // Cream brows and cheeks — the shiba's signature markings.
        fillEllipse(ctx, -0.20, -0.155, 0.075, 0.045, -0.25, '#fff6e6');
        fillEllipse(ctx, 0.20, -0.155, 0.075, 0.045, 0.25, '#fff6e6');
        fillEllipse(ctx, -0.345, 0.16, 0.095, 0.095, 0, 'rgba(255,250,240,0.95)');
        fillEllipse(ctx, 0.345, 0.16, 0.095, 0.095, 0, 'rgba(255,250,240,0.95)');
        fillEllipse(ctx, 0, 0.29, 0.185, 0.15, 0, 'rgba(255,250,240,0.95)');
      }
    }),

    base({
      id: 'cat', name: 'Cat', emoji: '🐱',
      fur: '#9aa3ae', furLight: '#b9c1c9', furShade: '#767f8b',
      inner: '#f2b1b6', muzzleColor: '#f4f6f8', noseColor: '#e58b9b',
      head: { w: 1, h: 1.0, jaw: 0.78, chin: 0.44 },
      ear: { type: 'triangle', w: 0.30, h: 0.36, x: 0.315, y: -0.40, tilt: -0.20, inner: 0.55 },
      eyes: { x: 0.205, y: -0.03, r: 0.085, aspect: 1.05, pupil: 'slit' },
      eyeWhite: '#8fd66b',
      muzzle: { w: 0.42, h: 0.26, y: 0.20 },
      nose: { w: 0.062, h: 0.048, y: 0.125, type: 'triangle' },
      whiskers: { x: 0.18, len: 0.34, weight: 0.010, color: 'rgba(255,255,255,0.8)' },
      markings: function (ctx) {
        stripe(ctx, 0, -0.40, 0.10, 0, 0.052, 'rgba(60,66,74,0.55)');
        stripe(ctx, -0.13, -0.37, 0.09, 0.25, 0.045, 'rgba(60,66,74,0.5)');
        stripe(ctx, 0.13, -0.37, 0.09, -0.25, 0.045, 'rgba(60,66,74,0.5)');
        stripe(ctx, -0.40, -0.02, 0.16, 1.35, 0.05, 'rgba(60,66,74,0.4)');
        stripe(ctx, 0.40, -0.02, 0.16, -1.35, 0.05, 'rgba(60,66,74,0.4)');
      }
    }),

    base({
      id: 'fox', name: 'Fox', emoji: '🦊',
      fur: '#e8763a', furLight: '#f5a163', furShade: '#c0551f',
      inner: '#2f2622', muzzleColor: '#fff8f0',
      head: { w: 1, h: 1.02, jaw: 0.66, chin: 0.30 },
      ear: { type: 'triangle', w: 0.28, h: 0.42, x: 0.335, y: -0.36, tilt: -0.24, inner: 0.5, innerColor: '#3a2a24' },
      eyes: { x: 0.215, y: -0.055, r: 0.079, aspect: 0.96, pupil: 'round' },
      muzzle: { w: 0.40, h: 0.34, y: 0.27 },
      nose: { w: 0.065, h: 0.052, y: 0.185, type: 'triangle' },
      mouth: { y: 0.29, w: 0.10, depth: 0.05, maxOpen: 0.2 },
      whiskers: { x: 0.16, len: 0.30, weight: 0.009, color: 'rgba(255,255,255,0.6)' },
      markings: function (ctx) {
        // White cheek ruff + snout blaze.
        ctx.beginPath();
        ctx.moveTo(-0.30, 0.06);
        ctx.quadraticCurveTo(-0.52, 0.30, -0.24, 0.52);
        ctx.quadraticCurveTo(0, 0.62, 0.24, 0.52);
        ctx.quadraticCurveTo(0.52, 0.30, 0.30, 0.06);
        ctx.quadraticCurveTo(0, 0.20, -0.30, 0.06);
        ctx.closePath();
        ctx.fillStyle = '#fff8f0';
        ctx.fill();
      }
    }),

    base({
      id: 'wolf', name: 'Wolf', emoji: '🐺',
      fur: '#7d848f', furLight: '#9ba2ad', furShade: '#5c636e',
      inner: '#3a3f47', muzzleColor: '#e6eaef',
      head: { w: 1, h: 1.04, jaw: 0.68, chin: 0.32 },
      ear: { type: 'triangle', w: 0.26, h: 0.38, x: 0.34, y: -0.38, tilt: -0.22, inner: 0.5, innerColor: '#4a505a' },
      eyes: { x: 0.215, y: -0.05, r: 0.076, aspect: 0.9, pupil: 'slit' },
      eyeWhite: '#f2c94c',
      muzzle: { w: 0.42, h: 0.34, y: 0.26 },
      nose: { w: 0.07, h: 0.055, y: 0.175, type: 'triangle' },
      mouth: { y: 0.285, w: 0.11, depth: 0.05, maxOpen: 0.22 },
      teeth: true,
      markings: function (ctx) {
        ctx.beginPath();
        ctx.moveTo(-0.26, -0.05);
        ctx.quadraticCurveTo(-0.34, 0.30, -0.20, 0.50);
        ctx.quadraticCurveTo(0, 0.60, 0.20, 0.50);
        ctx.quadraticCurveTo(0.34, 0.30, 0.26, -0.05);
        ctx.quadraticCurveTo(0, 0.10, -0.26, -0.05);
        ctx.closePath();
        ctx.fillStyle = '#dfe4ea';
        ctx.fill();
      }
    }),

    base({
      id: 'panda', name: 'Panda', emoji: '🐼',
      fur: '#fbfbfb', furLight: '#ffffff', furShade: '#d8dade',
      muzzleColor: '#ffffff', noseColor: '#22201f', outline: '#c9ccd1',
      head: { w: 1.04, h: 0.98, jaw: 0.84, chin: 0.52 },
      ear: { type: 'round', w: 0.30, h: 0.30, x: 0.40, y: -0.34, tilt: -0.1, color: '#23211f', edge: '#23211f', inner: 0 },
      eyes: { x: 0.225, y: -0.005, r: 0.062, aspect: 1, pupil: 'round' },
      muzzle: { w: 0.36, h: 0.24, y: 0.22 },
      nose: { w: 0.075, h: 0.06, y: 0.145, type: 'round' },
      mouth: { y: 0.245, w: 0.115, depth: 0.055, maxOpen: 0.22 },
      markings: function (ctx) {
        // The eye patches, tilted inward like the real thing.
        fillEllipse(ctx, -0.225, 0.005, 0.135, 0.16, 0.38, '#23211f');
        fillEllipse(ctx, 0.225, 0.005, 0.135, 0.16, -0.38, '#23211f');
      }
    }),

    base({
      id: 'bear', name: 'Bear', emoji: '🐻',
      fur: '#a9764a', furLight: '#c08f60', furShade: '#855630',
      inner: '#c99b78', muzzleColor: '#e5c49b', noseColor: '#3a2a22',
      head: { w: 1.02, h: 1.0, jaw: 0.86, chin: 0.52 },
      ear: { type: 'round', w: 0.28, h: 0.28, x: 0.38, y: -0.34, tilt: -0.08, inner: 0.5 },
      eyes: { x: 0.195, y: -0.045, r: 0.062, aspect: 1, pupil: 'round' },
      muzzle: { w: 0.48, h: 0.34, y: 0.24 },
      nose: { w: 0.085, h: 0.062, y: 0.155, type: 'round' },
      mouth: { y: 0.27, w: 0.115, depth: 0.06, maxOpen: 0.24 }
    }),

    base({
      id: 'koala', name: 'Koala', emoji: '🐨',
      fur: '#9fa8b2', furLight: '#bcc4cc', furShade: '#7c858f',
      inner: '#d6b5bb', muzzleColor: '#b6bec6', noseColor: '#3b3436',
      head: { w: 1, h: 0.96, jaw: 0.84, chin: 0.5 },
      ear: { type: 'round', w: 0.42, h: 0.40, x: 0.50, y: -0.16, tilt: -0.05, inner: 0.62, innerColor: '#d9b9be' },
      eyes: { x: 0.215, y: -0.04, r: 0.062, aspect: 1, pupil: 'round' },
      muzzle: null,
      nose: { w: 0.115, h: 0.135, y: 0.14, type: 'round' },
      mouth: { y: 0.30, w: 0.09, depth: 0.045, maxOpen: 0.12 },
      faceExtras: function (ctx) {
        // Fluffy ear tufts poking past the round ears.
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        fillEllipse(ctx, -0.5, -0.20, 0.16, 0.1, -0.5, 'rgba(255,255,255,0.22)');
        fillEllipse(ctx, 0.5, -0.20, 0.16, 0.1, 0.5, 'rgba(255,255,255,0.22)');
      }
    }),

    base({
      id: 'tiger', name: 'Tiger', emoji: '🐯',
      fur: '#f0a13a', furLight: '#f9bd63', furShade: '#c9761c',
      inner: '#f6d3c0', muzzleColor: '#fff6ea', noseColor: '#c96a72',
      head: { w: 1.02, h: 1.0, jaw: 0.82, chin: 0.48 },
      ear: { type: 'round', w: 0.26, h: 0.26, x: 0.38, y: -0.34, tilt: -0.12, inner: 0.5, innerColor: '#3a2c26' },
      eyes: { x: 0.215, y: -0.035, r: 0.08, aspect: 0.95, pupil: 'round' },
      muzzle: { w: 0.46, h: 0.28, y: 0.215 },
      nose: { w: 0.07, h: 0.055, y: 0.13, type: 'triangle' },
      whiskers: { x: 0.19, len: 0.32, weight: 0.010, color: 'rgba(255,255,255,0.85)' },
      markings: function (ctx) {
        var dark = 'rgba(45,32,26,0.92)';
        fillEllipse(ctx, 0, 0.06, 0.26, 0.20, 0, 'rgba(255,246,234,0.5)');
        // Forehead crown.
        stripe(ctx, 0, -0.40, 0.22, 0, 0.07, dark);
        stripe(ctx, -0.155, -0.36, 0.20, 0.42, 0.065, dark);
        stripe(ctx, 0.155, -0.36, 0.20, -0.42, 0.065, dark);
        // Temple and cheek bars, angled to follow the head.
        stripe(ctx, -0.375, -0.16, 0.26, 1.15, 0.07, dark);
        stripe(ctx, 0.375, -0.16, 0.26, -1.15, 0.07, dark);
        stripe(ctx, -0.425, 0.06, 0.24, 1.35, 0.065, dark);
        stripe(ctx, 0.425, 0.06, 0.24, -1.35, 0.065, dark);
        stripe(ctx, -0.40, 0.26, 0.20, 1.55, 0.06, dark);
        stripe(ctx, 0.40, 0.26, 0.20, -1.55, 0.06, dark);
      }
    }),

    base({
      id: 'bunny', name: 'Bunny', emoji: '🐰',
      fur: '#f6efe6', furLight: '#fffaf3', furShade: '#dccfbe',
      inner: '#f7b8c4', muzzleColor: '#fffdfa', noseColor: '#ef92a6', outline: '#d6c8b6',
      head: { w: 0.96, h: 1.0, jaw: 0.82, chin: 0.48 },
      ear: { type: 'long', w: 0.19, h: 0.72, x: 0.20, y: -0.40, tilt: -0.16, inner: 0.52, swing: 1.8 },
      eyes: { x: 0.20, y: -0.02, r: 0.075, aspect: 1.05, pupil: 'round' },
      muzzle: { w: 0.40, h: 0.26, y: 0.20 },
      nose: { w: 0.055, h: 0.042, y: 0.12, type: 'triangle' },
      mouth: { y: 0.215, w: 0.10, depth: 0.05, maxOpen: 0.2 },
      teeth: true,
      teethClosed: true,
      whiskers: { x: 0.15, len: 0.28, weight: 0.008, color: 'rgba(190,175,160,0.8)' }
    }),

    base({
      id: 'pig', name: 'Pig', emoji: '🐷',
      fur: '#f4a9bd', furLight: '#fbc4d3', furShade: '#dc8399',
      inner: '#e58ba2', muzzleColor: '#f8bccb', noseColor: '#e08099',
      head: { w: 1.04, h: 0.98, jaw: 0.86, chin: 0.54 },
      ear: { type: 'tuft', w: 0.28, h: 0.30, x: 0.38, y: -0.36, tilt: -0.42, inner: 0.5 },
      eyes: { x: 0.215, y: -0.06, r: 0.058, aspect: 1, pupil: 'round' },
      muzzle: null,
      nose: { w: 0.15, h: 0.105, y: 0.185, type: 'snout' },
      mouth: { y: 0.34, w: 0.10, depth: 0.05, maxOpen: 0.18 }
    }),

    base({
      id: 'frog', name: 'Frog', emoji: '🐸',
      fur: '#7ec24d', furLight: '#9ed86b', furShade: '#5c9c34',
      muzzleColor: '#cfeab0', noseColor: '#3f6b28', mouthColor: '#3f6b28',
      head: { w: 1.06, h: 0.9, jaw: 0.92, chin: 0.62 },
      ear: { type: 'none' },
      eyes: { x: 0.30, y: -0.36, r: 0.14, style: 'bulge' },
      eyeWhite: '#fdf6e3',
      muzzle: null,
      nose: { w: 0.03, h: 0.022, y: 0.02, type: 'round' },
      mouth: { y: 0.17, w: 0.40, depth: 0.17 },
      mouthStyle: 'wide',
      markings: function (ctx) {
        fillEllipse(ctx, 0, 0.30, 0.34, 0.16, 0, 'rgba(207,234,176,0.55)');
      }
    }),

    base({
      id: 'monkey', name: 'Monkey', emoji: '🐵',
      fur: '#8a5f3c', furLight: '#a5764d', furShade: '#6b472a',
      inner: '#d9a87e', muzzleColor: '#e2b68b', noseColor: '#6b472a',
      head: { w: 1, h: 1.0, jaw: 0.84, chin: 0.5 },
      ear: { type: 'round', w: 0.26, h: 0.26, x: 0.50, y: -0.02, tilt: 0, inner: 0.58 },
      eyes: { x: 0.185, y: -0.055, r: 0.07, aspect: 1, white: true },
      muzzle: { w: 0.56, h: 0.40, y: 0.24 },
      nose: { w: 0.05, h: 0.038, y: 0.135, type: 'round' },
      mouth: { y: 0.30, w: 0.14, depth: 0.06, maxOpen: 0.22 },
      brows: { w: 0.15, h: 0.035, weight: 0.022, color: '#5d3e24' },
      markings: function (ctx) {
        fillEllipse(ctx, 0, -0.12, 0.34, 0.30, 0, 'rgba(226,182,139,0.55)');
      }
    })
  ];

  var BY_ID = {};
  for (var i = 0; i < SPECS.length; i++) BY_ID[SPECS[i].id] = SPECS[i];

  NS.animals = {
    list: function () { return SPECS; },
    /**
     * Adds an imported glTF model to the picker. Imported models render in 3D
     * only; the flat fallback draws a neutral head so the picker still shows
     * something when WebGL is unavailable.
     */
    registerModel: function (entry) {
      if (!entry || !entry.id || BY_ID[entry.id]) return null;
      var spec = base({
        id: entry.id,
        name: entry.name || entry.id,
        model: entry,
        requires3d: true,
        fur: entry.tint || '#a9a29a',
        furLight: entry.tint || '#c3bcb3',
        furShade: '#7d766e'
      });
      SPECS.push(spec);
      BY_ID[spec.id] = spec;
      return spec;
    },
    get: function (id) { return BY_ID[id] || BY_ID.shiba; },
    has: function (id) { return !!BY_ID[id]; },
    draw: drawAnimal,
    /** Draws a head that fits a `size` x `size` box, for pickers and previews. */
    drawThumb: function (ctx, id, size, params) {
      ctx.save();
      var spec = this.get(id);
      var scale = size * (spec.thumbScale || 0.62);
      ctx.translate(size / 2, size * (spec.thumbCentre || 0.54));
      ctx.scale(scale, scale);
      drawAnimal(ctx, spec, params || {});
      ctx.restore();
    }
  };
})();
