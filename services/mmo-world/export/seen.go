package export

import (
	"encoding/json"
	"fmt"

	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/game"
)

// SeenKey is the key of a stored reply that holds what its command's
// character faced before it. The reply a client gets never carries it.
const SeenKey = "seen"

// Seen is what a command's character faced before the command: the beat's
// options with their bands, and the machine it worked. The rules compute
// both on demand and keep neither, so the export reads them from here.
type Seen struct {
	Beat    *BeatSeen    `json:"beat,omitempty"`
	Machine *MachineSeen `json:"machine,omitempty"`
}

// BeatSeen is a beat as the character faced it. Encounter is the
// encounter's or hunt's id, for joining a party's picks; it never leaves
// the store.
type BeatSeen struct {
	What      string       `json:"what"` // fight, theft or hunt
	Encounter string       `json:"encounter"`
	Beat      int64        `json:"beat"` // 1-based; 0 on a hunt
	Beats     int64        `json:"beats"`
	Kind      string       `json:"kind"`
	Tier      int64        `json:"tier"`
	Party     int64        `json:"party"`
	Floor     int64        `json:"floor,omitempty"`
	Ambush    bool         `json:"ambush,omitempty"`
	Offered   []OptionSeen `json:"offered"`
}

// OptionSeen is an option offered, as its card showed it.
type OptionSeen struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Band     string `json:"band"`
	Risk     string `json:"risk,omitempty"`
	RiskSize int64  `json:"riskSize,omitempty"`
	Puzzle   bool   `json:"puzzle,omitempty"`
}

// MachineSeen is a machine as it was armed: a bench's has no countdown.
type MachineSeen struct {
	Source    string `json:"source"`
	Family    string `json:"family"`
	Level     int64  `json:"level"`
	Tier      int64  `json:"tier"`
	Practice  int64  `json:"practice"`
	Countdown int64  `json:"countdown"` // ms
	Party     int64  `json:"party"`     // seats
	Tick      int64  `json:"tick"`      // armed at
}

// Before reads what cmd's character faces before cmd is applied, for the
// kinds the export records; nil for any other. It changes nothing.
func Before(g *game.Game, cmd game.Command) *Seen {
	c := g.Char(cmd.Char)
	if c == nil {
		return nil
	}
	var s Seen
	switch cmd.Kind {
	case game.Press, game.PartyPick:
		s.Beat = fightSeen(g, c)
	case game.HuntPress:
		s.Beat = huntSeen(g, c, cmd.Target)
	case game.MachineSolve:
		s.Beat, s.Machine = fightSeen(g, c), armedSeen(g, c)
	case game.BenchSolve:
		if m := cmd.Machine; m != nil {
			s.Machine = &MachineSeen{Source: game.SourceBench, Family: m.Family, Level: m.Level, Practice: c.C.Level(m.Family), Party: 1, Tick: g.Tick()}
		}
	}
	if s.Beat == nil && s.Machine == nil {
		return nil
	}
	return &s
}

func fightSeen(g *game.Game, c *game.Char) *BeatSeen {
	if c.Fight == nil || c.Fight.E == nil {
		return nil
	}
	v := g.Choose(c).Fight
	if v == nil {
		return nil
	}
	e := c.Fight.E
	b := &BeatSeen{What: "fight", Encounter: e.ID, Beat: int64(v.Beat) + 1, Beats: int64(v.Beats), Kind: v.Kind, Tier: e.Creature.Tier,
		Party: 1, Floor: e.Floor, Ambush: v.Ambush, Offered: offered(g, v.Options)}
	if c.Fight.Theft != nil {
		b.What = "theft"
	}
	if sh := g.SharedByID(c.Fight.Shared); sh != nil {
		b.Party = int64(len(sh.Members))
	}
	return b
}

func huntSeen(g *game.Game, c *game.Char, id string) *BeatSeen {
	x := g.HuntByID(id)
	if x == nil || x.H == nil {
		return nil
	}
	_, opts := g.HuntOptions(c, x)
	return &BeatSeen{What: "hunt", Encounter: x.H.ID, Kind: "hunt", Tier: x.H.Creature.Tier, Party: 1, Offered: offered(g, opts)}
}

func offered(g *game.Game, opts []fight.Option) []OptionSeen {
	out := make([]OptionSeen, len(opts))
	for i, o := range opts {
		out[i] = OptionSeen{ID: o.ID, Kind: o.Kind, Band: g.BandName(o.Band), Risk: o.Risk, RiskSize: o.RiskSize, Puzzle: o.Puzzle}
	}
	return out
}

// armedSeen is the machine c's solve is played against: its own, or its
// party's.
func armedSeen(g *game.Game, c *game.Char) *MachineSeen {
	if a := c.Armed; a != nil {
		return &MachineSeen{Source: a.Source, Family: a.Spec.Family, Level: a.Spec.Level, Tier: a.Spec.Tier, Practice: a.Practice,
			Countdown: a.Countdown, Party: 1, Tick: a.Tick}
	}
	sh := g.SharedOf(c)
	if sh == nil || !sh.Machine.Armed() {
		return nil
	}
	m := sh.Machine
	return &MachineSeen{Source: m.Source, Family: m.Spec.Family, Level: m.Spec.Level, Tier: m.Spec.Tier, Practice: m.Practice,
		Countdown: m.Countdown, Party: int64(len(m.Seats)), Tick: m.Tick}
}

// Stored is a reply body with s kept under SeenKey, for the store; body
// itself when s is nil.
func Stored(body []byte, s *Seen) ([]byte, error) {
	if s == nil {
		return body, nil
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, fmt.Errorf("export: a reply that is not an object: %w", err)
	}
	b, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	m[SeenKey] = b
	return json.Marshal(m)
}
