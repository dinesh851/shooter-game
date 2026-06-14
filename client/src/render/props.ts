import * as THREE from "three";

// A library of DISTINCT warehouse/industrial props, each built from primitives.
// Every prop is a unique model (no duplicates) sized to match shared/props-data.ts.
// Each build() returns a Group centred on x/z with its feet at y = 0.

const std = (color: number, rough = 0.8, metal = 0.1, flat = true) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, flatShading: flat });

// shared palette (reused across props for fewer materials)
const M = {
  wood: std(0x9c6b3f, 0.85, 0.0),
  woodDark: std(0x6b4a2a, 0.85, 0.0),
  steel: std(0x9098a3, 0.55, 0.6),
  steelDark: std(0x3d444d, 0.6, 0.6),
  rust: std(0x8a5638, 0.85, 0.3),
  red: std(0xb83a2e, 0.6, 0.2),
  blue: std(0x2e6fb8, 0.6, 0.2),
  green: std(0x3f7a4a, 0.6, 0.2),
  yellow: std(0xd6b23a, 0.6, 0.2),
  concrete: std(0x9a9a92, 0.95, 0.0),
  rubber: std(0x1b1e23, 0.9, 0.0),
  plastic: std(0x49525d, 0.5, 0.1),
  sand: std(0xc7b079, 0.95, 0.0),
  card: std(0xb89a6a, 0.9, 0.0),
  glass: std(0x223040, 0.2, 0.1),
  screen: new THREE.MeshStandardMaterial({ color: 0x123, emissive: 0x2bd1c4, emissiveIntensity: 0.8 }),
};

function bx(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}
function cy(rt: number, rb: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 14): THREE.Mesh {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}
function edges(mesh: THREE.Mesh, color = 0x2c1d10) {
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color })));
  return mesh;
}
function g(...items: THREE.Object3D[]): THREE.Group {
  const grp = new THREE.Group();
  grp.add(...items);
  return grp;
}

// ---- crates / boxes ----
const crateWood = () => g(edges(bx(1.2, 1.2, 1.2, M.wood, 0, 0.6, 0)));
const crateWoodLarge = () => g(edges(bx(2, 2, 2, M.woodDark, 0, 1.0, 0)));
const crateMetal = () => {
  const c = edges(bx(1.4, 1.4, 1.4, M.steel, 0, 0.7, 0), 0x2a2f36);
  return g(c, bx(1.45, 0.12, 1.45, M.steelDark, 0, 1.36, 0));
};
const crateStack = () =>
  g(
    edges(bx(2.2, 1.2, 1.6, M.wood, 0, 0.6, 0)),
    edges(bx(1.4, 1.1, 1.2, M.woodDark, -0.2, 1.75, 0.1)),
    edges(bx(1.0, 0.9, 1.0, M.wood, 0.6, 1.65, -0.1))
  );

// ---- barrels ----
const barrel = (m: THREE.Material) => {
  const b = cy(0.4, 0.4, 1.1, m, 0, 0.55, 0);
  const r1 = cy(0.42, 0.42, 0.08, M.steelDark, 0, 0.85, 0);
  const r2 = cy(0.42, 0.42, 0.08, M.steelDark, 0, 0.25, 0);
  return g(b, r1, r2);
};
const barrelRed = () => barrel(M.red);
const barrelBlue = () => barrel(M.blue);
const barrelStack = () => {
  const grp = new THREE.Group();
  const pos: [number, number][] = [
    [-0.45, -0.45],
    [0.45, -0.45],
    [-0.45, 0.45],
    [0.45, 0.45],
  ];
  const cols = [M.red, M.blue, M.green, M.yellow];
  pos.forEach((p, i) => {
    const b = barrel(cols[i]);
    b.position.set(p[0], 0, p[1]);
    grp.add(b);
  });
  return grp;
};

// ---- shipping containers ----
const containerBody = (color: THREE.Material) => {
  const grp = new THREE.Group();
  const body = bx(6, 2.6, 2.6, color, 0, 1.3, 0);
  grp.add(body);
  // corrugation ribs
  for (let i = -2.6; i <= 2.6; i += 0.5) grp.add(bx(0.06, 2.4, 2.62, M.steelDark, i, 1.3, 0));
  grp.add(bx(6.05, 0.16, 2.66, M.steelDark, 0, 2.55, 0), bx(6.05, 0.16, 2.66, M.steelDark, 0, 0.1, 0));
  return grp;
};
const container = () => containerBody(M.blue);
const containerOpen = () => {
  const grp = containerBody(M.green);
  // dark interior opening on one end
  grp.add(bx(0.05, 2.2, 2.2, M.rubber, 2.98, 1.3, 0));
  return grp;
};
const containerStack = () => {
  const a = containerBody(M.red);
  const b = containerBody(M.yellow);
  b.position.y = 2.7;
  return g(a, b);
};

// ---- pallets / shelving ----
const palletStack = () => {
  const grp = new THREE.Group();
  const pallet = (y: number) => {
    const p = new THREE.Group();
    for (const x of [-0.5, 0, 0.5]) p.add(bx(0.12, 0.14, 1.1, M.woodDark, x, y, 0));
    p.add(bx(1.4, 0.06, 1.1, M.wood, 0, y + 0.1, 0));
    return p;
  };
  grp.add(pallet(0.07));
  grp.add(edges(bx(1.2, 1.0, 0.95, M.card, 0, 0.7, 0)));
  grp.add(bx(1.25, 0.04, 1.0, M.steelDark, 0, 1.22, 0)); // shrink-wrap strap
  return grp;
};
const shelfFrame = () => {
  const grp = new THREE.Group();
  for (const x of [-1.5, 1.5]) for (const z of [-0.45, 0.45]) grp.add(bx(0.12, 4, 0.12, M.rust, x, 2, z));
  for (const y of [0.1, 1.4, 2.7, 3.9]) grp.add(bx(3.1, 0.1, 1, M.steel, 0, y, 0));
  return grp;
};
const shelfRack = () => shelfFrame();
const shelfStocked = () => {
  const grp = shelfFrame();
  const boxes = [M.card, M.wood, M.blue, M.red, M.woodDark];
  let i = 0;
  for (const y of [0.55, 1.85, 3.15]) {
    for (const x of [-1, 0, 1]) grp.add(edges(bx(0.85, 0.8, 0.85, boxes[i++ % boxes.length], x, y, 0)));
  }
  return grp;
};

// ---- vehicles / machinery ----
const forklift = () => {
  const grp = new THREE.Group();
  grp.add(bx(1.3, 0.9, 1.8, M.yellow, 0, 0.7, -0.2)); // body
  grp.add(bx(1.0, 0.8, 0.9, M.steelDark, 0, 1.5, -0.6)); // cab
  grp.add(bx(0.12, 2.2, 0.12, M.steelDark, -0.3, 1.1, 1.3), bx(0.12, 2.2, 0.12, M.steelDark, 0.3, 1.1, 1.3)); // mast
  grp.add(bx(0.4, 0.1, 1.0, M.steel, -0.3, 0.15, 1.6), bx(0.4, 0.1, 1.0, M.steel, 0.3, 0.15, 1.6)); // forks
  for (const x of [-0.55, 0.55]) for (const z of [-0.8, 0.6]) grp.add(cy(0.32, 0.32, 0.3, M.rubber, x, 0.32, z).rotateZ(Math.PI / 2) as any);
  return grp;
};
const generator = () => {
  const grp = g(
    bx(2.6, 1.2, 1.6, M.green, 0, 0.7, 0),
    bx(2.4, 0.5, 1.4, M.steelDark, 0, 1.45, 0),
    cy(0.12, 0.12, 0.8, M.steel, 1.0, 1.8, -0.4)
  );
  grp.add(bx(0.5, 0.4, 0.05, M.screen, -0.9, 1.0, 0.81));
  return grp;
};
const machinePress = () => {
  const grp = g(
    bx(2.2, 0.4, 1.8, M.steelDark, 0, 0.2, 0),
    bx(0.4, 2.6, 0.4, M.rust, -0.8, 1.3, 0),
    bx(0.4, 2.6, 0.4, M.rust, 0.8, 1.3, 0),
    bx(2.2, 0.5, 1.4, M.steel, 0, 2.45, 0),
    bx(1.4, 0.8, 1.0, M.yellow, 0, 1.2, 0)
  );
  grp.add(bx(0.4, 0.3, 0.05, M.screen, 0, 1.6, 0.55));
  return grp;
};
const cementMixer = () => {
  const grp = new THREE.Group();
  grp.add(bx(1.8, 0.4, 1.6, M.steelDark, 0, 0.2, 0));
  for (const x of [-0.7, 0.7]) grp.add(bx(0.12, 1.6, 0.12, M.rust, x, 1.0, -0.5));
  const drum = cy(0.7, 0.5, 1.2, M.yellow, 0, 1.3, 0.2);
  drum.rotation.z = Math.PI / 2.4;
  grp.add(drum);
  return grp;
};

// ---- tanks / pipes / hvac ----
const waterTank = () => {
  const grp = g(cy(1.0, 1.0, 2.6, M.steel, 0, 1.5, 0, 18), cy(1.0, 0.0, 0.5, M.steel, 0, 3.0, 0, 18));
  for (const a of [0, 1, 2]) {
    const leg = bx(0.12, 0.6, 0.12, M.rust, Math.cos((a * 2 * Math.PI) / 3) * 0.8, 0.3, Math.sin((a * 2 * Math.PI) / 3) * 0.8);
    grp.add(leg);
  }
  grp.add(cy(1.02, 1.02, 0.1, M.rust, 0, 0.9, 0, 18), cy(1.02, 1.02, 0.1, M.rust, 0, 2.1, 0, 18));
  return grp;
};
const pipeRack = () => {
  const grp = new THREE.Group();
  for (const x of [-1.4, 1.4]) grp.add(bx(0.14, 2, 0.8, M.rust, x, 1, 0));
  const cols = [M.steel, M.rust, M.blue];
  [0.4, 0.9, 1.4].forEach((y, i) => {
    const p = cy(0.18, 0.18, 3.0, cols[i], 0, y, 0, 12);
    p.rotation.z = Math.PI / 2;
    grp.add(p);
  });
  return grp;
};
const ventDuct = () => {
  const grp = new THREE.Group();
  const main = bx(0.9, 0.9, 4, M.steel, 0, 0.5, 0);
  grp.add(main);
  for (let z = -1.8; z <= 1.8; z += 0.6) grp.add(bx(0.96, 0.96, 0.08, M.steelDark, 0, 0.5, z));
  grp.add(bx(0.9, 0.9, 0.9, M.steel, 0, 1.35, 1.5)); // elbow up
  return grp;
};
const hvacUnit = () => {
  const grp = g(bx(2.2, 1.2, 2.2, M.steel, 0, 0.6, 0), bx(2.0, 0.2, 2.0, M.steelDark, 0, 1.3, 0));
  grp.add(cy(0.7, 0.7, 0.12, M.steelDark, 0, 1.42, 0, 18)); // fan housing
  // fan blades
  for (let i = 0; i < 4; i++) {
    const blade = bx(0.6, 0.02, 0.16, M.rubber, 0, 1.5, 0);
    blade.rotation.y = (i * Math.PI) / 2;
    grp.add(blade);
  }
  return grp;
};

// ---- electrical / misc ----
const controlPanel = () =>
  g(
    bx(1.6, 2, 0.6, M.steelDark, 0, 1, 0),
    bx(1.4, 0.5, 0.05, M.screen, 0, 1.4, 0.31),
    bx(0.2, 0.2, 0.1, M.red, -0.5, 0.7, 0.31),
    bx(0.2, 0.2, 0.1, M.green, -0.1, 0.7, 0.31),
    bx(0.2, 0.2, 0.1, M.yellow, 0.3, 0.7, 0.31)
  );
const serverRack = () => {
  const grp = bx(1.2, 2.4, 0.9, M.rubber, 0, 1.2, 0);
  const grp2 = g(grp);
  for (let y = 0.3; y < 2.3; y += 0.28) grp2.add(bx(1.1, 0.2, 0.02, M.screen, 0, y, 0.46));
  return grp2;
};
const workbench = () => {
  const grp = new THREE.Group();
  grp.add(bx(2.2, 0.12, 1, M.wood, 0, 1.0, 0));
  for (const x of [-1, 1]) for (const z of [-0.4, 0.4]) grp.add(bx(0.12, 1, 0.12, M.steelDark, x, 0.5, z));
  grp.add(bx(0.5, 0.3, 0.3, M.red, -0.6, 1.25, 0), bx(0.3, 0.4, 0.3, M.steel, 0.6, 1.3, 0)); // tools/vice
  return grp;
};
const dumpster = () => {
  const grp = g(bx(2.4, 1.4, 1.4, M.green, 0, 0.8, 0), bx(2.5, 0.2, 1.5, M.steelDark, 0, 1.55, 0));
  for (const x of [-1.0, 1.0]) grp.add(cy(0.25, 0.25, 0.2, M.rubber, x, 0.2, 0.7).rotateZ(Math.PI / 2) as any);
  return grp;
};
const gasCylinders = () => {
  const grp = new THREE.Group();
  grp.add(bx(1.4, 1.6, 0.2, M.rust, 0, 0.8, -0.35)); // rack back
  const cols = [M.green, M.blue, M.red, M.yellow];
  [-0.45, -0.15, 0.15, 0.45].forEach((x, i) => {
    grp.add(cy(0.16, 0.16, 1.3, cols[i], x, 0.7, 0, 12), cy(0.1, 0.1, 0.2, M.steelDark, x, 1.45, 0, 10));
  });
  return grp;
};

// ---- piles / soft cover ----
const sandbagWall = () => {
  const grp = new THREE.Group();
  for (let r = 0; r < 3; r++) {
    const off = (r % 2) * 0.3;
    for (let i = -1.3 + off; i <= 1.3; i += 0.6) {
      const b = bx(0.55, 0.32, 0.9, M.sand, i, 0.16 + r * 0.32, 0);
      grp.add(b);
    }
  }
  return grp;
};
const concreteBarrier = () => {
  const grp = new THREE.Group();
  // jersey barrier trapezoid-ish
  grp.add(bx(2.2, 0.4, 0.8, M.concrete, 0, 0.2, 0));
  grp.add(bx(2.2, 0.5, 0.4, M.concrete, 0, 0.65, 0));
  grp.add(bx(2.2, 0.2, 0.55, M.concrete, 0, 1.0, 0));
  // hazard stripes
  for (let i = -0.9; i <= 0.9; i += 0.5) grp.add(bx(0.18, 0.3, 0.42, M.yellow, i, 0.65, 0.01));
  return grp;
};
const tireStack = () => {
  const grp = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const t = cy(0.75, 0.75, 0.34, M.rubber, (i % 2) * 0.1, 0.18 + i * 0.34, 0, 18);
    const inner = cy(0.4, 0.4, 0.36, M.steelDark, (i % 2) * 0.1, 0.18 + i * 0.34, 0, 14);
    grp.add(t, inner);
  }
  return grp;
};
const plankPile = () => {
  const grp = new THREE.Group();
  for (let i = 0; i < 6; i++) grp.add(bx(2.6, 0.12, 0.22, M.wood, 0, 0.07 + i * 0.13, -0.4 + (i % 3) * 0.4));
  grp.add(bx(0.1, 0.8, 1.3, M.steelDark, -1.1, 0.4, 0), bx(0.1, 0.8, 1.3, M.steelDark, 1.1, 0.4, 0));
  return grp;
};
const sackStack = () => {
  const grp = new THREE.Group();
  const sack = (x: number, y: number, z: number, r: number) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), M.card);
    s.scale.set(1, 0.6, 0.7);
    s.position.set(x, y, z);
    s.rotation.y = r;
    s.castShadow = true;
    return s;
  };
  grp.add(sack(-0.4, 0.3, -0.3, 0.2), sack(0.4, 0.32, 0.3, -0.3), sack(-0.3, 0.3, 0.4, 0.5), sack(0.35, 0.9, 0, 0.1), sack(-0.2, 0.92, -0.1, -0.2));
  return grp;
};
const cableSpool = () => {
  const grp = new THREE.Group();
  const f1 = cy(0.9, 0.9, 0.12, M.woodDark, 0, 0.9, -0.45, 20);
  const f2 = cy(0.9, 0.9, 0.12, M.woodDark, 0, 0.9, 0.45, 20);
  f1.rotation.x = f2.rotation.x = Math.PI / 2;
  const core = cy(0.5, 0.5, 0.9, M.rubber, 0, 0.9, 0, 16);
  core.rotation.x = Math.PI / 2;
  grp.add(f1, f2, core);
  return grp;
};

export const PROPS: Record<string, () => THREE.Group> = {
  crateWood,
  crateWoodLarge,
  crateMetal,
  crateStack,
  barrelRed,
  barrelBlue,
  barrelStack,
  container,
  containerOpen,
  containerStack,
  palletStack,
  shelfRack,
  shelfStocked,
  forklift,
  pipeRack,
  ventDuct,
  hvacUnit,
  controlPanel,
  generator,
  waterTank,
  sandbagWall,
  concreteBarrier,
  tireStack,
  plankPile,
  workbench,
  dumpster,
  gasCylinders,
  cableSpool,
  sackStack,
  machinePress,
  serverRack,
  cementMixer,
};

export function buildProp(name: string): THREE.Group | null {
  const f = PROPS[name];
  return f ? f() : null;
}
