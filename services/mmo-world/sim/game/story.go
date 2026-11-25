package game

import (
	"encoding/json"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/pattern"
	"jams.team/mmo-world/sim/season"
)

// Story is the director's state (GDD 12). It is nil on a game saved
// before the director.
type Story struct {
	Clock    *season.Clock `json:"clock,omitempty"`
	Arcs     []*Arc        `json:"arcs,omitempty"` // open, then those ended within kept-arc-days
	NextArc  int64         `json:"nextArc,omitempty"`
	Rests    []ScopeRest   `json:"rests,omitempty"`    // sorted by scope, ref
	Backers  []Backing     `json:"backers,omitempty"`  // sorted by char, arc, stage
	Memory   []arc.Memory  `json:"memory,omitempty"`   // oldest first, capped
	Streaks  []Streak      `json:"streaks,omitempty"`  // by region
	Starving []int64       `json:"starving,omitempty"` // days running each faction, by index, has starved
	Pending  []arc.Pending `json:"pending,omitempty"`
	At       []PlaceStory  `json:"places,omitempty"` // by place index, grown lazily
	Cities   []FactionCity `json:"factionCities,omitempty"`
	Ring     *Ring         `json:"ring,omitempty"`
	Patterns []*Board      `json:"patterns,omitempty"`
	Spreads  []Spread      `json:"spreads,omitempty"`
	Sight    []RegionBonus `json:"sight,omitempty"`
	// clues is the scaffold's clue sites by chunk, never saved.
	clues *clueCache
	// kinds is Memory by kind, never saved.
	kinds *ringIndex
	// threads is the open personal threads by character and offering
	// faction, never saved.
	threads *threadIndex
	// active is this tick's active count for the offer cap, never saved.
	active activeCount
	// queued counts the candidates pend took since the story loaded, for
	// the harness; never saved.
	queued Queued
}

// UnmarshalJSON loads a story and indexes its memory ring, so the first
// day after a load reads the ring at the cost of any other.
func (s *Story) UnmarshalJSON(b []byte) error {
	type plain Story
	if err := json.Unmarshal(b, (*plain)(s)); err != nil {
		return err
	}
	s.kinds = nil
	s.ring()
	return nil
}

// Arc is one cast template running through its stages.
type Arc struct {
	ID       string     `json:"id"` // "arc-<n>"
	Template string     `json:"template"`
	Scope    string     `json:"scope"`
	Cast     arc.Cast   `json:"cast"`
	Regions  []int      `json:"regions"`
	Seat     hex.Hex    `json:"seat"`
	Place    string     `json:"place,omitempty"` // settlement scope: the settlement ref
	Char     string     `json:"char,omitempty"`  // personal
	By       string     `json:"by"`              // director, operator, finale, opening, pattern, effect
	Stage    int        `json:"stage"`
	Stages   []StageRun `json:"stages"`
	Began    int64      `json:"began"`
	Ended    int64      `json:"ended,omitempty"`
	Outcome  string     `json:"outcome,omitempty"` // the last stage's won side, or "lapsed"
	Cause    []fact.ID  `json:"cause,omitempty"`
	Fact     fact.ID    `json:"fact"`
	Hunt     string     `json:"hunt,omitempty"` // a raid's hunt
	// HuntSlain: the raid's hunt fell, kept here since a closed hunt is
	// forgotten next day.
	HuntSlain bool `json:"huntSlain,omitempty"`
	// Via is the faction whose offer cap a personal thread counts against
	// while it runs: the one that offered it, or the one a rival is against.
	Via fact.Ref `json:"via,omitempty,omitzero"`
	// Staging is the server staging that cast it, By ByServer; Stage is
	// the arc's own stage index.
	Staging string `json:"staging,omitempty"`
}

// ByServer casts an arc a server's staging bound by hand.
const ByServer = "server"

// StageRun is one stage of an arc as it runs.
type StageRun struct {
	Began  int64     `json:"began"`
	Due    int64     `json:"due"` // tick
	Sides  []SideRun `json:"sides"`
	Won    string    `json:"won,omitempty"`
	Lapsed bool      `json:"lapsed,omitempty"`
	Ended  int64     `json:"ended,omitempty"`
	Fact   fact.ID   `json:"fact,omitempty"`
}

// SideRun is one side of a stage: its pooled goal and what it asks.
type SideRun struct {
	Side     string `json:"side"`
	Goal     string `json:"goal"`
	Mark     int64  `json:"mark"`
	Sponsor  int    `json:"sponsor"`  // faction index, or econ.Keepers
	Opponent int    `json:"opponent"` // faction index, or -1
	At       string `json:"at"`       // settlement ref (goods), region refs (beats) or tile ref (reach)
}

// ScopeRest keeps a scope's ref from being cast again until a tick.
type ScopeRest struct {
	Scope string   `json:"scope"`
	Ref   fact.Ref `json:"ref"`
	Until int64    `json:"until"` // tick
}

// Backing is a character's declared side in one stage.
type Backing struct {
	Char  string `json:"char"`
	Arc   string `json:"arc"`
	Stage int    `json:"stage"`
	Side  string `json:"side"`
	Goal  string `json:"goal"`
}

// Streak is the days running a region has held each condition.
type Streak struct {
	Region  int   `json:"region"`
	Prosper int64 `json:"prosper,omitempty"`
	Cold    int64 `json:"cold,omitempty"`
	Wet     int64 `json:"wet,omitempty"`
	Low     int64 `json:"low,omitempty"`  // scarcity under seam-below
	Holder  int   `json:"holder"`         // the region's holder when last counted
	Held    int64 `json:"held,omitempty"` // days the holder has held it
}

// PlaceStory is one place's story state: its troubles this season and the
// stakes running there.
type PlaceStory struct {
	Lost     int64     `json:"lost,omitempty"` // troubles lost this season
	Held     int64     `json:"held,omitempty"`
	Fees     int64     `json:"fees,omitempty"`   // tick raid fees run to
	Orders   int64     `json:"orders,omitempty"` // tick faction orders stop to
	Prices   int64     `json:"prices,omitempty"`
	Sick     int64     `json:"sick,omitempty"`
	Kept     bool      `json:"kept,omitempty"` // a city reached city-keep this season
	Occasion *Occasion `json:"occasion,omitempty"`
	Followed int64     `json:"followed,omitempty"` // tick a raid got in, for fire
	// Burgled are the ticks of won burglaries here, within walls-days.
	Burgled []int64 `json:"burgled,omitempty"`
}

// Occasion is a good thing happening at a place.
type Occasion struct {
	Kind  string  `json:"kind"`
	Began int64   `json:"began"`
	Ends  int64   `json:"ends"`
	Fact  fact.ID `json:"fact"`
}

// FactionCity is a faction's one city: its held region and its place.
type FactionCity struct {
	Faction int   `json:"faction"`
	Region  int   `json:"region"`
	Place   int   `json:"place"`
	Since   int64 `json:"since"`
}

// Ring is the ring of eight towers round the core (GDD 4.13).
type Ring struct {
	Season int64     `json:"season"`
	Towers []hex.Hex `json:"towers"`
	Core   hex.Hex   `json:"core"`
	Fell   []hex.Hex `json:"fell,omitempty"`  // sorted
	Open   int64     `json:"open,omitempty"`  // tick; 0 shut
	Until  int64     `json:"until,omitempty"` // season it stays open through
}

// Board is a pattern's puzzle as players work it; its solution is drawn on
// demand and never stored.
type Board struct {
	ID     string           `json:"id"` // rule + "@" + centre ref, or "placed-<n>"
	Rule   string           `json:"rule"`
	Points []hex.Hex        `json:"points"`
	Places []string         `json:"places"`
	Centre hex.Hex          `json:"centre"`
	Clues  []hex.Hex        `json:"clues,omitempty"`
	Found  []int            `json:"found,omitempty"` // clue indexes found
	Told   []fact.ID        `json:"told,omitempty"`  // the facts that found them, as Found
	P      pattern.Progress `json:"progress"`
	Placed bool             `json:"placed,omitempty"`
	Depth  int64            `json:"depth,omitempty"`
}

// Spread is a lapsed front still spreading corruption.
type Spread struct {
	Arc    string `json:"arc"`
	Region int    `json:"region"`
	Left   int64  `json:"left"`
}

// RegionBonus is sight a solved pattern adds in a region.
type RegionBonus struct {
	Region int   `json:"region"`
	N      int64 `json:"n"`
}

// Caller is an NPC who came to a tile to see a character (GDD 4.18).
type Caller struct {
	NPC  string  `json:"npc"`
	At   hex.Hex `json:"at"`
	Tick int64   `json:"tick"`
}

type activeCount struct {
	tick, n int64
	ok      bool
}
