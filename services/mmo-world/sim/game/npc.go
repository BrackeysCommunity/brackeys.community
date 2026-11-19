package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
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

// News is a heavy fact the world keeps in memory for what NPCs and the
// recap read: the last news-kept of weight news-weight or more.
type News struct {
	ID     fact.ID `json:"id"`
	Tick   int64   `json:"tick"`
	Kind   string  `json:"kind"`
	Region string  `json:"region,omitempty"`
	At     hex.Hex `json:"at"`
	Weight int64   `json:"weight"`
}

// structural: a fact names its tile through q and r data, when it has one.
const (
	keyQ = "q"
	keyR = "r"
)

// keepNews adds the heavy facts among fs to the news ring.
func (g *Game) keepNews(fs []fact.Fact) {
	line, kept := g.r.wp("news-weight"), g.r.wp("news-kept")
	for _, f := range fs {
		if f.Weight < line {
			continue
		}
		n := News{ID: f.ID, Tick: f.Tick, Kind: f.Kind, Region: f.Region, Weight: f.Weight}
		n.At, _ = g.factAt(f)
		g.News = append(g.News, n)
	}
	if over := int64(len(g.News)) - kept; over > 0 {
		g.News = slices.Delete(g.News, 0, int(over))
	}
}

// Person is someone a character can talk to on a tile now.
type Person struct {
	npc.Stub
	Saved bool `json:"saved"`
	Visit bool `json:"visit"` // it has queued a visit to this character
}

// structural: the place kind a starting settlement's residents fill.
const placeSettlement = "starting-settlement"

// PeopleHere are the NPCs on a tile at this hour: a settlement's
// residents at home or on their routes, saved NPCs whose routes pass now,
// and the day's wanderer. Nothing is walked: the route index answers.
func (g *Game) PeopleHere(c *Char, h hex.Hex) []Person {
	t := g.Tick()
	var out []Person
	seen := func(id string) bool { return slices.ContainsFunc(out, func(p Person) bool { return p.ID == id }) }
	add := func(n *npc.NPC) {
		if !seen(n.Stub.ID) {
			out = append(out, Person{Stub: n.Stub, Saved: true, Visit: slices.Contains(n.Visits, c.C.ID)})
		}
	}
	if g.r.Gen.Baseline(h).Site == gen.PlaceSettlement {
		for _, s := range g.r.NPC.Residents(placeSettlement, h.Ref(), h) {
			if n := g.NPCs.Get(s.ID); n != nil {
				if g.r.NPC.At(n, t) == h {
					add(n)
				}
			} else {
				out = append(out, Person{Stub: s})
			}
		}
	}
	for _, n := range g.NPCs.Through(h) {
		if g.r.NPC.At(n, t) == h {
			add(n)
		}
	}
	if s, ok := g.wanderer(h, t); ok && !seen(s.ID) && g.NPCs.Get(s.ID) == nil {
		out = append(out, Person{Stub: s})
	}
	return out
}

func (g *Game) wanderer(h hex.Hex, t int64) (npc.Stub, bool) {
	b := g.r.Gen.Baseline(h)
	if b.Site == gen.PlaceSettlement || !g.r.Gen.Passable(b.Terrain) {
		return npc.Stub{}, false
	}
	var tileTags []string
	for _, x := range g.World.Place(h).Tags() {
		tileTags = append(tileTags, string(x))
	}
	return g.r.NPC.MeetWanderer(h, t/sheets.TicksPerDay, tileTags)
}

// Visitors are the saved NPCs that want a word with a character, checked
// when the character moves or opens the hub: here, or sending word.
func (g *Game) Visitors(c *Char) []*npc.NPC { return g.NPCs.Visiting(c.C.ID) }

// talk opens a conversation: the NPC is saved on its first, the meeting
// is recorded, and a first meeting may set off recognised (GDD 8.6).
func (g *Game) talk(c *Char, cmd Command) error {
	if c.Fight != nil {
		return refuse(Busy, "%s is in an encounter", c.C.ID)
	}
	i := slices.IndexFunc(g.PeopleHere(c, c.C.At), func(p Person) bool { return p.ID == cmd.NPC })
	if i < 0 {
		return refuse(NotHere, "%s is not here", cmd.NPC)
	}
	p := g.PeopleHere(c, c.C.At)[i]
	t := g.Tick()
	n := g.NPCs.Get(p.ID)
	if n == nil {
		n = g.NPCs.Save(p.Stub, t)
		old := n.Route
		g.r.NPC.LayRoute(n, t, g.routeCost)
		g.NPCs.Routed(n, old)
	} else if g.r.NPC.Dormant(n, t) {
		g.r.NPC.Wake(n)
	}
	first := n.Meeting(c.C.ID) == nil
	n.Meet(c.C.ID, t)
	g.NPCs.Visited(n, c.C.ID)
	c.C.Meet(char.Met{Who: "npc:" + n.Stub.ID, How: "met", Tick: t}, g.r.limits)
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

// standingKey is whose standing an NPC's choices move: the faction
// holding its home region, else its settlement.
func (g *Game) standingKey(n *npc.NPC) string {
	if r := g.World.RegionAt(n.Stub.Home); r >= 0 && g.World.Regions[r].Holder >= 0 {
		return "faction:" + strconv.Itoa(g.World.Regions[r].Holder)
	}
	return "place:" + n.Stub.Home.Ref()
}

func (g *Game) standing(c *Char, n *npc.NPC, by int64) {
	gp := g.r.Growth.Params()
	c.C.AdjustStanding(g.standingKey(n), by, sheets.IntParam(gp, "standing-min"), sheets.IntParam(gp, "standing-max"))
}

func (g *Game) npcFact(c *Char, n *npc.NPC, kind string, t int64, data ...fact.Datum) (fact.Fact, error) {
	region := ""
	if r := g.World.RegionAt(c.C.At); r >= 0 {
		region = world.RegionRef(r)
	}
	f, err := g.r.weights.New(t, kind, region, []fact.Ref{char.Ref(c.C.ID), npc.Ref(n.Stub.ID)}, nil, data...)
	if err != nil {
		return f, err
	}
	f.ID, err = g.Log.Append(f)
	return f, err
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
		v, ok := g.gaugeAt(n.Stub.Home, gauge)
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
	case "longer-road":
		now := g.routeTicks(n)
		if n.RouteTicks == 0 || (now-n.RouteTicks)*fixedHundred < row.AtLeast*n.RouteTicks {
			return TopicView{}, false
		}
		pct := (now - n.RouteTicks) * fixedHundred / n.RouteTicks
		fields = append(fields, npc.Field{Key: "n", Value: strconv.FormatInt(pct, decimal)}, npc.Field{Key: "unit", Value: "per cent"})
	case "pattern":
		if len(g.r.Gen.Chunk(g.r.Gen.ChunkOf(n.Stub.Home)).Points) == 0 {
			return TopicView{}, false
		}
	default:
		// resold, sold-on, crowding, rival, promise-kept, promise-broken and
		// moved-away read NPC trade, building and goals, which come later.
		return TopicView{}, false
	}
	v := TopicView{ID: row.ID, Line: npc.Line(row.Line, fields...), Own: own, Salience: sal}
	for _, ch := range row.Choices {
		v.Choices = append(v.Choices, ChoiceView{ID: ch.ID, Line: ch.Line, Effect: ch.Effect, Standing: ch.Standing, Coin: ch.Coin})
	}
	return v, true
}

// structural: percentages are out of a hundred.
const fixedHundred = 100

func (g *Game) newsNear(home hex.Hex, since, weight int64) (News, bool) {
	rng := g.r.NPC.Param("news-range")
	for i := len(g.News) - 1; i >= 0; i-- {
		n := g.News[i]
		if n.Tick > since && n.Weight >= weight && hex.Distance(n.At, home) <= rng {
			return n, true
		}
	}
	return News{}, false
}

func (g *Game) gaugeAt(h hex.Hex, id string) (int64, bool) {
	r := g.World.RegionAt(h)
	if r < 0 {
		return 0, false
	}
	return g.World.Regions[r].Gauge[g.World.GaugeIndex(id)], true
}

func (g *Game) weatherOnRoute(n *npc.NPC, strength int64) (string, bool) {
	for _, h := range n.Route {
		if sys, ok := g.World.Weather(h); ok && sys.Strength >= strength {
			return sys.Kind, true
		}
	}
	return "", false
}

func (g *Game) routeTicks(n *npc.NPC) int64 {
	var total int64
	for i := 1; i < len(n.Route); i++ {
		c, _ := g.routeCost(n.Route[i-1], n.Route[i])
		total += c
	}
	return total
}

// placeName is a tile's settlement or region name.
func (g *Game) placeName(h hex.Hex) string {
	if g.r.Gen.Baseline(h).Site == gen.PlaceSettlement {
		return g.r.NPC.PlaceName(npc.ListSettlement, h.Ref())
	}
	if r := g.World.RegionAt(h); r >= 0 {
		return g.r.NPC.PlaceName(npc.ListRegion, world.RegionRef(r))
	}
	return h.Ref()
}

// PlaceName is the name a tile goes by: its settlement's, or its region's.
func (g *Game) PlaceName(h hex.Hex) string { return g.placeName(h) }

// choose takes a choice on a topic the conversation offers: its effect,
// what the NPC remembers of it, and the line it keeps (GDD 4.18).
func (g *Game) choose(c *Char, cmd Command) error {
	conv, err := g.Converse(c, cmd.NPC)
	if err != nil {
		return err
	}
	topicID, choiceID, _ := strings.Cut(cmd.Option, "/")
	ti := slices.IndexFunc(conv.Topics, func(v TopicView) bool { return v.ID == topicID })
	if ti < 0 {
		return refuse(BadArgs, "%s is not raising %q", cmd.NPC, topicID)
	}
	var row sheets.TopicChoice
	for _, tp := range g.r.NPC.Topics() {
		if tp.ID == topicID {
			for _, ch := range tp.Choices {
				if ch.ID == choiceID {
					row = ch
				}
			}
		}
	}
	if row.ID == "" {
		return refuse(BadArgs, "no choice %q on %s", choiceID, topicID)
	}
	n := g.NPCs.Get(cmd.NPC)
	t := g.Tick()
	if err := g.effect(c, n, cmd.Key, row, t); err != nil {
		return err
	}
	f, err := g.npcFact(c, n, "npc.chose", t, fact.S("topic", topicID), fact.S("choice", choiceID))
	if err != nil {
		return err
	}
	if row.Remember != "" {
		e := npc.Entry{Kind: row.Remember, Player: c.C.ID, Weight: row.Weight, Tick: t, Fact: int64(f.ID), Thing: strings.TrimSuffix(strings.ToLower(row.Line[:1])+row.Line[1:], ".")}
		g.r.NPC.Remember(n, e, t)
		if g.r.NPC.Wants(e) {
			g.NPCs.Queue(n, c.C.ID)
		}
	}
	if m := n.Meeting(c.C.ID); m != nil {
		m.Topic, m.Line = topicID, conv.Topics[ti].Line
	}
	return g.NPCs.Touched(n)
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
		if from == ledger.Char(c.C.ID) && c.C.Coin < units {
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

// Naming consent (GDD 4.18, D34): by default a player may be named to
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

// NameFor is how an NPC names subject to viewer: by name where subject
// allows it, else as a traveller from their guild.
func NameFor(viewer, subject *Char, name, guild string) string {
	same := viewer.Server != "" && viewer.Server == subject.Server
	if (same && !subject.HideSame) || (!same && subject.NameOther) || viewer == subject {
		return name
	}
	return "a traveller from " + guild
}

// fought records, for the saved NPCs on a tile at this hour, that a
// character won a fight beside them.
func (g *Game) fought(c *Char, h hex.Hex, creature string, t int64) error {
	for _, n := range g.NPCs.Through(h) {
		if g.r.NPC.At(n, t) != h {
			continue
		}
		e := npc.Entry{Kind: "fought", Player: c.C.ID, Weight: g.r.NPC.Param("fought-weight"), Tick: t, Thing: g.r.Name("creatures.archetypes:" + creature)}
		g.r.NPC.Remember(n, e, t)
		if g.r.NPC.Wants(e) {
			g.NPCs.Queue(n, c.C.ID)
		}
		if err := g.NPCs.Touched(n); err != nil {
			return err
		}
	}
	return nil
}

// traded records a sale with the settlement's trader, if it is saved.
func (g *Game) traded(c *Char, material string, t int64) error {
	h := c.C.At
	for _, s := range g.r.NPC.Residents(placeSettlement, h.Ref(), h) {
		if s.Role != "settlement-trader" {
			continue
		}
		if n := g.NPCs.Get(s.ID); n != nil {
			g.r.NPC.Remember(n, npc.Entry{Kind: "traded", Player: c.C.ID, Weight: g.r.NPC.Param("traded-weight"), Tick: t, Thing: g.r.Name("items.materials:" + material)}, t)
			return g.NPCs.Touched(n)
		}
	}
	return nil
}
