package game

import "jams.team/mmo-world/sim/sheets"

// A settlement's troubles between their casts (GDD 4.8, 4.16, 12.5): the
// director casts each trouble and ends it; the day here wears and mends
// places, ruins a chartered place that lost too many this season, and
// starts the migration on the day a season begins.

// troubleDay runs inside the director's world day, after the stages due
// and before casting.
func (g *Game) troubleDay(day int64) error {
	if g.Story == nil {
		return nil
	}
	t := day * sheets.TicksPerDay
	if err := g.raidDay(t); err != nil {
		return err
	}
	if err := g.keepersMend(); err != nil {
		return err
	}
	if err := g.ruinsDay(t); err != nil {
		return err
	}
	return g.migrationDay(t)
}

// ruinsDay ruins each standing place a guild chartered that has lost
// ruin-troubles troubles this season. Starting settlements and faction
// cities never fall this way.
func (g *Game) ruinsDay(t int64) error {
	most := g.r.Story.RuinTroubles
	if most <= 0 {
		return nil
	}
	for n, p := range g.Places {
		ps := g.storyAt(n)
		if ps == nil || p.Ruined != 0 || !ruinable(p) || ps.Lost < most {
			continue
		}
		if err := refusedIsNothing(g.ruin(n, t)); err != nil {
			return err
		}
	}
	return nil
}

// ruinable reports whether troubles can ruin a place: one a guild
// chartered, not a faction's city.
func ruinable(p *Place) bool { return p.Chartered() && p.Faction == nil }
