package service

import (
	"cmp"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
	"jams.team/mmo-world/store"
)

// A server's house (GDD 14): its settlements and pools, what it may stage,
// its live stages and, for its staff and admins, its queue. The bot holds
// the API token and sends the reading member's flags, as it does on every
// write.

// structural: the most sites a house lists per settlement, and the rings
// round a settlement its people know without walking them.
const (
	houseSites = 24
	houseRings = 2
)

// houseRoleOf is the role a read's admin and staff flags make its reader;
// admin implies every staff right.
func houseRoleOf(r *http.Request) string {
	q := r.URL.Query()
	admin, _ := strconv.ParseBool(q.Get("admin"))
	staff, _ := strconv.ParseBool(q.Get("staff"))
	switch {
	case admin:
		return api.RoleAdmin
	case staff:
		return api.RoleStaff
	}
	return api.RolePlayer
}

// house is a server's house as one of its members reads it. A server with
// no house yet reads as an empty one, with no arrival.
func (s *Server) house(w http.ResponseWriter, r *http.Request) {
	server := r.URL.Query().Get("server")
	if server == "" {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "server is required"})
		return
	}
	role := houseRoleOf(r)
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	if id := charParam(r); id != "" && s.charFor(w, id) == nil {
		return
	}
	reply(w, http.StatusOK, apiHouse(s.g, server, role))
}

// apiHouse is a server's house for a reader of a role; the queue, holds,
// masks and hidden notes are its staff's and admins' alone.
func apiHouse(g *game.Game, server, role string) api.House {
	b := g.Rules().Book
	out := api.House{Server: server, Arrival: -1, Settlements: []api.HouseSettlement{}, Templates: []api.StageTemplate{}, Hunts: []string{},
		Contests: []string{}, Stages: []api.StageView{}, Role: role, StagedXP: sheets.IntParam(b.LiveOpsParams, "staged-xp")}
	for _, t := range b.LiveOpsTemplates {
		out.Templates = append(out.Templates, api.StageTemplate{ID: t.ID, Kind: t.Kind, Points: t.Points, Staff: t.Staff, Tier: t.Tier,
			Crates: t.Crates, Days: t.Days, Patterns: slices.Clone(t.Patterns)})
	}
	for _, h := range b.Hunts {
		if h.Kind == "" {
			out.Hunts = append(out.Hunts, h.ID)
		}
	}
	for _, c := range b.LiveOpsContests {
		out.Contests = append(out.Contests, c.ID)
	}
	if gd := g.ServerGuild(server); gd != nil {
		out.Guild, out.Label = gd.G.ID, shownGuild(g, server, gd.G.ID, gd.G.Name)
		most, refill := sheets.IntParam(b.LiveOpsParams, "pool-cap"), g.PoolRefill(server)
		for n, p := range g.Places {
			if p.Guild != gd.G.ID {
				continue
			}
			if out.Arrival < 0 {
				out.Arrival = n
			}
			out.Settlements = append(out.Settlements, api.HouseSettlement{N: n, Name: shownPlace(g, server, p.Hex),
				Region: world.RegionRef(g.World.RegionAt(p.Hex)), Pool: g.PoolOf(server, n), PoolCap: most, Refill: refill, Sites: houseSitesOf(g, server, n)})
		}
	}
	if g.Live != nil {
		for _, st := range g.Live.Stages {
			if st.Server == server {
				out.Stages = append(out.Stages, stageView(g, server, st))
			}
		}
	}
	h := g.House(server)
	if h != nil {
		out.Settings = apiSettings(h.Settings)
	}
	if role == api.RolePlayer {
		return out
	}
	for _, p := range g.World.LivePins() {
		if p.By.Server == server {
			out.Pins = append(out.Pins, apiPin(p))
		}
	}
	if h == nil {
		return out
	}
	for _, c := range h.Cases {
		out.Cases = append(out.Cases, apiCase(c, ""))
	}
	for _, x := range h.Holds {
		out.Holds = append(out.Holds, api.Hold{Char: x.Char, Kind: x.Kind, Ends: x.Ends, Case: x.Case})
	}
	out.Masks, out.Hidden = slices.Clone(h.Masks), slices.Clone(h.Hidden)
	return out
}

func apiSettings(s game.HouseSettings) api.HouseSettings {
	out := api.HouseSettings{StaffRoles: s.StaffRoles, AlarmRoles: s.AlarmRoles, HideNames: s.HideNames, Narrated: s.Narrated,
		QuietFrom: s.QuietFrom, QuietTo: s.QuietTo}
	for _, c := range s.Channels {
		out.Channels = append(out.Channels, api.Channel{Kind: c.Kind, ID: c.ID})
	}
	return out
}

func apiCase(c game.Case, server string) api.Case {
	return api.Case{ID: c.ID, Ref: c.Ref, Reason: c.Reason, State: c.State, Action: c.Action, Reporters: int64(len(c.By)), Tick: c.Tick,
		Server: server}
}

// stagePlaced is who staged a stage, as a staged hunt or tile names it,
// its label the staging guild's name as a server reads it.
func stagePlaced(g *game.Game, server string, st *game.Stage) *api.Placed {
	by := tile.PlacedStaff
	if st.Role == game.RoleAdmin {
		by = tile.PlacedAdmins
	}
	label := st.Label
	if gd := g.ServerGuild(st.Server); gd != nil {
		label = shownGuild(g, server, gd.G.ID, label)
	}
	return &api.Placed{By: by, Label: label, Points: st.Points}
}

// vaultMarks are a vault machine's place and who staged it; "" and nil for
// any other machine.
func vaultMarks(g *game.Game, server, place string) (string, *api.Placed) {
	id, ok := strings.CutPrefix(place, "vault:")
	if !ok {
		return "", nil
	}
	if st := g.StageByID(id); st != nil {
		return place, stagePlaced(g, server, st)
	}
	return place, nil
}

func stageView(g *game.Game, server string, st *game.Stage) api.StageView {
	out := api.StageView{ID: st.ID, Template: st.Template, Kind: st.Kind, Placed: *stagePlaced(g, server, st), Settlement: st.Settlement, At: apiHex(st.At),
		Opens: st.Opens, Ends: st.Ends, Open: st.Open, Closed: st.Closed, Hunt: st.HuntID, Crates: st.Crates, Goals: st.Goals,
		Taken: st.Vault != nil && st.Vault.Taken != ""}
	if st.Settlement >= 0 && st.Settlement < len(g.Places) {
		out.Place = shownPlace(g, server, g.Places[st.Settlement].Hex)
	}
	return out
}

// houseSitesOf are the tiles of a settlement's region a staging may name:
// awake, passable, no settlement's own, and found or within houseRings of
// the settlement. Those with a dungeon, a landmark or a site come first,
// then the rest, each nearest first.
func houseSitesOf(g *game.Game, server string, n int) []api.HouseSite {
	gen := g.Rules().Gen
	home := g.Places[n].Hex
	region := gen.RegionOf(home)
	type site struct {
		at    hex.Hex
		name  string
		named bool
	}
	var all []site
	seen := map[hex.Hex]bool{}
	consider := func(h hex.Hex) {
		if seen[h] || gen.RegionOf(h) != region || g.World.RegionAt(h) < 0 || g.IsSettlement(h) || !gen.Passable(g.World.Baseline(h).Terrain) {
			return
		}
		seen[h] = true
		name, named := siteName(g, server, h)
		all = append(all, site{h, name, named})
	}
	for _, h := range hex.DiscAt(home, houseRings) {
		consider(h)
	}
	for _, st := range g.World.Tiles {
		if st.Discovered != nil {
			consider(st.Hex)
		}
	}
	slices.SortFunc(all, func(a, b site) int {
		if a.named != b.named {
			if a.named {
				return -1
			}
			return 1
		}
		return cmp.Or(cmp.Compare(hex.Distance(home, a.at), hex.Distance(home, b.at)), cmp.Compare(a.at.Q, b.at.Q), cmp.Compare(a.at.R, b.at.R))
	})
	out := []api.HouseSite{}
	for _, x := range all[:min(len(all), houseSites)] {
		out = append(out, api.HouseSite{At: apiHex(x.at), Name: x.name})
	}
	return out
}

// siteName is what a site goes by on a console: its dungeon's name, its
// landmark or site, or its region's name; named reports one of the first
// three.
func siteName(g *game.Game, server string, h hex.Hex) (string, bool) {
	if d := shownDungeon(g, server, h); d != "" {
		return d, true
	}
	lm := g.World.Baseline(h).Landmark
	if c, ok := g.Content(h); ok && c.Landmark != "" {
		lm = c.Landmark
	}
	if lm != "" {
		return lm, true
	}
	if site := g.SiteAt(h); site != "" {
		return site, true
	}
	return g.PlaceName(h), false
}

// pageAfter is a log read's after, 0 for none.
func pageAfter(w http.ResponseWriter, r *http.Request) (int64, bool) {
	q := r.URL.Query().Get("after")
	if q == "" {
		return 0, true
	}
	n, err := strconv.ParseInt(q, 10, 64)
	if err != nil || n < 0 {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "after is a log row id"})
		return 0, false
	}
	return n, true
}

// houseLog is a page of a server's log, oldest first, after a row id.
func (s *Server) houseLog(w http.ResponseWriter, r *http.Request) {
	server := r.URL.Query().Get("server")
	if server == "" {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "server is required"})
		return
	}
	after, ok := pageAfter(w, r)
	if !ok {
		return
	}
	page, err := s.st.HouseLog(r.Context(), server, after, 0)
	if err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, apiLog(page))
}

// operatorHouseLog is a page of every server's log and the operators'.
func (s *Server) operatorHouseLog(w http.ResponseWriter, r *http.Request) {
	after, ok := pageAfter(w, r)
	if !ok {
		return
	}
	page, err := s.st.AllHouseLog(r.Context(), after, 0)
	if err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, apiLog(page))
}

func apiLog(p store.LogPage) api.HouseLog {
	out := api.HouseLog{Rows: []api.LogRow{}, Next: p.Next}
	for _, x := range p.Rows {
		out.Rows = append(out.Rows, api.LogRow{ID: x.ID, Server: x.Server, Tick: x.Tick, At: x.At.UnixMilli(), Character: x.Character,
			Discord: x.Discord, Role: x.Role, Kind: x.Kind, What: x.What, Points: x.Points})
	}
	return out
}

// operatorCases are the cases every server escalated, for operators to
// act on and close (GDD 14.6).
func (s *Server) operatorCases(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	out := api.Cases{Cases: []api.Case{}}
	for _, h := range s.g.Houses {
		for _, c := range h.Cases {
			if c.State == game.CaseEscalated {
				out.Cases = append(out.Cases, apiCase(c, h.Server))
			}
		}
	}
	reply(w, http.StatusOK, out)
}
