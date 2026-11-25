// Package ledger is the double-entry record of every movement of coin and
// goods (GDD 10.1). A transaction's legs sum to zero per asset, so nothing
// is made or lost except through a source or a sink account, and each
// transaction carries the idempotency key of what caused it.
package ledger

import (
	"cmp"
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
	FromHunt     = Source + "hunt"    // a hunt's spoils, rolled once at the kill
	FromCache    = Source + "cache"   // a solved pattern's or a won side's goods; never coin
	FromCaravan  = Source + "caravan" // a caravan's manifest; never coin
	ToProvisions = Sink + "provisions"
	ToLost       = Sink + "lost"
	ToOperator   = Sink + "operator"
	ToFaction    = Sink + "faction"
	ToFees       = Sink + "fees"
	ToMarket     = Sink + "market"
	ToCraft      = Sink + "craft"
	ToUpkeep     = Sink + "upkeep"
	ToGoalFees   = Sink + "goal-fees"
	ToBuild      = Sink + "build"     // charters, structures and their repairs
	ToWorks      = Sink + "works"     // what guild works consume
	ToTolls      = Sink + "tolls"     // coin paid to cross a tolled road
	ToSyndicate  = Sink + "syndicate" // what fences bought, emptied at each world day
	FromStaged   = Source + "staged"  // a server's staging; mints only staged assets and items
	ToStaged     = Sink + "staged"    // staged goods destroyed by forget-me or an operator
)

// Material, Item and Char name a material asset, an item asset and a
// character's account.
func Material(id string) string { return matPrefix + id }
func Item(id string) string     { return itemPrefix + id }
func Char(id string) string     { return Holder + id }

// TilePool is the spoils pool of a tile, by its ref; NPCPool an NPC's purse.
func TilePool(ref string) string { return Pool + "tile:" + ref }
func NPCPool(id string) string   { return Pool + npcPrefix + id }

// FloorPool holds what fell on a dungeon's floor, by the entrance's ref
// and the floor; HuntPool a hunt's rolled spoils until they are split.
func FloorPool(ref string, floor int64) string {
	return Pool + "floor:" + ref + "/" + strconv.FormatInt(floor, decimal)
}
func HuntPool(id string) string { return Pool + "hunt:" + id }

// CachePool holds a cache's goods, by the board or side that opened it,
// until they are split among its contributors.
func CachePool(id string) string { return Pool + "cache:" + id }

// CaravanPool holds a caravan's goods on the road, by its id. The audit
// holds it to what the state says the caravan carries.
func CaravanPool(id string) string { return Pool + caravanPrefix + id }

// StorePool holds the materials a faction bought and keeps, by its
// index: what a burglary takes from. It holds no coin.
func StorePool(faction int) string { return Pool + storePrefix + strconv.Itoa(faction) }

// IsStore reports whether an account is a faction's store.
func IsStore(acc string) bool { return strings.HasPrefix(acc, Pool+storePrefix) }

// StoreOf is the faction whose store an account is, or false.
func StoreOf(acc string) (int, bool) {
	rest, ok := strings.CutPrefix(acc, Pool+storePrefix)
	if !ok {
		return 0, false
	}
	n, err := strconv.Atoi(rest)
	return n, err == nil
}

// IsCaravan reports whether an account is a caravan's pool.
func IsCaravan(acc string) bool { return strings.HasPrefix(acc, Pool+caravanPrefix) }

// FloorOf reads a floor pool back: the entrance's ref and the floor.
func FloorOf(acc string) (string, int64, bool) {
	rest, ok := strings.CutPrefix(acc, Pool+"floor:")
	if !ok {
		return "", 0, false
	}
	i := strings.LastIndex(rest, "/")
	if i < 0 {
		return "", 0, false
	}
	n, err := strconv.ParseInt(rest[i+1:], decimal, floorBits)
	if err != nil {
		return "", 0, false
	}
	return rest[:i], n, true
}

// GuildPool is a guild's treasury and bank; TreasuryPool the treasury of
// an open settlement, by its index.
func GuildPool(id string) string { return Pool + "guild:" + id }
func TreasuryPool(n int) string  { return Pool + "treasury:" + strconv.Itoa(n) }

// NPCOf is the NPC whose pool an account is, or false.
func NPCOf(acc string) (string, bool) { return strings.CutPrefix(acc, Pool+npcPrefix) }

// EscrowPool is the pool an order, listing or gear order holds its escrow in.
func EscrowPool(id string) string { return Pool + escrowPrefix + id }

// PouchPool holds what a locked pouch contains until it is opened
// (GDD 7.11).
func PouchPool(id string) string { return Pool + "pouch:" + id }

// WaitPool is the goods on a tile, by its ref, that wait for one character
// to come for them.
func WaitPool(ref, char string) string { return Pool + "wait:" + ref + ":" + char }

// IsEscrow reports whether an account is an escrow pool.
func IsEscrow(acc string) bool { return strings.HasPrefix(acc, Pool+escrowPrefix) }

// CharOf is the character whose account acc is, or false.
func CharOf(acc string) (string, bool) { return strings.CutPrefix(acc, Holder) }

// structural: the prefixes of an NPC's pool account and an escrow pool;
// a floor is written in decimal and read back as an int64.
const (
	npcPrefix     = "npc:"
	escrowPrefix  = "escrow:"
	caravanPrefix = "caravan:"
	storePrefix   = "store:"
	stgPrefix     = "stg:"
	decimal       = 10
	floorBits     = 64
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

// Staged is the asset a material staged at settlement n trades as: never
// the material's own, so no path that names mat: can move it (GDD 14.5).
func Staged(n int, material string) string {
	return stgPrefix + strconv.Itoa(n) + ":" + material
}

// StagedOf reads a staged asset back.
func StagedOf(asset string) (n int, material string, ok bool) {
	rest, ok := strings.CutPrefix(asset, stgPrefix)
	if !ok {
		return 0, "", false
	}
	at, m, ok := strings.Cut(rest, ":")
	if !ok || m == "" {
		return 0, "", false
	}
	n, err := strconv.Atoi(at)
	if err != nil || n < 0 {
		return 0, "", false
	}
	return n, m, true
}

// IsStaged reports whether an asset is staged goods.
func IsStaged(asset string) bool { return strings.HasPrefix(asset, stgPrefix) }

// StagedRest reports whether an account may hold staged goods by kind
// alone: a character, a tile, wait or floor pool (they pay out only to
// characters), sink:staged, sink:craft, sink:lost or sink:operator. Hunt
// pools and escrows the game decides.
func StagedRest(acc string) bool {
	switch acc {
	case ToStaged, ToCraft, ToLost, ToOperator:
		return true
	}
	return strings.HasPrefix(acc, Holder) || strings.HasPrefix(acc, Pool+"tile:") ||
		strings.HasPrefix(acc, Pool+"wait:") || strings.HasPrefix(acc, Pool+"floor:")
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
// to a store.
type Book struct {
	Balances []Balance `json:"balances"` // sorted by account then asset; no zeros
	Posted   int64     `json:"posted"`
	pending  []Txn
}

// pair is an account and an asset.
type pair struct{ account, asset string }

func cmpBalance(b Balance, k pair) int {
	return cmp.Or(strings.Compare(b.Account, k.account), strings.Compare(b.Asset, k.asset))
}

// Of is an account's balance of one asset.
func (b *Book) Of(account, asset string) int64 {
	i, ok := slices.BinarySearchFunc(b.Balances, pair{account, asset}, cmpBalance)
	if !ok {
		return 0
	}
	return b.Balances[i].Units
}

// Held is every asset an account holds, by asset.
func (b *Book) Held(account string) []Balance {
	i, _ := slices.BinarySearchFunc(b.Balances, pair{account, ""}, cmpBalance)
	j := i
	for j < len(b.Balances) && b.Balances[j].Account == account {
		j++
	}
	return slices.Clone(b.Balances[i:j])
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
	for _, l := range t.Legs {
		_, goods := GoodsOf(l.Asset)
		switch {
		case goods:
		case l.Account == FromCache:
			return fmt.Errorf("ledger %s: a cache gives goods, not %s", t.Key, l.Asset)
		case l.Account == FromCaravan:
			return fmt.Errorf("ledger %s: a caravan carries goods, not %s", t.Key, l.Asset)
		}
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

func (b *Book) add(account, asset string, units int64) {
	i, ok := slices.BinarySearchFunc(b.Balances, pair{account, asset}, cmpBalance)
	if !ok {
		b.Balances = slices.Insert(b.Balances, i, Balance{Account: account, Asset: asset})
	}
	b.Balances[i].Units += units
	if b.Balances[i].Units == 0 {
		b.Balances = slices.Delete(b.Balances, i, i+1)
	}
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
// over all accounts, and every holder's and caravan's balances are
// exactly what the state says it holds. It returns each discrepancy found.
func Audit(ledger, held []Balance) []string {
	var out []string
	sums := Rebuild(nil, 0)
	for _, x := range ledger {
		sums.add("", x.Asset, x.Units)
	}
	for _, x := range sums.Balances {
		out = append(out, fmt.Sprintf("%s sums to %d over all accounts", x.Asset, x.Units))
	}
	want := Rebuild(held, 0)
	got := Rebuild(nil, 0)
	for _, x := range ledger {
		if strings.HasPrefix(x.Account, Holder) || IsCaravan(x.Account) {
			got.add(x.Account, x.Asset, x.Units)
		}
	}
	for _, x := range got.Balances {
		if w := want.Of(x.Account, x.Asset); w != x.Units {
			out = append(out, fmt.Sprintf("%s: ledger %d %s, state %d", x.Account, x.Units, x.Asset, w))
		}
	}
	for _, x := range want.Balances {
		if got.Of(x.Account, x.Asset) == 0 {
			out = append(out, fmt.Sprintf("%s: ledger 0 %s, state %d", x.Account, x.Asset, x.Units))
		}
	}
	return out
}
