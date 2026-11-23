package service_test

import (
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/fight"
)

// The readers match why parts by label, so the wire's copy must be the sim's.
func TestWhyLabels(t *testing.T) {
	if api.WhyAdapted != fight.WhyAdapted {
		t.Fatalf("api.WhyAdapted %q, fight.WhyAdapted %q", api.WhyAdapted, fight.WhyAdapted)
	}
}
