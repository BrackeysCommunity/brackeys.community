package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"jams.team/mmo-world/export"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// TestExportCommand runs op export against a world's database with no key
// in the environment: it writes every file for the closed days asked, and
// refuses a range nothing closed in or a missing directory.
func TestExportCommand(t *testing.T) {
	ctx := context.Background()
	url := pgtest.DB(t)
	sec, _ := testkit.Secrets(t, "mmo/op-export-master", "w-op-export")
	book := testkit.Book(t)
	digest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	st, g, _ := testkit.Founded(t, ctx, pgtest.PoolOn(t, url), testkit.Rules(t, book, sec.Keys),
		store.Meta{ID: "w-op-export", KeyVersion: 1, KeyCheck: sec.Keys.Check(), SheetsDigest: digest, TickSeconds: 600})
	testkit.Ticks(t, ctx, st, g, int(sheets.TicksPerDay)+1)
	t.Setenv(service.EnvDatabase, url)
	t.Setenv(service.EnvWorld, "w-op-export")
	t.Setenv(service.EnvSheets, sheetfs.ModuleRoot())
	t.Setenv(service.EnvMaster, "")

	dir := filepath.Join(t.TempDir(), "out")
	if err := run([]string{"export", "-out", dir, "-to-day", "0"}); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(dir, export.FileManifest))
	if err != nil {
		t.Fatal(err)
	}
	var m export.Manifest
	if err := json.Unmarshal(b, &m); err != nil || m.FromTick != 0 || m.ToTick != sheets.TicksPerDay || m.Records[export.FileDays] != 1 || m.Book != digest {
		t.Fatalf("manifest %s: %v", b, err)
	}
	for _, f := range export.Files {
		if _, err := os.Stat(filepath.Join(dir, f)); err != nil {
			t.Error(err)
		}
	}
	if strings.Contains(string(b), "w-op-export") {
		t.Fatal("the manifest names the world by its id")
	}
	if err := run([]string{"export", "-out", t.TempDir(), "-from-day", "1"}); err == nil || !strings.Contains(err.Error(), "closed") {
		t.Fatalf("an export of a day not closed: %v", err)
	}
	for _, args := range [][]string{{"export"}, {"export", "-out", dir, "-from-day", "2", "-to-day", "1"}, {"export", "-out", dir, "extra"}} {
		if err := run(args); err == nil {
			t.Errorf("op %v ran", args)
		}
	}
	t.Setenv(service.EnvWorld, "")
	if err := run([]string{"export", "-out", dir}); err == nil {
		t.Error("an export with no world named ran")
	}
}
