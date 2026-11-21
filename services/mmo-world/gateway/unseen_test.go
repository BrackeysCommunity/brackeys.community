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
)

var characterID = regexp.MustCompile(`"c-\d+"`)

func asJSON(v any) string {
	body, _ := json.Marshal(v)
	return string(body)
}

// TestNothingUnseen drives two viewers with different sight through real
// sockets in one instance: a master on an armed machine out on a tile,
// with a pouch, and a novice at a settlement's bench. It reads every
// byte each socket is sent across arming, a tick, bench work, a lesson
// from a third character, a solve, a reconnect and forged frames, and
// expects neither to have been sent anything of the other's, of the
// third's, a key, or anything a machine is drawn from.
func TestNothingUnseen(t *testing.T) {
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
	taught, _, err := w.View(t.Context(), teacher.C.ID, api.Viewer{Family: puzzle.Rewire, Level: 1})
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
		log = service.LogOf(g.Rules().Fight.P.Solve(rig.Layout))
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
