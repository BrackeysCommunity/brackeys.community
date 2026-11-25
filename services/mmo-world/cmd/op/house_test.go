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

// TestHouseCommands runs op rename, cases, case-close, house-log and a
// ground pin against a stand-in service: the writes are operator requests
// naming no character, the reads go to the operator paths, and a bad
// argument sends nothing.
func TestHouseCommands(t *testing.T) {
	var sent []api.OperatorRequest
	var asked []string
	mux := http.NewServeMux()
	mux.HandleFunc("POST "+api.PathOperator, func(w http.ResponseWriter, r *http.Request) {
		var req api.OperatorRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		sent = append(sent, req)
		_, _ = w.Write([]byte(`{"tick":1,"character":{},"facts":[]}`))
	})
	mux.HandleFunc("GET "+api.PathOperatorCases, func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.String())
		_ = json.NewEncoder(w).Encode(api.Cases{Cases: []api.Case{{ID: "case-1", Ref: "guild:g-2", Reason: "name", State: "escalated", Server: "srv-a"}}})
	})
	mux.HandleFunc("GET "+api.PathOperatorHouseLog, func(w http.ResponseWriter, r *http.Request) {
		asked = append(asked, r.URL.String())
		_ = json.NewEncoder(w).Encode(api.HouseLog{Rows: []api.LogRow{}, Next: 9})
	})
	hs := httptest.NewServer(mux)
	defer hs.Close()
	t.Setenv(service.EnvURL, hs.URL)
	t.Setenv(service.EnvOperatorToken, "op")

	for _, args := range [][]string{
		{"-id", "op-1", "rename", "guild:g-2", "The", "Lanterns"},
		{"-id", "op-2", "rename", "guild:g-2"},
		{"-id", "op-3", "case-close", "srv-a/case-1", "renamed"},
		{"-id", "op-4", "pin-reserve", "4,-2", "1", "ground=marsh", "elevation=3", "ring=true"},
		{"cases"},
		{"house-log"},
		{"house-log", "-after", "7"},
	} {
		if err := run(args); err != nil {
			t.Fatalf("op %v: %v", args, err)
		}
	}
	want := []api.OperatorRequest{
		{InteractionID: "op-1", Kind: api.OpRename, Rename: &api.RenameOrder{Ref: "guild:g-2", Name: "The Lanterns"}},
		{InteractionID: "op-2", Kind: api.OpRename, Rename: &api.RenameOrder{Ref: "guild:g-2"}},
		{InteractionID: "op-3", Kind: api.OpCaseClose, Target: "srv-a/case-1", Note: "renamed"},
		{InteractionID: "op-4", Kind: api.OpPinReserve, Pin: &api.PinOrder{At: api.Hex{Q: 4, R: -2}, Reach: 1,
			Fix: api.PinFix{Ground: &api.GroundFix{Terrain: "marsh", Elevation: 3, Ring: true}}}},
	}
	if !reflect.DeepEqual(sent, want) {
		t.Fatalf("sent %+v\nwant %+v", sent, want)
	}
	if read := []string{api.PathOperatorCases, api.PathOperatorHouseLog + "?after=0", api.PathOperatorHouseLog + "?after=7"}; !reflect.DeepEqual(asked, read) {
		t.Fatalf("read %v, want %v", asked, read)
	}
	sent = nil
	for _, args := range [][]string{
		{"rename"}, {"case-close"}, {"case-close", "case-1"}, {"case-close", "/case-1"}, {"cases", "srv-a"},
		{"house-log", "-after", "-1"}, {"house-log", "extra"},
		{"pin-reserve", "4,-2", "1", "elevation=3"}, {"pin-reserve", "4,-2", "1", "ground=marsh", "ring=maybe"},
	} {
		if err := run(args); err == nil {
			t.Errorf("op %v ran", args)
		}
	}
	if len(sent) != 0 {
		t.Fatalf("refused commands sent %+v", sent)
	}
}
