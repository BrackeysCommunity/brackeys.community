package harness

import (
	"encoding/json"
	"fmt"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Replay is a recorded fixture: a world's snapshot and its fact log at
// one tick, the actions recorded after it, and the digest the world and
// its log reach when those are replayed.
type Replay struct {
	Label    string          `json:"label"`
	Snapshot json.RawMessage `json:"snapshot"`
	Facts    []fact.Fact     `json:"facts"`
	Actions  []TickActions   `json:"actions"`
	Ticks    int64           `json:"ticks"`
	Digest   string          `json:"digest"`
}

// TickActions are the actions given at one tick.
type TickActions struct {
	Tick    int64          `json:"tick"`
	Actions []world.Action `json:"actions"`
}

// RecordReplay plays a world with the explorer for before world days,
// snapshots it, then records after more days of explorer actions and the
// digest they reach.
func RecordReplay(b *sheets.Book, label string, before, after int, explore bool) (*Replay, error) {
	k := keys.Throwaway(label)
	g, err := gen.New(b, k.Generation)
	if err != nil {
		return nil, err
	}
	s, err := world.New(b, g, k.Roll)
	if err != nil {
		return nil, err
	}
	log := &fact.Mem{}
	ex := NewExplorer(g.Settlement(0).Hex, explorerRadius)
	play := func(days int, record *[]TickActions) error {
		for range days {
			var acts []world.Action
			if explore {
				acts = ex.Day(s, explorerPerDay)
			}
			if s.Day == settleDay {
				acts = append(acts, world.Action{Kind: world.ActOpenSettlement})
			}
			if record != nil && len(acts) > 0 {
				*record = append(*record, TickActions{Tick: s.Tick + 1, Actions: acts})
			}
			if _, _, err := world.Advance(s, log, acts, s.Tick+1); err != nil {
				return err
			}
			for range ticksPerDay - 1 {
				if _, _, err := world.Advance(s, log, nil, s.Tick+1); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := play(before, nil); err != nil {
		return nil, err
	}
	snap, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	r := &Replay{Label: label, Snapshot: snap, Facts: log.Since(0), Ticks: int64(after) * ticksPerDay}
	if err := play(after, &r.Actions); err != nil {
		return nil, err
	}
	d, err := canon.Digest([]any{s, log.Since(0)})
	if err != nil {
		return nil, err
	}
	r.Digest = d.String()
	return r, nil
}

// Play replays a fixture from its snapshot and returns the digest.
func (r *Replay) Play(b *sheets.Book) (string, error) {
	k := keys.Throwaway(r.Label)
	g, err := gen.New(b, k.Generation)
	if err != nil {
		return "", err
	}
	var s world.State
	if err := json.Unmarshal(r.Snapshot, &s); err != nil {
		return "", err
	}
	s.Attach(b, g, k.Roll)
	log := &fact.Mem{}
	for _, f := range r.Facts {
		if _, err := log.Append(f); err != nil {
			return "", err
		}
	}
	at := 0
	for range r.Ticks {
		var acts []world.Action
		if at < len(r.Actions) && r.Actions[at].Tick == s.Tick+1 {
			acts = r.Actions[at].Actions
			at++
		}
		if _, _, err := world.Advance(&s, log, acts, s.Tick+1); err != nil {
			return "", err
		}
	}
	if at != len(r.Actions) {
		return "", fmt.Errorf("replay %s: %d recorded action ticks never came due", r.Label, len(r.Actions)-at)
	}
	d, err := canon.Digest([]any{&s, log.Since(0)})
	if err != nil {
		return "", err
	}
	return d.String(), nil
}

// structural: the fixtures' script: an explorer out to 40 tiles, 12 tiles
// a day, and a second settlement opening on day 12.
const (
	explorerRadius = 40
	explorerPerDay = 12
	settleDay      = 12
	ticksPerDay    = 144
)
