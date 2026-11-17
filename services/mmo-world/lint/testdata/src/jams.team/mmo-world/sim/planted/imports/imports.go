package imports

import (
	"math/rand" // want `sim/ may not import "math/rand"`
	"os"        // want `sim/ may not import "os"`
	"time"      // want `sim/ may not import "time"`

	"github.com/example/dep"      // want `sim/ may not import "github.com/example/dep"`
	"jams.team/mmo-world/harness" // want `sim/ may not import "jams.team/mmo-world/harness"`
)

var _ = rand.Int
var _ = os.Getenv
var _ = time.Now
var _ = harness.X
var _ = dep.X
