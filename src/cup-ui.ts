import { COLORS } from './circuit';
import { CUPS, CUP_IDS, cupStandings, type Cup, type CupId } from './cups';
import { TRACKS } from './tracks';

export function cupSelector(selected?: CupId, allowSingle = false) {
  const options = CUP_IDS.map(id => `<option value="${id}"${selected === id ? ' selected' : ''}>${CUPS[id].name}</option>`);
  if (allowSingle) options.unshift('<option value="single">Single race</option>');
  return `<label for="cup-select">${allowSingle ? 'Race format' : 'Cup'}</label><select id="cup-select">${options.join('')}</select>`;
}

export function cupItinerary(id: CupId) {
  return `<ol class="cup-route" aria-label="Cup tracks">${CUPS[id].tracks.map(track => `<li>${TRACKS[track].name}</li>`).join('')}</ol>`;
}

export function fillCupResults(cup: Cup, player: string) {
  const ranked = cupStandings(cup);
  const table = document.querySelector('#cup-table tbody')!;
  for (const [i, entry] of ranked.entries()) {
    const row = table.appendChild(document.createElement('tr'));
    const name = row.appendChild(document.createElement('th'));
    name.scope = 'row';
    name.textContent = `${i + 1}. ${entry.name}${entry.id === player ? ' (you)' : ''}`;
    if (entry.id === player) row.className = 'cup-you';
    for (const points of entry.points) row.insertCell().textContent = String(points);
    row.insertCell().textContent = String(entry.total);
  }
  const podium = document.getElementById('cup-podium');
  if (!podium) return;
  for (const [i, entry] of ranked.filter(e => e.total > 0).slice(0, 3).entries()) {
    const step = document.createElement('li');
    step.style.setProperty('--kart-color', COLORS[entry.slot]);
    const place = document.createElement('strong');
    const name = document.createElement('span');
    place.textContent = ['1st', '2nd', '3rd'][i];
    name.textContent = entry.name;
    step.append(place, name);
    podium.appendChild(step);
  }
  if (!podium.childElementCount) {
    const empty = document.createElement('p');
    empty.textContent = 'No classified finishers.';
    podium.replaceWith(empty);
  }
}
