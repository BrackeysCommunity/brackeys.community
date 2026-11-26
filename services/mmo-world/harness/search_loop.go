package harness

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"time"

	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

// The Search run's loop climb (GDD 18.4): an adversary that looks for
// the richest way to spend a world day. A policy is a weight mix over the
// agent activities; a tenth of the Economy population's main players
// play it, and it is scored by the coin and goods value they gain a
// character-day. Every step is drawn under search.loop.

// loopLabel is the loop climb's draw purpose.
const loopLabel = "search.loop"

// structural: the climb's world days (the Economy band's 42 simulated
// days), the most weight one step moves between two activities, and the
// most steps one mutation takes.
const (
	loopClimbDays = 42
	loopStep      = 25
	loopReach     = 4
)

// loopPolicy is a named activity mix.
type loopPolicy struct {
	name string
	mix  agentMix
}

// loopSeeds are the first generation: each activity on its own but guild
// works (which is the Economy run's own play), and everything at once.
func loopSeeds() []loopPolicy {
	var out []loopPolicy
	for i, a := range agent.Activities {
		if a == agent.GuildWorks {
			continue
		}
		var m agentMix
		m[i] = 100
		out = append(out, loopPolicy{name: a, mix: m})
	}
	var all agentMix
	for i := range all {
		all[i] = 20
	}
	return append(out, loopPolicy{name: "everything", mix: all})
}

// strongestLoop is the fixed widest mix: every activity at once.
func strongestLoop() loopPolicy {
	s := loopSeeds()
	return s[len(s)-1]
}

// mutateLoop is a mix a step or a few from p, drawn under search.loop
// for its generation and place in it: each step moves up to loopStep
// weight from an activity that has some to another, and a draw that only
// finds mixes already played takes more steps, up to loopReach.
func mutateLoop(p loopPolicy, d *draw.Drawer, gen, i int, played map[string]bool) loopPolicy {
	n := len(agent.Activities)
	for try := range mutateTries {
		q := p
		var what []string
		for step := range 1 + try*loopReach/mutateTries {
			pick := func(m int, part string) int {
				return int(d.Below(uint64(m), loopLabel, draw.Int(int64(gen)), draw.Int(int64(i)), draw.Int(int64(try)), draw.Int(int64(step)), draw.Str(part)))
			}
			var weighed []int
			for a, w := range q.mix {
				if w > 0 {
					weighed = append(weighed, a)
				}
			}
			from := weighed[pick(len(weighed), "from")]
			to := pick(n-1, "to")
			if to >= from {
				to++
			}
			moved := min(q.mix[from], loopStep)
			q.mix[from] -= moved
			q.mix[to] += moved
			what = append(what, fmt.Sprintf("%d %s→%s", moved, agent.Activities[from], agent.Activities[to]))
		}
		if played[q.mix.String()] {
			continue
		}
		q.name = p.name + ", " + strings.Join(what, ", ")
		played[q.mix.String()] = true
		return q
	}
	return p
}

// loopPlay is one mix soaked, and how its players and the other main
// players did.
type loopPlay struct {
	gen    int
	policy loopPolicy
	res    *soakResult
}

func (l loopPlay) score() int64 { return l.res.read.loop.perDay() }

func logLoop(l loopPlay) {
	r := l.res
	fmt.Fprintf(os.Stderr, "search loop %s %d: %s, %d actions, %d refused, %d a character-day against %d, digest %s\n", l.policy.name, r.size, r.elapsed.Round(time.Second),
		r.actions, r.refused, l.score(), r.read.others.perDay(), r.digest)
}

// loopResult is the loop climb: every mix played at the climb's size, and
// the best confirmed at the size.
type loopResult struct {
	size, days int
	climb      []loopPlay
	confirmed  loopPlay
	digest     string
}

// loopClimb is the loop climb at a size and its section of search.md.
func loopClimb(b *sheets.Book, n int, doc *lineDoc) ([]Measured, error) {
	r, err := climbLoop(b, n)
	if err != nil {
		return nil, err
	}
	return []Measured{r.section(b, doc.p)}, nil
}

// climbLoop climbs at a tenth of the size for loopClimbDays and confirms
// the richest mix at the size for the Economy run's days; below
// searchClimbFrom players it plays the widest seed once for
// stagingSmallDays.
func climbLoop(b *sheets.Book, n int) (*loopResult, error) {
	_, days := economyPlan(n)
	r := &loopResult{size: max(1, n/searchShare), days: loopClimbDays}
	best := strongestLoop()
	if n < searchClimbFrom {
		days = stagingSmallDays
		r.size, r.days = 0, 0
	} else {
		d := draw.NewDrawer(keys.Throwaway("search").Roll)
		played := map[string]bool{}
		gen := loopSeeds()
		for _, s := range gen {
			played[s.mix.String()] = true
		}
		for g := range searchGenerations {
			if g > 0 {
				top := r.richest()
				gen = make([]loopPolicy, searchPolicies)
				for i := range gen {
					gen[i] = mutateLoop(top.policy, d, g, i, played)
				}
			}
			plays := make([]loopPlay, len(gen))
			if err := runParallel(len(gen), func(i int) error {
				s, err := soakWith(b, r.size, int64(r.days), soakOptions{Adversary: gen[i].mix})
				if err != nil {
					return fmt.Errorf("search loop: %s at %d: %w", gen[i].name, r.size, err)
				}
				plays[i] = loopPlay{gen: g, policy: gen[i], res: s}
				logLoop(plays[i])
				return nil
			}); err != nil {
				return nil, err
			}
			r.climb = append(r.climb, plays...)
		}
		best = r.richest().policy
	}
	s, err := soakWith(b, n, days, soakOptions{Adversary: best.mix})
	if err != nil {
		return nil, fmt.Errorf("search loop: %s at %d: %w", best.name, n, err)
	}
	r.confirmed = loopPlay{gen: -1, policy: best, res: s}
	logLoop(r.confirmed)
	h := sha256.New()
	for _, l := range append(r.climb, r.confirmed) {
		fmt.Fprintf(h, "%s %d %d %s\n", l.policy.mix, l.res.size, l.score(), l.res.digest)
	}
	r.digest = hex.EncodeToString(h.Sum(nil))
	fmt.Fprintf(os.Stderr, "search loop: %d mixes, digest %s\n", len(r.climb)+1, r.digest)
	return r, nil
}

// richest is the climb's best mix so far: the most gained a
// character-day, the earlier on a tie.
func (r *loopResult) richest() loopPlay {
	top := r.climb[0]
	for _, l := range r.climb {
		if l.score() > top.score() {
			top = l
		}
	}
	return top
}

// section writes the loop climb and returns richest-loop-band.
func (r *loopResult) section(b *sheets.Book, p func(string, ...any)) Measured {
	c := r.confirmed
	res := c.res
	p("# Search run: loop")
	p("")
	p("An adversary that looks for the richest loop (GDD 18.4): a mix of weights over the agent activities (%s), played by a tenth of the Economy population's main players (`agent.Mixed`, which draws its activity each world day), the rest playing as the Economy run does. A mix is scored by the coin, provisions, clean goods and items at reference value its players gain a character-day.", activityList())
	p("")
	if len(r.climb) > 0 {
		p("## The climb")
		p("")
		p("%d mixes a generation for %d generations at %d players over %d world days; the first is each activity alone (guild works is the Economy run's own play) and everything at once, and each later one is %d mixes a step from the richest so far (up to %d weight moved from one activity to another, drawn under `%s`; up to %d steps when a single one finds only mixes already played), none a mix already played.", searchPolicies, searchGenerations, r.size, r.days, searchPolicies, loopStep, loopLabel, loopReach)
		p("")
		p("| Generation | Mix | Weights | Gained a character-day | The other main players | Conservation |")
		p("| --- | --- | --- | --- | --- | --- |")
		for _, l := range r.climb {
			p("| %d | `%s` | %s | %d | %d | %s |", l.gen, l.policy.name, l.policy.mix, l.score(), l.res.read.others.perDay(), either(l.res.clean(), "clean", "**not clean**"))
		}
		p("")
		p("The richest: `%s`. It is confirmed at %s players.", c.policy.name, comma(int64(res.size)))
	} else {
		p("Below %d players the run plays the widest seed, `%s`, once at %d players for %d world days.", searchClimbFrom, c.policy.name, res.size, len(res.days))
	}
	p("")
	v := res.band(b)
	p("## The confirming soak at %s players", comma(int64(res.size)))
	p("")
	p("| Mix | Its players | Gained a character-day | The other main players | Turns by activity | Coin per active character | Rule | Daily conservation | Time |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	loop := res.read.loop
	p("| %s | %d | %d | %d | %s | %d to %d | %s | %s | %s |", c.policy.mix, loop.players, c.score(), res.read.others.perDay(), loop.played, v.readLo, v.readHi, v.rule,
		either(res.clean(), "clean", fmt.Sprintf("**%d days not clean**", res.read.dirty)), res.elapsed.Round(time.Second))
	p("")
	for _, a := range res.read.audits {
		p("- %s", a)
	}
	for _, a := range res.audit {
		p("- %s", a)
	}
	p("| Day | Active | Supply (coin) | Coin per active character (7-day mean) | Faucet (coin per active character) | Coin traded that day |")
	p("| --- | --- | --- | --- | --- | --- |")
	for _, d := range res.days {
		p("| %d | %d | %d | %d | %d | %d |", d.day, d.active, d.supply, d.perActive, d.rate, d.traded)
	}
	p("")
	p("Digest `%s`.", r.digest)
	p("")
	value := fmt.Sprintf("`%s` (%s) by a tenth of mains at %s players for %d days: %d a character-day against %d for the other main players; coin per active character %d to %d (%s); daily conservation %s",
		c.policy.name, c.policy.mix, comma(int64(res.size)), len(res.days), c.score(), res.read.others.perDay(), v.readLo, v.readHi, v.rule, either(res.clean(), "clean", "not clean"))
	if v.drifts {
		return Measured{Target: "richest-loop-band", Value: fmt.Sprintf("%sread from %s players up; %s", unmeasured, comma(bandFrom), value)}
	}
	return Measured{Target: "richest-loop-band", Value: value, Holds: v.ok && res.clean()}
}

func activityList() string {
	var s []string
	for _, a := range agent.Activities {
		s = append(s, "`"+a+"`")
	}
	return strings.Join(s, ", ")
}
