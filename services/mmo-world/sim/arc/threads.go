package arc

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

// structural: the personal predicates' names.
const (
	whenNPCOwed    = "npc-owed"
	whenCameBack   = "came-back"
	whenVowBroken  = "vow-broken"
	whenLostToThem = "lost-to-them"
)

func init() {
	Predicates[whenNPCOwed] = npcOwed
	Predicates[whenCameBack] = cameBack
	Predicates[whenVowBroken] = vowBroken
	Predicates[whenLostToThem] = lostToThem
}

// queued is each character's oldest pending candidate of kind, by
// character; personal threads cast only from these.
func queued(w World, kind string) []Pending {
	ps := slices.Clone(w.Pending(kind))
	slices.SortStableFunc(ps, func(a, b Pending) int {
		return cmp.Or(cmp.Compare(a.Char, b.Char), cmp.Compare(a.Tick, b.Tick), cmp.Compare(a.Fact, b.Fact))
	})
	return slices.CompactFunc(ps, func(a, b Pending) bool { return a.Char == b.Char })
}

// thread starts a personal candidate from a pending one: the older it is,
// the higher its pressure.
func thread(w World, pd Pending, seat hex.Hex, regions []int, cast ...Binding) Candidate {
	var causes []fact.ID
	if pd.Fact != 0 {
		causes = []fact.ID{pd.Fact}
	}
	cast = append(cast, bind("character", fact.Ref{Kind: kindCharacter, ID: pd.Char}))
	return Candidate{Cast: cast, Regions: regions, Seat: seat, Causes: causes, Pressure: max(w.Day()-dayOf(pd.Tick), 0), Char: pd.Char, Place: -1, From: &pd, Via: pd.Faction()}
}

// npcOwed is the debt: an NPC queued a visit about something it owes or
// is owed (or a faction's notables offered one at thread-standing, which
// the game queues the same way). The seat is the NPC's home.
func npcOwed(w World, row Row, _ Params) []Candidate {
	x, ok := w.(Extra)
	if !ok {
		return nil
	}
	var out []Candidate
	for _, pd := range queued(w, PendDebt) {
		if pd.Ref.Kind != kindNPC {
			continue
		}
		home, ok := x.Home(pd.Ref.ID)
		if !ok {
			continue
		}
		seat, at, ok := seatNear(w, row, roleSeat, home)
		if !ok {
			continue
		}
		out = append(out, thread(w, pd, at, regionSet(w.RegionOf(home), w.RegionOf(at)), bind("npc", pd.Ref), seat))
	}
	return found(w, row, out)
}

// cameBack is the return: a character back after return-days away, the
// place it last visited as home and the nearest other standing place as
// elsewhere.
func cameBack(w World, row Row, _ Params) []Candidate {
	ps := w.Places()
	var out []Candidate
	for _, pd := range queued(w, PendReturn) {
		n, ok := RefIndex(pd.Ref)
		if pd.Ref.Kind != kindSettlement || !ok {
			continue
		}
		home, ok := place(ps, n)
		if !ok {
			continue
		}
		other, ok := nearestTo(ps, home.Hex, func(o PlaceView) bool { return o.N != home.N })
		if !ok {
			continue
		}
		out = append(out, thread(w, pd, home.Hex, regionSet(home.Region, other.Region),
			bind("home", SettlementRef(home.N)), bind("elsewhere", SettlementRef(other.N))))
	}
	return found(w, row, out)
}

// vowBroken is the oath: a character broke a vow on a board that still
// stands.
func vowBroken(w World, row Row, _ Params) []Candidate {
	ps := w.Places()
	var out []Candidate
	for _, pd := range queued(w, PendOath) {
		n, ok := RefIndex(pd.Ref)
		if pd.Ref.Kind != kindSettlement || !ok {
			continue
		}
		board, ok := place(ps, n)
		if !ok {
			continue
		}
		out = append(out, thread(w, pd, board.Hex, []int{board.Region}, bind("board", SettlementRef(board.N))))
	}
	return found(w, row, out)
}

// lostToThem is the rival: a character's side beat a faction that still
// has a living leading notable to bear the grudge. The seat is nearest
// the faction's seat.
func lostToThem(w World, row Row, _ Params) []Candidate {
	fs := w.Factions()
	var out []Candidate
	for _, pd := range queued(w, PendRival) {
		fi, ok := RefIndex(pd.Ref)
		if pd.Ref.Kind != kindFaction || !ok {
			continue
		}
		f, ok := faction(fs, fi)
		if !ok {
			continue
		}
		i := slices.IndexFunc(f.Notables, func(n NotableView) bool { return n.Leading && !n.Dead })
		if i < 0 {
			continue
		}
		seat, at, ok := seatNear(w, row, roleSeat, w.RegionHex(f.Seat))
		if !ok {
			continue
		}
		out = append(out, thread(w, pd, at, regionSet(f.Seat, w.RegionOf(at)),
			bind("faction", FactionRef(fi)), bind("notable", notableRef(f.Notables[i].ID)), seat))
	}
	return found(w, row, out)
}
