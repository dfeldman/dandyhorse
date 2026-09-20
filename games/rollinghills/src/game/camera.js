import * as BABYLON from '@babylonjs/core'
import { Config } from './config.js'
import { Terrain } from './terrain.js'
import { Util } from './util.js'

// Third-person chase camera: behind and above the bike, offset to one side
// (slowly swaying) so the bike reads in 3/4 view. Never dips into terrain.
const Camera = (() => {
  let cam = null;
  const pos = new BABYLON.Vector3(), target = new BABYLON.Vector3();
  let first = true, sideCur = 1, t = 0;

  function init(scene) {
    cam = new BABYLON.UniversalCamera('chase', new BABYLON.Vector3(0, 10, -20), scene);
    cam.minZ = 0.3; cam.maxZ = 3000; cam.fov = Config.CAM_FOV;
    cam.inputs.clear();
    return cam;
  }

  // sideSign: +1 / -1 picks which side the camera hangs on (alternate per lap)
  function update(pose, speed, dt, sideSign = 1) {
    t += dt;
    const back = Config.CAM_BACK + speed * 0.1;
    const sway = 0.6 + 0.4 * Math.sin(t * Math.PI * 2 / Config.CAM_SWAY_PERIOD);   // stays off-axis
    sideCur += (sideSign * Config.CAM_SIDE * sway - sideCur) * (1 - Math.exp(-dt / 3));
    const px = -pose.hz, pz = pose.hx;   // left-hand perpendicular in XZ
    const wantX = pose.x - pose.hx * back + px * sideCur, wantZ = pose.z - pose.hz * back + pz * sideCur;
    let wantY = pose.y + Config.CAM_UP + Math.max(0, -pose.grade) * 3;
    wantY = Math.max(wantY, Terrain.heightAt(wantX, wantZ) + 1.4, Config.WATER_Y + 1.4);
    const k = first ? 1 : 1 - Math.exp(-dt / Config.CAM_TAU);
    pos.x += (wantX - pos.x) * k; pos.y += (wantY - pos.y) * k; pos.z += (wantZ - pos.z) * k;
    const la = Config.CAM_LOOK_AHEAD;
    const tx = pose.x + pose.hx * la, ty = pose.y + 0.9, tz = pose.z + pose.hz * la;
    const kt = first ? 1 : 1 - Math.exp(-dt / (Config.CAM_TAU * 0.6));
    target.x += (tx - target.x) * kt; target.y += (ty - target.y) * kt; target.z += (tz - target.z) * kt;
    cam.position.copyFrom(pos);
    cam.setTarget(target);
    const wantFov = Config.CAM_FOV + Config.CAM_FOV_SPEED * Util.clamp(speed / Config.MAX_SPEED, 0, 1);
    cam.fov += (wantFov - cam.fov) * (1 - Math.exp(-dt / 0.8));
    first = false;
  }

  return { init, update, get camera() { return cam; } };
})();

export { Camera }
