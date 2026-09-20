import * as BABYLON from '@babylonjs/core'
import { Biome } from '../biome.js'
import { Decor } from '../decor.js'
import { Util } from '../util.js'

// The volcano landmark: glowing crater and a smoke plume (animated).
Decor.register({
  name: 'volcano',
  build(scene, ctx) {
    const V = Biome.volcano;
    if (!V) return;
    const top = ctx.rawHeight(V.x, V.z);
    const lavaMat = new BABYLON.StandardMaterial('lavaMat', scene);
    lavaMat.diffuseColor = Util.hex('#ff7a10'); lavaMat.emissiveColor = Util.hex('#ff9a20'); lavaMat.specularColor = BABYLON.Color3.Black();
    const pool = BABYLON.MeshBuilder.CreateDisc('lava', { radius: 26, tessellation: 20 }, scene);
    pool.rotation.x = Math.PI / 2; pool.position.set(V.x, top + 0.6, V.z); pool.material = lavaMat; ctx.glow(pool);   // blooms at night
    const smoke = new BABYLON.ParticleSystem('volcanoSmoke', 600, scene);
    const t = new BABYLON.DynamicTexture('smokeTex', { width: 64, height: 64 }, scene, false);
    const c = t.getContext(); const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(120,110,120,0.6)'); g.addColorStop(1, 'rgba(120,110,120,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); t.update(); t.hasAlpha = true;
    smoke.particleTexture = t; smoke.emitter = new BABYLON.Vector3(V.x, top + 4, V.z);
    smoke.minEmitBox = new BABYLON.Vector3(-10, 0, -10); smoke.maxEmitBox = new BABYLON.Vector3(10, 2, 10);
    smoke.minSize = 14; smoke.maxSize = 26; smoke.minLifeTime = 9; smoke.maxLifeTime = 14;
    smoke.direction1 = new BABYLON.Vector3(-1.5, 7, -1.5); smoke.direction2 = new BABYLON.Vector3(1.5, 11, 1.5);
    smoke.color1 = new BABYLON.Color4(0.5, 0.45, 0.5, 0.5); smoke.color2 = new BABYLON.Color4(0.35, 0.3, 0.35, 0.5); smoke.colorDead = new BABYLON.Color4(0.6, 0.6, 0.65, 0);
    smoke.addSizeGradient(0, 0.5); smoke.addSizeGradient(1, 2.5);
    smoke.emitRate = 26; smoke.updateSpeed = 0.016; smoke.start();
    return { update(dt, tm) { lavaMat.emissiveColor.set(1, 0.55 + Math.sin(tm * 2) * 0.1, 0.1); } };
  },
});
