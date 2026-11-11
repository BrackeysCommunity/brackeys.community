import type { ProjectId } from "../../../project/index";
import type { EditorProjectChoice } from "../../host";
import { useKit } from "../../kit/context";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../kit/select";

/** Picks which of the host's projects the editor has open; the host opens the one picked. */
export function ProjectSwitch({
  current,
  projects,
  onChange,
}: {
  current: ProjectId;
  projects: readonly EditorProjectChoice[];
  onChange: (id: ProjectId) => void;
}) {
  const { cue } = useKit();
  const name = projects.find((p) => p.id === current)?.name ?? current;
  return (
    <Select
      value={current}
      onValueChange={(v) => {
        if (typeof v !== "string" || v === current) return;
        cue("toggle");
        onChange(v);
      }}
    >
      <SelectTrigger size="xs" aria-label="Open project" className="je-ptree-switch">
        <SelectValue>{name}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
