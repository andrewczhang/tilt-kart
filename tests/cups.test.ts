import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalRace } from '../src/bots';
import { LIMIT, RED_BASIN } from '../src/circuit';
import { CUPS, CUP_POINTS, cupStandings, newCup, nextRound, scoreRound } from '../src/cups';
import { TRACK_IDS } from '../src/tracks';

test('cups cover the existing track roster and score all eight finish places', () => {
  assert.deepEqual(Object.values(CUPS).flatMap(cup => cup.tracks).sort(), [...TRACK_IDS].sort());
  const cup = newCup('summit');
  const racers = CUP_POINTS.map((_, slot) => ({ id: String(slot), name: String(slot), slot, finish: slot }));
  assert.equal(nextRound(cup), undefined);
  const scored = scoreRound(cup, racers.reverse());
  assert.deepEqual(cupStandings(scored).map(entry => entry.total), CUP_POINTS);
  assert.equal(scoreRound(scored, racers), scored);
});

test('DNFs score zero and total ties go to the driver with more wins', () => {
  const entries = (order: number[]) => Array.from({ length: 8 }, (_, slot) => ({
    id: String(slot), name: String(slot), slot, finish: order.includes(slot) ? order.indexOf(slot) + 1 : null,
  }));
  const first = scoreRound(newCup('summit'), entries([7, 1, 2, 0, 6, 4, 5, 3]));
  const second = scoreRound(nextRound(first)!, entries([6, 1, 2, 0, 3, 4, 5, 7]));
  const ranked = cupStandings(second);
  assert.deepEqual(ranked.filter(d => d.total === 16).map(d => d.id), ['7', '0']);
  const third = scoreRound(nextRound(second)!, entries([1, 2]));
  assert.deepEqual(cupStandings(third).find(d => d.id === '7')?.points, [15, 1, 0]);
});

test('local races complete all four rounds against the same bots and stop at the podium', () => {
  let cup = newCup('summit');
  for (const [round, track] of CUPS.summit.tracks.entries()) {
    const race = new LocalRace(4, 0, RED_BASIN, cup);
    assert.equal(race.room.track, track);
    assert.equal(race.room.cup?.round, round);
    const input = { steer: 0, gas: true, brake: false };
    for (let elapsed = 20; elapsed <= LIMIT && !race.room.complete; elapsed += 20) race.step(input, .02, elapsed);
    assert.equal(race.room.complete, true);
    const scored = race.room.cup!;
    assert.equal(scored.results.length, round + 1);
    assert.equal(cupStandings(scored).length, 4);
    assert.ok(scored.results[round].some(d => d.place !== null && d.id.startsWith('bot-')));
    if (round < 3) cup = nextRound(scored)!;
    else assert.equal(nextRound(scored), undefined);
  }
});
