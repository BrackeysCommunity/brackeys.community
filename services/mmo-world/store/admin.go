package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

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
		if _, err := s.Pool.Exec(ctx, sql); err != nil {
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

// Release gives the lock up. A process that dies loses its connection,
// and the lock with it.
func (l *Lock) Release(ctx context.Context) {
	_, _ = db.New(l.conn).UnlockWorld(ctx, l.world)
	l.conn.Release()
}

// mmoTables are the schema's tables that carry a world_id, children first.
var mmoTables = []string{"fact", "ledger_entry", "ledger_txn", "action", "tick", "snapshot", "character", "tile", "notable", "faction", "region_state"}

// Reset deletes every row of a disposable world, the world row last.
// The caller holds the world's lock.
func (s *Store) Reset(ctx context.Context) error {
	m, _, err := s.Meta(ctx)
	if err != nil {
		return err
	}
	if !m.Disposable {
		return fmt.Errorf("store: world %s is not disposable", s.World)
	}
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error {
		for _, t := range mmoTables {
			if _, err := tx.Exec(ctx, "DELETE FROM mmo."+t+" WHERE world_id = $1", s.World); err != nil {
				return err
			}
		}
		_, err := tx.Exec(ctx, "DELETE FROM mmo.world WHERE id = $1", s.World)
		return err
	})
}

// Audit is the conservation check (GDD 10.9) over what is stored: every
// transaction balances, and every character row holds exactly what the
// ledger says it does. It returns each discrepancy.
func (s *Store) Audit(ctx context.Context) ([]string, error) {
	var out []string
	bad, err := s.Q.UnbalancedTxns(ctx, s.World)
	if err != nil {
		return nil, err
	}
	for _, b := range bad {
		out = append(out, fmt.Sprintf("transaction %d: %s sums to %d", b.Txn, b.Asset, b.Units))
	}
	bal, err := s.Q.LedgerBalances(ctx, s.World)
	if err != nil {
		return nil, err
	}
	var ledgerBal []ledger.Balance
	for _, b := range bal {
		ledgerBal = append(ledgerBal, ledger.Balance{Account: b.Account, Asset: b.Asset, Units: b.Units})
	}
	rows, err := s.Q.ListCharacters(ctx, s.World)
	if err != nil {
		return nil, err
	}
	g := &game.Game{}
	for _, r := range rows {
		var c game.Char
		if err := json.Unmarshal(r.Body, &c); err != nil {
			return nil, err
		}
		g.Chars = append(g.Chars, &c)
	}
	return append(out, ledger.Audit(ledgerBal, g.Holdings())...), nil
}

// FindText reports which mmo tables hold any of the needles anywhere in a
// row's text form: the start-up check that no key reached the database.
func FindText(ctx context.Context, pool *pgxpool.Pool, needles []string) ([]string, error) {
	rows, err := pool.Query(ctx, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'mmo' AND table_type = 'BASE TABLE' ORDER BY table_name`)
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
