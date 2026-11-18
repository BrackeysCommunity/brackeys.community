// Command harness runs the balance harness and the spikes.
//
//	harness check            schemas, units, references, budgets, the pack, the rules, the sim lints
//	harness report           every target and its last reading
//	harness schema           regenerate sheets/schema from the row types
//	harness world -out DIR   the World run: 90 unattended days, and what a day costs
//	harness craft -out DIR   the Craft run: sampled kinds against budgets and a search
//	harness battle -out DIR  the Battle run: the matchup matrix, growth and puzzles
//	harness spike-a|b|e -out DIR
package main

import (
	"flag"
	"fmt"
	"os"

	"jams.team/mmo-world/harness"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	root := harness.ModuleRoot()
	cmd, args := os.Args[1], os.Args[2:]
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	out := fs.String("out", "", "directory for spike output")
	n := fs.Int("n", 0, "sample size (0 = the spike's own)")
	_ = fs.Parse(args)

	switch cmd {
	case "check":
		if !harness.PrintCheck(os.Stdout, harness.Check(root, harness.CheckOptions{})) {
			os.Exit(1)
		}
	case "report":
		b, err := harness.LoadBook(root)
		exitOn(err)
		harness.Report(os.Stdout, b, nil)
	case "schema":
		exitOn(harness.WriteSchemas(root))
	case "craft", "battle":
		if *out == "" {
			fmt.Fprintln(os.Stderr, "-out is required")
			os.Exit(2)
		}
		b, err := harness.LoadBook(root)
		exitOn(err)
		exitOn(os.MkdirAll(*out, 0o755))
		run := harness.CraftRun
		if cmd == "battle" {
			run = harness.BattleRun
		}
		readings, err := run(b, *out, *n)
		exitOn(err)
		harness.Report(os.Stdout, b, readings)
	case "world":
		if *out == "" {
			fmt.Fprintln(os.Stderr, "-out is required")
			os.Exit(2)
		}
		b, err := harness.LoadBook(root)
		exitOn(err)
		exitOn(os.MkdirAll(*out, 0o755))
		readings, err := harness.WorldRun(b, *out, *n)
		exitOn(err)
		harness.Report(os.Stdout, b, readings)
	case "spike-a", "spike-b", "spike-e":
		if *out == "" {
			fmt.Fprintln(os.Stderr, "-out is required")
			os.Exit(2)
		}
		b, err := harness.LoadBook(root)
		exitOn(err)
		exitOn(os.MkdirAll(*out, 0o755))
		exitOn(harness.RunSpike(cmd, b, *out, *n))
	default:
		usage()
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: harness check|report|schema|world|craft|battle|spike-a|spike-b|spike-e [-out DIR] [-n N]")
	os.Exit(2)
}

func exitOn(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
