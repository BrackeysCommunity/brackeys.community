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
  platformer: { genre: "Platformer", deliveredBy: "M13, M14, M22, M23, M25", probes: [] },
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
    probes: ["top-down"],
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
    probes: ["shooter"],
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
  idle: { genre: "Idle / clicker", deliveredBy: "M14, M17, M18, M21", probes: [] },
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
    probes: ["local-versus"],
  },
  "online-multiplayer": { genre: "Online multiplayer", deliveredBy: "M27", probes: [] },
};

export const GENRE_ROWS = Object.keys(GENRE_MATRIX) as GenreRow[];

/** Every milestone through this one has landed. */
export const LANDED_THROUGH = 15;

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
