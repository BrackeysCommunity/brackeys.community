package arc

func init() {
	Predicates["road-busy"] = roadBusy
	Predicates["caravan-threatened"] = caravanThreatened
}

// Roles the road and caravan templates bind.
const (
	roleRoad    = "road"
	roleRaider  = "raider"
	roleCaravan = "caravan"
	roleFront   = "front"
)

// roadBusy is the road war (GDD 12.9): an awake region whose roads carried
// road-war-load over road-war-days, with a standing raider that does not
// hold it. The road is its busiest road tile; the load presses.
func roadBusy(w World, row Row, p Params) []Candidate {
	e, ok := w.(Emergent)
	if !ok {
		return nil
	}
	fs := w.Factions()
	var out []Candidate
	for _, r := range w.Awake() {
		load, busiest, ok := e.RoadLoad(r)
		if !ok || load < p.RoadWarLoad {
			continue
		}
		raider, ok := e.Raider(r)
		if _, up := faction(fs, raider); !ok || !up || raider == w.Holder(r) {
			continue
		}
		seat, at, ok := seatNear(w, row, roleSeat, busiest)
		if !ok {
			continue
		}
		causes := recalled(w, p.MemoryDays, []string{memRaided, memRaids}, inRegions([]int{r}))
		out = append(out, candidate(at, regionSet(r, w.RegionOf(busiest), w.RegionOf(at)), load, causes,
			bind(roleRoad, TileRef(busiest)), bind(roleRaider, FactionRef(raider)), seat))
	}
	return found(w, row, out)
}

// caravanThreatened is the lost caravan (GDD 12.9): a moving caravan
// whose path ahead crosses an awake region at caravan-threat or more. The
// first such region is the front, and its threat presses.
func caravanThreatened(w World, row Row, p Params) []Candidate {
	e, ok := w.(Emergent)
	if !ok {
		return nil
	}
	up := awakeSet(w)
	var out []Candidate
	for _, cv := range e.Caravans() {
		if cv.Halted {
			continue
		}
		front := -1
		for _, r := range cv.Ahead {
			if up[r] && w.Gauge(r, gaugeThreat) >= p.CaravanThreat {
				front = r
				break
			}
		}
		if front < 0 {
			continue
		}
		seat, at, ok := seatNear(w, row, roleSeat, cv.At)
		if !ok {
			continue
		}
		causes := recalled(w, p.MemoryDays, []string{memRaids, memSurge}, inRegions([]int{front}))
		out = append(out, candidate(at, regionSet(front, w.RegionOf(cv.At), w.RegionOf(at)), w.Gauge(front, gaugeThreat), causes,
			bind(roleCaravan, CaravanRef(cv.ID)), bind(roleFront, RegionRef(front)), seat))
	}
	return found(w, row, out)
}
