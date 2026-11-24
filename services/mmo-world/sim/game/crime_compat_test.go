package game

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// The keys a save gains only once theft and alignment have touched it.
var crimeKeys = []string{`"alignment":`, `"syndicate":`, `"burgled":`, `"leaning":`, `"theft":`, `"hot":`, `"backRoom":`, `"forSide":`}

func oldSave(t *testing.T, dir string) (*Game, string) {
	t.Helper()
	path := filepath.Join(sheetfs.ModuleRoot(), "sim", "game", "testdata", dir)
	body, err := os.ReadFile(filepath.Join(path, "snapshot.json"))
	if err != nil {
		t.Fatal(err)
	}
	digest, err := os.ReadFile(filepath.Join(path, "digest.txt"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := NewRules(b, keys.Throwaway(dir))
	if err != nil {
		t.Fatal(err)
	}
	var g Game
	if err := json.Unmarshal(body, &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	return &g, strings.TrimSpace(string(digest))
}

// Saves from before theft attach at their digests with nothing of theft
// in them: every alignment nil, no syndicate, no leaning drawn, and a
// save of them writes none of the new keys.
func TestCrimeCompatOldSaves(t *testing.T) {
	for _, dir := range []string{"pre-mm10", "pre-mm9"} {
		g, saved := oldSave(t, dir)
		if d, err := g.Digest(); err != nil || d.String() != saved {
			t.Fatalf("%s attaches at %s (%v), saved as %s", dir, d, err, saved)
		}
		if g.Syndicate != nil {
			t.Fatalf("%s attaches with a syndicate", dir)
		}
		for _, c := range g.Chars {
			if c.C.Alignment != nil || char.AlignmentValue(c.C) != 0 || char.IsMade(c.C) {
				t.Fatalf("%s: %s has an alignment", dir, c.C.ID)
			}
			if c.Fight != nil && c.Fight.Theft != nil {
				t.Fatalf("%s: %s is in a theft", dir, c.C.ID)
			}
			for _, in := range c.C.Pack {
				if in.Hot != nil {
					t.Fatalf("%s: %s carries a hot %s", dir, c.C.ID, in.ID)
				}
			}
		}
		for _, n := range g.NPCs.List {
			if n.Leaning != "" {
				t.Fatalf("%s: %s has a leaning drawn", dir, n.Stub.ID)
			}
		}
		if g.Story != nil {
			for i, p := range g.Story.At {
				if p.Burgled != nil {
					t.Fatalf("%s: place %d has burglaries", dir, i)
				}
			}
		}
		out, err := json.Marshal(g)
		if err != nil {
			t.Fatal(err)
		}
		for _, k := range crimeKeys {
			if bytes.Contains(out, []byte(k)) {
				t.Fatalf("%s saves a %s key", dir, k)
			}
		}
		var back Game
		if err := json.Unmarshal(out, &back); err != nil {
			t.Fatal(err)
		}
		back.Attach(g.r)
		if d, _ := back.Digest(); d.String() != saved {
			t.Fatalf("%s saved and attached again digests %s, saved as %s", dir, d, saved)
		}
	}
}

func roundTrip[T any](t *testing.T, what string, v T) {
	t.Helper()
	body, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var back T
	if err := json.Unmarshal(body, &back); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(back, v) {
		t.Fatalf("%s comes back as %+v from %s", what, back, body)
	}
}

func fullAlignment() *char.Alignment {
	mark := item.Hot{Victim: "npc:r-0,0-trader-0", Faction: "faction:1", Ends: 9, At: "3,-2"}
	return &char.Alignment{Value: -15, Day: 4, Good: 2,
		Pairs:   []char.PairGood{{With: "c-2", N: 2}},
		Known:   []char.Known{{Tick: 400, At: hex.Hex{Q: 3, R: -2}, Region: 5}},
		Grudges: []char.Grudge{{Faction: "syndicate", Ends: 64}},
		Made:    true, Found: true,
		Hot: []char.HotLot{{Material: "scrap", Units: 3, Mark: mark}},
		Wanted: []char.Wanted{{Victim: "npc:r-0,0-trader-0", Faction: "faction:1", Place: 2, Worth: 30, Coin: 12,
			Goods: []item.Spoil{{Material: "scrap", Qty: 3}}, Items: []string{"i-9"}, Source: ledger.NPCPool("r-0,0-trader-0"), Fact: 77, Ends: 900}},
		Stopped: 3, Thefts: 4, Fenced: 24, Laundered: 49}
}

// Every field theft and alignment add survives JSON as it was, and a game
// carrying them saves and attaches again at its digest.
func TestCrimeCompatRoundTrip(t *testing.T) {
	roundTrip(t, "an alignment", *fullAlignment())
	roundTrip(t, "a hot item", item.Instance{ID: "i-9", Kind: "knife", Level: 1, Picks: []string{}, Hot: &item.Hot{Victim: "faction:0", Faction: "faction:0", Ends: 12, At: "1,1"}})
	roundTrip(t, "an npc's leaning", npc.NPC{Stub: npc.Stub{ID: "r-0,0-den-fence-0", Traits: []string{}}, Route: []hex.Hex{}, Memory: []npc.Entry{}, Met: []npc.Meeting{}, Visits: []string{}, Leaning: npc.LeaningCrooked})
	roundTrip(t, "a theft", Theft{Kind: KindBurgle, Victim: "faction:2", Faction: "faction:2", Source: ledger.StorePool(2), Witness: 35,
		Parts: []fight.Part{{Label: "base", Value: 30}, {Label: "upright", Value: 10}}, Coin: 4, Goods: []item.Spoil{{Material: "scrap", Qty: 5}},
		Item: "i-3", Listing: "l-4", Worth: 40, Side: "q-7", Place: 1, At: hex.Hex{Q: -1, R: 2}, Failed: true})
	roundTrip(t, "a syndicate", Syndicate{Moves: []DenMove{{Fence: "r-0,0-den-fence-0", From: hex.Hex{Q: 0, R: 0}, To: hex.Hex{Q: 4, R: -1}, Day: 12, Cause: "informed"}}})
	roundTrip(t, "a place's burglaries", PlaceStory{Burgled: []int64{100, 250}})
	roundTrip(t, "a command", Command{Key: "k", Char: "c-1", Kind: Craft, BackRoom: true, ForSide: true})
	roundTrip(t, "a theft's fight", Fight{E: &fight.Encounter{ID: "t-c-1-1", Beats: []string{"lock"}}, Theft: &Theft{Kind: KindLift, Place: -1}})

	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	c.C.Alignment = fullAlignment()
	c.C.Pack[0].Hot = &item.Hot{Victim: "faction:0", Ends: 5, At: "0,0"}
	g.Syndicate = &Syndicate{Moves: []DenMove{{Fence: "r-x-den-fence-0", To: hex.Hex{Q: 1, R: 1}, Day: 1, Cause: "lapsed"}}}
	if g.Story == nil {
		t.Fatal("a new world has no story")
	}
	g.Story.At = append(g.Story.At, PlaceStory{Burgled: []int64{7}})
	want, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	out, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	var back Game
	if err := json.Unmarshal(out, &back); err != nil {
		t.Fatal(err)
	}
	back.Attach(g.r)
	if d, _ := back.Digest(); d != want {
		t.Fatalf("a game with theft's fields attaches again at %s, stood at %s", d, want)
	}
	bc := back.Char(c.C.ID)
	if !reflect.DeepEqual(bc.C.Alignment, c.C.Alignment) || !reflect.DeepEqual(bc.C.Pack[0].Hot, c.C.Pack[0].Hot) ||
		!reflect.DeepEqual(back.Syndicate, g.Syndicate) || !slices.Equal(back.Story.At[len(back.Story.At)-1].Burgled, []int64{7}) {
		t.Fatal("theft's fields did not come back with the game")
	}
}

// A character never moved reads 0 and carries nothing of theft, and its
// digest is the one it had before alignment existed.
func TestCrimeCompatNilAlignment(t *testing.T) {
	c := char.New("c-1", hex.Hex{})
	if char.AlignmentValue(c) != 0 || char.IsMade(c) || char.FenceFound(c) || char.StoppedAt(c) != 0 ||
		char.KnownOf(c) != nil || char.GrudgesOf(c) != nil || char.HotLotsOf(c) != nil || char.WantedOf(c) != nil {
		t.Fatal("a character with no alignment reads something")
	}
	before, err := canon.Marshal(c)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(before, []byte("alignment")) {
		t.Fatal("a nil alignment is digested")
	}
	a := c.Align()
	if a == nil || c.Alignment != a || c.Align() != a {
		t.Fatal("Align does not keep the alignment it makes")
	}
	a.Value, a.Made, a.Stopped = -20, true, 2
	if char.AlignmentValue(c) != -20 || !char.IsMade(c) || char.StoppedAt(c) != 2 {
		t.Fatal("the readers do not read a set alignment")
	}
	var hot *item.Hot
	if hot.HotOn(0) {
		t.Fatal("no mark is hot")
	}
	if !(&item.Hot{Ends: 3}).HotOn(2) || (&item.Hot{Ends: 3}).HotOn(3) {
		t.Fatal("a mark is hot before its end day only")
	}
}

// A theft's site gives its beats in order: no beat is drawn, mixed,
// joined, cut short by flight or made a guardian, and a lock still gets
// its machine.
func TestCrimeCompatFixedBeats(t *testing.T) {
	g := guardGame(t)
	fixed := []string{fight.BeatLock, "chase", "clash"}
	pool := &fight.Pool{Health: 10}
	n := 0
	for _, arch := range g.r.Book.Creatures {
		for _, id := range []string{"t-c-1-1", "t-c-2-7", "t-c-9-3"} {
			cr := g.r.Fight.Spawn(arch.ID, nil, nil, nil)
			site := fight.Site{ID: id, Tags: []tags.Tag{"road"}, Floor: 1, MixLock: true, Guardian: pool, Fixed: fixed}
			e := g.r.Fight.Assemble(site, cr)
			if !slices.Equal(e.Beats, fixed) {
				t.Fatalf("%s on %s: beats %v, want %v", arch.ID, id, e.Beats, fixed)
			}
			if e.Joined != nil || e.Pool != nil || e.Guardian != -1 || len(e.Why) != 0 {
				t.Fatalf("%s on %s: joined %v, pool %v, guardian %d, why %v", arch.ID, id, e.Joined, e.Pool, e.Guardian, e.Why)
			}
			if len(e.Machines) != len(fixed) || len(e.Levels) != len(fixed) || e.Machines[0] == "" || e.Machines[1] != "" || e.Machines[2] != "" {
				t.Fatalf("%s on %s: machines %v", arch.ID, id, e.Machines)
			}
			n++
		}
	}
	stand := fight.Creature{Tier: 1, Tags: []tags.Tag{}}
	if e := g.r.Fight.Assemble(fight.Site{ID: "t-c-1-2", Fixed: fixed}, stand); !slices.Equal(e.Beats, fixed) || e.Machines[0] == "" {
		t.Fatalf("a stand-in creature's theft: beats %v, machines %v", e.Beats, e.Machines)
	}
	if n == 0 {
		t.Fatal("no creature to assemble against")
	}
}

// A command or effect kind nobody registered is refused as bad arguments
// with nothing changed; a registered one is run.
func TestCrimeCompatUnknownKinds(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	before, _ := g.Digest()
	for _, kind := range []string{Steal, Fence, PayFine, Flee, "no-such-kind"} {
		if _, ok := crimeCommands[kind]; ok {
			continue
		}
		_, err := g.Act(Command{Key: "u-" + kind, Char: c.C.ID, Kind: kind})
		var ref *Refused
		if !errors.As(err, &ref) || ref.Code != BadArgs {
			t.Fatalf("an unregistered %q: %v, want %s", kind, err, BadArgs)
		}
		if after, _ := g.Digest(); after != before {
			t.Fatalf("an unregistered %q was refused but changed the game", kind)
		}
	}

	const probe = "crime-probe"
	ran := 0
	crimeCommands[probe] = func(g *Game, c *Char, cmd Command) error {
		ran++
		return refuse(NoTarget, "probe")
	}
	crimeEffects[probe] = func(x effect) error {
		ran++
		return nil
	}
	defer delete(crimeCommands, probe)
	defer delete(crimeEffects, probe)
	_, err := g.Act(Command{Key: "probe", Char: c.C.ID, Kind: probe})
	var ref *Refused
	if !errors.As(err, &ref) || ref.Code != NoTarget || ran != 1 {
		t.Fatalf("a registered command: %v after %d runs", err, ran)
	}
	if err := (effect{g: g, a: &Arc{}, e: sheets.StoryEffect{Kind: probe}}).run(); err != nil || ran != 2 {
		t.Fatalf("a registered effect: %v after %d runs", err, ran)
	}
	err = (effect{g: g, a: &Arc{}, e: sheets.StoryEffect{Kind: "no-such-effect"}}).run()
	if !errors.As(err, &ref) || ref.Code != BadArgs {
		t.Fatalf("an unregistered effect: %v, want %s", err, BadArgs)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatal("refused kinds changed the game")
	}
	if len(meetHooks) != 0 && meetHooks[0] == nil {
		t.Fatal("a nil meeting hook is registered")
	}
}

// Every fact kind theft and alignment write is weighed by the sheets.
func TestCrimeCompatFactKinds(t *testing.T) {
	g := guardGame(t)
	for _, kind := range []string{factAlignment, factTheft, factWatchStopped, factWatchPaid, factWatchFled, factWatchCaught,
		factFenceBought, factFenceCame, factLaundered, factMade, factUnmade, factJobPosted, factBetrayed, factDenMoved} {
		if !slices.ContainsFunc(g.r.Book.FactWeights, func(w sheets.FactWeight) bool { return w.Kind == kind }) {
			t.Errorf("story.fact-weights has no %s", kind)
		}
	}
	if !ledger.IsStore(ledger.StorePool(3)) || ledger.IsStore(ledger.NPCPool("3")) {
		t.Fatal("IsStore does not know a store")
	}
	if n, ok := ledger.StoreOf(ledger.StorePool(12)); !ok || n != 12 {
		t.Fatalf("StoreOf reads %d, %v", n, ok)
	}
	if !strings.HasPrefix(ledger.ToSyndicate, ledger.Sink) {
		t.Fatal("the syndicate's account is not a sink")
	}
}

// The trait pool leaves the leaning rows out, and a stub drawn by id
// alone is the stub a place's role slot draws for that id.
func TestCrimeCompatTraitPoolAndStubs(t *testing.T) {
	g := guardGame(t)
	ids := g.r.NPC.TraitIDs()
	pool := 0
	for _, tr := range g.r.Book.NPCTraits {
		if tr.Leaning {
			if slices.Contains(ids, tr.ID) {
				t.Fatalf("the trait pool holds the leaning %s", tr.ID)
			}
			continue
		}
		if ids[pool] != tr.ID {
			t.Fatalf("trait %d of the pool is %s, want %s", pool, ids[pool], tr.ID)
		}
		pool++
	}
	if pool != len(ids) {
		t.Fatalf("the trait pool holds %d rows, the sheet %d drawn ones", len(ids), pool)
	}
	row := g.r.Book.NPCRoles[0]
	home := hex.Hex{Q: 2, R: -1}
	for _, d := range []npc.Draw{{}, {Key: "content-key"}} {
		res := g.r.NPC.Residents(row.Place, "here", home, d)
		if len(res) == 0 {
			t.Fatalf("%s fills no slot", row.ID)
		}
		if got := g.r.NPC.StubFor(res[0].ID, res[0].Role, home, d); !reflect.DeepEqual(got, res[0]) {
			t.Fatalf("StubFor draws %+v, the slot %+v", got, res[0])
		}
	}
}
