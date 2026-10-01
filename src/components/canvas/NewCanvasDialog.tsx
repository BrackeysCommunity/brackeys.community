import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { MicroLabel, Text } from "@/components/ui/typography";
import { checkPath, joinPath, PATH_PROBLEM_MESSAGES } from "@/lib/canvas/paths";
import { cn } from "@/lib/utils";

import {
  canvasScopesQueryOptions,
  PERSONAL_SCOPE,
  scopeKey,
  useCreateCanvas,
  type CanvasScope,
} from "./canvas-queries";

/** Name, folder and (unless the caller fixed it) scope for a new canvas. */
export function NewCanvasDialog({
  open,
  onClose,
  onCreated = onClose,
  scope: fixedScope,
  folder: initialFolder = "",
}: {
  open: boolean;
  onClose: () => void;
  /** Defaults to `onClose`. */
  onCreated?: () => void;
  scope?: CanvasScope;
  folder?: string;
}) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState(initialFolder);
  const [picked, setPicked] = useState<CanvasScope>(fixedScope ?? PERSONAL_SCOPE);
  const { data: scopes } = useQuery({
    ...canvasScopesQueryOptions(),
    enabled: open && !fixedScope,
  });
  const create = useCreateCanvas();
  const id = useId();
  const scope = fixedScope ?? picked;

  const trimmedFolder = folder.trim().replace(/^\/+|\/+$/g, "");
  const path = joinPath(trimmedFolder, `${name.trim() || "Untitled"}.canvas`);
  const checked = checkPath(path, "canvas");
  const problem = name.trim() && !checked.ok ? PATH_PROBLEM_MESSAGES[checked.problem] : null;

  const choices: { scope: CanvasScope; label: string }[] = [
    { scope: PERSONAL_SCOPE, label: "Personal" },
    ...(scopes?.teams ?? [])
      .filter((t) => t.status === "active" && !t.hidden)
      .map((t) => ({ scope: { kind: "team" as const, teamId: t.teamId }, label: t.name })),
  ];

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      title="New canvas"
      description="Name the canvas and choose where it lives."
      className="sm:max-w-md"
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!checked.ok || create.isPending}
            onClick={() => create.mutate({ scope, path }, { onSuccess: () => onCreated() })}
          >
            Create
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (checked.ok) create.mutate({ scope, path }, { onSuccess: () => onCreated() });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`}>
            <MicroLabel as="span">NAME</MicroLabel>
          </label>
          <Input
            id={`${id}-name`}
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={name}
            placeholder="Untitled"
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-folder`}>
            <MicroLabel as="span">FOLDER</MicroLabel>
          </label>
          <Input
            id={`${id}-folder`}
            value={folder}
            placeholder="Optional, like Jam 42/Art"
            maxLength={500}
            onChange={(e) => setFolder(e.target.value)}
          />
        </div>
        {!fixedScope ? (
          <div className="flex flex-col gap-1.5">
            <MicroLabel>IN</MicroLabel>
            <div className="flex flex-wrap gap-1.5">
              {choices.map((choice) => (
                <button
                  key={scopeKey(choice.scope)}
                  type="button"
                  onClick={() => setPicked(choice.scope)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs",
                    scopeKey(choice.scope) === scopeKey(scope)
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {problem ? (
          <Text as="p" size="xs" variant="danger">
            {problem}
          </Text>
        ) : null}
        <input type="submit" className="hidden" tabIndex={-1} />
      </form>
    </ResponsiveModal>
  );
}
