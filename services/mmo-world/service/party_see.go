package service

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/party"
)

// structural: a share of a hunt's spoils is stated in percent, and a
// party member outside the shared encounter has no seat.
const (
	percent = 100
	noSeat  = -1
)

// contextOf is the context a character's seat is bound to (GDD 7.5): its
// party while it is in one, else a live hunt it stands in reach of, else
// its own. A watcher who is not in the party is in its own context, and
// nothing of the party reaches it.
func contextOf(g *game.Game, c *game.Char) api.Context {
	if p := g.PartyOf(c); p != nil {
		return api.Context{Kind: api.ContextParty, ID: p.ID}
	}
	if x := huntInReach(g, c); x != nil {
		return api.Context{Kind: api.ContextHunt, ID: x.H.ID}
	}
	return api.Context{Kind: api.ContextSolo, ID: c.C.ID}
}

// contextKey names a context in one string, as the gateway keys its
// merged logs.
func contextKey(x api.Context) string { return x.Kind + ":" + x.ID }

// huntInReach is the first live hunt a character could press from where
// it stands, or nil.
func huntInReach(g *game.Game, c *game.Char) *game.Hunt {
	for _, x := range g.LiveHunts() {
		if game.InReach(c, x) {
			return x
		}
	}
	return nil
}

// seatsOf are who would sit at a shared encounter's or fork's machine now:
// its seats once armed, else those present.
func seatsOf(g *game.Game, sh *game.Shared) []string {
	if sh.Machine.Armed() {
		return slices.Clone(sh.Machine.Seats)
	}
	var out []string
	for _, m := range g.SeatsOf(sh) {
		out = append(out, m.C.ID)
	}
	return out
}

// encounterIn is a member whose fight is the shared encounter while it
// runs, or nil.
func encounterIn(g *game.Game, sh *game.Shared) *game.Char {
	for _, id := range sh.Members {
		if m := g.Char(id); m != nil && m.Fight != nil && m.Fight.Shared == sh.ID && !m.Fight.E.Over {
			return m
		}
	}
	return nil
}

// partySharedOf is the party's shared encounter or fork the viewer is in,
// else any of the party's: whose picks the members' rows show.
func partySharedOf(g *game.Game, c *game.Char, p *party.Party) *game.Shared {
	if sh := g.SharedOf(c); sh != nil {
		return sh
	}
	for _, sh := range g.Shared {
		if sh.Party == p.ID {
			return sh
		}
	}
	return nil
}

// memberView is one party member as the viewer is shown them: where they
// are, and whether they have picked or chosen, never what.
func memberView(g *game.Game, viewer *game.Char, id string, sh *game.Shared, follows bool) api.PartyMember {
	out := api.PartyMember{Name: charName(g, id), You: id == viewer.C.ID, Seat: noSeat, Follows: follows}
	if m := g.Char(id); m != nil {
		out.Here = m.C.At == viewer.C.At && m.C.Floor == viewer.C.Floor
		out.Down, out.Floor = game.IsDown(m), m.C.Floor
	}
	if sh != nil {
		if i := slices.Index(sh.Members, id); i >= 0 {
			out.Seat = int64(i)
		}
		out.Picked = sh.PickOf(id) != ""
		if sh.Fork != nil {
			out.Picked = slices.ContainsFunc(sh.Fork.Choices, func(x game.Choice) bool { return x.Who == id })
		}
	}
	return out
}

// partyView is the viewer's party: its members by name, and the open beat
// with the viewer's own pick only.
func partyView(g *game.Game, c *game.Char, p *party.Party) *api.PartyView {
	sh := partySharedOf(g, c, p)
	out := &api.PartyView{ID: p.ID, Leader: p.Leader == c.C.ID, Members: []api.PartyMember{}}
	for _, m := range p.Members {
		out.Members = append(out.Members, memberView(g, c, m.ID, sh, m.Follows))
	}
	if sh != nil && slices.Contains(sh.Members, c.C.ID) {
		out.Beat = partyBeat(g, sh, c.C.ID)
		out.Last = lastBeat(g, sh)
	}
	return out
}

// lastBeat is the beat a shared encounter resolved last, every member's
// press shown alike.
func lastBeat(g *game.Game, sh *game.Shared) *api.PartyResult {
	if sh.Last == nil {
		return nil
	}
	out := &api.PartyResult{Beat: sh.Last.Beat, Pressed: []api.PartyPress{}}
	for _, p := range sh.Last.Pressed {
		out.Pressed = append(out.Pressed, api.PartyPress{Name: charName(g, p.Who), Option: p.Option.ID, Band: g.BandName(p.Option.Band),
			Success: p.Outcome.Success})
	}
	return out
}

// rivalView is the context racing a party's fork machine, by its leader.
func rivalView(g *game.Game, sh *game.Shared) *api.RivalView {
	o, at := g.RivalOf(sh)
	if o == nil {
		return nil
	}
	lead := ""
	if p := g.PartyByID(o.Party); p != nil {
		lead = p.Leader
	} else if len(o.Members) > 0 {
		lead = o.Members[0]
	}
	return &api.RivalView{Name: charName(g, lead), ArmedAt: at}
}

// partyBeat is a shared encounter's open beat and its window. mine names
// whose pick it carries; "" carries none.
func partyBeat(g *game.Game, sh *game.Shared, mine string) *api.PartyBeat {
	in := encounterIn(g, sh)
	if in == nil {
		return nil
	}
	e := in.Fight.E
	out := &api.PartyBeat{Beat: int64(e.At) + 1, Beats: int64(len(e.Beats)), Kind: e.Beats[e.At], Cautious: g.Rules().Fight.Cautious(),
		Waiting: sh.Machine.Armed(), Mine: sh.PickOf(mine)}
	for _, m := range g.UpIn(sh) {
		out.Present++
		if sh.PickOf(m.C.ID) != "" {
			out.Picked++
		}
	}
	if due := g.WindowDue(sh); due > 0 {
		out.Opened, out.Due = sh.Opened, due
	}
	return out
}

// fightParty is a shared encounter's members as the encounter's view
// lists them: names, seats and who has picked.
func fightParty(g *game.Game, c *game.Char, sh *game.Shared) []api.PartyMember {
	var follows map[string]bool
	if p := g.PartyByID(sh.Party); p != nil {
		follows = map[string]bool{}
		for _, m := range p.Members {
			follows[m.ID] = m.Follows
		}
	}
	out := []api.PartyMember{}
	for _, id := range sh.Members {
		out = append(out, memberView(g, c, id, sh, follows[id]))
	}
	return out
}

// floorView is the dungeon the viewer stands at or in: the floor, the
// deepest it has reached, never the count, and its fork with every choice
// in the open. A way's next floor shows only with Mapper, and the pool only
// with Hoard sense.
func floorView(g *game.Game, c *game.Char) *api.FloorView {
	d, ok := g.DungeonOf(c)
	if !ok {
		return nil
	}
	out := &api.FloorView{Dungeon: d.Dungeon, Name: d.Name, Kind: d.Kind, Up: d.Up, Floor: d.Floor, Deepest: d.Deepest, Bottom: d.Bottom,
		Haunted: d.Haunted}
	if len(d.Pool) > 0 {
		out.Pool = apiGoods(d.Pool)
	}
	for _, id := range d.Downed {
		out.Downed = append(out.Downed, charName(g, id))
	}
	if f := d.Fork; f != nil {
		out.Ways = waysView(g, f.Ways)
		out.Opened, out.Due = f.Opened, f.Due
		for _, x := range f.Choices {
			ch := api.ChoiceView{Name: charName(g, x.Who), Push: x.Push}
			if x.Push {
				ch.Way = game.WayOption(x.Way)
			}
			out.Choices = append(out.Choices, ch)
		}
	}
	return out
}

func waysView(g *game.Game, ways []game.WayRead) []api.WayView {
	out := []api.WayView{}
	for _, w := range ways {
		name := g.Rules().Name("map.forks:" + w.Fork)
		if name == "" {
			name = w.Fork
		}
		v := api.WayView{ID: game.WayOption(w.Way), Name: name, Tags: slices.Clone(w.Tags), Open: w.Open, Machine: w.Machine,
			Next: slices.Clone(w.Next), Votes: w.Votes}
		if v.Tags == nil {
			v.Tags = []string{}
		}
		out = append(out, v)
	}
	return out
}

func huntName(g *game.Game, row string) string {
	if n := g.Rules().Name("fights.hunts:" + row); n != "" {
		return n
	}
	return row
}

// huntSpoils are a hunts row's lines at the most each can roll.
func huntSpoils(g *game.Game, row string) []api.Goods {
	out := []api.Goods{}
	if h, ok := g.Rules().Fight.Hunt(row); ok {
		for _, s := range h.Spoils {
			out = append(out, api.Goods{Material: s.Material, Units: s.Quantity})
		}
	}
	return out
}

// pressers are everyone who has pressed a hunt, by health removed, most
// first; a press that removed nothing still counts its presser.
func pressers(g *game.Game, viewer string, x *game.Hunt) []api.HuntPresser {
	out := []api.HuntPresser{}
	var seen []string
	add := func(id string) {
		if !slices.Contains(seen, id) {
			seen = append(seen, id)
			out = append(out, api.HuntPresser{Name: charName(g, id), Removed: x.H.Removed.Get(id), You: id == viewer})
		}
	}
	for _, r := range x.H.Removed {
		add(r.Key)
	}
	for _, p := range x.Pressed {
		add(p.Key)
	}
	slices.SortStableFunc(out, func(a, b api.HuntPresser) int { return cmp.Compare(b.Removed, a.Removed) })
	return out
}

// canPress reports whether a character may press a hunt now: in reach,
// up and not down in it, in no encounter, and not yet this tick.
func canPress(g *game.Game, c *game.Char, x *game.Hunt) bool {
	h, tick := x.H, g.Tick()
	if h.Over || tick >= h.Ends || !game.InReach(c, x) || game.IsDown(c) || c.Banned || c.Fight != nil || c.Armed != nil ||
		slices.Contains(h.Down, c.C.ID) {
		return false
	}
	at, ok := x.PressedAt(c.C.ID)
	return !ok || at != tick
}

// huntView is a live hunt as one presser sees it: its health, everyone's
// part by name, the viewer's own share now, and the options it may press
// with.
func huntView(g *game.Game, c *game.Char, x *game.Hunt) *api.HuntView {
	h := x.H
	out := &api.HuntView{ID: h.ID, Name: huntName(g, h.Row), Creature: h.Creature.Archetype, Health: h.Health, Max: h.Max, Ends: h.Ends,
		EndsIn: max(0, h.Ends-g.Tick()), Pressers: pressers(g, c.C.ID, x), Mine: h.Removed.Get(c.C.ID), Spoils: huntSpoils(g, h.Row),
		CanPress: canPress(g, c, x)}
	if total := h.Removed.Sum(); total > 0 {
		out.Share = out.Mine * percent / total
	}
	if out.CanPress {
		_, opts := g.HuntOptions(c, x)
		for _, o := range opts {
			out.Options = append(out.Options, apiOption(g, o))
		}
	}
	return out
}

// restSource is the party machine a shared encounter or fork holds at
// rest for the viewer, and its family: a guardian mark's, a fork's still
// unworked, or the beat's.
func restSource(g *game.Game, c *game.Char, sh *game.Shared) (source, family string) {
	if m := sh.Machine; m != nil && m.Source == game.SourceGuardian {
		return game.SourceGuardian, m.Spec.Family
	}
	if sh.Fork != nil {
		if f := g.Fork(c); f != nil && !f.Worked {
			for _, w := range f.Ways {
				if w.Machine != "" && !w.Open {
					return game.SourceFork, w.Machine
				}
			}
		}
		return "", ""
	}
	if c.Fight == nil || c.Fight.Shared != sh.ID || g.MachineOn(c) == "" {
		return "", ""
	}
	if family, _, ok := g.Rules().Fight.Machine(c.Fight.E); ok {
		return game.SourceParty, family
	}
	return "", ""
}

// seatViews are a party machine's seats by name.
func seatViews(g *game.Game, c *game.Char, seats []string) []api.SeatView {
	out := []api.SeatView{}
	for i, id := range seats {
		out = append(out, api.SeatView{Seat: int64(i), Name: charName(g, id), You: id == c.C.ID})
	}
	return out
}

// partyMachineView is a party's machine as one seat may be shown it. At
// rest it names the machine and who would sit at it, with no layout: its
// version and size are fixed only when the first touch arms it. Armed, it
// carries the seat's dealt part alone, so a seat of a split kind never
// holds another's part (except the glimpse its practice buys). A member
// with no seat is shown no machine.
func partyMachineView(g *game.Game, c *game.Char, sh *game.Shared) *api.MachineView {
	if !sh.Machine.Armed() {
		source, family := restSource(g, c, sh)
		seats := seatsOf(g, sh)
		seat := slices.Index(seats, c.C.ID)
		if source == "" || seat < 0 {
			return nil
		}
		return &api.MachineView{Source: source, Family: family, Name: familyName(g, family), Layout: api.PuzzleLayout{Family: family},
			Practice: practiceLine(g, c, family), Seat: int64(seat), Seats: seatViews(g, c, seats)}
	}
	rig, ok := g.PartyRigOf(c)
	if !ok || rig.Seat < 0 {
		return nil
	}
	m, p := rig.Machine, g.Puzzles()
	spec := m.Spec
	out := &api.MachineView{Source: m.Source, Family: spec.Family, Name: familyName(g, spec.Family), Layout: apiLayout(rig.Layout),
		Level: spec.Level, Countdown: m.Countdown, Practice: practiceLine(g, c, spec.Family), Party: spec.Party, Seat: rig.Seat,
		Seats: seatViews(g, c, m.Seats), Movers: int64(len(sh.Movers)), Armed: true, ArmedAt: m.At, Deadline: m.Deadline(),
		Grace: p.Grace(), Due: g.PartyDue(m), Haywire: haywireLine(g, p.Haywire(spec.Family, spec.Where()))}
	for _, w := range p.CountdownParts(spec.Family, spec.Level, spec.Tier, m.Practice) {
		out.Why = append(out.Why, api.Reason{Label: w.Label, Value: w.Value, Unit: w.Unit})
	}
	if rig.Glimpse != nil {
		gl := apiLayout(*rig.Glimpse)
		out.Glimpse = &gl
	}
	out.Rival = rivalView(g, sh)
	if spec.Party == "" && len(m.Seats) == 1 && p.Gifts(c.C.Level(spec.Family)).Mastery {
		in := apiLayout(p.Inner(spec))
		out.Inner = &in
	}
	return out
}

// seeParty adds to a viewer's state what its party, its dungeon and a hunt
// in reach show it, and the party's machine in place of its own.
func seeParty(g *game.Game, c *game.Char, st *api.ActivityState) {
	if p := g.PartyOf(c); p != nil {
		st.Party = partyView(g, c, p)
	}
	st.Floor = floorView(g, c)
	if x := huntInReach(g, c); x != nil {
		st.Hunt = huntView(g, c, x)
	}
}
