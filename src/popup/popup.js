/* Critter Cam — popup controller. */
(function () {
  'use strict';

  var NS = globalThis.__CritterCam;
  var $ = function (id) { return document.getElementById(id); };

  var settings = NS.normalizeSettings({});
  var saveTimer = 0;

  var TOGGLES = ['enabled', 'render3d', 'followTilt', 'animate', 'manual', 'debug'];
  var SLIDERS = [
    { id: 'size', format: function (v) { return v.toFixed(2) + '×'; } },
    { id: 'offsetY', format: formatOffset },
    { id: 'offsetX', format: formatOffset },
    { id: 'offsetZ', format: formatOffset },
    { id: 'smoothing', format: function (v) { return v <= 0 ? 'off' : Math.round(v * 100) + '%'; } },
    { id: 'detectFps', format: function (v) { return Math.round(v) + ' / sec'; } }
  ];

  function formatOffset(v) {
    if (Math.abs(v) < 0.005) return 'centred';
    return (v > 0 ? '+' : '') + v.toFixed(2);
  }

  /* ------------------------------------------------------------ rendering */

  function paintThumb(canvas, animalId) {
    var dpr = window.devicePixelRatio || 1;
    var cssSize = canvas.getAttribute('data-size') ? parseInt(canvas.getAttribute('data-size'), 10) : 46;
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var spec = NS.animals.get(animalId);
    if (NS.avatar3d && NS.avatar3d.paintThumb(ctx, spec, cssSize * dpr)) return;
    NS.animals.drawThumb(ctx, animalId, cssSize * dpr, { jawOpen: 0.12 });
  }

  function buildGrid() {
    var grid = $('animalGrid');
    grid.textContent = '';
    NS.animals.list().forEach(function (spec) {
      var button = document.createElement('button');
      button.className = 'animal';
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.dataset.animal = spec.id;
      button.title = spec.name;

      var canvas = document.createElement('canvas');
      canvas.setAttribute('data-size', '46');
      var label = document.createElement('span');
      label.textContent = spec.name;

      button.appendChild(canvas);
      button.appendChild(label);
      grid.appendChild(button);
      paintThumb(canvas, spec.id);

      button.addEventListener('click', function () {
        settings.animal = spec.id;
        reflect();
        save();
      });
    });
  }

  function reflect() {
    TOGGLES.forEach(function (id) { $(id).checked = !!settings[id]; });
    SLIDERS.forEach(function (slider) {
      $(slider.id).value = settings[slider.id];
      $(slider.id + 'Value').textContent = slider.format(Number(settings[slider.id]));
    });
    $('onLost').value = settings.onLost;

    Array.prototype.forEach.call(document.querySelectorAll('.animal'), function (node) {
      node.setAttribute('aria-pressed', String(node.dataset.animal === settings.animal));
    });
    $('animalName').textContent = NS.animals.get(settings.animal).name;
    paintThumb($('brand'), settings.animal);

    var scene = NS.backgrounds.get(settings.background);
    $('backgroundName').textContent = scene ? scene.name : 'None';
    Array.prototype.forEach.call(document.querySelectorAll('.scene'), function (node) {
      node.setAttribute('aria-pressed', String(node.dataset.background === settings.background));
    });

    // Depth is a 3D notion; the flat-art fallback has no axis to move along.
    var flat = !settings.render3d;
    $('offsetZ').disabled = flat;
    var depthRow = $('offsetZ').closest('.slider');
    if (depthRow) depthRow.style.opacity = flat ? 0.45 : 1;

    // Tracking-driven controls are meaningless while the head is pinned.
    var pinned = settings.manual;
    ['followTilt', 'animate', 'smoothing', 'detectFps', 'onLost'].forEach(function (id) {
      $(id).disabled = pinned;
      var row = $(id).closest('.row') || $(id).closest('.slider');
      if (row) row.style.opacity = pinned ? 0.45 : 1;
    });
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { NS.store.save(settings); }, 90);
  }

  /* --------------------------------------------------------------- status */

  var SUPPORTED = /^https:\/\/([^/]*\.)?(meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|discord\.com|app\.gather\.town)\//;

  function setStatus(tone, text, hint) {
    $('statusDot').className = 'dot' + (tone ? ' ' + tone : '');
    $('statusText').textContent = text;
    $('detectorHint').textContent = hint || '';
  }

  function refreshStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      var tab = tabs && tabs[0];
      if (!tab || !tab.url) {
        setStatus('', 'Open a meeting tab to get started.');
        return;
      }
      if (!SUPPORTED.test(tab.url)) {
        setStatus('', 'Not active on this site.');
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'crittercam:getStatus' }, function (response) {
        if (chrome.runtime.lastError || !response) {
          setStatus('warn', 'Reload this tab to activate.');
          return;
        }
        var detector = response.detector || {};
        var hint = '';
        if (detector.state === 'error') hint = 'Face tracking failed: ' + detector.error;
        else if (detector.state === 'ready') hint = 'Face tracking on ' + detector.delegate + ' · ' + detector.cost + ' ms per frame';
        else if (detector.state === 'loading') hint = 'Loading the face tracker…';

        if (!response.camera) {
          setStatus('warn', 'Ready — waiting for the camera.', hint);
          return;
        }
        var render = response.render || {};
        var parts = ['Camera active'];
        if (response.resolution) parts.push(response.resolution);
        if (render.fps) parts.push(render.fps + ' fps');
        parts.push(render.tracking ? 'face tracked' : 'no face');
        setStatus(render.tracking ? 'good' : 'warn', parts.join(' · '), hint);
      });
    });
  }

  /* ---------------------------------------------------------------- setup */

  function bind() {
    TOGGLES.forEach(function (id) {
      $(id).addEventListener('change', function () {
        settings[id] = $(id).checked;
        reflect();
        save();
      });
    });
    SLIDERS.forEach(function (slider) {
      $(slider.id).addEventListener('input', function () {
        settings[slider.id] = Number($(slider.id).value);
        $(slider.id + 'Value').textContent = slider.format(Number(settings[slider.id]));
        save();
      });
    });
    $('onLost').addEventListener('change', function () {
      settings.onLost = $('onLost').value;
      save();
    });
    $('openPreview').addEventListener('click', function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/preview/preview.html') });
      window.close();
    });
    $('reset').addEventListener('click', function () {
      settings = NS.normalizeSettings({});
      reflect();
      NS.store.save(settings);
    });
  }

  /* --------------------------------------------------------- backgrounds */

  function sceneUrl(file) { return chrome.runtime.getURL('models/backgrounds/' + file); }

  function buildScenes() {
    var grid = $('sceneGrid');
    grid.textContent = '';
    var tiles = [{ id: 'none', name: 'None', file: null }].concat(NS.backgrounds.list());
    tiles.forEach(function (entry) {
      var button = document.createElement('button');
      button.className = 'scene';
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.dataset.background = entry.id;
      button.title = entry.name;

      var swatch = document.createElement('span');
      swatch.className = 'swatch' + (entry.file ? '' : ' empty');
      if (entry.file) swatch.style.backgroundImage = 'url("' + sceneUrl(entry.file) + '")';
      else swatch.textContent = '\u2014';

      var label = document.createElement('span');
      label.textContent = entry.name;
      button.appendChild(swatch);
      button.appendChild(label);
      grid.appendChild(button);

      button.addEventListener('click', function () {
        settings.background = entry.id;
        reflect();
        save();
      });
    });
  }

  /*
   * The popup only shows the scenes; the compositor that paints them lives in
   * the meeting tab, so no bytes are needed here beyond the swatches, which
   * the browser fetches itself.
   */
  function loadScenes() {
    return fetch(chrome.runtime.getURL('models/backgrounds/index.json'))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (entries) {
        if (!Array.isArray(entries) || !entries.length) return;
        NS.backgrounds.registerAll(entries);
        buildScenes();
        reflect();
      })
      .catch(function () { /* no scenes is fine */ });
  }

  /** Bundled models appear in the picker alongside the built-in animals. */
  function loadRegistry() {
    return fetch(chrome.runtime.getURL('models/avatars/index.json'))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (entries) {
        if (!Array.isArray(entries) || !entries.length) return;
        NS.avatarModels.registerAll(entries);
        buildGrid();
        reflect();
        entries.forEach(function (entry) {
          // Without the bytes the thumbnail is an empty square, so fetch them
          // here too and repaint once the model has been built.
          fetch(chrome.runtime.getURL('models/avatars/' + entry.file))
            .then(function (r) { return r.arrayBuffer(); })
            .then(function (buffer) {
              NS.avatarModels.provide(entry.id, buffer);
              return NS.avatarModels.ready(entry.id);
            })
            .then(function () { buildGrid(); reflect(); })
            .catch(function () { /* the flat-art thumbnail stands in */ });
        });
      })
      .catch(function () { /* no registry is fine */ });
  }

  NS.store.load().then(function (loaded) {
    settings = loaded;
    buildGrid();
    buildScenes();
    bind();
    reflect();
    refreshStatus();
    setInterval(refreshStatus, 1200);
    loadRegistry();
    loadScenes();
  });
})();
