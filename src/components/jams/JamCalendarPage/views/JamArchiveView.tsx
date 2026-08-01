import { JamArchiveTable } from "../JamArchiveTable";
import { useJamsPage } from "../jams-context";
import { JamsToolbar } from "../JamsToolbar";

/** `/jams/archive` — the server-paginated table of finished jams. */
export function JamArchiveView() {
  const { archive, archiveState, setArchiveState } = useJamsPage();

  return (
    <>
      <JamsToolbar />
      <JamArchiveTable data={archive} state={archiveState} onStateChange={setArchiveState} />
    </>
  );
}
