package emerge

import (
	"encoding/json"
	"maps"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/sheets"
)

// State is everything emergence keeps. Every map keyed by a struct or a
// tile marshals as a slice sorted by key.
type State struct {
	Season int64 `json:"season"` // the stamp: traces read in a later one read 0
	Next   int64 `json:"next"`

	Passage  Spots                    `json:"passage"`
	Clearing Spots                    `json:"clearing"`
	Loss     Spots                    `json:"loss"`
	Pairs    map[PairKey]*Pair        `json:"pairs"`
	RoadLoad map[int]*RoadLoad        `json:"roadLoad"`
	Styles   map[StyleKey]*StyleTrace `json:"styles"`
	Regions  map[int]*RegionTally     `json:"regions"`
	Renown   map[string]*Subject      `json:"renown"` // by ref string
	Masters  map[MastersKey]*Recent   `json:"masters"`
	Expire   []Due                    `json:"expire"`

	Promotions []Promotion           `json:"promotions"`
	Roads      map[hex.Hex]string    `json:"roads"` // tile: road id
	RoadRecs   map[string]*RoadRec   `json:"roadRecs"`
	Camps      map[hex.Hex]*CampRec  `json:"camps"`
	Haunts     map[hex.Hex]*HauntRec `json:"haunts"`
	Routes     []*RouteRec           `json:"routes"`
	Caravans   []*Caravan            `json:"caravans"` // live only
	Variants   []*VariantRec         `json:"variants"`
	Materials  []sheets.Material     `json:"materials"`
	Legends    []*LegendRec          `json:"legends"`
	Lines      map[string]*Line      `json:"lines"` // this season
	Sigs       map[string]*Sig       `json:"sigs"`
	Customs    []*CustomRec          `json:"customs"`
	Contests   []*Contest            `json:"contests"`
	Eased      map[MastersKey]bool   `json:"eased"`

	Staged  []fact.ID        `json:"staged"` // ring, newest last
	Weeks   []Week           `json:"weeks"`
	Seasons []SeasonCount    `json:"seasons"` // newest last
	Now     SeasonCount      `json:"now"`
	Tolled  map[string]int64 `json:"tolled"` // "<char>@<road>": day paid

	stagedSet map[fact.ID]bool // rebuilt on load

	// today's expiry bucket as a set, rebuilt lazily from the bucket
	dueSet map[string]bool
	dueDay int64
	dueOK  bool

	tollDay int64 // the day Tolled was last pruned
	tollOK  bool

	ix promoIndex // rebuilt lazily, never saved
}

// promoIndex indexes Promotions[:n]. Promotions are only appended, so it
// extends from n.
type promoIndex struct {
	n      int
	byOf   map[Type]map[string][]int
	styles map[int][]int
	all    []int // every style promotion
}

// New is an empty state stamped with a season; its first measure week
// starts on day.
func New(day, season int64) *State {
	s := &State{Season: season, Weeks: []Week{{From: day}}}
	s.Now.Season = season
	s.fill()
	return s
}

// fill makes every nil map, so a fresh and a loaded state behave alike.
func (s *State) fill() {
	if s.Passage == nil {
		s.Passage = Spots{}
	}
	if s.Clearing == nil {
		s.Clearing = Spots{}
	}
	if s.Loss == nil {
		s.Loss = Spots{}
	}
	if s.Pairs == nil {
		s.Pairs = map[PairKey]*Pair{}
	}
	if s.RoadLoad == nil {
		s.RoadLoad = map[int]*RoadLoad{}
	}
	if s.Styles == nil {
		s.Styles = map[StyleKey]*StyleTrace{}
	}
	if s.Regions == nil {
		s.Regions = map[int]*RegionTally{}
	}
	if s.Renown == nil {
		s.Renown = map[string]*Subject{}
	}
	if s.Masters == nil {
		s.Masters = map[MastersKey]*Recent{}
	}
	if s.Roads == nil {
		s.Roads = map[hex.Hex]string{}
	}
	if s.RoadRecs == nil {
		s.RoadRecs = map[string]*RoadRec{}
	}
	if s.Camps == nil {
		s.Camps = map[hex.Hex]*CampRec{}
	}
	if s.Haunts == nil {
		s.Haunts = map[hex.Hex]*HauntRec{}
	}
	if s.Lines == nil {
		s.Lines = map[string]*Line{}
	}
	if s.Sigs == nil {
		s.Sigs = map[string]*Sig{}
	}
	if s.Eased == nil {
		s.Eased = map[MastersKey]bool{}
	}
	if s.Tolled == nil {
		s.Tolled = map[string]int64{}
	}
	if s.Now.Promotions == nil {
		s.Now.Promotions = map[Type]int64{}
	}
	for i := range s.Seasons {
		if s.Seasons[i].Promotions == nil {
			s.Seasons[i].Promotions = map[Type]int64{}
		}
	}
	s.stagedSet = make(map[fact.ID]bool, len(s.Staged))
	for _, id := range s.Staged {
		s.stagedSet[id] = true
	}
	s.dueOK = false
	s.tollOK = false
}

type mastersWire struct {
	Key    MastersKey `json:"key"`
	Recent *Recent    `json:"recent"`
}

type roadTile struct {
	Hex hex.Hex `json:"hex"`
	ID  string  `json:"id"`
}

type campWire struct {
	Hex  hex.Hex  `json:"hex"`
	Camp *CampRec `json:"camp"`
}

type hauntWire struct {
	Hex   hex.Hex   `json:"hex"`
	Haunt *HauntRec `json:"haunt"`
}

type easedWire struct {
	Key   MastersKey `json:"key"`
	Eased bool       `json:"eased"`
}

// stateWire is State with its struct- and tile-keyed maps as sorted slices.
type stateWire struct {
	Season int64 `json:"season"`
	Next   int64 `json:"next"`

	Passage  Spots                `json:"passage"`
	Clearing Spots                `json:"clearing"`
	Loss     Spots                `json:"loss"`
	Pairs    []*Pair              `json:"pairs"`
	RoadLoad map[int]*RoadLoad    `json:"roadLoad"`
	Styles   []*StyleTrace        `json:"styles"`
	Regions  map[int]*RegionTally `json:"regions"`
	Renown   map[string]*Subject  `json:"renown"`
	Masters  []mastersWire        `json:"masters"`
	Expire   []Due                `json:"expire"`

	Promotions []Promotion         `json:"promotions"`
	Roads      []roadTile          `json:"roads"`
	RoadRecs   map[string]*RoadRec `json:"roadRecs"`
	Camps      []campWire          `json:"camps"`
	Haunts     []hauntWire         `json:"haunts"`
	Routes     []*RouteRec         `json:"routes"`
	Caravans   []*Caravan          `json:"caravans"`
	Variants   []*VariantRec       `json:"variants"`
	Materials  []sheets.Material   `json:"materials"`
	Legends    []*LegendRec        `json:"legends"`
	Lines      map[string]*Line    `json:"lines"`
	Sigs       map[string]*Sig     `json:"sigs"`
	Customs    []*CustomRec        `json:"customs"`
	Contests   []*Contest          `json:"contests"`
	Eased      []easedWire         `json:"eased"`

	Staged  []fact.ID        `json:"staged"`
	Weeks   []Week           `json:"weeks"`
	Seasons []SeasonCount    `json:"seasons"`
	Now     SeasonCount      `json:"now"`
	Tolled  map[string]int64 `json:"tolled"`
}

func orEmpty[K comparable, V any](m map[K]V) map[K]V {
	if m == nil {
		return map[K]V{}
	}
	return m
}

func (s State) MarshalJSON() ([]byte, error) {
	w := stateWire{
		Season: s.Season, Next: s.Next,
		Passage: orEmpty(s.Passage), Clearing: orEmpty(s.Clearing), Loss: orEmpty(s.Loss),
		RoadLoad: orEmpty(s.RoadLoad), Regions: orEmpty(s.Regions), Renown: orEmpty(s.Renown),
		Expire: s.Expire, Promotions: s.Promotions, RoadRecs: orEmpty(s.RoadRecs),
		Routes: s.Routes, Caravans: s.Caravans, Variants: s.Variants, Materials: s.Materials,
		Legends: s.Legends, Lines: orEmpty(s.Lines), Sigs: orEmpty(s.Sigs), Customs: s.Customs,
		Contests: s.Contests, Staged: s.Staged, Weeks: s.Weeks, Seasons: s.Seasons, Now: s.Now,
		Tolled: orEmpty(s.Tolled),
	}
	w.Now.Promotions = orEmpty(w.Now.Promotions)

	w.Pairs = make([]*Pair, 0, len(s.Pairs))
	for _, k := range slices.SortedFunc(maps.Keys(s.Pairs), cmpPair) {
		if p := s.Pairs[k]; p != nil {
			c := *p
			c.Key = k
			w.Pairs = append(w.Pairs, &c)
		}
	}
	w.Styles = make([]*StyleTrace, 0, len(s.Styles))
	for _, k := range slices.SortedFunc(maps.Keys(s.Styles), cmpStyle) {
		if st := s.Styles[k]; st != nil {
			c := *st
			c.Key = k
			w.Styles = append(w.Styles, &c)
		}
	}
	w.Masters = make([]mastersWire, 0, len(s.Masters))
	for _, k := range slices.SortedFunc(maps.Keys(s.Masters), cmpMasters) {
		if r := s.Masters[k]; r != nil {
			w.Masters = append(w.Masters, mastersWire{Key: k, Recent: r})
		}
	}
	w.Roads = make([]roadTile, 0, len(s.Roads))
	for _, h := range SortedHexes(s.Roads) {
		w.Roads = append(w.Roads, roadTile{Hex: h, ID: s.Roads[h]})
	}
	w.Camps = make([]campWire, 0, len(s.Camps))
	for _, h := range SortedHexes(s.Camps) {
		if c := s.Camps[h]; c != nil {
			w.Camps = append(w.Camps, campWire{Hex: h, Camp: c})
		}
	}
	w.Haunts = make([]hauntWire, 0, len(s.Haunts))
	for _, h := range SortedHexes(s.Haunts) {
		if r := s.Haunts[h]; r != nil {
			w.Haunts = append(w.Haunts, hauntWire{Hex: h, Haunt: r})
		}
	}
	w.Eased = make([]easedWire, 0, len(s.Eased))
	for _, k := range slices.SortedFunc(maps.Keys(s.Eased), cmpMasters) {
		w.Eased = append(w.Eased, easedWire{Key: k, Eased: s.Eased[k]})
	}
	return json.Marshal(w)
}

func (s *State) UnmarshalJSON(b []byte) error {
	var w stateWire
	if err := json.Unmarshal(b, &w); err != nil {
		return err
	}
	*s = State{
		Season: w.Season, Next: w.Next,
		Passage: w.Passage, Clearing: w.Clearing, Loss: w.Loss,
		RoadLoad: w.RoadLoad, Regions: w.Regions, Renown: w.Renown,
		Expire: w.Expire, Promotions: w.Promotions, RoadRecs: w.RoadRecs,
		Routes: w.Routes, Caravans: w.Caravans, Variants: w.Variants, Materials: w.Materials,
		Legends: w.Legends, Lines: w.Lines, Sigs: w.Sigs, Customs: w.Customs,
		Contests: w.Contests, Staged: w.Staged, Weeks: w.Weeks, Seasons: w.Seasons, Now: w.Now,
		Tolled:  w.Tolled,
		Pairs:   make(map[PairKey]*Pair, len(w.Pairs)),
		Styles:  make(map[StyleKey]*StyleTrace, len(w.Styles)),
		Masters: make(map[MastersKey]*Recent, len(w.Masters)),
		Roads:   make(map[hex.Hex]string, len(w.Roads)),
		Camps:   make(map[hex.Hex]*CampRec, len(w.Camps)),
		Haunts:  make(map[hex.Hex]*HauntRec, len(w.Haunts)),
		Eased:   make(map[MastersKey]bool, len(w.Eased)),
	}
	for _, p := range w.Pairs {
		if p != nil {
			s.Pairs[p.Key] = p
		}
	}
	for _, st := range w.Styles {
		if st != nil {
			s.Styles[st.Key] = st
		}
	}
	for _, m := range w.Masters {
		if m.Recent != nil {
			s.Masters[m.Key] = m.Recent
		}
	}
	for _, r := range w.Roads {
		s.Roads[r.Hex] = r.ID
	}
	for _, c := range w.Camps {
		if c.Camp != nil {
			s.Camps[c.Hex] = c.Camp
		}
	}
	for _, h := range w.Haunts {
		if h.Haunt != nil {
			s.Haunts[h.Hex] = h.Haunt
		}
	}
	for _, e := range w.Eased {
		s.Eased[e.Key] = e.Eased
	}
	s.fill()
	return nil
}

func idNum(id string) (int64, bool) {
	_, n, ok := strings.Cut(id, ":")
	if !ok {
		return 0, false
	}
	v, err := strconv.ParseInt(n, decimal, intBits)
	return v, err == nil
}

// structural: ids are written in decimal int64.
const (
	decimal = 10
	intBits = 64
)

// Promotion finds a promotion by id. Ids number in the order promotions
// are appended, so the search is by that number.
func (s *State) Promotion(id string) *Promotion {
	n, ok := idNum(id)
	if ok {
		i, found := slices.BinarySearchFunc(s.Promotions, n, func(p Promotion, n int64) int {
			m, _ := idNum(p.ID)
			return int(clamp(m - n))
		})
		if found && s.Promotions[i].ID == id {
			return &s.Promotions[i]
		}
	}
	for i := range s.Promotions {
		if s.Promotions[i].ID == id {
			return &s.Promotions[i]
		}
	}
	return nil
}

func clamp(d int64) int64 {
	switch {
	case d < 0:
		return -1
	case d > 0:
		return 1
	}
	return 0
}

// NewID numbers the next promotion of a type, "<type>:<n>".
func (s *State) NewID(t Type) string {
	s.Next++
	return string(t) + ":" + strconv.FormatInt(s.Next, decimal)
}

// Touch lists a trace key in the day's expiry bucket, once a day.
func (s *State) Touch(day int64, k DueKey) {
	n := len(s.Expire)
	switch {
	case n == 0 || s.Expire[n-1].Day < day:
		s.Expire = append(s.Expire, Due{Day: day})
		s.dueSet, s.dueDay, s.dueOK = map[string]bool{}, day, true
	case s.Expire[n-1].Day > day:
		s.touchPast(day, k)
		return
	case !s.dueOK || s.dueDay != day:
		s.dueSet = make(map[string]bool, len(s.Expire[n-1].Keys))
		for _, x := range s.Expire[n-1].Keys {
			s.dueSet[x.id()] = true
		}
		s.dueDay, s.dueOK = day, true
	}
	id := k.id()
	if s.dueSet[id] {
		return
	}
	s.dueSet[id] = true
	last := &s.Expire[len(s.Expire)-1]
	last.Keys = append(last.Keys, k)
}

// touchPast lists a key in an earlier day's bucket, which only a caller
// writing out of day order reaches.
func (s *State) touchPast(day int64, k DueKey) {
	i, found := slices.BinarySearchFunc(s.Expire, day, func(d Due, day int64) int { return int(clamp(d.Day - day)) })
	if !found {
		s.Expire = slices.Insert(s.Expire, i, Due{Day: day})
	}
	id := k.id()
	if slices.ContainsFunc(s.Expire[i].Keys, func(x DueKey) bool { return x.id() == id }) {
		return
	}
	s.Expire[i].Keys = append(s.Expire[i].Keys, k)
}

// Expired removes and returns the keys of every bucket from keep days ago
// or earlier: on a daily call, exactly that day's bucket.
func (s *State) Expired(day, keep int64) []DueKey {
	cut := day - keep
	n := 0
	for n < len(s.Expire) && s.Expire[n].Day <= cut {
		n++
	}
	if n == 0 {
		return nil
	}
	var out []DueKey
	for _, d := range s.Expire[:n] {
		out = append(out, d.Keys...)
	}
	s.Expire = slices.Delete(s.Expire, 0, n)
	if len(s.Expire) == 0 {
		s.dueOK = false
	}
	return out
}

// MarkStaged keeps a staged fact id in the ring, the kept newest.
func (s *State) MarkStaged(id fact.ID, kept int64) {
	if s.stagedSet == nil {
		s.fill()
	}
	if s.stagedSet[id] {
		return
	}
	s.Staged = append(s.Staged, id)
	s.stagedSet[id] = true
	if kept > 0 && int64(len(s.Staged)) > kept {
		drop := len(s.Staged) - int(kept)
		for _, old := range s.Staged[:drop] {
			delete(s.stagedSet, old)
		}
		s.Staged = slices.Delete(s.Staged, 0, drop)
	}
}

// IsStaged reports whether a recent fact was staged.
func (s *State) IsStaged(id fact.ID) bool {
	if s.stagedSet == nil {
		s.fill()
	}
	return s.stagedSet[id]
}

// structural: a toll key joins a character and a road.
const tollSep = "@"

// PayToll records a character's toll on a road for a day and reports
// whether one was owed, at most once a day a road. Entries older than
// yesterday are dropped on the first write of a day.
func (s *State) PayToll(char, road string, day int64) bool {
	if s.Tolled == nil {
		s.Tolled = map[string]int64{}
	}
	k := char + tollSep + road
	if d, ok := s.Tolled[k]; ok && d == day {
		return false
	}
	if !s.tollOK || s.tollDay != day {
		for _, old := range slices.Sorted(maps.Keys(s.Tolled)) {
			if s.Tolled[old] < day-1 {
				delete(s.Tolled, old)
			}
		}
		s.tollDay, s.tollOK = day, true
	}
	s.Tolled[k] = day
	return true
}

func (s *State) index() {
	if s.ix.byOf == nil || s.ix.n > len(s.Promotions) {
		s.ix = promoIndex{byOf: map[Type]map[string][]int{}, styles: map[int][]int{}}
	}
	for i := s.ix.n; i < len(s.Promotions); i++ {
		p := &s.Promotions[i]
		m := s.ix.byOf[p.Type]
		if m == nil {
			m = map[string][]int{}
			s.ix.byOf[p.Type] = m
		}
		m[p.Of] = append(m[p.Of], i)
		if p.Type == Style {
			s.ix.styles[p.Region] = append(s.ix.styles[p.Region], i)
			s.ix.all = append(s.ix.all, i)
		}
	}
	s.ix.n = len(s.Promotions)
}

func (s *State) promos(is []int) []*Promotion {
	out := make([]*Promotion, len(is))
	for k, i := range is {
		out[k] = &s.Promotions[i]
	}
	return out
}

// ByOf are the promotions of a type made of one thing, in promotion order.
func (s *State) ByOf(t Type, of string) []*Promotion {
	s.index()
	return s.promos(s.ix.byOf[t][of])
}

// StylesIn are the style promotions in a region, in promotion order; a
// region below 0 is every region.
func (s *State) StylesIn(region int) []*Promotion {
	s.index()
	if region < 0 {
		return s.promos(s.ix.all)
	}
	return s.promos(s.ix.styles[region])
}
