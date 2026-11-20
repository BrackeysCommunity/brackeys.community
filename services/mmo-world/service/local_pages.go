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
