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
)

// SocialRun measures the NPC targets (GDD 4.18): simulated players meet
// NPCs twice, and the second meeting is read for topics from their own
// history and for top topics that differ between histories. It also
// checks that triggers' finds only move goods out of spoils pools, and
// times a world day with 10 and with 1,000,000 saved NPCs.
func SocialRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	if n == 0 {
		n = socialPlayers
	}
	meet, err := meetings(b, n)
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
	p("| Finds from triggers | %d finds, %d goods, all out of spoils pools; pools took %d goods in | never add goods | %s |", sp.finds, sp.found, sp.pooled, holds(sp.ok))
	p("")
	p("Top topics at second meetings: %s.", mapList(meet.tops))
	p("")
	p("NPCs saved: %d. Histories seen: %d. Cost: the median of %d world days a book, each 144 ticks of `Advance` plus the digest each tick; a million NPCs held %d MB of heap.", meet.saved, meet.histories, timedDays, big.heapMB)
	p("")
	p("The spoils run: %d bold wanderers for %d world days: %d encounters, %d downs, %d of which dropped haul into pools. Thin herds leave many explores empty, so a run can see no drops; `TestFindsNeverMint` in sim/game plants one and has a stranger and its owner find it.", len(sp.players), spoilsDays, sp.encounters, sp.downs, sp.drops)
	if err := doc.save(out, "social.md"); err != nil {
		return nil, err
	}
	return []Measured{
		{Target: "npc-own-history", Value: fmt.Sprintf("%.1f%%", pct(meet.own, meet.second)), Holds: pct(meet.own, meet.second) >= targetHistory},
		{Target: "npc-top-differs", Value: fmt.Sprintf("%.1f%%", pct(meet.differ, meet.pairs)), Holds: pct(meet.differ, meet.pairs) >= targetUnique},
		{Target: "npc-cost-flat", Value: fmt.Sprintf("%+.1f%%", ratio), Holds: abs(ratio) <= costTolerance},
		{Target: "spoils-conserved", Value: fmt.Sprintf("%d finds from pools", sp.finds), Holds: sp.ok},
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
			if err := s.act(game.Command{Char: c.C.ID, Kind: game.Correct, Asset: ledger.Material(sold), Units: 3, Note: "social run stock"}); err != nil {
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
	return costResult{perDay: times[len(times)/2], heapMB: ms.HeapAlloc >> 20}, nil
}
