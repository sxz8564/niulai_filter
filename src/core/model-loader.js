/*
 * Critter Cam — imported avatar models.
 *
 * Loads glTF/GLB heads and adapts them to the same contract the built-in
 * animals use, so the compositor and the camera pipeline need no changes:
 * a group positioned by the tracked head pose, plus an `animate(params)`
 * that drives expression.
 *
 * Two things are done for the author rather than demanded of them:
 *
 *   Fit    the model is measured and normalised so its width is one unit,
 *          which is what the renderer treats as one head width. Authors can
 *          override with `scale`, `offset` and `rotation`.
 *   Rig    morph targets and nodes are matched by name against a table of
 *          common conventions (ARKit, Ready Player Me, plain English), so a
 *          model exported from most pipelines animates without configuration.
 *
 * The format contract is documented in docs/AVATAR-MODELS.md.
 *
 * Runs in the page's MAIN world as well as extension pages, so it must not
 * touch `chrome.*`; model bytes are handed in by the caller.
 */
(function () {
  'use strict';

  var NS = (globalThis.__CritterCam = globalThis.__CritterCam || {});
  if (NS.avatarModels) return;

  var DEG = Math.PI / 180;

  /*
   * Expression channels, and the morph-target names seen in the wild for each.
   * Matching is case-insensitive and ignores separators, so `eyeBlink_L`,
   * `eyeBlinkLeft` and `EyeBlinkL` all hit the same channel.
   */
  var MORPH_ALIASES = {
    jawOpen: ['jawopen', 'mouthopen', 'jaw', 'visemeaa', 'aa', 'mouthjawopen'],
    blinkLeft: ['eyeblinkleft', 'eyeblinkl', 'blinkleft', 'blinkl', 'eyesclosedl'],
    blinkRight: ['eyeblinkright', 'eyeblinkr', 'blinkright', 'blinkr', 'eyesclosedr'],
    brow: ['browinnerup', 'browup', 'browsup', 'browraise', 'eyebrowup'],
    smile: ['mouthsmile', 'mouthsmileleft', 'mouthsmileright', 'smile', 'happy']
  };

  /** Node names that can stand in for a morph target. */
  var NODE_ALIASES = {
    jaw: ['jaw', 'lowerjaw', 'jawbone', 'chin'],
    earLeft: ['earl', 'earleft', 'leftear'],
    earRight: ['earr', 'earright', 'rightear']
  };

  function normalizeName(name) {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function matches(name, aliases) {
    var n = normalizeName(name);
    for (var i = 0; i < aliases.length; i++) {
      if (n === aliases[i] || n.indexOf(aliases[i]) !== -1) return true;
    }
    return false;
  }

  /**
   * Finds every morph target that drives each expression channel. A model may
   * split one expression across several meshes (face, teeth, tongue), so each
   * channel keeps a list of targets rather than a single one.
   */
  function findMorphs(root, overrides) {
    var channels = { jawOpen: [], blinkLeft: [], blinkRight: [], brow: [], smile: [] };
    root.traverse(function (node) {
      var dict = node.morphTargetDictionary;
      if (!dict || !node.morphTargetInfluences) return;
      Object.keys(dict).forEach(function (morphName) {
        var index = dict[morphName];
        Object.keys(channels).forEach(function (channel) {
          var explicit = overrides && overrides[channel];
          var hit = explicit
            ? normalizeName(explicit) === normalizeName(morphName)
            : matches(morphName, MORPH_ALIASES[channel]);
          if (hit) channels[channel].push({ mesh: node, index: index });
        });
      });
    });
    return channels;
  }

  function findNodes(root, overrides) {
    var found = { jaw: null, earLeft: null, earRight: null };
    root.traverse(function (node) {
      Object.keys(found).forEach(function (key) {
        if (found[key]) return;
        var explicit = overrides && overrides[key];
        var hit = explicit
          ? normalizeName(explicit) === normalizeName(node.name)
          : matches(node.name, NODE_ALIASES[key]);
        if (hit) found[key] = node;
      });
    });
    return found;
  }

  /** The bounding box of the geometry as authored, ignoring morph targets. */
  function restingBox(three, scene) {
    var box = new three.Box3();
    var vertex = new three.Vector3();
    scene.updateMatrixWorld(true);
    scene.traverse(function (node) {
      var position = node.isMesh && node.geometry && node.geometry.attributes.position;
      if (!position) return;
      for (var i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
        box.expandByPoint(vertex);
      }
    });
    return box;
  }

  /**
   * Centres and scales a loaded scene so one unit is one head width, matching
   * what the renderer expects of the built-in animals.
   */
  function fit(three, scene, config) {
    var wrapper = new three.Group();
    var inner = new three.Group();
    inner.add(scene);
    wrapper.add(inner);

    var rot = config.rotation || [0, 0, 0];
    scene.rotation.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG);
    scene.updateMatrixWorld(true);

    // Measure the rest pose only. Box3.setFromObject includes the extremes of
    // every morph target, so a rigged head would be fitted to its widest open
    // mouth and sit smaller and off-centre next to the same head unrigged.
    var box = restingBox(three, scene);
    var size = box.getSize(new three.Vector3());
    var centre = box.getCenter(new three.Vector3());

    var width = size.x || 1;
    var autoScale = 1 / width;
    var scale = autoScale * (config.scale === undefined ? 1 : config.scale);
    inner.scale.setScalar(scale);

    // Centre on the bounding box, then apply the author's offset in head widths.
    var offset = config.offset || [0, 0, 0];
    inner.position.set(
      -centre.x * scale + offset[0],
      -centre.y * scale + offset[1],
      -centre.z * scale + offset[2]
    );

    return {
      group: wrapper,
      measured: {
        width: +size.x.toFixed(4),
        height: +size.y.toFixed(4),
        depth: +size.z.toFixed(4),
        appliedScale: +scale.toFixed(5)
      }
    };
  }

  /** Builds the {group, parts} the renderer expects from a loaded glTF scene. */
  function adopt(three, gltf, config) {
    config = config || {};
    var scene = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!scene) throw new Error('model contains no scene');

    // Generators often emit position-only meshes; without normals the surface
    // has no shading at all, so derive them rather than rejecting the model.
    var computedNormals = 0;
    scene.traverse(function (node) {
      if (!node.isMesh || !node.geometry || node.geometry.attributes.normal) return;
      node.geometry.computeVertexNormals();
      computedNormals++;
      // GLTFLoader turns on flat shading for a primitive that arrived without
      // normals; now that there are normals, let the surface shade smoothly.
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach(function (material) {
        if (material && material.flatShading) {
          material.flatShading = false;
          material.needsUpdate = true;
        }
      });
    });

    // Generators frequently export with no materials at all, which renders as
    // flat white. `tint` colours those surfaces; textured materials are left
    // alone so a properly painted model is never overwritten.
    var tinted = 0;
    if (config.tint) {
      var colour = new three.Color(config.tint);
      scene.traverse(function (node) {
        if (!node.isMesh || !node.material) return;
        var mats = Array.isArray(node.material) ? node.material : [node.material];
        mats.forEach(function (material) {
          if (material.map || !material.color) return;
          material.color.copy(colour);
          tinted++;
        });
      });
    }

    var fitted = fit(three, scene, config);
    var morphs = findMorphs(scene, config.morphs);
    var nodes = findNodes(scene, config.nodes);

    var jawRest = nodes.jaw ? nodes.jaw.rotation.x : 0;
    var jawAxis = config.jawAxis || 'x';
    var jawRange = (config.jawDegrees === undefined ? 16 : config.jawDegrees) * DEG;
    var earRest = {
      left: nodes.earLeft ? nodes.earLeft.rotation.z : 0,
      right: nodes.earRight ? nodes.earRight.rotation.z : 0
    };

    function setChannel(channel, value) {
      var targets = morphs[channel];
      for (var i = 0; i < targets.length; i++) {
        targets[i].mesh.morphTargetInfluences[targets[i].index] = value;
      }
      return targets.length > 0;
    }

    var parts = {
      lids: [], ears: [], brows: [],
      /** Poses the model. Channels the model does not have are simply skipped. */
      animate: function (params) {
        setChannel('jawOpen', params.jawOpen || 0);
        setChannel('blinkLeft', params.blinkL || 0);
        setChannel('blinkRight', params.blinkR || 0);
        setChannel('brow', params.brow || 0);
        setChannel('smile', params.smile || 0);

        // A jaw bone is the fallback when the model has no jawOpen morph.
        if (nodes.jaw && morphs.jawOpen.length === 0) {
          nodes.jaw.rotation[jawAxis] = jawRest + (params.jawOpen || 0) * jawRange;
        }
        var swing = (params.earSwing || 0) * 0.5;
        if (nodes.earLeft) nodes.earLeft.rotation.z = earRest.left + swing;
        if (nodes.earRight) nodes.earRight.rotation.z = earRest.right - swing;
      }
    };

    return {
      group: fitted.group,
      parts: parts,
      report: {
        measured: fitted.measured,
        computedNormals: computedNormals,
        tintedMaterials: tinted,
        channels: Object.keys(morphs).reduce(function (acc, key) {
          acc[key] = morphs[key].length;
          return acc;
        }, {}),
        nodes: {
          jaw: nodes.jaw ? nodes.jaw.name : null,
          earLeft: nodes.earLeft ? nodes.earLeft.name : null,
          earRight: nodes.earRight ? nodes.earRight.name : null
        }
      }
    };
  }

  /*
   * Model bytes arrive from whichever context can read extension files: the
   * content-script bridge on a host page, or the page itself in the preview.
   * Builders ask for them by id and get a promise, so a head can be created
   * before its bytes have landed.
   */
  var bytes = {};
  var waiting = {};

  /*
   * Parsing finishes well after the bytes land — textures decode
   * asynchronously — and a picker that painted its thumbnail in between gets
   * an empty one. `ready` resolves when a model has actually been built, so a
   * caller can repaint then rather than guessing at a delay.
   */
  /*
   * The first build of a model is kept, so a caller that needs a head *now* —
   * a picker painting one thumbnail per animal — gets the real thing instead
   * of an empty shell that fills a tick too late. One page has one avatar
   * renderer, so a single instance can be handed out repeatedly; it is removed
   * from the scene before it is added again.
   */
  var builtFor = {};

  var readied = {};
  function readyFor(id) {
    if (!readied[id]) {
      var entry = {};
      entry.promise = new Promise(function (resolve) { entry.resolve = resolve; });
      readied[id] = entry;
    }
    return readied[id];
  }

  var loader = null;
  function getLoader(three) {
    if (!loader) loader = new three.GLTFLoader();
    return loader;
  }

  NS.avatarModels = {
    MORPH_ALIASES: MORPH_ALIASES,
    NODE_ALIASES: NODE_ALIASES,

    /**
     * Parses model bytes and adapts them for the renderer.
     * @param {ArrayBuffer|string} data .glb bytes, or .gltf JSON text
     * @param {object} config entry from models/avatars/index.json
     * @returns {Promise<{group, parts, report}>}
     */
    parse: function (data, config) {
      var three = globalThis.THREE;
      if (!three || !three.GLTFLoader) {
        return Promise.reject(new Error('Three.js GLTFLoader is unavailable'));
      }
      return new Promise(function (resolve, reject) {
        try {
          getLoader(three).parse(data, config && config.resourcePath || '', function (gltf) {
            try {
              var adopted = adopt(three, gltf, config);
              if (config && config.id) {
                if (!builtFor[config.id]) builtFor[config.id] = adopted;
                readyFor(config.id).resolve(adopted.report);
              }
              resolve(adopted);
            } catch (error) { reject(error); }
          }, reject);
        } catch (error) {
          reject(error);
        }
      });
    },

    /** Hands over model bytes, releasing anything waiting on them. */
    provide: function (id, buffer) {
      bytes[id] = buffer;
      var queue = waiting[id] || [];
      delete waiting[id];
      queue.forEach(function (resolve) { resolve(buffer); });
    },

    /** Resolves when the bytes for `id` are available. */
    request: function (id) {
      if (bytes[id]) return Promise.resolve(bytes[id]);
      return new Promise(function (resolve) {
        (waiting[id] = waiting[id] || []).push(resolve);
      });
    },

    has: function (id) { return !!bytes[id]; },

    /** Resolves once `id` has been parsed and built at least once. */
    ready: function (id) { return readyFor(id).promise; },

    /** The head built for `id`, if one has been built already. */
    built: function (id) { return builtFor[id] || null; },

    /** Adds registry entries to the animal picker. */
    registerAll: function (entries) {
      if (!NS.animals || !NS.animals.registerModel) return [];
      return (entries || []).map(function (entry) {
        return NS.animals.registerModel(entry);
      }).filter(Boolean);
    },

    /** Convenience for extension pages, which may fetch their own files. */
    load: function (url, config) {
      var self = this;
      return fetch(url).then(function (response) {
        if (!response.ok) throw new Error('could not read ' + url + ' (' + response.status + ')');
        return response.arrayBuffer();
      }).then(function (buffer) {
        return self.parse(buffer, config);
      });
    }
  };
})();
