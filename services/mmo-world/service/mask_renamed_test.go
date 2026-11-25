package service_test

import (
	"context"
	"fmt"
	"io"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
)

// TestRenamedPromotionMasked: a promotion's rename fact reads both its new
// and its previous written name as generated to a server whose staff
// masked the promotion, and as written to another server.
func TestRenamedPromotionMasked(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	founded, n := founder(t, r, "new-a", "u-a", serverA)
	a := founded.ID
	staff := member(t, r, "new-staff", "u-staff", serverA, false)
	member(t, r, "new-b", "u-b", serverB, true)
	advance(t, ctx, r, 2)

	release := r.srv.Hold()
	g := r.srv.Game()
	at := g.Char(a).C.At
	style, _, _, _ := variantScene(t, g, a, g.World.RegionAt(g.SettlementHex(n)), &at)
	release()
	advance(t, ctx, r, 3)

	const was, name = "Ember Hold", "Cinder Grip"
	renamed := fact.ID(storyIDs + 1)
	putFact(t, r, fact.Fact{ID: renamed, Tick: 1, Kind: "promotion.renamed", Weight: 50, Subjects: []fact.Ref{{Kind: game.RefPromotion, ID: style.ID}},
		Data: []fact.Datum{fact.S("id", style.ID), fact.S("name", name), fact.S("was", was)}})

	act(t, ctx, r, staff, api.ActionRequest{InteractionID: "mask-1", Kind: api.ActModerate, Server: serverA, Staff: true, DiscordID: "u-staff",
		Moderate: &api.ModerateOrder{Action: "mask", Ref: game.RefPromotion + ":" + style.ID}})

	data := func(server string) map[string]string {
		t.Helper()
		fc := read[api.FactCauses](t, r, true, fmt.Sprintf("%s?id=%d&server=%s", api.PathChronicleFact, renamed, server), 200)
		out := map[string]string{}
		for _, d := range fc.Fact.Data {
			out[d.Key] = d.S
		}
		return out
	}
	if d := data(serverA); d["name"] != style.Name || d["was"] != style.Name {
		t.Fatalf("server A reads its masked rename as %q from %q, want %q", d["name"], d["was"], style.Name)
	}
	if d := data(serverB); d["name"] != name || d["was"] != was {
		t.Fatalf("server B reads A's mask: %q from %q", d["name"], d["was"])
	}
}
