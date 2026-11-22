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
// stand-in service: neither names a character, since the sim records a
// hide against the dungeon's first namer.
func TestHuntStartAndHideName(t *testing.T) {
	var sent []api.OperatorRequest
	mux := http.NewServeMux()
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
		{InteractionID: "op-2", Kind: api.OpHideName, To: at, Note: "a rude name"},
	}
	if !reflect.DeepEqual(sent, want) {
		t.Fatalf("sent %+v\nwant %+v", sent, want)
	}
	for _, args := range [][]string{{"hunt-start", "walking-factory", "3;-2"}, {"hide-name", "4;4"}, {"hide-name"}, {"hunt-start", "walking-factory"}} {
		if err := run(args); err == nil {
			t.Errorf("op %v ran", args)
		}
	}
}
