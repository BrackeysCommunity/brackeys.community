package gateway_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/gateway"
)

type fetched struct {
	status int
	body   string
	header http.Header
}

func fetch(t *testing.T, method, url, body string) fetched {
	t.Helper()
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	got, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return fetched{resp.StatusCode, string(got), resp.Header}
}

// TestStatic serves a build from a directory, behind Discord's prefix
// and without it: the page with the application id written in and never
// cached, hashed assets cached for good, the page for a path that is no
// file, and nothing from outside the build.
func TestStatic(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "dist")
	files := map[string]string{
		"index.html":           `<!doctype html><meta name="discord-client-id" content="__DISCORD_CLIENT_ID__"><script type="module" src="./assets/app-1a2b.js"></script>`,
		"assets/app-1a2b.js":   `console.log("activity")`,
		"favicon.svg":          `<svg xmlns="http://www.w3.org/2000/svg"/>`,
		".env":                 `SECRET=1`,
		"assets/.hidden.js":    `hidden`,
		"../outside-the-build": `outside`,
	}
	for name, body := range files {
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(filepath.Join(dir, "..", "outside-the-build"), filepath.Join(dir, "assets", "link.js")); err != nil {
		t.Fatal(err)
	}
	health := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(api.Health{OK: true, World: "w-static", Tick: 7})
	})
	gw := gateway.New(gateway.Config{Host: &fakeHost{}, AppID: "1234567890", Dir: dir, Health: health})
	t.Cleanup(gw.Close)
	srv := httptest.NewServer(gw.Handler())
	t.Cleanup(srv.Close)
	page := strings.ReplaceAll(files["index.html"], "__DISCORD_CLIENT_ID__", "1234567890")

	for _, prefix := range []string{"", "/.proxy"} {
		for _, path := range []string{"/", "/index.html", "/bench", "/some/page"} {
			got := fetch(t, "GET", srv.URL+prefix+path, "")
			if got.status != 200 || got.body != page || got.header.Get("Cache-Control") != "no-cache" || !strings.HasPrefix(got.header.Get("Content-Type"), "text/html") {
				t.Errorf("GET %s%s: %d %q %v", prefix, path, got.status, got.body, got.header)
			}
		}
		asset := fetch(t, "GET", srv.URL+prefix+"/assets/app-1a2b.js", "")
		if asset.status != 200 || asset.body != files["assets/app-1a2b.js"] || asset.header.Get("Cache-Control") != "public, max-age=31536000, immutable" ||
			!strings.Contains(asset.header.Get("Content-Type"), "javascript") || asset.header.Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("GET %s/assets/app-1a2b.js: %d %q %v", prefix, asset.status, asset.body, asset.header)
		}
		if icon := fetch(t, "GET", srv.URL+prefix+"/favicon.svg", ""); icon.status != 200 || icon.body != files["favicon.svg"] || icon.header.Get("Cache-Control") != "no-cache" {
			t.Errorf("GET %s/favicon.svg: %d %v", prefix, icon.status, icon.header)
		}
		if h := fetch(t, "GET", srv.URL+prefix+"/healthz", ""); h.status != 200 || !strings.Contains(h.body, `"w-static"`) {
			t.Errorf("GET %s/healthz: %d %q", prefix, h.status, h.body)
		}
		for path, want := range map[string]int{
			"/assets/missing.js":            404,
			"/missing.png":                  404,
			"/.env":                         404,
			"/assets/.hidden.js":            404,
			"/assets/link.js":               404,
			"/assets/..%2f..%2foutside.txt": 404,
			"/api/activity/nothing":         404,
			"/api":                          404,
			"/v1/actions":                   200,
			"/op/digest":                    200,
		} {
			got := fetch(t, "GET", srv.URL+prefix+path, "")
			if got.status != want || strings.Contains(got.body, "outside") || strings.Contains(got.body, "SECRET") || (want == 200 && got.body != page) {
				t.Errorf("GET %s%s: %d %q, want %d", prefix, path, got.status, got.body, want)
			}
		}
		if got := fetch(t, "HEAD", srv.URL+prefix+"/", ""); got.status != 200 || got.body != "" {
			t.Errorf("HEAD %s/: %d %q", prefix, got.status, got.body)
		}
		for _, path := range []string{"/", "/assets/app-1a2b.js", "/v1/actions"} {
			if got := fetch(t, "POST", srv.URL+prefix+path, "{}"); got.status != 405 {
				t.Errorf("POST %s%s: %d", prefix, path, got.status)
			}
		}
	}
	// Only one prefix is stripped, and only a whole one.
	for _, path := range []string{"/.proxy/.proxy/assets/app-1a2b.js", "/.proxyassets/app-1a2b.js"} {
		if got := fetch(t, "GET", srv.URL+path, ""); got.status != 404 {
			t.Errorf("GET %s: %d", path, got.status)
		}
	}

	// No build: the paths of the API still answer, and nothing else does.
	bare := gateway.New(gateway.Config{Host: &fakeHost{}, Dev: true})
	t.Cleanup(bare.Close)
	none := httptest.NewServer(bare.Handler())
	t.Cleanup(none.Close)
	if got := fetch(t, "GET", none.URL+"/", ""); got.status != 404 {
		t.Errorf("GET / with no build: %d", got.status)
	}
	if got := fetch(t, "GET", none.URL+"/healthz", ""); got.status != 200 {
		t.Errorf("GET /healthz with no build: %d", got.status)
	}
	if got := fetch(t, "POST", none.URL+api.PathActivityToken, `{"dev":"u-1"}`); got.status != 200 || got.header.Get("Cache-Control") != "no-store" {
		t.Errorf("signing in with no build: %d %v", got.status, got.header)
	}
}

type captured struct {
	name, distinct string
	props          map[string]any
}

type capturer struct {
	mu  sync.Mutex
	got []captured
}

func (c *capturer) Capture(name, distinct string, props map[string]any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.got = append(c.got, captured{name, distinct, props})
}

// TestBeacon posts telemetry: plain values are logged and sent on as a
// product event under the viewer's character when their socket is open,
// a session is never passed on, and anything else is turned away.
func TestBeacon(t *testing.T) {
	h := &fakeHost{players: map[string]string{"u-1": "c-1"}, states: map[string]api.ActivityState{"c-1": solo("c-1")}}
	events := &capturer{}
	w := &world{t: t, clock: newClock(), logs: &bytes.Buffer{}}
	sink := &lockedWriter{w: w.logs}
	w.gw = gateway.New(gateway.Config{Host: h, Dev: true, Clock: w.clock, Events: events, Log: slog.New(slog.NewTextHandler(sink, nil))})
	if err := w.gw.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	w.srv = httptest.NewServer(w.gw.Handler())
	t.Cleanup(w.stop)
	url := w.srv.URL + "/.proxy" + api.PathActivityLog
	session := w.signIn("u-1").Session

	if got := fetch(t, "POST", url, `{"event":"boot","viewport":"390x844","pointer":"coarse","dpr":3,"touch":true,"nested":{"a":1},"list":[1],"bad key":"x"}`); got.status != 204 {
		t.Fatalf("a beacon: %d %s", got.status, got.body)
	}
	v := w.join("u-1", "i-1", api.Viewer{}, nil)
	v.state()
	long := strings.Repeat("m", 300)
	if got := fetch(t, "POST", url, `{"event":"drop","miss":17.5,"note":"`+long+`","session":"`+session+`"}`); got.status != 204 {
		t.Fatalf("a beacon with a session: %d %s", got.status, got.body)
	}
	for name, body := range map[string]string{
		"no event":         `{"viewport":"1x1"}`,
		"an event of {}":   `{"event":{}}`,
		"an unnamed event": `{"event":"two words"}`,
		"a list":           `[1,2,3]`,
		"no JSON":          `boot`,
		"past the cap":     `{"event":"boot","pad":"` + strings.Repeat("x", 5000) + `"}`,
	} {
		if got := fetch(t, "POST", url, body); got.status != 400 {
			t.Errorf("a beacon with %s: %d", name, got.status)
		}
	}
	if got := fetch(t, "GET", url, ""); got.status != 404 {
		t.Errorf("reading the beacon path: %d", got.status)
	}

	events.mu.Lock()
	defer events.mu.Unlock()
	if len(events.got) != 2 {
		t.Fatalf("%d events were sent on, want 2: %+v", len(events.got), events.got)
	}
	boot, drop := events.got[0], events.got[1]
	if boot.name != "mmo_activity" || boot.distinct != "activity" || len(boot.props) != 5 || boot.props["event"] != "boot" || boot.props["viewport"] != "390x844" ||
		boot.props["dpr"] != 3.0 || boot.props["touch"] != true {
		t.Fatalf("the boot event: %+v", boot)
	}
	if drop.distinct != "c-1" || drop.props["miss"] != 17.5 || len(drop.props["note"].(string)) != 200 || drop.props["session"] != nil {
		t.Fatalf("the drop event: %+v", drop)
	}
	out := sink.String()
	if !strings.Contains(out, "event=boot") || !strings.Contains(out, "viewport=390x844") || strings.Contains(out, session) || strings.Contains(out, "u-1") {
		t.Fatalf("the beacon's log lines:\n%s", out)
	}
}
