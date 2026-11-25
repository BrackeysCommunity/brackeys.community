package service_test

import (
	"context"
	"fmt"
	"io"
	"slices"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
)

// TestStagedArcServer: a hardship server A stages casts an arc only A's
// reads carry; B's character, a read for B and a read naming no server
// leave it out.
func TestStagedArcServer(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	founded, n := founder(t, r, "new-a", "u-a", serverA)
	a := founded.ID
	b := member(t, r, "new-b", "u-b", serverB, true)
	advance(t, ctx, r, 1)
	act(t, ctx, r, a, api.ActionRequest{InteractionID: "stage-1", Kind: api.ActStage, Server: serverA, Admin: true, DiscordID: "u-a",
		Stage: &api.StageOrder{Template: "storm", Settlement: n, At: houseOf(t, r, serverA, a, true, false).Settlements[0].Sites[0].At}})
	advance(t, ctx, r, 3)

	release := r.srv.Hold()
	var staged string
	for _, st := range r.srv.Game().Live.Stages {
		if st.Template == "storm" && st.Server == serverA {
			staged = st.Arc
		}
	}
	release()
	if staged == "" {
		t.Fatal("the staged storm cast no arc")
	}
	has := func(path string) bool {
		t.Helper()
		as := read[api.Arcs](t, r, true, path, 200)
		return slices.ContainsFunc(append(as.Open, as.Ended...), func(x api.Arc) bool { return x.ID == staged })
	}
	if !has(api.PathArcs+"?server="+serverA) || !has(api.PathArcs+"?characterId="+a) {
		t.Fatal("server A's reads leave out its own staged arc")
	}
	if has(api.PathArcs+"?server="+serverB) || has(api.PathArcs+"?characterId="+b) || has(api.PathArcs) {
		t.Fatal("a read outside server A carries A's staged arc")
	}
}

// TestStoryPromotionsMasked: a promotion a server masks reads as its
// generated name in that server's promotions, and as written elsewhere.
func TestStoryPromotionsMasked(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	founded, n := founder(t, r, "new-a", "u-a", serverA)
	a := founded.ID
	staff := member(t, r, "new-staff", "u-staff", serverA, false)
	advance(t, ctx, r, 2)

	const written = "Cinder Grip"
	release := r.srv.Hold()
	g := r.srv.Game()
	at := g.Char(a).C.At
	style, _, _, _ := variantScene(t, g, a, g.World.RegionAt(g.SettlementHex(n)), &at)
	g.Emergence.Promotion(style.ID).Named = written
	release()
	advance(t, ctx, r, 3)

	putFact(t, r, fact.Fact{ID: fact.ID(storyIDs + 1), Tick: 1, Kind: "promotion", Weight: 70, Subjects: []fact.Ref{{Kind: game.RefPromotion, ID: style.ID}},
		Data: []fact.Datum{fact.S("type", "style"), fact.S("id", style.ID)}})
	ref := game.RefPromotion + ":" + style.ID
	act(t, ctx, r, staff, api.ActionRequest{InteractionID: "mask-1", Kind: api.ActModerate, Server: serverA, Staff: true, DiscordID: "u-staff",
		Moderate: &api.ModerateOrder{Action: "mask", Ref: ref}})

	promotion := func(server string) api.StoryEvent {
		t.Helper()
		ev := read[api.StoryEvents](t, r, true, fmt.Sprintf("%s?after=%d&server=%s", api.PathStoryPromotions, storyIDs, server), 200)
		i := slices.IndexFunc(ev.Events, func(e api.StoryEvent) bool { return e.Promotion != nil && e.Promotion.ID == style.ID })
		if i < 0 {
			t.Fatalf("no promotion of %s among %d events for %q", style.ID, len(ev.Events), server)
		}
		return ev.Events[i]
	}
	if e := promotion(serverA); e.Promotion.Name != style.Name || e.Names[ref] != "" && e.Names[ref] != style.Name {
		t.Fatalf("server A reads its masked promotion as %q (%q), want %q", e.Promotion.Name, e.Names[ref], style.Name)
	}
	if e := promotion(serverB); e.Promotion.Name != written {
		t.Fatalf("server B reads A's mask: %q", e.Promotion.Name)
	}
}
