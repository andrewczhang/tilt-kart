# Tilt Kart

Race eight three-lap 3D circuits, from Red Basin to the figure-eight overpass at Apex Arena. Practice on your own, race against bots, or host a race for up to eight drivers.

## How to play

1. Pick a track for **Solo practice** or **Vs bots** (2–8 racers, including you). In **Vs bots**, choose Easy, Normal, or Hard; a rematch keeps your grid size and difficulty. To play with friends, create a room and choose a driver name. The host picks the race format and track in the lobby. Use **Invite friends** to send the room link, then start when everybody is on the grid.
2. On a phone, turn it sideways and select **Enable tilt** before starting. Hold it like a wheel, or use **Left / Right** at any time. The kart accelerates automatically; hold **Brake / Drift** while steering, then release for a boost. Use **Recenter tilt** to set a new neutral angle.
3. On desktop, use **WASD** or the arrow keys. Hold **S**, **Down** or **Space** to brake. Hit the colored strips to boost, and keep clear of the curbs and barriers.
4. Use **Mute music** in the race HUD to silence the soundtrack without muting the kart's sound effects. Each circuit has an original house loop made with [Beat Lab](https://andrewcz.pages.dev/beats).

Choose **Grand Prix** to race a four-track cup against bots, or choose a cup under **Race format** in a multiplayer lobby. Finishers earn 15, 12, 10, 8, 6, 4, 2 or 1 point by place; a DNF earns none. Ties go to the driver with more wins, then more second places, and so on; the starting slot breaks any remaining tie. Read the running standings between races, then see the podium after race four. The host advances multiplayer cups; late arrivals watch until the host returns to the lobby.

## Develop

```sh
npm ci
npm run check
npm test
npm run build
npx wrangler dev
```

Open `http://localhost:8787`. Open an invite in another browser window to test multiplayer. `npm run dev` runs Vite with hot reload and proxies the room API to the Wrangler server on port 8787. Use HTTPS when testing motion sensors on an actual phone; a plain HTTP LAN IP is not a secure context.

## Worker

`npm run build && npx wrangler deploy` builds and deploys the `tilt-kart` Worker. It serves Vite's static assets with history fallback for `/r/<code>` and handles room creation and upgrades under `/api/`. A public Pages hostname can forward requests and upgrades through a service binding to this Worker.

Each room is a SQLite-backed Durable Object. Hibernating WebSockets retain each driver's slot, pose and checkpoint in the socket attachment. Automatic ping replies do not wake the object. There is no server tick, alarm, or server heartbeat timer. Clients send kart poses at about 18 Hz only while racing; the server validates movement, tracks checkpoints and ranks finishers. Only room lifecycle changes write to storage. A race has a three-minute limit and an invite is valid for up to 12 hours. Reopen it in the same browser profile to return to your kart or see results. New arrivals with a free room slot can spectate a race in progress and join the next grid when the host selects **Rematch**.
