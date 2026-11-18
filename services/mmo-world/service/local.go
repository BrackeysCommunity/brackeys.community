package service

import (
	"context"
	"fmt"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
)

// Local is a game played in this process through the API's types, with
// no store: the harness's simulated players use it, so a policy sees the
// same options and replies over HTTP or here. Replies and Discord users
// are remembered in memory.
type Local struct {
	G       *game.Game
	replies map[string]api.ActionReply
	players map[string]string
}

func NewLocal(g *game.Game) *Local {
	return &Local{G: g, replies: map[string]api.ActionReply{}, players: map[string]string{}}
}

func (l *Local) Act(_ context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	if out, ok := l.replies[req.InteractionID]; ok {
		out.Duplicate = true
		return out, nil, nil
	}
	if req.Kind == api.ActCreate {
		if id, ok := l.players[req.DiscordID]; ok || req.DiscordID == "" {
			return api.ActionReply{}, &api.Refusal{Code: api.CodeSecondPC, Message: "this user already plays " + id}, nil
		}
	}
	cmd := game.Command{Key: req.InteractionID, Char: req.CharacterID, Kind: req.Kind, Dir: req.Dir, Material: req.Material,
		Ticks: req.Ticks, Option: req.Option}
	if req.To != nil {
		h := simHex(*req.To)
		cmd.To = &h
	}
	res, ref, _, err := act(l.G, cmd, req.Version, !game.Operator(req.Kind))
	if ref != nil || err != nil {
		return api.ActionReply{}, ref, err
	}
	l.G.Flush()
	out := actionReply(l.G, res)
	l.replies[req.InteractionID] = out
	if req.Kind == api.ActCreate {
		l.players[req.DiscordID] = res.Char.C.ID
	}
	return out, nil, nil
}

func (l *Local) Options(_ context.Context, id string) (api.Options, error) {
	c := l.G.Char(id)
	if c == nil {
		return api.Options{}, fmt.Errorf("no character %s", id)
	}
	return apiOptions(l.G, c), nil
}
