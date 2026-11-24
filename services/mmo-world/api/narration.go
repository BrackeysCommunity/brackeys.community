package api

const (
	// ActKindName names a kind once, by its first maker, within its days:
	// Option is the kind id, Note the name.
	ActKindName = "kind-name"
	// PathArcKit is what an arc proposal may use: the operator's alone.
	PathArcKit = "/v1/operator/arc-kit"
)

// Art is an authored picture for a slot, and the slot it fills.
type Art struct {
	Key  string `json:"key"`
	Slot string `json:"slot"`
}

// Dossier is what an NPC brings to a conversation beyond its topics: who
// it is, what it remembers of the viewer and of the world, and what it has
// folded away (GDD 4.18). Another player is named only as their consent
// allows.
type Dossier struct {
	Day         int64             `json:"day"`
	Role        string            `json:"role"`
	Traits      []string          `json:"traits"`
	Faction     string            `json:"faction,omitempty"`
	Place       string            `json:"place"`
	About       []Memory          `json:"about"`  // most salient about the viewer
	World       []Memory          `json:"world"`  // most salient about the world
	Oldest      []Memory          `json:"oldest"` // the oldest kept
	Folded      []TypeCount       `json:"folded,omitempty"`
	FoldedTotal int64             `json:"foldedTotal"`
	Names       map[string]string `json:"names"`
}

// Memory is one remembered entry as a client may tell it.
type Memory struct {
	Kind  string `json:"kind"`
	Tick  int64  `json:"tick"`
	Fact  int64  `json:"fact,omitempty"`
	Thing string `json:"thing,omitempty"` // a name
	Who   string `json:"who,omitempty"`   // "you", the character id of a player who allows naming, "a traveller", or "a traveller from <guild>"
	N     int64  `json:"n,omitempty"`
	Unit  string `json:"unit,omitempty"`
}

// ArcKit is what a proposed story.arcs row may name.
type ArcKit struct {
	Season    int64    `json:"season"`
	Templates []string `json:"templates"`
	When      []string `json:"when"`
	Effects   []string `json:"effects"`
	Schema    string   `json:"schema"` // the story.arcs row schema, as JSON
}
