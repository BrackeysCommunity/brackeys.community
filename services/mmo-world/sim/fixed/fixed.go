// Package fixed is the sim's only fractional number: a signed fixed-point
// value on int64 with four decimal places.
//
// Rounding rule, used by every operation that drops precision: round half
// away from zero. 0.00005 becomes 0.0001 and -0.00005 becomes -0.0001.
package fixed

import (
	"errors"
	"math"
	"math/bits"
	"strconv"
	"strings"
)

// structural: four decimal places. Changing it changes every digest.
const (
	Scale    = 10000
	scaleExp = 4
	decimal  = 10
	bitSize  = 64
)

// F is a fixed-point number: the real value times Scale.
type F int64

// One is 1.0.
const One F = Scale

// FromInt converts a whole number.
func FromInt(n int64) F { return F(mustMul(n, Scale)) }

// Raw builds an F from its underlying scaled integer.
func Raw(n int64) F { return F(n) }

// Ratio is num/den, rounded.
func Ratio(num, den int64) F { return F(divRound(num, Scale, den)) }

// Percent is p/100 as a fraction.
func Percent(p int64) F { return Ratio(p, percent) }

// structural: per cent means hundredths.
const percent = 100

// Int rounds to the nearest whole number.
func (a F) Int() int64 { return divRound(int64(a), 1, Scale) }

// Floor rounds toward negative infinity.
func (a F) Floor() int64 {
	q := int64(a) / Scale
	if int64(a)%Scale < 0 {
		q--
	}
	return q
}

func (a F) Add(b F) F { return F(mustAdd(int64(a), int64(b))) }
func (a F) Sub(b F) F { return F(mustAdd(int64(a), -int64(b))) }
func (a F) Neg() F    { return -a }

// Mul is a*b, rounded.
func (a F) Mul(b F) F { return F(divRound(int64(a), int64(b), Scale)) }

// Div is a/b, rounded. Panics on b == 0.
func (a F) Div(b F) F { return F(divRound(int64(a), Scale, int64(b))) }

// MulInt is a*n with no rounding.
func (a F) MulInt(n int64) F { return F(mustMul(int64(a), n)) }

// Of applies a to a whole quantity: round(n * a).
func (a F) Of(n int64) int64 { return divRound(n, int64(a), Scale) }

func (a F) Cmp(b F) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

func Min(a, b F) F {
	if a < b {
		return a
	}
	return b
}

func Max(a, b F) F {
	if a > b {
		return a
	}
	return b
}

// String prints the shortest exact decimal: "1.85", "-3", "0.0001".
func (a F) String() string {
	neg := a < 0
	u := uint64(a)
	if neg {
		u = uint64(-a)
	}
	whole := u / Scale
	frac := u % Scale
	s := strconv.FormatUint(whole, decimal)
	if frac != 0 {
		f := strconv.FormatUint(frac+Scale, decimal)[1:]
		s += "." + strings.TrimRight(f, "0")
	}
	if neg {
		s = "-" + s
	}
	return s
}

var ErrSyntax = errors.New("fixed: not a decimal with at most four places")

// Parse reads a plain decimal ("1.85", "-0.5", "12"). No exponents, no
// more than four decimal places: a sheet cell that needs more is wrong.
func Parse(s string) (F, error) {
	if s == "" {
		return 0, ErrSyntax
	}
	neg := false
	if s[0] == '-' {
		neg = true
		s = s[1:]
	}
	whole, frac, hasDot := strings.Cut(s, ".")
	if whole == "" || (hasDot && (frac == "" || len(frac) > scaleExp)) {
		return 0, ErrSyntax
	}
	for _, part := range []string{whole, frac} {
		for i := range len(part) {
			if part[i] < '0' || part[i] > '9' {
				return 0, ErrSyntax
			}
		}
	}
	w, err := strconv.ParseInt(whole, decimal, bitSize)
	if err != nil {
		return 0, ErrSyntax
	}
	frac += strings.Repeat("0", scaleExp-len(frac))
	f, err := strconv.ParseInt(frac, decimal, bitSize)
	if err != nil {
		return 0, ErrSyntax
	}
	if w > (math.MaxInt64-f)/Scale {
		return 0, ErrSyntax
	}
	v := w*Scale + f
	if neg {
		v = -v
	}
	return F(v), nil
}

// MarshalJSON writes a JSON number in the form Parse reads.
func (a F) MarshalJSON() ([]byte, error) { return []byte(a.String()), nil }

// UnmarshalJSON reads a JSON number without going through a float.
func (a *F) UnmarshalJSON(b []byte) error {
	v, err := Parse(string(b))
	if err != nil {
		return err
	}
	*a = v
	return nil
}

// divRound computes round(x*y/d) with a 128-bit intermediate.
func divRound(x, y, d int64) int64 {
	if d == 0 {
		panic("fixed: division by zero")
	}
	neg := (x < 0) != (y < 0)
	if d < 0 {
		neg = !neg
	}
	ux, uy, ud := abs(x), abs(y), abs(d)
	hi, lo := bits.Mul64(ux, uy)
	if hi >= ud {
		panic("fixed: overflow")
	}
	q, r := bits.Div64(hi, lo, ud)
	if r >= ud-r {
		q++
	}
	if q > math.MaxInt64 {
		panic("fixed: overflow")
	}
	if neg {
		return -int64(q)
	}
	return int64(q)
}

func abs(v int64) uint64 {
	if v < 0 {
		return uint64(-v)
	}
	return uint64(v)
}

func mustMul(a, b int64) int64 {
	if a == 0 || b == 0 {
		return 0
	}
	c := a * b
	if c/b != a {
		panic("fixed: overflow")
	}
	return c
}

func mustAdd(a, b int64) int64 {
	c := a + b
	if (c > a) != (b > 0) {
		panic("fixed: overflow")
	}
	return c
}
