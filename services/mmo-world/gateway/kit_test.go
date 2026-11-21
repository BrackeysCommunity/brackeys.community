package gateway_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/gateway"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
)

// structural: how long a test waits on a socket.
const wait = 10 * time.Second

// fakeClock is a clock a test moves. Timers run in the test's goroutine,
// in order, when the clock is advanced over them.
type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
}

type fakeTimer struct {
	at time.Time
	f  func()
}

func newClock() *fakeClock { return &fakeClock{now: time.UnixMilli(1_700_000_000_000)} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) AfterFunc(d time.Duration, f func()) func() {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{at: c.now.Add(max(d, 0)), f: f}
	c.timers = append(c.timers, t)
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		c.timers = slices.DeleteFunc(c.timers, func(o *fakeTimer) bool { return o == t })
	}
}

// Advance moves the clock on and runs every timer that falls due.
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	target := c.now.Add(d)
	for {
		var next *fakeTimer
		for _, t := range c.timers {
			if !t.at.After(target) && (next == nil || t.at.Before(next.at)) {
				next = t
			}
		}
		if next == nil {
			break
		}
		c.timers = slices.DeleteFunc(c.timers, func(o *fakeTimer) bool { return o == next })
		if next.at.After(c.now) {
			c.now = next.at
		}
		c.mu.Unlock()
		next.f()
		c.mu.Lock()
	}
	c.now = target
	c.mu.Unlock()
}

// world is a Local game served to a gateway. The game is one goroutine's
// at a time, as the service's is, and every write the gateway makes is
// kept.
type world struct {
	t       *testing.T
	mu      sync.Mutex
	l       *service.Local
	g       *game.Game
	host    service.LocalHost
	clock   *fakeClock
	needles []string
	acts    []api.ActionRequest
	views   map[string]int // states built, by character

	gw   *gateway.Gateway
	srv  *httptest.Server
	logs *bytes.Buffer
}

var _ gateway.Host = (*world)(nil)
var _ gateway.Host = service.LocalHost{}
var _ gateway.Host = (*service.Server)(nil)

func newWorld(t *testing.T) *world {
	t.Helper()
	sec, _ := testkit.Secrets(t, "mmo/gateway-master", "w-gateway")
	g, err := game.New(testkit.Rules(t, testkit.Book(t), sec.Keys))
	if err != nil {
		t.Fatal(err)
	}
	w := &world{t: t, l: service.NewLocal(g), g: g, clock: newClock(), needles: sec.Needles, views: map[string]int{}}
	w.l.Now = w.clock.Now
	w.host = w.l.Host()
	return w
}

func (w *world) CharacterOf(ctx context.Context, discord string) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.host.CharacterOf(ctx, discord)
}

func (w *world) View(ctx context.Context, id string, v api.Viewer) (api.ActivityState, bool, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.views[id]++
	return w.host.View(ctx, id, v)
}

// viewed is how many times a character's state has been built.
func (w *world) viewed(id string) int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.views[id]
}

func (w *world) Act(ctx context.Context, req api.ActionRequest, check bool) (api.ActionReply, *api.Refusal, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.acts = append(w.acts, req)
	return w.host.Act(ctx, req, check)
}

func (w *world) Armed(ctx context.Context) ([]api.ArmedMachine, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.host.Armed(ctx)
}

func (w *world) Subscribe(f func([]string)) { w.host.Subscribe(f) }

// do sets a scene in the game, with the game held.
func (w *world) do(f func()) {
	w.mu.Lock()
	defer w.mu.Unlock()
	f()
}

// tick runs the world's next tick.
func (w *world) tick() {
	w.t.Helper()
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.l.Advance(); err != nil {
		w.t.Fatal(err)
	}
}

// written are the writes the gateway has made so far.
func (w *world) written() []api.ActionRequest {
	w.mu.Lock()
	defer w.mu.Unlock()
	return slices.Clone(w.acts)
}

// expiries are the writes that ended a countdown nobody solved.
func (w *world) expiries() []api.ActionRequest {
	var out []api.ActionRequest
	for _, a := range w.written() {
		if strings.HasPrefix(a.InteractionID, "mx-") {
			out = append(out, a)
		}
	}
	return out
}

func (w *world) digest() string {
	w.t.Helper()
	w.mu.Lock()
	defer w.mu.Unlock()
	d, err := w.g.Digest()
	if err != nil {
		w.t.Fatal(err)
	}
	return fmt.Sprint(d)
}

// create makes the character a Discord user plays.
func (w *world) create(discord string) *game.Char {
	w.t.Helper()
	w.mu.Lock()
	defer w.mu.Unlock()
	rep, ref, err := w.host.Act(context.Background(), api.ActionRequest{InteractionID: "new-" + discord, DiscordID: discord,
		Kind: api.ActCreate, Option: api.StartKnife}, true)
	if err != nil || ref != nil {
		w.t.Fatal(ref, err)
	}
	return w.g.Char(rep.Character.ID)
}

// act is a write made past the gateway, as the bot's are.
func (w *world) act(c *game.Char, key string, req api.ActionRequest) api.ActionReply {
	w.t.Helper()
	w.mu.Lock()
	defer w.mu.Unlock()
	req.InteractionID, req.CharacterID, req.Version = key, c.C.ID, c.Version
	rep, ref, err := w.host.Act(context.Background(), req, true)
	if err != nil || ref != nil {
		w.t.Fatal(ref, err)
	}
	return rep
}

// serve starts a gateway over the world, with dev sign-in on.
func (w *world) serve(change func(*gateway.Config)) *gateway.Gateway {
	w.t.Helper()
	w.logs = &bytes.Buffer{}
	cfg := gateway.Config{Host: w, Dev: true, Clock: w.clock, Log: slog.New(slog.NewTextHandler(&lockedWriter{w: w.logs}, nil))}
	if change != nil {
		change(&cfg)
	}
	w.gw = gateway.New(cfg)
	if err := w.gw.Start(context.Background()); err != nil {
		w.t.Fatal(err)
	}
	w.srv = httptest.NewServer(w.gw.Handler())
	w.t.Cleanup(w.stop)
	return w.gw
}

func (w *world) stop() {
	w.gw.Close()
	w.srv.Close()
}

type lockedWriter struct {
	mu sync.Mutex
	w  *bytes.Buffer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

func (l *lockedWriter) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.String()
}

// post sends a JSON body and reads a JSON answer.
func post(t *testing.T, url string, body any, into any) int {
	t.Helper()
	raw, ok := body.(string)
	if !ok {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		raw = string(b)
	}
	resp, err := http.Post(url, "application/json", strings.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	if into != nil && resp.StatusCode == http.StatusOK {
		if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
			t.Fatal(err)
		}
	}
	return resp.StatusCode
}

// signIn is the dev sign-in of a Discord user.
func (w *world) signIn(discord string) api.TokenReply {
	w.t.Helper()
	var out api.TokenReply
	if status := post(w.t, w.srv.URL+api.PathActivityToken, api.TokenRequest{Dev: discord}, &out); status != http.StatusOK {
		w.t.Fatalf("signing %s in: %d", discord, status)
	}
	return out
}

// tape is every byte one user was ever sent, over all their sockets.
type tape struct {
	mu     sync.Mutex
	frames [][]byte
}

func (tp *tape) add(b []byte) {
	tp.mu.Lock()
	defer tp.mu.Unlock()
	tp.frames = append(tp.frames, b)
}

func (tp *tape) all() string {
	tp.mu.Lock()
	defer tp.mu.Unlock()
	return string(bytes.Join(tp.frames, []byte("\n")))
}

func (tp *tape) count() int {
	tp.mu.Lock()
	defer tp.mu.Unlock()
	return len(tp.frames)
}

// viewer is one open socket and what it has received.
type viewer struct {
	t    *testing.T
	w    *world
	ws   *websocket.Conn
	in   chan api.ServerMessage
	gone chan struct{}
	err  error
	tape *tape
	seq  int64
}

// dial opens a socket to the gateway, with or without Discord's prefix,
// and reads it until it ends.
func (w *world) dial(prefix string, tp *tape) *viewer {
	w.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	ws := dialSocket(w.t, ctx, w.srv.URL+prefix+api.PathActivitySocket)
	ws.SetReadLimit(1 << 22)
	if tp == nil {
		tp = &tape{}
	}
	v := &viewer{t: w.t, w: w, ws: ws, in: make(chan api.ServerMessage, 1024), gone: make(chan struct{}), tape: tp}
	go func() {
		defer close(v.gone)
		for {
			_, data, err := ws.Read(context.Background())
			if err != nil {
				v.err = err
				return
			}
			tp.add(data)
			var msg api.ServerMessage
			if err := json.Unmarshal(data, &msg); err != nil {
				v.err = err
				return
			}
			v.in <- msg
		}
	}()
	w.t.Cleanup(func() { _ = ws.CloseNow() })
	return v
}

// dialSocket opens a WebSocket to an http URL.
func dialSocket(t *testing.T, ctx context.Context, url string) *websocket.Conn {
	t.Helper()
	ws, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(url, "http"), nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		t.Fatal(err)
	}
	return ws
}

// join signs a user in, opens their socket in an instance and says hello.
func (w *world) join(discord, instance string, look api.Viewer, tp *tape) *viewer {
	w.t.Helper()
	v := w.dial("", tp)
	v.send(api.ClientMessage{T: "hello", Hello: &api.ClientHello{Session: w.signIn(discord).Session, Instance: instance, Viewer: look}})
	return v
}

func (v *viewer) send(msg api.ClientMessage) {
	v.t.Helper()
	body, err := json.Marshal(msg)
	if err != nil {
		v.t.Fatal(err)
	}
	v.raw(string(body))
}

func (v *viewer) raw(frame string) {
	v.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	if err := v.ws.Write(ctx, websocket.MessageText, []byte(frame)); err != nil {
		v.t.Fatal(err)
	}
}

// next is the next frame the socket receives.
func (v *viewer) next() api.ServerMessage {
	v.t.Helper()
	select {
	case msg := <-v.in:
		return msg
	case <-v.gone:
		select {
		case msg := <-v.in:
			return msg
		default:
		}
		v.t.Fatalf("the socket ended: %v", v.err)
	case <-time.After(wait):
		v.t.Fatal("no frame arrived")
	}
	return api.ServerMessage{}
}

// state is the next frame, which must be a state.
func (v *viewer) state() api.ActivityState {
	v.t.Helper()
	msg := v.next()
	if msg.T != "state" || msg.State == nil {
		v.t.Fatalf("want a state, got %+v", msg)
	}
	return *msg.State
}

// reply is the next frame, which must answer the frame just sent.
func (v *viewer) reply() api.IntentReply {
	v.t.Helper()
	msg := v.next()
	if msg.T != "reply" || msg.Reply == nil || msg.Seq != v.seq {
		v.t.Fatalf("want the reply to frame %d, got %+v", v.seq, msg)
	}
	return *msg.Reply
}

// intent sends a write and reads its reply and the state that follows.
func (v *viewer) intent(in api.Intent) (api.IntentReply, api.ActivityState) {
	v.t.Helper()
	v.seq++
	v.send(api.ClientMessage{T: "intent", Seq: v.seq, Intent: &in})
	return v.reply(), v.state()
}

// quiet waits until the gateway has acted on every notice and the socket
// has caught up, and fails if anything arrived meanwhile.
func (v *viewer) quiet() {
	v.t.Helper()
	v.w.gw.Settle()
	v.seq++
	v.send(api.ClientMessage{T: "ping", Seq: v.seq})
	if msg := v.next(); msg.T != "pong" || msg.Seq != v.seq {
		v.t.Fatalf("a frame nobody asked for: %+v", msg)
	}
}

// drop hangs up without a word, and waits for the gateway to notice.
func (v *viewer) drop() {
	v.t.Helper()
	before := v.w.gw.Sockets()
	_ = v.ws.CloseNow()
	<-v.gone
	for deadline := time.Now().Add(wait); v.w.gw.Sockets() >= before; time.Sleep(time.Millisecond) {
		if time.Now().After(deadline) {
			v.t.Fatal("the gateway kept a dropped socket")
		}
	}
}

// ended waits for the socket to end and gives the bye it was sent and
// the close frame's code and reason.
func (v *viewer) ended() (bye string, code websocket.StatusCode, reason string) {
	v.t.Helper()
	select {
	case <-v.gone:
	case <-time.After(wait):
		v.t.Fatal("the socket stayed open")
	}
	for {
		select {
		case msg := <-v.in:
			if msg.T == "bye" {
				bye = msg.Bye
			}
			continue
		default:
		}
		break
	}
	var ce websocket.CloseError
	if errors.As(v.err, &ce) {
		code, reason = ce.Code, ce.Reason
	}
	return bye, code, reason
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

// practise sets a character's practice in a family.
func practise(c *game.Char, family string, level int64) {
	c.C.Practice = slices.DeleteFunc(c.C.Practice, func(s char.Skill) bool { return s.ID == family })
	c.C.Practice = append(c.C.Practice, char.Skill{ID: family, Level: level})
	slices.SortFunc(c.C.Practice, func(a, b char.Skill) int { return strings.Compare(a.ID, b.ID) })
}

// rewired is the log that plugs every wire of a Rewire into its port.
func rewired(l api.PuzzleLayout) *api.PuzzleLog {
	log := &api.PuzzleLog{}
	for wire, port := range l.Target {
		log.Moves = append(log.Moves, api.PuzzleMove{At: int64(wire+1) * 200, A: int64(wire), B: port})
	}
	return log
}
