// Package party is a party as rules (GDD 7.5): its members, the invitations
// that form it, and who leads it. It holds no world state.
package party

import (
	"cmp"
	"fmt"
	"slices"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

// Party is characters who press, split and delve together; it never ticks,
// and the game ends it.
type Party struct {
	ID      string   `json:"id"` // "pt-<n>"
	Leader  string   `json:"leader"`
	Members []Member `json:"members"` // in join order
	Formed  int64    `json:"formed"`  // tick
	Invites []Invite `json:"invites,omitempty"`
	// Partied holds "a|b" pairs (ids sorted) that have won an encounter
	// together, so partied is written into Company once a pair.
	Partied []string `json:"partied,omitempty"`
}

// Member is one character in a party.
type Member struct {
	ID      string `json:"id"`
	Joined  int64  `json:"joined"` // tick
	Follows bool   `json:"follows,omitempty"`
}

// Invite is an invitation into a party, open until a tick.
type Invite struct {
	To    string `json:"to"`
	By    string `json:"by"`
	Until int64  `json:"until"` // tick
}

// structural: a party is at least two; reach is the same or a
// neighbouring tile.
const (
	MinSize = 2
	Reach   = 1
)

// structural: what a fact names a party by, and what joins a pair's ids.
const (
	refKind = "party"
	pairSep = "|"
)

// Ref is the fact subject a party is.
func Ref(id string) fact.Ref { return fact.Ref{Kind: refKind, ID: id} }

// Valid checks a party's shape: MinSize to most members, each once, led
// by one of them.
func (p *Party) Valid(most int64) error {
	n := int64(len(p.Members))
	if n < MinSize || n > most {
		return fmt.Errorf("party %s: %d members, not %d to %d", p.ID, n, MinSize, most)
	}
	seen := make(map[string]bool, n)
	for _, m := range p.Members {
		if m.ID == "" {
			return fmt.Errorf("party %s: a member with no id", p.ID)
		}
		if seen[m.ID] {
			return fmt.Errorf("party %s: %s is a member twice", p.ID, m.ID)
		}
		seen[m.ID] = true
	}
	if !seen[p.Leader] {
		return fmt.Errorf("party %s: the leader %q is not a member", p.ID, p.Leader)
	}
	return nil
}

// Has reports whether id is a member.
func (p *Party) Has(id string) bool { return p.Seat(id) >= 0 }

// Seat is id's index in Members, -1 if it is not one.
func (p *Party) Seat(id string) int {
	return slices.IndexFunc(p.Members, func(m Member) bool { return m.ID == id })
}

// IDs are the members' ids, in join order.
func (p *Party) IDs() []string {
	out := make([]string, len(p.Members))
	for i, m := range p.Members {
		out[i] = m.ID
	}
	return out
}

// Full reports whether the party has most members.
func (p *Party) Full(most int64) bool { return int64(len(p.Members)) >= most }

// Join adds id as the newest member and drops the invitation it took.
func (p *Party) Join(id string, tick int64) {
	if p.Has(id) {
		return
	}
	p.Members = append(p.Members, Member{ID: id, Joined: tick})
	p.Invites = slices.DeleteFunc(p.Invites, func(x Invite) bool { return x.To == id })
}

// Invite holds an invitation for to, by a member, until a tick. A second
// invitation for the same character replaces the first.
func (p *Party) Invite(to, by string, until int64) {
	p.Invites = slices.DeleteFunc(p.Invites, func(x Invite) bool { return x.To == to })
	p.Invites = append(p.Invites, Invite{To: to, By: by, Until: until})
}

// InviteFor is the invitation open for id at a tick, if there is one.
func (p *Party) InviteFor(id string, tick int64) (Invite, bool) {
	for _, x := range p.Invites {
		if x.To == id && tick <= x.Until {
			return x, true
		}
	}
	return Invite{}, false
}

// Expire drops the invitations past their tick, and reports whether any
// went.
func (p *Party) Expire(tick int64) bool {
	n := len(p.Invites)
	p.Invites = slices.DeleteFunc(p.Invites, func(x Invite) bool { return tick > x.Until })
	return len(p.Invites) != n
}

// Leave removes id. The leader's place passes to the longest-standing
// member (earliest Joined, then join order), who no longer follows anyone.
// Invitations id made go with it. ended is true when one is left.
func (p *Party) Leave(id string) (ended bool) {
	i := p.Seat(id)
	if i < 0 {
		return len(p.Members) < MinSize
	}
	p.Members = slices.Delete(p.Members, i, i+1)
	p.Invites = slices.DeleteFunc(p.Invites, func(x Invite) bool { return x.By == id || x.To == id })
	if p.Leader == id {
		p.Leader = ""
		if len(p.Members) > 0 {
			// MinFunc keeps the first of equals, which is the earlier joiner.
			next := slices.MinFunc(p.Members, func(a, b Member) int { return cmp.Compare(a.Joined, b.Joined) })
			p.Leader = next.ID
			p.Members[p.Seat(next.ID)].Follows = false
		}
	}
	return len(p.Members) < MinSize
}

// Pair is the key Partied holds for two characters.
func Pair(a, b string) string {
	if b < a {
		a, b = b, a
	}
	return a + pairSep + b
}

// MarkPartied records that a and b have won an encounter together, and
// reports whether it is the first time.
func (p *Party) MarkPartied(a, b string) bool {
	k := Pair(a, b)
	i, found := slices.BinarySearch(p.Partied, k)
	if found {
		return false
	}
	p.Partied = slices.Insert(p.Partied, i, k)
	return true
}

// Within reports whether two tiles are in a party's reach of each other.
func Within(a, b hex.Hex) bool { return hex.Distance(a, b) <= Reach }
