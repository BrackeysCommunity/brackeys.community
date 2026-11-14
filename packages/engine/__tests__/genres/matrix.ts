import { ENGINE_VERSION } from "../../version";
import type { GenreProbe, GenreRow } from "./harness";

export type GenreMatrixRow = {
  /** The matrix's own name for the genre. */
  genre: string;
  /** Plan 53's "Delivered by" column, as written there. */
  deliveredBy: string;
  /** The probes that prove part of the row, by id; matrix.test.ts holds the probes' own `rows` to it. */
  probes: readonly string[];
};

/** Plan 53's genre coverage matrix: every row and the milestones that deliver it. */
export const GENRE_MATRIX: Readonly<Record<GenreRow, GenreMatrixRow>> = {
  platformer: {
    genre: "Platformer",
    deliveredBy: "M13, M14, M22, M23, M25",
    probes: ["behavior-yard", "side-view-behaviors", "tree-yard"],
  },
  "top-down": {
    genre: "Top-down action / RPG",
    deliveredBy: "M13, M14, M18, M23, M25, M11",
    probes: ["top-down"],
  },
  "twin-stick": { genre: "Twin-stick shooter", deliveredBy: "M15, M16, M22", probes: ["shooter"] },
  puzzle: { genre: "Puzzle / match-3", deliveredBy: "M14, M15, M16, M22", probes: ["grid-puzzle"] },
  "card-board": {
    genre: "Card / board game",
    deliveredBy: "M11, M14, M15, M17, M27",
    probes: ["grid-puzzle"],
  },
  tactics: {
    genre: "Turn-based tactics on a grid",
    deliveredBy: "M14, M16, M17, M18",
    probes: ["turn-tactics"],
  },
  "visual-novel": { genre: "Visual novel", deliveredBy: "M13, M18, M23", probes: [] },
  racing: {
    genre: "Racing (top-down)",
    deliveredBy: "M14 (PHY-2), M15, M16, M22",
    probes: ["racing", "top-down"],
  },
  "physics-sandbox": { genre: "Physics sandbox", deliveredBy: "M14, M15, M26", probes: [] },
  rts: {
    genre: "RTS / strategy",
    deliveredBy: "M14, M16, M22, M24, M25",
    probes: ["point-and-click"],
  },
  "tower-defense": {
    genre: "Tower defense",
    deliveredBy: "M11, M14, M15, M17",
    probes: ["shooter", "tower-defense"],
  },
  rhythm: { genre: "Rhythm", deliveredBy: "M11, M16, M23", probes: ["rhythm-tap"] },
  roguelike: {
    genre: "Roguelike",
    deliveredBy: "M14, M15, M18, M25",
    probes: ["roguelike", "turn-tactics"],
  },
  metroidvania: { genre: "Metroidvania", deliveredBy: "M18, M22, M25", probes: [] },
  "point-and-click": {
    genre: "Point-and-click adventure",
    deliveredBy: "M14, M16, M17, M23",
    probes: ["point-and-click"],
  },
  // Engine milestones only: the site's player save store, which keeps an idle game between
  // sessions, is covered by the site's staging tests rather than by a probe.
  idle: { genre: "Idle / clicker", deliveredBy: "M14, M17, M18", probes: ["idle"] },
  "endless-runner": {
    genre: "Endless runner",
    deliveredBy: "M15, M16, M19, M22",
    probes: ["shooter"],
  },
  fighting: {
    genre: "Fighting game",
    deliveredBy: "M16, M22 (ANI-5, FX-2), M27",
    probes: ["local-versus"],
  },
  "local-multiplayer": {
    genre: "Local multiplayer",
    deliveredBy: "M16, M22",
    probes: ["local-versus", "versus-behaviors"],
  },
  "online-multiplayer": { genre: "Online multiplayer", deliveredBy: "M27", probes: [] },
};

export const GENRE_ROWS = Object.keys(GENRE_MATRIX) as GenreRow[];

/**
 * The engine version each milestone ships in. Milestones don't land in
 * number order, so "landed" is read from here against `ENGINE_VERSION`
 * rather than from the numbers; a milestone missing here hasn't landed.
 * Add each one as it ships.
 */
export const MILESTONE_VERSIONS: Readonly<Record<number, string>> = {
  10: "0.5.0",
  11: "0.6.0",
  12: "0.7.0",
  13: "0.8.0",
  14: "0.9.0",
  15: "0.10.0",
  16: "0.11.0",
  17: "0.12.0",
  18: "0.13.0",
  19: "0.14.0",
  20: "0.14.1",
  21: "0.14.2",
  42: "0.14.3",
  30: "0.14.4",
  31: "0.14.5",
  22: "0.15.0",
  43: "0.16.0",
};

/** `a` against `b` as semver release triples: negative, zero or positive. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(v);
    if (!m) throw new Error(`can't read version ${JSON.stringify(v)}`);
    return { triple: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] !== undefined };
  };
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const d = pa.triple[i]! - pb.triple[i]!;
    if (d !== 0) return d;
  }
  // A pre-release comes before its release.
  return Number(pb.pre) - Number(pa.pre);
}

/** Whether milestone `m` has shipped by engine version `version` (default this engine's). */
export function landed(m: number, version: string = ENGINE_VERSION): boolean {
  const at = MILESTONE_VERSIONS[m];
  return at !== undefined && compareVersions(version, at) >= 0;
}

/** The milestone numbers a "Delivered by" cell names, ranges (`M19–M21`) expanded, sorted. */
export function milestonesOf(deliveredBy: string): number[] {
  const out = new Set<number>();
  for (const part of deliveredBy.replace(/\([^)]*\)/g, "").split(",")) {
    const m = /^\s*M(\d+)(?:\s*[–-]\s*M(\d+))?\s*$/.exec(part);
    if (!m) throw new Error(`can't read milestone ${JSON.stringify(part)}`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    for (let n = from; n <= to; n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** The rows whose milestones have all landed by `version`. */
export function landedRows(version: string = ENGINE_VERSION): GenreRow[] {
  return GENRE_ROWS.filter((row) =>
    milestonesOf(GENRE_MATRIX[row].deliveredBy).every((m) => landed(m, version)),
  );
}

/** Each row with its milestones and the probes that name it. */
export function genreMatrix(
  probes: readonly GenreProbe[],
): Record<GenreRow, { milestones: number[]; probes: string[] }> {
  const out = {} as Record<GenreRow, { milestones: number[]; probes: string[] }>;
  for (const row of GENRE_ROWS) {
    out[row] = {
      milestones: milestonesOf(GENRE_MATRIX[row].deliveredBy),
      probes: probes.filter((p) => p.rows.includes(row)).map((p) => p.id),
    };
  }
  return out;
}
