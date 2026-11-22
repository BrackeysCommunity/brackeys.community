package sheets

import "slices"

// PickTraits takes up to n traits, a weighted pick without replacement
// that never holds an opposed pair; when the open traits' weights total 0
// they are taken evenly. weights of another length than traits count every
// trait as 1.
func PickTraits(traits []NPCTrait, weights []int64, n int64, pick func([]int64) int) []string {
	opposes := func(id string) string {
		for _, t := range traits {
			if t.ID == id {
				return t.Opposes
			}
		}
		return ""
	}
	var out []string
	for int64(len(out)) < n {
		weighted, even := make([]int64, len(traits)), make([]int64, len(traits))
		var total, open int64
		for i, t := range traits {
			if slices.Contains(out, t.ID) || slices.Contains(out, t.Opposes) ||
				slices.ContainsFunc(out, func(c string) bool { return opposes(c) == t.ID }) {
				continue
			}
			even[i], weighted[i], open = 1, 1, open+1
			if len(weights) == len(traits) {
				weighted[i] = weights[i]
			}
			total += weighted[i]
		}
		if open == 0 {
			break
		}
		if total == 0 {
			weighted = even
		}
		out = append(out, traits[pick(weighted)].ID)
	}
	return out
}
