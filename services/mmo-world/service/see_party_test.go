package service_test

import (
	"context"
	"encoding/json"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/puzzle"
)

// partyOf forms a party of the characters given, the first leading, all
// standing on the first one's tile, through the commands a player sends.
func (s *seeing) partyOf(cs ...*game.Char) {
	s.t.Helper()
	for _, c := range cs[1:] {
		c.C.At = cs[0].C.At
		if _, ref := s.act(cs[0], api.ActionRequest{Kind: api.ActPartyInvite, Target: c.C.ID}); ref != nil {
			s.t.Fatal(ref)
		}
		if _, ref := s.act(c, api.ActionRequest{Kind: api.ActPartyJoin, Target: cs[0].C.ID}); ref != nil {
			s.t.Fatal(ref)
		}
	}
}

// nonMachine is an option on c's beat that is not its machine.
func nonMachine(t *testing.T, st api.ActivityState) string {
	t.Helper()
	for _, o := range st.Fight.Options {
		if !o.Puzzle {
			return o.ID
		}
	}
	t.Fatal("the beat offers only its machine")
	return ""
}

// layoutFields are a layout's fields as JSON, by name.
func layoutFields(t *testing.T, l api.PuzzleLayout) map[string]string {
	t.Helper()
	body, err := json.Marshal(l)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for k, v := range raw {
		out[k] = string(v)
	}
	return out
}

// TestFilterParty shows a party of three and a watcher on their tile their
// own states: no member is shown another's unresolved pick or another
// seat's dealt part, the watcher sees nothing of the party, and a member's
// state names other characters only as its party's members.
func TestFilterParty(t *testing.T) {
	ctx := context.Background()
	s := newSeeing(t)
	g := s.g
	host := s.l.Host()
	a, b, c, watcher := s.create(), s.create(), s.create(), s.create()
	s.partyOf(a, b, c)
	watcher.C.At = a.C.At
	members := []*game.Char{a, b, c}
	p := g.PartyOf(a)
	if p == nil || len(p.Members) != 3 {
		t.Fatalf("the party: %+v", p)
	}
	sh := testkit.PartyMachineBeat(t, g, members, puzzle.Fuse, 4)

	var told [][]string
	host.Subscribe(func(ids []string) { told = append(told, ids) })
	st, _ := s.view(a, api.Viewer{})
	pick := nonMachine(t, st)
	if _, ref := s.act(a, api.ActionRequest{Kind: api.ActPartyPick, Option: pick}); ref != nil {
		t.Fatal(ref)
	}
	if len(told) != 1 || !slices.Contains(told[0], b.C.ID) || !slices.Contains(told[0], c.C.ID) {
		t.Fatalf("a pick told %v; the members whose view changed were not told", told)
	}
	if sh.Opened != s.now.UnixMilli() {
		t.Fatalf("the pick opened the window at %d, not on the service's clock %d", sh.Opened, s.now.UnixMilli())
	}

	want := api.Context{Kind: api.ContextParty, ID: p.ID}
	for i, m := range members {
		st, body := s.view(m, api.Viewer{})
		if st.Context != want || st.Party == nil || st.Party.ID != p.ID || st.Party.Leader != (i == 0) || len(st.Party.Members) != 3 {
			t.Fatalf("member %d's context %+v and party %+v", i, st.Context, st.Party)
		}
		beat := st.Party.Beat
		if beat == nil || beat.Picked != 1 || beat.Present != 3 || beat.Opened != sh.Opened || beat.Due != sh.Opened+g.PartyWindowMs() || beat.Cautious == "" {
			t.Fatalf("member %d's beat: %+v", i, beat)
		}
		if (i == 0) != (beat.Mine == pick) || i > 0 && beat.Mine != "" {
			t.Fatalf("member %d is shown the pick %q", i, beat.Mine)
		}
		for j, pm := range st.Party.Members {
			if pm.Name != members[j].C.ID || pm.Seat != int64(j) || pm.You != (i == j) || pm.Picked != (j == 0) || !pm.Here {
				t.Fatalf("member %d sees member %d as %+v", i, j, pm)
			}
		}
		if f := st.Fight; f == nil || !f.Shared || len(f.Party) != 3 || !f.Party[0].Picked || f.Party[1].Picked {
			t.Fatalf("member %d's fight: %+v", i, st.Fight)
		}
		for _, bad := range []string{`"picks"`, `"who"`, `"held"`, watcher.C.ID, "sh-"} {
			if strings.Contains(body, bad) {
				t.Errorf("member %d is shown %s", i, bad)
			}
		}
		if i > 0 && strings.Contains(body, `"mine"`) {
			t.Errorf("member %d is shown a pick as its own", i)
		}
		m := st.Machine
		if m == nil || m.Armed || m.Source != api.MachineParty || m.Family != puzzle.Fuse || m.Seat != int64(i) || len(m.Seats) != 3 ||
			!m.Seats[i].You || !reflect.DeepEqual(m.Layout, api.PuzzleLayout{Family: puzzle.Fuse}) {
			t.Fatalf("member %d's machine at rest: %+v", i, m)
		}
	}
	_, watcherJSON := s.view(watcher, api.Viewer{})
	wst, _ := s.view(watcher, api.Viewer{})
	if wst.Context != (api.Context{Kind: api.ContextSolo, ID: watcher.C.ID}) || wst.Party != nil || wst.Fight != nil || wst.Machine != nil {
		t.Fatalf("the watcher's state: %+v", wst)
	}
	for _, m := range members {
		if strings.Contains(watcherJSON, m.C.ID) {
			t.Errorf("the watcher is shown %s", m.C.ID)
		}
	}
	for _, bad := range []string{p.ID, sh.ID, pick} {
		if strings.Contains(watcherJSON, `"`+bad+`"`) {
			t.Errorf("the watcher is shown %s", bad)
		}
	}

	// The window waits for the rest, and closes as its first member.
	ws, _ := host.Windows(ctx)
	if len(ws) != 1 || ws[0].Shared != sh.ID || ws[0].Character != a.C.ID || ws[0].Due != sh.Opened+g.PartyWindowMs() {
		t.Fatalf("windows: %+v", ws)
	}
	if w, ok, _ := host.Window(ctx, sh.ID); !ok || w != ws[0] {
		t.Fatalf("the window: %+v %v", w, ok)
	}
	key, seats, _ := host.Seats(ctx, b.C.ID)
	if key != api.ContextParty+":"+p.ID || !slices.Equal(seats, []string{a.C.ID, b.C.ID, c.C.ID}) {
		t.Fatalf("seats %s %v", key, seats)
	}
	if key, seats, _ := host.Seats(ctx, watcher.C.ID); key != api.ContextSolo+":"+watcher.C.ID || seats != nil {
		t.Fatalf("the watcher's seats %s %v", key, seats)
	}

	// The first touch arms it for every seat, each dealt its own part.
	if _, ref := s.act(c, api.ActionRequest{Kind: api.ActMachineArm, Machine: &api.MachineIntent{Source: api.MachineParty}}); ref != nil {
		t.Fatal(ref)
	}
	spec := sh.Machine.Spec
	parts := g.Puzzles().Deal(spec)
	if spec.Party == "" || spec.Seats != 3 || len(parts) != 3 {
		t.Fatalf("the armed spec %+v dealt %d parts", spec, len(parts))
	}
	if ws, _ := host.Windows(ctx); len(ws) != 0 {
		t.Fatalf("a window runs while the machine is armed: %+v", ws)
	}
	bodies := make([]string, 3)
	for i, m := range members {
		st, body := s.view(m, api.Viewer{})
		bodies[i] = body
		mv := st.Machine
		if mv == nil || !mv.Armed || mv.Party != spec.Party || mv.Seat != int64(i) || mv.ArmedAt != s.now.UnixMilli() ||
			mv.Due != g.PartyDue(sh.Machine) || mv.Glimpse != nil || mv.Inner != nil || mv.Countdown != sh.Machine.Countdown {
			t.Fatalf("seat %d's armed machine: %+v", i, mv)
		}
		dealt := parts[i]
		dealt.Level, dealt.Tier = 0, 0
		if !reflect.DeepEqual(service.LayoutOf(mv.Layout), dealt) {
			t.Fatalf("seat %d holds another view than its dealt part", i)
		}
		if !st.Party.Beat.Waiting {
			t.Fatalf("seat %d's beat does not wait on the machine", i)
		}
	}
	hidden := 0
	for i := range members {
		mine := layoutFields(t, apiLayoutOf(parts[i]))
		for j := range members {
			if i == j {
				continue
			}
			for k, v := range layoutFields(t, apiLayoutOf(parts[j])) {
				if mine[k] == v || len(v) <= len(`[]`) {
					continue
				}
				hidden++
				if strings.Contains(bodies[i], `"`+k+`":`+v) {
					t.Errorf("seat %d is shown seat %d's %s", i, j, k)
				}
			}
		}
	}
	if hidden == 0 {
		t.Fatalf("%s deals every seat the same: the check above proves nothing", spec.Party)
	}
	for i, body := range bodies {
		for _, needle := range s.needles {
			if strings.Contains(body, needle) {
				t.Errorf("seat %d is shown a key", i)
			}
		}
		for _, bad := range []string{`"tile:`, `"floor:`, `"spec"`, `"attempt"`, `"tier"`} {
			if strings.Contains(body, bad) {
				t.Errorf("seat %d is shown %s, which a machine is drawn from", i, bad)
			}
		}
	}

	// One countdown for the context, ended by its first seat; the merged
	// log is judged without a write.
	list, _ := host.Armed(ctx)
	if len(list) != 1 || list[0].CharacterID != a.C.ID || list[0].Context != key || list[0].ArmedAt != sh.Machine.At || list[0].Due != g.PartyDue(sh.Machine) {
		t.Fatalf("countdowns: %+v", list)
	}
	if m, ok, _ := host.Countdown(ctx, c.C.ID); !ok || m != list[0] {
		t.Fatalf("a seat's countdown: %+v", m)
	}
	before, _ := g.Digest()
	solve := service.LogOf(g.Puzzles().PartySolve(g.Puzzles().Make(spec)))
	for _, tc := range []struct {
		who  *game.Char
		log  api.PuzzleLog
		want string
	}{
		{b, api.PuzzleLog{}, "going"},
		{c, *solve, "done"},
		{a, api.PuzzleLog{Moves: []api.PuzzleMove{{At: 1, A: 0, Seat: 9}}}, "broke"},
		{watcher, *solve, ""},
	} {
		if got, err := host.Judge(ctx, tc.who.C.ID, tc.log); err != nil || got != tc.want {
			t.Errorf("judged %q for %s, want %q (%v)", got, tc.who.C.ID, tc.want, err)
		}
	}
	if after, _ := g.Digest(); after != before {
		t.Fatal("judging a log changed the game")
	}
}

func apiLayoutOf(l puzzle.Layout) api.PuzzleLayout {
	body, _ := json.Marshal(l)
	var out api.PuzzleLayout
	_ = json.Unmarshal(body, &out)
	return out
}

// TestFilterFork shows a party at a fork its ways and every member's
// choice in the open, and the board the same ways with no one's own reads.
func TestFilterFork(t *testing.T) {
	ctx := context.Background()
	s := newSeeing(t)
	g := s.g
	a, b := s.create(), s.create()
	s.partyOf(a, b)
	h := testkit.Delving(t, g, []*game.Char{a, b}, 1)
	p := g.PartyOf(a)
	sh := &game.Shared{ID: "sh-fork", Party: p.ID, Hex: h, Floor: 1, Members: []string{a.C.ID, b.C.ID}, Fork: &game.ForkState{Floor: 1, Open: []int64{0}}}
	g.Shared = append(g.Shared, sh)
	st, _ := s.view(a, api.Viewer{})
	f := st.Floor
	if f == nil || f.Dungeon != h.Ref() || f.Floor != 1 || len(f.Ways) < 2 || f.Ways[0].ID != api.WayOpen || !f.Ways[0].Open || f.Ways[1].Open {
		t.Fatalf("the fork as a member sees it: %+v", f)
	}
	for _, w := range f.Ways {
		if w.Name == "" || len(w.Tags) == 0 || w.Next != nil {
			t.Fatalf("a way: %+v", w)
		}
	}
	if _, ref := s.act(a, api.ActionRequest{Kind: api.ActDungeonPush, Option: api.WayOpen}); ref != nil {
		t.Fatal(ref)
	}
	st, body := s.view(b, api.Viewer{})
	f = st.Floor
	if len(f.Choices) != 1 || f.Choices[0].Name != a.C.ID || !f.Choices[0].Push || f.Choices[0].Way != api.WayOpen || f.Ways[0].Votes != 1 ||
		f.Opened != s.now.UnixMilli() || f.Due != f.Opened+g.PartyWindowMs() {
		t.Fatalf("the fork after a push: %+v", f)
	}
	if !st.Party.Members[0].Picked || st.Party.Members[1].Picked || strings.Contains(body, `"floors"`) {
		t.Fatalf("who has chosen: %+v", st.Party.Members)
	}
	board, err := s.l.Parties(ctx)
	if err != nil || len(board.Parties) != 1 {
		t.Fatal(board, err)
	}
	pb := board.Parties[0]
	if pb.Fork == nil || pb.Fork.Floor != 1 || len(pb.Fork.Ways) != len(f.Ways) || !pb.Members[0].Chose || pb.Members[1].Chose || pb.Beat != nil ||
		pb.Opened != f.Opened || pb.Members[0].DiscordID == "" {
		t.Fatalf("the board's fork: %+v", pb)
	}
	if ws, _ := s.l.Host().Windows(ctx); len(ws) != 1 || ws[0].Character != a.C.ID {
		t.Fatalf("the fork's window: %+v", ws)
	}
}

// TestPartyReads reads a party as the bot does: the party, who is in
// reach, the invitations held, the thread's users, and a party that ended
// on the board until a tick has passed.
func TestPartyReads(t *testing.T) {
	ctx := context.Background()
	s := newSeeing(t)
	a, b, c := s.create(), s.create(), s.create()
	s.partyOf(a, b)
	c.C.At = a.C.At
	if _, ref := s.act(b, api.ActionRequest{Kind: api.ActPartyInvite, Target: c.C.ID}); ref != nil {
		t.Fatal(ref)
	}
	st, err := s.l.Party(ctx, c.C.ID)
	if err != nil || st.Party != nil || st.Thread != nil || len(st.Invites) != 1 || st.Invites[0].CharacterID != b.C.ID || st.Invites[0].Party == "" {
		t.Fatalf("the invitee's read: %+v %v", st, err)
	}
	if !slices.ContainsFunc(st.Reach, func(r api.Reachable) bool { return r.CharacterID == a.C.ID && r.InParty }) {
		t.Fatalf("reach: %+v", st.Reach)
	}
	st, _ = s.l.Party(ctx, a.C.ID)
	if st.Party == nil || !st.Party.Leader || st.Thread == nil || !slices.Equal(st.Thread.Members, []string{"u-b", "u-c"}) {
		t.Fatalf("the leader's read: %+v", st)
	}
	board, _ := s.l.Parties(ctx)
	if len(board.Parties) != 1 || board.Parties[0].Ended || board.Parties[0].Members[1].DiscordID != "u-c" {
		t.Fatalf("the board: %+v", board)
	}
	if _, ref := s.act(b, api.ActionRequest{Kind: api.ActPartyLeave}); ref != nil {
		t.Fatal(ref)
	}
	board, _ = s.l.Parties(ctx)
	if len(board.Parties) != 1 || !board.Parties[0].Ended || board.Parties[0].ID != st.Party.ID {
		t.Fatalf("the board after the party ended: %+v", board)
	}
	for range 2 {
		if err := s.l.Advance(); err != nil {
			t.Fatal(err)
		}
	}
	if board, _ = s.l.Parties(ctx); len(board.Parties) != 0 {
		t.Fatalf("an ended party outlived the tick after: %+v", board)
	}
}

// TestFilterHunt binds a character in reach of a live hunt to the hunt's
// context, shows it the hunt with its own share and options, and keeps a
// party member in its party's context while showing it the hunt too.
func TestFilterHunt(t *testing.T) {
	ctx := context.Background()
	s := newSeeing(t)
	g := s.g
	hunter, a, b := s.create(), s.create(), s.create()
	s.partyOf(a, b)
	a.C.At, b.C.At = hunter.C.At, hunter.C.At
	x, err := g.OpenHunt("walking-factory", hunter.C.At, g.Tick(), "test")
	if err != nil {
		t.Fatal(err)
	}
	st, _ := s.view(hunter, api.Viewer{})
	hv := st.Hunt
	if st.Context != (api.Context{Kind: api.ContextHunt, ID: x.H.ID}) || hv == nil || hv.ID != x.H.ID || !hv.CanPress || len(hv.Options) == 0 ||
		hv.Health != hv.Max || hv.EndsIn != hv.Ends-g.Tick() || len(hv.Spoils) == 0 || hv.Name == "" {
		t.Fatalf("the hunter's state: %+v %+v", st.Context, hv)
	}
	if key, seats, _ := s.l.Host().Seats(ctx, hunter.C.ID); key != api.ContextHunt+":"+x.H.ID || seats != nil {
		t.Fatalf("the hunter's seats: %s %v", key, seats)
	}
	if _, ref := s.act(hunter, api.ActionRequest{Kind: api.ActHuntPress, Target: x.H.ID, Option: hv.Options[0].ID}); ref != nil {
		t.Fatal(ref)
	}
	st, _ = s.view(hunter, api.Viewer{})
	if hv = st.Hunt; hv.CanPress || hv.Options != nil || len(hv.Pressers) != 1 || !hv.Pressers[0].You || hv.Mine != x.H.Removed.Get(hunter.C.ID) ||
		hv.Mine > 0 && hv.Share != 100 {
		t.Fatalf("after a press: %+v", hv)
	}
	st, _ = s.view(a, api.Viewer{})
	if st.Context.Kind != api.ContextParty || st.Hunt == nil || !st.Hunt.CanPress || st.Hunt.Pressers[0].You {
		t.Fatalf("a party member in reach: %+v %+v", st.Context, st.Hunt)
	}
	board, err := s.l.Hunts(ctx)
	if err != nil || len(board.Hunts) != 1 || board.Hunts[0].ID != x.H.ID || len(board.Hunts[0].Pressers) != 1 {
		t.Fatalf("the hunts board: %+v %v", board, err)
	}
}

// TestPartyWindowClock closes a pick window only as its clock: chat and
// a seat are refused, and the gateway's write, which names no row
// version, is stamped on the service's clock and refused until due.
func TestPartyWindowClock(t *testing.T) {
	ctx := context.Background()
	s := newSeeing(t)
	g := s.g
	host := s.l.Host()
	a, b := s.create(), s.create()
	s.partyOf(a, b)
	sh := testkit.PartyMachineBeat(t, g, []*game.Char{a, b}, puzzle.Rewire, 2)
	st, _ := s.view(a, api.Viewer{})
	if _, ref := s.act(a, api.ActionRequest{Kind: api.ActPartyPick, Option: nonMachine(t, st)}); ref != nil {
		t.Fatal(ref)
	}
	ws, _ := host.Windows(ctx)
	if len(ws) != 1 {
		t.Fatalf("windows %+v", ws)
	}
	closeReq := api.ActionRequest{InteractionID: "pw-" + sh.ID + "-1", CharacterID: ws[0].Character, Kind: api.ActPartyWindow, Target: sh.ID}
	if _, ref, _ := s.l.Act(ctx, closeReq); ref == nil || ref.Code != api.CodeForbidden {
		t.Fatalf("a pick window closed from chat: %+v", ref)
	}
	if _, ref, _ := host.Act(ctx, closeReq, true); ref == nil || ref.Code != api.CodeForbidden {
		t.Fatalf("a pick window closed by a seat: %+v", ref)
	}
	if _, ref, _ := host.Act(ctx, closeReq, false); ref == nil || ref.Code != api.CodeNotDue {
		t.Fatalf("a pick window closed early: %+v", ref)
	}
	s.now = s.now.Add(time.Duration(g.PartyWindowMs()) * time.Millisecond)
	closeReq.InteractionID += "-due"
	rep, ref, err := host.Act(ctx, closeReq, false)
	if err != nil || ref != nil || len(rep.Pressed) != 2 {
		t.Fatalf("the window's close: %+v %+v %v", rep, ref, err)
	}
	if ws, _ := host.Windows(ctx); len(ws) != 0 {
		t.Fatalf("a window outlived its beat: %+v", ws)
	}
}
