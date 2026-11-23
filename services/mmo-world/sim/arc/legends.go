package arc

func init() { Predicates["legend-near"] = legendNear }

// roleLegend is the legend the legend wakes binds.
const roleLegend = "legend"

// legendNear is the legend wakes (GDD 13.2): an unlaid legend not cast
// within legend-rest-days, in an awake region with a standing place. Its
// region's threat presses.
func legendNear(w World, row Row, _ Params) []Candidate {
	e, ok := w.(Emergent)
	if !ok {
		return nil
	}
	up := awakeSet(w)
	ps := w.Places()
	var out []Candidate
	for _, l := range e.Legends() {
		if l.Rested || !up[l.Region] {
			continue
		}
		if _, ok := nearestTo(ps, l.At, func(pl PlaceView) bool { return pl.Region == l.Region }); !ok {
			continue
		}
		seat, at, ok := seatNear(w, row, roleSeat, l.At)
		if !ok {
			continue
		}
		out = append(out, candidate(at, regionSet(l.Region, w.RegionOf(at)), w.Gauge(l.Region, gaugeThreat), nil,
			bind(roleLegend, LegendRef(l.ID)), bind(RoleFront, RegionRef(l.Region)), seat))
	}
	return found(w, row, out)
}
