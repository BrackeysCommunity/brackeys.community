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
	G      *game.Game
	mem    memory
	broken error
}

// NewLocal plays g in process.
func NewLocal(g *game.Game) *Local {
	return &Local{G: g, mem: memory{replies: map[string][]byte{}, players: map[string]string{}, kept: &[]ledger.Txn{}}}
}

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

func (l *Local) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	if err := l.check(); err != nil {
		return api.ActionReply{}, nil, err
	}
	cmd, ref, _ := playerCommand(req)
	if ref != nil {
		return api.ActionReply{}, ref, nil
	}
	out, err := applyCommand(ctx, l.G, l.mem, cmd, req.DiscordID, req.Version, true, time.Time{})
	if err != nil {
		l.broken = err
		return api.ActionReply{}, nil, err
	}
	if out.ref != nil {
		return api.ActionReply{}, out.ref, nil
	}
	rep, err := decodeReply(out.body, out.dup)
	return rep, nil, err
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
	return nil
}
