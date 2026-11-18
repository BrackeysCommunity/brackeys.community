package main_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

const (
	opToken = "op-test-token"
	// B is killed once it has caught up this many ticks of the stretch.
	catchUpBeforeKill = 10
)

// proc is one world service process.
type proc struct {
	cmd  *exec.Cmd
	logs *bytes.Buffer
	op   *agent.HTTP
	cli  *agent.HTTP
}

func freePort(t *testing.T) int {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	return l.Addr().(*net.TCPAddr).Port
}

func launch(t *testing.T, bin, dbURL string) *proc {
	t.Helper()
	port := freePort(t)
	m := sha256.Sum256([]byte("mmo/kill-test-master"))
	cmd := exec.Command(bin)
	cmd.Env = append(os.Environ(),
		"MMO_MASTER_SECRET="+base64.StdEncoding.EncodeToString(m[:]),
		"MMO_WORLD_ID=w-kill", "MMO_ROLL_EPOCH=0", "MMO_SHEETS_ROOT="+sheetfs.ModuleRoot(),
		"DATABASE_URL="+dbURL, fmt.Sprintf("PORT=%d", port), "MMO_OPERATOR_TOKEN="+opToken,
		"MMO_MANUAL_CLOCK=1", "MMO_POLL_MS=2", "LOG_LEVEL=info")
	logs := &bytes.Buffer{}
	cmd.Stdout, cmd.Stderr = logs, logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	p := &proc{cmd: cmd, logs: logs, op: agent.NewHTTP(base, opToken), cli: agent.NewHTTP(base, "")}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	for range 3000 {
		if h, err := p.cli.Health(context.Background()); err == nil && h.OK {
			return p
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("service never came up:\n%s", logs)
	return nil
}

func (p *proc) setDue(t *testing.T, tick int64) {
	t.Helper()
	if ref, err := p.op.Do(context.Background(), http.MethodPost, api.PathOperator+"/clock", map[string]int64{"due": tick}, nil); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
}

func (p *proc) waitFor(t *testing.T, tick int64) {
	t.Helper()
	for range 60000 {
		if h, err := p.cli.Health(context.Background()); err == nil && h.Tick >= tick {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("never reached tick %d:\n%s", tick, p.logs)
}

func (p *proc) digest(t *testing.T) string {
	t.Helper()
	var out struct {
		Digest string `json:"digest"`
	}
	if ref, err := p.op.Do(context.Background(), http.MethodGet, api.PathOperator+"/digest", nil, &out); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	return out.Digest
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
	bin := filepath.Join(t.TempDir(), "world")
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	dbA, dbB := pgtest.DB(t), pgtest.DB(t)
	a, b := launch(t, bin, dbA), launch(t, bin, dbB)
	book, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	team := func() []*agent.Player {
		return agent.Players("u", 4, agent.Wanderer{BandOrder: agent.Bands(book)}, &agent.Traveller{})
	}
	sa, sb := agent.NewScript(a.cli, team(), "kill"), agent.NewScript(b.cli, team(), "kill")
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
			a.setDue(t, tick+1)
			b.setDue(t, tick+1)
			a.waitFor(t, tick+1)
			b.waitFor(t, tick+1)
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
	a.setDue(t, kill)
	a.waitFor(t, kill)
	b = launch(t, bin, dbB)
	hb, _ := b.cli.Health(ctx)
	t.Logf("B restarted at tick %d; catching up to %d", hb.Tick, kill)
	if hb.Tick >= kill {
		t.Fatal("B was not killed before it caught up")
	}
	b.setDue(t, kill)
	b.waitFor(t, kill)
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
