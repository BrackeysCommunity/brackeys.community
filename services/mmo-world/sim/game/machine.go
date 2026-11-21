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

// structural: what a haywire row does, the practice a lock trains beside
// its family's, and the units a machine's why is stated in.
const (
	effectAlarm      = "alarm"
	effectLockdown   = "lockdown"
	practiceLockpick = "lockpick"
	unitSeconds      = "s"
	unitPercent      = "percent"
)

// structural: the beat whose machine is not a lock.
const beatPuzzle = "puzzle"

// structural: milliseconds in a second.
const msPerSecond = 1000

// MachineGrace is the milliseconds a move log may arrive past its
// countdown before it is late.
func (g *Game) MachineGrace() int64 { return g.puzzles().Param("network-grace") * msPerSecond }

// TrigPouch is the tiles.triggers row that turns a find into a locked
// pouch.
const TrigPouch = "locked-pouch"

// pouchLocks are the families that lock a pouch.
var pouchLocks = []string{puzzle.Pins, puzzle.Maze}

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

// Timed reports whether the service stamps a kind with its clock.
func Timed(kind string) bool { return kind == MachineArm || kind == MachineSolve }

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
}

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
	Shut   int64        `json:"shut,omitempty"` // the tick a lockdown lifts
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

// Rig is a machine as one character may work it now. Why is what its
// countdown is made of.
type Rig struct {
	Source, Pouch string
	Spec          puzzle.Spec
	Layout        puzzle.Layout
	Inner         *puzzle.Layout // set only for a master
	Practice      int64
	Gifts         puzzle.Gifts
	Countdown     int64 // ms; 0 at a bench
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

func (g *Game) puzzles() *puzzle.Puzzles { return g.r.Fight.P }

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
		family, level, intro = puzzle.Rewire, 1, true
	}
	return puzzle.Spec{Family: family, Level: level, Tier: e.Creature.Tier, Place: machinePlace(c.C.At, e.Floor), Beat: int64(e.At),
		Attempt: e.Press, Compact: compact}, intro, true
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

// rig lays a machine out for a character at a practice.
func (g *Game) rig(source, pouch string, spec puzzle.Spec, practice int64) Rig {
	p := g.puzzles()
	out := Rig{Source: source, Pouch: pouch, Spec: spec, Layout: p.Make(spec), Practice: practice, Gifts: p.Gifts(practice)}
	if out.Gifts.Mastery {
		in := p.Inner(spec)
		out.Inner = &in
	}
	if source == SourceBench {
		return out
	}
	out.Countdown = p.Countdown(spec.Family, spec.Level, spec.Tier, practice)
	out.Why = g.countdownWhy(spec, out.Gifts)
	out.Haywire = p.Haywire(spec.Family, spec.Where())
	return out
}

// countdownWhy is what a countdown is made of: the family's time, the
// level's, the tier's cut and what practice adds.
func (g *Game) countdownWhy(spec puzzle.Spec, gifts puzzle.Gifts) []Part {
	p := g.puzzles()
	f := p.Family(spec.Family)
	why := []Part{{"family", f.Countdown, unitSeconds}}
	if n := f.PerLevel * (spec.Level - 1); n != 0 {
		why = append(why, Part{"level", n, unitSeconds})
	}
	if n := p.Param("countdown-per-tier") * (spec.Tier - 1); n != 0 {
		why = append(why, Part{"tier", n, unitPercent})
	}
	if gifts.Countdown != 0 {
		why = append(why, Part{"practice", gifts.Countdown, unitPercent})
	}
	return why
}

// introHaywire is what a character's first machine does when it fails:
// the sheet's gentle row, in place of the family's own.
func (g *Game) introHaywire(own string) string {
	if id := g.puzzles().Intro(); id != "" {
		return id
	}
	return own
}

// Rig is the machine a character may work now: the one it armed, else the
// one on its beat, else the pouch or the bench rig its viewer has open.
func (g *Game) Rig(c *Char, v Viewer) (Rig, bool) {
	tick := g.Tick()
	if a := c.Armed; a != nil {
		out := g.rig(a.Source, a.Pouch, a.Spec, a.Practice)
		out.Countdown, out.Intro, out.Armed = a.Countdown, a.Intro, a
		if a.Intro {
			out.Haywire = g.introHaywire(out.Haywire)
		}
		return out, true
	}
	if c.Fight != nil {
		spec, intro, ok := g.beatSpec(c, v.Compact)
		if !ok {
			return Rig{}, false
		}
		out := g.rig(SourceBeat, "", spec, c.C.Level(spec.Family))
		out.Intro, out.Locked = intro, c.lockedFor(spec.Place, tick)
		if intro {
			out.Haywire = g.introHaywire(out.Haywire)
		}
		return out, true
	}
	if i := c.pouch(v.Pouch); i >= 0 {
		p := &c.Pouches[i]
		out := g.rig(SourcePouch, p.ID, p.spec(v.Compact), c.C.Level(p.Family))
		out.Locked = max(0, p.Shut-tick)
		return out, true
	}
	if b, ok := g.BenchAt(c); ok && free(c) == nil && g.puzzles().Known(v.Family) {
		level := min(max(v.Level, 1), g.benchTop(c, v.Family))
		return g.rig(SourceBench, "", g.benchSpec(c, b.Settlement, v.Family, level, v.Compact), c.C.Level(v.Family)), true
	}
	return Rig{}, false
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
func (g *Game) machineArm(c *Char, cmd Command) error {
	m := cmd.Machine
	if m == nil {
		return refuse(BadArgs, "arming names a machine: a beat's or a pouch's")
	}
	tick := g.Tick()
	var spec puzzle.Spec
	var intro bool
	var locked int64
	switch m.Source {
	case SourceBeat:
		if err := notDown(c); err != nil {
			return err
		}
		var ok bool
		if spec, intro, ok = g.beatSpec(c, m.Compact); !ok {
			return refuse(NoMachine, "%s faces no machine it can reach", c.C.ID)
		}
		locked = c.lockedFor(spec.Place, tick)
	case SourcePouch:
		if err := free(c); err != nil {
			return err
		}
		i := c.pouch(m.Pouch)
		if i < 0 {
			return refuse(NoMachine, "%s carries no pouch %q", c.C.ID, m.Pouch)
		}
		spec, locked = c.Pouches[i].spec(m.Compact), max(0, c.Pouches[i].Shut-tick)
	default:
		return refuse(BadArgs, "a machine is armed on a beat or on a pouch")
	}
	if locked > 0 {
		return refuse(LockedDown, "locked down for %d more ticks", locked)
	}
	a := &Armed{Source: m.Source, Spec: spec, Practice: c.C.Level(spec.Family), At: cmd.Now, Tick: tick, Intro: intro}
	if m.Source == SourcePouch {
		a.Pouch = m.Pouch
	}
	a.Countdown = g.puzzles().Countdown(spec.Family, spec.Level, spec.Tier, a.Practice)
	if intro {
		e := c.Fight.E
		e.Machines[e.At], e.Levels[e.At] = spec.Family, spec.Level
	}
	c.Armed = a
	c.Worked++
	c.LastMachine = nil
	c.Lockdowns = slices.DeleteFunc(c.Lockdowns, func(l Lockdown) bool { return l.Until <= tick })
	_, err := g.fact(c, "machine.armed", tick, fact.S("family", spec.Family), fact.N("level", spec.Level), fact.S("source", m.Source))
	return err
}

// machineSolve plays a move log against the armed machine. The countdown
// is read on the service's clock: the arming's against this command's.
func (g *Game) machineSolve(c *Char, cmd Command) ([]fight.Pressed, *puzzle.Result, error) {
	a := c.Armed
	if a == nil {
		return nil, nil, refuse(NoMachine, "%s has no machine armed", c.C.ID)
	}
	var log puzzle.Log
	if cmd.Machine != nil && cmd.Machine.Log != nil {
		log = *cmd.Machine.Log
	}
	// Where no clock is kept the log's own stamps are all there is.
	elapsed := int64(-1)
	if a.At > 0 && cmd.Now > 0 {
		elapsed = max(0, cmd.Now-a.At)
	}
	p := g.puzzles()
	res := p.Play(a.Spec, log, puzzle.Limits{Countdown: a.Countdown, Elapsed: elapsed, Master: p.Gifts(a.Practice).Mastery})
	if a.Intro && !res.Solved {
		res.Haywire = g.introHaywire(res.Haywire)
	}
	tick := g.Tick()
	var pressed []fight.Pressed
	var err error
	if a.Source == SourcePouch {
		err = g.pouchWorked(c, cmd.Key, a, res, tick)
	} else {
		pressed, err = g.beatWorked(c, cmd.Key, a, res, tick)
	}
	if err != nil {
		return nil, nil, err
	}
	c.Armed = nil
	c.LastMachine = &MachineDone{Source: a.Source, Family: a.Spec.Family, Level: a.Spec.Level, Tick: tick, Result: res}
	return pressed, &res, nil
}

// beatWorked presses the beat's machine option with the replayed result,
// then does what reaches past the fight: a master's extra practice, an
// alarm, a lockdown.
func (g *Game) beatWorked(c *Char, key string, a *Armed, res puzzle.Result, tick int64) ([]fight.Pressed, error) {
	if c.Fight == nil {
		return nil, nil
	}
	pick, ok := g.machineOption(c)
	if !ok {
		return nil, nil
	}
	family, at := a.Spec.Family, c.C.At
	before := c.C.Level(family)
	pressed, err := g.pressOption(c, key, pick, tick, &worked{res: res, compact: a.Spec.Compact})
	if err != nil {
		return nil, err
	}
	if err := g.mastered(c, family, before, tick); err != nil {
		return nil, err
	}
	if res.Master {
		if err := g.practise(c, family, g.puzzles().Param("master-solve-uses"), tick); err != nil {
			return nil, err
		}
	}
	if !res.Solved {
		g.haywired(c, a.Spec.Place, res.Haywire, at, tick)
	}
	return pressed, nil
}

// haywired is a haywire's reach past the fight: an alarm raises the
// region's threat at the next tick, a lockdown shuts the place's machines
// to this character.
func (g *Game) haywired(c *Char, place, haywire string, at hex.Hex, tick int64) {
	row := g.puzzles().HaywireRow(haywire)
	if row == nil {
		return
	}
	switch row.Effect {
	case effectAlarm:
		g.alarm(c, at, row.Magnitude)
	case effectLockdown:
		c.Lockdowns = append(c.Lockdowns, Lockdown{Place: place, Until: tick + row.Magnitude*sheets.TicksPerDay})
	}
}

func (g *Game) alarm(c *Char, at hex.Hex, threat int64) {
	if threat > 0 {
		g.Pending = append(g.Pending, world.Action{Kind: world.ActAlarm, Hex: at, By: char.Ref(c.C.ID), Units: threat})
	}
}

// lockdownDays is how long a failed pouch stays shut.
func (g *Game) lockdownDays() int64 {
	for _, h := range g.r.Book.Haywires {
		if h.Effect == effectLockdown {
			return h.Magnitude
		}
	}
	return 1
}

// pouchWorked opens a pouch whose lock was solved, paying exactly what it
// holds, or leaves it shut after a haywire.
func (g *Game) pouchWorked(c *Char, key string, a *Armed, res puzzle.Result, tick int64) error {
	i := c.pouch(a.Pouch)
	if i < 0 {
		return nil
	}
	p := &c.Pouches[i]
	rules := g.puzzles()
	if !res.Solved {
		p.Tries++
		row := rules.HaywireRow(res.Haywire)
		if row != nil && row.Effect == effectAlarm {
			g.alarm(c, c.C.At, row.Magnitude)
		} else {
			p.Shut = tick + g.lockdownDays()*sheets.TicksPerDay
		}
		data := []fact.Datum{fact.S("family", p.Family), fact.S("haywire", res.Haywire), fact.S("pouch", p.ID), fact.B("late", res.Late)}
		if row != nil {
			data = append(data, fact.N("magnitude", row.Magnitude))
		}
		if _, err := g.fact(c, "puzzle.haywire", tick, data...); err != nil {
			return err
		}
		return g.practise(c, p.Family, rules.Param("haywire-uses"), tick)
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
	if res.Master {
		uses += rules.Param("master-solve-uses")
	}
	return g.practise(c, family, uses, tick)
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
	p := g.puzzles()
	if p.Family(family) == nil || p.Gifts(before).Mastery || !p.Gifts(c.C.Level(family)).Mastery {
		return nil
	}
	_, err := g.fact(c, "puzzle.mastered", tick, fact.S("family", family), fact.N("settlement", int64(g.HomeOf(c))))
	return err
}

// Titles are the families a character holds mastery in, in id order.
func (g *Game) Titles(c *Char) []string {
	p := g.puzzles()
	var out []string
	for _, s := range c.C.Practice {
		if p.Family(s.ID) != nil && p.Gifts(s.Level).Mastery {
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
	family := pouchLocks[g.r.draw.Below(uint64(len(pouchLocks)), "game.pouch-family", draw.Str(id))]
	p := Pouch{ID: id, Hex: h, Goods: f.Goods, Family: family, Tier: tier}
	p.Level = g.puzzles().Level(family, tier, 0, puzzle.Where{Place: pouchPlace(id)})
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
	p, tiers := g.puzzles(), g.r.Book.FightTiers
	return p.Param("level-per-tier")*tiers[len(tiers)-1].Tier - 1 + p.Param("level-span") + p.Param("floors")/p.Param("floors-per-level")
}

// FaceMachine puts a character in an encounter of one beat, a machine of
// a family and level against the sheets' first creature: a lock for a
// family that is picked, a puzzle for any other. A solve wins the
// encounter; a haywire leaves it for another try.
func (g *Game) FaceMachine(c *Char, family string, level int64) {
	beat := beatPuzzle
	if g.puzzles().Family(family).Lockpick {
		beat = fight.BeatLock
	}
	h := c.C.At
	place := g.World.Place(h).Tags()
	ms := g.measures(h)
	c.Encounters++
	e := &fight.Encounter{ID: "e-" + c.C.ID + "-" + strconv.FormatInt(c.Encounters, decimal), Creature: g.r.Fight.Spawn(g.r.Book.Creatures[0].ID, nil, place, ms),
		Site: place, Measures: ms, Beats: []string{beat}, Machines: []string{family}, Levels: []int64{level}, Party: 1, Guardian: -1}
	c.Long, c.Fight = nil, &Fight{E: e, Measures: ms}
}

// setMachine is an operator standing a free character before a machine,
// recorded as a fact. A character who has never armed one still meets the
// opening Rewire first.
func (g *Game) setMachine(c *Char, cmd Command) error {
	if top := g.topLevel(); cmd.Note == "" || !g.puzzles().Known(cmd.Asset) || cmd.Units < 1 || cmd.Units > top {
		return refuse(BadArgs, "a machine needs a family, a level from 1 to %d and a note", top)
	}
	if c.Banned || c.Armed != nil {
		return refuse(Busy, "%s is banned or has a machine armed", c.C.ID)
	}
	if err := free(c); err != nil {
		return err
	}
	g.FaceMachine(c, cmd.Asset, cmd.Units)
	_, err := g.fact(c, "machine.set", g.Tick(), fact.S("family", cmd.Asset), fact.N("level", cmd.Units), fact.S("note", cmd.Note))
	return err
}
