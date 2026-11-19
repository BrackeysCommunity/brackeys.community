package main_test

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
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

func launch(t *testing.T, bin, dbURL string) *proc {
	t.Helper()
	port, err := pgtest.FreePort()
	if err != nil {
		t.Fatal(err)
	}
	_, secrets := testkit.Secrets(t, "mmo/kill-test-master", "w-kill")
	cmd := exec.Command(bin)
	cmd.Env = append(append(os.Environ(), secrets...),
		env(service.EnvDatabase, dbURL), env(service.EnvPort, port), env(service.EnvOperatorToken, opToken),
		env(service.EnvManualClock, 1), env(service.EnvPollMS, 2), env(service.EnvLogLevel, "info"))
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
		if strings.Contains(p.logs.String(), "[redacted]") {
			t.Fatal("a key reached the log guard")
		}
	}
}
