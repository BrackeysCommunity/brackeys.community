package game

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/party"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// The staged puzzle events (GDD 14.4). A competing vault is one fork
// machine standing on a tile: every party there that arms it races by the
// fork's own rule (GDD 7.11), the first solve takes a haul of staged goods
// and the rival haywires. An admin's pattern is a pattern-puzzles row laid
// by its shape round a tile, with no chain; its solve pays a staged cache.
// The stager's own side takes nothing from either.

// Draws of the staged puzzle events, each its own.
const (
	vaultDraw   draw.Purpose = "liveops.vault"
	patternDraw draw.Purpose = "liveops.pattern"
)

// structural: how a vault's machine is named, and how a staged board and
// its turn are keyed.
const (
	vaultPlace   = "vault:"
	vaultBeat    = 0
	stagedPrefix = "staged-"
	turnPart     = "turn"
	vaultTxn     = "vault"
)

func init() {
	stagedParts[sheets.StageVault] = stagedPart{Check: (*Game).checkVault, Open: (*Game).openVault, Close: (*Game).closeVault}
	stagedParts[sheets.StagePattern] = stagedPart{Check: (*Game).checkPattern, Open: (*Game).openPattern, Close: (*Game).closePattern}
	houseGates = append(houseGates, (*Game).vaultGate)
}

// checkVault holds a vault to free open ground no other live vault stands
// on.
func (g *Game) checkVault(_ *Char, st *Stage, t *sheets.StageTemplate) error {
	if t.Family == "" || t.Level < 1 || !g.Puzzles().Known(t.Family) {
		return refuse(StageTemplate, "%s names no machine", t.ID)
	}
	if !g.chainFree(st.At) || g.vaultAt(st.At, st.ID) != nil {
		return refuse(BadArgs, "a vault stands on free open ground: %s is taken", st.At.Ref())
	}
	if _, _, ok := g.pointAt(st.At); ok {
		return refuse(BadArgs, "a vault stands on free open ground: a pattern's point is on %s", st.At.Ref())
	}
	return nil
}

// openVault stands the vault's machine.
func (g *Game) openVault(st *Stage, _ int64) error {
	t := g.stageTemplate(st.Template)
	if t == nil {
		return refuse(StageTemplate, "no template %q", st.Template)
	}
	if st.Vault == nil {
		st.Vault = &VaultState{Family: t.Family, Level: t.Level}
	}
	return nil
}

// closeVault ends every context still at the vault: a countdown running
// there ends with nothing paid.
func (g *Game) closeVault(st *Stage, _ int64) error {
	for _, sh := range slices.Clone(g.Shared) {
		if g.vaultOf(sh) == st {
			for _, s := range g.seatChars(sh.Machine) {
				g.touchOnce(s)
			}
			g.dropShared(sh)
		}
	}
	return nil
}

// vaultAt is a live vault on h other than the stage skip, or nil.
func (g *Game) vaultAt(h hex.Hex, skip string) *Stage {
	if g.Live == nil {
		return nil
	}
	for _, st := range g.Live.Stages {
		if st.Kind == sheets.StageVault && !st.Closed && st.At == h && st.ID != skip {
			return st
		}
	}
	return nil
}

// VaultAt is the open vault on h, for readers, or nil.
func (g *Game) VaultAt(h hex.Hex) *Stage {
	if st := g.vaultAt(h, ""); st != nil && st.Running(g.Tick()) && st.Vault != nil {
		return st
	}
	return nil
}

// VaultSpec is the machine a vault holds.
func (g *Game) VaultSpec(st *Stage) puzzle.Spec {
	spec := puzzle.Spec{Family: st.Vault.Family, Level: st.Vault.Level, Tier: g.tierAt(st.At), Place: vaultPlace + st.ID, Beat: vaultBeat}
	spec.Shape = g.Puzzles().Shape(spec.Family, spec.Level, spec.Where())
	return spec
}

// vaultOf is the vault whose machine a context holds, or nil.
func (g *Game) vaultOf(sh *Shared) *Stage {
	if g.Live == nil || sh.Machine == nil || sh.Machine.Source != SourceFork {
		return nil
	}
	id, ok := strings.CutPrefix(sh.Machine.Spec.Place, vaultPlace)
	if !ok {
		return nil
	}
	return g.StageByID(id)
}

// vaultOfChar is the vault a character's solve works: its context's, when
// it has no machine of its own armed.
func (g *Game) vaultOfChar(a *Armed, sh *Shared) *Stage {
	if a != nil || sh == nil {
		return nil
	}
	return g.vaultOf(sh)
}

// vaultFor is the vault a fork arming works: the stage it names, else the
// one where the character stands; nil for any other fork.
func (g *Game) vaultFor(c *Char, cmd Command) (*Stage, error) {
	if cmd.Target != "" {
		st := g.StageByID(cmd.Target)
		if st == nil || st.Kind != sheets.StageVault {
			return nil, refuse(NoStage, "no vault %q", cmd.Target)
		}
		return st, nil
	}
	if c.C.Floor != 0 || cmd.Machine.Source != SourceFork {
		return nil, nil
	}
	return g.vaultAt(c.C.At, ""), nil
}

// inStage applies what follows in a stage's context unless one is applied
// already.
func (g *Game) inStage(st *Stage) func() {
	if g.staging != nil {
		return func() {}
	}
	return g.withStage(st)
}

// vaultSeats are who sits at a vault for c: c's party members standing
// there free and in no other context, in join order, else c alone.
func (g *Game) vaultSeats(c *Char) []*Char {
	p := g.partyOf(c)
	if p == nil {
		return []*Char{c}
	}
	var out []*Char
	for _, m := range p.Members {
		s := g.Char(m.ID)
		if s == nil || s.C.At != c.C.At || s.Banned || s.Armed != nil || free(s) != nil || g.sharedOf(s) != nil {
			continue
		}
		out = append(out, s)
	}
	return out
}

// vaultArm arms a vault's machine for the party standing at it, and races
// it against the first other context armed there.
func (g *Game) vaultArm(c *Char, cmd Command, st *Stage) error {
	defer g.inStage(st)()
	if !st.Running(g.Tick()) || st.Vault == nil {
		return refuse(NoStage, "%s is not open", st.ID)
	}
	if err := free(c); err != nil {
		return err
	}
	if c.C.At != st.At {
		return refuse(NotHere, "the vault stands on %s", st.At.Ref())
	}
	if st.Vault.Taken != "" {
		return refuse(Used, "the vault on %s has been taken", st.At.Ref())
	}
	if sh := g.sharedOf(c); sh != nil {
		if sh.Machine.Armed() {
			return refuse(MachineArmed, "the party's machine is armed already")
		}
		return refuse(Busy, "%s is busy", c.C.ID)
	}
	seats := g.vaultSeats(c)
	if p := g.partyOf(c); st.Stager(c.C.ID) || p != nil && slices.ContainsFunc(p.Members, func(m party.Member) bool { return st.Stager(m.ID) }) {
		return refuse(StagedOwn, "the stager's party takes nothing from its vault")
	}
	tick := g.Tick()
	spec := g.VaultSpec(st)
	if left := c.lockedFor(spec.Place, tick); left > 0 {
		return refuse(LockedDown, "locked down for %d more ticks", left)
	}
	sh := g.newShared(g.partyOf(c), st.At, 0, seats)
	m := g.armShared(c, sh, seats, spec, SourceFork, cmd.Now, tick)
	g.race(sh)
	_, err := g.factWith(c, sh.refs(), "machine.armed", tick, fact.S("family", m.Spec.Family), fact.N("level", m.Spec.Level), fact.S("source", SourceFork),
		fact.S("party", m.Spec.Party), fact.N("seats", int64(len(seats))), fact.S("stage", st.ID))
	return err
}

// vaultSolve plays a context's merged log against its vault machine. The
// first solve takes the haul, a rival haywires, and the context ends
// either way.
func (g *Game) vaultSolve(c *Char, cmd Command, sh *Shared, st *Stage) ([]fight.Pressed, *puzzle.Result, error) {
	defer g.inStage(st)()
	m := sh.Machine
	if !slices.Contains(m.Seats, c.C.ID) {
		return nil, nil, refuse(NoMachine, "%s has no seat at the machine", c.C.ID)
	}
	res, movers, seats := g.playShared(m, cmd)
	tick := g.Tick()
	if res.Solved {
		if err := g.partySolved(seats, m, res, movers, tick); err != nil {
			return nil, nil, err
		}
		if err := g.vaultTaken(c, cmd.Key, sh, st, seats, tick); err != nil {
			return nil, nil, err
		}
	} else if err := g.partyFailed(seats, m, res, tick, 0); err != nil {
		return nil, nil, err
	}
	if rival := m.Rival; rival != "" {
		if err := g.raced(sh, m, res, tick, cmd.Now); err != nil {
			return nil, nil, err
		}
		if o := g.SharedByID(rival); o != nil && o.LostRace == sh.ID {
			g.dropShared(o)
		}
	}
	g.endPartyMachine(sh, m, res, cmd.Now, tick, c)
	g.dropShared(sh)
	return nil, &res, nil
}

// vaultTaken pays the haul to a context that solved a vault no one has
// taken: one roll of the template's table for each seat, as goods staged
// at the stage's settlement.
func (g *Game) vaultTaken(c *Char, key string, sh *Shared, st *Stage, seats []*Char, tick int64) error {
	t := g.stageTemplate(st.Template)
	if st.Closed || st.Vault.Taken != "" || t == nil {
		return nil
	}
	st.Vault.Taken = sh.ID
	legs, goods := g.stagedRolls(st, t.Table, vaultDraw, seats)
	also := append([]fact.Ref{stageRef(st.ID)}, sh.refs()...)
	for _, s := range seats {
		if s != c {
			also = append(also, char.Ref(s.C.ID))
		}
	}
	data := append([]fact.Datum{fact.S("stage", st.ID), fact.S("template", st.Template), fact.S("label", st.Label), fact.N("settlement", int64(st.Settlement)),
		fact.S("family", st.Vault.Family), fact.N("level", st.Vault.Level), fact.N("seats", int64(len(seats))), fact.N("goods", goods)}, fact.At(st.At)...)
	f, err := g.factWith(c, also, "vault.taken", tick, data...)
	if err != nil {
		return err
	}
	return g.payStaged(ledger.Txn{Key: ledger.SubKey(key, vaultTxn, st.ID), Kind: vaultTxn, Tick: tick, Fact: f.ID, Legs: legs})
}

// stagedRolls are one roll of a liveops.drops table for each character
// but the stager, keyed by stage and character, minted from src:staged as
// goods staged at the stage's settlement; and the units they come to.
func (g *Game) stagedRolls(st *Stage, table string, p draw.Purpose, to []*Char) ([]ledger.Leg, int64) {
	var legs []ledger.Leg
	var total int64
	for _, c := range to {
		if st.Stager(c.C.ID) {
			continue
		}
		if s, ok := g.stagedRoll(table, p, draw.Str(st.ID), draw.Str(c.C.ID)); ok {
			legs = append(legs, ledger.Pair(ledger.FromStaged, ledger.Char(c.C.ID), ledger.Staged(st.Settlement, s.Material), s.Qty)...)
			total += s.Qty
		}
	}
	return ledger.Merge(legs), total
}

// payStaged posts a staged mint and puts what it gives in each
// character's hands.
func (g *Game) payStaged(t ledger.Txn) error {
	if len(t.Legs) == 0 {
		return nil
	}
	if err := g.post(t); err != nil {
		return err
	}
	for _, l := range t.Legs {
		if c := g.charOf(l.Account); c != nil {
			hold(c.C, l.Asset, l.Units)
		}
	}
	return nil
}

// vaultGate holds a seat at an armed vault there until its log lands, as
// a lone machine holds its character: walking off is the haywire.
func (g *Game) vaultGate(c *Char, cmd Command) error {
	if g.Live == nil || cmd.Kind == MachineSolve || Operator(cmd.Kind) {
		return nil
	}
	if sh := g.sharedOf(c); sh != nil && sh.Machine.Armed() && g.vaultOf(sh) != nil {
		return refuse(MachineArmed, "the vault's machine is armed and its countdown is running")
	}
	return nil
}

// stagedBoardID names a pattern stage's board.
func stagedBoardID(st *Stage) string { return stagedPrefix + st.ID }

// layStaged lays a pattern stage's board round its tile, every point free
// open ground with known ground within pin-path-tiles of it; refused
// pin-path otherwise. It changes nothing.
func (g *Game) layStaged(st *Stage) (*Board, *sheets.PatternPuzzle, error) {
	row := g.puzzleRow(st.Pattern)
	if row == nil || row.Shape == "" {
		return nil, nil, refuse(StageTemplate, "no pattern %q to lay", st.Pattern)
	}
	id := stagedBoardID(st)
	turn := int64(g.r.draw.Below(uint64(hex.Directions), patternDraw, draw.Str(st.ID), draw.Str(turnPart)))
	pts, ok := g.r.Gen.Layout(row.Shape, row.Size, row.Points, st.At, turn, draw.Str(id))
	if !ok {
		return nil, nil, refuse(world.CodePinPath, "%s will not lay round %s", row.ID, st.At.Ref())
	}
	walk := sheets.IntParam(g.r.Book.MapParams, "pin-path-tiles")
	for _, h := range pts {
		_, _, scaffold := g.pointAt(h)
		switch {
		case !g.chainFree(h) || scaffold || g.vaultAt(h, "") != nil:
			return nil, nil, refuse(world.CodePinPath, "a point of %s falls on %s, which is not free open ground", row.ID, h.Ref())
		case !g.World.KnownWithin(h, walk):
			return nil, nil, refuse(world.CodePinPath, "no known ground within %d tiles of %s", walk, h.Ref())
		}
	}
	b := &Board{ID: id, Rule: row.ID, Points: pts, Centre: st.At}
	for range pts {
		b.Places = append(b.Places, row.Place)
	}
	b.Clues = g.clueSites(b, row, g.chainFree)
	return b, row, nil
}

// checkPattern holds a pattern to ground every point may take.
func (g *Game) checkPattern(_ *Char, st *Stage, t *sheets.StageTemplate) error {
	if g.Story == nil {
		return refuse(StageTemplate, "this world holds no patterns")
	}
	_, _, err := g.layStaged(st)
	return err
}

// openPattern stores the stage's board. Ground built on since the order
// refuses it, and the stage holds nothing.
func (g *Game) openPattern(st *Stage, tick int64) error {
	if g.Story == nil || st.Board != "" {
		return nil
	}
	b, row, err := g.layStaged(st)
	if err != nil {
		return err
	}
	st.Board = b.ID
	g.Story.Patterns = append(g.Story.Patterns, b)
	_, err = g.worldFact(b.Centre, "pattern.placed", []fact.Ref{boardRef(b.ID), stageRef(st.ID)}, nil,
		append([]fact.Datum{fact.S("board", b.ID), fact.S("rule", row.ID), fact.S("stage", st.ID)}, fact.At(b.Centre)...)...)
	return err
}

// closePattern takes an unsolved staged board out of the world; a solved
// one stays, as every solved board does.
func (g *Game) closePattern(st *Stage, _ int64) error {
	if g.Story == nil || st.Board == "" {
		return nil
	}
	g.Story.Patterns = slices.DeleteFunc(g.Story.Patterns, func(b *Board) bool { return b.ID == st.Board && !b.P.Done })
	return nil
}

// boardStage is the stage a staged board was laid for, or nil.
func (g *Game) boardStage(b *Board) *Stage {
	if g.Live == nil || !strings.HasPrefix(b.ID, stagedPrefix) {
		return nil
	}
	for _, st := range g.Live.Stages {
		if st.Kind == sheets.StagePattern && st.Board == b.ID {
			return st
		}
	}
	return nil
}

// onBoard applies what follows in a staged board's stage, if it is one.
func (g *Game) onBoard(b *Board) func() {
	if st := g.boardStage(b); st != nil {
		return g.inStage(st)
	}
	return func() {}
}

// stagedCache pays a staged board's solvers, but its stager, one roll each
// of the template's table.
func (g *Game) stagedCache(st *Stage, b *Board, cause fact.ID, t int64) error {
	row := g.stageTemplate(st.Template)
	if row == nil {
		return nil
	}
	var to []*Char
	subjects := []fact.Ref{boardRef(b.ID), stageRef(st.ID)}
	for _, s := range b.solvers() {
		if c := g.Char(s.Key); c != nil && !st.Stager(c.C.ID) {
			to = append(to, c)
			subjects = append(subjects, char.Ref(c.C.ID))
		}
	}
	legs, goods := g.stagedRolls(st, row.Table, patternDraw, to)
	if len(legs) == 0 {
		return nil
	}
	f, err := g.worldFact(b.Centre, "pattern.cache", subjects, []fact.ID{cause},
		append([]fact.Datum{fact.S("board", b.ID), fact.S("cache", row.Table), fact.N("goods", goods), fact.S("stage", st.ID)}, fact.At(b.Centre)...)...)
	if err != nil {
		return err
	}
	return g.payStaged(ledger.Txn{Key: ledger.SubKey("tick", i64(t), refPattern, b.ID, row.Table), Kind: openCache, Tick: t, Fact: f, Legs: legs})
}
