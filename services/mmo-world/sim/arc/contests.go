package arc

func init() { Predicates["opposed-goals"] = opposedGoals }

// opposedGoals is the rival claims (GDD 17.6): a contest the game indexed
// as its goals gained contributors, not yet cast, between two different
// standing places, once per pair of seats and front. The front's unrest
// presses; the first seat is where its facts are located.
func opposedGoals(w World, row Row, _ Params) []Candidate {
	e, ok := w.(Emergent)
	if !ok {
		return nil
	}
	ps := w.Places()
	type key struct{ a, b, front int }
	seen := map[key]bool{}
	var out []Candidate
	for _, c := range e.Contests() {
		k := key{c.SeatA, c.SeatB, c.Region}
		if c.SeatA == c.SeatB || c.Region < 0 || seen[k] {
			continue
		}
		a, okA := place(ps, c.SeatA)
		b, okB := place(ps, c.SeatB)
		if !okA || !okB {
			continue
		}
		seen[k] = true
		out = append(out, candidate(a.Hex, regionSet(c.Region, a.Region, b.Region), w.Gauge(c.Region, gaugeUnrest), nil,
			bind("seat-a", SettlementRef(a.N)), bind("seat-b", SettlementRef(b.N)), bind(roleFront, RegionRef(c.Region))))
	}
	return found(w, row, out)
}
