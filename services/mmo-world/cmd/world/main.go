// Command world is the world service: the only writer of game state and
// the only holder of the keys. It derives the keys from the master secret
// in its environment, checks that no key is in the database or can reach
// its logs, holds its world, runs the tick loop and serves the API.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sheetfs"
)

const (
	envTickSeconds = "MMO_TICK_SECONDS"
	envPort        = "PORT"
	envAPIToken    = "MMO_API_TOKEN"
	envOpToken     = "MMO_OPERATOR_TOKEN"
	envPosthogKey  = "POSTHOG_KEY"
	envPosthogHost = "POSTHOG_HOST"
	envManualClock = "MMO_MANUAL_CLOCK" // tests only: the due tick is set through the operator API
	envPollMS      = "MMO_POLL_MS"
	envLogLevel    = "LOG_LEVEL"
)

func main() {
	guard := service.NewGuard(os.Stdout)
	var level slog.Level
	if err := level.UnmarshalText([]byte(os.Getenv(envLogLevel))); err != nil {
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
	tickSeconds, err := service.Number(envTickSeconds, "600")
	if err != nil {
		return err
	}
	pollMS, err := service.Number(envPollMS, "1000")
	if err != nil {
		return err
	}
	book, err := sheetfs.LoadBook(service.Getenv(service.EnvSheets, "."))
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	pool, err := pgxpool.New(ctx, os.Getenv(service.EnvDatabase))
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := service.CheckKeys(ctx, pool, sec.Needles); err != nil {
		return err
	}
	log.Info("key check holds: no key in the database, the log guard is armed", "world", sec.World)

	events := service.NewEvents(service.Getenv(envPosthogHost, "https://us.i.posthog.com"), os.Getenv(envPosthogKey), log)
	defer events.Close()
	var handler atomic.Pointer[http.Handler]
	standby := service.Standby(sec.World)
	handler.Store(&standby)
	httpSrv := &http.Server{Addr: ":" + service.Getenv(envPort, "8080"), ReadHeaderTimeout: 10 * time.Second,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { (*handler.Load()).ServeHTTP(w, r) })}
	go func() {
		<-ctx.Done()
		shut, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shut)
	}()
	go func() {
		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http server", "err", err.Error())
			stop()
		}
	}()
	srv, err := service.Open(ctx, pool, service.Config{World: sec.World, KeyVersion: int32(sec.KeyVersion), RollEpoch: sec.Epoch,
		TickSeconds: int32(tickSeconds), Book: book, Keys: sec.Keys, APIToken: os.Getenv(envAPIToken), OperatorToken: os.Getenv(envOpToken),
		ManualClock: os.Getenv(envManualClock) == "1", Poll: time.Duration(pollMS) * time.Millisecond, Log: log, Events: events})
	if err != nil {
		return err
	}
	defer srv.Close(context.Background())
	served := srv.Handler()
	handler.Store(&served)
	log.Info("world service up", "world", sec.World, "tick", srv.Tick(), "due", srv.Due(), "addr", httpSrv.Addr)
	return srv.Run(ctx)
}
