// Command harness runs the balance harness and the spikes.
//
//	harness check [-skip-lint] schemas, units, references, budgets, the pack, the rules, the sim lints
//	harness digest           the book's digest (the value MMO_SHEETS_FROM takes)
//	harness report           the newest epoch file against the one before it
//	harness report -in DIR [-against FILE] [-write FILE] [-commit SHA] [-note TEXT] [-sheets-from ROOT] [-strict]
//	                         every readings.json under DIR merged, against FILE or the last epoch; writes
//	                         DIR/report.md and DIR/report.json, and with -write an epoch file; -sheets-from adds
//	                         the cell diff from that root's book; -strict exits 1 when a target now misses
//	harness report -check    exits 1 when the newest epoch file is not of this book
//	harness schema           regenerate sheets/schema from the row types
//	harness proposals -in F  candidate story.arcs rows (a file, or a directory of them) checked against the book;
//	                         exits non-zero when none is valid
//	harness world -out DIR   the World run: 90 unattended days, what a day costs, and dungeons over a thousand seeds and played
//	harness craft -out DIR   the Craft run: sampled kinds against budgets and a search
//	harness battle -out DIR  the Battle run: the matchup matrix, classes, parties, growth and puzzles
//	harness economy -out DIR the Economy run: scripted players, their guild and its works, a founding (-n for one size)
//	harness crime -out DIR   the Crime run: the Economy run with one main player in ten a thief, and at 1,000
//	                         the first city against a world without thieves (-n for one size)
//	harness puzzles -out DIR the Puzzles run: every family's move logs at a bench and every party version's merged logs, replayed to the same facts
//	harness activity -out DIR the Activity run: every family through a live world's Activity listener (MMO_URL, MMO_ACTIVITY_URL)
//	harness delve -out DIR   the delve run: a party of four down the nearest first-tier dungeon and ten at a hunt, on a live disposable world
//	                         (MMO_URL, MMO_ACTIVITY_URL, MMO_OPERATOR_TOKEN; the world's keys from MMO_MASTER_SECRET or the local world's)
//	harness content -out DIR the content run: four histories, content from history, pins, the pin sweep and the busy world (-n seeds per history)
//	harness season -out DIR  season zero headless: 20 scripted players over 15 world days (-n seeds)
//	harness season -live URL -out DIR
//	                         season zero over HTTP on a live disposable world at URL (MMO_OPERATOR_TOKEN; -n ignored)
//	harness search -out DIR  the Search run aimed at staging: a climb over staging policies against an unstaged twin,
//	                         the best confirmed at -n; staging-stays-local, staged-goods-local and staged-xp-cap
//	harness terrain -out DIR the terrain sweep: random terrain pins on -n seeds, refusals by code, and what
//	                         every accepted pin keeps (terrain-pins-hold)
//	harness seen -out DIR    the per-server seen record over the content run's histories, and its four verdict
//	                         lines (-n seeds per history; measures no target)
//	harness map -out DIR     the live map's load budget on a 20,000-tile world and the last-seen pass against map
//	                         size (-n seeds); the first seed's payloads go to DIR/dump for the client's budget test
//	harness map -serve ADDR  seed map-0's world, its map routes served on ADDR for a browser check of the site
//	harness spike-a|b|e -out DIR
//
// A run that returns readings writes them to DIR/readings.json (-label names
// them, -alone marks a run read with nothing beside it). -cpuprofile FILE
// writes a CPU profile of any of them.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"runtime/pprof"
	"slices"
	"strings"
	"time"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
)

// epochsDir holds the committed epoch files under the module root.
const epochsDir = "harness/epochs"

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	root := sheetfs.ModuleRoot()
	cmd, args := os.Args[1], os.Args[2:]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	out := fs.String("out", "", "directory for spike output")
	n := fs.Int("n", 0, "sample size (0 = the spike's own)")
	skipLint := fs.Bool("skip-lint", false, "check: leave the sim analyzers to simlint")
	cpuProfile := fs.String("cpuprofile", "", "write a CPU profile to this file")
	live := fs.String("live", "", "season: play season zero over HTTP on the live world at this URL")
	in := fs.String("in", "", "proposals: a file or directory of candidate story.arcs rows; report: a suite's out dir")
	serve := fs.String("serve", "", "map: serve the map's world on this address instead of measuring it")
	label := fs.String("label", "", "the readings' label (default the run's name)")
	alone := fs.Bool("alone", false, "the run was read alone: its readings supersede the others for its targets")
	var ro reportOptions
	fs.StringVar(&ro.against, "against", "", "report: the epoch file to read against (default the last epoch)")
	fs.StringVar(&ro.write, "write", "", "report: write the merged readings as this epoch file")
	fs.StringVar(&ro.commit, "commit", "", "report: the commit the readings were read at (default theirs, MMO_COMMIT or git)")
	fs.StringVar(&ro.note, "note", "", "report: the epoch's note")
	fs.StringVar(&ro.sheetsFrom, "sheets-from", "", "report: add the cell diff from this module root's book")
	fs.BoolVar(&ro.strict, "strict", false, "report: exit 1 when a target that held before now misses")
	fs.BoolVar(&ro.check, "check", false, "report: exit 1 when the newest epoch file is not of this book")
	_ = fs.Parse(args)
	if *cpuProfile != "" {
		f, err := os.Create(*cpuProfile)
		exitOn(err)
		exitOn(pprof.StartCPUProfile(f))
		stopProfile = func() {
			pprof.StopCPUProfile()
			_ = f.Close()
		}
	}
	defer stopProfile()

	switch cmd {
	case "check":
		if !harness.PrintCheck(os.Stdout, harness.Check(root, harness.CheckOptions{SkipLint: *skipLint})) {
			stopProfile()
			os.Exit(1)
		}
	case "digest":
		b, err := sheetfs.LoadBook(root)
		exitOn(err)
		d, err := b.Digest()
		exitOn(err)
		fmt.Println(d)
	case "report":
		b, err := sheetfs.LoadBook(root)
		exitOn(err)
		ro.in = *in
		ok, err := report(os.Stdout, root, b, ro)
		exitOn(err)
		if !ok {
			stopProfile()
			os.Exit(1)
		}
	case "schema":
		exitOn(harness.WriteSchemas(root))
	case "proposals":
		if *in == "" {
			fmt.Fprintln(os.Stderr, "-in is required")
			os.Exit(2)
		}
		b, err := sheetfs.LoadBook(root)
		exitOn(err)
		rows, err := harness.ReadProposals(*in)
		exitOn(err)
		if harness.PrintProposals(os.Stdout, harness.CheckProposals(b, rows)) == 0 {
			stopProfile()
			os.Exit(1)
		}
	default:
		run, ok := harness.Runs[cmd]
		if !ok {
			usage()
		}
		if cmd == "map" && *serve != "" {
			b, err := sheetfs.LoadBook(root)
			exitOn(err)
			exitOn(harness.ServeMap(b, *serve))
			return
		}
		if *out == "" {
			fmt.Fprintln(os.Stderr, "-out is required")
			os.Exit(2)
		}
		b, err := sheetfs.LoadBook(root)
		exitOn(err)
		exitOn(os.MkdirAll(*out, 0o755))
		if cmd == "season" && *live != "" {
			run = func(b *sheets.Book, out string, _ int) ([]harness.Measured, error) {
				return harness.SeasonLive(b, *live, out)
			}
		}
		start := time.Now()
		readings, err := run(b, *out, *n)
		exitOn(err)
		if readings != nil {
			harness.Report(os.Stdout, b, readings)
			digest, err := b.Digest()
			exitOn(err)
			name := *label
			if name == "" {
				name = cmd
			}
			exitOn(harness.WriteReadings(*out, harness.Readings{
				Label: name, Run: cmd, N: *n, Env: switches(), Alone: *alone,
				Commit: commitOf(root), Book: digest, Secs: int64(time.Since(start).Seconds()), Rows: readings,
			}))
		}
	}
}

// switchPrefixes are the env names that change what a run measures.
var switchPrefixes = []string{"BATTLE_", "ECONOMY_", "EMERGENCE_", "SEARCH_", "LOAD_", "SOAK_", "SPIKE_A_", "SPIKE_B_"}

// switches are the run's switches that are set; a name that could hold a
// secret is never kept.
func switches() map[string]string {
	out := map[string]string{}
	for _, kv := range os.Environ() {
		k, v, _ := strings.Cut(kv, "=")
		if v == "" || !slices.ContainsFunc(switchPrefixes, func(p string) bool { return strings.HasPrefix(k, p) }) {
			continue
		}
		if slices.ContainsFunc([]string{"TOKEN", "SECRET", "KEY", "PASSWORD"}, func(s string) bool { return strings.Contains(k, s) }) {
			continue
		}
		out[k] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// commitOf is MMO_COMMIT, else the checkout's HEAD; "" when neither is known.
func commitOf(root string) string {
	if c := os.Getenv("MMO_COMMIT"); c != "" {
		return c
	}
	raw, err := exec.Command("git", "-C", root, "rev-parse", "HEAD").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

type reportOptions struct {
	in, against, write, commit, note, sheetsFrom string
	strict, check                                bool
}

// report runs the report command; ok is false when -check or -strict fails.
func report(w io.Writer, root string, b *sheets.Book, o reportOptions) (bool, error) {
	digest, err := b.Digest()
	if err != nil {
		return false, err
	}
	dir := filepath.Join(root, epochsDir)
	epochs, err := harness.Epochs(dir)
	if err != nil {
		return false, err
	}
	if o.check {
		if len(epochs) == 0 {
			fmt.Fprintf(w, "no epoch file in %s: write one with harness report -in DIR -write\n", epochsDir)
			return false, nil
		}
		last := epochs[len(epochs)-1]
		if last.Book != digest {
			fmt.Fprintf(w, "the newest epoch file, %s, is of book %s; this book is %s: run the suite and harness report -in DIR -write %s/%s\n",
				harness.EpochFile(last.Seq, last.Book), last.Book, digest, epochsDir, harness.EpochFile(last.Seq+1, digest))
			return false, nil
		}
		fmt.Fprintf(w, "ok: %s is this book's epoch file\n", harness.EpochFile(last.Seq, last.Book))
		return true, nil
	}

	var before, after *harness.Epoch
	switch {
	case o.in != "":
		rs, err := harness.ReadSuite(o.in, b)
		if err != nil {
			return false, err
		}
		commit := o.commit
		if commit == "" {
			commit = harness.SuiteCommit(rs)
		}
		if commit == "" {
			commit = commitOf(root)
		}
		if after, err = harness.NewEpoch(b, rs, commit, o.note, time.Now().UTC().Format(time.DateOnly)); err != nil {
			return false, err
		}
		if o.against != "" {
			before, err = harness.ReadEpoch(o.against)
		} else {
			before, err = harness.LastEpoch(dir, digest)
		}
		if err != nil {
			return false, err
		}
	case len(epochs) == 0:
		return false, fmt.Errorf("no epoch file in %s", epochsDir)
	default:
		after = epochs[len(epochs)-1]
		if len(epochs) > 1 {
			before = epochs[len(epochs)-2]
		}
		if o.against != "" {
			if before, err = harness.ReadEpoch(o.against); err != nil {
				return false, err
			}
		}
	}

	var md bytes.Buffer
	harness.ReportDiff(&md, b, before, after)
	if o.sheetsFrom != "" {
		from, err := sheetfs.LoadBook(o.sheetsFrom)
		if err != nil {
			return false, err
		}
		harness.SheetChanges(&md, from, b)
	}
	if _, err := w.Write(md.Bytes()); err != nil {
		return false, err
	}
	if o.in != "" {
		if err := os.WriteFile(filepath.Join(o.in, "report.md"), md.Bytes(), 0o644); err != nil {
			return false, err
		}
		if err := writeJSON(filepath.Join(o.in, "report.json"), after.Targets); err != nil {
			return false, err
		}
	}
	if o.write != "" {
		if o.in == "" {
			return false, fmt.Errorf("-write needs -in")
		}
		path := o.write
		seq, _, named := harness.EpochSeq(path)
		if !named {
			if st, err := os.Stat(path); err != nil || !st.IsDir() {
				return false, fmt.Errorf("-write %s: give a directory or a file named NNNN-<book's first 12 hex digits>.json", path)
			}
			last := 0
			if len(epochs) > 0 {
				last = epochs[len(epochs)-1].Seq
			}
			seq = last + 1
			path = filepath.Join(path, harness.EpochFile(seq, after.Book))
		}
		after.Seq = seq
		if err := harness.WriteEpoch(path, after); err != nil {
			return false, err
		}
		fmt.Fprintf(os.Stderr, "wrote %s\n", path)
	}
	if o.strict {
		if misses := harness.NowMisses(before, after); len(misses) > 0 {
			fmt.Fprintf(os.Stderr, "now missing: %s\n", strings.Join(misses, ", "))
			return false, nil
		}
	}
	return true, nil
}

func usage() {
	cmds := append([]string{"check", "digest", "report", "schema", "proposals"}, slices.Sorted(maps.Keys(harness.Runs))...)
	fmt.Fprintf(os.Stderr, "usage: harness %s [-out DIR] [-n N] [-label L] [-alone] [-live URL] [-in FILE] [-serve ADDR]\n", strings.Join(cmds, "|"))
	os.Exit(2)
}

func writeJSON(path string, v any) error {
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o644)
}

// stopProfile ends the CPU profile, if one is being written.
var stopProfile = func() {}

func exitOn(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		stopProfile()
		os.Exit(1)
	}
}
