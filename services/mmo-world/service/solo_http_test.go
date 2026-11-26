package service_test

import (
	"encoding/json"
	"image/png"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/store"
)

func readSolo[T any](t *testing.T, r *running, path string, status int) T {
	t.Helper()
	resp, err := r.http.Client().Get(r.http.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out T
	if resp.StatusCode != status {
		t.Fatalf("%s: HTTP %d, want %d", path, resp.StatusCode, status)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestSoloCardsOverHTTP(t *testing.T) {
	r := start(t, io.Discard)
	player := api.PathPlayer + "?discordId=solo"
	if p := readSolo[api.Player](t, r, player, 200); p.CharacterID != "" {
		t.Fatal(p)
	}
	lex := readSolo[api.Lexicon](t, r, api.PathLexicon, 200)
	if !slices.Contains(lex.Starts, api.StartDeck) || lex.Numbers.AmbushLine <= 0 {
		t.Fatal(lex.Starts, lex.Numbers)
	}
	rep, ref, err := r.cli.Act(t.Context(), api.ActionRequest{InteractionID: "start", DiscordID: "solo", Kind: api.ActCreate, Option: api.StartDeck})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id := rep.Character.ID
	if p := readSolo[api.Player](t, r, player, 200); p.CharacterID != id {
		t.Fatal(p)
	}
	query := "?characterId=" + url.QueryEscape(id)
	sheet := readSolo[api.Sheet](t, r, api.PathSheet+query, 200)
	if sheet.Start != api.StartDeck || sheet.Character.ID != id {
		t.Fatal(sheet.Start, sheet.Character.ID)
	}
	deck := slices.IndexFunc(sheet.Kit, func(it api.Item) bool { return it.Deck && it.Worn == "off-hand" })
	if deck < 0 {
		t.Fatalf("starting deck missing: %+v", sheet.Kit)
	}
	here := readSolo[api.Here](t, r, api.PathHere+query, 200)
	view := readSolo[api.MapView](t, r, api.PathMap+query+"&radius=0", 200)
	if view.Centre != sheet.Character.At || view.Radius != 1 || view.Tiles == nil {
		t.Fatal(view)
	}
	for _, key := range []string{here.Banner, sheet.Kit[deck].Sigil, view.Image} {
		resp, err := r.http.Client().Get(r.http.URL + api.PathMedia + key + ".png")
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(resp.Body)
		_ = resp.Body.Close()
		if err != nil || img.Bounds().Empty() || resp.Header.Get("Content-Type") != "image/png" {
			t.Fatalf("media %q: %v, %s", key, err, resp.Header.Get("Content-Type"))
		}
	}
	if again := readSolo[api.MapView](t, r, api.PathMap+query+"&radius=1", 200); again.Image != view.Image {
		t.Fatal("unchanged map changed media key")
	}
	if recipes := readSolo[api.Recipes](t, r, api.PathRecipes+query, 200); len(recipes.Processes) == 0 || len(recipes.Slots) == 0 {
		t.Fatal(recipes)
	}
	if len(here.People) == 0 {
		t.Fatal("no one in starting settlement")
	}
	npc := here.People[0].ID
	path := api.PathNPC + query + "&npc=" + url.QueryEscape(npc)
	if refusal := readSolo[api.Refusal](t, r, path, 422); refusal.Code != api.CodeNotHere {
		t.Fatal(refusal)
	}
	_, ref, err = r.cli.Act(t.Context(), api.ActionRequest{InteractionID: "meet", Kind: api.ActTalk, CharacterID: id, Version: sheet.Character.Version, NPC: npc})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	if conv := readSolo[api.Conversation](t, r, path, 200); conv.NPC.ID != npc || len(conv.Topics) == 0 || conv.Banner != here.Banner {
		t.Fatal(conv)
	}
	if recap := readSolo[api.Recap](t, r, api.PathRecap+query, 200); recap.Lines == nil || recap.Since > recap.Tick {
		t.Fatal(recap)
	}
	for _, path := range []string{api.PathSheet, api.PathHere, api.PathMap, api.PathRecipes, api.PathRecap, api.PathNPC} {
		if refusal := readSolo[api.Refusal](t, r, path+"?characterId=missing", 404); refusal.Code != api.CodeNotFound {
			t.Fatal(path, refusal)
		}
	}
	if refusal := readSolo[api.Refusal](t, r, api.PathMedia+"missing.png", 404); refusal.Code != api.CodeNotFound {
		t.Fatal(refusal)
	}
	resp, err := r.http.Client().Post(r.http.URL+api.PathAppraise, "application/json", strings.NewReader("{"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var bad api.Refusal
	if err := json.NewDecoder(resp.Body).Decode(&bad); err != nil || resp.StatusCode != http.StatusBadRequest || bad.Code != api.CodeBadJSON {
		t.Fatal(resp.StatusCode, bad, err)
	}
}

// TestSoloMapFog reads /map through the live map's filter. Its view holds
// every discovered tile of the disc and the character's own, and no other;
// its tiles carry no live field off the own tile. The picture's key holds
// for the same viewer and state, and moves when a last-seen record does.
func TestSoloMapFog(t *testing.T) {
	r := start(t, io.Discard)
	ctx := t.Context()
	rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "start", DiscordID: "fog", Kind: api.ActCreate, Option: api.StartDeck})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id := rep.Character.ID
	const radius = 6
	path := api.PathMap + "?characterId=" + url.QueryEscape(id) + "&radius=6"

	release := r.srv.Hold()
	g := r.srv.Game()
	c := g.Char(id)
	at := c.C.At
	found := func(h hex.Hex) bool { st := g.World.Tile(h); return st != nil && st.Discovered != nil }
	sight := mapview.Sights(g, c)
	var far hex.Hex
	for _, h := range hex.Ring(at, radius) {
		if !sight[h] {
			far = h
			break
		}
	}
	if !found(far) {
		if err := g.World.Discover(g.Log, far, char.Ref(id)); err != nil {
			release()
			t.Fatal(err)
		}
	}
	known := map[hex.Hex]bool{}
	for _, h := range hex.DiscAt(at, radius) {
		if found(h) || h == at {
			known[h] = true
		}
	}
	chunk := g.World.Gen().ChunkOf(far)
	tick := g.Tick()
	release()
	if sight[far] || len(known) == len(hex.DiscAt(at, radius)) {
		t.Fatalf("no out-of-sight tile or no unknown tile in the disc: %d known of %d", len(known), len(hex.DiscAt(at, radius)))
	}

	fogOf := func(v api.MapView, h hex.Hex) (api.MapTileView, bool) {
		i := slices.IndexFunc(v.View, func(x api.MapTileView) bool { return x.Cell.Q == h.Q && x.Cell.R == h.R })
		if i < 0 {
			return api.MapTileView{}, false
		}
		return v.View[i], true
	}
	view := readSolo[api.MapView](t, r, path, 200)
	if len(view.View) != len(known) || len(view.Tiles) != len(known) {
		t.Fatalf("view holds %d tiles and %d views, want the %d discovered and own", len(view.Tiles), len(view.View), len(known))
	}
	for i, v := range view.View {
		h := hex.Hex{Q: v.Cell.Q, R: v.Cell.R}
		if !known[h] {
			t.Errorf("view holds %s, which nobody found", h.Ref())
		}
		if i > 0 && slices.Compare([]int64{view.View[i-1].Cell.R, view.View[i-1].Cell.Q}, []int64{v.Cell.R, v.Cell.Q}) >= 0 {
			t.Errorf("view is out of (r, q) order at %s", h.Ref())
		}
	}
	for _, tl := range view.Tiles {
		if h := (hex.Hex{Q: tl.Hex.Q, R: tl.Hex.R}); h != at && (tl.Weather != "" || tl.Cut || tl.Toll != 0 || tl.Camp != "" || tl.Haunted) {
			t.Errorf("%s carries a live field off the own tile: %+v", h.Ref(), tl)
		}
	}
	if own, ok := fogOf(view, at); !ok || own.Fog != api.FogSight {
		t.Fatalf("the own tile reads %+v", own)
	}
	if v, ok := fogOf(view, far); !ok || v.Fog != api.FogDiscovered || v.Live != nil {
		t.Fatalf("an out-of-sight tile nobody recorded reads %+v", v)
	}
	if again := readSolo[api.MapView](t, r, path, 200); again.Image != view.Image {
		t.Fatal("the same viewer and state changed the media key")
	}

	st := store.New(r.pool, r.cfg.World)
	record := func(threat int64) api.MapView {
		t.Helper()
		live, err := json.Marshal(api.MapLive{Q: far.Q, R: far.R, Fog: api.FogSeen, Left: tick, Threat: threat, Danger: true})
		if err != nil {
			t.Fatal(err)
		}
		row := store.SeenRow{Kind: mapview.HolderCharacter, ID: id, Q: far.Q, R: far.R, A: chunk.A, B: chunk.B, Left: tick, Live: live}
		if err := st.SaveSight(ctx, tick, []store.SeenRow{row}, nil, nil); err != nil {
			t.Fatal(err)
		}
		v := readSolo[api.MapView](t, r, path, 200)
		if got, ok := fogOf(v, far); !ok || got.Fog != api.FogSeen || got.Live == nil || got.Live.Threat != threat || got.Live.Left != tick {
			t.Fatalf("a recorded tile reads %+v", got)
		}
		return v
	}
	seen := record(100)
	if seen.Image == view.Image {
		t.Fatal("a last-seen record left the media key as it was")
	}
	if again := readSolo[api.MapView](t, r, path, 200); again.Image != seen.Image {
		t.Fatal("the same record changed the media key")
	}
	if changed := record(200); changed.Image == seen.Image {
		t.Fatal("a record's changed value left the media key as it was")
	}
}
