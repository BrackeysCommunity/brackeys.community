package main_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/coder/websocket"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/gateway"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

const (
	opToken = "op-test-token"
	// B is killed once it has caught up this many ticks of the stretch.
	catchUpBeforeKill = 10
)

// logBuffer is a process's output, read while the process still writes.
type logBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *logBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *logBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// proc is one world service process.
type proc struct {
	cmd  *exec.Cmd
	logs *logBuffer
	op   *client.HTTP
	cli  *client.HTTP
}

func env(name string, value any) string { return fmt.Sprintf("%s=%v", name, value) }

func launch(t *testing.T, bin, dbURL string, more ...string) *proc {
	t.Helper()
	port, err := pgtest.FreePort()
	if err != nil {
		t.Fatal(err)
	}
	_, secrets := testkit.Secrets(t, "mmo/kill-test-master", "w-kill")
	cmd := exec.Command(bin)
	cmd.Env = append(append(append(os.Environ(), secrets...),
		env(service.EnvDatabase, dbURL), env(service.EnvPort, port), env(service.EnvOperatorToken, opToken),
		env(service.EnvManualClock, 1), env(service.EnvPollMS, 2), env(service.EnvLogLevel, "info")), more...)
	logs := &logBuffer{}
	cmd.Stdout, cmd.Stderr = logs, logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	p := &proc{cmd: cmd, logs: logs, op: client.New(base, opToken), cli: client.New(base, "")}
	p.op.Poll, p.cli.Poll = time.Millisecond, time.Millisecond
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	ctx, cancel := context.WithTimeout(context.Background(), upWait)
	defer cancel()
	if err := p.cli.WaitHealth(ctx, func(h api.Health, err error) bool { return err == nil && h.OK }); err != nil {
		t.Fatalf("service never came up:\n%s", logs)
	}
	return p
}

// structural: how long a process gets to come up.
const upWait = 30 * time.Second

func (p *proc) setDue(t *testing.T, tick int64) {
	t.Helper()
	if err := p.op.SetClock(context.Background(), tick); err != nil {
		t.Fatal(err)
	}
}

// structural: how long a process gets to reach a tick.
const tickWait = time.Minute

func (p *proc) waitFor(t *testing.T, tick int64) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), tickWait)
	defer cancel()
	if err := p.cli.WaitTick(ctx, tick); err != nil {
		t.Fatalf("%v:\n%s", err, p.logs)
	}
}

func (p *proc) advance(t *testing.T, tick int64) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), tickWait)
	defer cancel()
	if err := p.op.Advance(ctx, tick); err != nil {
		t.Fatalf("%v:\n%s", err, p.logs)
	}
}

func (p *proc) digest(t *testing.T) string {
	t.Helper()
	d, err := p.op.Digest(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return d.Digest
}

// TestKilledServiceCatchesUp runs the same world twice, from two
// databases, under the same scripted client. One is killed with SIGKILL
// part-way through catching up a stretch nobody played, restarted, and
// left to catch up again; both must reach the same digest at the end of
// the week.
func TestKilledServiceCatchesUp(t *testing.T) {
	if testing.Short() {
		t.Skip("two simulated weeks")
	}
	bin := testkit.BuildCmd(t, "world")
	dbA, dbB := pgtest.DB(t), pgtest.DB(t)
	a, b := launch(t, bin, dbA), launch(t, bin, dbB)
	book := testkit.Book(t)
	sa, sb := agent.NewScript(a.cli, testkit.Team(book, "u", 4), "kill"), agent.NewScript(b.cli, testkit.Team(book, "u", 4), "kill")
	ctx := context.Background()
	week := int64(7 * sheets.TicksPerDay)
	away, kill := 2*week/7, 5*week/7
	play := func(from, to int64) {
		for tick := from; tick < to; tick++ {
			if err := sa.Turn(ctx, tick); err != nil {
				t.Fatal(err)
			}
			if err := sb.Turn(ctx, tick); err != nil {
				t.Fatal(err)
			}
			a.advance(t, tick+1)
			b.advance(t, tick+1)
		}
	}
	play(0, away)
	b.setDue(t, kill)
	b.waitFor(t, away+catchUpBeforeKill)
	hk, _ := b.cli.Health(ctx)
	if err := b.cmd.Process.Signal(syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	_ = b.cmd.Wait()
	t.Logf("killed B at tick %d, catching up from %d to %d", hk.Tick, away, kill)
	a.advance(t, kill)
	b = launch(t, bin, dbB)
	hb, _ := b.cli.Health(ctx)
	t.Logf("B restarted at tick %d; catching up to %d", hb.Tick, kill)
	if hb.Tick >= kill {
		t.Fatal("B was not killed before it caught up")
	}
	b.advance(t, kill)
	sb.Client = b.cli
	play(kill, week)
	da, db := a.digest(t), b.digest(t)
	t.Logf("end of week: A %s, B %s", da, db)
	if da != db {
		t.Fatal("the killed service did not catch up to the same world")
	}
	for _, p := range []*proc{a, b} {
		if !strings.Contains(p.logs.String(), "key check holds") {
			t.Fatalf("no key check in the logs:\n%s", p.logs)
		}
		// With no Activity listener, the pick windows are still kept.
		if !strings.Contains(p.logs.String(), "the pick-window clock runs") {
			t.Fatalf("no pick-window clock in the logs:\n%s", p.logs)
		}
		if strings.Contains(p.logs.String(), "[redacted]") {
			t.Fatal("a key reached the log guard")
		}
	}
}

// TestActivityListener runs the service with an Activity port: a second
// listener that signs a player in, opens their socket and shows them
// their state, carries none of the API's paths, and closes its sockets
// when the service stops. The client secret never reaches the log.
func TestActivityListener(t *testing.T) {
	bin := testkit.BuildCmd(t, "world")
	port, err := pgtest.FreePort()
	if err != nil {
		t.Fatal(err)
	}
	const secret = "the-application's-client-secret"
	p := launch(t, bin, pgtest.DB(t), env(gateway.EnvPort, port), env(gateway.EnvDev, 1), env(service.EnvDisposable, 1),
		env(gateway.EnvAppID, "1234567890"), env(gateway.EnvClientSecret, secret))
	ctx, cancel := context.WithTimeout(context.Background(), upWait)
	defer cancel()
	rep, ref, err := p.cli.Act(ctx, api.ActionRequest{InteractionID: "start", DiscordID: "u-activity", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	base := fmt.Sprintf("127.0.0.1:%d", port)
	call := func(method, path, body string) (int, string) {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, method, "http://"+base+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%v:\n%s", err, p.logs)
		}
		defer func() { _ = resp.Body.Close() }()
		out, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(out)
	}
	if status, body := call("GET", api.PathHealth, ""); status != http.StatusOK || !strings.Contains(body, `"w-kill"`) {
		t.Fatalf("health on the Activity listener: %d %s", status, body)
	}
	// The API's paths are not on the public listener.
	for _, path := range []string{api.PathActions, api.PathOperator, api.PathOperatorDigest, api.PathMap, api.PathMapIndex, api.PathMapOverlay} {
		if status, body := call("POST", path, `{"interactionId":"x","discordId":"u-2","kind":"create"}`); status == http.StatusOK || strings.Contains(body, "character") {
			t.Fatalf("POST %s on the Activity listener: %d %s", path, status, body)
		}
		if status, body := call("GET", path, ""); status != http.StatusNotFound {
			t.Fatalf("GET %s on the Activity listener: %d %s", path, status, body)
		}
	}
	status, body := call("POST", "/.proxy"+api.PathActivityToken, `{"dev":"u-activity"}`)
	var signed api.TokenReply
	if err := json.Unmarshal([]byte(body), &signed); err != nil || status != http.StatusOK || signed.CharacterID != rep.Character.ID {
		t.Fatalf("signing in: %d %s", status, body)
	}
	ws, resp, err := websocket.Dial(ctx, "ws://"+base+api.PathActivitySocket, nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = ws.CloseNow() }()
	ws.SetReadLimit(1 << 22)
	hello, _ := json.Marshal(api.ClientMessage{T: "hello", Hello: &api.ClientHello{Session: signed.Session, Instance: "i-1"}})
	if err := ws.Write(ctx, websocket.MessageText, hello); err != nil {
		t.Fatal(err)
	}
	read := func() api.ServerMessage {
		t.Helper()
		_, data, err := ws.Read(ctx)
		if err != nil {
			t.Fatalf("%v:\n%s", err, p.logs)
		}
		var msg api.ServerMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Fatal(err)
		}
		return msg
	}
	first := read()
	if first.State == nil || first.State.Character.ID != rep.Character.ID || first.State.Bench == nil || first.State.Now == 0 {
		t.Fatalf("the first frame: %+v", first)
	}
	// A tick reaches the open socket as a new state.
	p.advance(t, 1)
	if next := read(); next.State == nil || next.State.Tick != 1 {
		t.Fatalf("the frame after a tick: %+v", next)
	}
	if err := p.cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	_, _, err = ws.Read(ctx)
	var ce websocket.CloseError
	if !errors.As(err, &ce) || ce.Code != websocket.StatusGoingAway {
		t.Fatalf("the socket at shutdown ended with %v", err)
	}
	if err := p.cmd.Wait(); err != nil {
		t.Fatalf("the service stopped with %v:\n%s", err, p.logs)
	}
	logs := p.logs.String()
	if strings.Contains(logs, secret) || strings.Contains(logs, "[redacted]") || !strings.Contains(logs, "the Activity is served") {
		t.Fatalf("the service's log:\n%s", logs)
	}
}

// TestActivityNeedsDiscord refuses to start a world players keep with an
// Activity port and no Discord application, and ignores dev sign-in
// there.
func TestActivityNeedsDiscord(t *testing.T) {
	bin := testkit.BuildCmd(t, "world")
	_, secrets := testkit.Secrets(t, "mmo/kill-test-master", "w-kept")
	run := func(more ...string) string {
		t.Helper()
		cmd := exec.Command(bin)
		cmd.Env = append(append(append(os.Environ(), secrets...), env(service.EnvAPIToken, "api-token"), env(service.EnvDatabase, "postgres://127.0.0.1:1/none?connect_timeout=1"),
			env(gateway.EnvPort, 18999), env(gateway.EnvDev, 1)), more...)
		out, err := cmd.CombinedOutput()
		if err == nil {
			t.Fatalf("the service ran:\n%s", out)
		}
		return string(out)
	}
	if out := run(); !strings.Contains(out, gateway.EnvAppID) || !strings.Contains(out, "world players keep") {
		t.Fatalf("no Discord application:\n%s", out)
	}
	if out := run(env(gateway.EnvAppID, "1234567890")); !strings.Contains(out, gateway.EnvClientSecret) {
		t.Fatalf("no client secret:\n%s", out)
	}
	if out := run(env(gateway.EnvPort, "eighty")); !strings.Contains(out, gateway.EnvPort) {
		t.Fatalf("a port that is no number:\n%s", out)
	}
	if out := run(env(gateway.EnvPort, 8080)); !strings.Contains(out, "must not be the API's") {
		t.Fatalf("the API's own port:\n%s", out)
	}
	// With both, it gets as far as the database, having set dev aside.
	out := run(env(gateway.EnvAppID, "1234567890"), env(gateway.EnvClientSecret, "a-secret"))
	if !strings.Contains(out, gateway.EnvDev+" is ignored") || strings.Contains(out, "a-secret") || strings.Contains(out, "world players keep") {
		t.Fatalf("a kept world with a Discord application:\n%s", out)
	}
}
