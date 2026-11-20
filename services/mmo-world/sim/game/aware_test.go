package game

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// meetResidents has a character talk to everyone at its settlement, which
// saves them, and returns them by role.
func meetResidents(t *testing.T, g *Game, c *Char) map[string]*npc.NPC {
	t.Helper()
	out := map[string]*npc.NPC{}
	for _, p := range g.PeopleHere(c, c.C.At) {
		if _, err := g.Act(Command{Key: "meet-" + c.C.ID + "-" + p.ID, Char: c.C.ID, Kind: Talk, NPC: p.ID}); err != nil {
			t.Fatal(err)
		}
		out[p.Role] = g.NPCs.Get(p.ID)
	}
	if len(out) == 0 {
		t.Fatal("nobody at the settlement")
	}
	return out
}

func topicRow(t *testing.T, g *Game, id string) sheets.Topic {
	t.Helper()
	for _, row := range g.r.NPC.Topics() {
		if row.ID == id {
			return row
		}
	}
	t.Fatalf("no topic %s", id)
	return sheets.Topic{}
}

// raised feeds the game the fact of a structure going up at its first
// settlement on a world day.
func raised(g *Game, day int64) {
	g.keepNews([]fact.Fact{{Tick: day * sheets.TicksPerDay, Kind: factRaised, Data: []fact.Datum{fact.N("settlement", 0)}}})
}

// TestRouteRelaidAtTheMeetingAfterAWeek: a meeting a week after a route
// was laid measures the road, relays the route and keeps the index and
// the conversation with it; the longer road is then a topic.
func TestRouteRelaidAtTheMeetingAfterAWeek(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	n := meetResidents(t, g, c)["settlement-smith"]
	row := topicRow(t, g, "a-longer-road")
	if _, ok := g.topic(c, n, row, g.Tick()); ok || n.Longer != 0 {
		t.Fatal("a freshly laid road is already longer")
	}
	// The route was laid a week ago, when it took four fifths of what it does now.
	n.Laid -= g.r.NPC.Param("relay-days") * sheets.TicksPerDay
	n.RouteTicks = n.RouteTicks * 4 / 5
	if at := g.r.NPC.At(n, g.Tick()); at != c.C.At {
		t.Fatalf("an NPC whose route is due is at %v, not at home", at)
	}
	if _, err := g.Act(Command{Key: "again", Char: c.C.ID, Kind: Talk, NPC: n.Stub.ID}); err != nil {
		t.Fatal(err)
	}
	if n.Longer < row.AtLeast || n.Laid <= g.Tick() {
		t.Fatalf("relaid: %d%% longer, walked from %d at %d", n.Longer, n.Laid, g.Tick())
	}
	for _, h := range n.Route {
		if !slices.Contains(g.NPCs.Through(h), n) {
			t.Fatalf("the relaid route's stop %v is not indexed", h)
		}
	}
	v, ok := g.topic(c, n, row, g.Tick())
	if !ok || !strings.Contains(v.Line, "per cent longer") {
		t.Fatalf("no longer-road topic after the relay: %+v", v)
	}
	if !slices.ContainsFunc(g.PeopleHere(c, c.C.At), func(p Person) bool { return p.ID == n.Stub.ID }) {
		t.Fatal("relaying the route took the NPC out of its meeting")
	}
}

// TestCrowdingFromBuildCounters: the crowding topic reads a region's
// count of structures built inside the window, kept as counters.
func TestCrowdingFromBuildCounters(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	n := meetResidents(t, g, c)["settlement-keeper"]
	row := topicRow(t, g, "crowding")
	region := g.World.RegionAt(c.C.At)
	for range row.AtLeast - 1 {
		raised(g, 0)
	}
	if _, ok := g.topic(c, n, row, g.Tick()); ok || len(g.Crowded) != 0 {
		t.Fatalf("crowded one structure short of the line: %v", g.Built)
	}
	raised(g, 0)
	v, ok := g.topic(c, n, row, g.Tick())
	if !ok || !strings.Contains(v.Line, "10 structures built in 14 days") {
		t.Fatalf("no crowding topic at the line: %+v", v)
	}
	if !slices.Equal(g.Crowded, []int{0}) {
		t.Fatalf("the build that crowded the region marked %v", g.Crowded)
	}
	window := g.r.NPC.Param("crowding-days")
	if got := g.BuiltIn(region, window-1); got != row.AtLeast {
		t.Fatalf("%d built on the window's last day, want %d", got, row.AtLeast)
	}
	if got := g.BuiltIn(region, window); got != 0 {
		t.Fatalf("%d built once the window has passed", got)
	}
	raised(g, window)
	if len(g.Built) != 1 || g.BuiltIn(region, window) != 1 {
		t.Fatalf("counters outside the window were kept: %v", g.Built)
	}
	founded := int64(0)
	for _, s := range g.r.Book.Structures {
		if s.Charter {
			founded++
		}
	}
	g.keepNews([]fact.Fact{{Tick: window * sheets.TicksPerDay, Kind: factFounded, Data: []fact.Datum{fact.N("settlement", 0)}}})
	if got := g.BuiltIn(region, window); got != 1+founded {
		t.Fatalf("a founding counted %d structures, want its charter's %d", got-1, founded)
	}
}

// TestGossipIsAboutNeighboursOnly: an NPC passes on what a neighbour in
// its settlement remembers, at a share of its salience, naming the player
// only to themselves; nothing reaches an NPC living elsewhere.
func TestGossipIsAboutNeighboursOnly(t *testing.T) {
	g := guardGame(t)
	a, b := mustCreate(t, g, "a", "knife"), mustCreate(t, g, "b", "knife")
	people := meetResidents(t, g, a)
	smith, keeper := people["settlement-smith"], people["settlement-keeper"]
	row := topicRow(t, g, "gossip")
	if _, ok := g.topic(a, keeper, row, g.Tick()); ok {
		t.Fatal("gossip with nothing remembered in the settlement")
	}
	if _, err := g.Act(Command{Key: "walk-on", Char: a.C.ID, Kind: Choose, NPC: smith.Stub.ID, Option: "first-meeting/walk-on"}); err != nil {
		t.Fatal(err)
	}
	slight, ok := g.r.NPC.About(smith, a.C.ID, "slighted", g.Tick())
	if !ok {
		t.Fatal("the smith does not remember the slight")
	}
	own, ok := g.topic(a, keeper, row, g.Tick())
	want := row.Weight + slight.Weight*g.r.NPC.Param("gossip-share")/100
	if !ok || !strings.Contains(own.Line, smith.Stub.Name+" says you walked past") || own.Salience != want || own.Own {
		t.Fatalf("the keeper to the one it is about: %+v, want salience %d", own, want)
	}
	other, ok := g.topic(b, keeper, row, g.Tick())
	if !ok || !strings.Contains(other.Line, "a traveller walked past") {
		t.Fatalf("the keeper to someone else: %+v", other)
	}
	if _, ok := g.topic(a, smith, row, g.Tick()); ok {
		t.Fatal("the smith gossips about itself")
	}
	memory := len(keeper.Memory)
	if _, err := g.Converse(a, keeper.Stub.ID); err != nil || len(keeper.Memory) != memory {
		t.Fatalf("passing gossip on wrote a memory (%v)", err)
	}
	// A hop further: someone who lives elsewhere and walks through hears nothing.
	far := g.NPCs.Save(npc.Stub{ID: "passer", Role: "road-scout", Name: "Passer", Home: a.C.At.Neighbour(0)}, g.Tick())
	far.Route = append(far.Route, far.Stub.Home, a.C.At)
	g.NPCs.Routed(far, nil)
	if _, ok := g.topic(a, far, row, g.Tick()); ok {
		t.Fatal("gossip reached an NPC outside the settlement")
	}
}

// TestCrowdedResidentsMoveHome: building that leaves a region crowded has
// the settlement's residents decide, at the next tick, whether to move:
// those a place cannot spare stay, a mover leaves a fact and a new route,
// and its former neighbours bring it up.
func TestCrowdedResidentsMoveHome(t *testing.T) {
	g := guardGame(t)
	c := mustCreate(t, g, "a", "knife")
	home := c.C.At
	people := meetResidents(t, g, c)
	for range g.crowdLine() - 1 {
		raised(g, 0)
	}
	if _, err := g.Advance(); err != nil {
		t.Fatal(err)
	}
	if len(g.NPCs.Homed(home)) != len(people) {
		t.Fatal("somebody moved before the region was crowded")
	}
	var mover *npc.NPC
	for tries := 0; mover == nil && tries < 40; tries++ {
		raised(g, 0)
		facts, err := g.Advance()
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range facts {
			if f.Kind == "npc.moved" {
				mover = g.NPCs.Get(f.Subjects[0].ID)
			}
		}
	}
	if mover == nil {
		t.Fatal("nobody moved out of a crowded settlement")
	}
	if len(g.Crowded) != 0 {
		t.Fatalf("the crowding was not settled at the tick: %v", g.Crowded)
	}
	day := g.Tick() / sheets.TicksPerDay
	if g.r.NPC.Role(mover.Stub.Role).Rooted || mover.Stub.Home == home || g.crowded(mover.Stub.Home, day) {
		t.Fatalf("%s the %s moved to %v", mover.Stub.Name, mover.Stub.Role, mover.Stub.Home)
	}
	for _, role := range []string{"settlement-keeper", "settlement-trader", "settlement-watch"} {
		if people[role].Stub.Home != home {
			t.Fatalf("the %s left a place that cannot spare it", role)
		}
	}
	if slices.ContainsFunc(g.PeopleHere(c, home), func(p Person) bool { return p.ID == mover.Stub.ID }) {
		t.Fatal("the mover is still met at its old home")
	}
	if mover.Route[0] != mover.Stub.Home || !slices.Contains(g.NPCs.Homed(mover.Stub.Home), mover) || slices.Contains(g.NPCs.Homed(home), mover) {
		t.Fatalf("the mover's route %v was not relaid from its new home", mover.Route)
	}
	v, ok := g.topic(c, people["settlement-keeper"], topicRow(t, g, "moved-away"), g.Tick())
	if !ok || !strings.Contains(v.Line, mover.Stub.Name) {
		t.Fatalf("the keeper does not bring up the neighbour who left: %+v", v)
	}
	if _, ok := g.topic(c, mover, topicRow(t, g, "moved-away"), g.Tick()); ok {
		t.Fatal("the mover remembers itself leaving")
	}
	audit(t, g)
}

// TestAwarenessSurvivesASnapshot: the build counters and a pending
// crowding are state the digest covers and a snapshot carries.
func TestAwarenessSurvivesASnapshot(t *testing.T) {
	g := guardGame(t)
	mustCreate(t, g, "a", "knife")
	before, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	for range g.crowdLine() {
		raised(g, 0)
	}
	want, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	if before == want {
		t.Fatal("the digest does not cover the build counters")
	}
	snap, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	var h Game
	if err := json.Unmarshal(snap, &h); err != nil {
		t.Fatal(err)
	}
	h.Attach(g.r)
	if got, _ := h.Digest(); got != want || !slices.Equal(h.Built, g.Built) || !slices.Equal(h.Crowded, g.Crowded) {
		t.Fatalf("a snapshot lost the counters: %v, %v", h.Built, h.Crowded)
	}
}
