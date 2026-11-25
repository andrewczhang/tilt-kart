import * as T from 'three';
import type { Circuit } from './circuit';
import type { TrackId } from './tracks';

export type Weather = 'clear' | 'sand' | 'snow' | 'drizzle' | 'rain' | 'embers' | 'leaves' | 'motes';
type Lights = {
  every: number; lane: number; height: number; color: string; pool: number;
  sides?: 1 | -1 | 0; alternate?: boolean; post?: string; beam?: number; clearance?: number;
};
export type Mood = {
  label: string;
  zenith: string; horizon: string; fog: string; fogDensity: number;
  sun: string; sunDir: [x: number, y: number, z: number]; sunSize: number; stars: number;
  ambient: number; direct: number; tint?: string;
  weather: Weather; count: number;
  lights?: Lights; lightning?: boolean;
  kick: string; dust: number; spray?: boolean;
};

export const MOODS: Partial<Record<TrackId, Mood>> = {
  'red-basin': {
    label: 'Sandstorm', zenith: '#c08250', horizon: '#e2a56b', fog: '#d89a60', fogDensity: .0102,
    sun: '#fff0cf', sunDir: [-.45, .42, -.32], sunSize: 3.2, stars: 0, ambient: 1.02, direct: .58, tint: '#ffcf98',
    weather: 'sand', count: 2600, kick: '#d79b63', dust: 1.6
  },
  frostline: {
    label: 'Snowfall', zenith: '#8ea6bb', horizon: '#dde6ee', fog: '#dbe4ec', fogDensity: .0066,
    sun: '#f4f8ff', sunDir: [.3, .5, -.4], sunSize: 2, stars: 0, ambient: 1.05, direct: .62,
    weather: 'snow', count: 2600, kick: '#f4fbff', dust: 1.2
  },
  switchyard: {
    label: 'Midnight drizzle', zenith: '#040917', horizon: '#1f3150', fog: '#1a2943', fogDensity: .0048,
    sun: '#d4e2ff', sunDir: [-.62, .4, -.6], sunSize: 1.2, stars: 1, ambient: .78, direct: .72,
    weather: 'drizzle', count: 1700, kick: '#a8bdd8', dust: 1, spray: true,
    lights: { every: 1 / 44, lane: .5, height: 2.05, color: '#ffb760', pool: 4.2, sides: 1, clearance: 0 }
  },
  saltwater: {
    label: 'Tropical squall', zenith: '#34505a', horizon: '#87a3a2', fog: '#7c9898', fogDensity: .0074,
    sun: '#e8f2f0', sunDir: [.4, .55, .3], sunSize: 2.4, stars: 0, ambient: .8, direct: .42,
    weather: 'rain', count: 3200, lightning: true, kick: '#e2f4f4', dust: 1.7, spray: true
  },
  cinder: {
    label: 'Ashfall', zenith: '#22100f', horizon: '#a8432a', fog: '#6b2d27', fogDensity: .0068,
    sun: '#ff6c2c', sunDir: [.62, .1, -.55], sunSize: 7, stars: .3, ambient: .74, direct: .95, tint: '#ff9862',
    weather: 'embers', count: 1500, kick: '#3e3335', dust: 1.1
  },
  cedar: {
    label: 'Morning mist', zenith: '#9fc0bc', horizon: '#e6e8cd', fog: '#cdd7bd', fogDensity: .0094,
    sun: '#fff0c0', sunDir: [-.62, .2, .45], sunSize: 4, stars: 0, ambient: .96, direct: 1, tint: '#ffe5ae',
    weather: 'leaves', count: 700, kick: '#6d5b3e', dust: .8
  },
  mesa: {
    label: 'Dusk', zenith: '#283467', horizon: '#f2894a', fog: '#c87656', fogDensity: .0046,
    sun: '#ffae55', sunDir: [.15, .07, -.98], sunSize: 7.5, stars: .55, ambient: .7, direct: 1.12, tint: '#ff9855',
    weather: 'motes', count: 650, kick: '#c27b52', dust: 1.2,
    lights: { every: 1 / 58, lane: 1.4, height: 2.3, color: '#ffc773', pool: 3, alternate: true, post: '#3a2a2a', clearance: 1.6 }
  },
  arena: {
    label: 'Night floodlights', zenith: '#060918', horizon: '#2b3152', fog: '#1d2238', fogDensity: .0034,
    sun: '#dfe8ff', sunDir: [.5, .55, .5], sunSize: 1, stars: 1, ambient: .6, direct: .5, tint: '#b8c7ff',
    weather: 'clear', count: 0, kick: '#a3abc0', dust: .7,
    lights: { every: 1 / 16, lane: 17, height: 10, color: '#f6f4ff', pool: 10, alternate: true, beam: 1, clearance: 7 }
  }
};

export function moodFor(track: Circuit): Mood {
  return MOODS[track.id] ?? {
    label: 'Clear', zenith: track.sky, horizon: track.fog, fog: track.fog, fogDensity: track.fogDensity,
    sun: track.sun, sunDir: [-.5, .7, -.4], sunSize: 2, stars: 0, ambient: 1, direct: 1,
    weather: 'clear', count: 0, kick: track.ground, dust: 1
  };
}

const quality = typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4 ? .6 : 1;

const glsl = {
  sky: {
    vertex: `varying vec3 vDir;
      void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.); gl_Position = p.xyww; }`,
    fragment: `uniform vec3 zenith, horizon, sun, sunDir; uniform float sunSize, stars, flash, time;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.);
        vec3 col = mix(horizon, zenith, pow(h, .55));
        float a = max(dot(d, sunDir), 0.);
        col += sun * (smoothstep(1. - sunSize * .0009, 1. - sunSize * .0006, a) * 1.6 + pow(a, 14. / sunSize) * .32 + pow(a, 3.) * .08 * sunSize / 4.);
        if (stars > 0.) {
          vec3 cell = floor(d * 210.);
          float n = hash(cell);
          float twinkle = .65 + .35 * sin(time * (2. + n * 5.) + n * 60.);
          col += vec3(.9, .94, 1.) * step(.9965, n) * stars * twinkle * smoothstep(.04, .3, d.y);
        }
        col += flash * vec3(.55, .62, .75);
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`
  },
  weather: {
    vertex: `attribute vec3 seed; attribute float rnd; attribute float tail;
      uniform vec3 origin, box, vel; uniform float time, sway, streak, size, scale, density;
      varying float vAlpha, vRnd;
      void main() {
        vec3 v = vel * (.75 + .5 * rnd);
        vec3 p = seed * box + v * time;
        p.x += sin(time * (.6 + rnd) + rnd * 40.) * sway;
        p.z += cos(time * (.5 + rnd * .8) + rnd * 25.) * sway;
        vec3 rel = mod(p - origin + box * .5, box) - box * .5;
        vec3 world = origin + rel - normalize(v) * streak * tail;
        vec4 mv = viewMatrix * vec4(world, 1.);
        gl_Position = projectionMatrix * mv;
        float edge = max(abs(rel.x) / box.x, max(abs(rel.y) / box.y, abs(rel.z) / box.z)) * 2.;
        float dist = -mv.z;
        vAlpha = (1. - smoothstep(.7, 1., edge)) * exp(-pow(dist * density, 2.)) * (1. - tail * .9) * smoothstep(.5, 2.5, dist);
        vRnd = rnd;
        gl_PointSize = size * (.6 + .8 * rnd) * scale / max(dist, .1);
      }`,
    fragment: `uniform vec3 color, color2; uniform float opacity, flicker, time;
      varying float vAlpha, vRnd;
      void main() {
        float a = vAlpha * opacity;
        #ifdef ROUND
          vec2 c = gl_PointCoord - .5;
          a *= 1. - smoothstep(.15, .5, length(c));
        #endif
        a *= 1. - flicker + flicker * (.5 + .5 * sin(time * 9. + vRnd * 80.));
        if (a < .01) discard;
        gl_FragColor = vec4(mix(color, color2, vRnd), a);
        #include <colorspace_fragment>
      }`
  },
  glow: {
    vertex: `uniform float scale, size, density; varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * mv;
        vAlpha = .35 + .65 * exp(-pow(-mv.z * density * .6, 2.));
        gl_PointSize = min(size * scale / max(-mv.z, .1), 260.);
      }`,
    fragment: `uniform vec3 color; varying float vAlpha;
      void main() {
        float r = length(gl_PointCoord - .5) * 2.;
        float a = (pow(max(1. - r, 0.), 2.4) + smoothstep(.22, .0, r)) * vAlpha;
        gl_FragColor = vec4(color * a, 1.);
        #include <colorspace_fragment>
      }`
  }
};

type WeatherLook = { vel: [number, number, number]; box: [number, number, number]; lines: boolean; streak: number; sway: number; size: number; color: string; color2: string; opacity: number; additive?: boolean; flicker?: number };
const LOOKS: Record<Exclude<Weather, 'clear'>, WeatherLook> = {
  sand: { vel: [26, -1.5, 9], box: [90, 26, 90], lines: true, streak: 2.6, sway: 0, size: 0, color: '#f0c18c', color2: '#b97a4a', opacity: .55 },
  snow: { vel: [1.2, -3.2, .4], box: [80, 34, 80], lines: false, streak: 0, sway: 1.3, size: .2, color: '#ffffff', color2: '#d9e8f5', opacity: .95 },
  drizzle: { vel: [1.5, -20, .6], box: [70, 30, 70], lines: true, streak: .7, sway: 0, size: 0, color: '#9fb8dd', color2: '#ffd8a0', opacity: .5 },
  rain: { vel: [4, -36, 2], box: [70, 32, 70], lines: true, streak: 1.4, sway: 0, size: 0, color: '#dceaf0', color2: '#a9c4cc', opacity: .55 },
  embers: { vel: [.8, 2.6, -.4], box: [80, 30, 80], lines: false, streak: 0, sway: 1.6, size: .17, color: '#ff6a22', color2: '#ffd27a', opacity: 1, additive: true, flicker: .55 },
  leaves: { vel: [1.6, -1.7, .9], box: [70, 26, 70], lines: false, streak: 0, sway: 2.2, size: .3, color: '#c4632a', color2: '#e3b13c', opacity: .95 },
  motes: { vel: [.5, .2, .3], box: [60, 16, 60], lines: false, streak: 0, sway: .9, size: .11, color: '#ffe0a8', color2: '#ffb46a', opacity: .9, additive: true, flicker: .35 }
};

let poolTexture: T.Texture | undefined, beamTexture: T.Texture | undefined;
function gradient(radial: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = radial ? ctx.createRadialGradient(32, 32, 0, 32, 32, 32) : ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, radial ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.9)');
  g.addColorStop(radial ? .45 : .7, radial ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const texture = new T.CanvasTexture(canvas);
  return texture;
}

export class Atmosphere {
  readonly mood: Mood;
  readonly root = new T.Group();
  private readonly sky: T.ShaderMaterial;
  private readonly dome: T.Mesh;
  private readonly materials: T.ShaderMaterial[] = [];
  private readonly lit: { light: T.Light; base: number }[] = [];
  private flash = 0;
  private nextBolt = 4;
  private time = 0;
  private readonly forward = new T.Vector3();

  constructor(world: T.Group, scene: T.Scene, private readonly track: Circuit) {
    const mood = this.mood = moodFor(track);
    scene.background = new T.Color(mood.horizon);
    scene.fog = new T.FogExp2(mood.fog, mood.fogDensity);
    const dir = new T.Vector3(...mood.sunDir).normalize();
    world.traverse(node => {
      if (node instanceof T.HemisphereLight) {
        node.intensity *= mood.ambient;
        this.lit.push({ light: node, base: node.intensity });
      } else if (node instanceof T.DirectionalLight) {
        node.intensity *= mood.direct;
        if (mood.tint) node.color.set(mood.tint);
        node.position.copy(dir).setY(Math.max(dir.y, .3)).multiplyScalar(120);
      }
    });
    this.sky = new T.ShaderMaterial({
      uniforms: {
        zenith: { value: new T.Color(mood.zenith) }, horizon: { value: new T.Color(mood.horizon) },
        sun: { value: new T.Color(mood.sun) }, sunDir: { value: dir }, sunSize: { value: mood.sunSize },
        stars: { value: mood.stars }, flash: { value: 0 }, time: { value: 0 }
      },
      vertexShader: glsl.sky.vertex, fragmentShader: glsl.sky.fragment,
      side: T.BackSide, depthWrite: false, fog: false
    });
    this.dome = new T.Mesh(new T.SphereGeometry(400, 24, 12), this.sky);
    this.dome.renderOrder = -10; this.dome.frustumCulled = false;
    this.root.add(this.dome);
    this.materials.push(this.sky);
    if (mood.weather !== 'clear' && mood.count > 0) this.root.add(this.weather(mood.weather, Math.round(mood.count * quality)));
    if (mood.lights) this.lamps(mood.lights);
    world.add(this.root);
  }

  private weather(kind: Exclude<Weather, 'clear'>, count: number) {
    const look = LOOKS[kind];
    let seed = 991 + count;
    const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const per = look.lines ? 2 : 1;
    const seeds = new Float32Array(count * per * 3), rnds = new Float32Array(count * per), tails = new Float32Array(count * per);
    for (let i = 0; i < count; i++) {
      const s = [rand(), rand(), rand()], r = rand();
      for (let j = 0; j < per; j++) {
        const k = i * per + j;
        seeds.set(s, k * 3); rnds[k] = r; tails[k] = j;
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(count * per * 3), 3));
    geo.setAttribute('seed', new T.BufferAttribute(seeds, 3));
    geo.setAttribute('rnd', new T.BufferAttribute(rnds, 1));
    geo.setAttribute('tail', new T.BufferAttribute(tails, 1));
    const material = new T.ShaderMaterial({
      uniforms: {
        origin: { value: new T.Vector3() }, box: { value: new T.Vector3(...look.box) }, vel: { value: new T.Vector3(...look.vel) },
        time: { value: 0 }, sway: { value: look.sway }, streak: { value: look.streak }, size: { value: look.size },
        scale: { value: 400 }, density: { value: this.mood.fogDensity * .8 },
        color: { value: new T.Color(look.color) }, color2: { value: new T.Color(look.color2) },
        opacity: { value: look.opacity }, flicker: { value: look.flicker ?? 0 }
      },
      defines: look.lines ? {} : { ROUND: '' },
      vertexShader: glsl.weather.vertex, fragmentShader: glsl.weather.fragment,
      transparent: true, depthWrite: false, fog: false,
      blending: look.additive ? T.AdditiveBlending : T.NormalBlending
    });
    this.materials.push(material);
    const mesh = look.lines ? new T.LineSegments(geo, material) : new T.Points(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    return mesh;
  }

  private lamps(spec: Lights) {
    const { track } = this;
    const edge = track.width / 2;
    const markers = Array.from({ length: 160 }, (_, i) => track.frame(i / 160));
    const clear = (p: T.Vector3, r: number) => markers.every(m => Math.hypot(m.x - p.x, m.z - p.z) >= r);
    const heads: number[] = [], pools: T.Matrix4[] = [], posts: T.Matrix4[] = [], beams: T.Matrix4[] = [];
    const o = new T.Object3D(), flatten = new T.Matrix4().makeRotationX(-Math.PI / 2);
    const count = Math.round(1 / spec.every);
    for (let i = 0; i < count; i++) {
      const s = i * spec.every;
      const side = spec.alternate ? (i % 2 ? 1 : -1) : spec.sides ?? 1;
      const f = track.frame(s);
      const base = track.point(s, side * (edge + spec.lane));
      if (spec.clearance && !clear(base, edge + spec.clearance)) continue;
      const head = base.clone(); head.y += spec.height;
      heads.push(head.x, head.y, head.z);
      if (spec.post) {
        o.position.copy(base).setY(base.y + spec.height / 2); o.rotation.set(0, f.heading, 0); o.scale.set(.18, spec.height, .18);
        o.updateMatrix(); posts.push(o.matrix.clone());
      }
      const ground = track.point(s, spec.beam ? 0 : side * (edge - spec.pool * .45), .05);
      o.position.copy(ground); o.rotation.set(0, f.heading, Math.atan(f.bank), 'YXZ'); o.scale.set(1, 1, 1); o.updateMatrix();
      pools.push(o.matrix.clone().multiply(flatten).scale(new T.Vector3(spec.pool, spec.pool, 1)));
      if (spec.beam) {
        const length = head.distanceTo(ground);
        o.position.copy(head).lerp(ground, .5);
        o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), head.clone().sub(ground).normalize());
        o.scale.set(1, length, 1); o.updateMatrix(); beams.push(o.matrix.clone());
      }
    }
    const color = new T.Color(spec.color);
    poolTexture ??= gradient(true);
    const pool = new T.InstancedMesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({
      map: poolTexture, color: color.clone().multiplyScalar(spec.beam ? .32 : .55), transparent: true, depthWrite: false,
      blending: T.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    }), pools.length);
    pools.forEach((m, i) => pool.setMatrixAt(i, m));
    pool.renderOrder = 2;
    this.root.add(pool);
    if (posts.length) {
      const post = new T.InstancedMesh(new T.BoxGeometry(), new T.MeshLambertMaterial({ color: spec.post }), posts.length);
      posts.forEach((m, i) => post.setMatrixAt(i, m));
      this.root.add(post);
    }
    if (beams.length) {
      beamTexture ??= gradient(false);
      const cone = new T.CylinderGeometry(.7, spec.pool * .8, 1, 18, 1, true);
      const beam = new T.InstancedMesh(cone, new T.MeshBasicMaterial({
        map: beamTexture, color: color.clone().multiplyScalar(.16), transparent: true, depthWrite: false,
        blending: T.AdditiveBlending, side: T.DoubleSide, fog: false
      }), beams.length);
      beams.forEach((m, i) => beam.setMatrixAt(i, m));
      beam.renderOrder = 6;
      this.root.add(beam);
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(heads, 3));
    const glow = new T.ShaderMaterial({
      uniforms: { color: { value: color }, scale: { value: 400 }, size: { value: spec.beam ? 7 : 2.6 }, density: { value: this.mood.fogDensity } },
      vertexShader: glsl.glow.vertex, fragmentShader: glsl.glow.fragment,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false
    });
    this.materials.push(glow);
    const points = new T.Points(geo, glow);
    points.renderOrder = 7;
    this.root.add(points);
  }

  update(dt: number, camera: T.PerspectiveCamera, scale: number) {
    this.time += dt;
    this.dome.position.copy(camera.position);
    camera.getWorldDirection(this.forward);
    const origin = camera.position.clone().addScaledVector(this.forward.setY(0).normalize(), 18);
    if (this.mood.lightning) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) { this.flash = 1; this.nextBolt = 3.5 + Math.random() * 6; }
      this.flash = Math.max(0, this.flash - dt * 3.2);
    }
    const flash = this.flash > 0 ? this.flash * (.6 + .4 * Math.sin(this.flash * 40)) : 0;
    for (const { light, base } of this.lit) light.intensity = base * (1 + flash * 1.4);
    for (const material of this.materials) {
      const u = material.uniforms;
      if (u.time) u.time.value = this.time;
      if (u.scale) u.scale.value = scale;
      if (u.origin) u.origin.value.copy(origin);
      if (u.flash) u.flash.value = flash;
    }
  }

  dispose() {
    this.root.traverse(node => {
      if (node instanceof T.Mesh || node instanceof T.Points || node instanceof T.LineSegments) {
        if (node instanceof T.InstancedMesh) node.dispose();
        node.geometry.dispose();
        (node.material as T.Material).dispose();
      }
    });
    this.root.removeFromParent();
  }
}
