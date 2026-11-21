package gateway

import "time"

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

// Countdowns counts the timers set.
func (g *Gateway) Countdowns() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	n := 0
	for _, p := range g.players {
		if p.timer != nil {
			n++
		}
	}
	return n
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
