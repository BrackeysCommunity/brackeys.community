package agent

import (
	"cmp"
	"maps"
	"slices"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/sheets"
)

// GuildPlan is how the players of one run serve their servers' guilds:
// members give to what the guild is short of, admins switch works on,
// approve each other's payments, and one of them founds.
type GuildPlan struct {
	// Tags are the tags each material holds, from the sheets.
	Tags map[string][]string
	// GoodsShare and Tithe are the per cent of a carried stack, and of the
	// coin over its comfort, a member gives a day while the guild is short.
	GoodsShare, Tithe int64
	// StockDays is the stock members keep a work in, and StartDays the
	// stock an admin wants before switching one on, in world days.
	StockDays, StartDays int64
	// Works is whether its admins switch works on and its members stock
	// them; a guild saving for a charter may leave them dark.
	Works bool
	// Seek sends members out to where a material the guild is short of
	// was last seen, and farther afield while none has been.
	Seek bool
	// Every has members give each time they come home, not once a world
	// day.
	Every bool
	// Settlements is how many settlements a guild means to run: it founds
	// until it does.
	Settlements int
	// Distance is how far a new settlement stands from any other, in tiles.
	Distance int64

	mu     sync.Mutex
	boards map[string]*board
}

// NewGuildPlan is a plan under the sheets' material tags and founding
// distance.
func NewGuildPlan(b *sheets.Book) *GuildPlan {
	g := &GuildPlan{Tags: map[string][]string{provisions: {provisions}}, Distance: sheets.IntParam(b.SettlementParams, "found-distance")}
	for _, m := range b.Materials {
		g.Tags[m.ID] = m.Tags
	}
	return g
}

// board is what a server's players last read of their guild: its page as
// a member at home sees it, what it is short of, and whether its founder
// is out with the charter. It stands for the server's own channel.
type board struct {
	tick    int64
	fresh   bool
	page    api.Guild
	short   map[string]int64
	charter bool
	// sources are the tiles nearest home where each tag's goods were
	// seen, nearest first.
	sources map[string][]source
	// spent are the nodes a member found worked out.
	spent map[node]bool
}

type source struct {
	at   api.Hex
	dist int64
}

// node is a material on a tile.
type node struct {
	at       api.Hex
	material string
}

// structural: ticks a board's page is kept, about an hour.
const boardTicks = 6

// structural: the assets a deposit names besides a material, the tags a
// charter takes, and the tag a coin line carries.
const (
	provisions = "provisions"
	coin       = "coin"
	tagTimber  = "timber"
	tagStone   = "stone"
	tagCoin    = ""
)

func (g *GuildPlan) boardOf(server string) *board {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.boards == nil {
		g.boards = map[string]*board{}
	}
	b, ok := g.boards[server]
	if !ok {
		b = &board{}
		g.boards[server] = b
	}
	return b
}

// read is the guild's page for a member at home, kept for boardTicks or
// until an officer moves something; members' gifts in between are
// counted off what it is short of as they are promised, so a large guild
// does not reread its whole roll for every deposit.
func (g *GuildPlan) read(b *board, tick int64, desk *Desk) error {
	if b.fresh && tick-b.tick < boardTicks {
		return nil
	}
	page, err := desk.Guild()
	if err != nil {
		return err
	}
	b.page, b.tick, b.fresh = page, tick, true
	b.short = g.short(page, b.charter)
	return nil
}

// runnable reports whether a work does something yet and has the
// structure it needs where the page's reader stands.
func runnable(w api.GuildWork, page api.Guild) bool {
	if w.Waits != "" {
		return false
	}
	if w.Needs == "" {
		return true
	}
	for _, s := range page.Settlements {
		if !s.Here {
			continue
		}
		for _, st := range s.Structures {
			if st.Kind == w.Needs && st.Tier > 0 && !st.Closed {
				return true
			}
		}
	}
	return false
}

// held is what the guild holds by tag, coin under tagCoin.
func (g *GuildPlan) held(page api.Guild) map[string]int64 {
	have := map[string]int64{tagCoin: page.Treasury}
	for _, s := range page.Bank {
		for _, tag := range g.Tags[s.Material] {
			have[tag] += s.Units
		}
	}
	return have
}

// short is what the guild's runnable works take in StockDays, and its
// next charter unless that is already out, less what it holds, by tag.
func (g *GuildPlan) short(page api.Guild, charterOut bool) map[string]int64 {
	want := map[string]int64{}
	for _, w := range page.Works {
		if !g.Works || !runnable(w, page) {
			continue
		}
		for _, u := range w.Uses {
			want[u.Tag] += u.Quantity * g.StockDays
		}
	}
	if len(page.Settlements) < g.Settlements && !charterOut {
		want[tagTimber] += page.Charter.Timber
		want[tagStone] += page.Charter.Stone
		want[tagCoin] += page.Charter.Coin
	}
	have := g.held(page)
	out := map[string]int64{}
	for tag, n := range want {
		if n > have[tag] {
			out[tag] = n - have[tag]
		}
	}
	return out
}

// wanted reports whether a material holds a tag the guild is short of.
func (g *GuildPlan) wanted(short map[string]int64, material string) (string, bool) {
	for _, tag := range g.Tags[material] {
		if short[tag] > 0 {
			return tag, true
		}
	}
	return "", false
}

// prefer is the first material on a tile the server's guild is short of,
// or fallback.
func (g *GuildPlan) prefer(server string, materials []string, fallback string) string {
	if server == "" {
		return fallback
	}
	b := g.boardOf(server)
	for _, m := range materials {
		if _, ok := g.wanted(b.short, m); ok {
			return m
		}
	}
	return fallback
}

// seen notes where a member saw goods, for the others to find: the
// nearest few tiles to home for each tag.
func (g *GuildPlan) seen(server string, at, home api.Hex, materials []string) {
	if !g.Seek || server == "" {
		return
	}
	b, s := g.boardOf(server), source{at: at, dist: hexDistance(at, home)}
	for _, m := range materials {
		if b.spent[node{at, m}] {
			continue
		}
		for _, tag := range g.Tags[m] {
			list := b.sources[tag]
			if slices.Contains(list, s) || (len(list) == sourcesKept && list[len(list)-1].dist <= s.dist) {
				continue
			}
			i, _ := slices.BinarySearchFunc(list, s, func(a, x source) int { return cmp.Compare(a.dist, x.dist) })
			list = slices.Insert(list, i, s)
			if b.sources == nil {
				b.sources = map[string][]source{}
			}
			b.sources[tag] = list[:min(len(list), sourcesKept)]
		}
	}
}

// workedOut strikes a tile whose node gave nothing off the sources.
func (g *GuildPlan) workedOut(server string, at api.Hex, material string) {
	if !g.Seek || server == "" {
		return
	}
	b := g.boardOf(server)
	if b.spent == nil {
		b.spent = map[node]bool{}
	}
	b.spent[node{at, material}] = true
	for _, tag := range g.Tags[material] {
		b.sources[tag] = slices.DeleteFunc(b.sources[tag], func(s source) bool { return s.at == at })
	}
}

// structural: how a guild's members look for what it is short of.
const (
	sourcesKept = 12 // tiles remembered for a tag
	seekShare   = 50 // per cent of trips a member spends on the guild's errand
)

// errandFor is where a member setting out should go for its guild, on
// the trips it gives to that: one of the known sources of the tag it is
// shortest of, or, with none known for a tag it is short of, farther
// afield to look (seek).
func (g *GuildPlan) errandFor(server string, d *Dice) (to api.Hex, known, seek bool) {
	if !g.Seek || server == "" || !d.Percent(seekShare, "seek.trip") {
		return api.Hex{}, false, false
	}
	b := g.boardOf(server)
	var most int64
	var from []source
	for _, tag := range slices.Sorted(maps.Keys(b.short)) {
		if tag == tagCoin || tag == provisions || b.short[tag] <= 0 {
			continue
		}
		list := b.sources[tag]
		if len(list) == 0 {
			seek = true
			continue
		}
		if b.short[tag] > most {
			from, most = list, b.short[tag]
		}
	}
	if len(from) == 0 {
		return api.Hex{}, false, seek
	}
	return from[d.Below(len(from), "seek.source")].at, true, seek
}

// civic is a player's part in its guild and classes, kept with its trip.
type civic struct {
	// classDay and guildDay are the world day after the last on which it
	// read its classes and served its guild; 0 for never.
	classDay, guildDay int64
	away               bool // it has been off its home tile since it last gave
	server             string
	gifts              []api.ActionRequest
	phase              int
	dir, out           int
	waited             int64 // the day it began waiting at a site for the treasury
	// asked is what it has asked a second officer to approve, by tag.
	asked map[string]int64
}

// The phases of a founder's errand.
const (
	atHome   = iota
	drawing  // taking the charter's goods out of the bank
	walking  // carrying them to a free tile
	founding // the charter is sent; the page says whether it took
)

// structural: a founder's errand.
const (
	foundProvisions = 30 // provisions it leaves with
	foundWaitDays   = 2  // days it waits at a site for the treasury
	foundTurn       = 3  // times the founding distance it walks one way before it turns
)

// Civic takes an ability an open tier offers, and serves the guild: see
// GuildPlan.
func (e *Earner) Civic(o api.Options, desk *Desk, d *Dice) (api.ActionRequest, Verdict, error) {
	if o.Fight != nil || o.Long != nil || has(o.Conditions, api.CondDown) {
		return api.ActionRequest{}, Pass, nil
	}
	t := e.tripOf(o, d)
	day := o.Tick/sheets.TicksPerDay + 1
	if o.Purse.Market && t.civic.classDay != day && t.civic.phase == atHome {
		page, err := desk.Classes()
		if err != nil {
			return api.ActionRequest{}, Pass, err
		}
		if req, ok := classStep(page); ok {
			return req, Act, nil
		}
		t.civic.classDay = day
	}
	if e.Guild == nil || desk.Server() == "" {
		return api.ActionRequest{}, Pass, nil
	}
	b := e.Guild.boardOf(desk.Server())
	t.civic.server = desk.Server()
	if t.civic.phase != atHome {
		return e.errand(o, t, b, desk, d, day)
	}
	if !o.Purse.Market || o.At != t.home {
		t.civic.gifts, t.civic.away = nil, true
		return api.ActionRequest{}, Pass, nil
	}
	if t.civic.away && e.Guild.Every {
		t.civic.guildDay = 0
	}
	t.civic.away = false
	if desk.Admin() {
		page, err := desk.Guild()
		if err != nil {
			return api.ActionRequest{}, Pass, err
		}
		if req, ok := e.officer(o, t, b, page); ok {
			b.fresh = false
			return req, Act, nil
		}
		if t.civic.phase != atHome {
			return api.ActionRequest{}, Wait, nil
		}
	}
	if t.civic.guildDay == day {
		return api.ActionRequest{}, Pass, nil
	}
	if len(t.civic.gifts) == 0 {
		if err := e.Guild.read(b, o.Tick, desk); err != nil {
			return api.ActionRequest{}, Pass, err
		}
		if b.page.ID != "" {
			t.civic.gifts = e.Guild.gifts(o.Purse, t.comfort, b.short)
		}
	}
	if len(t.civic.gifts) == 0 {
		t.civic.guildDay = day
		return api.ActionRequest{}, Pass, nil
	}
	req := t.civic.gifts[0]
	t.civic.gifts = t.civic.gifts[1:]
	if len(t.civic.gifts) == 0 {
		t.civic.guildDay = day
	}
	return req, Act, nil
}

// classStep takes the first ability an open tier of an active class still
// offers, one its system reads if there is one; and makes an earned class
// active over a lower one, where classes are chosen.
func classStep(page api.Classes) (api.ActionRequest, bool) {
	lowest := int64(-1)
	for _, c := range page.Classes {
		if c.Active && (lowest < 0 || c.Level < lowest) {
			lowest = c.Level
		}
	}
	for _, c := range page.Classes {
		if !c.Earned {
			continue
		}
		if !c.Active {
			if page.Here && (page.Active < page.Most || c.Level > lowest) {
				return api.ActionRequest{Kind: api.ActChooseClass, Option: c.ID}, true
			}
			continue
		}
		for _, tier := range c.Tiers {
			if !tier.Open || len(tier.Options) == 0 || slices.ContainsFunc(tier.Options, func(a api.Ability) bool { return a.Taken }) {
				continue
			}
			pick := tier.Options[0]
			if i := slices.IndexFunc(tier.Options, func(a api.Ability) bool { return a.Waits == "" }); i >= 0 {
				pick = tier.Options[i]
			}
			return api.ActionRequest{Kind: api.ActTakeAbility, Option: pick.ID}, true
		}
	}
	return api.ActionRequest{}, false
}

// gifts are the deposits a member makes toward what the guild is short
// of: a share of each stack it carries that the guild wants, of the
// provisions over its floor, and of the coin over its comfort. They come
// off left, so the next member to read the board gives to what remains.
func (g *GuildPlan) gifts(p api.Purse, comfort int64, left map[string]int64) []api.ActionRequest {
	var out []api.ActionRequest
	give := func(tag, asset string, have, share int64) {
		n := min(left[tag], have, max(1, have*share/hundred))
		if n > 0 {
			left[tag] -= n
			out = append(out, api.ActionRequest{Kind: api.ActDeposit, Asset: asset, Units: n})
		}
	}
	for _, s := range p.Goods {
		if tag, ok := g.wanted(left, s.Material); ok {
			give(tag, s.Material, s.Units, g.GoodsShare)
		}
	}
	give(provisions, provisions, p.Provisions-provisionsFloor, g.GoodsShare)
	give(tagCoin, coin, p.Coin-comfort, g.Tithe)
	return out
}

// officer is an admin's day at home: approve a payment another officer
// asked for, switch on a work the bank can stock, and, for the admin who
// founds, set out once the guild holds a charter.
func (e *Earner) officer(o api.Options, t *trip, b *board, page api.Guild) (api.ActionRequest, bool) {
	g := e.Guild
	if !page.Officer {
		return api.ActionRequest{}, false
	}
	me := ""
	founder := true
	for _, m := range page.Members {
		if m.ID == o.CharacterID {
			me = m.Name
		}
		if m.Admin && m.ID < o.CharacterID {
			founder = false
		}
	}
	for _, a := range page.Approvals {
		if a.By != me {
			return api.ActionRequest{Kind: api.ActApprove, Option: a.ID}, true
		}
	}
	for _, w := range page.Works {
		if g.Works && runnable(w, page) && w.Can && !w.On && w.Days >= g.StartDays {
			return api.ActionRequest{Kind: api.ActWork, Option: w.ID, Units: 1}, true
		}
	}
	if !founder || len(page.Settlements) >= g.Settlements || b.charter {
		return api.ActionRequest{}, false
	}
	have, c := g.held(page), page.Charter
	var keep int64
	for _, w := range page.Works {
		for _, u := range w.Uses {
			if w.On && u.Tag == tagCoin {
				keep += u.Quantity * g.StartDays
			}
		}
	}
	if have[tagTimber] >= c.Timber && have[tagStone] >= c.Stone && have[tagCoin] >= c.Coin+keep {
		t.civic.phase, b.charter = drawing, true
	}
	return api.ActionRequest{}, false
}

// carried is what a purse holds of a tag's goods.
func (g *GuildPlan) carried(p api.Purse, tag string) int64 {
	var n int64
	for _, s := range p.Goods {
		if slices.Contains(g.Tags[s.Material], tag) {
			n += s.Units
		}
	}
	return n
}

// errand is the founder's: draw the charter's goods from the bank, a
// day's spend at a time or by a second officer's approval, carry them
// out past the founding distance, and charter the first tile that takes
// one.
func (e *Earner) errand(o api.Options, t *trip, b *board, desk *Desk, d *Dice, day int64) (api.ActionRequest, Verdict, error) {
	g, p, cv := e.Guild, o.Purse, &t.civic
	done := func() (api.ActionRequest, Verdict, error) {
		cv.phase, b.charter, b.fresh = atHome, false, false
		t.out, t.worked, t.forages = 0, tripGathers, 0
		return api.ActionRequest{}, Pass, nil
	}
	page, err := desk.Guild()
	if err != nil {
		return api.ActionRequest{}, Pass, err
	}
	if len(page.Settlements) >= g.Settlements {
		return done()
	}
	c := page.Charter
	switch cv.phase {
	case drawing:
		if len(page.Approvals) == 0 {
			cv.asked = nil
		}
		waiting := false
		for _, line := range []struct {
			tag  string
			need int64
		}{{tagTimber, c.Timber}, {tagStone, c.Stone}} {
			need := line.need - g.carried(p, line.tag)
			if need <= 0 {
				continue
			}
			waiting = true
			if need -= cv.asked[line.tag]; need <= 0 {
				continue
			}
			for _, s := range page.Bank {
				if !slices.Contains(g.Tags[s.Material], line.tag) {
					continue
				}
				units, v := min(need, s.Units), quote(p, s.Material).Value
				switch fit := page.Spend / max(v, 1); {
				case v > 0 && fit > 0:
					units = min(units, fit)
				case page.Officers > 1:
					if cv.asked == nil {
						cv.asked = map[string]int64{}
					}
					cv.asked[line.tag] += units
				default:
					return api.ActionRequest{}, Wait, nil
				}
				b.fresh = false
				return api.ActionRequest{Kind: api.ActPay, Target: o.CharacterID, Asset: s.Material, Units: units, Note: "charter"}, Act, nil
			}
		}
		if waiting {
			return api.ActionRequest{}, Wait, nil
		}
		if n := min(foundProvisions-p.Provisions, p.Coin/max(p.Provision, 1)); n > 0 && p.Provision > 0 {
			return api.ActionRequest{Kind: api.ActBuy, Asset: provisions, Units: n}, Act, nil
		}
		cv.phase, cv.dir, cv.out, cv.waited = walking, d.Below(len(o.Moves), "found.dir"), 0, 0
		fallthrough
	case walking, founding:
		if g.carried(p, tagTimber) < c.Timber || g.carried(p, tagStone) < c.Stone {
			return done()
		}
		if c.Can && cv.phase == walking {
			cv.phase = founding
			if c.Take {
				return api.ActionRequest{Kind: api.ActCharter}, Act, nil
			}
			return api.ActionRequest{Kind: api.ActFound, Note: "New " + desk.Server()}, Act, nil
		}
		cv.phase = walking
		if !p.Market && hexDistance(o.At, t.home) >= g.Distance && page.Treasury < c.Coin && !c.Take {
			if cv.waited == 0 {
				cv.waited = day
			}
			if day-cv.waited < foundWaitDays {
				return api.ActionRequest{}, Wait, nil
			}
			return done()
		}
		if !p.Market && p.Provisions < tripTiles && t.forages < tripGathers {
			t.forages++
			return api.ActionRequest{Kind: api.ActForage, Ticks: o.GatherMax}, Act, nil
		}
		if p.Provisions >= tripTiles {
			t.forages = 0
		}
		if cv.out >= foundTurn*int(g.Distance) {
			cv.dir, cv.out = d.Below(len(o.Moves), "found.dir"), 0
		}
		cv.out++
		for _, m := range o.Moves {
			if m.Dir == cv.dir && m.Open {
				return api.ActionRequest{Kind: api.ActStep, Dir: m.Dir}, Act, nil
			}
		}
		cv.dir = d.Below(len(o.Moves), "found.dir")
		req, ok := step(o, d)
		if !ok {
			return api.ActionRequest{}, Wait, nil
		}
		return req, Act, nil
	}
	return done()
}
