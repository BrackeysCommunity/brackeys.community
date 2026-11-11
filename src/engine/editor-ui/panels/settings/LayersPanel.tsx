import type { ProjectSession } from "../../../collab/index";
import { Badge, MicroLabel, Text } from "../../kit/index";
import { useProjectView } from "../EditorProject";
import { collisionGroupRows, layerRows, type RegisteredRow } from "./registered";
import { SettingRow } from "./SettingsRows";

function Rows({ label, rows }: { label: string; rows: readonly RegisteredRow[] }) {
  return (
    <div className="je-insp-stack" role="group" aria-label={label}>
      <MicroLabel>{label}</MicroLabel>
      <ul className="je-insp-stack" aria-label={label}>
        {rows.map((row) => (
          <li key={row.name} aria-label={row.name}>
            <SettingRow title={row.name} hint={row.description}>
              <span className="je-insp-line">
                {row.engine ? (
                  <Badge size="label" variant="secondary">
                    engine
                  </Badge>
                ) : (
                  <Text size="xs" variant="muted" className="je-sp-truncate">
                    {row.module ?? "the game's code"}
                  </Text>
                )}
              </span>
            </SettingRow>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The scene layers and collision groups the game's code registers, each
 * with the module it comes from in the project's code map. Read-only:
 * they change in code, not here.
 */
export function LayersPanel({ session }: { session: ProjectSession }) {
  const view = useProjectView(session);
  const code = view.state.code;
  return (
    <div className="je-insp-stack">
      <Text as="p" size="xs" variant="muted">
        Defined in code; change them there.
      </Text>
      <Rows label="Layers" rows={layerRows(session.registry, code)} />
      <Rows label="Collision groups" rows={collisionGroupRows(session.registry, code)} />
    </div>
  );
}
