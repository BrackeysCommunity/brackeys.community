// Package draw is the sim's only source of chance. Every draw is
// HMAC-SHA-256 under a secret key over what identifies the draw: a purpose
// and its parts (tile coordinates; or character, encounter, beat, option).
// The same key and the same identity always give the same number, and
// without the key nobody can predict or work one backwards.
package draw

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"hash"
	"math/bits"

	"jams.team/mmo-world/sim/fixed"
)

// structural: the shape of the encoding and of SHA-256.
const (
	KeySize   = sha256.Size
	wordBytes = 8
	tagPurp   = 'P'
	tagInt    = 'I'
	tagStr    = 'S'
	tagBlock  = 'B'
)

// Key is one of the derived keys (see package keys). Never a seed in the
// database, a log line or a fixture.
type Key [KeySize]byte

// Purpose names what a draw decides ("terrain.elevation", "beat.option").
// Two purposes never share a stream even with the same parts.
type Purpose string

// Part is one piece of a draw's identity.
type Part struct {
	tag byte
	n   int64
	s   string
}

func Int(n int64) Part  { return Part{tag: tagInt, n: n} }
func Str(s string) Part { return Part{tag: tagStr, s: s} }

// Draw is the contract form: one fresh HMAC per call.
func Draw(k Key, p Purpose, parts ...Part) uint64 {
	return NewDrawer(k).Draw(p, parts...)
}

// Drawer reuses one keyed HMAC state across draws. It is not safe for
// concurrent use; a world owns one per key.
type Drawer struct {
	mac hash.Hash
	buf []byte
	sum []byte
}

func NewDrawer(k Key) *Drawer {
	return &Drawer{mac: hmac.New(sha256.New, k[:]), sum: make([]byte, 0, KeySize)}
}

func (d *Drawer) message(p Purpose, parts []Part) []byte {
	b := d.buf[:0]
	b = append(b, tagPurp)
	b = binary.AppendUvarint(b, uint64(len(p)))
	b = append(b, p...)
	for _, x := range parts {
		b = append(b, x.tag)
		switch x.tag {
		case tagInt, tagBlock:
			b = binary.BigEndian.AppendUint64(b, uint64(x.n))
		case tagStr:
			b = binary.AppendUvarint(b, uint64(len(x.s)))
			b = append(b, x.s...)
		default:
			panic("draw: zero Part; build parts with Int or Str")
		}
	}
	d.buf = b
	return b
}

func (d *Drawer) block(msg []byte) []byte {
	d.mac.Reset()
	d.mac.Write(msg)
	d.sum = d.mac.Sum(d.sum[:0])
	return d.sum
}

// Draw returns 64 uniformly distributed bits.
func (d *Drawer) Draw(p Purpose, parts ...Part) uint64 {
	return binary.BigEndian.Uint64(d.block(d.message(p, parts)))
}

// Below returns a number in [0, n). The bias is at most n / 2^64.
func (d *Drawer) Below(n uint64, p Purpose, parts ...Part) uint64 {
	return below(d.Draw(p, parts...), n)
}

func below(x, n uint64) uint64 {
	if n == 0 {
		panic("draw: Below(0)")
	}
	hi, _ := bits.Mul64(x, n)
	return hi
}

// Roll succeeds with the given chance, a fraction from 0 to 1 (an odds
// band's cell). Chance 0 never succeeds and chance 1 always does.
func (d *Drawer) Roll(chance fixed.F, p Purpose, parts ...Part) bool {
	return int64(d.Below(fixed.Scale, p, parts...)) < int64(chance)
}

// Pick returns an index into weights, chosen in proportion to each
// weight. Weights are whole numbers from a sheet; negative ones panic.
func (d *Drawer) Pick(weights []int64, p Purpose, parts ...Part) int {
	var total uint64
	for _, w := range weights {
		if w < 0 {
			panic("draw: negative weight")
		}
		total += uint64(w)
	}
	r := d.Below(total, p, parts...)
	for i, w := range weights {
		if r < uint64(w) {
			return i
		}
		r -= uint64(w)
	}
	panic("draw: unreachable")
}

// Shuffle returns a permutation of [0, n) by Fisher-Yates over one stream.
func (d *Drawer) Shuffle(n int, p Purpose, parts ...Part) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = i
	}
	s := d.Stream(p, parts...)
	for i := n - 1; i > 0; i-- {
		j := int(below(s.Next(), uint64(i+1)))
		out[i], out[j] = out[j], out[i]
	}
	return out
}

// Stream yields many words from one identity, four per HMAC, for loops
// that need a run of draws (a shuffle, a noise octave). Word i of a stream
// is fixed by the identity and i alone.
type Stream struct {
	d     *Drawer
	ident []byte
	block int64
	words []byte
}

func (d *Drawer) Stream(p Purpose, parts ...Part) *Stream {
	return &Stream{d: d, ident: append([]byte(nil), d.message(p, parts)...)}
}

func (s *Stream) Next() uint64 {
	if len(s.words) == 0 {
		msg := append(s.d.buf[:0], s.ident...)
		msg = append(msg, tagBlock)
		msg = binary.BigEndian.AppendUint64(msg, uint64(s.block))
		s.d.buf = msg
		s.block++
		s.words = append(s.words[:0], s.d.block(msg)...)
	}
	w := binary.BigEndian.Uint64(s.words)
	s.words = s.words[wordBytes:]
	return w
}

func (s *Stream) Below(n uint64) uint64 { return below(s.Next(), n) }
