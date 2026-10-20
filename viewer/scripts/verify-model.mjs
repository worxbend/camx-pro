import fs from 'node:fs';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createJoints, setAngles} from '../src/kinematics.js';

const base=process.argv[2] ? pathToFileURL(resolve(process.argv[2])+'/')
  : new URL('../public/downloads/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',base),'utf8'));
const bytes=fs.readFileSync(new URL('assembly/camx-pro.glb',base));
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const scene=new THREE.Scene();
const root=gltf.scene;
root.scale.setScalar(1000);
scene.add(root);
scene.updateMatrixWorld(true);
const assembly=root.getObjectByName('CAMX_Pro');
assert(assembly,'Named assembly missing');
const joints=createJoints(scene,manifest.datums);
const parts=new Map();
for(const node of [...assembly.children]){
  const spec=manifest.parts[node.name];
  assert(spec,`Unknown part ${node.name}`);
  const holder=new THREE.Group();
  scene.add(holder);holder.attach(node);
  if(joints[spec.group])joints[spec.group].attach(holder);
  parts.set(node.name,holder);
}
scene.remove(root);
scene.updateMatrixWorld(true);
for(const [name,part] of parts){
  const bounds=new THREE.Box3().setFromObject(part,true);
  const [a,b]=manifest.parts[name].bounds;
  const expectedMin=[a[0],a[2],-b[1]],expectedMax=[b[0],b[2],-a[1]];
  for(let i=0;i<3;i++){
    assert(Math.abs(bounds.min.getComponent(i)-expectedMin[i])<.3,`${name} min axis ${i}`);
    assert(Math.abs(bounds.max.getComponent(i)-expectedMax[i])<.3,`${name} max axis ${i}`);
  }
}
const lens=parts.get('camera_lens');
const neutral=new THREE.Box3().setFromObject(lens,true).getCenter(new THREE.Vector3());
for(const [pan,tilt] of [[160,90],[-160,-30],[90,45]]){
  const expected=neutral.clone().sub(joints.tilt.position)
    .applyAxisAngle(new THREE.Vector3(1,0,0),-tilt*Math.PI/180)
    .add(joints.tilt.position).applyAxisAngle(new THREE.Vector3(0,1,0),pan*Math.PI/180);
  setAngles(joints,pan,tilt,manifest.datums.pan_ratio);
  scene.updateMatrixWorld(true);
  const actual=new THREE.Box3().setFromObject(lens,true).getCenter(new THREE.Vector3());
  assert(actual.distanceTo(expected)<.15,'Tilt/pan pivot mismatch');
}
// The offset motor shaft follows pan and turns twice as far as the cradle.
setAngles(joints,0,0,manifest.datums.pan_ratio);
scene.updateMatrixWorld(true);
let shaftMesh;
parts.get('tilt_motor_shaft').traverse(o=>{if(o.isMesh&&!shaftMesh)shaftMesh=o;});
const vertex=new THREE.Vector3().fromBufferAttribute(shaftMesh.geometry.attributes.position,0);
const motorNeutral=shaftMesh.localToWorld(vertex.clone());
const motorAxis=joints.tilt_drive.position.clone();
for(const [pan,tilt] of [[0,45],[90,-30],[-160,90]]){
  const expected=motorNeutral.clone().sub(motorAxis)
    .applyAxisAngle(new THREE.Vector3(1,0,0),-tilt*manifest.datums.tilt_ratio*Math.PI/180)
    .add(motorAxis).applyAxisAngle(new THREE.Vector3(0,1,0),pan*Math.PI/180);
  setAngles(joints,pan,tilt,manifest.datums.pan_ratio);
  scene.updateMatrixWorld(true);
  const actual=shaftMesh.localToWorld(vertex.clone());
  assert(actual.distanceTo(expected)<.05,'Offset tilt motor gearing mismatch');
}
// Track an actual tooth vertex: planet gears orbit with the carrier and spin
// at -3 times carrier angle relative to it (-2 times in the fixed frame).
setAngles(joints,0,0,manifest.datums.pan_ratio);
scene.updateMatrixWorld(true);
for(let index=0;index<manifest.datums.planet_centers.length;index++){
  let mesh;
  parts.get('planetary_planet_'+index).traverse(o=>{if(o.isMesh&&!mesh)mesh=o;});
  const local=new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,0);
  const neutral=mesh.localToWorld(local.clone());
  const axis=joints['planet_'+index].position.clone();
  for(const angle of [37,-125,160]){
    const expected=neutral.clone().sub(axis)
      .applyAxisAngle(new THREE.Vector3(0,1,0),angle*manifest.datums.planet_relative_ratio*Math.PI/180)
      .add(axis).applyAxisAngle(new THREE.Vector3(0,1,0),angle*Math.PI/180);
    setAngles(joints,angle,0,manifest.datums.pan_ratio);scene.updateMatrixWorld(true);
    assert(mesh.localToWorld(local.clone()).distanceTo(expected)<.05,'Planet orbit/spin mismatch');
  }
  setAngles(joints,0,0,manifest.datums.pan_ratio);scene.updateMatrixWorld(true);
}
assert.equal(parts.size,Object.keys(manifest.parts).length-1);
console.log(`Verified ${parts.size} GLB components, coordinate conversion, combined-axis pivots 2:1 offset tilt drive and four planetary orbits.`);
