// Package replay re-runs a stored world: from the snapshot at or before a
// tick, every recorded command in order and every tick after it, checking
// each tick against the digest the live world recorded. It reads and
// never writes, so it runs against a copy of a world's database (the
// nightly replay) as safely as against the world's own.
package replay

import (
	"context"
	"fmt"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/store"
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

// Mismatch is a tick whose replayed digest differs from the recorded one.
type Mismatch struct {
	Tick int64  `json:"tick"`
	Got  string `json:"got"`
	Want string `json:"want"`
}

// Run replays st's world from the snapshot at or before from to tick to.
func Run(ctx context.Context, st *store.Store, r *game.Rules, from, to int64) (Report, error) {
	out := Report{World: st.World, To: to}
	g, seq, err := st.LoadSnapshot(ctx, r, from)
	if err != nil {
		return out, fmt.Errorf("replay: %w", err)
	}
	out.From = g.Tick()
	acts, err := st.ActionsAfter(ctx, seq, to)
	if err != nil {
		return out, err
	}
	want, err := st.TickDigests(ctx, g.Tick(), to)
	if err != nil {
		return out, err
	}
	next := 0
	for g.Tick() < to {
		for ; next < len(acts) && acts[next].AfterTick == g.Tick(); next++ {
			if _, err := g.Act(acts[next].Cmd); err != nil {
				return out, fmt.Errorf("replay: action %d (%s) at tick %d: %w", acts[next].Seq, acts[next].Cmd.Kind, g.Tick(), err)
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
