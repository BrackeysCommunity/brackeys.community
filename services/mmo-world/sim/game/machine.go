package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/world"
)

// Machine commands (GDD 7.11): a machine is armed by its first touch and
// solved by the move log played against it; a bench's has no countdown.
const (
	MachineArm   = "machine-arm"
	MachineSolve = "machine-solve"
	BenchSolve   = "bench-solve"
	BenchLesson  = "bench-lesson"
)

// SetMachine is an operator's command: it stands a character before a
// machine of a family and level, so a session can rehearse any of them
// without finding it in the world.
const SetMachine = "set-machine"

// Refusal codes the machine rules give.
const (
	NoMachine    = "no-machine"
	MachineArmed = "machine-armed"
	LockedDown   = "locked-down"
	NoLesson     = "no-lesson"
)

// Where a machine is.
const (
	SourceBeat  = "beat"
	SourcePouch = "pouch"
	SourceBench = "bench"
)

// structural: the practice a lock trains beside its family's, and how
// long a machine that haywired and stays is shut to its character, so a
// failure is not repeated within a tick.
const (
	practiceLockpick = "lockpick"
	retryTicks       = 1
)

// structural: the beat whose machine is not a lock.
const beatPuzzle = "puzzle"

// TrigPouch is the tiles.triggers row that turns a find into a locked
// pouch.
const TrigPouch = "locked-pouch"

// MachineCmd is what a machine command carries.
type MachineCmd struct {
	Source  string      `json:"source,omitempty"`
	Pouch   string      `json:"pouch,omitempty"`
	Family  string      `json:"family,omitempty"`
	Level   int64       `json:"level,omitempty"`
	Compact bool        `json:"compact,omitempty"`
	Teach   bool        `json:"teach,omitempty"`
	Log     *puzzle.Log `json:"log,omitempty"`
}

// log is the move log a command carries: an empty one when it has none.
func (m *MachineCmd) log() puzzle.Log {
	if m == nil || m.Log == nil {
		return puzzle.Log{}
	}
	return *m.Log
}

// Timed reports whether the service stamps a kind with its clock.
func Timed(kind string) bool {
	switch kind {
	case MachineArm, MachineSolve, Press, PartyPick, PartyWindow, DungeonPush, DungeonLeave, PatternSet:
		return true
	}
	return false
}

// partySource reports whether a machine source is a party's.
func partySource(source string) bool {
	return source == SourceParty || source == SourceFork || source == SourceGuardian
}

// Armed is a machine whose countdown is running (GDD 7.11).
type Armed struct {
	Source    string      `json:"source"` // beat or pouch
	Pouch     string      `json:"pouch,omitempty"`
	Spec      puzzle.Spec `json:"spec"`
	Practice  int64       `json:"practice"`  // the family practice it was armed at
	Countdown int64       `json:"countdown"` // ms
	At        int64       `json:"at"`        // the service's clock at arming, unix ms
	Tick      int64       `json:"tick"`
	Intro     bool        `json:"intro,omitempty"`
	Pattern   *PatternArm `json:"pattern,omitempty"` // a pattern point's machine
}

// Deadline is when the countdown ends, on the service's clock.
func (a *Armed) Deadline() int64 { return a.At + a.Countdown }

// MachineDue is when an armed machine's log is late: its deadline and the
// grace. Whoever ends a machine left alone ends it then.
func (g *Game) MachineDue(a *Armed) int64 { return a.Deadline() + g.Puzzles().Grace() }

// Pouch is a find that came locked: its goods wait in its own pool until
// its lock is solved.
type Pouch struct {
	ID     string       `json:"id"` // "p-<char>-<n>"
	Hex    hex.Hex      `json:"hex"`
	Goods  []item.Spoil `json:"goods"`
	Family string       `json:"family"`
	Level  int64        `json:"level"`
	Tier   int64        `json:"tier"`
	Tries  int64        `json:"tries,omitempty"`
}

// Lockdown bars a character from a place's machines until a tick.
type Lockdown struct {
	Place string `json:"place"`
	Until int64  `json:"until"`
}

// MachineDone is the machine a character last finished.
type MachineDone struct {
	Source string        `json:"source"`
	Family string        `json:"family"`
	Level  int64         `json:"level"`
	Tick   int64         `json:"tick"`
	Result puzzle.Result `json:"result"`
}

// Lesson is a master's bench solve left for a learner to take.
type Lesson struct {
	Settlement int    `json:"settlement"`
	Family     string `json:"family"`
	Teacher    string `json:"teacher"`
	Tick       int64  `json:"tick"`
}

// Viewer is what a player has on screen: a phone's caps, and the bench
// rig or the pouch picked.
type Viewer struct {
	Compact bool
	Family  string
	Level   int64
	Pouch   string
}

// Rig is a machine as one character may work it now, with everything its
// practice buys. Why is what its countdown is made of.
type Rig struct {
	Source, Pouch string
	Spec          puzzle.Spec
	Layout        puzzle.Layout
	Inner         *puzzle.Layout // set only for a master
	Practice      int64
	Gifts         puzzle.Gifts
	Master        bool
	Guide         *puzzle.Move  // the first move of a solve, with the guide line
	Hints         []puzzle.Move // as many as the practice allows
	Pass          *puzzle.Move  // the move a master may pass on: the first hint, else the guide
	Countdown     int64         // ms; 0 at a bench
	MaxPlay       int64         // ms a bench machine may be played for; 0 elsewhere
	Why           []Part
	Haywire       string
	Intro         bool
	Armed         *Armed
	Locked        int64 // ticks left of a lockdown
}

// worked is a machine's replayed result, for the press that resolves its
// beat.
type worked struct {
	res     puzzle.Result
	compact bool
}

// data is what a machine's fact says beyond the fight's own: the solve's
// milliseconds and screen, or that the log came late.
func (w *worked) data(kind string) []fact.Datum {
	switch kind {
	case "puzzle.solved":
		return []fact.Datum{fact.N("ms", w.res.At), fact.B("compact", w.compact), fact.B("master", w.res.Master)}
	case "puzzle.haywire":
		return []fact.Datum{fact.B("late", w.res.Late)}
	}
	return nil
}

// Puzzles are the machine rules the game plays by.
func (g *Game) Puzzles() *puzzle.Puzzles { return g.r.Fight.P }

func (g *Game) mastery(practice int64) bool { return g.Puzzles().Gifts(practice).Mastery }

// Master reports whether a character holds mastery in a family.
func (g *Game) Master(c *Char, family string) bool { return g.mastery(c.C.Level(family)) }

// machineOption is the option a machine's result resolves on the current
// beat; none while something on the beat leaves the machine out of reach.
func (g *Game) machineOption(c *Char) (string, bool) {
	_, opts := g.beat(c, g.Tick())
	i := slices.IndexFunc(opts, func(o fight.Option) bool { return o.Puzzle })
	if i < 0 {
		return "", false
	}
	return opts[i].ID, true
}

// beatSpec names the machine on a character's current beat. A character
// who has never armed one meets a first-level Rewire on a Puzzle beat,
// whatever the encounter drew.
func (g *Game) beatSpec(c *Char, compact bool) (spec puzzle.Spec, intro, ok bool) {
	if c.Fight == nil {
		return spec, false, false
	}
	e := c.Fight.E
	family, lock, ok := g.r.Fight.Machine(e)
	if !ok {
		return spec, false, false
	}
	if _, ok := g.machineOption(c); !ok {
		return spec, false, false
	}
	level := e.Levels[e.At]
	if c.Worked == 0 && !lock {
		family, level = g.Puzzles().IntroMachine()
		intro = true
	}
	spec = puzzle.Spec{Family: family, Level: level, Tier: e.Creature.Tier, Place: machinePlace(c.C.At, e.Floor), Beat: int64(e.At),
		Attempt: e.Press, Compact: compact}
	// The opening machine keeps its first shape.
	if !intro {
		spec.Shape = g.Puzzles().Shape(family, level, spec.Where())
	}
	return spec, intro, true
}

// MachineOn is the family of the machine a character faces on its current
// beat, or "".
func (g *Game) MachineOn(c *Char) string {
	if a := c.Armed; a != nil && a.Source == SourceBeat {
		return a.Spec.Family
	}
	spec, _, _ := g.beatSpec(c, false)
	return spec.Family
}

func pouchPlace(id string) string { return "pouch:" + id }

func (c *Char) pouch(id string) int {
	return slices.IndexFunc(c.Pouches, func(p Pouch) bool { return p.ID == id })
}

func (p *Pouch) spec(compact bool) puzzle.Spec {
	return puzzle.Spec{Family: p.Family, Level: p.Level, Tier: p.Tier, Place: pouchPlace(p.ID), Attempt: p.Tries, Compact: compact}
}

// lockedFor is the ticks left of a character's lockdown on a place.
func (c *Char) lockedFor(place string, tick int64) int64 {
	var left int64
	for _, l := range c.Lockdowns {
		if l.Place == place {
			left = max(left, l.Until-tick)
		}
	}
	return left
}

// spot is a machine at rest before a character: which one, and the ticks
// left of a lockdown on it.
type spot struct {
	source, pouch string
	spec          puzzle.Spec
	intro         bool
	locked        int64
}

// machineAt is the machine a character may work now, at rest: the one on
// its beat, else the pouch or the bench rig its viewer has open. What is
// shown and what is armed both come from here.
func (g *Game) machineAt(c *Char, v Viewer) (spot, bool) {
	tick := g.Tick()
	if c.Fight != nil {
		spec, intro, ok := g.beatSpec(c, v.Compact)
		return spot{source: SourceBeat, spec: spec, intro: intro, locked: c.lockedFor(spec.Place, tick)}, ok
	}
	if i := c.pouch(v.Pouch); i >= 0 {
		spec := c.Pouches[i].spec(v.Compact)
		return spot{source: SourcePouch, pouch: v.Pouch, spec: spec, locked: c.lockedFor(spec.Place, tick)}, true
	}
	if b, ok := g.BenchFor(c); ok && g.Puzzles().Known(v.Family) {
		level := min(max(v.Level, 1), g.benchTop(c, v.Family))
		return spot{source: SourceBench, spec: g.benchSpec(c, b.Settlement, v.Family, level, v.Compact)}, true
	}
	return spot{}, false
}

// rig lays a machine out for a character at a practice.
func (g *Game) rig(at spot, practice int64) Rig {
	p := g.Puzzles()
	spec := at.spec
	out := Rig{Source: at.source, Pouch: at.pouch, Spec: spec, Layout: p.Make(spec), Practice: practice, Gifts: p.Gifts(practice),
		Intro: at.intro, Locked: at.locked}
	if out.Master = out.Gifts.Mastery; out.Master {
		in := p.Inner(spec)
		out.Inner = &in
	}
	if out.Gifts.GuideLine {
		if moves := p.Solve(out.Layout).Moves; len(moves) > 0 {
			out.Guide = &moves[0]
		}
	}
	if n := out.Gifts.Hints; n > 0 {
		hints := p.Hints(out.Layout)
		out.Hints = hints[:min(int64(len(hints)), n)]
	}
	if out.Master {
		out.Pass = out.Guide
		if len(out.Hints) > 0 {
			out.Pass = &out.Hints[0]
		}
	}
	if at.source == SourceBench {
		out.MaxPlay = p.MaxPlay()
		return out
	}
	out.Countdown = p.Countdown(spec.Family, spec.Level, spec.Tier, practice)
	for _, x := range p.CountdownParts(spec.Family, spec.Level, spec.Tier, practice) {
		out.Why = append(out.Why, Part(x))
	}
	out.Haywire = g.haywireOf(spec, at.intro)
	return out
}

// haywireOf is what a machine does when it fails: its family's keyed row,
// or the sheet's gentle one on a character's first machine.
func (g *Game) haywireOf(spec puzzle.Spec, intro bool) string {
	p := g.Puzzles()
	if id := p.Intro(); intro && id != "" {
		return id
	}
	return p.Haywire(spec.Family, spec.Where())
}

// HaywireBeats reports whether a haywire row puts on a state that lasts
// so many beats, rather than the rest of the encounter.
func (g *Game) HaywireBeats(id string) bool {
	row := g.Puzzles().HaywireRow(id)
	return row != nil && row.Effect == puzzle.EffectShort && g.r.Fight.StateBeats(tags.Tag(row.Tag)) > 0
}

// Rig is the machine a character may work now: the one it armed, else the
// one machineAt finds.
func (g *Game) Rig(c *Char, v Viewer) (Rig, bool) {
	if a := c.Armed; a != nil {
		out := g.rig(spot{source: a.Source, pouch: a.Pouch, spec: a.Spec, intro: a.Intro}, a.Practice)
		out.Countdown, out.Armed = a.Countdown, a
		return out, true
	}
	at, ok := g.machineAt(c, v)
	if !ok {
		return Rig{}, false
	}
	return g.rig(at, c.C.Level(at.spec.Family)), true
}

// ArmedAll are the characters with a countdown running, in id order.
func (g *Game) ArmedAll() []*Char {
	var out []*Char
	for _, c := range g.Chars {
		if c.Armed != nil {
			out = append(out, c)
		}
	}
	return out
}

// machineArm starts a machine's countdown: the one on the current beat,
// or a pouch's lock.
// A new staged route here needs exclusionStage to see it.
func (g *Game) machineArm(c *Char, cmd Command) error {
	m := cmd.Machine
	if m == nil {
		return refuse(BadArgs, "arming names a machine: a beat's or a pouch's")
	}
	st, err := g.vaultFor(c, cmd)
	switch {
	case err != nil:
		return err
	case st != nil:
		return g.vaultArm(c, cmd, st)
	}
	if partySource(m.Source) {
		return g.partyArm(c, cmd)
	}
	if m.Source == MachinePattern {
		return g.patternSet(c, cmd)
	}
	var missing error
	switch m.Source {
	case SourceBeat:
		if err := notDown(c); err != nil {
			return err
		}
		if c.Fight != nil && c.Fight.Shared != "" {
			return refuse(NoMachine, "a shared encounter's machine is the party's: arm it as %s", SourceParty)
		}
		missing = refuse(NoMachine, "%s faces no machine it can reach", c.C.ID)
	case SourcePouch:
		if err := free(c); err != nil {
			return err
		}
		missing = refuse(NoMachine, "%s carries no pouch %q", c.C.ID, m.Pouch)
	default:
		return refuse(BadArgs, "a machine is armed on a beat or on a pouch")
	}
	at, ok := g.machineAt(c, Viewer{Compact: m.Compact, Pouch: m.Pouch})
	if !ok || at.source != m.Source {
		return missing
	}
	if at.locked > 0 {
		return refuse(LockedDown, "locked down for %d more ticks", at.locked)
	}
	tick := g.Tick()
	spec := at.spec
	a := &Armed{Source: at.source, Pouch: at.pouch, Spec: spec, Practice: c.C.Level(spec.Family), At: cmd.Now, Tick: tick, Intro: at.intro}
	a.Countdown = g.Puzzles().Countdown(spec.Family, spec.Level, spec.Tier, a.Practice)
	if at.intro {
		e := c.Fight.E
		e.Machines[e.At], e.Levels[e.At] = spec.Family, spec.Level
	}
	c.Armed = a
	c.Worked++
	c.LastMachine = nil
	c.Lockdowns = slices.DeleteFunc(c.Lockdowns, func(l Lockdown) bool { return l.Until <= tick })
	_, err = g.fact(c, "machine.armed", tick, fact.S("family", spec.Family), fact.N("level", spec.Level), fact.S("source", m.Source))
	return err
}

// machineSolve plays a move log against the armed machine. The countdown
// is read on the service's clock: the arming's against this command's.
func (g *Game) machineSolve(c *Char, cmd Command) ([]fight.Pressed, *puzzle.Result, error) {
	a := c.Armed
	sh := g.sharedOf(c)
	if st := g.vaultOfChar(a, sh); st != nil || cmd.Target != "" {
		if st == nil || st.ID != cmd.Target && cmd.Target != "" {
			return nil, nil, refuse(BadArgs, "a machine solve names a stage only for its vault")
		}
		return g.vaultSolve(c, cmd, sh, st)
	}
	if a == nil && (cmd.Machine != nil && partySource(cmd.Machine.Source) || sh != nil) {
		return g.partySolve(c, cmd)
	}
	if a == nil {
		return nil, nil, refuse(NoMachine, "%s has no machine armed", c.C.ID)
	}
	// Where no clock is kept the log's own stamps are all there is.
	elapsed := int64(-1)
	if a.At > 0 && cmd.Now > 0 {
		elapsed = max(0, cmd.Now-a.At)
	}
	res := g.Puzzles().Play(a.Spec, cmd.Machine.log(), puzzle.Limits{Countdown: a.Countdown, Elapsed: elapsed, Master: g.mastery(a.Practice)})
	if !res.Solved {
		res.Haywire = g.haywireOf(a.Spec, a.Intro)
	}
	tick := g.Tick()
	var pressed []fight.Pressed
	var err error
	moved := false
	switch a.Source {
	case SourcePouch:
		err = g.pouchWorked(c, cmd.Key, a, res, tick)
	case MachinePattern:
		err = g.patternWorked(c, a, res, tick)
	default:
		pressed, moved, err = g.beatWorked(c, cmd.Key, a, res, tick)
	}
	if err != nil {
		return nil, nil, err
	}
	c.Armed = nil
	if moved && res.Solved {
		// Nothing was pressed or paid, so there is no result to show.
		c.LastMachine = nil
		_, err := g.fact(c, "machine.moved-on", tick, fact.S("family", a.Spec.Family), fact.N("level", a.Spec.Level))
		return nil, nil, err
	}
	c.LastMachine = &MachineDone{Source: a.Source, Family: a.Spec.Family, Level: a.Spec.Level, Tick: tick, Result: res}
	return pressed, &res, nil
}

// beatWorked presses the beat's machine option with the replayed result,
// then does what reaches past the fight: a master's extra practice, an
// alarm, a lockdown. moved is a beat that no longer offers the machine:
// nothing is pressed, and a failed log still haywires.
func (g *Game) beatWorked(c *Char, key string, a *Armed, res puzzle.Result, tick int64) (pressed []fight.Pressed, moved bool, err error) {
	pick, ok := "", false
	if c.Fight != nil {
		pick, ok = g.machineOption(c)
	}
	if !ok {
		if !res.Solved {
			return nil, true, g.failed(c, a.Spec.Family, a.Spec.Place, res, tick, retryTicks)
		}
		return nil, true, nil
	}
	family, at := a.Spec.Family, c.C.At
	e := c.Fight.E
	beat := e.At
	before := c.C.Level(family)
	pressed, err = g.pressOption(c, key, pick, tick, &worked{res: res, compact: a.Spec.Compact})
	if err != nil {
		return nil, false, err
	}
	if err := g.mastered(c, family, before, tick); err != nil {
		return nil, false, err
	}
	if n := g.masterUses(res); n > 0 {
		if err := g.practise(c, family, n, tick); err != nil {
			return nil, false, err
		}
	}
	if !res.Solved {
		var least int64
		if c.Fight != nil && c.Fight.E == e && e.At == beat {
			least = retryTicks
		}
		g.haywired(c, a.Spec.Place, res.Haywire, at, tick, least)
	}
	return pressed, false, nil
}

// masterUses is the extra practice a solved inner panel pays.
func (g *Game) masterUses(res puzzle.Result) int64 {
	if !res.Master {
		return 0
	}
	return g.Puzzles().Param("master-solve-uses")
}

// haywired is a haywire's reach past the fight: an alarm raises the
// region's threat at the next tick, a lockdown shuts the place's machines
// to this character. least is the fewest ticks the place stays shut
// whatever the row.
func (g *Game) haywired(c *Char, place, haywire string, at hex.Hex, tick, least int64) {
	shut := least
	if row := g.Puzzles().HaywireRow(haywire); row != nil {
		switch row.Effect {
		case puzzle.EffectAlarm:
			// A staged thing raises no region's threat.
			if g.staging == nil {
				g.alarm(c, at, row.Magnitude)
			}
		case puzzle.EffectLockdown:
			shut = max(shut, row.Magnitude*sheets.TicksPerDay)
		}
	}
	if shut > 0 {
		c.Lockdowns = append(c.Lockdowns, Lockdown{Place: place, Until: tick + shut})
	}
}

// failed is what a machine that haywired outside a fight does: its reach
// past the fight from where the character stands, the haywire's fact, and
// the practice a failure still pays. A fight's machine does the same
// through the encounter.
func (g *Game) failed(c *Char, family, place string, res puzzle.Result, tick, least int64, more ...fact.Datum) error {
	rules := g.Puzzles()
	g.haywired(c, place, res.Haywire, c.C.At, tick, least)
	data := append([]fact.Datum{fact.S("family", family), fact.S("haywire", res.Haywire)}, more...)
	data = append(data, fact.B("late", res.Late))
	if row := rules.HaywireRow(res.Haywire); row != nil {
		data = append(data, fact.N("magnitude", row.Magnitude))
	}
	if _, err := g.fact(c, "puzzle.haywire", tick, data...); err != nil {
		return err
	}
	return g.practise(c, family, rules.Param("haywire-uses"), tick)
}

// alarm raises a tile's region at the next tick. One character's alarms
// on one tile are one alarm a tick, however often a machine fails there.
func (g *Game) alarm(c *Char, at hex.Hex, threat int64) {
	by := char.Ref(c.C.ID)
	raised := slices.ContainsFunc(g.Pending, func(a world.Action) bool { return a.Kind == world.ActAlarm && a.Hex == at && a.By == by })
	if threat > 0 && !raised {
		g.Pending = append(g.Pending, world.Action{Kind: world.ActAlarm, Hex: at, By: by, Units: threat})
	}
}

// PouchLocked is the ticks until a character may try a pouch again.
func (g *Game) PouchLocked(c *Char, p *Pouch) int64 { return c.lockedFor(pouchPlace(p.ID), g.Tick()) }

// pouchWorked opens a pouch whose lock was solved, paying exactly what it
// holds. After any haywire the pouch stays shut for at least the sheet's
// lockdown days.
func (g *Game) pouchWorked(c *Char, key string, a *Armed, res puzzle.Result, tick int64) error {
	i := c.pouch(a.Pouch)
	if i < 0 {
		return nil
	}
	p := &c.Pouches[i]
	rules := g.Puzzles()
	if !res.Solved {
		p.Tries++
		return g.failed(c, p.Family, pouchPlace(p.ID), res, tick, rules.LockdownDays()*sheets.TicksPerDay, fact.S("pouch", p.ID))
	}
	family := p.Family
	acc := ledger.Char(c.C.ID)
	var legs []ledger.Leg
	for _, s := range p.Goods {
		legs = append(legs, ledger.Pair(ledger.PouchPool(p.ID), acc, ledger.Material(s.Material), s.Qty)...)
	}
	f, err := g.fact(c, "pouch.opened", tick, fact.S("pouch", p.ID), fact.S("family", family), fact.N("level", p.Level), fact.N("goods", item.Total(p.Goods)),
		fact.N("ms", res.At), fact.B("clean", res.Clean), fact.B("compact", a.Spec.Compact), fact.B("master", res.Master))
	if err != nil {
		return err
	}
	if err := g.receive(c, ledger.Txn{Key: ledger.SubKey(key, "pouch", p.ID), Kind: "pouch", Tick: tick, Fact: f.ID, Legs: legs}); err != nil {
		return err
	}
	c.Pouches = slices.Delete(c.Pouches, i, i+1)
	uses := rules.Param("live-solve-uses")
	if err := g.practise(c, practiceLockpick, uses, tick); err != nil {
		return err
	}
	return g.practise(c, family, uses+g.masterUses(res), tick)
}

// practise counts uses of a practice, and says so when a level comes of
// them.
func (g *Game) practise(c *Char, skill string, uses, tick int64) error {
	before := c.C.Level(skill)
	if c.C.Practise(skill, uses, g.r.Growth.Params()) > 0 {
		if _, err := g.fact(c, "practice.levelled", tick, fact.S("skill", skill), fact.N("level", c.C.Level(skill))); err != nil {
			return err
		}
	}
	return g.mastered(c, skill, before, tick)
}

// mastered records a family's practice reaching mastery, with the
// settlement its master calls home.
func (g *Game) mastered(c *Char, family string, before, tick int64) error {
	if g.Puzzles().Family(family) == nil || g.mastery(before) || !g.Master(c, family) {
		return nil
	}
	_, err := g.fact(c, "puzzle.mastered", tick, fact.S("family", family), fact.N("settlement", int64(g.HomeOf(c))))
	return err
}

// Titles are the families a character holds mastery in, in id order.
func (g *Game) Titles(c *Char) []string {
	p := g.Puzzles()
	var out []string
	for _, s := range c.C.Practice {
		if p.Family(s.ID) != nil && g.mastery(s.Level) {
			out = append(out, s.ID)
		}
	}
	return out
}

// PracticeNeed is the uses a practice at a level needs for the next; 0 at
// the top.
func (g *Game) PracticeNeed(level int64) int64 {
	growth := g.r.Growth.Params()
	if level >= sheets.IntParam(growth, "practice-max") {
		return 0
	}
	return sheets.IntParam(growth, "practice-uses") * (level + 1)
}

// pouched turns an Uncommon find into a locked pouch: the goods the find
// chose leave the tile's pool for the pouch's own, and wait there for its
// lock.
func (g *Game) pouched(c *Char, h hex.Hex, key string, f Find, tier, t int64) error {
	c.PouchN++
	id := "p-" + c.C.ID + "-" + strconv.FormatInt(c.PouchN, decimal)
	locks := g.Puzzles().PouchLocks()
	family := locks[g.r.draw.Below(uint64(len(locks)), "game.pouch-family", draw.Str(id))]
	p := Pouch{ID: id, Hex: h, Goods: f.Goods, Family: family, Tier: tier}
	p.Level = g.Puzzles().Level(family, tier, 0, puzzle.Where{Place: pouchPlace(id)})
	var legs []ledger.Leg
	for _, s := range f.Goods {
		legs = append(legs, ledger.Pair(poolOf(h), ledger.PouchPool(id), ledger.Material(s.Material), s.Qty)...)
	}
	data := append([]fact.Datum{fact.S("pouch", id), fact.S("family", family), fact.S("trigger", TrigPouch), fact.S("rarity", f.Rarity),
		fact.N("goods", item.Total(f.Goods))}, fact.At(h)...)
	ff, err := g.fact(c, "pouch.found", t, data...)
	if err != nil {
		return err
	}
	if err := g.post(ledger.Txn{Key: key, Kind: "find", Tick: t, Fact: ff.ID, Legs: legs}); err != nil {
		return err
	}
	c.Pouches = append(c.Pouches, p)
	return nil
}

// pouchable reports whether a find may come to a character as a pouch:
// only one who has worked a machine, and carries fewer than it may.
func (g *Game) pouchable(c *Char) bool {
	return c.Worked > 0 && int64(len(c.Pouches)) < sheets.IntParam(g.r.Book.TileParams, "pouch-carry")
}

// topLevel is the highest level the world draws a machine at: the last
// tier's, on the deepest floor.
func (g *Game) topLevel() int64 {
	tiers := g.r.Book.FightTiers
	return g.Puzzles().TopLevel(tiers[len(tiers)-1].Tier)
}

// FaceMachine puts a character in an encounter of one beat, a machine of
// a family and level against the sheets' first creature: a lock for a
// family that is picked, a puzzle for any other. A solve wins the
// encounter; a haywire leaves it for another try.
func (g *Game) FaceMachine(c *Char, family string, level int64) {
	e := g.faceEncounter([]*Char{c}, family, level)
	c.Long, c.Fight = nil, &Fight{E: e, Measures: e.Measures}
}

// setMachine is an operator standing a free character before a machine,
// recorded as a fact. A character who has never armed one still meets the
// opening Rewire first.
func (g *Game) setMachine(c *Char, cmd Command) error {
	if top := g.topLevel(); cmd.Note == "" || !g.Puzzles().Known(cmd.Asset) || cmd.Units < 1 || cmd.Units > top {
		return refuse(BadArgs, "a machine needs a family, a level from 1 to %d and a note", top)
	}
	if err := idle(c); err != nil {
		return err
	}
	g.FaceMachine(c, cmd.Asset, cmd.Units)
	_, err := g.fact(c, "machine.set", g.Tick(), fact.S("family", cmd.Asset), fact.N("level", cmd.Units), fact.S("note", cmd.Note))
	return err
}
