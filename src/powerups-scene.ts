import * as T from 'three';
import { RED_BASIN, type Circuit } from './circuit';
import { BOX_SPOTS, type PowerupState } from './powerups';

const flat = (color: T.ColorRepresentation) => new T.MeshLambertMaterial({ color, flatShading: true });

function makeBoxTexture(): T.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f7d244';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#202b31';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 118, 118);
  ctx.strokeStyle = '#ec583b';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, 100, 100);
  ctx.fillStyle = '#202b31';
  ctx.font = '900 84px Impact, "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 64, 68);
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

const boxGeo = new T.BoxGeometry(1.45, 1.45, 1.45);
const shadowGeo = new T.CircleGeometry(0.95, 14).rotateX(-Math.PI / 2);
const shadowMat = new T.MeshBasicMaterial({ color: '#202b31', transparent: true, opacity: 0.35, depthWrite: false });

const peelGeo = new T.ConeGeometry(0.42, 0.95, 5);
const stemGeo = new T.CylinderGeometry(0.08, 0.14, 0.35, 5);
const peelMat = flat('#f7d244');
const stemMat = flat('#5c3b1e');

const shellDomeGeo = new T.CylinderGeometry(0.55, 0.85, 0.52, 6);
const shellRimGeo = new T.CylinderGeometry(0.92, 0.92, 0.16, 6);
const greenShellMat = flat('#3ec45d');
const redShellMat = flat('#ec4834');
const whiteRimMat = flat('#fff1d0');
const goldRimMat = flat('#ffd633');
const ringGeo = new T.TorusGeometry(1.05, 0.08, 6, 16);
const ringMat = new T.MeshBasicMaterial({ color: '#ffd633' });

function createBananaMesh(): T.Group {
  const g = new T.Group();
  for (let i = 0; i < 3; i++) {
    const angle = (i * Math.PI * 2) / 3;
    const petal = new T.Mesh(peelGeo, peelMat);
    petal.position.set(Math.sin(angle) * 0.34, 0.25, Math.cos(angle) * 0.34);
    petal.rotation.set(Math.cos(angle) * 0.95, 0, -Math.sin(angle) * 0.95);
    g.add(petal);
  }
  const stem = new T.Mesh(stemGeo, stemMat);
  stem.position.y = 0.72;
  g.add(stem);
  const shadow = new T.Mesh(shadowGeo, shadowMat);
  shadow.scale.set(0.75, 1, 0.75);
  shadow.position.y = 0.03;
  g.add(shadow);
  return g;
}

function createShellMesh(homing: boolean): T.Group {
  const g = new T.Group();
  const dome = new T.Mesh(shellDomeGeo, homing ? redShellMat : greenShellMat);
  dome.position.y = 0.42;
  g.add(dome);
  const rim = new T.Mesh(shellRimGeo, homing ? goldRimMat : whiteRimMat);
  rim.position.y = 0.22;
  g.add(rim);
  if (homing) {
    const ring = new T.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.48;
    g.add(ring);
  }
  const shadow = new T.Mesh(shadowGeo, shadowMat);
  shadow.scale.set(0.85, 1, 0.85);
  shadow.position.y = 0.03;
  g.add(shadow);
  return g;
}

export class PowerupScene {
  private readonly group = new T.Group();
  private readonly boxMeshes: { cube: T.Mesh; shadow: T.Mesh; basePos: T.Vector3 }[] = [];
  private readonly hazardMeshes = new Map<string, T.Group>();
  private readonly projectileMeshes = new Map<string, T.Group>();
  private readonly starColor = new T.Color();
  private track: Circuit = RED_BASIN;

  constructor(scene: T.Scene) {
    scene.add(this.group);
    const boxMat = new T.MeshLambertMaterial({ map: makeBoxTexture(), flatShading: true });
    for (let i = 0; i < BOX_SPOTS.length; i++) {
      const cube = new T.Mesh(boxGeo, boxMat);
      this.group.add(cube);

      const shadow = new T.Mesh(shadowGeo, shadowMat);
      this.group.add(shadow);

      this.boxMeshes.push({ cube, shadow, basePos: new T.Vector3() });
    }
    this.setTrack(RED_BASIN);
  }

  setTrack(track: Circuit) {
    this.track = track;
    for (let i = 0; i < BOX_SPOTS.length; i++) {
      const spot = BOX_SPOTS[i];
      const f = track.frame(spot.s);
      const mesh = this.boxMeshes[i];
      mesh.basePos.copy(track.point(spot.s, spot.lane, 1.35));
      mesh.cube.position.copy(mesh.basePos);
      mesh.shadow.position.copy(track.point(spot.s, spot.lane, 0.035));
      mesh.shadow.rotation.set(0, f.heading, Math.atan(f.bank), 'YXZ');
    }
  }

  update(
    powerups: PowerupState | undefined,
    models: Map<string, { body: T.Group; paint: T.MeshLambertMaterial; baseColor: string }>,
    menu: boolean
  ) {
    const now = performance.now() * 0.001;
    this.group.visible = !menu && !!powerups;
    if (menu || !powerups) return;

    // Item boxes
    for (let i = 0; i < this.boxMeshes.length; i++) {
      const mesh = this.boxMeshes[i];
      const active = powerups.boxes[i]?.cooldown === 0;
      mesh.cube.visible = active;
      mesh.shadow.visible = active;
      if (active) {
        mesh.cube.rotation.y = now * 1.9 + i * 0.6;
        mesh.cube.rotation.x = Math.sin(now * 2.3 + i) * 0.28;
        mesh.cube.position.y = mesh.basePos.y + Math.sin(now * 3.1 + i * 0.9) * 0.22;
      }
    }

    // Hazards (bananas)
    const seenHazards = new Set<string>();
    for (const h of powerups.hazards) {
      seenHazards.add(h.id);
      let mesh = this.hazardMeshes.get(h.id);
      if (!mesh) {
        mesh = createBananaMesh();
        this.hazardMeshes.set(h.id, mesh);
        this.group.add(mesh);
      }
      const f = this.track.frame(h.s);
      mesh.position.copy(this.track.point(h.s, h.lane, 0.02));
      mesh.rotation.set(0, f.heading, Math.atan(f.bank), 'YXZ');
    }
    for (const [id, mesh] of this.hazardMeshes) {
      if (!seenHazards.has(id)) {
        this.group.remove(mesh);
        this.hazardMeshes.delete(id);
      }
    }

    // Projectiles (shells)
    const seenProj = new Set<string>();
    for (const p of powerups.projectiles) {
      seenProj.add(p.id);
      let mesh = this.projectileMeshes.get(p.id);
      if (!mesh) {
        mesh = createShellMesh(p.kind === 'homing');
        this.projectileMeshes.set(p.id, mesh);
        this.group.add(mesh);
      }
      const f = this.track.frame(p.s);
      mesh.position.copy(this.track.point(p.s, p.lane, 0.02));
      mesh.rotation.set(0, f.heading + now * 11, Math.atan(f.bank), 'YXZ');
    }
    for (const [id, mesh] of this.projectileMeshes) {
      if (!seenProj.has(id)) {
        this.group.remove(mesh);
        this.projectileMeshes.delete(id);
      }
    }

    // Kart visual effects (star rainbow + spin-out rotation)
    for (const [id, model] of models) {
      const fx = powerups.fxOf(id);
      if (fx.star > 0) {
        this.starColor.setHSL((now * 2.2) % 1, 0.95, 0.58);
        model.paint.color.copy(this.starColor);
      } else {
        model.paint.color.set(model.baseColor);
      }
      if (fx.spin > 0) {
        model.body.rotation.y += fx.spin * Math.PI * 5.2;
      }
    }
  }
}
