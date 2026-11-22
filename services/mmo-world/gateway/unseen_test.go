package gateway_test

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/tile"
	simworld "jams.team/mmo-world/sim/world"
)

var characterID = regexp.MustCompile(`"c-\d+"`)

var factID = regexp.MustCompile(`"id":\d+`)

func asJSON(v any) string {
	body, _ := json.Marshal(v)
	return string(body)
}

// TestNothingUnseen reads every byte each socket is sent, alone and in a
// party, and expects nobody to have been sent what is not theirs to see.
func TestNothingUnseen(t *testing.T) {
	t.Run("solo", nothingUnseenSolo)
	t.Run("party", nothingUnseenParty)
	t.Run("pin", nothingUnseenPin)
}

// structural: how far from the character the pin stands, and how far it
// reaches; the character's own tile lies outside it.
const (
	pinAway  = 5
	pinReach = 2
)

// nothingUnseenPin plays twin worlds side by side, one given a designer's
// reserve a few tiles from a character at a bench, through a bench solve
// and ticks. No socket is sent a frame for the pin, and every frame is
// the twin's, byte for byte with fact ids renumbered by first appearance,
// until the pinned tile is reached.
func nothingUnseenPin(t *testing.T) {
	twins := [2]*world{newWorld(t), newWorld(t)}
	var vs [2]*viewer
	var sts [2]api.ActivityState
	var cs [2]*game.Char
	for i, w := range twins {
		cs[i] = w.create("u-pinned")
		w.do(func() { testkit.AtBench(t, w.g, cs[i]) })
		w.serve(nil)
		vs[i] = w.join("u-pinned", "i-pin", api.Viewer{Family: puzzle.Rewire, Level: 1}, nil)
		sts[i] = vs[i].state()
	}
	for i, w := range twins {
		solved, after := vs[i].intent(api.Intent{ID: "pinned-bench-1", Version: sts[i].Character.Version, Kind: api.ActBenchSolve,
			Machine: &api.MachineIntent{Family: puzzle.Rewire, Level: 1, Log: rewired(sts[i].Machine.Layout)}})
		if !solved.OK || solved.Machine == nil || !solved.Machine.Solved {
			t.Fatalf("twin %d's bench solve: %+v", i, solved)
		}
		sts[i] = after
		w.tick()
		sts[i] = vs[i].state()
	}

	w := twins[0]
	var at hex.Hex
	var fix tile.Fix
	designer := simworld.PinBy{Role: simworld.PinDesigner}
	w.do(func() {
		home := cs[0].C.At
		for r := int64(pinAway); r <= 2*pinAway && fix.Empty(); r++ {
			for _, h := range hex.Ring(home, r) {
				a := w.g.Rules().Gen.Archetypes(h)
				if len(a) == 0 || w.g.World.Content(h) != nil {
					continue
				}
				f := tile.Fix{Lead: a[len(a)-1]}
				if w.g.World.CheckPin(h, pinReach, f, designer, false) == nil {
					at, fix = h, f
					break
				}
			}
		}
	})
	if fix.Empty() {
		t.Fatal("no unreached tile near the character takes a designer's reserve")
	}
	sent := vs[0].tape.count()
	w.do(func() {
		if _, err := w.g.Act(game.Command{Key: "pin-1", Kind: game.PinReserve, Pin: &game.PinCmd{At: at, Reach: pinReach, Fix: fix}}); err != nil {
			t.Fatal(err)
		}
	})
	for _, v := range vs {
		v.quiet()
	}
	if got := vs[0].tape.count(); got != sent+1 {
		t.Fatalf("the character was sent %d frames for a pin", got-sent-1)
	}
	if twins[0].digest() == twins[1].digest() {
		t.Fatal("the pin left the world as its twin")
	}

	for range 3 {
		for i, w := range twins {
			w.tick()
			sts[i] = vs[i].state()
			w.do(func() {
				if w.g.World.Content(at) != nil {
					t.Fatalf("twin %d reached the pinned tile %s on a tick", i, at.Ref())
				}
			})
		}
	}
	for _, v := range vs {
		v.quiet()
	}
	tapes := [2]string{renumbered(vs[0].tape.all()), renumbered(vs[1].tape.all())}
	if tapes[0] != tapes[1] {
		t.Fatalf("the pinned twin was sent what its twin was not:\n%s\n%s", firstDiff(tapes[0], tapes[1]), firstDiff(tapes[1], tapes[0]))
	}
	for _, s := range []string{"pin-", `"pin"`, asJSON(api.Hex{Q: at.Q, R: at.R})} {
		if i := strings.Index(tapes[0], s); i >= 0 {
			t.Errorf("the character was sent %s: %s", s, tapes[0][max(0, i-80):min(len(tapes[0]), i+80)])
		}
	}

	// Reaching the tile lands the reserve there, and only in its world.
	for i, w := range twins {
		w.do(func() {
			if err := w.g.Teleport(cs[i], at); err != nil {
				t.Fatal(err)
			}
		})
		w.tick()
		vs[i].state()
		w.do(func() {
			c := w.g.World.Content(at)
			switch {
			case c == nil:
				t.Fatalf("twin %d never reached %s", i, at.Ref())
			case i == 0 && (c.Pin == "" || c.Lead != fix.Lead):
				t.Fatalf("the pinned tile holds %+v, not the fix %+v", c, fix)
			case i == 1 && c.Pin != "":
				t.Fatalf("the pinless twin's tile holds the pin %s", c.Pin)
			}
		})
	}
	for _, w := range twins {
		w.stop()
	}
	for _, v := range vs {
		v.ended()
	}
}

// renumbered is a tape with each fact id replaced by the order it first
// appears in, so a fact the twin never wrote does not shift the rest.
func renumbered(tape string) string {
	seen := map[string]string{}
	return factID.ReplaceAllStringFunc(tape, func(id string) string {
		if _, ok := seen[id]; !ok {
			seen[id] = fmt.Sprintf(`"id":"#%d"`, len(seen))
		}
		return seen[id]
	})
}

// firstDiff is a's text round the first byte where it parts from b.
func firstDiff(a, b string) string {
	i := 0
	for i < len(a) && i < len(b) && a[i] == b[i] {
		i++
	}
	return a[max(0, i-80):min(len(a), i+80)]
}

// nothingUnseenSolo drives two viewers with different sight through real
// sockets in one instance: a master on an armed machine out on a tile,
// with a pouch, and a novice at a settlement's bench. It reads every
// byte each socket is sent across arming, a tick, bench work, a lesson
// from a third character, a solve, a reconnect and forged frames, and
// expects neither to have been sent anything of the other's, of the
// third's, a key, or anything a machine is drawn from.
func nothingUnseenSolo(t *testing.T) {
	w := newWorld(t)
	g := w.g
	master, novice, teacher := w.create("u-master"), w.create("u-novice"), w.create("u-teacher")
	home := master.C.At
	away := home.Neighbour(0)
	for d := 0; !g.Rules().Gen.Passable(g.Rules().Gen.Baseline(away).Terrain); d++ {
		away = home.Neighbour(d)
	}
	master.C.At = away
	practise(master, puzzle.Circuit, 16)
	master.Pouches = []game.Pouch{{ID: "p-" + master.C.ID + "-1", Hex: away, Family: puzzle.Pins, Level: 2, Tier: 1,
		Goods: []item.Spoil{{Material: g.Rules().Book.Materials[0].ID, Qty: 4}}}}
	testkit.MachineBeat(t, g, master, puzzle.Circuit, 3)
	testkit.AtBench(t, g, novice)
	testkit.AtBench(t, g, teacher)
	practise(teacher, puzzle.Rewire, 16)
	w.serve(nil)

	// The teacher, who never opens the Activity, leaves a lesson.
	taught, _, err := w.View(t.Context(), teacher.C.ID, api.Viewer{Family: puzzle.Rewire, Level: 1}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if rep := w.act(teacher, "teach-1", api.ActionRequest{Kind: api.ActBenchSolve,
		Machine: &api.MachineIntent{Family: puzzle.Rewire, Level: 1, Teach: true, Log: rewired(taught.Machine.Layout)}}); !rep.Machine.Solved {
		t.Fatalf("the teacher's bench solve: %+v", rep.Machine)
	}

	a := w.join("u-master", "i-shared", api.Viewer{}, nil)
	mine := a.state()
	b := w.join("u-novice", "i-shared", api.Viewer{Family: puzzle.Rewire, Level: 2}, nil)
	theirs := b.state()
	if m := mine.Machine; m == nil || m.Armed || m.Family != puzzle.Circuit || m.Inner == nil || mine.Fight == nil || len(mine.Pouches) != 1 || mine.Bench != nil {
		t.Fatalf("the master's first state: %+v", mine)
	}
	if m := theirs.Machine; m == nil || m.Source != api.MachineBench || theirs.Bench == nil || theirs.Fight != nil || len(theirs.Pouches) != 0 {
		t.Fatalf("the novice's first state: %+v", theirs)
	}
	circuit, inner, bench := mine.Machine.Layout, *mine.Machine.Inner, theirs.Machine.Layout

	// The master arms. The novice is sent nothing: it is not theirs to see.
	sent, built := b.tape.count(), w.viewed(novice.C.ID)
	armReply, armed := a.intent(api.Intent{ID: "master-arm-1", Version: mine.Character.Version, Kind: api.ActMachineArm,
		Machine: &api.MachineIntent{Source: api.MachineBeat}})
	if !armReply.OK || armed.Machine == nil || !armed.Machine.Armed || !armed.Character.Armed {
		t.Fatalf("arming over the socket: %+v, %+v", armReply, armed.Machine)
	}
	a.quiet()
	b.quiet()
	if got := b.tape.count(); got != sent+1 {
		t.Fatalf("the novice was sent %d frames while the master armed a machine", got-sent-1)
	}
	if got := w.viewed(novice.C.ID); got != built {
		t.Fatalf("the novice's state was built %d times for a write that named only the master", got-built)
	}

	// A tick changes everyone's state, and each is sent their own.
	w.tick()
	if st := a.state(); st.Tick != armed.Tick+1 || st.Machine == nil || !st.Machine.Armed || st.Context.ID != master.C.ID {
		t.Fatalf("the master after a tick: %+v", st)
	}
	benchState := b.state()
	if benchState.Tick != theirs.Tick+1 || benchState.Bench == nil || benchState.Context.ID != novice.C.ID {
		t.Fatalf("the novice after a tick: %+v", benchState)
	}

	// The novice works the bench and takes the lesson a third left there.
	solved, after := b.intent(api.Intent{ID: "novice-bench-1", Version: benchState.Character.Version, Kind: api.ActBenchSolve,
		Machine: &api.MachineIntent{Family: puzzle.Rewire, Level: 2, Log: rewired(benchState.Machine.Layout)}})
	if !solved.OK || solved.Machine == nil || !solved.Machine.Solved || !slices.ContainsFunc(solved.Facts, func(f api.Fact) bool { return f.Kind == "bench.solved" }) {
		t.Fatalf("a bench solve over the socket: %+v", solved)
	}
	lesson, after := b.intent(api.Intent{ID: "novice-lesson-1", Version: after.Character.Version, Kind: api.ActBenchLesson,
		Machine: &api.MachineIntent{Family: puzzle.Rewire}})
	taken := slices.IndexFunc(lesson.Facts, func(f api.Fact) bool { return f.Kind == "lesson.taken" })
	if !lesson.OK || taken < 0 {
		t.Fatalf("a lesson over the socket: %+v", lesson)
	}
	for _, s := range lesson.Facts[taken].Subjects {
		if s.Kind == "character" && s.ID != novice.C.ID {
			t.Fatalf("the lesson's fact names %s to the learner", s.ID)
		}
	}

	// The master solves inside the countdown.
	var log *api.PuzzleLog
	w.do(func() {
		rig, _ := g.Rig(master, game.Viewer{})
		log = service.LogOf(g.Puzzles().Solve(rig.Layout))
	})
	w.clock.Advance(time.Duration(max(log.End, log.Moves[len(log.Moves)-1].At)+150) * time.Millisecond)
	done, rest := a.intent(api.Intent{ID: "master-solve-1", Version: armed.Character.Version, Kind: api.ActMachineSolve,
		Machine: &api.MachineIntent{Log: log}})
	if !done.OK || done.Machine == nil || !done.Machine.Solved || rest.Character.Armed || rest.Last == nil || !rest.Last.Result.Solved {
		t.Fatalf("a solve over the socket: %+v, last %+v", done, rest.Last)
	}

	// The master's socket drops and comes back: the first frame is the
	// whole state again.
	a.drop()
	a = w.join("u-master", "i-shared", api.Viewer{Pouch: master.Pouches[0].ID}, a.tape)
	back := a.state()
	if back.Context.ID != master.C.ID || back.Last == nil || len(back.Pouches) != 1 {
		t.Fatalf("the master after a reconnect: %+v", back)
	}

	// A client names no character, no Discord user and no privilege: a
	// frame that tries is refused whole, and nothing is written.
	before, writes := w.digest(), len(w.written())
	lessonFor := func(extra string) string {
		return fmt.Sprintf(`{"t":"intent","seq":%%d,"intent":{"id":"forged-%%d-id","version":%d,"kind":"bench-lesson",%s"machine":{"family":"rewire"}}}`,
			back.Character.Version, extra)
	}
	forged := []string{
		lessonFor(`"characterId":"` + novice.C.ID + `",`),
		lessonFor(`"discordId":"u-novice",`),
		lessonFor(`"admin":true,`),
		`{"t":"intent","seq":%d,"characterId":"` + novice.C.ID + `","intent":{"id":"forged-%d-id","version":1,"kind":"bench-lesson","machine":{"family":"rewire"}}}`,
		`{"t":"intent","seq":%d,"intent":{"id":"forged-%d-id","version":1,"kind":"bench-lesson","machine":{"family":"rewire","characterId":"` + novice.C.ID + `"}}}`,
		`{"t":"look","seq":%d,"look":{"family":"rewire","level":2,"characterId":"` + novice.C.ID + `"},"hint":{"at":%d,"a":0}}`,
	}
	for i, frame := range forged {
		a.seq++
		a.raw(fmt.Sprintf(frame, a.seq, i))
		if r := a.reply(); r.OK || r.Refusal == nil || r.Refusal.Code != api.CodeBadJSON {
			t.Fatalf("forged frame %d was answered %+v", i, r)
		}
	}
	// A kind the Activity may not send, and an intent id somebody else used.
	a.seq++
	a.send(api.ClientMessage{T: "intent", Seq: a.seq, Intent: &api.Intent{ID: "master-step-1", Version: back.Character.Version, Kind: api.ActStep}})
	if r := a.reply(); r.OK || r.Refusal == nil || r.Refusal.Code != api.CodeForbidden {
		t.Fatalf("a step from the Activity: %+v", r)
	}
	if r, _ := a.intent(api.Intent{ID: "novice-bench-1", Version: back.Character.Version, Kind: api.ActBenchSolve,
		Machine: &api.MachineIntent{Family: puzzle.Rewire, Level: 2, Log: rewired(bench)}}); r.OK || r.Duplicate || r.Refusal == nil || len(r.Facts) != 0 {
		t.Fatalf("the novice's intent id, sent by the master: %+v", r)
	}
	a.quiet()
	b.quiet()
	if w.digest() != before {
		t.Fatal("a refused frame changed the game")
	}
	// Every write the gateway made was for the socket's own character.
	owner := map[string]string{"u-master": master.C.ID, "u-novice": novice.C.ID}
	for _, req := range w.written() {
		if req.CharacterID != owner[req.DiscordID] || req.Admin || !strings.HasPrefix(req.InteractionID, "act-") {
			t.Fatalf("the gateway wrote %+v", req)
		}
	}
	if n := len(w.written()) - writes; n != 1 {
		t.Fatalf("%d writes reached the world from refused frames, want only the reused id's", n)
	}

	w.stop()
	a.ended()
	b.ended()

	at := func(h hex.Hex) string { return asJSON(api.Hex{Q: h.Q, R: h.R}) }
	for _, view := range []struct {
		who    string
		tape   string
		self   *game.Char
		other  *game.Char
		arrays []string
	}{
		{"the master", a.tape.all(), master, novice, []string{`"target":` + asJSON(bench.Target), `"target":` + asJSON(benchState.Machine.Layout.Target)}},
		{"the novice", b.tape.all(), novice, master, []string{`"tiles":` + asJSON(circuit.Tiles), `"tiles":` + asJSON(inner.Tiles), `"turn":` + asJSON(circuit.Turn)}},
	} {
		if !strings.Contains(view.tape, `"`+view.self.C.ID+`"`) || !strings.Contains(view.tape, `"state"`) || !strings.Contains(view.tape, `"reply"`) {
			t.Fatalf("%s's tape is not what was sent: %d bytes", view.who, len(view.tape))
		}
		for _, id := range characterID.FindAllString(view.tape, -1) {
			if id != `"`+view.self.C.ID+`"` {
				t.Errorf("%s was sent the character id %s", view.who, id)
				break
			}
		}
		bad := []string{"e-" + view.other.C.ID, "p-" + view.other.C.ID, at(view.other.C.At), "u-teacher", "u-master", "u-novice"}
		for _, s := range append(bad, view.arrays...) {
			if strings.Contains(view.tape, s) {
				t.Errorf("%s was sent %s", view.who, s)
			}
		}
		for _, needle := range w.needles {
			if strings.Contains(view.tape, needle) {
				t.Errorf("%s was sent a key", view.who)
			}
		}
		for _, s := range []string{`"tile:`, `"floor:`, `"bench:`, `"pouch:`, `"spec"`, `"attempt"`, `"tries"`, `"benchRuns"`} {
			if strings.Contains(view.tape, s) {
				t.Errorf("%s was sent %s, which a machine is drawn from", view.who, s)
			}
		}
	}
}

// nothingUnseenParty seats a party of three and a watcher on their tile in
// one instance. One member picks, another arms a split machine, and the
// seats solve it move by move; one drops and comes back. Each member is
// sent its own dealt part and nobody's pick but its own; the watcher, who
// is not in the party, is sent nothing of it at all.
func nothingUnseenParty(t *testing.T) {
	w := newWorld(t)
	users := []string{"u-one", "u-two", "u-three"}
	cs := w.party(users...)
	watcher := w.create("u-watcher")
	w.do(func() { watcher.C.At = cs[0].C.At })
	sh := w.facing(cs, puzzle.Fuse, 4)
	w.serve(nil)
	vs, sts := w.seatAll("i-party", users...)
	wv := w.join("u-watcher", "i-party", api.Viewer{}, nil)
	watching := wv.state()
	for i, st := range sts {
		if st.Context.Kind != api.ContextParty || st.Context != sts[0].Context || st.Party == nil || st.Fight == nil {
			t.Fatalf("member %d's first state: context %+v, party %+v", i, st.Context, st.Party)
		}
	}
	if watching.Context.Kind != api.ContextSolo || watching.Context.ID != watcher.C.ID || watching.Party != nil || watching.Fight != nil {
		t.Fatalf("the watcher's first state: %+v", watching)
	}

	// The first member picks; the others see that it has, never what.
	pick := w.holdOption(cs[0])
	rep, mine := vs[0].intent(api.Intent{ID: "member-pick-1", Version: sts[0].Character.Version, Kind: api.ActPartyPick, Option: pick})
	if !rep.OK || mine.Party == nil || mine.Party.Beat == nil || mine.Party.Beat.Mine != pick {
		t.Fatalf("the pick over the socket: %+v, %+v", rep, mine.Party)
	}
	for i := 1; i < len(vs); i++ {
		sts[i] = vs[i].state()
		if b := sts[i].Party.Beat; b == nil || b.Mine != "" || b.Picked != 1 {
			t.Fatalf("member %d after another's pick: %+v", i, b)
		}
	}
	sts[0] = mine
	wv.quiet()

	// The second arms; each seat holds its own part.
	armedSts := armOver(t, vs, sts, 1)
	m := w.armed(sh)
	var parts []puzzle.Layout
	var whole puzzle.Layout
	w.do(func() {
		parts = w.g.Puzzles().Deal(m.Spec)
		whole = w.g.Puzzles().Make(m.Spec)
	})
	log := w.solution(m)
	half := len(log.Moves) / 2
	w.playAt(t, vs, m.At, log.Moves[:half])
	vs[2].drop()
	vs[2] = w.join(users[2], "i-party", api.Viewer{}, vs[2].tape)
	vs[2].state()
	if msg := vs[2].next(); msg.T != api.FrameMoves || len(msg.Moves) != half {
		t.Fatalf("a member back was sent %+v", msg)
	}
	for _, v := range vs[:2] {
		v.caughtUp(api.ActivityState{})
	}
	w.playAt(t, vs, m.At, log.Moves[half:])
	for _, v := range vs {
		if st := v.state(); st.Last == nil || !st.Last.Result.Solved {
			t.Fatalf("a member after the merged solve: %+v", st.Last)
		}
	}
	wv.quiet()
	w.stop()
	for _, v := range append(vs, wv) {
		v.ended()
	}

	ids := []string{`"` + watcher.C.ID + `"`}
	for _, c := range cs {
		ids = append(ids, `"`+c.C.ID+`"`)
	}
	fields := func(l puzzle.Layout) map[string]string {
		out := map[string]string{}
		for name, v := range map[string]any{"target": l.Target, "glyph": l.Glyph, "order": l.Order, "false": l.False, "turn": l.Turn,
			"walls": l.Walls, "tiles": l.Tiles, "clues": l.Clues, "par": l.Par, "init": l.Init, "track": l.Track, "key": l.Key, "code": l.Code} {
			if body := asJSON(v); body != "null" && body != "[]" {
				out[name] = `"` + name + `":` + body
			}
		}
		return out
	}
	full := fields(whole)
	for i, v := range vs {
		tape := v.tape.all()
		own := fields(parts[i])
		for name, s := range full {
			if own[name] != s && strings.Contains(tape, s) {
				t.Errorf("member %d was sent the whole machine's %s, which it is not dealt", i, name)
			}
		}
		for j, p := range parts {
			for name, s := range fields(p) {
				if j != i && own[name] != s && strings.Contains(tape, s) {
					t.Errorf("member %d was sent member %d's part of %s", i, j, name)
				}
			}
		}
		for _, id := range characterID.FindAllString(tape, -1) {
			if id == ids[0] || !slices.Contains(ids, id) {
				t.Errorf("member %d was sent the character id %s", i, id)
				break
			}
		}
		if i > 0 && strings.Contains(tape, `"mine":`) {
			t.Errorf("member %d was sent a pick of another's", i)
		}
		if !strings.Contains(tape, `"t":"move"`) || !strings.Contains(tape, `"`+armedSts[i].Context.ID+`"`) {
			t.Errorf("member %d's tape is not what was sent: %d bytes", i, len(tape))
		}
	}
	tape := wv.tape.all()
	for _, s := range []string{`"t":"move"`, `"t":"moves"`, `"` + sts[0].Context.ID + `"`, `"` + sh.ID + `"`, `"party"`, `"mine"`, "u-one", "u-two", "u-three"} {
		if strings.Contains(tape, s) {
			t.Errorf("the watcher was sent %s", s)
		}
	}
	for _, id := range characterID.FindAllString(tape, -1) {
		if id != ids[0] {
			t.Errorf("the watcher was sent the character id %s", id)
			break
		}
	}
	for _, p := range append(parts, whole) {
		for name, s := range fields(p) {
			if strings.Contains(tape, s) {
				t.Errorf("the watcher was sent the party machine's %s", name)
			}
		}
	}
	for _, v := range append(vs, wv) {
		tape := v.tape.all()
		for _, needle := range w.needles {
			if strings.Contains(tape, needle) {
				t.Error("a seat was sent a key")
			}
		}
		for _, s := range []string{`"tile:`, `"floor:`, `"spec"`, `"attempt"`, `"picks"`} {
			if strings.Contains(tape, s) {
				t.Errorf("a seat was sent %s", s)
			}
		}
	}
}
