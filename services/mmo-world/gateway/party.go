package gateway

import (
	"context"
	"slices"

	"jams.team/mmo-world/api"
)

// boundTo reports whether a seat is open and bound to a context.
func (s *Seat) boundTo(key string) bool {
	return s != nil && s.conn != nil && contextKey(s.Context) == key
}

// allSeated reports whether everyone who must sit at a seat's party machine
// has a seat open in the same instance, bound to the same context: the
// first touch arms the machine for all of them (GDD 7.11). A seat with no
// party to wait on is let through, for the rules to answer.
func (g *Gateway) allSeated(ctx context.Context, s *Seat) (bool, error) {
	key, members, err := g.cfg.Host.Seats(ctx, s.Char)
	if err != nil {
		return false, err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, id := range members {
		o := s.session.seats[id]
		if !o.boundTo(key) {
			return false, nil
		}
	}
	return true, nil
}

// here marks which seats of a party machine are open in the viewer's own
// instance, bound to its context: only the gateway knows. sat are the
// characters at the machine in seat order. The caller holds the gateway's
// lock.
func (g *Gateway) here(s *Seat, m *api.MachineView, sat []string) {
	if m == nil {
		return
	}
	key := contextKey(s.Context)
	for i := range m.Seats {
		at := m.Seats[i].Seat
		if at < 0 || at >= int64(len(sat)) {
			continue
		}
		o := s.session.seats[sat[at]]
		m.Seats[i].Here = o.boundTo(key)
	}
}

// nudge has the other seats of a party in one instance shown again when a
// seat opens or closes there, since who is seated is in their states. The
// caller holds the gateway's lock.
func (g *Gateway) nudge(s *Seat) {
	if s.Context.Kind == "" || s.Context.Kind == api.ContextSolo {
		return
	}
	key := contextKey(s.Context)
	var ids []string
	for _, o := range s.session.seats {
		if o != s && o.boundTo(key) {
			ids = append(ids, o.Char)
		}
	}
	if len(ids) > 0 {
		g.changed(ids)
	}
}

// move takes one move of a party machine from a seat: stamped with the
// seat, kept no earlier than the last move and no later than the server's
// own time since arming, relayed to the context's other seats as it lands,
// and judged; a log the Judge finds done or broken is written at once.
func (g *Gateway) move(ctx context.Context, s *Seat, c *conn, msg api.ClientMessage) {
	if msg.Move == nil {
		c.send(refusal(msg.Seq, "", api.CodeBadJSON, "a move frame carries a move"))
		return
	}
	s.who.mu.Lock()
	if !s.who.moves.take(g.clock.Now(), maxMoves) {
		s.who.mu.Unlock()
		c.send(refusal(msg.Seq, "", api.CodeBusy, "too many moves at once"))
		return
	}
	var ps partySeat
	if s.party != nil {
		ps = *s.party
	}
	s.who.mu.Unlock()
	if ps.key == "" || ps.seat < 0 {
		c.send(refusal(msg.Seq, "", api.CodeNoMachine, "no party machine is armed at this seat"))
		return
	}
	ml := g.partyOf(ps.key, ps.armedAt)
	if ml == nil {
		g.partyShown(ctx, s.Char, ps, 0)
		if ml = g.partyOf(ps.key, ps.armedAt); ml == nil {
			c.send(refusal(msg.Seq, "", api.CodeNoMachine, "that machine is no longer armed"))
			return
		}
	}
	ml.mu.Lock()
	if ml.sent || ml.gone {
		// The machine is over: a late move from a slow screen is dropped.
		ml.mu.Unlock()
		return
	}
	var last int64
	if n := len(ml.moves); n > 0 {
		last = ml.moves[n-1].At
	}
	elapsed := g.clock.Now().UnixMilli() - ml.armedAt
	mv := api.PuzzleMove{At: max(last, min(msg.Move.At, elapsed)), A: msg.Move.A, B: msg.Move.B, C: msg.Move.C, Seat: ps.seat}
	ml.moves = append(ml.moves, mv)
	n := len(ml.moves)
	log := api.PuzzleLog{Moves: slices.Clone(ml.moves)}
	// Relayed under the log's lock, so every seat sees the moves in the
	// order they were kept.
	g.relay(s, ps.key, mv)
	ml.mu.Unlock()

	g.judgeMerged(ctx, ml, s.Char, log, n, "activity: judging a party's merged log")
}

// relay sends a kept move to every other seat bound to the context, in
// any instance, that has the log so far.
func (g *Gateway) relay(from *Seat, key string, mv api.PuzzleMove) {
	g.mu.Lock()
	var to []*conn
	for _, sess := range g.sessions {
		for _, o := range sess.seats {
			if o != from && o.synced == o.conn && o.boundTo(key) {
				to = append(to, o.conn)
			}
		}
	}
	g.mu.Unlock()
	for _, c := range to {
		c.send(api.ServerMessage{T: api.FrameMove, Move: &mv})
	}
}

// sync gives a seat just sat the merged log so far, right after its state,
// and from then on the moves relayed. The caller holds the character's
// lock.
func (g *Gateway) sync(s *Seat, c *conn) {
	mark := func() {
		g.mu.Lock()
		if s.conn == c {
			s.synced = c
		}
		g.mu.Unlock()
	}
	if s.party == nil {
		mark()
		return
	}
	ml := g.partyOf(s.party.key, s.party.armedAt)
	if ml == nil {
		mark()
		c.send(api.ServerMessage{T: api.FrameMoves, Moves: []api.PuzzleMove{}})
		return
	}
	ml.mu.Lock()
	defer ml.mu.Unlock()
	mark()
	c.send(api.ServerMessage{T: api.FrameMoves, Moves: slices.Clone(ml.moves)})
}
