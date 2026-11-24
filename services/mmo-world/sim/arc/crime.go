package arc

import "jams.team/mmo-world/sim/fact"

// structural: the syndicate's predicates and the roles they bind.
const (
	whenSyndicateInvites = "syndicate-invites"
	whenWatchKnows       = "watch-knows"
	whenThiefInWalls     = "thief-in-walls"

	roleNPC     = "npc"
	roleNotable = "notable"
	roleDen     = "den"

	memTheft = "theft.made"
)

func init() {
	Predicates[whenSyndicateInvites] = syndicateInvites
	Predicates[whenWatchKnows] = watchKnows
	Predicates[whenThiefInWalls] = thiefInWalls
}

// Crime is what the syndicate's threads read beyond World; the game's view
// implements it. A World without it casts neither thread.
type Crime interface {
	// Den is the den nearest a character: its fence, the syndicate
	// captain over it, and the settlement it stands in.
	Den(char string) (fence, notable string, settlement int, ok bool)
	// Captain is a watch captain's settlement and the settlement of the
	// den near it that the character could name.
	Captain(char string, npc string) (settlement, den int, ok bool)
}

// syndicateInvites is the invitation: a character the syndicate queued at
// its gate standing, asked by the fence of the den nearest it, with that
// den's captain behind it. The seat is the den's settlement.
func syndicateInvites(w World, row Row, _ Params) []Candidate {
	x, ok := w.(Crime)
	if !ok {
		return nil
	}
	ps := w.Places()
	var out []Candidate
	for _, pd := range queued(w, PendInvite) {
		fence, notable, n, ok := x.Den(pd.Char)
		if !ok {
			continue
		}
		den, ok := place(ps, n)
		if !ok {
			continue
		}
		out = append(out, thread(w, pd, den.Hex, []int{den.Region},
			bind(roleNPC, npcOf(fence)), bind(roleNotable, npcOf(notable)), seatAt(roleSeat, den)))
	}
	return found(w, row, out)
}

// watchKnows is the informer: a watch captain, queued as the pending
// candidate's ref, who knows of a den near its settlement. The seat is the
// captain's settlement.
func watchKnows(w World, row Row, _ Params) []Candidate {
	x, ok := w.(Crime)
	if !ok {
		return nil
	}
	ps := w.Places()
	var out []Candidate
	for _, pd := range queued(w, PendInformer) {
		if pd.Ref.Kind != kindNPC {
			continue
		}
		n, d, ok := x.Captain(pd.Char, pd.Ref.ID)
		if !ok {
			continue
		}
		seat, okSeat := place(ps, n)
		den, okDen := place(ps, d)
		if !okSeat || !okDen {
			continue
		}
		out = append(out, thread(w, pd, seat.Hex, regionSet(seat.Region, den.Region),
			bind(roleNPC, pd.Ref), bind(roleDen, SettlementRef(den.N)), seatAt(roleSeat, seat)))
	}
	return found(w, row, out)
}

// thiefInWalls is a thief in the walls: a settlement whose won burglaries
// within walls-days reach walls-burglaries. Beats count in its region.
func thiefInWalls(w World, row Row, p Params) []Candidate {
	return eachPlace(w, row, func(pl PlaceView) (Candidate, bool) {
		if p.WallsBurglaries < 1 || pl.Burgled < p.WallsBurglaries {
			return Candidate{}, false
		}
		causes := recalled(w, p.WallsDays, []string{memTheft}, func(m Memory) bool {
			return m.At == pl.Hex || names(m, SettlementRef(pl.N))
		})
		return atPlace(pl, []int{pl.Region}, pl.Burgled, causes), true
	})
}

func npcOf(id string) fact.Ref { return fact.Ref{Kind: kindNPC, ID: id} }
