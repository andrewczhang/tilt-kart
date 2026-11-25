import * as T from 'three';
import { Atmosphere } from './atmosphere';
import { COLORS, RED_BASIN, SAMPLES, inSection, type Circuit } from './circuit';
import { PAD_LENGTH, PAD_WIDTH, type Pose } from './drive';
import type { PowerupState } from './powerups';
import { PowerupScene } from './powerups-scene';
import { KartEffects } from './effects';
import { themedScenery } from './track-art';
import { landmarks } from './track-landmarks';
import { TRACK_IDS } from './tracks';

const flat = (color: T.ColorRepresentation) => new T.MeshLambertMaterial({ color, flatShading: true });
const white = flat('#f7e6c9'), coral = flat('#e94d30'), navy = flat('#222b36');
const tire = flat('#1d232b'), alloy = flat('#bcc7bb');
const box = new T.BoxGeometry();
const wheel = new T.CylinderGeometry(.39, .39, .32, 10).rotateZ(Math.PI / 2);
const helmet = new T.IcosahedronGeometry(.38, 1);
const shadow = new T.CircleGeometry(1, 20).rotateX(-Math.PI / 2);

function block(parent: T.Object3D, material: T.Material, x: number, y: number, z: number, w: number, h: number, d: number, geometry: T.BufferGeometry = box) {
  const mesh = new T.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(w, h, d);
  parent.add(mesh);
  return mesh;
}

type Strip = [(s: number) => T.Vector3, (s: number) => T.Vector3,
  T.ColorRepresentation | ((i: number, s: number) => T.ColorRepresentation), ((s: number) => boolean)?];
function strips(defs: Strip[], segments = SAMPLES, start = 0, end = 1, cuts: number[] = []) {
  const vertices: number[] = [], colors: number[] = [];
  const c = new T.Color();
  const samples = Array.from(new Set([...Array.from({ length: segments + 1 }, (_, i) => start + (end - start) * i / segments), ...cuts])).sort((a, b) => a - b);
  for (const [a, b, color, include] of defs) {
    for (let i = 0; i < samples.length - 1; i++) {
      const s = samples[i], e = samples[i + 1], mid = (s + e) / 2;
      if (include && !include(mid)) continue;
      const a0 = a(s), a1 = a(e), b0 = b(s), b1 = b(e);
      c.set(typeof color === 'function' ? color(i, mid) : color);
      for (const v of [a0, a1, b0, b0, a1, b1]) {
        vertices.push(v.x, v.y, v.z);
        colors.push(c.r, c.g, c.b);
      }
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new T.Mesh(geo, new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide, flatShading: true }));
}

function circuit(scene: T.Group, track: Circuit) {
  const { frame, point } = track;
  const edge = track.width / 2;
  const at = (lane: number, h = 0) => (s: number) => point(s, lane, h);
  const road = (side: number, inset = 0, h = 0) => (s: number) => point(s, side * (track.widthAt(s) / 2 + inset), h);
  const grounded = (s: number) => !track.gapAt(s);
  const sections = [...(track.jumps ?? []), ...(track.surfaces ?? []), ...(track.branch ? [track.branch] : [])];
  const cuts = sections.flatMap(({start, end}) => [start, end]);
  const surfaceColor = (s: number, edge: boolean) => track.surfaces?.find(zone => inSection(s, zone) && (!zone.edge || edge))?.color ?? track.road;
  const defs: Strip[] = [
    [road(-1, 0, -.60), road(1, 0, -.60), track.wall, grounded],
    [road(-1, 0, -.60), road(-1), track.wall, grounded],
    [road(1), road(1, 0, -.60), track.wall, grounded],
    [road(-1, -track.width * .19), road(1, -track.width * .19), (_, s) => surfaceColor(s, false), grounded],
    [road(-1), road(-1, -track.width * .19), (_, s) => surfaceColor(s, true), grounded],
    [road(1, -track.width * .19), road(1), (_, s) => surfaceColor(s, true), grounded],
    ...[-1, 1].flatMap((sign): Strip[] => {
      const barrier = (s: number) => {
        const b = track.branchAt(s);
        return grounded(s) && !(b?.side === sign && Math.abs(b.center) - b.width / 2 < track.widthAt(s) / 2 + .65);
      };
      return [
        [road(sign, -.73, .022), road(sign, 0, .022), i => (i >> 1) % 2 ? track.trim : track.curb, barrier],
        [road(sign, 0, 1.02), road(sign, .32, 1.02), track.trim, barrier],
        [road(sign, 0, .25), road(sign, 0, 1.02), i => (i >> 3) % 2 ? track.curb : track.trim, barrier],
        [road(sign, .32, 1.02), road(sign, .32), track.wall, barrier],
        [road(sign, 0, .03), road(sign, 0, .25), '#30333d', barrier]
      ];
    })
  ];
  if (track.branch) {
    const { side, color } = track.branch;
    const branchEdge = (outer: boolean, h = 0) => (s: number) => {
      const b = track.branchAt(s), edge = track.widthAt(s) / 2;
      return point(s, side * (b ? Math.max(edge, Math.abs(b.center) + (outer ? 1 : -1) * b.width / 2) : edge), h);
    };
    const branch = (s: number) => Boolean(track.branchAt(s));
    const spurRail = (s: number) => {
      const b = track.branchAt(s);
      return Boolean(b && Math.abs(b.center) + b.width / 2 > track.widthAt(s) / 2 + .45);
    };
    defs.push([branchEdge(false), branchEdge(true), color, branch],
      [branchEdge(true, -.6), branchEdge(true), track.wall, branch],
      [branchEdge(false, -.6), branchEdge(false), track.wall, branch],
      [branchEdge(true, .04), branchEdge(true, .75), (_, s) => Math.floor(s * 175) % 2 ? track.trim : track.wall, spurRail]);
  }
  scene.add(strips(defs, SAMPLES, 0, 1, cuts));
  const line: Strip[] = Array.from({ length: 16 }, (_, i) => [at(-edge + i * track.width / 16, .032), at(-edge + (i + 1) * track.width / 16, .032), row => (row + i) % 2 ? '#242b32' : track.trim]);
  scene.add(strips(line, 2, -.0014, .0014));
  const stripeStations = Array.from({length: 145}, (_, i) => (i + .5) / 145).filter(grounded);
  const marks = new T.InstancedMesh(box, white, stripeStations.length);
  const o = new T.Object3D();
  for (let i = 0; i < marks.count; i++) {
    const s = stripeStations[i], f = frame(s);
    o.position.copy(point(s, 0, .014));
    o.rotation.set(0, f.heading, -f.bank);
    o.scale.set(.095, .024, 1.1);
    o.updateMatrix();
    marks.setMatrixAt(i, o.matrix);
  }
  scene.add(marks);
  const padMaterial = track.id === 'switchyard' || track.id === 'cinder' ? new T.MeshBasicMaterial({ color: track.pad }) : flat(track.pad);
  for (const pad of track.pads) {
    const f = frame(pad.s);
    const g = new T.Group();
    g.position.copy(point(pad.s, pad.lane, .044));
    g.rotation.set(0, f.heading, Math.atan(f.bank), 'YXZ');
    block(g, padMaterial, 0, 0, 0, PAD_WIDTH, .04, PAD_LENGTH);
    for (let i = -1; i <= 1; i++) {
      block(g, white, -.56, .033, i * 1.2, 1.35, .03, .2).rotation.y = -.45;
      block(g, white, .56, .033, i * 1.2, 1.35, .03, .2).rotation.y = .45;
    }
    scene.add(g);
  }
  const arch = new T.Group();
  arch.position.copy(point(0));
  arch.rotation.y = frame(0).heading;
  const paint = flat(track.curb);
  const beamHeight = 9.6;
  for (const x of [-edge - .5, edge + .5]) {
    block(arch, navy, x, 4.4, 0, .7, beamHeight, .75);
    block(arch, paint, x, 4.5, -.41, .3, 8.3, .13);
  }
  block(arch, navy, 0, beamHeight, 0, track.width + 1.8, 2.1, .9);
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = track.sign[0]; ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = track.sign[1]; ctx.font = 'italic 900 84px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(`${track.name.toUpperCase()}   /   ${String(TRACK_IDS.indexOf(track.id) + 1).padStart(2, '0')}`, 512, 94, 956);
  const tex = new T.CanvasTexture(canvas); tex.colorSpace = T.SRGBColorSpace;
  const sign = new T.Mesh(new T.PlaneGeometry(track.width + .5, 1.72), new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide }));
  sign.position.set(0, beamHeight, -.46); sign.rotation.y = Math.PI; arch.add(sign);
  scene.add(arch);
}

function kart(color: string, ghostColor?: string) {
  const root = new T.Group(), body = new T.Group();
  root.add(body);
  const paint = flat(color);
  const under = new T.Mesh(shadow, new T.MeshBasicMaterial({ color: '#262228', transparent: true, opacity: .43, depthWrite: false }));
  under.scale.set(1.44, 1, 2.12); under.position.y = .034; root.add(under);
  block(body, tire, 0, .34, 0, 1.7, .35, 2.53);
  block(body, paint, 0, .56, .82, 1.58, .38, 1.16);
  block(body, white, 0, .76, .87, .32, .022, 1.03);
  block(body, navy, 0, .54, -1.27, 1.87, .23, .22);
  block(body, paint, 0, .82, -1.04, 1.76, .17, .42);
  block(body, navy, 0, .67, -.34, .88, .57, .68);
  block(body, paint, 0, 1.22, -.31, 1, 1, 1, helmet);
  block(body, navy, 0, 1.26, -.01, .6, .19, .16);
  for (const x of [-1, 1]) {
    block(body, paint, x * .85, .48, -.26, .29, .3, 1.0);
    block(body, coral, x * .63, .65, -1.27, .27, .15, .08);
    for (const z of [-.93, .89]) {
      block(body, tire, x * 1.0, .42, z, 1.06, 1.08, 1.08, wheel);
      block(body, alloy, x * 1.17, .42, z, .11, .50, .50, wheel);
    }
  }
  const flame = block(body, new T.MeshBasicMaterial({ color: '#ffb83d' }), 0, .5, -1.59, .38, .23, .55);
  flame.visible = false;
  const ghost = ghostColor ? new T.MeshBasicMaterial({ color: ghostColor, opacity: .38, transparent: true, depthWrite: false }) : undefined;
  if (ghost) {
    under.visible = false;
    for (const mesh of body.children) if (mesh instanceof T.Mesh && mesh !== flame) mesh.material = ghost;
  }
  return { root, body, flame, paint, under, ghost, baseColor: color };
}

export type Actor = { id: string; name: string; slot: number; pose: Pose; ghostColor?: string };

export class View {
  private readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(58, 1, .15, 560);
  private readonly models = new Map<string, ReturnType<typeof kart>>();
  private followDistance = 10.5;
  private readonly labels = new Map<string, HTMLSpanElement>();
  private world?: T.Group;
  private atmosphere?: Atmosphere;
  private readonly effects = new KartEffects(this.scene);
  private track = RED_BASIN;
  private resetCamera = false;
  private readonly powerupScene: PowerupScene;
  constructor(private readonly canvas: HTMLCanvasElement, private readonly labelLayer: HTMLElement) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.powerupScene = new PowerupScene(this.scene);
    this.setTrack(RED_BASIN);
  }
  resetEffects() { this.effects.reset(); }
  setTrack(track: Circuit) {
    if (this.world && track.id === this.track.id) return;
    if (this.world) {
      this.atmosphere?.dispose();
      const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
      this.world.traverse(node => {
        if (!(node instanceof T.Mesh)) return;
        if (node instanceof T.InstancedMesh) node.dispose();
        if (node.geometry !== box) geometries.add(node.geometry);
        if (node.material !== white && node.material !== navy) materials.add(node.material);
      });
      geometries.forEach(geo => geo.dispose());
      materials.forEach(mat => {
        if (mat instanceof T.MeshBasicMaterial) mat.map?.dispose();
        mat.dispose();
      });
      this.scene.remove(this.world);
    }
    this.track = track;
    this.resetCamera = true;
    this.world = new T.Group();
    this.scene.background = new T.Color(track.sky);
    this.scene.fog = new T.FogExp2(track.fog, track.fogDensity);
    const night = track.id === 'switchyard';
    this.world.add(new T.HemisphereLight(track.ambient, track.id === 'red-basin' ? '#a48980' : track.ground, night ? 1.36 : 2.17));
    const sun = new T.DirectionalLight(track.sun, night ? 1.15 : 2.3);
    sun.position.set(-65, 90, -45); this.world.add(sun);
    circuit(this.world, track);
    themedScenery(this.world, track);
    landmarks(this.world, track);
    this.atmosphere = new Atmosphere(this.world, this.scene, track);
    this.effects.setTrack(track, this.atmosphere.mood);
    this.scene.add(this.world);
    this.powerupScene.setTrack(track);
  }
  render(local: Pose, actors: Actor[], own: string, dt: number, menu = false, powerups?: PowerupState) {
    const { frame, point } = this.track;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    const aspect = width / Math.max(1, height);
    const fov = aspect < 1 ? 75 : menu ? 59 : 63;
    if (this.camera.aspect !== aspect || this.camera.fov !== fov || this.canvas.width !== Math.floor(width * this.renderer.getPixelRatio()) || this.canvas.height !== Math.floor(height * this.renderer.getPixelRatio())) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = aspect;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const seen = new Set<string>();
    for (const actor of actors) {
      seen.add(actor.id);
      let model = this.models.get(actor.id);
      if (!model) {
        model = kart(COLORS[actor.slot], actor.ghostColor); this.models.set(actor.id, model); this.scene.add(model.root);
      }
      const [s, lane, yaw, speed, , boost] = actor.pose;
      const f = frame(s);
      const air = this.track.airHeight(s);
      const roll = point(s, lane + .4).y - point(s, lane - .4).y;
      model.root.position.copy(point(s, lane, .016 + air + this.track.rumbleAt(s) * speed * .002));
      model.root.rotation.set(-Math.atan(this.track.gradeAt(s)) * .62, f.heading, Math.atan(roll / .8), 'YXZ');
      model.under.visible = !this.track.gapAt(s);
      model.body.rotation.y = yaw;
      model.flame.visible = !model.ghost && boost > 0;
      model.flame.scale.z = .63 + Math.sin(performance.now() * .1) * .19;
      if (actor.id !== own && !menu && !this.labels.has(actor.id)) {
        const label = document.createElement('span'); label.textContent = actor.name; this.labelLayer.appendChild(label); this.labels.set(actor.id, label);
      }
    }
    for (const [id, model] of this.models) if (!seen.has(id)) {
      this.scene.remove(model.root);
      model.paint.dispose();
      model.under.material.dispose();
      model.flame.material.dispose();
      model.ghost?.dispose();
      this.models.delete(id); this.labels.get(id)?.remove(); this.labels.delete(id);
    }
    this.powerupScene.update(powerups, this.models, menu);
    const [s, lane, , speed, , boost] = local;
    if (menu) {
      const heading = frame(s - .005).heading;
      this.camera.position.copy(point(s, lane - 10, 7.5));
      this.camera.position.x -= Math.sin(heading) * 13;
      this.camera.position.z -= Math.cos(heading) * 13;
      this.camera.lookAt(point(s + .014, lane + 8, 1));
      this.followDistance = 10.5;
    } else {
      const targetDistance = 10.5 + speed * .055 + (boost > 0 ? 1.1 : 0);
      this.followDistance += (targetDistance - this.followDistance) * (this.resetCamera ? 1 : 1 - Math.exp(-dt * 8));
      const backS = s - this.followDistance / this.track.length;
      const branch = this.track.branchAt(s);
      const onBranch = branch && lane * branch.side > this.track.widthAt(s) / 2;
      const backLane = onBranch ? this.track.branchAt(backS)?.center ?? lane * .6 : lane * .75;
      const air = this.track.airHeight(s);
      const eye = point(backS, backLane, 6.1 + air);
      if (onBranch) eye.y = Math.max(eye.y, point(s, lane, 5).y);
      const focus = point(s, lane, .7 + air);
      const ahead = new T.Vector3(focus.x - eye.x, 0, focus.z - eye.z).normalize();
      focus.addScaledVector(ahead, 3.8);
      this.camera.position.copy(eye);
      this.camera.lookAt(focus);
    }
    this.resetCamera = false;
    const pixels = this.canvas.height / (2 * Math.tan(T.MathUtils.degToRad(this.camera.fov) / 2));
    this.effects.update(actors.filter(a => !a.ghostColor).map(a => ({ id: a.id, pose: a.pose, body: this.models.get(a.id)!.body })), dt, pixels);
    this.atmosphere?.update(dt, this.camera, pixels);
    this.renderer.render(this.scene, this.camera);
    for (const [id, label] of this.labels) {
      const pos = this.models.get(id)!.root.position.clone(); pos.y += 2.18;
      const dist = pos.distanceTo(this.camera.position);
      pos.project(this.camera);
      label.hidden = menu || dist > 67 || pos.z > 1 || pos.z < 0 || Math.abs(pos.x) > 1 || Math.abs(pos.y) > 1;
      label.style.transform = `translate(${(pos.x + 1) * width / 2}px,${(1 - pos.y) * height / 2}px) translate(-50%, -50%)`;
    }
  }
}
