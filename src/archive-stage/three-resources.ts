/**
 * Three.js disposal helpers, adapted from RhineLabUI `src/three-resources.ts`
 * (MIT, Copyright (c) 2026 LBEILC). See LICENSE-RHINE-REFERENCE.txt.
 */
import * as THREE from "three";

export function disposeThreeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object instanceof THREE.InstancedMesh) object.dispose();
    geometries.add(object.geometry);
    const raw = object.material;
    const list = Array.isArray(raw) ? raw : [raw];
    for (const material of list) {
      if (material instanceof THREE.Material) materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    material.dispose();
  }
  if (root instanceof THREE.Scene) {
    if (root.environment) textures.add(root.environment);
    if (root.background instanceof THREE.Texture) textures.add(root.background);
  }
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  root.clear();
}
