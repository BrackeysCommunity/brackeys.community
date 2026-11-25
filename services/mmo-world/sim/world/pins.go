package world

import (
	"cmp"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"unicode/utf8"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/history"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
)

// Who may pin (GDD 14.1, 14.5).
const (
	PinDesigner = sheets.PinRoleDesigner
	PinAdmin    = "admin"
	PinStaff    = "staff"
)

// Why a world-level command is refused.
const (
	CodePinReach      = "pin-reach"
	CodePinSeen       = "pin-seen"
	CodePinUnseen     = "pin-unseen"
	CodePinGround     = "pin-ground"
	CodePinPath       = "pin-path"
	CodePinFix        = "pin-fix"
	CodePinBudget     = "pin-budget"
	CodePinAnchor     = "pin-anchor"
	CodePinTaken      = "pin-taken"
	CodePinEntered    = "pin-entered"
	CodePinGone       = "pin-gone"
	CodeAlreadyFrozen = "already-frozen"
	CodeContentNative = "content-native"
)

// The pin facts. None reaches a player's read (GDD 14.5).
const (
	factPinReserved  = "pin.reserved"
	factPinEdited    = "pin.edited"
	factPinWithdrawn = "pin.withdrawn"
	factPinLanded    = "pin.landed"
)

// The fields a fix may set, as map.pin-limits names them.
const (
	fieldSite     = "site"
	fieldLandmark = "landmark"
	fieldSiteKind = "site-kind"
	fieldDungeon  = "dungeon"
	fieldFloors   = "floors"
	fieldLead     = "lead"
	fieldStock    = "stock"
)

// Pin is content staged on a tile: a reserve the tile's first reach
// honours, or an edit to a reached tile's stored content (GDD 14.4).
type Pin struct {
	ID        string   `json:"id"` // "pin-<n>"
	At        hex.Hex  `json:"at"`
	Reach     int64    `json:"reach"`
	Fix       tile.Fix `json:"fix"`
	By        PinBy    `json:"by"`
	Tick      int64    `json:"tick"`
	Fact      fact.ID  `json:"fact"`
	Edit      bool     `json:"edit,omitempty"`
	Landed    int64    `json:"landed,omitempty"`
	Withdrawn int64    `json:"withdrawn,omitempty"`
}

// PinBy is who placed a pin.
type PinBy struct {
	Role   string         `json:"role"` // designer, admin, staff
	Server string         `json:"server,omitempty"`
	Char   string         `json:"char,omitempty"`
	Label  string         `json:"label,omitempty"`
	Points int64          `json:"points,omitempty"`
	Region *gen.LatticeID `json:"region,omitempty"` // admin and staff: reach clipped to it
}

// staged reports whether a server, not a designer, placed the pin.
func (b PinBy) staged() bool { return b.Role == PinAdmin || b.Role == PinStaff }

// pinCell is a pin cell's (I, J): cells as wide as the longest reach, so
// a pin covers tiles in its own cell and the eight round it only.
type pinCell struct{ I, J int64 }

// Refusal is a world-level command turned down; nothing changed.
type Refusal struct{ Code, Msg string }

func (r *Refusal) Error() string { return r.Code + ": " + r.Msg }

func refuse(code, format string, args ...any) error {
	return &Refusal{Code: code, Msg: fmt.Sprintf(format, args...)}
}

func (s *State) mp(id string) int64 { return sheets.IntParam(s.b.MapParams, id) }

// pinSize is a pin cell's width: the designer's reach, which bounds every
// role's.
func (s *State) pinSize() int64 {
	if l := s.pinLimit(PinDesigner); l != nil {
		return l.ReachMax
	}
	return 0
}

func (s *State) pinLimit(role string) *sheets.PinLimit {
	return sheets.Lookup(s.b.PinLimits)[role]
}

func (s *State) cellOfPin(h hex.Hex) pinCell {
	n := s.pinSize()
	return pinCell{I: hex.FloorDiv(h.Q, n), J: hex.FloorDiv(h.R, n)}
}

// indexPins rebuilds the pin cells: every pin not withdrawn, by its tile's
// cell, in Pins order. Whatever changes Pins drops the index.
func (s *State) indexPins() {
	if s.pinCells != nil || s.pinSize() <= 0 {
		return
	}
	s.pinCells = map[pinCell][]int{}
	for i, p := range s.Pins {
		if p.Withdrawn == 0 {
			c := s.cellOfPin(p.At)
			s.pinCells[c] = append(s.pinCells[c], i)
		}
	}
}

// near are the indexes of the pins standing in h's pin cell and the
// eight round it.
func (s *State) near(h hex.Hex) []int {
	s.indexPins()
	if len(s.pinCells) == 0 {
		return nil
	}
	c := s.cellOfPin(h)
	var out []int
	for i := c.I - 1; i <= c.I+1; i++ {
		for j := c.J - 1; j <= c.J+1; j++ {
			out = append(out, s.pinCells[pinCell{I: i, J: j}]...)
		}
	}
	return out
}

// expired reports whether a pin has stopped counting by tick t: it was
// withdrawn, or pin-days have passed since it landed or was made as an
// edit. A reserve nobody has reached never expires.
func (s *State) expired(p *Pin, t int64) bool {
	if p.Withdrawn != 0 {
		return true
	}
	start := p.Landed
	if p.Edit {
		start = p.Tick
	}
	if !p.Edit && start == 0 {
		return false
	}
	return t >= start+s.mp("pin-days")*ticksPerDay
}

// counts reports whether a pin counts in a digest read at t, which reads
// only what was written before t.
func (s *State) counts(p *Pin, t int64) bool { return p.Tick < t && !s.expired(p, t) }

// covers reports whether a pin's reach takes in h: within its reach and,
// for a server's pin, inside the region it is clipped to.
func (s *State) covers(p *Pin, h hex.Hex) bool {
	if hex.Distance(p.At, h) > p.Reach {
		return false
	}
	return p.By.Region == nil || s.g.RegionOf(h) == *p.By.Region
}

// PinsAt are the ids of the live pins whose reach covers h at tick t,
// sorted and capped at pins-in-reach-max.
func (s *State) PinsAt(h hex.Hex, t int64) []string {
	var ids []string
	for _, i := range s.near(h) {
		if p := &s.Pins[i]; s.counts(p, t) && s.covers(p, h) {
			ids = append(ids, p.ID)
		}
	}
	slices.Sort(ids)
	if most := int(s.bounds().PinsMost); len(ids) > most {
		ids = ids[:most]
	}
	return ids
}

// ReserveAt is the live reserve on h that has not landed, if any.
func (s *State) ReserveAt(h hex.Hex) *Pin {
	for _, i := range s.near(h) {
		if p := &s.Pins[i]; p.At == h && !p.Edit && p.Landed == 0 && p.Withdrawn == 0 {
			return p
		}
	}
	return nil
}

// LivePins are the pins still counting.
func (s *State) LivePins() []Pin {
	var out []Pin
	for i := range s.Pins {
		if p := &s.Pins[i]; s.counts(p, s.Tick+1) {
			out = append(out, *p)
		}
	}
	return out
}

// prunePins drops the pins that stopped counting, at the day's turn.
func (s *State) prunePins(t int64) {
	n := len(s.Pins)
	s.Pins = slices.DeleteFunc(s.Pins, func(p Pin) bool { return s.expired(&p, t) })
	if len(s.Pins) != n {
		s.pinCells = nil
	}
}

// reached reports whether anyone has reached h: content is stored, or the
// tile was entered on a world from before content was drawn.
func (s *State) reached(h hex.Hex) bool {
	t := s.Tile(h)
	return t != nil && (t.Content != nil || t.Discovered != nil)
}

// slotOf is the slot standing on h: a stored pin's over the scaffold's.
func (s *State) slotOf(h hex.Hex) string {
	if c := s.Content(h); c != nil && c.Site != "" {
		return c.Site
	}
	return s.g.Baseline(h).Site
}

// landmarkOn is the landmark standing on h, a stored pin's over the
// scaffold's.
func (s *State) landmarkOn(h hex.Hex) string {
	if c := s.Content(h); c != nil && c.Landmark != "" {
		return c.Landmark
	}
	return s.g.Baseline(h).Landmark
}

// placeTile reports whether a settlement or a pattern's part stands on h:
// a slot the region's own sites did not put there.
func (s *State) placeTile(h hex.Hex) bool {
	b := s.g.Baseline(h)
	return b.Site != "" && s.g.RegionSites(b.Region)[h] == ""
}

// dungeonPlace reports whether a slot stands a dungeon.
func (s *State) dungeonPlace(site string) bool {
	return site != "" && len(s.g.KindsAt(site)) > 0
}

// fields are the map.pin-limits fields a fix sets. A slot that stands a
// dungeon needs the dungeon field too.
func (s *State) fields(f tile.Fix) []string {
	var out []string
	add := func(set bool, name string) {
		if set {
			out = append(out, name)
		}
	}
	add(f.Site != "", fieldSite)
	add(f.Landmark != "", fieldLandmark)
	add(f.SiteKind != "", fieldSiteKind)
	add(f.Dungeon != "" || s.dungeonPlace(f.Site), fieldDungeon)
	add(f.Floors != 0, fieldFloors)
	add(f.Lead != "", fieldLead)
	add(f.Stock != "", fieldStock)
	add(f.Ground != nil, sheets.FieldGround)
	return out
}

// CheckPin runs the world's pin validators, changing nothing; tests use it
// as a dry run. The game refuses founded ground before it, and a replan of a
// dungeon someone delved or an open goal reaches into.
func (s *State) CheckPin(at hex.Hex, reach int64, fix tile.Fix, by PinBy, edit bool) error {
	if !s.Drawn() {
		return refuse(CodeContentNative, "this world does not draw content from history yet")
	}
	limit := s.pinLimit(by.Role)
	if limit == nil {
		return refuse(CodePinAnchor, "no one pins as %q", by.Role)
	}
	if reach < 1 || reach > limit.ReachMax {
		return refuse(CodePinReach, "reach %d is outside 1 to %d", reach, limit.ReachMax)
	}
	if err := s.checkAnchor(at, by); err != nil {
		return err
	}
	if fix.Ground != nil {
		if err := s.checkTerrain(at, fix, by, edit); err != nil {
			return err
		}
	}
	if edit && s.Content(at) == nil {
		return refuse(CodePinUnseen, "nobody has reached %s", at.Ref())
	}
	if !edit && s.reached(at) {
		return refuse(CodePinSeen, "%s is already reached", at.Ref())
	}
	if s.ReserveAt(at) != nil {
		return refuse(CodePinTaken, "%s already holds a reserve", at.Ref())
	}
	if err := s.checkGround(at, fix); err != nil {
		return err
	}
	if err := s.checkFix(at, fix, limit, edit); err != nil {
		return err
	}
	if edit && fix.Replans() && s.entered(at) {
		return refuse(CodePinEntered, "the dungeon on %s has been entered", at.Ref())
	}
	walk := s.mp("pin-path-tiles")
	if !s.pathOver(at, walk, fix.Ground) {
		return refuse(CodePinPath, "no known ground within %d tiles of %s", walk, at.Ref())
	}
	if err := s.checkBudget(at, fix, by, limit); err != nil {
		return err
	}
	if fix.Ground != nil {
		return s.checkRelay(at, fix.Ground)
	}
	return nil
}

// checkAnchor holds a server's pin to its settlement's region and label.
func (s *State) checkAnchor(at hex.Hex, by PinBy) error {
	if !by.staged() {
		return nil
	}
	switch {
	case by.Server == "" || by.Char == "":
		return refuse(CodePinAnchor, "a %s pin names its server and who placed it", by.Role)
	case by.Region == nil || s.g.RegionOf(at) != *by.Region:
		return refuse(CodePinAnchor, "%s is outside the region of the %s's settlement", at.Ref(), by.Role)
	case by.Label == "" || int64(utf8.RuneCountInString(by.Label)) > s.mp("pin-label-max"):
		return refuse(CodePinAnchor, "a %s pin's label is 1 to %d characters", by.Role, s.mp("pin-label-max"))
	}
	return nil
}

// checkGround refuses tiles a pin may not stand on: impassable ground, a
// settlement or a pattern's part, and a slot or landmark on a tile that
// holds one already.
func (s *State) checkGround(at hex.Hex, fix tile.Fix) error {
	b := s.Baseline(at)
	occupied := s.slotOf(at) != "" || s.landmarkOn(at) != ""
	switch {
	case !s.g.Passable(b.Terrain):
		return refuse(CodePinGround, "%s is impassable", at.Ref())
	case s.placeTile(at):
		return refuse(CodePinGround, "%s holds a settlement or a pattern", at.Ref())
	case (fix.Site != "" || fix.Landmark != "") && occupied:
		return refuse(CodePinGround, "%s holds a slot or a landmark already", at.Ref())
	}
	return nil
}

// checkFix refuses a fix the role may not set, or one the sheets or the
// tile refuse.
func (s *State) checkFix(at hex.Hex, fix tile.Fix, limit *sheets.PinLimit, edit bool) error {
	if fix.Empty() {
		return refuse(CodePinFix, "the fix sets nothing")
	}
	for _, f := range s.fields(fix) {
		if !slices.Contains(limit.Fields, f) {
			return refuse(CodePinFix, "a %s may not set %s", limit.Role, f)
		}
	}
	b := s.pending(at)
	if fix.Ground != nil {
		b = s.g.GroundTile(at, groundOf(fix.Ground))
	}
	site := fix.Site
	if site == "" {
		site = s.slotOf(at)
	}
	switch fix.Site {
	case "", gen.SiteOrdinary:
	case gen.SiteEdge:
		if b.Secondary == "" {
			return refuse(CodePinFix, "%s is not on a biome's fade", at.Ref())
		}
	case gen.PlaceDungeon:
	default:
		return refuse(CodePinFix, "no slot %q", fix.Site)
	}
	if fix.SiteKind != "" {
		k, ok := sheets.Lookup(s.b.SiteKinds)[fix.SiteKind]
		if !ok {
			return refuse(CodePinFix, "no site kind %q", fix.SiteKind)
		}
		if !slices.Contains(k.Places, site) {
			return refuse(CodePinFix, "a %s does not stand on a %q slot", fix.SiteKind, site)
		}
	}
	if fix.Landmark != "" {
		m, ok := sheets.Lookup(s.b.Landmarks)[fix.Landmark]
		if !ok {
			return refuse(CodePinFix, "no landmark %q", fix.Landmark)
		}
		if !slices.Contains(m.Terrains, b.Terrain) {
			return refuse(CodePinFix, "a %s does not stand on %s", fix.Landmark, b.Terrain)
		}
	}
	kind := fix.Dungeon
	if kind != "" {
		if _, ok := sheets.Lookup(s.b.Dungeons)[kind]; !ok {
			return refuse(CodePinFix, "no dungeon kind %q", kind)
		}
		if !slices.ContainsFunc(s.g.KindsAt(site), func(k *sheets.DungeonKind) bool { return k.ID == kind }) {
			return refuse(CodePinFix, "a %s does not stand on a %q slot", kind, site)
		}
	} else if c := s.Content(at); edit && c != nil && c.Dungeon != nil && fix.Site == "" {
		kind = c.Dungeon.Kind
	}
	if fix.Floors != 0 && !s.floorsFit(site, kind, fix.Floors) {
		return refuse(CodePinFix, "%d floors do not fit a dungeon here", fix.Floors)
	}
	if fix.Lead != "" && !slices.Contains(s.g.ArchetypesOf(b.Terrain), fix.Lead) {
		return refuse(CodePinFix, "%s does not live on %s", fix.Lead, at.Ref())
	}
	if fix.Stock != "" {
		if _, ok := sheets.Lookup(s.b.StockBands)[fix.Stock]; !ok {
			return refuse(CodePinFix, "no stock band %q", fix.Stock)
		}
	}
	return nil
}

// floorsFit reports whether a dungeon of kind on the slot may have n
// floors; with no kind fixed, every kind the slot could draw must allow it.
func (s *State) floorsFit(site, kind string, n int64) bool {
	fits := false
	for _, k := range s.g.KindsAt(site) {
		if kind != "" && k.ID != kind {
			continue
		}
		if n < k.FloorsMin || n > k.FloorsMax {
			return false
		}
		fits = true
	}
	return fits
}

// entered reports whether a delve has begun in the dungeon on h: it has a
// record, or a floor has been drawn.
func (s *State) entered(h hex.Hex) bool {
	t := s.Tile(h)
	if t == nil {
		return false
	}
	if t.Dungeon != nil {
		return true
	}
	return t.Content != nil && t.Content.Dungeon != nil && (len(t.Content.Dungeon.Drawn) > 0 || len(t.Content.Dungeon.Ways) > 0)
}

// pathFrom reports whether a walk over passable ground from h, within
// pin-path-tiles, meets a discovered tile or a starting settlement.
func (s *State) pathFrom(h hex.Hex, most int64) bool { return s.pathOver(h, most, nil) }

// pathOver is pathFrom with a terrain pin's patch round h laid, at its
// worst: a patch tile passes only where the ground and the tile both do.
func (s *State) pathOver(h hex.Hex, most int64, f *tile.GroundFix) bool {
	var patch []hex.Hex
	if f != nil {
		patch = PatchOf(h, f)
	}
	step := func(_, n hex.Hex) (int64, bool) {
		ok := s.g.Passable(s.Baseline(n).Terrain)
		if slices.Contains(patch, n) {
			ok = ok && s.g.Passable(f.Terrain)
		}
		return 1, ok
	}
	walked := hex.Reach([]hex.Hex{h}, step, most)
	for _, at := range hex.DiscAt(h, most) {
		if _, ok := walked[at]; !ok {
			continue
		}
		if t := s.Tile(at); t != nil && t.Discovered != nil {
			return true
		}
		if s.g.Baseline(at).Site == gen.PlaceSettlement {
			return true
		}
	}
	return false
}

// checkBudget holds a region to its sites, one dungeon and one landmark,
// a pin cell to its pins, and an issuer to its pins a day.
func (s *State) checkBudget(at hex.Hex, fix tile.Fix, by PinBy, limit *sheets.PinLimit) error {
	id := s.g.RegionOf(at)
	if fix.Site != "" || fix.Landmark != "" {
		scaffold := s.g.RegionSites(id)
		sites := int64(len(scaffold))
		dungeon, landmark := false, false
		for _, h := range s.g.RegionTiles(id) {
			slot, mark := s.slotOf(h), s.landmarkOn(h)
			if c := s.Content(h); c != nil && c.Site != "" && scaffold[h] == "" {
				sites++
			}
			if p := s.ReserveAt(h); p != nil {
				if p.Fix.Site != "" {
					slot = p.Fix.Site
					sites++
				}
				if p.Fix.Landmark != "" {
					mark = p.Fix.Landmark
				}
			}
			dungeon = dungeon || s.dungeonPlace(slot)
			landmark = landmark || mark != ""
		}
		switch {
		case fix.Site != "" && sites+1 > s.mp("sites-max"):
			return refuse(CodePinBudget, "the region holds %d sites already", sites)
		case s.dungeonPlace(fix.Site) && dungeon:
			return refuse(CodePinBudget, "the region holds a dungeon already")
		case fix.Landmark != "" && landmark:
			return refuse(CodePinBudget, "the region holds a landmark already")
		}
	}
	if n := int64(len(s.pinCellAt(at))); n >= s.bounds().PinsPerCell {
		return refuse(CodePinBudget, "the pin cell holds %d pins already", n)
	}
	if limit.PerDay > 0 {
		day := hex.FloorDiv(s.Tick, ticksPerDay)
		var n int64
		for _, p := range s.Pins {
			if p.By.Role == by.Role && p.By.Server == by.Server && hex.FloorDiv(p.Tick, ticksPerDay) == day {
				n++
			}
		}
		if n >= limit.PerDay {
			return refuse(CodePinBudget, "%d %s pins a day, all made", limit.PerDay, by.Role)
		}
	}
	return nil
}

// pinCellAt are the pins standing in h's own cell. A pin stays there,
// and in what a digest reads, until it is withdrawn or pruned.
func (s *State) pinCellAt(h hex.Hex) []int {
	if s.pinSize() <= 0 {
		return nil
	}
	s.indexPins()
	return s.pinCells[s.cellOfPin(h)]
}

// Reserve stages a fix on a tile nobody has reached.
func (s *State) Reserve(log fact.Log, at hex.Hex, reach int64, fix tile.Fix, by PinBy) (*Pin, error) {
	if err := s.CheckPin(at, reach, fix, by, false); err != nil {
		return nil, err
	}
	return s.addPin(log, factPinReserved, Pin{At: at, Reach: reach, Fix: fix, By: by})
}

// EditPin changes a reached tile's stored content, and that tile's only.
func (s *State) EditPin(log fact.Log, at hex.Hex, reach int64, fix tile.Fix, by PinBy) (*Pin, error) {
	if err := s.CheckPin(at, reach, fix, by, true); err != nil {
		return nil, err
	}
	c := cloneContent(s.Content(at))
	if fix.Site != "" {
		d, key := digestOf(c)
		c.SiteKind = s.g.SiteKind(at, fix.Site, d, key)
		c.Dungeon = nil
		if plan, ok := s.g.DrawPlan(at, fix.Site, "", d, key); ok {
			c.Dungeon = storedPlan(&plan)
		}
	}
	p, err := s.addPin(log, factPinEdited, Pin{At: at, Reach: reach, Fix: fix, By: by, Edit: true})
	if err != nil {
		return nil, err
	}
	s.fix(c, at, p)
	s.setContent(at, c)
	return p, nil
}

// addPin numbers a checked pin, writes its fact and keeps it.
func (s *State) addPin(log fact.Log, kind string, p Pin) (*Pin, error) {
	p.ID = "pin-" + strconv.FormatInt(s.NextPin, decimal)
	p.Tick = s.Tick
	if l := s.pinLimit(p.By.Role); l != nil {
		p.By.Points = l.Points
	}
	id, err := s.pinFact(log, s.Tick, kind, "", &p, nil)
	if err != nil {
		return nil, err
	}
	p.Fact = id
	s.NextPin++
	s.Pins = append(s.Pins, p)
	s.pinCells = nil
	return &s.Pins[len(s.Pins)-1], nil
}

// structural: pin ids count in decimal.
const decimal = 10

// Withdraw stops a live pin counting in later digests; a landed reserve
// keeps its tile's content.
func (s *State) Withdraw(log fact.Log, id string) (*Pin, error) {
	i := slices.IndexFunc(s.Pins, func(p Pin) bool { return p.ID == id })
	if i < 0 || s.expired(&s.Pins[i], s.Tick+1) {
		return nil, refuse(CodePinGone, "no live pin %q", id)
	}
	if _, err := s.pinFact(log, s.Tick, factPinWithdrawn, "", &s.Pins[i], nil); err != nil {
		return nil, err
	}
	// Tick 0 is the founding; 0 would read as never withdrawn.
	s.Pins[i].Withdrawn = max(s.Tick, 1)
	s.pinCells = nil
	return &s.Pins[i], nil
}

// applyFix lands a reserve on content being drawn: the fix overrides the
// draw for every field it sets.
func (s *State) applyFix(c *tile.Content, h hex.Hex, p *Pin, t int64, log fact.Log) error {
	if _, err := s.pinFact(log, t, factPinLanded, s.refAt(h), p, fact.At(h)); err != nil {
		return err
	}
	s.fix(c, h, p)
	p.Landed = t
	return nil
}

// fix writes a pin's fix onto content and records who staged it; a slot
// or landmark is stored only where it differs from the scaffold's.
func (s *State) fix(c *tile.Content, h hex.Hex, p *Pin) {
	b, f := s.g.Baseline(h), p.Fix
	if f.Site != "" && f.Site != b.Site {
		c.Site = f.Site
	}
	if f.Landmark != "" && f.Landmark != b.Landmark {
		c.Landmark = f.Landmark
	}
	if f.SiteKind != "" {
		c.SiteKind = f.SiteKind
	}
	if f.Dungeon != "" {
		site := cmp.Or(c.Site, b.Site)
		d, key := digestOf(c)
		if plan, ok := s.g.DrawPlan(h, site, f.Dungeon, d, key); ok {
			c.Dungeon = storedPlan(&plan)
		}
	}
	if f.Floors != 0 && c.Dungeon != nil {
		c.Dungeon.Floors = f.Floors
	}
	if f.Lead != "" {
		c.Lead = f.Lead
	}
	if units, ok := s.g.StockUnits(f.Stock); ok {
		if c.Stock = s.g.UniformStock(h, units); c.Stock == nil {
			c.Stock = map[string]int64{}
		}
	}
	if f.Ground != nil {
		c.Ground = &tile.GroundFix{Terrain: f.Ground.Terrain, Elevation: f.Ground.Elevation}
	}
	c.Pin = p.ID
	if pl := placedOf(p); pl != nil {
		c.Placed = pl
	}
}

// placedOf says who staged a server's pin, or nil for a designer's.
func placedOf(p *Pin) *tile.Placed {
	if !p.By.staged() {
		return nil
	}
	by := tile.PlacedAdmins
	if p.By.Role == PinStaff {
		by = tile.PlacedStaff
	}
	return &tile.Placed{By: by, Server: p.By.Server, Label: p.By.Label, Points: p.By.Points}
}

// pinFact writes a pin's fact; only a landing names a region or a tile. A
// server's pin carries who staged it.
func (s *State) pinFact(log fact.Log, tick int64, kind, region string, p *Pin, at []fact.Datum) (fact.ID, error) {
	if log == nil {
		return 0, nil
	}
	data := append([]fact.Datum{fact.S("pin", p.ID), fact.S("role", p.By.Role)}, at...)
	var causes []fact.ID
	if p.Fact != 0 {
		causes = []fact.ID{p.Fact}
	}
	f, err := s.weights.New(tick, kind, region, nil, causes, data...)
	if err != nil {
		return 0, err
	}
	if p.By.staged() {
		f.StagedBy = &fact.Ref{Kind: "server", ID: p.By.Server}
	}
	return log.Append(f)
}

// digestOf is the digest and key content was drawn under; a native tile's
// are empty.
func digestOf(c *tile.Content) (history.Digest, string) {
	if c.Digest == nil {
		return history.Digest{}, c.Key
	}
	return *c.Digest, c.Key
}

// cloneContent copies content deeply enough that an edit leaves the
// stored one untouched until it is set.
func cloneContent(c *tile.Content) *tile.Content {
	out := *c
	out.Stock = maps.Clone(c.Stock)
	if c.Dungeon != nil {
		d := *c.Dungeon
		d.Ways, d.Drawn = slices.Clone(d.Ways), slices.Clone(d.Drawn)
		out.Dungeon = &d
	}
	if c.Placed != nil {
		pl := *c.Placed
		out.Placed = &pl
	}
	return &out
}
