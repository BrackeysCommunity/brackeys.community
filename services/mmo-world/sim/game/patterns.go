package game

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/pattern"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
	"jams.team/mmo-world/sim/world"
)

// Pattern puzzles at world scale (GDD 4.13): a pattern's points are set by
// walking there and working each point's hand puzzle, the solution is
// keyed and drawn on demand, clues lie on tiles near the centre, and a
// solve opens what its story.pattern-puzzles row names. A board is stored
// the first time anyone reaches one of its points or clue sites, so
// nothing is kept for patterns nobody has found, and the scaffold never
// moves: a chained pattern is stored state laid over it.

const (
	// PatternSet sets the point a character stands on: To is the point,
	// Units the value. A point with a family arms its machine, whose solve
	// commits the value; a beacon takes a delivery and commits at once.
	PatternSet = "pattern-set"
	// MachinePattern is the source of a pattern point's machine.
	MachinePattern = "pattern"
)

// Refusal codes of a pattern's point.
const (
	NoPattern     = "no-pattern"
	PatternSolved = "pattern-solved"
)

// Draws of the pattern rules beside sim/pattern's own, each its own.
const (
	clueSiteDraw draw.Purpose = "pattern.clue"
	haywireDraw  draw.Purpose = "pattern.haywire"
	chainDraw    draw.Purpose = "pattern.chain"
)

// structural: how boards and their parts are named, the place a pattern's
// centre stands on rather than a point, the tag a beacon burns, and what a
// solve opens, as the sheets spell them.
const (
	boardSep     = "@"
	placedPrefix = "placed-"
	refPattern   = "pattern"
	placeVault   = "vault"
	beaconTag    = "salt"
	beaconTxn    = "beacon"
	siteMark     = "site"

	anchorFrontier = "frontier"
	anchorTerrain  = "terrain"

	openArc     = "arc"
	openPattern = "pattern"
	openCache   = "cache"
	openFact    = "fact"
	openSight   = "sight"
	openSeam    = "seam"
)

// PatternArm is the point an armed pattern machine sets, and the value
// its solve commits.
type PatternArm struct {
	Board string `json:"board"`
	Point int    `json:"point"`
	Value int64  `json:"value"`
}

// PatternPoint is a pattern's point as a viewer standing on it sees it:
// its board and kind, what stands there and the family that sets it, the
// value held there, and the clues found so far. It never holds the
// solution.
type PatternPoint struct {
	Board, Kind, Place, Family string
	Point, Points, Values      int64
	LapseDays                  int64
	Held                       *int64
	Solved                     bool
	Clues                      []fact.ID
}

func boardRef(id string) fact.Ref { return fact.Ref{Kind: refPattern, ID: id} }

// puzzleRow is a story.pattern-puzzles row by id, or nil.
func (g *Game) puzzleRow(id string) *sheets.PatternPuzzle {
	for i := range g.r.Book.PatternPuzzles {
		if g.r.Book.PatternPuzzles[i].ID == id {
			return &g.r.Book.PatternPuzzles[i]
		}
	}
	return nil
}

// puzzleFor is the puzzle row of a scaffold pattern rule, or nil.
func (g *Game) puzzleFor(rule string) *sheets.PatternPuzzle {
	for i := range g.r.Book.PatternPuzzles {
		if p := &g.r.Book.PatternPuzzles[i]; p.Pattern != "" && p.Pattern == rule {
			return p
		}
	}
	return nil
}

// familyOf is the machine family that sets a place of a puzzle's board;
// "" for one set by a delivery.
func familyOf(row *sheets.PatternPuzzle, place string) string {
	for _, f := range row.Family {
		if f.Place == place {
			return f.Family
		}
	}
	return ""
}

// settable reports whether a place is one of a board's points: a place
// the row gives a family row, but never the vault at its centre.
func settable(row *sheets.PatternPuzzle, place string) bool {
	return place != placeVault && slices.ContainsFunc(row.Family, func(f sheets.PointFamily) bool { return f.Place == place })
}

// rules are what sim/pattern needs of a board.
func (b *Board) rules(row *sheets.PatternPuzzle) pattern.Board {
	return pattern.Board{ID: b.ID, Kind: row.Kind, Points: len(b.Points), Values: row.Values, Need: row.Need, Servers: row.Servers}
}

// boardByID is a stored board, or nil.
func (g *Game) boardByID(id string) *Board {
	for _, b := range g.Story.Patterns {
		if b.ID == id {
			return b
		}
	}
	return nil
}

func (g *Game) stored(b *Board) bool { return g.boardByID(b.ID) == b }

func (g *Game) storeBoard(b *Board) {
	if g.boardByID(b.ID) == nil {
		g.Story.Patterns = append(g.Story.Patterns, b)
	}
}

// boardOf is the board of a scaffold instance: the stored one, or one
// built from the instance's settable points and its clue sites, which
// read the scaffold alone, so a site is the same before the board is
// stored as after.
func (g *Game) boardOf(row *sheets.PatternPuzzle, in gen.Instance) (*Board, bool) {
	id := row.ID + boardSep + in.Centre.Ref()
	if b := g.boardByID(id); b != nil {
		return b, true
	}
	b := &Board{ID: id, Rule: row.ID, Centre: in.Centre}
	for _, p := range in.Points {
		if settable(row, p.Place) && !slices.Contains(b.Points, p.Hex) {
			b.Points = append(b.Points, p.Hex)
			b.Places = append(b.Places, p.Place)
		}
	}
	if len(b.Points) == 0 {
		return nil, false
	}
	b.Clues = g.clueSites(b, row, g.openGround)
	return b, true
}

// pointAt is the board one of whose points stands on h and that point's
// index: a stored board's first, else a scaffold point's board, built but
// not stored.
func (g *Game) pointAt(h hex.Hex) (*Board, int, bool) {
	for _, b := range g.Story.Patterns {
		if i := slices.Index(b.Points, h); i >= 0 {
			return b, i, true
		}
	}
	for _, p := range g.r.Gen.Patterns(g.r.Gen.ChunkOf(h)) {
		row := g.puzzleFor(p.Rule)
		if p.Hex != h || row == nil {
			continue
		}
		in, ok := g.r.Gen.InstanceOf(p)
		if !ok {
			continue
		}
		if b, ok := g.boardOf(row, in); ok {
			if i := slices.Index(b.Points, h); i >= 0 {
				return b, i, true
			}
		}
	}
	return nil, 0, false
}

// cluesAt are the boards with a clue site on h and the clue's index:
// stored boards', then those of scaffold instances near enough, built but
// not stored.
func (g *Game) cluesAt(h hex.Hex) ([]*Board, []int) {
	var bs []*Board
	var at []int
	for _, b := range g.Story.Patterns {
		if i := slices.Index(b.Clues, h); i >= 0 {
			bs, at = append(bs, b), append(at, i)
		}
	}
	if !slices.Contains(g.scaffoldClues(g.r.Gen.ChunkOf(h)), h) {
		return bs, at
	}
	for i := range g.r.Book.PatternPuzzles {
		row := &g.r.Book.PatternPuzzles[i]
		if row.Pattern == "" || row.Clues <= 0 || !g.inBand(row.Pattern, h, row.ClueReach) {
			continue
		}
		for _, in := range g.r.Gen.Instances(row.Pattern, h, row.ClueReach) {
			b, ok := g.boardOf(row, in)
			if !ok || g.stored(b) {
				continue
			}
			if k := slices.Index(b.Clues, h); k >= 0 {
				bs, at = append(bs, b), append(at, k)
			}
		}
	}
	return bs, at
}

// clueCache holds, by chunk, the clue sites the scaffold's boards lay
// there; they read the seed and the sheets alone, so a step learns at a
// glance whether a clue lies under it. It is never saved, and is dropped
// each world day and on a change of rules.
type clueCache struct {
	r     *Rules
	tiles map[gen.ChunkCoord][]hex.Hex
}

// scaffoldClues are the clue sites of scaffold boards, stored or not, that
// lie in a chunk.
func (g *Game) scaffoldClues(cc gen.ChunkCoord) []hex.Hex {
	s := g.Story
	if s.clues == nil || s.clues.r != g.r {
		s.clues = &clueCache{r: g.r, tiles: map[gen.ChunkCoord][]hex.Hex{}}
	}
	if tiles, ok := s.clues.tiles[cc]; ok {
		return tiles
	}
	centre := g.r.Gen.ChunkCentre(cc)
	var out []hex.Hex
	for i := range g.r.Book.PatternPuzzles {
		row := &g.r.Book.PatternPuzzles[i]
		reach := row.ClueReach + g.r.Gen.ChunkRadius()
		if row.Pattern == "" || row.Clues <= 0 || !g.inBand(row.Pattern, centre, reach) {
			continue
		}
		for _, in := range g.r.Gen.Instances(row.Pattern, centre, reach) {
			b, ok := g.boardOf(row, in)
			if !ok {
				continue
			}
			for _, h := range b.Clues {
				if g.r.Gen.ChunkOf(h) == cc && !slices.Contains(out, h) {
					out = append(out, h)
				}
			}
		}
	}
	s.clues.tiles[cc] = out
	return out
}

// inBand reports whether a rule's instances may centre within reach of
// h: a frontier or terrain rule fires only in its band of distance from
// the origin, at a tile of a chunk whose centre lies in the band. It only
// spares the search, so it errs wide.
func (g *Game) inBand(rule string, h hex.Hex, reach int64) bool {
	i := slices.IndexFunc(g.r.Book.Patterns, func(r sheets.PatternRule) bool { return r.ID == rule })
	if i < 0 {
		return false
	}
	r := &g.r.Book.Patterns[i]
	if r.Anchor != anchorFrontier && r.Anchor != anchorTerrain {
		return true
	}
	d, slack := h.Len(), reach+g.r.Gen.ChunkRadius()+r.OffsetDistance
	return d+slack >= r.MinDistance && (r.MaxDistance == 0 || d-slack < r.MaxDistance)
}

// openGround is a tile a clue may lie on by the scaffold alone: passable,
// with no slot, settlement, pattern part or landmark.
func (g *Game) openGround(h hex.Hex) bool {
	b := g.r.Gen.Baseline(h)
	return g.r.Gen.Passable(b.Terrain) && b.Site == "" && b.Landmark == ""
}

// chainFree is a tile a placed pattern may stand on: open ground the
// world has not built on, pinned, reserved, or given to another board.
func (g *Game) chainFree(h hex.Hex) bool {
	if !g.openGround(h) || g.PlaceAt(h) != nil || g.World.ReserveAt(h) != nil {
		return false
	}
	if c, ok := g.Content(h); ok && (c.Site != "" || c.Landmark != "" || c.Pin != "") {
		return false
	}
	return !slices.ContainsFunc(g.Story.Patterns, func(b *Board) bool { return slices.Contains(b.Points, h) || slices.Contains(b.Clues, h) })
}

// clueSites lays a board's clues on tiles within the row's clue reach of
// its centre, clue i at a keyed tile free ground takes; as many sites as
// the board has clues to give, stopping at the first clue with none.
func (g *Game) clueSites(b *Board, row *sheets.PatternPuzzle, free func(hex.Hex) bool) []hex.Hex {
	pb := b.rules(row)
	n := len(pattern.Clues(g.r.draw, pb, pattern.Solve(g.r.draw, pb), int(row.Clues)))
	disc := hex.DiscAt(b.Centre, row.ClueReach)
	var out []hex.Hex
	for i := range n {
		st := g.r.draw.Stream(clueSiteDraw, draw.Str(b.ID), draw.Int(int64(i)), draw.Str(siteMark))
		found := false
		for range disc {
			h := disc[st.Below(uint64(len(disc)))]
			if free(h) && !slices.Contains(out, h) && !slices.Contains(b.Points, h) {
				out, found = append(out, h), true
				break
			}
		}
		if !found {
			break
		}
	}
	return out
}

// reachPattern is a character entering a tile: the board of a point or a
// clue site there is stored on its first reach, and each clue found there
// for the first time is written down.
func (g *Game) reachPattern(c *Char, h hex.Hex, t int64) error {
	if g.Story == nil {
		return nil
	}
	if b, _, ok := g.pointAt(h); ok {
		g.storeBoard(b)
	}
	bs, at := g.cluesAt(h)
	for k, b := range bs {
		g.storeBoard(b)
		if err := g.clueFound(c, b, at[k], t); err != nil {
			return err
		}
	}
	return nil
}

// clueFound writes clue i of a board the first time anyone stands on its
// site: what it says, never the solution itself.
func (g *Game) clueFound(c *Char, b *Board, i int, t int64) error {
	row := g.puzzleRow(b.Rule)
	if row == nil || slices.Contains(b.Found, i) {
		return nil
	}
	pb := b.rules(row)
	clues := pattern.Clues(g.r.draw, pb, pattern.Solve(g.r.draw, pb), len(b.Clues))
	if i >= len(clues) {
		return nil
	}
	cl := clues[i]
	data := append([]fact.Datum{fact.S("board", b.ID), fact.S("rule", b.Rule), fact.N("clue", int64(i)), fact.S("says", cl.Kind),
		fact.N("point", int64(cl.Point)), fact.N("other", int64(cl.Other)), fact.N(datumN, cl.N)}, fact.At(b.Clues[i])...)
	f, err := g.factWith(c, []fact.Ref{boardRef(b.ID)}, "pattern.clue", t, data...)
	if err != nil {
		return err
	}
	b.Found = append(b.Found, i)
	b.Told = append(b.Told, f.ID)
	return nil
}

// patternSet sets the point a character stands on. Every refusal comes
// before anything changes: no point there, a solved board, a value the
// point does not take, or a character not free to work it.
func (g *Game) patternSet(c *Char, cmd Command) error {
	if err := idle(c); err != nil {
		return err
	}
	at := c.C.At
	if cmd.To != nil && *cmd.To != at {
		return refuse(NotHere, "%s stands on %s, not %s", c.C.ID, at.Ref(), cmd.To.Ref())
	}
	if g.Story == nil {
		return refuse(NoPattern, "no pattern's point stands on %s", at.Ref())
	}
	b, point, ok := g.pointAt(at)
	if !ok || g.puzzleRow(b.Rule) == nil {
		return refuse(NoPattern, "no pattern's point stands on %s", at.Ref())
	}
	row := g.puzzleRow(b.Rule)
	if b.P.Done {
		return refuse(PatternSolved, "%s is solved", b.ID)
	}
	t := g.Tick()
	pb := b.rules(row)
	m := pattern.Mark{Point: point, Value: cmd.Units, Day: t / sheets.TicksPerDay, By: c.C.ID, Server: c.Server}
	if !pb.Fits(m) {
		return refuse(BadArgs, "point %d of %s takes values 0 to %d", point, b.ID, max(row.Values, 1)-1)
	}
	family := familyOf(row, b.Places[point])
	if family == "" {
		lines := []sheets.CostLine{{Tag: beaconTag, Quantity: g.r.Story.BeaconCost}}
		if err := g.payLines(c, cmd.Key, beaconTxn, lines, ledger.ToBuild); err != nil {
			return err
		}
		g.storeBoard(b)
		return g.patternCommit(c, b, point, m.Value, t)
	}
	spec := g.pointSpec(c, b, point, family, cmd.Machine != nil && cmd.Machine.Compact)
	if left := c.lockedFor(spec.Place, t); left > 0 {
		return refuse(LockedDown, "locked down for %d more ticks", left)
	}
	g.storeBoard(b)
	a := &Armed{Source: MachinePattern, Spec: spec, Practice: c.C.Level(family), At: cmd.Now, Tick: t,
		Pattern: &PatternArm{Board: b.ID, Point: point, Value: m.Value}}
	a.Countdown = g.Puzzles().Countdown(spec.Family, spec.Level, spec.Tier, a.Practice)
	c.Armed = a
	c.Worked++
	c.LastMachine = nil
	c.Lockdowns = slices.DeleteFunc(c.Lockdowns, func(l Lockdown) bool { return l.Until <= t })
	_, err := g.factWith(c, []fact.Ref{boardRef(b.ID)}, "machine.armed", t, fact.S("family", family), fact.N("level", spec.Level),
		fact.S("source", MachinePattern), fact.S("board", b.ID))
	return err
}

// pointSpec is the machine standing at a board's point, at its region's
// tier; each arming lays it afresh.
func (g *Game) pointSpec(c *Char, b *Board, point int, family string, compact bool) puzzle.Spec {
	at := b.Points[point]
	tier := g.tierAt(at)
	place := MachinePattern + ":" + b.ID + sidePart + itoa(point)
	level := g.Puzzles().Level(family, tier, 0, puzzle.Where{Place: place})
	spec := puzzle.Spec{Family: family, Level: level, Tier: tier, Place: place, Attempt: c.Worked, Compact: compact}
	spec.Shape = g.Puzzles().Shape(family, level, spec.Where())
	return spec
}

// patternWorked is an armed pattern machine's move log played out: a
// failure haywires as any machine away from a fight does, and a solve
// pays its practice and commits the point's value.
func (g *Game) patternWorked(c *Char, a *Armed, res puzzle.Result, tick int64) error {
	board := ""
	if a.Pattern != nil {
		board = a.Pattern.Board
	}
	if !res.Solved {
		return g.failed(c, a.Spec.Family, a.Spec.Place, res, tick, retryTicks, fact.S("board", board))
	}
	if err := g.practise(c, a.Spec.Family, g.Puzzles().Param("live-solve-uses")+g.masterUses(res), tick); err != nil {
		return err
	}
	if a.Pattern == nil {
		return nil
	}
	b := g.boardByID(a.Pattern.Board)
	if b == nil || a.Pattern.Point >= len(b.Points) {
		return nil
	}
	return g.patternCommit(c, b, a.Pattern.Point, a.Pattern.Value, tick)
}

// patternCommit holds a point's value on today's world day. A complete
// attempt that is wrong surges at the centre; a right one solves the board
// and fires what it opens. A board solved while the machine ran takes
// nothing more.
func (g *Game) patternCommit(c *Char, b *Board, point int, value, t int64) error {
	row := g.puzzleRow(b.Rule)
	if row == nil || b.P.Done {
		return nil
	}
	pb := b.rules(row)
	m := pattern.Mark{Point: point, Value: value, Day: t / sheets.TicksPerDay, By: c.C.ID, Server: c.Server}
	res := b.P.Set(pb, pattern.Solve(g.r.draw, pb), m)
	data := []fact.Datum{fact.S("board", b.ID), fact.N("point", int64(point)), fact.N("value", value)}
	if row.Kind == pattern.Alignment {
		data = append(data, fact.N("reach", int64(res.Reach)))
	}
	f, err := g.factWith(c, []fact.Ref{boardRef(b.ID)}, "pattern.set", t, append(data, fact.At(b.Points[point])...)...)
	if err != nil {
		return err
	}
	switch {
	case res.Wrong:
		return g.patternHaywire(c, b, f.ID, t)
	case res.Solved:
		return g.patternSolved(b, row, f.ID, t)
	}
	return nil
}

// patternHaywire is a wrong full attempt: the world surges at the
// pattern's centre (GDD 4.3), by a keyed share between the sheet's least
// and most.
func (g *Game) patternHaywire(c *Char, b *Board, cause fact.ID, t int64) error {
	p := g.r.Story
	threat := g.r.draw.Between(p.HaywireLeast, p.HaywireMost, haywireDraw, draw.Str(b.ID), draw.Int(b.P.Attempts))
	id, err := g.worldFact(b.Centre, "pattern.haywire", []fact.Ref{boardRef(b.ID), char.Ref(c.C.ID)}, []fact.ID{cause},
		append([]fact.Datum{fact.S("board", b.ID), fact.N("threat", threat), fact.N("attempts", b.P.Attempts), fact.N("wrong", b.P.Wrong)},
			fact.At(b.Centre)...)...)
	if err != nil {
		return err
	}
	g.Pending = append(g.Pending, world.Action{Kind: world.ActSurge, Hex: b.Centre, Units: threat, Cause: id})
	return nil
}

// solvers are who held the board's marks when it was solved, by how many.
func (b *Board) solvers() tally.Tally {
	var by tally.Tally
	for _, m := range b.P.Marks {
		by.Bump(m.By, 1)
	}
	return by
}

// patternSolved writes the solve and fires its opens in row order. A
// board that opens a fact is solved in the world's hearing, not only its
// region's. An open with Waits set opens nothing.
func (g *Game) patternSolved(b *Board, row *sheets.PatternPuzzle, cause fact.ID, t int64) error {
	by := b.solvers()
	subjects := []fact.Ref{boardRef(b.ID)}
	for _, s := range by {
		subjects = append(subjects, char.Ref(s.Key))
	}
	region := ""
	if r := g.World.RegionAt(b.Centre); r >= 0 && !slices.ContainsFunc(row.Opens, func(o sheets.PatternOpen) bool { return o.Kind == openFact }) {
		region = world.RegionRef(r)
	}
	solved, err := g.regionFact(region, "pattern.solved", subjects, []fact.ID{cause},
		append([]fact.Datum{fact.S("board", b.ID), fact.S("rule", b.Rule), fact.S("kind", row.Kind), fact.N("depth", b.Depth)}, fact.At(b.Centre)...)...)
	if err != nil {
		return err
	}
	for _, o := range row.Opens {
		if o.Waits != "" {
			continue
		}
		switch o.Kind {
		case openCache:
			err = g.patternCache(b, o.Ref, by, solved, t)
		case openPattern:
			err = g.placeChain(b, o.Ref, solved, t)
		case openArc:
			err = g.patternArc(b, o.Ref, solved, t)
		case openSight:
			g.patternSight(b, o.N)
		case openSeam:
			g.patternSeam(b, o.N, solved)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// patternCache mints a story.caches row's goods into the board's cache
// pool and splits each line among the solvers by the marks they held. The
// goods wait at the centre for whoever is not standing there.
func (g *Game) patternCache(b *Board, ref string, by tally.Tally, cause fact.ID, t int64) error {
	i := slices.IndexFunc(g.r.Book.Caches, func(c sheets.Cache) bool { return c.ID == ref })
	if i < 0 || by.Sum() <= 0 {
		return nil
	}
	lines := g.r.Book.Caches[i].Goods
	var goods int64
	subjects := []fact.Ref{boardRef(b.ID)}
	for _, s := range by {
		subjects = append(subjects, char.Ref(s.Key))
	}
	for _, l := range lines {
		goods += l.Quantity
	}
	f, err := g.worldFact(b.Centre, "pattern.cache", subjects, []fact.ID{cause},
		append([]fact.Datum{fact.S("board", b.ID), fact.S("cache", ref), fact.N("goods", goods)}, fact.At(b.Centre)...)...)
	if err != nil {
		return err
	}
	key := ledger.SubKey("tick", i64(t), refPattern, b.ID, ref)
	return g.openCache(lines, ledger.CachePool(b.ID), by, b.Centre, key, openCache, f, t)
}

// placeChain lays the chained pattern a solve opens: centred chain-distance
// out from the board's centre, further from the origin, on a keyed bearing
// and turn, with every point on ground a placed pattern may take. After
// chain-tries bearings that fail, nothing is placed.
func (g *Game) placeChain(parent *Board, ref string, cause fact.ID, t int64) error {
	row := g.puzzleRow(ref)
	if row == nil || row.Shape == "" {
		return nil
	}
	p := g.r.Story
	around := hex.Ring(parent.Centre, p.ChainDistance)
	out := slices.DeleteFunc(slices.Clone(around), func(h hex.Hex) bool { return h.Len() <= parent.Centre.Len() })
	if len(out) == 0 {
		out = around
	}
	if len(out) == 0 {
		return nil
	}
	placed := 1
	for _, b := range g.Story.Patterns {
		if b.Placed {
			placed++
		}
	}
	id := placedPrefix + itoa(placed)
	for try := range p.ChainTries {
		st := g.r.draw.Stream(chainDraw, draw.Str(parent.ID), draw.Int(try))
		centre := out[st.Below(uint64(len(out)))]
		turn := int64(st.Below(uint64(hex.Directions)))
		pts, ok := g.r.Gen.Layout(row.Shape, row.Size, row.Points, centre, turn, draw.Str(id))
		if !ok || slices.ContainsFunc(pts, func(h hex.Hex) bool { return !g.chainFree(h) }) {
			continue
		}
		b := &Board{ID: id, Rule: row.ID, Points: pts, Centre: centre, Placed: true, Depth: parent.Depth + 1}
		for range pts {
			b.Places = append(b.Places, row.Place)
		}
		b.Clues = g.clueSites(b, row, g.chainFree)
		g.Story.Patterns = append(g.Story.Patterns, b)
		_, err := g.worldFact(centre, "pattern.placed", []fact.Ref{boardRef(id), boardRef(parent.ID)}, []fact.ID{cause},
			append([]fact.Datum{fact.S("board", id), fact.S("rule", row.ID), fact.S("from", parent.ID), fact.N("depth", b.Depth)}, fact.At(centre)...)...)
		return err
	}
	return nil
}

// patternArc casts a template from the board: the opening wakes the core
// and is cast there; any other takes the cast its predicate finds seated
// nearest the centre, if the scope's slot is free.
func (g *Game) patternArc(b *Board, ref string, cause fact.ID, t int64) error {
	tpl, ok := g.template(ref)
	if !ok {
		return nil
	}
	if tpl.Row.When == openingWhen {
		return g.openCore([]fact.ID{cause}, ByPattern, t)
	}
	cands := arc.Ordered(tpl.When(g.storyView(), tpl.Row, g.r.Story))
	if len(cands) == 0 {
		return nil
	}
	best := cands[0]
	for _, c := range cands[1:] {
		if hex.Distance(c.Seat, b.Centre) < hex.Distance(best.Seat, b.Centre) {
			best = c
		}
	}
	best.Causes = append(slices.Clone(best.Causes), cause)
	_, err := g.castFrom(tpl, best, ByPattern, t)
	return refusedIsNothing(err)
}

// patternSight adds a solve's sight to the region of the board's centre;
// a region keeps its best.
func (g *Game) patternSight(b *Board, n int64) {
	r := g.World.RegionAt(b.Centre)
	if r < 0 || n <= 0 {
		return
	}
	s := g.Story
	i, ok := slices.BinarySearchFunc(s.Sight, r, func(x RegionBonus, r int) int { return cmp.Compare(x.Region, r) })
	if ok {
		s.Sight[i].N = max(s.Sight[i].N, n)
		return
	}
	s.Sight = slices.Insert(s.Sight, i, RegionBonus{Region: r, N: n})
}

// patternSeam opens a seam of n stock on the node nearest the board's
// centre within seam-radius: the region's highest-tier material there.
func (g *Game) patternSeam(b *Board, n int64, cause fact.ID) {
	for r := int64(0); r <= g.r.Story.SeamRadius; r++ {
		ring := []hex.Hex{b.Centre}
		if r > 0 {
			ring = hex.Ring(b.Centre, r)
		}
		for _, h := range ring {
			if m, ok := g.seamMaterial(h); ok {
				g.Pending = append(g.Pending, world.Action{Kind: world.ActSeam, Hex: h, Material: m, Units: n, Cause: cause})
				return
			}
		}
	}
}

// seamMaterial is the highest-tier material gathered on a passable tile,
// the first listed on a tie.
func (g *Game) seamMaterial(h hex.Hex) (string, bool) {
	if !g.r.Gen.Passable(g.r.Gen.Baseline(h).Terrain) {
		return "", false
	}
	best, tier := "", int64(0)
	for _, m := range g.Materials(h) {
		i := slices.IndexFunc(g.r.Book.Materials, func(x sheets.Material) bool { return x.ID == m })
		if m == ledger.Provisions || i < 0 {
			continue
		}
		if t := g.r.Book.Materials[i].Tier; best == "" || t > tier {
			best, tier = m, t
		}
	}
	return best, best != ""
}

// patternsDay drops the clue cache, lapses each open board's marks held
// longer than its row's lapse days, and opens the core once every tower
// has fallen this season.
func (g *Game) patternsDay(day int64) error {
	if g.Story == nil {
		return nil
	}
	g.Story.clues = nil
	for _, b := range g.Story.Patterns {
		row := g.puzzleRow(b.Rule)
		if row == nil || b.P.Done {
			continue
		}
		lapsed := b.P.Lapse(day, row.LapseDays)
		if len(lapsed) == 0 {
			continue
		}
		if _, err := g.worldFact(b.Centre, "pattern.lapsed", []fact.Ref{boardRef(b.ID)}, nil,
			append([]fact.Datum{fact.S("board", b.ID), fact.N("points", int64(len(lapsed)))}, fact.At(b.Centre)...)...); err != nil {
			return err
		}
	}
	return g.ringDue(day * sheets.TicksPerDay)
}

// PatternAt is a pattern's point on h as a viewer sees it, or nil where
// none stands. A constellation's hidden point looks like any other.
func (g *Game) PatternAt(_ *Char, h hex.Hex) *PatternPoint {
	if g.Story == nil {
		return nil
	}
	b, i, ok := g.pointAt(h)
	if !ok {
		return nil
	}
	row := g.puzzleRow(b.Rule)
	if row == nil {
		return nil
	}
	out := &PatternPoint{Board: b.ID, Kind: row.Kind, Place: b.Places[i], Family: familyOf(row, b.Places[i]), Point: int64(i),
		Points: int64(len(b.Points)), Values: max(row.Values, 1), LapseDays: row.LapseDays, Solved: b.P.Done, Clues: slices.Clone(b.Told)}
	if m, ok := b.P.Held(i); ok {
		v := m.Value
		out.Held = &v
	}
	return out
}

// Sight is how many tiles round a character on h are revealed: the
// world's sight there and the region's best lit pattern.
func (g *Game) Sight(h hex.Hex) int64 {
	n := g.World.Sight(h)
	if g.Story == nil {
		return n
	}
	r := g.World.RegionAt(h)
	if i, ok := slices.BinarySearchFunc(g.Story.Sight, r, func(x RegionBonus, r int) int { return cmp.Compare(x.Region, r) }); ok && r >= 0 {
		n += g.Story.Sight[i].N
	}
	return n
}
