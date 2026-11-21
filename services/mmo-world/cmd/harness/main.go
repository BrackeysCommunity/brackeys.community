// Command harness runs the balance harness and the spikes.
//
//	harness check [-skip-lint] schemas, units, references, budgets, the pack, the rules, the sim lints
//	harness report           every target and its last reading
//	harness schema           regenerate sheets/schema from the row types
//	harness world -out DIR   the World run: 90 unattended days, and what a day costs
//	harness craft -out DIR   the Craft run: sampled kinds against budgets and a search
//	harness battle -out DIR  the Battle run: the matchup matrix, classes, growth and puzzles
//	harness economy -out DIR the Economy run: scripted players, their guild and its works, a founding (-n for one size)
//	harness puzzles -out DIR the Puzzles run: every family's move logs at a bench, replayed to the same facts
//	harness spike-a|b|e -out DIR
package main

import (
	"flag"
	"fmt"
	"maps"
	"os"
	"slices"
	"strings"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sheetfs"
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
	_ = fs.Parse(args)

	switch cmd {
	case "check":
		if !harness.PrintCheck(os.Stdout, harness.Check(root, harness.CheckOptions{SkipLint: *skipLint})) {
			os.Exit(1)
		}
	case "report":
		b, err := sheetfs.LoadBook(root)
		exitOn(err)
		harness.Report(os.Stdout, b, nil)
	case "schema":
		exitOn(harness.WriteSchemas(root))
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
		readings, err := run(b, *out, *n)
		exitOn(err)
		if readings != nil {
			harness.Report(os.Stdout, b, readings)
		}
	}
}

func usage() {
	cmds := append([]string{"check", "report", "schema"}, slices.Sorted(maps.Keys(harness.Runs))...)
	fmt.Fprintf(os.Stderr, "usage: harness %s [-out DIR] [-n N]\n", strings.Join(cmds, "|"))
	os.Exit(2)
}

func exitOn(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
