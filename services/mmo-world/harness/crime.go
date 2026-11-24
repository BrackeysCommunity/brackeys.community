package harness

import (
	"context"
	"errors"
	"fmt"
	"os"
	"runtime"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/faucet"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// Crime run targets (GDD 18.3).
const (
	inviteDaysLo = 7  // world days from a first theft to the invitation, at least
	inviteDaysHi = 14 // and at most
	citySlipDays = 3  // world days the first city may slip with thieves about
)

// structural: what the Crime run reads by name: transaction kinds, fact
// kinds and their data, the invitation's arc, and the share the prey
// side is tried at when the first city slips.
const (
	txnTheft         = "theft"
	txnFence         = "fence"
	txnTraderBought  = "trader-bought"
	txnFine          = "fine"
	factTheft        = "theft.made"
	factFled         = "watch.fled"
	factCaught       = "watch.caught"
	factBetrayed     = "character.betrayed"
	theftWon         = "won"
	theftLost        = "lost"
	theftEmpty       = "empty"
	inviteTemplate   = "the-invitation"
	wallsTemplate    = "thief-in-walls"
	preyShareCell    = "prey-share"
	preyShareSlipped = 50
)

// CrimeRun is the Economy run with one main player in ten a thief (GDD 6.5,
// 18.3): no theft mints, coin per active character holds the band, a
// first theft brings the invitation in time, and at 1,000 players the
// first city and road wars are read against a world without thieves.
func CrimeRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	sizes, days := economyPlan(n)
	var runs []crimeSoak
	for _, size := range sizes {
		r, err := soakCrime(b, size, days, true)
		if err != nil {
			return nil, fmt.Errorf("crime run at %d: %w", size, err)
		}
		runs = append(runs, r)
		if size == cityFrom {
			without, err := soakCrime(b, size, days, false)
			if err != nil {
				return nil, fmt.Errorf("crime run at %d without thieves: %w", size, err)
			}
			r.without = &without
			if r.slipped() {
				b2 := withCell(b, preyShareCell, preyShareSlipped)
				half, err := soakCrime(b2, size, days, true)
				if err != nil {
					return nil, fmt.Errorf("crime run at %d, prey share %d: %w", size, preyShareSlipped, err)
				}
				r.half = &half
			}
			runs[len(runs)-1] = r
		}
	}
	var doc lineDoc
	readings := crimeReport(doc.p, b, runs, days)
	if err := doc.save(out, "crime.md"); err != nil {
		return nil, err
	}
	return readings, nil
}

// withCell is a book with one theft.params cell set, the rest shared.
func withCell(b *sheets.Book, id string, v int64) *sheets.Book {
	b2 := *b
	b2.TheftParams = slices.Clone(b.TheftParams)
	for i := range b2.TheftParams {
		if b2.TheftParams[i].ID == id {
			b2.TheftParams[i].Value = fixed.FromInt(v)
		}
	}
	return &b2
}

// crimeSoak is one soak of the Crime run, with the run without thieves
// at the same size beside it where one was made, and the run at half
// the prey share when the first city slipped.
type crimeSoak struct {
	economyResult
	thieves bool
	watch   *crimeWatch
	without *crimeSoak
	half    *crimeSoak
}

// soakCrime soaks the Economy population at a size, thieves or none.
func soakCrime(b *sheets.Book, size int, days int64, thieves bool) (crimeSoak, error) {
	pop := soakers(b, size)
	w := &crimeWatch{}
	pop.watch = w
	if thieves {
		pop.stealers = func(p agent.Policy) agent.Policy {
			if e, ok := p.(*agent.Earner); ok {
				return agent.NewThief(b, e)
			}
			return p
		}
	}
	r, err := soak(b, pop, days)
	if err != nil {
		return crimeSoak{}, err
	}
	w.close(r.audit)
	fmt.Fprintf(os.Stderr, "crime %d%s: %s, %d actions, %d refused, %d thefts, digest %s\n", size, either(thieves, "", " without thieves"), r.elapsed.Round(time.Second), r.actions, r.refused, w.begun(), r.digest)
	return crimeSoak{economyResult: r, thieves: thieves, watch: w}, nil
}

// slipped reports whether the first city with thieves came more than
// citySlipDays after it did without, or came only without.
func (r crimeSoak) slipped() bool {
	if r.without == nil {
		return false
	}
	with, without := r.guild.city.raised, r.without.guild.city.raised
	switch {
	case without == 0:
		return false
	case with == 0:
		return true
	}
	return with > without+citySlipDays
}

// crimeWatch reads a Crime run's world as it plays: every theft's
// transaction against the accounts a theft may take from, every fence's
// and trader's coin against the day's slice, the thieves' thefts and
// invitations, and the road wars.
type crimeWatch struct {
	g       *game.Game
	players []*agent.Player
	// sellers are the NPC listings a lift could take an item from, by
	// escrow account, read before each lift begins.
	sellers map[string]string
	first   map[string]int64 // a thief's first theft.made, by character
	invited map[string]int64 // the tick its first invitation was cast
	made    map[string]bool  // ever made
	// outcomes are theft.made facts by kind and outcome; witnessed those
	// seen, side the waylays a prey side took.
	outcomes  map[string]map[string]int
	witnessed int
	side      int
	fled      int
	caught    int
	betrayed  int
	refusals  map[string]int // thieves' refused commands, by kind and code
	thief     map[string]bool
	daily     map[string]int // thefts begun by character and world day
	mostDay   int            // the most thefts one character began in a world day
	thefts    int            // theft transactions read
	legs      int            // their source legs
	bad       []string       // sources no theft may take from
	stolen    int64          // coin a theft took
	goods     int64          // goods and items a theft took
	fenced    int64          // coin fences paid
	fences    int
	fines     int
	fineCoin  int64
	slice     map[int64][]int64 // the trader's slice at each world day's start
	spent     map[int64][]int64 // fence and trader coin paid out of it, by day
	over      []string          // a slice overspent
	worstUse  float64           // the largest share of a slice fences took on a day
	jobs      map[string]bool   // syndicate jobs posted, by goal
	jobsMet   map[string]bool
	road      roadWars
	audit     []string
	// where are theft.made facts by the settlement they were made in, -1
	// for none; walls the thief-in-walls troubles that ended, by outcome.
	where  map[int64]int
	walls  map[string]int
	walled map[string]bool
}

func (w *crimeWatch) open(sw *soakWorld) agent.Client {
	w.g, w.players = sw.g, sw.players
	w.sellers, w.first, w.invited, w.made = map[string]string{}, map[string]int64{}, map[string]int64{}, map[string]bool{}
	w.outcomes, w.refusals, w.thief, w.daily = map[string]map[string]int{}, map[string]int{}, map[string]bool{}, map[string]int{}
	w.slice, w.spent = map[int64][]int64{}, map[int64][]int64{}
	w.jobs, w.jobsMet = map[string]bool{}, map[string]bool{}
	w.where, w.walls, w.walled = map[int64]int{}, map[string]int{}, map[string]bool{}
	w.snapSlice(sw.g)
	if l, ok := sw.client.(*service.Local); ok {
		return crimeLocal{Local: l, w: w}
	}
	return crimeBare{Client: sw.client, w: w}
}

// crimeLocal is the soak's client with the pages a thief reads, watched.
type crimeLocal struct {
	*service.Local
	w *crimeWatch
}

func (c crimeLocal) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	return c.w.act(ctx, c.Local, req)
}

// crimeBare is a client with no pages, watched.
type crimeBare struct {
	agent.Client
	w *crimeWatch
}

func (c crimeBare) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	return c.w.act(ctx, c.Client, req)
}

// act sends a player's request, noting before a lift which listings its
// NPC has up, and after it the thefts the reply tells.
func (w *crimeWatch) act(ctx context.Context, c agent.Client, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	if req.Kind == api.ActSteal && req.Option == api.TheftLift && req.NPC != "" && w.g.Market != nil {
		purse := ledger.NPCPool(req.NPC)
		for _, l := range w.g.Market.Listings {
			if l.Seller == purse {
				w.sellers[ledger.EscrowPool(l.ID)] = l.Seller
			}
		}
	}
	rep, ref, err := c.Act(ctx, req)
	if err != nil {
		return rep, ref, err
	}
	if ref != nil {
		if crimeKind(req.Kind) || w.thiefOf(req.CharacterID) {
			w.refusals[req.Kind+" "+ref.Code]++
		}
		return rep, ref, nil
	}
	if req.Kind == api.ActSteal {
		day := fmt.Sprintf("%s/%d", req.CharacterID, rep.Tick/sheets.TicksPerDay)
		w.daily[day]++
		w.mostDay = max(w.mostDay, w.daily[day])
	}
	for _, f := range rep.Facts {
		if !slices.ContainsFunc(f.Subjects, func(r api.Ref) bool { return r.ID == req.CharacterID }) {
			continue
		}
		switch f.Kind {
		case factTheft:
			if _, ok := w.first[req.CharacterID]; !ok {
				w.first[req.CharacterID] = f.Tick
			}
			kind, outcome := datumS(f, "kind"), datumS(f, "outcome")
			w.where[datumN(f, "settlement")]++
			if w.outcomes[kind] == nil {
				w.outcomes[kind] = map[string]int{}
			}
			w.outcomes[kind][outcome]++
			if datumN(f, "witnessed") > 0 && outcome == theftWon {
				w.witnessed++
			}
			if datumS(f, "side") != "" && outcome == theftWon {
				w.side++
			}
		case factFled:
			w.fled++
		case factCaught:
			w.caught++
		case factBetrayed:
			w.betrayed++
		}
	}
	return rep, ref, nil
}

// thiefOf reports whether a character is a thief's.
func (w *crimeWatch) thiefOf(id string) bool {
	if id == "" {
		return false
	}
	if _, ok := w.thief[id]; !ok {
		w.thief[id] = slices.ContainsFunc(w.players, func(p *agent.Player) bool {
			_, steals := p.Policy.(*agent.Thief)
			return steals && p.Character == id
		})
	}
	return w.thief[id]
}

// crimeKind is a command only theft and the watch send.
func crimeKind(kind string) bool {
	return kind == api.ActSteal || kind == api.ActFence || kind == api.ActPayFine || kind == api.ActFlee
}

func datumS(f api.Fact, key string) string {
	for _, d := range f.Data {
		if d.Key == key {
			return d.S
		}
	}
	return ""
}

func datumN(f api.Fact, key string) int64 {
	for _, d := range f.Data {
		if d.Key == key {
			return d.N
		}
	}
	return 0
}

// snapSlice keeps the trader's slice of each settlement as the world day
// opens: what fences and the trader may pay out that day, together.
func (w *crimeWatch) snapSlice(g *game.Game) {
	if g.Market == nil {
		return
	}
	day := g.Tick() / sheets.TicksPerDay
	w.slice[day] = slices.Clone(g.Market.Trader)
	w.spent[day] = make([]int64, len(g.Market.Trader))
}

// tick reads a tick's transactions: each theft's source legs, each fence
// sale's and trader purchase's coin out of its settlement's slice, and
// the fines.
func (w *crimeWatch) tick(g *game.Game, txns []ledger.Txn) {
	for _, t := range txns {
		switch t.Kind {
		case txnTheft:
			w.thefts++
			for _, l := range t.Legs {
				if strings.HasPrefix(l.Account, ledger.Source) {
					w.bad = append(w.bad, fmt.Sprintf("%s: %d %s from %s", t.Key, l.Units, l.Asset, l.Account))
				}
				if l.Units >= 0 {
					if _, ok := ledger.CharOf(l.Account); ok {
						if l.Asset == ledger.Coin {
							w.stolen += l.Units
						} else {
							w.goods += l.Units
						}
					}
					continue
				}
				w.legs++
				if !w.mayTake(l.Account) {
					w.bad = append(w.bad, fmt.Sprintf("%s: %d %s from %s", t.Key, -l.Units, l.Asset, l.Account))
				}
			}
		case txnFence, txnTraderBought:
			for _, l := range t.Legs {
				id, ok := ledger.CharOf(l.Account)
				if !ok || l.Asset != ledger.Coin || l.Units <= 0 {
					continue
				}
				if t.Kind == txnFence {
					w.fenced += l.Units
					w.fences++
				}
				w.spend(g, t, id, l.Units)
			}
		case txnFine:
			w.fines++
			for _, l := range t.Legs {
				if l.Account == ledger.ToFees && l.Asset == ledger.Coin {
					w.fineCoin += l.Units
				}
			}
		}
	}
}

// mayTake reports whether a theft may take from an account: an NPC's
// purse, a faction's store, a caravan, or the escrow of a listing an NPC
// had up when the lift began. The game holds every theft to the same.
func (w *crimeWatch) mayTake(acc string) bool {
	if _, ok := ledger.NPCOf(acc); ok {
		return true
	}
	if ledger.IsStore(acc) || ledger.IsCaravan(acc) {
		return true
	}
	if !ledger.IsEscrow(acc) {
		return false
	}
	_, npcSells := ledger.NPCOf(w.sellers[acc])
	return npcSells
}

// spend counts coin a fence or the trader paid at the settlement the
// character stands in against that day's slice.
func (w *crimeWatch) spend(g *game.Game, t ledger.Txn, id string, coin int64) {
	c := g.Char(id)
	if c == nil {
		return
	}
	n, ok := g.SettlementAt(c.C.At)
	day := t.Tick / sheets.TicksPerDay
	slice, spent := w.slice[day], w.spent[day]
	if !ok || n >= len(spent) {
		w.over = append(w.over, fmt.Sprintf("%s paid %d coin on day %d where no slice was set", t.Key, coin, day))
		return
	}
	spent[n] += coin
	if spent[n] > slice[n] {
		w.over = append(w.over, fmt.Sprintf("settlement %d paid %d coin of a %d coin slice on day %d (%s)", n, spent[n], slice[n], day, t.Key))
	}
	if t.Kind == txnFence && slice[n] > 0 {
		w.worstUse = max(w.worstUse, float64(spent[n])/float64(slice[n]))
	}
}

// day opens the next world day's slice and reads the thieves'
// invitations and syndicate jobs, and the road wars.
func (w *crimeWatch) day(g *game.Game) {
	w.snapSlice(g)
	w.road.day(g)
	if g.Story != nil {
		for _, a := range g.Story.Arcs {
			if a.Template == wallsTemplate && a.Ended != 0 && !w.walled[a.ID] {
				w.walled[a.ID] = true
				w.walls[a.Outcome]++
			}
			if a.Template != inviteTemplate || a.Scope != arc.Personal {
				continue
			}
			if _, ok := w.invited[a.Char]; !ok {
				w.invited[a.Char] = a.Began
			}
		}
	}
	for _, p := range w.thieves() {
		if c := g.Char(p.Character); c != nil && char.IsMade(c.C) {
			w.made[p.Character] = true
		}
	}
	for _, x := range g.Goals {
		if x.Issuer.Kind != goal.BySyndicate {
			continue
		}
		w.jobs[x.ID] = true
		if len(x.Claims) > 0 {
			w.jobsMet[x.ID] = true
		}
	}
}

// thieves are the players who steal, with a character.
func (w *crimeWatch) thieves() []*agent.Player {
	var out []*agent.Player
	for _, p := range w.players {
		if _, ok := p.Policy.(*agent.Thief); ok && p.Character != "" {
			out = append(out, p)
		}
	}
	return out
}

func (w *crimeWatch) close(audit []string) { w.audit = audit }

// begun is how many thefts ended in a theft.made.
func (w *crimeWatch) begun() int {
	n := 0
	for _, by := range w.outcomes {
		for _, v := range by {
			n += v
		}
	}
	return n
}

func (w *crimeWatch) outcome(o string) int {
	n := 0
	for _, by := range w.outcomes {
		n += by[o]
	}
	return n
}

// mints reports whether theft-never-mints holds: every source a theft
// took from may be taken from, no fence or trader spent past its slice,
// and the audit is clean.
func (w *crimeWatch) mints() bool { return len(w.bad) == 0 && len(w.over) == 0 && len(w.audit) == 0 }

// inviteDays are the world days from each thief's first theft to its
// first invitation, sorted, for the thieves invited; and how many thieves
// stole.
func (w *crimeWatch) inviteDays() ([]int64, int) {
	var out []int64
	for who, first := range w.first {
		if cast, ok := w.invited[who]; ok && cast >= first {
			out = append(out, cast/sheets.TicksPerDay-first/sheets.TicksPerDay)
		}
	}
	slices.Sort(out)
	return out, len(w.first)
}

// crimeReport writes the Crime run's report through p and returns its
// readings.
func crimeReport(p func(string, ...any), b *sheets.Book, runs []crimeSoak, days int64) []Measured {
	fp := faucet.ParamsOf(b.EconomyParams)
	lo, hi := fp.Low, fp.High
	p("# Crime run")
	p("")
	p("The Economy run's players (`harness economy`: the same names, roles, key and dice), with every main player whose index is %d in %d a thief (`harness/agent.Thief`): it plays its role as before, and up to %d times a world day where something is there to take it burgles, else lifts, else waylays (for the prey side of a road war it backs, the haul goes to that side). It fences what it holds hot wherever a fence will see it, pays the watch that stops it or runs, walks to its invitation's den and takes the job, and once made goes for the syndicate's jobs first and never robs a fence or anyone crooked. %d world days; the band is read over days %d to %d.", stealEvery-1, stealEvery, agent.NewThief(b, &agent.Earner{}).PerDay, days, economyWarmup, days)
	p("")
	p("Every theft transaction's source legs are checked against the accounts a theft may take from: an NPC's purse, a faction's store, a caravan, or the escrow of a listing an NPC had up when the lift began; none is a source. Fence and trader coin is counted against each settlement's trader slice of the day's faction budget as the day opened. The ledger is audited at the end.")
	p("")
	var readings []Measured
	allBand, allDrift, mints := true, true, true
	var held, drifted, mintNotes []string
	p("| Players | Thieves | Coin per active character, days %d–%d | Rule | Holds | Thefts | Theft-never-mints | Conservation | Time |", economyWarmup, days)
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, r := range runs {
		v := bandVerdict(r.days, r.size, lo, hi)
		mn, mx, rule := v.mn, v.mx, v.rule
		ok := v.ok && len(r.audit) == 0
		if v.drifts {
			allDrift = allDrift && ok
			drifted = append(drifted, comma(int64(r.size)))
		} else {
			allBand = allBand && ok
			held = append(held, comma(int64(r.size)))
		}
		w := r.watch
		mints = mints && w.mints()
		mintNotes = append(mintNotes, fmt.Sprintf("%s players: %s theft transactions, %s source legs", comma(int64(r.size)), comma(int64(w.thefts)), comma(int64(w.legs))))
		p("| %s | %d | %d to %d coin | %s | %s | %s | %s | %s | %s |", comma(int64(r.size)), len(w.thieves()), mn, mx, rule, holds(ok), comma(int64(w.begun())), holds(w.mints()), auditWord(r.audit), r.elapsed.Round(time.Second))
	}
	p("")
	p("## Thefts")
	p("")
	p("Thefts as `theft.made` tells them (won, caught, or empty: nothing left to take when the last beat was won), what they took, and what came of it.")
	p("")
	p("| Players | Burglaries | Lifts | Waylays | Won | Caught | Empty | Witnessed (won) | For a prey side | Most begun by one thief in a day | Coin taken | Goods taken | Fenced | Fines paid | Fled | Caught fleeing | Betrayals | Made | Jobs posted | Jobs met |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, r := range runs {
		w := r.watch
		kind := func(k string) string {
			n := 0
			for _, v := range w.outcomes[k] {
				n += v
			}
			return comma(int64(n))
		}
		p("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %d | %s coin | %s | %s coin in %s sales | %s (%s coin) | %d | %d | %d | %d | %d | %d |", comma(int64(r.size)), kind(api.TheftBurgle), kind(api.TheftLift), kind(api.TheftWaylay),
			comma(int64(w.outcome(theftWon))), comma(int64(w.outcome(theftLost))), comma(int64(w.outcome(theftEmpty))), comma(int64(w.witnessed)), comma(int64(w.side)), w.mostDay,
			comma(w.stolen), comma(w.goods), comma(w.fenced), comma(int64(w.fences)), comma(int64(w.fines)), comma(w.fineCoin), w.fled, w.caught, w.betrayed, len(w.made), len(w.jobs), len(w.jobsMet))
	}
	p("")
	for _, r := range runs {
		w := r.watch
		where := map[string]int{}
		for n, v := range w.where {
			name := "away from a settlement"
			if n >= 0 && int(n) < len(w.g.Places) {
				name = w.g.PlaceName(w.g.SettlementHex(int(n)))
			}
			where[name] += v
		}
		if len(where) > 0 {
			p("Where they were made at %s players: %s.", comma(int64(r.size)), mapList(where))
			p("")
		}
		if len(w.walls) > 0 {
			p("A thief in the walls ended at %s players: %s.", comma(int64(r.size)), mapList(w.walls))
			p("")
		}
		if len(w.refusals) > 0 {
			p("Thieves' commands refused at %s players: %s.", comma(int64(r.size)), mapList(w.refusals))
			p("")
		}
	}
	p("## Theft never mints")
	p("")
	p("| Players | Theft transactions | Source legs | Refused sources | Fence coin | Most of a slice fences took on a day | Slices overspent | Conservation |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, r := range runs {
		w := r.watch
		p("| %s | %s | %s | %d | %s | %.0f%% | %d | %s |", comma(int64(r.size)), comma(int64(w.thefts)), comma(int64(w.legs)), len(w.bad), comma(w.fenced), 100*w.worstUse, len(w.over), auditWord(r.audit))
	}
	p("")
	for _, r := range runs {
		w := r.watch
		for _, x := range firstOf(w.bad, auditShown) {
			p("- %s players, a theft from what no theft may take from: %s", comma(int64(r.size)), x)
		}
		for _, x := range firstOf(w.over, auditShown) {
			p("- %s players: %s", comma(int64(r.size)), x)
		}
		for _, x := range firstOf(r.audit, auditShown) {
			p("- %s players, the audit: %s", comma(int64(r.size)), x)
		}
	}
	readings = append(readings, Measured{Target: "theft-never-mints", Value: strings.Join(mintNotes, "; ") + ": every source an NPC, a store, a caravan or an NPC's listing; fences inside the slice; audit clean", Holds: mints})
	if !mints {
		readings[len(readings)-1].Value = strings.Join(mintNotes, "; ") + ": see crime.md"
	}
	if len(held) > 0 {
		readings = append(readings, Measured{Target: "coin-band", Value: fmt.Sprintf("with thieves, %s players, days %d–%d", strings.Join(held, ", "), economyWarmup, days), Holds: allBand})
	}
	if len(drifted) > 0 {
		readings = append(readings, Measured{Target: "coin-drift", Value: fmt.Sprintf("with thieves, %s players, %d days", strings.Join(drifted, ", "), days), Holds: allDrift})
	}
	var hold []string
	for _, r := range runs {
		v := bandVerdict(r.days, r.size, lo, hi)
		hold = append(hold, fmt.Sprintf("%s players %d–%d coin", comma(int64(r.size)), v.readLo, v.readHi))
	}
	readings = append(readings, Measured{Target: "thieves-hold-band", Value: strings.Join(hold, "; "), Holds: allBand && allDrift})

	p("## The invitation")
	p("")
	p("World days from a thief's first `theft.made` to the cast of its first `the-invitation` (GDD 12.9), over the thieves who stole; one never invited counts as later than any. The target is a median of %d to %d world days, read from %s players.", inviteDaysLo, inviteDaysHi, comma(cityFrom))
	p("")
	p("| Players | Thieves who stole | Invited | Median days | 10th to 90th percentile |")
	p("| --- | --- | --- | --- | --- |")
	var invite []string
	inviteOK, inviteMeasured := true, false
	for _, r := range runs {
		ds, stole := r.watch.inviteDays()
		med, spread := fmt.Sprintf("none in %d", days), "–"
		got := false
		if i := stole / 2; stole > 0 && i < len(ds) {
			med, got = fmt.Sprint(ds[i]), true
		}
		if len(ds) > 0 {
			spread = fmt.Sprintf("%d to %d", percentile(ds, 10), percentile(ds, 90))
		}
		p("| %s | %d | %d | %s | %s |", comma(int64(r.size)), stole, len(ds), med, spread)
		if r.size < cityFrom {
			continue
		}
		inviteMeasured = true
		ok := got && ds[stole/2] >= inviteDaysLo && ds[stole/2] <= inviteDaysHi
		inviteOK = inviteOK && ok
		invite = append(invite, fmt.Sprintf("%s players: median %s world days over %d thieves (%d invited)", comma(int64(r.size)), med, stole, len(ds)))
	}
	p("")
	if inviteMeasured {
		readings = append(readings, Measured{Target: "invitation-days", Value: strings.Join(invite, "; "), Holds: inviteOK})
	} else {
		readings = append(readings, notMeasured("invitation-days", fmt.Sprintf("read from %s players", comma(cityFrom))))
	}

	p("## The first city and the road wars")
	p("")
	p("At %s players the same world is also soaked without thieves. The target is the first city with thieves no more than %d world days after it without. A thief backing a road war's `%s` side waylays for it: the haul is delivered to the side at `%s` %% of its units. If the city slips, the run is made again with the share at %d%% and both are reported.", comma(cityFrom), citySlipDays, sidePrey, preyShareCell, preyShareSlipped)
	p("")
	p("| Players | Run | First city | Short at the end | Road wars ended | Won by %s | Won by %s | Lapsed | Waylays for a prey side |", sidePatrol, sidePrey)
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	city := func(r crimeSoak) string {
		return either(r.guild.city.raised > 0, fmt.Sprintf("day %d", r.guild.city.raised), fmt.Sprintf("none in %d days", days))
	}
	slip := notMeasured("road-war-city-slip", fmt.Sprintf("read at %s players", comma(cityFrom)))
	for _, r := range runs {
		rows := []struct {
			name string
			r    *crimeSoak
		}{{"with thieves", &r}, {"without thieves", r.without}}
		if r.half != nil {
			rows = append(rows, struct {
				name string
				r    *crimeSoak
			}{fmt.Sprintf("with thieves, prey share %d%%", preyShareSlipped), r.half})
		}
		for _, row := range rows {
			if row.r == nil {
				continue
			}
			rw := row.r.watch.road
			needs := row.r.guild.city.needs
			p("| %s | %s | %s | %s | %d | %d | %d | %d | %d |", comma(int64(r.size)), row.name, city(*row.r), either(len(needs) > 0, shortOf(needs), "–"), rw.ended(), rw.patrol, rw.prey, rw.lapsed, row.r.watch.side)
		}
		if r.without == nil {
			continue
		}
		value := fmt.Sprintf("%s with thieves, %s without; road wars with thieves %s, without %s", city(r), city(*r.without), r.watch.road.line(), r.without.watch.road.line())
		if r.half != nil {
			value += fmt.Sprintf("; at prey share %d%%: %s, road wars %s", preyShareSlipped, city(*r.half), r.half.watch.road.line())
		}
		slip = Measured{Target: "road-war-city-slip", Value: value, Holds: !r.slipped()}
	}
	p("")
	readings = append(readings, slip)

	p("## Readings")
	p("")
	p("| Target | Reading | Holds |")
	p("| --- | --- | --- |")
	for _, m := range readings {
		mark := holds(m.Holds)
		if strings.HasPrefix(m.Value, unmeasured) {
			mark = "–"
		}
		p("| %s | %s | %s |", m.Target, m.Value, mark)
	}
	p("")
	for _, r := range runs {
		p("## %s players, day by day", comma(int64(r.size)))
		p("")
		p("| Day | Active | Supply (coin) | Coin per active character (7-day mean) | Faucet (coin per active character) | Coin traded that day |")
		p("| --- | --- | --- | --- | --- | --- |")
		for _, d := range r.days {
			p("| %d | %d | %d | %d | %d | %d |", d.day, d.active, d.supply, d.perActive, d.rate, d.traded)
		}
		p("")
	}
	return readings
}

// structural: how many of a kind of problem the report lists.
const auditShown = 10

func firstOf(xs []string, n int) []string { return xs[:min(len(xs), n)] }

// witnessOf is the witness formula (GDD 6.5) worked from the sheets alone,
// so the run can check the game's odds and rolls against it.
func witnessOf(b *sheets.Book, k sheets.TheftKind, settlement bool, uprights, sleight, cover int64, quiet bool) int64 {
	if k.Always {
		return k.Witness
	}
	cell := func(id string) int64 { return sheets.IntParam(b.TheftParams, id) }
	w := k.WitnessOut
	if settlement {
		w = k.Witness
	}
	w += uprights*cell("witness-upright") - sleight*cell("witness-sleight")
	if per := cell("witness-cover"); per > 0 {
		w -= cover / per
	}
	if quiet {
		w -= cell("witness-quiet")
	}
	return min(max(w, cell("witness-least")), cell("witness-most"))
}

// seenRoll is whether a won theft is seen, rolled as the game rolls it:
// keyed by the character and the theft's encounter under the world's roll
// key.
func seenRoll(d *draw.Drawer, witness int64, who, encounter string) bool {
	return d.Percent(witness, "theft.witness", draw.Str(who), draw.Str(encounter))
}

// theftWorld is characters standing at the first starting settlement; fund
// books coin to every NPC about, so each can be lifted from at once.
type theftWorld struct {
	g    *game.Game
	k    keys.Set
	home hex.Hex
	s    *social
	cs   []*game.Char
}

// structural: what a theft world books to each NPC's purse for each
// character, the most a lift at Sleight 20 takes.
const liftStock = 100

func newTheftWorld(b *sheets.Book, label string, n int) (*theftWorld, error) {
	k := keys.Throwaway(label)
	r, err := game.NewRules(b, k)
	if err != nil {
		return nil, err
	}
	g, err := game.New(r)
	if err != nil {
		return nil, err
	}
	w := &theftWorld{g: g, k: k, home: r.Gen.Settlement(0).Hex, s: &social{g: g}}
	for range n {
		res, err := w.s.do(game.Command{Kind: game.Create, Option: "knife"})
		if err != nil {
			return nil, err
		}
		if err := g.Teleport(res.Char, w.home); err != nil {
			return nil, err
		}
		w.cs = append(w.cs, res.Char)
	}
	return w, nil
}

// fund books coin to the purse of every NPC about now, enough for every
// character to lift from any of them.
func (w *theftWorld) fund() error {
	if len(w.cs) == 0 {
		return nil
	}
	t := w.g.Tick()
	for _, p := range w.g.PeopleHere(w.cs[0], w.home) {
		key := fmt.Sprintf("theft-world/%d/%s", t, p.ID)
		if err := w.g.Ledger.Post(ledger.Move(key, "theft-world", t, ledger.FromOperator, ledger.NPCPool(p.ID), ledger.Coin, liftStock*int64(len(w.cs)))); err != nil {
			return err
		}
	}
	return nil
}

// lifted is one lift as it went: the theft fixed when it began, its
// encounter, the people about then, and how it ended.
type lifted struct {
	th        game.Theft
	encounter string
	people    []game.Person
	outcome   string
	witnessed bool
}

// lift has a character lift from the i-th NPC it could, pressing the beat
// to win it, and reads the theft.made it ends with.
func (w *theftWorld) lift(c *game.Char, i int) (lifted, error) {
	var targets []game.StealTarget
	for _, st := range w.g.StealTargets(c) {
		if st.Kind == api.TheftLift {
			targets = append(targets, st)
		}
	}
	if len(targets) == 0 {
		return lifted{}, fmt.Errorf("theft world: %s has nothing to lift", c.C.ID)
	}
	people := w.g.PeopleHere(c, c.C.At)
	if err := w.s.act(game.Command{Char: c.C.ID, Kind: game.Steal, Option: api.TheftLift, NPC: targets[i%len(targets)].NPC}); err != nil {
		return lifted{}, err
	}
	if c.Fight == nil || c.Fight.Theft == nil {
		return lifted{}, fmt.Errorf("theft world: %s began no theft", c.C.ID)
	}
	out := lifted{th: *c.Fight.Theft, encounter: c.Fight.E.ID, people: people}
	for c.Fight != nil {
		res, err := w.s.do(game.Command{Char: c.C.ID, Kind: game.Press, Option: winning(w.g.Choose(c).Fight, c.Fight.Theft.Failed)})
		if err != nil {
			return lifted{}, err
		}
		for _, f := range res.Facts {
			if f.Kind != factTheft {
				continue
			}
			o, _ := f.Get("outcome")
			seen, _ := f.Get("witnessed")
			out.outcome, out.witnessed = o.S, seen.N > 0
		}
	}
	return out, nil
}

// winning is the option likeliest to win a beat that is no machine, else
// the cautious one; once caught, the way out of the getaway.
func winning(f *game.FightView, caught bool) string {
	if caught {
		for _, o := range f.Options {
			if o.Kind == fight.WayOut {
				return o.ID
			}
		}
	}
	pick, best := "", fixed.F(-1)
	for _, o := range f.Options {
		if o.Kind == fight.Win && !o.Puzzle && o.Chance > best {
			pick, best = o.ID, o.Chance
		}
	}
	if pick != "" {
		return pick
	}
	for _, o := range f.Options {
		if o.Kind == fight.Careful {
			return o.ID
		}
	}
	return f.Options[0].ID
}

// walkDay plays one world day in which every character, whenever it is
// free, walks out of the settlement and then back and forth between two
// tiles beyond it, so every one enters a tile the watch looks at as often
// whether it is wanted or not; it returns what the day's Advance took, the
// walking commands not counted.
func (w *theftWorld) walkDay() (time.Duration, error) {
	a, ok := w.openNext(w.home, w.home)
	if !ok {
		return 0, fmt.Errorf("theft world: no way out of %v", w.home)
	}
	b2, ok := w.openNext(a, w.home)
	if !ok {
		return 0, fmt.Errorf("theft world: no way on from %v", a)
	}
	runtime.GC()
	var took time.Duration
	for range sheets.TicksPerDay {
		for _, c := range w.cs {
			if c.Long != nil || c.Fight != nil {
				continue
			}
			to := a
			if c.C.At == a {
				to = b2
			}
			if c.C.At != w.home && c.C.At != a && c.C.At != b2 {
				continue
			}
			// A character down, or held by the watch, stays where it is.
			if err := w.s.act(game.Command{Char: c.C.ID, Kind: game.Step, Dir: c.C.At.DirectionTo(to)}); err != nil && !refused(err) {
				return 0, err
			}
		}
		start := time.Now()
		if _, err := w.g.Advance(); err != nil {
			return 0, err
		}
		took += time.Since(start)
	}
	return took, nil
}

// openNext is a neighbour of h a character can walk to that is no
// settlement and not avoid.
func (w *theftWorld) openNext(h, avoid hex.Hex) (hex.Hex, bool) {
	for d := range hex.Directions {
		n := h.Neighbour(d)
		if _, settled := w.g.SettlementAt(n); settled || n == avoid {
			continue
		}
		if _, _, open := w.g.World.Path(h, n); open {
			return n, true
		}
	}
	return hex.Hex{}, false
}

// refused reports whether an error is the rules turning a command down,
// which changes nothing.
func refused(err error) bool {
	var r *game.Refused
	return errors.As(err, &r)
}
