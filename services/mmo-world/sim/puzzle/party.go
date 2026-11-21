package puzzle

import (
	"maps"
	"slices"
)

// structural: an element of a dealt view the seat is not shown.
const Unseen = -1 << 31

// PartyRule is a family played by several hands on one machine. One
// layout, one merged log in which every move names its seat, one result.
type PartyRule interface {
	// Lay adds the version's own data after the family's Lay; it may
	// rewrite the family's fields.
	Lay(l *Layout, k Kit)
	Start(l *Layout) Play // the merged model; l.Seats is set
	Solve(l *Layout) Log  // a merged log that solves it, every move seated
	// Deal is each seat's view: the layout with what that seat is not
	// shown set to Unseen (an element) or nil (a whole field).
	Deal(l *Layout) []Layout
}

// partyVersion is one puzzles.party row's rule and the family it plays.
type partyVersion struct {
	family string
	rule   PartyRule
}

var parties = map[string]partyVersion{}

// registerParty adds a party version of a family. A version file
// registers itself once, from init. Some version files init before their
// family's, so TestPartyRegistry checks the family, not this.
func registerParty(id, family string, r PartyRule) {
	if _, ok := parties[id]; ok {
		panic("puzzle: party version " + id + " registered twice")
	}
	parties[id] = partyVersion{family: family, rule: r}
}

// PartyFamily is the family a party version plays, "" for none.
func PartyFamily(id string) string { return parties[id].family }

// PartyVersions lists the party versions of a family, in id order.
func PartyVersions(family string) []string {
	var out []string
	for _, id := range slices.Sorted(maps.Keys(parties)) {
		if parties[id].family == family {
			out = append(out, id)
		}
	}
	return out
}

// partyRule is a version's rule, nil when none is registered.
func partyRule(id string) PartyRule { return parties[id].rule }
