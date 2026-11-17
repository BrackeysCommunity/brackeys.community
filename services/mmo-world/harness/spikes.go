package harness

import (
	"cmp"
	"fmt"
	"iter"
	"maps"

	"jams.team/mmo-world/sim/sheets"
)

// RunSpike runs one spike and writes its raw output under out.
func RunSpike(name string, b *sheets.Book, out string, n int) error {
	switch name {
	case "spike-a":
		return spikeA(b, out, n)
	case "spike-b":
		return spikeB(b, out, n)
	case "spike-e":
		return spikeE(b, out, n)
	}
	return fmt.Errorf("unknown spike %s", name)
}

func keysOf[K cmp.Ordered, V any](m map[K]V) iter.Seq[K] { return maps.Keys(m) }
