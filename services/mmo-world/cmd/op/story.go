package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/store"
)

// arcOrder reads an arc-cast's words: the template, then role=kind:id for
// each role it binds and at most one seat=q,r. The sim judges whether the
// cast fits the template.
func arcOrder(args []string) (api.ArcOrder, error) {
	var o api.ArcOrder
	if len(args) < 2 || args[0] == "" || strings.Contains(args[0], "=") {
		return o, errors.New(usage)
	}
	o.Template = args[0]
	roles := map[string]bool{}
	for _, w := range args[1:] {
		role, v, ok := strings.Cut(w, "=")
		if !ok || role == "" || v == "" {
			return o, fmt.Errorf("a cast word is role=kind:id or seat=q,r, not %q", w)
		}
		if role == "seat" {
			if o.Seat != nil {
				return o, errors.New("an arc-cast names one seat")
			}
			at, err := hexArg(v)
			if err != nil {
				return o, err
			}
			o.Seat = &at
			continue
		}
		kind, id, ok := strings.Cut(v, ":")
		if !ok || kind == "" || id == "" {
			return o, fmt.Errorf("role %s is bound as kind:id, not %q", role, v)
		}
		if roles[role] {
			return o, fmt.Errorf("role %s is bound twice", role)
		}
		roles[role] = true
		o.Cast = append(o.Cast, api.CastRef{Role: role, Kind: kind, ID: id})
	}
	if len(o.Cast) == 0 {
		return o, errors.New("an arc-cast binds at least one role")
	}
	return o, nil
}

// story is the operator's view of the story: the season, the arcs, the
// ring and the pattern boards, never a solution.
func story(ctx context.Context, c *client.HTTP) (api.StoryView, error) {
	var out api.StoryView
	ref, err := c.Do(ctx, http.MethodGet, api.PathOperatorStory, nil, &out)
	return out, client.Refused("story", ref, err)
}

// epochFacts are the world's season.epoch facts, oldest first.
func epochFacts(ctx context.Context, st *store.Store) ([]fact.Fact, error) {
	var out []fact.Fact
	var after fact.ID
	for {
		fs, err := st.StoryFactsSince(ctx, []string{factEpoch}, after, epochPage)
		if err != nil {
			return nil, err
		}
		out = append(out, fs...)
		if len(fs) < epochPage {
			return out, nil
		}
		after = fs[len(fs)-1].ID
	}
}

// structural: the fact a rules epoch writes, and how many are read at once.
const (
	factEpoch = "season.epoch"
	epochPage = 64
)

// crossed is the epoch a replay from a snapshot at tick from to tick to
// would run across: ticks up to the epoch's ran on the rules before it, and
// one replay holds one set of rules.
func crossed(epochs []fact.Fact, from, to int64) (fact.Fact, bool) {
	for _, e := range epochs {
		if from < e.Tick && e.Tick <= to {
			return e, true
		}
	}
	return fact.Fact{}, false
}

// crossesEpoch is the refusal of a replay from the snapshot at from across
// a rules epoch.
func crossesEpoch(e fact.Fact, from, to int64) error {
	was, _ := e.Get("from")
	now, _ := e.Get("to")
	return fmt.Errorf("%s: a replay from the snapshot at tick %d to tick %d crosses the rules epoch taken at tick %d (sheets %s to %s); replay from tick %d on",
		api.CodeCrossesEpoch, from, to, e.Tick, short(was.S), short(now.S), e.Tick)
}

// structural: digest characters shown in a refusal.
const digestShown = 12

func short(d string) string { return d[:min(len(d), digestShown)] }
