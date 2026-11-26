package api

// Paths of the live map (GDD 4.11). The world serves them to the site with
// the map token; the Activity listener serves the same reads under
// /api/activity/map/ with the session as the viewer.
const (
	PathMapIndex   = "/v1/map/index"
	PathMapStyle   = "/v1/map/style"
	PathMapRegions = "/v1/map/regions"
	PathMapChunk   = "/v1/map/chunk"   // ?a=&b=&level=
	PathMapOverlay = "/v1/map/overlay" // ?chunks=a.b,…|scope=sight &discordId=
	PathMapFocus   = "/v1/map/focus"   // ?server=

	PathActivityMapTick    = "/api/activity/map/tick"
	PathActivityMapStyle   = "/api/activity/map/style"
	PathActivityMapRegions = "/api/activity/map/regions"
	PathActivityMapChunk   = "/api/activity/map/chunk"
	PathActivityMapOverlay = "/api/activity/map/overlay"
)

// Levels of detail, widest first.
const (
	LevelRegion = "region"
	LevelArea   = "area"
	LevelTile   = "tile"
)

// Fog states of a tile to one viewer. Unknown tiles are never sent.
const (
	FogSight      = "sight"
	FogSeen       = "seen"
	FogDiscovered = "discovered"
	FogUnknown    = "unknown" // only in a /map picture's input
)

// Viewer kinds of an overlay.
const (
	ViewerAnonymous = "anonymous"
	ViewerPlayer    = "player" // signed in, no character
	ViewerCharacter = "character"
)

// Busy bands; "" is quiet.
const (
	BusyLight   = "light"
	BusyBusy    = "busy"
	BusyCrowded = "crowded"
)

// Place kinds a base cell carries.
const (
	PlaceSettlement = "settlement"
	PlaceCity       = "city"      // a city's own tile
	PlaceCityTile   = "city-tile" // one of a city's other tiles
	PlaceRuin       = "ruin"
	PlaceFaction    = "faction" // a faction city
)

// MapIndex is the map at one tick: every discovered chunk and the rev of
// each payload. It is the one per-tick read; the payloads it names are
// addressed by content.
type MapIndex struct {
	World       string        `json:"world"`
	Tick        int64         `json:"tick"`
	TicksPerDay int64         `json:"ticksPerDay"`
	TickSeconds int64         `json:"tickSeconds"`
	ChunkRadius int64         `json:"chunkRadius"`
	Tiles       int64         `json:"tiles"` // discovered
	Home        Hex           `json:"home"`
	Style       string        `json:"style"`   // rev
	Regions     string        `json:"regions"` // rev
	Chunks      []MapChunkRef `json:"chunks"`
}

// MapChunkRef is one discovered chunk: where it is and the rev of its
// area and tile payloads.
type MapChunkRef struct {
	A      int64  `json:"a"`
	B      int64  `json:"b"`
	Centre Hex    `json:"centre"`
	Tiles  int64  `json:"tiles"` // discovered
	Area   string `json:"area"`
	Tile   string `json:"tile"`
}

// MapRegions is the widest level: each discovered tile's region, in rows.
type MapRegions struct {
	World   string      `json:"world"`
	Rev     string      `json:"rev"`
	Regions []MapRegion `json:"regions"` // a row's slots index these
	Rows    []MapRow    `json:"rows"`
	Places  []MapDot    `json:"places"`
}

// MapRegion is a discovered region at the widest level.
type MapRegion struct {
	Ref     string `json:"ref"`
	Terrain string `json:"terrain"` // its biome
	Anchor  Hex    `json:"anchor"`  // the discovered tile nearest its centroid
	Tiles   int64  `json:"tiles"`   // discovered
	Name    string `json:"name,omitempty"`
}

// MapRow is a run of tiles along one r from Q: Slots[i] is tile (Q+i, R)'s
// region slot, or -1 where the tile is not discovered.
type MapRow struct {
	R     int64   `json:"r"`
	Q     int64   `json:"q"`
	Slots []int64 `json:"slots"`
}

// MapDot is a settlement or city at the widest level.
type MapDot struct {
	Q     int64  `json:"q"`
	R     int64  `json:"r"`
	Place string `json:"place"`
}

// MapChunk is one chunk's shared base at area or tile level: its
// discovered tiles only, the same for every viewer.
type MapChunk struct {
	World string            `json:"world"`
	A     int64             `json:"a"`
	B     int64             `json:"b"`
	Level string            `json:"level"`
	Rev   string            `json:"rev"`
	Cells []MapCell         `json:"cells"` // sorted by r, then q
	Names map[string]string `json:"names,omitempty"`
}

// MapCell is a discovered tile's base layers. Area level fills Terrain,
// Secondary, Blend, Water, Region, Edge, Road and Place; tile level the
// rest as well.
type MapCell struct {
	Q          int64    `json:"q"`
	R          int64    `json:"r"`
	Terrain    string   `json:"terrain"`
	Secondary  string   `json:"secondary,omitempty"`
	Blend      int64    `json:"blend,omitempty"` // 0 to 50, the secondary's share
	Water      string   `json:"water,omitempty"` // omitted for none
	Region     string   `json:"region,omitempty"`
	Edge       int64    `json:"edge,omitempty"` // bit d: the neighbour in direction d is undiscovered
	Road       int64    `json:"road,omitempty"`
	Place      string   `json:"place,omitempty"`
	PlaceRef   string   `json:"placeRef,omitempty"` // a settlement's ref, for its name
	Guild      string   `json:"guild,omitempty"`    // the guild ref running it
	Site       string   `json:"site,omitempty"`
	SiteKind   string   `json:"siteKind,omitempty"`
	Landmark   string   `json:"landmark,omitempty"`
	RoadName   string   `json:"roadName,omitempty"`
	Structures []string `json:"structures,omitempty"`
	Found      int64    `json:"found,omitempty"`
}

// MapOverlayQuery is an overlay request: chunks by id, or the chunks the
// viewer's sight touches.
type MapOverlayQuery struct {
	Chunks []MapChunkID `json:"chunks,omitempty"`
	Sight  bool         `json:"sight,omitempty"`
}

// MapChunkID names a chunk.
type MapChunkID struct {
	A int64 `json:"a"`
	B int64 `json:"b"`
}

// MapLive is a tile's live layers to one viewer: as they are this tick in
// sight, or as last seen with the tick the tile left sight.
type MapLive struct {
	Q          int64  `json:"q"`
	R          int64  `json:"r"`
	Fog        string `json:"fog"`            // sight or seen
	Left       int64  `json:"left,omitempty"` // seen: the tick it left sight
	Threat     int64  `json:"threat,omitempty"`
	Corruption int64  `json:"corruption,omitempty"`
	Danger     bool   `json:"danger,omitempty"`
	Corrupted  bool   `json:"corrupted,omitempty"`
	Weather    string `json:"weather,omitempty"`
	Trouble    string `json:"trouble,omitempty"` // the trouble row
	Fire       bool   `json:"fire,omitempty"`
	Cut        bool   `json:"cut,omitempty"`
	Toll       int64  `json:"toll,omitempty"`
	Camp       string `json:"camp,omitempty"`
	Haunted    bool   `json:"haunted,omitempty"`
	Busy       string `json:"busy,omitempty"`
}

// MapFront is a weather system over the viewer's sight, drawn at the
// in-sight tile nearest its centre.
type MapFront struct {
	Kind    string `json:"kind"`
	Q       int64  `json:"q"`
	R       int64  `json:"r"`
	Heading string `json:"heading"` // a direction id: e, ne, nw, w, sw, se
}

// MapSelf is the viewer's own character on the map.
type MapSelf struct {
	Character string   `json:"character"`
	Q         int64    `json:"q"`
	R         int64    `json:"r"`
	Floor     int64    `json:"floor,omitempty"`
	Route     []Hex    `json:"route,omitempty"`
	Cell      *MapCell `json:"cell,omitempty"` // only while nobody has found the tile
}

// MapOverlay is one viewer's live layers over some chunks. An anonymous
// viewer, or one with no character, gets no tile, front or self.
type MapOverlay struct {
	World  string            `json:"world"`
	Tick   int64             `json:"tick"`
	Viewer string            `json:"viewer"`
	Guild  bool              `json:"guild,omitempty"` // a guild's sight is joined in
	Self   *MapSelf          `json:"self,omitempty"`
	Tiles  []MapLive         `json:"tiles"` // sorted by r, then q
	Fronts []MapFront        `json:"fronts"`
	Names  map[string]string `json:"names,omitempty"` // the viewer's server's masks
}

// MapFocus is where a server's view centres.
type MapFocus struct {
	Centre      Hex   `json:"centre"`
	Settlements int64 `json:"settlements"` // its guild's standing ones
}

// MapStyle is the map's look, from the setting pack.
type MapStyle struct {
	Rev     string          `json:"rev"`
	Entries []MapStyleEntry `json:"entries"`
	View    MapViewNumbers  `json:"view"`
}

// MapStyleEntry is one thing the map draws: by id, its colour, alpha,
// glyph and pattern.
type MapStyleEntry struct {
	ID      string `json:"id"`
	Colour  string `json:"colour"` // #rrggbb
	Alpha   int64  `json:"alpha"`  // 0 to 255
	Glyph   string `json:"glyph,omitempty"`
	Pattern string `json:"pattern,omitempty"`
}

// MapViewNumbers are the view's numbers a client draws by.
type MapViewNumbers struct {
	SeenDim  int64 `json:"seenDim"` // percent
	ZoomArea int64 `json:"zoomArea"`
	ZoomTile int64 `json:"zoomTile"`
	ZoomMin  int64 `json:"zoomMin"`
	ZoomMax  int64 `json:"zoomMax"`
	BlendMax int64 `json:"blendMax"`
}

// MapTileView is one tile as a viewer may see it: the base and the live
// layers merged, as /map draws it and as the site merges it.
type MapTileView struct {
	Cell MapCell  `json:"cell"`
	Fog  string   `json:"fog"` // sight, seen or discovered
	Live *MapLive `json:"live,omitempty"`
}
