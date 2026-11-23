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

// An empty omitempty slice or map digests the same once a JSON round
// trip has made it nil.
func TestOmitEmptySurvivesRoundTrip(t *testing.T) {
	type tile struct {
		Rumours []string       `json:"rumours,omitempty"`
		Marks   map[string]int `json:"marks,omitempty"`
	}
	before := tile{Rumours: []string{}, Marks: map[string]int{}}
	b, err := json.Marshal(before)
	if err != nil {
		t.Fatal(err)
	}
	var after tile
	if err := json.Unmarshal(b, &after); err != nil {
		t.Fatal(err)
	}
	d1, err := Digest(before)
	if err != nil {
		t.Fatal(err)
	}
	d2, err := Digest(after)
	if err != nil {
		t.Fatal(err)
	}
	if d1 != d2 {
		t.Fatal("digest changed across a JSON round trip")
	}
}

// An untagged embedded struct's fields are promoted, as encoding/json
// promotes them, and the outer field wins a clash.
func TestEmbeddedPromoted(t *testing.T) {
	type Inner struct {
		A int64 `json:"a"`
		C int64 `json:"c"`
	}
	type Outer struct {
		Inner
		C int64 `json:"c"`
	}
	got, err := Marshal(Outer{Inner: Inner{A: 1, C: 9}, C: 2})
	if err != nil || string(got) != `{"a":1,"c":2}` {
		t.Fatalf("%s %v", got, err)
	}
}

// A map keyed by a struct encodes as key-sorted [key, value] pairs whatever
// the insertion order; an empty one stays {}.
func TestStructKeyedMap(t *testing.T) {
	type tile struct{ Q, R int }
	r := rand.New(rand.NewPCG(7, 8))
	keys := []tile{{2, 1}, {-1, 3}, {0, 0}, {2, -4}}
	for range 50 {
		m := map[tile]string{}
		for _, j := range r.Perm(len(keys)) {
			m[keys[j]] = string(rune('a' + j))
		}
		b, err := Marshal(m)
		if err != nil {
			t.Fatal(err)
		}
		want := `[[{"Q":-1,"R":3},"b"],[{"Q":0,"R":0},"c"],[{"Q":2,"R":-4},"d"],[{"Q":2,"R":1},"a"]]`
		if string(b) != want {
			t.Fatalf("got %s", b)
		}
	}
	b, err := Marshal(map[tile]int{})
	if err != nil || string(b) != "{}" {
		t.Fatalf("empty: %s %v", b, err)
	}
}
