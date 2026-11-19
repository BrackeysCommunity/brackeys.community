// Package service is the world service: the only writer of game state and
// the only holder of the keys. It holds a world under an advisory lock,
// runs its tick loop and serves the API in package api.
package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
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
	Poll       time.Duration
	Now        func() time.Time
	Log        *slog.Logger
	// Events receives product events; nil sends none.
	Events Capturer
}

// Capturer takes product events.
type Capturer interface {
	Capture(name, distinct string, props map[string]any)
}

// Server is one world, held.
type Server struct {
	cfg   Config
	st    *store.Store
	rules *game.Rules
	lock  *store.Lock
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
	rules, err := game.NewRules(cfg.Book, cfg.Keys)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, st: store.New(pool, cfg.World), rules: rules}
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
	s.g, err = s.st.Load(ctx, s.rules)
	return err
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
	g, err := game.New(s.rules)
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
	g, err = s.st.Load(ctx, s.rules)
	if err != nil {
		return err
	}
	s.restore(g)
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
	s.tick.Store(t)
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
		g, err := s.st.Load(ctx, s.rules)
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
	g, err := s.st.Load(ctx, s.rules)
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
