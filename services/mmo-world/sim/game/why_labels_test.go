package game

import (
	"testing"

	"jams.team/mmo-world/api"
)

// The readers match why parts by label, so the wire's copy must be the sim's.
func TestWhyRoadLabel(t *testing.T) {
	if partRoad != api.WhyRoad {
		t.Fatalf("partRoad %q, api.WhyRoad %q", partRoad, api.WhyRoad)
	}
}
