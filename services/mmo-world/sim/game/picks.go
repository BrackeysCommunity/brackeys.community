package game

import (
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/party"
	"jams.team/mmo-world/sim/tally"
	"jams.team/mmo-world/sim/world"
)

// pickOf is a member's held pick on the beat, or "".
func (sh *Shared) pickOf(who string) string {
	if i := slices.IndexFunc(sh.Picks, func(p HeldPick) bool { return p.Who == who }); i >= 0 {
		return sh.Picks[i].Option
	}
	return ""
}

// partyPick holds a member's pick, unseen by the others, until everyone
// present has picked; the last pick resolves the beat (GDD 7.5).
func (g *Game) partyPick(c *Char, cmd Command) ([]fight.Pressed, error) {
	sh := g.sharedOf(c)
	if c.Fight == nil || sh == nil || c.Fight.Shared != sh.ID {
		return nil, refuse(NoFight, "%s is in no shared encounter", c.C.ID)
	}
	if err := notDown(c); err != nil {
		return nil, err
	}
	if sh.pickOf(c.C.ID) != "" {
		return nil, refuse(Picked, "%s has picked on this beat", c.C.ID)
	}
	o, ok := g.Option(c, cmd.Option)
	if !ok {
		return nil, refuse(BadArgs, "no option %q on this beat", cmd.Option)
	}
	if o.Puzzle {
		return nil, refuse(InActivity, "a machine is worked in the Activity")
	}
	sh.Picks = append(sh.Picks, HeldPick{Who: c.C.ID, Option: o.ID})
	if sh.Opened == 0 {
		sh.Opened = cmd.Now
	}
	g.saw(sh.Members...)
	for _, m := range g.upIn(sh) {
		if sh.pickOf(m.C.ID) == "" {
			return nil, nil
		}
	}
	return g.resolveShared(sh, c, cmd.Key, g.Tick())
}

// partyWindow ends a beat's or a fork's window: whoever has not chosen
// takes the cautious choice. The service's clock says when; a window
// waits while the party's machine is armed.
func (g *Game) partyWindow(c *Char, cmd Command) ([]fight.Pressed, error) {
	sh := g.SharedByID(cmd.Target)
	if sh == nil || !slices.Contains(sh.Members, c.C.ID) {
		return nil, refuse(NoFight, "no shared encounter %q for %s", cmd.Target, c.C.ID)
	}
	if sh.Machine.Armed() {
		return nil, refuse(MachineArmed, "the party's machine is armed and its countdown is running")
	}
	if sh.Opened == 0 || cmd.Now < sh.Opened+g.PartyWindowMs() {
		return nil, refuse(NotDue, "the window is not over")
	}
	if sh.Fork != nil {
		return nil, g.forkWindow(sh, g.Tick())
	}
	if g.encounterOf(sh) == nil {
		return nil, refuse(NoFight, "the encounter is over")
	}
	cautious := g.r.Fight.Cautious()
	for _, m := range g.upIn(sh) {
		if sh.pickOf(m.C.ID) == "" {
			sh.Picks = append(sh.Picks, HeldPick{Who: m.C.ID, Option: cautious})
		}
	}
	return g.resolveShared(sh, c, cmd.Key, g.Tick())
}

// sharedDue resolves a shared ambush nobody came back to by its due tick:
// whoever has not picked backs out, or holds where they cannot.
func (g *Game) sharedDue(c *Char, t int64) error {
	sh := g.SharedByID(c.Fight.Shared)
	if sh == nil || !c.Fight.Ambush || c.Fight.Due >= t || sh.Machine.Armed() {
		return nil
	}
	in := g.upIn(sh)
	if len(in) == 0 || in[0] != c {
		return nil
	}
	for _, m := range in {
		if sh.pickOf(m.C.ID) != "" {
			continue
		}
		pick := g.r.Fight.Cautious()
		if _, ok := g.Option(m, wayOut); ok {
			pick = wayOut
		}
		sh.Picks = append(sh.Picks, HeldPick{Who: m.C.ID, Option: pick})
	}
	key := ledger.SubKey("tick", strconv.FormatInt(t, decimal), sh.ID, "ambush")
	_, err := g.resolveShared(sh, nil, key, t)
	return err
}

// sharedMembers are fight members for everyone still in a shared
// encounter, with the pick each holds; a pick the beat no longer offers
// becomes the cautious one.
func (g *Game) sharedMembers(sh *Shared, tick int64) ([]*Char, []*fight.Member) {
	in := g.in(sh)
	ms := make([]*fight.Member, len(in))
	for i, c := range in {
		kit, opts := g.beat(c, tick)
		pick := sh.pickOf(c.C.ID)
		if _, ok := fight.OptionByID(opts, pick); !ok {
			pick = g.r.Fight.Cautious()
		}
		ms[i] = &fight.Member{Ch: c.C, Kit: kit, Pick: pick}
	}
	return in, ms
}

// resolveShared presses a shared encounter's beat with every pick held.
// actor is the command's own character, whose row Act moves itself; nil
// on a tick.
func (g *Game) resolveShared(sh *Shared, actor *Char, key string, tick int64) ([]fight.Pressed, error) {
	in, ms := g.sharedMembers(sh, tick)
	if len(in) == 0 {
		return nil, refuse(NoFight, "the encounter is over")
	}
	packs := packsOf(in)
	e := in[0].Fight.E
	g.attachPool(sh.Hex, e, tick)
	pressed, facts, err := g.r.Fight.Press(e, ms, tick)
	if err != nil {
		return nil, err
	}
	if err := g.guardianPressed(sh.Hex, e, sh, tick); err != nil {
		return nil, err
	}
	return pressed, g.afterShared(sh, actor, in, packs, pressed, facts, key, tick, nil)
}

func packsOf(in []*Char) [][]*item.Instance {
	out := make([][]*item.Instance, len(in))
	for i, c := range in {
		out[i] = slices.Clone(c.C.Pack)
	}
	return out
}

// afterShared is what a shared beat's press leaves: its facts, one for
// each member who pressed and one for the beat, gear lost, wins on the
// tile, those who backed out let go, every row moved, and an encounter
// that ended closed.
func (g *Game) afterShared(sh *Shared, actor *Char, in []*Char, packs [][]*item.Instance, pressed []fight.Pressed, facts []fact.Fact,
	key string, tick int64, w *worked) error {
	e := in[0].Fight.E
	beat := sh.beatOf(e, pressed)
	for _, x := range facts {
		if strings.HasPrefix(x.Kind, "encounter.") {
			x.Data = append(x.Data, append(fact.At(sh.Hex), fact.S("archetype", e.Creature.Archetype), fact.S("tags", joinTags(e.Creature.Tags)))...)
		}
		if w != nil {
			x.Data = append(x.Data, w.data(x.Kind)...)
		}
		if _, err := g.Log.Append(x); err != nil {
			return err
		}
	}
	var subjects []fact.Ref
	var wins int64
	for i, c := range in {
		subjects = append(subjects, char.Ref(c.C.ID))
		if err := g.lost(c, ledger.SubKey(key, c.C.ID), packs[i], tick); err != nil {
			return err
		}
		j := slices.IndexFunc(pressed, func(p fight.Pressed) bool { return p.Who == c.C.ID })
		if j < 0 {
			continue
		}
		p := pressed[j]
		g.deeds(c, pressed[j:j+1])
		kind := "beat.lost"
		if p.Outcome.Success {
			kind = "beat.won"
			wins++
			g.wonBeat(c, e)
		}
		if _, err := g.factWith(c, sh.refs(), kind, tick, fact.S("encounter", e.ID), fact.N("beat", beat),
			fact.S("option", p.Option.ID), fact.N("score", p.Option.Score)); err != nil {
			return err
		}
	}
	if _, err := g.factWith(in[0], append(subjects[1:], sh.refs()...), "party.beat", tick, fact.S("encounter", e.ID), fact.N("beat", beat),
		fact.N("pressed", int64(len(pressed))), fact.N("won", wins)); err != nil {
		return err
	}
	sh.Picks, sh.Opened = nil, 0
	for _, c := range in {
		if c != actor {
			g.touchOnce(c)
		}
		if slices.Contains(e.Gone, c.C.ID) && !e.Over {
			g.leaveShared(sh, c)
		}
		g.dropIfDown(c)
	}
	if e.Over {
		return g.closeShared(sh, actor, e, key, tick)
	}
	return nil
}

// refs are the fact subjects a shared encounter adds: its party's.
func (sh *Shared) refs() []fact.Ref {
	if sh.Party == "" {
		return nil
	}
	return []fact.Ref{party.Ref(sh.Party)}
}

// beatOf is the 1-based beat a press was on: the encounter has moved on
// past it unless the beat was pressed again or the encounter ended.
func (sh *Shared) beatOf(e *fight.Encounter, pressed []fight.Pressed) int64 {
	if e.Over || e.Press > 0 || len(pressed) == 0 {
		return int64(e.At) + 1
	}
	return int64(e.At)
}

// wonBeat is a won press's mark on the tile, as a solo one leaves.
func (g *Game) wonBeat(c *Char, e *fight.Encounter) {
	g.Pending = append(g.Pending, world.Action{Kind: world.ActWinBeat, Hex: c.C.At, By: char.Ref(c.C.ID), Tag: e.Creature.Archetype})
	more := g.charScale(c, "beat-threat", fixed.Hundredths) - fixed.Hundredths
	if ease := -g.r.wp("beat-won-threat") * more / fixed.Hundredths; more > 0 && ease > 0 {
		g.Pending = append(g.Pending, world.Action{Kind: world.ActEase, Hex: c.C.At, By: char.Ref(c.C.ID), Units: ease})
	}
}

// closeShared ends a shared encounter: the haul split by contribution
// among those it pays, each member's salvage, the world's marks, and
// each member's floor (GDD 7.5).
func (g *Game) closeShared(sh *Shared, actor *Char, e *fight.Encounter, key string, tick int64) error {
	in := g.in(sh)
	for _, c := range in {
		c.Fight = nil
		c.Swapped = 0
		if err := g.floorClosed(c, e); err != nil {
			return err
		}
	}
	parts := g.split(sh, e, in)
	var downed *Char
	for _, c := range in {
		acc := ledger.Char(c.C.ID)
		for i, s := range parts[c.C.ID] {
			if err := g.receive(c, ledger.Move(ledger.SubKey(key, "haul", c.C.ID, strconv.Itoa(i)), "haul", tick, ledger.FromHaul, acc, ledger.Material(s.Material), s.Qty)); err != nil {
				return err
			}
		}
		g.carriedFrom(c, parts[c.C.ID])
		for _, sv := range e.Salvage {
			if sv.Who != c.C.ID {
				continue
			}
			for i, s := range sv.Spoil {
				if err := g.receive(c, ledger.Move(ledger.SubKey(key, "salvage", c.C.ID, strconv.Itoa(i)), "salvage", tick, ledger.FromSalvage, acc, ledger.Material(s.Material), s.Qty)); err != nil {
					return err
				}
			}
		}
		if downed == nil && slices.Contains(e.Down, c.C.ID) {
			downed = c
		}
		if c != actor {
			g.touchOnce(c)
		}
	}
	if downed == nil && len(in) > 0 {
		downed = in[0]
	}
	if downed != nil {
		if err := g.drop(downed, key, e.Lost, tick); err != nil {
			return err
		}
	}
	for i, c := range in {
		switch e.Result {
		case fight.Won:
			if i == 0 {
				g.Pending = append(g.Pending, world.Action{Kind: world.ActSlay, Hex: sh.Hex, By: char.Ref(c.C.ID), Species: e.Creature.Archetype})
			}
			if err := g.fought(c, sh.Hex, e.Creature.Archetype, tick); err != nil {
				return err
			}
		case fight.Lost:
			if slices.Contains(e.Down, c.C.ID) {
				g.fellOnTile(c, e)
			}
		}
	}
	return g.sharedClosed(sh, e)
}

// split shares a shared encounter's haul. A member down at the end keeps
// a share only when the encounter was won, or when a Warden stood over
// it; with Even shares held by the leader, everyone it pays shares alike
// (GDD 7.5).
func (g *Game) split(sh *Shared, e *fight.Encounter, in []*Char) map[string][]item.Spoil {
	var paid []*Char
	for _, c := range in {
		if !slices.Contains(e.Gone, c.C.ID) && (e.Result == fight.Won || !slices.Contains(e.Down, c.C.ID) || e.Keeps(c.C.ID)) {
			paid = append(paid, c)
		}
	}
	even := false
	if p := g.PartyByID(sh.Party); p != nil {
		if l := g.Char(p.Leader); l != nil {
			even = g.EvenShares(l)
		}
	}
	var share tally.Tally
	for _, c := range paid {
		if !even {
			share.Bump(c.C.ID, e.Share.Get(c.C.ID))
		}
	}
	if share.Sum() == 0 {
		share = nil
		for _, c := range paid {
			share.Bump(c.C.ID, 1)
		}
	}
	return fight.Split(e.Haul, share, g.r.Fight.SplitTie(e.ID))
}

// sharedClosed is a shared encounter's end beyond its members: a pair
// who won it together are partied, once, and the Shared goes unless a
// fork waits on it.
func (g *Game) sharedClosed(sh *Shared, e *fight.Encounter) error {
	if e.Result == fight.Won {
		g.partied(sh, e)
	}
	if sh.Fork == nil {
		g.dropShared(sh)
		return nil
	}
	sh.Picks, sh.Opened, sh.Machine, sh.Movers = nil, 0, nil, nil
	return nil
}

// partied writes partied into the Company of each pair of members who
// won an encounter together, the first time they do (GDD 7.5).
func (g *Game) partied(sh *Shared, e *fight.Encounter) {
	p := g.PartyByID(sh.Party)
	if p == nil {
		return
	}
	var won []*Char
	for _, id := range sh.Members {
		if c := g.Char(id); c != nil && !slices.Contains(e.Gone, id) {
			won = append(won, c)
		}
	}
	tick := g.Tick()
	for i, a := range won {
		for _, b := range won[i+1:] {
			if p.MarkPartied(a.C.ID, b.C.ID) {
				a.C.Meet(char.Met{Who: b.C.ID, How: char.MetPartied, Tick: tick}, g.r.limits)
				b.C.Meet(char.Met{Who: a.C.ID, How: char.MetPartied, Tick: tick}, g.r.limits)
			}
		}
	}
}
