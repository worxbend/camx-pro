import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadAssembly } from './cad-model.js';

export class StudioScene {
  constructor(element, { exploded = false } = {}) {
    this.element = element;
    this.exploded = exploded;
    this.disposed = false;
    this.visible = false;
    this.state = { pan: 0, tilt: 0, mode: exploded ? 'exploded' : 'exterior', finish: 'graphite' };
  }

  async load() {
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute(
      'aria-label',
      this.exploded
        ? 'Exploded CAD assembly. Use arrow keys to orbit, plus and minus to zoom, Home to reset.'
        : 'CAMX Pro 3D model. Use arrow keys to orbit, plus and minus to zoom, Home to reset.',
    );
    this.element.append(canvas);
    // Vertical swipes keep the document scrollable on touch screens. One finger orbits horizontally.
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 3000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.minPolarAngle = 0.18;
    this.controls.maxPolarAngle = Math.PI * 0.57;
    this.controls.rotateSpeed = 0.7;
    this.controls.touches.ONE = THREE.TOUCH.ROTATE;
    this.controls.addEventListener('change', () => this.render());
    canvas.style.touchAction = 'pan-y';
    this.onKey = (event) => {
      if (
        !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(
          event.key,
        )
      )
        return;
      event.preventDefault();
      if (event.key === 'Home') return this.resetCamera();
      const offset = this.camera.position.clone().sub(this.controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      if (event.key === 'ArrowLeft') spherical.theta -= 0.12;
      if (event.key === 'ArrowRight') spherical.theta += 0.12;
      if (event.key === 'ArrowUp') spherical.phi -= 0.1;
      if (event.key === 'ArrowDown') spherical.phi += 0.1;
      if (event.key === '+' || event.key === '=') spherical.radius *= 0.9;
      if (event.key === '-') spherical.radius *= 1.1;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.18, Math.PI * 0.57);
      spherical.radius = THREE.MathUtils.clamp(spherical.radius, 280, 750);
      this.camera.position
        .copy(this.controls.target)
        .add(new THREE.Vector3().setFromSpherical(spherical));
      this.controls.update();
      this.render();
    };
    canvas.addEventListener('keydown', this.onKey);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xf5edff, 0x4b3658, 1.1));
    const key = new THREE.DirectionalLight(0xfff6ed, 4);
    key.position.set(-120, 600, 180);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, {
      left: -180,
      right: 180,
      top: 260,
      bottom: -180,
      near: 1,
      far: 900,
    });
    key.shadow.normalBias = 0.5;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xe4ddff, 2);
    rim.position.set(180, 230, -150);
    this.scene.add(rim);
    // A soft contact shadow grounds the assembly without a hard, clipped cast shadow.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 128;
    const context = shadowCanvas.getContext('2d');
    const gradient = context.createRadialGradient(64, 64, 12, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(25,15,35,0.35)');
    gradient.addColorStop(0.45, 'rgba(25,15,35,0.22)');
    gradient.addColorStop(1, 'rgba(25,15,35,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
    this.shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(290, 260),
      new THREE.MeshBasicMaterial({
        map: this.shadowTexture,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = this.exploded ? -18 : -0.4;
    this.scene.add(this.floor);
    this.resetCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.element);
    this.visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        this.visible = entry.isIntersecting;
        if (this.visible) this.render();
      },
      { threshold: 0.01 },
    );
    this.visibilityObserver.observe(this.element);
    this.assembly = await loadAssembly(this.scene);
    if (this.disposed) {
      this.assembly.dispose();
      return;
    }
    this.ready = true;
    this.update(this.state);
    this.resize();
    this.element.dataset.ready = 'true';
    this.element.querySelector('.scene-status').hidden = true;
  }

  resize() {
    if (this.disposed) return;
    const { clientWidth: width, clientHeight: height } = this.element;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  resetCamera() {
    const exploded = this.state.mode === 'exploded';
    this.controls.target.set(0, exploded ? 112 : 88, 0);
    this.camera.position.set(exploded ? 360 : 280, exploded ? 250 : 200, exploded ? 440 : 355);
    this.controls.update();
    this.render();
  }

  update(state) {
    const changed = this.state.mode !== state.mode;
    this.state = { ...state };
    this.assembly?.update(state);
    if (this.floor) this.floor.position.y = state.mode === 'exploded' ? -18 : -0.4;
    if (changed) this.resetCamera();
    this.render();
  }

  render(force = false) {
    if (!this.renderer || this.disposed || (!force && (!this.visible || document.hidden))) return;
    this.renderer.render(this.scene, this.camera);
  }

  snapshot() {
    this.render(true);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    this.disposed = true;
    this.ready = false;
    this.resizeObserver?.disconnect();
    this.visibilityObserver?.disconnect();
    this.controls?.dispose();
    this.renderer?.domElement.removeEventListener('keydown', this.onKey);
    this.renderer?.domElement.remove();
    this.assembly?.dispose();
    this.floor?.geometry.dispose();
    this.floor?.material.dispose();
    this.shadowTexture?.dispose();
    this.environment?.dispose();
    this.scene?.traverse((object) => {
      if (object.isLight) object.dispose();
    });
    this.renderer?.dispose();
  }
}
