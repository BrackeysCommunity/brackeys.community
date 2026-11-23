package game

import (
	"slices"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/tags"
)

// The trace feeds (GDD 13.1): each trace is counted where its signal is
// made, in time bounded by the line it feeds, and never read back from the
// log. Each feed does nothing for a staged act or while emergence is off.

// structural: goods a staged source made are never haulage (GDD 14.5).
const tagStaged = "staged"

// lastFact is the newest fact, the cause a line crossed on.
func (g *Game) lastFact() fact.ID {
	return fact.ID(max(g.Log.Len()-1, 0))
}

// notePassage counts a character's step onto a tile toward a road: 60
// crossings by 20 distinct characters within 9 days (GDD 13.2). A step onto
// a road tile is also road load.
func (g *Game) notePassage(c *Char, h hex.Hex, t int64) error {
	if !g.traced(c, h) {
		return nil
	}
	s, r := g.Emergence, g.r.Emerge
	line := r.Lines[string(emerge.Road)]
	day, season := g.traceAt(t)
	sp := s.Passage[h]
	if sp == nil {
		sp = &emerge.Spot{Hex: h}
		s.Passage[h] = sp
	}
	sp.Count.Add(day, season, 1, r.Decay[emerge.Passage])
	sp.Window.Add(day, season, 1, line.WindowDays)
	sp.Who.See(c.C.ID, day, season, line.Distinct)
	s.Touch(day, emerge.DueKey{Trace: emerge.Passage, Hex: &h})
	if err := g.noteRoadLoad(c, h, t); err != nil {
		return err
	}
	if sp.Done != "" || s.Roads[h] != "" ||
		sp.Window.Sum(day, season, line.WindowDays) < line.Count || sp.Who.Within(day, season, line.WindowDays) < line.Distinct {
		return nil
	}
	at := h
	p, err := g.promoteTrace(Promoting{Type: emerge.Road, Region: g.World.RegionAt(h), At: &at, Cause: g.lastFact()})
	if err != nil {
		return err
	}
	sp.Done = promotedID(p, s.Roads[h])
	return nil
}

// promotedID is what a spot records once its line is crossed: the
// promotion, or the road it joined when the crossing made none.
func promotedID(p *emerge.Promotion, joined string) string {
	switch {
	case p != nil:
		return p.ID
	case joined != "":
		return joined
	}
	return string(emerge.Road)
}

// noteRoadLoad is a step onto a road tile: the load carried counts on the
// region's road load (the road war reads it) and the step is a road step.
func (g *Game) noteRoadLoad(c *Char, h hex.Hex, t int64) error {
	if !g.traced(c, h) {
		return nil
	}
	tl := g.World.Tile(h)
	if tl == nil || tl.Road <= 0 {
		return nil
	}
	c.C.Deeds.Bump(char.DeedRoadSteps, 1)
	region := g.World.RegionAt(h)
	if region < 0 {
		return nil
	}
	s := g.Emergence
	day, season := g.traceAt(t)
	days := g.r.Emerge.P.RoadWarDays
	rl := s.RoadLoad[region]
	if rl == nil {
		rl = &emerge.RoadLoad{Region: region}
		s.RoadLoad[region] = rl
	}
	// The tally by tile starts over once the window has emptied, so the
	// busiest road is this window's.
	if rl.Tiles == nil {
		rl.Tiles = map[hex.Hex]int64{}
	} else if rl.Window.Sum(day, season, days) == 0 {
		clear(rl.Tiles)
	}
	load := g.hauled(c)
	rl.Window.Add(day, season, load, days)
	s.Touch(day, emerge.DueKey{Trace: emerge.Haulage, Region: region})
	rl.Tiles[h] += load
	if b, ok := rl.Tiles[rl.Busiest]; !ok || rl.Tiles[h] > b {
		rl.Busiest = h
	}
	return nil
}

// hauled is what a character carries that counts as haulage: every good
// but those a staged source made.
func (g *Game) hauled(c *Char) int64 {
	var n int64
	for _, s := range c.C.Goods {
		if !g.materialHas(s.Material, tagStaged) {
			n += s.Qty
		}
	}
	return n
}

// siteTrace reports whether an encounter's tile is an overland site whose
// clearings and losses count: never a floor, a dungeon's entrance (a
// dungeon keeps its own record) or a settlement.
func (g *Game) siteTrace(e *fight.Encounter, h hex.Hex) bool {
	return e.Floor == 0 && g.slot(h) != "" && !g.IsDungeon(h) && !g.IsSettlement(h)
}

// noteClearing counts an overland encounter won at a site toward a camp:
// 40 clearings within 14 days. A shared encounter is one clearing, fed by
// its first member.
func (g *Game) noteClearing(c *Char, e *fight.Encounter, t int64) error {
	h := c.C.At
	if e.Result != fight.Won || !g.siteTrace(e, h) || !g.traced(c, h) {
		return nil
	}
	s, r := g.Emergence, g.r.Emerge
	line := r.Lines[string(emerge.Camp)]
	day, season := g.traceAt(t)
	sp := s.Clearing[h]
	if sp == nil {
		sp = &emerge.Spot{Hex: h}
		s.Clearing[h] = sp
	}
	sp.Count.Add(day, season, 1, r.Decay[emerge.Clearing])
	sp.Window.Add(day, season, 1, line.WindowDays)
	s.Touch(day, emerge.DueKey{Trace: emerge.Clearing, Hex: &h})
	if sp.Done != "" || sp.Window.Sum(day, season, line.WindowDays) < line.Count {
		return nil
	}
	return g.promoteSpot(sp, emerge.Camp, h)
}

// noteLoss counts a character down in an overland encounter: on its
// region's tally always, and at a site toward a haunt, 30 downs within 7
// days, counted per down.
func (g *Game) noteLoss(c *Char, e *fight.Encounter, t int64) error {
	h := c.C.At
	if e.Floor != 0 || !g.traced(c, h) {
		return nil
	}
	s, r := g.Emergence, g.r.Emerge
	day, season := g.traceAt(t)
	if region := g.World.RegionAt(h); region >= 0 {
		g.regionTally(region).Downs.Add(day, season, 1, r.Decay[emerge.Loss])
		s.Touch(day, emerge.DueKey{Trace: emerge.Loss, Region: region})
	}
	if !g.siteTrace(e, h) {
		return nil
	}
	line := r.Lines[string(emerge.Haunt)]
	sp := s.Loss[h]
	if sp == nil {
		sp = &emerge.Spot{Hex: h}
		s.Loss[h] = sp
	}
	sp.Count.Add(day, season, 1, r.Decay[emerge.Loss])
	sp.Window.Add(day, season, 1, line.WindowDays)
	s.Touch(day, emerge.DueKey{Trace: emerge.Loss, Hex: &h})
	if sp.Done != "" || sp.Window.Sum(day, season, line.WindowDays) < line.Count {
		return nil
	}
	return g.promoteSpot(sp, emerge.Haunt, h)
}

// promoteSpot promotes a site's camp or haunt; the site kind is what the
// type's hook reads.
func (g *Game) promoteSpot(sp *emerge.Spot, t emerge.Type, h hex.Hex) error {
	at := h
	p, err := g.promoteTrace(Promoting{Type: t, Region: g.World.RegionAt(h), At: &at, Of: g.SiteKind(h), Cause: g.lastFact()})
	if err != nil {
		return err
	}
	sp.Done = promotedID(p, "")
	return nil
}

// regionTally is a region's won beats and downs, made on first use.
func (g *Game) regionTally(region int) *emerge.RegionTally {
	rt := g.Emergence.Regions[region]
	if rt == nil {
		rt = &emerge.RegionTally{Region: region}
		g.Emergence.Regions[region] = rt
	}
	return rt
}

// noteHaul counts the load a character carries into settlement n from the
// last settlement it stood in toward a trade route: 2,000 load between a
// pair within 14 days. It runs before the visit is recorded.
func (g *Game) noteHaul(c *Char, n int, t int64) error {
	last, ok := c.lastVisit()
	if !ok || last.Settlement == n || n >= len(g.Places) || !g.traced(c, g.Places[n].Hex) {
		return nil
	}
	// Already standing here as recently as there: no load came in.
	if v, ok := c.visit(n); ok && v.Tick >= last.Tick {
		return nil
	}
	load := g.hauled(c)
	if load <= 0 {
		return nil
	}
	s, r := g.Emergence, g.r.Emerge
	line := r.Lines[string(emerge.Route)]
	day, season := g.traceAt(t)
	k := emerge.PairOf(last.Settlement, n)
	p := s.Pairs[k]
	if p == nil {
		p = &emerge.Pair{Key: k}
		s.Pairs[k] = p
	}
	p.Count.Add(day, season, load, r.Decay[emerge.Haulage])
	p.Window.Add(day, season, load, line.WindowDays)
	s.Touch(day, emerge.DueKey{Trace: emerge.Haulage, Pair: &k})
	if p.Done != "" || p.Window.Sum(day, season, line.WindowDays) < line.Count {
		return nil
	}
	region := -1
	if k.A < len(g.Places) {
		region = g.World.RegionAt(g.Places[k.A].Hex)
	}
	pr, err := g.promoteTrace(Promoting{Type: emerge.Route, Region: region, Places: []int{k.A, k.B}, Cause: g.lastFact()})
	if err != nil {
		return err
	}
	p.Done = promotedID(pr, "")
	return nil
}

// noteReliance counts a won press: the region's won beats, and the style
// the pressed option makes toward a named style, 20 characters each with
// 10 wins with it within 14 days (GDD 13.2). Once named, the style keeps a
// tally of what it beats there, which its variant is drawn from.
func (g *Game) noteReliance(c *Char, e *fight.Encounter, o fight.Option, t int64) error {
	h := c.C.At
	if !g.traced(c, h) {
		return nil
	}
	region := g.World.RegionAt(h)
	if region < 0 {
		return nil
	}
	s, r := g.Emergence, g.r.Emerge
	day, season := g.traceAt(t)
	decay := r.Decay[emerge.Reliance]
	rt := g.regionTally(region)
	rt.Reliance.Add(day, season, 1, decay)
	rt.Today.Add(day, 1)
	s.Touch(day, emerge.DueKey{Trace: emerge.Reliance, Region: region})
	var gear []tags.Tag
	if o.Gear != nil {
		gear = o.Gear.Tags
	}
	id, lead, resisted, ok := r.Styles.StyleOf(o.Axis, o.Tags, gear)
	if !ok {
		return nil
	}
	k := emerge.StyleKey{Region: region, Style: id}
	st := s.Styles[k]
	if st == nil {
		st = &emerge.StyleTrace{Key: k, Resisted: resisted, Lead: lead}
		s.Styles[k] = st
	}
	s.Touch(day, emerge.DueKey{Trace: emerge.Reliance, Style: &k})
	st.Today.Add(day, 1)
	if st.Done != "" {
		st.Count.Add(day, season, 1, decay)
		if st.Beaten == nil {
			st.Beaten = map[string]int64{}
		}
		st.Beaten[e.Creature.Archetype]++
		return nil
	}
	// A season's close fades what never reached the line.
	if st.Count.Season != season {
		st.Chars, st.Qual = nil, emerge.Recent{}
	}
	st.Count.Add(day, season, 1, decay)
	line := r.Lines[string(emerge.Style)]
	if st.Chars == nil {
		st.Chars = map[string]emerge.Wins{}
	}
	w := st.Chars[c.C.ID]
	w.Add(day, line.PerCharacter)
	st.Chars[c.C.ID] = w
	d, in := w.Qualifies(day, line.WindowDays, line.PerCharacter)
	if !in {
		return nil
	}
	qualify(&st.Qual, c.C.ID, d, season, line.Distinct)
	if st.Qual.Within(day, season, line.WindowDays) < line.Distinct {
		return nil
	}
	at := h
	p, err := g.promoteTrace(Promoting{Type: emerge.Style, Region: region, At: &at, Of: id, First: styleFirst(st, day, line.WindowDays), Cause: g.lastFact()})
	if err != nil {
		return err
	}
	st.Done = promotedID(p, "")
	st.Chars = nil
	return nil
}

// qualify keeps a character's qualifying day, the day of its need-th
// newest win, among a style's qualifiers. Past the cap it drops the
// earliest day, so the kept are the cap latest and the line reads exactly.
func qualify(q *emerge.Recent, id string, d, season, cap int64) {
	if q.Season != season {
		q.IDs, q.Season = nil, season
	}
	q.IDs = slices.DeleteFunc(q.IDs, func(s emerge.Seen) bool { return s.ID == id })
	q.IDs = append(q.IDs, emerge.Seen{ID: id, Day: d})
	if cap > 0 && int64(len(q.IDs)) > cap {
		i := 0
		for j, s := range q.IDs {
			if s.Day < q.IDs[i].Day {
				i = j
			}
		}
		q.IDs = slices.Delete(q.IDs, i, i+1)
	}
}

// styleFirst is the qualifier with most wins with the style inside the
// window; ties go to the one that qualified earliest, then the lowest id.
func styleFirst(st *emerge.StyleTrace, day, length int64) string {
	best, bestWins, bestDay := "", int64(-1), int64(0)
	for _, q := range st.Qual.IDs {
		if q.Day <= day-length {
			continue
		}
		var n int64
		for _, w := range st.Chars[q.ID] {
			if w > day-length && w <= day {
				n++
			}
		}
		if n > bestWins || (n == bestWins && (q.Day < bestDay || (q.Day == bestDay && q.ID < best))) {
			best, bestWins, bestDay = q.ID, n, q.Day
		}
	}
	return best
}

// leadItem is the item a character leads with, which a heavy deed it
// presses names (GDD 13.2's legend from an item): the hand's, else the
// off-hand's, else the body's.
func (g *Game) leadItem(c *Char) *fact.Ref {
	if c == nil || !g.emergeOn() {
		return nil
	}
	for _, slot := range []string{char.Hand, char.OffHand, char.Body} {
		if in := c.C.In(slot, 0); in != nil {
			return &fact.Ref{Kind: renownItem, ID: in.ID}
		}
	}
	return nil
}

// withLead is subjects with the character's lead item, under emergence.
func (g *Game) withLead(c *Char, subjects []fact.Ref) []fact.Ref {
	if ref := g.leadItem(c); ref != nil {
		return append(subjects, *ref)
	}
	return subjects
}

// firstOf is the first of some characters by id, who leads a shared deed.
func (g *Game) firstOf(ids []string) *Char {
	if len(ids) == 0 {
		return nil
	}
	return g.Char(ids[0])
}
