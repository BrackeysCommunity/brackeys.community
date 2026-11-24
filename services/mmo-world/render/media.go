package render

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image/color"
	"io/fs"
	"path"
	"slices"
	"strings"
	"sync"

	"jams.team/mmo-world/sim/sheets"
)

// The media kit is a setting pack's authored layers for portraits and art
// slots (GDD 16.2). It sits outside sheets and packs, so no book digest
// moves when a drawing does; its own digest joins every key drawn from it.

//go:embed media
var mediaFS embed.FS

// structural: the version every picture key carries, so a new drawing
// never reuses a key a client cached as immutable.
const Version = "2"

// DefaultPack is the setting pack the world draws with.
const DefaultPack = "wasteland"

// Layer is one authored shape: SVG path data on its picture's canvas,
// filled with a palette colour.
type Layer struct {
	ID   string   `json:"id"`
	Part string   `json:"part"` // portraits: body, head, mark, aura; art: any
	Tags []string `json:"tags,omitempty"`
	// Tier is the lowest creature tier a portrait layer is drawn for.
	Tier  int64  `json:"tier,omitempty"`
	Path  string `json:"path"`
	Fill  string `json:"fill"`            // a palette id
	Alpha int64  `json:"alpha,omitempty"` // out of 255; 0 is opaque
}

// Kit is a pack's media: its portrait layers, its art by slot, and the
// digest of every file it was read from.
type Kit struct {
	Pack      string
	Portraits []Layer
	Art       map[string][]Layer // by slot
	Digest    string
	reads     map[string]bool // every tag a portrait layer names
}

type layerFile struct {
	Layers []Layer `json:"layers"`
}

// Portrait parts, in the order they are drawn.
const (
	PartAura = "aura"
	PartBody = "body"
	PartHead = "head"
	PartMark = "mark"
)

var portraitParts = []string{PartAura, PartBody, PartHead, PartMark}

// LoadKit reads a pack's media: portraits.json and one art/<slot>.json for
// every slot. A missing slot, an unknown file or a path that does not
// parse is an error.
func LoadKit(pack string) (*Kit, error) {
	root := path.Join("media", pack)
	h := sha256.New()
	read := func(name string) ([]Layer, error) {
		b, err := mediaFS.ReadFile(path.Join(root, name))
		if err != nil {
			return nil, fmt.Errorf("render: media %s: %w", pack, err)
		}
		h.Write([]byte(name + "\x00"))
		h.Write(b)
		dec := json.NewDecoder(bytes.NewReader(b))
		dec.DisallowUnknownFields()
		var f layerFile
		if err := dec.Decode(&f); err != nil {
			return nil, fmt.Errorf("render: media %s/%s: %w", pack, name, err)
		}
		for _, l := range f.Layers {
			if err := checkLayer(l); err != nil {
				return nil, fmt.Errorf("render: media %s/%s: %w", pack, name, err)
			}
		}
		return f.Layers, nil
	}
	k := &Kit{Pack: pack, Art: map[string][]Layer{}}
	var err error
	if k.Portraits, err = read("portraits.json"); err != nil {
		return nil, err
	}
	k.reads = map[string]bool{}
	for _, l := range k.Portraits {
		if !slices.Contains(portraitParts, l.Part) {
			return nil, fmt.Errorf("render: media %s: portrait layer %s has part %q", pack, l.ID, l.Part)
		}
		for _, t := range l.Tags {
			k.reads[t] = true
		}
	}
	files, err := fs.ReadDir(mediaFS, path.Join(root, "art"))
	if err != nil {
		return nil, fmt.Errorf("render: media %s: %w", pack, err)
	}
	for _, f := range files {
		slot := strings.TrimSuffix(f.Name(), ".json")
		if !slices.Contains(Slots, slot) {
			return nil, fmt.Errorf("render: media %s: art for no slot: %s", pack, f.Name())
		}
	}
	for _, slot := range Slots {
		if k.Art[slot], err = read(path.Join("art", slot+".json")); err != nil {
			return nil, err
		}
		if len(k.Art[slot]) == 0 {
			return nil, fmt.Errorf("render: media %s: slot %s has no layers", pack, slot)
		}
	}
	k.Digest = hex.EncodeToString(h.Sum(nil)[:12])
	return k, nil
}

func checkLayer(l Layer) error {
	if l.ID == "" || l.Part == "" || l.Fill == "" {
		return fmt.Errorf("layer %q needs an id, a part and a fill", l.ID)
	}
	if l.Alpha < 0 || l.Alpha > 255 {
		return fmt.Errorf("layer %s: alpha %d is outside 0 to 255", l.ID, l.Alpha)
	}
	polys, err := SVGPath(l.Path, 1, Pt{})
	if err != nil {
		return fmt.Errorf("layer %s: %w", l.ID, err)
	}
	if len(polys) == 0 {
		return fmt.Errorf("layer %s draws nothing", l.ID)
	}
	return nil
}

var defaultKit = sync.OnceValues(func() (*Kit, error) { return LoadKit(DefaultPack) })

// DefaultKit is the default pack's kit, read once: the files are built in,
// so its digest is fixed for the life of the process.
func DefaultKit() (*Kit, error) { return defaultKit() }

// Fills are the palette ids a kit's layers name.
func (k *Kit) Fills() []string {
	var out []string
	add := func(ls []Layer) {
		for _, l := range ls {
			if !slices.Contains(out, l.Fill) {
				out = append(out, l.Fill)
			}
		}
	}
	add(k.Portraits)
	for _, slot := range Slots {
		add(k.Art[slot])
	}
	slices.Sort(out)
	return out
}

// paint is a layer's colour from the palette.
func paint(l Layer, palette []sheets.Palette) (color.Color, error) {
	i := slices.IndexFunc(palette, func(p sheets.Palette) bool { return p.ID == l.Fill })
	if i < 0 {
		return nil, fmt.Errorf("render: layer %s: no palette colour %q", l.ID, l.Fill)
	}
	c := Hex(palette[i].Hex)
	if l.Alpha == 0 {
		return c, nil
	}
	return Alpha(c, uint8(l.Alpha)), nil
}

// drawLayer fills one layer at its own scale.
func drawLayer(c *Canvas, l Layer, palette []sheets.Palette) error {
	col, err := paint(l, palette)
	if err != nil {
		return err
	}
	polys, err := SVGPath(l.Path, 1, Pt{})
	if err != nil {
		return err
	}
	c.Fill(polys, col)
	return nil
}
