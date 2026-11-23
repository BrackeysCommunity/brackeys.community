package game

import (
	"cmp"
	"slices"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tally"
)

// DossierView is what a saved NPC brings to a conversation beyond its
// topics (GDD 4.18): who it is, the most salient of what it remembers of
// the viewer and of the world, the oldest it keeps, and what it folded
// away. Names are keyed "kind:id"; another player is named only as their
// consent allows.
type DossierView struct {
	Day         int64
	Role        string
	Traits      []string
	Faction     string
	Place       string
	About       []MemoryView
	World       []MemoryView
	Oldest      []MemoryView
	Folded      tally.Tally
	FoldedTotal int64
	Names       map[string]string
}

// MemoryView is one remembered entry as the viewer may be told it: Who
// is "you", a consented name, or a traveller from their guild.
type MemoryView struct {
	Kind  string
	Tick  int64
	Fact  int64
	Thing string
	Who   string
	N     int64
	Unit  string
}

// entryUnits are what an entry's quantity counts, by entry kind.
var entryUnits = map[string]string{entryResold: "coin"}

// Dossier is a saved NPC's dossier for a character. It only reads: the
// game is as it was.
func (g *Game) Dossier(c *Char, id string) (DossierView, error) {
	n := g.NPCs.Get(id)
	if n == nil {
		return DossierView{}, refuse(NotHere, "%s has not been spoken to", id)
	}
	t := g.Tick()
	keep := int(g.r.NPC.Param("dormant-summary"))
	out := DossierView{Day: t / sheets.TicksPerDay, Role: n.Stub.Role, Place: g.placeName(n.Stub.Home), Names: map[string]string{}}
	if row := g.r.NPC.Role(n.Stub.Role); row != nil {
		out.Role = row.Role
	}
	for _, tr := range n.Stub.Traits {
		out.Traits = append(out.Traits, cmp.Or(g.r.Name("npcs.traits:"+tr), tr))
	}
	out.Names[refKey(npc.Ref(n.Stub.ID))] = n.Stub.Name
	if s, ok := g.SettlementAt(n.Stub.Home); ok {
		out.Names[refKey(arc.SettlementRef(s))] = out.Place
	} else {
		out.Names[refKey(arc.TileRef(n.Stub.Home))] = out.Place
	}
	if r := g.World.RegionAt(n.Stub.Home); r >= 0 {
		out.Names[refKey(arc.RegionRef(r))] = g.RegionName(r)
		if f := g.World.Regions[r].Holder; f >= 0 && f < len(g.World.Factions) {
			out.Faction = g.FactionName(f)
			out.Names[refKey(arc.FactionRef(f))] = out.Faction
		}
	}

	salient := slices.Clone(n.Memory)
	slices.SortStableFunc(salient, func(a, b npc.Entry) int {
		return cmp.Or(cmp.Compare(g.r.NPC.Salience(b, t), g.r.NPC.Salience(a, t)), cmp.Compare(b.Tick, a.Tick))
	})
	for _, e := range salient {
		switch {
		case e.Player == c.C.ID && len(out.About) < keep:
			out.About = append(out.About, g.memoryView(c, e, out.Names))
		case e.Player == "" && len(out.World) < keep:
			out.World = append(out.World, g.memoryView(c, e, out.Names))
		}
	}
	kept := append(slices.Clone(n.Archived), n.Memory...)
	slices.SortStableFunc(kept, func(a, b npc.Entry) int { return cmp.Compare(a.Tick, b.Tick) })
	for _, e := range kept[:min(keep, len(kept))] {
		out.Oldest = append(out.Oldest, g.memoryView(c, e, out.Names))
	}
	out.Folded = slices.Clone(n.Summary)
	for _, x := range n.Summary {
		out.FoldedTotal += x.N
	}
	return out, nil
}

// memoryView tells an entry to c, naming its player under consent, and
// adds the name it uses to names.
func (g *Game) memoryView(c *Char, e npc.Entry, names map[string]string) MemoryView {
	v := MemoryView{Kind: e.Kind, Tick: e.Tick, Fact: e.Fact, Thing: e.Thing, N: e.N}
	if e.N != 0 {
		v.Unit = entryUnits[e.Kind]
	}
	switch subject := g.Char(e.Player); {
	case e.Player == "":
	case e.Player == c.C.ID:
		v.Who = "you"
	case subject == nil:
		v.Who = travellerName
	default:
		guild := ""
		if gd := g.GuildOf(subject.C.Guild); gd != nil {
			guild = gd.G.Name
		}
		switch name := NameFor(c, subject, subject.C.ID, guild); {
		case name == subject.C.ID:
			v.Who = name
		case guild == "":
			v.Who = travellerName
		default:
			v.Who = name
			names[refKey(guildRef(subject.C.Guild))] = guild
		}
	}
	return v
}

// travellerName is another player whose guild is unknown, unnamed.
const travellerName = "a traveller"

func refKey(r fact.Ref) string { return r.Kind + ":" + r.ID }
