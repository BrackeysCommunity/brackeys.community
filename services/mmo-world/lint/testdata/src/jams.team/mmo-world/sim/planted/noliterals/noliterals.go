package noliterals

func literals(gauge int64) bool {
	return gauge >= 600 // want `number 600 in sim/`
}

func percent(x int64) int64 { return x * 20 / 100 } // want `number 20 in sim/` `number 100 in sim/`

// structural: a hex has six sides.
const sides = 6

const (
	width = 8 // structural: bytes in a word
	limit = 7 // want `number 7 in sim/`
)

func allowed() int64 { return sides + width + limit + 0 + 1 }
