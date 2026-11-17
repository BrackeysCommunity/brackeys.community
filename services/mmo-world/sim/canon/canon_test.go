package canon

import (
	"encoding/json"
	"errors"
	"math/rand/v2"
	"testing"

	"jams.team/mmo-world/sim/fixed"
)

type inner struct {
	Z int    `json:"z"`
	A string `json:"a,omitempty"`
}

type state struct {
	Name   string         `json:"name"`
	Tiles  []int          `json:"tiles"`
	Gauges map[string]int `json:"gauges"`
	Price  fixed.F        `json:"price"`
	In     *inner         `json:"in"`
	Skip   int            `json:"-"`
	hidden int
}

func TestCanonicalForm(t *testing.T) {
	s := state{Name: "a\"b\n", Tiles: []int{3, 1}, Gauges: map[string]int{"threat": 600, "corruption": 2}, Price: fixed.Raw(18500), In: &inner{Z: 1}, Skip: 9, hidden: 4}
	b, err := Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"gauges":{"corruption":2,"threat":600},"in":{"z":1},"name":"a\"b\u000a","price":18500,"tiles":[3,1]}`
	if string(b) != want {
		t.Fatalf("got  %s\nwant %s", b, want)
	}
	if !json.Valid(b) {
		t.Fatal("not valid JSON")
	}
}

func TestRefusesFloats(t *testing.T) {
	if _, err := Marshal(struct{ X float64 }{1}); !errors.Is(err, ErrFloat) {
		t.Fatalf("got %v", err)
	}
}

// Map insertion order never reaches the digest.
func TestDigestIgnoresMapOrder(t *testing.T) {
	r := rand.New(rand.NewPCG(3, 4))
	keys := []string{"a", "b", "c", "d", "e", "f", "g", "h"}
	var first Sum
	for i := range 200 {
		m := map[string]int{}
		for _, j := range r.Perm(len(keys)) {
			m[keys[j]] = j * j
		}
		d, err := Digest(m)
		if err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			first = d
		} else if d != first {
			t.Fatal("digest depends on map order")
		}
	}
}

// Round trip: canonical output decoded and re-encoded is byte-identical.
func TestIdempotent(t *testing.T) {
	r := rand.New(rand.NewPCG(5, 6))
	for range 1000 {
		m := map[string]any{}
		for range r.IntN(8) {
			m[string(rune('a'+r.IntN(26)))+"é"] = []any{r.Int64(), "x\t", true, nil}
		}
		b, err := Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		d := json.NewDecoder(bytesReader(b))
		d.UseNumber()
		var back any
		if err := d.Decode(&back); err != nil {
			t.Fatal(err)
		}
		b2, err := Marshal(numbersToInts(back))
		if err != nil {
			t.Fatal(err)
		}
		if string(b) != string(b2) {
			t.Fatalf("%s\n%s", b, b2)
		}
	}
}
