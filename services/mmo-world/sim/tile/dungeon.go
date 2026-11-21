package tile

import (
	"slices"

	"jams.team/mmo-world/sim/fact"
)

// Dungeon is what a dungeon entrance remembers: each floor's clearing and
// falls, the guardian's pool, and the name its first slayers gave it
// (GDD 4.9).
type Dungeon struct {
	// FloorsCleared and ClearedAt are the deepest floor cleared and when; a
	// save from before Floors holds its floor 1 only here.
	FloorsCleared  int64      `json:"floorsCleared"`
	ClearedAt      int64      `json:"clearedAt,omitempty"`
	Fell           []fact.Ref `json:"fell,omitempty"` // kept, never written again
	GuardianHealth int64      `json:"guardianHealth"` // kept, never written again

	Floors   []Floor   `json:"floors,omitempty"` // index n−1
	Name     string    `json:"name,omitempty"`
	NamedBy  []string  `json:"namedBy,omitempty"`
	NamedAt  int64     `json:"namedAt,omitempty"`
	Hidden   bool      `json:"hidden,omitempty"`  // an operator hid the name
	Namers   []string  `json:"namers,omitempty"`  // first slayers, until named
	SlainAt  int64     `json:"slainAt,omitempty"` // first slain, tick
	Guardian *Guardian `json:"guardian,omitempty"`
	Haunted  bool      `json:"haunted,omitempty"`
}

// Floor is one floor's record.
type Floor struct {
	ClearedAt int64  `json:"clearedAt,omitempty"`
	Way       int64  `json:"way,omitempty"` // the way taken down from it, +1 (0: none yet)
	Fell      []Fall `json:"fell,omitempty"`
}

// Fall is a character going down on a floor.
type Fall struct {
	Who  string `json:"who"`
	Tick int64  `json:"tick"`
}

// Guardian is the dungeon's guardian pool, which every party at the
// bottom wears down in turn.
type Guardian struct {
	Health int64 `json:"health"`
	Max    int64 `json:"max"`
	Ends   int64 `json:"ends,omitempty"`  // tick; 0: no window open
	Slain  int64 `json:"slain,omitempty"` // tick slain, until the bottom refills
	Marks  int64 `json:"marks,omitempty"` // marks already passed
}

// Cleared reports whether floor n stands cleared at tick, not yet
// refilled. A save from before floors were recorded keeps floor 1 in
// FloorsCleared and ClearedAt.
func (d *Dungeon) Cleared(n, tick, refillTicks int64) bool {
	if d == nil || n < 1 {
		return false
	}
	if f := d.Floor(n); f != nil && f.ClearedAt > 0 {
		return tick-f.ClearedAt < refillTicks
	}
	if n == 1 && len(d.Floors) == 0 && d.FloorsCleared >= 1 {
		return tick-d.ClearedAt < refillTicks
	}
	return false
}

// Floor is floor n's record, or nil when nothing is recorded of it.
func (d *Dungeon) Floor(n int64) *Floor {
	if d == nil || n < 1 || n > int64(len(d.Floors)) {
		return nil
	}
	return &d.Floors[n-1]
}

// Clear records floor n cleared at tick, and the way taken down from it
// (+1; 0 leaves it as it was). It keeps FloorsCleared the deepest.
func (d *Dungeon) Clear(n, way, tick int64) {
	d.grow(n)
	f := &d.Floors[n-1]
	f.ClearedAt = tick
	if way > 0 {
		f.Way = way
	}
	if n >= d.FloorsCleared {
		d.FloorsCleared, d.ClearedAt = n, tick
	}
}

// Fall records who went down on floor n at tick, forgetting falls older
// than keepTicks so the record stays as long as haunting reads.
func (d *Dungeon) Fall(n int64, who string, tick, keepTicks int64) {
	d.grow(n)
	for i := range d.Floors {
		d.Floors[i].Fell = slices.DeleteFunc(d.Floors[i].Fell, func(f Fall) bool { return tick-f.Tick >= keepTicks })
		if len(d.Floors[i].Fell) == 0 {
			d.Floors[i].Fell = nil
		}
	}
	d.Floors[n-1].Fell = append(d.Floors[n-1].Fell, Fall{Who: who, Tick: tick})
}

// Falls counts the falls on every floor at or after tick since.
func (d *Dungeon) Falls(since int64) int64 {
	if d == nil {
		return 0
	}
	var n int64
	for _, f := range d.Floors {
		for _, x := range f.Fell {
			if x.Tick >= since {
				n++
			}
		}
	}
	return n
}

// grow makes room for floor n, carrying an old save's floor 1 over first.
func (d *Dungeon) grow(n int64) {
	if len(d.Floors) == 0 && d.FloorsCleared >= 1 {
		d.Floors = append(d.Floors, Floor{ClearedAt: d.ClearedAt})
	}
	for int64(len(d.Floors)) < n {
		d.Floors = append(d.Floors, Floor{})
	}
}
