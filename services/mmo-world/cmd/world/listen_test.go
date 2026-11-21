package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/store/pgtest"
)

// structural: how long the listener gets to come up.
const listenWait = 30 * time.Second

// TestListenStandsBy serves a port as the Activity's is served: in
// standby, health is up and everything else is unavailable, until the
// handler that holds the world takes over.
func TestListenStandsBy(t *testing.T) {
	port, err := pgtest.FreePort()
	if err != nil {
		t.Fatal(err)
	}
	failed := make(chan struct{}, 1)
	srv, serve := listen(strconv.Itoa(port), publicLimits, service.Standby("w-standby"), slog.New(slog.DiscardHandler), func() { failed <- struct{}{} })
	t.Cleanup(func() { _ = srv.Close() })
	if srv.ReadTimeout == 0 || srv.IdleTimeout == 0 {
		t.Fatalf("the public listener waits without limit: read %s, idle %s", srv.ReadTimeout, srv.IdleTimeout)
	}
	get := func(path string) (int, string) {
		t.Helper()
		for deadline := time.Now().Add(listenWait); ; time.Sleep(10 * time.Millisecond) {
			resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d%s", port, path))
			if err != nil {
				select {
				case <-failed:
					t.Fatal("the listener failed")
				default:
				}
				if time.Now().After(deadline) {
					t.Fatal(err)
				}
				continue
			}
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			return resp.StatusCode, string(body)
		}
	}
	status, body := get(api.PathHealth)
	var h api.Health
	if err := json.Unmarshal([]byte(body), &h); err != nil || status != http.StatusOK || !h.Standby || h.World != "w-standby" {
		t.Fatalf("health in standby: %d %s", status, body)
	}
	for _, path := range []string{"/", "/index.html", "/assets/app.js", api.PathActivityToken, api.PathActivitySocket, "/.proxy" + api.PathActivityToken} {
		if status, _ := get(path); status != http.StatusServiceUnavailable {
			t.Errorf("GET %s in standby: %d", path, status)
		}
	}
	serve(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "held") }))
	if status, body := get("/"); status != http.StatusOK || body != "held" {
		t.Fatalf("after the world is held: %d %q", status, body)
	}
}
