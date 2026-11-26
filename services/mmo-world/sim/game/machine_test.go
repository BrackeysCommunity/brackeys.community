package game_test

import (
	"encoding/json"
	"errors"
	"slices"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// bench is a fresh game with one character, and the commands given to it.
type bench struct {
	t    *testing.T
	g    *game.Game
	c    *game.Char
	n    int
	cmds []game.Command
}

func newBench(t *testing.T) *bench {
	t.Helper()
	g, err := game.New(rules(t))
	if err != nil {
		t.Fatal(err)
	}
	b := &bench{t: t, g: g}
	b.c = b.create("")
	return b
}

func (b *bench) create(server string) *game.Char {
	b.t.Helper()
	b.n++
	res, err := b.g.Act(game.Command{Key: "new-" + string(rune('a'+b.n)), Kind: game.Create, Option: "knife", Server: server, Note: "Tinkers"})
	if err != nil {
		b.t.Fatal(err)
	}
	return res.Char
}

// do gives a command for a character and keeps it; a refusal comes back.
func (b *bench) do(c *game.Char, cmd game.Command) (game.Result, *game.Refused) {
	b.t.Helper()
	b.n++
	cmd.Key, cmd.Char = "m-"+string(rune('a'+b.n%26))+string(rune('a'+b.n/26)), c.C.ID
	res, err := b.g.Act(cmd)
	var ref *game.Refused
	if errors.As(err, &ref) {
		return res, ref
	}
	if err != nil {
		b.t.Fatal(err)
	}
	b.cmds = append(b.cmds, cmd)
	return res, nil
}

// must gives a command the rules must accept.
// tick runs the world's next tick.
func (b *bench) tick() {
	b.t.Helper()
	if _, err := b.g.Advance(); err != nil {
		b.t.Fatal(err)
	}
}

func (b *bench) must(c *game.Char, cmd game.Command) game.Result {
	b.t.Helper()
	res, ref := b.do(c, cmd)
	if ref != nil {
		b.t.Fatalf("%s: %v", cmd.Kind, ref)
	}
	return res
}

func (b *bench) rig(c *game.Char, v game.Viewer) game.Rig {
	b.t.Helper()
	rig, ok := b.g.Rig(c, v)
	if !ok {
		b.t.Fatalf("%s has no machine to work", c.C.ID)
	}
	return rig
}

// solving is the kit's own solve of a rig, as a client would send it.
func (b *bench) solving(rig game.Rig) *puzzle.Log {
	log := b.g.Puzzles().Solve(rig.Layout)
	return &log
}

func (b *bench) audit() {
	b.t.Helper()
	if problems := ledger.Audit(b.g.Ledger.Balances(), b.g.Holdings()); len(problems) > 0 {
		b.t.Fatal(problems)
	}
}

func arm(source string) game.Command {
	return game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: source}}
}

func solve(log *puzzle.Log) game.Command {
	return game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Log: log}}
}

func kindOf(facts []fact.Fact, kind string) *fact.Fact {
	i := slices.IndexFunc(facts, func(f fact.Fact) bool { return f.Kind == kind })
	if i < 0 {
		return nil
	}
	return &facts[i]
}

func datum(f *fact.Fact, key string) (fact.Datum, bool) {
	i := slices.IndexFunc(f.Data, func(d fact.Datum) bool { return d.Key == key })
	if i < 0 {
		return fact.Datum{}, false
	}
	return f.Data[i], true
}

// structural: the service's clock when a test arms a machine.
const armedAt = 1_700_000_000_000

// TestMachineSolvePays arms the machine on a beat and plays the kit's own
// solve: one puzzle.solved fact, the beat's haul, and practice in the
// family.
func TestMachineSolvePays(t *testing.T) {
	for _, family := range []string{puzzle.Circuit, puzzle.Pins, "pressure", "splice"} {
		b := newBench(t)
		testkit.MachineBeat(t, b.g, b.c, family, 2)
		rig := b.rig(b.c, game.Viewer{})
		if rig.Spec.Family != family || rig.Armed != nil || rig.Countdown == 0 {
			t.Fatalf("%s at rest: %+v", family, rig.Spec)
		}
		a := arm(game.SourceBeat)
		a.Now = armedAt
		res := b.must(b.c, a)
		if kindOf(res.Facts, "machine.armed") == nil || b.c.Armed == nil || b.c.Armed.Countdown != rig.Countdown || b.c.Armed.At != armedAt {
			t.Fatalf("%s armed: %+v, facts %+v", family, b.c.Armed, res.Facts)
		}
		before := b.c.Carried()
		log := b.solving(rig)
		s := solve(log)
		s.Now = armedAt + log.Stop() + 300
		res = b.must(b.c, s)
		f := kindOf(res.Facts, "puzzle.solved")
		if res.Machine == nil || !res.Machine.Solved || !res.Machine.Clean || f == nil || len(res.Pressed) != 1 || !res.Pressed[0].Outcome.Success {
			t.Fatalf("%s solved: %+v, facts %+v", family, res.Machine, res.Facts)
		}
		if ms, ok := datum(f, "ms"); !ok || ms.N != res.Machine.At {
			t.Fatalf("%s: the fact carries %v ms, the solve was at %d", family, ms, res.Machine.At)
		}
		if n := countKind(res.Facts, "puzzle.solved") + countKind(res.Facts, "puzzle.haywire"); n != 1 {
			t.Fatalf("%s: %d facts for one machine", family, n)
		}
		if b.c.Armed != nil || b.c.Fight != nil || b.c.LastMachine == nil || !b.c.LastMachine.Result.Solved {
			t.Fatalf("%s: after the solve armed %v, fight %v, last %+v", family, b.c.Armed, b.c.Fight, b.c.LastMachine)
		}
		if got := b.c.Carried() - before; got <= 0 {
			t.Fatalf("%s: the solved beat paid %d goods", family, got)
		}
		if sk := b.c.C.PracticeOf(family); sk.Uses != b.g.Puzzles().Param("live-solve-uses") {
			t.Fatalf("%s: %d uses from a live solve", family, sk.Uses)
		}
		b.audit()
	}
}

func countKind(facts []fact.Fact, kind string) int {
	n := 0
	for _, f := range facts {
		if f.Kind == kind {
			n++
		}
	}
	return n
}

// TestMachineLateAndEmpty holds a countdown to the service's clock: a log
// that solves the machine but arrives after the countdown and its grace
// is a late haywire, an empty one a haywire, and a solve claimed early
// but sent near the end is not clean.
func TestMachineLateAndEmpty(t *testing.T) {
	b := newBench(t)
	p := b.g.Puzzles()
	armNow := func() game.Rig {
		// A place whose machine haywired is shut until the next tick.
		b.tick()
		testkit.MachineBeat(t, b.g, b.c, puzzle.Signal, 1)
		rig := b.rig(b.c, game.Viewer{})
		a := arm(game.SourceBeat)
		a.Now = armedAt
		b.must(b.c, a)
		return rig
	}
	rig := armNow()
	s := solve(b.solving(rig))
	s.Now = armedAt + rig.Countdown + b.g.Puzzles().Grace() + 1
	res := b.must(b.c, s)
	f := kindOf(res.Facts, "puzzle.haywire")
	if res.Machine.Solved || !res.Machine.Late || res.Machine.Haywire == "" || f == nil {
		t.Fatalf("a late log: %+v", res.Machine)
	}
	if late, _ := datum(f, "late"); late.N != 1 {
		t.Fatalf("the haywire fact does not say it was late: %+v", f.Data)
	}
	if b.c.Armed != nil || b.c.Fight == nil || b.c.Fight.E.Press != 1 {
		t.Fatalf("after a haywire on the last beat: armed %v, fight %+v", b.c.Armed, b.c.Fight)
	}
	if sk := b.c.C.PracticeOf(puzzle.Signal); sk.Uses != p.Param("haywire-uses") {
		t.Fatalf("%d uses from a haywire", sk.Uses)
	}

	armNow()
	s = solve(&puzzle.Log{})
	s.Now = armedAt + 900
	if res = b.must(b.c, s); res.Machine.Solved || res.Machine.Late || kindOf(res.Facts, "puzzle.haywire") == nil {
		t.Fatalf("an empty log: %+v", res.Machine)
	}

	// A log whose stamps run past what the service's clock allows stops
	// where the clock does: the client cannot have played those moves yet.
	rig = armNow()
	s = solve(b.solving(rig))
	for i := range s.Machine.Log.Moves {
		s.Machine.Log.Moves[i].At += 60_000
	}
	s.Now = armedAt + 500
	if res = b.must(b.c, s); res.Machine.Solved {
		t.Fatalf("moves stamped a minute ahead of the clock: %+v", res.Machine)
	}

	rig = armNow()
	s = solve(b.solving(rig))
	s.Now = armedAt + rig.Countdown - 1
	if res = b.must(b.c, s); !res.Machine.Solved || res.Machine.Clean {
		t.Fatalf("a solve sent as the countdown ran out: %+v", res.Machine)
	}
}

// TestMachineCommandsReplay gives the commands one game took, as the
// store keeps them, to a fresh game: the same facts and the same digest.
func TestMachineCommandsReplay(t *testing.T) {
	play := func(given []game.Command) (*bench, []fact.Fact) {
		b := newBench(t)
		var facts []fact.Fact
		next := 0
		step := func(cmd game.Command) {
			if given != nil {
				cmd = given[next]
				next++
				res, err := b.g.Act(cmd)
				if err != nil {
					t.Fatal(err)
				}
				facts = append(facts, res.Facts...)
				return
			}
			facts = append(facts, b.must(b.c, cmd).Facts...)
		}
		for i, family := range []string{puzzle.Rewire, "crank", puzzle.Maze, "leak"} {
			testkit.MachineBeat(t, b.g, b.c, family, int64(1+i))
			rig := b.rig(b.c, game.Viewer{Compact: i%2 == 1})
			a := arm(game.SourceBeat)
			a.Machine.Compact, a.Now = i%2 == 1, armedAt+int64(i)*100_000
			step(a)
			log := b.solving(rig)
			if i == 1 {
				log.Moves, log.End = log.Moves[:len(log.Moves)/2], 0
			}
			s := solve(log)
			s.Now = a.Now + log.Stop() + 200
			if i == 3 {
				s.Now = a.Now + rig.Countdown + 10_000
			}
			step(s)
			b.c.Fight = nil
			if _, err := b.g.Advance(); err != nil {
				t.Fatal(err)
			}
		}
		return b, facts
	}
	first, facts := play(nil)
	stored, err := json.Marshal(first.cmds)
	if err != nil {
		t.Fatal(err)
	}
	var cmds []game.Command
	if err := json.Unmarshal(stored, &cmds); err != nil {
		t.Fatal(err)
	}
	second, again := play(cmds)
	d1, _ := first.g.Digest()
	d2, _ := second.g.Digest()
	if d1 != d2 {
		t.Fatalf("the replayed commands gave digest %s, the first run %s", d2, d1)
	}
	a, _ := json.Marshal(facts)
	bb, _ := json.Marshal(again)
	if string(a) != string(bb) || countKind(facts, "puzzle.solved") != 2 || countKind(facts, "puzzle.haywire") != 2 {
		t.Fatalf("the replay's facts differ, or the run was not two solves and two haywires:\n%s\n%s", a, bb)
	}
}

// TestMachineRefusalsChangeNothing gives every machine command a reason
// to be refused and expects the game exactly as it was.
func TestMachineRefusalsChangeNothing(t *testing.T) {
	b := newBench(t)
	g, c := b.g, b.c
	refused := func(why string, cmd game.Command, code string) {
		t.Helper()
		before, _ := g.Digest()
		pending := len(g.Pending)
		_, ref := b.do(c, cmd)
		if ref == nil || ref.Code != code {
			t.Fatalf("%s: %v, want %s", why, ref, code)
		}
		if after, _ := g.Digest(); after != before || len(g.Pending) != pending {
			t.Fatalf("%s was refused but changed the game", why)
		}
	}
	benchCmd := func(kind, family string, level int64) game.Command {
		return game.Command{Kind: kind, Machine: &game.MachineCmd{Family: family, Level: level, Log: &puzzle.Log{}}}
	}
	testkit.AtBench(t, g, c)
	refused("arming with no machine named", game.Command{Kind: game.MachineArm}, game.BadArgs)
	refused("arming a beat outside an encounter", arm(game.SourceBeat), game.NoMachine)
	refused("arming a bench", arm(game.SourceBench), game.BadArgs)
	refused("arming a pouch never found", game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourcePouch, Pouch: "p-c-1-9"}}, game.NoMachine)
	refused("solving with nothing armed", solve(&puzzle.Log{}), game.NoMachine)
	refused("a bench machine nobody makes", benchCmd(game.BenchSolve, "no-such", 1), game.BadArgs)
	refused("a bench level of 0", benchCmd(game.BenchSolve, puzzle.Rewire, 0), game.BadArgs)
	refused("a bench level past the top", benchCmd(game.BenchSolve, puzzle.Rewire, 4), game.BadArgs)
	refused("a bench command naming nothing", game.Command{Kind: game.BenchSolve}, game.BadArgs)
	refused("a lesson nobody left", benchCmd(game.BenchLesson, puzzle.Rewire, 0), game.NoLesson)
	refused("a lesson in no family", benchCmd(game.BenchLesson, "no-such", 0), game.BadArgs)

	home := c.C.At
	c.C.At = home.Neighbour(0)
	refused("a bench solve away from a bench", benchCmd(game.BenchSolve, puzzle.Rewire, 1), game.NotHere)
	refused("a lesson away from a bench", benchCmd(game.BenchLesson, puzzle.Rewire, 0), game.NotHere)
	c.C.At = home

	testkit.MachineBeat(t, g, c, puzzle.Circuit, 1)
	refused("a bench solve in an encounter", benchCmd(game.BenchSolve, puzzle.Rewire, 1), game.Busy)
	opts := g.Choose(c).Fight.Options
	hack := opts[slices.IndexFunc(opts, func(o fight.Option) bool { return o.Puzzle })].ID
	refused("pressing the machine's option", game.Command{Kind: game.Press, Option: hack}, game.InActivity)
	c.C.Set(char.Down, 0)
	refused("arming while down", arm(game.SourceBeat), game.DownCode)
	c.C.Clear(char.Down)
	place := b.rig(c, game.Viewer{}).Spec.Place
	c.Lockdowns = []game.Lockdown{{Place: place, Until: g.Tick() + 5}}
	refused("arming a locked-down machine", arm(game.SourceBeat), game.LockedDown)
	c.Lockdowns = nil

	b.must(c, arm(game.SourceBeat))
	for _, cmd := range []game.Command{
		arm(game.SourceBeat), {Kind: game.Press, Option: "back-out"}, {Kind: game.Step}, {Kind: game.Rest}, {Kind: game.Look},
		benchCmd(game.BenchSolve, puzzle.Rewire, 1), benchCmd(game.BenchLesson, puzzle.Rewire, 0), {Kind: game.Explore},
	} {
		refused(cmd.Kind+" with a machine armed", cmd, game.MachineArmed)
	}
	if _, err := g.Act(game.Command{Key: "op-1", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Coin, Units: 3, Note: "an operator still may"}); err != nil {
		t.Fatalf("an operator's correction with a machine armed: %v", err)
	}
	// An ambush's default waits too: the tick leaves the armed beat alone.
	c.Fight.Ambush, c.Fight.Due = true, g.Tick()
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	if c.Fight == nil || c.Armed == nil {
		t.Fatal("a tick resolved an armed machine's beat")
	}
	b.must(c, solve(&puzzle.Log{}))
	if c.Armed != nil {
		t.Fatal("still armed after its log")
	}
	// A ban ends the encounter and the countdown with it. The machine that
	// just haywired is shut until the next tick.
	c.Fight.Ambush = false
	b.tick()
	b.must(c, arm(game.SourceBeat))
	if _, err := g.Act(game.Command{Key: "op-2", Char: c.C.ID, Kind: game.Ban, Note: "test"}); err != nil || c.Armed != nil || c.Fight != nil {
		t.Fatalf("a ban with a machine armed: %v, armed %v", err, c.Armed)
	}
}

// TestOpeningRewire gives a character who has never armed a machine a
// first-level Rewire on its first Puzzle beat, whose haywire only shakes;
// the second machine is whatever the encounter drew.
func TestOpeningRewire(t *testing.T) {
	b := newBench(t)
	g, c := b.g, b.c
	p := g.Puzzles()
	testkit.MachineBeat(t, g, c, puzzle.Pins, 3)
	c.Worked = 0
	if rig := b.rig(c, game.Viewer{}); rig.Intro || rig.Spec.Family != puzzle.Pins {
		t.Fatalf("a lock is never the opening machine: %+v", rig.Spec)
	}
	testkit.MachineBeat(t, g, c, puzzle.Circuit, 3)
	c.Worked = 0
	rig := b.rig(c, game.Viewer{})
	if !rig.Intro || rig.Spec.Family != puzzle.Rewire || rig.Spec.Level != 1 || rig.Layout.Size != p.Param("intro-wires") || rig.Haywire != p.Intro() {
		t.Fatalf("the first machine: %+v, %d wires, haywire %s", rig.Spec, rig.Layout.Size, rig.Haywire)
	}
	if e := c.Fight.E; e.Machines[0] != puzzle.Circuit || e.Levels[0] != 3 {
		t.Fatal("looking at the opening machine changed the encounter")
	}
	b.must(c, arm(game.SourceBeat))
	if e := c.Fight.E; !c.Armed.Intro || e.Machines[0] != puzzle.Rewire || e.Levels[0] != 1 || c.Worked != 1 {
		t.Fatalf("armed %+v on %v", c.Armed, e.Machines)
	}
	pending := len(g.Pending)
	res := b.must(c, solve(&puzzle.Log{}))
	row := p.HaywireRow(p.Intro())
	// The jolt shuts nothing for a day, but no machine is tried twice in a
	// tick.
	shut := game.Lockdown{Place: rig.Spec.Place, Until: g.Tick() + 1}
	if res.Machine.Haywire != p.Intro() || len(c.Lockdowns) != 1 || c.Lockdowns[0] != shut || len(g.Pending) != pending {
		t.Fatalf("the opening haywire: %+v, lockdowns %v", res.Machine, c.Lockdowns)
	}
	if !slices.ContainsFunc(c.Fight.E.States, func(s fight.State) bool { return string(s.Tag) == row.Tag && s.Who == c.C.ID }) {
		t.Fatalf("the jolt left no %s: %+v", row.Tag, c.Fight.E.States)
	}
	if rig := b.rig(c, game.Viewer{}); rig.Intro || rig.Haywire == p.Intro() || rig.Spec.Attempt != 1 {
		t.Fatalf("the second try: %+v, haywire %s", rig.Spec, rig.Haywire)
	}
}

// TestOperatorSetsAMachine stands a character before a machine of the
// operator's choosing: the opening Rewire still comes first, the asked
// machine after it, and a refusal changes nothing.
func TestOperatorSetsAMachine(t *testing.T) {
	b := newBench(t)
	g, c := b.g, b.c
	set := func(family string, level int64, note string) game.Command {
		return game.Command{Kind: game.SetMachine, Asset: family, Units: level, Note: note}
	}
	for why, cmd := range map[string]game.Command{
		"no note": set(puzzle.Crank, 2, ""), "no such family": set("no-such", 2, "rehearsal"),
		"level 0": set(puzzle.Crank, 0, "rehearsal"), "a level the world never draws": set(puzzle.Crank, 99, "rehearsal"),
	} {
		before, _ := g.Digest()
		if _, ref := b.do(c, cmd); ref == nil || ref.Code != game.BadArgs {
			t.Fatalf("%s: %v", why, ref)
		}
		if after, _ := g.Digest(); after != before {
			t.Fatalf("%s was refused but changed the game", why)
		}
	}
	res := b.must(c, set(puzzle.Crank, 2, "rehearsal"))
	if kindOf(res.Facts, "machine.set") == nil || c.Fight == nil || c.Worked != 0 {
		t.Fatalf("the operator's machine: %+v, worked %d", res.Facts, c.Worked)
	}
	if rig := b.rig(c, game.Viewer{}); !rig.Intro || rig.Spec.Family != puzzle.Rewire {
		t.Fatalf("a first machine that is not the opening Rewire: %+v", rig.Spec)
	}
	before, _ := g.Digest()
	if _, ref := b.do(c, set(puzzle.Leak, 1, "rehearsal")); ref == nil || ref.Code != game.Busy {
		t.Fatalf("a second machine over an open encounter: %v", ref)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatal("a refused machine changed the game")
	}
	cmd := arm(game.SourceBeat)
	cmd.Now = armedAt
	b.must(c, cmd)
	if _, ref := b.do(c, set(puzzle.Leak, 1, "rehearsal")); ref == nil || ref.Code != game.Busy {
		t.Fatalf("a machine set over an armed one: %v", ref)
	}
	log := b.solving(b.rig(c, game.Viewer{}))
	cmd = solve(log)
	cmd.Now = armedAt + log.Stop()
	if res := b.must(c, cmd); !res.Machine.Solved || c.Fight != nil {
		t.Fatalf("the opening Rewire, solved: %+v", res.Machine)
	}
	b.must(c, set(puzzle.Crank, 2, "rehearsal"))
	if rig := b.rig(c, game.Viewer{}); rig.Intro || rig.Spec.Family != puzzle.Crank || rig.Spec.Level != 2 {
		t.Fatalf("the asked machine: %+v", rig.Spec)
	}
	b.audit()
}

// TestHaywireReachesTheWorld fails a machine that sounds an alarm and one
// that locks down: the alarm raises the region's threat at the next tick,
// the lockdown refuses the place's machines for its days.
func TestHaywireReachesTheWorld(t *testing.T) {
	b := newBench(t)
	g, c := b.g, b.c
	p := g.Puzzles()
	seen := map[string]bool{}
	for _, family := range []string{"pressure", puzzle.Maze} {
		testkit.MachineBeat(t, g, c, family, 1)
		rig := b.rig(c, game.Viewer{})
		row := p.HaywireRow(rig.Haywire)
		g.World.Regions[g.World.RegionAt(c.C.At)].Gauge[g.World.GaugeIndex("threat")] = 100
		threat, _ := g.World.GaugeAt(c.C.At, "threat")
		b.must(c, arm(game.SourceBeat))
		res := b.must(c, solve(&puzzle.Log{}))
		if res.Machine.Haywire != rig.Haywire {
			t.Fatalf("the haywire shown was %s, the one that came %s", rig.Haywire, res.Machine.Haywire)
		}
		seen[row.Effect] = true
		switch row.Effect {
		case "alarm":
			if n := len(g.Pending); n == 0 || g.Pending[n-1].Kind != world.ActAlarm || g.Pending[n-1].Units != row.Magnitude {
				t.Fatalf("no alarm pending: %+v", g.Pending)
			}
			if _, err := g.Advance(); err != nil {
				t.Fatal(err)
			}
			if after, _ := g.World.GaugeAt(c.C.At, "threat"); after != threat+row.Magnitude {
				t.Fatalf("threat %d after an alarm of %d, %d before", after, row.Magnitude, threat)
			}
		case "lockdown":
			want := game.Lockdown{Place: rig.Spec.Place, Until: g.Tick() + row.Magnitude*sheets.TicksPerDay}
			if len(c.Lockdowns) != 1 || c.Lockdowns[0] != want {
				t.Fatalf("lockdowns %+v, want %+v", c.Lockdowns, want)
			}
			if rig := b.rig(c, game.Viewer{}); rig.Locked != row.Magnitude*sheets.TicksPerDay {
				t.Fatalf("locked for %d ticks", rig.Locked)
			}
			if _, ref := b.do(c, arm(game.SourceBeat)); ref == nil || ref.Code != game.LockedDown {
				t.Fatalf("arming a locked-down machine: %v", ref)
			}
			c.Lockdowns[0].Until = g.Tick()
			b.must(c, arm(game.SourceBeat))
			if len(c.Lockdowns) != 0 {
				t.Fatalf("a lifted lockdown is still kept: %+v", c.Lockdowns)
			}
			b.must(c, solve(&puzzle.Log{}))
		}
	}
	if !seen["alarm"] || !seen["lockdown"] {
		t.Fatalf("the two machines gave %v", seen)
	}
}

// TestHaywireOnceATick fails the machine on a final beat and tries it
// again inside the same tick: the second arming is refused, so the place
// pays one haywire's practice a tick, and one character's alarms on one
// tile are one alarm however the second failure came about.
func TestHaywireOnceATick(t *testing.T) {
	b := newBench(t)
	g, c := b.g, b.c
	p := g.Puzzles()
	testkit.MachineBeat(t, g, c, "pressure", 1)
	if row := p.HaywireRow(b.rig(c, game.Viewer{}).Haywire); row.Effect != puzzle.EffectAlarm {
		t.Fatalf("pressure's haywire is %s, not an alarm", row.Effect)
	}
	alarms := func() (n int) {
		for _, a := range g.Pending {
			if a.Kind == world.ActAlarm {
				n++
			}
		}
		return n
	}
	b.must(c, arm(game.SourceBeat))
	b.must(c, solve(&puzzle.Log{}))
	before, _ := g.Digest()
	if _, ref := b.do(c, arm(game.SourceBeat)); ref == nil || ref.Code != game.LockedDown {
		t.Fatalf("arming a machine that haywired this tick: %v", ref)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatal("a refused arming changed the game")
	}
	if sk := c.C.PracticeOf("pressure"); alarms() != 1 || sk.Uses != p.Param("haywire-uses") {
		t.Fatalf("one failure in a tick: %d alarms, %d uses", alarms(), sk.Uses)
	}
	c.Lockdowns = nil
	b.must(c, arm(game.SourceBeat))
	b.must(c, solve(&puzzle.Log{}))
	if alarms() != 1 {
		t.Fatalf("%d alarms pending from one character on one tile", alarms())
	}
	b.tick()
	b.must(c, arm(game.SourceBeat))
}

func practised(c *game.Char, family string, level int64) {
	c.C.Practice = slices.DeleteFunc(c.C.Practice, func(s char.Skill) bool { return s.ID == family })
	c.C.Practice = append(c.C.Practice, char.Skill{ID: family, Level: level})
	slices.SortFunc(c.C.Practice, func(a, b char.Skill) int {
		if a.ID < b.ID {
			return -1
		}
		return 1
	})
}

// TestBenchCaps solves at the bench past the day's cap: practice stops,
// the machine is a new one every try, and the next world day opens again.
func TestBenchCaps(t *testing.T) {
	b := newBench(t)
	g, c := b.g, b.c
	p := g.Puzzles()
	testkit.AtBench(t, g, c)
	v := game.Viewer{Family: puzzle.Rewire, Level: 3}
	try := func(half bool) game.Result {
		rig := b.rig(c, v)
		if rig.Source != game.SourceBench || rig.Countdown != 0 || rig.Haywire != "" || rig.Spec.Attempt != c.BenchRuns {
			t.Fatalf("a bench rig: %+v", rig)
		}
		log := b.solving(rig)
		if half {
			log.Moves = log.Moves[:1]
		}
		return b.must(c, game.Command{Kind: game.BenchSolve, Machine: &game.MachineCmd{Family: v.Family, Level: v.Level, Log: log}})
	}
	res := try(true)
	if res.Machine.Solved || res.Machine.Haywire != "" || len(res.Facts) != 0 || c.BenchRuns != 1 || c.Bench != (game.Daily{}) {
		t.Fatalf("an unfinished bench log: %+v, facts %+v", res.Machine, res.Facts)
	}
	most, each := p.Param("bench-uses-per-day"), p.Param("bench-solve-uses")
	var uses int64
	for i := int64(0); i < most/each+2; i++ {
		res := try(false)
		f := kindOf(res.Facts, "bench.solved")
		if !res.Machine.Solved || res.Machine.Clean || f == nil {
			t.Fatalf("bench solve %d: %+v", i, res.Machine)
		}
		n, _ := datum(f, "uses")
		uses += n.N
	}
	bn, _ := g.BenchAt(c)
	if uses != most || bn.Uses != most || bn.UsesCap != most {
		t.Fatalf("%d uses from the bench in a day, cap %d; the bench says %d", uses, most, bn.Uses)
	}
	if sk := c.C.PracticeOf(puzzle.Rewire); sk.Level != 1 || sk.Uses != 0 || kindOf(g.Log.Since(0), "practice.levelled") == nil {
		t.Fatalf("practice after %d uses: %+v", most, sk)
	}
	for g.World.Day == c.Bench.Day {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if bn, _ := g.BenchAt(c); bn.Uses != 0 {
		t.Fatalf("%d bench uses on a new world day", bn.Uses)
	}
	if f := kindOf(try(false).Facts, "bench.solved"); f == nil {
		t.Fatal("no solve on the new day")
	} else if n, _ := datum(f, "uses"); n.N != each {
		t.Fatalf("%d uses on the new day", n.N)
	}
	// Practice opens higher levels.
	if _, ok := g.Rig(c, game.Viewer{Family: puzzle.Rewire, Level: 99}); !ok {
		t.Fatal("no rig")
	}
	top := b.rig(c, game.Viewer{Family: puzzle.Rewire, Level: 99}).Spec.Level
	practised(c, puzzle.Rewire, 2*p.Param("bench-practice-per-level"))
	if got := b.rig(c, game.Viewer{Family: puzzle.Rewire, Level: 99}).Spec.Level; got != top+2 || top != p.Param("bench-base-levels") {
		t.Fatalf("the bench's top level went from %d to %d", top, got)
	}
	b.audit()
}

// TestLessons has a master leave lessons and a learner take them: both
// caps hold, nobody takes their own, the oldest goes first, and the
// teacher gains standing with the guild that runs the settlement.
func TestLessons(t *testing.T) {
	g, err := game.New(rules(t))
	if err != nil {
		t.Fatal(err)
	}
	b := &bench{t: t, g: g}
	teacher, learner := b.create("server-1"), b.create("server-1")
	p := g.Puzzles()
	testkit.AtBench(t, g, teacher)
	testkit.AtBench(t, g, learner)
	guild := g.Places[0].Guild
	if guild == "" || teacher.C.Guild != guild {
		t.Fatalf("nobody runs the first settlement: %q", guild)
	}
	teach := func(c *game.Char, family string) game.Result {
		v := game.Viewer{Family: family, Level: 1}
		return b.must(c, game.Command{Kind: game.BenchSolve, Machine: &game.MachineCmd{Family: family, Level: 1, Teach: true, Log: b.solving(b.rig(c, v))}})
	}
	lesson := func(c *game.Char, family string) (game.Result, *game.Refused) {
		return b.do(c, game.Command{Kind: game.BenchLesson, Machine: &game.MachineCmd{Family: family}})
	}
	teach(teacher, puzzle.Fuse)
	if len(g.Lessons) != 0 {
		t.Fatal("a lesson from someone who is no master")
	}
	practised(teacher, puzzle.Fuse, 16)
	practised(teacher, puzzle.Signal, 16)
	give, take, kept := p.Param("lesson-give-per-day"), p.Param("lesson-take-per-day"), p.Param("lessons-kept")
	for range give + 2 {
		teach(teacher, puzzle.Fuse)
	}
	if n := int64(len(g.Lessons)); n != min(give, kept) || teacher.Taught.N != give {
		t.Fatalf("%d lessons left, %d counted, of %d a day and %d kept", n, teacher.Taught.N, give, kept)
	}
	if _, ref := lesson(teacher, puzzle.Fuse); ref == nil || ref.Code != game.NoLesson {
		t.Fatalf("a teacher took its own lesson: %v", ref)
	}
	if _, ref := lesson(learner, puzzle.Signal); ref == nil || ref.Code != game.NoLesson {
		t.Fatalf("a lesson in a family nobody taught: %v", ref)
	}
	if bn, _ := g.BenchAt(learner); bn.Lessons != min(give, kept) {
		t.Fatalf("the learner sees %d lessons", bn.Lessons)
	}
	version := teacher.Version
	for i := range take {
		res, ref := lesson(learner, puzzle.Fuse)
		if ref != nil {
			t.Fatalf("lesson %d: %v", i, ref)
		}
		f := kindOf(res.Facts, "lesson.taken")
		if f == nil || !slices.ContainsFunc(f.Subjects, func(r fact.Ref) bool { return r.ID == teacher.C.ID }) {
			t.Fatalf("lesson %d left no fact naming its teacher: %+v", i, res.Facts)
		}
	}
	if sk := learner.C.PracticeOf(puzzle.Fuse); sk.Uses != take*p.Param("lesson-uses") {
		t.Fatalf("%d uses from %d lessons", sk.Uses, take)
	}
	if got := teacher.C.GuildStanding.Get(guild); got != take*p.Param("lesson-standing") || teacher.Version != version+take {
		t.Fatalf("the teacher's standing with %s is %d after %d lessons; version moved %d", guild, got, take, teacher.Version-version)
	}
	before, _ := g.Digest()
	if _, ref := lesson(learner, puzzle.Fuse); ref == nil || ref.Code != game.NoLesson {
		t.Fatalf("a lesson past the day's cap: %v", ref)
	}
	if after, _ := g.Digest(); after != before {
		t.Fatal("a refused lesson changed the game")
	}
	if learner.Bench != (game.Daily{}) {
		t.Fatal("lessons counted against the bench's uses")
	}
}

// TestMastery brings a family's practice to mastery: one puzzle.mastered
// fact naming the home settlement, a title, and an inner panel that makes
// a solve a master's.
func TestMastery(t *testing.T) {
	b := newBench(t)
	g, c := b.g, b.c
	p := g.Puzzles()
	need := g.PracticeNeed(15)
	practised(c, puzzle.Fuse, 15)
	c.C.Practice[slices.IndexFunc(c.C.Practice, func(s char.Skill) bool { return s.ID == puzzle.Fuse })].Uses = need - p.Param("live-solve-uses")
	testkit.MachineBeat(t, g, c, puzzle.Fuse, 2)
	if rig := b.rig(c, game.Viewer{}); rig.Inner != nil || len(g.Titles(c)) != 0 {
		t.Fatal("an inner panel or a title before mastery")
	}
	b.must(c, arm(game.SourceBeat))
	res := b.must(c, solve(b.solving(b.rig(c, game.Viewer{}))))
	f := kindOf(res.Facts, "puzzle.mastered")
	if f == nil || countKind(res.Facts, "puzzle.mastered") != 1 || c.C.Level(puzzle.Fuse) != 16 || !slices.Equal(g.Titles(c), []string{puzzle.Fuse}) {
		t.Fatalf("at 16: facts %+v, titles %v", res.Facts, g.Titles(c))
	}
	if n, ok := datum(f, "settlement"); !ok || n.N != int64(g.HomeOf(c)) {
		t.Fatalf("the mastered fact names settlement %+v", f.Data)
	}

	testkit.MachineBeat(t, g, c, puzzle.Fuse, 2)
	rig := b.rig(c, game.Viewer{})
	if rig.Inner == nil || rig.Inner.Level != rig.Spec.Level+p.Param("inner-levels") {
		t.Fatalf("a master's rig has no inner panel: %+v", rig.Inner)
	}
	b.must(c, arm(game.SourceBeat))
	outer, inner := p.Solve(rig.Layout), p.Solve(*rig.Inner)
	at := outer.Moves[len(outer.Moves)-1].At
	log := &puzzle.Log{Moves: slices.Clone(outer.Moves)}
	for _, m := range inner.Moves {
		m.At += at
		log.Moves = append(log.Moves, m)
	}
	uses := c.C.PracticeOf(puzzle.Fuse).Uses
	res = b.must(c, solve(log))
	solved := kindOf(res.Facts, "puzzle.solved")
	if !res.Machine.Master || solved == nil || countKind(res.Facts, "puzzle.mastered") != 0 {
		t.Fatalf("a master's solve: %+v", res.Machine)
	}
	if m, _ := datum(solved, "master"); m.N != 1 {
		t.Fatalf("the fact does not say master: %+v", solved.Data)
	}
	if got := c.C.PracticeOf(puzzle.Fuse).Uses - uses; got != p.Param("live-solve-uses")+p.Param("master-solve-uses") {
		t.Fatalf("%d uses from a master's solve", got)
	}
}

// TestMachineBeatMovedOn solves and fails machines whose beat no longer
// offers them by the time the log arrives: a solve pays nothing and shows
// no result, and a failed log still shuts the place.
func TestMachineBeatMovedOn(t *testing.T) {
	b := newBench(t)
	armGone := func() game.Rig {
		b.tick()
		testkit.MachineBeat(t, b.g, b.c, puzzle.Signal, 1)
		rig := b.rig(b.c, game.Viewer{})
		a := arm(game.SourceBeat)
		a.Now = armedAt
		b.must(b.c, a)
		b.c.Fight = nil
		return rig
	}
	rig := armGone()
	s := solve(b.solving(rig))
	s.Now = armedAt + 900
	res := b.must(b.c, s)
	if res.Machine != nil || b.c.LastMachine != nil || b.c.Armed != nil || kindOf(res.Facts, "machine.moved-on") == nil || kindOf(res.Facts, "puzzle.solved") != nil {
		t.Fatalf("a solve on a beat that moved on: %+v, last %+v, facts %+v", res.Machine, b.c.LastMachine, res.Facts)
	}
	if len(b.c.Lockdowns) != 0 {
		t.Fatalf("a solve shut the place: %+v", b.c.Lockdowns)
	}
	b.audit()

	armGone()
	s = solve(&puzzle.Log{})
	s.Now = armedAt + 900
	res = b.must(b.c, s)
	if res.Machine == nil || res.Machine.Solved || res.Machine.Haywire == "" || b.c.LastMachine == nil || b.c.Armed != nil {
		t.Fatalf("a failed log on a beat that moved on: %+v, last %+v", res.Machine, b.c.LastMachine)
	}
	if len(b.c.Lockdowns) != 1 || b.c.Lockdowns[0].Until <= b.g.Tick() {
		t.Fatalf("a failed log on a beat that moved on left the place open: %+v", b.c.Lockdowns)
	}
	b.audit()
}
