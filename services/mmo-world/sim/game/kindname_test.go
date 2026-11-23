package game

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// craftKinds has c make n new kinds at its settlement, in one tick.
func craftKinds(t *testing.T, g *Game, c *Char, n int) []string {
	t.Helper()
	c.C.At = g.SettlementHex(0)
	var out []string
	for _, m := range g.r.Book.Materials {
		if len(out) == n {
			break
		}
		rec := item.Recipe{Process: "shape", Method: "narrow-grind", Slot: "tool", Inputs: []item.Input{{Kind: m.ID, Qty: 2}}}
		ap, err := g.Appraise(c, rec)
		if err != nil {
			continue
		}
		dirGive(t, g, c, ledger.Material(m.ID), 2)
		dirGive(t, g, c, ledger.Coin, ap.Fee)
		was := len(c.C.Discovered)
		if _, err := g.Act(Command{Key: "craft-" + m.ID, Char: c.C.ID, Kind: Craft, Recipe: &rec}); err != nil {
			t.Fatalf("crafting %s: %v", m.ID, err)
		}
		if len(c.C.Discovered) > was {
			out = append(out, c.C.Discovered[len(c.C.Discovered)-1])
		}
	}
	if len(out) < n {
		t.Fatalf("made %d new kinds, want %d", len(out), n)
	}
	return out
}

// kindNameRefused asserts a kind-name is refused with code and changes
// nothing.
func kindNameRefused(t *testing.T, g *Game, who *Char, id, name, code string) {
	t.Helper()
	before, _ := g.Digest()
	var r *Refused
	if _, err := g.Act(Command{Key: "kn-" + code + "-" + who.C.ID, Char: who.C.ID, Kind: KindName, Option: id, Note: name}); !errors.As(err, &r) || r.Code != code {
		t.Fatalf("naming %s %q by %s: %v, want %s", id, name, who.C.ID, err, code)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatalf("a %s refusal changed the game", code)
	}
}

// A kind is named once, by its first maker, within the rename days of its
// discovery, and screened as a promotion's name is; it writes no fact.
func TestKindName(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "maker", "knife")
	other := mustCreate(t, g, "not-maker", "knife")
	kinds := craftKinds(t, g, c, 3)
	a, b, late := kinds[0], kinds[1], kinds[2]
	plain := g.Kinds.Name(a)
	if plain == "" {
		t.Fatal("a new kind has no plain name")
	}

	kindNameRefused(t, g, c, "no-such-kind", "Ash Hook", NoSuchRow)
	kindNameRefused(t, g, other, a, "Ash Hook", NotFirst)
	kindNameRefused(t, g, c, a, "  ", BadName)
	kindNameRefused(t, g, c, a, strings.Repeat("n", int(g.gp("title-length"))+1), BadName)
	kindNameRefused(t, g, c, a, "the "+g.r.Book.Words[0].ID+"s", BadName)

	facts := g.Log.Len()
	if _, err := g.Act(Command{Key: "kn-a", Char: c.C.ID, Kind: KindName, Option: a, Note: " Ash Hook "}); err != nil {
		t.Fatal(err)
	}
	if g.Log.Len() != facts {
		t.Fatal("naming a kind wrote a fact")
	}
	i, _ := g.Kinds.madeAt(a)
	if kc := g.Kinds.Made[i]; kc.Name != "Ash Hook" || !kc.Given || kc.Named != c.C.ID {
		t.Fatalf("the named kind is %+v", kc)
	}
	kindNameRefused(t, g, c, a, "Ember Hook", Named)

	k, _ := g.Kinds.Kind(b)
	for g.Tick() < k.Discovered+g.r.Emerge.P.RenameDays*sheets.TicksPerDay-1 {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := g.Act(Command{Key: "kn-b", Char: c.C.ID, Kind: KindName, Option: b, Note: "Last Hook"}); err != nil {
		t.Fatalf("naming on the last tick of its days: %v", err)
	}
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	kindNameRefused(t, g, c, late, "Too Late", NameClosed)
	if _, err := g.CanNameKind(b, c.C.ID); err == nil {
		t.Fatal("a given name can be given again")
	}
}

// A save from before kind naming loads at its digest; its kind, which
// names no first maker, cannot be named, and a kind made after it can.
func TestKindNameOldSave(t *testing.T) {
	dir := filepath.Join(sheetfs.ModuleRoot(), "sim", "game", "testdata", "pre-mm10")
	body, err := os.ReadFile(filepath.Join(dir, "snapshot.json"))
	if err != nil {
		t.Fatal(err)
	}
	digest, err := os.ReadFile(filepath.Join(dir, "digest.txt"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := NewRules(b, keys.Throwaway("pre-mm10"))
	if err != nil {
		t.Fatal(err)
	}
	var g Game
	if err := json.Unmarshal(body, &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(r)
	if d, _ := g.Digest(); d.String() != strings.TrimSpace(string(digest)) {
		t.Fatalf("the pre-MM10 save attaches at %s, saved as %s", d, strings.TrimSpace(string(digest)))
	}
	if len(g.Kinds.List) == 0 {
		t.Fatal("the old save holds no kind")
	}
	old := g.Kinds.List[0].ID
	kindNameRefused(t, &g, g.Chars[0], old, "Old Hook", NotFirst)

	c := mustCreate(t, &g, "old-world-maker", "knife")

	made := craftKinds(t, &g, c, 1)
	if _, err := g.Act(Command{Key: "kn-old-world", Char: c.C.ID, Kind: KindName, Option: made[0], Note: "New Hook"}); err != nil {
		t.Fatal(err)
	}
	if g.Kinds.Name(made[0]) != "New Hook" {
		t.Fatalf("the new kind is called %q", g.Kinds.Name(made[0]))
	}
	i, _ := g.Kinds.madeAt(old)
	kc, err := json.Marshal(g.Kinds.Made[i])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(kc), "given") {
		t.Fatalf("the old kind's count gained a field: %s", kc)
	}
}
