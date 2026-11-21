package gateway

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/service"
)

// structural: the frames of the protocol, and why a socket is told to go.
const (
	tHello    = "hello"
	tLook     = "look"
	tIntent   = "intent"
	tPassHint = "pass-hint"
	tPing     = "ping"
	tState    = "state"
	tReply    = "reply"
	tHint     = "hint"
	tBye      = "bye"
	tPong     = "pong"

	byeExpired     = "expired"
	byeReplaced    = "replaced"
	byeNoCharacter = "no-character"
	byeBadHello    = "bad-hello"
	byeSlow        = "slow"

	// closeBye is the close code after a bye; the reason repeats it.
	closeBye = websocket.StatusCode(4001)

	minIntentID = 8
	maxIntentID = 64
	maxName     = 128 // an instance id, a family or a pouch id
)

// intents are the writes the Activity may send; everything else stays in
// chat.
var intents = []string{api.ActPress, api.ActMachineArm, api.ActMachineSolve, api.ActBenchSolve, api.ActBenchLesson}

// conn is one open socket.
type conn struct {
	ws      *websocket.Conn
	out     chan frame
	done    chan struct{}
	once    sync.Once
	closing atomic.Bool
	// Under the gateway's lock.
	seat    *Seat
	discord string
	arrived int64
	stops   []func() // timers that end with the socket
}

// frame is one message queued for a socket; bye marks the last.
type frame struct {
	data []byte
	bye  string
}

func (c *conn) end() {
	c.once.Do(func() {
		close(c.done)
		_ = c.ws.CloseNow()
	})
}

// shut closes the socket with a close frame and no bye.
func (c *conn) shut(code websocket.StatusCode, reason string) {
	c.closing.Store(true)
	_ = c.ws.Close(code, reason)
	c.end()
}

// send queues a frame. A socket that has let its queue fill is dropped.
func (c *conn) send(msg api.ServerMessage) {
	if c.closing.Load() {
		return
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case c.out <- frame{data: data}:
	default:
		c.bye(byeSlow)
	}
}

// bye tells the socket why it must go, then closes it.
func (c *conn) bye(why string) {
	if !c.closing.CompareAndSwap(false, true) {
		return
	}
	data, _ := json.Marshal(api.ServerMessage{T: tBye, Bye: why})
	select {
	case c.out <- frame{data: data, bye: why}:
	default:
		// The queue is full, so only the close frame can say why.
		go func() {
			_ = c.ws.Close(closeBye, why)
			c.end()
		}()
	}
}

func (c *conn) write() {
	for {
		select {
		case <-c.done:
			return
		case f := <-c.out:
			ctx, cancel := context.WithTimeout(context.Background(), writeWait)
			err := c.ws.Write(ctx, websocket.MessageText, f.data)
			cancel()
			if err != nil {
				c.end()
				return
			}
			if f.bye != "" {
				_ = c.ws.Close(closeBye, f.bye)
				c.end()
				return
			}
		}
	}
}

// pings drops a socket that stops answering.
func (g *Gateway) pings(c *conn) {
	t := time.NewTicker(g.pingEvery)
	defer t.Stop()
	missed := 0
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
		}
		ctx, cancel := context.WithTimeout(g.ctx, g.pingEvery)
		err := c.ws.Ping(ctx)
		cancel()
		if err == nil {
			missed = 0
		} else if missed++; missed >= maxMissed {
			c.end()
			return
		}
	}
}

// socket is one viewer's connection: a hello, then frames until it ends.
func (g *Gateway) socket(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	if g.closed {
		g.mu.Unlock()
		refuse(w, http.StatusServiceUnavailable, api.CodeInternal, "the world is closing")
		return
	}
	// A socket that has not said hello holds its goroutines for nothing.
	if g.unseated >= maxUnseated {
		g.mu.Unlock()
		refuse(w, http.StatusServiceUnavailable, api.CodeBusy, "too many sockets are waiting to sign in")
		return
	}
	g.unseated++
	g.socks.Add(1)
	g.mu.Unlock()
	defer g.socks.Done()
	var once sync.Once
	greeted := func() {
		once.Do(func() {
			g.mu.Lock()
			g.unseated--
			g.mu.Unlock()
		})
	}
	defer greeted()
	opts := &websocket.AcceptOptions{InsecureSkipVerify: g.cfg.Dev}
	if g.cfg.AppID != "" {
		// Inside Discord the page's origin is the application's proxy.
		opts.OriginPatterns = []string{g.cfg.AppID + ".discordsays.com"}
	}
	ws, err := websocket.Accept(w, r, opts)
	if err != nil {
		return
	}
	ws.SetReadLimit(maxFrame)
	c := &conn{ws: ws, out: make(chan frame, maxBehind), done: make(chan struct{})}
	g.mu.Lock()
	if g.closed {
		g.mu.Unlock()
		c.end()
		return
	}
	g.conns[c] = struct{}{}
	g.mu.Unlock()
	defer g.leave(c)
	go c.write()
	go g.pings(c)
	late := time.AfterFunc(g.helloWait, func() { c.bye(byeBadHello) })
	seat := g.greet(c, late)
	greeted()
	for {
		_, data, err := ws.Read(g.ctx)
		if err != nil {
			return
		}
		// After a bye, frames are read only so the close can finish.
		if seat != nil && !c.closing.Load() {
			g.handle(seat, c, data)
		}
	}
}

// greet reads the hello and seats its sender, or says why not. late is
// the client's time to say hello: it stops once the hello is read, so a
// slow world is never taken for a slow client.
func (g *Gateway) greet(c *conn, late *time.Timer) *Seat {
	_, data, err := c.ws.Read(g.ctx)
	late.Stop()
	if err != nil {
		c.end()
		return nil
	}
	msg, err := decodeFrame(data)
	if err != nil || msg.T != tHello || msg.Hello == nil || !named(msg.Hello.Instance) || !validViewer(msg.Hello.Viewer) {
		c.bye(byeBadHello)
		return nil
	}
	discord, expires, ok := g.verify(msg.Hello.Session)
	if !ok {
		c.bye(byeExpired)
		return nil
	}
	ctx, cancel := context.WithTimeout(g.ctx, hostWait)
	defer cancel()
	epoch := g.epoch.Load()
	id, err := g.cfg.Host.CharacterOf(ctx, discord)
	if err != nil {
		g.log.Error("activity: finding a character", "err", err.Error())
		c.end()
		return nil
	}
	if id == "" {
		c.bye(byeNoCharacter)
		return nil
	}
	// The character's lock is held from before the seat can be found, so
	// nothing is shown to it until it is the newcomer's.
	who := g.player(id)
	who.mu.Lock()
	defer who.mu.Unlock()
	seat := g.sit(msg.Hello.Instance, discord, id, who, c, expires)
	if seat == nil {
		c.end()
		return nil
	}
	seat.Discord, seat.epoch, seat.Viewer, seat.recent, seat.looks = discord, epoch, msg.Hello.Viewer, nil, nil
	g.show(ctx, seat, true)
	return seat
}

// sit binds a socket to its seat in a session, making either on first
// need. A socket already in the seat is replaced, and so is a user's
// oldest when they hold too many.
func (g *Gateway) sit(instance, discord, id string, who *player, c *conn, expires int64) *Seat {
	g.mu.Lock()
	if g.closed {
		g.mu.Unlock()
		return nil
	}
	sess := g.sessions[instance]
	if sess == nil {
		sess = &Session{Instance: instance, seats: map[string]*Seat{}}
		g.sessions[instance] = sess
	}
	if sess.unreap != nil {
		sess.unreap()
		sess.unreap = nil
	}
	sess.emptied = time.Time{}
	seat := sess.seats[id]
	if seat == nil {
		seat = &Seat{Discord: discord, Char: id, session: sess, who: who}
		sess.seats[id] = seat
	}
	var replaced []*conn
	if seat.conn != nil {
		replaced = append(replaced, seat.conn)
	}
	var held []*conn
	for o := range g.conns {
		if o.discord == discord && o != seat.conn {
			held = append(held, o)
		}
	}
	slices.SortFunc(held, func(a, b *conn) int { return int(a.arrived - b.arrived) })
	for len(held) >= maxSockets {
		replaced, held = append(replaced, held[0]), held[1:]
	}
	g.arrivals++
	seat.conn = c
	c.seat, c.discord, c.arrived = seat, discord, g.arrivals
	// A socket does not outlive the sign-in it came with.
	c.stops = append(c.stops, g.clock.AfterFunc(time.Unix(expires, 0).Sub(g.clock.Now()), func() { c.bye(byeExpired) }))
	// A replaced socket leaves its seat now, so it is not counted or shown
	// to while it closes.
	for _, o := range replaced {
		if o.seat.conn == o {
			o.seat.conn = nil
		}
		o.discord = ""
	}
	g.mu.Unlock()
	for _, o := range replaced {
		o.bye(byeReplaced)
	}
	return seat
}

// leave forgets a socket that has ended. A session whose last socket
// went is kept a while, so a reconnect finds it.
func (g *Gateway) leave(c *conn) {
	c.end()
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.conns, c)
	for _, stop := range c.stops {
		stop()
	}
	s := c.seat
	if s == nil {
		return
	}
	if s.conn == c {
		s.conn = nil
	}
	sess := s.session
	for _, other := range sess.seats {
		if other.conn != nil {
			return
		}
	}
	if g.closed || sess.unreap != nil {
		return
	}
	sess.emptied = g.clock.Now()
	sess.unreap = g.clock.AfterFunc(sessionKept, func() { g.reap(sess) })
}

func (g *Gateway) reap(sess *Session) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.sessions[sess.Instance] != sess || sess.emptied.IsZero() || g.clock.Now().Sub(sess.emptied) < sessionKept {
		return
	}
	sess.unreap = nil
	delete(g.sessions, sess.Instance)
}

// decodeFrame reads one client frame. A field the protocol does not have
// refuses the whole frame: a client names no character, no Discord user
// and no privilege.
func decodeFrame(data []byte) (api.ClientMessage, error) {
	var msg api.ClientMessage
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&msg); err != nil {
		return msg, err
	}
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return msg, errors.New("one frame is one JSON value")
	}
	return msg, nil
}

// named reports whether s can be an id: a short run of letters, digits
// and the few marks ids are joined with.
func named(s string) bool {
	return s != "" && len(s) <= maxName && !strings.ContainsFunc(s, func(r rune) bool { return !alnum(r) && !strings.ContainsRune("-_.:", r) })
}

func alnum(r rune) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9'
}

func validViewer(v api.Viewer) bool {
	return (v.Family == "" || named(v.Family)) && (v.Pouch == "" || named(v.Pouch))
}

func validIntentID(id string) bool {
	return len(id) >= minIntentID && len(id) <= maxIntentID && !strings.ContainsFunc(id, func(r rune) bool { return !alnum(r) && r != '-' })
}

// refusal answers a frame the gateway will not act on.
func refusal(seq int64, id, code, text string) api.ServerMessage {
	return api.ServerMessage{T: tReply, Seq: seq, Reply: &api.IntentReply{ID: id, Refusal: &api.Refusal{Code: code, Message: text}}}
}

// handle acts on one frame from a seated socket.
func (g *Gateway) handle(s *Seat, c *conn, data []byte) {
	msg, err := decodeFrame(data)
	if err != nil {
		// Enough of the frame to answer it, read loosely.
		var loose struct {
			Seq    int64 `json:"seq"`
			Intent struct {
				ID string `json:"id"`
			} `json:"intent"`
		}
		_ = json.Unmarshal(data, &loose)
		if !validIntentID(loose.Intent.ID) {
			loose.Intent.ID = ""
		}
		c.send(refusal(loose.Seq, loose.Intent.ID, api.CodeBadJSON, err.Error()))
		return
	}
	ctx, cancel := context.WithTimeout(g.ctx, hostWait)
	defer cancel()
	switch msg.T {
	case tPing:
		c.send(api.ServerMessage{T: tPong, Seq: msg.Seq})
	case tLook:
		if msg.Look == nil || !validViewer(*msg.Look) {
			c.send(refusal(msg.Seq, "", api.CodeBadJSON, "a look says what is on screen"))
			return
		}
		s.who.mu.Lock()
		defer s.who.mu.Unlock()
		// Every look builds a state with the world held.
		if !s.looks.take(g.clock.Now(), maxLooks) {
			c.send(refusal(msg.Seq, "", api.CodeBusy, "too many looks at once"))
			return
		}
		s.Viewer = *msg.Look
		g.show(ctx, s, true)
	case tIntent:
		g.intent(ctx, s, c, msg)
	case tPassHint:
		g.passHint(ctx, s, c, msg)
	default:
		c.send(refusal(msg.Seq, "", api.CodeBadJSON, "no such frame"))
	}
}

// intent is a write: the seat's own character acting, through the same
// path as a press in chat.
func (g *Gateway) intent(ctx context.Context, s *Seat, c *conn, msg api.ClientMessage) {
	in := msg.Intent
	if in == nil || !validIntentID(in.ID) {
		c.send(refusal(msg.Seq, "", api.CodeBadJSON, "an intent carries an id of 8 to 64 letters, digits and dashes"))
		return
	}
	if !slices.Contains(intents, in.Kind) {
		c.send(refusal(msg.Seq, in.ID, api.CodeForbidden, "that is done in chat"))
		return
	}
	s.who.mu.Lock()
	defer s.who.mu.Unlock()
	if !s.recent.take(g.clock.Now(), maxIntents) {
		c.send(refusal(msg.Seq, in.ID, api.CodeBusy, "too many presses at once"))
		return
	}
	if owned, err := g.owned(ctx, s, g.epoch.Load()); err != nil || !owned {
		if err != nil {
			g.log.Error("activity: finding a character", "err", err.Error())
			c.send(refusal(msg.Seq, in.ID, api.CodeInternal, "the world could not take that"))
			return
		}
		g.dismiss(s)
		return
	}
	req := api.ActionRequest{InteractionID: "act-" + in.ID, CharacterID: s.Char, DiscordID: s.Discord, Version: in.Version,
		Kind: in.Kind, Option: in.Option, Machine: in.Machine}
	rep, ref, err := g.cfg.Host.Act(ctx, req, true)
	switch {
	case err != nil:
		g.log.Error("activity: an intent failed", "character", s.Char, "kind", in.Kind, "err", err.Error())
		c.send(refusal(msg.Seq, in.ID, api.CodeInternal, "the world could not take that"))
	case ref != nil:
		c.send(api.ServerMessage{T: tReply, Seq: msg.Seq, Reply: &api.IntentReply{ID: in.ID, Refusal: ref}})
	case rep.Character.ID != s.Char:
		// A stored reply under this id is somebody else's.
		c.send(refusal(msg.Seq, in.ID, api.CodeBadJSON, "that intent id is taken"))
	default:
		c.send(api.ServerMessage{T: tReply, Seq: msg.Seq, Reply: &api.IntentReply{ID: in.ID, OK: true, Duplicate: rep.Duplicate,
			Facts: service.SeenFacts(s.Char, rep.Facts), Pressed: rep.Pressed, Machine: rep.Machine}})
	}
	g.show(ctx, s, true)
}

// passHint relays one of a master's hint moves to the other seats in the
// same context, once for each armed machine.
func (g *Gateway) passHint(ctx context.Context, s *Seat, c *conn, msg api.ClientMessage) {
	s.who.mu.Lock()
	defer s.who.mu.Unlock()
	if msg.Hint == nil || !s.canPass || s.who.passed == s.armedAt || !slices.Contains(s.hints, *msg.Hint) {
		c.send(refusal(msg.Seq, "", api.CodeForbidden, "no hint to pass"))
		return
	}
	s.who.passed = s.armedAt
	g.mu.Lock()
	var others []*conn
	for _, sess := range g.sessions {
		for _, o := range sess.seats {
			if o != s && o.conn != nil && o.Context == s.Context {
				others = append(others, o.conn)
			}
		}
	}
	g.mu.Unlock()
	for _, o := range others {
		o.send(api.ServerMessage{T: tHint, Hint: msg.Hint})
	}
	g.show(ctx, s, false)
}

// owned reports whether a seat's Discord user still plays its character.
// A reload or a reset may have changed who does, so it is asked again
// whenever the world's epoch has moved.
func (g *Gateway) owned(ctx context.Context, s *Seat, epoch int64) (bool, error) {
	if s.epoch == epoch {
		return true, nil
	}
	id, err := g.cfg.Host.CharacterOf(ctx, s.Discord)
	if err != nil {
		return false, err
	}
	if id != s.Char {
		return false, nil
	}
	s.epoch = epoch
	return true, nil
}

// dismiss sends a seat's socket back to sign in.
func (g *Gateway) dismiss(s *Seat) {
	g.mu.Lock()
	c := s.conn
	g.mu.Unlock()
	if c != nil {
		c.bye(byeExpired)
	}
}

// show builds a seat's state and sends it, whole: the host's filter
// decides everything in it. An identical state is sent again only when
// the seat asked. The caller holds the character's lock.
func (g *Gateway) show(ctx context.Context, s *Seat, force bool) {
	for range maxTries {
		epoch := g.epoch.Load()
		owned, err := g.owned(ctx, s, epoch)
		if err != nil {
			g.log.Error("activity: finding a character", "err", err.Error())
			return
		}
		if !owned {
			g.dismiss(s)
			return
		}
		st, ok, err := g.cfg.Host.View(ctx, s.Char, s.Viewer)
		if err != nil {
			g.log.Error("activity: building a state", "character", s.Char, "err", err.Error())
			return
		}
		if g.epoch.Load() != epoch {
			// The world may have been replaced under the view.
			continue
		}
		if !ok {
			g.keep(s.who, s.Char, 0)
			g.dismiss(s)
			return
		}
		g.keep(s.who, s.Char, due(st.Machine))
		s.canPass, s.armedAt, s.hints = false, 0, nil
		if m := st.Machine; m != nil && m.Armed {
			if s.who.passed == m.ArmedAt {
				m.CanPass = false
			}
			s.canPass, s.armedAt, s.hints = m.CanPass, m.ArmedAt, slices.Clone(m.Hints)
			if m.Guide != nil {
				s.hints = append(s.hints, *m.Guide)
			}
		}
		g.mu.Lock()
		s.Context = st.Context
		c := s.conn
		g.mu.Unlock()
		if c == nil {
			return
		}
		sum := digest(st)
		if !force && sum == s.last {
			return
		}
		s.last = sum
		c.send(api.ServerMessage{T: tState, State: &st})
		return
	}
	// The next notice builds it again; nothing sent stands in its way.
	s.last = [sha256.Size]byte{}
}

// digest is a state's fingerprint. The clock it was built on is left out:
// a state that differs only by it is the same state.
func digest(st api.ActivityState) [sha256.Size]byte {
	st.Now = 0
	body, _ := json.Marshal(st)
	return sha256.Sum256(body)
}
