package service

import (
	"reflect"
	"testing"

	"jams.team/mmo-world/sim/puzzle"
)

// TestLayoutRoundTrip sets every field of a layout and takes it to the
// wire and back: only the level and tier, which are never sent, are lost.
// A field added to puzzle.Layout and forgotten on either side fails here.
func TestLayoutRoundTrip(t *testing.T) {
	var l puzzle.Layout
	v := reflect.ValueOf(&l).Elem()
	for i := range v.NumField() {
		n := int64(i + 1)
		switch f := v.Field(i); f.Interface().(type) {
		case string:
			f.SetString(v.Type().Field(i).Name)
		case int64:
			f.SetInt(n)
		case []int64:
			f.Set(reflect.ValueOf([]int64{n, n + 1}))
		case []puzzle.Clue:
			f.Set(reflect.ValueOf([]puzzle.Clue{{Before: n, After: n + 1}}))
		default:
			t.Fatalf("puzzle.Layout.%s is a %s: teach this test, apiLayout and LayoutOf about it", v.Type().Field(i).Name, f.Type())
		}
	}
	want := l
	want.Level, want.Tier = 0, 0
	if got := LayoutOf(apiLayout(l)); !reflect.DeepEqual(got, want) {
		t.Fatalf("a layout came back from the wire as\n%+v\nwant\n%+v", got, want)
	}
	back := simLog(LogOf(puzzle.Log{Moves: []puzzle.Move{{At: 1, A: 2, B: 3, C: 4}, {At: 5}}, End: 9}))
	if want := (puzzle.Log{Moves: []puzzle.Move{{At: 1, A: 2, B: 3, C: 4}, {At: 5}}, End: 9}); !reflect.DeepEqual(*back, want) {
		t.Fatalf("a log came back from the wire as %+v", *back)
	}
}
