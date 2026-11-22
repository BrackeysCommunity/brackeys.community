package service

import (
	"context"
	"fmt"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
)

// char is a character a page is read for.
func (l *Local) char(id string) (*game.Char, error) {
	if err := l.check(); err != nil {
		return nil, err
	}
	c := l.G.Char(id)
	if c == nil {
		return nil, fmt.Errorf("no character %s", id)
	}
	return c, nil
}

// Guild is a character's /guild page, without its banner.
func (l *Local) Guild(_ context.Context, id string) (api.Guild, error) {
	c, err := l.char(id)
	if err != nil {
		return api.Guild{}, err
	}
	return apiGuild(l.G, c), nil
}

// Classes is a character's /classes page.
func (l *Local) Classes(_ context.Context, id string) (api.Classes, error) {
	c, err := l.char(id)
	if err != nil {
		return api.Classes{}, err
	}
	return apiClasses(l.G, c), nil
}

// Goals is a character's /goals page as a member reads it to hand goods
// in: the board where it stands, without the forms, drafts or banner.
func (l *Local) Goals(_ context.Context, id string) (api.Goals, error) {
	c, err := l.char(id)
	if err != nil {
		return api.Goals{}, err
	}
	g := l.G
	out := api.Goals{Settlement: -1, Name: g.PlaceName(c.C.At), Board: []api.Goal{}, At: apiHex(c.C.At), Coin: c.C.Coin}
	n, ok := g.SettlementAt(c.C.At)
	if !ok {
		return out, nil
	}
	out.Settlement, out.Officer = n, g.OfficerHere(c)
	for _, x := range g.Board(n) {
		if x.May(c.C.ID) || x.Poster == c.C.ID {
			out.Board = append(out.Board, apiGoal(g, x, c))
		}
	}
	return out, nil
}
