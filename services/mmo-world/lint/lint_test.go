package lint

import (
	"testing"

	"golang.org/x/tools/go/analysis"
	"golang.org/x/tools/go/analysis/analysistest"
)

// Each planted package breaks one rule; its analyzer must report every
// violation and nothing else.
func TestPlantedViolations(t *testing.T) {
	for _, c := range []struct {
		pkg string
		a   *analysis.Analyzer
	}{
		{"imports", Imports},
		{"maprange", MapRange},
		{"nofloat", NoFloat},
		{"nogoroutine", NoGoroutine},
		{"noliterals", NoLiterals},
		{"exhaustive", Exhaustive()},
		{"sumtype", Analyzers()[len(Analyzers())-1]},
	} {
		t.Run(c.pkg, func(t *testing.T) {
			analysistest.Run(t, analysistest.TestData(), c.a, SimPrefix+"/planted/"+c.pkg)
		})
	}
}

// Clean sim code and code outside sim/ pass every analyzer.
func TestCleanPasses(t *testing.T) {
	for _, a := range Analyzers() {
		analysistest.Run(t, analysistest.TestData(), a, SimPrefix+"/clean", "jams.team/mmo-world/outside")
	}
}
