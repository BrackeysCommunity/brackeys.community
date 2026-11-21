package gateway_test

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/gateway"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/puzzle"
)

var armParty = api.MachineIntent{Source: api.MachineParty}

// party makes characters for Discord users and forms them into one party
// on the first one's tile, the first leading.
func (w *world) party(discords ...string) []*game.Char {
	w.t.Helper()
	var cs []*game.Char
	for _, d := range discords {
		cs = append(cs, w.create(d))
	}
	w.do(func() {
		for _, c := range cs[1:] {
			c.C.At = cs[0].C.At
			key := "party-" + c.C.ID
			if _, err := w.g.Act(game.Command{Key: key + "-invite", Char: cs[0].C.ID, Kind: game.PartyInvite, Target: c.C.ID}); err != nil {
				w.t.Fatal(err)
			}
			if _, err := w.g.Act(game.Command{Key: key + "-join", Char: c.C.ID, Kind: game.PartyJoin, Target: cs[0].C.ID}); err != nil {
				w.t.Fatal(err)
			}
		}
	})
	return cs
}

// facing puts a party before one machine beat of a family.
func (w *world) facing(cs []*game.Char, family string, level int64) *game.Shared {
	w.t.Helper()
	var sh *game.Shared
	w.do(func() { sh = testkit.PartyMachineBeat(w.t, w.g, cs, family, level) })
	return sh
}

// seatAll opens a socket for each Discord user in one instance and reads
// its states until the others have sat too.
func (w *world) seatAll(instance string, discords ...string) ([]*viewer, []api.ActivityState) {
	w.t.Helper()
	var vs []*viewer
	var sts []api.ActivityState
	for _, d := range discords {
		v := w.join(d, instance, api.Viewer{}, nil)
		vs = append(vs, v)
		sts = append(sts, v.state())
	}
	for i, v := range vs {
		sts[i] = v.caughtUp(sts[i])
	}
	return vs, sts
}

// caughtUp waits until the gateway has acted on every notice and gives
// the last state the socket was sent meanwhile, or st when it was sent
// none: a seat opening or closing beside it is a new state.
func (v *viewer) caughtUp(st api.ActivityState) api.ActivityState {
	v.t.Helper()
	v.w.gw.Settle()
	v.seq++
	v.send(api.ClientMessage{T: "ping", Seq: v.seq})
	for msg := v.next(); msg.T != "pong" || msg.Seq != v.seq; msg = v.next() {
		if msg.T != "state" || msg.State == nil {
			v.t.Fatalf("a frame nobody asked for: %+v", msg)
		}
		st = *msg.State
	}
	return st
}

// armed is the party's machine as the game holds it once armed.
func (w *world) armed(sh *game.Shared) game.PartyMachine {
	w.t.Helper()
	var m game.PartyMachine
	w.do(func() {
		if !sh.Machine.Armed() {
			w.t.Fatal("the party's machine is not armed")
		}
		m = *sh.Machine
	})
	return m
}

// armOver arms a party's machine from one seat; the others are pushed
// their states.
func armOver(t *testing.T, vs []*viewer, sts []api.ActivityState, by int) []api.ActivityState {
	t.Helper()
	rep, st := vs[by].intent(api.Intent{ID: "arm-party-" + sts[by].Character.ID + "-" + itoa(sts[by].Character.Version), Version: sts[by].Character.Version,
		Kind: api.ActMachineArm, Machine: &armParty})
	if !rep.OK || rep.Duplicate {
		t.Fatalf("arming the party's machine: %+v", rep)
	}
	out := make([]api.ActivityState, len(vs))
	for i, v := range vs {
		if i == by {
			out[i] = st
			continue
		}
		out[i] = v.state()
	}
	for i, s := range out {
		if m := s.Machine; m == nil || !m.Armed || m.Source != api.MachineParty || m.Seat != int64(i) {
			t.Fatalf("seat %d after arming: %+v", i, m)
		}
	}
	return out
}

// solution is the merged log that solves an armed party machine.
func (w *world) solution(m game.PartyMachine) puzzle.Log {
	var log puzzle.Log
	w.do(func() {
		p := w.g.Puzzles()
		l := p.Make(m.Spec)
		if m.Spec.Party != "" {
			log = p.PartySolve(l)
		} else {
			log = p.Solve(l)
		}
	})
	return log
}

// sendMove sends one move from a seat and waits for every other seat to
// have it relayed, which it returns.
func sendMove(t *testing.T, vs []*viewer, from int, mv api.PuzzleMove) api.PuzzleMove {
	t.Helper()
	vs[from].seq++
	vs[from].send(api.ClientMessage{T: api.FrameMove, Seq: vs[from].seq, Move: &mv})
	var got api.PuzzleMove
	for i, v := range vs {
		if i == from {
			continue
		}
		msg := v.next()
		if msg.T != api.FrameMove || msg.Move == nil {
			t.Fatalf("seat %d was sent %+v, want the move seat %d made", i, msg, from)
		}
		if i != from && got != (api.PuzzleMove{}) && *msg.Move != got {
			t.Fatalf("seats were relayed different moves: %+v and %+v", got, *msg.Move)
		}
		got = *msg.Move
	}
	return got
}

// playAt sends a log's moves from their seats, each once the clock is at
// its stamp, and gives the moves as relayed.
func (w *world) playAt(t *testing.T, vs []*viewer, armedAt int64, moves []puzzle.Move) []api.PuzzleMove {
	t.Helper()
	var out []api.PuzzleMove
	for _, m := range moves {
		if d := time.UnixMilli(armedAt + m.At).Sub(w.clock.Now()); d > 0 {
			w.clock.Advance(d)
		}
		out = append(out, sendMove(t, vs, int(m.Seat), api.PuzzleMove{At: m.At, A: m.A, B: m.B, C: m.C}))
	}
	return out
}

// merges are the merged solves the gateway wrote.
func (w *world) merges() []api.ActionRequest {
	var out []api.ActionRequest
	for _, a := range w.expiries() {
		if a.Kind == api.ActMachineSolve {
			out = append(out, a)
		}
	}
	return out
}

// TestPartyLayout arms party machines over real sockets: every seat holds
// the one layout the server dealt, byte for byte, the same bytes for
// every seat of a whole machine and parts that reassemble it for a split
// one, and a seat that drops and comes back gets the same bytes again and
// the merged log so far.
func TestPartyLayout(t *testing.T) {
	for _, tc := range []struct {
		family string
		split  bool
	}{{puzzle.Signal, false}, {puzzle.Fuse, true}} {
		t.Run(tc.family, func(t *testing.T) {
			w := newWorld(t)
			users := []string{"u-one", "u-two", "u-three"}
			cs := w.party(users...)
			sh := w.facing(cs, tc.family, 4)
			gw := w.serve(nil)
			vs, sts := w.seatAll("i-party", users...)
			armedSts := armOver(t, vs, sts, 2)
			m := w.armed(sh)
			if m.Spec.Party == "" || m.Spec.Seats != 3 {
				t.Fatalf("armed %+v", m.Spec)
			}
			var parts []puzzle.Layout
			var whole puzzle.Layout
			w.do(func() {
				parts = w.g.Puzzles().Deal(m.Spec)
				whole = w.g.Puzzles().Make(m.Spec)
			})
			got := make([][]byte, len(vs))
			for i, st := range armedSts {
				got[i], _ = json.Marshal(st.Machine.Layout)
				// A layout is drawn with no level or tier on it.
				part := parts[i]
				part.Level, part.Tier = 0, 0
				held, _ := json.Marshal(service.LayoutOf(st.Machine.Layout))
				want, _ := json.Marshal(part)
				if string(held) != string(want) {
					t.Fatalf("seat %d holds\n%s\nwant its dealt part\n%s", i, held, want)
				}
			}
			if !tc.split {
				for i := range got {
					if string(got[i]) != string(got[0]) {
						t.Fatalf("seat %d's layout differs from seat 0's on a whole machine", i)
					}
				}
			} else {
				reassembles(t, whole, parts)
			}

			// Two moves land, then the last seat drops and comes back: the
			// same layout bytes, then the moves so far.
			log := w.solution(m)
			played := w.playAt(t, vs, m.At, log.Moves[:2])
			vs[2].drop()
			w.clock.Advance(time.Second)
			vs[2] = w.join(users[2], "i-party", api.Viewer{}, vs[2].tape)
			back := vs[2].state()
			for _, v := range vs[:2] {
				v.caughtUp(api.ActivityState{})
			}
			if b, _ := json.Marshal(back.Machine.Layout); string(b) != string(got[2]) {
				t.Fatalf("a seat back holds\n%s\nwant\n%s", b, got[2])
			}
			moves := vs[2].next()
			if moves.T != api.FrameMoves || !slices.Equal(moves.Moves, played) {
				t.Fatalf("a seat back was sent %+v, want the moves %+v", moves, played)
			}
			kept, ok := gw.Merged(armedSts[0].Context.Kind + ":" + armedSts[0].Context.ID)
			if !ok || !slices.Equal(kept, played) {
				t.Fatalf("the gateway keeps %+v", kept)
			}
			// The rest of the log solves it, every seat's moves merged.
			w.playAt(t, vs, m.At, log.Moves[2:])
			for _, v := range vs {
				st := v.state()
				if st.Machine != nil && st.Machine.Armed || st.Last == nil || !st.Last.Result.Solved {
					t.Fatalf("a seat after the merged solve: machine %+v, last %+v", st.Machine, st.Last)
				}
			}
			if n := len(w.merges()); n != 1 {
				t.Fatalf("%d merged solves written", n)
			}
		})
	}
}

// reassembles checks that every element of a whole layout's arrays is
// shown to some seat, and that no seat is shown one it differs on.
func reassembles(t *testing.T, whole puzzle.Layout, parts []puzzle.Layout) {
	t.Helper()
	fields := func(l puzzle.Layout) map[string][]int64 {
		clues := make([]int64, 0, 2*len(l.Clues))
		for _, c := range l.Clues {
			clues = append(clues, c.Before, c.After)
		}
		return map[string][]int64{"target": l.Target, "glyph": l.Glyph, "order": l.Order, "false": l.False, "turn": l.Turn, "walls": l.Walls,
			"tiles": l.Tiles, "clues": clues, "par": l.Par, "init": l.Init, "track": l.Track, "key": l.Key, "code": l.Code}
	}
	all := fields(whole)
	split := false
	for name, want := range all {
		shown := false
		for _, p := range parts {
			if f := fields(p)[name]; f != nil {
				shown = true
			}
		}
		if !shown {
			continue // a field no seat is shown, such as the answer
		}
		for i, x := range want {
			seen := false
			for s, p := range parts {
				f := fields(p)[name]
				switch {
				case f == nil:
					split = true
				case len(f) != len(want):
					t.Fatalf("seat %d's %s has %d elements, the machine %d", s, name, len(f), len(want))
				case f[i] == puzzle.Unseen:
					split = true
				case f[i] != x:
					t.Fatalf("seat %d is shown %s[%d] as %d, the machine has %d", s, name, i, f[i], x)
				default:
					seen = true
				}
			}
			if !seen {
				t.Fatalf("%s[%d] is shown to no seat", name, i)
			}
		}
	}
	if !split {
		t.Fatal("a split machine dealt every seat all of it")
	}
}

// TestPartyRelay plays a party machine move by move. Each move is relayed
// to the other seats as it lands, in the order the gateway kept it,
// stamped with its seat and an At no earlier than the move before and no
// later than the server's time since arming. The log is judged after each
// move and written once, under the machine's key, when it is done; and
// when that write and the countdown's end race, there is still one.
func TestPartyRelay(t *testing.T) {
	w := newWorld(t)
	users := []string{"u-one", "u-two", "u-three"}
	cs := w.party(users...)
	sh := w.facing(cs, puzzle.Fuse, 4)
	gw := w.serve(nil)
	vs, sts := w.seatAll("i-party", users...)
	armedSts := armOver(t, vs, sts, 1)
	m := w.armed(sh)
	log := w.solution(m)
	if len(log.Moves) < 4 {
		t.Fatalf("a solve of %d moves", len(log.Moves))
	}
	key := armedSts[0].Context.Kind + ":" + armedSts[0].Context.ID

	at := func(ms int64) {
		if d := time.UnixMilli(m.At + ms).Sub(w.clock.Now()); d > 0 {
			w.clock.Advance(d)
		}
	}
	first, second, third := log.Moves[0], log.Moves[1], log.Moves[2]
	// A stamp ahead of the server's clock is pulled back to it.
	at(first.At + 100)
	got := sendMove(t, vs, int(first.Seat), api.PuzzleMove{At: first.At + 1_000_000, A: first.A, B: first.B, C: first.C, Seat: 7})
	if want := (api.PuzzleMove{At: first.At + 100, A: first.A, B: first.B, C: first.C, Seat: first.Seat}); got != want {
		t.Fatalf("the first move was relayed as %+v, want %+v", got, want)
	}
	// One stamped before the last move is put after it.
	at(second.At + 300)
	got = sendMove(t, vs, int(second.Seat), api.PuzzleMove{At: 0, A: second.A, B: second.B, C: second.C})
	if got.At != first.At+100 || got.Seat != second.Seat {
		t.Fatalf("a move stamped early was relayed as %+v", got)
	}
	// One between the two is kept as it is.
	at(third.At + 400)
	got = sendMove(t, vs, int(third.Seat), api.PuzzleMove{At: third.At + 350, A: third.A, B: third.B, C: third.C})
	if got.At != third.At+350 {
		t.Fatalf("a stamp inside the bounds was relayed as %+v", got)
	}
	if len(w.merges()) != 0 {
		t.Fatal("a log going was written")
	}
	kept, _ := gw.Merged(key)
	if len(kept) != 3 || kept[2] != got {
		t.Fatalf("the merged log kept %+v", kept)
	}
	// The rest solves it: one write, as seat 0, under the machine's key.
	rest := slices.Clone(log.Moves[3:])
	for i := range rest {
		rest[i].At += 400
	}
	w.playAt(t, vs, m.At, rest)
	writes := w.merges()
	if len(writes) != 1 || writes[0].InteractionID != "mx-"+cs[0].C.ID+"-"+itoa(m.At) || writes[0].CharacterID != cs[0].C.ID ||
		writes[0].Machine == nil || writes[0].Machine.Log == nil || len(writes[0].Machine.Log.Moves) != len(log.Moves) {
		t.Fatalf("the merged solve: %+v", writes)
	}
	for _, v := range vs {
		if st := v.state(); st.Last == nil || !st.Last.Result.Solved {
			t.Fatalf("a seat after the merged solve: %+v", st.Last)
		}
	}
	w.past(armedSts[0].Machine, time.Minute)
	if n := len(w.merges()); n != 1 || gw.Countdowns() != 0 {
		t.Fatalf("%d merged solves and %d countdowns after the countdown's time", n, gw.Countdowns())
	}

	// The Judge's write and the countdown's end, at once, either way round.
	for _, judgeFirst := range []bool{true, false} {
		w.tick()
		for _, v := range vs {
			v.state()
		}
		sh = w.facing(cs, puzzle.Fuse, 4)
		sts = make([]api.ActivityState, len(vs))
		for i, v := range vs {
			v.seq++
			v.send(api.ClientMessage{T: "look", Seq: v.seq, Look: &api.Viewer{}})
			sts[i] = v.state()
		}
		armedSts = armOver(t, vs, sts, 0)
		m = w.armed(sh)
		log = w.solution(m)
		before := len(w.merges())
		w.playAt(t, vs, m.At, log.Moves[:len(log.Moves)-1])
		last := log.Moves[len(log.Moves)-1]
		late := time.UnixMilli(armedSts[0].Machine.Due).Sub(w.clock.Now()) + time.Second
		done := make(chan struct{})
		var once bool
		w.do(func() {
			w.hook = func(req api.ActionRequest) {
				if once || !strings.HasPrefix(req.InteractionID, "mx-") {
					return
				}
				once = true
				if judgeFirst {
					// The countdown runs out while the Judge's write is in.
					go func() { defer close(done); w.clock.Advance(late) }()
				} else {
					// The solving move lands while the countdown's end is in.
					go func() {
						defer close(done)
						vs[last.Seat].send(api.ClientMessage{T: api.FrameMove, Move: &api.PuzzleMove{At: last.At, A: last.A, B: last.B, C: last.C}})
					}()
				}
				time.Sleep(50 * time.Millisecond)
			}
		})
		if judgeFirst {
			if d := time.UnixMilli(m.At + last.At).Sub(w.clock.Now()); d > 0 {
				w.clock.Advance(d)
			}
			vs[last.Seat].send(api.ClientMessage{T: api.FrameMove, Move: &api.PuzzleMove{At: last.At, A: last.A, B: last.B, C: last.C}})
		} else {
			w.clock.Advance(late)
		}
		<-done
		gw.Settle()
		w.do(func() { w.hook = nil })
		writes := w.merges()[before:]
		if len(writes) != 1 || writes[0].InteractionID != "mx-"+cs[0].C.ID+"-"+itoa(m.At) {
			t.Fatalf("judge first %v: %d merged writes %+v", judgeFirst, len(writes), writes)
		}
		var res *game.MachineDone
		w.do(func() { res = cs[0].LastMachine })
		if res == nil || res.Result.Solved != judgeFirst {
			t.Fatalf("judge first %v: the machine ended %+v", judgeFirst, res)
		}
		w.clock.Advance(time.Minute)
		if n := len(w.merges()[before:]); n != 1 || gw.Countdowns() != 0 {
			t.Fatalf("judge first %v: %d writes and %d countdowns at the end", judgeFirst, n, gw.Countdowns())
		}
		// Drain what the end pushed.
		for _, v := range vs {
			v.seq++
			v.send(api.ClientMessage{T: "ping", Seq: v.seq})
			for msg := v.next(); msg.T != "pong" || msg.Seq != v.seq; msg = v.next() {
			}
		}
	}
}

// TestArmNeedsSeats refuses to arm a party machine until everyone at it
// has a seat open in the same instance, bound to the party, and writes
// nothing while it refuses.
func TestArmNeedsSeats(t *testing.T) {
	w := newWorld(t)
	users := []string{"u-one", "u-two", "u-three"}
	cs := w.party(users...)
	watcher := w.create("u-watcher")
	w.do(func() { watcher.C.At = cs[0].C.At })
	sh := w.facing(cs, puzzle.Fuse, 3)
	w.serve(nil)
	vs, sts := w.seatAll("i-party", users[0], users[1], "u-watcher")
	if st := sts[2]; st.Context.Kind != api.ContextSolo || st.Context.ID != watcher.C.ID {
		t.Fatalf("the watcher is bound to %+v", st.Context)
	}
	refusedArm := func(why string) {
		t.Helper()
		before, writes := w.digest(), len(w.written())
		rep, _ := vs[0].intent(api.Intent{ID: "arm-refused-" + itoa(int64(len(w.written()))) + "-" + itoa(vs[0].seq), Version: sts[0].Character.Version, Kind: api.ActMachineArm, Machine: &armParty})
		if rep.OK || rep.Refusal == nil || rep.Refusal.Code != api.CodePartyNotSeated {
			t.Fatalf("%s: arming was answered %+v", why, rep)
		}
		if len(w.written()) != writes || w.digest() != before {
			t.Fatalf("%s: a refused arming reached the world", why)
		}
		w.do(func() {
			if sh.Machine.Armed() {
				t.Fatalf("%s: the machine armed", why)
			}
		})
	}
	if seats := sts[0].Machine.Seats; len(seats) != 3 || !seats[0].Here || !seats[1].Here || seats[2].Here {
		t.Fatalf("the seats before the last member sits: %+v", seats)
	}
	refusedArm("one member has no seat")
	// A seat in another instance is not one at this machine.
	away := w.join(users[2], "i-elsewhere", api.Viewer{}, nil)
	away.state()
	refusedArm("one member is seated in another instance")
	third := w.join(users[2], "i-party", api.Viewer{}, nil)
	third.state()
	sts[0] = vs[0].caughtUp(sts[0])
	vs[1].caughtUp(sts[1])
	if seats := sts[0].Machine.Seats; len(seats) != 3 || !seats[2].Here {
		t.Fatalf("the seats once the last member sits: %+v", seats)
	}
	rep, st := vs[0].intent(api.Intent{ID: "arm-seated-all", Version: sts[0].Character.Version, Kind: api.ActMachineArm, Machine: &armParty})
	if !rep.OK || st.Machine == nil || !st.Machine.Armed {
		t.Fatalf("arming with every member seated: %+v, %+v", rep, st.Machine)
	}
	m := w.armed(sh)
	if len(m.Seats) != 3 {
		t.Fatalf("seats %v", m.Seats)
	}
}

// TestMoveRateCap holds a character's seats to so many moves a second,
// apart from the intent cap, and takes moves again a second later.
func TestMoveRateCap(t *testing.T) {
	w := newWorld(t)
	users := []string{"u-one", "u-two"}
	cs := w.party(users...)
	sh := w.facing(cs, puzzle.Fuse, 3)
	gw := w.serve(nil)
	vs, sts := w.seatAll("i-party", users...)
	armedSts := armOver(t, vs, sts, 0)
	key := armedSts[0].Context.Kind + ":" + armedSts[0].Context.ID
	// The seat that does not hold the cutters first: its pulls change
	// nothing.
	idler := 1 - int(w.solution(w.armed(sh)).Moves[0].Seat)
	idle := api.PuzzleMove{A: 0}
	w.clock.Advance(100 * time.Millisecond)
	for range gateway.MaxMoves {
		sendMove(t, vs, idler, idle)
	}
	vs[idler].seq++
	vs[idler].send(api.ClientMessage{T: api.FrameMove, Seq: vs[idler].seq, Move: &idle})
	if r := vs[idler].reply(); r.Refusal == nil || r.Refusal.Code != api.CodeBusy {
		t.Fatalf("a move past the cap: %+v", r)
	}
	// A look is still taken: the caps are apart.
	vs[idler].seq++
	vs[idler].send(api.ClientMessage{T: "look", Seq: vs[idler].seq, Look: &api.Viewer{}})
	vs[idler].state()
	if kept, _ := gw.Merged(key); len(kept) != gateway.MaxMoves {
		t.Fatalf("%d moves kept, want %d", len(kept), gateway.MaxMoves)
	}
	w.clock.Advance(time.Second)
	sendMove(t, vs, idler, idle)
	if kept, _ := gw.Merged(key); len(kept) != gateway.MaxMoves+1 || len(w.merges()) != 0 {
		t.Fatalf("%d moves kept a second later, %d writes", len(kept), len(w.merges()))
	}
}

// TestBannedFirstSeat holds that a ban of an armed party machine's first
// seat ends the countdown and the gateway writes nothing for it; the
// seats left can arm again.
func TestBannedFirstSeat(t *testing.T) {
	for _, users := range [][]string{{"u-one", "u-two", "u-three"}, {"u-one", "u-two"}} {
		t.Run(itoa(int64(len(users))), func(t *testing.T) { bannedFirstSeat(t, users) })
	}
}

func bannedFirstSeat(t *testing.T, users []string) {
	w := newWorld(t)
	cs := w.party(users...)
	sh := w.facing(cs, puzzle.Fuse, 3)
	w.serve(nil)
	vs, sts := w.seatAll("i-party", users...)
	armOver(t, vs, sts, 1)
	m := w.armed(sh)
	seats := slices.Clone(m.Seats)
	rec, _, err := w.Countdown(context.Background(), seats[1])
	if err != nil {
		t.Fatal(err)
	}
	w.do(func() {
		if _, err := w.g.Act(game.Command{Key: "ban-first", Char: seats[0], Kind: game.Ban, Note: "test"}); err != nil {
			t.Fatal(err)
		}
	})
	w.tick()
	w.gw.Settle()
	w.do(func() {
		if sh.Machine.Armed() {
			t.Fatal("the machine is still armed after the ban")
		}
	})
	w.clock.Advance(time.UnixMilli(rec.Due).Sub(w.clock.Now()) + time.Second)
	w.gw.Settle()
	if merged := w.merges(); len(merged) != 0 {
		t.Fatalf("the merged writes after the first seat's ban: %+v", merged)
	}
	if len(users) < 3 {
		return
	}
	rest := vs[1:]
	rsts := make([]api.ActivityState, len(rest))
	for i, v := range rest {
		rsts[i] = v.caughtUp(sts[i+1])
	}
	armOver(t, rest, rsts, 0)
	again := w.armed(sh)
	if again.Seats[0] != seats[1] {
		t.Fatalf("the first seat after arming again: %s, want %s", again.Seats[0], seats[1])
	}
	rec, _, err = w.Countdown(context.Background(), seats[1])
	if err != nil {
		t.Fatal(err)
	}
	w.clock.Advance(time.UnixMilli(rec.Due).Sub(w.clock.Now()) + time.Second)
	w.gw.Settle()
	if merged := w.merges(); len(merged) != 1 || merged[0].CharacterID != seats[1] {
		t.Fatalf("the merged writes after arming again: %+v", merged)
	}
}
