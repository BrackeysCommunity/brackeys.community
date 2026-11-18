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
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
)

// structural: the widest tile query, in tiles from its centre.
const maxTileRadius = 30

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
	op := func(path string, h http.HandlerFunc) {
		mux.Handle(path, s.guard(s.cfg.OperatorToken, s.operatorOnly(h)))
	}
	op("POST "+api.PathOperator, s.operator)
	op("GET "+api.PathOperator+"/character", s.inspectCharacter)
	op("GET "+api.PathOperator+"/tile", s.inspectTile)
	op("GET "+api.PathOperator+"/audit", s.auditHandler)
	op("GET "+api.PathOperator+"/digest", s.digestHandler)
	op("POST "+api.PathOperator+"/reset", s.reset)
	op("POST "+api.PathOperator+"/clock", s.clock)
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
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: err.Error()})
		return false
	}
	return true
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	if !s.ready.Load() {
		reply(w, http.StatusServiceUnavailable, api.Health{World: s.cfg.World, Version: api.Version})
		return
	}
	reply(w, http.StatusOK, api.Health{OK: true, World: s.cfg.World, Tick: s.Tick(), Due: s.Due(), Version: api.Version})
}

func (s *Server) action(w http.ResponseWriter, r *http.Request) {
	var req api.ActionRequest
	if !decode(w, r, &req) {
		return
	}
	if game.Operator(req.Kind) {
		refuse(w, http.StatusForbidden, api.Refusal{Code: api.CodeForbidden, Message: "operator actions take the operator path"})
		return
	}
	cmd := game.Command{Key: req.InteractionID, Char: req.CharacterID, Kind: req.Kind, Dir: req.Dir, Material: req.Material,
		Ticks: req.Ticks, Option: req.Option}
	if req.To != nil {
		h := simHex(*req.To)
		cmd.To = &h
	}
	s.apply(w, r.Context(), cmd, req.DiscordID, req.Version, true)
}

func (s *Server) operator(w http.ResponseWriter, r *http.Request) {
	var req api.OperatorRequest
	if !decode(w, r, &req) {
		return
	}
	if !game.Operator(req.Kind) {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "not an operator action"})
		return
	}
	s.apply(w, r.Context(), game.Command{Key: req.InteractionID, Char: req.CharacterID, Kind: req.Kind, Asset: req.Asset,
		Units: req.Units, Note: req.Note}, "", 0, false)
}

// apply validates, resolves and writes one command, idempotent on its
// interaction id: a second send gets the first one's stored reply.
func (s *Server) apply(w http.ResponseWriter, ctx context.Context, cmd game.Command, discord string, version int64, checkVersion bool) {
	start := time.Now()
	if cmd.Key == "" {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "interactionId is required"})
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if stored, err := s.st.Reply(ctx, cmd.Key); err != nil {
		s.internal(w, err)
		return
	} else if stored != nil {
		s.duplicate(w, stored)
		return
	}
	if cmd.Kind == game.Create {
		if discord == "" {
			refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "create needs discordId"})
			return
		}
		if id, err := s.st.CharacterOf(ctx, discord); err != nil {
			s.internal(w, err)
			return
		} else if id != "" {
			refuse(w, http.StatusConflict, api.Refusal{Code: api.CodeSecondPC, Message: "this user already plays " + id})
			return
		}
	}
	res, ref, status, err := act(s.g, cmd, version, checkVersion)
	if ref != nil {
		refuse(w, status, *ref)
		return
	}
	if err != nil {
		s.internal(w, s.reload(ctx, err))
		return
	}
	body, err := json.Marshal(actionReply(s.g, res))
	if err != nil {
		s.internal(w, s.reload(ctx, err))
		return
	}
	if err := s.st.SaveAction(ctx, s.g, cmd, res.Char, discord, body, s.cfg.Now()); err != nil {
		err = s.reload(ctx, err)
		if stored, e := s.st.Reply(ctx, cmd.Key); e == nil && stored != nil && uniqueViolation(err) {
			s.duplicate(w, stored)
			return
		}
		s.internal(w, err)
		return
	}
	s.cfg.Events.Capture("mmo_action", res.Char.C.ID, map[string]any{"kind": cmd.Kind, "tick": s.g.Tick(),
		"ms": time.Since(start).Milliseconds(), "facts": len(res.Facts)})
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
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
		out := &api.Refusal{Code: ref.Code, Message: ref.Msg}
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

func actionReply(g *game.Game, res game.Result) api.ActionReply {
	return api.ActionReply{Tick: g.Tick(), Character: apiCharacter(g, res.Char), Facts: apiFacts(res.Facts), Pressed: apiPressed(g, res.Pressed)}
}

func uniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

func (s *Server) duplicate(w http.ResponseWriter, stored []byte) {
	var out api.ActionReply
	if err := json.Unmarshal(stored, &out); err != nil {
		s.internal(w, err)
		return
	}
	out.Duplicate = true
	reply(w, http.StatusOK, out)
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
	s.mu.Lock()
	defer s.mu.Unlock()
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
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.charFor(w, req.CharacterID)
	if c == nil {
		return
	}
	if f := s.g.Choose(c).Fight; f != nil {
		for _, o := range f.Options {
			if o.ID == req.Option {
				reply(w, http.StatusOK, apiOption(s.g, o))
				return
			}
		}
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
	s.mu.Lock()
	defer s.mu.Unlock()
	out := api.Tiles{Tick: s.g.Tick(), Tiles: []api.Tile{}}
	for _, h := range hex.DiscAt(centre, radius) {
		if t, ok := apiTile(s.g, h); ok {
			out.Tiles = append(out.Tiles, t)
		}
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) character(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c := s.charFor(w, r.URL.Query().Get("id")); c != nil {
		reply(w, http.StatusOK, apiCharacter(s.g, c))
	}
}

func (s *Server) place(w http.ResponseWriter, r *http.Request) {
	h, ok := hexParam(w, r)
	if !ok {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	t, ok := apiTile(s.g, h)
	if !ok {
		refuse(w, http.StatusNotFound, api.Refusal{Code: api.CodeNotFound, Message: "nobody has found that tile"})
		return
	}
	out := api.Place{Tick: s.g.Tick(), Tile: t, Gauges: []api.Gauge{}, Here: []string{}}
	if ri := s.g.World.RegionAt(h); ri >= 0 {
		reg := s.g.World.Regions[ri]
		for i, gg := range s.rules.Book.Gauges {
			out.Gauges = append(out.Gauges, api.Gauge{ID: gg.ID, Value: reg.Gauge[i], Unit: "gauge"})
		}
		if reg.Holder >= 0 {
			out.Holder = "f-" + strconv.Itoa(reg.Holder)
		}
	}
	for _, c := range s.g.Chars {
		if c.C.At == h {
			out.Here = append(out.Here, c.C.ID)
		}
	}
	site := s.rules.Gen.Baseline(h).Site
	out.Rest = site == gen.PlaceSettlement
	out.Explore = site != "" && site != gen.PlaceSettlement
	reply(w, http.StatusOK, out)
}

func (s *Server) inspectCharacter(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	s.mu.Lock()
	defer s.mu.Unlock()
	reply(w, http.StatusOK, map[string]any{"baseline": s.rules.Gen.Baseline(h), "state": s.g.World.Tile(h), "region": s.g.World.RegionAt(h)})
}

func (s *Server) auditHandler(w http.ResponseWriter, r *http.Request) {
	bad, err := s.Audit(r.Context())
	if err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, map[string]any{"discrepancies": bad})
}

func (s *Server) digestHandler(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.g.Digest()
	if err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, map[string]any{"tick": s.g.Tick(), "digest": d.String()})
}

// reset wipes a disposable world and founds it again, now, with the
// sheets the service runs on.
func (s *Server) reset(w http.ResponseWriter, r *http.Request) {
	var req struct {
		World string `json:"world"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.World != s.cfg.World {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "name the world to reset"})
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	digest, err := SheetsDigest(s.cfg.Book)
	if err == nil {
		err = s.st.Reset(r.Context())
	}
	if err == nil {
		err = s.found(r.Context(), digest)
	}
	if err != nil {
		s.internal(w, err)
		return
	}
	s.due.Store(0)
	s.tick.Store(0)
	s.cfg.Log.Warn("world reset", "world", s.cfg.World)
	reply(w, http.StatusOK, map[string]any{"world": s.cfg.World, "tick": s.g.Tick()})
}

// clock sets the manual clock's due tick.
func (s *Server) clock(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.ManualClock {
		refuse(w, http.StatusForbidden, api.Refusal{Code: api.CodeForbidden, Message: "this world keeps wall time"})
		return
	}
	var req struct {
		Due int64 `json:"due"`
	}
	if !decode(w, r, &req) {
		return
	}
	s.due.Store(req.Due)
	reply(w, http.StatusOK, map[string]any{"due": req.Due})
}
