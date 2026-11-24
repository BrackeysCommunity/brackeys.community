package game

import (
	"encoding/json"
	"os"
	"slices"
	"strconv"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// Over 10,000 stubs each npcs.leanings row leans upright and crooked
// within 2 points of its odds.
func TestLeaningWeights(t *testing.T) {
	g := guardGame(t)
	const stubs = 10000
	for _, row := range g.r.Book.Leanings {
		var up, crook int64
		for i := range stubs {
			switch g.leanFrom(row.ID, "stub-"+strconv.Itoa(i)) {
			case npc.LeaningUpright:
				up++
			case npc.LeaningCrooked:
				crook++
			}
		}
		for _, x := range []struct {
			got, want int64
		}{{up, row.Upright}, {crook, row.Crooked}} {
			if pct := x.got * fixed.Hundredths / stubs; pct < x.want-2 || pct > x.want+2 {
				t.Errorf("%s leans %d%% where its row gives %d%%", row.ID, pct, x.want)
			}
		}
	}
}

// A role's leaning wins over its home's faction; with neither, none.
func TestLeaningRow(t *testing.T) {
	g := storyGame(t)
	h := g.SettlementHex(0)
	r := g.World.RegionAt(h)
	watch := npc.Stub{ID: "w", Role: "settlement-watch", Home: h}
	keeper := npc.Stub{ID: "k", Role: "settlement-keeper", Home: h}
	g.World.Regions[r].Holder = -1
	if g.leaningRow(watch) != "watch" || g.leaningRow(keeper) != sheets.LeanNone {
		t.Fatal("an unheld home reads its role's or none")
	}
	g.World.Regions[r].Holder = 0
	if g.leaningRow(watch) != "watch" || g.leaningRow(keeper) != g.World.Factions[0].Archetype {
		t.Fatal("a held home reads its holder's archetype under a role's leaning")
	}
	if g.LeaningOf(watch) != npc.LeaningUpright {
		t.Fatal("a watch captain does not lean upright")
	}
}

// loadPreMM11a is the world saved before theft and alignment, attached.
func loadPreMM11a(t *testing.T) *Game {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := NewRules(b, keys.Throwaway("pre-mm11a"))
	if err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile("testdata/pre-mm11a/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	var g Game
	if err := json.Unmarshal(body, &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	return &g
}

// Every NPC saved before theft and alignment draws, at its next meeting,
// the leaning a fresh stub of it would, and stores it; nothing else of it
// is touched by the draw.
func TestSavedNPCDrawsItsStubsLeaning(t *testing.T) {
	g, fresh := loadPreMM11a(t), loadPreMM11a(t)
	fresh.NPCs = npc.Book{}
	if g.NPCs.Len() == 0 {
		t.Fatal("the save holds no saved NPC")
	}
	i := slices.IndexFunc(g.Chars, func(c *Char) bool { return canTrade(c) == nil })
	if i < 0 {
		t.Fatal("nobody in the save is free to talk")
	}
	who := g.Chars[i]
	met := 0
	for _, n := range slices.Clone(g.NPCs.List) {
		if n.Leaning != "" {
			t.Fatalf("%s leaned before MM11a", n.Stub.ID)
		}
		want := fresh.LeaningOf(n.Stub)
		if err := g.Teleport(who, g.r.NPC.At(n, g.Tick())); err != nil {
			continue
		}
		before := *n
		before.Met = slices.Clone(n.Met)
		if err := g.talk(who, Command{NPC: n.Stub.ID}); err != nil {
			continue
		}
		met++
		if n.Leaning != want {
			t.Fatalf("%s drew %s at its meeting; its fresh stub leans %s", n.Stub.ID, n.Leaning, want)
		}
		if n.Stub.Name != before.Stub.Name || !slices.Equal(n.Stub.Traits, before.Stub.Traits) || n.Stub.Home != before.Stub.Home {
			t.Fatalf("%s changed as it drew its leaning", n.Stub.ID)
		}
		if g.drawLeaning(n) {
			t.Fatalf("%s drew its leaning twice", n.Stub.ID)
		}
	}
	if met == 0 {
		t.Fatal("no saved NPC could be met")
	}
}

// The leaning rows, the den and the syndicate move no resident's or
// wanderer's name or traits: a book without them draws the same stubs.
func TestNoResidentOrTraitDrawMoves(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	old := *b
	old.NPCTraits = slices.DeleteFunc(slices.Clone(b.NPCTraits), func(x sheets.NPCTrait) bool { return x.Leaning })
	old.NPCRoles = nil
	for _, row := range b.NPCRoles {
		if row.Place == placeDen || row.Place == placeSyndicate {
			continue
		}
		row.Leaning = ""
		old.NPCRoles = append(old.NPCRoles, row)
	}
	if len(old.NPCTraits) == len(b.NPCTraits) || len(old.NPCRoles) == len(b.NPCRoles) {
		t.Fatal("the book has no leaning traits or syndicate roles to leave out")
	}
	k := keys.Throwaway("stubs")
	now, then := npc.New(b, k.Generation, k.Roll), npc.New(&old, k.Generation, k.Roll)
	if !slices.Equal(now.TraitIDs(), then.TraitIDs()) {
		t.Fatal("the trait pool moved")
	}
	even := make([]int64, len(now.TraitIDs()))
	for i := range even {
		even[i] = 1
	}
	for i := range 300 {
		h := hex.Hex{Q: int64(i%30) - 15, R: int64(i/30) - 5}
		for _, d := range []npc.Draw{{}, {Key: "content-" + h.Ref(), Traits: even}} {
			if x, y := now.Residents(gen.PlaceSettlement, h.Ref(), h, d), then.Residents(gen.PlaceSettlement, h.Ref(), h, d); !slices.EqualFunc(x, y, sameStub) {
				t.Fatalf("residents at %s moved: %+v against %+v", h.Ref(), x, y)
			}
			x, okX := now.MeetWanderer(h, int64(i), nil, d)
			y, okY := then.MeetWanderer(h, int64(i), nil, d)
			if okX != okY || !sameStub(x, y) {
				t.Fatalf("the wanderer at %s moved", h.Ref())
			}
		}
	}
}

func sameStub(a, b npc.Stub) bool {
	return a.ID == b.ID && a.Name == b.Name && a.Role == b.Role && slices.Equal(a.Traits, b.Traits)
}

// knownAt is a public move at tick in region r on tile h.
func knownAt(c *Char, tick int64, h hex.Hex, r int) {
	a := c.C.Align()
	a.Known = append(a.Known, char.Known{Tick: tick, At: h, Region: r})
}

// An NPC knows a band only from a public move made since it last met the
// character, at a first meeting within know-days, in its home region, on
// its route or one region over; Notorious and Upright are known to all.
func TestCanKnow(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "known", "knife")
	n := meetResidents(t, g, c)["settlement-watch"]
	home := g.World.RegionAt(n.Stub.Home)
	met := n.Meeting(c.C.ID).Tick
	later := met + sheets.TicksPerDay
	c.C.Align().Value = -15
	if g.canKnow(n.Stub, n, c, later) {
		t.Fatal("knew a band with no move made")
	}
	knownAt(c, met, n.Stub.Home, home)
	if g.canKnow(n.Stub, n, c, later) {
		t.Fatal("knew a move made before the last meeting")
	}
	knownAt(c, met+1, n.Stub.Home, home)
	if !g.canKnow(n.Stub, n, c, later) {
		t.Fatal("did not know a move in its home region")
	}

	c.C.Alignment.Known = nil
	near := g.World.Regions[home].Neighbours
	far := -1
	for r := range g.World.Regions {
		if r != home && !slices.Contains(near, r) {
			far = r
			break
		}
	}
	if len(near) > 0 {
		knownAt(c, met+1, hex.Hex{Q: -999, R: -999}, near[0])
		if !g.canKnow(n.Stub, n, c, later) {
			t.Fatal("did not hear of a move one region over")
		}
		c.C.Alignment.Known = nil
	}
	if far >= 0 {
		farTile := hex.Hex{Q: 999, R: 999}
		knownAt(c, met+1, farTile, far)
		if g.canKnow(n.Stub, n, c, later) {
			t.Fatal("heard of a move two regions over")
		}
		n.Route = append(n.Route, farTile)
		if !g.canKnow(n.Stub, n, c, later) {
			t.Fatal("did not see a move on its route")
		}
		n.Route = n.Route[:len(n.Route)-1]
	}

	c.C.Alignment.Known = nil
	if _, err := g.moveAlignment(c, ActTheft, -5, 0, "", false, later); err != nil {
		t.Fatal(err)
	}
	if len(char.KnownOf(c.C)) != 0 || g.canKnow(n.Stub, n, c, later+1) {
		t.Fatal("a private move was known")
	}

	stranger := npc.Stub{ID: "stranger", Role: "settlement-keeper", Home: n.Stub.Home}
	days := sheets.IntParam(g.r.Book.AlignParams, "know-days") * sheets.TicksPerDay
	now := later + days
	knownAt(c, now-days-1, n.Stub.Home, home)
	if g.canKnow(stranger, nil, c, now) {
		t.Fatal("a first meeting knew a move older than know-days")
	}
	knownAt(c, now-days+1, n.Stub.Home, home)
	if !g.canKnow(stranger, nil, c, now) {
		t.Fatal("a first meeting did not know a recent move")
	}
	c.C.Alignment.Known, c.C.Alignment.Value = nil, -60
	if !g.canKnow(stranger, nil, c, now) {
		t.Fatal("the Notorious are not known to all")
	}
}

// Disposition is the memory term plus the band shift an NPC's leaning
// gives the band it knows; a grudge with its faction holds it at the
// grudge's, whatever else.
func TestDisposition(t *testing.T) {
	g := storyGame(t)
	c := mustCreate(t, g, "held", "knife")
	n := meetResidents(t, g, c)["settlement-watch"]
	shift := func(lean, band string) int64 {
		for _, r := range g.r.Book.BandShifts {
			if r.ID == lean {
				return r.Shift(band)
			}
		}
		t.Fatalf("no band shift for %s", lean)
		return 0
	}
	if d := g.Disposition(c, n.Stub.ID); d != 0 {
		t.Fatalf("an unremarked stranger is held at %d", d)
	}
	c.C.Align().Value = -60
	want := shift(npc.LeaningUpright, bandNotorious)
	if d := g.Disposition(c, n.Stub.ID); d != want || g.Mood(c, n.Stub.ID) != g.moodOf(want) {
		t.Fatalf("an upright NPC holds the Notorious at %d, not %d", d, want)
	}
	g.r.NPC.Remember(n, npc.Entry{Kind: entryRobbed, Player: c.C.ID, Weight: 1, Tick: g.Tick()}, g.Tick())
	want += g.r.NPC.Param("robbed-disposition")
	if d := g.Disposition(c, n.Stub.ID); d != want || g.Mood(c, n.Stub.ID) != MoodHostile {
		t.Fatalf("a robbed upright NPC holds the Notorious at %d (%s), not %d", d, g.Mood(c, n.Stub.ID), want)
	}

	fence := npc.Stub{ID: "r-0,0-den-fence-0", Role: roleDenFence, Home: n.Stub.Home}
	crooked := shift(npc.LeaningCrooked, bandNotorious)
	if d := g.disposition(c, fence, nil, g.Tick()); d != crooked || g.moodOf(d) != MoodWarm {
		t.Fatalf("a fence holds the Notorious at %d, not %d", d, crooked)
	}
	c.C.Align().Grudges = []char.Grudge{{Faction: syndicateKey, Ends: g.Tick()/sheets.TicksPerDay + 1}}
	grudge := g.r.NPC.Param("grudge-disposition")
	if d := g.disposition(c, fence, nil, g.Tick()); d != grudge || g.moodOf(d) != MoodHostile {
		t.Fatalf("a fence of a faction the character betrayed holds it at %d", d)
	}
	c.C.Align().Grudges[0].Ends = g.Tick() / sheets.TicksPerDay
	if d := g.disposition(c, fence, nil, g.Tick()); d != crooked {
		t.Fatal("a grudge outlived its end")
	}

	c.C.People = []char.Disposition{{Notable: n.Stub.ID, Value: 7}}
	if d := g.Disposition(c, n.Stub.ID); d != 7+shift(npc.LeaningUpright, bandNotorious) {
		t.Fatalf("a notable's stored disposition is not its memory term: %d", d)
	}
}
