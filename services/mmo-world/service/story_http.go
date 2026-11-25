package service

import (
	"cmp"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/render"
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
	kindLegend     = arc.LegendRef("").Kind
	kindCaravan    = arc.CaravanRef("").Kind
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
	i, st, ok := currentStage(a)
	if !ok {
		return out
	}
	out.Stage, out.Due = int64(i), st.Due
	if c, _, ok := g.Season(); ok {
		out.DueDay = c.Day(st.Due / sheets.TicksPerDay)
	}
	for _, sr := range st.Sides {
		out.Sides = append(out.Sides, apiSide(g, a, i, sr, viewer))
	}
	if a.Scope == arc.Settlement {
		out.Trouble = troubleView(g, a)
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

// currentStage is the stage an arc stands at or ended on.
func currentStage(a *game.Arc) (int, game.StageRun, bool) {
	if len(a.Stages) == 0 {
		return 0, game.StageRun{}, false
	}
	i := min(max(a.Stage, 0), len(a.Stages)-1)
	return i, a.Stages[i], true
}

// apiSide is one side of a stage: how full its mark is, who backs it, and
// what it pays.
func apiSide(g *game.Game, a *game.Arc, stage int, sr game.SideRun, viewer string) api.Side {
	row, _ := g.SideRow(a, stage, sr.Side)
	out := api.Side{ID: sr.Side, Title: cmp.Or(g.Rules().Name("story.sides:"+sr.Side), sr.Side), Wants: row.Wants, Tag: row.Tag, Goal: sr.Goal,
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
				out.Contributors++
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

// sideAtName is where a side is served, by name, and its tile when it
// is one place: a settlement, a tile, or the regions beats count in.
func sideAtName(g *game.Game, at string) (string, *api.Hex) {
	if h, ok := g.RefHex(at); ok {
		ah := apiHex(h)
		return g.PlaceName(h), &ah
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
		return g.NotableName(ref.ID)
	case kindNPC:
		if n := g.NPCs.Get(ref.ID); n != nil {
			return n.Stub.Name
		}
	case kindCharacter:
		if ref.ID == viewer && viewer != "" {
			return charName(g, ref.ID)
		}
	case kindLegend:
		if g.Emergence != nil {
			return g.Emergence.Shown(ref.ID)
		}
	case kindCaravan:
		if g.Emergence != nil {
			route, _, _ := strings.Cut(ref.ID, caravanSep)
			return g.Emergence.Shown(route)
		}
	}
	return ""
}

// settlementData are the data keys, besides "settlement", that name a settlement in a fact, by fact kind.
var settlementData = map[string][]string{
	"caravan.departed": {"from", "to"}, "caravan.arrived": {"from", "to"}, "caravan.robbed": {"from", "to"}, "caravan.lost": {"from", "to"},
	game.FactPromotion: {"a", "b"}, "den.moved": {"from", "to"},
}

// nameFacts adds to names what the facts' refs are called to viewer, keyed
// "kind:id" as the bot keys them: each subject, the region, and the
// settlements and region the data name. A ref the world gives no name to
// is left out, so with no viewer a character never is.
func nameFacts(g *game.Game, viewer string, names map[string]string, fs ...api.Fact) {
	add := func(kind, id string) {
		if n := castName(g, fact.Ref{Kind: kind, ID: id}, viewer); n != "" {
			names[kind+":"+id] = n
		}
	}
	for _, f := range fs {
		for _, sub := range f.Subjects {
			add(sub.Kind, sub.ID)
		}
		if f.Region != "" {
			add(kindRegion, f.Region)
		}
		for _, d := range f.Data {
			switch {
			case d.Key == kindRegion && d.S != "":
				add(kindRegion, d.S)
			case (d.Key == kindSettlement || slices.Contains(settlementData[f.Kind], d.Key)) && d.N >= 0:
				add(kindSettlement, strconv.FormatInt(d.N, 10))
			}
		}
	}
}

// factNames are nameFacts' names as a new map, masked for a server, nil
// when there are none.
func factNames(g *game.Game, viewer, server string, fs ...api.Fact) map[string]string {
	names := map[string]string{}
	nameFacts(g, viewer, names, fs...)
	if len(names) == 0 {
		return nil
	}
	maskNames(g, server, names)
	return names
}

// otherServers reports whether a fact is staging by a server other than
// server (GDD 14.5).
func otherServers(f fact.Fact, server string) bool {
	by := game.StampedServer(f)
	return by != "" && by != server
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
	reply(w, http.StatusOK, apiArcs(s.g, viewer))
}

// apiArcs are the arcs a viewer may see, and the side goals it backs.
func apiArcs(g *game.Game, viewer string) api.Arcs {
	out := api.Arcs{Season: apiSeason(g), Open: []api.Arc{}, Ended: []api.Arc{}, Backing: []string{}}
	if g.Story == nil {
		return out
	}
	for _, a := range g.Story.Arcs {
		if !game.ArcVisible(a, viewer) {
			continue
		}
		if a.Outcome == "" {
			out.Open = append(out.Open, apiArc(g, a, viewer))
		} else {
			out.Ended = append(out.Ended, apiArc(g, a, viewer))
		}
	}
	for _, bk := range g.Story.Backers {
		if a := g.ArcByID(bk.Arc); viewer != "" && bk.Char == viewer && a != nil && a.Outcome == "" && !slices.Contains(out.Backing, bk.Goal) {
			out.Backing = append(out.Backing, bk.Goal)
		}
	}
	return out
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
	weight, most = g.Rules().Story.ChronicleMinWeight, g.Rules().Story.ChronicleLines
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
	facts = slices.DeleteFunc(facts, func(f fact.Fact) bool { return !game.Visible("", f.Kind, f.Subjects) || otherServers(f, server) })
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
	out := api.Chronicle{Season: season, Day: day, Lines: []api.ChronicleLine{}, Earlier: []int64{}}
	for d := day - 1; d >= max(0, day-chronicleEarlier); d-- {
		out.Earlier = append(out.Earlier, d)
	}
	if unlock, ok = s.hold(r.Context(), w, true); !ok {
		return
	}
	defer unlock()
	shown := facts[:0]
	for _, f := range facts {
		v, ok := seen(s.g, "", apiFact(f))
		if !ok {
			continue
		}
		shown = append(shown, f)
		if int64(len(out.Lines)) < most {
			out.Lines = append(out.Lines, api.ChronicleLine{Fact: maskFact(s.g, server, v), Here: here[f.ID], Causes: int64(len(f.Causes))})
		}
	}
	out.More = max(0, int64(len(shown))-most)
	facts = shown[:min(int64(len(shown)), most)]
	lines := make([]api.Fact, len(out.Lines))
	for i, l := range out.Lines {
		lines[i] = l.Fact
	}
	out.Names = factNames(s.g, "", server, lines...)
	out.Cover = coverOf(facts)
	reply(w, http.StatusOK, out)
}

// coverOf is a chronicle's cover: the art of its heaviest line, the first
// on a tie, or the day's when it has none.
func coverOf(lines []fact.Fact) *api.Art {
	if len(lines) == 0 {
		return artOf(render.SlotDay)
	}
	top := lines[0]
	for _, f := range lines[1:] {
		if f.Weight > top.Weight {
			top = f
		}
	}
	return artOf(factSlot(top))
}

// factSlot is the art slot of a fact, from its kind and the template,
// trouble or occasion it names; a stage's or an arc's end asks by whether
// it lapsed.
func factSlot(f fact.Fact) string {
	tpl := ""
	for _, k := range []string{"template", "occasion"} {
		if d, ok := f.Get(k); ok && d.S != "" {
			tpl = d.S
			break
		}
	}
	if f.Kind == "arc.stage-ended" || f.Kind == "arc.ended" {
		if d, ok := f.Get("lapsed"); ok && d.N != 0 {
			tpl = render.Lapsed
		}
	}
	return render.SlotFor(f.Kind, tpl)
}

// artOf is a slot's art as the wire carries it; nil without the kit.
func artOf(slot string) *api.Art {
	keys, _ := artTable()
	if keys == nil {
		return nil
	}
	return &api.Art{Key: keys[slot], Slot: slot}
}

// artTable is every slot's media key and every key's slot for the default
// kit; nil when the kit does not load.
var artTable = sync.OnceValues(func() (keys, slots map[string]string) {
	kit, err := render.DefaultKit()
	if err != nil {
		return nil, nil
	}
	keys, slots = map[string]string{}, map[string]string{}
	for _, slot := range render.Slots {
		k, _ := pictureKey(artKind, render.ArtInput{Slot: slot, Kit: kit.Digest}) // two strings always marshal
		keys[slot], slots[k] = k, slot
	}
	return keys, slots
})

// chronicleFact is a fact with its causes one level deep; a cause opens
// the same way. A pin's fact and another character's thread are not found.
func (s *Server) chronicleFact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if err != nil || id <= 0 {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "id is a fact id"})
		return
	}
	viewer, made, server := "", false, r.URL.Query().Get("server")
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	c, ok := s.viewerOf(w, r)
	if c != nil {
		viewer, made, server = c.C.ID, char.IsMade(c.C), c.Server
	}
	unlock()
	if !ok {
		return
	}
	missing := func() {
		refuse(w, http.StatusNotFound, api.Refusal{Code: api.CodeNotFound, Message: fmt.Sprintf("no fact %d", id)})
	}
	f, causes, err := s.st.FactCauses(r.Context(), fact.ID(id))
	if errors.Is(err, store.ErrNoFact) || err == nil && (!game.VisibleTo(viewer, made, f.Kind, f.Subjects) || otherServers(f, server)) {
		missing()
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
	top, ok := seen(s.g, viewer, apiFact(f))
	if !ok {
		missing()
		return
	}
	out := api.FactCauses{Fact: maskFact(s.g, server, top), Causes: []api.Fact{}}
	for _, x := range causes {
		if v, ok := seen(s.g, viewer, apiFact(x)); ok && !otherServers(x, server) {
			out.Causes = append(out.Causes, maskFact(s.g, server, v))
		}
	}
	out.Names = factNames(s.g, "", server, append([]api.Fact{top}, out.Causes...)...)
	reply(w, http.StatusOK, out)
}

// storyEvents are the facts of the events channel after a fact id, each
// with its arc or trouble as the game holds it now, and the server whose
// staging it is. Named for a server, they are masked for it and leave out
// other servers' staging. Last is the id to ask after next.
func (s *Server) storyEvents(w http.ResponseWriter, r *http.Request) {
	server := r.URL.Query().Get("server")
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
		if server != "" && otherServers(f, server) {
			continue
		}
		if ev, ok := storyEvent(g, f, server); ok {
			out.Events = append(out.Events, ev)
		}
	}
	reply(w, http.StatusOK, out)
}

// storyEvent is one fact for the events channel with its snapshot: a
// trouble's, an arc's that is not a personal thread, or the promotion it
// names, masked for a server. False for a fact the public may not read.
func storyEvent(g *game.Game, f fact.Fact, server string) (api.StoryEvent, bool) {
	v, ok := seen(g, "", apiFact(f))
	if !ok {
		return api.StoryEvent{}, false
	}
	v = maskFact(g, server, v)
	ev := api.StoryEvent{Fact: v, Promotion: promotionOf(g, f), Names: factNames(g, "", server, v), Art: artOf(factSlot(f)),
		Server: game.StampedServer(f)}
	if d, ok := f.Get("arc"); ok {
		if a := g.ArcByID(d.S); a != nil && a.Scope == arc.Settlement {
			ev.Trouble = troubleView(g, a)
			tr := g.TroubleRow(a)
			ev.Alarm = f.Kind == "trouble.started" && tr != nil && tr.Wants == arc.WantDefence
		} else if a != nil && game.ArcVisible(a, "") {
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
		ev.Place = shownPlace(g, server, g.SettlementHex(int(n)))
	}
	return ev, true
}
