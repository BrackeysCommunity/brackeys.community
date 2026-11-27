package store

import (
	"context"
	"encoding/json"
	"fmt"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/store/db"
)

// LoadSnapshot is the game as the snapshot at or before a tick holds it,
// bound to its rules and checked against the snapshot's digest, with the
// last action seq it includes.
func (s *Store) LoadSnapshot(ctx context.Context, r *game.Rules, atOrBefore int64) (*game.Game, int64, error) {
	snap, err := s.q.SnapshotAtOrBefore(ctx, db.SnapshotAtOrBeforeParams{WorldID: s.World, Tick: atOrBefore})
	if err != nil {
		return nil, 0, fmt.Errorf("store: no snapshot at or before tick %d: %w", atOrBefore, err)
	}
	g := &game.Game{}
	if err := json.Unmarshal(snap.Body, g); err != nil {
		return nil, 0, err
	}
	if err := attachChecked(g, r, snap.Digest, fmt.Sprintf("the snapshot at tick %d", snap.Tick)); err != nil {
		return nil, 0, err
	}
	return g, snap.Seq, nil
}

// Recorded is a stored command and where it falls among the ticks.
type Recorded struct {
	Seq       int64
	AfterTick int64
	Cmd       game.Command
}

// ActionsAfter are the commands recorded after an action seq and before
// tick upto, in order.
func (s *Store) ActionsAfter(ctx context.Context, seq, upto int64) ([]Recorded, error) {
	rows, err := s.q.ListActionsAfter(ctx, db.ListActionsAfterParams{WorldID: s.World, Seq: seq, Upto: upto})
	if err != nil {
		return nil, err
	}
	out := make([]Recorded, len(rows))
	for i, a := range rows {
		cmd, err := decodeCommand(a.Command)
		if err != nil {
			return nil, err
		}
		out[i] = Recorded{Seq: a.Seq, AfterTick: a.AfterTick, Cmd: cmd}
	}
	return out, nil
}

// TickDigests are the digests recorded for ticks in (after, upto].
func (s *Store) TickDigests(ctx context.Context, after, upto int64) (map[int64]string, error) {
	rows, err := s.TicksBetween(ctx, after, upto)
	if err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(rows))
	for _, t := range rows {
		out[t.Tick] = t.Digest
	}
	return out, nil
}

func decodeCommand(b []byte) (game.Command, error) {
	var cmd game.Command
	err := json.Unmarshal(b, &cmd)
	return cmd, err
}
