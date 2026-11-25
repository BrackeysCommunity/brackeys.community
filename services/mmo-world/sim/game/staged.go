package game

import (
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
)

// Staged facts (GDD 14.5 rule 6): a fact an operator's command, a staged
// hunt or arc, placed content or a staged cause made is marked as it is
// written, before it is hashed, so the mark is in the chain and a replay
// of the recorded commands makes it again. No trace counts a marked fact.

// structural: who a stamp names.
const (
	stampOperator = "operator"
	stampServer   = "server"
	stampFact     = "fact"
)

// unstagedKinds are operator kinds that keep the world as it is rather
// than stage anything in it. A pin keeps the stamp the pin rules give it,
// and a designer's pin is the world's own.
var unstagedKinds = []string{ContentFreeze, SeasonStart, SeasonEpoch, EmergenceStart, PinReserve, PinEdit, PinWithdraw, Rename, CaseClose}

// stagingFor stamps the facts a command writes while it is applied, and
// notes whether it is a character's own; the func it returns puts back
// what was before, so a nested call is harmless.
func (g *Game) stagingFor(cmd Command) func() {
	if g.Emergence == nil {
		return func() {}
	}
	was, wasOwn := g.stagedBy, g.ownCmd
	g.stagedBy, g.ownCmd = g.stampOf(cmd), !passive(cmd.Kind)
	return func() { g.stagedBy, g.ownCmd = was, wasOwn }
}

// stampOf is a command's stamp: a server's for its staging and pins, the
// stage's server's for work on a stage, an operator kind's own, or a press
// on an operator's hunt; nil for any other.
func (g *Game) stampOf(cmd Command) *fact.Ref {
	switch cmd.Kind {
	case Staging, HousePin, HouseUnpin:
		if cmd.Server != "" {
			return serverStamp(cmd.Server)
		}
	case StagingEnd, CrateOpen, MachineArm, MachineSolve, HuntPress:
		if st := g.cmdStage(cmd); st != nil {
			return serverStamp(st.Server)
		}
	}
	switch {
	case Operator(cmd.Kind) && !slices.Contains(unstagedKinds, cmd.Kind):
		return &fact.Ref{Kind: stampOperator, ID: cmd.Kind}
	case cmd.Kind == HuntPress && g.huntStaged(cmd.Target):
		return &fact.Ref{Kind: stampOperator, ID: HuntStart}
	}
	return nil
}

// huntStaged reports whether a live hunt was opened by an operator, or for
// an arc an operator cast.
func (g *Game) huntStaged(id string) bool {
	x := g.HuntByID(id)
	if x == nil {
		return false
	}
	if x.Why == WhyOperator {
		return true
	}
	if g.Story == nil {
		return false
	}
	return slices.ContainsFunc(g.Story.Arcs, func(a *Arc) bool { return a.Hunt == id && a.By == ByOperator })
}

// stage is the log's Stage hook: it stamps a fact that is staged and keeps
// its id in the staged-kept ring, so the facts it causes are stamped too;
// any other fact a player caused is noted for the measures.
func (g *Game) stage(f *fact.Fact) {
	e := g.Emergence
	if e == nil {
		return
	}
	if f.StagedBy == nil {
		f.StagedBy = g.stampFor(f)
	}
	if f.StagedBy != nil {
		e.MarkStaged(f.ID, g.r.Emerge.P.StagedKept)
		return
	}
	if g.ownCmd || namesCharacter(*f) || slices.ContainsFunc(f.Causes, func(id fact.ID) bool { return g.playerFacts[id] }) {
		if g.playerFacts == nil {
			g.playerFacts = map[fact.ID]bool{}
		}
		g.playerFacts[f.ID] = true
	}
}

// stampFor is the stamp a fact takes from its command, its subjects, its
// tile or a cause; nil when nothing staged it.
func (g *Game) stampFor(f *fact.Fact) *fact.Ref {
	if g.stagedBy != nil {
		s := *g.stagedBy
		return &s
	}
	if g.Live != nil {
		for _, ref := range f.Subjects {
			if s := g.serverStaged(ref); s != nil {
				return s
			}
		}
	}
	for _, ref := range f.Subjects {
		switch ref.Kind {
		case kindHunt:
			if g.huntStaged(ref.ID) {
				return &fact.Ref{Kind: stampOperator, ID: HuntStart}
			}
		case kindArc:
			if g.Story != nil {
				if a := g.arcByID(ref.ID); a != nil && a.By == ByOperator {
					return &fact.Ref{Kind: stampOperator, ID: ArcCast}
				}
			}
		}
	}
	if h, ok := fact.HexOf(*f); ok {
		if p := g.Placed(h); p != nil {
			return &fact.Ref{Kind: stampServer, ID: p.Server}
		}
	} else {
		for _, ref := range f.Subjects {
			if ref.Kind != renownCharacter {
				continue
			}
			if c := g.Char(ref.ID); c != nil {
				if p := g.Placed(c.C.At); p != nil {
					return &fact.Ref{Kind: stampServer, ID: p.Server}
				}
			}
		}
	}
	for _, id := range f.Causes {
		if g.Emergence.IsStaged(id) {
			return &fact.Ref{Kind: stampFact, ID: strconv.FormatInt(int64(id), decimal)}
		}
	}
	return nil
}

// serverStaged is the stamp of the server whose stage a subject is or
// belongs to: the stage, its hunt, its arc or its contest; nil for any
// other.
func (g *Game) serverStaged(ref fact.Ref) *fact.Ref {
	id := ""
	switch ref.Kind {
	case kindStage:
		id = ref.ID
	case kindHunt:
		if x := g.HuntByID(ref.ID); x != nil {
			id = x.Stage
		}
	case kindArc:
		if g.Story != nil {
			if a := g.arcByID(ref.ID); a != nil {
				id = a.Staging
			}
		}
	case kindGoal:
		if x := g.GoalOf(ref.ID); x != nil && x.Issuer.Kind == goal.ByStaged {
			id = x.Issuer.ID
		}
	}
	if st := g.StageByID(id); st != nil {
		return serverStamp(st.Server)
	}
	return nil
}

func serverStamp(server string) *fact.Ref { return &fact.Ref{Kind: stampServer, ID: server} }

// structural: the ref kinds a staged hunt, arc, stage and goal are named by.
const (
	kindHunt  = "hunt"
	kindArc   = "arc"
	kindStage = "stage"
	kindGoal  = "goal"
)

// namesCharacter reports whether a fact names a character among its
// subjects.
func namesCharacter(f fact.Fact) bool {
	return slices.ContainsFunc(f.Subjects, func(r fact.Ref) bool { return r.Kind == renownCharacter })
}

// byPlayer reports whether a fact has a player in its causes (GDD 13.5): it
// names a character, was written while a character's own command was
// applied, or names as a cause a fact of the same command or tick that
// was.
func (g *Game) byPlayer(f fact.Fact) bool { return namesCharacter(f) || g.playerFacts[f.ID] }
