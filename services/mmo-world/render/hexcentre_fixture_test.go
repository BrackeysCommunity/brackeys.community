package render

import (
	"encoding/json"
	"flag"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	simhex "jams.team/mmo-world/sim/hex"
)

var updateHex = flag.Bool("update-hex", false, "rewrite packages/mmo-map/test/fixtures/hex.json")

const hexFixture = "../../../packages/mmo-map/test/fixtures/hex.json"

type hexCentreCase struct {
	Q    int64   `json:"q"`
	R    int64   `json:"r"`
	Size float64 `json:"size"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
}

type hexPoint struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type hexAxial struct {
	Q int64 `json:"q"`
	R int64 `json:"r"`
}

type hexCornerCase struct {
	Size    float64    `json:"size"`
	X       float64    `json:"x"`
	Y       float64    `json:"y"`
	Corners []hexPoint `json:"corners"`
}

type hexPixelCase struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Size float64 `json:"size"`
	Q    int64   `json:"q"`
	R    int64   `json:"r"`
}

type hexFixtureFile struct {
	Directions []hexAxial      `json:"directions"`
	Centres    []hexCentreCase `json:"centres"`
	Corners    []hexCornerCase `json:"corners"`
	Pixels     []hexPixelCase  `json:"pixels"`
}

func hexFixtureNow() hexFixtureFile {
	var f hexFixtureFile
	for d := range simhex.Directions {
		h := simhex.Direction(d)
		f.Directions = append(f.Directions, hexAxial{h.Q, h.R})
	}
	for _, size := range []float64{1, 4, 12.5, 26} {
		for q := int64(-3); q <= 3; q++ {
			for r := int64(-3); r <= 3; r++ {
				p := hexCentre(simhex.Hex{Q: q, R: r}, size, Pt{})
				f.Centres = append(f.Centres, hexCentreCase{q, r, size, p.X, p.Y})
			}
		}
	}
	for _, c := range []hexCornerCase{{Size: 1}, {Size: 25, X: 40, Y: -13}} {
		for _, p := range hexPoly(Pt{c.X, c.Y}, c.Size) {
			c.Corners = append(c.Corners, hexPoint(p))
		}
		f.Corners = append(f.Corners, c)
	}
	// The same inverse as HexMap's, so a click picks the tile Go draws there.
	for _, size := range []float64{1, 7} {
		for i := -6; i <= 6; i++ {
			for j := -6; j <= 6; j++ {
				x, y := float64(i)*0.37*size, float64(j)*0.41*size
				q := math.Sqrt(3)/3*(x/size) - (y/size)/3
				rr := 2.0 / 3 * (y / size)
				h := cubeRound(q, rr)
				f.Pixels = append(f.Pixels, hexPixelCase{x, y, size, h.Q, h.R})
			}
		}
	}
	return f
}

// The live map's TypeScript hex maths is checked against these values, so
// a tile the site draws sits where /map draws it.
func TestHexCentreFixture(t *testing.T) {
	want := hexFixtureNow()
	path := filepath.FromSlash(hexFixture)
	if *updateHex {
		b, err := json.MarshalIndent(want, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(b, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("%v (run with -update-hex to write it)", err)
	}
	var got hexFixtureFile
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%s differs from render.hexCentre; run with -update-hex if the layout was meant to change", hexFixture)
	}
}
