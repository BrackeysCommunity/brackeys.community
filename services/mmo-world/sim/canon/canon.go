// Package canon writes one canonical JSON encoding per value, so that equal
// state always hashes to the same digest: object keys sorted by their
// bytes, no insignificant whitespace, integers in decimal, strings with
// only the escapes JSON requires. Floats are refused, not rounded.
package canon

import (
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
func Marshal(v any) ([]byte, error) {
	var b []byte
	b, err := encode(b, reflect.ValueOf(v))
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

func encode(b []byte, v reflect.Value) ([]byte, error) {
	if !v.IsValid() {
		return append(b, "null"...), nil
	}
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface:
		if v.IsNil() {
			return append(b, "null"...), nil
		}
		return encode(b, v.Elem())
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
		return encodeList(b, v)
	case reflect.Array:
		return encodeList(b, v)
	case reflect.Map:
		if v.IsNil() {
			return append(b, "null"...), nil
		}
		return encodeMap(b, v)
	case reflect.Struct:
		return encodeStruct(b, v)
	default:
		return nil, fmt.Errorf("canon: cannot encode %s", v.Type())
	}
}

func encodeList(b []byte, v reflect.Value) ([]byte, error) {
	b = append(b, '[')
	for i := range v.Len() {
		if i > 0 {
			b = append(b, ',')
		}
		var err error
		if b, err = encode(b, v.Index(i)); err != nil {
			return nil, err
		}
	}
	return append(b, ']'), nil
}

type member struct {
	name string
	val  reflect.Value
}

func encodeMembers(b []byte, ms []member) ([]byte, error) {
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
		if b, err = encode(b, m.val); err != nil {
			return nil, err
		}
	}
	return append(b, '}'), nil
}

func encodeMap(b []byte, v reflect.Value) ([]byte, error) {
	keys := v.MapKeys()
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
		default:
			return nil, fmt.Errorf("canon: map key %s", k.Type())
		}
		ms = append(ms, member{name, v.MapIndex(k)})
	}
	return encodeMembers(b, ms)
}

func encodeStruct(b []byte, v reflect.Value) ([]byte, error) {
	ms, err := members(v)
	if err != nil {
		return nil, err
	}
	return encodeMembers(b, ms)
}

// members are a struct's fields as JSON names them. An untagged embedded
// struct's fields are promoted as encoding/json promotes them, so a digest
// survives a JSON round trip; a field of the outer struct wins a clash.
func members(v reflect.Value) ([]member, error) {
	t := v.Type()
	ms := make([]member, 0, t.NumField())
	var promoted []member
	for i := range t.NumField() {
		f := t.Field(i)
		if f.Anonymous && f.Tag.Get("json") == "" {
			if f.Type.Kind() != reflect.Struct {
				return nil, fmt.Errorf("canon: embedded field %s in %s", f.Name, t)
			}
			inner, err := members(v.Field(i))
			if err != nil {
				return nil, err
			}
			promoted = append(promoted, inner...)
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
		fv := v.Field(i)
		if hasOpt(opts, "omitempty") && empty(fv) {
			continue
		}
		ms = append(ms, member{name, fv})
	}
	for _, p := range promoted {
		if !slices.ContainsFunc(ms, func(m member) bool { return m.name == p.name }) {
			ms = append(ms, p)
		}
	}
	return ms, nil
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
