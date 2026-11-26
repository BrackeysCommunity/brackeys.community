package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// structural: the replay run's world: the Economy population of ten for
// ten world days (GDD 18.3, replay-matches).
const (
	replayPlayers = 10
	replayDays    = 10
)

// ReplayRun plays the Economy population (n players, ten unless given)
// for ten world days, keeping a snapshot at each world day's start, every
// command a player sent that the world accepted and every tick's digest;
// then replays each day from its snapshot, alone, and holds when every
// tick reaches the digest the play recorded.
func ReplayRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	if n == 0 {
		n = replayPlayers
	}
	return replayRun(b, out, n, replayDays)
}

func replayRun(b *sheets.Book, out string, n int, days int64) ([]Measured, error) {
	pop := soakers(b, n)
	rw := &replayWatch{digests: map[int64]string{}, cmds: map[int64][]api.ActionRequest{}}
	pop.watch = rw
	pop.until = func(*game.Game) bool { return rw.err != nil }
	res, err := soak(b, pop, days)
	if err == nil {
		err = rw.err
	}
	if err != nil {
		return nil, fmt.Errorf("replay run, the play: %w", err)
	}
	ctx := context.Background()
	var lines []replayDay
	for _, s := range rw.snaps {
		if s.tick >= days*sheets.TicksPerDay {
			continue
		}
		l, err := replayFrom(ctx, rw.g.Rules(), s, rw)
		if err != nil {
			return nil, fmt.Errorf("replay run, the day from tick %d: %w", s.tick, err)
		}
		lines = append(lines, l)
	}
	m := replayReading(n, days, rw, lines)
	fmt.Fprintf(os.Stderr, "replay: %d players, %d days, %d commands, digest %s: %s\n", n, days, rw.recorded, res.digest, m.Value)
	if err := replayDoc(n, days, res, rw, lines, m).save(out, "replay.md"); err != nil {
		return nil, err
	}
	return []Measured{m}, nil
}

// replayWatch keeps what a replay needs while the soak plays: a snapshot
// at the start of each world day, the accepted commands by the tick they
// were sent at, and the digest after every tick.
type replayWatch struct {
	g        *game.Game
	snaps    []replaySnap
	cmds     map[int64][]api.ActionRequest
	digests  map[int64]string
	recorded int
	err      error
}

type replaySnap struct {
	tick   int64
	digest string
	body   []byte
}

func (w *replayWatch) open(sw *soakWorld) agent.Client {
	w.g = sw.g
	w.snapshot(sw.g)
	if l, ok := sw.client.(*service.Local); ok {
		return &recordingLocal{Local: l, w: w}
	}
	return recordingClient{Client: sw.client, w: w}
}

func (w *replayWatch) snapshot(g *game.Game) {
	if w.err != nil {
		return
	}
	d, err := g.Digest()
	if err != nil {
		w.err = err
		return
	}
	body, err := json.Marshal(g)
	if err != nil {
		w.err = err
		return
	}
	w.digests[g.Tick()] = d.String()
	w.snaps = append(w.snaps, replaySnap{tick: g.Tick(), digest: d.String(), body: body})
}

func (w *replayWatch) tick(g *game.Game, _ []ledger.Txn) {
	if w.err != nil {
		return
	}
	d, err := g.Digest()
	if err != nil {
		w.err = err
		return
	}
	w.digests[g.Tick()] = d.String()
}

// day snapshots the world at the next world day's start; the last day's
// end needs none.
func (w *replayWatch) day(g *game.Game) { w.snapshot(g) }

func (w *replayWatch) record(tick int64, req api.ActionRequest) {
	w.cmds[tick] = append(w.cmds[tick], req)
	w.recorded++
}

// recordingLocal is the in-process world with every accepted command
// kept; every page the players read stays as it was.
type recordingLocal struct {
	*service.Local
	w *replayWatch
}

func (r *recordingLocal) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	tick := r.G.Tick()
	rep, ref, err := r.Local.Act(ctx, req)
	if err == nil && ref == nil {
		r.w.record(tick, req)
	}
	return rep, ref, err
}

// recordingClient keeps the accepted commands of a client that hides the
// world's pages.
type recordingClient struct {
	agent.Client
	w *replayWatch
}

func (r recordingClient) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	tick := r.w.g.Tick()
	rep, ref, err := r.Client.Act(ctx, req)
	if err == nil && ref == nil {
		r.w.record(tick, req)
	}
	return rep, ref, err
}

// replayDay is one world day replayed from its snapshot.
type replayDay struct {
	from, to  int64 // ticks
	commands  int
	checked   int
	refused   int    // commands the replay refused that the play accepted
	loaded    bool   // the snapshot loaded to its digest
	mismatch  int64  // the first tick whose digest differed; 0 for none
	got, want string // at the mismatch
	bytes     int
	elapsed   time.Duration
}

func (d replayDay) holds() bool {
	return d.loaded && d.mismatch == 0 && d.refused == 0 && d.checked == int(d.to-d.from)
}

// replayFrom loads a snapshot into a world of its own and replays its
// world day: each tick's recorded commands through a fresh in-process
// service, then the tick, each digest checked against the play's.
func replayFrom(ctx context.Context, r *game.Rules, s replaySnap, w *replayWatch) (replayDay, error) {
	start := time.Now()
	out := replayDay{from: s.tick, to: s.tick + sheets.TicksPerDay, bytes: len(s.body)}
	for t := out.from + 1; t <= out.to; t++ {
		if _, ok := w.digests[t]; !ok {
			out.to = t - 1
			break
		}
	}
	g := &game.Game{}
	if err := json.Unmarshal(s.body, g); err != nil {
		return out, err
	}
	g.Attach(r)
	d, err := g.Digest()
	if err != nil {
		return out, err
	}
	out.loaded = d.String() == s.digest
	if !out.loaded {
		out.mismatch, out.got, out.want = s.tick, d.String(), s.digest
		return out, nil
	}
	local := service.NewLocal(g)
	for t := out.from; t < out.to; t++ {
		for _, req := range w.cmds[t] {
			out.commands++
			if _, ref, err := local.Act(ctx, req); err != nil {
				return out, err
			} else if ref != nil {
				out.refused++
			}
		}
		if _, err := g.Advance(); err != nil {
			return out, err
		}
		g.Flush()
		d, err := g.Digest()
		if err != nil {
			return out, err
		}
		out.checked++
		if want := w.digests[g.Tick()]; d.String() != want {
			out.mismatch, out.got, out.want = g.Tick(), d.String(), want
			break
		}
	}
	out.elapsed = time.Since(start)
	return out, nil
}

// replayReading is replay-matches over every day replayed.
func replayReading(n int, days int64, w *replayWatch, lines []replayDay) Measured {
	ok, ticks, commands := len(lines) > 0, 0, 0
	var first *replayDay
	for i := range lines {
		ticks += lines[i].checked
		commands += lines[i].commands
		if !lines[i].holds() && first == nil {
			first = &lines[i]
		}
		ok = ok && lines[i].holds()
	}
	v := fmt.Sprintf("replay, the Economy population of %d for %d world days: %s ticks replayed from %d daily snapshots with %s recorded commands, ",
		n, days, comma(int64(ticks)), len(lines), comma(int64(commands)))
	switch {
	case first == nil && ok:
		v += "every digest matches"
	case first == nil:
		v += "nothing replayed"
	case !first.loaded:
		v += fmt.Sprintf("the snapshot at tick %d **loads to another digest**", first.from)
	case first.refused > 0:
		v += fmt.Sprintf("**%d commands refused on replay** from tick %d", first.refused, first.from)
	case first.mismatch > 0:
		v += fmt.Sprintf("**tick %d differs**", first.mismatch)
	default:
		v += fmt.Sprintf("**the day from tick %d stopped after %d ticks**", first.from, first.checked)
	}
	if w.recorded != commands {
		ok = false
		v += fmt.Sprintf("; **%d of %d recorded commands replayed**", commands, w.recorded)
	}
	return Measured{Target: "replay-matches", Value: v, Holds: ok}
}

func replayDoc(n int, days int64, res economyResult, w *replayWatch, lines []replayDay, m Measured) *lineDoc {
	var doc lineDoc
	p := doc.p
	p("# Replay run")
	p("")
	p("The Economy run's players (`harness economy -n %d`: the same roles, key and dice, `ECONOMY_SEED` %q) play %d world days through the in-process service. The run keeps the world's snapshot at each world day's start (the store's snapshot: the game as JSON), every command the world accepted with the tick it was sent at, and the digest after every tick. Each day is then replayed alone: its snapshot loaded and re-attached to the rules, its commands sent again through a fresh in-process service in order, and every tick's digest compared with the play's.",
		n, os.Getenv("ECONOMY_SEED"), days)
	p("")
	p("| Target | Reading | Holds |")
	p("| --- | --- | --- |")
	p("| %s | %s | %s |", m.Target, esc(m.Value), holds(m.Holds))
	p("")
	p("The play: %s actions, %s refused, %s commands recorded, the world's digest at the end `%s`, in %s.", comma(int64(res.actions)), comma(int64(res.refused)),
		comma(int64(w.recorded)), shortID(res.digest), res.elapsed.Round(time.Second))
	p("")
	p("| Day | Ticks | Snapshot | Commands | Ticks checked | Refused on replay | Holds | Time |")
	p("| --- | --- | --- | --- | --- | --- | --- | --- |")
	for _, l := range lines {
		mark := holds(l.holds())
		if l.mismatch > 0 {
			mark = fmt.Sprintf("**NO**: tick %d is `%s`, the play's `%s`", l.mismatch, shortID(l.got), shortID(l.want))
		}
		p("| %d | %d to %d | %s KB | %d | %d | %d | %s | %s |", dayOfTick(l.from), l.from, l.to, comma(int64(l.bytes/1024)), l.commands, l.checked, l.refused,
			mark, l.elapsed.Round(time.Millisecond))
	}
	return &doc
}
