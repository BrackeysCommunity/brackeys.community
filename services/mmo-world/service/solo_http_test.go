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
)

func readSolo[T any](t *testing.T, r *running, path string, status int) T {
	t.Helper()
	resp, err := r.http.Client().Get(r.http.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
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
		resp.Body.Close()
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
	defer resp.Body.Close()
	var bad api.Refusal
	if err := json.NewDecoder(resp.Body).Decode(&bad); err != nil || resp.StatusCode != http.StatusBadRequest || bad.Code != api.CodeBadJSON {
		t.Fatal(resp.StatusCode, bad, err)
	}
}
