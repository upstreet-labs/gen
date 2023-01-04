import * as THREE from 'three';
// import metaversefile from 'metaversefile';
// const {useApp} = metaversefile;

const keySize = 0.3;
const keyRadius = 0.045;
const keyInnerFactor = 0.8;
const keyGeometry = new THREE.PlaneGeometry(keySize, keySize);
function makeShape(shape, x, y, width, height, radius) {
  shape.absarc( x - width/2, y + height/2, radius, Math.PI, Math.PI / 2, true );
  shape.absarc( x + width/2, y + height/2, radius, Math.PI / 2, 0, true );
  shape.absarc( x + width/2, y - height/2, radius, 0, -Math.PI / 2, true );
  shape.absarc( x - width/2, y - height/2, radius, -Math.PI / 2, -Math.PI, true );
  return shape;
}
function createBoxWithRoundedEdges( width, height, radius, innerFactor) {
  const shape = makeShape(new THREE.Shape(), 0, 0, width, height, radius);
  const hole = makeShape(new THREE.Path(), 0, 0, width * innerFactor, height * innerFactor, radius);
  shape.holes.push(hole);

  const geometry = new THREE.ShapeGeometry(shape);
  return geometry;
}
const makeKeyMaterial = (key) => {
  const material = new THREE.MeshBasicMaterial({
    color: 0xFFFFFF,
    depthTest: false,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
  });
  (async () => {
    const texture = new THREE.Texture();
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = 16;
    const src = `/images/${key}-key.png`;
    const res = await fetch(src);
    const blob = await res.blob();
    const imageBitmap = await createImageBitmap(blob);
    texture.image = imageBitmap;
    texture.needsUpdate = true;

    material.map = texture;
  })();
  return material;
};
const keyCircleGeometry = createBoxWithRoundedEdges(keySize - keyRadius*2, keySize - keyRadius*2, keyRadius, keyInnerFactor);
const keyCircleMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uColor: {
      type: 'c',
      value: new THREE.Color(0x42a5f5),
    },
    uTime: {
      type: 'f',
      value: 0,
      needsUpdate: true,
    },
    /*uTimeCubic: {
      type: 'f',
      value: 0,
      needsUpdate: true,
    }, */
  },
  vertexShader: `\
    precision highp float;
    precision highp int;

    // uniform float uTime;
    // uniform vec4 uBoundingBox;
    // varying vec3 vPosition;
    // varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      
      vUv = uv;
    }
  `,
  fragmentShader: `\
    precision highp float;
    precision highp int;

    #define PI 3.1415926535897932384626433832795

    uniform vec3 uColor;
    uniform float uTime;
    // uniform float uTimeCubic;
    // varying vec3 vPosition;
    // varying vec3 vNormal;
    varying vec2 vUv;

    const float glowDistance = 0.2;
    const float glowIntensity = 0.3;

    void main() {
      vec3 c;
      float angle = mod((atan(vUv.x, vUv.y))/(PI*2.), 1.);
      if (angle <= uTime) {
        c = uColor;
        float angleDiff1 = (1. - min(max(uTime - angle, 0.), glowDistance)/glowDistance)*glowIntensity;
        // float angleDiff2 = min(max(angle - uTime, 0.), glowDistance)/glowDistance;
        // c *= 1. + angleDiff1 + angleDiff2;
        c *= 1. + angleDiff1;
      } else {
        c = vec3(0.2);
      }
      gl_FragColor = vec4(c, 1.);
    }
  `,
  transparent: true,
  depthTest: false,
  side: THREE.DoubleSide,
  // polygonOffset: true,
  // polygonOffsetFactor: -1,
  // polygonOffsetUnits: 1,
});

export class KeyMesh extends THREE.Object3D {
  constructor({
    key = 'e',
  } = {}) {
    super();

    const keyMesh = (() => {
      const geometry = keyGeometry;
      const material = makeKeyMaterial(key);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      return mesh;
    })();
    keyMesh.position.z = 0.01;
    this.add(keyMesh);

    const keyCircleMesh = (() => {
      const geometry = keyCircleGeometry;
      const material = keyCircleMaterial.clone();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      return mesh;
    })();
    keyCircleMesh.position.z = 0.01;
    this.add(keyCircleMesh);
  }
}