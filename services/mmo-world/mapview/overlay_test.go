package mapview

import (
	"slices"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/weather"
)

func (s *sighted) chunksRound(radius int64) []gen.ChunkCoord {
	var out []gen.ChunkCoord
	for _, h := range hex.DiscAt(s.home, radius) {
		if cc := s.g.World.Gen().ChunkOf(h); !slices.Contains(out, cc) {
			out = append(out, cc)
		}
	}
	return out
}

func record(h Holder, at hex.Hex, left, threat int64) Record {
	return Record{Holder: h, Hex: at, Left: left, Live: api.MapLive{Q: at.Q, R: at.R, Fog: api.FogSeen, Left: left, Threat: threat}}
}

func liveAt(o api.MapOverlay, h hex.Hex) (api.MapLive, bool) {
	i := slices.IndexFunc(o.Tiles, func(l api.MapLive) bool { return l.Q == h.Q && l.R == h.R })
	if i < 0 {
		return api.MapLive{}, false
	}
	return o.Tiles[i], true
}

// A character past the frontier, under a front centred over unknown
// ground, with records and a route naming unknown tiles, is sent no hex
// nobody has found but its own; other viewers are sent nothing.
func TestOverlayNeverUndiscovered(t *testing.T) {
	s := newSighted(t, 5)
	s.c.C.At = s.find(t, 8, func(h hex.Hex) bool { return hex.Distance(h, s.home) == 6 && s.g.Sight(h) >= 2 })
	own := s.c.C.At
	if discovered(s.g, own) {
		t.Fatal("the character's tile is discovered")
	}
	east := s.home.Add(hex.Direction(0).Scale(20))
	s.g.World.Sky.Systems = []weather.System{{ID: 1, Kind: "storm", Centre: east, Strength: 100_000, Heading: 3}}
	s.c.Long = &game.Long{Kind: "travel", Route: []hex.Hex{s.home, s.home.Add(hex.Direction(0).Scale(15)), s.home.Neighbour(0)}}
	var seen []Record
	for _, h := range hex.DiscAt(s.home, 9) {
		seen = append(seen, record(Holder{HolderCharacter, s.c.C.ID}, h, 1, 7))
	}
	all := s.chunksRound(20)
	check := func(name string, o api.MapOverlay) {
		t.Helper()
		if len(o.Tiles) == 0 || len(o.Fronts) != 1 || o.Self == nil {
			t.Fatalf("%s: %d tiles, %d fronts, self %v", name, len(o.Tiles), len(o.Fronts), o.Self)
		}
		ownSeen := false
		for _, l := range o.Tiles {
			h := hex.Hex{Q: l.Q, R: l.R}
			if h == own {
				ownSeen = l.Fog == api.FogSight
				continue
			}
			if !discovered(s.g, h) {
				t.Errorf("%s: tile %v nobody found", name, h)
			}
		}
		if !ownSeen {
			t.Errorf("%s: the own tile is not in sight", name)
		}
		for _, f := range o.Fronts {
			if h := (hex.Hex{Q: f.Q, R: f.R}); h != own && !discovered(s.g, h) {
				t.Errorf("%s: a front drawn at %v nobody found", name, h)
			}
			if f.Heading != "w" || f.Kind != "storm" {
				t.Errorf("%s: front %+v", name, f)
			}
		}
		if selfAt(o) != own || len(o.Self.Route) != 1 {
			t.Errorf("%s: self %+v", name, o.Self)
		}
		if !slices.IsSortedFunc(o.Tiles, func(a, b api.MapLive) int { return byRQ(hex.Hex{Q: a.Q, R: a.R}, hex.Hex{Q: b.Q, R: b.R}) }) {
			t.Errorf("%s: tiles out of order", name)
		}
	}
	check("sight", Overlay(s.g, "w", Viewer{Kind: api.ViewerCharacter, Char: s.c}, nil, true, seen, s.p))
	check("chunks", Overlay(s.g, "w", Viewer{Kind: api.ViewerCharacter, Char: s.c}, all, false, seen, s.p))

	for _, kind := range []string{api.ViewerAnonymous, api.ViewerPlayer} {
		o := Overlay(s.g, "w", Viewer{Kind: kind, Char: s.c}, all, false, seen, s.p)
		if o.Tiles == nil || o.Fronts == nil || len(o.Tiles) != 0 || len(o.Fronts) != 0 || o.Self != nil || o.Names != nil || o.Guild {
			t.Errorf("%s viewer got %+v", kind, o)
		}
		if o.Viewer != kind || o.Tick != s.g.Tick() || o.World != "w" {
			t.Errorf("%s viewer's header %+v", kind, o)
		}
	}
	if o := Overlay(s.g, "w", Viewer{Kind: api.ViewerCharacter}, all, false, seen, s.p); len(o.Tiles) != 0 || o.Self != nil {
		t.Errorf("a character viewer with no character got %+v", o)
	}
}

func selfAt(o api.MapOverlay) hex.Hex { return hex.Hex{Q: o.Self.Q, R: o.Self.R} }

// Out of sight, a tile shows the newer of the character's and its guild's
// records, the character's on a tie; in sight, no record; another
// holder's record, never.
func TestOverlayNewestWins(t *testing.T) {
	s := newSighted(t, 14)
	mine, guild, other := Holder{HolderCharacter, s.c.C.ID}, s.guild(), Holder{HolderCharacter, "c-other"}
	in := Sights(s.g, s.c)
	var far []hex.Hex
	for _, h := range hex.Ring(s.home, 11) {
		if !in[h] && discovered(s.g, h) {
			far = append(far, h)
		}
	}
	if len(far) < 4 {
		t.Fatal("too few tiles out of sight")
	}
	a, b, c, d := far[0], far[1], far[2], far[3]
	near := s.home.Neighbour(0)
	seen := []Record{
		record(mine, a, 10, 1), record(guild, a, 20, 2),
		record(mine, b, 30, 3), record(guild, b, 20, 4),
		record(guild, c, 25, 5), record(mine, c, 25, 6),
		record(other, d, 40, 7),
		record(mine, near, 50, 8),
	}
	o := Overlay(s.g, "w", Viewer{Kind: api.ViewerCharacter, Char: s.c}, s.chunksRound(14), false, seen, s.p)
	if !o.Guild {
		t.Error("the guild's sight is not joined in")
	}
	for _, tc := range []struct {
		h      hex.Hex
		left   int64
		threat int64
	}{{a, 20, 2}, {b, 30, 3}, {c, 25, 6}} {
		l, ok := liveAt(o, tc.h)
		if !ok || l.Fog != api.FogSeen || l.Left != tc.left || l.Threat != tc.threat {
			t.Errorf("%v reads %+v, want left %d threat %d", tc.h, l, tc.left, tc.threat)
		}
	}
	if l, ok := liveAt(o, d); ok {
		t.Errorf("another character's record shown: %+v", l)
	}
	if l, ok := liveAt(o, near); !ok || l.Fog != api.FogSight || l.Left != 0 {
		t.Errorf("an in-sight tile reads %+v", l)
	}
	for _, l := range o.Tiles {
		h := hex.Hex{Q: l.Q, R: l.R}
		if l.Fog == api.FogSight && !in[h] {
			t.Errorf("%v in sight outside the viewer's sight", h)
		}
		if l.Fog == api.FogSeen && !slices.Contains([]hex.Hex{a, b, c}, h) {
			t.Errorf("%v seen with no record", h)
		}
	}
	if o := Overlay(s.g, "w", Viewer{Kind: api.ViewerCharacter, Char: s.c}, []gen.ChunkCoord{{A: 1 << 20}}, false, seen, s.p); len(o.Tiles) != 1 {
		t.Errorf("chunks far off gave %d tiles, want the own one", len(o.Tiles))
	}
}

// Another guild's records never reach the viewer, and once the viewer's
// character leaves its guild, the old guild's records stop showing.
func TestOverlayOtherGuildKept(t *testing.T) {
	s := newSighted(t, 14)
	mine, guild, other := Holder{HolderCharacter, s.c.C.ID}, s.guild(), Holder{HolderGuild, "g-other"}
	in := Sights(s.g, s.c)
	var far []hex.Hex
	for _, h := range hex.Ring(s.home, 11) {
		if !in[h] && discovered(s.g, h) {
			far = append(far, h)
		}
	}
	if len(far) < 3 {
		t.Fatal("too few tiles out of sight")
	}
	const otherThreat, guildThreat, mineThreat = 97, 98, 99
	var seen []Record
	for _, h := range far {
		seen = append(seen, record(other, h, 90, otherThreat))
	}
	seen = append(seen, record(guild, far[1], 50, guildThreat), record(mine, far[2], 40, mineThreat))
	chunks := s.chunksRound(14)
	viewer := Viewer{Kind: api.ViewerCharacter, Char: s.c}

	o := Overlay(s.g, "w", viewer, chunks, false, seen, s.p)
	if !o.Guild {
		t.Error("the guild's sight is not joined in")
	}
	for _, l := range o.Tiles {
		if l.Threat == otherThreat || l.Left == 90 {
			t.Errorf("another guild's record shown at (%d,%d): %+v", l.Q, l.R, l)
		}
	}
	if l, ok := liveAt(o, far[0]); ok {
		t.Errorf("a tile only another guild recorded reads %+v", l)
	}
	if l, ok := liveAt(o, far[1]); !ok || l.Threat != guildThreat {
		t.Errorf("the guild's own record reads %+v", l)
	}

	was := s.c.C.Guild
	s.c.C.Guild = "g-none"
	defer func() { s.c.C.Guild = was }()
	o = Overlay(s.g, "w", viewer, chunks, false, seen, s.p)
	if o.Guild {
		t.Error("a guild with no standing place is still joined in")
	}
	for _, l := range o.Tiles {
		if l.Threat == otherThreat || l.Threat == guildThreat || l.Left == 90 || l.Left == 50 {
			t.Errorf("a record of a guild the viewer is not in shown at (%d,%d): %+v", l.Q, l.R, l)
		}
	}
	if l, ok := liveAt(o, far[2]); !ok || l.Threat != mineThreat {
		t.Errorf("the character's own record reads %+v", l)
	}
}
