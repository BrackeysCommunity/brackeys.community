package store_test

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// An epoch restamp moves the book and the roll epoch together, only from
// the exact stamp the world is at, and touches no other world.
func TestRestampEpoch(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	r := rules(t)
	st, _, _ := testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-kept", KeyVersion: 1, KeyCheck: "x", RulesEpoch: 2, SheetsDigest: "old", TickSeconds: 600})
	other, _, _ := testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-other", KeyVersion: 1, KeyCheck: "x", RulesEpoch: 2, SheetsDigest: "old", TickSeconds: 600})
	stampOf := func(s *store.Store) store.Stamp {
		t.Helper()
		m, err := s.Meta(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return m.Stamp()
	}
	at := store.Stamp{Sheets: "old", Roll: 2}
	next := store.Stamp{Sheets: "new", Roll: 3}
	for _, c := range []struct {
		from, to store.Stamp
		off      bool // refused as a world off the from stamp
	}{
		{store.Stamp{Sheets: "older", Roll: 2}, next, true},
		{store.Stamp{Sheets: "old", Roll: 1}, next, true},
		{store.Stamp{Sheets: "", Roll: 2}, next, false},
		{at, store.Stamp{Sheets: "", Roll: 3}, false},
		{at, at, false},
	} {
		err := st.RestampEpoch(ctx, c.from, c.to)
		if err == nil || errors.Is(err, store.ErrOtherSheets) != c.off {
			t.Fatalf("a restamp from %+v to %+v: %v", c.from, c.to, err)
		}
		if got := stampOf(st); got != at {
			t.Fatalf("a refused restamp from %+v left the world at %+v", c.from, got)
		}
	}
	if err := st.RestampEpoch(ctx, at, next); err != nil {
		t.Fatal(err)
	}
	if got := stampOf(st); got != next {
		t.Fatalf("restamped onto %+v", got)
	}
	if got := stampOf(other); got != at {
		t.Fatalf("another world moved to %+v", got)
	}
	if err := st.RestampEpoch(ctx, at, store.Stamp{Sheets: "newer", Roll: 4}); !errors.Is(err, store.ErrOtherSheets) || stampOf(st) != next {
		t.Fatalf("a second restamp from the old stamp: %v", err)
	}
	if err := st.RestampEpoch(ctx, next, store.Stamp{Sheets: "new", Roll: 4}); err != nil {
		t.Fatalf("a roll-only restamp: %v", err)
	}
	if _, err := store.New(pool, "w-kept").Load(ctx, r); err != nil {
		t.Fatal(err)
	}
}

// A world stored at the pending epoch's stamp matches a process holding
// that epoch, and only that one.
func TestMatchesPendingStamp(t *testing.T) {
	k := keys.Throwaway("epoch-test")
	m := store.Meta{ID: "w", KeyVersion: 1, KeyCheck: k.Check(), RulesEpoch: 3, SheetsDigest: "next"}
	if err := m.Matches(k, 1, 2, "now"); !errors.Is(err, store.ErrOtherKeys) {
		t.Fatalf("a world on the next roll epoch matched without it pending: %v", err)
	}
	if err := m.Matches(k, 1, 2, "now", store.Stamp{Sheets: "next", Roll: 3}); err != nil {
		t.Fatal(err)
	}
	for _, p := range []store.Stamp{{Sheets: "next", Roll: 2}, {Sheets: "other", Roll: 3}, {}} {
		if err := m.Matches(k, 1, 2, "now", p); err == nil {
			t.Fatalf("a world at %+v matched pending %+v", m.Stamp(), p)
		}
	}
	if err := m.Matches(keys.Throwaway("other"), 1, 2, "now", m.Stamp()); !errors.Is(err, store.ErrOtherKeys) {
		t.Fatalf("a pending stamp let other keys through: %v", err)
	}
	if err := (store.Meta{ID: "w", KeyVersion: 1, KeyCheck: k.Check(), RulesEpoch: 2, SheetsDigest: "now"}).Matches(k, 1, 2, "now", m.Stamp()); err != nil {
		t.Fatalf("a world not yet restamped: %v", err)
	}
}

// Saving a season's notes twice keeps one row as first written; a new
// write of the season replaces its notes, and another season is its own.
func TestEpochNotesUpsert(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	st, _, _ := founded(t, ctx, pool, rules(t))
	if _, ok, err := st.EpochNotes(ctx, 1); err != nil || ok {
		t.Fatalf("notes before any were saved: %v %v", ok, err)
	}
	n := api.EpochNotes{Season: 1, From: "old", To: "new", Sheets: 2, Unseen: 1,
		Seen: []api.EpochNote{{Sheet: "items.materials", Row: "scrap-iron", Name: "scrap iron", Column: "value", Change: "changed", Before: "4", After: "5", Unit: "coin"}}}
	atOf := func() time.Time {
		t.Helper()
		var at time.Time
		if err := pool.QueryRow(ctx, `SELECT at FROM mmo.epoch_note WHERE world_id = $1 AND season = 1`, st.World).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at
	}
	if err := st.SaveEpochNotes(ctx, n, 0, 1); err != nil {
		t.Fatal(err)
	}
	first := atOf()
	if err := st.SaveEpochNotes(ctx, n, 0, 1); err != nil {
		t.Fatal(err)
	}
	var rows, rollFrom, rollTo int
	if err := pool.QueryRow(ctx, `SELECT count(*), min(roll_from), min(roll_to) FROM mmo.epoch_note WHERE world_id = $1`, st.World).Scan(&rows, &rollFrom, &rollTo); err != nil {
		t.Fatal(err)
	}
	if rows != 1 || rollFrom != 0 || rollTo != 1 || !atOf().Equal(first) {
		t.Fatalf("%d rows, roll %d to %d, at %v then %v", rows, rollFrom, rollTo, first, atOf())
	}
	got, ok, err := st.EpochNotes(ctx, 1)
	if err != nil || !ok || !reflect.DeepEqual(got, n) {
		t.Fatalf("read back %+v %v %v, want %+v", got, ok, err, n)
	}
	empty := api.EpochNotes{Season: 2, From: "new", To: "new", Sheets: 0}
	if err := st.SaveEpochNotes(ctx, empty, 1, 2); err != nil {
		t.Fatal(err)
	}
	if got, ok, err := st.EpochNotes(ctx, 2); err != nil || !ok || got.Seen == nil || len(got.Seen) != 0 {
		t.Fatalf("a roll-only season's notes: %+v %v %v", got, ok, err)
	}
	n.Unseen = 3
	if err := st.SaveEpochNotes(ctx, n, 0, 1); err != nil {
		t.Fatal(err)
	}
	if got, _, _ := st.EpochNotes(ctx, 1); got.Unseen != 3 {
		t.Fatalf("a new write of season 1 read back %+v", got)
	}
}
