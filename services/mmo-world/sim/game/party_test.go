package game_test

import (
	"encoding/json"
	"errors"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/party"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/tags"
)

// partyGame is a fresh world for party tests, with a key counter.
type partyGame struct {
	t *testing.T
	g *game.Game
	n int
}

func newPartyGame(t *testing.T) *partyGame {
	t.Helper()
	g, err := game.New(rules(t))
	if err != nil {
		t.Fatal(err)
	}
	return &partyGame{t: t, g: g}
}

func (p *partyGame) key() string {
	p.n++
	return "pt-" + strconv.Itoa(p.n)
}

// act runs a command that must be accepted.
func (p *partyGame) act(c *game.Char, cmd game.Command) game.Result {
	p.t.Helper()
	cmd.Key, cmd.Char = p.key(), c.C.ID
	res, err := p.g.Act(cmd)
	if err != nil {
		p.t.Fatalf("%s %s: %v", c.C.ID, cmd.Kind, err)
	}
	return res
}

// refused runs a command that must be refused with code, leaving the
// game's digest as it was.
func (p *partyGame) refused(c *game.Char, code string, cmd game.Command) {
	p.t.Helper()
	before := p.digest()
	cmd.Key = p.key()
	if c != nil {
		cmd.Char = c.C.ID
	}
	_, err := p.g.Act(cmd)
	var ref *game.Refused
	if !errors.As(err, &ref) || ref.Code != code {
		p.t.Fatalf("%s: %v, want a %s refusal", cmd.Kind, err, code)
	}
	if p.digest() != before {
		p.t.Fatalf("a refused %s changed the game", cmd.Kind)
	}
}

func (p *partyGame) digest() canon.Sum {
	p.t.Helper()
	d, err := p.g.Digest()
	if err != nil {
		p.t.Fatal(err)
	}
	return d
}

func (p *partyGame) create() *game.Char {
	return p.act(&game.Char{C: &char.Character{}}, game.Command{Kind: game.Create}).Char
}

// A party of four forms by invitation within reach; a fifth is refused,
// as are a far character and one in another party, and a party left with
// one member ends.
func TestPartyForms(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 4)
	pt := p.g.PartyOf(cs[0])
	if pt.Leader != cs[0].C.ID || pt.Valid(p.g.PartyMax()) != nil {
		t.Fatalf("party %+v", pt)
	}
	for _, c := range cs {
		if c.Party != pt.ID {
			t.Fatalf("%s is not marked in %s", c.C.ID, pt.ID)
		}
	}
	fifth := p.create()
	fifth.C.At = cs[0].C.At
	p.refused(cs[0], game.PartyFull, game.Command{Kind: game.PartyInvite, Target: fifth.C.ID})
	far := p.create()
	far.C.At = cs[0].C.At.Neighbour(0).Neighbour(0)
	p.refused(cs[1], game.OutOfReach, game.Command{Kind: game.PartyInvite, Target: far.C.ID})
	p.refused(fifth, game.InParty, game.Command{Kind: game.PartyInvite, Target: cs[2].C.ID})
	p.refused(fifth, game.NoInvite, game.Command{Kind: game.PartyJoin, Target: cs[0].C.ID})
	p.refused(fifth, game.NotInParty, game.Command{Kind: game.PartyLeave})

	// A lone inviter leads the party that forms when its invitation is
	// taken; a neighbouring tile is within reach.
	near := p.create()
	near.C.At = fifth.C.At.Neighbour(1)
	p.act(fifth, game.Command{Kind: game.PartyInvite, Target: near.C.ID})
	p.act(near, game.Command{Kind: game.PartyJoin, Target: fifth.C.ID})
	two := p.g.PartyOf(fifth)
	if two == nil || two.Leader != fifth.C.ID || len(two.Members) != 2 {
		t.Fatalf("the lone inviter's party: %+v", two)
	}

	// The leader leaves: the longest-standing member leads.
	p.act(cs[0], game.Command{Kind: game.PartyLeave})
	if pt.Leader != cs[1].C.ID || cs[0].Party != "" {
		t.Fatalf("after the leader left: %+v", pt)
	}
	res := p.act(near, game.Command{Kind: game.PartyLeave})
	if p.g.PartyOf(fifth) != nil || fifth.Party != "" || !slices.Contains(res.Moved, fifth.C.ID) {
		t.Fatalf("a party of one lives on: %+v", p.g.PartyOf(fifth))
	}
	if !hasFact(res.Facts, "party.ended") {
		t.Fatal("no party.ended fact")
	}
}

// Invitations lapse after their ticks.
func TestInviteLapses(t *testing.T) {
	p := newPartyGame(t)
	a, b := p.create(), p.create()
	b.C.At = a.C.At
	p.act(a, game.Command{Kind: game.PartyInvite, Target: b.C.ID})
	for range p.g.Rules().Fight.Param("party-invite-ticks") + 1 {
		if _, err := p.g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	p.refused(b, game.NoInvite, game.Command{Kind: game.PartyJoin, Target: a.C.ID})
}

// hasFact reports whether a fact of a kind is among facts.
func hasFact(fs []fact.Fact, kind string) bool {
	return slices.ContainsFunc(fs, func(f fact.Fact) bool { return f.Kind == kind })
}

func countFacts(fs []fact.Fact, kind string) int {
	n := 0
	for _, f := range fs {
		if f.Kind == kind {
			n++
		}
	}
	return n
}

// nonMachine is a pick on c's beat that is not its machine.
func nonMachine(t *testing.T, g *game.Game, c *game.Char) string {
	t.Helper()
	for _, o := range g.Choose(c).Fight.Options {
		if !o.Puzzle {
			return o.ID
		}
	}
	t.Fatal("the beat offers only its machine")
	return ""
}

// A pick is held unseen until every member present has picked; then the
// beat resolves once, with a fact for each member and one for the beat.
func TestPicksHeld(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 3)
	sh := testkit.PartyMachineBeat(t, p.g, cs, "rewire", 2)
	pick := nonMachine(t, p.g, cs[0])
	res := p.act(cs[0], game.Command{Kind: game.PartyPick, Option: pick, Now: 1000})
	if len(res.Pressed) > 0 || sh.Opened != 1000 {
		t.Fatalf("a first pick resolved the beat or opened no window: %+v %d", res.Pressed, sh.Opened)
	}
	if !slices.Contains(res.Seen, cs[1].C.ID) || slices.Contains(res.Moved, cs[1].C.ID) {
		t.Fatalf("the others' rows moved, or they were not told: moved %v seen %v", res.Moved, res.Seen)
	}
	for _, o := range cs[1:] {
		v := p.g.Choose(o).Fight
		if v.Mine != "" || v.Shared != sh.ID {
			t.Fatalf("%s sees %+v", o.C.ID, v)
		}
		body, _ := json.Marshal(o)
		if strings.Contains(string(body), `"picks"`) {
			t.Fatalf("%s's row carries the picks", o.C.ID)
		}
	}
	if p.g.Choose(cs[0]).Fight.Mine != pick {
		t.Fatal("the picker does not see its own pick")
	}
	p.refused(cs[0], game.Picked, game.Command{Kind: game.PartyPick, Option: pick})
	p.refused(cs[1], game.BadArgs, game.Command{Kind: game.PartyPick, Option: "no-such-option"})
	p.refused(cs[1], game.InActivity, game.Command{Kind: game.PartyPick, Option: machineOpt(t, p.g, cs[1])})
	p.act(cs[1], game.Command{Kind: game.PartyPick, Option: pick, Now: 2000})
	res = p.act(cs[2], game.Command{Kind: game.PartyPick, Option: pick, Now: 3000})
	if len(res.Pressed) != 3 {
		t.Fatalf("the beat resolved for %d", len(res.Pressed))
	}
	if n := countFacts(res.Facts, "beat.won") + countFacts(res.Facts, "beat.lost"); n != 3 || countFacts(res.Facts, "party.beat") != 1 {
		t.Fatalf("%d member facts and %d beat facts", n, countFacts(res.Facts, "party.beat"))
	}
	if len(sh.Picks) != 0 || sh.Opened != 0 {
		t.Fatalf("the picks outlived the beat: %+v", sh.Picks)
	}
}

func machineOpt(t *testing.T, g *game.Game, c *game.Char) string {
	t.Helper()
	for _, o := range g.Choose(c).Fight.Options {
		if o.Puzzle {
			return o.ID
		}
	}
	t.Fatal("no machine on the beat")
	return ""
}

// The window ends only when it is due; then whoever has not picked holds.
func TestPartyWindow(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 2)
	sh := testkit.PartyMachineBeat(t, p.g, cs, "rewire", 2)
	window := p.g.PartyWindowMs()
	p.refused(cs[0], game.NotDue, game.Command{Kind: game.PartyWindow, Target: sh.ID, Now: 5000})
	pick := nonMachine(t, p.g, cs[0])
	p.act(cs[0], game.Command{Kind: game.PartyPick, Option: pick, Now: 1000})
	p.refused(cs[0], game.NotDue, game.Command{Kind: game.PartyWindow, Target: sh.ID, Now: 1000 + window - 1})
	p.refused(cs[0], game.NoFight, game.Command{Kind: game.PartyWindow, Target: "sh-999", Now: 1000 + window})
	res := p.act(cs[0], game.Command{Kind: game.PartyWindow, Target: sh.ID, Now: 1000 + window})
	cautious := p.g.Rules().Fight.Cautious()
	i := slices.IndexFunc(res.Pressed, func(x fight.Pressed) bool { return x.Who == cs[1].C.ID })
	if i < 0 || res.Pressed[i].Option.ID != cautious {
		t.Fatalf("the one who did not pick took %+v, want %s", res.Pressed, cautious)
	}
	if cs[0].Acted == p.g.Tick() && p.g.Tick() > 0 {
		t.Fatal("the window counted as its character acting")
	}
}

// soloLog is the log that solves a party machine armed in a shared
// encounter.
func solveLog(t *testing.T, g *game.Game, sh *game.Shared) puzzle.Log {
	t.Helper()
	m := sh.Machine
	if !m.Armed() {
		t.Fatal("no machine armed")
	}
	l := g.Puzzles().Make(m.Spec)
	if m.Spec.Party != "" {
		return g.Puzzles().PartySolve(l)
	}
	return g.Puzzles().Solve(l)
}

// A party machine is armed for every seat at once, its spec fixed; solved,
// one result presses the beat for all and credits the seats that moved.
func TestPartyMachineCreditsMovers(t *testing.T) {
	for try := range 12 {
		p := newPartyGame(t)
		cs := testkit.Party(t, p.g, 2)
		// The place keys the version drawn: walk until it is big rewire,
		// where any seat may do every move.
		at := p.g.SettlementHex(0)
		for range try {
			at = at.Neighbour(0)
		}
		for _, c := range cs {
			c.C.At = at
		}
		sh := testkit.PartyMachineBeat(t, p.g, cs, "rewire", 3)
		e := cs[0].Fight.E
		p.act(cs[1], game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceParty}, Now: 1000})
		m := sh.Machine
		if !m.Armed() || len(m.Seats) != 2 || m.Spec.Seats != 2 || m.Spec.Party == "" {
			t.Fatalf("armed %+v", m)
		}
		p.refused(cs[0], game.MachineArmed, game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceParty}})
		p.refused(cs[0], game.MachineArmed, game.Command{Kind: game.PartyPick, Option: nonMachine(t, p.g, cs[0])})
		if m.Spec.Party != "big-rewire" {
			continue
		}
		log := solveLog(t, p.g, sh)
		for i := range log.Moves {
			log.Moves[i].Seat = 0
		}
		res := p.act(cs[0], game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: game.SourceParty, Log: &log}, Now: 1000 + log.Stop()})
		if res.Machine == nil || !res.Machine.Solved || len(res.Pressed) != 2 {
			t.Fatalf("solve: %+v, pressed %d", res.Machine, len(res.Pressed))
		}
		if e.Share.Get(cs[0].C.ID) == 0 || e.Share.Get(cs[1].C.ID) != 0 {
			t.Fatalf("shares %v: only the mover gains", e.Share)
		}
		if !slices.Equal(sh.Movers, []string{cs[0].C.ID}) && p.g.SharedByID(sh.ID) != nil {
			t.Fatalf("movers %v", sh.Movers)
		}
		return
	}
	t.Fatal("no place drew big rewire")
}

// The first encounter won together puts partied into both Company rings,
// once.
func TestPartiedAtFirstWin(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 2)
	win := func() {
		sh := testkit.PartyMachineBeat(t, p.g, cs, "rewire", 1)
		p.act(cs[0], game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceParty}, Now: 1000})
		log := solveLog(t, p.g, sh)
		res := p.act(cs[0], game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: game.SourceParty, Log: &log}, Now: 1000 + log.Stop()})
		if !hasFact(res.Facts, "encounter.won") {
			t.Fatalf("the machine beat was not won: %v", res.Machine)
		}
	}
	win()
	met := func(a, b *game.Char) (char.Met, bool) {
		i := slices.IndexFunc(a.C.Company, func(m char.Met) bool { return m.Who == b.C.ID })
		if i < 0 {
			return char.Met{}, false
		}
		return a.C.Company[i], true
	}
	first, ok := met(cs[0], cs[1])
	if back, ok2 := met(cs[1], cs[0]); !ok || !ok2 || first.How != char.MetPartied || back.How != char.MetPartied {
		t.Fatalf("company %+v / %+v", cs[0].C.Company, cs[1].C.Company)
	}
	if _, err := p.g.Advance(); err != nil {
		t.Fatal(err)
	}
	win()
	if again, _ := met(cs[0], cs[1]); again.Tick != first.Tick {
		t.Fatal("partied was written again")
	}
	if pt := p.g.PartyOf(cs[0]); !slices.Equal(pt.Partied, []string{party.Pair(cs[0].C.ID, cs[1].C.ID)}) {
		t.Fatalf("partied pairs %v", pt.Partied)
	}
}

// The split sums to the haul; a member down keeps a share only on a win;
// with Even shares held by the leader, everyone paid shares alike.
func TestSharedSplit(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 3)
	sh := testkit.PartyMachineBeat(t, p.g, cs, "rewire", 1)
	e := cs[0].Fight.E
	mat := p.g.Rules().Book.Materials[0].ID
	e.Haul = []item.Spoil{{Material: mat, Qty: 11}}
	e.Share.Bump(cs[0].C.ID, 5)
	e.Share.Bump(cs[1].C.ID, 2)
	e.Share.Bump(cs[2].C.ID, 3)
	e.Down = []string{cs[2].C.ID}
	sum := func(parts map[string][]item.Spoil) int64 {
		var n int64
		for _, ss := range parts {
			n += item.Total(ss)
		}
		return n
	}
	e.Result = fight.Lost
	lost := p.g.SplitFor(sh)
	if sum(lost) != 11 || len(lost[cs[2].C.ID]) != 0 {
		t.Fatalf("on a loss: %v", lost)
	}
	e.Result = fight.Won
	won := p.g.SplitFor(sh)
	if sum(won) != 11 || item.Total(won[cs[2].C.ID]) == 0 || item.Total(won[cs[0].C.ID]) <= item.Total(won[cs[1].C.ID]) {
		t.Fatalf("on a win: %v", won)
	}
	cs[0].C.Classes.Active = append(cs[0].C.Classes.Active, "reeve")
	cs[0].C.Classes.Abilities = append(cs[0].C.Classes.Abilities, "even-shares")
	even := p.g.SplitFor(sh)
	for _, c := range cs {
		if n := item.Total(even[c.C.ID]); n < 3 || n > 4 {
			t.Fatalf("even shares: %v", even)
		}
	}
	if sum(even) != 11 {
		t.Fatalf("even shares sum %d", sum(even))
	}
}

// A shared encounter played to its end pays parts that sum to its haul,
// through the ledger.
func TestSharedClosePaysTheHaul(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 2)
	sh := testkit.PartyMachineBeat(t, p.g, cs, "rewire", 1)
	e := cs[0].Fight.E
	mat := p.g.Rules().Book.Materials[0].ID
	e.Haul = []item.Spoil{{Material: mat, Qty: 5}}
	p.act(cs[0], game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceParty}, Now: 1000})
	log := solveLog(t, p.g, sh)
	p.act(cs[1], game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: game.SourceParty, Log: &log}, Now: 1000 + log.Stop()})
	if cs[0].Fight != nil || cs[1].Fight != nil || p.g.SharedByID(sh.ID) != nil {
		t.Fatal("the shared encounter outlived its end")
	}
	for _, s := range e.Haul {
		var got int64
		for _, c := range cs {
			got += p.g.Ledger.Of(ledger.Char(c.C.ID), ledger.Material(s.Material))
		}
		if got != s.Qty {
			t.Fatalf("paid %d of %d %s", got, s.Qty, s.Material)
		}
	}
	if bad := ledger.Audit(p.g.Ledger.Balances, p.g.Holdings()); len(bad) > 0 {
		t.Fatal(bad)
	}
}

// A follower enters each tile on the leader's tick; one who cannot pay the
// step's provisions drops off.
func TestFollowLeader(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 3)
	lead, f1, f2 := cs[0], cs[1], cs[2]
	p.refused(lead, game.BadArgs, game.Command{Kind: game.Follow})
	p.act(f1, game.Command{Kind: game.Follow})
	p.act(f2, game.Command{Kind: game.Follow})
	dir := -1
	for _, m := range p.g.Choose(lead).Moves {
		if m.Open {
			dir = m.Dir
			break
		}
	}
	if dir < 0 {
		t.Fatal("the leader cannot move")
	}
	from := lead.C.At
	for _, c := range []*game.Char{lead, f1} {
		p.act(c, game.Command{Kind: game.Correct, Asset: ledger.Provisions, Units: 10, Note: "for the road"})
	}
	p.act(lead, game.Command{Kind: game.Step, Dir: dir})
	// At the journey's free ticks, the step owes provisions.
	lead.Long.Spent = p.g.Rules().CardNumbers().FreeTicks
	for lead.Long != nil {
		if _, err := p.g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	to := from.Neighbour(dir)
	if lead.C.At != to || f1.C.At != to {
		t.Fatalf("leader at %v, follower at %v, want %v", lead.C.At, f1.C.At, to)
	}
	if f2.C.At != from {
		t.Fatal("a follower with no provisions came along")
	}
	pt := p.g.PartyOf(lead)
	if pt.Members[pt.Seat(f2.C.ID)].Follows || !pt.Members[pt.Seat(f1.C.ID)].Follows {
		t.Fatalf("follows after the step: %+v", pt.Members)
	}
	if f1.C.Provisions >= 10 {
		t.Fatal("the follower paid no provisions")
	}
	if bad := ledger.Audit(p.g.Ledger.Balances, p.g.Holdings()); len(bad) > 0 {
		t.Fatal(bad)
	}
	p.act(f1, game.Command{Kind: game.Unfollow})
	p.refused(f1, game.BadArgs, game.Command{Kind: game.Unfollow})
}

// A refused party command leaves the game as it was.
func TestPartyRefusalsChangeNothing(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 2)
	lone := p.create()
	p.refused(cs[0], game.BadArgs, game.Command{Kind: game.PartyInvite, Target: cs[0].C.ID})
	p.refused(cs[0], game.InParty, game.Command{Kind: game.PartyInvite, Target: cs[1].C.ID})
	p.refused(lone, game.NotInParty, game.Command{Kind: game.Follow})
	p.refused(lone, game.NoFight, game.Command{Kind: game.PartyPick, Option: "hold"})
	p.refused(lone, game.NoSlot, game.Command{Kind: game.DeckSwap, Item: "x"})
	p.refused(cs[0], game.NoMachine, game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceParty}})
	p.refused(cs[0], game.NoMachine, game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: game.SourceParty}})
	sh := testkit.PartyMachineBeat(t, p.g, cs, "lock-pins", 2)
	p.refused(cs[0], game.NoMachine, game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceBeat}})
	p.refused(cs[0], game.Busy, game.Command{Kind: game.PartyLeave})
	p.refused(cs[0], game.NotDue, game.Command{Kind: game.PartyWindow, Target: sh.ID, Now: 1})
	p.refused(cs[0], game.NoMachine, game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: game.SourceParty}})
	p.refused(cs[0], game.NoMachine, game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceGuardian}})
	p.act(cs[0], game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceParty}, Now: 10})
	p.refused(cs[1], game.MachineArmed, game.Command{Kind: game.PartyWindow, Target: sh.ID, Now: 1 << 40})
	p.refused(cs[1], game.MachineArmed, game.Command{Kind: game.Press, Option: "hold"})
	p.refused(cs[1], game.MachineArmed, game.Command{Kind: game.CarryHome, Target: cs[0].C.ID})
	p.refused(nil, game.BadArgs, game.Command{Kind: game.HuntStart})
}

// A member going down shakes the rest of a live party, and the shaken
// band shows in their options' why.
func TestShakenInParty(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 2)
	h, ok := explorable(p.g)
	if !ok {
		t.Skip("no site to explore near the first settlement")
	}
	for _, c := range cs {
		c.C.At = h
	}
	for try := 0; try < 30; try++ {
		for _, c := range cs {
			c.C.Conditions, c.Fight, c.Long = nil, nil, nil
		}
		if _, err := p.g.Act(game.Command{Key: p.key(), Char: cs[0].C.ID, Kind: game.Explore}); err != nil {
			if _, err := p.g.Advance(); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if cs[0].Fight == nil {
			continue
		}
		if cs[0].Fight.Shared == "" || cs[1].Fight == nil || cs[1].Fight.E != cs[0].Fight.E {
			t.Fatal("a party's explore began no shared encounter")
		}
		e := cs[0].Fight.E
		if e.Party != 2 || !slices.ContainsFunc(cs[0].Fight.Measures, func(m tags.Measure) bool { return m.ID == "party-size" && m.Value == 2 }) {
			t.Fatalf("party %d, measures %+v", e.Party, cs[0].Fight.Measures)
		}
		for cs[0].Fight != nil && !slices.Contains(e.Down, cs[0].C.ID) {
			e.Failures.Bump(cs[0].C.ID, 1)
			if _, err := p.g.Act(game.Command{Key: p.key(), Char: cs[0].C.ID, Kind: game.PartyPick, Option: riskiest(p.g, cs[0])}); err != nil {
				t.Fatal(err)
			}
			if cs[1].Fight == nil {
				break
			}
			if _, err := p.g.Act(game.Command{Key: p.key(), Char: cs[1].C.ID, Kind: game.PartyPick, Option: p.g.Rules().Fight.Cautious()}); err != nil {
				t.Fatal(err)
			}
		}
		if cs[1].Fight == nil || !slices.Contains(e.Down, cs[0].C.ID) {
			continue
		}
		if !slices.ContainsFunc(e.States, func(s fight.State) bool { return s.Tag == "shaken" && s.Who == cs[1].C.ID }) {
			t.Fatalf("the member still up is not shaken: %+v", e.States)
		}
		for _, o := range p.g.Choose(cs[1]).Fight.Options {
			for _, s := range o.Why.Rules.Steps {
				if s.Rule == "shaken-falters" {
					return
				}
			}
		}
		t.Fatal("no option's why names shaken-falters")
	}
	t.Skip("nobody went down in 30 encounters")
}

// riskiest is the option on c's beat least likely to succeed, not its
// machine and not a way out.
func riskiest(g *game.Game, c *game.Char) string {
	id, worst := "", int64(1<<40)
	for _, o := range g.Choose(c).Fight.Options {
		if !o.Puzzle && o.Kind != fight.WayOut && int64(o.Chance) < worst {
			id, worst = o.ID, int64(o.Chance)
		}
	}
	return id
}

// explorable is the nearest site to explore near the first settlement
// that is not a dungeon.
func explorable(g *game.Game) (hex.Hex, bool) {
	from := g.SettlementHex(0)
	for r := int64(1); r <= 20; r++ {
		for _, h := range hex.Ring(from, r) {
			if g.CanExplore(h) && !g.IsDungeon(h) {
				return h, true
			}
		}
	}
	return hex.Hex{}, false
}

// Second slot swaps a carried deck in before the character's pick, once
// a beat.
func TestDeckSwap(t *testing.T) {
	p := newPartyGame(t)
	a := p.act(&game.Char{C: &char.Character{}}, game.Command{Kind: game.Create, Option: "deck"}).Char
	b := p.act(&game.Char{C: &char.Character{}}, game.Command{Kind: game.Create, Option: "deck"}).Char
	other := b.C.In(char.OffHand, 0)
	if a.C.In(char.OffHand, 0) == nil || other == nil {
		t.Skip("the deck start carries no deck")
	}
	b.C.Drop(other.ID)
	a.C.Pack = append(a.C.Pack, other)
	testkit.MachineBeat(t, p.g, a, "rewire", 1)
	p.refused(a, game.NoSlot, game.Command{Kind: game.DeckSwap, Item: other.ID})
	a.C.Classes.Active = append(a.C.Classes.Active, "kindler")
	a.C.Classes.Abilities = append(a.C.Classes.Abilities, "second-slot")
	first := a.C.In(char.OffHand, 0)
	p.refused(a, game.BadArgs, game.Command{Kind: game.DeckSwap, Item: first.ID})
	p.act(a, game.Command{Kind: game.DeckSwap, Item: other.ID})
	if a.C.In(char.OffHand, 0) != other {
		t.Fatal("the deck was not swapped in")
	}
	p.refused(a, game.Swapped, game.Command{Kind: game.DeckSwap, Item: first.ID})
}

// A world-level command names no character: it is looked up by nothing
// and its result carries none.
func TestWorldLevelNamesNoCharacter(t *testing.T) {
	p := newPartyGame(t)
	_, err := p.g.Act(game.Command{Key: "w-1", Kind: game.HuntStart, Asset: "no-such-row", Char: "c-404"})
	var ref *game.Refused
	if !errors.As(err, &ref) || ref.Code == game.NoSuchChar {
		t.Fatalf("hunt-start: %v", err)
	}
	if !game.WorldLevel(game.HuntStart) || !game.Operator(game.HuntStart) || game.WorldLevel(game.Explore) {
		t.Fatal("hunt-start is not a world-level operator kind")
	}
	for _, k := range []string{game.PartyPick, game.PartyWindow, game.DungeonPush, game.DungeonLeave, game.MachineArm, game.MachineSolve} {
		if !game.Timed(k) {
			t.Fatalf("%s is not stamped with the service's clock", k)
		}
	}
}

// A snapshot saved before parties existed loads, attaches and digests as
// it did when it was saved.
func TestPreMM8SnapshotDigest(t *testing.T) {
	body, err := os.ReadFile("testdata/pre-mm8/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("testdata/pre-mm8/digest.txt")
	if err != nil {
		t.Fatal(err)
	}
	var g game.Game
	if err := json.Unmarshal(body, &g); err != nil {
		t.Fatal(err)
	}
	g.Attach(rules(t))
	got, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if got.String() != strings.TrimSpace(string(want)) {
		t.Fatalf("a pre-MM8 snapshot digests %s, saved as %s", got, want)
	}
	again, _ := json.Marshal(&g)
	var h game.Game
	if err := json.Unmarshal(again, &h); err != nil {
		t.Fatal(err)
	}
	h.Attach(rules(t))
	if d, _ := h.Digest(); d != got {
		t.Fatal("a pre-MM8 snapshot saved again digests otherwise")
	}
}

// forkDungeon is a dungeon near the first settlement whose first floor's
// fork has a machine behind way 1.
func forkDungeon(g *game.Game) (hex.Hex, bool) {
	from := g.SettlementHex(0)
	for r := int64(1); r <= 60; r++ {
		for _, h := range hex.Ring(from, r) {
			if p, ok := g.Rules().Gen.Dungeon(h); ok && p.Floors > 1 && g.Rules().Gen.Floor(h, 1, -1).Machine {
				return h, true
			}
		}
	}
	return hex.Hex{}, false
}

// Two contexts at one fork machine race: the first solve to land takes
// it, and the other's machine haywires in the same command.
func TestCompetingAtAFork(t *testing.T) {
	p := newPartyGame(t)
	h, ok := forkDungeon(p.g)
	if !ok {
		t.Skip("no dungeon with a fork machine near the first settlement")
	}
	a, b := p.create(), p.create()
	for _, c := range []*game.Char{a, b} {
		c.C.At, c.C.Floor, c.Worked = h, 1, 1
		c.Delving = &game.Delving{Dungeon: h.Ref(), Way: -1}
		p.g.OpenFork(c, 1)
	}
	sa, sb := p.g.SharedOf(a), p.g.SharedOf(b)
	if sa == nil || sb == nil || sa == sb || sa.Fork == nil {
		t.Fatalf("forks %+v %+v", sa, sb)
	}
	arm := game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceFork}, Now: 1000}
	p.act(a, arm)
	p.act(b, arm)
	if sa.Machine.Rival != sb.ID || sb.Machine.Rival != sa.ID || sa.Machine.Spec != sb.Machine.Spec {
		t.Fatalf("not rivals: %+v / %+v", sa.Machine, sb.Machine)
	}
	won := solveLog(t, p.g, sa)
	lost := solveLog(t, p.g, sb)
	res := p.act(a, game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: game.SourceFork, Log: &won}, Now: 1000 + won.Stop()})
	if res.Machine == nil || !res.Machine.Solved || !sa.Fork.Solved {
		t.Fatalf("the first solve: %+v, fork %+v", res.Machine, sa.Fork)
	}
	if sb.Machine != nil || sb.LostRace != sa.ID || !hasFact(res.Facts, "machine.lost-race") || b.LastMachine == nil || b.LastMachine.Result.Haywire == "" {
		t.Fatalf("the rival's machine did not haywire in the same command: %+v", sb)
	}
	if !slices.Contains(res.Moved, b.C.ID) {
		t.Fatal("the rival's row moved unannounced")
	}
	p.refused(b, game.RivalWon, game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: game.SourceFork, Log: &lost}, Now: 2000})
}

// Every seat holds the one layout armed, dealt as its version deals it, and
// gets the same view back later; practice 14 gives a glimpse of a
// partner's part of a split machine.
func TestPartyRigHoldsOneLayout(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 3)
	sh := testkit.PartyMachineBeat(t, p.g, cs, "fuse", 4)
	p.act(cs[2], game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: game.SourceParty}, Now: 1000})
	spec := sh.Machine.Spec
	if spec.Party == "" || spec.Seats != 3 {
		t.Fatalf("spec %+v", spec)
	}
	parts := p.g.Puzzles().Deal(spec)
	var before [][]byte
	for i, c := range cs {
		rig, ok := p.g.PartyRigOf(c)
		if !ok || rig.Seat != int64(i) || rig.Glimpse != nil {
			t.Fatalf("seat %d: %+v", i, rig)
		}
		got, _ := json.Marshal(rig.Layout)
		want, _ := json.Marshal(parts[i])
		if string(got) != string(want) {
			t.Fatalf("seat %d holds another view than its dealt part", i)
		}
		before = append(before, got)
	}
	if _, err := p.g.Advance(); err != nil {
		t.Fatal(err)
	}
	for i, c := range cs {
		rig, _ := p.g.PartyRigOf(c)
		if got, _ := json.Marshal(rig.Layout); string(got) != string(before[i]) {
			t.Fatalf("seat %d's view changed between reads", i)
		}
	}
	for range 200 {
		cs[0].C.Practise(spec.Family, 100, p.g.Rules().Growth.Params())
	}
	if !p.g.Puzzles().Gifts(cs[0].C.Level(spec.Family)).Glimpse {
		t.Skipf("practice %d gives no glimpse", cs[0].C.Level(spec.Family))
	}
	rig, _ := p.g.PartyRigOf(cs[0])
	if rig.Glimpse == nil {
		t.Fatal("a practised seat at a split machine glimpses nothing")
	}
	if got, _ := json.Marshal(*rig.Glimpse); string(got) != string(before[1]) {
		t.Fatal("the glimpse is not the next seat's part")
	}
}

// A party exploring together is one encounter: everyone free on the tile,
// in join order, at the party's size, with the size a creature's
// behaviour reads among its measures.
func TestPartyExploresAsOne(t *testing.T) {
	p := newPartyGame(t)
	cs := testkit.Party(t, p.g, 3)
	h, ok := explorable(p.g)
	if !ok {
		t.Skip("no site to explore near the first settlement")
	}
	away := p.create()
	for _, c := range append(slices.Clone(cs), away) {
		c.C.At = h
	}
	for try := 0; try < 10 && cs[0].Fight == nil; try++ {
		p.act(cs[1], game.Command{Kind: game.Explore})
		if cs[0].Fight == nil {
			if _, err := p.g.Advance(); err != nil {
				t.Fatal(err)
			}
		}
	}
	if cs[0].Fight == nil {
		t.Skip("the site showed nothing")
	}
	sh := p.g.SharedOf(cs[1])
	if sh == nil || !slices.Equal(sh.Members, []string{cs[0].C.ID, cs[1].C.ID, cs[2].C.ID}) || away.Fight != nil {
		t.Fatalf("shared %+v; the one outside the party in it: %v", sh, away.Fight != nil)
	}
	e := cs[1].Fight.E
	if e.Party != 3 || cs[0].Fight.E != e || cs[2].Fight.E != e {
		t.Fatalf("party %d, one encounter: %v", e.Party, cs[0].Fight.E == e)
	}
	if !slices.ContainsFunc(cs[1].Fight.Measures, func(m tags.Measure) bool { return m.ID == "party-size" && m.Value == 3 }) {
		t.Fatalf("measures %+v", cs[1].Fight.Measures)
	}
}
