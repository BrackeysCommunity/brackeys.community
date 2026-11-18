// Package service is the world service: the only writer of game state and
// the only holder of the keys. It holds a world under an advisory lock,
// runs its tick loop (catching up on missed ticks by running them in
// order), and serves the internal HTTP API in package api.
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

// Config is what a world service runs with.
type Config struct {
	World       string
	KeyVersion  int32
	RollEpoch   int64
	TickSeconds int32
	Book        *sheets.Book
	Keys        keys.Set
	// APIToken guards /v1 for the bot and the site; OperatorToken guards
	// the operator paths. An empty APIToken leaves /v1 open (local runs).
	APIToken      string
	OperatorToken string
	// ManualClock makes the due tick whatever an operator last set, for
	// tests that must control time. Never on a deployed world.
	ManualClock bool
	Poll        time.Duration
	Now         func() time.Time
	Log         *slog.Logger
	Events      *Events
}

// Server is one world, held.
type Server struct {
	cfg   Config
	pool  *pgxpool.Pool
	st    *store.Store
	rules *game.Rules
	lock  *store.Lock
	mu    sync.Mutex
	g     *game.Game
	meta  store.Meta
	due   atomic.Int64 // the manual clock's due tick
	tick  atomic.Int64 // the world's tick, for readers that must not wait on a running tick
	ready atomic.Bool
	audit time.Time
}

// SheetsDigest names a book, so a world knows which sheets it runs on.
func SheetsDigest(b *sheets.Book) (string, error) {
	j, err := json.Marshal(b)
	if err != nil {
		return "", err
	}
	s := sha256.Sum256(j)
	return hex.EncodeToString(s[:]), nil
}

// Open takes the world's lock (waiting while another service holds it),
// then loads the world, or founds it if it has never run. A disposable
// world whose sheets changed is reset with the new ones.
func Open(ctx context.Context, pool *pgxpool.Pool, cfg Config) (*Server, error) {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	rules, err := game.NewRules(cfg.Book, cfg.Keys)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, pool: pool, st: store.New(pool, cfg.World), rules: rules}
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
	digest, err := SheetsDigest(s.cfg.Book)
	if err != nil {
		return err
	}
	m, _, err := s.st.Meta(ctx)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return s.found(ctx, digest)
	case err != nil:
		return err
	}
	if m.KeyCheck != s.cfg.Keys.Check() || m.KeyVersion != s.cfg.KeyVersion {
		return fmt.Errorf("service: world %s was founded under other keys (key version %d); refusing it", m.ID, m.KeyVersion)
	}
	if m.SheetsDigest != digest {
		if !m.Disposable {
			return fmt.Errorf("service: world %s runs on other sheets and is not disposable", m.ID)
		}
		s.cfg.Log.Warn("sheets changed; resetting the test world", "world", m.ID)
		if err := s.st.Reset(ctx); err != nil {
			return err
		}
		return s.found(ctx, digest)
	}
	s.meta = m
	s.g, err = s.st.Load(ctx, s.rules)
	return err
}

// found starts a world at tick 0, now.
func (s *Server) found(ctx context.Context, digest string) error {
	g, err := game.New(s.rules)
	if err != nil {
		return err
	}
	m := store.Meta{ID: s.cfg.World, KeyVersion: s.cfg.KeyVersion, KeyCheck: s.cfg.Keys.Check(), RulesEpoch: int32(s.cfg.RollEpoch),
		SheetsDigest: digest, StartedAt: s.cfg.Now(), TickSeconds: s.cfg.TickSeconds, Disposable: true}
	s.st = store.New(s.pool, s.cfg.World)
	if err := s.st.Create(ctx, m, g); err != nil {
		return err
	}
	s.cfg.Log.Info("world founded", "world", m.ID)
	s.meta = m
	s.g, err = s.st.Load(ctx, s.rules)
	return err
}

// Close gives up the world.
func (s *Server) Close(ctx context.Context) {
	s.ready.Store(false)
	s.lock.Release(ctx)
}

// Due is the tick that should have run by now.
func (s *Server) Due() int64 {
	if s.cfg.ManualClock {
		return s.due.Load()
	}
	return s.meta.DueTick(s.cfg.Now())
}

// Tick is the world's current tick, without waiting on a tick that is
// running.
func (s *Server) Tick() int64 { return s.tick.Load() }

// Run is the tick loop: it runs every tick that has fallen due, in order,
// one transaction each, until ctx ends. A service that was down catches
// up the same way, and determinism makes that the world it would have
// been.
func (s *Server) Run(ctx context.Context) error {
	s.ready.Store(true)
	for {
		for s.Tick() < s.Due() {
			if err := s.step(ctx); err != nil {
				if ctx.Err() != nil {
					return nil
				}
				s.cfg.Log.Error("tick failed", "err", err.Error())
				break
			}
		}
		s.daily(ctx)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(s.cfg.Poll):
		}
	}
}

// step runs and saves one tick.
func (s *Server) step(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	s.cfg.Events.Capture("mmo_tick", s.cfg.World, map[string]any{"tick": t, "facts": saved.Facts, "ms": ms, "behind": s.Due() - t})
	return nil
}

// reload restores the game from the store after a failed tick or action:
// what is stored is the truth.
func (s *Server) reload(ctx context.Context, cause error) error {
	g, err := s.st.Load(ctx, s.rules)
	if err != nil {
		return errors.Join(cause, err)
	}
	s.g = g
	s.tick.Store(g.Tick())
	return cause
}

// structural: the conservation check runs once a day of wall time.
const auditEvery = 24 * time.Hour

// daily runs the conservation check (GDD 10.9) and makes next month's
// fact partition, once a day.
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
	s.cfg.Events.Capture("mmo_conservation", s.cfg.World, map[string]any{"discrepancies": len(bad)})
}

// Audit is the conservation check over memory and the store: the ledger
// against what characters hold, both as the service holds them and as
// they are stored.
func (s *Server) Audit(ctx context.Context) ([]string, error) {
	s.mu.Lock()
	bad := ledger.Audit(s.g.Ledger.Balances, s.g.Holdings())
	s.mu.Unlock()
	stored, err := s.st.Audit(ctx)
	return append(bad, stored...), err
}

// Digest is the world's current digest.
func (s *Server) Digest() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, err := s.g.Digest()
	return d.String(), err
}
