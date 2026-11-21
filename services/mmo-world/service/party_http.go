package service

import (
	"cmp"
	"context"
	"net/http"
	"slices"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/render"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/party"
)

// structural: a hunt's card is edited at most once a tick, and an ended
// party stays on the board until a tick has passed, so the bot that polls
// it closes the thread.
const (
	huntCardEvery = 1
	endedKept     = 1
)

// ending is a party that ended, and the tick it did.
type ending struct {
	party string
	tick  int64
}

// endings are the parties that ended lately. They are kept in memory: a
// restart forgets them, and the bot reads a party gone from the board as
// ended too.
type endings []ending

// note keeps the parties a command's or a tick's facts ended, and forgets
// those ended before the last tick.
func (e *endings) note(facts []fact.Fact, tick int64) {
	*e = slices.DeleteFunc(*e, func(x ending) bool { return x.tick < tick-endedKept })
	for _, f := range facts {
		if f.Kind != "party.ended" {
			continue
		}
		if d, ok := f.Get("party"); ok && d.S != "" {
			*e = append(*e, ending{party: d.S, tick: f.Tick})
		}
	}
}

// discords is who plays which character: a party's thread adds its
// members by their Discord users.
type discords interface {
	discordOf(ctx context.Context, ids []string) (map[string]string, error)
}

// discordOf reads the Discord users of characters; one the store has no
// user for is left out.
func (s *Server) discordOf(ctx context.Context, ids []string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `SELECT id, discord_id FROM mmo.character WHERE world_id = $1 AND id = ANY($2)`, s.cfg.World, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, discord string
		if err := rows.Scan(&id, &discord); err != nil {
			return nil, err
		}
		out[id] = discord
	}
	return out, rows.Err()
}

func (m memory) discordOf(_ context.Context, ids []string) (map[string]string, error) {
	out := map[string]string{}
	for discord, id := range m.players {
		if slices.Contains(ids, id) {
			out[id] = discord
		}
	}
	return out, nil
}

// partyState is GET /v1/party for a character: its party, who stands in
// reach to invite, the invitations it holds, and its beat and fork in its
// own view. thread are the members whose Discord users the thread adds.
func partyState(g *game.Game, c *game.Char) (out api.PartyState, thread []string) {
	tick := g.Tick()
	out = api.PartyState{Tick: tick, CharacterID: c.C.ID, Version: c.Version, Reach: []api.Reachable{}, Invites: []api.PartyInvite{},
		Floor: floorView(g, c), Fight: apiFight(g, c, g.Choose(c).Fight)}
	p := g.PartyOf(c)
	if p != nil {
		out.Party = partyView(g, c, p)
		thread = p.IDs()
	}
	if x := huntInReach(g, c); x != nil {
		out.Hunt = huntView(g, c, x)
	}
	for _, o := range g.Chars {
		if o != c && game.Within(o, c) {
			out.Reach = append(out.Reach, api.Reachable{CharacterID: o.C.ID, Name: charName(g, o.C.ID), InParty: o.Party != ""})
		}
	}
	held := func(partyID string, x party.Invite) {
		if x.To == c.C.ID && tick <= x.Until {
			out.Invites = append(out.Invites, api.PartyInvite{Party: partyID, CharacterID: x.By, Name: charName(g, x.By), Until: x.Until})
		}
	}
	for _, x := range g.Invites {
		held("", x)
	}
	for _, q := range g.Parties {
		for _, x := range q.Invites {
			held(q.ID, x)
		}
	}
	return out, thread
}

// partyBoards are every open party as its thread card shows it to all its
// members, then those ended lately. Discord users are filled after, outside
// the world's lock.
func partyBoards(g *game.Game, ended endings) api.Parties {
	out := api.Parties{Tick: g.Tick(), Parties: []api.PartyBoard{}}
	for _, p := range g.Parties {
		out.Parties = append(out.Parties, partyBoard(g, p))
	}
	for _, x := range ended {
		if g.PartyByID(x.party) == nil {
			out.Parties = append(out.Parties, api.PartyBoard{ID: x.party, Members: []api.BoardMember{}, Ended: true})
		}
	}
	return out
}

func partyBoard(g *game.Game, p *party.Party) api.PartyBoard {
	sh := partyShared(g, p, nil)
	out := api.PartyBoard{ID: p.ID, Members: []api.BoardMember{}}
	for _, m := range p.Members {
		b := api.BoardMember{CharacterID: m.ID, Name: charName(g, m.ID)}
		if c := g.Char(m.ID); c != nil {
			b.Down = game.IsDown(c)
		}
		if sh != nil {
			b.Picked = sh.PickOf(m.ID) != ""
			if sh.Fork != nil {
				b.Chose = slices.ContainsFunc(sh.Fork.Choices, func(x game.Choice) bool { return x.Who == m.ID })
			}
		}
		out.Members = append(out.Members, b)
	}
	if sh == nil {
		return out
	}
	if due := g.WindowDue(sh); due > 0 {
		out.Opened, out.Due = sh.Opened, due
	}
	out.Beat = partyBeat(g, sh, "")
	if sh.Fork != nil {
		out.Fork = forkBoard(g, sh)
	}
	return out
}

// forkBoard is a fork as every member may see it: its ways and their
// votes, read through a member standing at it, with no one's own reads.
func forkBoard(g *game.Game, sh *game.Shared) *api.ForkBoard {
	for _, id := range sh.Members {
		c := g.Char(id)
		if c == nil {
			continue
		}
		f := g.Fork(c)
		d, ok := g.DungeonOf(c)
		if f == nil || !ok {
			continue
		}
		out := &api.ForkBoard{Dungeon: d.Dungeon, Name: d.Name, Kind: d.Kind, Up: d.Up, Floor: f.Floor, Ways: waysView(g, f.Ways, false),
			Waiting: sh.Machine.Armed()}
		return out
	}
	return nil
}

// huntBoard is every hunt in the world, live or closed and not yet
// cleared away, as the game channel's cards show them.
func huntBoard(g *game.Game) api.HuntBoard {
	out := api.HuntBoard{Tick: g.Tick(), Every: huntCardEvery, Hunts: []api.HuntCard{}}
	for _, x := range g.Hunts {
		out.Hunts = append(out.Hunts, huntCard(g, x))
	}
	return out
}

func huntCard(g *game.Game, x *game.Hunt) api.HuntCard {
	h := x.H
	out := api.HuntCard{ID: h.ID, Row: h.Row, Name: huntName(g, h.Row), Creature: h.Creature.Archetype, At: apiHex(x.Hex), Region: x.Region,
		Health: h.Health, Max: h.Max, Ends: h.Ends, Pressers: pressers(g, "", x), Spoils: huntSpoils(g, h.Row), Closed: h.Over, Slain: h.Slain}
	if !h.Slain {
		return out
	}
	out.Rolled = apiGoods(x.Rolled)
	for who, goods := range g.HuntParts(x) {
		out.Shares = append(out.Shares, api.HuntShare{Name: charName(g, who), Removed: h.Removed.Get(who), Goods: apiGoods(goods)})
	}
	slices.SortFunc(out.Shares, func(a, b api.HuntShare) int {
		return cmp.Or(cmp.Compare(b.Removed, a.Removed), cmp.Compare(a.Name, b.Name))
	})
	return out
}

// threadOf is a party's thread hint: its members' Discord users, in join
// order.
func threadOf(ctx context.Context, d discords, st *api.PartyState, ids []string) error {
	if st.Party == nil {
		return nil
	}
	users, err := d.discordOf(ctx, ids)
	if err != nil {
		return err
	}
	st.Thread = &api.PartyThread{Party: st.Party.ID, Members: []string{}}
	for _, id := range ids {
		if u := users[id]; u != "" {
			st.Thread.Members = append(st.Thread.Members, u)
		}
	}
	return nil
}

// boardUsers fills in the Discord users of the board's members.
func boardUsers(ctx context.Context, d discords, out *api.Parties) error {
	var ids []string
	for _, p := range out.Parties {
		for _, m := range p.Members {
			ids = append(ids, m.CharacterID)
		}
	}
	users, err := d.discordOf(ctx, ids)
	if err != nil {
		return err
	}
	for i := range out.Parties {
		for j := range out.Parties[i].Members {
			m := &out.Parties[i].Members[j]
			m.DiscordID = users[m.CharacterID]
		}
	}
	return nil
}

func (s *Server) party(w http.ResponseWriter, r *http.Request) {
	var out api.PartyState
	var ids []string
	if !s.withChar(w, r, func(c *game.Char) { out, ids = partyState(s.g, c) }) {
		return
	}
	if err := threadOf(r.Context(), s, &out, ids); err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) parties(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	out := partyBoards(s.g, s.ended)
	unlock()
	if err := boardUsers(r.Context(), s, &out); err != nil {
		s.internal(w, err)
		return
	}
	reply(w, http.StatusOK, out)
}

func (s *Server) hunts(w http.ResponseWriter, r *http.Request) {
	unlock, ok := s.hold(r.Context(), w, true)
	if !ok {
		return
	}
	out := huntBoard(s.g)
	banners := make([]render.BannerInput, len(out.Hunts))
	for i, c := range out.Hunts {
		banners[i] = s.bannerInput(simHex(c.At))
	}
	unlock()
	for i := range out.Hunts {
		var err error
		if out.Hunts[i].Banner, err = s.banner(banners[i]); err != nil {
			s.internal(w, err)
			return
		}
	}
	reply(w, http.StatusOK, out)
}

// Party is a character's party read, as GET /v1/party gives it.
func (l *Local) Party(ctx context.Context, id string) (api.PartyState, error) {
	c, err := l.char(id)
	if err != nil {
		return api.PartyState{}, err
	}
	out, ids := partyState(l.G, c)
	return out, threadOf(ctx, l.mem, &out, ids)
}

// Parties is every open party, and those ended lately, as GET
// /v1/parties gives them.
func (l *Local) Parties(ctx context.Context) (api.Parties, error) {
	if err := l.check(); err != nil {
		return api.Parties{}, err
	}
	out := partyBoards(l.G, l.ended)
	return out, boardUsers(ctx, l.mem, &out)
}

// Hunts is every hunt, as GET /v1/hunts gives them.
func (l *Local) Hunts(context.Context) (api.HuntBoard, error) {
	if err := l.check(); err != nil {
		return api.HuntBoard{}, err
	}
	return huntBoard(l.G), nil
}
