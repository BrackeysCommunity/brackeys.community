package harness

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/party"
	"jams.team/mmo-world/sim/sheets"
)

// The Search run's build climb (GDD 18.4): an adversary that builds the
// strongest character it can inside the rules. It climbs kinds from the
// craft space for the sum of their two strongest axes, loadouts (those
// kinds, a tag pairing, a class and practice up to the tier's expected)
// for matchup matrix wins, and a party's puzzle policy for solve rate.
// Every choice it draws is under search.build; the fights and the puzzle
// levels are the Battle run's own, under its throwaway key.

// buildLabel is the build climb's draw purpose.
const buildLabel = "search.build"

// structural: the climb's hand and body slots, as the Battle run's
// matrix kits its characters.
const (
	buildHand = "blade"
	buildBody = "plate"
)

// buildRuns is the encounters a matrix cell is read at: the Battle run's
// battle-runs from searchSize players up, and fewer in proportion below,
// so a small run is a quick look.
func buildRuns(b *sheets.Book, n int) int {
	return max(searchShare, int(sheets.IntParam(b.FightParams, "battle-runs"))*min(n, searchSize)/searchSize)
}

// buildDraw is one choice of the build climb.
type buildDraw struct {
	d     *draw.Drawer
	stage string
	cell  string
	gen   int
	i     int
	try   int
}

func (x buildDraw) pick(n int, part string) int {
	return int(x.d.Below(uint64(max(n, 1)), buildLabel, draw.Str(x.stage), draw.Str(x.cell), draw.Int(int64(x.gen)), draw.Int(int64(x.i)), draw.Int(int64(x.try)), draw.Str(part)))
}

// kindGene is a recipe the kind climb plays: a base of one material or
// an Alloy of several, an optional further step with one more material,
// and the Shape into the cell's slot.
type kindGene struct {
	slot  string
	base  []item.Input
	alloy string
	step  *kindStep
	shape string
}

// kindStep refines the base once more: an Alloy, Infuse or Bind with one
// more input.
type kindStep struct {
	proc, method string
	extra        item.Input
}

func (g kindGene) clone() kindGene {
	g.base = slices.Clone(g.base)
	if g.step != nil {
		s := *g.step
		g.step = &s
	}
	return g
}

func (g kindGene) String() string {
	var in []string
	for _, x := range g.base {
		in = append(in, fmt.Sprintf("%s×%d", x.Kind, x.Qty))
	}
	s := strings.Join(in, " + ")
	if len(g.base) > 1 {
		s = fmt.Sprintf("%s by %s (%s)", item.Alloy, g.alloy, s)
	}
	if g.step != nil {
		s += fmt.Sprintf(", %s by %s with %s×%d", g.step.proc, g.step.method, g.step.extra.Kind, g.step.extra.Qty)
	}
	return fmt.Sprintf("%s, %s by %s", s, g.slot, g.shape)
}

// derive makes the gene's kind with d at the craft station, its inputs'
// quantities capped at maxQty.
func (g kindGene) derive(d *item.Deriver, maxQty int64) (*item.Kind, error) {
	base := g.base[0].Kind
	if len(g.base) > 1 {
		k, err := d.Derive(item.Recipe{Process: item.Alloy, Method: g.alloy, Inputs: g.base}, craftStation)
		if err != nil {
			return nil, err
		}
		base = k.ID
	}
	if g.step != nil {
		k, err := d.Derive(item.Recipe{Process: g.step.proc, Method: g.step.method, Inputs: dedupe([]item.Input{{Kind: base, Qty: 1}, g.step.extra}, maxQty)}, craftStation)
		if err != nil {
			return nil, err
		}
		base = k.ID
	}
	return d.Derive(item.Recipe{Process: item.Shape, Method: g.shape, Slot: g.slot, Inputs: []item.Input{{Kind: base, Qty: 1}}}, craftStation)
}

// fits reports whether a kind belongs to a cell of the kind climb: made,
// at the cell's tier and slot, no exploit and no patch.
func fits(k *item.Kind, tier int64, slot string) bool {
	return k != nil && !k.Failed && k.Tier == tier && k.Slot == slot && k.Exploit == nil && k.Recipe.Process != item.Inscribe
}

// geneOf is the recipe the Craft run's search kept for a cell.
func geneOf(f *found) kindGene {
	return kindGene{slot: f.Slot, base: slices.Clone(f.base), alloy: f.alloy, shape: f.shape}
}

// stepKind is one change to a gene and what it was; "" for none.
func stepKind(g kindGene, s *sampler, pick func(n int, part string) int) (kindGene, string) {
	q := g.clone()
	mats, maxIn, maxQty := s.materials, int(s.maxIn), int(s.maxQty)
	steps := []string{item.Alloy, item.Infuse, item.Bind}
	switch pick(7, "op") {
	case 0:
		j, m := pick(len(q.base), "swap"), mats[pick(len(mats), "material")]
		if !slices.ContainsFunc(q.base, func(x item.Input) bool { return x.Kind == m }) {
			q.base[j].Kind = m
			return q, "base " + m
		}
	case 1:
		if len(q.base) > 1 {
			j, n := pick(len(q.base), "which"), int64(1+pick(maxQty, "qty"))
			if q.base[j].Qty != n {
				q.base[j].Qty = n
				return q, fmt.Sprintf("%s×%d", q.base[j].Kind, n)
			}
		}
	case 2:
		m := mats[pick(len(mats), "material")]
		if len(q.base) < maxIn && !slices.ContainsFunc(q.base, func(x item.Input) bool { return x.Kind == m }) {
			q.base = append(q.base, item.Input{Kind: m, Qty: 1})
			if q.alloy == "" {
				q.alloy = s.methodsOf[item.Alloy][pick(len(s.methodsOf[item.Alloy]), "alloy")]
			}
			return q, "+" + m
		}
	case 3:
		if len(q.base) > 1 {
			j := pick(len(q.base), "drop")
			what := "-" + q.base[j].Kind
			q.base = slices.Delete(q.base, j, j+1)
			if len(q.base) == 1 {
				q.base[0].Qty, q.alloy = 1, ""
			}
			return q, what
		}
	case 4:
		if len(q.base) > 1 {
			if m := s.methodsOf[item.Alloy][pick(len(s.methodsOf[item.Alloy]), "alloy")]; m != q.alloy {
				q.alloy = m
				return q, "alloy by " + m
			}
		}
	case 5:
		if m := s.methodsOf[item.Shape][pick(len(s.methodsOf[item.Shape]), "shape")]; m != q.shape {
			q.shape = m
			return q, "shape by " + m
		}
	case 6:
		if q.step != nil && pick(2, "drop-step") == 0 {
			q.step = nil
			return q, "no further step"
		}
		proc := steps[pick(len(steps), "proc")]
		st := kindStep{proc: proc, method: s.methodsOf[proc][pick(len(s.methodsOf[proc]), "method")], extra: item.Input{Kind: mats[pick(len(mats), "extra")], Qty: int64(1 + pick(maxQty, "extra-qty"))}}
		if q.step == nil || *q.step != st {
			q.step = &st
			return q, fmt.Sprintf("then %s by %s with %s×%d", st.proc, st.method, st.extra.Kind, st.extra.Qty)
		}
	}
	return q, ""
}

// kindPlay is one recipe the kind climb played, and what it made.
type kindPlay struct {
	gen  int
	gene kindGene
	what string
	kind *item.Kind
}

// kindCell is one tier and slot of the kind climb: the Craft run's
// sampled top decile there, the recipes played, and the strongest.
type kindCell struct {
	tier  int64
	slot  string
	p90   int64
	seed  bool // the climb began from the Craft run's own search best
	plays []kindPlay
	best  kindPlay
}

func (c kindCell) ratio() float64 {
	return float64(c.best.kind.Vec.TopTwo()) / float64(max(c.p90, 1))
}

// kindClimb climbs every tier and slot the Craft run reads: the first
// generation is the Craft run's search best and steps from it; each
// later one is steps from the strongest so far, none a recipe played.
func kindClimb(b *sheets.Book, d *draw.Drawer) ([]kindCell, int) {
	cs := sampleCraft(b, craftSamples)
	best, _ := searchBest(b, cs.k, cs.s.methodsOf, cs.s.slots, craftStation)
	var cells []kindCell
	derived := 0
	for _, t := range b.Tiers {
		for _, slot := range cs.s.slots {
			peaks := cs.peaks(t.Tier, slot)
			f := best[cellKey(t.Tier, slot)]
			if len(peaks) < craftMinCell || f == nil {
				continue
			}
			c := kindCell{tier: t.Tier, slot: slot, p90: q(peaks, 0.9), seed: true}
			played := map[string]bool{}
			try := func(g kindGene, gen int, what string) {
				played[g.String()] = true
				k, err := g.derive(cs.d, cs.s.maxQty)
				derived++
				if err != nil || !fits(k, t.Tier, slot) {
					return
				}
				p := kindPlay{gen: gen, gene: g, what: what, kind: k}
				c.plays = append(c.plays, p)
				if c.best.kind == nil || k.Vec.TopTwo() > c.best.kind.Vec.TopTwo() {
					c.best = p
				}
			}
			try(geneOf(f), 0, "the Craft run's search best")
			for gen := range searchGenerations {
				from := geneOf(f)
				if c.best.kind != nil {
					from = c.best.gene
				}
				for i := range searchPolicies {
					if gen == 0 && i == 0 {
						continue
					}
					x := buildDraw{d: d, stage: "kind", cell: cellKey(t.Tier, slot), gen: gen, i: i}
					for x.try = 0; x.try < mutateTries; x.try++ {
						g, what := stepKind(from, cs.s, x.pick)
						if what != "" && !played[g.String()] {
							try(g, gen, what)
							break
						}
					}
				}
			}
			if c.best.kind != nil {
				cells = append(cells, c)
			}
		}
	}
	return cells, derived
}

// poolKind is a kind a loadout may carry: the Battle run's reference
// gear (gene nil), or a recipe the kind climb played.
type poolKind struct {
	gene *kindGene
	name string
	top  int64
}

// kindPools are the kinds a loadout may carry per tier and slot: the
// reference, then every recipe the kind climb played there that the
// Battle run's world makes into a kind of that tier and slot.
func kindPools(bt *battle, cells []kindCell) map[string][]poolKind {
	maxQty := sheets.IntParam(bt.p.Book.ItemParams, "input-max-quantity")
	pools := map[string][]poolKind{}
	for _, ft := range bt.p.Book.FightTiers {
		for _, slot := range []string{buildHand, buildBody} {
			key := cellKey(ft.Tier, slot)
			ref := bt.ref[key]
			pool := []poolKind{{name: "reference", top: ref.Vec.TopTwo()}}
			seen := map[string]bool{ref.ID: true}
			for _, c := range cells {
				if c.tier != ft.Tier || c.slot != slot {
					continue
				}
				for _, p := range c.plays {
					k, err := p.gene.derive(bt.p.Deriver, maxQty)
					if err != nil || !fits(k, ft.Tier, slot) || seen[k.ID] {
						continue
					}
					seen[k.ID] = true
					g := p.gene
					pool = append(pool, poolKind{gene: &g, name: g.String(), top: k.Vec.TopTwo()})
				}
			}
			pools[key] = pool
		}
	}
	return pools
}

// tierBuild is one tier of a loadout: the kinds in hand and on the body
// (indices into the tier's pools), the tag pairing, the class and its
// build, and the practice the character fights at.
type tierBuild struct {
	hand, body int
	pairing    int
	class      int // index into the classes fights read
	variant    int
	practice   int64
}

// buildPolicy is a loadout per fight tier, in the sheet's tier order.
type buildPolicy struct {
	name  string
	tiers []tierBuild
}

func (p buildPolicy) clone() buildPolicy {
	p.tiers = slices.Clone(p.tiers)
	return p
}

func (p buildPolicy) String() string {
	var s []string
	for _, t := range p.tiers {
		s = append(s, fmt.Sprintf("%d/%d/%d/%d/%d/%d", t.hand, t.body, t.pairing, t.class, t.variant, t.practice))
	}
	return strings.Join(s, " ")
}

// buildSpace is what the loadout climb chooses from.
type buildSpace struct {
	book    *sheets.Book
	pools   map[string][]poolKind
	classes []*sheets.Class // the classes fights read
}

func newBuildSpace(book *sheets.Book, pools map[string][]poolKind) buildSpace {
	s := buildSpace{book: book, pools: pools}
	for i := range book.Classes {
		if row := &book.Classes[i]; fights(book, row) {
			s.classes = append(s.classes, row)
		}
	}
	return s
}

// strongest is the pool index of the kind with the largest two strongest
// axes; the reference on a tie.
func strongest(pool []poolKind) int {
	best := 0
	for i, k := range pool {
		if k.top > pool[best].top {
			best = i
		}
	}
	return best
}

// poolTag names a kind of a pool in a loadout's name: ref for the
// reference gear, kN for the climb's Nth.
func poolTag(i int) string { return either(i == 0, "ref", fmt.Sprintf("k%d", i)) }

// describe says what a tier of a loadout carries.
func (s buildSpace) describe(tier int64, t tierBuild) string {
	hand, body := s.pools[cellKey(tier, buildHand)][t.hand], s.pools[cellKey(tier, buildBody)][t.body]
	return fmt.Sprintf("tier %d: %s; blade %s, %s (%d pts); plate %s, %s (%d pts); %s build %d; practice %d", tier, loadouts[t.pairing].Name, poolTag(t.hand), hand.name, hand.top,
		poolTag(t.body), body.name, body.top, s.classes[t.class].ID, t.variant, t.practice)
}

// buildSeeds are the first generation: each a tag pairing from the
// Battle run's kits on the strongest kinds the kind climb found, with a
// class fights read, at the expected practice.
func (s buildSpace) buildSeeds() []buildPolicy {
	var out []buildPolicy
	for j := range min(searchPolicies, len(loadouts)) {
		p := buildPolicy{name: fmt.Sprintf("%s-%s", loadouts[j].Name, s.classes[j%len(s.classes)].ID)}
		for _, ft := range s.book.FightTiers {
			p.tiers = append(p.tiers, tierBuild{
				hand: strongest(s.pools[cellKey(ft.Tier, buildHand)]), body: strongest(s.pools[cellKey(ft.Tier, buildBody)]),
				pairing: j, class: j % len(s.classes), practice: ft.ExpectedPractice,
			})
		}
		out = append(out, p)
	}
	return out
}

// stepBuild is one change to one tier of a loadout and what it was; ""
// for none.
func (s buildSpace) stepBuild(p buildPolicy, pick func(n int, part string) int) (buildPolicy, string) {
	q := p.clone()
	ti := pick(len(q.tiers), "tier")
	ft := s.book.FightTiers[ti]
	t := &q.tiers[ti]
	before := *t
	var what string
	switch pick(6, "op") {
	case 0:
		t.hand = pick(len(s.pools[cellKey(ft.Tier, buildHand)]), "hand")
		what = "blade " + poolTag(t.hand)
	case 1:
		t.body = pick(len(s.pools[cellKey(ft.Tier, buildBody)]), "body")
		what = "plate " + poolTag(t.body)
	case 2:
		t.pairing = pick(len(loadouts), "pairing")
		what = loadouts[t.pairing].Name
	case 3:
		t.class, t.variant = pick(len(s.classes), "class"), 0
		what = s.classes[t.class].ID
	case 4:
		t.variant = pick(variants(s.book, s.classes[t.class]), "variant")
		what = fmt.Sprintf("%s build %d", s.classes[t.class].ID, t.variant)
	case 5:
		t.practice = int64(pick(int(ft.ExpectedPractice)+1, "practice"))
		what = fmt.Sprintf("practice %d", t.practice)
	}
	if *t == before {
		return p, ""
	}
	return q, fmt.Sprintf("t%d %s", ft.Tier, what)
}

// mutateBuild is a loadout one step from p, drawn under search.build for
// its generation and place in it, and none already played.
func (s buildSpace) mutateBuild(p buildPolicy, d *draw.Drawer, gen, i int, played map[string]bool) buildPolicy {
	x := buildDraw{d: d, stage: "loadout", gen: gen, i: i}
	for x.try = 0; x.try < mutateTries; x.try++ {
		q, what := s.stepBuild(p, x.pick)
		if what != "" && !played[q.String()] {
			q.name = p.name + " " + what
			played[q.String()] = true
			return q
		}
	}
	return p
}

// tierIndex is a fight tier's place in the sheet.
func tierIndex(book *sheets.Book, tier int64) int {
	return slices.IndexFunc(book.FightTiers, func(ft sheets.FightTier) bool { return ft.Tier == tier })
}

// kinds are a loadout's blade and plate at a tier, on x's world.
func (s buildSpace) kinds(x *battle, p buildPolicy, tier int64) (hand, body *item.Kind) {
	t := p.tiers[tierIndex(s.book, tier)]
	maxQty := sheets.IntParam(s.book.ItemParams, "input-max-quantity")
	kind := func(slot string, i int) *item.Kind {
		pk := s.pools[cellKey(tier, slot)][i]
		if pk.gene == nil {
			return x.ref[cellKey(tier, slot)]
		}
		k, err := pk.gene.derive(x.p.Deriver, maxQty)
		if err != nil {
			// The kind derived when its pool was made, under the same key.
			panic(fmt.Sprintf("search build: a pool kind no longer derives: %v", err))
		}
		return k
	}
	return kind(buildHand, t.hand), kind(buildBody, t.body)
}

// gearOf is a loadout's character as it climbs: at each tier its kinds,
// pairing and class build.
func (s buildSpace) gearOf(x *battle, p buildPolicy) gear {
	return func(id string, tier, level, practice int64) *char.Character {
		t := p.tiers[tierIndex(s.book, tier)]
		hand, body := s.kinds(x, p, tier)
		c := x.characterWith(id, loadouts[t.pairing], tier, level, practice, hand, body)
		x.classed(c, &classBuild{row: s.classes[t.class], variant: t.variant})
		return c
	}
}

// kitOf is the matrix fought on a loadout's kinds and practice: each
// column a pairing, or a class on the plain kit, as the Battle run's.
func (s buildSpace) kitOf(p buildPolicy) matrixKit {
	return matrixKit{
		kit: func(x *battle, l Loadout, as *classBuild) gear {
			return func(id string, tier, level, practice int64) *char.Character {
				hand, body := s.kinds(x, p, tier)
				c := x.characterWith(id, l, tier, level, practice, hand, body)
				x.classed(c, as)
				return c
			}
		},
		practice: func(tier int64) int64 { return p.tiers[tierIndex(s.book, tier)].practice },
	}
}

// columns runs loadouts over every cell of a matrix at n encounters a
// cell, as the matrix runs a class column.
func (s buildSpace) columns(bt *battle, cells []matrixCell, pols []buildPolicy, n int) ([][]tally, error) {
	out := make([][]tally, len(pols))
	for i := range out {
		out[i] = make([]tally, len(cells))
	}
	err := bt.each(len(pols)*len(cells), func(x *battle, j int) error {
		pi, ci := j/len(cells), j%len(cells)
		c := cells[ci]
		t := pols[pi].tiers[tierIndex(s.book, x.creatures[c.arch].Tier)]
		tl, err := x.spreadCellWith(fmt.Sprintf("m%d", c.level), c.arch, c.level, t.practice, policies[0], n/2, situation{prey: true}, s.gearOf(x, pols[pi]))
		out[pi][ci] = tl
		return err
	})
	return out, err
}

// score is a loadout's column against a matrix.
func score(gen int, p buildPolicy, cells []matrixCell, col []tally) builtPolicy {
	c := builtPolicy{gen: gen, policy: p}
	for ci, cell := range cells {
		t := col[ci]
		if t.rate() > cell.opponent(true) {
			c.won++
		}
		c.wins += t.won
		c.of += t.n
	}
	return c
}

// opponent is a cell's best rate among the matrix's loadouts and, with
// classes, its class columns too.
func (c matrixCell) opponent(classes bool) float64 {
	best := slices.Max(c.loadout)
	if classes && len(c.class) > 0 {
		best = max(best, slices.Max(c.class))
	}
	return best
}

// builtPolicy is one loadout the climb played and how it scored at a
// tenth of the count: matrix cells won against every loadout and class
// column, and encounters won in all.
type builtPolicy struct {
	gen    int
	policy buildPolicy
	won    int
	wins   int
	of     int
}

func (c builtPolicy) better(than builtPolicy) bool {
	if c.won != than.won {
		return c.won > than.won
	}
	return c.wins > than.wins
}

// puzzleTier is one tier of a party's puzzle policy: how many seats the
// party fills and the family whose places it seeks out.
type puzzleTier struct {
	seats  int64
	family int
}

// puzzlePolicy is a party's puzzle policy per fight tier.
type puzzlePolicy struct {
	name  string
	tiers []puzzleTier
}

func (p puzzlePolicy) String() string {
	var s []string
	for _, t := range p.tiers {
		s = append(s, fmt.Sprintf("%d/%d", t.seats, t.family))
	}
	return strings.Join(s, " ")
}

// puzzlePlay is one puzzle policy and its model solve rate at the
// expected practice, per tier (summed over the floors) and over every
// tier.
type puzzlePlay struct {
	gen    int
	policy puzzlePolicy
	sum    []fixed.F
	floors int64
}

func (p puzzlePlay) rate(i int) float64 {
	return float64(p.sum[i]) / float64(fixed.Scale) / float64(max(p.floors, 1))
}

func (p puzzlePlay) total() fixed.F {
	var t fixed.F
	for _, s := range p.sum {
		t += s
	}
	return t
}

// peak is the tier with the largest summed rate; every policy plays the
// same floors, so comparing sums is exact.
func (p puzzlePlay) peak() (int, fixed.F) {
	best := 0
	for i, s := range p.sum {
		if s > p.sum[best] {
			best = i
		}
	}
	return best, p.sum[best]
}

func peakOf(p puzzlePlay) fixed.F {
	_, v := p.peak()
	return v
}

func (p puzzlePlay) overall() float64 {
	return float64(p.total()) / float64(fixed.Scale) / float64(max(p.floors*int64(len(p.sum)), 1))
}

// playPuzzle reads a policy: at each tier, the model's rate for its
// family at the tier's expected practice and its seats, on every dungeon
// floor at the level the Battle run gives it.
func playPuzzle(bt *battle, pol puzzlePolicy, gen int) puzzlePlay {
	pz := bt.p.Puzzles
	out := puzzlePlay{gen: gen, policy: pol, floors: pz.Param("floors")}
	for i, ft := range bt.p.Book.FightTiers {
		t := pol.tiers[i]
		f := bt.p.Book.PuzzleFamilies[t.family].ID
		var s fixed.F
		for floor := int64(1); floor <= out.floors; floor++ {
			s += pz.SolveRate(f, bt.puzzlePractice(ft.Tier), bt.floorLevel(f, ft.Tier, floor), ft.Tier, t.seats)
		}
		out.sum = append(out.sum, s)
	}
	return out
}

// puzzleClimb climbs a party's puzzle policy for solve rate: a drawn first
// generation, then steps from the best so far, none played twice.
func puzzleClimb(bt *battle, d *draw.Drawer) []puzzlePlay {
	book := bt.p.Book
	most := sheets.IntParam(book.FightParams, "party-size-max")
	seatSpan := int(most - party.MinSize + 1)
	played := map[string]bool{}
	var out []puzzlePlay
	for gen := range searchGenerations {
		var from puzzlePolicy
		if gen > 0 {
			top := out[0]
			for _, p := range out {
				if peakOf(p) > peakOf(top) {
					top = p
				}
			}
			from = top.policy
		}
		for i := range searchPolicies {
			x := buildDraw{d: d, stage: "puzzle", gen: gen, i: i}
			for x.try = 0; x.try < mutateTries; x.try++ {
				var q puzzlePolicy
				var what string
				if gen == 0 {
					q.name = fmt.Sprintf("drawn-%d", i)
					for range book.FightTiers {
						q.tiers = append(q.tiers, puzzleTier{seats: party.MinSize + int64(x.pick(seatSpan, fmt.Sprintf("seats-%d", len(q.tiers)))),
							family: x.pick(len(book.PuzzleFamilies), fmt.Sprintf("family-%d", len(q.tiers)))})
					}
					what = q.name
				} else {
					q = puzzlePolicy{tiers: slices.Clone(from.tiers)}
					ti := x.pick(len(q.tiers), "tier")
					if x.pick(2, "op") == 0 {
						q.tiers[ti].seats = party.MinSize + int64(x.pick(seatSpan, "seats"))
						what = fmt.Sprintf("t%d %d seats", book.FightTiers[ti].Tier, q.tiers[ti].seats)
					} else {
						q.tiers[ti].family = x.pick(len(book.PuzzleFamilies), "family")
						what = fmt.Sprintf("t%d %s", book.FightTiers[ti].Tier, book.PuzzleFamilies[q.tiers[ti].family].ID)
					}
					if q.String() == from.String() {
						what = ""
					}
					q.name = from.name + " " + what
				}
				if what != "" && !played[q.String()] {
					played[q.String()] = true
					out = append(out, playPuzzle(bt, q, gen))
					break
				}
			}
		}
	}
	return out
}

// buildResult is the build climb: its kinds, its loadouts and the
// confirming matrices, and its puzzle policies.
type buildResult struct {
	runs      int
	kinds     []kindCell
	derived   int
	space     buildSpace
	climb     []builtPolicy
	best      builtPolicy
	confirmed builtPolicy  // the best against the Battle run's matrix at the full count
	cells     []matrixCell // the Battle run's matrix at the full count
	on        []matrixCell // the matrix fought on the best loadout's kinds and practice
	puzzles   []puzzlePlay
	puzzle    puzzlePlay
	digest    string
}

// buildClimb is the build climb at a size and its section of search.md.
func buildClimb(b *sheets.Book, n int, doc *lineDoc) ([]Measured, error) {
	start := time.Now()
	r, err := climbBuild(b, n)
	if err != nil {
		return nil, err
	}
	fmt.Fprintf(os.Stderr, "search build: %s, %d kinds derived, %d loadouts, %d puzzle policies, digest %s\n", time.Since(start).Round(time.Second), r.derived, len(r.climb), len(r.puzzles), r.digest)
	return r.section(b, doc.p), nil
}

// climbBuild runs the three climbs of the build and confirms the best
// loadout at the full count.
func climbBuild(b *sheets.Book, n int) (*buildResult, error) {
	d := draw.NewDrawer(keys.Throwaway("search").Roll)
	r := &buildResult{runs: buildRuns(b, n)}
	r.kinds, r.derived = kindClimb(b, d)
	bt, err := newBattle(b, r.runs)
	if err != nil {
		return nil, err
	}
	r.space = newBuildSpace(b, kindPools(bt, r.kinds))
	if len(r.space.classes) == 0 {
		return nil, fmt.Errorf("search build: no class is read by fights")
	}
	tenth := max(1, r.runs/searchShare)
	ref, err := bt.matrix(b, tenth)
	if err != nil {
		return nil, err
	}
	played := map[string]bool{}
	gen := r.space.buildSeeds()
	for _, p := range gen {
		played[p.String()] = true
	}
	for g := range searchGenerations {
		if g > 0 {
			top := r.climb[0]
			for _, c := range r.climb {
				if c.better(top) {
					top = c
				}
			}
			gen = make([]buildPolicy, searchPolicies)
			for i := range gen {
				gen[i] = r.space.mutateBuild(top.policy, d, g, i, played)
			}
		}
		cols, err := r.space.columns(bt, ref, gen, tenth)
		if err != nil {
			return nil, err
		}
		for i, p := range gen {
			c := score(g, p, ref, cols[i])
			r.climb = append(r.climb, c)
			fmt.Fprintf(os.Stderr, "search build loadout %d.%d %s: %d of %d cells, %.1f%%\n", g, i, p.name, c.won, len(ref), pct(c.wins, c.of))
		}
	}
	r.best = r.climb[0]
	for _, c := range r.climb {
		if c.better(r.best) {
			r.best = c
		}
	}
	if r.cells, err = bt.matrix(b, r.runs); err != nil {
		return nil, err
	}
	col, err := r.space.columns(bt, r.cells, []buildPolicy{r.best.policy}, r.runs)
	if err != nil {
		return nil, err
	}
	r.confirmed = score(-1, r.best.policy, r.cells, col[0])
	if r.on, err = bt.matrixOn(b, r.runs, r.space.kitOf(r.best.policy)); err != nil {
		return nil, err
	}
	r.puzzles = puzzleClimb(bt, d)
	r.puzzle = r.puzzles[0]
	for _, p := range r.puzzles {
		if peakOf(p) > peakOf(r.puzzle) {
			r.puzzle = p
		}
	}
	r.digest = r.sum()
	return r, nil
}

// sum is a digest over everything the climb played and read, to tell two
// builds apart.
func (r *buildResult) sum() string {
	h := sha256.New()
	for _, c := range r.kinds {
		for _, p := range c.plays {
			fmt.Fprintf(h, "kind %d %s %s %v\n", c.tier, c.slot, p.gene, p.kind.Vec)
		}
	}
	for _, c := range r.climb {
		fmt.Fprintf(h, "loadout %s %d %d %d\n", c.policy, c.won, c.wins, c.of)
	}
	fmt.Fprintf(h, "confirmed %d %d %d\n", r.confirmed.won, r.confirmed.wins, r.confirmed.of)
	for _, cells := range [][]matrixCell{r.cells, r.on} {
		for _, c := range cells {
			fmt.Fprintf(h, "cell %s %d %v %v\n", c.arch, c.level, c.loadout, c.class)
		}
	}
	for _, p := range r.puzzles {
		fmt.Fprintf(h, "puzzle %s %v\n", p.policy, p.sum)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// section writes the build climb and returns its readings.
func (r *buildResult) section(b *sheets.Book, p func(string, ...any)) []Measured {
	p("# Search run: build")
	p("")
	p("An adversary that builds the strongest character the rules allow (GDD 18.4). Three climbs, each %d candidates a generation for %d generations, every choice drawn under `%s`: kinds from the craft space for the sum of their two strongest axes; loadouts for matchup matrix wins; and a party's puzzle policy for solve rate. Fights and puzzle levels are the Battle run's, under its throwaway key `battle-run`, at %s encounters a matrix cell (a tenth of that while climbing).", searchPolicies, searchGenerations, buildLabel, comma(int64(r.runs)))
	p("")
	readings := []Measured{r.kindSection(p)}
	readings = append(readings, r.loadoutSection(b, p)...)
	readings = append(readings, r.puzzleSection(b, p))
	p("Climb digest `%s`.", r.digest)
	p("")
	return readings
}

func (r *buildResult) kindSection(p func(string, ...any)) Measured {
	p("## Kinds")
	p("")
	p("Per tier and slot the Craft run reads, the climb starts from the Craft run's own search best (a material or an Alloy of two or three, shaped by any method) and steps from the strongest so far: a material swapped, added or dropped, a quantity, an Alloy or Shape method, or one further Alloy, Infuse or Bind with one more material. A step that leaves the cell's tier, fails or repeats a recipe is drawn again. %s recipes derived. The strongest is read against %.1f times the Craft run's sampled top decile (%s recipes, throwaway key `craft-run`).", comma(int64(r.derived)), craftStrength, comma(craftSamples))
	p("")
	p("| Tier | Slot | p90 pts | Climbed best pts | Ratio | Holds | Recipe | Found in generation |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- |")
	holding, worst, worstAt := 0, 0.0, ""
	for _, c := range r.kinds {
		ratio := c.ratio()
		ok := ratio <= craftStrength
		if ok {
			holding++
		}
		if ratio > worst {
			worst, worstAt = ratio, fmt.Sprintf("tier-%d %s", c.tier, c.slot)
		}
		p("| tier %d | %s | %d | %d | %.2f | %s | %s | %d |", c.tier, c.slot, c.p90, c.best.kind.Vec.TopTwo(), ratio, holds(ok), c.best.gene, c.best.gen)
	}
	p("")
	p("Cells holding: %d of %d; worst ratio %.2f (%s).", holding, len(r.kinds), worst, worstAt)
	p("")
	return Measured{Target: "top-kinds-near-median", Value: fmt.Sprintf("the climbed kinds: %d of %d cells; worst %.2f (%s)", holding, len(r.kinds), worst, worstAt), Holds: holding == len(r.kinds)}
}

// shares are the cells each name wins, and the top name other than skip.
func shares(names []string, won func(c matrixCell) string, cells []matrixCell, skip string) (map[string]int, string, float64) {
	n := map[string]int{}
	for _, c := range cells {
		n[won(c)]++
	}
	top, share := "none", 0.0
	for _, name := range names {
		if s := pct(n[name], len(cells)); name != skip && s > share {
			top, share = name, s
		}
	}
	return n, top, share
}

// loadoutSection writes the loadout climb and the matrix on its kit, and
// returns tag-pairing-share and class-share.
func (r *buildResult) loadoutSection(b *sheets.Book, p func(string, ...any)) []Measured {
	sp := r.space
	p("## Loadouts")
	p("")
	p("A loadout is, per fight tier, a blade and a plate from the kinds the kind climb played there (or the Battle run's reference gear), one of the Battle run's tag pairings, a class fights read and its build, and practice from 0 to the tier's expected. The first generation puts each pairing on the strongest kinds found, with a class, at the expected practice; each later generation is %d single steps from the best so far (a kind, the pairing, the class, its build or the practice, at one tier), none a loadout already played. A loadout scores the cells of the Battle run's matrix (at a tenth of the count) it wins against every loadout and class column, then its encounters won. It fights as the matrix's class columns do: met, not ambushed, away from walls, its prey marked.", searchPolicies)
	p("")
	p("| Generation | Loadout | Cells won | Encounters won |")
	p("| --- | --- | --- | --- |")
	for _, c := range r.climb {
		p("| %d | `%s` | %d of %d | %.1f%% |", c.gen, c.policy.name, c.won, len(r.cells), pct(c.wins, c.of))
	}
	p("")
	p("The best, `%s`, wins %d of %d cells of the Battle run's matrix at %s encounters a cell (%.1f%% of its encounters):", r.best.policy.name, r.confirmed.won, len(r.cells), comma(int64(r.runs)), pct(r.confirmed.wins, r.confirmed.of))
	p("")
	var pairings, classes []string
	for i, ft := range b.FightTiers {
		t := r.best.policy.tiers[i]
		p("- %s", sp.describe(ft.Tier, t))
		if n := loadouts[t.pairing].Name; !slices.Contains(pairings, n) {
			pairings = append(pairings, n)
		}
		if n := sp.classes[t.class].ID; !slices.Contains(classes, n) {
			classes = append(classes, n)
		}
	}
	p("")
	p("### The matrix on the climbed kit")
	p("")
	p("The Battle run's matrix at %s encounters a cell, every column fought on the best loadout's blade, plate and practice at each tier instead of the reference gear, so a pairing or a class wins here only by what it adds to the strongest kit the climb found.", comma(int64(r.runs)))
	p("")
	header, sep := "| Archetype | Level |", "| --- | --- |"
	for _, l := range loadouts {
		header, sep = header+" "+l.Name+" |", sep+" --- |"
	}
	header, sep = header+" Winner |", sep+" --- |"
	for _, c := range b.Classes {
		header, sep = header+" "+c.ID+" |", sep+" --- |"
	}
	p("%s With classes |", header)
	p("%s --- |", sep)
	for _, c := range r.on {
		row := fmt.Sprintf("| %s | %d |", c.arch, c.level)
		for _, x := range c.loadout {
			row += fmt.Sprintf(" %.1f%% |", 100*x)
		}
		row += " " + c.winner() + " |"
		for _, x := range c.class {
			row += fmt.Sprintf(" %.1f%% |", 100*x)
		}
		p("%s %s |", row, c.classWinner(b))
	}
	p("")
	var names, classNames []string
	for _, l := range loadouts {
		names = append(names, l.Name)
	}
	for _, c := range b.Classes {
		classNames = append(classNames, c.ID)
	}
	byPairing, topPairing, pairShare := shares(names, matrixCell.winner, r.on, loadouts[0].Name)
	byClass, topClass, classShare := shares(classNames, func(c matrixCell) string { return c.classWinner(b) }, r.on, "")
	own := func(names []string, by map[string]int) string {
		var s []string
		for _, n := range names {
			s = append(s, fmt.Sprintf("%s %.1f%%", n, pct(by[n], len(r.on))))
		}
		return strings.Join(s, ", ")
	}
	pairMax, classMax := sheets.IntParam(b.FightParams, "pairing-share-max"), sheets.IntParam(b.ClassParams, "class-share-max")
	p("On the climbed kit the top pairing, %s, wins %.1f%% of %d cells (against %d%%), and the loadout's own %s; the top class, %s, wins %.1f%% (against %d%%), and the loadout's own %s.",
		topPairing, pairShare, len(r.on), pairMax, own(pairings, byPairing), topClass, classShare, classMax, own(classes, byClass))
	p("")
	return []Measured{
		{Target: "tag-pairing-share", Value: fmt.Sprintf("on the climbed kit: top pairing %s wins %.1f%% of %d cells; the loadout's own %s", topPairing, pairShare, len(r.on), own(pairings, byPairing)), Holds: pairShare <= float64(pairMax)},
		{Target: "class-share", Value: fmt.Sprintf("on the climbed kit: top class %s wins %.1f%% of %d cells; the loadout's own %s", topClass, classShare, len(r.on), own(classes, byClass)), Holds: classShare <= float64(classMax)},
	}
}

func (r *buildResult) puzzleSection(b *sheets.Book, p func(string, ...any)) Measured {
	pz := r.puzzle
	hi := sheets.IntParam(b.PuzzleParams, "solve-target-max")
	p("## Puzzles")
	p("")
	p("A party's puzzle policy is, per fight tier, how many seats it fills (%d to %d) and the puzzle family whose places it seeks out. It is read by the model's solve rate at the tier's expected practice on every dungeon floor, at the level the Battle run gives each floor. The first generation is drawn; each later one is single steps from the best so far. The policy is climbed for, and read by, its highest tier's rate against the target's ceiling, %d%%: a party that chooses well should not beat it at any tier.", party.MinSize, sheets.IntParam(b.FightParams, "party-size-max"), hi)
	p("")
	p("| Generation | Policy | Highest tier | Over every tier |")
	p("| --- | --- | --- | --- |")
	for _, x := range r.puzzles {
		i, _ := x.peak()
		p("| %d | `%s` | tier %d %.1f%% | %.1f%% |", x.gen, x.policy.name, b.FightTiers[i].Tier, 100*x.rate(i), 100*x.overall())
	}
	p("")
	p("| Tier | Family | Seats | Solve rate |")
	p("| --- | --- | --- | --- |")
	var per []string
	holds := true
	for i, ft := range b.FightTiers {
		holds = holds && 100*pz.rate(i) <= float64(hi)
		t := pz.policy.tiers[i]
		p("| tier %d | %s | %d | %.1f%% |", ft.Tier, b.PuzzleFamilies[t.family].ID, t.seats, 100*pz.rate(i))
		per = append(per, fmt.Sprintf("tier %d %s at %d seats %.1f%%", ft.Tier, b.PuzzleFamilies[t.family].ID, t.seats, 100*pz.rate(i)))
	}
	p("")
	top, _ := pz.peak()
	return Measured{Target: "puzzle-solve-rate", Value: fmt.Sprintf("the climbed party policy's highest tier: %s (%s; over every tier %.1f%%)", per[top], strings.Join(per, "; "), 100*pz.overall()), Holds: holds}
}
