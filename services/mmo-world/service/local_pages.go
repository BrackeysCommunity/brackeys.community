package service

import (
	"context"
	"errors"
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
		if (x.May(c.C.ID) || x.Poster == c.C.ID) && seesGoal(c, x) {
			out.Board = append(out.Board, apiGoal(g, x, c, c.Server))
		}
	}
	return out, nil
}

// Character is a character as its own reads show it: its alignment, the
// stolen goods it carries, and the watch wanting or holding it.
func (l *Local) Character(_ context.Context, id string) (api.Character, error) {
	c, err := l.char(id)
	if err != nil {
		return api.Character{}, err
	}
	return apiCharacter(l.G, c), nil
}

// Here is a character's /here page without its banner or recent facts:
// the people on its tile, a den's fence among them for one who may find
// it, and how each holds the character.
func (l *Local) Here(_ context.Context, id string) (api.Here, error) {
	c, err := l.char(id)
	if err != nil {
		return api.Here{}, err
	}
	return apiHere(l.G, c), nil
}

// Conversation is what a saved NPC says to a character now, without the
// banner: its topics and their choices. A refusal comes back as /npc
// gives it.
func (l *Local) Conversation(_ context.Context, id, npc string) (api.Conversation, *api.Refusal, error) {
	c, err := l.char(id)
	if err != nil {
		return api.Conversation{}, nil, err
	}
	conv, err := l.G.Converse(c, npc)
	var ref *game.Refused
	if errors.As(err, &ref) {
		return api.Conversation{}, apiRefusal(ref), nil
	}
	if err != nil {
		return api.Conversation{}, nil, err
	}
	return apiConversation(l.G, c, conv), nil, nil
}

// Arcs are the arcs a character may see: the open and lately ended ones,
// its own personal threads among them, and the side goals it backs.
func (l *Local) Arcs(_ context.Context, id string) (api.Arcs, error) {
	c, err := l.char(id)
	if err != nil {
		return api.Arcs{}, err
	}
	return apiArcs(l.G, c.C.ID, c.Server), nil
}
