/**
 * Staging seed for the /teams directory. Everything it writes is
 * prefixed so it can be removed in one pass:
 *   team.teams.id                  seed-*
 *   user.developer_profiles.id     seedprof-*
 *   collab.collab_posts            (whatever links to a seed-* team)
 *
 * Re-running wipes the previous batch first, so it is idempotent.
 * Pass `--clean` to only remove.
 */
import { eq, inArray, like, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  collabPostRoles,
  collabPosts,
  collabRoles,
  developerProfiles,
  skills,
  teamMembers,
  teamProjects,
  teams,
  user,
  userSkills,
} from "@/db/schema";

const CLEAN_ONLY = process.argv.includes("--clean");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

// ── Wipe any previous batch ──────────────────────────────────────────────────

const previous = await db.select({ id: teams.id }).from(teams).where(like(teams.id, "seed-%"));
if (previous.length > 0) {
  const ids = previous.map((t) => t.id);
  await db.delete(collabPosts).where(inArray(collabPosts.teamId, ids));
  await db.delete(teams).where(inArray(teams.id, ids));
}
await db.delete(developerProfiles).where(like(developerProfiles.id, "seedprof-%"));
console.log(`cleaned ${previous.length} seeded teams`);
if (CLEAN_ONLY) process.exit(0);

// ── Anchors that must already exist ──────────────────────────────────────────

// teams.created_by / collab_posts.author_id are FKs into the auth user
// table, so the batch has to hang off a real account.
const users = await db.select({ id: user.id, name: user.name }).from(user);
const owner = users.find((u) => u.name === "Joshe") ?? users[0];
if (!owner) throw new Error("no auth user on this environment to own the seeded teams");

const skillRows = await db.select({ id: skills.id, name: skills.name }).from(skills);
const skillByName = new Map(skillRows.map((s) => [s.name.toLowerCase(), s.id]));
const pickSkills = (...names: string[]) =>
  names.map((n) => skillByName.get(n.toLowerCase())).filter((id): id is number => id != null);

const roleRows = await db.select({ id: collabRoles.id, name: collabRoles.name }).from(collabRoles);

// ── Synthetic members ────────────────────────────────────────────────────────

const people: { key: string; username: string; tagline: string; skills: string[] }[] = [
  {
    key: "maple",
    username: "maplesyrup",
    tagline: "Gameplay programmer, Godot lifer",
    skills: ["Godot", "GDScript", "C#"],
  },
  {
    key: "juno",
    username: "juno.exe",
    tagline: "Pixel art and animation",
    skills: ["Aseprite", "Spine", "Krita"],
  },
  {
    key: "rho",
    username: "rho_dev",
    tagline: "Systems and tools",
    skills: ["C++", "Rust", "Unity"],
  },
  {
    key: "kit",
    username: "kitcaster",
    tagline: "Sound design + OST",
    skills: ["FMOD", "REAPER", "Ableton Live"],
  },
  {
    key: "sable",
    username: "sable",
    tagline: "Narrative designer",
    skills: ["Ink", "Yarn Spinner", "Twine"],
  },
  {
    key: "wren",
    username: "wren_makes",
    tagline: "3D everything",
    skills: ["Blender", "Unreal Engine", "ZBrush"],
  },
  {
    key: "ilo",
    username: "ilo",
    tagline: "UI/UX for games",
    skills: ["Figma", "Unity", "TypeScript"],
  },
  { key: "bex", username: "bexbox", tagline: "Shader goblin", skills: ["HLSL", "GLSL", "Unity"] },
  {
    key: "tam",
    username: "tamarind",
    tagline: "One-person studio",
    skills: ["Godot", "Aseprite", "LDtk"],
  },
  {
    key: "vess",
    username: "vessel",
    tagline: "Backend + netcode",
    skills: ["Go", "PostgreSQL", "Photon"],
  },
  {
    key: "oru",
    username: "oru",
    tagline: "Level design",
    skills: ["Tiled", "Unreal Engine", "LDtk"],
  },
  {
    key: "nim",
    username: "nimbus",
    tagline: "Technical artist",
    skills: ["Blender", "Substance Painter", "GLSL"],
  },
  {
    key: "pell",
    username: "pellmell",
    tagline: "Producer, jam wrangler",
    skills: ["Git", "Figma", "Unity"],
  },
  {
    key: "quill",
    username: "quill",
    tagline: "2D artist, painterly",
    skills: ["Procreate", "Photoshop", "Krita"],
  },
];

await db.insert(developerProfiles).values(
  people.map((p) => ({
    id: `seedprof-${p.key}`,
    discordUsername: p.username,
    tagline: p.tagline,
    availableForWork: false,
  })),
);

const userSkillValues = people.flatMap((p) =>
  pickSkills(...p.skills).map((skillId) => ({ userId: `seedprof-${p.key}`, skillId })),
);
if (userSkillValues.length > 0) await db.insert(userSkills).values(userSkillValues);
console.log(`seeded ${people.length} profiles, ${userSkillValues.length} skill links`);

// ── Teams ────────────────────────────────────────────────────────────────────

interface SeedProject {
  title: string;
  description?: string;
  jamName?: string;
  result?: string;
  releasedDaysAgo?: number;
}

interface SeedTeam {
  slug: string;
  name: string;
  tagline?: string;
  bio?: string;
  recruiting: boolean;
  archived?: boolean;
  activeDaysAgo: number;
  createdDaysAgo: number;
  /** Roster keys; the first is the owner. `me` is the real account. */
  roster: string[];
  projects?: SeedProject[];
  openPosts?: { title: string; type: "paid" | "hobby"; roles: string[] }[];
}

const seedTeams: SeedTeam[] = [
  {
    slug: "night-shift-crew",
    name: "Night Shift Crew",
    tagline: "Cozy horror in Godot, mostly at 3am. We finish what we start.",
    bio: "Five of us, one jam a month, and a standing rule that the build ships Sunday night whether or not the ending works.",
    recruiting: true,
    activeDaysAgo: 0,
    createdDaysAgo: 120,
    roster: ["me", "maple", "juno", "kit", "sable"],
    projects: [
      {
        title: "Lantern Hours",
        description: "A house that rearranges itself while you sleep.",
        jamName: "Brackeys Game Jam 2026.1",
        result: "12th overall",
        releasedDaysAgo: 20,
      },
      {
        title: "Small Hours",
        description: "Two-room horror vignette.",
        jamName: "Ludum Dare 58",
        releasedDaysAgo: 75,
      },
      { title: "The Quiet Part", releasedDaysAgo: 200 },
    ],
    openPosts: [
      {
        title: "Looking for a 3D artist for a cozy horror short",
        type: "hobby",
        roles: ["3D Modeler", "Environment Artist"],
      },
      { title: "Composer wanted — ambient, sparse, unsettling", type: "paid", roles: ["Composer"] },
    ],
  },
  {
    slug: "pixel-pantry",
    name: "Pixel Pantry",
    tagline: "Tiny food games with big sprites.",
    recruiting: true,
    activeDaysAgo: 1,
    createdDaysAgo: 60,
    roster: ["juno", "tam", "quill"],
    projects: [
      {
        title: "Soup Shift",
        description: "Line-cook roguelite.",
        jamName: "GMTK Jam",
        releasedDaysAgo: 40,
      },
    ],
    openPosts: [
      {
        title: "Gameplay programmer for a cooking roguelite",
        type: "hobby",
        roles: ["Gameplay Programmer"],
      },
    ],
  },
  {
    slug: "moonlit-bytes",
    name: "Moonlit Bytes",
    tagline: "Slow, strange, mostly finished.",
    recruiting: false,
    activeDaysAgo: 4,
    createdDaysAgo: 400,
    roster: ["me", "rho", "vess", "nim"],
    projects: [
      { title: "Driftward", description: "Sailing sim with no map.", releasedDaysAgo: 5 },
      { title: "Salt Line", releasedDaysAgo: 90 },
      { title: "Nocturne Engine", description: "Our in-house 2D toolkit.", releasedDaysAgo: 150 },
      { title: "Paper Moon", jamName: "Ludum Dare 55", result: "4th in Mood" },
      { title: "Tidewrack" },
      { title: "Halfmast", releasedDaysAgo: 320 },
    ],
  },
  {
    slug: "solo-lab",
    name: "Solo Lab",
    tagline: "One person, one prototype a month.",
    recruiting: true,
    activeDaysAgo: 2,
    createdDaysAgo: 30,
    roster: ["tam"],
    openPosts: [
      {
        title: "Anyone want to do audio for a month-long prototype?",
        type: "hobby",
        roles: ["Sound Designer"],
      },
    ],
  },
  {
    slug: "whiterabbitarchive",
    name: "whiterabbitarchive",
    recruiting: false,
    activeDaysAgo: 9,
    createdDaysAgo: 700,
    roster: ["wren", "bex"],
    projects: Array.from({ length: 11 }, (_, i) => ({
      title: `Archive Vol. ${i + 1}`,
      releasedDaysAgo: 30 + i * 45,
    })),
  },
  {
    slug: "terminal-velocity",
    name: "Terminal Velocity",
    tagline: "Fast games, faster jams. Eight people, no meetings.",
    recruiting: true,
    activeDaysAgo: 0,
    createdDaysAgo: 210,
    roster: ["rho", "maple", "oru", "nim", "vess", "pell", "bex", "ilo"],
    projects: [
      {
        title: "Redline Delivery",
        description: "Courier racer.",
        jamName: "Brackeys Game Jam 2025.2",
        result: "2nd overall",
        releasedDaysAgo: 10,
      },
      { title: "Skidmark", releasedDaysAgo: 60 },
      { title: "Overrun", releasedDaysAgo: 180 },
      { title: "Hard Deck" },
    ],
    openPosts: [
      {
        title: "Level designer for an arcade racer, paid per track",
        type: "paid",
        roles: ["Level Designer"],
      },
    ],
  },
  {
    slug: "fjord-games",
    name: "Fjord Games",
    tagline: "Cold colours, warm mechanics.",
    recruiting: false,
    activeDaysAgo: 15,
    createdDaysAgo: 330,
    roster: ["wren", "quill", "sable"],
    projects: [
      { title: "Kelpwood", releasedDaysAgo: 100 },
      { title: "Long Winter", jamName: "Winter Jam", result: "Honourable mention" },
    ],
  },
  {
    slug: "the-fun-seekers",
    name: "The Fun Seekers",
    tagline: "Two friends, no plan, every jam.",
    recruiting: true,
    activeDaysAgo: 3,
    createdDaysAgo: 18,
    roster: ["pell", "ilo"],
  },
  {
    slug: "copper-coast-collective",
    name: "Copper Coast Collective",
    tagline: "A loose collective of six who keep ending up on the same team.",
    recruiting: false,
    activeDaysAgo: 22,
    createdDaysAgo: 500,
    roster: ["oru", "kit", "quill", "nim", "juno", "sable"],
    projects: [
      { title: "Brasswork", releasedDaysAgo: 45 },
      { title: "Low Tide", releasedDaysAgo: 130 },
      { title: "Copper Sun", jamName: "GMTK Jam", result: "Top 100" },
      { title: "Undertow" },
      { title: "Harbourline", releasedDaysAgo: 400 },
    ],
  },
  {
    slug: "bitrot",
    name: "Bitrot",
    recruiting: true,
    activeDaysAgo: 6,
    createdDaysAgo: 75,
    roster: ["bex", "vess", "rho", "maple"],
    projects: [{ title: "Decay Rate", description: "Glitch platformer.", releasedDaysAgo: 15 }],
  },
  {
    slug: "slow-jam-society",
    name: "Slow Jam Society",
    tagline: "We do the two-week jams. On purpose.",
    recruiting: true,
    activeDaysAgo: 11,
    createdDaysAgo: 150,
    roster: ["sable", "tam", "kit"],
    projects: [
      {
        title: "Fermata",
        jamName: "OST Composing Jam",
        result: "1st in Audio",
        releasedDaysAgo: 55,
      },
      { title: "Andante", releasedDaysAgo: 240 },
    ],
  },
  {
    slug: "kernel-panic-club",
    name: "Kernel Panic Club",
    tagline: "Engine nerds who occasionally ship a game.",
    recruiting: false,
    activeDaysAgo: 30,
    createdDaysAgo: 600,
    roster: ["vess", "rho", "nim", "bex", "oru"],
    projects: [
      { title: "Segfault Simulator", releasedDaysAgo: 70 },
      { title: "Panic Engine", description: "Yes, another engine." },
      { title: "Stack Trace", releasedDaysAgo: 350 },
    ],
  },
  // Archived: these must NOT show up in the directory.
  {
    slug: "abandoned-attic",
    name: "Abandoned Attic",
    tagline: "Archived — should not appear in the directory.",
    recruiting: true,
    archived: true,
    activeDaysAgo: 200,
    createdDaysAgo: 800,
    roster: ["quill"],
  },
  {
    slug: "ghost-ship",
    name: "Ghost Ship",
    tagline: "Archived — should not appear in the directory.",
    recruiting: false,
    archived: true,
    activeDaysAgo: 260,
    createdDaysAgo: 900,
    roster: ["oru", "pell"],
    projects: [{ title: "Last Voyage", releasedDaysAgo: 500 }],
  },
];

const memberId = (key: string) => (key === "me" ? owner.id : `seedprof-${key}`);

for (const t of seedTeams) {
  const teamId = `seed-${t.slug}`;
  await db.insert(teams).values({
    id: teamId,
    slug: t.slug,
    name: t.name,
    tagline: t.tagline ?? null,
    bio: t.bio ?? null,
    recruiting: t.recruiting,
    status: t.archived ? "archived" : "active",
    lastActivityAt: ago(t.activeDaysAgo),
    createdBy: owner.id,
    createdAt: ago(t.createdDaysAgo),
    updatedAt: ago(t.activeDaysAgo),
  });

  await db.insert(teamMembers).values(
    t.roster.map((key, i) => ({
      teamId,
      userId: memberId(key),
      role: i === 0 ? "owner" : "member",
      sortOrder: i,
      joinedAt: ago(t.createdDaysAgo - i),
    })),
  );

  if (t.projects?.length) {
    await db.insert(teamProjects).values(
      t.projects.map((p, i) => ({
        id: `seed-${t.slug}-p${i}`,
        teamId,
        title: p.title,
        description: p.description ?? null,
        jamName: p.jamName ?? null,
        result: p.result ?? null,
        participatedAt: p.releasedDaysAgo != null ? ago(p.releasedDaysAgo) : null,
        releasedAt: p.releasedDaysAgo != null ? ago(p.releasedDaysAgo) : null,
        sortOrder: i,
        addedBy: owner.id,
        createdAt: ago(t.createdDaysAgo - i),
      })),
    );
  }

  for (const post of t.openPosts ?? []) {
    const [row] = await db
      .insert(collabPosts)
      .values({
        authorId: owner.id,
        teamId,
        type: post.type,
        title: post.title,
        description:
          "Seeded test post for the team directory. We're a small crew that ships on jam deadlines and we'd rather over-communicate than over-plan.",
        projectName: t.name,
        projectLength: "short",
        experienceLevel: "intermediate",
        compensationType: post.type === "paid" ? "negotiable" : null,
        status: "recruiting",
        createdAt: ago(t.activeDaysAgo),
        updatedAt: ago(t.activeDaysAgo),
        expiresAt: new Date(Date.now() + 45 * DAY),
      })
      .returning({ id: collabPosts.id });

    const roleIds = post.roles
      .map((name) => roleRows.find((r) => r.name.toLowerCase() === name.toLowerCase())?.id)
      .filter((id): id is number => id != null);
    if (roleIds.length > 0) {
      await db
        .insert(collabPostRoles)
        .values(roleIds.map((roleId) => ({ postId: row.id, roleId })));
    }
  }
}

const [{ n: activeCount }] = await db
  .select({ n: sql<number>`count(*)::int` })
  .from(teams)
  .where(eq(teams.status, "active"));

console.log(
  `seeded ${seedTeams.length} teams (${seedTeams.filter((t) => t.archived).length} archived) owned by ${owner.name}; ${activeCount} active teams now in the directory`,
);
process.exit(0);
