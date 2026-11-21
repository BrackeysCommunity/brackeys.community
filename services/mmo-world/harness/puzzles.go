package harness

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/party"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/sheets"
)

// The Puzzles run: every family's move logs played at a tinker's bench,
// and every party version's merged logs played by a party, and the
// requests that carried them given to a second game, which must turn each
// log into the same fact (GDD 7.11, 18.4).

// machineClock is the service's clock when a machine game starts, unix
// ms. Any moment does; a countdown only ever reads the time between two.
const machineClock = 1_700_000_000_000

// machines is a fresh game played through the service's own action path,
// on a clock its driver steps, and everything it was given.
type machines struct {
	book  *sheets.Book
	label string
	g     *game.Game
	l     *service.Local
	clock int64
	n     int
	steps []step
}

// step is one thing a machine game was given: a request and the clock the
// service read for it, a tick, or state its driver planted by hand.
type step struct {
	req   *api.ActionRequest
	clock int64
	reply api.ActionReply
	plant func(*machines) error
}

func newMachines(b *sheets.Book, label string) (*machines, error) {
	r, err := game.NewRules(b, keys.Throwaway(label))
	if err != nil {
		return nil, err
	}
	g, err := game.New(r)
	if err != nil {
		return nil, err
	}
	m := &machines{book: b, label: label, g: g, l: service.NewLocal(g), clock: machineClock}
	m.l.Now = func() time.Time { return time.UnixMilli(m.clock) }
	return m, nil
}

// send gives the game a new request for its character at the clock as it
// stands. A refusal is an error: nothing here should be refused.
func (m *machines) send(req api.ActionRequest) (api.ActionReply, error) {
	m.n++
	req.InteractionID = fmt.Sprintf("%s-%d", m.label, m.n)
	if c := m.g.Char(req.CharacterID); c != nil {
		req.Version = c.Version
	}
	return m.give(step{req: &req, clock: m.clock})
}

// create makes a character for a new Discord user.
func (m *machines) create() (*game.Char, error) {
	rep, err := m.send(api.ActionRequest{Kind: api.ActCreate, DiscordID: fmt.Sprintf("%s-u%d", m.label, m.n), Option: api.StartKnife})
	if err != nil {
		return nil, err
	}
	return m.g.Char(rep.Character.ID), nil
}

// give plays one step and keeps it.
func (m *machines) give(s step) (api.ActionReply, error) {
	switch {
	case s.plant != nil:
		if err := s.plant(m); err != nil {
			return api.ActionReply{}, err
		}
	case s.req == nil:
		if err := m.l.Advance(); err != nil {
			return api.ActionReply{}, err
		}
	default:
		m.clock = s.clock
		act := m.l.Act
		if api.ActivityOnly(s.req.Kind) {
			act = func(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
				return m.l.Host().Act(ctx, req, true)
			}
		}
		rep, ref, err := act(context.Background(), *s.req)
		if err != nil {
			return rep, err
		}
		if ref != nil {
			return rep, fmt.Errorf("%s: %s was refused: %s: %s", m.label, s.req.Kind, ref.Code, ref.Message)
		}
		s.reply = rep
	}
	m.steps = append(m.steps, s)
	return s.reply, nil
}

func (m *machines) tick() error {
	_, err := m.give(step{})
	return err
}

// plant changes the game by hand, as a test sets a scene, and keeps the
// change so a replay makes it at the same point.
func (m *machines) plant(f func(*machines) error) error {
	_, err := m.give(step{plant: f})
	return err
}

// again gives everything this game was given, in order and on the same
// clock readings, to a second fresh game under the same keys.
func (m *machines) again() (*machines, error) {
	out, err := newMachines(m.book, m.label)
	if err != nil {
		return nil, err
	}
	for _, s := range m.steps {
		if _, err := out.give(step{req: s.req, clock: s.clock, plant: s.plant}); err != nil {
			return nil, fmt.Errorf("replay: %w", err)
		}
	}
	return out, nil
}

// same reports how a replay differs from the game it replays: a reply
// (the character, the facts, the fact the log became) or the digest. It
// returns the digest both games ended on.
func (m *machines) same(o *machines) (canon.Sum, error) {
	if len(m.steps) != len(o.steps) {
		return canon.Sum{}, fmt.Errorf("%s: %d steps replayed as %d", m.label, len(m.steps), len(o.steps))
	}
	for i, s := range m.steps {
		if s.req == nil {
			continue
		}
		a, err := json.Marshal(s.reply)
		if err != nil {
			return canon.Sum{}, err
		}
		b, err := json.Marshal(o.steps[i].reply)
		if err != nil {
			return canon.Sum{}, err
		}
		if !bytes.Equal(a, b) {
			return canon.Sum{}, fmt.Errorf("%s: %s %s gave\n%s\nand replayed gave\n%s", m.label, s.req.Kind, s.req.InteractionID, a, b)
		}
	}
	d1, err := m.g.Digest()
	if err != nil {
		return canon.Sum{}, err
	}
	d2, err := o.g.Digest()
	if err != nil {
		return canon.Sum{}, err
	}
	if d1 != d2 {
		return canon.Sum{}, fmt.Errorf("%s: digest %s replayed as %s", m.label, d1, d2)
	}
	return d1, nil
}

// solving is the kit's own solve of the machine a character has before
// it, and half of it: a log that stops short.
func (m *machines) solving(c *game.Char, v game.Viewer) (rig game.Rig, whole, half puzzle.Log, err error) {
	rig, ok := m.g.Rig(c, v)
	if !ok {
		return rig, whole, half, fmt.Errorf("%s: %s has no %s to work", m.label, c.C.ID, v.Family)
	}
	whole = m.g.Puzzles().Solve(rig.Layout)
	half = puzzle.Log{Moves: whole.Moves[:len(whole.Moves)/halfLog]}
	return rig, whole, half, nil
}

// halfLog cuts a solve short: its first half.
const halfLog = 2

// benchLog is one log a family was given at the bench.
type benchLog struct {
	name string
	step int
	log  puzzle.Log
}

// benchPlay is a family's bench logs in a first game and in its replay.
type benchPlay struct {
	family        string
	logs          []benchLog
	first, second *machines
	digest        canon.Sum // the one both games ended on
}

// benchReplay plays a family at the bench of a fresh game: the kit's own
// solve at every level the bench offers a newcomer, then half a solve.
// It then replays the game and fails unless the replay is the same.
func benchReplay(b *sheets.Book, family string) (benchPlay, error) {
	out := benchPlay{family: family}
	m, err := newMachines(b, "puzzles-"+family)
	if err != nil {
		return out, err
	}
	c, err := m.create()
	if err != nil {
		return out, err
	}
	bench, ok := m.g.BenchAt(c)
	if !ok {
		return out, fmt.Errorf("%s: no tinker's bench stands open where a character starts", m.label)
	}
	var top int64
	for _, r := range m.g.BenchRigs(c, bench) {
		if r.Family == family {
			top = r.MaxLevel
		}
	}
	if top == 0 {
		return out, fmt.Errorf("%s: the bench does not offer %s", m.label, family)
	}
	play := func(name string, level int64, cut bool) error {
		_, log, half, err := m.solving(c, game.Viewer{Family: family, Level: level})
		if err != nil {
			return err
		}
		if cut {
			log = half
		}
		rep, err := m.send(api.ActionRequest{Kind: api.ActBenchSolve, CharacterID: c.C.ID,
			Machine: &api.MachineIntent{Source: game.SourceBench, Family: family, Level: level, Log: service.LogOf(log)}})
		if err != nil {
			return err
		}
		if rep.Machine == nil || rep.Machine.Solved == cut {
			return fmt.Errorf("%s: %s: the bench made %+v of it", m.label, name, rep.Machine)
		}
		out.logs = append(out.logs, benchLog{name: name, step: len(m.steps) - 1, log: log})
		return nil
	}
	for level := int64(1); level <= top; level++ {
		if err := play(fmt.Sprintf("level %d, the kit's solve", level), level, false); err != nil {
			return out, err
		}
	}
	if err := play(fmt.Sprintf("level %d, half a solve", top), top, true); err != nil {
		return out, err
	}
	if err := m.tick(); err != nil {
		return out, err
	}
	again, err := m.again()
	if err != nil {
		return out, err
	}
	out.first, out.second = m, again
	out.digest, err = m.same(again)
	return out, err
}

// partyLevel is the level a party machine is played at, and partyTries
// how many tiles a family's party is stood on to meet each of its
// versions, which the arming draws by place.
const (
	partyLevel = 3
	partyTries = 12
)

// partyPlay is one family's party machines at every party size, in a
// first game and its replay.
type partyPlay struct {
	family        string
	logs          []partyLog
	first, second *machines
	digest        canon.Sum
}

// partyLog is one merged log a party sent: the version and seats it was
// armed for.
type partyLog struct {
	benchLog
	version string
	seats   int64
}

// partyReplay plays every party version of a family at two to four seats
// through the service's action path, each merged log sent as one solve and
// then half of one, and fails unless a replay of the game is the same.
func partyReplay(b *sheets.Book, family string) (partyPlay, error) {
	out := partyPlay{family: family}
	m, err := newMachines(b, "puzzles-party-"+family)
	if err != nil {
		return out, err
	}
	most := sheets.IntParam(b.FightParams, "party-size-max")
	var cs []string
	for range most {
		c, err := m.create()
		if err != nil {
			return out, err
		}
		cs = append(cs, c.C.ID)
	}
	at := m.g.Char(cs[0]).C.At
	versions := puzzle.PartyVersions(family)
	met := map[string]bool{}
	play := func(seats int64, try int, cut bool) error {
		ids, here := cs[:seats], at
		if err := m.plant(func(m *machines) error {
			var party []*game.Char
			for _, id := range ids {
				c := m.g.Char(id)
				c.C.At, c.Worked, c.Long, c.Fight = here, max(c.Worked, 1), nil, nil
				party = append(party, c)
			}
			m.g.FacePartyMachine(party, family, partyLevel)
			return nil
		}); err != nil {
			return err
		}
		if _, err := m.send(api.ActionRequest{Kind: api.ActMachineArm, CharacterID: ids[0], Machine: &api.MachineIntent{Source: api.MachineParty}}); err != nil {
			return fmt.Errorf("%d seats on tile %d: %w", seats, try, err)
		}
		rig, ok := m.g.PartyRigOf(m.g.Char(ids[0]))
		if !ok || rig.Machine.Spec.Party == "" {
			return fmt.Errorf("%s: %d seats armed no party version: %+v", m.label, seats, rig.Machine)
		}
		version := rig.Machine.Spec.Party
		met[version] = true
		p := m.g.Puzzles()
		log := p.PartySolve(p.Make(rig.Machine.Spec))
		name := "the version's solve"
		if cut {
			log = puzzle.Log{Moves: log.Moves[:len(log.Moves)/halfLog]}
			name = "half a solve"
		}
		if try > 0 {
			name += fmt.Sprintf(" (tile %d)", try)
		}
		m.clock = rig.Machine.At + log.Stop()
		rep, err := m.send(api.ActionRequest{Kind: api.ActMachineSolve, CharacterID: ids[0], Machine: &api.MachineIntent{Source: api.MachineParty, Log: service.LogOf(log)}})
		if err != nil {
			return err
		}
		if rep.Machine == nil || rep.Machine.Solved == cut {
			return fmt.Errorf("%s: %s: the machine made %+v of it", m.label, name, rep.Machine)
		}
		out.logs = append(out.logs, partyLog{benchLog: benchLog{name: name, step: len(m.steps) - 1, log: log}, version: version, seats: seats})
		m.clock++
		return nil
	}
	for seats := int64(party.MinSize); seats <= most; seats++ {
		if err := play(seats, 0, false); err != nil {
			return out, err
		}
	}
	for try := 1; len(met) < len(versions) && try <= partyTries; try++ {
		at = at.Neighbour(try % hex.Directions)
		if err := play(party.MinSize, try, false); err != nil {
			return out, err
		}
	}
	if len(met) < len(versions) {
		return out, fmt.Errorf("%s: met %d of the family's %d versions on %d tiles", m.label, len(met), len(versions), partyTries+1)
	}
	if err := play(most, 0, true); err != nil {
		return out, err
	}
	if err := m.tick(); err != nil {
		return out, err
	}
	again, err := m.again()
	if err != nil {
		return out, err
	}
	out.first, out.second = m, again
	out.digest, err = m.same(again)
	return out, err
}

// PuzzlesRun is the Puzzles run: a move log replayed gives the same fact
// twice, for every family, played alone at the bench and by a party.
func PuzzlesRun(b *sheets.Book, out string, _ int) ([]Measured, error) {
	p := puzzleKit(b)
	families := p.All()
	plays := make([]benchPlay, len(families))
	if err := runParallel(len(families), func(i int) error {
		var err error
		plays[i], err = benchReplay(b, families[i])
		return err
	}); err != nil {
		return nil, err
	}
	var withParty []string
	for _, f := range families {
		if len(puzzle.PartyVersions(f)) > 0 {
			withParty = append(withParty, f)
		}
	}
	parties := make([]partyPlay, len(withParty))
	if err := runParallel(len(withParty), func(i int) error {
		var err error
		parties[i], err = partyReplay(b, withParty[i])
		return err
	}); err != nil {
		return nil, err
	}
	var doc lineDoc
	pr := doc.p
	pr("# Puzzles run")
	pr("")
	pr("Each of the %d families gets a fresh game under the throwaway key `puzzles-<family>`, played through the service's own action path. A new character at the first settlement's tinker's bench plays the kit's own solve at every level the bench offers a newcomer, then half a solve. The same requests are then given, in order and on the same clock, to a second fresh game. The run fails unless every reply (and so every fact) is the same in both and the two games end on the same digest.", len(families))
	pr("")
	pr("| Family | Log | Sent | First game | Second game |")
	pr("| --- | --- | --- | --- | --- |")
	for _, play := range plays {
		for _, l := range play.logs {
			pr("| %s | %s | %s | %s | %s |", play.family, l.name, logLine(l.log), became(play.first.steps[l.step].reply), became(play.second.steps[l.step].reply))
		}
		pr("| %s | the game's digest, a tick later | – | `%s` | `%s` |", play.family, play.digest, play.digest)
	}
	pr("")
	pr("## Party machines, merged logs")
	pr("")
	pr("Each of the %d families with a party version gets a fresh game under the throwaway key `puzzles-party-<family>`. Characters standing together face the family's machine at level %d, at %d to %d seats; the first seat arms it through the service's action path, which fixes the version, seats and shape, and sends the version's own merged log, every move naming its seat, as one solve; then half of one. The party is stood on more tiles until the arming has drawn every version of the family. The requests are given again, in order and on the same clock, to a second fresh game, which must give every reply and the digest again.",
		len(withParty), partyLevel, party.MinSize, sheets.IntParam(b.FightParams, "party-size-max"))
	pr("")
	pr("| Family | Version and seats | Log | Sent | First game | Second game |")
	pr("| --- | --- | --- | --- | --- | --- |")
	for _, play := range parties {
		for _, l := range play.logs {
			pr("| %s | %s, %d seats | %s | %s from %d seats | %s | %s |", play.family, l.version, l.seats, l.name, logLine(l.log), seatsMoved(l.log),
				became(play.first.steps[l.step].reply), became(play.second.steps[l.step].reply))
		}
		pr("| %s | – | the game's digest, a tick later | – | `%s` | `%s` |", play.family, play.digest, play.digest)
	}
	return nil, doc.save(out, "puzzles.md")
}

// puzzleKit is the puzzle sheets alone, for a run that only lists them.
func puzzleKit(b *sheets.Book) *puzzle.Puzzles {
	return puzzle.New(b, keys.Throwaway("puzzles").Generation)
}

// seatsMoved is how many seats a merged log has moves from.
func seatsMoved(l puzzle.Log) int {
	seats := map[int64]bool{}
	for _, mv := range l.Moves {
		seats[mv.Seat] = true
	}
	return len(seats)
}

func logLine(l puzzle.Log) string {
	if len(l.Moves) == 0 && l.End == 0 {
		return "no moves"
	}
	return fmt.Sprintf("%s %s, to %s ms", comma(int64(len(l.Moves))), either(len(l.Moves) == 1, "move", "moves"), comma(l.Stop()))
}

// became is what a reply says a move log turned into: the machine's
// result, and each fact with its data.
func became(rep api.ActionReply) string {
	parts := []string{"no result"}
	if r := rep.Machine; r != nil {
		switch {
		case r.Master:
			parts[0] = fmt.Sprintf("solved at %s ms, and the inner panel", comma(r.At))
		case r.Clean:
			parts[0] = fmt.Sprintf("solved clean at %s ms", comma(r.At))
		case r.Solved:
			parts[0] = fmt.Sprintf("solved at %s ms", comma(r.At))
		case r.Late:
			parts[0] = "not solved, late"
		default:
			parts[0] = "not solved"
		}
		if r.Haywire != "" {
			parts[0] += ", haywire " + r.Haywire
		}
	}
	if len(rep.Facts) == 0 {
		parts = append(parts, "no fact")
	}
	for _, f := range rep.Facts {
		var data []string
		for _, d := range f.Data {
			if d.S != "" {
				data = append(data, d.Key+" "+d.S)
			} else {
				data = append(data, fmt.Sprintf("%s %d", d.Key, d.N))
			}
		}
		parts = append(parts, fmt.Sprintf("`%s` (%s)", f.Kind, strings.Join(data, ", ")))
	}
	return strings.Join(parts, "; ")
}
