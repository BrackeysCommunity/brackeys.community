package harness

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"jams.team/mmo-world/sheetfs"
	"jams.team/mmo-world/sim/emerge"
	"jams.team/mmo-world/sim/game"
)

// TestEmergenceDriverPlain holds the closed world's driver to asking
// policies and sending what they choose: emergence.go names no scripted
// step, no operator command and no write to the played game.
func TestEmergenceDriverPlain(t *testing.T) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "emergence.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	ops := operatorConsts(t)
	// Steps that place, ready, solve or pick for a character instead of
	// letting its policy choose.
	scripted := []string{"ReadyAt", "Teleport", "Script", "Explorer", "NewExplorer", "MachineBeat", "PartyMachineBeat", "Host", "SetMachine"}
	at := func(n ast.Node) string { return fset.Position(n.Pos()).String() }
	sawTurn := false
	for _, decl := range f.Decls {
		fn, _ := decl.(*ast.FuncDecl)
		ast.Inspect(decl, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.Ident:
				if slices.Contains(scripted, x.Name) {
					t.Errorf("%s: names %s", at(x), x.Name)
				}
			case *ast.SelectorExpr:
				if id, ok := x.X.(*ast.Ident); ok && id.Name == "game" && ops[x.Sel.Name] {
					t.Errorf("%s: names the operator kind game.%s", at(x), x.Sel.Name)
				}
				if x.Sel.Name == "TurnFor" {
					sawTurn = true
				}
			case *ast.BasicLit:
				if s, err := strconv.Unquote(x.Value); err == nil && x.Kind == token.STRING && s != "" && game.Operator(s) {
					t.Errorf("%s: names the operator kind %q", at(x), s)
				}
			case *ast.CallExpr:
				switch fun := x.Fun.(type) {
				case *ast.Ident:
					if fun.Name == "Pick" {
						t.Errorf("%s: calls Pick", at(x))
					}
				case *ast.SelectorExpr:
					switch {
					case fun.Sel.Name == "Pick":
						t.Errorf("%s: calls Pick", at(x))
					case fun.Sel.Name == "Act" && (fn == nil || fn.Name.Name != "Act"):
						t.Errorf("%s: calls Act outside the client the driver sends through", at(x))
					case names(fun.X, "Emergence"):
						t.Errorf("%s: calls a method on the game's emergence", at(x))
					}
				}
			case *ast.AssignStmt:
				for _, l := range x.Lhs {
					writes(t, at(l), l)
				}
			case *ast.IncDecStmt:
				writes(t, at(x), x.X)
			}
			return true
		})
	}
	if !sawTurn {
		t.Error("emergence.go never asks the players' policies (agent.Script.TurnFor)")
	}
}

// writes fails an assignment to the played game, g, or through its
// emergence.
func writes(t *testing.T, at string, l ast.Expr) {
	t.Helper()
	if _, bare := l.(*ast.Ident); bare {
		return
	}
	if names(l, "Emergence") || root(l) == "g" {
		t.Errorf("%s: writes game state", at)
	}
}

// names reports whether an expression's selector chain passes through a
// field or package named sel.
func names(e ast.Expr, sel string) bool {
	found := false
	ast.Inspect(e, func(n ast.Node) bool {
		if s, ok := n.(*ast.SelectorExpr); ok && s.Sel.Name == sel {
			found = true
		}
		return !found
	})
	return found
}

// root is the identifier an expression's selectors and indexes hang from.
func root(e ast.Expr) string {
	for {
		switch x := e.(type) {
		case *ast.Ident:
			return x.Name
		case *ast.SelectorExpr:
			e = x.X
		case *ast.IndexExpr:
			e = x.X
		case *ast.StarExpr:
			e = x.X
		case *ast.ParenExpr:
			e = x.X
		default:
			return ""
		}
	}
}

// operatorConsts are the game's exported constants whose value is an
// operator command kind.
func operatorConsts(t *testing.T) map[string]bool {
	t.Helper()
	dir := filepath.Join(sheetfs.ModuleRoot(), "sim", "game")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	fset := token.NewFileSet()
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join(dir, e.Name()), nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range f.Decls {
			g, ok := d.(*ast.GenDecl)
			if !ok || g.Tok != token.CONST {
				continue
			}
			for _, spec := range g.Specs {
				vs := spec.(*ast.ValueSpec)
				for i, n := range vs.Names {
					if i >= len(vs.Values) || !n.IsExported() {
						continue
					}
					lit, ok := vs.Values[i].(*ast.BasicLit)
					if !ok || lit.Kind != token.STRING {
						continue
					}
					if s, err := strconv.Unquote(lit.Value); err == nil && game.Operator(s) {
						out[n.Name] = true
					}
				}
			}
		}
	}
	if len(out) == 0 {
		t.Fatal("found no operator kinds in sim/game")
	}
	return out
}

// TestEmergenceDeterministic plays one closed world twice: the same
// players, choices and clock give the same world.
func TestEmergenceDeterministic(t *testing.T) {
	if testing.Short() {
		t.Skip("plays two worlds of 100 players for 20 days")
	}
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	var digests []string
	for range 2 {
		w, err := playEmergence(b, "", 100, 20, false)
		if err != nil {
			t.Fatal(err)
		}
		if w.actions == 0 {
			t.Fatal("no player acted")
		}
		if w.operator != 0 || w.staged != 0 {
			t.Errorf("%d operator commands and %d staged facts in the closed world", w.operator, w.staged)
		}
		if len(w.audit) > 0 {
			t.Errorf("ledger: %v", w.audit)
		}
		digests = append(digests, w.digest)
	}
	if digests[0] != digests[1] {
		t.Errorf("two plays gave digests %s and %s", digests[0], digests[1])
	}
}

// TestEmergenceReportShape runs a tiny closed world through the whole run
// and checks the report has every section and the four readings.
func TestEmergenceReportShape(t *testing.T) {
	if testing.Short() {
		t.Skip("plays a small world")
	}
	b, err := sheetfs.LoadBook(sheetfs.ModuleRoot())
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	readings, err := emergenceRun(b, dir, emergencePlan{seeds: []string{""}, players: 30, days: 4})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, m := range readings {
		got = append(got, m.Target)
	}
	if want := []string{"emergence-loop", "promotion-each-type", "pairing-share-falls", "trace-cost-flat"}; !slices.Equal(got, want) {
		t.Errorf("readings %v, want %v", got, want)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "emergence.md"))
	if err != nil {
		t.Fatal(err)
	}
	doc := string(raw)
	for _, h := range []string{"# Emergence run", "## Readings", "## Pairing share after a variant", "## Trace cost", "## Seed \"\", 30 players",
		"### Promotions", "### The loop", "### Adaptation peaks", "### Measures", "### Ledger audit", "### Digest", "### Time"} {
		if !strings.Contains(doc, "\n"+h+"\n") && !strings.HasPrefix(doc, h+"\n") {
			t.Errorf("emergence.md has no %q", h)
		}
	}
	if strings.Contains(doc, "The timing failed") {
		t.Errorf("the trace cost was not timed:\n%s", doc)
	}
	for _, typ := range []string{"road", "camp", "haunt", "route", "style", "variant", "legend", "custom", "material", "class", "masters"} {
		if !strings.Contains(doc, "| "+typ+" | ") {
			t.Errorf("the promotions table has no %s row", typ)
		}
	}
}

// TestPairingCases holds pairing-share-falls to measuring only a region
// with wins on both sides of the variant.
func TestPairingCases(t *testing.T) {
	k := emerge.StyleKey{Region: 1, Style: "s"}
	const day = 20
	samples := func(before, after winDay) map[int64]winDay {
		m := map[int64]winDay{}
		for d := int64(day - pairingDays); d < day; d++ {
			m[d] = before
		}
		for d := int64(day + 1); d <= day+pairingDays; d++ {
			m[d] = after
		}
		return m
	}
	for _, tc := range []struct {
		name          string
		before, after winDay
		measured, ok  bool
		why           string
	}{
		{"fell", winDay{2, 4}, winDay{1, 4}, true, true, ""},
		{"rose", winDay{1, 4}, winDay{2, 4}, true, false, ""},
		{"none before", winDay{0, 0}, winDay{1, 4}, false, false, "no wins in the region before it"},
		{"none after", winDay{2, 4}, winDay{0, 0}, false, false, "no wins in the region after it"},
	} {
		w := emergenceWorld{
			variants: []variantSeen{{day: day, style: k, matched: true}},
			samples:  map[emerge.StyleKey]map[int64]winDay{k: samples(tc.before, tc.after)},
			lastDay:  day + pairingDays,
		}
		cs := pairingCases(w)
		if len(cs) != 1 {
			t.Fatalf("%s: %d cases, want 1", tc.name, len(cs))
		}
		c := cs[0]
		if c.measured != tc.measured || c.ok != tc.ok || c.why != tc.why {
			t.Errorf("%s: measured %v ok %v why %q, want %v %v %q", tc.name, c.measured, c.ok, c.why, tc.measured, tc.ok, tc.why)
		}
	}
}
