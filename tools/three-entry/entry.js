/*
 * Entry point for the vendored Three.js bundle. Only the classes the avatar
 * renderer actually uses are re-exported, so esbuild can tree-shake the rest.
 */
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
  Float32BufferAttribute,
  BufferAttribute,
  AmbientLight,
  HemisphereLight,
  DirectionalLight,
  Color,
  Vector2,
  Vector3,
  Euler,
  MathUtils,
  DoubleSide,
  SRGBColorSpace,
  ACESFilmicToneMapping
} from 'three';
