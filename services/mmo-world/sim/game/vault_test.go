package game

import (
	"fmt"
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
)

// vaultWorld is houseGame with server a's admin c having staged the vault
// template on free ground of its settlement's region.
func vaultWorld(t *testing.T) (*Game, *Char, *Stage) {
	t.Helper()
	g, c, home := houseGame(t)
	h, ok := freeStageTile(g, home, func(h hex.Hex) bool { return g.vaultAt(h, "") == nil })
	if !ok {
		t.Skip("no free ground near server a's settlement")
	}
	st := stageAs(t, g, c, Command{Admin: true}, StageCmd{Template: sheets.StageVault, Settlement: home, At: h})
	if !st.Open || st.Vault == nil || st.Vault.Family == "" {
		t.Fatalf("the vault did not open: %+v", st)
	}
	return g, c, st
}

// freeStageTile is the nearest tile to a settlement a stage may stand on,
// on ground free of every place, point and pin, and passing ok.
func freeStageTile(g *Game, home int, ok func(hex.Hex) bool) (hex.Hex, bool) {
	from := g.SettlementHex(home)
	for r := int64(2); r <= 20; r++ {
		for _, h := range hex.Ring(from, r) {
			if _, _, point := g.pointAt(h); !point && g.stageSite(home, h) == nil && g.chainFree(h) && ok(h) {
				return h, true
			}
		}
	}
	return hex.Hex{}, false
}

// stageAs orders a stage for c with the roles in as, and returns it.
func stageAs(t *testing.T, g *Game, c *Char, as Command, s StageCmd) *Stage {
	t.Helper()
	as.Key, as.Char, as.Kind, as.Server, as.Stage = fmt.Sprintf("stage-%d", g.Log.Len()), c.C.ID, Staging, c.Server, &s
	if _, err := g.Act(as); err != nil {
		t.Fatalf("staging %s: %v", s.Template, err)
	}
	return g.Live.Stages[len(g.Live.Stages)-1]
}

// vaultParty is n new characters of server b standing on h, in one party
// when n is more than one.
func vaultParty(t *testing.T, g *Game, h hex.Hex, n int) []*Char {
	t.Helper()
	var cs []*Char
	for range n {
		cs = append(cs, patChar(t, g, "b", h))
	}
	for i, c := range cs[1:] {
		key := fmt.Sprintf("vp-%s-%d", cs[0].C.ID, i)
		if _, err := g.Act(Command{Key: key + "-invite", Char: cs[0].C.ID, Kind: PartyInvite, Target: c.C.ID}); err != nil {
			t.Fatal(err)
		}
		if _, err := g.Act(Command{Key: key + "-join", Char: c.C.ID, Kind: PartyJoin, Target: cs[0].C.ID}); err != nil {
			t.Fatal(err)
		}
	}
	return cs
}

func vaultAct(t *testing.T, g *Game, c *Char, cmd Command) Result {
	t.Helper()
	cmd.Key, cmd.Char = fmt.Sprintf("v-%s-%d", c.C.ID, g.Log.Len()), c.C.ID
	res, err := g.Act(cmd)
	if err != nil {
		t.Fatalf("%s %s: %v", c.C.ID, cmd.Kind, err)
	}
	return res
}

func vaultRefused(t *testing.T, g *Game, c *Char, code string, cmd Command) {
	t.Helper()
	cmd.Key, cmd.Char = fmt.Sprintf("vr-%s-%d", c.C.ID, g.Log.Len()), c.C.ID
	patRefused(t, g, cmd.Kind, code, cmd)
}

var armVault = Command{Kind: MachineArm, Machine: &MachineCmd{Source: SourceFork}, Now: 1000}

// vaultLog is the log that solves a context's armed machine.
func vaultLog(g *Game, sh *Shared) puzzle.Log {
	l := g.Puzzles().Make(sh.Machine.Spec)
	if sh.Machine.Spec.Party != "" {
		return g.Puzzles().PartySolve(l)
	}
	return g.Puzzles().Solve(l)
}

// solveVault lands a context's merged log, as the gateway writes it for
// its first seat.
func solveVault(t *testing.T, g *Game, sh *Shared, log puzzle.Log) Result {
	t.Helper()
	seat := g.Char(sh.Machine.Seats[0])
	return vaultAct(t, g, seat, Command{Kind: MachineSolve, Machine: &MachineCmd{Source: SourceFork, Log: &log}, Now: sh.Machine.At + log.Stop()})
}

func stagedCarried(c *Char) int64 {
	var n int64
	for _, s := range c.C.Staged {
		n += s.Units
	}
	return n
}

func hasKind(fs []fact.Fact, kind string) bool {
	return slices.ContainsFunc(fs, func(f fact.Fact) bool { return f.Kind == kind })
}

// TestVaultRace: two parties arm one vault and race; the first solve takes
// a haul of goods staged at the vault's settlement, one roll a seat, and
// writes vault.taken; the other haywires with machine.lost-race in the
// same command; nothing is left to arm, and both contexts are gone.
func TestVaultRace(t *testing.T) {
	g, _, st := vaultWorld(t)
	a, b := vaultParty(t, g, st.At, 2), vaultParty(t, g, st.At, 2)
	vaultAct(t, g, a[0], armVault)
	vaultAct(t, g, b[1], armVault)
	sa, sb := g.sharedOf(a[0]), g.sharedOf(b[0])
	if sa == nil || sb == nil || sa == sb || sa.Machine.Rival != sb.ID || sb.Machine.Rival != sa.ID {
		t.Fatalf("not rivals: %+v / %+v", sa, sb)
	}
	if sa.Machine.Spec != sb.Machine.Spec || sa.Machine.Spec.Place != vaultPlace+st.ID || sa.Machine.Spec.Family != st.Vault.Family ||
		sa.Machine.Spec.Level != st.Vault.Level || len(sa.Machine.Seats) != 2 {
		t.Fatalf("the vault's machine: %+v / %+v", sa.Machine.Spec, sb.Machine.Spec)
	}
	vaultRefused(t, g, a[1], MachineArmed, Command{Kind: Travel, To: new(st.At.Neighbour(0))})

	res := solveVault(t, g, sa, vaultLog(g, sa))
	if res.Machine == nil || !res.Machine.Solved || st.Vault.Taken != sa.ID {
		t.Fatalf("the first solve: %+v, taken %q", res.Machine, st.Vault.Taken)
	}
	if !hasKind(res.Facts, "vault.taken") || !hasKind(res.Facts, "machine.lost-race") {
		t.Fatalf("facts %v", res.Facts)
	}
	for _, s := range a {
		if stagedCarried(s) <= 0 || len(s.C.Goods) != 0 {
			t.Fatalf("%s took %+v staged, %+v clean", s.C.ID, s.C.Staged, s.C.Goods)
		}
		for _, sg := range s.C.Staged {
			if sg.At != st.Settlement || g.Ledger.Of(ledger.Char(s.C.ID), ledger.Staged(sg.At, sg.Material)) != sg.Units {
				t.Fatalf("%s holds %+v off the ledger or from elsewhere", s.C.ID, sg)
			}
		}
	}
	for _, s := range b {
		if stagedCarried(s) != 0 || s.LastMachine == nil || s.LastMachine.Result.Haywire == "" {
			t.Fatalf("the rival seat %s: %+v, staged %+v", s.C.ID, s.LastMachine, s.C.Staged)
		}
		if !slices.Contains(res.Moved, s.C.ID) {
			t.Fatalf("the rival's row %s moved unannounced", s.C.ID)
		}
	}
	if g.sharedOf(a[0]) != nil || g.sharedOf(b[0]) != nil {
		t.Fatal("a vault context outlived its machine")
	}
	vaultRefused(t, g, b[0], Used, armVault)
	audit(t, g)
}

// TestVaultThirdRacesNobody: a third party armed at a vault two others
// race races nobody; its later solve pays it nothing once the vault is
// taken, and a lone character makes a context of one.
func TestVaultThirdRacesNobody(t *testing.T) {
	g, _, st := vaultWorld(t)
	a, b, c := vaultParty(t, g, st.At, 2), vaultParty(t, g, st.At, 2), vaultParty(t, g, st.At, 1)
	for _, cs := range [][]*Char{a, b, c} {
		vaultAct(t, g, cs[0], armVault)
	}
	sa, sb, sc := g.sharedOf(a[0]), g.sharedOf(b[0]), g.sharedOf(c[0])
	if sa.Machine.Rival != sb.ID || sb.Machine.Rival != sa.ID || sc.Machine.Rival != "" || len(sc.Machine.Seats) != 1 {
		t.Fatalf("rivals a=%q b=%q c=%q", sa.Machine.Rival, sb.Machine.Rival, sc.Machine.Rival)
	}
	solveVault(t, g, sa, vaultLog(g, sa))
	if !sc.Machine.Armed() {
		t.Fatal("the third context's machine ended in a race it was not in")
	}
	res := solveVault(t, g, sc, vaultLog(g, sc))
	if res.Machine == nil || !res.Machine.Solved || hasKind(res.Facts, "vault.taken") || stagedCarried(c[0]) != 0 || st.Vault.Taken != sa.ID {
		t.Fatalf("the third solve: %+v, staged %+v, taken %q", res.Machine, c[0].C.Staged, st.Vault.Taken)
	}
	audit(t, g)
}

// TestVaultStagerTakesNothing: the stager cannot arm its vault, alone or
// with its party, nor can a party it is in from elsewhere; a roll leaves
// the stager out; machine commands naming another stage, or the vault off
// its tile or after its close, are refused with nothing changed.
func TestVaultStagerTakesNothing(t *testing.T) {
	g, stager, st := vaultWorld(t)
	patMove(t, g, stager, st.At)
	vaultRefused(t, g, stager, StagedOwn, armVault)
	friend := patChar(t, g, "a", st.At)
	vaultAct(t, g, stager, Command{Kind: PartyInvite, Target: friend.C.ID})
	vaultAct(t, g, friend, Command{Kind: PartyJoin, Target: stager.C.ID})
	vaultRefused(t, g, friend, StagedOwn, armVault)
	patMove(t, g, stager, g.SettlementHex(st.Settlement))
	vaultRefused(t, g, friend, StagedOwn, armVault)
	if legs, n := g.stagedRolls(st, "vault-haul", vaultDraw, []*Char{stager}); len(legs) != 0 || n != 0 {
		t.Fatalf("the stager rolled %v", legs)
	}

	other := vaultParty(t, g, st.At.Neighbour(0), 1)[0]
	vaultRefused(t, g, other, NotHere, Command{Kind: MachineArm, Target: st.ID, Machine: &MachineCmd{Source: SourceFork}, Now: 1000})
	vaultRefused(t, g, other, NoStage, Command{Kind: MachineArm, Target: "st-404", Machine: &MachineCmd{Source: SourceFork}, Now: 1000})
	vaultRefused(t, g, other, BadArgs, Command{Kind: MachineSolve, Target: st.ID, Machine: &MachineCmd{Source: SourceFork, Log: &puzzle.Log{}}})

	patMove(t, g, other, st.At)
	vaultAct(t, g, other, Command{Kind: MachineArm, Target: st.ID, Machine: &MachineCmd{Source: SourceFork}, Now: 1000})
	if err := g.closeStage(st, closedEnded, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if g.sharedOf(other) != nil {
		t.Fatal("a closed vault kept its context")
	}
	closed := armVault
	closed.Target = st.ID
	vaultRefused(t, g, other, NoStage, closed)
	audit(t, g)
}

// TestVaultCheck: a vault is refused on a tile another live vault holds,
// and a machine's alarm raises no region's threat while a stage is
// applied.
func TestVaultCheck(t *testing.T) {
	g, c, st := vaultWorld(t)
	before := digestOf(t, g)
	_, err := g.Act(Command{Key: "v-again", Char: c.C.ID, Kind: Staging, Server: c.Server, Admin: true,
		Stage: &StageCmd{Template: sheets.StageVault, Settlement: st.Settlement, At: st.At}})
	refusedWith(t, err, BadArgs)
	if digestOf(t, g) != before {
		t.Fatal("a refused vault changed the game")
	}
	a := vaultParty(t, g, st.At, 1)
	vaultAct(t, g, a[0], armVault)
	sh := g.sharedOf(a[0])
	pending := len(g.Pending)
	res := solveVault(t, g, sh, puzzle.Log{})
	if res.Machine == nil || res.Machine.Solved || len(g.Pending) != pending || st.Vault.Taken != "" {
		t.Fatalf("a failed vault: %+v, pending %d → %d", res.Machine, pending, len(g.Pending))
	}
	i := slices.IndexFunc(g.r.Book.Haywires, func(h sheets.Haywire) bool { return h.Effect == puzzle.EffectAlarm && h.Magnitude > 0 })
	if i < 0 {
		t.Fatal("no haywire raises an alarm")
	}
	alarm := g.r.Book.Haywires[i].ID
	restore := g.withStage(st)
	g.haywired(a[0], vaultPlace+st.ID, alarm, st.At, g.Tick(), 0)
	restore()
	if len(g.Pending) != pending {
		t.Fatal("a staged machine's alarm raised the region's threat")
	}
	g.haywired(a[0], vaultPlace+st.ID, alarm, st.At, g.Tick(), 0)
	if len(g.Pending) != pending+1 {
		t.Fatal("an alarm out of staging raised nothing")
	}
	audit(t, g)
}
