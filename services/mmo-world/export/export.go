// Package export writes a world's recorded play as pseudonymised JSON
// lines for the tuning pass (GDD 18.4): the beats pressed, the machines
// worked, each character's day, its milestones and each world day. It
// names characters, servers and the world only by pseudonyms under a key
// made for one export and never written, and leaves out every Discord id,
// interaction id, ledger key, typed text, coordinate, place, token, key,
// the seed and every raw draw.
package export

import (
	"cmp"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"time"

	"jams.team/mmo-world/sim/econ"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/store"
)

// Source is the recorded play an export reads; the store implements it.
// Ranges are of ticks, [from, upto).
type Source interface {
	Meta(ctx context.Context) (store.Meta, error)
	ActionsBetween(ctx context.Context, from, upto int64) ([]store.Action, error)
	FactsBetween(ctx context.Context, from, upto int64) ([]fact.Fact, error)
	SnapshotsBetween(ctx context.Context, from, upto int64) ([]store.Snapshot, error)
}

// Schema is the version of the files' shape.
const Schema = 1

// The files an export writes.
const (
	FileManifest   = "manifest.json"
	FileBeats      = "beats.jsonl"
	FilePuzzles    = "puzzles.jsonl"
	FileDays       = "days.jsonl"
	FileMilestones = "milestones.jsonl"
	FileWorld      = "world.jsonl"
)

// Files are the record files, in the order they are written.
var Files = []string{FileBeats, FilePuzzles, FileDays, FileMilestones, FileWorld}

// Manifest says what an export holds. Book is the sheets digest the world
// runs on, and the goods values are read at; ToTick is the end of the last
// world day written.
type Manifest struct {
	Schema    int              `json:"schema"`
	World     string           `json:"world"`
	Book      string           `json:"book"`
	RollEpoch int32            `json:"rollEpoch"`
	Seasons   []int64          `json:"seasons"`
	FromTick  int64            `json:"fromTick"`
	ToTick    int64            `json:"toTick"`
	Made      string           `json:"made"`
	Records   map[string]int64 `json:"records"`
}

// Pseudonym prefixes, by what they name.
const (
	PrefixCharacter = "c-"
	PrefixServer    = "s-"
	PrefixWorld     = "w-"
)

// structural: an HMAC key's bytes, and the hex digits a pseudonym keeps.
const (
	keyBytes   = 32
	nameDigits = 16
)

// namer gives pseudonyms under one export's key.
type namer struct {
	key  []byte
	memo map[string]string
}

func (n *namer) name(prefix, id string) string {
	if id == "" {
		return ""
	}
	k := prefix + id
	if s, ok := n.memo[k]; ok {
		return s
	}
	mac := hmac.New(sha256.New, n.key)
	mac.Write([]byte(prefix))
	mac.Write([]byte{0})
	mac.Write([]byte(id))
	s := prefix + hex.EncodeToString(mac.Sum(nil))[:nameDigits]
	n.memo[k] = s
	return s
}

// Write exports the world days that start in [from, to) and have closed,
// to out; to < 0 runs to the last closed day. book must be the sheets the
// world runs on: goods are valued and item xp counted by it.
func Write(ctx context.Context, src Source, book *sheets.Book, out string, from, to int64) (Manifest, error) {
	m, err := src.Meta(ctx)
	if err != nil {
		return Manifest{}, err
	}
	digest, err := book.Digest()
	if err != nil {
		return Manifest{}, err
	}
	if digest != m.SheetsDigest {
		return Manifest{}, fmt.Errorf("export: the world runs on sheets %s, these are %s", m.SheetsDigest, digest)
	}
	if from < 0 || to >= 0 && to <= from {
		return Manifest{}, errors.New("export: an empty range")
	}
	key := make([]byte, keyBytes)
	if _, err := rand.Read(key); err != nil {
		return Manifest{}, err
	}
	defer clear(key)
	x := &run{ctx: ctx, src: src, nm: &namer{key: key, memo: map[string]string{}}, values: econ.New(book), curve: map[int64]int64{},
		pending: map[pickKey][]pick{}, used: map[fact.ID]bool{}, firsts: map[string]bool{}, firstTheft: map[string]int64{}}
	for _, s := range book.LevelCurve {
		x.curve[s.Level] = s.XPSoFar
	}
	x.activeDays = x.values.Param("active-days")
	tpd := int64(sheets.TicksPerDay)
	first := from / tpd
	for d := range first {
		if err := x.early(d); err != nil {
			return Manifest{}, err
		}
	}
	man := Manifest{Schema: Schema, World: x.nm.name(PrefixWorld, m.ID), Book: m.SheetsDigest, RollEpoch: m.RulesEpoch, Seasons: []int64{},
		FromTick: first * tpd, ToTick: first * tpd, Records: map[string]int64{}}
	for d := first; to < 0 || (d+1)*tpd <= to; d++ {
		ok, err := x.day(d, m.ID)
		if err != nil {
			return Manifest{}, err
		}
		if !ok {
			break
		}
		man.ToTick = (d + 1) * tpd
		if x.season >= 0 && !slices.Contains(man.Seasons, x.season) {
			man.Seasons = append(man.Seasons, x.season)
		}
	}
	if err := os.MkdirAll(out, 0o750); err != nil {
		return Manifest{}, err
	}
	for _, f := range Files {
		recs := x.recs[f]
		slices.SortStableFunc(recs, func(a, b record) int {
			return cmp.Or(cmp.Compare(a.day, b.day), cmp.Compare(a.who, b.who), cmp.Compare(a.tick, b.tick))
		})
		if err := writeLines(filepath.Join(out, f), recs); err != nil {
			return Manifest{}, err
		}
		man.Records[f] = int64(len(recs))
	}
	man.Made = time.Now().UTC().Format(time.RFC3339)
	b, err := json.MarshalIndent(man, "", "  ")
	if err != nil {
		return Manifest{}, err
	}
	return man, os.WriteFile(filepath.Join(out, FileManifest), append(b, '\n'), 0o640)
}

// record is one line, with what it sorts by.
type record struct {
	day, tick int64
	who       string
	v         any
}

func writeLines(path string, recs []record) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(f)
	enc.SetEscapeHTML(false)
	for _, r := range recs {
		if err := enc.Encode(r.v); err != nil {
			_ = f.Close()
			return err
		}
	}
	return f.Close()
}

// pickKey is one beat of one encounter.
type pickKey struct {
	encounter string
	beat      int64
}

// pick is a party member's held pick, waiting for its beat to resolve.
type pick struct {
	char   string
	option string
	seen   *BeatSeen
}

// run is one export in progress.
type run struct {
	ctx        context.Context
	src        Source
	nm         *namer
	values     *econ.Values
	curve      map[int64]int64 // level → xp to reach it
	activeDays int64
	recs       map[string][]record
	// pending are party picks waiting on their beat; used the beat facts
	// already matched to a press.
	pending map[pickKey][]pick
	used    map[fact.ID]bool
	// firsts are the milestones each character has reached, and
	// firstTheft the tick of its first theft.
	firsts     map[string]bool
	firstTheft map[string]int64
	season     int64
}

func (x *run) add(file string, day, tick int64, who string, v any) {
	if x.recs == nil {
		x.recs = map[string][]record{}
	}
	x.recs[file] = append(x.recs[file], record{day: day, tick: tick, who: who, v: v})
}
