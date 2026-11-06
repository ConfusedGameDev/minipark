# Mini Skate Park

Build a skate park Townscaper-style, then skate it. Runs in the browser (desktop + mobile), no build step.

- **Build mode** – tap cells to raise them; quarter pipes, corners, copings and rail/ledge lines resolve automatically from their neighbours. Randomize for a seeded starter park.
- **Skate mode** – virtual stick (left half), JUMP button, swipe on the right half while airborne for tricks, hold JUMP onto a rail to grind. Combos multiply. A run ends when you use up your falls (default 3, adjustable in Settings).
- **Share** – the whole park is encoded in the URL hash (`#p=…`), shown as a QR code. Friends scan it and get the same park, with its own local leaderboard.

## Stack

Vanilla ES modules + [Three.js](https://threejs.org) + [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) (vendored, no CDN).
Terrain is one merged mesh with a BVH; the skater is a kinematic controller that samples it with raycasts.

- `js/park.js` – grid model, Townscaper-style tile resolution, URL encoding, procedural generator
- `js/tiles.js` – GLB loading, park mesh merging, grind-segment extraction
- `js/skater.js` – movement, air, grinds, tricks, falls, scoring
- `js/input.js` – virtual stick, jump button, swipes, keyboard
- `js/main.js` – app, editor, camera, UI, leaderboard, QR share

Keyboard: arrows/WASD move, Space jump, I/K/J/L swipe up/down/left/right, U/O/N/M diagonals, Esc pause.

## Run locally

Any static server, e.g. `npx serve .` or `python3 -m http.server`.

## Credits

Models: [Kenney Mini Skate](https://kenney.nl) (CC0).
