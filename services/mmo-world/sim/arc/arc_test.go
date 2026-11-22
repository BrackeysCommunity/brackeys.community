package arc

import (
	"slices"
	"testing"

	"jams.team/mmo-world/sim/fact"
)

func castOf(kv ...string) Cast {
	var c Cast
	for i := 0; i < len(kv); i += 3 {
		c = append(c, Binding{Role: kv[i], Ref: fact.Ref{Kind: kv[i+1], ID: kv[i+2]}})
	}
	return c
}

func TestCast(t *testing.T) {
	c := castOf("seat", "settlement", "s-3", "besieger", "faction", "2", "holding", "region", "r-9")
	s := Sorted(c)
	if roles := []string{s[0].Role, s[1].Role, s[2].Role}; !slices.Equal(roles, []string{"besieger", "holding", "seat"}) {
		t.Fatalf("sorted roles %v", roles)
	}
	if c[0].Role != "seat" {
		t.Fatal("Sorted must not reorder its argument")
	}
	if want := "besieger=faction:2;holding=region:r-9;seat=settlement:s-3"; c.Key() != want || s.Key() != want {
		t.Fatalf("keys %q and %q, want %q", c.Key(), s.Key(), want)
	}
	if r, ok := c.Get("holding"); !ok || r != (fact.Ref{Kind: "region", ID: "r-9"}) {
		t.Fatalf("Get holding = %v, %v", r, ok)
	}
	if _, ok := c.Get("claimant-a"); ok {
		t.Fatal("an unbound role should not be found")
	}
	if Cast(nil).Key() != "" {
		t.Fatal("an empty cast has an empty key")
	}
	other := castOf("seat", "settlement", "s-4", "besieger", "faction", "2", "holding", "region", "r-9")
	if other.Key() == c.Key() {
		t.Fatal("different casts share a key")
	}
}
