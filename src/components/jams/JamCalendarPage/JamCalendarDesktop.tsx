import { BoardViewControls } from "./board/BoardViewControls";
import { JamArchiveTable } from "./JamArchiveTable";
import { JamBoard } from "./JamBoard";
import { JamCalendarHero } from "./JamCalendarHero";
import { JamCalendarSpans } from "./JamCalendarSpans";
import { JamCalendarToolbar } from "./JamCalendarToolbar";
import type { JamCalendarLayoutProps } from "./shared-types";

/**
 * Desktop layout: hero, search rail, then the active view — the ranked
 * discovery board (default), the named-span calendar, or the archive
 * table.
 */
export function JamCalendarDesktop(props: JamCalendarLayoutProps) {
  return <JamCalendarLayout {...props} compact={false} />;
}

/** Shared between desktop and mobile — the two only differ in hero
 * stat placement and calendar density. */
export function JamCalendarLayout(props: JamCalendarLayoutProps & { compact: boolean }) {
  const {
    monthStart,
    today,
    now,
    board,
    calendar,
    archive,
    stats,
    totalTracked,
    view,
    search,
    boardSort,
    boardLayout,
    archiveState,
    setMonth,
    setMonthAt,
    setView,
    setSearch,
    setBoardSort,
    setBoardLayout,
    setArchiveState,
    onStatClick,
    compact,
  } = props;

  const counter =
    view === "board"
      ? `${board.jams.length}/${board.totalAll} JAMS`
      : view === "calendar"
        ? `${calendar.jams.length}/${calendar.totalAll} JAMS`
        : undefined;

  const toolbar = (
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

  return (
    <div className={compact ? "flex flex-col gap-6" : "flex flex-col gap-8"}>
      <JamCalendarHero
        totalJams={totalTracked}
        stats={stats}
        statsLayout={compact ? "stacked" : "inline"}
        view={view}
        onViewChange={setView}
        onStatClick={onStatClick}
      />
      {/* On the board the toolbar sits *inside* the board, below the
          featured rail — featured jams are the page's headline and
          shouldn't be pushed under a filter row. Other views keep it on
          top. */}
      {view === "board" ? (
        <JamBoard
          jams={board.jams}
          now={now}
          isLoading={board.isLoading}
          searching={search.trim() !== ""}
          sort={boardSort}
          layout={boardLayout}
          toolbar={toolbar}
        />
      ) : (
        toolbar
      )}
      {view === "calendar" && (
        <JamCalendarSpans
          monthStart={monthStart}
          today={today}
          jams={calendar.jams}
          byDay={calendar.byDay}
          now={now}
          isLoading={calendar.isLoading}
          compact={compact}
          onMonthChange={setMonthAt}
          onPrevMonth={() => setMonth(-1)}
          onNextMonth={() => setMonth(1)}
          onJumpToday={() => setMonthAt(today)}
        />
      )}
      {view === "archive" && (
        <JamArchiveTable data={archive} state={archiveState} onStateChange={setArchiveState} />
      )}
    </div>
  );
}
