package gateway_test

import (
	"context"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/gateway"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/puzzle"
)

// clockOn starts the pick-window clock over the world.
func (w *world) clockOn() *gateway.Timers {
	w.t.Helper()
	tm, err := gateway.StartTimers(context.Background(), w, w.clock, slog.New(slog.DiscardHandler))
	if err != nil {
		w.t.Fatal(err)
	}
	w.t.Cleanup(tm.Close)
	return tm
}

// windowEnds are the writes that ended a pick window.
func (w *world) windowEnds() []api.ActionRequest {
	var out []api.ActionRequest
	for _, a := range w.written() {
		if a.Kind == api.ActPartyWindow {
			out = append(out, a)
		}
	}
	return out
}

// holdOption is a pick on a member's beat that is not its machine.
func (w *world) holdOption(c *game.Char) string {
	w.t.Helper()
	var id string
	w.do(func() {
		for _, o := range w.g.Choose(c).Fight.Options {
			if !o.Puzzle {
				id = o.ID
				return
			}
		}
	})
	if id == "" {
		w.t.Fatal("the beat offers only its machine")
	}
	return id
}

// TestPickTimer opens a party's pick window with one member's pick and
// lets the clock run: the window ends once, at its due and the slack,
// with the cautious option for whoever did not pick, whether a seat is
// open or not, across a restart of the clock, and with no Activity
// listener at all.
func TestPickTimer(t *testing.T) {
	for _, how := range []string{"page open", "page closed", "restart", "restart past due", "listener off"} {
		t.Run(how, func(t *testing.T) {
			w := newWorld(t)
			users := []string{"u-one", "u-two"}
			cs := w.party(users...)
			sh := w.facing(cs, puzzle.Fuse, 2)
			var gw *gateway.Gateway
			if how != "listener off" {
				gw = w.serve(nil)
			}
			tm := w.clockOn()
			pick := w.holdOption(cs[0])
			var window int64
			w.do(func() { window = w.g.PartyWindowMs() })
			var vs []*viewer
			opened := w.clock.Now().UnixMilli()
			if how == "page open" {
				var sts []api.ActivityState
				vs, sts = w.seatAll("i-party", users...)
				rep, _ := vs[0].intent(api.Intent{ID: "pick-over-socket", Version: sts[0].Character.Version, Kind: api.ActPartyPick, Option: pick})
				if !rep.OK {
					t.Fatalf("a pick over the socket: %+v", rep)
				}
				if st := vs[1].state(); st.Party == nil || st.Party.Beat == nil || st.Party.Beat.Mine != "" || st.Party.Beat.Picked != 1 || st.Party.Beat.Due != opened+window {
					t.Fatalf("the other member's state after a pick: %+v", st.Party)
				}
			} else {
				w.act(cs[0], "pick-in-chat", api.ActionRequest{Kind: api.ActPartyPick, Option: pick})
			}
			tm.Settle()
			if gw != nil {
				gw.Settle()
			}
			due := opened + window
			list, err := w.Windows(t.Context())
			if err != nil || len(list) != 1 || list[0].Shared != sh.ID || list[0].Opened != opened || list[0].Due != due || list[0].Character != cs[0].C.ID {
				t.Fatalf("windows open: %+v %v", list, err)
			}
			if tm.Pending() != 1 {
				t.Fatalf("%d windows timed", tm.Pending())
			}
			switch how {
			case "restart":
				w.clock.Advance(time.Duration(window/2) * time.Millisecond)
				tm.Close()
				tm = w.clockOn()
			case "restart past due":
				tm.Close()
				w.clock.Advance(time.Duration(window)*time.Millisecond + time.Hour)
				tm = w.clockOn()
				w.clock.Advance(0)
			}
			if how != "restart past due" {
				w.clock.Advance(time.UnixMilli(due).Sub(w.clock.Now()) + 249*time.Millisecond)
				if n := len(w.windowEnds()); n != 0 {
					t.Fatalf("%d window ends before the due and its slack", n)
				}
				w.clock.Advance(time.Millisecond)
			}
			ends := w.windowEnds()
			if len(ends) != 1 || ends[0].InteractionID != "pw-"+sh.ID+"-"+itoa(opened) || ends[0].CharacterID != cs[0].C.ID || ends[0].Target != sh.ID {
				t.Fatalf("the window's end: %+v", ends)
			}
			w.do(func() {
				if w.g.SharedByID(sh.ID) != nil && len(sh.Picks) != 0 {
					t.Fatalf("the beat did not resolve: %+v", sh.Picks)
				}
				if cs[1].Fight != nil && cs[1].Fight.Shared == sh.ID && slices.ContainsFunc(sh.Picks, func(p game.HeldPick) bool { return p.Who == cs[1].C.ID }) {
					t.Fatal("the member who did not pick still holds a pick")
				}
			})
			tm.Settle()
			w.clock.Advance(10 * time.Minute)
			if n := len(w.windowEnds()); n != 1 || tm.Pending() != 0 {
				t.Fatalf("%d window ends and %d timed after the window closed", n, tm.Pending())
			}
			if how == "page open" {
				for _, v := range vs {
					st := v.state()
					if st.Party != nil && st.Party.Beat != nil && st.Party.Beat.Opened == opened {
						t.Fatalf("a seat after the window ended still shows it: %+v", st.Party.Beat)
					}
				}
			}
			for _, a := range w.written() {
				if a.Kind == api.ActPartyWindow && !strings.HasPrefix(a.InteractionID, "pw-") {
					t.Fatalf("a window ended under %q", a.InteractionID)
				}
			}
		})
	}
}

// TestPickTimerWaits leaves a window open while the party's machine is
// armed: the clock sends nothing until the machine is done.
func TestPickTimerWaits(t *testing.T) {
	w := newWorld(t)
	users := []string{"u-one", "u-two"}
	cs := w.party(users...)
	sh := w.facing(cs, puzzle.Fuse, 2)
	gw := w.serve(nil)
	tm := w.clockOn()
	vs, sts := w.seatAll("i-party", users...)
	pick := w.holdOption(cs[0])
	if rep, _ := vs[0].intent(api.Intent{ID: "pick-then-arm", Version: sts[0].Character.Version, Kind: api.ActPartyPick, Option: pick}); !rep.OK {
		t.Fatalf("the pick: %+v", rep)
	}
	sts[1] = vs[1].state()
	armOver(t, vs, sts, 1)
	tm.Settle()
	gw.Settle()
	m := w.armed(sh)
	var window int64
	w.do(func() { window = w.g.PartyWindowMs() })
	// The machine's countdown ends it before the window would.
	w.clock.Advance(time.Duration(window)*time.Millisecond + time.Second)
	if n := len(w.windowEnds()); n != 0 {
		t.Fatalf("%d window ends while the machine was armed", n)
	}
	if len(w.merges()) != 1 {
		t.Fatalf("the machine armed at %d did not end", m.At)
	}
	tm.Settle()
	w.clock.Advance(time.Minute)
	if n := len(w.windowEnds()); n != 0 {
		t.Fatalf("%d window ends after the machine ended the beat", n)
	}
}
