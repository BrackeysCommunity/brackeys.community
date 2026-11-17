package clean

import (
	"maps"
	"slices"
)

// structural: bytes in a word.
const word = 8

func Sum(m map[string]int64) int64 {
	var t int64
	for _, k := range slices.Sorted(maps.Keys(m)) {
		t += m[k] * word
	}
	return t + 1
}
