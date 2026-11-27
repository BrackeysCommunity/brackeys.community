package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strings"
	"time"

	"jams.team/mmo-world/replay"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

// structural: the manifest's layout version, the commit's setting, and the
// file names a backup takes beside its stem.
const (
	manifestSchema = 1
	envCommit      = "MMO_COMMIT"
	dumpExt        = ".dump"
	manifestExt    = ".manifest.json"
	stampLayout    = "20060102T150405Z"
)

// manifest describes one backup (scripts/backup.sh): where the world stood
// when it was taken and what the dump holds. Nothing in it is secret. The
// dump is taken after it, so a restored world stands at its tick or later.
type manifest struct {
	Schema     int          `json:"schema"`
	World      string       `json:"world"`
	Tick       int64        `json:"tick"`
	Digest     string       `json:"digest"` // the tick's, as mmo.tick records it
	Sheets     string       `json:"sheets"`
	KeyVersion int32        `json:"keyVersion"`
	RulesEpoch int32        `json:"rulesEpoch"`
	Counts     store.Counts `json:"counts"`
	Commit     string       `json:"commit"`
	Made       string       `json:"made"`
	Dump       string       `json:"dump,omitempty"` // the dump's file name, beside the manifest
	Sha256     string       `json:"sha256,omitempty"`
}

// backupManifest prints a world's manifest, writes it into a directory
// beside the dump to come, seals it with the dump's checksum, or checks a
// dump against it.
func backupManifest(args []string) error {
	fs := flag.NewFlagSet("backup-manifest", flag.ContinueOnError)
	out := fs.String("out", "", "write the manifest into this directory and print the dump's path, less "+dumpExt)
	seal := fs.String("seal", "", "record this dump's checksum in the manifest beside it")
	check := fs.String("check", "", "refuse this dump unless it matches the manifest beside it")
	if err := fs.Parse(args); err != nil {
		return err
	}
	set := 0
	for _, f := range []string{*out, *seal, *check} {
		if f != "" {
			set++
		}
	}
	if fs.NArg() != 0 || set > 1 {
		return errors.New(usage)
	}
	switch {
	case *seal != "":
		return sealDump(*seal)
	case *check != "":
		_, err := checkDump(*check)
		return err
	}
	world := os.Getenv(service.EnvWorld)
	if world == "" {
		return errors.New(service.EnvWorld + " must be set")
	}
	ctx := context.Background()
	pool, err := service.PoolFromEnv(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	m, err := manifestOf(ctx, store.New(pool, world), time.Now().UTC())
	if err != nil {
		return err
	}
	if *out == "" {
		return show(m)
	}
	stem := filepath.Join(*out, stemOf(m))
	if err := writeManifest(stem+manifestExt, m); err != nil {
		return err
	}
	fmt.Println(stem)
	return nil
}

// manifestOf reads where st's world stands. The tick is read first, so its
// digest is on record and every count is of that tick or later.
func manifestOf(ctx context.Context, st *store.Store, now time.Time) (manifest, error) {
	meta, err := st.Meta(ctx)
	if err != nil {
		return manifest{}, fmt.Errorf("world %s: %w", st.World, err)
	}
	tick, err := st.Tick(ctx)
	if err != nil {
		return manifest{}, err
	}
	d, err := st.TickDigest(ctx, tick)
	if err != nil {
		return manifest{}, err
	}
	c, err := st.Counts(ctx)
	if err != nil {
		return manifest{}, err
	}
	return manifest{Schema: manifestSchema, World: meta.ID, Tick: tick, Digest: d, Sheets: meta.SheetsDigest, KeyVersion: meta.KeyVersion,
		RulesEpoch: meta.RulesEpoch, Counts: c, Commit: commit(), Made: now.Format(time.RFC3339)}, nil
}

// commit is the build the manifest was made by: MMO_COMMIT, else the
// binary's own revision when it was built from a checkout.
func commit() string {
	if c := os.Getenv(envCommit); c != "" {
		return c
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			if s.Key == "vcs.revision" {
				return s.Value
			}
		}
	}
	return ""
}

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]`)

// stemOf is a backup's file name less its extension:
// mmo-<world>-t<tick>-<UTC stamp>.
func stemOf(m manifest) string {
	made, err := time.Parse(time.RFC3339, m.Made)
	if err != nil {
		made = time.Now().UTC()
	}
	return fmt.Sprintf("mmo-%s-t%d-%s", unsafeName.ReplaceAllString(m.World, "_"), m.Tick, made.UTC().Format(stampLayout))
}

func manifestPath(dump string) (string, error) {
	stem, ok := strings.CutSuffix(dump, dumpExt)
	if !ok {
		return "", fmt.Errorf("a dump's name ends in %s, not %q", dumpExt, dump)
	}
	return stem + manifestExt, nil
}

func readManifest(path string) (manifest, error) {
	var m manifest
	b, err := os.ReadFile(path)
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return m, fmt.Errorf("%s: %w", path, err)
	}
	if m.Schema != manifestSchema || m.World == "" {
		return m, fmt.Errorf("%s is not a backup manifest of schema %d", path, manifestSchema)
	}
	return m, nil
}

// writeManifest writes a manifest whole or not at all.
func writeManifest(path string, m manifest) error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".part"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func fileSum(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// sealDump records a finished dump's name and checksum in its manifest.
func sealDump(dump string) error {
	path, err := manifestPath(dump)
	if err != nil {
		return err
	}
	m, err := readManifest(path)
	if err != nil {
		return err
	}
	if m.Sha256 != "" {
		return fmt.Errorf("%s is sealed already", path)
	}
	if m.Sha256, err = fileSum(dump); err != nil {
		return err
	}
	m.Dump = filepath.Base(dump)
	return writeManifest(path, m)
}

// checkDump is the manifest beside a dump, when the dump is the one it
// was sealed with.
func checkDump(dump string) (manifest, error) {
	path, err := manifestPath(dump)
	if err != nil {
		return manifest{}, err
	}
	m, err := readManifest(path)
	if err != nil {
		return m, err
	}
	if m.Sha256 == "" || m.Dump != filepath.Base(dump) {
		return m, fmt.Errorf("%s does not seal %s: the backup did not finish", path, filepath.Base(dump))
	}
	sum, err := fileSum(dump)
	if err != nil {
		return m, err
	}
	if sum != m.Sha256 {
		return m, fmt.Errorf("%s has sha256 %s, its manifest %s: the dump is damaged", dump, sum, m.Sha256)
	}
	return m, nil
}

// verified is what op verify found on a restored world.
type verified struct {
	World    string        `json:"world"`
	Tick     int64         `json:"tick"`
	Digest   string        `json:"digest"`
	Counts   store.Counts  `json:"counts"`
	Manifest *manifestSeen `json:"manifest,omitempty"`
	Replay   replay.Report `json:"replay"`
}

type manifestSeen struct {
	Tick   int64  `json:"tick"`
	Digest string `json:"digest"`
}

// verifyCmd checks a restored world before its service starts, and fails
// on the first thing that does not hold.
func verifyCmd(args []string) error {
	fs := flag.NewFlagSet("verify", flag.ContinueOnError)
	path := fs.String("manifest", "", "the backup's manifest, to check the restored world against")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New(usage)
	}
	var want *manifest
	if *path != "" {
		m, err := readManifest(*path)
		if err != nil {
			return err
		}
		want = &m
	}
	sec, err := service.SecretsFromEnv()
	if err != nil {
		return err
	}
	book, err := service.BookFromEnv()
	if err != nil {
		return err
	}
	rules, err := game.NewRules(book, sec.Keys)
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := service.PoolFromEnv(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	lock, ok, err := store.TryLock(ctx, pool, sec.World)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("a world service holds this world: verify a restore before its service starts")
	}
	defer lock.Release(ctx)
	out, err := verify(ctx, store.New(pool, sec.World), sec, book, rules, want)
	if err != nil {
		return err
	}
	return show(out)
}

func verify(ctx context.Context, st *store.Store, sec service.Secrets, book *sheets.Book, rules *game.Rules, want *manifest) (verified, error) {
	meta, err := st.MetaFor(ctx, sec.Keys, sec.KeyVersion, sec.Epoch, book)
	if err != nil {
		return verified{}, fmt.Errorf("verify with the world's own keys and sheets: %w", err)
	}
	if want != nil {
		if err := sameWorld(meta, *want); err != nil {
			return verified{}, err
		}
	}
	// Load recomputes the digest and checks the fact and ledger counts
	// against the world row.
	g, err := st.Load(ctx, rules)
	if err != nil {
		return verified{}, err
	}
	d, err := g.Digest()
	if err != nil {
		return verified{}, err
	}
	out := verified{World: st.World, Tick: g.Tick(), Digest: d.String()}
	bad, err := st.Audit(ctx)
	if err != nil {
		return out, err
	}
	if len(bad) > 0 {
		return out, fmt.Errorf("the audit found %d discrepancies, the first: %s", len(bad), bad[0])
	}
	if out.Counts, err = st.Counts(ctx); err != nil {
		return out, err
	}
	if want != nil {
		if err := sameRecords(ctx, st, out, *want); err != nil {
			return out, err
		}
		out.Manifest = &manifestSeen{Tick: want.Tick, Digest: want.Digest}
	}
	from := max(0, out.Tick-sheets.TicksPerDay)
	if out.Replay, err = replayed(ctx, st, rules, from, out.Tick, true); err != nil {
		return out, err
	}
	return out, mismatched(out.Replay)
}

// sameWorld holds when the restored world is the one the manifest names,
// on the same stamp.
func sameWorld(meta store.Meta, want manifest) error {
	if meta.ID != want.World || meta.SheetsDigest != want.Sheets || meta.KeyVersion != want.KeyVersion || meta.RulesEpoch != want.RulesEpoch {
		return fmt.Errorf("the restored world is %s on sheets %s, key version %d, roll epoch %d; the manifest names %s on %s, %d, %d",
			meta.ID, short(meta.SheetsDigest), meta.KeyVersion, meta.RulesEpoch, want.World, short(want.Sheets), want.KeyVersion, want.RulesEpoch)
	}
	return nil
}

// sameRecords holds when the restored world reached the manifest's tick
// with the manifest's digest, and lost no row any log held then.
func sameRecords(ctx context.Context, st *store.Store, got verified, want manifest) error {
	if got.Tick < want.Tick {
		return fmt.Errorf("the restored world stands at tick %d, before the manifest's %d", got.Tick, want.Tick)
	}
	d, err := st.TickDigest(ctx, want.Tick)
	if err != nil {
		return err
	}
	if d != want.Digest {
		return fmt.Errorf("tick %d is recorded with digest %s, the manifest %s", want.Tick, d, want.Digest)
	}
	g, w := got.Counts, want.Counts
	for _, c := range []struct {
		what      string
		got, want int64
	}{
		{"facts", g.Facts, w.Facts}, {"ledger transactions", g.LedgerTxns, w.LedgerTxns}, {"ledger entries", g.LedgerEntries, w.LedgerEntries},
		{"actions", g.Actions, w.Actions}, {"ticks", g.Ticks, w.Ticks}, {"snapshots", g.Snapshots, w.Snapshots},
		{"characters", g.Characters, w.Characters}, {"house log rows", g.HouseLog, w.HouseLog},
	} {
		if c.got < c.want {
			return fmt.Errorf("the restored world holds %d %s, the manifest %d", c.got, c.what, c.want)
		}
	}
	return nil
}
