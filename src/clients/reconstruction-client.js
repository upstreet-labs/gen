import * as THREE from 'three';
import materialColors from '../constants/material-colors.js';

//

export const skyboxDistance = 5;
export const skyboxScaleFactor = 5;
export const pointcloudStride = 4 + 4 + 4 + 1 + 1 + 1;

//

const localVector = new THREE.Vector3();

//

export function drawPointCloudCanvas(arrayBuffer) {
  // python_types = (float, float, float, int, int, int)
  // npy_types = [('x', 'f4'), ('y', 'f4'), ('z', 'f4'), ('red', 'u1'), ('green', 'u1'), ('blue', 'u1')]
  const numPixels = arrayBuffer.byteLength / pointcloudStride;
  const width = Math.sqrt(numPixels);
  const height = width;
  if (width * height !== numPixels) {
    throw new Error('invalid point cloud dimensions');
  }
  // we want to parse the following ndarray into the canvas pixels
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const dataView = new DataView(arrayBuffer);
  for (let i = 0, j = 0; i < arrayBuffer.byteLength; i += pointcloudStride, j += 4) {
    const x = dataView.getFloat32(i + 0, true);
    const y = dataView.getFloat32(i + 4, true);
    const z = dataView.getFloat32(i + 8, true);
    const red = dataView.getUint8(i + 12);
    const green = dataView.getUint8(i + 13);
    const blue = dataView.getUint8(i + 14);

    const v = z/100;
    imageData.data[j + 0] = v;
    imageData.data[j + 1] = v;
    imageData.data[j + 2] = v;
    imageData.data[j + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}
export function pointCloudArrayBufferToPositionAttributeArray(arrayBuffer, float32Array, scaleFactor) { // result in float32Array
  const numPixels = arrayBuffer.byteLength / pointcloudStride;
  const width = Math.sqrt(numPixels);
  const height = width;
  // if (width * height !== numPixels) {
  //   throw new Error('invalid point cloud dimensions');
  // }
  const dataView = new DataView(arrayBuffer);
  for (let i = 0, j = 0; i < arrayBuffer.byteLength; i += pointcloudStride, j += 3) {
    let x = dataView.getFloat32(i + 0, true);
    let y = dataView.getFloat32(i + 4, true);
    let z = dataView.getFloat32(i + 8, true);

    x *= scaleFactor;
    y *= -scaleFactor;
    z *= -scaleFactor;

    float32Array[j + 0] = x;
    float32Array[j + 1] = y;
    float32Array[j + 2] = z;
  }
}
export function depthFloat32ArrayToPositionAttributeArray(
  depthFloat32Array,
  renderer,
  camera,
  float32Array,
  // scaleFactor,
) { // result in float32Array
  /* if (!renderer || !camera) {
    console.warn('missing renderer or camera');
    debugger;
  } */
  const numPixels = depthFloat32Array.length;
  const width = Math.sqrt(numPixels);
  const height = width;
  // if (width * height !== numPixels) {
  //   throw new Error('invalid point cloud dimensions');
  // }
  for (let i = 0; i < depthFloat32Array.length; i++) {
    const x = (i % renderer.domElement.width) / renderer.domElement.width;
    let y = Math.floor(i / renderer.domElement.width) / renderer.domElement.height;
    y = 1 - y;
  
    const viewZ = depthFloat32Array[i];
    const worldPoint = setCameraViewPositionFromViewZ(x, y, viewZ, camera, localVector);
    const target = worldPoint.applyMatrix4(camera.matrixWorld);

    target.toArray(float32Array, i * 3);



    

    /* // render an instanced cubes mesh to show the depth
    const depthCubesGeometry = new THREE.BoxBufferGeometry(0.01, 0.01, 0.01);
    const depthCubesMaterial = new THREE.MeshPhongMaterial({
      // color: 0x00FFFF,
      vertexColors: true,
    });
    const depthCubesMesh = new THREE.InstancedMesh(depthCubesGeometry, depthCubesMaterial, depthFloats.length);
    depthCubesMesh.name = 'depthCubesMesh';
    depthCubesMesh.frustumCulled = false;

    // set the matrices by projecting the depth from the perspective camera
    depthCubesMesh.count = 0;
    for (let i = 0; i < depthFloats.length; i += depthRenderSkipRatio) {
      const x = (i % this.renderer.domElement.width) / this.renderer.domElement.width;
      let y = Math.floor(i / this.renderer.domElement.width) / this.renderer.domElement.height;
      y = 1 - y;

      const viewZ = depthFloats[i];
      const worldPoint = setCameraViewPositionFromViewZ(x, y, viewZ, this.camera, localVector);
      const target = worldPoint.applyMatrix4(this.camera.matrixWorld);

      localMatrix.makeTranslation(target.x, target.y, target.z);
      depthCubesMesh.setMatrixAt(i / depthRenderSkipRatio, localMatrix);
      depthCubesMesh.count++;
    }
    depthCubesMesh.instanceMatrix.needsUpdate = true;
    return depthCubesMesh; */
  }
}

//

function viewZToOrthographicDepth(viewZ, near, far) {
  return ( viewZ + near ) / ( near - far );
}
function orthographicDepthToViewZ(orthoZ, near, far) {
  return orthoZ * ( near - far ) - near;
}
export const setCameraViewPositionFromViewZ = (x, y, viewZ, camera, target) => {
  const {near, far, projectionMatrix, projectionMatrixInverse} = camera;
  
  const depth = viewZToOrthographicDepth(viewZ, near, far);

  const clipW = projectionMatrix.elements[2 * 4 + 3] * viewZ + projectionMatrix.elements[3 * 4 + 3];
  const clipPosition = new THREE.Vector4(
    (x - 0.5) * 2,
    (y - 0.5) * 2,
    (depth - 0.5) * 2,
    1
  );
  clipPosition.multiplyScalar(clipW);
  const viewPosition = clipPosition.applyMatrix4(projectionMatrixInverse);
  
  target.x = viewPosition.x;
  target.y = viewPosition.y;
  target.z = viewPosition.z;
  return target;
};

//

export const reprojectCameraFov = (() => {
  return (x, y, viewZ, oldCamera, newCamera) => { // XXX support oldCamera, newCamera
    const {near, far, projectionMatrix} = oldCamera;
    const {near: near2, far: far2, projectionMatrix: projectionMatrix2} = newCamera;
    
    const depth = viewZToOrthographicDepth(viewZ, near, far);

    const clipW = projectionMatrix.elements[2 * 4 + 3] * viewZ + projectionMatrix.elements[3 * 4 + 3];
    const clipPosition = new THREE.Vector4(
      (x - 0.5) * 2,
      (y - 0.5) * 2,
      (depth - 0.5) * 2,
      1
    );
    clipPosition.multiplyScalar(clipW);

    // reverse the process
    const clipPosition2 = clipPosition;
    const clipW2 = projectionMatrix2.elements[2 * 4 + 3] * viewZ + projectionMatrix2.elements[3 * 4 + 3];
    clipPosition2.multiplyScalar(1 / clipW2);
    clipPosition2.x = (clipPosition2.x / 2 + 0.5);
    clipPosition2.y = (clipPosition2.y / 2 + 0.5);
    clipPosition2.z = (clipPosition2.z / 2 + 0.5);
    clipPosition2.w = 1;

    const viewZ2 = orthographicDepthToViewZ(clipPosition2.z, near2, far2);
    return viewZ2;
  };
})();
export const reprojectCameraFovArray = (depthFloats, width, height, oldCamera, newCamera) => {
  const result = new Float32Array(depthFloats.length);
  for (let i = 0; i < depthFloats.length; i++) {
    const x = (i % width) / width;
    let y = Math.floor(i / width) / height;
    y = 1 - y;

    let viewZ = depthFloats[i];
    viewZ = reprojectCameraFov(x, y, viewZ, oldCamera, newCamera);
    result[i] = viewZ;
  }
  return result;
};

//

export function applySkybox(float32Array) { // // result in float32Array
  const numPixels = float32Array.length / 3;
  const width = Math.sqrt(numPixels);
  const height = width;
  if (width * height !== numPixels) {
    throw new Error('invalid point cloud dimensions');
  }
  for (let i = 0, j = 0; i < float32Array.length; i += 3, j += 1) {
    const x = float32Array[i + 0];
    const y = float32Array[i + 1];
    const z = float32Array[i + 2];

    if (z <= -skyboxDistance) {
      float32Array[i + 0] *= skyboxScaleFactor;
      float32Array[i + 1] *= skyboxScaleFactor;
      float32Array[i + 2] *= skyboxScaleFactor;
    }
  }
}

export async function getPointCloud(blob) {
  const res = await fetch('https://depth.webaverse.com/pointcloud', {
    method: "POST",
    body: blob,
    headers: {
      "Content-Type": "image/png",
    },
    mode: 'cors',
  });
  if (res.ok) {
    const headers = Object.fromEntries(res.headers.entries());
    const arrayBuffer = await res.arrayBuffer();
    return {
      headers,
      arrayBuffer,
    };
  } else {
    debugger;
  }
}

export const labelColors = (() => {
  const result = [];
  for (const colorName of Object.keys(materialColors)) {
    const colors = materialColors[colorName];
    for (const weight of ['400']) {
      const hashColor = colors[weight];
      const color = new THREE.Color(hashColor);
      result.push(color);
    }
  }
  // random shuffle
  for (let i = 0; i < result.length; i++) {
    const j = Math.floor(Math.random() * result.length);
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
})();
export function pointCloudArrayBufferToColorAttributeArray(labelImageData, uint8Array) { // result in uint8Array
  const imageData = {
    data: new Uint8Array(labelImageData),
  };

  const usedLabelColors = new Set();
  // write to the color attribute buffer (RGB)
  for (let i = 0, j = 0; i < imageData.data.length; i += 4, j += 3) {
    const r = imageData.data[i + 0];
    // const g = imageData.data[i + 1];
    // const b = imageData.data[i + 2];
    // const a = imageData.data[i + 3];
    if (r !== 255 && r < labelColors.length) {
      // const labelClass = labelClasses[r];
      const color = labelColors[r];
      if (!usedLabelColors.has(color)) {
        usedLabelColors.add(color);
      }
      uint8Array[j + 0] = color.r * 255;
      uint8Array[j + 1] = color.g * 255;
      uint8Array[j + 2] = color.b * 255;
    } else {
      // none
    }
  }
}