package fight

import "jams.team/mmo-world/sim/tags"

// WhyAdapted is the why line of a band a region's adaptation took off.
const WhyAdapted = "adapted"

// Resist is a tag the creatures of a region have adapted against: an
// option carrying it falls Bands band steps, as a worse margin would
// (GDD 13.2).
type Resist struct {
	Tag   tags.Tag `json:"tag"`
	Bands int64    `json:"bands"`
}

// resisted is the band steps the situation's adaptations take off an
// option with these tags, each with its why line.
func resisted(s Situation, row string, subject tags.TagSet, why *Why) int64 {
	if row == WayOut {
		return 0
	}
	var steps int64
	for _, rs := range s.Resist {
		if rs.Bands > 0 && subject.Has(rs.Tag) {
			steps += rs.Bands
			why.Parts = append(why.Parts, Part{Label: WhyAdapted, Value: -rs.Bands})
		}
	}
	return steps
}

// WithDrop makes the creature's first drop a material of its own, as a
// variant's is (GDD 4.17).
func (c *Creature) WithDrop(material string) {
	if len(c.Drops) == 0 {
		return
	}
	c.Drops = append([]string{material}, c.Drops[1:]...)
}
