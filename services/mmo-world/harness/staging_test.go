package harness

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

func stagingBook(t *testing.T) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestStagingAudit: a short staged soak passes the gate, and the same
// watch flags a staged credit to a faction store, a staged unit left in a
// guild bank, and a clean mint beside a staged one.
func TestStagingAudit(t *testing.T) {
	b := stagingBook(t)
	s, err := soakStaging(b, 10, stagingFrom+6, strongestSeed(), true)
	if err != nil {
		t.Fatal(err)
	}
	w := s.watch
	if w.leaks != 0 {
		t.Fatalf("a clean staged soak has %d gate problems: %v", w.leaks, w.problems)
	}
	if w.minted == 0 || w.tries["crate-open · accepted"] == 0 {
		t.Fatalf("the soak staged nothing to audit: %d minted, attempts %v", w.minted, w.tries)
	}
	asset := ledger.Staged(w.home, "timber")
	planted := []struct {
		name string
		txn  ledger.Txn
		want string
	}{
		{"a staged credit to a store", ledger.Move("plant/store", "fill", 1, ledger.Char("c-1"), ledger.StorePool(0), asset, 2), ledger.StorePool(0)},
		{"a staged unit in a guild bank", ledger.Move("plant/bank", "deposit", 1, ledger.Char("c-1"), ledger.GuildPool("g-1"), asset, 1), ledger.GuildPool("g-1")},
		{"a clean mint while staging", ledger.Txn{Key: "plant/mint", Kind: "crate", Tick: 1, Legs: append(ledger.Pair(ledger.FromStaged, ledger.Char("c-1"), asset, 1),
			ledger.Pair(ledger.Source+"haul", ledger.Char("c-1"), ledger.Material("timber"), 1)...)}, "while staging"},
		{"a clean asset from src:staged", ledger.Move("plant/src", "crate", 1, ledger.FromStaged, ledger.Char("c-1"), ledger.Coin, 5), "src:staged minted coin"},
	}
	for _, x := range planted {
		before := w.leaks
		w.audit(x.txn)
		if w.leaks == before {
			t.Errorf("%s: the audit passed it", x.name)
			continue
		}
		if got := w.problems[len(w.problems)-1]; !strings.Contains(got, x.want) {
			t.Errorf("%s: the audit says %q, not naming %q", x.name, got, x.want)
		}
	}
	w.leaks, w.problems = 0, nil
	w.audit(ledger.Move("plant/ok", "give", 1, ledger.Char("c-1"), ledger.Char("c-2"), asset, 1))
	w.audit(ledger.Move("plant/ask", "ask", 1, ledger.Char("c-1"), ledger.EscrowPool("so-9"), asset, 1))
	if w.leaks != 0 {
		t.Errorf("a give and a staged ask were flagged: %v", w.problems)
	}
}

// TestSearchSmall: search -n 20 plays one twin of the strongest seed,
// with its control, and reads all three rows; nothing staged leaks and no
// character passes the staged xp allowance.
func TestSearchSmall(t *testing.T) {
	b := stagingBook(t)
	out := t.TempDir()
	readings, err := SearchRun(b, out, 20)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]Measured{}
	for _, m := range readings {
		got[m.Target] = m
	}
	for _, id := range []string{"staging-stays-local", "staged-goods-local", "staged-xp-cap"} {
		m, ok := got[id]
		switch {
		case !ok:
			t.Errorf("search -n 20 reads no %s", id)
		case strings.HasPrefix(m.Value, unmeasured) || strings.Contains(m.Value, "no price read"):
			t.Errorf("%s was not measured: %s", id, m.Value)
		case !m.Holds:
			t.Errorf("%s does not hold: %s", id, m.Value)
		}
	}
	doc, err := os.ReadFile(filepath.Join(out, "search.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"The confirming twin at 20 players", "| Settlement | Material |", "The control, staged the same with nothing taken", "crate-open | accepted"} {
		if !strings.Contains(string(doc), want) {
			t.Errorf("search.md lacks %q", want)
		}
	}
}

// untimed blanks a table's time cell, which differs run to run.
var untimed = regexp.MustCompile(`(?m)\| [0-9.]+(µs|ms|s|m[0-9.]*s?|h[0-9m.]*s?) \|$`)

// TestEconomyStagingOff: ECONOMY_STAGING=1 only adds the staging section
// and its two rows; off, the Economy run is the run it was.
func TestEconomyStagingOff(t *testing.T) {
	b := stagingBook(t)
	run := func(flag string) (string, []Measured) {
		t.Setenv("ECONOMY_STAGING", flag)
		out := t.TempDir()
		readings, err := EconomyRun(b, out, 10)
		if err != nil {
			t.Fatal(err)
		}
		doc, err := os.ReadFile(filepath.Join(out, "economy.md"))
		if err != nil {
			t.Fatal(err)
		}
		return untimed.ReplaceAllString(string(doc), "| – |"), readings
	}
	off, offRows := run("")
	on, onRows := run("1")
	if strings.Contains(off, "## Staging at") {
		t.Error("the Economy run stages with ECONOMY_STAGING off")
	}
	for _, m := range offRows {
		if m.Target == "staging-stays-local" || m.Target == "staged-goods-local" {
			t.Errorf("ECONOMY_STAGING off reads %s", m.Target)
		}
	}
	head, staging, ok := strings.Cut(on, "## Staging at 10 players")
	if !ok {
		t.Fatal("ECONOMY_STAGING=1 adds no staging section")
	}
	if head != off {
		t.Error("ECONOMY_STAGING=1 changes the Economy run's own report")
	}
	if !strings.Contains(staging, "Gate (`staged-goods-local`): clean") {
		t.Errorf("the staging section's gate is not clean:\n%s", staging)
	}
	if len(onRows) != len(offRows)+2 {
		t.Errorf("ECONOMY_STAGING=1 reads %d rows against %d off; want two more", len(onRows), len(offRows))
	}
}
