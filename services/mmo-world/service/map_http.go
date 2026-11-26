package service

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"jams.team/mmo-world/api"
)

// structural: the most chunks one overlay request names (the clients ask
// for the nearest when more are in view).
const maxMapChunks = 64

const overlayShape = "an overlay names up to 64 chunks as chunks=a.b,…, or scope=sight"

// MapHost is what the map's routes read: the same functions for the
// world's HTTP, the Activity's gateway and the harness.
type MapHost interface {
	MapIndex(ctx context.Context) (api.MapIndex, error)
	MapStyle(ctx context.Context) (api.MapStyle, error)
	MapRegions(ctx context.Context) (api.MapRegions, error)
	MapChunk(ctx context.Context, a, b int64, level string) (api.MapChunk, *api.Refusal, error)
	MapOverlay(ctx context.Context, characterID string, q api.MapOverlayQuery) (api.MapOverlay, *api.Refusal, error)
	MapFocus(ctx context.Context, server string) (api.MapFocus, error)
	CharacterOf(ctx context.Context, discordID string) (string, error)
}

var (
	_ MapHost = (*Server)(nil)
	_ MapHost = LocalHost{}
)

// MapHandler serves /v1/map/{index,style,regions,chunk,overlay,focus} from h,
// unguarded: the caller wraps it. No reply is kept by a cache.
func MapHandler(h MapHost) http.Handler {
	m := mapRoutes{h}
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+api.PathMapIndex, m.index)
	mux.HandleFunc("GET "+api.PathMapStyle, m.style)
	mux.HandleFunc("GET "+api.PathMapRegions, m.regions)
	mux.HandleFunc("GET "+api.PathMapChunk, m.chunk)
	mux.HandleFunc("GET "+api.PathMapOverlay, m.overlay)
	mux.HandleFunc("GET "+api.PathMapFocus, m.focus)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		mux.ServeHTTP(w, r)
	})
}

// ParseChunks reads "a.b,a.b": at most 64, each two integers.
func ParseChunks(s string) ([]api.MapChunkID, *api.Refusal) {
	bad := &api.Refusal{Code: api.CodeBadJSON, Message: overlayShape}
	if s == "" {
		return nil, bad
	}
	parts := strings.Split(s, ",")
	if len(parts) > maxMapChunks {
		return nil, bad
	}
	out := make([]api.MapChunkID, len(parts))
	for i, p := range parts {
		sa, sb, ok := strings.Cut(p, ".")
		a, errA := strconv.ParseInt(sa, 10, 64)
		b, errB := strconv.ParseInt(sb, 10, 64)
		if !ok || errA != nil || errB != nil {
			return nil, bad
		}
		out[i] = api.MapChunkID{A: a, B: b}
	}
	return out, nil
}

type mapRoutes struct{ h MapHost }

// answer writes a map read's reply, refusal or failure.
func (m mapRoutes) answer(w http.ResponseWriter, v any, ref *api.Refusal, err error) {
	switch {
	case errors.Is(err, errClosed) || errors.Is(err, errStale):
		refuseUnusable(w, err)
	case err != nil:
		if l, ok := m.h.(interface{ mapFailed(error) }); ok {
			l.mapFailed(err)
		}
		refuse(w, http.StatusInternalServerError, api.Refusal{Code: api.CodeInternal, Message: "internal error"})
	case ref != nil:
		status := http.StatusBadRequest
		if ref.Code == api.CodeNotFound {
			status = http.StatusNotFound
		}
		refuse(w, status, *ref)
	default:
		reply(w, http.StatusOK, v)
	}
}

func (m mapRoutes) index(w http.ResponseWriter, r *http.Request) {
	v, err := m.h.MapIndex(r.Context())
	m.answer(w, v, nil, err)
}

func (m mapRoutes) style(w http.ResponseWriter, r *http.Request) {
	v, err := m.h.MapStyle(r.Context())
	m.answer(w, v, nil, err)
}

func (m mapRoutes) regions(w http.ResponseWriter, r *http.Request) {
	v, err := m.h.MapRegions(r.Context())
	m.answer(w, v, nil, err)
}

func (m mapRoutes) chunk(w http.ResponseWriter, r *http.Request) {
	a, okA := intParam(r, "a")
	b, okB := intParam(r, "b")
	if !okA || !okB {
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "a chunk is ?a=&b=&level="})
		return
	}
	v, ref, err := m.h.MapChunk(r.Context(), a, b, r.URL.Query().Get("level"))
	m.answer(w, v, ref, err)
}

// overlay is one viewer's live layers: by discordId, as the site has
// matched its visitor; none is anonymous, and one with no character is a
// player, who is shown no live layer either.
func (m mapRoutes) overlay(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var oq api.MapOverlayQuery
	switch chunks, scope := q.Get("chunks"), q.Get("scope"); {
	case chunks != "" && scope == "":
		ids, ref := ParseChunks(chunks)
		if ref != nil {
			refuse(w, http.StatusBadRequest, *ref)
			return
		}
		oq.Chunks = ids
	case chunks == "" && scope == "sight":
		oq.Sight = true
	default:
		refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: overlayShape})
		return
	}
	discord, id := q.Get("discordId"), ""
	if discord != "" {
		var err error
		if id, err = m.h.CharacterOf(r.Context(), discord); err != nil {
			m.answer(w, nil, nil, err)
			return
		}
	}
	v, ref, err := m.h.MapOverlay(r.Context(), id, oq)
	if discord != "" && v.Viewer == api.ViewerAnonymous {
		v.Viewer = api.ViewerPlayer
	}
	m.answer(w, v, ref, err)
}

func (m mapRoutes) focus(w http.ResponseWriter, r *http.Request) {
	v, err := m.h.MapFocus(r.Context(), r.URL.Query().Get("server"))
	m.answer(w, v, nil, err)
}

// mapFailed logs a map read the world could not answer.
func (s *Server) mapFailed(err error) { s.cfg.Log.Error("map read failed", "err", err.Error()) }
