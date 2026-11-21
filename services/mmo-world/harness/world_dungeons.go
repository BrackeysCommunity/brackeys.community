package harness

import (
	"cmp"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// The World run's dungeons (GDD 4.9, 7.6): over a thousand seeds, every
// dungeon's floors, guardian and forks as the seed makes them; then games
// in which parties delve and hunters press a hunt for a few world days,
// left alone for worldDays more, against refills, haunting and the floor
// and hunt pools.
const (
	dungeonSeeds = 1000
	// dungeonScan is how far round each starting settlement a seed's
	// dungeons are looked for, in tiles.
	dungeonScan = 40
	// dungeonHomes are the starting settlements scanned, in opening order.
	dungeonHomes = 3
	// delveWorlds are the games played, each delveDays attended before
	// the worldDays left alone.
	delveWorlds = 3
	delveDays   = 6
	delveHunt   = "dust-runner-migration"
)

// Script plays characters through a game's own commands, as players
// would: a party through a dungeon floor by floor, its machines worked
// with each version's own solver, and hunters at a live hunt. Given, when
// set, sees every command the game took.
type Script struct {
	G       *game.Game
	Clock   int64 // the service's clock, unix ms, for a timed command
	Party   []*game.Char
	Hunters []*game.Char
	// Name is what the party's leader calls a dungeon it slays the guardian
	// of first.
	Name  string
	Given func(game.Command)
	Label string
	named bool
	n     int
	err   error
}

// Act gives one command; a refusal changes nothing and is dropped.
func (s *Script) Act(c *game.Char, cmd game.Command) (game.Result, bool) {
	s.n++
	cmd.Key = fmt.Sprintf("%s-%d", s.Label, s.n)
	if c != nil {
		cmd.Char = c.C.ID
	}
	if game.Timed(cmd.Kind) {
		s.Clock = max(cmd.Now, s.Clock+1)
		cmd.Now = s.Clock
	}
	res, err := s.G.Act(cmd)
	if err != nil {
		var ref *game.Refused
		if !errors.As(err, &ref) && s.err == nil {
			s.err = err
		}
		return res, false
	}
	if s.Given != nil {
		s.Given(cmd)
	}
	return res, true
}

// Err is the first error a command gave that was not a refusal.
func (s *Script) Err() error { return s.err }

func wounded(c *game.Char) bool {
	return slices.ContainsFunc(c.C.Conditions, func(x char.Condition) bool { return x.Tag == char.Wounded })
}

// Pick is a scripted member's pick on a beat: the likeliest win, unless
// holding is likelier and the beat is not the last. It never picks a
// machine, which is worked, not picked.
func Pick(opts []fight.Option, last bool) string {
	win, wc, hold, hc := "", fixed.F(-1), "", fixed.F(-1)
	for _, o := range opts {
		switch {
		case o.Puzzle:
		case o.Kind == fight.Win && o.Chance > wc:
			win, wc = o.ID, o.Chance
		case o.Kind == fight.Careful && o.Chance > hc:
			hold, hc = o.ID, o.Chance
		}
	}
	if win == "" || (!last && hc > wc) {
		return hold
	}
	return win
}

// Ready is game.ReadyAt for a script: gear at one tier's expected level,
// practice at another's.
func Ready(r *game.Rules, c *game.Char, gear, practiced int64) {
	game.ReadyAt(r, c, gear, practiced)
}

// Machine arms the machine of a source a character's party (or the
// character alone) faces and solves it with the version's own log.
func (s *Script) Machine(c *game.Char, src string) bool {
	if _, ok := s.Act(c, game.Command{Kind: game.MachineArm, Machine: &game.MachineCmd{Source: src}}); !ok {
		return false
	}
	p := s.G.Puzzles()
	if rig, ok := s.G.PartyRigOf(c); ok {
		l := p.Make(rig.Machine.Spec)
		log := p.Solve(l)
		if rig.Machine.Spec.Party != "" {
			log = p.PartySolve(l)
		}
		_, ok = s.Act(c, game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: src, Log: &log}, Now: rig.Machine.At + log.Stop()})
		return ok
	}
	rig, ok := s.G.Rig(c, game.Viewer{})
	if !ok || rig.Armed == nil {
		return false
	}
	log := p.Solve(rig.Layout)
	_, ok = s.Act(c, game.Command{Kind: game.MachineSolve, Machine: &game.MachineCmd{Source: src, Log: &log}, Now: rig.Armed.At + log.Stop()})
	return ok
}

// Delve gives each member of the party one turn: crawl when down, work
// the machine the party faces, pick on the beat, or push on at a fork by
// the best way open, working a fork's machine first. The leader explores
// the entrance when the party stands at it, free.
func (s *Script) Delve() {
	for _, c := range s.Party {
		switch {
		case game.IsDown(c):
			if c.Long == nil && c.Fight == nil {
				s.Act(c, game.Command{Kind: game.Crawl})
			}
		case c.Fight != nil:
			s.beat(c)
		case s.G.Fork(c) != nil:
			s.fork(c)
		}
	}
	lead := s.Party[0]
	if lead.C.Floor == 0 && lead.Fight == nil && lead.Long == nil && !game.IsDown(lead) && s.G.CanExplore(lead.C.At) && s.G.IsDungeon(lead.C.At) {
		s.Act(lead, game.Command{Kind: game.Explore})
	}
	if !s.named && s.Name != "" {
		for _, c := range s.Party {
			if _, ok := s.Act(c, game.Command{Kind: game.DungeonName, Note: s.Name}); ok {
				s.named = true
				break
			}
		}
	}
}

func (s *Script) beat(c *game.Char) {
	sh := s.G.SharedOf(c)
	v := s.G.Choose(c).Fight
	if sh != nil && sh.Machine != nil && !sh.Machine.Armed() && sh.Machine.Source == game.SourceGuardian {
		s.Machine(c, game.SourceGuardian)
		return
	}
	if slices.ContainsFunc(v.Options, func(o fight.Option) bool { return o.Puzzle }) {
		src := game.SourceParty
		if sh == nil {
			src = game.SourceBeat
		}
		if s.Machine(c, src) {
			return
		}
	}
	kind := game.Press
	if sh != nil {
		if v.Mine != "" {
			return
		}
		kind = game.PartyPick
	}
	s.Act(c, game.Command{Kind: kind, Option: Pick(v.Options, v.Beat == v.Beats-1)})
}

func (s *Script) fork(c *game.Char) {
	f := s.G.Fork(c)
	if slices.ContainsFunc(f.Choices, func(ch game.Choice) bool { return ch.Who == c.C.ID }) {
		return
	}
	open := map[int64]bool{}
	machine := false
	for _, w := range f.Ways {
		open[w.Way] = w.Open
		machine = machine || (w.Machine != "" && !w.Open)
	}
	if machine && !f.Worked && s.Machine(c, game.SourceFork) {
		return
	}
	way := int64(gen.WayOpen)
	for _, w := range []int64{gen.WayHidden, gen.WayMachine} {
		if open[w] {
			way = w
			break
		}
	}
	s.Act(c, game.Command{Kind: game.DungeonPush, Option: game.WayOption(way)})
}

// Hunt gives each hunter one turn at the live hunts: a press in reach, or
// the way back to one, crawling home and resting when it must.
func (s *Script) Hunt() {
	for _, x := range s.G.LiveHunts() {
		for _, c := range s.Hunters {
			switch {
			case x.H.Over || c.Long != nil || c.Fight != nil:
			case game.IsDown(c):
				s.Act(c, game.Command{Kind: game.Crawl})
			case wounded(c) && s.G.CanRest(c.C.At):
				s.Act(c, game.Command{Kind: game.Rest})
			case game.InReach(c, x):
				_, opts := s.G.HuntOptions(c, x)
				s.Act(c, game.Command{Kind: game.HuntPress, Target: x.H.ID, Option: Pick(opts, false)})
			default:
				s.Toward(c, x.Hex)
			}
		}
	}
}

// Toward steps c one tile nearer to h, if a way is open.
func (s *Script) Toward(c *game.Char, h hex.Hex) {
	best, dir := hex.Distance(c.C.At, h), -1
	for _, m := range s.G.Choose(c).Moves {
		if d := hex.Distance(m.To, h); m.Open && d < best {
			best, dir = d, m.Dir
		}
	}
	if dir >= 0 {
		s.Act(c, game.Command{Kind: game.Step, Dir: dir})
	}
}

// Dungeons are the dungeon entrances near a settlement a party can delve,
// nearest first: not relay towers, with something living there.
func Dungeons(g *game.Game, from hex.Hex, radius int64, least int64) []hex.Hex {
	var out []hex.Hex
	for r := int64(1); r <= radius; r++ {
		for _, h := range hex.Ring(from, r) {
			if p, ok := g.Rules().Gen.Dungeon(h); ok && !p.Up && p.Floors >= least && len(g.Rules().Gen.Creatures(h)) > 0 {
				out = append(out, h)
			}
		}
	}
	return out
}

// Beside is passable land in a region next to a tile.
func Beside(g *game.Game, h hex.Hex) (hex.Hex, bool) {
	gn := g.Rules().Gen
	for _, n := range h.Neighbours() {
		if gn.Passable(gn.Baseline(n).Terrain) && g.World.RegionAt(n) >= 0 {
			return n, true
		}
	}
	return hex.Hex{}, false
}

// seedDungeons is what one seed makes of the dungeons round its starting
// settlements.
type seedDungeons struct {
	plans    []gen.Plan
	badPlan  []string
	forks    int // floors above a bottom, read by every way in
	badFork  []string
	machines int // forks with way 1 behind a machine
	guardian int // plans with a guardian
}

// scanSeed reads every dungeon place within dungeonScan of a seed's
// starting settlements and checks each against its plan's own rules.
func scanSeed(b *sheets.Book, seed int) (seedDungeons, error) {
	var out seedDungeons
	g, _, err := newGen(b, fmt.Sprintf("dungeons-%d", seed))
	if err != nil {
		return out, err
	}
	seen := map[hex.Hex]bool{}
	for i := range dungeonHomes {
		home := g.Settlement(i).Hex
		chunks := map[gen.ChunkCoord]bool{}
		for _, h := range hex.DiscAt(home, dungeonScan) {
			chunks[g.ChunkOf(h)] = true
		}
		for _, cc := range slices.SortedFunc(maps.Keys(chunks), func(a, b gen.ChunkCoord) int { return cmp.Or(cmp.Compare(a.A, b.A), cmp.Compare(a.B, b.B)) }) {
			for _, pt := range g.Patterns(cc) {
				if seen[pt.Hex] || hex.Distance(pt.Hex, home) > dungeonScan {
					continue
				}
				p, ok := g.Dungeon(pt.Hex)
				if !ok {
					continue
				}
				seen[pt.Hex] = true
				out.plans = append(out.plans, p)
				checkPlan(g, p, &out, seed)
			}
		}
	}
	return out, nil
}

// checkPlan holds one dungeon to its rules: 3 to 7 floors within its
// kind's, a guardian, and every floor above the bottom forking into two
// distinct ways and a hidden third of one to three tags, whatever way led
// down to it.
func checkPlan(g *gen.Gen, p gen.Plan, out *seedDungeons, seed int) {
	where := fmt.Sprintf("seed %d %s %s", seed, p.Kind, p.Hex.Ref())
	if p.Floors < 3 || p.Floors > 7 {
		out.badPlan = append(out.badPlan, fmt.Sprintf("%s: %d floors", where, p.Floors))
	}
	if p.Guardian != "" {
		out.guardian++
	} else {
		out.badPlan = append(out.badPlan, where+": no guardian")
	}
	for n := int64(1); n <= p.Floors; n++ {
		ins := []int64{-1}
		if n > 1 {
			ins = []int64{gen.WayOpen, gen.WayMachine, gen.WayHidden}
		}
		for _, way := range ins {
			fp := g.Floor(p.Hex, n, way)
			if fp.Bottom != (n == p.Floors) {
				out.badFork = append(out.badFork, fmt.Sprintf("%s floor %d: bottom %v", where, n, fp.Bottom))
			}
			if fp.Bottom {
				if slices.ContainsFunc(fp.Ways[:], func(w gen.Way) bool { return w.Fork != "" || len(w.Tags) > 0 }) {
					out.badFork = append(out.badFork, fmt.Sprintf("%s: the bottom forks", where))
				}
				continue
			}
			out.forks++
			if fp.Machine {
				out.machines++
			}
			for w, x := range fp.Ways {
				if x.Fork == "" || len(x.Tags) < 1 || len(x.Tags) > 3 {
					out.badFork = append(out.badFork, fmt.Sprintf("%s floor %d way %d: %+v", where, n, w, x))
				}
			}
			if fp.Ways[gen.WayOpen].Fork == fp.Ways[gen.WayMachine].Fork {
				out.badFork = append(out.badFork, fmt.Sprintf("%s floor %d: both ways are %s", where, n, fp.Ways[0].Fork))
			}
		}
	}
}

// delveWorld is what one attended-then-unattended game showed.
type delveWorld struct {
	dungeon            hex.Hex
	floors             int64
	reached, falls     int64
	haunted, calmed    int
	hauntBad, calmBad  []string
	stillHaunted       bool
	refills, refillBad int
	refillNotes        []string
	dropped, lost      int64 // units into floor pools: carried by those who fell, an encounter's lost haul
	found              int64 // units out of them
	poolEnd            int64 // units in floor pools at the end
	poolBad            []string
	quietMoves         int // floor pool legs on unattended days
	hunt               huntRead
	audit              []string
}

// huntRead is a hunt the hunters pressed: whether it fell, by how many,
// and its roll against the row and the parts.
type huntRead struct {
	slain    bool
	pressers int
	rolled   []string
	bad      []string
}

// playDelveWorld plays one game: a ready party and a green one at the
// nearest deep dungeon and a band of hunters at a hunt by the first
// settlement for delveDays, then worldDays left alone.
func playDelveWorld(b *sheets.Book, seed int) (delveWorld, error) {
	var out delveWorld
	label := fmt.Sprintf("world-delve-%d", seed)
	r, err := game.NewRules(b, keys.Throwaway(label))
	if err != nil {
		return out, err
	}
	g, err := game.New(r)
	if err != nil {
		return out, err
	}
	home := g.SettlementHex(0)
	ds := Dungeons(g, home, dungeonScan, 4)
	if len(ds) == 0 {
		return out, fmt.Errorf("%s: no dungeon of four floors within %d tiles", label, dungeonScan)
	}
	h := ds[0]
	plan, _ := r.Gen.Dungeon(h)
	out.dungeon, out.floors = h, plan.Floors
	create := func(who string) (*game.Char, error) {
		res, err := g.Act(game.Command{Key: label + "-new-" + who, Kind: game.Create, Option: "knife"})
		if err != nil {
			return nil, err
		}
		return res.Char, nil
	}
	bottom := min(int64(len(b.FightTiers)), plan.SeedTier+(plan.Floors-1)/2)
	var ready, green []*game.Char
	for i := range 2 * party4 {
		c, err := create(fmt.Sprintf("delver-%d", i))
		if err != nil {
			return out, err
		}
		c.C.At = h
		if i < party4 {
			Ready(r, c, bottom, bottom)
			ready = append(ready, c)
		} else {
			green = append(green, c)
		}
	}
	beside, ok := Beside(g, home)
	if !ok {
		return out, fmt.Errorf("%s: no land beside the first settlement", label)
	}
	var far []hex.Hex
	for _, n := range hex.Ring(beside, huntWalk) {
		if r.Gen.Passable(r.Gen.Baseline(n).Terrain) && g.World.RegionAt(n) >= 0 {
			far = append(far, n)
		}
	}
	if len(far) == 0 {
		return out, fmt.Errorf("%s: no land %d tiles from the hunt", label, huntWalk)
	}
	var hunters []*game.Char
	for i := range huntBand {
		c, err := create(fmt.Sprintf("hunter-%d", i))
		if err != nil {
			return out, err
		}
		c.C.At = beside
		tier := int64(1)
		if i >= huntGreen {
			tier, c.C.At = huntVeteran, far[(i-huntGreen)%len(far)]
		}
		Ready(r, c, tier, tier)
		hunters = append(hunters, c)
	}
	parties := []*Script{{G: g, Label: label + "-ready", Party: ready}, {G: g, Label: label + "-green", Party: green, Hunters: hunters}}
	for _, s := range parties {
		for _, c := range s.Party[1:] {
			s.Act(s.Party[0], game.Command{Kind: game.PartyInvite, Target: c.C.ID})
			s.Act(c, game.Command{Kind: game.PartyJoin, Target: s.Party[0].C.ID})
		}
	}
	parties[1].Act(nil, game.Command{Kind: game.HuntStart, Asset: delveHunt, To: &beside})
	refill := sheets.IntParam(b.WorldParams, "dungeon-refill-days") * sheets.TicksPerDay
	pools := floorPools{}
	var hauntFacts []fact.Fact
	for day := range delveDays + worldDays {
		attended := day < delveDays
		for range sheets.TicksPerDay {
			if attended {
				for _, s := range parties {
					s.Delve()
					s.Hunt()
					if err := s.Err(); err != nil {
						return out, err
					}
				}
			}
			facts, err := g.Advance()
			if err != nil {
				return out, err
			}
			for _, f := range facts {
				if f.Kind == "dungeon.haunted" || f.Kind == "dungeon.calm" {
					hauntFacts = append(hauntFacts, f)
				}
			}
			if moved := pools.add(g.Ledger.Flush()); !attended {
				out.quietMoves += moved
			}
			checkRefills(g, h, plan.Floors, refill, &out)
		}
	}
	out.dropped, out.lost, out.found, out.poolBad = pools.in, pools.lost, pools.out, pools.bad
	for _, bal := range g.Ledger.Balances {
		if _, _, ok := ledger.FloorOf(bal.Account); ok {
			out.poolEnd += bal.Units
			if bal.Units < 0 {
				out.poolBad = append(out.poolBad, fmt.Sprintf("%s holds %d %s", bal.Account, bal.Units, bal.Asset))
			}
		}
	}
	if out.dropped+out.lost-out.found != out.poolEnd {
		out.poolBad = append(out.poolBad, fmt.Sprintf("%d carried and %d of lost haul in, %d found, %d left", out.dropped, out.lost, out.found, out.poolEnd))
	}
	for _, f := range g.Log.Since(0) {
		switch f.Kind {
		case "dungeon.reached":
			if d, ok := f.Get("floor"); ok {
				out.reached = max(out.reached, d.N)
			}
		}
	}
	readHaunting(b, g, h, hauntFacts, &out)
	out.hunt = readHunt(g, hunters)
	out.audit = ledger.Audit(g.Ledger.Balances, g.Holdings())
	return out, nil
}

// structural: a party of four delves. The hunt's band is huntGreen at the
// hunt's own tier beside it from the start, and veterans of huntVeteran
// who walk in from huntWalk tiles off: green hands alone go down in it
// before it falls, and veterans alone bring it down before all ten press.
const (
	party4      = 4
	huntBand    = 10
	huntGreen   = 7
	huntVeteran = 3
	huntWalk    = 2
)

// floorPools counts the units moved into floor pools, from characters
// going down there and from the haul an encounter lost there, and out of
// them to characters who find them; any other leg is a pool making or
// losing goods.
type floorPools struct {
	in, lost, out int64
	bad           []string
}

func (p *floorPools) add(txns []ledger.Txn) int {
	moved := 0
	for _, t := range txns {
		var pool []ledger.Leg
		from, other := "", ""
		for _, l := range t.Legs {
			switch _, _, isPool := ledger.FloorOf(l.Account); {
			case isPool:
				pool = append(pool, l)
			case l.Account == ledger.FromHaul && l.Units < 0:
				from = l.Account
			default:
				if _, ok := ledger.CharOf(l.Account); !ok {
					other = l.Account
				}
			}
		}
		if len(pool) == 0 {
			continue
		}
		moved += len(pool)
		if other != "" {
			p.bad = append(p.bad, fmt.Sprintf("%s (%s) moves a floor pool against %s", t.Key, t.Kind, other))
		}
		for _, l := range pool {
			switch {
			case l.Units < 0:
				p.out -= l.Units
			case from != "":
				p.lost += l.Units
			default:
				p.in += l.Units
			}
		}
	}
	return moved
}

// checkRefills holds every floor the dungeon has recorded to its refill:
// cleared until its refill's time after it was cleared, standing again
// from then.
func checkRefills(g *game.Game, h hex.Hex, floors, refill int64, out *delveWorld) {
	t := g.World.Tile(h)
	if t == nil || t.Dungeon == nil {
		return
	}
	now := g.Tick()
	for n := int64(1); n <= floors; n++ {
		f := t.Dungeon.Floor(n)
		if f == nil || f.ClearedAt == 0 {
			continue
		}
		want := now < f.ClearedAt+refill
		if got := g.FloorClearedAt(h, n); got != want {
			out.refillBad++
			if len(out.refillNotes) < 3 {
				out.refillNotes = append(out.refillNotes, fmt.Sprintf("floor %d cleared at %d reads %v at %d", n, f.ClearedAt, got, now))
			}
		}
		if now == f.ClearedAt+refill {
			out.refills++
		}
	}
}

// readHaunting holds each turn of the dungeon's haunting to its rule: it
// turns haunted at haunted-falls or more inside haunted-days, and calms
// once a window passes with fewer.
func readHaunting(b *sheets.Book, g *game.Game, h hex.Hex, fs []fact.Fact, out *delveWorld) {
	line := sheets.IntParam(b.TileParams, "haunted-falls")
	for _, f := range fs {
		d, _ := f.Get("falls")
		switch f.Kind {
		case "dungeon.haunted":
			out.haunted++
			if d.N < line {
				out.hauntBad = append(out.hauntBad, fmt.Sprintf("haunted at %d with %d falls", f.Tick, d.N))
			}
		case "dungeon.calm":
			out.calmed++
			if d.N >= line {
				out.calmBad = append(out.calmBad, fmt.Sprintf("calm at %d with %d falls", f.Tick, d.N))
			}
		}
	}
	if t := g.World.Tile(h); t != nil && t.Dungeon != nil {
		out.stillHaunted = t.Dungeon.Haunted
		for _, fl := range t.Dungeon.Floors {
			out.falls += int64(len(fl.Fell))
		}
	}
}

// readHunt is what the hunters made of the hunt: its fall, its pressers,
// and its roll against the row's bounds and what the pool paid out.
func readHunt(g *game.Game, hunters []*game.Char) huntRead {
	var out huntRead
	pressers := map[string]bool{}
	for _, f := range g.Log.Since(0) {
		switch f.Kind {
		case "hunt.pressed":
			pressers[f.Subjects[0].ID] = true
		case "hunt.slain":
			out.slain = true
			id, _ := f.Get("hunt")
			row, _ := f.Get("row")
			spoils := map[string]int64{}
			if hr, ok := g.Rules().Fight.Hunt(row.S); ok {
				for _, s := range hr.Spoils {
					spoils[s.Material] = s.Quantity
				}
			}
			for _, d := range f.Data {
				mat, ok := strings.CutPrefix(d.Key, "rolled:")
				if !ok {
					continue
				}
				out.rolled = append(out.rolled, fmt.Sprintf("%d %s", d.N, mat))
				top := spoils[mat]
				if d.N < fixed.Ratio(top, 2).Int() || d.N > top {
					out.bad = append(out.bad, fmt.Sprintf("%s rolled %d outside half to all of %d", mat, d.N, top))
				}
				left := g.Ledger.Of(ledger.HuntPool(id.S), ledger.Material(mat))
				minted := -g.Ledger.Of(ledger.FromHunt, ledger.Material(mat))
				if left != 0 || minted < d.N {
					out.bad = append(out.bad, fmt.Sprintf("%s: %d left in the pool, %d minted for a roll of %d", mat, left, minted, d.N))
				}
			}
		}
	}
	for _, c := range hunters {
		if pressers[c.C.ID] {
			out.pressers++
		}
	}
	return out
}

// dungeonSections runs the seeds and the delve games and writes the World
// run's dungeon sections, returning their readings.
func dungeonSections(b *sheets.Book, p func(string, ...any)) ([]Measured, error) {
	seeds := make([]seedDungeons, dungeonSeeds)
	if err := runParallel(dungeonSeeds, func(i int) error {
		var err error
		seeds[i], err = scanSeed(b, i)
		return err
	}); err != nil {
		return nil, err
	}
	worlds := make([]delveWorld, delveWorlds)
	if err := runParallel(delveWorlds, func(i int) error {
		var err error
		worlds[i], err = playDelveWorld(b, i)
		return err
	}); err != nil {
		return nil, err
	}

	byTier := map[int64]*tierRow{}
	kinds := map[string]int{}
	var badPlan, badFork []string
	var plans, forks, machines, guardians int
	for _, s := range seeds {
		for _, pl := range s.plans {
			row := byTier[pl.SeedTier]
			if row == nil {
				row = &tierRow{floors: map[int64]int{}}
				byTier[pl.SeedTier] = row
			}
			row.n++
			row.sum += pl.Floors
			row.floors[pl.Floors]++
			kinds[pl.Kind]++
		}
		plans += len(s.plans)
		forks += s.forks
		machines += s.machines
		guardians += s.guardian
		badPlan = append(badPlan, s.badPlan...)
		badFork = append(badFork, s.badFork...)
	}
	tiers := slices.Sorted(maps.Keys(byTier))
	// Deeper with the tier: each map.depths row's dungeons run deeper on
	// average than the row's below; tiers that share a row share its odds.
	byRow := map[int64]*tierRow{}
	for _, t := range tiers {
		d, ok := sheets.DepthAt(b.Depths, t)
		if !ok {
			return nil, fmt.Errorf("no map.depths row for seed tier %d", t)
		}
		row := byRow[d.Tier]
		if row == nil {
			row = &tierRow{floors: map[int64]int{}}
			byRow[d.Tier] = row
		}
		row.n, row.sum = row.n+byTier[t].n, row.sum+byTier[t].sum
	}
	rows := slices.Sorted(maps.Keys(byRow))
	deeper := true
	for i := 1; i < len(rows); i++ {
		a, c := byRow[rows[i-1]], byRow[rows[i]]
		if float64(c.sum)/float64(c.n) <= float64(a.sum)/float64(a.n) {
			deeper = false
		}
	}
	p("")
	p("## Dungeons from the seed")
	p("")
	p("%s seeds (throwaway keys `dungeons-<n>`), every dungeon and relay place within %d tiles of each starting settlement: %s dungeons, %s.", comma(dungeonSeeds), dungeonScan, comma(int64(plans)), mapList(kinds))
	p("")
	p("| Seed tier | Dungeons | Mean floors | 3 | 4 | 5 | 6 | 7 |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, t := range tiers {
		row := byTier[t]
		line := fmt.Sprintf("| %d | %s | %.2f |", t, comma(int64(row.n)), float64(row.sum)/float64(row.n))
		for f := int64(3); f <= 7; f++ {
			line += fmt.Sprintf(" %.1f%% |", pct(row.floors[f], row.n))
		}
		p("%s", line)
	}
	p("")
	p("Mean floors by `map.depths` row (tiers that share a row share its odds): %s.", meanFloors(rows, byRow))
	p("")
	p("Every floor above a bottom, read by every way in: %s forks, %.1f%% with way 1 behind a machine (`fork-machine-share`). Problems: %d with the plans, %d with the forks.", comma(int64(forks)), pct(machines, forks), len(badPlan), len(badFork))
	for _, x := range append(firstFew(badPlan), firstFew(badFork)...) {
		p("- %s", x)
	}
	floorsOK := len(badPlan) == 0 && deeper && guardians == plans && plans > 0
	readings := []Measured{
		{"dungeon-floors", fmt.Sprintf("%s dungeons over %s seeds, 3 to 7 floors %s, mean floors by seed tier %s, %d without a guardian", comma(int64(plans)), comma(dungeonSeeds),
			either(len(badPlan) == 0, "every one", fmt.Sprintf("but %d", len(badPlan))), meanFloors(tiers, byTier), plans-guardians) +
			either(deeper, "", "; a map.depths row runs no deeper than the one below"), floorsOK},
		{"dungeon-forks", fmt.Sprintf("%s forks, %d off their rule; %.1f%% behind a machine", comma(int64(forks)), len(badFork), pct(machines, forks)), len(badFork) == 0 && forks > 0},
	}

	p("")
	p("## Dungeons played, then left alone")
	p("")
	p("%d games (throwaway keys `world-delve-<n>`). For %d world days a party of four set at the bottom tier's expected gear and practice and a green party of four delve the nearest dungeon of four floors or more to the first settlement, through the game's own commands (each party machine worked with its version's own solver), and %d hunters press a `%s` hunt opened beside it. Then nobody acts for %d world days. Refills are read every tick, haunting at each day turn; the floor pools are every ledger leg on a `pool:floor:` account: into one only from a character who fell there or from the haul an encounter lost there, out of one only to a character who found it there.", delveWorlds, delveDays, huntBand, delveHunt, worldDays)
	p("")
	p("| Game | Dungeon | Deepest reached | Falls kept | Haunted / calmed | Haunted at the end | Refills seen | Refill misreads | Carried in by the fallen | Lost haul left | Found | Left | Legs while left alone | Hunt |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	var hauntOK, refillOK, poolOK, huntOK = true, true, true, true
	var hauntNotes, refillNotes, poolNotes, huntNotes []string
	for i, w := range worlds {
		hunt := either(w.hunt.slain, fmt.Sprintf("slain by %d, rolled %s", w.hunt.pressers, strings.Join(w.hunt.rolled, ", ")), fmt.Sprintf("left, %d pressed", w.hunt.pressers))
		p("| %d | %s (%d floors) | %d | %d | %d / %d | %v | %d | %d | %d | %d | %d | %d | %d | %s |", i, w.dungeon.Ref(), w.floors, w.reached, w.falls, w.haunted, w.calmed, w.stillHaunted,
			w.refills, w.refillBad, w.dropped, w.lost, w.found, w.poolEnd, w.quietMoves, hunt)
		if w.haunted == 0 || w.calmed == 0 || w.stillHaunted || len(w.hauntBad) > 0 || len(w.calmBad) > 0 {
			hauntOK = false
		}
		hauntNotes = append(hauntNotes, fmt.Sprintf("game %d haunted %d, calmed %d", i, w.haunted, w.calmed))
		if w.refillBad > 0 || w.refills == 0 {
			refillOK = false
		}
		refillNotes = append(refillNotes, w.refillNotes...)
		if len(w.poolBad) > 0 || w.quietMoves > 0 || len(w.audit) > 0 {
			poolOK = false
		}
		poolNotes = append(poolNotes, fmt.Sprintf("game %d %d in, %d found, %d left", i, w.dropped+w.lost, w.found, w.poolEnd))
		if !w.hunt.slain || w.hunt.pressers < 2 || len(w.hunt.bad) > 0 {
			huntOK = false
		}
		huntNotes = append(huntNotes, hunt)
		for _, x := range firstFew(slices.Concat(w.hauntBad, w.calmBad, w.poolBad, w.hunt.bad, w.audit)) {
			p("- game %d: %s", i, x)
		}
	}
	for _, x := range firstFew(refillNotes) {
		p("- %s", x)
	}
	p("")
	// A floor refills by its own record, so the floor pools' reading
	// carries the refills too: what fell on a floor waits there while it
	// stands again.
	pools := strings.Join(poolNotes, "; ") + "; no leg while left alone" + either(refillOK, "; every refill on its day", "; refills misread")
	readings = append(readings,
		Measured{"haunted-comes-and-goes", strings.Join(hauntNotes, "; ") + either(hauntOK, ", each turn at its line", ""), hauntOK},
		Measured{"floor-pools-conserved", pools + either(poolOK, "", " (see world.md)"), poolOK && refillOK},
		Measured{"hunt-spoils-conserved", strings.Join(huntNotes, "; "), huntOK},
	)
	return readings, nil
}

// tierRow is the dungeons of one seed tier: how many, their floors.
type tierRow struct {
	n      int
	floors map[int64]int
	sum    int64
}

// meanFloors lists each seed tier's mean floors.
func meanFloors(tiers []int64, by map[int64]*tierRow) string {
	var parts []string
	for _, t := range tiers {
		parts = append(parts, fmt.Sprintf("tier %d %.2f", t, float64(by[t].sum)/float64(by[t].n)))
	}
	return strings.Join(parts, ", ")
}

// firstFew is at most three of a list's problems.
func firstFew(xs []string) []string { return xs[:min(len(xs), 3)] }
