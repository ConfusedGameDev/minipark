// Park data model: a grid of cells with a height level (0 = ground, 1 = low deck 0.4, 2 = high deck 0.8)
// plus props placed on cells. Tiles are resolved Townscaper-style from their neighbours.

export const SIZE = 14;
export const LEVEL_H = [0, 0.4, 0.8];

// Prop types (index = encoded id; never reorder, append only)
export const PROPS = [
  { id: 'rail',      label: 'Rail',      line: true,  rot: false },
  { id: 'railhigh',  label: 'High rail', line: true,  rot: false },
  { id: 'ledge',     label: 'Ledge',     line: true,  rot: false },
  { id: 'ledgerail', label: 'Ledge+rail',line: true,  rot: false },
  { id: 'box',       label: 'Box',       line: false, rot: false },
  { id: 'boxgrind',  label: 'Grind box', line: false, rot: true  },
  { id: 'ramp',      label: 'Ramp',      line: false, rot: true  },
  { id: 'ramprail',  label: 'Ramp+rail', line: false, rot: true  },
  { id: 'steps',     label: 'Steps',     line: false, rot: true  },
  { id: 'stepsrail', label: 'Steps+rail',line: false, rot: true  },
  { id: 'bench',     label: 'Bench',     line: false, rot: true  },
  { id: 'benches',   label: 'Benches',   line: false, rot: true  },
  { id: 'pallet',    label: 'Pallet',    line: false, rot: false },
  { id: 'wood',      label: 'Wood deck', line: false, rot: false },
];
export const PROP_INDEX = Object.fromEntries(PROPS.map((p, i) => [p.id, i]));

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N(-z), E(+x), S(+z), W(-x)
const DIAGS = [[1, 1], [-1, 1], [-1, -1], [1, -1]]; // SE, SW, NW, NE
// Rotation convention: rot = quarter turns about +Y (rotation.y = rot * PI/2). One quarter turn maps E->N, S->E, N->W, W->S,
// i.e. a model that faces direction index d at rot 0 faces (d - rot) mod 4 at rot.
// Model facts (measured from the meshes): quarter pipes/half-pipe face +z (S) at rot 0; corner-outer, rail-curve and obstacle-corner
// join E(+x) and S(+z); corner-inner exposes the SE diagonal; obstacle-end connects at N(-z); ramps/steps rise toward -z (N).
export const rotFace = d => (2 - d + 4) % 4;              // make a +z-facing model face direction d
export const rotDiag = d => (4 - d) % 4;                  // make the SE diagonal land on DIAGS index d
export const rotConnect = d => (4 - d) % 4;               // make a -z connecting piece connect at direction d
export const rotPair = (a, b) => (1 - (a === 0 && b === 3 ? 3 : a) + 4) % 4; // make an E+S piece join adjacent dirs a<b

export class Park {
  constructor(size = SIZE) {
    this.size = size;
    this.levels = new Uint8Array(size * size);
    this.props = new Map(); // key "x,y" -> { type, rot }
  }
  key(x, y) { return x + ',' + y; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }
  level(x, y) { return this.inBounds(x, y) ? this.levels[y * this.size + x] : 0; }
  setLevel(x, y, l) { if (this.inBounds(x, y)) this.levels[y * this.size + x] = Math.max(0, Math.min(2, l)); }
  prop(x, y) { return this.props.get(this.key(x, y)); }
  setProp(x, y, type, rot = 0) { if (type == null) this.props.delete(this.key(x, y)); else this.props.set(this.key(x, y), { type, rot }); }
  height(x, y) { return LEVEL_H[this.level(x, y)]; }
  clear() { this.levels.fill(0); this.props.clear(); }
  clone() { const p = new Park(this.size); p.levels.set(this.levels); for (const [k, v] of this.props) p.props.set(k, { ...v }); return p; }

  // A cell can hold a prop only if it is flat (ground or a fully enclosed deck)
  isFlat(x, y) {
    const l = this.level(x, y);
    if (l === 0) return true;
    return this.resolveCell(x, y).model === 'bowl-platform';
  }

  // ---- Townscaper-style resolution --------------------------------------
  // Returns { model, rot (quarter turns, CCW seen from above), scaleY, exposed[] }
  resolveCell(x, y) {
    const l = this.level(x, y);
    if (l === 0) return { model: 'floor-concrete', rot: 0, scaleY: 1 };
    const suffix = l === 1 ? '-low' : '';
    const lower = DIRS.map(([dx, dy]) => this.level(x + dx, y + dy) < l); // exposed edges N,E,S,W
    const n = lower.filter(Boolean).length;
    const idx = lower.map((v, i) => v ? i : -1).filter(i => i >= 0);
    if (n === 0) {
      // inner corner: exactly one diagonal lower while all edges are solid
      const dl = DIAGS.map(([dx, dy]) => this.level(x + dx, y + dy) < l);
      if (dl.filter(Boolean).length === 1) return { model: 'bowl-corner-inner' + suffix, rot: rotDiag(dl.indexOf(true)), scaleY: 1 };
      return { model: 'bowl-platform', rot: 0, scaleY: l === 1 ? 0.5 : 1 };
    }
    if (n === 1) return { model: 'bowl-side' + suffix, rot: rotFace(idx[0]), scaleY: 1 };
    if (n === 2) {
      const [a, b] = idx;
      if (b - a === 2) return { model: 'half-pipe' + suffix, rot: rotFace(a), scaleY: 1 }; // opposite sides: ridge
      return { model: 'bowl-corner-outer' + suffix, rot: rotPair(a, b), scaleY: 1 };
    }
    if (n === 3) {
      const solid = [0, 1, 2, 3].find(i => !lower[i]);
      return { model: 'half-pipe' + suffix, rot: rotFace((solid + 2) % 4), scaleY: 1 }; // curve faces away from the solid side
    }
    // isolated bump: a launch ramp facing the middle of the park
    const cx = (this.size - 1) / 2 - x, cy = (this.size - 1) / 2 - y;
    const face = Math.abs(cx) > Math.abs(cy) ? (cx > 0 ? 1 : 3) : (cy > 0 ? 2 : 0);
    return { model: 'half-pipe' + suffix, rot: rotFace(face), scaleY: 1 };
  }

  // Resolve a prop. Returns { model, rot }
  resolveProp(x, y) {
    const p = this.prop(x, y);
    if (!p) return null;
    const def = PROPS[p.type];
    if (def.line) {
      const fam = lineFamily(p.type);
      const c = DIRS.map(([dx, dy]) => {
        const q = this.prop(x + dx, y + dy);
        return !!q && PROPS[q.type].line && lineFamily(q.type) === fam && this.level(x + dx, y + dy) === this.level(x, y);
      });
      const n = c.filter(Boolean).length;
      const idx = c.map((v, i) => v ? i : -1).filter(i => i >= 0);
      const alongX = n === 0 ? (p.rot % 2 === 1) : ((c[1] || c[3]) && !(c[0] || c[2]));
      if (fam === 'rail') {
        const high = p.type === PROP_INDEX.railhigh;
        if (n === 2 && idx[1] - idx[0] !== 2) return { model: high ? 'rail-high-curve' : 'rail-curve', rot: rotPair(idx[0], idx[1]) };
        return { model: high ? 'rail-high' : (n <= 1 ? 'rail-low-end' : 'rail-low'), rot: alongX ? 1 : 0 };
      }
      const withRail = p.type === PROP_INDEX.ledgerail;
      if (n === 2 && idx[1] - idx[0] !== 2) return { model: 'obstacle-corner', rot: rotPair(idx[0], idx[1]) };
      if (n === 1) return { model: 'obstacle-end', rot: rotConnect(idx[0]) };
      if (n === 0) return { model: 'obstacle-box', rot: 0 };
      return { model: withRail ? 'obstacle-middle-rail' : 'obstacle-middle', rot: alongX ? 1 : 0 };
    }
    const models = {
      box: 'obstacle-box', boxgrind: 'obstacle-box-grind', ramp: 'ramp', ramprail: 'ramp-rail', steps: 'steps',
      stepsrail: 'steps-rail', bench: 'bench', benches: 'benches', pallet: 'pallet', wood: 'floor-wood',
    };
    return { model: models[def.id], rot: p.rot & 3 };
  }

  // ---- Serialization -------------------------------------------------------
  encode() {
    const bytes = [1, this.size];
    const n = this.size * this.size;
    for (let i = 0; i < n; i += 4) {
      let b = 0;
      for (let j = 0; j < 4; j++) b |= (this.levels[i + j] || 0) << (j * 2);
      bytes.push(b);
    }
    const props = [...this.props.entries()];
    bytes.push(props.length & 255, props.length >> 8);
    for (const [k, v] of props) {
      const [x, y] = k.split(',').map(Number);
      bytes.push(x, y, (v.type << 2) | (v.rot & 3));
    }
    return b64url(Uint8Array.from(bytes));
  }
  static decode(str) {
    const b = unb64url(str);
    if (b[0] !== 1) throw new Error('Unknown park version');
    const size = b[1];
    const park = new Park(size);
    const n = size * size;
    let o = 2;
    for (let i = 0; i < n; i += 4, o++) for (let j = 0; j < 4; j++) if (i + j < n) park.levels[i + j] = (b[o] >> (j * 2)) & 3;
    const count = b[o] | (b[o + 1] << 8); o += 2;
    for (let i = 0; i < count; i++, o += 3) {
      const type = b[o + 2] >> 2;
      if (type < PROPS.length) park.setProp(b[o], b[o + 1], type, b[o + 2] & 3);
    }
    return park;
  }
  hash() { // short id for leaderboards
    let h = 2166136261;
    const s = this.encode();
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(36);
  }

  // Spawn: a flat empty ground cell closest to the centre
  spawn() {
    const c = (this.size - 1) / 2;
    let best = null, bd = 1e9;
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      if (this.level(x, y) !== 0 || this.prop(x, y)) continue;
      const d = (x - c) ** 2 + (y - c) ** 2;
      if (d < bd) { bd = d; best = [x, y]; }
    }
    return best || [0, 0];
  }
}

function lineFamily(type) {
  return (type === PROP_INDEX.rail || type === PROP_INDEX.railhigh) ? 'rail' : 'ledge';
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, ch => ch.charCodeAt(0));
}

// ---- Procedural generation ---------------------------------------------------
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function generatePark(seed = Date.now() & 0xffffffff, size = SIZE) {
  const rnd = mulberry32(seed);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const park = new Park(size);
  const S = size;

  // 1. Raised decks: a few rounded blobs at the borders and one in the middle
  const blobs = ri(3, 5);
  for (let i = 0; i < blobs; i++) {
    const w = ri(2, 5), h = ri(2, 5);
    const x0 = ri(0, S - w), y0 = ri(0, S - h);
    const lvl = rnd() < 0.55 ? 2 : 1;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) park.setLevel(x, y, Math.max(park.level(x, y), lvl));
    // nibble corners for organic shapes
    if (w > 2 && h > 2 && rnd() < 0.6) park.setLevel(x0, y0, 0);
    if (w > 2 && h > 2 && rnd() < 0.6) park.setLevel(x0 + w - 1, y0 + h - 1, 0);
  }
  // 2. A half-pipe trench: two parallel raised rows with a 2-wide ground gap
  if (rnd() < 0.8) {
    const horizontal = rnd() < 0.5;
    const len = ri(3, 5), start = ri(0, S - len), lane = ri(1, S - 4);
    for (let i = 0; i < len; i++) {
      const put = (a, b) => { const [x, y] = horizontal ? [start + i, a] : [a, start + i]; park.setLevel(x, y, b); };
      put(lane, 2); put(lane + 1, 0); put(lane + 2, 0); put(lane + 3, 2);
    }
  }
  // 3. Street section: rails, ledges, boxes, steps on flat cells
  const freeFlat = (x, y) => park.inBounds(x, y) && park.isFlat(x, y) && !park.prop(x, y) && park.level(x, y) === 0;
  const lines = ri(2, 4);
  for (let i = 0; i < lines; i++) {
    const type = [PROP_INDEX.rail, PROP_INDEX.rail, PROP_INDEX.ledge, PROP_INDEX.ledgerail, PROP_INDEX.railhigh][ri(0, 4)];
    const len = ri(2, 4), horizontal = rnd() < 0.5;
    const x0 = ri(1, S - 2 - (horizontal ? len : 0)), y0 = ri(1, S - 2 - (horizontal ? 0 : len));
    const cells = [];
    for (let j = 0; j < len; j++) { const x = x0 + (horizontal ? j : 0), y = y0 + (horizontal ? 0 : j); if (freeFlat(x, y)) cells.push([x, y]); else break; }
    if (cells.length >= 2) for (const [x, y] of cells) park.setProp(x, y, type, 0);
  }
  const singles = ri(3, 6);
  const singleTypes = [PROP_INDEX.box, PROP_INDEX.boxgrind, PROP_INDEX.ramp, PROP_INDEX.ramprail, PROP_INDEX.steps, PROP_INDEX.stepsrail, PROP_INDEX.bench, PROP_INDEX.pallet, PROP_INDEX.benches];
  for (let i = 0; i < singles; i++) {
    const x = ri(0, S - 1), y = ri(0, S - 1);
    if (freeFlat(x, y)) park.setProp(x, y, singleTypes[ri(0, singleTypes.length - 1)], ri(0, 3));
  }
  // keep the spawn clear
  const [sx, sy] = park.spawn();
  park.setProp(sx, sy, null);
  return park;
}
