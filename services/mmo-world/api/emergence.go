package api

// Paths of emergence (GDD 13): promotions as they happen and the
// operator's dashboard of the four measures.
const (
	// PathStoryPromotions takes ?after=<fact id>; it is the bot's alone and
	// answers StoryEvents carrying their Promotion.
	PathStoryPromotions   = "/v1/story/promotions"
	PathOperatorEmergence = "/v1/operator/emergence"
)

// ActPromoteName renames a promotion once, by its first, within the
// rename days: Option is the promotion id and Note the name (GDD 4.17).
const ActPromoteName = "promote-name"

// Refusal codes of emergence.
const (
	CodeNotFirst   = "not-first"
	CodeNameClosed = "name-closed"
)

// Promotion is a trace that crossed its line (GDD 13.2) and what it became.
// Places are a route's two ends. It never names its first to anyone else.
type Promotion struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Name   string `json:"name"`
	Region string `json:"region,omitempty"`
	At     *Hex   `json:"at,omitempty"`
	Places []int  `json:"places,omitempty"`
	Of     string `json:"of,omitempty"`
	// OfName is what Of names, in words: an archetype, pairing or trait, base
	// material, legend's creature or item, class, puzzle family or site kind.
	OfName   string `json:"ofName,omitempty"`
	Resists  string `json:"resists,omitempty"`
	Material string `json:"material,omitempty"`
	Day      int64  `json:"day"`
	// Yours: the viewer is its first; Renamable: and may still rename it.
	Yours     bool `json:"yours,omitempty"`
	Renamable bool `json:"renamable,omitempty"`
}

// Emergence is the operator's dashboard (GDD 13.5): the four measures with
// their healthy lines, the stored traces and the newest promotions.
type Emergence struct {
	Day    int64 `json:"day"`
	Season int64 `json:"season"`
	Active int64 `json:"active"`
	// KindsPerMille is new kinds per active character a week, oldest first.
	KindsPerMille []int64 `json:"kindsPerMille"`
	KindsHealthy  bool    `json:"kindsHealthy"`
	// Promotions are this season's, the eight types in order, each against
	// Need.
	Promotions        []TypeCount   `json:"promotions"`
	Need              int64         `json:"need"`
	PromotionsHealthy bool          `json:"promotionsHealthy"`
	Heavy             int64         `json:"heavy"`
	HeavyPlayer       int64         `json:"heavyPlayer"`
	HeavyHealthy      bool          `json:"heavyHealthy"`
	Pairing           []RegionShare `json:"pairing"`
	PairingHealthy    bool          `json:"pairingHealthy"`
	// Traces are the stored entries per trace.
	Traces []TypeCount `json:"traces"`
	// Recent are the newest 20 promotions.
	Recent []Promotion `json:"recent"`
}

// TypeCount is a count by promotion or trace type.
type TypeCount struct {
	Type  string `json:"type"`
	Count int64  `json:"count"`
}

// RegionShare is a region's most common style and its share of the
// region's wins.
type RegionShare struct {
	Region  string `json:"region"`
	Style   string `json:"style"`
	Name    string `json:"name"`
	Percent int64  `json:"percent"`
}
