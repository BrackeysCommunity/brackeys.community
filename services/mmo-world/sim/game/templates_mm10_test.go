package game

import (
	"fmt"
	"slices"
	"sort"
	"testing"

	"jams.team/mmo-world/sim/arc"
	"jams.team/mmo-world/sim/draw"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/fact"
	"jams.team/mmo-world/sim/goal"
	"jams.team/mmo-world/sim/hex"
	"jams.team/mmo-world/sim/ledger"
	"jams.team/mmo-world/sim/sheets"
	"jams.team/mmo-world/sim/tile"
	"jams.team/mmo-world/sim/world"
)

// The emergence templates end to end (GDD 12.9, 13.2, 17.6): each is cast
// from its predicate through the director's view, which a world without
// emergence never reads; each side is backed on every play, and every
// way a stage can end is played on a fresh world: the first side wins,
// the second does, or the days run out. Their won and lapse effects act
// on emergence's records and the ledger, which audits clean.

// mmTemplates are the templates emergence adds.
var mmTemplates = []string{"the-road-war", "the-lost-caravan", "the-rival-claims", "the-legend-wakes"}

// mmGame is a fresh world keeping emergence, the first settlement's region
// held by faction 0 and every gauge an effect moves standing mid-way.
func mmGame(t *testing.T) *Game {
	t.Helper()
	g := tplGame(t)
	if g.Emergence == nil {
		t.Fatal("a new world keeps no emergence")
	}
	tplHold(g, 0, 0, 40)
	for r := range g.World.Regions {
		for _, gauge := range []string{"threat", "prosperity", "unrest"} {
			tplGauge(t, g, r, gauge, 400)
		}
	}
	return g
}

// mmTiles are the free, passable tiles on the ring of radius around c in
// region r (any region for r < 0).
func mmTiles(t *testing.T, g *Game, c hex.Hex, radius int64, r int) []hex.Hex {
	t.Helper()
	var out []hex.Hex
	for _, h := range hex.Ring(c, radius) {
		b := g.r.Gen.Baseline(h)
		if !g.r.Gen.Passable(b.Terrain) || g.IsSettlement(h) || (r >= 0 && g.World.RegionAt(h) != r) {
			continue
		}
		out = append(out, h)
	}
	if len(out) == 0 {
		t.Fatalf("no free tile %d from %v in region %d", radius, c, r)
	}
	return out
}

// mmRoad promotes a road onto h and lets the world lay it.
func mmRoad(t *testing.T, g *Game, h hex.Hex) string {
	t.Helper()
	p, err := g.promoteTrace(Promoting{Type: emerge.Road, Region: g.World.RegionAt(h), At: &h})
	if err != nil || p == nil {
		t.Fatalf("no road promoted on %v: %v", h, err)
	}
	dirTick(t, g)
	if rec, ok := g.roadAt(h); !ok || rec.ID != p.ID {
		t.Fatalf("%v is not road %s: %+v", h, p.ID, rec)
	}
	return p.ID
}

// mmPlace adds a guild-run settlement with the starting structures at h.
func mmPlace(t *testing.T, g *Game, h hex.Hex, guild string) int {
	t.Helper()
	n := len(g.Places)
	p := &Place{N: n, Hex: h, Lattice: -1, Founded: g.Tick(), Guild: guild, Name: fmt.Sprintf("Place %d", n)}
	for _, st := range g.r.Book.Starting {
		p.Structures = append(p.Structures, tplStructure(g, st.Structure, st.Tier))
	}
	g.Places = append(g.Places, p)
	return n
}

// mmFound is what a template's predicate finds through a view.
func mmFound(g *Game, id string, w arc.World) []arc.Candidate {
	tpl, _ := g.template(id)
	return tpl.When(w, tpl.Row, g.r.Story)
}

// mmCast casts the one candidate the template's predicate finds through
// the director's view, which the plain story view never finds.
func mmCast(t *testing.T, g *Game, id string, want func(t *testing.T, c arc.Candidate)) *Arc {
	t.Helper()
	if cs := mmFound(g, id, g.storyView()); len(cs) != 0 {
		t.Fatalf("%s is found without emergence's view: %+v", id, cs)
	}
	cs := mmFound(g, id, g.directorView())
	if len(cs) != 1 {
		t.Fatalf("%s's predicate finds %d candidates: %+v", id, len(cs), cs)
	}
	want(t, cs[0])
	tpl, _ := g.template(id)
	a, err := g.castFrom(tpl, cs[0], ByDirector, g.Tick())
	if err != nil {
		t.Fatal(err)
	}
	if f := tplFact(t, g, a.Fact); f.Kind != "arc.cast" || !slices.Contains(f.Subjects, arcRef(a.ID)) {
		t.Fatalf("%s's cast fact %+v", id, f)
	}
	tplSeated(t, g, a, tplFact(t, g, a.Fact))
	return a
}

// mmWant checks a candidate's cast role by role.
func mmWant(t *testing.T, c arc.Candidate, roles map[string]fact.Ref) {
	t.Helper()
	for role, ref := range roles {
		if got, _ := c.Cast.Get(role); got != ref {
			t.Fatalf("cast %s as %s, want %s (%+v)", role, got, ref, c.Cast)
		}
	}
}

// mmEnd is what an arc's one stage left behind.
type mmEnd struct {
	won    string
	ended  fact.Fact
	backed []*tplBacker
	cited  []fact.Fact
}

// mmCited are the facts of a kind citing the stage's end.
func (e mmEnd) mmCited(kind string) []fact.Fact {
	var out []fact.Fact
	for _, f := range e.cited {
		if f.Kind == kind {
			out = append(out, f)
		}
	}
	return out
}

// mmStage plays a one-stage arc: with a winner, its mark met by two
// characters while the other side is half filled by one; lapsing, both
// sides half filled and the days run out. Every side is fillable, the pay
// is as the sides were backed, the world does what the sheet's effects ask
// the tick after, and the arc ends as its stage did.
func mmStage(t *testing.T, g *Game, a *Arc, mode int) mmEnd {
	t.Helper()
	st := &a.Stages[0]
	row, _ := g.stageRow(a, 0)
	if g.stages(a) != 1 || len(st.Sides) != len(row.Sides) || len(st.Sides) != 2 {
		t.Fatalf("%s runs %d stages, %d sides", a.ID, g.stages(a), len(st.Sides))
	}
	minted := int64(0)
	for i, sr := range st.Sides {
		x := g.GoalOf(sr.Goal)
		if x == nil || sr.Side != row.Sides[i].ID || x.Cond.Verb != goal.Back || x.Cond.Count != sr.Mark || sr.Mark < row.Sides[i].Per {
			t.Fatalf("%s side %+v, goal %+v", a.ID, sr, x)
		}
		if pool := g.Ledger.Of(goalPool(x.ID), ledger.Coin); pool != x.Reward {
			t.Fatalf("%s side %s holds %d of its %d escrow", a.ID, sr.Side, pool, x.Reward)
		}
		minted += x.Reward
	}
	if minted <= 0 {
		t.Fatalf("%s minted no escrow", a.ID)
	}
	var backed []*tplBacker
	won := ""
	for i, sr := range st.Sides {
		if i != mode {
			backed = append(backed, tplFill(t, g, a, sr, max(sr.Mark/2, 1), 1)...)
		}
	}
	if mode >= 0 {
		won = st.Sides[mode].Side
		backed = append(backed, tplFill(t, g, a, st.Sides[mode], st.Sides[mode].Mark, 2)...)
		dirTick(t, g)
		if !st.over() || st.Won != won {
			t.Fatalf("%s met by %s: %+v", a.ID, won, *st)
		}
	} else {
		for i := int64(0); !st.over() && i <= st.Due; i++ {
			dirTick(t, g)
		}
		if !st.over() || !st.Lapsed {
			t.Fatalf("%s did not lapse: %+v", a.ID, *st)
		}
	}
	ended := tplStageEnded(t, g, a, 0)
	tplWeighed(t, ended)
	tplSeated(t, g, a, ended)
	if !hasDatum(ended, "side", tplOr(won, outcomeLapsed)) || a.Outcome != tplOr(won, outcomeLapsed) {
		t.Fatalf("%s ended %q with %+v", a.ID, a.Outcome, ended)
	}
	tplPay(t, g, a, st, won, backed)
	effects := row.Lapse
	if sd, ok := sideRow(row, won); ok {
		effects = sd.Won
	}
	expected := tplExpect(t, g, a, effects)
	dirTick(t, g)
	end := mmEnd{won: won, ended: ended, backed: backed}
	var got []string
	for _, f := range g.Log.Since(ended.ID) {
		if !slices.Contains(f.Causes, ended.ID) {
			continue
		}
		end.cited = append(end.cited, f)
		if slices.Contains(tplWorldKinds, f.Kind) {
			got = append(got, tplSig(f))
		}
	}
	sort.Strings(got)
	sort.Strings(expected)
	if !slices.Equal(got, expected) {
		t.Fatalf("%s (%s): the world did %v, the sheet's effects ask %v", a.ID, tplOr(won, outcomeLapsed), got, expected)
	}
	audit(t, g)
	return end
}

// mmRun plays a template each way on its own fresh world.
func mmRun(t *testing.T, id string, setup func(t *testing.T, g *Game), want func(t *testing.T, g *Game, c arc.Candidate),
	check func(t *testing.T, g *Game, a *Arc, end mmEnd)) {
	for _, mode := range []int{0, 1, tplLapse} {
		name := "lapse"
		if mode >= 0 {
			name = fmt.Sprintf("side-%d-wins", mode)
		}
		t.Run(name, func(t *testing.T) {
			g := mmGame(t)
			setup(t, g)
			tplQuiet(g)
			a := mmCast(t, g, id, func(t *testing.T, c arc.Candidate) { want(t, g, c) })
			check(t, g, a, mmStage(t, g, a, mode))
		})
	}
}

// mmRoadWarState: a road beside the first settlement carried road-war-load
// within road-war-days, its region held by faction 0, with faction 2's
// seat near enough to raid it.
func mmRoadWarState(t *testing.T, g *Game) (hex.Hex, string) {
	t.Helper()
	h := mmTiles(t, g, g.SettlementHex(0), 1, 0)[0]
	id := mmRoad(t, g, h)
	if hex.Distance(g.regionHex(18), h) > g.r.Story.RivalDistance || hex.Distance(g.regionHex(10), h) <= g.r.Story.RivalDistance {
		t.Fatal("the guard world's factions are not where the road war needs them")
	}
	e := g.Emergence
	p := g.r.Emerge.P
	rl := &emerge.RoadLoad{Region: 0, Tiles: map[hex.Hex]int64{h: p.RoadWarLoad}, Busiest: h}
	rl.Window.Add(g.Tick()/sheets.TicksPerDay, e.Season, p.RoadWarLoad, p.RoadWarDays)
	e.RoadLoad[0] = rl
	return h, id
}

func TestRoadWar(t *testing.T) {
	var road hex.Hex
	var id string
	mmRun(t, "the-road-war",
		func(t *testing.T, g *Game) { road, id = mmRoadWarState(t, g) },
		func(t *testing.T, g *Game, c arc.Candidate) {
			mmWant(t, c, map[string]fact.Ref{"road": arc.TileRef(road), "raider": arc.FactionRef(2), seatRole: arc.SettlementRef(0)})
			if c.Pressure != g.r.Emerge.P.RoadWarLoad || !slices.Equal(c.Regions, []int{0}) {
				t.Fatalf("the road war presses %d over %v", c.Pressure, c.Regions)
			}
		},
		func(t *testing.T, g *Game, a *Arc, end mmEnd) {
			p := g.r.Emerge.P
			rec := g.Emergence.RoadRecs[id]
			day := end.ended.Tick / sheets.TicksPerDay
			cuts, tolls := end.mmCited("road.cut"), end.mmCited("road.tolled")
			switch end.won {
			case "patrol-it":
				if rec.PatrolUntil != day+p.PatrolDays || !g.roadPatrolled(road, day) || len(cuts)+len(tolls) != 0 {
					t.Fatalf("the patrol left %+v, %d cuts, %d tolls", rec, len(cuts), len(tolls))
				}
			case "prey-on-it":
				if rec.CutUntil != day+p.CutDays || g.roadOpen(road) || len(cuts) != 1 || len(tolls) != 0 {
					t.Fatalf("the raiders left %+v, %d cuts", rec, len(cuts))
				}
				f := cuts[0]
				if d, _ := f.Get("days"); d.N != p.CutDays || !hasDatum(f, "id", id) || !slices.Contains(f.Subjects, promotionRef(id)) || f.Weight != 60 {
					t.Fatalf("the cut says %+v", f)
				}
				if !(emergentView{g.storyView()}).RoadCut(0) {
					t.Fatal("the first settlement's only road is cut, and no road cut reads")
				}
			default:
				if rec.TollUntil != day+p.TollDays || !g.roadOpen(road) || len(tolls) != 1 || len(cuts) != 0 {
					t.Fatalf("the lapse left %+v, %d tolls", rec, len(tolls))
				}
				f := tolls[0]
				if d, _ := f.Get("coin"); d.N != p.TollCoin || !hasDatum(f, "id", id) || f.Region != world.RegionRef(0) || f.Weight != 60 {
					t.Fatalf("the toll says %+v", f)
				}
				c := mustCreate(t, g, "toll-payer", "knife")
				dirGive(t, g, c, ledger.Coin, p.TollCoin)
				coin := c.C.Coin
				if err := g.toll(c, road, g.Tick()); err != nil || c.C.Coin != coin-p.TollCoin {
					t.Fatalf("crossing the tolled road cost %d: %v", coin-c.C.Coin, err)
				}
				audit(t, g)
			}
		})
}

// TestRoadWarNeedsLoadAndRaider: a road short of road-war-load, or one no
// other faction is near, casts no road war.
func TestRoadWarNeedsLoadAndRaider(t *testing.T) {
	g := mmGame(t)
	_, _ = mmRoadWarState(t, g)
	rl := g.Emergence.RoadLoad[0]
	rl.Window = emerge.Window{}
	rl.Window.Add(g.Tick()/sheets.TicksPerDay, g.Emergence.Season, g.r.Emerge.P.RoadWarLoad-1, g.r.Emerge.P.RoadWarDays)
	if cs := mmFound(g, "the-road-war", g.directorView()); len(cs) != 0 {
		t.Fatalf("a road short of its load casts %+v", cs)
	}
	rl.Window.Add(g.Tick()/sheets.TicksPerDay, g.Emergence.Season, 1, g.r.Emerge.P.RoadWarDays)
	tplHold(g, 18, -1, 0)
	if cs := mmFound(g, "the-road-war", g.directorView()); len(cs) != 0 {
		t.Fatalf("a road nobody can raid casts %+v", cs)
	}
}

// TestRoadWarSpendsItsLoad: a road war cast on a region's roads, even one
// won the day it was cast, holds off another there for road-war-days; after
// that the same load casts again.
func TestRoadWarSpendsItsLoad(t *testing.T) {
	g := mmGame(t)
	road, _ := mmRoadWarState(t, g)
	if cs := mmFound(g, "the-road-war", g.directorView()); len(cs) != 1 {
		t.Fatalf("the busy road casts %d road wars", len(cs))
	}
	war := &Arc{ID: "arc-war", Template: "the-road-war", Scope: arc.Region, Regions: []int{0},
		Cast: arc.Cast{{Role: arc.RoleRoad, Ref: arc.TileRef(road)}}, Began: g.Tick(), Ended: g.Tick(), Outcome: "prey-on-it"}
	g.Story.Arcs = append(g.Story.Arcs, war)
	if cs := mmFound(g, "the-road-war", g.directorView()); len(cs) != 0 {
		t.Fatalf("a road war cast today leaves another to cast: %+v", cs)
	}
	war.Began = (g.Tick()/sheets.TicksPerDay - g.r.Emerge.P.RoadWarDays) * sheets.TicksPerDay
	war.Ended = war.Began
	if cs := mmFound(g, "the-road-war", g.directorView()); len(cs) != 1 {
		t.Fatalf("a road war road-war-days ago still holds the road: %d found", len(cs))
	}
}

// mmCaravanState: a route from the first settlement to a second, whose
// caravan has just left into a region at caravan-threat.
func mmCaravanState(t *testing.T, g *Game) *emerge.Caravan {
	t.Helper()
	b := mmPlace(t, g, mmTiles(t, g, g.SettlementHex(0), 4, -1)[0], "g-trade")
	p, err := g.promoteTrace(Promoting{Type: emerge.Route, Region: 0, Places: []int{0, b}})
	if err != nil || p == nil {
		t.Fatalf("no route promoted: %v", err)
	}
	rt := g.routeRec(p.ID)
	if rt == nil || len(rt.Path) < 2 {
		t.Fatalf("the route has no path: %+v", rt)
	}
	if err := g.caravanDepart(rt, g.Tick()/sheets.TicksPerDay, g.Tick()); err != nil {
		t.Fatal(err)
	}
	if len(g.Emergence.Caravans) != 1 || len(g.caravanGoods(g.Emergence.Caravans[0])) != 1 {
		t.Fatalf("no caravan left with goods: %+v", g.Emergence.Caravans)
	}
	tplGauge(t, g, 0, "threat", g.r.Emerge.P.CaravanThreat+100)
	audit(t, g)
	return g.Emergence.Caravans[0]
}

func TestLostCaravan(t *testing.T) {
	var cv *emerge.Caravan
	var at hex.Hex
	var arrive, cast int64
	var goods ledger.Balance
	mmRun(t, "the-lost-caravan",
		func(t *testing.T, g *Game) {
			cv = mmCaravanState(t, g)
			goods = g.caravanGoods(cv)[0]
		},
		func(t *testing.T, g *Game, c arc.Candidate) {
			mmWant(t, c, map[string]fact.Ref{"caravan": arc.CaravanRef(cv.ID), "front": arc.RegionRef(0), seatRole: arc.SettlementRef(0)})
			at, arrive, cast = g.caravanAt(cv, g.Tick()), cv.Arrive, g.Tick()
		},
		func(t *testing.T, g *Game, a *Arc, end mmEnd) {
			pool := ledger.CaravanPool(cv.ID)
			switch end.won {
			case "rescue-it":
				halt := end.ended.Tick - cast
				if g.castCaravan(cv.ID) == nil || cv.Halted != 0 || cv.Arc != "" || cv.Arrive != arrive+halt || g.Ledger.Of(pool, goods.Asset) != goods.Units {
					t.Fatalf("the rescued caravan is %+v (arrives %d, was %d, halted %d)", cv, cv.Arrive, arrive, halt)
				}
				if len(end.mmCited("caravan.lost")) != 0 {
					t.Fatal("a rescued caravan was lost")
				}
			case "salvage-it":
				if g.castCaravan(cv.ID) != nil || len(g.Ledger.Held(pool)) != 0 {
					t.Fatal("the salvaged caravan goes on")
				}
				var got int64
				for _, b := range end.backed {
					if b.side == end.won {
						got += g.Ledger.Of(ledger.Char(b.c.C.ID), goods.Asset) + g.Ledger.Of(ledger.WaitPool(at.Ref(), b.c.C.ID), goods.Asset)
					}
				}
				if got != goods.Units {
					t.Fatalf("the salvage gave its backers %d of %d", got, goods.Units)
				}
			default:
				lost := end.mmCited("caravan.lost")
				if g.castCaravan(cv.ID) != nil || len(g.Ledger.Held(pool)) != 0 || len(lost) != 1 {
					t.Fatalf("the lapsed caravan goes on, %d lost facts", len(lost))
				}
				if got := g.Ledger.Of(poolOf(at), goods.Asset); got != goods.Units {
					t.Fatalf("the caravan's tile holds %d of its %d", got, goods.Units)
				}
				f := lost[0]
				if h, ok := fact.HexOf(f); !ok || h != at || !hasDatum(f, "id", cv.ID) || f.Weight != 70 {
					t.Fatalf("the loss says %+v", f)
				}
				if d, _ := f.Get("units"); d.N != goods.Units {
					t.Fatalf("the loss counts %d units", d.N)
				}
			}
		})
}

// TestLostCaravanHalts: casting holds the caravan where it stands, so the
// predicate does not find it again, and the arc's end lets it go.
func TestLostCaravanHalts(t *testing.T) {
	g := mmGame(t)
	cv := mmCaravanState(t, g)
	tplQuiet(g)
	a := mmCast(t, g, "the-lost-caravan", func(*testing.T, arc.Candidate) {})
	at := g.caravanAt(cv, g.Tick())
	if cv.Halted != g.Tick() || cv.Arc != a.ID || len(mmFound(g, "the-lost-caravan", g.directorView())) != 0 {
		t.Fatalf("the cast caravan is %+v", cv)
	}
	arrive, halted := cv.Arrive, cv.Halted
	tplDays(t, g, 2)
	if g.caravanAt(cv, g.Tick()) != at || cv.Arrive != arrive || g.castCaravan(cv.ID) == nil {
		t.Fatal("a halted caravan moved")
	}
	g.releaseCast(a, g.Tick())
	if cv.Halted != 0 || cv.Arc != "" || cv.Arrive != arrive+g.Tick()-halted || g.caravanAt(cv, g.Tick()) != at {
		t.Fatalf("the released caravan is %+v", cv)
	}
}

// mmClaimsState: two live First-mode goals for different guilds' places,
// one in faction 0's region and one in faction 2's, indexed as a contest
// over the first settlement's region.
func mmClaimsState(t *testing.T, g *Game) (int, int) {
	t.Helper()
	tplHold(g, 8, 2, 40)
	sa := mmPlace(t, g, mmTiles(t, g, g.SettlementHex(0), 3, 0)[0], "g-claim-a")
	sb := mmPlace(t, g, mmTiles(t, g, g.SettlementHex(0), 4, 8)[0], "g-claim-b")
	var ids []string
	for _, n := range []int{sa, sb} {
		x := &Goal{Title: "Claim", Issuer: goal.Ref{Kind: goal.BySettlement, ID: itoa(n)}, Board: n, Mode: goal.First, Lifetime: goal.Season,
			Turnover: goal.Expire, Posted: g.Tick(), State: goal.Live, Cond: goal.Condition{Verb: goal.Deliver, Tag: "fibre", Count: 10}}
		g.openGoal(x)
		ids = append(ids, x.ID)
	}
	g.Emergence.Contests = append(g.Emergence.Contests, &emerge.Contest{A: ids[0], B: ids[1], SeatA: sa, SeatB: sb, Region: 0})
	return sa, sb
}

func TestRivalClaims(t *testing.T) {
	var sa, sb int
	mmRun(t, "the-rival-claims",
		func(t *testing.T, g *Game) { sa, sb = mmClaimsState(t, g) },
		func(t *testing.T, g *Game, c arc.Candidate) {
			mmWant(t, c, map[string]fact.Ref{"seat-a": arc.SettlementRef(sa), "seat-b": arc.SettlementRef(sb), "front": arc.RegionRef(0)})
			if !slices.Equal(c.Regions, []int{0, 8}) {
				t.Fatalf("the claims run over %v", c.Regions)
			}
		},
		func(t *testing.T, g *Game, a *Arc, end mmEnd) {
			if !g.Emergence.Contests[0].Cast || len((emergentView{g.storyView()}).Contests()) != 0 {
				t.Fatal("the cast contest is offered again")
			}
			if end.won == "" {
				return
			}
			seat := map[string]int{"back-a": sa, "back-b": sb}[end.won]
			fi := g.World.Regions[g.World.RegionAt(g.SettlementHex(seat))].Holder
			key := standingKey(fi, g.SettlementHex(seat))
			for _, b := range end.backed {
				if b.side != end.won {
					continue
				}
				if want := b.worth/g.r.Story.StandingFor + 2; b.c.C.Standing.Get(key) != want {
					t.Fatalf("%s won %s and stands %d with %s, want %d", b.c.C.ID, end.won, b.c.C.Standing.Get(key), key, want)
				}
			}
		})
}

// mmLegendState: an unlaid legend beside the first settlement.
func mmLegendState(t *testing.T, g *Game) *emerge.LegendRec {
	t.Helper()
	e := g.Emergence
	h := mmTiles(t, g, g.SettlementHex(0), 2, 0)[0]
	id := e.NewID(emerge.Legend)
	e.Promotions = append(e.Promotions, emerge.Promotion{ID: id, Type: emerge.Legend, Name: "Old Grey the Unbowed", Tick: g.Tick(), Season: e.Season, Region: 0, At: &h})
	l := &emerge.LegendRec{ID: id, Trait: "wary", Of: fact.Ref{Kind: kindCreature, ID: g.r.Book.Archetypes[0].ID}, Region: 0, At: h}
	e.Legends = append(e.Legends, l)
	return l
}

func TestLegendWakes(t *testing.T) {
	var l *emerge.LegendRec
	mmRun(t, "the-legend-wakes",
		func(t *testing.T, g *Game) { l = mmLegendState(t, g) },
		func(t *testing.T, g *Game, c arc.Candidate) {
			mmWant(t, c, map[string]fact.Ref{"legend": arc.LegendRef(l.ID), "front": arc.RegionRef(0), seatRole: arc.SettlementRef(0)})
		},
		func(t *testing.T, g *Game, a *Arc, end mmEnd) {
			v := emergentView{g.storyView()}
			if l.Cast != castDay(a.Began) {
				t.Fatalf("the legend's cast day is %d", l.Cast)
			}
			laid := end.mmCited("legend.laid")
			if end.won != "hunt-it" {
				if l.Laid != 0 || len(laid) != 0 || len(v.Legends()) != 1 || !v.Legends()[0].Rested {
					t.Fatalf("an unhunted legend is %+v, %d laid facts, views %+v", l, len(laid), v.Legends())
				}
				return
			}
			if l.Laid == 0 || len(laid) != 1 || len(v.Legends()) != 0 {
				t.Fatalf("the hunted legend is %+v, %d laid facts", l, len(laid))
			}
			f := laid[0]
			if !hasDatum(f, "id", l.ID) || !hasDatum(f, "name", "Old Grey the Unbowed") || !slices.Contains(f.Subjects, promotionRef(l.ID)) || f.Weight != 70 {
				t.Fatalf("the laying says %+v", f)
			}
		})
}

// TestLegendRests: a legend cast lately, or one laid, is not offered; the
// newest legends-kept unlaid are.
func TestLegendRests(t *testing.T) {
	g := mmGame(t)
	l := mmLegendState(t, g)
	v := emergentView{g.storyView()}
	day := g.Tick() / sheets.TicksPerDay
	l.Cast = max(day, 1)
	if ls := v.Legends(); len(ls) != 1 || !ls[0].Rested || len(mmFound(g, "the-legend-wakes", v)) != 0 {
		t.Fatalf("a legend cast today is offered: %+v", ls)
	}
	l.Cast = day - g.r.Emerge.P.LegendRestDays
	if ls := v.Legends(); len(ls) != 1 || ls[0].Rested {
		t.Fatalf("a legend rested its days is not offered: %+v", ls)
	}
	l.Laid = max(day, 1)
	if ls := v.Legends(); len(ls) != 0 {
		t.Fatalf("a laid legend is offered: %+v", ls)
	}
	for range g.r.Emerge.P.LegendsKept + 2 {
		mmLegendState(t, g)
	}
	ls := v.Legends()
	if int64(len(ls)) != g.r.Emerge.P.LegendsKept || ls[len(ls)-1].ID != g.Emergence.Legends[len(g.Emergence.Legends)-1].ID {
		t.Fatalf("%d legends offered, the newest last: %+v", len(ls), ls)
	}
}

// TestShortageOnCutRoad: a place whose every road in is cut runs short
// (GDD 12.5); an open road beside it, or a world without emergence, does
// not; and the director casts it.
func TestShortageOnCutRoad(t *testing.T) {
	g := mmGame(t)
	ring := mmTiles(t, g, g.SettlementHex(0), 1, -1)
	h := ring[0]
	id := mmRoad(t, g, h)
	at0 := func(w arc.World) bool {
		return slices.ContainsFunc(mmFound(g, "shortage", w), func(c arc.Candidate) bool { return c.Place == 0 })
	}
	if at0(g.directorView()) {
		t.Fatal("an open road brings a shortage")
	}
	day := g.Tick() / sheets.TicksPerDay
	g.Emergence.RoadRecs[id].CutUntil = day + g.r.Emerge.P.CutDays
	if !at0(g.directorView()) || at0(g.storyView()) {
		t.Fatal("a cut road brings no shortage, or one is read without emergence's view")
	}
	i := slices.IndexFunc(ring, func(x hex.Hex) bool { return hex.Distance(x, h) > 1 })
	if i < 0 {
		t.Fatal("no second tile apart from the first road")
	}
	other := mmRoad(t, g, ring[i])
	if other == id {
		t.Fatal("the second road joined the first")
	}
	if at0(g.directorView()) {
		t.Fatal("a place with an open road in runs short")
	}
	g.Emergence.RoadRecs[other].CutUntil = day + g.r.Emerge.P.CutDays
	if !at0(g.directorView()) {
		t.Fatal("a place with both its roads cut does not run short")
	}
	row := troubleRow(t, "shortage")
	pass := int64(-1)
	for d := int64(1); d < 64 && pass < 0; d++ {
		if g.r.draw.Percent(row.Chance, troubleDraw, draw.Int(0), draw.Str(row.ID), draw.Int(d)) {
			pass = d
		}
	}
	if err := g.castSettlements(g.directorView(), pass*sheets.TicksPerDay); err != nil {
		t.Fatal(err)
	}
	if !slices.ContainsFunc(g.openArcs(arc.Settlement), func(a *Arc) bool { return a.Template == "shortage" && a.Place == goal.SettlementRef(0) }) {
		t.Fatal("the director cast no shortage at a place cut off")
	}
	g.Emergence = nil
	g.wireEmergence()
	if at0(g.directorView()) {
		t.Fatal("a world without emergence runs short of a cut road")
	}
}

// TestCaravanOccasionRoadIn: under emergence a caravan comes by an open
// road or to a route's end, not by passages; a world without emergence
// keeps the passages.
func TestCaravanOccasionRoadIn(t *testing.T) {
	g := mmGame(t)
	lineOn(t, g, homeRegion(g), "prosperity-caravans", 650)
	at0 := func(w arc.World) bool {
		return slices.ContainsFunc(mmFound(g, occasionCaravan, w), func(c arc.Candidate) bool { return c.Place == 0 })
	}
	tl := g.World.Tile(g.SettlementHex(0))
	if tl == nil {
		t.Fatal("the first settlement's tile is not stored")
	}
	for range g.r.Story.CaravanPassages {
		tl.Leave(0)
	}
	if tl.Season[tile.CounterPassage] < g.r.Story.CaravanPassages || !at0(g.storyView()) {
		t.Fatal("passages bring no caravan to the plain view")
	}
	if at0(g.directorView()) {
		t.Fatal("passages alone bring a caravan under emergence")
	}
	h := mmTiles(t, g, g.SettlementHex(0), 1, -1)[0]
	id := mmRoad(t, g, h)
	if !at0(g.directorView()) {
		t.Fatal("an open road in brings no caravan")
	}
	g.Emergence.RoadRecs[id].CutUntil = g.Tick()/sheets.TicksPerDay + g.r.Emerge.P.CutDays
	if at0(g.directorView()) {
		t.Fatal("a cut road brings a caravan")
	}
	g.Emergence.Routes = append(g.Emergence.Routes, &emerge.RouteRec{ID: "route:99", A: 3, B: 0})
	if !at0(g.directorView()) {
		t.Fatal("a route's end brings no caravan")
	}
	g.Emergence = nil
	g.wireEmergence()
	if !at0(g.directorView()) {
		t.Fatal("a world without emergence lost the passages' caravan")
	}
}

// mmSig is a candidate as compared across worlds.
func mmSig(cs []arc.Candidate) []string {
	out := make([]string, len(cs))
	for i, c := range cs {
		out[i] = fmt.Sprintf("%s %v %v %d %d %s %v", c.Cast.Key(), c.Regions, c.Seat, c.Pressure, c.Place, c.Char, c.Causes)
	}
	return out
}

// mmMM9State sets what the siege, overrun, dry seam and grudge tests need.
func mmMM9State(t *testing.T, g *Game) {
	t.Helper()
	tplSiegeState(t, g)
	tplGauge(t, g, 1, "threat", 950)
	tplLine(t, g, 1, "threat-overrun")
	tplGauge(t, g, 0, "scarcity", 750)
	tplLine(t, g, 0, "scarcity-yields")
	g.World.Factions[0].Grudge[1] = 20
	tplRemember(t, g, g.regionHex(g.World.Factions[1].Seat), "faction.betrayed", []fact.Ref{arc.FactionRef(1), arc.FactionRef(0)})
}

// TestTemplatesNoEmergenceUnchanged: without emergence the director reads
// the plain view; the eighteen older templates find the same with emergence
// on and play end to end; the four emergence templates find and cast
// nothing, even with their state set, and their refs cannot be bound by
// hand.
func TestTemplatesNoEmergenceUnchanged(t *testing.T) {
	on, off := tplGame(t), tplGame(t)
	var cv *emerge.Caravan
	for _, g := range []*Game{on, off} {
		mmMM9State(t, g)
		mmRoadWarState(t, g)
		cv = mmCaravanState(t, g)
		mmClaimsState(t, g)
		mmLegendState(t, g)
		for _, id := range mmTemplates {
			if len(mmFound(g, id, g.directorView())) == 0 {
				t.Fatalf("%s finds nothing with its state set", id)
			}
		}
	}
	off.Emergence = nil
	off.wireEmergence()
	if _, ok := off.directorView().(arc.Emergent); ok {
		t.Fatal("a world without emergence is read through emergence's view")
	}
	mm9 := 0
	for _, tpl := range off.r.Templates {
		id := tpl.Row.ID
		got := mmFound(off, id, off.directorView())
		if slices.Contains(mmTemplates, id) {
			if len(got) != 0 {
				t.Fatalf("%s finds %+v without emergence", id, got)
			}
			continue
		}
		if tpl.Row.Trouble == nil && tpl.Row.Occasion == nil {
			mm9++
		}
		want := mmFound(on, id, on.directorView())
		if a, b := mmSig(got), mmSig(want); !slices.Equal(a, b) {
			t.Fatalf("%s finds %v without emergence, %v with", id, a, b)
		}
	}
	if mm9 != 18 {
		t.Fatalf("%d of MM9's templates, not 18", mm9)
	}
	if _, err := off.CastArc("the-lost-caravan", arc.Cast{{Role: "caravan", Ref: arc.CaravanRef(cv.ID)}, {Role: "front", Ref: arc.RegionRef(0)}},
		off.SettlementHex(0), ByOperator, off.Tick()); err == nil {
		t.Fatal("a caravan was bound by hand in a world without emergence")
	}
	for _, mode := range []int{0, 1, tplLapse} {
		for _, s := range []tplSpec{tplSiege, {id: "the-overrun", by: ByDirector, setup: func(t *testing.T, g *Game) {
			tplGauge(t, g, 1, "threat", 950)
			tplLine(t, g, 1, "threat-overrun")
		}}} {
			g := tplGame(t)
			g.Emergence = nil
			g.wireEmergence()
			s.setup(t, g)
			tplQuiet(g)
			tplPlay(t, g, tplCast(t, g, s), s, mode)
		}
	}
	mmKinds := []string{"promotion", "road.cut", "road.tolled", "caravan.lost", "legend.laid", "caravan.departed"}
	g := tplGame(t)
	g.Emergence = nil
	g.wireEmergence()
	mmMM9State(t, g)
	tplQuiet(g)
	for day := 0; day < 12 && !slices.ContainsFunc(g.Story.Arcs, func(a *Arc) bool { return a.Template == "the-overrun" }); day++ {
		tplDays(t, g, 1)
		tplGauge(t, g, 1, "threat", 950)
		tplLine(t, g, 1, "threat-overrun")
	}
	for _, f := range g.Log.Since(0) {
		if slices.Contains(mmKinds, f.Kind) {
			t.Fatalf("a world without emergence wrote %s", f.Kind)
		}
	}
	for _, a := range g.Story.Arcs {
		if slices.Contains(mmTemplates, a.Template) {
			t.Fatalf("a world without emergence cast %s", a.Template)
		}
	}
	if !slices.ContainsFunc(g.Story.Arcs, func(a *Arc) bool { return a.Template == "the-overrun" && a.By == ByDirector }) {
		t.Fatal("the director cast no overrun without emergence")
	}
}
