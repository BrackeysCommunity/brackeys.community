package service_test

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"slices"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// seenAt is one stored last-seen record's place: its holder and tile.
type seenAt struct {
	h mapview.Holder
	x hex.Hex
}

// sightWatch follows a world's view pass from outside it: the keys it last
// saw and the records stored then, so each check can tell what one step
// of play wrote.
type sightWatch struct {
	t    *testing.T
	r    *running
	keys map[mapview.Holder]mapview.Key
	rows map[seenAt]int64
}

func watchSight(t *testing.T, r *running) *sightWatch {
	t.Helper()
	w := &sightWatch{t: t, r: r}
	unlock := r.srv.Hold()
	w.keys = r.srv.MapKeys()
	unlock()
	w.rows = w.stored()
	return w
}

// stored are every record the world keeps, by holder and tile, with the
// tick each left sight; each must read as a seen MapLive of its own tile.
func (w *sightWatch) stored() map[seenAt]int64 {
	w.t.Helper()
	rows, err := w.r.pool.Query(context.Background(),
		"SELECT holder_kind, holder_id, q, r, chunk_a, chunk_b, left_tick, live FROM mmo.map_seen WHERE world_id = $1", world)
	if err != nil {
		w.t.Fatal(err)
	}
	defer rows.Close()
	out := map[seenAt]int64{}
	for rows.Next() {
		var at seenAt
		var a, b, left int64
		var raw []byte
		if err := rows.Scan(&at.h.Kind, &at.h.ID, &at.x.Q, &at.x.R, &a, &b, &left, &raw); err != nil {
			w.t.Fatal(err)
		}
		var live api.MapLive
		if err := json.Unmarshal(raw, &live); err != nil {
			w.t.Fatal(err)
		}
		if live.Fog != api.FogSeen || live.Left != left || live.Q != at.x.Q || live.R != at.x.R {
			w.t.Fatalf("record %+v at tick %d holds %+v", at, left, live)
		}
		if cc := w.chunkOf(at.x); cc != (gen.ChunkCoord{A: a, B: b}) {
			w.t.Fatalf("record %+v is filed under chunk %d.%d, not %d.%d", at, a, b, cc.A, cc.B)
		}
		out[at] = left
	}
	if err := rows.Err(); err != nil {
		w.t.Fatal(err)
	}
	return out
}

func (w *sightWatch) chunkOf(h hex.Hex) gen.ChunkCoord {
	unlock := w.r.srv.Hold()
	defer unlock()
	return w.r.srv.Game().World.Gen().ChunkOf(h)
}

// storedKeys are the keys map_sight holds.
func (w *sightWatch) storedKeys() map[mapview.Holder]mapview.Key {
	w.t.Helper()
	rows, err := store.New(w.r.pool, world).Sights(context.Background())
	if err != nil {
		w.t.Fatal(err)
	}
	out := map[mapview.Holder]mapview.Key{}
	for _, r := range rows {
		k, err := service.DecodeSightKey(r.Key)
		if err != nil {
			w.t.Fatal(err)
		}
		out[mapview.Holder{Kind: r.Kind, ID: r.ID}] = k
	}
	return out
}

// pass is what the world wrote since the last check: the holders whose key
// changed, and the records written. Each changed holder's records must be
// exactly the discovered tiles of its old sight outside its new one, left
// at this tick, and no other holder may have written; the stored keys are
// the keys the world holds.
type pass struct {
	tick    int64
	changed []mapview.Holder
	wrote   int
}

func (w *sightWatch) check(label string) pass {
	w.t.Helper()
	unlock := w.r.srv.Hold()
	g := w.r.srv.Game()
	now := w.r.srv.MapKeys()
	out := pass{tick: g.Tick()}
	want := map[seenAt]bool{}
	for _, h := range slices.SortedFunc(maps.Keys(now), compareHolders) {
		if k, ok := mapview.KeyOf(g, h); !ok || !slices.Equal(k, now[h]) {
			unlock()
			w.t.Fatalf("%s: %+v is kept as %v, while its key is %v (%v)", label, h, now[h], k, ok)
		}
		old, had := w.keys[h]
		if had && slices.Equal(old, now[h]) {
			continue
		}
		out.changed = append(out.changed, h)
		if !had {
			continue
		}
		stay := map[hex.Hex]bool{}
		for _, x := range mapview.Set(g, now[h]) {
			stay[x] = true
		}
		for _, x := range mapview.Set(g, old) {
			if !stay[x] {
				want[seenAt{h, x}] = true
			}
		}
	}
	unlock()
	rows := w.stored()
	got := map[seenAt]bool{}
	for at, left := range rows {
		if prev, ok := w.rows[at]; ok && prev == left {
			continue
		}
		if left != out.tick {
			w.t.Fatalf("%s: record %+v left at %d, written at tick %d", label, at, left, out.tick)
		}
		got[at] = true
	}
	if !maps.Equal(got, want) {
		w.t.Fatalf("%s at tick %d: wrote %d records %v, want the %d leaving tiles %v", label, out.tick, len(got), got, len(want), want)
	}
	if stored := w.storedKeys(); !maps.EqualFunc(stored, now, slices.Equal) {
		w.t.Fatalf("%s: map_sight holds %v, the world %v", label, stored, now)
	}
	out.wrote = len(got)
	w.keys, w.rows = now, rows
	return out
}

func compareHolders(a, b mapview.Holder) int {
	return cmp.Or(cmp.Compare(a.Kind, b.Kind), cmp.Compare(a.ID, b.ID))
}

// guildOf is a character's guild as the world holds it.
func guildOf(r *running, id string) string {
	unlock := r.srv.Hold()
	defer unlock()
	return r.srv.Game().Char(id).C.Guild
}

// mapCreate makes a character for user, of server when it is set.
func mapCreate(t *testing.T, r *running, key, user, server string) api.Character {
	t.Helper()
	rep, ref, err := r.cli.Act(t.Context(), api.ActionRequest{InteractionID: key, DiscordID: user, Kind: api.ActCreate, Server: server})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	return rep.Character
}

// mapAct sends a character's command at its current version.
func mapAct(t *testing.T, r *running, req api.ActionRequest) {
	t.Helper()
	o, err := r.cli.Options(t.Context(), req.CharacterID)
	if err != nil {
		t.Fatal(err)
	}
	req.Version = o.Version
	if _, ref, err := r.cli.Act(t.Context(), req); err != nil || ref != nil {
		t.Fatalf("%s: %+v %v", req.Kind, ref, err)
	}
}

// away is the open move that leads farthest from from: tiles are found
// only as they are entered, so only a walk away leaves found ones behind.
func away(t *testing.T, o api.Options, from hex.Hex) api.Move {
	t.Helper()
	best := -1
	for i, m := range o.Moves {
		if m.Open && (best < 0 || hex.Distance(simHex(m.To), from) > hex.Distance(simHex(o.Moves[best].To), from)) {
			best = i
		}
	}
	if best < 0 {
		t.Fatal("no open move")
	}
	return o.Moves[best]
}

func simHex(h api.Hex) hex.Hex { return hex.Hex{Q: h.Q, R: h.R} }

// mapStep steps a character away from from and runs ticks, checking each,
// until its sight key moves; it returns that check.
func mapStep(t *testing.T, r *running, w *sightWatch, c api.Character, from hex.Hex, key string) pass {
	t.Helper()
	o, err := r.cli.Options(t.Context(), c.ID)
	if err != nil {
		t.Fatal(err)
	}
	move := away(t, o, from)
	mapAct(t, r, api.ActionRequest{InteractionID: key, CharacterID: c.ID, Kind: api.ActStep, Dir: move.Dir})
	me := mapview.Holder{Kind: mapview.HolderCharacter, ID: c.ID}
	for n := int64(0); n <= move.Ticks+1; n++ {
		if n > 0 {
			advance(t, t.Context(), r, o.Tick+n)
		}
		if p := w.check(fmt.Sprintf("%s, tick %d of the step", key, n)); slices.Contains(p.changed, me) {
			return p
		}
	}
	t.Fatalf("%s's step to %+v never moved its sight", c.ID, move.To)
	return pass{}
}

// mapWalk steps a character away from where it stands until a step leaves
// a found tile out of its sight; every step is checked on the way.
func mapWalk(t *testing.T, r *running, w *sightWatch, c api.Character, key string) pass {
	t.Helper()
	from := atOf(r, c.ID)
	for n := range mapWalkSteps {
		if p := mapStep(t, r, w, c, from, fmt.Sprintf("%s-%d", key, n)); p.wrote > 0 {
			return p
		}
	}
	t.Fatalf("%d steps away from %+v left no found tile behind", mapWalkSteps, from)
	return pass{}
}

// structural: a walk outruns any sight within this many steps.
const mapWalkSteps = 12

func atOf(r *running, id string) hex.Hex {
	unlock := r.srv.Hold()
	defer unlock()
	return r.srv.Game().Char(id).C.At
}

// TestMapSeenWritesOnSightChange plays a world day with nobody moving and
// then one step: a tick in which no holder's key moves writes nothing, and
// the step writes exactly the tiles that left the walker's sight.
func TestMapSeenWritesOnSightChange(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	advance(t, ctx, r, 1)
	c := mapCreate(t, r, "map-c1", "u-map-1", "")
	w := watchSight(t, r)
	me := mapview.Holder{Kind: mapview.HolderCharacter, ID: c.ID}
	if _, ok := w.keys[me]; !ok {
		t.Fatalf("a new character is not keyed by its own command: %v", w.keys)
	}
	if n, err := r.srv.MapCount(ctx); err != nil || n != 0 {
		t.Fatalf("keying a new character wrote %d records (%v)", n, err)
	}
	quiet, moved := 0, 0
	for tick := int64(2); tick <= 1+sheets.TicksPerDay; tick++ {
		advance(t, ctx, r, tick)
		p := w.check(fmt.Sprintf("day tick %d", tick))
		if len(p.changed) == 0 {
			quiet++
		} else {
			moved += p.wrote
		}
	}
	if quiet == 0 {
		t.Fatal("no tick of the day left every key alone")
	}
	t.Logf("a day standing still: %d quiet ticks wrote nothing; weather over the tile wrote %d", quiet, moved)
	p := mapWalk(t, r, w, c, "map-walk")
	t.Logf("the step that left found tiles behind wrote %d records at tick %d", p.wrote, p.tick)
}

// TestMapPassAfterCommand writes a command's keys at once, with no tick:
// a server's first player installs a guild that takes a starting
// settlement, and the guild's key is stored; a guild its last member
// leaves is dropped by that command.
func TestMapPassAfterCommand(t *testing.T) {
	ctx := t.Context()
	r := start(t, io.Discard)
	advance(t, ctx, r, 1)
	unlock := r.srv.Hold()
	g := r.srv.Game()
	open := len(g.Places) > 0 && g.Places[0].Guild == ""
	unlock()
	if !open {
		t.Fatal("the world opened no starting settlement for a server to take")
	}
	w := watchSight(t, r)
	a := mapCreate(t, r, "map-c1", "u-map-1", "srv-map")
	p := w.check("a server's first player")
	installed := guildOf(r, a.ID)
	guild := mapview.Holder{Kind: mapview.HolderGuild, ID: installed}
	if p.tick != 1 || installed == "" || !slices.Contains(p.changed, guild) || len(w.keys[guild]) == 0 {
		t.Fatalf("the install at tick %d keyed %v; the guild %q holds %v", p.tick, p.changed, installed, w.keys[guild])
	}

	b := mapCreate(t, r, "map-c2", "u-map-2", "")
	mapAct(t, r, api.ActionRequest{InteractionID: "map-found", CharacterID: b.ID, Kind: api.ActFoundGuild, Note: "Wayfarers"})
	founded := guildOf(r, b.ID)
	w.check("a founded guild")
	own := mapview.Holder{Kind: mapview.HolderGuild, ID: founded}
	if k, ok := w.keys[own]; founded == "" || !ok || len(k) != 0 {
		t.Fatalf("a guild with a member and no place is kept as %v (%v)", k, ok)
	}
	mapAct(t, r, api.ActionRequest{InteractionID: "map-leave", CharacterID: b.ID, Kind: api.ActLeave})
	w.check("its last member leaves")
	if _, ok := w.keys[own]; ok {
		t.Fatalf("the disbanded guild %s is still keyed", founded)
	}
	if _, ok := w.keys[guild]; !ok {
		t.Fatal("the installed guild lost its key when another guild ended")
	}
	if tick := w.check("after").tick; tick != 1 {
		t.Fatalf("the commands ran a tick: at %d", tick)
	}
}

// TestMapPassSurvivesReload opens a world again after a stop that lost
// its last passes, as a crash between a tick's save and its pass would: the
// keys it reads back are the stored ones, so its first pass records what
// left sight since. A pass whose write fails keeps its keys, and the next
// pass writes the same leaving tiles.
func TestMapPassSurvivesReload(t *testing.T) {
	ctx := t.Context()
	pool := pgtest.Pool(t)
	r := startOn(t, pool, io.Discard, nil)
	advance(t, ctx, r, 1)
	c := mapCreate(t, r, "map-c1", "u-map-1", "srv-map")
	me := mapview.Holder{Kind: mapview.HolderCharacter, ID: c.ID}
	w := watchSight(t, r)
	home := w.keys[me]
	mapWalk(t, r, w, c, "map-walk")
	r.halt()

	homeKey, err := service.EncodeSightKey(home)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE mmo.map_sight SET key = $3 WHERE world_id = $1 AND holder_kind = 'character' AND holder_id = $2",
		world, c.ID, homeKey); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "DELETE FROM mmo.map_seen WHERE world_id = $1 AND holder_id = $2", world, c.ID); err != nil {
		t.Fatal(err)
	}
	w.keys = w.storedKeys()
	w.rows = w.stored()
	r = startOn(t, pool, io.Discard, nil)
	w.r = r
	if p := w.check("reopened"); !slices.Contains(p.changed, me) || p.wrote == 0 {
		t.Fatalf("the first pass after the reopen changed %v and wrote %d: the stored keys were not read back", p.changed, p.wrote)
	}

	if _, err := pool.Exec(ctx, "ALTER TABLE mmo.map_sight RENAME TO map_sight_away"); err != nil {
		t.Fatal(err)
	}
	kept := w.keys[me]
	from := atOf(r, c.ID)
	var leaving int
	for n := 0; n < mapWalkSteps && leaving == 0; n++ {
		stepAway(t, r, c, from, fmt.Sprintf("map-away-%d", n))
		unlock := r.srv.Hold()
		g := r.srv.Game()
		held := r.srv.MapKeys()[me]
		now, _ := mapview.KeyOf(g, me)
		stay := map[hex.Hex]bool{}
		for _, x := range mapview.Set(g, now) {
			stay[x] = true
		}
		leaving = 0
		for _, x := range mapview.Set(g, kept) {
			if !stay[x] {
				leaving++
			}
		}
		unlock()
		if !slices.Equal(held, kept) {
			t.Fatalf("a failed pass moved the key from %v to %v", kept, held)
		}
	}
	if leaving == 0 {
		t.Fatal("no step left a found tile behind")
	}
	if n, err := r.srv.MapCount(ctx); err != nil || int(n) != len(w.rows) {
		t.Fatalf("failed passes left %d records, not %d (%v)", n, len(w.rows), err)
	}
	if _, err := pool.Exec(ctx, "ALTER TABLE mmo.map_sight_away RENAME TO map_sight"); err != nil {
		t.Fatal(err)
	}
	advance(t, ctx, r, r.srv.Tick()+1)
	if p := w.check("the pass after the failures"); !slices.Contains(p.changed, me) || p.wrote < leaving {
		t.Fatalf("the retried pass changed %v and wrote %d of the %d tiles left behind", p.changed, p.wrote, leaving)
	}
}

// stepAway steps a character away from from and runs ticks until it
// stands somewhere else.
func stepAway(t *testing.T, r *running, c api.Character, from hex.Hex, key string) {
	t.Helper()
	o, err := r.cli.Options(t.Context(), c.ID)
	if err != nil {
		t.Fatal(err)
	}
	was := atOf(r, c.ID)
	move := away(t, o, from)
	mapAct(t, r, api.ActionRequest{InteractionID: key, CharacterID: c.ID, Kind: api.ActStep, Dir: move.Dir})
	for n := int64(1); atOf(r, c.ID) == was; n++ {
		if n > move.Ticks+1 {
			t.Fatalf("%s never arrived at %+v", c.ID, move.To)
		}
		advance(t, t.Context(), r, o.Tick+n)
	}
}

// TestMapPassLocal runs the same pass in a Local: a new character and its
// guild are keyed by the create, and a walk away from home keeps, in
// memory, exactly the found tiles that left the walker's sight, which the
// map reads back by chunk.
func TestMapPassLocal(t *testing.T) {
	ctx := t.Context()
	g, err := game.New(testkit.Rules(t, testkit.Book(t), keys.Throwaway("map-local")))
	if err != nil {
		t.Fatal(err)
	}
	l := service.NewLocal(g)
	if err := l.Advance(); err != nil {
		t.Fatal(err)
	}
	rep, ref, err := l.Act(ctx, api.ActionRequest{InteractionID: "c1", DiscordID: "u-1", Kind: api.ActCreate, Server: "srv-1"})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	c := g.Char(rep.Character.ID)
	me := mapview.Holder{Kind: mapview.HolderCharacter, ID: c.C.ID}
	ks := l.MapKeys()
	if _, ok := ks[me]; !ok || len(ks[mapview.Holder{Kind: mapview.HolderGuild, ID: c.C.Guild}]) == 0 {
		t.Fatalf("the create keyed %v", ks)
	}
	behind := map[hex.Hex]bool{}
	old := ks[me]
	look := func() {
		now := l.MapKeys()[me]
		if k, _ := mapview.KeyOf(g, me); !slices.Equal(k, now) {
			t.Fatalf("the Local keeps %v, the key is %v", now, k)
		}
		if slices.Equal(now, old) {
			return
		}
		stay := map[hex.Hex]bool{}
		for _, x := range mapview.Set(g, now) {
			stay[x] = true
		}
		for _, x := range mapview.Set(g, old) {
			if !stay[x] {
				behind[x] = true
			}
		}
		old = now
	}
	from := c.C.At
	for n := 0; n < mapWalkSteps && len(behind) == 0; n++ {
		o, err := l.Options(ctx, c.C.ID)
		if err != nil {
			t.Fatal(err)
		}
		move := away(t, o, from)
		was := c.C.At
		if _, ref, err := l.Act(ctx, api.ActionRequest{InteractionID: fmt.Sprintf("s%d", n), CharacterID: c.C.ID, Version: o.Version, Kind: api.ActStep,
			Dir: move.Dir}); err != nil || ref != nil {
			t.Fatal(ref, err)
		}
		look()
		for k := int64(0); c.C.At == was; k++ {
			if k > move.Ticks {
				t.Fatalf("never arrived at %+v", move.To)
			}
			if err := l.Advance(); err != nil {
				t.Fatal(err)
			}
			look()
		}
	}
	if len(behind) == 0 {
		t.Fatal("the walk left no found tile behind")
	}
	want := slices.SortedFunc(maps.Keys(behind), func(a, b hex.Hex) int { return cmp.Or(cmp.Compare(a.R, b.R), cmp.Compare(a.Q, b.Q)) })
	var chunks []gen.ChunkCoord
	for _, x := range want {
		if cc := g.World.Gen().ChunkOf(x); !slices.Contains(chunks, cc) {
			chunks = append(chunks, cc)
		}
	}
	recs, err := l.MapSeen(ctx, c.C.ID, "", chunks)
	if err != nil {
		t.Fatal(err)
	}
	var got []hex.Hex
	for _, rec := range recs {
		if rec.Holder != me || rec.Live.Fog != api.FogSeen || rec.Live.Left != rec.Left || rec.Left > g.Tick() {
			t.Fatalf("a record %+v", rec)
		}
		got = append(got, rec.Hex)
	}
	if !slices.Equal(got, want) {
		t.Fatalf("the map reads %v, want %v", got, want)
	}
	if n, err := l.MapCount(ctx); err != nil || n < int64(len(want)) {
		t.Fatalf("the Local keeps %d records, fewer than the %d left behind (%v)", n, len(want), err)
	}
}
