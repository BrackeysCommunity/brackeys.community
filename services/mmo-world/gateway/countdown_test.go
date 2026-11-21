package gateway_test

import (
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/puzzle"
)

var armBeat = api.MachineIntent{Source: api.MachineBeat}

// past moves the clock to d after a machine's countdown and grace end.
func (w *world) past(m *api.MachineView, d time.Duration) {
	w.clock.Advance(time.UnixMilli(m.Due).Sub(w.clock.Now()) + d)
}

// TestCountdown arms machines and lets the clock run. A countdown that
// runs out haywires once, whether or not its client is still there; one
// solved in time never does; and a gateway that starts over a machine
// already armed ends it on time, or at once when its time has passed.
func TestCountdown(t *testing.T) {
	w := newWorld(t)
	c := w.create("u-tinker")
	id := c.C.ID
	testkit.MachineBeat(t, w.g, c, puzzle.Rewire, 2)
	gw := w.serve(nil)

	// The client arms and goes.
	v := w.join("u-tinker", "i-1", api.Viewer{}, nil)
	st := v.state()
	reply, armed := v.intent(api.Intent{ID: "arm-and-go", Version: st.Character.Version, Kind: api.ActMachineArm, Machine: &armBeat})
	m := armed.Machine
	if !reply.OK || m == nil || !m.Armed || m.Deadline != m.ArmedAt+m.Countdown || m.Grace == 0 || gw.Countdowns() != 1 {
		t.Fatalf("arming: %+v, %+v, %d countdowns", reply, m, gw.Countdowns())
	}
	v.drop()
	w.past(m, 249*time.Millisecond)
	if n := len(w.expiries()); n != 0 {
		t.Fatalf("%d expiries before the countdown and its grace ran out", n)
	}
	w.clock.Advance(time.Millisecond)
	ends := w.expiries()
	if len(ends) != 1 || ends[0].InteractionID != "mx-"+id+"-"+itoa(m.ArmedAt) || ends[0].CharacterID != id || ends[0].Kind != api.ActMachineSolve ||
		ends[0].Machine == nil || ends[0].Machine.Log == nil || len(ends[0].Machine.Log.Moves) != 0 {
		t.Fatalf("the expiry: %+v", ends)
	}
	w.clock.Advance(10 * time.Minute)
	if n := len(w.expiries()); n != 1 || gw.Countdowns() != 0 {
		t.Fatalf("%d expiries and %d countdowns after one machine ran out", n, gw.Countdowns())
	}
	v = w.join("u-tinker", "i-1", api.Viewer{}, v.tape)
	st = v.state()
	if st.Character.Armed || st.Machine == nil || st.Machine.Armed || st.Last == nil || st.Last.Result.Haywire == "" || !st.Last.Result.Late || st.Last.Result.Solved {
		t.Fatalf("the state after the countdown ran out with the client gone: machine %+v, last %+v", st.Machine, st.Last)
	}

	// A machine that haywired is shut until the next tick.
	if st.Machine.Locked == 0 {
		t.Fatalf("a machine that just haywired can be armed again at once: %+v", st.Machine)
	}
	w.tick()
	st = v.state()

	// The client stays and lets it run out: the haywire is pushed to it.
	_, armed = v.intent(api.Intent{ID: "arm-and-wait", Version: st.Character.Version, Kind: api.ActMachineArm, Machine: &armBeat})
	if armed.Machine == nil || !armed.Machine.Armed || armed.Last != nil {
		t.Fatalf("arming again: %+v", armed.Machine)
	}
	w.past(armed.Machine, 250*time.Millisecond)
	st = v.state()
	if st.Machine == nil || st.Machine.Armed || st.Last == nil || st.Last.Result.Haywire == "" || len(w.expiries()) != 2 {
		t.Fatalf("the state pushed when the countdown ran out: machine %+v, last %+v, %d expiries", st.Machine, st.Last, len(w.expiries()))
	}
	v.quiet()
	w.tick()
	st = v.state()

	// Solved in time, the timer is stopped.
	_, armed = v.intent(api.Intent{ID: "arm-and-solve", Version: st.Character.Version, Kind: api.ActMachineArm, Machine: &armBeat})
	log := rewired(armed.Machine.Layout)
	w.clock.Advance(time.Duration(log.Moves[len(log.Moves)-1].At+150) * time.Millisecond)
	solved, rest := v.intent(api.Intent{ID: "solve-in-time", Version: armed.Character.Version, Kind: api.ActMachineSolve, Machine: &api.MachineIntent{Log: log}})
	if !solved.OK || solved.Machine == nil || !solved.Machine.Solved || rest.Character.Armed || gw.Countdowns() != 0 {
		t.Fatalf("a solve in time: %+v, %d countdowns", solved, gw.Countdowns())
	}
	w.clock.Advance(10 * time.Minute)
	v.quiet()
	if n := len(w.expiries()); n != 2 {
		t.Fatalf("%d expiries after a machine solved in time", n)
	}

	// A gateway starting over a machine already armed sets its timer.
	w.stop()
	arm := func(key string) api.ArmedMachine {
		w.tick()
		w.do(func() { testkit.MachineBeat(t, w.g, c, puzzle.Rewire, 1) })
		w.act(c, key, api.ActionRequest{Kind: api.ActMachineArm, Machine: &armBeat})
		list, err := w.Armed(t.Context())
		if err != nil || len(list) != 1 || list[0].CharacterID != id {
			t.Fatalf("countdowns running: %+v %v", list, err)
		}
		return list[0]
	}
	running := arm("arm-before-start")
	gw = w.serve(nil)
	if gw.Countdowns() != 1 || len(w.expiries()) != 2 {
		t.Fatalf("after a start over an armed machine: %d countdowns, %d expiries", gw.Countdowns(), len(w.expiries()))
	}
	w.clock.Advance(time.UnixMilli(running.Due).Sub(w.clock.Now()) + 250*time.Millisecond)
	if n := len(w.expiries()); n != 3 || c.Armed != nil {
		t.Fatalf("%d expiries after the restarted countdown ran out", n)
	}

	// One whose time passed while no gateway ran ends at once.
	w.stop()
	running = arm("arm-before-outage")
	w.clock.Advance(time.UnixMilli(running.Due).Sub(w.clock.Now()) + time.Hour)
	w.serve(nil)
	w.clock.Advance(0)
	if n := len(w.expiries()); n != 4 || c.Armed != nil || c.LastMachine == nil || !c.LastMachine.Result.Late {
		t.Fatalf("%d expiries after a start past the deadline; last %+v", n, c.LastMachine)
	}
}

// TestCountdownUnseen ends machines nobody's socket ever showed: armed
// through the API with no seat open, and found at the next tick.
func TestCountdownUnseen(t *testing.T) {
	w := newWorld(t)
	c := w.create("u-tinker")
	gw := w.serve(nil)
	testkit.MachineBeat(t, w.g, c, puzzle.Rewire, 1)
	w.act(c, "arm-unseen", api.ActionRequest{Kind: api.ActMachineArm, Machine: &armBeat})
	gw.Settle()
	if gw.Countdowns() != 0 {
		t.Fatal("a countdown for a machine no state has shown")
	}
	w.tick()
	gw.Settle()
	if gw.Countdowns() != 1 {
		t.Fatal("no countdown after the tick that found an armed machine")
	}
	// Solved past the gateway, its timer goes with the next notice.
	rig, _, err := w.View(t.Context(), c.C.ID, api.Viewer{})
	if err != nil {
		t.Fatal(err)
	}
	log := rewired(rig.Machine.Layout)
	w.clock.Advance(time.Duration(log.Moves[len(log.Moves)-1].At+150) * time.Millisecond)
	if rep := w.act(c, "solve-unseen", api.ActionRequest{Kind: api.ActMachineSolve, Machine: &api.MachineIntent{Log: log}}); !rep.Machine.Solved {
		t.Fatalf("the solve: %+v", rep.Machine)
	}
	gw.Settle()
	w.clock.Advance(10 * time.Minute)
	if gw.Countdowns() != 0 || len(w.expiries()) != 0 {
		t.Fatalf("%d countdowns, %d expiries after a solve past the gateway", gw.Countdowns(), len(w.expiries()))
	}
}
