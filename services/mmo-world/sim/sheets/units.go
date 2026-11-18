package sheets

import (
	"reflect"
	"slices"

	"jams.team/mmo-world/sim/fixed"
)

// TagWet marks terrain that holds water.
const TagWet = "wet"

// Wet reports whether the terrain holds water.
func (t *Terrain) Wet() bool { return slices.Contains(t.Tags, TagWet) }

// structural: the world clock's day, what turns a days cell into ticks.
const TicksPerDay = 144

// QuantityUnits are the units a number can carry (GDD 2.1), plus the
// dimensionless ones a sheet needs.
var QuantityUnits = []string{
	"coin", "goods", "pts", "durability", "xp", "level", "tier", "load",
	"health", "defence", "gauge", "standing", "event-points", "ticks",
	"days", "percent", "ratio", "count", "tiles", "weight", "chance",
	"band-steps", "beat", "seconds", "degrees",
}

// ShapeUnits describe a column that is not a quantity.
var ShapeUnits = []string{
	"id", "ref", "refs", "tag", "tags", "enum", "flag", "text", "effects",
	"row", "measure", "parts",
}

// Units is every unit a column may declare.
func Units() []string { return append(append([]string(nil), QuantityUnits...), ShapeUnits...) }

var fixedType = reflect.TypeFor[fixed.F]()

func parseFixed(s string) (fixed.F, error) { return fixed.Parse(s) }

// Lookup indexes a sheet's rows by id. Build it once per run, not per draw.
func Lookup[T any](rows []T) map[string]*T {
	out := make(map[string]*T, len(rows))
	for i := range rows {
		id := reflect.ValueOf(rows[i]).FieldByName("ID").String()
		out[id] = &rows[i]
	}
	return out
}

// ParamOf finds a cell in a params sheet. A missing cell is a sheet error
// the Check run reports; inside the sim it panics.
func ParamOf(rows []Param, id string) fixed.F {
	for _, r := range rows {
		if r.ID == id {
			return r.Value
		}
	}
	panic("sheets: no param " + id)
}

// IntParam is ParamOf for a whole-number cell.
func IntParam(rows []Param, id string) int64 {
	v := ParamOf(rows, id)
	if v.Mul(fixed.One) != v || int64(v)%fixed.Scale != 0 {
		panic("sheets: param " + id + " is not a whole number")
	}
	return v.Int()
}
