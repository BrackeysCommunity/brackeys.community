/**
 * Generates the stress project's scenes as scene op batches and applies them
 * through the scene CLI: one scene per subsystem (`pile`, `movers`, `field`,
 * `wall`, `rooms`, `terrain`, `churn`, `crowd`) and `combined`, which holds a
 * smaller share of each. A scene is rows of four 24 × 16 m bays; a
 * subsystem's load is how many bays of it the scene has (`LOADS`,
 * `COMBINED`), a fraction being a bay with fewer rows. The same loads and
 * scale always give the same batches, so a rebuild at the committed scale
 * changes no file.
 *
 *   bun src/games/stress/tools/make-scenes.ts [--scale n] [--only pile,crowd] [--dry-run]
 *
 * `--scale` multiplies every load. An existing scene is emptied and filled
 * again in one batch; a missing scene, checks file or prefab is created
 * first (a prefab that exists is left as it is), and without `--only` the
 * scene list is set to every scene. It runs under Bun only: game code
 * imports no Node built-ins, so it starts the CLI through `Bun.spawnSync`.
 */

type Op = Record<string, unknown>;
type Shape = (string | number)[];

export const BAY_W = 24;
export const BAY_H = 16;
/** Bays per row of a scene. */
const COLUMNS = 4;

export const PART_NAMES = [
  "pile",
  "movers",
  "field",
  "wall",
  "rooms",
  "terrain",
  "churn",
  "crowd",
] as const;
export type PartName = (typeof PART_NAMES)[number];

/**
 * Bays of its subsystem in each isolated scene, sized for a headless tick of
 * a few milliseconds. `wall` only draws, so its size is its sprite count.
 */
export const LOADS: Readonly<Record<PartName, number>> = {
  pile: 9,
  movers: 32,
  field: 4,
  wall: 4,
  rooms: 64,
  terrain: 16,
  churn: 2,
  crowd: 1.5,
};

/** Bays of each subsystem in `combined`, in bay order: the crowd's first, far from the terrain's walk area. */
export const COMBINED: readonly (readonly [PartName, number])[] = [
  ["crowd", 0.125],
  ["pile", 1],
  ["movers", 2],
  ["field", 1],
  ["wall", 1],
  ["rooms", 2],
  ["churn", 0.5],
  ["terrain", 1],
];

/** Agents a full crowd bay holds. */
export const CROWD_PER_BAY = 400;

const SPAWNER = { rate: 60, cap: 240, lifeMs: 4000 };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** mulberry32: the same sequence on every runtime. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (entity: Record<string, unknown>): Op => ({ op: "add", entity });
const bulk = (shapes: Shape[], key = "solid"): Op => ({ op: "addBulk", key, shapes });
const instantiate = (instance: Record<string, unknown>): Op => ({ op: "instantiate", instance });
const note = (id: string, x: number, y: number, text: string): Op =>
  add({ id, type: "note", at: [r2(x), r2(y)], text });

/** One bay: its origin, its id prefix, and `k`, the share of a full bay's rows it holds. */
type Bay = { ox: number; oy: number; k: number; p: string };

/** `full` rows cut to the bay's share, never none. */
const rows = (full: number, bay: Bay) => Math.max(1, Math.round(full * bay.k));

type Tally = { spawners: number; balls: number; agents: number };
type Part = { walled: boolean; build(bay: Bay, tally: Tally): Op[] };

const frame = ({ ox, oy }: Bay): Op =>
  bulk([
    ["box", ox + 12, r2(oy + 15.8), 11.6, 0.2],
    ["box", ox + 12, r2(oy + 0.1), 11.6, 0.1],
    ["box", r2(ox + 0.2), oy + 8, 0.2, 8],
    ["box", r2(ox + 23.8), oy + 8, 0.2, 8],
  ]);

const pile: Part = {
  walled: true,
  build(bay) {
    const { ox, oy, p } = bay;
    const rand = rng(1);
    const ops: Op[] = [
      add({
        id: `${p}-funnel-l`,
        type: "solid",
        shape: ["box", r2(ox + 5.2), r2(oy + 12.2), 5, 0.1, 18],
      }),
      add({
        id: `${p}-funnel-r`,
        type: "solid",
        shape: ["box", r2(ox + 18.8), r2(oy + 12.2), 5, 0.1, -18],
      }),
    ];
    const pegs: Shape[] = [];
    for (let row = 0; row < 4; row++) {
      const y = oy + 8.4 + row * 0.5;
      for (let x = 1.5 + (row % 2) * 0.5; x <= 22.5; x += 1)
        pegs.push(["circle", r2(ox + x), r2(y), 0.08]);
    }
    ops.push(bulk(pegs));
    let n = 0;
    for (let row = 0; row < rows(18, bay); row++)
      for (let col = 0; col < 28; col++) {
        const x = r2(ox + 1.6 + col * 0.76);
        const y = r2(oy + 0.8 + row * 0.4);
        const kind = n % 4;
        const shape: Shape =
          kind === 0
            ? ["box", x, y, 0.14, 0.12]
            : kind === 1
              ? ["circle", x, y, 0.14]
              : kind === 2
                ? ["capsule", x, y, 0.12, 0.08]
                : ["box", x, y, 0.1, 0.1, 45];
        const entity: Record<string, unknown> = {
          id: `${p}-p-${n}`,
          type: "prop",
          shape,
          density: r2(0.5 + rand() * 3.5),
          restitution: r2(rand() * 0.5),
        };
        if (n % 5 === 0) entity.material = "bouncy";
        if (n % 3 === 0)
          entity.behaviors = {
            sprite: {
              asset: "stress-crates",
              frame: n % 2 ? "crate-1" : "crate-0",
              size: kind === 1 ? [0.28, 0.28] : kind === 2 ? [0.4, 0.16] : [0.28, 0.24],
            },
          };
        ops.push(add(entity));
        n++;
      }
    ops.push(
      note(
        `${p}-about`,
        ox + 0.6,
        oy + 1.2,
        `Pile: ${n} props of four shapes fall through pegs and a funnel into one heap. Loads the rigid-body solver and the pose sync of every dynamic body.`,
      ),
    );
    return ops;
  },
};

const movers: Part = {
  walled: true,
  build(bay) {
    const { ox, oy, p } = bay;
    const ops: Op[] = [];
    let n = 0;
    for (let row = 0; row < rows(9, bay); row++)
      for (let col = 0; col < 10; col++) {
        const cx = r2(ox + 1.65 + col * 2.3);
        const cy = r2(oy + 1.5 + row * 1.55);
        const loop = n % 2 === 1;
        const pts = loop
          ? [
              [r2(cx - 0.45), r2(cy - 0.3)],
              [r2(cx + 0.45), r2(cy - 0.3)],
              [r2(cx + 0.45), r2(cy + 0.3)],
              [r2(cx - 0.45), r2(cy + 0.3)],
            ]
          : [
              [r2(cx - 0.5), cy],
              [r2(cx + 0.5), cy],
            ];
        const [px, py] = pts[0] as [number, number];
        const path: Record<string, unknown> = {
          pts,
          mode: loop ? "loop" : "ping_pong",
          speed: r2(loop ? 0.5 + (n % 5) * 0.3 : 0.3 + (n % 7) * 0.25),
        };
        if (n % 3) path.pauseMs = (n % 3) * 150;
        const follower: Record<string, unknown> = {
          id: `${p}-f-${n}`,
          type: "follower",
          shape: ["box", 0, 0, 0.45, 0.05],
          path,
        };
        if (n % 2 === 0)
          follower.behaviors = {
            sprite: { asset: "stress-hero", frame: n % 4 ? "hero-1" : "hero-0", size: [0.9, 0.1] },
          };
        ops.push(
          add(follower),
          add({
            id: `${p}-lip-${n}`,
            type: "solid",
            shape: ["box", r2(px + 0.39), r2(py - 0.11), 0.06, 0.06],
            attach: `${p}-f-${n}`,
          }),
          add({
            id: `${p}-rider-${n}`,
            type: "prop",
            shape: ["box", r2(px - 0.1), r2(py - 0.17), 0.1, 0.1],
            density: 1,
            restitution: 0,
          }),
        );
        n++;
      }
    ops.push(
      note(
        `${p}-about`,
        ox + 0.6,
        oy + 0.5,
        `Movers: ${n} followers on ping-pong and loop paths, each carrying an attached lip and a loose rider. Loads path following, attachments and kinematic contacts.`,
      ),
    );
    return ops;
  },
};

const field: Part = {
  walled: true,
  build(bay, tally) {
    const { ox, oy, p } = bay;
    const ops: Op[] = [];
    let sensors = 0;
    for (let row = 0; row < rows(9, bay); row++)
      for (let col = 0; col < 14; col++) {
        const x = r2(ox + 1.6 + col * 1.6);
        const y = r2(oy + 2.2 + row * 1.35);
        ops.push(
          add({
            id: `${p}-s-${sensors}`,
            type: "sensor",
            shape: sensors % 2 ? ["circle", x, y, 0.85] : ["box", x, y, 0.9, 0.75],
            tags: ["field", `ring-${row}`],
          }),
        );
        sensors++;
      }
    const zig: Shape = ["chain"];
    for (let i = 0; i <= 20; i++) zig.push(r2(ox + 0.4 + i * 1.16), r2(oy + (i % 2 ? 14.9 : 15.5)));
    ops.push(add({ id: `${p}-zig`, type: "solid", shape: zig, material: "bouncy" }));
    for (let i = 0; i < 5; i++) {
      const x = r2(ox + 3 + i * 4.5);
      ops.push(
        add({
          id: `${p}-piston-${i}`,
          type: "follower",
          shape: ["box", 0, 0, 1.2, 0.1],
          material: "bouncy",
          path: {
            pts: [
              [x, r2(oy + 14.2)],
              [x, r2(oy + 12.8)],
            ],
            mode: "ping_pong",
            speed: r2(2.4 + i * 0.3),
          },
        }),
        add({
          id: `${p}-reach-${i}`,
          type: "sensor",
          shape: ["box", x, r2(oy + 13.8), 1.2, 0.3],
          attach: `${p}-piston-${i}`,
          tags: ["riding"],
        }),
      );
    }
    let balls = 0;
    for (let row = 0; row < rows(4, bay); row++)
      for (let col = 0; col < 24; col++) {
        const ball: Record<string, unknown> = {
          id: `${p}-b-${balls}`,
          type: "prop",
          shape: ["circle", r2(ox + 1.3 + col * 0.93), r2(oy + 0.6 + row * 0.32), 0.12],
          density: 1,
          restitution: 0.92,
          friction: 0,
          material: "bouncy",
        };
        if (balls % 4 === 0) ball.ccd = true;
        ops.push(add(ball));
        balls++;
      }
    tally.balls += balls;
    ops.push(
      note(
        `${p}-about`,
        ox + 0.6,
        oy + 0.5,
        `Field: ${balls} bouncy balls cross ${sensors} overlapping sensors and 5 more riding the pistons; a zigzag floor keeps them moving. Loads overlap tracking and sensor events.`,
      ),
    );
    return ops;
  },
};

const BLENDS = ["normal", "add", "multiply", "screen"];

const wall: Part = {
  walled: false,
  build(bay) {
    const { ox, oy, p } = bay;
    const rand = rng(4);
    const ops: Op[] = [];
    const washes = rows(48, bay);
    for (let i = 0; i < washes; i++)
      ops.push(
        add({
          id: `${p}-wash-${i}`,
          type: "decor",
          z: -100 - i,
          at: [r2(ox + 3 + rand() * 18), r2(oy + 2.4 + rand() * 11)],
          behaviors: {
            sprite: {
              asset: "stress-backdrop",
              size: [5, 3.5],
              alpha: 0.12,
              blend: BLENDS[i % 4],
              tint: Math.floor(rand() * 0xffffff),
            },
          },
        }),
      );
    const size = [0.44, 0.44];
    const count = rows(30, bay);
    let n = 0;
    for (let row = 0; row < count; row++)
      for (let col = 0; col < 48; col++) {
        const at = [r2(ox + 0.7 + col * 0.47), r2(oy + 0.6 + row * 0.49)];
        // A third of the rows each: one atlas, mixed textures, then every batch-breaking state.
        const band = Math.floor((row * 3) / count);
        let sprite: Record<string, unknown>;
        if (band === 0)
          sprite = { asset: "stress-crates", frame: n % 2 ? "crate-1" : "crate-0", size };
        else if (band === 1) {
          const pick = n % 3;
          sprite =
            pick === 0
              ? { asset: "stress-crates", frame: "crate-0", size }
              : pick === 1
                ? { asset: "stress-hero", frame: "hero-1", size }
                : { asset: "stress-backdrop", size, tile: true };
        } else
          sprite = {
            asset: n % 2 ? "stress-crates" : "stress-hero",
            frame: n % 2 ? "crate-1" : "hero-0",
            size,
            blend: BLENDS[n % 4],
            tint: Math.floor(rand() * 0xffffff),
            alpha: r2(0.4 + rand() * 0.6),
            ...(n % 3 === 0 ? { flipX: true } : {}),
            ...(n % 5 === 0 ? { flipY: true } : {}),
          };
        const entity: Record<string, unknown> = {
          id: `${p}-s-${n}`,
          type: "decor",
          at,
          behaviors: { sprite },
        };
        if (band === 2) entity.z = ((n * 37) % 21) - 10;
        ops.push(add(entity));
        n++;
      }
    const fades = rows(96, bay);
    for (let i = 0; i < fades; i++)
      ops.push(
        add({
          id: `${p}-fade-${i}`,
          type: "decor",
          at: [r2(ox + 0.6 + i * 0.24), r2(oy + 15.35)],
          behaviors: {
            sprite: { asset: "stress-crates", frame: "crate-1", size: [0.2, 0.2] },
            lifetime: { ms: 1000 + i * 250 },
          },
        }),
      );
    ops.push(
      note(
        `${p}-about`,
        ox + 0.6,
        oy + 0.4,
        `Wall: ${n} sprites with no bodies. The first third of the rows share one atlas (best case for batching), the second alternates textures, the last alternates blend, tint, alpha and z (worst case). ${washes} translucent washes add overdraw; ${fades} fades are destroyed over the first ${Math.round((1000 + fades * 250) / 1000)} s.`,
      ),
    );
    return ops;
  },
};

const rooms: Part = {
  walled: true,
  build(bay) {
    const { ox, oy, p } = bay;
    const ops: Op[] = [];
    let room = 0;
    let prop = 0;
    for (let row = 0; row < rows(6, bay); row++) {
      const y = r2(oy + 2.6 + row * 2.5);
      for (let col = 0; col < 3; col++) {
        const x = ox + 4 + col * 8;
        ops.push(
          instantiate({
            id: `${p}-room-${room}`,
            prefab: "stress-room",
            at: [x, y],
            params: { doorSpeed: r2(0.3 + (room % 6) * 0.2) },
            ...(room % 2 ? { flip: true } : {}),
          }),
        );
        for (const dx of [-2.4, -0.1, 0.5, 2.4])
          ops.push(
            add({
              id: `${p}-p-${prop++}`,
              type: "prop",
              shape: ["box", r2(x + dx), r2(y - 1), 0.12, 0.12],
              density: 1,
              restitution: 0.1,
            }),
          );
        room++;
      }
      const west =
        row % 2 === 0
          ? {
              id: `${p}-post-${row}`,
              prefab: "stress-post",
              at: [ox + 8, y],
              ...(row % 4 === 0 ? { params: { mark: "peak" } } : {}),
            }
          : { id: `${p}-gate-${row}`, prefab: "stress-gate", at: [ox + 8, r2(y - 0.8)], rot: 1 };
      const east =
        row % 2 === 0
          ? { id: `${p}-door-${row}`, prefab: "stress-doorway", at: [r2(ox + 15.7), y], z: 3 }
          : { id: `${p}-latch-${row}`, prefab: "stress-one-way-latch", at: [ox + 16, y] };
      ops.push(instantiate(west), instantiate(east));
    }
    ops.push(
      note(
        `${p}-about`,
        ox + 0.6,
        oy + 0.4,
        `Rooms: ${room} room instances, each nesting a doorway and two latches, half of them mirrored, with posts, turned gates and variants between. Loads prefab expansion, nested followers and transforms.`,
      ),
    );
    return ops;
  },
};

const terrain: Part = {
  walled: true,
  build(bay) {
    const { ox, oy, p } = bay;
    const rand = rng(6);
    const ops: Op[] = [];
    const ground: Shape = ["chain"];
    for (let i = 0; i <= 116; i++) {
      // The ends stop just inside the walls.
      const x = i === 0 ? 0.42 : i === 116 ? 23.58 : 0.4 + i * 0.2;
      ground.push(r2(ox + x), r2(oy + 14.4 + 0.5 * Math.sin(x * 0.9) + 0.3 * Math.sin(x * 2.3)));
    }
    ops.push(add({ id: `${p}-ground`, type: "solid", shape: ground }));
    const shapes: Shape[] = [];
    let n = 0;
    for (let row = 0; row < 6; row++)
      for (let col = 0; col < 15; col++) {
        const cx = r2(ox + 1.2 + col * 1.54 + (rand() - 0.5) * 0.3);
        const cy = r2(oy + 2.4 + row * 1.7 + (rand() - 0.5) * 0.3);
        const rot = Math.round((rand() - 0.5) * 50);
        const kind = n % 4;
        shapes.push(
          kind === 0
            ? ["box", cx, cy, 0.5, 0.06, rot]
            : kind === 1
              ? ["poly", r2(cx - 0.4), r2(cy + 0.2), r2(cx + 0.4), r2(cy + 0.2), cx, r2(cy - 0.25)]
              : kind === 2
                ? ["capsule", cx, cy, 0.35, 0.08, rot]
                : ["circle", cx, cy, 0.2],
        );
        n++;
      }
    ops.push(bulk(shapes));
    let d = 0;
    for (let row = 0; row < rows(3, bay); row++)
      for (let col = 0; col < 78; col++) {
        const x = r2(ox + 0.7 + col * 0.29);
        const y = r2(oy + 0.5 + row * 0.3);
        ops.push(
          add({
            id: `${p}-r-${d}`,
            type: "prop",
            shape: d % 2 ? ["circle", x, y, 0.07] : ["box", x, y, 0.06, 0.06],
            density: 3,
            restitution: 0.2,
            ccd: true,
          }),
        );
        d++;
      }
    const walk: Shape = ["poly", r2(ox + 0.6), oy + 4];
    for (let k = 0; k < 5; k++) {
      const x0 = r2(ox + 1.6 + k * 4.6);
      const x1 = r2(x0 + 2.4);
      walk.push(x0, oy + 4, x0, r2(oy + 1.2), x1, r2(oy + 1.2), x1, oy + 4);
    }
    walk.push(r2(ox + 23.4), oy + 4, r2(ox + 23.4), r2(oy + 15.4), r2(ox + 0.6), r2(oy + 15.4));
    ops.push(add({ id: `${p}-walk`, type: "nav", shape: walk }));
    let h = 0;
    for (let row = 0; row < 4; row++)
      for (let col = 0; col < 6; col++) {
        const x = ox + 2.5 + col * 3.6;
        const y = oy + 5.5 + row * 2.5;
        ops.push(
          add({
            id: `${p}-hole-${h++}`,
            type: "nav",
            mode: "block",
            shape: [
              "poly",
              r2(x - 0.5),
              r2(y - 0.5),
              r2(x + 0.5),
              r2(y - 0.5),
              r2(x + 0.5),
              r2(y + 0.5),
              r2(x - 0.5),
              r2(y + 0.5),
            ],
          }),
        );
      }
    ops.push(
      note(
        `${p}-about`,
        ox + 0.6,
        oy + 0.4,
        `Terrain: ${d} CCD props rain onto ${n} turned boxes, triangles, capsules and circles and a 117-point chain. A comb-shaped walk area with ${h} holes sits over it. Loads static colliders, CCD and the nav mesh.`,
      ),
    );
    return ops;
  },
};

const PELLETS = ["ball", "box", "capsule"];

const churn: Part = {
  walled: true,
  build(bay, tally) {
    const { ox, oy, p } = bay;
    const ops: Op[] = [
      add({
        id: `${p}-slope-l`,
        type: "solid",
        shape: ["box", r2(ox + 6), r2(oy + 10), 5, 0.1, 12],
      }),
      add({
        id: `${p}-slope-r`,
        type: "solid",
        shape: ["box", r2(ox + 18), r2(oy + 10), 5, 0.1, -12],
      }),
    ];
    const pegs: Shape[] = [];
    for (let row = 0; row < 5; row++)
      for (let x = 1.5 + (row % 2) * 0.75; x <= 22.5; x += 1.5)
        pegs.push(["circle", r2(ox + x), r2(oy + 4 + row * 0.9), 0.1]);
    ops.push(bulk(pegs));
    const count = rows(8, bay);
    for (let i = 0; i < count; i++)
      ops.push(
        add({
          id: `${p}-spawner-${i}`,
          type: "spawner",
          at: [r2(ox + 1.5 + i * 3), r2(oy + 1)],
          ...SPAWNER,
          pellet: PELLETS[i % 3],
          spread: 1,
          ...(i % 4 === 3 ? { ccd: true } : {}),
        }),
      );
    tally.spawners += count;
    ops.push(
      note(
        `${p}-about`,
        ox + 0.6,
        oy + 0.5,
        `Churn: ${count} spawners each emit ${SPAWNER.rate} pellets a second that live ${SPAWNER.lifeMs / 1000} s, at most ${SPAWNER.cap} at once, onto pegs and two slopes. Loads spawning, destroying and the game's bookkeeping; the scene settings spawnRate and spawnCap scale it.`,
      ),
    );
    return ops;
  },
};

const crowd: Part = {
  walled: false,
  build(bay, tally) {
    const { ox, oy, p } = bay;
    const ops: Op[] = [
      add({
        id: `${p}-walk`,
        type: "nav",
        shape: ["poly", ox, oy, ox + BAY_W, oy, ox + BAY_W, oy + BAY_H, ox, oy + BAY_H],
      }),
    ];
    let h = 0;
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 6; col++) {
        const x = ox + 2 + col * 3.8;
        const y = oy + 1.5 + row * 3;
        ops.push(
          add({
            id: `${p}-pillar-${h++}`,
            type: "nav",
            mode: "block",
            shape: ["poly", x, y, x + 1, y, x + 1, y + 1, x, y + 1].map((v) =>
              typeof v === "number" ? r2(v) : v,
            ),
          }),
        );
      }
    const agents = Math.round(CROWD_PER_BAY * bay.k);
    tally.agents += agents;
    ops.push(
      note(
        `${p}-about`,
        ox + 0.6,
        oy + 0.5,
        `Crowd: ${agents} agents walk this hall round ${h} pillars, each planning routes over the walk area and pushing off its neighbours every tick. Loads the game's own code; the scene setting crowd sets how many.`,
      ),
    );
    return ops;
  },
};

const PARTS: Readonly<Record<PartName, Part>> = {
  pile,
  movers,
  field,
  wall,
  rooms,
  terrain,
  churn,
  crowd,
};

/** A prefab doc of the project, as its file holds it. */
type PrefabDoc = { id: string } & Record<string, unknown>;

const marker = (id: string, at: [number, number], tags: string[]) => ({
  id,
  type: "marker",
  at,
  tags,
});

/** The rooms' prefabs, innermost first; none holds a sensor, so the rooms scene measures no overlaps. */
export const PREFABS: readonly PrefabDoc[] = [
  {
    kind: "prefab",
    v: 4,
    game: "stress",
    id: "stress-latch",
    entities: [
      { id: "bar", type: "solid", shape: ["box", 0, -0.1, 0.4, 0.1] },
      marker("catch", [0, -0.5], ["latch"]),
    ],
  },
  {
    kind: "prefab",
    v: 4,
    game: "stress",
    id: "stress-one-way-latch",
    base: "stress-latch",
    overrides: { "bar.oneWay": true },
    entities: [],
  },
  {
    kind: "prefab",
    v: 4,
    game: "stress",
    id: "stress-doorway",
    params: {
      speed: {
        default: 0.4,
        description: "How fast the panel slides, in m/s.",
        targets: ["panel.path.speed"],
      },
    },
    instances: [{ id: "latch", prefab: "stress-latch", at: [0.7, 0] }],
    entities: [
      {
        id: "panel",
        type: "follower",
        shape: ["box", 0, 0, 0.08, 0.4],
        path: {
          pts: [
            [0, -0.4],
            [0, -1.2],
          ],
          mode: "ping_pong",
          speed: 0.4,
        },
      },
      marker("frame", [0, -0.6], ["door"]),
    ],
  },
  {
    kind: "prefab",
    v: 4,
    game: "stress",
    id: "stress-gate",
    entities: [
      { id: "bar", type: "solid", shape: ["box", 0, -0.1, 0.6, 0.1] },
      marker("mark", [0, -0.6], ["gate"]),
    ],
  },
  {
    kind: "prefab",
    v: 4,
    game: "stress",
    id: "stress-post",
    params: {
      mark: {
        description: "What the cap marks: a peak post's cap is also tagged peak.",
        map: { "cap.tags": { peak: ["top", "peak"] } },
        targets: ["cap.tags"],
      },
    },
    entities: [
      { id: "pole", type: "solid", shape: ["box", 0, -0.6, 0.1, 0.6] },
      marker("cap", [0, -1.3], ["top"]),
    ],
  },
  {
    kind: "prefab",
    v: 4,
    game: "stress",
    id: "stress-room",
    params: {
      doorSpeed: {
        description: "How fast the doorway's panel slides, in m/s.",
        targets: ["door-1/panel.path.speed"],
      },
    },
    bulk: {
      solid: [
        ["box", 0, 0.1, 3, 0.1],
        ["box", -2.9, -1, 0.1, 1],
        ["box", 2.9, -1, 0.1, 1],
      ],
    },
    instances: [
      { id: "door-1", prefab: "stress-doorway", z: 2, at: [-1.5, 0] },
      { id: "latch-1", prefab: "stress-latch", at: [1.5, 0] },
    ],
    entities: [{ id: "lamp", type: "marker", z: 1, at: [0, -2], tags: ["light"] }],
  },
];

export type StressScene = {
  id: string;
  title: string;
  bounds: [number, number, number, number];
  /** Fills an empty scene: its bounds and settings, then every bay. */
  ops: Op[];
  /** The `checks` of its `.checks.json`. */
  checks: Record<string, unknown>[];
};

const TITLES: Readonly<Record<PartName | "combined", string>> = {
  pile: "Pile (rigid bodies)",
  movers: "Movers (followers)",
  field: "Field (sensors)",
  wall: "Wall (sprites)",
  rooms: "Rooms (prefabs)",
  terrain: "Terrain (static, CCD)",
  churn: "Churn (spawns)",
  crowd: "Crowd (game code)",
  combined: "Combined",
};

/** How long every scene's `steps` check runs, in ticks. */
const CHECK_TICKS = 600;

function buildScene(id: string, parts: readonly (readonly [PartName, number])[]): StressScene {
  const bays: { part: PartName; k: number }[] = [];
  for (const [part, load] of parts) {
    const whole = Math.floor(load + 1e-9);
    const rest = load - whole;
    // A crowd bay is always a whole hall; a fraction thins the crowd, not the floor.
    for (let i = 0; i < whole; i++) bays.push({ part, k: 1 });
    if (rest > 0.01) bays.push({ part, k: rest });
  }
  const columns = Math.min(COLUMNS, bays.length);
  const bounds: StressScene["bounds"] = [
    0,
    0,
    columns * BAY_W,
    Math.ceil(bays.length / COLUMNS) * BAY_H,
  ];
  const tally: Tally = { spawners: 0, balls: 0, agents: 0 };
  const seen = new Map<PartName, number>();
  const body: Op[] = [];
  bays.forEach(({ part, k }, i) => {
    const nth = seen.get(part) ?? 0;
    seen.set(part, nth + 1);
    const bay: Bay = {
      ox: (i % COLUMNS) * BAY_W,
      oy: Math.floor(i / COLUMNS) * BAY_H,
      k,
      p: `${part}${nth}`,
    };
    if (PARTS[part].walled) body.push(frame(bay));
    body.push(...PARTS[part].build(bay, tally));
  });

  const settings: Record<string, unknown> = { gravity: [0, 12] };
  if (tally.agents > 0) settings.crowd = tally.agents;
  const ops: Op[] = [
    { op: "setScene", set: { bounds } },
    { op: "setSettings", set: settings },
    ...(tally.agents > 0 ? [{ op: "useAssets", add: ["stress-hero"] }] : []),
    ...body,
  ];

  const counts: Record<string, number> = {};
  if (tally.spawners > 0) {
    // Ten seconds at 60 a second is 600 spawned and 360 destroyed per spawner; half of each proves the churn.
    counts.spawned = tally.spawners * 300;
    counts.destroyed = tally.spawners * 180;
    counts.pellets = tally.spawners;
  }
  if (tally.balls > 0) {
    counts.enters = tally.balls * 2;
    counts.exits = tally.balls;
  }
  if (tally.agents > 0) counts.agents = tally.agents;
  const checks = [
    { id: "valid", kind: "valid" },
    {
      id: "steps",
      kind: "reaches",
      script: { v: 2, steps: [{ wait: CHECK_TICKS }] },
      result: "script-end",
      ...(Object.keys(counts).length > 0 ? { expect: { counts } } : {}),
    },
  ];
  return { id, title: TITLES[id as PartName | "combined"], bounds, ops, checks };
}

/** Every scene of the project at `scale` times the committed loads, the isolated ones first. */
export function stressScenes(scale = 1): StressScene[] {
  return [
    ...PART_NAMES.map((part) => buildScene(part, [[part, LOADS[part] * scale]])),
    buildScene(
      "combined",
      COMBINED.map(([part, load]) => [part, load * scale] as const),
    ),
  ];
}

// ─── Command line ────────────────────────────────────────

/** The slice of Bun's API the command line uses. */
type BunApi = {
  spawnSync(options: { cmd: string[]; stdin?: Uint8Array; stdout: "pipe"; stderr: "pipe" }): {
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
  };
  file(path: string): { json(): Promise<unknown> };
};

const PROJECT = "stress";

/** Every ref of a scene file: its entities, its instances and each bulk entry. */
function refsOf(file: Record<string, unknown>): string[] {
  const refs: string[] = [];
  for (const [key, value] of Object.entries(file)) {
    if (!Array.isArray(value)) continue;
    if (key === "entities" || key === "instances")
      refs.push(...(value as { id: string }[]).map((e) => e.id));
    else if (key !== "assets" && key !== "bounds")
      value.forEach((_, i) => refs.push(`~${key}:${i}`));
  }
  return refs;
}

async function main(bun: BunApi, argv: readonly string[]): Promise<number> {
  const flag = (name: string) => {
    const at = argv.indexOf(name);
    return at < 0 ? undefined : argv[at + 1];
  };
  const dryRun = argv.includes("--dry-run");
  const scale = Number(flag("--scale") ?? 1);
  if (!(scale > 0)) throw new Error("--scale takes a positive number");
  const only = flag("--only")?.split(",");
  const scenes = stressScenes(scale).filter((s) => !only || only.includes(s.id));

  const cli = new URL("../../../../scripts/scene/cli.ts", import.meta.url).pathname;
  const sceneFile = (id: string) => new URL(`../scenes/${id}.json`, import.meta.url).pathname;
  const decoder = new TextDecoder();
  const run = (args: string[], stdin?: unknown) => {
    const out = bun.spawnSync({
      cmd: ["bun", cli, ...args, "--project", PROJECT],
      ...(stdin === undefined ? {} : { stdin: new TextEncoder().encode(JSON.stringify(stdin)) }),
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: out.exitCode, text: decoder.decode(out.stdout) + decoder.decode(out.stderr) };
  };
  /** Applies a batch, or dry-runs it; anything but a clean result stops the build. */
  const apply = (what: string, args: string[], batch: unknown) => {
    const out = run([...args, "--ops", "-", ...(dryRun ? ["--dry-run"] : [])], batch);
    const head = out.text.split("\n").slice(0, 2).join("\n");
    console.log(out.code === 0 ? head : out.text);
    if (out.code !== 0) throw new Error(`${what} was refused`);
  };

  const listed = JSON.parse(run(["list", "--json"]).text) as {
    scenes: { name: string; sceneHash: string }[];
  };
  const assets = JSON.parse(run(["assets", "list", "--json"]).text) as { assets: { id: string }[] };
  const has = (id: string) => assets.assets.some((a) => a.id === id);
  const hashOf = new Map(listed.scenes.map((s) => [s.name, s.sceneHash]));

  const create: Op[] = [
    ...PREFABS.filter((p) => !has(p.id)).map((content) => ({
      op: "createAsset",
      kind: "prefab",
      path: `scenes/prefabs/${content.id}.json`,
      content,
    })),
    ...scenes
      .filter((s) => !has(s.id))
      .map((s) => ({
        op: "createAsset",
        kind: "scene",
        path: `scenes/${s.id}.json`,
        content: {
          $schema: "../scene.schema.json",
          v: 4,
          game: PROJECT,
          name: s.id,
          bounds: s.bounds,
          entities: [],
        },
      })),
  ];
  if (create.length > 0)
    apply("creating the prefabs and scenes", ["assets", "apply"], {
      v: 1,
      label: "Stress: new prefabs and scenes",
      ops: create,
    });

  for (const scene of scenes) {
    const exists = has(scene.id);
    if (dryRun && create.length > 0) {
      console.log(
        `${scene.id}: would be filled once the new assets exist (${scene.ops.length} ops)`,
      );
      continue;
    }
    const file = exists
      ? ((await bun.file(sceneFile(scene.id)).json()) as Record<string, unknown>)
      : {};
    const refs = refsOf(file);
    const settings = Object.keys((file.settings as object | undefined) ?? {});
    const held = (file.assets as string[] | undefined) ?? [];
    const empty: Op[] = [
      ...(refs.length > 0 ? [{ op: "remove", refs }] : []),
      ...(settings.length > 0 ? [{ op: "setSettings", unset: settings }] : []),
      ...(held.length > 0 ? [{ op: "useAssets", remove: held }] : []),
    ];
    const base =
      hashOf.get(scene.id) ??
      (JSON.parse(run(["show", scene.id, "--json"]).text) as { sceneHash: string }).sceneHash;
    apply(`filling ${scene.id}`, ["apply", scene.id, "--base", base], {
      label: `Stress: ${scene.id} at scale ${scale}`,
      ops: [...empty, ...scene.ops],
    });
  }

  const docs: Op[] = scenes.map((s) =>
    has(`${s.id}-checks`)
      ? { op: "editAsset", id: `${s.id}-checks`, edits: [{ set: "/checks", value: s.checks }] }
      : {
          op: "createAsset",
          kind: "checks",
          path: `scenes/${s.id}.checks.json`,
          content: { v: 3, checks: s.checks },
        },
  );
  if (!only)
    docs.push({
      op: "editAsset",
      id: "scene-list",
      edits: [
        { set: "/start", value: "combined" },
        { set: "/scenes", value: scenes.map((s) => ({ scene: s.id, title: s.title })) },
      ],
    });
  if (dryRun && create.length > 0) {
    console.log("checks and the scene list: would be written once the new assets exist");
    return 0;
  }
  apply("writing the checks and the scene list", ["assets", "apply"], {
    v: 1,
    label: "Stress: checks and scene list",
    ops: docs,
  });
  return 0;
}

if (import.meta.main) {
  const bun = (globalThis as { Bun?: BunApi }).Bun;
  if (!bun)
    throw new Error("make-scenes runs under Bun: bun src/games/stress/tools/make-scenes.ts");
  process.exitCode = await main(bun, process.argv.slice(2));
}
