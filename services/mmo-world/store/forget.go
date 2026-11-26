package store

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"jams.team/mmo-world/mapview"
	"jams.team/mmo-world/store/db"
)

// Tombstone starts the Discord id a forgotten character keeps (GDD 14.9):
// "forgotten:<character id>", unique per world as the column must be, and
// matched by no read by or of a Discord id. queries.sql spells it out.
const Tombstone = "forgotten:"

// Forgotten reports whether a stored Discord id is a tombstone.
func Forgotten(discord string) bool { return strings.HasPrefix(discord, Tombstone) }

// forgetIdentity removes a character's Discord identity, inside the
// transaction that saves its forget command: the character row keeps a
// tombstone, the house log rows of the character and of its user lose the
// user, and the last-seen map rows it held are deleted. Facts, the ledger,
// actions and snapshots name only the character, and stay. Forgetting a
// character forgotten before blanks nothing new.
func (s *Store) forgetIdentity(ctx context.Context, q *db.Queries, id string) error {
	discord, err := q.ForgetCharacterDiscord(ctx, db.ForgetCharacterDiscordParams{WorldID: s.World, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		discord, err = "", nil
	}
	if err != nil {
		return err
	}
	if _, err := q.ForgetHouseLogDiscord(ctx, db.ForgetHouseLogDiscordParams{WorldID: s.World, CharacterID: id, DiscordID: discord}); err != nil {
		return err
	}
	holder := db.DeleteMapHolderSeenParams{WorldID: s.World, HolderKind: mapview.HolderCharacter, HolderID: id}
	if err := q.DeleteMapHolderSeen(ctx, holder); err != nil {
		return err
	}
	return q.DeleteMapHolderSight(ctx, db.DeleteMapHolderSightParams(holder))
}

// DiscordsOf are the Discord users of characters, by character; a character
// the store holds no user for, or one forgotten, is left out.
func (s *Store) DiscordsOf(ctx context.Context, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.q.DiscordsOf(ctx, db.DiscordsOfParams{WorldID: s.World, Ids: ids})
	if err != nil {
		return nil, err
	}
	for _, x := range rows {
		out[x.ID] = x.DiscordID
	}
	return out, nil
}
