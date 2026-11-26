package mapview

import (
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/tile"
)

func tracked(visits int64, who ...fact.Ref) *tile.State {
	t := &tile.State{Visits: visits}
	for i, w := range who {
		t.Tracks = append(t.Tracks, tile.Track{Who: w, Tick: int64(i)})
	}
	return t
}

// Busy-ness is a band over decayed arrivals with a distinct-character
// floor: one walker, however often, never lights a tile (GDD 4.11).
func TestBusyBands(t *testing.T) {
	p := Params{BusyLight: 2, BusyBusy: 6, BusyCrowded: 15, BusyDistinct: 2}
	a, b := char.Ref("c-1"), char.Ref("c-2")
	beast := fact.Ref{Kind: "creature", ID: "wolf"}
	for _, tc := range []struct {
		name string
		t    *tile.State
		want string
	}{
		{"untrodden", tracked(0), ""},
		{"a lone walker", tracked(40, a, a, a, a, a, a), ""},
		{"a walker and a beast", tracked(40, a, beast, beast), ""},
		{"two, once", tracked(1, a, b), ""},
		{"light", tracked(2, a, b), api.BusyLight},
		{"busy", tracked(6, a, b, a), api.BusyBusy},
		{"crowded", tracked(15, b, a), api.BusyCrowded},
	} {
		if got := busy(tc.t, p); got != tc.want {
			t.Errorf("%s: %q, want %q", tc.name, got, tc.want)
		}
	}

	s := newSighted(t, 4)
	h := s.home.Neighbour(0)
	st := s.g.World.Tile(h)
	st.Visits, st.Tracks = s.p.BusyCrowded, []tile.Track{{Who: char.Ref(s.c.C.ID)}}
	if got := Live(s.g, h, s.p).Busy; got != "" {
		t.Errorf("a lone walker's tile reads %q", got)
	}
	st.Tracks = append(st.Tracks, tile.Track{Who: char.Ref("c-other")})
	if got := Live(s.g, h, s.p).Busy; got != api.BusyCrowded {
		t.Errorf("a crowded tile reads %q", got)
	}
}

// Live reads the region's gauges and lines, the sky, the fire and the
// trouble of the place covering the tile.
func TestLiveLayers(t *testing.T) {
	s := newSighted(t, 4)
	h := s.home.Neighbour(1)
	threat, _ := s.g.World.GaugeAt(h, gaugeThreat)
	s.sky("storm", h)
	s.g.World.Tile(h).Fire = tile.Fire{State: tile.FireBurning, Ticks: 1}
	l := Live(s.g, h, s.p)
	if l.Fog != api.FogSight || l.Q != h.Q || l.R != h.R || l.Threat != threat || l.Weather != "storm" || !l.Fire {
		t.Errorf("live %+v", l)
	}
	if l.Danger != s.g.World.Past(h, lineDanger) || l.Corrupted != s.g.World.Past(h, lineCorrupted) {
		t.Errorf("lines %+v", l)
	}
	if l.Trouble != "" {
		t.Errorf("trouble %q with none running", l.Trouble)
	}
	s.g.Story.Arcs = append(s.g.Story.Arcs, &game.Arc{ID: "arc-t", Template: "fire", Scope: arc.Settlement,
		Place: goal.SettlementRef(0), Stages: []game.StageRun{{}}})
	s.g.Places[0].City = &settle.City{Tiles: []hex.Hex{h}}
	if got := Live(s.g, s.home, s.p).Trouble; got != "fire" {
		t.Errorf("home's trouble reads %q", got)
	}
	if got := Live(s.g, h, s.p).Trouble; got != "fire" {
		t.Errorf("a city tile's trouble reads %q, not its settlement's", got)
	}
	if got := Live(s.g, s.home.Neighbour(3), s.p).Trouble; got != "" {
		t.Errorf("a tile no place covers reads trouble %q", got)
	}
}
