package gateway_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/gateway"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/weather"
)

// mapGet reads one of the Activity's map routes with a session, or none
// for "".
func mapGet(t *testing.T, url, session string) (int, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if session != "" {
		req.Header.Set("Authorization", "Bearer "+session)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if cc := resp.Header.Get("Cache-Control"); cc != "no-store" {
		t.Errorf("%s answered %d with cache-control %q", url, resp.StatusCode, cc)
	}
	return resp.StatusCode, body
}

// mapRead is a map route's JSON answer, which must be status.
func mapRead[T any](t *testing.T, url, session string, status int) T {
	t.Helper()
	got, body := mapGet(t, url, session)
	if got != status {
		t.Fatalf("%s: %d, want %d: %s", url, got, status, body)
	}
	var out T
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("%s: %v", url, err)
	}
	return out
}

func sameJSON(t *testing.T, name string, got, want any) {
	t.Helper()
	a, _ := json.Marshal(got)
	b, _ := json.Marshal(want)
	if !bytes.Equal(a, b) {
		t.Errorf("%s through the gateway differs from the world's", name)
	}
}

func chunkID(a, b int64) string { return fmt.Sprintf("%d.%d", a, b) }

// TestActivityMapFilter reads every map route of the Activity over a
// Local world and finds no tile nobody has discovered, but the viewer's
// own in their own overlay.
func TestActivityMapFilter(t *testing.T) {
	w := newWorld(t)
	c := w.create("map-1")
	other := w.create("map-2")
	w.tick()
	w.tick()
	found := func(h hex.Hex) bool {
		ts := w.g.World.Tile(h)
		return ts != nil && ts.Discovered != nil
	}
	// A disc round the start is found, a storm rides in from far off, and
	// the viewer stands just past the frontier, on a tile nobody found.
	var own hex.Hex
	w.do(func() {
		start := c.C.At
		for _, h := range hex.DiscAt(start, 6) {
			if err := w.g.World.Discover(w.g.Log, h, char.Ref(c.C.ID)); err != nil {
				t.Fatal(err)
			}
		}
		w.g.World.Sky.Systems = []weather.System{{ID: 1, Kind: "storm", Centre: start.Add(hex.Direction(0).Scale(14)), Strength: 100_000, Heading: 3}}
		frontier := func(h hex.Hex) bool {
			ter := w.g.World.Gen().Terrain(w.g.World.Baseline(h).Terrain)
			if found(h) || ter == nil || !ter.Passable || w.g.PlaceAt(h) != nil {
				return false
			}
			for d := range hex.Directions {
				if found(h.Neighbour(d)) {
					return true
				}
			}
			return false
		}
		i := slices.IndexFunc(hex.DiscAt(c.C.At, 12), frontier)
		if i < 0 {
			t.Fatal("no undiscovered tile on the frontier")
		}
		own = hex.DiscAt(c.C.At, 12)[i]
		c.C.At = own
	})
	w.serve(nil)
	session := w.signIn("map-1").Session
	nobody := w.signIn("map-9").Session
	base := w.srv.URL

	var hexes []hex.Hex // every tile any base reply names
	var bodies [][]byte

	index := mapRead[api.MapIndex](t, base+api.PathActivityMapTick, session, http.StatusOK)
	want, err := w.MapIndex(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	sameJSON(t, "the index", index, want)
	if len(index.Chunks) == 0 || index.Tiles == 0 {
		t.Fatalf("an index of nothing: %+v", index)
	}
	hexes = append(hexes, hex.Hex{Q: index.Home.Q, R: index.Home.R})
	if proxied := mapRead[api.MapIndex](t, base+api.ActivityProxyPrefix+api.PathActivityMapTick, session, http.StatusOK); proxied.Tick != index.Tick {
		t.Errorf("the index through the proxy's prefix is at %d, not %d", proxied.Tick, index.Tick)
	}

	style := mapRead[api.MapStyle](t, base+api.PathActivityMapStyle, session, http.StatusOK)
	if style.Rev != index.Style || len(style.Entries) == 0 {
		t.Errorf("style %s with %d entries, the index names %s", style.Rev, len(style.Entries), index.Style)
	}

	regions := mapRead[api.MapRegions](t, base+api.PathActivityMapRegions, session, http.StatusOK)
	if regions.Rev != index.Regions {
		t.Errorf("regions %s, the index names %s", regions.Rev, index.Regions)
	}
	for _, rg := range regions.Regions {
		hexes = append(hexes, hex.Hex{Q: rg.Anchor.Q, R: rg.Anchor.R})
	}
	for _, row := range regions.Rows {
		for i, slot := range row.Slots {
			if slot >= 0 {
				hexes = append(hexes, hex.Hex{Q: row.Q + int64(i), R: row.R})
			}
		}
	}
	for _, d := range regions.Places {
		hexes = append(hexes, hex.Hex{Q: d.Q, R: d.R})
	}

	known := map[string]bool{}
	var asked []string
	for _, ref := range index.Chunks {
		id := chunkID(ref.A, ref.B)
		known[id] = true
		asked = append(asked, id)
		w.clock.Advance(time.Second)
		for _, level := range []string{api.LevelArea, api.LevelTile} {
			url := fmt.Sprintf("%s%s?a=%d&b=%d&level=%s", base, api.PathActivityMapChunk, ref.A, ref.B, level)
			ch := mapRead[api.MapChunk](t, url, session, http.StatusOK)
			if ch.A != ref.A || ch.B != ref.B || ch.Level != level {
				t.Errorf("%s: chunk %d.%d at %s", url, ch.A, ch.B, ch.Level)
			}
			if rev := map[string]string{api.LevelArea: ref.Area, api.LevelTile: ref.Tile}[level]; ch.Rev != rev {
				t.Errorf("%s: rev %s, the index names %s", url, ch.Rev, rev)
			}
			for _, cell := range ch.Cells {
				hexes = append(hexes, hex.Hex{Q: cell.Q, R: cell.R})
			}
		}
	}
	// A chunk next to the known ones that holds no discovered tile is
	// indistinguishable from one outside the world.
	unfound := 0
	for _, ref := range index.Chunks {
		for da := int64(-2); da <= 2; da++ {
			for db := int64(-2); db <= 2; db++ {
				a, b := ref.A+da, ref.B+db
				if known[chunkID(a, b)] {
					continue
				}
				unfound++
				w.clock.Advance(time.Second)
				for _, level := range []string{api.LevelArea, api.LevelTile} {
					url := fmt.Sprintf("%s%s?a=%d&b=%d&level=%s", base, api.PathActivityMapChunk, a, b, level)
					status, body := mapGet(t, url, session)
					if status != http.StatusNotFound || !strings.Contains(string(body), api.CodeNotFound) {
						t.Errorf("%s: %d %s", url, status, body)
					}
				}
			}
		}
	}
	if unfound == 0 {
		t.Fatal("no undiscovered chunk was asked for")
	}
	for _, url := range []string{
		base + api.PathActivityMapChunk + "?a=0&b=0",
		base + api.PathActivityMapChunk + "?a=0&b=0&level=region",
		base + api.PathActivityMapChunk + "?a=x&b=0&level=tile",
		base + api.PathActivityMapOverlay + "?chunks=0.0&scope=sight",
		base + api.PathActivityMapOverlay,
		base + api.PathActivityMapOverlay + "?scope=all",
		base + api.PathActivityMapOverlay + "?chunks=0.0,1",
		base + api.PathActivityMapOverlay + "?chunks=" + strings.Repeat("0.0,", 64) + "0.0",
	} {
		w.clock.Advance(time.Second)
		if status, body := mapGet(t, url, session); status != http.StatusBadRequest {
			t.Errorf("%s: %d %s", url, status, body)
		}
	}
	for _, h := range hexes {
		if !found(h) {
			t.Errorf("a base reply names %v, which nobody found", h)
		}
	}
	bodies = append(bodies, mustJSON(t, index), mustJSON(t, regions))

	if len(asked) > 64 {
		asked = asked[:64]
	}
	overlays := map[string]string{
		"chunks": base + api.PathActivityMapOverlay + "?chunks=" + strings.Join(asked, ","),
		"sight":  base + api.ActivityProxyPrefix + api.PathActivityMapOverlay + "?scope=sight",
	}
	for name, url := range overlays {
		w.clock.Advance(time.Second)
		o := mapRead[api.MapOverlay](t, url, session, http.StatusOK)
		bodies = append(bodies, mustJSON(t, o))
		if o.Viewer != api.ViewerCharacter || o.Self == nil || o.Self.Character != c.C.ID {
			t.Fatalf("%s: viewer %s, self %+v", name, o.Viewer, o.Self)
		}
		if (hex.Hex{Q: o.Self.Q, R: o.Self.R}) != own || o.Self.Cell == nil || (hex.Hex{Q: o.Self.Cell.Q, R: o.Self.Cell.R}) != own {
			t.Errorf("%s: self at %d,%d with cell %v, not on %v", name, o.Self.Q, o.Self.R, o.Self.Cell, own)
		}
		for _, h := range o.Self.Route {
			if !found(hex.Hex{Q: h.Q, R: h.R}) {
				t.Errorf("%s: the route names %v, which nobody found", name, h)
			}
		}
		if len(o.Tiles) < 2 || len(o.Fronts) == 0 {
			t.Errorf("%s: %d tiles and %d fronts in sight", name, len(o.Tiles), len(o.Fronts))
		}
		for _, l := range o.Tiles {
			if h := (hex.Hex{Q: l.Q, R: l.R}); h != own && !found(h) {
				t.Errorf("%s: live layers on %v, which nobody found", name, h)
			}
		}
		for _, f := range o.Fronts {
			if h := (hex.Hex{Q: f.Q, R: f.R}); h != own && !found(h) {
				t.Errorf("%s: a front drawn on %v, which nobody found", name, h)
			}
		}
	}
	// The own tile reaches its own viewer only.
	ownJSON := fmt.Sprintf(`"q":%d,"r":%d`, own.Q, own.R)
	for _, b := range bodies[:2] {
		if strings.Contains(string(b), ownJSON) {
			t.Errorf("a base reply names the viewer's undiscovered tile %v", own)
		}
	}
	for _, b := range bodies {
		if strings.Contains(string(b), other.C.ID) {
			t.Errorf("a reply to %s names %s", c.C.ID, other.C.ID)
		}
	}

	// No session, or one that is not the gateway's, sees no live layer.
	for _, s := range []string{"", "forged", session + "x"} {
		status, body := mapGet(t, overlays["sight"], s)
		if status != http.StatusUnauthorized || !strings.Contains(string(body), api.CodeForbidden) {
			t.Errorf("an overlay with session %q: %d %s", s, status, body)
		}
	}
	// Signed in with no character: a player, shown nothing live.
	for name, url := range overlays {
		w.clock.Advance(time.Second)
		o := mapRead[api.MapOverlay](t, url, nobody, http.StatusOK)
		if o.Viewer != api.ViewerPlayer || len(o.Tiles) != 0 || len(o.Fronts) != 0 || o.Self != nil || o.Names != nil {
			t.Errorf("%s: a player is shown %+v", name, o)
		}
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestActivityMapLimits refuses map reads past a user's caps and past
// everyone's, a second at a time. An unsigned or forged read is refused
// and counts in no window.
func TestActivityMapLimits(t *testing.T) {
	h := &fakeHost{players: map[string]string{"lim-1": "c1", "lim-2": "c2"}, states: map[string]api.ActivityState{}}
	w := faked(t, h, nil)
	one, two := w.signIn("lim-1").Session, w.signIn("lim-2").Session
	tick := w.srv.URL + api.PathActivityMapTick
	overlay := w.srv.URL + api.PathActivityMapOverlay + "?scope=sight"
	busy := func(name, url, session string) {
		t.Helper()
		status, body := mapGet(t, url, session)
		if status != http.StatusTooManyRequests || !strings.Contains(string(body), api.CodeBusy) {
			t.Fatalf("%s: %d %s", name, status, body)
		}
	}
	ok := func(name, url, session string) {
		t.Helper()
		if status, body := mapGet(t, url, session); status != http.StatusOK {
			t.Fatalf("%s: %d %s", name, status, body)
		}
	}
	unsigned := func(name, header string) {
		t.Helper()
		req, err := http.NewRequest(http.MethodGet, tick, nil)
		if err != nil {
			t.Fatal(err)
		}
		if header != "" {
			req.Header.Set("Authorization", header)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusUnauthorized || !strings.Contains(string(body), api.CodeForbidden) {
			t.Fatalf("%s: %d %s", name, resp.StatusCode, body)
		}
	}

	for i := range gateway.MaxMapReads {
		ok(fmt.Sprintf("read %d", i+1), tick, one)
	}
	busy("one read past a user's cap", tick, one)
	busy("an overlay past a user's read cap", overlay, one)
	ok("another user's read", tick, two)
	unsigned("a read with no session", "")
	unsigned("a read with a forged session", "Bearer not-a-token")
	w.clock.Advance(time.Second)
	ok("a read a second later", tick, one)

	w.clock.Advance(time.Second)
	for i := range gateway.MaxMapOverlays {
		ok(fmt.Sprintf("overlay %d", i+1), overlay, one)
	}
	busy("one overlay past a user's cap", overlay, one)
	ok("another user's overlay", overlay, two)
	// Overlays are reads too; the refused one counted nothing.
	for i := gateway.MaxMapOverlays; i < gateway.MaxMapReads; i++ {
		ok(fmt.Sprintf("read %d after the overlays", i+1), tick, one)
	}
	busy("a read past the overlays and reads", tick, one)

	// Unsigned reads cannot crowd signed-in users out.
	w.clock.Advance(time.Second)
	for i := range gateway.MaxMapAll + 1 {
		unsigned(fmt.Sprintf("unsigned read %d", i+1), "")
	}
	ok("a user's read after the unsigned ones", tick, two)

	w.clock.Advance(time.Second)
	users := make([]string, gateway.MaxMapAll/gateway.MaxMapReads)
	for i := range users {
		users[i] = w.signIn(fmt.Sprintf("lim-all-%d", i)).Session
	}
	for i, s := range users {
		for j := range gateway.MaxMapReads {
			ok(fmt.Sprintf("user %d's read %d", i+1, j+1), tick, s)
		}
	}
	busy("one read past everyone's cap", tick, users[0])
	busy("a user's first read past everyone's cap", tick, two)
	busy("a user's first overlay past everyone's cap", overlay, two)
	w.clock.Advance(time.Second)
	// Users who stopped reading are forgotten; only the reader now is held.
	ok("a read a second later", tick, users[0])
	if n := w.gw.MapUsers(); n != 1 {
		t.Errorf("%d users still counted a second after their last read, want 1", n)
	}
	w.clock.Advance(time.Second)
	ok("another user's read a second later", tick, one)
	if n := w.gw.MapUsers(); n != 1 {
		t.Errorf("%d users counted, want 1", n)
	}
}

// TestActivityMapMalformed counts a malformed overlay or chunk read in no
// window.
func TestActivityMapMalformed(t *testing.T) {
	h := &fakeHost{players: map[string]string{"bad-1": "c1"}, states: map[string]api.ActivityState{}}
	w := faked(t, h, nil)
	one := w.signIn("bad-1").Session
	base := w.srv.URL + api.PathActivityMapOverlay

	for i := range gateway.MaxMapOverlays {
		status, body := mapGet(t, base+"?scope=everything", one)
		if status != http.StatusBadRequest || !strings.Contains(string(body), api.MapOverlayRefusal().Message) {
			t.Fatalf("malformed overlay %d: %d %s", i+1, status, body)
		}
	}
	for i := range gateway.MaxMapOverlays {
		if status, body := mapGet(t, base+"?scope=sight", one); status != http.StatusOK {
			t.Fatalf("overlay %d after the malformed ones: %d %s", i+1, status, body)
		}
	}

	w.clock.Advance(time.Second)
	if status, body := mapGet(t, w.srv.URL+api.PathActivityMapChunk+"?a=x&b=0&level=tile", one); status != http.StatusBadRequest {
		t.Fatalf("malformed chunk read: %d %s", status, body)
	}
	for i := range gateway.MaxMapReads {
		if status, body := mapGet(t, w.srv.URL+api.PathActivityMapTick, one); status != http.StatusOK {
			t.Fatalf("read %d after a malformed chunk read: %d %s", i+1, status, body)
		}
	}
}
