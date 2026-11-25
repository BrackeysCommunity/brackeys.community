package store

import (
	"context"
	"time"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/store/db"
)

// LogRow is one logged staff, admin or operator command (GDD 14.8).
type LogRow struct {
	ID        int64
	Server    string // "" for an operator's
	Tick      int64
	At        time.Time
	Character string // the acting character; "" for an operator's
	Discord   string
	Role      string
	Kind      string
	What      string
	Points    int64 // event points the command spent
}

// LogPage is a page of the house log, oldest first, and the id to read
// the next page after: the last row's, or the one asked after if none.
type LogPage struct {
	Rows []LogRow
	Next int64
}

// logRole is the role a logged command spoke with. Admin implies staff, so
// a member carrying both flags logs as admin.
func logRole(cmd game.Command) string {
	if game.Operator(cmd.Kind) {
		return game.RoleOperator
	}
	return game.RoleOf(cmd)
}

// logRow is the log row of a command just applied to g. An operator
// speaks for no server and no character, whichever character it acts on.
func logRow(world string, g *game.Game, cmd game.Command, char, discord string, now time.Time) db.InsertHouseLogParams {
	server := cmd.Server
	if game.Operator(cmd.Kind) {
		server, char = "", ""
	}
	return db.InsertHouseLogParams{WorldID: world, Server: server, Tick: g.Tick(), Key: cmd.Key, CharacterID: char, DiscordID: discord,
		Role: logRole(cmd), Kind: cmd.Kind, What: game.LogWhat(cmd), Points: g.Spent(), At: ts(now)}
}

// HouseLog is a page of one server's log after a row id, at most limit
// rows (and never more than a read's most).
func (s *Store) HouseLog(ctx context.Context, server string, after int64, limit int32) (LogPage, error) {
	rows, err := s.q.HouseLogPage(ctx, db.HouseLogPageParams{WorldID: s.World, Server: server, After: after, Lim: pageSize(limit)})
	return logPage(rows, after, err)
}

// AllHouseLog is a page of every server's log and the operators', for
// operators.
func (s *Store) AllHouseLog(ctx context.Context, after int64, limit int32) (LogPage, error) {
	rows, err := s.q.HouseLogAll(ctx, db.HouseLogAllParams{WorldID: s.World, After: after, Lim: pageSize(limit)})
	return logPage(rows, after, err)
}

func pageSize(limit int32) int32 {
	if limit <= 0 || limit > most {
		return most
	}
	return limit
}

func logPage(rows []db.MmoHouseLog, after int64, err error) (LogPage, error) {
	if err != nil {
		return LogPage{}, err
	}
	out := LogPage{Rows: make([]LogRow, len(rows)), Next: after}
	for i, x := range rows {
		out.Rows[i] = LogRow{ID: x.ID, Server: x.Server, Tick: x.Tick, At: x.At.Time, Character: x.CharacterID, Discord: x.DiscordID,
			Role: x.Role, Kind: x.Kind, What: x.What, Points: x.Points}
		out.Next = x.ID
	}
	return out, nil
}
