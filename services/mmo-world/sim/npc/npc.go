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
	Stub       Stub        `json:"stub"`
	Seq        int64       `json:"seq"`
	Saved      int64       `json:"saved"` // tick
	Route      []hex.Hex   `json:"route"` // a loop through home, at most route-max tiles
	Laid       int64       `json:"laid"`  // tick the route is walked from
	RouteTicks int64       `json:"routeTicks"`
	Longer     int64       `json:"longer,omitempty"` // per cent longer the last route took when relaid than when laid
	Memory     []Entry     `json:"memory"`           // the most salient entries, at most memory-cap
	Summary    tally.Tally `json:"summary"`          // entries folded out of memory, by kind
	Met        []Meeting   `json:"met"`              // by player, sorted
	Visits     []string    `json:"visits"`           // players it wants a word with, sorted
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
	N      int64  `json:"n,omitempty"` // a quantity the entry is about, as coin made on a resale
}

// Meeting is the last time a player met the NPC and what it said.
type Meeting struct {
	Player string `json:"player"`
	Tick   int64  `json:"tick"`
	Prev   int64  `json:"prev"` // the meeting before this one
	Count  int64  `json:"count"`
	Topic  string `json:"topic,omitempty"`
	Line   string `json:"line,omitempty"`
	// Day and Answered are the world day and the topics the player
	// answered on it: a topic is answered once a day.
	Day      int64    `json:"day,omitempty"`
	Answered []string `json:"answered,omitempty"`
}

// HasAnswered reports whether the player answered a topic on a day.
func (m *Meeting) HasAnswered(topic string, day int64) bool {
	return m.Day == day && slices.Contains(m.Answered, topic)
}

// Answer records an answered topic and what the NPC said.
func (m *Meeting) Answer(topic, line string, day int64) {
	if m.Day != day {
		m.Day, m.Answered = day, nil
	}
	m.Answered = append(m.Answered, topic)
	m.Topic, m.Line = topic, line
}

// Rules are the NPC sheets and the keys they draw under. Stubs draw on
// the generation key: who lives where is part of the world.
type Rules struct {
	roles   []sheets.NPCRole
	topics  []sheets.Topic
	params  []sheets.Param
	traits  []sheets.NPCTrait
	gossip  []sheets.Gossip
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
	r := &Rules{roles: b.NPCRoles, topics: b.Topics, params: b.NPCParams, traits: b.NPCTraits, gossip: b.Gossip,
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

// Choice is a topic's choice row.
func (r *Rules) Choice(topic, choice string) (sheets.TopicChoice, bool) {
	for _, t := range r.topics {
		if t.ID != topic {
			continue
		}
		for _, ch := range t.Choices {
			if ch.ID == choice {
				return ch, true
			}
		}
	}
	return sheets.TopicChoice{}, false
}

// Role is an npcs.roles row.
func (r *Rules) Role(id string) *sheets.NPCRole {
	for i := range r.roles {
		if r.roles[i].ID == id {
			return &r.roles[i]
		}
	}
	return nil
}

// Draw is what a tile's stored content gives its people's draws; a zero
// Draw draws as before content came from history (GDD 4.17).
type Draw struct {
	Key    string
	Traits []int64 // weights per npcs.traits row; nil: even
	Roles  []int64 // multipliers per road role, in npcs.roles order; nil: even
}

// TraitIDs are the npcs.traits rows, in sheet order.
func (r *Rules) TraitIDs() []string {
	out := make([]string, len(r.traits))
	for i, t := range r.traits {
		out[i] = t.ID
	}
	return out
}

// RoadRoles are the roles a wanderer can have, in sheet order.
func (r *Rules) RoadRoles() []string {
	var out []string
	for _, row := range r.roles {
		if row.Place == placeRoad {
			out = append(out, row.ID)
		}
	}
	return out
}

// placeRoad is the npcs.roles place wanderers come from.
const placeRoad = "road"

// stub draws an NPC's name and traits from its id, and from the stored
// content's key once its tile has one.
func (r *Rules) stub(id, kind, role string, home hex.Hex, d Draw) Stub {
	if d.Key != "" {
		return r.drawnStub(id, kind, role, home, d)
	}
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

// drawnStub is a stub under the content labels: traits are a weighted
// pick without replacement that never takes an opposed pair. Should the
// weights leave nothing to take, the rest are taken evenly, so a stub
// always carries traitsPer.
func (r *Rules) drawnStub(id, kind, role string, home hex.Hex, d Draw) Stub {
	who := []draw.Part{draw.Str(id), draw.Str(d.Key)}
	s := Stub{ID: id, Kind: kind, Role: role, Home: home, Traits: []string{},
		Name: r.given[r.gen.Below(uint64(len(r.given)), "content.npc.given", who...)] + " " + r.family[r.gen.Below(uint64(len(r.family)), "content.npc.family", who...)]}
	st := r.gen.Stream("content.npc.traits", who...)
	clashes := func(t sheets.NPCTrait) bool {
		return slices.Contains(s.Traits, t.ID) || slices.Contains(s.Traits, t.Opposes) ||
			slices.ContainsFunc(s.Traits, func(c string) bool { return r.opposes(c) == t.ID })
	}
	for int64(len(s.Traits)) < r.traitsN {
		weighted, even := make([]int64, len(r.traits)), make([]int64, len(r.traits))
		var total, open int64
		for i, t := range r.traits {
			if clashes(t) {
				continue
			}
			even[i], weighted[i], open = 1, 1, open+1
			if len(d.Traits) == len(r.traits) {
				weighted[i] = d.Traits[i]
			}
			total += weighted[i]
		}
		if open == 0 {
			break
		}
		if total == 0 {
			weighted = even
		}
		s.Traits = append(s.Traits, r.traits[st.Pick(weighted)].ID)
	}
	return s
}

// opposes is the trait a trait opposes, if any.
func (r *Rules) opposes(trait string) string {
	for _, t := range r.traits {
		if t.ID == trait {
			return t.Opposes
		}
	}
	return ""
}

// Residents are the role slots a place fills, as stubs: a keyed draw
// from the place's id. Ids never depend on the draw, so saved NPCs and
// the trader stay who they are.
func (r *Rules) Residents(place, placeID string, home hex.Hex, d Draw) []Stub {
	var out []Stub
	for _, row := range r.roles {
		if row.Place != place {
			continue
		}
		for i := range row.Count {
			out = append(out, r.stub("r-"+placeID+"-"+row.ID+"-"+strconv.FormatInt(i, decimal), Resident, row.ID, home, d))
		}
	}
	return out
}

// structural: ids are written in decimal.
const decimal = 10

// MeetWanderer draws whether a wanderer is on a tile this world day, and
// who: a road role favoured by the tile's tags and, once the tile has
// content, by the history it was drawn under.
func (r *Rules) MeetWanderer(h hex.Hex, day int64, tileTags []string, d Draw) (Stub, bool) {
	id := "w-" + h.Ref() + "-" + strconv.FormatInt(day, decimal)
	who := []draw.Part{draw.Str(id)}
	meet, pick := draw.Purpose("npc.wanderer"), draw.Purpose("npc.wanderer-role")
	if d.Key != "" {
		who = append(who, draw.Str(d.Key))
		meet, pick = "content.wanderer", "content.wanderer-role"
	}
	if !r.gen.Roll(r.ParamF("wanderer-chance"), meet, who...) {
		return Stub{}, false
	}
	var roles []string
	var weights []int64
	for _, row := range r.roles {
		if row.Place != placeRoad {
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
	if len(d.Roles) == len(weights) {
		shifted := make([]int64, len(weights))
		some := false
		for i, w := range weights {
			shifted[i] = w * d.Roles[i]
			some = some || shifted[i] > 0
		}
		if some {
			weights = shifted
		}
	}
	return r.stub(id, Wanderer, roles[r.gen.Pick(weights, pick, who...)], h, d), true
}

// structural: a road role whose tag the tile holds is that much likelier.
const favoured = 2

// LayRoute lays a daily route: a loop from home through tiles within
// route-reach, at most route-max long, by a keyed walk over passable
// tiles. cost is what entering a tile takes, false where it cannot be.
func (r *Rules) LayRoute(n *NPC, tick int64, cost func(from, to hex.Hex) (int64, bool)) {
	reach, most := r.Param("route-reach"), r.Param("route-max")
	route := []hex.Hex{n.Stub.Home}
	at := n.Stub.Home
	var ticks int64
	for step := int64(1); int64(len(route)) < most; step++ {
		dirs := r.gen.Shuffle(hex.Directions, "npc.route", draw.Str(n.Stub.ID), draw.Int(tick), draw.Int(step))
		moved := false
		for _, d := range dirs {
			next := at.Neighbour(d)
			c, ok := cost(at, next)
			if !ok || hex.Distance(next, n.Stub.Home) > reach || slices.Contains(route, next) {
				continue
			}
			route, at, ticks, moved = append(route, next), next, ticks+c, true
			break
		}
		if !moved || hex.Distance(at, n.Stub.Home) == reach {
			break
		}
	}
	n.Route, n.Laid, n.RouteTicks = route, tick, ticks
}

// Due reports whether a route has stood its week and waits to be relaid
// at the NPC's next meeting.
func (r *Rules) Due(n *NPC, tick int64) bool {
	return tick-n.Laid >= r.Param("relay-days")*r.perDay
}

// Relay measures how much longer a due route takes now than when it was
// laid, and lays it afresh to be walked from the next morning. Nothing
// relays a route but a meeting, so a week costs the same however many
// NPCs are saved. It reports whether the route was due.
func (r *Rules) Relay(n *NPC, tick int64, cost func(from, to hex.Hex) (int64, bool)) bool {
	if !r.Due(n, tick) {
		return false
	}
	var now int64
	for i := 1; i < len(n.Route); i++ {
		c, _ := cost(n.Route[i-1], n.Route[i])
		now += c
	}
	n.Longer = 0
	if n.RouteTicks > 0 && now > n.RouteTicks {
		n.Longer = (now - n.RouteTicks) * fixed.Hundredths / n.RouteTicks
	}
	r.LayRoute(n, (tick/r.perDay+1)*r.perDay, cost)
	return true
}

// Move gives an NPC a new home and a route from it.
func (r *Rules) Move(n *NPC, to hex.Hex, tick int64, cost func(from, to hex.Hex) (int64, bool)) {
	n.Stub.Home, n.Longer = to, 0
	r.LayRoute(n, tick, cost)
}

// At is where a saved NPC is at a tick: a pure function of its route and
// the hour. It walks out along the route and back over the day, and keeps
// to its home before a relaid route's first morning and once the route is
// due, so relaying one never moves an NPC out of a meeting.
func (r *Rules) At(n *NPC, tick int64) hex.Hex {
	if len(n.Route) <= 1 || tick < n.Laid || r.Due(n, tick) {
		return n.Stub.Home
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

// Heard is the most salient thing an NPC hears of its neighbours: an entry
// of a kind npcs.gossip voices from another NPC's memory, at gossip-share
// of its salience. Gossip is read and never remembered, so it travels one
// hop.
func (r *Rules) Heard(neighbours []*NPC, now int64) (who *NPC, e Entry, salience int64, ok bool) {
	share := r.Param("gossip-share")
	for _, o := range neighbours {
		for _, x := range o.Memory {
			if _, voiced := r.GossipLine(x.Kind); !voiced {
				continue
			}
			if s := fixed.PercentOf(r.Salience(x, now), share); s > salience {
				who, e, salience, ok = o, x, s, true
			}
		}
	}
	return who, e, salience, ok
}

// GossipLine is the line a kind of memory is passed on with, if any.
func (r *Rules) GossipLine(kind string) (string, bool) {
	for _, row := range r.gossip {
		if row.ID == kind {
			return row.Line, true
		}
	}
	return "", false
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
		b.ids = append(b.ids, idSeq{n.Stub.ID, n.Seq})
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

// Homed are the saved NPCs whose home a tile is, by the route index.
func (b *Book) Homed(h hex.Hex) []*NPC {
	return slices.DeleteFunc(b.Through(h), func(n *NPC) bool { return n.Stub.Home != h })
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
