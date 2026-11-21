package harness

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/internal/envvar"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
)

// EnvActivityURL is where the run finds the Activity listener.
const EnvActivityURL = "MMO_ACTIVITY_URL"

const (
	// activityLevel is the level of the machine each family is played at.
	activityLevel = 3
	// activityWait is how long the run waits for one frame it expects.
	activityWait = 20 * time.Second
	// intentGap and lookGap keep a character under the gateway's per-second
	// caps on intents and looks.
	intentGap = 120 * time.Millisecond
	lookGap   = 220 * time.Millisecond
	// benchExtra is how many bench solves are made past the day's cap.
	benchExtra = 3
)

var assetRef = regexp.MustCompile(`(?:src|href)="\./(assets/[^"]+)"`)

// liveWorld is a running world: its API, its operator's paths and its
// Activity listener.
type liveWorld struct {
	api, op  *client.HTTP
	activity string
	kit      *puzzle.Puzzles
	run      string
}

// seat is one signed-in character's socket.
type seat struct {
	w       *liveWorld
	discord string
	char    string
	ws      *websocket.Conn
	in      chan api.ServerMessage
	seq     int64
	state   api.ActivityState
	trip    time.Duration
}

func (w *liveWorld) post(ctx context.Context, path string, in, out any) (int, error) {
	body, err := json.Marshal(in)
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.activity+path, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return resp.StatusCode, nil
	}
	return resp.StatusCode, json.NewDecoder(resp.Body).Decode(out)
}

// create makes a character for a new Discord user of this run.
func (w *liveWorld) create(ctx context.Context, who string) (discord, char string, err error) {
	discord = "proof-" + w.run + "-" + who
	rep, ref, err := w.api.Act(ctx, api.ActionRequest{InteractionID: "new-" + w.run + "-" + who, DiscordID: discord, Kind: api.ActCreate, Option: api.StartKnife})
	if err := client.Refused("create", ref, err); err != nil {
		return "", "", err
	}
	return discord, rep.Character.ID, nil
}

// machine stands a character before a machine, as the operator.
func (w *liveWorld) machine(ctx context.Context, char, family string, level int64, n int) error {
	_, ref, err := w.op.Operate(ctx, api.OperatorRequest{InteractionID: fmt.Sprintf("set-%s-%s-%d", w.run, char, n), CharacterID: char,
		Kind: api.OpMachine, Asset: family, Units: level, Note: "the Activity proof run"})
	return client.Refused("set-machine", ref, err)
}

// join signs a Discord user in by the dev sign-in and opens their socket.
func (w *liveWorld) join(ctx context.Context, discord string, look api.Viewer) (*seat, error) {
	var tok api.TokenReply
	if status, err := w.post(ctx, api.PathActivityToken, api.TokenRequest{Dev: discord}, &tok); err != nil {
		return nil, err
	} else if status != http.StatusOK {
		return nil, fmt.Errorf("dev sign-in for %s: status %d (is MMO_ACTIVITY_DEV=1 on a disposable world?)", discord, status)
	}
	if tok.CharacterID == "" || tok.Session == "" {
		return nil, fmt.Errorf("sign-in for %s gave no character or no session", discord)
	}
	ws, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(w.activity, "http")+api.PathActivitySocket, nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		return nil, err
	}
	ws.SetReadLimit(1 << 22)
	s := &seat{w: w, discord: discord, char: tok.CharacterID, ws: ws, in: make(chan api.ServerMessage, 256)}
	go func() {
		defer close(s.in)
		for {
			_, data, err := ws.Read(context.Background())
			if err != nil {
				return
			}
			var msg api.ServerMessage
			if json.Unmarshal(data, &msg) != nil {
				return
			}
			s.in <- msg
		}
	}()
	if err := s.send(ctx, api.ClientMessage{T: api.FrameHello, Hello: &api.ClientHello{Session: tok.Session, Instance: "proof-" + w.run, Viewer: look}}); err != nil {
		return nil, err
	}
	if _, err := s.frame("the first state", api.FrameState, activityWait); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *seat) close() { _ = s.ws.Close(websocket.StatusNormalClosure, "") }

func (s *seat) send(ctx context.Context, msg api.ClientMessage) error {
	body, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return s.ws.Write(ctx, websocket.MessageText, body)
}

// frame is the next frame of one kind; states met on the way are kept.
func (s *seat) frame(what, t string, wait time.Duration) (api.ServerMessage, error) {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	for {
		select {
		case msg, ok := <-s.in:
			if !ok {
				return msg, fmt.Errorf("%s: the socket closed waiting for %s", s.char, what)
			}
			if msg.T == api.FrameState && msg.State != nil {
				s.state = *msg.State
			}
			if msg.T == api.FrameBye {
				return msg, fmt.Errorf("%s: told %q waiting for %s", s.char, msg.Bye, what)
			}
			if msg.T == t {
				return msg, nil
			}
		case <-timer.C:
			return api.ServerMessage{}, fmt.Errorf("%s: no %s within %s", s.char, what, wait)
		}
	}
}

// until is the newest state once it satisfies ok, reading more as needed.
func (s *seat) until(what string, ok func(api.ActivityState) bool) (api.ActivityState, error) {
	return s.untilWithin(what, activityWait, ok)
}

func (s *seat) untilWithin(what string, wait time.Duration, ok func(api.ActivityState) bool) (api.ActivityState, error) {
	deadline := time.Now().Add(wait)
	for !ok(s.state) {
		if _, err := s.frame(what, api.FrameState, time.Until(deadline)); err != nil {
			return s.state, err
		}
	}
	return s.state, nil
}

// look says what the seat has on screen and returns the state that answers.
func (s *seat) look(ctx context.Context, v api.Viewer) (api.ActivityState, error) {
	time.Sleep(lookGap)
	if err := s.send(ctx, api.ClientMessage{T: api.FrameLook, Look: &v}); err != nil {
		return s.state, err
	}
	_, err := s.frame("the state after a look", api.FrameState, activityWait)
	return s.state, err
}

// intent sends one write and returns its reply; trip is how long the
// reply took.
func (s *seat) intent(ctx context.Context, id, kind string, m *api.MachineIntent) (api.IntentReply, error) {
	time.Sleep(intentGap)
	sent := time.Now()
	defer func() { s.trip = time.Since(sent) }()
	s.seq++
	in := api.Intent{ID: id, Version: s.state.Character.Version, Kind: kind, Machine: m}
	if err := s.send(ctx, api.ClientMessage{T: api.FrameIntent, Seq: s.seq, Intent: &in}); err != nil {
		return api.IntentReply{}, err
	}
	msg, err := s.frame("the reply to "+kind, api.FrameReply, activityWait)
	if err != nil {
		return api.IntentReply{}, err
	}
	if msg.Reply == nil || msg.Seq != s.seq {
		return api.IntentReply{}, fmt.Errorf("%s: a reply out of turn to %s", s.char, kind)
	}
	return *msg.Reply, nil
}

// taken is nil for an intent the world accepted.
func taken(what string, rep api.IntentReply, err error) error {
	switch {
	case err != nil:
		return fmt.Errorf("%s: %w", what, err)
	case !rep.OK && rep.Refusal != nil:
		return fmt.Errorf("%s was refused: %s: %s", what, rep.Refusal.Code, rep.Refusal.Message)
	case !rep.OK:
		return fmt.Errorf("%s was not taken", what)
	}
	return nil
}

func factKinds(facts []api.Fact) string {
	kinds := make([]string, len(facts))
	for i, f := range facts {
		kinds[i] = f.Kind
	}
	return strings.Join(kinds, ", ")
}

func factIn(facts []api.Fact, kind string) bool {
	return slices.ContainsFunc(facts, func(f api.Fact) bool { return f.Kind == kind })
}

// held is what a machine can change of a character: a second effect of a
// log would show here.
func held(st api.ActivityState) []any {
	c := st.Character
	return []any{c.Coin, c.Goods, c.Practice, c.Titles, c.Pouches, c.Armed, c.InFight, st.Last}
}

// arm arms the beat's machine the seat faces and waits for the state that
// says so; ahead is how many ms the server's clock runs ahead of this one.
func (s *seat) arm(ctx context.Context, id, what string) (armed api.ActivityState, ahead int64, err error) {
	rep, err := s.intent(ctx, id, api.ActMachineArm, &api.MachineIntent{Source: api.MachineBeat})
	if err = taken(what, rep, err); err != nil {
		return armed, 0, err
	}
	armed, err = s.until("the armed state", func(st api.ActivityState) bool { return st.Machine != nil && st.Machine.Armed })
	if err != nil {
		return armed, 0, err
	}
	return armed, armed.Now - time.Now().UnixMilli(), nil
}

// worked is one machine armed and solved through the socket.
type worked struct {
	family            string
	intro             bool
	level, wires      int64
	countdown, solved int64 // ms
	clean             bool
	moves             int
	facts             string
	armTrip, trip     time.Duration
}

// solve arms the machine the seat faces, plays the kit's solve at the pace
// its stamps say, sends it, then sends the same log twice more: under the
// same id (the stored reply, marked a duplicate) and under a new one
// (refused, with nothing armed). The character must not change after the
// first.
func (s *seat) solve(ctx context.Context, n int) (worked, error) {
	m := s.state.Machine
	if m == nil || m.Armed {
		return worked{}, fmt.Errorf("%s: no machine at rest to work", s.char)
	}
	out := worked{family: m.Family, intro: m.Intro, wires: m.Layout.Size}
	if !m.Preview && (m.Level != 0 || m.Countdown != 0 || m.Haywire != nil || len(m.Why) != 0) {
		return out, fmt.Errorf("%s at rest shows its level, countdown or haywire with no preview", m.Family)
	}
	log := s.w.kit.Solve(service.LayoutOf(m.Layout))
	id := fmt.Sprintf("%s-%s-%d", s.w.run, s.char, n)
	armed, ahead, err := s.arm(ctx, id+"-arm", "arming the "+m.Family)
	if err != nil {
		return out, err
	}
	out.armTrip = s.trip
	out.level, out.countdown = armed.Machine.Level, armed.Machine.Countdown
	if armed.Machine.Deadline != armed.Machine.ArmedAt+armed.Machine.Countdown || out.level == 0 {
		return out, fmt.Errorf("the armed %s carries no level or a deadline that is not its countdown", m.Family)
	}
	out.moves = len(log.Moves)
	// The log is played at its own pace: the server takes no stamp from
	// the future.
	time.Sleep(time.Until(time.UnixMilli(armed.Machine.ArmedAt + log.Stop() - ahead).Add(50 * time.Millisecond)))
	body := &api.MachineIntent{Log: service.LogOf(log)}
	first, err := s.intent(ctx, id+"-solve", api.ActMachineSolve, body)
	if err := taken("solving the "+m.Family, first, err); err != nil {
		return out, err
	}
	out.trip = s.trip
	out.facts = factKinds(first.Facts)
	if first.Machine == nil || !first.Machine.Solved || !factIn(first.Facts, "puzzle.solved") {
		return out, fmt.Errorf("the kit's solve of the %s was not a solve: %+v (%s)", m.Family, first.Machine, out.facts)
	}
	out.solved, out.clean = first.Machine.At, first.Machine.Clean
	after, err := s.until("the state after a solve", func(st api.ActivityState) bool { return !st.Character.Armed && st.Last != nil })
	if err != nil {
		return out, err
	}
	if !after.Last.Result.Solved || after.Last.Family != m.Family {
		return out, fmt.Errorf("the state after the %s does not show it solved: %+v", m.Family, after.Last)
	}
	again, err := s.intent(ctx, id+"-solve", api.ActMachineSolve, body)
	if err != nil {
		return out, err
	}
	if !again.OK || !again.Duplicate || !reflect.DeepEqual(again.Machine, first.Machine) || !reflect.DeepEqual(again.Facts, first.Facts) {
		return out, fmt.Errorf("the %s log sent again under its id was not the stored reply: %+v", m.Family, again)
	}
	other, err := s.intent(ctx, id+"-solve-2", api.ActMachineSolve, body)
	if err != nil {
		return out, err
	}
	if other.OK || other.Refusal == nil || other.Refusal.Code != api.CodeNoMachine {
		return out, fmt.Errorf("the %s log sent again under a new id was not refused %s: %+v", m.Family, api.CodeNoMachine, other)
	}
	now, err := s.look(ctx, api.Viewer{})
	if err != nil {
		return out, err
	}
	if !reflect.DeepEqual(held(now), held(after)) || now.Tick == after.Tick && now.Character.Version != after.Character.Version {
		return out, fmt.Errorf("the %s log sent again changed the character: version %d to %d", m.Family, after.Character.Version, now.Character.Version)
	}
	return out, nil
}

// family plays one family: the opening Rewire every new character meets
// first, then the family's own machine.
func (w *liveWorld) family(ctx context.Context, family string) ([]worked, error) {
	discord, char, err := w.create(ctx, family)
	if err != nil {
		return nil, err
	}
	var out []worked
	var s *seat
	for n := range 2 {
		// A new character's first puzzle is the opening machine, whatever
		// the beat holds; a lock would not be.
		want := family
		if n == 0 {
			want, _ = w.kit.IntroMachine()
		}
		if err := w.machine(ctx, char, want, activityLevel, n); err != nil {
			return out, err
		}
		if s == nil {
			if s, err = w.join(ctx, discord, api.Viewer{}); err != nil {
				return out, err
			}
			defer s.close()
		}
		if _, err := s.until("the "+want+" at rest", func(st api.ActivityState) bool {
			return st.Machine != nil && st.Machine.Source == api.MachineBeat && st.Machine.Family == want && !st.Machine.Armed && st.Machine.Intro == (n == 0)
		}); err != nil {
			return out, err
		}
		got, err := s.solve(ctx, n)
		if err != nil {
			return out, fmt.Errorf("%s: %w", family, err)
		}
		out = append(out, got)
	}
	return out, nil
}

// expiry is an armed machine left alone.
type expiry struct {
	open      bool
	countdown int64 // ms
	haywire   string
	late      time.Duration // from the deadline to the state that showed the haywire
}

// ranOut arms the opening Rewire and leaves it. With the page open the
// haywire is pushed; with it closed it is there when the page comes back.
func (w *liveWorld) ranOut(ctx context.Context, open bool) (expiry, error) {
	who := "closed"
	if open {
		who = "open"
	}
	discord, char, err := w.create(ctx, who)
	if err != nil {
		return expiry{}, err
	}
	intro, level := w.kit.IntroMachine()
	if err := w.machine(ctx, char, intro, level, 0); err != nil {
		return expiry{}, err
	}
	s, err := w.join(ctx, discord, api.Viewer{})
	if err != nil {
		return expiry{}, err
	}
	defer func() { s.close() }()
	armed, ahead, err := s.arm(ctx, w.run+"-"+char+"-arm", "arming a machine to leave")
	if err != nil {
		return expiry{}, err
	}
	out := expiry{open: open, countdown: armed.Machine.Countdown}
	deadline := time.UnixMilli(armed.Machine.Deadline - ahead)
	gone := func(st api.ActivityState) bool { return !st.Character.Armed && st.Last != nil }
	var st api.ActivityState
	if open {
		if st, err = s.untilWithin("the haywire of a machine left alone", time.Until(deadline)+activityWait, gone); err != nil {
			return out, err
		}
		out.late = time.Since(deadline)
	} else {
		s.close()
		time.Sleep(time.Until(deadline.Add(time.Duration(armed.Machine.Grace)*time.Millisecond + 2*time.Second)))
		if s, err = w.join(ctx, discord, api.Viewer{}); err != nil {
			return out, err
		}
		out.late = time.Since(deadline)
		if st = s.state; !gone(st) {
			return out, fmt.Errorf("a machine left with the page closed is still armed %s after its deadline", out.late)
		}
	}
	if r := st.Last.Result; r.Solved || !r.Late || r.Haywire == "" {
		return out, fmt.Errorf("a machine left alone ended as %+v", r)
	}
	out.haywire = st.Last.Result.Haywire
	return out, nil
}

// benchDay is a day's work at the bench.
type benchDay struct {
	solves, uses, cap int64
	before, atCap     api.PracticeLine
	after             api.PracticeLine
	half              string
}

// bench solves Rewire rigs at the bench a new character stands at until
// the day's cap and past it: each solve is a use up to the cap and none
// after, and a log that stops a move short is no solve.
func (w *liveWorld) bench(ctx context.Context) (benchDay, error) {
	discord, _, err := w.create(ctx, "bench")
	if err != nil {
		return benchDay{}, err
	}
	intro, level := w.kit.IntroMachine()
	rig := api.Viewer{Family: intro, Level: level}
	s, err := w.join(ctx, discord, rig)
	if err != nil {
		return benchDay{}, err
	}
	defer s.close()
	st := s.state
	if st.Bench == nil || st.Machine == nil || st.Machine.Source != api.MachineBench || st.Machine.Countdown != 0 {
		return benchDay{}, errors.New("a new character does not stand at an open bench with a rig and no countdown")
	}
	out := benchDay{cap: st.Bench.UsesCap, before: st.Machine.Practice}
	total := func(p api.PracticeLine) int64 { return p.Level*1_000_000 + p.Uses }
	for i := int64(1); i <= out.cap+benchExtra; i++ {
		log := w.kit.Solve(service.LayoutOf(st.Machine.Layout))
		if i == 2 {
			log = puzzle.Log{Moves: log.Moves[:len(log.Moves)-1]}
		}
		before := st.Machine.Practice
		rep, err := s.intent(ctx, fmt.Sprintf("%s-bench-%d", w.run, i), api.ActBenchSolve,
			&api.MachineIntent{Source: api.MachineBench, Family: rig.Family, Level: rig.Level, Log: service.LogOf(log)})
		if err := taken("a bench solve", rep, err); err != nil {
			return out, err
		}
		if rep.Machine == nil {
			return out, fmt.Errorf("bench solve %d carried no result", i)
		}
		if st, err = s.look(ctx, rig); err != nil {
			return out, err
		}
		if st.Bench == nil || st.Machine == nil {
			return out, fmt.Errorf("the bench is gone after solve %d", i)
		}
		gained := total(st.Machine.Practice) != total(before)
		switch {
		case i == 2:
			out.half = "not solved, no use, a new rig"
			if rep.Machine.Solved || rep.Machine.Haywire != "" || gained {
				return out, fmt.Errorf("half a log at the bench: %+v", *rep.Machine)
			}
			continue
		case !rep.Machine.Solved || !factIn(rep.Facts, "bench.solved"):
			return out, fmt.Errorf("bench solve %d was not a solve: %+v (%s)", i, *rep.Machine, factKinds(rep.Facts))
		}
		out.solves++
		if under := out.solves <= out.cap; gained != under {
			return out, fmt.Errorf("bench solve %d: practice moved %v, with %d of %d uses today", out.solves, gained, st.Bench.Uses, out.cap)
		}
		if st.Bench.Uses != min(out.solves, out.cap) {
			return out, fmt.Errorf("after %d bench solves the bench counts %d uses", out.solves, st.Bench.Uses)
		}
		if out.solves == out.cap {
			out.atCap = st.Machine.Practice
		}
	}
	out.uses, out.after = st.Bench.Uses, st.Machine.Practice
	return out, nil
}

// served checks the listener serves the Activity's build: the page with
// the client id written in, one of its assets, and both again behind
// Discord's proxy prefix.
func (w *liveWorld) served(ctx context.Context) (string, error) {
	get := func(path string) (string, http.Header, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, w.activity+path, nil)
		if err != nil {
			return "", nil, err
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return "", nil, err
		}
		defer func() { _ = resp.Body.Close() }()
		body, err := io.ReadAll(resp.Body)
		if err == nil && resp.StatusCode != http.StatusOK {
			err = fmt.Errorf("GET %s: %s", path, resp.Status)
		}
		return string(body), resp.Header, err
	}
	page, _, err := get("/")
	if err != nil {
		return "", err
	}
	if strings.Contains(page, api.ActivityClientIDMark) || !strings.Contains(page, "discord-client-id") {
		return "", errors.New("the page is not the build with the client id written in")
	}
	ref := assetRef.FindStringSubmatch(page)
	if ref == nil {
		return "", errors.New("the page names no asset: is MMO_ACTIVITY_DIR the production build?")
	}
	for _, prefix := range []string{"", api.ActivityProxyPrefix} {
		_, h, err := get(prefix + "/" + ref[1])
		if err != nil {
			return "", err
		}
		if !strings.Contains(h.Get("Cache-Control"), "immutable") {
			return "", fmt.Errorf("%s/%s is not served to be kept", prefix, ref[1])
		}
	}
	if _, _, err := get("/.proxy/"); err != nil {
		return "", err
	}
	return ref[1], nil
}

// ActivityRun plays every family through a live world's Activity listener
// the way the page does, with no Discord, and writes activity.md. The
// world must be disposable, with dev sign-in on and the operator's paths
// open (GDD 7.11, 17.7).
func ActivityRun(b *sheets.Book, out string, _ int) ([]Measured, error) {
	activity := strings.TrimRight(os.Getenv(EnvActivityURL), "/")
	if activity == "" {
		return nil, errors.New(EnvActivityURL + " must name the world's Activity listener, such as http://localhost:18787")
	}
	base := envvar.Get(service.EnvURL, "http://localhost:8080")
	w := &liveWorld{api: client.New(base, os.Getenv(service.EnvAPIToken)), op: client.New(base, os.Getenv(service.EnvOperatorToken)),
		activity: activity, kit: puzzleKit(b), run: strconv.FormatInt(time.Now().UnixMilli(), 36)}
	ctx := context.Background()
	asset, err := w.served(ctx)
	if err != nil {
		return nil, err
	}

	families := w.kit.All()
	results := make([][]worked, len(families))
	var open, closed expiry
	var day benchDay
	// The jobs wait on a live world's countdowns, not on this machine, so
	// they all run at once: many sockets open together is part of the proof.
	jobs := []func() error{
		func() (err error) { open, err = w.ranOut(ctx, true); return },
		func() (err error) { closed, err = w.ranOut(ctx, false); return },
		func() (err error) { day, err = w.bench(ctx); return },
	}
	for i, f := range families {
		jobs = append(jobs, func() (err error) { results[i], err = w.family(ctx, f); return })
	}
	errs := make([]error, len(jobs))
	var wg sync.WaitGroup
	started := time.Now()
	for i, job := range jobs {
		wg.Go(func() { errs[i] = job() })
	}
	wg.Wait()
	if err := errors.Join(errs...); err != nil {
		return nil, err
	}

	var doc lineDoc
	pr := doc.p
	pr("# The Activity, end to end on a live world")
	pr("")
	pr("World at %s, Activity listener at %s, signed in by the dev sign-in, one socket a character. The build is served (`%s`, with and without `/.proxy`). The run took %s.",
		base, activity, asset, time.Since(started).Round(time.Second))
	pr("")
	pr("## Every family: studied, armed, solved with the kit's own log, then sent again")
	pr("")
	pr("Each character first meets the opening Rewire, then its family's machine at level %d. \"Again\" is the same log under the same intent id (the stored reply, marked a duplicate, the same facts) and under a new id (refused `%s`); the character's row is the same before and after both.",
		activityLevel, api.CodeNoMachine)
	pr("")
	pr("| Family | Level | Size | Countdown | Moves | Solved at | Clean | Facts | Arm round trip | Solve round trip | Again |")
	pr("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
	var arm, trip []time.Duration
	for i, f := range families {
		for _, r := range results[i] {
			arm, trip = append(arm, r.armTrip), append(trip, r.trip)
		}
		r := results[i][1]
		pr("| %s | %d | %d | %s | %d | %s | %v | %s | %s | %s | same fact, no second effect |",
			f, r.level, r.wires, seconds(r.countdown), r.moves, seconds(r.solved), r.clean, r.facts, millis(r.armTrip), millis(r.trip))
	}
	pr("")
	pr("The opening Rewire, once a character (%d of them): %d wires, level %d, countdown %s.",
		len(families), results[0][0].wires, results[0][0].level, seconds(results[0][0].countdown))
	pr("")
	slices.Sort(arm)
	slices.Sort(trip)
	pr("Round trips over %d machines: arm median %s, worst %s; solve median %s, worst %s.",
		len(arm), millis(arm[len(arm)/2]), millis(arm[len(arm)-1]), millis(trip[len(trip)/2]), millis(trip[len(trip)-1]))
	pr("")
	pr("## An armed machine left alone")
	pr("")
	pr("| Page | Countdown | Haywire | Seen after the deadline |")
	pr("| --- | --- | --- | --- |")
	for _, e := range []expiry{open, closed} {
		pr("| %s | %s | %s, late | %s |", either(e.open, "left open", "closed, opened again later"), seconds(e.countdown), e.haywire, seconds(e.late.Milliseconds()))
	}
	pr("")
	pr("## The bench")
	pr("")
	pr("%d Rewire rigs solved in one world day, and one log stopped a move short (%s). Uses today: %d of %d. Rewire practice: level %d and %d uses before, level %d and %d uses at the cap, level %d and %d uses after %d more solves.",
		day.solves, day.half, day.uses, day.cap, day.before.Level, day.before.Uses, day.atCap.Level, day.atCap.Uses, day.after.Level, day.after.Uses, day.solves-day.cap)
	return nil, doc.save(out, "activity.md")
}
