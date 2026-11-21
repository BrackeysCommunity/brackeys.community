// Package gateway is the Activity's side of the world service: the
// sign-in, one WebSocket per viewer, the countdowns of armed machines and
// the Activity's static build, on a listener of its own. It holds no rule
// and no key: every state it sends is the host's filter's, and every write
// goes through the host's action path.
package gateway

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"jams.team/mmo-world/api"
)

// Host is what the gateway needs of the world: who plays whom, one
// viewer's filtered state, the action path, the countdowns running, and a
// party's seats, windows and merged log.
type Host interface {
	CharacterOf(ctx context.Context, discordID string) (string, error)
	// View is one character's state, filtered for them; passed is the
	// armedAt of the machine whose move they already passed on. ok is
	// false when the character is gone.
	View(ctx context.Context, characterID string, v api.Viewer, passed int64) (st api.ActivityState, ok bool, err error)
	// Act applies a request as POST /v1/actions would, with the reply's
	// facts as its character may read them. check is false only for the
	// gateway's own writes: an expiry or a party's merged solve.
	Act(ctx context.Context, req api.ActionRequest, check bool) (api.ActionReply, *api.Refusal, error)
	Armed(ctx context.Context) ([]api.ArmedMachine, error)
	// Countdown is one character's countdown, with Due 0 when none is
	// running. ok is false when the character is gone.
	Countdown(ctx context.Context, characterID string) (m api.ArmedMachine, ok bool, err error)
	// Subscribe is told which characters a command or a tick changed
	// (nil: any). f must not block: it is called with the world held.
	Subscribe(f func(characterIDs []string))
	// Windows are the pick windows open, and Window one of them; ok is
	// false when it is not open, or waits on an armed machine.
	Windows(ctx context.Context) ([]api.OpenWindow, error)
	Window(ctx context.Context, shared string) (w api.OpenWindow, ok bool, err error)
	// Judge replays a merged log against the armed machine of a
	// character's party, with no write: JudgeGoing, JudgeDone or
	// JudgeBroke, or "" when none is armed.
	Judge(ctx context.Context, characterID string, log api.PuzzleLog) (status string, err error)
	// Seats is the context a character is bound to and who must hold a
	// seat in it before its party's machine arms, in seat order. A
	// character who is gone has no context.
	Seats(ctx context.Context, characterID string) (context string, members []string, err error)
}

// What Judge says of a merged log so far.
const (
	JudgeGoing = "going"
	JudgeDone  = "done"
	JudgeBroke = "broke"
)

// Clock is the wall clock and its timers, so a test can move time.
type Clock interface {
	Now() time.Time
	// AfterFunc runs f once d has passed, never inside the call itself;
	// stop cancels a timer that has not run.
	AfterFunc(d time.Duration, f func()) (stop func())
}

type wall struct{}

func (wall) Now() time.Time { return time.Now() }

func (wall) AfterFunc(d time.Duration, f func()) func() {
	t := time.AfterFunc(d, f)
	return func() { t.Stop() }
}

// Capturer takes product events.
type Capturer interface {
	Capture(name, distinct string, props map[string]any)
}

// Config is what a gateway runs with.
type Config struct {
	Host         Host
	AppID        string // DISCORD_APP_ID
	ClientSecret string // DISCORD_CLIENT_SECRET
	DiscordAPI   string // MMO_DISCORD_API, default https://discord.com/api
	Dir          string // MMO_ACTIVITY_DIR, the static build
	Dev          bool   // MMO_ACTIVITY_DEV on a disposable world
	Clock        Clock  // nil: the real one
	Log          *slog.Logger
	// Health answers /healthz as the API listener does; nil answers that
	// the listener is up.
	Health http.Handler
	// Events receives the telemetry beacon; nil sends none.
	Events Capturer
}

// structural: the protocol's sizes and waits.
const (
	maxFrame    = 64 << 10        // a socket frame, in bytes
	maxBody     = 4 << 10         // a token or beacon body, in bytes
	maxBehind   = 8               // frames a socket may fall behind
	maxIntents  = 10              // intents a character's seats may send in a second
	maxMoves    = 40              // party machine moves a character's seats may send in a second
	maxLooks    = 5               // looks a character's seats may send in a second
	maxUnseated = 256             // sockets that may be open with no hello answered yet
	maxSockets  = 4               // sockets one Discord user may hold open
	maxSeats    = 8               // seats one Discord user may hold, open or kept
	maxMissed   = 2               // pings a socket may leave unanswered
	maxTries    = 3               // views built again because the world reloaded meanwhile
	helloWait   = 5 * time.Second // a real client says hello as the socket opens
	pingEvery   = 20 * time.Second
	writeWait   = 10 * time.Second
	hostWait    = 30 * time.Second
	closeWait   = 5 * time.Second
	sessionKept = 2 * time.Minute
	sessionLife = 2 * time.Hour
	expirySlack = 250 * time.Millisecond
	retryWait   = 5 * time.Second
)

// Session is one Activity instance: everyone who opened it in one channel.
// Each seat is bound to one game context; solo, that is the seat's own
// character.
type Session struct {
	Instance string
	seats    map[string]*Seat // by character id
	emptied  time.Time        // when its last socket closed
	unreap   func()           // stops the timer that would forget it
}

// Seat is one signed-in viewer in a session. Context, conn and synced are
// read under the gateway's lock; the rest under its character's.
type Seat struct {
	Discord string
	Char    string
	Context api.Context
	Viewer  api.Viewer
	conn    *conn
	last    [sha256.Size]byte // the state last sent, to skip a repeat

	session *Session
	who     *player
	epoch   int64 // the world's epoch its owner was last checked at
	// What the state last sent lets the seat pass on, and on which machine.
	pass    *api.PuzzleMove
	armedAt int64
	sat     int64 // the arrival it was last sat in, which orders its socket; under the gateway's lock
	// The party machine the state last sent shows armed, if any.
	party *partySeat
	// synced is the socket that has the merged log so far: relayed moves
	// go only to it, so none arrives before the log it follows.
	synced *conn
}

// player is one character the gateway serves. Its lock puts that
// character's views and writes in one order, so a countdown always
// follows the newest state.
type player struct {
	mu     sync.Mutex
	timer  *countdown // under the gateway's lock
	passed int64      // armedAt of the machine a hint was last passed on
	// Kept for the character, so a socket opened again starts no fresh
	// window.
	recent window // intents in the last second
	looks  window // looks in the last second
	moves  window // party machine moves in the last second
}

// countdown is the timer that ends one armed machine.
type countdown struct {
	due  int64 // unix ms, grace included
	stop func()
}

// Gateway serves the Activity for one world.
type Gateway struct {
	cfg     Config
	clock   Clock
	log     *slog.Logger
	discord string // Discord's API base
	client  *http.Client
	key     []byte // signs session tokens; made at start and kept nowhere
	ctx     context.Context
	cancel  context.CancelFunc
	socks   sync.WaitGroup // open sockets
	idle    chan struct{}  // closed when the worker has stopped
	started atomic.Bool
	// epoch moves whenever the world may have been reloaded, so a seat's
	// owner is checked again before anything more is shown to it.
	epoch atomic.Int64

	mu        sync.Mutex
	closed    bool
	sessions  map[string]*Session
	conns     map[*conn]struct{}
	players   map[string]*player
	arrivals  int64
	unseated  int    // sockets accepted and not yet seated
	beacons   window // beacons in the last second
	exchanges window // codes traded with Discord in the last second

	// The merged logs of party machines, by context; taken after a
	// character's lock and before a log's own.
	cmu      sync.Mutex
	contexts map[string]*mergedLog

	// The notices not yet acted on.
	nmu     sync.Mutex
	settled *sync.Cond
	all     bool
	dirty   map[string]bool
	queued  int64
	handled int64
	wake    chan struct{}

	// Waits a test shortens.
	helloWait time.Duration
	pingEvery time.Duration
}

// New makes a gateway. Call Start once the world is held and before the
// handler serves.
func New(cfg Config) *Gateway {
	g := &Gateway{cfg: cfg, clock: cfg.Clock, log: cfg.Log, discord: strings.TrimRight(cfg.DiscordAPI, "/"),
		key: make([]byte, sha256.Size), sessions: map[string]*Session{}, conns: map[*conn]struct{}{}, players: map[string]*player{},
		contexts: map[string]*mergedLog{}, dirty: map[string]bool{}, wake: make(chan struct{}, 1), idle: make(chan struct{}), helloWait: helloWait, pingEvery: pingEvery}
	if g.clock == nil {
		g.clock = wall{}
	}
	if g.log == nil {
		g.log = slog.New(slog.DiscardHandler)
	}
	if g.discord == "" {
		g.discord = DiscordAPI
	}
	// A redirect would carry the client secret to wherever it points.
	g.client = &http.Client{Timeout: hostWait, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	_, _ = rand.Read(g.key)
	g.settled = sync.NewCond(&g.nmu)
	g.ctx, g.cancel = context.WithCancel(context.Background())
	return g
}

// Start reads the countdowns already running and sets their timers, then
// follows the world's changes.
func (g *Gateway) Start(ctx context.Context) error {
	if !g.started.CompareAndSwap(false, true) {
		return nil
	}
	list, err := g.cfg.Host.Armed(ctx)
	if err != nil {
		g.started.Store(false)
		return err
	}
	g.cfg.Host.Subscribe(g.changed)
	go g.work()
	ids := make([]string, 0, len(list))
	for _, a := range list {
		ids = append(ids, a.CharacterID)
	}
	g.sweep(ctx, ids)
	return nil
}

// Close closes every socket and stops every timer; call it before the
// world is released.
func (g *Gateway) Close() {
	g.mu.Lock()
	if g.closed {
		g.mu.Unlock()
		return
	}
	g.closed = true
	conns := make([]*conn, 0, len(g.conns))
	for c := range g.conns {
		conns = append(conns, c)
	}
	for _, p := range g.players {
		if p.timer != nil {
			p.timer.stop()
			p.timer = nil
		}
	}
	for _, s := range g.sessions {
		g.forget(s)
	}
	g.mu.Unlock()
	g.endParties()
	// A socket closed with no bye dials again, and finds the next service.
	for _, c := range conns {
		go c.shut(websocket.StatusGoingAway, "the world is closing")
	}
	gone := make(chan struct{})
	go func() {
		g.socks.Wait()
		close(gone)
	}()
	select {
	case <-gone:
	case <-time.After(closeWait):
	}
	g.cancel()
	<-gone
	if g.started.Load() {
		<-g.idle
	}
}

// changed is the host's notice. It is called with the world held, so it
// only takes a note and wakes the worker.
func (g *Gateway) changed(ids []string) {
	if g.ctx.Err() != nil {
		return
	}
	g.nmu.Lock()
	if ids == nil {
		g.all = true
		g.epoch.Add(1)
	}
	for _, id := range ids {
		g.dirty[id] = true
	}
	g.queued++
	g.nmu.Unlock()
	select {
	case g.wake <- struct{}{}:
	default:
	}
}

func (g *Gateway) work() {
	defer close(g.idle)
	for {
		select {
		case <-g.ctx.Done():
			return
		case <-g.wake:
		}
		g.nmu.Lock()
		all, ids, upTo := g.all, g.dirty, g.queued
		g.all, g.dirty = false, map[string]bool{}
		g.nmu.Unlock()
		g.refresh(all, ids)
		g.nmu.Lock()
		g.handled = upTo
		g.settled.Broadcast()
		g.nmu.Unlock()
	}
}

// settle waits until every notice so far has been acted on.
func (g *Gateway) settle() {
	g.nmu.Lock()
	defer g.nmu.Unlock()
	for g.handled != g.queued {
		g.settled.Wait()
	}
}

// refresh sends a new state to the seats of the characters a notice
// names, never to the whole world's, and keeps the countdowns in step.
func (g *Gateway) refresh(all bool, ids map[string]bool) {
	g.mu.Lock()
	// A party's seats are rebuilt together: a notice names whose row
	// changed, and every seat bound to that party may see it.
	parties := map[string]bool{}
	for _, s := range g.sessions {
		for _, seat := range s.seats {
			if ids[seat.Char] && seat.Context.Kind != "" && seat.Context.Kind != api.ContextSolo {
				parties[contextKey(seat.Context)] = true
			}
		}
	}
	var seats []*Seat
	shown := map[string]bool{}
	for _, s := range g.sessions {
		for _, seat := range s.seats {
			if seat.conn != nil && (all || ids[seat.Char] || parties[contextKey(seat.Context)]) {
				seats = append(seats, seat)
				shown[seat.Char] = true
			}
		}
	}
	// Only the gateway's own writes start a countdown, and they show the
	// writer; one nobody's seat shows may still have ended.
	var timed []string
	for id, p := range g.players {
		if p.timer != nil && !shown[id] && (all || ids[id]) {
			timed = append(timed, id)
		}
	}
	g.mu.Unlock()
	ctx, cancel := context.WithTimeout(g.ctx, hostWait)
	defer cancel()
	for _, s := range seats {
		s.who.mu.Lock()
		g.show(ctx, s, false)
		s.who.mu.Unlock()
	}
	if all {
		// A tick, a reload or a reset: any countdown may have started or
		// ended unseen.
		list, err := g.cfg.Host.Armed(ctx)
		if err != nil {
			g.log.Error("activity: reading the countdowns", "err", err.Error())
			return
		}
		for _, a := range list {
			if !shown[a.CharacterID] && !slices.Contains(timed, a.CharacterID) {
				timed = append(timed, a.CharacterID)
			}
		}
	}
	g.sweep(ctx, timed)
}

// sweep sets each character's countdown from the world's now.
func (g *Gateway) sweep(ctx context.Context, ids []string) {
	for _, id := range ids {
		g.check(ctx, id)
	}
}

// player is the record of a character, made on first need.
func (g *Gateway) player(id string) *player {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[id]
	if p == nil {
		p = &player{}
		g.players[id] = p
	}
	return p
}

// check sets a character's countdown from the world's now; none for a
// character who is gone. A character with no record and no countdown is
// given no record.
func (g *Gateway) check(ctx context.Context, id string) {
	g.mu.Lock()
	p := g.players[id]
	g.mu.Unlock()
	if p == nil {
		m, ok := g.countdown(ctx, id)
		if !ok || m.Due == 0 {
			return
		}
		if m.Context != "" {
			g.keepParty(m, "")
			return
		}
		p = g.player(id)
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	m, ok := g.countdown(ctx, id)
	if !ok {
		return
	}
	if m.Context != "" {
		g.keep(p, id, 0)
		g.keepParty(m, "")
		return
	}
	g.keep(p, id, m.Due)
}

// countdown is a character's countdown as the host reads it; ok is false
// when it could not be read.
func (g *Gateway) countdown(ctx context.Context, id string) (api.ArmedMachine, bool) {
	m, _, err := g.cfg.Host.Countdown(ctx, id)
	if err != nil {
		g.log.Error("activity: reading a countdown", "character", id, "err", err.Error())
		return m, false
	}
	return m, true
}

// due is when the server ends a character's own machine in a state, or
// 0. A party's machine is ended by its context's countdown instead.
func due(m *api.MachineView) int64 {
	if m == nil || !m.Armed || api.PartySource(m.Source) {
		return 0
	}
	return m.Due
}

// keep sets, moves or stops a character's countdown timer; the caller
// holds the character's lock. due 0 is no countdown.
func (g *Gateway) keep(p *player, id string, due int64) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if t := p.timer; t != nil {
		if t.due == due {
			return
		}
		t.stop()
		p.timer = nil
	}
	if due == 0 || g.closed {
		return
	}
	g.set(p, id, due, max(0, time.UnixMilli(due).Sub(g.clock.Now())+expirySlack))
}

// set starts a countdown's timer under the gateway's lock.
func (g *Gateway) set(p *player, id string, due int64, wait time.Duration) {
	t := &countdown{due: due}
	p.timer = t
	t.stop = g.clock.AfterFunc(wait, func() { g.expire(id, t) })
}

// expire ends a machine whose countdown ran out with nobody solving it:
// an empty log, sent as the character, which the rules read as a haywire.
// The player's own solve landing first leaves nothing to end.
func (g *Gateway) expire(id string, t *countdown) {
	p := g.player(id)
	p.mu.Lock()
	defer p.mu.Unlock()
	g.mu.Lock()
	current := p.timer == t && !g.closed
	if current {
		p.timer = nil
	}
	g.mu.Unlock()
	if !current {
		return
	}
	// again tries later after a failure that is not the rules' answer.
	again := func(err error) {
		g.log.Error("activity: ending a countdown", "character", id, "err", err.Error())
		g.mu.Lock()
		defer g.mu.Unlock()
		if !g.closed {
			g.set(p, id, t.due, retryWait)
		}
	}
	ctx, cancel := context.WithTimeout(g.ctx, hostWait)
	defer cancel()
	m, ok, err := g.cfg.Host.Countdown(ctx, id)
	if err != nil {
		again(err)
		return
	}
	if !ok {
		return
	}
	if m.Context != "" {
		g.keepParty(m, "")
		return
	}
	if m.Due == 0 || g.clock.Now().UnixMilli() < m.Due {
		// Solved, or a later machine: the timer follows the world.
		g.keep(p, id, m.Due)
		return
	}
	req := api.ActionRequest{InteractionID: expiryKey(id, m.ArmedAt), CharacterID: id, Kind: api.ActMachineSolve,
		Machine: &api.MachineIntent{Log: &api.PuzzleLog{Moves: []api.PuzzleMove{}}}}
	_, ref, err := g.cfg.Host.Act(ctx, req, false)
	if err != nil {
		again(err)
		return
	}
	if ref != nil && ref.Code != api.CodeNoMachine {
		g.log.Warn("activity: a countdown's end was refused", "character", id, "code", ref.Code)
	}
}

// expiryKey is the idempotency key of the write that ends a countdown.
func expiryKey(id string, armedAt int64) string {
	return "mx-" + id + "-" + strconv.FormatInt(armedAt, 10)
}
