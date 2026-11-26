package service_test

import (
	"bytes"
	"cmp"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

var updateAgree = flag.Bool("update", false, "rewrite packages/mmo-map/test/fixtures/agree.json")

const agreeGolden = "../../../packages/mmo-map/test/fixtures/agree.json"

// structural: walk and arrival limits, how many map reads a test sends
// inside a second (under maxMapReads), the tiles found out of a walker's
// sight, and the steps a walker takes out to the frontier.
const (
	proofWalkMax   = 40
	proofArrive    = 1
	proofReadBurst = 150
	proofFinds     = 6
	proofFrontier  = 12
)

// proofPace keeps a test's map reads under the world's cap: every
// proofReadBurst reads it waits out the rest of the second.
type proofPace struct {
	n     int
	since time.Time
}

func (p *proofPace) read() {
	if p.n == 0 {
		p.since = time.Now()
	}
	p.n++
	if p.n < proofReadBurst {
		return
	}
	if wait := time.Second - time.Since(p.since); wait > 0 {
		time.Sleep(wait + 10*time.Millisecond)
	}
	p.n = 0
}

// proofBody is a map or player read's body, which must answer status.
func proofBody(t *testing.T, r *running, pace *proofPace, path string, status int) []byte {
	t.Helper()
	pace.read()
	got, _, body := mapGet(t, r, path, "")
	if got != status {
		t.Fatalf("%s: HTTP %d, want %d: %s", path, got, status, body)
	}
	return body
}

func proofRead[T any](t *testing.T, r *running, pace *proofPace, path string) (T, []byte) {
	t.Helper()
	body := proofBody(t, r, pace, path, http.StatusOK)
	var out T
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	return out, body
}

// named is one tile a reply names, with where in the reply it stands.
type named struct {
	path string
	h    hex.Hex
}

// replyHexes are every tile a JSON reply names: each object with integer q
// and r, and each slot of a region row that holds a region.
func replyHexes(t *testing.T, body []byte) []named {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		t.Fatal(err)
	}
	var out []named
	var walk func(v any, path string)
	walk = func(v any, path string) {
		switch x := v.(type) {
		case map[string]any:
			q, okQ := x["q"].(json.Number)
			rr, okR := x["r"].(json.Number)
			if okQ && okR {
				qi, err1 := q.Int64()
				ri, err2 := rr.Int64()
				if err1 != nil || err2 != nil {
					t.Fatalf("%s holds q %s and r %s", path, q, rr)
				}
				if slots, ok := x["slots"].([]any); ok {
					for i, s := range slots {
						n, err := s.(json.Number).Int64()
						if err != nil {
							t.Fatal(err)
						}
						if i == 0 && n < 0 {
							t.Errorf("%s: a region row starts on a tile nobody found", path)
						}
						if n >= 0 {
							out = append(out, named{fmt.Sprintf("%s.slots[%d]", path, i), hex.Hex{Q: qi + int64(i), R: ri}})
						}
					}
				} else {
					out = append(out, named{path, hex.Hex{Q: qi, R: ri}})
				}
			}
			keys := make([]string, 0, len(x))
			for k := range x {
				keys = append(keys, k)
			}
			slices.Sort(keys)
			for _, k := range keys {
				walk(x[k], path+"."+k)
			}
		case []any:
			for i, e := range x {
				walk(e, fmt.Sprintf("%s[%d]", path, i))
			}
		}
	}
	walk(v, "")
	return out
}

// known is the set of tiles somebody has found, read while the world is
// held still.
func known(r *running) map[hex.Hex]bool {
	unlock := r.srv.Hold()
	defer unlock()
	out := map[hex.Hex]bool{}
	for _, ts := range r.srv.Game().World.Tiles {
		if ts.Discovered != nil {
			out[ts.Hex] = true
		}
	}
	return out
}

// proofStep sends one step, the move pick chooses, and runs the world a
// tick at a time until the character stands on the move's tile, calling
// each after every tick.
func proofStep(t *testing.T, r *running, c api.Character, key string, pick func(api.Options) (api.Move, bool), each func()) hex.Hex {
	t.Helper()
	o, err := r.cli.Options(t.Context(), c.ID)
	if err != nil {
		t.Fatal(err)
	}
	m, ok := pick(o)
	if !ok {
		t.Fatalf("%s: no open move from %+v", key, o.At)
	}
	mapAct(t, r, api.ActionRequest{InteractionID: key, CharacterID: c.ID, Kind: api.ActStep, Dir: m.Dir})
	to := simHex(m.To)
	for n := int64(1); atOf(r, c.ID) != to; n++ {
		if n > m.Ticks+proofArrive {
			t.Fatalf("%s: %s never arrived at %v", key, c.ID, to)
		}
		advance(t, t.Context(), r, o.Tick+n)
		if each != nil {
			each()
		}
	}
	return to
}

// farFrom picks the open move that leads farthest from h; nearTo the one
// that leads nearest it; onto the one onto it.
func farFrom(h hex.Hex) func(api.Options) (api.Move, bool) {
	return pickBy(func(m api.Move) int64 { return -hex.Distance(simHex(m.To), h) })
}

func nearTo(h hex.Hex) func(api.Options) (api.Move, bool) {
	return pickBy(func(m api.Move) int64 { return hex.Distance(simHex(m.To), h) })
}

func onto(h hex.Hex) func(api.Options) (api.Move, bool) {
	return pickBy(func(m api.Move) int64 {
		if simHex(m.To) == h {
			return 0
		}
		return 1
	})
}

func pickBy(score func(api.Move) int64) func(api.Options) (api.Move, bool) {
	return func(o api.Options) (api.Move, bool) {
		best := -1
		for i, m := range o.Moves {
			if m.Open && (best < 0 || score(m) < score(o.Moves[best])) {
				best = i
			}
		}
		if best < 0 {
			return api.Move{}, false
		}
		return o.Moves[best], true
	}
}

// farSight is the most tiles any character could see: the widest terrain
// sight and the most high ground adds under any sky.
func farSight(b *sheets.Book) int64 {
	var ter, high int64
	for _, x := range b.Terrain {
		ter = max(ter, x.Sight)
	}
	for _, w := range b.Weather {
		high = max(high, w.HighSight)
	}
	return ter + high
}

// inSight reports whether a character's view holds h now.
func inSight(r *running, id string, h hex.Hex) bool {
	unlock := r.srv.Hold()
	defer unlock()
	g := r.srv.Game()
	return mapview.Sights(g, g.Char(id))[h]
}

// liveNow is h's live layers as the world reads them now for the
// character whose overlay or record it is compared with.
func liveNow(r *running, characterID string, h hex.Hex) api.MapLive {
	unlock := r.srv.Hold()
	defer unlock()
	return mapview.Live(r.srv.Game(), h, mapview.ParamsOf(r.book), map[string]bool{characterID: true})
}

func chunkOfHex(r *running, h hex.Hex) gen.ChunkCoord {
	unlock := r.srv.Hold()
	defer unlock()
	return r.srv.Game().World.Gen().ChunkOf(h)
}

// liveOf is the overlay's entry for h.
func liveOf(o api.MapOverlay, h hex.Hex) (api.MapLive, bool) {
	i := slices.IndexFunc(o.Tiles, func(l api.MapLive) bool { return l.Q == h.Q && l.R == h.R })
	if i < 0 {
		return api.MapLive{}, false
	}
	return o.Tiles[i], true
}

// seenAgo is the age line the map's words give a last-seen tile.
func seenAgo(tick, left int64) string {
	switch d := max(tick-left, 0) / sheets.TicksPerDay; d {
	case 0:
		return "seen less than a world day ago"
	case 1:
		return "seen 1 world day ago"
	default:
		return fmt.Sprintf("seen %d world days ago", d)
	}
}

func overlayPath(user string, cc ...gen.ChunkCoord) string {
	ids := make([]string, len(cc))
	for i, c := range cc {
		ids[i] = fmt.Sprintf("%d.%d", c.A, c.B)
	}
	return fmt.Sprintf("%s?chunks=%s&discordId=%s", api.PathMapOverlay, strings.Join(ids, ","), user)
}

// TestMapUndiscoveredReturnsNothing reads every map payload at every
// level, the overlay by chunks and by sight, /v1/map, /v1/tiles and
// /v1/place round a guild member standing just past the frontier, on a
// tile nobody has found: no reply names a tile nobody found, but the
// viewer's own tile in the viewer's own reads, and a chunk with no found
// tile is not there.
func TestMapUndiscoveredReturnsNothing(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	pace := &proofPace{}
	c, _ := founder(t, r, "c-admin", "u-admin", "srv-1")
	other := mapCreate(t, r, "map-other", "u-other", "")
	advance(t, ctx, r, 1)
	home := atOf(r, c.ID)
	for n := range proofFrontier {
		proofStep(t, r, c, fmt.Sprintf("walk-%d", n), farFrom(home), nil)
	}
	// Set down beside its trail, on a tile nobody found, as an arrival
	// stands before the tick that discovers it.
	var own hex.Hex
	func() {
		unlock := r.srv.Hold()
		defer unlock()
		g := r.srv.Game()
		ch := g.Char(c.ID)
		for _, h := range hex.DiscAt(ch.C.At, 2) {
			ts := g.World.Tile(h)
			ter := g.World.Gen().Terrain(g.World.Baseline(h).Terrain)
			if (ts == nil || ts.Discovered == nil) && ter != nil && ter.Passable && g.PlaceAt(h) == nil {
				own = h
				break
			}
		}
		if own == (hex.Hex{}) {
			t.Fatal("no tile nobody found beside the trail")
		}
		if err := g.Teleport(ch, own); err != nil {
			t.Fatal(err)
		}
	}()
	found := known(r)
	if found[own] {
		t.Fatalf("the viewer's tile %v is found", own)
	}
	unlock := r.srv.Hold()
	gn := r.srv.Game().World.Gen()
	unlock()

	// check requires every tile a reply names to be found; own(path)
	// says where the viewer's own tile may stand in it.
	total := 0
	check := func(name string, body []byte, own func(path string, h hex.Hex) bool) {
		t.Helper()
		for _, n := range replyHexes(t, body) {
			total++
			if !found[n.h] && (own == nil || !own(n.path, n.h)) {
				t.Errorf("%s names %v at %s, which nobody found", name, n.h, n.path)
			}
		}
		if strings.Contains(string(body), `"`+other.ID+`"`) {
			t.Errorf("%s names %s", name, other.ID)
		}
	}
	ownAt := func(prefixes ...string) func(string, hex.Hex) bool {
		return func(path string, h hex.Hex) bool {
			return h == own && slices.ContainsFunc(prefixes, func(p string) bool {
				return path == p || strings.HasPrefix(path, p+".") || strings.HasPrefix(path, p+"[")
			})
		}
	}

	index, body := proofRead[api.MapIndex](t, r, pace, api.PathMapIndex)
	check("the index", body, func(path string, h hex.Hex) bool {
		// A chunk's centre is the lattice's, a function of its id alone.
		var i int
		if _, err := fmt.Sscanf(path, ".chunks[%d].centre", &i); err != nil || i >= len(index.Chunks) {
			return false
		}
		ref := index.Chunks[i]
		return h == gn.ChunkCentre(gen.ChunkCoord{A: ref.A, B: ref.B})
	})
	_, body = proofRead[api.MapStyle](t, r, pace, api.PathMapStyle)
	check("the style", body, nil)
	_, body = proofRead[api.MapRegions](t, r, pace, api.PathMapRegions)
	check("the regions", body, nil)
	for _, q := range []string{"", "?server=srv-1", "?server=srv-none"} {
		_, body = proofRead[api.MapFocus](t, r, pace, api.PathMapFocus+q)
		check("the focus"+q, body, nil)
	}
	chunks := map[gen.ChunkCoord]bool{}
	var ids []gen.ChunkCoord
	for _, ref := range index.Chunks {
		cc := gen.ChunkCoord{A: ref.A, B: ref.B}
		chunks[cc] = true
		ids = append(ids, cc)
		for _, level := range []string{api.LevelArea, api.LevelTile} {
			p := fmt.Sprintf("%s?a=%d&b=%d&level=%s", api.PathMapChunk, ref.A, ref.B, level)
			ch, body := proofRead[api.MapChunk](t, r, pace, p)
			if int64(len(ch.Cells)) != ref.Tiles {
				t.Errorf("%s: %d cells, the index counts %d", p, len(ch.Cells), ref.Tiles)
			}
			check(p, body, nil)
		}
	}
	if !chunks[gn.ChunkOf(own)] {
		t.Logf("the viewer stands in chunk %v, which holds no found tile", gn.ChunkOf(own))
	}
	var unfound []gen.ChunkCoord
	for _, cc := range ids {
		for da := int64(-1); da <= 1; da++ {
			for db := int64(-1); db <= 1; db++ {
				n := gen.ChunkCoord{A: cc.A + da, B: cc.B + db}
				if chunks[n] || slices.Contains(unfound, n) {
					continue
				}
				unfound = append(unfound, n)
				for _, level := range []string{api.LevelArea, api.LevelTile} {
					p := fmt.Sprintf("%s?a=%d&b=%d&level=%s", api.PathMapChunk, n.A, n.B, level)
					if body := proofBody(t, r, pace, p, http.StatusNotFound); !strings.Contains(string(body), api.CodeNotFound) {
						t.Errorf("%s: %s", p, body)
					}
				}
			}
		}
	}
	if len(unfound) == 0 {
		t.Fatal("no chunk without a found tile was asked for")
	}

	// The viewer's own reads: its tile reaches it in Self, Self's cell and
	// its own live entry and front, and on /v1/map.
	asked := append(slices.Clone(ids), unfound...)
	if len(asked) > 64 {
		asked = asked[:64]
	}
	for name, p := range map[string]string{
		"the overlay by chunks": overlayPath("u-admin", asked...),
		"the overlay by sight":  api.PathMapOverlay + "?scope=sight&discordId=u-admin",
	} {
		o, body := proofRead[api.MapOverlay](t, r, pace, p)
		if o.Viewer != api.ViewerCharacter || !o.Guild || o.Self == nil || o.Self.Character != c.ID || o.Self.Cell == nil {
			t.Fatalf("%s: viewer %s, guild %v, self %+v", name, o.Viewer, o.Guild, o.Self)
		}
		if (hex.Hex{Q: o.Self.Q, R: o.Self.R}) != own || (hex.Hex{Q: o.Self.Cell.Q, R: o.Self.Cell.R}) != own {
			t.Errorf("%s: self %+v, not on %v", name, o.Self, own)
		}
		if _, ok := liveOf(o, own); !ok || len(o.Tiles) < 2 {
			t.Errorf("%s: %d tiles in sight, the own one %v", name, len(o.Tiles), ok)
		}
		check(name, body, ownAt(".self", ".tiles", ".fronts"))
	}
	for _, radius := range []int64{2, 6} {
		p := fmt.Sprintf("%s?characterId=%s&radius=%d", api.PathMap, c.ID, radius)
		mv, body := proofRead[api.MapView](t, r, pace, p)
		if !slices.ContainsFunc(mv.View, func(v api.MapTileView) bool { return v.Cell.Q == own.Q && v.Cell.R == own.R }) {
			t.Errorf("%s: the view lacks the viewer's own tile", p)
		}
		check(p, body, ownAt(".centre", ".tiles", ".view"))
	}

	// The reads with no viewer: never the own tile.
	p := fmt.Sprintf("%s?q=%d&r=%d&radius=8", api.PathTiles, own.Q, own.R)
	tiles, body := proofRead[api.Tiles](t, r, pace, p)
	if len(tiles.Tiles) == 0 {
		t.Fatalf("%s: no found tile round the viewer", p)
	}
	check(p, body, nil)
	places := 0
	for _, h := range hex.DiscAt(own, 3) {
		for _, who := range []string{"", "&characterId=" + c.ID} {
			p := fmt.Sprintf("%s?q=%d&r=%d%s", api.PathPlace, h.Q, h.R, who)
			if !found[h] {
				proofBody(t, r, pace, p, http.StatusNotFound)
				continue
			}
			_, body := proofRead[api.Place](t, r, pace, p)
			check(p, body, nil)
			places++
		}
	}
	if places == 0 {
		t.Fatal("no found tile near the viewer to read as a place")
	}
	t.Logf("%d chunks found and %d asked that hold none; %d tiles named in all, none unfound but the viewer's own %v", len(ids), len(unfound), total, own)
}

// TestMapLastSeenKeepsOldThreat walks a character out of sight of home,
// raises home's region's threat by an operator's overrun cast and runs
// 300 ticks: the walker's map keeps home as last seen with the old threat
// and the tick it left, two world days old, while a character standing at
// home sees the new value throughout; walking back shows it the new value.
func TestMapLastSeenKeepsOldThreat(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	pace := &proofPace{}
	advance(t, ctx, r, 1)
	a := mapCreate(t, r, "map-a", "u-a", "")
	b := mapCreate(t, r, "map-b", "u-b", "")
	home := atOf(r, b.ID)
	if atOf(r, a.ID) != home {
		t.Fatal("the two start apart")
	}
	cc := chunkOfHex(r, home)

	// Each time home leaves A's sight, what the world reads there then is
	// what A's record must hold.
	var left int64
	var was api.MapLive
	seen := true
	watch := func() {
		now := inSight(r, a.ID, home)
		if seen && !now {
			left, was = r.srv.Tick(), liveNow(r, a.ID, home)
		}
		seen = now
	}
	reach := farSight(r.book)
	for n := 0; hex.Distance(atOf(r, a.ID), home) <= reach; n++ {
		if n >= proofWalkMax {
			t.Fatalf("%d steps never took A past %d tiles from home", n, reach)
		}
		proofStep(t, r, a, fmt.Sprintf("out-%d", n), farFrom(home), watch)
	}
	if seen || left == 0 {
		t.Fatalf("home never left A's sight (left %d)", left)
	}
	want := was
	want.Fog, want.Left = api.FogSeen, left
	readA := func(label string) api.MapLive {
		t.Helper()
		o, _ := proofRead[api.MapOverlay](t, r, pace, overlayPath("u-a", cc))
		got, ok := liveOf(o, home)
		if !ok || got != want {
			t.Fatalf("%s: A's map holds home as %+v (%v), want %+v", label, got, ok, want)
		}
		return got
	}
	readB := func(label string) api.MapLive {
		t.Helper()
		o, _ := proofRead[api.MapOverlay](t, r, pace, overlayPath("u-b", cc))
		got, ok := liveOf(o, home)
		if now := liveNow(r, b.ID, home); !ok || got != now {
			t.Fatalf("%s: B's map holds home as %+v (%v), the world %+v", label, got, ok, now)
		}
		return got
	}
	readA("walked away")
	readB("walked away")

	overrun(t, r, 0, "overrun-home")
	from := r.srv.Tick()
	const ticks = 300
	var raised int64
	for tick := from + proofCheckEvery; tick <= from+ticks; tick += proofCheckEvery {
		advance(t, ctx, r, tick)
		readA(fmt.Sprintf("tick %d", tick))
		if v := readB(fmt.Sprintf("tick %d", tick)).Threat; v > want.Threat && raised == 0 {
			raised = tick
		}
	}
	now := liveNow(r, b.ID, home)
	if now.Threat <= want.Threat || raised == 0 {
		t.Fatalf("home's threat stands at %d after the overrun, %d when A left", now.Threat, want.Threat)
	}
	o, _ := proofRead[api.MapOverlay](t, r, pace, overlayPath("u-a", cc))
	if got := seenAgo(o.Tick, left); got != "seen 2 world days ago" {
		t.Fatalf("home left A's sight at tick %d and reads %q at tick %d", left, got, o.Tick)
	}
	t.Logf("A left home's sight at tick %d with threat %d; it rose past that to %d by tick %d; at tick %d A's map reads %d, %q",
		left, want.Threat, now.Threat, raised, o.Tick, want.Threat, seenAgo(o.Tick, left))

	for n := 0; !inSight(r, a.ID, home); n++ {
		if n >= proofWalkMax {
			t.Fatalf("%d steps never brought home into A's sight", n)
		}
		proofStep(t, r, a, fmt.Sprintf("back-%d", n), nearTo(home), nil)
	}
	back, _ := proofRead[api.MapOverlay](t, r, pace, overlayPath("u-a", cc))
	got, ok := liveOf(back, home)
	if now := liveNow(r, a.ID, home); !ok || got.Fog != api.FogSight || got.Left != 0 || got != now || got.Threat == want.Threat {
		t.Fatalf("back in sight, A's map holds home as %+v (%v), the world %+v", got, ok, now)
	}
	readB("A back")
}

// structural: ticks between the last-seen test's reads.
const proofCheckEvery = 25

// TestMapAnonymousNoLiveLayer asks the overlay with no Discord id and with
// one nobody plays: no tile, front, self or name, by chunks and by sight,
// in a world whose character sees live layers; and no base payload holds
// any key of a tile's live layers.
func TestMapAnonymousNoLiveLayer(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	pace := &proofPace{}
	c, _ := founder(t, r, "c-admin", "u-admin", "srv-1")
	mapCreate(t, r, "map-other", "u-other", "")
	advance(t, ctx, r, 1)
	home := atOf(r, c.ID)
	for n := range 6 {
		proofStep(t, r, c, fmt.Sprintf("walk-%d", n), farFrom(home), nil)
	}

	liveKeys := map[string]bool{}
	lt := reflect.TypeFor[api.MapLive]()
	for i := range lt.NumField() {
		if k, _, _ := strings.Cut(lt.Field(i).Tag.Get("json"), ","); k != "q" && k != "r" {
			liveKeys[k] = true
		}
	}
	noLive := func(name string, body []byte) {
		t.Helper()
		var v any
		if err := json.Unmarshal(body, &v); err != nil {
			t.Fatal(err)
		}
		if p := keyIn(v, liveKeys, ""); p != "" {
			t.Errorf("%s holds a live layer's key at %s", name, p)
		}
	}
	index, body := proofRead[api.MapIndex](t, r, pace, api.PathMapIndex)
	noLive("the index", body)
	_, body = proofRead[api.MapStyle](t, r, pace, api.PathMapStyle)
	noLive("the style", body)
	_, body = proofRead[api.MapRegions](t, r, pace, api.PathMapRegions)
	noLive("the regions", body)
	_, body = proofRead[api.MapFocus](t, r, pace, api.PathMapFocus+"?server=srv-1")
	noLive("the focus", body)
	var ids []gen.ChunkCoord
	for _, ref := range index.Chunks {
		ids = append(ids, gen.ChunkCoord{A: ref.A, B: ref.B})
		for _, level := range []string{api.LevelArea, api.LevelTile} {
			p := fmt.Sprintf("%s?a=%d&b=%d&level=%s", api.PathMapChunk, ref.A, ref.B, level)
			_, body := proofRead[api.MapChunk](t, r, pace, p)
			noLive(p, body)
		}
	}
	if len(ids) > 64 {
		ids = ids[:64]
	}

	seer, _ := proofRead[api.MapOverlay](t, r, pace, api.PathMapOverlay+"?scope=sight&discordId=u-admin")
	if seer.Viewer != api.ViewerCharacter || len(seer.Tiles) == 0 || seer.Self == nil {
		t.Fatalf("the character sees %d live tiles, self %+v", len(seer.Tiles), seer.Self)
	}
	byChunks := strings.TrimSuffix(overlayPath("", ids...), "&discordId=")
	for _, q := range []struct{ path, viewer string }{
		{byChunks, api.ViewerAnonymous},
		{api.PathMapOverlay + "?scope=sight", api.ViewerAnonymous},
		{byChunks + "&discordId=u-nobody", api.ViewerPlayer},
		{api.PathMapOverlay + "?scope=sight&discordId=u-nobody", api.ViewerPlayer},
	} {
		o, body := proofRead[api.MapOverlay](t, r, pace, q.path)
		if o.Viewer != q.viewer || o.Self != nil || o.Guild || o.Names != nil {
			t.Errorf("%s: viewer %s, self %+v, guild %v, names %v", q.path, o.Viewer, o.Self, o.Guild, o.Names)
		}
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(body, &raw); err != nil {
			t.Fatal(err)
		}
		if string(raw["tiles"]) != "[]" || string(raw["fronts"]) != "[]" {
			t.Errorf("%s: tiles %s, fronts %s", q.path, raw["tiles"], raw["fronts"])
		}
		for _, k := range []string{"self", "names", "guild"} {
			if _, ok := raw[k]; ok {
				t.Errorf("%s carries %s", q.path, k)
			}
		}
	}
}

// keyIn is the path of the first object key in keys anywhere in v, or "".
func keyIn(v any, keys map[string]bool, at string) string {
	switch x := v.(type) {
	case map[string]any:
		names := make([]string, 0, len(x))
		for k := range x {
			names = append(names, k)
		}
		slices.Sort(names)
		for _, k := range names {
			if keys[k] {
				return at + "." + k
			}
			if p := keyIn(x[k], keys, at+"."+k); p != "" {
				return p
			}
		}
	case []any:
		for i, e := range x {
			if p := keyIn(e, keys, fmt.Sprintf("%s[%d]", at, i)); p != "" {
				return p
			}
		}
	}
	return ""
}

// agreeCase is one character's disc: the site's half (the found cells of
// the tile chunks covering it, and the overlay over those chunks) and
// /v1/map's view of it.
type agreeCase struct {
	Character   string            `json:"character"`
	Radius      int64             `json:"radius"`
	Tick        int64             `json:"tick"`
	TicksPerDay int64             `json:"ticksPerDay"`
	Base        []api.MapCell     `json:"base"`
	Overlay     api.MapOverlay    `json:"overlay"`
	View        []api.MapTileView `json:"view"`
}

// merged is the site's view of a case: each base cell, and the own one
// nobody found, merged with the overlay's live layers.
func (c agreeCase) merged() []api.MapTileView {
	live := map[hex.Hex]*api.MapLive{}
	for i, l := range c.Overlay.Tiles {
		live[hex.Hex{Q: l.Q, R: l.R}] = &c.Overlay.Tiles[i]
	}
	cells := slices.Clone(c.Base)
	if s := c.Overlay.Self; s != nil && s.Cell != nil {
		cells = append(cells, *s.Cell)
	}
	out := make([]api.MapTileView, len(cells))
	for i, cell := range cells {
		out[i] = mapview.Merge(cell, live[hex.Hex{Q: cell.Q, R: cell.R}])
	}
	slices.SortFunc(out, func(a, b api.MapTileView) int {
		return cmp.Or(cmp.Compare(a.Cell.R, b.Cell.R), cmp.Compare(a.Cell.Q, b.Cell.Q))
	})
	return out
}

// cropOf is the /map picture's input a site view implies: each disc tile
// as merged, or fog by hex alone, the route as the overlay draws it, in
// the pack's style.
func cropOf(book *sheets.Book, at hex.Hex, radius int64, tick int64, view []api.MapTileView, o api.MapOverlay) render.MapCrop {
	byHex := map[hex.Hex]api.MapTileView{}
	for _, v := range view {
		byHex[hex.Hex{Q: v.Cell.Q, R: v.Cell.R}] = v
	}
	crop := render.MapCrop{Centre: at, Radius: radius, At: at, Style: mapview.Rev([]any{book.MapStyle, book.MapView})}
	if o.Self != nil {
		for _, x := range o.Self.Route {
			crop.Route = append(crop.Route, hex.Hex{Q: x.Q, R: x.R})
		}
	}
	for _, h := range hex.DiscAt(at, radius) {
		v, ok := byHex[h]
		if !ok {
			crop.Tiles = append(crop.Tiles, render.MapTile{Hex: h, Fog: api.FogUnknown})
			continue
		}
		c := v.Cell
		mt := render.MapTile{Hex: h, Fog: v.Fog, Terrain: c.Terrain, Road: c.Road, Site: c.Site, Region: c.Region,
			River: c.Water == gen.WaterRiver || c.Water == gen.WaterStream || c.Water == gen.WaterFord}
		if l := v.Live; l != nil {
			mt.Weather, mt.Threat, mt.Corruption, mt.Danger, mt.Corrupted = l.Weather, l.Threat, l.Corruption, l.Danger, l.Corrupted
			mt.Busy, mt.Trouble, mt.Fire, mt.Cut, mt.Toll = l.Busy, l.Trouble != "", l.Fire, l.Cut, l.Toll
			if v.Fog == api.FogSeen {
				mt.Age = max(tick-l.Left, 0) / sheets.TicksPerDay
			}
		}
		crop.Tiles = append(crop.Tiles, mt)
	}
	return crop
}

func fogsOf(view []api.MapTileView) map[string]int {
	out := map[string]int{}
	for _, v := range view {
		out[v.Fog]++
	}
	return out
}

// TestMapCropAgreesWithSite compares, for a guild member and a character
// in no guild at three radii, /v1/map's view and picture with what the
// site draws for the same character: the tile chunks covering the disc
// merged with its overlay. Every hex agrees, and the picture's key is the
// key of the crop the site's view implies. -update writes one case to the
// mmo-map golden, which agree.test.ts merges the same way.
func TestMapCropAgreesWithSite(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	pace := &proofPace{}
	admin, _ := founder(t, r, "c-admin", "u-admin", "srv-1")
	solo := mapCreate(t, r, "map-solo", "u-solo", "")
	advance(t, ctx, r, 1)
	home := atOf(r, solo.ID)
	reach := farSight(r.book)
	for n := 0; hex.Distance(atOf(r, solo.ID), home) <= reach+2; n++ {
		if n >= proofWalkMax {
			t.Fatal("the solo walker never got clear of home")
		}
		proofStep(t, r, solo, fmt.Sprintf("solo-%d", n), farFrom(home), nil)
	}
	away := atOf(r, solo.ID)
	for n := range reach + 2 {
		proofStep(t, r, admin, fmt.Sprintf("admin-%d", n), farFrom(away), nil)
	}
	// Ground the guild member finds near the solo walker, out of its
	// sight, is found and never seen by it.
	func() {
		unlock := r.srv.Hold()
		defer unlock()
		g := r.srv.Game()
		see := g.Sight(away) + 1
		n := 0
		for _, h := range hex.DiscAt(away, 6) {
			ts := g.World.Tile(h)
			ter := g.World.Gen().Terrain(g.World.Baseline(h).Terrain)
			if n == proofFinds || hex.Distance(h, away) <= see || (ts != nil && ts.Discovered != nil) || ter == nil || !ter.Passable {
				continue
			}
			if err := g.World.Discover(g.Log, h, char.Ref(admin.ID)); err != nil {
				t.Fatal(err)
			}
			n++
		}
	}()
	advance(t, ctx, r, r.srv.Tick()+1)

	index, _ := proofRead[api.MapIndex](t, r, pace, api.PathMapIndex)
	refs := map[gen.ChunkCoord]api.MapChunkRef{}
	for _, ref := range index.Chunks {
		refs[gen.ChunkCoord{A: ref.A, B: ref.B}] = ref
	}
	cells := map[hex.Hex]api.MapCell{}
	cellsOf := func(cc gen.ChunkCoord) {
		if _, ok := refs[cc]; !ok {
			proofBody(t, r, pace, fmt.Sprintf("%s?a=%d&b=%d&level=tile", api.PathMapChunk, cc.A, cc.B), http.StatusNotFound)
			return
		}
		ch, _ := proofRead[api.MapChunk](t, r, pace, fmt.Sprintf("%s?a=%d&b=%d&level=tile", api.PathMapChunk, cc.A, cc.B))
		for _, cell := range ch.Cells {
			cells[hex.Hex{Q: cell.Q, R: cell.R}] = cell
		}
	}

	var golden *agreeCase
	cases := 0
	for _, who := range []struct {
		c    api.Character
		user string
	}{{admin, "u-admin"}, {solo, "u-solo"}} {
		at := atOf(r, who.c.ID)
		for _, radius := range []int64{2, 4, 6} {
			name := fmt.Sprintf("%s at radius %d", who.c.ID, radius)
			mv, _ := proofRead[api.MapView](t, r, pace, fmt.Sprintf("%s?characterId=%s&radius=%d", api.PathMap, who.c.ID, radius))
			var discChunks []gen.ChunkCoord
			for _, h := range hex.DiscAt(at, radius) {
				if cc := chunkOfHex(r, h); !slices.Contains(discChunks, cc) {
					discChunks = append(discChunks, cc)
				}
			}
			slices.SortFunc(discChunks, func(a, b gen.ChunkCoord) int { return cmp.Or(cmp.Compare(a.A, b.A), cmp.Compare(a.B, b.B)) })
			for _, cc := range discChunks {
				cellsOf(cc)
			}
			ov, _ := proofRead[api.MapOverlay](t, r, pace, overlayPath(who.user, discChunks...))
			if ov.Tick != mv.Tick || mv.Tick != index.Tick {
				t.Fatalf("%s: read at ticks %d, %d and %d", name, index.Tick, ov.Tick, mv.Tick)
			}
			ac := agreeCase{Character: who.c.ID, Radius: radius, Tick: mv.Tick, TicksPerDay: sheets.TicksPerDay, Overlay: ov, View: mv.View}
			for _, h := range hex.DiscAt(at, radius) {
				if cell, ok := cells[h]; ok {
					ac.Base = append(ac.Base, cell)
				}
			}
			slices.SortFunc(ac.Base, func(a, b api.MapCell) int { return cmp.Or(cmp.Compare(a.R, b.R), cmp.Compare(a.Q, b.Q)) })
			site := ac.merged()
			if len(site) != len(mv.View) {
				t.Fatalf("%s: the site merges %d tiles, /v1/map views %d", name, len(site), len(mv.View))
			}
			for i := range site {
				a, _ := json.Marshal(site[i])
				b, _ := json.Marshal(mv.View[i])
				if !bytes.Equal(a, b) {
					t.Fatalf("%s: the site draws %s, /v1/map %s", name, a, b)
				}
			}
			body, err := json.Marshal(cropOf(r.book, at, radius, mv.Tick, site, ov))
			if err != nil {
				t.Fatal(err)
			}
			if key := render.Key("map", body); key != mv.Image {
				t.Fatalf("%s: /v1/map's picture is %s, the site's view implies %s", name, mv.Image, key)
			}
			fogs := fogsOf(mv.View)
			t.Logf("%s: %d tiles agree, by fog %v", name, len(site), fogs)
			cases++
			if fogs[api.FogSight] > 0 && fogs[api.FogSeen] > 0 && fogs[api.FogDiscovered] > 0 && (golden == nil || radius > golden.Radius) {
				golden = &ac
			}
		}
	}
	if golden == nil {
		t.Fatal("no case shows a tile in sight, one last seen and one found and never seen")
	}
	if *updateAgree {
		b, err := json.MarshalIndent(golden, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(agreeGolden, append(b, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Logf("wrote %s: %s at radius %d", agreeGolden, golden.Character, golden.Radius)
	}
	b, err := os.ReadFile(agreeGolden)
	if err != nil {
		t.Fatalf("%v (run with -update to write it)", err)
	}
	var kept agreeCase
	if err := json.Unmarshal(b, &kept); err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(kept.merged())
	v, _ := json.Marshal(kept.View)
	if !bytes.Equal(a, v) || len(kept.View) == 0 {
		t.Fatalf("%s: its base and overlay merge to another view than it keeps", agreeGolden)
	}
	if fogs := fogsOf(kept.View); fogs[api.FogSight] == 0 || fogs[api.FogSeen] == 0 || fogs[api.FogDiscovered] == 0 {
		t.Fatalf("%s shows fog states %v", agreeGolden, fogs)
	}
	t.Logf("%d cases agree", cases)
}

// TestMapBusyNoPosition has A walk a tile next to home once, then B walk it
// alone in A's sight: B alone leaves it quiet to A however often it passes,
// A's own track not counting, and no reply to A names B or puts A's self
// where B stands; once a third walker has walked it the tile reads light or
// busier; out of A's sight, A's map keeps the band it last saw.
func TestMapBusyNoPosition(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	pace := &proofPace{}
	advance(t, ctx, r, 1)
	a := mapCreate(t, r, "map-a", "u-a", "")
	b := mapCreate(t, r, "map-b", "u-b", "")
	home := atOf(r, a.ID)
	o, err := r.cli.Options(ctx, b.ID)
	if err != nil {
		t.Fatal(err)
	}
	m, ok := pickBy(func(m api.Move) int64 { return m.Ticks })(o)
	if !ok {
		t.Fatal("no open move from home")
	}
	path := simHex(m.To)
	cc := chunkOfHex(r, path)
	params := mapview.ParamsOf(r.book)
	tileOf := func() (visits int64, walkers []string) {
		unlock := r.srv.Hold()
		defer unlock()
		ts := r.srv.Game().World.Tile(path)
		if ts == nil {
			return 0, nil
		}
		for _, k := range ts.Tracks {
			if !slices.Contains(walkers, k.Who.ID) {
				walkers = append(walkers, k.Who.ID)
			}
		}
		return ts.Visits, walkers
	}
	names := regexp.MustCompile(`(^|[^0-9A-Za-z_])` + regexp.QuoteMeta(b.ID) + `([^0-9A-Za-z_]|$)`)
	// toA reads what A may read while B stands on the path: nothing names
	// B, and A's self is A's own tile.
	toA := func(label string) api.MapOverlay {
		t.Helper()
		reads := []string{
			overlayPath("u-a", cc, chunkOfHex(r, home)),
			api.PathMapOverlay + "?scope=sight&discordId=u-a",
			fmt.Sprintf("%s?characterId=%s&radius=4", api.PathMap, a.ID),
			fmt.Sprintf("%s?q=%d&r=%d&characterId=%s", api.PathPlace, path.Q, path.R, a.ID),
			fmt.Sprintf("%s?q=%d&r=%d&radius=4", api.PathTiles, home.Q, home.R),
			api.PathMapIndex,
			fmt.Sprintf("%s?a=%d&b=%d&level=tile", api.PathMapChunk, cc.A, cc.B),
		}
		var first api.MapOverlay
		for i, p := range reads {
			body := proofBody(t, r, pace, p, http.StatusOK)
			if names.Match(body) {
				t.Fatalf("%s: %s names %s: %s", label, p, b.ID, body)
			}
			if i > 1 {
				continue
			}
			var ov api.MapOverlay
			if err := json.Unmarshal(body, &ov); err != nil {
				t.Fatal(err)
			}
			if ov.Self == nil || (hex.Hex{Q: ov.Self.Q, R: ov.Self.R}) != atOf(r, a.ID) || (hex.Hex{Q: ov.Self.Q, R: ov.Self.R}) == atOf(r, b.ID) {
				t.Fatalf("%s: %s puts A's self at %+v; A stands on %v, B on %v", label, p, ov.Self, atOf(r, a.ID), atOf(r, b.ID))
			}
			if i == 0 {
				first = ov
			}
		}
		return first
	}

	proofStep(t, r, a, "a-first-out", onto(path), nil)
	proofStep(t, r, a, "a-first-back", onto(home), nil)

	trips, withA := 0, 0
	// However often B passes alone, enough for a busy band, the path stays
	// quiet to A: one walker besides A never lights a tile A walked too.
	for visits, _ := tileOf(); visits < params.BusyBusy; visits, _ = tileOf() {
		if trips >= proofWalkMax {
			t.Fatalf("%d trips left the path with %d visits", trips, visits)
		}
		proofStep(t, r, b, fmt.Sprintf("b-out-%d", trips), onto(path), nil)
		if !inSight(r, a.ID, path) {
			t.Fatalf("the path %v is out of A's sight", path)
		}
		ov := toA(fmt.Sprintf("B's trip %d", trips))
		if l, ok := liveOf(ov, path); !ok || l.Fog != api.FogSight || l.Busy != "" {
			t.Fatalf("B alone on the path: A's map holds it as %+v (%v)", l, ok)
		}
		if visits, walkers := tileOf(); visits >= params.BusyLight && slices.Contains(walkers, a.ID) {
			withA++
		}
		proofStep(t, r, b, fmt.Sprintf("b-back-%d", trips), onto(home), nil)
		trips++
	}
	if withA == 0 {
		t.Fatal("no trip of B's left A's own track on a path busy enough to light")
	}
	visits, walkers := tileOf()
	t.Logf("B alone walked the path %d times, %d of them with A's track kept: %d visits, tracks of %v, quiet to A", trips, withA, visits, walkers)

	c := mapCreate(t, r, "map-c", "u-c", "")
	proofStep(t, r, c, "c-out", onto(path), nil)
	proofStep(t, r, c, "c-back", onto(home), nil)
	visits, walkers = tileOf()
	body := proofBody(t, r, pace, overlayPath("u-a", cc), http.StatusOK)
	if names.Match(body) {
		t.Fatalf("after C's trip: A's overlay names %s: %s", b.ID, body)
	}
	var ov api.MapOverlay
	if err := json.Unmarshal(body, &ov); err != nil {
		t.Fatal(err)
	}
	l, ok := liveOf(ov, path)
	if !ok || l.Fog != api.FogSight || !slices.Contains([]string{api.BusyLight, api.BusyBusy, api.BusyCrowded}, l.Busy) {
		t.Fatalf("after B and C walked it (%d visits, tracks of %v): A's map holds the path as %+v (%v)", visits, walkers, l, ok)
	}
	t.Logf("B and C walked the path: %d visits, tracks of %v, reads %q", visits, walkers, l.Busy)

	var left int64
	var was api.MapLive
	seen := true
	watch := func() {
		now := inSight(r, a.ID, path)
		if seen && !now {
			left, was = r.srv.Tick(), liveNow(r, a.ID, path)
		}
		seen = now
	}
	reach := farSight(r.book)
	for n := 0; hex.Distance(atOf(r, a.ID), path) <= reach; n++ {
		if n >= proofWalkMax {
			t.Fatalf("%d steps never took A past %d tiles from the path", n, reach)
		}
		proofStep(t, r, a, fmt.Sprintf("a-away-%d", n), farFrom(path), watch)
	}
	ov, _ = proofRead[api.MapOverlay](t, r, pace, overlayPath("u-a", cc))
	got, ok := liveOf(ov, path)
	if seen || !ok || got.Fog != api.FogSeen || got.Left != left || got.Busy != was.Busy {
		t.Fatalf("out of sight since tick %d with band %q: A's map holds the path as %+v (%v)", left, was.Busy, got, ok)
	}
	t.Logf("out of A's sight since tick %d: the path keeps band %q", left, got.Busy)
}
