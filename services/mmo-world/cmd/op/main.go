// Command op is the operator CLI: inspect, correct, grant, ban, audit, economy,
// stand a character before a machine, pin content, start a season, cast an
// arc, rename for everyone, close escalated cases, forget a player, read
// the story, the emergence dashboard and the house log, reset, replay,
// export, back up and verify a world.
//
// Writes go through the running service's operator API, so the service
// stays the only writer and every correction replays. replay and verify
// read the database directly with the world's keys; export and
// backup-manifest read it with none.
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
  pin-reserve <q,r> <reach> <field=value>... [-as admin|staff -for <char> -label <text>]
                                  stage content on a tile nobody has reached
  pin-edit <q,r> <field=value>... [-as ... -for ... -label ...]   change a reached tile's content
  pin-withdraw <pin-id> [-as ... -for ...]   stop a live pin counting
      fields: site, landmark, site-kind, dungeon, floors, lead, stock;
              ground=<terrain> [elevation=N] [ring=true] lays terrain on the tile, or the tile and its ring
  pins                            the live pins
  rename <ref> [name...]          rename a guild:, settlement:, dungeon:, kind: or promotion: ref for every
                                  server; no name restores the one the world gave it
  cases                           the cases every server escalated
  case-close <server>/<case> [note...]   close an escalated case once it is acted on
  house-log [-after N]            every server's log of staff, admin and operator commands, after a row id
  freeze-content [note...]        store the seed's content on a world from before history
  season-start [note...]          give a world from before seasons the season it is in
  arc-cast <template> <role>=<kind>:<id>... [seat=q,r]
                                  cast an arc with its cast bound by hand
      kinds: faction f-N, region r-N, holding r-N, settlement N, tile q,r, notable, npc, character
  story                           the season, the arcs, the ring and the pattern boards
  emergence                       the four measures against their healthy lines, this season's
                                  promotions by type against need, and the newest 20 promotions
  audit                           the conservation check
  economy                         the faucet, and characters flagged for review
  digest                          the world's tick and digest
  export -out DIR [-from-day N] [-to-day M]
                                  recorded play, pseudonymised, for the tuning pass (direct: DATABASE_URL,
                                  MMO_WORLD_ID and the world's sheets under MMO_SHEETS_ROOT; no key)
  forget <character> <note...>    forget a character for a player who asked by email (GDD 14.9); the note
                                  says why, never who asked or how to reach them
  backup-manifest [-out DIR | -seal DUMP | -check DUMP]
                                  the world's backup manifest as JSON: tick, digest, sheets, key version, rules
                                  epoch, row counts, commit (direct: DATABASE_URL, MMO_WORLD_ID; no key). -out
                                  writes it into DIR and prints the path its dump takes, less .dump; -seal records
                                  a dump's sha256 in the manifest beside it; -check refuses a dump that differs
  verify [-manifest FILE]         a restored world, before its service starts: keys and sheets, the load's digest
                                  and counts, the audit, the manifest's tick digest and row counts, and the last
                                  world day replayed (direct: DATABASE_URL, the world's keys and MMO_SHEETS_ROOT)
  reset <world> [-direct]         wipe a disposable test world and found it again
  replay [-from N] [-to N]        re-run ticks against their recorded digests, inside one rules epoch`

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "op:", err)
		os.Exit(1)
	}
}

func cli() *client.HTTP {
	return client.New(envvar.Get(service.EnvURL, "http://localhost:8080"), service.TokenFromEnv(service.EnvOperatorToken))
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
	case api.OpPinReserve, api.OpPinEdit, api.OpPinWithdraw:
		pin, err := pinOrder(cmd, rest)
		if err != nil {
			return err
		}
		return operate(api.OperatorRequest{InteractionID: *id, Kind: cmd, Pin: &pin})
	case "pins":
		if len(rest) != 0 {
			return errors.New(usage)
		}
		return shown(cli().Pins(context.Background()))
	case api.OpRename:
		if err := need(rest, 1); err != nil {
			return err
		}
		return operate(api.OperatorRequest{InteractionID: *id, Kind: cmd, Rename: &api.RenameOrder{Ref: rest[0], Name: strings.Join(rest[1:], " ")}})
	case "cases":
		if len(rest) != 0 {
			return errors.New(usage)
		}
		return shown(cli().OperatorCases(context.Background()))
	case api.OpCaseClose:
		if err := need(rest, 1); err != nil {
			return err
		}
		if server, c, ok := strings.Cut(rest[0], "/"); !ok || server == "" || c == "" {
			return fmt.Errorf("a case is <server>/<case id>, not %q", rest[0])
		}
		return operate(api.OperatorRequest{InteractionID: *id, Kind: cmd, Target: rest[0], Note: strings.Join(rest[1:], " ")})
	case "house-log":
		return houseLog(rest)
	case "freeze-content":
		return operate(api.OperatorRequest{InteractionID: *id, Kind: api.OpContentFreeze, Note: strings.Join(rest, " ")})
	case api.OpSeasonStart:
		return operate(api.OperatorRequest{InteractionID: *id, Kind: cmd, Note: strings.Join(rest, " ")})
	case api.OpArcCast:
		o, err := arcOrder(rest)
		if err != nil {
			return err
		}
		return operate(api.OperatorRequest{InteractionID: *id, Kind: cmd, Arc: &o})
	case "story":
		if len(rest) != 0 {
			return errors.New(usage)
		}
		return shown(story(context.Background(), cli()))
	case "emergence":
		if len(rest) != 0 {
			return errors.New(usage)
		}
		return emergence(context.Background(), cli(), os.Stdout)
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
	case "export":
		return exportCmd(rest)
	case api.ActForget:
		return forgetCmd(*id, rest)
	case "backup-manifest":
		return backupManifest(rest)
	case "verify":
		return verifyCmd(rest)
	}
	return errors.New(usage)
}

// houseLog prints a page of every server's log after a row id.
func houseLog(args []string) error {
	fs := flag.NewFlagSet("house-log", flag.ContinueOnError)
	after := fs.Int64("after", 0, "the row id to read after")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 || *after < 0 {
		return errors.New(usage)
	}
	return shown(cli().OperatorHouseLog(context.Background(), *after))
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
	fs := flag.NewFlagSet("replay", flag.ContinueOnError)
	from := fs.Int64("from", -1, "the first tick (default: a world day before -to)")
	to := fs.Int64("to", -1, "the last tick (default: the world's tick)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 || (*from >= 0 && *to >= 0 && *from > *to) {
		return errors.New(usage)
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
	rep, err := replayed(ctx, st, rules, *from, *to, false)
	if err != nil {
		return err
	}
	if err := show(rep); err != nil {
		return err
	}
	return mismatched(rep)
}

// replayed re-runs st's world from the snapshot at or before from to tick
// to, inside one rules epoch: a range across an epoch is refused or, with
// fromEpoch, replayed from the last epoch it crosses.
func replayed(ctx context.Context, st *store.Store, rules *game.Rules, from, to int64, fromEpoch bool) (replay.Report, error) {
	epochs, err := epochFacts(ctx, st)
	if err != nil {
		return replay.Report{}, err
	}
	// The replay starts from the snapshot at or before from, which a world
	// takes at each day's turn.
	start := from - from%sheets.TicksPerDay
	if fromEpoch {
		for _, e := range epochs {
			if start < e.Tick && e.Tick <= to {
				from, start = e.Tick, e.Tick-e.Tick%sheets.TicksPerDay
			}
		}
	}
	if e, ok := crossed(epochs, start, to); ok {
		return replay.Report{}, crossesEpoch(e, start, to)
	}
	rep, err := replay.Run(ctx, st, rules, from, to)
	if err != nil {
		return rep, err
	}
	if e, ok := crossed(epochs, rep.From, to); ok {
		return rep, crossesEpoch(e, rep.From, to)
	}
	return rep, nil
}

// mismatched is a replay's first differing tick as an error.
func mismatched(rep replay.Report) error {
	if rep.Mismatch != nil {
		return fmt.Errorf("tick %d replays to %s, recorded %s", rep.Mismatch.Tick, rep.Mismatch.Got, rep.Mismatch.Want)
	}
	return nil
}
