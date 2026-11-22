package gen_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"jams.team/mmo-world/sim/canon"
	"jams.team/mmo-world/sim/gen"
	"jams.team/mmo-world/sim/sheets"
)

// scaffoldFile was recorded before content came from history, so the
// scaffold and the native function are held to what they were then.
const scaffoldFile = "testdata/scaffold-366429aa.json"

// scaffoldKeys are the throwaway generation keys the record covers.
const scaffoldKeys = 20

// scaffoldTiers are the live tiers a native floor is read at.
const scaffoldTiers = 4

// The centre chunk and its six neighbours.
var scaffoldChunks = []gen.ChunkCoord{{A: 0, B: 0}, {A: 1, B: 0}, {A: -1, B: 0}, {A: 0, B: 1}, {A: 0, B: -1}, {A: 1, B: -1}, {A: -1, B: 1}}

// scaffoldRecord is one key's digests: each chunk, each region those
// chunks touch, each chunk's creature tables, and each dungeon in them
// with every floor by every way at every tier.
type scaffoldRecord struct {
	Label     string            `json:"label"`
	Chunks    map[string]string `json:"chunks"`
	Regions   map[string]string `json:"regions"`
	Creatures map[string]string `json:"creatures"`
	Dungeons  map[string]string `json:"dungeons"`
}

func scaffoldDigest(t *testing.T, v any) string {
	t.Helper()
	d, err := canon.Digest(v)
	if err != nil {
		t.Fatal(err)
	}
	return d.String()
}

func scaffoldOf(t *testing.T, b *sheets.Book, label string) scaffoldRecord {
	t.Helper()
	g := newGen(t, b, label)
	r := scaffoldRecord{Label: label, Chunks: map[string]string{}, Regions: map[string]string{}, Creatures: map[string]string{}, Dungeons: map[string]string{}}
	var regions []gen.LatticeID
	seen := map[gen.LatticeID]bool{}
	for _, cc := range scaffoldChunks {
		c := g.Chunk(cc)
		at := fmt.Sprintf("%d,%d", cc.A, cc.B)
		r.Chunks[at] = scaffoldDigest(t, c)
		var creatures [][]string
		for _, tb := range c.Tiles {
			creatures = append(creatures, g.Creatures(tb.Hex))
			if !seen[tb.Region] {
				seen[tb.Region] = true
				regions = append(regions, tb.Region)
			}
			p, ok := g.Dungeon(tb.Hex)
			if !ok {
				continue
			}
			all := []any{p}
			for n := int64(1); n <= p.Floors; n++ {
				for way := int64(-1); way < gen.WayHidden+1; way++ {
					all = append(all, g.Floor(tb.Hex, n, way))
					for tier := int64(1); tier <= scaffoldTiers; tier++ {
						all = append(all, g.FloorAt(tb.Hex, n, way, tier))
					}
				}
			}
			r.Dungeons[fmt.Sprintf("%d,%d", tb.Hex.Q, tb.Hex.R)] = scaffoldDigest(t, all)
		}
		r.Creatures[at] = scaffoldDigest(t, creatures)
	}
	for _, id := range regions {
		r.Regions[fmt.Sprintf("%d,%d", id.I, id.J)] = scaffoldDigest(t, g.Region(id))
	}
	return r
}

// The scaffold is a pure function of the seed and the tile, and the native
// content beside it reads as it always has: chunks, regions, creature
// tables and native dungeons match the digests recorded before content
// came from history.
func TestScaffoldUnchanged(t *testing.T) {
	raw, err := os.ReadFile(filepath.FromSlash(scaffoldFile))
	if err != nil {
		t.Fatal(err)
	}
	var want []scaffoldRecord
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	if len(want) != scaffoldKeys {
		t.Fatalf("%s holds %d keys, want %d", scaffoldFile, len(want), scaffoldKeys)
	}
	b := book(t)
	dungeons := 0
	for i, w := range want {
		if label := fmt.Sprint("scaffold-", i); w.Label != label {
			t.Fatalf("record %d is %q, want %q", i, w.Label, label)
		}
		got := scaffoldOf(t, b, w.Label)
		for _, part := range []struct {
			name      string
			got, want map[string]string
		}{
			{"chunk", got.Chunks, w.Chunks},
			{"region", got.Regions, w.Regions},
			{"creature table", got.Creatures, w.Creatures},
			{"dungeon", got.Dungeons, w.Dungeons},
		} {
			if len(part.got) != len(part.want) {
				t.Fatalf("%s: %d %ss, recorded %d", w.Label, len(part.got), part.name, len(part.want))
			}
			for at, d := range part.want {
				if part.got[at] != d {
					t.Fatalf("%s: %s %s differs from the record", w.Label, part.name, at)
				}
			}
		}
		dungeons += len(w.Dungeons)
	}
	if dungeons == 0 {
		t.Fatal("the record holds no dungeon")
	}
}
