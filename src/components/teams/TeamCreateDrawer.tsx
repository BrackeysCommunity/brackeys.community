import { Delete02Icon, ImageAdd01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import {
  TEAM_DESCRIPTION_MAX,
  TEAM_NAME_MAX,
  profanityCheck,
  uploadTeamAvatarImage,
} from "@/components/collab/CollabCreateFlyout/shared";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Well } from "@/components/ui/well";
import { EVENTS } from "@/lib/analytics-events";
import { errorMessage } from "@/lib/error-message";
import { captureEvent, reportMutationError } from "@/lib/posthog";
import { client, orpc } from "@/orpc/client";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * The directory's create surface. Deliberately one screen — name,
 * one-liner, avatar, and whether you're taking members — because the
 * team page itself is the place to fill in the rest, and a long form
 * between someone and their page is how directories stay empty.
 *
 * The avatar is best-effort, same as the wizard's quick-create: the row
 * is the deliverable and a failed upload can be redone from the team
 * page.
 */
export function TeamCreateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [recruiting, setRecruiting] = useState(true);
  const [avatar, setAvatar] = useState<{ file: File; previewUrl: string } | null>(null);
  const [fileError, setFileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Object URLs outlive the component unless revoked by hand.
  useEffect(() => {
    return () => {
      if (avatar) URL.revokeObjectURL(avatar.previewUrl);
    };
  }, [avatar]);

  // Intent half of the team-formation funnel — the denominator for
  // `team_created`.
  useEffect(() => {
    if (open) captureEvent(EVENTS.teamCreateFlowStarted);
  }, [open]);

  const nameError = profanityCheck(name, "Team name");
  const canSubmit = name.trim().length >= 2 && !nameError;

  const createMutation = useMutation({
    mutationFn: async () => {
      const team = await client.createTeam({
        name: name.trim(),
        tagline: tagline.trim() || undefined,
        recruiting,
      });
      if (avatar) {
        try {
          await uploadTeamAvatarImage(team.id, avatar.file);
        } catch (err) {
          console.error("Team avatar upload failed", err);
        }
      }
      return team;
    },
    onSuccess: (team) => {
      void queryClient.invalidateQueries({ queryKey: orpc.listMyTeams.key() });
      void queryClient.invalidateQueries({ queryKey: ["listTeams"] });
      onClose();
      void navigate({ to: "/teams/$teamId", params: { teamId: team.slug || team.id } });
    },
    onError: (err) => reportMutationError(err, "team.create"),
  });

  return (
    <Drawer open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DrawerContent className="max-h-[88vh] p-0">
        <DrawerDescription className="sr-only">
          Name your team, add a one-liner, and say whether you're taking members.
        </DrawerDescription>
        <div className="flex min-h-0 flex-1 flex-col pt-3 pb-[env(safe-area-inset-bottom)]">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-muted/40 py-3 pr-3 pl-5">
            <DrawerTitle className="text-base tracking-widest text-foreground uppercase">
              Start a team
            </DrawerTitle>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
            <Field label="TEAM IMAGE" hint="optional" error={fileError || null}>
              <div className="flex items-center gap-3">
                <UserAvatar
                  avatarUrl={avatar?.previewUrl ?? null}
                  username={name || "?"}
                  size={56}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="tracking-widest"
                  >
                    <HugeiconsIcon icon={ImageAdd01Icon} size={12} />
                    {avatar ? "REPLACE" : "UPLOAD"}
                  </Button>
                  {avatar ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-label="Remove team image"
                      title="Remove team image"
                      onClick={() => setAvatar(null)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={12} />
                    </Button>
                  ) : null}
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (!file.type.startsWith("image/")) {
                    setFileError("Only image files are allowed.");
                    return;
                  }
                  if (file.size > MAX_AVATAR_BYTES) {
                    setFileError("Image must be under 5MB.");
                    return;
                  }
                  setFileError("");
                  setAvatar({ file, previewUrl: URL.createObjectURL(file) });
                }}
              />
            </Field>

            <Field
              label="TEAM NAME *"
              hint="your page lives at /teams/<name>"
              error={nameError ?? null}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Night Shift Crew"
                maxLength={TEAM_NAME_MAX}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit && !createMutation.isPending) {
                    createMutation.mutate();
                  }
                }}
              />
            </Field>

            <Field label="ONE-LINER" hint="optional · what your crew makes">
              <Textarea
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Cozy horror in Godot, mostly at 3am."
                maxLength={TEAM_DESCRIPTION_MAX}
                rows={2}
              />
            </Field>

            <Well variant="ghost" className="flex-row items-center gap-3 p-3">
              <Switch
                id="team-create-recruiting"
                checked={recruiting}
                onCheckedChange={(checked) => setRecruiting(!!checked)}
              />
              <label htmlFor="team-create-recruiting" className="flex flex-col gap-0.5">
                <Text size="sm" bold>
                  Looking for members
                </Text>
                <Text size="xs" variant="muted">
                  Recruiting teams lead the directory. Toggle it off any time from the team page.
                </Text>
              </label>
            </Well>

            {createMutation.isError ? (
              <Text size="xs" className="text-destructive">
                {errorMessage(createMutation.error, "Could not create the team.")}
              </Text>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-muted/40 p-4">
            <Button variant="outline" size="sm" onClick={onClose} className="tracking-widest">
              CANCEL
            </Button>
            <Button
              size="sm"
              disabled={!canSubmit || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="tracking-widest"
            >
              {createMutation.isPending ? "CREATING…" : "CREATE TEAM"}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <MicroLabel>{label}</MicroLabel>
        {hint ? (
          <Text as="span" size="xs" variant="muted">
            {hint}
          </Text>
        ) : null}
      </div>
      {children}
      {error ? (
        <Text size="xs" className="text-destructive">
          {error}
        </Text>
      ) : null}
    </div>
  );
}
