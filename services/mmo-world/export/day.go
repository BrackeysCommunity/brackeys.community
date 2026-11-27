package export

import (
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/game"
	"jams.team/mmo-world/sim/item"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/season"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

// structural: the item levels the tuning pass reads (GDD 18.3's first tool
// at level 5 and tier-2 items at level 20), the template of a thief's
// invitation, and the fact kinds the milestones and beats are read from.
var itemLevels = []struct {
	level int64
	kind  string
}{{5, MilestoneItem5}, {20, MilestoneItem20}}

const (
	inviteTemplate = "the-invitation"
	kindCharacter  = "character"
	factBeatWon    = "beat.won"
	factBeatLost   = "beat.lost"
	factPartyBeat  = "party.beat"
)

// snapGame is the part of a stored game an export reads.
type snapGame struct {
	Chars     []*game.Char `json:"chars"`
	Kinds     game.Kinds   `json:"kinds"`
	Emergence *struct {
		Materials []sheets.Material `json:"materials"`
	} `json:"emergence"`
	Story *struct {
		Clock *season.Clock `json:"clock"`
	} `json:"story"`
}

// reply is the part of a stored reply an export reads.
type reply struct {
	Pressed []api.Pressed     `json:"pressed"`
	Machine *api.PuzzleResult `json:"machine"`
	Points  int64             `json:"points"`
	Facts   []api.Fact        `json:"facts"`
	Seen    *Seen             `json:"seen"`
}

// dayState is the world at a day's close, for naming and valuing.
type dayState struct {
	day   int64
	close int64
	g     snapGame
	chars map[string]*game.Char
	items map[string]string // item id → kind, over every carried item
}

func (s *dayState) server(char string) string {
	if c := s.chars[char]; c != nil {
		return c.Server
	}
	return ""
}

// early reads a day before the range for what the range's milestones
// count from.
func (x *run) early(d int64) error {
	tpd := int64(sheets.TicksPerDay)
	fs, err := x.src.FactsBetween(x.ctx, d*tpd, (d+1)*tpd)
	if err != nil {
		return err
	}
	x.milestones(fs, nil)
	return nil
}

// day exports world day d; false when the day has not closed.
func (x *run) day(d int64, world string) (bool, error) {
	tpd := int64(sheets.TicksPerDay)
	close := (d + 1) * tpd
	snaps, err := x.src.SnapshotsBetween(x.ctx, close, close+1)
	if err != nil || len(snaps) == 0 {
		return false, err
	}
	st := &dayState{day: d, close: close, chars: map[string]*game.Char{}, items: map[string]string{}}
	if err := json.Unmarshal(snaps[0].Body, &st.g); err != nil {
		return false, fmt.Errorf("export: the snapshot at tick %d: %w", close, err)
	}
	for _, c := range st.g.Chars {
		st.chars[c.C.ID] = c
		for _, in := range c.C.Pack {
			st.items[in.ID] = in.Kind
		}
	}
	x.values.Found = &item.Found{}
	if st.g.Emergence != nil {
		for _, m := range st.g.Emergence.Materials {
			x.values.Found.Add(m)
		}
	}
	fs, err := x.src.FactsBetween(x.ctx, d*tpd, close)
	if err != nil {
		return false, err
	}
	acts, err := x.src.ActionsBetween(x.ctx, d*tpd, close)
	if err != nil {
		return false, err
	}
	x.milestones(fs, st)
	beatFacts := map[int64][]fact.Fact{}
	for _, f := range fs {
		if f.Kind == factBeatWon || f.Kind == factBeatLost {
			beatFacts[f.Tick] = append(beatFacts[f.Tick], f)
		}
	}
	w := WorldDay{Day: d, World: x.nm.name(PrefixWorld, world), Staged: map[string]int64{}}
	perChar := map[string]map[string]int64{}
	perMinute := map[int64]int64{}
	for _, a := range acts {
		w.Actions++
		perMinute[a.At.Truncate(time.Minute).Unix()]++
		if a.Character != "" {
			if perChar[a.Character] == nil {
				perChar[a.Character] = map[string]int64{}
			}
			perChar[a.Character][a.Kind]++
		}
		var r reply
		if err := json.Unmarshal(a.Reply, &r); err != nil {
			return false, fmt.Errorf("export: the reply to action %d: %w", a.Seq, err)
		}
		if r.Points > 0 {
			server := a.Cmd.Server
			if server == "" {
				server = st.server(a.Character)
			}
			w.Staged[x.nm.name(PrefixServer, server)] += r.Points
		}
		x.beats(st, a, r, beatFacts[a.AfterTick])
		x.puzzle(st, a, r)
	}
	for _, n := range perMinute {
		w.PeakPerMinute = max(w.PeakPerMinute, n)
	}
	var coin int64
	for _, c := range st.g.Chars {
		dy := x.charDay(st, c, perChar[c.C.ID])
		w.Characters++
		if dy.Acted {
			w.Acted++
		}
		if dy.Active {
			w.Active++
			coin += dy.Coin
		}
		x.add(FileDays, d, 0, dy.Character, dy)
	}
	if w.Active > 0 {
		w.CoinPerActive = coin / w.Active
	}
	x.season = -1
	if st.g.Story != nil && st.g.Story.Clock != nil {
		n, sd := st.g.Story.Clock.N, st.g.Story.Clock.Day(d)
		w.Season, w.SeasonDay, x.season = &n, &sd, n
	}
	x.add(FileWorld, d, 0, w.World, w)
	return true, nil
}

// charDay is a character at the day's close.
func (x *run) charDay(st *dayState, c *game.Char, acts map[string]int64) Day {
	cc := c.C
	dy := Day{Day: st.day, Character: x.nm.name(PrefixCharacter, cc.ID), Server: x.nm.name(PrefixServer, c.Server), Acted: len(acts) > 0,
		Active: game.ActiveAt(c, st.close, x.activeDays), Actions: map[string]int64{}, Coin: cc.Coin,
		Classes: slices.Sorted(slices.Values(cc.Classes.Active))}
	for k, n := range acts {
		dy.Actions[k] = n
	}
	dy.GoodsValue = cc.Provisions * x.values.Asset(ledger.Provisions)
	for _, s := range cc.Goods {
		dy.GoodsValue += s.Qty * x.values.Material(s.Material)
	}
	for _, in := range cc.Pack {
		if in.Staged != nil {
			continue
		}
		dy.GoodsValue += game.ItemWorth(x.values, &st.g.Kinds, in)
		if in.Mount == "" {
			dy.XP += x.curve[in.Level] + in.XP
			dy.BestItemLevel = max(dy.BestItemLevel, in.Level)
		}
	}
	if dy.Classes == nil {
		dy.Classes = []string{}
	}
	return dy
}

func subjectChar(f fact.Fact) string {
	for _, s := range f.Subjects {
		if s.Kind == kindCharacter {
			return s.ID
		}
	}
	return ""
}

func num(f fact.Fact, key string) int64 {
	d, _ := f.Get(key)
	return d.N
}

func str(f fact.Fact, key string) string {
	d, _ := f.Get(key)
	return d.S
}

// milestones reads the milestones in a day's facts; st is nil for a day
// before the range, which only counts what later ones are measured from.
func (x *run) milestones(fs []fact.Fact, st *dayState) {
	for _, f := range fs {
		who := subjectChar(f)
		switch f.Kind {
		case "theft.made":
			if _, ok := x.firstTheft[who]; !ok && who != "" {
				x.firstTheft[who] = f.Tick
			}
		case "item.levelled":
			for _, l := range itemLevels {
				if num(f, "from") < l.level && num(f, "to") >= l.level {
					m := x.milestone(st, f, who, l.kind)
					if m != nil && st != nil {
						m.Tier = x.tierOf(st, str(f, "item"))
					}
				}
			}
		case "class.unlocked":
			if m := x.milestone(st, f, who, MilestoneClass); m != nil {
				m.Class, m.WorldFirst = str(f, "class"), str(f, "first") != ""
			}
		case "guild.founded":
			x.milestone(st, f, who, MilestoneGuild)
		case "city.raised":
			x.milestone(st, f, "", MilestoneCity)
		case "thread.cast":
			if str(f, "template") != inviteTemplate || num(f, "stage") != 0 {
				continue
			}
			if m := x.milestone(st, f, who, MilestoneInvited); m != nil {
				if t, ok := x.firstTheft[who]; ok {
					days := f.Tick/sheets.TicksPerDay - t/sheets.TicksPerDay
					m.DaysSinceTheft = &days
				}
			}
		}
	}
}

// milestone notes a milestone and, inside the range, records it. The
// record is returned to be filled in; nil outside the range.
func (x *run) milestone(st *dayState, f fact.Fact, who, kind string) *Milestone {
	key := kind + "/" + who
	first := !x.firsts[key]
	x.firsts[key] = true
	if st == nil {
		return nil
	}
	m := &Milestone{Day: st.day, Tick: f.Tick, Character: x.nm.name(PrefixCharacter, who), Server: x.nm.name(PrefixServer, st.server(who)),
		Kind: kind, First: first}
	if c := st.chars[who]; c != nil {
		since := f.Tick - c.Born
		m.TicksSinceBorn = &since
	}
	x.add(FileMilestones, st.day, f.Tick, m.Character, m)
	return m
}

// tierOf is the tier of a carried item's kind, 0 when it is no longer
// carried or its kind is unknown.
func (x *run) tierOf(st *dayState, id string) int64 {
	if k, ok := st.g.Kinds.Kind(st.items[id]); ok {
		return k.Tier
	}
	return 0
}

// beats records the presses an action resolved. A party's beat resolves
// on its last pick: each member's press comes from its beat fact, with
// the options its own pick saw.
func (x *run) beats(st *dayState, a store.Action, r reply, facts []fact.Fact) {
	var seen *BeatSeen
	if r.Seen != nil {
		seen = r.Seen.Beat
	}
	if len(r.Pressed) == 0 {
		if seen != nil && seen.Party > 1 {
			k := pickKey{seen.Encounter, seen.Beat}
			x.pending[k] = append(x.pending[k], pick{char: a.Character, option: a.Cmd.Option, seen: seen})
		}
		return
	}
	shared := len(r.Pressed) > 1 || a.Kind == game.PartyWindow || seen != nil && seen.Party > 1
	enc, beat := "", int64(0)
	if seen != nil {
		enc, beat = seen.Encounter, seen.Beat
	}
	for _, f := range r.Facts {
		if f.Kind == factPartyBeat {
			shared = true
			if enc == "" {
				enc, beat = apiStr(f, "encounter"), apiNum(f, "beat")
			}
		}
	}
	if !shared {
		p := r.Pressed[0]
		b := x.beat(st, a, a.Character, seen, p.Option, p.Band, p.Success, 1)
		b.Ended = ended(r.Facts)
		return
	}
	k := pickKey{enc, beat}
	held := x.pending[k]
	delete(x.pending, k)
	if seen != nil {
		held = append(held, pick{char: a.Character, option: a.Cmd.Option, seen: seen})
	}
	pressed := slices.Clone(r.Pressed)
	matched := false
	for _, f := range facts {
		if x.used[f.ID] || str(f, "encounter") != enc || num(f, "beat") != beat {
			continue
		}
		x.used[f.ID] = true
		who, option, success := subjectChar(f), str(f, "option"), f.Kind == factBeatWon
		var bs *BeatSeen
		if i := slices.IndexFunc(held, func(p pick) bool { return p.char == who }); i >= 0 {
			bs = held[i].seen
		}
		band := ""
		if i := slices.IndexFunc(pressed, func(p api.Pressed) bool { return p.Option == option && p.Success == success }); i >= 0 {
			band = pressed[i].Band
			pressed = slices.Delete(pressed, i, i+1)
		}
		if bs != nil {
			if i := slices.IndexFunc(bs.Offered, func(o OptionSeen) bool { return o.ID == option }); i >= 0 {
				band = bs.Offered[i].Band
			}
		}
		x.beat(st, a, who, bs, option, band, success, int64(len(r.Pressed)))
		matched = true
	}
	if i := slices.IndexFunc(r.Pressed, func(p api.Pressed) bool { return p.Option == a.Cmd.Option }); !matched && seen != nil && i >= 0 {
		p := r.Pressed[i]
		x.beat(st, a, a.Character, seen, p.Option, p.Band, p.Success, int64(len(r.Pressed)))
	}
}

// beat records one member's press.
func (x *run) beat(st *dayState, a store.Action, who string, seen *BeatSeen, option, band string, success bool, party int64) *Beat {
	b := &Beat{Day: st.day, Tick: a.AfterTick, Character: x.nm.name(PrefixCharacter, who), Server: x.nm.name(PrefixServer, st.server(who)),
		What: "fight", Party: party, Pick: option, Band: band, Success: success}
	if a.Kind == game.HuntPress {
		b.What = "hunt"
	}
	if seen != nil {
		b.What, b.Beat, b.Beats, b.Kind, b.Tier, b.Party, b.Floor, b.Ambush, b.Offered =
			seen.What, seen.Beat, seen.Beats, seen.Kind, seen.Tier, max(party, seen.Party), seen.Floor, seen.Ambush, seen.Offered
	}
	x.add(FileBeats, st.day, a.AfterTick, b.Character, b)
	return b
}

// ended is how the press ended its encounter, if it did.
func ended(fs []api.Fact) string {
	for _, f := range fs {
		switch f.Kind {
		case "encounter.won":
			return "won"
		case "encounter.lost":
			return "lost"
		}
	}
	return ""
}

func apiStr(f api.Fact, key string) string {
	for _, d := range f.Data {
		if d.Key == key {
			return d.S
		}
	}
	return ""
}

func apiNum(f api.Fact, key string) int64 {
	for _, d := range f.Data {
		if d.Key == key {
			return d.N
		}
	}
	return 0
}

// puzzle records a machine solve.
func (x *run) puzzle(st *dayState, a store.Action, r reply) {
	if r.Machine == nil || a.Kind != game.MachineSolve && a.Kind != game.BenchSolve {
		return
	}
	p := &Puzzle{Day: st.day, Tick: a.AfterTick, Character: x.nm.name(PrefixCharacter, a.Character), Server: x.nm.name(PrefixServer, st.server(a.Character)),
		Party: 1, Ms: r.Machine.At, Solved: r.Machine.Solved, Clean: r.Machine.Clean, Late: r.Machine.Late, Master: r.Machine.Master,
		Haywire: r.Machine.Haywire}
	if m := a.Cmd.Machine; m != nil {
		p.Source, p.Family, p.Level = m.Source, m.Family, m.Level
		if m.Log != nil {
			p.Moves = int64(len(m.Log.Moves))
		}
	}
	if a.Kind == game.BenchSolve {
		p.Source = game.SourceBench
	}
	for _, f := range r.Facts {
		switch f.Kind {
		case "puzzle.solved", "puzzle.haywire", "bench.solved", "machine.lost-race":
			if fam := apiStr(f, "family"); fam != "" && p.Family == "" {
				p.Family, p.Level = fam, apiNum(f, "level")
			}
		}
	}
	if r.Seen != nil && r.Seen.Machine != nil {
		m := r.Seen.Machine
		ticks := a.AfterTick - m.Tick
		p.Source, p.Family, p.Level, p.Party = m.Source, m.Family, m.Level, m.Party
		p.Practice, p.Tier, p.Countdown, p.Ticks = &m.Practice, &m.Tier, &m.Countdown, &ticks
	}
	x.add(FilePuzzles, st.day, a.AfterTick, p.Character, p)
}
