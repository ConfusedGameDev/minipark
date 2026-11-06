// Arcade kinematic skater: samples the merged park mesh with raycasts, launches off transitions, snaps to grind rails.
import * as THREE from 'three';
import { SWIPE_TRICKS, spinTrick, GRIND_TRICKS, OTHER } from './tricks.js';

const G = 12;
const MAX_SPEED = 6.0;
const PUSH_ACCEL = 5.5;
const FRICTION = 0.32;
const TURN_RATE = 3.4;
const OLLIE_V = 4.6;
const GRIND_SNAP = 0.38;
const FLIP_TIME = 0.38, SHOVE_TIME = 0.32, SPIN_TIME = 0.34;
const UP = new THREE.Vector3(0, 1, 0);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const fwdOf = yaw => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

export class Skater {
  constructor({ lib, scene, character = 'boy', emit }) {
    this.lib = lib; this.scene = scene; this.emit = emit;
    this.ray = new THREE.Raycaster(); this.ray.firstHitOnly = true;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.speed = 0; this.groundNormal = UP.clone(); this.smoothNormal = UP.clone();
    this.state = 'ground'; // ground | air | grind | fallen
    this.setCharacter(character);
    this.resetRun(3);
  }

  setCharacter(which) {
    if (this.view) this.scene.remove(this.view.root);
    this.view = this.lib.makeSkater(which);
    this.view.root.scale.setScalar(0.85);
    const board = new THREE.Mesh(this.lib.geos.get('skateboard'), this.lib.material);
    board.castShadow = true;
    this.board = new THREE.Group(); this.board.add(board); this.board.position.y = 0.02;
    this.view.root.add(this.board);
    this.view.model.position.y = 0.17; // stand on the deck
    this.scene.add(this.view.root);
    this.anim = null; this.play('skate-stand');
  }

  play(name, fade = 0.12) {
    if (this.anim === name) return;
    const next = this.view.clips[name]; if (!next) return;
    const prev = this.view.clips[this.anim];
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.anim = name;
  }

  setWorld(parkMesh, grinds, park) { this.parkMesh = parkMesh; this.grinds = grinds; this.park = park; this.bound = park.size / 2 - 0.05; }

  resetRun(falls) {
    this.score = 0; this.falls = falls; this.fallsMax = falls; this.chain = []; this.spin = 0; this.spinDir = 0;
    this.flipTurns = 0; this.flipT = 1; this.shoveTurns = 0; this.shoveT = 1; this.flipAngle = 0; this.shoveAngle = 0;
    this.maxAirY = 0; this.takeoffY = 0; this.grind = null; this.fallTimer = 0; this.grindCooldown = 0; this.flipBase = 0; this.shoveBase = 0; this.spinVis = 0;
  }

  spawnAt(cx, cy) {
    const half = this.park.size / 2;
    this.pos.set(cx - half + 0.5, 0, cy - half + 0.5);
    this.safePos = this.pos.clone(); this.safeTimer = 0;
    this.vel.set(0, 0, 0); this.speed = 0; this.yaw = 0; this.state = 'ground';
    this.groundNormal.copy(UP); this.smoothNormal.copy(UP); this.chain = []; this.spin = 0; this.spinVis = 0;
    this.flipT = 1; this.shoveT = 1; this.flipAngle = 0; this.shoveAngle = 0; this.grind = null;
    this.play('skate-stand');
    this.syncView(0);
  }

  cast(origin, dir, far) {
    this.ray.set(origin, dir); this.ray.far = far; this.ray.near = 0;
    const hits = this.ray.intersectObject(this.parkMesh, false);
    if (!hits.length) return null;
    const h = hits[0];
    const n = h.face.normal.clone();
    if (n.dot(dir) > 0) n.negate();
    return { point: h.point, normal: n, distance: h.distance };
  }

  // ---------------------------------------------------------------- update
  update(dt, input) {
    dt = Math.min(dt, 1 / 30);
    switch (this.state) {
      case 'ground': this.updateGround(dt, input); break;
      case 'air': this.updateAir(dt, input); break;
      case 'grind': this.updateGrind(dt, input); break;
      case 'fallen': this.updateFallen(dt); break;
    }
    // keep inside the fence
    const b = this.bound;
    if (Math.abs(this.pos.x) > b || Math.abs(this.pos.z) > b) {
      this.pos.x = THREE.MathUtils.clamp(this.pos.x, -b, b); this.pos.z = THREE.MathUtils.clamp(this.pos.z, -b, b);
      if (this.state !== 'air') this.speed *= -0.3;
      else { this.vel.x *= -0.3; this.vel.z *= -0.3; }
    }
    this.syncView(dt);
  }

  updateGround(dt, input) {
    const mv = input.move; const mlen = Math.hypot(mv.x, mv.z);
    const n = this.groundNormal;
    const steer = THREE.MathUtils.clamp(n.y, 0.15, 1); // hard to turn on steep walls
    if (mlen > 0.12) {
      const target = Math.atan2(mv.x, mv.z);
      const slow = Math.abs(this.speed) < 0.6;
      const movingBack = this.speed < -0.3; // riding fakie: steer relative to the direction of travel
      const faceYaw = movingBack ? wrap(this.yaw + Math.PI) : this.yaw;
      const d = wrap(target - faceYaw);
      const maxTurn = (slow ? 9 : TURN_RATE) * dt * steer * (slow ? 1 : 0.55 + 0.45 * Math.min(1, Math.abs(this.speed) / 2));
      this.yaw += THREE.MathUtils.clamp(d, -maxTurn, maxTurn);
      const align = Math.cos(d);
      if (align > 0.2) this.speed += PUSH_ACCEL * align * mlen * dt * (movingBack ? -1 : 1);
      else if (align < -0.5 && !slow) this.speed -= 7 * dt * Math.sign(this.speed || 1);
    }
    const fwd = fwdOf(this.yaw);
    const ft = fwd.clone().sub(n.clone().multiplyScalar(fwd.dot(n)));
    if (ft.lengthSq() < 1e-4) ft.copy(UP); // vertical wall edge case
    ft.normalize();
    this.speed += -G * ft.y * dt;                       // slopes
    this.speed -= this.speed * FRICTION * dt;           // rolling friction
    this.speed = THREE.MathUtils.clamp(this.speed, -MAX_SPEED, MAX_SPEED * 1.3);
    this.vel.copy(ft).multiplyScalar(this.speed);

    // wall bonk (only when on fairly flat ground heading into something vertical)
    if (n.y > 0.7 && Math.abs(this.speed) > 0.3) {
      const hd = new THREE.Vector3(fwd.x, 0, fwd.z).multiplyScalar(Math.sign(this.speed));
      const w = this.cast(this.pos.clone().add(new THREE.Vector3(0, 0.22, 0)), hd, 0.32);
      if (w && w.normal.y < 0.35) {
        if (Math.abs(this.speed) > 2.6) return this.fall('Bonk!');
        this.speed *= -0.25;
        this.pos.add(hd.multiplyScalar(-(0.32 - w.distance)));
        this.vel.copy(ft).multiplyScalar(this.speed);
      }
    }

    // ollie
    if (input.jumpPressed) {
      this.vel.add(n.clone().multiplyScalar(OLLIE_V));
      if (this.vel.y < OLLIE_V * 0.75) this.vel.y = OLLIE_V * 0.75;
      this.leaveGround();
      this.addTrick(OTHER.ollie);
      this.play('jump', 0.05);
      return;
    }

    this.pos.addScaledVector(this.vel, dt);
    // re-sample the surface along the current normal
    const hit = this.cast(this.pos.clone().addScaledVector(n, 0.5), n.clone().negate(), 1.0);
    const tol = 0.5 + 0.18 + Math.abs(this.speed) * dt * 2;
    if (hit && hit.distance < tol && !(ft.dot(hit.normal) > 0.32 && Math.abs(this.speed) > 3.0)) { // convex edge at speed → launch
      this.pos.copy(hit.point);
      this.groundNormal.copy(hit.normal);
      if (this.groundNormal.y < -0.1) this.groundNormal.copy(UP);
    } else {
      this.leaveGround();
      return;
    }
    if (this.groundNormal.y > 0.95) { this.safeTimer = (this.safeTimer || 0) + dt; if (this.safeTimer > 0.4) { this.safeTimer = 0; this.safePos.copy(this.pos); } }
    this.play(Math.abs(this.speed) > 0.4 ? 'skate' : 'skate-stand');
  }

  leaveGround() {
    this.state = 'air';
    this.takeoffY = this.pos.y; this.maxAirY = this.pos.y;
    this.spin = 0; this.spinVis = 0; this.spinDir = 0;
    this.play('skate-air', 0.1);
  }

  updateAir(dt, input) {
    this.grindCooldown -= dt;
    this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.maxAirY = Math.max(this.maxAirY, this.pos.y);
    this.smoothNormal.lerp(UP, dt * 4);

    // tricks
    if (input.swipe != null) {
      const t = SWIPE_TRICKS[input.swipe];
      if (t) {
        if (t.spin) { this.addSpin(t.spin); }
        else {
          this.flipBase = this.flipAngle; this.flipTurns = t.flip; this.flipT = 0;
          if (t.shove) { this.shoveBase = this.shoveAngle; this.shoveTurns = t.shove; this.shoveT = 0; }
          this.addTrick(t);
        }
      }
    }
    if (input.spinHold && this.spinDir) this.addSpin(this.spinDir);
    if (this.flipT < 1) { this.flipT = Math.min(1, this.flipT + dt / FLIP_TIME); this.flipAngle = this.flipBase + this.flipTurns * Math.PI * 2 * this.flipT; }
    if (this.shoveT < 1) { this.shoveT = Math.min(1, this.shoveT + dt / SHOVE_TIME); this.shoveAngle = this.shoveBase + this.shoveTurns * Math.PI * this.shoveT; }
    if (this.spinVis !== this.spin) {
      const step = (Math.PI / SPIN_TIME) * dt;
      const d = this.spin - this.spinVis;
      this.spinVis += THREE.MathUtils.clamp(d, -step, step);
    }

    if (this.vel.y <= 0.2) {
      // grind?
      if (input.jumpHeld && this.grindCooldown <= 0) { const g = this.findGrind(); if (g) return this.startGrind(g); }
      // land?
      let hit = this.cast(this.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), new THREE.Vector3(0, -1, 0), 0.6 + Math.max(0, -this.vel.y * dt) + 0.04);
      if (!hit && this.pos.y <= 0) hit = { point: new THREE.Vector3(this.pos.x, 0, this.pos.z), normal: UP.clone(), distance: 0.6 }; // safety floor
      if (hit && hit.normal.y > 0.05) return this.land(hit);
    }
    if (this.pos.y < -3) this.fall('Lost');
  }

  addSpin(dir) {
    if (this.spinDir && this.spinDir !== dir) return; // one direction per air
    this.spinDir = dir;
    this.spin += dir * Math.PI;
  }

  land(hit) {
    // trick completion checks
    if (this.flipT < 1 || this.shoveT < 1) return this.fall('Sketchy!');
    const spinDeg = Math.abs(this.spin) * 180 / Math.PI;
    const visDeg = Math.abs(this.spinVis) * 180 / Math.PI;
    const rem = visDeg % 180;
    if (Math.min(rem, 180 - rem) > 50 || Math.abs(spinDeg - visDeg) > 60) return this.fall('Bailed!');
    const halfTurns = Math.round(this.spin / Math.PI);
    if (halfTurns !== 0) { const t = spinTrick(halfTurns * 180, this.spinDir); if (t) this.addTrick(t); }
    if (this.maxAirY - this.takeoffY > 1.0) this.addTrick(OTHER.bigair);
    // apply rotation: odd half-turns mean we land fakie
    this.yaw = wrap(this.yaw + halfTurns * Math.PI);
    this.spin = 0; this.spinVis = 0; this.spinDir = 0; this.flipAngle = 0; this.shoveAngle = 0; this.flipBase = 0; this.shoveBase = 0;
    this.flipTurns = 0; this.shoveTurns = 0;
    this.pos.copy(hit.point);
    this.groundNormal.copy(hit.normal); if (this.groundNormal.y < 0.05) this.groundNormal.copy(UP);
    const fwd = fwdOf(this.yaw);
    const n = this.groundNormal;
    const ft = fwd.clone().sub(n.clone().multiplyScalar(fwd.dot(n))).normalize();
    this.speed = THREE.MathUtils.clamp(this.vel.dot(ft), -MAX_SPEED, MAX_SPEED);
    // very hard landings on flat ground bleed speed
    if (this.vel.y < -9) this.speed *= 0.6;
    this.state = 'ground';
    this.bankChain();
    this.play('skate', 0.08);
  }

  // ---- tricks / scoring
  addTrick(t) {
    this.chain.push({ name: t.name, points: t.points });
    this.emit('trick', { name: t.name, points: t.points, chain: this.chain });
  }
  bankChain() {
    if (!this.chain.length) return;
    const sum = this.chain.reduce((a, b) => a + b.points, 0);
    const mult = Math.min(this.chain.length, 8);
    const total = sum * mult;
    this.score += total;
    this.emit('land', { total, mult, chain: this.chain });
    this.chain = [];
  }

  // ---- grinds
  findGrind() {
    let best = null, bd = GRIND_SNAP;
    const p = this.pos, line = new THREE.Line3(), cp = new THREE.Vector3();
    for (const g of this.grinds) {
      line.set(g.a, g.b);
      line.closestPointToPoint(p, true, cp);
      const dy = p.y - cp.y;
      if (dy < -0.12 || dy > 0.45) continue;
      const dh = Math.hypot(p.x - cp.x, p.z - cp.z);
      if (dh < bd) { bd = dh; best = { seg: g, point: cp.clone() }; }
    }
    return best;
  }
  startGrind(g) {
    const seg = g.seg;
    const dir = seg.b.clone().sub(seg.a); const len = dir.length(); dir.normalize();
    const fwd = fwdOf(this.yaw);
    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    let along = hv.dot(dir); if (Math.abs(along) < 0.6) along = 0.6 * Math.sign(fwd.dot(dir) || 1);
    const sign = Math.sign(along) || 1;
    const facing = Math.abs(fwd.dot(dir));
    const kind = facing > 0.6 ? 'fifty' : 'board';
    this.grind = { seg, dir, len, sign, t: g.point.clone().sub(seg.a).dot(dir) / len, speed: Math.max(Math.abs(along), 1.8), kind, time: 0 };
    this.grindYaw = kind === 'fifty' ? Math.atan2(dir.x * sign, dir.z * sign) : this.yaw;
    this.yaw = kind === 'fifty' ? this.grindYaw : wrap(Math.atan2(dir.x * sign, dir.z * sign) + Math.PI / 2 * Math.sign(wrap(this.yaw - Math.atan2(dir.x * sign, dir.z * sign)) || 1));
    this.spin = 0; this.spinVis = 0; this.spinDir = 0; this.flipAngle = 0; this.shoveAngle = 0;
    this.state = 'grind';
    this.pos.copy(g.point);
    this.groundNormal.copy(UP);
    const tr = GRIND_TRICKS[kind];
    this.chain.push({ name: tr.name, points: tr.points });
    this.emit('trick', { name: tr.name, points: tr.points, chain: this.chain });
    this.play('crouch', 0.1);
  }
  updateGrind(dt, input) {
    const g = this.grind;
    g.time += dt;
    g.speed = Math.max(1.5, g.speed - 0.4 * dt);
    g.t += (g.sign * g.speed * dt) / g.len;
    const tr = GRIND_TRICKS[g.kind];
    const last = this.chain[this.chain.length - 1];
    if (last) last.points = tr.points + Math.floor(g.time * tr.perSec);
    if (g.t < 0 || g.t > 1) {
      // continue onto a connected segment?
      const end = g.t > 1 ? g.seg.b : g.seg.a;
      let next = null;
      for (const s of this.grinds) {
        if (s === g.seg) continue;
        if (s.a.distanceTo(end) < 0.06) { next = { seg: s, sign: 1, t: 0 }; break; }
        if (s.b.distanceTo(end) < 0.06) { next = { seg: s, sign: -1, t: 1 }; break; }
      }
      if (next) {
        const dir = next.seg.b.clone().sub(next.seg.a); const len = dir.length(); dir.normalize();
        const oldYawOff = wrap(this.yaw - Math.atan2(g.dir.x * g.sign, g.dir.z * g.sign));
        Object.assign(g, { seg: next.seg, dir, len, sign: next.sign, t: next.t });
        this.yaw = wrap(Math.atan2(dir.x * next.sign, dir.z * next.sign) + oldYawOff);
      } else {
        this.pos.copy(g.seg.a).addScaledVector(g.dir, THREE.MathUtils.clamp(g.t, 0, 1) * g.len);
        this.vel.copy(g.dir).multiplyScalar(g.speed * g.sign); this.vel.y = 1.0;
        this.grind = null; this.state = 'air'; this.grindCooldown = 0.35; this.takeoffY = this.pos.y; this.maxAirY = this.pos.y; this.play('skate-air', 0.1);
        return;
      }
    }
    this.pos.copy(g.seg.a).addScaledVector(g.dir, g.t * g.len);
    if (input.jumpPressed || !input.jumpHeld) {
      this.vel.copy(g.dir).multiplyScalar(g.speed * g.sign); this.vel.y = OLLIE_V * 0.85;
      this.grind = null; this.state = 'air'; this.grindCooldown = 0.3; this.takeoffY = this.pos.y; this.maxAirY = this.pos.y; this.play('jump', 0.05);
    }
  }

  // ---- falls
  fall(reason) {
    if (this.state === 'fallen') return;
    this.state = 'fallen'; this.fallTimer = 1.25; this.grind = null;
    this.chain = []; this.spin = 0; this.spinVis = 0; this.flipAngle = 0; this.shoveAngle = 0; this.flipT = 1; this.shoveT = 1;
    this.falls--;
    this.play('fall', 0.05);
    this.emit('fall', { reason, falls: this.falls });
  }
  updateFallen(dt) {
    this.fallTimer -= dt;
    // settle onto the ground
    const hit = this.cast(this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), new THREE.Vector3(0, -1, 0), 4);
    if (hit) { this.pos.y = THREE.MathUtils.lerp(this.pos.y, hit.point.y, dt * 8); this.groundNormal.copy(hit.normal.y > 0.3 ? hit.normal : UP); }
    this.smoothNormal.lerp(UP, dt * 4);
    if (this.fallTimer <= 0) {
      if (this.falls <= 0) { this.emit('gameover', {}); return; }
      this.speed = 0; this.vel.set(0, 0, 0); this.state = 'ground'; this.groundNormal.copy(UP);
      this.pos.copy(this.safePos); this.smoothNormal.copy(UP);
      this.play('skate-stand');
    }
  }

  // ---- view
  syncView(dt) {
    const r = this.view.root;
    r.position.copy(this.pos);
    const targetN = this.state === 'ground' ? this.groundNormal : (this.state === 'grind' ? UP : this.smoothNormal);
    this.smoothNormal.lerp(targetN, Math.min(1, dt * 14)).normalize();
    const qAlign = new THREE.Quaternion().setFromUnitVectors(UP, this.smoothNormal);
    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw + (this.state === 'air' ? this.spinVis : 0));
    r.quaternion.copy(qAlign).multiply(qYaw);
    this.board.rotation.set(0, this.shoveAngle, this.flipAngle);
    this.board.position.y = this.state === 'air' ? 0.1 : 0.02;
    if (this.state === 'fallen') r.rotation.z += 0; // fall anim handles it
    this.view.mixer.update(dt);
  }
}
