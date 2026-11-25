import * as T from 'three';
import { COLORS, RED_BASIN, SAMPLES, clamp, delta, wrap, type Circuit } from './circuit';
import { PAD_LENGTH, PAD_WIDTH, type Pose } from './drive';
import { themedScenery } from './track-art';
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

type Strip = [(s: number) => T.Vector3, (s: number) => T.Vector3, T.ColorRepresentation | ((i: number) => T.ColorRepresentation)];
function strips(defs: Strip[], segments = SAMPLES, start = 0, end = 1) {
  const vertices: number[] = [], colors: number[] = [];
  const c = new T.Color();
  for (const [a, b, color] of defs) {
    for (let i = 0; i < segments; i++) {
      const s = start + (end - start) * i / segments, e = start + (end - start) * (i + 1) / segments;
      const a0 = a(s), a1 = a(e), b0 = b(s), b1 = b(e);
      c.set(typeof color === 'function' ? color(i) : color);
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
  const skirt = (lane: number) => track.id === 'red-basin' ? (s: number) => point(s, lane).setY(-2) : at(lane, -.60);
  scene.add(strips([
    [at(-edge), at(edge), track.road],
    [skirt(-edge), at(-edge), track.id === 'red-basin' ? '#614438' : track.wall],
    [at(edge), skirt(edge), track.id === 'red-basin' ? '#614438' : track.wall],
    ...[-1, 1].flatMap((sign): Strip[] => {
      const lane = sign * edge, outside = sign * (edge + .32);
      return [
        [at(lane - sign * .73, .022), at(lane, .022), i => (i >> 1) % 2 ? track.trim : track.curb],
        [at(lane, 1.02), at(outside, 1.02), track.trim],
        [at(lane, .25), at(lane, 1.02), i => (i >> 3) % 2 ? track.curb : track.trim],
        [at(outside, 1.02), at(outside, 0), track.wall],
        [at(lane, .03), at(lane, .25), '#30333d']
      ];
    })
  ]));
  const line: Strip[] = Array.from({ length: 16 }, (_, i) => [at(-edge + i * track.width / 16, .032), at(-edge + (i + 1) * track.width / 16, .032), row => (row + i) % 2 ? '#242b32' : track.trim]);
  scene.add(strips(line, 2, -.0014, .0014));
  const marks = new T.InstancedMesh(box, white, 115);
  const o = new T.Object3D();
  for (let i = 0; i < marks.count; i++) {
    const s = (i + .5) / marks.count, f = frame(s);
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
  for (const x of [-edge - .5, edge + .5]) {
    block(arch, navy, x, 2.3, 0, .7, 6, .75);
    block(arch, paint, x, 2.6, -.41, .3, 4.8, .13);
  }
  block(arch, navy, 0, 5.4, 0, track.width + 1.8, 2.1, .9);
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = track.sign[0]; ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = track.sign[1]; ctx.font = 'italic 900 84px system-ui'; ctx.textAlign = 'center';
  ctx.fillText(`${track.name.toUpperCase()}   /   ${String(TRACK_IDS.indexOf(track.id) + 1).padStart(2, '0')}`, 512, 94, 956);
  const tex = new T.CanvasTexture(canvas); tex.colorSpace = T.SRGBColorSpace;
  const sign = new T.Mesh(new T.PlaneGeometry(track.width + .5, 1.72), new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide }));
  sign.position.set(0, 5.4, -.46); sign.rotation.y = Math.PI; arch.add(sign);
  scene.add(arch);
}

function scenery(scene: T.Group, track: Circuit) {
  const { frame, point } = track;
  const ground = new T.Mesh(new T.PlaneGeometry(2600, 2600), flat('#c98457'));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -1.2; scene.add(ground);
  let seed = 47063;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const o = new T.Object3D();
  const rocks = new T.InstancedMesh(new T.DodecahedronGeometry(1, 0), flat('#fff'), 230);
  const vistas = new T.InstancedMesh(new T.CylinderGeometry(.56, 1, 1, 6), flat('#fff'), 75);
  const cacti = new T.InstancedMesh(new T.CylinderGeometry(.77, 1, 1, 6), flat('#649477'), 126);
  const rail = new T.InstancedMesh(box, flat('#424455'), 34);
  const mat = (mesh: T.InstancedMesh, i: number, color?: string) => {
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    if (color) mesh.setColorAt(i, new T.Color(color));
  };
  const clear = (x: number, z: number, r: number) => {
    for (let i = 0; i < 144; i++) {
      const f = frame(i / 144);
      if (Math.hypot(f.x - x, f.z - z) < r) return false;
    }
    return true;
  };
  for (let i = 0; i < rocks.count; i++) {
    let x: number, z: number;
    do { x = (rand() - .5) * 500; z = (rand() - .5) * 460; } while (!clear(x, z, 19));
    const size = .7 + rand() ** 3 * 14;
    o.position.set(x, size * .27 - 1.2, z); o.scale.set(size, size * (.35 + rand() * .6), size * .86); o.rotation.set(rand() * .3, rand() * 7, rand() * .4);
    mat(rocks, i, ['#a64c35', '#d59664', '#deaa72', '#985e4e'][i % 4]);
  }
  for (let i = 0; i < vistas.count; i += 3) {
    const a = rand() * 6.28, r = 220 + rand() * 280, x = Math.sin(a) * r, z = Math.cos(a) * r;
    const w = 10 + rand() * 35, h = 13 + rand() * 34;
    for (let j = 0; j < 3; j++) {
      o.position.set(x, h * (.24 + j * .32), z); o.scale.set(w * (1 - j * .23), h * (j === 2 ? .44 : .57), w * .68 * (1 - j * .22)); o.rotation.set(0, a, 0);
      mat(vistas, i + j, ['#965640', '#b6694a', '#985340'][j]);
    }
  }
  for (let i = 0; i < cacti.count; i += 3) {
    let x: number, z: number;
    do { x = (rand() - .5) * 280; z = (rand() - .5) * 270; } while (!clear(x, z, 13));
    const h = 2.1 + rand() * 3.8;
    o.position.set(x, h / 2 - 1.2, z); o.scale.set(.35, h, .35); o.rotation.set(0, 0, 0); mat(cacti, i);
    for (const side of [-1, 1]) {
      o.position.set(x + side * .58, h * .55 - 1.2, z + side * .19); o.scale.set(.23, h * .42, .23); o.rotation.z = -.53 * side; mat(cacti, i + (side === 1 ? 2 : 1));
    }
  }
  for (let i = 0; i < rail.count; i++) {
    const s = .04 + i * .0019;
    o.position.copy(point(s, 11.4, 1.4 + (i % 2) * .3));
    o.scale.set(3.2, 2.5 + (i % 2) * .8, 1.8); o.rotation.set(0, frame(s).heading, 0); mat(rail, i, i % 3 ? '#e3c393' : '#ee6745');
  }
  scene.add(rocks, vistas, cacti, rail);
}

function kart(color: string) {
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
  return { root, body, flame, paint, under };
}

export class View {
  private readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(58, 1, .15, 560);
  private readonly models = new Map<string, ReturnType<typeof kart>>();
  private readonly focus = new T.Vector3();
  private readonly labels = new Map<string, HTMLSpanElement>();
  private world?: T.Group;
  private track = RED_BASIN;
  private resetCamera = false;
  constructor(private readonly canvas: HTMLCanvasElement, private readonly labelLayer: HTMLElement) {
    this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.setTrack(RED_BASIN);
  }
  setTrack(track: Circuit) {
    if (this.world && track.id === this.track.id) return;
    if (this.world) {
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
    if (track.id === 'red-basin') scenery(this.world, track);
    else themedScenery(this.world, track);
    this.scene.add(this.world);
  }
  render(local: Pose, actors: { id: string; name: string; slot: number; pose: Pose }[], own: string, dt: number, menu = false) {
    const { frame, point } = this.track;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    const aspect = width / Math.max(1, height);
    const fov = aspect < 1 ? 75 : 59;
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
        model = kart(COLORS[actor.slot]); this.models.set(actor.id, model); this.scene.add(model.root);
      }
      const [s, lane, yaw, , , boost] = actor.pose;
      const f = frame(s);
      model.root.position.copy(point(s, lane, .016));
      model.root.rotation.set(0, f.heading, Math.atan(f.bank), 'YXZ');
      model.body.rotation.y = yaw;
      model.flame.visible = boost > 0;
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
      this.models.delete(id); this.labels.get(id)?.remove(); this.labels.delete(id);
    }
    const [s, lane, , speed, , boost] = local;
    const soft = menu || this.resetCamera ? 1 : clamp(dt * 7.5, 0, 1);
    this.resetCamera = false;
    const here = frame(s), behind = frame(s - .011);
    const heading = here.heading + delta(behind.heading - here.heading, Math.PI * 2) * .48;
    const eye = point(s, menu ? lane - 10 : lane * .78, menu ? 7.5 : 5.4);
    const back = menu ? 13 : 8.1 + speed * .058 + (boost > 0 ? 1.4 : 0);
    eye.x -= Math.sin(heading) * back; eye.z -= Math.cos(heading) * back;
    const look = point(wrap(s + (menu ? .014 : .016)), menu ? lane + 8 : lane * .46, menu ? 1 : 1.35);
    this.camera.position.lerp(eye, soft);
    this.focus.lerp(look, soft);
    this.camera.lookAt(this.focus);
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
