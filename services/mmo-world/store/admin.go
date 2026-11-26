package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/store/db"
)

// EnsurePartitions creates the fact log's partitions for the month of now
// and the next, so writes never land in the default partition.
func (s *Store) EnsurePartitions(ctx context.Context, now time.Time) error {
	m := time.Date(now.UTC().Year(), now.UTC().Month(), 1, 0, 0, 0, 0, time.UTC)
	for range 2 {
		next := m.AddDate(0, 1, 0)
		name := fmt.Sprintf("fact_y%04dm%02d", m.Year(), int(m.Month()))
		sql := fmt.Sprintf(`CREATE TABLE IF NOT EXISTS mmo.%s PARTITION OF mmo.fact FOR VALUES FROM ('%s') TO ('%s')`,
			name, m.Format(time.DateOnly), next.Format(time.DateOnly))
		if _, err := s.pool.Exec(ctx, sql); err != nil {
			return fmt.Errorf("store: partition %s: %w", name, err)
		}
		m = next
	}
	return nil
}

// Lock is the world's advisory lock, held on its own connection for as
// long as the service runs: a second service for the same world waits on
// it instead of advancing the world twice.
type Lock struct {
	conn  *pgxpool.Conn
	world string
}

// TryLock takes the world's lock, or reports that another holds it.
func TryLock(ctx context.Context, pool *pgxpool.Pool, worldID string) (*Lock, bool, error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return nil, false, err
	}
	ok, err := db.New(conn).TryLockWorld(ctx, worldID)
	if err != nil || !ok {
		conn.Release()
		return nil, false, err
	}
	return &Lock{conn: conn, world: worldID}, true, nil
}

// Held reports whether the lock's connection still holds it: a dropped
// connection loses it, and another service may then take the world.
func (l *Lock) Held(ctx context.Context) (bool, error) {
	var ok bool
	err := l.conn.QueryRow(ctx, `WITH k AS (SELECT hashtextextended($1::text, 0) AS h)
		SELECT EXISTS (SELECT 1 FROM pg_locks, k WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted
			AND objsubid = 1 AND classid::text::bigint = (k.h >> 32) & 4294967295 AND objid::text::bigint = k.h & 4294967295)`,
		l.world).Scan(&ok)
	return ok, err
}

// Release gives the lock up. A process that dies loses its connection,
// and the lock with it.
func (l *Lock) Release(ctx context.Context) {
	_, _ = db.New(l.conn).UnlockWorld(ctx, l.world)
	l.conn.Release()
}

// Reset deletes every row of a disposable world, the world row last.
// The caller holds the world's lock.
func (s *Store) Reset(ctx context.Context) error {
	s.resetCache()
	return s.tx(ctx, func(q *db.Queries) error { return s.wipe(ctx, q) })
}

// wipe deletes a disposable world's rows. A table without a delete here
// survives a reset, which TestResetEmptiesEveryTable catches.
func (s *Store) wipe(ctx context.Context, q *db.Queries) error {
	m, err := metaOf(ctx, q, s.World)
	if err != nil {
		return err
	}
	if !m.Disposable {
		return fmt.Errorf("store: world %s is not disposable", s.World)
	}
	for _, del := range []func(context.Context, string) error{
		q.DeleteWorldFacts, q.DeleteWorldLedgerEntries, q.DeleteWorldLedgerTxns, q.DeleteWorldActions, q.DeleteWorldHouseLog, q.DeleteWorldTicks,
		q.DeleteWorldSnapshots, q.DeleteWorldCharacters, q.DeleteWorldNPCs, q.DeleteWorldTiles, q.DeleteWorldNotables, q.DeleteWorldFactions,
		q.DeleteWorldRegions, q.DeleteWorldMapSeen, q.DeleteWorldMapSight, q.DeleteWorldEpochNotes, q.DeleteWorld,
	} {
		if err := del(ctx, s.World); err != nil {
			return err
		}
	}
	return nil
}

// Audit is the conservation check over what is stored: every transaction
// balances and every character row holds what the ledger says. It reads
// one snapshot, so a concurrent action cannot skew it. It returns each
// discrepancy.
func (s *Store) Audit(ctx context.Context) ([]string, error) {
	var out []string
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		bad, err := q.UnbalancedTxns(ctx, s.World)
		if err != nil {
			return err
		}
		for _, b := range bad {
			out = append(out, fmt.Sprintf("transaction %d: %s sums to %d", b.Txn, b.Asset, b.Units))
		}
		bal, err := balances(ctx, q, s.World)
		if err != nil {
			return err
		}
		rows, err := q.ListCharacters(ctx, s.World)
		if err != nil {
			return err
		}
		chars, err := decodeChars(rows)
		if err != nil {
			return err
		}
		held := game.HoldingsOf(chars)
		w, err := q.GetWorld(ctx, s.World)
		if err != nil {
			return err
		}
		live, err := liveCaravans(w.Sim)
		if err != nil {
			return err
		}
		for _, b := range bal {
			m, ok := live[b.Account]
			switch {
			case !ok:
			case m.material == "":
				held = append(held, b)
			case b.Asset == ledger.Goods(m.material):
				held = append(held, ledger.Balance{Account: b.Account, Asset: b.Asset, Units: min(b.Units, m.units)})
			}
		}
		out = append(out, ledger.Audit(bal, held)...)
		return nil
	})
	return out, err
}

// caravanManifest is what a live caravan's pool may hold; an empty
// material is a save from before manifests were kept, whose pool is
// trusted.
type caravanManifest struct {
	material string
	units    int64
}

// liveCaravans is each live caravan's manifest in a stored sim, by pool.
// A pool left behind or a foreign good is not held, so the audit flags it.
func liveCaravans(sim []byte) (map[string]caravanManifest, error) {
	var sm struct {
		Emergence *struct {
			Caravans []*emerge.Caravan `json:"caravans"`
		} `json:"emergence"`
	}
	if err := json.Unmarshal(sim, &sm); err != nil {
		return nil, err
	}
	out := map[string]caravanManifest{}
	if sm.Emergence != nil {
		for _, cv := range sm.Emergence.Caravans {
			out[ledger.CaravanPool(cv.ID)] = caravanManifest{material: cv.Material, units: cv.Units}
		}
	}
	return out, nil
}

// FindText reports which mmo tables hold any of the needles anywhere in a
// row's text form: the start-up check that no key reached the database.
// A partitioned table is read through its partitions only, so no row is
// read twice.
func FindText(ctx context.Context, pool *pgxpool.Pool, needles []string) ([]string, error) {
	rows, err := pool.Query(ctx, `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'mmo' AND c.relkind = 'r' ORDER BY c.relname`)
	if err != nil {
		return nil, err
	}
	tables, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	pats := make([]string, len(needles))
	for i, n := range needles {
		pats[i] = "%" + strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(n) + "%"
	}
	var hits []string
	for _, t := range tables {
		var n int64
		q := fmt.Sprintf(`SELECT count(*) FROM mmo.%s x WHERE x::text LIKE ANY($1)`, pgx.Identifier{t}.Sanitize())
		if err := pool.QueryRow(ctx, q, pats).Scan(&n); err != nil {
			return nil, err
		}
		if n > 0 {
			hits = append(hits, fmt.Sprintf("%s: %d rows", t, n))
		}
	}
	return hits, nil
}
