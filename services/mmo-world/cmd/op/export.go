package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"

	"jams.team/mmo-world/export"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

// exportCmd writes a world's recorded play, pseudonymised, straight from
// its database: no key is read, so it runs anywhere the database and the
// world's sheets are. A range starting before the world's last rules epoch
// is refused, since one export is valued by one book.
func exportCmd(args []string) error {
	fs := flag.NewFlagSet("export", flag.ContinueOnError)
	out := fs.String("out", "", "the directory to write into")
	from := fs.Int64("from-day", 0, "the first world day")
	to := fs.Int64("to-day", -1, "the last world day (default: the last closed day)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 || *out == "" || *from < 0 || *to >= 0 && *to < *from {
		return errors.New(usage)
	}
	world := os.Getenv(service.EnvWorld)
	if world == "" {
		return errors.New(service.EnvWorld + " must be set")
	}
	book, err := service.BookFromEnv()
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := service.PoolFromEnv(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	st := store.New(pool, world)
	epochs, err := epochFacts(ctx, st)
	if err != nil {
		return err
	}
	for i := len(epochs) - 1; i >= 0; i-- {
		if e := epochs[i]; e.Tick > *from*sheets.TicksPerDay {
			return fmt.Errorf("export: the world took a rules epoch at tick %d; days before it ran on other sheets: export from day %d on",
				e.Tick, (e.Tick+sheets.TicksPerDay-1)/sheets.TicksPerDay)
		}
	}
	upto := int64(-1)
	if *to >= 0 {
		upto = (*to + 1) * sheets.TicksPerDay
	}
	m, err := export.Write(ctx, st, book, *out, *from*sheets.TicksPerDay, upto)
	if err != nil {
		return err
	}
	if m.ToTick == m.FromTick {
		return fmt.Errorf("no world day from day %d has closed", *from)
	}
	return show(m)
}
