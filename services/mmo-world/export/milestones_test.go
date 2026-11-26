package export_test

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"

	"jams.team/mmo-world/export"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

// recorded is a stand-in store: facts and snapshots as given, no actions.
type recorded struct {
	meta  store.Meta
	facts []fact.Fact
	snaps []store.Snapshot
}

func (r *recorded) Meta(context.Context) (store.Meta, error) { return r.meta, nil }

func (r *recorded) ActionsBetween(context.Context, int64, int64) ([]store.Action, error) {
	return nil, nil
}

func (r *recorded) FactsBetween(_ context.Context, from, upto int64) ([]fact.Fact, error) {
	var out []fact.Fact
	for _, f := range r.facts {
		if f.Tick >= from && f.Tick < upto {
			out = append(out, f)
		}
	}
	return out, nil
}

func (r *recorded) SnapshotsBetween(_ context.Context, from, upto int64) ([]store.Snapshot, error) {
	var out []store.Snapshot
	for _, s := range r.snaps {
		if s.Tick >= from && s.Tick < upto {
			out = append(out, s)
		}
	}
	return out, nil
}

func (r *recorded) fact(t *testing.T, tick int64, kind string, subjects []fact.Ref, data ...fact.Datum) {
	t.Helper()
	f := fact.Fact{ID: fact.ID(len(r.facts) + 1), Tick: tick, Kind: kind, Subjects: subjects, Data: data}
	if err := fact.Normalize(&f); err != nil {
		t.Fatal(err)
	}
	r.facts = append(r.facts, f)
}

func who(id string) []fact.Ref { return []fact.Ref{{Kind: "character", ID: id}} }

// TestMilestones reads each milestone kind from its fact, counts a
// character's firsts and its days since a theft from before the range,
// and records only what falls inside it.
func TestMilestones(t *testing.T) {
	book := testkit.Book(t)
	digest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	tpd := int64(sheets.TicksPerDay)
	src := &recorded{meta: store.Meta{ID: "w-milestones", SheetsDigest: digest}}
	body := fmt.Sprintf(`{"chars":[
		{"c":{"id":"c-1","coin":12,"pack":[{"id":"i-1","kind":"k-blade","level":20},{"id":"i-2","kind":"k-blade","level":6}]},"born":0,"acted":%d,"server":%q},
		{"c":{"id":"c-2","coin":30},"born":100,"acted":%d,"server":%q}],
		"kinds":{"list":[{"id":"k-blade","tier":2}]},"story":{"clock":{"n":0,"start":0,"days":14}}}`, 2*tpd-1, guild(0), 2*tpd-1, guild(1))
	for _, tick := range []int64{tpd, 2 * tpd} {
		src.snaps = append(src.snaps, store.Snapshot{Tick: tick, Body: json.RawMessage(body)})
	}
	src.fact(t, 10, "theft.made", who("c-2"))
	src.fact(t, 20, "item.levelled", who("c-1"), fact.S("item", "i-1"), fact.N("from", 4), fact.N("to", 5))
	src.fact(t, 30, "class.unlocked", who("c-1"), fact.S("class", "warden"), fact.S("first", "world"))
	src.fact(t, tpd+6, "item.levelled", who("c-1"), fact.S("item", "i-1"), fact.N("from", 19), fact.N("to", 20))
	src.fact(t, tpd+10, "item.levelled", who("c-1"), fact.S("item", "i-2"), fact.N("from", 3), fact.N("to", 6))
	src.fact(t, tpd+20, "guild.founded", append(who("c-1"), fact.Ref{Kind: "guild", ID: "g-1"}), fact.S("name", "The Typed Name"))
	src.fact(t, tpd+30, "city.raised", []fact.Ref{{Kind: "settlement", ID: "3"}})
	src.fact(t, 2*tpd-1, "thread.cast", append([]fact.Ref{{Kind: "arc", ID: "a-1"}}, who("c-2")...), fact.S("template", "the-invitation"),
		fact.N("stage", 0), fact.S("scope", "personal"))
	src.fact(t, 2*tpd-1, "thread.cast", who("c-1"), fact.S("template", "a-different-thread"), fact.N("stage", 0))

	dir, m := exported(t, src, book, tpd, -1)
	if m.FromTick != tpd || m.ToTick != 2*tpd || m.Records[export.FileMilestones] != 5 || m.Records[export.FileDays] != 2 {
		t.Fatalf("manifest %+v", m)
	}
	got := lines(t, filepath.Join(dir, export.FileMilestones))
	byKind := map[string]map[string]any{}
	for _, g := range got {
		byKind[g["kind"].(string)] = g
	}
	if got[0]["kind"] != export.MilestoneCity || got[0]["character"] != nil {
		t.Fatalf("the city sorts first, naming nobody: %v", got[0])
	}
	if l := byKind[export.MilestoneItem20]; l["first"] != true || l["tier"] != 2.0 || l["ticksSinceBorn"] != float64(tpd+6) {
		t.Errorf("level 20: %v", l)
	}
	if l := byKind[export.MilestoneItem5]; l["first"] != false || l["tier"] != 2.0 {
		t.Errorf("a second item at level 5 before the range's first is not a first: %v", l)
	}
	if l := byKind[export.MilestoneGuild]; l["first"] != true || l["character"] != byKind[export.MilestoneItem5]["character"] {
		t.Errorf("the founding: %v", l)
	}
	if l := byKind[export.MilestoneInvited]; l["daysSinceTheft"] != 1.0 || l["ticksSinceBorn"] != float64(2*tpd-1-100) {
		t.Errorf("the invitation, a day after a theft before the range: %v", l)
	}
	if _, ok := byKind[export.MilestoneClass]; ok {
		t.Error("a class unlocked before the range was exported")
	}
	for _, g := range got {
		for _, k := range []string{"name", "item", "guild", "settlement"} {
			if _, ok := g[k]; ok {
				t.Errorf("a milestone carries %q: %v", k, g)
			}
		}
	}
	for _, d := range lines(t, filepath.Join(dir, export.FileDays)) {
		if d["character"] == byKind[export.MilestoneGuild]["character"] && (d["bestItemLevel"] != 20.0 || d["coin"] != 12.0) {
			t.Errorf("c-1's day: %v", d)
		}
	}
}

// TestOtherSheets refuses to value a world's goods by sheets it does not
// run on.
func TestOtherSheets(t *testing.T) {
	src := &recorded{meta: store.Meta{ID: "w-other", SheetsDigest: "another-book"}}
	if _, err := export.Write(context.Background(), src, testkit.Book(t), t.TempDir(), 0, -1); err == nil {
		t.Fatal("an export on other sheets ran")
	}
}

// TestStored keeps what a command faced under its own key and leaves a
// reply without it as it was.
func TestStored(t *testing.T) {
	body := []byte(`{"tick":3,"facts":[]}`)
	if out, err := export.Stored(body, nil); err != nil || string(out) != string(body) {
		t.Fatalf("no seen: %s %v", out, err)
	}
	out, err := export.Stored(body, &export.Seen{Machine: &export.MachineSeen{Source: "bench", Family: "rewire", Level: 1, Party: 1}})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(out, &m); err != nil || string(m["tick"]) != "3" || m[export.SeenKey] == nil {
		t.Fatalf("stored %s: %v", out, err)
	}
	if _, err := export.Stored([]byte(`[]`), &export.Seen{}); err == nil {
		t.Fatal("a reply that is not an object was stored")
	}
}
