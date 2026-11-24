package game_test

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// testdata/pre-mm11a is a world saved before theft and alignment, on day
// 16 of season 1: four characters holding coin, fibre and a crafted blade,
// a kept vow, an errand one met for another, a pooled goal part claimed,
// two saved residents met, and a raid running on the first settlement.
// meeting.json is a saved NPC as the base left it after one more meeting
// made straight after loading.
const preMM11aDir = "testdata/pre-mm11a/"

type preMM11aMeeting struct {
	Char  string          `json:"char"`
	NPC   string          `json:"npc"`
	After json.RawMessage `json:"after"`
}

// A world saved before theft and alignment attaches at its digest with
// every character unremarked, a saved NPC met keeps everything but a new leaning, and it
// plays a world day with the ledger holding.
func TestPreMM11aWorldLoads(t *testing.T) {
	r := testkit.Rules(t, testkit.Book(t), keys.Throwaway("pre-mm11a"))
	body, err := os.ReadFile(preMM11aDir + "snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(preMM11aDir + "digest.txt")
	if err != nil {
		t.Fatal(err)
	}
	g := mm8aSnapshot(t, r, body)
	if d, _ := g.Digest(); d.String() != strings.TrimSpace(string(saved)) {
		t.Fatalf("the pre-MM11a save attaches at %s, saved as %s", d, strings.TrimSpace(string(saved)))
	}
	if err := preMM11aShows(g); err != nil {
		t.Fatal(err)
	}
	for _, c := range g.Chars {
		if err := unremarked(c); err != nil {
			t.Fatal(err)
		}
	}

	var m preMM11aMeeting
	mb, err := os.ReadFile(preMM11aDir + "meeting.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(mb, &m); err != nil {
		t.Fatal(err)
	}
	who, n := g.Char(m.Char), g.NPCs.Get(m.NPC)
	if who == nil || n == nil {
		t.Fatalf("the meeting names %s and %s, not in the save", m.Char, m.NPC)
	}
	if err := g.Teleport(who, g.Rules().NPC.At(n, g.Tick())); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Act(game.Command{Key: "pre11a-meet", Char: who.C.ID, Kind: game.Talk, NPC: n.Stub.ID}); err != nil {
		t.Fatal(err)
	}
	got, err := jsonMap(n)
	if err != nil {
		t.Fatal(err)
	}
	var want map[string]any
	if err := json.Unmarshal(m.After, &want); err != nil {
		t.Fatal(err)
	}
	leaning, drew := got["leaning"]
	delete(got, "leaning")
	if !reflect.DeepEqual(got, want) {
		for k := range want {
			if !reflect.DeepEqual(got[k], want[k]) {
				t.Errorf("the met NPC's %s is %v, the base left %v", k, got[k], want[k])
			}
		}
		t.Fatalf("meeting %s changed more than its leaning", n.Stub.ID)
	}
	switch {
	case drew && !slices.Contains([]any{"upright", "crooked", "none"}, leaning):
		t.Fatalf("the met NPC leans %v", leaning)
	case !drew:
		t.Fatalf("meeting %s drew no leaning", n.Stub.ID)
	}

	x := slices.IndexFunc(g.Goals, func(x *game.Goal) bool { return x.State == goal.Live && x.Mode == goal.Pooled && x.Poster != "" })
	if x < 0 {
		t.Fatal("the save holds no live pooled goal")
	}
	pooled := g.Goals[x]
	ri := slices.IndexFunc(g.Chars, func(c *game.Char) bool { return c.C.ID != pooled.Poster && pooled.Progress.Get(c.C.ID) == 0 })
	if ri < 0 {
		t.Fatal("every character has claimed the pooled goal")
	}
	runner := g.Chars[ri]
	n0, ok := settlementOf(g, pooled.Cond.At)
	if !ok {
		t.Fatalf("the pooled goal is at %s", pooled.Cond.At)
	}
	if err := g.Teleport(runner, g.SettlementHex(n0)); err != nil {
		t.Fatal(err)
	}
	fibre := materialWith(t, g, pooled.Cond.Tag)
	left := pooled.Cond.Count - pooled.Total()
	had := g.Ledger.Of(ledger.Char(pooled.Poster), ledger.Material(fibre))
	if _, err := g.Act(game.Command{Key: "pre11a-pool", Char: runner.C.ID, Kind: game.DeliverGoal, Target: pooled.ID, Material: fibre, Units: left}); err != nil {
		t.Fatal(err)
	}
	met(t, pooled)
	advanceDays(t, g, 1)
	audit(t, g)
	if g.Ledger.Of(ledger.Char(pooled.Poster), ledger.Material(fibre)) != had+pooled.Cond.Count {
		t.Fatal("the pooled goal's fibre never reached its poster")
	}
}

// preMM11aShows is nil when the save holds what it was made for.
func preMM11aShows(g *game.Game) error {
	if g.Story == nil || g.Story.Clock == nil || g.Story.Clock.N < 1 {
		return fmt.Errorf("the save keeps no season past season zero: %+v", g.Story)
	}
	trouble := func(a *game.Arc) bool {
		return a.Ended == 0 && slices.ContainsFunc(g.Rules().Book.Troubles, func(row sheets.TroubleRow) bool { return row.ID == a.Template })
	}
	if !slices.ContainsFunc(g.Story.Arcs, trouble) {
		return fmt.Errorf("no trouble runs in the save")
	}
	kept := slices.ContainsFunc(g.Goals, func(x *game.Goal) bool { return x.Why == "kept" && x.Cond.Verb == goal.Hold })
	other := slices.ContainsFunc(g.Goals, func(x *game.Goal) bool {
		return x.State == goal.Done && x.Poster != "" && slices.ContainsFunc(g.Chars, func(c *game.Char) bool { return c.C.ID != x.Poster && x.Progress.Get(c.C.ID) > 0 })
	})
	if !kept || !other {
		return fmt.Errorf("a vow kept: %v; a goal met by another than its poster: %v", kept, other)
	}
	known := 0
	for _, n := range g.NPCs.List {
		if len(n.Met) > 0 && len(n.Memory) > 0 {
			known++
		}
	}
	if known < 2 {
		return fmt.Errorf("%d saved NPCs met", known)
	}
	for _, c := range g.Chars {
		if c.C.Coin == 0 || len(c.C.Pack) == 0 {
			return fmt.Errorf("%s holds %d coin and %d items", c.C.ID, c.C.Coin, len(c.C.Pack))
		}
	}
	return nil
}

// unremarked is nil when a character carries no alignment state, which
// reads as 0.
func unremarked(c *game.Char) error {
	f := reflect.ValueOf(c.C).Elem().FieldByName("Alignment")
	if f.IsValid() && !f.IsNil() {
		return fmt.Errorf("%s loads with alignment %+v", c.C.ID, f.Interface())
	}
	b, err := jsonMap(c.C)
	if err != nil {
		return err
	}
	if v, ok := b["alignment"]; ok {
		return fmt.Errorf("%s encodes alignment %v", c.C.ID, v)
	}
	return nil
}

func jsonMap(v any) (map[string]any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	return out, json.Unmarshal(b, &out)
}

func settlementOf(g *game.Game, ref string) (int, bool) {
	for i := range g.Places {
		if ref == fmt.Sprintf("settlement:%d", i) {
			return i, true
		}
	}
	return 0, false
}

// baseFacts is a replay fixture's scene as the base recorded it and every
// fact the base wrote replaying it. The scene is a copy, so the check
// still replays the base's scene once a fixture is recorded again.
type baseFacts struct {
	Fixture  string          `json:"fixture"`
	Keys     string          `json:"keys"`
	Snapshot json.RawMessage `json:"snapshot"`
	Ticks    int64           `json:"ticks"`
	Commands []mm8Tick       `json:"commands"`
	Facts    []factLine      `json:"facts"`
}

// factLine is a fact without its id and causes, which shift whenever an
// earlier fact is added.
type factLine struct {
	Kind     string       `json:"kind"`
	Tick     int64        `json:"tick"`
	Subjects []fact.Ref   `json:"subjects"`
	Data     []fact.Datum `json:"data"`
}

// mm11aKinds are the fact kinds theft and alignment write; a world without
// thieves may still move alignment.
var mm11aKinds = []string{"alignment.moved", "theft.", "watch.", "fence.", "craft.laundered", "syndicate.", "character.betrayed", "den.moved"}

func mm11aKind(kind string) bool {
	return slices.ContainsFunc(mm11aKinds, func(p string) bool {
		if strings.HasSuffix(p, ".") {
			return strings.HasPrefix(kind, p)
		}
		return kind == p
	})
}

// factIDData are the data that hold a fact id.
var factIDData = map[string][]string{"goal.claimed": {"fact"}}

// baseKinds are the facts of kinds a world before theft and alignment
// wrote, with no fact ids in their data.
func baseKinds(lines []factLine) []factLine {
	var out []factLine
	for _, l := range lines {
		if mm11aKind(l.Kind) {
			continue
		}
		if drop := factIDData[l.Kind]; len(drop) > 0 {
			l.Data = slices.DeleteFunc(slices.Clone(l.Data), func(d fact.Datum) bool { return slices.Contains(drop, d.Key) })
		}
		out = append(out, l)
	}
	return out
}

// Every replay fixture's scene, replayed at HEAD, writes the facts the
// base wrote, apart from theft and alignment's kinds: no draw an earlier
// world made has moved.
func TestNoDrawMoved(t *testing.T) {
	for _, dir := range []string{"replay-mm8", "replay-mm8a", "replay-mm9", "replay-mm10"} {
		t.Run(dir, func(t *testing.T) {
			body, err := os.ReadFile("testdata/" + dir + "/base-facts.json")
			if err != nil {
				t.Fatal(err)
			}
			var bf baseFacts
			if err := json.Unmarshal(body, &bf); err != nil {
				t.Fatal(err)
			}
			r := testkit.Rules(t, testkit.Book(t), keys.Throwaway(bf.Keys))
			g := replayMM8(t, r, &mm8Fixture{Snapshot: bf.Snapshot, Ticks: bf.Ticks, Commands: bf.Commands})
			var lines []factLine
			for _, f := range g.Log.Since(0) {
				lines = append(lines, factLine{Kind: f.Kind, Tick: f.Tick, Subjects: f.Subjects, Data: f.Data})
			}
			got, want := baseKinds(lines), baseKinds(bf.Facts)
			for i := range max(len(got), len(want)) {
				if i >= len(got) || i >= len(want) || !reflect.DeepEqual(got[i], want[i]) {
					t.Fatalf("%s: fact %d of %d differs from the base's %d:\n head %s\n base %s", bf.Fixture, i, len(got), len(want), lineAt(got, i), lineAt(want, i))
				}
			}
			t.Logf("%s: %d facts as at the base, %d of MM11a's kinds", bf.Fixture, len(want), len(lines)-len(got))
		})
	}
}

func lineAt(lines []factLine, i int) string {
	if i >= len(lines) {
		return "(none)"
	}
	b, _ := json.Marshal(lines[i])
	return string(b)
}
