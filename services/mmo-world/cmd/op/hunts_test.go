package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/service"
)

// TestHuntStartAndHideName runs op hunt-start and op hide-name against a
// stand-in service: hunt-start names no character, and hide-name is sent
// as the dungeon's first namer, read from the tile.
func TestHuntStartAndHideName(t *testing.T) {
	var sent []api.OperatorRequest
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+api.PathOperatorTile, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("q") != "3" || r.URL.Query().Get("r") != "-2" {
			http.Error(w, `{"code":"not-found"}`, http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(`{"state":{"dungeon":{"name":"The Drowned Stair","namedBy":["c-7","c-8"]}}}`))
	})
	mux.HandleFunc("POST "+api.PathOperator, func(w http.ResponseWriter, r *http.Request) {
		var req api.OperatorRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		sent = append(sent, req)
		_, _ = w.Write([]byte(`{"tick":1,"character":{},"facts":[]}`))
	})
	hs := httptest.NewServer(mux)
	defer hs.Close()
	t.Setenv(service.EnvURL, hs.URL)
	t.Setenv(service.EnvOperatorToken, "op")

	if err := run([]string{"-id", "op-1", "hunt-start", "walking-factory", "3,-2", "a", "test"}); err != nil {
		t.Fatal(err)
	}
	if err := run([]string{"-id", "op-2", "hide-name", "3,-2", "a", "rude", "name"}); err != nil {
		t.Fatal(err)
	}
	at := &api.Hex{Q: 3, R: -2}
	want := []api.OperatorRequest{
		{InteractionID: "op-1", Kind: api.OpHuntStart, Asset: "walking-factory", To: at, Note: "a test"},
		{InteractionID: "op-2", CharacterID: "c-7", Kind: api.OpHideName, To: at, Note: "a rude name"},
	}
	if !reflect.DeepEqual(sent, want) {
		t.Fatalf("sent %+v\nwant %+v", sent, want)
	}
	for _, args := range [][]string{{"hunt-start", "walking-factory", "3;-2"}, {"hide-name", "4,4"}, {"hunt-start", "walking-factory"}} {
		if err := run(args); err == nil {
			t.Errorf("op %v ran", args)
		}
	}
}
