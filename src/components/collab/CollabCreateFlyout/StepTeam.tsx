import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { nanoid } from "nanoid";
import { useRef, useState } from "react";

import { TeamDirectoryCard } from "@/components/teams/TeamDirectoryCard";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { collabStore, type UploadedImage } from "@/lib/collab-store";
import { type client, orpc } from "@/orpc/client";

import { AddImageCard, FieldRow, TextAreaField, TextField } from "./fields";
import { useWizardForm } from "./form-context";
import { profanityCheck, TEAM_DESCRIPTION_MAX, TEAM_NAME_MAX } from "./shared";

type TeamStepMode = "new" | "existing";

/** One row of `listMyTeams` — a directory card plus the viewer's role. */
type MyTeam = Awaited<ReturnType<typeof client.listMyTeams>>[number];

/**
 * Step 02 — who's behind the post. The RECRUITING AS switch lives here
 * with the rest of the team decisions; solo posts see only it. Team
 * posts default to creating a new team inline (optional image, required
 * name, optional description); picking one of the caller's existing
 * teams is the secondary path. Nothing is written here — the team row
 * is created at submit, like post images, so an abandoned draft mints
 * no junk teams.
 */
export function StepTeam() {
  const form = useWizardForm();
  const editingLegacyUnlinked = useStore(collabStore, (s) => s.wizard.editingLegacyUnlinked);
  const { data: allMyTeams, isLoading } = useQuery(orpc.listMyTeams.queryOptions({ input: {} }));
  // A hidden (under-review) team must not be linkable to new posts;
  // `assertTeamLinkable` re-checks server-side.
  const myTeams = allMyTeams?.filter((t) => !t.hidden);

  // Default is CREATE — quick-creation is the mainline path, not the
  // fallback. "Existing" only when the draft already carries a link.
  const [mode, setMode] = useState<TeamStepMode>(() =>
    form.state.values.teamId !== undefined ? "existing" : "new",
  );

  return (
    <form.Field name="isIndividual">
      {(soloField) => (
        <div className="flex flex-col gap-5">
          <Well variant="ghost" className="gap-3 p-3">
            {/* Not an availability listing — that's the people lane.
                This is still a team-seeking post; the switch only says
                who's behind it. */}
            <FieldRow label="RECRUITING AS" hint={soloField.state.value ? "solo dev" : "a team"}>
              <div className="flex items-center gap-3">
                <Switch
                  id="collab-create-is-individual"
                  checked={soloField.state.value}
                  onCheckedChange={(checked) => {
                    soloField.handleChange(!!checked);
                    // A solo post can't also be a team's post.
                    if (checked) form.setFieldValue("teamId", undefined);
                  }}
                />
                <Text size="sm" variant="muted">
                  {soloField.state.value
                    ? "It's just me looking for collaborators."
                    : "I'm posting on behalf of a team."}
                </Text>
              </div>
            </FieldRow>
          </Well>

          {soloField.state.value ? null : (
            <>
              {(myTeams?.length ?? 0) > 0 ? (
                <FieldRow label="TEAM PAGE *">
                  <SegmentedControl
                    value={mode}
                    onChange={(next) => {
                      setMode(next as TeamStepMode);
                      // Entering create mode drops a stale pick so the
                      // new-team form is what submit reads.
                      if (next === "new") form.setFieldValue("teamId", undefined);
                    }}
                    size="sm"
                    priority="primary"
                  >
                    <SegmentedControl.Item value="new">NEW TEAM</SegmentedControl.Item>
                    <SegmentedControl.Item value="existing">USE EXISTING</SegmentedControl.Item>
                  </SegmentedControl>
                </FieldRow>
              ) : null}

              {mode === "existing" && (myTeams?.length ?? 0) > 0 ? (
                <ExistingTeamPicker teams={myTeams ?? []} />
              ) : isLoading ? null : (
                <NewTeamForm />
              )}

              {editingLegacyUnlinked ? (
                <Text size="xs" variant="muted" className="tracking-wide">
                  This post predates team pages — it can stay unlinked, but accepting responses will
                  ask for one.
                </Text>
              ) : null}
            </>
          )}
        </div>
      )}
    </form.Field>
  );
}

/** The default path: name a team into existence with the post. */
function NewTeamForm() {
  const form = useWizardForm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageError, setImageError] = useState("");

  return (
    <>
      <form.Field name="newTeamImage">
        {(field) => {
          const image = field.state.value as UploadedImage | null;
          return (
            <FieldRow label="TEAM IMAGE" hint="optional" error={imageError || null}>
              {image ? (
                <div className="group relative h-16 w-16">
                  <img
                    src={image.previewUrl}
                    alt=""
                    className="h-full w-full border border-muted/40 object-cover"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-xs"
                    onClick={() => field.handleChange(null)}
                    className="absolute -top-1 -right-1 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="Remove team image"
                    title="Remove team image"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={10} />
                  </Button>
                </div>
              ) : (
                <AddImageCard onClick={() => inputRef.current?.click()} />
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (!file.type.startsWith("image/")) {
                    setImageError("Only image files are allowed.");
                    return;
                  }
                  if (file.size > 5 * 1024 * 1024) {
                    setImageError("Image must be under 5MB.");
                    return;
                  }
                  setImageError("");
                  field.handleChange({
                    file,
                    localId: nanoid(),
                    previewUrl: URL.createObjectURL(file),
                  });
                }}
              />
            </FieldRow>
          );
        }}
      </form.Field>

      <form.Field
        name="newTeamName"
        validators={{
          onChange: ({ value }: { value: string }) => {
            if (value.trim().length > 0 && value.trim().length < 2)
              return "Team name must be at least 2 characters.";
            return profanityCheck(value, "Team name");
          },
        }}
      >
        {(field) => (
          <TextField
            label="TEAM NAME *"
            hint="your page lives at /teams/<name>"
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
            placeholder="e.g. Night Shift Crew"
            maxLength={TEAM_NAME_MAX}
            error={field.state.meta.errors.map(String).join(" ") || null}
          />
        )}
      </form.Field>

      <form.Field name="newTeamDescription">
        {(field) => (
          <TextAreaField
            label="DESCRIPTION"
            hint="optional · the one-liner on your team page"
            value={field.state.value}
            onChange={field.handleChange}
            onBlur={field.handleBlur}
            placeholder="What kind of games do you make?"
            maxLength={TEAM_DESCRIPTION_MAX}
            rows={3}
            error={field.state.meta.errors.map(String).join(" ") || null}
          />
        )}
      </form.Field>

      <Text size="xs" variant="muted" className="tracking-wide">
        The team page is created when your post goes live — backing out now leaves nothing behind.
      </Text>
    </>
  );
}

/**
 * The secondary path: link one of the caller's existing teams.
 *
 * The same tiles the directory and the profile shelf use, so the crew
 * you're posting as reads the same everywhere — and so the pick is made
 * on the roster and the stack rather than on a name in a list. Clicking
 * the picked one again unlinks it; there's nothing else on the card to
 * hang an unlink control off.
 */
function ExistingTeamPicker({ teams }: { teams: MyTeam[] }) {
  const form = useWizardForm();

  return (
    <form.Field name="teamId">
      {(field) => (
        <FieldRow
          label="YOUR TEAMS"
          hint={field.state.value ? "posts on this team's page" : "pick the team behind this post"}
        >
          <div className="flex flex-col gap-2">
            {teams.map((team) => {
              const selected = team.id === field.state.value;
              return (
                <TeamDirectoryCard
                  key={team.id}
                  team={team}
                  role={team.role}
                  selected={selected}
                  onSelect={() => field.handleChange(selected ? undefined : team.id)}
                />
              );
            })}
          </div>
        </FieldRow>
      )}
    </form.Field>
  );
}
