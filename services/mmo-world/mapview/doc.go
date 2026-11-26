// Package mapview is the live map's read model (GDD 4.11): the shared base
// every viewer gets (index, regions and chunks, built from discovered tiles
// only) and each viewer's live layers over it. It reads a held game and
// never changes it; nothing under sim imports it.
package mapview
