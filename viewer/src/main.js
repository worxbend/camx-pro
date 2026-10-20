import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {createJoints, setAngles} from './kinematics.js';

const $=id=>document.getElementById(id);
const shellNames=new Set(['base_shell','base_lid','yoke_cover_drive','yoke_cover_passive','rear_drive_cover','base_service_hatch']);
const state={pan:0,tilt:0,explode:0,mode:'exterior',hardware:true,wireframe:false};
const parts=new Map();
const scene=new THREE.Scene();
let renderer;
try {
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});
} catch(error) {
  $('scene').innerHTML='<img src="./downloads/images/three_quarter.png" alt="CAD assembly preview" style="width:100%;height:100%;object-fit:contain">';
  $('loading').textContent='3D graphics unavailable. The prototype downloads remain available.';
  $('scene-state').textContent='Static preview';
  document.querySelectorAll('input,button').forEach(element=>element.disabled=true);
  throw error;
}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setClearColor(0x000000,0);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.35;
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
$('scene').append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(32,1,.1,3000);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;
controls.minDistance=170;controls.maxDistance=850;
const pmrem=new THREE.PMREMGenerator(renderer);
const room=new RoomEnvironment();
scene.environment=pmrem.fromScene(room,.04).texture;
room.dispose();pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xe4f1de,0x263a30,2));
const key=new THREE.DirectionalLight(0xffffff,4);
key.position.set(-180,300,250);key.castShadow=true;
key.shadow.mapSize.set(2048,2048);
Object.assign(key.shadow.camera,{left:-160,right:160,top:200,bottom:-160,near:1,far:900});
key.shadow.normalBias=.4;scene.add(key);
const rim=new THREE.DirectionalLight(0xc7dfbf,3);rim.position.set(190,190,-150);scene.add(rim);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(1400,1400),new THREE.ShadowMaterial({opacity:.35}));
floor.rotation.x=-Math.PI/2;floor.position.y=-.3;floor.receiveShadow=true;scene.add(floor);
let joints;
let manifest,ready=false;

function view(name='perspective'){
  const actuator=state.mode==='actuator';
  const target=new THREE.Vector3(0,actuator?33:82,0);
  const positions={perspective:[245,180,290],front:[0,105,390],side:[390,110,0],rear:[0,130,-390],top:[0,470,.01]};
  camera.position.fromArray(actuator&&name==='perspective'?[155,150,195]:(positions[name]||positions.perspective));
  controls.target.copy(target);controls.update();
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===name));
}
function resize(){const {clientWidth:w,clientHeight:h}=$('scene');renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe($('scene'));
function update(){
  if(!ready)return;
  setAngles(joints,state.pan,state.tilt,manifest.datums.pan_ratio);
  for(const [name,part] of parts){
    part.position.copy(part.userData.rest);
    const group=manifest.parts[name].group;
    const delta=state.explode/100;
    if(delta){
      const x=part.userData.center.x;
      if(name.startsWith('base_'))part.position.y-=delta*25;
      else if(group==='pan')part.position.add(new THREE.Vector3(Math.sign(x)*Math.min(45,Math.abs(x)),45,0).multiplyScalar(delta));
      else if(group==='tilt')part.position.add(new THREE.Vector3(0,90,0).multiplyScalar(delta));
      else part.position.y+=delta*20;
    }
    const info=manifest.parts[name];
    const actuatorVisible=(name.startsWith('planetary_')&&name!=='planetary_carrier_upper')||name.startsWith('planet_')||name.startsWith('pan_motor');
    part.visible=(state.mode!=='actuator'||actuatorVisible)&&!part.userData.hidden&&(state.hardware||info.printed)&&!(state.mode==='mechanism'&&shellNames.has(name));
    part.traverse(o=>{if(!o.isMesh)return;o.material.wireframe=state.wireframe;
      o.material.transparent=state.mode==='cutaway'&&shellNames.has(name);
      o.material.opacity=o.material.transparent?.12:1;o.material.depthWrite=!o.material.transparent;});
  }
  for(const id of ['pan','tilt','explode'])$(id+'-value').textContent=state[id]+(id==='explode'?'%':'°');
}

for(const id of ['pan','tilt','explode'])$(id).addEventListener('input',()=>{state[id]=Number($(id).value);update();});
for(const id of ['hardware','wireframe'])$(id).addEventListener('change',()=>{state[id]=$(id).checked;update();});
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('selected',x===b));view();update();});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>view(b.dataset.view));
$('reset').onclick=()=>{for(const id of ['pan','tilt','explode']){$(id).value=0;state[id]=0;}view();update();};
view();resize();
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});

try{
  const response=await fetch('./downloads/manifest.json');
  if(!response.ok)throw new Error('Build manifest is unavailable');
  manifest=await response.json();
  const baseBounds=manifest.parts.base_lid.bounds;
  $('footprint').textContent=`${(baseBounds[1][0]-baseBounds[0][0]).toFixed(1)} × ${(baseBounds[1][1]-baseBounds[0][1]).toFixed(1)} mm`;
  $('ratio').textContent=`${manifest.datums.pan_ratio}:1 · planetary`;
  $('part-count').textContent=Object.values(manifest.parts).filter(p=>p.printed).length+' PARTS';
  joints=createJoints(scene,manifest.datums);
  for(const axis of ['pan','tilt']){
    $(axis).min=manifest.datums.limits[axis][0];$(axis).max=manifest.datums.limits[axis][1];
  }
  const {scene:root}=await new GLTFLoader().loadAsync('./downloads/assembly/camx-pro.glb');
  root.scale.setScalar(1000);scene.add(root);scene.updateMatrixWorld(true);
  const assembly=root.getObjectByName('CAMX_Pro');
  if(!assembly)throw new Error('Named CAD assembly missing');
  for(const node of [...assembly.children]){
    const info=manifest.parts[node.name];if(!info)continue;
    const holder=new THREE.Group();holder.name=node.name;scene.add(holder);holder.attach(node);scene.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(holder);holder.userData.center=box.getCenter(new THREE.Vector3());
    if(joints[info.group])joints[info.group].attach(holder);
    holder.userData.rest=holder.position.clone();holder.userData.hidden=false;
    holder.traverse(o=>{if(!o.isMesh)return;o.material=new THREE.MeshStandardMaterial({
      color:info.color,roughness:info.printed?.54:.32,metalness:info.printed?.08:node.name.includes('bearing')?.8:.2,
      side:THREE.DoubleSide,envMapIntensity:1.3});o.castShadow=true;o.receiveShadow=true;});
    parts.set(node.name,holder);
    if(info.printed){
      const label=document.createElement('label');label.className='part-item';
      const check=document.createElement('input');check.type='checkbox';check.checked=true;
      check.onchange=()=>{holder.userData.hidden=!check.checked;update();};
      const title=document.createElement('span');title.textContent=node.name.replaceAll('_',' ');
      const tag=document.createElement('span');tag.textContent=manifest.parameters.printer.material;
      label.append(check,title,tag);$('part-list').append(label);
    }
  }
  scene.remove(root);ready=true;update();
  $('loading').style.display='none';$('scene-state').textContent=`REV ${manifest.revision.toUpperCase()}`;
  window.camx={state,parts,manifest,view,update,ready:true,renderer};
}catch(error){$('loading').textContent=error.message;$('scene-state').textContent='Build not loaded';console.error(error);}
