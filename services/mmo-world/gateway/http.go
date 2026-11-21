package gateway

import (
	"bytes"
	"encoding/json"
	"errors"
	"html"
	"io"
	"maps"
	"net/http"
	"os"
	"path"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/api"
)

// structural: the static build's files and caching, and the bounds of a
// telemetry beacon.
const (
	indexFile      = "index.html"
	assetsDir      = "assets/"
	cacheForever   = "public, max-age=31536000, immutable"
	maxBeaconProps = 24
	maxBeaconText  = 200
	maxBeacons     = 50 // a second, from everyone
	maxExchanges   = 10 // codes traded with Discord a second, from everyone
	beaconEvent    = "mmo_activity"
	beaconAnyone   = "activity"
)

// Handler serves the Activity listener: the sign-in, the socket, the
// telemetry beacon and the static build, with or without the prefix
// Discord's proxy adds.
func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+api.PathHealth, g.health)
	mux.HandleFunc("POST "+api.PathActivityToken, g.token)
	mux.HandleFunc("GET "+api.PathActivitySocket, g.socket)
	mux.HandleFunc("POST "+api.PathActivityLog, g.beacon)
	// An unknown API path is not a page of the Activity.
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		refuse(w, http.StatusNotFound, api.CodeNotFound, "no such path")
	})
	mux.HandleFunc("/", g.static)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if rest, ok := strings.CutPrefix(r.URL.Path, api.ActivityProxyPrefix); ok && (rest == "" || rest[0] == '/') {
			r = r.Clone(r.Context())
			r.URL.Path, r.URL.RawPath = "/"+strings.TrimPrefix(rest, "/"), ""
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})
}

func reply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func refuse(w http.ResponseWriter, status int, code, text string) {
	reply(w, status, api.Refusal{Code: code, Message: text})
}

func (g *Gateway) health(w http.ResponseWriter, r *http.Request) {
	if g.cfg.Health != nil {
		g.cfg.Health.ServeHTTP(w, r)
		return
	}
	reply(w, http.StatusOK, api.Health{OK: true, Version: api.Version})
}

// token trades the Embedded App SDK's code for a session of the
// gateway's own. Discord's token is used once, to learn who signed in,
// and thrown away.
func (g *Gateway) token(w http.ResponseWriter, r *http.Request) {
	var req api.TokenRequest
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || (req.Code == "") == (req.Dev == "") {
		refuse(w, http.StatusBadRequest, api.CodeBadJSON, "send the code the sign-in gave")
		return
	}
	var discord string
	switch {
	case req.Dev != "":
		if !g.cfg.Dev {
			refuse(w, http.StatusNotFound, api.CodeNotFound, "no such sign-in")
			return
		}
		if !named(req.Dev) {
			refuse(w, http.StatusBadRequest, api.CodeBadJSON, "that names no Discord user")
			return
		}
		discord = req.Dev
	case g.cfg.AppID == "" || g.cfg.ClientSecret == "":
		refuse(w, http.StatusServiceUnavailable, api.CodeInternal, "sign-in through Discord is not set up here")
		return
	case !g.under(&g.exchanges, maxExchanges):
		// A flood of codes would spend the application's own limit at Discord.
		refuse(w, http.StatusTooManyRequests, api.CodeBusy, "too many sign-ins at once")
		return
	default:
		var err error
		if discord, err = g.exchange(r.Context(), req.Code); errors.Is(err, errRefused) {
			refuse(w, http.StatusUnauthorized, api.CodeForbidden, "Discord refused the sign-in")
			return
		} else if err != nil {
			g.log.Error("activity: the sign-in failed", "err", err.Error())
			refuse(w, http.StatusBadGateway, api.CodeInternal, "Discord did not answer the sign-in")
			return
		}
	}
	id, err := g.cfg.Host.CharacterOf(r.Context(), discord)
	if err != nil {
		g.log.Error("activity: finding a character", "err", err.Error())
		refuse(w, http.StatusServiceUnavailable, api.CodeInternal, "the world could not be asked")
		return
	}
	session, expires := g.mint(discord)
	reply(w, http.StatusOK, api.TokenReply{Session: session, Expires: expires, DiscordID: discord, CharacterID: id})
}

// window holds the times of the last second's events, for a per-second cap.
type window []time.Time

// take counts one more now, unless that is more than most.
func (w *window) take(now time.Time, most int) bool {
	*w = slices.DeleteFunc(*w, func(t time.Time) bool { return now.Sub(t) >= time.Second })
	if len(*w) >= most {
		return false
	}
	*w = append(*w, now)
	return true
}

// under counts one more of something everyone shares this second, unless
// that is more than most.
func (g *Gateway) under(w *window, most int) bool {
	now := g.clock.Now()
	g.mu.Lock()
	defer g.mu.Unlock()
	return w.take(now, most)
}

// beacon takes one line of client telemetry: a named event with plain
// values. It is logged and sent on as a product event, and changes
// nothing. A session, when the beacon carries one, only picks whose event
// it is: it is neither logged nor sent on.
func (g *Gateway) beacon(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	var raw map[string]any
	if err != nil || json.Unmarshal(body, &raw) != nil {
		refuse(w, http.StatusBadRequest, api.CodeBadJSON, "a beacon is one small JSON object")
		return
	}
	event, _ := raw["event"].(string)
	if !named(event) {
		refuse(w, http.StatusBadRequest, api.CodeBadJSON, "a beacon names its event")
		return
	}
	if !g.under(&g.beacons, maxBeacons) {
		refuse(w, http.StatusTooManyRequests, api.CodeBusy, "too many beacons")
		return
	}
	props := map[string]any{"event": event}
	attrs := []any{"event", event}
	for _, k := range slices.Sorted(maps.Keys(raw)) {
		if k == "event" || k == "session" || !named(k) || len(props) > maxBeaconProps {
			continue
		}
		switch v := raw[k].(type) {
		case string:
			if len(v) > maxBeaconText {
				v = strings.ToValidUTF8(v[:maxBeaconText], "")
			}
			props[k] = v
		case float64, bool:
			props[k] = v
		default:
			continue
		}
		attrs = append(attrs, k, props[k])
	}
	who := beaconAnyone
	if session, _ := raw["session"].(string); session != "" {
		if discord, _, ok := g.verify(session); ok {
			if id := g.seated(discord); id != "" {
				who = id
			}
		}
	}
	g.log.Info("activity", attrs...)
	if g.cfg.Events != nil {
		g.cfg.Events.Capture(beaconEvent, who, props)
	}
	w.WriteHeader(http.StatusNoContent)
}

// seated is the character a Discord user has a socket open for, or "".
func (g *Gateway) seated(discord string) string {
	g.mu.Lock()
	defer g.mu.Unlock()
	for c := range g.conns {
		if c.discord == discord && c.seat != nil {
			return c.seat.Char
		}
	}
	return ""
}

// static serves the Activity's build. The page itself is never cached,
// since it names the hashed files; those are cached for good. A path
// that is no file and has no extension is a page of the Activity.
func (g *Gateway) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		refuse(w, http.StatusMethodNotAllowed, api.CodeBadJSON, "read only")
		return
	}
	if g.cfg.Dir == "" {
		refuse(w, http.StatusNotFound, api.CodeNotFound, "no Activity build is served here")
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" || name == indexFile {
		g.index(w)
		return
	}
	if slices.ContainsFunc(strings.Split(name, "/"), func(part string) bool { return strings.HasPrefix(part, ".") }) {
		refuse(w, http.StatusNotFound, api.CodeNotFound, "no such file")
		return
	}
	// OpenInRoot keeps a path, and any link on it, inside the build.
	if f, err := os.OpenInRoot(g.cfg.Dir, name); err == nil {
		defer func() { _ = f.Close() }()
		if info, err := f.Stat(); err == nil && info.Mode().IsRegular() {
			cache := "no-cache"
			if strings.HasPrefix(name, assetsDir) {
				cache = cacheForever
			}
			w.Header().Set("Cache-Control", cache)
			http.ServeContent(w, r, name, info.ModTime(), f)
			return
		}
	}
	if path.Ext(name) == "" {
		g.index(w)
		return
	}
	refuse(w, http.StatusNotFound, api.CodeNotFound, "no such file")
}

// index is the build's page with the application id written in, so one
// build serves every environment.
func (g *Gateway) index(w http.ResponseWriter) {
	f, err := os.OpenInRoot(g.cfg.Dir, indexFile)
	if err != nil {
		refuse(w, http.StatusNotFound, api.CodeNotFound, "no Activity build is served here")
		return
	}
	defer func() { _ = f.Close() }()
	page, err := io.ReadAll(f)
	if err != nil {
		g.log.Error("activity: reading the page", "err", err.Error())
		refuse(w, http.StatusInternalServerError, api.CodeInternal, "the page could not be read")
		return
	}
	page = bytes.ReplaceAll(page, []byte(api.ActivityClientIDMark), []byte(html.EscapeString(g.cfg.AppID)))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(page)
}
