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

// window is Window on a held game.
func window(g *game.Game, sh *game.Shared) (api.OpenWindow, bool) {
	due := g.WindowDue(sh)
	if due == 0 {
		return api.OpenWindow{}, false
	}
	for _, m := range g.SeatsOf(sh) {
		if !m.Banned && m.Armed == nil {
			return api.OpenWindow{Shared: sh.ID, Character: m.C.ID, Opened: sh.Opened, Due: due}, true
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

// judge is Judge on a held game.
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

// seats is Seats on a held game.
func seats(g *game.Game, c *game.Char) (string, []string) {
	key := contextKey(contextOf(g, c))
	if sh := g.SharedOf(c); sh != nil {
		return key, seatsOf(g, sh)
	}
	return key, nil
}

func windowsIn(ctx context.Context, w held) ([]api.OpenWindow, error) {
	return inGame(ctx, w, windows)
}

func windowIn(ctx context.Context, w held, shared string) (out api.OpenWindow, ok bool, err error) {
	err = hold(ctx, w, func(g *game.Game) {
		if sh := g.SharedByID(shared); sh != nil {
			out, ok = window(g, sh)
		}
	})
	return out, ok, err
}

func judgeIn(ctx context.Context, w held, characterID string, log api.PuzzleLog) (string, error) {
	out, _, err := withChar(ctx, w, characterID, func(g *game.Game, c *game.Char) string { return judge(g, c, log) })
	return out, err
}

func seatsIn(ctx context.Context, w held, characterID string) (key string, ids []string, err error) {
	err = hold(ctx, w, func(g *game.Game) {
		if c := g.Char(characterID); c != nil {
			key, ids = seats(g, c)
		}
	})
	return key, ids, err
}

// Windows is the gateway Host's Windows, under the world's lock.
func (s *Server) Windows(ctx context.Context) ([]api.OpenWindow, error) { return windowsIn(ctx, s) }

// Window is the gateway Host's Window, under the world's lock.
func (s *Server) Window(ctx context.Context, shared string) (api.OpenWindow, bool, error) {
	return windowIn(ctx, s, shared)
}

// Judge is the gateway Host's Judge, under the world's lock.
func (s *Server) Judge(ctx context.Context, characterID string, log api.PuzzleLog) (string, error) {
	return judgeIn(ctx, s, characterID, log)
}

// Seats is the gateway Host's Seats, under the world's lock.
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
