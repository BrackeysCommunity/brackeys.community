package mapview

import (
	"cmp"
	"maps"
	"slices"
	"sync/atomic"

	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
)

// Holder kinds.
const (
	HolderCharacter = "character"
	HolderGuild     = "guild"
)

// Holder is whose sight a key is: a character or a guild, by id.
type Holder struct{ Kind, ID string }

// Disc is one disc of a sight key.
type Disc struct{ Q, R, Radius int64 }

// Key is a holder's sight key: its discs, sorted.
type Key []Disc

// tilesCovered counts the tiles sight sets have been built over, so a test
// can tell that a pass with no key change built none.
var tilesCovered atomic.Int64

func compareHolders(a, b Holder) int {
	return cmp.Or(cmp.Compare(a.Kind, b.Kind), cmp.Compare(a.ID, b.ID))
}

func compareDiscs(a, b Disc) int {
	return cmp.Or(cmp.Compare(a.R, b.R), cmp.Compare(a.Q, b.Q), cmp.Compare(a.Radius, b.Radius))
}

func sortKey(k Key) Key {
	slices.SortFunc(k, compareDiscs)
	return slices.Compact(k)
}

// charKey is a character's one disc: its sight round its tile, or only
// the entrance tile from a dungeon floor (no rule gives sight underground).
func charKey(g *game.Game, c *game.Char) Key {
	at := c.C.At
	if c.C.Floor > 0 {
		return Key{{Q: at.Q, R: at.R}}
	}
	return Key{{Q: at.Q, R: at.R, Radius: g.Sight(at)}}
}

// Standing reports whether a place gives its guild sight: run by a guild,
// not ruined, and no faction's city.
func Standing(p *game.Place) bool { return p.Guild != "" && p.Ruined == 0 && p.Faction == nil }

// placeDiscs are a standing place's discs: its tile and, for a city, each
// of its other tiles, each with the sight a character there would have.
func placeDiscs(g *game.Game, p *game.Place) []Disc {
	out := []Disc{{Q: p.Hex.Q, R: p.Hex.R, Radius: g.Sight(p.Hex)}}
	if p.City != nil {
		for _, h := range p.City.Tiles {
			out = append(out, Disc{Q: h.Q, R: h.R, Radius: g.Sight(h)})
		}
	}
	return out
}

// guildKeys are the keys of every guild with a standing place.
func guildKeys(g *game.Game) map[string]Key {
	out := map[string]Key{}
	for _, p := range g.Places {
		if Standing(p) {
			out[p.Guild] = append(out[p.Guild], placeDiscs(g, p)...)
		}
	}
	for id, k := range out {
		out[id] = sortKey(k)
	}
	return out
}

// Keys are every holder's sight keys now: each character, and each guild
// with a standing place.
func Keys(g *game.Game) map[Holder]Key {
	out := make(map[Holder]Key, len(g.Chars))
	for _, c := range g.Chars {
		out[Holder{HolderCharacter, c.C.ID}] = charKey(g, c)
	}
	for id, k := range guildKeys(g) {
		if g.GuildOf(id) != nil {
			out[Holder{HolderGuild, id}] = k
		}
	}
	return out
}

// KeyOf is one holder's key now; false when the holder is gone: a
// character no longer in the game, or a guild with no members and no
// standing place. A guild with members and no place has an empty key.
func KeyOf(g *game.Game, h Holder) (Key, bool) {
	switch h.Kind {
	case HolderCharacter:
		c := g.Char(h.ID)
		if c == nil {
			return nil, false
		}
		return charKey(g, c), true
	case HolderGuild:
		gd := g.GuildOf(h.ID)
		if gd == nil {
			return nil, false
		}
		k := Key{}
		for _, p := range g.Places {
			if p.Guild == h.ID && Standing(p) {
				k = append(k, placeDiscs(g, p)...)
			}
		}
		if len(k) == 0 && len(gd.G.Members) == 0 {
			return nil, false
		}
		return sortKey(k), true
	}
	return nil, false
}

// discovered reports whether anybody has found h.
func discovered(g *game.Game, h hex.Hex) bool {
	t := g.World.Tile(h)
	return t != nil && t.Discovered != nil
}

// cover adds the discovered tiles of a key's discs to into.
func cover(g *game.Game, k Key, into map[hex.Hex]bool) {
	for _, d := range k {
		disc := hex.DiscAt(hex.Hex{Q: d.Q, R: d.R}, d.Radius)
		tilesCovered.Add(int64(len(disc)))
		for _, h := range disc {
			if !into[h] && discovered(g, h) {
				into[h] = true
			}
		}
	}
}

// Set is the discovered tiles a key covers, sorted by r, then q.
func Set(g *game.Game, k Key) []hex.Hex {
	in := map[hex.Hex]bool{}
	cover(g, k, in)
	return slices.SortedFunc(maps.Keys(in), byRQ)
}

// Sights is the viewer's sight now: the union of their character's and
// their guild's sets, with their own tile, found or not.
func Sights(g *game.Game, c *game.Char) map[hex.Hex]bool {
	in := map[hex.Hex]bool{}
	cover(g, charKey(g, c), in)
	if c.C.Guild != "" {
		if k, ok := KeyOf(g, Holder{HolderGuild, c.C.Guild}); ok {
			cover(g, k, in)
		}
	}
	in[c.C.At] = true
	return in
}
