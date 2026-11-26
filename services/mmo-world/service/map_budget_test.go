package service_test

import (
	"fmt"
	"io"
	"net/http"
	"slices"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/gen"
)

// structural: the overlay's bound over HTTP with Postgres (GDD 4.11's load
// budget), and how many overlays are timed.
const (
	overlayHTTPBound = 60 * time.Millisecond
	overlayHTTPReads = 200
	overlayWalkers   = 3
	overlayWalk      = 6
)

// TestMapOverlayHTTPBudget times overlays through the world's HTTP handler,
// last-seen records read from Postgres, for walkers who have left tiles
// behind: the p95 stays inside the load budget.
func TestMapOverlayHTTPBudget(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	pace := &proofPace{}
	founder(t, r, "c-admin", "u-admin", "srv-1")
	advance(t, ctx, r, 1)
	home := atOf(r, mapCreate(t, r, "map-probe", "u-probe", "").ID)
	users := []string{"u-admin", "u-probe"}
	for i := range overlayWalkers {
		user := fmt.Sprintf("u-walk-%d", i)
		c := mapCreate(t, r, fmt.Sprintf("map-walk-%d", i), user, "srv-1")
		for n := range overlayWalk {
			proofStep(t, r, c, fmt.Sprintf("walk-%d-%d", i, n), farFrom(home), nil)
		}
		users = append(users, user)
	}
	if n, err := r.srv.MapCount(ctx); err != nil || n == 0 {
		t.Fatalf("the walkers left no last-seen record: %d, %v", n, err)
	}
	paths := make([]string, 0, 2*len(users))
	for _, u := range users {
		paths = append(paths, api.PathMapOverlay+"?scope=sight&discordId="+u)
		ov, _ := proofRead[api.MapOverlay](t, r, pace, api.PathMapOverlay+"?scope=sight&discordId="+u)
		var cc []gen.ChunkCoord
		for _, l := range ov.Tiles {
			c := chunkOfHex(r, simHex(api.Hex{Q: l.Q, R: l.R}))
			if !slices.Contains(cc, c) {
				cc = append(cc, c)
			}
		}
		if len(cc) > 0 {
			paths = append(paths, overlayPath(u, cc...))
		}
	}
	took := make([]time.Duration, 0, overlayHTTPReads)
	for i := range overlayHTTPReads {
		p := paths[i%len(paths)]
		pace.read()
		at := time.Now()
		got, _, body := mapGet(t, r, p, "")
		took = append(took, time.Since(at))
		if got != http.StatusOK {
			t.Fatalf("%s: HTTP %d: %s", p, got, body)
		}
	}
	slices.Sort(took)
	p95 := took[len(took)*95/100]
	t.Logf("overlay over HTTP with Postgres: p95 %v, median %v, %d overlays over %d paths", p95, took[len(took)/2], len(took), len(paths))
	if p95 > overlayHTTPBound {
		t.Fatalf("overlay p95 %v over HTTP, bound %v", p95, overlayHTTPBound)
	}
}
