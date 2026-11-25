package service_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/sim/game"
)

// TestHouseKindsMatchRules: the API and the rules count the same kinds as
// house kinds, over every Act and Op kind the API declares.
func TestHouseKindsMatchRules(t *testing.T) {
	entries, err := os.ReadDir("../api")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	var kinds []string
	for _, e := range entries {
		file := e.Name()
		if e.IsDir() || !strings.HasSuffix(file, ".go") || strings.HasSuffix(file, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, filepath.Join("../api", file), nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, decl := range f.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, spec := range gen.Specs {
				vs := spec.(*ast.ValueSpec)
				for i, name := range vs.Names {
					if i >= len(vs.Values) || !strings.HasPrefix(name.Name, "Act") && !strings.HasPrefix(name.Name, "Op") {
						continue
					}
					lit, ok := vs.Values[i].(*ast.BasicLit)
					if !ok || lit.Kind != token.STRING {
						continue
					}
					v, err := strconv.Unquote(lit.Value)
					if err != nil {
						t.Fatal(err)
					}
					kinds = append(kinds, v)
				}
			}
		}
	}
	houses := 0
	for _, kind := range kinds {
		if api.HouseKind(kind) != game.HouseKind(kind) {
			t.Errorf("the API and the rules disagree whether %q is a house kind", kind)
		}
		if api.HouseKind(kind) {
			houses++
		}
	}
	if houses != 6 {
		t.Errorf("found %d house kinds among %d API kinds, want 6", houses, len(kinds))
	}
}
