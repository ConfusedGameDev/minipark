import * as THREE from 'three';
import { Park, PROPS, PROP_INDEX, generatePark, LEVEL_H } from './park.js';
import { TileLibrary } from './tiles.js';
import { Skater } from './skater.js';
import { Input } from './input.js';
import { TRICK_LIST } from './tricks.js';

const $ = id => document.getElementById(id);
const fwdOf = yaw => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

// ---------------------------------------------------------------- settings
const settings = Object.assign({ falls: 3, character: 'boy', sens: 1, shadows: true }, JSON.parse(localStorage.getItem('msp-settings') || '{}'));
const saveSettings = () => localStorage.setItem('msp-settings', JSON.stringify(settings));

const orbit = { yaw: Math.PI / 4, pitch: 0.95, dist: 17, target: new THREE.Vector3(0, 0.3, 0) };
// ---------------------------------------------------------------- renderer / scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = settings.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7cc4ea);
scene.fog = new THREE.Fog(0x7cc4ea, 22, 48);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x5a8a4a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2dc, 1.6);
sun.position.set(6, 12, 4); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -11; sun.shadow.camera.right = sun.shadow.camera.top = 11; sun.shadow.camera.near = 1; sun.shadow.camera.far = 40; sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x5fae56 }));
grass.rotation.x = -Math.PI / 2; grass.position.y = -0.01; grass.receiveShadow = true; scene.add(grass);

function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); orbit.dist = THREE.MathUtils.clamp(16 * Math.max(1, 1.25 / camera.aspect), 7, 44); }
addEventListener('resize', resize); resize();

// ---------------------------------------------------------------- state
const lib = new TileLibrary();
let park = null, parkMesh = null, grinds = [];
let mode = 'loading'; // build | play | paused
let skater = null, input = null;
let lastT = performance.now();
const hover = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.08, 1.02), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
hover.visible = false; scene.add(hover);

const cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3() };

function rebuildPark(updateHash = true) {
  if (parkMesh) { scene.remove(parkMesh); parkMesh.geometry.dispose(); }
  const built = lib.build(park);
  parkMesh = built.mesh; grinds = built.grinds; scene.add(parkMesh);
  if (skater) skater.setWorld(parkMesh, grinds, park);
  if (updateHash) history.replaceState(null, '', '#p=' + park.encode());
}

// ---------------------------------------------------------------- build mode
const TOOLS = [
  { id: 'raise', label: 'Raise', ico: '⬆' }, { id: 'lower', label: 'Lower', ico: '⬇' },
  ...PROPS.map(p => ({ id: p.id, label: p.label, ico: { rail: '╱', railhigh: '╱', ledge: '▬', ledgerail: '▬', box: '▢', boxgrind: '▭', ramp: '◢', ramprail: '◢', steps: '≡', stepsrail: '≡', bench: '🪑', benches: '🪑', pallet: '▦', wood: '▩' }[p.id] })),
  { id: 'erase', label: 'Erase', ico: '✕' },
];
let tool = 'raise';
const palette = $('palette');
for (const t of TOOLS) {
  const b = document.createElement('button');
  b.innerHTML = `<span class="ico">${t.ico}</span>${t.label}`; b.dataset.tool = t.id;
  b.addEventListener('click', () => { tool = t.id; for (const x of palette.children) x.classList.toggle('active', x.dataset.tool === tool); updateHint(); });
  palette.appendChild(b);
}
palette.firstChild.classList.add('active');
function updateHint() {
  const def = PROPS[PROP_INDEX[tool]];
  $('build-hint').textContent = tool === 'raise' ? 'Tap a cell to raise it (tap again for higher) · drag to orbit · pinch to zoom'
    : tool === 'lower' ? 'Tap a raised cell to lower it' : tool === 'erase' ? 'Tap a prop to remove it'
    : def?.line ? `Tap flat cells to draw ${def.label.toLowerCase()} lines — pieces connect automatically` : def?.rot ? `Tap a flat cell to place a ${def.label.toLowerCase()} · tap again to rotate` : `Tap a flat cell to place a ${def.label.toLowerCase()}`;
}

const pointers = new Map();
let dragging = false, pinchDist = 0, downPos = null;
canvas.addEventListener('pointerdown', e => {
  if (mode !== 'build') return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  if (pointers.size === 1) { dragging = false; downPos = { x: e.clientX, y: e.clientY }; }
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', e => {
  if (mode !== 'build') return;
  if (!pointers.has(e.pointerId)) { updateHover(e.clientX, e.clientY); return; }
  const p = pointers.get(e.pointerId); const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) {
    if (downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 8) dragging = true;
    if (dragging) { orbit.yaw -= dx * 0.006 * settings.sens; orbit.pitch = THREE.MathUtils.clamp(orbit.pitch - dy * 0.005 * settings.sens, 0.35, 1.45); }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist) orbit.dist = THREE.MathUtils.clamp(orbit.dist * (pinchDist / d), 7, 44);
    pinchDist = d; dragging = true;
  }
});
const endPointer = e => {
  if (mode !== 'build') return;
  if (pointers.size === 1 && !dragging && downPos) applyTool(e.clientX, e.clientY);
  pointers.delete(e.pointerId); if (pointers.size < 2) pinchDist = 0; if (!pointers.size) downPos = null;
};
canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', e => { if (mode === 'build') orbit.dist = THREE.MathUtils.clamp(orbit.dist * (1 + Math.sign(e.deltaY) * 0.1), 7, 44); }, { passive: true });

const rc = new THREE.Raycaster(); rc.firstHitOnly = true;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function cellAt(sx, sy) {
  rc.setFromCamera(new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1), camera);
  const hits = rc.intersectObject(parkMesh, false);
  let pt = hits[0]?.point;
  if (!pt) { pt = new THREE.Vector3(); if (!rc.ray.intersectPlane(groundPlane, pt)) return null; }
  const half = park.size / 2;
  const x = Math.floor(pt.x + half), y = Math.floor(pt.z + half);
  return park.inBounds(x, y) ? [x, y] : null;
}
function updateHover(sx, sy) {
  const c = cellAt(sx, sy);
  hover.visible = !!c;
  if (c) { const half = park.size / 2; hover.position.set(c[0] - half + 0.5, park.height(c[0], c[1]) + 0.05, c[1] - half + 0.5); }
}
function applyTool(sx, sy) {
  const c = cellAt(sx, sy); if (!c) return;
  const [x, y] = c;
  const lvl = park.level(x, y);
  if (tool === 'raise') { if (lvl < 2) { park.setLevel(x, y, lvl + 1); park.setProp(x, y, null); } else toast('Already at max height'); }
  else if (tool === 'lower') { if (lvl > 0) { park.setLevel(x, y, lvl - 1); park.setProp(x, y, null); } }
  else if (tool === 'erase') { park.setProp(x, y, null); }
  else {
    const type = PROP_INDEX[tool];
    const existing = park.prop(x, y);
    if (existing && existing.type === type) {
      if (PROPS[type].rot) park.setProp(x, y, type, (existing.rot + 1) & 3); else park.setProp(x, y, null);
    } else if (!park.isFlat(x, y)) { toast('Props need a flat cell'); return; }
    else park.setProp(x, y, type, 0);
  }
  // props that lost their flat cell (neighbour changes) are dropped
  for (const [k] of [...park.props]) { const [px, py] = k.split(',').map(Number); if (!park.isFlat(px, py)) park.setProp(px, py, null); }
  rebuildPark();
  updateHover(sx, sy);
}

$('btn-random').addEventListener('click', () => { park = generatePark(); rebuildPark(); toast('New park!'); });
$('btn-clear').addEventListener('click', () => { park.clear(); rebuildPark(); });
$('btn-play').addEventListener('click', startPlay);

// ---------------------------------------------------------------- play mode
function startPlay() {
  if (!skater) {
    skater = new Skater({ lib, scene, character: settings.character, emit: onSkaterEvent });
    input = new Input($('play'), $('stick'), $('btn-jump'));
  }
  skater.setWorld(parkMesh, grinds, park);
  window.__skater = skater;
  skater.resetRun(settings.falls);
  skater.spawnAt(...park.spawn());
  skater.view.root.visible = true;
  cam.yaw = skater.yaw; cam.pos.copy(skater.pos).add(new THREE.Vector3(0, 1.7, -3.4)); cam.look.copy(skater.pos);
  setMode('play');
  updateHud();
  hideAll();
}
function stopPlay() { if (skater) skater.view.root.visible = false; setMode('build'); hideAll(); }

function setMode(m) {
  mode = m;
  $('build').classList.toggle('hidden', m !== 'build');
  $('play').classList.toggle('hidden', !(m === 'play' || m === 'paused'));
  $('play').style.pointerEvents = m === 'play' ? 'auto' : 'none';
  input?.setEnabled(m === 'play');
  hover.visible = false;
}

let comboTimer = 0;
function onSkaterEvent(type, d) {
  if (type === 'trick') {
    showTrick(d.name + (d.points ? ` +${d.points}` : ''));
    $('combo').textContent = d.chain.map(t => t.name).join(' + ') + (d.chain.length > 1 ? `  ×${Math.min(d.chain.length, 8)}` : '');
  } else if (type === 'land') {
    showTrick(`+${d.total}`);
    $('combo').textContent = d.chain.map(t => t.name).join(' + ') + (d.mult > 1 ? `  ×${d.mult} = ${d.total}` : '');
    comboTimer = 1.6; updateHud();
  } else if (type === 'fall') {
    showTrick(d.reason, true); $('combo').textContent = ''; updateHud();
  } else if (type === 'gameover') { gameOver(); }
}
let trickTimer = 0;
function showTrick(text, bad = false) { const el = $('trickname'); el.textContent = text; el.classList.toggle('bad', bad); el.classList.add('show'); trickTimer = 1.1; }
function updateHud() {
  $('score').textContent = skater.score;
  $('falls').textContent = '♥'.repeat(Math.max(0, skater.falls)) + '♡'.repeat(Math.max(0, skater.fallsMax - skater.falls));
}

$('btn-pause').addEventListener('click', () => { if (mode === 'play') { setMode('paused'); show('pause'); } });
$('btn-resume').addEventListener('click', () => { hideAll(); setMode('play'); lastT = performance.now(); });
$('btn-restart').addEventListener('click', startPlay);
$('btn-tobuild').addEventListener('click', stopPlay);
$('btn-go-build').addEventListener('click', stopPlay);
$('btn-again').addEventListener('click', startPlay);
$('btn-tricks2').addEventListener('click', () => show('tricks'));
$('btn-leaderboard2').addEventListener('click', () => { renderBoard($('lb-board')); show('leaderboard'); });

// ---------------------------------------------------------------- leaderboard (per park, localStorage)
const boardKey = () => 'msp-lb-' + park.hash();
const loadBoard = () => JSON.parse(localStorage.getItem(boardKey()) || '[]');
function renderBoard(ol, highlight = -1) {
  ol.innerHTML = '';
  loadBoard().forEach((e, i) => { const li = document.createElement('li'); li.innerHTML = `<span>${escapeHtml(e.name)}</span><span>${e.score}</span>`; if (i === highlight) li.classList.add('me'); ol.appendChild(li); });
}
function gameOver() {
  setMode('paused');
  const board = loadBoard();
  const qualifies = skater.score > 0 && (board.length < 10 || skater.score > board[board.length - 1].score);
  $('go-score').textContent = skater.score;
  $('go-entry').classList.toggle('hidden', !qualifies);
  $('go-name').value = localStorage.getItem('msp-name') || '';
  renderBoard($('go-board'));
  show('gameover');
  if (qualifies) setTimeout(() => $('go-name').focus(), 50);
}
$('btn-save-score').addEventListener('click', () => {
  const name = ($('go-name').value.trim() || 'Skater').slice(0, 12);
  localStorage.setItem('msp-name', name);
  const board = loadBoard(); board.push({ name, score: skater.score, date: Date.now() });
  board.sort((a, b) => b.score - a.score); board.length = Math.min(board.length, 10);
  localStorage.setItem(boardKey(), JSON.stringify(board));
  $('go-entry').classList.add('hidden');
  renderBoard($('go-board'), board.findIndex(e => e.name === name && e.score === skater.score));
});
$('btn-lb-clear').addEventListener('click', () => { if (confirm('Clear scores for this park?')) { localStorage.removeItem(boardKey()); renderBoard($('lb-board')); } });

// ---------------------------------------------------------------- share
$('btn-share').addEventListener('click', () => {
  const url = location.origin + location.pathname + '#p=' + park.encode();
  $('share-url').value = url;
  const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  $('btn-native-share').classList.toggle('hidden', !navigator.share);
  show('share');
});
$('btn-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('share-url').value); toast('Link copied'); } catch { $('share-url').select(); toast('Select and copy the link'); } });
$('btn-native-share').addEventListener('click', () => navigator.share?.({ title: 'Mini Skate Park', text: 'Skate my park!', url: $('share-url').value }).catch(() => {}));

// ---------------------------------------------------------------- settings / tricks / modals
$('falls-range').value = settings.falls; $('falls-val').textContent = settings.falls;
$('falls-range').addEventListener('input', e => { settings.falls = +e.target.value; $('falls-val').textContent = settings.falls; saveSettings(); });
$('sens-range').value = settings.sens; $('sens-val').textContent = settings.sens.toFixed(1);
$('sens-range').addEventListener('input', e => { settings.sens = +e.target.value; $('sens-val').textContent = settings.sens.toFixed(1); saveSettings(); });
$('shadows').checked = settings.shadows;
$('shadows').addEventListener('change', e => { settings.shadows = e.target.checked; saveSettings(); renderer.shadowMap.enabled = settings.shadows; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); });
function refreshCharButtons() { $('char-boy').classList.toggle('active', settings.character === 'boy'); $('char-girl').classList.toggle('active', settings.character === 'girl'); }
for (const w of ['boy', 'girl']) $('char-' + w).addEventListener('click', () => { settings.character = w; saveSettings(); refreshCharButtons(); if (skater) { skater.setCharacter(w); skater.view.root.visible = mode !== 'build'; } });
refreshCharButtons();
$('btn-settings').addEventListener('click', () => show('settings'));
$('btn-tricks').addEventListener('click', () => show('tricks'));
$('tricktable').innerHTML = TRICK_LIST.map(([n, k, p]) => `<tr><td>${n}</td><td><span class="key">${k}</span></td><td>${p}</td></tr>`).join('');
for (const b of document.querySelectorAll('.close')) b.addEventListener('click', () => { b.closest('.screen').classList.add('hidden'); });
function show(id) { $(id).classList.remove('hidden'); }
function hideAll() { for (const id of ['pause', 'gameover', 'leaderboard', 'tricks', 'settings', 'share']) $(id).classList.add('hidden'); }
let toastT = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 1800); }
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
addEventListener('keydown', e => { if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') { setMode('paused'); show('pause'); } else if (mode === 'paused' && !$('pause').classList.contains('hidden')) { hideAll(); setMode('play'); } } });

// ---------------------------------------------------------------- loop
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (mode === 'build') {
    scene.fog.near = orbit.dist + 12; scene.fog.far = orbit.dist + 50;
    const t = orbit.target;
    camera.position.set(t.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist, t.y + Math.sin(orbit.pitch) * orbit.dist, t.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.dist);
    camera.lookAt(t);
  } else if (mode === 'play' || mode === 'paused') {
    scene.fog.near = 22; scene.fog.far = 48;
    if (mode === 'play' && !window.__noloop) {
      const snap = input.poll(dt);
      const f = fwdOf(cam.yaw), r = new THREE.Vector3(-f.z, 0, f.x);
      const mv = f.multiplyScalar(snap.move.y).add(r.multiplyScalar(snap.move.x));
      skater.update(dt, { ...snap, move: mv });
      if (trickTimer > 0) { trickTimer -= dt; if (trickTimer <= 0) $('trickname').classList.remove('show'); }
      if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) $('combo').textContent = ''; }
    }
    // follow camera
    const s = skater;
    const moving = Math.abs(s.speed) > 0.6 || s.state === 'air' || s.state === 'grind';
    let targetYaw = cam.yaw;
    if (moving) {
      const v = s.state === 'air' ? s.vel : fwdOf(s.yaw).multiplyScalar(Math.sign(s.speed) || 1);
      if (Math.hypot(v.x, v.z) > 0.3) targetYaw = Math.atan2(v.x, v.z);
    }
    let d = Math.atan2(Math.sin(targetYaw - cam.yaw), Math.cos(targetYaw - cam.yaw));
    cam.yaw += d * Math.min(1, dt * 2.2);
    const f = fwdOf(cam.yaw);
    const desired = s.pos.clone().addScaledVector(f, -3.6).add(new THREE.Vector3(0, 1.9, 0));
    const look = s.pos.clone().add(new THREE.Vector3(0, 0.5, 0));
    // keep the camera out of the terrain: pull it in along the look ray if something is in the way, and keep it above the ground
    const dir = desired.clone().sub(look); const len = dir.length(); dir.normalize();
    rc.set(look, dir); rc.far = len; rc.near = 0;
    const blk = rc.intersectObject(parkMesh, false)[0];
    if (blk) desired.copy(look).addScaledVector(dir, Math.max(0.6, blk.distance - 0.25));
    rc.set(desired.clone().add(new THREE.Vector3(0, 3, 0)), new THREE.Vector3(0, -1, 0)); rc.far = 3.5;
    const under = rc.intersectObject(parkMesh, false)[0];
    if (under && desired.y < under.point.y + 0.5) desired.y = under.point.y + 0.5;
    cam.pos.lerp(desired, Math.min(1, dt * 6));
    cam.look.lerp(look, Math.min(1, dt * 8));
    camera.position.copy(cam.pos); camera.lookAt(cam.look);
    sun.position.copy(s.pos).add(new THREE.Vector3(6, 12, 4)); sun.target.position.copy(s.pos);
  }
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------- boot
(async () => {
  await lib.load('assets/models/', p => { $('loadbar').style.width = (p * 100) + '%'; });
  const m = location.hash.match(/#p=([A-Za-z0-9_-]+)/);
  if (m) { try { park = Park.decode(m[1]); toast('Park loaded from link'); } catch (e) { console.warn(e); } }
  if (!park) park = generatePark();
  rebuildPark();
  $('loading').classList.add('hidden');
  setMode('build'); updateHint();
  lastT = performance.now();
  requestAnimationFrame(frame);
})();
window.__sim = (secs, inp = {}) => { // deterministic stepping for tests: inp = { x, z, jump, hold, swipe, spinHold }
  const n = Math.round(secs * 60); const ev = [];
  const old = skater.emit; skater.emit = (t, d) => { ev.push(t + ':' + (d.name || d.reason || d.total || '')); old(t, d); };
  for (let i = 0; i < n; i++) skater.update(1 / 60, { move: { x: inp.x || 0, z: inp.z || 0 }, jumpPressed: !!inp.jump && i === 0, jumpHeld: !!inp.hold || (!!inp.jump && i === 0), swipe: i === 0 && inp.swipe != null ? inp.swipe : null, spinHold: !!inp.spinHold && i % 17 === 0 });
  skater.emit = old; return ev;
};
window.__dbg = () => skater && ({ pos: skater.pos.toArray().map(v => +v.toFixed(2)), speed: +skater.speed.toFixed(2), state: skater.state, anim: skater.anim, score: skater.score, yaw: +skater.yaw.toFixed(2), chain: skater.chain, clips: Object.keys(skater.view.clips).length });
addEventListener('hashchange', () => { const m = location.hash.match(/#p=([A-Za-z0-9_-]+)/); if (m && mode === 'build') { try { park = Park.decode(m[1]); rebuildPark(false); toast('Park loaded from link'); } catch {} } });
