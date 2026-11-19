package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
)

// records is what applying a command needs of where it is kept: the
// replies already given, who plays which character, and the write.
type records interface {
	Reply(ctx context.Context, interaction string) ([]byte, error)
	CharacterOf(ctx context.Context, discord string) (string, error)
	SaveAction(ctx context.Context, g *game.Game, cmd game.Command, c *game.Char, discord string, reply []byte, now time.Time) error
}

// applied is a command's outcome: a refusal, the stored reply to a
// command already applied, or the reply just written.
type applied struct {
	ref    *api.Refusal
	status int
	dup    bool
	body   []byte
	res    game.Result
}

// playerCommand is a player's request as a command; operator kinds take
// the operator path.
func playerCommand(req api.ActionRequest) (game.Command, *api.Refusal, int) {
	if game.Operator(req.Kind) {
		return game.Command{}, &api.Refusal{Code: api.CodeForbidden, Message: "operator actions take the operator path"}, http.StatusForbidden
	}
	cmd := game.Command{Key: req.InteractionID, Char: req.CharacterID, Kind: req.Kind, Dir: req.Dir, Material: req.Material,
		Ticks: req.Ticks, Option: req.Option}
	if req.To != nil {
		h := simHex(*req.To)
		cmd.To = &h
	}
	return cmd, nil, 0
}

// operatorCommand is an operator's request as a command; player kinds
// take the player path.
func operatorCommand(req api.OperatorRequest) (game.Command, *api.Refusal, int) {
	if !game.Operator(req.Kind) {
		return game.Command{}, &api.Refusal{Code: api.CodeBadJSON, Message: "not an operator action"}, http.StatusBadRequest
	}
	return game.Command{Key: req.InteractionID, Char: req.CharacterID, Kind: req.Kind, Asset: req.Asset, Units: req.Units, Note: req.Note}, nil, 0
}

func apiRefusal(r *game.Refused) *api.Refusal { return &api.Refusal{Code: r.Code, Message: r.Msg} }

// untouched is a failure before the game was touched: there is nothing to
// restore.
type untouched struct{ error }

func (u untouched) Unwrap() error { return u.error }

// decodeReply is a stored or just-written reply; dup marks it a second
// send's.
func decodeReply(body []byte, dup bool) (api.ActionReply, error) {
	var out api.ActionReply
	if err := json.Unmarshal(body, &out); err != nil {
		return out, err
	}
	out.Duplicate = dup
	return out, nil
}

// applyCommand validates, resolves and records one command, idempotent on
// its interaction id: a second send gets the first one's stored reply. An
// error leaves g part-way, and the caller restores or abandons it, unless
// it is untouched.
func applyCommand(ctx context.Context, g *game.Game, rec records, cmd game.Command, discord string, version int64, checkVersion bool, now time.Time) (applied, error) {
	var bad *game.Refused
	if errors.As(game.ValidKey(cmd.Key), &bad) {
		return applied{ref: apiRefusal(bad), status: http.StatusBadRequest}, nil
	}
	stored, err := rec.Reply(ctx, cmd.Key)
	if err != nil {
		return applied{}, untouched{err}
	}
	if stored != nil {
		return applied{dup: true, body: stored}, nil
	}
	if cmd.Kind == game.Create {
		if discord == "" {
			return applied{ref: &api.Refusal{Code: api.CodeBadJSON, Message: "create needs discordId"}, status: http.StatusBadRequest}, nil
		}
		if id, err := rec.CharacterOf(ctx, discord); err != nil {
			return applied{}, untouched{err}
		} else if id != "" {
			return applied{ref: &api.Refusal{Code: api.CodeSecondPC, Message: "this user already plays " + id}, status: http.StatusConflict}, nil
		}
	}
	res, ref, status, err := act(g, cmd, version, checkVersion)
	if ref != nil || err != nil {
		return applied{ref: ref, status: status}, err
	}
	body, err := json.Marshal(actionReply(g, res))
	if err != nil {
		return applied{}, err
	}
	if err := rec.SaveAction(ctx, g, cmd, res.Char, discord, body, now); err != nil {
		return applied{}, err
	}
	return applied{body: body, res: res}, nil
}

// act checks a command's row version and runs it. A refusal comes back
// with its HTTP status; nothing changed.
func act(g *game.Game, cmd game.Command, version int64, checkVersion bool) (game.Result, *api.Refusal, int, error) {
	if c := g.Char(cmd.Char); c != nil && checkVersion && cmd.Kind != game.Create && c.Version != version {
		return game.Result{}, &api.Refusal{Code: api.CodeStale, Message: "the character has changed", Version: c.Version}, http.StatusConflict, nil
	}
	res, err := g.Act(cmd)
	var ref *game.Refused
	if errors.As(err, &ref) {
		out := apiRefusal(ref)
		status := http.StatusUnprocessableEntity
		if c := g.Char(cmd.Char); c != nil {
			out.Version = c.Version
		} else if ref.Code == game.NoSuchChar {
			status = http.StatusNotFound
		}
		return res, out, status, nil
	}
	return res, nil, 0, err
}
