package game

import (
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"testing"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/sheets"
)

// modGame is houseGame with two more of server a's players: d, whom the
// tests hold, and e.
func modGame(t *testing.T) (g *Game, staff, d, e *Char, home int) {
	t.Helper()
	g, staff, home = houseGame(t)
	for _, key := range []string{"a2", "a3"} {
		res, err := g.Act(Command{Key: key, Kind: Create, Server: "a"})
		if err != nil {
			t.Fatal(err)
		}
		if d == nil {
			d = res.Char
		} else {
			e = res.Char
		}
	}
	return g, staff, d, e, home
}

func modCmd(staff *Char, key, action, ref string, days int64, caseID string) Command {
	return Command{Key: key, Char: staff.C.ID, Kind: Moderate, Server: "a", Staff: true,
		Moderate: &ModerateCmd{Action: action, Ref: ref, Days: days, Case: caseID}}
}

func modAct(t *testing.T, g *Game, cmd Command) Result {
	t.Helper()
	res, err := g.Act(cmd)
	if err != nil {
		t.Fatalf("%s %+v: %v", cmd.Kind, cmd.Moderate, err)
	}
	return res
}

// modRefused acts a command that must be refused with code, and
// fails if it changed the game.
func modRefused(t *testing.T, g *Game, cmd Command, code string) {
	t.Helper()
	before, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	_, err = g.Act(cmd)
	refusedWith(t, err, code)
	if after, _ := g.Digest(); after != before {
		t.Fatalf("a refused %s changed the game", cmd.Kind)
	}
}

func modCode(err error) string {
	var r *Refused
	if errors.As(err, &r) {
		return r.Code
	}
	if err != nil {
		return err.Error()
	}
	return ""
}

func modVow(g *Game) *GoalSpec {
	return &GoalSpec{Title: "No plate today", Issuer: goal.ByCharacter, Mode: goal.First, Lifetime: goal.Ephemeral,
		Turnover: goal.Expire, Ticks: g.GoalLimits().EphemeralLeast, Cond: goal.Condition{Verb: goal.Hold, Tag: "plate"}}
}

func modLedger(t *testing.T, g *Game) string {
	t.Helper()
	b, err := json.Marshal(g.Ledger)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// TestModerationNoLedger: every moderation action, the report that opens
// a case, settings and the operator's rename and case-close leave the
// ledger byte-identical, while the house records what they did.
func TestModerationNoLedger(t *testing.T) {
	g, staff, d, e, home := modGame(t)
	if _, err := g.Act(Command{Key: "v1", Char: d.C.ID, Kind: PostGoal, Goal: modVow(g)}); err != nil {
		t.Fatal(err)
	}
	vowID := g.Goals[len(g.Goals)-1].ID
	who := RefCharacter + ":" + d.C.ID
	cmds := []Command{
		{Key: "r1", Char: e.C.ID, Kind: ReportCase, Server: "a", Case: &CaseCmd{Ref: who, Reason: "name"}},
		{Key: "r2", Char: staff.C.ID, Kind: ReportCase, Server: "a", Case: &CaseCmd{Ref: who, Reason: "abuse"}},
		modCmd(staff, "m1", ModMask, who, 0, "case-1"),
		modCmd(staff, "m2", ModUnmask, who, 0, ""),
		modCmd(staff, "m3", ModHide, RefGoal+":"+vowID, 0, ""),
		modCmd(staff, "m4", ModUnhide, RefGoal+":"+vowID, 0, ""),
		modCmd(staff, "m5", ModMute, who, 3, ""),
		modCmd(staff, "m6", ModUnmute, who, 0, ""),
		modCmd(staff, "m7", ModSuspend, who, 0, ""),
		modCmd(staff, "m8", ModUnsuspend, who, 0, ""),
		modCmd(staff, "m9", ModExclude, who, g.houseParam("hold-days-max"), ""),
		modCmd(staff, "m10", ModUnexclude, who, 0, ""),
		modCmd(staff, "m11", ModEscalate, "", 0, "case-1"),
		{Key: "o1", Kind: CaseClose, Target: "a/case-1"},
		{Key: "r3", Char: e.C.ID, Kind: ReportCase, Server: "a", Case: &CaseCmd{Ref: RefSettlement + ":" + strconv.Itoa(home), Reason: "spam"}},
		modCmd(staff, "m12", ModDismiss, "", 0, "case-2"),
		{Key: "s1", Char: staff.C.ID, Kind: SetHouse, Server: "a", Admin: true, Settings: &HouseSettings{HideNames: true, QuietFrom: 60, QuietTo: 420}},
		{Key: "o2", Kind: Rename, Rename: &RenameCmd{Ref: RefSettlement + ":" + strconv.Itoa(home), Name: "Ashford"}},
		{Key: "o3", Kind: Rename, Rename: &RenameCmd{Ref: RefSettlement + ":" + strconv.Itoa(home)}},
	}
	for _, cmd := range cmds {
		before, posted := modLedger(t, g), g.Ledger.Posted
		res := modAct(t, g, cmd)
		if res.Points != 0 {
			t.Errorf("%s spent %d event points", cmd.Kind, res.Points)
		}
		if modLedger(t, g) != before || g.Ledger.Posted != posted {
			t.Fatalf("%s %s touched the ledger", cmd.Kind, cmd.Key)
		}
	}
	h := g.House("a")
	if len(h.Cases) != 2 || h.Cases[0].State != CaseClosed || h.Cases[1].State != CaseDismissed || !slices.Equal(h.Cases[0].By, []string{e.C.ID, staff.C.ID}) {
		t.Fatalf("cases %+v", h.Cases)
	}
	if len(h.Masks) != 0 || len(h.Hidden) != 0 || len(h.Holds) != 0 || !h.Settings.HideNames {
		t.Fatalf("house %+v", h)
	}
}

// TestModerationGates: mute, suspend and exclude refuse exactly their
// kinds, with the game unchanged, only where the design puts them; a hold
// with days ends on its own, and lifting one restores what it held.
func TestModerationGates(t *testing.T) {
	g, staff, d, _, home := modGame(t)
	away := -1
	advanceUntil(t, g, 3, func() bool {
		away = slices.IndexFunc(g.Places, func(p *Place) bool { return p.Guild != g.ServerGuild("a").G.ID })
		return away >= 0
	})
	who := RefCharacter + ":" + d.C.ID
	at := func(n int) {
		if err := g.Teleport(d, g.SettlementHex(n)); err != nil {
			t.Fatal(err)
		}
	}
	try := func(cmd Command) string {
		t.Helper()
		before, _ := g.Digest()
		_, err := g.Act(cmd)
		code := modCode(err)
		if code == Muted || code == Suspended || code == Excluded {
			if after, _ := g.Digest(); after != before {
				t.Fatalf("a held %s changed the game", cmd.Kind)
			}
		}
		return code
	}
	n := 0
	of := func(kind string, mut func(*Command)) Command {
		n++
		cmd := Command{Key: "g" + strconv.Itoa(n), Char: d.C.ID, Kind: kind, Server: "a", Material: "copper-ore", Units: 1, Price: 1}
		if mut != nil {
			mut(&cmd)
		}
		return cmd
	}
	withGoal := func(c *Command) { c.Goal = modVow(g) }
	// A screened name, so that no unheld naming goes through.
	named := func(c *Command) { c.Note = "The " + g.r.Book.Words[0].ID }
	writing := []Command{of(DungeonName, named), of(KindName, named), of(PromoteName, named), of(FoundGuild, named), of(Found, named), of(PostGoal, withGoal)}
	other := []Command{of(Look, nil), of(Withdraw, nil), of(WithdrawGoal, nil)}
	trading := []Command{of(Bid, nil), of(Ask, nil), of(Take, nil), of(List, nil), of(Want, nil), of(Purchase, nil), of(Give, nil),
		of(SellItem, nil), of(Sell, nil), of(Buy, nil), of(Craft, nil), of(PostGoal, withGoal), of(Pledge, nil), of(DeliverGoal, nil),
		of(TakeHaul, nil), of(CrateOpen, nil), of(HuntPress, nil)}
	want := func(cmds []Command, code string, held bool) {
		t.Helper()
		for _, cmd := range cmds {
			cmd.Key += "x" + strconv.Itoa(n)
			n++
			if got := try(cmd); (got == code) != held {
				t.Errorf("%s from %s at %s: %q, want held %v by %s", cmd.Kind, cmd.Server, d.C.At.Ref(), got, held, code)
			}
		}
	}
	fromB := func(cmds []Command) []Command {
		out := slices.Clone(cmds)
		for i := range out {
			out[i].Server = "b"
		}
		return out
	}

	// Nothing held: nothing refused for a hold.
	at(home)
	want(writing, Muted, false)
	want(trading, Excluded, false)

	modAct(t, g, modCmd(staff, "h1", ModMute, who, 0, ""))
	want(writing, Muted, true)
	want(slices.Concat(other, trading[:11]), Muted, false)
	want(fromB(writing), Muted, false)
	modAct(t, g, modCmd(staff, "h2", ModUnmute, who, 0, ""))
	want(writing, Muted, false)

	modAct(t, g, modCmd(staff, "h3", ModSuspend, who, 0, ""))
	want([]Command{of(PostGoal, withGoal)}, Suspended, true)
	want(fromB([]Command{of(PostGoal, withGoal)}), Suspended, true)
	want(slices.Concat(writing[:5], other, trading[:11]), Suspended, false)
	at(away)
	want([]Command{of(PostGoal, withGoal)}, Suspended, false)
	at(home)
	modAct(t, g, modCmd(staff, "h4", ModUnsuspend, who, 0, ""))
	want([]Command{of(PostGoal, withGoal)}, Suspended, false)

	modAct(t, g, modCmd(staff, "h5", ModExclude, who, 0, ""))
	want(trading, Excluded, true)
	want(fromB(trading), Excluded, true)
	want(slices.Concat(writing[:5], other), Excluded, false)
	at(away)
	want(trading[:len(trading)-2], Excluded, false)
	g.Live = &LiveOps{Stages: []*Stage{{ID: "st-90", Server: "a", Settlement: home, Open: true, Closed: true},
		{ID: "st-91", Server: "b", Settlement: away, Open: true, Closed: true}}}
	want([]Command{of(CrateOpen, func(c *Command) { c.Target = "st-90" })}, Excluded, true)
	want([]Command{of(CrateOpen, func(c *Command) { c.Target = "st-91" })}, Excluded, false)
	g.Live = nil
	at(home)
	modAct(t, g, modCmd(staff, "h6", ModUnexclude, who, 0, ""))
	want(trading, Excluded, false)

	// A hold with days holds until its end day, and not from it.
	modAct(t, g, modCmd(staff, "h7", ModMute, who, 1, ""))
	if hd := g.House("a").Holds[0]; hd.Ends != g.World.Day+1 {
		t.Fatalf("hold %+v on day %d", hd, g.World.Day)
	}
	want(writing[:1], Muted, true)
	for day := g.World.Day; g.World.Day == day; {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	want(writing[:1], Muted, false)
	if !slices.ContainsFunc(g.House("a").Holds, func(h Hold) bool { return h.Char == d.C.ID }) {
		t.Fatal("an ended hold was dropped; the card shows it until lifted")
	}
}

// TestModerationMasks: masks and hidden goals read for their server only,
// HideNames masks every name there, and each checks its ref exists.
func TestModerationMasks(t *testing.T) {
	g, staff, d, _, home := modGame(t)
	modAct(t, g, Command{Key: "v1", Char: d.C.ID, Kind: PostGoal, Goal: modVow(g)})
	vowID := g.Goals[len(g.Goals)-1].ID
	guildRef := RefGuild + ":" + g.ServerGuild("a").G.ID
	place := RefSettlement + ":" + strconv.Itoa(home)
	modAct(t, g, modCmd(staff, "m1", ModMask, guildRef, 0, ""))
	modAct(t, g, modCmd(staff, "m2", ModMask, place, 0, ""))
	modAct(t, g, modCmd(staff, "m3", ModHide, RefGoal+":"+vowID, 0, ""))
	if !g.MaskedFor("a", guildRef) || !g.MaskedFor("a", place) || g.MaskedFor("b", guildRef) || g.MaskedFor("a", RefCharacter+":"+d.C.ID) {
		t.Fatal("masks read for the wrong server")
	}
	if !g.HiddenFor("a", vowID) || !g.HiddenFor("a", RefGoal+":"+vowID) || g.HiddenFor("b", vowID) {
		t.Fatal("hidden goals read for the wrong server")
	}
	if got := g.GeneratedName(guildRef); got != "Guild "+g.ServerGuild("a").G.ID {
		t.Fatalf("a guild's generated name %q", got)
	}
	if got := g.GeneratedName(place); got != g.PlaceName(g.Places[home].Hex) {
		t.Fatalf("a starting settlement's generated name %q", got)
	}
	modAct(t, g, Command{Key: "s1", Char: staff.C.ID, Kind: SetHouse, Server: "b", Admin: true, Settings: &HouseSettings{HideNames: true}})
	if !g.MaskedFor("b", RefCharacter+":"+d.C.ID) || !g.MaskedFor("b", guildRef) {
		t.Fatal("hidden names do not mask every name")
	}
	for i, x := range []struct {
		cmd  Command
		code string
	}{
		{modCmd(staff, "", ModMask, guildRef, 0, ""), BadArgs},            // masked already
		{modCmd(staff, "", ModUnhide, RefGoal+":g-nope", 0, ""), BadArgs}, // no such goal
		{modCmd(staff, "", ModMask, RefGoal+":"+vowID, 0, ""), BadArgs},   // a goal is hidden, not masked
		{modCmd(staff, "", ModHide, place, 0, ""), BadArgs},               // a name is masked, not hidden
		{modCmd(staff, "", ModMask, "character:c-404", 0, ""), BadArgs},
		{modCmd(staff, "", ModMask, RefSettlement+":0"+strconv.Itoa(home), 0, ""), BadArgs},
		{modCmd(staff, "", ModMask, "post:https://discord.com/x", 0, ""), BadArgs},
		{modCmd(staff, "", ModMute, guildRef, 0, ""), BadArgs},
		{modCmd(staff, "", ModMute, RefCharacter+":"+d.C.ID, g.houseParam("hold-days-max")+1, ""), BadArgs},
		{modCmd(staff, "", ModMute, RefCharacter+":"+d.C.ID, -1, ""), BadArgs},
		{modCmd(staff, "", ModUnmute, RefCharacter+":"+d.C.ID, 0, ""), BadArgs},
		{modCmd(staff, "", "ban", RefCharacter+":"+d.C.ID, 0, ""), BadArgs},
		{modCmd(staff, "", ModEscalate, "", 0, ""), BadArgs},
		{modCmd(staff, "", ModDismiss, "", 0, "case-9"), BadArgs},
		{func() Command { c := modCmd(staff, "", ModMask, place, 0, ""); c.Staff = false; return c }(), HouseRoleCode},
		{func() Command { c := modCmd(staff, "", ModMask, place, 0, ""); c.Server = "z"; return c }(), HouseScope},
		{func() Command { c := modCmd(staff, "", ModMask, place, 0, ""); c.Moderate = nil; return c }(), BadArgs},
	} {
		x.cmd.Key = "bad" + strconv.Itoa(i)
		modRefused(t, g, x.cmd, x.code)
	}
}

// TestReportsPerDay: a character makes at most reports-per-day reports to
// one server in a world day, a second report of an open case joins it,
// and the next day the count starts again.
func TestReportsPerDay(t *testing.T) {
	g, staff, d, e, _ := modGame(t)
	most := g.houseParam("reports-per-day")
	var refs []string
	chars := []*Char{staff, d, e}
	for i := range most {
		chars = append(chars, modAct(t, g, Command{Key: "x" + strconv.FormatInt(i, decimal), Kind: Create, Server: "a"}).Char)
	}
	for _, c := range chars {
		refs = append(refs, RefCharacter+":"+c.C.ID)
	}
	for n := range g.Places {
		refs = append(refs, RefSettlement+":"+strconv.Itoa(n))
	}
	for _, gd := range g.Guilds {
		refs = append(refs, RefGuild+":"+gd.G.ID)
	}
	if int64(len(refs)) <= most+1 {
		t.Fatalf("%d refs for a limit of %d", len(refs), most)
	}
	report := func(key string, by *Char, ref, server string) error {
		_, err := g.Act(Command{Key: key, Char: by.C.ID, Kind: ReportCase, Server: server, Case: &CaseCmd{Ref: ref, Reason: "name"}})
		return err
	}
	for i := range most {
		if err := report("r"+strconv.FormatInt(i, decimal), d, refs[i], "a"); err != nil {
			t.Fatal(err)
		}
	}
	modRefused(t, g, Command{Key: "r-over", Char: d.C.ID, Kind: ReportCase, Server: "a", Case: &CaseCmd{Ref: refs[most], Reason: "spam"}}, CaseLimit)
	if err := report("r-b", d, refs[most], "b"); err != nil {
		t.Fatalf("another server's count: %v", err)
	}
	if err := report("r-join", e, refs[0], "a"); err != nil {
		t.Fatal(err)
	}
	h := g.House("a")
	if int64(len(h.Cases)) != most || !slices.Equal(h.Cases[0].By, []string{d.C.ID, e.C.ID}) {
		t.Fatalf("cases %+v", h.Cases)
	}
	modRefused(t, g, Command{Key: "r-twice", Char: e.C.ID, Kind: ReportCase, Server: "a", Case: &CaseCmd{Ref: refs[0], Reason: "abuse"}}, BadArgs)
	for i, c := range []CaseCmd{{Ref: refs[0], Reason: "rude"}, {Ref: "post:", Reason: "spam"}, {Ref: "post:a b", Reason: "spam"},
		{Ref: "dungeon:1,2", Reason: "name"}, {Ref: "nothing", Reason: "name"}} {
		modRefused(t, g, Command{Key: "r-bad" + strconv.Itoa(i), Char: e.C.ID, Kind: ReportCase, Server: "a", Case: &c}, BadArgs)
	}
	modRefused(t, g, Command{Key: "r-noserver", Char: e.C.ID, Kind: ReportCase, Case: &CaseCmd{Ref: refs[0], Reason: "name"}}, BadArgs)

	for day := g.World.Day; g.World.Day == day; {
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if err := report("r-next", d, refs[most], "a"); err != nil {
		t.Fatalf("the next day: %v", err)
	}
	if err := report("r-post", d, "post:https://discord.com/channels/1/2/3", "a"); err != nil {
		t.Fatal(err)
	}
}

// TestReportQueueKept: past queue-kept the oldest settled case goes
// first, then the oldest acted on, then the oldest open; the newest stays.
func TestReportQueueKept(t *testing.T) {
	h := &House{}
	for i, st := range []string{CaseOpen, CaseEscalated, CaseActed, CaseDismissed, CaseOpen, CaseClosed, CaseOpen} {
		h.Cases = append(h.Cases, Case{ID: "case-" + strconv.Itoa(i+1), State: st})
	}
	ids := func() []string {
		var out []string
		for _, x := range h.Cases {
			out = append(out, x.ID)
		}
		return out
	}
	for _, x := range []struct {
		kept int64
		want []string
	}{
		{6, []string{"case-1", "case-2", "case-3", "case-5", "case-6", "case-7"}},
		{5, []string{"case-1", "case-2", "case-3", "case-5", "case-7"}},
		{4, []string{"case-1", "case-2", "case-5", "case-7"}},
		{2, []string{"case-2", "case-7"}},
		{1, []string{"case-7"}},
	} {
		h.trimQueue(x.kept)
		if !slices.Equal(ids(), x.want) {
			t.Fatalf("kept %d: %v", x.kept, ids())
		}
	}

	// Through reports, with the sheet's cell lowered.
	g, staff, d, e, _ := modGame(t)
	i := slices.IndexFunc(g.r.Book.LiveOpsParams, func(p sheets.Param) bool { return p.ID == "queue-kept" })
	g.r.Book.LiveOpsParams[i].Value = fixed.FromInt(2)
	refs := []string{RefCharacter + ":" + staff.C.ID, RefCharacter + ":" + d.C.ID, RefCharacter + ":" + e.C.ID}
	for k, ref := range refs {
		modAct(t, g, Command{Key: "q" + strconv.Itoa(k), Char: e.C.ID, Kind: ReportCase, Server: "a", Case: &CaseCmd{Ref: ref, Reason: "name"}})
		if k == 0 {
			modAct(t, g, modCmd(staff, "q-dismiss", ModDismiss, "", 0, "case-1"))
		}
	}
	h = g.House("a")
	if len(h.Cases) != 2 || h.Cases[0].ID != "case-2" || h.Cases[1].ID != "case-3" || h.NextCase != 3 {
		t.Fatalf("queue %+v", h.Cases)
	}
}

// TestRename: an operator's rename is screened and written for everyone,
// and an empty name restores the generated one; a refused rename changes
// nothing.
func TestRename(t *testing.T) {
	g, staff, d, _, home := modGame(t)
	gd := g.ServerGuild("a")
	guild := RefGuild + ":" + gd.G.ID
	place := RefSettlement + ":" + strconv.Itoa(home)
	generated := g.PlaceName(g.Places[home].Hex)
	res := modAct(t, g, Command{Key: "o1", Kind: Rename, Rename: &RenameCmd{Ref: place, Name: "  Ashford "}})
	if g.PlaceName(g.Places[home].Hex) != "Ashford" || len(res.Facts) != 1 || res.Facts[0].Kind != "name.renamed" {
		t.Fatalf("renamed to %q with %+v", g.PlaceName(g.Places[home].Hex), res.Facts)
	}
	modAct(t, g, Command{Key: "o2", Kind: Rename, Rename: &RenameCmd{Ref: place}})
	if g.Places[home].Name != "" || g.PlaceName(g.Places[home].Hex) != generated {
		t.Fatalf("restored to %q", g.PlaceName(g.Places[home].Hex))
	}
	modAct(t, g, Command{Key: "o3", Kind: Rename, Rename: &RenameCmd{Ref: guild, Name: "Ember Hall"}})
	if gd.G.Name != "Ember Hall" {
		t.Fatalf("guild %q", gd.G.Name)
	}
	modAct(t, g, Command{Key: "o4", Kind: Rename, Rename: &RenameCmd{Ref: guild}})
	if gd.G.Name != "Guild "+gd.G.ID {
		t.Fatalf("guild restored to %q", gd.G.Name)
	}

	// A named dungeon reads its pack name once restored, hidden or not.
	dh := dungeonTile(t, g)
	dg := g.World.DungeonAt(dh)
	dg.Name, dg.NamedBy, dg.Hidden = "Bad Words Deep", []string{d.C.ID}, true
	{
		dref := RefDungeon + ":" + dh.Ref()
		modAct(t, g, Command{Key: "o5", Kind: Rename, Rename: &RenameCmd{Ref: dref}})
		if x := g.recordOf(dh); x.Name != g.GeneratedName(dref) || x.Hidden {
			t.Fatalf("dungeon %q hidden %v", x.Name, x.Hidden)
		}
	}

	blocked := g.r.Book.Words[0].ID
	for i, x := range []struct {
		r    RenameCmd
		code string
	}{
		{RenameCmd{Ref: guild, Name: "The " + blocked}, BadName},
		{RenameCmd{Ref: guild, Name: "   "}, BadName},
		{RenameCmd{Ref: guild, Name: string(make([]rune, g.sp("guild-name-length")+1))}, BadName},
		{RenameCmd{Ref: guild}, BadArgs}, // restored already
		{RenameCmd{Ref: guild, Name: g.ServerGuild("b").G.Name}, BadArgs},
		{RenameCmd{Ref: RefCharacter + ":" + d.C.ID, Name: "Ash"}, BadArgs},
		{RenameCmd{Ref: RefGoal + ":g-1", Name: "Ash"}, BadArgs},
		{RenameCmd{Ref: "settlement:404", Name: "Ash"}, BadArgs},
	} {
		modRefused(t, g, Command{Key: "bad" + strconv.Itoa(i), Kind: Rename, Rename: &x.r}, x.code)
	}
	modRefused(t, g, Command{Key: "bad-nil", Kind: Rename}, BadArgs)
	_ = staff
}

// TestModerationCaseClose: operators close only a case its server escalated.
func TestModerationCaseClose(t *testing.T) {
	g, staff, d, e, _ := modGame(t)
	modAct(t, g, Command{Key: "r1", Char: e.C.ID, Kind: ReportCase, Server: "a", Case: &CaseCmd{Ref: RefCharacter + ":" + d.C.ID, Reason: "cheating"}})
	modRefused(t, g, Command{Key: "c1", Kind: CaseClose, Target: "a/case-1"}, BadArgs)
	modAct(t, g, modCmd(staff, "m1", ModMute, RefCharacter+":"+d.C.ID, 7, "case-1"))
	if x := g.House("a").Cases[0]; x.State != CaseActed || x.Action != ModMute || g.House("a").Holds[0].Case != "case-1" {
		t.Fatalf("case %+v", x)
	}
	modAct(t, g, modCmd(staff, "m2", ModEscalate, "", 0, "case-1"))
	modRefused(t, g, modCmd(staff, "m3", ModDismiss, "", 0, "case-1"), BadArgs)
	modAct(t, g, modCmd(staff, "m4", ModExclude, RefCharacter+":"+d.C.ID, 0, "case-1"))
	if x := g.House("a").Cases[0]; x.State != CaseEscalated || x.Action != ModExclude {
		t.Fatalf("an action on an escalated case: %+v", x)
	}
	for _, target := range []string{"b/case-1", "a/case-2", "case-1", "a/"} {
		modRefused(t, g, Command{Key: "c-" + target, Kind: CaseClose, Target: target}, BadArgs)
	}
	modAct(t, g, Command{Key: "c2", Kind: CaseClose, Target: "a/case-1"})
	if g.House("a").Cases[0].State != CaseClosed {
		t.Fatal("not closed")
	}
	modRefused(t, g, modCmd(staff, "m5", ModMask, RefCharacter+":"+d.C.ID, 0, "case-1"), BadArgs)
}

// TestHouseSettings: an admin's settings replace the server's, a server
// with no guild gets one founded by the admin's character, which keeps its
// own guild, and the server's new players arrive there; staff and
// settings no server could mean are refused with the game unchanged.
func TestHouseSettings(t *testing.T) {
	g, admin, _, _, _ := modGame(t)
	own := admin.C.Guild
	set := HouseSettings{Channels: []Channel{{Kind: "events", ID: "111"}, {Kind: "log", ID: "222"}}, StaffRoles: []string{"333"},
		AlarmRoles: []string{"444"}, Narrated: true, QuietFrom: 1380, QuietTo: 420}
	cmd := Command{Key: "s1", Char: admin.C.ID, Kind: SetHouse, Server: "c", Admin: true, Note: "Cedar Hold", Settings: &set}
	modAct(t, g, cmd)
	gd := g.ServerGuild("c")
	if gd == nil || gd.G.Name != "Cedar Hold" || gd.G.Member(admin.C.ID) != nil || admin.C.Guild != own {
		t.Fatalf("installed %+v, the admin in %s", gd, admin.C.Guild)
	}
	h := g.House("c")
	if h == nil || h.Settings.QuietFrom != 1380 || len(h.Settings.Channels) != 2 || h.Settings.StaffRoles[0] != "333" {
		t.Fatalf("house %+v", h)
	}
	set.Channels[0].ID = "999"
	if h.Settings.Channels[0].ID != "111" {
		t.Fatal("the house shares the command's slices")
	}
	advanceUntil(t, g, 3, func() bool { return slices.ContainsFunc(g.Places, func(p *Place) bool { return p.Guild == gd.G.ID }) })
	res := modAct(t, g, Command{Key: "c1", Kind: Create, Server: "c"})
	if res.Char.C.Guild != gd.G.ID {
		t.Fatalf("a new player of c joined %s", res.Char.C.Guild)
	}
	if n, ok := g.home("c"); !ok || g.Places[n].Guild != gd.G.ID || res.Char.C.At != g.SettlementHex(n) {
		t.Fatal("c's player did not arrive at its guild's settlement")
	}

	modAct(t, g, Command{Key: "s2", Char: admin.C.ID, Kind: SetHouse, Server: "c", Admin: true, Settings: &HouseSettings{}})
	if g.House("c").Settings.Narrated || len(g.Guilds) != 3 {
		t.Fatal("settings were merged, or a second guild installed")
	}
	bad := []HouseSettings{
		{Channels: []Channel{{Kind: "lobby", ID: "1"}}},
		{Channels: []Channel{{Kind: "log", ID: "1"}, {Kind: "log", ID: "2"}}},
		{Channels: []Channel{{Kind: "log", ID: ""}}},
		{StaffRoles: []string{"1", "1"}},
		{AlarmRoles: []string{"a b"}},
		{StaffRoles: make([]string, settingsRolesMost+1)},
		{QuietFrom: minutesPerDay},
		{QuietTo: -1},
	}
	for i := range bad {
		modRefused(t, g, Command{Key: "bad" + strconv.Itoa(i), Char: admin.C.ID, Kind: SetHouse, Server: "a", Admin: true, Settings: &bad[i]}, BadArgs)
	}
	modRefused(t, g, Command{Key: "bad-nil", Char: admin.C.ID, Kind: SetHouse, Server: "a", Admin: true}, BadArgs)
	modRefused(t, g, Command{Key: "bad-staff", Char: admin.C.ID, Kind: SetHouse, Server: "a", Staff: true, Settings: &HouseSettings{}}, HouseRoleCode)
	modRefused(t, g, Command{Key: "bad-player", Char: admin.C.ID, Kind: SetHouse, Server: "d", Settings: &HouseSettings{}}, HouseRoleCode)
	if g.ServerGuild("d") != nil {
		t.Fatal("a refused settings installed a guild")
	}
}
