package service_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/guild"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/store/pgtest"
)

// mapGet is a GET with a bearer token ("" for none): its status, headers
// and body.
func mapGet(t *testing.T, r *running, path, token string) (int, http.Header, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, r.http.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := r.http.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, resp.Header, body
}

// mapRead is a map read that must answer status, decoded into T.
func mapRead[T any](t *testing.T, r *running, path, token string, status int) T {
	t.Helper()
	got, h, body := mapGet(t, r, path, token)
	if got != status {
		t.Fatalf("%s: HTTP %d, want %d: %s", path, got, status, body)
	}
	if cc := h.Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("%s: Cache-Control %q", path, cc)
	}
	var out T
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("%s: %v: %s", path, err, body)
	}
	return out
}

func refused(t *testing.T, r *running, path, token string, status int, code string) {
	t.Helper()
	if ref := mapRead[api.Refusal](t, r, path, token, status); ref.Code != code {
		t.Fatalf("%s: refused %+v, want %s", path, ref, code)
	}
}

// TestMapRoutes reads the map with the map token and with the API token,
// refuses a missing or wrong one and the map token anywhere else, serves
// every read open where neither is set, and refuses malformed reads with
// the existing codes.
func TestMapRoutes(t *testing.T) {
	const mapToken, apiToken = "map-test-token", "api-test-token"
	r := startOn(t, pgtest.Pool(t), io.Discard, func(c *service.Config) { c.APIToken, c.MapToken = apiToken, mapToken })
	ctx := context.Background()
	cli := client.New(r.http.URL, apiToken)
	rep, ref, err := cli.Act(ctx, api.ActionRequest{InteractionID: "new", DiscordID: "u-1", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id := rep.Character.ID
	advance(t, ctx, r, 1)

	for _, tok := range []string{"", "wrong", opToken} {
		refused(t, r, api.PathMapIndex, tok, http.StatusUnauthorized, api.CodeForbidden)
		refused(t, r, api.PathMapOverlay+"?scope=sight&discordId=u-1", tok, http.StatusUnauthorized, api.CodeForbidden)
	}
	if status, _, body := mapGet(t, r, api.PathOptions+"?characterId="+id, mapToken); status != http.StatusUnauthorized {
		t.Fatalf("the map token read a player path: %d %s", status, body)
	}
	if status, _, body := mapGet(t, r, api.PathOperatorDigest, mapToken); status != http.StatusUnauthorized {
		t.Fatalf("the map token read an operator path: %d %s", status, body)
	}
	for _, tok := range []string{mapToken, apiToken} {
		idx := mapRead[api.MapIndex](t, r, api.PathMapIndex, tok, http.StatusOK)
		if idx.World != r.cfg.World || idx.Tiles == 0 || len(idx.Chunks) == 0 || idx.Style == "" || idx.Regions == "" {
			t.Fatalf("the index: %+v", idx)
		}
		style := mapRead[api.MapStyle](t, r, api.PathMapStyle, tok, http.StatusOK)
		if style.Rev != idx.Style || len(style.Entries) == 0 || style.View.ZoomTile == 0 {
			t.Fatalf("the style %s against the index's %s: %d entries, %+v", style.Rev, idx.Style, len(style.Entries), style.View)
		}
		for _, e := range style.Entries {
			if strings.HasPrefix(e.ID, "terrain-") || e.Glyph == "none" || e.Pattern == "none" {
				t.Fatalf("a style entry as the sheet names it: %+v", e)
			}
		}
		if regions := mapRead[api.MapRegions](t, r, api.PathMapRegions, tok, http.StatusOK); regions.Rev != idx.Regions {
			t.Fatalf("the regions' rev %s against the index's %s", regions.Rev, idx.Regions)
		}
		ch := idx.Chunks[0]
		for level, rev := range map[string]string{api.LevelArea: ch.Area, api.LevelTile: ch.Tile} {
			got := mapRead[api.MapChunk](t, r, fmt.Sprintf("%s?a=%d&b=%d&level=%s", api.PathMapChunk, ch.A, ch.B, level), tok, http.StatusOK)
			if got.Rev != rev || got.Level != level || int64(len(got.Cells)) != ch.Tiles {
				t.Fatalf("chunk %d.%d at %s: rev %s, want %s, %d cells of %d", ch.A, ch.B, level, got.Rev, rev, len(got.Cells), ch.Tiles)
			}
		}
		chunks := fmt.Sprintf("chunks=%d.%d", ch.A, ch.B)
		if ov := mapRead[api.MapOverlay](t, r, api.PathMapOverlay+"?"+chunks, tok, http.StatusOK); ov.Viewer != api.ViewerAnonymous ||
			len(ov.Tiles) != 0 || len(ov.Fronts) != 0 || ov.Self != nil || ov.Names != nil {
			t.Fatalf("the anonymous overlay: %+v", ov)
		}
		if ov := mapRead[api.MapOverlay](t, r, api.PathMapOverlay+"?"+chunks+"&discordId=u-nobody", tok, http.StatusOK); ov.Viewer != api.ViewerPlayer ||
			len(ov.Tiles) != 0 || ov.Self != nil {
			t.Fatalf("a player's overlay: %+v", ov)
		}
		ov := mapRead[api.MapOverlay](t, r, api.PathMapOverlay+"?scope=sight&discordId=u-1", tok, http.StatusOK)
		if ov.Viewer != api.ViewerCharacter || ov.Self == nil || ov.Self.Character != id || len(ov.Tiles) == 0 {
			t.Fatalf("the character's overlay: %+v", ov)
		}
		if f := mapRead[api.MapFocus](t, r, api.PathMapFocus, tok, http.StatusOK); f.Centre != idx.Home || f.Settlements != 0 {
			t.Fatalf("the focus of no server: %+v against home %+v", f, idx.Home)
		}
	}

	bad := []string{
		api.PathMapChunk + "?a=0&level=tile", api.PathMapChunk + "?a=0&b=x&level=tile", api.PathMapChunk + "?a=0&b=0",
		api.PathMapChunk + "?a=0&b=0&level=region", api.PathMapChunk + "?a=0&b=0&level=street",
		api.PathMapOverlay, api.PathMapOverlay + "?chunks=0.0&scope=sight", api.PathMapOverlay + "?scope=all",
		api.PathMapOverlay + "?chunks=0", api.PathMapOverlay + "?chunks=0.0,", api.PathMapOverlay + "?chunks=a.b", api.PathMapOverlay + "?chunks=0.0.0",
	}
	for _, p := range bad {
		refused(t, r, p, mapToken, http.StatusBadRequest, api.CodeBadJSON)
	}
	refused(t, r, api.PathMapChunk+"?a=4000&b=-4000&level=tile", mapToken, http.StatusNotFound, api.CodeNotFound)
	refused(t, r, api.PathMapChunk+"?a=4000&b=-4000&level=area", mapToken, http.StatusNotFound, api.CodeNotFound)
	if ov := mapRead[api.MapOverlay](t, r, api.PathMapOverlay+"?chunks=4000.-4000&discordId=u-1", mapToken, http.StatusOK); len(ov.Tiles) != 1 ||
		ov.Tiles[0].Q != ov.Self.Q || ov.Tiles[0].R != ov.Self.R {
		t.Fatalf("an overlay of an unknown chunk holds more than the own tile: %+v", ov)
	}

	open := start(t, io.Discard)
	for _, p := range []string{api.PathMapIndex, api.PathMapStyle, api.PathMapRegions, api.PathMapFocus, api.PathMapOverlay + "?scope=sight"} {
		if status, h, body := mapGet(t, open, p, ""); status != http.StatusOK || h.Get("Cache-Control") != "no-store" {
			t.Fatalf("%s on an open world: %d %q %s", p, status, h.Get("Cache-Control"), body)
		}
	}

	only := startOn(t, pgtest.Pool(t), io.Discard, func(c *service.Config) { c.APIToken = apiToken })
	mapRead[api.MapIndex](t, only, api.PathMapIndex, apiToken, http.StatusOK)
	refused(t, only, api.PathMapIndex, "", http.StatusUnauthorized, api.CodeForbidden)
	refused(t, only, api.PathMapIndex, mapToken, http.StatusUnauthorized, api.CodeForbidden)
}

// TestMapReadCap refuses an overlay naming 65 chunks, and the 201st map
// read inside one second from everyone, until that second has passed.
func TestMapReadCap(t *testing.T) {
	var now atomic.Int64
	now.Store(time.UnixMilli(1_700_000_000_000).UnixNano())
	r := startOn(t, pgtest.Pool(t), io.Discard, func(c *service.Config) { c.Now = func() time.Time { return time.Unix(0, now.Load()) } })
	ids := make([]string, 65)
	for i := range ids {
		ids[i] = fmt.Sprintf("%d.%d", i, -i)
	}
	refused(t, r, api.PathMapOverlay+"?chunks="+strings.Join(ids, ","), "", http.StatusBadRequest, api.CodeBadJSON)
	mapRead[api.MapOverlay](t, r, api.PathMapOverlay+"?chunks="+strings.Join(ids[:64], ","), "", http.StatusOK)

	second := func() { now.Add(int64(time.Second)) }
	second()
	paths := []string{api.PathMapIndex, api.PathMapStyle, api.PathMapRegions, api.PathMapFocus}
	for i := range 200 {
		if status, _, body := mapGet(t, r, paths[i%len(paths)], ""); status != http.StatusOK {
			t.Fatalf("read %d of the second: %d %s", i+1, status, body)
		}
	}
	refused(t, r, api.PathMapIndex, "", http.StatusTooManyRequests, api.CodeBusy)
	refused(t, r, api.PathMapChunk+"?a=0&b=0&level=tile", "", http.StatusTooManyRequests, api.CodeBusy)
	if status, _, body := mapGet(t, r, api.PathHealth, ""); status != http.StatusOK {
		t.Fatalf("health while the map is busy: %d %s", status, body)
	}
	now.Add(int64(time.Second / 2))
	refused(t, r, api.PathMapIndex, "", http.StatusTooManyRequests, api.CodeBusy)
	second()
	mapRead[api.MapIndex](t, r, api.PathMapIndex, "", http.StatusOK)
}

// TestMapFocus centres a server's view on the discovered settlement of its
// guild's standing ones nearest their centroid, and on the world's home
// for a server with none: never a ruin, a faction's city or a tile nobody
// has found.
func TestMapFocus(t *testing.T) {
	r := start(t, io.Discard)
	ctx := context.Background()
	_, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	advance(t, ctx, r, 1)
	focus := func(server string) api.MapFocus {
		t.Helper()
		return mapRead[api.MapFocus](t, r, api.PathMapFocus+"?server="+server, "", http.StatusOK)
	}
	home := mapRead[api.MapIndex](t, r, api.PathMapIndex, "", http.StatusOK).Home
	if f := focus("srv-none"); f.Centre != home || f.Settlements != 0 {
		t.Fatalf("a server with no guild: %+v, home %+v", f, home)
	}

	release := r.srv.Hold()
	g := r.srv.Game()
	at := g.Places[n].Hex
	if st := g.World.Tile(at); st == nil || st.Discovered == nil {
		release()
		t.Fatalf("the guild's settlement at %v is not known after a tick", at)
	}
	release()
	want := api.Hex{Q: at.Q, R: at.R}
	if f := focus("srv-1"); f.Centre != want || f.Settlements != 1 {
		t.Fatalf("one settlement: %+v, want %+v", f, want)
	}
	release = r.srv.Hold()
	g.Places[n].Ruined = g.Tick()
	release()
	if f := focus("srv-1"); f.Centre != home || f.Settlements != 0 {
		t.Fatalf("the guild's settlement in ruin: %+v, home %+v", f, home)
	}
	release = r.srv.Hold()
	g.Places[n].Ruined = 0
	release()

	// On a scene of its own: three standing places east of one known
	// settlement, one of them nobody has found, and a ruin and a faction's
	// city that count for nothing. The centroid is nearest the unknown
	// one, so the known one next nearest is the centre.
	lg, err := game.New(testkit.Rules(t, testkit.Book(t), keys.Throwaway("map-focus")))
	if err != nil {
		t.Fatal(err)
	}
	p := lg.Places[0].Hex
	east := func(k int64) hex.Hex { return p.Add(hex.Direction(0).Scale(k)) }
	for _, h := range []hex.Hex{p, east(10), east(12)} {
		if err := lg.World.Discover(lg.Log, h, fact.Ref{Kind: "character", ID: "c-none"}); err != nil {
			t.Fatal(err)
		}
	}
	gd := &game.Guild{G: guild.New("g-focus", "Focus", "c-none", 0)}
	gd.G.Server = "srv-focus"
	lg.Guilds = append(lg.Guilds, gd)
	lg.Places[0].Guild = gd.G.ID
	faction := 0
	for i, h := range []hex.Hex{east(10), east(12), east(7), east(30), east(-30)} {
		pl := &game.Place{N: len(lg.Places), Hex: h, Lattice: -1, Guild: gd.G.ID}
		switch i {
		case 3:
			pl.Ruined = 1
		case 4:
			pl.Faction = &faction
		}
		lg.Places = append(lg.Places, pl)
	}
	f, err := service.NewLocal(lg).Host().MapFocus(ctx, "srv-focus")
	if wantAt := east(10); err != nil || f.Centre != (api.Hex{Q: wantAt.Q, R: wantAt.R}) || f.Settlements != 4 {
		t.Fatalf("the focus of four standing places: %+v %v, want %v", f, err, wantAt)
	}
}

// TestPlaceHereOwnOnly lists who stands on a tile, and its live layers,
// only to a character standing there; /v1/tiles serves base layers only.
func TestPlaceHereOwnOnly(t *testing.T) {
	r := start(t, io.Discard)
	ctx := context.Background()
	var ids [2]string
	for i := range ids {
		rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: fmt.Sprint("new-", i), DiscordID: fmt.Sprint("u-", i), Kind: api.ActCreate, Option: api.StartKnife})
		if err != nil || ref != nil {
			t.Fatal(ref, err)
		}
		ids[i] = rep.Character.ID
	}
	advance(t, ctx, r, 1)
	release := r.srv.Hold()
	g := r.srv.Game()
	a, b := g.Char(ids[0]), g.Char(ids[1])
	at := a.C.At
	if b.C.At != at {
		release()
		t.Fatalf("the two start apart: %v and %v", at, b.C.At)
	}
	if g.Emergence == nil {
		release()
		t.Fatal("no emergence state to haunt a tile with")
	}
	g.Emergence.Haunts[at] = &emerge.HauntRec{ID: "haunt-test"}
	release()
	defer func() {
		release := r.srv.Hold()
		delete(g.Emergence.Haunts, at)
		release()
	}()

	q := fmt.Sprintf("%s?q=%d&r=%d", api.PathPlace, at.Q, at.R)
	place := func(query string) api.Place {
		t.Helper()
		return readSolo[api.Place](t, r, q+query, http.StatusOK)
	}
	if p := place(""); len(p.Here) != 0 || p.Tile.Haunted {
		t.Fatalf("an anonymous read of the place: here %v, haunted %v", p.Here, p.Tile.Haunted)
	}
	if p := place("&characterId=c-nobody"); len(p.Here) != 0 || p.Tile.Haunted {
		t.Fatalf("a read for nobody: here %v", p.Here)
	}
	if p := place("&characterId=" + ids[0]); len(p.Here) != 2 || !p.Tile.Haunted {
		t.Fatalf("the read of one standing there: here %v, haunted %v", p.Here, p.Tile.Haunted)
	}
	here := readSolo[api.Here](t, r, api.PathHere+"?characterId="+ids[0], http.StatusOK)
	if len(here.Place.Here) != 2 || !here.Place.Tile.Haunted {
		t.Fatalf("/here: %+v", here.Place)
	}

	release = r.srv.Hold()
	err := g.Teleport(b, at.Neighbour(0))
	release()
	if err != nil {
		t.Fatal(err)
	}
	if p := place("&characterId=" + ids[1]); len(p.Here) != 0 || p.Tile.Haunted {
		t.Fatalf("a read for one standing elsewhere: here %v, haunted %v", p.Here, p.Tile.Haunted)
	}
	if p := place("&characterId=" + ids[0]); len(p.Here) != 1 || p.Here[0] != ids[0] {
		t.Fatalf("the read of the one left there: here %v", p.Here)
	}

	tiles := readSolo[api.Tiles](t, r, fmt.Sprintf("%s?q=%d&r=%d&radius=3", api.PathTiles, at.Q, at.R), http.StatusOK)
	if len(tiles.Tiles) == 0 {
		t.Fatal("no tiles round the start")
	}
	for _, tl := range tiles.Tiles {
		if tl.Weather != "" || tl.Cut || tl.Toll != 0 || tl.Camp != "" || tl.Haunted {
			t.Fatalf("a live layer on /v1/tiles: %+v", tl)
		}
	}
}

// TestMapOverlayNames carries, in a viewer's overlay, only the names their
// server masks among the refs the asked chunks name; the shared chunk
// keeps the written names, and another server's viewer gets none.
func TestMapOverlayNames(t *testing.T) {
	r := start(t, io.Discard)
	ctx := context.Background()
	a, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	if _, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "new-other", DiscordID: "u-other", Kind: api.ActCreate,
		Option: api.StartKnife, Server: "srv-2"}); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	if _, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "hide", DiscordID: "u-admin", CharacterID: a.ID, Version: a.Version, Kind: api.ActHouseSettings, Server: "srv-1",
		Admin: true, Settings: &api.HouseSettings{HideNames: true}}); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	advance(t, ctx, r, 1)
	release := r.srv.Hold()
	cc := r.srv.Game().World.Gen().ChunkOf(r.srv.Game().Places[n].Hex)
	release()
	chunk := mapRead[api.MapChunk](t, r, fmt.Sprintf("%s?a=%d&b=%d&level=tile", api.PathMapChunk, cc.A, cc.B), "", http.StatusOK)
	q := fmt.Sprintf("%s?chunks=%d.%d&discordId=", api.PathMapOverlay, cc.A, cc.B)
	ov := mapRead[api.MapOverlay](t, r, q+"u-admin", "", http.StatusOK)
	if len(ov.Names) == 0 {
		t.Fatalf("no masked name over %v", chunk.Names)
	}
	for ref, name := range ov.Names {
		written, ok := chunk.Names[ref]
		if !ok || name == written {
			t.Fatalf("the overlay names %s %q, the chunk %q", ref, name, written)
		}
	}
	if again := mapRead[api.MapChunk](t, r, fmt.Sprintf("%s?a=%d&b=%d&level=tile", api.PathMapChunk, cc.A, cc.B), "", http.StatusOK); again.Rev != chunk.Rev {
		t.Fatalf("a viewer's masks moved the shared chunk")
	}
	if other := mapRead[api.MapOverlay](t, r, q+"u-other", "", http.StatusOK); other.Names != nil {
		t.Fatalf("another server's viewer got masks: %v", other.Names)
	}
}
