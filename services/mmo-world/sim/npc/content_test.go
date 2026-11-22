package npc_test

import (
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"strconv"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/npc"
	"jams.team/mmo-world/sim/sheets"
)

// nativeCase is one row of testdata/native-366429aa.json: a place's
// residents (Place set) or a tile's wanderer on a day.
type nativeCase struct {
	Place string     `json:"place,omitempty"`
	At    hex.Hex    `json:"at"`
	Day   int64      `json:"day,omitempty"`
	Tags  []string   `json:"tags,omitempty"`
	Stubs []npc.Stub `json:"stubs"`
}

// TestResidentsNative: a zero Draw gives exactly the residents and
// wanderers the rules gave before content came from history, recorded
// at 366429aa under the same throwaway key.
func TestResidentsNative(t *testing.T) {
	r := testRules(t)
	raw, err := os.ReadFile("testdata/native-366429aa.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []nativeCase
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	var residents, wanderers int
	for _, c := range cases {
		got := []npc.Stub{}
		if c.Place != "" {
			got = append(got, r.Residents(c.Place, c.At.Ref(), c.At, npc.Draw{})...)
			residents += len(got)
		} else if s, ok := r.MeetWanderer(c.At, c.Day, c.Tags, npc.Draw{}); ok {
			got = append(got, s)
			wanderers++
		}
		if !reflect.DeepEqual(got, c.Stubs) {
			t.Fatalf("%s at %v day %d: got %+v, want %+v", c.Place, c.At, c.Day, got, c.Stubs)
		}
	}
	if residents == 0 || wanderers == 0 {
		t.Fatalf("the table holds %d residents and %d wanderers", residents, wanderers)
	}
}

func opposedPair(t *testing.T, b *sheets.Book, traits []string) bool {
	t.Helper()
	for _, row := range b.NPCTraits {
		if slices.Contains(traits, row.ID) && slices.Contains(traits, row.Opposes) {
			return true
		}
	}
	return false
}

// TestResidentsDrawnKeyed: a key keeps every id and role but draws new
// names, and traits are always two, distinct and never an opposed pair,
// whatever the weights leave to take.
func TestResidentsDrawnKeyed(t *testing.T) {
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	r := testRules(t)
	traits := r.TraitIDs()
	only := func(ids ...string) []int64 {
		w := make([]int64, len(traits))
		for i, id := range traits {
			if slices.Contains(ids, id) {
				w[i] = 1
			}
		}
		return w
	}
	draws := []npc.Draw{
		{Key: "a"},
		{Key: "b"},
		{Key: "a", Traits: only("bold", "open")},
		{Key: "a", Traits: only("bold", "wary")},
		{Key: "a", Traits: only()},
	}
	var renamed, stubs int
	for q := range int64(40) {
		h := hex.Hex{Q: q, R: -q / 2}
		native := r.Residents("starting-settlement", h.Ref(), h, npc.Draw{})
		for di, d := range draws {
			got := r.Residents("starting-settlement", h.Ref(), h, d)
			if len(got) != len(native) {
				t.Fatalf("%d residents under a key, %d native", len(got), len(native))
			}
			for i, s := range got {
				if s.ID != native[i].ID || s.Role != native[i].Role || s.Home != h || s.Kind != npc.Resident {
					t.Fatalf("a key moved a resident: %+v against %+v", s, native[i])
				}
				if len(s.Traits) != 2 || s.Traits[0] == s.Traits[1] || opposedPair(t, b, s.Traits) {
					t.Fatalf("draw %d gave %s traits %v", di, s.ID, s.Traits)
				}
				switch di {
				case 0:
					stubs++
					if s.Name != native[i].Name {
						renamed++
					}
				case 2:
					if !slices.Contains(s.Traits, "bold") || !slices.Contains(s.Traits, "open") {
						t.Fatalf("weights on bold and open alone gave %v", s.Traits)
					}
				case 3:
					if slices.Contains(s.Traits, "bold") == slices.Contains(s.Traits, "wary") {
						t.Fatalf("weights on an opposed pair gave %v", s.Traits)
					}
				}
			}
			if di == 1 {
				a := r.Residents("starting-settlement", h.Ref(), h, draws[0])
				if reflect.DeepEqual(a, got) {
					t.Fatalf("keys a and b drew the same residents at %v", h)
				}
			}
		}
	}
	if renamed*10 < stubs*9 {
		t.Fatalf("a key renamed %d of %d residents", renamed, stubs)
	}
}

// TestWandererDrawn: a key moves which days a tile is met on and who it
// sends, and the role multipliers steer the road role; multipliers that
// leave nothing fall back to the tags' weights.
func TestWandererDrawn(t *testing.T) {
	r := testRules(t)
	roles := r.RoadRoles()
	if len(roles) < 2 {
		t.Fatalf("road roles %v", roles)
	}
	toward := func(i int) []int64 {
		w := make([]int64, len(roles))
		w[i] = 1
		return w
	}
	h := hex.Hex{Q: 3, R: -7}
	var met, moved int
	for day := range int64(400) {
		native, nok := r.MeetWanderer(h, day, nil, npc.Draw{})
		keyed, kok := r.MeetWanderer(h, day, nil, npc.Draw{Key: "a"})
		if nok != kok || native.Name != keyed.Name {
			moved++
		}
		if !kok {
			continue
		}
		met++
		if keyed.ID != "w-"+h.Ref()+"-"+strconv.FormatInt(day, 10) || keyed.Kind != npc.Wanderer || keyed.Home != h {
			t.Fatalf("a keyed wanderer is %+v", keyed)
		}
		for i, role := range roles {
			s, ok := r.MeetWanderer(h, day, nil, npc.Draw{Key: "a", Roles: toward(i)})
			if !ok || s.Role != role {
				t.Fatalf("multipliers toward %s gave %+v", role, s)
			}
		}
		if _, ok := r.MeetWanderer(h, day, nil, npc.Draw{Key: "a", Roles: make([]int64, len(roles))}); !ok {
			t.Fatal("all-zero multipliers sent nobody")
		}
	}
	if met == 0 || moved == 0 {
		t.Fatalf("met %d keyed wanderers, %d days differed from native", met, moved)
	}
}
