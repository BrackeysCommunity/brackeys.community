package game

import (
	"slices"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
)

// Staged goods are the asset stg:<settlement>:<material>, and a staged
// item carries item.Instance.Staged. The guard below is the one choke
// point every ledger post passes (GDD 14.5 rule 7): staged units rest only
// where they cannot reach another settlement's market, a faction, a store,
// a bank or a budget, and a staged thing never mints clean goods or coin.

// stagedEscrows decide which escrow pools may hold staged goods: a staged
// book's orders and staged listings, which the market's rules register.
var stagedEscrows []func(g *Game, acc string) bool

// withStage applies what follows in a stage's context: facts are stamped
// by its server, staged mints take stg: goods from src:staged, and the
// guard refuses any clean mint. The func it returns puts back what was.
func (g *Game) withStage(st *Stage) (restore func()) {
	was := g.staging
	g.staging = st
	unstamp, end := g.stampedBy(st.Server), g.stagedSpan(st.Server)
	return func() {
		g.staging = was
		unstamp()
		end()
	}
}

// stagedSpan marks the facts written until end is called as server's
// staging. Log.Len is the last id already written, so the span is
// (Len at start, Len at end].
func (g *Game) stagedSpan(server string) (end func()) {
	from := fact.ID(g.Log.Len())
	return func() {
		if to := fact.ID(g.Log.Len()); to > from {
			g.stagedFacts = append(g.stagedFacts, factSpan{from, to, server})
		}
	}
}

// stagedFact reports whether a fact was written in a stage's context,
// equips a staged item, or names a staged hunt, arc, stage or contest.
// Such a fact counts only toward staged contests and staged arcs' sides,
// so staging pays no coin or standing through the world's goals.
func (g *Game) stagedFact(f fact.Fact) bool { staged, _ := g.stagedOf(f); return staged }

// stagedOf is stagedFact with the server whose staging the fact is, so a
// staged fact counts only toward that server's staged contests and arcs.
func (g *Game) stagedOf(f fact.Fact) (staged bool, server string) {
	if g.Live == nil {
		return false, ""
	}
	for _, s := range g.stagedFacts {
		if f.ID > s.From && f.ID <= s.To {
			return true, s.Server
		}
	}
	if f.Kind == "item.equipped" {
		if in := g.equippedItem(f); in != nil && in.Staged != nil {
			return true, in.Staged.Server
		}
	}
	if s := g.subjectServer(f); s != nil {
		return true, s.ID
	}
	return false, ""
}

// goodsAsset is the asset a material is minted as: staged at the stage's
// settlement while one is applied, the material's own otherwise.
// Provisions are never staged, so the guard refuses minting them there.
func (g *Game) goodsAsset(m string) string {
	if g.staging != nil && m != ledger.Provisions {
		return ledger.Staged(g.staging.Settlement, m)
	}
	return ledger.Goods(m)
}

// mintSource is the source a mint draws on: src:staged while a stage is
// applied, src otherwise.
func (g *Game) mintSource(src string) string {
	if g.staging != nil {
		return ledger.FromStaged
	}
	return src
}

// StagedHeld is how many staged units of a material from settlement n a
// character carries.
func (g *Game) StagedHeld(c *Char, n int, m string) int64 {
	for _, s := range c.C.Staged {
		if s.At == n && s.Material == m {
			return s.Units
		}
	}
	return 0
}

// Usable is what a craft may draw of a material: the clean units carried,
// and the staged ones by origin settlement in origin order.
func (g *Game) Usable(c *Char, m string) (clean int64, staged []char.StagedGoods) {
	for _, s := range c.C.Goods {
		if s.Material == m {
			clean = s.Qty
		}
	}
	for _, s := range c.C.Staged {
		if s.Material == m {
			staged = append(staged, s)
		}
	}
	return clean, staged
}

// guardStaged refuses a transaction, before it posts, that would credit
// staged goods or a staged item anywhere but a staged home, mint clean
// goods or coin while a stage is applied, or mint from src:staged anything
// but staged goods and items.
func (g *Game) guardStaged(t ledger.Txn) error {
	for _, l := range t.Legs {
		staged := ledger.IsStaged(l.Asset)
		if l.Account == ledger.FromStaged && !staged && !g.stagedItemLeg(t, l) {
			return refuse(StagedLocal, "a staging mints only staged goods and items, not %s", l.Asset)
		}
		if g.staging != nil && l.Units < 0 && strings.HasPrefix(l.Account, ledger.Source) && cleanMint(l.Asset) {
			return refuse(StagedLocal, "%s is staged: it mints no coin or clean goods", g.staging.ID)
		}
		if l.Units <= 0 || ledger.StagedRest(l.Account) || !staged && !g.stagedItemLeg(t, l) {
			continue
		}
		if !g.stagedHome(l.Account) {
			return refuse(StagedLocal, "staged goods stay where they were staged: %s cannot hold %s", l.Account, l.Asset)
		}
	}
	return nil
}

// cleanMint reports whether an asset is coin, provisions or a material:
// what a staged thing may never mint.
func cleanMint(asset string) bool {
	if asset == ledger.Coin || asset == ledger.Provisions {
		return true
	}
	_, ok := ledger.MaterialOf(asset)
	return ok
}

// stagedHome reports whether an account may hold staged goods: one of the
// kinds ledger.StagedRest allows, a staged hunt's pool, or an escrow the
// market registers as staged.
func (g *Game) stagedHome(acc string) bool {
	if ledger.StagedRest(acc) {
		return true
	}
	if id, ok := strings.CutPrefix(acc, ledger.HuntPool("")); ok {
		x := g.HuntByID(id)
		return x != nil && x.Stage != ""
	}
	if ledger.IsEscrow(acc) {
		return slices.ContainsFunc(stagedEscrows, func(is func(*Game, string) bool) bool { return is(g, acc) })
	}
	return false
}

// stagedItemLeg reports whether a leg moves a staged item. The instance is
// looked for where its transaction's other side holds it: a character's
// pack, a listing's escrow or a tile; a new item minted to a character is
// in its receiver's pack. A world with nothing staged has none.
func (g *Game) stagedItemLeg(t ledger.Txn, l ledger.Leg) bool {
	if g.Live == nil {
		return false
	}
	id, ok := ledger.ItemOf(l.Asset)
	if !ok {
		return false
	}
	for _, o := range t.Legs {
		if o.Asset != l.Asset {
			continue
		}
		if in := g.instanceIn(o.Account, id); in != nil {
			return in.Staged != nil
		}
	}
	return false
}

// instanceIn is the item instance an account holds by id, where the game
// keeps it beside the ledger, or nil.
func (g *Game) instanceIn(acc, id string) *item.Instance {
	if c := g.charOf(acc); c != nil {
		return instanceOf(c.C.Pack, id)
	}
	if ledger.IsEscrow(acc) && g.Market != nil {
		for _, x := range g.Market.Listings {
			if x.Item != nil && ledger.EscrowPool(x.ID) == acc {
				return instanceOf([]*item.Instance{x.Item}, id)
			}
		}
		return nil
	}
	if strings.HasPrefix(acc, ledger.TilePool("")) {
		for _, x := range g.Left {
			if in := instanceOf([]*item.Instance{x.Item}, id); in != nil {
				return in
			}
		}
	}
	return nil
}

// instanceOf finds an instance among some, or the exploit a deck of them
// holds.
func instanceOf(ins []*item.Instance, id string) *item.Instance {
	for _, in := range ins {
		switch {
		case in == nil:
		case in.ID == id:
			return in
		case in.Exploit != nil && in.Exploit.ID == id:
			return in.Exploit
		}
	}
	return nil
}
