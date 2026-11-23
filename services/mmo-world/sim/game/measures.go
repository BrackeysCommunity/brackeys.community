package game

import (
	"cmp"
	"maps"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fixed"
)

// Dashboard is the operator's view of emergence (GDD 13.5): the four
// measures against their healthy lines, the stored traces and the newest
// promotions. The service turns it into api.Emergence.
type Dashboard struct {
	Day    int64
	Season int64
	Active int64
	// KindsPerMille is new kinds per active character a week, oldest
	// first, the week in progress last.
	KindsPerMille     []int64
	KindsHealthy      bool
	Promotions        []TypeCount // this season, GDD 13.5's eight types in order
	Need              int64
	PromotionsHealthy bool
	Heavy             int64
	HeavyPlayer       int64
	HeavyHealthy      bool
	Pairing           []RegionShare
	PairingHealthy    bool
	Traces            []TypeCount // stored entries per trace
	Recent            []emerge.Promotion
}

// TypeCount is a count by promotion type or trace.
type TypeCount struct {
	Type  string
	Count int64
}

// RegionShare is a region's most relied-on style and its share of the
// region's wins, by the decaying reliance trace.
type RegionShare struct {
	Region  int
	Style   string
	Name    string // the style's promoted name, if it has one
	Percent int64
}

// structural: GDD 13.5's healthy lines, which judge a world rather than
// tune one, and how the dashboard counts.
const (
	pairingHealthy = 35 // percent: the most common pairing's share stays under it in every region
	perMille       = 1000
	recentKept     = 20
)

// Measures is the dashboard, read under the service's lock; false while
// emergence is off. Its cost is the traces stored and the characters, never
// the fact log.
func (g *Game) Measures() (Dashboard, bool) {
	e := g.Emergence
	if e == nil {
		return Dashboard{}, false
	}
	day, season := g.traceAt(g.Tick())
	d := Dashboard{Day: day, Season: season, Active: g.Active(), Heavy: e.Now.Heavy, HeavyPlayer: e.Now.HeavyPlayer}

	d.KindsHealthy = true
	for i, w := range e.Weeks {
		active := w.Active
		current := i == len(e.Weeks)-1
		if current {
			active = d.Active
		}
		per := int64(0)
		if active > 0 {
			per = w.Kinds * perMille / active
		}
		d.KindsPerMille = append(d.KindsPerMille, per)
		if !current && per == 0 {
			d.KindsHealthy = false
		}
	}

	d.Need = max(1, (d.Active+g.r.Emerge.P.PerActive-1)/max(g.r.Emerge.P.PerActive, 1))
	d.PromotionsHealthy = true
	for _, t := range emerge.Types {
		n := e.Now.Promotions[t]
		d.Promotions = append(d.Promotions, TypeCount{Type: string(t), Count: n})
		if n < d.Need {
			d.PromotionsHealthy = false
		}
	}
	d.HeavyHealthy = d.HeavyPlayer > d.Heavy-d.HeavyPlayer

	d.Pairing, d.PairingHealthy = g.pairingShares(day, season)

	d.Traces = []TypeCount{
		{Type: emerge.Passage, Count: int64(len(e.Passage))},
		{Type: emerge.Clearing, Count: int64(len(e.Clearing))},
		{Type: emerge.Loss, Count: int64(len(e.Loss))},
		{Type: emerge.Haulage, Count: int64(len(e.Pairs))},
		{Type: emerge.Reliance, Count: int64(len(e.Styles))},
		{Type: emerge.Renown, Count: int64(len(e.Renown))},
		{Type: emerge.Mastery, Count: int64(len(e.Masters))},
	}
	for i := len(e.Promotions) - 1; i >= 0 && len(d.Recent) < recentKept; i-- {
		d.Recent = append(d.Recent, e.Promotions[i])
	}
	return d, true
}

// pairingShares is each region's largest style over all its reliance, and
// whether every region is under the healthy line.
func (g *Game) pairingShares(day, season int64) ([]RegionShare, bool) {
	e := g.Emergence
	decay := g.r.Emerge.Decay[emerge.Reliance]
	type top struct {
		style string
		v     fixed.F
	}
	best := map[int]top{}
	for _, k := range slices.SortedFunc(maps.Keys(e.Styles), func(a, b emerge.StyleKey) int {
		return cmp.Or(cmp.Compare(a.Region, b.Region), strings.Compare(a.Style, b.Style))
	}) {
		v := e.Styles[k].Count.At(day, season, decay)
		if b, ok := best[k.Region]; v > 0 && (!ok || v > b.v) {
			best[k.Region] = top{style: k.Style, v: v}
		}
	}
	healthy := true
	var out []RegionShare
	for _, r := range slices.Sorted(maps.Keys(best)) {
		tally := e.Regions[r]
		if tally == nil {
			continue
		}
		total := tally.Reliance.At(day, season, decay)
		if total <= 0 {
			continue
		}
		b := best[r]
		share := RegionShare{Region: r, Style: b.style, Percent: b.v.MulInt(fixed.Hundredths).Div(total).Floor()}
		if st := e.Styles[emerge.StyleKey{Region: r, Style: b.style}]; st != nil && st.Done != "" {
			share.Name = e.Shown(st.Done)
		}
		if share.Percent >= pairingHealthy {
			healthy = false
		}
		out = append(out, share)
	}
	return out, healthy
}
