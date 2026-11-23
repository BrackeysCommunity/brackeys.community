package game

import (
	"cmp"
	"encoding/json"
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
)

// dossierGame is a world with a viewer and a neighbour on one server, a
// stranger on another, each server with its guild, and a saved NPC the
// viewer has met.
func dossierGame(t *testing.T) (g *Game, viewer, neighbour, stranger *Char, n *npc.NPC) {
	t.Helper()
	g = guardGame(t)
	create := func(key, server, guild string) *Char {
		res, err := g.Act(Command{Key: key, Kind: Create, Option: "knife", Server: server, Note: guild})
		if err != nil {
			t.Fatal(err)
		}
		return res.Char
	}
	viewer = create("viewer", "server-one", "Guild One")
	neighbour = create("neighbour", "server-one", "")
	stranger = create("stranger", "server-two", "Guild Two")
	for _, m := range meetResidents(t, g, viewer) {
		return g, viewer, neighbour, stranger, m
	}
	return
}

// remember has n remember an entry of kind about player at tick.
func remember(g *Game, n *npc.NPC, kind, player string, weight, tick int64) {
	g.r.NPC.Remember(n, npc.Entry{Kind: kind, Player: player, Weight: weight, Tick: tick, Thing: "a " + kind}, tick)
}

// A dossier reads the NPC and changes nothing: not the game, not the NPC.
func TestDossierReadOnly(t *testing.T) {
	g, viewer, neighbour, _, n := dossierGame(t)
	now := g.Tick()
	remember(g, n, "helped", viewer.C.ID, 1, now)
	remember(g, n, "wronged", neighbour.C.ID, 1, now)
	remember(g, n, "fortune", "", 1, now)
	before, _ := g.Digest()
	saved, _ := json.Marshal(n)
	d, err := g.Dossier(viewer, n.Stub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatal("reading a dossier changed the game")
	}
	if again, _ := json.Marshal(n); string(again) != string(saved) {
		t.Fatal("reading a dossier changed the NPC")
	}
	if d.Place == "" || d.Role == "" || len(d.Traits) != len(n.Stub.Traits) || d.Day != g.Tick()/sheets.TicksPerDay {
		t.Fatalf("the dossier is %+v", d)
	}
	if d.Names[refKey(npc.Ref(n.Stub.ID))] != n.Stub.Name {
		t.Fatalf("the dossier does not name its NPC: %v", d.Names)
	}
	if !slices.ContainsFunc(d.About, func(m MemoryView) bool { return m.Kind == "helped" && m.Who == "you" }) {
		t.Fatalf("about the viewer: %+v", d.About)
	}
	if !slices.ContainsFunc(d.World, func(m MemoryView) bool { return m.Kind == "fortune" && m.Who == "" }) {
		t.Fatalf("about the world: %+v", d.World)
	}
	if slices.ContainsFunc(d.About, func(m MemoryView) bool { return m.Kind == "wronged" }) {
		t.Fatal("another player's entry is told as the viewer's")
	}
	if _, err := g.Dossier(viewer, "nobody"); err == nil {
		t.Fatal("a dossier of an NPC nobody saved")
	}
}

// Another player is named only where they allow it: by name on
// their own server, as a traveller from their guild on another, each
// changeable.
func TestDossierConsent(t *testing.T) {
	g, viewer, neighbour, stranger, n := dossierGame(t)
	n.Memory, n.Archived = nil, nil
	now := g.Tick()
	remember(g, n, "helped", neighbour.C.ID, 1, now)
	remember(g, n, "wronged", stranger.C.ID, 1, now+1)
	who := func() (string, string) {
		t.Helper()
		d, err := g.Dossier(viewer, n.Stub.ID)
		if err != nil {
			t.Fatal(err)
		}
		var near, far string
		for _, m := range d.Oldest {
			switch m.Kind {
			case "helped":
				near = m.Who
			case "wronged":
				far = m.Who
			}
		}
		return near, far
	}
	two := g.GuildOf(stranger.C.Guild)
	if near, far := who(); near != neighbour.C.ID || far != "a traveller from "+two.G.Name {
		t.Fatalf("by default: %q and %q", near, far)
	}
	d, _ := g.Dossier(viewer, n.Stub.ID)
	if d.Names[refKey(guildRef(two.G.ID))] != two.G.Name {
		t.Fatalf("the traveller's guild is not named: %v", d.Names)
	}
	neighbour.HideSame, stranger.NameOther = true, true
	one := g.GuildOf(neighbour.C.Guild)
	if near, far := who(); near != "a traveller from "+one.G.Name || far != stranger.C.ID {
		t.Fatalf("with consent changed: %q and %q", near, far)
	}
	d, _ = g.Dossier(stranger, n.Stub.ID)
	if !slices.ContainsFunc(d.Oldest, func(m MemoryView) bool { return m.Kind == "wronged" && m.Who == "you" }) {
		t.Fatalf("the stranger's own entry: %+v", d.Oldest)
	}
}

// Past memory-cap the NPC folds its least salient entries into its
// summary; the dossier tells them by kind with their total, and cuts each
// list at dormant-summary.
func TestDossierFolded(t *testing.T) {
	g, viewer, _, _, n := dossierGame(t)
	n.Memory, n.Archived, n.Summary = nil, nil, nil
	limit := g.r.NPC.Param("memory-cap")
	keep := int(g.r.NPC.Param("dormant-summary"))
	now := g.Tick()
	for i := range limit {
		remember(g, n, "helped", viewer.C.ID, 1+i, now+i)
		if i%2 == 0 {
			remember(g, n, "fortune", "", 1+i, now+i)
		}
	}
	d, err := g.Dossier(viewer, n.Stub.ID)
	if err != nil {
		t.Fatal(err)
	}
	over := limit/2 + limit%2
	if d.FoldedTotal != over || len(d.Folded) == 0 {
		t.Fatalf("folded %d (%v), want %d", d.FoldedTotal, d.Folded, over)
	}
	var sum int64
	for _, x := range d.Folded {
		sum += x.N
	}
	if sum != d.FoldedTotal || !slices.IsSortedFunc(d.Folded, func(a, b tally.Count) int { return cmp.Compare(a.Key, b.Key) }) {
		t.Fatalf("the folded tally %v does not add to %d in order", d.Folded, d.FoldedTotal)
	}
	if len(d.About) != keep || len(d.World) > keep || len(d.Oldest) != keep {
		t.Fatalf("lists of %d, %d and %d, want at most %d", len(d.About), len(d.World), len(d.Oldest), keep)
	}
	for i := 1; i < len(d.About); i++ {
		if d.About[i-1].Tick <= d.About[i].Tick {
			t.Fatalf("about the viewer is not most salient first: %+v", d.About)
		}
	}
	kept := append(slices.Clone(n.Archived), n.Memory...)
	slices.SortStableFunc(kept, func(a, b npc.Entry) int { return cmp.Compare(a.Tick, b.Tick) })
	for i, m := range d.Oldest {
		if m.Tick != kept[i].Tick || m.Kind != kept[i].Kind {
			t.Fatalf("oldest %d is %+v, want %+v", i, m, kept[i])
		}
	}
	if fmt.Sprint(n.Summary) != fmt.Sprint(d.Folded) {
		t.Fatalf("folded %v, the summary %v", d.Folded, n.Summary)
	}
}
