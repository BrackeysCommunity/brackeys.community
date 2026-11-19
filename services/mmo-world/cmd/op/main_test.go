package main_test

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

// TestNightlyReplay plays a world for two days into one local database,
// then runs the nightly replay script, which copies the mmo schema, less
// the fact log and the ledger, into a second local database and replays
// the last world day there.
func TestNightlyReplay(t *testing.T) {
	ctx := context.Background()
	source, scratch := pgtest.DB(t), pgtest.DB(t)
	tools := pgtest.Bin()
	if pgtest.External() {
		tools = ""
	}
	for _, tool := range []string{"pg_dump", "psql"} {
		if _, err := exec.LookPath(filepath.Join(tools, tool)); err != nil {
			t.Skip("no " + tool + " beside the test server")
		}
	}
	sec, secrets := testkit.Secrets(t, "mmo/nightly-test-master", "w-nightly")
	book := testkit.Book(t)
	r := testkit.Rules(t, book, sec.Keys)
	sheetsDigest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	pool := pgtest.PoolOn(t, source)
	st, g, c := testkit.Founded(t, ctx, pool, r, store.Meta{ID: "w-nightly", KeyVersion: 1, KeyCheck: sec.Keys.Check(), SheetsDigest: sheetsDigest, TickSeconds: 600})
	now := time.Now()
	for tick := range 2 * sheets.TicksPerDay {
		if tick%20 == 0 && c.Long == nil && c.Fight == nil {
			step := game.Command{Key: fmt.Sprintf("s-%d", tick), Char: c.C.ID, Kind: game.Step, Dir: tick % 6}
			if _, err := g.Act(step); err == nil {
				if err := st.SaveAction(ctx, g, step, c, "", []byte(`{}`), now); err != nil {
					t.Fatal(err)
				}
			}
		}
		testkit.Ticks(t, ctx, st, g, 1)
	}

	bin := filepath.Dir(testkit.BuildCmd(t, "op"))
	run := exec.Command(filepath.Join(sheetfs.ModuleRoot(), "scripts", "nightly-replay.sh"))
	path := bin + string(os.PathListSeparator) + os.Getenv("PATH")
	if tools != "" {
		path = bin + string(os.PathListSeparator) + tools + string(os.PathListSeparator) + os.Getenv("PATH")
	}
	run.Env = append(append(os.Environ(), "PATH="+path,
		"SOURCE_DATABASE_URL="+source, "SCRATCH_DATABASE_URL="+scratch), secrets...)
	out, err := run.CombinedOutput()
	if err != nil {
		t.Fatalf("nightly replay: %v\n%s", err, out)
	}
	var facts, ledger int
	if err := pgtest.PoolOn(t, scratch).QueryRow(ctx, "SELECT (SELECT count(*) FROM mmo.fact), (SELECT count(*) FROM mmo.ledger_entry)").Scan(&facts, &ledger); err != nil {
		t.Fatal(err)
	}
	if facts != 0 || ledger != 0 {
		t.Fatalf("the scratch copy holds %d facts and %d ledger entries; the replay reads neither", facts, ledger)
	}
	want, _ := g.Digest()
	if !strings.Contains(string(out), `"checked": 144`) || !strings.Contains(string(out), want.String()) {
		t.Fatalf("nightly replay did not check the last day to the live digest %s:\n%s", want, out)
	}
	t.Logf("%s", out)
}
