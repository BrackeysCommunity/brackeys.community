package export_test

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/export"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

func TestMain(m *testing.M) { pgtest.Main(m) }

// How long the played world runs, and how many play it.
const (
	playDays    = 2
	playPlayers = 6
	tickWait    = 10 * time.Second
)

// user and guild are Discord-shaped snowflakes: 19 and 18 digits.
func user(i int) string  { return fmt.Sprintf("%d", 1093847562019283746+int64(i)*7919) }
func guild(i int) string { return fmt.Sprintf("%d", 912345678901234567+int64(i)*104729) }

func token(t *testing.T) string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return "tok-" + hex.EncodeToString(b)
}

// played is a world played through the service, with everything an export
// of it must never hold.
type played struct {
	pool    *store.Store
	book    *sheets.Book
	needles []string // every secret, Discord id and interaction id, in their text forms
	chars   []string // raw character ids
	world   string
}

// play runs a world in process behind every token, with snowflake users on
// two snowflake servers: scripted players for playDays, a bench solve, and
// a machine armed and solved through the Activity's host.
func play(t *testing.T) *played {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	const world = "w-export-leak"
	pool := pgtest.Pool(t)
	sec, _ := testkit.Secrets(t, "mmo/export-leak-master", world)
	tokens := []string{token(t), token(t), token(t), token(t)}
	cfg := service.Config{Secrets: sec, TickSeconds: 600, Book: testkit.Book(t), APIToken: tokens[0], OperatorToken: tokens[1],
		MapToken: tokens[2], ForgetToken: tokens[3], ManualClock: true, Disposable: true, Poll: time.Millisecond,
		Log: slog.New(slog.NewJSONHandler(io.Discard, nil))}
	srv, err := service.Open(ctx, pool, cfg)
	if err != nil {
		t.Fatal(err)
	}
	hs := httptest.NewServer(srv.Handler())
	done := make(chan error, 1)
	go func() { done <- srv.Run(ctx) }()
	defer func() {
		cancel()
		if err := <-done; err != nil && !errors.Is(err, context.Canceled) {
			t.Error(err)
		}
		hs.Close()
		srv.Close(context.Background())
	}()
	cli, op := client.New(hs.URL, tokens[0]), client.New(hs.URL, tokens[1])
	cli.Poll, op.Poll = time.Millisecond, time.Millisecond

	tinker := user(playPlayers)
	machines(t, ctx, srv, cli, op, tinker, guild(0))
	ps := make([]*agent.Player, playPlayers)
	policies := []agent.Policy{agent.Wanderer{BandOrder: agent.Bands(cfg.Book)}, &agent.Traveller{}}
	for i := range ps {
		ps[i] = &agent.Player{Discord: user(i), Server: guild(i % 2), Policy: policies[i%len(policies)]}
	}
	s := agent.NewScript(cli, ps, "export")
	for tick := int64(0); tick < playDays*sheets.TicksPerDay; tick++ {
		if err := s.Turn(ctx, tick); err != nil {
			t.Fatal(err)
		}
		wait, stop := context.WithTimeout(ctx, tickWait)
		err := op.Advance(wait, tick+1)
		stop()
		if err != nil {
			t.Fatal(err)
		}
	}

	p := &played{pool: store.New(pool, world), book: cfg.Book, world: world}
	p.needles = append(p.needles, sec.Needles...)
	ids := append(slices.Clone(tokens), tinker, guild(0), guild(1), world)
	for i := range ps {
		ids = append(ids, user(i))
	}
	rows, err := pool.Query(context.Background(), "SELECT interaction_id FROM mmo.action WHERE world_id = $1", world)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		b := []byte(id)
		p.needles = append(p.needles, id, hex.EncodeToString(b), base64.StdEncoding.EncodeToString(b), base64.RawStdEncoding.EncodeToString(b),
			base64.URLEncoding.EncodeToString(b), base64.RawURLEncoding.EncodeToString(b))
	}
	rows, err = pool.Query(context.Background(), "SELECT id FROM mmo.character WHERE world_id = $1", world)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		p.chars = append(p.chars, id)
	}
	rows.Close()
	if len(p.chars) < playPlayers {
		t.Fatalf("%d characters played", len(p.chars))
	}
	return p
}

// rewired is the log that plugs every wire of a Rewire into its port.
func rewired(l api.PuzzleLayout) *api.PuzzleLog {
	log := &api.PuzzleLog{}
	for w, port := range l.Target {
		log.Moves = append(log.Moves, api.PuzzleMove{At: int64(w+1) * 200, A: int64(w), B: port})
	}
	return log
}

// machines has a snowflake user solve the bench where it starts, then arm
// and solve a beat's machine an operator stood it before.
func machines(t *testing.T, ctx context.Context, srv *service.Server, cli, op *client.HTTP, discord, server string) {
	t.Helper()
	rep, ref, err := cli.Act(ctx, api.ActionRequest{InteractionID: "create-" + discord, DiscordID: discord, Kind: api.ActCreate, Option: api.StartKnife, Server: server})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id := rep.Character.ID
	look := api.Viewer{Family: puzzle.Rewire, Level: 1}
	st, ok, err := srv.View(ctx, id, look, 0)
	if err != nil || !ok || st.Machine == nil {
		t.Fatalf("no bench where %s stands: %v", id, err)
	}
	rep, ref, err = cli.Act(ctx, api.ActionRequest{InteractionID: "bench-" + discord, CharacterID: id, Version: rep.Character.Version, Kind: api.ActBenchSolve,
		Machine: &api.MachineIntent{Family: look.Family, Level: look.Level, Log: rewired(st.Machine.Layout)}})
	if err != nil || ref != nil || rep.Machine == nil {
		t.Fatal(ref, err)
	}
	if _, ref, err := op.Operate(ctx, api.OperatorRequest{InteractionID: "set-" + discord, CharacterID: id, Kind: api.OpMachine, Asset: puzzle.Rewire,
		Units: 2, Note: "export test for " + discord}); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	st, _, err = srv.View(ctx, id, api.Viewer{}, 0)
	if err != nil || st.Machine == nil {
		t.Fatal("no machine stood before", id, err)
	}
	log := rewired(st.Machine.Layout)
	o, err := cli.Options(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	armed, ref, err := srv.Act(ctx, api.ActionRequest{InteractionID: "arm-" + discord, CharacterID: id, Version: o.Version, Kind: api.ActMachineArm,
		Machine: &api.MachineIntent{Source: api.MachineBeat}}, true)
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	if _, ref, err := srv.Act(ctx, api.ActionRequest{InteractionID: "solve-" + discord, CharacterID: id, Version: armed.Character.Version,
		Kind: api.ActMachineSolve, Machine: &api.MachineIntent{Source: api.MachineBeat, Log: log}}, true); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
}

// snapSource serves one stored game as the snapshot at a day's close.
type snapSource struct {
	meta store.Meta
	body []byte
}

func (s snapSource) Meta(context.Context) (store.Meta, error) { return s.meta, nil }
func (s snapSource) ActionsBetween(context.Context, int64, int64) ([]store.Action, error) {
	return nil, nil
}
func (s snapSource) FactsBetween(context.Context, int64, int64) ([]fact.Fact, error) {
	return nil, nil
}
func (s snapSource) SnapshotsBetween(_ context.Context, from, _ int64) ([]store.Snapshot, error) {
	if from != sheets.TicksPerDay {
		return nil, nil
	}
	return []store.Snapshot{{Tick: from, Body: s.body}}, nil
}

// TestExportReadsTheStoredGame writes a game.Game as the sim stores it and
// fails if the export no longer finds its characters, found materials or
// season clock: a renamed json tag on the game breaks it here.
func TestExportReadsTheStoredGame(t *testing.T) {
	book := testkit.Book(t)
	digest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	const qty = 3
	found := sheets.Material{ID: "found-ore", Tier: book.Materials[0].Tier, Vector: book.Materials[0].Vector}
	em := emerge.New(0, 1)
	em.Materials = []sheets.Material{found}
	g := game.Game{
		Chars:     []*game.Char{{C: &char.Character{ID: "c1", Goods: []item.Spoil{{Material: found.ID, Qty: qty}}}, Server: "s1"}},
		Emergence: em,
		Story:     &game.Story{Clock: &season.Clock{N: 1, Start: 0, Days: 30}},
	}
	body, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	dir, m := exported(t, snapSource{meta: store.Meta{ID: "w1", SheetsDigest: digest}, body: body}, book, 0, -1)
	if m.ToTick != sheets.TicksPerDay || !slices.Equal(m.Seasons, []int64{1}) {
		t.Fatalf("the export read to tick %d with seasons %v", m.ToTick, m.Seasons)
	}
	days := lines(t, filepath.Join(dir, export.FileDays))
	if len(days) != 1 || days[0]["goodsValue"].(float64) < qty {
		t.Fatalf("the stored character or its found material went unread: %v", days)
	}
	world := lines(t, filepath.Join(dir, export.FileWorld))
	if len(world) != 1 || world[0]["season"] != float64(1) || world[0]["seasonDay"] != float64(1) {
		t.Fatalf("the stored season clock went unread: %v", world)
	}
}

// lines reads a JSON-lines file, each line an object.
func lines(t *testing.T, path string) []map[string]any {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	var out []map[string]any
	sc := bufio.NewScanner(f)
	sc.Buffer(nil, 1<<24)
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			t.Fatalf("%s: a line that is not an object: %v", filepath.Base(path), err)
		}
		out = append(out, m)
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func exported(t *testing.T, src export.Source, book *sheets.Book, from, to int64) (string, export.Manifest) {
	t.Helper()
	dir := t.TempDir()
	m, err := export.Write(context.Background(), src, book, dir, from, to)
	if err != nil {
		t.Fatal(err)
	}
	return dir, m
}

var (
	longDigits = regexp.MustCompile(`[0-9]{17,}`)
	// a pseudonym is the prefix and 16 hex digits; anything else after c-
	// is a raw id.
	pseudonym = regexp.MustCompile(`^[csw]-[0-9a-f]{16}$`)
)

// TestExportHoldsNoIdentity plays a world through the service with
// snowflake users and servers, a known master and tokens, exports it, and
// fails on any secret, Discord id, interaction id or raw character id in
// any text form, and on any run of 17 or more digits.
func TestExportHoldsNoIdentity(t *testing.T) {
	if testing.Short() {
		t.Skip("plays two world days through the service")
	}
	p := play(t)
	dir, m := exported(t, p.pool, p.book, 0, -1)
	if m.ToTick != playDays*sheets.TicksPerDay || m.World == "" || !pseudonym.MatchString(m.World) {
		t.Fatalf("manifest %+v", m)
	}
	var all bytes.Buffer
	for _, f := range append([]string{export.FileManifest}, export.Files...) {
		b, err := os.ReadFile(filepath.Join(dir, f))
		if err != nil {
			t.Fatal(err)
		}
		all.Write(b)
		all.WriteByte('\n')
	}
	text := all.String()
	for _, n := range p.needles {
		if strings.Contains(text, n) {
			t.Errorf("the export holds %q", n)
		}
	}
	for _, id := range p.chars {
		raw := regexp.MustCompile(`(^|[^0-9A-Za-z])` + regexp.QuoteMeta(id) + `([^0-9A-Za-z]|$)`)
		if raw.MatchString(text) {
			t.Errorf("the export holds the raw character id %s", id)
		}
	}
	if s := longDigits.FindString(text); s != "" {
		t.Errorf("the export holds a run of %d digits: %s", len(s), s)
	}
	for _, f := range []string{export.FileBeats, export.FilePuzzles, export.FileDays, export.FileWorld} {
		if m.Records[f] == 0 {
			t.Errorf("no %s records in a played world", f)
		}
		recs := lines(t, filepath.Join(dir, f))
		if int64(len(recs)) != m.Records[f] {
			t.Errorf("%s: %d lines, the manifest says %d", f, len(recs), m.Records[f])
		}
		for _, r := range recs {
			for _, k := range []string{"character", "server", "world"} {
				if v, ok := r[k].(string); ok && !pseudonym.MatchString(v) {
					t.Errorf("%s: %s %q is no pseudonym", f, k, v)
				}
			}
		}
	}
	lines(t, filepath.Join(dir, export.FileMilestones))
	t.Logf("records %v, seasons %v", m.Records, m.Seasons)

	// Pseudonyms hold within one export and differ across two.
	again, m2 := exported(t, p.pool, p.book, 0, -1)
	names := func(dir string) map[string]bool {
		out := map[string]bool{}
		for _, f := range export.Files {
			for _, r := range lines(t, filepath.Join(dir, f)) {
				for _, k := range []string{"character", "server", "world"} {
					if v, ok := r[k].(string); ok {
						out[v] = true
					}
				}
			}
		}
		return out
	}
	first, second := names(dir), names(again)
	days := lines(t, filepath.Join(dir, export.FileDays))
	perDay := map[float64]map[string]bool{}
	for _, d := range days {
		day := d["day"].(float64)
		if perDay[day] == nil {
			perDay[day] = map[string]bool{}
		}
		perDay[day][d["character"].(string)] = true
	}
	if len(perDay[0]) != len(p.chars) || len(perDay[1]) != len(p.chars) {
		t.Fatalf("days hold %d and %d characters, the world %d", len(perDay[0]), len(perDay[1]), len(p.chars))
	}
	for c := range perDay[0] {
		if !perDay[1][c] {
			t.Fatalf("character %s has no line on day 1: its pseudonym moved within one export", c)
		}
	}
	for _, b := range lines(t, filepath.Join(dir, export.FileBeats)) {
		if !perDay[b["day"].(float64)][b["character"].(string)] {
			t.Fatalf("a beat's character %v is not among the day's characters", b["character"])
		}
	}
	for n := range first {
		if second[n] {
			t.Fatalf("pseudonym %s in two exports", n)
		}
	}
	if m2.World == m.World {
		t.Fatal("the world's pseudonym is the same in two exports")
	}
}

// saved applies cmd to g and stores it, its reply carrying what the
// character faced before it, as the service stores a reply.
func saved(t *testing.T, ctx context.Context, st *store.Store, g *game.Game, cmd game.Command, discord string) game.Result {
	t.Helper()
	before, _ := g.Digest()
	seen := export.Before(g, cmd)
	if after, _ := g.Digest(); after != before {
		t.Fatal("reading what a command faces changed the world")
	}
	res, err := g.Act(cmd)
	if err != nil {
		t.Fatalf("%s: %v", cmd.Kind, err)
	}
	rep := api.ActionReply{Tick: g.Tick(), Facts: []api.Fact{}}
	for _, f := range res.Facts {
		b, _ := json.Marshal(f)
		var af api.Fact
		if err := json.Unmarshal(b, &af); err != nil {
			t.Fatal(err)
		}
		rep.Facts = append(rep.Facts, af)
	}
	for _, p := range res.Pressed {
		rep.Pressed = append(rep.Pressed, api.Pressed{Option: p.Option.ID, Band: g.BandName(p.Option.Band), Success: p.Outcome.Success})
	}
	if m := res.Machine; m != nil {
		rep.Machine = &api.PuzzleResult{Solved: m.Solved, Clean: m.Clean, Master: m.Master, Late: m.Late, At: m.At, Haywire: m.Haywire}
	}
	body, err := json.Marshal(rep)
	if err != nil {
		t.Fatal(err)
	}
	if body, err = export.Stored(body, seen); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveAction(ctx, g, cmd, res.Char, discord, body, time.Now()); err != nil {
		t.Fatal(err)
	}
	return res
}

func has(t *testing.T, file string, r map[string]any, keys ...string) {
	t.Helper()
	for _, k := range keys {
		if _, ok := r[k]; !ok {
			t.Errorf("%s: no %q in %v", file, k, r)
		}
	}
}

// TestExportFields plays a world whose replies keep what each command
// faced: a bench solve, a machine armed and failed, and the presses that
// finish its encounter; every record carries every field.
func TestExportFields(t *testing.T) {
	ctx := context.Background()
	sec, _ := testkit.Secrets(t, "mmo/export-fields-master", "w-fields")
	book := testkit.Book(t)
	r := testkit.Rules(t, book, sec.Keys)
	digest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	st, g, _ := testkit.Founded(t, ctx, pgtest.Pool(t), r, store.Meta{ID: "w-fields", KeyVersion: 1, KeyCheck: sec.Keys.Check(), SheetsDigest: digest, TickSeconds: 600})
	c := saved(t, ctx, st, g, game.Command{Key: "c-2", Kind: game.Create, Server: guild(0)}, user(0)).Char
	act := func(cmd game.Command) {
		t.Helper()
		cmd.Char = c.C.ID
		saved(t, ctx, st, g, cmd, "")
	}
	now := int64(1_000_000)
	act(game.Command{Key: "o-1", Kind: game.Correct, Asset: ledger.Coin, Units: 40, Note: "fields"})
	act(game.Command{Key: "o-2", Kind: game.Correct, Asset: ledger.Provisions, Units: 3, Note: "fields"})
	act(game.Command{Key: "b-1", Kind: game.BenchSolve, Now: now, Machine: &game.MachineCmd{Family: puzzle.Rewire, Level: 1, Log: &puzzle.Log{Moves: []puzzle.Move{{At: 100}}}}})
	act(game.Command{Key: "m-1", Kind: game.SetMachine, Asset: puzzle.Rewire, Units: 2, Note: "fields"})
	act(game.Command{Key: "m-2", Kind: game.MachineArm, Now: now, Machine: &game.MachineCmd{Source: game.SourceBeat}})
	testkit.Ticks(t, ctx, st, g, 1)
	act(game.Command{Key: "m-3", Kind: game.MachineSolve, Now: now + 5000, Machine: &game.MachineCmd{Source: game.SourceBeat, Log: &puzzle.Log{Moves: []puzzle.Move{{At: 100}}}}})
	for i := 0; c.Fight != nil && i < 40; i++ {
		v := g.Choose(c).Fight
		j := slices.IndexFunc(v.Options, func(o fight.Option) bool { return !o.Puzzle })
		if j < 0 {
			break
		}
		act(game.Command{Key: fmt.Sprintf("p-%d", i), Kind: game.Press, Option: v.Options[j].ID, Now: now + 10000})
	}
	testkit.Ticks(t, ctx, st, g, int(sheets.TicksPerDay-g.Tick()))
	dir, m := exported(t, st, book, 0, -1)
	if m.ToTick != sheets.TicksPerDay || m.Records[export.FileDays] != 2 {
		t.Fatalf("manifest %+v", m)
	}
	beats := lines(t, filepath.Join(dir, export.FileBeats))
	if len(beats) == 0 {
		t.Fatal("no beats")
	}
	for _, b := range beats {
		has(t, export.FileBeats, b, "day", "tick", "character", "server", "what", "beat", "beats", "kind", "tier", "party", "offered", "pick", "band", "success")
		offered := b["offered"].([]any)
		if !slices.ContainsFunc(offered, func(o any) bool { return o.(map[string]any)["id"] == b["pick"] }) {
			t.Errorf("the pick %v is not among the options offered %v", b["pick"], offered)
		}
		for _, o := range offered {
			has(t, export.FileBeats, o.(map[string]any), "id", "kind", "band")
		}
	}
	puzzles := lines(t, filepath.Join(dir, export.FilePuzzles))
	if len(puzzles) != 2 {
		t.Fatalf("%d puzzles, want the bench's and the machine's: %v", len(puzzles), puzzles)
	}
	for _, p := range puzzles {
		has(t, export.FilePuzzles, p, "day", "tick", "character", "server", "source", "family", "level", "practice", "tier", "party", "countdown",
			"ticks", "ms", "moves", "solved")
	}
	if p := puzzles[1]; p["source"] != game.SourceBeat || p["countdown"].(float64) <= 0 || p["ticks"].(float64) != 1 || p["moves"].(float64) != 1 {
		t.Errorf("the beat's machine: %v", p)
	}
	worth := c.C.Provisions * g.Rules().Values.Asset(ledger.Provisions)
	for _, s := range c.C.Goods {
		worth += s.Qty * g.Rules().Values.Asset(s.Material)
	}
	for _, in := range c.C.Pack {
		worth += g.ItemValue(in)
	}
	var played map[string]any
	for _, d := range lines(t, filepath.Join(dir, export.FileDays)) {
		has(t, export.FileDays, d, "day", "character", "active", "acted", "actions", "coin", "goodsValue", "xp", "bestItemLevel", "classes")
		if d["server"] != nil {
			played = d
		}
	}
	if played == nil || played["coin"].(float64) != float64(c.C.Coin) || played["goodsValue"].(float64) != float64(worth) || worth == 0 ||
		played["actions"].(map[string]any)[game.Press] == nil {
		t.Errorf("the played day, against coin %d and worth %d: %v", c.C.Coin, worth, played)
	}
	counts, err := st.Counts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range lines(t, filepath.Join(dir, export.FileWorld)) {
		has(t, export.FileWorld, w, "day", "world", "season", "seasonDay", "characters", "active", "acted", "coinPerActive", "actions", "peakPerMinute", "staged")
		if w["actions"].(float64) != float64(counts.Actions) || w["acted"].(float64) != 2 || w["characters"].(float64) != 2 {
			t.Errorf("the world's day of %d actions: %v", counts.Actions, w)
		}
	}
	var man map[string]any
	b, _ := os.ReadFile(filepath.Join(dir, export.FileManifest))
	if err := json.Unmarshal(b, &man); err != nil {
		t.Fatal(err)
	}
	has(t, export.FileManifest, man, "schema", "world", "book", "rollEpoch", "seasons", "fromTick", "toTick", "made", "records")
}
