package harness

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
)

// SuiteRun is one label of the full suite: a run (a Runs name, or
// "check") at a size with its switches, and the watchdog cap it is
// killed at. Long labels start first; Alone ones run after the rest, one
// at a time, with nothing beside them; Soak ones run only with -soak and
// Live ones only with -live, against that world.
type SuiteRun struct {
	Label string
	Run   string
	N     int
	Env   map[string]string
	Cap   time.Duration
	Long  bool
	Alone bool
	Soak  bool
	Live  bool
}

// SuiteCheck is the suite's check label's run: harness check, not a Runs
// entry.
const SuiteCheck = "check"

// SuiteLoad is the run a live label reaches the world through (registered
// by the load run itself); the suite sets LoadURL for it.
const (
	SuiteLoad = "load"
	LoadURL   = "LOAD_URL"
)

// SwitchPrefixes are the env names that change what a run measures. The
// suite clears them from every label but its own, so a switch left set
// in the caller's shell never reaches a label that does not name it.
var SwitchPrefixes = []string{"BATTLE_", "ECONOMY_", "EMERGENCE_", "SEARCH_", "LOAD_", "SOAK_", "SPIKE_A_", "SPIKE_B_"}

// economySeeds are the Economy run's eight seeds: "" and 1 to 7.
const economySeeds = 8

// Suite is the only list of the harness's runs: every label `harness all`
// runs, in the order it starts them.
var Suite = suiteRuns()

func suiteRuns() []SuiteRun {
	const (
		quick = 30 * time.Minute
		hour  = time.Hour
		long  = 4 * time.Hour
		soak  = 8 * time.Hour
	)
	seed := func(s int) map[string]string {
		if s == 0 {
			return nil
		}
		return map[string]string{"ECONOMY_SEED": strconv.Itoa(s)}
	}
	out := []SuiteRun{
		{Label: "emergence", Run: "emergence", Cap: 6 * hour, Long: true},
		{Label: "economy-10000", Run: "economy", N: 10000, Cap: long, Long: true},
		{Label: "crime-10000", Run: "crime", N: 10000, Cap: long, Long: true},
		{Label: "terrain-1000", Run: "terrain", N: 1000, Cap: long, Long: true},
		{Label: "spike-e-1000", Run: "spike-e", N: 1000, Cap: long, Long: true},
		{Label: "soak-10000", Run: "soak", N: 10000, Cap: soak, Long: true, Soak: true},
		{Label: "soak-1000", Run: "soak", N: 1000, Cap: long, Long: true, Soak: true},
		{Label: SuiteCheck, Run: SuiteCheck, Cap: quick},
		{Label: "battle", Run: "battle", Cap: 2 * hour},
		{Label: "craft", Run: "craft", Cap: 2 * hour},
		{Label: "economy-1000", Run: "economy", N: 1000, Cap: 2 * hour},
	}
	// The unseeded key is Economy's first seed: economy-10, and soak-10-s0.
	out = append(out, SuiteRun{Label: "economy-10", Run: "economy", N: 10, Cap: quick})
	for s := 1; s < economySeeds; s++ {
		out = append(out, SuiteRun{Label: fmt.Sprintf("economy-10-s%d", s), Run: "economy", N: 10, Env: seed(s), Cap: quick})
	}
	out = append(out,
		SuiteRun{Label: "world", Run: "world", Cap: 2 * hour},
		SuiteRun{Label: "content-40", Run: "content", N: 40, Cap: 3 * hour},
		SuiteRun{Label: "search-1000", Run: "search", N: 1000, Cap: 3 * hour},
		SuiteRun{Label: "social", Run: "social", Cap: hour},
		SuiteRun{Label: "crime-10", Run: "crime", N: 10, Cap: quick},
		SuiteRun{Label: "crime-1000", Run: "crime", N: 1000, Cap: 2 * hour},
		SuiteRun{Label: "season", Run: "season", Cap: hour},
		SuiteRun{Label: "map-10", Run: "map", N: 10, Cap: hour},
		SuiteRun{Label: "puzzles", Run: "puzzles", Cap: hour},
		SuiteRun{Label: "replay", Run: "replay", Cap: hour},
		SuiteRun{Label: "spike-a", Run: "spike-a", Cap: hour},
		SuiteRun{Label: "spike-b", Run: "spike-b", Cap: hour},
	)
	for s := range economySeeds {
		out = append(out, SuiteRun{Label: fmt.Sprintf("soak-10-s%d", s), Run: "soak", N: 10, Env: seed(s), Cap: hour, Soak: true})
	}
	return append(out,
		SuiteRun{Label: "social-alone", Run: "social", Cap: hour, Alone: true},
		SuiteRun{Label: "world-alone", Run: "world", Cap: 2 * hour, Alone: true},
		SuiteRun{Label: "map-10-alone", Run: "map", N: 10, Cap: hour, Alone: true},
		SuiteRun{Label: "load", Run: SuiteLoad, Cap: 2 * hour, Alone: true, Live: true},
	)
}

// SelectSuite is the labels a suite runs: those only names, in the
// suite's order, else every label -soak and -live allow.
func SelectSuite(only []string, soak bool, live string) ([]SuiteRun, error) {
	var out []SuiteRun
	if len(only) > 0 {
		want := map[string]bool{}
		for _, l := range only {
			if !slices.ContainsFunc(Suite, func(s SuiteRun) bool { return s.Label == l }) {
				return nil, fmt.Errorf("no suite label %q: the labels are %s", l, strings.Join(suiteLabels(), ", "))
			}
			want[l] = true
		}
		for _, s := range Suite {
			if want[s.Label] {
				out = append(out, s)
			}
		}
	} else {
		for _, s := range Suite {
			if (!s.Soak || soak) && (!s.Live || live != "") {
				out = append(out, s)
			}
		}
	}
	for _, s := range out {
		if s.Live && live == "" {
			return nil, fmt.Errorf("%s plays a live world: give -live URL", s.Label)
		}
	}
	return out, nil
}

func suiteLabels() []string {
	out := make([]string, len(Suite))
	for i, s := range Suite {
		out[i] = s.Label
	}
	return out
}

// SuiteOptions are how a suite runs: where, through which binary, from
// which module root, how many labels at once, and the live world.
type SuiteOptions struct {
	Out    string
	Exe    string // the harness binary; the running one when empty
	Root   string // the module root every label runs in
	Jobs   int
	Live   string
	Commit string
	Env    []string  // the caller's environment; os.Environ() when nil
	Log    io.Writer // a line as each label starts and ends
}

// SuiteLabel is one label's run as suite.json keeps it.
type SuiteLabel struct {
	Label    string            `json:"label"`
	Run      string            `json:"run"`
	N        int               `json:"n,omitempty"`
	Env      map[string]string `json:"env,omitempty"`
	Alone    bool              `json:"alone,omitempty"`
	Exit     int               `json:"exit"`
	Secs     int64             `json:"secs"`
	Watchdog bool              `json:"watchdog,omitempty"` // killed at its cap
}

// SuiteResult is suite.json: the commit and book the suite ran at, and
// every label's exit and time.
type SuiteResult struct {
	Commit   string       `json:"commit"`
	Book     string       `json:"book"`
	Started  string       `json:"started"`
	Finished string       `json:"finished"`
	Jobs     int          `json:"jobs"`
	Labels   []SuiteLabel `json:"labels"`
}

// SuiteFile is the suite's own record under its out dir.
const SuiteFile = "suite.json"

// Failed are the labels that did not exit 0.
func (r SuiteResult) Failed() []string {
	var out []string
	for _, l := range r.Labels {
		if l.Exit != 0 {
			out = append(out, l.Label)
		}
	}
	return out
}

// Check is the check label's outcome: "pass", "fail", or "" when the
// suite did not run it.
func (r SuiteResult) Check() string {
	for _, l := range r.Labels {
		if l.Run == SuiteCheck {
			return either(l.Exit == 0, "pass", "fail")
		}
	}
	return ""
}

// RunSuite runs the labels, each as a subprocess of the harness binary
// writing under o.Out/<label>: the parallel labels at most o.Jobs at
// once in order, then the alone ones one at a time. It writes suite.json
// and returns what it holds; a label that fails is recorded, not
// returned as an error.
func RunSuite(ctx context.Context, runs []SuiteRun, book string, o SuiteOptions) (SuiteResult, error) {
	if o.Exe == "" {
		exe, err := os.Executable()
		if err != nil {
			return SuiteResult{}, err
		}
		o.Exe = exe
	}
	o.Jobs = max(1, o.Jobs)
	if o.Env == nil {
		o.Env = os.Environ()
	}
	if o.Log == nil {
		o.Log = io.Discard
	}
	if err := os.MkdirAll(o.Out, 0o755); err != nil {
		return SuiteResult{}, err
	}
	res := SuiteResult{Commit: o.Commit, Book: book, Started: time.Now().UTC().Format(time.RFC3339), Jobs: o.Jobs, Labels: make([]SuiteLabel, len(runs))}
	var mu sync.Mutex
	logf := func(f string, a ...any) {
		mu.Lock()
		defer mu.Unlock()
		fmt.Fprintf(o.Log, f+"\n", a...)
	}
	one := func(i int) error {
		s := runs[i]
		logf("%s: %s started", time.Now().Format(time.TimeOnly), s.Label)
		l, err := runLabel(ctx, s, o)
		res.Labels[i] = l
		logf("%s: %s exit %d in %ds%s", time.Now().Format(time.TimeOnly), s.Label, l.Exit, l.Secs, either(l.Watchdog, ", killed at its cap", ""))
		return err
	}
	sem := make(chan struct{}, o.Jobs)
	var wg sync.WaitGroup
	var errs []error
	for i, s := range runs {
		if s.Alone {
			continue
		}
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer func() { <-sem; wg.Done() }()
			if err := one(i); err != nil {
				mu.Lock()
				errs = append(errs, err)
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	for i, s := range runs {
		if !s.Alone || ctx.Err() != nil {
			continue
		}
		if err := one(i); err != nil {
			errs = append(errs, err)
		}
	}
	res.Finished = time.Now().UTC().Format(time.RFC3339)
	if err := writeJSON(filepath.Join(o.Out, SuiteFile), res); err != nil {
		errs = append(errs, err)
	}
	return res, errors.Join(errs...)
}

// runLabel runs one label to its out dir under a watchdog at its cap:
// stdout.txt, stderr.txt, exit.txt and secs.txt beside what the run
// writes. An error is one the label could not be started for.
func runLabel(ctx context.Context, s SuiteRun, o SuiteOptions) (SuiteLabel, error) {
	l := SuiteLabel{Label: s.Label, Run: s.Run, N: s.N, Env: s.Env, Alone: s.Alone, Exit: -1}
	dir := filepath.Join(o.Out, s.Label)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return l, err
	}
	args := []string{s.Run}
	if s.Run != SuiteCheck {
		args = append(args, "-out", dir, "-label", s.Label)
		if s.N > 0 {
			args = append(args, "-n", strconv.Itoa(s.N))
		}
		if s.Alone && !s.Live {
			args = append(args, "-alone")
		}
	}
	stdout, err := os.Create(filepath.Join(dir, "stdout.txt"))
	if err != nil {
		return l, err
	}
	defer func() { _ = stdout.Close() }()
	stderr, err := os.Create(filepath.Join(dir, "stderr.txt"))
	if err != nil {
		return l, err
	}
	defer func() { _ = stderr.Close() }()
	cmd := exec.Command(o.Exe, args...)
	cmd.Dir, cmd.Stdout, cmd.Stderr = o.Root, stdout, stderr
	cmd.Env = labelEnv(o.Env, s, o)
	start := time.Now()
	if err := cmd.Start(); err != nil {
		return l, fmt.Errorf("%s: %w", s.Label, err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	timer := time.NewTimer(max(s.Cap, time.Second))
	defer timer.Stop()
	var waitErr error
	select {
	case waitErr = <-done:
	case <-timer.C:
		l.Watchdog = true
		_ = cmd.Process.Kill()
		waitErr = <-done
	case <-ctx.Done():
		_ = cmd.Process.Kill()
		waitErr = <-done
	}
	l.Secs = int64(time.Since(start).Seconds())
	l.Exit = 0
	if waitErr != nil {
		var ee *exec.ExitError
		if !errors.As(waitErr, &ee) {
			return l, fmt.Errorf("%s: %w", s.Label, waitErr)
		}
		l.Exit = ee.ExitCode()
		if l.Exit == 0 || l.Exit == -1 {
			// structural: a process killed by a signal reports -1; the
			// suite records it as the shell would, 128 plus SIGKILL.
			l.Exit = 137
		}
	}
	if l.Watchdog {
		if err := os.WriteFile(filepath.Join(dir, "watchdog.txt"), fmt.Appendf(nil, "killed at its cap of %s\n", s.Cap), 0o644); err != nil {
			return l, err
		}
	}
	if err := os.WriteFile(filepath.Join(dir, "exit.txt"), fmt.Appendf(nil, "exit %d\n", l.Exit), 0o644); err != nil {
		return l, err
	}
	return l, os.WriteFile(filepath.Join(dir, "secs.txt"), fmt.Appendf(nil, "%ds\n", l.Secs), 0o644)
}

// labelEnv is the caller's environment without any run switch, then the
// label's own switches, the suite's commit, and the live world for a live
// label. A live label keeps the caller's load switches (its rate and
// minutes), since a live world is never the same twice anyway.
func labelEnv(env []string, s SuiteRun, o SuiteOptions) []string {
	out := make([]string, 0, len(env)+len(s.Env)+2)
	for _, kv := range env {
		k, _, _ := strings.Cut(kv, "=")
		keep := s.Live && strings.HasPrefix(k, "LOAD_") && k != LoadURL
		if !keep && (k == "MMO_COMMIT" || slices.ContainsFunc(SwitchPrefixes, func(p string) bool { return strings.HasPrefix(k, p) })) {
			continue
		}
		out = append(out, kv)
	}
	for _, k := range slices.Sorted(maps.Keys(s.Env)) {
		out = append(out, k+"="+s.Env[k])
	}
	if o.Commit != "" {
		out = append(out, "MMO_COMMIT="+o.Commit)
	}
	if s.Live {
		out = append(out, LoadURL+"="+o.Live)
	}
	return out
}
