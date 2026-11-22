package fight

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
)

// What a dungeon's floors add to a fight (GDD 4.9): difficulty half a
// tier at a time and past the ceiling, a bigger haul down there, and the
// guardian's pool on the bottom floor's last beat.

// Why lines Difficulty adds to an option's parts.
const (
	WhyParty  = "party"
	WhyHalf   = "half-step"
	WhyBeyond = "past-the-ceiling"
)

// BeatGuardian is the beat a guardian is fought on.
const BeatGuardian = "guardian"

// Pool is a health pool an encounter presses but does not own: a
// dungeon's guardian, worn down by every party in turn. Bonus is percent
// more health every press removes from it.
type Pool struct{ Health, Max, Bonus int64 }

// deeper adds a floor's half tier and the tiers past the ceiling to a
// difficulty, with their why lines. The midpoint is rounded down; past
// the ceiling a tier is beyond-ceiling-difficulty more.
func (r *Rules) deeper(s Situation, base *int64) []Part {
	var parts []Part
	step := r.Param("beyond-ceiling-difficulty")
	if s.Half {
		here := r.tiers[s.Creature.Tier].BaseDifficulty
		next := here + step
		if t := r.tiers[s.Creature.Tier+1]; t != nil && s.Beyond == 0 {
			next = t.BaseDifficulty
		}
		half := (next - here) / halved
		*base += half
		parts = append(parts, Part{Label: WhyHalf, Value: half})
	}
	if s.Beyond > 0 {
		add := s.Beyond * step
		*base += add
		parts = append(parts, Part{Label: WhyBeyond, Value: add})
	}
	return parts
}

// entranceOf reads the entrance from a floor's machine place,
// "floor:<q,r>/<n>"; "" for any other place.
func entranceOf(place string) string {
	rest, ok := strings.CutPrefix(place, "floor:")
	if !ok {
		return ""
	}
	ref, _, _ := strings.Cut(rest, "/")
	return ref
}

// deepHaul is what a floor's place among the tiers does to its haul as
// the encounter closes: half way to the next tier, each line may take
// that tier's material instead; past the ceiling every line is larger.
func (r *Rules) deepHaul(e *Encounter) {
	if e.Floor == 0 || len(e.Haul) == 0 {
		return
	}
	if e.Half {
		lo, hi := r.tiers[e.Creature.Tier], r.tiers[e.Creature.Tier+1]
		if hi != nil && len(hi.Haul) > 0 {
			var out []item.Spoil
			for i, s := range e.Haul {
				m := s.Material
				if r.gen.Percent(r.Param("half-step-material"), "dungeon.haul-tier", draw.Str(e.Dungeon), draw.Int(e.Floor), draw.Str(e.ID), draw.Int(int64(i))) {
					m = hi.Haul[max(0, slices.Index(lo.Haul, m))%len(hi.Haul)]
				}
				out = item.AddSpoil(out, m, s.Qty)
			}
			e.Haul = out
		}
	}
	if e.Beyond > 0 {
		e.Haul = GrowHaul(e.Haul, e.Beyond*r.Param("beyond-ceiling-haul"))
	}
}

// GrowHaul is a haul with every line pct percent larger, rounded down.
func GrowHaul(haul []item.Spoil, pct int64) []item.Spoil {
	out := slices.Clone(haul)
	for i := range out {
		out[i].Qty = fixed.PercentFloor(out[i].Qty, fixed.Hundredths+pct)
	}
	return out
}

// guardLast puts the guardian on the last beat. A lone beat keeps its
// place and the guardian follows it; a mix the guardian displaced is
// restored on the first beat.
func (r *Rules) guardLast(e *Encounter, mix func()) {
	if len(e.Beats) <= 1 {
		e.Beats = append(e.Beats, BeatGuardian)
		return
	}
	e.Beats[len(e.Beats)-1] = BeatGuardian
	mix()
}

// EndsOnGuardian reports whether a floor's last beat is the guardian's.
func (e *Encounter) EndsOnGuardian() bool {
	return e.Floor > 0 && len(e.Beats) > 0 && e.Beats[len(e.Beats)-1] == BeatGuardian
}

// AtGuardian reports whether the encounter is on that last beat.
func (e *Encounter) AtGuardian() bool { return e.EndsOnGuardian() && e.Final() }

// onPool reports whether the encounter is on the guardian's beat with the
// dungeon's pool attached.
func (e *Encounter) onPool() bool {
	return e.Pool != nil && !e.Over && e.AtGuardian()
}

// wound takes health off the beat's guardian, and off the pool when the
// beat presses it.
func (e *Encounter) wound(n int64) {
	took := min(e.Guardian, n)
	e.Guardian -= took
	if e.onPool() {
		e.Pool.Health = max(0, e.Pool.Health-took)
	}
}

// removes is the health a winning score takes: more from a pool while a
// bonus holds.
func (r *Rules) removes(e *Encounter, score int64) int64 {
	if !e.onPool() {
		return score
	}
	return fixed.PercentPlus(score, e.Bonus+e.Pool.Bonus)
}

// Boost makes the next beats of the encounter remove bonus percent more
// health from a pool; beats 0 holds it for the rest of the encounter.
func (e *Encounter) Boost(bonus, beats int64) {
	e.Bonus, e.BonusLeft = bonus, beats
}

func (e *Encounter) spendBonus() {
	if e.BonusLeft > 0 {
		if e.BonusLeft--; e.BonusLeft == 0 {
			e.Bonus = 0
		}
	}
}

// GuardianPool is a guardian row's full pool at a tier: its health ratio
// of the tier's hunt health.
func (r *Rules) GuardianPool(row string, tier int64) (Pool, bool) {
	h, ok := r.hunts[row]
	t := r.tiers[tier]
	if !ok || t == nil {
		return Pool{}, false
	}
	n := h.HealthRatio.Of(t.HuntHealth)
	return Pool{Health: n, Max: n}, true
}

// Marks counts a hunts row's marks the pool has fallen to or below: the
// game puts a machine on the beat each time the count grows.
func (r *Rules) Marks(row string, p Pool) int64 {
	h, ok := r.hunts[row]
	if !ok || p.Max <= 0 {
		return 0
	}
	var n int64
	for _, m := range h.Marks {
		if p.Health*fixed.Hundredths <= m*p.Max {
			n++
		}
	}
	return n
}

// Hunt is a fights.hunts row.
func (r *Rules) Hunt(row string) (*sheets.Hunt, bool) {
	h, ok := r.hunts[row]
	return h, ok
}

// lasts is how many beats a state put on here lasts: its row's, as the
// place's rules lengthen it (a haunted floor holds shaken longer).
func (r *Rules) lasts(e *Encounter, t tags.Tag, beats int64) int64 {
	if beats <= 0 || e == nil {
		return beats
	}
	place := slices.Clone(e.Site)
	for _, st := range e.States {
		if st.On == OnPlace {
			place = append(place, st.Tag)
		}
	}
	return tags.Adjust(r.rules, set("state", []tags.Tag{t}), tags.Context{Place: set("place", place), Measures: e.Measures}, "state-beats", beats)
}

func (c Creature) clone() Creature {
	c.Tags, c.Drops = slices.Clone(c.Tags), slices.Clone(c.Drops)
	return c
}
