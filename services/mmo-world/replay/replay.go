// Package replay re-runs a stored world: from the snapshot at or before a
// tick, every recorded command in order and every tick after it, checking
// each tick against the digest the live world recorded. It reads and
// never writes, so it runs against a copy of a world's database (the
// nightly replay) as safely as against the world's own.
package replay

import (
	"context"
	"encoding/json"
	"fmt"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/db"
)

// Report is what a replay found. Mismatch is the first tick whose digest
// differed, if any.
type Report struct {
	World    string    `json:"world"`
	From     int64     `json:"from"` // the snapshot's tick
	To       int64     `json:"to"`
	Ticks    int64     `json:"ticks"`
	Checked  int64     `json:"checked"` // ticks with a recorded digest
	Actions  int       `json:"actions"`
	Digest   string    `json:"digest"`
	Mismatch *Mismatch `json:"mismatch,omitempty"`
}

type Mismatch struct {
	Tick int64  `json:"tick"`
	Got  string `json:"got"`
	Want string `json:"want"`
}

// Run replays st's world from the snapshot at or before from to tick to.
func Run(ctx context.Context, st *store.Store, r *game.Rules, from, to int64) (Report, error) {
	out := Report{World: st.World, To: to}
	snap, err := st.Q.SnapshotAtOrBefore(ctx, db.SnapshotAtOrBeforeParams{WorldID: st.World, Tick: from})
	if err != nil {
		return out, fmt.Errorf("replay: no snapshot at or before tick %d: %w", from, err)
	}
	g := &game.Game{}
	if err := json.Unmarshal(snap.Body, g); err != nil {
		return out, err
	}
	g.Attach(r)
	if d, err := g.Digest(); err != nil || d.String() != snap.Digest {
		return out, fmt.Errorf("replay: snapshot at tick %d does not load to its digest", snap.Tick)
	}
	out.From = snap.Tick
	acts, err := st.Q.ListActionsAfter(ctx, db.ListActionsAfterParams{WorldID: st.World, Seq: snap.Seq})
	if err != nil {
		return out, err
	}
	ticks, err := st.Q.ListTicks(ctx, db.ListTicksParams{WorldID: st.World, After: snap.Tick, Upto: to})
	if err != nil {
		return out, err
	}
	want := make(map[int64]string, len(ticks))
	for _, t := range ticks {
		want[t.Tick] = t.Digest
	}
	next := 0
	for g.Tick() < to {
		for ; next < len(acts) && acts[next].AfterTick == g.Tick(); next++ {
			var cmd game.Command
			if err := json.Unmarshal(acts[next].Command, &cmd); err != nil {
				return out, err
			}
			if _, err := g.Act(cmd); err != nil {
				return out, fmt.Errorf("replay: action %d (%s) at tick %d: %w", acts[next].Seq, cmd.Kind, g.Tick(), err)
			}
			g.Flush()
			out.Actions++
		}
		if _, err := g.Advance(); err != nil {
			return out, err
		}
		g.Flush()
		out.Ticks++
		if w, ok := want[g.Tick()]; ok {
			out.Checked++
			d, err := g.Digest()
			if err != nil {
				return out, err
			}
			if d.String() != w {
				out.Mismatch = &Mismatch{Tick: g.Tick(), Got: d.String(), Want: w}
				return out, nil
			}
		}
	}
	d, err := g.Digest()
	out.Digest = d.String()
	return out, err
}
