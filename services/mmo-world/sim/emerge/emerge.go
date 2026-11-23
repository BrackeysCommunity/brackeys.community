// Package emerge is emergence's pure half (GDD 13): the traces play leaves,
// the windows its lines read, the records a promotion makes, the style key,
// adaptation, found-material derivation and the names. It never imports
// the game; the game feeds it at each source and applies what it returns.
package emerge

import (
	"slices"

	"jams.team/mmo-world/sim/draw"
)

// Trace ids (emergence.traces).
const (
	Passage  = "passage"
	Clearing = "clearing"
	Loss     = "loss"
	Working  = "working"
	Haulage  = "haulage"
	Reliance = "reliance"
	Renown   = "renown"
	Mastery  = "mastery"
)

// TraceIDs are the eight traces in sheet order.
var TraceIDs = []string{Passage, Clearing, Loss, Working, Haulage, Reliance, Renown, Mastery}

// Type is what a promotion makes.
type Type string

const (
	Road    Type = "road"
	Camp    Type = "camp"
	Haunt   Type = "haunt"
	Route   Type = "route"
	Style   Type = "style"
	Variant Type = "variant"
	Legend  Type = "legend"
	Custom  Type = "custom"
	// Recorded the same way but not GDD 13.5's types.
	Material Type = "material"
	Class    Type = "class"
	Masters  Type = "masters"
)

// Types are the eight GDD 13.5 counts (a kind's first craft is counted apart).
var Types = []Type{Road, Camp, Haunt, Route, Style, Variant, Legend, Custom}

// AllTypes are every promotion type: the eight counts, then a found
// material, a found class and masters.
var AllTypes = slices.Concat(Types, []Type{Material, Class, Masters})

// Renamable reports whether a type's first may rename it (GDD 4.17).
func Renamable(t Type) bool {
	return t == Style || t == Variant || t == Material || t == Legend
}

// Draw labels, each its own purpose so no existing draw moves.
const (
	// DrawName (type, key, list): a name part.
	DrawName draw.Purpose = "emergence.name"
	// DrawVariant (region, archetype, style): a tie between adaptation rows.
	DrawVariant draw.Purpose = "emergence.variant"
	// DrawSpawn (encounter id): whether an encounter is the variant.
	DrawSpawn draw.Purpose = "emergence.spawn"
	// DrawHaunt (q, r): the haunt's lead.
	DrawHaunt draw.Purpose = "emergence.haunt"
	// DrawLegend (promotion id): the legend's trait.
	DrawLegend draw.Purpose = "emergence.legend"
)
