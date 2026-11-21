package puzzle

// structural: a family on the clock runs twenty model steps a second. The
// layout carries it so a client's model steps the same.
const stepMs = 50

// clock is the step clock a timed family embeds: step k happens at k
// times the step, and a move applies after every step up to its stamp.
type clock struct {
	step int64 // ms
	n    int64 // steps run
}

func newClock(l *Layout) clock { return clock{step: max(l.Step, 1)} }

// run takes the model to at ms, one tick a step, and stops at the first
// step that solves or breaks it.
func (c *clock) run(at int64, tick func(k int64) Status) (Status, int64) {
	for due := at / c.step; c.n < due; {
		c.n++
		if st := tick(c.n); st != Going {
			return st, c.n * c.step
		}
	}
	return Going, at
}

// seconds is a cell in seconds as model steps.
func seconds(s int64) int64 { return s * msPerSecond / stepMs }
