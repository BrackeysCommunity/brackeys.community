package service_test

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
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/settle"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
	"jams.team/mmo-world/store/pgtest"
)

// storyIDs are fact ids far past any the world writes in a test, for facts
// set straight into the store.
const storyIDs = 1_000_000

// putFact writes a fact into the store as a tick would have.
func putFact(t *testing.T, r *running, f fact.Fact) {
	t.Helper()
	enc := func(v any) []byte {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	if f.Subjects == nil {
		f.Subjects = []fact.Ref{}
	}
	if f.Data == nil {
		f.Data = []fact.Datum{}
	}
	if f.Causes == nil {
		f.Causes = []fact.ID{}
	}
	slices.SortFunc(f.Data, func(a, b fact.Datum) int { return strings.Compare(a.Key, b.Key) })
	var region any
	if f.Region != "" {
		region = f.Region
	}
	if _, err := r.pool.Exec(context.Background(), `INSERT INTO mmo.fact (world_id, id, tick, kind, region, weight, subjects, data, causes, staged_by, at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, now())`, world, int64(f.ID), f.Tick, f.Kind, region, f.Weight,
		enc(f.Subjects), enc(f.Data), enc(f.Causes)); err != nil {
		t.Fatal(err)
	}
}

// read GETs a story path and decodes it, or fails unless the status is
// the one wanted.
func read[T any](t *testing.T, r *running, cli bool, path string, status int) T {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, r.http.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !cli {
		req.Header.Set("Authorization", "Bearer "+opToken)
	}
	resp, err := r.http.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out T
	if resp.StatusCode != status {
		t.Fatalf("%s: HTTP %d, want %d", path, resp.StatusCode, status)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

// founder makes a server's admin, whose guild runs a starting settlement,
// and returns it with that settlement's index.
func founder(t *testing.T, r *running, key, user, server string) (api.Character, int) {
	t.Helper()
	rep, ref, err := r.cli.Act(context.Background(), api.ActionRequest{InteractionID: key, DiscordID: user, Kind: api.ActCreate,
		Option: api.StartHook, Server: server, Note: "Guild " + server, Admin: true})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	release := r.srv.Hold()
	defer release()
	g := r.srv.Game()
	gd := g.ServerGuild(server)
	n := slices.IndexFunc(g.Places, func(p *game.Place) bool { return gd != nil && p.Guild == gd.G.ID })
	if n < 0 {
		t.Fatalf("%s's guild runs no settlement", server)
	}
	return rep.Character, n
}

// TestChronicle: a closed day's chronicle puts the facts touching the
// server's guild places first, then the heaviest, then the newest; it cuts
// at chronicle-lines and counts the rest; it names no character and
// leaves out pins and threads. A fact opens with its causes one level deep.
func TestChronicle(t *testing.T) {
	r := startOn(t, pgtest.Pool(t), io.Discard, nil)
	ctx := context.Background()
	a, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	advance(t, ctx, r, sheets.TicksPerDay+1)
	release := r.srv.Hold()
	at := r.srv.Game().SettlementHex(n)
	lines := sheets.IntParam(r.book.StoryParams, "chronicle-lines")
	least := sheets.IntParam(r.book.StoryParams, "chronicle-min-weight")
	release()
	if lines != 8 {
		t.Fatalf("chronicle-lines is %d; this test is laid out for 8", lines)
	}

	id := fact.ID(storyIDs)
	put := func(kind string, weight int64, subjects []fact.Ref, causes []fact.ID, data ...fact.Datum) fact.ID {
		id++
		putFact(t, r, fact.Fact{ID: id, Tick: 10 + int64(id-storyIDs), Kind: kind, Weight: weight, Subjects: subjects, Data: data, Causes: causes})
		return id
	}
	settlement := arc.SettlementRef(n)
	h90 := put("city.raised", 90, []fact.Ref{settlement}, nil)
	h61 := put("trouble.held", least+1, nil, nil, fact.N("settlement", int64(n)))
	h60 := put("structure.raised", least, nil, nil, fact.At(at)...)
	o100 := put("season.finale", 100, nil, nil)
	o95 := put("guardian.slain", 95, []fact.Ref{char.Ref(a.ID), {Kind: "region", ID: "r-0"}}, nil, fact.S("by", a.ID))
	o80a := put("arc.stage-ended", 80, nil, nil)
	o80b := put("arc.stage-ended", 80, nil, nil)
	o70 := put("arc.ended", 70, nil, nil)
	o65 := put("trouble.started", 65, nil, []fact.ID{o80a, o80b})
	put("arc.cast", least, nil, nil)
	put("pin.landed", 99, []fact.Ref{settlement}, nil)
	thread := put("thread.cast", 99, []fact.Ref{char.Ref(a.ID), settlement}, nil)
	put("structure.damaged", least-1, []fact.Ref{settlement}, nil)
	why := put("arc.cast", 30, nil, []fact.ID{o65, thread, h90})
	if _, err := r.pool.Exec(ctx, "UPDATE mmo.fact SET tick = $1 WHERE world_id = $2 AND id = $3", sheets.TicksPerDay+0, world, int64(why)); err != nil {
		t.Fatal(err)
	}

	want := []fact.ID{h90, h61, h60, o100, o95, o80b, o80a, o70}
	check := func(c api.Chronicle, here bool) {
		t.Helper()
		var got []fact.ID
		for _, l := range c.Lines {
			got = append(got, fact.ID(l.Fact.ID))
			for _, s := range l.Fact.Subjects {
				if s.Kind == "character" {
					t.Errorf("a chronicle line names a character: %+v", l.Fact)
				}
			}
			for _, d := range l.Fact.Data {
				if d.S == a.ID {
					t.Errorf("a chronicle line's data names a character: %+v", l.Fact)
				}
			}
			if strings.HasPrefix(l.Fact.Kind, "pin.") || strings.HasPrefix(l.Fact.Kind, "thread.") || l.Fact.Weight < least {
				t.Errorf("a chronicle line that must not be: %+v", l.Fact)
			}
			if l.Here != (here && slices.Contains(want[:3], fact.ID(l.Fact.ID))) {
				t.Errorf("fact %d here %v", l.Fact.ID, l.Here)
			}
		}
		if here && !slices.Equal(got, want) {
			t.Errorf("the chronicle's lines are %v, want %v", got, want)
		}
		if c.More != 2 || c.Day != 0 || len(c.Earlier) != 0 || c.Season.Days == 0 {
			t.Errorf("the chronicle: day %d, %d more, earlier %v, season %+v", c.Day, c.More, c.Earlier, c.Season)
		}
	}
	check(read[api.Chronicle](t, r, true, api.PathChronicle+"?characterId="+a.ID, 200), true)
	check(read[api.Chronicle](t, r, true, api.PathChronicle+"?server=srv-1&day=0", 200), true)
	other := read[api.Chronicle](t, r, true, api.PathChronicle+"?server=srv-2", 200)
	check(other, false)
	if fact.ID(other.Lines[0].Fact.ID) != o100 {
		t.Errorf("another server's chronicle opens on %d, want the heaviest", other.Lines[0].Fact.ID)
	}
	read[api.Refusal](t, r, true, api.PathChronicle+"?server=srv-1&day=1", 404)
	read[api.Refusal](t, r, true, api.PathChronicle+"?characterId=c-none", 404)

	fc := read[api.FactCauses](t, r, true, fmt.Sprintf("%s?id=%d", api.PathChronicleFact, why), 200)
	var causes []fact.ID
	for _, c := range fc.Causes {
		causes = append(causes, fact.ID(c.ID))
	}
	if fact.ID(fc.Fact.ID) != why || !slices.Equal(causes, []fact.ID{h90, o65}) || len(fc.Fact.Causes) != 3 {
		t.Fatalf("the fact opens to %+v with causes %v", fc.Fact, causes)
	}
	deeper := read[api.FactCauses](t, r, true, fmt.Sprintf("%s?id=%d", api.PathChronicleFact, o65), 200)
	if len(deeper.Causes) != 2 {
		t.Fatalf("a cause does not open the same way: %+v", deeper)
	}
	read[api.Refusal](t, r, true, fmt.Sprintf("%s?id=%d", api.PathChronicleFact, thread), 404)
	if own := read[api.FactCauses](t, r, true, fmt.Sprintf("%s?id=%d&characterId=%s", api.PathChronicleFact, thread, a.ID), 200); fact.ID(own.Fact.ID) != thread {
		t.Fatalf("a thread's fact is not its own character's: %+v", own)
	}
	if o := read[api.FactCauses](t, r, true, fmt.Sprintf("%s?id=%d", api.PathChronicleFact, o95), 200); len(o.Fact.Subjects) != 1 || len(o.Fact.Data) != 0 {
		t.Fatalf("an opened fact names a character to another: %+v", o.Fact)
	}
	read[api.Refusal](t, r, true, api.PathChronicleFact+"?id=999999999", 404)
}

// TestStoryEvents: the events after a fact id, oldest first, only of the
// events' kinds, each with its arc as the game holds it; Last is where to
// ask from next.
func TestStoryEvents(t *testing.T) {
	r := startOn(t, pgtest.Pool(t), io.Discard, nil)
	ctx := context.Background()
	_, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	advance(t, ctx, r, 1)
	cast := overrun(t, r, n, "cast-1")
	var castFact api.Fact
	for _, f := range cast.Facts {
		if f.Kind == "arc.cast" {
			castFact = f
		}
	}
	if castFact.ID == 0 {
		t.Fatalf("the cast wrote no arc.cast: %+v", cast.Facts)
	}
	put := func(id int64, kind string, data ...fact.Datum) {
		putFact(t, r, fact.Fact{ID: fact.ID(id), Tick: 1, Kind: kind, Weight: 60, Data: data})
	}
	put(storyIDs+1, "season.began")
	put(storyIDs+2, "beat.won")
	put(storyIDs+3, "trouble.started", fact.S("arc", "arc-none"), fact.N("settlement", int64(n)))
	put(storyIDs+4, "pattern.solved")

	ev := read[api.StoryEvents](t, r, true, fmt.Sprintf("%s?after=%d", api.PathStoryEvents, castFact.ID-1), 200)
	var kinds []string
	for _, e := range ev.Events {
		kinds = append(kinds, e.Fact.Kind)
	}
	if !slices.Equal(kinds, []string{"arc.cast", "season.began", "trouble.started", "pattern.solved"}) || ev.Last != storyIDs+4 {
		t.Fatalf("events %v, last %d", kinds, ev.Last)
	}
	first := ev.Events[0]
	if first.Arc == nil || first.Arc.Template != "the-overrun" || len(first.Arc.Sides) != 2 || first.Place == "" {
		t.Fatalf("the cast's event carries %+v at %q", first.Arc, first.Place)
	}
	if e := ev.Events[2]; e.Arc != nil || e.Trouble != nil || e.Place == "" {
		t.Fatalf("an event for an arc the story no longer holds: %+v", e)
	}
	ev = read[api.StoryEvents](t, r, true, fmt.Sprintf("%s?after=%d", api.PathStoryEvents, storyIDs+3), 200)
	if len(ev.Events) != 1 || ev.Last != storyIDs+4 {
		t.Fatalf("after the third: %+v", ev)
	}
	ev = read[api.StoryEvents](t, r, true, fmt.Sprintf("%s?after=%d", api.PathStoryEvents, storyIDs+4), 200)
	if len(ev.Events) != 0 || ev.Last != storyIDs+4 {
		t.Fatalf("after the last: %+v", ev)
	}
	read[api.Refusal](t, r, true, api.PathStoryEvents+"?after=x", 400)
}

// overrun casts the overrun by hand on place n's region, seated there.
func overrun(t *testing.T, r *running, n int, key string) api.ActionReply {
	t.Helper()
	release := r.srv.Hold()
	g := r.srv.Game()
	region := g.World.RegionAt(g.SettlementHex(n))
	release()
	return op(t, r, api.OperatorRequest{InteractionID: key, Kind: api.OpArcCast, Arc: &api.ArcOrder{Template: "the-overrun",
		Cast: []api.CastRef{{Role: "front", Kind: "region", ID: fmt.Sprintf("r-%d", region)}, {Role: "seat", Kind: "settlement", ID: fmt.Sprint(n)}}}})
}

// refusedOp sends an operator request and expects the refusal code.
func refusedOp(t *testing.T, r *running, req api.OperatorRequest, code string) {
	t.Helper()
	_, ref, err := r.op.Operate(context.Background(), req)
	if err != nil || ref == nil || ref.Code != code {
		t.Fatalf("%s: %+v %v, want %s", req.Kind, ref, err, code)
	}
}

// TestStoryKinds sends each story kind through the API: backing a side,
// raising a city, setting a pattern's point, and the operator's arc-cast,
// season-start and season-epoch, each accepted and refused with its code.
// The arcs read shows a personal thread to its character alone.
func TestStoryKinds(t *testing.T) {
	r := startOn(t, pgtest.Pool(t), io.Discard, nil)
	ctx := context.Background()
	a, n := founder(t, r, "c-admin", "u-admin", "srv-1")
	bRep, ref, err := r.cli.Act(ctx, api.ActionRequest{InteractionID: "c-b", DiscordID: "u-b", Kind: api.ActCreate, Option: api.StartKnife})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	b := bRep.Character
	advance(t, ctx, r, 1)
	act := func(req api.ActionRequest) (api.ActionReply, *api.Refusal) {
		t.Helper()
		o, err := r.cli.Options(ctx, req.CharacterID)
		if err != nil {
			t.Fatal(err)
		}
		req.Version = o.Version
		rep, ref, err := r.cli.Act(ctx, req)
		if err != nil {
			t.Fatal(err)
		}
		return rep, ref
	}
	refused := func(req api.ActionRequest, code string) {
		t.Helper()
		if _, ref := act(req); ref == nil || ref.Code != code {
			t.Fatalf("%s: %+v, want %s", req.Kind, ref, code)
		}
	}
	accepted := func(req api.ActionRequest) api.ActionReply {
		t.Helper()
		rep, ref := act(req)
		if ref != nil {
			t.Fatalf("%s: %+v", req.Kind, ref)
		}
		return rep
	}

	region := func() string {
		release := r.srv.Hold()
		defer release()
		g := r.srv.Game()
		return fmt.Sprintf("r-%d", g.World.RegionAt(g.SettlementHex(n)))
	}()
	refusedOp(t, r, api.OperatorRequest{InteractionID: "op-1", Kind: api.OpArcCast, Arc: &api.ArcOrder{Template: "no-such-arc",
		Cast: []api.CastRef{{Role: "seat", Kind: "settlement", ID: fmt.Sprint(n)}}}}, api.CodeNoTemplate)
	refusedOp(t, r, api.OperatorRequest{InteractionID: "op-2", Kind: api.OpArcCast, Arc: &api.ArcOrder{Template: "the-overrun",
		Cast: []api.CastRef{{Role: "front", Kind: "settlement", ID: fmt.Sprint(n)}, {Role: "seat", Kind: "settlement", ID: fmt.Sprint(n)}}}}, api.CodeCastMisfit)
	overrun(t, r, n, "op-3")
	refusedOp(t, r, api.OperatorRequest{InteractionID: "op-4", Kind: api.OpArcCast, Arc: &api.ArcOrder{Template: "the-overrun",
		Cast: []api.CastRef{{Role: "front", Kind: "region", ID: region}, {Role: "seat", Kind: "settlement", ID: fmt.Sprint(n)}}}}, api.CodeSlotBusy)
	refusedOp(t, r, api.OperatorRequest{InteractionID: "op-5", Kind: api.OpSeasonStart}, api.CodeSeasonRunning)
	refusedOp(t, r, api.OperatorRequest{InteractionID: "op-6", Kind: api.OpSeasonEpoch, Epoch: &api.Epoch{From: "a", To: "b", Sheets: 1}}, api.CodeNotAtBoundary)

	arcs := read[api.Arcs](t, r, true, api.PathArcs+"?characterId="+a.ID, 200)
	if len(arcs.Open) != 1 || len(arcs.Open[0].Sides) != 2 || arcs.Season.Days == 0 || len(arcs.Backing) != 0 {
		t.Fatalf("arcs %+v", arcs)
	}
	sides := map[string]api.Side{}
	for _, s := range arcs.Open[0].Sides {
		sides[s.ID] = s
	}
	retake, evacuate := sides["retake"], sides["evacuate"]
	if retake.Wants != arc.WantBeats || evacuate.Wants != arc.WantGoods || evacuate.Tag != "provisions" || evacuate.AtHex == nil || retake.Mark == 0 ||
		retake.Sponsor == "" || arcs.Open[0].Cast[0].Name == "" {
		t.Fatalf("the overrun's sides: %+v", arcs.Open[0])
	}
	if o, err := r.cli.Options(ctx, a.ID); err != nil || len(o.Sides) != 2 {
		t.Fatalf("options offer the sides %+v: %v", o.Sides, err)
	}
	vow := api.GoalSpec{Title: "Reach the gate", Issuer: "character", Mode: "first", Lifetime: "standing", Turnover: "carry",
		Cond: api.Condition{Verb: "reach", Count: 1, At: "settlement:0"}}
	posted := accepted(api.ActionRequest{InteractionID: "vow", CharacterID: a.ID, Kind: api.ActPostGoal, Goal: &vow})
	vowID := ""
	for _, f := range posted.Facts {
		for _, s := range f.Subjects {
			if f.Kind == "goal.posted" && s.Kind == "goal" {
				vowID = s.ID
			}
		}
	}
	if vowID == "" {
		t.Fatalf("the vow's post names no goal: %+v", posted.Facts)
	}
	refused(api.ActionRequest{InteractionID: "back-0", CharacterID: a.ID, Kind: api.ActBackSide, Target: vowID}, api.CodeNotASide)
	accepted(api.ActionRequest{InteractionID: "back-1", CharacterID: a.ID, Kind: api.ActBackSide, Target: retake.Goal})
	refused(api.ActionRequest{InteractionID: "back-2", CharacterID: a.ID, Kind: api.ActBackSide, Target: evacuate.Goal, Asset: "provisions", Units: 1}, api.CodeOtherSide)
	arcs = read[api.Arcs](t, r, true, api.PathArcs+"?characterId="+a.ID, 200)
	if !slices.Equal(arcs.Backing, []string{retake.Goal}) || !mine(arcs.Open[0], "retake") || mine(arcs.Open[0], "evacuate") {
		t.Fatalf("after backing: %+v", arcs)
	}
	if theirs := read[api.Arcs](t, r, true, api.PathArcs+"?characterId="+b.ID, 200); mine(theirs.Open[0], "retake") || len(theirs.Backing) != 0 {
		t.Fatalf("another character's arcs: %+v", theirs)
	}
	backs := 0
	for _, x := range read[api.Goals](t, r, true, api.PathGoals+"?characterId="+a.ID, 200).Board {
		if x.Verb != "back" {
			continue
		}
		backs++
		if x.Side == nil || x.Side.Goal != x.ID || x.Side.ID == "retake" && !x.Side.Mine || x.Side.ID == "evacuate" && x.Side.Mine {
			t.Fatalf("a back goal's side: %+v", x.Side)
		}
	}
	if backs == 0 {
		t.Fatal("the board shows no side goal")
	}

	op(t, r, api.OperatorRequest{InteractionID: "op-oath", Kind: api.OpArcCast, Arc: &api.ArcOrder{Template: "the-oath",
		Cast: []api.CastRef{{Role: "character", Kind: "character", ID: b.ID}, {Role: "board", Kind: "settlement", ID: fmt.Sprint(n)}}}})
	thread := func(id string) bool {
		as := read[api.Arcs](t, r, true, api.PathArcs+"?characterId="+id, 200)
		return slices.ContainsFunc(as.Open, func(x api.Arc) bool { return x.Scope == arc.Personal })
	}
	if !thread(b.ID) || thread(a.ID) || slices.ContainsFunc(read[api.Arcs](t, r, true, api.PathArcs, 200).Open, func(x api.Arc) bool { return x.Scope == arc.Personal }) {
		t.Fatal("a personal thread is shown to someone other than its character")
	}
	sv := read[api.StoryView](t, r, false, api.PathOperatorStory, 200)
	if len(sv.Arcs) != 2 || sv.Season.Days == 0 {
		t.Fatalf("the operator's story: %+v", sv)
	}

	refused(api.ActionRequest{InteractionID: "pat-0", CharacterID: a.ID, Kind: api.ActPatternSet}, api.CodeNoPattern)
	release := r.srv.Hold()
	g := r.srv.Game()
	in, ok := g.Rules().Gen.OriginInstance("triangle-of-pylons")
	var pylon hex.Hex
	for _, p := range in.Points {
		if p.Place == "pylon" {
			pylon = p.Hex
			break
		}
	}
	c := g.Char(b.ID)
	c.Long, c.Fight = nil, nil
	err = g.Teleport(c, pylon)
	release()
	if !ok || err != nil {
		t.Fatalf("no pylon to stand on: %v", err)
	}
	advance(t, ctx, r, 3)
	to := api.Hex{Q: pylon.Q, R: pylon.R}
	refused(api.ActionRequest{InteractionID: "pat-1", CharacterID: b.ID, Kind: api.ActPatternSet, To: &to, Units: 99}, api.CodeBadArgs)
	elsewhere := api.Hex{Q: pylon.Q + 1, R: pylon.R}
	refused(api.ActionRequest{InteractionID: "pat-2", CharacterID: b.ID, Kind: api.ActPatternSet, To: &elsewhere}, api.CodeNotHere)
	set := accepted(api.ActionRequest{InteractionID: "pat-3", CharacterID: b.ID, Kind: api.ActPatternSet, To: &to})
	if !set.Character.Armed {
		t.Fatalf("setting the pylon armed no machine: %+v", set.Character)
	}
	if sv := read[api.StoryView](t, r, false, api.PathOperatorStory, 200); len(sv.Boards) == 0 || sv.Boards[0].Kind == "" {
		t.Fatalf("the operator's story shows no board: %+v", sv.Boards)
	}

	refused(api.ActionRequest{InteractionID: "city-1", CharacterID: a.ID, Kind: api.ActCityRaise}, api.CodeCityNotReady)
	// The guild takes a settlement whose six outer tiles are free, and its
	// works are raised, as a season of play would.
	release = r.srv.Hold()
	for range 8 {
		r.srv.Game().World.OpenSettlement()
	}
	release()
	advance(t, ctx, r, sheets.TicksPerDay+1)
	release = r.srv.Hold()
	g = r.srv.Game()
	city := slices.IndexFunc(g.Places, func(p *game.Place) bool {
		return p.Lattice >= 0 && slices.ContainsFunc(g.CityCheck(p.N), func(nd game.CityNeed) bool { return nd.ID == game.NeedTiles && nd.Met })
	})
	if city < 0 {
		release()
		t.Fatal("no starting settlement has six free outer tiles")
	}
	g.Places[city].Guild = g.Places[n].Guild
	works(g, g.Places[city])
	err = g.Teleport(g.Char(a.ID), g.SettlementHex(city))
	var short []game.CityNeed
	for _, nd := range g.CityCheck(city) {
		if (nd.ID == game.NeedWorks || nd.ID == game.NeedTiles) && !nd.Met {
			short = append(short, nd)
		}
	}
	release()
	if err != nil || len(short) > 0 {
		t.Fatalf("the settlement's works and tiles stay short: %+v %v", short, err)
	}
	advance(t, ctx, r, sheets.TicksPerDay+2)
	accepted(api.ActionRequest{InteractionID: "city-2", CharacterID: a.ID, Kind: api.ActCityRaise})
	refused(api.ActionRequest{InteractionID: "city-3", CharacterID: a.ID, Kind: api.ActCityRaise}, api.CodeProjectOpen)
}

// works raises a place's wall and stations to what a city project needs.
func works(g *game.Game, p *game.Place) {
	rules := g.Rules()
	full := sheets.IntParam(rules.Book.SettlementParams, "condition-max")
	raise := func(kind string, tier int64) {
		if st := p.Get(kind); st != nil {
			st.Tier, st.Condition = max(st.Tier, tier), full
			return
		}
		p.Structures = append(p.Structures, settle.Structure{Kind: kind, Tier: tier, Condition: full, Built: g.Tick(), Used: g.Tick()})
	}
	raise("wall", sheets.IntParam(rules.Book.SettlementParams, "city-wall-tier"))
	stations := sheets.IntParam(rules.Book.SettlementParams, "city-stations")
	for _, row := range rules.Book.Structures {
		if row.Station && stations > 0 && row.MaxTier >= 2 {
			raise(row.ID, sheets.IntParam(rules.Book.SettlementParams, "city-station-tier"))
			stations--
		}
	}
}

func mine(a api.Arc, side string) bool {
	return slices.ContainsFunc(a.Sides, func(s api.Side) bool { return s.ID == side && s.Mine })
}

// TestSeasonStartAtOpen keeps a world from before seasons, opens it, and
// expects the service to give it a season once, as a recorded command the
// world replays through. Opened again, it is not started again.
func TestSeasonStartAtOpen(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	sec, _ := testkit.Secrets(t, "mmo/test-master", world)
	book := testkit.Book(t)
	g, err := game.New(testkit.Rules(t, book, sec.Keys))
	if err != nil {
		t.Fatal(err)
	}
	g.Story = nil
	digest, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	st := store.New(pool, world)
	if err := st.EnsurePartitions(ctx, now); err != nil {
		t.Fatal(err)
	}
	if err := st.Create(ctx, store.Meta{ID: world, KeyVersion: sec.KeyVersion, KeyCheck: sec.Keys.Check(), RulesEpoch: sec.Epoch, SheetsDigest: digest,
		StartedAt: now, TickSeconds: 600}, g); err != nil {
		t.Fatal(err)
	}
	testkit.Ticks(t, ctx, st, g, 3)
	if g.Story != nil {
		t.Fatal("a world kept with no story grew one")
	}
	kept := func(c *service.Config) { c.Disposable = false }
	var logs bytes.Buffer
	r := startOn(t, pool, &logs, kept)
	if !strings.Contains(logs.String(), "SEASON STARTED") {
		t.Fatalf("no season start in the open's log:\n%s", logs.String())
	}
	if n := actionCount(t, ctx, r, "season-start"); n != 1 {
		t.Fatalf("%d season starts recorded", n)
	}
	sv := read[api.StoryView](t, r, false, api.PathOperatorStory, 200)
	if sv.Season.Days != sheets.IntParam(r.book.WorldParams, "season-days") || sv.Season.N != 0 || sv.Season.Day != 1 {
		t.Fatalf("the season started is %+v", sv.Season)
	}
	tick, started := digest2(t, r)
	advance(t, ctx, r, tick+1)
	tick, ticked := digest2(t, r)
	replays(t, ctx, r, tick, ticked)

	r.halt()
	logs.Reset()
	again := startOn(t, pool, &logs, kept)
	if strings.Contains(logs.String(), "SEASON STARTED") || actionCount(t, ctx, again, "season-start") != 1 {
		t.Fatalf("a world keeping a season was started again:\n%s", logs.String())
	}
	if _, d := digest2(t, again); d != ticked || d == started {
		t.Fatalf("reopened at %s, closed at %s", d, ticked)
	}
}

func digest2(t *testing.T, r *running) (int64, string) {
	t.Helper()
	return digest(t, context.Background(), r)
}

// shortSeasons is the shipped book with a season zero of the fewest days
// that hold every band, so a test reaches a close quickly.
func shortSeasons(t *testing.T) *sheets.Book {
	t.Helper()
	b := testkit.Book(t)
	setParam(t, b.StoryParams, "season-zero-days", 4)
	return b
}

func setParam(t *testing.T, ps []sheets.Param, id string, v int64) {
	t.Helper()
	i := slices.IndexFunc(ps, func(p sheets.Param) bool { return p.ID == id })
	if i < 0 {
		t.Fatalf("no param %s", id)
	}
	ps[i].Value = fixed.FromInt(v)
}

// TestSeasonEpoch stages a pending book with one change players see and
// one they do not: it is refused off a boundary, taken right after the
// tick that closes season zero (re-stamped, its notes stored, loaded on
// the new rules and recorded once), its notes served with the epoch on the
// promotions route, and a restart on the old sheets root runs on the new
// book without taking it again.
func TestSeasonEpoch(t *testing.T) {
	ctx := context.Background()
	pool := pgtest.Pool(t)
	book, next := shortSeasons(t), shortSeasons(t)
	ruin := sheets.IntParam(book.StoryParams, "ruin-troubles")
	setParam(t, next.StoryParams, "ruin-troubles", ruin+1)
	mount := sheets.IntParam(book.EconomyParams, "mount-price")
	setParam(t, next.EconomyParams, "mount-price", mount+1)
	from, err := book.Digest()
	if err != nil {
		t.Fatal(err)
	}
	to, err := next.Digest()
	if err != nil {
		t.Fatal(err)
	}
	staged := func(c *service.Config) { c.Disposable, c.Book, c.Next = false, book, next }
	var logs bytes.Buffer
	r := startOn(t, pool, &logs, staged)
	lexicon := func(r *running) api.Lexicon { return read[api.Lexicon](t, r, true, api.PathLexicon, 200) }
	if lexicon(r).Numbers.RuinTroubles != ruin {
		t.Fatal("the pending book is read before its epoch")
	}
	refusedOp(t, r, api.OperatorRequest{InteractionID: "early", Kind: api.OpSeasonEpoch, Epoch: &api.Epoch{From: from, To: to, Sheets: 1}}, api.CodeNotAtBoundary)

	end := int64(4 * sheets.TicksPerDay)
	advance(t, ctx, r, end-1)
	if strings.Contains(logs.String(), "EPOCH TAKEN") || stampedAs(t, r) != from {
		t.Fatal("the epoch was taken before the close")
	}
	advance(t, ctx, r, end)
	if !strings.Contains(logs.String(), "EPOCH TAKEN") || stampedAs(t, r) != to {
		t.Fatalf("no epoch after the close:\n%s", logs.String())
	}
	if n := actionCount(t, ctx, r, "season-epoch-1"); n != 1 {
		t.Fatalf("%d epochs recorded", n)
	}
	var data []byte
	if err := r.pool.QueryRow(ctx, "SELECT data FROM mmo.fact WHERE world_id = $1 AND kind = 'season.epoch'", world).Scan(&data); err != nil {
		t.Fatal(err)
	}
	var ds []fact.Datum
	if err := json.Unmarshal(data, &ds); err != nil {
		t.Fatal(err)
	}
	got := fact.Fact{Data: ds}
	if d, _ := got.Get("from"); d.S != from {
		t.Fatalf("season.epoch %+v", ds)
	}
	if d, _ := got.Get("sheets"); d.N != 2 {
		t.Fatalf("season.epoch counts %d sheets changed", d.N)
	}
	if _, ok := got.Get("roll"); ok {
		t.Fatalf("an epoch on the same roll key records one: %+v", ds)
	}
	notes, ok, err := store.New(pool, world).EpochNotes(ctx, 1)
	if err != nil || !ok {
		t.Fatalf("no notes stored for season 1: %v", err)
	}
	wantNotes := func(n *api.EpochNotes) {
		t.Helper()
		seen := api.EpochNote{Sheet: "economy.params", Row: "mount-price", Column: "value", Change: "changed",
			Before: fmt.Sprint(mount), After: fmt.Sprint(mount + 1), Unit: "coin"}
		if n == nil || n.Season != 1 || n.From != from || n.To != to || n.Sheets != 2 || n.Unseen != 1 || len(n.Seen) != 1 {
			t.Fatalf("epoch notes %+v", n)
		}
		got := n.Seen[0]
		got.Name = ""
		if got != seen {
			t.Fatalf("the change players see is %+v, want %+v", n.Seen[0], seen)
		}
	}
	wantNotes(&notes)
	promos := read[api.StoryEvents](t, r, true, api.PathStoryPromotions, 200)
	i := slices.IndexFunc(promos.Events, func(ev api.StoryEvent) bool { return ev.Fact.Kind == "season.epoch" })
	if i < 0 {
		t.Fatalf("no season.epoch on the promotions route: %+v", promos.Events)
	}
	wantNotes(promos.Events[i].Epoch)
	if lexicon(r).Numbers.RuinTroubles != ruin+1 {
		t.Fatal("the service does not run on the new book after the epoch")
	}
	sv := read[api.StoryView](t, r, false, api.PathOperatorStory, 200)
	if sv.Season.N != 1 || sv.Season.Day != 1 {
		t.Fatalf("after the close: %+v", sv.Season)
	}
	advance(t, ctx, r, end+1)
	refusedOp(t, r, api.OperatorRequest{InteractionID: "again", Kind: api.OpSeasonEpoch, Epoch: &api.Epoch{From: to, To: "later", Sheets: 1}}, api.CodeNotAtBoundary)
	_, live := digest2(t, r)

	r.halt()
	logs.Reset()
	back := startOn(t, pool, &logs, staged)
	if !strings.Contains(logs.String(), "EPOCH TAKEN") || actionCount(t, ctx, back, "season-epoch-1") != 1 {
		t.Fatalf("a restart on the old root:\n%s", logs.String())
	}
	if _, d := digest2(t, back); d != live {
		t.Fatalf("restarted at %s, closed at %s", d, live)
	}
	if lexicon(back).Numbers.RuinTroubles != ruin+1 {
		t.Fatal("a restart after the epoch runs on the old book")
	}
	advance(t, ctx, back, end+2)

	back.halt()
	logs.Reset()
	moved := startOn(t, pool, &logs, func(c *service.Config) { c.Disposable, c.Book = false, next })
	if strings.Contains(logs.String(), "EPOCH TAKEN") || lexicon(moved).Numbers.RuinTroubles != ruin+1 {
		t.Fatalf("the root moved to the new book:\n%s", logs.String())
	}

	moved.halt()
	if _, err := pool.Exec(ctx, "UPDATE mmo.world SET sheets_digest = 'sheets-before' WHERE id = $1", world); err != nil {
		t.Fatal(err)
	}
	logs.Reset()
	startOn(t, pool, &logs, func(c *service.Config) { c.Disposable, c.Book, c.SheetsFrom = false, next, "sheets-before" })
	if !strings.Contains(logs.String(), "OFF-BOUNDARY RESTAMP") {
		t.Fatalf("a re-stamp off a season's boundary is not called one:\n%s", logs.String())
	}
}

// stampedAs is the sheets digest the store holds the world on.
func stampedAs(t *testing.T, r *running) string {
	t.Helper()
	var d string
	if err := r.pool.QueryRow(context.Background(), "SELECT sheets_digest FROM mmo.world WHERE id = $1", world).Scan(&d); err != nil {
		t.Fatal(err)
	}
	return d
}
