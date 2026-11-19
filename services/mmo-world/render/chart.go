package render

import "fmt"

// Series is a line on a chart: one value per world day, with the days a
// cause is marked on (GDD 10.6, 16).
type Series struct {
	Title  string  // what the chart shows, with its unit
	Unit   string  // the value axis's unit
	Days   []int64 // world days, ascending
	Values []int64
	Marks  []int64 // days with a cause
	Band   [2]int64
}

// Chart sizes and colours.
const (
	chartW, chartH = 640, 300
	chartPad       = 48
)

var (
	chartBG   = Hex("#1d1b18")
	chartAxis = Hex("#6f6a60")
	chartLine = Hex("#e0b04a")
	chartMark = Hex("#d0573c")
	chartBand = Alpha(Hex("#5b8a5a"), 0x50)
	chartText = Hex("#f2eee4")
)

// Chart draws a series as a line over days, the value axis on the left
// in its unit, days along the bottom, causes as marks and any band as a
// shaded strip.
func Chart(s Series) *Canvas {
	c := NewCanvas(chartW, chartH, chartBG)
	left, right, top, bottom := float64(chartPad), float64(chartW-chartPad/2), float64(chartPad/2), float64(chartH-chartPad)
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
		c.Line([]Pt{{x(m), top}, {x(m), bottom}}, 1, chartMark)
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
	c.Text(Pt{8, top + 4}, fmt.Sprintf("%d", hi), chartText)
	c.Text(Pt{8, bottom}, fmt.Sprintf("%d", lo), chartText)
	c.Text(Pt{8, top - 8}, s.Unit, chartText)
	c.Text(Pt{left, float64(chartH - 18)}, fmt.Sprintf("day %d", first), chartText)
	end := fmt.Sprintf("day %d", last)
	c.Text(Pt{right - float64(TextWidth(end)), float64(chartH - 18)}, end, chartText)
	c.Label(Pt{left + 8, top + 14}, s.Title)
	return c
}
