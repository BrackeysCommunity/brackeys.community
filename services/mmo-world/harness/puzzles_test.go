package harness

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/internal/testkit"
	"jams.team/mmo-world/service"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/keys"
	"jams.team/mmo-world/sim/puzzle"
)

// stored is a request as the store keeps the command it became: a timed
// kind carries the clock it was stamped on, and nothing else carries time.
func stored(t *testing.T, s step) game.Command {
	t.Helper()
	cmd := game.Command{Key: s.req.InteractionID, Char: s.req.CharacterID, Kind: s.req.Kind, Option: s.req.Option}
	if game.Timed(cmd.Kind) {
		cmd.Now = s.clock
	}
	if s.req.Machine != nil {
		raw, err := json.Marshal(s.req.Machine)
		if err != nil {
			t.Fatal(err)
		}
		cmd.Machine = &game.MachineCmd{}
		if err := json.Unmarshal(raw, cmd.Machine); err != nil {
			t.Fatal(err)
		}
	}
	return cmd
}

func hasFact(rep api.ActionReply, kind string) bool {
	return slices.ContainsFunc(rep.Facts, func(f api.Fact) bool { return f.Kind == kind })
}

// TestMachineLogReplays works a machine of every family three ways on
// the service's clock: one character solves it, one sends half a solve,
// one lets the countdown run out. The requests replayed on the same clock
// readings give the same replies and digest, and the commands they
// became, given to a game with no clock at all, give that digest too.
func TestMachineLogReplays(t *testing.T) {
	book := testkit.Book(t)
	for _, family := range puzzleKit(book).All() {
		t.Run(family, func(t *testing.T) {
			t.Parallel()
			m, err := newMachines(book, "machine-replay-"+family)
			if err != nil {
				t.Fatal(err)
			}
			// arm puts a character on a machine beat and starts its
			// countdown.
			arm := func(level int64, compact bool) (*game.Char, game.Rig, puzzle.Log, puzzle.Log) {
				t.Helper()
				c, err := m.create()
				if err != nil {
					t.Fatal(err)
				}
				id := c.C.ID
				if err := m.plant(func(m *machines) error {
					testkit.MachineBeat(t, m.g, m.g.Char(id), family, level)
					return nil
				}); err != nil {
					t.Fatal(err)
				}
				rep, err := m.send(api.ActionRequest{Kind: api.ActMachineArm, CharacterID: id,
					Machine: &api.MachineIntent{Source: game.SourceBeat, Compact: compact}})
				if err != nil || !hasFact(rep, "machine.armed") {
					t.Fatalf("arming: %v, facts %+v", err, rep.Facts)
				}
				rig, whole, half, err := m.solving(c, game.Viewer{})
				if err != nil || rig.Armed == nil || rig.Armed.At != m.clock || rig.Spec.Compact != compact {
					t.Fatalf("armed at %d: %v, %+v", m.clock, err, rig.Armed)
				}
				return c, rig, whole, half
			}
			solve := func(c *game.Char, log puzzle.Log) api.ActionReply {
				t.Helper()
				rep, err := m.send(api.ActionRequest{Kind: api.ActMachineSolve, CharacterID: c.C.ID, Machine: &api.MachineIntent{Log: service.LogOf(log)}})
				if err != nil || rep.Machine == nil {
					t.Fatalf("solving: %v, %+v", err, rep)
				}
				return rep
			}

			c, _, whole, _ := arm(3, false)
			m.clock += whole.Stop() + 200
			if rep := solve(c, whole); !rep.Machine.Solved || !hasFact(rep, "puzzle.solved") {
				t.Fatalf("the kit's solve: %s", became(rep))
			}

			c, _, _, half := arm(2, true)
			m.clock += half.Stop() + 200
			if rep := solve(c, half); rep.Machine.Solved || rep.Machine.Late || rep.Machine.Haywire == "" || !hasFact(rep, "puzzle.haywire") {
				t.Fatalf("half a solve: %s", became(rep))
			}

			c, rig, _, _ := arm(1, false)
			m.clock += rig.Countdown + m.g.Puzzles().Grace() + 1
			if rep := solve(c, puzzle.Log{}); rep.Machine.Solved || !rep.Machine.Late || !hasFact(rep, "puzzle.haywire") {
				t.Fatalf("a countdown left to run out: %s", became(rep))
			}

			// An alarm reaches the world at the next tick.
			if err := m.tick(); err != nil {
				t.Fatal(err)
			}
			again, err := m.again()
			if err != nil {
				t.Fatal(err)
			}
			if _, err := m.same(again); err != nil {
				t.Fatal(err)
			}

			g, err := game.New(testkit.Rules(t, book, keys.Throwaway(m.label)))
			if err != nil {
				t.Fatal(err)
			}
			bare := &machines{book: book, label: m.label, g: g}
			for _, s := range m.steps {
				switch {
				case s.plant != nil:
					err = s.plant(bare)
				case s.req == nil:
					_, err = g.Advance()
				default:
					_, err = g.Act(stored(t, s))
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			want, _ := m.g.Digest()
			if got, _ := g.Digest(); got != want {
				t.Fatalf("the stored commands gave digest %s, the game they came from %s", got, want)
			}
		})
	}
}

// TestPuzzlesRun reads what the run writes: for every family, each log's
// fact twice and the two games' digests, the same on both sides.
func TestPuzzlesRun(t *testing.T) {
	book, dir := testkit.Book(t), t.TempDir()
	if _, err := PuzzlesRun(book, dir, 0); err != nil {
		t.Fatal(err)
	}
	doc, err := os.ReadFile(filepath.Join(dir, "puzzles.md"))
	if err != nil {
		t.Fatal(err)
	}
	solved, short, digests := map[string]int{}, map[string]int{}, map[string]int{}
	for _, line := range strings.Split(string(doc), "\n") {
		cells := strings.Split(line, " | ")
		if len(cells) != 5 || strings.HasPrefix(line, "| Family") || strings.HasPrefix(line, "| ---") {
			continue
		}
		family, first, second := strings.TrimPrefix(cells[0], "| "), cells[3], strings.TrimSuffix(cells[4], " |")
		if first != second {
			t.Errorf("%s, %s: %s, replayed as %s", family, cells[1], first, second)
		}
		switch {
		case strings.Contains(first, "`bench.solved`"):
			solved[family]++
		case strings.Contains(first, "not solved; no fact"):
			short[family]++
		default:
			digests[family]++
		}
	}
	for _, family := range puzzleKit(book).All() {
		if solved[family] < 1 || short[family] != 1 || digests[family] != 1 {
			t.Errorf("%s: %d solves, %d logs cut short, %d digest rows", family, solved[family], short[family], digests[family])
		}
	}
}
