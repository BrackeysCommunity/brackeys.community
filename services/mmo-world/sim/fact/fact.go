// Package fact is the ledger: everything that happens is a fact, appended
// and never changed. Text is rendered from facts and is never state.
package fact

import (
	"cmp"
	"fmt"
	"slices"
)

// ID numbers facts in the order they were appended, from 1.
type ID int64

// structural: weight is a 0 to 100 scale; the chronicle's cut-off is a sheet cell.
const MaxWeight = 100

// Ref points at a thing a fact is about: {"region", "r-12"}, {"character", "c-4"}.
type Ref struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

func (r Ref) String() string { return r.Kind + ":" + r.ID }

// Datum is one entry of a fact's data: a whole number or a string.
type Datum struct {
	Key string `json:"k"`
	N   int64  `json:"n,omitempty"`
	S   string `json:"s,omitempty"`
}

func N(key string, n int64) Datum { return Datum{Key: key, N: n} }
func S(key, s string) Datum       { return Datum{Key: key, S: s} }

// B is a flag datum: 1 for true, 0 for false.
func B(key string, b bool) Datum {
	if b {
		return N(key, 1)
	}
	return N(key, 0)
}

type Fact struct {
	ID       ID      `json:"id"`
	Tick     int64   `json:"tick"`
	Kind     string  `json:"kind"`
	Region   string  `json:"region,omitempty"`
	Subjects []Ref   `json:"subjects"`
	Data     []Datum `json:"data"`
	Causes   []ID    `json:"causes"`
	Weight   int64   `json:"weight"`
	StagedBy *Ref    `json:"stagedBy,omitempty"`
}

// Get returns the datum under key.
func (f Fact) Get(key string) (Datum, bool) {
	i, ok := slices.BinarySearchFunc(f.Data, key, func(d Datum, k string) int { return cmp.Compare(d.Key, k) })
	if !ok {
		return Datum{}, false
	}
	return f.Data[i], true
}

// Log is the append-only ledger; Mem keeps it in memory.
type Log interface {
	// Append stores f, assigning its ID, and returns that ID.
	Append(f Fact) (ID, error)
	Get(id ID) (Fact, bool)
	// Since returns the facts after id, in order.
	Since(id ID) []Fact
	Len() int
}

// Normalize sorts data by key and checks what every fact must hold.
func Normalize(f *Fact) error {
	if f.Kind == "" {
		return fmt.Errorf("fact: no kind")
	}
	if f.Weight < 0 || f.Weight > MaxWeight {
		return fmt.Errorf("fact %s: weight %d out of range", f.Kind, f.Weight)
	}
	slices.SortStableFunc(f.Data, func(a, b Datum) int { return cmp.Compare(a.Key, b.Key) })
	for i := 1; i < len(f.Data); i++ {
		if f.Data[i].Key == f.Data[i-1].Key {
			return fmt.Errorf("fact %s: duplicate datum %q", f.Kind, f.Data[i].Key)
		}
	}
	if f.Subjects == nil {
		f.Subjects = []Ref{}
	}
	if f.Data == nil {
		f.Data = []Datum{}
	}
	if f.Causes == nil {
		f.Causes = []ID{}
	}
	return nil
}

// prepare normalizes a fact about to take id next and checks that every
// cause is already in the log.
func prepare(f *Fact, next ID) error {
	if err := Normalize(f); err != nil {
		return err
	}
	for _, c := range f.Causes {
		if c < 1 || c >= next {
			return fmt.Errorf("fact %s: cause %d is not in the log", f.Kind, c)
		}
	}
	f.ID = next
	return nil
}

// Mem is an in-memory Log.
type Mem struct{ facts []Fact }

func (m *Mem) Append(f Fact) (ID, error) {
	if err := prepare(&f, ID(len(m.facts)+1)); err != nil {
		return 0, err
	}
	m.facts = append(m.facts, f)
	return f.ID, nil
}

func (m *Mem) Get(id ID) (Fact, bool) {
	if id < 1 || int(id) > len(m.facts) {
		return Fact{}, false
	}
	return m.facts[id-1], true
}

func (m *Mem) Since(id ID) []Fact {
	if id < 0 {
		id = 0
	}
	if int(id) >= len(m.facts) {
		return nil
	}
	return slices.Clone(m.facts[id:])
}

func (m *Mem) Len() int { return len(m.facts) }
