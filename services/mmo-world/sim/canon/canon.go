// Package canon writes one canonical JSON encoding per value, so that equal
// state always hashes to the same digest: object keys sorted by their
// bytes, no insignificant whitespace, integers in decimal, strings with
// only the escapes JSON requires. Floats are refused, not rounded.
package canon

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"
)

// structural: JSON's escape rules.
const (
	base10       = 10
	base16       = 16
	firstPrint   = 0x20
	unicodeWidth = 4
)

var ErrFloat = errors.New("canon: floats have no canonical form; use fixed.F")

// Marshal returns the canonical encoding of v.
func Marshal(v any) ([]byte, error) { return new(Encoder).Marshal(v) }

// Encoder is Marshal for a caller that encodes the same types again and
// again: it reads a struct type's fields once. The zero value is ready.
type Encoder struct {
	fields map[reflect.Type][]field
}

// field is a struct field as members reads it.
type field struct {
	index    int
	name     string
	omit     bool // omitempty
	embedded bool // an untagged embedded struct, whose fields are promoted
}

// Marshal returns the canonical encoding of v.
func (e *Encoder) Marshal(v any) ([]byte, error) {
	b, err := e.encode(nil, reflect.ValueOf(v))
	if err != nil {
		return nil, err
	}
	return b, nil
}

// Sum is a state digest.
type Sum [sha256.Size]byte

func (s Sum) String() string { return hex.EncodeToString(s[:]) }

// Digest is the SHA-256 of the canonical encoding.
func Digest(v any) (Sum, error) {
	b, err := Marshal(v)
	if err != nil {
		return Sum{}, err
	}
	return sha256.Sum256(b), nil
}

func (e *Encoder) encode(b []byte, v reflect.Value) ([]byte, error) {
	if !v.IsValid() {
		return append(b, "null"...), nil
	}
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface:
		if v.IsNil() {
			return append(b, "null"...), nil
		}
		return e.encode(b, v.Elem())
	case reflect.Bool:
		return strconv.AppendBool(b, v.Bool()), nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return strconv.AppendInt(b, v.Int(), base10), nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return strconv.AppendUint(b, v.Uint(), base10), nil
	case reflect.Float32, reflect.Float64:
		return nil, ErrFloat
	case reflect.String:
		return appendString(b, v.String())
	case reflect.Slice:
		if v.IsNil() {
			return append(b, "null"...), nil
		}
		return e.encodeList(b, v)
	case reflect.Array:
		return e.encodeList(b, v)
	case reflect.Map:
		if v.IsNil() {
			return append(b, "null"...), nil
		}
		return e.encodeMap(b, v)
	case reflect.Struct:
		return e.encodeStruct(b, v)
	default:
		return nil, fmt.Errorf("canon: cannot encode %s", v.Type())
	}
}

func (e *Encoder) encodeList(b []byte, v reflect.Value) ([]byte, error) {
	b = append(b, '[')
	for i := range v.Len() {
		if i > 0 {
			b = append(b, ',')
		}
		var err error
		if b, err = e.encode(b, v.Index(i)); err != nil {
			return nil, err
		}
	}
	return append(b, ']'), nil
}

type member struct {
	name string
	val  reflect.Value
}

func (e *Encoder) encodeMembers(b []byte, ms []member) ([]byte, error) {
	slices.SortFunc(ms, func(x, y member) int { return strings.Compare(x.name, y.name) })
	b = append(b, '{')
	for i, m := range ms {
		if i > 0 {
			if ms[i-1].name == m.name {
				return nil, fmt.Errorf("canon: duplicate key %q", m.name)
			}
			b = append(b, ',')
		}
		var err error
		if b, err = appendString(b, m.name); err != nil {
			return nil, err
		}
		b = append(b, ':')
		if b, err = e.encode(b, m.val); err != nil {
			return nil, err
		}
	}
	return append(b, '}'), nil
}

func (e *Encoder) encodeMap(b []byte, v reflect.Value) ([]byte, error) {
	keys := v.MapKeys()
	if len(keys) > 0 && !nameKey(v.Type().Key().Kind()) {
		return e.encodePairs(b, v, keys)
	}
	ms := make([]member, 0, len(keys))
	for _, k := range keys {
		var name string
		switch k.Kind() {
		case reflect.String:
			name = k.String()
		case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
			name = strconv.FormatInt(k.Int(), base10)
		case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
			name = strconv.FormatUint(k.Uint(), base10)
		}
		ms = append(ms, member{name, v.MapIndex(k)})
	}
	return e.encodeMembers(b, ms)
}

func nameKey(k reflect.Kind) bool {
	switch k {
	case reflect.String,
		reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return true
	}
	return false
}

// encodePairs writes a map whose keys JSON cannot name (a tile, a struct)
// as a list of [key, value] pairs sorted by the key's canonical bytes. An
// empty one stays {} so a digest from before such maps held entries holds.
func (e *Encoder) encodePairs(b []byte, v reflect.Value, keys []reflect.Value) ([]byte, error) {
	type pair struct {
		key []byte
		val reflect.Value
	}
	ps := make([]pair, 0, len(keys))
	for _, k := range keys {
		kb, err := e.encode(nil, k)
		if err != nil {
			return nil, err
		}
		ps = append(ps, pair{kb, v.MapIndex(k)})
	}
	slices.SortFunc(ps, func(x, y pair) int { return bytes.Compare(x.key, y.key) })
	b = append(b, '[')
	for i, p := range ps {
		if i > 0 {
			if bytes.Equal(ps[i-1].key, p.key) {
				return nil, fmt.Errorf("canon: duplicate key %s", p.key)
			}
			b = append(b, ',')
		}
		b = append(b, '[')
		b = append(b, p.key...)
		b = append(b, ',')
		var err error
		if b, err = e.encode(b, p.val); err != nil {
			return nil, err
		}
		b = append(b, ']')
	}
	return append(b, ']'), nil
}

func (e *Encoder) encodeStruct(b []byte, v reflect.Value) ([]byte, error) {
	ms, err := e.members(v)
	if err != nil {
		return nil, err
	}
	return e.encodeMembers(b, ms)
}

// members are a struct's fields as JSON names them. An untagged embedded
// struct's fields are promoted as encoding/json promotes them, so a digest
// survives a JSON round trip; a field of the outer struct wins a clash.
func (e *Encoder) members(v reflect.Value) ([]member, error) {
	fs, err := e.fieldsOf(v.Type())
	if err != nil {
		return nil, err
	}
	ms := make([]member, 0, len(fs))
	var promoted []member
	for _, f := range fs {
		fv := v.Field(f.index)
		if f.embedded {
			inner, err := e.members(fv)
			if err != nil {
				return nil, err
			}
			promoted = append(promoted, inner...)
			continue
		}
		if f.omit && empty(fv) {
			continue
		}
		ms = append(ms, member{f.name, fv})
	}
	for _, p := range promoted {
		if !slices.ContainsFunc(ms, func(m member) bool { return m.name == p.name }) {
			ms = append(ms, p)
		}
	}
	return ms, nil
}

// fieldsOf are the fields of a struct type that members encodes, in
// declaration order.
func (e *Encoder) fieldsOf(t reflect.Type) ([]field, error) {
	if fs, ok := e.fields[t]; ok {
		return fs, nil
	}
	fs := make([]field, 0, t.NumField())
	for i := range t.NumField() {
		f := t.Field(i)
		if f.Anonymous && f.Tag.Get("json") == "" {
			if f.Type.Kind() != reflect.Struct {
				return nil, fmt.Errorf("canon: embedded field %s in %s", f.Name, t)
			}
			fs = append(fs, field{index: i, embedded: true})
			continue
		}
		if !f.IsExported() {
			continue
		}
		name, opts, _ := strings.Cut(f.Tag.Get("json"), ",")
		if name == "-" && opts == "" {
			continue
		}
		if name == "" {
			name = f.Name
		}
		fs = append(fs, field{index: i, name: name, omit: hasOpt(opts, "omitempty")})
	}
	if e.fields == nil {
		e.fields = map[reflect.Type][]field{}
	}
	e.fields[t] = fs
	return fs, nil
}

// empty is omitempty's test. Like encoding/json it drops a non-nil
// empty slice or map, so a digest survives a JSON round trip.
func empty(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.Slice, reflect.Map, reflect.String:
		return v.Len() == 0
	}
	return v.IsZero()
}

func hasOpt(opts, want string) bool {
	for o := range strings.SplitSeq(opts, ",") {
		if o == want {
			return true
		}
	}
	return false
}

func appendString(b []byte, s string) ([]byte, error) {
	if !utf8.ValidString(s) {
		return nil, fmt.Errorf("canon: invalid UTF-8 %q", s)
	}
	b = append(b, '"')
	for i := range len(s) {
		c := s[i]
		switch {
		case c == '"' || c == '\\':
			b = append(b, '\\', c)
		case c < firstPrint:
			b = append(b, `\u`...)
			h := strconv.FormatUint(uint64(c), base16)
			b = append(b, strings.Repeat("0", unicodeWidth-len(h))...)
			b = append(b, h...)
		default:
			b = append(b, c)
		}
	}
	return append(b, '"'), nil
}
