package service

import (
	"cmp"
	"fmt"
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/sheets"
)

// structural: the unit a witness part counts in.
const unitPercent = "%"

// apiAlignment is where a character stands; one never moved reads 0,
// unremarked.
func apiAlignment(g *game.Game, c *game.Char) api.Alignment {
	out := api.Alignment{Value: game.AlignmentOf(c), Band: g.Band(c), Made: char.IsMade(c.C)}
	if a := c.C.Alignment; a != nil && a.Day == g.Tick()/sheets.TicksPerDay {
		out.GoodToday = a.Good
	}
	return out
}

// victims names the victims of a character's thefts in words, never by
// id: a saved NPC or one on its tile by name, a faction, a caravan's
// route, else what its standing key is called, else someone.
type victims struct {
	g    *game.Game
	c    *game.Char
	here map[string]string
}

func newVictims(g *game.Game, c *game.Char) *victims { return &victims{g: g, c: c} }

func (v *victims) name(victim, faction string) string {
	if ref, ok := fact.ParseRef(victim); ok {
		if n := castName(v.g, ref, v.c.C.ID); n != "" {
			return n
		}
		if ref.Kind == kindNPC {
			if v.here == nil {
				v.here = map[string]string{}
				for _, p := range v.g.PeopleHere(v.c, v.c.C.At) {
					v.here[p.ID] = p.Name
				}
			}
			if n := v.here[ref.ID]; n != "" {
				return n
			}
		}
	}
	if faction != "" {
		if n := v.g.StandingName(faction); n != faction {
			return n
		}
	}
	return victimUnknown
}

// structural: a victim the world gives no name to.
const victimUnknown = "someone"

// apiHot is a hot lot or item as its holder reads it.
func apiHot(v *victims, h game.HotView) api.HotGoods {
	return api.HotGoods{Material: h.Material, Item: h.Item, Units: h.Units, Victim: v.name(h.Victim, h.Faction), Days: h.Days, Reach: h.Reach}
}

// hotGoods are the stolen goods a character carries; nil when none.
func hotGoods(g *game.Game, c *game.Char, v *victims) []api.HotGoods {
	var out []api.HotGoods
	for _, h := range g.HotGoods(c) {
		out = append(out, apiHot(v, h))
	}
	return out
}

// liveWanted are the indices of a character's Wanted entries the watch
// still holds.
func liveWanted(g *game.Game, c *game.Char) []int {
	var out []int
	for i, w := range char.WantedOf(c.C) {
		if w.Live(g.Tick()) {
			out = append(out, i)
		}
	}
	return out
}

// daysLeft are the world days, part days counted whole, until a tick.
func daysLeft(now, ends int64) int64 {
	return max(0, (ends-now+sheets.TicksPerDay-1)/sheets.TicksPerDay)
}

// apiWanted are the thefts the watch wants a character for.
func apiWanted(g *game.Game, c *game.Char, v *victims) []api.WantedIn {
	var out []api.WantedIn
	ws := char.WantedOf(c.C)
	for _, i := range liveWanted(g, c) {
		w := ws[i]
		x := api.WantedIn{Victim: v.name(w.Victim, w.Faction), Places: []string{}, Fine: g.WantedFine(c, i), Days: daysLeft(g.Tick(), w.Ends)}
		for _, n := range g.WantedPlaces(c, i) {
			x.Places = append(x.Places, g.PlaceName(g.SettlementHex(n)))
		}
		out = append(out, x)
	}
	return out
}

// apiStopped is the watch holding a character at a gate, and the fine
// that ends every entry it holds it for there.
func apiStopped(g *game.Game, c *game.Char) *api.WatchStop {
	n, ok := g.StoppedNow(c)
	if !ok {
		return nil
	}
	fine, _ := g.FineAt(c, n)
	out := &api.WatchStop{Settlement: n, Name: g.PlaceName(g.SettlementHex(n)), Fine: fine}
	out.CanPay = c.C.Coin >= out.Fine
	return out
}

// apiGrudges are the factions a character betrayed that still hold it.
func apiGrudges(g *game.Game, c *game.Char) []api.Grudge {
	out := []api.Grudge{}
	day := g.Tick() / sheets.TicksPerDay
	for _, gr := range char.GrudgesOf(c.C) {
		if gr.Live(day) {
			out = append(out, api.Grudge{With: gr.Faction, Name: g.StandingName(gr.Faction), Ends: gr.Ends})
		}
	}
	return out
}

// apiSteals are what a character could steal here now; never nil.
func apiSteals(g *game.Game, c *game.Char) []api.StealTarget {
	out := []api.StealTarget{}
	v := newVictims(g, c)
	for _, st := range g.StealTargets(c) {
		out = append(out, api.StealTarget{Kind: st.Kind, NPC: st.NPC, Caravan: st.Caravan, Name: v.name(st.Victim, st.Faction), Worth: st.Worth,
			Witness: st.Witness, ForSide: st.Side})
	}
	return out
}

// witnessWhy are a theft's witness parts, in per cent.
func witnessWhy(ps []fight.Part) api.Why {
	out := api.Why{Parts: make([]api.Part, len(ps))}
	for i, p := range ps {
		out.Parts[i] = api.Part{Label: p.Label, Value: p.Value, Unit: unitPercent}
	}
	return out
}

// apiTheft is a theft or flight as its encounter shows it, with the odds
// fixed when it began.
func apiTheft(g *game.Game, c *game.Char, t *game.Theft) *api.Theft {
	if t == nil {
		return nil
	}
	out := &api.Theft{Kind: t.Kind, Victim: newVictims(g, c).name(t.Victim, t.Faction), Witness: t.Witness, WitnessWhy: witnessWhy(t.Parts),
		Worth: t.Worth, Coin: t.Coin, Haul: apiGoods(t.Goods), Flee: t.Kind == game.KindFlee, Caught: t.Failed, ForSide: t.Side}
	if len(out.Haul) == 0 {
		out.Haul = nil
	}
	if t.Item != "" {
		out.Item = itemName(g, c, t.Item, t.Listing)
	}
	return out
}

// itemName is what an item is called: from the listing it is lifted off,
// else from the character's pack.
func itemName(g *game.Game, c *game.Char, id, listing string) string {
	var in *item.Instance
	if g.Market != nil && listing != "" {
		if i := slices.IndexFunc(g.Market.Listings, func(l market.Listing) bool { return l.ID == listing }); i >= 0 {
			in = g.Market.Listings[i].Item
		}
	}
	if in == nil {
		in = c.C.Item(id)
	}
	if in == nil {
		return ""
	}
	return shownKind(g, c.Server, in.Kind)
}

// syndicateGoal reports whether a goal is a syndicate job, which only the
// made see (GDD 4.5).
func syndicateGoal(x *game.Goal) bool { return x.Issuer.Kind == goal.BySyndicate }

// seesGoal reports whether a character, or the public for nil, may see a
// goal for what issued it.
func seesGoal(c *game.Char, x *game.Goal) bool {
	return !syndicateGoal(x) || c != nil && char.IsMade(c.C)
}

// madeViewer reports whether a viewer is a character the syndicate made.
func madeViewer(g *game.Game, viewer string) bool {
	if viewer == "" {
		return false
	}
	c := g.Char(viewer)
	return c != nil && char.IsMade(c.C)
}

// syndicateJobFact reports whether a fact is about a syndicate job, by
// the goal it names as a subject or a datum.
func syndicateJobFact(g *game.Game, f api.Fact) bool {
	job := func(id string) bool {
		x := g.GoalOf(id)
		return x != nil && syndicateGoal(x)
	}
	for _, s := range f.Subjects {
		if s.Kind == refGoal && job(s.ID) {
			return true
		}
	}
	for _, d := range f.Data {
		if d.Key == refGoal && d.S != "" && job(d.S) {
			return true
		}
	}
	return false
}

// structural: the ref kind and datum a goal's facts name it by.
const refGoal = "goal"

// visibleTo reports whether a viewer may read a fact at all: as the game
// rules it, and a syndicate job's only by the made. Viewer "" is the
// public.
func visibleTo(g *game.Game, viewer string, f api.Fact) bool {
	refs := make([]fact.Ref, len(f.Subjects))
	for i, s := range f.Subjects {
		refs[i] = fact.Ref{Kind: s.Kind, ID: s.ID}
	}
	made := madeViewer(g, viewer)
	return game.VisibleTo(viewer, made, f.Kind, refs) && (made || !syndicateJobFact(g, f))
}

// hotAt is the mark on an item as its holder reads it, nil when clean.
func hotAt(g *game.Game, c *game.Char, v *victims, in *item.Instance) *api.HotGoods {
	day := g.Tick() / sheets.TicksPerDay
	if !in.Hot.HotOn(day) {
		return nil
	}
	at, _ := hex.ParseRef(in.Hot.At)
	h := apiHot(v, game.HotView{Item: in.ID, Units: 1, Victim: in.Hot.Victim, Faction: in.Hot.Faction, At: at, Ends: in.Hot.Ends,
		Days: in.Hot.Ends - day, Reach: hex.Distance(at, c.C.At)})
	return &h
}

// bandEdges are where the alignment bands begin, from alignment.bands.
func bandEdges(b *sheets.Book) api.BandEdges {
	var out api.BandEdges
	for _, row := range b.AlignBands {
		switch row.ID {
		case api.BandNotorious:
			out.Notorious = row.To
		case api.BandCrooked:
			out.Crooked = row.To
		case api.BandDecent:
			out.Decent = row.From
		case api.BandUpright:
			out.Upright = row.From
		}
	}
	return out
}

// crimeNumbers are the theft and alignment numbers cards state, from
// their sheets.
func crimeNumbers(b *sheets.Book, n *api.Numbers) {
	align := func(id string) int64 { return sheets.IntParam(b.AlignParams, id) }
	theft := func(id string) int64 { return sheets.IntParam(b.TheftParams, id) }
	syn := func(id string) int64 { return sheets.IntParam(b.SyndicateParams, id) }
	n.BandEdges, n.GoodDay, n.PairDay = bandEdges(b), align("good-day"), align("pair-day")
	n.HotDays, n.HotReach, n.WantedDays, n.GrudgeDays = theft("hot-days"), theft("hot-reach"), theft("wanted-days"), theft("grudge-days")
	n.FencePays, n.BackRoomPays, n.Gate, n.Trusted = syn("fence-pays"), syn("back-room-pays"), syn("gate"), syn("trusted")
	n.LaunderPercent = syn("launder-percent")
}

// stealText is a syndicate job's condition in words: the worth to steal,
// and the kind of theft and whose goods, where the job names them.
func stealText(g *game.Game, c goal.Condition) string {
	text := fmt.Sprintf("steal %d coin's worth", c.Count)
	if c.Kind != "" {
		text += " (" + cmp.Or(g.Rules().Name("theft.kinds:"+c.Kind), c.Kind) + ")"
	}
	if c.Victim != "" {
		text += ", from " + g.StandingName(c.Victim)
	}
	return text
}
