package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// TestOpStoryCommands runs op season-start, op arc-cast and op story against
// a stand-in service: the two writes are world-level operator requests, the
// story is the operator's view, a refusal comes back as an error naming
// its code, and a malformed cast sends nothing.
func TestOpStoryCommands(t *testing.T) {
	var sent []api.OperatorRequest
	view := api.StoryView{Season: api.Season{N: 0, Day: 3, Days: 14, Band: "opening", Ends: 2016},
		Arcs: []api.Arc{{ID: "arc-1", Template: "the-siege", Scope: "world", Stages: 3}}, Boards: []api.BoardView{}}
	asked := 0
	mux := http.NewServeMux()
	mux.HandleFunc("POST "+api.PathOperator, func(w http.ResponseWriter, r *http.Request) {
		var req api.OperatorRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		sent = append(sent, req)
		if req.Arc != nil && req.Arc.Template == "the-grudge" {
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"code":"slot-busy","message":"a region arc runs there"}`))
			return
		}
		_, _ = w.Write([]byte(`{"tick":1,"character":{},"facts":[]}`))
	})
	mux.HandleFunc("GET "+api.PathOperatorStory, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer op" {
			http.Error(w, `{"code":"forbidden","message":"operators only"}`, http.StatusForbidden)
			return
		}
		asked++
		_ = json.NewEncoder(w).Encode(view)
	})
	hs := httptest.NewServer(mux)
	defer hs.Close()
	t.Setenv(service.EnvURL, hs.URL)
	t.Setenv(service.EnvOperatorToken, "op")

	for _, args := range [][]string{
		{"-id", "op-1", "season-start", "a", "legacy", "world"},
		{"-id", "op-2", "season-start"},
		{"-id", "op-3", "arc-cast", "the-siege", "besieger=faction:f-1", "holder=faction:f-2", "holding=holding:r-4", "seat=-3,2"},
		{"-id", "op-4", "arc-cast", "the-debt", "character=character:c-7", "npc=npc:n-2"},
	} {
		if err := run(args); err != nil {
			t.Fatalf("op %v: %v", args, err)
		}
	}
	out, err := stdout(t, func() error { return run([]string{"story"}) })
	if err != nil {
		t.Fatal(err)
	}
	var got api.StoryView
	if err := json.Unmarshal([]byte(out), &got); err != nil || asked != 1 || !reflect.DeepEqual(got, view) {
		t.Fatalf("op story printed %q (%v), asked %d times", out, err, asked)
	}
	want := []api.OperatorRequest{
		{InteractionID: "op-1", Kind: api.OpSeasonStart, Note: "a legacy world"},
		{InteractionID: "op-2", Kind: api.OpSeasonStart},
		{InteractionID: "op-3", Kind: api.OpArcCast, Arc: &api.ArcOrder{Template: "the-siege", Cast: []api.CastRef{
			{Role: "besieger", Kind: "faction", ID: "f-1"}, {Role: "holder", Kind: "faction", ID: "f-2"}, {Role: "holding", Kind: "holding", ID: "r-4"}},
			Seat: &api.Hex{Q: -3, R: 2}}},
		{InteractionID: "op-4", Kind: api.OpArcCast, Arc: &api.ArcOrder{Template: "the-debt", Cast: []api.CastRef{
			{Role: "character", Kind: "character", ID: "c-7"}, {Role: "npc", Kind: "npc", ID: "n-2"}}}},
	}
	if !reflect.DeepEqual(sent, want) {
		t.Fatalf("sent %+v\nwant %+v", sent, want)
	}

	err = run([]string{"-id", "op-5", "arc-cast", "the-grudge", "betrayer=faction:f-1", "wronged=faction:f-3"})
	if err == nil || !strings.Contains(err.Error(), api.CodeSlotBusy) {
		t.Fatalf("a refused cast: %v", err)
	}
	sent = sent[:0]
	for _, args := range [][]string{
		{"arc-cast"},
		{"arc-cast", "the-siege"},
		{"arc-cast", "seat=1,1", "holder=faction:f-2"},
		{"arc-cast", "the-siege", "holder"},
		{"arc-cast", "the-siege", "holder="},
		{"arc-cast", "the-siege", "=faction:f-2"},
		{"arc-cast", "the-siege", "holder=faction"},
		{"arc-cast", "the-siege", "holder=:f-2"},
		{"arc-cast", "the-siege", "holder=faction:"},
		{"arc-cast", "the-siege", "holder=faction:f-2", "holder=faction:f-3"},
		{"arc-cast", "the-siege", "holder=faction:f-2", "seat=3;2"},
		{"arc-cast", "the-siege", "holder=faction:f-2", "seat=1,1", "seat=2,2"},
		{"arc-cast", "the-siege", "seat=1,1"},
		{"story", "now"},
	} {
		if err := run(args); err == nil {
			t.Errorf("op %v ran", args)
		}
	}
	if len(sent) != 0 || asked != 1 {
		t.Fatalf("malformed commands sent %+v and asked for the story %d times", sent, asked)
	}
}

// stdout is what f prints.
func stdout(t *testing.T, f func() error) (string, error) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	was := os.Stdout
	os.Stdout = w
	done := make(chan []byte)
	go func() {
		b, _ := io.ReadAll(r)
		done <- b
	}()
	err = f()
	os.Stdout = was
	_ = w.Close()
	return string(<-done), err
}

// TestOpReplayInsideOneEpoch stores a world whose season closes at the end
// of its first day and takes a rules epoch there, then replays: a range on
// either side of the epoch runs to its recorded digests, a range across it
// is refused crosses-epoch before anything is replayed, and malformed
// ranges are refused.
func TestOpReplayInsideOneEpoch(t *testing.T) {
	ctx := context.Background()
	sec, secrets := testkit.Secrets(t, "mmo/op-epoch-test", "w-epoch")
	book := testkit.Book(t)
	r := testkit.Rules(t, book, sec.Keys)
	digest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	url := pgtest.DB(t)
	st, g, _ := testkit.Founded(t, ctx, pgtest.PoolOn(t, url), r, store.Meta{ID: "w-epoch", KeyVersion: 1, KeyCheck: sec.Keys.Check(),
		SheetsDigest: digest, TickSeconds: 600})
	day := int64(sheets.TicksPerDay)
	testkit.Ticks(t, ctx, st, g, int(day-1))
	// As the close leaves it: season 1 begins with the next day.
	*g.Story.Clock = season.Clock{N: 1, Start: 1, Days: sheets.IntParam(book.StoryParams, "season-days")}
	testkit.Ticks(t, ctx, st, g, 1)
	testkit.Act(t, ctx, st, g, game.Command{Key: "season-epoch-1", Kind: game.SeasonEpoch,
		Epoch: &season.Epoch{From: digest, To: "next-sheets", Sheets: 1}}, "")
	testkit.Ticks(t, ctx, st, g, int(day+6))

	env := func() {
		for _, kv := range append(secrets, service.EnvDatabase+"="+url) {
			k, v, _ := strings.Cut(kv, "=")
			t.Setenv(k, v)
		}
	}
	for _, c := range []struct {
		from, to string
		checked  int64
	}{
		{"0", "100", 100},
		{"144", "160", 16},
		{"150", "290", 290 - 144},
	} {
		env()
		out, err := stdout(t, func() error { return run([]string{"replay", "-from", c.from, "-to", c.to}) })
		if err != nil {
			t.Fatalf("replay %s to %s: %v", c.from, c.to, err)
		}
		var rep struct{ Checked int64 }
		if err := json.Unmarshal([]byte(out), &rep); err != nil || rep.Checked != c.checked {
			t.Fatalf("replay %s to %s checked %d ticks, want %d: %s", c.from, c.to, rep.Checked, c.checked, out)
		}
	}
	for _, c := range [][2]string{{"100", "200"}, {"0", "144"}, {"143", "150"}} {
		env()
		start := time.Now()
		err := run([]string{"replay", "-from", c[0], "-to", c[1]})
		if err == nil || !strings.Contains(err.Error(), api.CodeCrossesEpoch) || !strings.Contains(err.Error(), "tick 144") {
			t.Fatalf("replay %s to %s across the epoch: %v", c[0], c[1], err)
		}
		t.Logf("refused in %s: %v", time.Since(start).Round(time.Millisecond), err)
	}
	for _, args := range [][]string{{"replay", "-from", "x"}, {"replay", "-from", "10", "-to", "5"}, {"replay", "now"}} {
		if err := run(args); err == nil {
			t.Errorf("op %v ran", args)
		}
	}
}
