package store_test

import (
	"context"
	"testing"
	"time"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// TestHouseLog: every staff, admin and operator command saved writes one
// log row in its own transaction, with the role its flags give, the
// world's summary and the points it spent; a player's writes none, a
// second send of one interaction none, and each server pages its own.
func TestHouseLog(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	st, g, c := founded(t, ctx, pool, rules(t))
	count := func() int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM mmo.house_log WHERE world_id = $1", "w-test").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count(); n != 0 {
		t.Fatalf("creating a character logged %d rows", n)
	}
	testkit.Act(t, ctx, st, g, game.Command{Key: "h-step", Char: c.C.ID, Kind: game.Step, Dir: 0, Server: "srv-a"}, "discord-1")
	if n := count(); n != 0 {
		t.Fatalf("a player's step logged %d rows", n)
	}

	correct := game.Command{Key: "h-correct", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Coin, Units: 5, Note: "test purse", Server: "srv-a"}
	testkit.Act(t, ctx, st, g, correct, "")
	type want struct {
		cmd     game.Command
		role    string
		server  string
		char    string
		discord string
		points  int64
	}
	wants := []want{{cmd: correct, role: game.RoleOperator, points: g.Spent()}}

	// The house kinds' rules are the sim's; the store logs a command as the
	// service hands it over once applied.
	house := func(cmd game.Command, discord string) {
		t.Helper()
		cmd.Char = c.C.ID
		points := g.Spent()
		if err := st.SaveAction(ctx, g, cmd, c, discord, []byte(`{}`), time.Now()); err != nil {
			t.Fatal(err)
		}
		role := game.RoleStaff
		if cmd.Admin {
			role = game.RoleAdmin
		}
		wants = append(wants, want{cmd: cmd, role: role, server: cmd.Server, char: c.C.ID, discord: discord, points: points})
	}
	at := hex.Hex{Q: 1, R: -1}
	drop := game.Command{Key: "h-drop", Kind: game.Staging, Server: "srv-a", Admin: true, Staff: true,
		Stage: &game.StageCmd{Template: "drop-large", Settlement: 0, At: at}}
	house(drop, "discord-1")
	house(game.Command{Key: "h-hunt", Kind: game.Staging, Server: "srv-a", Staff: true,
		Stage: &game.StageCmd{Template: "hunt-2", Settlement: 0, At: at, Days: 2}}, "discord-1")
	house(game.Command{Key: "h-mute", Kind: game.Moderate, Server: "srv-b", Staff: true,
		Moderate: &game.ModerateCmd{Action: "mute", Ref: "character:" + c.C.ID, Days: 7}}, "discord-2")
	house(game.Command{Key: "h-end", Kind: game.StagingEnd, Server: "srv-a", Admin: true, Target: "st-1"}, "discord-1")
	if n := count(); n != len(wants) {
		t.Fatalf("%d log rows for %d logged commands", n, len(wants))
	}

	if err := st.SaveAction(ctx, g, drop, c, "discord-1", []byte(`{}`), time.Now()); err == nil {
		t.Fatal("a second write of one interaction id went through")
	}
	if n := count(); n != len(wants) {
		t.Fatalf("a refused second send left %d log rows for %d commands", n, len(wants))
	}

	all, err := store.New(pool, "w-test").AllHouseLog(ctx, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all.Rows) != len(wants) || all.Next != all.Rows[len(all.Rows)-1].ID {
		t.Fatalf("the whole log reads %d rows to %d, want %d", len(all.Rows), all.Next, len(wants))
	}
	for i, row := range all.Rows {
		w := wants[i]
		if row.Kind != w.cmd.Kind || row.Role != w.role || row.Server != w.server || row.Character != w.char || row.Discord != w.discord ||
			row.What != game.LogWhat(w.cmd) || row.Points != w.points || row.At.IsZero() {
			t.Errorf("row %d is %+v, want %s by %s of %q for %q, %q, %q, %d points", i, row, w.cmd.Kind, w.role, w.server, w.char,
				w.discord, game.LogWhat(w.cmd), w.points)
		}
		if i > 0 && row.ID <= all.Rows[i-1].ID {
			t.Errorf("row %d has id %d after %d", i, row.ID, all.Rows[i-1].ID)
		}
	}

	var a []store.LogRow
	after := int64(0)
	for range 4 {
		p, err := st.HouseLog(ctx, "srv-a", after, 2)
		if err != nil {
			t.Fatal(err)
		}
		if len(p.Rows) > 2 {
			t.Fatalf("a page of 2 read %d rows", len(p.Rows))
		}
		if len(p.Rows) == 0 && p.Next != after {
			t.Fatalf("an empty page after %d points on to %d", after, p.Next)
		}
		a = append(a, p.Rows...)
		after = p.Next
	}
	if len(a) != 3 {
		t.Fatalf("server A's pages hold %d rows, want 3", len(a))
	}
	for _, row := range a {
		if row.Server != "srv-a" {
			t.Fatalf("server A's log holds %+v", row)
		}
	}
	b, err := st.HouseLog(ctx, "srv-b", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Rows) != 1 || b.Rows[0].Kind != game.Moderate {
		t.Fatalf("server B's log is %+v", b.Rows)
	}
	if ops, err := st.HouseLog(ctx, "", 0, 0); err != nil || len(ops.Rows) != 1 || ops.Rows[0].Role != game.RoleOperator {
		t.Fatalf("the operators' own rows are %+v, %v", ops.Rows, err)
	}

	if err := st.Reset(ctx); err != nil {
		t.Fatal(err)
	}
	if n := count(); n != 0 {
		t.Fatalf("a reset world keeps %d log rows", n)
	}
}
