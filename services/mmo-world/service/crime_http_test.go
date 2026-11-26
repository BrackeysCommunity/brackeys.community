package service_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
)

// crimeLocal is a Local world with one character standing in its starting
// settlement.
func crimeLocal(t *testing.T, label, discord string) (*service.Local, *game.Char) {
	t.Helper()
	g, err := game.New(testkit.Rules(t, testkit.Book(t), keys.Throwaway(label)))
	if err != nil {
		t.Fatal(err)
	}
	l := service.NewLocal(g)
	rep, ref, err := l.Act(context.Background(), api.ActionRequest{InteractionID: "c-" + discord, DiscordID: discord, Kind: api.ActCreate})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	return l, g.Char(rep.Character.ID)
}

func audited(t *testing.T, g *game.Game) {
	t.Helper()
	if bad := ledger.Audit(g.Ledger.Balances(), g.Holdings()); len(bad) > 0 {
		t.Fatalf("audit: %v", bad)
	}
}

// TestStealTargetsOnTheWire books a faction's store under a character's
// settlement and expects the burglary in its options as the rules plan it,
// named in words, and the theft it begins shown with its fixed odds.
func TestStealTargetsOnTheWire(t *testing.T) {
	ctx := context.Background()
	l, c := crimeLocal(t, "steal-wire", "thief")
	g := l.G
	o, err := l.Options(ctx, c.C.ID)
	if err != nil || o.Steals == nil {
		t.Fatalf("steals %#v, %v", o.Steals, err)
	}
	if ch, err := l.Character(ctx, c.C.ID); err != nil || ch.Alignment != (api.Alignment{Band: api.BandUnremarked}) || ch.Hot != nil || ch.Wanted != nil || ch.Stopped != nil {
		t.Fatalf("a new character reads %+v, %v", ch, err)
	}
	r := g.World.RegionAt(c.C.At)
	g.World.Regions[r].Holder = 0
	f := &g.World.Factions[0]
	f.Fallen, f.Stock = false, 9
	for _, m := range g.Rules().Book.Materials {
		if err := g.Ledger.Post(ledger.Move("store-"+m.ID, "test", g.Tick(), ledger.FromFaction, ledger.StorePool(0), ledger.Material(m.ID), 30)); err != nil {
			t.Fatal(err)
		}
	}
	want := g.StealTargets(c)
	if !slices.ContainsFunc(want, func(st game.StealTarget) bool { return st.Kind == game.KindBurgle }) {
		t.Fatalf("no burglary planned: %+v", want)
	}
	if o, err = l.Options(ctx, c.C.ID); err != nil || len(o.Steals) != len(want) {
		t.Fatalf("steals %+v against %+v, %v", o.Steals, want, err)
	}
	var burgle api.StealTarget
	for i, st := range o.Steals {
		w := want[i]
		if st.Kind != w.Kind || st.NPC != w.NPC || st.Caravan != w.Caravan || st.Worth != w.Worth || st.Witness != w.Witness || st.ForSide != w.Side {
			t.Errorf("steal %d is %+v where the rules plan %+v", i, st, w)
		}
		if strings.Contains(st.Name, ":") {
			t.Errorf("steal %d names its victim by ref: %q", i, st.Name)
		}
		if st.Kind == api.TheftBurgle {
			burgle = st
		}
	}
	if burgle.Name != g.FactionName(0) || burgle.Worth <= 0 {
		t.Fatalf("the burglary is %+v", burgle)
	}

	if _, ref, err := l.Act(ctx, api.ActionRequest{InteractionID: "s-none", CharacterID: c.C.ID, Version: c.Version, Kind: api.ActSteal,
		Option: api.TheftLift, NPC: "nobody"}); err != nil || ref == nil || ref.Code != api.CodeNoTarget {
		t.Fatalf("a lift from nobody: %+v, %v", ref, err)
	}
	if _, ref, err := l.Act(ctx, api.ActionRequest{InteractionID: "s-1", CharacterID: c.C.ID, Version: c.Version, Kind: api.ActSteal,
		Option: api.TheftBurgle}); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	o, err = l.Options(ctx, c.C.ID)
	if err != nil || o.Fight == nil || o.Fight.Theft == nil {
		t.Fatalf("no theft in the fight: %+v, %v", o.Fight, err)
	}
	th := o.Fight.Theft
	if th.Kind != api.TheftBurgle || th.Witness != burgle.Witness || th.Worth != burgle.Worth || th.Victim != burgle.Name || len(th.Haul) != 1 || th.Caught || th.Flee {
		t.Fatalf("the theft shows %+v against %+v", th, burgle)
	}
	var sum int64
	for _, p := range th.WitnessWhy.Parts {
		if p.Unit != "%" {
			t.Errorf("a witness part in %q", p.Unit)
		}
		sum += p.Value
	}
	tp := g.Rules().Book.TheftParams
	if len(th.WitnessWhy.Parts) == 0 || min(max(sum, sheets.IntParam(tp, "witness-least")), sheets.IntParam(tp, "witness-most")) != th.Witness {
		t.Fatalf("witness %d from parts %+v", th.Witness, th.WitnessWhy.Parts)
	}
	if o.Fight.Portrait != "" || len(o.Steals) != 0 {
		t.Fatalf("a theft shows a portrait %q or more steals %+v", o.Fight.Portrait, o.Steals)
	}
	audited(t, g)
}

// TestWatchFineOnTheWire holds a character at a gate for a lifted purse
// and a burglary it has partly sold on, and expects the fine the wire
// states to be the coin paying the watch takes.
func TestWatchFineOnTheWire(t *testing.T) {
	ctx := context.Background()
	l, c := crimeLocal(t, "watch-wire", "caught")
	g := l.G
	n, ok := g.SettlementAt(c.C.At)
	if !ok {
		t.Fatal("not in a settlement")
	}
	mat := g.Rules().Book.Materials[0].ID
	for _, x := range []game.Command{
		{Key: "coin", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Coin, Units: 200, Note: "purse"},
		{Key: "goods", Char: c.C.ID, Kind: game.Correct, Asset: ledger.Material(mat), Units: 3, Note: "haul"},
	} {
		if _, err := g.Act(x); err != nil {
			t.Fatal(err)
		}
	}
	t0, day := g.Tick(), g.Tick()/sheets.TicksPerDay
	ends := t0 + 3*sheets.TicksPerDay
	store := "faction:f-0"
	a := c.C.Align()
	a.Hot = []char.HotLot{{Material: mat, Units: 3, Mark: item.Hot{Victim: store, Faction: "faction:0", Ends: day + 7, At: c.C.At.Ref()}}}
	a.Wanted = []char.Wanted{
		{Victim: "npc:someone", Place: n, Worth: 12, Coin: 5, Source: ledger.NPCPool("someone"), Ends: ends},
		{Victim: store, Faction: "faction:0", Place: n, Worth: 50, Goods: []item.Spoil{{Material: mat, Qty: 5}}, Source: ledger.StorePool(0), Ends: ends},
	}
	a.Stopped = n + 1
	ch, err := l.Character(ctx, c.C.ID)
	if err != nil {
		t.Fatal(err)
	}
	// 5 coin back and 12 for the purse; 50 for the haul and 20 for the two
	// units gone of five.
	const fine = 5 + 12 + 50 + 20
	place := g.PlaceName(g.SettlementHex(n))
	switch {
	case ch.Stopped == nil || ch.Stopped.Settlement != n || ch.Stopped.Name != place || ch.Stopped.Fine != fine || !ch.Stopped.CanPay:
		t.Fatalf("the watch shows %+v", ch.Stopped)
	case len(ch.Wanted) != 2 || ch.Wanted[0].Fine != 17 || ch.Wanted[1].Fine != 70 || ch.Wanted[0].Days != 3 || !slices.Contains(ch.Wanted[0].Places, place) ||
		ch.Wanted[0].Victim != "someone":
		t.Fatalf("wanted %+v", ch.Wanted)
	case ch.Wanted[1].Victim != g.FactionName(0) || len(ch.Hot) != 1 || ch.Hot[0].Units != 3 || ch.Hot[0].Victim != g.FactionName(0) || ch.Hot[0].Days != 7:
		t.Fatalf("hot %+v, wanted %+v", ch.Hot, ch.Wanted)
	}
	if o, _ := l.Options(ctx, c.C.ID); len(o.Steals) != 0 {
		t.Fatalf("a character the watch holds may steal %+v", o.Steals)
	}
	rep, ref, err := l.Act(ctx, api.ActionRequest{InteractionID: "pay", CharacterID: c.C.ID, Version: c.Version, Kind: api.ActPayFine})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	if rep.Character.Coin != 200-fine || rep.Character.Stopped != nil || rep.Character.Wanted != nil || rep.Character.Hot != nil {
		t.Fatalf("after the fine %+v", rep.Character)
	}
	audited(t, g)
}

// TestCrimeSeen holds the syndicate's facts and jobs to the made, and an
// alignment move to its own character.
func TestCrimeSeen(t *testing.T) {
	ctx := context.Background()
	l, c := crimeLocal(t, "crime-seen", "made")
	g := l.G
	other, _, err := l.Act(ctx, api.ActionRequest{InteractionID: "c-other", DiscordID: "other", Kind: api.ActCreate})
	if err != nil {
		t.Fatal(err)
	}
	me, them := c.C.ID, other.Character.ID
	moved := api.Fact{Kind: "alignment.moved", Subjects: []api.Ref{{Kind: "character", ID: me}}}
	den := api.Fact{Kind: "den.moved", Subjects: []api.Ref{{Kind: "npc", ID: "r-0,0-den-fence-0"}}}
	made := api.Fact{Kind: "syndicate.made", Subjects: []api.Ref{{Kind: "character", ID: me}}}
	kinds := func(fs []api.Fact) []string {
		var out []string
		for _, f := range fs {
			out = append(out, f.Kind)
		}
		return out
	}
	all := []api.Fact{moved, den, made}
	if got := kinds(service.SeenFacts(g, me, all)); !slices.Equal(got, []string{"alignment.moved", "syndicate.made"}) {
		t.Fatalf("the unmade thief reads %v", got)
	}
	if got := kinds(service.SeenFacts(g, them, all)); len(got) != 0 {
		t.Fatalf("another reads %v", got)
	}
	if got := kinds(service.SeenFacts(g, "", all)); len(got) != 0 {
		t.Fatalf("the public reads %v", got)
	}
	if got := kinds(service.PlayerFacts(g, me, all)); !slices.Equal(got, []string{"alignment.moved", "syndicate.made"}) {
		t.Fatalf("its reply carries %v", got)
	}
	c.C.Align().Made = true
	if got := kinds(service.SeenFacts(g, me, all)); !slices.Equal(got, []string{"alignment.moved", "den.moved", "syndicate.made"}) {
		t.Fatalf("the made read %v", got)
	}

	n, _ := g.SettlementAt(c.C.At)
	job := &game.Goal{ID: "q-999999", Board: n, State: goal.Live, Issuer: goal.Ref{Kind: goal.BySyndicate, ID: "static"},
		Cond: goal.Condition{Verb: goal.Steal, Kind: api.TheftBurgle, Count: 40}}
	g.Goals = append(g.Goals, job)
	posted := api.Fact{Kind: "goal.posted", Subjects: []api.Ref{{Kind: "goal", ID: job.ID}}}
	board := func(id string) []string {
		page, err := l.Goals(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		var out []string
		for _, x := range page.Board {
			out = append(out, x.ID)
		}
		return out
	}
	if !slices.Contains(board(me), job.ID) || slices.Contains(board(them), job.ID) {
		t.Fatalf("the job is on the made board %v and the other's %v", board(me), board(them))
	}
	if len(service.SeenFacts(g, them, []api.Fact{posted})) != 0 || len(service.SeenFacts(g, me, []api.Fact{posted})) != 1 {
		t.Fatal("the job's facts are not the made's alone")
	}
	page, _ := l.Goals(ctx, me)
	if i := slices.IndexFunc(page.Board, func(x api.Goal) bool { return x.ID == job.ID }); i < 0 || page.Board[i].By != g.StandingName("syndicate") ||
		!strings.HasPrefix(page.Board[i].What, "steal 40") {
		t.Fatalf("the job reads %+v", page.Board)
	}
}

// TestPeopleLeanOnTheWire expects every person a character meets to say
// how it leans and the conversation to carry the same, and a talk with
// someone never met to refuse as /npc does.
func TestPeopleLeanOnTheWire(t *testing.T) {
	ctx := context.Background()
	l, c := crimeLocal(t, "people-wire", "talker")
	here, err := l.Here(ctx, c.C.ID)
	if err != nil || len(here.People) == 0 {
		t.Fatalf("people %+v, %v", here.People, err)
	}
	leanings := []string{api.LeaningUpright, api.LeaningCrooked, api.LeaningNone}
	for _, p := range here.People {
		if !slices.Contains(leanings, p.Leaning) || p.Fence {
			t.Errorf("%s leans %q, fence %v", p.ID, p.Leaning, p.Fence)
		}
	}
	p := here.People[0]
	if _, ref, err := l.Conversation(ctx, c.C.ID, p.ID); err != nil || ref == nil || ref.Code != api.CodeNotHere {
		t.Fatalf("a conversation before meeting: %+v, %v", ref, err)
	}
	if _, ref, err := l.Act(ctx, api.ActionRequest{InteractionID: "meet", CharacterID: c.C.ID, Version: c.Version, Kind: api.ActTalk, NPC: p.ID}); err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	conv, ref, err := l.Conversation(ctx, c.C.ID, p.ID)
	if err != nil || ref != nil || conv.NPC.ID != p.ID || !slices.Contains(leanings, conv.NPC.Leaning) || len(conv.Topics) == 0 {
		t.Fatalf("conversation %+v, %+v, %v", conv, ref, err)
	}
	if arcs, err := l.Arcs(ctx, c.C.ID); err != nil || arcs.Open == nil {
		t.Fatalf("arcs %+v, %v", arcs, err)
	}
}

// TestCrimeOverHTTP reads the crime numbers, a grudge and a refused steal
// over HTTP.
func TestCrimeOverHTTP(t *testing.T) {
	r := start(t, io.Discard)
	lex := readSolo[api.Lexicon](t, r, api.PathLexicon, 200)
	n := lex.Numbers
	if n.BandEdges != (api.BandEdges{Notorious: -50, Crooked: -10, Decent: 10, Upright: 50}) || n.GoodDay <= 0 || n.PairDay <= 0 || n.HotDays <= 0 ||
		n.HotReach <= 0 || n.WantedDays <= 0 || n.FencePays <= 0 || n.BackRoomPays <= n.FencePays || n.Gate <= 0 || n.Trusted <= n.Gate ||
		n.GrudgeDays <= 0 || n.LaunderPercent <= 0 {
		t.Fatalf("numbers %+v", n)
	}
	rep, ref, err := r.cli.Act(t.Context(), api.ActionRequest{InteractionID: "start", DiscordID: "crime", Kind: api.ActCreate})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id := rep.Character.ID
	query := "?characterId=" + url.QueryEscape(id)
	if sheet := readSolo[api.Sheet](t, r, api.PathSheet+query, 200); sheet.Grudges == nil || len(sheet.Grudges) != 0 || sheet.Character.Alignment.Band != api.BandUnremarked {
		t.Fatalf("a new sheet %+v, %+v", sheet.Grudges, sheet.Character.Alignment)
	}
	unlock := r.srv.Hold()
	g := r.srv.Game()
	c := g.Char(id)
	day := g.Tick() / sheets.TicksPerDay
	c.C.Align().Grudges = []char.Grudge{{Faction: "faction:0", Ends: day + 60}, {Faction: "faction:1", Ends: day}}
	unlock()
	sheet := readSolo[api.Sheet](t, r, api.PathSheet+query, 200)
	if len(sheet.Grudges) != 1 || sheet.Grudges[0].With != "faction:0" || sheet.Grudges[0].Name != g.FactionName(0) || sheet.Grudges[0].Ends != day+60 {
		t.Fatalf("grudges %+v", sheet.Grudges)
	}
	o, err := r.cli.Options(t.Context(), id)
	if err != nil || o.Steals == nil {
		t.Fatalf("steals %#v, %v", o.Steals, err)
	}
	body, _ := json.Marshal(api.ActionRequest{InteractionID: "steal", CharacterID: id, Version: o.Version, Kind: api.ActSteal, Option: api.TheftLift, NPC: "nobody"})
	resp, err := r.http.Client().Post(r.http.URL+api.PathActions, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var refusal api.Refusal
	if err := json.NewDecoder(resp.Body).Decode(&refusal); err != nil || resp.StatusCode != http.StatusUnprocessableEntity || refusal.Code != api.CodeNoTarget ||
		refusal.Version != o.Version {
		t.Fatalf("a steal from nobody: HTTP %d %+v, %v", resp.StatusCode, refusal, err)
	}
}
