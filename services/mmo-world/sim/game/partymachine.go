package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// seatsOf are who sits at a party's machine: the members present and up,
// in seat order.
func (g *Game) seatsOf(sh *Shared) []*Char {
	if sh.Fork != nil {
		return g.atFork(sh)
	}
	return g.upIn(sh)
}

// partyArm arms a party's machine for every seat at its first touch
// (GDD 7.11): the beat's, or one a fork or a guardian mark staged. The
// spec is fixed here, so every seat holds one layout.
func (g *Game) partyArm(c *Char, cmd Command) error {
	src := cmd.Machine.Source
	sh := g.sharedOf(c)
	if sh == nil {
		return refuse(NoMachine, "%s is in no party's encounter or fork", c.C.ID)
	}
	if err := notDown(c); err != nil {
		return err
	}
	if sh.Machine.Armed() {
		return refuse(MachineArmed, "the party's machine is armed already")
	}
	spec, err := g.partySpec(sh, c, src)
	if err != nil {
		return err
	}
	seats := g.seatsOf(sh)
	if !slices.Contains(seats, c) {
		return refuse(NoMachine, "%s has no seat at the machine", c.C.ID)
	}
	tick := g.Tick()
	if left := c.lockedFor(spec.Place, tick); left > 0 {
		return refuse(LockedDown, "locked down for %d more ticks", left)
	}
	p := g.Puzzles()
	spec.Shape = p.Shape(spec.Family, spec.Level, spec.Where())
	if len(seats) > 1 {
		if v := p.PartyVersion(spec.Family, spec.Where()); v != "" {
			spec.Party, spec.Seats = v, int64(len(seats))
		}
	}
	m := &PartyMachine{Source: src, Spec: spec, At: cmd.Now, Tick: tick}
	for _, s := range seats {
		m.Seats = append(m.Seats, s.C.ID)
		m.Practice = max(m.Practice, s.C.Level(spec.Family))
	}
	if spec.Party != "" {
		m.Countdown = p.PartyCountdown(spec, m.Practice)
	} else {
		m.Countdown = p.Countdown(spec.Family, spec.Level, spec.Tier, m.Practice)
	}
	sh.Machine, sh.LostRace, sh.Movers = m, "", nil
	for _, s := range seats {
		s.Worked++
		s.LastMachine = nil
		s.Lockdowns = slices.DeleteFunc(s.Lockdowns, func(l Lockdown) bool { return l.Until <= tick })
		if s != c {
			g.touchOnce(s)
		}
	}
	if src == SourceFork {
		g.race(sh)
	}
	_, err = g.factWith(c, sh.refs(), "machine.armed", tick, fact.S("family", spec.Family), fact.N("level", spec.Level), fact.S("source", src),
		fact.S("party", spec.Party), fact.N("seats", int64(len(seats))))
	return err
}

// partySpec is the machine a party arms from a source: the beat's, from
// the encounter; the fork's; or the one a guardian mark staged.
func (g *Game) partySpec(sh *Shared, c *Char, src string) (puzzle.Spec, error) {
	switch src {
	case SourceFork:
		fm, err := g.forkMachine(c)
		if err != nil {
			return puzzle.Spec{}, err
		}
		return puzzle.Spec{Family: fm.Family, Level: fm.Level, Tier: fm.Tier, Place: fm.Place, Beat: fm.Beat}, nil
	case SourceGuardian:
		if sh.Machine == nil || sh.Machine.Source != src || g.encounterOf(sh) == nil {
			return puzzle.Spec{}, refuse(NoMachine, "no guardian machine stands before %s", c.C.ID)
		}
		return sh.Machine.Spec, nil
	}
	e := g.encounterOf(sh)
	if e == nil || c.Fight == nil || c.Fight.Shared != sh.ID {
		return puzzle.Spec{}, refuse(NoMachine, "%s faces no machine it can reach", c.C.ID)
	}
	family, _, ok := g.r.Fight.Machine(e)
	if _, reach := g.machineOption(c); !ok || !reach {
		return puzzle.Spec{}, refuse(NoMachine, "%s faces no machine it can reach", c.C.ID)
	}
	return puzzle.Spec{Family: family, Level: e.Levels[e.At], Tier: e.Creature.Tier, Place: machinePlace(sh.Hex, e.Floor), Beat: int64(e.At),
		Attempt: e.Press}, nil
}

// partySolve plays the merged log against a party's armed machine: one
// result for every seat, and only the seats that moved credited.
func (g *Game) partySolve(c *Char, cmd Command) ([]fight.Pressed, *puzzle.Result, error) {
	sh := g.sharedOf(c)
	if sh == nil {
		return nil, nil, refuse(NoMachine, "%s has no machine armed", c.C.ID)
	}
	m := sh.Machine
	if !m.Armed() {
		if sh.LostRace != "" {
			return nil, nil, refuse(RivalWon, "another party took the machine first")
		}
		return nil, nil, refuse(NoMachine, "the party has no machine armed")
	}
	if !slices.Contains(m.Seats, c.C.ID) {
		return nil, nil, refuse(NoMachine, "%s has no seat at the machine", c.C.ID)
	}
	log := cmd.Machine.log()
	elapsed := int64(-1)
	if m.At > 0 && cmd.Now > 0 {
		elapsed = max(0, cmd.Now-m.At)
	}
	p := g.Puzzles()
	res := p.Play(m.Spec, log, puzzle.Limits{Countdown: m.Countdown, Elapsed: elapsed, Master: len(m.Seats) == 1 && g.mastery(m.Practice)})
	if !res.Solved {
		res.Haywire = g.haywireOf(m.Spec, false)
	}
	movers := moversOf(m, log)
	seats := g.seatChars(m)
	tick := g.Tick()
	var pressed []fight.Pressed
	var err error
	switch m.Source {
	case SourceParty:
		pressed, err = g.machineBeat(sh, c, m, res, movers, cmd.Key, tick)
	case SourceFork:
		err = g.forkWorked(sh, c, m, seats, res, movers, tick)
	case SourceGuardian:
		err = g.guardianWorked(sh, m, seats, res, movers, tick)
	}
	if err != nil {
		return nil, nil, err
	}
	if m.Rival != "" {
		if err := g.raced(sh, m, res, tick, cmd.Now); err != nil {
			return nil, nil, err
		}
	}
	if sh.Machine == m {
		sh.Machine = nil
	}
	// The window waits while the machine runs.
	if sh.Opened > 0 && m.At > 0 && cmd.Now > m.At {
		sh.Opened += cmd.Now - m.At
	}
	sh.Movers = movers
	for _, s := range seats {
		s.LastMachine = &MachineDone{Source: m.Source, Family: m.Spec.Family, Level: m.Spec.Level, Tick: tick, Result: res}
		if s != c {
			g.touchOnce(s)
		}
	}
	return pressed, &res, nil
}

// moversOf are the seats a merged log has moves from, in seat order.
func moversOf(m *PartyMachine, log puzzle.Log) []string {
	var out []string
	for i, id := range m.Seats {
		if slices.ContainsFunc(log.Moves, func(mv puzzle.Move) bool { return mv.Seat == int64(i) }) {
			out = append(out, id)
		}
	}
	return out
}

func (g *Game) seatChars(m *PartyMachine) []*Char {
	var out []*Char
	for _, id := range m.Seats {
		if c := g.Char(id); c != nil {
			out = append(out, c)
		}
	}
	return out
}

// machineBeat resolves a beat's party machine: every member present takes
// the machine with the one result.
func (g *Game) machineBeat(sh *Shared, actor *Char, m *PartyMachine, res puzzle.Result, movers []string, key string, tick int64) ([]fight.Pressed, error) {
	e := g.encounterOf(sh)
	if e == nil || e.At != int(m.Spec.Beat) {
		return nil, g.partyFailed(g.seatChars(m), m, res, tick, retryTicks)
	}
	in, ms := g.sharedMembers(sh, tick)
	before := make([]int64, len(in))
	for i, c := range in {
		before[i] = c.C.Level(m.Spec.Family)
	}
	packs := packsOf(in)
	g.attachPool(sh.Hex, e, tick)
	pressed, facts, err := g.r.Fight.PressMachine(e, ms, res, movers, tick)
	if err != nil {
		return nil, err
	}
	if err := g.guardianPressed(sh.Hex, e, sh, tick); err != nil {
		return nil, err
	}
	beat := e.At
	if err := g.afterShared(sh, actor, in, packs, pressed, facts, key, tick, &worked{res: res}); err != nil {
		return nil, err
	}
	for i, c := range in {
		if err := g.mastered(c, m.Spec.Family, before[i], tick); err != nil {
			return nil, err
		}
	}
	if !res.Solved {
		var least int64
		if !e.Over && e.At == beat {
			least = retryTicks
		}
		g.partyHaywired(g.seatChars(m), m.Spec.Place, res.Haywire, tick, least)
	}
	return pressed, nil
}

// forkWorked is a fork machine worked: its reach past the fork for every
// seat, then what the result opens (GDD 4.9). Only a lone seat's result
// can be a master's.
func (g *Game) forkWorked(sh *Shared, c *Char, m *PartyMachine, seats []*Char, res puzzle.Result, movers []string, tick int64) error {
	var err error
	if res.Solved {
		err = g.partySolved(seats, m, res, movers, tick)
	} else {
		err = g.partyFailed(seats, m, res, tick, 0)
	}
	if err != nil {
		return err
	}
	return g.forkSolved(c, sh, res)
}

// guardianWorked boosts the presses after a guardian mark's machine is
// solved (GDD 4.9).
func (g *Game) guardianWorked(sh *Shared, m *PartyMachine, seats []*Char, res puzzle.Result, movers []string, tick int64) error {
	if !res.Solved {
		return g.partyFailed(seats, m, res, tick, 0)
	}
	if e := g.encounterOf(sh); e != nil {
		e.Boost(g.r.Fight.Param("guardian-solve-bonus"), g.r.Fight.Param("guardian-solve-beats"))
	}
	return g.partySolved(seats, m, res, movers, tick)
}

// partySolved is a solved machine off the beat: a fact for each seat, and
// practice for each seat that moved.
func (g *Game) partySolved(seats []*Char, m *PartyMachine, res puzzle.Result, movers []string, tick int64) error {
	uses := g.Puzzles().Param("live-solve-uses") + g.masterUses(res)
	for _, s := range seats {
		if _, err := g.fact(s, "puzzle.solved", tick, fact.S("family", m.Spec.Family), fact.N("level", m.Spec.Level), fact.S("source", m.Source),
			fact.N("ms", res.At), fact.B("clean", res.Clean), fact.B("master", res.Master)); err != nil {
			return err
		}
		if slices.Contains(movers, s.C.ID) {
			if err := g.practise(s, m.Spec.Family, uses, tick); err != nil {
				return err
			}
		}
	}
	return nil
}

// partyFailed is a party machine off the beat that haywired: its reach
// past the fight once for all, and a fact and the practice a failure
// pays for each seat.
func (g *Game) partyFailed(seats []*Char, m *PartyMachine, res puzzle.Result, tick, least int64) error {
	g.partyHaywired(seats, m.Spec.Place, res.Haywire, tick, least)
	rules := g.Puzzles()
	for _, s := range seats {
		data := []fact.Datum{fact.S("family", m.Spec.Family), fact.S("haywire", res.Haywire), fact.S("source", m.Source), fact.B("late", res.Late)}
		if row := rules.HaywireRow(res.Haywire); row != nil {
			data = append(data, fact.N("magnitude", row.Magnitude))
		}
		if _, err := g.fact(s, "puzzle.haywire", tick, data...); err != nil {
			return err
		}
		if err := g.practise(s, m.Spec.Family, rules.Param("haywire-uses"), tick); err != nil {
			return err
		}
	}
	return nil
}

// partyHaywired is a party machine's haywire past the fight: one alarm for
// the machine, and a lockdown on every seat.
func (g *Game) partyHaywired(seats []*Char, place, haywire string, tick, least int64) {
	for i, s := range seats {
		if i == 0 {
			g.haywired(s, place, haywire, s.C.At, tick, least)
			continue
		}
		shut := least
		if row := g.Puzzles().HaywireRow(haywire); row != nil && row.Effect == puzzle.EffectLockdown {
			shut = max(shut, row.Magnitude*sheets.TicksPerDay)
		}
		if shut > 0 {
			s.Lockdowns = append(s.Lockdowns, Lockdown{Place: place, Until: tick + shut})
		}
	}
}

// PartyRig is a party's machine as one seat holds it: the one spec, the
// seat's dealt view of its one layout, and the clock. Glimpse is the next
// seat's view of a split machine, for a seat whose practice gives it
// (GDD 7.11).
type PartyRig struct {
	Machine *PartyMachine
	Seat    int64 // -1 for a member with no seat
	Layout  puzzle.Layout
	Glimpse *puzzle.Layout
}

// PartyRigOf is the armed machine a character's shared encounter or fork
// holds, with the character's dealt part of it.
func (g *Game) PartyRigOf(c *Char) (PartyRig, bool) {
	sh := g.sharedOf(c)
	if sh == nil || sh.Machine == nil || !sh.Machine.Armed() {
		return PartyRig{}, false
	}
	m := sh.Machine
	out := PartyRig{Machine: m, Seat: int64(slices.Index(m.Seats, c.C.ID))}
	if out.Seat < 0 {
		return out, true
	}
	p := g.Puzzles()
	parts := p.Deal(m.Spec)
	out.Layout = parts[min(out.Seat, int64(len(parts)-1))]
	if len(parts) > 1 && g.dealtSplit(m.Spec.Party) && p.Gifts(c.C.Level(m.Spec.Family)).Glimpse {
		next := parts[(out.Seat+1)%int64(len(parts))]
		out.Glimpse = &next
	}
	return out, true
}

// dealtSplit reports whether a party version deals each seat its own part.
func (g *Game) dealtSplit(version string) bool {
	i := slices.IndexFunc(g.r.Book.PartyVersions, func(v sheets.PartyVersion) bool { return v.ID == version })
	return i >= 0 && g.r.Book.PartyVersions[i].Deals == dealsSplit
}

// structural: the puzzles.party deals value that hides from each seat
// what the others hold.
const dealsSplit = "split"

// ArmedParties are the shared encounters and forks whose machine's
// countdown is running.
func (g *Game) ArmedParties() []*Shared {
	var out []*Shared
	for _, sh := range g.Shared {
		if sh.Machine.Armed() {
			out = append(out, sh)
		}
	}
	return out
}

// PartyDue is when a party machine's merged log is late: its deadline and
// the grace.
func (g *Game) PartyDue(m *PartyMachine) int64 { return m.Deadline() + g.Puzzles().Grace() }

// FacePartyMachine puts characters who stand together into one shared
// encounter of one beat, a machine of a family and level, as FaceMachine
// does one character: a lock for a family that is picked, a puzzle for
// any other.
func (g *Game) FacePartyMachine(cs []*Char, family string, level int64) *Shared {
	beat := beatPuzzle
	if g.Puzzles().Family(family).Lockpick {
		beat = fight.BeatLock
	}
	lead := cs[0]
	h := lead.C.At
	place := g.World.Place(h).Tags()
	ms := append(g.measures(h), tags.Measure{ID: measurePartySize, Value: int64(len(cs))})
	lead.Encounters++
	e := &fight.Encounter{ID: "e-" + lead.C.ID + "-" + strconv.FormatInt(lead.Encounters, decimal), Creature: g.r.Fight.Spawn(g.r.Book.Creatures[0].ID, nil, place, ms),
		Site: place, Measures: ms, Beats: []string{beat}, Machines: []string{family}, Levels: []int64{level}, Party: int64(len(cs)), Guardian: -1}
	sh := g.newShared(g.partyOf(lead), h, lead.C.Floor, cs)
	for _, c := range cs {
		c.Long, c.Fight = nil, &Fight{E: e, Measures: ms, Shared: sh.ID}
	}
	return sh
}
