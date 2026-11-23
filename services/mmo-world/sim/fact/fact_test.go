package fact

import "testing"

func TestMemLog(t *testing.T) {
	var m Mem
	a, err := m.Append(Fact{Kind: "region.overrun", Tick: 5, Weight: 75, Data: []Datum{N("threat", 910), S("by", "x")}})
	if err != nil || a != 1 {
		t.Fatal(a, err)
	}
	f, _ := m.Get(a)
	if f.Data[0].Key != "by" {
		t.Fatal("data not sorted")
	}
	if d, ok := f.Get("threat"); !ok || d.N != 910 {
		t.Fatal("Get")
	}
	if _, err := m.Append(Fact{Kind: "x", Causes: []ID{7}}); err == nil {
		t.Fatal("unknown cause accepted")
	}
	if _, err := m.Append(Fact{Kind: "x", Weight: 101}); err == nil {
		t.Fatal("weight over 100 accepted")
	}
	if _, err := m.Append(Fact{Kind: "x", Data: []Datum{N("a", 1), N("a", 2)}}); err == nil {
		t.Fatal("duplicate datum accepted")
	}
	b, _ := m.Append(Fact{Kind: "holding.fell", Causes: []ID{a}})
	if got := m.Since(a); len(got) != 1 || got[0].ID != b {
		t.Fatal("Since")
	}
}

func TestParseRef(t *testing.T) {
	for _, s := range []string{"item:abc", "creature:x:y"} {
		r, ok := ParseRef(s)
		if !ok || r.String() != s {
			t.Fatal(s, r, ok)
		}
	}
	if r, _ := ParseRef("creature:x:y"); r.Kind != "creature" || r.ID != "x:y" {
		t.Fatal(r)
	}
	if _, ok := ParseRef("nocolon"); ok {
		t.Fatal("no colon parsed")
	}
}
