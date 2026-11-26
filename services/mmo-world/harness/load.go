package harness

import (
	"context"
	"fmt"
	"maps"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/internal/envvar"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/sheets"
)

// The load run (GDD 18.3): scripted characters press a live world's
// buttons over HTTP at a fixed rate, each press an options read and the
// action an agent policy chooses, while the run reads what every tick of
// the window cost from the operator's tick ring. It holds when every tick
// finished inside one tick and the world never fell behind.

func init() { Runs["load"] = LoadRun }

// Env names of the load run.
const (
	EnvLoadURL     = "LOAD_URL"
	EnvLoadPPM     = "LOAD_PPM"
	EnvLoadMinutes = "LOAD_MINUTES"
	EnvLoadServers = "LOAD_SERVERS"
	EnvLoadRamp    = "LOAD_RAMP"
)

// structural: the load run's shape. The rate is ten times the closed
// test's provisional peak (20 players, 30 presses a minute each).
const (
	loadCharacters = 200
	loadPPM        = 6000
	loadMinutes    = 30
	loadServers    = 2
	loadMaxServers = 26 // servers are named load-a to load-z
	loadMaxPPM     = 10_000_000
	loadMaxMinutes = 24 * 60
	loadWorkers    = 32
	loadPoll       = 30 * time.Second
	// loadQuantum is how often the bucket fills; loadBurst is how many
	// seconds of presses it holds while no worker is free, so a client that
	// cannot keep up delivers less, not later.
	loadQuantum = 10 * time.Millisecond
	loadBurst   = 1
	// loadDeliver is the share of the asked rate, in per cent, the client
	// must deliver for the window to count.
	loadDeliver = 95
	// loadBehind is how many ticks the world may be due beyond its own.
	loadBehind = 1
	// loadProductionSecs is production's tick, which the longest step is
	// also read against.
	loadProductionSecs = 600
	// The ramp doubles the rate for loadStage each, at most loadStages
	// times, after the window.
	loadStage  = 2 * time.Minute
	loadStages = 8
	loadP95    = 0.95
	loadTarget = "load-tick-inside"
	perMinute  = 60
)

// loadStarts are what new characters choose to carry, in turn.
var loadStarts = []string{api.StartHook, api.StartKnife, api.StartDeck}

// loadConfig is one load run's shape.
type loadConfig struct {
	ppm             int64
	window          time.Duration
	chars, servers  int
	workers         int
	poll            time.Duration
	ramp            bool
	stage           time.Duration
	stages          int
	tokenAPI, opTok string
}

// loadConfigFromEnv reads the run's switches; n names the characters.
func loadConfigFromEnv(n int) (loadConfig, error) {
	c := loadConfig{chars: n, workers: loadWorkers, poll: loadPoll, stage: loadStage, stages: loadStages,
		tokenAPI: service.TokenFromEnv(service.EnvAPIToken), opTok: service.TokenFromEnv(service.EnvOperatorToken)}
	if c.chars <= 0 {
		c.chars = loadCharacters
	}
	var err error
	if c.ppm, err = envvar.Number(EnvLoadPPM, strconv.Itoa(loadPPM), 1, loadMaxPPM); err != nil {
		return c, err
	}
	servers, err := envvar.Number(EnvLoadServers, strconv.Itoa(loadServers), 1, loadMaxServers)
	if err != nil {
		return c, err
	}
	c.servers = int(servers)
	mins, err := strconv.ParseFloat(envvar.Get(EnvLoadMinutes, strconv.Itoa(loadMinutes)), 64)
	if err != nil || mins <= 0 || mins > loadMaxMinutes {
		return c, fmt.Errorf("%s must be a number of minutes above 0 and at most %d", EnvLoadMinutes, loadMaxMinutes)
	}
	c.window = time.Duration(mins * float64(time.Minute))
	switch v := os.Getenv(EnvLoadRamp); v {
	case "", "0":
	case "1":
		c.ramp = true
	default:
		return c, fmt.Errorf("%s must be 1 or unset, not %q", EnvLoadRamp, v)
	}
	return c, nil
}

// LoadRun loads the live world at LOAD_URL (else MMO_URL) for the window
// and writes load.md.
func LoadRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	base := envvar.Get(EnvLoadURL, os.Getenv(service.EnvURL))
	if base == "" {
		return nil, fmt.Errorf("the load run needs the world's URL: set %s or %s", EnvLoadURL, service.EnvURL)
	}
	cfg, err := loadConfigFromEnv(n)
	if err != nil {
		return nil, err
	}
	res, err := runLoad(context.Background(), b, base, cfg)
	if err != nil {
		return nil, err
	}
	m := loadReading(cfg, res.window)
	fmt.Fprintf(os.Stderr, "load: %s\n", m.Value)
	for _, s := range res.ramp {
		fmt.Fprintf(os.Stderr, "load ramp: %s\n", rampLine(cfg, s))
	}
	if err := loadDoc(base, cfg, res, m).save(out, "load.md"); err != nil {
		return nil, err
	}
	return []Measured{m}, nil
}

// loadChar is one scripted character and its presses so far; busy is set
// while a press of it is in flight.
type loadChar struct {
	p    *agent.Player
	seq  int64
	busy atomic.Bool
}

// loadWorld is a world the run presses: players' calls through api, the
// tick ring and health through op.
type loadWorld struct {
	api, op *client.HTTP
	run     string
	chars   []*loadChar
}

// loadPhase is one stretch at one rate and what it cost the world.
type loadPhase struct {
	ppm      int64
	took     time.Duration
	presses  int64 // presses completed: options read, then the chosen action or the policy's wait
	acted    int64 // presses whose action the world applied
	refused  int64
	failed   int64 // presses lost in transport, not counted as delivered
	lastErr  error
	latency  []time.Duration // sorted
	tickMs   int64
	ticks    []api.TickTime
	behind   int64 // the most the world was behind, from the ticks and the health reads
	startAt  int64 // the world's tick when the phase began
	gaps     int64 // ticks in the window the ring no longer held
	creates  int
	byServer map[string]int
	byPolicy map[string]*policyPresses
}

// policyPresses are one policy's completed presses and what came of them.
type policyPresses struct{ presses, acted, refused int64 }

// delivered is the rate the client reached, in presses a minute.
func (p loadPhase) delivered() int64 {
	if p.took <= 0 {
		return 0
	}
	return int64(float64(p.presses) * float64(time.Minute) / float64(p.took))
}

// reached reports whether the client delivered enough of the asked rate.
func (p loadPhase) reached() bool { return p.delivered()*hundredPct >= p.ppm*loadDeliver }

// longest is the window's slowest tick.
func (p loadPhase) longest() api.TickTime {
	var worst api.TickTime
	for _, t := range p.ticks {
		if t.StepMs > worst.StepMs {
			worst = t
		}
	}
	return worst
}

// inside reports whether every tick of the window finished inside one
// tick and the world never fell behind.
func (p loadPhase) inside() bool {
	return len(p.ticks) > 0 && p.tickMs > 0 && p.longest().StepMs < p.tickMs && p.behind <= loadBehind
}

func (p loadPhase) p95() time.Duration { return q(p.latency, loadP95) }

// loadResult is the window and the ramp's stages after it.
type loadResult struct {
	window  loadPhase
	ramp    []loadPhase
	world   string
	players []*agent.Player
}

// runLoad makes the characters and presses the world for the window,
// then ramps when asked.
func runLoad(ctx context.Context, b *sheets.Book, base string, cfg loadConfig) (loadResult, error) {
	var res loadResult
	if cfg.chars <= 0 || cfg.servers <= 0 || cfg.workers <= 0 || cfg.ppm <= 0 || cfg.window <= 0 {
		return res, fmt.Errorf("a load run needs characters, servers, workers, a rate and a window: %+v", cfg)
	}
	w := &loadWorld{api: loadClient(base, cfg.tokenAPI, cfg.workers), op: loadClient(base, cfg.opTok, 1),
		run: strconv.FormatInt(time.Now().UnixNano(), 36)}
	hl, err := w.op.Health(ctx)
	if err != nil {
		return res, err
	}
	if hl.Standby || hl.Stalled {
		return res, fmt.Errorf("the world at %s is not ticking (standby %v, stalled %v)", base, hl.Standby, hl.Stalled)
	}
	res.world = hl.World
	if _, err := w.op.TickTimes(ctx, hl.Tick); err != nil {
		return res, fmt.Errorf("the load run reads %s with the operator's token: %w", api.PathOperatorTicks, err)
	}
	by, err := w.create(ctx, b, cfg)
	if err != nil {
		return res, err
	}
	if res.window, err = w.phase(ctx, cfg, cfg.ppm, cfg.window); err != nil {
		return res, err
	}
	res.window.creates, res.window.byServer = len(w.chars), by
	for _, c := range w.chars {
		res.players = append(res.players, c.p)
	}
	if !cfg.ramp {
		return res, nil
	}
	for k := 1; k <= cfg.stages; k++ {
		s, err := w.phase(ctx, cfg, cfg.ppm<<k, cfg.stage)
		if err != nil {
			return res, err
		}
		res.ramp = append(res.ramp, s)
		if !s.reached() || !s.inside() {
			break
		}
	}
	return res, nil
}

// loadClient is a client keeping enough connections open for every
// worker, so the presses do not run the machine out of ports.
func loadClient(base, token string, conns int) *client.HTTP {
	c := client.New(base, token)
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.MaxIdleConns, tr.MaxIdleConnsPerHost = 2*conns, 2*conns
	c.C.Transport = tr
	return c
}

// serverName is the k-th load server.
func serverName(k int) string { return "load-" + string(rune('a'+k)) }

// loadPolicies are the agent policies the characters play in turn: the
// Economy run's earners, a bold wanderer and a traveller.
func loadPolicies(b *sheets.Book) []agent.Policy {
	bands := agent.Bands(b)
	var out []agent.Policy
	for _, ro := range economyRoles {
		if ro.name == agent.Casual {
			continue // waits days between sessions, which presses nothing
		}
		out = append(out, &agent.Earner{Role: ro.name, BandOrder: bands, Comfort: ro.comfort})
	}
	return append(out, agent.Wanderer{BandOrder: bands, Bold: true}, &agent.Traveller{})
}

// create makes the run's characters, the servers and the starts in turn,
// and counts them by server.
func (w *loadWorld) create(ctx context.Context, b *sheets.Book, cfg loadConfig) (map[string]int, error) {
	policies := loadPolicies(b)
	w.chars = make([]*loadChar, cfg.chars)
	for i := range w.chars {
		w.chars[i] = &loadChar{p: &agent.Player{Discord: fmt.Sprintf("load-%s-%d", w.run, i), Start: loadStarts[i%len(loadStarts)],
			Server: serverName(i % cfg.servers), Policy: policies[i%len(policies)]}}
	}
	jobs := make(chan *loadChar)
	errs := make(chan error, cfg.workers)
	var wg sync.WaitGroup
	for range min(cfg.workers, cfg.chars) {
		wg.Go(func() {
			for c := range jobs {
				p := c.p
				rep, ref, err := w.api.Act(ctx, api.ActionRequest{InteractionID: p.Discord + "-new", Kind: api.ActCreate, DiscordID: p.Discord,
					Option: p.Start, Server: p.Server})
				if err == nil {
					err = client.Refused("creating "+p.Discord, ref, nil)
				}
				if err != nil {
					errs <- err
					return
				}
				p.Character = rep.Character.ID
			}
		})
	}
	var first error
	for _, c := range w.chars {
		select {
		case jobs <- c:
			continue
		case first = <-errs:
		}
		break
	}
	close(jobs)
	wg.Wait()
	if first == nil && len(errs) > 0 {
		first = <-errs
	}
	if first != nil {
		return nil, first
	}
	by := map[string]int{}
	for _, c := range w.chars {
		by[c.p.Server]++
	}
	return by, nil
}

// pressStats is what one worker saw.
type pressStats struct {
	presses, acted, refused, failed int64
	lastErr                         error
	latency                         []time.Duration
	byPolicy                        map[string]*policyPresses
}

// phase presses the world at ppm for d: a token bucket releases ppm/60
// presses a second to the characters round-robin, one in flight a
// character, to free workers only; the tick ring is read every poll and
// at the end.
func (w *loadWorld) phase(ctx context.Context, cfg loadConfig, ppm int64, d time.Duration) (loadPhase, error) {
	ph := loadPhase{ppm: ppm, byPolicy: map[string]*policyPresses{}}
	hl, err := w.op.Health(ctx)
	if err != nil {
		return ph, err
	}
	ph.startAt, ph.behind = hl.Tick, max(0, hl.Due-hl.Tick)
	jobs := make(chan *loadChar)
	stats := make([]pressStats, cfg.workers)
	var wg sync.WaitGroup
	for i := range stats {
		st := &stats[i]
		st.byPolicy = map[string]*policyPresses{}
		script := agent.NewScript(w.api, nil, "load-"+w.run)
		wg.Go(func() {
			for c := range jobs {
				c.seq++
				p := c.p
				acted, refused := p.Actions, p.Refused
				t0 := time.Now()
				err := script.TurnFor(ctx, c.seq, []*agent.Player{p})
				took := time.Since(t0)
				c.busy.Store(false)
				if err != nil {
					st.failed++
					st.lastErr = err
					continue
				}
				st.presses++
				st.acted += int64(p.Actions - acted)
				st.refused += int64(p.Refused - refused)
				st.latency = append(st.latency, took)
				pp := st.byPolicy[p.Policy.Name()]
				if pp == nil {
					pp = &policyPresses{}
					st.byPolicy[p.Policy.Name()] = pp
				}
				pp.presses++
				pp.acted += int64(p.Actions - acted)
				pp.refused += int64(p.Refused - refused)
			}
		})
	}
	watch, stopWatch := context.WithCancel(ctx)
	watched := make(chan error, 1)
	go func() { watched <- w.watch(watch, cfg.poll, &ph) }()

	begin := time.Now()
	w.release(ctx, jobs, ppm, d)
	ph.took = time.Since(begin)
	close(jobs)
	wg.Wait()
	stopWatch()
	if err := <-watched; err != nil {
		return ph, err
	}
	if err := w.readTicks(ctx, &ph); err != nil {
		return ph, err
	}
	for _, st := range stats {
		ph.presses += st.presses
		ph.acted += st.acted
		ph.refused += st.refused
		ph.failed += st.failed
		ph.lastErr = cmpErr(ph.lastErr, st.lastErr)
		ph.latency = append(ph.latency, st.latency...)
		for name, pp := range st.byPolicy {
			all := ph.byPolicy[name]
			if all == nil {
				all = &policyPresses{}
				ph.byPolicy[name] = all
			}
			all.presses += pp.presses
			all.acted += pp.acted
			all.refused += pp.refused
		}
	}
	slices.Sort(ph.latency)
	if ph.presses == 0 && ph.failed > 0 {
		return ph, fmt.Errorf("every press failed: %w", ph.lastErr)
	}
	return ph, nil
}

func cmpErr(a, b error) error {
	if b != nil {
		return b
	}
	return a
}

// release is the token bucket: until d has passed it hands a free
// character to a free worker for each press due, and holds at most
// loadBurst seconds of presses no worker could take.
func (w *loadWorld) release(ctx context.Context, jobs chan<- *loadChar, ppm int64, d time.Duration) {
	perSec := float64(ppm) / perMinute
	burst := max(1, perSec*loadBurst)
	tick := time.NewTicker(loadQuantum)
	defer tick.Stop()
	start := time.Now()
	last, tokens, next := start, 0.0, 0
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			if now.Sub(start) >= d {
				return
			}
			tokens = min(burst, tokens+perSec*now.Sub(last).Seconds())
			last = now
			for tokens >= 1 {
				c := w.free(&next)
				if c == nil {
					break
				}
				c.busy.Store(true)
				sent := false
				select {
				case jobs <- c:
					sent = true
				default:
				}
				if !sent {
					c.busy.Store(false)
					break
				}
				tokens--
			}
		}
	}
}

// free is the next character round-robin from next with no press in
// flight, or nil when every one has.
func (w *loadWorld) free(next *int) *loadChar {
	for range w.chars {
		c := w.chars[*next]
		*next = (*next + 1) % len(w.chars)
		if !c.busy.Load() {
			return c
		}
	}
	return nil
}

// watch reads the tick ring and the world's health every poll until ctx
// ends.
func (w *loadWorld) watch(ctx context.Context, poll time.Duration, ph *loadPhase) error {
	t := time.NewTicker(poll)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			if err := w.readTicks(ctx, ph); err != nil && ctx.Err() == nil {
				return err
			}
		}
	}
}

// readTicks adds the ticks the ring holds after the last one read, and
// how far behind the world is now.
func (w *loadWorld) readTicks(ctx context.Context, ph *loadPhase) error {
	after := ph.startAt
	if len(ph.ticks) > 0 {
		after = ph.ticks[len(ph.ticks)-1].Tick
	}
	tt, err := w.op.TickTimes(ctx, after)
	if err != nil {
		return err
	}
	hl, err := w.op.Health(ctx)
	if err != nil {
		return err
	}
	ph.tickMs = tt.TickMs
	ph.behind = max(ph.behind, hl.Due-hl.Tick)
	for _, t := range tt.Ticks {
		if t.Tick <= after {
			continue
		}
		ph.gaps += max(0, t.Tick-after-1)
		ph.ticks = append(ph.ticks, t)
		ph.behind = max(ph.behind, t.Behind)
		after = t.Tick
	}
	return nil
}

// loadReading is the window's load-tick-inside reading.
func loadReading(cfg loadConfig, p loadPhase) Measured {
	if !p.reached() {
		return notMeasured(loadTarget, fmt.Sprintf("not measured: the client reached only %s a minute of the %s asked (%d characters, %d workers, %s failed)",
			comma(p.delivered()), comma(p.ppm), cfg.chars, cfg.workers, comma(p.failed)))
	}
	worst := p.longest()
	v := fmt.Sprintf("%s presses a minute asked, %s delivered, for %s from %d characters on %d servers (%s acted, %s refused, %s failed); %s ticks, the longest step %s against the %s tick and %.2f%% of production's %d s, at most %d behind; press p95 %s",
		comma(p.ppm), comma(p.delivered()), p.took.Round(time.Second), cfg.chars, cfg.servers, comma(p.acted), comma(p.refused), comma(p.failed),
		comma(int64(len(p.ticks))), msText(worst.StepMs), msText(p.tickMs), ofProduction(worst.StepMs),
		loadProductionSecs, p.behind, millis(p.p95()))
	if len(p.ticks) == 0 {
		v += "; **no tick ran in the window**"
	}
	if p.gaps > 0 {
		v += fmt.Sprintf("; %d ticks the ring no longer held", p.gaps)
	}
	return Measured{Target: loadTarget, Value: v, Holds: p.inside() && p.gaps == 0}
}

// ofProduction is a step in per cent of production's tick.
func ofProduction(ms int64) float64 {
	return float64(hundredPct*ms) / float64((loadProductionSecs * time.Second).Milliseconds())
}

func msText(ms int64) string { return comma(ms) + " ms" }

// rampLine is one ramp stage as the report's info line shows it.
func rampLine(cfg loadConfig, s loadPhase) string {
	worst := s.longest()
	verdict := "held"
	switch {
	case !s.reached():
		verdict = fmt.Sprintf("the client reached only %s a minute", comma(s.delivered()))
	case !s.inside():
		verdict = fmt.Sprintf("**a tick overran** (step %s against %s, %d behind)", msText(worst.StepMs), msText(s.tickMs), s.behind)
	}
	return fmt.Sprintf("%s a minute for %s: %s; %d ticks, the longest step %s, press p95 %s", comma(s.ppm), s.took.Round(time.Second), verdict,
		len(s.ticks), msText(worst.StepMs), millis(s.p95()))
}

// loadDoc is the load run's report.
func loadDoc(base string, cfg loadConfig, r loadResult, m Measured) *lineDoc {
	var doc lineDoc
	p := doc.p
	w := r.window
	p("# Load run")
	p("")
	p("World `%s` at %s. %d characters (Discord ids `load-<run>-<i>`) across %d servers (`load-a` on), carrying %s in turn, play the agent policies (the Economy run's earners less the casual, a bold wanderer, a traveller) over HTTP. A token bucket releases %s presses a minute round-robin, one in flight a character, to at most %d workers; each press reads the character's options, then sends the action its policy chooses, or nothing when it waits. The run reads `GET %s` every %s and at the end.",
		r.world, base, cfg.chars, cfg.servers, strings.Join(loadStarts, ", "), comma(cfg.ppm), cfg.workers, api.PathOperatorTicks, cfg.poll)
	p("")
	p("It holds when every tick of the window has its whole step (lock wait, Advance, the save and the map pass) under the world's tick, the world is never more than %d tick behind, and the client delivered at least %d%% of the rate; otherwise it is not measured.", loadBehind, loadDeliver)
	p("")
	p("| Reading | Value |")
	p("| --- | --- |")
	p("| Window | %s, ticks %d to %d |", w.took.Round(time.Second), w.startAt, lastTick(w))
	p("| Characters by server | %s |", byServer(w.byServer))
	p("| Presses a minute, asked and delivered | %s, %s |", comma(w.ppm), comma(w.delivered()))
	p("| Presses: completed, acted, refused, failed | %s, %s, %s, %s |", comma(w.presses), comma(w.acted), comma(w.refused), comma(w.failed))
	p("| Press p50, p95, max | %s, %s, %s |", millis(q(w.latency, 0.5)), millis(w.p95()), millis(q(w.latency, 1)))
	p("| Presses by policy: completed, acted, refused | %s |", byPolicy(w.byPolicy))
	p("| Ticks read, missing from the ring | %d, %d |", len(w.ticks), w.gaps)
	p("| Longest step, against the tick | %s (tick %d), %s |", msText(w.longest().StepMs), w.longest().Tick, msText(w.tickMs))
	p("| Longest step against production's %d s | %.2f%% |", loadProductionSecs, ofProduction(w.longest().StepMs))
	p("| Step p50, p95 | %s, %s |", msText(stepQ(w.ticks, 0.5)), msText(stepQ(w.ticks, loadP95)))
	p("| Most behind | %d |", w.behind)
	if w.lastErr != nil {
		p("| Last failure | %s |", strings.ReplaceAll(w.lastErr.Error(), "|", "/"))
	}
	p("")
	p("**%s**: %s", either(strings.HasPrefix(m.Value, unmeasured), "not measured", holds(m.Holds)), m.Value)
	if cfg.ramp {
		p("")
		var lines []string
		for _, s := range r.ramp {
			lines = append(lines, rampLine(cfg, s))
		}
		p("Ramp, for information (the rate doubled every %s after the window until a tick overran or the client could not keep up): %s.", cfg.stage,
			cmpText(strings.Join(lines, "; then "), "no stage ran"))
	}
	return &doc
}

func cmpText(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func lastTick(p loadPhase) int64 {
	if len(p.ticks) == 0 {
		return p.startAt
	}
	return p.ticks[len(p.ticks)-1].Tick
}

func stepQ(ticks []api.TickTime, f float64) int64 {
	steps := make([]int64, len(ticks))
	for i, t := range ticks {
		steps[i] = t.StepMs
	}
	slices.Sort(steps)
	return q(steps, f)
}

func byPolicy(by map[string]*policyPresses) string {
	var out []string
	for _, name := range slices.Sorted(maps.Keys(by)) {
		pp := by[name]
		out = append(out, fmt.Sprintf("%s %s, %s, %s", name, comma(pp.presses), comma(pp.acted), comma(pp.refused)))
	}
	return strings.Join(out, "; ")
}

func byServer(by map[string]int) string {
	var out []string
	for _, s := range slices.Sorted(maps.Keys(by)) {
		out = append(out, fmt.Sprintf("%s %d", s, by[s]))
	}
	return strings.Join(out, ", ")
}
