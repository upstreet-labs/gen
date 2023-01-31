import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {useState, useRef, useEffect} from 'react';
import classnames from 'classnames';

import {
    ZineStoryboard,
} from '../../zine/zine-format.js';
import {
    ZineRenderer,
} from '../../zine/zine-renderer.js';
import {
    ZineCameraManager,
} from '../../zine-runtime/zine-camera.js';
import bezier from '../../zine-runtime/easing.js';
// import {
//   compileScene, // XXX for remote compilation
// } from '../../../zine-runtime/zine-remote-compiler.js';
import {
    compileVirtualSceneExport,
} from '../../generators/scene-generator.js';
import {
    PathMesh,
} from '../../zine-aux/meshes/path-mesh.js';
import{
    SceneGallery,
} from '../image-gallery/SceneGallery.jsx';
import {
    VideoMesh,
} from '../../zine-aux/meshes/video-mesh.js';
import {
    ParticleEmitter2,
    ParticleSystemMesh,
} from '../../zine-aux/meshes/particle-system.js';
import {
    PortalMesh,
} from '../../zine-aux/meshes/portal-mesh.js';
// import {
//     SpeechBubbleMesh,
// } from '../../zine-aux/meshes/speech-bubble-mesh.js';
import {
    loadImage,
} from '../../../utils.js';

import styles from '../../../styles/TitleScreen.module.css';

//

const hash = `8ebd78be3078833da10c95b565ee88b7cf6ba9e0`;
const assetsBaseUrl = `https://cdn.jsdelivr.net/gh/webaverse/content@${hash}/`;
const titleScreenZineFileName = 'title-screen.zine';
const cubicBezier = bezier(0, 1, 0, 1);

//

const localVector2D = new THREE.Vector2();
// const localQuaternion = new THREE.Quaternion();
const localMatrix = new THREE.Matrix4();

// const zeroVector = new THREE.Vector3(0, 0, 0);
// const oneVector = new THREE.Vector3(1, 1, 1);
// const upVector = new THREE.Vector3(0, 1, 0);

//

const _loadArrayBuffer = async u => {
    const res = await fetch(u);
    const arrayBuffer = await res.arrayBuffer();
    return arrayBuffer;
};

//

const _saveFile = async (fileName, uint8Array) => {
    const d = await navigator.storage.getDirectory();
    // console.log('save to d', d, titleScreenRenderer.uint8Array);
    const fh = await d.getFileHandle(fileName, {
        create: true,
    });
    // write titleScreenRenderer.uint8Array to f
    const w = await fh.createWritable();
    await w.write(uint8Array);
    await w.close();
    // console.log('done saving');
};
const _loadFile = async (fileName) => {
    const d = await navigator.storage.getDirectory();
    // console.log('open from d', d);
    const fh = await d.getFileHandle(fileName, {
        create: false,
    });
    // get file size
    const f = await fh.getFile();
    // console.log('file size', f, f.size);
    const arrayBuffer = await f.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    // console.log('load result', uint8Array);
    return uint8Array;
};

//

class LinearAnimation {
    constructor({
        startValue,
        endValue,
        startTime,
        duration,
    }) {
        this.startValue = startValue;
        this.endValue = endValue;
        this.startTime = startTime;
        this.duration = duration;
    }
    update(timestamp) {
        const timeDiff = timestamp - this.startTime;
        let f = timeDiff / this.duration;
        const done = f >= 1;
        f = Math.min(Math.max(f, 0), 1);
        const value = this.startValue + (this.endValue - this.startValue) * f;
        return {
            done,
            value,
        };
    }
}

//

/* const SpeechBubble = ({
    message,
}) => {
  return (
    <div className={styles.speechBubble}>
      <div className={styles.message}>{message}</div>
      <div className={styles.notch} />
    </div>
  )
}; */

//

class TitleScreenRenderer extends EventTarget {
    constructor({
        canvas,
        uint8Array,
    }) {
        super();

        this.canvas = canvas;
        this.uint8Array = uint8Array;

        // cleanup
        this.cleanupFns = [];

        let live = true;
        this.cleanupFns.push(() => {
            cancelAnimationFrame(frame);
        });

        // renderer
        const renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
        });
        this.renderer = renderer;
    
        // scene
        const scene = new THREE.Scene();
        scene.autoUpdate = false;

        // camera
        const camera = new THREE.PerspectiveCamera();
        this.camera = camera;

        // camera manager
        const localPlayer = new THREE.Object3D();
        localPlayer.position.z = -1;
        localPlayer.updateMatrixWorld();
        const zineCameraManager = new ZineCameraManager({
            camera,
            localPlayer,
        }, {
            normalizeView: false,
            followView: false,
        });
    
        // storyboard
        (async () => {
            const zineStoryboard = new ZineStoryboard();
            await zineStoryboard.loadAsync(uint8Array);
            if (!live) return;
    
            const panel0 = zineStoryboard.getPanel(0);
            const zineRenderer = new ZineRenderer({
                panel: panel0,
                alignFloor: true,
            });
    
            // scene mesh
            scene.add(zineRenderer.scene);
            zineRenderer.scene.updateMatrixWorld();
    
            // path mesh
            const splinePoints = zineRenderer.metadata.paths.map(p => new THREE.Vector3().fromArray(p.position));
            const pathMesh = new PathMesh(splinePoints, {
                animate: true,
            });
            scene.add(pathMesh);
            pathMesh.updateMatrixWorld();
    
            // apply camera
            // camera.copy(zineRenderer.camera);
            zineCameraManager.setLockCamera(zineRenderer.camera);
            zineCameraManager.toggleCameraLock();
        })();

        // video mesh
        this.videoMesh = null;
        (async () => {
            const videoUrl = `${assetsBaseUrl}videos/upstreet2.ktx2z`;
            
            // const videoUrl = `/sm/spritesheet.ktx2z`;

            // console.log('got video url', videoUrl);
            const res = await fetch(videoUrl);
            const blob = await res.blob();
            const pack = await VideoMesh.loadPack([
                blob,
            ]);

            const videoMesh = new VideoMesh({
                pack,
            });
            this.videoMesh = videoMesh;
            videoMesh.frustumCulled = false;
            scene.add(videoMesh);
        })();
        /* (async () => {
            const videoUrl = `${assetsBaseUrl}/videos/upstreet2.mp4`;
            // console.log('got video url', videoUrl);
            video = await _loadVideo(videoUrl);
            if (!live) return;
            
            video.muted = true;
            video.play();
            video.loop = true;
            // video.playbackRate = 2;
            video.style.cssText = `\
                position: absolute;
                top: 0;
                left: 0;
            `;
            // document.body.appendChild(video);

            this.cleanupFns.push(() => {
                video.pause();
            });
        })(); */

        // portal mesh
        this.portalMesh = null;
        (async () => {
            const portalScene = new THREE.Scene();
            portalScene.autoUpdate = false;
            {
                const gltfLoader = new GLTFLoader();
                gltfLoader.load('/models/skybox.glb', gltf => {
                    const skyboxMesh = gltf.scene;
                    portalScene.add(skyboxMesh);  
                    skyboxMesh.updateMatrixWorld();
                }, undefined, err => {
                  console.warn(err);
                });
            }

            const noiseImage = await loadImage('/images/noise.png');

            const portalMesh = new PortalMesh({
                renderer,
                portalScene,
                portalCamera: camera,
                noiseImage,
            });
            this.portalMesh = portalMesh;
            portalMesh.position.set(0, -1, -5);
            portalMesh.scale.setScalar(3);
            scene.add(portalMesh);
            portalMesh.updateMatrixWorld();
        })();
        this.portalSizeIndex = 0;
        this.portalAnimations = [];

        /* // speech bubble mesh
        let speechBubbleMesh;
        {
            speechBubbleMesh = new SpeechBubbleMesh({
                text: 'hello world',
                fontSize: 0.1,
            });
            speechBubbleMesh.position.set(0, 2, -3);
            scene.add(speechBubbleMesh);
            speechBubbleMesh.updateMatrixWorld();
        } */

        // particle system mesh
        this.particleSystemMesh = null;
        this.particleEmitter = null;
        (async () => {
            const particleName = 'Elements - Energy 017 Charge Up noCT noRSZ.mov';
            const explosionName = 'Elements - Energy 119 Dissapear noCT noRSZ.mov';
            const explosion2Name = 'Elements - Explosion 014 Hit Radial MIX noCT noRSZ.mov';
            const particleNames = [
                particleName,
                explosionName,
                explosion2Name,
            ].map(s => s.replace(/\.mov$/, '.ktx2z'));

            const videoUrls = particleNames.map(particleName => `${assetsBaseUrl}particles/${particleName}`);

            const files = await Promise.all(videoUrls.map(async videoUrl => {
                const res = await fetch(videoUrl);
                const blob = await res.blob();
                return blob;
            }));
            const pack = await ParticleSystemMesh.loadPack(files);

            const particleSystemMesh = new ParticleSystemMesh({
                pack,
            });
            this.particleSystemMesh = particleSystemMesh;
            particleSystemMesh.frustumCulled = false;
            scene.add(particleSystemMesh);
            particleSystemMesh.position.z = -1;
            particleSystemMesh.scale.setScalar(0.5);
            particleSystemMesh.updateMatrixWorld();

            const particleEmitter = new ParticleEmitter2(particleSystemMesh, {
                range: 0.3,
            });
            this.particleEmitter = particleEmitter;
        })();

        // resize handler
        const _setSize = () => {
            renderer.setSize(globalThis.innerWidth, globalThis.innerHeight);
    
            if (this.videoMesh) {
                this.videoMesh.material.uniforms.screenResolution.value.set(
                    globalThis.innerWidth,
                    globalThis.innerHeight
                );
                this.videoMesh.material.uniforms.screenResolution.needsUpdate = true;
            }
        };
        _setSize();
        renderer.setPixelRatio(globalThis.devicePixelRatio);

        const resize = e => {
            _setSize();

            this.dispatchEvent(new MessageEvent('resize'));
        };
        globalThis.addEventListener('resize', resize);
        this.cleanupFns.push(() => {
            globalThis.removeEventListener('resize', resize);
        });
        
        // key handlers
        let lastPointerLockChangeTime = -Infinity;
        let startOpacity = 0;
        let endOpacity = 1;
        const opacityRate = 1;
        this.getCurrentOpacity = now => {
            const timeDiff = now - lastPointerLockChangeTime;
            const timeDiffS = timeDiff / 1000;

            let f = timeDiffS / opacityRate;
            f = Math.min(Math.max(f, 0), 1);
            
            const opacity = startOpacity + (endOpacity - startOpacity) * cubicBezier(f);
            return opacity;
        };
        const pointerlockchange = e => {
            const now = performance.now();

            startOpacity = this.getCurrentOpacity(now);
            endOpacity = document.pointerLockElement ? 0 : 1;

            lastPointerLockChangeTime = now;
        };
        document.addEventListener('pointerlockchange', pointerlockchange);
    
        // render loop
        let lastTimestamp = performance.now();
        const _recurse = () => {
          frame = requestAnimationFrame(_recurse);
    
          if (!document.hidden) {
            const timestamp = performance.now();
            const timeDiff = timestamp - lastTimestamp;
            
            // local update
            this.update(timestamp, timeDiff);
            // update camera
            zineCameraManager.updatePost(timestamp, timeDiff);
            
            // render
            renderer.render(scene, camera);

            // post update
            lastTimestamp = timestamp;
          }
        };
        let frame = requestAnimationFrame(_recurse);

        this.cleanupFns.push(() => {
            cancelAnimationFrame(frame);
        });
    }
    static portalSizes = [
        1,
        0,
        100,
    ];
    togglePortal() {
        this.portalSizeIndex = (this.portalSizeIndex + 1) % TitleScreenRenderer.portalSizes.length;

        const startTime = performance.now();
        const nextSize = TitleScreenRenderer.portalSizes[this.portalSizeIndex];
        this.portalAnimations.push(new LinearAnimation({
            startTime,
            duration: 1000,
            startValue: this.portalMesh.getScale(),
            endValue: nextSize,
        }));
    }
    update(timestamp, timeDiff) {
        // update meshes
        if (this.videoMesh) {
            const resolution = this.renderer.getSize(localVector2D);
            this.videoMesh.update({
                timestamp,
                opacity: this.getCurrentOpacity(timestamp),
                resolution,
            });
        }
        if (this.portalMesh) {
            this.portalAnimations = this.portalAnimations.filter(portalAnimation => {
                const {
                    done,
                    value,
                } = portalAnimation.update(timestamp);
                this.portalMesh.setScale(value);
                return !done;
            });
            this.portalMesh.update(timestamp);
        }
        if (this.particleSystemMesh) {
            this.particleEmitter.update({
                timestamp,
                localPlayer: this.particleSystemMesh,
            });

            this.particleSystemMesh.update({
                timestamp,
                timeDiff,
                camera: this.camera,
            });
        }
    }
    destroy() {
      for (let i = 0; i < this.cleanupFns.length; i++) {
        this.cleanupFns[i]();
      }
    }
}

//

class SpeechBubbleObject extends THREE.Object3D {
    constructor({
        text,
        updateFn,
    }) {
        super();

        this.text = text;
        this.updateFn = updateFn;

        this.lastText = '';
    }
}
class SpeechBubbleManager extends EventTarget {
    constructor({
        containerEl,
    }) {
        super();

        this.containerEl = containerEl;
        
        this.rect = null;
        this.speechBubbles = [];
        this.speechBubbleElCache = new WeakMap();
        this.cleanupFns = [];

        this.refreshRect();
        {
            // resize observer on containerEl
            const resizeObserver = new ResizeObserver(() => {
                this.refreshRect();
            });
            resizeObserver.observe(this.containerEl);
            this.cleanupFns.push(() => {
                resizeObserver.disconnect();
            });
        }
    }
    refreshRect() {
        this.rect = this.containerEl.getBoundingClientRect();
    }
    createSpeechBubble({
        text = `I'm going places.`,
        updateFn = () => true,
    } = {}) {
        const speechBubbleObject = new SpeechBubbleObject({
            text,
            updateFn,
        });
        this.speechBubbles.push(speechBubbleObject);
        return speechBubbleObject;
    }
    removeSpeechBubble(speechBubble) {
        const index = this.speechBubbles.indexOf(speechBubble);
        if (index !== -1) {
            this.speechBubbles.splice(index, 1);
            speechBubble.parent && speechBubble.parent.remove(speechBubble);
        } else {
            throw new Error(`could not find speech bubble`);
        }
    }
    update(timestamp) {
        for (let i = 0; i < this.speechBubbles.length; i++) {
            const speechBubble = this.speechBubbles[i];
            const f = speechBubble.updateFn(timestamp);
            if (f >= 1) {
                this.removeSpeechBubble(speechBubble);
                i--;

                const el = this.speechBubbleElCache.get(speechBubble);
                if (!el) {
                    console.warn('no speech bubble el in cache to delete', {
                        speechBubbleElCache: this.speechBubbleElCache,
                        speechBubble,
                    });
                    debugger;
                }
                el.parentNode.removeChild(el);
                this.speechBubbleElCache.delete(speechBubble);
                
                continue;
            }
        }

        for (let i = 0; i < this.speechBubbles.length; i++) {
            const speechBubble = this.speechBubbles[i];
            let el = this.speechBubbleElCache.get(speechBubble);
            if (!el) {
                el = document.createElement('div');
                el.classList.add(styles.speechBubble);
                this.containerEl.appendChild(el);
                this.speechBubbleElCache.set(speechBubble, el);
            }
            if (speechBubble.text !== speechBubble.lastText) {
                el.innerText = speechBubble.text;
                speechBubble.lastText = speechBubble.text;
            }
        }
    }
    destroy() {
        for (let i = 0; i < this.cleanupFns.length; i++) {
            this.cleanupFns[i]();
        }
    }
}
/* const SpeechBubbles = ({
    speechBubbleManager,
}) => {
    const [speechBubbleMessages, setSpeechBubbleMessages] = useState([]);
    const [speechBubbleElCache, setSpeechBubbleElCache] = useState(() => new WeakMap());
    const speechBubblesRef = useRef();

    useEffect(() => {
        const speechBubblesEl = speechBubblesRef.current;
        if (speechBubbleManager && speechBubblesEl) {
            const _recurse = () => {
                frame = requestAnimationFrame(_recurse);

                const timestamp = performance.now();
                for (let i = 0; i < speechBubbleManager.speechBubbles.length; i++) {
                    const speechBubble = speechBubbleManager.speechBubbles[i];
                    const f = speechBubble.updateFn(timestamp);
                    if (f >= 1) {
                        // speechBubbleManager.speechBubbles.splice(i, 1);
                        speechBubbleManager.removeSpeechBubble(speechBubble);
                        i--;

                        const el = speechBubbleElCache.get(speechBubble);
                        if (!el) {
                            console.warn('no speech bubble el in cache to delete', {speechBubbleElCache, speechBubble});
                            debugger;
                        }
                        el.parentNode.removeChild(el);
                        speechBubbleElCache.delete(speechBubble);
                        
                        continue;
                    }
                }

                for (let i = 0; i < speechBubbleManager.speechBubbles.length; i++) {
                    const speechBubble = speechBubbleManager.speechBubbles[i];
                    let el = speechBubbleElCache.get(speechBubble);
                    if (!el) {
                        el = document.createElement('div');
                        el.classList.add(styles.speechBubble);
                        speechBubblesEl.appendChild(el);
                        speechBubbleElCache.set(speechBubble, el);
                    }
                    if (speechBubble.text !== speechBubble.lastText) {
                        el.innerText = speechBubble.text;
                        speechBubble.lastText = speechBubble.text;
                    }
                }
            };
            let frame = requestAnimationFrame(_recurse);

            return () => {
                cancelAnimationFrame(frame);
            };
        }
    }, [speechBubbleManager, speechBubblesRef.current]);

    return (
        <div className={styles.speechBubbles} ref={speechBubblesRef} />
    );
}; */

//

const MainScreen = ({
    titleScreenRenderer,
    focused,
    onFocus,
    canvasRef,
}) => {
    const [resolution, setResolution] = useState(() => {
        const resolution = new THREE.Vector2();
        if (titleScreenRenderer) {
            titleScreenRenderer.renderer.getSize(resolution);
        }
        return resolution;
    });
    const [speechBubbleManager, setSpeechBubbleManager] = useState(null);
    const speechBubblesRef = useRef();

    const _togglePointerLock = async () => {
        const canvas = canvasRef.current;
        if (canvas) {
            if (!document.pointerLockElement) {
              await canvas.requestPointerLock();
            } else {
                document.exitPointerLock();
            }
        }
    };
    const _requestPointerLock = async () => {
        const canvas = canvasRef.current;
        if (canvas) {
            await canvas.requestPointerLock();
        }
    };

    useEffect(() => {
        if (titleScreenRenderer) {
            const resize = () => {
                const resolution = new THREE.Vector2();
                titleScreenRenderer.renderer.getSize(resolution);
                console.log('resize resolution', resolution.x, resolution.y);
                setResolution(resolution);
            };
            titleScreenRenderer.addEventListener('resize', resize);

            resize();

            return () => {
                titleScreenRenderer.removeEventListener('resize', resize);
            };
        }
    }, [titleScreenRenderer]);

    useEffect(() => {
        const speechBubblesEl = speechBubblesRef.current;
        if (speechBubblesEl) {
            const speechBubbleManager = new SpeechBubbleManager({
                containerEl: speechBubblesEl,
            });
            setSpeechBubbleManager(speechBubbleManager);

            const _recurse = () => {
                frame = requestAnimationFrame(_recurse);

                const timestamp = performance.now();
                speechBubbleManager.update(timestamp);
            };
            let frame = requestAnimationFrame(_recurse);

            return () => {
                speechBubbleManager.destroy();
                setSpeechBubbleManager(null);

                cancelAnimationFrame(frame);
            };
        }
    }, [speechBubblesRef.current]);

    useEffect(() => {
        const pointerlockchange = e => {
            onFocus(document.pointerLockElement === canvasRef.current);
        };
        document.addEventListener('pointerlockchange', pointerlockchange);

        const wheel = e => {
            e.preventDefault();
            e.stopPropagation();
        };
        document.addEventListener('wheel', wheel, {
            passive: false,
        });

        const keydown = e => {
            switch (e.key) {
                case ' ': {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    _togglePointerLock();
                    break;
                }
                case 'p': {
                    e.preventDefault();
                    e.stopPropagation();

                    titleScreenRenderer.togglePortal();
                    break;
                }
                case 'm': {
                    e.preventDefault();
                    e.stopPropagation();
            
                    const startTime = performance.now();
                    const duration = 1000;
                    speechBubbleManager.createSpeechBubble({
                        text: `I'm going places.`,
                        updateFn(timestamp) {
                            const timeDiff = timestamp - startTime;
                            const f = timeDiff / duration;
                            return f;
                        },
                    });
                    break;
                }
            }
        };
        document.addEventListener('keydown', keydown);

        return () => {
            document.removeEventListener('pointerlockchange', pointerlockchange);
            document.removeEventListener('wheel', wheel);
            document.removeEventListener('keydown', keydown);
        };
    }, [canvasRef.current, titleScreenRenderer, onFocus]);

    console.log('render resolution', resolution.x, resolution.y);

    return (
        <div className={classnames(
            styles.mainScreen,
            titleScreenRenderer ? styles.enabled : null,
            focused ? styles.focused : null,
        )}>
            <div
                className={styles.speechBubbles}
                ref={speechBubblesRef}
                style={{
                    width: `${resolution.x}px`,
                    height: `${resolution.y}px`,
                }}
            ></div>
            <canvas className={classnames(
                styles.canvas,
            )} onDoubleClick={async e => {
                await _requestPointerLock();
            }} ref={canvasRef} />
            <footer className={styles.footer}>
                <div className={styles.warningLabel}>
                    <span className={styles.bold}>SEVERE WARNING:</span> This product is not intended for children under age sixty. <span className={styles.bold}>This is an AI generated product.</span> The ideas expressed are not proven to be safe. This product contains cursed language and due to its nature it should be viewed twice. Made by the Lisk.
                </div>
                <div className={styles.slider}>
                    <div className={styles.notches}>
                        <div className={classnames(
                            styles.notch,
                        )} />
                        <div className={classnames(
                            styles.notch,
                            styles.selected,
                        )} />
                        <div className={classnames(
                            styles.notch,
                            styles.loading,
                        )} />
                    </div>
                </div>
            </footer>
        </div>
    );
};

//

const TitleScreen = () => {
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [focused, setFocused] = useState(false);
    const [titleScreenRenderer, setTitleScreenRenderer] = useState(null);

    const canvasRef = useRef();

    useEffect(() => {
        const keydown = async e => {
            switch (e.key) {
                case 's': {
                    if (e.ctrlKey) {
                        e.preventDefault();
                        e.stopPropagation();

                        console.log('save', titleScreenRenderer);

                        if (titleScreenRenderer) {
                            await _saveFile(titleScreenZineFileName, titleScreenRenderer.uint8Array);
                        }
                    }
                    break;
                }
                case 'o': {
                    if (e.ctrlKey) {
                        e.preventDefault();
                        e.stopPropagation();

                        console.log('open', titleScreenRenderer);

                        titleScreenRenderer && titleScreenRenderer.destroy();
                        setTitleScreenRenderer(null);

                        const canvas = canvasRef.current;
                        if (canvas) {
                            const uint8Array = await _loadFile(titleScreenZineFileName);

                            const newTitleScreenRenderer = new TitleScreenRenderer({
                                canvas,
                                uint8Array,
                            });
                            setTitleScreenRenderer(newTitleScreenRenderer);
                            setLoaded(true);

                            console.log('done loading', newTitleScreenRenderer);
                        } else {
                            throw new Error('no canvas');
                        }
                    }
                    break;
                }
            }
        };
        document.addEventListener('keydown', keydown);

        return () => {
            document.removeEventListener('keydown', keydown);
        };
    }, [canvasRef.current, titleScreenRenderer]);

    return (
        <div
            className={styles.titleScreen}
        >
            <MainScreen
                titleScreenRenderer={titleScreenRenderer}
                focused={focused}
                onFocus={newFocused => {
                    setFocused(newFocused);
                }}
                canvasRef={canvasRef}
            />
            {loading ? (
                <div className={styles.header}>
                    loading...
                </div>
            ) : (loaded ? (
                    null
                ) : (<SceneGallery
                    onImageClick={async u => {
                        try {
                            setLoading(true);

                            const canvas = canvasRef.current;
                            if (canvas) {
                                const imageArrayBuffer = await _loadArrayBuffer(u);
                                const uint8Array = await compileVirtualSceneExport(imageArrayBuffer);

                                const titleScreenRenderer = new TitleScreenRenderer({
                                    canvas,
                                    uint8Array,
                                });
                                setTitleScreenRenderer(titleScreenRenderer);
                                setLoaded(true);
                            } else {
                                throw new Error('no canvas');
                            }
                        } finally {
                            setLoading(false);
                        }
                    }}
                />))
            }
        </div>
    );

};
export default TitleScreen;