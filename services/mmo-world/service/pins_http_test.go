package service_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	simworld "jams.team/mmo-world/sim/world"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// pinSearch is how far from a character a test looks for a tile a pin
// may stand on; pinPathSearch how many rings past a pin's walk it looks
// for one no walk joins to known ground.
const (
	pinSearch     = 40
	pinPathSearch = 60
	pinServer     = "srv-a"
	pinLabel      = "Server A"
)

var designer = simworld.PinBy{Role: simworld.PinDesigner}

func apiAt(h hex.Hex) *api.Hex { return &api.Hex{Q: h.Q, R: h.R} }

// leadFix fixes a tile's lead to the last of its archetypes.
func leadFix(g *game.Game, h hex.Hex) api.PinFix {
	a := g.Rules().Gen.Archetypes(h)
	if len(a) == 0 {
		return api.PinFix{}
	}
	return api.PinFix{Lead: a[len(a)-1]}
}

func simFix(f api.PinFix) tile.Fix {
	return tile.Fix{Site: f.Site, Landmark: f.Landmark, SiteKind: f.SiteKind, Dungeon: f.Dungeon, Floors: f.Floors, Lead: f.Lead, Stock: f.Stock}
}

// pinTiles are up to n tiles from least to most rings round from, nearest
// first, where by's reserve of fix would be accepted, or refused with
// code when code is set.
func pinTiles(g *game.Game, from hex.Hex, least, most int64, n int, by simworld.PinBy, code string, fix func(hex.Hex) api.PinFix, keep func(hex.Hex) bool) []hex.Hex {
	var out []hex.Hex
	for r := least; r <= most && len(out) < n; r++ {
		for _, h := range hex.Ring(from, r) {
			f := fix(h)
			if (code == "" && f == (api.PinFix{})) || (keep != nil && !keep(h)) {
				continue
			}
			err := g.World.CheckPin(h, 1, simFix(f), by, false)
			var ref *simworld.Refusal
			if (code == "" && err == nil) || (code != "" && errors.As(err, &ref) && ref.Code == code) {
				if out = append(out, h); len(out) == n {
					break
				}
			}
		}
	}
	return out
}

// refusedPin sends an operator request that must be refused with code,
// and leaves the world's digest as it was.
func refusedPin(t *testing.T, ctx context.Context, r *running, req api.OperatorRequest, code string) {
	t.Helper()
	_, before := digest(t, ctx, r)
	_, ref, err := r.op.Operate(ctx, req)
	if err != nil || ref == nil || ref.Code != code {
		t.Fatalf("%s %s: %+v %v, want %s", req.InteractionID, req.Kind, ref, err, code)
	}
	if _, after := digest(t, ctx, r); after != before {
		t.Fatalf("a %s refusal moved the digest from %s to %s", code, before, after)
	}
}

func hasFact(facts []api.Fact, kind string) bool {
	return slices.ContainsFunc(facts, func(f api.Fact) bool { return f.Kind == kind })
}

// inspectPins are the pins op inspect tile lists for a tile.
func inspectPins(t *testing.T, ctx context.Context, r *running, h hex.Hex) ([]api.Pin, map[string]json.RawMessage) {
	t.Helper()
	raw, err := r.op.Tile(ctx, h.Q, h.R)
	if err != nil {
		t.Fatal(err)
	}
	var out struct {
		Pins  []api.Pin `json:"pins"`
		State struct {
			Content map[string]json.RawMessage `json:"content"`
		} `json:"state"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	if out.Pins == nil {
		t.Fatalf("op inspect tile %s carries no pins list: %s", h.Ref(), raw)
	}
	return out.Pins, out.State.Content
}

// TestOperatorPins stages pins through the operator path, as a designer
// and as a server's admin: each is stored under no character, a resend
// is a duplicate, the pins list and op inspect tile show them, every
// refusal leaves the world as it was, and the world replays. An admin's
// pin, once reached, says who placed it on the tile a player reads.
func TestOperatorPins(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "new", DiscordID: "u-p", Kind: api.ActCreate, Option: api.StartKnife,
		Server: pinServer, Note: "Tinkers", Admin: true})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id := rep.Character.ID
	advance(t, ctx, r, 1)

	release := r.srv.Hold()
	g := r.srv.Game()
	c := g.Char(id)
	home := c.C.At
	gd := g.GuildOf(c.C.Guild)
	if gd == nil {
		release()
		t.Fatal("the admin's character is in no guild")
	}
	i := slices.IndexFunc(g.Places, func(p *game.Place) bool { return p.Guild == gd.G.ID })
	if i < 0 {
		release()
		t.Fatal("the admin's guild runs no settlement")
	}
	region := g.Rules().Gen.RegionOf(g.Places[i].Hex)
	admin := simworld.PinBy{Role: simworld.PinAdmin, Server: pinServer, Char: id, Label: pinLabel, Region: &region}
	lead := func(h hex.Hex) api.PinFix { return leadFix(g, h) }
	served := pinTiles(g, g.Places[i].Hex, 1, pinSearch, 2, admin, "", lead, nil)
	free := pinTiles(g, home, 1, pinSearch, 2, designer, "", lead, func(h hex.Hex) bool { return !slices.Contains(served, h) })
	band := g.Rules().Book.StockBands[0].ID
	stock := func(hex.Hex) api.PinFix { return api.PinFix{Stock: band} }
	ground := pinTiles(g, home, 1, pinSearch, 1, designer, simworld.CodePinGround, stock, nil)
	walk := sheets.IntParam(g.Rules().Book.MapParams, "pin-path-tiles")
	path := pinTiles(g, home, walk+1, walk+pinPathSearch, 1, designer, simworld.CodePinPath, stock, nil)
	reachMax := sheets.Lookup(g.Rules().Book.PinLimits)[simworld.PinDesigner].ReachMax
	release()
	if len(served) < 2 || len(free) < 2 || len(ground) < 1 || len(path) < 1 {
		t.Fatalf("tiles to pin: served %v, free %v, ground %v, path %v", served, free, ground, path)
	}

	req := api.OperatorRequest{InteractionID: "op-pin-1", CharacterID: id, Kind: api.OpPinReserve,
		Pin: &api.PinOrder{At: *apiAt(free[0]), Reach: 3, Fix: leadFix(g, free[0])}}
	out := op(t, r, req)
	if out.Character.ID != "" || !hasFact(out.Facts, "pin.reserved") {
		t.Fatalf("pin-reserve replied %+v", out)
	}
	if again := op(t, r, req); !again.Duplicate {
		t.Fatal("a resent pin-reserve was applied twice")
	}
	var stored string
	if err := r.pool.QueryRow(ctx, "SELECT character_id FROM mmo.action WHERE interaction_id = $1", req.InteractionID).Scan(&stored); err != nil || stored != "" {
		t.Fatalf("pin-reserve stored under %q: %v", stored, err)
	}
	pins, err := r.op.Pins(ctx)
	if err != nil || len(pins.Pins) != 1 {
		t.Fatal(pins, err)
	}
	first := pins.Pins[0]
	if first.ID == "" || first.At != *apiAt(free[0]) || first.Reach != 3 || first.Fix != leadFix(g, free[0]) || first.As != simworld.PinDesigner ||
		first.Landed != 0 || first.Edit {
		t.Fatalf("the pins list: %+v", first)
	}
	if _, err := r.cli.Pins(ctx); err == nil {
		t.Fatal("the pins list is open without the operator token")
	}
	if in, _ := inspectPins(t, ctx, r, free[0]); len(in) != 1 || in[0].ID != first.ID {
		t.Fatalf("op inspect tile on the pinned tile: %+v", in)
	}
	far := hex.Hex{Q: free[0].Q + 3*reachMax, R: free[0].R}
	if in, _ := inspectPins(t, ctx, r, far); len(in) != 0 {
		t.Fatalf("op inspect tile far from every pin: %+v", in)
	}

	n := 0
	pinReq := func(kind string, p *api.PinOrder) api.OperatorRequest {
		n++
		return api.OperatorRequest{InteractionID: fmt.Sprintf("op-pin-x%d", n), Kind: kind, Pin: p}
	}
	lf := leadFix(g, free[1])
	for _, tc := range []struct {
		req  api.OperatorRequest
		code string
	}{
		{pinReq(api.OpPinReserve, nil), api.CodeBadArgs},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(free[1]), Fix: lf}), api.CodePinReach},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(free[1]), Reach: reachMax + 1, Fix: lf}), api.CodePinReach},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(home), Reach: 1, Fix: api.PinFix{Stock: band}}), api.CodePinSeen},
		{pinReq(api.OpPinEdit, &api.PinOrder{At: *apiAt(free[1]), Fix: lf}), api.CodePinUnseen},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(free[1]), Reach: 1}), api.CodePinFix},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(free[1]), Reach: 1, Fix: api.PinFix{SiteKind: "no-such-kind"}}), api.CodePinFix},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(ground[0]), Reach: 1, Fix: api.PinFix{Stock: band}}), api.CodePinGround},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(path[0]), Reach: 1, Fix: api.PinFix{Stock: band}}), api.CodePinPath},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(free[0]), Reach: 1, Fix: api.PinFix{Stock: band}}), api.CodePinTaken},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(free[1]), Reach: 1, Fix: lf, As: "mayor"}), api.CodePinAnchor},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(free[1]), Reach: 1, Fix: lf, Label: pinLabel}), api.CodePinAnchor},
		{pinReq(api.OpPinReserve, &api.PinOrder{At: *apiAt(free[1]), Reach: 1, Fix: lf, As: simworld.PinAdmin, For: "c-404", Label: pinLabel}), api.CodePinAnchor},
		{pinReq(api.OpPinWithdraw, &api.PinOrder{Pin: "pin-404"}), api.CodePinGone},
		{pinReq(api.OpContentFreeze, nil), api.CodeAlreadyFrozen},
	} {
		refusedPin(t, ctx, r, tc.req, tc.code)
	}

	byAdmin := func(h hex.Hex) *api.PinOrder {
		return &api.PinOrder{At: *apiAt(h), Reach: 2, Fix: leadFix(g, h), As: simworld.PinAdmin, For: id, Label: pinLabel}
	}
	if out := op(t, r, pinReq(api.OpPinReserve, byAdmin(served[0]))); out.Character.ID != "" || !hasFact(out.Facts, "pin.reserved") {
		t.Fatalf("an admin's pin-reserve replied %+v", out)
	}
	refusedPin(t, ctx, r, pinReq(api.OpPinReserve, byAdmin(served[1])), api.CodePinBudget)
	if out := op(t, r, pinReq(api.OpPinWithdraw, &api.PinOrder{Pin: first.ID})); !hasFact(out.Facts, "pin.withdrawn") {
		t.Fatalf("pin-withdraw replied %+v", out)
	}
	refusedPin(t, ctx, r, pinReq(api.OpPinWithdraw, &api.PinOrder{Pin: first.ID}), api.CodePinGone)
	pins, err = r.op.Pins(ctx)
	if err != nil || len(pins.Pins) != 1 {
		t.Fatal(pins, err)
	}
	if p := pins.Pins[0]; p.As != simworld.PinAdmin || p.Server != pinServer || p.Label != pinLabel || p.At != *apiAt(served[0]) {
		t.Fatalf("the admin's pin listed as %+v", p)
	}
	adminPin := pins.Pins[0].ID
	if h := houseOf(t, r, pinServer, id, true, false); len(h.Pins) != 1 || h.Pins[0].ID != adminPin {
		t.Fatalf("the admin's house lists pins %+v", h.Pins)
	}
	if h := houseOf(t, r, pinServer, id, false, false); len(h.Pins) != 0 {
		t.Fatalf("a player's house lists pins %+v", h.Pins)
	}

	advance(t, ctx, r, 3)
	tick, live := digest(t, ctx, r)
	replays(t, ctx, r, tick, live)

	// From here the scene is set by hand, past what the replay checked.
	release = r.srv.Hold()
	err = g.Teleport(g.Char(id), served[0])
	release()
	if err != nil {
		t.Fatal(err)
	}
	advance(t, ctx, r, tick+1)
	var place api.Place
	if ref, err := r.cli.Do(ctx, http.MethodGet, fmt.Sprintf("%s?q=%d&r=%d", api.PathPlace, served[0].Q, served[0].R), nil, &place); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	if p := place.Tile.Placed; p == nil || *p != (api.Placed{By: tile.PlacedAdmins, Label: pinLabel}) {
		t.Fatalf("the admin's landed pin reads on its tile as %+v", p)
	}
	if _, content := inspectPins(t, ctx, r, served[0]); string(content["pin"]) != `"`+adminPin+`"` {
		t.Fatalf("op inspect tile shows the landed tile's content as %v", content)
	}
	edit := op(t, r, pinReq(api.OpPinEdit, &api.PinOrder{At: *apiAt(served[0]), Fix: api.PinFix{Stock: band}}))
	if !hasFact(edit.Facts, "pin.edited") {
		t.Fatalf("pin-edit replied %+v", edit)
	}

	release = r.srv.Hold()
	entrance, floors, ok := enteredDungeon(g, home)
	release()
	if !ok {
		t.Fatal("no dungeon near the first settlement a designer may edit")
	}
	refusedPin(t, ctx, r, pinReq(api.OpPinEdit, &api.PinOrder{At: *apiAt(entrance), Fix: api.PinFix{Floors: floors}}), api.CodePinEntered)
}

// enteredDungeon is a dungeon entrance near from that a designer could
// edit, reached and with its first floor drawn, and its plan's floors.
func enteredDungeon(g *game.Game, from hex.Hex) (hex.Hex, int64, bool) {
	for r := int64(1); r <= pinSearch; r++ {
		for _, h := range hex.Ring(from, r) {
			if _, ok := g.Rules().Gen.Dungeon(h); !ok {
				continue
			}
			if err := g.World.Reach(g.Log, h, g.Tick()+1); err != nil {
				return hex.Hex{}, 0, false
			}
			plan, ok := g.Plan(h)
			if !ok || g.World.CheckPin(h, 1, tile.Fix{Floors: plan.Floors}, designer, true) != nil {
				continue
			}
			g.ReachFloor(h, 1, -1)
			return h, plan.Floors, true
		}
	}
	return hex.Hex{}, 0, false
}

// renumbered is a read's JSON with every numeric id renumbered by its
// first appearance, so twins whose fact logs differ by a fact nobody reads
// compare equal.
func renumbered(body []byte) string {
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return string(body)
	}
	seen := map[json.Number]int{}
	var walk func(any)
	walk = func(x any) {
		switch x := x.(type) {
		case map[string]any:
			keys := make([]string, 0, len(x))
			for k := range x {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			for _, k := range keys {
				if n, ok := x[k].(json.Number); ok && k == "id" {
					if _, ok := seen[n]; !ok {
						seen[n] = len(seen) + 1
					}
					x[k] = seen[n]
					continue
				}
				walk(x[k])
			}
		case []any:
			for _, e := range x {
				walk(e)
			}
		}
	}
	walk(v)
	out, _ := json.Marshal(v)
	return string(out)
}

// getRaw is a GET's status and body.
func getRaw(t *testing.T, r *running, path string) (int, []byte) {
	t.Helper()
	resp, err := http.Get(r.http.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, body
}

// playerReads are every read a player's client makes, as status and
// renumbered body by path, and the character's Activity frame.
func playerReads(t *testing.T, r *running, id, discord string, at, pin hex.Hex) map[string]string {
	t.Helper()
	ch := "characterId=" + id
	q := func(h hex.Hex) string { return fmt.Sprintf("q=%d&r=%d", h.Q, h.R) }
	paths := []string{
		api.PathOptions + "?" + ch, api.PathTiles + "?" + q(at) + "&radius=8", api.PathCharacter + "?id=" + id,
		api.PathPlace + "?" + q(at), api.PathPlace + "?" + q(at) + "&" + ch, api.PathPlace + "?" + q(pin), api.PathSheet + "?" + ch, api.PathHere + "?" + ch,
		api.PathRecipes + "?" + ch, api.PathRecap + "?" + ch, api.PathMap + "?" + ch + "&radius=8", api.PathLexicon,
		api.PathPlayer + "?discordId=" + discord, api.PathMarket + "?" + ch, api.PathForum + "?" + ch,
		api.PathRisk + "?" + ch + "&" + q(pin), api.PathGoals + "?" + ch, api.PathBoard + "?" + ch, api.PathGuild + "?" + ch,
		api.PathClasses + "?" + ch, api.PathParty + "?" + ch, api.PathParties, api.PathHunts,
	}
	var market api.Market
	if ref, err := r.cli.Do(context.Background(), http.MethodGet, api.PathMarket+"?"+ch, nil, &market); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	paths = append(paths, api.PathHistory+"?"+ch+"&material="+market.Material)
	out := map[string]string{}
	for _, p := range paths {
		status, body := getRaw(t, r, p)
		out[p] = fmt.Sprintf("%d %s", status, renumbered(body))
	}
	release := r.srv.Hold()
	g := r.srv.Game()
	frame, err := json.Marshal(service.Filter(g, g.Char(id), api.Viewer{}, 0, pinClock))
	release()
	if err != nil {
		t.Fatal(err)
	}
	out["activity"] = renumbered(frame)
	return out
}

// pinClock is the twins' wall clock, the same for both.
var pinClock = time.UnixMilli(1_700_000_000_000)

func sameReads(t *testing.T, when string, a, b map[string]string) {
	t.Helper()
	for p, ra := range a {
		if rb := b[p]; ra != rb {
			t.Errorf("%s, %s reads otherwise with the pin:\n%s\n%s", when, p, ra, rb)
		}
	}
}

// TestPinUnseen runs twin worlds, one with a designer's reserve five
// tiles from a character. Until the tile is reached, every player read
// and the Activity frame are byte for byte the same in both, fact ids
// aside. Once it and the tiles round it are reached, content differs on
// the pinned tile and within its reach only, and the tile holds the fix.
func TestPinUnseen(t *testing.T) {
	ctx := context.Background()
	fixed := func(c *service.Config) { c.Now = func() time.Time { return pinClock } }
	twins := []*running{startOn(t, pgtest.Pool(t), io.Discard, fixed), startOn(t, pgtest.Pool(t), io.Discard, fixed)}
	plain, pinned := twins[0], twins[1]
	const discord = "u-1"
	var id string
	for _, r := range twins {
		rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "new", DiscordID: discord, Kind: api.ActCreate, Option: api.StartKnife})
		if err != nil || ref != nil {
			t.Fatal(ref, err)
		}
		id = rep.Character.ID
		advance(t, ctx, r, 1)
	}

	release := pinned.srv.Hold()
	g := pinned.srv.Game()
	at := g.Char(id).C.At
	const reach = 1
	clear := func(h hex.Hex) bool {
		return !slices.ContainsFunc(hex.DiscAt(h, reach), func(n hex.Hex) bool { return g.World.Content(n) != nil })
	}
	kind := func(h hex.Hex) api.PinFix {
		slot := g.Rules().Gen.Baseline(h).Site
		for _, k := range g.Rules().Book.SiteKinds {
			if slot != "" && slices.Contains(k.Places, slot) {
				return api.PinFix{SiteKind: k.ID}
			}
		}
		return api.PinFix{}
	}
	var fix api.PinFix
	spot := pinTiles(g, at, 5, 5, 1, designer, "", kind, clear)
	if len(spot) == 1 {
		fix = kind(spot[0])
	} else if spot = pinTiles(g, at, 5, 5, 1, designer, "", func(h hex.Hex) api.PinFix { return leadFix(g, h) }, clear); len(spot) == 1 {
		fix = leadFix(g, spot[0])
	}
	release()
	if len(spot) != 1 {
		t.Fatal("no tile five from the character a designer may pin")
	}
	h := spot[0]

	before := playerReads(t, plain, id, discord, at, h)
	sameReads(t, "before the pin", before, playerReads(t, pinned, id, discord, at, h))
	rep := op(t, pinned, api.OperatorRequest{InteractionID: "op-pin", Kind: api.OpPinReserve, Pin: &api.PinOrder{At: *apiAt(h), Reach: reach, Fix: fix}})
	if !hasFact(rep.Facts, "pin.reserved") {
		t.Fatalf("pin-reserve replied %+v", rep)
	}
	for tick := int64(1); tick <= 4; tick++ {
		if tick > 1 {
			for _, r := range twins {
				advance(t, ctx, r, tick)
			}
		}
		sameReads(t, fmt.Sprintf("at tick %d", tick), playerReads(t, plain, id, discord, at, h), playerReads(t, pinned, id, discord, at, h))
	}
	if t.Failed() {
		return
	}

	contents := make([]map[hex.Hex]string, len(twins))
	for i, r := range twins {
		release := r.srv.Hold()
		g := r.srv.Game()
		err := g.Teleport(g.Char(id), h)
		release()
		if err != nil {
			t.Fatal(err)
		}
		advance(t, ctx, r, 5)
		release = r.srv.Hold()
		for _, n := range hex.DiscAt(h, reach+2) {
			if err := g.World.Reach(g.Log, n, g.Tick()+1); err != nil {
				release()
				t.Fatal(err)
			}
		}
		contents[i] = map[hex.Hex]string{}
		for _, tl := range g.World.Tiles {
			if tl.Content != nil {
				b, err := json.Marshal(tl.Content)
				if err != nil {
					release()
					t.Fatal(err)
				}
				contents[i][tl.Hex] = string(b)
			}
		}
		release()
	}
	for _, at := range hex.DiscAt(h, pinSearch) {
		a, b := contents[0][at], contents[1][at]
		switch in := hex.Distance(at, h) <= reach; {
		case !in && a != b:
			t.Errorf("%s, %d from the pin, holds other content:\n%s\n%s", at.Ref(), hex.Distance(at, h), a, b)
		case in && (a == "" || a == b):
			t.Errorf("%s, in the pin's reach, holds the same content as without it: %s", at.Ref(), b)
		}
	}
	var got tile.Content
	if err := json.Unmarshal([]byte(contents[1][h]), &got); err != nil {
		t.Fatal(err)
	}
	if got.Pin == "" || (fix.SiteKind != "" && got.SiteKind != fix.SiteKind) || (fix.Lead != "" && got.Lead != fix.Lead) {
		t.Fatalf("the pinned tile does not hold its fix %+v: %+v", fix, got)
	}
	if fix.SiteKind != "" {
		var place api.Place
		if ref, err := pinned.cli.Do(ctx, http.MethodGet, fmt.Sprintf("%s?q=%d&r=%d", api.PathPlace, h.Q, h.R), nil, &place); err != nil || ref != nil {
			t.Fatal(ref, err)
		}
		if place.Tile.SiteKind != fix.SiteKind || place.Tile.Placed != nil {
			t.Fatalf("the reached pinned tile reads %+v", place.Tile)
		}
	}
}

// v0 makes a just-founded game one from before content was drawn from
// history: nothing stored on any tile, nothing indexed.
func v0(g *game.Game) {
	g.World.ContentVersion = simworld.ContentNative
	g.World.History = nil
	for _, tl := range g.World.Tiles {
		tl.Content = nil
	}
}

// toDungeon is a walk over passable ground from from to the nearest
// dungeon entrance; nil if none is a short walk away.
func toDungeon(g *game.Game, from hex.Hex) []hex.Hex {
	gn := g.Rules().Gen
	walk := func(_, n hex.Hex) (int64, bool) { return 1, gn.Passable(gn.Baseline(n).Terrain) }
	for r := int64(1); r <= pinSearch; r++ {
		for _, h := range hex.Ring(from, r) {
			if _, ok := gn.Dungeon(h); !ok {
				continue
			}
			if route, _, ok := hex.Path(from, h, walk, 1, 0); ok && int64(len(route)) <= 2*r {
				return route
			}
		}
	}
	return nil
}

// frozenRead is what a discovered tile reads that the freeze must keep.
type frozenRead struct {
	At        hex.Hex          `json:"at"`
	Site      string           `json:"site"`
	Creatures []string         `json:"creatures"`
	Plan      any              `json:"plan,omitempty"`
	Floors    []any            `json:"floors,omitempty"`
	Stock     map[string]int64 `json:"stock"`
}

func frozenReads(t *testing.T, g *game.Game) string {
	t.Helper()
	var out []frozenRead
	for _, tl := range g.World.Tiles {
		if tl.Discovered == nil {
			continue
		}
		h := tl.Hex
		r := frozenRead{At: h, Site: g.SiteAt(h), Creatures: g.Creatures(h), Stock: map[string]int64{}}
		for _, m := range g.Materials(h) {
			r.Stock[m] = g.StockLeft(h, m)
		}
		if p, ok := g.Plan(h); ok {
			r.Plan = p
			for n := int64(1); n <= p.Floors; n++ {
				for way := int64(-1); way <= 2; way++ {
					r.Floors = append(r.Floors, g.Floor(h, n, way))
				}
			}
		}
		out = append(out, r)
	}
	slices.SortFunc(out, func(a, b frozenRead) int { return hex.Compare(a.At, b.At) })
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func actionCount(t *testing.T, ctx context.Context, r *running, key string) int {
	t.Helper()
	var n int
	if err := r.pool.QueryRow(ctx, "SELECT count(*) FROM mmo.action WHERE interaction_id = $1 AND character_id = ''", key).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestFreezeAtOpen keeps a world from before content was drawn from
// history, opens it, and expects the service to freeze it once, as a
// recorded command the world replays through: every discovered tile
// holds the seed's content. Opened again, it is not frozen again.
func TestFreezeAtOpen(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	sec, _ := testkit.Secrets(t, "mmo/test-master", world)
	book := testkit.Book(t)
	rules := testkit.Rules(t, book, sec.Keys)
	g, err := game.New(rules)
	if err != nil {
		t.Fatal(err)
	}
	v0(g)
	sheetsDigest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	m := store.Meta{ID: world, KeyVersion: sec.KeyVersion, KeyCheck: sec.Keys.Check(), RulesEpoch: sec.Epoch, SheetsDigest: sheetsDigest,
		StartedAt: now, TickSeconds: 600}
	st := store.New(pool, world)
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	if err := st.Create(ctx, m, g); err != nil {
		t.Fatal(err)
	}
	walker := testkit.Act(t, ctx, st, g, game.Command{Key: "i-1", Kind: game.Create}, "discord-1").Char
	testkit.Ticks(t, ctx, st, g, 1)
	path := toDungeon(g, walker.C.At)
	if path == nil {
		t.Fatal("no dungeon entrance a short walk from the first settlement")
	}
	for i, start := 0, g.Tick(); walker.C.At != path[len(path)-1]; {
		if g.Tick()-start > sheets.TicksPerDay {
			t.Fatal("the walker never reached the dungeon")
		}
		if walker.Long == nil && walker.Fight == nil {
			i++
			next := path[slices.Index(path, walker.C.At)+1]
			testkit.Act(t, ctx, st, g, game.Command{Key: fmt.Sprintf("step-%d", i), Kind: game.Step, Char: walker.C.ID, Dir: walker.C.At.DirectionTo(next)}, "")
		}
		testkit.Ticks(t, ctx, st, g, 1)
	}
	testkit.Ticks(t, ctx, st, g, 1)
	recorded := frozenReads(t, g)
	if g.World.Drawn() || slices.ContainsFunc(g.World.Tiles, func(tl *tile.State) bool { return tl.Content != nil }) {
		t.Fatal("the world from before content was drawn stored content")
	}
	saved := g.Tick()

	kept := func(c *service.Config) { c.Disposable = false }
	var logs bytes.Buffer
	r := startOn(t, pool, &logs, kept)
	if !strings.Contains(logs.String(), "CONTENT FROZEN") {
		t.Fatalf("no freeze in the open's log:\n%s", logs.String())
	}
	if n := actionCount(t, ctx, r, "content-freeze"); n != 1 {
		t.Fatalf("%d freezes recorded", n)
	}
	release := r.srv.Hold()
	live := r.srv.Game()
	reads := frozenReads(t, live)
	drawn, discovered := live.World.Drawn(), 0
	var bad []string
	for _, tl := range live.World.Tiles {
		if tl.Discovered == nil {
			continue
		}
		discovered++
		n := live.Rules().Gen.Native(tl.Hex)
		if c := tl.Content; c == nil || !c.Native || c.Lead != n.Lead || c.SiteKind != "" || (c.Dungeon == nil) != (n.Dungeon == nil) {
			bad = append(bad, tl.Hex.Ref())
		}
	}
	release()
	if !drawn || discovered < len(path) || len(bad) > 0 {
		t.Fatalf("frozen: drawing %v, %d discovered tiles, not native: %v", drawn, discovered, bad)
	}
	if reads != recorded {
		t.Fatalf("frozen, the discovered tiles read otherwise:\n%s\nwere\n%s", reads, recorded)
	}
	tick, frozen := digest(t, ctx, r)
	if tick != saved {
		t.Fatalf("the freeze ran a tick: %d after %d", tick, saved)
	}
	advance(t, ctx, r, tick+1)
	tick, ticked := digest(t, ctx, r)
	replays(t, ctx, r, tick, ticked)

	r.halt()
	logs.Reset()
	again := startOn(t, pool, &logs, kept)
	if strings.Contains(logs.String(), "CONTENT FROZEN") {
		t.Fatalf("a frozen world was frozen again:\n%s", logs.String())
	}
	if n := actionCount(t, ctx, again, "content-freeze"); n != 1 {
		t.Fatalf("%d freezes recorded after a second open", n)
	}
	if _, d := digest(t, ctx, again); d != ticked || d == frozen {
		t.Fatalf("reopened at %s, closed at %s", d, ticked)
	}
}

// TestSheetsRestamp keeps a world on sheets that are not the service's:
// it is refused, unless the operator names exactly the sheets it runs on,
// and then it is re-stamped once, loudly, and loads with everything in it.
func TestSheetsRestamp(t *testing.T) {
	ctx := context.Background()
	t.Setenv(service.EnvSheetsFrom, "")
	kept := func(c *service.Config) { c.Disposable = false }
	r := startOn(t, pgtest.Pool(t), io.Discard, kept)
	rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "new", DiscordID: "u-r", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	advance(t, ctx, r, 2)
	_, live := digest(t, ctx, r)
	r.halt()
	const older = "sheets-before"
	if _, err := r.pool.Exec(ctx, "UPDATE mmo.world SET sheets_digest = $1 WHERE id = $2", older, world); err != nil {
		t.Fatal(err)
	}
	for _, from := range []string{"", "sheets-other"} {
		cfg := r.cfg
		cfg.SheetsFrom = from
		if srv, err := service.Open(ctx, r.pool, cfg); !errors.Is(err, store.ErrOtherSheets) {
			if srv != nil {
				srv.Close(ctx)
			}
			t.Fatalf("a kept world on other sheets opened with %q named: %v", from, err)
		}
	}

	t.Setenv(service.EnvSheetsFrom, older)
	var logs bytes.Buffer
	back := startOn(t, r.pool, &logs, kept)
	if !strings.Contains(logs.String(), "SHEETS RESTAMPED") {
		t.Fatalf("no re-stamp in the open's log:\n%s", logs.String())
	}
	want, err := r.book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	var stamped string
	if err := r.pool.QueryRow(ctx, "SELECT sheets_digest FROM mmo.world WHERE id = $1", world).Scan(&stamped); err != nil || stamped != want {
		t.Fatalf("the world runs on %q after the re-stamp, want %q: %v", stamped, want, err)
	}
	if _, d := digest(t, ctx, back); d != live {
		t.Fatalf("re-stamped, the world loads at %s, closed at %s", d, live)
	}
	if _, err := back.cli.Options(ctx, rep.Character.ID); err != nil {
		t.Fatalf("the character did not survive the re-stamp: %v", err)
	}
	back.halt()
	logs.Reset()
	startOn(t, r.pool, &logs, kept)
	if strings.Contains(logs.String(), "SHEETS RESTAMPED") {
		t.Fatalf("a world on these sheets was re-stamped again:\n%s", logs.String())
	}
}

// TestPinFactsUnread: a landing writes pin.landed, but the region's
// recent facts a player reads never list it.
func TestPinFactsUnread(t *testing.T) {
	ctx := context.Background()
	r := startOn(t, pgtest.Pool(t), io.Discard, nil)
	rep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "new", DiscordID: "u-1", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id := rep.Character.ID
	advance(t, ctx, r, 1)

	release := r.srv.Hold()
	g := r.srv.Game()
	at := g.Char(id).C.At
	const reach = 1
	clear := func(h hex.Hex) bool {
		return !slices.ContainsFunc(hex.DiscAt(h, reach+1), func(n hex.Hex) bool { return g.World.Content(n) != nil })
	}
	lead := func(h hex.Hex) api.PinFix { return leadFix(g, h) }
	spot := pinTiles(g, at, 5, 8, 1, designer, "", lead, clear)
	release()
	if len(spot) != 1 {
		t.Fatal("no tile a designer may pin near the character")
	}
	h := spot[0]
	op(t, r, api.OperatorRequest{InteractionID: "op-pin", Kind: api.OpPinReserve, Pin: &api.PinOrder{At: *apiAt(h), Reach: reach, Fix: lead(h)}})

	release = r.srv.Hold()
	g = r.srv.Game()
	err = g.Teleport(g.Char(id), h)
	release()
	if err != nil {
		t.Fatal(err)
	}
	advance(t, ctx, r, 2)
	pins, _ := inspectPins(t, ctx, r, h)
	if len(pins) == 0 || pins[0].Landed == 0 {
		t.Fatalf("the pin did not land: %+v", pins)
	}
	var here api.Here
	if ref, err := r.cli.Do(ctx, http.MethodGet, api.PathHere+"?characterId="+id, nil, &here); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	for _, f := range here.Recent {
		if strings.HasPrefix(f.Kind, "pin.") {
			t.Errorf("here lists a pin fact: %+v", f)
		}
	}
}

func TestPlayerFacts(t *testing.T) {
	own := []api.Ref{{Kind: "character", ID: "c-1"}}
	in := []api.Fact{{Kind: "a"}, {Kind: "pin.landed"}, {Kind: "b"}, {Kind: "thread.cast", Subjects: own}, {Kind: "thread.ended", Subjects: own},
		{Kind: "arc.ended"}, {Kind: "threads.c"}}
	g, err := game.New(testkit.Rules(t, testkit.Book(t), keys.Throwaway("player-facts")))
	if err != nil {
		t.Fatal(err)
	}
	out := service.PlayerFacts(g, "c-1", in)
	if len(out) != 4 || out[0].Kind != "a" || out[1].Kind != "b" || out[2].Kind != "arc.ended" || out[3].Kind != "threads.c" {
		t.Errorf("got %+v", out)
	}
	if out := service.PlayerFacts(g, "c-1", nil); out == nil || len(out) != 0 {
		t.Errorf("nil input gave %#v", out)
	}
	first, mine := api.Ref{Kind: "character", ID: "c-2"}, api.Ref{Kind: "character", ID: "c-1"}
	promo := api.Ref{Kind: "promotion", ID: "style:1"}
	got := service.ScrubFirsts("c-1", []api.Fact{{Kind: "promotion", Subjects: []api.Ref{promo, first}, Data: []api.Datum{{Key: "by", S: "c-2"}, {Key: "name", S: "x"}}},
		{Kind: "promotion.renamed", Subjects: []api.Ref{promo, mine}}, {Kind: "party.joined", Subjects: []api.Ref{first, mine}}})
	if len(got[0].Subjects) != 1 || len(got[0].Data) != 1 || len(got[1].Subjects) != 2 || len(got[2].Subjects) != 2 {
		t.Errorf("promotion firsts scrubbed to %+v", got)
	}
	looted := func() []api.Fact {
		return []api.Fact{{Kind: "material.looted-first", Subjects: []api.Ref{{Kind: "material", ID: "m-1"}, first}}}
	}
	if got := service.ScrubFirsts("c-1", looted()); len(got[0].Subjects) != 1 || got[0].Subjects[0].Kind != "material" {
		t.Errorf("material first shown to another: %+v", got)
	}
	if got := service.ScrubFirsts("c-2", looted()); len(got[0].Subjects) != 2 {
		t.Errorf("material first hidden from itself: %+v", got)
	}
}
