package harness

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/store/pgtest"
)

func TestLoadConfigFromEnv(t *testing.T) {
	for _, k := range []string{EnvLoadPPM, EnvLoadMinutes, EnvLoadServers, EnvLoadRamp} {
		t.Setenv(k, "")
	}
	t.Setenv(service.EnvAPIToken, "new-api,old-api")
	c, err := loadConfigFromEnv(0)
	if err != nil {
		t.Fatal(err)
	}
	if c.chars != loadCharacters || c.ppm != loadPPM || c.window != loadMinutes*time.Minute || c.servers != loadServers || c.ramp || c.workers != loadWorkers {
		t.Errorf("defaults: %+v", c)
	}
	if c.tokenAPI != "new-api" {
		t.Errorf("a rotating token sends %q, want the new one", c.tokenAPI)
	}
	t.Setenv(EnvLoadMinutes, "2")
	t.Setenv(EnvLoadRamp, "1")
	if c, err = loadConfigFromEnv(40); err != nil || c.window != 2*time.Minute || !c.ramp || c.chars != 40 {
		t.Errorf("2 minutes, ramp, 40 characters: %+v %v", c, err)
	}
	for k, v := range map[string]string{EnvLoadRamp: "yes", EnvLoadServers: "27", EnvLoadPPM: "0", EnvLoadMinutes: "-1"} {
		t.Run(k, func(t *testing.T) {
			t.Setenv(k, v)
			if _, err := loadConfigFromEnv(0); err == nil {
				t.Errorf("%s=%s was taken", k, v)
			}
		})
	}
}

// TestLoadReading holds only when the client delivered the rate, every
// tick finished inside one tick and the world never fell behind.
func TestLoadReading(t *testing.T) {
	cfg := loadConfig{chars: 200, servers: 2, workers: loadWorkers}
	ok := loadPhase{ppm: 6000, took: time.Minute, presses: 5900, acted: 4000, tickMs: 3000, behind: 1,
		ticks: []api.TickTime{{Tick: 1, StepMs: 120, Behind: 0}, {Tick: 2, StepMs: 2999, Behind: 1}}, latency: []time.Duration{time.Millisecond}}
	if m := loadReading(cfg, ok); !m.Holds || strings.HasPrefix(m.Value, unmeasured) || !strings.Contains(m.Value, "2,999 ms against the 3,000 ms tick") {
		t.Errorf("a window inside its ticks: %+v", m)
	}
	over := ok
	over.ticks = []api.TickTime{{Tick: 1, StepMs: 3000}}
	behind := ok
	behind.behind = 2
	none := ok
	none.ticks = nil
	gap := ok
	gap.gaps = 1
	for name, p := range map[string]loadPhase{"a tick of a whole tick": over, "two behind": behind, "no tick": none, "a gap": gap} {
		if m := loadReading(cfg, p); m.Holds || strings.HasPrefix(m.Value, unmeasured) {
			t.Errorf("%s: %+v", name, m)
		}
	}
	short := ok
	short.presses = 5600
	m := loadReading(cfg, short)
	if m.Holds || !strings.HasPrefix(m.Value, unmeasured+"not measured: the client reached only 5,600 a minute") {
		t.Errorf("a client short of the rate: %+v", m)
	}
}

// TestLoadOnAService presses an in-process world on a short real tick:
// the characters are made across the servers with the starts in turn,
// the bucket delivers the rate, the reading holds, the ramp adds its
// stage, and a rate no client could reach is not measured.
func TestLoadOnAService(t *testing.T) {
	if testing.Short() {
		t.Skip("runs a world service on a real clock")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sec, _ := testkit.Secrets(t, "mmo/load-test", "w-load")
	b := testkit.Book(t)
	srv, err := service.Open(ctx, pgtest.Pool(t), service.Config{Secrets: sec, TickSeconds: 2, Book: b, OperatorToken: "op",
		Disposable: true, Poll: 10 * time.Millisecond, Log: slog.New(slog.NewJSONHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	hs := httptest.NewServer(srv.Handler())
	done := make(chan error, 1)
	go func() { done <- srv.Run(ctx) }()
	defer func() {
		cancel()
		if err := <-done; err != nil && !errors.Is(err, context.Canceled) {
			t.Errorf("the world stopped: %v", err)
		}
		hs.Close()
		srv.Close(context.Background())
	}()

	if _, err := runLoad(ctx, b, hs.URL, loadConfig{ppm: 60, window: time.Second, chars: 1, servers: 1, workers: 1, poll: time.Second, opTok: "not-op"}); err == nil {
		t.Error("the run read the tick ring without the operator's token")
	}

	cfg := loadConfig{ppm: 1200, window: 16 * time.Second, chars: 12, servers: 3, workers: 8, poll: 3 * time.Second, opTok: "op",
		ramp: true, stage: 4 * time.Second, stages: 1}
	res, err := runLoad(ctx, b, hs.URL, cfg)
	if err != nil {
		t.Fatal(err)
	}
	w := res.window
	if w.creates != 12 || w.byServer["load-a"] != 4 || w.byServer["load-b"] != 4 || w.byServer["load-c"] != 4 {
		t.Errorf("characters %d by server %v", w.creates, w.byServer)
	}
	op := client.New(hs.URL, "op")
	ids := map[string]bool{}
	for i, p := range res.players {
		raw, err := op.Character(ctx, p.Character)
		if err != nil {
			t.Fatal(err)
		}
		var c struct{ Server string }
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatal(err)
		}
		if c.Server != serverName(i%3) || p.Start != loadStarts[i%3] {
			t.Errorf("character %d plays from %q with %q", i, c.Server, p.Start)
		}
		if ids[p.Character] {
			t.Errorf("character %s made twice", p.Character)
		}
		ids[p.Character] = true
	}
	if got := w.delivered(); got*10 < cfg.ppm*9 || got*10 > cfg.ppm*11 {
		t.Errorf("delivered %d a minute, asked %d", got, cfg.ppm)
	}
	if w.acted == 0 || w.failed != 0 {
		t.Errorf("%d acted, %d failed (%v)", w.acted, w.failed, w.lastErr)
	}
	m := loadReading(cfg, w)
	if !m.Holds || strings.HasPrefix(m.Value, unmeasured) {
		t.Errorf("the reading at %d a minute: %+v", cfg.ppm, m)
	}
	if len(w.ticks) < 5 || w.tickMs != 2000 {
		t.Errorf("%d ticks read against %d ms", len(w.ticks), w.tickMs)
	}
	if len(res.ramp) != 1 || res.ramp[0].ppm != 2*cfg.ppm || res.ramp[0].presses == 0 {
		t.Errorf("ramp: %+v", res.ramp)
	}
	dir := t.TempDir()
	if err := loadDoc(hs.URL, cfg, res, m).save(dir, "load.md"); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "load.md"))
	if err != nil || !strings.Contains(string(body), "Ramp, for information") || !strings.Contains(string(body), m.Value) {
		t.Errorf("load.md: %v\n%s", err, body)
	}
	t.Logf("%s; ramp: %s; by policy: %s", m.Value, rampLine(cfg, res.ramp[0]), byPolicy(w.byPolicy))

	short := loadConfig{ppm: 3_000_000, window: 3 * time.Second, chars: 4, servers: 2, workers: 1, poll: time.Second, opTok: "op"}
	sr, err := runLoad(ctx, b, hs.URL, short)
	if err != nil {
		t.Fatal(err)
	}
	if m := loadReading(short, sr.window); m.Holds || !strings.HasPrefix(m.Value, unmeasured+"not measured: the client reached only") {
		t.Errorf("a rate no client reaches: %+v", m)
	}
}
