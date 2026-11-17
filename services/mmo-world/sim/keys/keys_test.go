package keys

import (
	"errors"
	"testing"
)

func TestDerive(t *testing.T) {
	m := make([]byte, 32)
	a, err := Derive(m, "w1", 0)
	if err != nil {
		t.Fatal(err)
	}
	if a.Generation == a.Roll || a.Roll == a.Quirk || a.Generation == a.Quirk {
		t.Fatal("keys collide")
	}
	b, _ := Derive(m, "w1", 1)
	if b.Generation != a.Generation || b.Quirk != a.Quirk {
		t.Fatal("a new epoch must not change generation or quirk keys")
	}
	if b.Roll == a.Roll {
		t.Fatal("a new epoch must change the roll key")
	}
	c, _ := Derive(m, "w2", 0)
	if c.Generation == a.Generation {
		t.Fatal("worlds share a key")
	}
	if _, err := Derive(m[:31], "w1", 0); !errors.Is(err, ErrShortMaster) {
		t.Fatal("short master accepted")
	}
	if a, b := Throwaway("x"), Throwaway("x"); a != b || a == Throwaway("y") {
		t.Fatal("throwaway keys are not stable per label")
	}
}
