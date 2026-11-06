// Virtual stick (left half), jump button, swipe gestures (right half) and keyboard fallbacks.
const SWIPE_MIN = 34;
const HOLD_TICK = 0.28;

export class Input {
  constructor(hud, stickEl, jumpBtn) {
    this.hud = hud; this.stickEl = stickEl; this.knob = stickEl.querySelector('.knob'); this.jumpBtn = jumpBtn;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.swipeP = { id: null, sx: 0, sy: 0, dir: null, holdT: 0 };
    this.jumpHeld = false; this._jumpPressed = false; this._swipe = null; this.keys = new Set(); this.enabled = false;
    this.bind();
  }

  bind() {
    const hud = this.hud;
    hud.addEventListener('pointerdown', e => {
      if (!this.enabled || e.target === this.jumpBtn || e.target.closest('button')) return;
      if (e.clientX < innerWidth / 2) {
        if (this.stick.id !== null) return;
        this.stick.id = e.pointerId; this.stick.ox = e.clientX; this.stick.oy = e.clientY; this.stick.x = this.stick.y = 0;
        this.stickEl.style.left = e.clientX + 'px'; this.stickEl.style.top = e.clientY + 'px';
        this.stickEl.classList.remove('hidden'); this.knob.style.transform = 'translate(-50%,-50%)';
      } else {
        if (this.swipeP.id !== null) return;
        this.swipeP.id = e.pointerId; this.swipeP.sx = e.clientX; this.swipeP.sy = e.clientY; this.swipeP.dir = null; this.swipeP.holdT = 0;
      }
      hud.setPointerCapture?.(e.pointerId);
    });
    hud.addEventListener('pointermove', e => {
      if (e.pointerId === this.stick.id) {
        let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
        const len = Math.hypot(dx, dy), max = 52;
        if (len > max) { dx *= max / len; dy *= max / len; }
        this.stick.x = dx / max; this.stick.y = -dy / max;
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (e.pointerId === this.swipeP.id && this.swipeP.dir === null) {
        const dx = e.clientX - this.swipeP.sx, dy = e.clientY - this.swipeP.sy;
        if (Math.hypot(dx, dy) >= SWIPE_MIN) {
          const ang = Math.atan2(dx, -dy); // 0 = up, clockwise
          const dir = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
          this.swipeP.dir = dir; this._swipe = dir; this.swipeP.holdT = 0;
        }
      }
    });
    const up = e => {
      if (e.pointerId === this.stick.id) { this.stick.id = null; this.stick.x = this.stick.y = 0; this.stickEl.classList.add('hidden'); }
      if (e.pointerId === this.swipeP.id) { this.swipeP.id = null; this.swipeP.dir = null; }
    };
    hud.addEventListener('pointerup', up); hud.addEventListener('pointercancel', up);

    const jb = this.jumpBtn;
    jb.addEventListener('pointerdown', e => { e.preventDefault(); jb.setPointerCapture?.(e.pointerId); this.jumpHeld = true; this._jumpPressed = true; jb.classList.add('down'); });
    const jup = e => { this.jumpHeld = false; jb.classList.remove('down'); };
    jb.addEventListener('pointerup', jup); jb.addEventListener('pointercancel', jup); jb.addEventListener('lostpointercapture', jup);
    jb.addEventListener('contextmenu', e => e.preventDefault());

    const keySwipe = { KeyI: 0, KeyO: 1, KeyL: 2, KeyM: 3, KeyK: 4, KeyN: 5, KeyJ: 6, KeyU: 7 };
    addEventListener('keydown', e => {
      if (!this.enabled || e.repeat) return;
      if (e.code === 'Space') { this.jumpHeld = true; this._jumpPressed = true; e.preventDefault(); }
      else if (e.code in keySwipe) { this._swipe = keySwipe[e.code]; this.keyHold = keySwipe[e.code]; this.swipeP.holdT = 0; }
      else this.keys.add(e.code);
    });
    addEventListener('keyup', e => {
      if (e.code === 'Space') this.jumpHeld = false;
      if (e.code in keySwipe) this.keyHold = null;
      this.keys.delete(e.code);
    });
    addEventListener('blur', () => { this.keys.clear(); this.jumpHeld = false; this.keyHold = null; });
  }

  setEnabled(v) { this.enabled = v; if (!v) { this.keys.clear(); this.jumpHeld = false; this.stick.id = null; this.swipeP.id = null; this.stickEl.classList.add('hidden'); } }

  // Returns a frame snapshot: move (screen-space x right / y up, length <= 1), jumpPressed (edge), jumpHeld, swipe (0..7 or null), spinHold (bool)
  poll(dt) {
    let x = this.stick.x, y = this.stick.y;
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyA')) x -= 1; if (k.has('ArrowRight') || k.has('KeyD')) x += 1;
    if (k.has('ArrowUp') || k.has('KeyW')) y += 1; if (k.has('ArrowDown') || k.has('KeyS')) y -= 1;
    const len = Math.hypot(x, y); if (len > 1) { x /= len; y /= len; }
    let spinHold = false;
    const heldDir = this.swipeP.id !== null ? this.swipeP.dir : this.keyHold;
    if (heldDir === 2 || heldDir === 6) {
      this.swipeP.holdT += dt;
      if (this.swipeP.holdT >= HOLD_TICK) { this.swipeP.holdT -= HOLD_TICK; spinHold = true; }
    }
    const snap = { move: { x, y }, jumpPressed: this._jumpPressed, jumpHeld: this.jumpHeld, swipe: this._swipe, spinHold };
    this._jumpPressed = false; this._swipe = null;
    return snap;
  }
}
