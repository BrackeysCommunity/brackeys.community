package harness

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
	"jams.team/mmo-world/harness/agent"
	"jams.team/mmo-world/internal/envvar"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
)

// The delve run (GDD 4.9, 7.5, 7.6, 7.11): on a live, disposable world, a
// scripted party of four walks to a seven-floor bunker and goes down it
// floor by floor through the action endpoint, working its machines
// together through the Activity socket, every seat streaming its own
// moves; and ten scripted hunters press a hunt the operator opens beside
// the first settlement until it falls.

func init() { Runs["delve"] = DelveRun }

const (
	// delveKind and delveFloors are the dungeon the party goes down.
	delveKind   = "bunker"
	delveFloors = 7
	// delveSearch is how far from the first settlement it is looked for.
	delveSearch = 120
	// delveMachines is the fewest machines the party must work together.
	delveMachines = 3
	// delveName is what the first slayers call the bunker.
	delveName = "The Seventh Stair"
	// delveWait is how long the run gives the party and the hunters,
	// unless -n names the minutes.
	delveWait = 45 * time.Minute
	// turnGap is the pause between two rounds of turns.
	turnGap = 700 * time.Millisecond
	// staleTries is how often an arming refused stale is sent again.
	staleTries = 3
	// localMaster is where a world started by the bot's local-world script
	// keeps its master secret, under the repository's root.
	localMaster = "services/mmo-bot/out/local/master"
	localWorld  = "w-local"
)

// liveKeys are a disposable world's keys, which the run needs to find a
// seven-floor bunker: floors are never shown. MMO_MASTER_SECRET when set,
// else the local world's own.
func liveKeys(b *sheets.Book) (*game.Rules, error) {
	if os.Getenv(service.EnvMaster) == "" {
		body, err := os.ReadFile(filepath.Join(sheetfs.ModuleRoot(), "..", "..", localMaster))
		if err != nil {
			return nil, fmt.Errorf("the run needs the world's keys: set %s, or start the world with the local-world script: %w", service.EnvMaster, err)
		}
		_ = os.Setenv(service.EnvMaster, strings.TrimSpace(string(body)))
		if os.Getenv(service.EnvWorld) == "" {
			_ = os.Setenv(service.EnvWorld, localWorld)
		}
	}
	if os.Getenv(service.EnvEpoch) == "" {
		_ = os.Setenv(service.EnvEpoch, "0")
	}
	sec, err := service.SecretsFromEnv()
	if err != nil {
		return nil, err
	}
	return game.NewRules(b, sec.Keys)
}

// liveDelve is the run's state: the world, the bunker, the party and the
// hunters, and what each did.
type liveDelve struct {
	w        *liveWorld
	r        *game.Rules
	bunker   hex.Hex
	huntAt   hex.Hex
	party    []*member
	hunters  []*member
	mu       sync.Mutex
	n        int
	machines []partyMachine
	worked   map[string]bool
	entries  int
	named    string
	deepest  int64
	notes    []string
	card     api.HuntCard
}

// member is one scripted character: its Discord user, its character and,
// once it joins the Activity, its seat.
type member struct {
	discord, char, name string
	seat                *seat
}

// partyMachine is one machine the party worked together.
type partyMachine struct {
	source, family, version string
	seats, moves            int
	solved                  bool
	at                      int64
}

func (d *liveDelve) id(who string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.n++
	return fmt.Sprintf("%s-%s-%d", d.w.run, who, d.n)
}

func (d *liveDelve) note(f string, a ...any) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.notes = append(d.notes, fmt.Sprintf(f, a...))
}

// act sends one action for a character at its current version.
func (d *liveDelve) act(ctx context.Context, m *member, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	o, err := d.w.api.Options(ctx, m.char)
	if err != nil {
		return api.ActionReply{}, nil, err
	}
	req.InteractionID, req.CharacterID, req.Version = d.id(m.char), m.char, o.Version
	return d.w.api.Act(ctx, req)
}

// must is act for an action that must be taken.
func (d *liveDelve) must(ctx context.Context, m *member, req api.ActionRequest) (api.ActionReply, error) {
	rep, ref, err := d.act(ctx, m, req)
	return rep, client.Refused(req.Kind, ref, err)
}

// DelveRun plays the delve run and writes delve.md; n, when set, is the
// minutes it is given. The world must be disposable, with dev sign-in on
// and the operator's paths open.
func DelveRun(b *sheets.Book, out string, n int) ([]Measured, error) {
	activity := strings.TrimRight(os.Getenv(EnvActivityURL), "/")
	if activity == "" {
		return nil, errors.New(EnvActivityURL + " must name the world's Activity listener, such as http://localhost:18787")
	}
	base := envvar.Get(service.EnvURL, "http://localhost:8080")
	r, err := liveKeys(b)
	if err != nil {
		return nil, err
	}
	d := &liveDelve{r: r, worked: map[string]bool{}, w: &liveWorld{api: client.New(base, os.Getenv(service.EnvAPIToken)), op: client.New(base, os.Getenv(service.EnvOperatorToken)),
		activity: activity, kit: puzzleKit(b), run: strconv.FormatInt(time.Now().UnixMilli(), 36)}}
	home := r.Gen.Settlement(0).Hex
	var ok bool
	if d.bunker, ok = deepBunker(r.Gen, home); !ok {
		return nil, fmt.Errorf("no %d-floor %s within %d tiles of the first settlement", delveFloors, delveKind, delveSearch)
	}
	if d.huntAt, ok = passableBeside(r.Gen, home); !ok {
		return nil, errors.New("no passable land beside the first settlement")
	}
	wait := delveWait
	if n > 0 {
		wait = time.Duration(n) * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	started := time.Now()
	errs := make([]error, 2)
	var wg sync.WaitGroup
	wg.Go(func() { errs[0] = d.delve(ctx) })
	wg.Go(func() { errs[1] = d.hunt(ctx, b) })
	wg.Wait()
	for _, m := range slices.Concat(d.party, d.hunters) {
		if m.seat != nil {
			m.seat.close()
		}
	}
	report := d.write(b, base, time.Since(started))
	if err := report.save(out, "delve.md"); err != nil {
		return nil, err
	}
	return nil, errors.Join(slices.Concat(errs, d.unmet())...)
}

// deepBunker is the nearest bunker of seven floors to a settlement.
func deepBunker(g *gen.Gen, from hex.Hex) (hex.Hex, bool) {
	for r := int64(1); r <= delveSearch; r++ {
		for _, h := range hex.Ring(from, r) {
			if p, ok := g.Dungeon(h); ok && p.Kind == delveKind && p.Floors == delveFloors {
				return h, true
			}
		}
	}
	return hex.Hex{}, false
}

func passableBeside(g *gen.Gen, h hex.Hex) (hex.Hex, bool) {
	for _, n := range h.Neighbours() {
		if g.Passable(g.Baseline(n).Terrain) {
			return n, true
		}
	}
	return hex.Hex{}, false
}

func apiHex(h hex.Hex) api.Hex { return api.Hex{Q: h.Q, R: h.R} }

// newMember makes a character for a new scripted player.
func (d *liveDelve) newMember(ctx context.Context, who string) (*member, error) {
	discord, char, err := d.w.create(ctx, who)
	if err != nil {
		return nil, err
	}
	return &member{discord: discord, char: char, name: who}, nil
}

// delve forms the party, walks it to the bunker and takes it down.
func (d *liveDelve) delve(ctx context.Context) error {
	for i := range party4 {
		m, err := d.newMember(ctx, fmt.Sprintf("delver-%d", i))
		if err != nil {
			return err
		}
		d.party = append(d.party, m)
	}
	lead := d.party[0]
	for _, m := range d.party[1:] {
		if _, err := d.must(ctx, lead, api.ActionRequest{Kind: api.ActPartyInvite, Target: m.char}); err != nil {
			return err
		}
		if _, err := d.must(ctx, m, api.ActionRequest{Kind: api.ActPartyJoin, Target: lead.char}); err != nil {
			return err
		}
	}
	for _, m := range d.party {
		s, err := d.w.join(ctx, m.discord, api.Viewer{})
		if err != nil {
			return err
		}
		m.seat = s
	}
	if err := d.walk(ctx); err != nil {
		return err
	}
	v := agent.Delver{BandOrder: agent.Bands(d.r.Book)}
	for ctx.Err() == nil && d.named == "" {
		if err := d.round(ctx, v); err != nil {
			return err
		}
		time.Sleep(turnGap)
	}
	return nil
}

// walk takes every member to the bunker: by a journey where one is open,
// else a step at a time; an ambush on the way is fought.
func (d *liveDelve) walk(ctx context.Context) error {
	v := agent.Delver{BandOrder: agent.Bands(d.r.Book)}
	to := apiHex(d.bunker)
	for ctx.Err() == nil {
		there := 0
		for _, m := range d.party {
			o, err := d.w.api.Options(ctx, m.char)
			if err != nil {
				return err
			}
			if req, ok := v.Choose(o, nil); ok {
				if _, _, err := d.act(ctx, m, req); err != nil {
					return err
				}
				continue
			}
			switch {
			case o.At == to:
				there++
			case o.Long != nil || o.Fight != nil:
			default:
				if _, ref, err := d.act(ctx, m, api.ActionRequest{Kind: api.ActTravel, To: &to}); err != nil {
					return err
				} else if ref != nil {
					if req, ok := (agent.Hunter{}).Toward(o, to); ok {
						if _, _, err := d.act(ctx, m, req); err != nil {
							return err
						}
					}
				}
			}
		}
		if there == len(d.party) {
			return nil
		}
		time.Sleep(time.Second)
	}
	return fmt.Errorf("the party did not reach the bunker at %s: %w", d.bunker.Ref(), ctx.Err())
}

// round gives every member one turn in the bunker: the party's machine
// when one stands before it, a held pick, the fork, the leader's entry
// and, once the guardian falls to them first, its name.
func (d *liveDelve) round(ctx context.Context, v agent.Delver) error {
	if m, src, ok := d.machineAtRest(ctx); ok {
		return d.work(ctx, m, src)
	}
	for _, m := range d.party {
		o, err := d.w.api.Options(ctx, m.char)
		if err != nil {
			return err
		}
		st, err := d.w.api.Party(ctx, m.char)
		if err != nil {
			return err
		}
		if st.Floor != nil {
			d.deepest = max(d.deepest, st.Floor.Deepest)
		}
		switch {
		case o.Fight != nil && v.Machine(o.Fight):
			// The party works it from the Activity.
		case st.Floor != nil && v.WorkFork(st.Floor) && !d.worked[d.forkKey(st.Floor)]:
			d.worked[d.forkKey(st.Floor)] = true
			return d.work(ctx, m, api.MachineFork)
		case st.Floor != nil && len(st.Floor.Ways) > 0:
			if req, ok := v.Fork(st.Floor, nameOf(st)); ok {
				if _, _, err := d.act(ctx, m, req); err != nil {
					return err
				}
			}
		default:
			if req, ok := v.Choose(o, nil); ok {
				if _, _, err := d.act(ctx, m, req); err != nil {
					return err
				}
			}
		}
	}
	lead := d.party[0]
	o, err := d.w.api.Options(ctx, lead.char)
	if err != nil {
		return err
	}
	if req, ok := v.Enter(o); ok && o.At == apiHex(d.bunker) {
		if _, ref, err := d.act(ctx, lead, req); err != nil {
			return err
		} else if ref == nil {
			d.entries++
		}
	}
	if _, ref, err := d.act(ctx, lead, api.ActionRequest{Kind: api.ActDungeonName, Note: delveName}); err != nil {
		return err
	} else if ref == nil {
		d.named = delveName
	}
	return nil
}

// nameOf is the viewer's own name in its party state.
func nameOf(st api.PartyState) string {
	if st.Party == nil {
		return ""
	}
	for _, m := range st.Party.Members {
		if m.You {
			return m.Name
		}
	}
	return ""
}

// forkKey names a fork for this delve: its machine is worked once.
func (d *liveDelve) forkKey(f *api.FloorView) string {
	return fmt.Sprintf("%d/%s/%d", d.entries, f.Dungeon, f.Floor)
}

// machineAtRest is a member up in the party's encounter who sees a party
// machine at rest, not yet armed, and its source: the beat's or a
// guardian mark's.
func (d *liveDelve) machineAtRest(ctx context.Context) (*member, string, bool) {
	for _, m := range d.party {
		st, err := m.seat.look(ctx, api.Viewer{})
		if err != nil || slices.Contains(st.Character.Conditions, api.CondDown) {
			continue
		}
		if st.Machine != nil && !st.Machine.Armed && (st.Machine.Source == api.MachineParty || st.Machine.Source == api.MachineGuardian) {
			return m, st.Machine.Source, true
		}
		if st.Fight != nil && st.Fight.Shared && slices.ContainsFunc(st.Fight.Options, func(o api.Option) bool { return o.Puzzle }) && (st.Machine == nil || !st.Machine.Armed) {
			return m, api.MachineParty, true
		}
	}
	return nil, "", false
}

// work arms the party's machine from one member's seat, reassembles the
// whole machine from every seat's dealt view, and streams the version's
// own merged log, each move from the seat that makes it, on the pace its
// stamps say. The gateway judges it and sends the one solve.
func (d *liveDelve) work(ctx context.Context, by *member, src string) error {
	first := by.seat
	rep, err := first.intent(ctx, d.id("arm"), api.ActMachineArm, &api.MachineIntent{Source: src})
	// The seat's version moves with every other member's pick.
	for try := 0; err == nil && !rep.OK && rep.Refusal != nil && rep.Refusal.Code == api.CodeStale && try < staleTries; try++ {
		if _, err = first.look(ctx, api.Viewer{}); err == nil {
			rep, err = first.intent(ctx, d.id("arm"), api.ActMachineArm, &api.MachineIntent{Source: src})
		}
	}
	if err != nil {
		return err
	}
	if !rep.OK {
		if rep.Refusal != nil && rep.Refusal.Code == api.CodePartyNotSeated {
			for _, m := range d.party {
				if _, err := m.seat.look(ctx, api.Viewer{}); err != nil {
					return err
				}
			}
		}
		d.note("arming a %s machine was refused: %+v", src, rep.Refusal)
		return nil
	}
	var parts []puzzle.Layout
	views := map[int64]*seat{}
	var armed api.ActivityState
	for _, m := range d.party {
		st, err := m.seat.until("the armed party machine", func(st api.ActivityState) bool { return st.Machine != nil && st.Machine.Armed })
		if err != nil {
			// A member down or gone has no seat at it.
			continue
		}
		views[st.Machine.Seat] = m.seat
		parts = append(parts, service.LayoutOf(st.Machine.Layout))
		if armed.Machine == nil {
			armed = st
		}
	}
	if armed.Machine == nil {
		return errors.New("no seat saw the party's machine armed")
	}
	whole := reassemble(parts)
	log := d.w.kit.Solve(whole)
	if whole.Party != "" {
		log = d.w.kit.PartySolve(whole)
	}
	ahead := armed.Now - time.Now().UnixMilli()
	moves := service.LogOf(log).Moves
	slices.SortStableFunc(moves, func(a, b api.PuzzleMove) int { return cmp.Compare(a.At, b.At) })
	for _, mv := range moves {
		s := views[mv.Seat]
		if s == nil {
			return fmt.Errorf("the merged log has a move from seat %d, which no member holds", mv.Seat)
		}
		time.Sleep(time.Until(time.UnixMilli(armed.Machine.ArmedAt + mv.At - ahead)))
		m := mv
		if err := s.send(ctx, api.ClientMessage{T: api.FrameMove, Move: &m}); err != nil {
			return err
		}
	}
	done, err := first.untilWithin("the party machine's result", time.Duration(armed.Machine.Countdown+armed.Machine.Grace)*time.Millisecond+activityWait,
		func(st api.ActivityState) bool { return st.Last != nil && (st.Machine == nil || !st.Machine.Armed) })
	if err != nil {
		return err
	}
	d.mu.Lock()
	d.machines = append(d.machines, partyMachine{source: src, family: armed.Machine.Family, version: armed.Machine.Party, seats: len(views),
		moves: len(moves), solved: done.Last.Result.Solved, at: done.Last.Result.At})
	d.mu.Unlock()
	return nil
}

// reassemble is the whole machine from every seat's dealt view: each
// element any seat is shown, and each field a seat was dealt whole.
func reassemble(parts []puzzle.Layout) puzzle.Layout {
	out := parts[0]
	whole := reflect.ValueOf(&out).Elem()
	for _, p := range parts[1:] {
		merge(whole, reflect.ValueOf(p))
	}
	return out
}

// merge fills what dst holds unseen from src.
func merge(dst, src reflect.Value) {
	switch dst.Kind() {
	case reflect.Slice:
		if dst.IsNil() {
			if !src.IsNil() {
				dst.Set(reflect.AppendSlice(reflect.MakeSlice(src.Type(), 0, src.Len()), src))
			}
			return
		}
		dst.Set(reflect.AppendSlice(reflect.MakeSlice(dst.Type(), 0, dst.Len()), dst))
		for i := range min(dst.Len(), src.Len()) {
			merge(dst.Index(i), src.Index(i))
		}
	case reflect.Struct:
		for i := range dst.NumField() {
			if dst.Field(i).CanSet() {
				merge(dst.Field(i), src.Field(i))
			}
		}
	case reflect.Int64:
		if dst.Int() == puzzle.Unseen {
			dst.SetInt(src.Int())
		}
	}
}

// hunt opens a hunt beside the first settlement as the operator and has
// ten hunters press it, each through its own seat's hunt view and the
// action endpoint, until it closes.
func (d *liveDelve) hunt(ctx context.Context, b *sheets.Book) error {
	for i := range huntBand {
		m, err := d.newMember(ctx, fmt.Sprintf("hunter-%d", i))
		if err != nil {
			return err
		}
		d.hunters = append(d.hunters, m)
	}
	at := apiHex(d.huntAt)
	if _, ref, err := d.w.op.Operate(ctx, api.OperatorRequest{InteractionID: d.id("hunt-start"), Kind: api.OpHuntStart, Asset: delveHunt, To: &at,
		Note: "the delve proof run"}); err != nil {
		return err
	} else if err := client.Refused(api.OpHuntStart, ref, nil); err != nil {
		return err
	}
	id, err := d.huntID(ctx, at)
	if err != nil {
		return err
	}
	for _, m := range d.hunters {
		s, err := d.w.join(ctx, m.discord, api.Viewer{})
		if err != nil {
			return err
		}
		m.seat = s
	}
	h := agent.Hunter{BandOrder: agent.Bands(b)}
	for ctx.Err() == nil {
		board, err := d.w.api.Hunts(ctx)
		if err != nil {
			return err
		}
		i := slices.IndexFunc(board.Hunts, func(c api.HuntCard) bool { return c.ID == id })
		if i >= 0 && board.Hunts[i].Closed {
			d.card = board.Hunts[i]
			return nil
		}
		for _, m := range d.hunters {
			o, err := d.w.api.Options(ctx, m.char)
			if err != nil {
				return err
			}
			req, ok := h.Choose(o, nil)
			if !ok {
				st, err := m.seat.look(ctx, api.Viewer{})
				if err != nil {
					return err
				}
				if req, ok = h.Press(st.Hunt); !ok && st.Hunt == nil {
					req, ok = h.Toward(o, at)
				}
			}
			if ok {
				if _, _, err := d.act(ctx, m, req); err != nil {
					return err
				}
			}
		}
		time.Sleep(turnGap)
	}
	return fmt.Errorf("hunt %s did not close: %w", id, ctx.Err())
}

// huntID is the id of the open hunt on a tile, from the hunt board.
func (d *liveDelve) huntID(ctx context.Context, at api.Hex) (string, error) {
	board, err := d.w.api.Hunts(ctx)
	if err != nil {
		return "", err
	}
	for _, c := range board.Hunts {
		if c.At == at && !c.Closed && c.Row == delveHunt {
			return c.ID, nil
		}
	}
	return "", fmt.Errorf("no open %s hunt on %v after hunt-start", delveHunt, at)
}

// unmet are the proof's conditions the run did not meet.
func (d *liveDelve) unmet() []error {
	var out []error
	if d.deepest < delveFloors {
		out = append(out, fmt.Errorf("the party reached floor %d of %d", d.deepest, delveFloors))
	}
	together := 0
	for _, m := range d.machines {
		if m.seats > 1 {
			together++
		}
	}
	if together < delveMachines {
		out = append(out, fmt.Errorf("the party worked %d machines together, under %d", together, delveMachines))
	}
	if d.named == "" {
		out = append(out, errors.New("the bunker was not named"))
	}
	if _, ok := agent.Sum(d.card); !d.card.Slain || !ok || len(d.card.Pressers) < huntBand {
		out = append(out, fmt.Errorf("the hunt: slain %v by %d pressers, parts summing to the roll %v", d.card.Slain, len(d.card.Pressers), ok))
	}
	return out
}

// write is delve.md.
func (d *liveDelve) write(b *sheets.Book, base string, took time.Duration) *lineDoc {
	var doc lineDoc
	pr := doc.p
	pr("# A party through a bunker, and ten at a hunt, on a live world")
	pr("")
	pr("World at %s, Activity listener at %s, every member signed in by the dev sign-in with a socket of its own, all in one Activity instance. The run took %s.", base, d.w.activity, took.Round(time.Second))
	pr("")
	pr("## The bunker")
	pr("")
	pr("The nearest %s of %d floors to the first settlement, at %s, found from the world's own keys (floors are never shown). Four new characters form a party by invitation, follow their leader there, and go down: each beat's pick held through `/v1/actions` (`party-pick`), each fork's push the same way, and each machine armed from the first seat's socket and worked by every seat streaming its own moves of the version's merged log.", delveKind, delveFloors, d.bunker.Ref())
	pr("")
	pr("Deepest floor reached: %d of %d. Named: %s.", d.deepest, delveFloors, either(d.named != "", "\""+d.named+"\"", "no"))
	pr("")
	pr("| Machine | Family | Version | Seats | Moves | Result |")
	pr("| --- | --- | --- | --- | --- | --- |")
	for _, m := range d.machines {
		pr("| %s | %s | %s | %d | %d | %s |", m.source, m.family, either(m.version != "", m.version, "solo"), m.seats, m.moves, either(m.solved, fmt.Sprintf("solved at %s ms", comma(m.at)), "not solved"))
	}
	pr("")
	for _, n := range d.notes {
		pr("- %s", n)
	}
	pr("")
	pr("## The hunt")
	pr("")
	c := d.card
	paid, ok := agent.Sum(c)
	pr("`%s` opened by the operator on %v. %d pressers; %s.", delveHunt, d.huntAt.Ref(), len(c.Pressers), either(c.Slain, "slain", "left unfinished"))
	pr("")
	if c.Slain {
		var row *sheets.Hunt
		if i := slices.IndexFunc(b.Hunts, func(h sheets.Hunt) bool { return h.ID == delveHunt }); i >= 0 {
			row = &b.Hunts[i]
		}
		pr("| Material | Rolled | The row's most | Paid in parts |")
		pr("| --- | --- | --- | --- |")
		for _, g := range c.Rolled {
			most := int64(0)
			if row != nil {
				for _, s := range row.Spoils {
					if s.Material == g.Material {
						most = s.Quantity
					}
				}
			}
			pr("| %s | %d | %d | %d |", g.Material, g.Units, most, paid[g.Material])
		}
		pr("")
		pr("The parts sum to the roll: %s.", either(ok, "yes", "**no**"))
	}
	return &doc
}
