import {useState, useEffect, useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import alea from '../../utils/alea.js';
// import {
//   txt2img,
//   img2img,
// } from '../../clients/image-client.js';
import {
  txt2img,
  img2img,
} from '../../clients/sd-image-client.js';
import {mobUrls} from '../../constants/urls.js';
import {
  makeRenderer,
  makeGltfLoader,
  pushMeshes,
  makeDefaultCamera,
} from '../../utils/three-utils.js';
import {
  makePromise,
  loadImage,
} from '../../../utils.js';
import {
  createSeedImage,
} from '../../../canvas/seed-image.js';
import {
  colors,
} from '../../constants/detectron-colors.js';

import styles from '../../../styles/MobGenerator.module.css';
import {
  blob2img,
  canvas2blob,
  img2canvas,
} from '../../utils/convert-utils.js';

//

const generateTextureMaps = async img => {
  // if (!img) {
  //   debugger;
  //   img = await loadImage('/images/fluffy.png');
  // }
  const canvas = img2canvas(img);
  const blob = await canvas2blob(canvas);
  const [
    normalImage,
    roughnessImage,
    displacementImage,
  ] = await Promise.all([
    'n',
    'r',
    'd',
  ].map(async shortname => {
    const res = await fetch(`https://stable-diffusion.webaverse.com/material?mode=seamless&map=${shortname}`, {
      method: 'post',
      body: blob,
    });
    if (res.ok) {
      const img2Blob = await res.blob();
      const img2 = await blob2img(img2Blob);
      // console.log('got response', img2, URL.createObjectURL(img2Blob));
      document.body.appendChild(img2);
      return img2;
    } else {
      throw new Error('invalid status: ' + res.status);
    }
  }));
  return {
    normalImage,
    roughnessImage,
    displacementImage,
  };
};
globalThis.generateTextureMaps = generateTextureMaps;

//

const makeSeedCanvas = () => {
  const imgCanvas = createSeedImage(
    1024, // w
    1024, // h
    400, // rw
    400, // rh
    1.1, // p
    8192, // n
    'rectangle', // shape
  );
  // console.log('imgCanvas', imgCanvas);
  // document.body.appendChild(imgCanvas);
  return imgCanvas;
};

//

async function image2DataUrl(img, className = '') {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.classList.add(className);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  // debugging
  canvas.style.cssText = `\
    background: red;
  `;
  document.body.appendChild(canvas);

  // get the blob
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  // get the blob url
  // read the data url from the blob
  const dataUrl = await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result);
    reader.readAsDataURL(blob);
  });
  return dataUrl;
}

//

function makeNoiseCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  // // debugging
  // canvas.style.cssText = `\
  //   background: red;
  // `;
  // document.body.appendChild(canvas);
  
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const noise = alea('seed');
  for (let i = 0; i < data.length; i += 4) {
    const r = noise() * 255;
    const g = noise() * 255;
    const b = noise() * 255;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

//

const generateMob = async (canvas, prompt) => {
  const renderer = makeRenderer(canvas);

  const scene = new THREE.Scene();
  scene.autoUpdate = false;

  const camera = makeDefaultCamera();
  camera.position.set(0, 1, -4);
  camera.lookAt(new THREE.Vector3(0, 0, 0));
  camera.updateMatrixWorld();

  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(1, 2, 3);
  light.updateMatrixWorld();
  scene.add(light);

  const ambientLight = new THREE.AmbientLight(0xffffff, 1);
  scene.add(ambientLight);

  const controls = new OrbitControls(camera, canvas);
  controls.minDistance = 1;
  controls.maxDistance = 100;
  const targetDistance = -camera.position.z;
  controls.target.copy(camera.position)
    .addScaledVector(camera.getWorldDirection(new THREE.Vector3()), targetDistance);

  const mobs = new THREE.Object3D();
  (async () => {
    const gltfLoader = makeGltfLoader();
    const rng = alea('lol8');
    const mobUrl = mobUrls[Math.floor(rng() * mobUrls.length)];
    
    const p = makePromise();
    gltfLoader.load(mobUrl, gltf => {
      p.resolve(gltf);
    }, function onProgress(xhr) {
      // console.log('progress', xhr.loaded / xhr.total);
    }, p.reject);

    let model = await p;
    model = model.scene;
    mobs.add(model);
    model.updateMatrixWorld();

    // recompile the model
    const meshes = [];
    const materials = [];
    model.traverse(o => {
      if (o.isMesh) {
        meshes.push(o);
        materials.push(o.material);
      }
    });

    globalThis.model = model;
    globalThis.meshes = meshes;
    globalThis.materials = materials;

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      const material = materials[i];
      const {map} = material;
      const {image} = map;

      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.style.cssText = `\
        background: red;
      `;
      // document.body.appendChild(canvas);
      const renderer2 = makeRenderer(canvas);
      renderer2.autoClear = false;

      // constants
      // const backgroundColor = 0xFFFFFF;
      const backgroundColor = 0x000000;
      // const backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      const uColor = new THREE.Color(backgroundColor);

      // const backgroundColor2 = 0xFFFFFF;
      // const backgroundColor2 = 0x000000;
      // const backgroundColor2 = colors[Math.floor(Math.random() * colors.length)];
      const backgroundColor2 = backgroundColor;
      const uColor2 = new THREE.Color(backgroundColor2);

      // background scene
      const backgroundScene = new THREE.Scene();
      backgroundScene.autoUpdate = false;

      // background mesh
      // fullscreen geometry
      const backgroundGeometry = new THREE.PlaneBufferGeometry(2, 2)
      // const backgroundGeometry = new THREE.BoxBufferGeometry(1, 1, 1)
        // .translate(0, 0, 0.5);
      // fullscreen material
      const noiseCanvas = makeNoiseCanvas(image.width, image.height);
      // const noiseCanvas = makeSeedCanvas();
      const noiseMap = new THREE.Texture(noiseCanvas);
      noiseMap.needsUpdate = true;
      const backgroundMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uNoiseMap: {
            value: noiseMap,
            needsUpdate: true,
          },
          uAlpha: {
            value: 1,
            needsUpdate: true,
          },
          uColor: {
            value: uColor,
            needsUpdate: true,
          },
          uColor2: {
            value: uColor2,
            needsUpdate: true,
          },
        },
        vertexShader: `\
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0., 1.0);
          }
        `,
        fragmentShader: `\
          uniform sampler2D uNoiseMap;
          uniform vec3 uColor;
          uniform vec3 uColor2;
          uniform float uAlpha;
          varying vec2 vUv;

          void main() {
            vec4 color = texture2D(uNoiseMap, vUv);

            // gl_FragColor = color;
            // gl_FragColor.b += 0.1;
            // gl_FragColor.a = 1.;

            // gl_FragColor = vec4(color.rgb, uAlpha);

            // gl_FragColor = vec4(uColor * (0.5 + vUv.y * 0.5), uAlpha);
            gl_FragColor = vec4(mix(uColor, uColor2, vUv.y), uAlpha);
            // gl_FragColor = vec4(vUv, 0., uAlpha);

            // if (uAlpha == 1.) {
            //   gl_FragColor = vec4(color.rgb, uAlpha);
            // } else {
            //   // gl_FragColor = vec4(uColor * (0.7 + vUv.y * 0.3), uAlpha);
            // }
          }
        `,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        // blending: THREE.NoBlending,
      });
      const backgroundMesh = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
      backgroundMesh.frustumCulled = false;
      backgroundScene.add(backgroundMesh);

      const scene2 = new THREE.Scene();
      scene2.autoUpdate = false;
      const camera2 = makeDefaultCamera();

      const overrideMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uMap: {
            value: material.map,
            needsUpdate: true,
          },
          iResolution: {
            value: new THREE.Vector2(image.width, image.height),
            needsUpdate: true,
          },
          uAlpha: {
            value: 1,
            needsUpdate: true,
          },
          uColor: {
            value: uColor,
            needsUpdate: true,
          },
          uColor2: {
            value: uColor2,
            needsUpdate: true,
          },
          uHueShift: {
            value: Math.random() * 2 * Math.PI,
            needsUpdate: true,
          },
        },
        vertexShader: `\
          varying vec2 vUv;

          void main() {
            vUv = uv;
            // gl_Position = vec4(position, 1.0);
            vec2 duv = (uv - 0.5) * 2.;
            gl_Position = vec4(duv.x, duv.y, 0., 1.0);
          }
        `,
        fragmentShader: `\
          uniform sampler2D uMap;
          uniform float uAlpha;
          uniform vec3 uColor;
          uniform vec3 uColor2;
          uniform float uHueShift;
          varying vec2 vUv;

          // convert rgb to hsv in glsl
          vec3 rgb2hsv(vec3 c) {
            vec4 K = vec4(0., -1./3., 2./3., -1.);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

            float d = q.x - min(q.w, q.y);
            float e = 1.0e-10;
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
          }

          // convert hsv to rgb in glsl
          vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1., 2./3., 1./3., 3.);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
          }

          void main() {
            vec4 color = texture2D(uMap, vUv);

            vec3 hsv = rgb2hsv(color.rgb);
            hsv.x += uHueShift;
            // hsv.y += 0.25;
            // hsv.z += 0.1;
            color.rgb = hsv2rgb(hsv);

            // gl_FragColor = color;
            // gl_FragColor.b += 0.1;
            // gl_FragColor.a = 1.;

            gl_FragColor = vec4(color.rgb, uAlpha);
          }
        `,
        depthTest: false,
        depthWrite: false,
        // blending: THREE.NoBlending,
      });
      scene2.overrideMaterial = overrideMaterial;

      // push meshes
      // if (!model.parent) {
      //   debugger;
      // }
      const popMeshes = pushMeshes(scene2, meshes, {
        frustumCulled: false,
      });

      // render mask
      // const backgroundColor = 0x000000; // XXX in the future, we could get this from the corners of the image
      // const backgroundColor = 0xFFFFFF; // XXX in the future, we could get this from the corners of the image
      renderer2.setClearColor(backgroundColor, 0);
      backgroundMaterial.uniforms.uAlpha.value = 0;
      backgroundMaterial.uniforms.uAlpha.needsUpdate = true;
      overrideMaterial.uniforms.uAlpha.value = 0.03;
      overrideMaterial.uniforms.uAlpha.needsUpdate = true;
      // renderer2.clear();
      renderer2.render(backgroundScene, camera2);
      renderer2.render(scene2, camera2);
      // latch mask
      // const maskImgCanvas = img2canvas(renderer.domElement);
      const maskImgDataUrlPromise = image2DataUrl(renderer2.domElement, 'mask');

      // render opaque
      renderer2.setClearColor(backgroundColor, 1);
      // const alpha2 = 1;
      backgroundMaterial.uniforms.uAlpha.value = 0.5;
      backgroundMaterial.uniforms.uAlpha.needsUpdate = true;
      overrideMaterial.uniforms.uAlpha.value = 0.5;
      overrideMaterial.uniforms.uAlpha.needsUpdate = true;
      // renderer2.clear();
      renderer2.render(backgroundScene, camera2);
      renderer2.render(scene2, camera2);
      // latch opaque
      // const opaqueImgCanvas = img2canvas(renderer.domElement);
      const opaqueImgDataUrlPromise = image2DataUrl(renderer2.domElement, 'opaque');

      // pop meshes
      popMeshes();

      const [
        maskImgDataUrl,
        opaqueImgDataUrl,
      ] = await Promise.all([
        maskImgDataUrlPromise,
        opaqueImgDataUrlPromise,
      ]);

      // const blob = await canvas2blob(opaqueImgCanvas);
      // const maskBlob = await canvas2blob(maskImgCanvas);
      
      const editImg = await img2img({
        prompt,
        width: image.width,
        height: image.height,
        imageDataUrl: opaqueImgDataUrl,
        // imageDataUrl: maskImgDataUrl,
        maskImageDataUrl: maskImgDataUrl,
      });
      // const editImg = await img2img({
      //   prompt,
      //   blob,
      //   maskBlob,
      // });
      console.log('edit image', editImg);

      {
        const {
          normalImage,
          roughnessImage,
          displacementImage,
        } = await generateTextureMaps(editImg);

        // material.dispose();

        const geometry2 = mesh.geometry;
        // geometry2.computeVertexNormals();

        const material2 = new THREE.MeshStandardMaterial({
          color: 0xFFFFFF,
          // transparent: true,
          // alphaTest: 0.9,
        });
        // material2.name = 'ai-textured-' + material.name;
        
        material2.map = new THREE.Texture(editImg);
        material2.map.flipY = true;
        // material2.map.encoding = THREE.sRGBEncoding;
        material2.map.needsUpdate = true;

        // material2.map = new THREE.DataTexture(
        //   Uint8Array.from([255, 255, 255, 255]),
        //   1,
        //   1,
        //   THREE.RGBAFormat,
        //   THREE.UnsignedByteType,
        // );
        // material2.map.needsUpdate = true;

        material2.normalMap = new THREE.Texture(normalImage);
        // material2.normalMap.flipY = true;
        // material2.normalMap.encoding = THREE.sRGBEncoding;
        // material2.normalMapType = THREE.ObjectSpaceNormalMap;
        material2.normalMap.needsUpdate = true;

        material2.roughnessMap = new THREE.Texture(roughnessImage);
        // material2.roughnessMap.flipY = true;
        // material2.roughnessMap.encoding = THREE.sRGBEncoding;
        material2.roughnessMap.needsUpdate = true;
        material2.roughness = 1;

        material2.bumpMap = new THREE.Texture(displacementImage);
        material2.bumpMap.flipY = true;
        // material2.metalnessMap.encoding = THREE.sRGBEncoding;
        material2.bumpMap.needsUpdate = true;
        // material2.metalness = 0;
        // material2.metalnessMap = null;
        
        // material2.emissiveMap = null;

        // material2.transparent = true;

        material2.needsUpdate = true;
        
        console.log('edited img', {
          material,
          normalImage,
          roughnessImage,
          displacementImage,
        });

        const parent = mesh.parent;
        parent.remove(mesh);
        const mesh2 = new THREE.Mesh(geometry2, material2);
        // mesh2.skeleton = mesh.skeleton;
        // console.log('got model', mesh, mesh2);
        mesh2.frustumCulled = false;
        parent.add(mesh2);
      }
    }
  })();
  scene.add(mobs);

  // start render loop
  const _render = () => {
    requestAnimationFrame(_render);
    renderer.render(scene, camera);
  };
  _render();
};

const defaultPrompt = 'diffuse texture, Unreal Engine anime video game, JRPG monster creature';
const MobGeneratorComponent = () => {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [generated, setGenerated] = useState(false);
  const [imageAiModel, setImageAiModel] = useState('sd');
  const canvasRef = useRef();
  
  const size = 1024;

  const generateClick = async prompt => {
    const canvas = canvasRef.current;
    if (canvas && !generated) {
      setGenerated(true);
      await generateMob(canvas, prompt);
    }
  };

  return (
    <div className={styles.mobGenerator}>
      <input type="text" className={styles.input} value={prompt} onChange={e => {
        setPrompt(e.target.value);
      }} placeholder={prompt} />
      <select className={styles.select} value={imageAiModel} onChange={e => {
        setImageAiModel(e.target.value);
      }}>
        <option value="sd">SD</option>
        <option value="openai">OpenAI</option>
      </select>
      <div className={styles.button} onClick={async () => {
        await generateClick(prompt);
      }}>Generate</div>
      <canvas className={styles.canvas} width={size} height={size} ref={canvasRef} />
    </div>
  );
};
export default MobGeneratorComponent;