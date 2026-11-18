// Command op is the operator's CLI for closed tests: inspect a character
// or a tile, correct a balance with a recorded fact, grant a mount, ban,
// check conservation, reset a test world, and replay a range of ticks.
//
// Everything that writes goes through the running world service's
// operator API (MMO_URL, MMO_OPERATOR_TOKEN), so the service stays the
// only writer and every correction is a fact that replays. replay reads
// the database directly (DATABASE_URL) with the world's keys
// (MMO_MASTER_SECRET and the rest), so it runs where those already are.
// reset -direct resets a stopped service's world in the database.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/replay"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

const usage = `op <command>
  inspect character <id>          the character as the world holds it
  inspect tile <q> <r>            a tile's stored state and its baseline
  correct <id> <asset> <units> <note...>   coin, provisions or mat:<id>; negative takes
  grant <id> <mount-kind> <note...>
  ban <id> <note...>  |  unban <id> <note...>
  audit                           the conservation check
  digest                          the world's tick and digest
  reset <world> [-direct]         wipe a disposable test world and found it again
  replay [-from N] [-to N]        re-run ticks against their recorded digests`

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "op:", err)
		os.Exit(1)
	}
}

func client() *agent.HTTP {
	return agent.NewHTTP(service.Getenv("MMO_URL", "http://localhost:8080"), os.Getenv("MMO_OPERATOR_TOKEN"))
}

func show(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// call sends one operator request and prints the reply.
func call(method, path string, in any) error {
	var out json.RawMessage
	ref, err := client().Do(context.Background(), method, path, in, &out)
	if err != nil {
		return err
	}
	if ref != nil {
		return fmt.Errorf("%s: %s", ref.Code, ref.Message)
	}
	return show(out)
}

func interaction() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "op-" + hex.EncodeToString(b)
}

func need(args []string, n int) error {
	if len(args) < n {
		return errors.New(usage)
	}
	return nil
}

func run(args []string) error {
	if err := need(args, 1); err != nil {
		return err
	}
	cmd, rest := args[0], args[1:]
	switch cmd {
	case "inspect":
		if err := need(rest, 2); err != nil {
			return err
		}
		if rest[0] == "tile" && len(rest) == 3 {
			return call(http.MethodGet, api.PathOperator+"/tile?q="+url.QueryEscape(rest[1])+"&r="+url.QueryEscape(rest[2]), nil)
		}
		return call(http.MethodGet, api.PathOperator+"/character?id="+url.QueryEscape(rest[1]), nil)
	case api.OpCorrect:
		if err := need(rest, 4); err != nil {
			return err
		}
		units, err := strconv.ParseInt(rest[2], 10, 64)
		if err != nil {
			return err
		}
		return call(http.MethodPost, api.PathOperator, api.OperatorRequest{InteractionID: interaction(), CharacterID: rest[0], Kind: cmd,
			Asset: rest[1], Units: units, Note: strings.Join(rest[3:], " ")})
	case api.OpGrant:
		if err := need(rest, 3); err != nil {
			return err
		}
		return call(http.MethodPost, api.PathOperator, api.OperatorRequest{InteractionID: interaction(), CharacterID: rest[0], Kind: cmd,
			Asset: rest[1], Note: strings.Join(rest[2:], " ")})
	case api.OpBan, api.OpUnban:
		if err := need(rest, 2); err != nil {
			return err
		}
		return call(http.MethodPost, api.PathOperator, api.OperatorRequest{InteractionID: interaction(), CharacterID: rest[0], Kind: cmd,
			Note: strings.Join(rest[1:], " ")})
	case "audit":
		return call(http.MethodGet, api.PathOperator+"/audit", nil)
	case "digest":
		return call(http.MethodGet, api.PathOperator+"/digest", nil)
	case "reset":
		return reset(rest)
	case "replay":
		return replayCmd(rest)
	}
	return errors.New(usage)
}

func reset(args []string) error {
	fs := flag.NewFlagSet("reset", flag.ExitOnError)
	direct := fs.Bool("direct", false, "reset in the database; the service must be stopped")
	if err := need(args, 1); err != nil {
		return err
	}
	world := args[0]
	_ = fs.Parse(args[1:])
	if !*direct {
		return call(http.MethodPost, api.PathOperator+"/reset", map[string]string{"world": world})
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv(service.EnvDatabase))
	if err != nil {
		return err
	}
	defer pool.Close()
	lock, ok, err := store.TryLock(ctx, pool, world)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("a world service holds this world: reset it through the service, without -direct")
	}
	defer lock.Release(ctx)
	if err := store.New(pool, world).Reset(ctx); err != nil {
		return err
	}
	fmt.Println("reset", world, "- the service founds it again with its sheets when it starts")
	return nil
}

// replayCmd re-runs a range of a world's ticks from its snapshots and
// recorded actions, and fails on the first tick whose digest differs.
// With no range it replays the last world day.
func replayCmd(args []string) error {
	fs := flag.NewFlagSet("replay", flag.ExitOnError)
	from := fs.Int64("from", -1, "the first tick (default: a world day before -to)")
	to := fs.Int64("to", -1, "the last tick (default: the world's tick)")
	_ = fs.Parse(args)
	sec, err := service.SecretsFromEnv()
	if err != nil {
		return err
	}
	book, err := sheetfs.LoadBook(service.Getenv(service.EnvSheets, "."))
	if err != nil {
		return err
	}
	rules, err := game.NewRules(book, sec.Keys)
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv(service.EnvDatabase))
	if err != nil {
		return err
	}
	defer pool.Close()
	st := store.New(pool, sec.World)
	m, w, err := st.Meta(ctx)
	if err != nil {
		return err
	}
	if m.KeyCheck != sec.Keys.Check() {
		return errors.New("these keys are not the world's")
	}
	if *to < 0 {
		*to = w.Tick
	}
	if *from < 0 {
		*from = max(0, *to-sheets.TicksPerDay)
	}
	rep, err := replay.Run(ctx, st, rules, *from, *to)
	if err != nil {
		return err
	}
	if err := show(rep); err != nil {
		return err
	}
	if rep.Mismatch != nil {
		return fmt.Errorf("tick %d replays to %s, recorded %s", rep.Mismatch.Tick, rep.Mismatch.Got, rep.Mismatch.Want)
	}
	return nil
}
