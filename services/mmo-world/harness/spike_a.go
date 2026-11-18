package harness

import (
	"fmt"
	"maps"
	"math"
	"os"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
)

// spikeA samples random recipes and asks whether the item space is
// interesting or mush: how many distinct things come out, how varied
// they are within a slot, how strong the strongest are against the
// median, and what the quirk adds.
func spikeA(b *sheets.Book, out string, n int) error {
	variant := os.Getenv("SPIKE_A_VARIANT")
	if n == 0 {
		n = 10000
	}
	k := keys.Throwaway("spike-a")
	d := item.NewDeriver(b, k.Quirk)
	plain := item.NewDeriver(b, k.Quirk)
	plain.SkipQuirk = true
	pick := draw.NewDrawer(k.Roll)
	names := nameIndex(b)

	var materials []string
	for _, m := range b.Materials {
		materials = append(materials, m.ID)
	}
	methodsOf := map[string][]string{}
	for _, m := range b.Methods {
		methodsOf[m.Process] = append(methodsOf[m.Process], m.ID)
	}
	var slots []string
	for _, s := range b.Slots {
		slots = append(slots, s.ID)
	}
	maxIn := sheets.IntParam(b.ItemParams, "recipe-max-inputs")
	maxQty := sheets.IntParam(b.ItemParams, "input-max-quantity")
	const stationTier = 4

	type sample struct {
		kind    *item.Kind
		plain   *item.Kind
		depth   int
		recipes []item.Recipe // refinements, then the shape
	}
	var samples []sample
	refined := []string{} // refined kinds so far, usable as inputs
	refineDepth := map[string]int{}
	binds, resonant := 0, 0
	start := time.Now()
	draws := 0
	for i := range n {
		s := pick.Stream("spike-a.recipe", draw.Int(int64(i)))
		r := func(m int) int { draws++; return int(s.Below(uint64(m))) }
		pool := func() string {
			if len(refined) > 0 && r(3) > 0 {
				return refined[r(len(refined))]
			}
			return materials[r(len(materials))]
		}
		var chain []item.Recipe
		base := pool()
		depth := refineDepth[base]
		for range r(3) {
			proc := []string{item.Alloy, item.Alloy, item.Infuse, item.Bind}[r(4)]
			rec := item.Recipe{Process: proc, Method: methodsOf[proc][r(len(methodsOf[proc]))]}
			switch proc {
			case item.Alloy:
				rec.Inputs = []item.Input{{Kind: base, Qty: int64(1 + r(int(maxQty)))}}
				for range r(int(maxIn)) {
					rec.Inputs = append(rec.Inputs, item.Input{Kind: pool(), Qty: int64(1 + r(int(maxQty)))})
				}
			case item.Infuse:
				rec.Inputs = []item.Input{{Kind: base, Qty: 1}, {Kind: pool(), Qty: 1}}
			case item.Bind:
				rec.Inputs = []item.Input{{Kind: base, Qty: 1}}
				for range 1 + r(int(maxIn)-1) {
					rec.Inputs = append(rec.Inputs, item.Input{Kind: pool(), Qty: 1})
				}
			}
			rec.Inputs = dedupe(rec.Inputs, sheets.IntParam(b.ItemParams, "input-max-quantity"))
			if proc == item.Alloy && int64(len(rec.Inputs)) < sheets.IntParam(b.ItemParams, "alloy-min-inputs") {
				continue
			}
			if proc == item.Infuse && len(rec.Inputs) != 2 {
				continue
			}
			kd, err := d.Derive(rec, stationTier)
			if err != nil {
				return fmt.Errorf("refine %v: %w", rec, err)
			}
			if _, err := plain.Derive(rec, stationTier); err != nil {
				return err
			}
			if proc == item.Bind {
				binds++
				if pk, ok := plain.Reg.Kind(kd.ID); ok && len(pk.Traits) > 0 {
					resonant++
				}
			}
			chain = append(chain, rec)
			if _, seen := refineDepth[kd.ID]; !seen {
				refined = append(refined, kd.ID)
				refineDepth[kd.ID] = depth + 1
			}
			base, depth = kd.ID, refineDepth[kd.ID]
		}
		shape := item.Recipe{Process: item.Shape, Method: methodsOf[item.Shape][r(len(methodsOf[item.Shape]))],
			Slot: slots[r(len(slots))], Inputs: []item.Input{{Kind: base, Qty: 1}}}
		kd, err := d.Derive(shape, stationTier)
		if err != nil {
			return fmt.Errorf("shape %v: %w", shape, err)
		}
		pk, err := plain.Derive(shape, stationTier)
		if err != nil {
			return err
		}
		samples = append(samples, sample{kd, pk, depth, append(chain, shape)})
	}
	elapsed := time.Since(start)

	var doc mdDoc
	p := doc.p
	axes := d.Axes()
	p("# Spike A: item derivation over %s random recipes", comma(int64(n)))
	p("")
	p("Throwaway key `spike-a`; station tier %d; variant %q; raw output, read by the spike report.", stationTier, variant)
	p("")

	// Identity and distinctness.
	kinds := map[string]bool{}
	vecs := map[string]bool{}
	for _, s := range samples {
		kinds[s.kind.ID] = true
		vecs[fmt.Sprint(s.kind.Recipe.Slot, s.kind.Tier, s.kind.Vec)] = true
	}
	p("## Identity")
	p("")
	p("| Measure | Value |")
	p("| --- | --- |")
	p("| Final kinds sampled | %s |", comma(int64(n)))
	p("| Distinct final kinds | %s |", comma(int64(len(kinds))))
	p("| Distinct (slot, tier, vector) outcomes | %s |", comma(int64(len(vecs))))
	p("| Refined intermediates made | %s |", comma(int64(len(refined))))
	p("| Recipes that named the same kind twice | %s |", comma(int64(n-len(kinds))))
	p("")

	// Budgets.
	over, trimmed := 0, 0
	byTier := map[int64][]int64{}
	for _, s := range samples {
		bud := d.Budget(s.kind.Tier)
		if s.kind.Vec.Total() > bud {
			over++
		}
		if s.kind.Trimmed > 0 {
			trimmed++
		}
		byTier[s.kind.Tier] = append(byTier[s.kind.Tier], s.kind.Vec.Total())
	}
	p("## Budgets")
	p("")
	p("Kinds over their tier budget: **%d** (target: 0). Kinds trimmed to fit: %s of %s (%.1f%%).", over,
		comma(int64(trimmed)), comma(int64(n)), pct(trimmed, n))
	p("")
	p("| Tier | Kinds | Budget pts | Min pts | p10 pts | Median pts | p90 pts | Max pts | At budget |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, t := range b.Tiers {
		xs := byTier[t.Tier]
		if len(xs) == 0 {
			continue
		}
		slices.Sort(xs)
		at := 0
		for _, x := range xs {
			if x >= t.Budget-1 {
				at++
			}
		}
		p("| tier %d | %s | %d pts | %d pts | %d pts | %d pts | %d pts | %d pts | %.0f%% |", t.Tier, comma(int64(len(xs))), t.Budget,
			xs[0], q(xs, 0.1), q(xs, 0.5), q(xs, 0.9), xs[len(xs)-1], pct(at, len(xs)))
	}
	p("")

	// Shape: which axes lead, per slot.
	p("## What leads, per slot")
	p("")
	p("Share of each slot's kinds whose strongest axis is each axis, and the entropy of the top-two-axes profile (1.0 = every profile equally common, 0 = one profile).")
	p("")
	hdr := "| Slot | Kinds |"
	sep := "| --- | --- |"
	for _, a := range axes {
		hdr += " " + a + " |"
		sep += " --- |"
	}
	p("%s Profiles | Profile entropy |", hdr)
	p("%s --- | --- |", sep)
	for _, slot := range slots {
		var ks []*item.Kind
		for _, s := range samples {
			if s.kind.Recipe.Slot == slot {
				ks = append(ks, s.kind)
			}
		}
		lead := make([]int, len(axes))
		profiles := map[string]int{}
		for _, k := range ks {
			o := order(k.Vec)
			lead[o[0]]++
			profiles[axes[o[0]]+"+"+axes[o[1]]]++
		}
		row := fmt.Sprintf("| %s | %s |", slot, comma(int64(len(ks))))
		for _, c := range lead {
			row += fmt.Sprintf(" %.0f%% |", pct(c, len(ks)))
		}
		p("%s %d | %.2f |", row, len(profiles), entropy(profiles))
	}
	p("")

	// Mush: similarity within a slot and tier against the base materials.
	p("## Mush")
	p("")
	matVecs := []item.Vec{}
	for _, m := range b.Materials {
		v := m.Vector
		matVecs = append(matVecs, item.Vec(v.Slice()))
	}
	p("Mean cosine similarity of random pairs (1.0 = the same shape; lower is more varied):")
	p("")
	p("| Population | Pairs | Mean cosine | Pairs above 0.98 |")
	p("| --- | --- | --- | --- |")
	mc, hi := meanCos(matVecs, pick, "mat")
	p("| Base materials | all | %.3f | %.0f%% |", mc, hi*100)
	var refinedVecs []item.Vec
	byDepth := map[int][]item.Vec{}
	for _, id := range refined {
		refinedVecs = append(refinedVecs, known(d, id).Vec)
		byDepth[refineDepth[id]] = append(byDepth[refineDepth[id]], known(d, id).Vec)
	}
	mc, hi = meanCos(refinedVecs, pick, "ref")
	p("| Refined intermediates | 5,000 | %.3f | %.0f%% |", mc, hi*100)
	for _, depth := range slices.Sorted(maps.Keys(byDepth)) {
		mc, hi = meanCos(byDepth[depth], pick, fmt.Sprint("depth", depth))
		p("| Intermediates %d refinements deep (%s) | 5,000 | %.3f | %.0f%% |", depth, comma(int64(len(byDepth[depth]))), mc, hi*100)
	}
	for _, slot := range slots {
		var vs []item.Vec
		for _, s := range samples {
			if s.kind.Recipe.Slot == slot && s.kind.Tier == 2 {
				vs = append(vs, s.kind.Vec)
			}
		}
		mc, hi = meanCos(vs, pick, slot)
		p("| Tier-2 %s kinds (%s) | 5,000 | %.3f | %.0f%% |", slot, comma(int64(len(vs))), mc, hi*100)
	}
	p("")
	near := 0
	for _, slot := range slots {
		for _, t := range b.Tiers {
			var vs []item.Vec
			for _, s := range samples {
				if s.kind.Recipe.Slot == slot && s.kind.Tier == t.Tier {
					vs = append(vs, s.kind.Vec)
				}
			}
			near += nearTwins(vs, t.Budget/20)
		}
	}
	p("Kinds with a same-slot, same-tier twin within 5%% of the budget (L1): %s of %s (%.0f%%).", comma(int64(near)), comma(int64(n)), pct(near, n))
	p("")

	// Strength.
	p("## Strength")
	p("")
	p("Strength is the sum of the two strongest axes, in pts: with the axis cap a single axis tops out, and what a kind can do rests on its best two. The old target compared the strongest 0.1%% of uniform random recipes with their median, and a uniform recipe is mostly junk. The target now compares the best kind a search finds with the top decile of uniform recipes (p90): the search adversary enumerates every Shape of a base material, of every two-material alloy at quantities 1 to 4, and of every three-material alloy at quantities 1 and 2, with every method. Target: the search's best within 1.3 times the random p90, per tier and slot.")
	p("")
	best, searched := searchBest(b, k, methodsOf, slots, stationTier)
	p("The search derived %s kinds.", comma(int64(searched)))
	p("")
	p("| Tier | Slot | Random kinds | Random median pts | Random p90 pts | Random p99.9 pts | Search best pts | Best against p90 | Holds | Best recipe |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	type outlier struct {
		s     sample
		ratio float64
	}
	var outliers []outlier
	holding, cells := 0, 0
	for _, t := range b.Tiers {
		for _, slot := range slots {
			var ss []sample
			var peaks []int64
			for _, s := range samples {
				if s.kind.Tier == t.Tier && s.kind.Recipe.Slot == slot {
					ss = append(ss, s)
					peaks = append(peaks, s.kind.Vec.TopTwo())
				}
			}
			if len(ss) < craftMinCell {
				continue
			}
			sorted := slices.Clone(peaks)
			slices.Sort(sorted)
			med, p90, top := q(sorted, 0.5), q(sorted, 0.9), q(sorted, 0.999)
			cell := best[cellKey(t.Tier, slot)]
			var bestPts int64
			recipe := "none found"
			if cell != nil {
				bestPts = cell.Vec.TopTwo()
				recipe = describe(cell.d, names, cell.Recipe)
			}
			ratio := float64(bestPts) / float64(max(p90, 1))
			cells++
			ok := ratio <= craftStrength
			if ok {
				holding++
			}
			p("| tier %d | %s | %s | %d pts | %d pts | %d pts | %d pts | %.2f | %s | %s |", t.Tier, slot, comma(int64(len(ss))), med, p90, top, bestPts, ratio, holds(ok), recipe)
			for i, s := range ss {
				outliers = append(outliers, outlier{s, float64(peaks[i]) / float64(max(med, 1))})
			}
		}
	}
	p("")
	p("Cells holding the target: %d of %d. The axis cap is %d%% of the tier budget.", holding, cells, sheets.IntParam(b.ItemParams, "axis-cap-share"))
	p("")
	tierCount := map[int64]int{}
	for _, s := range samples {
		tierCount[s.kind.Tier]++
	}
	p("Final kinds by tier (station tier %d): tier 1 %.0f%%, tier 2 %.0f%%, tier 3 %.0f%%, tier 4 %.0f%%.", stationTier,
		pct(tierCount[1], n), pct(tierCount[2], n), pct(tierCount[3], n), pct(tierCount[4], n))
	p("")

	// Tags, traits, quirk.
	conductive, traited := 0, 0
	traitCount := map[string]int{}
	conductiveByTier := map[int64][2]int{}
	var moved []int64
	for _, s := range samples {
		c := conductiveByTier[s.kind.Tier]
		c[1]++
		if slices.Contains(s.kind.Tags, "conductive") {
			conductive++
			c[0]++
		}
		conductiveByTier[s.kind.Tier] = c
		if len(s.kind.Traits) > 0 {
			traited++
		}
		for _, t := range s.kind.Traits {
			traitCount[t]++
		}
		var l1 int64
		for a := range s.kind.Vec {
			l1 += abs64(s.kind.Vec[a] - s.plain.Vec[a])
		}
		moved = append(moved, l1)
	}
	slices.Sort(moved)
	p("## Tags, traits and the quirk")
	p("")
	p("| Measure | Value |")
	p("| --- | --- |")
	p("| Final kinds tagged `conductive` | %.0f%% |", pct(conductive, n))
	for _, t := range b.Tiers {
		c := conductiveByTier[t.Tier]
		if c[1] > 0 {
			p("| Tier-%d final kinds tagged `conductive` | %.0f%% |", t.Tier, pct(c[0], c[1]))
		}
	}
	p("| Final kinds with a trait | %.0f%% (quirk sheet: 20%%) |", pct(traited, n))
	p("| Different traits seen on final kinds | %d of %d |", len(traitCount), len(b.Traits))
	p("| Traits seen | %s |", mapList(traitCount))
	p("| Points the quirk moved (median, p90, max) | %d pts, %d pts, %d pts |", q(moved, 0.5), q(moved, 0.9), moved[len(moved)-1])
	p("| Binds | %s |", comma(int64(binds)))
	p("| Binds that resonate under item.resonance | %s (%.1f%%) |", comma(int64(resonant)), pct(resonant, max(binds, 1)))
	p("")

	// Cost.
	p("## Cost")
	p("")
	p("Derived %s final kinds and %s intermediates in %s (%.1f µs a sample), %s recipe-picking draws plus 4 quirk draws a new kind.",
		comma(int64(n)), comma(int64(len(refined))), elapsed.Round(time.Millisecond), float64(elapsed.Microseconds())/float64(n), comma(int64(draws)))
	p("")

	// Outliers.
	slices.SortFunc(outliers, func(a, b outlier) int {
		if a.ratio != b.ratio {
			if a.ratio > b.ratio {
				return -1
			}
			return 1
		}
		return strings.Compare(a.s.kind.ID, b.s.kind.ID)
	})
	p("## Outliers")
	p("")
	p("The 20 strongest kinds against their cell's median peak.")
	p("")
	p("| # | Peak against median | Tier | Slot | Vector | Recipe |")
	p("| --- | --- | --- | --- | --- | --- |")
	seen := map[string]bool{}
	row := 0
	for _, o := range outliers {
		if seen[o.s.kind.ID] {
			continue
		}
		seen[o.s.kind.ID] = true
		row++
		p("| %d | %.2f× | tier %d | %s | %s | %s |", row, o.ratio, o.s.kind.Tier, o.s.kind.Recipe.Slot, vecString(axes, o.s.kind.Vec), describe(d, names, o.s.kind.Recipe))
		if row == 20 {
			break
		}
	}
	p("")

	if err := doc.Write(out, "spike-a.md"); err != nil {
		return err
	}
	var csv mdDoc
	csv.p("kind,tier,slot,depth,total_pts,%s,trimmed_pts,traits,tags", strings.Join(axes, ","))
	for _, s := range samples {
		k := s.kind
		var vs []string
		for _, x := range k.Vec {
			vs = append(vs, fmt.Sprint(x))
		}
		var ts []string
		for _, t := range k.Tags {
			ts = append(ts, string(t))
		}
		csv.p("%s,%d,%s,%d,%d,%s,%d,%s,%s", k.ID, k.Tier, k.Recipe.Slot, s.depth, k.Vec.Total(), strings.Join(vs, ","), k.Trimmed,
			strings.Join(k.Traits, " "), strings.Join(ts, " "))
	}
	return csv.Write(out, "spike-a-kinds.csv")
}

func order(v item.Vec) []int {
	o := make([]int, len(v))
	for i := range o {
		o[i] = i
	}
	slices.SortStableFunc(o, func(a, b int) int { return int(v[b] - v[a]) })
	return o
}

func entropy(counts map[string]int) float64 {
	total := 0
	for _, c := range counts {
		total += c
	}
	if len(counts) < 2 {
		return 0
	}
	h := 0.0
	for _, c := range counts {
		p := float64(c) / float64(total)
		h -= p * math.Log(p)
	}
	return h / math.Log(float64(len(counts)))
}

func cosine(a, b item.Vec) float64 {
	var dot, na, nb float64
	for i := range a {
		dot += float64(a[i] * b[i])
		na += float64(a[i] * a[i])
		nb += float64(b[i] * b[i])
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / math.Sqrt(na*nb)
}

func meanCos(vs []item.Vec, pick *draw.Drawer, label string) (float64, float64) {
	if len(vs) < 2 {
		return 0, 0
	}
	sum, hi, n := 0.0, 0, 0
	if len(vs) <= 100 {
		for i := range vs {
			for j := i + 1; j < len(vs); j++ {
				c := cosine(vs[i], vs[j])
				sum += c
				if c > 0.98 {
					hi++
				}
				n++
			}
		}
	} else {
		s := pick.Stream("spike-a.pairs", draw.Str(label))
		for range 5000 {
			i, j := int(s.Below(uint64(len(vs)))), int(s.Below(uint64(len(vs))))
			if i == j {
				continue
			}
			c := cosine(vs[i], vs[j])
			sum += c
			if c > 0.98 {
				hi++
			}
			n++
		}
	}
	return sum / float64(n), float64(hi) / float64(n)
}

func nearTwins(vs []item.Vec, within int64) int {
	count := 0
	for i := range vs {
		for j := range vs {
			if i == j {
				continue
			}
			var l1 int64
			for a := range vs[i] {
				l1 += abs64(vs[i][a] - vs[j][a])
			}
			if l1 <= within {
				count++
				break
			}
		}
	}
	return count
}

func describe(d *item.Deriver, names map[string]string, r item.Recipe) string {
	return describeDepth(d, names, r, 0)
}

func describeDepth(d *item.Deriver, names map[string]string, r item.Recipe, depth int) string {
	var parts []string
	for _, in := range r.Inputs {
		var name string
		if n, ok := names["items.materials:"+in.Kind]; ok {
			name = n
		} else if k, ok := d.Reg.Kind(in.Kind); ok && depth < 2 {
			name = "(" + describeDepth(d, names, k.Recipe, depth+1) + ")"
		} else {
			name = "kind " + in.Kind[:8]
		}
		parts = append(parts, fmt.Sprintf("%d %s", in.Qty, name))
	}
	s := r.Process + " " + r.Method
	if r.Slot != "" {
		s = r.Process + " " + r.Slot + " " + r.Method
	}
	return s + ": " + strings.Join(parts, ", ")
}

func vecString(axes []string, v item.Vec) string {
	var parts []string
	for a, x := range v {
		if x != 0 {
			parts = append(parts, fmt.Sprintf("%s %d", strings.ToUpper(axes[a][:1])+axes[a][1:], x))
		}
	}
	return strings.Join(parts, ", ") + fmt.Sprintf(" pts (%d pts)", v.Total())
}

func known(d *item.Deriver, id string) *item.Kind {
	k, _ := d.Reg.Kind(id)
	return k
}
