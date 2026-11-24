package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// The syndicate's dens (GDD 4.5): one in each open starting settlement and
// each city, its fence a resident no place's slots name. Nothing about a
// den is stored but where it has moved, so a world without moves digests
// as it did.

// syndicateKey is the syndicate's standing key, and the id of its
// archetype and of its npcs.leanings row.
const syndicateKey = "syndicate"

// structural: the npcs.roles places the dens and the syndicate fill, the
// fence's role, the notables' ids and roles, the invitation's template,
// and the causes a den moves for.
const (
	placeDen        = "den"
	placeSyndicate  = "syndicate"
	roleDenFence    = "den-fence"
	roleSynLeader   = "syndicate-leader"
	roleSynCaptain  = "syndicate-captain"
	synLeaderID     = "syn-leader"
	synCaptainID    = "syn-captain-"
	inviteTemplate  = "the-invitation"
	denMoveDormant  = "dormant"
	txnFenceDay     = "fence-day"
	syndicateIssuer = "static"
)

// Den is a den as it stands now: its fence, the settlement it was born in
// and the one it stands in, and its index in Dens.
type Den struct {
	Fence  string
	Origin hex.Hex
	At     hex.Hex
	Place  int
	Index  int
}

// denFenceID is the fence's stub id, as Residents names the den slot.
func denFenceID(origin hex.Hex) string { return "r-" + origin.Ref() + "-" + roleDenFence + "-0" }

// Dens are the dens in place order of their origin. A den is born in an
// open starting settlement or a city; one that has moved, or whose fence
// has been met, keeps standing after its city falls back, so it can move
// on. A city a moved den stands in gets none of its own.
func (g *Game) Dens() []Den {
	if g.r.NPC.Role(roleDenFence) == nil {
		return nil
	}
	moved, holds := map[string]hex.Hex{}, map[hex.Hex]bool{}
	if s := g.Syndicate; s != nil {
		for _, m := range s.Moves {
			moved[m.Fence] = m.To
		}
		for _, m := range s.Moves {
			holds[moved[m.Fence]] = true
		}
	}
	var out []Den
	for n, p := range g.Places {
		id := denFenceID(p.Hex)
		to, gone := moved[id]
		switch {
		case gone:
		case holds[p.Hex]:
			continue
		case p.Lattice < 0 && !g.isCity(n) && g.NPCs.Get(id) == nil:
			continue
		}
		at := p.Hex
		if gone {
			at = to
		}
		place, ok := g.SettlementAt(at)
		if !ok {
			continue
		}
		out = append(out, Den{Fence: id, Origin: p.Hex, At: at, Place: place, Index: len(out)})
	}
	return out
}

// DenAt is the den standing on a tile, if any.
func (g *Game) DenAt(h hex.Hex) (Den, bool) {
	if !g.IsSettlement(h) {
		return Den{}, false
	}
	for _, d := range g.Dens() {
		if d.At == h {
			return d, true
		}
	}
	return Den{}, false
}

// dormantDen reports whether a den must move (GDD 4.5): its settlement is
// ruined, or it still stands where it was born, in a city that fell back
// and was never a starting settlement.
func (g *Game) dormantDen(d Den) bool {
	p := g.Places[d.Place]
	if p.Ruined != 0 {
		return true
	}
	return d.At == d.Origin && p.Lattice < 0 && !g.isCity(d.Place)
}

// fenceStub is a den's fence as its draw makes it, homed at the den's
// origin.
func (g *Game) fenceStub(origin hex.Hex) (npc.Stub, bool) {
	for _, s := range g.r.NPC.Residents(placeDen, origin.Ref(), origin, g.npcDraw(origin)) {
		if s.Role == roleDenFence {
			return s, true
		}
	}
	return npc.Stub{}, false
}

// denNPC is a den's fence, saved on the spot if nobody has met it.
func (g *Game) denNPC(d Den, t int64) (*npc.NPC, error) {
	if n := g.NPCs.Get(d.Fence); n != nil {
		return n, nil
	}
	s, ok := g.fenceStub(d.Origin)
	if !ok {
		return nil, refuse(NoDen, "no fence stands in this den")
	}
	n := g.NPCs.Save(s, t)
	old := n.Route
	g.r.NPC.LayRoute(n, t, g.routeCost)
	g.NPCs.Routed(n, old)
	return n, g.NPCs.Touched(n)
}

// moveDen moves a den to the nearest open settlement with no den, the
// lowest index on a tie; with none, it stays. Its fence is saved and moved
// home, so it keeps its memory, its leaning and its id.
func (g *Game) moveDen(d Den, cause string, t int64) error {
	dens := g.Dens()
	to, far := -1, int64(0)
	for i, p := range g.Places {
		if i == d.Place || p.Ruined != 0 || slices.ContainsFunc(dens, func(x Den) bool { return x.At == p.Hex }) {
			continue
		}
		if dist := hex.Distance(p.Hex, d.At); to < 0 || dist < far {
			to, far = i, dist
		}
	}
	if to < 0 {
		return nil
	}
	n, err := g.denNPC(d, t)
	if err != nil {
		return err
	}
	dest := g.Places[to].Hex
	old := n.Route
	g.r.NPC.Move(n, dest, t, g.routeCost)
	g.NPCs.Routed(n, old)
	if err := g.NPCs.Touched(n); err != nil {
		return err
	}
	if g.Syndicate == nil {
		g.Syndicate = &Syndicate{}
	}
	g.Syndicate.Moves = append(g.Syndicate.Moves, DenMove{Fence: d.Fence, From: d.At, To: dest, Day: t / sheets.TicksPerDay, Cause: cause})
	_, err = g.worldFact(dest, factDenMoved, []fact.Ref{npc.Ref(d.Fence), arc.SettlementRef(d.Place), arc.SettlementRef(to)}, nil,
		append([]fact.Datum{fact.S("cause", cause), fact.N("from", int64(d.Place)), fact.N("to", int64(to))}, fact.At(dest)...)...)
	return err
}

// FenceVisible reports whether a character can find a den's fence: it is
// Crooked or worse, holds hot goods, or is made (GDD 4.5).
func (g *Game) FenceVisible(c *Char) bool {
	return char.IsMade(c.C) || g.crookedOrWorse(c) || len(g.HotGoods(c)) > 0
}

// crookedOrWorse reports whether a character's band is Crooked or
// Notorious.
func (g *Game) crookedOrWorse(c *Char) bool {
	b := g.Band(c)
	return b == bandCrooked || b == bandNotorious
}

// SyndicateNotables are the syndicate's leader, homed at the first den,
// and a captain over each dens-per-captain dens, homed at the first of
// them; a saved one as it was saved.
func (g *Game) SyndicateNotables() []npc.Stub {
	dens := g.Dens()
	if len(dens) == 0 {
		return nil
	}
	stub := func(id, role string, home hex.Hex) npc.Stub {
		if n := g.NPCs.Get(id); n != nil {
			return n.Stub
		}
		return g.r.NPC.StubFor(id, role, home, npc.Draw{})
	}
	per := max(1, sheets.IntParam(g.r.Book.SyndicateParams, "dens-per-captain"))
	out := []npc.Stub{stub(synLeaderID, roleSynLeader, dens[0].At)}
	captains := max(1, (int64(len(dens))+per-1)/per)
	for k := range captains {
		out = append(out, stub(synCaptainID+strconv.FormatInt(k, decimal), roleSynCaptain, dens[k*per].At))
	}
	return out
}

// IsSyndicateNPC reports whether an NPC is a den's fence or a syndicate
// notable.
func (g *Game) IsSyndicateNPC(id string) bool {
	return isFenceID(id) || isNotableID(id)
}

func isFenceID(id string) bool {
	return strings.HasPrefix(id, "r-") && strings.Contains(id, "-"+roleDenFence+"-")
}

func isNotableID(id string) bool { return id == synLeaderID || strings.HasPrefix(id, synCaptainID) }

// syndicateRole reports whether a role is filled by the dens or the
// syndicate rather than by a place.
func (g *Game) syndicateRole(role string) (fence, notable bool) {
	row := g.r.NPC.Role(role)
	if row == nil {
		return false, false
	}
	return row.Place == placeDen, row.Place == placeSyndicate
}

// addSyndicateStanding moves a character's syndicate standing within the
// growth sheet's bounds. A made character falling under 0 is unmade; one
// not made reaching the gate is queued for the invitation, unless one is
// open, pending or resting (GDD 4.5, 12.9).
func (g *Game) addSyndicateStanding(c *Char, delta int64, cause fact.ID, t int64) error {
	g.adjustStanding(c, syndicateKey, delta)
	now := c.C.Standing.Get(syndicateKey)
	if char.IsMade(c.C) {
		if now >= 0 {
			return nil
		}
		return g.unmake(c, cause, t)
	}
	if now < sheets.IntParam(g.r.Book.SyndicateParams, "gate") || g.inviteBusy(c, t) {
		return nil
	}
	g.pend(arc.Pending{Kind: arc.PendInvite, Char: c.C.ID, Ref: fact.Ref{Kind: syndicateKey, ID: syndicateIssuer}, Tick: t, Fact: cause})
	return nil
}

// inviteBusy reports whether a character's invitation is open, pending or
// resting.
func (g *Game) inviteBusy(c *Char, t int64) bool {
	s := g.Story
	if s == nil {
		return true
	}
	if slices.ContainsFunc(s.Pending, func(p arc.Pending) bool { return p.Kind == arc.PendInvite && p.Char == c.C.ID }) {
		return true
	}
	if g.resting(arc.ScopeInvite, char.Ref(c.C.ID), t) {
		return true
	}
	return slices.ContainsFunc(s.Arcs, func(a *Arc) bool { return !a.over() && a.Template == inviteTemplate && a.Char == c.C.ID })
}

// fenceCheck sends the nearest den's fence to a character the first time
// it is Crooked or worse or holds hot goods: the fence, saved on the spot,
// queues a visit to it, once a character (GDD 4.5).
func (g *Game) fenceCheck(c *Char, t int64) error {
	if char.FenceFound(c.C) || (!g.crookedOrWorse(c) && len(g.HotGoods(c)) == 0) {
		return nil
	}
	d, ok := g.nearestDen(c.C.At)
	if !ok {
		return nil
	}
	n, err := g.denNPC(d, t)
	if err != nil {
		return err
	}
	c.C.Align().Found = true
	if err := g.queueVisit(n, c); err != nil {
		return err
	}
	if _, err := g.npcFact(c, n, factFenceCame, t, append([]fact.Datum{fact.N("settlement", int64(d.Place))}, fact.At(d.At)...)...); err != nil {
		return err
	}
	return g.NPCs.Touched(n)
}

// nearestDen is the den nearest a tile, the lowest index on a tie.
func (g *Game) nearestDen(h hex.Hex) (Den, bool) {
	dens := g.Dens()
	if len(dens) == 0 {
		return Den{}, false
	}
	return slices.MinFunc(dens, func(a, b Den) int {
		return cmp.Or(cmp.Compare(hex.Distance(a.At, h), hex.Distance(b.At, h)), cmp.Compare(a.Index, b.Index))
	}), true
}

// denDay is the syndicate's world day: each dormant den moves, then every
// fence's purse empties into the syndicate's sink, so fenced goods never
// come back to a market.
func (g *Game) denDay(t int64) error {
	var dormant []string
	for _, d := range g.Dens() {
		if g.dormantDen(d) {
			dormant = append(dormant, d.Fence)
		}
	}
	for _, id := range dormant {
		i := slices.IndexFunc(g.Dens(), func(d Den) bool { return d.Fence == id })
		if i < 0 {
			continue
		}
		if d := g.Dens()[i]; g.dormantDen(d) {
			if err := g.moveDen(d, denMoveDormant, t); err != nil {
				return err
			}
		}
	}
	day := t / sheets.TicksPerDay
	for _, d := range g.Dens() {
		purse := ledger.NPCPool(d.Fence)
		var legs []ledger.Leg
		for _, b := range g.Ledger.Held(purse) {
			legs = append(legs, ledger.Pair(purse, ledger.ToSyndicate, b.Asset, b.Units)...)
		}
		if len(legs) == 0 {
			continue
		}
		if err := g.post(ledger.Txn{Key: ledger.SubKey(txnFenceDay, i64(day), d.Fence), Kind: txnFenceDay, Tick: t, Legs: legs}); err != nil {
			return err
		}
	}
	return nil
}
