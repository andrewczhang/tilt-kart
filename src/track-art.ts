import * as T from 'three';
import type { Circuit } from './circuit';

type Shape = 'box' | 'cone' | 'stone' | 'mesa' | 'disc';
type Instance = { x: number; y: number; z: number; w: number; h: number; d: number; color: string; yaw: number; roll: number };

export function themedScenery(world: T.Group, track: Circuit) {
  let seed = 84771 + track.id.length * 1729;
  const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const batches = new Map<string, { shape: Shape; glow: boolean; items: Instance[] }>();
  const put = (shape: Shape, x: number, y: number, z: number, w: number, h: number, d: number, color: string, yaw = 0, roll = 0, glow = false) => {
    const key = shape + glow;
    if (!batches.has(key)) batches.set(key, { shape, glow, items: [] });
    batches.get(key)!.items.push({ x, y, z, w, h, d, color, yaw, roll });
  };
  const floor = -1.2;
  const markers = Array.from({ length: 160 }, (_, i) => track.frame(i / 160));
  const clear = (x: number, z: number, radius: number) => markers.every(p => Math.hypot(p.x - x, p.z - z) >= radius);
  const ground = new T.Mesh(new T.PlaneGeometry(2600, 2600), new T.MeshLambertMaterial({ color: track.ground }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = floor; world.add(ground);
  const choose = (items: string[]) => items[Math.floor(rand() * items.length)];
  const points = (count: number, distance: number, startSpread: number, spread: number) => {
    const result: { x: number; z: number }[] = [];
    for (let i = 0; i < count * 6 && result.length < count; i++) {
      const side = rand() > .5 ? 1 : -1;
      const { x, z } = track.point(rand(), side * (startSpread + rand() * spread));
      if (clear(x, z, distance)) result.push({ x, z });
    }
    return result;
  };
  const pine = (x: number, z: number, h: number, snow = false) => {
    put('box', x, floor + h * .34, z, h * .09, h * .68, h * .09, '#654738');
    for (let j = 0; j < 3; j++) {
      const w = h * (.36 - j * .07);
      put('cone', x, floor + h * (.42 + j * .21), z, w, h * .54, w, snow && j > 0 ? '#d4e6ed' : choose(['#254c43','#376657','#4d7758']), j);
    }
  };
  const mountains = (count: number, colors: string[], size = 40) => {
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2 + rand() * .13, r = 215 + rand() * 105;
      const w = (20 + rand() * 46) * size / 40, h = size * (.55 + rand() * 1.3);
      put('stone', Math.sin(a) * r, floor + h * .22, Math.cos(a) * r, w, h, w * .78, choose(colors), a);
    }
  };

  switch (track.id) {
    case 'frostline': {
      mountains(29, ['#8aa2b7','#b2c4d4','#e1ecf3'], 62);
      for (const { x, z } of points(135, 12, 15, 68)) pine(x, z, 3.8 + rand() * 8.2, true);
      for (const { x, z } of points(48, 14, 22, 85)) {
        const w = 1 + rand() * 9;
        put('stone', x, floor + w * .16, z, w, w * .62, w * .78, choose(['#adccde','#e9f3fb','#a2bccb']), rand() * 6);
      }
      for (const { x, z } of points(3, 20, 30, 42)) {
        put('box', x, floor + 2.2, z, 8, 4.4, 5.5, '#784c4b');
        put('mesa', x, floor + 5.1, z, 5.8, 1.5, 4.7, '#f0f6fa');
      }
      break;
    }
    case 'switchyard': {
      for (const { x, z } of points(62, 20, 23, 118)) {
        const w = 5.5 + rand() * 9, h = 7 + rand() * 40;
        const color = choose(['#314458','#3f526e','#26374f','#4e4860']);
        put('box', x, floor + h / 2, z, w, h, w * .91, color);
        const windows = choose(['#6cdbdb','#e7b375','#bc96aa']);
        for (let j = 3; j < h - 1; j += 3.2) {
          put('box', x, floor + j, z, w * .80, .52, w * .92, windows, 0, 0, true);
          put('box', x, floor + j, z, w * 1.01, .52, w * .70, windows, 0, 0, true);
        }
        if (rand() > .6) put('box', x, floor + h, z, w, .16, w * .91, '#50dec2', 0, 0, true);
      }
      for (let i = 0; i < 44; i++) {
        const s = i / 44, p = track.point(s, track.width / 2 + .52);
        const yaw = track.frame(s).heading;
        put('box', p.x, p.y + 1, p.z, .23, 2, .23, '#3c4d65', yaw);
        put('box', p.x, p.y + 2.0, p.z, .5, .18, .50, i % 3 ? '#7df6ee' : '#ffc176', yaw, 0, true);
      }
      const moon = new T.Mesh(new T.SphereGeometry(13, 12, 8), new T.MeshBasicMaterial({ color: '#fff2c2', fog: false }));
      moon.position.set(-192, 88, -188); world.add(moon);
      break;
    }
    case 'saltwater': {
      const palm = (x: number, z: number, y: number, h: number) => {
        put('mesa', x + .6, y + h * .50, z, .52, h, .52, '#a97653', 0, -.15);
        for (let j = 0; j < 6; j++) {
          const a = j * Math.PI / 3 + h;
          put('cone', x + .95 + Math.cos(a) * h * .21, y + h * .96, z + Math.sin(a) * h * .21, h * .14, h * .48, h * .17, choose(['#27765e','#4a9b69','#83b070']), -a, Math.PI * .58);
        }
      };
      for (const { x, z } of points(35, 20, 22, 88)) {
        const w = 5 + rand() * 9;
        put('disc', x, floor + .05, z, w * 1.65, .10, w * 1.43, '#69d0bb', rand() * 6);
        put('mesa', x, floor + .31, z, w, .68, w * .88, choose(['#f5d193','#ffdfa4','#e9cc96']), rand() * 6);
        for (let i = 0; i < 2 + rand() * 4; i++) palm(x + (rand() - .5) * w, z + (rand() - .5) * w, floor + .68, 3.4 + rand() * 5);
      }
      for (const { x, z } of points(30, 12, 15, 62)) {
        put('disc', x, floor + .015, z, 7 + rand() * 10, .02, .19, '#a0e5d8', rand() * 6);
      }
      for (const [x, z] of [[-95,37],[86,-10],[-19,-73]]) {
        put('stone', x, 1.3, z, 5, 2.3, 3.7, '#f3e1a3');
        put('box', x, 5, z, 1.7, 7, 1.7, '#f5ead5');
        put('box', x, 6.9, z, 1.82, 1.38, 1.82, '#e66b4f');
        put('cone', x, 9, z, 1.65, 1.6, 1.65, '#e66b4f');
      }
      break;
    }
    case 'cinder': {
      mountains(27, ['#513f48','#725156','#946660'], 50);
      for (const { x, z } of points(88, 16, 18, 69)) {
        const w = 1.2 + rand() * 5.7;
        put('stone', x, floor + w * .19, z, w, w * (rand() + .4), w * .76, choose(['#2f343c','#51424b','#755254']), rand() * 6);
      }
      for (const { x, z } of points(25, 13, 16, 96)) {
        const w = 2 + rand() * 6;
        put('disc', x, floor + .028, z, w * 2.35, .05, w, '#cd4535', .56, 0, true);
        put('disc', x, floor + .065, z, w * 1.82, .05, w * .56, choose(['#ff7136','#f3883c','#e85d37']), .56, 0, true);
      }
      put('mesa', -19, 19, -7, 47, 42, 43, '#51404a', .6);
      put('mesa', -19, 40, -7, 28, 9, 26, '#6a464c', .6);
      put('disc', -19, 44.6, -7, 15, .25, 13, '#ff6938', .6, 0, true);
      for (let i = 0; i < 8; i++) {
        put('stone', -20 + i * 3.1, 48 + i * 2.65, -8 + i * 1.6, 3 + i * 1.8, 2.4 + i * 1.3, 4 + i * 1.7, choose(['#996b6a','#936661','#aa7370']), i);
      }
      break;
    }
    case 'cedar': {
      mountains(26, ['#659468','#7e9e74','#63816b'], 52);
      for (const { x, z } of points(168, 10, 12, 78)) pine(x, z, 3 + rand() * 11.5);
      for (const { x, z } of points(90, 10, 13, 38)) {
        const w = 1 + rand() * 2.8;
        put('stone', x, floor + .4, z, w, w * .66, w * .90, choose(['#68834d','#547752','#91a467']), rand() * 6);
      }
      for (let i = 0; i < 19; i++) {
        const s = .04 + i * .0035, p = track.point(s, -track.width / 2 - 3.4, 1.45);
        put('box', p.x, p.y, p.z, .37, 3.8, .37, '#815937', track.frame(s).heading);
        put('box', p.x, p.y + .45, p.z, .28, .20, 3.9, '#af7548', track.frame(s).heading);
      }
      break;
    }
    case 'mesa': {
      for (const { x, z } of points(28, 24, 27, 98)) {
        const w = 5 + rand() * 12, h = 5 + rand() * 25, a = rand() * 6;
        for (let i = 0; i < 3; i++) {
          put('mesa', x, floor + h * (.18 + i * .27), z, w * (1 - .21 * i), h * .52, w * (.86 - .20 * i), ['#b76649','#d78e62','#a95540'][i], a);
        }
      }
      for (const [x, z] of [[-35,9],[38,-27]]) {
        put('mesa', x, 15, z, 28, 34, 25, '#aa523a', .5);
        put('mesa', x, 30, z, 17, 15, 18, '#c68158', .5);
        put('mesa', x, 41, z, 13, 10, 13, '#a45840', .5);
      }
      mountains(23, ['#ad6048','#ce8b62','#b86b54'], 64);
      for (const { x, z } of points(95, 12, 13, 59)) put('stone', x, .1, z, 2 + rand() * 5, 1 + rand() * 3, 2.7, choose(['#b4694b','#d08b5e','#994d3e']), rand() * 6);
      break;
    }
    case 'arena': {
      mountains(21, ['#73959f','#93a9b3','#b1c2c5'], 30);
      for (const [start, side] of [[.022,-1],[.120,1],[.380,-1],[.571,-1],[.905,1]]) {
        for (let i = 0; i < 9; i++) {
          const s = start + i * .004, yaw = track.frame(s).heading;
          for (let j = 0; j < 4; j++) {
            const p = track.point(s, side * (track.width / 2 + 5.1 + j * 1.9), .9 + j * .83);
            if (clear(p.x, p.z, track.width / 2 + 3)) {
              put('box', p.x, p.y, p.z, 2.05, 1.8 + j * 1.52, 3.93, j % 2 ? '#e8ad50' : '#676f89', yaw);
            }
          }
          const p = track.point(s, side * (track.width / 2 + 10.1), 6.8);
          if (clear(p.x, p.z, track.width / 2 + 5)) {
            put('box', p.x, p.y, p.z, 13.8, .52, 3.94, '#c24c61', yaw);
            if (i % 4 === 0) put('box', p.x, p.y - 3, p.z, .29, 6, .29, '#536078', yaw);
          }
        }
      }
      for (let i = 0; i < 16; i++) {
        const s = i / 16, side = i % 2 ? 1 : -1, yaw = track.frame(s).heading;
        const p = track.point(s, side * (track.width / 2 + 17));
        if (!clear(p.x, p.z, track.width / 2 + 7)) continue;
        put('box', p.x, p.y + 5, p.z, .26, 10, .26, '#536078', yaw);
        put('box', p.x, p.y + 10, p.z, 3.3, .52, .63, '#69758c', yaw);
        put('box', p.x, p.y + 10, p.z, 2.8, .27, .67, '#fff3d8', yaw, 0, true);
      }
      break;
    }
  }

  if (track.id !== 'cedar' && track.id !== 'switchyard') {
    for (let i = 0; i < 61; i++) {
      const s = i / 61, f = track.frame(s);
      if (f.y < 2.8 || (track.id === 'arena' && f.y > 10 && !markers.every(p => p.y > f.y - 8 || Math.hypot(p.x - f.x, p.z - f.z) > track.width * .93))) continue;
      for (const side of [-1, 1]) {
        const p = track.point(s, side * (track.width * .31));
        const h = p.y - floor - .65;
        if (h > 0) put('box', p.x, floor + h / 2, p.z, 1.8, h, 1.22, track.wall, f.heading);
      }
    }
  }
  const geometry = (shape: Shape) => {
    if (shape === 'box') return new T.BoxGeometry();
    if (shape === 'cone') return new T.ConeGeometry(1, 1, 6);
    if (shape === 'stone') return new T.DodecahedronGeometry(1, 0);
    if (shape === 'disc') return new T.CylinderGeometry(1, 1, 1, 10);
    return new T.CylinderGeometry(.66, 1, 1, 7);
  };
  const o = new T.Object3D(), color = new T.Color();
  for (const { shape, glow, items } of batches.values()) {
    const material = glow ? new T.MeshBasicMaterial() : new T.MeshLambertMaterial({ flatShading: true });
    const mesh = new T.InstancedMesh(geometry(shape), material, items.length);
    items.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z);
      o.scale.set(p.w, p.h, p.d);
      o.rotation.set(0, p.yaw, p.roll, 'YXZ');
      o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, color.set(p.color));
    });
    world.add(mesh);
  }
}
