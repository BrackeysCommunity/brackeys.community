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

// Pages are a world's guild and classes pages, which a Client may serve.
type Pages interface {
	Guild(ctx context.Context, characterID string) (api.Guild, error)
	Classes(ctx context.Context, characterID string) (api.Classes, error)
}

// Citizen is a Policy that also reads those pages. Civic is asked before
// Choose wherever the client serves them: Act sends its request, Wait
// holds the turn, Pass leaves it to Choose.
type Citizen interface {
	Policy
	Civic(o api.Options, desk *Desk, d *Dice) (api.ActionRequest, Verdict, error)
}

// Verdict is what a Citizen makes of a turn.
type Verdict int

// Verdicts of Civic.
const (
	Pass Verdict = iota
	Act
	Wait
)

// Desk is where one player reads its pages, and what the script knows
// of it that the pages do not say.
type Desk struct {
	ctx    context.Context
	pages  Pages
	player *Player
}

// Guild is the player's /guild page now.
func (k *Desk) Guild() (api.Guild, error) { return k.pages.Guild(k.ctx, k.player.Character) }

// Classes is the player's /classes page now.
func (k *Desk) Classes() (api.Classes, error) { return k.pages.Classes(k.ctx, k.player.Character) }

// Server is the Discord server the player came from, "" for none.
func (k *Desk) Server() string { return k.player.Server }

// Admin reports whether the player is one of its server's admins.
func (k *Desk) Admin() bool { return k.player.Admin }

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
	Discord string
	Start   string // what a new character chooses to have carried
	// Server is the Discord server it plays from, whose guild a new
	// character joins; Admin marks one of that server's admins.
	Server    string
	Admin     bool
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
	pages   Pages // nil when the client serves none
}

// NewScript drives players against c; label names the run.
func NewScript(c Client, players []*Player, label string) *Script {
	pages, _ := c.(Pages)
	return &Script{Client: c, Players: players, dice: draw.NewDrawer(keys.Throwaway("agent/" + label).Roll), pages: pages}
}

// Turn gives every player one choice at tick: a player with no character
// creates one, the others act on their options. Interaction ids are
// fixed by player and tick, so two runs send the same presses.
func (s *Script) Turn(ctx context.Context, tick int64) error {
	return s.TurnFor(ctx, tick, s.Players)
}

// TurnFor gives the players named their choice at tick.
func (s *Script) TurnFor(ctx context.Context, tick int64, players []*Player) error {
	for _, p := range players {
		id := fmt.Sprintf("%s-t%d", p.Discord, tick)
		var req api.ActionRequest
		if p.Character == "" {
			req = api.ActionRequest{Kind: api.ActCreate, DiscordID: p.Discord, Option: p.Start, Server: p.Server}
		} else {
			o, err := s.Client.Options(ctx, p.Character)
			if err != nil {
				return err
			}
			dice := &Dice{d: s.dice, player: p.Discord, tick: tick}
			verdict := Pass
			if cz, ok := p.Policy.(Citizen); ok && s.pages != nil {
				if req, verdict, err = cz.Civic(o, &Desk{ctx: ctx, pages: s.pages, player: p}, dice); err != nil {
					return fmt.Errorf("%s at tick %d: %w", p.Discord, tick, err)
				}
			}
			if verdict == Wait {
				continue
			}
			if verdict == Pass {
				var ok bool
				if req, ok = p.Policy.Choose(o, dice); !ok {
					continue
				}
			}
			req.CharacterID, req.Version = p.Character, o.Version
		}
		req.InteractionID, req.Server, req.Admin = id, p.Server, p.Admin
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
