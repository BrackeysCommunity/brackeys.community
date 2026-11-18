// Package store keeps a game in the mmo schema, which drizzle owns: the
// world row, and a row per region, faction, notable, stored tile and
// character, each the sim's own JSON. A tile is stored only while it
// differs from its baseline. Every save is one transaction, and writes
// only the rows whose bodies changed since the last one.
package store

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
	"jams.team/mmo-world/store/db"
)

// ErrConflict is a save whose world tick or character version moved
// under it: another writer got there first.
var ErrConflict = errors.New("store: the row changed under this write")

// Meta is a world row's fixed part.
type Meta struct {
	ID           string
	KeyVersion   int32
	KeyCheck     string
	RulesEpoch   int32
	SheetsDigest string
	StartedAt    time.Time
	TickSeconds  int32
	Disposable   bool
}

// DueTick is the tick that falls due at now.
func (m Meta) DueTick(now time.Time) int64 {
	if now.Before(m.StartedAt) {
		return 0
	}
	return int64(now.Sub(m.StartedAt) / (time.Duration(m.TickSeconds) * time.Second))
}

// Store is one world's rows and what was last written for each.
type Store struct {
	Pool  *pgxpool.Pool
	Q     *db.Queries
	World string
	saved map[string][sha256.Size]byte
	seq   map[hex.Hex]int64
	next  int64 // the next tile seq
	vers  map[string]int64
	tick  int64 // the world row's tick as stored
	acts  int64 // the last action seq stored
}

func New(pool *pgxpool.Pool, worldID string) *Store {
	return &Store{Pool: pool, Q: db.New(pool), World: worldID}
}

// sim is the world row's sim column: everything of the game not in the
// other tables.
type sim struct {
	World    json.RawMessage `json:"world"`
	Pending  []world.Action  `json:"pending"`
	NextChar int64           `json:"nextChar"`
	Log      *fact.Tail      `json:"log"`
	Posted   int64           `json:"posted"`
}

func simOf(g *game.Game) ([]byte, error) {
	ws := *g.World
	ws.Regions, ws.Factions, ws.Tiles = nil, nil, nil
	w, err := json.Marshal(&ws)
	if err != nil {
		return nil, err
	}
	return json.Marshal(sim{World: w, Pending: g.Pending, NextChar: g.NextChar, Log: g.Log, Posted: g.Ledger.Posted})
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

// Create writes a new world and its first snapshot.
func (s *Store) Create(ctx context.Context, m Meta, g *game.Game) error {
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
			SheetsDigest: m.SheetsDigest, StartedAt: ts(m.StartedAt), TickSeconds: m.TickSeconds, Sim: body, Digest: d.String()}); err != nil {
			return err
		}
		s.tick = g.Tick()
		if err := s.rows(ctx, q, g); err != nil {
			return err
		}
		return s.snapshot(ctx, q, g, d.String())
	})
}

func (s *Store) tx(ctx context.Context, f func(q *db.Queries) error) error {
	return pgx.BeginFunc(ctx, s.Pool, func(tx pgx.Tx) error { return f(s.Q.WithTx(tx)) })
}

// Meta reads a world's fixed part, or pgx.ErrNoRows.
func (s *Store) Meta(ctx context.Context) (Meta, db.MmoWorld, error) {
	w, err := s.Q.GetWorld(ctx, s.World)
	if err != nil {
		return Meta{}, w, err
	}
	return Meta{ID: w.ID, KeyVersion: w.KeyVersion, KeyCheck: w.KeyCheck, RulesEpoch: w.RulesEpoch, SheetsDigest: w.SheetsDigest,
		StartedAt: w.StartedAt.Time, TickSeconds: w.TickSeconds, Disposable: w.Disposable}, w, nil
}

// Load reads a game back and binds it to its rules. Its digest is checked
// against the one stored with it.
func (s *Store) Load(ctx context.Context, r *game.Rules) (*game.Game, error) {
	_, w, err := s.Meta(ctx)
	if err != nil {
		return nil, err
	}
	var sm sim
	if err := json.Unmarshal(w.Sim, &sm); err != nil {
		return nil, err
	}
	g := &game.Game{World: &world.State{}, Pending: sm.Pending, NextChar: sm.NextChar, Log: sm.Log}
	if err := json.Unmarshal(sm.World, g.World); err != nil {
		return nil, err
	}
	s.saved, s.seq, s.vers = map[string][sha256.Size]byte{}, map[hex.Hex]int64{}, map[string]int64{}
	if err := s.loadRows(ctx, g); err != nil {
		return nil, err
	}
	bal, err := s.Q.LedgerBalances(ctx, s.World)
	if err != nil {
		return nil, err
	}
	var bs []ledger.Balance
	for _, b := range bal {
		bs = append(bs, ledger.Balance{Account: b.Account, Asset: b.Asset, Units: b.Units})
	}
	g.Ledger = ledger.Rebuild(bs, sm.Posted)
	g.Attach(r)
	d, err := g.Digest()
	if err != nil {
		return nil, err
	}
	if d.String() != w.Digest {
		return nil, fmt.Errorf("store: world %s loads to digest %s, stored %s", s.World, d, w.Digest)
	}
	s.tick = g.Tick()
	if s.acts, err = s.Q.LastActionSeq(ctx, s.World); err != nil {
		return nil, err
	}
	return g, nil
}

func (s *Store) loadRows(ctx context.Context, g *game.Game) error {
	regions, err := s.Q.ListRegions(ctx, s.World)
	if err != nil {
		return err
	}
	for _, x := range regions {
		var r world.Region
		if err := json.Unmarshal(x.Body, &r); err != nil {
			return err
		}
		g.World.Regions = append(g.World.Regions, r)
		s.mark(regionKey(int(x.Region)), x.Body)
	}
	factions, err := s.Q.ListFactions(ctx, s.World)
	if err != nil {
		return err
	}
	for _, x := range factions {
		var f world.Faction
		if err := json.Unmarshal(x.Body, &f); err != nil {
			return err
		}
		f.Notables = []world.Notable{}
		g.World.Factions = append(g.World.Factions, f)
		s.mark(factionKey(int(x.Idx)), x.Body)
	}
	notables, err := s.Q.ListNotables(ctx, s.World)
	if err != nil {
		return err
	}
	for _, x := range notables {
		var n world.Notable
		if err := json.Unmarshal(x.Body, &n); err != nil {
			return err
		}
		f := &g.World.Factions[x.Faction]
		f.Notables = append(f.Notables, n)
		s.mark(notableKey(int(x.Faction), int(x.Idx)), x.Body)
	}
	tiles, err := s.Q.ListTiles(ctx, s.World)
	if err != nil {
		return err
	}
	for _, x := range tiles {
		t := &tile.State{}
		if err := json.Unmarshal(x.Body, t); err != nil {
			return err
		}
		h := hex.Hex{Q: int64(x.Q), R: int64(x.R)}
		g.World.Tiles = append(g.World.Tiles, t)
		s.seq[h] = x.Seq
		s.next = max(s.next, x.Seq+1)
		s.mark(tileKey(h), x.Body)
	}
	chars, err := s.Q.ListCharacters(ctx, s.World)
	if err != nil {
		return err
	}
	g.Chars = []*game.Char{}
	for _, x := range chars {
		var c game.Char
		if err := json.Unmarshal(x.Body, &c); err != nil {
			return err
		}
		g.Chars = append(g.Chars, &c)
		s.vers[x.ID] = x.Version
		s.mark(charKey(x.ID), x.Body)
	}
	return nil
}

func regionKey(i int) string     { return "r/" + strconv.Itoa(i) }
func factionKey(i int) string    { return "f/" + strconv.Itoa(i) }
func notableKey(f, i int) string { return "n/" + strconv.Itoa(f) + "/" + strconv.Itoa(i) }
func charKey(id string) string   { return "c/" + id }
func tileKey(h hex.Hex) string {
	return "t/" + strconv.FormatInt(h.Q, 10) + "," + strconv.FormatInt(h.R, 10)
}

// mark records what a row's body was when last written or read; changed
// says whether body differs from it.
func (s *Store) mark(key string, body []byte) { s.saved[key] = sha256.Sum256(body) }

func (s *Store) changed(key string, body []byte) bool {
	old, ok := s.saved[key]
	return !ok || old != sha256.Sum256(body)
}

// rows writes every region, faction, notable, tile and character whose
// body changed, and deletes tiles back at their baseline.
func (s *Store) rows(ctx context.Context, q *db.Queries, g *game.Game) error {
	if s.saved == nil {
		s.saved, s.seq, s.vers = map[string][sha256.Size]byte{}, map[hex.Hex]int64{}, map[string]int64{}
	}
	for i, r := range g.World.Regions {
		body, err := json.Marshal(r)
		if err != nil {
			return err
		}
		if k := regionKey(i); s.changed(k, body) {
			if err := q.UpsertRegion(ctx, db.UpsertRegionParams{WorldID: s.World, Region: int32(i), LatticeI: int32(r.Lattice.I), LatticeJ: int32(r.Lattice.J), Body: body}); err != nil {
				return err
			}
			s.mark(k, body)
		}
	}
	if err := s.factions(ctx, q, g); err != nil {
		return err
	}
	if err := s.tiles(ctx, q, g); err != nil {
		return err
	}
	for _, c := range g.Chars {
		if err := s.char(ctx, q, c, ""); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) factions(ctx context.Context, q *db.Queries, g *game.Game) error {
	for i, f := range g.World.Factions {
		notables := f.Notables
		f.Notables = nil
		body, err := json.Marshal(f)
		if err != nil {
			return err
		}
		if k := factionKey(i); s.changed(k, body) {
			if err := q.UpsertFaction(ctx, db.UpsertFactionParams{WorldID: s.World, Idx: int32(i), Body: body}); err != nil {
				return err
			}
			s.mark(k, body)
		}
		for j, n := range notables {
			body, err := json.Marshal(n)
			if err != nil {
				return err
			}
			if k := notableKey(i, j); s.changed(k, body) {
				if err := q.UpsertNotable(ctx, db.UpsertNotableParams{WorldID: s.World, Faction: int32(i), Idx: int32(j), Body: body}); err != nil {
					return err
				}
				s.mark(k, body)
			}
		}
		for j := len(notables); ; j++ {
			k := notableKey(i, j)
			if _, ok := s.saved[k]; !ok {
				break
			}
			if err := q.DeleteNotable(ctx, db.DeleteNotableParams{WorldID: s.World, Faction: int32(i), Idx: int32(j)}); err != nil {
				return err
			}
			delete(s.saved, k)
		}
	}
	return nil
}

// tiles writes stored tiles in the world's order: a tile first stored
// takes the next seq, so reading by seq gives the same order back.
func (s *Store) tiles(ctx context.Context, q *db.Queries, g *game.Game) error {
	live := make(map[hex.Hex]bool, len(g.World.Tiles))
	for _, t := range g.World.Tiles {
		live[t.Hex] = true
		seq, ok := s.seq[t.Hex]
		if !ok {
			seq = s.next
			s.next++
			s.seq[t.Hex] = seq
		}
		body, err := json.Marshal(t)
		if err != nil {
			return err
		}
		k := tileKey(t.Hex)
		if !ok || s.changed(k, body) {
			var found pgtype.Int8
			if t.Discovered != nil {
				found = pgtype.Int8{Int64: t.Discovered.Tick, Valid: true}
			}
			if err := q.UpsertTile(ctx, db.UpsertTileParams{WorldID: s.World, Q: int32(t.Hex.Q), R: int32(t.Hex.R), Seq: seq, FoundTick: found, Body: body}); err != nil {
				return err
			}
			s.mark(k, body)
		}
	}
	for h := range s.seq {
		if live[h] {
			continue
		}
		if err := q.DeleteTile(ctx, db.DeleteTileParams{WorldID: s.World, Q: int32(h.Q), R: int32(h.R)}); err != nil {
			return err
		}
		delete(s.seq, h)
		delete(s.saved, tileKey(h))
	}
	return nil
}

// char writes a character whose body changed. A new one needs the Discord
// user it belongs to; an old one must still be at the version last
// written.
func (s *Store) char(ctx context.Context, q *db.Queries, c *game.Char, discord string) error {
	body, err := json.Marshal(c)
	if err != nil {
		return err
	}
	k := charKey(c.C.ID)
	was, ok := s.vers[c.C.ID]
	if ok && !s.changed(k, body) {
		return nil
	}
	if !ok {
		if discord == "" {
			return fmt.Errorf("store: character %s has no Discord user", c.C.ID)
		}
		err = q.InsertCharacter(ctx, db.InsertCharacterParams{WorldID: s.World, ID: c.C.ID, DiscordID: discord, Version: c.Version,
			Q: int32(c.C.At.Q), R: int32(c.C.At.R), Banned: c.Banned, Body: body})
	} else {
		var n int64
		n, err = q.SaveCharacter(ctx, db.SaveCharacterParams{WorldID: s.World, ID: c.C.ID, Version: c.Version, Q: int32(c.C.At.Q),
			R: int32(c.C.At.R), Banned: c.Banned, Body: body, Was: was})
		if err == nil && n != 1 {
			err = ErrConflict
		}
	}
	if err != nil {
		return err
	}
	s.vers[c.C.ID] = c.Version
	s.mark(k, body)
	return nil
}

// world writes the world row, checking it was still at the tick last
// written.
func (s *Store) world(ctx context.Context, q *db.Queries, g *game.Game) (string, error) {
	body, err := simOf(g)
	if err != nil {
		return "", err
	}
	d, err := g.Digest()
	if err != nil {
		return "", err
	}
	n, err := q.SaveWorld(ctx, db.SaveWorldParams{ID: s.World, Tick: g.Tick(), Season: 0, Sim: body, Digest: d.String(), Was: s.tick})
	if err != nil {
		return "", err
	}
	if n != 1 {
		return "", ErrConflict
	}
	return d.String(), nil
}

// appendLog writes the facts and ledger transactions flushed from a game.
func (s *Store) appendLog(ctx context.Context, q *db.Queries, facts []fact.Fact, txns []ledger.Txn, posted int64, now time.Time) error {
	if len(facts) > 0 {
		rows := make([]db.InsertFactsParams, len(facts))
		for i, f := range facts {
			subj, _ := json.Marshal(f.Subjects)
			data, _ := json.Marshal(f.Data)
			causes, _ := json.Marshal(f.Causes)
			var staged []byte
			if f.StagedBy != nil {
				staged, _ = json.Marshal(f.StagedBy)
			}
			rows[i] = db.InsertFactsParams{WorldID: s.World, ID: int64(f.ID), Tick: f.Tick, Kind: f.Kind, Region: pgtype.Text{String: f.Region, Valid: f.Region != ""},
				Weight: int32(f.Weight), Subjects: subj, Data: data, Causes: causes, StagedBy: staged, At: ts(now)}
		}
		if _, err := q.InsertFacts(ctx, rows); err != nil {
			return err
		}
	}
	if len(txns) == 0 {
		return nil
	}
	first := posted - int64(len(txns)) + 1
	var rows []db.InsertLedgerTxnsParams
	var legs []db.InsertLedgerEntriesParams
	for i, t := range txns {
		n := first + int64(i)
		rows = append(rows, db.InsertLedgerTxnsParams{WorldID: s.World, Txn: n, Key: t.Key, Tick: t.Tick, Kind: t.Kind, FactID: pgtype.Int8{Int64: int64(t.Fact), Valid: t.Fact != 0}})
		for j, l := range t.Legs {
			legs = append(legs, db.InsertLedgerEntriesParams{WorldID: s.World, Txn: n, Leg: int32(j), Account: l.Account, Asset: l.Asset, Units: l.Units})
		}
	}
	if _, err := q.InsertLedgerTxns(ctx, rows); err != nil {
		return err
	}
	_, err := q.InsertLedgerEntries(ctx, legs)
	return err
}

// TickSaved is what a tick's save records.
type TickSaved struct {
	Digest string
	Facts  int
}

// A failed save leaves the store's record of what it wrote behind the
// database's; the caller reloads the game before going on.

// SaveTick writes one tick in one transaction: the changed rows, the
// world row, the tick's facts and ledger, its digest, and at a world
// day's turn a snapshot.
func (s *Store) SaveTick(ctx context.Context, g *game.Game, ms int64, now time.Time) (TickSaved, error) {
	facts, txns := g.Flush()
	var out TickSaved
	err := s.tx(ctx, func(q *db.Queries) error {
		if err := s.rows(ctx, q, g); err != nil {
			return err
		}
		d, err := s.world(ctx, q, g)
		if err != nil {
			return err
		}
		if err := s.appendLog(ctx, q, facts, txns, g.Ledger.Posted, now); err != nil {
			return err
		}
		if err := q.InsertTick(ctx, db.InsertTickParams{WorldID: s.World, Tick: g.Tick(), Digest: d, Facts: int32(len(facts)), Ms: int32(ms)}); err != nil {
			return err
		}
		if g.Tick()%sheets.TicksPerDay == 0 {
			if err := s.snapshot(ctx, q, g, d); err != nil {
				return err
			}
		}
		out = TickSaved{Digest: d, Facts: len(facts)}
		return nil
	})
	if err == nil {
		s.tick = g.Tick()
	}
	return out, err
}

func (s *Store) snapshot(ctx context.Context, q *db.Queries, g *game.Game, digest string) error {
	body, err := json.Marshal(g)
	if err != nil {
		return err
	}
	return q.InsertSnapshot(ctx, db.InsertSnapshotParams{WorldID: s.World, Tick: g.Tick(), Seq: s.acts, Digest: digest, Body: body})
}

// SaveAction writes one accepted command in one transaction: its record
// (unique on the interaction id), the characters it changed, the world
// row, and its facts and ledger. discord names the Discord user of a
// created character.
func (s *Store) SaveAction(ctx context.Context, g *game.Game, cmd game.Command, c *game.Char, discord string, reply []byte, now time.Time) error {
	facts, txns := g.Flush()
	cmdJSON, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	seq := s.acts + 1
	err = s.tx(ctx, func(q *db.Queries) error {
		if err := q.InsertAction(ctx, db.InsertActionParams{WorldID: s.World, Seq: seq, InteractionID: cmd.Key, AfterTick: g.Tick(),
			CharacterID: c.C.ID, Kind: cmd.Kind, Command: cmdJSON, Reply: reply}); err != nil {
			return err
		}
		if err := s.char(ctx, q, c, discord); err != nil {
			return err
		}
		if _, err := s.world(ctx, q, g); err != nil {
			return err
		}
		return s.appendLog(ctx, q, facts, txns, g.Ledger.Posted, now)
	})
	if err != nil {
		return err
	}
	s.acts = seq
	return nil
}

// Reply is the stored reply to an interaction already applied, or nil.
func (s *Store) Reply(ctx context.Context, interaction string) ([]byte, error) {
	r, err := s.Q.ActionReply(ctx, db.ActionReplyParams{WorldID: s.World, InteractionID: interaction})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return r, err
}

// CharacterOf is the character a Discord user plays, or "".
func (s *Store) CharacterOf(ctx context.Context, discord string) (string, error) {
	id, err := s.Q.CharacterByDiscord(ctx, db.CharacterByDiscordParams{WorldID: s.World, DiscordID: discord})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}
