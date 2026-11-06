// Trick catalogue. Swipe directions: 0=up 1=up-right 2=right 3=down-right 4=down 5=down-left 6=left 7=up-left
export const SWIPE_TRICKS = {
  0: { name: 'Kickflip',        points: 100, flip: 1,  shove: 0 },
  4: { name: 'Heelflip',        points: 100, flip: -1, shove: 0 },
  7: { name: 'Varial Kickflip', points: 180, flip: 1,  shove: 1 },
  1: { name: 'Hardflip',        points: 220, flip: 1,  shove: -1 },
  5: { name: 'Varial Heelflip', points: 180, flip: -1, shove: 1 },
  3: { name: 'Inward Heelflip', points: 220, flip: -1, shove: -1 },
  6: { spin: 1 },  // FS spin (adds 180 per swipe / per hold tick)
  2: { spin: -1 }, // BS spin
};

export const SPIN_POINTS = { 180: 80, 360: 200, 540: 350, 720: 520, 900: 700, 1080: 900 };
export function spinTrick(deg, dir) {
  const d = Math.min(1080, Math.round(Math.abs(deg) / 180) * 180);
  if (d === 0) return null;
  return { name: `${dir > 0 ? 'FS' : 'BS'} ${d}`, points: SPIN_POINTS[d] || 900 };
}

export const GRIND_TRICKS = {
  fifty: { name: '50-50', points: 60, perSec: 60 },
  board: { name: 'Boardslide', points: 90, perSec: 80 },
};

export const OTHER = {
  ollie: { name: 'Ollie', points: 10 },
  bigair: { name: 'Big Air', points: 50 },
  lip: { name: 'Lip Grind', points: 70 },
};

// Rows for the trick list screen: [name, input, points]
export const TRICK_LIST = [
  ['Ollie', 'JUMP', 10],
  ['Kickflip', 'swipe ↑  (I)', 100],
  ['Heelflip', 'swipe ↓  (K)', 100],
  ['FS 180 / 360 / 540…', 'swipe ←  (J), hold for more', '80 / 200 / 350…'],
  ['BS 180 / 360 / 540…', 'swipe →  (L), hold for more', '80 / 200 / 350…'],
  ['Varial Kickflip', 'swipe ↖  (U)', 180],
  ['Hardflip', 'swipe ↗  (O)', 220],
  ['Varial Heelflip', 'swipe ↙  (N)', 180],
  ['Inward Heelflip', 'swipe ↘  (M)', 220],
  ['50-50 grind', 'hold JUMP, land along a rail', '60 + 60/s'],
  ['Boardslide', 'hold JUMP, land across a rail', '90 + 80/s'],
  ['Big Air', 'fly > 1 m above take-off', 50],
  ['Combo', 'chain tricks in one air/grind', '× tricks'],
];
