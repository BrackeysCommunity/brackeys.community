package fact

import (
	"crypto/sha256"
	"slices"

	"jams.team/mmo-world/sim/canon"
)

// Tail is a Log that keeps only the facts not yet handed to a store, plus a
// SHA-256 chain over every fact appended (each link hashes the last link and
// the fact's canonical form), so a digest names the whole log. A snapshot
// holds Count and Chain only.
type Tail struct {
	Count ID        `json:"count"`
	Chain canon.Sum `json:"chain"`
	facts []Fact
}

func (t *Tail) Append(f Fact) (ID, error) {
	next := t.Count + 1
	if err := prepare(&f, next); err != nil {
		return 0, err
	}
	b, err := canon.Marshal(f)
	if err != nil {
		return 0, err
	}
	h := sha256.New()
	h.Write(t.Chain[:])
	h.Write(b)
	copy(t.Chain[:], h.Sum(nil))
	t.facts = append(t.facts, f)
	t.Count = next
	return f.ID, nil
}

func (t *Tail) base() ID { return t.Count - ID(len(t.facts)) }

// Get finds an unflushed fact.
func (t *Tail) Get(id ID) (Fact, bool) {
	i := int(id - t.base() - 1)
	if i < 0 || i >= len(t.facts) {
		return Fact{}, false
	}
	return t.facts[i], true
}

// Since returns the unflushed facts after id.
func (t *Tail) Since(id ID) []Fact {
	i := max(int(id-t.base()), 0)
	if i >= len(t.facts) {
		return nil
	}
	return slices.Clone(t.facts[i:])
}

func (t *Tail) Len() int { return int(t.Count) }

// Flush hands over the unflushed facts and forgets them.
func (t *Tail) Flush() []Fact {
	out := t.facts
	t.facts = nil
	return out
}
