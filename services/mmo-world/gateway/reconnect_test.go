package gateway_test

import (
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/puzzle"
)

// TestReconnect drops a socket mid-countdown and dials again: the same
// session and seat, bound to the same context, and a first frame that is
// the whole state on the same deadline. A resent intent gets its stored
// reply, a second socket for a seat replaces the first, and a session
// with no socket is kept two minutes.
func TestReconnect(t *testing.T) {
	w := newWorld(t)
	c := w.create("u-tinker")
	id := c.C.ID
	testkit.MachineBeat(t, w.g, c, puzzle.Rewire, 2)
	gw := w.serve(nil)
	v := w.join("u-tinker", "i-1", api.Viewer{}, nil)
	arm := api.Intent{ID: "arm-once-only", Version: v.state().Character.Version, Kind: api.ActMachineArm, Machine: &armBeat}
	reply, armed := v.intent(arm)
	if !reply.OK || reply.Duplicate || !armed.Machine.Armed {
		t.Fatalf("arming: %+v", reply)
	}
	session := gw.SessionOf("i-1")
	seat, bound := gw.SeatOf("i-1", id)
	if session == nil || seat == nil || bound != "solo:"+id {
		t.Fatalf("the seat: %v %v bound to %q", session, seat, bound)
	}

	v.drop()
	w.clock.Advance(5 * time.Second)
	if gw.SessionOf("i-1") != session {
		t.Fatal("the session went with its socket")
	}
	v = w.join("u-tinker", "i-1", api.Viewer{}, v.tape)
	st := v.state()
	if m := st.Machine; m == nil || !m.Armed || m.ArmedAt != armed.Machine.ArmedAt || m.Deadline != armed.Machine.Deadline || m.Grace != armed.Machine.Grace ||
		st.Now != armed.Now+5000 || st.Context != armed.Context {
		t.Fatalf("the first frame after a reconnect: %+v at %d, armed %+v at %d", st.Machine, st.Now, armed.Machine, armed.Now)
	}
	again, bound := gw.SeatOf("i-1", id)
	if gw.SessionOf("i-1") != session || again != seat || bound != "solo:"+id {
		t.Fatal("a reconnect did not resume the same session, seat and context")
	}
	// The intent the client could not know was answered, sent again.
	if reply, _ := v.intent(arm); !reply.OK || !reply.Duplicate {
		t.Fatalf("a resent intent: %+v", reply)
	}

	// The same seat from a second socket: the first is told and closed.
	second := w.join("u-tinker", "i-1", api.Viewer{}, nil)
	if st := second.state(); st.Machine == nil || st.Machine.ArmedAt != armed.Machine.ArmedAt {
		t.Fatalf("the second socket's first frame: %+v", st.Machine)
	}
	if bye, code, _ := v.ended(); bye != "replaced" || code != 4001 {
		t.Fatalf("the replaced socket: bye %q, close %d", bye, code)
	}
	second.quiet()
	// Another instance is another session, on the same character.
	elsewhere := w.join("u-tinker", "i-2", api.Viewer{}, nil)
	elsewhere.state()
	if other := gw.SessionOf("i-2"); other == nil || other == session || gw.Sockets() != 2 {
		t.Fatalf("a second instance: %v, %d sockets", other, gw.Sockets())
	}
	w.tick()
	if a, b := second.state(), elsewhere.state(); a.Tick != b.Tick || a.Tick != st.Tick+1 {
		t.Fatalf("both seats after a tick: %d and %d", a.Tick, b.Tick)
	}
	elsewhere.drop()

	// Nobody left: the session is kept two minutes, then forgotten.
	second.drop()
	w.clock.Advance(2*time.Minute - time.Second)
	if gw.SessionOf("i-1") != session {
		t.Fatal("an empty session was forgotten early")
	}
	w.clock.Advance(time.Second)
	if gw.SessionOf("i-1") != nil || gw.SessionOf("i-2") != nil {
		t.Fatal("an empty session was kept past two minutes")
	}
	// State is rebuilt from the world: a late return finds what happened.
	v = w.join("u-tinker", "i-1", api.Viewer{}, nil)
	if st := v.state(); st.Last == nil || !st.Last.Result.Late || gw.SessionOf("i-1") == session {
		t.Fatalf("a return after the session was forgotten: %+v", st.Last)
	}
}
