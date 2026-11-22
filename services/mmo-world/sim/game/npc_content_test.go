package game

import (
	"reflect"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

func reached(t *testing.T, g *Game, h hex.Hex) {
	t.Helper()
	if err := g.World.Reach(g.Log, h, g.Tick()+1); err != nil {
		t.Fatal(err)
	}
	if c, ok := g.Content(h); !ok || c == nil || c.Key == "" {
		t.Fatalf("%v holds no drawn content once reached", h)
	}
}

func clashes(g *Game, traits []string) bool {
	for _, row := range g.r.Book.NPCTraits {
		if slices.Contains(traits, row.ID) && slices.Contains(traits, row.Opposes) {
			return true
		}
	}
	return false
}

// TestResidentsDrawn: the people of a reached settlement are drawn under
// its stored content's key. Their ids and roles are the native ones, so
// saved NPCs and bot ids keep working; their names are new, their traits
// are two and never opposed, and talking saves exactly the drawn stub.
func TestResidentsDrawn(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	h := c.C.At
	reached(t, g, h)
	native := g.r.NPC.Residents(gen.PlaceSettlement, h.Ref(), h, npc.Draw{})
	drawn := g.r.NPC.Residents(gen.PlaceSettlement, h.Ref(), h, g.npcDraw(h))
	var here []npc.Stub
	for _, p := range g.PeopleHere(c, h) {
		if p.Kind == npc.Resident {
			here = append(here, p.Stub)
		}
	}
	if !reflect.DeepEqual(here, drawn) {
		t.Fatalf("the settlement shows %+v, its content draws %+v", here, drawn)
	}
	renamed := 0
	for i, s := range drawn {
		if s.ID != native[i].ID || s.Role != native[i].Role {
			t.Fatalf("content moved a resident's id or role: %+v against %+v", s, native[i])
		}
		if int64(len(s.Traits)) != 2 || s.Traits[0] == s.Traits[1] || clashes(g, s.Traits) {
			t.Fatalf("%s carries traits %v", s.ID, s.Traits)
		}
		if s.Name != native[i].Name {
			renamed++
		}
	}
	if renamed == 0 {
		t.Fatal("drawn residents all kept their native names")
	}
	for role, n := range meetResidents(t, g, c) {
		i := slices.IndexFunc(drawn, func(s npc.Stub) bool { return s.Role == role })
		if i < 0 || !reflect.DeepEqual(n.Stub, drawn[i]) {
			t.Fatalf("talking saved %+v, not the drawn %s", n.Stub, role)
		}
	}
	for _, s := range g.Settlements() {
		if stored, ok := g.Content(s); ok && stored != nil {
			continue
		}
		if d := g.npcDraw(s); !reflect.DeepEqual(d, npc.Draw{}) {
			t.Fatalf("an unreached settlement draws under %+v", d)
		}
	}
}

// TestTraderStands: every settlement has its trader before it is
// reached and after, under the same id, so trades and saved traders
// carry across the draw.
func TestTraderStands(t *testing.T) {
	g := guardGame(t)
	mustCreate(t, g, "a", "knife")
	towns := g.Settlements()
	if len(towns) == 0 {
		t.Fatal("no settlements")
	}
	for _, h := range towns {
		var want string
		for _, s := range g.r.NPC.Residents(gen.PlaceSettlement, h.Ref(), h, npc.Draw{}) {
			if s.Role == roleTrader {
				want = s.ID
			}
		}
		if want == "" {
			t.Fatalf("%v has no native trader", h)
		}
		before, ok := g.traderStub(h)
		if !ok || before.ID != want {
			t.Fatalf("%v before its reach: trader %+v, want %s", h, before, want)
		}
		reached(t, g, h)
		after, ok := g.traderStub(h)
		if !ok || after.ID != want || after.Role != roleTrader || len(after.Traits) != 2 {
			t.Fatalf("%v once reached: trader %+v, want %s", h, after, want)
		}
		if n := g.trader(after); n.Stub.ID != want || !reflect.DeepEqual(n.Stub, after) {
			t.Fatalf("%v saved trader %+v", h, n.Stub)
		}
	}
}

// TestWandererFromContent: a reached tile's road sends wanderers drawn
// under its content's key, and a tile nobody has reached sends the
// native ones.
func TestWandererFromContent(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	var road []hex.Hex
	for _, n := range c.C.At.Neighbours() {
		for _, h := range n.Neighbours() {
			if !g.IsSettlement(h) && g.r.Gen.Passable(g.r.Gen.Baseline(h).Terrain) && !slices.Contains(road, h) {
				road = append(road, h)
			}
		}
	}
	if len(road) < 2 {
		t.Fatalf("only %d passable tiles round the settlement", len(road))
	}
	far := hex.Hex{Q: 400, R: -400}
	var differed int
	for _, h := range road {
		reached(t, g, h)
		var tags []string
		for _, x := range g.World.Place(h).Tags() {
			tags = append(tags, string(x))
		}
		for day := range int64(60) {
			got, ok := g.wanderer(h, day*sheets.TicksPerDay)
			want, wok := g.r.NPC.MeetWanderer(h, day, tags, g.npcDraw(h))
			if ok != wok || !reflect.DeepEqual(got, want) {
				t.Fatalf("%v day %d: met %+v, content draws %+v", h, day, got, want)
			}
			native, nok := g.r.NPC.MeetWanderer(h, day, tags, npc.Draw{})
			if ok != nok || !reflect.DeepEqual(got, native) {
				differed++
			}
		}
	}
	if differed == 0 {
		t.Fatal("content changed no wanderer")
	}
	if stored, ok := g.Content(far); ok && stored != nil {
		t.Fatal("a far tile holds content")
	}
	if d := g.npcDraw(far); !reflect.DeepEqual(d, npc.Draw{}) {
		t.Fatalf("an unreached tile draws under %+v", d)
	}
}
