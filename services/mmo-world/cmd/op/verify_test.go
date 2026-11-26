package main_test

import (
	"context"
	"encoding/json"
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

// backupTools is the PATH the scripts run on, the op binary first, then
// the pg_dump, pg_restore and psql beside the test server; and op itself.
func backupTools(t *testing.T) (path, op string) {
	t.Helper()
	tools := pgtest.Bin()
	if pgtest.External() {
		tools = ""
	}
	for _, tool := range []string{"pg_dump", "pg_restore", "psql"} {
		if _, err := exec.LookPath(filepath.Join(tools, tool)); err != nil {
			t.Skip("no " + tool + " beside the test server")
		}
	}
	op = testkit.BuildCmd(t, "op")
	path = filepath.Dir(op) + string(os.PathListSeparator)
	if tools != "" {
		path += tools + string(os.PathListSeparator)
	}
	return path + os.Getenv("PATH"), op
}

// runIn runs a command with env and reports its output and whether it
// succeeded.
func runIn(env []string, name string, args ...string) (string, bool) {
	cmd := exec.Command(name, args...)
	cmd.Env = append(os.Environ(), env...)
	out, err := cmd.CombinedOutput()
	return string(out), err == nil
}

// TestBackupRestore plays a world with a forgotten player for two days,
// backs it up, restores it into a second database and verifies it there;
// then refuses a populated target, the source, and a damaged dump, and
// fails op verify on a tampered tick digest.
func TestBackupRestore(t *testing.T) {
	ctx := context.Background()
	source, target := pgtest.DB(t), pgtest.DB(t)
	path, op := backupTools(t)
	const worldID = "w-backup"
	sec, secrets := testkit.Secrets(t, "mmo/backup-test-master", worldID)
	book := testkit.Book(t)
	r := testkit.Rules(t, book, sec.Keys)
	sheetsDigest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	pool := pgtest.PoolOn(t, source)
	st, g, c := testkit.Founded(t, ctx, pool, r, store.Meta{ID: worldID, KeyVersion: 1, KeyCheck: sec.Keys.Check(), SheetsDigest: sheetsDigest, TickSeconds: 600})
	gone := testkit.Act(t, ctx, st, g, game.Command{Key: "i-2", Kind: game.Create}, "discord-2").Char
	now := time.Now()
	last := 2*sheets.TicksPerDay + 10
	for tick := range last {
		if tick%20 == 0 && c.Long == nil && c.Fight == nil {
			step := game.Command{Key: fmt.Sprintf("s-%d", tick), Char: c.C.ID, Kind: game.Step, Dir: tick % 6}
			if _, err := g.Act(step); err == nil {
				if err := st.SaveAction(ctx, g, step, c, "", []byte(`{}`), now); err != nil {
					t.Fatal(err)
				}
			}
		}
		if tick == sheets.TicksPerDay+30 {
			testkit.Act(t, ctx, st, g, game.Command{Key: "forget-2", Char: gone.C.ID, Kind: game.Forget}, "")
		}
		testkit.Ticks(t, ctx, st, g, 1)
	}
	if gone.Forgotten == 0 {
		t.Fatal("the forgotten character was not swept")
	}
	live, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}

	scripts := filepath.Join(sheetfs.ModuleRoot(), "scripts")
	env := func(db string, more ...string) []string {
		return append(append([]string{"PATH=" + path, "DATABASE_URL=" + db, "MMO_COMMIT=test-commit"}, secrets...), more...)
	}
	out := t.TempDir()
	printed, ok := runIn(env(source), "sh", filepath.Join(scripts, "backup.sh"), out)
	if !ok {
		t.Fatalf("backup: %s", printed)
	}
	dump := strings.TrimSpace(printed)
	if !strings.HasPrefix(filepath.Base(dump), fmt.Sprintf("mmo-%s-t%d-", worldID, g.Tick())) || !strings.HasSuffix(dump, ".dump") {
		t.Fatalf("the dump is %q", dump)
	}
	manifestFile := strings.TrimSuffix(dump, ".dump") + ".manifest.json"
	raw, err := os.ReadFile(manifestFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, needle := range sec.Needles {
		if strings.Contains(string(raw), needle) {
			t.Fatal("the manifest holds a key")
		}
	}
	var m struct {
		World, Digest, Sheets, Commit, Dump, Sha256 string
		Tick                                        int64
		Counts                                      store.Counts
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if m.World != worldID || m.Tick != g.Tick() || m.Digest != live.String() || m.Sheets != sheetsDigest || m.Commit != "test-commit" ||
		m.Dump != filepath.Base(dump) || len(m.Sha256) != 64 || m.Counts.Facts == 0 || m.Counts.Actions == 0 || m.Counts.Characters != 2 ||
		m.Counts.Ticks != int64(last) || m.Counts.Snapshots != 3 {
		t.Fatalf("the manifest: %s", raw)
	}

	restore := filepath.Join(scripts, "restore.sh")
	printed, ok = runIn(env(target), "sh", restore, dump)
	if !ok || !strings.Contains(printed, live.String()) || !strings.Contains(printed, `"checked": `) {
		t.Fatalf("restore: %s", printed)
	}
	t.Logf("%s", printed)
	var tomb string
	if err := pgtest.PoolOn(t, target).QueryRow(ctx, `SELECT discord_id FROM mmo.character WHERE world_id = $1 AND id = $2`, worldID, gone.C.ID).Scan(&tomb); err != nil || tomb != store.Tombstone+gone.C.ID {
		t.Fatalf("the restored forgotten character holds %q: %v", tomb, err)
	}
	if printed, ok = runIn(env(target), "sh", restore, dump); ok || !strings.Contains(printed, "RESTORE_REPLACE") {
		t.Fatalf("a restore over a world: %s", printed)
	}
	if printed, ok = runIn(env(target, "RESTORE_REPLACE=1"), "sh", restore, dump); !ok {
		t.Fatalf("a restore with RESTORE_REPLACE=1: %s", printed)
	}
	if printed, ok = runIn(env(source, "RESTORE_REPLACE=1", "SOURCE_DATABASE_URL="+source), "sh", restore, dump); ok || !strings.Contains(printed, "SOURCE_DATABASE_URL") {
		t.Fatalf("a restore onto the source: %s", printed)
	}

	damaged := filepath.Join(t.TempDir(), filepath.Base(dump))
	body, err := os.ReadFile(dump)
	if err != nil {
		t.Fatal(err)
	}
	body[len(body)/2] ^= 0xff
	if err := os.WriteFile(damaged, body, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(strings.TrimSuffix(damaged, ".dump")+".manifest.json", raw, 0o644); err != nil {
		t.Fatal(err)
	}
	if printed, ok = runIn(env(target, "RESTORE_REPLACE=1"), "sh", restore, damaged); ok || !strings.Contains(printed, "damaged") {
		t.Fatalf("a damaged dump: %s", printed)
	}
	if printed, ok = runIn(env(target), op, "verify", "-manifest", manifestFile); !ok {
		t.Fatalf("a refused restore touched the target: %s", printed)
	}

	if _, err := pgtest.PoolOn(t, target).Exec(ctx, `UPDATE mmo.tick SET digest = 'tampered' WHERE world_id = $1 AND tick = $2`, worldID, m.Tick); err != nil {
		t.Fatal(err)
	}
	if printed, ok = runIn(env(target), op, "verify", "-manifest", manifestFile); ok || !strings.Contains(printed, "recorded with digest tampered") {
		t.Fatalf("verify against the manifest on a tampered digest: %s", printed)
	}
	if printed, ok = runIn(env(target), op, "verify"); ok || !strings.Contains(printed, "replays to") {
		t.Fatalf("verify on a tampered digest: %s", printed)
	}
}
