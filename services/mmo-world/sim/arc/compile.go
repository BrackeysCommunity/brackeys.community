package arc

import (
	"fmt"

	"jams.team/mmo-world/sim/sheets"
)

// Compile resolves every template's predicate: arcs, then troubles, then
// occasions, each in sheet order.
func Compile(b *sheets.Book) ([]Template, error) {
	var out []Template
	add := func(sheet string, r Row) error {
		p, ok := Predicates[r.When]
		if !ok {
			return fmt.Errorf("arc: %s row %q names predicate %q, which sim/arc does not have", sheet, r.ID, r.When)
		}
		out = append(out, Template{Row: r, When: p})
		return nil
	}
	for i := range b.Arcs {
		a := &b.Arcs[i]
		if err := add("story.arcs", Row{ID: a.ID, Scope: a.Scope, When: a.When, Chance: a.Chance, Cast: a.Cast, Stages: a.Stages, Arc: a}); err != nil {
			return nil, err
		}
	}
	for i := range b.Troubles {
		t := &b.Troubles[i]
		if err := add("story.troubles", Row{ID: t.ID, Scope: Settlement, When: t.When, Chance: t.Chance, Trouble: t}); err != nil {
			return nil, err
		}
	}
	for i := range b.Occasions {
		o := &b.Occasions[i]
		if err := add("story.occasions", Row{ID: o.ID, Scope: Settlement, When: o.When, Chance: o.Chance, Occasion: o}); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// Params are the story.params cells, and the emergence.params cells the
// predicates read, by name. Days stay days and percents stay percents;
// callers turn days into ticks.
type Params struct {
	ChronicleMinWeight, ChronicleLines                               int64
	SeasonDays, SeasonZeroDays, ActiveDays                           int64
	MarkFloorCharacters, StageDaysLeast, StageDaysMost               int64
	SidePay, SidePayOther, SideBudgetShare, BeatCoin                 int64
	StandingFor, StandingAgainst, ShunnedBelow, MarkedAmbush         int64
	MemoryWeight, MemoryKept, MemoryDays, PendingKept, KeptArcDays   int64
	RaidMark, KeeperWatch, KeeperMend, RuinTroubles                  int64
	FrontJoined, FrontSpread, FrontSpreadDays                        int64
	ColdShare, ColdDays, ColdRegions, WetShare, WetDays, WetScarcity int64
	SeamBelow, SeamStock, SeamRadius, PanicStarvingDays              int64
	CaravanPassages, CaravanShare, CaravanPremium                    int64
	FeesRaised, PricesCut, SickShare                                 int64
	RivalDistance, RivalGrowthDays, DefectorLoyalty                  int64
	BetrayalDays, LeaderDiedDays, ReturnDays, ThreadStanding         int64
	ThreadMark, FinaleLapseBonus, FinaleLossWeight                   int64
	HaywireLeast, HaywireMost, BeaconCost, ChainDistance, ChainTries int64
	StockedWallDefence                                               int64
	RoadWarLoad, CaravanThreat                                       int64
	OffersFloor, OffersPerThousand, OfferRestDays                    int64
}

// ParamsOf reads them; a missing cell panics, as every params reader does.
func ParamsOf(b *sheets.Book) Params {
	i := func(id string) int64 { return sheets.IntParam(b.StoryParams, id) }
	em := func(id string) int64 { return sheets.IntParam(b.EmergenceParams, id) }
	return Params{
		ChronicleMinWeight:  i("chronicle-min-weight"),
		ChronicleLines:      i("chronicle-lines"),
		SeasonDays:          i("season-days"),
		SeasonZeroDays:      i("season-zero-days"),
		ActiveDays:          i("active-days"),
		MarkFloorCharacters: i("mark-floor-characters"),
		StageDaysLeast:      i("stage-days-least"),
		StageDaysMost:       i("stage-days-most"),
		SidePay:             i("side-pay"),
		SidePayOther:        i("side-pay-other"),
		SideBudgetShare:     i("side-budget-share"),
		BeatCoin:            i("beat-coin"),
		StandingFor:         i("standing-for"),
		StandingAgainst:     i("standing-against"),
		ShunnedBelow:        i("shunned-below"),
		MarkedAmbush:        i("marked-ambush"),
		MemoryWeight:        i("memory-weight"),
		MemoryKept:          i("memory-kept"),
		MemoryDays:          i("memory-days"),
		PendingKept:         i("pending-kept"),
		KeptArcDays:         i("kept-arc-days"),
		RaidMark:            i("raid-mark"),
		KeeperWatch:         i("keeper-watch"),
		KeeperMend:          i("keeper-mend"),
		RuinTroubles:        i("ruin-troubles"),
		FrontJoined:         i("front-joined"),
		FrontSpread:         i("front-spread"),
		FrontSpreadDays:     i("front-spread-days"),
		ColdShare:           i("cold-share"),
		ColdDays:            i("cold-days"),
		ColdRegions:         i("cold-regions"),
		WetShare:            i("wet-share"),
		WetDays:             i("wet-days"),
		WetScarcity:         i("wet-scarcity"),
		SeamBelow:           i("seam-below"),
		SeamStock:           i("seam-stock"),
		SeamRadius:          i("seam-radius"),
		PanicStarvingDays:   i("panic-starving-days"),
		CaravanPassages:     i("caravan-passages"),
		CaravanShare:        i("caravan-share"),
		CaravanPremium:      i("caravan-premium"),
		FeesRaised:          i("fees-raised"),
		PricesCut:           i("prices-cut"),
		SickShare:           i("sick-share"),
		RivalDistance:       i("rival-distance"),
		RivalGrowthDays:     i("rival-growth-days"),
		DefectorLoyalty:     i("defector-loyalty"),
		BetrayalDays:        i("betrayal-days"),
		LeaderDiedDays:      i("leader-died-days"),
		ReturnDays:          i("return-days"),
		ThreadStanding:      i("thread-standing"),
		ThreadMark:          i("thread-mark"),
		FinaleLapseBonus:    i("finale-lapse-bonus"),
		FinaleLossWeight:    i("finale-loss-weight"),
		HaywireLeast:        i("haywire-least"),
		HaywireMost:         i("haywire-most"),
		BeaconCost:          i("beacon-cost"),
		ChainDistance:       i("chain-distance"),
		ChainTries:          i("chain-tries"),
		StockedWallDefence:  i("stocked-wall-defence"),
		OffersFloor:         i("offers-floor"),
		OffersPerThousand:   i("offers-per-thousand"),
		OfferRestDays:       i("offer-rest-days"),
		RoadWarLoad:         em("road-war-load"),
		CaravanThreat:       em("caravan-threat"),
	}
}
