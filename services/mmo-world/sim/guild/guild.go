// Package guild is guilds as rules (GDD 4.8, 4.14): members, officers and
// a leader, the treasury and the bank (ledger pools the game posts to),
// what an officer may spend, votes, succession, contribution ranks and
// the works a guild keeps stocked. It holds no coin itself.
package guild

import (
	"cmp"
	"slices"
	"strconv"

	"jams.team/mmo-world/sim/tally"
)

// Roles a vote can remove someone from.
const (
	Leader  = "leader"
	Officer = "officer"
)

// Member is one character in a guild.
type Member struct {
	Char    string `json:"char"`
	Joined  int64  `json:"joined"`
	Officer bool   `json:"officer,omitempty"`
	// Since is the tick it became an officer, for succession.
	Since int64 `json:"since,omitempty"`
	// Admin is a server admin in its server's own guild: an officer no
	// vote removes.
	Admin bool `json:"admin,omitempty"`
	// Draw lets it withdraw from the bank beyond its contributors' right.
	Draw bool `json:"draw,omitempty"`
	// Put is the reference value of everything it has deposited, all time
	// and this season; Taken what it has drawn at cost.
	Put    int64 `json:"put"`
	Season int64 `json:"season"`
	Taken  int64 `json:"taken"`
	// Gifts are its deposits by world day, for splitting a work's goods.
	Gifts []Gift `json:"gifts,omitempty"`
}

// Gift is a day's deposits, by reference value.
type Gift struct {
	Day   int64 `json:"day"`
	Value int64 `json:"value"`
}

// Spend is coin or goods an officer moved out on a world day.
type Spend struct {
	Officer string `json:"officer"`
	Day     int64  `json:"day"`
	Value   int64  `json:"value"`
}

// Approval is a spend over an officer's day that waits for a second
// officer. Asset, Units and To are what it would move.
type Approval struct {
	ID      string `json:"id"`
	By      string `json:"by"`
	Day     int64  `json:"day"`
	Asset   string `json:"asset"`
	Units   int64  `json:"units"`
	Value   int64  `json:"value"`
	To      string `json:"to"`
	Purpose string `json:"purpose,omitempty"`
}

// Vote is a motion to remove someone from a role.
type Vote struct {
	ID     string   `json:"id"`
	Target string   `json:"target"`
	Role   string   `json:"role"`
	Opened int64    `json:"opened"` // world day
	For    []string `json:"for"`
}

// Work is a guild work switched on at a settlement (GDD 4.14).
type Work struct {
	ID         string `json:"id"`
	Settlement int    `json:"settlement"`
	Since      int64  `json:"since"`
	// By is the officer who switched it on.
	By string `json:"by"`
	// Days is how many world days it has been stocked.
	Days int64 `json:"days"`
	// Left is the coin value it may still give back today: what the day's
	// stock was worth, less what it has spared since.
	Left int64 `json:"left,omitempty"`
}

// Guild is a guild's membership and governance.
type Guild struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Server  string `json:"server,omitempty"` // a server's own guild
	Founded int64  `json:"founded"`
	Leader  string `json:"leader"`
	// Members are sorted by character id.
	Members   []Member   `json:"members"`
	Spends    []Spend    `json:"spends,omitempty"`
	Approvals []Approval `json:"approvals,omitempty"`
	Votes     []Vote     `json:"votes,omitempty"`
	Works     []Work     `json:"works,omitempty"`
	// Picked is the world day a server guild's leader was last picked.
	Picked int64 `json:"picked,omitempty"`
	Seq    int64 `json:"seq"`
}

// Params are the settlements sheet's guild cells.
type Params struct {
	Least, OfficerPer, OfficerSpend, ApprovalDays, LeaderIdleDays int64
	VoteShare, VoteDays, ServerLeaderDays, ServerLeaderEvery      int64
	DrawShare, SpoilsDays                                         int64
}

// New is a guild with its founder as leader and only officer.
func New(id, name, founder string, tick int64) *Guild {
	return &Guild{ID: id, Name: name, Founded: tick, Leader: founder,
		Members: []Member{{Char: founder, Joined: tick, Officer: true, Since: tick}}}
}

// Member finds a member, or nil.
func (g *Guild) Member(char string) *Member {
	i, ok := slices.BinarySearchFunc(g.Members, char, func(m Member, c string) int { return cmp.Compare(m.Char, c) })
	if !ok {
		return nil
	}
	return &g.Members[i]
}

// Join adds a member; false if it already is one.
func (g *Guild) Join(char string, tick int64) bool {
	i, ok := slices.BinarySearchFunc(g.Members, char, func(m Member, c string) int { return cmp.Compare(m.Char, c) })
	if ok {
		return false
	}
	g.Members = slices.Insert(g.Members, i, Member{Char: char, Joined: tick})
	return true
}

// Leave removes a member, who keeps what it holds; the bank stays. A
// leaving leader hands over to the longest-serving officer, else the
// longest-standing member.
func (g *Guild) Leave(char string) bool {
	i := slices.IndexFunc(g.Members, func(m Member) bool { return m.Char == char })
	if i < 0 {
		return false
	}
	g.Members = slices.Delete(g.Members, i, i+1)
	if g.Leader == char {
		g.Leader = ""
		if s := g.senior(func(string) bool { return true }); s != "" {
			g.Leader = s
		}
	}
	return true
}

// IsOfficer reports whether a member may spend and approve: an officer,
// the leader, or a server admin.
func (g *Guild) IsOfficer(char string) bool {
	m := g.Member(char)
	return m != nil && (m.Officer || m.Admin || g.Leader == char)
}

// Officers is how many officers the guild may have: one per OfficerPer
// members, at least one.
func (g *Guild) Officers(p Params) int64 { return max(1, int64(len(g.Members))/p.OfficerPer) }

// Promote makes a member an officer if the guild has room for one.
func (g *Guild) Promote(char string, tick int64, p Params) bool {
	m := g.Member(char)
	if m == nil || m.Officer || g.officerCount() >= g.Officers(p) {
		return false
	}
	m.Officer, m.Since = true, tick
	return true
}

func (g *Guild) officerCount() int64 {
	var n int64
	for _, m := range g.Members {
		if m.Officer {
			n++
		}
	}
	return n
}

// Full reports whether the guild has enough members to be one (GDD 4.8).
func (g *Guild) Full(p Params) bool { return int64(len(g.Members)) >= p.Least }

// SpentToday is what an officer has moved out on a world day.
func (g *Guild) SpentToday(officer string, day int64) int64 {
	var n int64
	for _, s := range g.Spends {
		if s.Officer == officer && s.Day == day {
			n += s.Value
		}
	}
	return n
}

// MaySpend reports whether an officer may move value out today alone.
func (g *Guild) MaySpend(officer string, day, value int64, p Params) bool {
	return g.IsOfficer(officer) && g.SpentToday(officer, day)+value <= p.OfficerSpend
}

// Spent records a spend, dropping those older than a day.
func (g *Guild) Spent(officer string, day, value int64) {
	g.Spends = slices.DeleteFunc(g.Spends, func(s Spend) bool { return s.Day < day })
	g.Spends = append(g.Spends, Spend{Officer: officer, Day: day, Value: value})
}

// Lapse drops approvals no second officer gave in time and votes past
// their days; it returns the approvals that lapsed.
func (g *Guild) Lapse(day int64, p Params) []Approval {
	var gone []Approval
	g.Approvals = slices.DeleteFunc(g.Approvals, func(a Approval) bool {
		if day-a.Day > p.ApprovalDays {
			gone = append(gone, a)
			return true
		}
		return false
	})
	g.Votes = slices.DeleteFunc(g.Votes, func(v Vote) bool { return day-v.Opened >= p.VoteDays })
	return gone
}

// Approve takes a pending approval for a second officer; false if there
// is none or the officer is the one who asked.
func (g *Guild) Approve(id, officer string) (Approval, bool) {
	i := slices.IndexFunc(g.Approvals, func(a Approval) bool { return a.ID == id })
	if i < 0 || g.Approvals[i].By == officer || !g.IsOfficer(officer) {
		return Approval{}, false
	}
	a := g.Approvals[i]
	g.Approvals = slices.Delete(g.Approvals, i, i+1)
	return a, true
}

// Next is a new id under the guild.
func (g *Guild) Next(prefix string) string {
	g.Seq++
	return g.ID + "-" + prefix + strconv.FormatInt(g.Seq, decimal)
}

// Removable reports whether a vote may stand against a member in a role:
// never against a server admin.
func (g *Guild) Removable(target, role string) bool {
	m := g.Member(target)
	switch {
	case m == nil || m.Admin:
		return false
	case role == Leader:
		return g.Leader == target
	case role == Officer:
		return m.Officer
	}
	return false
}

// Cast adds a member's vote to a motion, opening it if need be, and
// reports whether it now carries: more than VoteShare per cent of the
// active members are for it. A carried motion is applied and closed.
func (g *Guild) Cast(voter, target, role string, day, active int64, p Params, id string) (carried bool) {
	i := slices.IndexFunc(g.Votes, func(v Vote) bool { return v.Target == target && v.Role == role })
	if i < 0 {
		g.Votes = append(g.Votes, Vote{ID: id, Target: target, Role: role, Opened: day})
		i = len(g.Votes) - 1
	}
	v := &g.Votes[i]
	if !slices.Contains(v.For, voter) {
		v.For = append(v.For, voter)
	}
	if int64(len(v.For))*hundred <= active*p.VoteShare {
		return false
	}
	g.Votes = slices.Delete(g.Votes, i, i+1)
	if m := g.Member(target); m != nil {
		m.Officer = false
	}
	if role == Leader {
		g.Leader = ""
	}
	return true
}

// structural: shares are in per cent; ids are written in decimal.
const (
	hundred = 100
	decimal = 10
)

// Succeed fills an empty or idle leadership: the longest-serving active
// officer, else the longest-standing active member. It returns the new
// leader, or "" if nothing changed.
func (g *Guild) Succeed(active func(string) bool) string {
	if g.Leader != "" && active(g.Leader) {
		return ""
	}
	s := g.senior(active)
	if s == "" || s == g.Leader {
		return ""
	}
	g.Leader = s
	return s
}

// senior is the longest-serving officer, else the longest-standing
// member, among those active.
func (g *Guild) senior(active func(string) bool) string {
	best, bestOfficer := -1, false
	for i, m := range g.Members {
		if !active(m.Char) || m.Char == g.Leader {
			continue
		}
		o := m.Officer || m.Admin
		switch {
		case best < 0, o && !bestOfficer:
		case o == bestOfficer && since(m) < since(g.Members[best]):
		default:
			continue
		}
		best, bestOfficer = i, o
	}
	if best < 0 {
		return ""
	}
	return g.Members[best].Char
}

func since(m Member) int64 {
	if m.Officer {
		return m.Since
	}
	return m.Joined
}

// PickLeader re-picks a server guild's leader as its most active member
// by acted (per character); it returns the leader if it changed.
func (g *Guild) PickLeader(acted tally.Tally, day int64) string {
	g.Picked = day
	best, n := "", int64(-1)
	for _, m := range g.Members {
		if a := acted.Get(m.Char); a > n {
			best, n = m.Char, a
		}
	}
	if best == "" || best == g.Leader {
		return ""
	}
	g.Leader = best
	return best
}

// Deposit records a member's gift to the bank or the treasury at its
// reference value.
func (g *Guild) Deposit(char string, day, value int64) {
	m := g.Member(char)
	if m == nil || value <= 0 {
		return
	}
	m.Put += value
	m.Season += value
	if n := len(m.Gifts); n > 0 && m.Gifts[n-1].Day == day {
		m.Gifts[n-1].Value += value
		return
	}
	m.Gifts = append(m.Gifts, Gift{Day: day, Value: value})
}

// MayDraw reports whether a member may take stock at cost: officers and
// those allowed to withdraw always, others up to DrawShare per cent of
// what they have put in.
func (g *Guild) MayDraw(char string, value int64, p Params) bool {
	m := g.Member(char)
	switch {
	case m == nil:
		return false
	case m.Draw || g.IsOfficer(char):
		return true
	}
	return (m.Taken+value)*hundred <= m.Put*p.DrawShare
}

// Allow sets whether a member may withdraw from the bank past what its
// deposits earn; false if it is not a member.
func (g *Guild) Allow(char string, on bool) bool {
	m := g.Member(char)
	if m == nil {
		return false
	}
	m.Draw = on
	return true
}

// Drew records what a member took.
func (g *Guild) Drew(char string, value int64) {
	if m := g.Member(char); m != nil {
		m.Taken += value
	}
}

// Shares are the members' deposits over the last SpoilsDays world days,
// the weights a work's goods are split by.
func (g *Guild) Shares(day int64, p Params) tally.Tally {
	var t tally.Tally
	for i := range g.Members {
		m := &g.Members[i]
		m.Gifts = slices.DeleteFunc(m.Gifts, func(x Gift) bool { return day-x.Day >= p.SpoilsDays })
		for _, x := range m.Gifts {
			t.Bump(m.Char, x.Value)
		}
	}
	return t
}

// Rank is the members by contribution, this season or all time, highest
// first.
func (g *Guild) Rank(season bool) []Member {
	out := slices.Clone(g.Members)
	slices.SortStableFunc(out, func(a, b Member) int {
		if season {
			return cmp.Compare(b.Season, a.Season)
		}
		return cmp.Compare(b.Put, a.Put)
	})
	return out
}

// NewSeason clears this season's contributions.
func (g *Guild) NewSeason() {
	for i := range g.Members {
		g.Members[i].Season = 0
	}
}

// Work finds a work switched on at a settlement, or nil.
func (g *Guild) Work(id string, settlement int) *Work {
	for i := range g.Works {
		if g.Works[i].ID == id && g.Works[i].Settlement == settlement {
			return &g.Works[i]
		}
	}
	return nil
}

// Stop switches a work off.
func (g *Guild) Stop(id string, settlement int) bool {
	n := len(g.Works)
	g.Works = slices.DeleteFunc(g.Works, func(w Work) bool { return w.ID == id && w.Settlement == settlement })
	return len(g.Works) < n
}
