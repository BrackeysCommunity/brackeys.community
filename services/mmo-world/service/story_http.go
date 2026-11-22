package service

import (
	"cmp"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/world"
	"jams.team/mmo-world/store"
)

// structural: the most events one read returns, how many earlier days a
// chronicle offers to open, and the outcome of a stage nobody won.
const (
	eventsMost       = 100
	chronicleEarlier = 7
	outcomeLapsed    = "lapsed"
)

// Ref kinds a cast binds, as sim/arc names them.
var (
	kindFaction    = arc.FactionRef(0).Kind
	kindRegion     = arc.RegionRef(0).Kind
	kindHolding    = arc.HoldingRef(0).Kind
	kindSettlement = arc.SettlementRef(0).Kind
	kindTile       = arc.TileRef(hex.Hex{}).Kind
	kindCharacter  = char.Ref("").Kind
)

// Ref kinds a cast binds that sim/arc builds unexported.
const (
	kindNotable = "notable"
	kindNPC     = "npc"
)

// charParam is the character a story read names.
func charParam(r *http.Request) string {
	q := r.URL.Query()
	return cmp.Or(q.Get("characterId"), q.Get("character"))
}

// viewerOf is the character a read names, under the lock: "" when it
// names none, and ok false once a refusal is written.
func (s *Server) viewerOf(w http.ResponseWriter, r *http.Request) (*game.Char, bool) {
	id := charParam(r)
	if id == "" {
		return nil, true
	}
	c := s.charFor(w, id)
	return c, c != nil
}

// sideMark is the units a goods or beats side asks per active character,
// as the side rows set it.
func sideMark(b *sheets.Book) int64 {
	for _, row := range b.Arcs {
		for _, st := range row.Stages {
			for _, sd := range st.Sides {
				if sd.Wants == arc.WantGoods || sd.Wants == arc.WantBeats {
					return sd.Per
				}
			}
		}
	}
	return 0
}

// apiSeason is where the world stands in its season; a world keeping no
// season gives the zero value.
func apiSeason(g *game.Game) api.Season {
	c, tb, ok := g.Season()
	if !ok {
		return api.Season{}
	}
	day := c.Day(g.Tick() / sheets.TicksPerDay)
	return api.Season{N: c.N, Day: day, Days: c.Days, Band: tb.At(day).Band, Ends: (c.Start + c.Days) * sheets.TicksPerDay}
}

// shown reports whether a viewer may see an arc: a personal thread is its
// own character's alone.
func shown(a *game.Arc, viewer string) bool {
	return a.Scope != arc.Personal || viewer != "" && a.Char == viewer
}

// apiArc is an arc as a viewer sees it, at the stage it stands at or
// ended on.
func apiArc(g *game.Game, a *game.Arc, viewer string) api.Arc {
	out := api.Arc{ID: a.ID, Template: a.Template, Title: arcTitle(g, a), Scope: a.Scope, Cast: []api.CastRef{}, Regions: []string{},
		Seat: apiHex(a.Seat), Stages: int64(len(a.Stages)), Sides: []api.Side{}, Outcome: a.Outcome, Began: a.Began, Lapsed: a.Outcome == outcomeLapsed}
	for _, b := range a.Cast {
		out.Cast = append(out.Cast, api.CastRef{Role: b.Role, Kind: b.Ref.Kind, ID: b.Ref.ID, Name: castName(g, b.Ref, viewer)})
	}
	for _, r := range a.Regions {
		out.Regions = append(out.Regions, world.RegionRef(r))
	}
	if len(a.Stages) == 0 {
		return out
	}
	i := min(max(a.Stage, 0), len(a.Stages)-1)
	st := a.Stages[i]
	out.Stage, out.Due = int64(i), st.Due
	if c, _, ok := g.Season(); ok {
		out.DueDay = c.Day(st.Due / sheets.TicksPerDay)
	}
	for _, sr := range st.Sides {
		out.Sides = append(out.Sides, apiSide(g, a, i, sr, viewer))
	}
	return out
}

// arcTitle is an arc's template by name, or its id.
func arcTitle(g *game.Game, a *game.Arc) string {
	sheet := "story.arcs:"
	if a.Scope == arc.Settlement {
		sheet = "story.troubles:"
	}
	return cmp.Or(g.Rules().Name(sheet+a.Template), a.Template)
}

// apiSide is one side of a stage: how full its mark is, who backs it, and
// what it pays.
func apiSide(g *game.Game, a *game.Arc, stage int, sr game.SideRun, viewer string) api.Side {
	wants, tag := sideWants(g, a, stage, sr.Side)
	out := api.Side{ID: sr.Side, Title: cmp.Or(g.Rules().Name("story.sides:"+sr.Side), sr.Side), Wants: wants, Tag: tag, Goal: sr.Goal,
		Mark: sr.Mark, Sponsor: factionName(g, sr.Sponsor)}
	if sr.Opponent >= 0 && sr.Opponent != sr.Sponsor {
		out.Opponent = factionName(g, sr.Opponent)
	}
	out.At, out.AtHex = sideAtName(g, sr.At)
	backers := map[string]bool{}
	for _, bk := range g.Story.Backers {
		if bk.Arc == a.ID && bk.Stage == stage && bk.Side == sr.Side {
			backers[bk.Char] = true
		}
	}
	if x := g.GoalOf(sr.Goal); x != nil {
		out.Filled, out.Pay = min(x.Total(), sr.Mark), x.Reward
		for _, p := range x.Progress {
			if p.N > 0 && g.Char(p.Key) != nil {
				backers[p.Key] = true
			}
		}
	}
	out.Backers, out.Mine = int64(len(backers)), viewer != "" && backers[viewer]
	return out
}

// factionName names a faction index, the keepers below 0.
func factionName(g *game.Game, i int) string {
	if i >= len(g.World.Factions) {
		return ""
	}
	return g.FactionName(i)
}

// sideWants is what a side asks for and of which tag, from its row.
func sideWants(g *game.Game, a *game.Arc, stage int, side string) (wants, tag string) {
	b := g.Rules().Book
	if a.Scope == arc.Settlement {
		if i := slices.IndexFunc(b.Troubles, func(t sheets.TroubleRow) bool { return t.ID == a.Template }); i >= 0 {
			return b.Troubles[i].Wants, b.Troubles[i].Tag
		}
		return "", ""
	}
	i := slices.IndexFunc(b.Arcs, func(r sheets.ArcRow) bool { return r.ID == a.Template })
	if i < 0 || stage >= len(b.Arcs[i].Stages) {
		return "", ""
	}
	for _, sd := range b.Arcs[i].Stages[stage].Sides {
		if sd.ID == side {
			return sd.Wants, sd.Tag
		}
	}
	return "", ""
}

// sideAtName is where a side is served, by name, and its tile when it
// is one place: a settlement, a tile, or the regions beats count in.
func sideAtName(g *game.Game, at string) (string, *api.Hex) {
	if n, ok := goal.SettlementOf(at); ok && n < len(g.Places) {
		h := g.SettlementHex(n)
		ah := apiHex(h)
		return g.PlaceName(h), &ah
	}
	if kind, id, ok := goal.ParseRef(at); ok && kind == goal.PlaceTile {
		if h, ok := hex.ParseRef(id); ok {
			ah := apiHex(h)
			return g.PlaceName(h), &ah
		}
	}
	var names []string
	for _, part := range strings.Split(at, ",") {
		kind, id, ok := goal.ParseRef(part)
		if !ok || kind != goal.PlaceRegion {
			continue
		}
		if r, ok := arc.RefIndex(fact.Ref{ID: id}); ok && r < len(g.World.Regions) {
			names = append(names, g.RegionName(r))
		}
	}
	return strings.Join(names, ", "), nil
}

// castName is the name a cast ref goes by; a character is named only to
// itself.
func castName(g *game.Game, ref fact.Ref, viewer string) string {
	i, indexed := arc.RefIndex(ref)
	switch ref.Kind {
	case kindFaction:
		if indexed {
			return factionName(g, i)
		}
	case kindRegion, kindHolding:
		if indexed && i < len(g.World.Regions) {
			return g.RegionName(i)
		}
	case kindSettlement:
		if indexed && i < len(g.Places) {
			return g.PlaceName(g.SettlementHex(i))
		}
	case kindTile:
		if h, ok := hex.ParseRef(ref.ID); ok {
			return g.PlaceName(h)
		}
	case kindNotable:
		for _, f := range g.World.Factions {
			for _, n := range f.Notables {
				if "n-"+strconv.Itoa(n.ID) == ref.ID {
					return strings.TrimSpace(n.Given + " " + n.Family)
				}
			}
		}
	case kindNPC:
		if n := g.NPCs.Get(ref.ID); n != nil {
			return n.Stub.Name
		}
	case kindCharacter:
		if ref.ID == viewer && viewer != "" {
			return charName(g, ref.ID)
		}
	}
	return ""
}

// arcByID is an arc the story still holds.
func arcByID(g *game.Game, id string) *game.Arc {
	if g.Story == nil {
		return nil
	}
	i := slices.IndexFunc(g.Story.Arcs, func(a *game.Arc) bool { return a.ID == id })
	if i < 0 {
		return nil
	}
	return g.Story.Arcs[i]
}

// arcs are the open and lately ended arcs, the season, and the side goals
// the viewer backs. A personal thread is shown only to its character.
func (s *Server) arcs(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	c, ok := s.viewerOf(w, r)
	if !ok {
		return
	}
	viewer := ""
	if c != nil {
		viewer = c.C.ID
	}
	g := s.g
	out := api.Arcs{Season: apiSeason(g), Open: []api.Arc{}, Ended: []api.Arc{}, Backing: []string{}}
	if g.Story == nil {
		reply(w, http.StatusOK, out)
		return
	}
	for _, a := range g.Story.Arcs {
		if !shown(a, viewer) {
			continue
		}
		if a.Outcome == "" {
			out.Open = append(out.Open, apiArc(g, a, viewer))
		} else {
			out.Ended = append(out.Ended, apiArc(g, a, viewer))
		}
	}
	for _, bk := range g.Story.Backers {
		if a := arcByID(g, bk.Arc); viewer != "" && bk.Char == viewer && a != nil && a.Outcome == "" && !slices.Contains(out.Backing, bk.Goal) {
			out.Backing = append(out.Backing, bk.Goal)
		}
	}
	reply(w, http.StatusOK, out)
}

// operatorStory is the whole story as an operator reads it: every arc,
// the ring, and the pattern boards with their progress, never a solution.
func (s *Server) operatorStory(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	g := s.g
	out := api.StoryView{Season: apiSeason(g), Arcs: []api.Arc{}, Boards: []api.BoardView{}}
	st := g.Story
	if st == nil {
		reply(w, http.StatusOK, out)
		return
	}
	for _, a := range st.Arcs {
		out.Arcs = append(out.Arcs, apiArc(g, a, ""))
	}
	if st.Ring != nil {
		out.Ring = &api.RingView{Towers: apiHexes(st.Ring.Towers), Fell: apiHexes(st.Ring.Fell), Core: apiHex(st.Ring.Core), Open: st.Ring.Open != 0}
	}
	puzzles := g.Rules().Book.PatternPuzzles
	for _, b := range st.Patterns {
		v := api.BoardView{ID: b.ID, Rule: b.Rule, Points: apiHexes(b.Points), Marks: int64(len(b.P.Marks)), Solved: b.P.Done}
		if i := slices.IndexFunc(puzzles, func(p sheets.PatternPuzzle) bool { return p.ID == b.Rule }); i >= 0 {
			v.Kind = puzzles[i].Kind
		}
		out.Boards = append(out.Boards, v)
	}
	reply(w, http.StatusOK, out)
}

func apiHexes(hs []hex.Hex) []api.Hex {
	out := make([]api.Hex, len(hs))
	for i, h := range hs {
		out[i] = apiHex(h)
	}
	return out
}

// places are a server's guild places: those run by a guild any of its
// characters plays in, or by its own guild.
type places struct {
	n   []int64
	hex []hex.Hex
}

func serverPlaces(g *game.Game, server string) places {
	var out places
	if server == "" {
		return out
	}
	guilds := map[string]bool{}
	if gd := g.ServerGuild(server); gd != nil {
		guilds[gd.G.ID] = true
	}
	for _, c := range g.Chars {
		if c.Server == server && c.C.Guild != "" {
			guilds[c.C.Guild] = true
		}
	}
	for n, p := range g.Places {
		if p.Guild != "" && guilds[p.Guild] {
			out.n, out.hex = append(out.n, int64(n)), append(out.hex, p.Hex)
		}
	}
	return out
}

// touches reports whether a fact names one of the places: as a subject,
// by its settlement datum, or by its tile.
func (ps places) touches(f fact.Fact) bool {
	for _, sub := range f.Subjects {
		if n, err := strconv.ParseInt(sub.ID, 10, 64); sub.Kind == kindSettlement && err == nil && slices.Contains(ps.n, n) {
			return true
		}
	}
	if d, ok := f.Get("settlement"); ok && slices.Contains(ps.n, d.N) {
		return true
	}
	h, ok := fact.HexOf(f)
	return ok && slices.Contains(ps.hex, h)
}

// unseen reports whether a fact is kept from a viewer: a pin's, or
// another character's thread.
func unseen(f fact.Fact, viewer string) bool {
	if sheets.PinFact(f.Kind) {
		return true
	}
	return game.ThreadFact(f.Kind) && (viewer == "" || !slices.Contains(f.Subjects, char.Ref(viewer)))
}

// scrub is a fact as a viewer may read it, under the lock: the other
// characters it names go, from its subjects and from its data.
func scrub(g *game.Game, viewer string, f fact.Fact) api.Fact {
	out := SeenFacts(viewer, apiFacts([]fact.Fact{f}))[0]
	out.Data = slices.DeleteFunc(out.Data, func(d api.Datum) bool { return d.S != "" && d.S != viewer && g.Char(d.S) != nil })
	return out
}

// chronicle is one closed world day for a server (GDD 12.7): the heaviest
// facts, those touching its guild places first, then by weight, then the
// newest, cut at chronicle-lines with how many more there were. A line
// names no character. The day defaults to the last closed one.
func (s *Server) chronicle(w http.ResponseWriter, r *http.Request) {
	var cur, weight, most int64
	var ps places
	var season api.Season
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	c, ok := s.viewerOf(w, r)
	if !ok {
		unlock()
		return
	}
	server := r.URL.Query().Get("server")
	if c != nil {
		server = c.Server
	}
	g := s.g
	cur, season, ps = g.Tick()/sheets.TicksPerDay, apiSeason(g), serverPlaces(g, server)
	weight = sheets.IntParam(g.Rules().Book.StoryParams, "chronicle-min-weight")
	most = sheets.IntParam(g.Rules().Book.StoryParams, "chronicle-lines")
	unlock()

	day := cur - 1
	if q := r.URL.Query().Get("day"); q != "" {
		n, err := strconv.ParseInt(q, 10, 64)
		if err != nil {
			refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "day is a world day"})
			return
		}
		day = n
	}
	if day < 0 || day >= cur {
		refuse(w, http.StatusNotFound, api.Refusal{Code: api.CodeNotFound, Message: fmt.Sprintf("world day %d has not closed", day)})
		return
	}
	facts, err := s.st.ChronicleDay(r.Context(), day*sheets.TicksPerDay, (day+1)*sheets.TicksPerDay, weight)
	if err != nil {
		s.internal(w, err)
		return
	}
	facts = slices.DeleteFunc(facts, func(f fact.Fact) bool { return unseen(f, "") })
	here := make(map[fact.ID]bool, len(facts))
	for _, f := range facts {
		here[f.ID] = ps.touches(f)
	}
	slices.SortStableFunc(facts, func(a, b fact.Fact) int {
		if here[a.ID] != here[b.ID] {
			if here[a.ID] {
				return -1
			}
			return 1
		}
		return 0
	})
	out := api.Chronicle{Season: season, Day: day, Lines: []api.ChronicleLine{}, More: max(0, int64(len(facts))-most), Earlier: []int64{}}
	facts = facts[:min(int64(len(facts)), most)]
	for d := day - 1; d >= max(0, day-chronicleEarlier); d-- {
		out.Earlier = append(out.Earlier, d)
	}
	if unlock, ok = s.hold(r.Context(), w, true); !ok {
		return
	}
	defer unlock()
	for _, f := range facts {
		out.Lines = append(out.Lines, api.ChronicleLine{Fact: scrub(s.g, "", f), Here: here[f.ID], Causes: int64(len(f.Causes))})
	}
	reply(w, http.StatusOK, out)
}

// chronicleFact is a fact with its causes one level deep; a cause opens
// the same way. A pin's fact and another character's thread are not found.
func (s *Server) chronicleFact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if err != nil || id <= 0 {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "id is a fact id"})
		return
	}
	viewer := ""
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	c, ok := s.viewerOf(w, r)
	if c != nil {
		viewer = c.C.ID
	}
	unlock()
	if !ok {
		return
	}
	f, causes, err := s.st.FactCauses(r.Context(), fact.ID(id))
	if errors.Is(err, store.ErrNoFact) || err == nil && unseen(f, viewer) {
		refuse(w, http.StatusNotFound, api.Refusal{Code: api.CodeNotFound, Message: fmt.Sprintf("no fact %d", id)})
		return
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	if unlock, ok = s.hold(r.Context(), w, true); !ok {
		return
	}
	defer unlock()
	out := api.FactCauses{Fact: scrub(s.g, viewer, f), Causes: []api.Fact{}}
	for _, x := range causes {
		if !unseen(x, viewer) {
			out.Causes = append(out.Causes, scrub(s.g, viewer, x))
		}
	}
	reply(w, http.StatusOK, out)
}

// storyEvents are the facts of the events channel after a fact id, each
// with its arc or trouble as the game holds it now. Last is the id to ask
// after next.
func (s *Server) storyEvents(w http.ResponseWriter, r *http.Request) {
	var after int64
	if q := r.URL.Query().Get("after"); q != "" {
		n, err := strconv.ParseInt(q, 10, 64)
		if err != nil || n < 0 {
			refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "after is a fact id"})
			return
		}
		after = n
	}
	facts, err := s.st.StoryFactsSince(r.Context(), api.EventKinds, fact.ID(after), eventsMost)
	if err != nil {
		s.internal(w, err)
		return
	}
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	g := s.g
	out := api.StoryEvents{Events: []api.StoryEvent{}, Last: after}
	for _, f := range facts {
		out.Last = max(out.Last, int64(f.ID))
		if unseen(f, "") {
			continue
		}
		out.Events = append(out.Events, storyEvent(g, f))
	}
	reply(w, http.StatusOK, out)
}

// storyEvent is one fact for the events channel with its snapshot: a
// trouble's, or an arc's that is not a personal thread.
func storyEvent(g *game.Game, f fact.Fact) api.StoryEvent {
	ev := api.StoryEvent{Fact: scrub(g, "", f)}
	if d, ok := f.Get("arc"); ok {
		if a := arcByID(g, d.S); a != nil && a.Scope == arc.Settlement {
			ev.Trouble = troubleView(g, a)
			wants, _ := sideWants(g, a, 0, "")
			ev.Alarm = f.Kind == "trouble.started" && wants == arc.WantDefence
		} else if a != nil && shown(a, "") {
			v := apiArc(g, a, "")
			ev.Arc = &v
		}
	}
	n := int64(-1)
	if d, ok := f.Get("settlement"); ok {
		n = d.N
	}
	for _, sub := range f.Subjects {
		if v, err := strconv.ParseInt(sub.ID, 10, 64); n < 0 && sub.Kind == kindSettlement && err == nil {
			n = v
		}
	}
	if n >= 0 && n < int64(len(g.Places)) {
		ev.Place = g.PlaceName(g.SettlementHex(int(n)))
	}
	return ev
}
