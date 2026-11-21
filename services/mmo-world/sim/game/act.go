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
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/market"
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
	return kind == Correct || kind == Grant || kind == Ban || kind == Unban || kind == HideGoal
}

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
)

// Result is what a command did.
type Result struct {
	Char    *Char           `json:"char"`
	Facts   []fact.Fact     `json:"facts"`
	Pressed []fight.Pressed `json:"pressed,omitempty"`
}

// Act applies a command at the current tick. A refused command changes
// nothing. Any other error leaves the game part-way, and the caller
// reloads it.
func (g *Game) Act(cmd Command) (Result, error) {
	if err := ValidKey(cmd.Key); err != nil {
		return Result{}, err
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
	first := fact.ID(g.Log.Len())
	var c *Char
	var err error
	var pressed []fight.Pressed
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
		if c.Banned && !Operator(cmd.Kind) {
			return Result{}, refuse(BannedCode, "character %s is banned", c.C.ID)
		}
		undo := g.admit(c, cmd)
		if pressed, err = g.act(c, cmd); err != nil {
			undo()
		}
	}
	if err != nil {
		return Result{}, err
	}
	if !Operator(cmd.Kind) {
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
	if !Operator(cmd.Kind) {
		c.Acted = g.Tick()
		c.markDay(g.Tick() / sheets.TicksPerDay)
		g.visited(c, c.C.At, g.Tick())
		if err := g.cadence(c, g.Tick()); err != nil {
			return Result{}, err
		}
	}
	facts := g.Log.Since(first)
	g.keepNews(facts)
	return Result{Char: c, Facts: facts, Pressed: pressed}, nil
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
	g.Pending = append(g.Pending, world.Action{Kind: world.ActDiscover, Hex: c.C.At, By: char.Ref(id)})
	_, err := g.fact(c, "character.arrived", g.Tick())
	return c, err
}

// structural: ids are written in decimal; an interaction id fits Discord's
// and the Activity's.
const (
	decimal = 10
	maxKey  = 128
)

// free reports why a character cannot start something new: a long action
// running, an encounter open, or down.
func free(c *Char) error {
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

// begin assembles an encounter on the character's tile against one of
// the creatures its biome holds, picked by a keyed draw.
func (g *Game) begin(c *Char, ambush bool, due int64) error {
	h := c.C.At
	kinds := g.r.Gen.Creatures(h)
	if len(kinds) == 0 {
		return refuse(NotHere, "nothing lives on this tile")
	}
	c.Encounters++
	id := "e-" + c.C.ID + "-" + strconv.FormatInt(c.Encounters, decimal)
	arch := kinds[g.r.draw.Below(uint64(len(kinds)), "game.creature", draw.Str(id))]
	extra, high := g.encounterTags(c, h, arch)
	place := append(g.World.Place(h).Tags(), high...)
	ms := g.measures(h)
	cr := g.r.Fight.Spawn(arch, extra, place, ms)
	site := fight.Site{ID: id, Place: "tile:" + h.Ref(), Tags: place, Measures: ms, Party: 1}
	if !ambush && g.IsDungeon(h) {
		site.Floor, site.Place = firstFloor, "floor:"+h.Ref()+"/"+strconv.Itoa(firstFloor)
	}
	e := g.r.Fight.Assemble(site, cr)
	c.Fight = &Fight{E: e, Measures: ms, Ambush: ambush, Due: due}
	if site.Floor > 0 {
		_, err := g.fact(c, "dungeon.entered", g.Tick(), append([]fact.Datum{fact.N("floor", site.Floor)}, fact.At(h)...)...)
		return err
	}
	return nil
}

// press resolves the current beat with the picked option; an encounter
// that ends pays out its haul and leaves its mark on the tile.
func (g *Game) press(c *Char, cmd Command) ([]fight.Pressed, error) {
	if c.Fight == nil {
		return nil, refuse(NoFight, "%s is in no encounter", c.C.ID)
	}
	return g.pressOption(c, cmd.Key, cmd.Option, g.Tick())
}

func (g *Game) pressOption(c *Char, key, pick string, tick int64) ([]fight.Pressed, error) {
	f := g.r.Fight
	e := c.Fight.E
	kit, opts := g.beat(c, tick)
	o, ok := fight.OptionByID(opts, pick)
	if !ok {
		return nil, refuse(BadArgs, "no option %q on this beat", pick)
	}
	if o.Puzzle {
		return nil, refuse(InActivity, "a machine is worked in the Activity")
	}
	pack := slices.Clone(c.C.Pack)
	pressed, facts, err := f.Press(e, []*fight.Member{{Ch: c.C, Kit: kit, Pick: pick}}, tick)
	if err != nil {
		return nil, err
	}
	for _, x := range facts {
		if strings.HasPrefix(x.Kind, "encounter.") {
			x.Data = append(x.Data, append(fact.At(c.C.At), fact.S("archetype", e.Creature.Archetype), fact.S("tags", joinTags(e.Creature.Tags)))...)
		}
		if _, err := g.Log.Append(x); err != nil {
			return nil, err
		}
	}
	g.deeds(c, pressed)
	if err := g.lost(c, key, pack, tick); err != nil {
		return nil, err
	}
	if len(pressed) > 0 && pressed[0].Outcome.Success {
		g.Pending = append(g.Pending, world.Action{Kind: world.ActWinBeat, Hex: c.C.At, By: char.Ref(c.C.ID), Tag: e.Creature.Archetype})
		// The world refuses an ease of nothing, which a small scale floors to.
		more := g.charScale(c, "beat-threat", fixed.Hundredths) - fixed.Hundredths
		if ease := -g.r.wp("beat-won-threat") * more / fixed.Hundredths; more > 0 && ease > 0 {
			g.Pending = append(g.Pending, world.Action{Kind: world.ActEase, Hex: c.C.At, By: char.Ref(c.C.ID), Units: ease})
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
	acc := ledger.Char(c.C.ID)
	for i, s := range e.Haul {
		if err := g.receive(c, ledger.Move(ledger.SubKey(key, "haul", strconv.Itoa(i)), "haul", tick, ledger.FromHaul, acc, ledger.Material(s.Material), s.Qty)); err != nil {
			return err
		}
	}
	for _, sv := range e.Salvage {
		for i, s := range sv.Spoil {
			if err := g.receive(c, ledger.Move(ledger.SubKey(key, "salvage", strconv.Itoa(i)), "salvage", tick, ledger.FromSalvage, acc, ledger.Material(s.Material), s.Qty)); err != nil {
				return err
			}
		}
	}
	if err := g.drop(c, key, e.Lost, tick); err != nil {
		return err
	}
	switch e.Result {
	case fight.Won:
		g.Pending = append(g.Pending, world.Action{Kind: world.ActSlay, Hex: c.C.At, By: char.Ref(c.C.ID), Species: e.Creature.Archetype})
		if e.Floor > 0 {
			g.Pending = append(g.Pending, world.Action{Kind: world.ActClearFloor, Hex: c.C.At, By: char.Ref(c.C.ID), Units: e.Floor})
			c.C.Deepest.Bump(c.C.At.Ref(), max(0, e.Floor-c.C.Deepest.Get(c.C.At.Ref())))
			c.C.Deeds.Bump(DeedFloors, 1)
			if _, err := g.fact(c, "dungeon.floor-cleared", tick, append([]fact.Datum{fact.N("floor", e.Floor)}, fact.At(c.C.At)...)...); err != nil {
				return err
			}
		}
		if err := g.fought(c, c.C.At, e.Creature.Archetype, tick); err != nil {
			return err
		}
	case fight.Lost:
		g.Pending = append(g.Pending, world.Action{Kind: world.ActFall, Hex: c.C.At, By: char.Ref(c.C.ID)})
	}
	return nil
}

// receive posts a movement into a character's account and adds the goods
// it names to what they carry.
func (g *Game) receive(c *Char, t ledger.Txn) error {
	if err := g.post(t); err != nil {
		return err
	}
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

// isMaterial reports whether asset names a base material of the sheets.
func (g *Game) isMaterial(asset string) bool {
	id, ok := ledger.MaterialOf(asset)
	if ok {
		_, ok = g.r.Fight.D.Material(id)
	}
	return ok
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
	c.Fight = nil
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
