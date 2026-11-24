package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// BackSide backs an arc stage's side (GDD 12.2): Target names the side's
// goal; goods carry Asset (or Material) and Units, and a side with none
// declares for it.
const BackSide = "goal-back"

// Refusal codes of backing.
const (
	NotASide  = "not-a-side"
	OtherSide = "other-side"
	StageOver = "stage-over"
	Shunned   = "shunned"
)

// structural: the prefix of the standing key backing against a faction
// accrues under, beside the sponsor's own key.
const backAgainst = "against/"

// SideOption is a side a character could back now: its goal, what is left
// of its mark, and where it is served.
type SideOption struct {
	Goal, Arc, Side, Wants, Tag string
	Left                        int64
	At                          hex.Hex
	Region                      string
	Backed                      bool
}

// backed is one running side as the backing rules read it.
type backed struct {
	x     *Goal
	a     *Arc
	stage int
	sr    *SideRun
	wants string
	tag   string
}

// backSide backs a side, refusing before anything changes.
func (g *Game) backSide(c *Char, cmd Command) error {
	x := g.GoalOf(cmd.Target)
	if x == nil || x.Hidden {
		return refuse(BadArgs, "no goal %q", cmd.Target)
	}
	s, ok := g.sideOf(x)
	if !ok {
		return refuse(NotASide, "%s is not an arc's side", x.ID)
	}
	if !ArcVisible(s.a, c.C.ID) {
		return refuse(NotASide, "%s is another character's thread", s.a.ID)
	}
	if !g.sideRunning(s) {
		return refuse(StageOver, "that stage of %s is over", s.a.ID)
	}
	if other, ok := g.backingIn(c.C.ID, s.a.ID, s.stage); ok && other.Side != s.sr.Side {
		return refuse(OtherSide, "%s backs %s in this stage", c.C.ID, other.Side)
	}
	if g.shunned(c, s) {
		return refuse(Shunned, "%s's sponsor will not take %s's backing", s.sr.Side, c.C.ID)
	}
	if s.wants != arc.WantGoods {
		if cmd.Units != 0 || cmd.Asset != "" || cmd.Material != "" {
			return refuse(BadArgs, "a %s side is backed by what is done, not by goods", s.wants)
		}
		if s.wants == arc.WantBeats && !g.inRegions(c.C.At, s.a.Regions) {
			return refuse(NotHere, "beats for %s count in its regions", s.a.ID)
		}
		return g.declare(c, s, cmd.Key)
	}
	if !g.standsIn(c, s.sr.At) {
		return refuse(NotHere, "goods for %s are brought to %s", s.sr.Side, s.sr.At)
	}
	material, ok := g.backMaterial(cmd)
	if !ok || cmd.Units <= 0 || !g.sideTakes(s.tag, material) {
		return refuse(BadArgs, "%s takes units of %s", s.sr.Side, cmp.Or(s.tag, "goods"))
	}
	units := min(cmd.Units, x.Left(c.C.ID))
	asset := ledger.Goods(material)
	if have := g.balance(c, asset); have < units {
		return refuse(Short, "%s carries %d %s of the %d", c.C.ID, have, material, units)
	}
	// Hot goods never fill a side their victim's faction sponsors (GDD 6.5).
	day := g.Tick() / sheets.TicksPerDay
	barred := g.barredBy(standingKey(s.sr.Sponsor, g.sideHex(s)), nil)
	if err := g.hotGuard(c, material, units, day, barred); err != nil {
		return err
	}
	f, err := g.factWith(c, []fact.Ref{goalRef(x.ID)}, "side.backed", g.Tick(), append(g.backData(s),
		fact.S("material", material), fact.N("units", units))...)
	if err != nil {
		return err
	}
	g.consumeHotBut(c, material, units, day, barred)
	t := ledger.Move(ledger.SubKey(cmd.Key, "back"), "side-goods", g.Tick(), ledger.Char(c.C.ID), ledger.ToFaction, asset, units)
	t.Fact = f.ID
	if err := g.postAll(t); err != nil {
		return err
	}
	return g.enlisted(c, s)
}

// declare records a character for a side its deeds fill, once a stage.
func (g *Game) declare(c *Char, s backed, key string) error {
	if b, ok := g.backingIn(c.C.ID, s.a.ID, s.stage); ok && b.Side == s.sr.Side {
		return refuse(BadArgs, "%s already backs %s", c.C.ID, s.sr.Side)
	}
	if _, err := g.factWith(c, []fact.Ref{goalRef(s.x.ID)}, "side.backed", g.Tick(), g.backData(s)...); err != nil {
		return err
	}
	return g.enlisted(c, s)
}

func (g *Game) backData(s backed) []fact.Datum {
	return append([]fact.Datum{fact.S("goal", s.x.ID), fact.S("arc", s.a.ID), fact.N("stage", int64(s.stage)), fact.S("side", s.sr.Side)}, fact.At(s.a.Seat)...)
}

// enlisted enlists a backer who chose its side, writing its first mark.
func (g *Game) enlisted(c *Char, s backed) error {
	if !g.enlist(c, s) {
		return nil
	}
	return g.writeMarked(c, s.a.ID)
}

func (g *Game) writeMarked(c *Char, arcID string) error {
	_, err := g.factWith(c, nil, "character.marked", g.Tick(), fact.S("arc", arcID))
	return err
}

// tellMarked writes the mark of each backer a credit pass enlisted.
func (g *Game) tellMarked() error {
	ms := g.marked
	g.marked = nil
	for _, m := range ms {
		if err := g.writeMarked(m.c, m.arc); err != nil {
			return err
		}
	}
	return nil
}

// enlist records a backer once and marks it for a world arc, reporting
// whether the mark is new.
func (g *Game) enlist(c *Char, s backed) bool {
	st := g.Story
	b := Backing{Char: c.C.ID, Arc: s.a.ID, Stage: s.stage, Side: s.sr.Side, Goal: s.x.ID}
	i, found := slices.BinarySearchFunc(st.Backers, b, cmpBacking)
	if !found {
		st.Backers = slices.Insert(st.Backers, i, b)
	}
	return g.markBacker(c, s.a)
}

func cmpBacking(a, b Backing) int {
	return cmp.Or(cmp.Compare(a.Char, b.Char), cmp.Compare(a.Arc, b.Arc), cmp.Compare(a.Stage, b.Stage))
}

// backingIn is the side a character backs in one stage of an arc.
func (g *Game) backingIn(who, arcID string, stage int) (Backing, bool) {
	if g.Story == nil {
		return Backing{}, false
	}
	bs := g.Story.Backers
	i, ok := slices.BinarySearchFunc(bs, Backing{Char: who, Arc: arcID, Stage: stage}, cmpBacking)
	if !ok {
		return Backing{}, false
	}
	return bs[i], true
}

// markBacker sets arc-marked on a world arc's backer until the arc ends
// (GDD 5.5), a mark an effect set for days becoming the arc's; it reports
// whether the character was not marked before.
func (g *Game) markBacker(c *Char, a *Arc) bool {
	if a.Scope != arc.ScopeWorld {
		return false
	}
	i := slices.IndexFunc(c.C.Conditions, func(x char.Condition) bool { return x.Tag == char.ArcMarked })
	if i >= 0 && c.C.Conditions[i].Ends == 0 {
		return false
	}
	was := c.C.Has(char.ArcMarked, g.Tick())
	c.C.Set(char.ArcMarked, 0)
	g.touchOnce(c)
	return !was
}

// sideOf reads a Back goal's side: its arc, stage and the side row's wants.
func (g *Game) sideOf(x *Goal) (backed, bool) {
	if g.Story == nil || x.Cond.Verb != goal.Back {
		return backed{}, false
	}
	arcID, stage, side, ok := parseSideKey(x.Cond.Side)
	if !ok {
		return backed{}, false
	}
	a := g.arcByID(arcID)
	if a == nil || stage < 0 || stage >= len(a.Stages) {
		return backed{}, false
	}
	sides := a.Stages[stage].Sides
	j := slices.IndexFunc(sides, func(s SideRun) bool { return s.Side == side && s.Goal == x.ID })
	if j < 0 {
		return backed{}, false
	}
	wants, tag, ok := g.sideWants(a, stage, side)
	return backed{x: x, a: a, stage: stage, sr: &sides[j], wants: wants, tag: tag}, ok
}

// SideOf is the arc, stage and side a Back goal fills.
func (g *Game) SideOf(x *Goal) (*Arc, int, SideRun, bool) {
	s, ok := g.sideOf(x)
	if !ok {
		return nil, 0, SideRun{}, false
	}
	return s.a, s.stage, *s.sr, true
}

// SideKey names one side of one stage of an arc, as a Back goal's
// condition carries it.
func SideKey(arcID string, stage int, side string) string {
	return arcID + sidePart + strconv.Itoa(stage) + sidePart + side
}

func parseSideKey(k string) (arcID string, stage int, side string, ok bool) {
	arcID, rest, ok1 := strings.Cut(k, sidePart)
	num, side, ok2 := strings.Cut(rest, sidePart)
	n, err := strconv.Atoi(num)
	if !ok1 || !ok2 || err != nil {
		return "", 0, "", false
	}
	return arcID, n, side, true
}

func (g *Game) arcByID(id string) *Arc {
	for _, a := range g.Story.Arcs {
		if a.ID == id {
			return a
		}
	}
	return nil
}

// sideWants is what a side counts and the tag its goods carry: an arc
// row's stage side, or a trouble's one side.
func (g *Game) sideWants(a *Arc, stage int, side string) (wants, tag string, ok bool) {
	row, ok := g.stageRow(a, stage)
	if !ok {
		return
	}
	sr, ok := sideRow(row, side)
	return sr.Wants, sr.Tag, ok
}

// sideRunning reports whether a side's stage is the arc's current one and
// still undecided, with its goal live.
func (g *Game) sideRunning(s backed) bool {
	st := &s.a.Stages[s.stage]
	return !s.a.over() && s.a.Stage == s.stage && !st.over() &&
		s.x.State == goal.Live && !s.x.Due(g.Tick())
}

// shunned reports whether a character's standing with a side's sponsor is
// too low for it to back the side (GDD 5.4), or a syndicate thread's
// character stands under the syndicate's gate (GDD 4.5).
func (g *Game) shunned(c *Char, s backed) bool {
	if tpl, ok := g.template(s.a.Template); ok && tpl.Row.Syndicate && !g.pastGate(c) {
		return true
	}
	// A word said to a cast NPC backs no faction, so its sponsor's
	// standing does not gate it.
	if s.wants == arc.WantWord {
		return false
	}
	return c.C.Standing.Get(standingKey(s.sr.Sponsor, g.sideHex(s))) <= g.r.Story.ShunnedBelow
}

// sideHex is where a side is served: its settlement, tile, the trouble's
// place, or else the arc's seat.
func (g *Game) sideHex(s backed) hex.Hex {
	if h, ok := g.refHex(s.sr.At); ok {
		return h
	}
	if h, ok := g.refHex(s.a.Place); ok {
		return h
	}
	return s.a.Seat
}

// refHex is the tile a settlement or tile ref names.
func (g *Game) refHex(ref string) (hex.Hex, bool) {
	if n, ok := goal.SettlementOf(ref); ok {
		if n < len(g.Places) {
			return g.SettlementHex(n), true
		}
		return hex.Hex{}, false
	}
	if kind, id, ok := goal.ParseRef(ref); ok && kind == goal.PlaceTile {
		return hex.ParseRef(id)
	}
	return hex.Hex{}, false
}

func (g *Game) inRegions(h hex.Hex, regions []int) bool {
	r := g.World.RegionAt(h)
	return r >= 0 && slices.Contains(regions, r)
}

// backMaterial is the goods a command sends: a ledger asset, or a material.
func (g *Game) backMaterial(cmd Command) (string, bool) {
	m := cmd.Material
	if cmd.Asset != "" {
		if got, ok := ledger.GoodsOf(cmd.Asset); ok {
			m = got
		} else {
			m = cmd.Asset
		}
	}
	return m, m == ledger.Provisions || m != "" && g.isMaterial(ledger.Material(m))
}

// BackTakes reports whether a goods side's Back goal takes a material,
// wherever the character stands; the goods count only at the side's place.
func (g *Game) BackTakes(x *Goal, material string) bool {
	s, ok := g.sideOf(x)
	return ok && s.wants == arc.WantGoods && g.sideTakes(s.tag, material)
}

// sideTakes reports whether goods of a material serve a side's tag: any
// goods with none, provisions alone for provisions, else a material
// carrying the tag.
func (g *Game) sideTakes(tag, material string) bool {
	switch {
	case tag == "":
		return true
	case tag == ledger.Provisions || material == ledger.Provisions:
		return tag == material
	}
	return slices.Contains(g.materialTags(material), tag) || material == tag
}

// backEvents reads a fact as Back events, each bound to the side goal it
// counts toward (GDD 12.10). Because see reads each fact once, it also
// records each counted contribution: its standing, and an implicit
// contributor as a backer; a fact a side already cites is not read again.
func (g *Game) backEvents(f fact.Fact) []goal.Event {
	if g.Story == nil || len(g.Story.Arcs) == 0 {
		return nil
	}
	switch f.Kind {
	case "side.backed", "beat.won", "hunt.pressed", "travel.entered", "order.filled", factNPCChose, factTheft:
	default:
		return nil
	}
	if len(f.Subjects) == 0 || f.Subjects[0].Kind != "character" {
		return nil
	}
	c := g.Char(f.Subjects[0].ID)
	if c == nil {
		return nil
	}
	switch f.Kind {
	case "side.backed":
		return g.backedGoods(c, f)
	case factTheft:
		return g.preyGoods(c, f)
	}
	var out []goal.Event
	for _, s := range g.runningSides(c.C.ID) {
		units, worth, implicit := g.counts(c, s, f)
		if units <= 0 {
			continue
		}
		if e, ok := g.contribute(c, s, f, units, worth, implicit); ok {
			out = append(out, e)
		}
	}
	return out
}

// backedGoods is a goods side's delivery read as its Back event.
func (g *Game) backedGoods(c *Char, f fact.Fact) []goal.Event {
	gd, _ := f.Get("goal")
	units, _ := f.Get("units")
	material, _ := f.Get("material")
	x := g.GoalOf(gd.S)
	if x == nil || units.N <= 0 {
		return nil
	}
	s, ok := g.sideOf(x)
	if !ok || s.wants != arc.WantGoods {
		return nil
	}
	e, ok := g.contribute(c, s, f, units.N, units.N*g.r.Values.Asset(material.S), false)
	if !ok {
		return nil
	}
	return []goal.Event{e}
}

// preyGoods is a waylay for a prey side read as its Back event: the units
// taken, times prey-share, for a backer of the side (GDD 12.9).
func (g *Game) preyGoods(c *Char, f fact.Fact) []goal.Event {
	side, _ := f.Get("side")
	outcome, _ := f.Get("outcome")
	x := g.GoalOf(side.S)
	if x == nil || outcome.S != theftWon {
		return nil
	}
	s, ok := g.sideOf(x)
	if !ok || s.wants != arc.WantGoods {
		return nil
	}
	if b, ok := g.backingIn(c.C.ID, s.a.ID, s.stage); !ok || b.Side != s.sr.Side {
		return nil
	}
	units, _ := f.Get("units")
	material, _ := f.Get("material")
	n := fixed.PercentFloor(units.N, g.hotCell("prey-share"))
	if n <= 0 {
		return nil
	}
	e, ok := g.contribute(c, s, f, n, n*g.r.Values.Asset(material.S), false)
	if !ok {
		return nil
	}
	return []goal.Event{e}
}

// runningSides are the running sides viewer may read, in arc order. Another
// character's thread is passed over before its goal is read.
func (g *Game) runningSides(viewer string) []backed {
	var out []backed
	for _, a := range g.Story.Arcs {
		if !ArcVisible(a, viewer) || a.over() || a.Stage < 0 || a.Stage >= len(a.Stages) {
			continue
		}
		st := &a.Stages[a.Stage]
		for j := range st.Sides {
			sr := &st.Sides[j]
			x := g.GoalOf(sr.Goal)
			if x == nil || x.State != goal.Live {
				continue
			}
			wants, tag, ok := g.sideWants(a, a.Stage, sr.Side)
			if !ok {
				continue
			}
			out = append(out, backed{x: x, a: a, stage: a.Stage, sr: sr, wants: wants, tag: tag})
		}
	}
	return out
}

// counts is what a fact adds to a side for a character, its coin's worth,
// and whether it counts without a declaration.
func (g *Game) counts(c *Char, s backed, f fact.Fact) (units, worth int64, implicit bool) {
	num := func(k string) int64 { d, _ := f.Get(k); return d.N }
	beat := g.r.Story.BeatCoin
	switch {
	case f.Kind == "beat.won" && (s.wants == arc.WantBeats || s.wants == arc.WantDefence):
		r, ok := world.ParseRegionRef(f.Region)
		if !ok || !slices.Contains(s.a.Regions, r) {
			return 0, 0, false
		}
		units = num("score")
		if s.wants == arc.WantDefence {
			units = g.defence(c, units)
			return units, units * beat, true
		}
		if b, ok := g.backingIn(c.C.ID, s.a.ID, s.stage); !ok || b.Side != s.sr.Side {
			return 0, 0, false
		}
		return units, units * beat, false
	case f.Kind == "hunt.pressed" && s.wants == arc.WantDefence:
		if s.a.Hunt == "" || !slices.Contains(f.Subjects, huntRef(s.a.Hunt)) {
			return 0, 0, false
		}
		units = g.defence(c, num("removed"))
		return units, units * beat, true
	case f.Kind == "travel.entered" && s.wants == arc.WantReach:
		h, at := fact.HexOf(f)
		if t, ok := g.refHex(s.sr.At); !at || !ok || t != h || s.x.Progress.Get(c.C.ID) > 0 {
			return 0, 0, false
		}
		return 1, beat, true
	case f.Kind == factNPCChose && s.wants == arc.WantWord:
		if choice, _ := f.Get("choice"); choice.S != s.sr.Side || !g.saidTo(s, f) {
			return 0, 0, false
		}
		return 1, beat, true
	case f.Kind == "order.filled" && s.wants == arc.WantSold:
		fi, ok := f.Get("faction")
		n, ok2 := goal.SettlementOf(s.a.Place)
		ref, ok3 := s.a.Cast.Get("faction")
		if !ok || !ok2 || !ok3 || num("settlement") != int64(n) || ref != arc.FactionRef(int(fi.N)) {
			return 0, 0, false
		}
		units = num("units") * num("price")
		return units, units, true
	}
	return 0, 0, false
}

// saidTo reports whether a choice fact was made to the NPC cast at a word
// side's role.
func (g *Game) saidTo(s backed, f fact.Fact) bool {
	row, ok := g.stageRow(s.a, s.stage)
	if !ok {
		return false
	}
	sd, ok := sideRow(row, s.sr.Side)
	if !ok {
		return false
	}
	ref, ok := g.roleRef(s.a, sd.At)
	return ok && ref.Kind == kindNPC && slices.Contains(f.Subjects, ref)
}

// structural: the fact a choice at a meeting writes, and a won theft's
// outcome.
const (
	factNPCChose = "npc.chose"
	theftWon     = "won"
)

// defence is a beat's count toward a raid's defence: doubled for a
// wall-captain.
func (g *Game) defence(c *Char, units int64) int64 {
	return fixed.PercentFloor(units, g.charScale(c, "raid-defence-beats", fixed.Hundredths))
}

// contribute turns a counted part into the side's event, accruing its
// standing; an implicit contributor must be free to back the side.
func (g *Game) contribute(c *Char, s backed, f fact.Fact, units, worth int64, implicit bool) (goal.Event, bool) {
	who := c.C.ID
	if slices.ContainsFunc(s.x.Facts, func(ci goal.Cite) bool { return ci.Fact == f.ID && ci.Who == who }) {
		return goal.Event{}, false
	}
	if !ArcVisible(s.a, who) || !s.x.May(who) {
		return goal.Event{}, false
	}
	if implicit {
		if b, ok := g.backingIn(who, s.a.ID, s.stage); (ok && b.Side != s.sr.Side) || g.shunned(c, s) {
			return goal.Event{}, false
		}
	}
	counted := min(units, s.x.Left(who))
	if counted <= 0 {
		return goal.Event{}, false
	}
	if implicit && g.enlist(c, s) {
		g.marked = append(g.marked, markedBy{c, s.a.ID})
	}
	g.credit(c, s.sr.Sponsor, s.sr.Opponent, g.sideHex(s), worth*counted/units)
	g.touchOnce(c)
	e := goal.Event{Fact: f.ID, Verb: goal.Back, Who: who, Goal: s.x.ID, Units: counted}
	if h, ok := fact.HexOf(f); ok {
		e.Hex = h
	}
	if s.x.Cond.At != "" {
		e.Places = []string{s.x.Cond.At}
	}
	return e, true
}

// credit accrues a contribution's coin's worth toward standing (GDD 12.3):
// +1 with the sponsor per standing-for, −1 with the opponent per
// standing-against, none when the opponent is the sponsor or nobody. at is
// the place whose keepers a keepers sponsor stands for.
func (g *Game) credit(c *Char, sponsor, opponent int, at hex.Hex, worth int64) {
	if worth <= 0 {
		return
	}
	key := standingKey(sponsor, at)
	if gain := g.accrue(c, key, worth, g.r.Story.StandingFor); gain > 0 {
		g.adjustStanding(c, key, gain)
	}
	if opponent < 0 || opponent == sponsor {
		return
	}
	against := standingKey(opponent, at)
	if loss := g.accrue(c, backAgainst+against, worth, g.r.Story.StandingAgainst); loss > 0 {
		g.adjustStanding(c, against, -loss)
	}
}

// adjustStanding moves a character's standing under key, clamped to the
// growth sheet's bounds.
func (g *Game) adjustStanding(c *Char, key string, by int64) int64 {
	d := g.standingDelta(c, key, by)
	c.C.Standing.Bump(key, d)
	return d
}

// standingDelta is the change adding by to a standing makes, held between
// standing-min and standing-max.
func (g *Game) standingDelta(c *Char, key string, by int64) int64 {
	gp := g.r.Growth.Params()
	now := c.C.Standing.Get(key)
	return min(sheets.IntParam(gp, "standing-max"), max(sheets.IntParam(gp, "standing-min"), now+by)) - now
}

// accrue adds worth under a key and gives the whole points it now owes.
func (g *Game) accrue(c *Char, key string, worth, per int64) int64 {
	c.BackWorth.Bump(key, worth)
	n := arc.Standing(c.BackWorth.Get(key), c.BackGiven.Get(key), per)
	if n > 0 {
		c.BackGiven.Bump(key, n)
	}
	return n
}

// markedShare is the percent a character's ambush chance on a tile is
// multiplied by: marked-ambush for an arc-marked backer inside its world
// arc's regions or a region the opposing sponsor holds, and anywhere for
// one an effect marked with no world arc backed; 100 otherwise (GDD 5.5).
func (g *Game) markedShare(c *Char, h hex.Hex) int64 {
	if g.Story == nil || !c.C.Has(char.ArcMarked, g.Tick()) {
		return fixed.Hundredths
	}
	marked := g.r.Story.MarkedAmbush
	r := g.World.RegionAt(h)
	bs := g.Story.Backers
	i, _ := slices.BinarySearchFunc(bs, Backing{Char: c.C.ID}, func(a, b Backing) int { return cmp.Compare(a.Char, b.Char) })
	backs := false
	for ; i < len(bs) && bs[i].Char == c.C.ID; i++ {
		b := bs[i]
		a := g.arcByID(b.Arc)
		if a == nil || a.Scope != arc.ScopeWorld || a.over() || b.Stage >= len(a.Stages) {
			continue
		}
		backs = true
		if r < 0 {
			continue
		}
		if slices.Contains(a.Regions, r) {
			return marked
		}
		holder := g.World.Regions[r].Holder
		for _, s := range a.Stages[b.Stage].Sides {
			if s.Side != b.Side && s.Sponsor != econ.Keepers && s.Sponsor == holder {
				return marked
			}
		}
	}
	if !backs {
		return marked
	}
	return fixed.Hundredths
}

// SidesFor are the running sides a character could back: every side of a
// stage it backs nothing in yet, or the side it backs, less another
// character's thread and sides whose sponsor shuns it.
func (g *Game) SidesFor(c *Char) []SideOption {
	if g.Story == nil {
		return nil
	}
	var out []SideOption
	for _, s := range g.runningSides(c.C.ID) {
		b, backs := g.backingIn(c.C.ID, s.a.ID, s.stage)
		if (backs && b.Side != s.sr.Side) || !s.x.May(c.C.ID) || g.shunned(c, s) {
			continue
		}
		at := g.sideHex(s)
		if s.wants == arc.WantBeats || (s.wants == arc.WantDefence && s.a.Hunt == "") {
			at = g.nearestIn(c.C.At, s.a.Regions, at)
		}
		region := ""
		if r := g.World.RegionAt(at); r >= 0 {
			region = g.RegionName(r)
		}
		out = append(out, SideOption{Goal: s.x.ID, Arc: s.a.ID, Side: s.sr.Side, Wants: s.wants, Tag: s.tag,
			Left: s.x.Left(c.C.ID), At: at, Region: region, Backed: backs})
	}
	return out
}

// nearestIn is where a character works a side counted in regions: where
// it stands when inside one, else the nearest of their centres.
func (g *Game) nearestIn(h hex.Hex, regions []int, or hex.Hex) hex.Hex {
	if g.inRegions(h, regions) {
		return h
	}
	best, bestD := or, int64(-1)
	for _, r := range regions {
		if r < 0 || r >= len(g.World.Regions) {
			continue
		}
		centre := g.r.Gen.Region(g.World.Regions[r].Lattice).Centre
		if d := hex.Distance(centre, h); bestD < 0 || d < bestD {
			best, bestD = centre, d
		}
	}
	return best
}
