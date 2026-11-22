package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/season"
)

// records is what applying a command needs of where it is kept: the
// replies already given, who plays which character, and the write.
type records interface {
	Reply(ctx context.Context, interaction string) ([]byte, error)
	CharacterOf(ctx context.Context, discord string) (string, error)
	SaveAction(ctx context.Context, g *game.Game, cmd game.Command, c *game.Char, discord string, reply []byte, now time.Time) error
}

// applied is a command's outcome: a refusal, the stored reply to a
// command already applied, or the reply just written, encoded in body
// and as it was made in reply.
type applied struct {
	ref    *api.Refusal
	status int
	dup    bool
	body   []byte
	reply  api.ActionReply
	res    game.Result
}

// chatCommand is a request from chat as a command: playerCommand, less
// the kinds only the Activity sends and the pick clock's own.
func chatCommand(req api.ActionRequest) (game.Command, *api.Refusal, int) {
	if api.ActivityOnly(req.Kind) {
		return game.Command{}, &api.Refusal{Code: api.CodeForbidden, Message: "machines are worked in the Activity"}, http.StatusForbidden
	}
	if req.Kind == api.ActPartyWindow {
		return game.Command{}, clockOnly, http.StatusForbidden
	}
	return playerCommand(req)
}

// clockOnly refuses a pick window's close from anyone but its clock.
var clockOnly = &api.Refusal{Code: api.CodeForbidden, Message: "a pick window is closed by its clock"}

// playerCommand is a player's request as a command; operator kinds take
// the operator path.
func playerCommand(req api.ActionRequest) (game.Command, *api.Refusal, int) {
	if game.Operator(req.Kind) {
		return game.Command{}, &api.Refusal{Code: api.CodeForbidden, Message: "operator actions take the operator path"}, http.StatusForbidden
	}
	cmd := game.Command{Key: req.InteractionID, Char: req.CharacterID, Kind: req.Kind, Dir: req.Dir, Material: req.Material,
		Ticks: req.Ticks, Option: req.Option, Units: req.Units, Asset: req.Asset, Item: req.Item, Slot: req.Slot, NPC: req.NPC, Server: req.Server,
		Price: req.Price, Target: req.Target, Note: req.Note, Admin: req.Admin, Along: req.Along}
	if req.Goal != nil {
		s := simGoal(*req.Goal)
		cmd.Goal = &s
	}
	if req.Floor != nil {
		f := simFloor(*req.Floor)
		cmd.Floor = &f
	}
	if req.To != nil {
		h := simHex(*req.To)
		cmd.To = &h
	}
	if req.Recipe != nil {
		r := simRecipe(*req.Recipe)
		cmd.Recipe = &r
	}
	if req.Stop != nil {
		cmd.Stop = &game.Stop{Threat: req.Stop.Threat, Provisions: req.Stop.Provisions, Unknown: req.Stop.Unknown}
	}
	cmd.Machine = simMachine(req.Machine)
	return cmd, nil, 0
}

// simMachine is what a machine action carries, as the rules take it.
func simMachine(m *api.MachineIntent) *game.MachineCmd {
	if m == nil {
		return nil
	}
	return &game.MachineCmd{Source: m.Source, Pouch: m.Pouch, Family: m.Family, Level: m.Level, Compact: m.Compact, Teach: m.Teach,
		Log: simLog(m.Log)}
}

// operatorCommand is an operator's request as a command; player kinds
// take the player path. A world-level kind names no character, whatever
// the request says, so it is recorded under none.
func operatorCommand(req api.OperatorRequest) (game.Command, *api.Refusal, int) {
	if !game.Operator(req.Kind) {
		return game.Command{}, &api.Refusal{Code: api.CodeBadJSON, Message: "not an operator action"}, http.StatusBadRequest
	}
	cmd := game.Command{Key: req.InteractionID, Char: req.CharacterID, Kind: req.Kind, Asset: req.Asset, Units: req.Units, Note: req.Note, Target: req.Target}
	if req.To != nil {
		h := simHex(*req.To)
		cmd.To = &h
	}
	if req.Pin != nil {
		p := simPin(*req.Pin)
		cmd.Pin = &p
	}
	if req.Epoch != nil {
		cmd.Epoch = &season.Epoch{From: req.Epoch.From, To: req.Epoch.To, Sheets: req.Epoch.Sheets}
	}
	if req.Arc != nil {
		cmd.Arc = simArcOrder(*req.Arc)
	}
	if game.WorldLevel(req.Kind) {
		cmd.Char = ""
	}
	return cmd, nil, 0
}

// simArcOrder is an arc-cast's order as the rules take it: each role
// bound to the ref it names.
func simArcOrder(o api.ArcOrder) *game.ArcCmd {
	out := &game.ArcCmd{Template: o.Template}
	for _, c := range o.Cast {
		out.Cast = append(out.Cast, arc.Binding{Role: c.Role, Ref: fact.Ref{Kind: c.Kind, ID: c.ID}})
	}
	if o.Seat != nil {
		h := simHex(*o.Seat)
		out.Seat = &h
	}
	return out
}

func apiRefusal(r *game.Refused) *api.Refusal { return &api.Refusal{Code: r.Code, Message: r.Msg} }

// untouched is a failure before the game was touched: there is nothing to
// restore.
type untouched struct{ error }

func (u untouched) Unwrap() error { return u.error }

// storedReply is the stored reply to a command sent a second time.
func storedReply(body []byte) (api.ActionReply, error) {
	var out api.ActionReply
	if err := json.Unmarshal(body, &out); err != nil {
		return out, err
	}
	out.Duplicate = true
	return out, nil
}

// applyCommand validates, resolves and records one command, idempotent on
// its interaction id: a second send gets the first one's stored reply,
// and subs are told who a recorded write changed. An error leaves g
// part-way, and the caller restores or abandons it, unless it is
// untouched.
func applyCommand(ctx context.Context, g *game.Game, rec records, subs *listeners, cmd game.Command, discord string, version int64, checkVersion bool, now time.Time) (applied, error) {
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
	// The clock a countdown is read on is the service's, never a client's.
	if game.Timed(cmd.Kind) && !now.IsZero() {
		cmd.Now = now.UnixMilli()
	}
	res, ref, status, err := act(g, cmd, version, checkVersion)
	if ref != nil || err != nil {
		return applied{ref: ref, status: status}, err
	}
	rep := actionReply(g, res)
	if !game.Operator(cmd.Kind) {
		rep.Facts = playerFacts(rep.Facts)
	}
	body, err := json.Marshal(rep)
	if err != nil {
		return applied{}, err
	}
	if err := rec.SaveAction(ctx, g, cmd, res.Char, discord, body, now); err != nil {
		return applied{}, err
	}
	subs.tell(told(res))
	return applied{body: body, reply: rep, res: res}, nil
}

// partyLogOnly refuses a seat's own solve of a party machine, whose log
// is the merged one the gateway writes.
var partyLogOnly = &api.Refusal{Code: api.CodeForbidden, Message: "a party machine's log is written by the gateway"}

// act checks a command's row version, refuses a checked solve of an armed
// party machine (only the gateway's merged write ends one), and runs it. A
// refusal comes back with its HTTP status; nothing changed.
func act(g *game.Game, cmd game.Command, version int64, checkVersion bool) (game.Result, *api.Refusal, int, error) {
	if c := g.Char(cmd.Char); c != nil && checkVersion && cmd.Kind != game.Create && c.Version != version {
		return game.Result{}, &api.Refusal{Code: api.CodeStale, Message: "the character has changed", Version: c.Version}, http.StatusConflict, nil
	}
	if c := g.Char(cmd.Char); c != nil && checkVersion && cmd.Kind == game.MachineSolve && armedShared(g, c) != nil {
		return game.Result{}, partyLogOnly, http.StatusForbidden, nil
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
