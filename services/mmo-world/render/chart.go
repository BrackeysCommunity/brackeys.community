package render

import "fmt"

// Series is a line on a chart: one value per world day, with the days a
// cause is marked on (GDD 10.6, 16.4).
type Series struct {
	Title  string  // what the chart shows
	Unit   string  // the value axis's unit, as "coin per ore"
	XLabel string  // the day axis's unit: days
	Days   []int64 // world days, ascending
	Values []int64
	Marks  []Mark // the days a cause is marked on, in day order
	Band   [2]int64
}

// Mark is a cause marked on a chart: its day, the fact, and the letter
// drawn at the top of its line, which a card keys to the cause.
type Mark struct {
	Day   int64  `json:"day"`
	Fact  int64  `json:"fact"`
	Label string `json:"label"` // A, B, C in day order
}

// Mark adds a cause on a day after every mark so far, lettered next.
func (s *Series) Mark(day, fact int64) {
	s.Marks = append(s.Marks, Mark{Day: day, Fact: fact, Label: MarkLabel(len(s.Marks))})
}

// MarkLabel is the letter of the i-th mark: A to Z, then AA, AB and on,
// as spreadsheet columns are lettered.
func MarkLabel(i int) string {
	out := ""
	for n := i + 1; n > 0; n = (n - 1) / 26 {
		out = string(rune('A'+(n-1)%26)) + out
	}
	return out
}

// Chart sizes and colours.
const (
	chartW, chartH = 640, 300
	chartPad       = 48
	chartTop       = 40 // room above the plot for the unit, title and letters
)

var (
	chartBG   = Hex("#1d1b18")
	chartAxis = Hex("#6f6a60")
	chartLine = Hex("#e0b04a")
	chartMark = Hex("#d0573c")
	chartBand = Alpha(Hex("#5b8a5a"), 0x50)
	chartText = Hex("#f2eee4")
)

// Chart draws a series as a line over days: the unit at the top left
// over the value axis, days along the bottom with the day axis's label,
// each cause as a line lettered at its top, and any band as a shaded
// strip.
func Chart(s Series) *Canvas {
	c := NewCanvas(chartW, chartH, chartBG)
	left, right, top, bottom := float64(chartPad), float64(chartW-chartPad/2), float64(chartTop), float64(chartH-chartPad)
	lo, hi := int64(0), int64(1)
	for _, v := range s.Values {
		hi = max(hi, v)
	}
	if s.Band[1] > 0 {
		hi = max(hi, s.Band[1])
	}
	hi += hi / 10
	first, last := int64(0), int64(1)
	if n := len(s.Days); n > 0 {
		first, last = s.Days[0], max(s.Days[n-1], s.Days[0]+1)
	}
	x := func(day int64) float64 { return left + (right-left)*float64(day-first)/float64(last-first) }
	y := func(v int64) float64 { return bottom - (bottom-top)*float64(v-lo)/float64(hi-lo) }
	if s.Band[1] > 0 {
		c.Fill([][]Pt{{{left, y(s.Band[1])}, {right, y(s.Band[1])}, {right, y(s.Band[0])}, {left, y(s.Band[0])}}}, chartBand)
	}
	c.Line([]Pt{{left, top}, {left, bottom}, {right, bottom}}, 1, chartAxis)
	for _, m := range s.Marks {
		c.Line([]Pt{{x(m.Day), top}, {x(m.Day), bottom}}, 1, chartMark)
	}
	var pts []Pt
	for i, d := range s.Days {
		pts = append(pts, Pt{x(d), y(s.Values[i])})
	}
	if len(pts) == 1 {
		pts = append(pts, Pt{right, pts[0].Y})
	}
	if len(pts) > 1 {
		c.Line(pts, 2, chartLine)
	}
	for _, m := range s.Marks {
		w := float64(TextWidth(m.Label))
		c.Label(Pt{x(m.Day) - w/2, top - 6}, m.Label)
	}
	c.Text(Pt{8, top + 12}, fmt.Sprintf("%d", hi), chartText)
	c.Text(Pt{8, bottom}, fmt.Sprintf("%d", lo), chartText)
	c.Text(Pt{8, 14}, s.Unit, chartText)
	if s.Title != "" {
		c.Label(Pt{right - float64(TextWidth(s.Title)), 14}, s.Title)
	}
	c.Text(Pt{left, float64(chartH - 18)}, fmt.Sprintf("day %d", first), chartText)
	end := fmt.Sprintf("day %d", last)
	c.Text(Pt{right - float64(TextWidth(end)), float64(chartH - 18)}, end, chartText)
	if s.XLabel != "" {
		c.Text(Pt{(left+right)/2 - float64(TextWidth(s.XLabel))/2, float64(chartH - 18)}, s.XLabel, chartText)
	}
	return c
}
