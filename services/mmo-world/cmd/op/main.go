// Command op is the operator CLI: inspect, correct, grant, ban, audit, economy,
// stand a character before a machine, reset and replay a world.
//
// Writes go through the running service's operator API, so the service
// stays the only writer and every correction replays. replay reads the
// database directly with the world's keys.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/internal/envvar"
	"jams.team/mmo-world/replay"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	simhex "jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

const usage = `op [-id <interaction id>] <command>
  -id names a write's interaction id, so a rerun after a timeout applies it once
  inspect character <id>          the character as the world holds it
  inspect tile <q> <r>            a tile's stored state and its baseline
  correct <id> <asset> <units> <note...>   coin, provisions or mat:<id>; negative takes
  grant <id> <mount-kind> <note...>
  ban <id> <note...>  |  unban <id> <note...>
  set-machine <id> <family> <level> <note...>   stand a free character before a machine
  set-ready <id> <tier> <note...>   raise its worn gear and practice to a tier's expected levels
  hide <goal> <note...>           take a goal off the notice board, its escrow back
  hunt-start <row> <q,r> [note...]   open a fights.hunts row's hunt on a tile
  hide-name <q,r> [note...]       hide a dungeon's given name; it shows its pack name
  audit                           the conservation check
  economy                         the faucet, and characters flagged for review
  digest                          the world's tick and digest
  reset <world> [-direct]         wipe a disposable test world and found it again
  replay [-from N] [-to N]        re-run ticks against their recorded digests`

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "op:", err)
		os.Exit(1)
	}
}

func cli() *client.HTTP {
	return client.New(envvar.Get(service.EnvURL, "http://localhost:8080"), os.Getenv(service.EnvOperatorToken))
}

func show(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// operate sends one operator action and prints the reply. A send that
// fails in transport is sent once more with the same interaction id, so
// one the service already applied comes back as its stored reply.
func operate(req api.OperatorRequest) error {
	fmt.Fprintln(os.Stderr, "interaction", req.InteractionID)
	c := cli()
	out, ref, err := c.Operate(context.Background(), req)
	if err != nil {
		out, ref, err = c.Operate(context.Background(), req)
	}
	if err := client.Refused(req.Kind, ref, err); err != nil {
		return err
	}
	return show(out)
}

// shown prints a reply, or returns the call's error.
func shown(v any, err error) error {
	if err != nil {
		return err
	}
	return show(v)
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
	fs := flag.NewFlagSet("op", flag.ContinueOnError)
	id := fs.String("id", "", "the interaction id of a write (default: a fresh one)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	args = fs.Args()
	if *id == "" {
		*id = interaction()
	}
	if err := need(args, 1); err != nil {
		return err
	}
	cmd, rest := args[0], args[1:]
	switch cmd {
	case "inspect":
		if err := need(rest, 2); err != nil {
			return err
		}
		ctx := context.Background()
		switch {
		case rest[0] == "character" && len(rest) == 2:
			return shown(cli().Character(ctx, rest[1]))
		case rest[0] == "tile" && len(rest) == 3:
			q, err := strconv.ParseInt(rest[1], 10, 64)
			if err != nil {
				return err
			}
			r, err := strconv.ParseInt(rest[2], 10, 64)
			if err != nil {
				return err
			}
			return shown(cli().Tile(ctx, q, r))
		}
		return errors.New(usage)
	case api.OpCorrect, api.OpMachine:
		if err := need(rest, 4); err != nil {
			return err
		}
		units, err := strconv.ParseInt(rest[2], 10, 64)
		if err != nil {
			return err
		}
		return operate(api.OperatorRequest{InteractionID: *id, CharacterID: rest[0], Kind: cmd,
			Asset: rest[1], Units: units, Note: strings.Join(rest[3:], " ")})
	case api.OpReady:
		if err := need(rest, 3); err != nil {
			return err
		}
		tier, err := strconv.ParseInt(rest[1], 10, 64)
		if err != nil {
			return err
		}
		return operate(api.OperatorRequest{InteractionID: *id, CharacterID: rest[0], Kind: cmd, Units: tier, Note: strings.Join(rest[2:], " ")})
	case api.OpGrant:
		if err := need(rest, 3); err != nil {
			return err
		}
		return operate(api.OperatorRequest{InteractionID: *id, CharacterID: rest[0], Kind: cmd,
			Asset: rest[1], Note: strings.Join(rest[2:], " ")})
	case api.OpBan, api.OpUnban:
		if err := need(rest, 2); err != nil {
			return err
		}
		return operate(api.OperatorRequest{InteractionID: *id, CharacterID: rest[0], Kind: cmd,
			Note: strings.Join(rest[1:], " ")})
	case "hide":
		if err := need(rest, 2); err != nil {
			return err
		}
		return operate(api.OperatorRequest{InteractionID: *id, Kind: api.ActHideGoal, Target: rest[0], Note: strings.Join(rest[1:], " ")})
	case api.OpHuntStart:
		if err := need(rest, 2); err != nil {
			return err
		}
		at, err := hexArg(rest[1])
		if err != nil {
			return err
		}
		return operate(api.OperatorRequest{InteractionID: *id, Kind: cmd, Asset: rest[0], To: &at, Note: strings.Join(rest[2:], " ")})
	case api.OpHideName:
		if err := need(rest, 1); err != nil {
			return err
		}
		at, err := hexArg(rest[0])
		if err != nil {
			return err
		}
		return operate(api.OperatorRequest{InteractionID: *id, Kind: cmd, To: &at, Note: strings.Join(rest[1:], " ")})
	case "audit":
		return shown(cli().Audit(context.Background()))
	case "economy":
		return shown(cli().Economy(context.Background()))
	case "digest":
		return shown(cli().Digest(context.Background()))
	case "reset":
		return reset(rest)
	case "replay":
		return replayCmd(rest)
	}
	return errors.New(usage)
}

// hexArg reads a tile written "q,r".
func hexArg(s string) (api.Hex, error) {
	h, ok := simhex.ParseRef(s)
	if !ok {
		return api.Hex{}, fmt.Errorf("a tile is q,r, not %q", s)
	}
	return api.Hex{Q: h.Q, R: h.R}, nil
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
		return shown(cli().Reset(context.Background(), world))
	}
	ctx := context.Background()
	pool, err := service.PoolFromEnv(ctx)
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
	st := store.New(pool, sec.World)
	if _, err := st.MetaFor(ctx, sec.Keys, sec.KeyVersion, sec.Epoch, book); err != nil {
		return fmt.Errorf("replay with the world's own keys and sheets: %w", err)
	}
	if *to < 0 {
		if *to, err = st.Tick(ctx); err != nil {
			return err
		}
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
