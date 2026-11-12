/**
 * Interactive archive array stage, adapted from RhineLabUI `src/scene.ts`
 * motion, lighting, camera and cassette geometry
 * (MIT, Copyright (c) 2026 LBEILC). See LICENSE-RHINE-REFERENCE.txt.
 *
 * This module is a namespaced operator-board port: no playground HUD,
 * no official logos, and no printed Rhine titles on the cassettes.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createArchiveLighting } from "./lighting";
import { InstanceUpdates } from "./instance-updates";
import { disposeThreeTree } from "./three-resources";
import { archiveFraming } from "./framing";
import { ArchiveVisibility } from "./visibility";
import {
  COLUMN_SPACING,
  LOOP_COLUMNS,
  LOOP_ROWS,
  ROW_SPACING,
  cellKey,
  sameCell,
  type ArchiveCell,
} from "./loop";
import {
  INSPECTION_LIFT,
  baselineSelectionWave,
  columnStrength,
  damp,
  idleWave,
  settlingWave,
  type Spring,
} from "./motion";

const ease = (t: number) => {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

const SHELL = new Set([
  "Frosted_Polymer",
  "Ivory_Edges",
  "Titanium_Fasteners",
  "Index_Inlay",
  "Optical_Diffuser",
]);

export type ArchiveStageMode = "browse" | "detail";

export class ArchiveStageScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 5, 300);
  private light: THREE.DirectionalLight;
  private instances: THREE.InstancedMesh[] = [];
  private matrixUpdates?: InstanceUpdates;
  private visibility = new ArchiveVisibility();
  private instanceCapacity = LOOP_COLUMNS * LOOP_ROWS;
  private model = new THREE.Group();
  private dummy = new THREE.Object3D();
  private cells: ArchiveCell[] = [];
  private selectedCell: ArchiveCell = { lane: 2, row: 12 };
  private lift: Spring = { value: 0, velocity: 0 };
  private rail: Spring = { value: 0, velocity: 0 };
  private shoulder: Spring = { value: 12, velocity: 0 };
  private laneFocus: Spring = { value: 2, velocity: 0 };
  private columnCamera: Spring = { value: 0, velocity: 0 };
  private pulses: { row: number; lane: number; time: number }[] = [];
  private detail = 0;
  private targetDetail = 0;
  private reveal = 0;
  private targetReveal = 1;
  private last = 0;
  private clock = 0;
  private lastInteraction = 0;
  private idleGain = 0;
  private pulseGain = 1;
  private cameraAim = new THREE.Vector3();
  private loaded = false;
  private reduced = false;
  private running = false;
  private wantRunning = true;
  private raf = 0;
  private resizeObserver?: ResizeObserver;
  private onVisible?: () => void;
  failed = false;
  onDetailVisibility?: (value: number) => void;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = "ob-archive-canvas";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color("#eae5e1");
    this.scene.fog = new THREE.Fog("#eae5e1", 22, 47);
    this.light = createArchiveLighting(this.renderer, this.scene, "baseline");
    this.light.castShadow = true;
    Object.assign(this.light.shadow.camera, {
      left: -16,
      right: 16,
      top: 15,
      bottom: -15,
      near: 0.1,
      far: 45,
    });
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.normalBias = 0.035;
    this.light.shadow.bias = -0.0003;
    this.light.shadow.radius = 4;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: "#d8c9b9", roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.name = "archive-floor";
    floor.position.y = -4.63;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.camera.position.set(-62.26, 35.98, 43.28);
    this.cameraAim.set(-0.5, 1.1, 0.4);
    this.camera.fov = 6.15;
    this.camera.lookAt(this.cameraAim);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  async load(assetUrl = "/assets/archive-cassette.glb") {
    try {
      const gltf = await new GLTFLoader().loadAsync(assetUrl);
      gltf.scene.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse((object) => {
        if (object instanceof THREE.Mesh) meshes.push(object);
      });
      const count = this.instanceCapacity;
      for (const mesh of meshes) {
        const geom = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        const source = mesh.material as THREE.MeshStandardMaterial;
        const name = source.name.replace(/\.\d+$/, "");
        // Skip printed typography so official titles never appear on the stage.
        if (name === "Carbon_Ink") continue;
        const mat = source.clone() as THREE.MeshPhysicalMaterial;
        mat.envMapIntensity = 0.6;
        this.styleMaterial(name, mat, false);
        const selectedMesh = new THREE.Mesh(geom, mat);
        selectedMesh.userData.surface = name;
        selectedMesh.castShadow = name === "Optical_Diffuser";
        selectedMesh.receiveShadow = true;
        this.model.add(selectedMesh);
        if (!SHELL.has(name)) continue;
        const arrayMat = mat.clone();
        this.styleMaterial(name, arrayMat, true);
        const inst = new THREE.InstancedMesh(geom, arrayMat, count);
        inst.instanceMatrix = this.instances[0]?.instanceMatrix ?? inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        inst.castShadow = name === "Optical_Diffuser";
        inst.receiveShadow = true;
        inst.frustumCulled = false;
        this.instances.push(inst);
        this.scene.add(inst);
      }
      if (this.instances[0]) {
        this.matrixUpdates = new InstanceUpdates(this.instances[0].instanceMatrix);
      }
      this.scene.add(this.model);
      this.model.position.copy(this.cellPosition(this.selectedCell));
      this.loaded = true;
      this.resize();
      this.update(this.clock || 0.016);
    } catch (error) {
      this.failed = true;
      this.container.dataset.archiveFailed = "true";
      console.warn("Archive stage failed to load cassette geometry.", error);
    }
  }

  private styleMaterial(name: string, mat: THREE.MeshPhysicalMaterial, array: boolean) {
    if (name === "Frosted_Polymer") {
      mat.color.set(array ? "#fff7ed" : "#fffdfa");
      mat.transmission = array ? 0.78 : 0.9;
      mat.thickness = 0.12;
      mat.roughness = array ? 0.28 : 0.21;
      mat.ior = 1.46;
      mat.attenuationColor = new THREE.Color("#eee6df");
      mat.attenuationDistance = 2;
      mat.transparent = false;
      mat.clearcoat = array ? 0.3 : mat.clearcoat;
      mat.clearcoatRoughness = array ? 0.25 : mat.clearcoatRoughness;
      if (array) {
        mat.onBeforeCompile = (shader) => {
          shader.vertexShader = "varying float vPanelHeight;\n" + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvPanelHeight = position.y / 3.7;",
          );
          shader.fragmentShader = "varying float vPanelHeight;\n" + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <color_fragment>",
            "#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(0.40, 0.30, 0.20), vec3(1.0, 0.98, 0.94), smoothstep(0.1, 1.0, vPanelHeight));",
          );
        };
      }
    }
    if (name === "Internal_Ceramic") {
      mat.color.set("#c7beb6");
      mat.roughness = 0.6;
    }
    if (name === "Printed_Label") mat.color.set("#eae5dc");
    if (name === "Ivory_Edges") {
      mat.color.set(array ? "#fff5e9" : "#f0e7df");
      mat.roughness = array ? 0.38 : 0.31;
      mat.transmission = array ? 0 : 0.65;
      mat.thickness = 0.04;
    }
    if (name === "Optical_Diffuser") {
      mat.color.set(array ? "#806447" : "#e2dad4");
      mat.transmission = 0;
      mat.roughness = array ? mat.roughness : 0.7;
    }
    if (name === "Subsurface_Optics") {
      mat.color.set("#b9aba1");
      mat.roughness = 0.48;
      mat.metalness = 0.05;
    }
    if (name === "Optical_Edges") {
      mat.transmission = 0;
      mat.color.set("#d4c7be");
      mat.roughness = 0.26;
      mat.metalness = 0.08;
    }
    if (name === "Index_Inlay") {
      mat.color.set("#e4d6c5");
      mat.metalness = 0.05;
    }
  }

  setReduced(value: boolean) {
    this.reduced = value;
    if (value) {
      this.pulses = [];
      this.idleGain = 0;
      this.lift.velocity = 0;
      this.rail.velocity = 0;
      this.shoulder.velocity = 0;
      this.laneFocus.velocity = 0;
      this.columnCamera.velocity = 0;
    }
  }

  setMode(mode: ArchiveStageMode, immediate = false) {
    this.targetReveal = 1;
    this.targetDetail = mode === "detail" ? 1 : 0;
    this.lastInteraction = this.clock;
    if (immediate || this.reduced) {
      this.detail = this.targetDetail;
      this.lift.value = this.targetDetail ? INSPECTION_LIFT : 0.4;
      this.lift.velocity = 0;
      if (this.loaded) this.update(this.clock || 0.016);
    }
  }

  selectCell(cell: ArchiveCell, pulse = true) {
    const changed = !sameCell(cell, this.selectedCell);
    this.selectedCell = { ...cell };
    this.lastInteraction = this.clock;
    if (changed && pulse && !this.reduced) this.emitPulse(this.selectedCell);
  }

  private emitPulse(cell: ArchiveCell) {
    this.pulses.push({ ...cell, time: this.clock });
    this.pulses = this.pulses.slice(-6);
  }

  private cellPosition(cell: ArchiveCell) {
    return new THREE.Vector3(
      (cell.lane - 2) * COLUMN_SPACING,
      -4.6,
      (cell.row - 15.5) * ROW_SPACING,
    );
  }

  get detailVisibility() {
    return ease((this.detail - 0.25) / 0.55);
  }

  setPaused(paused: boolean) {
    this.wantRunning = !paused;
    if (paused) {
      this.pauseLoop();
      return;
    }
    if (this.loaded && !this.failed) {
      if (!this.running) this.start();
      else this.resumeLoop();
    }
  }

  start() {
    if (this.running || this.failed || !this.wantRunning) return;
    this.running = true;
    const onVisible = () => {
      if (document.hidden) this.pauseLoop();
      else this.resumeLoop();
    };
    this.onVisible = onVisible;
    document.addEventListener("visibilitychange", onVisible);
    this.resumeLoop();
  }

  private resumeLoop() {
    if (!this.running || document.hidden) return;
    cancelAnimationFrame(this.raf);
    this.last = 0;
    const loop = (stamp: number) => {
      if (!this.running || document.hidden) return;
      this.update(stamp / 1000);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private pauseLoop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.last = 0;
  }

  stop() {
    this.running = false;
    this.pauseLoop();
    if (this.onVisible) document.removeEventListener("visibilitychange", this.onVisible);
    this.onVisible = undefined;
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private ensureInstanceCapacity(required: number) {
    if (required <= this.instanceCapacity || !this.instances[0]) return;
    const capacity = Math.max(required, this.instanceCapacity * 2);
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16).setUsage(
      THREE.DynamicDrawUsage,
    );
    matrix.array.set(this.instances[0].instanceMatrix.array);
    for (const inst of this.instances) {
      inst.dispose();
      inst.instanceMatrix = matrix;
    }
    this.matrixUpdates = new InstanceUpdates(matrix);
    this.instanceCapacity = capacity;
  }

  update(time: number) {
    const elapsed = this.last ? Math.max(0, time - this.last) : 0.016;
    const dt = Math.min(elapsed, 0.05);
    this.last = time;
    this.clock = time;
    if (!this.loaded || this.instances.length === 0) return;

    const moveRate = this.reduced ? 35 : 2.8;
    const blend = 1 - Math.exp(-dt * moveRate);
    const detailBlend = 1 - Math.exp(-dt * (this.reduced ? 35 : 2.8));
    this.reveal = THREE.MathUtils.lerp(this.reveal, this.targetReveal, this.reduced ? 1 : blend);

    const chosen = this.cellPosition(this.selectedCell);
    const selectedRow = this.selectedCell.row;
    const selectedLane = this.selectedCell.lane;
    damp(this.shoulder, selectedRow, this.reduced ? 35 : 5, dt);
    damp(this.laneFocus, selectedLane, this.reduced ? 35 : 4, dt);
    damp(this.columnCamera, chosen.x, this.reduced ? 35 : 3.7, dt);
    damp(this.rail, -2.17 - chosen.z, this.reduced ? 35 : 3.7, dt);
    const trackX = this.columnCamera.value;
    this.pulses = this.pulses.filter((pulse) => time - pulse.time < 3.2);

    const idle =
      !this.reduced &&
      this.targetReveal > 0 &&
      !this.targetDetail &&
      this.detail < 0.01 &&
      time - this.lastInteraction > 2.5;
    this.idleGain = THREE.MathUtils.lerp(
      this.idleGain,
      idle ? 1 : 0,
      1 - Math.exp(-dt * (idle ? 0.8 : 4)),
    );
    this.pulseGain = THREE.MathUtils.lerp(
      this.pulseGain,
      this.targetDetail ? 0 : 1,
      1 - Math.exp(-dt * (this.reduced ? 35 : 8)),
    );

    const fieldCache = new Map<number, Map<number, number>>();
    const calculateField = (row: number, lane: number) => {
      const breathing = this.reduced ? 0 : idleWave(row, lane, time) * this.idleGain;
      let pulseHeight = 0;
      if (!this.reduced) {
        let ripple = 0;
        for (const pulse of this.pulses) {
          const distance = Math.hypot(row - pulse.row, (lane - pulse.lane) * 2.2);
          ripple += baselineSelectionWave(distance, time - pulse.time);
        }
        pulseHeight = THREE.MathUtils.clamp(ripple, -0.6, 0.6) * this.pulseGain;
      }
      const distance = row - this.shoulder.value;
      return settlingWave(distance, 26.56) * columnStrength(lane, this.laneFocus.value) + breathing + pulseHeight;
    };
    const field = (row: number, lane: number): number => {
      let values = fieldCache.get(lane);
      if (!values) {
        values = new Map();
        fieldCache.set(lane, values);
      }
      const previous = values.get(row);
      if (previous !== undefined) return previous;
      const value = calculateField(row, lane);
      values.set(row, value);
      return value;
    };

    damp(
      this.lift,
      this.targetDetail ? INSPECTION_LIFT : 0.4 * this.targetReveal,
      this.reduced ? 35 : 4.2,
      dt,
    );
    const cameraTarget = this.targetDetail
      ? ease((this.lift.value - 0.8) / 2.4)
      : ease((this.lift.value - 0.4) / (INSPECTION_LIFT - 0.4));
    this.detail = THREE.MathUtils.lerp(this.detail, cameraTarget, detailBlend);
    const detail = this.detail;
    const entryZ = -28 * (1 - this.reveal);

    this.model.position.set(
      chosen.x - trackX,
      chosen.y + field(selectedRow, selectedLane) + this.lift.value,
      chosen.z + entryZ + this.rail.value,
    );
    this.model.rotation.set(
      (field(selectedRow + 0.5, selectedLane) - field(selectedRow - 0.5, selectedLane)) *
        0.024 *
        (1 - detail) *
        (1 - ease(this.lift.value / 0.4)),
      0,
      0,
    );

    const orbit = 1;
    const settle = 1;
    const yaw = THREE.MathUtils.degToRad(89 - 22 * orbit - 8 * settle);
    const elevation = THREE.MathUtils.degToRad(3 + 40 - 8 * orbit - 16 * settle);
    const span = 7.33;
    const distance = THREE.MathUtils.lerp(140, 72, detail);
    const arrayAim = new THREE.Vector3(-1.091, -0.045, 0.481);
    const cameraAim = arrayAim.clone();
    const viewDirection = new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(elevation),
      Math.sin(elevation),
      Math.cos(yaw) * Math.cos(elevation),
    );
    viewDirection.lerp(new THREE.Vector3(-0.277, 0.238, 0.931), detail).normalize();

    const width = this.container.clientWidth;
    const height = Math.max(1, this.container.clientHeight);
    const framing = archiveFraming(width, height, span, detail, width < 1100);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDirection).normalize();
    const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
    const pixelScale = height / framing.span;
    if (framing.portrait) {
      const previewAim = new THREE.Vector3(0, -4.6 + settlingWave(0, 26.56) + 0.4 + 1.85, -2.17);
      previewAim.addScaledVector(up, (framing.previewY - 0.5) * height / pixelScale);
      cameraAim.copy(previewAim);
    }
    const detailAim = this.model.position.clone().add(new THREE.Vector3(0, 1.85, 0));
    detailAim.addScaledVector(right, (0.5 - framing.detailX) * width / pixelScale);
    detailAim.addScaledVector(up, (framing.detailY - 0.5) * height / pixelScale);
    cameraAim.lerp(detailAim, detail);

    const cameraPosition = cameraAim.clone().addScaledVector(viewDirection, distance);
    const cameraBlend = this.reduced ? 1 : 1 - Math.exp(-dt * 5);
    this.camera.position.lerp(cameraPosition, cameraBlend);
    this.cameraAim.lerp(cameraAim, cameraBlend);
    this.camera.lookAt(this.cameraAim);
    this.camera.fov = THREE.MathUtils.lerp(
      this.camera.fov,
      THREE.MathUtils.radToDeg(2 * Math.atan(framing.span / (2 * distance))),
      cameraBlend,
    );
    const fog = this.scene.fog as THREE.Fog;
    const renderedDistance = this.camera.position.distanceTo(this.cameraAim);
    fog.near = renderedDistance + THREE.MathUtils.lerp(5, -1, detail);
    fog.far = renderedDistance + THREE.MathUtils.lerp(25, 12, detail);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    this.cells = this.visibility.update(
      this.camera,
      fog.far,
      trackX,
      entryZ + this.rail.value,
      false,
    );
    const hidden = new Set([cellKey(this.selectedCell)]);
    const drawn: ArchiveCell[] = [];
    this.matrixUpdates ??= new InstanceUpdates(this.instances[0].instanceMatrix);
    for (const cell of this.cells) {
      if (hidden.has(cellKey(cell))) continue;
      const x = (cell.lane - 2) * COLUMN_SPACING - trackX;
      const y = -4.6 + field(cell.row, cell.lane);
      const z = (cell.row - 15.5) * ROW_SPACING + entryZ + this.rail.value;
      if (!this.visibility.intersects(x, y, z)) continue;
      const slope = field(cell.row + 0.5, cell.lane) - field(cell.row - 0.5, cell.lane);
      this.dummy.position.set(x, y, z);
      this.dummy.rotation.set(slope * 0.024 * (1 - detail), 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      const i = drawn.length;
      this.ensureInstanceCapacity(i + 1);
      drawn.push(cell);
      this.matrixUpdates.set(i * 16, this.dummy.matrix.elements);
    }
    this.matrixUpdates.commit();
    for (const inst of this.instances) inst.count = drawn.length;
    if (this.instances[0]) this.instances[0].computeBoundingSphere();

    this.light.shadow.needsUpdate = true;
    this.scene.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    this.onDetailVisibility?.(this.detailVisibility);
  }

  dispose() {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    disposeThreeTree(this.scene);
    this.model.clear();
    this.instances = [];
    this.light.shadow.map?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.loaded = false;
  }
}
