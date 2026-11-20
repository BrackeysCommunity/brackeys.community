package market

import "jams.team/mmo-world/sim/fixed"

// Day is one world day of a book: its closing price, range, what traded
// and the best bid and ask when it closed. Cause is the fact a mover names
// (GDD 10.6), or 0.
type Day struct {
	Day   int64 `json:"day"`
	End   int64 `json:"end"` // the tick it closed
	Open  int64 `json:"open,omitempty"`
	Close int64 `json:"close,omitempty"`
	High  int64 `json:"high,omitempty"`
	Low   int64 `json:"low,omitempty"`
	Units int64 `json:"units,omitempty"`
	Coin  int64 `json:"coin,omitempty"`
	Bid   int64 `json:"bid,omitempty"`
	Ask   int64 `json:"ask,omitempty"`
	Cause int64 `json:"cause,omitempty"`
}

// Record adds a fill to the day's tape.
func (b *Book) Record(f Fill) {
	d := &b.Today
	if d.Units == 0 {
		d.Open, d.High, d.Low = f.Price, f.Price, f.Price
	}
	d.High, d.Low = max(d.High, f.Price), min(d.Low, f.Price)
	d.Close = f.Price
	d.Units += f.Qty
	d.Coin += f.Qty * f.Price
	b.Last, b.LastTick = f.Price, f.Tick
}

// CloseDay ends world day day at tick end, keeping at most keep days. A
// day with no trade closes at the last price.
func (b *Book) CloseDay(day, end, keep int64, cause int64) Day {
	d := b.Today
	d.Day, d.End, d.Cause = day, end, cause
	if d.Units == 0 {
		d.Open, d.Close, d.High, d.Low = b.Last, b.Last, b.Last, b.Last
	}
	d.Bid, d.Ask = b.Best()
	b.Days = append(b.Days, d)
	if over := int64(len(b.Days)) - keep; over > 0 {
		b.Days = b.Days[over:]
	}
	b.Today = Day{}
	return d
}

// PriceAt is the price known at tick: the last fill if it is no newer,
// else the close of the last day ended by then; 0 when nothing had traded.
func (b *Book) PriceAt(tick int64) (price, asOf int64) {
	if b.LastTick <= tick {
		return b.Last, b.LastTick
	}
	for i := len(b.Days) - 1; i >= 0; i-- {
		if b.Days[i].End <= tick {
			return b.Days[i].Close, b.Days[i].End
		}
	}
	return 0, 0
}

// Change is the change in per cent of the last price against the close
// days back (or the oldest kept), and false with no price then.
func (b *Book) Change(days int) (int64, bool) {
	if len(b.Days) == 0 || b.Last == 0 {
		return 0, false
	}
	i := max(0, len(b.Days)-days)
	return pctChange(b.Last, b.Days[i].Close)
}

// ClosedChange is the change in per cent of the last day's close against
// the day before's, and false without both.
func (b *Book) ClosedChange() (int64, bool) {
	n := len(b.Days)
	if n <= 1 {
		return 0, false
	}
	return pctChange(b.Days[n-1].Close, b.Days[n-1-1].Close)
}

// pctChange is now against was in per cent, and false without both.
func pctChange(now, was int64) (int64, bool) {
	if was == 0 || now == 0 {
		return 0, false
	}
	return fixed.Ratio((now-was)*fixed.Hundredths, was).Int(), true
}

// Cause is the newest cause among the last days, or 0.
func (b *Book) Cause(days int) int64 {
	for i := len(b.Days) - 1; i >= max(0, len(b.Days)-days); i-- {
		if c := b.Days[i].Cause; c != 0 {
			return c
		}
	}
	return 0
}

// Traded is the units and coin traded over the last days closed, and
// today with today set.
func (b *Book) Traded(days int, today bool) (units, coin int64) {
	if today {
		units, coin = b.Today.Units, b.Today.Coin
	}
	for _, d := range b.Days[max(0, len(b.Days)-days):] {
		units += d.Units
		coin += d.Coin
	}
	return units, coin
}
