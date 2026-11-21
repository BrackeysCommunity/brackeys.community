package service_test

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/puzzle"
)

// seeing is a Local game on keys whose text forms are known, with a
// clock a test steps.
type seeing struct {
	t       *testing.T
	l       *service.Local
	g       *game.Game
	needles []string
	now     time.Time
	n       int
}

func newSeeing(t *testing.T) *seeing {
	t.Helper()
	sec, _ := testkit.Secrets(t, "mmo/see-master", "w-see")
	g, err := game.New(testkit.Rules(t, testkit.Book(t), sec.Keys))
	if err != nil {
		t.Fatal(err)
	}
	s := &seeing{t: t, l: service.NewLocal(g), g: g, needles: sec.Needles, now: time.UnixMilli(1_700_000_000_000)}
	s.l.Now = func() time.Time { return s.now }
	return s
}

func (s *seeing) create() *game.Char { return s.createIn("") }

// createIn makes a character who plays from a Discord server, whose guild
// runs the first settlement nobody does.
func (s *seeing) createIn(server string) *game.Char {
	s.t.Helper()
	s.n++
	rep, ref, err := s.l.Act(context.Background(), api.ActionRequest{InteractionID: "new-" + string(rune('a'+s.n)), DiscordID: "u-" + string(rune('a'+s.n)),
		Kind: api.ActCreate, Option: api.StartKnife, Server: server, Note: "Tinkers"})
	if err != nil || ref != nil {
		s.t.Fatal(ref, err)
	}
	return s.g.Char(rep.Character.ID)
}

func (s *seeing) act(c *game.Char, req api.ActionRequest) (api.ActionReply, *api.Refusal) {
	s.t.Helper()
	s.n++
	req.InteractionID, req.CharacterID, req.Version = "see-"+string(rune('a'+s.n%26))+string(rune('a'+s.n/26)), c.C.ID, c.Version
	rep, ref, err := s.l.Act(context.Background(), req)
	if err != nil {
		s.t.Fatal(err)
	}
	return rep, ref
}

func (s *seeing) view(c *game.Char, v api.Viewer) (api.ActivityState, string) {
	s.t.Helper()
	st := service.Filter(s.g, c, v, s.now)
	body, err := json.Marshal(st)
	if err != nil {
		s.t.Fatal(err)
	}
	return st, string(body)
}

func practise(c *game.Char, family string, level int64) {
	c.C.Practice = slices.DeleteFunc(c.C.Practice, func(s char.Skill) bool { return s.ID == family })
	c.C.Practice = append(c.C.Practice, char.Skill{ID: family, Level: level})
	slices.SortFunc(c.C.Practice, func(a, b char.Skill) int { return strings.Compare(a.ID, b.ID) })
}

// machineKeys are the keys a viewer's machine carries, as JSON.
func machineKeys(t *testing.T, body string) map[string]json.RawMessage {
	t.Helper()
	var st struct {
		Machine map[string]json.RawMessage `json:"machine"`
	}
	if err := json.Unmarshal([]byte(body), &st); err != nil {
		t.Fatal(err)
	}
	return st.Machine
}

// TestFilter shows two characters their own states and expects neither
// to hold anything of the other's, a key, or anything a machine is drawn
// from; and what practice buys to show only at the practice that buys it.
func TestFilter(t *testing.T) {
	s := newSeeing(t)
	g := s.g
	master, novice := s.create(), s.create()
	home := master.C.At
	away := home.Neighbour(0)
	for d := 0; !g.Rules().Gen.Passable(g.Rules().Gen.Baseline(away).Terrain); d++ {
		away = home.Neighbour(d)
	}

	// The master stands off, a pouch in hand, on an armed circuit.
	master.C.At = away
	practise(master, puzzle.Circuit, 16)
	master.Pouches = []game.Pouch{{ID: "p-" + master.C.ID + "-1", Hex: away, Family: puzzle.Pins, Level: 2, Tier: 1,
		Goods: []item.Spoil{{Material: g.Rules().Book.Materials[0].ID, Qty: 4}}}}
	testkit.MachineBeat(t, g, master, puzzle.Circuit, 3)
	if _, ref := s.act(master, api.ActionRequest{Kind: api.ActMachineArm, Machine: &api.MachineIntent{Source: api.MachineBeat}}); ref != nil {
		t.Fatal(ref)
	}
	// The novice is at the bench, a rewire open.
	testkit.AtBench(t, g, novice)
	look := api.Viewer{Family: puzzle.Rewire, Level: 2}

	mine, mineJSON := s.view(master, api.Viewer{})
	theirs, theirsJSON := s.view(novice, look)

	m := mine.Machine
	if m == nil || !m.Armed || m.Source != api.MachineBeat || m.Level != 3 || m.Countdown == 0 || m.Haywire == nil || len(m.Why) == 0 || m.Inner == nil || !m.CanPass {
		t.Fatalf("the master's armed machine: %+v", m)
	}
	if m.ArmedAt != s.now.UnixMilli() || m.Deadline != m.ArmedAt+m.Countdown || m.Grace != g.MachineGrace() || mine.Now != s.now.UnixMilli() {
		t.Fatalf("the countdown: armed at %d, deadline %d, countdown %d, grace %d", m.ArmedAt, m.Deadline, m.Countdown, m.Grace)
	}
	if len(m.Hints) != 2 || m.Guide == nil || m.Practice.Level != 16 || m.Practice.Title == "" {
		t.Fatalf("what mastery buys: %d hints, guide %v, practice %+v", len(m.Hints), m.Guide, m.Practice)
	}
	if mine.Bench != nil || len(mine.Pouches) != 1 || mine.Fight == nil || mine.Fight.Machine != puzzle.Circuit || mine.Context.ID != master.C.ID {
		t.Fatalf("the master's state: bench %v, pouches %v, fight %+v", mine.Bench, mine.Pouches, mine.Fight)
	}
	if !slices.Equal(mine.Character.Titles, []string{puzzle.Circuit}) || mine.Character.Pouches != 1 || !mine.Character.Armed {
		t.Fatalf("the master's character: %+v", mine.Character)
	}
	b := theirs.Machine
	if b == nil || b.Source != api.MachineBench || b.Armed || b.Level != 2 || b.Countdown != 0 || b.Haywire != nil || b.Inner != nil || b.Guide != nil || len(b.Hints) != 0 {
		t.Fatalf("the novice's bench rig: %+v", b)
	}
	if theirs.Bench == nil || len(theirs.Bench.Families) != len(g.Rules().Fight.P.All()) || theirs.Fight != nil || len(theirs.Pouches) != 0 || theirs.Place.Busy != 1 {
		t.Fatalf("the novice's state: bench %+v, busy %d", theirs.Bench, theirs.Place.Busy)
	}

	layout := func(l api.PuzzleLayout) string {
		body, _ := json.Marshal(l.Tiles)
		if len(l.Tiles) == 0 {
			body, _ = json.Marshal(l.Target)
		}
		return string(body)
	}
	at := func(h hex.Hex) string {
		body, _ := json.Marshal(api.Hex{Q: h.Q, R: h.R})
		return string(body)
	}
	for _, view := range []struct {
		who, body string
		other     *game.Char
		arrays    string
	}{
		{"the master", mineJSON, novice, layout(b.Layout)},
		{"the novice", theirsJSON, master, layout(m.Layout)},
	} {
		id := view.other.C.ID
		for _, bad := range []string{`"` + id + `"`, "e-" + id, "p-" + id, at(view.other.C.At), view.arrays} {
			if strings.Contains(view.body, bad) {
				t.Errorf("%s is shown %s of the other's", view.who, bad)
			}
		}
		for _, needle := range s.needles {
			if strings.Contains(view.body, needle) {
				t.Errorf("%s is shown a key", view.who)
			}
		}
		for _, bad := range []string{`"tile:`, `"floor:`, `"bench:`, `"pouch:`, `"spec"`, `"attempt"`, `"tier"`, `"tries"`, `"benchRuns"`} {
			if strings.Contains(view.body, bad) {
				t.Errorf("%s is shown %s, which a machine is drawn from", view.who, bad)
			}
		}
	}

	// At rest, practice decides what shows.
	rest := s.create()
	rest.C.At = away.Neighbour(1)
	for _, tc := range []struct {
		practice int64
		keys     []string
		hints    int
	}{
		{0, nil, 0},
		{1, nil, 0},
		{2, []string{"level", "countdown", "why", "haywire"}, 0},
		{6, []string{"level", "countdown", "why", "haywire", "hints"}, 1},
		{8, []string{"level", "countdown", "why", "haywire", "hints", "guide"}, 1},
		{12, []string{"level", "countdown", "why", "haywire", "hints", "guide"}, 2},
		{16, []string{"level", "countdown", "why", "haywire", "hints", "guide", "inner"}, 2},
	} {
		practise(rest, puzzle.Signal, tc.practice)
		testkit.MachineBeat(t, g, rest, puzzle.Signal, 4)
		st, body := s.view(rest, api.Viewer{})
		keys := machineKeys(t, body)
		for _, k := range []string{"level", "countdown", "why", "haywire", "hints", "guide", "inner", "armedAt", "deadline", "canPass"} {
			if _, has := keys[k]; has != slices.Contains(tc.keys, k) {
				t.Errorf("at practice %d and at rest, %q shown is %v", tc.practice, k, has)
			}
		}
		if st.Machine.Armed || st.Machine.Preview != (tc.practice >= 2) || len(st.Machine.Hints) != tc.hints {
			t.Errorf("at practice %d: %+v", tc.practice, st.Machine)
		}
	}

	// The opening Rewire is shown as what it will be, before it is armed.
	rest.Worked = 0
	practise(rest, puzzle.Signal, 0)
	if st, _ := s.view(rest, api.Viewer{Compact: true}); !st.Machine.Intro || st.Machine.Family != puzzle.Rewire || st.Fight.Machine != puzzle.Rewire || !st.Machine.Compact {
		t.Fatalf("a first machine: %+v", st.Machine)
	}

	// A tile nobody has found is not shown; the one stood on is.
	far := hex.Hex{Q: home.Q + 500, R: home.R}
	if service.Sees(g, novice, far) || !service.Sees(g, novice, novice.C.At) || !service.Sees(g, master, away) {
		t.Fatal("what a viewer may be shown of the map")
	}
	facts := service.SeenFacts(novice.C.ID, []api.Fact{{Kind: "lesson.taken", Subjects: []api.Ref{{Kind: "character", ID: novice.C.ID}, {Kind: "character", ID: master.C.ID}, {Kind: "guild", ID: "g-1"}}}})
	if len(facts) != 1 || len(facts[0].Subjects) != 2 || facts[0].Subjects[0].ID != novice.C.ID || facts[0].Subjects[1].Kind != "guild" {
		t.Fatalf("a fact as its viewer may read it: %+v", facts)
	}
}

// TestLocalHost drives the Activity's side of a Local game: who plays
// whom, the view, the countdown the service's clock keeps, the expiry
// that names no row version, and who is told of each write.
func TestLocalHost(t *testing.T) {
	ctx := context.Background()
	s := newSeeing(t)
	g := s.g
	host := s.l.Host()
	var told [][]string
	host.Subscribe(func(ids []string) { told = append(told, ids) })
	c := s.create()
	if id, err := host.CharacterOf(ctx, "u-b"); err != nil || id != c.C.ID {
		t.Fatalf("u-b plays %q: %v", id, err)
	}
	if id, _ := host.CharacterOf(ctx, "nobody"); id != "" {
		t.Fatalf("nobody plays %q", id)
	}
	if len(told) != 1 || !slices.Equal(told[0], []string{c.C.ID}) {
		t.Fatalf("after a create the listener heard %v", told)
	}
	if _, ok, _ := host.View(ctx, "c-none", api.Viewer{}); ok {
		t.Fatal("a view of nobody")
	}
	testkit.MachineBeat(t, g, c, puzzle.Rewire, 2)
	st, ok, err := host.View(ctx, c.C.ID, api.Viewer{})
	if err != nil || !ok || st.Machine == nil || st.Machine.Armed {
		t.Fatalf("the view at rest: %+v %v", st.Machine, err)
	}
	wires := st.Machine.Layout.Target
	armReq := api.ActionRequest{InteractionID: "act-arm-1", CharacterID: c.C.ID, DiscordID: "u-b", Version: c.Version + 7, Kind: api.ActMachineArm,
		Machine: &api.MachineIntent{Source: api.MachineBeat}}
	if _, ref, _ := host.Act(ctx, armReq, true); ref == nil || ref.Code != api.CodeStale {
		t.Fatalf("an intent on a stale version: %+v", ref)
	}
	armReq.Version = c.Version
	if _, ref, err := host.Act(ctx, armReq, true); ref != nil || err != nil {
		t.Fatal(ref, err)
	}
	heard := len(told)
	if again, _, _ := host.Act(ctx, armReq, true); !again.Duplicate || len(told) != heard {
		t.Fatalf("a resent intent: %+v, and the listener heard %d more", again, len(told)-heard)
	}
	armedAt := s.now.UnixMilli()
	if c.Armed == nil || c.Armed.At != armedAt {
		t.Fatalf("armed on the service's clock: %+v", c.Armed)
	}
	list, _ := host.Armed(ctx)
	if len(list) != 1 || list[0].CharacterID != c.C.ID || list[0].Deadline != armedAt+c.Armed.Countdown+g.MachineGrace() {
		t.Fatalf("countdowns running: %+v", list)
	}

	// The player's own log, in time.
	log := &api.PuzzleLog{}
	for w, port := range wires {
		log.Moves = append(log.Moves, api.PuzzleMove{At: int64(w+1) * 300, A: int64(w), B: port})
	}
	s.now = s.now.Add(3 * time.Second)
	rep, ref, err := host.Act(ctx, api.ActionRequest{InteractionID: "act-solve-1", CharacterID: c.C.ID, Version: c.Version, Kind: api.ActMachineSolve,
		Machine: &api.MachineIntent{Log: log}}, true)
	if err != nil || ref != nil || rep.Machine == nil || !rep.Machine.Solved || !rep.Machine.Clean || rep.Character.Armed {
		t.Fatalf("a solve in time: %+v %v %v", rep.Machine, ref, err)
	}
	if list, _ := host.Armed(ctx); len(list) != 0 {
		t.Fatalf("still counting down: %+v", list)
	}

	// A machine on the clock, solved by the kit's own log as a client
	// sends it.
	testkit.MachineBeat(t, g, c, "crank", 3)
	rig, _ := g.Rig(c, game.Viewer{Compact: true})
	crank := service.LogOf(g.Rules().Fight.P.Solve(rig.Layout))
	armReq.InteractionID, armReq.Version, armReq.Machine.Compact = "act-arm-crank", c.Version, true
	if _, ref, err := host.Act(ctx, armReq, true); ref != nil || err != nil {
		t.Fatal(ref, err)
	}
	s.now = s.now.Add(time.Duration(max(crank.End, crank.Moves[len(crank.Moves)-1].At)+150) * time.Millisecond)
	rep, ref, err = host.Act(ctx, api.ActionRequest{InteractionID: "act-solve-crank", CharacterID: c.C.ID, Version: c.Version, Kind: api.ActMachineSolve,
		Machine: &api.MachineIntent{Log: crank}}, true)
	solved := slices.IndexFunc(rep.Facts, func(f api.Fact) bool { return f.Kind == "puzzle.solved" })
	if err != nil || ref != nil || !rep.Machine.Solved || solved < 0 {
		t.Fatalf("a crank wound in time: %+v %v %v", rep.Machine, ref, err)
	}
	if !slices.ContainsFunc(rep.Facts[solved].Data, func(d api.Datum) bool { return d.Key == "compact" && d.N == 1 }) {
		t.Fatalf("the fact does not say the machine was compact: %+v", rep.Facts[solved].Data)
	}
	armReq.Machine.Compact = false

	// Walking away: the expiry is the service's own write, with no row
	// version, and haywires whatever it carries.
	testkit.MachineBeat(t, g, c, puzzle.Rewire, 2)
	armReq.InteractionID, armReq.Version = "act-arm-2", c.Version
	if _, ref, err := host.Act(ctx, armReq, true); ref != nil || err != nil {
		t.Fatal(ref, err)
	}
	list, _ = host.Armed(ctx)
	s.now = time.UnixMilli(list[0].Deadline + 250)
	expire := api.ActionRequest{InteractionID: "mx-" + c.C.ID + "-1", CharacterID: c.C.ID, Kind: api.ActMachineSolve}
	rep, ref, err = host.Act(ctx, expire, false)
	if err != nil || ref != nil || rep.Machine.Solved || !rep.Machine.Late || rep.Machine.Haywire == "" {
		t.Fatalf("the expiry: %+v %v %v", rep.Machine, ref, err)
	}
	st, _, _ = host.View(ctx, c.C.ID, api.Viewer{})
	if st.Last == nil || st.Last.Result.Haywire == "" || !st.Last.Result.Late || st.Machine == nil || st.Machine.Armed {
		t.Fatalf("after the countdown ran out: last %+v, machine %+v", st.Last, st.Machine)
	}
	expire.InteractionID = "mx-" + c.C.ID + "-2"
	before, _ := g.Digest()
	if _, ref, _ := host.Act(ctx, expire, false); ref == nil || ref.Code != api.CodeNoMachine {
		t.Fatalf("an expiry after the machine ended: %+v", ref)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatal("a refused expiry changed the game")
	}

	// A tick is told as anyone's; a lesson moves its teacher's row too.
	heard = len(told)
	if err := s.l.Advance(); err != nil {
		t.Fatal(err)
	}
	if len(told) != heard+1 || told[heard] != nil {
		t.Fatalf("after a tick the listener heard %v", told[heard:])
	}
	teacher, learner := s.createIn("server-1"), s.createIn("server-1")
	testkit.AtBench(t, g, learner)
	testkit.AtBench(t, g, teacher)
	practise(teacher, puzzle.Rewire, 16)
	guild := g.Places[0].Guild
	if guild == "" {
		t.Fatal("nobody runs the first settlement")
	}
	st, _, _ = host.View(ctx, teacher.C.ID, api.Viewer{Family: puzzle.Rewire, Level: 1})
	log = &api.PuzzleLog{}
	for w, port := range st.Machine.Layout.Target {
		log.Moves = append(log.Moves, api.PuzzleMove{At: int64(w+1) * 300, A: int64(w), B: port})
	}
	rep, ref = s.act(teacher, api.ActionRequest{Kind: api.ActBenchSolve, Machine: &api.MachineIntent{Family: puzzle.Rewire, Level: 1, Teach: true, Log: log}})
	if ref != nil || !rep.Machine.Solved {
		t.Fatalf("the teacher's bench solve: %+v %v", rep.Machine, ref)
	}
	if st, _, _ := host.View(ctx, learner.C.ID, api.Viewer{}); st.Bench == nil || st.Bench.Families[slices.IndexFunc(st.Bench.Families, func(f api.BenchFamily) bool { return f.Family == puzzle.Rewire })].Lessons != 1 {
		t.Fatalf("the learner's bench: %+v", st.Bench)
	}
	if st, _, _ := host.View(ctx, teacher.C.ID, api.Viewer{}); st.Bench.Given != 1 || st.Bench.Families[0].Lessons != 0 {
		t.Fatalf("the teacher's bench: %+v", st.Bench)
	}
	heard = len(told)
	if _, ref := s.act(learner, api.ActionRequest{Kind: api.ActBenchLesson, Machine: &api.MachineIntent{Family: puzzle.Rewire}}); ref != nil {
		t.Fatal(ref)
	}
	if len(told) != heard+1 || !slices.Equal(told[heard], []string{learner.C.ID, teacher.C.ID}) {
		t.Fatalf("after a lesson the listener heard %v, want the learner and the teacher", told[heard:])
	}
	if teacher.C.GuildStanding.Get(guild) == 0 {
		t.Fatal("the teacher gained no standing")
	}
}
