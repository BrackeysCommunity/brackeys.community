package gateway

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"jams.team/mmo-world/api"
)

// structural: the live map's caps on the Activity listener, a second.
const (
	maxMapReads    = 20  // map reads one Discord user may make
	maxMapOverlays = 2   // overlays one Discord user may ask for
	maxMapAll      = 400 // map reads from everyone
)

// mapLimits are the map's windows: everyone's, and each user's.
type mapLimits struct {
	mu    sync.Mutex
	all   window
	users map[string]*mapUser
	swept time.Time
}

type mapUser struct {
	reads    window // an overlay is a read too
	overlays window
}

// mapRoutes mounts the live map's reads. The base is the same for
// everyone; the overlay is the signed-in viewer's, filtered by the world.
func (g *Gateway) mapRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET "+api.PathActivityMapTick, g.mapIndex)
	mux.HandleFunc("GET "+api.PathActivityMapStyle, g.mapStyle)
	mux.HandleFunc("GET "+api.PathActivityMapRegions, g.mapRegions)
	mux.HandleFunc("GET "+api.PathActivityMapChunk, g.mapChunk)
	mux.HandleFunc("GET "+api.PathActivityMapOverlay, g.mapOverlay)
}

func (g *Gateway) mapIndex(w http.ResponseWriter, r *http.Request) {
	if g.mapRead(w, r) {
		v, err := g.cfg.Host.MapIndex(r.Context())
		g.mapReply(w, v, nil, err)
	}
}

func (g *Gateway) mapStyle(w http.ResponseWriter, r *http.Request) {
	if g.mapRead(w, r) {
		v, err := g.cfg.Host.MapStyle(r.Context())
		g.mapReply(w, v, nil, err)
	}
}

func (g *Gateway) mapRegions(w http.ResponseWriter, r *http.Request) {
	if g.mapRead(w, r) {
		v, err := g.cfg.Host.MapRegions(r.Context())
		g.mapReply(w, v, nil, err)
	}
}

func (g *Gateway) mapChunk(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	a, errA := strconv.ParseInt(q.Get("a"), 10, 64)
	b, errB := strconv.ParseInt(q.Get("b"), 10, 64)
	level := q.Get("level")
	if errA != nil || errB != nil || level != api.LevelArea && level != api.LevelTile {
		refuse(w, http.StatusBadRequest, api.CodeBadJSON, "a chunk is ?a=&b= and a level of area or tile")
		return
	}
	if !g.mapRead(w, r) {
		return
	}
	v, ref, err := g.cfg.Host.MapChunk(r.Context(), a, b, level)
	g.mapReply(w, v, ref, err)
}

// mapOverlay is the live layers the session's character may see. A
// session with no character is a player, who is shown none.
func (g *Gateway) mapOverlay(w http.ResponseWriter, r *http.Request) {
	q, ref := api.ParseMapOverlayQuery(r.URL.Query())
	if ref != nil {
		refuse(w, http.StatusBadRequest, ref.Code, ref.Message)
		return
	}
	discord, ok := g.mapSession(w, r, true, "sign in to see the map's live layers")
	if !ok {
		return
	}
	id, err := g.cfg.Host.CharacterOf(r.Context(), discord)
	if err != nil {
		g.mapReply(w, nil, nil, err)
		return
	}
	v, ref, err := g.cfg.Host.MapOverlay(r.Context(), id, q)
	if id == "" && v.Viewer == api.ViewerAnonymous {
		v.Viewer = api.ViewerPlayer
	}
	g.mapReply(w, v, ref, err)
}

// mapRead admits one read of the shared base by a signed-in session, or
// refuses it.
func (g *Gateway) mapRead(w http.ResponseWriter, r *http.Request) bool {
	_, ok := g.mapSession(w, r, false, "sign in to read the map")
	return ok
}

// mapSession admits one map read, an overlay when overlay is set, by the
// request's session, or refuses it: 401 without a valid session, 429 when
// a window is full.
func (g *Gateway) mapSession(w http.ResponseWriter, r *http.Request, overlay bool, why string) (string, bool) {
	discord, ok := g.bearer(r)
	if !ok {
		refuse(w, http.StatusUnauthorized, api.CodeForbidden, why)
		return "", false
	}
	if !g.maps.admit(g.clock.Now(), discord, overlay) {
		refuse(w, http.StatusTooManyRequests, api.CodeBusy, "too many map reads")
		return "", false
	}
	return discord, true
}

// bearer is the Discord user a request's session names; ok is false when
// it carries none or the one it carries is forged, malformed or past.
func (g *Gateway) bearer(r *http.Request) (discord string, ok bool) {
	scheme, token, found := strings.Cut(r.Header.Get("Authorization"), " ")
	if !found || !strings.EqualFold(scheme, "Bearer") {
		return "", false
	}
	discord, _, ok = g.verify(strings.TrimSpace(token))
	if discord == "" {
		return "", false
	}
	return discord, ok
}

func (g *Gateway) mapReply(w http.ResponseWriter, v any, ref *api.Refusal, err error) {
	switch {
	case err != nil:
		g.log.Error("activity: reading the map", "err", err.Error())
		refuse(w, http.StatusServiceUnavailable, api.CodeInternal, "the world could not be asked")
	case ref != nil:
		reply(w, refusalStatus(ref.Code), *ref)
	default:
		reply(w, http.StatusOK, v)
	}
}

func refusalStatus(code string) int {
	switch code {
	case api.CodeNotFound:
		return http.StatusNotFound
	case api.CodeForbidden:
		return http.StatusUnauthorized
	case api.CodeBusy:
		return http.StatusTooManyRequests
	case api.CodeInternal:
		return http.StatusServiceUnavailable
	default:
		return http.StatusBadRequest
	}
}

// admit counts one map read now, and an overlay when overlay is set,
// unless a window it counts in is full; then it counts nothing. discord is
// never empty: every map read is signed.
func (m *mapLimits) admit(now time.Time, discord string, overlay bool) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sweep(now)
	u := m.users[discord]
	if u == nil {
		u = &mapUser{}
	}
	if !m.all.room(now, maxMapAll) || !u.reads.room(now, maxMapReads) || overlay && !u.overlays.room(now, maxMapOverlays) {
		return false
	}
	m.all = append(m.all, now)
	u.reads = append(u.reads, now)
	if overlay {
		u.overlays = append(u.overlays, now)
	}
	if m.users == nil {
		m.users = map[string]*mapUser{}
	}
	m.users[discord] = u
	return true
}

// sweep forgets, at most once a second, the users with no read in the
// last second, so the windows stay as many as the users reading now.
func (m *mapLimits) sweep(now time.Time) {
	if now.Sub(m.swept) < time.Second {
		return
	}
	m.swept = now
	for k, u := range m.users {
		if u.reads.room(now, 1) {
			delete(m.users, k)
		}
	}
}

// room drops the events a second old and reports whether one more fits
// under most.
func (w *window) room(now time.Time, most int) bool {
	*w = slices.DeleteFunc(*w, func(t time.Time) bool { return now.Sub(t) >= time.Second })
	return len(*w) < most
}
