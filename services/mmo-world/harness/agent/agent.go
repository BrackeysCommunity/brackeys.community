// Package agent is the one behaviour behind the harness's simulated
// players and the scripted client that drives the world service: a Policy
// observes what a character can do and chooses, and a Client carries the
// choice to a world, over HTTP or in process. A policy written for a
// harness run load-tests the service unchanged.
package agent

import (
	"context"
	"fmt"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/keys"
)

// Client is a world as a player reaches it.
type Client interface {
	Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error)
	Options(ctx context.Context, characterID string) (api.Options, error)
}

// Policy chooses a character's next action from what it can do now; ok
// is false to wait. It never sets the interaction id or the version.
type Policy interface {
	Name() string
	Choose(o api.Options, d *Dice) (req api.ActionRequest, ok bool)
}

// Dice are a player's keyed draws: the same player, tick and purpose
// always give the same number, so a scripted run repeats exactly.
type Dice struct {
	d      *draw.Drawer
	player string
	tick   int64
}

// Below is a draw in [0, n).
func (d *Dice) Below(n int, purpose string) int {
	if n <= 0 {
		return 0
	}
	return int(d.d.Below(uint64(n), draw.Purpose(purpose), draw.Str(d.player), draw.Int(d.tick)))
}

// Percent is true share times in a hundred.
func (d *Dice) Percent(share int64, purpose string) bool {
	return d.d.Percent(share, draw.Purpose(purpose), draw.Str(d.player), draw.Int(d.tick))
}

// Player is one scripted player: a Discord user, the policy it plays and
// the character it has made.
type Player struct {
	Discord   string
	Policy    Policy
	Character string
	Actions   int
	Refused   int
}

// Players makes n players cycling through the policies.
func Players(prefix string, n int, policies ...Policy) []*Player {
	out := make([]*Player, n)
	for i := range out {
		out[i] = &Player{Discord: fmt.Sprintf("%s-%d", prefix, i), Policy: policies[i%len(policies)]}
	}
	return out
}

// Script drives players against a client, tick by tick.
type Script struct {
	Client  Client
	Players []*Player
	dice    *draw.Drawer
}

func NewScript(c Client, players []*Player, label string) *Script {
	return &Script{Client: c, Players: players, dice: draw.NewDrawer(keys.Throwaway("agent/" + label).Roll)}
}

// Turn gives every player one choice at tick: a player with no character
// creates one, the others act on their options. Interaction ids are
// fixed by player and tick, so two runs send the same presses.
func (s *Script) Turn(ctx context.Context, tick int64) error {
	for _, p := range s.Players {
		id := fmt.Sprintf("%s/t%d", p.Discord, tick)
		var req api.ActionRequest
		if p.Character == "" {
			req = api.ActionRequest{Kind: api.ActCreate, DiscordID: p.Discord}
		} else {
			o, err := s.Client.Options(ctx, p.Character)
			if err != nil {
				return err
			}
			var ok bool
			if req, ok = p.Policy.Choose(o, &Dice{d: s.dice, player: p.Discord, tick: tick}); !ok {
				continue
			}
			req.CharacterID, req.Version = p.Character, o.Version
		}
		req.InteractionID = id
		rep, ref, err := s.Client.Act(ctx, req)
		if err != nil {
			return fmt.Errorf("%s at tick %d: %w", p.Discord, tick, err)
		}
		if ref != nil {
			p.Refused++
			continue
		}
		p.Actions++
		if p.Character == "" {
			p.Character = rep.Character.ID
		}
	}
	return nil
}
