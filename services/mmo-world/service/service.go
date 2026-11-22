// Package service is the world service: the only writer of game state and
// the only holder of the keys. It holds a world under an advisory lock,
// runs its tick loop and serves the API in package api.
package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"reflect"
	"slices"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

// Config is what a world service runs with.
type Config struct {
	Secrets
	TickSeconds int32
	Book        *sheets.Book
	// APIToken guards /v1 for the bot and the site; OperatorToken guards
	// the operator paths. An empty APIToken leaves /v1 open (local runs).
	APIToken      string
	OperatorToken string
	// ManualClock makes the due tick whatever an operator last set, for
	// tests that must control time. Never on a deployed world.
	ManualClock bool
	// Disposable founds worlds that may be wiped: by an operator's reset,
	// or at start-up when the sheets changed. Off, a world is kept.
	Disposable bool
	// SheetsFrom re-stamps a kept world that runs on exactly this sheets
	// digest onto the service's sheets instead of refusing it: a one-shot
	// for sheets that only add (GDD 4.17). Empty, EnvSheetsFrom is read.
	SheetsFrom string
	// Next is the pending book of a rules epoch, taken right after the tick
	// that closes a season (GDD 18.5). Nil, EnvSheetsNext is read.
	Next *sheets.Book
	Poll time.Duration
	Now  func() time.Time
	Log  *slog.Logger
	// Events receives product events; nil sends none.
	Events Capturer
}

// Capturer takes product events.
type Capturer interface {
	Capture(name, distinct string, props map[string]any)
}

// Server is one world, held.
type Server struct {
	cfg Config
	st  *store.Store
	// rules change only at an epoch, under mu; readers outside it load them.
	rules atomic.Pointer[game.Rules]
	lock  *store.Lock
	// epoch is the rules epoch pending, nil once taken or with none.
	epoch *pending
	// mu guards g, closed and the store's writes.
	mu     sync.Mutex
	g      *game.Game
	closed bool
	// stale is set, under mu, while g is not what the store holds: a reload
	// failed. Nothing reads or writes g until a load succeeds.
	stale   atomic.Bool
	stalled atomic.Bool // ticks keep failing
	meta    atomic.Pointer[store.Meta]
	due     atomic.Int64 // the manual clock's due tick
	tick    atomic.Int64 // the world's tick, for readers that must not wait on a running tick
	ready   atomic.Bool
	audit   time.Time
	media   media
	subs    listeners
	// pool reads who plays whom, for the party threads; ended keeps the
	// parties that ended lately, under mu.
	pool  *pgxpool.Pool
	ended endings
}

// Open takes the world's lock (waiting while another service holds it),
// then loads the world, or founds it if it has never run. A disposable
// world whose sheets changed is reset with the new ones, if this service
// founds disposable worlds too.
func Open(ctx context.Context, pool *pgxpool.Pool, cfg Config) (*Server, error) {
	if cfg.TickSeconds <= 0 || cfg.Poll <= 0 {
		return nil, fmt.Errorf("service: a tick (%d s) and the poll (%s) must be positive", cfg.TickSeconds, cfg.Poll)
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.SheetsFrom == "" {
		cfg.SheetsFrom = os.Getenv(EnvSheetsFrom)
	}
	if cfg.Next == nil {
		next, err := NextBookFromEnv()
		if err != nil {
			return nil, err
		}
		cfg.Next = next
	}
	rules, err := game.NewRules(cfg.Book, cfg.Keys)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, st: store.New(pool, cfg.World), pool: pool}
	s.rules.Store(rules)
	if s.epoch, err = pendingEpoch(cfg); err != nil {
		return nil, err
	}
	waiting := false
	for {
		lock, ok, err := store.TryLock(ctx, pool, cfg.World)
		if err != nil {
			return nil, err
		}
		if ok {
			s.lock = lock
			break
		}
		if !waiting {
			cfg.Log.Info("another service holds the world; waiting", "world", cfg.World)
			waiting = true
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(cfg.Poll):
		}
	}
	if err := s.st.EnsurePartitions(ctx, cfg.Now()); err != nil {
		return nil, s.fail(ctx, err)
	}
	if err := s.open(ctx); err != nil {
		return nil, s.fail(ctx, err)
	}
	s.due.Store(s.g.Tick())
	s.tick.Store(s.g.Tick())
	return s, nil
}

func (s *Server) fail(ctx context.Context, err error) error {
	s.lock.Release(ctx)
	return err
}

func (s *Server) open(ctx context.Context) error {
	m, err := s.st.MetaFor(ctx, s.cfg.Keys, s.cfg.KeyVersion, s.cfg.Epoch, s.cfg.Book)
	taken := false
	switch {
	case errors.Is(err, store.ErrOtherSheets) && s.epoch != nil && m.SheetsDigest == s.epoch.to:
		s.runOn(s.epoch)
		taken, err = true, nil
	case errors.Is(err, store.ErrOtherSheets) && s.cfg.SheetsFrom != "" && s.cfg.SheetsFrom == m.SheetsDigest:
		err = s.restamp(ctx, &m)
	}
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return s.found(ctx, false)
	case errors.Is(err, store.ErrOtherSheets):
		if !s.resettable(&m) {
			return fmt.Errorf("service: %w; only a disposable world under a service that founds disposable worlds is reset", err)
		}
		s.cfg.Log.Warn("SHEETS CHANGED: wiping the disposable world and founding it again", "world", m.ID, "err", err.Error())
		return s.found(ctx, true)
	case err != nil:
		return err
	}
	s.meta.Store(&m)
	if s.g, err = s.st.Load(ctx, s.rules.Load()); err != nil {
		return err
	}
	if err := s.freeze(ctx); err != nil {
		return err
	}
	if err := s.seasonStart(ctx); err != nil {
		return err
	}
	if taken {
		return s.epochAtOpen(ctx)
	}
	if s.epoch != nil && s.atBoundary() {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.takeEpoch(ctx)
	}
	return nil
}

// restamp moves a kept world onto the service's sheets, from exactly the
// digest the operator named.
func (s *Server) restamp(ctx context.Context, m *store.Meta) error {
	to, err := s.cfg.Book.Digest()
	if err != nil {
		return err
	}
	if err := s.st.Restamp(ctx, m.SheetsDigest, to); err != nil {
		return err
	}
	s.cfg.Log.Warn("SHEETS RESTAMPED: OFF-BOUNDARY RESTAMP: the kept world now runs on these sheets mid-season; unset "+EnvSheetsFrom,
		"world", m.ID, "from", m.SheetsDigest, "to", to)
	m.SheetsDigest = to
	return nil
}

// freezeKey is the interaction the freeze is recorded under: one per
// world, so it is applied once.
const freezeKey = "content-freeze"

// freeze sends the recorded content freeze to a world that does not yet
// draw content from history, so the world replays through it.
func (s *Server) freeze(ctx context.Context) error {
	if s.g.World.Drawn() {
		return nil
	}
	ctx, cancel := writeContext(ctx)
	defer cancel()
	out, err := s.do(ctx, game.Command{Key: freezeKey, Kind: game.ContentFreeze}, "", 0, false)
	switch {
	case err != nil:
		return fmt.Errorf("service: freezing the world's content: %w", err)
	case out.ref != nil:
		return fmt.Errorf("service: freezing the world's content: %s: %s", out.ref.Code, out.ref.Message)
	case out.dup || !s.g.World.Drawn():
		return errors.New("service: the content freeze is recorded but the world does not draw from history")
	}
	s.cfg.Log.Warn("CONTENT FROZEN: the world now draws content from history", "world", s.cfg.World, "tick", s.g.Tick(), "facts", len(out.res.Facts))
	return nil
}

// seasonKey is the interaction a world from before seasons is given its
// clock under: one per world, so it is applied once.
const seasonKey = "season-start"

// seasonStart sends the recorded season start to a world that keeps no
// season, so it replays through it as through the freeze.
func (s *Server) seasonStart(ctx context.Context) error {
	if s.g.Story != nil {
		return nil
	}
	ctx, cancel := writeContext(ctx)
	defer cancel()
	out, err := s.do(ctx, game.Command{Key: seasonKey, Kind: game.SeasonStart}, "", 0, false)
	switch {
	case err != nil:
		return fmt.Errorf("service: starting the world's season: %w", err)
	case out.ref != nil:
		return fmt.Errorf("service: starting the world's season: %s: %s", out.ref.Code, out.ref.Message)
	case out.dup || s.g.Story == nil:
		return errors.New("service: the season start is recorded but the world keeps no season")
	}
	c, _, _ := s.g.Season()
	s.cfg.Log.Warn("SEASON STARTED: the world now keeps a season clock", "world", s.cfg.World, "tick", s.g.Tick(), "season", c.N,
		"day", c.Day(s.g.Tick()/sheets.TicksPerDay), "days", c.Days)
	return nil
}

// pending is a rules epoch waiting for a season's close: the book, its
// rules and digest, and the digest and count of sheets it changes from.
type pending struct {
	book    *sheets.Book
	rules   *game.Rules
	from    string
	to      string
	changed int64
}

// pendingEpoch builds the pending epoch's rules up front, so a book that
// does not build fails the deploy and not the close.
func pendingEpoch(cfg Config) (*pending, error) {
	if cfg.Next == nil {
		return nil, nil
	}
	from, err := cfg.Book.Digest()
	if err != nil {
		return nil, err
	}
	to, err := cfg.Next.Digest()
	if err != nil {
		return nil, err
	}
	if from == to {
		cfg.Log.Warn("the pending sheets are the sheets the world runs on: no epoch to take; unset "+EnvSheetsNext, "digest", to)
		return nil, nil
	}
	rules, err := game.NewRules(cfg.Next, cfg.Keys)
	if err != nil {
		return nil, fmt.Errorf("service: the pending sheets under %s: %w", EnvSheetsNext, err)
	}
	return &pending{book: cfg.Next, rules: rules, from: from, to: to, changed: changedSheets(cfg.Book, cfg.Next)}, nil
}

// changedSheets counts the sheets two books differ in.
func changedSheets(a, b *sheets.Book) int64 {
	va, vb := reflect.ValueOf(a).Elem(), reflect.ValueOf(b).Elem()
	var n int64
	for i := range va.NumField() {
		if f := va.Type().Field(i); !f.IsExported() || f.Tag.Get("json") == "-" {
			continue
		}
		ja, errA := json.Marshal(va.Field(i).Interface())
		jb, errB := json.Marshal(vb.Field(i).Interface())
		if errA != nil || errB != nil || !bytes.Equal(ja, jb) {
			n++
		}
	}
	return n
}

// closes reports whether a tick's facts close a season.
func closes(facts []fact.Fact) bool {
	return slices.ContainsFunc(facts, func(f fact.Fact) bool { return f.Kind == seasonClosed })
}

// structural: the fact a season's close writes.
const seasonClosed = "season.closed"

// atBoundary reports, under mu, whether the world stands right after a
// season's close with the pending epoch not yet recorded.
func (s *Server) atBoundary() bool {
	c, _, ok := s.g.Season()
	return ok && c.N > 0 && !c.Legacy && s.g.Tick() == c.Start*sheets.TicksPerDay && c.Epoch != s.epoch.to
}

// runOn makes the service run on an epoch's book.
func (s *Server) runOn(e *pending) {
	s.cfg.Book = e.book
	s.rules.Store(e.rules)
}

// takeEpoch, under mu, moves the world onto the pending book at a
// season's close: the store is re-stamped, the game loaded on the new
// rules, and the epoch recorded. Each step can be taken again after a
// failure, at the next tick or the next open.
func (s *Server) takeEpoch(ctx context.Context) error {
	e := s.epoch
	m := *s.meta.Load()
	if m.SheetsDigest != e.to {
		if err := s.st.Restamp(ctx, m.SheetsDigest, e.to); err != nil {
			return fmt.Errorf("service: taking the epoch: %w", err)
		}
		m.SheetsDigest = e.to
		s.meta.Store(&m)
	}
	g, err := s.st.Load(ctx, e.rules)
	if err != nil {
		return fmt.Errorf("service: taking the epoch: %w", err)
	}
	// The same tick, on new rules: the tick a reader sees moves only once
	// the epoch is recorded.
	s.runOn(e)
	s.g = g
	return s.recordEpoch(ctx)
}

// epochAtOpen is a world already re-stamped onto the pending book: it runs
// on it, and the epoch is recorded if the close it followed was not.
func (s *Server) epochAtOpen(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.atBoundary() {
		return s.recordEpoch(ctx)
	}
	s.epochTaken()
	return nil
}

// recordEpoch, under mu, sends the recorded season-epoch for the season
// just begun.
func (s *Server) recordEpoch(ctx context.Context) error {
	e := s.epoch
	c, _, _ := s.g.Season()
	ctx, cancel := writeContext(ctx)
	defer cancel()
	cmd := game.Command{Key: "season-epoch-" + strconv.FormatInt(c.N, 10), Kind: game.SeasonEpoch,
		Epoch: &season.Epoch{From: e.from, To: e.to, Sheets: e.changed}}
	out, err := applyCommand(ctx, s.g, s.st, &s.subs, cmd, "", 0, false, s.cfg.Now())
	switch {
	case err != nil:
		if !errors.As(err, new(untouched)) {
			err = s.reload(ctx, err)
		}
		return fmt.Errorf("service: recording the epoch: %w", err)
	case out.ref != nil:
		return fmt.Errorf("service: recording the epoch: %s: %s", out.ref.Code, out.ref.Message)
	}
	s.epochTaken()
	return nil
}

func (s *Server) epochTaken() {
	e := s.epoch
	c, _, _ := s.g.Season()
	s.cfg.Log.Warn("EPOCH TAKEN: point "+EnvSheets+" at the new sheets and unset "+EnvSheetsNext, "world", s.cfg.World, "season", c.N,
		"from", e.from, "to", e.to, "sheets", e.changed, "tick", s.g.Tick())
	s.epoch = nil
}

// resettable reports whether a stored world may be wiped: it is disposable,
// and so are the worlds this service founds.
func (s *Server) resettable(m *store.Meta) bool { return m != nil && m.Disposable && s.cfg.Disposable }

// found starts a world at tick 0, now, on the service's sheets; replace
// wipes the world it replaces in the same transaction.
func (s *Server) found(ctx context.Context, replace bool) error {
	digest, err := s.cfg.Book.Digest()
	if err != nil {
		return err
	}
	g, err := game.New(s.rules.Load())
	if err != nil {
		return err
	}
	m := store.Meta{ID: s.cfg.World, KeyVersion: s.cfg.KeyVersion, KeyCheck: s.cfg.Keys.Check(), RulesEpoch: s.cfg.Epoch,
		SheetsDigest: digest, StartedAt: s.cfg.Now(), TickSeconds: s.cfg.TickSeconds, Disposable: s.cfg.Disposable}
	if replace {
		err = s.st.Recreate(ctx, m, g)
	} else {
		err = s.st.Create(ctx, m, g)
	}
	if err != nil {
		return err
	}
	s.cfg.Log.Info("world founded", "world", m.ID, "disposable", m.Disposable)
	s.meta.Store(&m)
	g, err = s.st.Load(ctx, s.rules.Load())
	if err != nil {
		return err
	}
	s.restore(g)
	s.ended = endings{}
	return nil
}

// Close gives up the world once no tick or action is writing; nothing
// writes after it.
func (s *Server) Close(ctx context.Context) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	s.ready.Store(false)
	s.lock.Release(ctx)
}

// Due is the tick that should have run by now.
func (s *Server) Due() int64 {
	if s.cfg.ManualClock {
		return s.due.Load()
	}
	return s.meta.Load().DueTick(s.cfg.Now())
}

func (s *Server) capture(name, distinct string, props map[string]any) {
	if s.cfg.Events != nil {
		s.cfg.Events.Capture(name, distinct, props)
	}
}

// Tick is the world's current tick, without waiting on a tick that is
// running.
func (s *Server) Tick() int64 { return s.tick.Load() }

// structural: a tick loop that keeps failing waits longer between tries,
// up to maxBackoff, and reports itself stalled after stallAfter failures.
const (
	stallAfter = 5
	maxBackoff = time.Minute
)

// Run runs every tick that has fallen due, in order, one transaction each,
// until ctx ends; a service that was down catches up the same way. It
// returns an error once the world's lock is lost, so the process exits and
// a restarted service waits for the lock.
func (s *Server) Run(ctx context.Context) error {
	s.ready.Store(true)
	failures := 0
	// ran counts a failure, or clears the count after a success.
	ran := func(err error) bool {
		if err != nil {
			failures++
			s.failed(err, failures)
			return false
		}
		if failures > 0 {
			s.cfg.Log.Info("ticks run again", "world", s.cfg.World, "after", failures)
			failures = 0
			s.stalled.Store(false)
		}
		return true
	}
	for {
		if err := s.holdsLock(ctx); err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		// A stale world with no tick due would otherwise wait for a request.
		if s.stale.Load() && s.Tick() >= s.Due() {
			err := s.loadStale(ctx)
			if ctx.Err() != nil {
				return nil
			}
			ran(err)
		}
		for s.Tick() < s.Due() {
			err := s.step(ctx)
			if err != nil && ctx.Err() != nil {
				return nil
			}
			if !ran(err) {
				break
			}
		}
		s.daily(ctx)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(backoff(s.cfg.Poll, failures)):
		}
	}
}

// backoff is the wait before the next try after failures in a row.
func backoff(poll time.Duration, failures int) time.Duration {
	d := poll
	for range failures {
		if d >= maxBackoff/2 {
			return max(poll, maxBackoff)
		}
		d *= 2
	}
	return d
}

func (s *Server) failed(err error, failures int) {
	s.cfg.Log.Error("tick failed", "err", err.Error(), "failures", failures)
	if failures == stallAfter {
		s.stalled.Store(true)
		s.cfg.Log.Error("WORLD STALLED: ticks keep failing", "world", s.cfg.World, "tick", s.Tick(), "due", s.Due())
		s.capture("mmo_stall", s.cfg.World, map[string]any{"tick": s.Tick(), "due": s.Due(), "failures": failures})
	}
}

var errLockLost = errors.New("service: lost the world's lock; another service may hold the world")

// holdsLock checks that the world's lock is still held.
func (s *Server) holdsLock(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	ok, err := s.lock.Held(ctx)
	if err != nil {
		return errors.Join(errLockLost, err)
	}
	if !ok {
		return errLockLost
	}
	return nil
}

// step runs and saves one tick.
func (s *Server) step(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.usable(ctx); err != nil {
		return err
	}
	if s.epoch != nil && s.atBoundary() {
		if err := s.takeEpoch(ctx); err != nil {
			return err
		}
	}
	start := time.Now()
	facts, err := s.g.Advance()
	if err != nil {
		return s.reload(ctx, err)
	}
	ms := time.Since(start).Milliseconds()
	saved, err := s.st.SaveTick(ctx, s.g, ms, s.cfg.Now())
	if err != nil {
		return s.reload(ctx, err)
	}
	t := s.g.Tick()
	s.ended.note(facts, t)
	// The epoch is taken before the tick shows, so nothing reads the new
	// season on the old rules; a failure is retried before the next tick.
	if s.epoch != nil && closes(facts) {
		err = s.takeEpoch(ctx)
	}
	s.tick.Store(t)
	s.subs.tell(nil)
	if err != nil {
		return err
	}
	s.cfg.Log.Debug("tick", "world", s.cfg.World, "tick", t, "facts", len(facts), "ms", ms)
	s.capture("mmo_tick", s.cfg.World, map[string]any{"tick": t, "facts": saved.Facts, "ms": ms, "behind": s.Due() - t})
	return nil
}

// errClosed and errStale are why the held game may not be used.
var (
	errClosed = errors.New("service: the world is closed")
	errStale  = errors.New("service: the world does not load")
)

// usable reports, under mu, why the held game may not be used: the world
// is closing, or it went stale and still does not load.
func (s *Server) usable(ctx context.Context) error {
	if s.closed {
		return errClosed
	}
	if s.stale.Load() {
		g, err := s.st.Load(ctx, s.rules.Load())
		if err != nil {
			return fmt.Errorf("%w: %w", errStale, err)
		}
		s.restore(g)
		s.cfg.Log.Info("world loaded again", "world", s.cfg.World, "tick", g.Tick())
	}
	return nil
}

// loadStale tries, under mu, to load a stale world again.
func (s *Server) loadStale(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.usable(ctx)
}

// take locks the world for a caller, or reports why it may not: the world
// is closing or, when the caller needs the game, stale and still not
// loading.
func (s *Server) take(ctx context.Context, needGame bool) (unlock func(), err error) {
	s.mu.Lock()
	err = errClosed
	if needGame {
		err = s.usable(ctx)
	} else if !s.closed {
		err = nil
	}
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	return s.mu.Unlock, nil
}

// reload restores the game from the store after a failed tick or action:
// what is stored is the truth. If the store cannot be read, the world goes
// stale until it can.
func (s *Server) reload(ctx context.Context, cause error) error {
	g, err := s.st.Load(ctx, s.rules.Load())
	if err != nil {
		s.stale.Store(true)
		return errors.Join(cause, err)
	}
	s.restore(g)
	return cause
}

func (s *Server) restore(g *game.Game) {
	s.g = g
	s.tick.Store(g.Tick())
	s.stale.Store(false)
	s.subs.tell(nil)
}

// structural: the conservation check runs once a day of wall time.
const auditEvery = 24 * time.Hour

// daily makes the coming fact partitions and runs the conservation check.
func (s *Server) daily(ctx context.Context) {
	now := s.cfg.Now()
	if !s.audit.IsZero() && now.Sub(s.audit) < auditEvery {
		return
	}
	s.audit = now
	if err := s.st.EnsurePartitions(ctx, now); err != nil {
		s.cfg.Log.Error("fact partitions", "err", err.Error())
	}
	bad, err := s.Audit(ctx)
	if err != nil {
		s.cfg.Log.Error("conservation check failed to run", "err", err.Error())
		return
	}
	if len(bad) > 0 {
		s.cfg.Log.Error("conservation check found discrepancies", "count", len(bad), "first", bad[0])
	} else {
		s.cfg.Log.Info("conservation check holds", "world", s.cfg.World)
	}
	s.capture("mmo_conservation", s.cfg.World, map[string]any{"discrepancies": len(bad)})
}

// Audit is the conservation check over memory and the store: the ledger
// against what characters hold, both as the service holds them and as
// they are stored.
func (s *Server) Audit(ctx context.Context) ([]string, error) {
	unlock, err := s.take(ctx, true)
	if err != nil {
		return nil, err
	}
	bad := ledger.Audit(s.g.Ledger.Balances, s.g.Holdings())
	unlock()
	stored, err := s.st.Audit(ctx)
	return append(bad, stored...), err
}
