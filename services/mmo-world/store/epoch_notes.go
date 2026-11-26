package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/store/db"
)

// Stamp is what a world runs on: its sheets digest and roll epoch. A rules
// epoch moves both together (GDD 18.5).
type Stamp struct {
	Sheets string
	Roll   int32
}

// Stamp is the stamp the world row holds.
func (m Meta) Stamp() Stamp { return Stamp{Sheets: m.SheetsDigest, Roll: m.RulesEpoch} }

// RestampEpoch moves a kept world from exactly the stamp from onto to, in
// one statement: a world on any other stamp stays refused, and so does a
// restamp that moves nothing.
func (s *Store) RestampEpoch(ctx context.Context, from, to Stamp) error {
	if from.Sheets == "" || to.Sheets == "" {
		return fmt.Errorf("store: an epoch restamp of world %s needs both digests", s.World)
	}
	if from == to {
		return fmt.Errorf("store: an epoch restamp of world %s from %s at roll epoch %d moves nothing", s.World, from.Sheets, from.Roll)
	}
	n, err := s.q.RestampEpoch(ctx, db.RestampEpochParams{ID: s.World, FromDigest: from.Sheets, FromEpoch: from.Roll, ToDigest: to.Sheets, ToEpoch: to.Roll})
	if err != nil {
		return err
	}
	if n != 1 {
		return fmt.Errorf("%w: world %s does not run on %s at roll epoch %d, so it was not restamped", ErrOtherSheets, s.World, from.Sheets, from.Roll)
	}
	return nil
}

// SaveEpochNotes writes a season's epoch notes. Writing the same season
// again replaces its notes and keeps the time of the first write, so a
// restart that saves them again changes nothing.
func (s *Store) SaveEpochNotes(ctx context.Context, n api.EpochNotes, rollFrom, rollTo int32) error {
	if n.Seen == nil {
		n.Seen = []api.EpochNote{}
	}
	body, err := json.Marshal(n)
	if err != nil {
		return err
	}
	return s.q.UpsertEpochNote(ctx, db.UpsertEpochNoteParams{WorldID: s.World, Season: n.Season, FromDigest: n.From, ToDigest: n.To,
		RollFrom: rollFrom, RollTo: rollTo, Notes: body})
}

// EpochNotes are a season's stored epoch notes; false when its season took
// no epoch.
func (s *Store) EpochNotes(ctx context.Context, season int64) (api.EpochNotes, bool, error) {
	row, err := s.q.EpochNoteFor(ctx, db.EpochNoteForParams{WorldID: s.World, Season: season})
	if errors.Is(err, pgx.ErrNoRows) {
		return api.EpochNotes{}, false, nil
	}
	if err != nil {
		return api.EpochNotes{}, false, err
	}
	var n api.EpochNotes
	if err := json.Unmarshal(row.Notes, &n); err != nil {
		return api.EpochNotes{}, false, err
	}
	if n.Seen == nil {
		n.Seen = []api.EpochNote{}
	}
	return n, true, nil
}
