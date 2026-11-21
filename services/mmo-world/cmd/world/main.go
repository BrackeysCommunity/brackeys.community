// Command world is the world service: the only writer of game state and
// the only holder of the keys. It derives the keys from the master secret
// in its environment, checks that no key is in the database or can reach
// its logs, holds its world, runs the tick loop and serves the API. With
// an Activity port set it also serves the Activity, on a listener of its
// own: that one is public, and carries none of the API's paths.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"jams.team/mmo-world/gateway"
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
	// Discord's client secret is guarded like a key: out of the logs and
	// out of the database.
	appID, clientSecret := os.Getenv(gateway.EnvAppID), os.Getenv(gateway.EnvClientSecret)
	_ = os.Unsetenv(gateway.EnvClientSecret)
	needles := sec.Needles
	if clientSecret != "" {
		needles = append(needles[:len(needles):len(needles)], clientSecret, url.QueryEscape(clientSecret))
	}
	guard.Arm(needles)
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
	activityPort := os.Getenv(gateway.EnvPort)
	if activityPort != "" {
		if _, err := service.Number(gateway.EnvPort, "", 1, math.MaxUint16); err != nil {
			return err
		}
		if activityPort == service.Getenv(service.EnvPort, "8080") {
			return fmt.Errorf("%s must not be the API's %s: the Activity's listener is public", gateway.EnvPort, service.EnvPort)
		}
		if (appID == "" || clientSecret == "") && !manual && !disposable {
			return fmt.Errorf("%s needs %s and %s on a world players keep", gateway.EnvPort, gateway.EnvAppID, gateway.EnvClientSecret)
		}
	}
	dev := os.Getenv(gateway.EnvDev) == "1"
	if dev && !disposable {
		log.Warn(gateway.EnvDev + " is ignored: only a disposable world signs in without Discord")
		dev = false
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
	standby := service.Standby(sec.World)
	apiSrv, serveAPI := listen(service.Getenv(service.EnvPort, "8080"), limits{}, standby, log, stop)
	servers := []*http.Server{apiSrv}
	serveActivity := func(http.Handler) {}
	if activityPort != "" {
		var activitySrv *http.Server
		activitySrv, serveActivity = listen(activityPort, publicLimits, standby, log, stop)
		servers = append(servers, activitySrv)
	}
	shutdown := func() {
		shut, cancel := context.WithTimeout(context.Background(), shutdownWait)
		defer cancel()
		for _, srv := range servers {
			_ = srv.Shutdown(shut)
		}
	}
	// Standby answers health while the database is scanned, so a long scan
	// does not fail the deploy's health check.
	if err := service.CheckKeys(ctx, pool, needles); err != nil {
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
	var gw *gateway.Gateway
	if activityPort != "" {
		gw = gateway.New(gateway.Config{Host: srv, AppID: appID, ClientSecret: clientSecret, DiscordAPI: os.Getenv(gateway.EnvDiscordAPI),
			Dir: os.Getenv(gateway.EnvDir), Dev: dev, Log: log, Health: served, Events: events})
		if err := gw.Start(ctx); err != nil {
			shutdown()
			srv.Close(context.Background())
			return err
		}
		serveActivity(gw.Handler())
		if os.Getenv(gateway.EnvDir) == "" {
			log.Warn("no Activity build is served: no " + gateway.EnvDir)
		}
		log.Info("the Activity is served", "world", sec.World, "port", activityPort, "dev", dev)
	}
	serveAPI(served)
	log.Info("world service up", "world", sec.World, "tick", srv.Tick(), "due", srv.Due(), "addr", apiSrv.Addr)
	err = srv.Run(ctx)
	// A shutdown does not wait on a socket, so the Activity's are closed
	// first. Requests finish before the lock goes, so nothing writes once
	// another service may hold the world.
	if gw != nil {
		gw.Close()
	}
	shutdown()
	srv.Close(context.Background())
	return err
}

// limits bound how long a listener waits on a connection: for a whole
// request to arrive, and for the next one on a connection kept open. Zero
// is no bound.
type limits struct{ read, idle time.Duration }

// publicLimits are the Activity listener's: anyone can reach it, so a
// request that trickles in or a connection left idle is let go. A socket
// is not bound by them once it is accepted.
var publicLimits = limits{read: 15 * time.Second, idle: 2 * time.Minute}

// listen serves a port with a handler that can be swapped: standby until
// the world is held, then the real one. A listener that fails stops the
// service.
func listen(port string, lim limits, standby http.Handler, log *slog.Logger, stop func()) (*http.Server, func(http.Handler)) {
	var handler atomic.Pointer[http.Handler]
	handler.Store(&standby)
	srv := &http.Server{Addr: ":" + port, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: lim.read, IdleTimeout: lim.idle,
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { (*handler.Load()).ServeHTTP(w, r) })}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http server", "addr", srv.Addr, "err", err.Error())
			stop()
		}
	}()
	return srv, func(h http.Handler) { handler.Store(&h) }
}
