package game

import (
	"cmp"
	"errors"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// A server's staging (GDD 14.3, 14.4): its staff and admins order a
// template at a settlement its guild runs; the stage opens at its tick,
// builds its parts in the stage's context, and closes past its end.
// Staff pay event points from the settlement's pool at the order; admins
// pay nothing. Whatever a stage pays out is staged goods.

func init() {
	registerHouse(Staging, stageCmd)
	registerHouse(StagingEnd, stageEnd)
	registerHouse(CrateOpen, crateOpen)
	houseTicks = append(houseTicks, openDue)
	houseDays = append(houseDays, closeDue, refillPools)
}

// stagedPart is how a kind of stage owned by another rule is checked at
// the order, opened and closed; that rule registers it from its init.
// Check must change nothing.
type stagedPart struct {
	Check func(g *Game, c *Char, st *Stage, t *sheets.StageTemplate) error
	Open  func(g *Game, st *Stage, tick int64) error
	Close func(g *Game, st *Stage, tick int64) error
}

// stagedParts are the registered parts, by template kind.
var stagedParts = map[string]stagedPart{}

// The staging facts.
const (
	factStagedOrdered = "staged.ordered"
	factStagedOpened  = "staged.opened"
	factStagedClosed  = "staged.closed"
	factCrateOpened   = "crate.opened"
)

// Why a stage closed.
const (
	closedLapsed = "lapsed"
	closedEnded  = "ended"
)

func (g *Game) lp(id string) int64 { return sheets.IntParam(g.r.Book.LiveOpsParams, id) }

func stageRef(id string) fact.Ref { return fact.Ref{Kind: kindStage, ID: id} }

// stageTemplate is a liveops.templates row, or nil.
func (g *Game) stageTemplate(id string) *sheets.StageTemplate {
	for i := range g.r.Book.LiveOpsTemplates {
		if g.r.Book.LiveOpsTemplates[i].ID == id {
			return &g.r.Book.LiveOpsTemplates[i]
		}
	}
	return nil
}

// contestRow is a liveops.contests row, or nil.
func (g *Game) contestRow(id string) *sheets.ContestRow {
	for i := range g.r.Book.LiveOpsContests {
		if g.r.Book.LiveOpsContests[i].ID == id {
			return &g.r.Book.LiveOpsContests[i]
		}
	}
	return nil
}

// LiveStages are a settlement's stages not yet closed, opened or due, in
// order of staging.
func (g *Game) LiveStages(settlement int) []*Stage {
	if g.Live == nil {
		return nil
	}
	var out []*Stage
	for _, st := range g.Live.Stages {
		if st.Settlement == settlement && !st.Closed {
			out = append(out, st)
		}
	}
	return out
}

// PoolOf is a settlement's staff pool for a server, in event points: full
// until first spent from.
func (g *Game) PoolOf(server string, settlement int) int64 {
	if h := g.House(server); h != nil {
		if i, ok := poolAt(h, settlement); ok {
			return h.Pools[i].Points
		}
	}
	return g.lp("pool-cap")
}

// PoolRefill is what each of a server's pools gains at the next world
// day, before the cap.
func (g *Game) PoolRefill(server string) int64 {
	var active int64
	for c := range g.activeChars() {
		if c.Server == server {
			active++
		}
	}
	add := g.lp("pool-refill")
	if per := g.lp("pool-per-active"); per > 0 {
		add += active / per
	}
	return add
}

// poolFor is a settlement's pool for a server, made full on first use.
func (g *Game) poolFor(server string, settlement int) *Pool {
	h := g.houseFor(server)
	i, ok := poolAt(h, settlement)
	if !ok {
		h.Pools = slices.Insert(h.Pools, i, Pool{Settlement: settlement, Points: g.lp("pool-cap")})
	}
	return &h.Pools[i]
}

func poolAt(h *House, settlement int) (int, bool) {
	return slices.BinarySearchFunc(h.Pools, settlement, func(p Pool, n int) int { return cmp.Compare(p.Settlement, n) })
}

// payPool takes event points from a pool for a staff order, once its
// checks have passed.
func (g *Game) payPool(server string, settlement int, points int64) {
	if points <= 0 {
		return
	}
	g.poolFor(server, settlement).Points -= points
	g.spend(points)
}

// refillPools tops up every pool at the world day by its server's refill.
func refillPools(g *Game, _ int64) error {
	most := g.lp("pool-cap")
	for _, h := range g.Houses {
		if len(h.Pools) == 0 {
			continue
		}
		add := g.PoolRefill(h.Server)
		for i := range h.Pools {
			h.Pools[i].Points = min(most, h.Pools[i].Points+add)
		}
	}
	return nil
}

// stageCmd is a staging order. Every check runs before anything changes,
// so a refusal leaves the game as it was.
func stageCmd(g *Game, c *Char, cmd Command) error {
	s := cmd.Stage
	if s == nil {
		return refuse(BadArgs, "a staging carries its order")
	}
	role, gd, err := g.houseRole(cmd, s.Settlement)
	if err != nil {
		return err
	}
	t := g.stageTemplate(s.Template)
	switch {
	case t == nil:
		return refuse(StageTemplate, "no template %q", s.Template)
	case role == RoleStaff && !t.Staff:
		return refuse(StageTemplate, "%s is staged by a server's admins only", t.ID)
	}
	if err := g.stageSite(s.Settlement, s.At); err != nil {
		return err
	}
	if n := int64(len(g.LiveStages(s.Settlement))); n >= g.lp("live-stages-most") {
		return refuse(StageLimit, "settlement %d holds %d live stages already", s.Settlement, n)
	}
	if err := g.stageChoice(s, t); err != nil {
		return err
	}
	opens, days, err := g.stageWhen(s, t)
	if err != nil {
		return err
	}
	points := int64(0)
	if role == RoleStaff {
		points = t.Points
		if have := g.PoolOf(cmd.Server, s.Settlement); have < points {
			return refuse(PoolShort, "%s costs %d event points and the pool holds %d", t.ID, points, have)
		}
	}
	next := int64(0)
	if g.Live != nil {
		next = g.Live.Next
	}
	now := g.Tick()
	st := &Stage{ID: "st-" + strconv.FormatInt(next+1, decimal), Template: t.ID, Kind: t.Kind, Server: cmd.Server, Role: role, By: c.C.ID,
		Label: gd.G.Name, Points: points, Settlement: s.Settlement, At: s.At, Opens: now + opens, Ends: now + opens + days*sheets.TicksPerDay,
		Hunt: s.Hunt, Contest: s.Contest, Pattern: s.Pattern}
	if err := g.stagePrecheck(c, st, t, opens == 0); err != nil {
		return err
	}
	g.payPool(cmd.Server, s.Settlement, points)
	if g.Live == nil {
		g.Live = &LiveOps{}
	}
	g.Live.Next = next + 1
	g.Live.Stages = append(g.Live.Stages, st)
	if opens == 0 {
		return g.openStage(st, now)
	}
	_, err = g.worldFact(st.At, factStagedOrdered, []fact.Ref{stageRef(st.ID)}, nil, stageData(st)...)
	return err
}

// stageSite refuses a stage's tile: off the settlement's region, outside
// the awake world, impassable, or a settlement's own.
func (g *Game) stageSite(settlement int, at hex.Hex) error {
	gen := g.r.Gen
	switch {
	case gen.RegionOf(at) != gen.RegionOf(g.SettlementHex(settlement)):
		return refuse(HouseScope, "%s is outside the region of settlement %d", at.Ref(), settlement)
	case g.World.RegionAt(at) < 0 || !gen.Passable(gen.Baseline(at).Terrain):
		return refuse(BadArgs, "a stage stands on passable ground in the awake world")
	case g.IsSettlement(at):
		return refuse(BadArgs, "a stage stands outside a settlement")
	}
	return nil
}

// stageChoice refuses the creature, contest or pattern an order names
// where its template takes another or none.
func (g *Game) stageChoice(s *StageCmd, t *sheets.StageTemplate) error {
	hunt, contest, pattern := t.Kind == sheets.StageHunt, t.Kind == sheets.StageContest, t.Kind == sheets.StagePattern
	switch {
	case (s.Hunt != "") != hunt:
		return refuse(BadArgs, "a hunt template, and only one, names its hunt")
	case (s.Contest != "") != contest:
		return refuse(BadArgs, "a contest template, and only one, names its contest")
	case (s.Pattern != "") != pattern:
		return refuse(BadArgs, "a pattern template, and only one, names its pattern")
	case pattern && !slices.Contains(t.Patterns, s.Pattern):
		return refuse(BadArgs, "%s lays none of pattern %q", t.ID, s.Pattern)
	case contest && g.contestRow(s.Contest) == nil:
		return refuse(BadArgs, "no contest %q", s.Contest)
	}
	if hunt {
		if def, ok := g.r.Fight.Hunt(s.Hunt); !ok || def.Kind != "" {
			return refuse(NoSuchRow, "no world hunt %q to stage", s.Hunt)
		}
	}
	return nil
}

// stageWhen is how many ticks from now a stage opens and how many days it
// lasts: from now to stage-lead-days ahead, and 1 to stage-days-max days,
// 0 taking the template's.
func (g *Game) stageWhen(s *StageCmd, t *sheets.StageTemplate) (opens, days int64, err error) {
	lead := g.lp("stage-lead-days") * sheets.TicksPerDay
	if s.Opens < 0 || s.Opens > lead {
		return 0, 0, refuse(BadArgs, "a stage opens from now to %d ticks ahead", lead)
	}
	days = cmp.Or(s.Days, t.Days)
	if most := g.lp("stage-days-max"); days < 1 || days > most {
		return 0, 0, refuse(BadArgs, "a stage lasts 1 to %d days", most)
	}
	return s.Opens, days, nil
}

// stagePrecheck refuses a stage whose parts could not be built: a part
// another rule owns that it has not registered or that refuses, a
// contest no goal can be posted for, a hardship in a world with no story,
// or a hunt or hardship that opening now would find already open.
func (g *Game) stagePrecheck(c *Char, st *Stage, t *sheets.StageTemplate, now bool) error {
	part, owned := stagedParts[t.Kind]
	switch t.Kind {
	case sheets.StageHunt:
		region := world.RegionRef(g.World.RegionAt(st.At))
		if now && (g.openHunt(st.Hunt, region) != nil || g.stagedHunt(st.Hunt, region) != nil) {
			return refuse(OpenHunt, "a hunt of %s is already open in %s", st.Hunt, region)
		}
	case sheets.StageHardship:
		place := goal.SettlementRef(st.Settlement)
		if g.Story == nil {
			return refuse(NoSeason, "the world keeps no story")
		}
		if now && slices.ContainsFunc(g.openArcs(arc.Settlement), func(a *Arc) bool { return a.By == ByServer && a.Place == place }) {
			return refuse(SlotBusy, "settlement %d already has a staged hardship", st.Settlement)
		}
	case sheets.StageContest:
		if _, err := g.contestGoal(st, g.contestRow(st.Contest), g.Tick()); err != nil {
			return err
		}
	case sheets.StageVault, sheets.StagePattern:
		if part.Open == nil {
			return refuse(StageTemplate, "nothing builds a %s stage yet", t.Kind)
		}
	}
	if owned && part.Check != nil {
		return part.Check(g, c, st, t)
	}
	return nil
}

// stageData is what a staging's facts say of it.
func stageData(st *Stage) []fact.Datum {
	return []fact.Datum{fact.S("template", st.Template), fact.S("kind", st.Kind), fact.N("settlement", int64(st.Settlement)),
		fact.S("role", st.Role), fact.S("label", st.Label), fact.N("points", st.Points), fact.N("days", (st.Ends-st.Opens)/sheets.TicksPerDay)}
}

// openDue opens every stage due by the tick.
func openDue(g *Game, tick int64) error {
	if g.Live == nil {
		return nil
	}
	for _, st := range g.Live.Stages {
		if !st.Open && !st.Closed && st.Opens <= tick {
			if err := g.openStage(st, tick); err != nil {
				return err
			}
		}
	}
	return nil
}

// openStage builds a stage's parts in its context and announces it. A
// part refused at the opening closes the stage there and then.
func (g *Game) openStage(st *Stage, tick int64) error {
	defer g.withStage(st)()
	st.Open = true
	err := g.openParts(st, tick)
	if r := (*Refused)(nil); errors.As(err, &r) {
		return g.closeStage(st, r.Code, tick)
	}
	if err != nil {
		return err
	}
	data := append(stageData(st), fact.N("crates", st.Crates))
	_, err = g.worldFact(st.At, factStagedOpened, []fact.Ref{stageRef(st.ID)}, nil, data...)
	return err
}

func (g *Game) openParts(st *Stage, tick int64) error {
	t := g.stageTemplate(st.Template)
	if t == nil {
		return refuse(StageTemplate, "no template %q", st.Template)
	}
	switch st.Kind {
	case sheets.StageHunt:
		return g.openStagedHunt(st, tick)
	case sheets.StageHardship:
		return g.castHardship(st, tick)
	case sheets.StageContest:
		row := g.contestRow(st.Contest)
		if row == nil {
			return refuse(BadArgs, "no contest %q", st.Contest)
		}
		return g.postContest(st, row, tick)
	case sheets.StageFair:
		for _, row := range g.r.Book.FairContests() {
			// A fair runs what it can: a contest with nowhere to be met is left out.
			if err := g.postContest(st, &row, tick); err != nil && !errors.As(err, new(*Refused)) {
				return err
			}
		}
		st.Crates = t.Crates
	case sheets.StageDrop:
		st.Crates = t.Crates
	default:
		part := stagedParts[st.Kind]
		if part.Open == nil {
			return refuse(StageTemplate, "nothing builds a %s stage", st.Kind)
		}
		return part.Open(g, st, tick)
	}
	return nil
}

// closeDue closes, at the world day, every stage past its end, and
// forgets those closed a world day past their end, as hunts are.
func closeDue(g *Game, _ int64) error {
	if g.Live == nil {
		return nil
	}
	t := g.Tick()
	for _, st := range g.Live.Stages {
		if st.Open && !st.Closed && st.Ends <= t {
			if err := g.closeStage(st, closedLapsed, t); err != nil {
				return err
			}
		}
	}
	g.Live.Stages = slices.DeleteFunc(g.Live.Stages, func(st *Stage) bool { return st.Closed && st.Ends < t-sheets.TicksPerDay })
	return nil
}

// closeStage ends a stage: its parts lapse as each would on its own, the
// crates left go unopened, and nothing is refunded.
func (g *Game) closeStage(st *Stage, why string, tick int64) error {
	defer g.withStage(st)()
	if part := stagedParts[st.Kind]; part.Close != nil {
		if err := part.Close(g, st, tick); err != nil {
			return err
		}
	}
	if x := g.HuntByID(st.HuntID); x != nil && !x.H.Over {
		if err := g.leaveHunt(x, tick); err != nil {
			return err
		}
	}
	if st.Arc != "" && g.Story != nil {
		if a := g.arcByID(st.Arc); a != nil && !a.over() {
			if err := g.closeArc(a, tick); err != nil {
				return err
			}
		}
	}
	key := ledger.SubKey("stage", st.ID, "close")
	var winners int64
	for _, id := range st.Goals {
		x := g.GoalOf(id)
		if x == nil {
			continue
		}
		winners += int64(len(x.Claims))
		if x.Open() {
			if err := g.endGoal(x, "expired", key); err != nil {
				return err
			}
		}
	}
	st.Crates, st.Closed = 0, true
	data := append(stageData(st), fact.N("crates", st.Opened.Sum()), fact.N("winners", winners), fact.S("why", why))
	_, err := g.worldFact(st.At, factStagedClosed, []fact.Ref{stageRef(st.ID)}, nil, data...)
	return err
}

// stageEnd ends a live stage early: its server's admins end any of its
// stages, its staff only a staff stage. Nothing is refunded.
func stageEnd(g *Game, _ *Char, cmd Command) error {
	role, _, err := g.houseRole(cmd, houseWide)
	if err != nil {
		return err
	}
	st := g.StageByID(cmd.Target)
	switch {
	case st == nil || st.Closed:
		return refuse(NoStage, "no live stage %q", cmd.Target)
	case st.Server != cmd.Server:
		return refuse(HouseScope, "%s was not staged from this server", st.ID)
	case role == RoleStaff && st.Role != RoleStaff:
		return refuse(HouseRoleCode, "%s was staged by the server's admins", st.ID)
	}
	return g.closeStage(st, closedEnded, g.Tick())
}

// contestGoal is the Each goal a contest row posts for a stage: no coin,
// no escrow and no fee, each winner rolling the row's prize. It changes
// nothing.
func (g *Game) contestGoal(st *Stage, row *sheets.ContestRow, tick int64) (*Goal, error) {
	cond := goal.Condition{Verb: row.Verb, Count: row.Count}
	switch row.Verb {
	case sheets.ContestDefeat:
		cond.Kind = row.Target
	case sheets.ContestMake:
		cond.Tag = row.Target
	case sheets.ContestReach:
		tiles, _ := row.ReachTiles()
		h, ok := g.reachTile(st.Settlement, tiles, st.At)
		if !ok {
			return nil, refuse(NotHere, "no tile %d tiles from settlement %d can be walked to", tiles, st.Settlement)
		}
		cond.At = goal.TileRef(h)
	}
	x := &Goal{Title: cmp.Or(g.r.Name("liveops.contests:"+row.ID), row.ID), Issuer: goal.Ref{Kind: goal.ByStaged, ID: st.ID}, Scope: goal.World,
		Board: st.Settlement, Cond: cond, Prize: row.Prize, Mode: goal.Each, Cap: row.Most, Lifetime: goal.Ephemeral, Turnover: goal.Expire,
		Posted: tick, Expires: min(st.Ends, tick+row.Days*sheets.TicksPerDay), State: goal.Live}
	if err := goal.Valid(x, tick, g.GoalLimits()); err != nil {
		return nil, refuse(BadArgs, "%v", err)
	}
	return x, nil
}

// postContest puts a stage's contest on its settlement's board.
func (g *Game) postContest(st *Stage, row *sheets.ContestRow, tick int64) error {
	x, err := g.contestGoal(st, row, tick)
	if err != nil {
		return err
	}
	g.openGoal(x)
	st.Goals = append(st.Goals, x.ID)
	_, err = g.worldFact(g.SettlementHex(x.Board), "goal.posted", []fact.Ref{goalRef(x.ID), stageRef(st.ID)}, nil, fact.S("verb", x.Cond.Verb),
		fact.S("mode", x.Mode), fact.N("reward", 0), fact.S("issuer", goal.ByStaged), fact.N("settlement", int64(x.Board)))
	return err
}

// reachTile is the tile a reach contest asks for: on the ring that many
// tiles round the settlement, passable, awake, walkable to from it, and
// nearest the stage's own tile.
func (g *Game) reachTile(settlement int, tiles int64, toward hex.Hex) (hex.Hex, bool) {
	home := g.SettlementHex(settlement)
	ring := hex.Ring(home, tiles)
	slices.SortStableFunc(ring, func(a, b hex.Hex) int { return cmp.Compare(hex.Distance(a, toward), hex.Distance(b, toward)) })
	for _, h := range ring {
		if g.World.RegionAt(h) < 0 || !g.r.Gen.Passable(g.r.Gen.Baseline(h).Terrain) || g.IsSettlement(h) {
			continue
		}
		if _, _, ok := g.World.Path(home, h); ok {
			return h, true
		}
	}
	return hex.Hex{}, false
}

// crateOpen opens one crate of a drop on its tile: one roll of the drop's
// table, minted to the opener as staged goods. The stager opens none.
func crateOpen(g *Game, c *Char, cmd Command) error {
	st := g.StageByID(cmd.Target)
	if st == nil || st.Kind != sheets.StageDrop && st.Kind != sheets.StageFair || !st.Open || st.Closed || st.Crates <= 0 {
		return refuse(NoStage, "no crates left at %q", cmd.Target)
	}
	if c.C.At != st.At || c.C.Floor > 0 {
		return refuse(BadArgs, "the crates of %s are on %s", st.ID, st.At.Ref())
	}
	if err := free(c); err != nil {
		return err
	}
	if c.C.ID == st.By {
		return refuse(StagedOwn, "%s staged %s: it takes nothing from it", c.C.ID, st.ID)
	}
	if most := g.lp("crate-cap"); st.Opened.Get(c.C.ID) >= most {
		return refuse(CrateCap, "%s has opened %d crates of %s, all one may", c.C.ID, most, st.ID)
	}
	t := g.stageTemplate(st.Template)
	if t == nil {
		return refuse(NoStage, "no template %q", st.Template)
	}
	n := st.Opened.Sum() + 1
	s, ok := g.stagedRoll(t.Table, "liveops.crate", draw.Str(st.ID), draw.Int(n), draw.Str(c.C.ID))
	if !ok {
		return refuse(NoStage, "%s's crates hold nothing", st.ID)
	}
	if err := g.mintStaged(c, st, ledger.SubKey(cmd.Key, "crate"), "crate", s); err != nil {
		return err
	}
	st.Crates--
	st.Opened.Bump(c.C.ID, 1)
	_, err := g.factWith(c, []fact.Ref{stageRef(st.ID)}, factCrateOpened, g.Tick(), fact.S("stage", st.ID), fact.S("material", s.Material),
		fact.N("units", s.Qty), fact.N("crate", n), fact.N("left", st.Crates))
	return err
}

// stagedRoll is one roll of a liveops.drops table: a line by weight, then
// a quantity from its least to its most.
func (g *Game) stagedRoll(table string, p draw.Purpose, parts ...draw.Part) (item.Spoil, bool) {
	rows := g.r.Book.DropTable(table)
	if len(rows) == 0 {
		return item.Spoil{}, false
	}
	weights := make([]int64, len(rows))
	for i, r := range rows {
		weights[i] = r.Weight
	}
	s := g.r.draw.Stream(p, parts...)
	r := rows[s.Pick(weights)]
	return item.Spoil{Material: r.Material, Qty: s.Between(r.Min, r.Max)}, true
}

// mintStaged mints goods to a character as staged at the stage's
// settlement.
func (g *Game) mintStaged(c *Char, st *Stage, key, kind string, s item.Spoil) error {
	return g.receive(c, ledger.Move(key, kind, g.Tick(), ledger.FromStaged, ledger.Char(c.C.ID), ledger.Staged(st.Settlement, s.Material), s.Qty))
}

// stagedPrize pays a staged contest's winner its prize: one roll of the
// goal's table, as staged goods.
func (g *Game) stagedPrize(x *Goal, cl goal.Claim, key string) error {
	st, c := g.StageByID(x.Issuer.ID), g.Char(cl.Who)
	if st == nil || c == nil {
		return nil
	}
	defer g.withStage(st)()
	s, ok := g.stagedRoll(x.Prize, "liveops.prize", draw.Str(st.ID), draw.Str(x.ID), draw.Str(cl.Who))
	if !ok {
		return nil
	}
	return g.mintStaged(c, st, ledger.SubKey(key, "prize", x.ID, cl.Who), "prize", s)
}
