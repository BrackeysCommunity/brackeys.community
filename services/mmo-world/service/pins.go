package service

import (
	"net/http"
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// Pins are operators' alone (GDD 14.4): no player read names one. A
// pin's content shows only once its tile is reached, through the tile's
// stored content.

func simPin(p api.PinOrder) game.PinCmd {
	f := p.Fix
	return game.PinCmd{At: simHex(p.At), Reach: p.Reach, As: p.As, For: p.For, Label: p.Label, Pin: p.Pin,
		Fix: tile.Fix{Site: f.Site, Landmark: f.Landmark, SiteKind: f.SiteKind, Dungeon: f.Dungeon, Floors: f.Floors, Lead: f.Lead, Stock: f.Stock}}
}

func apiPin(p world.Pin) api.Pin {
	f := p.Fix
	return api.Pin{ID: p.ID, At: apiHex(p.At), Reach: p.Reach, As: p.By.Role, Server: p.By.Server, Label: p.By.Label, Points: p.By.Points,
		Tick: p.Tick, Landed: p.Landed, Withdrawn: p.Withdrawn, Edit: p.Edit,
		Fix: api.PinFix{Site: f.Site, Landmark: f.Landmark, SiteKind: f.SiteKind, Dungeon: f.Dungeon, Floors: f.Floors, Lead: f.Lead, Stock: f.Stock}}
}

// apiPlaced is who staged a reached tile's content (GDD 14.5); a
// designer's pin names nobody.
func apiPlaced(p *tile.Placed) *api.Placed {
	if p == nil {
		return nil
	}
	return &api.Placed{By: p.By, Label: p.Label, Points: p.Points}
}

// livePins are the pins still counting; covering, when set, keeps those
// a draw on that tile would read.
func livePins(g *game.Game, covering *hex.Hex) []api.Pin {
	var ids []string
	if covering != nil {
		ids = g.World.PinsAt(*covering, g.Tick()+1)
	}
	out := []api.Pin{}
	for _, p := range g.World.LivePins() {
		if covering == nil || slices.Contains(ids, p.ID) {
			out = append(out, apiPin(p))
		}
	}
	return out
}

func (s *Server) pins(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	reply(w, http.StatusOK, api.Pins{Pins: livePins(s.g, nil)})
}
