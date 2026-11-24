package agent

import (
	"cmp"
	"context"
	"maps"
	"slices"
	"strings"
	"sync"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/sheets"
)

// Crimes are the pages a thief reads beyond its options: its own
// character (alignment, stolen goods, the watch), the people here (a
// fence among them), what an NPC says, and its arcs (an invitation).
type Crimes interface {
	Character(ctx context.Context, characterID string) (api.Character, error)
	Here(ctx context.Context, characterID string) (api.Here, error)
	Conversation(ctx context.Context, characterID, npc string) (api.Conversation, *api.Refusal, error)
	Arcs(ctx context.Context, characterID string) (api.Arcs, error)
}

// Thief is an Earner who also steals (GDD 6.5, 4.5): up to PerDay times a
// world day when something is there to take, burgling first, then lifting,
// then waylaying (for the prey side it backs, if it backs one); it fences
// what it carries hot wherever a fence will see it, pays the watch that
// stops it or runs, walks to its invitation's den and takes the job, and
// once made goes for the syndicate's jobs first. Otherwise it plays its
// Earner, whose draws it leaves alone.
type Thief struct {
	*Earner
	PerDay int
	// HotDays are the world days a stolen good stays marked, from the
	// sheets: how long after a theft it looks for a fence.
	HotDays int64
	mu      sync.Mutex
	marks   map[string]*mark
}

// structural: thefts a thief makes a world day.
const thiefPerDay = 3

// NewThief is a thief who earns as e does, under the sheets' theft rules.
func NewThief(b *sheets.Book, e *Earner) *Thief {
	return &Thief{Earner: e, PerDay: thiefPerDay, HotDays: sheets.IntParam(b.TheftParams, "hot-days")}
}

func (t *Thief) Name() string { return "thief-" + t.Role }

// mark is one thief's own record: what the pages do not say, or say only
// at a cost.
type mark struct {
	day         int64 // the world day stole counts
	stole       int
	hotUntil    int64 // the tick until which it may hold stolen goods
	fenced      bool  // it has sold to a fence
	made        bool  // as its last character read said
	arcsDay     int64 // the world day after the last on which it read its arcs
	invite      *invitation
	try         fenceTry
	spentAt     api.Hex // where the fence turned it away today
	spentDay    int64
	talked      map[string]int64 // NPC to the world day after it last talked to it
	hot         map[string]int64 // stolen units by material, as last read
	jobsDay     int64
	jobs        []api.Goal
	inviteWalk  bool // the route to the invitation's den was refused; it walks
	inviteSent  bool
	answered    int64 // the world day after it answered an invitation
	lastStopped bool
}

// invitation is an open the-invitation thread: the fence who makes the
// offer, where its den is, and when the stage lapses.
type invitation struct {
	arc   string
	fence string
	seat  api.Hex
	due   int64
}

// fenceTry is the fence sale it last sent, to tell one the fence had no
// coin left for: the same hot units still held next turn.
type fenceTry struct {
	day      int64
	material string
	item     string
	units    int64
	held     int64
	skip     []string // items the fence would not take today
}

// structural: the arcs and topics a thief answers.
const (
	inviteTemplate = "the-invitation"
	inviteNPC      = "npc"
	takeTheJob     = "take-the-job"
)

func (t *Thief) markOf(id string) *mark {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.marks == nil {
		t.marks = map[string]*mark{}
	}
	m, ok := t.marks[id]
	if !ok {
		m = &mark{talked: map[string]int64{}, hot: map[string]int64{}}
		t.marks[id] = m
	}
	return m
}

// Choose plays a theft's or a flight's beats to win them; anything else
// is the Earner's.
func (t *Thief) Choose(o api.Options, d *Dice) (api.ActionRequest, bool) {
	if o.Fight != nil && o.Fight.Theft != nil {
		if pick := theftPick(o.Fight, t.BandOrder); pick != "" {
			return api.ActionRequest{Kind: api.ActPress, Option: pick}, true
		}
		return api.ActionRequest{}, false
	}
	return t.Earner.Choose(t.clean(o), d)
}

// clean is the options as the Earner should weigh them: without the
// stolen units the thief last read it holds, which no market here would
// take and the Earner would otherwise offer again and again.
func (t *Thief) clean(o api.Options) api.Options {
	m := t.markOf(o.CharacterID)
	if len(m.hot) == 0 || o.Tick >= m.hotUntil {
		return o
	}
	goods := make([]api.Goods, 0, len(o.Purse.Goods))
	for _, g := range o.Purse.Goods {
		if g.Units -= m.hot[g.Material]; g.Units > 0 {
			goods = append(goods, g)
		}
	}
	o.Purse.Goods = goods
	return o
}

// theftPick is the option likeliest to carry the beat, never a machine (a
// lock is held through, as chat plays it): a win, or short of the last
// beat a hold, which passes it as well. A long shot or worse on a theft
// not yet begun is given up by backing out, which costs nothing then. Once caught, a theft goes on as the getaway, where a
// second failure downs the thief, so it backs out; a flight from the watch
// is pressed to the end.
func theftPick(f *api.Fight, bands []string) string {
	out := bestOf(f, bands, "way-out")
	if f.Theft.Caught && !f.Theft.Flee && out != "" {
		return out
	}
	pick := bestOf(f, bands, "win")
	if f.Beat+1 < f.Beats {
		if hold := bestOf(f, bands, "cautious"); hold != "" && (pick == "" || bandRank(f, bands, hold) < bandRank(f, bands, pick)) {
			pick = hold
		}
	}
	if pick == "" {
		pick = bestOf(f, bands, "cautious")
	}
	if !f.Theft.Flee && !f.Theft.Caught && f.Beat == 0 && out != "" && (pick == "" || bandRank(f, bands, pick) >= len(bands)-2) {
		return out
	}
	return pick
}

// bandRank is an option's place in bands, best first.
func bandRank(f *api.Fight, bands []string, id string) int {
	for _, o := range f.Options {
		if o.ID == id {
			return slices.Index(bands, o.Band)
		}
	}
	return len(bands)
}

// Civic is the thief's crime before the Earner's guild and classes.
func (t *Thief) Civic(o api.Options, desk *Desk, d *Dice) (api.ActionRequest, Verdict, error) {
	if t.idle(o) || o.Fight != nil || o.Long != nil || has(o.Conditions, api.CondDown) {
		return t.Earner.Civic(t.clean(o), desk, d)
	}
	cr, ok := desk.pages.(Crimes)
	if !ok {
		return t.Earner.Civic(t.clean(o), desk, d)
	}
	req, act, err := t.crime(o, desk.ctx, cr, t.markOf(o.CharacterID))
	if err != nil {
		return api.ActionRequest{}, Pass, err
	}
	if act {
		return req, Act, nil
	}
	return t.Earner.Civic(t.clean(o), desk, d)
}

// crime is the thief's step this turn, if it has one: the watch, its
// invitation, the fence, then a theft.
func (t *Thief) crime(o api.Options, ctx context.Context, cr Crimes, m *mark) (api.ActionRequest, bool, error) {
	day := o.Tick / sheets.TicksPerDay
	if m.day != day {
		m.day, m.stole = day, 0
	}
	if has(o.Conditions, api.CondWanted) || m.lastStopped {
		ch, err := cr.Character(ctx, o.CharacterID)
		if err != nil {
			return api.ActionRequest{}, false, err
		}
		m.made = ch.Alignment.Made
		m.lastStopped = ch.Stopped != nil
		if s := ch.Stopped; s != nil {
			if s.CanPay {
				return api.ActionRequest{Kind: api.ActPayFine}, true, nil
			}
			return api.ActionRequest{Kind: api.ActFlee}, true, nil
		}
	}
	if req, ok, err := t.answer(o, ctx, cr, m, day); ok || err != nil {
		return req, ok, err
	}
	if req, ok, err := t.fence(o, ctx, cr, m, day); ok || err != nil {
		return req, ok, err
	}
	return t.steal(o, ctx, cr, m, day)
}

// answer reads its arcs once a world day once it has fenced and is not
// made, and while an invitation is open walks to the den and takes the
// job from the fence who offers it.
func (t *Thief) answer(o api.Options, ctx context.Context, cr Crimes, m *mark, day int64) (api.ActionRequest, bool, error) {
	if m.made || !m.fenced {
		return api.ActionRequest{}, false, nil
	}
	if m.arcsDay != day+1 {
		m.arcsDay = day + 1
		arcs, err := cr.Arcs(ctx, o.CharacterID)
		if err != nil {
			return api.ActionRequest{}, false, err
		}
		m.invite = nil
		for _, a := range arcs.Open {
			if a.Template != inviteTemplate {
				continue
			}
			i := slices.IndexFunc(a.Cast, func(c api.CastRef) bool { return c.Role == inviteNPC })
			if i >= 0 {
				m.invite = &invitation{arc: a.ID, fence: a.Cast[i].ID, seat: a.Seat, due: a.Due}
			}
		}
	}
	in := m.invite
	if in == nil || m.answered == day+1 || o.Tick >= in.due {
		return api.ActionRequest{}, false, nil
	}
	if o.At != in.seat {
		if !m.inviteWalk && slices.Contains(o.Purse.Markets, in.seat) {
			if m.inviteSent {
				m.inviteWalk = true
			} else {
				m.inviteSent = true
				to := in.seat
				return api.ActionRequest{Kind: api.ActTravel, To: &to}, true, nil
			}
		}
		req, ok := toward(o, in.seat)
		return req, ok, nil
	}
	m.inviteSent, m.inviteWalk = false, false
	return t.takeJob(o, ctx, cr, m, in.fence, day)
}

// takeJob talks to the fence once today, then takes the job if it is
// offering it.
func (t *Thief) takeJob(o api.Options, ctx context.Context, cr Crimes, m *mark, fence string, day int64) (api.ActionRequest, bool, error) {
	if m.talked[fence] != day+1 {
		here, err := cr.Here(ctx, o.CharacterID)
		if err != nil {
			return api.ActionRequest{}, false, err
		}
		if !slices.ContainsFunc(here.People, func(p api.Person) bool { return p.ID == fence }) {
			return api.ActionRequest{}, false, nil
		}
		m.talked[fence] = day + 1
		return api.ActionRequest{Kind: api.ActTalk, NPC: fence}, true, nil
	}
	conv, ref, err := cr.Conversation(ctx, o.CharacterID, fence)
	if err != nil || ref != nil {
		return api.ActionRequest{}, false, err
	}
	m.answered = day + 1
	for _, tp := range conv.Topics {
		if tp.ID != inviteTemplate {
			continue
		}
		for _, ch := range tp.Choices {
			if ch.ID == takeTheJob {
				return api.ActionRequest{Kind: api.ActChoose, NPC: fence, Option: tp.ID + "/" + ch.ID}, true, nil
			}
		}
	}
	return api.ActionRequest{}, false, nil
}

// fence sells the largest hot lot it holds, or a hot item, to a fence
// here; a sale the fence had no coin for is halved next time, down to
// nothing for the day there.
func (t *Thief) fence(o api.Options, ctx context.Context, cr Crimes, m *mark, day int64) (api.ActionRequest, bool, error) {
	if !o.Purse.Market || o.Tick >= m.hotUntil || (m.spentDay == day+1 && m.spentAt == o.At) {
		return api.ActionRequest{}, false, nil
	}
	ch, err := cr.Character(ctx, o.CharacterID)
	if err != nil {
		return api.ActionRequest{}, false, err
	}
	m.made = ch.Alignment.Made
	clear(m.hot)
	for _, h := range ch.Hot {
		if h.Material != "" {
			m.hot[h.Material] += h.Units
		}
	}
	if len(ch.Hot) == 0 {
		m.hotUntil = 0
		return api.ActionRequest{}, false, nil
	}
	here, err := cr.Here(ctx, o.CharacterID)
	if err != nil {
		return api.ActionRequest{}, false, err
	}
	i := slices.IndexFunc(here.People, func(p api.Person) bool { return p.Fence })
	if i < 0 {
		m.spentAt, m.spentDay = o.At, day+1
		return api.ActionRequest{}, false, nil
	}
	if !m.made {
		if req, ok, err := t.takeJob(o, ctx, cr, m, here.People[i].ID, day); ok || err != nil {
			return req, ok, err
		}
	}
	tr := &m.try
	if tr.day != day+1 {
		*tr = fenceTry{day: day + 1}
	}
	for _, h := range ch.Hot {
		if h.Item != "" && !slices.Contains(tr.skip, h.Item) {
			if tr.item == h.Item {
				tr.skip = append(tr.skip, h.Item)
				continue
			}
			tr.item, tr.material = h.Item, ""
			m.fenced = true
			return api.ActionRequest{Kind: api.ActFence, Item: h.Item}, true, nil
		}
	}
	lots := map[string]int64{}
	for _, h := range ch.Hot {
		if h.Material != "" {
			lots[h.Material] += h.Units
		}
	}
	material := ""
	for _, k := range slices.Sorted(maps.Keys(lots)) {
		if material == "" || lots[k] > lots[material] {
			material = k
		}
	}
	if material == "" {
		m.spentAt, m.spentDay = o.At, day+1
		return api.ActionRequest{}, false, nil
	}
	units := lots[material]
	if tr.material == material && tr.held == lots[material] {
		units = tr.units / 2
	}
	if units <= 0 {
		m.spentAt, m.spentDay = o.At, day+1
		return api.ActionRequest{}, false, nil
	}
	tr.material, tr.item, tr.units, tr.held = material, "", units, lots[material]
	m.fenced = true
	return api.ActionRequest{Kind: api.ActFence, Material: material, Units: units}, true, nil
}

// steal takes what is here, up to PerDay a world day: a job's target
// first once made, else a burglary, then a lift, then a waylay. The made
// never rob a fence or anyone who leans their way.
func (t *Thief) steal(o api.Options, ctx context.Context, cr Crimes, m *mark, day int64) (api.ActionRequest, bool, error) {
	if m.stole >= t.PerDay || len(o.Steals) == 0 {
		return api.ActionRequest{}, false, nil
	}
	steals := slices.Clone(o.Steals)
	if m.made {
		if err := t.readJobs(o, ctx, cr, m, day); err != nil {
			return api.ActionRequest{}, false, err
		}
		if slices.ContainsFunc(steals, func(s api.StealTarget) bool { return s.Kind == api.TheftLift }) {
			here, err := cr.Here(ctx, o.CharacterID)
			if err != nil {
				return api.ActionRequest{}, false, err
			}
			steals = slices.DeleteFunc(steals, func(s api.StealTarget) bool {
				return s.Kind == api.TheftLift && slices.ContainsFunc(here.People, func(p api.Person) bool {
					return p.ID == s.NPC && (p.Fence || p.Leaning == api.LeaningCrooked)
				})
			})
		}
	}
	// Three clashes always witnessed cost more in fines than a quarter
	// load is worth, so it waylays only for a prey side it backs.
	steals = slices.DeleteFunc(steals, func(s api.StealTarget) bool { return s.Kind == api.TheftWaylay && s.ForSide == "" })
	if len(steals) == 0 {
		return api.ActionRequest{}, false, nil
	}
	order := []string{api.TheftBurgle, api.TheftLift, api.TheftWaylay}
	rank := func(s api.StealTarget) int {
		r := slices.Index(order, s.Kind)
		if r < 0 {
			r = len(order)
		}
		if m.made && slices.ContainsFunc(m.jobs, func(x api.Goal) bool { return jobFor(x, s) }) {
			r -= len(order) + 1
		}
		return r
	}
	slices.SortStableFunc(steals, func(a, b api.StealTarget) int { return cmp.Compare(rank(a), rank(b)) })
	s := steals[0]
	m.stole++
	m.hotUntil = o.Tick + t.HotDays*sheets.TicksPerDay
	req := api.ActionRequest{Kind: api.ActSteal, Option: s.Kind, NPC: s.NPC, Target: s.Caravan, ForSide: s.ForSide != ""}
	return req, true, nil
}

// readJobs reads the syndicate's live jobs on the board here once a world
// day.
func (t *Thief) readJobs(o api.Options, ctx context.Context, cr Crimes, m *mark, day int64) error {
	if !o.Purse.Market || m.jobsDay == day+1 {
		return nil
	}
	bp, ok := cr.(Boards)
	if !ok {
		return nil
	}
	m.jobsDay = day + 1
	page, err := bp.Goals(ctx, o.CharacterID)
	if err != nil {
		return err
	}
	m.jobs = m.jobs[:0]
	for _, x := range page.Board {
		if x.Issuer == goal.BySyndicate && x.Verb == goal.Steal && x.State == goal.Live {
			m.jobs = append(m.jobs, x)
		}
	}
	return nil
}

// jobFor reports whether a theft here would serve a job: of its kind
// (the job names it in words, the kind's name), from the victim it names.
func jobFor(x api.Goal, s api.StealTarget) bool {
	return strings.Contains(strings.ToLower(x.What), "("+s.Kind+")") && s.Name != "" && strings.Contains(x.What, s.Name)
}
