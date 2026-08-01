import { BoardViewControls } from "./board/BoardViewControls";
import { JamCalendarToolbar } from "./JamCalendarToolbar";
import { useJamsPage } from "./jams-context";

/**
 * The search rail, wired to the shared page state. Each view route
 * renders it itself: the board tucks it under the featured carousel, the
 * calendar and archive put it on top.
 */
export function JamsToolbar() {
  const {
    view,
    search,
    setSearch,
    board,
    calendar,
    boardSort,
    setBoardSort,
    boardLayout,
    setBoardLayout,
  } = useJamsPage();

  const counter =
    view === "board"
      ? `${board.jams.length}/${board.totalAll} JAMS`
      : view === "calendar"
        ? `${calendar.jams.length}/${calendar.totalAll} JAMS`
        : undefined;

  return (
    <JamCalendarToolbar
      search={search}
      onSearchChange={setSearch}
      counter={counter}
      placeholder={view === "archive" ? "search the whole archive" : "search jams, hosts, themes"}
      actions={
        view === "board" ? (
          <BoardViewControls
            sort={boardSort}
            onSortChange={setBoardSort}
            layout={boardLayout}
            onLayoutChange={setBoardLayout}
          />
        ) : undefined
      }
    />
  );
}
