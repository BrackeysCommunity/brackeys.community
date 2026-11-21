package service

import (
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/puzzle"
)

// Sees reports whether a viewer may be shown a tile at all: the one it
// stands on, and any tile somebody has found. Undiscovered tiles are
// never returned, on any layer.
func Sees(g *game.Game, viewer *game.Char, h hex.Hex) bool { return viewer.C.At == h || found(g, h) }

// found reports whether somebody has discovered a tile.
func found(g *game.Game, h hex.Hex) bool {
	st := g.World.Tile(h)
	return st != nil && st.Discovered != nil
}

// Filter is everything one character's owner may be shown: the one rule
// for what a viewer sees, for the Activity and for the map. It names no
// other character but its party's members, a hunt's pressers and those
// down on its floor, and nothing a machine is generated from: no place,
// no attempt, no key, no other seat's part and no other member's pick.
// passed is the armedAt of the machine whose move the viewer already
// passed on.
func Filter(g *game.Game, c *game.Char, v api.Viewer, passed int64, now time.Time) api.ActivityState {
	h := c.C.At
	st := api.ActivityState{Tick: g.Tick(), Context: contextOf(g, c), Character: apiCharacter(g, c),
		Place: api.ActivityHere{Tile: tileView(g, h), Name: g.PlaceName(h)}}
	if !now.IsZero() {
		st.Now = now.UnixMilli()
	}
	for _, o := range g.Chars {
		if o.C.At == h {
			st.Place.Busy++
		}
	}
	st.Fight = apiFight(g, c, g.Choose(c).Fight)
	if sh := g.SharedOf(c); sh != nil {
		st.Machine = partyMachineView(g, c, sh)
	}
	if st.Machine == nil && (c.Fight == nil || c.Fight.Shared == "") {
		if rig, ok := g.Rig(c, apiViewer(v)); ok {
			st.Machine = machineView(g, c, rig, passed)
		}
	}
	seeParty(g, c, &st)
	if b, ok := g.BenchFor(c); ok {
		st.Bench = benchView(g, c, b)
	}
	for i := range c.Pouches {
		p := &c.Pouches[i]
		st.Pouches = append(st.Pouches, api.PouchView{ID: p.ID, Family: p.Family, Name: familyName(g, p.Family), Goods: apiGoods(p.Goods),
			Locked: g.PouchLocked(c, p)})
	}
	if l := c.LastMachine; l != nil {
		st.Last = &api.MachineDone{Source: l.Source, Family: l.Family, Level: l.Level, Tick: l.Tick, Result: *apiResult(&l.Result)}
	}
	return st
}

// SeenFacts are a reply's facts as one viewer may read them: each fact
// stays, and the other characters it names go.
func SeenFacts(viewer string, facts []api.Fact) []api.Fact {
	out := make([]api.Fact, len(facts))
	for i, f := range facts {
		out[i] = f
		out[i].Subjects = []api.Ref{}
		for _, s := range f.Subjects {
			if s.Kind != "character" || s.ID == viewer {
				out[i].Subjects = append(out[i].Subjects, s)
			}
		}
	}
	return out
}

func familyName(g *game.Game, family string) string {
	if n := g.Rules().Name("puzzles.families:" + family); n != "" {
		return n
	}
	return family
}

// practiceLine is a practice as a card states it; a mastered family
// carries its title.
func practiceLine(g *game.Game, c *game.Char, family string) api.PracticeLine {
	sk := c.C.PracticeOf(family)
	out := api.PracticeLine{Level: sk.Level, Uses: sk.Uses, Need: g.PracticeNeed(sk.Level)}
	if g.Master(c, family) {
		out.Title = g.Rules().Name("puzzles.titles:" + family)
	}
	return out
}

// machineView is a rig as its viewer may be shown it: the level,
// countdown, why and haywire show once armed, at a bench, or with the
// preview. A master may pass one move (the first hint, else the guide) per
// armed machine; passed is the armedAt of the one already passed on.
func machineView(g *game.Game, c *game.Char, rig game.Rig, passed int64) *api.MachineView {
	family := rig.Spec.Family
	m := &api.MachineView{Source: rig.Source, Pouch: rig.Pouch, Family: family, Name: familyName(g, family), Layout: apiLayout(rig.Layout),
		Compact: rig.Spec.Compact, Intro: rig.Intro, Preview: rig.Gifts.Preview, MaxPlay: rig.MaxPlay, Locked: rig.Locked,
		Practice: practiceLine(g, c, family)}
	if rig.Inner != nil {
		in := apiLayout(*rig.Inner)
		m.Inner = &in
	}
	if rig.Armed != nil || rig.Source == game.SourceBench || rig.Gifts.Preview {
		m.Level, m.Countdown = rig.Spec.Level, rig.Countdown
		for _, w := range rig.Why {
			m.Why = append(m.Why, api.Reason{Label: w.Label, Value: w.Value, Unit: w.Unit})
		}
		m.Haywire = haywireLine(g, rig.Haywire)
	}
	if rig.Guide != nil {
		m.Guide = apiMove(*rig.Guide)
	}
	for _, x := range rig.Hints {
		m.Hints = append(m.Hints, *apiMove(x))
	}
	if a := rig.Armed; a != nil {
		m.Armed, m.ArmedAt, m.Deadline, m.Grace, m.Due = true, a.At, a.Deadline(), g.Puzzles().Grace(), g.MachineDue(a)
		if rig.Pass != nil && passed != a.At {
			m.Pass, m.CanPass = apiMove(*rig.Pass), true
		}
	}
	return m
}

// haywireLine is a haywire row as a viewer reads it. A row that puts a
// state on says whether the state counts beats or lasts the encounter.
func haywireLine(g *game.Game, id string) *api.HaywireLine {
	row := g.Puzzles().HaywireRow(id)
	if row == nil {
		return nil
	}
	name := g.Rules().Name("puzzles.haywire:" + row.ID)
	if name == "" {
		name = row.ID
	}
	unit := row.Unit
	if row.Effect == puzzle.EffectShort {
		unit = api.UnitEncounter
		if g.HaywireBeats(row.ID) {
			unit = api.UnitBeats
		}
	}
	return &api.HaywireLine{ID: row.ID, Name: name, Magnitude: row.Magnitude, Unit: unit, Tag: row.Tag}
}

func benchView(g *game.Game, c *game.Char, b game.Bench) *api.BenchView {
	out := &api.BenchView{Settlement: g.PlaceName(g.SettlementHex(b.Settlement)), Families: []api.BenchFamily{}, Uses: b.Uses, UsesCap: b.UsesCap,
		Taken: b.Taken, TakenCap: b.TakenCap, Given: b.Given, GivenCap: b.GivenCap}
	for _, r := range g.BenchRigs(c, b) {
		out.Families = append(out.Families, api.BenchFamily{Family: r.Family, Name: familyName(g, r.Family), Practice: practiceLine(g, c, r.Family),
			MaxLevel: r.MaxLevel, Lessons: r.Lessons, Master: r.Master})
	}
	return out
}

func apiMove(m puzzle.Move) *api.PuzzleMove {
	return &api.PuzzleMove{At: m.At, A: m.A, B: m.B, C: m.C, Seat: m.Seat}
}

// LogOf is a move log as a client sends it.
func LogOf(l puzzle.Log) *api.PuzzleLog {
	out := &api.PuzzleLog{Moves: make([]api.PuzzleMove, len(l.Moves)), End: l.End}
	for i, m := range l.Moves {
		out.Moves[i] = *apiMove(m)
	}
	return out
}

// simLog is a client's move log as the rules replay it.
func simLog(l *api.PuzzleLog) *puzzle.Log {
	if l == nil {
		return nil
	}
	out := &puzzle.Log{Moves: make([]puzzle.Move, len(l.Moves)), End: l.End}
	for i, m := range l.Moves {
		out.Moves[i] = puzzle.Move{At: m.At, A: m.A, B: m.B, C: m.C, Seat: m.Seat}
	}
	return out
}

// apiLayout is a machine as it is drawn: the layout without its level and
// tier. LayoutOf is its inverse; a field added to one is added to both.
func apiLayout(l puzzle.Layout) api.PuzzleLayout {
	out := api.PuzzleLayout{Family: l.Family, Size: l.Size, Decoys: l.Decoys, Target: l.Target, Glyph: l.Glyph, Order: l.Order, False: l.False,
		Turn: l.Turn, Walls: l.Walls, Tiles: l.Tiles, Start: l.Start, Goal: l.Goal, Range: l.Range, Step: l.Step, Par: l.Par, Init: l.Init, Track: l.Track,
		Shape: l.Shape, Party: l.Party, Seats: l.Seats, Window: l.Window, Pass: l.Pass, Key: l.Key, Code: l.Code}
	for _, c := range l.Clues {
		out.Clues = append(out.Clues, api.PuzzleClue{Before: c.Before, After: c.After})
	}
	return out
}

// LayoutOf is a drawn machine as the kit plays it: level and tier are not
// on the wire, and no replay reads them.
func LayoutOf(l api.PuzzleLayout) puzzle.Layout {
	out := puzzle.Layout{Family: l.Family, Size: l.Size, Decoys: l.Decoys, Target: l.Target, Glyph: l.Glyph, Order: l.Order, False: l.False,
		Turn: l.Turn, Walls: l.Walls, Tiles: l.Tiles, Start: l.Start, Goal: l.Goal, Range: l.Range, Step: l.Step, Par: l.Par, Init: l.Init, Track: l.Track,
		Shape: l.Shape, Party: l.Party, Seats: l.Seats, Window: l.Window, Pass: l.Pass, Key: l.Key, Code: l.Code}
	for _, c := range l.Clues {
		out.Clues = append(out.Clues, puzzle.Clue{Before: c.Before, After: c.After})
	}
	return out
}

func apiResult(r *puzzle.Result) *api.PuzzleResult {
	if r == nil {
		return nil
	}
	return &api.PuzzleResult{Solved: r.Solved, Clean: r.Clean, Master: r.Master, Late: r.Late, At: r.At, Haywire: r.Haywire}
}
