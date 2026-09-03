import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/typography";
import { slugifyTeamName } from "@/lib/team-links";

import { profanityCheck, TEAM_NAME_MAX } from "./shared";

/**
 * Name a crew into existence — one field, one button. Pure form: the
 * caller decides what the name becomes (a `createTeam` call from the
 * picker, or the `create` half of `acceptAndInvite`, which mints the team
 * inside the accept transaction). Validation matches the server's
 * `teamContentShape.name`: two characters and no profanity.
 */
export function CrewCreateInline({
  initialName = "",
  submitLabel,
  pending = false,
  error = null,
  onSubmit,
  onCancel,
}: {
  /** Prefill — the accept flow seeds it from the post's project name. */
  initialName?: string;
  /** Static, or a function of the trimmed name ("ACCEPT & INVITE TO …"). */
  submitLabel: string | ((name: string) => string);
  pending?: boolean;
  error?: string | null;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(() => initialName.slice(0, TEAM_NAME_MAX));
  const trimmed = name.trim();
  const nameError = profanityCheck(name, "Team name");
  const canSubmit = trimmed.length >= 2 && !nameError && !pending;
  const label = typeof submitLabel === "function" ? submitLabel(trimmed) : submitLabel;

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Team name"
        maxLength={TEAM_NAME_MAX}
        aria-label="Team name"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (canSubmit) onSubmit(trimmed);
          }
        }}
      />
      <Text size="xs" variant="muted" className="tracking-wide">
        {trimmed.length >= 2
          ? `Makes a team page at /teams/${slugifyTeamName(trimmed)}. You can rename it there.`
          : "Makes a team page you can rename any time."}
      </Text>
      {nameError || error ? (
        <Text size="xs" variant="danger" className="tracking-wide">
          {nameError ?? error}
        </Text>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="xs"
          disabled={!canSubmit}
          onClick={() => onSubmit(trimmed)}
          className="tracking-widest"
        >
          {pending ? "…" : label}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onCancel}
            className="tracking-widest"
          >
            CANCEL
          </Button>
        ) : null}
      </div>
    </div>
  );
}
