package main

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/world"
)

// pinRoles are the -as values the sim knows; "" is a designer's.
var pinRoles = []string{"", world.PinDesigner, world.PinAdmin, world.PinStaff}

// pinOrder reads a pin command's words: pin-reserve <q,r> <reach>
// <field=value>..., pin-edit <q,r> <field=value>... or pin-withdraw <id>,
// with -as, -for and -label anywhere among them. The sim judges the rest.
func pinOrder(kind string, args []string) (api.PinOrder, error) {
	var o api.PinOrder
	words, err := pinFlags(args, &o)
	if err != nil {
		return o, err
	}
	switch kind {
	case api.OpPinWithdraw:
		if len(words) != 1 {
			return o, errors.New(usage)
		}
		o.Pin = words[0]
		return o, nil
	case api.OpPinReserve:
		if len(words) < 3 {
			return o, errors.New(usage)
		}
		if o.Reach, err = strconv.ParseInt(words[1], 10, 64); err != nil {
			return o, fmt.Errorf("a reach is a number of tiles, not %q", words[1])
		}
		words = append(words[:1], words[2:]...)
	case api.OpPinEdit:
		if len(words) < 2 {
			return o, errors.New(usage)
		}
	}
	if o.At, err = hexArg(words[0]); err != nil {
		return o, err
	}
	o.Fix, err = fixArg(words[1:])
	return o, err
}

// pinFlags takes -as, -for and -label (or --name, or name=value) out of
// args into o and returns the other words in order. A word whose dash is
// followed by a digit is a tile such as -3,2, not a flag.
func pinFlags(args []string, o *api.PinOrder) ([]string, error) {
	flags := map[string]*string{"as": &o.As, "for": &o.For, "label": &o.Label}
	seen := map[string]bool{}
	var words []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		name := strings.TrimLeft(a, "-")
		if name == a || name == "" || (name[0] >= '0' && name[0] <= '9') {
			words = append(words, a)
			continue
		}
		name, val, inline := strings.Cut(name, "=")
		into := flags[name]
		if into == nil {
			return nil, fmt.Errorf("no flag %s: a pin takes -as, -for and -label", a)
		}
		if seen[name] {
			return nil, fmt.Errorf("-%s is given twice", name)
		}
		seen[name] = true
		if !inline {
			if i+1 == len(args) {
				return nil, fmt.Errorf("-%s needs a value", name)
			}
			i++
			val = args[i]
		}
		*into = val
	}
	if !slices.Contains(pinRoles, o.As) {
		return nil, fmt.Errorf("no one pins as %q: -as is admin or staff, or designer", o.As)
	}
	return words, nil
}

// fixArg reads field=value words into a fix; it fixes at least one field,
// each once.
func fixArg(words []string) (api.PinFix, error) {
	var f api.PinFix
	text := map[string]*string{"site": &f.Site, "landmark": &f.Landmark, "site-kind": &f.SiteKind,
		"dungeon": &f.Dungeon, "lead": &f.Lead, "stock": &f.Stock}
	seen := map[string]bool{}
	for _, w := range words {
		k, v, ok := strings.Cut(w, "=")
		if !ok || v == "" {
			return f, fmt.Errorf("a fix is field=value, not %q", w)
		}
		if seen[k] {
			return f, fmt.Errorf("%s is fixed twice", k)
		}
		seen[k] = true
		if into := text[k]; into != nil {
			*into = v
			continue
		}
		if k != "floors" {
			return f, fmt.Errorf("no field %q: a pin fixes site, landmark, site-kind, dungeon, floors, lead or stock", k)
		}
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 1 {
			return f, fmt.Errorf("floors is a count of floors, not %q", v)
		}
		f.Floors = n
	}
	if f == (api.PinFix{}) {
		return f, errors.New("a pin fixes at least one field=value")
	}
	return f, nil
}
