package fact

import (
	"fmt"

	"jams.team/mmo-world/sim/sheets"
)

// Weights gives each fact kind its sheet weight.
type Weights map[string]int64

// NewWeights indexes the fact-weights sheet by kind.
func NewWeights(rows []sheets.FactWeight) Weights {
	out := make(Weights, len(rows))
	for _, w := range rows {
		out[w.Kind] = w.Weight
	}
	return out
}

// New builds a fact of a kind the sheet weighs; a kind with no row is an
// error.
func (w Weights) New(tick int64, kind, region string, subjects []Ref, causes []ID, data ...Datum) (Fact, error) {
	n, ok := w[kind]
	if !ok {
		return Fact{}, fmt.Errorf("fact: no weight for kind %q", kind)
	}
	return Fact{Tick: tick, Kind: kind, Region: region, Subjects: subjects, Causes: causes, Data: data, Weight: n}, nil
}
