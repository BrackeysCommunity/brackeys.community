package service_test

import (
	"context"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/puzzle"
)

// A seat's own machine-solve cannot act for the party: only the gateway's
// unchecked write of the merged log is taken.
func TestPartySolveIsTheGatewaysWrite(t *testing.T) {
	ctx := context.Background()
	s := newSeeing(t)
	host := s.l.Host()
	a, b, c := s.create(), s.create(), s.create()
	s.partyOf(a, b, c)
	sh := testkit.PartyMachineBeat(t, s.g, []*game.Char{a, b, c}, puzzle.Rewire, 3)
	if _, ref := s.act(a, api.ActionRequest{Kind: api.ActMachineArm, Machine: &api.MachineIntent{Source: api.MachineParty}}); ref != nil {
		t.Fatal(ref)
	}
	p := s.g.Puzzles()
	won := p.PartySolve(p.Make(sh.Machine.Spec))
	log := service.LogOf(won)
	s.now = time.UnixMilli(sh.Machine.At + won.Stop())
	req := api.ActionRequest{
		InteractionID: "solve-" + sh.ID, CharacterID: a.C.ID, Version: a.Version, Kind: api.ActMachineSolve,
		Machine: &api.MachineIntent{Source: api.MachineParty, Log: log},
	}
	if _, ref, err := host.Act(ctx, req, true); err != nil || ref == nil || ref.Code != api.CodeForbidden {
		t.Fatalf("a seat's own solve: %+v %v", ref, err)
	}
	if !sh.Machine.Armed() {
		t.Fatal("a refused solve disarmed the machine")
	}
	rep, ref, err := host.Act(ctx, req, false)
	if err != nil || ref != nil || rep.Machine == nil || !rep.Machine.Solved {
		t.Fatalf("the gateway's merged write: %+v %+v %v", rep, ref, err)
	}
	if sh.Machine.Armed() {
		t.Fatal("a taken solve left the machine armed")
	}
}
