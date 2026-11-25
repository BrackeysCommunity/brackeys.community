package harness

import (
	"cmp"
	"context"
	"fmt"
	"maps"
	"math"
	"slices"
	"strings"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/sheets"
)

// A staging twin is two soaks of the Economy population on one seed: one
// where an admin and a staff member of the main server stage through the
// player path and its players take and use what they stage, and one where
// the same stagers stage nothing. The twins differ only by the staging,
// so what moves at another settlement moved because of it (GDD 18.4).

// structural: the staging twin's shape and the readings it is held to.
const (
	stagingFrom   = joinDays + 1 // world day staging begins: every player has arrived
	stayLocalPct  = 5            // staging-stays-local: the most a price elsewhere may move, per cent
	fillsLeast    = 3            // ticks with fills a book needs in a day, in both twins, for its clearing price to count
	refusalChecks = 60           // staged attempts of one kind whose refusal is checked to change nothing
	restEvery     = 10           // the staging-free twin: one main player in restEvery rests
	restTicks     = 4            // one tick in restTicks
	siteRings     = 4            // rings round a settlement a stager's sites come from
	leaksKept     = 12           // gate problems a report names
	txnFill       = "fill"       // a book's fill, staged or not
	stagedOrder   = "so-"        // a staged book's order ids
	stagedListing = "sl-"        // a staged item's listing ids
)

// stagingPolicy is what an adversarial server does with staging: which
// templates its admin and staff stage, how often and where, and what its
// players do with the staged goods.
type stagingPolicy struct {
	name  string
	admin []string // templates the admin stager stages in turn
	staff []string // the staff stager's, paid from the pool
	every int64    // ticks between one stager's orders
	days  int64    // a stage's days; 0 takes the template's
	far   bool     // the farthest sites rather than the nearest
	uses  [4]int64 // per cent of the server's players making each of agent.Uses
}

func (p stagingPolicy) String() string {
	var uses []string
	for i, u := range agent.Uses {
		if p.uses[i] > 0 {
			uses = append(uses, fmt.Sprintf("%s %d%%", u, p.uses[i]))
		}
	}
	return fmt.Sprintf("admin %s; staff %s; every %d ticks; %s days; %s sites; %s", strings.Join(p.admin, ", "), cmp.Or(strings.Join(p.staff, ", "), "none"),
		p.every, either(p.days == 0, "the template's", fmt.Sprint(p.days)), either(p.far, "far", "near"), strings.Join(uses, ", "))
}

// stagingSeeds are the climb's first generation; the last is the
// strongest, the fixed maximum policy the Economy run and a small Search
// run play.
func stagingSeeds() []stagingPolicy {
	return []stagingPolicy{
		{name: "drop-flood", admin: []string{"drop-large"}, staff: []string{"drop-small"}, every: workPeriod, uses: [4]int64{70, 10, 10, 10}},
		{name: "hunt-press", admin: []string{"hunt-3", "hunt-2"}, staff: []string{"hunt-2"}, every: 2 * workPeriod, uses: [4]int64{25, 25, 25, 25}},
		{name: "fair-and-contest", admin: []string{"fair", "contest"}, staff: []string{"contest", "fair"}, every: 4 * workPeriod, uses: [4]int64{40, 40, 10, 10}},
		{name: "hardships", admin: []string{"storm", "scare", "drill", "drop-small"}, staff: []string{"storm"}, every: 6 * workPeriod, uses: [4]int64{50, 30, 10, 10}},
		{name: "far-drops-tried", admin: []string{"drop-large", "drop-small"}, staff: []string{"drop-small"}, every: workPeriod, far: true, uses: [4]int64{0, 0, 30, 70}},
		{name: "everything", admin: []string{"drop-large", "hunt-3", "fair", "contest", "storm", "vault", "drop-small", "hunt-2"}, staff: []string{"drop-large", "hunt-3", "fair"},
			every: workPeriod, days: 7, uses: [4]int64{40, 30, 15, 15}},
	}
}

// strongestSeed is the fixed maximum policy.
func strongestSeed() stagingPolicy {
	s := stagingSeeds()
	return s[len(s)-1]
}

// stagingTemplates are the templates a mutation may add: every one a
// player can take something from.
var stagingTemplates = []string{"contest", "storm", "scare", "drill", "drop-small", "hunt-2", "fair", "hunt-3", "drop-large", "vault"}

// mutate is a policy one step from p, drawn under search.staging for its
// generation and place in it, and none already played: a step that
// changes nothing or repeats is drawn again.
func mutate(p stagingPolicy, d *draw.Drawer, gen, i int, played map[string]bool) stagingPolicy {
	for try := range mutateTries {
		q, what := stepPolicy(p, func(n int, part string) int {
			return int(d.Below(uint64(max(n, 1)), "search.staging", draw.Int(int64(gen)), draw.Int(int64(i)), draw.Int(int64(try)), draw.Str(part)))
		})
		if what != "" && !played[q.String()] {
			q.name = p.name + " " + what
			played[q.String()] = true
			return q
		}
	}
	return p
}

// structural: draws a mutation may take to find a policy not yet played.
const mutateTries = 16

// stepPolicy is one change to a policy and what it was; "" for none.
func stepPolicy(p stagingPolicy, pick func(n int, part string) int) (stagingPolicy, string) {
	q := p
	q.admin, q.staff = slices.Clone(p.admin), slices.Clone(p.staff)
	switch pick(7, "op") {
	case 0:
		if t := stagingTemplates[pick(len(stagingTemplates), "template")]; !slices.Contains(q.admin, t) {
			q.admin = append(q.admin, t)
			return q, "+" + t
		}
	case 1:
		if len(q.admin) > 1 {
			j := pick(len(q.admin), "drop")
			what := "-" + q.admin[j]
			q.admin = slices.Delete(q.admin, j, j+1)
			return q, what
		}
	case 2:
		if pick(2, "every") == 0 {
			q.every = max(workPeriod, q.every/2)
		} else {
			q.every = min(sheets.TicksPerDay/2, q.every*2)
		}
		if q.every != p.every {
			return q, fmt.Sprintf("every %d", q.every)
		}
	case 3:
		q.far = !q.far
		return q, either(q.far, "far", "near")
	case 4:
		from, to := pick(len(agent.Uses), "from"), pick(len(agent.Uses), "to")
		if moved := min(q.uses[from], 25); from != to && moved > 0 {
			q.uses[from] -= moved
			q.uses[to] += moved
			return q, fmt.Sprintf("%d%% %s→%s", moved, agent.Uses[from], agent.Uses[to])
		}
	case 5:
		if q.days = []int64{0, 1, 3, 7}[pick(4, "days")]; q.days != p.days {
			return q, fmt.Sprintf("days %d", q.days)
		}
	case 6:
		t := stagingTemplates[pick(len(stagingTemplates), "staff")]
		if j := slices.Index(q.staff, t); j >= 0 {
			q.staff = slices.Delete(q.staff, j, j+1)
			return q, "staff -" + t
		}
		q.staff = append(q.staff, t)
		return q, "staff +" + t
	}
	return p, ""
}

// stagingSoak is one twin's soak, and what its watch read.
type stagingSoak struct {
	economyResult
	policy stagingPolicy
	staged bool
	watch  *stagingWatch
}

// soakStaging soaks the Economy population at a size for days, with the
// policy's stagers staging or, unstaged, staging nothing.
func soakStaging(b *sheets.Book, size int, days int64, pol stagingPolicy, staged bool) (*stagingSoak, error) {
	return soakTwin(b, size, days, pol, staged, false)
}

// soakTwin is soakStaging, or with rest the staging-free twin whose main
// players change their play a little with nothing staged.
func soakTwin(b *sheets.Book, size int, days int64, pol stagingPolicy, staged, rest bool) (*stagingSoak, error) {
	pop := soakers(b, size)
	if pop.server == "" {
		return nil, fmt.Errorf("staging needs the main server: ECONOMY_GUILDS=off leaves none")
	}
	w := newStagingWatch(b, pol, staged, pop.server)
	w.rest = rest
	pop.watch = w
	r, err := soak(b, pop, days)
	if err != nil {
		return nil, err
	}
	w.closeWith(r.audit)
	return &stagingSoak{economyResult: r, policy: pol, staged: staged, watch: w}, nil
}

// stagingBoard is the staging as the stagers' and beneficiaries' house
// and hunt board show it, read from the game in process.
type stagingBoard struct {
	g       *game.Game
	local   *service.Local
	sites   map[int][]api.Hex
	sitesOn int64
	stages  []*game.Stage
	reach   map[string][]api.Hex
	tick    int64
	tiles   map[hex.Hex][]*game.Char
	tilesOn int64
}

var _ agent.Staging = (*stagingBoard)(nil)

func newStagingBoard(g *game.Game, local *service.Local) *stagingBoard {
	return &stagingBoard{g: g, local: local, reach: map[string][]api.Hex{}, tick: -1, sitesOn: -1, tilesOn: -1}
}

func (s *stagingBoard) Home(server string) (int, bool) {
	gd := s.g.ServerGuild(server)
	if gd == nil {
		return 0, false
	}
	i := slices.IndexFunc(s.g.Places, func(p *game.Place) bool { return p.Guild == gd.G.ID && p.Ruined == 0 })
	return i, i >= 0
}

// Sites are a settlement's passable tiles in its region within siteRings,
// walkable from it, as a console's site list offers them; read once a
// world day.
func (s *stagingBoard) Sites(n int) []api.Hex {
	if day := s.g.Tick() / sheets.TicksPerDay; day != s.sitesOn {
		s.sites, s.sitesOn = map[int][]api.Hex{}, day
	}
	if out, ok := s.sites[n]; ok {
		return out
	}
	if n < 0 || n >= len(s.g.Places) {
		return nil
	}
	gen, home := s.g.Rules().Gen, s.g.SettlementHex(n)
	var out []api.Hex
	for r := int64(1); r <= siteRings; r++ {
		for _, h := range hex.Ring(home, r) {
			if gen.RegionOf(h) != gen.RegionOf(home) || s.g.World.RegionAt(h) < 0 || !gen.Passable(s.g.World.Baseline(h).Terrain) || s.g.IsSettlement(h) {
				continue
			}
			if _, _, ok := s.g.World.Path(home, h); ok {
				out = append(out, apiHex(h))
			}
		}
	}
	s.sites[n] = out
	return out
}

// open are the stages open now, read once a tick; their crates are read
// live.
func (s *stagingBoard) open() []*game.Stage {
	if t := s.g.Tick(); t != s.tick {
		s.tick, s.stages = t, s.stages[:0]
		if s.g.Live != nil {
			for _, st := range s.g.Live.Stages {
				if st.Open && !st.Closed {
					s.stages = append(s.stages, st)
				}
			}
		}
	}
	return s.stages
}

func (s *stagingBoard) Stages() []agent.StageSpot {
	var out []agent.StageSpot
	for _, st := range s.open() {
		sp := agent.StageSpot{ID: st.ID, Kind: st.Kind, Settlement: st.Settlement, At: apiHex(st.At), Crates: st.Crates}
		if x := s.g.HuntByID(st.HuntID); x != nil && !x.H.Over {
			sp.Hunt = st.HuntID
		}
		sp.Reach = s.reachOf(st)
		out = append(out, sp)
	}
	return out
}

// reachOf are the tiles a stage's live reach contests ask for.
func (s *stagingBoard) reachOf(st *game.Stage) []api.Hex {
	if r, ok := s.reach[st.ID]; ok {
		return r
	}
	var out []api.Hex
	for _, id := range st.Goals {
		x := s.g.GoalOf(id)
		if x == nil || x.Cond.Verb != goal.Reach {
			continue
		}
		if ref, ok := strings.CutPrefix(x.Cond.At, goal.PlaceTile+":"); ok {
			if h, ok := hex.ParseRef(ref); ok {
				out = append(out, apiHex(h))
			}
		}
	}
	s.reach[st.ID] = out
	return out
}

func (s *stagingBoard) Hunt(id string) *api.HuntView {
	c := s.g.Char(id)
	if c == nil {
		return nil
	}
	near := slices.ContainsFunc(s.g.LiveHunts(), func(x *game.Hunt) bool { return x.Stage != "" && game.InReach(c, x) })
	if !near {
		return nil
	}
	st, err := s.local.Party(context.Background(), id)
	if err != nil {
		return nil
	}
	return st.Hunt
}

func (s *stagingBoard) SettlementAt(at api.Hex) (int, bool) {
	return s.g.SettlementAt(hex.Hex{Q: at.Q, R: at.R})
}

func (s *stagingBoard) Outsiders(server string, at api.Hex) []string {
	if t := s.g.Tick(); t != s.tilesOn {
		s.tilesOn, s.tiles = t, map[hex.Hex][]*game.Char{}
		for _, c := range s.g.Chars {
			if c.Server != "" {
				s.tiles[c.C.At] = append(s.tiles[c.C.At], c)
			}
		}
	}
	var out []string
	for _, c := range s.tiles[hex.Hex{Q: at.Q, R: at.R}] {
		if c.Server != server && c.C.Floor == 0 {
			out = append(out, c.C.ID)
		}
	}
	return out
}

func (s *stagingBoard) Away(server string) (api.Hex, bool) {
	home, ok := s.Home(server)
	for i, p := range s.g.Places {
		if (!ok || i != home) && p.Ruined == 0 && p.Lattice >= 0 {
			return apiHex(p.Hex), true
		}
	}
	return api.Hex{}, false
}

func (s *stagingBoard) StagedArc(id string) bool {
	if s.g.Story == nil {
		return false
	}
	i := slices.IndexFunc(s.g.Story.Arcs, func(a *game.Arc) bool { return a.ID == id })
	return i >= 0 && s.g.Story.Arcs[i].Staging != ""
}

func (s *stagingBoard) StagedItems(id string) []string {
	c := s.g.Char(id)
	if c == nil {
		return nil
	}
	var out []string
	for _, in := range c.C.Pack {
		if in.Staged != nil {
			out = append(out, in.ID)
		}
	}
	return out
}

// bookTally is one book's day so far: its units at the last tick read and
// the ticks it filled on.
type bookTally struct {
	last, fills int64
}

// bookKey names a public book.
type bookKey struct {
	n int
	m string
}

// bookDay is one world day of a public book as the twin reads it: what
// traded, on how many ticks, and the faction bids resting once the day
// turned.
type bookDay struct {
	day, units, coin, fills int64
	bidSum, bids            int64
}

// stagingWatch reads a staging twin's soak: every transaction against the
// staged homes, the staged books and lines each day, every refused staged
// attempt against the game it left, each public book's days and the
// staged experience characters gained.
type stagingWatch struct {
	b      *sheets.Book
	policy stagingPolicy
	staged bool
	// rest makes every restEvery-th main player rest one tick in
	// restTicks from staging's first day: a change of play with nothing
	// staged, the scale the twins' reading is read against.
	rest   bool
	server string
	g      *game.Game
	board  *stagingBoard
	home   int
	dayN   int64 // world days read
	// The gate.
	problems []string
	leaks    int
	minted   int64 // staged units minted from any source, by the transactions
	traded   int64 // staged units bought from a staged order or listing
	items    map[string]bool
	hunts    map[string]bool
	tries    map[string]int // staged attempts by what was tried and how it ended
	checked  map[string]int // attempts whose digest was taken before
	lines    []game.StagedLine
	stages   map[string]string // stage id → kind and role
	opened   map[string]int64  // crates opened by stage
	// Prices.
	tally  map[*market.Book]*bookTally
	books  map[bookKey][]bookDay
	places map[int]hex.Hex
	// Staged experience.
	xpCap, xpMost, xpDays int64
	xpWho                 string
}

func newStagingWatch(b *sheets.Book, pol stagingPolicy, staged bool, server string) *stagingWatch {
	return &stagingWatch{b: b, policy: pol, staged: staged, server: server, home: -1, items: map[string]bool{}, hunts: map[string]bool{},
		tries: map[string]int{}, checked: map[string]int{}, stages: map[string]string{}, opened: map[string]int64{},
		tally: map[*market.Book]*bookTally{}, books: map[bookKey][]bookDay{}, places: map[int]hex.Hex{},
		xpCap: sheets.IntParam(b.LiveOpsParams, "staged-xp")}
}

// problem records a gate problem, naming the first few.
func (w *stagingWatch) problem(f string, a ...any) {
	w.leaks++
	if len(w.problems) < leaksKept {
		w.problems = append(w.problems, fmt.Sprintf(f, a...))
	}
}

// open adds the policy's two stagers to the main server's players, ahead
// of the quiet server's, makes every main player a beneficiary with a use
// drawn from the policy's shares, and hands the players a client that
// checks their staged attempts.
func (w *stagingWatch) open(sw *soakWorld) agent.Client {
	w.g = sw.g
	w.board = newStagingBoard(sw.g, sw.local)
	bands := agent.Bands(w.b)
	crateCap := sheets.IntParam(w.b.LiveOpsParams, "crate-cap")
	d := draw.NewDrawer(keys.Throwaway("search").Roll)
	for i, p := range sw.players[:sw.main] {
		p.Policy = &agent.Beneficiary{Inner: p.Policy, Use: w.useOf(d, i), Server: p.Server, Board: w.board, BandOrder: bands, Cap: crateCap}
		if w.rest && i%restEvery == 0 {
			p.Policy = &agent.Resting{Inner: p.Policy, From: stagingFrom * sheets.TicksPerDay, Every: restTicks}
		}
	}
	stager := func(templates []string) *agent.Stager {
		return &agent.Stager{Book: w.b, Board: w.board, Server: w.server, Templates: templates, Every: w.policy.every,
			From: stagingFrom * sheets.TicksPerDay, Days: w.policy.days, Far: w.policy.far, Off: !w.staged}
	}
	stagers := []*agent.Player{
		{Discord: "stager-admin", Start: "hook", Server: w.server, Admin: true, Policy: stager(w.policy.admin)},
		{Discord: "stager-staff", Start: "hook", Server: w.server, Staff: true, Policy: stager(w.policy.staff)},
	}
	arrive := make([]int64, len(stagers))
	for i := range arrive {
		arrive[i] = sheets.TicksPerDay + int64(i)
	}
	sw.players = slices.Concat(sw.players[:sw.main], stagers, sw.players[sw.main:])
	sw.arrive = slices.Concat(sw.arrive[:sw.main], arrive, sw.arrive[sw.main:])
	sw.main += len(stagers)
	c := &stagingClient{Client: sw.client, w: w}
	if pages, ok := sw.client.(agent.Pages); ok {
		return stagingPages{stagingClient: c, Pages: pages}
	}
	return c
}

// useOf is a main player's use of staged goods, by the policy's shares;
// "" past them, for a player who takes nothing.
func (w *stagingWatch) useOf(d *draw.Drawer, i int) string {
	roll := int64(d.Below(hundredPct, "search.staging", draw.Str("use"), draw.Int(int64(i))))
	for j, share := range w.policy.uses {
		if roll < share {
			return agent.Uses[j]
		}
		roll -= share
	}
	return ""
}

// structural: a hundred per cent.
const hundredPct = 100

// tick reads the transactions the players' commands posted, and which
// public books filled on the tick.
func (w *stagingWatch) tick(g *game.Game, txns []ledger.Txn) {
	w.stagedHunts(g)
	for _, t := range txns {
		w.audit(t)
	}
	if g.Market == nil || g.Tick()%sheets.TicksPerDay == 0 {
		return
	}
	for _, bk := range g.Market.Books {
		t := w.tallyOf(bk)
		if bk.Today.Units > t.last {
			t.fills++
		}
		t.last = bk.Today.Units
	}
}

// ticked reads the transactions the tick itself posted.
func (w *stagingWatch) ticked(g *game.Game, txns []ledger.Txn) {
	w.stagedHunts(g)
	for _, t := range txns {
		w.audit(t)
	}
}

func (w *stagingWatch) tallyOf(bk *market.Book) *bookTally {
	t, ok := w.tally[bk]
	if !ok {
		t = &bookTally{}
		w.tally[bk] = t
	}
	return t
}

// stagedHunts notes the hunts a stage opened, whose pools are staged
// homes while they live.
func (w *stagingWatch) stagedHunts(g *game.Game) {
	if g.Live == nil {
		return
	}
	for _, st := range g.Live.Stages {
		if st.HuntID != "" {
			w.hunts[st.HuntID] = true
		}
	}
}

// homeOf reports whether an account may hold staged goods (Decision 11).
func (w *stagingWatch) homeOf(acc string) bool {
	if ledger.StagedRest(acc) {
		return true
	}
	if id, ok := strings.CutPrefix(acc, ledger.HuntPool("")); ok {
		x := w.g.HuntByID(id)
		return w.hunts[id] || x != nil && x.Stage != ""
	}
	if id, ok := strings.CutPrefix(acc, ledger.EscrowPool("")); ok {
		return strings.HasPrefix(id, stagedOrder) || strings.HasPrefix(id, stagedListing)
	}
	return false
}

// audit checks one transaction: src:staged mints only staged goods and
// items, nothing mints coin or clean goods beside a staged mint, and every
// staged unit and item lands in a staged home.
func (w *stagingWatch) audit(t ledger.Txn) {
	staging, clean, stagedDebit := false, "", false
	for _, l := range t.Legs {
		_, isItem := ledger.ItemOf(l.Asset)
		fromSource := l.Units < 0 && strings.HasPrefix(l.Account, ledger.Source)
		switch {
		case l.Account == ledger.FromStaged && l.Units < 0:
			staging = true
			if !ledger.IsStaged(l.Asset) && !isItem {
				w.problem("%s %s: src:staged minted %s", t.Kind, t.Key, l.Asset)
			}
		case fromSource && stagedClean(l.Asset):
			clean = l.Asset
		}
		if fromSource && ledger.IsStaged(l.Asset) {
			w.minted -= l.Units
		}
		if l.Units < 0 && ledger.IsStaged(l.Asset) && strings.HasPrefix(l.Account, ledger.Holder) {
			stagedDebit = true
		}
	}
	if staging && clean != "" {
		w.problem("%s %s: minted %s while staging", t.Kind, t.Key, clean)
	}
	for _, l := range t.Legs {
		id, isItem := ledger.ItemOf(l.Asset)
		if isItem && l.Units > 0 && (staging || stagedDebit && fromSourceOf(t, l.Asset)) {
			w.items[id] = true
		}
	}
	for _, l := range t.Legs {
		if l.Units <= 0 {
			continue
		}
		id, isItem := ledger.ItemOf(l.Asset)
		if staged := ledger.IsStaged(l.Asset) || isItem && w.items[id]; !staged {
			continue
		}
		if !w.homeOf(l.Account) {
			w.problem("%s %s: %s credited to %s", t.Kind, t.Key, l.Asset, l.Account)
		}
		if t.Kind == txnFill && ledger.IsStaged(l.Asset) && strings.HasPrefix(l.Account, ledger.Holder) && slices.ContainsFunc(t.Legs, func(o ledger.Leg) bool {
			return o.Asset == l.Asset && o.Units < 0 && w.stagedEscrow(o.Account)
		}) {
			w.traded += l.Units
		}
	}
}

// stagedEscrow reports whether an account is a staged order's or
// listing's escrow.
func (w *stagingWatch) stagedEscrow(acc string) bool {
	return ledger.IsEscrow(acc) && w.homeOf(acc)
}

// fromSourceOf reports whether a transaction mints an asset from a
// source.
func fromSourceOf(t ledger.Txn, asset string) bool {
	return slices.ContainsFunc(t.Legs, func(l ledger.Leg) bool {
		return l.Asset == asset && l.Units < 0 && strings.HasPrefix(l.Account, ledger.Source)
	})
}

// stagedClean reports whether an asset is coin, provisions or a material:
// what nothing staged may mint.
func stagedClean(asset string) bool {
	if asset == ledger.Coin || asset == ledger.Provisions {
		return true
	}
	_, ok := ledger.MaterialOf(asset)
	return ok
}

// day reads the world day just ended: each public book's day, the
// staged books and balances, the staged lines and the staged experience.
func (w *stagingWatch) day(g *game.Game) {
	w.dayN++
	if n, ok := w.board.Home(w.server); ok {
		w.home = n
	}
	for i, p := range g.Places {
		w.places[i] = p.Hex
	}
	w.readBooks(g)
	w.readStaged(g)
	w.readXP(g)
	if g.Live != nil {
		for _, st := range g.Live.Stages {
			w.stages[st.ID] = st.Kind + " by " + st.Role
			w.opened[st.ID] = st.Opened.Sum()
		}
	}
}

func (w *stagingWatch) readBooks(g *game.Game) {
	if g.Market == nil {
		return
	}
	for _, bk := range g.Market.Books {
		t := w.tallyOf(bk)
		var d market.Day
		if len(bk.Days) > 0 {
			d = bk.Days[len(bk.Days)-1]
		}
		if d.Units > t.last {
			t.fills++
		}
		x := bookDay{day: w.dayN, units: d.Units, coin: d.Coin, fills: t.fills}
		for _, o := range bk.Bids {
			if o.Faction != nil {
				x.bidSum += o.Price
				x.bids++
			}
		}
		k := bookKey{bk.Settlement, bk.Material}
		w.books[k] = append(w.books[k], x)
		t.last, t.fills = 0, 0
	}
}

// readStaged checks where the world's staged goods rest: every staged
// balance in a staged home, every staged order's escrow on its own book's
// asset, no faction order on a staged book, every staged listing at its
// origin, and each server's staged line reconciling.
func (w *stagingWatch) readStaged(g *game.Game) {
	orders := map[string]bookKey{}
	if g.Market != nil {
		for _, bk := range g.Market.Staged {
			for o := range bk.Orders() {
				orders[ledger.EscrowPool(o.ID)] = bookKey{bk.Settlement, bk.Material}
				if o.Faction != nil || !strings.HasPrefix(o.Owner, ledger.Holder) {
					w.problem("day %d: a staged book at settlement %d holds %s's order %s", w.dayN, bk.Settlement, o.Owner, o.ID)
				}
			}
		}
		for _, l := range g.Market.Listings {
			if l.Item != nil && l.Item.Staged != nil && (!l.Staged || l.Settlement != l.Item.Staged.At) {
				w.problem("day %d: staged item %s listed at settlement %d, staged at %d", w.dayN, l.Item.ID, l.Settlement, l.Item.Staged.At)
			}
		}
	}
	for _, x := range g.Ledger.Balances {
		n, m, ok := ledger.StagedOf(x.Asset)
		if !ok || x.Units <= 0 || strings.HasPrefix(x.Account, ledger.Source) {
			continue
		}
		if !w.homeOf(x.Account) {
			w.problem("day %d: %s holds %d %s", w.dayN, x.Account, x.Units, x.Asset)
			continue
		}
		id, _ := strings.CutPrefix(x.Account, ledger.EscrowPool(""))
		if k, ok := orders[x.Account]; strings.HasPrefix(id, stagedOrder) && (!ok || k != bookKey{n, m}) {
			w.problem("day %d: %s holds %s, not its staged book's", w.dayN, x.Account, x.Asset)
		}
	}
	w.lines = g.StagedLines()
	for _, l := range w.lines {
		if l.Minted != l.Held+l.Spent {
			w.problem("day %d: %s's staged line: %d minted, %d held, %d spent", w.dayN, cmp.Or(l.Server, "no server"), l.Minted, l.Held, l.Spent)
		}
	}
}

// readXP reads each character's staged experience for the day just ended.
func (w *stagingWatch) readXP(g *game.Game) {
	for _, c := range g.Chars {
		if c.C.StagedDay != g.World.Day-1 || c.C.StagedXP <= 0 {
			continue
		}
		w.xpDays++
		if c.C.StagedXP > w.xpMost {
			w.xpMost, w.xpWho = c.C.StagedXP, c.C.ID
		}
	}
}

// closeWith ends the gate's reading: the conservation check and the
// minted count against the staged lines.
func (w *stagingWatch) closeWith(audit []string) {
	for _, a := range audit {
		w.problem("conservation: %s", a)
	}
	var minted int64
	for _, l := range w.lines {
		minted += l.Minted
	}
	if minted != w.minted {
		w.problem("the staged lines count %d units minted and the transactions %d", minted, w.minted)
	}
}

// stagingClient is the players' client in a staging twin: it notes every
// staged attempt, and checks that a refused one left the game as it was.
type stagingClient struct {
	agent.Client
	w *stagingWatch
}

// stagingPages is a stagingClient that also serves the pages.
type stagingPages struct {
	*stagingClient
	agent.Pages
}

func (c *stagingClient) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	what := c.w.attempt(req)
	if what == "" {
		return c.Client.Act(ctx, req)
	}
	var before canon.Sum
	check := c.w.checked[what] < refusalChecks
	if check {
		c.w.checked[what]++
		var err error
		if before, err = c.w.g.Digest(); err != nil {
			return api.ActionReply{}, nil, err
		}
	}
	rep, ref, err := c.Client.Act(ctx, req)
	if err != nil {
		return rep, ref, err
	}
	if ref == nil {
		c.w.tries[what+" · accepted"]++
		return rep, ref, nil
	}
	c.w.tries[what+" · "+ref.Code]++
	if check {
		after, err := c.w.g.Digest()
		if err != nil {
			return rep, ref, err
		}
		if after != before {
			c.w.problem("refused %s (%s) changed the game", what, ref.Code)
		}
	}
	return rep, ref, nil
}

// attempt names a request that stages, takes from a stage or uses staged
// goods, "" for any other.
func (w *stagingWatch) attempt(req api.ActionRequest) string {
	c := w.g.Char(req.CharacterID)
	switch {
	case req.Kind == api.ActStage:
		return "stage as " + either(req.Admin, "admin", "staff")
	case req.Kind == api.ActStageEnd || req.Kind == api.ActCrateOpen:
		return req.Kind
	case c == nil:
		return ""
	case req.Kind == api.ActHuntPress:
		if x := w.g.HuntByID(req.Target); x != nil && x.Stage != "" {
			return "staged hunt-press"
		}
	case req.Staged:
		return req.Kind + " on the staged book"
	case req.Kind == api.ActGive && ledger.IsStaged(req.Asset):
		return "give staged goods"
	case req.Kind == api.ActList && slices.ContainsFunc(c.C.Pack, func(in *item.Instance) bool { return in.ID == req.Item && in.Staged != nil }):
		return "list a staged item"
	case req.Kind == api.ActCraft && req.Recipe != nil && slices.ContainsFunc(req.Recipe.Inputs, func(in api.Goods) bool { return stagedHeld(c, in.Material) > 0 }):
		return "craft with staged goods"
	case (req.Kind == api.ActSell || req.Kind == api.ActAsk) && stagedHeld(c, req.Material) > 0 && cleanHeld(c, req.Material) < req.Units:
		return req.Kind + " staged goods on the book"
	}
	return ""
}

// stagedHeld and cleanHeld are a character's staged and clean units of a
// material.
func stagedHeld(c *game.Char, m string) int64 {
	var n int64
	for _, s := range c.C.Staged {
		if s.Material == m {
			n += s.Units
		}
	}
	return n
}

func cleanHeld(c *game.Char, m string) int64 {
	for _, s := range c.C.Goods {
		if s.Material == m {
			return s.Qty
		}
	}
	return 0
}

// priceRow is one settlement's material read in both twins over the
// staging window: the mean clearing price on days with fillsLeast fills in
// both, and the mean faction bid on days both had one.
type priceRow struct {
	n                      int
	material               string
	clearS, clearU         float64
	clearDays              int
	bidS, bidU             float64
	bidDays                int
	clearDev, bidDev, most float64
}

// stagingReading is a staged twin read against its unstaged one.
type stagingReading struct {
	rows  []priceRow
	worst priceRow
	read  bool // some price was compared
}

// compareTwins reads every public book at every settlement but the
// staging one, in both twins, over the staging window (Decision 5).
func compareTwins(s, u *stagingWatch) stagingReading {
	var out stagingReading
	keys := slices.SortedFunc(maps.Keys(s.books), func(a, b bookKey) int { return cmp.Or(cmp.Compare(a.n, b.n), cmp.Compare(a.m, b.m)) })
	for _, k := range keys {
		if k.n == s.home || k.n == u.home {
			continue
		}
		ud, ok := u.books[k]
		if !ok || s.places[k.n] != u.places[k.n] {
			continue
		}
		byDay := map[int64]bookDay{}
		for _, d := range ud {
			byDay[d.day] = d
		}
		row := priceRow{n: k.n, material: k.m}
		var cs, us, cu, uu, bs, bu float64
		for _, a := range s.books[k] {
			b, ok := byDay[a.day]
			if !ok || a.day < stagingFrom {
				continue
			}
			if a.fills >= fillsLeast && b.fills >= fillsLeast && a.units > 0 && b.units > 0 {
				cs, cu = cs+float64(a.coin), cu+float64(a.units)
				us, uu = us+float64(b.coin), uu+float64(b.units)
				row.clearDays++
			}
			if a.bids > 0 && b.bids > 0 {
				bs += float64(a.bidSum) / float64(a.bids)
				bu += float64(b.bidSum) / float64(b.bids)
				row.bidDays++
			}
		}
		if row.clearDays == 0 && row.bidDays == 0 {
			continue
		}
		if row.clearDays > 0 {
			row.clearS, row.clearU = cs/cu, us/uu
			row.clearDev = deviation(row.clearS, row.clearU)
		}
		if row.bidDays > 0 {
			row.bidS, row.bidU = bs/float64(row.bidDays), bu/float64(row.bidDays)
			row.bidDev = deviation(row.bidS, row.bidU)
		}
		row.most = math.Max(row.clearDev, row.bidDev)
		out.rows = append(out.rows, row)
		if !out.read || row.most > out.worst.most {
			out.worst, out.read = row, true
		}
	}
	return out
}

// deviation is how far a price moved from its unstaged twin's, per cent.
func deviation(staged, unstaged float64) float64 {
	if unstaged == 0 {
		return 0
	}
	return math.Abs(staged-unstaged) * hundredPct / unstaged
}

// holds reports whether the reading keeps within stayLocalPct.
func (r stagingReading) holds() bool { return !r.read || r.worst.most <= stayLocalPct }

// where names the reading's worst row.
func (r stagingReading) where() string {
	if !r.read {
		return "no price read"
	}
	w := r.worst
	if w.most == 0 {
		return "0.00% (no price moved)"
	}
	return fmt.Sprintf("%.2f%% (%s at settlement %d)", w.most, w.material, w.n)
}

// stagingSection writes a staged twin's report: the policy, what was
// staged and taken, the gate and its attempts, the staged lines, the
// prices at every other settlement against the unstaged twin and the
// control's, and the staged experience.
func stagingSection(p func(string, ...any), title string, ts twinSet) {
	s, u, w := ts.staged, ts.unstaged, ts.staged.watch
	r, control, play := ts.readings()
	p("## %s", title)
	p("")
	p("Policy `%s`: %s. Staging from world day %d of %d; %s players, %s actions (%s refused) staged against %s (%s refused) unstaged.", s.policy.name, s.policy,
		stagingFrom, w.dayN, comma(int64(s.size)), comma(int64(s.actions)), comma(int64(s.refused)), comma(int64(u.actions)), comma(int64(u.refused)))
	p("")
	kinds := map[string]int{}
	var crates int64
	for id, k := range w.stages {
		kinds[k]++
		crates += w.opened[id]
	}
	var staged []string
	for _, k := range slices.Sorted(maps.Keys(kinds)) {
		staged = append(staged, fmt.Sprintf("%d %s", kinds[k], k))
	}
	p("Staged: %s; %s crates opened; %s staged units minted, %s bought on the staged books.", cmp.Or(strings.Join(staged, ", "), "nothing"),
		comma(crates), comma(w.minted), comma(w.traded))
	p("")
	p("| Staged attempt | Ended | Times |")
	p("| --- | --- | --- |")
	for _, k := range slices.Sorted(maps.Keys(w.tries)) {
		what, how, _ := strings.Cut(k, " · ")
		p("| %s | %s | %d |", what, how, w.tries[k])
	}
	p("")
	p("| Server | Staged units minted | Held | Spent | Coin traded this week | Reconciles |")
	p("| --- | --- | --- | --- | --- | --- |")
	for _, l := range w.lines {
		p("| %s | %d | %d | %d | %d | %s |", cmp.Or(l.Server, "none"), l.Minted, l.Held, l.Spent, l.Traded, holds(l.Minted == l.Held+l.Spent))
	}
	p("")
	p("Gate (`staged-goods-local`): %s.", either(w.leaks == 0, "clean: every staged leg landed in a staged home, nothing clean was minted beside a staged mint, every staged book and listing is at its origin, every staged line reconciles and every refused attempt checked left the game as it was", fmt.Sprintf("**%d problems**", w.leaks)))
	for _, x := range w.problems {
		p("- %s", x)
	}
	p("")
	p("Prices at every settlement but the staging one (%d), staged against unstaged, over world days %d to the end: the mean clearing price on days with %d or more fills in both twins, and the mean faction bid (`staging-stays-local`: at most %d%%).", w.home, stagingFrom, fillsLeast, stayLocalPct)
	p("")
	p("| Settlement | Material | Clearing, staged | Unstaged | Days | Moved | Faction bid, staged | Unstaged | Days | Moved |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, x := range r.rows {
		p("| %d | %s | %.2f | %.2f | %d | %.2f%% | %.2f | %.2f | %d | %.2f%% |", x.n, x.material, x.clearS, x.clearU, x.clearDays, x.clearDev, x.bidS, x.bidU, x.bidDays, x.bidDev)
	}
	p("")
	p("Largest move, staged and taken: %s. The control, staged the same with nothing taken, moves %s: the stages' own footprint, which `staging-stays-local` holds to %d%%: %s. The rest is what the staging server's players did instead of their play. Faction wants are world-wide (GDD 10.4), so any change in how the staging server plays moves every settlement's bids: the staging-free twin, where one main player in %d rests one tick in %d with nothing staged, moves %s.",
		r.where(), control.where(), stayLocalPct, holds(control.holds()), restEvery, restTicks, play.where())
	p("")
	p("Staged experience (`staged-xp-cap`, at most %d a character a world day): the most in a day was %d (%s), over %d character-days with any.", w.xpCap, w.xpMost, cmp.Or(w.xpWho, "nobody"), w.xpDays)
	p("")
}

// economyStaging is the Economy run's staging (Decision 71): at each size,
// the fixed maximum policy staged at the main server against its unstaged
// twin, read for staging-stays-local and staged-goods-local.
func economyStaging(p func(string, ...any), b *sheets.Book, sizes []int, days int64) ([]Measured, error) {
	pol := strongestSeed()
	gate, local, problems := true, true, 0
	var where []string
	for _, size := range sizes {
		ts, err := stagingTwins(b, size, days, pol)
		if err != nil {
			return nil, err
		}
		taken, footprint, play := ts.readings()
		stagingSection(p, fmt.Sprintf("Staging at %s players", comma(int64(size))), ts)
		local = local && footprint.holds()
		for _, s := range ts.soaks() {
			gate = gate && s.watch.leaks == 0
			problems += s.watch.leaks
		}
		where = append(where, fmt.Sprintf("%s players: the stages' footprint %s; taken, %s; a staging-free change of play, %s", comma(int64(size)), footprint.where(), taken.where(), play.where()))
	}
	if len(sizes) == 0 {
		return nil, nil
	}
	return []Measured{
		{Target: "staging-stays-local", Value: fmt.Sprintf("`%s`, %s", pol.name, strings.Join(where, "; ")), Holds: local},
		{Target: "staged-goods-local", Value: either(gate, "every staged unit in a staged home and accounted for", fmt.Sprintf("%d problems", problems)), Holds: gate},
	}, nil
}
