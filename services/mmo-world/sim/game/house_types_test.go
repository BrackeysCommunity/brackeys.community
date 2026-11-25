package game

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
)

// houseGame is a world with server a's guild running a settlement, a
// member c of it, and server b's guild beside it.
func houseGame(t *testing.T) (g *Game, c *Char, home int) {
	t.Helper()
	g = guardGame(t)
	res, err := g.Act(Command{Key: "a1", Kind: Create, Server: "a", Note: "Alder"})
	if err != nil {
		t.Fatal(err)
	}
	c = res.Char
	if _, err := g.Act(Command{Key: "b1", Kind: Create, Server: "b", Note: "Birch"}); err != nil {
		t.Fatal(err)
	}
	gd := g.ServerGuild("a")
	home = slices.IndexFunc(g.Places, func(p *Place) bool { return p.Guild == gd.G.ID })
	if home < 0 {
		t.Fatal("server a's guild runs no settlement")
	}
	return g, c, home
}

func refusedWith(t *testing.T, err error, code string) {
	t.Helper()
	var r *Refused
	if !errors.As(err, &r) || r.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

// TestHouseRole: admin and staff of a server speak for the settlements its
// guild runs; a player, another server's staff and a settlement the guild
// does not run are refused; settings are for admins, and need no guild.
func TestHouseRole(t *testing.T) {
	g, c, home := houseGame(t)
	cmd := func(kind, server string, admin, staff bool) Command {
		return Command{Key: "k", Char: c.C.ID, Kind: kind, Server: server, Admin: admin, Staff: staff}
	}
	for _, x := range []struct {
		name string
		cmd  Command
		want string
	}{
		{"admin", cmd(Staging, "a", true, false), RoleAdmin},
		{"admin and staff", cmd(Staging, "a", true, true), RoleAdmin},
		{"staff", cmd(Staging, "a", false, true), RoleStaff},
	} {
		role, gd, err := g.houseRole(x.cmd, home)
		if err != nil || role != x.want || gd != g.ServerGuild("a") {
			t.Errorf("%s: %q %v %v", x.name, role, gd, err)
		}
	}
	_, _, err := g.houseRole(cmd(Staging, "a", false, false), home)
	refusedWith(t, err, HouseRoleCode)
	_, _, err = g.houseRole(cmd(Staging, "", true, false), home)
	refusedWith(t, err, HouseRoleCode)
	_, _, err = g.houseRole(cmd(Staging, "b", false, true), home)
	refusedWith(t, err, HouseScope)
	_, _, err = g.houseRole(cmd(Staging, "c", true, false), home)
	refusedWith(t, err, HouseScope)
	for _, n := range []int{-2, len(g.Places)} {
		_, _, err = g.houseRole(cmd(Staging, "a", true, false), n)
		refusedWith(t, err, HouseScope)
	}
	if other := slices.IndexFunc(g.Places, func(p *Place) bool { return p.Guild != g.ServerGuild("a").G.ID }); other >= 0 {
		_, _, err = g.houseRole(cmd(Staging, "a", true, false), other)
		refusedWith(t, err, HouseScope)
	}
	if role, gd, err := g.houseRole(cmd(Moderate, "a", false, true), houseWide); err != nil || role != RoleStaff || gd == nil {
		t.Errorf("staff moderate: %q %v %v", role, gd, err)
	}
	_, _, err = g.houseRole(cmd(SetHouse, "a", false, true), houseWide)
	refusedWith(t, err, HouseRoleCode)
	if role, gd, err := g.houseRole(cmd(SetHouse, "c", true, false), houseWide); err != nil || role != RoleAdmin || gd != nil {
		t.Errorf("settings for a server with no guild: %q %v %v", role, gd, err)
	}
}

// TestHouseKindsUnregistered: a house kind no rule has registered is
// refused as an unknown command, with the game unchanged.
func TestHouseKindsUnregistered(t *testing.T) {
	g, c, home := houseGame(t)
	for _, kind := range []string{Staging, StagingEnd, HousePin, HouseUnpin, Moderate, SetHouse, CrateOpen, ReportCase} {
		if fn, ok := houseCommands[kind]; ok {
			delete(houseCommands, kind)
			defer func() { houseCommands[kind] = fn }()
		}
	}
	for _, kind := range []string{Rename, CaseClose} {
		if fn, ok := houseWorld[kind]; ok {
			delete(houseWorld, kind)
			defer func() { houseWorld[kind] = fn }()
		}
	}
	before, err := g.Digest()
	if err != nil {
		t.Fatal(err)
	}
	for _, cmd := range []Command{
		{Key: "s1", Char: c.C.ID, Kind: Staging, Server: "a", Admin: true, Stage: &StageCmd{Template: "drop-small", Settlement: home}},
		{Key: "s2", Char: c.C.ID, Kind: Moderate, Server: "a", Staff: true, Moderate: &ModerateCmd{Action: "mute", Ref: "character:c-2"}},
		{Key: "s3", Char: c.C.ID, Kind: SetHouse, Server: "a", Admin: true, Settings: &HouseSettings{HideNames: true}},
		{Key: "s4", Char: c.C.ID, Kind: CrateOpen, Target: "st-1"},
		{Key: "s5", Char: c.C.ID, Kind: ReportCase, Case: &CaseCmd{Ref: "character:c-2", Reason: "name"}},
		{Key: "s6", Kind: Rename, Rename: &RenameCmd{Ref: "character:c-2", Name: "Ash"}},
		{Key: "s7", Kind: CaseClose, Target: "a/case-1"},
	} {
		_, err := g.Act(cmd)
		refusedWith(t, err, BadArgs)
		after, derr := g.Digest()
		if derr != nil {
			t.Fatal(derr)
		}
		if after != before {
			t.Fatalf("%s changed the game", cmd.Kind)
		}
	}
}

// TestHouseRegistries: a registered kind is dispatched with its spent
// points in the result and Spent; gates run before every character
// command and their refusal changes nothing; tick and day hooks run with
// the clock moved.
func TestHouseRegistries(t *testing.T) {
	g, c, _ := houseGame(t)
	const probe = "house-probe"
	registerHouse(probe, func(g *Game, c *Char, cmd Command) error {
		g.spend(cmd.Units)
		return nil
	})
	defer delete(houseCommands, probe)
	res, err := g.Act(Command{Key: "p1", Char: c.C.ID, Kind: probe, Units: 60})
	if err != nil || res.Points != 60 || g.Spent() != 60 {
		t.Fatalf("probe: %v %d %d", err, res.Points, g.Spent())
	}
	if res, err := g.Act(Command{Key: "p2", Char: c.C.ID, Kind: Look}); err != nil || res.Points != 0 || g.Spent() != 0 {
		t.Fatalf("look after the probe: %v %d %d", err, res.Points, g.Spent())
	}
	func() {
		defer func() {
			if recover() == nil {
				t.Error("a kind registered twice did not panic")
			}
		}()
		registerHouse(probe, nil)
	}()

	gates := houseGates
	defer func() { houseGates = gates }()
	houseGates = append(slices.Clone(gates), func(g *Game, c *Char, cmd Command) error {
		if cmd.Kind == Look {
			return refuse(Muted, "held")
		}
		return nil
	})
	before, _ := g.Digest()
	_, err = g.Act(Command{Key: "p3", Char: c.C.ID, Kind: Look})
	refusedWith(t, err, Muted)
	if after, _ := g.Digest(); after != before {
		t.Fatal("a gate's refusal changed the game")
	}

	ticks, days := houseTicks, houseDays
	defer func() { houseTicks, houseDays = ticks, days }()
	var sawTicks, sawDays []int64
	houseTicks = append(slices.Clone(ticks), func(g *Game, tick int64) error {
		if g.Tick() != tick {
			t.Errorf("tick hook at %d with the clock at %d", tick, g.Tick())
		}
		sawTicks = append(sawTicks, tick)
		return nil
	})
	houseDays = append(slices.Clone(days), func(g *Game, day int64) error {
		sawDays = append(sawDays, day)
		return nil
	})
	start := g.Tick()
	var wantDays []int64
	for g.Tick() < start+sheets.TicksPerDay+1 {
		if (g.Tick()+1)%sheets.TicksPerDay == 0 {
			wantDays = append(wantDays, (g.Tick()+1)/sheets.TicksPerDay)
		}
		if _, err := g.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if int64(len(sawTicks)) != sheets.TicksPerDay+1 || sawTicks[0] != start+1 || !slices.Equal(sawDays, wantDays) {
		t.Fatalf("ticks %v, days %v, want days %v", sawTicks, sawDays, wantDays)
	}
}

// TestHouseJSON: every new field round-trips, and absent decodes as nil,
// so a world saved before them keeps its digest.
func TestHouseJSON(t *testing.T) {
	roundTrip := func(name string, v, out any) string {
		t.Helper()
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(b, out); err != nil {
			t.Fatal(err)
		}
		b2, err := json.Marshal(out)
		if err != nil {
			t.Fatal(err)
		}
		if string(b) != string(b2) {
			t.Errorf("%s: %s became %s", name, b, b2)
		}
		return string(b)
	}
	at := hex.Hex{Q: 3, R: -2}
	full := Command{Key: "k", Kind: Staging, Staff: true, Staged: true,
		Stage:    &StageCmd{Template: "hunt-2", Settlement: 1, At: at, Hunt: "boar", Opens: 6, Days: 2},
		Case:     &CaseCmd{Ref: "guild:g-1", Reason: "name"},
		Moderate: &ModerateCmd{Action: "mute", Ref: "character:c-1", Days: 7, Case: "case-1"},
		Settings: &HouseSettings{Channels: []Channel{{Kind: "log", ID: "9"}}, StaffRoles: []string{"1"}, AlarmRoles: []string{"2"}, HideNames: true, Narrated: true, QuietFrom: 60, QuietTo: 420},
		Rename:   &RenameCmd{Ref: "kind:k-1", Name: "Ash"}}
	roundTrip("command", full, &Command{})
	bareCmd := roundTrip("bare command", Command{Key: "k", Kind: Look}, &Command{})
	for _, key := range []string{`"staff"`, `"staged"`, `"stage"`, `"case"`, `"moderate"`, `"settings"`, `"rename"`} {
		if strings.Contains(bareCmd, key) {
			t.Errorf("a bare command writes %s: %s", key, bareCmd)
		}
	}

	houses := []*House{{Server: "a", Settings: HouseSettings{HideNames: true}, Pools: []Pool{{Settlement: 1, Points: 320}},
		Cases: []Case{{ID: "case-1", Ref: "goal:q-1", Reason: "spam", By: []string{"c-1"}, Tick: 9, State: "open"}}, NextCase: 1,
		Masks: []string{"guild:g-1"}, Hidden: []string{"q-1"}, Holds: []Hold{{Char: "c-1", Kind: "mute", Ends: 12, Case: "case-1"}}}}
	var hs []*House
	roundTrip("houses", houses, &hs)
	live := &LiveOps{Next: 1, Stages: []*Stage{{ID: "st-1", Template: "vault", Kind: "vault", Server: "a", Role: RoleStaff, By: "c-1", Label: "Alder",
		Points: 60, Settlement: 1, At: at, Opens: 10, Ends: 300, Open: true, Hunt: "boar", HuntID: "h-1", Arc: "arc-1", Contest: "c", Goals: []string{"q-1"},
		Crates: 3, Opened: tally.Tally{{Key: "c-2", N: 1}}, Pattern: "p", Board: "b", Vault: &VaultState{Family: "f", Level: 2, Taken: "sh-1"}}}}
	roundTrip("live", live, &LiveOps{})

	ch := char.New("c-1", at)
	ch.Staged = []char.StagedGoods{{At: 1, Material: "iron-ore", Units: 4}}
	ch.StagedDay = 3
	roundTrip("character", ch, &char.Character{})
	in := &item.Instance{ID: "i-1", Kind: "knife", Staged: &item.Stage{At: 1, Server: "a"}}
	roundTrip("item", in, &item.Instance{})
	q := &goal.Goal{ID: "q-1", Issuer: goal.Ref{Kind: goal.ByStaged, ID: "st-1"}, Prize: "prize-contest", Mode: goal.Each}
	roundTrip("goal", q, &goal.Goal{})
	roundTrip("hunt", &Hunt{Hex: at, Stage: "st-1"}, &Hunt{})
	roundTrip("arc", &Arc{ID: "arc-1", By: ByServer, Staging: "st-1"}, &Arc{})

	for name, x := range map[string]struct {
		v    any
		keys []string
	}{
		"char": {char.New("c-1", at), []string{`"staged"`, `"stagedDay"`}},
		"item": {&item.Instance{ID: "i-1"}, []string{`"staged"`}},
		"goal": {&goal.Goal{ID: "q-1"}, []string{`"prize"`}},
		"hunt": {&Hunt{}, []string{`"stage"`}},
		"arc":  {&Arc{}, []string{`"staging"`}},
	} {
		b, err := json.Marshal(x.v)
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range x.keys {
			if strings.Contains(string(b), key) {
				t.Errorf("an empty %s writes %s: %s", name, key, b)
			}
		}
	}
	var bare Game
	g := guardGame(t)
	b, err := json.Marshal(g)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), `"houses"`) || strings.Contains(string(b), `"live"`) {
		t.Error("a new world writes houses or live ops")
	}
	if err := json.Unmarshal(b, &bare); err != nil {
		t.Fatal(err)
	}
	if bare.Houses != nil || bare.Live != nil {
		t.Error("absent houses or live ops decoded as non-nil")
	}
	var c char.Character
	if err := json.Unmarshal([]byte(`{"id":"c-1"}`), &c); err != nil || c.Staged != nil || c.StagedDay != 0 {
		t.Errorf("absent staged goods: %+v %v", c.Staged, err)
	}
	var it item.Instance
	if err := json.Unmarshal([]byte(`{"id":"i-1"}`), &it); err != nil || it.Staged != nil {
		t.Errorf("absent item stage: %v %v", it.Staged, err)
	}
}

// TestHouseLookups: houses are found and made in server order.
func TestHouseLookups(t *testing.T) {
	g := guardGame(t)
	if g.House("b") != nil {
		t.Fatal("a house before any was made")
	}
	b := g.houseFor("b")
	g.houseFor("a")
	g.houseFor("c")
	if g.houseFor("b") != b || g.House("b") != b || len(g.Houses) != 3 {
		t.Fatal("houseFor made a second house")
	}
	if !slices.IsSortedFunc(g.Houses, func(x, y *House) int { return strings.Compare(x.Server, y.Server) }) {
		t.Fatal("houses out of order")
	}
}

// TestLogWhat: house and operator kinds are logged, players' are not, and
// summaries carry their units.
func TestLogWhat(t *testing.T) {
	for _, kind := range []string{Staging, StagingEnd, HousePin, HouseUnpin, Moderate, SetHouse, Rename, CaseClose, Correct, Ban, HuntStart, ArcCast, PinReserve} {
		if !Logged(kind) {
			t.Errorf("%s is not logged", kind)
		}
	}
	for _, kind := range []string{CrateOpen, ReportCase, Look, Bid, Create} {
		if Logged(kind) {
			t.Errorf("%s is logged", kind)
		}
	}
	at := hex.Hex{Q: 4, R: 5}
	for _, x := range []struct {
		cmd  Command
		want string
	}{
		{Command{Kind: Staging, Stage: &StageCmd{Template: "hunt-2", Settlement: 3, At: at, Hunt: "boar", Opens: 12, Days: 2}},
			"stage hunt-2 at settlement 3 on 4,5 · hunt boar · opens in 12 ticks · 2 days"},
		{Command{Kind: Staging, Stage: &StageCmd{Template: "drop-small", Settlement: 0, At: at, Days: 1}}, "stage drop-small at settlement 0 on 4,5 · 1 day"},
		{Command{Kind: StagingEnd, Target: "st-4"}, "end st-4"},
		{Command{Kind: Moderate, Moderate: &ModerateCmd{Action: "mute", Ref: "character:c-14", Days: 7}}, "mute c-14 · 7 days"},
		{Command{Kind: Moderate, Moderate: &ModerateCmd{Action: "exclude", Ref: "character:c-14", Case: "case-2"}}, "exclude c-14 · until lifted · case-2"},
		{Command{Kind: Moderate, Moderate: &ModerateCmd{Action: "mask", Ref: "guild:g-3"}}, "mask guild:g-3"},
		{Command{Kind: SetHouse, Settings: &HouseSettings{Channels: []Channel{{"log", "1"}, {"events", "2"}}, QuietFrom: 1320, QuietTo: 420}},
			"settings · 2 channels · 0 staff roles · 0 alarm roles · quiet 22:00 to 07:00 UTC"},
		{Command{Kind: Rename, Rename: &RenameCmd{Ref: "kind:k-2", Name: "Ash"}}, `rename kind:k-2 to "Ash"`},
		{Command{Kind: Rename, Rename: &RenameCmd{Ref: "kind:k-2"}}, "restore the generated name of kind:k-2"},
		{Command{Kind: CaseClose, Target: "a/case-1"}, "close a/case-1"},
		{Command{Kind: Correct, Char: "c-2", Asset: "coin", Units: -5}, "correct c-2 · -5 units of coin"},
		{Command{Kind: Ban, Char: "c-2"}, "ban c-2"},
	} {
		if got := LogWhat(x.cmd); got != x.want {
			t.Errorf("%s: %q, want %q", x.cmd.Kind, got, x.want)
		}
	}
}
