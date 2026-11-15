import type { EntityRow } from "../../debug/inspect";
import type { EditorSession } from "../../editor/index";
import type { GameInstance } from "../../types";
import { MicroLabel, Text } from "../kit/index";
import { PlayEmpty, PlayPickRow, useLiveRead } from "./PlayInspector";

/** The parts of the game the Spawned group reads. */
export type SpawnedGroupGame = Pick<GameInstance, "debug" | "getStore">;

/** Runtime-spawned ids carry `#n` after the id they were spawned at (`bullet#12`). */
export const isSpawnedId = (id: string) => id.includes("#");

const NO_ROWS: readonly EntityRow[] = Object.freeze([]);

/** The outliner's group of runtime-spawned entities, shown while playing. */
export function SpawnedGroup(props: { game: SpawnedGroupGame; session: EditorSession }) {
  const { game, session } = props;
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
        <PlayEmpty>{read.status === "done" ? "Nothing spawned yet" : "Reading…"}</PlayEmpty>
      ) : (
        <ul className="je-spawned-list">
          {rows.map((row) => (
            <li key={row.id}>
              <PlayPickRow session={session} id={row.id} detail={row.type} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
