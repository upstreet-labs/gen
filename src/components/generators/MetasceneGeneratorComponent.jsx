import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
// import {OBB} from 'three/examples/jsm/math/OBB.js';
import {useState, useRef, useEffect} from 'react';
import alea from 'alea';
import concaveman from 'concaveman';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
// import {Text} from 'troika-three-text';
// import * as passes from '../../generators/ms-passes.js';
import {
  setPerspectiveCameraFromJson,
  getPerspectiveCameraJson,
  setOrthographicCameraFromJson,
  getOrthographicCameraJson,
} from '../../zine/zine-camera-utils.js';
import {
  StoryTargetMesh, // XXX should be abstracted out and shared with app
} from '../../generators/story-target-mesh.js';
import {
  reconstructPointCloudFromDepthField,
  pointCloudArrayBufferToGeometry,
  reinterpretFloatImageData,
  depthFloat32ArrayToPositionAttributeArray,
  depthFloat32ArrayToGeometry,
  depthFloat32ArrayToOrthographicPositionAttributeArray,
  depthFloat32ArrayToOrthographicGeometry,
  depthFloat32ArrayToHeightfield,
  getDepthFloatsFromPointCloud,
  getDepthFloatsFromIndexedGeometry,
  setCameraViewPositionFromViewZ,
  getDoubleSidedGeometry,
  getGeometryHeights,
} from '../../zine/zine-geometry-utils.js';
import {
  mainImageKey,
} from '../../zine/zine-data-specs.js';
import {
  panelSize,
  floorNetWorldSize,
  floorNetWorldDepth,
  floorNetResolution,
  floorNetPixelSize,
  physicsPixelStride,
  portalExtrusion,
  entranceExitEmptyDiameter,
  entranceExitHeight,
  entranceExitWidth,
  entranceExitDepth,
} from '../../zine/zine-constants.js';
// import {
//   depthVertexShader,
//   depthFragmentShader,
// } from '../../utils/sg-shaders.js';
import {
  depthFloats2Canvas,
} from '../../generators/sg-debug.js';
import {
  makeRenderer,
  makeGltfLoader,
  makeDefaultCamera,
  makeFloorNetCamera,
  makeMapIndexCamera,
  normalToQuaternion,
} from '../../zine/zine-utils.js';
import {
  zineMagicBytes,
  ZineStoryboard,
  // ZinePanel,
  // ZineData,
  initCompressor,
} from '../../zine/zine-format.js';
// import {
//   ZineRenderer,
// } from '../../zine/zine-renderer.js';
import {colors} from '../../zine/zine-colors.js';
import {
  // getCoverageRenderSpecsMeshes,
  // renderMeshesCoverage,
  getDepthRenderSpecsMeshes,
  renderMeshesDepth,
} from '../../clients/reconstruction-client.js';
import {
  pushMeshes,
} from '../../zine/zine-utils.js';
import {
  DropTarget,
} from '../drop-target/DropTarget.jsx';

import styles from '../../../styles/MetasceneGenerator.module.css';
import {
  blob2img,
} from '../../utils/convert-utils.js';
import {
  ImageAiClient,
} from '../../clients/image-client.js';

//

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localVector3 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();
// const localBox = new THREE.Box3();
const localColor = new THREE.Color();

const oneVector = new THREE.Vector3(1, 1, 1);
const upVector = new THREE.Vector3(0, 1, 0);
const y180Quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const y180Matrix = new THREE.Matrix4().makeRotationY(Math.PI);

const fakeMaterial = new THREE.MeshBasicMaterial({
  color: 0xFF0000,
});

const imageAiClient = new ImageAiClient();

//

const defaultMaxWorkers = globalThis?.navigator?.hardwareConcurrency ?? 4;
const panelSpecGeometrySize = 256;
const panelSpecTextureSize = 256;
const metazineAtlasTextureSize = 4096;
const metazineAtlasTextureRowSize = Math.floor(metazineAtlasTextureSize / panelSpecTextureSize);
const orbitControlsDistance = 10;

//

/* const loadFileUint8Array = async fileName => {
  const res = await fetch(fileName);
  const arrayBuffer = await res.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  return uint8Array;
}; */
const blockEvent = e => {
  e.preventDefault();
  e.stopPropagation();
};

//

class EntranceExitMesh extends THREE.Mesh { // XXX needs to be unified with the one in scene-generator.js
  constructor({
    entranceExitLocations,
  }) {
    const baseGeometry = new THREE.BoxGeometry(entranceExitWidth, entranceExitHeight, entranceExitDepth)
      .translate(0, entranceExitHeight / 2, entranceExitDepth / 2);
    const geometries = entranceExitLocations.map(portalLocation => {
      const g = baseGeometry.clone();
      g.applyMatrix4(
        localMatrix.compose(
          localVector.fromArray(portalLocation.position),
          localQuaternion.fromArray(portalLocation.quaternion),
          localVector2.setScalar(1)
        )
      );
      return g;
    });
    const geometry = geometries.length > 0 ? BufferGeometryUtils.mergeBufferGeometries(geometries) : new THREE.BufferGeometry();

    const material = new THREE.ShaderMaterial({
      vertexShader: `\
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `\
        varying vec2 vUv;

        void main() {
          vec3 c = vec3(1., 0., 1.);
          gl_FragColor = vec4(c, 0.5);
          gl_FragColor.rg += vUv * 0.2;
        }
      `,
      transparent: true,
    });
    super(geometry, material);

    const hasGeometry = geometries.length > 0;

    const entranceExitMesh = this;
    entranceExitMesh.frustumCulled = false;
    entranceExitMesh.enabled = false;
    entranceExitMesh.visible = false;
    entranceExitMesh.updateVisibility = () => {
      entranceExitMesh.visible = entranceExitMesh.enabled && hasGeometry;
    };
  }
}

//

const getPanelSpecsGeometry = panelSpecs => {
  const geometries = panelSpecs.map((panelSpec, i) => {
    const {sceneChunkMesh} = panelSpec;
    // apply transform
    const g = sceneChunkMesh.geometry.clone()
      .applyMatrix4(
        sceneChunkMesh.matrixWorld
      );
    // set uvs
    const uvs = g.attributes.uv.array;
    const px = (i % metazineAtlasTextureRowSize) / metazineAtlasTextureRowSize;
    const py = Math.floor(i / metazineAtlasTextureRowSize) / metazineAtlasTextureRowSize;
    for (let i = 0; i < uvs.length; i += 2) {
      uvs[i + 0] = uvs[i + 0] * panelSpecTextureSize / metazineAtlasTextureSize + px;
      uvs[i + 1] = uvs[i + 1] * panelSpecTextureSize / metazineAtlasTextureSize + py;
    }
    g.attributes.uv.needsUpdate = true;
    return g;
  });
  return BufferGeometryUtils.mergeBufferGeometries(geometries);
};
const getPanelSpecsAtlasTextureImageAsync = async panelSpecs => {
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = metazineAtlasTextureSize;
  atlasCanvas.height = metazineAtlasTextureSize;
  const ctx = atlasCanvas.getContext('2d');

  for (let i = 0; i < panelSpecs.length; i++) {
    const panelSpec = panelSpecs[i];
    
    const {imageArrayBuffer} = panelSpec;
    const blob = new Blob([imageArrayBuffer]);
    const imageBitmap = await createImageBitmap(blob);
    
    const x = (i % metazineAtlasTextureRowSize) * panelSpecTextureSize;
    let y = Math.floor(i / metazineAtlasTextureRowSize) * panelSpecTextureSize;
    y = metazineAtlasTextureSize - y - panelSpecTextureSize;

    ctx.drawImage(
      imageBitmap,
      x, y,
      panelSpecTextureSize, panelSpecTextureSize
    );
  }

  return atlasCanvas;
};
class SceneBatchedMesh extends THREE.Mesh {
  constructor({
    panelSpecs = [],
  }) {
    const geometry = getPanelSpecsGeometry(panelSpecs);
    
    const map = new THREE.Texture();
    (async () => {
      const atlasTextureImage = await getPanelSpecsAtlasTextureImageAsync(panelSpecs);
      atlasTextureImage.style.cssText = `\
        position: relative;
        max-width: 1024px;
        max-height: 1024px;
        background: red;
      `;
      atlasTextureImage.classList.add('atlasTextureImage');
      document.body.appendChild(atlasTextureImage);

      map.image = atlasTextureImage;
      map.needsUpdate = true;
    })();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: {
          value: map,
          needsUpdate: true,
        },
      },
      vertexShader: `\
        varying vec2 vUv;
        // varying vec3 vNormal;

        void main() {
          vUv = uv;
          // vNormal = normal;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `\
        uniform sampler2D map;
        varying vec2 vUv;
        // varying vec3 vNormal;

        void main() {
          // gl_FragColor = vec4(vNormal, 1.0);
          gl_FragColor = texture2D(map, vUv);
          // gl_FragColor = vec4(vUv, 0.0, 1.0);
          // gl_FragColor.rg + vUv;
        }
      `,
    });

    super(geometry, material);
    this.frustumCulled = false;
  }
}

//

class MapIndexMesh extends THREE.Mesh {
  constructor({
    mapIndex,
    mapIndexResolution,
  }) {
    const geometry = new THREE.PlaneGeometry(floorNetWorldSize, floorNetWorldSize)
      .rotateX(-Math.PI / 2);
  
    const mapIndexUnpacked = new Uint8Array(mapIndex.length * 4);
    for (let i = 0; i < mapIndex.length; i++) {
      const indexValue = mapIndex[i];
      const c = localColor.setHex(colors[indexValue % colors.length]);
      mapIndexUnpacked[i * 4] = c.r * 255;
      mapIndexUnpacked[i * 4 + 1] = c.g * 255;
      mapIndexUnpacked[i * 4 + 2] = c.b * 255;
      mapIndexUnpacked[i * 4 + 3] = 255;
    }

    const [
      width,
      height,
    ] = mapIndexResolution;
    const map = new THREE.DataTexture(
      mapIndexUnpacked,
      width,
      height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    map.minFilter = THREE.NearestFilter;
    map.magFilter = THREE.NearestFilter;
    map.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: {
          value: map,
          needsUpdate: true,
        },
      },
      vertexShader: `\
        varying vec2 vUv;
        
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `\
        uniform sampler2D map;
        varying vec2 vUv;

        void main() {
          gl_FragColor = texture2D(map, vUv);
          
          if (gl_FragColor.a < 0.5) {
            gl_FragColor.rgb = vec3(0.1);
            gl_FragColor.a = 1.;
          }
        }
      `,
      // color: 0xFF0000,
      // transparent: true,
      // opacity: 0.7,
      // side: THREE.BackSide,
      side: THREE.DoubleSide,
    });

    super(geometry, material);

    this.frustumCulled = false;
  }
}

//

const getMapIndexSpecsMeshes = (renderSpecs) => {
  const meshes = [];

  // let vertexShader = depthVertexShader;
  // let fragmentShader = depthFragmentShader;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      // cameraNear: {
      //   value: camera.near,
      //   needsUpdate: true,
      // },
      // cameraFar: {
      //   value: camera.far,
      //   needsUpdate: true,
      // },
      // isPerspective: {
      //   value: +camera.isPerspectiveCamera,
      //   needsUpdate: true,
      // },
    },
    vertexShader: `\
      attribute float panelIndex;
      flat varying float vPanelIndex;

      void main() {
        vPanelIndex = panelIndex;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `\
      flat varying float vPanelIndex;

      void main() {
        gl_FragColor = vec4(vPanelIndex, 0., 0., 1.);
      }
    `,
    side: THREE.BackSide,
  });

  for (const renderSpec of renderSpecs) {
    const {geometry, matrixWorld} = renderSpec;
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'mapIndexMesh';
    mesh.frustumCulled = false;
    mesh.matrix.copy(matrixWorld)
      .decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.matrixWorld.copy(mesh.matrix);
    meshes.push(mesh);
  }

  return meshes;
};

//

/* const renderMeshesMapIndexFull = (meshes, width, height, camera) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.classList.add('mapIndexCanvas');
  const renderer = makeRenderer(canvas);
  // document.body.appendChild(canvas);

  const mapIndexScene = new THREE.Scene();
  mapIndexScene.autoUpdate = false;
  for (const mapIndexMesh of meshes) {
    mapIndexScene.add(mapIndexMesh);
  }

  // render target
  const mapIndexRenderTarget = new THREE.WebGLRenderTarget(
    width,
    height,
    {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    }
  );

  // render
  // XXX render to the canvas, for debugging
  // renderer.render(mapIndexScene, camera);

  // real render to the render target
  renderer.setRenderTarget(mapIndexRenderTarget);
  // renderer.clear();
  renderer.render(mapIndexScene, camera);
  renderer.setRenderTarget(null);
  
  // read back image data
  const imageData = {
    data: new Uint8Array(mapIndexRenderTarget.width * mapIndexRenderTarget.height * 4),
    width,
    height,
  };
  renderer.readRenderTargetPixels(mapIndexRenderTarget, 0, 0, mapIndexRenderTarget.width, mapIndexRenderTarget.height, imageData.data);

  // latch rendered map index data
  // note: we flip in the x direction,
  // since we render from the bottom but we want the image right side up when sampling from the top
  const mapIndex = new Uint8Array(imageData.data.length / 4);
  for (let i = 0; i < imageData.data.length; i += 4) {
    mapIndex[i / 4] = imageData.data[i]; // r
  }
  
  const mapIndexResolution = [
    mapIndexRenderTarget.width,
    mapIndexRenderTarget.height,
  ];

  // return result
  return {
    mapIndex,
    mapIndexResolution,
  };
}; */
const flipUint8ArrayX = (uint8Array, width, height) => {
  const uint8Array2 = new Uint8Array(uint8Array.length);
  for (let dx = 0; dx < width; dx++) {
    for (let dy = 0; dy < height; dy++) {
      const x = width - 1 - dx;
      const y = dy;
      const dstIndex = x + y * width;
      const srcIndex = dx + dy * width;
      uint8Array2[dstIndex] = uint8Array[srcIndex];
    }
  }
  return uint8Array2;
};
/* export function renderMapIndexFull({
  renderSpecs,
  camera,
}) {
  const width = floorNetPixelSize;
  const height = floorNetPixelSize;
  const meshes = getMapIndexSpecsMeshes(renderSpecs);
  const mapIndexSpec = renderMeshesMapIndexFull(meshes, width, height, camera);
  return mapIndexSpec;
} */
export function renderMapIndexAdd({
  oldMapIndex,
  newRenderSpecs,
  attachPanelIndex,
  camera,
}) {
  const width = floorNetPixelSize;
  const height = floorNetPixelSize;
  debugger;
  const meshes = getMapIndexSpecsMeshes(newRenderSpecs);
}

//

const getRenderSpecsFromZineRenderers = zineRenderers => {
  return zineRenderers.map((zineRenderer, index) => {
    const {panel} = zineRenderer;
    const layers = panel.getLayers();
    
    // const layer0 = layers[0];
    const layer1 = layers[1];
    const depthFieldArrayBuffer = layer1.getData('depthField');
    const cameraJson = layer1.getData('cameraJson');
    const camera = setPerspectiveCameraFromJson(new THREE.PerspectiveCamera(), cameraJson);
    const resolution = layer1.getData('resolution');
    const [
      width,
      height,
    ] = resolution;
    
    let pointCloudArrayBuffer;
    {
      const pointCloudFloat32Array = reconstructPointCloudFromDepthField(
        depthFieldArrayBuffer,
        width,
        height,
        camera.fov,
      );
      pointCloudArrayBuffer = pointCloudFloat32Array.buffer;
    }

    let geometry = pointCloudArrayBufferToGeometry(pointCloudArrayBuffer, width, height);
    // const panelIndex = new Uint8Array(geometry.attributes.position.count)
    //   .fill(index + 1);
    // geometry.setAttribute('panelIndex', new THREE.BufferAttribute(panelIndex, 1, true));
    // geometry = geometry.toNonIndexed();
    // // add barycentric coordinates
    // const barycentric = new Float32Array(geometry.attributes.position.count * 3);
    // for (let i = 0; i < barycentric.length; i += 9) {
    //   barycentric[i + 0] = 1;
    //   barycentric[i + 1] = 0;
    //   barycentric[i + 2] = 0;

    //   barycentric[i + 3] = 0;
    //   barycentric[i + 4] = 1;
    //   barycentric[i + 5] = 0;

    //   barycentric[i + 6] = 0;
    //   barycentric[i + 7] = 0;
    //   barycentric[i + 8] = 1;
    // }
    // geometry.setAttribute('barycentric', new THREE.BufferAttribute(barycentric, 3));

    const matrixWorld = zineRenderer.transformScene.matrixWorld.clone();
    
    return {
      geometry,
      matrixWorld,
    };
  });
};
/* const getMapIndexFromZineRenderersFull = ({
  zineRenderers,
  camera,
}) => {
  const renderSpecs = getRenderSpecsFromZineRenderers(zineRenderers);
  const mapIndexSpec = renderMapIndexFull({
    renderSpecs,
    camera,
  });
  const mapIndex = mapIndexSpec.mapIndex;
  const mapIndexResolution = mapIndexSpec.mapIndexResolution;

  return {
    mapIndex,
    mapIndexResolution,
  };
}; */
const getMapIndexFromZineRenderersAdd = ({
  oldMapIndex, // old map index
  newZineRenderer, // new zine renderer to add
  attachPanelIndex, // we are ok with the new zine renderer clobbering this panel index only
  camera, // camera used to render the old map index
}) => {
  const newRenderSpecs = getRenderSpecsFromZineRenderers([
    newZineRenderer,
  ]);
  const mapIndexSpec = renderMapIndexAdd({
    oldMapIndex,
    newRenderSpecs,
    attachPanelIndex,
    camera,
  });
  const mapIndex = mapIndexSpec.mapIndex;
  const mapIndexResolution = mapIndexSpec.mapIndexResolution;

  return {
    mapIndex,
    mapIndexResolution,
  };
};

//

class MapIndexMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        mode: {
          value: 0, // 0 = keep, 1 = replace
          needsUpdate: false,
        },
        mapIndexMap: {
          value: null,
          needsUpdate: false,
        },
        resolution: {
          value: new THREE.Vector2(),
          needsUpdate: false,
        },
        // lastPanelIndex: {
        //   value: 0,
        //   needsUpdate: false,
        // },
        newPanelIndex: {
          value: 0,
          needsUpdate: false,
        },
      },
      vertexShader: `\
        varying vec2 vUv;

        void main() {
          // project the point normally
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          
          float w = gl_Position.w;
          gl_Position /= w;

          // compute uv from position
          vec2 uv = vec2(
            (gl_Position.x + 1.0) / 2.0,
            (gl_Position.y + 1.0) / 2.0
          );

          gl_Position *= w;

          vUv = uv;
        }
      `,
      fragmentShader: `\
        uniform sampler2D mapIndexMap;
        // uniform float lastPanelIndex;
        uniform vec2 resolution;
        uniform float newPanelIndex;
        uniform int mode;
        varying vec2 vUv;

        void main() {
          vec4 oldMapIndexSample = texture2D(mapIndexMap, vUv);
          float oldMapIndex = oldMapIndexSample.r * 255.0;
          float oldDepth = oldMapIndex / 255.0;

          if (mode == ${MapIndexRenderer.MODE_KEEP}) { // keep mode
            // get the uv distance to the nearest edge
            vec2 uvDistance;
            uvDistance.x = min(vUv.x, 1.0 - vUv.x);
            uvDistance.y = min(vUv.y, 1.0 - vUv.y);

            vec2 pixelUvSize = 1.0 / resolution;

            float panelIndexDelta = newPanelIndex - oldMapIndex;
            if (
              (
                oldMapIndex == 0. || panelIndexDelta <= 2.
              ) &&
              (
                uvDistance.x > pixelUvSize.x &&
                uvDistance.y > pixelUvSize.y
              )
            ) { // keepable value
              gl_FragColor = vec4(0., 0., 0., 1.);
            } else { // non-keepable value
              gl_FragColor = vec4(1., 0., 0., 1.);
            }
          } else if (mode == ${MapIndexRenderer.MODE_REPLACE}) { // replace mode
            float newMapIndex = newPanelIndex / 255.0;
            float newDepth = newMapIndex;
            gl_FragColor = vec4(newMapIndex, newDepth, 0.0, 1.);
          } else {
            gl_FragColor = vec4(0., 0., 0., 1.);
          }
        }
      `,
      // depthFunc: THREE.GreaterEqualDepth,
      depthTest: false,
      depthWrite: false,
      side: THREE.BackSide,
      // extensions: {
      //   fragDepth: true,
      // },
    });
  }
}
class MapIndexRenderer {
  static MODE_KEEP = 0;
  static MODE_REPLACE = 1;
  constructor() {
    // canvas
    const width = floorNetPixelSize;
    const height = floorNetPixelSize;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    // renderer
    this.renderer = makeRenderer(canvas);
    this.renderer.autoClear = false;

    // camera
    this.camera = makeMapIndexCamera();

    // render target
    const _makeRenderTarget = () => {
      return new THREE.WebGLRenderTarget(
        width,
        height,
        {
          type: THREE.UnsignedByteType,
          format: THREE.RGBAFormat,
          // stencilBuffer: false,
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
        }
      );
    };
    this.renderTargets = [
      _makeRenderTarget(), // read
      _makeRenderTarget(), // write
    ];
    // // clear depth
    // {
    //   this.renderer.state.buffers.depth.setClear(0);
    //   for (let i = 0; i < this.renderTargets.length; i++) {
    //     const renderTarget = this.renderTargets[i];
    //     this.renderer.setRenderTarget(renderTarget);
    //     this.renderer.clear();
    //     this.renderer.setRenderTarget(null);
    //   }
    //   this.renderer.state.buffers.depth.setClear(1);
    // }

    // draw scene
    this.drawScene = new THREE.Scene();
    this.drawScene.autoUpdate = false;
    const drawOverrideMaterial = new MapIndexMaterial();
    this.drawOverrideMaterial = drawOverrideMaterial;
    this.drawScene.overrideMaterial = drawOverrideMaterial;

    // intersect scene
    this.intersectScene = new THREE.Scene();
    this.intersectScene.autoUpdate = false;
    const intersectOverrideMaterial = new MapIndexMaterial();
    this.intersectOverrideMaterial = intersectOverrideMaterial;
    this.intersectScene.overrideMaterial = intersectOverrideMaterial;
  
    // check scene
    this.checkScene = new THREE.Scene();
    this.checkScene.autoUpdate = false;
    // check mesh
    const checkMesh = (() => {
      // full screen quad pane
      const planeGeometry = new THREE.PlaneGeometry(2, 2);
      const instanceCount = width * height;
      // const geometry = new THREE.InstancedBufferGeometry()
      //   .copy(planeGeometry);
      // geometry.instanceCount = instanceCount;
      const geometry = planeGeometry;
      // add instanced uvs
      const uvs = new Float32Array(instanceCount * 2);
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          const i = dy * width + dx;
          const u = (dx + 0.5) / width;
          const v = (dy + 0.5) / height;
          uvs[i * 2 + 0] = u;
          uvs[i * 2 + 1] = v;
        }
      }
      geometry.setAttribute('uv', new THREE.InstancedBufferAttribute(uvs, 2));

      const material = new THREE.ShaderMaterial({
        uniforms: {
          map: {
            value: null,
            needsUpdate: false,
          },
        },
        vertexShader: `\
          uniform sampler2D map;
  
          void main() {
            vec4 value = texture2D(map, uv);
            if (value.r > 0.) {
              gl_Position = vec4(position.xy, 0., 1.0);
            } else {
              gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            }
          }
        `,
        fragmentShader: `\  
          void main() {
            gl_FragColor = vec4(1., 0., 0., 1.);
          }
        `,
      });

      const mesh = new THREE.InstancedMesh(geometry, material, instanceCount);
      mesh.frustumCulled = false;
      return mesh;
    })();
    this.checkScene.add(checkMesh);
    this.checkScene.checkMesh = checkMesh;
    checkMesh.updateMatrixWorld();

    // check render target
    this.checkRenderTarget = new THREE.WebGLRenderTarget(
      1, 1,
      {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      }
    );
    this.checkResultUint8Array = new Uint8Array(
      this.checkRenderTarget.width * this.checkRenderTarget.height * 4
    );
  }
  #swapRenderTargets() {
    const temp = this.renderTargets[0];
    this.renderTargets[0] = this.renderTargets[1];
    this.renderTargets[1] = temp;
  }
  draw(panelSpec, mode, attachPanelIndex, newPanelIndex) {
    const meshes = [panelSpec];

    console.log('draw panel spec', {
      attachPanelIndex,
      newPanelIndex,
    });

    // push
    const popMeshes = pushMeshes(this.drawScene, meshes);

    // render
    {
      // uniforms
      this.drawOverrideMaterial.uniforms.mode.value = mode;
      this.drawOverrideMaterial.uniforms.mode.needsUpdate = true;

      // this.drawOverrideMaterial.uniforms.mapIndexMap.value = this.renderTargets[0].texture;
      // this.drawOverrideMaterial.uniforms.mapIndexMap.needsUpdate = true;

      // this.drawOverrideMaterial.uniforms.lastPanelIndex.value = attachPanelIndex;
      // this.drawOverrideMaterial.uniforms.lastPanelIndex.needsUpdate = true;

      this.drawOverrideMaterial.uniforms.resolution.value.set(floorNetPixelSize, floorNetPixelSize);
      this.drawOverrideMaterial.uniforms.resolution.needsUpdate = true;
      
      this.drawOverrideMaterial.uniforms.newPanelIndex.value = newPanelIndex;
      this.drawOverrideMaterial.uniforms.newPanelIndex.needsUpdate = true;

      // render to the intersect target
      this.renderer.setRenderTarget(this.renderTargets[0]);
      // note: no clear; drawing on top of existing map
      this.renderer.render(this.drawScene, this.camera);
      this.renderer.setRenderTarget(null);

      // swap render targets
      // this.#swapRenderTargets();
    }

    // pop
    popMeshes();
  }
  intersect(panelSpec, attachPanelIndex, newPanelIndex) {
    const meshes = [panelSpec];

    // push
    const popMeshes = pushMeshes(this.intersectScene, meshes);

    // compute intersect
    let intersect;
    {
      // const gl = this.renderer.getContext();

      // uniforms
      this.intersectOverrideMaterial.uniforms.mode.value = MapIndexRenderer.MODE_KEEP;
      this.intersectOverrideMaterial.uniforms.mode.needsUpdate = true;

      this.intersectOverrideMaterial.uniforms.mapIndexMap.value = this.renderTargets[0].texture;
      this.intersectOverrideMaterial.uniforms.mapIndexMap.needsUpdate = true;

      this.intersectOverrideMaterial.uniforms.resolution.value.set(floorNetPixelSize, floorNetPixelSize);
      this.intersectOverrideMaterial.uniforms.resolution.needsUpdate = true;

      // this.intersectOverrideMaterial.uniforms.lastPanelIndex.value = attachPanelIndex;
      // this.intersectOverrideMaterial.uniforms.lastPanelIndex.needsUpdate = true;

      this.intersectOverrideMaterial.uniforms.newPanelIndex.value = newPanelIndex;
      this.intersectOverrideMaterial.uniforms.newPanelIndex.needsUpdate = true;

      // render intersect scene
      this.renderer.setRenderTarget(this.renderTargets[1]);
      this.renderer.clear(); // clear previous result
      this.renderer.render(this.intersectScene, this.camera);
      this.renderer.setRenderTarget(null);
      
      // XXX read intermediate result for debugging
      let debugUint8Array;
      let debugUint8Array2;
      {
        debugUint8Array = new Uint8Array(
          this.renderTargets[1].width * this.renderTargets[1].height * 4
        );
        this.renderer.readRenderTargetPixels(
          this.renderTargets[1],
          0, 0,
          this.renderTargets[1].width, this.renderTargets[1].height,
          debugUint8Array
        );
        // get red only
        debugUint8Array2 = new Uint8Array(
          this.renderTargets[1].width * this.renderTargets[1].height
        );
        for (let i = 0; i < debugUint8Array2.length; i++) {
          debugUint8Array2[i] = debugUint8Array[i * 4];
        }
      }

      // set up check scene
      this.checkScene.checkMesh.material.uniforms.map.value = this.renderTargets[1].texture;
      this.checkScene.checkMesh.material.uniforms.map.needsUpdate = true;
      // render check scene
      this.renderer.setRenderTarget(this.checkRenderTarget);
      this.renderer.clear(); // clear previous result
      this.renderer.render(this.checkScene, this.camera);
      this.renderer.setRenderTarget(null);
      // read the check result
      this.renderer.readRenderTargetPixels(
        this.checkRenderTarget,
        0, 0,
        this.checkRenderTarget.width, this.checkRenderTarget.height,
        this.checkResultUint8Array
      );
      intersect = this.checkResultUint8Array[0] > 0;

      // // XXX debug logging
      // console.log('check intermediate result', debugUint8Array2.filter(n => n !== 0).length, intersect, {
      //   attachPanelIndex,
      //   newPanelIndex,
      //   debugUint8Array2,
      // });
    }

    popMeshes();

    return intersect;
  }
  getMapIndex() {
    // read back image data
    const readRenderTarget = this.renderTargets[0];
    const uint8Array = new Uint8Array(
      readRenderTarget.width * readRenderTarget.height * 4
    );
    const {
      width,
      height,
    } = readRenderTarget;
    this.renderer.readRenderTargetPixels(
      readRenderTarget,
      0, 0,
      width, height,
      uint8Array
    );

    // latch rendered map index data
    // note: flip in the x direction,
    // since we render from the bottom but we want the image right side up when sampling from the top
    let mapIndex = new Uint8Array(uint8Array.length / 4);
    for (let i = 0; i < uint8Array.length; i += 4) {
      mapIndex[i / 4] = uint8Array[i]; // r
    }
    mapIndex = flipUint8ArrayX(mapIndex, width, height);

    return mapIndex;
  }
  getMapIndexResolution() {
    const readRenderTarget = this.renderTargets[0];
    const {
      width,
      height,
    } = readRenderTarget;
    return [
      width,
      height,
    ];
  }
}

//

class MetazineLoader {
  constructor({
    total = 1,
  } = {}) {
    this.total = total;

    this.semaphoreValue = defaultMaxWorkers;
    this.queue = [];
  }
  async loadFile(zineFile, index) {
    if (this.semaphoreValue > 0) {
      this.semaphoreValue--;
      try {
        const result = await this.#loadZineFileAsync(zineFile, index);
        return result;
      } finally {
        this.semaphoreValue++;
        if (this.queue.length > 0) {
          const {zineFile, index, accept, reject} = this.queue.shift();
          this.loadFile(zineFile, index)
            .then(accept, reject);
        }
      }
    } else {
      const result = await new Promise((accept, reject) => {
        this.queue.push({
          zineFile,
          index,
          accept,
          reject,
        });
      });
      return result;
    }
  }
  async #loadZineFileAsync(zineFile, index) {
    const fileName = zineFile.name;
    console.log(`loading [${index + 1}/${this.total}] ${fileName}...`);

    // load zine file data
    const zinefileArrayBuffer = await zineFile.arrayBuffer();
    const zinefileUint8Array = new Uint8Array(zinefileArrayBuffer, zineMagicBytes.length);

    // load storyboard
    const storyboard = new ZineStoryboard();
    await storyboard.loadAsync(zinefileUint8Array, {
      decompressKeys: [
        'depthField',
      ],
    });

    // instantiate panel specs
    const panels = storyboard.getPanels();
    const loadPanel = panel => {
      // latch data
      const layer0 = panel.getLayer(0);
      const imageArrayBuffer = layer0.getData(mainImageKey);
      const layer1 = panel.getLayer(1);
      const positionArray = layer1.getData('position');
      const quaternionArray = layer1.getData('quaternion');
      const scaleArray = layer1.getData('scale');
      const resolution = layer1.getData('resolution');
      const [
        width,
        height,
      ] = resolution;
      const cameraJson = layer1.getData('cameraJson');
      const camera = setPerspectiveCameraFromJson(new THREE.PerspectiveCamera(), cameraJson);
      const boundingBox = layer1.getData('boundingBox');
      const floorBoundingBox = layer1.getData('floorBoundingBox');
      const depthFieldArrayBuffer = layer1.getData('depthField');
      const entranceExitLocations = layer1.getData('entranceExitLocations');
      const floorPlaneLocation = layer1.getData('floorPlaneLocation');

      // mesh
      const panelSpec = new THREE.Object3D();
      panelSpec.name = fileName;
      panelSpec.imageArrayBuffer = imageArrayBuffer;
      panelSpec.resolution = resolution;
      panelSpec.boundingBox = boundingBox;
      panelSpec.floorBoundingBox = floorBoundingBox;
      // panelSpec.depthField = depthFieldArrayBuffer;
      panelSpec.entranceExitLocations = entranceExitLocations;
      panelSpec.floorPlaneLocation = floorPlaneLocation;
      
      // transform scene
      const transformScene = new THREE.Object3D();
      transformScene.position.fromArray(positionArray);
      transformScene.quaternion.fromArray(quaternionArray);
      transformScene.scale.fromArray(scaleArray);
      panelSpec.add(transformScene);
      panelSpec.transformScene = transformScene;
      transformScene.updateMatrixWorld();

      // scene chunk mesh
      let pointCloudArrayBuffer;
      {
        const pointCloudFloat32Array = reconstructPointCloudFromDepthField(
          depthFieldArrayBuffer,
          width,
          height,
          camera.fov,
        );
        pointCloudArrayBuffer = pointCloudFloat32Array.buffer;
      }
      const geometry = pointCloudArrayBufferToGeometry(
        pointCloudArrayBuffer,
        width,
        height,
        panelSpecGeometrySize,
        panelSpecGeometrySize,
      );
      geometry.computeVertexNormals();
      // index material for index map drawing;
      // screen rendering uses batching using this geometry and a different material
      const sceneChunkMesh = new THREE.Mesh(geometry, fakeMaterial);
      sceneChunkMesh.frustumCulled = false;
      transformScene.add(sceneChunkMesh);
      sceneChunkMesh.updateMatrixWorld();
      panelSpec.sceneChunkMesh = sceneChunkMesh;

      return panelSpec;
    };
    const panelSpecs = panels.map(panel => loadPanel(panel));
    return panelSpecs;
  }
}

//

const connect = (() => {
  const localVector = new THREE.Vector3();
  const localVector2 = new THREE.Vector3();
  const localQuaternion = new THREE.Quaternion();
  return ({
    exitLocation, // targetZineRenderer.metadata.entranceExitLocations[entranceIndex];
    entranceLocation, // this.metadata.entranceExitLocations[exitIndex];
    exitParentMatrixWorld, // this.transformScene.matrixWorld
    entranceParentMatrixWorld, // targetZineRenderer.transformScene.matrixWorld
    target, // targetZineRenderer.scene
  }) => {
    const exitMatrixWorld = new THREE.Matrix4().compose(
      localVector.fromArray(exitLocation.position),
      localQuaternion.fromArray(exitLocation.quaternion),
      oneVector
    )
      .premultiply(exitParentMatrixWorld)
      .decompose(
        localVector,
        localQuaternion,
        localVector2
      ).compose(
        localVector,
        localQuaternion,
        oneVector
      );

    const entranceMatrixWorld = new THREE.Matrix4().compose(
      localVector.fromArray(entranceLocation.position),
      localQuaternion.fromArray(entranceLocation.quaternion)
        .multiply(y180Quaternion),
      oneVector
    )
      .premultiply(entranceParentMatrixWorld)
      .decompose(
        localVector,
        localQuaternion,
        localVector2
      ).compose(
        localVector,
        localQuaternion,
        oneVector
      );
    const entranceMatrixWorldInverse = entranceMatrixWorld.clone().invert();

    // const matrixWorld = exitMatrixWorld;
    const matrixWorld = entranceMatrixWorldInverse.clone()
      .premultiply(exitMatrixWorld);

    // target.matrixWorld.copy(matrixWorld);
    target.matrix.copy(matrixWorld)
      .decompose(
        target.position,
        target.quaternion,
        target.scale
      );
    target.updateMatrixWorld();
    console.log('target parent', target.parent);


    /* // const exitLocation = this.metadata.entranceExitLocations[exitIndex];
    const exitMatrix = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(exitLocation.position),
      new THREE.Quaternion().fromArray(exitLocation.quaternion),
      oneVector
    );
    const exitMatrixWorld = exitMatrix.clone()
      .premultiply(exitParentMatrixWorld);
    exitMatrixWorld.decompose(
      localVector,
      localQuaternion,
      localVector2
    );
    exitMatrixWorld.compose(
      localVector,
      localQuaternion,
      oneVector
    );

    // const entranceLocation = targetZineRenderer.metadata.entranceExitLocations[entranceIndex];
    const entranceMatrix = new THREE.Matrix4().compose(
      localVector.fromArray(entranceLocation.position),
      localQuaternion.fromArray(entranceLocation.quaternion),
      oneVector
    );
    const entranceMatrixWorld = entranceMatrix.clone()
      .premultiply(entranceParentMatrixWorld);
    entranceMatrixWorld.decompose(
        localVector,
        localQuaternion,
        localVector2
      );
    entranceMatrixWorld.compose(
      localVector,
      localQuaternion,
      oneVector
    );
    const entranceMatrixWorldInverse = entranceMatrixWorld.clone()
      .invert();

    // undo the target entrance transform
    // then, apply the exit transform
    const transformMatrix = new THREE.Matrix4()
      .copy(entranceMatrixWorldInverse)
      .premultiply(y180Matrix)
      .premultiply(exitMatrixWorld)
    target.matrix
      .premultiply(transformMatrix)
      .decompose(
        target.position,
        target.quaternion,
        target.scale
      );
    target.updateMatrixWorld(); */
  }
})();
export class Metazine extends EventTarget {
  constructor() {
    super();
    
    // this.zd = new ZineData();
    
    // load result
    this.renderPanelSpecs = [];
    this.mapIndex = null;
    this.mapIndexResolution = null;
  }

  getPanels() {
    return this.panels;
  }
  
  clear() {
    this.zs.clear();
  }
  async compileZineFiles(zineFiles) {
    console.time('loadPanels');
    let panelSpecs;
    {
      const metazineLoader = new MetazineLoader({
        total: zineFiles.length,
      });

      const panelSpecsArray = await Promise.all(
        zineFiles.map((zineFile, index) =>
          metazineLoader.loadFile(zineFile, index)
        )
      );
      panelSpecs = panelSpecsArray.flat();
    }
    console.timeEnd('loadPanels');

    const rng = alea('lol');
    const probabalisticIndexRng = (weights) => {
      let weightSum = 0;
      for (let i = 0; i < weights.length; i++) {
        weightSum += weights[i];
      }
      const randomValue = rng() * weightSum;
      let weightSum2 = 0;
      for (let i = 0; i < weights.length; i++) {
        weightSum2 += weights[i];
        if (randomValue < weightSum2) {
          return i;
        }
      }
      return weights.length - 1;
    };

    // randomly choose a panel spec index that satisfies a condition
    const getConditionPanelSpecIndex = (panelSpecs, condition, maxTries = 100) => {
      for (let i = 0; i < maxTries; i++) {
        const panelSpecIndex = Math.floor(rng() * panelSpecs.length);
        const panelSpec = panelSpecs[panelSpecIndex];
        if (condition(panelSpec)) {
          return panelSpecIndex;
        }
      }
      console.warn('failed to find panel spec', panelSpecs, condition);
      return -1;
    };

    // get the render panel specs
    this.renderPanelSpecs = [];
    // first panel
    const candidateEntrancePanelSpecs = panelSpecs.slice();
    const firstPanelSpecIndex = getConditionPanelSpecIndex(
      candidateEntrancePanelSpecs,
      panelSpec => panelSpec.entranceExitLocations.length >= 2
    );
    const firstPanelSpec = candidateEntrancePanelSpecs.splice(firstPanelSpecIndex, 1)[0];
    firstPanelSpec.quaternion.fromArray(firstPanelSpec.floorPlaneLocation.quaternion)
      .invert(); // level the floor
    firstPanelSpec.updateMatrixWorld();
    this.renderPanelSpecs.push(firstPanelSpec);
    const candidateExitSpecs = firstPanelSpec.entranceExitLocations.map(eel => {
      return {
        panelSpec: firstPanelSpec,
        entranceExitLocation: eel,
      };
    });


    // map index renderer
    const mapIndexRenderer = new MapIndexRenderer();
    // draw first panel
    {
      const attachPanelIndex = 0;
      const newPanelIndex = 1;
      mapIndexRenderer.draw(
        firstPanelSpec,
        MapIndexRenderer.MODE_REPLACE,
        attachPanelIndex,
        newPanelIndex
      );
    }

    const maxNumPanels = 32; // XXX extend this
    let numIntersects = 0;
    const maxNumIntersects = 100;
    while(
      this.renderPanelSpecs.length < maxNumPanels &&
      candidateExitSpecs.length > 0 &&
      candidateEntrancePanelSpecs.length > 0
    ) {
      // exit location
      const outerExitSpecs = candidateExitSpecs.map(exitSpec => {
        const {panelSpec, entranceExitLocation} = exitSpec;
        localMatrix.compose(
          localVector.fromArray(entranceExitLocation.position),
          localQuaternion.fromArray(entranceExitLocation.quaternion),
          oneVector
        ).premultiply(panelSpec.transformScene.matrixWorld)
        .decompose(
          localVector,
          localQuaternion,
          localVector2
        );
        const outerExitSpec = [
          localVector.x,
          localVector.z,
        ];
        outerExitSpec.exitSpec = exitSpec;
        return outerExitSpec;
      });
      const outerExitSpecsConcave = concaveman(outerExitSpecs, 3)
        .map(o => o.exitSpec);
      // XXX sort probability by inverse distance
      // const outerExitSpecIndex = Math.floor(rng() * outerExitSpecsConcave.length);
      const outerExitSpecsConcaveDistances = outerExitSpecsConcave.map(exitSpec => {
        const {panelSpec, entranceExitLocation} = exitSpec;
        new THREE.Matrix4()
          .compose(
            localVector.fromArray(entranceExitLocation.position),
            localQuaternion.fromArray(entranceExitLocation.quaternion),
            oneVector
          )
          .premultiply(panelSpec.transformScene.matrixWorld)
          .decompose(
            localVector,
            localQuaternion,
            localVector2
          );
        const l = localVector.length();
        if (l !== 0) {
          return 1 / l;
        } else {
          return 0;
        }
      });
      const outerExitSpecIndex = probabalisticIndexRng(outerExitSpecsConcaveDistances);
      const exitSpec = outerExitSpecsConcave[outerExitSpecIndex];
      const {
        panelSpec: exitPanelSpec,
        entranceExitLocation: exitLocation,
      } = exitSpec;
      const exitSpecIndex = candidateExitSpecs.indexOf(exitSpec);

      // entrance location
      const entrancePanelSpecIndex = getConditionPanelSpecIndex(
        candidateEntrancePanelSpecs,
        panelSpec => panelSpec.entranceExitLocations.length >= 2
      );
      const entrancePanelSpec = candidateEntrancePanelSpecs[entrancePanelSpecIndex];
      const candidateEntranceLocations = entrancePanelSpec.entranceExitLocations.slice();
      // choose the location which has the closest angle to the exit location
      const exitDirection = localVector.set(0, 0, -1)
        .applyQuaternion(y180Quaternion)
        .applyQuaternion(localQuaternion.fromArray(exitLocation.quaternion))
      candidateEntranceLocations.sort((a, b) => {
        const aDirection = localVector2.set(0, 0, -1)
          .applyQuaternion(localQuaternion.fromArray(a.quaternion));
        let aDotExitDirection = aDirection.dot(exitDirection);
        // aDotExitDirection = Math.abs(aDotExitDirection); // treat forward/backward the same

        const bDirection = localVector3.set(0, 0, -1)
          .applyQuaternion(localQuaternion.fromArray(b.quaternion));
        let bDotExitDirection = bDirection.dot(exitDirection);
        // bDotExitDirection = Math.abs(bDotExitDirection); // treat forward/backward the same
        
        return bDotExitDirection - aDotExitDirection; // sort by largest dot product
      });
      const entranceLocationIndex = 0;
      const entranceLocation = candidateEntranceLocations[entranceLocationIndex];

      // latch fixed exit location
      const exitParentMatrixWorld = exitPanelSpec.transformScene.matrixWorld;

      // reset entrance transform
      entrancePanelSpec.position.setScalar(0);
      entrancePanelSpec.quaternion.identity();
      entrancePanelSpec.scale.setScalar(1);
      entrancePanelSpec.updateMatrixWorld();
      // latch new entrance location
      const entranceParentMatrixWorld = entrancePanelSpec.transformScene.matrixWorld;

      // latch entrance panel spec as the transform target
      const target = entrancePanelSpec;

      connect({
        exitLocation,
        entranceLocation,
        exitParentMatrixWorld,
        entranceParentMatrixWorld,
        target,
      });
      const attachPanelIndex = this.renderPanelSpecs.length;
      const newPanelIndex = attachPanelIndex + 1;
      let intersect;
      {
        intersect = mapIndexRenderer.intersect(
          entrancePanelSpec,
          attachPanelIndex,
          newPanelIndex
        );
      }

      if (intersect) {
        console.log('intersect');
      } else {
        console.log('no intersect');
      }

      intersect = false; // XXX hack
      if (intersect) {
        if (++numIntersects < maxNumIntersects) {
          console.log('intersect', {
            intersect,
            attachPanelIndex,
            newPanelIndex,
          });
          continue;
        } else {
          console.warn('too many intersects');
          debugger;
        }
      } else {
        // draw the map index
        {
          mapIndexRenderer.draw(
            entrancePanelSpec,
            MapIndexRenderer.MODE_REPLACE,
            attachPanelIndex,
            newPanelIndex
          );
        }

        // log the new panel spec
        this.renderPanelSpecs.push(entrancePanelSpec);

        // splice exit spec from candidates
        candidateExitSpecs.splice(exitSpecIndex, 1);
        // splice entrance panel spec from candidates
        candidateEntrancePanelSpecs.splice(entrancePanelSpecIndex, 1);

        // splice the used entrance location from entrance panel spec's enter exit location candidates
        candidateEntranceLocations.splice(entranceLocationIndex, 1);
        // push the remaining unused entrances to candidate exit specs
        const newCandidateExitSpecs = candidateEntranceLocations.map(eel => {
          return {
            panelSpec: entrancePanelSpec,
            entranceExitLocation: eel,
          };
        });
        candidateExitSpecs.push(...newCandidateExitSpecs);
      }
    }
    
    this.mapIndex = mapIndexRenderer.getMapIndex();
    this.mapIndexResolution = mapIndexRenderer.getMapIndexResolution();
  }
}

//

const getIndex = (x, y, width, height) => y * width + x;
const getOutlinePoints = (depthFloat32Array, width, height, camera) => {
  const seenIndices = new Map();
  const queue = [
    [0, 0],
  ];
  seenIndices.set(
    getIndex(
      queue[0][0],
      queue[0][1],
      width,
      height
    ),
    true
  );
  const outlinePoints = [];
  while (queue.length > 0) {
    const [x, y] = queue.shift();
    
    // XXX debug check
    {
      const index = getIndex(x, y, width, height);
      const r = depthFloat32Array[index];
      if (r !== 0) {
        console.warn('found filled pixel in queue', x, y);
        debugger;
      }
    }

    let zSum = 0;
    let weightSum = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ax = x + dx;
        const ay = y + dy;
        if (ax >= 0 && ax < width && ay >= 0 && ay < height) { // if in bounds
          const index2 = getIndex(ax, ay, width, height);
          const r2 = depthFloat32Array[index2];
          if (r2 !== 0) { // filled
            const outlineDepth = depthFloat32Array[index2];
            const z = camera.position.y - outlineDepth;

            const d = Math.sqrt(dx*dx + dy*dy);
            const weight = 1 / (d*d + 1);

            zSum += z * weight;
            weightSum += weight;
          } else { // clear
            if (!seenIndices.has(index2)) {
              seenIndices.set(index2, true);
              queue.push([ax, ay]);
            }
          }
        }
      }
    }
    if (weightSum > 0) {
      const outlinePoint = [x, y];
      outlinePoint.z = zSum / weightSum;
      outlinePoints.push(outlinePoint);
    }
  }
  return outlinePoints;
};
// XXX debugging
const makePositionCubesMesh = (positions) => {
  // render an instanced cubes mesh to show the depth
  const positionCubesGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
  const positionCubesMaterial = new THREE.MeshPhongMaterial({
    // vertexColors: true,
    color: 0x0000FF,
  });
  const positionCubesMesh = new THREE.InstancedMesh(positionCubesGeometry, positionCubesMaterial, positions.length / 3);
  positionCubesMesh.name = 'positionCubesMesh';
  positionCubesMesh.frustumCulled = false;

  // set the matrices by projecting the depth from the perspective camera
  positionCubesMesh.count = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const target = localVector.fromArray(positions, i);
    localMatrix.makeTranslation(target.x, target.y, target.z);
    positionCubesMesh.setMatrixAt(i / 3, localMatrix);
    positionCubesMesh.count++;
  }
  positionCubesMesh.instanceMatrix.needsUpdate = true;
  return positionCubesMesh;
};
class ChunkEdgeMesh extends THREE.Object3D {
  constructor({
    panelSpec,
  }) {
    // camera
    const chunkEdgeCamera = makeFloorNetCamera();

    // compute camera spec
    const {floorBoundingBox} = panelSpec;
    const box3 = new THREE.Box3(
      new THREE.Vector3().fromArray(floorBoundingBox.min),
      new THREE.Vector3().fromArray(floorBoundingBox.max)
    );
    const center = box3.getCenter(new THREE.Vector3());
    const size = box3.getSize(new THREE.Vector3());
    // move to the camera plane
    center.y = chunkEdgeCamera.position.y;
    // find camera range; scan and snap outward
    
    // back left
    const centerBackLeft = center.clone()
      .add(new THREE.Vector3(-size.x / 2, 0, -size.z / 2))
      .add(new THREE.Vector3(-floorNetResolution, 0, -floorNetResolution)); // 1 px border
    // snap to grid
    centerBackLeft.x = Math.floor(centerBackLeft.x / floorNetResolution) * floorNetResolution;
    centerBackLeft.z = Math.floor(centerBackLeft.z / floorNetResolution) * floorNetResolution;
    
    // front right
    const centerFrontRight = center.clone()
      .add(new THREE.Vector3(size.x / 2, 0, size.z / 2))
      .add(new THREE.Vector3(floorNetResolution, 0, floorNetResolution)); // 1 px border
    // snap to grid
    centerFrontRight.x = Math.ceil(centerFrontRight.x / floorNetResolution) * floorNetResolution;
    centerFrontRight.z = Math.ceil(centerFrontRight.z / floorNetResolution) * floorNetResolution;
    
    // compute the new center
    center.copy(centerBackLeft)
      .add(centerFrontRight)
      .multiplyScalar(0.5);
    // compute the new size
    size.copy(centerFrontRight)
      .sub(centerBackLeft);

    // set the orthographic camera
    chunkEdgeCamera.position.copy(center);
    chunkEdgeCamera.updateMatrixWorld();
    chunkEdgeCamera.left = centerBackLeft.x - center.x;
    chunkEdgeCamera.right = centerFrontRight.x - center.x;
    chunkEdgeCamera.top = centerFrontRight.z - center.z;
    chunkEdgeCamera.bottom = centerBackLeft.z - center.z;
    chunkEdgeCamera.updateProjectionMatrix();

    // compute the pixel resolution to use
    const width = Math.floor(size.x / floorNetResolution);
    const height = Math.floor(size.z / floorNetResolution);

    // render the coverage map
    const panelSpecToMeshSpec = panelSpec => {
      const {resolution, sceneChunkMesh} = panelSpec;
      const {geometry, matrixWorld} = sceneChunkMesh;
      const [
        width,
        height,
      ] = resolution;
      const side = THREE.DoubleSide;
      return {
        geometry,
        matrixWorld,
        width,
        height,
        side,
      };
    };
    const meshSpecs = [
      panelSpec,
    ].map(panelSpec => panelSpecToMeshSpec(panelSpec));
    const meshes = getDepthRenderSpecsMeshes(meshSpecs, chunkEdgeCamera);
    const depthFloat32Array = renderMeshesDepth(meshes, width, height, chunkEdgeCamera);
    // const coverageCanvas = renderMeshesCoverage(meshes, width, height, chunkEdgeCamera);
    const coverageCanvas = depthFloats2Canvas(depthFloat32Array, width, height, chunkEdgeCamera);
    coverageCanvas.style.cssText = `\
      background: blue;
    `;
    document.body.appendChild(coverageCanvas);

    // get outline points
    const outlinePoints = getOutlinePoints(depthFloat32Array, width, height, chunkEdgeCamera);
    // console.log('got outline points', {
    //   depthFloat32Array,
    //   depthFloat32ArraySetSize: depthFloat32Array.filter(n => n !== 0),
    //   outlinePoints,
    // });

    // detect edges
    const edges = concaveman(outlinePoints, 5);
    // const edges = outlinePoints;

    // position cubes mesh
    const positions = new Float32Array(edges.length * 3);
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      const [x, y] = edge;
      const {z} = edge;

      const index = i * 3;
      positions[index + 0] = -x * floorNetResolution + centerFrontRight.x;
      positions[index + 1] = z;
      // positions[index + 1] = 0;
      positions[index + 2] = y * floorNetResolution + centerBackLeft.z;
    }
    const positionCubesMesh = makePositionCubesMesh(positions);

    super();

    this.add(positionCubesMesh);
    positionCubesMesh.updateMatrixWorld();
  }
}

//

export class MetazineRenderer extends EventTarget {
  constructor(canvas, metazine) {
    super();

    this.canvas = canvas;
    this.metazine = metazine;

    // canvas
    canvas.width = panelSize;
    canvas.height = panelSize;
    canvas.classList.add('metazineRendererCanvas');

    // renderer
    const renderer = makeRenderer(canvas);
    this.renderer = renderer;
    this.addEventListener('destroy', e => {
      this.renderer.dispose();
    });

    // scene
    const scene = new THREE.Scene();
    scene.autoUpdate = false;
    this.scene = scene;
    
    // camera
    const camera = makeDefaultCamera();
    this.camera = camera;

    // orbit controls
    const controls = new OrbitControls(this.camera, canvas);
    controls.minDistance = 1;
    controls.maxDistance = 100;
    controls.target.set(0, 0, -3);
    this.controls = controls;

    // mouse
    const mouse = new THREE.Vector2();
    this.mouse = mouse;

    // raycaster
    const raycaster = new THREE.Raycaster();
    this.raycaster = raycaster;

    // lights
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 2, 3);
    directionalLight.updateMatrixWorld();
    scene.add(directionalLight);

    // scene batched mesh
    const sceneBatchedMesh = new SceneBatchedMesh({
      panelSpecs: metazine.renderPanelSpecs,
    });
    scene.add(sceneBatchedMesh);
    sceneBatchedMesh.updateMatrixWorld();
    this.sceneBatchedMesh = sceneBatchedMesh;

    // bootstrap
    this.listen();
    this.animate();
    this.#initAux();
  }
  async #initAux() {
    // entrance exit locations
    const entranceExitLocations = [];
    for (let i = 0; i < this.metazine.renderPanelSpecs.length; i++) {
      const panelSpec = this.metazine.renderPanelSpecs[i];
      const localEntranceExitLocations = await panelSpec.entranceExitLocations.map(eel => {
        const position = localVector.fromArray(eel.position);
        const quaternion = localQuaternion.fromArray(eel.quaternion);
        const scale = localVector2.copy(oneVector);
        localMatrix.compose(
          position,
          quaternion,
          scale
        )
          .premultiply(panelSpec.matrixWorld)
          .decompose(position, quaternion, scale);
        return {
          position: position.toArray(),
          quaternion: quaternion.toArray(),
        };
      });
      entranceExitLocations.push(...localEntranceExitLocations);
    }

    // entrance exit mesh
    const entranceExitMesh = new EntranceExitMesh({
      entranceExitLocations,
    });
    entranceExitMesh.enabled = true;
    entranceExitMesh.updateVisibility();
    this.scene.add(entranceExitMesh);
    entranceExitMesh.updateMatrixWorld();

    // map index mesh
    const {
      mapIndex,
      mapIndexResolution,
    } = this.metazine;
    const mapIndexMesh = new MapIndexMesh({
      mapIndex,
      mapIndexResolution,
    });
    mapIndexMesh.position.y = -10;
    this.scene.add(mapIndexMesh);
    mapIndexMesh.updateMatrixWorld();

    // chunk edge mesh
    const firstRenderPanelSpec = this.metazine.renderPanelSpecs[0];
    const chunkEdgeMesh = new ChunkEdgeMesh({
      panelSpec: firstRenderPanelSpec,
    });
    this.scene.add(chunkEdgeMesh);
    chunkEdgeMesh.updateMatrixWorld();

    // XXX debug cube mesh
    const cubeMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshPhongMaterial({
        color: 0xff0000,
      })
    );
    // cubeMesh.position.set(0, 0, -3);
    this.scene.add(cubeMesh);
    cubeMesh.updateMatrixWorld();
  }
  listen() {
    const keydown = e => {
      if (!e.repeat && !e.ctrlKey) {
        switch (e.key) {
          case '1':
          case '2':
          case '3':
          case '4':
          case '5':
          case '6':
          case '7':
          case '8':
          case '9': {
            const keyIndex = parseInt(e.key, 10) - 1;
            this.setTool(tools[keyIndex] ?? tools[0]);
            break;
          }
          case ' ': {
            break;
          }
        }
      }
    };
    document.addEventListener('keydown', keydown);

    const mousedown = e => {
      // this.selector.setMouseDown(true);
    };
    const mouseup = e => {
      // this.selector.setMouseDown(false);
    };
    const mousemove = e => {
      // set the THREE.js.Raycaster from the mouse event
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      this.mouse.set(
        (x / rect.width) * 2 - 1,
        -(y / rect.height) * 2 + 1
      );
      this.raycaster.setFromCamera(this.mouse, this.camera);
    };

    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown', mousedown);
    document.addEventListener('mouseup', mouseup);
    canvas.addEventListener('mousemove', mousemove);
    canvas.addEventListener('click', blockEvent);
    canvas.addEventListener('wheel', blockEvent);

    // const update = e => {
    //   this.updateOutmeshLayers();
    // };
    // this.panel.zp.addEventListener('layeradd', update);
    // this.panel.zp.addEventListener('layerremove', update);
    // this.panel.zp.addEventListener('layerupdate', update);

    // const transformchange = e => {
    //   this.updateObjectTransforms();
    // };
    // this.zineRenderer.addEventListener('transformchange', transformchange);

    this.addEventListener('destroy', e => {
      document.removeEventListener('keydown', keydown);

      canvas.removeEventListener('mousedown', mousedown);
      document.removeEventListener('mouseup', mouseup);
      canvas.removeEventListener('mousemove', mousemove);
      canvas.removeEventListener('click', blockEvent);
      canvas.removeEventListener('wheel', blockEvent);

      // this.panel.zp.removeEventListener('layeradd', update);
      // this.panel.zp.removeEventListener('layerremove', update);
      // this.panel.zp.removeEventListener('layerupdate', update);

      // this.zineRenderer.removeEventListener('transformchange', transformchange);
    });
  }
  render() {
    // update tools
    this.controls.update();
    this.camera.updateMatrixWorld();

    // render
    this.renderer.render(this.scene, this.camera);
  }
  animate() {
    const _startLoop = () => {
      let frame;
      const _loop = () => {
        frame = requestAnimationFrame(_loop);

        this.render();
      };
      _loop();

      this.addEventListener('destroy', e => {
        cancelAnimationFrame(frame);
      });
    };
    _startLoop();
  }
  snapshotMap({
    width = 1024,
    height = 1024,
    // boundingBox = new THREE.Box3(
    //   new THREE.Vector3(-1, -1, -1),
    //   new THREE.Vector3(1, 1, 1)
    // ),
  } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const renderer = makeRenderer(canvas);

    const scene = new THREE.Scene();
    scene.autoClear = false;

    this.sceneBatchedMesh.geometry.computeBoundingBox();
    const {
      boundingBox,
    } = this.sceneBatchedMesh.geometry;
    const worldWidth = boundingBox.max.x - boundingBox.min.x;
    const worldHeight = boundingBox.max.z - boundingBox.min.z;
    const center = boundingBox.getCenter(new THREE.Vector3());
    // console.log('got bounding box', {
    //   worldWidth,
    //   worldHeight,
    // });

    const camera = makeFloorNetCamera();
    camera.position.x = center.x;
    camera.position.z = center.z;
    camera.updateMatrixWorld();
    camera.left = -worldWidth / 2;
    camera.right = worldWidth / 2;
    camera.top = worldHeight / 2;
    camera.bottom = -worldHeight / 2;
    camera.updateProjectionMatrix();

    // push meshes
    this.sceneBatchedMesh.material.side = THREE.BackSide;
    this.sceneBatchedMesh.material.needsUpdate = true;
    const popMeshes = pushMeshes(scene, [
      this.sceneBatchedMesh,
    ]);

    // render
    {
      renderer.render(scene, camera);
    }

    // pop meshes
    this.sceneBatchedMesh.material.side = THREE.FrontSide;
    this.sceneBatchedMesh.material.needsUpdate = true;
    popMeshes();

    // return
    return canvas;
  }
  destroy() {
    console.log('destroy MetasceneRenderer');
    this.dispatchEvent(new MessageEvent('destroy'));
  }
};

//

const Metazine3DCanvas = ({
  metazine,
}) => {
  const canvasRef = useRef();
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const renderer = new MetazineRenderer(canvas, metazine);

      const keydown = async e => {
        switch (e.key) {
          case 'm': {
            e.preventDefault();
            e.stopPropagation();

            const canvas = renderer.snapshotMap();
            canvas.style.cssText = `\
              background: red;
            `;
            document.body.appendChild(canvas);

            // collect edit image properties
            const blob = await new Promise((accept, reject) => {
              canvas.toBlob(blob => {
                accept(blob);
              });
            });
            const maskBlob = blob; // same as blob
            const prompt = 'map, top down aerial view, anime style';

            // edit the image
            console.log('edit map image started...');
            console.time('editMapImage');
            const editedImgBlob = await imageAiClient.editImgBlob(blob, maskBlob, prompt);
            console.timeEnd('editMapImage');

            const img = await blob2img(editedImgBlob);
            img.style.cssText = `\
              background: blue;
            `;
            document.body.appendChild(img);

            break;
          }
        }
      };
      window.addEventListener('keydown', keydown);

      return () => {
        renderer.destroy();
        window.removeEventListener('keydown', keydown);
      };
    }
  }, [metazine, canvasRef.current]);

  return (
    <canvas
      className={styles.canvas}
      width={panelSize}
      height={panelSize}
      ref={canvasRef}
    />
  );
};

//

const MetasceneGeneratorComponent = () => {
  const [metazine, setMetazine] = useState(() => new Metazine());
  const [loaded, setLoaded] = useState(false);

  const onNew = e => {
    e.preventDefault();
    e.stopPropagation();
    console.warn('new not implemented');
  };
  const dragover = e => {
    e.preventDefault();
    e.stopPropagation();
  };
  const drop = async e => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (files.length > 0) {
      initCompressor({
        numWorkers: defaultMaxWorkers,
      });

      await metazine.compileZineFiles(files);

      setLoaded(true);
    }
  };

  return (
    <div className={styles.metasceneGenerator}>
      {loaded ? (
        <Metazine3DCanvas
          width={panelSize}
          height={panelSize}
          metazine={metazine}
        />
      ) : (
        <DropTarget
          className={styles.panelPlaceholder}
          newLabel='Create New Board'
          onNew={onNew}
          onDragOver={dragover}
          onDrop={drop}
        />
      )}
    </div>
  );
};
export default MetasceneGeneratorComponent;