/*
 * Entry point for the vendored Three.js bundle. Only the classes the avatar
 * renderer actually uses are re-exported, so esbuild can tree-shake the rest.
 *
 * GLTFLoader is included so the extension can load imported avatar models
 * (.glb / .gltf). Draco and Meshopt decoders are deliberately not bundled -
 * see docs/AVATAR-MODELS.md, which tells authors to export uncompressed.
 */
export { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export {
  Scene,
  Group,
  Mesh,
  OrthographicCamera,
  WebGLRenderer,
  MeshStandardMaterial,
  SphereGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  BoxGeometry,
  TorusGeometry,
  LatheGeometry,
  BufferGeometry,
  AmbientLight,
  HemisphereLight,
  DirectionalLight,
  Color,
  Vector2,
  Vector3,
  Euler,
  MathUtils,
  Box3,
  Sphere,
  AnimationMixer,
  Object3D,
  DoubleSide,
  SRGBColorSpace,
  ACESFilmicToneMapping
} from 'three';
