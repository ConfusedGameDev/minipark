// Loads the Kenney Mini Skate GLBs and turns a Park into one merged mesh (+ BVH for raycasts) and a list of grind segments.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { LEVEL_H } from './park.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const TILE_MODELS = [
  'floor-concrete', 'floor-wood', 'bowl-platform', 'bowl-side', 'bowl-side-low', 'bowl-corner-inner', 'bowl-corner-inner-low',
  'bowl-corner-outer', 'bowl-corner-outer-low', 'half-pipe', 'half-pipe-low',
  'rail-low', 'rail-low-end', 'rail-high', 'rail-curve', 'rail-high-curve',
  'obstacle-middle', 'obstacle-middle-rail', 'obstacle-end', 'obstacle-corner', 'obstacle-box', 'obstacle-box-grind',
  'ramp', 'ramp-rail', 'steps', 'steps-rail', 'bench', 'benches', 'pallet', 'fence',
];

// Grind segments in model-local space (rot 0). Each is a polyline [[x,y,z], ...]; 'arc' entries are expanded.
const arcES = (y, r = 0.5) => { // quarter arc joining the +x edge and the +z edge (centre at (0.5, 0.5))
  const pts = [];
  for (let i = 0; i <= 6; i++) { const t = Math.PI + (Math.PI / 2) * (i / 6); pts.push([0.5 + r * Math.cos(t), y, 0.5 + r * Math.sin(t)]); }
  return pts;
}
const GRINDS = {
  'rail-low': [[[0, 0.25, -0.5], [0, 0.25, 0.5]]],
  'rail-low-end': [[[0, 0.25, -0.5], [0, 0.25, 0.5]]],
  'rail-high': [[[0, 0.45, -0.5], [0, 0.45, 0.5]]],
  'rail-curve': [arcES(0.25)],
  'rail-high-curve': [arcES(0.45)],
  'obstacle-middle': [[[-0.3, 0.3, -0.5], [-0.3, 0.3, 0.5]], [[0.3, 0.3, -0.5], [0.3, 0.3, 0.5]]],
  'obstacle-middle-rail': [[[0, 0.55, -0.5], [0, 0.55, 0.5]]],
  'obstacle-end': [[[-0.3, 0.3, -0.5], [-0.3, 0.3, -0.1]], [[0.3, 0.3, -0.5], [0.3, 0.3, -0.1]]],
  'obstacle-corner': [arcES(0.3, 0.8), arcES(0.3, 0.2)],
  'obstacle-box': [[[-0.5, 0.21, -0.5], [0.5, 0.21, -0.5]], [[0.5, 0.21, -0.5], [0.5, 0.21, 0.5]], [[0.5, 0.21, 0.5], [-0.5, 0.21, 0.5]], [[-0.5, 0.21, 0.5], [-0.5, 0.21, -0.5]]],
  'obstacle-box-grind': [[[-0.26, 0.21, -0.5], [-0.26, 0.21, 0.5]], [[0.26, 0.21, -0.5], [0.26, 0.21, 0.5]]],
  'ramp-rail': [[[0, 0.55, -0.5], [0, 0.3, 0.5]]],
  'steps-rail': [[[0, 0.55, -0.5], [0, 0.3, 0.5]]],
  'bench': [[[-0.39, 0.27, 0.1], [0.39, 0.27, 0.1]]],
  // copings along the top edge of quarter pipes (the edge opposite the curve, at z = -0.5 for rot 0)
  'bowl-side': [[[-0.5, 0.8, -0.5], [0.5, 0.8, -0.5]]],
  'bowl-side-low': [[[-0.5, 0.4, -0.5], [0.5, 0.4, -0.5]]],
  'half-pipe': [[[-0.5, 0.8, -0.5], [0.5, 0.8, -0.5]]],
  'half-pipe-low': [[[-0.5, 0.4, -0.5], [0.5, 0.4, -0.5]]],
}

export class TileLibrary {
  constructor() { this.geos = new Map(); this.material = null; this.characters = new Map(); }

  async load(basePath = 'assets/models/', onProgress) {
    const loader = new GLTFLoader();
    const names = [...TILE_MODELS, 'character-skate-boy', 'character-skate-girl', 'skateboard'];
    let done = 0;
    await Promise.all(names.map(async name => {
      const gltf = await loader.loadAsync(`${basePath}${name}.glb`);
      done++; onProgress && onProgress(done / names.length);
      if (name.startsWith('character')) { this.characters.set(name, gltf); return; }
      let geo = null;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
        if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
        geo = geo ? mergeGeometries([geo, g], false) : g;
        if (!this.material) {
          const m = o.material;
          this.material = new THREE.MeshLambertMaterial({ map: m.map });
          if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.magFilter = THREE.NearestFilter; }
        }
      });
      this.geos.set(name, geo);
    }));
  }

  // Build the static park. Returns { mesh, grinds: [{a,b}], origin }
  build(park) {
    const geos = [];
    const grinds = [];
    const S = park.size, half = S / 2;
    const m = new THREE.Matrix4(), rot = new THREE.Matrix4(), scl = new THREE.Matrix4(), tr = new THREE.Matrix4();
    const place = (model, cx, cy, h, r, sy = 1) => {
      const g = this.geos.get(model);
      if (!g) return;
      const wx = cx - half + 0.5, wz = cy - half + 0.5;
      rot.makeRotationY(r * Math.PI / 2); scl.makeScale(1, sy, 1); tr.makeTranslation(wx, h, wz);
      m.multiplyMatrices(tr, rot).multiply(scl);
      const gg = g.clone(); gg.applyMatrix4(m); geos.push(gg);
      const segs = GRINDS[model];
      if (segs) for (const line of segs) {
        const pts = line.map(([x, y, z]) => new THREE.Vector3(x, y * sy, z).applyMatrix4(m));
        for (let i = 0; i < pts.length - 1; i++) grinds.push({ a: pts[i], b: pts[i + 1], model });
      }
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const t = park.resolveCell(x, y);
      if (t.model !== 'floor-concrete') place('floor-concrete', x, y, 0, 0); // fill the gaps under curved corners
      place(t.model, x, y, 0, t.rot, t.scaleY);
      const p = park.resolveProp(x, y);
      if (p) place(p.model, x, y, LEVEL_H[park.level(x, y)], p.rot);
    }
    // perimeter fence
    for (let i = 0; i < S; i++) {
      place('fence', i, -0.5, 0, 0); place('fence', i, S - 0.5, 0, 0);
      place('fence', -0.5, i, 0, 1); place('fence', S - 0.5, i, 0, 1);
    }
    const merged = mergeGeometries(geos, false);
    merged.boundsTree = new MeshBVH(merged);
    const mesh = new THREE.Mesh(merged, this.material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return { mesh, grinds };
  }

  // Create an animated skater (character + board)
  makeSkater(which = 'boy') {
    const gltf = this.characters.get(`character-skate-${which}`);
    const root = new THREE.Group();
    const model = skeletonClone(gltf.scene);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    root.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const clips = {};
    for (const c of gltf.animations) clips[c.name] = mixer.clipAction(c);
    return { root, model, mixer, clips };
  }
}

// Minimal SkeletonUtils.clone (avoids vendoring the whole utils file)
function skeletonClone(source) {
  const sourceLookup = new Map(), cloneLookup = new Map();
  const clone = source.clone();
  parallelTraverse(source, clone, (a, b) => { sourceLookup.set(b, a); cloneLookup.set(a, b); });
  clone.traverse(node => {
    if (!node.isSkinnedMesh) return;
    const srcMesh = sourceLookup.get(node), srcBones = srcMesh.skeleton.bones;
    node.skeleton = srcMesh.skeleton.clone();
    node.bindMatrix.copy(srcMesh.bindMatrix);
    node.skeleton.bones = srcBones.map(b => cloneLookup.get(b));
    node.bind(node.skeleton, node.bindMatrix);
  });
  return clone;
  function parallelTraverse(a, b, cb) { cb(a, b); for (let i = 0; i < a.children.length; i++) parallelTraverse(a.children[i], b.children[i], cb); }
}
