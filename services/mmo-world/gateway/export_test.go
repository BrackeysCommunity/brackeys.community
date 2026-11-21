package gateway

import (
	"slices"
	"time"

	"jams.team/mmo-world/api"
)

// MaxUnseated is how many sockets may wait to say hello.
const MaxUnseated = maxUnseated

// MaxSeats is how many seats one Discord user may hold.
const MaxSeats = maxSeats

// MaxLooks is how many looks a character's seats may send in a second.
const MaxLooks = maxLooks

// Settle waits until every notice from the host has been acted on.
func (g *Gateway) Settle() { g.settle() }

// Waits shortens the hello and ping waits, before the handler serves.
func (g *Gateway) Waits(hello, ping time.Duration) { g.helloWait, g.pingEvery = hello, ping }

// Sockets counts the sockets open.
func (g *Gateway) Sockets() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.conns)
}

// Countdowns counts the timers set: characters' own, and parties'.
func (g *Gateway) Countdowns() int {
	g.mu.Lock()
	n := 0
	for _, p := range g.players {
		if p.timer != nil {
			n++
		}
	}
	g.mu.Unlock()
	g.cmu.Lock()
	defer g.cmu.Unlock()
	for _, ml := range g.contexts {
		ml.mu.Lock()
		if ml.stop != nil {
			n++
		}
		ml.mu.Unlock()
	}
	return n
}

// Merged is the merged log a gateway keeps for a context, and whether it
// keeps one.
func (g *Gateway) Merged(context string) ([]api.PuzzleMove, bool) {
	g.cmu.Lock()
	defer g.cmu.Unlock()
	ml := g.contexts[context]
	if ml == nil {
		return nil, false
	}
	ml.mu.Lock()
	defer ml.mu.Unlock()
	return slices.Clone(ml.moves), true
}

// MaxMoves is how many moves a character's seats may send in a second.
const MaxMoves = maxMoves

// Settle waits until every notice from the host has been acted on.
func (t *Timers) Settle() { t.settle() }

// Pending counts the windows the timers will end.
func (t *Timers) Pending() int {
	t.mu.Lock()
	defer t.mu.Unlock()
	return len(t.windows)
}

// Players counts the characters the gateway keeps a record of.
func (g *Gateway) Players() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.players)
}

// SessionOf is the session of an instance, or nil.
func (g *Gateway) SessionOf(instance string) *Session {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.sessions[instance]
}

// SeatOf is a character's seat in an instance and the context it is bound
// to, or nil.
func (g *Gateway) SeatOf(instance, id string) (*Seat, string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	s := g.sessions[instance]
	if s == nil || s.seats[id] == nil {
		return nil, ""
	}
	return s.seats[id], s.seats[id].Context.Kind + ":" + s.seats[id].Context.ID
}
