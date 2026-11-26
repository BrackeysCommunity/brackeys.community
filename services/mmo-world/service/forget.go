package service

import (
	"context"
	"errors"
	"net/http"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
)

// forget is POST /v1/forget, the site's way to forget a player (GDD 14.9):
// the Discord user names the character, and the forget is a recorded
// command like a press of /forget-me, so a repeat with the same
// interaction id writes once. A user with no character is told so.
func (s *Server) forget(w http.ResponseWriter, r *http.Request) {
	var req api.ForgetRequest
	if !decode(w, r, &req) {
		return
	}
	if req.DiscordID == "" {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "forget needs discordId"})
		return
	}
	ctx, cancel := writeContext(r.Context())
	defer cancel()
	out, ref, status, err := s.forgetUser(ctx, req)
	switch {
	case errors.Is(err, errClosed) || errors.Is(err, errStale):
		refuseUnusable(w, err)
	case err != nil:
		s.internal(w, err)
	case ref != nil:
		refuse(w, status, *ref)
	default:
		reply(w, http.StatusOK, out)
	}
}

// otherCommand refuses a forget whose interaction id already names
// another command.
var otherCommand = &api.Refusal{Code: api.CodeBadJSON, Message: "this interactionId already names another command"}

func (s *Server) forgetUser(ctx context.Context, req api.ForgetRequest) (api.ForgetReply, *api.Refusal, int, error) {
	var bad *game.Refused
	if errors.As(game.ValidKey(req.InteractionID), &bad) {
		return api.ForgetReply{}, apiRefusal(bad), http.StatusBadRequest, nil
	}
	// A repeat is answered from the first reply: the user's Discord id no
	// longer names the character once it is forgotten.
	id, err := s.repliedFor(ctx, req.InteractionID)
	if err != nil || id != "" {
		return s.forgetReply(ctx, id, err)
	}
	if id, err = s.st.CharacterOf(ctx, req.DiscordID); err != nil || id == "" {
		return api.ForgetReply{}, nil, 0, err
	}
	out, err := s.do(ctx, game.Command{Key: req.InteractionID, Char: id, Kind: game.Forget}, "", 0, false)
	switch {
	case err != nil:
		return api.ForgetReply{}, nil, 0, err
	case out.ref != nil && out.ref.Code != game.ForgottenCode:
		return api.ForgetReply{}, out.ref, out.status, nil
	case out.dup:
		id, err = repliedChar(out.body)
	}
	return s.forgetReply(ctx, id, err)
}

// repliedFor is the character the stored reply to an interaction names,
// or "" when nothing was stored under it.
func (s *Server) repliedFor(ctx context.Context, key string) (string, error) {
	stored, err := s.st.Reply(ctx, key)
	if err != nil || stored == nil {
		return "", err
	}
	return repliedChar(stored)
}

func repliedChar(body []byte) (string, error) {
	rep, err := storedReply(body)
	if err != nil {
		return "", err
	}
	if rep.Character.ID == "" {
		return "", errNotForget
	}
	return rep.Character.ID, nil
}

// errNotForget is a stored reply that names no character, so cannot be a
// forget's.
var errNotForget = errors.New("not a forget")

// forgetReply reads whether character id is forgotten and swept. A stored
// reply that is not a forget's is refused.
func (s *Server) forgetReply(ctx context.Context, id string, err error) (api.ForgetReply, *api.Refusal, int, error) {
	if errors.Is(err, errNotForget) {
		return api.ForgetReply{}, otherCommand, http.StatusBadRequest, nil
	}
	if err != nil {
		return api.ForgetReply{}, nil, 0, err
	}
	unlock, err := s.take(ctx, true)
	if err != nil {
		return api.ForgetReply{}, nil, 0, err
	}
	defer unlock()
	c := s.g.Char(id)
	if c == nil || c.Forget == 0 {
		return api.ForgetReply{}, otherCommand, http.StatusBadRequest, nil
	}
	return api.ForgetReply{Forgotten: true, Swept: c.Forgotten > 0}, nil, 0, nil
}
