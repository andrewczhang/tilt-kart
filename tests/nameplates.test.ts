import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutNameplates } from '../src/nameplates';

const plate = (x: number, y: number, distance: number, width = 60) => ({ x, y, distance, width, height: 18 });

test('separate nameplates stay centered at their projected positions', () => {
  const a = plate(65, 80, 40), b = plate(165, 81, 20);
  const layout = layoutNameplates([a, b], 300, 180);
  assert.deepEqual(layout.get(a), { left: 35, top: 71 });
  assert.deepEqual(layout.get(b), { left: 135, top: 72 });
});

test('overlapping nameplates stack with a gap and prioritize the nearest kart', () => {
  const near = plate(90, 80, 10), mid = plate(140, 84, 25, 80), far = plate(112, 80, 60);
  const layout = layoutNameplates([far, mid, near], 300, 180);
  assert.deepEqual(layout.get(near), { left: 60, top: 71 });
  assert.deepEqual(layout.get(mid), { left: 100, top: 50 });
  assert.deepEqual(layout.get(far), { left: 82, top: 29 });
});

test('crowded nameplates are omitted rather than shifted too far from their karts', () => {
  const plates = [40, 30, 10, 20].map(distance => plate(90, 80, distance));
  const layout = layoutNameplates(plates, 300, 180);
  assert.deepEqual([...layout.keys()].map(p => p.distance), [10, 20, 30]);
});

test('nameplates stay entirely inside the viewport and do not stack above it', () => {
  const near = plate(5, 8, 10), far = plate(5, 8, 20), edge = plate(295, 179, 15);
  const layout = layoutNameplates([far, near, edge], 300, 180);
  assert.deepEqual(layout.get(near), { left: 0, top: 0 });
  assert.deepEqual(layout.get(edge), { left: 240, top: 162 });
  assert.equal(layout.has(far), false);
});
