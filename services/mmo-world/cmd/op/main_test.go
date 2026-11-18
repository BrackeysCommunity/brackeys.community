package main_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

// TestNightlyReplay plays a world for two days into one local database,
// then runs the nightly replay script, which copies the mmo schema into a
// second local database and replays the last world day there.
func TestNightlyReplay(t *testing.T) {
	ctx := context.Background()
	source, scratch := pgtest.DB(t), pgtest.DB(t)
	tools := pgtest.Bin()
	if os.Getenv("MMO_TEST_DATABASE_URL") != "" {
		tools = ""
	}
	for _, tool := range []string{"pg_dump", "psql"} {
		if _, err := exec.LookPath(filepath.Join(tools, tool)); err != nil {
			t.Skip("no " + tool + " beside the test server")
		}
	}
	m := sha256.Sum256([]byte("mmo/nightly-test-master"))
	set, err := keys.Derive(m[:], "w-nightly", 0)
	if err != nil {
		t.Fatal(err)
	}
	book, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r, err := game.NewRules(book, set)
	if err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	st := store.New(pool, "w-nightly")
	now := time.Now()
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	if err := st.Create(ctx, store.Meta{ID: "w-nightly", KeyVersion: 1, KeyCheck: set.Check(), SheetsDigest: "s", StartedAt: now, TickSeconds: 600}, g); err != nil {
		t.Fatal(err)
	}
	cmd := game.Command{Key: "i-1", Kind: game.Create}
	res, err := g.Act(cmd)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SaveAction(ctx, g, cmd, res.Char, "u-1", []byte(`{}`), now); err != nil {
		t.Fatal(err)
	}
	for tick := range 2 * sheets.TicksPerDay {
		if tick%20 == 0 && res.Char.Long == nil && res.Char.Fight == nil {
			step := game.Command{Key: fmt.Sprintf("s-%d", tick), Char: res.Char.C.ID, Kind: game.Step, Dir: tick % 6}
			if _, err := g.Act(step); err == nil {
				if err := st.SaveAction(ctx, g, step, res.Char, "", []byte(`{}`), now); err != nil {
					t.Fatal(err)
				}
			}
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
		if _, err := st.SaveTick(ctx, g, 0, now); err != nil {
			t.Fatal(err)
		}
	}

	bin := t.TempDir()
	if out, err := exec.Command("go", "build", "-o", filepath.Join(bin, "op"), ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	run := exec.Command(filepath.Join(sheetfs.ModuleRoot(), "scripts", "nightly-replay.sh"))
	path := bin + string(os.PathListSeparator) + os.Getenv("PATH")
	if tools != "" {
		path = bin + string(os.PathListSeparator) + tools + string(os.PathListSeparator) + os.Getenv("PATH")
	}
	run.Env = append(os.Environ(), "PATH="+path,
		"SOURCE_DATABASE_URL="+source, "SCRATCH_DATABASE_URL="+scratch,
		"MMO_MASTER_SECRET="+base64.StdEncoding.EncodeToString(m[:]), "MMO_WORLD_ID=w-nightly", "MMO_ROLL_EPOCH=0",
		"MMO_SHEETS_ROOT="+sheetfs.ModuleRoot())
	out, err := run.CombinedOutput()
	if err != nil {
		t.Fatalf("nightly replay: %v\n%s", err, out)
	}
	want, _ := g.Digest()
	if !strings.Contains(string(out), `"checked": 144`) || !strings.Contains(string(out), want.String()) {
		t.Fatalf("nightly replay did not check the last day to the live digest %s:\n%s", want, out)
	}
	t.Logf("%s", out)
}
