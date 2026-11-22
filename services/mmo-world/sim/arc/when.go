package arc

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// Extra is what a few predicates read beyond World; the game's view
// implements both. A World without it casts none of the predicates that
// need it (the finale's region pressure, the debt, fire after a raid, the
// caravan, the migration).
type Extra interface {
	// LineFrom is where the gauge's lowest world.gauge-lines line starts.
	LineFrom(gauge string) int64
	// Home is the tile an NPC lives on.
	Home(npc string) (hex.Hex, bool)
	// Followed is the tick a raid last got into place n, or 0.
	Followed(n int) int64
	// Passages is the season passage count on place n's tile.
	Passages(n int) int64
	// Herd is the population in region of the creature a fights.hunts row hunts.
	Herd(region int, hunt string) int64
}

// Streaks World.Streak counts, in days running.
const (
	StreakProsper = "prosper"
	StreakCold    = "cold"
	StreakWet     = "wet"
	StreakLow     = "low"
)

// Gauges and world.gauge-lines rows the predicates read.
const (
	gaugeThreat     = "threat"
	gaugeScarcity   = "scarcity"
	gaugeUnrest     = "unrest"
	gaugeCorruption = "corruption"
	gaugeProsperity = "prosperity"

	lineRaid       = "threat-raid"
	lineOverrun    = "threat-overrun"
	lineFire       = "unrest-fire"
	lineCorruption = "corruption-spreads"
	lineYields     = "scarcity-yields"
	lineCaravans   = "prosperity-caravans"
)

// Cast kinds and the one role every predicate shares.
const (
	kindFaction    = "faction"
	kindRegion     = "region"
	kindHolding    = "holding"
	kindSettlement = "settlement"
	kindNotable    = "notable"
	kindNPC        = "npc"
	kindCharacter  = "character"
	kindTile       = "tile"

	roleSeat = "seat"

	tagMilitant = "militant"
	roleLeader  = "leader"
)

// Memory kinds the predicates read.
const (
	memNotableDied  = "notable.died"
	memBetrayed     = "faction.betrayed"
	memRaided       = "faction.raided"
	memBesieged     = "faction.besieged"
	memHoldingFell  = "holding.fell"
	memStarving     = "faction.starving"
	memSeasonTurned = "season.turned"
	memSeasonBegan  = "season.began"
	memCoreOpened   = "core.opened"
	memArcCast      = "arc.cast"
	memArcEnded     = "arc.ended"
	memTroubleLost  = "trouble.lost"
	memSurge        = "region.surge"
	memRaids        = "region.raids"
	memUnrest       = "region.unrest"
	memOverrun      = "region.overrun"
	memCorruption   = "region.corruption-spreads"
	memStructure    = "structure.raised"

	// scopeSubject is the subject kind an arc.ended fact names its scope by.
	scopeSubject = "scope"
)

// structural: an arc.ended memory's N says whether it lapsed; a midpoint
// halves a sum; a succession and a betrayal each take two.
const (
	lapsedN = 1
	halves  = 2
	pair    = 2
)

func init() {
	Predicates["militant-borders-weaker"] = militantBordersWeaker
	Predicates["leader-died"] = leaderDied
	Predicates["cold-snap"] = coldSnap
	Predicates["core-open"] = coreOpen
	Predicates["pressure-region"] = pressureRegion
	Predicates["pressure-faction"] = pressureFaction
	Predicates["pressure-settlement"] = pressureSettlement
	Predicates["corruption-front"] = corruptionFront
	Predicates["rival-seats"] = rivalSeats
	Predicates["notable-wavers"] = notableWavers
	Predicates["betrayal"] = betrayal
	Predicates["overrun"] = overrun
	Predicates["dry-region"] = dryRegion
}

// RegionRef names region r as a cast binds it.
func RegionRef(r int) fact.Ref { return fact.Ref{Kind: kindRegion, ID: "r-" + strconv.Itoa(r)} }

// FactionRef names faction f.
func FactionRef(f int) fact.Ref { return fact.Ref{Kind: kindFaction, ID: "f-" + strconv.Itoa(f)} }

// HoldingRef names the holding that is region r.
func HoldingRef(r int) fact.Ref { return fact.Ref{Kind: kindHolding, ID: "r-" + strconv.Itoa(r)} }

// SettlementRef names place n; its String is goal.SettlementRef(n).
func SettlementRef(n int) fact.Ref { return fact.Ref{Kind: kindSettlement, ID: strconv.Itoa(n)} }

// TileRef names tile h; its String is goal.TileRef(h).
func TileRef(h hex.Hex) fact.Ref { return fact.Ref{Kind: kindTile, ID: h.Ref()} }

// RefIndex is the index a region, faction, holding or settlement ref names.
func RefIndex(r fact.Ref) (int, bool) {
	s := r.ID
	if _, n, ok := strings.Cut(s, "-"); ok {
		s = n
	}
	i, err := strconv.Atoi(s)
	return i, err == nil && i >= 0
}

func notableRef(id string) fact.Ref { return fact.Ref{Kind: kindNotable, ID: id} }

// bind is one role's binding.
func bind(role string, ref fact.Ref) Binding { return Binding{Role: role, Ref: ref} }

// dayOf is the world day a tick falls in.
func dayOf(tick int64) int64 { return tick / sheets.TicksPerDay }

// faction is the view of faction id, if it stands.
func faction(fs []FactionView, id int) (FactionView, bool) {
	i := slices.IndexFunc(fs, func(f FactionView) bool { return f.ID == id })
	if i < 0 || fs[i].Fallen {
		return FactionView{}, false
	}
	return fs[i], true
}

// place is the view of place n, if it is open and not a ruin.
func place(ps []PlaceView, n int) (PlaceView, bool) {
	i := slices.IndexFunc(ps, func(p PlaceView) bool { return p.N == n })
	if i < 0 || !standing(ps[i]) {
		return PlaceView{}, false
	}
	return ps[i], true
}

func standing(p PlaceView) bool { return p.Open && !p.Ruined }

// nearestTo is the standing place nearest h that keep accepts, lowest
// index on a tie.
func nearestTo(ps []PlaceView, h hex.Hex, keep func(PlaceView) bool) (PlaceView, bool) {
	var best PlaceView
	got := false
	for _, p := range ps {
		if !standing(p) || !keep(p) {
			continue
		}
		if !got || cmp.Or(cmp.Compare(hex.Distance(p.Hex, h), hex.Distance(best.Hex, h)), cmp.Compare(p.N, best.N)) < 0 {
			best, got = p, true
		}
	}
	return best, got
}

// roleKind is the kind the row's cast gives role, or def when it names none.
func roleKind(row Row, role, def string) string {
	for _, c := range row.Cast {
		if c.Role == role {
			return c.Kind
		}
	}
	return def
}

// seatNear binds the seat role near h as the row's cast kind says: a tile
// or a region there, or the open settlement nearest it. It returns the
// seat's tile.
func seatNear(w World, row Row, role string, h hex.Hex) (Binding, hex.Hex, bool) {
	switch roleKind(row, role, kindSettlement) {
	case kindTile:
		return bind(role, TileRef(h)), h, true
	case kindRegion:
		r := w.RegionOf(h)
		if r < 0 {
			return Binding{}, hex.Hex{}, false
		}
		return bind(role, RegionRef(r)), w.RegionHex(r), true
	}
	n, ok := w.NearestPlace(h)
	if !ok {
		return Binding{}, hex.Hex{}, false
	}
	p, ok := place(w.Places(), n)
	if !ok {
		return Binding{}, hex.Hex{}, false
	}
	return bind(role, SettlementRef(n)), p.Hex, true
}

// seatAt binds the seat role to place p itself.
func seatAt(role string, p PlaceView) Binding { return bind(role, SettlementRef(p.N)) }

// regionSet is regions sorted, without duplicates or negatives.
func regionSet(rs ...int) []int {
	out := slices.DeleteFunc(slices.Clone(rs), func(r int) bool { return r < 0 })
	slices.Sort(out)
	return slices.Compact(out)
}

// withNeighbours is r and its awake neighbours.
func withNeighbours(w World, r int) []int { return regionSet(append([]int{r}, w.Neighbours(r)...)...) }

// names reports whether m is about any of refs.
func names(m Memory, refs ...fact.Ref) bool {
	return slices.ContainsFunc(m.Subjects, func(s fact.Ref) bool { return slices.Contains(refs, s) })
}

// recalled is the ids of the kept facts of kinds within days that keep
// accepts, oldest first.
func recalled(w World, days int64, kinds []string, keep func(Memory) bool) []fact.ID {
	var out []fact.ID
	for _, k := range kinds {
		for _, m := range w.Recall(k, days) {
			if keep(m) {
				out = append(out, m.Fact)
			}
		}
	}
	slices.Sort(out)
	return slices.Compact(out)
}

// inRegions keeps memories located in any of regions.
func inRegions(regions []int) func(Memory) bool {
	return func(m Memory) bool { return slices.Contains(regions, m.Region) }
}

// busy reports whether a candidate cannot be cast at scope: a world or
// region arc's non-seat roles (and a region arc's regions), a trouble's
// place, a thread's character.
func busy(w World, scope string, c Candidate) bool {
	for _, b := range c.Cast {
		key := false
		switch scope {
		case Personal:
			key = b.Ref.Kind == kindCharacter
		case Settlement:
			key = b.Ref.Kind == kindSettlement && c.Place >= 0 && b.Ref == SettlementRef(c.Place)
		default:
			key = b.Role != roleSeat
		}
		if key && w.Busy(scope, b.Ref) {
			return true
		}
	}
	if scope == Region {
		for _, r := range c.Regions {
			if w.Busy(scope, RegionRef(r)) {
				return true
			}
		}
	}
	return false
}

// found keeps the candidates not busy at the row's scope, in casting order.
func found(w World, row Row, cs []Candidate) []Candidate {
	cs = slices.DeleteFunc(cs, func(c Candidate) bool { return busy(w, row.Scope, c) })
	for i := range cs {
		cs[i].Cast = Sorted(cs[i].Cast)
	}
	return Ordered(cs)
}

// candidate starts one for a world or region row.
func candidate(seat hex.Hex, regions []int, pressure int64, causes []fact.ID, cast ...Binding) Candidate {
	return Candidate{Cast: cast, Regions: regions, Seat: seat, Causes: causes, Pressure: pressure, Place: -1}
}

// over is how far a gauge stands over its lowest line.
func over(w World, x Extra, r int, gauge string) int64 {
	return max(w.Gauge(r, gauge)-x.LineFrom(gauge), 0)
}

// militantBordersWeaker is the siege: a faction tagged militant holds a
// region next to another faction's holding of lower defence that is not
// that faction's last. The besieger is the largest such faction; the
// weaker the holding against it, the higher the pressure.
func militantBordersWeaker(w World, row Row, p Params) []Candidate {
	fs := w.Factions()
	type siege struct {
		holding  int
		besieger FactionView
		gap      int64
	}
	var targets []siege
	for _, f := range fs {
		if f.Fallen || !slices.Contains(f.Tags, tagMilitant) {
			continue
		}
		for _, h := range f.Holdings {
			for _, n := range w.Neighbours(h) {
				holder, ok := faction(fs, w.Holder(n))
				if !ok || holder.ID == f.ID || len(holder.Holdings) <= 1 || w.Defence(n) >= w.Defence(h) {
					continue
				}
				s := siege{holding: n, besieger: f, gap: w.Defence(h) - w.Defence(n)}
				i := slices.IndexFunc(targets, func(t siege) bool { return t.holding == n })
				switch {
				case i < 0:
					targets = append(targets, s)
				case larger(f, targets[i].besieger) || (targets[i].besieger.ID == f.ID && s.gap > targets[i].gap):
					targets[i] = s
				}
			}
		}
	}
	slices.SortFunc(targets, func(a, b siege) int { return cmp.Compare(a.holding, b.holding) })
	var out []Candidate
	for _, s := range targets {
		n := s.holding
		seat, at, ok := seatNear(w, row, roleSeat, w.RegionHex(n))
		if !ok {
			continue
		}
		both := []fact.Ref{FactionRef(s.besieger.ID), FactionRef(w.Holder(n))}
		causes := recalled(w, p.MemoryDays, []string{memRaided, memBesieged, memBetrayed, memHoldingFell}, func(m Memory) bool {
			return m.Region == n || (names(m, both[0]) && names(m, both[1]))
		})
		out = append(out, candidate(at, regionSet(n, w.RegionOf(at)), s.gap, causes,
			bind("besieger", both[0]), bind("holder", both[1]), bind("holding", HoldingRef(n)), seat))
	}
	return found(w, row, out)
}

// larger reports whether faction a holds more than b, the lower id on a tie.
func larger(a, b FactionView) bool {
	return cmp.Or(cmp.Compare(len(b.Holdings), len(a.Holdings)), cmp.Compare(a.ID, b.ID)) < 0
}

// leaderDied is the succession: a faction's leading notable died within
// leader-died-days, and two living notables can claim the seat, the most
// loyal against the least.
func leaderDied(w World, row Row, p Params) []Candidate {
	fs := w.Factions()
	var out []Candidate
	done := map[int]bool{}
	for _, m := range newestFirst(w.Recall(memNotableDied, p.LeaderDiedDays)) {
		for _, s := range m.Subjects {
			if s.Kind != kindFaction {
				continue
			}
			fi, ok := RefIndex(s)
			f, up := faction(fs, fi)
			if !ok || !up || done[fi] || !diedLeading(f, m) {
				continue
			}
			a, b, ok := claimants(f)
			if !ok {
				continue
			}
			seat, at, ok := seatNear(w, row, roleSeat, w.RegionHex(f.Seat))
			if !ok {
				continue
			}
			done[fi] = true
			out = append(out, candidate(at, regionSet(append(slices.Clone(f.Holdings), w.RegionOf(at))...),
				int64(len(f.Holdings)), []fact.ID{m.Fact},
				bind("faction", FactionRef(fi)), bind("claimant-a", notableRef(a.ID)), bind("claimant-b", notableRef(b.ID)), seat))
		}
	}
	return found(w, row, out)
}

// newestFirst orders memories by fact, newest first.
func newestFirst(ms []Memory) []Memory {
	out := slices.Clone(ms)
	slices.SortFunc(out, func(a, b Memory) int { return cmp.Compare(b.Fact, a.Fact) })
	return out
}

// diedLeading reports whether the notable a notable.died memory names was
// its faction's leader.
func diedLeading(f FactionView, m Memory) bool {
	for _, s := range m.Subjects {
		if s.Kind != kindNotable {
			continue
		}
		i := slices.IndexFunc(f.Notables, func(n NotableView) bool { return n.ID == s.ID })
		if i >= 0 && f.Notables[i].Dead && f.Notables[i].Role == roleLeader {
			return true
		}
	}
	return false
}

// claimants are a faction's most and least loyal living notables, two
// different ones; ties go to the lower id.
func claimants(f FactionView) (most, least NotableView, ok bool) {
	var living []NotableView
	for _, n := range f.Notables {
		if !n.Dead {
			living = append(living, n)
		}
	}
	if len(living) < pair {
		return NotableView{}, NotableView{}, false
	}
	slices.SortStableFunc(living, func(a, b NotableView) int {
		return cmp.Or(cmp.Compare(b.Loyalty, a.Loyalty), cmp.Compare(a.ID, b.ID))
	})
	least = living[len(living)-1]
	for _, n := range living[:len(living)-1] {
		if n.Loyalty == least.Loyalty && n.ID > least.ID {
			least = n
		}
	}
	most = living[0]
	if most.ID == least.ID {
		most = living[1]
	}
	return most, least, true
}

// coldSnap is the long cold: at least cold-regions regions with a frost
// streak of cold-days. The front is the longest streak.
func coldSnap(w World, row Row, p Params) []Candidate {
	var cold []int
	front, longest := -1, int64(0)
	var total int64
	for _, r := range w.Awake() {
		s := w.Streak(r, StreakCold)
		if s < p.ColdDays || w.Busy(row.Scope, RegionRef(r)) {
			continue
		}
		cold = append(cold, r)
		total += s
		if s > longest || (s == longest && r < front) {
			front, longest = r, s
		}
	}
	if int64(len(cold)) < p.ColdRegions {
		return nil
	}
	seat, at, ok := seatNear(w, row, roleSeat, w.RegionHex(front))
	if !ok {
		return nil
	}
	regions := regionSet(append(cold, w.RegionOf(at))...)
	causes := recalled(w, p.ColdDays, []string{memSeasonTurned}, func(Memory) bool { return true })
	return found(w, row, []Candidate{candidate(at, regions, total, causes, bind("front", RegionRef(front)), seat)})
}

// coreOpen is the opening: the ring's core stands open and no opening has
// been cast since it opened.
func coreOpen(w World, row Row, p Params) []Candidate {
	core, open := w.Core()
	if !open {
		return nil
	}
	ref := TileRef(core)
	opened := w.Recall(memCoreOpened, p.MemoryDays)
	since := int64(-1)
	var causes []fact.ID
	for _, m := range opened {
		if m.Tick > since {
			since, causes = m.Tick, []fact.ID{m.Fact}
		}
	}
	for _, m := range w.Recall(memArcCast, p.MemoryDays) {
		if m.Tick >= since && names(m, ref) {
			return nil
		}
	}
	seat, at, ok := seatNear(w, row, roleSeat, core)
	if !ok {
		return nil
	}
	r := w.RegionOf(core)
	var regions []int
	if r >= 0 {
		regions = withNeighbours(w, r)
	}
	regions = regionSet(append(regions, w.RegionOf(at))...)
	pressure := int64(0)
	if r >= 0 {
		pressure = w.Gauge(r, gaugeThreat)
	}
	return found(w, row, []Candidate{candidate(at, regions, pressure, causes, bind("core", ref), seat)})
}

// struck is the regions, with the lapse facts, that a world arc's lapse
// struck: arc.ended memories naming the world scope with N lapsedN.
func struck(w World, p Params) map[int][]fact.ID {
	out := map[int][]fact.ID{}
	world := fact.Ref{Kind: scopeSubject, ID: ScopeWorld}
	for _, m := range w.Recall(memArcEnded, p.MemoryDays) {
		if m.N != lapsedN || !names(m, world) {
			continue
		}
		for _, s := range m.Subjects {
			if s.Kind != kindRegion {
				continue
			}
			if r, ok := RefIndex(s); ok {
				out[r] = append(out[r], m.Fact)
			}
		}
	}
	return out
}

// pressureRegion is the last stand's finale score per awake region:
// threat and corruption over their lowest lines, plus finale-lapse-bonus
// where the world arc's lapse struck.
func pressureRegion(w World, row Row, p Params) []Candidate {
	x, ok := w.(Extra)
	if !ok {
		return nil
	}
	hit := struck(w, p)
	var out []Candidate
	for _, r := range w.Awake() {
		score := over(w, x, r, gaugeThreat) + over(w, x, r, gaugeCorruption)
		causes := slices.Clone(hit[r])
		if len(causes) > 0 {
			score += p.FinaleLapseBonus
		}
		if score <= 0 {
			continue
		}
		seat, at, ok := seatNear(w, row, roleSeat, w.RegionHex(r))
		if !ok {
			continue
		}
		causes = append(causes, recalled(w, p.MemoryDays, []string{memSurge, memRaids, memOverrun, memCorruption}, inRegions([]int{r}))...)
		slices.Sort(causes)
		out = append(out, candidate(at, regionSet(r, w.RegionOf(at)), score, slices.Compact(causes), bind("front", RegionRef(r)), seat))
	}
	return found(w, row, out)
}

// pressureFaction is the reckoning's finale score per faction: the grudge
// days the others hold against it. The wronged is the one holding most.
func pressureFaction(w World, row Row, p Params) []Candidate {
	fs := w.Factions()
	var out []Candidate
	for _, f := range fs {
		if f.Fallen {
			continue
		}
		var score, most int64
		wronged := -1
		for _, o := range fs {
			if o.Fallen || o.ID == f.ID || f.ID >= len(o.Grudge) {
				continue
			}
			g := o.Grudge[f.ID]
			score += g
			if g > most {
				most, wronged = g, o.ID
			}
		}
		if wronged < 0 {
			continue
		}
		seat, at, ok := seatNear(w, row, roleSeat, w.RegionHex(f.Seat))
		if !ok {
			continue
		}
		both := []fact.Ref{FactionRef(f.ID), FactionRef(wronged)}
		causes := recalled(w, p.MemoryDays, []string{memBetrayed}, func(m Memory) bool { return names(m, both[0]) && names(m, both[1]) })
		out = append(out, candidate(at, regionSet(append(slices.Clone(f.Holdings), w.RegionOf(at))...), score, causes,
			bind("faction", both[0]), bind("wronged", both[1]), seat))
	}
	return found(w, row, out)
}

// pressureSettlement is the rebuilding's finale score per place: troubles
// lost this season × finale-loss-weight. The seat is the nearest other
// standing place, or the place itself when it stands alone.
func pressureSettlement(w World, row Row, p Params) []Candidate {
	ps := w.Places()
	var out []Candidate
	for _, pl := range ps {
		if !standing(pl) || pl.Lost <= 0 {
			continue
		}
		other, ok := nearestTo(ps, pl.Hex, func(o PlaceView) bool { return o.N != pl.N })
		if !ok {
			other = pl
		}
		causes := recalled(w, p.MemoryDays, []string{memTroubleLost}, func(m Memory) bool {
			return m.At == pl.Hex || names(m, SettlementRef(pl.N))
		})
		out = append(out, candidate(pl.Hex, regionSet(pl.Region, other.Region), pl.Lost*p.FinaleLossWeight, causes,
			bind("place", SettlementRef(pl.N)), seatAt(roleSeat, other)))
	}
	return found(w, row, out)
}

// corruptionFront is a region over its corruption line with at least
// front-joined neighbours over theirs, the most corrupt of them as the
// source.
func corruptionFront(w World, row Row, p Params) []Candidate {
	var out []Candidate
	for _, r := range w.Awake() {
		if !w.Line(r, lineCorruption) {
			continue
		}
		mine := w.Gauge(r, gaugeCorruption)
		joined, top := int64(0), true
		for _, n := range w.Neighbours(r) {
			if !w.Line(n, lineCorruption) {
				continue
			}
			joined++
			if c := w.Gauge(n, gaugeCorruption); c > mine || (c == mine && n < r) {
				top = false
			}
		}
		if joined < p.FrontJoined || !top {
			continue
		}
		seat, at, ok := seatNear(w, row, roleSeat, w.RegionHex(r))
		if !ok {
			continue
		}
		regions := regionSet(append(withNeighbours(w, r), w.RegionOf(at))...)
		causes := recalled(w, p.MemoryDays, []string{memCorruption}, inRegions(regions))
		out = append(out, candidate(at, regions, mine, causes, bind("source", RegionRef(r)), seat))
	}
	return found(w, row, out)
}

// rivalSeats is two open places run by different guilds within
// rival-distance, each of which raised a structure in rival-growth-days.
// Keeper-run places and ruins never take part.
func rivalSeats(w World, row Row, p Params) []Candidate {
	since := (w.Day() - p.RivalGrowthDays) * sheets.TicksPerDay
	var growing []PlaceView
	for _, pl := range w.Places() {
		if standing(pl) && pl.Guild != "" && pl.Raised > 0 && pl.Raised >= since {
			growing = append(growing, pl)
		}
	}
	var out []Candidate
	for i, a := range growing {
		for _, b := range growing[i+1:] {
			if a.Guild == b.Guild || hex.Distance(a.Hex, b.Hex) > p.RivalDistance {
				continue
			}
			large, small := a, b
			if cmp.Or(cmp.Compare(b.Structures, a.Structures), cmp.Compare(b.Users, a.Users), cmp.Compare(a.N, b.N)) > 0 {
				large, small = b, a
			}
			causes := recalled(w, p.RivalGrowthDays, []string{memStructure}, func(m Memory) bool {
				return m.At == a.Hex || m.At == b.Hex
			})
			out = append(out, candidate(large.Hex, regionSet(large.Region, small.Region), large.Structures+small.Structures, causes,
				bind("seat-a", SettlementRef(large.N)), bind("seat-b", SettlementRef(small.N))))
		}
	}
	return found(w, row, out)
}

// notableWavers is the defector: a living notable who does not lead, below
// defector-loyalty. The rival is the faction whose disposition toward
// theirs is worst; the seat is nearest the rival's seat.
func notableWavers(w World, row Row, p Params) []Candidate {
	fs := w.Factions()
	var out []Candidate
	for _, f := range fs {
		if f.Fallen {
			continue
		}
		rival := -1
		var worst int64
		for _, o := range fs {
			if o.Fallen || o.ID == f.ID || f.ID >= len(o.Disposition) {
				continue
			}
			if d := o.Disposition[f.ID]; rival < 0 || d < worst {
				rival, worst = o.ID, d
			}
		}
		if rival < 0 {
			continue
		}
		rv, _ := faction(fs, rival)
		for _, n := range f.Notables {
			if n.Dead || n.Leading || n.Loyalty >= p.DefectorLoyalty {
				continue
			}
			seat, at, ok := seatNear(w, row, roleSeat, w.RegionHex(rv.Seat))
			if !ok {
				continue
			}
			causes := recalled(w, p.MemoryDays, []string{memHoldingFell, memStarving}, func(m Memory) bool { return names(m, FactionRef(f.ID)) })
			out = append(out, candidate(at, regionSet(append(slices.Clone(f.Holdings), w.RegionOf(at))...), p.DefectorLoyalty-n.Loyalty, causes,
				bind("faction", FactionRef(f.ID)), bind("notable", notableRef(n.ID)), bind("rival", FactionRef(rival)), seat))
		}
	}
	return found(w, row, out)
}

// betrayal is the grudge: a faction.betrayed within betrayal-days, between
// two factions still standing. The seat is nearest the midpoint of their
// seats.
func betrayal(w World, row Row, p Params) []Candidate {
	fs := w.Factions()
	var out []Candidate
	type duo struct{ betrayer, wronged int }
	seen := map[duo]bool{}
	for _, m := range newestFirst(w.Recall(memBetrayed, p.BetrayalDays)) {
		var who []int
		for _, s := range m.Subjects {
			if i, ok := RefIndex(s); ok && s.Kind == kindFaction {
				who = append(who, i)
			}
		}
		if len(who) < pair {
			continue
		}
		betrayer, ok1 := faction(fs, who[0])
		wronged, ok2 := faction(fs, who[1])
		key := duo{who[0], who[1]}
		if !ok1 || !ok2 || who[0] == who[1] || seen[key] {
			continue
		}
		a, b := w.RegionHex(betrayer.Seat), w.RegionHex(wronged.Seat)
		mid := hex.Hex{Q: (a.Q + b.Q) / halves, R: (a.R + b.R) / halves}
		seat, at, ok := seatNear(w, row, roleSeat, mid)
		if !ok {
			continue
		}
		seen[key] = true
		var grudge int64
		if betrayer.ID < len(wronged.Grudge) {
			grudge = wronged.Grudge[betrayer.ID]
		}
		out = append(out, candidate(at, regionSet(append(slices.Clone(betrayer.Holdings), w.RegionOf(at))...), grudge, []fact.ID{m.Fact},
			bind("betrayer", FactionRef(betrayer.ID)), bind("wronged", FactionRef(wronged.ID)), seat))
	}
	return found(w, row, out)
}

// overrun is a region with its overrun line active and a standing place
// in or beside it. The seat is the nearest place outside it, or the
// nearest at all when every place is inside.
func overrun(w World, row Row, p Params) []Candidate {
	ps := w.Places()
	var out []Candidate
	for _, r := range w.Awake() {
		if !w.Line(r, lineOverrun) {
			continue
		}
		near := withNeighbours(w, r)
		if !slices.ContainsFunc(ps, func(pl PlaceView) bool { return standing(pl) && slices.Contains(near, pl.Region) }) {
			continue
		}
		h := w.RegionHex(r)
		seat, ok := nearestTo(ps, h, func(pl PlaceView) bool { return pl.Region != r })
		if !ok {
			seat, _ = nearestTo(ps, h, func(PlaceView) bool { return true })
		}
		causes := recalled(w, p.MemoryDays, []string{memOverrun}, inRegions([]int{r}))
		out = append(out, candidate(seat.Hex, regionSet(append(near, seat.Region)...), w.Gauge(r, gaugeThreat), causes,
			bind("front", RegionRef(r)), seatAt(roleSeat, seat)))
	}
	return found(w, row, out)
}

// dryRegion is the dry seam: a region with scarcity's yields line active
// and a standing place in it, which is the seat (the nearest its centre).
func dryRegion(w World, row Row, p Params) []Candidate {
	ps := w.Places()
	var out []Candidate
	for _, r := range w.Awake() {
		if !w.Line(r, lineYields) {
			continue
		}
		seat, ok := nearestTo(ps, w.RegionHex(r), func(pl PlaceView) bool { return pl.Region == r })
		if !ok {
			continue
		}
		causes := recalled(w, p.MemoryDays, []string{memStarving}, inRegions([]int{r}))
		out = append(out, candidate(seat.Hex, withNeighbours(w, r), w.Gauge(r, gaugeScarcity), causes,
			bind("front", RegionRef(r)), seatAt(roleSeat, seat)))
	}
	return found(w, row, out)
}
