package puzzle

import (
	"maps"
	"slices"
	"testing"
)

type stubRule struct{}

func (stubRule) Lay(*Layout, Kit)        {}
func (stubRule) Start(*Layout) Play      { return nil }
func (stubRule) Solve(*Layout) Log       { return Log{} }
func (stubRule) Deal(l *Layout) []Layout { return []Layout{*l} }

// TestPartyRegistry holds every registered version to a family that is
// registered too, and the registry to one entry an id.
func TestPartyRegistry(t *testing.T) {
	for _, id := range slices.Sorted(maps.Keys(parties)) {
		if registry[PartyFamily(id)] == nil {
			t.Errorf("party version %s plays %q, which is not a family", id, PartyFamily(id))
		}
		if partyRule(id) == nil {
			t.Errorf("party version %s has no rule", id)
		}
		if !slices.Contains(PartyVersions(PartyFamily(id)), id) {
			t.Errorf("party version %s is not listed under its family", id)
		}
	}

	const a, b = "zz-test-a", "zz-test-b"
	registerParty(b, Rewire, stubRule{})
	registerParty(a, Rewire, stubRule{})
	t.Cleanup(func() { delete(parties, a); delete(parties, b) })
	if PartyFamily(a) != Rewire || partyRule(a) == nil {
		t.Errorf("%s: family %q", a, PartyFamily(a))
	}
	vs := PartyVersions(Rewire)
	if i, j := slices.Index(vs, a), slices.Index(vs, b); i < 0 || j < 0 || i > j || !slices.IsSorted(vs) {
		t.Errorf("rewire's versions %v", vs)
	}
	if PartyFamily("no-such") != "" || partyRule("no-such") != nil || PartyVersions("no-such") != nil {
		t.Error("an unknown version answered")
	}
	defer func() {
		if recover() == nil {
			t.Error("a version registered twice")
		}
	}()
	registerParty(a, Rewire, stubRule{})
}

func TestUnseen(t *testing.T) {
	var x int64 = Unseen
	if x >= 0 || x != -(1<<31) {
		t.Errorf("unseen %d", x)
	}
}
