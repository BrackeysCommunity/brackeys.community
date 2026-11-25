package service_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/store/pgtest"
)

const (
	serverA = "srv-a"
	serverB = "srv-b"
)

// member makes a character of a server for a Discord user.
func member(t *testing.T, r *running, key, user, server string, admin bool) string {
	t.Helper()
	rep, ref, err := r.cli.Act(context.Background(), api.ActionRequest{InteractionID: key, DiscordID: user, Kind: api.ActCreate,
		Option: api.StartKnife, Server: server, Note: "Guild " + server, Admin: admin})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	return rep.Character.ID
}

// houseOf reads a server's house with a reader's flags.
func houseOf(t *testing.T, r *running, server, character string, admin, staff bool) api.House {
	t.Helper()
	q := url.Values{"server": {server}, "character": {character}}
	if admin {
		q.Set("admin", "1")
	}
	if staff {
		q.Set("staff", "1")
	}
	return read[api.House](t, r, true, api.PathHouse+"?"+q.Encode(), 200)
}

// refusedAct sends a player's request at its character's version that
// must be refused with code, and leaves the world's digest as it was.
func refusedAct(t *testing.T, ctx context.Context, r *running, id string, req api.ActionRequest, code string) {
	t.Helper()
	_, before := digest(t, ctx, r)
	o, err := r.cli.Options(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	req.CharacterID, req.Version = id, o.Version
	_, ref, err := r.cli.Act(ctx, req)
	if err != nil || ref == nil || ref.Code != code {
		t.Fatalf("%s %s: %+v %v, want %s", req.InteractionID, req.Kind, ref, err, code)
	}
	if _, after := digest(t, ctx, r); after != before {
		t.Fatalf("a %s refusal of %s moved the digest", code, req.Kind)
	}
}

// putStamped writes a fact into the store as a tick would have, stamped
// as a server's staging.
func putStamped(t *testing.T, r *running, f fact.Fact, server string) {
	t.Helper()
	putFact(t, r, f)
	stamp, err := json.Marshal(fact.Ref{Kind: "server", ID: server})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.pool.Exec(context.Background(), "UPDATE mmo.fact SET staged_by = $1 WHERE world_id = $2 AND id = $3", stamp, world, int64(f.ID)); err != nil {
		t.Fatal(err)
	}
}

func houseLog(t *testing.T, r *running, server string, after int64) api.HouseLog {
	t.Helper()
	return read[api.HouseLog](t, r, true, fmt.Sprintf("%s?server=%s&after=%d", api.PathHouseLog, server, after), 200)
}

// TestHouseOverHTTP stages through the player path with the bot's
// fields: an admin of server A stages a large drop for nothing and a staff
// member a small one from the pool, each written once to A's log with its
// role and event points. A player without the flags, another server's
// admin and the Activity's path are refused with the world unchanged. The
// house reads its pools and stages, its queue only for staff, a crate
// mints staged goods the character reads as local, and an escalated case
// reaches the operators and is closed there.
func TestHouseOverHTTP(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	admin := member(t, r, "new-admin", "u-admin", serverA, true)
	staff := member(t, r, "new-staff", "u-staff", serverA, false)
	player := member(t, r, "new-player", "u-player", serverA, false)
	other := member(t, r, "new-other", "u-other", serverB, true)
	advance(t, ctx, r, 1)

	h := houseOf(t, r, serverA, admin, true, false)
	if h.Role != api.RoleAdmin || h.Arrival < 0 || len(h.Settlements) == 0 || h.Settlements[0].N != h.Arrival || h.Label == "" {
		t.Fatalf("server A's house reads %+v", h)
	}
	home := h.Settlements[0]
	if home.Pool != home.PoolCap || home.PoolCap <= 0 || len(home.Sites) == 0 || len(h.Templates) == 0 || len(h.Hunts) == 0 || len(h.Contests) == 0 ||
		h.StagedXP != sheets.IntParam(r.book.LiveOpsParams, "staged-xp") {
		t.Fatalf("server A's house reads %+v", h)
	}
	if none := houseOf(t, r, "srv-none", "", false, false); none.Arrival != -1 || len(none.Settlements) != 0 || none.Role != api.RolePlayer {
		t.Fatalf("a server with no house reads %+v", none)
	}
	for _, tp := range h.Templates {
		if (tp.Kind == sheets.StagePattern) != (len(tp.Patterns) > 0) {
			t.Fatalf("template %s lists patterns %v", tp.ID, tp.Patterns)
		}
	}
	read[api.Refusal](t, r, true, api.PathHouse, 400)
	read[api.Refusal](t, r, true, api.PathHouse+"?server="+serverA+"&character=c-nobody", 404)

	site := home.Sites[0].At
	points := map[string]int64{}
	for _, tp := range h.Templates {
		points[tp.ID] = tp.Points
	}
	stage := func(key, tpl string) api.ActionRequest {
		return api.ActionRequest{InteractionID: key, Kind: api.ActStage, Server: serverA, Stage: &api.StageOrder{Template: tpl, Settlement: home.N, At: site}}
	}

	// A player, another server's admin and the Activity's path are refused.
	refusedAct(t, ctx, r, player, stage("s-player", "drop-small"), api.CodeHouseRole)
	asB := stage("s-other", "drop-small")
	asB.Server, asB.Admin = serverB, true
	refusedAct(t, ctx, r, other, asB, api.CodeHouseScope)
	_, before := digest(t, ctx, r)
	o, err := r.cli.Options(ctx, admin)
	if err != nil {
		t.Fatal(err)
	}
	viaActivity := stage("act-s-activity", "drop-small")
	viaActivity.CharacterID, viaActivity.Version, viaActivity.Admin = admin, o.Version, true
	if _, ref, err := r.srv.Act(ctx, viaActivity, true); err != nil || ref == nil || ref.Code != api.CodeForbidden {
		t.Fatalf("a staging from the Activity's path: %+v %v", ref, err)
	}
	if _, after := digest(t, ctx, r); after != before {
		t.Fatal("a staging refused on the Activity's path moved the digest")
	}

	byAdmin := stage("s-admin", "drop-large")
	byAdmin.Admin, byAdmin.DiscordID = true, "u-admin"
	if rep := act(t, ctx, r, admin, byAdmin); rep.Points != 0 {
		t.Fatalf("an admin's staging spent %d event points", rep.Points)
	}
	byStaff := stage("s-staff", "drop-small")
	byStaff.Staff, byStaff.DiscordID = true, "u-staff"
	if rep := act(t, ctx, r, staff, byStaff); rep.Points != points["drop-small"] || rep.Points <= 0 {
		t.Fatalf("a staff staging spent %d event points, want %d", rep.Points, points["drop-small"])
	}

	log := houseLog(t, r, serverA, 0)
	want := []api.LogRow{
		{Server: serverA, Character: admin, Discord: "u-admin", Role: api.RoleAdmin, Kind: api.ActStage},
		{Server: serverA, Character: staff, Discord: "u-staff", Role: api.RoleStaff, Kind: api.ActStage, Points: points["drop-small"]},
	}
	if len(log.Rows) != len(want) {
		t.Fatalf("server A's log holds %+v", log.Rows)
	}
	for i, row := range log.Rows {
		got := api.LogRow{Server: row.Server, Character: row.Character, Discord: row.Discord, Role: row.Role, Kind: row.Kind, Points: row.Points}
		if got != want[i] || !strings.HasPrefix(row.What, "stage ") || row.At <= 0 || row.ID <= 0 {
			t.Fatalf("log row %d reads %+v", i, row)
		}
	}
	if log.Next != log.Rows[1].ID {
		t.Fatalf("the log's next is %d, want %d", log.Next, log.Rows[1].ID)
	}
	if page := houseLog(t, r, serverA, log.Rows[0].ID); len(page.Rows) != 1 || page.Rows[0].ID != log.Rows[1].ID {
		t.Fatalf("server A's log after its first row: %+v", page.Rows)
	}
	if b := houseLog(t, r, serverB, 0); len(b.Rows) != 0 {
		t.Fatalf("server B's log holds A's rows: %+v", b.Rows)
	}
	read[api.Refusal](t, r, true, api.PathHouseLog, 400)

	h = houseOf(t, r, serverA, staff, false, true)
	if h.Role != api.RoleStaff || h.Settlements[0].Pool != home.PoolCap-points["drop-small"] || len(h.Stages) != 2 {
		t.Fatalf("after staging, server A's house reads %+v", h)
	}
	drop, small := h.Stages[0], h.Stages[1]
	switch {
	case drop.Template != "drop-large" || !drop.Open || drop.Crates <= 0 || drop.Placed.By != "admins" || drop.Placed.Points != 0 || drop.Placed.Label == "":
		t.Fatalf("the admin's drop reads %+v", drop)
	case small.Template != "drop-small" || small.Placed.By != "staff" || small.Placed.Points != points["drop-small"] || small.Place == "":
		t.Fatalf("the staff drop reads %+v", small)
	}

	// A crate's goods are staged, and read as local to where they were.
	release := r.srv.Hold()
	g := r.srv.Game()
	if err := g.Teleport(g.Char(player), hex.Hex{Q: site.Q, R: site.R}); err != nil {
		release()
		t.Fatal(err)
	}
	release()
	act(t, ctx, r, player, api.ActionRequest{InteractionID: "crate-1", Kind: api.ActCrateOpen, Target: drop.ID, Server: serverA})
	ch := read[api.Character](t, r, true, api.PathCharacter+"?id="+player, 200)
	i := slices.IndexFunc(ch.Goods, func(gs api.Goods) bool { return gs.Staged != nil })
	if i < 0 || ch.Goods[i].Units <= 0 || ch.Goods[i].Staged.Settlement != home.N || ch.Goods[i].Staged.Name != home.Name {
		t.Fatalf("a crate's goods read %+v", ch.Goods)
	}
	if after := houseOf(t, r, serverA, admin, true, false); after.Stages[0].Crates != drop.Crates-1 {
		t.Fatalf("a crate opened leaves %d of %d", after.Stages[0].Crates, drop.Crates)
	}
	if l := houseLog(t, r, serverA, 0); len(l.Rows) != 2 {
		t.Fatalf("a player's crate wrote to the log: %+v", l.Rows)
	}

	// A staged hunt's card says who staged it, and its spoils are staged.
	var hunt string
	for i, row := range h.Hunts {
		o, err := r.cli.Options(ctx, staff)
		if err != nil {
			t.Fatal(err)
		}
		req := stage("s-hunt-"+strconv.Itoa(i), "hunt-2")
		req.CharacterID, req.Version, req.Staff, req.Stage.Hunt = staff, o.Version, true, row
		if rep, ref, err := r.cli.Act(ctx, req); err != nil {
			t.Fatal(err)
		} else if ref == nil {
			if rep.Points != points["hunt-2"] {
				t.Fatalf("a staff hunt spent %d event points", rep.Points)
			}
			hunt = row
			break
		}
	}
	if hunt == "" {
		t.Fatalf("no hunt row of %v stages at %v", h.Hunts, site)
	}
	board := read[api.HuntBoard](t, r, true, api.PathHunts, 200)
	i = slices.IndexFunc(board.Hunts, func(c api.HuntCard) bool { return c.Row == hunt && c.Stage != "" })
	if i < 0 {
		t.Fatalf("no staged %s hunt on the board: %+v", hunt, board.Hunts)
	}
	card := board.Hunts[i]
	if card.Placed == nil || card.Placed.By != "staff" || card.Placed.Points != points["hunt-2"] || len(card.Spoils) == 0 ||
		slices.ContainsFunc(card.Spoils, func(gs api.Goods) bool { return gs.Staged == nil || gs.Staged.Settlement != home.N }) {
		t.Fatalf("the staged hunt's card reads %+v", card)
	}

	// A report reaches the queue its staff read, an escalation the
	// operators, who close it.
	ref := game.RefSettlement + ":" + strconv.Itoa(home.N)
	act(t, ctx, r, player, api.ActionRequest{InteractionID: "report-1", Kind: api.ActReport, Server: serverA, Case: &api.CaseOrder{Ref: ref, Reason: "name"}})
	if p := houseOf(t, r, serverA, player, false, false); p.Role != api.RolePlayer || p.Cases != nil || p.Holds != nil || p.Masks != nil {
		t.Fatalf("a player reads the queue: %+v", p)
	}
	q := houseOf(t, r, serverA, staff, false, true)
	if len(q.Cases) != 1 || q.Cases[0].Ref != ref || q.Cases[0].Reporters != 1 || q.Cases[0].State != "open" {
		t.Fatalf("staff read the queue %+v", q.Cases)
	}
	id := q.Cases[0].ID
	act(t, ctx, r, staff, api.ActionRequest{InteractionID: "escalate-1", Kind: api.ActModerate, Server: serverA, Staff: true, DiscordID: "u-staff",
		Moderate: &api.ModerateOrder{Action: "escalate", Case: id}})
	cases := read[api.Cases](t, r, false, api.PathOperatorCases, 200)
	if len(cases.Cases) != 1 || cases.Cases[0].ID != id || cases.Cases[0].Server != serverA || cases.Cases[0].State != "escalated" {
		t.Fatalf("the operators read %+v", cases.Cases)
	}
	read[api.Refusal](t, r, true, api.PathOperatorCases, 401)
	if _, ref, err := r.op.Operate(ctx, api.OperatorRequest{InteractionID: "op-close", Kind: api.OpCaseClose, Target: serverA + "/" + id}); err != nil || ref != nil {
		t.Fatalf("op case-close: %+v %v", ref, err)
	}
	if cases := read[api.Cases](t, r, false, api.PathOperatorCases, 200); len(cases.Cases) != 0 {
		t.Fatalf("a closed case is still the operators': %+v", cases.Cases)
	}
	all := read[api.HouseLog](t, r, false, api.PathOperatorHouseLog+"?after=0", 200)
	kinds := make([]string, len(all.Rows))
	for i, row := range all.Rows {
		kinds[i] = row.Role + " " + row.Kind
	}
	if !slices.Equal(kinds, []string{"admin stage", "staff stage", "staff stage", "staff moderate", "operator case-close"}) || all.Rows[4].Server != "" ||
		all.Rows[4].Character != "" {
		t.Fatalf("the operators' log reads %+v", all.Rows)
	}
	read[api.Refusal](t, r, true, api.PathOperatorHouseLog, 401)
}

// TestHouseMasks: an operator renames a settlement for every server, a
// staff member of server A masks it, and A's readers read the world's
// generated name where B's read the new one: on the place, in the house,
// on the events and on the rename's fact. Restoring it reads generated
// everywhere, and the log holds the operator's and the staff's rows.
func TestHouseMasks(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	founded, n := founder(t, r, "new-a", "u-a", serverA)
	a := founded.ID
	staff := member(t, r, "new-staff", "u-staff", serverA, false)
	b := member(t, r, "new-b", "u-b", serverB, true)
	advance(t, ctx, r, 1)
	ref := game.RefSettlement + ":" + strconv.Itoa(n)
	const written = "Lantern Hollow"

	release := r.srv.Hold()
	g := r.srv.Game()
	at := g.SettlementHex(n)
	generated := g.GeneratedName(ref)
	if err := g.Teleport(g.Char(b), at); err != nil {
		release()
		t.Fatal(err)
	}
	release()
	if generated == "" || generated == written {
		t.Fatalf("settlement %d's generated name is %q", n, generated)
	}

	rep, refusal, err := r.op.Operate(ctx, api.OperatorRequest{InteractionID: "op-rename", Kind: api.OpRename, Rename: &api.RenameOrder{Ref: ref, Name: written}})
	if err != nil || refusal != nil || !hasFact(rep.Facts, "name.renamed") {
		t.Fatalf("op rename: %+v %+v %v", rep, refusal, err)
	}
	renamed := rep.Facts[slices.IndexFunc(rep.Facts, func(f api.Fact) bool { return f.Kind == "name.renamed" })].ID
	hereName := func(id string) string {
		t.Helper()
		return read[api.Here](t, r, true, api.PathHere+"?characterId="+id, 200).Name
	}
	if hereName(a) != written || hereName(b) != written {
		t.Fatalf("a renamed settlement reads %q and %q", hereName(a), hereName(b))
	}

	act(t, ctx, r, staff, api.ActionRequest{InteractionID: "mask-1", Kind: api.ActModerate, Server: serverA, Staff: true, DiscordID: "u-staff",
		Moderate: &api.ModerateOrder{Action: "mask", Ref: ref}})
	act(t, ctx, r, a, api.ActionRequest{InteractionID: "stage-1", Kind: api.ActStage, Server: serverA, Admin: true, DiscordID: "u-a",
		Stage: &api.StageOrder{Template: "drop-small", Settlement: n, At: houseOf(t, r, serverA, a, true, false).Settlements[0].Sites[0].At}})
	if got := hereName(a); got != generated {
		t.Fatalf("server A reads its masked settlement as %q, want %q", got, generated)
	}
	if got := hereName(b); got != written {
		t.Fatalf("server B reads A's mask: %q", got)
	}
	h := houseOf(t, r, serverA, staff, false, true)
	if h.Settlements[0].Name != generated || !slices.Equal(h.Masks, []string{ref}) {
		t.Fatalf("server A's house reads %+v", h)
	}
	opened := func(server string) api.StoryEvent {
		t.Helper()
		ev := read[api.StoryEvents](t, r, true, api.PathStoryEvents+"?after=0&server="+server, 200)
		i := slices.IndexFunc(ev.Events, func(e api.StoryEvent) bool { return e.Fact.Kind == "staged.opened" })
		if i < 0 {
			t.Fatalf("no staged.opened among %d events for %q", len(ev.Events), server)
		}
		return ev.Events[i]
	}
	if e := opened(""); e.Names[ref] != written || e.Server != serverA || e.Place != written {
		t.Fatalf("the unmasked event reads %+v", e)
	}
	if e := opened(serverA); e.Names[ref] != generated || e.Place != generated {
		t.Fatalf("server A's event reads %+v", e)
	}
	nameOf := func(server string) string {
		t.Helper()
		fc := read[api.FactCauses](t, r, true, fmt.Sprintf("%s?id=%d&server=%s", api.PathChronicleFact, renamed, server), 200)
		for _, d := range fc.Fact.Data {
			if d.Key == "name" {
				return d.S
			}
		}
		return ""
	}
	if nameOf(serverA) != generated || nameOf(serverB) != written {
		t.Fatalf("the rename's fact reads %q to A and %q to B", nameOf(serverA), nameOf(serverB))
	}

	if _, refusal, err := r.op.Operate(ctx, api.OperatorRequest{InteractionID: "op-restore", Kind: api.OpRename, Rename: &api.RenameOrder{Ref: ref}}); err != nil || refusal != nil {
		t.Fatalf("op rename back: %+v %v", refusal, err)
	}
	if hereName(a) != generated || hereName(b) != generated {
		t.Fatalf("a restored settlement reads %q and %q", hereName(a), hereName(b))
	}
	_, before := digest(t, ctx, r)
	if _, refusal, err := r.op.Operate(ctx, api.OperatorRequest{InteractionID: "op-again", Kind: api.OpRename, Rename: &api.RenameOrder{Ref: ref}}); err != nil || refusal == nil || refusal.Code != api.CodeBadArgs {
		t.Fatalf("restoring a name twice: %+v %v", refusal, err)
	}
	if _, after := digest(t, ctx, r); after != before {
		t.Fatal("a refused rename moved the digest")
	}
	all := read[api.HouseLog](t, r, false, api.PathOperatorHouseLog, 200)
	var kinds []string
	for _, row := range all.Rows {
		kinds = append(kinds, row.Role+" "+row.Kind)
	}
	if !slices.Equal(kinds, []string{"operator rename", "staff moderate", "admin stage", "operator rename"}) || !strings.Contains(all.Rows[0].What, written) {
		t.Fatalf("the operators' log reads %+v", all.Rows)
	}
}

// TestStagedEventsServer: every event carries the server whose staging it
// is; a server's read leaves out the other servers' staging and keeps its
// own and the world's.
func TestStagedEventsServer(t *testing.T) {
	ctx := context.Background()
	r := start(t, io.Discard)
	founded, n := founder(t, r, "new-a", "u-a", serverA)
	a := founded.ID
	advance(t, ctx, r, 1)
	act(t, ctx, r, a, api.ActionRequest{InteractionID: "stage-1", Kind: api.ActStage, Server: serverA, Admin: true, DiscordID: "u-a",
		Stage: &api.StageOrder{Template: "drop-small", Settlement: n, At: houseOf(t, r, serverA, a, true, false).Settlements[0].Sites[0].At}})
	theirs := fact.ID(storyIDs + 1)
	putStamped(t, r, fact.Fact{ID: theirs, Tick: 1, Kind: "staged.opened", Weight: 50, Subjects: []fact.Ref{{Kind: "stage", ID: "st-99"}},
		Data: []fact.Datum{fact.S("template", "drop-small"), fact.N("settlement", int64(n))}}, serverB)
	plain := fact.ID(storyIDs + 2)
	putFact(t, r, fact.Fact{ID: plain, Tick: 1, Kind: "trouble.started", Weight: 65, Subjects: []fact.Ref{arc.SettlementRef(n)}})

	servers := func(server string) map[int64]string {
		t.Helper()
		ev := read[api.StoryEvents](t, r, true, api.PathStoryEvents+"?after=0&server="+server, 200)
		out := map[int64]string{}
		for _, e := range ev.Events {
			out[e.Fact.ID] = e.Server
		}
		return out
	}
	everyone := servers("")
	var ours int64
	for id, s := range everyone {
		if s == serverA {
			ours = id
		}
	}
	switch {
	case ours == 0:
		t.Fatalf("no event carries server A: %v", everyone)
	case everyone[int64(theirs)] != serverB:
		t.Fatalf("B's event carries %q", everyone[int64(theirs)])
	}
	if s, ok := everyone[int64(plain)]; !ok || s != "" {
		t.Fatalf("the world's event carries %q (%v)", s, ok)
	}
	forA := servers(serverA)
	if _, ok := forA[int64(theirs)]; ok || forA[ours] != serverA {
		t.Fatalf("server A's events: %v", forA)
	}
	if _, ok := forA[int64(plain)]; !ok {
		t.Fatalf("server A's events leave out the world's: %v", forA)
	}
	forB := servers(serverB)
	if _, ok := forB[ours]; ok || forB[int64(theirs)] != serverB {
		t.Fatalf("server B's events: %v", forB)
	}
}

// TestChronicleOtherServers: a server's chronicle and the facts it opens
// leave out what another server staged, and keep its own and the world's.
func TestChronicleOtherServers(t *testing.T) {
	ctx := context.Background()
	r := startOn(t, pgtest.Pool(t), io.Discard, nil)
	_, n := founder(t, r, "new-a", "u-a", serverA)
	advance(t, ctx, r, sheets.TicksPerDay+1)
	settlement := arc.SettlementRef(n)
	ours, theirs, plain := fact.ID(storyIDs+1), fact.ID(storyIDs+2), fact.ID(storyIDs+3)
	putStamped(t, r, fact.Fact{ID: ours, Tick: 10, Kind: "staged.opened", Weight: 90, Subjects: []fact.Ref{settlement}}, serverA)
	putStamped(t, r, fact.Fact{ID: theirs, Tick: 11, Kind: "staged.opened", Weight: 95, Subjects: []fact.Ref{settlement}}, serverB)
	putFact(t, r, fact.Fact{ID: plain, Tick: 12, Kind: "city.raised", Weight: 80, Subjects: []fact.Ref{settlement}})

	lines := func(server string) []fact.ID {
		t.Helper()
		c := read[api.Chronicle](t, r, true, api.PathChronicle+"?day=0&server="+server, 200)
		var out []fact.ID
		for _, l := range c.Lines {
			out = append(out, fact.ID(l.Fact.ID))
		}
		return out
	}
	if a := lines(serverA); !slices.Contains(a, ours) || !slices.Contains(a, plain) || slices.Contains(a, theirs) {
		t.Fatalf("server A's chronicle: %v", a)
	}
	if b := lines(serverB); !slices.Contains(b, theirs) || !slices.Contains(b, plain) || slices.Contains(b, ours) {
		t.Fatalf("server B's chronicle: %v", b)
	}
	read[api.Refusal](t, r, true, fmt.Sprintf("%s?id=%d&server=%s", api.PathChronicleFact, theirs, serverA), 404)
	if f := read[api.FactCauses](t, r, true, fmt.Sprintf("%s?id=%d&server=%s", api.PathChronicleFact, theirs, serverB), 200); f.Fact.ID != int64(theirs) || !f.Fact.Staged {
		t.Fatalf("server B opens its own staging as %+v", f.Fact)
	}
}

// A vault's machine names its place and who staged it; any other machine
// names neither.
func TestVaultMarks(t *testing.T) {
	r := start(t, io.Discard)
	release := r.srv.Hold()
	defer release()
	g := r.srv.Game()
	g.Live = &game.LiveOps{Stages: []*game.Stage{{ID: "st-9", Server: serverA, Role: game.RoleAdmin, Label: "Tinkers"}}}
	if place, by := service.VaultMarks(g, serverA, "vault:st-9"); place != "vault:st-9" || by == nil || by.By != tile.PlacedAdmins || by.Label != "Tinkers" {
		t.Fatalf("the vault reads %q, %+v", place, by)
	}
	if place, by := service.VaultMarks(g, serverA, "dungeon:3,4"); place != "" || by != nil {
		t.Fatalf("a fork reads %q, %+v", place, by)
	}
}
