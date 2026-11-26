package export

// Beat is one press on a beat: what was offered and at which bands, the
// pick, and whether it succeeded. Offered is absent where the store did
// not keep it.
type Beat struct {
	Day       int64        `json:"day"`
	Tick      int64        `json:"tick"`
	Character string       `json:"character"`
	Server    string       `json:"server,omitempty"`
	What      string       `json:"what"` // fight, theft or hunt
	Beat      int64        `json:"beat,omitempty"`
	Beats     int64        `json:"beats,omitempty"`
	Kind      string       `json:"kind,omitempty"`
	Tier      int64        `json:"tier,omitempty"`
	Party     int64        `json:"party"`
	Floor     int64        `json:"floor,omitempty"`
	Ambush    bool         `json:"ambush,omitempty"`
	Offered   []OptionSeen `json:"offered,omitempty"`
	Pick      string       `json:"pick"`
	Band      string       `json:"band"`
	Success   bool         `json:"success"`
	Ended     string       `json:"ended,omitempty"` // won or lost, when the press ended the encounter
}

// Puzzle is one machine worked: what it was, how long it gave and took,
// and whether it was solved. Practice, tier, countdown and ticks are
// absent where the store did not keep them.
type Puzzle struct {
	Day       int64  `json:"day"`
	Tick      int64  `json:"tick"`
	Character string `json:"character"`
	Server    string `json:"server,omitempty"`
	Source    string `json:"source,omitempty"`
	Family    string `json:"family"`
	Level     int64  `json:"level"`
	Practice  *int64 `json:"practice,omitempty"`
	Tier      *int64 `json:"tier,omitempty"`
	Party     int64  `json:"party"`
	Countdown *int64 `json:"countdown,omitempty"` // ms; 0 for a bench
	Ticks     *int64 `json:"ticks,omitempty"`     // world ticks from arming to the solve
	Ms        int64  `json:"ms"`                  // the solve's millisecond in the log
	Moves     int64  `json:"moves"`
	Solved    bool   `json:"solved"`
	Clean     bool   `json:"clean,omitempty"`
	Late      bool   `json:"late,omitempty"`
	Master    bool   `json:"master,omitempty"`
	Haywire   string `json:"haywire,omitempty"`
}

// Day is a character at the close of a world day. Active is the sim's
// active (acted within the economy's active days, not banned); Acted that
// it sent a command this day.
type Day struct {
	Day           int64            `json:"day"`
	Character     string           `json:"character"`
	Server        string           `json:"server,omitempty"`
	Active        bool             `json:"active"`
	Acted         bool             `json:"acted"`
	Actions       map[string]int64 `json:"actions"`
	Coin          int64            `json:"coin"`
	GoodsValue    int64            `json:"goodsValue"` // provisions, clean goods and carried items at reference value
	XP            int64            `json:"xp"`         // xp its carried items other than mounts hold, levels counted
	BestItemLevel int64            `json:"bestItemLevel"`
	Classes       []string         `json:"classes"`
}

// Milestone kinds.
const (
	MilestoneClass   = "class-unlocked"
	MilestoneItem5   = "item-level-5"
	MilestoneItem20  = "item-level-20"
	MilestoneGuild   = "guild-founded"
	MilestoneCity    = "city"
	MilestoneInvited = "thief-invited"
)

// Milestone is one step a character, or the world, reached. First is the
// character's first of its kind; TicksSinceBorn counts from its creation,
// DaysSinceTheft from its first theft.
type Milestone struct {
	Day            int64  `json:"day"`
	Tick           int64  `json:"tick"`
	Character      string `json:"character,omitempty"`
	Server         string `json:"server,omitempty"`
	Kind           string `json:"kind"`
	Class          string `json:"class,omitempty"`
	WorldFirst     bool   `json:"worldFirst,omitempty"`
	Tier           int64  `json:"tier,omitempty"`
	First          bool   `json:"first"`
	TicksSinceBorn *int64 `json:"ticksSinceBorn,omitempty"`
	DaysSinceTheft *int64 `json:"daysSinceTheft,omitempty"`
}

// WorldDay is the world at the close of a day. Staged is the event points
// each server's staging spent that day.
type WorldDay struct {
	Day           int64            `json:"day"`
	World         string           `json:"world"`
	Season        *int64           `json:"season,omitempty"`
	SeasonDay     *int64           `json:"seasonDay,omitempty"`
	Characters    int64            `json:"characters"`
	Active        int64            `json:"active"`
	Acted         int64            `json:"acted"`
	CoinPerActive int64            `json:"coinPerActive"`
	Actions       int64            `json:"actions"`
	PeakPerMinute int64            `json:"peakPerMinute"` // the most commands in one minute of the service's clock
	Staged        map[string]int64 `json:"staged"`
}
