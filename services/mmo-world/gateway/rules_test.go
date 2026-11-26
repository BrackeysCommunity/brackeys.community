package gateway_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/gateway"
)

// fakeHost is a world a test writes by hand: who plays whom, and the
// state each character is shown.
type fakeHost struct {
	mu      sync.Mutex
	players map[string]string
	states  map[string]api.ActivityState
	subs    []func([]string)
	acts    []api.ActionRequest
	// A party's machine: its countdown by character, who sits at it, and
	// what the Judge says of a log.
	armed map[string]api.ArmedMachine
	seats map[string][]string
	judge func(api.PuzzleLog) string
}

func (h *fakeHost) CharacterOf(_ context.Context, discord string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.players[discord], nil
}

// View holds back the pass on a machine already passed on, as the
// service's filter does.
func (h *fakeHost) View(_ context.Context, id string, _ api.Viewer, passed int64) (api.ActivityState, bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	st, ok := h.states[id]
	if m := st.Machine; m != nil && m.Armed && passed == m.ArmedAt {
		passed := *m
		passed.CanPass, passed.Pass = false, nil
		st.Machine = &passed
	}
	return st, ok, nil
}

func (h *fakeHost) Act(_ context.Context, req api.ActionRequest, _ bool) (api.ActionReply, *api.Refusal, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.acts = append(h.acts, req)
	return api.ActionReply{Character: api.Character{ID: req.CharacterID}}, nil, nil
}

func (h *fakeHost) Armed(context.Context) ([]api.ArmedMachine, error) { return nil, nil }

func (h *fakeHost) Countdown(_ context.Context, id string) (api.ArmedMachine, bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if m, ok := h.armed[id]; ok {
		return m, true, nil
	}
	return api.ArmedMachine{CharacterID: id}, true, nil
}

func (h *fakeHost) Windows(context.Context) ([]api.OpenWindow, error) { return nil, nil }

func (h *fakeHost) Window(context.Context, string) (api.OpenWindow, bool, error) {
	return api.OpenWindow{}, false, nil
}

func (h *fakeHost) Judge(_ context.Context, _ string, log api.PuzzleLog) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.judge == nil {
		return "", nil
	}
	return h.judge(log), nil
}

func (h *fakeHost) Seats(_ context.Context, id string) (string, []string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	st := h.states[id]
	return st.Context.Kind + ":" + st.Context.ID, h.seats[id], nil
}

// The map is not this world's: every chunk is one nobody found.
func (h *fakeHost) MapIndex(context.Context) (api.MapIndex, error) {
	return api.MapIndex{Chunks: []api.MapChunkRef{}}, nil
}

func (h *fakeHost) MapStyle(context.Context) (api.MapStyle, error) { return api.MapStyle{}, nil }

func (h *fakeHost) MapRegions(context.Context) (api.MapRegions, error) { return api.MapRegions{}, nil }

func (h *fakeHost) MapChunk(context.Context, int64, int64, string) (api.MapChunk, *api.Refusal, error) {
	return api.MapChunk{}, &api.Refusal{Code: api.CodeNotFound, Message: "nobody has found that chunk"}, nil
}

func (h *fakeHost) MapOverlay(_ context.Context, id string, _ api.MapOverlayQuery) (api.MapOverlay, *api.Refusal, error) {
	viewer := api.ViewerCharacter
	if id == "" {
		viewer = api.ViewerAnonymous
	}
	return api.MapOverlay{Viewer: viewer, Tiles: []api.MapLive{}, Fronts: []api.MapFront{}}, nil, nil
}

func (h *fakeHost) Subscribe(f func([]string)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.subs = append(h.subs, f)
}

// set changes the world and tells its listeners, as a write does.
func (h *fakeHost) set(change func(), ids []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	change()
	for _, f := range h.subs {
		f(ids)
	}
}

// faked is a gateway over a hand-written world, reached like a real one.
func faked(t *testing.T, h *fakeHost, change func(*gateway.Gateway)) *world {
	t.Helper()
	w := &world{t: t, clock: newClock()}
	w.gw = gateway.New(gateway.Config{Host: h, Dev: true, Clock: w.clock})
	if change != nil {
		change(w.gw)
	}
	if err := w.gw.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	w.srv = httptest.NewServer(w.gw.Handler())
	t.Cleanup(w.stop)
	return w
}

func solo(id string) api.ActivityState {
	return api.ActivityState{Context: api.Context{Kind: "solo", ID: id}, Character: api.Character{ID: id}}
}

// TestHintRelay seats two characters in one context and a third in its
// own. A master's one hint for an armed machine reaches the other seat
// of its context and nobody else, once, and only the move their state
// says they may pass.
func TestHintRelay(t *testing.T) {
	party := api.Context{Kind: "party", ID: "p-1"}
	first, second, guide := api.PuzzleMove{At: 1, A: 2, B: 3}, api.PuzzleMove{A: 4, C: 1}, api.PuzzleMove{A: 7}
	clock := newClock()
	machine := func(armedAt int64, pass api.PuzzleMove) *api.MachineView {
		return &api.MachineView{Source: api.MachineBeat, Family: "rewire", Armed: true, ArmedAt: armedAt, Deadline: clock.Now().Add(time.Hour).UnixMilli(),
			Due:     clock.Now().Add(time.Hour).UnixMilli(),
			CanPass: true, Pass: &pass, Hints: []api.PuzzleMove{first, second}, Guide: &guide}
	}
	h := &fakeHost{players: map[string]string{"u-master": "c-1", "u-partner": "c-2", "u-stranger": "c-3"}, states: map[string]api.ActivityState{
		"c-1": {Context: party, Character: api.Character{ID: "c-1"}, Machine: machine(1000, first)},
		"c-2": {Context: party, Character: api.Character{ID: "c-2"}},
		"c-3": solo("c-3"),
	}}
	w := faked(t, h, nil)
	master, partner, stranger := w.join("u-master", "i-1", api.Viewer{}, nil), w.join("u-partner", "i-1", api.Viewer{}, nil), w.join("u-stranger", "i-1", api.Viewer{}, nil)
	if st := master.state(); !st.Machine.CanPass {
		t.Fatalf("the master's machine: %+v", st.Machine)
	}
	partner.state()
	stranger.state()
	pass := func(v *viewer, m *api.PuzzleMove) {
		v.seq++
		v.send(api.ClientMessage{T: "pass-hint", Seq: v.seq, Hint: m})
	}

	// A seat with nothing to pass, a move the master was never shown, a
	// hint that is not the one to pass.
	pass(partner, &first)
	if r := partner.reply(); r.Refusal == nil || r.Refusal.Code != api.CodeForbidden {
		t.Fatalf("a hint from a seat with none to pass: %+v", r)
	}
	pass(master, &api.PuzzleMove{A: 99})
	if r := master.reply(); r.Refusal == nil {
		t.Fatalf("a hint the master was never shown: %+v", r)
	}
	pass(master, &second)
	if r := master.reply(); r.Refusal == nil {
		t.Fatalf("a hint that is not the one to pass: %+v", r)
	}
	pass(master, nil)
	if r := master.reply(); r.Refusal == nil {
		t.Fatalf("a pass with no hint: %+v", r)
	}

	pass(master, &first)
	if msg := partner.next(); msg.T != "hint" || msg.Hint == nil || *msg.Hint != first {
		t.Fatalf("the partner was sent %+v", msg)
	}
	if st := master.state(); st.Machine.CanPass || st.Machine.Pass != nil || !st.Machine.Armed {
		t.Fatalf("the master's machine after passing: %+v", st.Machine)
	}
	pass(master, &first)
	if r := master.reply(); r.Refusal == nil || r.Refusal.Code != api.CodeForbidden {
		t.Fatalf("a second hint on one machine: %+v", r)
	}
	master.quiet()
	partner.quiet()
	stranger.quiet()

	// The next armed machine has its own hint, and the guide line counts.
	h.set(func() {
		st := h.states["c-1"]
		st.Machine = machine(2000, guide)
		h.states["c-1"] = st
	}, []string{"c-1"})
	if st := master.state(); !st.Machine.CanPass || st.Machine.ArmedAt != 2000 {
		t.Fatalf("the master's next machine: %+v", st.Machine)
	}
	pass(master, &guide)
	if msg := partner.next(); msg.T != "hint" || *msg.Hint != guide {
		t.Fatalf("the partner was sent %+v", msg)
	}
	master.state()
	stranger.quiet()
	if strings.Contains(stranger.tape.all(), `"hint"`) || strings.Contains(stranger.tape.all(), "c-1") {
		t.Fatal("a seat in another context was sent the hint")
	}
}

// TestSeatFollowsOwner replaces who plays a character, as a reset does:
// the seat's socket is sent back to sign in, and nothing of the
// character's new owner.
func TestSeatFollowsOwner(t *testing.T) {
	h := &fakeHost{players: map[string]string{"u-old": "c-1"}, states: map[string]api.ActivityState{"c-1": solo("c-1")}}
	w := faked(t, h, nil)
	v := w.join("u-old", "i-1", api.Viewer{}, nil)
	v.state()
	h.set(func() {
		h.players = map[string]string{"u-new": "c-1"}
		st := solo("c-1")
		st.Place.Name = "the newcomer's camp"
		h.states["c-1"] = st
	}, nil)
	if bye, _, _ := v.ended(); bye != "expired" {
		t.Fatalf("the old owner's socket: bye %q", bye)
	}
	if strings.Contains(v.tape.all(), "newcomer") {
		t.Fatal("the old owner was sent the new owner's state")
	}
	if got := w.signIn("u-old"); got.CharacterID != "" {
		t.Fatalf("the old owner signs in to %q", got.CharacterID)
	}
	// A character that is gone ends its seat the same way.
	fresh := w.join("u-new", "i-1", api.Viewer{}, nil)
	if st := fresh.state(); st.Place.Name != "the newcomer's camp" {
		t.Fatalf("the new owner's state: %+v", st.Place)
	}
	h.set(func() { delete(h.states, "c-1") }, []string{"c-1"})
	if bye, _, _ := fresh.ended(); bye != "expired" {
		t.Fatalf("a socket whose character is gone: bye %q", bye)
	}
}

// TestSocketRules holds a socket to the protocol: a hello first and in
// time, known frames only, well-formed and allowed intents at a bounded
// rate, a bounded frame, a bounded number of sockets a user, and an
// answer to every ping.
func TestSocketRules(t *testing.T) {
	h := &fakeHost{players: map[string]string{"u-1": "c-1"}, states: map[string]api.ActivityState{"c-1": solo("c-1")}}
	w := faked(t, h, func(g *gateway.Gateway) { g.Waits(time.Second, 150*time.Millisecond) })
	session := w.signIn("u-1").Session
	hello := func(instance string) api.ClientMessage {
		return api.ClientMessage{T: "hello", Hello: &api.ClientHello{Session: session, Instance: instance}}
	}

	// What is not a hello, first.
	for name, frame := range map[string]string{
		"a ping before the hello":     `{"t":"ping"}`,
		"a hello with no instance":    `{"t":"hello","hello":{"session":"` + session + `"}}`,
		"an instance that is no id":   `{"t":"hello","hello":{"session":"` + session + `","instance":"a b"}}`,
		"a hello naming a character":  `{"t":"hello","hello":{"session":"` + session + `","instance":"i-1","characterId":"c-1"}}`,
		"what is not JSON":            `hello`,
		"two values in one frame":     `{"t":"hello","hello":{"session":"` + session + `","instance":"i-1"}} {}`,
		"a viewer naming no family":   `{"t":"hello","hello":{"session":"` + session + `","instance":"i-1","viewer":{"family":"a/b"}}}`,
		"a hello with nothing in it":  `{"t":"hello"}`,
		"an intent before the hello":  `{"t":"intent","intent":{"id":"12345678","kind":"press"}}`,
		"a frame of an unknown kind":  `{"t":"state"}`,
		"a hello with a stray field":  `{"t":"hello","admin":true,"hello":{"session":"` + session + `","instance":"i-1"}}`,
		"a hello whose session is {}": `{"t":"hello","hello":{"session":{},"instance":"i-1"}}`,
	} {
		v := w.dial("", nil)
		v.raw(frame)
		if bye, code, _ := v.ended(); bye != "bad-hello" || code != 4001 {
			t.Errorf("%s: bye %q, close %d", name, bye, code)
		}
	}
	silent := w.dial("", nil)
	if bye, _, _ := silent.ended(); bye != "bad-hello" {
		t.Fatalf("a socket that never says hello: bye %q", bye)
	}

	v := w.dial("", nil)
	v.send(hello("i-1"))
	v.state()
	refused := func(frame, code string) {
		t.Helper()
		v.seq++
		v.raw(fmt.Sprintf(frame, v.seq))
		if r := v.reply(); r.OK || r.Refusal == nil || r.Refusal.Code != code {
			t.Fatalf("%s was answered %+v, want %s", frame, r, code)
		}
	}
	refused(`{"t":"hello","seq":%d,"hello":{"session":"x","instance":"i-9"}}`, api.CodeBadJSON)
	refused(`{"t":"dance","seq":%d}`, api.CodeBadJSON)
	refused(`{"t":"look","seq":%d}`, api.CodeBadJSON)
	refused(`{"t":"intent","seq":%d}`, api.CodeBadJSON)
	refused(`{"t":"intent","seq":%d,"intent":{"id":"short","kind":"press"}}`, api.CodeBadJSON)
	refused(`{"t":"intent","seq":%d,"intent":{"id":"has/a/slash","kind":"press"}}`, api.CodeBadJSON)
	refused(`{"t":"intent","seq":%d,"intent":{"id":"`+strings.Repeat("x", 65)+`","kind":"press"}}`, api.CodeBadJSON)
	for _, kind := range []string{api.ActCreate, api.ActStep, "grant", "ban", "", "guild-found", api.OpRename, api.OpCaseClose} {
		refused(`{"t":"intent","seq":%d,"intent":{"id":"12345678","kind":"`+kind+`"}}`, api.CodeForbidden)
	}
	// A house kind is refused as a console's: an intent carries no role.
	for _, kind := range []string{api.ActStage, api.ActStageEnd, api.ActHousePin, api.ActHouseUnpin, api.ActModerate, api.ActHouseSettings} {
		if !api.HouseKind(kind) {
			t.Fatalf("%s is not a house kind", kind)
		}
		v.seq++
		v.raw(fmt.Sprintf(`{"t":"intent","seq":%d,"intent":{"id":"house-%s","kind":"%s"}}`, v.seq, kind, kind))
		if r := v.reply(); r.OK || r.Refusal == nil || r.Refusal.Code != api.CodeForbidden || !strings.Contains(r.Refusal.Message, "console") {
			t.Fatalf("a %s intent was answered %+v, want forbidden from the console", kind, r)
		}
	}
	if len(h.acts) != 0 {
		t.Fatalf("refused frames reached the world: %+v", h.acts)
	}
	// A look is answered with the state, even one that has not changed;
	// one more than a character's seats may send in a second is turned away.
	for range gateway.MaxLooks {
		v.seq++
		v.send(api.ClientMessage{T: "look", Seq: v.seq, Look: &api.Viewer{Family: "rewire", Level: 2}})
		v.state()
	}
	refused(`{"t":"look","seq":%d,"look":{"family":"rewire","level":2}}`, api.CodeBusy)
	// Another socket for the same character starts no fresh window.
	v2 := w.dial("", nil)
	v2.send(hello("i-2"))
	v2.state()
	v2.seq++
	v2.send(api.ClientMessage{T: "look", Seq: v2.seq, Look: &api.Viewer{Family: "rewire", Level: 2}})
	if r := v2.reply(); r.Refusal == nil || r.Refusal.Code != api.CodeBusy {
		t.Fatalf("a look from a fresh socket in the same second: %+v", r)
	}
	v2.drop()
	w.clock.Advance(time.Second)
	v.seq++
	v.send(api.ClientMessage{T: "look", Seq: v.seq, Look: &api.Viewer{Family: "rewire", Level: 2}})
	v.state()

	// Each allowed kind goes through as the seat's character, under a key
	// made from its id; the eleventh in a second is turned away.
	kinds := []string{api.ActPress, api.ActMachineArm, api.ActMachineSolve, api.ActBenchSolve, api.ActBenchLesson}
	for i := range 10 {
		id := fmt.Sprintf("intent-%04d", i)
		if r, _ := v.intent(api.Intent{ID: id, Version: 7, Kind: kinds[i%len(kinds)], Option: "wait"}); !r.OK || r.ID != id {
			t.Fatalf("intent %d: %+v", i, r)
		}
	}
	refused(`{"t":"intent","seq":%d,"intent":{"id":"intent-busy","kind":"press"}}`, api.CodeBusy)
	w.clock.Advance(time.Second)
	if r, _ := v.intent(api.Intent{ID: "intent-later", Kind: api.ActPress}); !r.OK {
		t.Fatalf("an intent a second later: %+v", r)
	}
	if len(h.acts) != 11 {
		t.Fatalf("%d writes reached the world, want 11", len(h.acts))
	}
	for i, req := range h.acts[:10] {
		want := api.ActionRequest{InteractionID: fmt.Sprintf("act-intent-%04d", i), CharacterID: "c-1", DiscordID: "u-1", Version: 7, Kind: kinds[i%len(kinds)], Option: "wait"}
		if req != want {
			t.Fatalf("write %d was %+v, want %+v", i, req, want)
		}
	}
	// A pattern's point is armed in chat, which names its value; the
	// Activity is shown the point and solves the machine that armed.
	refused(`{"t":"intent","seq":%d,"intent":{"id":"pattern-arm","kind":"machine-arm","machine":{"source":"pattern"}}}`, api.CodeForbidden)
	if len(h.acts) != 11 {
		t.Fatalf("a pattern arm from the Activity reached the world: %+v", h.acts[11:])
	}
	held := int64(2)
	point := &api.PatternPoint{Board: "triangle-of-pylons@0,0", Kind: "state", Place: "pylon", Family: "circuit", Point: 1, Points: 3, Values: 4,
		Held: &held}
	h.set(func() {
		st := solo("c-1")
		st.Machine = &api.MachineView{Source: api.MachinePattern, Family: "circuit", Armed: true, ArmedAt: 1}
		st.Pattern = point
		h.states["c-1"] = st
	}, []string{"c-1"})
	if st := v.state(); st.Pattern == nil || *st.Pattern.Held != held || st.Pattern.Point != point.Point || st.Machine.Source != api.MachinePattern {
		t.Fatalf("a pattern machine's state: %+v, %+v", st.Machine, st.Pattern)
	}
	w.clock.Advance(time.Second)
	solve := &api.MachineIntent{Log: &api.PuzzleLog{Moves: []api.PuzzleMove{{At: 10}}, End: 20}}
	if r, _ := v.intent(api.Intent{ID: "pattern-solve", Version: 7, Kind: api.ActMachineSolve, Machine: solve}); !r.OK {
		t.Fatalf("a pattern machine's solve: %+v", r)
	}
	if got := h.acts[len(h.acts)-1]; len(h.acts) != 12 || got.Kind != api.ActMachineSolve || got.Machine == nil || got.Machine.Log == nil ||
		len(got.Machine.Log.Moves) != 1 || got.CharacterID != "c-1" || got.Units != 0 {
		t.Fatalf("the pattern solve reached the world as %+v", got)
	}

	// A reading socket outlives many pings.
	time.Sleep(600 * time.Millisecond)
	v.quiet()

	// A frame past the cap closes the socket.
	v.raw(`{"t":"ping","seq":1,"hint":{"at":` + strings.Repeat("0", 70<<10) + `}}`)
	if _, code, _ := v.ended(); code != websocket.StatusMessageTooBig {
		t.Fatalf("a frame past the cap: close %d", code)
	}

	// A user's fifth socket replaces their oldest.
	var open []*viewer
	for i := range 5 {
		s := w.dial("", nil)
		s.send(hello(fmt.Sprintf("i-%d", i)))
		s.state()
		open = append(open, s)
	}
	if bye, _, _ := open[0].ended(); bye != "replaced" {
		t.Fatalf("a user's oldest socket of five: bye %q", bye)
	}
	for _, s := range open[1:] {
		s.quiet()
	}

	// A socket that stops answering pings is dropped.
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	deaf := dialSocket(t, ctx, w.srv.URL+api.PathActivitySocket)
	defer func() { _ = deaf.CloseNow() }()
	body := `{"t":"hello","hello":{"session":"` + w.signIn("u-1").Session + `","instance":"i-deaf"}}`
	if err := deaf.Write(ctx, websocket.MessageText, []byte(body)); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(wait); ; time.Sleep(5 * time.Millisecond) {
		seat, _ := w.gw.SeatOf("i-deaf", "c-1")
		if seat != nil && w.gw.Sockets() == 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("a socket that answers no ping is still open: %d sockets", w.gw.Sockets())
		}
	}
	if slices.ContainsFunc(open[2:], func(s *viewer) bool {
		select {
		case <-s.gone:
			return true
		default:
			return false
		}
	}) {
		t.Fatal("a socket that answers its pings was dropped")
	}
}

// TestUnseatedCap turns a socket away while as many as may wait have not
// said hello, and takes one again once they have gone.
func TestUnseatedCap(t *testing.T) {
	h := &fakeHost{players: map[string]string{}, states: map[string]api.ActivityState{}}
	w := faked(t, h, func(g *gateway.Gateway) { g.Waits(time.Minute, time.Minute) })
	waiting := make([]*viewer, gateway.MaxUnseated)
	for i := range waiting {
		waiting[i] = w.dial("", nil)
	}
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	ws, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(w.srv.URL, "http")+api.PathActivitySocket, nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err == nil || resp == nil || resp.StatusCode != http.StatusServiceUnavailable {
		if ws != nil {
			_ = ws.CloseNow()
		}
		t.Fatalf("a socket past the cap: %v, %+v", err, resp)
	}
	waiting[0].drop()
	w.dial("", nil)
}

// TestSocketOutlivesReadTimeout serves the gateway from a listener that
// bounds how long a request may take to arrive: an accepted socket is not
// a request any more, and is not cut.
func TestSocketOutlivesReadTimeout(t *testing.T) {
	h := &fakeHost{players: map[string]string{"u-1": "c-1"}, states: map[string]api.ActivityState{"c-1": solo("c-1")}}
	w := &world{t: t, clock: newClock()}
	w.gw = gateway.New(gateway.Config{Host: h, Dev: true, Clock: w.clock})
	if err := w.gw.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	w.srv = httptest.NewUnstartedServer(w.gw.Handler())
	w.srv.Config.ReadTimeout, w.srv.Config.IdleTimeout = 100*time.Millisecond, 100*time.Millisecond
	w.srv.Start()
	t.Cleanup(w.stop)
	v := w.join("u-1", "i-1", api.Viewer{}, nil)
	v.state()
	time.Sleep(500 * time.Millisecond)
	v.quiet()
}

// TestSeatCap forgets a user's oldest empty seat once they hold as many
// as they may, so instance ids made up one after another hold nothing.
func TestSeatCap(t *testing.T) {
	h := &fakeHost{players: map[string]string{"u-1": "c-1"}, states: map[string]api.ActivityState{"c-1": solo("c-1")}}
	w := faked(t, h, nil)
	for i := range gateway.MaxSeats + 1 {
		v := w.join("u-1", fmt.Sprintf("i-%d", i), api.Viewer{}, nil)
		v.state()
		v.drop()
	}
	if w.gw.SessionOf("i-0") != nil || w.gw.SessionOf("i-1") == nil || w.gw.SessionOf(fmt.Sprintf("i-%d", gateway.MaxSeats)) == nil {
		t.Fatal("the oldest empty seat was kept past the cap, or a newer one went")
	}
}
