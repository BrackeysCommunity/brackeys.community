package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// A fork is where a won floor offers its ways down (GDD 4.9): way 0 stands
// open, way 1 is behind a machine on half the forks, and the hidden third
// opens to a lone master of that machine or to a held key. Every member
// present pushes down a way or leaves; only pushers vote. A fork waits on
// a Shared record, a lone delver's too, which ends when it resolves.

// structural: a fork machine stands past the floor's last beat, one for
// each way in; fork-default's choice that pushes on.
const (
	forkBeat = -1
	forkPush = "push"
)

// forkOf is the open fork a character stands at, and the record holding
// it.
func (g *Game) forkOf(c *Char) (*ForkState, *Shared) {
	if c.C.Floor == 0 {
		return nil, nil
	}
	if sh := g.sharedWhere(c, c.C.Floor, func(sh *Shared) bool { return sh.Fork != nil }); sh != nil {
		return sh.Fork, sh
	}
	return nil, nil
}

// sharedAt is the record of the party encounter a member has just fought
// on floor n, if it was a party's.
func (g *Game) sharedAt(c *Char, n int64) *Shared {
	return g.sharedWhere(c, n, func(*Shared) bool { return true })
}

// sharedWhere is the first record on floor n of the hex c stands on that
// lists c as a member and passes ok.
func (g *Game) sharedWhere(c *Char, n int64, ok func(*Shared) bool) *Shared {
	for _, sh := range g.Shared {
		if sh.Hex == c.C.At && sh.Floor == n && slices.Contains(sh.Members, c.C.ID) && ok(sh) {
			return sh
		}
	}
	return nil
}

// openFork opens the fork below floor n for a member who has won it: once
// on the party's record, or on a lone delver's new one. A machine behind
// way 1 is staged on it, to be armed by whoever stands there.
func (g *Game) openFork(c *Char, n int64) {
	sh := g.sharedAt(c, n)
	if sh != nil && sh.Fork != nil {
		return
	}
	if sh == nil {
		sh = g.newShared(g.partyOf(c), c.C.At, n, []*Char{c})
	}
	h := c.C.At
	fp := g.FloorAt(h, n, c.Delving.Way, g.tierAt(h))
	f := &ForkState{Floor: n, Open: []int64{gen.WayOpen}}
	if !fp.Machine {
		f.Open = append(f.Open, gen.WayMachine)
	}
	sh.Fork, sh.Picks, sh.Opened, sh.Machine, sh.Movers = f, nil, 0, nil, nil
}

// ForkMachine is the machine behind a fork's way 1: one for everyone who
// reaches that fork by the same way in.
type ForkMachine struct {
	Family string `json:"family"`
	Level  int64  `json:"level"`
	Tier   int64  `json:"tier"`
	Place  string `json:"place"`
	Beat   int64  `json:"beat"`
}

// forkMachine is the machine of the fork a character stands at, or why
// there is none to arm: no fork, no machine on it, or one already worked.
// Its level is the floor's stepped tier's (GDD 4.9).
func (g *Game) forkMachine(c *Char) (ForkMachine, error) {
	f, _ := g.forkOf(c)
	if f == nil {
		return ForkMachine{}, refuse(NoFork, "%s stands at no fork", c.C.ID)
	}
	h := c.C.At
	fp := g.FloorAt(h, f.Floor, c.Delving.Way, g.tierAt(h))
	switch {
	case !fp.Machine || fp.Family == "":
		return ForkMachine{}, refuse(NoMachine, "no machine stands at this fork")
	case f.Worked:
		return ForkMachine{}, refuse(Used, "this fork's machine has been worked")
	}
	m := ForkMachine{Family: fp.Family, Tier: fp.Step.Tier, Place: machinePlace(h, f.Floor), Beat: forkBeat - (c.Delving.Way - noWay)}
	m.Level = g.r.Fight.P.Level(m.Family, m.Tier, 0, puzzle.Where{Place: m.Place, Beat: m.Beat})
	return m, nil
}

// forkSolved is what a fork machine's result does to the fork: solved, way
// 1 opens, and the third way too for a master; a haywire leaves only the
// open way. Either way it is not armed again.
func (g *Game) forkSolved(c *Char, sh *Shared, res puzzle.Result) error {
	if sh == nil || sh.Fork == nil {
		return refuse(NoFork, "%s stands at no fork", c.C.ID)
	}
	f := sh.Fork
	f.Worked = true
	if !res.Solved {
		f.Open = []int64{gen.WayOpen}
		return nil
	}
	f.Solved = true
	f.Open = addWay(f.Open, gen.WayMachine)
	if res.Master {
		f.Open = addWay(f.Open, gen.WayHidden)
	}
	return nil
}

func addWay(open []int64, w int64) []int64 {
	if !slices.Contains(open, w) {
		open = append(open, w)
		slices.Sort(open)
	}
	return open
}

// forkWindow closes a party's fork when its pick window runs out: whoever
// present has not chosen takes fork-default, and the fork resolves.
func (g *Game) forkWindow(sh *Shared, tick int64) error {
	f := sh.Fork
	present := g.atFork(sh)
	push := sheets.ChoiceParam(g.r.Book.FightParams, "fork-default") == forkPush
	for _, m := range present {
		if _, ok := choiceOf(f, m.C.ID); !ok {
			f.Choices = append(f.Choices, Choice{Who: m.C.ID, Push: push, Way: gen.WayOpen})
		}
	}
	return g.resolveFork(sh, present, tick, nil)
}

// dropShared ends a party's record once nobody waits on it.
func (g *Game) dropShared(sh *Shared) {
	if sh == nil {
		return
	}
	g.Shared = slices.DeleteFunc(g.Shared, func(x *Shared) bool { return x == sh })
}

// atFork are the members of a fork who stand there to choose: on its tile
// and floor, not down, not climbing and in no encounter.
func (g *Game) atFork(sh *Shared) []*Char {
	var out []*Char
	for _, id := range sh.Members {
		m := g.Char(id)
		if m != nil && m.C.At == sh.Hex && m.C.Floor == sh.Floor && ready(m) == nil && m.Delving != nil {
			out = append(out, m)
		}
	}
	return out
}

func choiceOf(f *ForkState, who string) (Choice, bool) {
	i := slices.IndexFunc(f.Choices, func(x Choice) bool { return x.Who == who })
	if i < 0 {
		return Choice{}, false
	}
	return f.Choices[i], true
}

func (g *Game) allChose(f *ForkState, present []*Char) bool {
	for _, m := range present {
		if _, ok := choiceOf(f, m.C.ID); !ok {
			return false
		}
	}
	return true
}

// keyHolder is the first of the members present, in seat order, who holds
// a key for the dungeon at h.
func keyHolder(present []*Char, h hex.Hex) *Char {
	for _, m := range present {
		if slices.Contains(m.Keys, h.Ref()) {
			return m
		}
	}
	return nil
}

// openTo reports whether a way may be voted for: it stands open, or it is
// the third and a key for this dungeon is held among those present.
func openTo(f *ForkState, way int64, present []*Char, h hex.Hex) bool {
	return slices.Contains(f.Open, way) || way == gen.WayHidden && keyHolder(present, h) != nil
}

func (g *Game) dungeonPush(c *Char, cmd Command) error {
	if err := notDown(c); err != nil {
		return err
	}
	if c.C.Floor == 0 {
		return g.pushThrough(c, cmd)
	}
	f, sh := g.forkOf(c)
	if f == nil {
		return refuse(NoFork, "%s stands at no fork", c.C.ID)
	}
	way, ok := wayOf(cmd.Option)
	if !ok {
		return refuse(BadArgs, "a push names a way, way-0 to way-2")
	}
	present := g.atFork(sh)
	if !openTo(f, way, present, c.C.At) {
		return refuse(NoWay, "way %d does not stand open", way)
	}
	return g.forkChoose(c, cmd, sh, present, Choice{Who: c.C.ID, Push: true, Way: way})
}

func (g *Game) dungeonLeave(c *Char, cmd Command) error {
	f, sh := g.forkOf(c)
	if f == nil {
		return refuse(NoFork, "%s stands at no fork", c.C.ID)
	}
	return g.forkChoose(c, cmd, sh, g.atFork(sh), Choice{Who: c.C.ID})
}

// forkChoose records a member's choice in the open, and resolves the fork
// once everyone present has chosen: at once for a lone delver. The first
// choice opens the fork's window.
func (g *Game) forkChoose(c *Char, cmd Command, sh *Shared, present []*Char, ch Choice) error {
	f := sh.Fork
	if _, ok := choiceOf(f, c.C.ID); ok {
		return refuse(Chose, "%s has chosen at this fork", c.C.ID)
	}
	if !slices.Contains(present, c) {
		return refuse(Busy, "%s is busy", c.C.ID)
	}
	f.Choices = append(f.Choices, ch)
	if sh.Opened == 0 {
		sh.Opened = cmd.Now
	}
	if !g.allChose(f, present) {
		var others []string
		for _, m := range present {
			if m != c {
				others = append(others, m.C.ID)
			}
		}
		g.saw(others...)
		return nil
	}
	return g.resolveFork(sh, present, g.Tick(), c)
}

// forkVote is the way most pushers voted for: a tie goes to the leader's
// way if the leader voted among the tied, else to the lowest of them. The
// third way counts only while it stands open or a pusher holds a key.
func forkVote(f *ForkState, present []*Char, leader string, hidden bool) (way int64, pushers, leavers []*Char) {
	var votes [gen.WayHidden + 1]int64
	for _, m := range present {
		ch, _ := choiceOf(f, m.C.ID)
		if !ch.Push {
			leavers = append(leavers, m)
			continue
		}
		pushers = append(pushers, m)
		if hidden || ch.Way != gen.WayHidden {
			votes[ch.Way]++
		}
	}
	most := slices.Max(votes[:])
	way = int64(slices.Index(votes[:], most))
	if ch, ok := choiceOf(f, leader); ok && ch.Push && (hidden || ch.Way != gen.WayHidden) && votes[ch.Way] == most {
		way = ch.Way
	}
	return way, pushers, leavers
}

// resolveFork sends the leavers climbing and the pushers down the way the
// vote chose, as one smaller party; the fork's record ends either way.
func (g *Game) resolveFork(sh *Shared, present []*Char, tick int64, actor *Char) error {
	f := sh.Fork
	g.dropShared(sh)
	if len(present) == 0 {
		return nil
	}
	h, n := sh.Hex, sh.Floor
	leader := present[0].C.ID
	if p := g.partyOf(present[0]); p != nil {
		leader = p.Leader
	}
	_, pushers, _ := forkVote(f, present, leader, true)
	hidden := slices.Contains(f.Open, gen.WayHidden) || keyHolder(pushers, h) != nil
	way, pushers, leavers := forkVote(f, present, leader, hidden)
	key := ledger.SubKey("fork", h.Ref(), strconv.FormatInt(n, decimal), strconv.FormatInt(tick, decimal))
	for _, m := range present {
		if m != actor {
			g.touchOnce(m)
		}
	}
	for _, m := range leavers {
		if err := g.climbOut(m, ledger.SubKey(key, m.C.ID)); err != nil {
			return err
		}
	}
	data := append([]fact.Datum{fact.N("floor", n), fact.N("pushed", int64(len(pushers))), fact.N("left", int64(len(leavers)))}, fact.At(h)...)
	if len(pushers) > 0 {
		data = append(data, fact.N("way", way))
	}
	var also []fact.Ref
	for _, m := range present[1:] {
		also = append(also, char.Ref(m.C.ID))
	}
	if _, err := g.factWith(present[0], also, "dungeon.forked", tick, data...); err != nil {
		return err
	}
	if len(pushers) == 0 {
		return nil
	}
	if way == gen.WayHidden && !slices.Contains(f.Open, gen.WayHidden) {
		if err := g.useKey(keyHolder(pushers, h), h, tick); err != nil {
			return err
		}
	}
	if !g.pendingFloor(h, n, way+wayRecorded) {
		g.Pending = append(g.Pending, world.Action{Kind: world.ActFloorCleared, Hex: h, By: char.Ref(pushers[0].C.ID), Floor: n, Way: way + wayRecorded})
	}
	var bonus int64
	if way == gen.WayMachine && f.Solved {
		bonus = g.forkHaulPct()
	}
	for _, m := range pushers {
		m.Delving.Way, m.Delving.Bonus = way, bonus
	}
	if len(pushers) == 1 && g.rescuing(pushers[0]) != nil && g.floorRead(h, n+1) {
		return g.through(pushers[0], n+1, tick)
	}
	return g.begin(pushers[0], false, 0)
}

// useKey spends a held key on the third way: the-key, its magnitude used up.
func (g *Game) useKey(m *Char, h hex.Hex, tick int64) error {
	if m == nil {
		return nil
	}
	tr := g.trigger(TrigTheKey)
	for range tr.Magnitude {
		if i := slices.Index(m.Keys, h.Ref()); i >= 0 {
			m.Keys = slices.Delete(m.Keys, i, i+1)
		}
	}
	if len(m.Keys) == 0 {
		m.Keys = nil
	}
	if _, err := g.fact(m, "trigger.fired", tick, fact.S("trigger", TrigTheKey)); err != nil {
		return err
	}
	_, err := g.fact(m, "key.used", tick, fact.At(h)...)
	return err
}

// ForkRead is a fork as a member standing at it sees it: every way's
// name and tags, which stand open, the machine behind way 1, the votes so
// far and who chose what, all in the open. The third way shows once it
// can be taken.
type ForkRead struct {
	Shared  string    `json:"shared"`
	Floor   int64     `json:"floor"`
	Ways    []WayRead `json:"ways"`
	Choices []Choice  `json:"choices,omitempty"`
	Opened  int64     `json:"opened,omitempty"`
	Present []string  `json:"present"`
	Due     int64     `json:"due,omitempty"` // service ms, once the window opened
	Worked  bool      `json:"worked,omitempty"`
}

// WayRead is one way down. Next is what Mapper sees of the floor it leads
// to: its tags and its creature, the floor's first beat being drawn only
// once its encounter begins.
type WayRead struct {
	Way     int64    `json:"way"`
	Fork    string   `json:"fork"` // map.forks row
	Tags    []string `json:"tags"`
	Open    bool     `json:"open"`
	Machine string   `json:"machine,omitempty"`
	Next    []string `json:"next,omitempty"`
	Votes   int64    `json:"votes"`
}

// Fork is the fork a character stands at, as it sees it, or nil.
func (g *Game) Fork(c *Char) *ForkRead {
	f, sh := g.forkOf(c)
	if f == nil {
		return nil
	}
	h := c.C.At
	present := g.atFork(sh)
	fp := g.FloorAt(h, sh.Floor, c.Delving.Way, g.tierAt(h))
	out := &ForkRead{Shared: sh.ID, Floor: sh.Floor, Choices: f.Choices, Opened: sh.Opened, Worked: f.Worked}
	if len(present) > 1 {
		out.Due = g.WindowDue(sh)
	}
	for _, m := range present {
		out.Present = append(out.Present, m.C.ID)
	}
	maps := g.Maps(c)
	for w := int64(gen.WayOpen); w <= gen.WayHidden; w++ {
		open := openTo(f, w, present, h)
		if w == gen.WayHidden && !open {
			continue
		}
		way := fp.Ways[w]
		r := WayRead{Way: w, Fork: way.Fork, Tags: tagStrings(way.Tags), Open: open}
		if w == gen.WayMachine && fp.Machine {
			r.Machine = fp.Family
		}
		for _, ch := range f.Choices {
			if ch.Push && ch.Way == w {
				r.Votes++
			}
		}
		if maps {
			// A drawn floor nobody has reached shows its tags alone: what
			// lives there is drawn at its first reach.
			if next := g.FloorAt(h, sh.Floor+1, w, g.tierAt(h)); next.N != 0 {
				r.Next = append(tagStrings(next.Tags), next.Creature)
			} else {
				r.Next = tagStrings(g.floorTags(h, sh.Floor+1, w, g.tierAt(h)))
			}
		}
		out.Ways = append(out.Ways, r)
	}
	return out
}

// forkHaulPct is the more a floor's haul is for the solved fork machine
// it was reached through.
func (g *Game) forkHaulPct() int64 { return sheets.IntParam(g.r.Book.MapParams, "fork-machine-haul") }
