import * as THREE from 'three';
// import {createCanvas, loadImage} from 'canvas';
// import materialColors from './material-colors.json';
// import ColorScheme from './color-scheme.js';
import {colors} from '../src/constants/detectron-colors.js';

//

// const baseColors = Object.keys(materialColors).map(k => materialColors[k][400].slice(1));

//

const rng = () => (Math.random() * 2) - 1;
const localColor = new THREE.Color();

//

const createCanvas = (w, h) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
};

//

export const createSeedImage = (
  w, // width
  h, // height
  rw, // radius width
  rh, // radius height
  p, // power distribution of radius
  n, // number of rectangles
  {
    color = null,
    monochrome = false,
    // blur = 0,
  } = {},
) => {
  // const canvas = document.createElement('canvas');
  // canvas.width = w;
  // canvas.height = h;
  const canvas = createCanvas(w, h);

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  // ctx.filter = blur ? `blur(${blur}px) saturate(1.5)` : '';
  
  // const baseColor = color ?? baseColors[Math.floor(Math.random() * baseColors.length)];
  // const scheme = new ColorScheme();
  // scheme.from_hex(baseColor)
  //   .scheme(monochrome ? 'mono' : 'triade')   
  //   // .variation('hard');
  // const colors = scheme.colors();
  const cs = [];
  const candidateColors = colors.slice();
  for (let i = 0; i < 6; i++) {
    const color = candidateColors.splice(Math.floor(Math.random() * candidateColors.length), 1)[0];
    localColor.setHex(color)
      .offsetHSL(0, -0.2, 0);
    cs.push(localColor.getHexString());
  }

  for (let i = 0; i < n; i++) {
    const x = w / 2 + rng() * rw;
    const y = h / 2 + rng() * rh;
    const sw = Math.pow(Math.random(), p) * rw;
    const sh = Math.pow(Math.random(), p) * rh;
    // ctx.fillStyle = '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16);
    ctx.fillStyle = '#' + cs[Math.floor(Math.random() * cs.length)];
    // ctx.fillStyle = '#' + baseColors[Math.floor(Math.random() * baseColors.length)];

    ctx.fillRect(x - sw / 2, y - sh / 2, sw, sh);

    /* const cx = x + sw / 2;
    const cy = y + sh / 2;
    const r = Math.random() * Math.PI * 2;

    ctx.translate(cx, cy);
    ctx.rotate(r);
    ctx.translate(-cx, -cy);

    ctx.fillRect(x - sw / 2, y - sh / 2, sw, sh);

    ctx.resetTransform(); */
  }

  return canvas;
};