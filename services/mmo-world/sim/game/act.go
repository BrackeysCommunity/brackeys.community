package game

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/char"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fight"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
	"jams.team/mmo-world/sim/puzzle"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/world"
)

// Command kinds. The operator's correct, grant, ban and unban are
// commands too, so they are recorded and replayed like any other.
const (
	Create  = "create"
	Step    = "step"
	Travel  = "travel"
	Gather  = "gather"
	Rest    = "rest"
	Cancel  = "cancel"
	Explore = "explore"
	Press   = "press"
	Correct = "correct"
	Grant   = "grant"
	Ban     = "ban"
	Unban   = "unban"
	// Forget is a player's asking to be forgotten (GDD 14.9).
	Forget = "forget"
)

// Command is one thing done to the game between ticks. Key is the
// interaction id; every ledger transaction it causes is keyed on it or on a
// ledger.SubKey of it.
type Command struct {
	Key      string       `json:"key"`
	Char     string       `json:"char,omitempty"`
	Kind     string       `json:"kind"`
	Dir      int          `json:"dir,omitempty"`
	To       *hex.Hex     `json:"to,omitempty"`
	Material string       `json:"material,omitempty"`
	Ticks    int64        `json:"ticks,omitempty"`
	Option   string       `json:"option,omitempty"`
	Asset    string       `json:"asset,omitempty"`
	Units    int64        `json:"units,omitempty"`
	Note     string       `json:"note,omitempty"`
	Item     string       `json:"item,omitempty"`
	Slot     string       `json:"slot,omitempty"`
	Recipe   *item.Recipe `json:"recipe,omitempty"`
	// Stop holds a route's stop conditions (GDD 6.1).
	Stop *Stop `json:"stop,omitempty"`
	// NPC names who a conversation is with.
	NPC string `json:"npc,omitempty"`
	// Server is the Discord server the command came from: a new
	// character's own, and the one Admin speaks for.
	Server string `json:"server,omitempty"`
	// Price is an order's or a listing's coin each; Target the character
	// given to; Floor a gear order's floor.
	Price  int64         `json:"price,omitempty"`
	Target string        `json:"target,omitempty"`
	Floor  *market.Floor `json:"floor,omitempty"`
	// Goal is a goal being posted.
	Goal *GoalSpec `json:"goal,omitempty"`
	// Admin marks a command from one of Server's admins, who are officers
	// of the server's own guild (GDD 4.8).
	Admin bool `json:"admin,omitempty"`
	// Machine is what a machine command carries (GDD 7.11).
	Machine *MachineCmd `json:"machine,omitempty"`
	// Now is the service's clock, unix ms, on a command whose rule
	// measures real time. The sim never reads a clock of its own.
	Now int64 `json:"now,omitempty"`
	// Along is the Haul goal whose shared route a journey follows.
	Along string `json:"along,omitempty"`
	// Pin is a pin command's order: the tile, reach and fix, or the pin a
	// withdraw names (GDD 14.4).
	Pin *PinCmd `json:"pin,omitempty"`
	// Epoch is a season-epoch's change of rules; Arc an arc-cast's order.
	Epoch *season.Epoch `json:"epoch,omitempty"`
	Arc   *ArcCmd       `json:"arc,omitempty"`
	// BackRoom works a craft in a den's back room; ForSide sends a
	// waylay's haul to the prey side the character backs (GDD 4.5, 6.5).
	BackRoom bool `json:"backRoom,omitempty"`
	ForSide  bool `json:"forSide,omitempty"`
	// Staff marks a command from a member its server counts as staff:
	// Moderate Members, or a role its settings name (GDD 14.1).
	Staff bool `json:"staff,omitempty"`
	// Staged sends a market command to the staged book here (GDD 10.8).
	Staged   bool           `json:"staged,omitempty"`
	Stage    *StageCmd      `json:"stage,omitempty"`
	Case     *CaseCmd       `json:"case,omitempty"`
	Moderate *ModerateCmd   `json:"moderate,omitempty"`
	Settings *HouseSettings `json:"settings,omitempty"`
	Rename   *RenameCmd     `json:"rename,omitempty"`
}

// Stop is when a journey halts on its own: before a region at or above a
// threat, when provisions would run out, or at the first tile nobody has
// entered.
type Stop struct {
	Threat     int64 `json:"threat,omitempty"`
	Provisions bool  `json:"provisions,omitempty"`
	Unknown    bool  `json:"unknown,omitempty"`
}

// Operator reports whether a command kind is for operators only.
func Operator(kind string) bool {
	return kind == Correct || kind == Grant || kind == Ban || kind == Unban || kind == HideGoal || kind == SetMachine ||
		kind == HideName || kind == SetReady || kind == Rename || kind == CaseClose || WorldLevel(kind)
}

// passive reports whether a kind is sent for a character rather than by
// it: it neither counts as the character acting nor collects for it.
func passive(kind string) bool { return Operator(kind) || kind == PartyWindow || HouseKind(kind) }

// Refused is a command the rules turn down. Nothing changed.
type Refused struct {
	Code string // a stable reason a client can branch on
	Msg  string
}

func (r *Refused) Error() string { return r.Code + ": " + r.Msg }

func refuse(code, format string, a ...any) error {
	return &Refused{Code: code, Msg: fmt.Sprintf(format, a...)}
}

// Refusal codes.
const (
	NoSuchChar = "no-such-character"
	Busy       = "busy"
	BadArgs    = "bad-arguments"
	NotHere    = "not-here"
	BannedCode = "banned"
	NoFight    = "no-encounter"
	InActivity = "needs-activity"
	DownCode   = "down"
	// ForgottenCode refuses every command on or to a character its player
	// asked to be forgotten.
	ForgottenCode = "forgotten"
)

// Result is what a command did.
type Result struct {
	Char    *Char           `json:"char"`
	Facts   []fact.Fact     `json:"facts"`
	Pressed []fight.Pressed `json:"pressed,omitempty"`
	// Machine is the one fact a machine's move log became.
	Machine *puzzle.Result `json:"machine,omitempty"`
	// Moved are the other characters whose rows the command changed; Seen
	// those whose view it changed while their rows stayed.
	Moved []string `json:"-"`
	Seen  []string `json:"-"`
	// Points are the event points the command spent (GDD 14.3).
	Points int64 `json:"points,omitempty"`
}

// Act applies a command at the current tick. A refused command changes
// nothing. Any other error leaves the game part-way, and the caller
// reloads it.
func (g *Game) Act(cmd Command) (Result, error) {
	if err := ValidKey(cmd.Key); err != nil {
		return Result{}, err
	}
	g.touched, g.seen, g.stagedFacts = g.touched[:0], g.seen[:0], g.stagedFacts[:0]
	g.points = 0
	if WorldLevel(cmd.Kind) {
		return g.actWorld(cmd)
	}
	if cmd.Kind == HideGoal && cmd.Char == "" {
		x := g.GoalOf(cmd.Target)
		if x != nil && x.Poster == "" {
			return Result{}, refuse(BadArgs, "%s is the world's own goal: it carries no player's words", x.ID)
		}
		if x != nil {
			cmd.Char = x.Poster
		}
	}
	// A hide is recorded against the dungeon's first namer.
	if cmd.Kind == HideName && cmd.Char == "" {
		if cmd.To == nil {
			return Result{}, refuse(BadArgs, "a hide names a dungeon's entrance")
		}
		d := g.recordOf(*cmd.To)
		if d == nil || d.Name == "" || len(d.NamedBy) == 0 {
			return Result{}, refuse(BadArgs, "no given name at %s", cmd.To.Ref())
		}
		cmd.Char = d.NamedBy[0]
	}
	defer g.stagingFor(cmd)()
	first := fact.ID(g.Log.Len())
	var c *Char
	var err error
	var pressed []fight.Pressed
	var machine *puzzle.Result
	if cmd.Kind == Create {
		if cmd.Option != "" {
			if _, err := g.startRow(cmd.Option); err != nil {
				return Result{}, err
			}
		}
		c, err = g.create(cmd.Server, cmd.Note)
		if err == nil && cmd.Option != "" {
			err = g.start(c, cmd.Key, cmd.Option)
		}
	} else {
		if c = g.Char(cmd.Char); c == nil {
			return Result{}, refuse(NoSuchChar, "no character %q", cmd.Char)
		}
		if err := g.forgottenGuard(c, cmd); err != nil {
			return Result{}, err
		}
		if cmd.Kind == Forget {
			return g.forgetAsked(c), nil
		}
		if c.Banned && !Operator(cmd.Kind) {
			return Result{}, refuse(BannedCode, "character %s is banned", c.C.ID)
		}
		// Walking away from a countdown is the haywire: nothing else may
		// resolve the beat first.
		if c.Armed != nil && cmd.Kind != MachineSolve && !Operator(cmd.Kind) {
			return Result{}, refuse(MachineArmed, "%s has a machine armed and its countdown is running", c.C.ID)
		}
		if sh := g.sharedOf(c); sh != nil && sh.Machine.Armed() && waitsOnMachine(cmd.Kind) {
			return Result{}, refuse(MachineArmed, "the party's machine is armed and its countdown is running")
		}
		undo := g.admit(c, cmd)
		if err = g.houseGate(c, cmd); err == nil {
			pressed, machine, err = g.dispatchStaged(c, cmd)
		}
		if err != nil {
			undo()
		}
	}
	if err != nil {
		return Result{}, err
	}
	if !passive(cmd.Kind) {
		if err := g.collect(c, cmd.Key); err != nil {
			return Result{}, err
		}
	}
	// A character this command made or moved into its server's guild is marked now.
	g.admit(c, cmd)
	if kinds := uses[cmd.Kind]; kinds != nil {
		g.used(c.C.At, kinds...)
	}
	g.dropIfDown(c)
	if err := g.creditGoals(first, cmd.Key); err != nil {
		return Result{}, err
	}
	if err := g.classesFor(c, g.Tick()); err != nil {
		return Result{}, err
	}
	c.Version++
	if !passive(cmd.Kind) {
		g.returned(c, g.Tick())
		g.threadGate(c, g.Tick())
		c.Acted = g.Tick()
		c.markDay(g.Tick() / sheets.TicksPerDay)
		if err := g.visited(c, c.C.At, g.Tick()); err != nil {
			return Result{}, err
		}
		if err := g.cadence(c, g.Tick()); err != nil {
			return Result{}, err
		}
	}
	facts := g.Log.Since(first)
	g.keepNews(facts)
	if err := g.takeTraceErr(); err != nil {
		return Result{}, err
	}
	g.World.Note(facts...)
	facts = g.Log.Since(first)
	g.spent = g.points
	return Result{Char: c, Facts: facts, Pressed: pressed, Machine: machine, Moved: slices.Clone(g.touched), Seen: g.seenNow(), Points: g.points}, nil
}

// actWorld applies a command that acts on the world itself: there is no
// character to look up, collect for or mark as having acted.
func (g *Game) actWorld(cmd Command) (Result, error) {
	defer g.stagingFor(cmd)()
	first := fact.ID(g.Log.Len())
	run := worldCommand(cmd.Kind)
	if run == nil {
		return Result{}, refuse(BadArgs, "%s is not a world command", cmd.Kind)
	}
	if err := run(g, cmd); err != nil {
		return Result{}, err
	}
	if err := g.creditGoals(first, cmd.Key); err != nil {
		return Result{}, err
	}
	facts := g.Log.Since(first)
	g.keepNews(facts)
	if err := g.takeTraceErr(); err != nil {
		return Result{}, err
	}
	g.World.Note(facts...)
	facts = g.Log.Since(first)
	g.spent = g.points
	return Result{Facts: facts, Moved: slices.Clone(g.touched), Seen: g.seenNow(), Points: g.points}, nil
}

// seenNow are the characters the command showed something new to, less
// those whose rows moved anyway.
func (g *Game) seenNow() []string {
	var out []string
	for _, id := range g.seen {
		if !slices.Contains(g.touched, id) {
			out = append(out, id)
		}
	}
	return out
}

// dispatchStaged runs a command, in its stage's context when it works on
// one.
func (g *Game) dispatchStaged(c *Char, cmd Command) ([]fight.Pressed, *puzzle.Result, error) {
	if st := g.cmdStage(cmd); st != nil {
		defer g.withStage(st)()
	}
	return g.dispatch(c, cmd)
}

// dispatch runs a command; a machine command also hands back the result
// its move log became.
func (g *Game) dispatch(c *Char, cmd Command) ([]fight.Pressed, *puzzle.Result, error) {
	if err := g.watchGuard(c, cmd.Kind); err != nil {
		return nil, nil, err
	}
	switch cmd.Kind {
	case MachineArm:
		return nil, nil, g.machineArm(c, cmd)
	case MachineSolve:
		return g.machineSolve(c, cmd)
	case BenchSolve:
		res, err := g.benchSolve(c, cmd)
		return nil, res, err
	case BenchLesson:
		return nil, nil, g.benchLesson(c, cmd)
	}
	pressed, err := g.act(c, cmd)
	return pressed, nil, err
}

func (g *Game) act(c *Char, cmd Command) ([]fight.Pressed, error) {
	switch cmd.Kind {
	case Step, Travel:
		return nil, g.travel(c, cmd)
	case Gather:
		return nil, g.gather(c, cmd)
	case Rest:
		return nil, g.rest(c, cmd)
	case Cancel:
		return nil, g.cancel(c)
	case Explore:
		return nil, g.explore(c)
	case Press:
		return g.press(c, cmd)
	case Correct:
		return nil, g.correct(c, cmd)
	case Grant:
		return nil, g.grant(c, cmd)
	case Ban, Unban:
		return nil, g.ban(c, cmd.Kind == Ban, cmd.Note)
	case SetMachine:
		return nil, g.setMachine(c, cmd)
	case SetReady:
		return nil, g.setReady(c, cmd)
	case Sell:
		return nil, g.sell(c, cmd)
	case Bid:
		return nil, g.order(c, cmd, market.Bid, true)
	case Ask:
		return nil, g.order(c, cmd, market.Ask, true)
	case Take:
		return nil, g.take(c, cmd)
	case Withdraw:
		return nil, g.withdraw(c, cmd)
	case List:
		return nil, g.list(c, cmd)
	case Want:
		return nil, g.want(c, cmd)
	case Purchase:
		return nil, g.purchase(c, cmd)
	case Give:
		return nil, g.give(c, cmd)
	case SellItem:
		return nil, g.sellItem(c, cmd)
	case Buy:
		return nil, g.buy(c, cmd)
	case Feed:
		return nil, g.feed(c, cmd)
	case Equip:
		return nil, g.equip(c, cmd)
	case Craft:
		return nil, g.craftCmd(c, cmd)
	case Repair:
		return nil, g.repair(c, cmd)
	case Pick:
		return nil, g.pick(c, cmd)
	case Forage:
		return nil, g.forage(c, cmd)
	case Crawl:
		return nil, g.crawl(c, cmd)
	case Search:
		return nil, g.search(c, cmd)
	case Stash:
		return nil, g.stash(c, cmd)
	case Talk:
		return nil, g.talk(c, cmd)
	case Choose:
		return nil, g.choose(c, cmd)
	case Consent:
		return nil, g.consent(c, cmd)
	case Look:
		return nil, g.look(c)
	case FoundGuild, Invite, Join, Leave, Promote, Vote, Deposit, Pay, Approve, Draw, Allow, Work:
		return nil, g.guildAct(c, cmd)
	case PostGoal, Pledge, DeliverGoal, TakeHaul, WithdrawGoal, CallHelp, CarryHome, Raise:
		return nil, g.goalAct(c, cmd)
	case HideGoal:
		return nil, g.hideGoal(cmd)
	case Found:
		return nil, g.foundSettlement(c, cmd)
	case Charter:
		return nil, g.charter(c, cmd)
	case Mend:
		return nil, g.mend(c, cmd)
	case ChooseClass, TakeAbility, MarkPrey:
		return nil, g.classAct(c, cmd)
	case PartyInvite:
		return nil, g.partyInvite(c, cmd)
	case PartyJoin:
		return nil, g.partyJoin(c, cmd)
	case PartyLeave:
		return nil, g.partyLeave(c, cmd)
	case PartyPick:
		return g.partyPick(c, cmd)
	case PartyWindow:
		return g.partyWindow(c, cmd)
	case Follow, Unfollow:
		return nil, g.follow(c, cmd.Kind == Follow)
	case DungeonPush:
		return nil, g.dungeonPush(c, cmd)
	case DungeonLeave:
		return nil, g.dungeonLeave(c, cmd)
	case DungeonName:
		return nil, g.dungeonName(c, cmd)
	case PromoteName:
		return nil, g.promoteName(c, cmd)
	case KindName:
		return nil, g.kindName(c, cmd)
	case KeyMake:
		return nil, g.keyMake(c, cmd)
	case HuntPress:
		return g.huntPress(c, cmd)
	case DeckSwap:
		return nil, g.deckSwap(c, cmd)
	case FollowTrack:
		return nil, g.followTrack(c, cmd)
	case HideName:
		return nil, g.hideName(c, cmd)
	case BackSide:
		return nil, g.backSide(c, cmd)
	case CityRaise:
		return nil, g.cityRaise(c, cmd)
	case PatternSet:
		return nil, g.patternSet(c, cmd)
	}
	if run := crimeCommands[cmd.Kind]; run != nil {
		return nil, run(g, c, cmd)
	}
	if run := houseCommands[cmd.Kind]; run != nil {
		return nil, run(g, c, cmd)
	}
	return nil, refuse(BadArgs, "unknown command %q", cmd.Kind)
}

// ValidKey refuses an interaction id a command may not carry: empty, too
// long, or holding the '/' that ledger.SubKey reserves.
func ValidKey(key string) error {
	if key == "" || len(key) > maxKey || strings.Contains(key, "/") {
		return refuse(BadArgs, "a command needs an interaction id of at most %d characters, with no '/'", maxKey)
	}
	return nil
}

// create makes a character at its server's settlement, or the first
// starting settlement, in its server's own guild. Nothing is granted: no
// purse, no kit (GDD 10.1 rule 6). guildName names the server's guild if
// this is the server's first player.
func (g *Game) create(server, guildName string) (*Char, error) {
	g.NextChar++
	id := "c-" + strconv.FormatInt(g.NextChar, decimal)
	c := &Char{C: char.New(id, g.r.Gen.Settlement(0).Hex), Born: g.Tick(), Server: server}
	g.insert(c)
	if err := g.joinServer(c, server, guildName); err != nil {
		return nil, err
	}
	if n, ok := g.home(server); ok {
		c.C.At = g.SettlementHex(n)
		c.C.Home = goal.SettlementRef(n)
	}
	if err := g.Teleport(c, c.C.At); err != nil {
		return nil, err
	}
	_, err := g.fact(c, "character.arrived", g.Tick())
	return c, err
}

// structural: ids are written in decimal; an interaction id fits Discord's
// and the Activity's.
const (
	decimal = 10
	maxKey  = 128
)

// idle is free, and neither banned nor working a machine: what a bench
// or an operator's machine needs.
func idle(c *Char) error {
	if c.Banned || c.Armed != nil {
		return refuse(Busy, "%s is banned or has a machine armed", c.C.ID)
	}
	return free(c)
}

// free reports why a character cannot start something new: a long action
// running, an encounter open, down, or standing on a dungeon's floor,
// where it pushes on, leaves, crawls or is carried.
func free(c *Char) error {
	if err := ready(c); err != nil {
		return err
	}
	if c.C.Floor > 0 {
		return refuse(Busy, "%s is on floor %d of a dungeon", c.C.ID, c.C.Floor)
	}
	return nil
}

// ready is free short of the floor: up, with no long action and no
// encounter.
func ready(c *Char) error {
	if err := notDown(c); err != nil {
		return err
	}
	if c.Long != nil {
		return refuse(Busy, "%s is already %s", c.C.ID, c.Long.Kind)
	}
	if c.Fight != nil {
		return refuse(Busy, "%s is in an encounter", c.C.ID)
	}
	return nil
}

func notDown(c *Char) error {
	if slices.ContainsFunc(c.C.Conditions, func(x char.Condition) bool { return x.Tag == char.Down }) {
		return refuse(DownCode, "%s is down", c.C.ID)
	}
	return nil
}

// explore begins an encounter at the site the character stands on.
func (g *Game) explore(c *Char) error {
	if err := free(c); err != nil {
		return err
	}
	if !g.CanExplore(c.C.At) {
		return refuse(NotHere, "nothing to explore on this tile")
	}
	if g.thin(c, c.C.At) {
		_, err := g.fact(c, "trigger.fired", g.Tick(), fact.S("trigger", TrigThin))
		return err
	}
	return g.begin(c, false, 0)
}

// beginning is an encounter being assembled: who is in it, in seat
// order with the character who began it among them, and the creature it
// is against, which a dungeon floor may change before it is spawned.
type beginning struct {
	ambush  bool
	due     int64
	members []*Char
	arch    string
	extra   []tags.Tag
}

// begin assembles an encounter on the character's tile against one of
// the creatures its biome holds, picked by a keyed draw. Party members on
// the tile and floor who are ready are in it too, as one shared encounter.
func (g *Game) begin(c *Char, ambush bool, due int64) error {
	h := c.C.At
	kinds := g.Creatures(h)
	if len(kinds) == 0 {
		return refuse(NotHere, "nothing lives on this tile")
	}
	members := g.joining(c)
	id := "e-" + c.C.ID + "-" + strconv.FormatInt(c.Encounters+1, decimal)
	arch := kinds[g.r.draw.Below(uint64(len(kinds)), "game.creature", draw.Str(id))]
	extra, high := g.encounterTags(c, h, arch)
	place := append(g.World.Place(h).Tags(), high...)
	for _, t := range g.siteKindTags(h) {
		if !slices.Contains(place, t) {
			place = append(place, t)
		}
	}
	ms := g.measures(h)
	if len(members) > 1 {
		ms = append(ms, tags.Measure{ID: measurePartySize, Value: int64(len(members))})
	}
	b := &beginning{ambush: ambush, due: due, members: members, arch: arch, extra: extra}
	site := fight.Site{ID: id, Place: machinePlace(h, 0), Tags: place, Measures: ms, Party: int64(len(members))}
	if !ambush && g.IsDungeon(h) {
		if err := g.enterFloor(c, b, &site); err != nil {
			return err
		}
	}
	c.Encounters++
	drop := g.emergentBegin(h, b, &site)
	cr := g.r.Fight.Spawn(b.arch, b.extra, site.Tags, site.Measures)
	if drop != "" {
		cr.WithDrop(drop)
	}
	e := g.r.Fight.Assemble(site, cr)
	if len(b.members) <= 1 {
		c.Fight = &Fight{E: e, Measures: site.Measures, Ambush: ambush, Due: due}
		return nil
	}
	sh := g.newShared(g.partyOf(c), h, site.Floor, b.members)
	for _, m := range b.members {
		m.Fight = &Fight{E: e, Measures: site.Measures, Ambush: ambush, Due: due, Shared: sh.ID}
		if m != c {
			g.touchOnce(m)
		}
	}
	return nil
}

// structural: the measure a creature's behaviour reads a party's size by.
const measurePartySize = "party-size"

// machinePlace is where an encounter's machines stand: the tile, or a
// dungeon's floor.
func machinePlace(h hex.Hex, floor int64) string {
	if floor > 0 {
		return "floor:" + h.Ref() + "/" + strconv.FormatInt(floor, decimal)
	}
	return "tile:" + h.Ref()
}

// press resolves the current beat with the picked option; an encounter
// that ends pays out its haul and leaves its mark on the tile.
func (g *Game) press(c *Char, cmd Command) ([]fight.Pressed, error) {
	if c.Fight == nil {
		return nil, refuse(NoFight, "%s is in no encounter", c.C.ID)
	}
	if c.Fight.Shared != "" {
		return g.partyPick(c, cmd)
	}
	return g.pressOption(c, cmd.Key, cmd.Option, g.Tick(), nil)
}

// pressOption presses an option on the current beat. A machine's option
// takes the result its move log was replayed into.
func (g *Game) pressOption(c *Char, key, pick string, tick int64, w *worked) ([]fight.Pressed, error) {
	if c.Fight.Theft != nil {
		return g.theftPress(c, key, pick, tick, w)
	}
	f := g.r.Fight
	e := c.Fight.E
	kit, opts := g.beat(c, tick)
	o, ok := fight.OptionByID(opts, pick)
	if !ok {
		return nil, refuse(BadArgs, "no option %q on this beat", pick)
	}
	left, spent := g.xpLeft(c)
	m := &fight.Member{Ch: c.C, Kit: kit, Pick: pick, XPCap: left}
	if o.Puzzle {
		if w == nil {
			return nil, refuse(InActivity, "a machine is worked in the Activity")
		}
		m.Puzzle = &w.res
	}
	pack := slices.Clone(c.C.Pack)
	beat := int64(e.At) + 1
	g.attachPool(c.C.At, e, tick)
	pressed, facts, err := f.Press(e, []*fight.Member{m}, tick)
	if err != nil {
		return nil, err
	}
	spent()
	if err := g.guardianPressed(c.C.At, e, nil, tick); err != nil {
		return nil, err
	}
	if err := g.logEncounterFacts(c.C.At, e, facts, w); err != nil {
		return nil, err
	}
	g.deeds(c, pressed)
	if err := g.lost(c, key, pack, tick); err != nil {
		return nil, err
	}
	if len(pressed) > 0 && pressed[0].Outcome.Success {
		// A staged fight leaves no mark on the tile or its gauges.
		if g.staging == nil {
			g.wonBeat(c, e)
		}
		if err := g.noteReliance(c, e, pressed[0].Option, tick); err != nil {
			return nil, err
		}
		// A side counts a solo fighter's beats as it counts a party's; only
		// a world with a director writes beat.won, so an older world
		// replays to the same log.
		if g.Story != nil {
			if _, err := g.factWith(c, nil, "beat.won", tick, fact.S("encounter", e.ID), fact.N("beat", beat),
				fact.S("option", pressed[0].Option.ID), fact.N("score", pressed[0].Option.Score)); err != nil {
				return nil, err
			}
		}
	}
	if e.Over {
		return pressed, g.close(c, key, tick)
	}
	return pressed, nil
}

// close ends an encounter: the haul and any salvage go to the character,
// and the world hears of a kill or a fall.
func (g *Game) close(c *Char, key string, tick int64) error {
	e := c.Fight.E
	c.Fight = nil
	c.Swapped = 0
	if err := g.floorClosed(c, e, []*Char{c}); err != nil {
		return err
	}
	acc := ledger.Char(c.C.ID)
	for i, s := range e.Haul {
		if err := g.receive(c, ledger.Move(ledger.SubKey(key, "haul", strconv.Itoa(i)), "haul", tick, g.mintSource(ledger.FromHaul), acc, g.mintAsset(s.Material), s.Qty)); err != nil {
			return err
		}
	}
	g.carriedFrom(c, e.Haul)
	for _, sv := range e.Salvage {
		for i, s := range sv.Spoil {
			src, asset := g.salvaged(sv, s.Material)
			if err := g.receive(c, ledger.Move(ledger.SubKey(key, "salvage", strconv.Itoa(i)), "salvage", tick, src, acc, asset, s.Qty)); err != nil {
				return err
			}
		}
	}
	if err := g.drop(c, key, e.Lost, tick); err != nil {
		return err
	}
	// A staged fight's kill or fall reaches no population, tile or NPC.
	if g.staging != nil {
		return nil
	}
	switch e.Result {
	case fight.Won:
		g.Pending = append(g.Pending, world.Action{Kind: world.ActSlay, Hex: c.C.At, By: char.Ref(c.C.ID), Species: e.Creature.Archetype})
		if err := g.fought(c, c.C.At, e.Creature.Archetype, tick); err != nil {
			return err
		}
		return g.noteClearing(c, e, tick)
	case fight.Lost:
		return g.fellOnTile(c, e, tick)
	}
	return nil
}

// fellOnTile marks a loss on the tile; a floor's is the floor's own record.
func (g *Game) fellOnTile(c *Char, e *fight.Encounter, tick int64) error {
	if e.Floor == 0 {
		g.Pending = append(g.Pending, world.Action{Kind: world.ActFall, Hex: c.C.At, By: char.Ref(c.C.ID)})
	}
	return g.noteLoss(c, e, tick)
}

// receive posts a movement into a character's account and adds the goods
// it names to what they carry.
func (g *Game) receive(c *Char, t ledger.Txn) error {
	before := g.heldBefore(t)
	if err := g.post(t); err != nil {
		return err
	}
	g.hotSettled(before)
	for _, l := range t.Legs {
		if l.Account == ledger.Char(c.C.ID) {
			hold(c.C, l.Asset, l.Units)
		}
	}
	return nil
}

// hold changes what a character carries of a fungible asset.
func hold(c *char.Character, asset string, n int64) {
	switch asset {
	case ledger.Coin:
		c.Coin += n
	case ledger.Provisions:
		c.Provisions += n
	default:
		if m, ok := ledger.MaterialOf(asset); ok {
			c.Goods = addGoods(c.Goods, m, n)
		} else if at, m, ok := ledger.StagedOf(asset); ok {
			c.Staged = char.AddStaged(c.Staged, at, m, n)
		}
	}
}

func addGoods(list []item.Spoil, material string, n int64) []item.Spoil {
	if n > 0 {
		return item.AddSpoil(list, material, n)
	}
	i := slices.IndexFunc(list, func(s item.Spoil) bool { return s.Material == material })
	if i >= 0 {
		list[i].Qty += n
		if list[i].Qty == 0 {
			list = slices.Delete(list, i, i+1)
		}
	}
	return list
}

// lost writes off items that left the pack during a press: broken gear,
// with any exploit loaded in it.
func (g *Game) lost(c *Char, key string, before []*item.Instance, tick int64) error {
	for _, in := range before {
		if c.C.Item(in.ID) == nil {
			t := ledger.Txn{Key: ledger.SubKey(key, "lost", in.ID), Kind: "broke", Tick: tick, Legs: itemLegs(in, ledger.Char(c.C.ID), ledger.ToLost)}
			if err := g.post(t); err != nil {
				return err
			}
		}
	}
	return nil
}

// correct is an operator's correction of a balance, recorded as a fact
// and moved through the operator's source or sink.
func (g *Game) correct(c *Char, cmd Command) error {
	if cmd.Units == 0 || cmd.Note == "" || (cmd.Asset != ledger.Coin && cmd.Asset != ledger.Provisions) && !g.isMaterial(cmd.Asset) {
		return refuse(BadArgs, "a correction needs a coin, provisions or material asset, units and a note")
	}
	if cmd.Units < 0 && g.Ledger.Of(ledger.Char(c.C.ID), cmd.Asset) < -cmd.Units {
		return refuse(BadArgs, "%s holds less than %d %s", c.C.ID, -cmd.Units, cmd.Asset)
	}
	f, err := g.fact(c, "ledger.corrected", g.Tick(), fact.S("asset", cmd.Asset), fact.N("units", cmd.Units), fact.S("note", cmd.Note))
	if err != nil {
		return err
	}
	from, to := ledger.FromOperator, ledger.Char(c.C.ID)
	units := cmd.Units
	if units < 0 {
		from, to, units = to, ledger.ToOperator, -units
	}
	t := ledger.Move(cmd.Key, "correction", g.Tick(), from, to, cmd.Asset, units)
	t.Fact = f.ID
	return g.receive(c, t)
}

// isMaterial reports whether asset names a material: the sheets' or one
// the world found.
func (g *Game) isMaterial(asset string) bool {
	id, ok := ledger.MaterialOf(asset)
	return ok && g.knownMaterial(id)
}

// grant gives a character a mount of a mounts.kinds row, as an operator.
func (g *Game) grant(c *Char, cmd Command) error {
	if g.r.Mounts.Kind(cmd.Asset) == nil || cmd.Note == "" {
		return refuse(BadArgs, "a grant needs a mount kind and a note")
	}
	return g.giveMount(c, cmd.Key, cmd.Asset, func(id string) error {
		f, err := g.fact(c, "item.granted", g.Tick(), fact.S("kind", cmd.Asset), fact.S("item", id), fact.S("note", cmd.Note))
		if err != nil {
			return err
		}
		t := ledger.Move(cmd.Key, "grant", g.Tick(), ledger.FromOperator, ledger.Char(c.C.ID), ledger.Item(id), 1)
		t.Fact = f.ID
		return g.post(t)
	})
}

func (g *Game) ban(c *Char, on bool, note string) error {
	if note == "" || c.Banned == on {
		return refuse(BadArgs, "a ban or unban needs a note and must change something")
	}
	c.Banned = on
	if !on {
		_, err := g.fact(c, "character.unbanned", g.Tick(), fact.S("note", note))
		return err
	}
	// A banned character neither travels nor fights: an open encounter
	// ends unpaid.
	data := []fact.Datum{fact.S("note", note)}
	if c.Fight != nil {
		data = append(data, fact.S("encounter", c.Fight.E.ID))
	}
	endJourney(c)
	g.unshare(c)
	c.Fight = nil
	c.Armed = nil
	if err := g.quitParty(c, g.Tick()); err != nil {
		return err
	}
	_, err := g.fact(c, "character.banned", g.Tick(), data...)
	return err
}

// RegionGauges are the gauges of the region holding a tile, in sheet
// order, sourced to the region, and the index of the faction holding it
// (-1 for none); ok is false outside every region.
func (g *Game) RegionGauges(h hex.Hex) (gauges []tags.Measure, holder int, ok bool) {
	r := g.World.RegionAt(h)
	if r < 0 {
		return nil, -1, false
	}
	reg := g.World.Regions[r]
	from := tags.Source{Note: "region:" + world.RegionRef(r)}
	for i, gg := range g.r.Book.Gauges {
		gauges = append(gauges, tags.Measure{ID: gg.ID, Value: reg.Gauge[i], From: from})
	}
	return gauges, reg.Holder, true
}

// measures are the region's gauges a rule may test, at a tile.
func (g *Game) measures(h hex.Hex) []tags.Measure {
	ms, _, _ := g.RegionGauges(h)
	return ms
}
