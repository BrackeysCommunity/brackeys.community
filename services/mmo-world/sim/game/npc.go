package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/history"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// Commands of a conversation, and a player's naming consent (GDD 4.18).
const (
	Talk    = "talk"
	Choose  = "choose"
	Consent = "consent"
)

// News is a heavy fact kept in memory for NPC topics: the last news-kept
// of weight news-weight or more.
type News struct {
	ID     fact.ID `json:"id"`
	Tick   int64   `json:"tick"`
	Kind   string  `json:"kind"`
	Region string  `json:"region,omitempty"`
	At     hex.Hex `json:"at"`
	Weight int64   `json:"weight"`
	// Placeless news happened nowhere in particular, so it is never local.
	Placeless bool `json:"placeless,omitempty"`
}

// keepNews counts fs toward emergence's traces, adds the heavy facts among
// them (and among what the trace hooks wrote) to the news ring, counts what
// they built towards crowding, and hands them to the story's memory.
func (g *Game) keepNews(fs []fact.Fact) {
	fs = g.traceNews(fs)
	line, kept := g.NewsWeight(), g.r.wp("news-kept")
	for _, f := range fs {
		g.countBuilt(f)
		// News is told to anyone, so a thread's facts never join it.
		if f.Weight < line || ThreadFact(f.Kind) {
			continue
		}
		at, ok := g.World.FactAt(f)
		n := News{ID: f.ID, Tick: f.Tick, Kind: f.Kind, Region: f.Region, At: at, Weight: f.Weight, Placeless: !ok}
		g.News = append(g.News, n)
	}
	if over := int64(len(g.News)) - kept; over > 0 {
		g.News = slices.Delete(g.News, 0, int(over))
	}
	g.noteStory(fs)
}

// Person is someone a character can talk to on a tile now.
type Person struct {
	npc.Stub
	Saved bool `json:"saved"`
	Visit bool `json:"visit"` // it has queued a visit to this character
	// Called is an NPC that came to this tile to find the character.
	Called bool `json:"called,omitempty"`
	// Leaning is how it leans; Mood how it holds the character; Fence: a
	// den's fence, who buys hot goods (GDD 4.18, 4.5).
	Leaning string `json:"leaning,omitempty"`
	Mood    string `json:"mood,omitempty"`
	Fence   bool   `json:"fence,omitempty"`
}

// PeopleHere are the NPCs on a tile at this hour: a settlement's
// residents at home or on their routes, saved NPCs whose routes pass now,
// those calling on the character, and the day's wanderer. A den's fence
// is there only for a character who can find it, and the syndicate's
// notables only for the made (GDD 4.5). Nothing is walked: the route
// index answers.
func (g *Game) PeopleHere(c *Char, h hex.Hex) []Person {
	t := g.Tick()
	fenceSeen, made := g.FenceVisible(c), char.IsMade(c.C)
	var out []Person
	seen := func(id string) bool { return slices.ContainsFunc(out, func(p Person) bool { return p.ID == id }) }
	hidden := func(s npc.Stub) bool {
		fence, notable := g.syndicateRole(s.Role)
		return (fence && !fenceSeen) || (notable && !made)
	}
	person := func(s npc.Stub, n *npc.NPC) Person {
		fence, _ := g.syndicateRole(s.Role)
		p := Person{Stub: s, Saved: n != nil, Leaning: g.LeaningOf(s), Mood: g.moodOf(g.disposition(c, s, n, t)), Fence: fence}
		if n != nil {
			p.Visit, p.Called = slices.Contains(n.Visits, c.C.ID), c.calling(s.ID, h)
		}
		return p
	}
	add := func(n *npc.NPC) {
		if !seen(n.Stub.ID) && !hidden(n.Stub) {
			out = append(out, person(n.Stub, n))
		}
	}
	stub := func(s npc.Stub) {
		if n := g.NPCs.Get(s.ID); n != nil {
			if g.r.NPC.At(n, t) == h {
				add(n)
			}
		} else if !seen(s.ID) && !hidden(s) {
			out = append(out, person(s, nil))
		}
	}
	if g.IsSettlement(h) {
		for _, s := range g.r.NPC.Residents(gen.PlaceSettlement, h.Ref(), h, g.npcDraw(h)) {
			stub(s)
		}
		if d, ok := g.DenAt(h); ok && fenceSeen {
			if s, ok := g.fenceStub(d.Origin); ok {
				stub(s)
			}
		}
		if made {
			for _, s := range g.SyndicateNotables() {
				if g.NPCs.Get(s.ID) != nil || s.Home == h {
					stub(s)
				}
			}
		}
	}
	for _, n := range g.NPCs.Through(h) {
		if g.r.NPC.At(n, t) == h {
			add(n)
		}
	}
	for _, x := range c.Callers {
		if n := g.NPCs.Get(x.NPC); n != nil && c.calling(x.NPC, h) {
			add(n)
		}
	}
	if s, ok := g.wanderer(h, t); ok && !seen(s.ID) && g.NPCs.Get(s.ID) == nil {
		out = append(out, person(s, nil))
	}
	return out
}

func (g *Game) wanderer(h hex.Hex, t int64) (npc.Stub, bool) {
	b := g.r.Gen.Baseline(h)
	if g.IsSettlement(h) || !g.r.Gen.Passable(b.Terrain) {
		return npc.Stub{}, false
	}
	var tileTags []string
	for _, x := range g.World.Place(h).Tags() {
		tileTags = append(tileTags, string(x))
	}
	return g.r.NPC.MeetWanderer(h, t/sheets.TicksPerDay, tileTags, g.npcDraw(h))
}

// npcDraw is what a tile's stored content gives the draws of the people
// met there. A tile nobody has reached, or one frozen from before content
// came from history, has no key and draws as it always did.
func (g *Game) npcDraw(h hex.Hex) npc.Draw {
	c, ok := g.Content(h)
	if !ok || c == nil || c.Key == "" {
		return npc.Draw{}
	}
	var d history.Digest
	if c.Digest != nil {
		d = *c.Digest
	}
	traits := g.r.NPC.TraitIDs()
	base := make([]int64, len(traits))
	for i := range base {
		base[i] = sheets.IntParam(g.r.Book.MapParams, "content-trait-weight")
	}
	roles := g.r.NPC.RoadRoles()
	even := make([]int64, len(roles))
	for i := range even {
		even[i] = 1
	}
	return npc.Draw{
		Key:    c.Key,
		Traits: g.r.Gen.Weights(gen.TableTrait, traits, base, d, ""),
		Roles:  g.r.Gen.Weights(gen.TableRole, roles, even, d, ""),
	}
}

// Visitors are the saved NPCs that want a word with a character.
func (g *Game) Visitors(c *Char) []*npc.NPC { return g.NPCs.Visiting(c.C.ID) }

// talk opens a conversation: the NPC is saved on its first, the meeting
// is recorded, and a first meeting may set off recognised (GDD 8.6).
func (g *Game) talk(c *Char, cmd Command) error {
	if err := canTrade(c); err != nil {
		return err
	}
	people := g.PeopleHere(c, c.C.At)
	i := slices.IndexFunc(people, func(p Person) bool { return p.ID == cmd.NPC })
	if i < 0 {
		return refuse(NotHere, "%s is not here", cmd.NPC)
	}
	p := people[i]
	t := g.Tick()
	n := g.NPCs.Get(p.ID)
	if n == nil {
		n = g.NPCs.Save(p.Stub, t)
		old := n.Route
		g.r.NPC.LayRoute(n, t, g.routeCost)
		g.NPCs.Routed(n, old)
	} else {
		if _, err := g.wake(n, t); err != nil {
			return err
		}
		g.relay(n, t)
	}
	first := n.Meeting(c.C.ID) == nil
	n.Meet(c.C.ID, t)
	g.NPCs.Visited(n, c.C.ID)
	c.C.Meet(char.Met{Who: npcPrefix + n.Stub.ID, How: char.MetMet, Tick: t}, g.r.limits)
	if _, err := g.npcFact(c, n, "npc.met", t, fact.B("first", first)); err != nil {
		return err
	}
	if first && g.recognised(c, n) {
		tr := g.trigger(TrigKnown)
		g.standing(c, n, tr.Magnitude)
		if _, err := g.npcFact(c, n, "trigger.fired", t, fact.S("trigger", TrigKnown), fact.N("standing", tr.Magnitude)); err != nil {
			return err
		}
	}
	g.drawLeaning(n)
	for _, hook := range meetHooks {
		if err := hook(g, c, n, t); err != nil {
			return err
		}
	}
	return g.NPCs.Touched(n)
}

// routeCost is what a route steps through: tiles the world knows.
func (g *Game) routeCost(from, to hex.Hex) (int64, bool) {
	if g.World.RegionAt(to) < 0 {
		return 0, false
	}
	return g.World.EnterTicks(from, to)
}

// roleTrades are the slots an NPC's role knows by sight.
var roleTrades = map[string][]string{
	"settlement-smith": {"blade", "tool", "hook"}, "settlement-tinker": {"focus"}, "settlement-stablehand": {"tack"},
	"road-scrapper": {"blade", "tool", "hook", "focus"}, "holding-quartermaster": {"blade", "plate"},
}

// recognised is the held-item check a first meeting makes.
func (g *Game) recognised(c *Char, n *npc.NPC) bool {
	slots := roleTrades[n.Stub.Role]
	return slices.ContainsFunc(c.C.Equipped, func(e char.Equipped) bool {
		in := c.C.Item(e.Item)
		if in == nil {
			return false
		}
		k, ok := g.Kinds.Kind(in.Kind)
		return ok && slices.Contains(slots, k.Slot)
	})
}

// standingKey is whose standing an NPC's choices move: the syndicate's
// for its own, else the faction holding its home region, else its
// settlement.
func (g *Game) standingKey(n *npc.NPC) string { return g.factionKeyOf(n.Stub) }

// StandingName resolves persisted standings for display.
func (g *Game) StandingName(key string) string {
	fi, place, ok := parseStandingKey(key)
	switch {
	case key == syndicateKey:
		return g.r.Name("factions.archetypes:" + syndicateKey)
	case !ok:
	case fi == econ.Keepers:
		return g.PlaceName(place)
	case fi < len(g.World.Factions):
		return g.FactionName(fi)
	}
	return key
}

func (g *Game) standing(c *Char, n *npc.NPC, by int64) {
	gp := g.r.Growth.Params()
	c.C.AdjustStanding(g.standingKey(n), by, sheets.IntParam(gp, "standing-min"), sheets.IntParam(gp, "standing-max"))
}

func (g *Game) npcFact(c *Char, n *npc.NPC, kind string, t int64, data ...fact.Datum) (fact.Fact, error) {
	return g.factWith(c, []fact.Ref{npc.Ref(n.Stub.ID)}, kind, t, data...)
}

// TopicView is one topic as a conversation offers it.
type TopicView struct {
	ID       string       `json:"id"`
	Line     string       `json:"line"`
	Own      bool         `json:"own"` // drawn from this player's history with the NPC
	Salience int64        `json:"salience"`
	Choices  []ChoiceView `json:"choices"`
}

// ChoiceView is a choice and what it does.
type ChoiceView struct {
	ID       string `json:"id"`
	Line     string `json:"line"`
	Effect   string `json:"effect"`
	Standing int64  `json:"standing,omitempty"`
	Coin     int64  `json:"coin,omitempty"`
}

// Conversation is the dossier's picked topics, voiced by templates. The
// digest names the dossier, so asking again the same world day gives the
// same conversation (GDD 4.18).
type Conversation struct {
	NPC    npc.Stub    `json:"npc"`
	Topics []TopicView `json:"topics"`
	Last   string      `json:"last,omitempty"` // what it said to this player last time
	Digest string      `json:"digest"`
	Met    int64       `json:"met"` // meetings with this player
}

// Converse builds a saved NPC's conversation with a character.
func (g *Game) Converse(c *Char, id string) (Conversation, error) {
	n := g.NPCs.Get(id)
	if n == nil {
		return Conversation{}, refuse(NotHere, "%s has not been spoken to", id)
	}
	day := g.Tick() / sheets.TicksPerDay
	cands := g.Candidates(c, n)
	cands = cands[:min(len(cands), int(g.r.NPC.Param("topics-shown")))]
	out := Conversation{NPC: n.Stub, Topics: cands}
	if m := n.Meeting(c.C.ID); m != nil {
		out.Last, out.Met = m.Line, m.Count
	}
	sum, err := canon.Digest(struct {
		NPC    string
		Player string
		Day    int64
		Topics []TopicView
	}{n.Stub.ID, c.C.ID, day, cands})
	out.Digest = sum.String()
	return out, err
}

// Candidates are every topic whose predicate holds for a character and a
// saved NPC now, most salient first: the dossier's topics before any is
// picked.
func (g *Game) Candidates(c *Char, n *npc.NPC) []TopicView {
	t := g.Tick()
	var cands []TopicView
	for _, row := range g.r.NPC.Topics() {
		if v, ok := g.topic(c, n, row, t); ok {
			cands = append(cands, v)
		}
	}
	day := t / sheets.TicksPerDay
	slices.SortStableFunc(cands, func(a, b TopicView) int {
		return cmp.Or(cmp.Compare(b.Salience, a.Salience), cmp.Compare(g.tieBreak(n, c, day, a.ID), g.tieBreak(n, c, day, b.ID)))
	})
	return cands
}

func (g *Game) tieBreak(n *npc.NPC, c *Char, day int64, topic string) uint64 {
	return g.r.draw.Draw("npc.pick", draw.Str(n.Stub.ID), draw.Str(c.C.ID), draw.Int(day), draw.Str(topic))
}

// topic tests one topic's predicate against what the NPC remembers and
// knows now, and voices it from fields.
func (g *Game) topic(c *Char, n *npc.NPC, row sheets.Topic, t int64) (TopicView, bool) {
	fields := []npc.Field{{Key: "npc", Value: n.Stub.Name}, {Key: "role", Value: g.r.NPC.Role(n.Stub.Role).Role}, {Key: "place", Value: g.placeName(n.Stub.Home)}}
	sal := row.Weight
	own := false
	m := n.Meeting(c.C.ID)
	switch row.When {
	case "first-meeting":
		if m != nil && m.Count > 1 {
			return TopicView{}, false
		}
	case "memory":
		e, ok := g.r.NPC.About(n, c.C.ID, row.Entry, t)
		if !ok {
			return TopicView{}, false
		}
		if row.Also != "" {
			also, ok := g.r.NPC.About(n, c.C.ID, row.Also, t)
			if !ok {
				return TopicView{}, false
			}
			sal += g.r.NPC.Salience(also, t)
		}
		own = true
		sal += g.r.NPC.Salience(e, t)
		fields = append(fields, npc.Field{Key: "thing", Value: e.Thing})
	case "news":
		since := n.Saved
		if m != nil && m.Count > 1 {
			since = m.Prev
		}
		best, ok := g.newsNear(n.Stub.Home, since, row.AtLeast)
		if !ok {
			return TopicView{}, false
		}
		fields = append(fields, npc.Field{Key: "thing", Value: strings.ReplaceAll(best.Kind, ".", " ")}, npc.Field{Key: "place", Value: g.placeName(best.At)})
	case "trouble", "corruption":
		gauge := "threat"
		if row.When == "corruption" {
			gauge = "corruption"
		}
		v, ok := g.World.GaugeAt(n.Stub.Home, gauge)
		if !ok || v < row.AtLeast {
			return TopicView{}, false
		}
		fields = append(fields, npc.Field{Key: "thing", Value: strconv.FormatInt(v, decimal) + " " + gauge}, npc.Field{Key: "n", Value: strconv.FormatInt(v, decimal)}, npc.Field{Key: "unit", Value: gauge})
	case "weather":
		kind, ok := g.weatherOnRoute(n, row.AtLeast)
		if !ok {
			return TopicView{}, false
		}
		fields = append(fields, npc.Field{Key: "thing", Value: g.r.Name("world.weather:" + kind)})
	case whenCrowding:
		r := g.World.RegionAt(n.Stub.Home)
		if r < 0 {
			return TopicView{}, false
		}
		built := g.BuiltIn(r, t/sheets.TicksPerDay)
		if built < row.AtLeast {
			return TopicView{}, false
		}
		fields = append(fields, npc.Field{Key: "n", Value: strconv.FormatInt(built, decimal)}, npc.Field{Key: "unit", Value: "structures"},
			npc.Field{Key: "thing", Value: strconv.FormatInt(g.crowdDays(), decimal) + " days"})
	case "longer-road":
		// Measured when the route was last relaid.
		if n.Longer <= 0 || n.Longer < row.AtLeast {
			return TopicView{}, false
		}
		fields = append(fields, npc.Field{Key: "n", Value: strconv.FormatInt(n.Longer, decimal)}, npc.Field{Key: "unit", Value: "per cent"})
	case "gossip":
		line, heard, ok := g.gossip(c, n, t)
		if !ok {
			return TopicView{}, false
		}
		sal += heard
		fields = append(fields, npc.Field{Key: "thing", Value: line})
	case entryMoved:
		e, ok := g.r.NPC.About(n, "", entryMoved, t)
		if !ok {
			return TopicView{}, false
		}
		sal += g.r.NPC.Salience(e, t)
		fields = append(fields, npc.Field{Key: "thing", Value: e.Thing})
	case entryResold, entrySoldOn:
		e, ok := g.r.NPC.About(n, c.C.ID, row.When, t)
		if !ok || e.N < row.AtLeast {
			return TopicView{}, false
		}
		own = true
		sal += g.r.NPC.Salience(e, t)
		fields = append(fields, npc.Field{Key: "thing", Value: e.Thing}, npc.Field{Key: "n", Value: strconv.FormatInt(e.N, decimal)}, npc.Field{Key: "unit", Value: row.Unit})
	case "pattern":
		if len(g.r.Gen.Chunk(g.r.Gen.ChunkOf(n.Stub.Home)).Points) == 0 {
			return TopicView{}, false
		}
	default:
		// rival, promise-kept and promise-broken read what no NPC keeps yet.
		return TopicView{}, false
	}
	v := TopicView{ID: row.ID, Line: npc.Line(row.Line, fields...), Own: own, Salience: sal}
	for _, ch := range row.Choices {
		v.Choices = append(v.Choices, ChoiceView{ID: ch.ID, Line: ch.Line, Effect: ch.Effect, Standing: ch.Standing, Coin: ch.Coin})
	}
	return v, true
}

// structural: the predicate crowding reads, here and where building is
// counted.
const whenCrowding = "crowding"

func (g *Game) newsNear(home hex.Hex, since, weight int64) (News, bool) {
	rng := g.r.NPC.Param("news-range")
	for i := len(g.News) - 1; i >= 0; i-- {
		n := g.News[i]
		if n.Tick > since && n.Weight >= weight && !n.Placeless && hex.Distance(n.At, home) <= rng {
			return n, true
		}
	}
	return News{}, false
}

func (g *Game) weatherOnRoute(n *npc.NPC, strength int64) (string, bool) {
	for _, h := range n.Route {
		if sys, ok := g.World.Weather(h); ok && sys.Strength >= strength {
			return sys.Kind, true
		}
	}
	return "", false
}

// placeName is a tile's settlement or region name.
func (g *Game) placeName(h hex.Hex) string {
	if p := g.PlaceAt(h); p != nil && p.Name != "" {
		return p.Name
	}
	if g.IsSettlement(h) {
		return g.r.NPC.PlaceName(npc.ListSettlement, h.Ref())
	}
	if r := g.World.RegionAt(h); r >= 0 {
		return g.r.NPC.PlaceName(npc.ListRegion, world.RegionRef(r))
	}
	return h.Ref()
}

// FactionName is a faction's name: its head and what its archetype is
// called.
func (g *Game) FactionName(i int) string {
	if i < 0 {
		return "the keepers"
	}
	f := g.World.Factions[i]
	return f.Head + " " + g.r.Name("factions.archetypes:"+f.Archetype)
}

// PlaceName is the name a tile goes by: its settlement's, or its region's.
func (g *Game) PlaceName(h hex.Hex) string { return g.placeName(h) }

// choose takes a choice on a topic the conversation offers: its effect,
// what the NPC remembers of it, and the line it keeps (GDD 4.18).
func (g *Game) choose(c *Char, cmd Command) error {
	if err := canTrade(c); err != nil {
		return err
	}
	if !slices.ContainsFunc(g.PeopleHere(c, c.C.At), func(p Person) bool { return p.ID == cmd.NPC }) {
		return refuse(NotHere, "%s is not here", cmd.NPC)
	}
	conv, err := g.Converse(c, cmd.NPC)
	if err != nil {
		return err
	}
	topicID, choiceID, _ := strings.Cut(cmd.Option, "/")
	ti := slices.IndexFunc(conv.Topics, func(v TopicView) bool { return v.ID == topicID })
	if ti < 0 {
		return refuse(BadArgs, "%s is not raising %q", cmd.NPC, topicID)
	}
	row, ok := g.r.NPC.Choice(topicID, choiceID)
	if !ok {
		return refuse(BadArgs, "no choice %q on %s", choiceID, topicID)
	}
	n := g.NPCs.Get(cmd.NPC)
	t := g.Tick()
	day := t / sheets.TicksPerDay
	m := n.Meeting(c.C.ID)
	if m == nil {
		return refuse(NotHere, "%s has not spoken with %s", c.C.ID, cmd.NPC)
	}
	if m.HasAnswered(topicID, day) {
		return refuse(BadArgs, "%s has answered %s today", c.C.ID, topicID)
	}
	if err := g.effect(c, n, cmd.Key, row, t); err != nil {
		return err
	}
	f, err := g.npcFact(c, n, "npc.chose", t, fact.S("topic", topicID), fact.S("choice", choiceID))
	if err != nil {
		return err
	}
	if row.Remember != "" {
		if err := g.note(n, c, npc.Entry{Kind: row.Remember, Player: c.C.ID, Weight: row.Weight, Tick: t, Fact: int64(f.ID), Thing: lowerFirst(strings.TrimSuffix(row.Line, "."))}, t); err != nil {
			return err
		}
	}
	m.Answer(topicID, conv.Topics[ti].Line, day)
	return g.NPCs.Touched(n)
}

func lowerFirst(s string) string {
	r, n := utf8.DecodeRuneInString(s)
	if n == 0 {
		return s
	}
	return string(unicode.ToLower(r)) + s[n:]
}

// note has an NPC remember an entry about a character, and queue a visit
// to them when the entry is one it wants a word about. Under a season a
// queued topic wakes a dormant NPC first, so the entry is not folded away,
// and a visit about a debt queues the debt thread.
func (g *Game) note(n *npc.NPC, c *Char, e npc.Entry, t int64) error {
	wants := g.r.NPC.Wants(e)
	if wants && g.Story != nil {
		if _, err := g.wake(n, t); err != nil {
			return err
		}
	}
	g.r.NPC.Remember(n, e, t)
	if wants {
		if err := g.queueVisit(n, c); err != nil {
			return err
		}
		g.pendDebt(n, c, e, t)
	}
	return nil
}

// effect applies a choice: standing with whose the NPC is, coin with its
// purse, or a rumour of something near its home.
func (g *Game) effect(c *Char, n *npc.NPC, key string, row sheets.TopicChoice, t int64) error {
	switch row.Effect {
	case "standing":
		g.standing(c, n, row.Standing)
	case "coin":
		purse := ledger.NPCPool(n.Stub.ID)
		from, to, units := ledger.Char(c.C.ID), purse, -row.Coin
		if row.Coin > 0 {
			from, to, units = purse, ledger.Char(c.C.ID), min(row.Coin, g.Ledger.Of(purse, ledger.Coin))
		}
		if units <= 0 {
			return nil
		}
		if from == ledger.Char(c.C.ID) && g.balance(c, ledger.Coin) < units {
			return refuse(BadArgs, "that takes %d coin", units)
		}
		return g.receive(c, ledger.Move(key, "npc", t, from, to, ledger.Coin, units))
	case "rumour":
		g.rumour(c, n)
	case "discount":
		c.C.Flags = appendOnce(c.C.Flags, "discount:"+n.Stub.ID)
	}
	return nil
}

func appendOnce(s []string, x string) []string {
	if slices.Contains(s, x) {
		return s
	}
	return append(s, x)
}

// rumour tells a character of a cache near the NPC's home, else of the
// nearest site nobody has entered there, which their map then shows.
func (g *Game) rumour(c *Char, n *npc.NPC) {
	rng := g.r.NPC.Param("news-range")
	for _, l := range g.Left {
		if l.Hidden && l.By != c.C.ID && hex.Distance(l.Hex, n.Stub.Home) <= rng {
			c.C.Rumours = appendOnce(c.C.Rumours, CacheRumour(l.Hex))
			return
		}
	}
	for r := int64(1); r <= rng; r++ {
		for _, h := range hex.Ring(n.Stub.Home, r) {
			b := g.r.Gen.Baseline(h)
			if b.Site == "" || b.Site == gen.PlaceSettlement {
				continue
			}
			if tl := g.World.Tile(h); tl != nil && tl.Discovered != nil {
				continue
			}
			c.C.Rumours = appendOnce(c.C.Rumours, "site:"+h.Ref())
			g.Pending = append(g.Pending, world.Action{Kind: world.ActDiscover, Hex: h, By: char.Ref(c.C.ID)})
			return
		}
	}
}

// Naming consent (GDD 4.18): by default a player may be named to
// players of the same server and is "a traveller from" their guild to
// others; each can change both.
const (
	ConsentSame  = "same-server"
	ConsentOther = "other-servers"
)

func (g *Game) consent(c *Char, cmd Command) error {
	on := cmd.Units != 0
	switch cmd.Option {
	case ConsentSame:
		c.HideSame = !on
	case ConsentOther:
		c.NameOther = on
	default:
		return refuse(BadArgs, "no consent setting %q", cmd.Option)
	}
	return nil
}

// travellerName is how an NPC tells of a player it may not name; NameFor
// adds the guild when there is one.
const travellerName = "a traveller"

// NameFor is how an NPC names subject to viewer: by name where subject
// allows it, else as a traveller from their guild.
func NameFor(viewer, subject *Char, name, guild string) string {
	same := viewer.Server != "" && viewer.Server == subject.Server
	if (same && !subject.HideSame) || (!same && subject.NameOther) || viewer == subject {
		return name
	}
	return travellerName + " from " + guild
}

// fought records, for the saved NPCs on a tile at this hour, that a
// character won a fight beside them.
func (g *Game) fought(c *Char, h hex.Hex, creature string, t int64) error {
	for _, n := range g.NPCs.Through(h) {
		if g.r.NPC.At(n, t) != h {
			continue
		}
		if err := g.note(n, c, npc.Entry{Kind: entryFought, Player: c.C.ID, Weight: g.r.NPC.Param("fought-weight"), Tick: t, Thing: g.r.Name("creatures.archetypes:" + creature)}, t); err != nil {
			return err
		}
		if err := g.NPCs.Touched(n); err != nil {
			return err
		}
	}
	return nil
}

// traded records a sale in the settlement at h with its trader, if it is
// saved.
func (g *Game) traded(c *Char, h hex.Hex, material string, t int64) error {
	s, ok := g.traderStub(h)
	if !ok {
		return nil
	}
	if n := g.NPCs.Get(s.ID); n != nil {
		if err := g.note(n, c, npc.Entry{Kind: entryTraded, Player: c.C.ID, Weight: g.r.NPC.Param("traded-weight"), Tick: t, Thing: g.sheetMaterialName(material)}, t); err != nil {
			return err
		}
		return g.NPCs.Touched(n)
	}
	return nil
}
