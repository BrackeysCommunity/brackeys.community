package render

import (
	"fmt"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/sheets"
)

// PortraitInput is a creature's portrait input: what the fight already
// shows of it, cut to what the kit's layers can draw, and the kit's digest.
type PortraitInput struct {
	Archetype string   `json:"archetype"`
	Tier      int64    `json:"tier"`
	Tags      []string `json:"tags,omitempty"`
	Variant   string   `json:"variant,omitempty"`
	Resists   string   `json:"resists,omitempty"` // the adapted tags, sorted, comma-joined
	Kit       string   `json:"kit"`
}

// structural: portrait size in pixels, the most marks one carries, and
// the tier pips' size and place.
const (
	portraitSize = 256
	marksMost    = 4
	pipW, pipH   = 10.0, 6.0
	pipGap       = 4.0
	pipX, pipY   = 16.0, 236.0
)

// Tags a portrait layer may name beyond the creature's own.
const (
	TagVariant   = "variant"   // a region's named variant
	TagResisting = "resisting" // the region has adapted against something
	resistPrefix = "resist:"   // adapted against this tag
)

// PortraitInput is a creature's input for this kit: only the tags some
// layer reads are kept, so creatures that would draw alike share a key.
func (k *Kit) PortraitInput(archetype string, tier int64, tags []string, variant string, resists []string) PortraitInput {
	in := PortraitInput{Archetype: archetype, Tier: tier, Variant: variant, Kit: k.Digest}
	for _, t := range tags {
		if k.reads[t] && !slices.Contains(in.Tags, t) {
			in.Tags = append(in.Tags, t)
		}
	}
	slices.Sort(in.Tags)
	rs := slices.Clone(resists)
	slices.Sort(rs)
	in.Resists = strings.Join(slices.Compact(rs), ",")
	return in
}

// held is every tag a layer can match: the archetype, the creature's
// tags, the variant and what the region resists.
func (in PortraitInput) held() []string {
	out := append([]string{in.Archetype}, in.Tags...)
	if in.Variant != "" {
		out = append(out, TagVariant, in.Variant)
	}
	if in.Resists != "" {
		out = append(out, TagResisting)
		for _, r := range strings.Split(in.Resists, ",") {
			out = append(out, resistPrefix+r)
		}
	}
	return out
}

// Portrait draws a creature from the kit's layers (GDD 16.2): every aura
// whose tags it all holds, the body and the head that share most tags
// with it (the higher tier first on a tie, then the earlier layer), the
// marks it holds a tag of, and a pip for each tier.
func Portrait(in PortraitInput, kit *Kit, palette []sheets.Palette) (*Canvas, error) {
	if in.Kit != kit.Digest {
		return nil, fmt.Errorf("render: a portrait for kit %s drawn with kit %s", in.Kit, kit.Digest)
	}
	held := in.held()
	c := NewCanvas(portraitSize, portraitSize, tar)
	marks := 0
	for _, part := range portraitParts {
		var best *Layer
		for i := range kit.Portraits {
			l := &kit.Portraits[i]
			if l.Part != part || l.Tier > in.Tier {
				continue
			}
			switch part {
			case PartAura:
				if overlap(l.Tags, held) == len(l.Tags) {
					if err := drawLayer(c, *l, palette); err != nil {
						return nil, err
					}
				}
			case PartMark:
				if marks < marksMost && overlap(l.Tags, held) > 0 {
					marks++
					if err := drawLayer(c, *l, palette); err != nil {
						return nil, err
					}
				}
			default:
				if best == nil || better(*l, *best, held) {
					best = l
				}
			}
		}
		if part == PartBody || part == PartHead {
			if best == nil {
				return nil, fmt.Errorf("render: kit %s has no %s layer for tier %d", kit.Pack, part, in.Tier)
			}
			if err := drawLayer(c, *best, palette); err != nil {
				return nil, err
			}
		}
	}
	for i := range in.Tier {
		x := pipX + float64(i)*(pipW+pipGap)
		c.Fill([][]Pt{{{x, pipY}, {x + pipW/2, pipY - pipH}, {x + pipW, pipY}, {x + pipW, pipY + pipH}, {x + pipW/2, pipY}, {x, pipY + pipH}}}, hazard)
	}
	return c, nil
}

func better(a, b Layer, held []string) bool {
	if x, y := overlap(a.Tags, held), overlap(b.Tags, held); x != y {
		return x > y
	}
	return a.Tier > b.Tier
}
