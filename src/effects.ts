import * as T from 'three';
import type { Circuit } from './circuit';
import type { Mood } from './atmosphere';
import type { Pose } from './drive';

const vertex = `attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
  uniform float scale; varying vec3 vColor; varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aSize * scale / max(-mv.z, .1), 96.);
    vColor = aColor; vAlpha = aAlpha;
  }`;
const fragment = `varying vec3 vColor; varying float vAlpha;
  void main() {
    float r = length(gl_PointCoord - .5) * 2.;
    float a = (1. - smoothstep(.25, 1., r)) * vAlpha;
    if (a < .01) discard;
    #ifdef HOT
      gl_FragColor = vec4(mix(vColor, vec3(1.), smoothstep(.45, 0., r) * .7) * a, 1.);
    #else
      gl_FragColor = vec4(vColor, a);
    #endif
    #include <colorspace_fragment>
  }`;

class Particles {
  readonly mesh: T.Points;
  readonly material: T.ShaderMaterial;
  private count = 0;
  private readonly pos: Float32Array; private readonly vel: Float32Array;
  private readonly color: Float32Array; private readonly size: Float32Array; private readonly alpha: Float32Array;
  private readonly life: Float32Array; private readonly span: Float32Array; private readonly grow: Float32Array;
  private readonly baseSize: Float32Array; private readonly drag: Float32Array; private readonly gravity: Float32Array;
  constructor(private readonly max: number, hot: boolean) {
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.color = new Float32Array(max * 3);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.life = new Float32Array(max);
    this.span = new Float32Array(max); this.grow = new Float32Array(max); this.baseSize = new Float32Array(max);
    this.drag = new Float32Array(max); this.gravity = new Float32Array(max);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('aColor', new T.BufferAttribute(this.color, 3).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('aSize', new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.material = new T.ShaderMaterial({
      uniforms: { scale: { value: 400 } }, vertexShader: vertex, fragmentShader: fragment,
      defines: hot ? { HOT: '' } : {}, transparent: true, depthWrite: false, fog: false,
      blending: hot ? T.AdditiveBlending : T.NormalBlending
    });
    this.mesh = new T.Points(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = hot ? 9 : 8;
  }
  emit(p: T.Vector3, v: T.Vector3, color: T.Color, size: number, life: number, grow = 0, drag = 0, gravity = 0) {
    const i = this.count < this.max ? this.count++ : Math.floor(Math.random() * this.max);
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.color.set([color.r, color.g, color.b], i * 3);
    this.baseSize[i] = size; this.size[i] = size; this.life[i] = 0; this.span[i] = life;
    this.grow[i] = grow; this.drag[i] = drag; this.gravity[i] = gravity; this.alpha[i] = 1;
  }
  update(dt: number) {
    const { pos, vel } = this;
    for (let i = 0; i < this.count; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.span[i]) { this.move(--this.count, i); i--; continue; }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      vel[i * 3] *= k; vel[i * 3 + 1] = vel[i * 3 + 1] * k - this.gravity[i] * dt; vel[i * 3 + 2] *= k;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.span[i];
      this.size[i] = this.baseSize[i] * (1 + this.grow[i] * t);
      this.alpha[i] = (1 - t) * (1 - t);
    }
    const geo = this.mesh.geometry;
    for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
      const attribute = geo.getAttribute(name) as T.BufferAttribute;
      attribute.clearUpdateRanges(); attribute.addUpdateRange(0, this.count * attribute.itemSize); attribute.needsUpdate = true;
    }
    geo.setDrawRange(0, this.count);
  }
  clear() { this.count = 0; this.mesh.geometry.setDrawRange(0, 0); }
  private move(from: number, to: number) {
    if (from === to) return;
    for (const [a, n] of [[this.pos, 3], [this.vel, 3], [this.color, 3]] as const) a.copyWithin(to * n, from * n, from * n + n);
    for (const a of [this.size, this.alpha, this.life, this.span, this.grow, this.baseSize, this.drag, this.gravity]) a[to] = a[from];
  }
}

const SKID_QUADS = 900;
class Skids {
  readonly mesh: T.Mesh;
  private next = 0;
  private filled = 0;
  private readonly pos = new Float32Array(SKID_QUADS * 6 * 3);
  constructor() {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.mesh = new T.Mesh(geo, new T.MeshBasicMaterial({
      color: '#15161a', transparent: true, opacity: .42, depthWrite: false, side: T.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  add(a0: T.Vector3, a1: T.Vector3, b0: T.Vector3, b1: T.Vector3) {
    const i = this.next * 18;
    let k = i;
    for (const v of [a0, a1, b0, b0, a1, b1]) { this.pos[k++] = v.x; this.pos[k++] = v.y; this.pos[k++] = v.z; }
    const attribute = this.mesh.geometry.getAttribute('position') as T.BufferAttribute;
    attribute.addUpdateRange(i, 18); attribute.needsUpdate = true;
    this.next = (this.next + 1) % SKID_QUADS;
    this.filled = Math.min(SKID_QUADS, this.filled + 1);
    this.mesh.geometry.setDrawRange(0, this.filled * 6);
  }
  clear() { this.next = this.filled = 0; this.mesh.geometry.setDrawRange(0, 0); }
}

const TRAIL = 22, TRAIL_AGE = .42;
class Trail {
  readonly mesh: T.Mesh;
  private readonly points: { left: T.Vector3; right: T.Vector3; age: number }[] = [];
  private readonly pos = new Float32Array(TRAIL * 2 * 3);
  private readonly alpha = new Float32Array(TRAIL * 2);
  constructor(material: T.ShaderMaterial) {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < TRAIL - 1; i++) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setIndex(index);
    geo.setDrawRange(0, 0);
    this.mesh = new T.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
  }
  update(dt: number, active: boolean, left: T.Vector3, right: T.Vector3) {
    for (const p of this.points) p.age += dt;
    while (this.points.length && this.points[this.points.length - 1].age > TRAIL_AGE) this.points.pop();
    if (active) {
      this.points.unshift({ left: left.clone(), right: right.clone(), age: 0 });
      if (this.points.length > TRAIL) this.points.pop();
    }
    const n = this.points.length;
    this.points.forEach((p, i) => {
      this.pos.set([p.left.x, p.left.y, p.left.z, p.right.x, p.right.y, p.right.z], i * 6);
      const a = (1 - p.age / TRAIL_AGE) * (i === 0 ? 0 : 1);
      this.alpha[i * 2] = a; this.alpha[i * 2 + 1] = a;
    });
    this.mesh.geometry.getAttribute('position').needsUpdate = true;
    this.mesh.geometry.getAttribute('aAlpha').needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
  }
  dispose() { this.mesh.geometry.dispose(); this.mesh.removeFromParent(); }
}

type Racer = { id: string; pose: Pose; body: T.Object3D };
type State = { trail: Trail; wheels: [T.Vector3, T.Vector3] | null; dust: number; sparks: number; exhaust: number; last: T.Vector3 | null };

const SPARK_TIERS = ['#ffd36b', '#47b6ff', '#ff4fb0'].map(c => new T.Color(c));
const FLAME = ['#ffde7a', '#ff8a2a', '#ff4a1e'].map(c => new T.Color(c));
const local = {
  wheels: [new T.Vector3(-1, .04, -.93), new T.Vector3(1, .04, -.93)],
  exhaust: new T.Vector3(0, .52, -1.78),
  trailL: new T.Vector3(-.5, .5, -1.7), trailR: new T.Vector3(.5, .5, -1.7)
};

export class KartEffects {
  readonly root = new T.Group();
  private readonly hot = new Particles(900, true);
  private readonly soft = new Particles(700, false);
  private readonly skids = new Skids();
  private readonly trailMaterial: T.ShaderMaterial;
  private readonly states = new Map<string, State>();
  private dustColor = new T.Color();
  private dustRate = 1;
  private spray = false;
  private width = 15;
  private track?: Circuit;
  private readonly v = new T.Vector3(); private readonly p = new T.Vector3(); private readonly fwd = new T.Vector3();
  private readonly side = new T.Vector3(); private readonly a = new T.Vector3(); private readonly b = new T.Vector3();
  private readonly c = new T.Color();

  constructor(scene: T.Scene) {
    this.trailMaterial = new T.ShaderMaterial({
      uniforms: { color: { value: new T.Color('#ff9a3a') } },
      vertexShader: `attribute float aAlpha; varying float vAlpha;
        void main() { vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform vec3 color; varying float vAlpha;
        void main() { gl_FragColor = vec4(color * vAlpha * .85, 1.);
        #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false
    });
    this.root.add(this.skids.mesh, this.soft.mesh, this.hot.mesh);
    scene.add(this.root);
  }

  setTrack(track: Circuit, mood: Mood) {
    this.dustColor.set(mood.kick);
    this.dustRate = mood.dust;
    this.spray = !!mood.spray;
    this.width = track.width;
    this.track = track;
    this.reset();
  }

  reset() {
    this.hot.clear(); this.soft.clear(); this.skids.clear();
    for (const s of this.states.values()) { s.wheels = null; s.last = null; }
  }

  update(racers: Racer[], dt: number, scale: number) {
    const seen = new Set<string>();
    const step = Math.min(dt, .05);
    for (const { id, pose, body } of racers) {
      seen.add(id);
      let state = this.states.get(id);
      if (!state) {
        state = { trail: new Trail(this.trailMaterial), wheels: null, dust: 0, sparks: 0, exhaust: 0, last: null };
        this.root.add(state.trail.mesh);
        this.states.set(id, state);
      }
      this.racer(state, pose, body, step);
    }
    for (const [id, state] of this.states) if (!seen.has(id)) { state.trail.dispose(); this.states.delete(id); }
    this.hot.update(step); this.soft.update(step);
    this.hot.material.uniforms.scale.value = scale;
    this.soft.material.uniforms.scale.value = scale;
  }

  private onRoad(s: number, lane: number, w: T.Vector3) {
    const track = this.track;
    if (!track) return w;
    const o = track.point(s, lane), f = track.point(s + 1 / track.length, lane).sub(o), r = track.point(s, lane + 1).sub(o);
    const dx = w.x - o.x, dz = w.z - o.z, det = f.x * r.z - f.z * r.x;
    if (Math.abs(det) < 1e-6) return w;
    const along = (dx * r.z - dz * r.x) / det, across = (f.x * dz - f.z * dx) / det;
    w.y = o.y + along * f.y + across * r.y + .03;
    return w;
  }

  private racer(state: State, pose: Pose, body: T.Object3D, dt: number) {
    const [s, lane, , poseSpeed, poseDrift, poseBoost] = pose;
    body.updateWorldMatrix(true, false);
    const m = body.matrixWorld;
    const at = new T.Vector3().setFromMatrixPosition(m);
    const moved = state.last && dt > 0 ? at.distanceTo(state.last) / dt : 0;
    state.last = at;
    const speed = moved > 2 ? poseSpeed : 0;
    const drift = poseDrift > .02 ? poseDrift : 0, boost = poseBoost > .02 ? poseBoost : 0;
    this.fwd.set(m.elements[8], m.elements[9], m.elements[10]).normalize();
    this.side.set(m.elements[0], m.elements[1], m.elements[2]).normalize();
    const drifting = drift > 0 && speed > 15;
    const wheels = local.wheels.map(w => this.onRoad(s, lane, w.clone().applyMatrix4(m))) as [T.Vector3, T.Vector3];
    if (drifting && state.wheels && dt > 0) {
      for (let i = 0; i < 2; i++) {
        const half = this.side.clone().multiplyScalar(.15);
        this.skids.add(this.a.copy(state.wheels[i]).sub(half), this.b.copy(state.wheels[i]).add(half), wheels[i].clone().sub(half), wheels[i].clone().add(half));
      }
    }
    state.wheels = drifting ? wheels : null;
    const back = this.fwd.clone().multiplyScalar(-1);
    if (drifting) {
      const tier = drift > .7 ? 2 : drift > .34 ? 1 : 0;
      state.sparks += dt * (tier ? 110 : 45);
      while (state.sparks >= 1) {
        state.sparks--;
        const w = wheels[Math.random() < .5 ? 0 : 1];
        this.v.copy(back).multiplyScalar(4 + Math.random() * 6).addScaledVector(this.side, (Math.random() - .5) * 7);
        this.v.y = 2 + Math.random() * 4.5;
        this.v.addScaledVector(this.fwd, speed * .55);
        this.hot.emit(this.p.copy(w).setY(w.y + .08), this.v, SPARK_TIERS[tier], tier ? .2 : .14, .22 + Math.random() * .22, -.5, 1.5, 16);
      }
    }
    if (boost > 0) {
      state.exhaust += dt * 75;
      while (state.exhaust >= 1) {
        state.exhaust--;
        this.p.copy(local.exhaust).applyMatrix4(m);
        this.v.copy(back).multiplyScalar(3 + Math.random() * 3).addScaledVector(this.fwd, speed * .6);
        this.v.x += (Math.random() - .5) * 1.6; this.v.y += .6 + Math.random(); this.v.z += (Math.random() - .5) * 1.6;
        this.hot.emit(this.p, this.v, FLAME[Math.floor(Math.random() * 3)], .5 + Math.random() * .35, .22 + Math.random() * .16, -.6, 3);
      }
    }
    state.trail.update(dt, boost > 0, this.a.copy(local.trailL).applyMatrix4(m), this.b.copy(local.trailR).applyMatrix4(m));
    const scrape = Math.abs(lane) > this.width / 2 - 1.4 ? 2.5 : 1;
    const rate = speed < 12 ? 0 : (speed / 42) * this.dustRate * scrape * (drifting ? 2.2 : 1) * 10;
    state.dust += dt * rate;
    while (state.dust >= 1) {
      state.dust--;
      const w = wheels[Math.random() < .5 ? 0 : 1];
      this.v.copy(back).multiplyScalar(1.5 + Math.random() * 2.5).addScaledVector(this.side, (Math.random() - .5) * 3).addScaledVector(this.fwd, speed * (this.spray ? .45 : .3));
      this.v.y = this.spray ? 2.4 + Math.random() * 2.6 : .5 + Math.random() * 1.4;
      this.c.copy(this.dustColor).offsetHSL(0, 0, (Math.random() - .5) * .08);
      this.soft.emit(this.p.copy(w).setY(w.y + .15), this.v, this.c, this.spray ? .3 : .4 + Math.random() * .3, this.spray ? .45 : .5 + Math.random() * .4, this.spray ? 1.4 : 1.8, 2.2, this.spray ? 7 : -.3);
    }
  }
}
