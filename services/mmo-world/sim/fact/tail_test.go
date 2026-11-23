package fact

import "testing"

func TestTailStageBeforeHash(t *testing.T) {
	var plain, staged Tail
	var seen []ID
	staged.Stage = func(f *Fact) {
		seen = append(seen, f.ID)
		if f.Data[0].Key != "a" {
			t.Fatal("Stage ran before the fact was normalised")
		}
		if f.Kind == "pin.placed" {
			f.StagedBy = &Ref{Kind: "operator", ID: "pin"}
		}
	}
	quiet := Fact{Kind: "region.overrun", Data: []Datum{N("b", 2), N("a", 1)}}
	for _, tl := range []*Tail{&plain, &staged} {
		if _, err := tl.Append(quiet); err != nil {
			t.Fatal(err)
		}
	}
	if plain.Chain != staged.Chain {
		t.Fatal("an unstamped fact moved the chain")
	}
	marked := Fact{Kind: "pin.placed", Data: []Datum{N("a", 1)}}
	for _, tl := range []*Tail{&plain, &staged} {
		if _, err := tl.Append(marked); err != nil {
			t.Fatal(err)
		}
	}
	if plain.Chain == staged.Chain {
		t.Fatal("a stamped fact left the chain as an unstamped one")
	}
	if len(seen) != 2 || seen[0] != 1 || seen[1] != 2 {
		t.Fatalf("Stage saw ids %v", seen)
	}
	if f, _ := staged.Get(2); f.StagedBy == nil || f.StagedBy.ID != "pin" {
		t.Fatal("the stamp was not kept on the stored fact")
	}
	if f, _ := plain.Get(2); f.StagedBy != nil {
		t.Fatal("a tail without Stage stamped a fact")
	}
}
