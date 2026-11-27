package harness

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/sim/sheets"
)

// soakAll is the soak run's options: every system on (GDD 20.3), the
// thieves, the staging adversary at the main server, emergence, the
// season clock and an empty server. The loop climb's adversary is left
// to Search.
var soakAll = soakOptions{Thieves: true, Staging: true, Emergence: true, Season: true, EmptyServer: true}

// SoakRun is the headless soak: the Economy plan (its sizes, or n alone,
// for its days, keyed by ECONOMY_SEED) with every system on, read against
// the Economy and Crime targets, with each world day's conservation
// check and wall time.
func SoakRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	sizes, days := economyPlan(n)
	return soakRun(b, out, sizes, days)
}

func soakRun(b *sheets.Book, out string, sizes []int, days int64) ([]Measured, error) {
	var rs []*soakResult
	for _, size := range sizes {
		r, err := soakWith(b, size, days, soakAll)
		if err != nil {
			return nil, err
		}
		fmt.Fprintf(os.Stderr, "soak %d: %s, %d actions, %d refused, %d days with discrepancies, digest %s\n",
			size, r.elapsed.Round(time.Second), r.actions, r.refused, r.read.dirty, r.digest)
		rs = append(rs, r)
	}
	readings := soakReadings(b, rs)
	if err := soakDoc(b, rs, days, readings).save(out, "soak.md"); err != nil {
		return nil, err
	}
	return readings, nil
}

// soakDoc is the soak run's report: a line per soak, what each system
// did, and every world day's coin, conservation check and wall time.
func soakDoc(b *sheets.Book, rs []*soakResult, days int64, readings []Measured) *lineDoc {
	var doc lineDoc
	p := doc.p
	p("# Soak run")
	p("")
	p("The Economy run's players (`harness economy`: the same roles, key and dice, `ECONOMY_SEED` %q) for %d world days with every system on: %s. One main player in %d steals; the staging adversary stages at the main server; an empty server saves its settings on day %d and plays no more. Each world day the ledger is checked against every holding, and the wall time of the day is kept.",
		os.Getenv("ECONOMY_SEED"), days, soakAll, stealEvery, emptyArrives)
	p("")
	p("| Players | Coin per active character, days %d–%d | Rule | Holds | Thefts | Days with discrepancies | Day cost (median, max) | Time | Digest |", economyWarmup, days)
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, r := range rs {
		v := r.band(b)
		thefts := HoldsNone
		if r.crime != nil {
			thefts = comma(int64(r.crime.thefts))
		}
		med, most := soakDayCost(r.read.cost)
		p("| %s | %d to %d coin | %s | %s | %s | %d of %d | %s, %s | %s | `%s` |", comma(int64(r.size)), v.mn, v.mx, v.rule, holds(v.ok && r.clean()), thefts,
			r.read.dirty, len(r.days), millis(med), millis(most), r.elapsed.Round(time.Second), shortID(r.digest))
	}
	p("")
	p("| Target | Reading | Holds |")
	p("| --- | --- | --- |")
	for _, m := range readings {
		p("| %s | %s | %s |", m.Target, esc(m.Value), holds(m.Holds))
	}
	p("")
	for _, r := range rs {
		p("## %s players", comma(int64(r.size)))
		p("")
		soakSystems(p, r)
		p("")
		dirty := map[int64]int{}
		for _, a := range r.read.audits {
			var d int64
			if _, err := fmt.Sscanf(a, "day %d:", &d); err == nil {
				dirty[d]++
			}
		}
		p("| Day | Active | Coin per active character (7-day mean) | Faucet | Conservation | Day cost |")
		p("| --- | --- | --- | --- | --- | --- |")
		for i, d := range r.days {
			check := "clean"
			if dirty[d.day] > 0 {
				check = fmt.Sprintf("**%d found**", dirty[d.day])
			}
			cost := HoldsNone
			if i < len(r.read.cost) {
				cost = millis(r.read.cost[i])
			}
			p("| %d | %d | %d | %d | %s | %s |", d.day, d.active, d.perActive, d.rate, check, cost)
		}
		p("")
		if r.read.dirty > len(dirty) {
			p("%d world days found discrepancies; the table marks the days of the first %d named below.", r.read.dirty, len(r.read.audits))
			p("")
		}
		for _, a := range slices.Concat(r.read.audits, r.audit) {
			p("- %s", a)
		}
		if len(r.read.audits)+len(r.audit) > 0 {
			p("")
		}
	}
	return &doc
}

// soakSystems is a line per system a soak turned on: what it did.
func soakSystems(p func(string, ...any), r *soakResult) {
	if c := r.crime; c != nil {
		p("- Thieves: %d thefts (%d source legs), %d coin and %d goods taken, %d coin fenced; %s.", c.thefts, c.legs, c.stolen, c.goods, c.fenced,
			either(c.mints(), "nothing minted", "**something minted**"))
	}
	if s := r.staging; s != nil {
		p("- Staging at `%s`: %d staged lines, %d staged units minted, %d bought; the gate %s.", s.server, len(s.lines), s.minted, s.traded, gateValue(s.leaks == 0, s.leaks))
	}
	if ms := r.read.seasons; len(ms) > 0 {
		last := ms[len(ms)-1]
		p("- Season clock: season %d, day %d of %d at the last world day read (%d read).", last.season, last.of, last.days, len(ms))
	}
	if es := r.read.emerge; len(es) > 0 {
		last := es[len(es)-1]
		p("- Emergence: %d tiles with traces, %d styles, %d promotions at the last world day.", last.spots, last.styles, last.promotions)
	}
	if r.opts.EmptyServer {
		p("- The empty server `%s`: settings %s, %d members, founded %s.", emptyName, either(r.read.house, "saved", "**not saved**"), r.read.empty.members,
			either(r.read.empty.founded > 0, fmt.Sprintf("day %d", r.read.empty.founded), "never"))
	}
	p("- Spoils pools: %d finds, %s.", r.read.spoils.finds, either(r.read.spoils.holds(), "conserved", "**not conserved**"))
	var works []string
	for _, w := range r.guild.works {
		works = append(works, fmt.Sprintf("%s gave %d of %d used", w.id, w.gave, w.used))
	}
	if len(works) > 0 {
		p("- Guild works: %s.", strings.Join(works, "; "))
	}
}

// soakDayCost is the median and longest world day's wall time.
func soakDayCost(cost []time.Duration) (med, most time.Duration) {
	if len(cost) == 0 {
		return 0, 0
	}
	s := slices.Sorted(slices.Values(cost))
	return q(s, 0.5), s[len(s)-1]
}
