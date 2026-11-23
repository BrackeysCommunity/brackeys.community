package game

import (
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
)

// KindName is a kind's first maker naming it, once, within the rename
// days of its discovery (GDD 9.10): Option names the kind, Note the name.
const KindName = "kind-name"

// CanNameKind is the kind viewer may name now, or why not.
func (g *Game) CanNameKind(id, viewer string) (*item.Kind, error) {
	k, frozen := g.Kinds.Kind(id)
	_, made := g.Kinds.madeAt(id)
	switch {
	case !frozen || !made:
		return nil, refuse(NoSuchRow, "no kind %q to name", id)
	case viewer == "" || k.FirstMaker != viewer:
		return nil, refuse(NotFirst, "only %s's first maker names it", g.Kinds.Name(id))
	case g.Kinds.given(id):
		return nil, refuse(Named, "it is named %s", g.Kinds.Name(id))
	case g.Tick() >= k.Discovered+g.r.Emerge.P.RenameDays*sheets.TicksPerDay:
		return nil, refuse(NameClosed, "%s could be named for %d days", g.Kinds.Name(id), g.r.Emerge.P.RenameDays)
	}
	return k, nil
}

// kindName gives a kind its first maker's own name over the plain one,
// screened as a promotion's is. It writes no fact; a refusal changes
// nothing.
func (g *Game) kindName(c *Char, cmd Command) error {
	k, err := g.CanNameKind(cmd.Option, c.C.ID)
	if err != nil {
		return err
	}
	name, err := g.screenName(cmd.Note)
	if err != nil {
		return err
	}
	g.Kinds.Give(k.ID, name)
	return nil
}
