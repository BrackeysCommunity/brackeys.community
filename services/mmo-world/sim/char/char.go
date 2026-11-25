// Package char is a character: what it carries, what it has practised,
// and a short memory of what it has done (GDD 5). Rules read all of it.
package char

import (
	"cmp"
	"fmt"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/class"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/fixed"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tags"
	"jams.team/mmo-world/sim/tally"
)

// Ref is the fact ref of a character.
func Ref(id string) fact.Ref { return fact.Ref{Kind: "character", ID: id} }

// DeedRoadSteps counts steps onto road tiles, which a Roadwarden's
// threshold reads.
const DeedRoadSteps = "road-steps"

// Slot names in the kit (GDD 5.2).
const (
	Hand    = "hand"
	OffHand = "off-hand"
	Body    = "body"
	Charm   = "charm"
	Mount   = "mount"
)

// Conditions the rules set and clear by name.
const (
	Hungry  = "hungry"
	Wounded = "wounded"
	Down    = "down"
	// ArcMarked is a backer of a world arc's side, whom the other side's
	// ambushes prefer until the arc ends (GDD 5.5).
	ArcMarked = "arc-marked"
)

// Condition is a condition and the tick it ends at (0: until cleared).
type Condition struct {
	Tag  tags.Tag `json:"tag"`
	Ends int64    `json:"ends"`
}

// structural: charms are worn two at once; every other slot holds one.
const charmSlots = 2

// SlotCount is how many items a kit slot holds, by index from 0.
func SlotCount(slot string) int {
	if slot == Charm {
		return charmSlots
	}
	return 1
}

// Equipped is an item in a kit slot. Charms take two slots, by index.
type Equipped struct {
	Slot  string `json:"slot"`
	Index int    `json:"index"`
	Item  string `json:"item"` // instance id in Pack
}

// Skill is one practice: its level and the uses toward the next.
type Skill struct {
	ID    string `json:"id"`
	Level int64  `json:"level"`
	Uses  int64  `json:"uses"`
}

// Fights is what a character has fought: beats won and lost by creature
// tag, times down and where, and a nemesis.
type Fights struct {
	Won      tally.Tally `json:"won"`
	Lost     tally.Tally `json:"lost"`
	Downs    int64       `json:"downs"`
	DownedAt []hex.Hex   `json:"downedAt"`
	DownedBy tally.Tally `json:"downedBy"`
}

// Nemesis is what has downed them most, by archetype.
func (f Fights) Nemesis() string {
	best, n := "", int64(0)
	for _, c := range f.DownedBy {
		if c.N > n {
			best, n = c.Key, c.N
		}
	}
	return best
}

// Met is someone the character met, and how.
type Met struct {
	Who  string `json:"who"`
	How  string `json:"how"` // one of the Met kinds
	Tick int64  `json:"tick"`
}

// Met kinds: how company was kept.
const (
	MetMet       = "met"
	MetTraded    = "traded"
	MetPartied   = "partied" // won an encounter in one party
	MetRescued   = "rescued"
	MetRescuedBy = "rescued-by"
)

// Disposition is a notable's leaning toward the character.
type Disposition struct {
	Notable string `json:"notable"`
	Value   int64  `json:"value"`
}

// Character holds every group of GDD 5.7 from the start, even where
// nothing writes it yet.
type Character struct {
	ID string `json:"id"`

	// Where
	At     hex.Hex   `json:"at"`
	Floor  int64     `json:"floor,omitempty"` // the dungeon floor stood on at At; 0 is outside
	Facing int       `json:"facing"`
	Route  []hex.Hex `json:"route"`
	Trail  []hex.Hex `json:"trail"` // last tiles walked, newest last

	// State
	Conditions []Condition `json:"conditions"`
	Coin       int64       `json:"coin"`
	Provisions int64       `json:"provisions"`
	Guild      string      `json:"guild,omitempty"`
	Home       string      `json:"home,omitempty"`

	// Kit
	Pack     []*item.Instance `json:"pack"`
	Equipped []Equipped       `json:"equipped"`
	Goods    []item.Spoil     `json:"goods"` // materials carried
	// Staged are the staged goods carried, by origin settlement and
	// material, mirroring the ledger's stg: assets; Goods never holds them.
	Staged []StagedGoods `json:"staged,omitempty"`

	// Knowledge
	Recipes   []string `json:"recipes"`
	Patterns  []string `json:"patterns"`
	Rumours   []string `json:"rumours"`
	TilesSeen int64    `json:"tilesSeen"`
	Landmarks []string `json:"landmarks"`

	// Practice
	Practice []Skill `json:"practice"`

	// Standing
	Standing      tally.Tally `json:"standing"`      // per faction
	GuildStanding tally.Tally `json:"guildStanding"` // per guild

	// Journey ring: the last heavy facts naming them.
	Journey []fact.ID `json:"journey"`

	Fights Fights `json:"fights"`

	// Company: the last characters met, traded with, partied with,
	// rescued or rescued by.
	Company []Met `json:"company"`

	// People: notables met, with each one's disposition.
	People []Disposition `json:"people"`

	// Making
	Discovered []string    `json:"discovered"`
	Crafts     tally.Tally `json:"crafts"` // by process
	SoldStamp  int64       `json:"soldStamp"`

	// Trade
	Earned tally.Tally `json:"earned"` // by source
	Spent  tally.Tally `json:"spent"`  // by sink
	Hauled tally.Tally `json:"hauled"` // by route

	// Goals
	Goals tally.Tally `json:"goals"` // posted, met, lapsed, vows-kept, vows-broken

	// Classes: earned, active and abilities taken; Deeds the counts their
	// thresholds read; Prey the creature tag a Stalker marked, and the day.
	Classes class.State `json:"classes"`
	Deeds   tally.Tally `json:"deeds,omitempty"`
	Prey    Prey        `json:"prey"`

	// Travel
	Discoveries  int64       `json:"discoveries"`
	Walked       int64       `json:"walked"`
	FurthestHome int64       `json:"furthestHome"`
	Deepest      tally.Tally `json:"deepest"` // dungeon -> deepest floor

	// Streaks and firsts
	Streaks tally.Tally `json:"streaks"`
	Firsts  []string    `json:"firsts"`

	// Flags
	Flags    []string `json:"flags"`
	StagedXP int64    `json:"stagedXP"` // used today
	// StagedDay is the world day StagedXP counts.
	StagedDay int64 `json:"stagedDay,omitempty"`

	// Alignment is nil until the first act that moves it, so a character
	// saved before alignment reads 0 and digests as it did (GDD 5.10).
	Alignment *Alignment `json:"alignment,omitempty"`
}

// StagedGoods are units of one material a server staged at one
// settlement (GDD 14.5).
type StagedGoods struct {
	At       int    `json:"at"` // Place.N
	Material string `json:"material"`
	Units    int64  `json:"units"`
}

// AddStaged changes the units of one origin's material in a list kept
// sorted by origin then material, dropping an entry that comes to nothing.
func AddStaged(list []StagedGoods, at int, material string, n int64) []StagedGoods {
	i, ok := slices.BinarySearchFunc(list, StagedGoods{At: at, Material: material}, func(a, b StagedGoods) int {
		return cmp.Or(cmp.Compare(a.At, b.At), strings.Compare(a.Material, b.Material))
	})
	if !ok {
		if n == 0 {
			return list
		}
		list = slices.Insert(list, i, StagedGoods{At: at, Material: material})
	}
	list[i].Units += n
	if list[i].Units == 0 {
		list = slices.Delete(list, i, i+1)
	}
	if len(list) == 0 {
		return nil
	}
	return list
}

// WantedCondition is the condition the watch's Wanted entries hold on,
// to the latest entry's end (GDD 5.5).
const WantedCondition = "wanted"

// Alignment is a character's standing with the world at large and what
// its crimes left on it (GDD 5.10, 6.5, 4.5).
type Alignment struct {
	Value int64 `json:"value,omitempty"`
	// Day is the world day Good and Pairs count.
	Day   int64      `json:"day,omitempty"`
	Good  int64      `json:"good,omitempty"`
	Pairs []PairGood `json:"pairs,omitempty"`
	// Known are its public moves, newest last, at most known-kept.
	Known   []Known  `json:"known,omitempty"`
	Grudges []Grudge `json:"grudges,omitempty"`
	Made    bool     `json:"made,omitempty"`
	// Found: a fence has come for it.
	Found bool     `json:"found,omitempty"`
	Hot   []HotLot `json:"hot,omitempty"`
	// Listed are the lots resting in an open ask's escrow, by order; they
	// come back hot if the units come back unsold.
	Listed []HotLot `json:"listed,omitempty"`
	Wanted []Wanted `json:"wanted,omitempty"`
	// Stopped is the settlement index + 1 the watch holds it at.
	Stopped int `json:"stopped,omitempty"`
	// Thefts counts theft and flight encounters begun, naming each one.
	Thefts int64 `json:"thefts,omitempty"`
	// Fenced and Laundered are coin not yet worth a syndicate standing point.
	Fenced    int64 `json:"fenced,omitempty"`
	Laundered int64 `json:"laundered,omitempty"`
}

// PairGood is the good gained from one partner on Alignment.Day.
type PairGood struct {
	With string `json:"with"`
	N    int64  `json:"n"`
}

// Known is one public alignment move: when, where and in which region.
type Known struct {
	Tick   int64   `json:"tick"`
	At     hex.Hex `json:"at"`
	Region int     `json:"region"`
}

// Grudge is a faction it betrayed, by standing key, to a world day.
type Grudge struct {
	Faction string `json:"faction"`
	Ends    int64  `json:"ends"`
}

// Live reports whether the grudge still holds on a world day.
func (g Grudge) Live(day int64) bool { return day < g.Ends }

// HotLot is a quantity of a material carried under a theft's mark.
type HotLot struct {
	Material string   `json:"material"`
	Units    int64    `json:"units"`
	Mark     item.Hot `json:"mark"`
	Order    string   `json:"order,omitempty"`
}

// Wanted is one theft the watch wants it for, and what settles it.
type Wanted struct {
	Victim  string       `json:"victim"`            // ref string: npc:<id>, faction:<i>, caravan:<id>
	Faction string       `json:"faction,omitempty"` // the victim's standing key
	Place   int          `json:"place"`             // the theft's settlement, -1 none
	Worth   int64        `json:"worth"`
	Coin    int64        `json:"coin,omitempty"`
	Goods   []item.Spoil `json:"goods,omitempty"`
	Items   []string     `json:"items,omitempty"`
	Source  string       `json:"source"` // the ledger account the haul left
	Fact    int64        `json:"fact"`
	Ends    int64        `json:"ends"` // tick
}

// Live reports whether the watch still holds the entry at a tick.
func (w Wanted) Live(tick int64) bool { return w.Ends > tick }

// Align is the character's alignment, made on first use.
func (c *Character) Align() *Alignment {
	if c.Alignment == nil {
		c.Alignment = &Alignment{}
	}
	return c.Alignment
}

// AlignmentValue is the character's alignment; one never moved is 0.
func AlignmentValue(c *Character) int64 {
	if c.Alignment == nil {
		return 0
	}
	return c.Alignment.Value
}

// IsMade reports whether the syndicate has made the character.
func IsMade(c *Character) bool { return c.Alignment != nil && c.Alignment.Made }

// FenceFound reports whether a fence has come for the character.
func FenceFound(c *Character) bool { return c.Alignment != nil && c.Alignment.Found }

// StoppedAt is the settlement index + 1 the watch holds the character
// at, 0 when free.
func StoppedAt(c *Character) int {
	if c.Alignment == nil {
		return 0
	}
	return c.Alignment.Stopped
}

// KnownOf are the character's public alignment moves, newest last.
func KnownOf(c *Character) []Known {
	if c.Alignment == nil {
		return nil
	}
	return c.Alignment.Known
}

// GrudgesOf are the factions the character betrayed.
func GrudgesOf(c *Character) []Grudge {
	if c.Alignment == nil {
		return nil
	}
	return c.Alignment.Grudges
}

// HotLotsOf are the material lots the character carries under a mark.
func HotLotsOf(c *Character) []HotLot {
	if c.Alignment == nil {
		return nil
	}
	return c.Alignment.Hot
}

// WantedOf are the thefts the watch wants the character for.
func WantedOf(c *Character) []Wanted {
	if c.Alignment == nil {
		return nil
	}
	return c.Alignment.Wanted
}

// Prey is a creature tag marked on a world day.
type Prey struct {
	Tag string `json:"tag,omitempty"`
	Day int64  `json:"day,omitempty"`
}

// Limits are the ring and list sizes, from the sheets.
type Limits struct {
	Trail, Journey, Company int
}

// New is a fresh character: no class, no stats, only what it carries.
func New(id string, at hex.Hex) *Character {
	return &Character{ID: id, At: at, Pack: []*item.Instance{}, Equipped: []Equipped{}, Goods: []item.Spoil{}, Practice: []Skill{},
		Conditions: []Condition{}, Route: []hex.Hex{}, Trail: []hex.Hex{}, Journey: []fact.ID{}, Company: []Met{},
		People: []Disposition{}, Recipes: []string{}, Patterns: []string{}, Rumours: []string{}, Landmarks: []string{},
		Discovered: []string{}, Firsts: []string{}, Flags: []string{}}
}

// Item finds an instance in the pack.
func (c *Character) Item(id string) *item.Instance {
	for _, in := range c.Pack {
		if in.ID == id {
			return in
		}
	}
	return nil
}

// In is the instance equipped in a slot, or nil.
func (c *Character) In(slot string, index int) *item.Instance {
	for _, e := range c.Equipped {
		if e.Slot == slot && e.Index == index {
			return c.Item(e.Item)
		}
	}
	return nil
}

// Equip puts a pack item in a slot, replacing what was there and
// moving it out of any other slot it held.
func (c *Character) Equip(slot string, index int, id string) error {
	if c.Item(id) == nil {
		return fmt.Errorf("char: %s has no %s to equip", c.ID, id)
	}
	if index < 0 || index >= SlotCount(slot) {
		return fmt.Errorf("char: the %s has no place %d", slot, index)
	}
	c.equip(slot, index, id)
	return nil
}

// Carry puts a new instance in the pack and equips it.
func (c *Character) Carry(slot string, index int, in *item.Instance) {
	c.Pack = append(c.Pack, in)
	c.equip(slot, index, in.ID)
}

func (c *Character) equip(slot string, index int, id string) {
	c.Equipped = slices.DeleteFunc(c.Equipped, func(e Equipped) bool {
		return (e.Slot == slot && e.Index == index) || e.Item == id
	})
	c.Equipped = append(c.Equipped, Equipped{Slot: slot, Index: index, Item: id})
	slices.SortFunc(c.Equipped, func(a, b Equipped) int {
		return cmp.Or(cmp.Compare(a.Slot, b.Slot), cmp.Compare(a.Index, b.Index))
	})
}

// Worn reports whether an instance is in a slot.
func (c *Character) Worn(id string) bool {
	return slices.ContainsFunc(c.Equipped, func(e Equipped) bool { return e.Item == id })
}

// Drop takes an instance out of the pack and every slot.
func (c *Character) Drop(id string) {
	c.Pack = slices.DeleteFunc(c.Pack, func(in *item.Instance) bool { return in.ID == id })
	c.Equipped = slices.DeleteFunc(c.Equipped, func(e Equipped) bool { return e.Item == id })
}

// Kinds resolves instances to their kinds.
type Kinds interface {
	Kind(id string) (*item.Kind, bool)
}

// HoldsKind: a held-item check by kind, without reading the rest.
func (c *Character) HoldsKind(kind string) bool {
	return slices.ContainsFunc(c.Pack, func(in *item.Instance) bool { return in.Kind == kind })
}

// HoldsTag: does anything carried hold a tag?
func (c *Character) HoldsTag(reg Kinds, t tags.Tag) bool {
	for _, in := range c.Pack {
		if k, ok := reg.Kind(in.Kind); ok && slices.Contains(k.Tags, t) {
			return true
		}
	}
	return false
}

// HoldsItem: a named item, by instance id.
func (c *Character) HoldsItem(id string) bool { return c.Item(id) != nil }

// Has reports a condition in force at a tick.
func (c *Character) Has(t tags.Tag, tick int64) bool {
	return slices.ContainsFunc(c.Conditions, func(x Condition) bool { return x.Tag == t && (x.Ends == 0 || tick < x.Ends) })
}

// Set puts a condition on until a tick (0: until cleared).
func (c *Character) Set(t tags.Tag, ends int64) {
	c.Clear(t)
	c.Conditions = append(c.Conditions, Condition{Tag: t, Ends: ends})
	slices.SortFunc(c.Conditions, func(a, b Condition) int { return cmp.Compare(a.Tag, b.Tag) })
}

func (c *Character) Clear(t tags.Tag) {
	c.Conditions = slices.DeleteFunc(c.Conditions, func(x Condition) bool { return x.Tag == t })
}

// ConditionTags are the conditions in force, as tags rules read.
func (c *Character) ConditionTags(tick int64) []tags.Tag {
	var out []tags.Tag
	for _, x := range c.Conditions {
		if x.Ends == 0 || tick < x.Ends {
			out = append(out, x.Tag)
		}
	}
	return out
}

// Level of a practice skill.
func (c *Character) Level(skill string) int64 {
	for _, s := range c.Practice {
		if s.ID == skill {
			return s.Level
		}
	}
	return 0
}

// PracticeOf is a practice skill with its uses toward the next level.
func (c *Character) PracticeOf(skill string) Skill {
	for _, s := range c.Practice {
		if s.ID == skill {
			return s
		}
	}
	return Skill{ID: skill}
}

// Practise counts successful uses and raises the level when they reach
// the sheet's uses times the next level (GDD 5.3). It returns the levels
// gained.
func (c *Character) Practise(skill string, uses int64, growth []sheets.Param) int64 {
	if uses <= 0 {
		return 0
	}
	i := slices.IndexFunc(c.Practice, func(s Skill) bool { return s.ID == skill })
	if i < 0 {
		c.Practice = append(c.Practice, Skill{ID: skill})
		slices.SortFunc(c.Practice, func(a, b Skill) int { return cmp.Compare(a.ID, b.ID) })
		i = slices.IndexFunc(c.Practice, func(s Skill) bool { return s.ID == skill })
	}
	s := &c.Practice[i]
	top, per := sheets.IntParam(growth, "practice-max"), sheets.IntParam(growth, "practice-uses")
	s.Uses += uses
	var gained int64
	for s.Level < top && s.Uses >= per*(s.Level+1) {
		s.Uses -= per * (s.Level + 1)
		s.Level++
		gained++
	}
	if s.Level >= top {
		s.Uses = 0
	}
	return gained
}

// Load is what the character can carry: the pack, a mount's load, and
// dense items' extra share of the pack.
func (c *Character) Load(reg Kinds, mounts *item.Mounts, traitEffects []sheets.TraitEffect) int64 {
	base := mounts.PackLoad()
	load := base + mounts.Load(c.In(Mount, 0))
	for _, e := range c.Equipped {
		in := c.Item(e.Item)
		if in == nil || in.Mount != "" {
			continue
		}
		k, ok := reg.Kind(in.Kind)
		if !ok {
			continue
		}
		for _, te := range traitEffects {
			if te.Effect == "load" && slices.Contains(k.Tags, tags.Tag(te.Tag)) {
				load += fixed.PercentOf(base, te.Magnitude)
			}
		}
	}
	return load
}

// AdjustStanding moves standing with a faction, within its bounds.
func (c *Character) AdjustStanding(faction string, by, lo, hi int64) {
	now := c.Standing.Get(faction)
	c.Standing.Bump(faction, min(hi, max(lo, now+by))-now)
}

// Remember keeps a heavy fact naming the character, newest last.
func (c *Character) Remember(id fact.ID, l Limits) {
	c.Journey = ring(c.Journey, id, l.Journey)
}

// Walk records a tile entered.
func (c *Character) Walk(h hex.Hex, l Limits) {
	c.At = h
	c.Walked++
	c.Trail = ring(c.Trail, h, l.Trail)
}

// Meet records company kept, newest last, one entry a character.
func (c *Character) Meet(m Met, l Limits) {
	c.Company = slices.DeleteFunc(c.Company, func(x Met) bool { return x.Who == m.Who })
	c.Company = ring(c.Company, m, l.Company)
}

func ring[T any](s []T, x T, n int) []T {
	s = append(s, x)
	if len(s) > n {
		s = slices.Delete(s, 0, len(s)-n)
	}
	return s
}

// LimitsOf reads the ring sizes from the growth sheet.
func LimitsOf(growth []sheets.Param) Limits {
	return Limits{
		Trail:   int(sheets.IntParam(growth, "trail-tiles")),
		Journey: int(sheets.IntParam(growth, "journey-facts")),
		Company: int(sheets.IntParam(growth, "company-size")),
	}
}
