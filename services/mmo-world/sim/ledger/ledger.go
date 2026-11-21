// Package ledger is the double-entry record of every movement of coin and
// goods (GDD 10.1). A transaction's legs sum to zero per asset, so nothing
// is made or lost except through a source or a sink account, and each
// transaction carries the idempotency key of what caused it.
package ledger

import (
	"cmp"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"

	"jams.team/mmo-world/sim/fact"
)

// Account kinds, by prefix. A holder or a pool never goes below zero; a
// source only gives and a sink only takes. A pool holds what lies in the
// world rather than with a character: a tile's spoils, an NPC's purse.
const (
	Holder = "char:"
	Pool   = "pool:"
	Source = "src:"
	Sink   = "sink:"
)

// Assets: coin, provisions, a material by id, or one item instance.
const (
	Coin       = "coin"
	Provisions = "provisions"
	matPrefix  = "mat:"
	itemPrefix = "item:"
)

// Sources and sinks the rules use.
const (
	FromGather   = Source + "gather"
	FromHaul     = Source + "haul"
	FromSalvage  = Source + "salvage"
	FromFaction  = Source + "faction"
	FromOperator = Source + "operator"
	FromMarket   = Source + "market"
	FromCraft    = Source + "craft"
	FromForage   = Source + "forage"
	FromStart    = Source + "start"
	ToProvisions = Sink + "provisions"
	ToLost       = Sink + "lost"
	ToOperator   = Sink + "operator"
	ToFaction    = Sink + "faction"
	ToFees       = Sink + "fees"
	ToMarket     = Sink + "market"
	ToCraft      = Sink + "craft"
	ToUpkeep     = Sink + "upkeep"
	ToGoalFees   = Sink + "goal-fees"
	ToBuild      = Sink + "build" // charters, structures and their repairs
	ToWorks      = Sink + "works" // what guild works consume
)

// Material, Item and Char name a material asset, an item asset and a
// character's account.
func Material(id string) string { return matPrefix + id }
func Item(id string) string     { return itemPrefix + id }
func Char(id string) string     { return Holder + id }

// TilePool is the spoils pool of a tile, by its ref; NPCPool an NPC's purse.
func TilePool(ref string) string { return Pool + "tile:" + ref }
func NPCPool(id string) string   { return Pool + npcPrefix + id }

// GuildPool is a guild's treasury and bank; TreasuryPool the treasury of
// an open settlement, by its index.
func GuildPool(id string) string { return Pool + "guild:" + id }
func TreasuryPool(n int) string  { return Pool + "treasury:" + strconv.Itoa(n) }

// NPCOf is the NPC whose pool an account is, or false.
func NPCOf(acc string) (string, bool) { return strings.CutPrefix(acc, Pool+npcPrefix) }

// EscrowPool is the pool an order, listing or gear order holds its escrow in.
func EscrowPool(id string) string { return Pool + escrowPrefix + id }

// WaitPool is the goods on a tile, by its ref, that wait for one character
// to come for them.
func WaitPool(ref, char string) string { return Pool + "wait:" + ref + ":" + char }

// IsEscrow reports whether an account is an escrow pool.
func IsEscrow(acc string) bool { return strings.HasPrefix(acc, Pool+escrowPrefix) }

// CharOf is the character whose account acc is, or false.
func CharOf(acc string) (string, bool) { return strings.CutPrefix(acc, Holder) }

// structural: the prefixes of an NPC's pool account and an escrow pool.
const (
	npcPrefix    = "npc:"
	escrowPrefix = "escrow:"
)

// Goods is the asset a material trades as; provisions are their own.
func Goods(material string) string {
	if material == Provisions {
		return Provisions
	}
	return Material(material)
}

// GoodsOf reads goods back: a material, or provisions.
func GoodsOf(asset string) (string, bool) {
	if asset == Provisions {
		return Provisions, true
	}
	return MaterialOf(asset)
}

// MaterialOf reads a material asset back.
func MaterialOf(asset string) (string, bool) { return strings.CutPrefix(asset, matPrefix) }

// ItemOf reads an item asset back.
func ItemOf(asset string) (string, bool) { return strings.CutPrefix(asset, itemPrefix) }

// Leg is one account's side of a transaction; a Txn's legs sum to zero
// per asset.
type Leg struct {
	Account string `json:"account"`
	Asset   string `json:"asset"`
	Units   int64  `json:"units"`
}

// Txn is one balanced movement. Key is unique per world.
type Txn struct {
	Key  string  `json:"key"`
	Tick int64   `json:"tick"`
	Kind string  `json:"kind"`
	Fact fact.ID `json:"fact,omitempty"`
	Legs []Leg   `json:"legs"`
}

// SubKey is the key of one of several transactions a single interaction
// or tick causes. Interaction ids carry no '/', so a derived key never
// equals another interaction's own.
func SubKey(key string, parts ...string) string {
	return strings.Join(append([]string{key}, parts...), "/")
}

// Move is the two-leg transaction that moves units of an asset.
func Move(key, kind string, tick int64, from, to, asset string, units int64) Txn {
	return Txn{Key: key, Kind: kind, Tick: tick, Legs: Pair(from, to, asset, units)}
}

// Pair is the two legs that move units of an asset from one account to
// another.
func Pair(from, to, asset string, units int64) []Leg {
	return []Leg{{from, asset, -units}, {to, asset, units}}
}

// Merge sums legs on the same account and asset, dropping any that come
// to nothing, so a transaction that takes and gives back one asset posts
// it once.
func Merge(legs []Leg) []Leg {
	var out []Leg
	for _, l := range legs {
		i := slices.IndexFunc(out, func(o Leg) bool { return o.Account == l.Account && o.Asset == l.Asset })
		if i < 0 {
			out = append(out, l)
			continue
		}
		out[i].Units += l.Units
	}
	return slices.DeleteFunc(out, func(l Leg) bool { return l.Units == 0 })
}

// Balance is what an account holds of one asset.
type Balance struct {
	Account string `json:"account"`
	Asset   string `json:"asset"`
	Units   int64  `json:"units"`
}

// Book holds every account's balance and the transactions not yet handed
// to a store. Balances are grouped by account so that one appearing or
// reaching zero moves only its own account's few; Balances lays them out
// as one sorted list when something reads them all.
type Book struct {
	Posted  int64
	pending []Txn
	accts   map[string]*account
	order   []*account // every account that holds anything, in no order
	used    bool       // a balance has existed: Balances is then empty, not nil
}

// account is one account's balances, sorted by asset, with no zeros, and
// where it sits in Book.order.
type account struct {
	name string
	held []Balance
	at   int
}

// pair is an account and an asset.
type pair struct{ account, asset string }

func cmpBalance(b Balance, k pair) int {
	return cmp.Or(strings.Compare(b.Account, k.account), strings.Compare(b.Asset, k.asset))
}

func cmpAsset(b Balance, asset string) int { return strings.Compare(b.Asset, asset) }

// Of is an account's balance of one asset.
func (b *Book) Of(account, asset string) int64 {
	a := b.accts[account]
	if a == nil {
		return 0
	}
	i, ok := slices.BinarySearchFunc(a.held, asset, cmpAsset)
	if !ok {
		return 0
	}
	return a.held[i].Units
}

// Held is every asset an account holds, by asset.
func (b *Book) Held(account string) []Balance {
	if a := b.accts[account]; a != nil {
		return slices.Clone(a.held)
	}
	if !b.used {
		return nil
	}
	return []Balance{}
}

// Balances is every balance, sorted by account then asset, with no zeros:
// the shape a digest, a snapshot and the audit read. It is nil until a
// balance has existed, as a fresh book's always was.
func (b *Book) Balances() []Balance {
	if !b.used {
		return nil
	}
	accts := slices.Clone(b.order)
	slices.SortFunc(accts, func(x, y *account) int { return strings.Compare(x.name, y.name) })
	n := 0
	for _, a := range accts {
		n += len(a.held)
	}
	out := make([]Balance, 0, n)
	for _, a := range accts {
		out = append(out, a.held...)
	}
	return out
}

// shape is how a book is encoded, as JSON and for a digest.
type shape struct {
	Balances []Balance `json:"balances"`
	Posted   int64     `json:"posted"`
}

// Canonical is the book as canon digests it.
func (b Book) Canonical() any { return shape{Balances: b.Balances(), Posted: b.Posted} }

func (b Book) MarshalJSON() ([]byte, error) { return json.Marshal(b.Canonical()) }

func (b *Book) UnmarshalJSON(data []byte) error {
	var s shape
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	*b = Rebuild(s.Balances, s.Posted)
	b.used = s.Balances != nil
	return nil
}

// Check reports why a transaction cannot post against the balances.
func (b *Book) Check(t Txn) error {
	if t.Key == "" || len(t.Legs) == 0 {
		return fmt.Errorf("ledger: %s has no key or no legs", t.Kind)
	}
	sums := map[string]int64{}
	moved := map[pair]int64{}
	for _, l := range t.Legs {
		if l.Units == 0 {
			return fmt.Errorf("ledger %s: a leg of zero %s", t.Key, l.Asset)
		}
		sums[l.Asset] += l.Units
		moved[pair{l.Account, l.Asset}] += l.Units
	}
	for _, l := range t.Legs {
		if sums[l.Asset] != 0 {
			return fmt.Errorf("ledger %s: %s does not balance", t.Key, l.Asset)
		}
		after := b.Of(l.Account, l.Asset) + moved[pair{l.Account, l.Asset}]
		switch {
		case strings.HasPrefix(l.Account, Holder), strings.HasPrefix(l.Account, Pool):
			if after < 0 {
				return fmt.Errorf("ledger %s: %s would hold %d %s", t.Key, l.Account, after, l.Asset)
			}
		case strings.HasPrefix(l.Account, Source):
			if l.Units > 0 {
				return fmt.Errorf("ledger %s: source %s cannot take", t.Key, l.Account)
			}
		case strings.HasPrefix(l.Account, Sink):
			if l.Units < 0 {
				return fmt.Errorf("ledger %s: sink %s cannot give", t.Key, l.Account)
			}
		default:
			return fmt.Errorf("ledger %s: unknown account %s", t.Key, l.Account)
		}
	}
	if !coinSourced(t) {
		return fmt.Errorf("ledger %s: coin enters only through faction buys or an operator's correction", t.Key)
	}
	return nil
}

// coinSourced holds unless coin leaves a source other than the faction
// buys or an operator's recorded correction (GDD 10.1 rule 2).
func coinSourced(t Txn) bool {
	for _, l := range t.Legs {
		if l.Asset == Coin && l.Units < 0 && strings.HasPrefix(l.Account, Source) && l.Account != FromFaction && l.Account != FromOperator {
			return false
		}
	}
	return true
}

// Post checks and applies a transaction.
func (b *Book) Post(t Txn) error {
	if err := b.Check(t); err != nil {
		return err
	}
	for _, l := range t.Legs {
		b.add(l.Account, l.Asset, l.Units)
	}
	b.Posted++
	b.pending = append(b.pending, t)
	return nil
}

func (b *Book) add(acc, asset string, units int64) {
	a := b.accts[acc]
	if a == nil {
		if units == 0 {
			b.used = true
			return
		}
		if b.accts == nil {
			b.accts = map[string]*account{}
		}
		a = &account{name: acc, at: len(b.order)}
		b.accts[acc] = a
		b.order = append(b.order, a)
	}
	b.used = true
	i, ok := slices.BinarySearchFunc(a.held, asset, cmpAsset)
	if !ok {
		a.held = slices.Insert(a.held, i, Balance{Account: acc, Asset: asset})
	}
	a.held[i].Units += units
	if a.held[i].Units != 0 {
		return
	}
	a.held = slices.Delete(a.held, i, i+1)
	if len(a.held) > 0 {
		return
	}
	last := b.order[len(b.order)-1]
	b.order[a.at], last.at = last, a.at
	b.order = b.order[:len(b.order)-1]
	delete(b.accts, acc)
}

// Flush hands over the transactions posted since the last flush.
func (b *Book) Flush() []Txn {
	out := b.pending
	b.pending = nil
	return out
}

// Rebuild is a book from balances read back from a store.
func Rebuild(bal []Balance, posted int64) Book {
	out := Book{Posted: posted}
	for _, x := range bal {
		out.add(x.Account, x.Asset, x.Units)
	}
	return out
}

// Audit is the conservation check (GDD 10.9): every asset sums to zero
// over all accounts, and every holder's balances are exactly what the
// state says it holds. It returns each discrepancy found.
func Audit(ledger, held []Balance) []string {
	var out []string
	all := make([]Balance, len(ledger))
	for i, x := range ledger {
		all[i] = Balance{Asset: x.Asset, Units: x.Units}
	}
	for _, x := range summed(all) {
		out = append(out, fmt.Sprintf("%s sums to %d over all accounts", x.Asset, x.Units))
	}
	want := summed(slices.Clone(held))
	got := summed(slices.DeleteFunc(slices.Clone(ledger), func(x Balance) bool { return !strings.HasPrefix(x.Account, Holder) }))
	for _, x := range got {
		if w := unitsIn(want, x); w != x.Units {
			out = append(out, fmt.Sprintf("%s: ledger %d %s, state %d", x.Account, x.Units, x.Asset, w))
		}
	}
	for _, x := range want {
		if unitsIn(got, x) == 0 {
			out = append(out, fmt.Sprintf("%s: ledger 0 %s, state %d", x.Account, x.Asset, x.Units))
		}
	}
	return out
}

// summed sorts balances by account then asset in place and sums those on
// the same pair, dropping any that come to nothing.
func summed(bal []Balance) []Balance {
	slices.SortFunc(bal, func(x, y Balance) int { return cmpBalance(x, pair{y.Account, y.Asset}) })
	out := bal[:0]
	for _, x := range bal {
		if n := len(out); n > 0 && out[n-1].Account == x.Account && out[n-1].Asset == x.Asset {
			out[n-1].Units += x.Units
			continue
		}
		if n := len(out); n > 0 && out[n-1].Units == 0 {
			out[n-1] = x
			continue
		}
		out = append(out, x)
	}
	if n := len(out); n > 0 && out[n-1].Units == 0 {
		out = out[:n-1]
	}
	return out
}

// unitsIn is a pair's units in a summed list.
func unitsIn(bal []Balance, x Balance) int64 {
	i, ok := slices.BinarySearchFunc(bal, pair{x.Account, x.Asset}, cmpBalance)
	if !ok {
		return 0
	}
	return bal[i].Units
}
