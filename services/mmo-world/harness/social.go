package harness

import (
	"context"
	"fmt"
	"maps"
	"runtime"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
)

// Social run targets.
const (
	targetHistory = 60 // per cent of second meetings with a topic from the player's own history
	targetUnique  = 80 // per cent of pairs with different histories whose top topics differ
	costTolerance = 10 // per cent a world day's cost may differ between 10 and a million NPCs
)

// structural: the run's shape: how many NPCs the big book holds, days the
// spoils run plays, and world days timed per book.
const (
	bigBook       = 1_000_000
	smallBook     = 10
	spoilsDays    = 10
	timedDays     = 3
	socialPlayers = 120
	spoilsPlayers = 24
	maxGap        = 3 // world days between a player's two meetings, at most
	awarePlayers  = 6
	awareRaises   = 12 // structures the awareness run raises, over raiseDays
	raiseDays     = 4
)

// SocialRun measures the NPC targets (GDD 4.18): simulated players meet
// NPCs twice, and the second meeting is read for topics from their own
// history and for top topics that differ between histories. It plays what
// NPCs know of the world: gossip, crowding, moving home and relaid routes.
// It also checks that triggers' finds only move goods out of spoils
// pools, and times a world day with 10 and with 1,000,000 saved NPCs.
func SocialRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	if n == 0 {
		n = socialPlayers
	}
	meet, err := meetings(b, n)
	if err != nil {
		return nil, err
	}
	aw, err := awareRun(b)
	if err != nil {
		return nil, err
	}
	sp, err := spoilsRun(b)
	if err != nil {
		return nil, err
	}
	small, err := dayCost(b, smallBook)
	if err != nil {
		return nil, err
	}
	big, err := dayCost(b, bigBook)
	if err != nil {
		return nil, err
	}
	ratio := 100 * (float64(big.perDay) - float64(small.perDay)) / float64(small.perDay)

	var doc lineDoc
	p := doc.p
	p("# Social run")
	p("")
	p("%d simulated players at the first starting settlement of a world under throwaway key `social`. Each meets one NPC (a settlement resident, or a wanderer on a tile nearby), takes a keyed choice on the first meeting, a third also sell at the market, and each comes back after 0 to %d world days to meet the same NPC again where its route has it at that hour. Players are moved to the NPC directly: this run measures NPCs, not travel.", n, maxGap)
	p("")
	p("| Measure | Value | Target | Holds |")
	p("| --- | --- | --- | --- |")
	p("| Second meetings with a topic from the player's own history | %.1f%% of %d | %d%% or more | %s |", pct(meet.own, meet.second), meet.second, targetHistory, holds(pct(meet.own, meet.second) >= targetHistory))
	p("| Pairs with different histories whose top topics differ | %.1f%% of %d pairs | %d%% or more | %s |", pct(meet.differ, meet.pairs), meet.pairs, targetUnique, holds(pct(meet.differ, meet.pairs) >= targetUnique))
	p("| A world day with %d saved NPCs | %s | | |", smallBook, small.perDay.Round(time.Microsecond))
	p("| A world day with %s saved NPCs | %s | within %d%% | %s |", comma(bigBook), big.perDay.Round(time.Microsecond), costTolerance, holds(abs(ratio) <= costTolerance))
	p("| NPCs touched by world day %d, past the week a route stands | %d, with %s of %s routes due to be relaid | none: only a meeting relays a route | %s |", big.days, big.touched+small.touched, comma(big.due), comma(bigBook), holds(big.touched+small.touched == 0 && big.due == bigBook))
	p("| Finds from triggers | %d finds, %d goods, all out of spoils pools; pools took %d goods in | never add goods | %s |", sp.finds, sp.found, sp.pooled, holds(sp.ok))
	p("")
	p("Top topics at second meetings: %s.", mapList(meet.tops))
	p("")
	p("NPCs saved: %d. Histories seen: %d. Cost: the median of %d world days a book, each 144 ticks of `Advance` plus the digest each tick; a million NPCs held %d MB of heap.", meet.saved, meet.histories, timedDays, big.heapMB)
	p("")
	p("## What NPCs know of the world")
	p("")
	p("%d players of one guild at the first starting settlement of a world under throwaway key `social-aware` meet every resident and take a keyed choice, come back the next day, raise %d structures there through pooled goals over %d world days, and meet everyone again a week after the routes were laid. Topics are counted in the dossier (every topic whose predicate holds) and among the %d a meeting shows.", awarePlayers, awareRaises, raiseDays, aw.shown)
	p("")
	p("| Measure | Value | Expected | Holds |")
	p("| --- | --- | --- | --- |")
	p("| Gossip of a neighbour, next-day meetings | in the dossier of %d of %d, shown in %d; %d name the player as \"you\" | some, and none from outside the settlement | %s |", aw.gossip, aw.gossipMeets, aw.gossipShown, aw.gossipOwn, holds(aw.gossip > 0 && aw.gossipFar == 0))
	p("| Gossip heard by an NPC living outside the settlement | %d of %d meetings | none: one hop | %s |", aw.gossipFar, aw.farMeets, holds(aw.gossipFar == 0))
	p("| Structures built in the region inside the window | %d, from the region's counters | %d or more is crowded | %s |", aw.built, aw.line, holds(aw.built >= aw.line))
	p("| Crowding raised before the line, and at it | %d and %d of %d residents | none, then all | %s |", aw.crowdEarly, aw.crowding, aw.residents, holds(aw.crowdEarly == 0 && aw.crowding == aw.residents))
	p("| Residents who moved home | %d of %d free to (%d the place cannot spare, none of whom moved: %s) | at least one | %s |", aw.moved, aw.free, aw.rooted, holds(aw.rootedMoved == 0), holds(aw.moved > 0 && aw.rootedMoved == 0))
	p("| Former neighbours who bring up the one who left | %d of %d | all | %s |", aw.movedAway, aw.stayed, holds(aw.moved == 0 || aw.movedAway == aw.stayed))
	p("| Routes relaid at the first meeting after a week | %d of %d; none before | all | %s |", aw.relaid, aw.relayMeets, holds(aw.relaid == aw.relayMeets && aw.relaidEarly == 0))
	p("| Meetings a relay took the NPC out of | %d | none | %s |", aw.lost, holds(aw.lost == 0))
	p("")
	p("Who moved: %s. The longest road measured at a relay was %d%% longer than when it was laid; the longer-road topic was in %d dossiers. Crowding was shown in %d of %d meetings at the line.", aw.went, aw.longest, aw.longer, aw.crowdShown, aw.crowdMeets)
	p("")
	p("The spoils run: %d bold wanderers for %d world days: %d encounters, %d downs, %d of which dropped haul into pools. Thin herds leave many explores empty, so a run can see no drops; `TestFindsNeverMint` in sim/game plants one and has a stranger and its owner find it.", len(sp.players), spoilsDays, sp.encounters, sp.downs, sp.drops)
	if err := doc.save(out, "social.md"); err != nil {
		return nil, err
	}
	return []Measured{
		{Target: "npc-own-history", Value: fmt.Sprintf("%.1f%%", pct(meet.own, meet.second)), Holds: pct(meet.own, meet.second) >= targetHistory},
		{Target: "npc-top-differs", Value: fmt.Sprintf("%.1f%%", pct(meet.differ, meet.pairs)), Holds: pct(meet.differ, meet.pairs) >= targetUnique},
		{Target: "npc-cost-flat", Value: fmt.Sprintf("%+.1f%%, %d NPCs touched in %d days", ratio, big.touched+small.touched, big.days), Holds: abs(ratio) <= costTolerance && big.touched+small.touched == 0},
		{Target: "spoils-conserved", Value: fmt.Sprintf("%d finds from pools", sp.finds), Holds: sp.ok},
		{Target: "npc-world-aware", Value: fmt.Sprintf("gossip in %d of %d dossiers, crowding at %d built, %d moved, %d of %d routes relaid", aw.gossip, aw.gossipMeets, aw.built, aw.moved, aw.relaid, aw.relayMeets), Holds: aw.ok()},
	}, nil
}

func abs(x float64) float64 { return max(x, -x) }

type meetResult struct {
	second, own   int
	pairs, differ int
	saved         int
	histories     int
	tops          map[string]int
}

// social is a game the Social run drives directly.
type social struct {
	g    *game.Game
	keys int
}

func (s *social) act(cmd game.Command) error {
	_, err := s.do(cmd)
	return err
}

func (s *social) do(cmd game.Command) (game.Result, error) {
	s.keys++
	cmd.Key = fmt.Sprintf("s%d", s.keys)
	return s.g.Act(cmd)
}

func (s *social) days(n int64) error {
	for range n * sheets.TicksPerDay {
		if _, err := s.g.Advance(); err != nil {
			return err
		}
	}
	return nil
}

// visit puts a character where an NPC is at this hour and opens a
// conversation.
func (s *social) visit(c *game.Char, id string, at hex.Hex) (game.Conversation, error) {
	c.C.At = at
	if err := s.act(game.Command{Char: c.C.ID, Kind: game.Talk, NPC: id}); err != nil {
		return game.Conversation{}, err
	}
	return s.g.Converse(c, id)
}

func meetings(b *sheets.Book, n int) (meetResult, error) {
	k := keys.Throwaway("social")
	r, err := game.NewRules(b, k)
	if err != nil {
		return meetResult{}, err
	}
	g, err := game.New(r)
	if err != nil {
		return meetResult{}, err
	}
	s := &social{g: g}
	d := draw.NewDrawer(k.Roll)
	starts := []string{"hook", "knife", "deck"}
	type plan struct {
		c       *game.Char
		npc     string
		history string
		gap     int64
	}
	var plans []*plan
	home := r.Gen.Settlement(0).Hex
	for i := range n {
		res, err := s.do(game.Command{Kind: game.Create, Option: starts[i%len(starts)]})
		if err != nil {
			return meetResult{}, err
		}
		plans = append(plans, &plan{c: res.Char, gap: int64(d.Below(maxGap+1, "social.gap", draw.Int(int64(i))))})
	}
	// First meetings: a resident at home, or a wanderer met nearby.
	for i, pl := range plans {
		c := pl.c
		c.C.At = home
		people := g.PeopleHere(c, home)
		if i%2 == 1 {
			for _, h := range hex.DiscAt(home, 3) {
				if ps := g.PeopleHere(c, h); len(ps) > 0 && ps[0].Kind == npc.Wanderer {
					c.C.At, people = h, ps
					break
				}
			}
		}
		if len(people) == 0 {
			continue
		}
		who := people[d.Below(uint64(len(people)), "social.who", draw.Int(int64(i)))]
		if i%3 == 0 && who.Kind == npc.Resident {
			who = people[slices.IndexFunc(people, func(p game.Person) bool { return strings.HasSuffix(p.Role, "trader") })]
		}
		if err := s.act(game.Command{Char: c.C.ID, Kind: game.Talk, NPC: who.ID}); err != nil {
			return meetResult{}, err
		}
		conv, err := g.Converse(c, who.ID)
		if err != nil {
			return meetResult{}, err
		}
		top := conv.Topics[0]
		pick := top.Choices[d.Below(uint64(len(top.Choices)), "social.choice", draw.Int(int64(i)))]
		if err := s.act(game.Command{Char: c.C.ID, Kind: game.Choose, NPC: who.ID, Option: top.ID + "/" + pick.ID}); err != nil {
			return meetResult{}, err
		}
		pl.npc, pl.history = who.ID, pick.ID
		if orders := g.FactionOrders(home); i%3 == 0 && c.C.At == home && len(orders) > 0 {
			sold := orders[0].Material
			if err := s.act(game.Command{Char: c.C.ID, Kind: game.Correct, Asset: ledger.Goods(sold), Units: 3, Note: "social run stock"}); err != nil {
				return meetResult{}, err
			}
			if err := s.act(game.Command{Char: c.C.ID, Kind: game.Sell, Material: sold, Units: 3}); err == nil {
				pl.history += "+sold"
			}
		}
	}
	// Second meetings, after each player's gap, where the NPC is then.
	out := meetResult{tops: map[string]int{}}
	byNPC := map[string][]*plan{}
	top := map[*plan]string{}
	for gap := int64(0); gap <= maxGap; gap++ {
		for _, pl := range plans {
			if pl.npc == "" || pl.gap != gap {
				continue
			}
			nn := g.NPCs.Get(pl.npc)
			conv, err := s.visit(pl.c, pl.npc, r.NPC.At(nn, g.Tick()))
			if err != nil {
				return meetResult{}, err
			}
			out.second++
			if slices.ContainsFunc(conv.Topics, func(t game.TopicView) bool { return t.Own }) {
				out.own++
			}
			if len(conv.Topics) > 0 {
				top[pl] = conv.Topics[0].ID
				out.tops[conv.Topics[0].ID]++
			}
			byNPC[pl.npc] = append(byNPC[pl.npc], pl)
		}
		if err := s.days(1); err != nil {
			return meetResult{}, err
		}
	}
	seen := map[string]bool{}
	for _, id := range slices.Sorted(maps.Keys(byNPC)) {
		ps := byNPC[id]
		for i := range ps {
			seen[ps[i].history] = true
			for j := i + 1; j < len(ps); j++ {
				if ps[i].history == ps[j].history {
					continue
				}
				out.pairs++
				if top[ps[i]] != top[ps[j]] {
					out.differ++
				}
			}
		}
	}
	out.saved, out.histories = g.NPCs.Len(), len(seen)
	return out, nil
}

type awareResult struct {
	shown                                 int64
	residents, rooted, free               int
	gossip, gossipShown, gossipOwn        int
	gossipMeets, gossipFar, farMeets      int
	built, line                           int64
	crowdEarly, crowding, crowdShown      int
	crowdMeets                            int
	moved, rootedMoved, stayed, movedAway int
	went                                  string
	relaid, relaidEarly, relayMeets, lost int
	longest                               int64
	longer                                int
}

func (a awareResult) ok() bool {
	return a.gossip > 0 && a.gossipFar == 0 && a.built >= a.line && a.crowdEarly == 0 && a.crowding == a.residents &&
		a.moved > 0 && a.rootedMoved == 0 && a.movedAway == a.stayed && a.relaid == a.relayMeets && a.relaidEarly == 0 && a.lost == 0
}

func hasTopic(ts []game.TopicView, id string) bool {
	return slices.ContainsFunc(ts, func(t game.TopicView) bool { return t.ID == id })
}

// awareRun plays what NPCs know of the world (GDD 4.18): gossip one hop
// deep, crowding from a region's build counters, residents moving home,
// and routes relaid at the first meeting after a week.
func awareRun(b *sheets.Book) (awareResult, error) {
	k := keys.Throwaway("social-aware")
	r, err := game.NewRules(b, k)
	if err != nil {
		return awareResult{}, err
	}
	g, err := game.New(r)
	if err != nil {
		return awareResult{}, err
	}
	s := &social{g: g}
	d := draw.NewDrawer(k.Roll)
	out := awareResult{shown: r.NPC.Param("topics-shown")}
	var team []*game.Char
	for range awarePlayers {
		res, err := s.do(game.Command{Kind: game.Create, Option: "hook", Server: "aware", Note: "The Aware"})
		if err != nil {
			return out, err
		}
		team = append(team, res.Char)
	}
	home := team[0].C.At
	region := g.World.RegionAt(home)
	day := func() int64 { return g.Tick() / sheets.TicksPerDay }
	// meet has a character meet an NPC where it is now, and reads its dossier.
	meet := func(c *game.Char, n *npc.NPC) ([]game.TopicView, game.Conversation, error) {
		conv, err := s.visit(c, n.Stub.ID, r.NPC.At(n, g.Tick()))
		return g.Candidates(c, n), conv, err
	}

	// Day 0: everyone meets every resident and takes a keyed choice.
	var residents []*npc.NPC
	for i, c := range team {
		for j, p := range g.PeopleHere(c, home) {
			conv, err := s.visit(c, p.ID, home)
			if err != nil {
				return out, err
			}
			top := conv.Topics[0]
			pick := top.Choices[d.Below(uint64(len(top.Choices)), "aware.choice", draw.Int(int64(i)), draw.Int(int64(j)))]
			if err := s.act(game.Command{Char: c.C.ID, Kind: game.Choose, NPC: p.ID, Option: top.ID + "/" + pick.ID}); err != nil {
				return out, err
			}
			if i == 0 {
				residents = append(residents, g.NPCs.Get(p.ID))
			}
		}
	}
	out.residents = len(residents)
	for _, n := range residents {
		if r.NPC.Role(n.Stub.Role).Rooted {
			out.rooted++
		}
	}
	out.free = out.residents - out.rooted
	// Someone who lives next door and walks through the settlement.
	far := g.NPCs.Save(npc.Stub{ID: "aware-passer", Kind: npc.Wanderer, Role: "road-scout", Name: "Passer", Home: home.Neighbour(0)}, g.Tick())
	far.Route = []hex.Hex{far.Stub.Home, home}
	far.Laid = g.Tick()
	g.NPCs.Routed(far, nil)

	// Day 1: second meetings; what the settlement says of each player.
	if err := s.days(1); err != nil {
		return out, err
	}
	for _, c := range team {
		for _, n := range residents {
			cands, conv, err := meet(c, n)
			if err != nil {
				return out, err
			}
			out.gossipMeets++
			if i := slices.IndexFunc(cands, func(t game.TopicView) bool { return t.ID == "gossip" }); i >= 0 {
				out.gossip++
				if strings.Contains(cands[i].Line, " you ") || strings.HasSuffix(cands[i].Line, " you.") {
					out.gossipOwn++
				}
			}
			if hasTopic(conv.Topics, "gossip") {
				out.gossipShown++
			}
		}
		cands, _, err := meet(c, far)
		if err != nil {
			return out, err
		}
		out.farMeets++
		if hasTopic(cands, "gossip") {
			out.gossipFar++
		}
	}

	// Days 1 to 4: the guild raises structures; each build is settled at
	// the next tick, where residents of a crowded place decide to move.
	out.line = crowdLine(b)
	raises := raisable(g, b)
	if len(raises) < awareRaises {
		return out, fmt.Errorf("social: only %d structures to raise, want %d", len(raises), awareRaises)
	}
	countCrowding := func(early bool) error {
		for _, n := range residents {
			if n.Stub.Home != home {
				continue
			}
			cands, conv, err := meet(team[1], n)
			if err != nil {
				return err
			}
			if !hasTopic(cands, "crowding") {
				continue
			}
			if early {
				out.crowdEarly++
				continue
			}
			out.crowding++
			if hasTopic(conv.Topics, "crowding") {
				out.crowdShown++
			}
		}
		return nil
	}
	crowdingAt := false
	for i, kind := range raises[:awareRaises] {
		if g.BuiltIn(region, day())+1 == out.line {
			if err := countCrowding(true); err != nil {
				return out, err
			}
		}
		if err := s.raise(team, home, kind); err != nil {
			return out, err
		}
		if g.BuiltIn(region, day()) >= out.line && !crowdingAt {
			crowdingAt = true
			out.residents = 0
			for _, n := range residents {
				if n.Stub.Home == home {
					out.residents++
				}
			}
			out.crowdMeets = out.residents
			if err := countCrowding(false); err != nil {
				return out, err
			}
		}
		if _, err := g.Advance(); err != nil {
			return out, err
		}
		if (i+1)%(awareRaises/raiseDays) == 0 {
			if err := s.days(1); err != nil {
				return out, err
			}
		}
	}
	out.built = g.BuiltIn(region, day())
	went := map[string]int{}
	for _, n := range residents {
		if n.Stub.Home == home {
			out.stayed++
			continue
		}
		out.moved++
		if r.NPC.Role(n.Stub.Role).Rooted {
			out.rootedMoved++
		}
		if _, ok := g.SettlementAt(n.Stub.Home); ok {
			went["to another settlement"]++
		} else {
			went[fmt.Sprintf("to open ground %d tiles off", hex.Distance(home, n.Stub.Home))]++
		}
	}
	var where []string
	for _, k := range slices.Sorted(maps.Keys(went)) {
		where = append(where, fmt.Sprintf("%d %s", went[k], k))
	}
	out.went = strings.Join(where, ", ")
	if out.moved == 0 {
		out.went = "nobody"
	}
	for _, n := range residents {
		if n.Stub.Home != home {
			continue
		}
		cands, _, err := meet(team[2], n)
		if err != nil {
			return out, err
		}
		if hasTopic(cands, "moved-away") {
			out.movedAway++
		}
	}

	// A week after the routes were laid: the next meeting relays each.
	for _, n := range residents {
		if n.Stub.Home == home && n.Laid > sheets.TicksPerDay {
			out.relaidEarly++
		}
	}
	if err := s.days(r.NPC.Param("relay-days") + 1 - day()); err != nil {
		return out, err
	}
	for i, n := range residents {
		c := team[i%len(team)]
		laid := n.Laid
		cands, _, err := meet(c, n)
		if err != nil {
			return out, err
		}
		if n.Stub.Home != home && laid > sheets.TicksPerDay {
			// A mover's route was laid afresh when it moved.
			continue
		}
		out.relayMeets++
		if n.Laid > laid {
			out.relaid++
		}
		out.longest = max(out.longest, n.Longer)
		if hasTopic(cands, "a-longer-road") {
			out.longer++
		}
		if !slices.ContainsFunc(g.PeopleHere(c, c.C.At), func(p game.Person) bool { return p.ID == n.Stub.ID }) {
			out.lost++
		}
	}
	return out, nil
}

// crowdLine is the crowding topic's line.
func crowdLine(b *sheets.Book) int64 {
	for _, t := range b.Topics {
		if t.When == "crowding" {
			return t.AtLeast
		}
	}
	return 0
}

// raisable lists the raises the first settlement can take in turn, a tier
// each in sheet order: every structure goals raise, up to its cap.
func raisable(g *game.Game, b *sheets.Book) []string {
	tiers := map[string]int64{}
	for _, st := range g.Places[0].Structures {
		tiers[st.Kind] = st.Tier
	}
	var out []string
	for added := true; added; {
		added = false
		for i := range b.Structures {
			row := &b.Structures[i]
			tier, built := tiers[row.ID]
			lines := row.Each
			if !built {
				lines = row.First
			}
			if tier+1 > settle.Cap(row, g.Rules().Settle) || len(lines) == 0 {
				continue
			}
			tiers[row.ID] = tier + 1
			out, added = append(out, row.ID), true
		}
	}
	return out
}

// raise has the team's officer post a structure's next tier at their
// settlement and the rest deliver what its goals ask, from stock granted
// for the run.
func (s *social) raise(team []*game.Char, home hex.Hex, kind string) error {
	g := s.g
	before := len(g.Goals)
	team[0].C.At = home
	if err := s.act(game.Command{Char: team[0].C.ID, Kind: game.Raise, Slot: kind}); err != nil {
		return err
	}
	for i, x := range g.Goals[before:] {
		c := team[1+i%(len(team)-1)]
		c.C.At = home
		var material string
		for _, m := range g.Rules().Book.Materials {
			if slices.Contains(m.Tags, x.Cond.Tag) {
				material = m.ID
				break
			}
		}
		if err := s.act(game.Command{Char: c.C.ID, Kind: game.Correct, Asset: ledger.Goods(material), Units: x.Cond.Count, Note: "social run stock"}); err != nil {
			return err
		}
		if err := s.act(game.Command{Char: c.C.ID, Kind: game.DeliverGoal, Target: x.ID, Material: material, Units: x.Cond.Count}); err != nil {
			return err
		}
	}
	return nil
}

type spoilsResult struct {
	players              []*agent.Player
	finds                int
	found, pooled, drops int64
	downs, encounters    int64
	ok                   bool
}

// spoilsRun plays a team for some world days and audits every ledger
// transaction: a find only moves goods out of a pool, and no pool gives
// more than it took in.
func spoilsRun(b *sheets.Book) (spoilsResult, error) {
	r, err := game.NewRules(b, keys.Throwaway("social-spoils"))
	if err != nil {
		return spoilsResult{}, err
	}
	g, err := game.New(r)
	if err != nil {
		return spoilsResult{}, err
	}
	l := service.NewLocal(g)
	team := agent.Players("s", spoilsPlayers, agent.Wanderer{BandOrder: agent.Bands(b), Bold: true})
	script := agent.NewScript(l, team, "social-spoils")
	out := spoilsResult{players: team, ok: true}
	in, gave := map[string]int64{}, map[string]int64{}
	audit := func(txns []ledger.Txn) {
		for _, t := range txns {
			for _, leg := range t.Legs {
				pool := strings.HasPrefix(leg.Account, ledger.Pool+"tile:")
				switch {
				case t.Kind == "find" && leg.Units < 0 && !pool:
					out.ok = false
				case t.Kind == "find" && leg.Units < 0:
					gave[leg.Account+" "+leg.Asset] -= leg.Units
					out.found -= leg.Units
				case pool && leg.Units > 0:
					in[leg.Account+" "+leg.Asset] += leg.Units
					out.pooled += leg.Units
				}
			}
			if t.Kind == "find" {
				out.finds++
			}
			if t.Kind == "dropped" {
				out.drops++
			}
		}
	}
	for tick := range spoilsDays * sheets.TicksPerDay {
		if err := script.Turn(context.Background(), int64(tick)); err != nil {
			return out, err
		}
		audit(l.Txns())
		if _, err := g.Advance(); err != nil {
			return out, err
		}
		_, txns := g.Flush()
		audit(txns)
	}
	for _, c := range g.Chars {
		out.downs += c.C.Fights.Downs
		out.encounters += c.Encounters
	}
	for k, n := range gave {
		if n > in[k] {
			out.ok = false
		}
	}
	return out, nil
}

type costResult struct {
	perDay time.Duration
	heapMB uint64
	// days the book was run to, the routes then due, and the NPCs
	// anything touched on the way.
	days, due int64
	touched   int
}

// dayCost times world days with a book of n saved NPCs, each on a route
// of its home tile.
func dayCost(b *sheets.Book, n int) (costResult, error) {
	r, err := game.NewRules(b, keys.Throwaway("social-cost"))
	if err != nil {
		return costResult{}, err
	}
	g, err := game.New(r)
	if err != nil {
		return costResult{}, err
	}
	home := r.Gen.Settlement(0).Hex
	for i := range n {
		nn := g.NPCs.Save(npc.Stub{ID: fmt.Sprintf("w-%08d", i), Kind: npc.Wanderer, Role: "road-scout", Name: "x", Home: home}, 0)
		nn.Route = []hex.Hex{home}
	}
	g.NPCs.Rebuild()
	var times []time.Duration
	for range timedDays {
		start := time.Now()
		for range sheets.TicksPerDay {
			if _, err := g.Advance(); err != nil {
				return costResult{}, err
			}
			if _, err := g.Digest(); err != nil {
				return costResult{}, err
			}
			g.Flush()
		}
		times = append(times, time.Since(start))
	}
	slices.Sort(times)
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	out := costResult{perDay: times[len(times)/2], heapMB: ms.HeapAlloc >> 20}
	// Past the week a route stands: every route is due and nothing has
	// relaid one, because nobody met its NPC.
	chain := g.NPCs.Chain
	for g.Tick() <= r.NPC.Param("relay-days")*sheets.TicksPerDay {
		if _, err := g.Advance(); err != nil {
			return costResult{}, err
		}
		g.Flush()
	}
	out.days = g.Tick() / sheets.TicksPerDay
	for _, nn := range g.NPCs.List {
		if r.NPC.Due(nn, g.Tick()) {
			out.due++
		}
	}
	out.touched = len(g.NPCs.Flush())
	if g.NPCs.Chain != chain {
		out.touched = max(out.touched, 1)
	}
	return out, nil
}
