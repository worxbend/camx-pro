import * as THREE from 'three';

export function createJoints(scene, datums) {
  const pan = new THREE.Group();
  const tilt = new THREE.Group();
  const pinion = new THREE.Group();
  const tilt_drive = new THREE.Group();
  scene.add(pan, pinion);
  pan.add(tilt, tilt_drive);
  tilt_drive.position.set(0, datums.motor_z, -datums.motor_y);
  tilt_drive.userData.ratio = datums.tilt_ratio;
  tilt.position.y = datums.tilt_axis[2];
  pinion.position.z = -datums.pan_motor_axis[1];
  const planets = {};
  datums.planet_centers.forEach(([x, y], index) => {
    const joint = new THREE.Group();
    joint.position.set(x, 0, -y);
    joint.userData.ratio = datums.planet_relative_ratio;
    pan.add(joint);
    planets['planet_' + index] = joint;
  });
  scene.updateMatrixWorld(true);
  return { pan, tilt, pinion, tilt_drive, ...planets };
}

export function setAngles(joints, pan, tilt, ratio) {
  joints.pan.rotation.y = THREE.MathUtils.degToRad(pan);
  joints.tilt.rotation.x = THREE.MathUtils.degToRad(-tilt);
  joints.tilt_drive.rotation.x = THREE.MathUtils.degToRad(-tilt * joints.tilt_drive.userData.ratio);
  for (const [name, joint] of Object.entries(joints)) {
    if (name.startsWith('planet_'))
      joint.rotation.y = THREE.MathUtils.degToRad(pan * joint.userData.ratio);
  }
  joints.pinion.rotation.y = THREE.MathUtils.degToRad(pan * ratio);
}
