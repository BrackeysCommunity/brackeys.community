package service

import (
	"strconv"
	"strings"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/hex"
)

// Masks are local (GDD 14.6, 14.7): a name a server's staff masked, or
// every player-written name where the server hides them, reads as the
// world's generated name to that server's readers and as written to
// everyone else's. A character's reads mask for its own server; a server's
// reads name the server. Server "" masks nothing.

// shownName is a written name as a server reads it.
func shownName(g *game.Game, server, ref, written string) string {
	if server == "" || written == "" || !g.MaskedFor(server, ref) {
		return written
	}
	if n := g.GeneratedName(ref); n != "" {
		return n
	}
	return written
}

func shownGuild(g *game.Game, server, id, name string) string {
	return shownName(g, server, game.RefGuild+":"+id, name)
}

func settlementRef(n int) string { return game.RefSettlement + ":" + strconv.Itoa(n) }

// shownPlace is the name a tile goes by to a server: a settlement's as it
// masks it, or its region's.
func shownPlace(g *game.Game, server string, h hex.Hex) string {
	name := g.PlaceName(h)
	if n, ok := g.SettlementAt(h); ok {
		return shownName(g, server, settlementRef(n), name)
	}
	return name
}

// shownDungeon is a dungeon's name to a server, "" where none stands.
func shownDungeon(g *game.Game, server string, h hex.Hex) string {
	return shownName(g, server, game.RefDungeon+":"+h.Ref(), g.DungeonName(h))
}

func shownKind(g *game.Game, server, kind string) string {
	return shownName(g, server, game.RefKind+":"+kind, g.KindName(kind))
}

func shownPromotion(g *game.Game, server, id, name string) string {
	return shownName(g, server, game.RefPromotion+":"+id, name)
}

// maskNames rewrites a names map, keyed "kind:id", for a server: each name
// ref it masks, and the legends, caravans and tiles that read through one.
func maskNames(g *game.Game, server string, names map[string]string) {
	if server == "" || g.House(server) == nil {
		return
	}
	for k, v := range names {
		kind, id, _ := strings.Cut(k, ":")
		switch kind {
		case game.RefGuild, game.RefSettlement, game.RefDungeon, game.RefKind, game.RefPromotion:
			names[k] = shownName(g, server, k, v)
		case kindLegend:
			names[k] = shownPromotion(g, server, id, v)
		case kindCaravan:
			route, _, _ := strings.Cut(id, caravanSep)
			names[k] = shownPromotion(g, server, route, v)
		case kindTile:
			if h, ok := hex.ParseRef(id); ok {
				names[k] = shownPlace(g, server, h)
			}
		}
	}
}

// nameRefOf is the name ref a fact's "name" datum is the written name of,
// "" for none: a rename's ref, a settlement founded, a guild named or
// installed, a dungeon named, or a promotion, legend, road or caravan by
// its id or route.
func nameRefOf(g *game.Game, f api.Fact) string {
	datum := func(key string) (api.Datum, bool) {
		for _, d := range f.Data {
			if d.Key == key {
				return d, true
			}
		}
		return api.Datum{}, false
	}
	if d, ok := datum("ref"); ok && d.S != "" {
		return d.S
	}
	switch f.Kind {
	case "settlement.founded":
		if d, ok := datum("settlement"); ok {
			return settlementRef(int(d.N))
		}
	case "guild.installed", "guild.founded":
		for _, s := range f.Subjects {
			if s.Kind == game.RefGuild {
				return game.RefGuild + ":" + s.ID
			}
		}
	case "dungeon.named":
		q, okq := datum("q")
		r, okr := datum("r")
		if okq && okr {
			return game.RefDungeon + ":" + hex.Hex{Q: q.N, R: r.N}.Ref()
		}
	}
	if g.Emergence == nil {
		return ""
	}
	for _, key := range []string{"id", "route"} {
		if d, ok := datum(key); ok && d.S != "" && g.Emergence.Promotion(d.S) != nil {
			return game.RefPromotion + ":" + d.S
		}
	}
	return ""
}

// labelRefOf is the name ref a staging fact's "label" datum is the written
// name of: the staging server's guild, found through the stage it names.
func labelRefOf(g *game.Game, f api.Fact) string {
	for _, s := range f.Subjects {
		if s.Kind != kindStage {
			continue
		}
		if st := g.StageByID(s.ID); st != nil {
			if gd := g.ServerGuild(st.Server); gd != nil {
				return game.RefGuild + ":" + gd.G.ID
			}
		}
	}
	return ""
}

// structural: the ref kind a fact names a stage by, as sim/game writes it.
const kindStage = "stage"

// maskFact is a fact as a server reads it: a written name it carries, a
// thing's "name", a renamed promotion's "was" or a staging's "label",
// reads as generated where the server masks what it names.
func maskFact(g *game.Game, server string, f api.Fact) api.Fact {
	if server == "" || g.House(server) == nil {
		return f
	}
	for i, d := range f.Data {
		var ref string
		switch {
		case d.S == "":
			continue
		case d.Key == "name", d.Key == "was" && f.Kind == "promotion.renamed":
			ref = nameRefOf(g, f)
		case d.Key == "label":
			ref = labelRefOf(g, f)
		}
		if ref == "" {
			continue
		}
		if n := shownName(g, server, ref, d.S); n != d.S {
			data := append([]api.Datum(nil), f.Data...)
			data[i].S = n
			f.Data = data
		}
	}
	return f
}

// maskFacts masks each fact for a server.
func maskFacts(g *game.Game, server string, fs []api.Fact) []api.Fact {
	for i := range fs {
		fs[i] = maskFact(g, server, fs[i])
	}
	return fs
}
