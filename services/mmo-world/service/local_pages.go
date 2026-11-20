package service

import (
	"context"
	"fmt"

	"jams.team/mmo-world/api"
)

// Guild is a character's /guild page, without its banner.
func (l *Local) Guild(_ context.Context, id string) (api.Guild, error) {
	if err := l.check(); err != nil {
		return api.Guild{}, err
	}
	c := l.G.Char(id)
	if c == nil {
		return api.Guild{}, fmt.Errorf("no character %s", id)
	}
	return apiGuild(l.G, c), nil
}

// Classes is a character's /classes page.
func (l *Local) Classes(_ context.Context, id string) (api.Classes, error) {
	if err := l.check(); err != nil {
		return api.Classes{}, err
	}
	c := l.G.Char(id)
	if c == nil {
		return api.Classes{}, fmt.Errorf("no character %s", id)
	}
	return apiClasses(l.G, c), nil
}
