import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createJoints, setAngles } from './kinematics.js';

let sourcePromise;
const shellNames = new Set([
  'base_shell',
  'base_lid',
  'yoke_cover_drive',
  'yoke_cover_passive',
  'rear_drive_cover',
  'base_service_hatch',
]);
const finishes = { graphite: '#17171b', clay: '#bb664b', lilac: '#a48ac7' };

// Share one download and parse between the two stages; each gets independent joints/materials.
async function source() {
  if (!sourcePromise) {
    sourcePromise = Promise.all([
      fetch('./downloads/manifest.json').then((response) => {
        if (!response.ok) throw new Error('Build manifest is unavailable');
        return response.json();
      }),
      new GLTFLoader().loadAsync('./downloads/assembly/camx-pro.glb'),
    ]).catch((error) => {
      sourcePromise = undefined;
      throw error;
    });
  }
  return sourcePromise;
}

export async function loadAssembly(scene) {
  const [manifest, gltf] = await source();
  const root = gltf.scene.clone(true);
  root.scale.setScalar(1000);
  scene.add(root);
  scene.updateMatrixWorld(true);
  const assembly = root.getObjectByName('CAMX_Pro');
  if (!assembly) throw new Error('Named CAD assembly missing');
  const joints = createJoints(scene, manifest.datums);
  const parts = new Map();
  for (const node of [...assembly.children]) {
    const info = manifest.parts[node.name];
    if (!info) continue;
    const holder = new THREE.Group();
    holder.name = node.name;
    scene.add(holder);
    holder.attach(node);
    scene.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(holder).getCenter(new THREE.Vector3());
    if (joints[info.group]) joints[info.group].attach(holder);
    holder.userData = { rest: holder.position.clone(), center, info };
    holder.traverse((mesh) => {
      if (!mesh.isMesh) return;
      mesh.material = new THREE.MeshStandardMaterial({
        color: info.printed ? finishes.graphite : info.color,
        roughness: info.printed ? 0.48 : 0.3,
        metalness: info.printed ? 0.12 : node.name.includes('bearing') ? 0.8 : 0.2,
        side: THREE.DoubleSide,
        envMapIntensity: 1.1,
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    parts.set(node.name, holder);
  }
  scene.remove(root);
  return {
    parts,
    update({ pan = 0, tilt = 0, mode = 'exterior', finish = 'graphite' }) {
      setAngles(joints, pan, tilt, manifest.datums.pan_ratio);
      for (const [name, part] of parts) {
        const { rest, center, info } = part.userData;
        part.position.copy(rest);
        if (mode === 'exploded') {
          if (name.startsWith('base_')) part.position.y -= 17;
          else if (info.group === 'pan')
            part.position.add(
              new THREE.Vector3(Math.sign(center.x) * Math.min(32, Math.abs(center.x)), 32, 0),
            );
          else if (info.group === 'tilt') part.position.y += 62;
          else part.position.y += 14;
        }
        part.traverse((mesh) => {
          if (!mesh.isMesh) return;
          const transparent = mode === 'xray' && shellNames.has(name);
          mesh.material.transparent = transparent;
          mesh.material.opacity = transparent ? 0.1 : 1;
          mesh.material.depthWrite = !transparent;
          mesh.castShadow = !transparent;
          if (info.printed) mesh.material.color.set(finishes[finish] || finishes.graphite);
        });
      }
    },
    dispose() {
      for (const part of parts.values())
        part.traverse((mesh) => {
          if (mesh.isMesh) mesh.material.dispose();
        });
    },
  };
}
