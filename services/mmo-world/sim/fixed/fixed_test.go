package fixed

import (
	"encoding/json"
	"math/rand/v2"
	"testing"
)

func TestRoundHalfAwayFromZero(t *testing.T) {
	cases := []struct {
		num, den int64
		want     F
	}{
		{1, 20000, 1},   // 0.00005 -> 0.0001
		{-1, 20000, -1}, // -0.00005 -> -0.0001
		{1, 30000, 0},
		{2, 3, 6667},
		{-2, 3, -6667},
	}
	for _, c := range cases {
		if got := Ratio(c.num, c.den); got != c.want {
			t.Errorf("Ratio(%d,%d) = %d, want %d", c.num, c.den, got, c.want)
		}
	}
	if got := Raw(15000).Int(); got != 2 {
		t.Errorf("1.5 rounds to %d", got)
	}
	if got := Raw(-15000).Int(); got != -2 {
		t.Errorf("-1.5 rounds to %d", got)
	}
	if got := Raw(-15000).Floor(); got != -2 {
		t.Errorf("floor -1.5 = %d", got)
	}
}

func TestParseAndString(t *testing.T) {
	for _, s := range []string{"0", "1", "1.85", "-0.5", "2.6", "0.0001", "-12345.6789"} {
		v, err := Parse(s)
		if err != nil {
			t.Fatalf("Parse(%q): %v", s, err)
		}
		if v.String() != s {
			t.Errorf("round trip %q -> %q", s, v.String())
		}
	}
	for _, s := range []string{"", "1.", ".5", "1e3", "1.23456", "--1", "1.2.3", "abc", "99999999999999999999"} {
		if _, err := Parse(s); err == nil {
			t.Errorf("Parse(%q) should fail", s)
		}
	}
}

func TestJSONNoFloat(t *testing.T) {
	var v struct{ X F }
	if err := json.Unmarshal([]byte(`{"X": 1.85}`), &v); err != nil {
		t.Fatal(err)
	}
	if v.X != 18500 {
		t.Fatalf("got %d", v.X)
	}
	b, _ := json.Marshal(v)
	if string(b) != `{"X":1.85}` {
		t.Fatalf("got %s", b)
	}
}

// Properties over random inputs, from a fixed seed so a failure reproduces.
func TestProperties(t *testing.T) {
	r := rand.New(rand.NewPCG(1, 2))
	for range 100000 {
		a := F(r.Int64N(2_000_000_000) - 1_000_000_000)
		b := F(r.Int64N(2_000_000_000) - 1_000_000_000)
		if a.Add(b).Sub(b) != a {
			t.Fatalf("add/sub %d %d", a, b)
		}
		if a.Mul(b) != b.Mul(a) {
			t.Fatalf("mul commutes %d %d", a, b)
		}
		if a.Mul(One) != a {
			t.Fatalf("identity %d", a)
		}
		if a.Mul(b).Neg() != a.Neg().Mul(b) {
			t.Fatalf("rounding is symmetric about zero %d %d", a, b)
		}
		if b != 0 {
			// Division then multiplication is within one ulp per operation.
			back := a.Div(b).Mul(b)
			diff := int64(back - a)
			if diff < 0 {
				diff = -diff
			}
			lim := int64(b)
			if lim < 0 {
				lim = -lim
			}
			if diff > lim/Scale+1 {
				t.Fatalf("div/mul %d %d -> %d", a, b, back)
			}
		}
		p, err := Parse(a.String())
		if err != nil || p != a {
			t.Fatalf("string round trip %d", a)
		}
	}
}

func TestOverflowPanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	FromInt(1 << 62)
}
