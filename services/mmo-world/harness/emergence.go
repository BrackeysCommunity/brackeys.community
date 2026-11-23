package harness

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
)

// structural: the emergence run's shape (GDD 13); the promotion lines
// stay the sheets'.
const (
	emergenceSeeds   = 4
	emergencePlayers = 1000
	emergenceBig     = 10000
	emergenceDays    = 120
	wanderShare      = 10     // one player in this many plays agent.Wanderer
	costDay          = 100    // the day turn trace-cost-flat times
	costStale        = 100000 // stale trace entries the padded copy holds
	costSlack        = 110    // percent of the day as played
	pairingDays      = 14     // days before and after a variant that pairing-share-falls compares
	listedEach       = 12     // promotions of one type a world's report names
)

// playKinds are the facts a world's report counts, from the players'
// replies and the clock's ticks, to say what its players did, so a link
// of the loop that never came can be read back to its cause.
var playKinds = []string{"encounter.won", "encounter.lost", "encounter.left", "hunt.left", "dungeon.left", "gather.done", "order.filled", "travel.entered"}

// emergencePlan is which worlds the run plays and for how long.
type emergencePlan struct {
	seeds   []string
	players int
	big     int // players of one more world on seed "", 0 for none
	days    int64
}

// planFromEnv reads EMERGENCE_PLAYERS, EMERGENCE_BIG and EMERGENCE_DAYS
// over the defaults, with n seeds ("", "1", ...).
func planFromEnv(n int) emergencePlan {
	if n <= 0 {
		n = emergenceSeeds
	}
	p := emergencePlan{players: emergencePlayers, big: emergenceBig, days: emergenceDays}
	if v, err := strconv.Atoi(os.Getenv("EMERGENCE_PLAYERS")); err == nil && v > 0 {
		p.players = v
	}
	if v, err := strconv.Atoi(os.Getenv("EMERGENCE_BIG")); err == nil && v >= 0 {
		p.big = v
	}
	if v, err := strconv.ParseInt(os.Getenv("EMERGENCE_DAYS"), 10, 64); err == nil && v > 0 {
		p.days = v
	}
	for i := range n {
		p.seeds = append(p.seeds, either(i == 0, "", strconv.Itoa(i)))
	}
	return p
}

// EmergenceRun plays the closed world (GDD 13) on planFromEnv's plan: the
// Economy run's players, one in wanderShare wandering, told nothing of
// emergence and never scripted or staged. It reports what the world
// promoted, how far each style's loop closed, how reliance fell once a
// region adapted, and the traces' day cost.
func EmergenceRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	return emergenceRun(b, out, planFromEnv(n))
}

func emergenceRun(b *sheets.Book, out string, plan emergencePlan) ([]Measured, error) {
	type spec struct {
		seed    string
		players int
	}
	var specs []spec
	for _, s := range plan.seeds {
		specs = append(specs, spec{s, plan.players})
	}
	if plan.big > 0 {
		specs = append(specs, spec{"", plan.big})
	}
	worlds := make([]emergenceWorld, len(specs))
	err := runParallel(len(specs), func(i int) error {
		s := specs[i]
		w, err := playEmergence(b, s.seed, s.players, plan.days, i == 0)
		if err != nil {
			return fmt.Errorf("emergence run, seed %q at %d: %w", s.seed, s.players, err)
		}
		worlds[i] = w
		fmt.Fprintf(os.Stderr, "emergence %q %d: %s, %d actions, %d refused, %d promotions, chain %d/4, digest %s\n",
			s.seed, s.players, w.elapsed.Round(time.Second), w.actions, w.refused, len(w.promotions), w.best().reached(), w.digest)
		return nil
	})
	if err != nil {
		return nil, err
	}
	readings := emergenceReadings(worlds, plan)
	if err := emergenceDoc(b, worlds, plan, readings).save(out, "emergence.md"); err != nil {
		return nil, err
	}
	return readings, nil
}

// emergenceWorld is what one world of the run did.
type emergenceWorld struct {
	seed       string
	players    int
	days       int64
	byType     map[emerge.Type]int
	promotions []promoted
	chains     []*loopChain
	variants   []variantSeen
	peaks      map[int]adaptPeak // by region
	qualMost   int64             // the most qualifiers any style held inside its window
	qualStyle  emerge.StyleKey
	looted     int // found materials first looted
	plays      map[string]int
	kinds      int // kinds discovered
	closes     []game.Dashboard
	end        game.Dashboard
	measured   bool
	operator   int64 // operator commands the players sent
	staged     int64 // facts stamped StagedBy
	audit      []string
	digest     string
	actions    int
	refused    int
	elapsed    time.Duration
	samples    map[emerge.StyleKey]map[int64]winDay
	lastDay    int64
	cost       *traceCost
	names      map[int]string // region names
}

type promoted struct {
	typ    emerge.Type
	id     string
	name   string
	region int
	day    int64
}

// loopChain is GDD 13.3's loop on one style: named, adapted against into
// a variant, the variant's material looted, then a kind made of it.
type loopChain struct {
	style     emerge.StyleKey
	material  string
	variantAt int   // the variant's index among the promotions
	lootTick  int64 // when its material was first looted
	links     [4]loopLink
}

type loopLink struct {
	id   string // "" until reached
	name string
	day  int64
}

var loopSteps = [4]string{"style", "variant", "material looted", "a kind made of it"}

func (c *loopChain) reached() int {
	if c == nil {
		return 0
	}
	n := 0
	for n < len(c.links) && c.links[n].id != "" {
		n++
	}
	return n
}

// variantSeen is a variant and the style it adapted against.
type variantSeen struct {
	id, name string
	day      int64
	style    emerge.StyleKey
	matched  bool
}

type adaptPeak struct {
	style string
	adapt int64
	day   int64
}

// winDay is one day's won beats with a style and in its region.
type winDay struct{ style, region int64 }

// best is the world's chain furthest along, the earliest to get there.
func (w emergenceWorld) best() *loopChain {
	var top *loopChain
	for _, c := range w.chains {
		if top == nil || c.reached() > top.reached() ||
			(c.reached() == top.reached() && c.links[c.reached()-1].day < top.links[top.reached()-1].day) {
			top = c
		}
	}
	return top
}

// opCounter is the players' client, counting any operator command sent
// through it, which the closed world must count none of, and the facts
// its replies show.
type opCounter struct {
	agent.Client
	res *emergenceWorld
}

func (c opCounter) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	if game.Operator(req.Kind) {
		c.res.operator++
	}
	rep, ref, err := c.Client.Act(ctx, req)
	for _, f := range rep.Facts {
		if slices.Contains(playKinds, f.Kind) {
			c.res.plays[f.Kind]++
		}
	}
	return rep, ref, err
}

// opPages is opCounter for a client that serves the guild and class pages.
type opPages struct {
	opCounter
	agent.Pages
}

func counted(c agent.Client, res *emergenceWorld) agent.Client {
	oc := opCounter{Client: c, res: res}
	if p, ok := c.(agent.Pages); ok {
		return opPages{oc, p}
	}
	return oc
}

// wander gives one player in wanderShare agent.Wanderer to play, bold as
// the Social run plays it: the Earners back out of what they meet, so the
// wanderers are the ones who press to win. A guild admin keeps its role so
// the guild still runs.
func wander(players []*agent.Player, bands []string) {
	for i, p := range players {
		if i%wanderShare == wanderShare-1 && !p.Admin {
			p.Policy, p.Discord = agent.Wanderer{BandOrder: bands, Bold: true}, fmt.Sprintf("wanderer-%d", i)
		}
	}
}

// playEmergence plays one world: the policies choose, service.Local
// applies, the clock runs. timed takes the trace-cost reading on the way.
func playEmergence(b *sheets.Book, seed string, size int, days int64, timed bool) (emergenceWorld, error) {
	start := time.Now()
	res := emergenceWorld{seed: seed, players: size, days: days, byType: map[emerge.Type]int{}, peaks: map[int]adaptPeak{},
		samples: map[emerge.StyleKey]map[int64]winDay{}, names: map[int]string{}, plays: map[string]int{}}
	k := keys.Throwaway("emergence" + seed)
	pop := soakers(b, size)
	pop.label = "emergence" + seed
	w, err := openSoak(b, k, pop)
	if err != nil {
		return res, err
	}
	g := w.g
	wander(w.players, agent.Bands(b))
	script := agent.NewScript(counted(w.client, &res), w.players, pop.label)
	obs := &observer{b: b, g: g, res: &res}
	ctx := context.Background()
	busy := longBusy(g)
	timeTo := min(costDay, days)
	timeFrom := max(1, timeTo-storyWeek+1)
	var playing []*agent.Player
	for t := int64(0); t < days*sheets.TicksPerDay; t++ {
		playing = w.due(t, busy, playing)
		if err := script.TurnFor(ctx, t, playing); err != nil {
			return res, err
		}
		if next := g.Tick() + 1; next%sheets.TicksPerDay == 0 {
			obs.daily(g.Tick() / sheets.TicksPerDay)
			if d := next / sheets.TicksPerDay; timed && d >= timeFrom && d <= timeTo {
				if res.cost == nil {
					res.cost = &traceCost{}
				}
				emergenceCost(b, k, g, d, res.cost)
			}
		}
		if _, err := g.Advance(); err != nil {
			return res, err
		}
		facts, _ := g.Flush()
		w.local.Txns()
		obs.tick(facts)
		obs.state()
		if g.Tick()%sheets.TicksPerDay == 0 {
			w.local.Forget()
		}
	}
	for _, p := range w.players {
		res.actions += p.Actions
		res.refused += p.Refused
	}
	res.end, res.measured = g.Measures()
	res.kinds = len(g.Kinds.List)
	res.audit = ledger.Audit(g.Ledger.Balances, g.Holdings())
	sum, err := g.Digest()
	if err != nil {
		return res, err
	}
	res.digest = sum.String()
	for r := range g.World.Regions {
		res.names[r] = g.RegionName(r)
	}
	res.elapsed = time.Since(start)
	return res, nil
}

// observer only reads a world as it plays: its records after each tick
// (a command's facts are in the store by then), the clock's facts before
// they are let go, and each day's wins before the day turns.
type observer struct {
	b      *sheets.Book
	g      *game.Game
	res    *emergenceWorld
	styles []emerge.StyleKey // promoted, in promotion order
	eve    game.Dashboard    // the measures before the last day turn
	eveOK  bool
	// seen is how many promotions have been read; materials are the
	// material promotions' indexes by found id.
	seen      int
	materials map[string]int
	staged    fact.ID                 // the newest staged fact counted
	kinds     int                     // kinds the registry held when last read
	made      map[string][]item.Spoil // a kind's base materials, by kind
}

// tick reads the clock's facts: what the players' journeys and the day
// turn did, and the season's close.
func (o *observer) tick(facts []fact.Fact) {
	for _, f := range facts {
		if slices.Contains(playKinds, f.Kind) {
			o.res.plays[f.Kind]++
		}
		if f.Kind == game.FactSeasonClosed && o.eveOK {
			o.res.closes = append(o.res.closes, o.eve)
		}
	}
}

// state reads what the tick promoted, staged, looted and made.
func (o *observer) state() {
	e, res := o.g.Emergence, o.res
	if e == nil {
		return
	}
	day := o.g.Tick() / sheets.TicksPerDay
	for _, id := range e.Staged {
		if id > o.staged {
			res.staged++
			o.staged = id
		}
	}
	for ; o.seen < len(e.Promotions); o.seen++ {
		x := e.Promotions[o.seen]
		p := promoted{typ: x.Type, id: x.ID, name: x.Name, region: x.Region, day: x.Tick / sheets.TicksPerDay}
		res.byType[p.typ]++
		res.promotions = append(res.promotions, p)
		switch p.typ {
		case emerge.Style:
			key := emerge.StyleKey{Region: x.Region, Style: x.Of}
			o.styles = append(o.styles, key)
			res.chains = append(res.chains, &loopChain{style: key, links: [4]loopLink{{id: p.id, name: p.name, day: p.day}}})
		case emerge.Variant:
			o.variant(e, p, o.seen)
		case emerge.Material:
			if o.materials == nil {
				o.materials = map[string]int{}
			}
			o.materials[x.Of] = o.seen
		case emerge.Road, emerge.Camp, emerge.Haunt, emerge.Route, emerge.Legend, emerge.Custom, emerge.Class, emerge.Masters:
		}
	}
	grew := len(o.g.Kinds.List) != o.kinds
	o.kinds = len(o.g.Kinds.List)
	for _, c := range res.chains {
		switch c.reached() {
		case 2:
			if e.Promotions[c.variantAt].First == "" {
				continue
			}
			res.looted++
			name := c.material
			if i, ok := o.materials[c.material]; ok {
				name = e.Promotions[i].Shown()
			}
			c.links[2], c.lootTick = loopLink{id: c.material, name: name, day: day}, o.g.Tick()
			grew = true
		case 3:
		default:
			continue
		}
		if c.reached() == 3 && grew {
			o.kindOf(c)
		}
	}
}

// kindOf finds the first kind discovered since a chain's material was
// looted whose ancestry takes it.
func (o *observer) kindOf(c *loopChain) {
	var first *item.Kind
	for _, k := range o.g.Kinds.List {
		if k.Discovered < c.lootTick || !o.holds(k.ID, c.material) {
			continue
		}
		if first == nil || k.Discovered < first.Discovered || (k.Discovered == first.Discovered && k.ID < first.ID) {
			first = k
		}
	}
	if first != nil {
		c.links[3] = loopLink{id: first.ID, name: o.g.Kinds.Name(first.ID), day: first.Discovered / sheets.TicksPerDay}
	}
}

// variant ties a variant to the named style it adapted against, by the
// variant's record.
func (o *observer) variant(e *emerge.State, p promoted, at int) {
	res := o.res
	v := variantSeen{id: p.id, name: p.name, day: p.day}
	i := slices.IndexFunc(e.Variants, func(r *emerge.VariantRec) bool { return r.ID == p.id })
	if i >= 0 {
		rec := e.Variants[i]
		for _, c := range res.chains {
			if c.style.Region == rec.Region && c.style.Style == rec.Style && c.reached() == 1 {
				c.links[1], c.material, c.variantAt = loopLink{id: p.id, name: p.name, day: p.day}, rec.Material, at
				v.style, v.matched = c.style, true
				break
			}
		}
	}
	res.variants = append(res.variants, v)
}

// holds reports whether a kind is made, at any depth, of material m.
func (o *observer) holds(kind, m string) bool {
	if o.made == nil {
		o.made = map[string][]item.Spoil{}
	}
	ss, ok := o.made[kind]
	if !ok {
		ss = o.g.Rules().Fight.D.Materials(kind)
		o.made[kind] = ss
	}
	return slices.ContainsFunc(ss, func(s item.Spoil) bool { return s.Material == m })
}

// daily samples the day just ending: each named style's wins and its
// region's, adaptation's peaks, the most qualifiers any style held, and
// the measures as they stand before the turn (a season closes at it).
func (o *observer) daily(day int64) {
	res := o.res
	res.lastDay = day
	e := o.g.Emergence
	if e == nil {
		return
	}
	for _, k := range o.styles {
		st, tally := e.Styles[k], e.Regions[k.Region]
		if st == nil {
			continue
		}
		var w winDay
		w.style = st.Today.On(day)
		if tally != nil {
			w.region = tally.Today.On(day)
		}
		if res.samples[k] == nil {
			res.samples[k] = map[int64]winDay{}
		}
		res.samples[k][day] = w
		if pk, ok := res.peaks[k.Region]; !ok || st.Adapt > pk.adapt {
			res.peaks[k.Region] = adaptPeak{style: k.Style, adapt: st.Adapt, day: day}
		}
	}
	window := styleWindow(o.b)
	for _, k := range slices.SortedFunc(maps.Keys(e.Styles), styleOrder) {
		if n := e.Styles[k].Qual.Within(day, e.Season, window); n > res.qualMost {
			res.qualMost, res.qualStyle = n, k
		}
	}
	o.eve, o.eveOK = o.g.Measures()
}

func styleOrder(a, b emerge.StyleKey) int {
	return cmp.Or(cmp.Compare(a.Region, b.Region), strings.Compare(a.Style, b.Style))
}

// promotionRow is a line of emergence.promotions.
func promotionRow(b *sheets.Book, t emerge.Type) sheets.PromotionRow {
	for _, r := range b.Promotions {
		if r.ID == string(t) {
			return r
		}
	}
	return sheets.PromotionRow{}
}

func styleWindow(b *sheets.Book) int64 { return promotionRow(b, emerge.Style).WindowDays }

// pairingCase is one variant's style share of its region's wins, before
// and after the variant appeared.
type pairingCase struct {
	seed          string
	players       int
	variant       variantSeen
	before, after winDay
	measured, ok  bool
	why           string
}

// pairingCases reads every variant of a world against pairingDays of its
// style's samples either side.
func pairingCases(w emergenceWorld) []pairingCase {
	var out []pairingCase
	for _, v := range w.variants {
		c := pairingCase{seed: w.seed, players: w.players, variant: v}
		switch {
		case !v.matched:
			c.why = "no named style in its record"
		case v.day+pairingDays > w.lastDay:
			c.why = fmt.Sprintf("appeared with fewer than %d days left", pairingDays)
		default:
			s := w.samples[v.style]
			for d := v.day - pairingDays; d < v.day; d++ {
				x := s[d]
				c.before.style, c.before.region = c.before.style+x.style, c.before.region+x.region
			}
			for d := v.day + 1; d <= v.day+pairingDays; d++ {
				x := s[d]
				c.after.style, c.after.region = c.after.style+x.style, c.after.region+x.region
			}
			if c.before.region == 0 {
				c.why = "no wins in the region before it"
				break
			}
			if c.after.region == 0 {
				c.why = "no wins in the region after it"
				break
			}
			c.measured = true
			c.ok = c.after.style*c.before.region < c.before.style*c.after.region
		}
		out = append(out, c)
	}
	return out
}

func share(w winDay) int64 {
	if w.region == 0 {
		return 0
	}
	return w.style * fixed.Hundredths / w.region
}

// traceCost is trace-cost-flat's timing, summed over emergenceCost's days.
type traceCost struct {
	from, to         int64
	asPlayed, padded time.Duration
	whole            [3]time.Duration // as played, padded, without emergence
	overBase         bool
	err              error
	rules            *game.Rules
}

// emergenceCost times the day turn into day on copies of g, interleaved so
// load falls on each alike: as played, padded with costStale stale trace
// entries (expired days, an older season), and with emergence removed as
// the baseline the other two are read over. The traces' day, the hooks'
// days and the turn's intake all fall inside it. It adds to tc.
func emergenceCost(b *sheets.Book, k keys.Set, g *game.Game, day int64, tc *traceCost) {
	if tc.err != nil {
		return
	}
	if tc.from == 0 {
		tc.from, tc.overBase = day, true
	}
	tc.to = day
	snap, err := json.Marshal(g)
	if err != nil {
		tc.err = err
		return
	}
	var centre hex.Hex
	if len(g.Places) > 0 {
		centre = g.Places[0].Hex
	}
	off, padded, stale, err := costSnapshots(b, snap, day, centre)
	if err != nil {
		tc.err = err
		return
	}
	// Copies are timed on rules of their own: attaching rebinds them.
	if tc.rules == nil {
		if tc.rules, err = game.NewRules(b, k); err != nil {
			tc.err = err
			return
		}
	}
	one := func(s []byte, ballast bool) (time.Duration, error) {
		var c game.Game
		if err := json.Unmarshal(s, &c); err != nil {
			return 0, err
		}
		c.Attach(tc.rules)
		// The copies without the stale entries hold them aside, so all
		// three run on a heap of one size, and the load's garbage is not
		// the turn's to collect.
		var aside emerge.State
		if ballast {
			if err := json.Unmarshal(stale, &aside); err != nil {
				return 0, err
			}
		}
		runtime.GC()
		start := time.Now()
		_, err := c.Advance()
		d := time.Since(start)
		runtime.KeepAlive(&aside)
		return d, err
	}
	snaps := [][]byte{snap, padded, off}
	least := make([]time.Duration, len(snaps))
	baseOK := true
	for i := range storyReps + 1 {
		for m, s := range snaps {
			if m == len(snaps)-1 && !baseOK {
				continue
			}
			d, err := one(s, m != 1)
			if err != nil {
				if m == len(snaps)-1 {
					baseOK = false
					continue
				}
				tc.err = err
				return
			}
			if i == 1 || (i > 1 && d < least[m]) {
				least[m] = d
			}
		}
	}
	for m := range least {
		tc.whole[m] += least[m]
	}
	tc.overBase = tc.overBase && baseOK
	if baseOK {
		tc.asPlayed += max(0, least[0]-least[2])
		tc.padded += max(0, least[1]-least[2])
	}
}

// reading is what trace-cost-flat compares: emergence's own cost while
// every day had a baseline, else whole turns.
func (tc *traceCost) reading() (asPlayed, padded time.Duration) {
	if tc.overBase {
		return tc.asPlayed, tc.padded
	}
	return tc.whole[0], tc.whole[1]
}

// costSnapshots are snap without emergence, snap with costStale trace
// entries none of its days touch (tiles and characters it never saw, last
// written past keep-days in the season before), and that padded trace
// store alone.
func costSnapshots(b *sheets.Book, snap []byte, day int64, centre hex.Hex) (off, padded, stale []byte, err error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(snap, &top); err != nil {
		return nil, nil, nil, err
	}
	raw, ok := top["emergence"]
	if !ok {
		return nil, nil, nil, fmt.Errorf("the world keeps no emergence")
	}
	delete(top, "emergence")
	if off, err = json.Marshal(top); err != nil {
		return nil, nil, nil, err
	}
	var e emerge.State
	if err := json.Unmarshal(raw, &e); err != nil {
		return nil, nil, nil, err
	}
	padStale(&e, costStale, max(0, day-sheets.IntParam(b.EmergenceParams, "keep-days")-1), centre)
	if stale, err = json.Marshal(e); err != nil {
		return nil, nil, nil, err
	}
	top["emergence"] = stale
	padded, err = json.Marshal(top)
	return off, padded, stale, err
}

// padStale adds n stale entries across passage, clearing, loss and renown.
func padStale(e *emerge.State, n int, day int64, centre hex.Hex) {
	old := e.Season - 1
	count := emerge.Counter{V: fixed.One, Day: day, Season: old}
	spot := func(h hex.Hex) *emerge.Spot {
		return &emerge.Spot{Hex: h, Count: count, Window: emerge.Window{Last: day, Season: old}, Who: emerge.Recent{Season: old}}
	}
	spots := []emerge.Spots{e.Passage, e.Clearing, e.Loss}
	added, i := 0, 0
	for radius := int64(1); added < n; radius++ {
		for _, h := range hex.Ring(centre, radius) {
			if added >= n {
				break
			}
			i++
			if m := i % (len(spots) + 1); m < len(spots) {
				if _, ok := spots[m][h]; !ok {
					spots[m][h] = spot(h)
					added++
				}
				continue
			}
			ref := fact.Ref{Kind: "character", ID: fmt.Sprintf("stale-%d", i)}
			e.Renown[ref.String()] = &emerge.Subject{Ref: ref, Count: count, Season: old, Region: -1}
			added++
		}
	}
}

func (tc *traceCost) holds() bool {
	if tc == nil || tc.err != nil {
		return false
	}
	asPlayed, padded := tc.reading()
	return padded*fixed.Hundredths <= asPlayed*costSlack
}

func (tc *traceCost) ratio() int64 {
	asPlayed, padded := tc.reading()
	if asPlayed <= 0 {
		return 0
	}
	return int64(padded * fixed.Hundredths / asPlayed)
}

// emergenceReadings are the run's four targets. The loop must close on
// every world of the plan's size with no operator command and no staged
// fact, and every world's ledger must balance; every type must fire on
// some world.
func emergenceReadings(worlds []emergenceWorld, plan emergencePlan) []Measured {
	var readings []Measured

	loop, seeds := true, 0
	var chains []string
	var ledgerNote string
	for _, w := range worlds {
		if len(w.audit) > 0 {
			loop = false
			if ledgerNote == "" {
				ledgerNote = fmt.Sprintf("; ledger: seed %q %d discrepancies, first %s", w.seed, len(w.audit), w.audit[0])
			}
		}
		if w.players != plan.players {
			continue
		}
		seeds++
		c := w.best()
		ok := c.reached() == len(loopSteps) && w.operator == 0 && w.staged == 0
		loop = loop && ok
		chains = append(chains, fmt.Sprintf("seed %q %s", w.seed, chainDays(c)))
	}
	ops, staged := int64(0), int64(0)
	for _, w := range worlds {
		ops, staged = ops+w.operator, staged+w.staged
	}
	readings = append(readings, Measured{Target: "emergence-loop",
		Value: fmt.Sprintf("%s players, %d %s: %s; %d operator commands, %d staged facts%s", comma(int64(plan.players)), seeds, either(seeds == 1, "seed", "seeds"), strings.Join(chains, "; "), ops, staged, ledgerNote),
		Holds: loop && seeds > 0})

	var parts, missing []string
	for _, t := range emerge.Types {
		most := 0
		for _, w := range worlds {
			most = max(most, w.byType[t])
		}
		parts = append(parts, fmt.Sprintf("%s %d", t, most))
		if most == 0 {
			missing = append(missing, string(t))
		}
	}
	value := "most on one world: " + strings.Join(parts, ", ")
	if len(missing) > 0 {
		value += "; never: " + strings.Join(missing, ", ")
	}
	readings = append(readings, Measured{Target: "promotion-each-type", Value: value, Holds: len(missing) == 0})

	var cases []pairingCase
	for _, w := range worlds {
		cases = append(cases, pairingCases(w)...)
	}
	measured, fell := 0, 0
	for _, c := range cases {
		if c.measured {
			measured++
			fell += btoi(c.ok)
		}
	}
	if measured == 0 {
		readings = append(readings, notMeasured("pairing-share-falls", fmt.Sprintf("no variant appeared with %d days left (%d variants)", pairingDays, len(cases))))
	} else {
		readings = append(readings, Measured{Target: "pairing-share-falls",
			Value: fmt.Sprintf("%d of %d variants with %d days left saw their style's share fall", fell, measured, pairingDays), Holds: fell == measured})
	}

	var tc *traceCost
	if len(worlds) > 0 {
		tc = worlds[0].cost
	}
	switch {
	case tc == nil:
		readings = append(readings, notMeasured("trace-cost-flat", "the first world took no timing"))
	case tc.err != nil:
		readings = append(readings, Measured{Target: "trace-cost-flat", Value: "the timing failed: " + tc.err.Error()})
	default:
		asPlayed, padded := tc.reading()
		readings = append(readings, Measured{Target: "trace-cost-flat",
			Value: fmt.Sprintf("the day turns of days %d to %d, seed \"\": %s as played, %s with %s stale entries (%d%%)%s", tc.from, tc.to,
				asPlayed.Round(time.Microsecond), padded.Round(time.Microsecond), comma(costStale), tc.ratio(), either(tc.overBase, "", ", whole turns")),
			Holds: tc.holds()})
	}
	return readings
}

func chainDays(c *loopChain) string {
	if c == nil {
		return "no style"
	}
	var s []string
	for i, l := range c.links[:c.reached()] {
		s = append(s, fmt.Sprintf("%s day %d", loopSteps[i], l.day))
	}
	if n := c.reached(); n < len(loopSteps) {
		s = append(s, "no "+loopSteps[n])
	}
	return strings.Join(s, " → ")
}

func (w emergenceWorld) regionName(r int) string {
	if r < 0 {
		return "–"
	}
	if n := w.names[r]; n != "" {
		return n
	}
	return world.RegionRef(r)
}

func emergenceDoc(b *sheets.Book, worlds []emergenceWorld, plan emergencePlan, readings []Measured) *lineDoc {
	var doc lineDoc
	p := doc.p
	p("# Emergence run")
	p("")
	p("The closed world (GDD 13): the Economy run's players (`soakers`, the six Earner roles, their guild, the backer and the quiet server), with one player in %d playing a bold `agent.Wanderer` instead, on %d %s of %s players and %s, for %d world days. The policies are told nothing of emergence (`TestAgentsNotTold`); the driver only asks each due player's policy for its request and sends it through `service.Local` (`TestEmergenceDriverPlain`). The lines are GDD 13.2's as `emergence.promotions` writes them.",
		wanderShare, len(plan.seeds), either(len(plan.seeds) == 1, "seed", "seeds"), comma(int64(plan.players)), either(plan.big > 0, fmt.Sprintf("one world of %s on seed \"\"", comma(int64(plan.big))), "no larger world"), plan.days)
	p("")
	style, variant := promotionRow(b, emerge.Style), promotionRow(b, emerge.Variant)
	p("A style is named when %d characters each win %d beats with it in a region within %d days; its variant appears when the region's adaptation passes %d%%.", style.Distinct, style.PerCharacter, style.WindowDays, variant.Percent)
	p("")
	p("| World | Players | %s | Material | Loop | Operator commands | Staged facts | Audit | Time |", strings.Join(typeNames(), " | "))
	p("| --- | --- |%s --- | --- | --- | --- | --- | --- |", strings.Repeat(" --- |", len(emerge.Types)))
	for _, w := range worlds {
		var counts []string
		for _, t := range emerge.Types {
			counts = append(counts, strconv.Itoa(w.byType[t]))
		}
		p("| %q | %s | %s | %d | %d/%d | %d | %d | %s | %s |", w.seed, comma(int64(w.players)), strings.Join(counts, " | "), w.byType[emerge.Material],
			w.best().reached(), len(loopSteps), w.operator, w.staged, either(len(w.audit) == 0, "clean", fmt.Sprintf("**%d discrepancies**", len(w.audit))), w.elapsed.Round(time.Second))
	}
	p("")
	p("## Readings")
	p("")
	for _, m := range readings {
		p("- `%s`: %s%s", m.Target, m.Value, either(strings.HasPrefix(m.Value, unmeasured), "", " ("+holds(m.Holds)+")"))
	}
	p("")
	p("## Pairing share after a variant")
	p("")
	p("Each named style's wins and its region's, sampled each day from the style's naming; the share over the %d days before a variant against the %d after.", pairingDays, pairingDays)
	p("")
	p("| World | Variant | Day | Style | Share before | Share after | Falls |")
	p("| --- | --- | --- | --- | --- | --- | --- |")
	listed := false
	for _, w := range worlds {
		for _, c := range pairingCases(w) {
			listed = true
			if !c.measured {
				p("| %q %s | %s | %d | %s | – | – | %s |", c.seed, comma(int64(c.players)), c.variant.name, c.variant.day, c.variant.style.Style, c.why)
				continue
			}
			p("| %q %s | %s | %d | %s | %d%% (%d of %d) | %d%% (%d of %d) | %s |", c.seed, comma(int64(c.players)), c.variant.name, c.variant.day, c.variant.style.Style,
				share(c.before), c.before.style, c.before.region, share(c.after), c.after.style, c.after.region, holds(c.ok))
		}
	}
	if !listed {
		p("| – | no variant appeared | | | | | |")
	}
	p("")
	p("## Trace cost")
	p("")
	if len(worlds) > 0 {
		tc := worlds[0].cost
		switch {
		case tc == nil:
			p("Not timed.")
		case tc.err != nil:
			p("The timing failed: %v.", tc.err)
		default:
			asPlayed, padded := tc.reading()
			p("The day turns into days %d to %d on seed \"\" (%s players), each timed on copies of the world: the least of %d runs after a warm-up, interleaved so load falls on each alike, summed over the days. The copies without the stale entries hold them aside, so every copy runs on a heap of one size. %s The run plays its worlds in parallel, so re-run it alone (`-n 1 EMERGENCE_BIG=0 EMERGENCE_DAYS=%d`) for a reading at low load.",
				tc.from, tc.to, comma(int64(worlds[0].players)), storyReps, either(tc.overBase, "Each is read over a copy with emergence removed, so it is what emergence's days cost.", "A copy without emergence could not play a turn, so these are whole turns."), costDay)
			p("")
			p("| Copy | Emergence's cost | Whole turns |")
			p("| --- | --- | --- |")
			p("| As played | %s | %s |", asPlayed.Round(time.Microsecond), tc.whole[0].Round(time.Microsecond))
			p("| With %s stale entries | %s (%d%%, at most %d%%) | %s |", comma(costStale), padded.Round(time.Microsecond), tc.ratio(), costSlack, tc.whole[1].Round(time.Microsecond))
			if tc.overBase {
				p("| Without emergence | – | %s |", tc.whole[2].Round(time.Microsecond))
			}
		}
	}
	p("")
	for _, w := range worlds {
		worldSection(p, w)
	}
	return &doc
}

func typeNames() []string {
	var s []string
	for _, t := range emerge.Types {
		s = append(s, string(t))
	}
	return s
}

func worldSection(p func(string, ...any), w emergenceWorld) {
	p("## Seed %q, %s players", w.seed, comma(int64(w.players)))
	p("")
	p("### Promotions")
	p("")
	p("| Type | Count | First promoted (day, name, region) |")
	p("| --- | --- | --- |")
	types := emerge.AllTypes
	for _, t := range types {
		var named []string
		for _, x := range w.promotions {
			if x.typ == t && len(named) < listedEach {
				named = append(named, fmt.Sprintf("day %d %s (%s)", x.day, x.name, w.regionName(x.region)))
			}
		}
		if more := w.byType[t] - len(named); more > 0 {
			named = append(named, fmt.Sprintf("and %d more", more))
		}
		p("| %s | %d | %s |", t, w.byType[t], either(len(named) == 0, "–", strings.Join(named, "; ")))
	}
	p("")
	p("### The loop")
	p("")
	c := w.best()
	if c == nil {
		p("No style was named. The most qualifiers any style held inside its window: %d (%s in %s).", w.qualMost, either(w.qualStyle.Style == "", "none", w.qualStyle.Style), w.regionName(w.qualStyle.Region))
	} else {
		p("The style furthest along, in %s:", w.regionName(c.style.Region))
		p("")
		for i, l := range c.links {
			if l.id == "" {
				p("%d. %s: not reached", i+1, loopSteps[i])
				continue
			}
			p("%d. %s: day %d, %s (`%s`)", i+1, loopSteps[i], l.day, either(l.name == "", l.id, l.name), l.id)
		}
		p("")
		p("%d styles named, %d variants, %d found materials first looted, %d kinds discovered in all; the most qualifiers any style held inside its window: %d.", w.byType[emerge.Style], len(w.variants), w.looted, w.kinds, w.qualMost)
	}
	p("")
	var did []string
	for _, k := range playKinds {
		did = append(did, fmt.Sprintf("%s %s", k, comma(int64(w.plays[k]))))
	}
	p("What the players did: %s.", strings.Join(did, ", "))
	p("")
	p("### Adaptation peaks")
	p("")
	if len(w.peaks) == 0 {
		p("No region adapted: no style was named.")
	} else {
		p("| Region | Style | Peak | Day |")
		p("| --- | --- | --- | --- |")
		for _, r := range slices.Sorted(maps.Keys(w.peaks)) {
			pk := w.peaks[r]
			p("| %s | %s | %d%% | %d |", w.regionName(r), pk.style, pk.adapt, pk.day)
		}
	}
	p("")
	p("### Measures")
	p("")
	p("| When | Active | New kinds per mille a week (last full week) | Promotions this season | Heavy facts with a player | Most common pairing's share | Traces stored |")
	p("| --- | --- | --- | --- | --- | --- | --- |")
	for _, d := range w.closes {
		measureRow(p, fmt.Sprintf("season %d's close", d.Season), d)
	}
	if w.measured {
		measureRow(p, fmt.Sprintf("the end, day %d", w.end.Day), w.end)
	}
	p("")
	p("### Ledger audit")
	p("")
	if len(w.audit) == 0 {
		p("Clean.")
	}
	for _, a := range w.audit {
		p("- %s", a)
	}
	p("")
	p("### Digest")
	p("")
	p("`%s`, %d actions, %d refused.", w.digest, w.actions, w.refused)
	p("")
	p("### Time")
	p("")
	p("%s for %d world days.", w.elapsed.Round(time.Second), w.days)
	p("")
}

func measureRow(p func(string, ...any), when string, d game.Dashboard) {
	week := int64(0)
	if n := len(d.KindsPerMille); n > 1 {
		week = d.KindsPerMille[n-2]
	}
	var promos []string
	for _, t := range d.Promotions {
		promos = append(promos, fmt.Sprintf("%s %d", t.Type, t.Count))
	}
	top := int64(0)
	for _, s := range d.Pairing {
		top = max(top, s.Percent)
	}
	var traces []string
	for _, t := range d.Traces {
		traces = append(traces, fmt.Sprintf("%s %d", t.Type, t.Count))
	}
	p("| %s | %d | %d (%s) | %s, need %d (%s) | %d of %d (%s) | %d%% (%s) | %s |", when, d.Active, week, holds(d.KindsHealthy),
		strings.Join(promos, ", "), d.Need, holds(d.PromotionsHealthy), d.HeavyPlayer, d.Heavy, holds(d.HeavyHealthy), top, holds(d.PairingHealthy), strings.Join(traces, ", "))
}
