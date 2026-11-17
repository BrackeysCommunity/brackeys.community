// Command world is the world service: the only writer of game state and
// the only holder of the keys. For now it loads its configuration, derives
// the keys and the sheets, and reports what it would run with.
package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"

	"jams.team/mmo-world/harness"
	"jams.team/mmo-world/sim/keys"
)

// The master secret arrives base64-encoded in the environment and goes no
// further than this process: never logged, never stored.
const (
	envMaster = "MMO_MASTER_SECRET"
	envWorld  = "MMO_WORLD_ID"
	envEpoch  = "MMO_ROLL_EPOCH"
)

func main() {
	master, err := base64.StdEncoding.DecodeString(os.Getenv(envMaster))
	if err != nil || len(master) == 0 {
		fail(envMaster + " must be set to a base64 secret")
	}
	world := os.Getenv(envWorld)
	if world == "" {
		fail(envWorld + " must be set")
	}
	epoch, err := strconv.ParseInt(os.Getenv(envEpoch), 10, 64)
	if err != nil {
		fail(envEpoch + " must be a whole number")
	}
	if _, err := keys.Derive(master, world, epoch); err != nil {
		fail(err.Error())
	}
	clear(master)
	book, err := harness.LoadBook(harness.ModuleRoot())
	if err != nil {
		fail(err.Error())
	}
	fmt.Printf("world %s, roll epoch %d: keys derived, %d tag rules loaded; no tick loop yet\n", world, epoch, len(book.Rules))
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "world:", msg)
	os.Exit(1)
}
