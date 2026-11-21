package service

import (
	"context"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/puzzle"
)

// What Judge says of a merged log so far; "" when no party machine is
// armed.
const (
	judgeGoing = "going"
	judgeDone  = "done"
	judgeBroke = "broke"
)

// partyDue is a party machine's countdown as the gateway keeps it: one a
// context, ended by its first seat.
func partyDue(g *game.Game, sh *game.Shared) api.ArmedMachine {
	m := sh.Machine
	out := api.ArmedMachine{CharacterID: m.Seats[0], ArmedAt: m.At, Due: g.PartyDue(m)}
	if c := g.Char(m.Seats[0]); c != nil {
		out.Context = contextKey(contextOf(g, c))
	}
	return out
}

// armedShared is the armed party machine of a character's shared
// encounter or fork, or nil.
func armedShared(g *game.Game, c *game.Char) *game.Shared {
	sh := g.SharedOf(c)
	if sh == nil || !sh.Machine.Armed() {
		return nil
	}
	return sh
}

// window is a shared encounter's or fork's open pick window, sent by its
// first member present who may act; false when none is open or it waits
// on a machine.
func window(g *game.Game, sh *game.Shared) (api.OpenWindow, bool) {
	if sh.Opened == 0 || sh.Machine.Armed() {
		return api.OpenWindow{}, false
	}
	for _, m := range g.SeatsOf(sh) {
		if !m.Banned && m.Armed == nil {
			return api.OpenWindow{Shared: sh.ID, Character: m.C.ID, Opened: sh.Opened, Due: g.WindowDue(sh)}, true
		}
	}
	return api.OpenWindow{}, false
}

func windows(g *game.Game) []api.OpenWindow {
	out := []api.OpenWindow{}
	for _, sh := range g.OpenWindows() {
		if w, ok := window(g, sh); ok {
			out = append(out, w)
		}
	}
	return out
}

// judge replays a merged log against a character's party machine, with no
// countdown read and nothing written.
func judge(g *game.Game, c *game.Char, log api.PuzzleLog) string {
	sh := armedShared(g, c)
	if sh == nil {
		return ""
	}
	switch g.Puzzles().Probe(sh.Machine.Spec, *simLog(&log)) {
	case puzzle.Done:
		return judgeDone
	case puzzle.Broke:
		return judgeBroke
	case puzzle.Going:
	}
	return judgeGoing
}

// seats is the context a character is bound to and who must hold a seat
// bound to it before its party's machine arms: the machine's seats once
// armed, else those present at it; none outside a shared encounter or
// fork.
func seats(g *game.Game, c *game.Char) (string, []string) {
	key := contextKey(contextOf(g, c))
	if sh := g.SharedOf(c); sh != nil {
		return key, seatsOf(g, sh)
	}
	return key, nil
}

func windowsIn(ctx context.Context, w held) ([]api.OpenWindow, error) {
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	return windows(g), nil
}

func windowIn(ctx context.Context, w held, shared string) (api.OpenWindow, bool, error) {
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return api.OpenWindow{}, false, err
	}
	defer release()
	sh := g.SharedByID(shared)
	if sh == nil {
		return api.OpenWindow{}, false, nil
	}
	out, ok := window(g, sh)
	return out, ok, nil
}

func judgeIn(ctx context.Context, w held, characterID string, log api.PuzzleLog) (string, error) {
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return "", err
	}
	defer release()
	c := g.Char(characterID)
	if c == nil {
		return "", nil
	}
	return judge(g, c, log), nil
}

func seatsIn(ctx context.Context, w held, characterID string) (string, []string, error) {
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return "", nil, err
	}
	defer release()
	c := g.Char(characterID)
	if c == nil {
		return "", nil, nil
	}
	key, ids := seats(g, c)
	return key, ids, nil
}

// Windows are the pick windows open and not waiting on a machine, oldest
// first, each with the member who sends its party-window.
func (s *Server) Windows(ctx context.Context) ([]api.OpenWindow, error) { return windowsIn(ctx, s) }

// Window is one shared encounter's or fork's open window; ok is false when
// none is open or it waits on an armed machine.
func (s *Server) Window(ctx context.Context, shared string) (api.OpenWindow, bool, error) {
	return windowIn(ctx, s, shared)
}

// Judge replays a merged log so far against the armed machine of a
// character's party, writing nothing: "going", "done" or "broke", or ""
// when none is armed.
func (s *Server) Judge(ctx context.Context, characterID string, log api.PuzzleLog) (string, error) {
	return judgeIn(ctx, s, characterID, log)
}

// Seats is the context a character is bound to, as "<kind>:<id>", and who
// must hold a seat bound to it before its party's machine arms, in seat
// order: none outside a shared encounter or fork. A character who is gone
// has no context.
func (s *Server) Seats(ctx context.Context, characterID string) (string, []string, error) {
	return seatsIn(ctx, s, characterID)
}

func (h LocalHost) Windows(ctx context.Context) ([]api.OpenWindow, error) { return windowsIn(ctx, h) }

func (h LocalHost) Window(ctx context.Context, shared string) (api.OpenWindow, bool, error) {
	return windowIn(ctx, h, shared)
}

func (h LocalHost) Judge(ctx context.Context, characterID string, log api.PuzzleLog) (string, error) {
	return judgeIn(ctx, h, characterID, log)
}

func (h LocalHost) Seats(ctx context.Context, characterID string) (string, []string, error) {
	return seatsIn(ctx, h, characterID)
}
