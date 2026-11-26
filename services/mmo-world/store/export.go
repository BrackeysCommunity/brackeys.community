package store

import (
	"context"
	"encoding/json"
	"time"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/store/db"
)

// The readers of recorded play, for the export and the backup's manifest.
// Ranges are of ticks, [from, upto).

// Action is a stored command as it was recorded. InteractionID is a
// client's, never exported.
type Action struct {
	Seq           int64
	InteractionID string
	AfterTick     int64
	Character     string
	Kind          string
	Cmd           game.Command
	Reply         json.RawMessage // the api reply the command got
	At            time.Time
}

// ActionsBetween are the commands recorded after ticks [from, upto), in
// order.
func (s *Store) ActionsBetween(ctx context.Context, from, upto int64) ([]Action, error) {
	rows, err := s.q.ActionsBetween(ctx, db.ActionsBetweenParams{WorldID: s.World, FromTick: from, UptoTick: upto})
	if err != nil {
		return nil, err
	}
	out := make([]Action, len(rows))
	for i, a := range rows {
		out[i] = Action{Seq: a.Seq, InteractionID: a.InteractionID, AfterTick: a.AfterTick, Character: a.CharacterID, Kind: a.Kind,
			Reply: json.RawMessage(a.Reply), At: a.At.Time}
		if err := json.Unmarshal(a.Command, &out[i].Cmd); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// FactsBetween are the facts of ticks [from, upto), oldest first, hidden
// kinds included: the reader decides what leaves.
func (s *Store) FactsBetween(ctx context.Context, from, upto int64) ([]fact.Fact, error) {
	return factsOf(s.q.FactsBetween(ctx, db.FactsBetweenParams{WorldID: s.World, FromTick: from, UptoTick: upto}))
}

// Snapshot is a stored world day's turn: the whole game's JSON, its digest
// and the last action seq it includes.
type Snapshot struct {
	Tick   int64
	Seq    int64
	Digest string
	Body   json.RawMessage
	At     time.Time
}

// SnapshotsBetween are the snapshots of ticks [from, upto), oldest first.
func (s *Store) SnapshotsBetween(ctx context.Context, from, upto int64) ([]Snapshot, error) {
	rows, err := s.q.SnapshotsBetween(ctx, db.SnapshotsBetweenParams{WorldID: s.World, FromTick: from, UptoTick: upto})
	if err != nil {
		return nil, err
	}
	out := make([]Snapshot, len(rows))
	for i, x := range rows {
		out[i] = Snapshot{Tick: x.Tick, Seq: x.Seq, Digest: x.Digest, Body: json.RawMessage(x.Body), At: x.At.Time}
	}
	return out, nil
}

// TickRow is one stored tick: its digest, how many facts it wrote, and how
// long its Advance took.
type TickRow struct {
	Tick   int64
	Digest string
	Facts  int64
	Ms     int64
	At     time.Time
}

// TicksBetween are the ticks in (after, upto], oldest first.
func (s *Store) TicksBetween(ctx context.Context, after, upto int64) ([]TickRow, error) {
	rows, err := s.q.ListTicks(ctx, db.ListTicksParams{WorldID: s.World, After: after, Upto: upto})
	if err != nil {
		return nil, err
	}
	out := make([]TickRow, len(rows))
	for i, x := range rows {
		out[i] = TickRow{Tick: x.Tick, Digest: x.Digest, Facts: int64(x.Facts), Ms: int64(x.Ms), At: x.At.Time}
	}
	return out, nil
}

// Counts are how many rows of each log a world holds. LastSnapshotTick is
// -1 with no snapshot.
type Counts struct {
	Facts            int64 `json:"facts"`
	LedgerTxns       int64 `json:"ledgerTxns"`
	LedgerEntries    int64 `json:"ledgerEntries"`
	Actions          int64 `json:"actions"`
	Ticks            int64 `json:"ticks"`
	Snapshots        int64 `json:"snapshots"`
	LastSnapshotTick int64 `json:"lastSnapshotTick"`
	Characters       int64 `json:"characters"`
	HouseLog         int64 `json:"houseLog"`
}

// Counts reads the world's row counts.
func (s *Store) Counts(ctx context.Context) (Counts, error) {
	c, err := s.q.WorldCounts(ctx, s.World)
	return Counts(c), err
}
