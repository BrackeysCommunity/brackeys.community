package game

import (
	"cmp"
	"slices"
	"strconv"
	"strings"
	"unicode"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// Moderation is local (GDD 14.6): a server's staff mask names, hide notes
// and hold its players out of what happens there; the character itself is
// untouched, and no moderation kind moves anything in the ledger.

// Moderation actions, ModerateCmd.Action.
const (
	ModMask      = "mask"
	ModUnmask    = "unmask"
	ModHide      = "hide"
	ModUnhide    = "unhide"
	ModMute      = "mute"
	ModUnmute    = "unmute"
	ModSuspend   = "suspend"
	ModUnsuspend = "unsuspend"
	ModExclude   = "exclude"
	ModUnexclude = "unexclude"
	ModEscalate  = "escalate"
	ModDismiss   = "dismiss"
)

// Hold kinds, Hold.Kind: the hold actions' own names.
const (
	HoldMute    = ModMute
	HoldSuspend = ModSuspend
	HoldExclude = ModExclude
)

// Case states, Case.State.
const (
	CaseOpen      = "open"
	CaseActed     = "acted"
	CaseDismissed = "dismissed"
	CaseEscalated = "escalated"
	CaseClosed    = "closed"
)

// ReportReasons are the reasons a report may give; there is no free text.
var ReportReasons = []string{"abuse", "name", "spam", "cheating", "other"}

// Name ref kinds (GDD 14.6): every player-written text in the game, and a
// bot post a report may name.
const (
	RefCharacter  = "character"
	RefGuild      = "guild"
	RefSettlement = "settlement"
	RefDungeon    = "dungeon"
	RefKind       = "kind"
	RefGoal       = "goal"
	RefPost       = "post"
)

// structural: a Discord message link fits well inside this; a settings id
// (a channel or role snowflake) inside the second; a Discord select offers
// at most the third; a day has this many minutes for quiet hours.
const (
	postRefMost       = 200
	settingsIDMost    = 32
	settingsRolesMost = 25
	minutesPerDay     = 1440
)

// ChannelKinds are the kinds a server maps to its own channels.
var ChannelKinds = []string{"chronicle", "events", "market", "board", "log"}

func init() {
	registerHouse(ReportCase, (*Game).fileReport)
	registerHouse(Moderate, (*Game).moderate)
	registerHouse(SetHouse, (*Game).houseSettings)
	houseWorld[Rename] = (*Game).rename
	houseWorld[CaseClose] = (*Game).caseClose
	houseGates = append(houseGates, moderationGate)
}

func (g *Game) houseParam(id string) int64 { return sheets.IntParam(g.r.Book.LiveOpsParams, id) }

// MaskedFor reports whether a name ref reads as its plain generated name
// on a server: masked there, or the server hides every player's names.
func (g *Game) MaskedFor(server, ref string) bool {
	h := g.House(server)
	if h == nil {
		return false
	}
	_, masked := slices.BinarySearch(h.Masks, ref)
	return masked || h.Settings.HideNames
}

// HiddenFor reports whether a goal's title and note read as generated on
// a server.
func (g *Game) HiddenFor(server, goalID string) bool {
	h := g.House(server)
	if h == nil {
		return false
	}
	_, hidden := slices.BinarySearch(h.Hidden, strings.TrimPrefix(goalID, RefGoal+":"))
	return hidden
}

// Holding reports whether a character is under a hold of a kind here on a
// world day.
func (h *House) Holding(char, kind string, day int64) bool {
	i := h.holdAt(char, kind)
	return i >= 0 && (h.Holds[i].Ends == 0 || day < h.Holds[i].Ends)
}

func (h *House) holdAt(char, kind string) int {
	return slices.IndexFunc(h.Holds, func(x Hold) bool { return x.Char == char && x.Kind == kind })
}

func (h *House) caseAt(id string) int {
	return slices.IndexFunc(h.Cases, func(x Case) bool { return x.ID == id })
}

// nameRef is a parsed ref: its kind and the id after the colon.
type nameRef struct{ kind, id string }

// parseRef reads a ref and checks the thing it names exists. A settlement
// or dungeon ref must be written as the game writes it, so one thing has
// one ref.
func (g *Game) parseRef(ref string) (nameRef, error) {
	kind, id, ok := strings.Cut(ref, ":")
	bad := refuse(BadArgs, "no %q to name", ref)
	if !ok || id == "" {
		return nameRef{}, bad
	}
	r := nameRef{kind, id}
	switch kind {
	case RefCharacter:
		ok = g.Char(id) != nil
	case RefGuild:
		ok = g.GuildOf(id) != nil
	case RefSettlement:
		n, err := strconv.Atoi(id)
		ok = err == nil && strconv.Itoa(n) == id && n >= 0 && n < len(g.Places)
	case RefDungeon:
		h, parsed := hex.ParseRef(id)
		ok = parsed && h.Ref() == id && g.recordOf(h) != nil
	case RefKind:
		_, frozen := g.Kinds.Kind(id)
		_, made := g.Kinds.madeAt(id)
		ok = frozen && made
	case RefPromotion:
		ok = g.Emergence != nil && g.Emergence.Promotion(id) != nil
	case RefGoal:
		ok = g.GoalOf(id) != nil
	case RefPost:
		ok = len(ref) <= postRefMost && !strings.ContainsFunc(id, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) })
	default:
		ok = false
	}
	if !ok {
		return nameRef{}, bad
	}
	return r, nil
}

// named reports whether a ref is a name, not a note or a post.
func (r nameRef) named() bool { return r.kind != RefGoal && r.kind != RefPost }

// GeneratedName is what a name ref reads as when masked or restored: the
// name the world gave it before any player wrote one. A character has
// none of the world's, so it reads as its id.
func (g *Game) GeneratedName(ref string) string {
	r, err := g.parseRef(ref)
	if err != nil || !r.named() {
		return ""
	}
	return g.generated(r)
}

func (g *Game) generated(r nameRef) string {
	switch r.kind {
	case RefGuild:
		return "Guild " + r.id
	case RefSettlement:
		n, _ := strconv.Atoi(r.id)
		return g.r.NPC.PlaceName(npc.ListSettlement, g.Places[n].Hex.Ref())
	case RefDungeon:
		return g.r.NPC.PlaceName(RefDungeon, r.id)
	case RefKind:
		k, _ := g.Kinds.Kind(r.id)
		return g.plainName(k.Recipe)
	case RefPromotion:
		return g.Emergence.Promotion(r.id).Name
	}
	return r.id
}

// fileReport files a player's report in its server's queue (GDD 14.6): it
// joins the open case on the same ref, or opens a new one, at most
// reports-per-day a world day per character and server.
func (g *Game) fileReport(c *Char, cmd Command) error {
	if cmd.Case == nil || cmd.Server == "" {
		return refuse(BadArgs, "a report names what it reports, and comes from a server")
	}
	if _, err := g.parseRef(cmd.Case.Ref); err != nil {
		return err
	}
	if !slices.Contains(ReportReasons, cmd.Case.Reason) {
		return refuse(BadArgs, "a report's reason is one of %s", strings.Join(ReportReasons, ", "))
	}
	join := -1
	if h := g.House(cmd.Server); h != nil {
		join = slices.IndexFunc(h.Cases, func(x Case) bool {
			return x.Ref == cmd.Case.Ref && (x.State == CaseOpen || x.State == CaseEscalated)
		})
		if join >= 0 && slices.Contains(h.Cases[join].By, c.C.ID) {
			return refuse(BadArgs, "%s has reported %s already", c.C.ID, h.Cases[join].ID)
		}
		if n := h.reportsToday(c.C.ID, g.Tick()); n >= g.houseParam("reports-per-day") {
			return refuse(CaseLimit, "%s has made %d reports here today", c.C.ID, n)
		}
	}
	h := g.houseFor(cmd.Server)
	if join >= 0 {
		h.Cases[join].By = append(h.Cases[join].By, c.C.ID)
		return nil
	}
	h.NextCase++
	h.Cases = append(h.Cases, Case{ID: "case-" + strconv.FormatInt(h.NextCase, decimal), Ref: cmd.Case.Ref, Reason: cmd.Case.Reason,
		By: []string{c.C.ID}, Tick: g.Tick(), State: CaseOpen})
	h.trimQueue(g.houseParam("queue-kept"))
	return nil
}

// reportsToday counts a character's reports among the cases opened on the
// world day of tick; a case keeps no tick per reporter.
func (h *House) reportsToday(char string, tick int64) int64 {
	var n int64
	for _, x := range h.Cases {
		if x.Tick/sheets.TicksPerDay == tick/sheets.TicksPerDay && slices.Contains(x.By, char) {
			n++
		}
	}
	return n
}

// dropOrder is the case states a full queue gives up first.
var dropOrder = [][]string{{CaseDismissed, CaseClosed}, {CaseActed}, {CaseOpen}, {CaseEscalated}}

// trimQueue keeps at most kept cases, dropping the oldest settled case
// first, then the oldest acted on, then the oldest open, and an escalated
// one last; the newest case, just filed, stays.
func (h *House) trimQueue(kept int64) {
	rank := func(state string) int {
		return slices.IndexFunc(dropOrder, func(states []string) bool { return slices.Contains(states, state) })
	}
	for int64(len(h.Cases)) > kept {
		drop := 0
		for i := range h.Cases[:len(h.Cases)-1] {
			if rank(h.Cases[i].State) < rank(h.Cases[drop].State) {
				drop = i
			}
		}
		h.Cases = slices.Delete(h.Cases, drop, drop+1)
	}
}

// moderate is a staff member's or admin's action on its server's queue
// (GDD 14.6). Every check comes before any change, and an action that
// would change nothing is refused.
func (g *Game) moderate(_ *Char, cmd Command) error {
	if _, _, err := g.houseRole(cmd, houseWide); err != nil {
		return err
	}
	m := cmd.Moderate
	if m == nil {
		return refuse(BadArgs, "a moderation names its action")
	}
	h := g.House(cmd.Server)
	ci := -1
	if m.Case != "" {
		if h != nil {
			ci = h.caseAt(m.Case)
		}
		if ci < 0 {
			return refuse(BadArgs, "no case %q here", m.Case)
		}
		switch st := h.Cases[ci].State; {
		case st == CaseDismissed || st == CaseClosed:
			return refuse(BadArgs, "%s is %s", m.Case, st)
		case st == CaseEscalated && (m.Action == ModEscalate || m.Action == ModDismiss):
			return refuse(BadArgs, "%s is with the operators", m.Case)
		}
	}
	apply, err := g.moderation(h, m, ci >= 0)
	if err != nil {
		return err
	}
	h = g.houseFor(cmd.Server)
	apply(h)
	if ci >= 0 {
		x := &h.Cases[ci]
		x.Action = m.Action
		switch {
		case m.Action == ModEscalate:
			x.State = CaseEscalated
		case m.Action == ModDismiss:
			x.State = CaseDismissed
		case x.State != CaseEscalated:
			x.State = CaseActed
		}
	}
	return nil
}

// moderation checks an action against the house, nil if it has none yet,
// and returns the change it makes. With a case to answer, an action that
// leaves the house as it is still settles the case.
func (g *Game) moderation(h *House, m *ModerateCmd, answers bool) (func(*House), error) {
	if h == nil {
		h = &House{}
	}
	same := func(what string) (func(*House), error) {
		if answers {
			return func(*House) {}, nil
		}
		return nil, refuse(BadArgs, "%s %s already", m.Ref, what)
	}
	switch m.Action {
	case ModEscalate, ModDismiss:
		if !answers {
			return nil, refuse(BadArgs, "%s answers a case", m.Action)
		}
		return func(*House) {}, nil
	case ModMask, ModUnmask:
		r, err := g.parseRef(m.Ref)
		if err != nil {
			return nil, err
		}
		if !r.named() {
			return nil, refuse(BadArgs, "only a name is masked; a goal's words are hidden")
		}
		i, masked := slices.BinarySearch(h.Masks, m.Ref)
		if masked == (m.Action == ModMask) {
			return same("is as asked")
		}
		if masked {
			return func(h *House) { h.Masks = slices.Delete(h.Masks, i, i+1) }, nil
		}
		return func(h *House) { h.Masks = slices.Insert(h.Masks, i, m.Ref) }, nil
	case ModHide, ModUnhide:
		r, err := g.parseRef(m.Ref)
		if err != nil {
			return nil, err
		}
		if r.kind != RefGoal {
			return nil, refuse(BadArgs, "only a goal's title and note are hidden; a name is masked")
		}
		if m.Action == ModHide && g.GoalOf(r.id).Poster == "" {
			return nil, refuse(BadArgs, "%s is the world's own goal: it carries no player's words", r.id)
		}
		i, hidden := slices.BinarySearch(h.Hidden, r.id)
		if hidden == (m.Action == ModHide) {
			return same("is as asked")
		}
		if hidden {
			return func(h *House) { h.Hidden = slices.Delete(h.Hidden, i, i+1) }, nil
		}
		return func(h *House) { h.Hidden = slices.Insert(h.Hidden, i, r.id) }, nil
	case ModMute, ModSuspend, ModExclude, ModUnmute, ModUnsuspend, ModUnexclude:
		return g.holdChange(h, m, same)
	}
	return nil, refuse(BadArgs, "no moderation %q", m.Action)
}

// holdChange checks a hold or its lifting. A hold lasts Days world days
// from today, at most hold-days-max, or 0 until it is lifted; a second
// hold of a kind replaces the first.
func (g *Game) holdChange(h *House, m *ModerateCmd, same func(string) (func(*House), error)) (func(*House), error) {
	r, err := g.parseRef(m.Ref)
	if err != nil {
		return nil, err
	}
	if r.kind != RefCharacter {
		return nil, refuse(BadArgs, "a %s holds a character", m.Action)
	}
	kind, lift := strings.CutPrefix(m.Action, "un")
	i := h.holdAt(r.id, kind)
	if lift {
		if i < 0 {
			return same("is not under a " + kind)
		}
		return func(h *House) { h.Holds = slices.Delete(h.Holds, i, i+1) }, nil
	}
	if m.Days < 0 || m.Days > g.houseParam("hold-days-max") {
		return nil, refuse(BadArgs, "a %s lasts 1 to %d days, or 0 until lifted", kind, g.houseParam("hold-days-max"))
	}
	x := Hold{Char: r.id, Kind: kind, Case: m.Case}
	if m.Days > 0 {
		x.Ends = g.World.Day + m.Days
	}
	return func(h *House) {
		if i >= 0 {
			h.Holds[i] = x
			return
		}
		at, _ := slices.BinarySearchFunc(h.Holds, x, func(a, b Hold) int {
			return cmp.Or(strings.Compare(a.Char, b.Char), strings.Compare(a.Kind, b.Kind))
		})
		h.Holds = slices.Insert(h.Holds, at, x)
	}, nil
}

// houseSettings replaces what one server sees (GDD 14.7), making its house
// if it has none, and installs the server's guild with the admin's
// character as its founder if the server has none; its players arrive at
// the guild's settlement. The founder keeps playing in its own guild, so the installed guild starts
// with no member until a player of the server arrives.
func (g *Game) houseSettings(c *Char, cmd Command) error {
	_, gd, err := g.houseRole(cmd, houseWide)
	if err != nil {
		return err
	}
	if cmd.Settings == nil {
		return refuse(BadArgs, "settings name what they set")
	}
	if err := validSettings(*cmd.Settings); err != nil {
		return err
	}
	s := *cmd.Settings
	s.Channels, s.StaffRoles, s.AlarmRoles = slices.Clone(s.Channels), slices.Clone(s.StaffRoles), slices.Clone(s.AlarmRoles)
	g.houseFor(cmd.Server).Settings = s
	if gd != nil {
		return nil
	}
	gd, err = g.install(c, cmd.Server, cmd.Note)
	if err != nil {
		return err
	}
	if c.C.Guild != gd.G.ID {
		gd.G.Leave(c.C.ID)
	}
	return nil
}

// validSettings refuses settings a server could not mean: an unknown or
// doubled channel kind, an empty, overlong or doubled id, too many roles,
// or quiet hours outside the day.
func validSettings(s HouseSettings) error {
	idOK := func(id string) bool {
		return id != "" && len(id) <= settingsIDMost && !strings.ContainsFunc(id, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) })
	}
	var kinds []string
	for _, ch := range s.Channels {
		if !slices.Contains(ChannelKinds, ch.Kind) || slices.Contains(kinds, ch.Kind) || !idOK(ch.ID) {
			return refuse(BadArgs, "a channel is one of %s, once each, with a Discord id", strings.Join(ChannelKinds, ", "))
		}
		kinds = append(kinds, ch.Kind)
	}
	for _, roles := range [][]string{s.StaffRoles, s.AlarmRoles} {
		if len(roles) > settingsRolesMost {
			return refuse(BadArgs, "settings name at most %d roles of each kind", settingsRolesMost)
		}
		for i, id := range roles {
			if !idOK(id) || slices.Contains(roles[:i], id) {
				return refuse(BadArgs, "a role is named once, by its Discord id")
			}
		}
	}
	if s.QuietFrom < 0 || s.QuietFrom >= minutesPerDay || s.QuietTo < 0 || s.QuietTo >= minutesPerDay {
		return refuse(BadArgs, "quiet hours are minutes past midnight UTC, 0 to %d", minutesPerDay-1)
	}
	return nil
}

// rename is an operator's global rename of a name ref (GDD 14.1):
// screened as any given name is, and an empty name restores the one the
// world gave it. Masks stay each server's own.
func (g *Game) rename(cmd Command) error {
	if cmd.Rename == nil {
		return refuse(BadArgs, "a rename names a ref")
	}
	r, err := g.parseRef(cmd.Rename.Ref)
	if err != nil {
		return err
	}
	if !r.named() || r.kind == RefCharacter {
		return refuse(BadArgs, "%s carries no name the world writes; a character's is its member's own, a goal's words are hidden", cmd.Rename.Ref)
	}
	name := g.generated(r)
	if cmd.Rename.Name != "" {
		if name, err = g.screenName(cmd.Rename.Name); err != nil {
			return err
		}
		if (r.kind == RefGuild || r.kind == RefSettlement) && int64(len([]rune(name))) > g.sp("guild-name-length") {
			return refuse(BadName, "a %s's name is 1 to %d characters", r.kind, g.sp("guild-name-length"))
		}
	}
	set, at, err := g.renamer(r, name, cmd.Rename.Name == "")
	if err != nil {
		return err
	}
	set()
	data := []fact.Datum{fact.S("ref", cmd.Rename.Ref), fact.S("name", name)}
	if at != nil {
		_, err = g.worldFact(*at, "name.renamed", nil, nil, data...)
	} else {
		_, err = g.regionFact("", "name.renamed", nil, nil, data...)
	}
	return err
}

// renamer checks a rename of a ref and returns the change it makes and
// the tile it happens on, if it has one. A name that would read as it does
// already is refused.
func (g *Game) renamer(r nameRef, name string, restore bool) (func(), *hex.Hex, error) {
	unchanged := refuse(BadArgs, "%s:%s is called %s already", r.kind, r.id, name)
	switch r.kind {
	case RefGuild:
		gd := g.GuildOf(r.id)
		switch {
		case gd.G.Name == name:
			return nil, nil, unchanged
		case g.nameTaken(name):
			return nil, nil, refuse(BadArgs, "another guild is called %s", name)
		}
		return func() { gd.G.Name = name }, nil, nil
	case RefSettlement:
		n, _ := strconv.Atoi(r.id)
		p := g.Places[n]
		if restore {
			name = ""
		}
		if p.Name == name {
			return nil, nil, unchanged
		}
		return func() { p.Name = name }, &p.Hex, nil
	case RefDungeon:
		h, _ := hex.ParseRef(r.id)
		d := g.recordOf(h)
		switch {
		case d.Name == "":
			return nil, nil, refuse(BadArgs, "the dungeon at %s is not named yet", r.id)
		case d.Name == name && !d.Hidden:
			return nil, nil, unchanged
		}
		return func() { d.Name, d.Hidden = name, false }, &h, nil
	case RefKind:
		i, _ := g.Kinds.madeAt(r.id)
		k := &g.Kinds.Made[i]
		if k.Name == name {
			return nil, nil, unchanged
		}
		return func() {
			k.Name = name
			k.Given = k.Given || !restore
		}, nil, nil
	case RefPromotion:
		p := g.Emergence.Promotion(r.id)
		if restore {
			name = ""
		}
		if p.Named == name {
			return nil, nil, unchanged
		}
		return func() { p.Named = name }, p.At, nil
	}
	return nil, nil, refuse(BadArgs, "%s:%s carries no name the world writes", r.kind, r.id)
}

// caseClose is an operator's closing of a case a server escalated:
// Target is "<server>/<case id>".
func (g *Game) caseClose(cmd Command) error {
	i := strings.LastIndex(cmd.Target, "/")
	if i < 0 {
		return refuse(BadArgs, "a case is named <server>/<case id>")
	}
	server, id := cmd.Target[:i], cmd.Target[i+1:]
	h := g.House(server)
	ci := -1
	if h != nil {
		ci = h.caseAt(id)
	}
	if ci < 0 {
		return refuse(BadArgs, "no case %q on server %s", id, server)
	}
	if h.Cases[ci].State != CaseEscalated {
		return refuse(BadArgs, "%s is %s, not escalated", id, h.Cases[ci].State)
	}
	h.Cases[ci].State = CaseClosed
	return nil
}

// moderationGate holds a character out of what its holds name: a mute
// out of naming and notes sent from the house's server; a suspension out
// of posting on the boards of settlements that server's guild runs; an
// exclusion out of the market, crafts, goals, crates and hunts at those
// settlements and in the server's stagings. Travel, looking and
// withdrawing its own orders still work.
func moderationGate(g *Game, c *Char, cmd Command) error {
	if len(g.Houses) == 0 || Operator(cmd.Kind) {
		return nil
	}
	day := g.World.Day
	if writes(cmd) {
		if h := g.House(cmd.Server); h != nil && h.Holding(c.C.ID, HoldMute, day) {
			return refuse(Muted, "%s is muted here", c.C.ID)
		}
	}
	if cmd.Kind == PostGoal {
		if h := g.houseHere(c); h != nil && h.Holding(c.C.ID, HoldSuspend, day) {
			return refuse(Suspended, "%s may not post on this board", c.C.ID)
		}
	}
	if !excludable(cmd.Kind) {
		return nil
	}
	if h := g.houseHere(c); h != nil && h.Holding(c.C.ID, HoldExclude, day) {
		return refuse(Excluded, "%s is excluded here", c.C.ID)
	}
	if st := g.cmdStage(cmd); st != nil {
		if h := g.House(st.Server); h != nil && h.Holding(c.C.ID, HoldExclude, day) {
			return refuse(Excluded, "%s is excluded from %s's stagings", c.C.ID, st.Server)
		}
	}
	return nil
}

// writes reports whether a command carries a player's words: a name, or
// a goal's title or note.
func writes(cmd Command) bool {
	switch cmd.Kind {
	case DungeonName, KindName, PromoteName, FoundGuild, Found:
		return true
	case PostGoal:
		return cmd.Goal != nil && (cmd.Goal.Title != "" || cmd.Goal.Note != "")
	}
	return false
}

// excludable reports whether an exclusion holds a kind back.
func excludable(kind string) bool {
	switch kind {
	case Bid, Ask, Take, List, Want, Purchase, Give, SellItem, Sell, Buy, Craft,
		PostGoal, Pledge, DeliverGoal, TakeHaul, CrateOpen, HuntPress:
		return true
	}
	return false
}

// houseHere is the house of the server whose guild runs the settlement a
// character stands in, or nil.
func (g *Game) houseHere(c *Char) *House {
	gd, _ := g.RunsHere(c)
	if gd == nil || gd.G.Server == "" {
		return nil
	}
	return g.House(gd.G.Server)
}
