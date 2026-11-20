package service

import (
	"cmp"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/sim/class"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
	"jams.team/mmo-world/sim/world"
)

// structural: how much of each list a page shows.
const (
	topShown   = 3  // contributors on a goal
	metShown   = 5  // met goals on a board
	citedShown = 3  // facts spelt out per claim
	nearShown  = 25 // characters offered to invite
)

// goals is /goals for a character: the board where it stands, the drafts
// and its own goals; away from a settlement, its own goals alone.
func (s *Server) goals(w http.ResponseWriter, r *http.Request) {
	var out api.Goals
	var banner render.BannerInput
	if !s.withCharErr(w, r, func(c *game.Char) error {
		g := s.g
		gp := func(id string) int64 { return sheets.IntParam(g.Rules().Book.GoalParams, id) }
		out = api.Goals{Settlement: -1, Name: g.PlaceName(c.C.At), Board: []api.Goal{}, Drafts: []api.Draft{}, Mine: []api.Goal{}, Met: []api.Goal{},
			Live: g.LiveGoals(c), Limit: gp("live-goals"), Fee: g.Rules().Values.Param("goal-fee"), FeeLeast: g.Rules().Values.Param("goal-fee-min"),
			RewardLeast: gp("reward-least"), PledgeNeed: gp("pledge-need"), EachCap: gp("each-cap"), Verbs: slices.Clone(goal.Verbs), Coin: c.C.Coin,
			Targets: []api.Targets{}, At: apiHex(c.C.At), Traits: []api.Pick{}, Places: []api.Pick{}, Fields: []api.Pick{}, Vows: []api.Pick{},
			Party: []api.Pick{}, PartyMost: gp("party-most"), Even: g.EvenShares(c), Waiting: []api.Waiting{}}
		for _, x := range g.PostedBy(c) {
			out.Mine = append(out.Mine, apiGoal(g, x, c))
		}
		for _, w := range g.WaitingFor(c) {
			out.Waiting = append(out.Waiting, api.Waiting{Place: g.PlaceName(w.At), Goods: heldGoods(w.Goods)})
		}
		banner = s.bannerInput(c.C.At)
		n, ok := g.SettlementAt(c.C.At)
		if !ok {
			return nil
		}
		out.Settlement = n
		if gd, _ := g.RunsHere(c); gd != nil {
			out.Officer = gd.G.IsOfficer(c.C.ID)
		}
		// A personal or party goal hangs on the board for its own alone.
		for _, x := range g.Board(n) {
			if x.May(c.C.ID) || x.Poster == c.C.ID {
				out.Board = append(out.Board, apiGoal(g, x, c))
			}
		}
		for i := len(g.Goals) - 1; i >= 0 && len(out.Met) < metShown; i-- {
			if x := g.Goals[i]; x.Board == n && x.State == goal.Done && !x.Hidden && x.May(c.C.ID) {
				out.Met = append(out.Met, apiGoal(g, x, c))
			}
		}
		for _, d := range g.Drafts(c) {
			out.Drafts = append(out.Drafts, api.Draft{Why: d.Why, Spec: apiSpec(d.Spec)})
		}
		out.Targets = goalTargets(g, c, n)
		narrowings(g, c, &out)
		out.Line, out.Within, out.Ephemeral = gp("bounty-threat"), g.Near(), sheets.TicksPerDay
		return nil
	}) {
		return
	}
	var err error
	if out.Banner, err = s.banner(banner); err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

// board is every settlement's live public goals, one forum post each.
func (s *Server) board(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	g := s.g
	out := api.Board{Tick: g.Tick(), Every: sheets.IntParam(g.Rules().Book.GoalParams, "progress-ticks"), Posts: []api.BoardPost{}}
	var banners []render.BannerInput
	for n, h := range g.Settlements() {
		for _, x := range g.Board(n) {
			if x.Scope == goal.Personal || x.Scope == goal.Party {
				continue
			}
			out.Posts = append(out.Posts, api.BoardPost{Settlement: n, Name: g.PlaceName(h), Goal: apiGoal(g, x, nil)})
			banners = append(banners, s.bannerInput(h))
		}
	}
	for _, x := range g.Goals {
		if x.Hidden && x.Scope != goal.Personal && x.Scope != goal.Party {
			out.Hidden = append(out.Hidden, x.ID)
		}
	}
	unlock()
	for i := range out.Posts {
		var err error
		if out.Posts[i].Banner, err = s.banner(banners[i]); err != nil {
			s.internal(w, err)
			return
		}
	}
	reply(w, http.StatusOK, out)
}

// apiGoal is a goal as the board shows it, to a character if one looks.
func apiGoal(g *game.Game, x *game.Goal, c *game.Char) api.Goal {
	out := api.Goal{ID: x.ID, Title: x.Title, Note: x.Note, Issuer: x.Issuer.Kind, By: issuerName(g, x), Verb: x.Cond.Verb, What: condText(g, x.Cond),
		Where: placeRef(g, x.Cond.At), Reward: x.Reward, Mode: x.Mode, Cap: x.Cap, Lifetime: x.Lifetime, Turnover: x.Turnover, State: x.State,
		Progress: x.Total(), Count: x.Cond.Count, Claims: int64(len(x.Claims)), Need: x.Need, Pledged: x.Pledges.Sum(), Vow: x.Vow(), Top: []api.Contribution{},
		Evolved: x.Evolved != 0 && x.Evolved == g.World.Day, Even: x.Even}
	if x.State == goal.Proposed {
		out.Reward, out.Vow = out.Pledged, false
	}
	if x.Cond.Hold() {
		out.Progress = x.Streak
	}
	switch d := g.Char(x.Cond.Who); {
	case x.Cond.Verb == goal.Haul:
		out.From = placeRef(g, x.Cond.From)
	case x.Cond.Verb == goal.Carry && d != nil:
		out.From = fmt.Sprintf("%s, %d tiles away", g.PlaceName(d.C.At), hex.Distance(d.C.At, g.SettlementHex(x.Board)))
	}
	if x.Expires > 0 {
		out.Left = max(0, x.Expires-g.Tick())
	}
	out.Takes = []api.Goods{}
	if c != nil {
		out.Mine = x.Poster == c.C.ID
		out.CanPledge, out.CanWithdraw = game.TakesPledges(x), g.CanWithdraw(x, c)
		out.Yours = x.Progress.Get(c.C.ID)
		if x.State == goal.Live {
			for _, s := range c.C.Goods {
				if n := min(s.Qty, x.Left(c.C.ID)); n > 0 && g.Takes(x, c, s.Material) {
					out.Takes = append(out.Takes, api.Goods{Material: s.Material, Units: n})
				}
			}
		}
		out.Haul = g.HaulHere(x, c)
	}
	top := slices.Clone(x.Progress)
	slices.SortStableFunc(top, func(a, b tally.Count) int { return cmp.Compare(b.N, a.N) })
	for _, t := range top[:min(len(top), topShown)] {
		out.Top = append(out.Top, api.Contribution{Who: charName(g, t.Key), Units: t.N})
	}
	if x.Cargo != nil && x.Cargo.Hauler != "" {
		out.Hauler = charName(g, x.Cargo.Hauler)
	}
	if x.Build != nil {
		out.Building = x.Build.Structure
	}
	if x.State == goal.Done {
		for _, cl := range x.Claims {
			paid := api.GoalClaim{Who: charName(g, cl.Who), Units: cl.Units, Coin: cl.Coin, Cited: int64(len(cl.Facts))}
			var cited []fact.Fact
			for _, id := range cl.Facts {
				if f, ok := g.Log.Get(id); ok && len(cited) < citedShown {
					cited = append(cited, f)
				}
			}
			paid.Facts = apiFacts(cited)
			out.Paid = append(out.Paid, paid)
		}
	}
	return out
}

// issuerName names who issued a goal.
func issuerName(g *game.Game, x *game.Goal) string {
	switch x.Issuer.Kind {
	case goal.ByFaction:
		fi, _ := strconv.Atoi(x.Issuer.ID)
		return g.FactionName(fi)
	case goal.BySettlement:
		return g.PlaceName(g.SettlementHex(x.Board))
	case goal.ByAdmin:
		if gd := g.GuildOf(x.Issuer.ID); gd != nil {
			return gd.G.Name
		}
	}
	return charName(g, x.Poster)
}

// condText says a condition in words: the verb, the amount and the
// target.
func condText(g *game.Game, c goal.Condition) string {
	what := c.Kind
	switch {
	case c.Kind != "" && c.Verb == goal.Deliver, c.Kind != "" && c.Verb == goal.Haul:
		what = g.MaterialName(c.Kind)
	case c.Kind != "" && c.Verb == goal.Make:
		what = g.KindName(c.Kind)
	case c.Tag != "" && c.Kind == "":
		what = "anything " + c.Tag
	}
	if c.Trait != "" {
		what += " with " + c.Trait
	}
	switch c.Verb {
	case goal.Hold:
		if c.Abstains() {
			return "hold off " + c.Tag
		}
		side := "above"
		if c.Below {
			side = "below"
		}
		return fmt.Sprintf("hold %s %s %d for %d world days", c.Gauge, side, c.Line, c.Count)
	case goal.Discover:
		if c.Field != "" {
			what = fmt.Sprintf("a tile with %s %d or more", c.Field, c.AtLeast)
		}
		if c.Within > 0 {
			what += fmt.Sprintf(" within %d tiles", c.Within)
		}
	case goal.Carry:
		return "carry " + charName(g, c.Who) + " home"
	case goal.Reach:
		return "reach " + placeRef(g, c.At)
	}
	if what == "" {
		what = "any"
	}
	return fmt.Sprintf("%s %d %s", c.Verb, c.Count, strings.TrimSpace(what))
}

// placeRef names a settlement, region or tile ref.
func placeRef(g *game.Game, ref string) string {
	kind, id, ok := goal.ParseRef(ref)
	if !ok {
		return ref
	}
	switch kind {
	case goal.PlaceSettlement:
		if n, ok := goal.SettlementOf(ref); ok && n < len(g.Places) {
			return g.PlaceName(g.SettlementHex(n))
		}
	case goal.PlaceRegion:
		return g.Rules().NPC.PlaceName(goal.PlaceRegion, id)
	case goal.PlaceTile:
		return "the tile at " + id
	}
	return ref
}

func simGoal(s api.GoalSpec) game.GoalSpec {
	c := s.Cond
	out := game.GoalSpec{Title: s.Title, Note: s.Note, Issuer: s.Issuer, Members: s.Members, Reward: s.Reward, Mode: s.Mode, Cap: s.Cap,
		Lifetime: s.Lifetime, Turnover: s.Turnover, Ticks: s.Ticks, Even: s.Even, Material: s.Material, Units: s.Units,
		Cond: goal.Condition{Verb: c.Verb, Kind: c.Kind, Tag: c.Tag, Trait: c.Trait, Count: c.Count, At: c.At, Within: c.Within, From: c.From,
			Field: c.Field, AtLeast: c.AtLeast, Gauge: c.Gauge, Line: c.Line, Below: c.Below, Who: c.Who, Side: c.Side}}
	if c.Hex != nil {
		h := simHex(*c.Hex)
		out.Cond.Hex = &h
	}
	return out
}

func apiSpec(s game.GoalSpec) api.GoalSpec {
	c := s.Cond
	out := api.GoalSpec{Title: s.Title, Note: s.Note, Issuer: s.Issuer, Members: s.Members, Reward: s.Reward, Mode: s.Mode, Cap: s.Cap,
		Lifetime: s.Lifetime, Turnover: s.Turnover, Ticks: s.Ticks, Even: s.Even, Material: s.Material, Units: s.Units,
		Cond: api.Condition{Verb: c.Verb, Kind: c.Kind, Tag: c.Tag, Trait: c.Trait, Count: c.Count, At: c.At, Within: c.Within, From: c.From,
			Field: c.Field, AtLeast: c.AtLeast, Gauge: c.Gauge, Line: c.Line, Below: c.Below, Who: c.Who, Side: c.Side}}
	if c.Hex != nil {
		h := apiHex(*c.Hex)
		out.Cond.Hex = &h
	}
	return out
}

// guild is /guild: the character's guild, its settlements and works, and
// whether its tile can be chartered.
func (s *Server) guild(w http.ResponseWriter, r *http.Request) {
	var out api.Guild
	var banner render.BannerInput
	if !s.withChar(w, r, func(c *game.Char) {
		out = apiGuild(s.g, c)
		banner = s.bannerInput(c.C.At)
	}) {
		return
	}
	var err error
	if out.Banner, err = s.banner(banner); err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

func apiGuild(g *game.Game, c *game.Char) api.Guild {
	r := g.Rules()
	out := api.Guild{Members: []api.GuildMember{}, Bank: []api.Goods{}, Works: []api.GuildWork{}, Settlements: []api.Settlement{},
		Approvals: []api.Approval{}, Votes: []api.GuildVote{}, Invites: []api.Pick{}, Near: []api.Pick{}, Least: r.Guild.Least, DrawShare: r.Guild.DrawShare,
		Charter: apiCharter(g.CharterAt(c))}
	for _, gd := range g.Guilds {
		if slices.Contains(gd.Invited, c.C.ID) {
			out.Invites = append(out.Invites, api.Pick{Value: gd.G.ID, Label: gd.G.Name})
		}
	}
	gd := g.GuildOf(c.C.Guild)
	if gd == nil {
		return out
	}
	gg := gd.G
	out.ID, out.Name, out.Server, out.Leader = gg.ID, gg.Name, gg.Server != "", charName(g, gg.Leader)
	out.Named, out.OfficersMax, out.Full, out.Officer = gg.Named(), gg.Officers(r.Guild), gg.Full(r.Guild), gg.IsOfficer(c.C.ID)
	out.BankHere = g.BankHere(c)
	if out.Officer {
		out.Spend = max(0, r.Guild.OfficerSpend-gg.SpentToday(c.C.ID, g.World.Day))
		for _, o := range g.CharsAt(c.C.At) {
			if gg.Member(o.C.ID) == nil && len(out.Near) < nearShown {
				out.Near = append(out.Near, api.Pick{Value: o.C.ID, Label: charName(g, o.C.ID)})
			}
		}
	}
	for _, m := range gg.Rank(true) {
		if gg.IsOfficer(m.Char) {
			out.Officers++
		}
		v := api.GuildMember{ID: m.Char, Name: charName(g, m.Char), Leader: m.Char == gg.Leader,
			Officer: m.Officer, Admin: m.Admin, Draw: m.Draw, Put: m.Put, Season: m.Season, CanPromote: g.CanPromote(gd, c, m.Char)}
		for _, role := range []string{guild.Leader, guild.Officer} {
			if v.Removable == "" && gg.Removable(m.Char, role) {
				v.Removable = role
			}
		}
		out.Members = append(out.Members, v)
	}
	out.Treasury, out.Bank = g.Ledger.Of(gd.Pool(), ledger.Coin), heldGoods(g.Ledger.Held(gd.Pool()))
	runs, here := g.RunsHere(c)
	for _, p := range g.Places {
		if p.Guild == gg.ID {
			out.Settlements = append(out.Settlements, apiSettlement(g, p, p == here))
		}
	}
	for _, row := range r.Book.GuildWorks {
		w := api.GuildWork{ID: row.ID, Name: row.ID, Gives: row.Gives, By: row.By, Needs: row.Needs, Waits: row.Waits, Days: g.StockDays(gd, &row),
			Spares: guild.SparesCoin(row.Gives), Uses: apiLines(row.Uses)}
		if runs == gd {
			if on := gg.Work(row.ID, here.N); on != nil {
				w.On, w.Ran, w.Used, w.Gave = true, on.Days, on.Used, on.Gave
			}
			w.Can = out.Officer && (w.On || game.CanWork(here, &row))
		}
		out.Works = append(out.Works, w)
	}
	for _, a := range gg.Approvals {
		out.Approvals = append(out.Approvals, api.Approval{ID: a.ID, By: charName(g, a.By), To: charName(g, a.To),
			What: fmt.Sprintf("%d %s", a.Units, a.Asset), Value: a.Value, Goods: a.Asset != ledger.Coin, Can: g.CanApprove(gd, c, a.ID)})
	}
	for _, v := range gg.Votes {
		out.Votes = append(out.Votes, api.GuildVote{Target: charName(g, v.Target), Role: v.Role, For: int64(len(v.For)),
			Need: g.VotesNeeded(gd)})
	}
	return out
}

func apiSettlement(g *game.Game, p *game.Place, here bool) api.Settlement {
	r := g.Rules()
	out := api.Settlement{N: p.N, Name: g.PlaceName(p.Hex), Treasury: g.Ledger.Of(game.TreasuryPool(p.N), ledger.Coin), Here: here, Structures: []api.Structure{},
		ConditionMax: r.Settle.ConditionMax}
	for _, row := range r.Book.Structures {
		st := p.Get(row.ID)
		v := api.Structure{Kind: row.ID, Name: row.ID, MaxTier: settle.Cap(&row, r.Settle), Raising: g.Raising(p.N, row.ID)}
		if st != nil {
			v.Stands, v.Tier, v.Condition, v.Closed = true, st.Tier, st.Condition, st.Closed()
			// A part first, the share a closed structure reopens at, then all of it.
			missing := r.Settle.ConditionMax - st.Condition
			part := min(missing, r.Settle.ReopenShare/max(r.Settle.RepairShare, 1))
			for _, points := range slices.Compact([]int64{part, missing}) {
				if points > 0 {
					v.Repairs = append(v.Repairs, api.Repair{Points: points, Cost: apiLines(g.StructureRepair(p, row.ID, points))})
				}
			}
		}
		tier, lines, ok := p.Next(&row, r.Settle)
		if ok {
			v.Waits = game.RaiseWaits(p, &row)
		}
		v.CanRaise = ok && !v.Raising && v.Waits == ""
		if tier <= v.MaxTier {
			v.Next = apiLines(lines)
		}
		out.Structures = append(out.Structures, v)
	}
	return out
}

// classes is /classes: every class, its thresholds and its tree.
func (s *Server) classes(w http.ResponseWriter, r *http.Request) {
	var out api.Classes
	if !s.withChar(w, r, func(c *game.Char) { out = apiClasses(s.g, c) }) {
		return
	}
	reply(w, http.StatusOK, out)
}

func apiClasses(g *game.Game, c *game.Char) api.Classes {
	r := g.Rules()
	_, here := g.SettlementAt(c.C.At)
	out := api.Classes{Classes: []api.Class{}, Active: int64(len(c.C.Classes.Active)), Most: r.Class.Active, Here: here}
	for i := range r.Book.Classes {
		row := &r.Book.Classes[i]
		v := api.Class{ID: row.ID, Name: titleOf(row.ID), Leans: row.Leans, Earned: c.C.Classes.Has(row.ID), Active: slices.Contains(c.C.Classes.Active, row.ID),
			Needs: []api.Need{}, Tiers: []api.Tier{}}
		for _, e := range c.C.Classes.Earned {
			if e.ID == row.ID {
				v.First = e.First
			}
		}
		for _, q := range row.Unlock {
			v.Needs = append(v.Needs, api.Need{What: q.Kind + " " + q.ID, Have: class.Progress(q, g.ClassReader(c)), At: q.At})
		}
		v.Level = g.ClassLevel(c, row.ID)
		open := class.Tiers(v.Level, r.Class)
		for _, tier := range class.AllTiers(r.Class) {
			t := api.Tier{Level: tier, Open: slices.Contains(open, tier), Options: []api.Ability{}}
			for _, a := range r.Book.Abilities {
				if a.Class == row.ID && a.Tier == tier {
					t.Options = append(t.Options, api.Ability{ID: a.ID, Name: a.Name, Text: a.Text, Taken: slices.Contains(c.C.Classes.Abilities, a.ID), Waits: a.Waits})
				}
			}
			v.Tiers = append(v.Tiers, t)
		}
		out.Classes = append(out.Classes, v)
	}
	if tags := g.PreyTags(c); len(tags) > 0 {
		out.Prey = &api.Prey{Tags: tags, Today: g.PreyToday(c)}
	}
	return out
}

// titleOf capitalises an id for display.
func titleOf(id string) string {
	if id == "" {
		return id
	}
	return strings.ToUpper(id[:1]) + id[1:]
}

func apiCharter(c game.CharterView) api.Charter {
	out := api.Charter{Can: c.Can, Why: c.Why, Take: c.Take, Coin: c.Coin, Fields: c.Fields}
	for _, l := range c.Goods {
		switch l.Tag {
		case "timber":
			out.Timber = l.Quantity
		case "stone":
			out.Stone = l.Quantity
		}
	}
	return out
}

// structural: a select holds at most this many options.
const selectMost = 25

// narrowings fills what the posting form may narrow a goal by, and whom a
// party goal may name: the traits an item can carry, the regions a hold
// could be posted on, a tile's generated fields, the slots a vow holds off
// and the characters standing with the poster.
func narrowings(g *game.Game, c *game.Char, out *api.Goals) {
	r := g.Rules()
	for _, t := range r.Book.Traits[:min(len(r.Book.Traits), selectMost)] {
		out.Traits = append(out.Traits, api.Pick{Value: t.ID, Label: cmp.Or(r.Name("items.traits:"+t.ID), t.ID)})
	}
	for _, t := range out.Targets {
		if t.Verb == goal.Hold {
			out.Places = slices.Clone(t.Options)
		}
	}
	for _, f := range slices.Sorted(maps.Keys(r.Gen.Baseline(c.C.At).Fields())) {
		out.Fields = append(out.Fields, api.Pick{Value: f, Label: f})
	}
	for _, s := range r.Book.Slots {
		out.Vows = append(out.Vows, api.Pick{Value: s.ID, Label: "no " + s.ID})
	}
	for _, o := range g.CharsAt(c.C.At) {
		if o != c && len(out.Party) < selectMost {
			out.Party = append(out.Party, api.Pick{Value: o.C.ID, Label: charName(g, o.C.ID)})
		}
	}
}

// goalTargets are what each verb can be posted against from a settlement:
// goods to deliver, goods carried to haul to each other settlement, slots
// to make, material tags to find, creatures to defeat, places to reach and
// regions to hold.
func goalTargets(g *game.Game, c *game.Char, n int) []api.Targets {
	r := g.Rules()
	var deliver, haul, find, defeat, reach, hold []api.Pick
	tags := map[string]bool{}
	for _, m := range r.Book.Materials {
		deliver = append(deliver, api.Pick{Value: m.ID, Label: g.MaterialName(m.ID)})
		for _, t := range m.Tags {
			if !tags[t] {
				tags[t] = true
				find = append(find, api.Pick{Value: t, Label: "a source of " + t})
			}
		}
	}
	for _, s := range c.C.Goods {
		for m, h := range g.Settlements() {
			if m != n {
				haul = append(haul, api.Pick{Value: s.Material + ">" + strconv.Itoa(m), Label: g.MaterialName(s.Material) + " to " + g.PlaceName(h)})
			}
		}
	}
	for _, a := range r.Book.Creatures {
		defeat = append(defeat, api.Pick{Value: a.ID, Label: r.Name("creatures.archetypes:" + a.ID)})
	}
	for m, h := range g.Settlements() {
		if m != n {
			reach = append(reach, api.Pick{Value: goal.SettlementRef(m), Label: g.PlaceName(h)})
		}
	}
	for _, i := range g.RegionsNear(c.C.At) {
		region := api.Pick{Value: goal.RegionRef(world.RegionRef(i)), Label: g.RegionName(i)}
		hold, reach = append(hold, region), append(reach, region)
	}
	var makeT []api.Pick
	for _, s := range r.Book.Slots {
		makeT = append(makeT, api.Pick{Value: s.ID, Label: "any " + s.ID})
	}
	cut := func(cs []api.Pick) []api.Pick { return cs[:min(len(cs), selectMost)] }
	out := []api.Targets{}
	for _, t := range []api.Targets{{Verb: goal.Deliver, Options: cut(deliver)}, {Verb: goal.Make, Options: cut(makeT)}, {Verb: goal.Discover, Options: cut(find)},
		{Verb: goal.Defeat, Options: cut(defeat)}, {Verb: goal.Reach, Options: cut(reach)}, {Verb: goal.Haul, Options: cut(haul)}, {Verb: goal.Hold, Options: cut(hold)}} {
		if len(t.Options) > 0 {
			out = append(out, t)
		}
	}
	return out
}
