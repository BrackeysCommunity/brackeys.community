// Package align is alignment's arithmetic (GDD 5.10): its bands, the
// depth rule that slows a climb back toward zero, and the daily caps on
// good acts. It works in whole points and holds no state.
package align

import "jams.team/mmo-world/sim/sheets"

// Params are the alignment.params cells.
type Params struct {
	Min, Max, Depth, GoodDay, PairDay, KnownKept, KnowDays, GoalRewardLeast int64
}

// ParamsOf reads the alignment.params sheet.
func ParamsOf(rows []sheets.Param) Params {
	i := func(id string) int64 { return sheets.IntParam(rows, id) }
	return Params{Min: i("min"), Max: i("max"), Depth: i("depth"), GoodDay: i("good-day"), PairDay: i("pair-day"),
		KnownKept: i("known-kept"), KnowDays: i("know-days"), GoalRewardLeast: i("goal-reward-least")}
}

// Band is one alignment band, From to To inclusive.
type Band struct {
	ID       string
	From, To int64
}

// BandsOf reads the alignment.bands sheet, lowest first.
func BandsOf(rows []sheets.AlignBand) []Band {
	out := make([]Band, len(rows))
	for i, r := range rows {
		out[i] = Band{ID: r.ID, From: r.From, To: r.To}
	}
	return out
}

// BandOf is the band a value lies in; a value past either end reads as
// the band at that end.
func BandOf(bands []Band, v int64) string {
	if len(bands) == 0 {
		return ""
	}
	for _, b := range bands {
		if v >= b.From && v <= b.To {
			return b.ID
		}
	}
	if v < bands[0].From {
		return bands[0].ID
	}
	return bands[len(bands)-1].ID
}

// structural: halves, for rounding half up in whole points.
const half = 2

// Deepen is the move an act makes from value: away from zero (or from
// zero) it is whole; toward zero it shrinks by the share of depth the
// value already lies from zero, rounded half up, and is never under 1.
func Deepen(p Params, value, move int64) int64 {
	if move == 0 || value == 0 || (value > 0) == (move > 0) {
		return move
	}
	m, a := abs(move), abs(value)
	room := max(0, p.Depth-a)
	n := max(1, (half*m*room+p.Depth)/(half*p.Depth))
	if move < 0 {
		return -n
	}
	return n
}

// Capped holds a good move to what is left of the day's good-day and,
// for a paired act, of the pair's pair-day; the excess is dropped. A bad
// move passes whole.
func Capped(p Params, move, goodToday, pairToday int64, paired bool) int64 {
	if move <= 0 {
		return move
	}
	room := p.GoodDay - goodToday
	if paired {
		room = min(room, p.PairDay-pairToday)
	}
	return max(0, min(move, room))
}

// TheftMove is the move a theft asks: a point per perCoin of worth, at
// least least, downward.
func TheftMove(perCoin, least, worth int64) int64 {
	n := least
	if perCoin > 0 {
		n = max(least, worth/perCoin)
	}
	return -n
}

// Clamp holds a value inside min and max.
func Clamp(p Params, v int64) int64 { return min(p.Max, max(p.Min, v)) }

func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}
