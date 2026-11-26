package service_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/export"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/puzzle"
)

// TestStoredReplyKeepsSeen picks on a shared beat: the stored reply keeps
// what the picker faced for the recorded-play export, and neither the
// reply nor a duplicate's carries it.
func TestStoredReplyKeepsSeen(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	a, b := partyOnServer(t, ctx, r)
	release := r.srv.Hold()
	g := r.srv.Game()
	testkit.PartyMachineBeat(t, g, []*game.Char{g.Char(a), g.Char(b)}, puzzle.Rewire, 2)
	release()
	o, err := r.cli.Options(ctx, a)
	if err != nil || o.Fight == nil {
		t.Fatal(o, err)
	}
	pick := ""
	for _, x := range o.Fight.Options {
		if !x.Puzzle {
			pick = x.ID
		}
	}
	req := api.ActionRequest{InteractionID: "seen-pick", CharacterID: a, Version: o.Version, Kind: api.ActPartyPick, Option: pick}
	for range 2 {
		var raw json.RawMessage
		if ref, err := r.cli.Do(ctx, http.MethodPost, api.PathActions, req, &raw); err != nil || ref != nil {
			t.Fatal(ref, err)
		}
		if strings.Contains(string(raw), `"`+export.SeenKey+`"`) {
			t.Fatalf("a reply carries what the picker faced: %s", raw)
		}
	}
	var stored []byte
	if err := r.pool.QueryRow(ctx, `SELECT reply FROM mmo.action WHERE world_id = $1 AND interaction_id = $2`, world, req.InteractionID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	var kept map[string]json.RawMessage
	if err := json.Unmarshal(stored, &kept); err != nil {
		t.Fatal(err)
	}
	var seen export.Seen
	if err := json.Unmarshal(kept[export.SeenKey], &seen); err != nil || seen.Beat == nil {
		t.Fatalf("the stored reply keeps %s: %v", kept[export.SeenKey], err)
	}
}
