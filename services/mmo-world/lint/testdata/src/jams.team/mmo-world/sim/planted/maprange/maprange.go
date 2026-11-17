package maprange

import (
	"maps"
	"slices"
)

func mapRange(m map[string]int) int {
	t := 0
	for _, v := range m { // want `range over a map`
		t += v
	}
	for k := range maps.Keys(m) { // want `range over a maps iterator`
		t += len(k)
	}
	_ = slices.Collect(maps.Values(m)) // want `collecting a maps iterator`
	for _, k := range slices.Sorted(maps.Keys(m)) {
		t += m[k]
	}
	return t
}
