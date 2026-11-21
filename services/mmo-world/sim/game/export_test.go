package game

import (
	"fmt"
	"maps"
)

// OpenIndexFault says how the kept count of open orders is wrong: out of
// step with the market, so that it would be counted afresh, or not what a
// walk of the books finds. "" when it is sound or not yet built.
func (g *Game) OpenIndexFault() string {
	m := g.Market
	if m == nil || m.open.by == nil {
		return ""
	}
	if m.open.seq != m.Seq || m.open.size != m.size() {
		return fmt.Sprintf("out of step: kept at seq %d, size %d; the market is at seq %d, size %d", m.open.seq, m.open.size, m.Seq, m.size())
	}
	want := map[string]int64{}
	for o := range g.opens("", false) {
		want[o.Owner]++
	}
	if !maps.Equal(want, m.open.by) {
		return fmt.Sprintf("kept %v, the books hold %v", m.open.by, want)
	}
	return ""
}
