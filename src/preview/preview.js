/* Critter Cam — live preview page. */
(function () {
  'use strict';

  var NS = globalThis.__CritterCam;
  var $ = function (id) { return document.getElementById(id); };

  var settings = NS.normalizeSettings({});
  var compositor = NS.createCompositor();
  var detector = NS.createDetectorClient({
    onFace: function (face) { compositor.onFace(face); }
  });
  // Handy from the console, and used by tools/smoke-test.mjs.
  NS.previewDetector = detector;
  NS.previewCompositor = compositor;

  var video = $('camera');
  var canvas = $('output');
  var ctx = canvas.getContext('2d', { alpha: false });
  var stream = null;
  var running = false;
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

  /* ------------------------------------------------------------- controls */

  function paintThumb(canvasEl, animalId, size) {
    var dpr = window.devicePixelRatio || 1;
    canvasEl.width = size * dpr;
    canvasEl.height = size * dpr;
    var c = canvasEl.getContext('2d');
    c.clearRect(0, 0, canvasEl.width, canvasEl.height);
    var spec = NS.animals.get(animalId);
    if (NS.avatar3d && NS.avatar3d.paintThumb(c, spec, size * dpr)) return;
    NS.animals.drawThumb(c, animalId, size * dpr, { jawOpen: 0.12 });
  }

  function buildGrid() {
    var grid = $('animalGrid');
    grid.textContent = '';
    NS.animals.list().forEach(function (spec) {
      var button = document.createElement('button');
      button.className = 'animal';
      button.type = 'button';
      button.dataset.animal = spec.id;
      button.title = spec.name;
      var thumb = document.createElement('canvas');
      var label = document.createElement('span');
      label.textContent = spec.name;
      button.appendChild(thumb);
      button.appendChild(label);
      grid.appendChild(button);
      paintThumb(thumb, spec.id, 46);
      button.addEventListener('click', function () {
        settings.animal = spec.id;
        apply();
        save();
      });
    });
  }

  function apply() {
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
    paintThumb($('brand'), settings.animal, 52);

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

    compositor.setSettings(settings);
    detector.setFps(settings.detectFps);
    updateDetectorRunState();
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { NS.store.save(settings); }, 90);
  }

  function updateDetectorRunState() {
    if (running && settings.enabled && !settings.manual) detector.attach(video);
    else detector.detach();
  }

  /* --------------------------------------------------------- backgrounds */

  var SCENE_DIR = '../../models/backgrounds/';

  function buildScenes() {
    var grid = $('sceneGrid');
    grid.textContent = '';
    var tiles = [{ id: 'none', name: 'None', file: null }].concat(NS.backgrounds.list());
    tiles.forEach(function (entry) {
      var button = document.createElement('button');
      button.className = 'scene';
      button.type = 'button';
      button.dataset.background = entry.id;
      button.title = entry.name;
      var swatch = document.createElement('span');
      swatch.className = 'swatch' + (entry.file ? '' : ' empty');
      if (entry.file) swatch.style.backgroundImage = 'url("' + SCENE_DIR + entry.file + '")';
      else swatch.textContent = '\u2014';
      var label = document.createElement('span');
      label.textContent = entry.name;
      button.appendChild(swatch);
      button.appendChild(label);
      grid.appendChild(button);
      button.addEventListener('click', function () {
        settings.background = entry.id;
        apply();
        save();
      });
    });
  }

  /*
   * The scene has to be decoded before the compositor can paint it, and the
   * bytes are only read once. Reading them all up front means switching is
   * instant, and 700 KB of local files is not worth deferring.
   */
  function loadScenes() {
    return fetch(SCENE_DIR + 'index.json')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (entries) {
        if (!Array.isArray(entries) || !entries.length) return;
        NS.backgrounds.registerAll(entries);
        buildScenes();
        apply();
        entries.forEach(function (entry) {
          fetch(SCENE_DIR + entry.file)
            .then(function (r) { return r.arrayBuffer(); })
            .then(function (buf) { return NS.backgrounds.provide(entry.id, buf); })
            .catch(function () { /* the tile stays, the scene just will not paint */ });
        });
      })
      .catch(function () { /* no scenes is fine */ });
  }

  /* -------------------------------------------------------- avatar models */

  var MODEL_DIR = '../../models/avatars/';

  function describeModel(report, error) {
    var box = $('modelReport');
    if (error) {
      box.textContent = 'Could not load: ' + error;
      box.hidden = false;
      return;
    }
    if (!report) { box.hidden = true; return; }
    var m = report.measured;
    var lines = [
      'size  ' + m.width + ' x ' + m.height + ' x ' + m.depth + '  (scaled by ' + m.appliedScale + ')',
      'jaw   ' + (report.channels.jawOpen ? report.channels.jawOpen + ' morph target(s)'
        : report.nodes.jaw ? 'bone "' + report.nodes.jaw + '"' : 'none - mouth will not move'),
      'blink ' + (report.channels.blinkLeft + report.channels.blinkRight
        ? report.channels.blinkLeft + ' left, ' + report.channels.blinkRight + ' right'
        : 'none - eyes will not blink'),
      'brow  ' + (report.channels.brow ? report.channels.brow + ' target(s)' : 'none'),
      'smile ' + (report.channels.smile ? report.channels.smile + ' target(s)' : 'none')
    ];
    box.textContent = lines.join('\n');
    box.hidden = false;
  }

  /** Registers models listed in models/avatars/index.json. */
  function loadRegistry() {
    return fetch(MODEL_DIR + 'index.json')
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (entries) {
        if (!Array.isArray(entries) || !entries.length) return;
        NS.avatarModels.registerAll(entries);
        buildGrid();
        apply();
        entries.forEach(function (entry) {
          // The grid above is drawn before any of this has arrived, so its
          // thumbnails are empty squares. Repaint each one as its model
          // finishes parsing, the way the popup does.
          fetch(MODEL_DIR + entry.file)
            .then(function (r) { return r.arrayBuffer(); })
            .then(function (buf) {
              NS.avatarModels.provide(entry.id, buf);
              return NS.avatarModels.ready(entry.id);
            })
            .then(function () { buildGrid(); apply(); })
            .catch(function () { /* reported when selected */ });
        });
      })
      .catch(function () { /* no registry is fine */ });
  }

  /** Loads a model straight off disk, so authors can iterate without bundling. */
  function tryModelFile(file) {
    var id = 'file-' + Date.now().toString(36);
    file.arrayBuffer().then(function (buffer) {
      NS.animals.registerModel({ id: id, name: file.name.replace(/\.(glb|gltf)$/i, ''), file: file.name });
      NS.avatarModels.provide(id, buffer);
      return NS.avatarModels.parse(buffer, { id: id });
    }).then(function (built) {
      describeModel(built.report, null);
      settings.animal = id;
      buildGrid();
      apply();
      save();
    }).catch(function (error) {
      describeModel(null, String(error && error.message || error));
    });
  }

  /* --------------------------------------------------------------- camera */

  function listDevices() {
    if (!navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (devices) {
      var cameras = devices.filter(function (d) { return d.kind === 'videoinput'; });
      var select = $('device');
      if (cameras.length < 2) { select.hidden = true; return; }
      var current = select.value;
      select.textContent = '';
      cameras.forEach(function (cam, index) {
        var option = document.createElement('option');
        option.value = cam.deviceId;
        option.textContent = cam.label || 'Camera ' + (index + 1);
        select.appendChild(option);
      });
      if (current) select.value = current;
      select.hidden = false;
    });
  }

  async function startCamera(deviceId) {
    stopCamera();
    setStatus('warn', 'Starting camera…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false
      });
    } catch (error) {
      setStatus('bad', 'Camera blocked: ' + error.message);
      return;
    }
    video.srcObject = stream;
    await video.play();
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    running = true;
    $('overlay').hidden = true;
    $('stop').hidden = false;
    listDevices();
    updateDetectorRunState();
    loop();
  }

  function stopCamera() {
    running = false;
    detector.detach();
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    stream = null;
    video.srcObject = null;
    compositor.reset();
    $('overlay').hidden = false;
    $('stop').hidden = true;
    setStatus('', 'Camera off');
  }

  function loop() {
    if (!running) return;
    try {
      if (video.readyState >= 2) {
        if (canvas.width !== video.videoWidth && video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        compositor.drawFrame(ctx, canvas.width, canvas.height, video);
      }
    } catch (error) { /* skip a bad frame */ }
    reportStatus();
    requestAnimationFrame(loop);
  }

  var lastStatusAt = 0;
  function reportStatus() {
    var now = performance.now();
    if (now - lastStatusAt < 500) return;
    lastStatusAt = now;

    var stats = compositor.getStats();
    var detectorStatus = detector.getStatus();
    if (!settings.enabled) {
      setStatus('warn', 'Filter is off — camera passing through · ' + stats.fps + ' fps');
      return;
    }
    if (settings.manual) {
      setStatus('good', 'Pinned in place · ' + stats.fps + ' fps');
      return;
    }
    if (detectorStatus.state === 'error') {
      setStatus('bad', 'Face tracking failed: ' + detectorStatus.error);
      return;
    }
    if (detectorStatus.state !== 'ready') {
      setStatus('warn', 'Loading the face tracker…');
      return;
    }
    setStatus(
      stats.tracking ? 'good' : 'warn',
      (stats.tracking ? 'Tracking your face' : 'No face found') +
      ' · ' + stats.fps + ' fps · ' + detectorStatus.delegate + ' ' + Math.round(detectorStatus.cost) + ' ms'
    );
  }

  function setStatus(tone, text) {
    $('statusDot').className = 'dot' + (tone ? ' ' + tone : '');
    $('statusText').textContent = text;
  }

  /* ---------------------------------------------------------------- setup */

  function bind() {
    TOGGLES.forEach(function (id) {
      $(id).addEventListener('change', function () {
        settings[id] = $(id).checked;
        apply();
        save();
      });
    });
    SLIDERS.forEach(function (slider) {
      $(slider.id).addEventListener('input', function () {
        settings[slider.id] = Number($(slider.id).value);
        $(slider.id + 'Value').textContent = slider.format(Number(settings[slider.id]));
        compositor.setSettings(settings);
        detector.setFps(settings.detectFps);
        save();
      });
    });
    $('onLost').addEventListener('change', function () {
      settings.onLost = $('onLost').value;
      apply();
      save();
    });
    $('start').addEventListener('click', function () { startCamera($('device').value || null); });
    $('stop').addEventListener('click', stopCamera);
    $('device').addEventListener('change', function () { startCamera($('device').value); });
    $('mirror').addEventListener('change', function () {
      canvas.classList.toggle('mirrored', $('mirror').checked);
    });
    $('modelFile').addEventListener('change', function (event) {
      var file = event.target.files && event.target.files[0];
      if (file) tryModelFile(file);
    });
    $('reset').addEventListener('click', function () {
      settings = NS.normalizeSettings({});
      apply();
      NS.store.save(settings);
    });
    window.addEventListener('beforeunload', stopCamera);
  }

  canvas.classList.add('mirrored');

  NS.store.load().then(function (loaded) {
    settings = loaded;
    buildGrid();
    buildScenes();
    bind();
    apply();
    loadRegistry();
    loadScenes();
  });

  // Keep in step with edits made from the popup while this tab is open.
  NS.store.onChange(function (next) {
    settings = next;
    apply();
  });
})();
