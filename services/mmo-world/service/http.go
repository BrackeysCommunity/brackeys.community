package service

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
)

// structural: the widest tile query, in tiles from its centre, and the
// largest request body.
const (
	maxTileRadius = 30
	maxBody       = 64 << 10
)

// Handler is the service's HTTP API.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+api.PathHealth, s.health)
	player := func(path string, h http.HandlerFunc) { mux.Handle(path, s.guard(s.cfg.APIToken, h)) }
	player("POST "+api.PathActions, s.action)
	player("GET "+api.PathOptions, s.options)
	player("POST "+api.PathPreview, s.preview)
	player("GET "+api.PathTiles, s.tiles)
	player("GET "+api.PathCharacter, s.character)
	player("GET "+api.PathPlace, s.place)
	player("GET "+api.PathSheet, s.sheet)
	player("GET "+api.PathHere, s.here)
	player("POST "+api.PathAppraise, s.appraise)
	player("GET "+api.PathRecipes, s.recipes)
	player("GET "+api.PathRecap, s.recap)
	player("GET "+api.PathNPC, s.npcHandler)
	player("GET "+api.PathMap, s.mapHandler)
	player("GET "+api.PathLexicon, s.lexicon)
	player("GET "+api.PathPlayer, s.playerOf)
	player("GET "+api.PathMarket, s.market)
	player("GET "+api.PathHistory, s.history)
	player("GET "+api.PathForum, s.forum)
	player("GET "+api.PathRisk, s.routeRisk)
	mux.HandleFunc("GET "+api.PathMedia+"{key}", s.mediaHandler)
	op := func(path string, h http.HandlerFunc) {
		mux.Handle(path, s.guard(s.cfg.OperatorToken, s.operatorOnly(h)))
	}
	op("POST "+api.PathOperator, s.operator)
	op("GET "+api.PathOperatorCharacter, s.inspectCharacter)
	op("GET "+api.PathOperatorTile, s.inspectTile)
	op("GET "+api.PathOperatorAudit, s.auditHandler)
	op("GET "+api.PathOperatorDigest, s.digestHandler)
	op("GET "+api.PathOperatorEconomy, s.flags)
	op("POST "+api.PathOperatorReset, s.reset)
	op("POST "+api.PathOperatorClock, s.clock)
	return mux
}

// Standby answers while a service waits for the world's lock: health is
// up (so a rolling deploy can retire the old service, which frees the
// lock), and everything else is unavailable.
func Standby(world string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == api.PathHealth {
			reply(w, http.StatusOK, api.Health{Standby: true, World: world, Version: api.Version})
			return
		}
		refuse(w, http.StatusServiceUnavailable, api.Refusal{Code: api.CodeInternal, Message: "waiting for the world"})
	})
}

func (s *Server) guard(token string, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token != "" {
			got, _ := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
				refuse(w, http.StatusUnauthorized, api.Refusal{Code: api.CodeForbidden, Message: "bad token"})
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}

// operatorOnly closes the operator paths when no operator token is set.
func (s *Server) operatorOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.OperatorToken == "" {
			refuse(w, http.StatusForbidden, api.Refusal{Code: api.CodeForbidden, Message: "operator paths are closed"})
			return
		}
		h(w, r)
	}
}

func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func refuse(w http.ResponseWriter, status int, r api.Refusal) { reply(w, status, r) }

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: err.Error()})
		return false
	}
	return true
}

// health is down while the world is not ready, is stale or has stalled, so
// the platform can see it.
func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	if !s.ready.Load() {
		reply(w, http.StatusServiceUnavailable, api.Health{World: s.cfg.World, Version: api.Version})
		return
	}
	h := api.Health{OK: true, World: s.cfg.World, Tick: s.Tick(), Due: s.Due(), Version: api.Version,
		Stalled: s.stalled.Load() || s.stale.Load()}
	status := http.StatusOK
	if h.Stalled {
		h.OK, status = false, http.StatusServiceUnavailable
	}
	reply(w, status, h)
}

func (s *Server) action(w http.ResponseWriter, r *http.Request) {
	var req api.ActionRequest
	if !decode(w, r, &req) {
		return
	}
	cmd, ref, status := playerCommand(req)
	if ref != nil {
		refuse(w, status, *ref)
		return
	}
	s.apply(w, r.Context(), cmd, req.DiscordID, req.Version, true)
}

func (s *Server) operator(w http.ResponseWriter, r *http.Request) {
	var req api.OperatorRequest
	if !decode(w, r, &req) {
		return
	}
	cmd, ref, status := operatorCommand(req)
	if ref != nil {
		refuse(w, status, *ref)
		return
	}
	s.apply(w, r.Context(), cmd, "", 0, false)
}

// structural: how long a write may run once begun. It runs apart from the
// request, so a client that hangs up cannot cancel it half way and leave
// the world to reload.
const writeTimeout = 30 * time.Second

func writeContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), writeTimeout)
}

// apply runs one command against the held world. A failure after the game
// was touched restores the world from the store; a write that lost a race
// with the same interaction id gets the stored reply.
func (s *Server) apply(w http.ResponseWriter, ctx context.Context, cmd game.Command, discord string, version int64, checkVersion bool) {
	start := time.Now()
	ctx, cancel := writeContext(ctx)
	defer cancel()
	unlock, ok := s.hold(ctx, w, true)
	if !ok {
		return
	}
	defer unlock()
	out, err := applyCommand(ctx, s.g, s.st, cmd, discord, version, checkVersion, s.cfg.Now())
	if err != nil {
		if !errors.As(err, new(untouched)) {
			err = s.reload(ctx, err)
		}
		if uniqueViolation(err) {
			if stored, e := s.st.Reply(ctx, cmd.Key); e == nil && stored != nil {
				s.duplicate(w, stored)
				return
			}
		}
		s.internal(w, err)
		return
	}
	switch {
	case out.ref != nil:
		refuse(w, out.status, *out.ref)
	case out.dup:
		s.duplicate(w, out.body)
	default:
		s.capture("mmo_action", out.res.Char.C.ID, map[string]any{"kind": cmd.Kind, "tick": s.g.Tick(),
			"ms": time.Since(start).Milliseconds(), "facts": len(out.res.Facts)})
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(out.body)
	}
}

func actionReply(g *game.Game, res game.Result) api.ActionReply {
	return api.ActionReply{Tick: g.Tick(), Character: apiCharacter(g, res.Char), Facts: apiFacts(res.Facts), Pressed: apiPressed(g, res.Pressed)}
}

func uniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

func (s *Server) duplicate(w http.ResponseWriter, stored []byte) {
	out, err := decodeReply(stored, true)
	if err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

// hold takes the world for a request, or refuses it while the world may
// not be used.
func (s *Server) hold(ctx context.Context, w http.ResponseWriter, needGame bool) (unlock func(), ok bool) {
	unlock, err := s.take(ctx, needGame)
	if err != nil {
		refuseUnusable(w, err)
		return nil, false
	}
	return unlock, true
}

// refuseUnusable answers a request the world could not take, as take
// reported it.
func refuseUnusable(w http.ResponseWriter, err error) {
	msg := "the world is closing"
	if !errors.Is(err, errClosed) {
		msg = "the world is reloading"
	}
	refuse(w, http.StatusServiceUnavailable, api.Refusal{Code: api.CodeInternal, Message: msg})
}

func (s *Server) internal(w http.ResponseWriter, err error) {
	s.cfg.Log.Error("request failed", "err", err.Error())
	refuse(w, http.StatusInternalServerError, api.Refusal{Code: api.CodeInternal, Message: "internal error"})
}

// charFor finds the character a read names, under the lock.
func (s *Server) charFor(w http.ResponseWriter, id string) *game.Char {
	c := s.g.Char(id)
	if c == nil {
		refuse(w, http.StatusNotFound, api.Refusal{Code: api.CodeNotFound, Message: "no character " + id})
	}
	return c
}

func (s *Server) options(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	if c := s.charFor(w, r.URL.Query().Get("characterId")); c != nil {
		reply(w, http.StatusOK, apiOptions(s.g, c))
	}
}

// preview is one option's band before it is pressed: never its chance and
// never an outcome.
func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	var req api.PreviewRequest
	if !decode(w, r, &req) {
		return
	}
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	c := s.charFor(w, req.CharacterID)
	if c == nil {
		return
	}
	if o, ok := s.g.Option(c, req.Option); ok {
		reply(w, http.StatusOK, apiOption(s.g, o))
		return
	}
	refuse(w, http.StatusNotFound, api.Refusal{Code: api.CodeNotFound, Message: "no such option on this beat"})
}

func intParam(r *http.Request, name string) (int64, bool) {
	n, err := strconv.ParseInt(r.URL.Query().Get(name), 10, 64)
	return n, err == nil
}

func hexParam(w http.ResponseWriter, r *http.Request) (hex.Hex, bool) {
	q, ok1 := intParam(r, "q")
	rr, ok2 := intParam(r, "r")
	if !ok1 || !ok2 {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "q and r are required"})
		return hex.Hex{}, false
	}
	return hex.Hex{Q: q, R: rr}, true
}

// tiles is the discovered tiles round a centre; nothing undiscovered, on
// any layer.
func (s *Server) tiles(w http.ResponseWriter, r *http.Request) {
	centre, ok := hexParam(w, r)
	if !ok {
		return
	}
	radius, ok := intParam(r, "radius")
	if !ok || radius < 0 || radius > maxTileRadius {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "radius is 0 to " + strconv.Itoa(maxTileRadius)})
		return
	}
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	out := api.Tiles{Tick: s.g.Tick(), Tiles: []api.Tile{}}
	for _, h := range hex.DiscAt(centre, radius) {
		if t, ok := apiTile(s.g, h); ok {
			out.Tiles = append(out.Tiles, t)
		}
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) character(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	if c := s.charFor(w, r.URL.Query().Get("id")); c != nil {
		reply(w, http.StatusOK, apiCharacter(s.g, c))
	}
}

func (s *Server) place(w http.ResponseWriter, r *http.Request) {
	h, ok := hexParam(w, r)
	if !ok {
		return
	}
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	out, ok := apiPlace(s.g, h)
	if !ok {
		refuse(w, http.StatusNotFound, api.Refusal{Code: api.CodeNotFound, Message: "nobody has found that tile"})
		return
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) inspectCharacter(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	if c := s.charFor(w, r.URL.Query().Get("id")); c != nil {
		reply(w, http.StatusOK, c)
	}
}

// inspectTile is a tile as operators see it: its stored state and its
// baseline, discovered or not.
func (s *Server) inspectTile(w http.ResponseWriter, r *http.Request) {
	h, ok := hexParam(w, r)
	if !ok {
		return
	}
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	reply(w, http.StatusOK, map[string]any{"baseline": s.rules.Gen.Baseline(h), "state": s.g.World.Tile(h), "region": s.g.World.RegionAt(h)})
}

func (s *Server) auditHandler(w http.ResponseWriter, r *http.Request) {
	bad, err := s.Audit(r.Context())
	switch {
	case errors.Is(err, errClosed) || errors.Is(err, errStale):
		refuseUnusable(w, err)
		return
	case err != nil:
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, api.Audit{Discrepancies: bad})
}

func (s *Server) digestHandler(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	defer unlock()
	d, err := s.g.Digest()
	if err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, api.Digest{Tick: s.g.Tick(), Digest: d.String()})
}

// reset wipes a disposable world and founds it again, now, with the
// sheets the service runs on. A failed reset leaves the world as it was.
func (s *Server) reset(w http.ResponseWriter, r *http.Request) {
	var req api.ResetRequest
	if !decode(w, r, &req) {
		return
	}
	if req.World != s.cfg.World {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "name the world to reset"})
		return
	}
	ctx, cancel := writeContext(r.Context())
	defer cancel()
	unlock, ok := s.hold(ctx, w, false)
	if !ok {
		return
	}
	defer unlock()
	if !s.resettable(s.meta.Load()) {
		refuse(w, http.StatusForbidden, api.Refusal{Code: api.CodeForbidden,
			Message: "only a disposable world under a service that founds disposable worlds is reset"})
		return
	}
	if err := s.found(ctx, true); err != nil {
		s.internal(w, s.reload(ctx, err))
		return
	}
	s.due.Store(0)
	s.cfg.Log.Warn("world reset", "world", s.cfg.World)
	reply(w, http.StatusOK, api.ResetReply{World: s.cfg.World, Tick: s.g.Tick()})
}

// clock sets the manual clock's due tick.
func (s *Server) clock(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.ManualClock {
		refuse(w, http.StatusForbidden, api.Refusal{Code: api.CodeForbidden, Message: "this world keeps wall time"})
		return
	}
	var req api.ClockRequest
	if !decode(w, r, &req) {
		return
	}
	s.due.Store(req.Due)
	reply(w, http.StatusOK, req)
}
