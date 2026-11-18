package harness

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/sheets"
)

const schemaDialect = "https://json-schema.org/draft/2020-12/schema"

var idPattern = `^[a-z0-9]+(-[a-z0-9]+)*$`

// Schema generates the JSON Schema for one sheet from its Go row type, so
// the schema and the loader can never disagree. The output is checked in
// under sheets/schema and the Check run fails when it is stale.
func Schema(d sheets.Def) ([]byte, error) {
	row, err := objectSchema(d.Row)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", d.Name, err)
	}
	s := ordered{
		{"$schema", schemaDialect},
		{"$id", d.Name},
		{"title", d.Name},
		{"description", d.Doc},
		{"type", "object"},
		{"additionalProperties", false},
		{"required", []string{"sheet", "rows"}},
		{"properties", ordered{
			{"$schema", ordered{{"type", "string"}}},
			{"sheet", ordered{{"const", d.Name}}},
			{"rows", ordered{{"type", "array"}, {"items", row}}},
		}},
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

func objectSchema(t reflect.Type) (ordered, error) {
	var props ordered
	required := []string{}
	for i := range t.NumField() {
		f := t.Field(i)
		name := sheets.JSONName(f)
		unit := f.Tag.Get("unit")
		if unit == "" {
			return nil, fmt.Errorf("column %s.%s has no unit", t.Name(), name)
		}
		if !slices.Contains(sheets.Units(), unit) {
			return nil, fmt.Errorf("column %s.%s has unknown unit %q", t.Name(), name, unit)
		}
		col, err := columnSchema(f, unit)
		if err != nil {
			return nil, fmt.Errorf("column %s.%s: %w", t.Name(), name, err)
		}
		props = append(props, kv{name, col})
		if !strings.Contains(f.Tag.Get("json"), "omitempty") {
			required = append(required, name)
		}
	}
	return ordered{
		{"type", "object"},
		{"additionalProperties", false},
		{"required", required},
		{"properties", props},
	}, nil
}

var fixedType = reflect.TypeFor[fixed.F]()

func columnSchema(f reflect.StructField, unit string) (ordered, error) {
	var c ordered
	t := f.Type
	switch {
	case t == fixedType:
		c = append(c, kv{"type", "number"}, kv{"multipleOf", fixedStep()})
	case t.Kind() == reflect.Int64:
		c = append(c, kv{"type", "integer"})
	case t.Kind() == reflect.Bool:
		c = append(c, kv{"type", "boolean"})
	case t.Kind() == reflect.String:
		c = append(c, kv{"type", "string"})
		if unit == "id" {
			c = append(c, kv{"pattern", idPattern})
		}
		c = append(c, enumOf(f)...)
	case t.Kind() == reflect.Slice && t.Elem().Kind() == reflect.String:
		item := ordered{{"type", "string"}}
		item = append(item, enumOf(f)...)
		c = append(c, kv{"type", "array"}, kv{"items", item}, kv{"uniqueItems", true})
	case t.Kind() == reflect.Slice && t.Elem().Kind() == reflect.Int64:
		c = append(c, kv{"type", "array"}, kv{"items", ordered{{"type", "integer"}}})
	case t.Kind() == reflect.Slice && t.Elem().Kind() == reflect.Struct:
		obj, err := objectSchema(t.Elem())
		if err != nil {
			return nil, err
		}
		c = append(c, kv{"type", "array"}, kv{"items", obj})
	case t.Kind() == reflect.Struct:
		obj, err := objectSchema(t)
		if err != nil {
			return nil, err
		}
		c = append(c, obj...)
	default:
		return nil, fmt.Errorf("unsupported type %s", t)
	}
	if lo, ok := f.Tag.Lookup("min"); ok {
		c = append(c, kv{"minimum", json.Number(lo)})
	}
	if hi, ok := f.Tag.Lookup("max"); ok {
		c = append(c, kv{"maximum", json.Number(hi)})
	}
	c = append(c, kv{"x-unit", unit})
	if ref := f.Tag.Get("ref"); ref != "" {
		c = append(c, kv{"x-ref", ref})
	}
	if doc := f.Tag.Get("doc"); doc != "" {
		c = append(c, kv{"description", doc})
	}
	return c, nil
}

func enumOf(f reflect.StructField) ordered {
	if e := sheets.EnumValues(f); e != nil {
		return ordered{{"enum", e}}
	}
	return nil
}

func fixedStep() json.Number {
	return json.Number("0." + strings.Repeat("0", len(strconv.Itoa(fixed.Scale))-2) + "1")
}

// ordered is a JSON object that keeps its key order, so generated schemas
// read top to bottom like the row type.
type kv struct {
	K string
	V any
}
type ordered []kv

func (o ordered) MarshalJSON() ([]byte, error) {
	var b strings.Builder
	b.WriteByte('{')
	for i, p := range o {
		if i > 0 {
			b.WriteByte(',')
		}
		k, _ := json.Marshal(p.K)
		v, err := json.Marshal(p.V)
		if err != nil {
			return nil, err
		}
		b.Write(k)
		b.WriteByte(':')
		b.Write(v)
	}
	b.WriteByte('}')
	return []byte(b.String()), nil
}
