package world

import (
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/history"
)

// HistoryCell is one cell of the spatial index of heavy facts a digest
// reads: history-radius by history-radius axial tiles, the newest
// history-cell-kept entries.
type HistoryCell struct {
	I     int64           `json:"i"`
	J     int64           `json:"j"`
	Facts []history.Heavy `json:"facts"`
}

// Note indexes the located heavy facts among fs; a world from before
// content was drawn from history notes nothing.
func (s *State) Note(fs ...fact.Fact) {}

// DigestAt is the neighbourhood of h read at tick t, from state written
// before t only.
func (s *State) DigestAt(h hex.Hex, t int64) history.Digest { return history.Digest{} }

// DigestCost is DigestAt with how many entries, tiles, pins and finds it
// visited, which no world's age or size may raise.
func (s *State) DigestCost(h hex.Hex, t int64) (history.Digest, int64) {
	return history.Digest{}, 0
}
