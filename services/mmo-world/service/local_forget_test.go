package service_test

import (
	"context"
	"testing"

	"jams.team/mmo-world/api"
)

// TestLocalForgetFreesTheUser forgets a Local player, who may then make a
// new character: the forgotten one no longer counts as theirs.
func TestLocalForgetFreesTheUser(t *testing.T) {
	ctx := context.Background()
	s := newSeeing(t)
	c := s.create()
	user := "u-" + string(rune('a'+s.n))
	if _, ref := s.act(c, api.ActionRequest{DiscordID: user, Kind: api.ActForget}); ref != nil {
		t.Fatalf("the forget: %+v", ref)
	}
	if !s.g.IsForgotten(c.C.ID) {
		t.Fatal("the character is not forgotten")
	}
	rep, ref, err := s.l.Act(ctx, api.ActionRequest{InteractionID: "new-again", DiscordID: user, Kind: api.ActCreate,
		Option: api.StartKnife, Note: "Tinkers"})
	if err != nil || ref != nil {
		t.Fatalf("a new character after the forget: %+v %v", ref, err)
	}
	if rep.Character.ID == c.C.ID {
		t.Fatal("the new character is the forgotten one")
	}
}
