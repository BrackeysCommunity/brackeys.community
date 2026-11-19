// Command world is the world service: the only writer of game state and
// the only holder of the keys. It derives the keys from the master secret
// in its environment, checks that no key is in the database or can reach
// its logs, holds its world, runs the tick loop and serves the API.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"jams.team/mmo-world/service"
)

// structural: how long in-flight requests get to finish at shutdown, and
// the slowest poll.
const (
	shutdownWait = 10 * time.Second
	maxPollMS    = 60_000
)

func main() {
	guard := service.NewGuard(os.Stdout)
	var level slog.Level
	if err := level.UnmarshalText([]byte(os.Getenv(service.EnvLogLevel))); err != nil {
		level = slog.LevelInfo
	}
	log := slog.New(slog.NewJSONHandler(guard, &slog.HandlerOptions{Level: level}))
	if err := run(guard, log); err != nil {
		log.Error("world service stopped", "err", err.Error())
		os.Exit(1)
	}
}

func run(guard *service.Guard, log *slog.Logger) error {
	sec, err := service.SecretsFromEnv()
	if err != nil {
		return err
	}
	guard.Arm(sec.Needles)
	tickSeconds, err := service.Number(service.EnvTickSeconds, "600", 1, math.MaxInt32)
	if err != nil {
		return err
	}
	pollMS, err := service.Number(service.EnvPollMS, "1000", 1, maxPollMS)
	if err != nil {
		return err
	}
	manual, disposable := os.Getenv(service.EnvManualClock) == "1", os.Getenv(service.EnvDisposable) == "1"
	apiToken := os.Getenv(service.EnvAPIToken)
	if apiToken == "" {
		if !manual && !disposable {
			return fmt.Errorf("%s must be set on a world players keep", service.EnvAPIToken)
		}
		log.Warn("the player API is open: no " + service.EnvAPIToken)
	}
	book, err := service.BookFromEnv()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	pool, err := service.PoolFromEnv(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	var handler atomic.Pointer[http.Handler]
	standby := service.Standby(sec.World)
	handler.Store(&standby)
	httpSrv := &http.Server{Addr: ":" + service.Getenv(service.EnvPort, "8080"), ReadHeaderTimeout: 10 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { (*handler.Load()).ServeHTTP(w, r) })}
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http server", "err", err.Error())
			stop()
		}
	}()
	shutdown := func() {
		shut, cancel := context.WithTimeout(context.Background(), shutdownWait)
		defer cancel()
		_ = httpSrv.Shutdown(shut)
	}
	// Standby answers health while the database is scanned, so a long scan
	// does not fail the deploy's health check.
	if err := service.CheckKeys(ctx, pool, sec.Needles); err != nil {
		shutdown()
		return err
	}
	log.Info("key check holds: no key in the database, the log guard is armed", "world", sec.World)

	events := service.NewEvents(service.Getenv(service.EnvPosthogHost, "https://us.i.posthog.com"), os.Getenv(service.EnvPosthogKey), log)
	defer events.Close()
	srv, err := service.Open(ctx, pool, service.Config{Secrets: sec,
		TickSeconds: int32(tickSeconds), Book: book, APIToken: apiToken, OperatorToken: os.Getenv(service.EnvOperatorToken),
		ManualClock: manual, Disposable: disposable,
		Poll: time.Duration(pollMS) * time.Millisecond, Log: log, Events: events})
	if err != nil {
		shutdown()
		return err
	}
	served := srv.Handler()
	handler.Store(&served)
	log.Info("world service up", "world", sec.World, "tick", srv.Tick(), "due", srv.Due(), "addr", httpSrv.Addr)
	err = srv.Run(ctx)
	// Requests finish before the lock goes, so nothing writes once another
	// service may hold the world.
	shutdown()
	srv.Close(context.Background())
	return err
}
