package render

import (
	"fmt"
	"strings"

	"jams.team/mmo-world/sim/sheets"
)

// Slots are the authored art pictures a card can carry (GDD 16.2).
var Slots = []string{"day", "fair", "siege", "raid", "fire", "corruption", "shortage", "sickness", "panic", "stage-held", "stage-lost", "finale", "season-close"}

// SlotDay is the slot of a fact nothing more fitting names.
const SlotDay = "day"

// Lapsed is the template a stage's or an arc's end is asked about when
// nobody held it.
const Lapsed = "lapsed"

// ArtInput is an art picture's input: the slot and the kit drawing it.
type ArtInput struct {
	Slot string `json:"slot"`
	Kit  string `json:"kit"`
}

// structural: art size in pixels.
const (
	artW = 640
	artH = 200
)

// slotOfKind is the slot a fact kind always takes.
var slotOfKind = map[string]string{
	"trouble.held": "stage-held", "trouble.lost": "stage-lost",
	"season.finale": "finale", "season.closed": "season-close", "season.epoch": "season-close",
	"settlement.ruined": "stage-lost", "city.fell-back": "stage-lost", "faction.fell": "stage-lost",
}

// slotWords map a word of a template or a kind to its slot, first match
// winning, so a template the sheets add later still finds a picture.
var slotWords = []struct{ word, slot string }{
	{"siege", "siege"}, {"last-stand", "siege"},
	{"raid", "raid"}, {"overrun", "raid"}, {"-war", "raid"}, {"robbed", "raid"}, {"road.cut", "raid"},
	{"fire", "fire"}, {"burn", "fire"}, {"scorch", "fire"},
	{"corrupt", "corruption"}, {"core.", "corruption"}, {"haywire", "corruption"},
	{"shortage", "shortage"}, {"dry", "shortage"}, {"cold", "shortage"}, {"starving", "shortage"}, {"worked-out", "shortage"}, {"lost-caravan", "shortage"},
	{"sick", "sickness"}, {"plague", "sickness"},
	{"panic", "panic"}, {"unrest", "panic"}, {"waking", "panic"}, {"legend", "panic"}, {"haunted", "panic"},
	{"occasion", "fair"}, {"caravan", "fair"}, {"migration", "fair"}, {"seam", "fair"}, {"city", "fair"}, {"founded", "fair"},
	{"opening", "fair"}, {"rebuild", "fair"}, {"custom", "fair"},
}

// SlotFor is the art slot of a fact: its kind's own slot, a stage's or an
// arc's end held or lapsed, else the first slot a word of its template
// (the arc, trouble or occasion it names) or of its kind names, else day.
// It is never empty.
func SlotFor(kind, template string) string {
	if s, ok := slotOfKind[kind]; ok {
		return s
	}
	if kind == "arc.stage-ended" || kind == "arc.ended" {
		if template == Lapsed {
			return "stage-lost"
		}
		return "stage-held"
	}
	for _, s := range []string{template, kind} {
		if s == "" {
			continue
		}
		for _, w := range slotWords {
			if strings.Contains(s, w.word) {
				return w.slot
			}
		}
	}
	return SlotDay
}

// Art draws a slot's authored layers in order on a 640 by 200 canvas.
func Art(slot string, kit *Kit, palette []sheets.Palette) (*Canvas, error) {
	layers, ok := kit.Art[slot]
	if !ok {
		return nil, fmt.Errorf("render: kit %s has no art for slot %q", kit.Pack, slot)
	}
	c := NewCanvas(artW, artH, tar)
	for _, l := range layers {
		if err := drawLayer(c, l, palette); err != nil {
			return nil, err
		}
	}
	return c, nil
}
