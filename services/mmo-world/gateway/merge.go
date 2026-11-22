package gateway

import (
	"context"
	"slices"
	"sync"
	"time"

	"jams.team/mmo-world/api"
)

// mergedLog is one party machine's log, kept by context: every seat's
// moves in the order they landed, each stamped with its seat and an At no
// earlier than the one before (GDD 7.11). It lives only in memory, so a
// gateway restarted mid-machine has lost the moves, and the countdown
// ends the machine with none.
type mergedLog struct {
	key     string // the context
	armedAt int64

	mu        sync.Mutex
	seat0     string // whose write ends it; its key names the machine
	source    string
	due       int64
	moves     []api.PuzzleMove
	stop      func() // the countdown's timer, while one is set
	sent      bool   // the one merged solve is being or has been written
	gone      bool   // the machine is over; the record is to be dropped
	rejudging bool   // a rejudge timer is pending
}

// partySeat is the party machine a seat's last state shows armed.
type partySeat struct {
	key     string
	armedAt int64
	seat    int64
	source  string
}

// contextKey names a context in one string, as the host names it.
func contextKey(c api.Context) string { return c.Kind + ":" + c.ID }

// keepParty sets, moves or replaces a context's countdown from the host's
// record of its machine. A record older than the one kept is a stale read.
func (g *Gateway) keepParty(rec api.ArmedMachine, source string) {
	g.cmu.Lock()
	defer g.cmu.Unlock()
	ml := g.contexts[rec.Context]
	if ml != nil && ml.armedAt > rec.ArmedAt {
		return
	}
	if ml != nil && (ml.armedAt < rec.ArmedAt || rec.Due == 0) {
		ml.end()
		delete(g.contexts, rec.Context)
		ml = nil
	}
	if rec.Due == 0 {
		return
	}
	if ml == nil {
		ml = &mergedLog{key: rec.Context, armedAt: rec.ArmedAt}
		g.contexts[rec.Context] = ml
	}
	ml.mu.Lock()
	defer ml.mu.Unlock()
	ml.seat0 = rec.CharacterID
	if source != "" {
		ml.source = source
	}
	if ml.sent || ml.gone || (ml.stop != nil && ml.due == rec.Due) {
		return
	}
	if ml.stop != nil {
		ml.stop()
		ml.stop = nil
	}
	ml.due = rec.Due
	if !g.isClosed() {
		ml.arm(g, max(0, time.UnixMilli(rec.Due).Sub(g.clock.Now())+expirySlack))
	}
}

// arm sets the countdown's timer; the caller holds the log's lock.
func (ml *mergedLog) arm(g *Gateway, wait time.Duration) {
	ml.stop = g.clock.AfterFunc(wait, func() { g.expireParty(ml) })
}

// end stops the countdown of a log that is no longer kept.
func (ml *mergedLog) end() {
	ml.mu.Lock()
	defer ml.mu.Unlock()
	ml.gone = true
	if ml.stop != nil {
		ml.stop()
		ml.stop = nil
	}
}

// endParties stops every party countdown, at close.
func (g *Gateway) endParties() {
	g.cmu.Lock()
	defer g.cmu.Unlock()
	for key, ml := range g.contexts {
		ml.end()
		delete(g.contexts, key)
	}
}

// dropIfGone forgets a log once its machine is over; the caller holds
// no lock of it.
func (g *Gateway) dropIfGone(ml *mergedLog) {
	g.cmu.Lock()
	defer g.cmu.Unlock()
	ml.mu.Lock()
	gone := ml.gone
	ml.mu.Unlock()
	if gone && g.contexts[ml.key] == ml {
		delete(g.contexts, ml.key)
	}
}

// partyOf is the log kept for a context's machine, or nil.
func (g *Gateway) partyOf(key string, armedAt int64) *mergedLog {
	g.cmu.Lock()
	defer g.cmu.Unlock()
	if ml := g.contexts[key]; ml != nil && ml.armedAt == armedAt {
		return ml
	}
	return nil
}

// partyShown keeps a context's countdown in step with a state that shows
// its machine armed; the host is asked only when the gateway has no
// record of that machine on that due.
func (g *Gateway) partyShown(ctx context.Context, id string, ps partySeat, due int64) {
	if ml := g.partyOf(ps.key, ps.armedAt); ml != nil {
		ml.mu.Lock()
		same := ml.due == due && ml.source != ""
		ml.mu.Unlock()
		if same {
			return
		}
	}
	m, ok := g.countdown(ctx, id)
	if !ok || m.Context != ps.key {
		return
	}
	g.keepParty(m, ps.source)
}

// expireParty ends a party machine whose countdown ran out: the merged log
// so far, written once under the machine's key, so a solve the Judge
// found and this end are one write.
func (g *Gateway) expireParty(ml *mergedLog) {
	defer g.dropIfGone(ml)
	ml.mu.Lock()
	defer ml.mu.Unlock()
	ml.stop = nil
	if ml.sent || ml.gone {
		return
	}
	if g.isClosed() {
		return
	}
	ctx, cancel := context.WithTimeout(g.ctx, hostWait)
	defer cancel()
	m, ok, err := g.cfg.Host.Countdown(ctx, ml.seat0)
	if err != nil {
		g.log.Error("activity: ending a party's countdown", "context", ml.key, "err", err.Error())
		ml.arm(g, retryWait)
		return
	}
	if !ok || m.Context != ml.key || m.ArmedAt != ml.armedAt || m.Due == 0 {
		// Solved, or ended some other way: nothing is left to end.
		ml.gone = true
		return
	}
	if now := g.clock.Now().UnixMilli(); now < m.Due {
		ml.due = m.Due
		ml.arm(g, time.UnixMilli(m.Due).Sub(g.clock.Now())+expirySlack)
		return
	}
	if !g.writeMerged(ctx, ml, len(ml.moves)) {
		ml.arm(g, retryWait)
	}
}

// finishParty writes the merged solve once the Judge has found the log
// done or broken at its first n moves.
func (g *Gateway) finishParty(ctx context.Context, ml *mergedLog, n int) {
	defer g.dropIfGone(ml)
	ml.mu.Lock()
	defer ml.mu.Unlock()
	if ml.sent || ml.gone {
		return
	}
	if !g.writeMerged(ctx, ml, n) {
		g.rejudgeLater(ml)
	}
}

// isClosed reads whether the gateway has closed.
func (g *Gateway) isClosed() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.closed
}

// judgeMerged judges a merged log of n moves: a failed Judge is tried again
// later, and a done or broken log is written.
func (g *Gateway) judgeMerged(ctx context.Context, ml *mergedLog, char string, log api.PuzzleLog, n int, what string) {
	status, err := g.cfg.Host.Judge(ctx, char, log)
	if err != nil {
		g.log.Error(what, "context", ml.key, "err", err.Error())
		ml.mu.Lock()
		g.rejudgeLater(ml)
		ml.mu.Unlock()
		return
	}
	if status == JudgeDone || status == JudgeBroke {
		g.finishParty(ctx, ml, n)
	}
}

// rejudge judges a merged log again after a Judge or a merged write failed:
// left to the countdown, the write would come after the grace and always
// haywire.
func (g *Gateway) rejudge(ml *mergedLog) {
	if g.isClosed() {
		return
	}
	ml.mu.Lock()
	ml.rejudging = false
	if ml.sent || ml.gone {
		ml.mu.Unlock()
		return
	}
	log := api.PuzzleLog{Moves: slices.Clone(ml.moves)}
	n, seat0 := len(log.Moves), ml.seat0
	ml.mu.Unlock()
	ctx, cancel := context.WithTimeout(g.ctx, hostWait)
	defer cancel()
	g.judgeMerged(ctx, ml, seat0, log, n, "activity: judging a party's merged log again")
}

// rejudgeLater arms a judging of the merged log again. The caller holds
// ml.mu; one is armed at a time, however many failures ask for it.
func (g *Gateway) rejudgeLater(ml *mergedLog) {
	if ml.rejudging {
		return
	}
	ml.rejudging = true
	g.clock.AfterFunc(expirySlack, func() { g.rejudge(ml) })
}

// writeMerged writes a context's one machine-solve with its first n moves;
// the caller holds the log's lock, so no move lands meanwhile and no
// second write starts. false is a failure that is not the rules' answer,
// to be tried again.
func (g *Gateway) writeMerged(ctx context.Context, ml *mergedLog, n int) bool {
	ml.sent = true
	req := api.ActionRequest{InteractionID: expiryKey(ml.seat0, ml.armedAt), CharacterID: ml.seat0, Kind: api.ActMachineSolve,
		Machine: &api.MachineIntent{Source: ml.source, Log: &api.PuzzleLog{Moves: slices.Clone(ml.moves[:n:n])}}}
	if req.Machine.Log.Moves == nil {
		req.Machine.Log.Moves = []api.PuzzleMove{}
	}
	_, ref, err := g.cfg.Host.Act(ctx, req, false)
	if err != nil {
		g.log.Error("activity: writing a party's merged log", "context", ml.key, "err", err.Error())
		ml.sent = false
		return false
	}
	if ref != nil && ref.Code != api.CodeNoMachine && ref.Code != api.CodeRivalWon {
		g.log.Warn("activity: a party's merged log was refused", "context", ml.key, "code", ref.Code)
	}
	ml.gone = true
	if ml.stop != nil {
		ml.stop()
		ml.stop = nil
	}
	return true
}
