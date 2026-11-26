package service

import (
	"context"
	"fmt"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
)

// Local is a game played in process through the API's types, with no
// store: a policy sees the same options, replies and refusals as over
// HTTP. A failure that is not a refusal breaks it for good.
type Local struct {
	G *game.Game
	// Now is the clock a countdown is read on; nil stamps no command, and
	// a machine's log is then held to its own stamps.
	Now    func() time.Time
	mem    memory
	broken error
	subs   listeners
	ended  endings
	sight  localSight
	maps   mapCache
}

// NewLocal plays g in process.
func NewLocal(g *game.Game) *Local {
	return &Local{G: g, mem: memory{replies: map[string][]byte{}, players: map[string]string{}, kept: &[]ledger.Txn{}}}
}

// Forget drops the replies kept for duplicate presses, for a long run
// whose players never repeat one.
func (l *Local) Forget() { clear(l.mem.replies) }

// Txns hands over the ledger transactions the actions applied since the
// last call, for a run that audits them.
func (l *Local) Txns() []ledger.Txn {
	out := *l.mem.kept
	*l.mem.kept = nil
	return out
}

func (l *Local) check() error {
	if l.broken != nil {
		return fmt.Errorf("service: the local game broke: %w", l.broken)
	}
	return nil
}

// Act applies a request as chat sends it, as POST /v1/actions does; a
// machine's countdown is armed and solved only through Host.
func (l *Local) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	return actOn(ctx, l, req, true, chatCommand)
}

func (l *Local) doCommand(ctx context.Context, cmd game.Command, discord string, version int64, checkVersion bool) (applied, error) {
	arrived := l.now()
	if err := l.check(); err != nil {
		return applied{}, err
	}
	out, err := applyCommand(ctx, l.G, l.mem, &l.subs, cmd, discord, version, checkVersion, arrived)
	if err != nil {
		l.broken = err
	}
	if out.ref == nil && !out.dup {
		l.ended.note(out.res.Facts, l.G.Tick())
	}
	if err == nil && out.ref == nil && !out.dup {
		l.mapPass(passHolders(l.G, out.res))
	}
	return out, err
}

func (l *Local) now() time.Time {
	if l.Now == nil {
		return time.Time{}
	}
	return l.Now()
}

// Advance runs the next tick and tells whoever watches the game.
func (l *Local) Advance() error {
	if err := l.check(); err != nil {
		return err
	}
	facts, err := l.G.Advance()
	if err != nil {
		l.broken = err
		return err
	}
	l.ended.note(facts, l.G.Tick())
	l.mapPass(nil)
	l.subs.tell(nil)
	return nil
}

func (l *Local) Options(_ context.Context, id string) (api.Options, error) {
	if err := l.check(); err != nil {
		return api.Options{}, err
	}
	c := l.G.Char(id)
	if c == nil {
		return api.Options{}, fmt.Errorf("no character %s", id)
	}
	return apiOptions(l.G, c), nil
}

// memory is a Local's records.
type memory struct {
	replies map[string][]byte
	players map[string]string
	kept    *[]ledger.Txn
}

func (m memory) Reply(_ context.Context, key string) ([]byte, error) { return m.replies[key], nil }

func (m memory) CharacterOf(_ context.Context, discord string) (string, error) {
	return m.players[discord], nil
}

func (m memory) SaveAction(_ context.Context, g *game.Game, cmd game.Command, c *game.Char, discord string, reply []byte, _ time.Time) error {
	_, txns := g.Flush()
	*m.kept = append(*m.kept, txns...)
	m.replies[cmd.Key] = reply
	if cmd.Kind == game.Create {
		m.players[discord] = c.C.ID
	}
	if cmd.Kind == game.Forget && g.IsForgotten(cmd.Char) {
		for d, id := range m.players {
			if id == cmd.Char {
				delete(m.players, d)
			}
		}
	}
	return nil
}
