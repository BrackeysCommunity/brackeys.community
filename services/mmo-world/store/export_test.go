package store

import (
	"context"
	"encoding/json"
	"time"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/store/db"
)

// Import stores a game recorded outside any store, as a world kept from an
// older build stands: every row, each character under the Discord user
// discord names, and its NPCs. A snapshot keeps its log's count and chain
// but not the facts, and its ledger's balances but not the transactions,
// so a stand-in fact sits at the log's last id and one opening transaction
// at the ledger's last number carries every balance.
func (s *Store) Import(ctx context.Context, m Meta, g *game.Game, discord func(char string) string, now time.Time) error {
	s.resetCache()
	return s.tx(ctx, func(q *db.Queries) error {
		body, err := simOf(g)
		if err != nil {
			return err
		}
		d, err := g.Digest()
		if err != nil {
			return err
		}
		if err := q.InsertWorld(ctx, db.InsertWorldParams{ID: m.ID, KeyVersion: m.KeyVersion, KeyCheck: m.KeyCheck, RulesEpoch: m.RulesEpoch, Tick: g.Tick(),
			SheetsDigest: m.SheetsDigest, StartedAt: ts(m.StartedAt), TickSeconds: m.TickSeconds, Sim: body, Digest: d.String(), Disposable: m.Disposable}); err != nil {
			return err
		}
		s.tick, s.digest = g.Tick(), d.String()
		for _, c := range g.Chars {
			if err := s.char(ctx, q, c, discord(c.C.ID)); err != nil {
				return err
			}
		}
		if err := s.rows(ctx, q, g); err != nil {
			return err
		}
		for _, n := range g.NPCs.List {
			b, err := json.Marshal(n)
			if err != nil {
				return err
			}
			if err := q.UpsertNPC(ctx, db.UpsertNPCParams{WorldID: s.World, Seq: n.Seq, ID: n.Stub.ID, Body: b}); err != nil {
				return err
			}
		}
		var facts []fact.Fact
		if g.Log.Count > 0 {
			facts = []fact.Fact{{ID: g.Log.Count, Tick: g.Tick(), Kind: "import.stand-in"}}
		}
		var txns []ledger.Txn
		if g.Ledger.Posted > 0 {
			t := ledger.Txn{Key: "import", Tick: g.Tick(), Kind: "import.opening"}
			for _, b := range g.Ledger.Balances {
				t.Legs = append(t.Legs, ledger.Leg(b))
			}
			txns = []ledger.Txn{t}
		}
		if err := s.appendLog(ctx, q, facts, txns, g.Ledger.Posted, now); err != nil {
			return err
		}
		return s.snapshot(ctx, q, g, d.String())
	})
}
