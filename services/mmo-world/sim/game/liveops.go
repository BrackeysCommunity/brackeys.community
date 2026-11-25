package game

import (
	"slices"

	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/tally"
)

// WhyStaged is why a server-staged hunt opened.
const WhyStaged = "staged"

// StageCmd is a staging order (GDD 14.4): the stager chooses these; the
// sheets decide the rest.
type StageCmd struct {
	Template   string  `json:"template"`          // liveops.templates
	Settlement int     `json:"settlement"`        // Place.N, run by the server's guild
	At         hex.Hex `json:"at"`                // in that settlement's region
	Hunt       string  `json:"hunt,omitempty"`    // fights.hunts, a hunt template's creature
	Contest    string  `json:"contest,omitempty"` // liveops.contests, a contest template's
	Pattern    string  `json:"pattern,omitempty"` // story.patterns, the pattern template's
	Opens      int64   `json:"opens,omitempty"`   // ticks from now, at most stage-lead-days
	Days       int64   `json:"days,omitempty"`    // 0: the template's
}

// LiveOps is every server-staged thing in the world. It is nil until the
// first staging and is never dropped after, so its presence says
// something has been staged.
type LiveOps struct {
	Stages []*Stage `json:"stages,omitempty"`
	Next   int64    `json:"next,omitempty"`
}

// Stage is one staging, from its order to its close.
type Stage struct {
	ID         string      `json:"id"` // st-<n>
	Template   string      `json:"template"`
	Kind       string      `json:"kind"` // contest, hardship, drop, hunt, fair, vault, pattern
	Server     string      `json:"server"`
	Role       string      `json:"role"` // admin, staff
	By         string      `json:"by"`   // the stager's character; it takes nothing
	Label      string      `json:"label"`
	Points     int64       `json:"points,omitempty"`
	Settlement int         `json:"settlement"`
	At         hex.Hex     `json:"at"`
	Opens      int64       `json:"opens"` // tick
	Ends       int64       `json:"ends"`  // tick
	Open       bool        `json:"open,omitempty"`
	Closed     bool        `json:"closed,omitempty"`
	Hunt       string      `json:"hunt,omitempty"` // the row; HuntID once open
	HuntID     string      `json:"huntId,omitempty"`
	Arc        string      `json:"arc,omitempty"`
	Contest    string      `json:"contest,omitempty"`
	Goals      []string    `json:"goals,omitempty"`
	Crates     int64       `json:"crates,omitempty"` // left
	Opened     tally.Tally `json:"opened,omitempty"` // character → crates opened
	Pattern    string      `json:"pattern,omitempty"`
	Board      string      `json:"board,omitempty"` // a pattern stage's board id
	Vault      *VaultState `json:"vault,omitempty"`
}

// VaultState is a competing vault's machine and who took it.
type VaultState struct {
	Family string `json:"family"`
	Level  int64  `json:"level"`
	Taken  string `json:"taken,omitempty"` // the winning shared context
}

// StageByID finds a stage, open, due or closed, or nil.
func (g *Game) StageByID(id string) *Stage {
	if g.Live == nil || id == "" {
		return nil
	}
	i := slices.IndexFunc(g.Live.Stages, func(st *Stage) bool { return st.ID == id })
	if i < 0 {
		return nil
	}
	return g.Live.Stages[i]
}

// cmdStage is the stage a character's command works on, whose staged
// context it is applied in: a crate's, an ended stage's, a vault's
// machine's, or a staged hunt's for a press on it. Nil for any other.
func (g *Game) cmdStage(cmd Command) *Stage {
	if g.Live == nil {
		return nil
	}
	switch cmd.Kind {
	case CrateOpen, StagingEnd, MachineArm, MachineSolve:
		return g.StageByID(cmd.Target)
	case HuntPress:
		if x := g.HuntByID(cmd.Target); x != nil {
			return g.StageByID(x.Stage)
		}
	}
	return nil
}
