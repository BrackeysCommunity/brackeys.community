import type { EntityRow } from "../../debug/inspect";
import type { EditorSession } from "../../editor/index";
import type { GameInstance } from "../../types";
import { MicroLabel, Text } from "../kit/index";
import { useStoreValue } from "../session/use-store-value";
import { playPickOf, useLiveRead } from "./PlayInspector";

/** The parts of the game the Spawned group reads. */
export type SpawnedGroupGame = Pick<GameInstance, "debug" | "getStore">;

/** Runtime-spawned ids carry `#n` after the id they were spawned at (`bullet#12`). */
export const isSpawnedId = (id: string) => id.includes("#");

const NO_ROWS: readonly EntityRow[] = Object.freeze([]);

/** The outliner's group of runtime-spawned entities, shown while playing. */
export function SpawnedGroup(props: { game: SpawnedGroupGame; session: EditorSession }) {
  const { game, session } = props;
  const pick = playPickOf(session);
  const picked = useStoreValue(pick, (s) => s.id, Object.is);
  const read = useLiveRead(game.getStore(), "spawned", async () =>
    (await game.debug.entities()).filter((row) => isSpawnedId(row.id)),
  );
  const rows = read.status === "done" ? read.value : NO_ROWS;

  return (
    <section className="je-spawned" aria-label="Spawned">
      <div className="je-spawned-head">
        <MicroLabel as="p">Spawned</MicroLabel>
        {rows.length > 0 ? (
          <Text as="span" size="xs" variant="muted">
            {rows.length}
          </Text>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <Text as="p" size="xs" variant="muted" className="je-panel-empty">
          {read.status === "done" ? "Nothing spawned yet" : "Reading…"}
        </Text>
      ) : (
        <ul className="je-spawned-list">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                className="je-outliner-row je-spawned-row"
                data-spawned={row.id}
                data-selected={picked === row.id ? "" : undefined}
                aria-pressed={picked === row.id}
                onClick={() => pick.setState(() => ({ id: row.id }))}
              >
                <span className="je-sp-truncate">{row.id}</span>
                <span className="je-insp-grow je-sp-truncate je-insp-muted">{row.type}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
