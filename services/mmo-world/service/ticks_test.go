package service_test

import (
	"context"
	"io"
	"net/http"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
)

// TestTicksEndpoint reads the tick ring over the operator path: every tick
// after the one asked, oldest first, each step at least as long as its
// Advance, and how far behind the due tick each left the world.
func TestTicksEndpoint(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	advance(t, ctx, r, 6)
	got, err := r.op.TickTimes(ctx, 2)
	if err != nil {
		t.Fatal(err)
	}
	if got.TickMs != int64(r.cfg.TickSeconds)*1000 || len(got.Ticks) != 4 {
		t.Fatalf("ticks after 2: %+v", got)
	}
	for i, tt := range got.Ticks {
		if tt.Tick != int64(3+i) || tt.StepMs < tt.AdvanceMs || tt.AdvanceMs < 0 || tt.Behind != 6-tt.Tick {
			t.Fatalf("tick %d: %+v", i, tt)
		}
	}
	all, err := r.op.TickTimes(ctx, -1)
	if err != nil || len(all.Ticks) != 6 {
		t.Fatalf("every tick: %+v %v", all, err)
	}
	if none, err := r.op.TickTimes(ctx, 6); err != nil || len(none.Ticks) != 0 || none.Ticks == nil {
		t.Fatalf("after the last tick: %+v %v", none, err)
	}
	if _, err := client.New(r.http.URL, "").TickTimes(ctx, 0); err == nil {
		t.Fatal("the ticks were read without the operator token")
	}
	resp, err := r.http.Client().Do(authed(t, http.MethodGet, r.http.URL+api.PathOperatorTicks+"?after=x", opToken))
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("after=x answered %d", resp.StatusCode)
	}
}

func authed(t *testing.T, method, url, token string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(method, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	return req
}
