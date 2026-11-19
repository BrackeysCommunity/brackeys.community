// Package npc is the people of the world (GDD 4.18). An NPC is only its
// keyed draw until someone talks to it; the first conversation saves it.
// Nothing here ticks: where an NPC is, what it knows and what it says are
// worked out when someone meets it, so a world of a million saved NPCs
// costs a world day what a world of ten does.
package npc

import (
	"cmp"
	"crypto/sha256"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
)

// Kinds of NPC.
const (
	Resident = "resident"
	Wanderer = "wanderer"
)

// Stub is an NPC as its draw makes it: nothing stored.
type Stub struct {
	ID     string   `json:"id"`
	Kind   string   `json:"kind"`
	Role   string   `json:"role"` // an npcs.roles row
	Name   string   `json:"name"`
	Traits []string `json:"traits"`
	Home   hex.Hex  `json:"home"`
}

// NPC is a saved NPC: its stub, its route, its memory and its meetings.
type NPC struct {
	Stub
	Seq        int64       `json:"seq"`
	Saved      int64       `json:"saved"` // tick
	Route      []hex.Hex   `json:"route"` // a loop through home, at most route-max tiles
	Laid       int64       `json:"laid"`  // tick the route was laid
	RouteTicks int64       `json:"routeTicks"`
	Memory     []Entry     `json:"memory"`  // the most salient entries, at most memory-cap
	Summary    tally.Tally `json:"summary"` // entries folded out of memory, by kind
	Met        []Meeting   `json:"met"`     // by player, sorted
	Visits     []string    `json:"visits"`  // players it wants a word with, sorted
}

// Ref is the fact ref of an NPC.
func Ref(id string) fact.Ref { return fact.Ref{Kind: "npc", ID: id} }

// Entry is one memory: a fact the NPC is a subject of, read through its
// salience.
type Entry struct {
	Kind   string `json:"kind"`             // greeted, asked, helped, wronged, traded, fought...
	Player string `json:"player,omitempty"` // whom it is about; "" for the world
	Weight int64  `json:"weight"`           // salience when written
	Tick   int64  `json:"tick"`
	Fact   int64  `json:"fact,omitempty"`
	Thing  string `json:"thing,omitempty"`
}

// Meeting is the last time a player met the NPC and what it said.
type Meeting struct {
	Player string `json:"player"`
	Tick   int64  `json:"tick"`
	Prev   int64  `json:"prev"` // the meeting before this one
	Count  int64  `json:"count"`
	Topic  string `json:"topic,omitempty"`
	Line   string `json:"line,omitempty"`
}

// Rules are the NPC sheets and the keys they draw under. Stubs draw on
// the generation key: who lives where is part of the world.
type Rules struct {
	roles   []sheets.NPCRole
	topics  []sheets.Topic
	params  []sheets.Param
	traits  []sheets.NPCTrait
	given   []string
	family  []string
	lists   map[string][]string
	gen     *draw.Drawer
	roll    *draw.Drawer
	perDay  int64
	traitsN int64
}

// structural: an NPC carries two traits, like a notable.
const traitsPer = 2

func New(b *sheets.Book, gen, roll draw.Key) *Rules {
	r := &Rules{roles: b.NPCRoles, topics: b.Topics, params: b.NPCParams, traits: b.NPCTraits,
		gen: draw.NewDrawer(gen), roll: draw.NewDrawer(roll), perDay: sheets.TicksPerDay, traitsN: traitsPer}
	r.lists = map[string][]string{}
	for _, p := range b.NameParts {
		r.lists[p.List] = append(r.lists[p.List], p.Text)
	}
	r.given, r.family = r.lists["notable-given"], r.lists["notable-family"]
	return r
}

// Name lists places are named from.
const (
	ListSettlement = "settlement"
	ListRegion     = "region"
)

// PlaceName is a place's plain name from the pack's head and tail lists,
// a keyed draw on its id.
func (r *Rules) PlaceName(list, id string) string {
	head, tail := r.lists[list+"-head"], r.lists[list+"-tail"]
	if len(head) == 0 || len(tail) == 0 {
		return id
	}
	who := draw.Str(id)
	return head[r.gen.Below(uint64(len(head)), "place.head", who)] + tail[r.gen.Below(uint64(len(tail)), "place.tail", who)]
}

// Param is an npcs.params cell.
func (r *Rules) Param(id string) int64 { return sheets.IntParam(r.params, id) }

// ParamF is an npcs.params cell as a fraction.
func (r *Rules) ParamF(id string) fixed.F { return sheets.ParamOf(r.params, id) }

// Topics are the topic rows.
func (r *Rules) Topics() []sheets.Topic { return r.topics }

// Role is an npcs.roles row.
func (r *Rules) Role(id string) *sheets.NPCRole {
	for i := range r.roles {
		if r.roles[i].ID == id {
			return &r.roles[i]
		}
	}
	return nil
}

// stub draws an NPC's name and traits from its id.
func (r *Rules) stub(id, kind, role string, home hex.Hex) Stub {
	who := draw.Str(id)
	s := Stub{ID: id, Kind: kind, Role: role, Home: home, Traits: []string{},
		Name: r.given[r.gen.Below(uint64(len(r.given)), "npc.given", who)] + " " + r.family[r.gen.Below(uint64(len(r.family)), "npc.family", who)]}
	for _, k := range r.gen.Shuffle(len(r.traits), "npc.traits", who) {
		if int64(len(s.Traits)) == r.traitsN {
			break
		}
		if t := r.traits[k]; !slices.Contains(s.Traits, t.Opposes) {
			s.Traits = append(s.Traits, t.ID)
		}
	}
	return s
}

// Residents are the role slots a place fills, as stubs: a keyed draw
// from the place's id.
func (r *Rules) Residents(place, placeID string, home hex.Hex) []Stub {
	var out []Stub
	for _, row := range r.roles {
		if row.Place != place {
			continue
		}
		for i := range row.Count {
			out = append(out, r.stub("r-"+placeID+"-"+row.ID+"-"+strconv.FormatInt(i, decimal), Resident, row.ID, home))
		}
	}
	return out
}

// structural: ids are written in decimal.
const decimal = 10

// MeetWanderer draws whether a wanderer is on a tile this world day, and
// who: a road role favoured by the tile's tags.
func (r *Rules) MeetWanderer(h hex.Hex, day int64, tileTags []string) (Stub, bool) {
	id := "w-" + h.Ref() + "-" + strconv.FormatInt(day, decimal)
	if !r.gen.Roll(r.ParamF("wanderer-chance"), "npc.wanderer", draw.Str(id)) {
		return Stub{}, false
	}
	var roles []string
	var weights []int64
	for _, row := range r.roles {
		if row.Place != "road" {
			continue
		}
		w := int64(1)
		for _, t := range row.Tags {
			if slices.Contains(tileTags, t) {
				w += favoured
			}
		}
		roles, weights = append(roles, row.ID), append(weights, w)
	}
	if len(roles) == 0 {
		return Stub{}, false
	}
	return r.stub(id, Wanderer, roles[r.gen.Pick(weights, "npc.wanderer-role", draw.Str(id))], h), true
}

// structural: a road role whose tag the tile holds is that much likelier.
const favoured = 2

// LayRoute lays a daily route: a loop from home through tiles within
// route-reach, at most route-max long, by a keyed walk over passable
// tiles. cost is what entering a tile takes, false where it cannot be.
func (r *Rules) LayRoute(n *NPC, tick int64, cost func(from, to hex.Hex) (int64, bool)) {
	reach, most := r.Param("route-reach"), r.Param("route-max")
	route := []hex.Hex{n.Home}
	at := n.Home
	var ticks int64
	for step := int64(1); int64(len(route)) < most; step++ {
		dirs := r.gen.Shuffle(hex.Directions, "npc.route", draw.Str(n.ID), draw.Int(tick), draw.Int(step))
		moved := false
		for _, d := range dirs {
			next := at.Neighbour(d)
			c, ok := cost(at, next)
			if !ok || hex.Distance(next, n.Home) > reach || slices.Contains(route, next) {
				continue
			}
			route, at, ticks, moved = append(route, next), next, ticks+c, true
			break
		}
		if !moved || hex.Distance(at, n.Home) == reach {
			break
		}
	}
	n.Route, n.Laid, n.RouteTicks = route, tick, ticks
}

// At is where a saved NPC is at a tick: a pure function of its route and
// the hour. It walks out along the route and back over the day.
func (r *Rules) At(n *NPC, tick int64) hex.Hex {
	if len(n.Route) <= 1 {
		return n.Home
	}
	loop := int64(len(n.Route))*halves - halves
	slot := (tick % r.perDay) * loop / r.perDay
	if slot >= int64(len(n.Route)) {
		slot = loop - slot
	}
	return n.Route[slot]
}

// structural: a route is walked out and back.
const halves = 2

// Salience is an entry's weight now: it falls by salience-decay a world
// day, at the personal share for what a player did to the NPC.
func (r *Rules) Salience(e Entry, now int64) int64 {
	days := max(0, now-e.Tick) / r.perDay
	decay := days * r.Param("salience-decay")
	if e.Player != "" {
		decay = fixed.PercentOf(decay, r.Param("personal-decay-share"))
	}
	return max(0, e.Weight-decay)
}

// Remember adds an entry and keeps the most salient memory-cap of them;
// the rest fold into the summary. A personal entry salient enough queues
// a visit to its player.
func (r *Rules) Remember(n *NPC, e Entry, now int64) {
	n.Memory = append(n.Memory, e)
	slices.SortStableFunc(n.Memory, func(a, b Entry) int {
		return cmp.Or(cmp.Compare(r.Salience(b, now), r.Salience(a, now)), cmp.Compare(b.Tick, a.Tick))
	})
	if over := int64(len(n.Memory)) - r.Param("memory-cap"); over > 0 {
		for _, x := range n.Memory[len(n.Memory)-int(over):] {
			n.Summary.Bump(x.Kind, 1)
		}
		n.Memory = n.Memory[:len(n.Memory)-int(over)]
	}
}

// Wants reports whether an entry is salient enough to queue a visit.
func (r *Rules) Wants(e Entry) bool { return e.Player != "" && e.Weight >= r.Param("visit-salience") }

// Meeting is a player's last meeting, or nil.
func (n *NPC) Meeting(player string) *Meeting {
	i, ok := slices.BinarySearchFunc(n.Met, player, func(m Meeting, p string) int { return cmp.Compare(m.Player, p) })
	if !ok {
		return nil
	}
	return &n.Met[i]
}

// Meet records a meeting.
func (n *NPC) Meet(player string, tick int64) *Meeting {
	i, ok := slices.BinarySearchFunc(n.Met, player, func(m Meeting, p string) int { return cmp.Compare(m.Player, p) })
	if !ok {
		n.Met = slices.Insert(n.Met, i, Meeting{Player: player})
	}
	m := &n.Met[i]
	m.Prev, m.Tick = m.Tick, tick
	m.Count++
	return m
}

// About is the most salient entry about a player of a kind, if any.
func (r *Rules) About(n *NPC, player, kind string, now int64) (Entry, bool) {
	var best Entry
	found := false
	for _, e := range n.Memory {
		if e.Player == player && e.Kind == kind && (!found || r.Salience(e, now) > r.Salience(best, now)) {
			best, found = e, true
		}
	}
	return best, found
}

// Dormant reports whether nobody has met the NPC for dormant-days.
func (r *Rules) Dormant(n *NPC, now int64) bool {
	last := n.Saved
	for _, m := range n.Met {
		last = max(last, m.Tick)
	}
	return now-last > r.Param("dormant-days")*r.perDay
}

// Wake folds a dormant NPC's memory into its summary.
func (r *Rules) Wake(n *NPC) {
	for _, e := range n.Memory {
		n.Summary.Bump(e.Kind, 1)
	}
	n.Memory = []Entry{}
}

// Field is one {key} a templated line fills.
type Field struct{ Key, Value string }

// Line fills a templated line from fields.
func Line(tmpl string, fields ...Field) string {
	for _, f := range fields {
		tmpl = strings.ReplaceAll(tmpl, "{"+f.Key+"}", f.Value)
	}
	return tmpl
}

// Book is every saved NPC, in save order, and the index from a tile to
// the routes through it. Its chain names every save, so a game's digest
// covers the book without reading it.
type Book struct {
	List   []*NPC    `json:"list"` // by Seq
	Chain  canon.Sum `json:"chain"`
	ids    []idSeq   // by stub id
	index  []stop    // by tile, then seq
	visits []visit   // by player, then seq
	dirty  []int64   // seqs changed since the last flush
}

type visit struct {
	Player string
	Seq    int64
}

func cmpVisit(a, b visit) int {
	return cmp.Or(cmp.Compare(a.Player, b.Player), cmp.Compare(a.Seq, b.Seq))
}

// Queue records that an NPC wants a word with a player.
func (b *Book) Queue(n *NPC, player string) {
	if i, ok := slices.BinarySearch(n.Visits, player); !ok {
		n.Visits = slices.Insert(n.Visits, i, player)
	}
	if i, ok := slices.BinarySearchFunc(b.visits, visit{player, n.Seq}, cmpVisit); !ok {
		b.visits = slices.Insert(b.visits, i, visit{player, n.Seq})
	}
}

// Visited clears a queued visit once the player has met the NPC.
func (b *Book) Visited(n *NPC, player string) {
	if i, ok := slices.BinarySearch(n.Visits, player); ok {
		n.Visits = slices.Delete(n.Visits, i, i+1)
	}
	if i, ok := slices.BinarySearchFunc(b.visits, visit{player, n.Seq}, cmpVisit); ok {
		b.visits = slices.Delete(b.visits, i, i+1)
	}
}

// Visiting are the NPCs that want a word with a player, by the index.
func (b *Book) Visiting(player string) []*NPC {
	i, _ := slices.BinarySearchFunc(b.visits, visit{player, 0}, cmpVisit)
	var out []*NPC
	for ; i < len(b.visits) && b.visits[i].Player == player; i++ {
		out = append(out, b.BySeq(b.visits[i].Seq))
	}
	return out
}

// Flush hands over the NPCs changed since the last flush, for a store.
func (b *Book) Flush() []*NPC {
	slices.Sort(b.dirty)
	var out []*NPC
	for _, seq := range slices.Compact(b.dirty) {
		out = append(out, b.BySeq(seq))
	}
	b.dirty = nil
	return out
}

type idSeq struct {
	ID  string
	Seq int64
}

type stop struct {
	H   hex.Hex
	Seq int64
}

func cmpStop(a stop, b stop) int {
	return cmp.Or(cmp.Compare(a.H.Q, b.H.Q), cmp.Compare(a.H.R, b.H.R), cmp.Compare(a.Seq, b.Seq))
}

// Len is how many NPCs are saved.
func (b *Book) Len() int { return len(b.List) }

// Rebuild makes the lookups a decoded book needs.
func (b *Book) Rebuild() {
	b.ids, b.index, b.visits = make([]idSeq, 0, len(b.List)), nil, nil
	for _, n := range b.List {
		b.ids = append(b.ids, idSeq{n.ID, n.Seq})
		for _, h := range n.Route {
			b.index = append(b.index, stop{h, n.Seq})
		}
		for _, p := range n.Visits {
			b.visits = append(b.visits, visit{p, n.Seq})
		}
	}
	slices.SortFunc(b.ids, func(a, c idSeq) int { return cmp.Compare(a.ID, c.ID) })
	slices.SortFunc(b.index, cmpStop)
	b.index = slices.Compact(b.index)
	slices.SortFunc(b.visits, cmpVisit)
}

// BySeq finds a saved NPC.
func (b *Book) BySeq(seq int64) *NPC {
	i, ok := slices.BinarySearchFunc(b.List, seq, func(n *NPC, s int64) int { return cmp.Compare(n.Seq, s) })
	if !ok {
		return nil
	}
	return b.List[i]
}

// Get finds a saved NPC by its stub id.
func (b *Book) Get(id string) *NPC {
	i, ok := slices.BinarySearchFunc(b.ids, id, func(x idSeq, id string) int { return cmp.Compare(x.ID, id) })
	if !ok {
		return nil
	}
	return b.BySeq(b.ids[i].Seq)
}

// Save stores a stub as a saved NPC with its route, or returns the one
// already saved.
func (b *Book) Save(s Stub, tick int64) *NPC {
	if n := b.Get(s.ID); n != nil {
		return n
	}
	n := &NPC{Stub: s, Seq: int64(len(b.List)) + 1, Saved: tick, Memory: []Entry{}, Met: []Meeting{}, Visits: []string{}}
	b.List = append(b.List, n)
	i, _ := slices.BinarySearchFunc(b.ids, s.ID, func(x idSeq, id string) int { return cmp.Compare(x.ID, id) })
	b.ids = slices.Insert(b.ids, i, idSeq{s.ID, n.Seq})
	return n
}

// Routed indexes a saved NPC's route, after it is laid or relaid.
func (b *Book) Routed(n *NPC, old []hex.Hex) {
	for _, h := range old {
		if i, ok := slices.BinarySearchFunc(b.index, stop{h, n.Seq}, cmpStop); ok {
			b.index = slices.Delete(b.index, i, i+1)
		}
	}
	for _, h := range n.Route {
		if i, ok := slices.BinarySearchFunc(b.index, stop{h, n.Seq}, cmpStop); !ok {
			b.index = slices.Insert(b.index, i, stop{h, n.Seq})
		}
	}
}

// Through are the saved NPCs whose routes pass a tile, by the index:
// nobody is walked.
func (b *Book) Through(h hex.Hex) []*NPC {
	i, _ := slices.BinarySearchFunc(b.index, stop{h, 0}, cmpStop)
	var out []*NPC
	for ; i < len(b.index) && b.index[i].H == h; i++ {
		out = append(out, b.BySeq(b.index[i].Seq))
	}
	return out
}

// Touched chains an NPC's new state into the book's chain.
func (b *Book) Touched(n *NPC) error {
	body, err := canon.Marshal(n)
	if err != nil {
		return err
	}
	h := sha256.New()
	h.Write(b.Chain[:])
	h.Write(body)
	copy(b.Chain[:], h.Sum(nil))
	b.dirty = append(b.dirty, n.Seq)
	return nil
}
