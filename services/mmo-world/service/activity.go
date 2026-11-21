package service

import (
	"context"
	"slices"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
)

// listeners are told which characters a write changed, so the Activity
// can send their viewers a new state.
type listeners struct {
	mu sync.Mutex
	fs []func(characterIDs []string)
}

func (l *listeners) add(f func([]string)) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fs = append(l.fs, f)
}

// tell names the characters changed; nil is anyone.
func (l *listeners) tell(ids []string) {
	l.mu.Lock()
	fs := l.fs
	l.mu.Unlock()
	for _, f := range fs {
		f(ids)
	}
}

// told are the character a command acted for and the others it changed.
func told(res game.Result) []string {
	out := []string{res.Char.C.ID}
	for _, id := range res.Moved {
		if !slices.Contains(out, id) {
			out = append(out, id)
		}
	}
	return out
}

func apiViewer(v api.Viewer) game.Viewer {
	return game.Viewer{Compact: v.Compact, Family: v.Family, Level: v.Level, Pouch: v.Pouch}
}

// due is a character's countdown as whoever must end it reads it; Due is 0
// when none is running.
func due(g *game.Game, c *game.Char) api.ArmedMachine {
	out := api.ArmedMachine{CharacterID: c.C.ID}
	if a := c.Armed; a != nil {
		out.ArmedAt, out.Due = a.At, g.MachineDue(a)
	}
	return out
}

// armed are the countdowns running in a game.
func armed(g *game.Game) []api.ArmedMachine {
	out := []api.ArmedMachine{}
	for _, c := range g.ArmedAll() {
		out = append(out, due(g, c))
	}
	return out
}

// CharacterOf is the character a Discord user plays, or "".
func (s *Server) CharacterOf(ctx context.Context, discordID string) (string, error) {
	return s.st.CharacterOf(ctx, discordID)
}

// View is one character's state as its owner may see it; ok is false when
// the character is gone.
func (s *Server) View(ctx context.Context, characterID string, v api.Viewer) (api.ActivityState, bool, error) {
	unlock, err := s.take(ctx, true)
	if err != nil {
		return api.ActivityState{}, false, err
	}
	defer unlock()
	c := s.g.Char(characterID)
	if c == nil {
		return api.ActivityState{}, false, nil
	}
	return Filter(s.g, c, v, s.cfg.Now()), true, nil
}

// Act applies a player's request as POST /v1/actions does. check is false
// only for a write the service itself makes for a character, which names
// no row version.
func (s *Server) Act(ctx context.Context, req api.ActionRequest, check bool) (api.ActionReply, *api.Refusal, error) {
	cmd, ref, _ := playerCommand(req)
	if ref != nil {
		return api.ActionReply{}, ref, nil
	}
	ctx, cancel := writeContext(ctx)
	defer cancel()
	out, err := s.do(ctx, cmd, req.DiscordID, req.Version, check)
	if err != nil {
		return api.ActionReply{}, nil, err
	}
	if out.ref != nil {
		return api.ActionReply{}, out.ref, nil
	}
	rep, err := decodeReply(out.body, out.dup)
	return rep, nil, err
}

// Armed are the countdowns running, for whoever must end them.
func (s *Server) Armed(ctx context.Context) ([]api.ArmedMachine, error) {
	unlock, err := s.take(ctx, true)
	if err != nil {
		return nil, err
	}
	defer unlock()
	return armed(s.g), nil
}

// Countdown is one character's countdown, with Due 0 when none is running;
// ok is false when the character is gone.
func (s *Server) Countdown(ctx context.Context, characterID string) (api.ArmedMachine, bool, error) {
	unlock, err := s.take(ctx, true)
	if err != nil {
		return api.ArmedMachine{}, false, err
	}
	defer unlock()
	c := s.g.Char(characterID)
	if c == nil {
		return api.ArmedMachine{}, false, nil
	}
	return due(s.g, c), true, nil
}

// Subscribe has f told which characters each saved command changed, and
// nil after a tick, a reload or a reset. f is called with the world held:
// it must not block, and must not call back into the server.
func (s *Server) Subscribe(f func(characterIDs []string)) { s.subs.add(f) }

// LocalHost is a Local as the Activity's gateway sees a world.
type LocalHost struct{ l *Local }

// Host is the local game as the Activity's gateway sees a world.
func (l *Local) Host() LocalHost { return LocalHost{l} }

func (h LocalHost) CharacterOf(ctx context.Context, discordID string) (string, error) {
	return h.l.mem.CharacterOf(ctx, discordID)
}

func (h LocalHost) View(_ context.Context, characterID string, v api.Viewer) (api.ActivityState, bool, error) {
	if err := h.l.check(); err != nil {
		return api.ActivityState{}, false, err
	}
	c := h.l.G.Char(characterID)
	if c == nil {
		return api.ActivityState{}, false, nil
	}
	return Filter(h.l.G, c, v, h.l.now()), true, nil
}

func (h LocalHost) Act(ctx context.Context, req api.ActionRequest, check bool) (api.ActionReply, *api.Refusal, error) {
	return h.l.act(ctx, req, check)
}

func (h LocalHost) Armed(context.Context) ([]api.ArmedMachine, error) {
	if err := h.l.check(); err != nil {
		return nil, err
	}
	return armed(h.l.G), nil
}

func (h LocalHost) Countdown(_ context.Context, characterID string) (api.ArmedMachine, bool, error) {
	if err := h.l.check(); err != nil {
		return api.ArmedMachine{}, false, err
	}
	c := h.l.G.Char(characterID)
	if c == nil {
		return api.ArmedMachine{}, false, nil
	}
	return due(h.l.G, c), true, nil
}

func (h LocalHost) Subscribe(f func(characterIDs []string)) { h.l.subs.add(f) }
