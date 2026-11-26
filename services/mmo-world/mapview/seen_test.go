package mapview

import (
	"slices"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
)

// step moves the character one tile, to one it sees no further from, so
// some tiles leave its sight.
func (s *sighted) step(t *testing.T) {
	t.Helper()
	was := s.c.C.At
	s.c.C.At = s.find(t, 3, func(h hex.Hex) bool {
		return hex.Distance(h, was) == 1 && s.g.Sight(h) > 0 && s.g.Sight(h) <= s.g.Sight(was)
	})
}

// One step records exactly the tiles that left the character's sight,
// with their values now and the tick they left; tiles entering write
// nothing, and a holder keyed for the first time records nothing.
func TestPassLeaving(t *testing.T) {
	s := newSighted(t, 12)
	mine := Holder{HolderCharacter, s.c.C.ID}
	first, gone := Pass(s.g, nil, nil, s.p)
	if len(gone) != 0 || len(first) != 2 {
		t.Fatalf("a first pass gave %d changes, %v gone", len(first), gone)
	}
	prev := map[Holder]Key{}
	for _, c := range first {
		if len(c.Seen) != 0 {
			t.Errorf("%v keyed for the first time recorded %d tiles", c.Holder, len(c.Seen))
		}
		prev[c.Holder] = c.Key
	}
	before := Set(s.g, prev[mine])
	s.step(t)
	changes, _ := Pass(s.g, prev, nil, s.p)
	if len(changes) != 1 || changes[0].Holder != mine {
		t.Fatalf("a step changed %v", changes)
	}
	after := Set(s.g, changes[0].Key)
	var want []hex.Hex
	for _, h := range before {
		if !slices.Contains(after, h) {
			want = append(want, h)
		}
	}
	var got []hex.Hex
	for _, r := range changes[0].Seen {
		got = append(got, r.Hex)
		if r.Holder != mine || r.Left != s.g.Tick() || r.Live.Fog != api.FogSeen || r.Live.Left != s.g.Tick() ||
			r.Live.Q != r.Hex.Q || r.Live.R != r.Hex.R {
			t.Errorf("record %+v", r)
		}
		if live := Live(s.g, r.Hex, s.p, holderChars(s.g, r.Holder)); live.Threat != r.Live.Threat || live.Weather != r.Live.Weather {
			t.Errorf("record %v holds %+v, the tile reads %+v", r.Hex, r.Live, live)
		}
	}
	if len(want) == 0 || !slices.Equal(got, want) {
		t.Errorf("recorded %v, want the leaving tiles %v", got, want)
	}

	var m MemSeen
	m.Apply(first, nil)
	m.Apply(changes, nil)
	if m.Count() != len(want) {
		t.Errorf("kept %d records, want %d", m.Count(), len(want))
	}
	chunkOf := s.g.World.Gen().ChunkOf
	var all []gen.ChunkCoord
	for _, h := range want {
		if !slices.Contains(all, chunkOf(h)) {
			all = append(all, chunkOf(h))
		}
	}
	if in := m.In([]Holder{mine, s.guild()}, all, chunkOf); len(in) != len(want) {
		t.Errorf("read %d records back, want %d", len(in), len(want))
	}
	if in := m.In([]Holder{s.guild()}, all, chunkOf); len(in) != 0 {
		t.Errorf("the guild holds %d of the character's records", len(in))
	}
	m.Apply(changes, nil)
	if m.Count() != len(want) {
		t.Errorf("a repeated pass kept %d records, want %d", m.Count(), len(want))
	}

	prev[mine] = changes[0].Key
	s.g.Chars = slices.DeleteFunc(slices.Clone(s.g.Chars), func(c *game.Char) bool { return c.C.ID == s.c.C.ID })
	s.g.Guilds[0].G.Members = nil
	s.g.Places[0].Guild = ""
	changes, gone = Pass(s.g, prev, nil, s.p)
	if len(changes) != 0 || !slices.Equal(gone, []Holder{mine, s.guild()}) {
		t.Fatalf("holders gone: %v, changes %v", gone, changes)
	}
	m.Apply(nil, gone)
	if m.Count() != 0 {
		t.Errorf("%d records outlive their holder", m.Count())
	}
}

// Nothing a pass, a key, a sight set, a live read or an overlay does
// moves the game's digest.
func TestPassIsPure(t *testing.T) {
	s := newSighted(t, 10)
	before, err := s.g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	prev := Keys(s.g)
	was := s.c.C.At
	s.step(t)
	moved := Keys(s.g)
	s.c.C.At = was
	changes, _ := Pass(s.g, moved, nil, s.p)
	Pass(s.g, prev, []Holder{{HolderCharacter, s.c.C.ID}, s.guild(), {HolderGuild, "g-none"}}, s.p)
	Sights(s.g, s.c)
	for _, h := range hex.DiscAt(s.home, 14) {
		Live(s.g, h, s.p, nil)
	}
	var seen []Record
	for _, c := range changes {
		seen = append(seen, c.Seen...)
	}
	Overlay(s.g, "w", Viewer{Kind: api.ViewerCharacter, Char: s.c}, nil, true, seen, s.p)
	after, err := s.g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Errorf("the view moved the digest: %v to %v", before, after)
	}
}

// A pass in which no key changed builds no sight set, however much of the
// world is discovered: its cost follows movement, not map size.
func TestPassCostFlat(t *testing.T) {
	s := newSighted(t, 30)
	for i := range 20 {
		s.create(t, "w-"+string(rune('a'+i)))
	}
	prev := Keys(s.g)
	from := tilesCovered.Load()
	for range 5 {
		if changes, gone := Pass(s.g, prev, nil, s.p); len(changes) != 0 || len(gone) != 0 {
			t.Fatalf("an unchanged world changed %v, gone %v", changes, gone)
		}
	}
	if n := tilesCovered.Load() - from; n != 0 {
		t.Errorf("a pass with no key change covered %d tiles", n)
	}
	k := prev[Holder{HolderCharacter, s.c.C.ID}]
	s.step(t)
	from = tilesCovered.Load()
	Pass(s.g, prev, nil, s.p)
	disc := func(r int64) int64 { return int64(len(hex.Disc(r))) }
	n := Keys(s.g)[Holder{HolderCharacter, s.c.C.ID}]
	if got, want := tilesCovered.Load()-from, disc(k[0].Radius)+disc(n[0].Radius); got != want {
		t.Errorf("one step covered %d tiles, want its two discs' %d", got, want)
	}
}
