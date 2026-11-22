package service

import (
	"context"
	"slices"
	"sync"
	"time"

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

// told are the character a command acted for (none for a world-level
// command), the others it changed, and those whose view it changed while
// their rows stayed.
func told(res game.Result) []string {
	out := []string{}
	if res.Char != nil {
		out = append(out, res.Char.C.ID)
	}
	for _, id := range slices.Concat(res.Moved, res.Seen) {
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
// when none is running. A seat at a party machine reads its context's
// countdown, which the first seat ends.
func due(g *game.Game, c *game.Char) api.ArmedMachine {
	out := api.ArmedMachine{CharacterID: c.C.ID}
	if a := c.Armed; a != nil {
		out.ArmedAt, out.Due = a.At, g.MachineDue(a)
	} else if sh := armedShared(g, c); sh != nil {
		out = partyDue(g, sh)
	}
	return out
}

// armed are the countdowns running in a game: each character's own, then
// one for each party machine.
func armed(g *game.Game) []api.ArmedMachine {
	out := []api.ArmedMachine{}
	for _, c := range g.ArmedAll() {
		out = append(out, due(g, c))
	}
	for _, sh := range g.ArmedParties() {
		out = append(out, partyDue(g, sh))
	}
	return out
}

// CharacterOf is the character a Discord user plays, or "".
func (s *Server) CharacterOf(ctx context.Context, discordID string) (string, error) {
	return s.st.CharacterOf(ctx, discordID)
}

// held is a world as the Activity's host reads it: the game under its
// lock or guard, and the clock a state is built on.
type held interface {
	holdGame(ctx context.Context) (g *game.Game, now time.Time, release func(), err error)
}

func (s *Server) holdGame(ctx context.Context) (*game.Game, time.Time, func(), error) {
	unlock, err := s.take(ctx, true)
	if err != nil {
		return nil, time.Time{}, nil, err
	}
	return s.g, s.cfg.Now(), unlock, nil
}

func (h LocalHost) holdGame(context.Context) (*game.Game, time.Time, func(), error) {
	if err := h.l.check(); err != nil {
		return nil, time.Time{}, nil, err
	}
	return h.l.G, h.l.now(), func() {}, nil
}

func viewIn(ctx context.Context, w held, characterID string, v api.Viewer, passed int64) (api.ActivityState, bool, error) {
	g, now, release, err := w.holdGame(ctx)
	if err != nil {
		return api.ActivityState{}, false, err
	}
	defer release()
	c := g.Char(characterID)
	if c == nil {
		return api.ActivityState{}, false, nil
	}
	return Filter(g, c, v, passed, now), true, nil
}

// inGame runs f on the held game.
func inGame[T any](ctx context.Context, w held, f func(*game.Game) T) (T, error) {
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		var zero T
		return zero, err
	}
	defer release()
	return f(g), nil
}

// hold runs f on the held game; f sets its caller's results.
func hold(ctx context.Context, w held, f func(*game.Game)) error {
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return err
	}
	defer release()
	f(g)
	return nil
}

// withChar runs f on the held game and a character; ok is false, and f not
// run, when the character is gone.
func withChar[T any](ctx context.Context, w held, id string, f func(*game.Game, *game.Char) T) (T, bool, error) {
	var zero T
	g, _, release, err := w.holdGame(ctx)
	if err != nil {
		return zero, false, err
	}
	defer release()
	c := g.Char(id)
	if c == nil {
		return zero, false, nil
	}
	return f(g, c), true, nil
}

func armedIn(ctx context.Context, w held) ([]api.ArmedMachine, error) {
	return inGame(ctx, w, armed)
}

func countdownIn(ctx context.Context, w held, characterID string) (api.ArmedMachine, bool, error) {
	return withChar(ctx, w, characterID, due)
}

// View is one character's state as its owner may see it; passed is the
// armedAt of the machine whose move they already passed on. ok is false
// when the character is gone.
func (s *Server) View(ctx context.Context, characterID string, v api.Viewer, passed int64) (api.ActivityState, bool, error) {
	return viewIn(ctx, s, characterID, v, passed)
}

// doer runs one command against a held world.
type doer interface {
	doCommand(ctx context.Context, cmd game.Command, discord string, version int64, checkVersion bool) (applied, error)
}

func (s *Server) doCommand(ctx context.Context, cmd game.Command, discord string, version int64, checkVersion bool) (applied, error) {
	ctx, cancel := writeContext(ctx)
	defer cancel()
	return s.do(ctx, cmd, discord, version, checkVersion)
}

// actOn applies a request through d, made a command by command.
func actOn(ctx context.Context, d doer, req api.ActionRequest, check bool,
	command func(api.ActionRequest) (game.Command, *api.Refusal, int)) (api.ActionReply, *api.Refusal, error) {
	cmd, ref, _ := command(req)
	if ref != nil {
		return api.ActionReply{}, ref, nil
	}
	out, err := d.doCommand(ctx, cmd, req.DiscordID, req.Version, check)
	if err != nil {
		return api.ActionReply{}, nil, err
	}
	if out.ref != nil {
		return api.ActionReply{}, out.ref, nil
	}
	if out.dup {
		rep, err := storedReply(out.body)
		return rep, nil, err
	}
	return out.reply, nil, nil
}

// hostAct is a write from the Activity, with the reply's facts as its
// character may read them. A pick window is closed only by the gateway's
// clock, which names no row version.
func hostAct(ctx context.Context, d doer, req api.ActionRequest, check bool) (api.ActionReply, *api.Refusal, error) {
	if check && req.Kind == api.ActPartyWindow {
		return api.ActionReply{}, clockOnly, nil
	}
	rep, ref, err := actOn(ctx, d, req, check, playerCommand)
	if err == nil && ref == nil {
		rep.Facts = SeenFacts(rep.Character.ID, rep.Facts)
	}
	return rep, ref, err
}

// Act applies a player's request as POST /v1/actions does, the countdown
// kinds included, with the reply's facts as its character may read them.
// check is false only for a write the service itself makes for a
// character, which names no row version.
func (s *Server) Act(ctx context.Context, req api.ActionRequest, check bool) (api.ActionReply, *api.Refusal, error) {
	return hostAct(ctx, s, req, check)
}

// Armed are the countdowns running, for whoever must end them.
func (s *Server) Armed(ctx context.Context) ([]api.ArmedMachine, error) { return armedIn(ctx, s) }

// Countdown is one character's countdown, with Due 0 when none is running;
// ok is false when the character is gone.
func (s *Server) Countdown(ctx context.Context, characterID string) (api.ArmedMachine, bool, error) {
	return countdownIn(ctx, s, characterID)
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

func (h LocalHost) View(ctx context.Context, characterID string, v api.Viewer, passed int64) (api.ActivityState, bool, error) {
	return viewIn(ctx, h, characterID, v, passed)
}

func (h LocalHost) Act(ctx context.Context, req api.ActionRequest, check bool) (api.ActionReply, *api.Refusal, error) {
	return hostAct(ctx, h.l, req, check)
}

func (h LocalHost) Armed(ctx context.Context) ([]api.ArmedMachine, error) { return armedIn(ctx, h) }

func (h LocalHost) Countdown(ctx context.Context, characterID string) (api.ArmedMachine, bool, error) {
	return countdownIn(ctx, h, characterID)
}

func (h LocalHost) Subscribe(f func(characterIDs []string)) { h.l.subs.add(f) }
