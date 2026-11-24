// Command harness runs the balance harness and the spikes.
//
//	harness check [-skip-lint] schemas, units, references, budgets, the pack, the rules, the sim lints
//	harness report           every target and its last reading
//	harness schema           regenerate sheets/schema from the row types
//	harness proposals -in F  candidate story.arcs rows (a file, or a directory of them) checked against the book;
//	                         exits non-zero when none is valid
//	harness world -out DIR   the World run: 90 unattended days, what a day costs, and dungeons over a thousand seeds and played
//	harness craft -out DIR   the Craft run: sampled kinds against budgets and a search
//	harness battle -out DIR  the Battle run: the matchup matrix, classes, parties, growth and puzzles
//	harness economy -out DIR the Economy run: scripted players, their guild and its works, a founding (-n for one size)
//	harness crime -out DIR   the Crime run: the Economy run's players with one in ten a thief, against the band, the ledger
//	                         and the invitation, and at 1,000 the first city without thieves (-n for one size)
//	harness puzzles -out DIR the Puzzles run: every family's move logs at a bench and every party version's merged logs, replayed to the same facts
//	harness activity -out DIR the Activity run: every family through a live world's Activity listener (MMO_URL, MMO_ACTIVITY_URL)
//	harness delve -out DIR   the delve run: a party of four down the nearest first-tier dungeon and ten at a hunt, on a live disposable world
//	                         (MMO_URL, MMO_ACTIVITY_URL, MMO_OPERATOR_TOKEN; the world's keys from MMO_MASTER_SECRET or the local world's)
//	harness content -out DIR the content run: four histories, content from history, pins, the pin sweep and the busy world (-n seeds per history)
//	harness season -out DIR  season zero headless: 20 scripted players over 15 world days (-n seeds)
//	harness season -live URL -out DIR
//	                         season zero over HTTP on a live disposable world at URL (MMO_OPERATOR_TOKEN; -n ignored)
//	harness spike-a|b|e -out DIR
//
// -cpuprofile FILE writes a CPU profile of any of them.
package main

import (
	"flag"
	"fmt"
	"maps"
	"os"
	"runtime/pprof"
	"slices"
	"strings"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/sheets"
)

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
	in := fs.String("in", "", "proposals: a file or directory of candidate story.arcs rows")
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
	case "report":
		b, err := sheetfs.LoadBook(root)
		exitOn(err)
		harness.Report(os.Stdout, b, nil)
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
		readings, err := run(b, *out, *n)
		exitOn(err)
		if readings != nil {
			harness.Report(os.Stdout, b, readings)
		}
	}
}

func usage() {
	cmds := append([]string{"check", "report", "schema", "proposals"}, slices.Sorted(maps.Keys(harness.Runs))...)
	fmt.Fprintf(os.Stderr, "usage: harness %s [-out DIR] [-n N] [-live URL] [-in FILE]\n", strings.Join(cmds, "|"))
	os.Exit(2)
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
