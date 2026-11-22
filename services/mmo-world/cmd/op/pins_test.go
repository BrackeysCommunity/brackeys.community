package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/service"
)

// TestPinCommands runs the pin commands and the freeze against a stand-in
// service: each is one world-level operator request, flags may stand
// anywhere among the words, and a bad argument sends nothing.
func TestPinCommands(t *testing.T) {
	var sent []api.OperatorRequest
	live := api.Pins{Pins: []api.Pin{{ID: "pin-1", At: api.Hex{Q: -3, R: 2}, Reach: 4, Fix: api.PinFix{SiteKind: "den"}, As: "designer", Tick: 7}}}
	pinsAsked := 0
	mux := http.NewServeMux()
	mux.HandleFunc("POST "+api.PathOperator, func(w http.ResponseWriter, r *http.Request) {
		var req api.OperatorRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		sent = append(sent, req)
		_, _ = w.Write([]byte(`{"tick":1,"character":{},"facts":[]}`))
	})
	mux.HandleFunc("GET "+api.PathOperatorPins, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer op" {
			http.Error(w, `{"code":"forbidden","message":"operators only"}`, http.StatusForbidden)
			return
		}
		pinsAsked++
		_ = json.NewEncoder(w).Encode(live)
	})
	hs := httptest.NewServer(mux)
	defer hs.Close()
	t.Setenv(service.EnvURL, hs.URL)
	t.Setenv(service.EnvOperatorToken, "op")

	for _, args := range [][]string{
		{"-id", "op-1", "pin-reserve", "-3,2", "4", "site-kind=den"},
		{"-id", "op-2", "pin-reserve", "5,-1", "3", "-as", "admin", "lead=rustback", "-for", "c-7", "site=site", "-label", "Night Owls"},
		{"-id", "op-3", "pin-reserve", "0,6", "12", "dungeon=bunker", "floors=5", "stock=rich", "landmark=mast", "-as=designer"},
		{"-id", "op-4", "pin-edit", "-3,2", "lead=rustback", "--as", "staff", "--for=c-9", "-label", "Night Owls"},
		{"-id", "op-5", "pin-withdraw", "pin-1"},
		{"-id", "op-6", "pin-withdraw", "-as", "admin", "-for", "c-7", "pin-2"},
		{"-id", "op-7", "freeze-content", "by", "hand"},
		{"-id", "op-8", "freeze-content"},
	} {
		if err := run(args); err != nil {
			t.Fatalf("op %v: %v", args, err)
		}
	}
	want := []api.OperatorRequest{
		{InteractionID: "op-1", Kind: api.OpPinReserve, Pin: &api.PinOrder{At: api.Hex{Q: -3, R: 2}, Reach: 4, Fix: api.PinFix{SiteKind: "den"}}},
		{InteractionID: "op-2", Kind: api.OpPinReserve, Pin: &api.PinOrder{At: api.Hex{Q: 5, R: -1}, Reach: 3,
			Fix: api.PinFix{Lead: "rustback", Site: "site"}, As: "admin", For: "c-7", Label: "Night Owls"}},
		{InteractionID: "op-3", Kind: api.OpPinReserve, Pin: &api.PinOrder{At: api.Hex{Q: 0, R: 6}, Reach: 12,
			Fix: api.PinFix{Dungeon: "bunker", Floors: 5, Stock: "rich", Landmark: "mast"}, As: "designer"}},
		{InteractionID: "op-4", Kind: api.OpPinEdit, Pin: &api.PinOrder{At: api.Hex{Q: -3, R: 2}, Fix: api.PinFix{Lead: "rustback"},
			As: "staff", For: "c-9", Label: "Night Owls"}},
		{InteractionID: "op-5", Kind: api.OpPinWithdraw, Pin: &api.PinOrder{Pin: "pin-1"}},
		{InteractionID: "op-6", Kind: api.OpPinWithdraw, Pin: &api.PinOrder{Pin: "pin-2", As: "admin", For: "c-7"}},
		{InteractionID: "op-7", Kind: api.OpContentFreeze, Note: "by hand"},
		{InteractionID: "op-8", Kind: api.OpContentFreeze},
	}
	if !reflect.DeepEqual(sent, want) {
		t.Fatalf("sent %s\nwant %s", asJSON(t, sent), asJSON(t, want))
	}

	if err := run([]string{"pins"}); err != nil || pinsAsked != 1 {
		t.Fatalf("op pins: %v, asked %d times", err, pinsAsked)
	}
	got, err := client.New(hs.URL, "op").Pins(t.Context())
	if err != nil || !reflect.DeepEqual(got, live) {
		t.Fatalf("client.Pins: %+v, %v", got, err)
	}
	if _, err := client.New(hs.URL, "").Pins(t.Context()); err == nil {
		t.Fatal("client.Pins without the operator token was answered")
	}

	for _, args := range [][]string{
		{"pin-reserve"},
		{"pin-reserve", "3,-2", "4"},
		{"pin-reserve", "3;-2", "4", "lead=rustback"},
		{"pin-reserve", "3,-2", "far", "lead=rustback"},
		{"pin-reserve", "3,-2", "4", "lead"},
		{"pin-reserve", "3,-2", "4", "lead="},
		{"pin-reserve", "3,-2", "4", "colour=red"},
		{"pin-reserve", "3,-2", "4", "terrain=water"},
		{"pin-reserve", "3,-2", "4", "lead=a", "lead=b"},
		{"pin-reserve", "3,-2", "4", "floors=many"},
		{"pin-reserve", "3,-2", "4", "floors=0"},
		{"pin-reserve", "3,-2", "4", "lead=a", "-as", "king"},
		{"pin-reserve", "3,-2", "4", "lead=a", "-as", "admin", "-as", "staff"},
		{"pin-reserve", "3,-2", "4", "lead=a", "-for"},
		{"pin-reserve", "3,-2", "4", "lead=a", "-colour", "red"},
		{"pin-edit"},
		{"pin-edit", "3,-2"},
		{"pin-edit", "3,-2", "-as", "admin", "-for", "c-7"},
		{"pin-edit", "here", "lead=a"},
		{"pin-withdraw"},
		{"pin-withdraw", "pin-1", "pin-2"},
		{"pin-withdraw", "pin-1", "-note", "x"},
		{"pins", "all"},
	} {
		if err := run(args); err == nil {
			t.Errorf("op %v ran", args)
		}
	}
	if len(sent) != len(want) || pinsAsked != 2 {
		t.Fatalf("a refused argument reached the service: %d writes, %d pin reads", len(sent)-len(want), pinsAsked-2)
	}
}

func asJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
