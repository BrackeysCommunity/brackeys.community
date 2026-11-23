package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// storyView is the bounded world the director's predicates read: every
// method costs at most the regions, factions, places, the memory ring or
// the pending queue. Game cannot be the view itself, since its fields
// Places and Pending would shadow the methods.
type storyView struct {
	g *Game
	// users is each place's users, counted once per view.
	users []int64
}

var (
	_ arc.World = (*storyView)(nil)
	_ arc.Extra = (*storyView)(nil)
)

// memStructureRaised is the memory kind the view reads raised structures from.
const memStructureRaised = "structure.raised"

// storyView is a fresh view of the game as it stands.
func (g *Game) storyView() *storyView { return &storyView{g: g} }

func (v *storyView) region(r int) *world.Region {
	if r < 0 || r >= len(v.g.World.Regions) {
		return nil
	}
	return &v.g.World.Regions[r]
}

func (v *storyView) Day() int64 { return v.g.Tick() / sheets.TicksPerDay }

func (v *storyView) Awake() []int {
	out := make([]int, len(v.g.World.Regions))
	for i := range out {
		out[i] = i
	}
	return out
}

func (v *storyView) Gauge(r int, gauge string) int64 {
	reg := v.region(r)
	gi, ok := v.g.World.GaugeOf(gauge)
	if reg == nil || !ok || gi >= len(reg.Gauge) {
		return 0
	}
	return reg.Gauge[gi]
}

func (v *storyView) Line(r int, line string) bool {
	reg := v.region(r)
	if reg == nil {
		return false
	}
	li := slices.IndexFunc(v.g.r.Book.GaugeLines, func(l sheets.GaugeLine) bool { return l.ID == line })
	return li >= 0 && li < len(reg.Active) && reg.Active[li]
}

func (v *storyView) Neighbours(r int) []int {
	if reg := v.region(r); reg != nil {
		return slices.Clone(reg.Neighbours)
	}
	return nil
}

func (v *storyView) Holder(r int) int {
	if reg := v.region(r); reg != nil {
		return reg.Holder
	}
	return -1
}

func (v *storyView) Defence(r int) int64 {
	if reg := v.region(r); reg != nil {
		return reg.Defence
	}
	return 0
}

func (v *storyView) RegionHex(r int) hex.Hex {
	if reg := v.region(r); reg != nil {
		return v.g.r.Gen.Region(reg.Lattice).Centre
	}
	return hex.Hex{}
}

func (v *storyView) RegionOf(h hex.Hex) int { return v.g.World.RegionAt(h) }

func (v *storyView) Factions() []arc.FactionView {
	w := v.g.World
	tagsOf := make(map[string][]string, len(v.g.r.Book.Archetypes))
	for _, a := range v.g.r.Book.Archetypes {
		tagsOf[a.ID] = a.Tags
	}
	held := make([][]int, len(w.Factions))
	for r := range w.Regions {
		if h := w.Regions[r].Holder; h >= 0 && h < len(held) {
			held[h] = append(held[h], r)
		}
	}
	out := make([]arc.FactionView, len(w.Factions))
	for i := range w.Factions {
		f := &w.Factions[i]
		fv := arc.FactionView{ID: i, Archetype: f.Archetype, Tags: slices.Clone(tagsOf[f.Archetype]), Seat: f.Seat, Holdings: held[i],
			Stock: f.Stock, Starving: f.Starving, Fallen: f.Fallen, Grudge: slices.Clone(f.Grudge), Disposition: slices.Clone(f.Disposition)}
		if f.Starving {
			// The day's count lands at day end; a faction starving since
			// earlier today has starved a day.
			fv.StarvingDays = 1
			if st := v.g.Story; st != nil && i < len(st.Starving) {
				fv.StarvingDays = max(st.Starving[i], 1)
			}
		}
		led := false
		for _, n := range f.Notables {
			lead := !led && !n.Dead && n.Role == world.RoleLeader
			led = led || lead
			fv.Notables = append(fv.Notables, arc.NotableView{ID: notableID(n.ID), Role: n.Role, Loyalty: n.Loyalty, Dead: n.Dead, Leading: lead})
		}
		out[i] = fv
	}
	return out
}

// notableID is a notable's id as facts and story actions name it.
func notableID(id int) string { return "n-" + strconv.Itoa(id) }

func (v *storyView) Places() []arc.PlaceView {
	g := v.g
	users := v.placeUsers()
	raised := map[hex.Hex]int64{}
	if g.Story != nil {
		for _, m := range g.Story.ring().of(memStructureRaised) {
			raised[m.At] = max(raised[m.At], m.Tick)
		}
	}
	out := make([]arc.PlaceView, len(g.Places))
	for n, p := range g.Places {
		pv := arc.PlaceView{N: n, Hex: p.Hex, Region: g.World.RegionAt(p.Hex), Guild: p.Guild, Chartered: p.Chartered(),
			Open: p.Ruined == 0, Ruined: p.Ruined != 0, City: g.isCity(n), Structures: int64(len(p.Structures)),
			Raised: raised[p.Hex], Users: users[n]}
		for _, st := range p.Structures {
			pv.Raised = max(pv.Raised, st.Built)
		}
		if ps := g.storyAt(n); ps != nil {
			pv.Lost = ps.Lost
		}
		out[n] = pv
	}
	return out
}

// placeUsers counts, once per view, each place's characters active within
// active-days who stood there within city-user-days.
func (v *storyView) placeUsers() []int64 {
	g := v.g
	if v.users != nil && len(v.users) == len(g.Places) {
		return v.users
	}
	v.users = make([]int64, len(g.Places))
	t := g.Tick()
	acted := t - g.r.Story.ActiveDays*sheets.TicksPerDay
	visited := t - g.sp("city-user-days")*sheets.TicksPerDay
	for _, c := range g.Chars {
		if c.Banned || c.Acted < acted {
			continue
		}
		for _, vs := range c.Visits {
			if vs.Tick >= visited && vs.Settlement >= 0 && vs.Settlement < len(v.users) {
				v.users[vs.Settlement]++
			}
		}
	}
	return v.users
}

func (v *storyView) Streak(r int, streak string) int64 {
	st := v.g.streakOf(r)
	if st == nil {
		return 0
	}
	switch streak {
	case arc.StreakProsper:
		return st.Prosper
	case arc.StreakCold:
		return st.Cold
	case arc.StreakWet:
		return st.Wet
	case arc.StreakLow:
		return st.Low
	}
	return 0
}

func (v *storyView) Recall(kind string, within int64) []arc.Memory {
	if v.g.Story == nil {
		return nil
	}
	from := v.Day() - within
	var out []arc.Memory
	for _, m := range v.g.Story.ring().of(kind) {
		if m.Tick/sheets.TicksPerDay >= from {
			out = append(out, m)
		}
	}
	return out
}

func (v *storyView) Pending(kind string) []arc.Pending {
	if v.g.Story == nil {
		return nil
	}
	var out []arc.Pending
	for _, p := range v.g.Story.Pending {
		if p.Kind == kind {
			out = append(out, p)
		}
	}
	return out
}

// Busy reports whether ref is resting at scope or bound by an open arc of
// that scope: in its cast, its regions, its place or its character.
func (v *storyView) Busy(scope string, ref fact.Ref) bool {
	s := v.g.Story
	if s == nil {
		return false
	}
	now := v.g.Tick()
	for _, r := range s.Rests {
		if r.Scope == scope && r.Ref == ref && r.Until > now {
			return true
		}
	}
	for _, a := range s.Arcs {
		if !a.over() && a.Scope == scope && a.binds(ref) {
			return true
		}
	}
	return false
}

// binds reports whether an arc holds ref in its cast, regions, place or
// character.
func (a *Arc) binds(ref fact.Ref) bool {
	if slices.ContainsFunc(a.Cast, func(b arc.Binding) bool { return b.Ref == ref }) {
		return true
	}
	if r, ok := arc.RefIndex(ref); ok && ref == arc.RegionRef(r) && slices.Contains(a.Regions, r) {
		return true
	}
	return (a.Place != "" && a.Place == ref.String()) || (a.Char != "" && ref == char.Ref(a.Char))
}

func (v *storyView) Core() (hex.Hex, bool) {
	if s := v.g.Story; s != nil && s.Ring != nil && s.Ring.Open != 0 {
		return s.Ring.Core, true
	}
	return hex.Hex{}, false
}

// NearestPlace is the standing place nearest h, the lowest index on a tie.
func (v *storyView) NearestPlace(h hex.Hex) (int, bool) {
	best := -1
	for n, p := range v.g.Places {
		if p.Ruined != 0 {
			continue
		}
		if best < 0 || hex.Distance(p.Hex, h) < hex.Distance(v.g.Places[best].Hex, h) {
			best = n
		}
	}
	return best, best >= 0
}

func (v *storyView) LineFrom(gauge string) int64 {
	var from int64
	found := false
	for _, l := range v.g.r.Book.GaugeLines {
		if l.Gauge == gauge && (!found || l.AtLeast < from) {
			from, found = l.AtLeast, true
		}
	}
	return from
}

func (v *storyView) Home(id string) (hex.Hex, bool) {
	if n := v.g.NPCs.Get(id); n != nil {
		return n.Stub.Home, true
	}
	return hex.Hex{}, false
}

func (v *storyView) Followed(n int) int64 {
	if ps := v.g.storyAt(n); ps != nil {
		return ps.Followed
	}
	return 0
}

func (v *storyView) Passages(n int) int64 {
	if n < 0 || n >= len(v.g.Places) {
		return 0
	}
	if t := v.g.World.Tile(v.g.Places[n].Hex); t != nil {
		return t.Season[tile.CounterPassage]
	}
	return 0
}

func (v *storyView) Herd(r int, hunt string) int64 {
	if v.region(r) == nil {
		return 0
	}
	i := slices.IndexFunc(v.g.r.Book.Hunts, func(h sheets.Hunt) bool { return h.ID == hunt })
	if i < 0 {
		return 0
	}
	_, pop, _ := v.g.herd(r, v.g.r.Book.Hunts[i].Creature)
	return pop
}

// storyAt is place n's story state, or nil while it has none.
func (g *Game) storyAt(n int) *PlaceStory {
	if g.Story == nil || n < 0 || n >= len(g.Story.At) {
		return nil
	}
	return &g.Story.At[n]
}

// placeStory is place n's story state, grown to reach it.
func (g *Game) placeStory(n int) *PlaceStory {
	if g.Story == nil || n < 0 || n >= len(g.Places) {
		return nil
	}
	if n >= len(g.Story.At) {
		g.Story.At = append(g.Story.At, make([]PlaceStory, n+1-len(g.Story.At))...)
	}
	return &g.Story.At[n]
}

// streakOf is region r's streaks, or nil before its first story day.
func (g *Game) streakOf(r int) *Streak {
	if g.Story == nil {
		return nil
	}
	i, ok := slices.BinarySearchFunc(g.Story.Streaks, r, streakRegion)
	if !ok {
		return nil
	}
	return &g.Story.Streaks[i]
}

// emergentView is the story view with what emergence adds (GDD 13): roads,
// caravans, legends and contests. Only a world keeping emergence is read
// through it.
type emergentView struct{ *storyView }

var _ arc.Emergent = emergentView{}

// directorView is the view the director casts from.
func (g *Game) directorView() arc.World {
	v := g.storyView()
	if g.Emergence == nil {
		return v
	}
	return emergentView{v}
}

func (v emergentView) RoadLoad(region int) (int64, hex.Hex, bool) {
	e := v.g.Emergence
	rl := e.RoadLoad[region]
	if rl == nil {
		return 0, hex.Hex{}, false
	}
	if _, ok := v.g.roadAt(rl.Busiest); !ok || v.warCast(region) {
		return 0, hex.Hex{}, false
	}
	return rl.Window.Sum(v.Day(), e.Season, v.g.r.Emerge.P.RoadWarDays), rl.Busiest, true
}

// warCast reports a road war cast on region's roads within road-war-days.
// The load that cast it is spent: neither side lowers a road's load, so
// without this the same load recasts the war after every rest.
func (v emergentView) warCast(region int) bool {
	if v.g.Story == nil {
		return false
	}
	since := (v.Day() - v.g.r.Emerge.P.RoadWarDays) * sheets.TicksPerDay
	for _, a := range v.g.Story.Arcs {
		if a.Began <= since || a.Scope != arc.Region {
			continue
		}
		if tpl, ok := v.g.template(a.Template); !ok || tpl.Row.When != arc.RoadBusy {
			continue
		}
		if ref, ok := a.Cast.Get(arc.RoleRoad); ok {
			if h, ok := v.g.refHexOf(ref); ok && v.g.World.RegionAt(h) == region {
				return true
			}
		}
	}
	return false
}

// Raider is the standing faction not holding region that holds a region
// whose centre is within rival-distance of its busiest road: the one with
// most holdings, the lowest index on a tie.
func (v emergentView) Raider(region int) (int, bool) {
	_, busiest, ok := v.RoadLoad(region)
	if !ok {
		return -1, false
	}
	w := v.g.World
	holder := v.Holder(region)
	held := make([]int, len(w.Factions))
	near := make([]bool, len(w.Factions))
	for r := range w.Regions {
		h := w.Regions[r].Holder
		if h < 0 || h >= len(held) {
			continue
		}
		held[h]++
		if h != holder && hex.Distance(v.RegionHex(r), busiest) <= v.g.r.Story.RivalDistance {
			near[h] = true
		}
	}
	best := -1
	for f := range w.Factions {
		if near[f] && !w.Factions[f].Fallen && (best < 0 || held[f] > held[best]) {
			best = f
		}
	}
	return best, best >= 0
}

func (v emergentView) Caravans() []arc.CaravanView {
	g := v.g
	t := g.Tick()
	out := make([]arc.CaravanView, 0, len(g.Emergence.Caravans))
	for _, cv := range g.Emergence.Caravans {
		at := g.caravanAt(cv, t)
		out = append(out, arc.CaravanView{ID: cv.ID, At: at, Ahead: g.caravanAhead(cv, at), To: cv.To, Halted: cv.Halted != 0})
	}
	return out
}

// roadsNear reports whether any road tile within road-in-reach of place n
// is open, and whether any is cut.
func (v emergentView) roadsNear(n int) (open, cut bool) {
	g := v.g
	if n < 0 || n >= len(g.Places) {
		return false, false
	}
	for _, h := range hex.DiscAt(g.Places[n].Hex, g.r.Emerge.P.RoadInReach) {
		if _, ok := g.roadAt(h); !ok {
			continue
		}
		if g.roadOpen(h) {
			open = true
		} else {
			cut = true
		}
	}
	return open, cut
}

func (v emergentView) RoadCut(place int) bool {
	open, cut := v.roadsNear(place)
	return cut && !open
}

func (v emergentView) RoadIn(place int) bool {
	if open, _ := v.roadsNear(place); open {
		return true
	}
	return slices.ContainsFunc(v.g.Emergence.Routes, func(rt *emerge.RouteRec) bool { return rt.A == place || rt.B == place })
}

// Legends are liveLegends, each marked Rested within legend-rest-days of its last cast.
func (v emergentView) Legends() []arc.LegendView {
	p := v.g.r.Emerge.P
	day := v.Day()
	var out []arc.LegendView
	for _, l := range v.g.liveLegends() {
		out = append(out, arc.LegendView{ID: l.ID, Region: l.Region, At: l.At, Rested: l.Cast != 0 && day < l.Cast+p.LegendRestDays})
	}
	return out
}

func (v emergentView) Contests() []arc.ContestView {
	var out []arc.ContestView
	for _, c := range v.g.contests() {
		if !c.Cast {
			out = append(out, arc.ContestView{A: c.A, B: c.B, SeatA: c.SeatA, SeatB: c.SeatB, Region: c.Region, Tag: c.Tag})
		}
	}
	return out
}
