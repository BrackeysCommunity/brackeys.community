package harness

import (
	"fmt"
	"os"
	"time"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

func init() { Runs["search"] = SearchRun }

// structural: the Search run's shape (GDD 18.4). The climb plays
// searchPolicies policies a generation for searchGenerations generations
// at a tenth of the size, each against one shared unstaged twin; the
// best is confirmed at the size. Below searchClimbFrom players it plays
// the strongest seed policy once, for stagingSmallDays.
const (
	searchSize        = 1000
	searchPolicies    = 6
	searchGenerations = 4
	searchClimbFrom   = 100
	searchShare       = 10 // the climb plays at n/searchShare
	stagingSmallDays  = 30
)

// climbed is one policy of the climb and how it read: staged and taken,
// and its control's footprint.
type climbed struct {
	gen       int
	policy    stagingPolicy
	reading   stagingReading
	footprint stagingReading
	soak      *stagingSoak
	control   *stagingSoak
}

// worse reports whether c is the more damaging policy: the larger
// footprint (the reading staging-stays-local holds), then the larger move
// staged and taken.
func (c climbed) worse(than climbed) bool {
	if c.footprint.worst.most != than.footprint.worst.most {
		return c.footprint.worst.most > than.footprint.worst.most
	}
	return c.reading.worst.most > than.reading.worst.most
}

// SearchRun is the Search run aimed at staging (GDD 18.4): an adversary
// that stages without limit at the main server and does the most damaging
// thing with what it gives, read for how far it moves prices at every
// other settlement (staging-stays-local), whether a staged unit ever
// reaches a place it may not (staged-goods-local), and the staged
// experience a character gains in a world day (staged-xp-cap).
func SearchRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	if n <= 0 {
		n = searchSize
	}
	_, days := economyPlan(n)
	var doc lineDoc
	p := doc.p
	p("# Search run: staging")
	p("")
	p("A staging adversary (GDD 18.4) at the main server of the Economy population: an admin and a staff member stage through the player path, the server's players open its crates, press its hunts, meet its contests and use the staged goods (sell them on the staged book, craft with them, give them to the quiet server's players, or offer them to faction orders and other markets, which refuse them). Each staged soak is read against an unstaged twin on the same seed, whose stagers stage nothing.")
	p("")
	var all []*stagingSoak
	var set twinSet
	var best climbed
	if n < searchClimbFrom {
		days = stagingSmallDays
		pol := strongestSeed()
		ts, err := stagingTwins(b, n, days, pol)
		if err != nil {
			return nil, err
		}
		set, all = ts, ts.soaks()
		best = climbed{policy: pol, soak: ts.staged}
		p("Below %d players the run plays one %d-day twin of the strongest seed policy, `%s`, at %d players.", searchClimbFrom, days, pol.name, n)
		p("")
	} else {
		size := max(1, n/searchShare)
		climb, u, err := searchClimb(b, size, days)
		if err != nil {
			return nil, err
		}
		all = append(all, u)
		best = climb[0]
		for _, c := range climb {
			all = append(all, c.soak, c.control)
			if c.worse(best) {
				best = c
			}
		}
		p("## The climb")
		p("")
		p("%d policies a generation for %d generations at %d players over %d world days, each staged and as its control (staged the same, nothing taken), read against one shared unstaged twin; each generation after the first is %d single steps (drawn under `search.staging`) from the most damaging policy so far (the largest footprint, then the largest move taken), none a policy already played.", searchPolicies, searchGenerations, size, days, searchPolicies)
		p("")
		p("| Generation | Policy | What it does | Footprint | Largest move, taken | Gate | Most staged xp in a day |")
		p("| --- | --- | --- | --- | --- | --- | --- |")
		for _, c := range climb {
			leaks := c.soak.watch.leaks + c.control.watch.leaks
			p("| %d | `%s` | %s | %s | %s | %s | %d |", c.gen, c.policy.name, c.policy, c.footprint.where(), c.reading.where(), either(leaks == 0, "clean", fmt.Sprintf("**%d problems**", leaks)), c.soak.watch.xpMost)
		}
		p("")
		p("The most damaging: `%s`, footprint %s, taken %s. It is confirmed at %d players.", best.policy.name, best.footprint.where(), best.reading.where(), n)
		p("")
		ts, err := stagingTwins(b, n, days, best.policy)
		if err != nil {
			return nil, err
		}
		set = ts
		all = append(all, ts.soaks()...)
	}
	taken, footprint, play := set.readings()
	stagingSection(p, fmt.Sprintf("The confirming twin at %d players", n), set)
	gate, problems := stagingGate(all)
	xp := int64(0)
	for _, s := range all {
		xp = max(xp, s.watch.xpMost)
	}
	if err := doc.save(out, "search.md"); err != nil {
		return nil, err
	}
	xpCap := set.staged.watch.xpCap
	return []Measured{
		{Target: "staging-stays-local", Value: fmt.Sprintf("`%s` at %d players: the stages' footprint %s; taken, %s; a staging-free change of play, %s", best.policy.name, n, footprint.where(), taken.where(), play.where()), Holds: footprint.holds()},
		{Target: "staged-goods-local", Value: fmt.Sprintf("%d soaks: %s", len(all), gateValue(gate, problems)), Holds: gate},
		{Target: "staged-xp-cap", Value: fmt.Sprintf("at most %d staged xp in a world day (cap %d)", xp, xpCap), Holds: xp <= xpCap},
	}, nil
}

// twinSet is a policy's staged soak, its unstaged twin, its control
// (staged the same, with nothing taken: the footprint of the stages
// alone) and a staging-free twin whose main players change their play a
// little with nothing staged.
type twinSet struct {
	staged, unstaged, inert, rest *stagingSoak
}

// readings are a twin set's three readings against its unstaged twin.
func (ts twinSet) readings() (taken, footprint, play stagingReading) {
	u := ts.unstaged.watch
	return compareTwins(ts.staged.watch, u), compareTwins(ts.inert.watch, u), compareTwins(ts.rest.watch, u)
}

func (ts twinSet) soaks() []*stagingSoak {
	return []*stagingSoak{ts.staged, ts.unstaged, ts.inert, ts.rest}
}

// inert is a policy whose players take nothing it stages.
func inert(pol stagingPolicy) stagingPolicy {
	pol.name, pol.uses = pol.name+", nothing taken", [4]int64{}
	return pol
}

// stagingTwins soaks a policy staged, unstaged, as its control and as
// the staging-free twin at a size, side by side.
func stagingTwins(b *sheets.Book, size int, days int64, pol stagingPolicy) (twinSet, error) {
	pols := []stagingPolicy{pol, pol, inert(pol), pol}
	soaks := make([]*stagingSoak, len(pols))
	err := runParallel(len(pols), func(i int) error {
		staged, rest := i == 0 || i == 2, i == 3
		s, err := soakTwin(b, size, days, pols[i], staged, rest)
		if err != nil {
			return fmt.Errorf("staging twin %s at %d, %s: %w", pols[i].name, size, either(staged, "staged", "unstaged"), err)
		}
		soaks[i] = s
		logStaging(s)
		return nil
	})
	return twinSet{soaks[0], soaks[1], soaks[2], soaks[3]}, err
}

func logStaging(s *stagingSoak) {
	fmt.Fprintf(os.Stderr, "search %s %d%s: %s, %d actions, %d refused, %d gate problems, digest %s\n", s.policy.name, s.size, either(s.staged, "", either(s.watch.rest, " staging-free", " unstaged")),
		s.elapsed.Round(time.Second), s.actions, s.refused, s.watch.leaks, s.digest)
}

// searchClimb is the hill climb at a size: the seeds, then generations of
// steps from the most damaging policy so far, each staged and as its
// control, read against one unstaged twin.
func searchClimb(b *sheets.Book, size int, days int64) ([]climbed, *stagingSoak, error) {
	seeds := stagingSeeds()
	unstaged, err := soakStaging(b, size, days, seeds[0], false)
	if err != nil {
		return nil, nil, fmt.Errorf("search: the unstaged twin at %d: %w", size, err)
	}
	logStaging(unstaged)
	d := draw.NewDrawer(keys.Throwaway("search").Roll)
	var out []climbed
	gen := seeds[:min(len(seeds), searchPolicies)]
	played := map[string]bool{}
	for _, s := range gen {
		played[s.String()] = true
	}
	for g := range searchGenerations {
		if g > 0 {
			top := out[0]
			for _, c := range out {
				if c.worse(top) {
					top = c
				}
			}
			gen = make([]stagingPolicy, searchPolicies)
			for i := range gen {
				gen[i] = mutate(top.policy, d, g, i, played)
			}
		}
		soaks := make([]*stagingSoak, 2*len(gen))
		if err := runParallel(len(soaks), func(i int) error {
			pol := gen[i/2]
			if i%2 == 1 {
				pol = inert(pol)
			}
			s, err := soakStaging(b, size, days, pol, true)
			if err != nil {
				return fmt.Errorf("search: %s at %d: %w", pol.name, size, err)
			}
			logStaging(s)
			soaks[i] = s
			return nil
		}); err != nil {
			return nil, nil, err
		}
		played := make([]climbed, len(gen))
		for i := range gen {
			s, c := soaks[2*i], soaks[2*i+1]
			played[i] = climbed{gen: g, policy: gen[i], reading: compareTwins(s.watch, unstaged.watch), footprint: compareTwins(c.watch, unstaged.watch), soak: s, control: c}
		}
		out = append(out, played...)
	}
	return out, unstaged, nil
}
