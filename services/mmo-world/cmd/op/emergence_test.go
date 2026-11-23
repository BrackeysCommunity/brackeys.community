package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/service"
)

// TestOpEmergence runs op emergence against a stand-in service: it asks the
// operator's dashboard once, prints each measure with its healthy line and
// verdict, the season's promotions by type against need and the newest
// promotions; an empty world prints without dividing by zero, a refusal is
// an error naming its code, and extra words ask for nothing.
func TestOpEmergence(t *testing.T) {
	full := api.Emergence{Day: 61, Season: 2, Active: 1200,
		KindsPerMille: []int64{40, 31, 0, 12},
		Promotions: []api.TypeCount{{Type: "road", Count: 5}, {Type: "camp", Count: 3}, {Type: "haunt", Count: 1},
			{Type: "route", Count: 3}, {Type: "style", Count: 4}, {Type: "variant", Count: 3}, {Type: "legend", Count: 0}, {Type: "custom", Count: 3}},
		Need: 3, Heavy: 900, HeavyPlayer: 540, HeavyHealthy: true,
		Pairing: []api.RegionShare{{Region: "r-2", Style: "edge+keen", Percent: 22},
			{Region: "r-5", Style: "edge-and-ember", Name: "the Ashen Bite", Percent: 41}},
		Traces: []api.TypeCount{{Type: "passage", Count: 812}, {Type: "reliance", Count: 37}},
		Recent: []api.Promotion{
			{ID: "variant:3", Type: "variant", Name: "Plated wire-eel", Region: "r-5", Of: "wire-eel", OfName: "wire-eel", Resists: "keen", Day: 60},
			{ID: "route:1", Type: "route", Name: "Ashford–Kell", Places: []int{0, 3}, Day: 44},
			{ID: "road:2", Type: "road", Name: "the Ashford road", Region: "r-2", At: &api.Hex{Q: 3, R: -1}, Day: 12},
		}}
	reply := full
	asked := 0
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+api.PathOperatorEmergence, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer op" {
			http.Error(w, `{"code":"forbidden","message":"operators only"}`, http.StatusForbidden)
			return
		}
		asked++
		_ = json.NewEncoder(w).Encode(reply)
	})
	hs := httptest.NewServer(mux)
	defer hs.Close()
	t.Setenv(service.EnvURL, hs.URL)
	t.Setenv(service.EnvOperatorToken, "op")

	out, err := stdout(t, func() error { return run([]string{"emergence"}) })
	if err != nil {
		t.Fatal(err)
	}
	if asked != 1 {
		t.Fatalf("asked for the dashboard %d times", asked)
	}
	for _, want := range []string{
		`world day 61, season 2, 1200 active characters`,
		`new kinds per active character a week\s+40 31 0 12 per 1,000 \(oldest first\)\s+falls slowly, never 0\s+UNHEALTHY`,
		`promotions this season\s+2 of 8 types under 3\s+at least 1 of each type per 500 active characters\s+UNHEALTHY`,
		`heavy facts with a player in their causes\s+540 of 900 \(60%\)\s+more than half\s+ok`,
		`share of wins by the most common pairing\s+41% \(the Ashen Bite \(edge-and-ember\) in r-5\)\s+under 35% in every region\s+UNHEALTHY`,
		`r-2\s+edge\+keen\s+22%`,
		`promotions this season\s+count\s+need 3`,
		`\nroad\s+5\s+ok`,
		`\nhaunt\s+1\s+short`,
		`\nlegend\s+0\s+short`,
		`\ncustom\s+3\s+ok`,
		`passage\s+812`,
		`newest promotions \(3\)`,
		`60\s+variant:3\s+Plated wire-eel\s+r-5\s+variant, of wire-eel, resists keen`,
		`44\s+route:1\s+Ashford–Kell\s+places 0–3\s+route`,
		`12\s+road:2\s+the Ashford road\s+r-2 3,-1\s+road`,
	} {
		if !regexp.MustCompile(want).MatchString(out) {
			t.Errorf("op emergence lacks %q:\n%s", want, out)
		}
	}
	if strings.Index(out, "variant:3") > strings.Index(out, "road:2") {
		t.Errorf("the newest promotion is not first:\n%s", out)
	}

	reply = api.Emergence{Day: 0, Season: 0, KindsHealthy: true, Promotions: []api.TypeCount{{Type: "road"}}, Need: 1,
		HeavyHealthy: false, PairingHealthy: true}
	out, err = stdout(t, func() error { return run([]string{"emergence"}) })
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"no week yet", "no heavy facts yet", "no wins with a pairing yet", "newest promotions (0)", "none yet"} {
		if !strings.Contains(out, want) {
			t.Errorf("an empty dashboard lacks %q:\n%s", want, out)
		}
	}

	t.Setenv(service.EnvOperatorToken, "not-op")
	if err := run([]string{"emergence"}); err == nil || !strings.Contains(err.Error(), "forbidden") {
		t.Fatalf("a refused dashboard: %v", err)
	}
	t.Setenv(service.EnvOperatorToken, "op")
	if err := run([]string{"emergence", "now"}); err == nil || asked != 2 {
		t.Fatalf("op emergence now: %v, asked %d times", err, asked)
	}
}
