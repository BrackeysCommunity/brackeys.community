package api

// Paths of the story: arcs, the season and the chronicle (GDD 12).
const (
	// PathChronicle takes ?character=&day=; with no day, the last closed one.
	PathChronicle = "/v1/chronicle"
	// PathChronicleFact takes ?character=&id= and answers a fact with its causes.
	PathChronicleFact = "/v1/chronicle/fact"
	// PathStoryEvents takes ?after=<fact id>; it is the bot's alone.
	PathStoryEvents   = "/v1/story/events"
	PathArcs          = "/v1/arcs" // ?character=
	PathOperatorStory = "/v1/operator/story"
)

// Action kinds of the story. A goal-back names its side goal in Target, as
// goal-deliver does; goods carry Asset and Units, and a beats side's first
// one, with none, declares for it. A pattern-set names its point in To and
// the value in Units.
const (
	ActBackSide   = "goal-back"
	ActCityRaise  = "city-raise"
	ActPatternSet = "pattern-set"
)

// Operator kinds of the story. Each acts on the world, so it names no
// character. OpSeasonStart starts a season on a world from before seasons;
// the service sends it itself at open. OpSeasonEpoch takes a rules epoch at
// a season's close (Epoch). OpArcCast casts a template with its cast bound
// by hand (Arc).
const (
	OpSeasonStart = "season-start"
	OpSeasonEpoch = "season-epoch"
	OpArcCast     = "arc-cast"
)

// EventKinds are the fact kinds the events channel posts.
var EventKinds = []string{
	"trouble.started", "trouble.held", "trouble.lost",
	"arc.cast", "arc.stage-began", "arc.stage-ended", "arc.ended",
	"season.began", "season.finale", "season.closed",
	"city.raised", "city.fell-back", "settlement.ruined", "faction.city",
	"core.opened", "pattern.solved",
}

// Refusal codes of the story.
const (
	CodeNotASide      = "not-a-side"
	CodeOtherSide     = "other-side"
	CodeStageOver     = "stage-over"
	CodeShunned       = "shunned"
	CodeCityNotReady  = "city-not-ready"
	CodeAlreadyCity   = "already-city"
	CodeProjectOpen   = "project-open"
	CodeRuined        = "ruined"
	CodeNoPattern     = "no-pattern"
	CodePatternSolved = "pattern-solved"
	CodeSeasonRunning = "season-running"
	CodeNotAtBoundary = "not-at-boundary"
	CodeNoTemplate    = "no-template"
	CodeCastMisfit    = "cast-misfit"
	CodeSlotBusy      = "slot-busy"
	CodeNoSeason      = "no-season"
	CodeCrossesEpoch  = "crosses-epoch"
)

// Season is where the world is in its season (GDD 12.6). Day is 1-based
// and Band one of opening, rising, last and finale.
type Season struct {
	N    int64  `json:"n"`
	Day  int64  `json:"day"`
	Days int64  `json:"days"`
	Band string `json:"band"`
	Ends int64  `json:"ends"` // the tick it closes at
}

// CastRef is one role of an arc's cast and what fills it.
type CastRef struct {
	Role string `json:"role"`
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

// Side is one side of an arc's stage (GDD 12.2): what it wants, its mark and
// how full it is, what it pays, and who sponsors and opposes it. At is where
// goods land or beats count, by name; AtHex the tile, where there is one.
type Side struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Wants   string `json:"wants"` // goods, beats, reach, sold, defence
	Tag     string `json:"tag,omitempty"`
	Goal    string `json:"goal"`
	Mark    int64  `json:"mark"`
	Filled  int64  `json:"filled"`
	Backers int64  `json:"backers"`
	// Contributors are characters who put units in; Backers also counts
	// declared backers who have not.
	Contributors int64  `json:"contributors,omitempty"`
	Pay          int64  `json:"pay"` // coin
	At           string `json:"at"`
	AtHex        *Hex   `json:"atHex,omitempty"`
	Sponsor      string `json:"sponsor"`
	Opponent     string `json:"opponent,omitempty"`
	Mine         bool   `json:"mine"` // the viewer backs it
}

// Arc is an arc as the world shows it. Stage is the stage running, 0-based;
// Due is the tick it ends at and DueDay the season day. Outcome is the won
// side of the last stage, or lapsed.
type Arc struct {
	ID       string    `json:"id"`
	Template string    `json:"template"`
	Title    string    `json:"title"`
	Scope    string    `json:"scope"` // world, region, settlement, personal
	Cast     []CastRef `json:"cast"`
	Regions  []string  `json:"regions"`
	Seat     Hex       `json:"seat"`
	Stage    int64     `json:"stage"`
	Stages   int64     `json:"stages"`
	Due      int64     `json:"due"`
	DueDay   int64     `json:"dueDay"`
	Sides    []Side    `json:"sides"`
	Outcome  string    `json:"outcome,omitempty"`
	Began    int64     `json:"began"` // tick
	Lapsed   bool      `json:"lapsed,omitempty"`
	// Trouble is a settlement arc's trouble as its place shows it.
	Trouble *Trouble `json:"trouble,omitempty"`
}

// Arcs is /arcs for a character: the season, the arcs open and those ended
// lately, and the side goals it backs.
type Arcs struct {
	Season  Season   `json:"season"`
	Open    []Arc    `json:"open"`
	Ended   []Arc    `json:"ended"`
	Backing []string `json:"backing"`
}

// SideOption is a side a character could back now: its goal, what is left
// of its mark, and where it is served.
type SideOption struct {
	Goal   string `json:"goal"`
	Arc    string `json:"arc"`
	Side   string `json:"side"`
	Wants  string `json:"wants"`
	Tag    string `json:"tag,omitempty"`
	Left   int64  `json:"left"`
	At     Hex    `json:"at"`
	Region string `json:"region"`
	Backed bool   `json:"backed"`
}

// Trouble is a settlement's trouble (GDD 12.5): Why is the fact it was cast
// from, Defence how much of the mark is held so far, Ends the tick it is
// decided at, and Hunt a raid's hunt.
type Trouble struct {
	Arc     string `json:"arc"`
	Kind    string `json:"kind"`
	Title   string `json:"title"`
	Banner  string `json:"banner"` // a media key
	Why     *Fact  `json:"why,omitempty"`
	Mark    int64  `json:"mark"`
	Defence int64  `json:"defence"`
	Ends    int64  `json:"ends"`
	Hunt    string `json:"hunt,omitempty"`
}

// Occasion is a settlement's occasion, until the tick it ends.
type Occasion struct {
	Kind   string `json:"kind"`
	Banner string `json:"banner"` // a media key
	Ends   int64  `json:"ends"`
}

// CityNeed is one requirement of a city (GDD 4.8) and how far along it is.
type CityNeed struct {
	ID   string `json:"id"`
	Have int64  `json:"have"`
	Need int64  `json:"need"`
	Unit string `json:"unit"`
	Met  bool   `json:"met"`
}

// CityState is whether a settlement is a city, since when (a tick), its
// outer tiles, and what becoming one still takes.
type CityState struct {
	City   bool       `json:"city"`
	Raised int64      `json:"raised,omitempty"`
	Tiles  []Hex      `json:"tiles,omitempty"`
	Needs  []CityNeed `json:"needs,omitempty"`
}

// PatternPoint is a pattern's point as the viewer stands on it (GDD 4.13):
// which board, its kind, what stands there and the machine family that sets
// it, the value held there if any, and the clues the viewer has found. It
// never carries the solution.
type PatternPoint struct {
	Board  string `json:"board"`
	Kind   string `json:"kind"`
	Place  string `json:"place"`            // relay, pylon, beacon, landmark, vault
	Family string `json:"family,omitempty"` // empty: set by a delivery
	Point  int64  `json:"point"`
	Points int64  `json:"points"`
	Values int64  `json:"values"`
	Held   *int64 `json:"held,omitempty"`
	Solved bool   `json:"solved"`
	Clues  []Fact `json:"clues,omitempty"`
	// LapseDays is how long a set value holds before it lapses unsolved.
	LapseDays int64 `json:"lapseDays"`
}

// ChronicleLine is one line of a day's chronicle: the fact, whether it
// touches the reader's server's places, and how many causes it has.
type ChronicleLine struct {
	Fact   Fact  `json:"fact"`
	Here   bool  `json:"here,omitempty"`
	Causes int64 `json:"causes,omitempty"`
}

// Chronicle is one closed world day (GDD 12.7): its heaviest lines, how
// many more there were, and the earlier days that can be opened.
type Chronicle struct {
	Season  Season          `json:"season"`
	Day     int64           `json:"day"`
	Lines   []ChronicleLine `json:"lines"`
	More    int64           `json:"more"`
	Earlier []int64         `json:"earlier"`
}

// FactCauses is a fact and its causes, one level deep; each cause opens the
// same way.
type FactCauses struct {
	Fact   Fact   `json:"fact"`
	Causes []Fact `json:"causes"`
}

// StoryEvent is one fact for the events channel, with a snapshot of its arc
// or trouble. Alarm says a raid's start that mentions the alarm role.
type StoryEvent struct {
	Fact    Fact     `json:"fact"`
	Arc     *Arc     `json:"arc,omitempty"`
	Trouble *Trouble `json:"trouble,omitempty"`
	Place   string   `json:"place,omitempty"`
	Alarm   bool     `json:"alarm,omitempty"`
}

// StoryEvents are the events after a fact id; Last is the id to ask after
// next.
type StoryEvents struct {
	Events []StoryEvent `json:"events"`
	Last   int64        `json:"last"`
}

// StoryView is the operator's view of the story. Boards carry progress,
// never solutions.
type StoryView struct {
	Season Season      `json:"season"`
	Arcs   []Arc       `json:"arcs"`
	Ring   *RingView   `json:"ring,omitempty"`
	Boards []BoardView `json:"boards"`
}

// RingView is the ring of eight (GDD 4.13): its towers, those fallen this
// season, and the core at its centre.
type RingView struct {
	Towers []Hex `json:"towers"`
	Fell   []Hex `json:"fell"`
	Core   Hex   `json:"core"`
	Open   bool  `json:"open"`
}

// BoardView is a pattern board as an operator reads it: Marks counts the
// points set.
type BoardView struct {
	ID     string `json:"id"`
	Rule   string `json:"rule"`
	Kind   string `json:"kind"`
	Points []Hex  `json:"points"`
	Marks  int64  `json:"marks"`
	Solved bool   `json:"solved"`
}

// Epoch is a rules epoch taken at a season's close (GDD 18.5): the sheets
// digests before and after, and how many sheets changed.
type Epoch struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Sheets int64  `json:"sheets"`
}

// ArcOrder is what an arc-cast carries: the template, its cast by role, and
// the seat, where it is not the cast's own.
type ArcOrder struct {
	Template string    `json:"template"`
	Cast     []CastRef `json:"cast"`
	Seat     *Hex      `json:"seat,omitempty"`
}
