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
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
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
	al, err := alignmentRun(b)
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
	p("%d players of one guild at the first starting settlement of a world under throwaway key `social-aware` meet every resident and take a keyed choice, come back the next day, raise %d structures there through pooled goals over %d world days (in a book where no structure waits on a later system, so one settlement holds that many raises), and meet everyone again a week after the routes were laid. Topics are counted in the dossier (every topic whose predicate holds) and among the %d a meeting shows.", awarePlayers, awareRaises, raiseDays, aw.shown)
	p("")
	p("| Measure | Value | Expected | Holds |")
	p("| --- | --- | --- | --- |")
	for _, c := range aw.checks() {
		p("| %s | %s | %s | %s |", c.measure, c.value, c.expected, holds(c.ok))
	}
	p("")
	p("Who moved: %s. The longest road measured at a relay was %d%% longer than when it was laid; the longer-road topic was in %d dossiers. Crowding was shown in %d of %d meetings at the line.", aw.went, aw.longest, aw.longer, aw.crowdShown, aw.crowdMeets)
	p("")
	p("The spoils run: %d bold wanderers for %d world days: %d encounters, %d downs, %d of which dropped haul into pools. Thin herds leave many explores empty, so a run can see no drops; `TestFindsNeverMint` in sim/game plants one and has a stranger and its owner find it.", len(sp.players), spoilsDays, sp.encounters, sp.downs, sp.drops)
	p("")
	p("## Alignment")
	p("")
	p("Characters of a world under throwaway key `social-alignment` meet goals other characters post at the first starting settlement, each a goal met (GDD 5.10): +%d, toward zero by the depth rule, at most +%d a world day and +%d a day from one poster. One set at %d meets one goal from each of three posters a day until it is unremarked; one set at %d does the same until it leaves notorious. Then two characters post each other reward-%d goals %d times a day for %d world days, and each one's gain a day attributed to the other is read off its `alignment.moved` facts.", al.move, al.goodDay, al.pairDay, alignFrom, alignDeep, al.reward, pairRounds, pairDays)
	p("")
	p("| Measure | Value | Target | Holds |")
	p("| --- | --- | --- | --- |")
	p("| Good acts from %d to unremarked | %d (%s) | %d or fewer | %s |", alignFrom, al.back, joinInts(al.path), alignBackMost, holds(al.depthOK()))
	p("| Good acts from %d to leave notorious | %d, reaching %d | %d or more | %s |", alignDeep, al.leave, al.left, alignLeaveLeast, holds(al.leaveOK()))
	p("| Most a pair moved each other in a world day | +%d (of %d goals met a day each, over %d days) | +%d or less | %s |", al.pairMost, pairRounds, pairDays, al.pairDay, holds(al.pairOK()))
	if err := doc.save(out, "social.md"); err != nil {
		return nil, err
	}
	return []Measured{
		{Target: "alignment-depth", Value: fmt.Sprintf("%d acts from %d (%s); %d from %d to leave notorious", al.back, alignFrom, joinInts(al.path), al.leave, alignDeep), Holds: al.depthOK() && al.leaveOK()},
		{Target: "alignment-pair-cap", Value: fmt.Sprintf("at most +%d a world day from one partner over %d days of %d goals met each", al.pairMost, pairDays, pairRounds), Holds: al.pairOK()},
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
	if err := s.g.Teleport(c, at); err != nil {
		return game.Conversation{}, err
	}
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
		if err := g.Teleport(c, home); err != nil {
			return meetResult{}, err
		}
		people := g.PeopleHere(c, home)
		if i%2 == 1 {
			for _, h := range hex.DiscAt(home, 3) {
				if ps := g.PeopleHere(c, h); len(ps) > 0 && ps[0].Kind == npc.Wanderer {
					// Who a road sends is drawn once it is reached.
					if err := g.Teleport(c, h); err != nil {
						return meetResult{}, err
					}
					people = g.PeopleHere(c, h)
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

// awareCheck is one row of the awareness table.
type awareCheck struct {
	measure, value, expected string
	ok                       bool
}

// checks are what the awareness run is held to, a row of its table each.
func (a awareResult) checks() []awareCheck {
	return []awareCheck{
		{"Gossip of a neighbour, next-day meetings", fmt.Sprintf("in the dossier of %d of %d, shown in %d; %d name the player as \"you\"", a.gossip, a.gossipMeets, a.gossipShown, a.gossipOwn),
			"some, and none from outside the settlement", a.gossip > 0 && a.gossipFar == 0},
		{"Gossip heard by an NPC living outside the settlement", fmt.Sprintf("%d of %d meetings", a.gossipFar, a.farMeets), "none: one hop", a.gossipFar == 0},
		{"Structures built in the region inside the window", fmt.Sprintf("%d, from the region's counters", a.built), fmt.Sprintf("%d or more is crowded", a.line), a.built >= a.line},
		{"Crowding raised before the line, and at it", fmt.Sprintf("%d and %d of %d residents", a.crowdEarly, a.crowding, a.residents), "none, then all",
			a.crowdEarly == 0 && a.crowding == a.residents},
		{"Residents who moved home", fmt.Sprintf("%d of %d free to (%d the place cannot spare, none of whom moved: %s)", a.moved, a.free, a.rooted, holds(a.rootedMoved == 0)),
			"at least one", a.moved > 0 && a.rootedMoved == 0},
		{"Former neighbours who bring up the one who left", fmt.Sprintf("%d of %d", a.movedAway, a.stayed), "all", a.moved == 0 || a.movedAway == a.stayed},
		{"Routes relaid at the first meeting after a week", fmt.Sprintf("%d of %d; none before", a.relaid, a.relayMeets), "all", a.relaid == a.relayMeets && a.relaidEarly == 0},
		{"Meetings a relay took the NPC out of", fmt.Sprintf("%d", a.lost), "none", a.lost == 0},
	}
}

// ok reports whether every row holds.
func (a awareResult) ok() bool {
	return !slices.ContainsFunc(a.checks(), func(c awareCheck) bool { return !c.ok })
}

func hasTopic(ts []game.TopicView, id string) bool {
	return slices.ContainsFunc(ts, func(t game.TopicView) bool { return t.ID == id })
}

// awareRun plays what NPCs know of the world (GDD 4.18): gossip one hop
// deep, crowding from a region's build counters, residents moving home,
// and routes relaid at the first meeting after a week.
func awareRun(b *sheets.Book) (awareResult, error) {
	k := keys.Throwaway("social-aware")
	r, err := game.NewRules(allBuilt(b), k)
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
	out.line = g.CrowdLine()
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

// allBuilt is the book with no structure waiting on a later system. The
// run measures what NPCs make of building, not what a structure does, and
// one starting settlement holds too few raises that do something yet to
// crowd its region.
func allBuilt(b *sheets.Book) *sheets.Book {
	out := *b
	out.Structures = slices.Clone(b.Structures)
	for i := range out.Structures {
		out.Structures[i].Waits, out.Structures[i].TiersWait = "", ""
	}
	return &out
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
			var st *settle.Structure
			if tier, built := tiers[row.ID]; built {
				st = &settle.Structure{Tier: tier}
			}
			tier, _, ok := settle.Next(row, st, g.Rules().Settle)
			if !ok {
				continue
			}
			tiers[row.ID] = tier
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
	if err := g.Teleport(team[0], home); err != nil {
		return err
	}
	if err := s.act(game.Command{Char: team[0].C.ID, Kind: game.Raise, Slot: kind}); err != nil {
		return err
	}
	for i, x := range g.Goals[before:] {
		c := team[1+i%(len(team)-1)]
		if err := g.Teleport(c, home); err != nil {
			return err
		}
		material, _ := g.MaterialOfTag(x.Cond.Tag)
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

// Alignment rows (GDD 5.10, 18.3).
const (
	alignFrom       = -15 // a character this far down is back to unremarked
	alignBackMost   = 3   // within this many good acts
	alignDeep       = -80 // one this far down needs
	alignLeaveLeast = 25  // at least this many to leave notorious
)

// structural: the alignment run's shape: posters a day for the depth
// rows, and the pair's goals a day and its days.
const (
	alignPosters = 3
	alignCap     = 60 // world days the depth rows may take before they stop
	pairRounds   = 10
	pairDays     = 14
	alignCoin    = 10000
	alignStock   = 1000
)

// alignResult is the alignment run: the acts from alignFrom and their
// path, the acts from alignDeep and where they left it, and the most one
// of a pair moved the other in a world day.
type alignResult struct {
	move, goodDay, pairDay, reward int64
	back                           int
	path                           []int64
	leave                          int
	left                           int64
	pairMost                       int64
}

func (a alignResult) depthOK() bool { return a.back > 0 && a.back <= alignBackMost }
func (a alignResult) leaveOK() bool { return a.leave >= alignLeaveLeast }
func (a alignResult) pairOK() bool  { return a.pairMost > 0 && a.pairMost <= a.pairDay }

func joinInts(xs []int64) string {
	var s []string
	for _, x := range xs {
		s = append(s, fmt.Sprint(x))
	}
	return strings.Join(s, " → ")
}

// aligner is a Social world where characters meet each other's goals.
type aligner struct {
	*social
	n        int
	material string
	tag      string
	reward   int64
}

// alignmentRun plays the alignment rows on one world.
func alignmentRun(b *sheets.Book) (alignResult, error) {
	k := keys.Throwaway("social-alignment")
	r, err := game.NewRules(b, k)
	if err != nil {
		return alignResult{}, err
	}
	g, err := game.New(r)
	if err != nil {
		return alignResult{}, err
	}
	ap := g.AlignParams()
	a := &aligner{social: &social{g: g}, reward: ap.GoalRewardLeast}
	for _, m := range b.Materials {
		if len(m.Tags) > 0 {
			a.material, a.tag = m.ID, m.Tags[0]
			break
		}
	}
	home := r.Gen.Settlement(0).Hex
	n, ok := g.SettlementAt(home)
	if !ok {
		return alignResult{}, fmt.Errorf("alignment run: no settlement at %v", home)
	}
	a.n = n
	var cs []*game.Char
	for range alignPosters + 3 {
		res, err := a.do(game.Command{Kind: game.Create, Option: "hook"})
		if err != nil {
			return alignResult{}, err
		}
		c := res.Char
		if err := g.Teleport(c, home); err != nil {
			return alignResult{}, err
		}
		for _, x := range []struct {
			asset string
			units int64
		}{{ledger.Coin, alignCoin}, {ledger.Material(a.material), alignStock}} {
			if err := a.act(game.Command{Char: c.C.ID, Kind: game.Correct, Asset: x.asset, Units: x.units, Note: "alignment run stock"}); err != nil {
				return alignResult{}, err
			}
		}
		cs = append(cs, c)
	}
	posters, shallow, deep, pair := cs[:alignPosters], cs[alignPosters], cs[alignPosters+1], cs[alignPosters+1:]
	out := alignResult{move: a.actMove(b), goodDay: ap.GoodDay, pairDay: ap.PairDay, reward: a.reward}
	notorious := g.BandOf(ap.Min)

	shallow.C.Align().Value = alignFrom
	out.path = []int64{game.AlignmentOf(shallow)}
	for day := 0; day < alignCap && g.Band(shallow) != g.BandOf(0); day++ {
		for _, p := range posters {
			if _, err := a.meet(p, shallow); err != nil {
				return alignResult{}, err
			}
			out.back++
			out.path = append(out.path, game.AlignmentOf(shallow))
			if g.Band(shallow) == g.BandOf(0) {
				break
			}
		}
		if err := a.days(1); err != nil {
			return alignResult{}, err
		}
	}
	if g.Band(shallow) != g.BandOf(0) {
		out.back = 0
	}

	deep.C.Align().Value = alignDeep
	for day := 0; day < alignCap && g.Band(deep) == notorious; day++ {
		for _, p := range posters {
			if _, err := a.meet(p, deep); err != nil {
				return alignResult{}, err
			}
			out.leave++
			if g.Band(deep) != notorious {
				break
			}
		}
		if err := a.days(1); err != nil {
			return alignResult{}, err
		}
	}
	out.left = game.AlignmentOf(deep)

	deep.C.Align().Value = 0
	for range pairDays {
		got := map[string]int64{}
		for range pairRounds {
			for i, c := range pair {
				other := pair[1-i]
				facts, err := a.meet(other, c)
				if err != nil {
					return alignResult{}, err
				}
				for _, f := range facts {
					if f.Kind != factAlignmentMoved {
						continue
					}
					if who, ok := f.Get("partner"); ok && who.S == other.C.ID {
						d, _ := f.Get("delta")
						got[c.C.ID] += d.N
					}
				}
			}
		}
		for _, v := range got {
			out.pairMost = max(out.pairMost, v)
		}
		if err := a.days(1); err != nil {
			return alignResult{}, err
		}
	}
	return out, nil
}

// structural: the fact an alignment move writes and the act a goal met is.
const (
	factAlignmentMoved = "alignment.moved"
	actGoalMet         = "goal-met"
)

// actMove is the goal-met act's move, from the sheet.
func (a *aligner) actMove(b *sheets.Book) int64 {
	for _, r := range b.AlignActs {
		if r.ID == actGoalMet {
			return r.Move
		}
	}
	return 0
}

// meet has poster post a goal for one unit of the run's material at the
// least reward a goal met counts for, and runner deliver it; the facts are
// the delivery's.
func (a *aligner) meet(poster, runner *game.Char) ([]fact.Fact, error) {
	spec := game.GoalSpec{Title: "One for the road", Issuer: goal.ByCharacter, Reward: a.reward, Mode: goal.First, Lifetime: goal.Ephemeral,
		Turnover: goal.Expire, Ticks: sheets.TicksPerDay, Cond: goal.Condition{Verb: goal.Deliver, Tag: a.tag, Count: 1, At: goal.SettlementRef(a.n)}}
	if err := a.act(game.Command{Char: poster.C.ID, Kind: game.PostGoal, Goal: &spec}); err != nil {
		return nil, err
	}
	x := a.g.Goals[len(a.g.Goals)-1]
	res, err := a.do(game.Command{Char: runner.C.ID, Kind: game.DeliverGoal, Target: x.ID, Material: a.material, Units: 1})
	if err != nil {
		return nil, err
	}
	if x.State != goal.Done {
		return nil, fmt.Errorf("alignment run: goal %s is %s after its delivery", x.ID, x.State)
	}
	return res.Facts, nil
}
