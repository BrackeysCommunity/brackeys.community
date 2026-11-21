// Package testkit holds the fixtures the world service's tests share.
package testkit

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

// Book is the module's own sheets.
func Book(t testing.TB) *sheets.Book {
	t.Helper()
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// Rules are the module's sheets under k.
func Rules(t testing.TB, b *sheets.Book, k keys.Set) *game.Rules {
	t.Helper()
	r, err := game.NewRules(b, k)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// Team is n scripted players, wanderers and travellers in turn.
func Team(b *sheets.Book, prefix string, n int) []*agent.Player {
	return agent.Players(prefix, n, agent.Wanderer{BandOrder: agent.Bands(b)}, &agent.Traveller{})
}

// BuildCmd builds the command in the working directory into a temporary
// directory and returns the binary's path.
func BuildCmd(t testing.TB, name string) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), name)
	if out, err := exec.Command("go", "build", "-o", bin, ".").CombinedOutput(); err != nil {
		t.Fatalf("build: %v\n%s", err, out)
	}
	return bin
}

// Secrets are a test world's secrets, at roll epoch 0 and key version 1,
// and the environment a world process or op needs to derive the same.
func Secrets(t testing.TB, label, world string) (service.Secrets, []string) {
	t.Helper()
	m := sha256.Sum256([]byte(label))
	set, err := keys.Derive(m[:], world, 0)
	if err != nil {
		t.Fatal(err)
	}
	env := []string{service.EnvMaster + "=" + base64.StdEncoding.EncodeToString(m[:]), service.EnvWorld + "=" + world,
		service.EnvEpoch + "=0", service.EnvKeyVersion + "=1", service.EnvSheets + "=" + sheetfs.ModuleRoot()}
	return service.Secrets{World: world, KeyVersion: 1, Keys: set, Needles: keys.Needles(m[:], set)}, env
}

// Founded is a fresh world stored as m names it, with one character in it.
func Founded(t testing.TB, ctx context.Context, pool *pgxpool.Pool, r *game.Rules, m store.Meta) (*store.Store, *game.Game, *game.Char) {
	t.Helper()
	g, err := game.New(r)
	if err != nil {
		t.Fatal(err)
	}
	st := store.New(pool, m.ID)
	now := time.Now()
	if m.StartedAt.IsZero() {
		m.StartedAt = now
	}
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	if err := st.Create(ctx, m, g); err != nil {
		t.Fatal(err)
	}
	res := Act(t, ctx, st, g, game.Command{Key: "i-1", Kind: game.Create}, "discord-1")
	return st, g, res.Char
}

// Act runs a command and saves it.
func Act(t testing.TB, ctx context.Context, st *store.Store, g *game.Game, cmd game.Command, discord string) game.Result {
	t.Helper()
	res, err := g.Act(cmd)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SaveAction(ctx, g, cmd, res.Char, discord, []byte(`{}`), time.Now()); err != nil {
		t.Fatal(err)
	}
	return res
}

// Ticks runs and saves n ticks.
func Ticks(t testing.TB, ctx context.Context, st *store.Store, g *game.Game, n int) {
	t.Helper()
	for range n {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
		if _, err := st.SaveTick(ctx, g, 0, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
}

// MachineBeat puts a character in an encounter of one beat, a machine of
// a family and level against the sheets' first creature: a lock for a
// family that is picked, a puzzle for any other. A solve wins the
// encounter; a haywire leaves it for another try. The character counts
// as having worked a machine before, or its first Puzzle beat would be
// the opening Rewire whatever was asked for: set Worked to 0 for that.
func MachineBeat(t testing.TB, g *game.Game, c *game.Char, family string, level int64) {
	t.Helper()
	if g.Rules().Fight.P.Family(family) == nil {
		t.Fatalf("no machine family %q", family)
	}
	g.FaceMachine(c, family, level)
	c.Worked = max(c.Worked, 1)
	if g.MachineOn(c) != family {
		t.Fatalf("%s cannot reach the %s on its beat", c.C.ID, family)
	}
}

// AtBench stands a character, free to act, at the first settlement's
// tinker's bench.
func AtBench(t testing.TB, g *game.Game, c *game.Char) {
	t.Helper()
	c.C.At, c.Long, c.Fight = g.SettlementHex(0), nil, nil
	if _, ok := g.BenchAt(c); !ok {
		t.Fatalf("no tinker's bench stands open at %v", c.C.At)
	}
}
