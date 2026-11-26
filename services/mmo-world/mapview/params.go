package mapview

import "jams.team/mmo-world/sim/sheets"

// Params are the view's numbers mapview reads (pack.map-view).
type Params struct{ BusyLight, BusyBusy, BusyCrowded, BusyDistinct int64 }

// ParamsOf reads the busy bands from a book whose pack passed
// render.MapStyleProblems.
func ParamsOf(b *sheets.Book) Params {
	return Params{
		BusyLight:    sheets.IntParam(b.MapView, "busy-light"),
		BusyBusy:     sheets.IntParam(b.MapView, "busy-busy"),
		BusyCrowded:  sheets.IntParam(b.MapView, "busy-crowded"),
		BusyDistinct: sheets.IntParam(b.MapView, "busy-distinct"),
	}
}
