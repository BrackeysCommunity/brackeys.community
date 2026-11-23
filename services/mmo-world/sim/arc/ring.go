package arc

import (
	"cmp"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
)

// Ringed is what the waking tower reads beyond World: the ring of eight's
// towers whose guardians stand this season. A World without it never casts
// the waking tower.
type Ringed interface {
	Towers() []hex.Hex
}

// RingWhen is the waking tower's predicate. The director casts it when no
// other world template is, so every season has a world arc.
const RingWhen = "ring-stands"

func init() { Predicates[RingWhen] = ringStands }

// ringStands is the waking tower: while the ring's core is shut, the tower
// nearest the busiest standing place wakes (the lower place, then the
// lower tower, on a tie). Every world has the ring, so this fits any world
// with a place; it presses by the guardians still standing.
func ringStands(w World, row Row, p Params) []Candidate {
	x, ok := w.(Ringed)
	if !ok {
		return nil
	}
	if _, open := w.Core(); open {
		return nil
	}
	var at PlaceView
	got := false
	for _, pl := range w.Places() {
		if standing(pl) && (!got || pl.Users > at.Users) {
			at, got = pl, true
		}
	}
	towers := x.Towers()
	if !got || len(towers) == 0 {
		return nil
	}
	tower := towers[0]
	for _, h := range towers[1:] {
		if cmp.Or(cmp.Compare(hex.Distance(h, at.Hex), hex.Distance(tower, at.Hex)), hex.Compare(h, tower)) < 0 {
			tower = h
		}
	}
	// The season it wakes in is its cause.
	var causes []fact.ID
	for _, m := range w.Recall(memSeasonBegan, p.MemoryDays) {
		if len(causes) == 0 || m.Fact > causes[0] {
			causes = []fact.ID{m.Fact}
		}
	}
	return found(w, row, []Candidate{candidate(at.Hex, regionSet(w.RegionOf(tower), at.Region), int64(len(towers)), causes,
		bind("tower", TileRef(tower)), seatAt(roleSeat, at))})
}
