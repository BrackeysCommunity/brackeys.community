package harness

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/sheets"
)

// TestSuiteCoversTargets: every run a target names is run by a label of
// the suite (growth is read by Battle), every label's run exists, labels
// are unique, and the long labels start first.
func TestSuiteCoversTargets(t *testing.T) {
	b := soakBook(t)
	ran := map[string]bool{}
	labels := map[string]bool{}
	pastLong := false
	for _, s := range Suite {
		if labels[s.Label] {
			t.Errorf("two labels %s", s.Label)
		}
		labels[s.Label] = true
		ran[s.Run] = true
		if _, ok := Runs[s.Run]; !ok && s.Run != SuiteCheck && !s.Live {
			t.Errorf("%s runs %q, which is no run", s.Label, s.Run)
		}
		if s.Cap <= 0 {
			t.Errorf("%s has no watchdog cap", s.Label)
		}
		if !s.Long {
			pastLong = true
		} else if pastLong {
			t.Errorf("%s is long but starts after a short label", s.Label)
		}
		if s.Live && !s.Alone {
			t.Errorf("%s plays a live world beside other labels", s.Label)
		}
	}
	readBy := map[string]string{"growth": "battle"}
	for _, tg := range b.Targets {
		for run := range strings.SplitSeq(tg.Runs, ",") {
			run = strings.TrimSpace(run)
			if by, ok := readBy[run]; ok {
				run = by
			}
			if !ran[run] {
				t.Errorf("%s names the run %s, which no suite label runs", tg.ID, run)
			}
		}
	}
	for _, l := range []string{"economy-10", "economy-10-s7", "soak-10-s0", "soak-10-s7", "social-alone", "world-alone", "map-10-alone", "spike-e-1000", "replay"} {
		if !labels[l] {
			t.Errorf("no label %s", l)
		}
	}
}

func TestSelectSuite(t *testing.T) {
	plain, err := SelectSuite(nil, false, "")
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range plain {
		if s.Soak || s.Live {
			t.Errorf("%s runs without -soak or -live", s.Label)
		}
	}
	all, err := SelectSuite(nil, true, "http://localhost:18080")
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != len(Suite) {
		t.Errorf("-soak -live selects %d of %d labels", len(all), len(Suite))
	}
	only, err := SelectSuite([]string{"season", "check"}, false, "")
	if err != nil || len(only) != 2 || only[0].Label != SuiteCheck || only[1].Label != "season" {
		t.Errorf("-only season,check: %+v %v, want check then season, in the suite's order", only, err)
	}
	if _, err := SelectSuite([]string{"nope"}, false, ""); err == nil {
		t.Error("an unknown label was selected")
	}
	if _, err := SelectSuite([]string{"load"}, false, ""); err == nil {
		t.Error("the load label was selected without a live world")
	}
}

// TestLabelEnv: a label runs with none of the caller's run switches, only
// its own, the suite's commit, and for a live label the world and the
// caller's load switches.
func TestLabelEnv(t *testing.T) {
	env := []string{"PATH=/bin", "ECONOMY_SEED=5", "SEARCH_ONLY=build", "MMO_COMMIT=old", "SPIKE_WORKERS=6", "LOAD_MINUTES=2", "MMO_API_TOKEN=t"}
	o := SuiteOptions{Commit: "abc", Live: "http://w"}
	got := labelEnv(env, SuiteRun{Label: "economy-10-s1", Env: map[string]string{"ECONOMY_SEED": "1"}}, o)
	want := []string{"PATH=/bin", "SPIKE_WORKERS=6", "MMO_API_TOKEN=t", "ECONOMY_SEED=1", "MMO_COMMIT=abc"}
	if !slices.Equal(got, want) {
		t.Errorf("economy-10-s1: %v, want %v", got, want)
	}
	live := labelEnv(env, SuiteRun{Label: "load", Live: true}, o)
	if !slices.Contains(live, "LOAD_MINUTES=2") || !slices.Contains(live, LoadURL+"=http://w") || slices.Contains(live, "ECONOMY_SEED=5") {
		t.Errorf("load: %v", live)
	}
}

// TestRunLabelWatchdog: a label past its cap is killed and recorded so.
func TestRunLabelWatchdog(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "slow.sh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\nsleep 30\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	l, err := runLabel(t.Context(), SuiteRun{Label: "slow", Run: SuiteCheck, Cap: time.Second}, SuiteOptions{Out: dir, Exe: script, Root: dir})
	if err != nil {
		t.Fatal(err)
	}
	if !l.Watchdog || l.Exit == 0 || l.Secs > 10 {
		t.Errorf("%+v", l)
	}
	for _, f := range []string{"stdout.txt", "stderr.txt", "exit.txt", "secs.txt", "watchdog.txt"} {
		if _, err := os.Stat(filepath.Join(dir, "slow", f)); err != nil {
			t.Error(err)
		}
	}
}

// TestSoakRun plays the soak run small: every system on, its readings,
// and a report with each world day's conservation check and cost.
func TestSoakRun(t *testing.T) {
	economyEnv(t)
	b := soakBook(t)
	dir := t.TempDir()
	ms, err := soakRun(b, dir, []int{optionPlayers}, optionDays)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]Measured{}
	for _, m := range ms {
		got[m.Target] = m
	}
	for _, id := range []string{"coin-drift", "thieves-hold-band", "theft-never-mints", "staged-goods-local", "guild-works-sink", "spoils-conserved"} {
		if _, ok := got[id]; !ok {
			t.Errorf("no %s reading: %+v", id, ms)
		}
	}
	for _, id := range []string{"theft-never-mints", "staged-goods-local", "spoils-conserved"} {
		if !got[id].Holds {
			t.Errorf("%s: %s", id, got[id].Value)
		}
	}
	raw, err := os.ReadFile(filepath.Join(dir, "soak.md"))
	if err != nil {
		t.Fatal(err)
	}
	doc := string(raw)
	for _, want := range []string{"| Day | Active |", "| Conservation | Day cost |", "Thieves:", "Staging at", "Season clock:", "Emergence:", "The empty server"} {
		if !strings.Contains(doc, want) {
			t.Errorf("soak.md has no %q", want)
		}
	}
	if n := strings.Count(doc, " | clean | "); n != optionDays {
		t.Errorf("%d days read clean in soak.md, want %d", n, optionDays)
	}
}

// TestReplayRun replays two world days of ten players from their
// snapshots: every tick matches, the recording leaves the play's digest
// as it is, and a recorded digest moved is caught.
func TestReplayRun(t *testing.T) {
	economyEnv(t)
	b := soakBook(t)
	const days = 2
	dir := t.TempDir()
	ms, err := replayRun(b, dir, replayPlayers, days)
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 1 || ms[0].Target != "replay-matches" || !ms[0].Holds {
		t.Fatalf("%+v", ms)
	}
	if !strings.Contains(ms[0].Value, "288 ticks replayed from 2 daily snapshots") {
		t.Errorf("reading: %s", ms[0].Value)
	}
	plain, err := soak(b, soakers(b, replayPlayers), days)
	if err != nil {
		t.Fatal(err)
	}
	pop := soakers(b, replayPlayers)
	rw := &replayWatch{digests: map[int64]string{}, cmds: map[int64][]api.ActionRequest{}}
	pop.watch = rw
	rec, err := soak(b, pop, days)
	if err != nil || rw.err != nil {
		t.Fatal(err, rw.err)
	}
	if rec.digest != plain.digest {
		t.Errorf("recording moved the play: %s, unrecorded %s", rec.digest, plain.digest)
	}
	if rw.recorded == 0 || len(rw.snaps) != days+1 {
		t.Fatalf("%d commands recorded, %d snapshots", rw.recorded, len(rw.snaps))
	}
	rw.digests[sheets.TicksPerDay+7] = "moved"
	l, err := replayFrom(t.Context(), rw.g.Rules(), rw.snaps[1], rw)
	if err != nil {
		t.Fatal(err)
	}
	if l.holds() || l.mismatch != sheets.TicksPerDay+7 {
		t.Errorf("a moved digest replays as %+v", l)
	}
	if m := replayReading(replayPlayers, days, rw, []replayDay{l}); m.Holds {
		t.Errorf("a mismatch holds: %s", m.Value)
	}
	if _, err := os.Stat(filepath.Join(dir, "replay.md")); err != nil {
		t.Error(err)
	}
}

// TestSpikeEReadings: spike E on two worlds reads its five targets, and
// each misses when its number is out of bounds.
func TestSpikeEReadings(t *testing.T) {
	b := soakBook(t)
	const n = 2
	stats := make([]worldStats, n)
	for i := range stats {
		s, err := oneWorld(b, i)
		if err != nil {
			t.Fatal(err)
		}
		stats[i] = s
	}
	ms, err := spikeEDoc(b, t.TempDir(), stats, []time.Duration{time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"structures-reachable", "chunk-order", "novelty-share", "biome-patches", "ecotone-share"}
	if len(ms) != len(want) {
		t.Fatalf("%+v", ms)
	}
	for i, m := range ms {
		if m.Target != want[i] || !m.Holds || strings.HasPrefix(m.Value, unmeasured) {
			t.Errorf("%s: %+v", want[i], m)
		}
		if !slices.ContainsFunc(b.Targets, func(tg sheets.Target) bool { return tg.ID == m.Target }) {
			t.Errorf("%s is no target", m.Target)
		}
	}
	novel := map[int64][2]int{0: {30, 10}, 1: {30, 9}}
	worlds := map[int64][]int{0: {333}, 1: {300}}
	miss := spikeEReadings(n, 10, 2, 1, 1, 100, 1, novel, worlds, []int{299, 299}, 21, 100)
	for _, m := range miss {
		if m.Holds {
			t.Errorf("%s holds on numbers out of bounds: %s", m.Target, m.Value)
		}
	}
	edge := spikeEReadings(n, 10, 2, 0, 0, 100, 0, map[int64][2]int{0: {30, 10}}, map[int64][]int{0: {333}}, []int{300, 300}, 10, 100)
	for _, m := range edge {
		if !m.Holds {
			t.Errorf("%s misses at its bound: %s", m.Target, m.Value)
		}
	}
}
