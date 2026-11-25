type Nameplate = { x: number; y: number; width: number; height: number; distance: number };
type Position = { left: number; top: number };

const GAP = 3;
const STACK_ROWS = 2;

export function layoutNameplates<T extends Nameplate>(plates: T[], width: number, height: number) {
  const placed = new Map<T, Position>();
  for (const plate of [...plates].sort((a, b) => a.distance - b.distance)) {
    if (plate.width > width || plate.height > height) continue;
    const left = Math.max(0, Math.min(width - plate.width, plate.x - plate.width / 2));
    const anchor = Math.max(0, Math.min(height - plate.height, plate.y - plate.height / 2));
    const limit = Math.max(0, anchor - STACK_ROWS * (plate.height + GAP));
    let top = anchor;
    while (top >= limit) {
      let next = top;
      for (const [other, position] of placed) {
        if (left < position.left + other.width + GAP && left + plate.width + GAP > position.left
            && top < position.top + other.height + GAP && top + plate.height + GAP > position.top) {
          next = Math.min(next, position.top - plate.height - GAP);
        }
      }
      if (next === top) {
        placed.set(plate, { left, top });
        break;
      }
      top = next;
    }
  }
  return placed;
}
