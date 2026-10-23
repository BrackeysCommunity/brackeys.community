/**
 * The site's own localStorage keys, kept together so the legacy-key
 * migration and the cross-origin preference handoff (`storage-handoff.ts`)
 * can't drift from the code that reads them.
 */
export const STORAGE_KEYS = {
  analytics: "jt:analytics",
  theme: "jt:theme",
  reduceMotion: "jt:reduce-motion",
  muted: "jt:muted",
  volume: "jt:volume",
  censorProfanity: "jt:censor-profanity",
  attentionDismissed: "jt:attention-dismissed",
  announcements: "jt:announcements",
  glowColourSpace: "jt:glow-colour-space",
  workspaceScope: "jt:workspace-scope",
  canvasInspector: "jt:canvas-inspector",
  forumDraft: "jt:forum-composer-draft:v1",
  collabDraft: "jt:collab-wizard-draft:v1",
} as const;
