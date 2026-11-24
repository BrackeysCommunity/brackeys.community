package service_test

import (
	"bytes"
	"context"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"slices"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
)

// picture GETs a media key and decodes it as a PNG of the size wanted.
func picture(t *testing.T, r *running, key string, w, h int) []byte {
	t.Helper()
	resp, err := r.http.Client().Get(r.http.URL + api.PathMedia + key + ".png")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil || resp.StatusCode != http.StatusOK || resp.Header.Get("Content-Type") != "image/png" {
		t.Fatalf("media %q: HTTP %d %s %v", key, resp.StatusCode, body, err)
	}
	img, err := png.Decode(bytes.NewReader(body))
	if err != nil || img.Bounds().Dx() != w || img.Bounds().Dy() != h {
		t.Fatalf("media %q: %v, %v", key, err, img.Bounds())
	}
	return body
}

// mediaWhileHeld GETs a media key while the world's lock is held, so a
// request that scans the world blocks and fails the test.
func mediaWhileHeld(t *testing.T, r *running, key string) int {
	t.Helper()
	release := r.srv.Hold()
	done := make(chan int, 1)
	go func() {
		resp, err := r.http.Client().Get(r.http.URL + api.PathMedia + key + ".png")
		if err != nil {
			done <- 0
			return
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
		done <- resp.StatusCode
	}()
	select {
	case status := <-done:
		release()
		return status
	case <-time.After(10 * time.Second):
		release()
		<-done
		t.Fatalf("media %q waited on the world's lock", key)
		return 0
	}
}

// TestMediaKeys: a fight's portrait, a settlement's banner with its wall,
// a price chart with a marked cause, a chronicle's cover and an event's art
// are each served by their key as a PNG, and each key holds while the
// state it was drawn from does.
func TestMediaKeys(t *testing.T) {
	r := start(t, io.Discard)
	ctx := context.Background()
	rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "start", DiscordID: "media", Kind: api.ActCreate, Option: api.StartHook})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id := rep.Character.ID
	query := "?characterId=" + url.QueryEscape(id)

	release := r.srv.Hold()
	g := r.srv.Game()
	c := g.Char(id)
	cr := g.Rules().Fight.Spawn(r.book.Creatures[0].ID, nil, nil, nil)
	c.Fight = &game.Fight{E: g.Rules().Fight.Assemble(fight.Site{ID: "media-fight", Party: 1}, cr)}
	seen := service.Filter(g, c, api.Viewer{}, 0, time.Time{})
	release()
	first, err := r.cli.Options(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	again, err := r.cli.Options(ctx, id)
	if err != nil || first.Fight == nil || first.Fight.Portrait == "" {
		t.Fatalf("options %+v: %v", first.Fight, err)
	}
	party := readSolo[api.PartyState](t, r, api.PathParty+query, 200)
	if again.Fight.Portrait != first.Fight.Portrait || seen.Fight == nil || seen.Fight.Portrait != first.Fight.Portrait ||
		party.Fight == nil || party.Fight.Portrait != first.Fight.Portrait {
		t.Fatalf("one fight, several portraits: %q %q %+v %+v", first.Fight.Portrait, again.Fight.Portrait, seen.Fight, party.Fight)
	}
	if status := mediaWhileHeld(t, r, first.Fight.Portrait); status != http.StatusOK {
		t.Fatalf("a served portrait answered %d", status)
	}
	drawn := picture(t, r, first.Fight.Portrait, 256, 256)
	release = r.srv.Hold()
	c.Fight = nil
	release()
	if !bytes.Equal(drawn, picture(t, r, first.Fight.Portrait, 256, 256)) {
		t.Fatal("a portrait drew differently once its fight was over")
	}
	madeUp := "portrait-000000000000000000000000"
	if refusal := readSolo[api.Refusal](t, r, api.PathMedia+madeUp+".png", 404); refusal.Code != api.CodeNotFound {
		t.Fatal(refusal)
	}
	if status := mediaWhileHeld(t, r, madeUp); status != http.StatusNotFound {
		t.Fatalf("a made-up portrait answered %d the second time", status)
	}

	here := readSolo[api.Here](t, r, api.PathHere+query, 200)
	if readSolo[api.Here](t, r, api.PathHere+query, 200).Banner != here.Banner {
		t.Fatal("an unchanged place changed its banner's key")
	}
	release = r.srv.Hold()
	p := g.PlaceAt(c.C.At)
	if p == nil {
		release()
		t.Fatal("the character does not start in a settlement")
	}
	p.Structures = append(p.Structures, settle.Structure{Kind: "wall", Tier: 2, Condition: g.Rules().Settle.ConditionMax})
	release()
	walled := readSolo[api.Here](t, r, api.PathHere+query, 200)
	if walled.Banner == here.Banner {
		t.Fatal("a wall raised did not move the banner's key")
	}
	picture(t, r, walled.Banner, 640, 200)

	m := readSolo[api.Market](t, r, api.PathMarket+query, 200)
	release = r.srv.Hold()
	n, _ := g.MarketAt(c.C.At)
	b := g.BookOf(n, m.Book.Material)
	b.Days = append(b.Days, market.Day{Day: 0, Close: 4, Units: 1}, market.Day{Day: 1, Close: 6, Units: 2, Cause: storyIDs})
	g.News = append(g.News, game.News{ID: storyIDs, Kind: "region.raids", At: c.C.At, Weight: 40})
	release()
	history := api.PathHistory + query + "&material=" + url.QueryEscape(m.Book.Material)
	h := readSolo[api.History](t, r, history, 200)
	if i := slices.IndexFunc(h.Days, func(d api.PricePt) bool { return d.Cause != "" }); i < 0 || h.Chart == "" {
		t.Fatalf("history %+v", h)
	}
	if readSolo[api.History](t, r, history, 200).Chart != h.Chart {
		t.Fatal("an unchanged history changed its chart's key")
	}
	picture(t, r, h.Chart, 640, 300)

	advance(t, ctx, r, sheets.TicksPerDay+1)
	putFact(t, r, fact.Fact{ID: storyIDs + 1, Tick: 10, Kind: "trouble.started", Weight: 65, Data: []fact.Datum{fact.S("template", "raid")}})
	putFact(t, r, fact.Fact{ID: storyIDs + 2, Tick: 11, Kind: "season.finale", Weight: 100})
	day := api.PathChronicle + "?server=srv-media&day=0"
	ch := read[api.Chronicle](t, r, true, day, 200)
	if ch.Cover == nil || ch.Cover.Slot != "finale" || read[api.Chronicle](t, r, true, day, 200).Cover.Key != ch.Cover.Key {
		t.Fatalf("cover %+v", ch.Cover)
	}
	picture(t, r, ch.Cover.Key, 640, 200)
	events := read[api.StoryEvents](t, r, true, fmt.Sprintf("%s?after=%d", api.PathStoryEvents, storyIDs), 200)
	i := slices.IndexFunc(events.Events, func(e api.StoryEvent) bool { return e.Fact.ID == storyIDs+1 })
	if i < 0 || events.Events[i].Art == nil || events.Events[i].Art.Slot != "raid" {
		t.Fatalf("events %+v", events.Events)
	}
	if picture(t, r, events.Events[i].Art.Key, 640, 200); events.Events[i].Art.Key == ch.Cover.Key {
		t.Fatal("two slots share a key")
	}
}
