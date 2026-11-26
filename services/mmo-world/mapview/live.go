package mapview

import (
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/tile"
)

// The gauges and gauge-line effects the live layers show.
const (
	gaugeThreat     = "threat"
	gaugeCorruption = "corruption"
	lineDanger      = "ambush"
	lineCorrupted   = "corrupted-nodes"
)

// charKind is the ref kind a character's tracks carry.
var charKind = char.Ref("").Kind

// Live is a tile's live layers this tick, with Fog sight. besides are the
// holder's own characters: their tracks never count toward the busy band.
func Live(g *game.Game, h hex.Hex, p Params, besides map[string]bool) api.MapLive {
	w := g.World
	out := api.MapLive{Q: h.Q, R: h.R, Fog: api.FogSight}
	out.Threat, _ = w.GaugeAt(h, gaugeThreat)
	out.Corruption, _ = w.GaugeAt(h, gaugeCorruption)
	out.Danger, out.Corrupted = w.Past(h, lineDanger), w.Past(h, lineCorrupted)
	if sys, ok := w.Weather(h); ok {
		out.Weather = sys.Kind
	}
	out.Trouble = troubleAt(g, h)
	if t := w.Tile(h); t != nil {
		out.Fire = t.Fire.State == tile.FireBurning
		out.Busy = busy(t, p, besides)
	}
	if e := g.Emergence; e != nil {
		_, out.Cut, out.Toll = g.RoadState(h)
		if c := e.Camps[h]; c != nil {
			out.Camp = e.Shown(c.ID)
		}
		out.Haunted = e.Haunts[h] != nil
	}
	return out
}

// troubleAt is the trouble row running at the settlement whose place
// covers h, its own tile or one of its city's, or "".
func troubleAt(g *game.Game, h hex.Hex) string {
	n, ok := g.SettlementAt(h)
	if !ok {
		n = slices.IndexFunc(g.Places, func(p *game.Place) bool { return p.City != nil && slices.Contains(p.City.Tiles, h) })
		if n < 0 {
			return ""
		}
	}
	a := g.TroubleAt(n)
	if a == nil {
		return ""
	}
	if row := g.TroubleRow(a); row != nil {
		return row.ID
	}
	return ""
}

// busy is a tile's band from its decaying arrivals, and quiet until its
// tracks show enough distinct characters other than the holder's own, so
// no lone walker lights a tile, not even for someone who walked it too
// (GDD 4.11).
func busy(t *tile.State, p Params, besides map[string]bool) string {
	var who []string
	for _, k := range t.Tracks {
		if k.Who.Kind == charKind && !besides[k.Who.ID] && !slices.Contains(who, k.Who.ID) {
			who = append(who, k.Who.ID)
		}
	}
	switch {
	case int64(len(who)) < p.BusyDistinct:
		return ""
	case t.Visits >= p.BusyCrowded:
		return api.BusyCrowded
	case t.Visits >= p.BusyBusy:
		return api.BusyBusy
	case t.Visits >= p.BusyLight:
		return api.BusyLight
	}
	return ""
}

// holderChars are the characters whose own tracks a holder's view leaves
// out of the busy band: the character, or the guild's members.
func holderChars(g *game.Game, h Holder) map[string]bool {
	out := map[string]bool{}
	switch h.Kind {
	case HolderCharacter:
		out[h.ID] = true
	case HolderGuild:
		if gd := g.GuildOf(h.ID); gd != nil {
			for _, m := range gd.G.Members {
				out[m.Char] = true
			}
		}
	}
	return out
}
