import * as T from 'three';
import type { Circuit } from './circuit';

type Piece = { position: T.Vector3; scale: [number, number, number]; heading: number; color: string; roll: number };

export function landmarks(world: T.Group, track: Circuit) {
  const solid: Piece[] = [], lights: Piece[] = [], stone: Piece[] = [];
  const feature = track.feature;
  const add = (s: number, lane: number, y: number, scale: Piece['scale'], color: string, roll = 0, batch = solid) => {
    batch.push({ position: track.point(s, lane, y), scale, heading: track.frame(s).heading, color, roll });
  };
  const portal = (s: number, top: number, color: string, thickness: number, light?: string) => {
    const span = track.widthAt(s) / 2 + .78;
    for (const side of [-1, 1]) add(s, span * side, top / 2, [thickness, top, thickness], color);
    add(s, 0, top, [span * 2 + thickness, thickness, thickness], color);
    if (light) add(s, 0, top - thickness * .56, [span * 1.72, .1, .33], light, 0, lights);
  };
  const step = (meters: number, fn: (s: number, i: number) => void) => {
    const count = Math.max(1, Math.round((feature.end - feature.start) * track.length / meters));
    for (let i = 0; i <= count; i++) fn(feature.start + (feature.end - feature.start) * i / count, i);
  };
  const { start, end, kind } = feature;
  switch (kind) {
    case 'pit':
      step(6, (s, i) => {
        const branch = track.branchAt(s)!;
        const lane = branch.center + branch.width / 2 + 2.1;
        add(s, lane, 1.7, [3.5, 3.4, 5.3], '#e8c99d');
        add(s, lane - .4, 3.6, [4.6, .4, 5.8], i % 2 ? '#ac452f' : '#cc6241');
        add(s, lane - 1.84, 1.5, [.18, 2.1, 3.6], '#393947');
      });
      break;
    case 'gondola':
      step(15, (s, i) => {
        const lane = track.widthAt(s) / 2 + 4.2;
        add(s, lane, -2, [1.3, 24, 1.3], '#3d667c');
        add(s, lane, 9, [5.5, .5, 1.1], '#3d667c');
        add(s, lane - 1.5, 8.5, [.12, .16, 15.5], '#345e76');
        if (i % 2) {
          add(s, lane - 1.5, 6.8, [3.1, 2.35, 3.7], '#d15336');
          add(s, lane - 1.5, 7.1, [3.17, .96, 3.75], '#a2c9de');
        }
      });
      break;
    case 'tunnel':
      step(4.4, (s, i) => {
        const width = track.widthAt(s);
        for (const side of [-1, 1]) {
          add(s, side * (width / 2 + 1.6), 3.9, [1.8, 7.8, 5.5], '#2b354b');
          add(s, side * (width / 2 + .66), 2.6, [.15, .22, 4.7], i % 3 ? '#3ef3de' : '#ffac48', 0, lights);
        }
        add(s, 0, 8.5, [width + 6, 1.7, 5.8], '#252d41');
        if (i % 2 === 0) portal(s, 7.2, '#496079', .42, '#67dacc');
      });
      break;
    case 'pier':
      step(7, (s, i) => {
        const width = track.widthAt(s);
        for (const side of [-1, 1]) {
          add(s, side * (width / 2 + .95), -.6, [.56, 5.8, .56], '#ad7450');
          add(s, side * (width / 2 + .95), 2.35, [.72, .35, .72], '#fff4c3');
          if (i % 2 === 0) add(s, side * (width / 2 + .95), 2.85, [.39, .74, .39], '#f0763a');
        }
      });
      portal(start, 7.0, '#197e80', .66, '#ffe299');
      break;
    case 'truss':
      step(7.8, (s, i) => {
        const span = track.widthAt(s) / 2 + 1.25;
        portal(s, 9.4, '#513c49', .7, i % 2 ? undefined : '#ff8a42');
        for (const side of [-1, 1]) {
          add(s, side * span, -.8, [.56, .62, 8.9], '#433542');
          add(s, side * span, 9.4, [.55, .55, 8.9], '#7e4b4b');
        }
        add(s, 0, -.78, [span * 2.1, .34, .62], '#68454d');
      });
      break;
    case 'logs':
      step(2.8, (s, i) => {
        portal(s, 6.9, i % 2 ? '#5c4b31' : '#806042', .7);
        for (const side of [-1, 1]) {
          add(s, side * (track.widthAt(s) / 2 + .52), 5.5, [1.15, 3.15, .7], '#685239', side * .33);
          if (i % 3 === 0) add(s, side * (track.widthAt(s) / 2 + .31), 3.15, [.27, .67, .48], '#ffd07a', 0, lights);
        }
      });
      break;
    case 'mesa':
      for (const side of [-1, 1]) {
        add(start, side * 39, -19, [23, 68, 25], '#9f4c3d', 0, stone);
        add(end, side * 37, -24, [19, 68, 31], '#bc6747', side * .11, stone);
        add(start, side * 34, 1, [13, 9, 22], '#f49966', 0, stone);
      }
      break;
    case 'bowl':
      step(6.5, (s, i) => {
        const edge = track.widthAt(s) / 2;
        for (let row = 0; row < 5; row++) {
          add(s, edge + 3 + row * 2, 1 + row * 1.15, [2.05, 1.5 + row * .55, 6.55],
            i % 4 < 2 ? '#c94451' : '#507284');
        }
        if (i % 6 === 0) {
          add(s, edge + 13.2, 8, [.6, 14, .6], '#3f4d66');
          add(s, edge + 13.2, 15, [4.4, .5, 1.2], '#e5f3d5', 0, lights);
        }
      });
      break;
  }
  const sign = (s: number, lane: number, title: string, width: number) => {
    const board = document.createElement('canvas');
    board.width = 768; board.height = 96;
    const ctx = board.getContext('2d')!;
    ctx.fillStyle = track.sign[0]; ctx.fillRect(0, 0, board.width, board.height);
    ctx.fillStyle = track.sign[1]; ctx.font = '900 58px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(title.toUpperCase(), 384, 69, 716);
    const texture = new T.CanvasTexture(board); texture.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(new T.PlaneGeometry(width, width / 8), new T.MeshBasicMaterial({map: texture}));
    mesh.position.copy(track.point(s, lane, 5.8));
    mesh.rotation.y = track.frame(s).heading + Math.PI;
    world.add(mesh);
  };
  if (track.branch) {
    const s = track.branch.start + .016;
    const b = track.branchAt(s)!;
    const lane = b.side * (track.widthAt(s) / 2 + 2.3);
    add(s, lane, 2.8, [.36, 5.6, .36], track.wall);
    sign(s, lane, b.name, 6.5);
  }
  if (kind !== 'pit') {
    const lane = kind === 'pier' || kind === 'logs' || kind === 'truss' || kind === 'tunnel' ? 0 : -track.widthAt(start) / 2 - 2;
    if (lane) add(start, lane, 2.6, [.46, 5.2, .46], track.wall);
    sign(start, lane, feature.label, lane ? 8 : Math.min(12, track.widthAt(start) - 1));
  }
  const { jumps = [] } = track;
  for (const jump of jumps) {
    for (const s of [jump.start - .001, jump.end + .001]) {
      for (const side of [-1, 1]) {
        const lane = side * (track.widthAt(s) / 2 + .55);
        add(s, lane, 1.1, [.55, 2.2, .55], track.wall);
        add(s, lane, 2.18, [.95, .45, .75], '#ffc35c', 0, lights);
      }
    }
  }
  const transform = new T.Object3D(), tint = new T.Color();
  for (const [batch, material, geometry] of [
    [solid, new T.MeshLambertMaterial({flatShading: true}), new T.BoxGeometry()],
    [lights, new T.MeshBasicMaterial(), new T.BoxGeometry()],
    [stone, new T.MeshLambertMaterial({flatShading: true}), new T.DodecahedronGeometry(1, 0)]
  ] as const) {
    if (!batch.length) { material.dispose(); geometry.dispose(); continue; }
    const mesh = new T.InstancedMesh(geometry, material, batch.length);
    batch.forEach((p, i) => {
      transform.position.copy(p.position);
      transform.rotation.set(0, p.heading, p.roll, 'YXZ');
      transform.scale.set(...p.scale);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, tint.set(p.color));
    });
    world.add(mesh);
  }
}
