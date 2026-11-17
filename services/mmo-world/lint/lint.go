// Package lint holds the checks that keep sim/ deterministic and free of
// tuning numbers. They apply to non-test files of packages under SimPrefix.
package lint

import (
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"
	"strconv"
	"strings"

	gochecksumtype "github.com/alecthomas/go-check-sumtype"
	"github.com/nishanths/exhaustive/passes/exhaustive"
	"golang.org/x/tools/go/analysis"
)

// SimPrefix is the import path the sim rules apply under.
const SimPrefix = "jams.team/mmo-world/sim"

const module = "jams.team/mmo-world"

func inSim(pass *analysis.Pass) bool {
	p := pass.Pkg.Path()
	if strings.HasSuffix(p, ".test") {
		return false
	}
	return p == SimPrefix || strings.HasPrefix(p, SimPrefix+"/")
}

// simFiles are the package's non-test files, or none outside sim/.
func simFiles(pass *analysis.Pass) []*ast.File {
	if !inSim(pass) {
		return nil
	}
	var out []*ast.File
	for _, f := range pass.Files {
		if !strings.HasSuffix(pass.Fset.Position(f.Pos()).Filename, "_test.go") {
			out = append(out, f)
		}
	}
	return out
}

// Banned lists import paths sim/ may not use, by prefix. Anything outside
// the standard library and sim/ itself is refused too.
var Banned = []string{
	"net", "os", "database/sql", "time", "math/rand", "sync", "syscall",
	"unsafe", "io/ioutil", "log", "runtime", "plugin", "crypto/rand",
	"embed", "path/filepath", "io/fs", "context", "testing",
}

var Imports = &analysis.Analyzer{
	Name: "simimports",
	Doc:  "sim/ imports no I/O, clock, randomness or concurrency, and nothing outside the standard library and sim/",
	Run: func(pass *analysis.Pass) (any, error) {
		for _, f := range simFiles(pass) {
			for _, imp := range f.Imports {
				path, _ := strconv.Unquote(imp.Path.Value)
				if reason := bannedImport(path); reason != "" {
					pass.Reportf(imp.Pos(), "sim/ may not import %q: %s", path, reason)
				}
			}
		}
		return nil, nil
	},
}

func bannedImport(path string) string {
	for _, b := range Banned {
		if path == b || strings.HasPrefix(path, b+"/") {
			return "I/O, clock, randomness and concurrency stay outside the sim"
		}
	}
	first, _, _ := strings.Cut(path, "/")
	if strings.Contains(first, ".") && path != SimPrefix && !strings.HasPrefix(path, SimPrefix+"/") {
		if strings.HasPrefix(path, module+"/") {
			return "the sim depends on nothing else in the module"
		}
		return "the sim uses the standard library only"
	}
	return ""
}

var MapRange = &analysis.Analyzer{
	Name: "maprange",
	Doc:  "no range over a map, or over an unsorted maps.Keys, maps.Values or maps.All, in sim/",
	Run: func(pass *analysis.Pass) (any, error) {
		for _, f := range simFiles(pass) {
			ast.Inspect(f, func(n ast.Node) bool {
				switch n := n.(type) {
				case *ast.RangeStmt:
					if _, ok := pass.TypesInfo.TypeOf(n.X).Underlying().(*types.Map); ok {
						pass.Reportf(n.Pos(), "range over a map: iteration order is random; range over sorted keys")
					}
					if isMapsIter(pass, n.X) {
						pass.Reportf(n.Pos(), "range over a maps iterator: order is random; use slices.Sorted(maps.Keys(m))")
					}
				case *ast.CallExpr:
					if isPkgFunc(pass, n.Fun, "slices", "Sorted", "SortedFunc", "SortedStableFunc") {
						return false
					}
					if isPkgFunc(pass, n.Fun, "slices", "Collect", "AppendSeq") && len(n.Args) > 0 && isMapsIter(pass, n.Args[len(n.Args)-1]) {
						pass.Reportf(n.Pos(), "collecting a maps iterator keeps its random order; use slices.Sorted")
					}
				}
				return true
			})
		}
		return nil, nil
	},
}

func isMapsIter(pass *analysis.Pass, e ast.Expr) bool {
	call, ok := ast.Unparen(e).(*ast.CallExpr)
	return ok && isPkgFunc(pass, call.Fun, "maps", "Keys", "Values", "All")
}

func isPkgFunc(pass *analysis.Pass, fun ast.Expr, pkg string, names ...string) bool {
	sel, ok := ast.Unparen(fun).(*ast.SelectorExpr)
	if !ok {
		return false
	}
	obj, ok := pass.TypesInfo.Uses[sel.Sel].(*types.Func)
	if !ok || obj.Pkg() == nil || obj.Pkg().Path() != pkg {
		return false
	}
	for _, n := range names {
		if obj.Name() == n {
			return true
		}
	}
	return false
}

var NoFloat = &analysis.Analyzer{
	Name: "nofloat",
	Doc:  "no floating point in sim/; use fixed.F",
	Run: func(pass *analysis.Pass) (any, error) {
		for _, f := range simFiles(pass) {
			ast.Inspect(f, func(n ast.Node) bool {
				e, ok := n.(ast.Expr)
				if !ok {
					return true
				}
				if lit, ok := e.(*ast.BasicLit); ok && (lit.Kind == token.FLOAT || lit.Kind == token.IMAG) {
					pass.Reportf(lit.Pos(), "float literal in sim/")
					return true
				}
				if tv, ok := pass.TypesInfo.Types[e]; ok && isFloat(tv.Type) {
					if _, ident := e.(*ast.Ident); ident || tv.IsType() {
						pass.Reportf(e.Pos(), "float type in sim/: use fixed.F")
					}
				}
				return true
			})
		}
		return nil, nil
	},
}

func isFloat(t types.Type) bool {
	if t == nil {
		return false
	}
	b, ok := t.Underlying().(*types.Basic)
	return ok && b.Info()&(types.IsFloat|types.IsComplex) != 0
}

var NoGoroutine = &analysis.Analyzer{
	Name: "nogoroutine",
	Doc:  "no goroutines, channels or select in sim/; a world runs on one goroutine",
	Run: func(pass *analysis.Pass) (any, error) {
		for _, f := range simFiles(pass) {
			ast.Inspect(f, func(n ast.Node) bool {
				switch n.(type) {
				case *ast.GoStmt:
					pass.Reportf(n.Pos(), "go statement in sim/")
				case *ast.SelectStmt:
					pass.Reportf(n.Pos(), "select in sim/")
				case *ast.ChanType:
					pass.Reportf(n.Pos(), "channel in sim/")
				}
				return true
			})
		}
		return nil, nil
	},
}

// NoLiterals fails a number written into sim/ code. Tuning numbers live in
// the sheets. 0 and 1 are allowed; so are constants whose declaration says
// "structural:" in its comment, for numbers that are part of a format
// rather than of the balance (the fixed-point scale, a hash width).
var NoLiterals = &analysis.Analyzer{
	Name: "noliterals",
	Doc:  "no tuning numbers in sim/: 0 and 1, or a const marked structural, only",
	Run: func(pass *analysis.Pass) (any, error) {
		for _, f := range simFiles(pass) {
			allowed := structuralRanges(f)
			ast.Inspect(f, func(n ast.Node) bool {
				lit, ok := n.(*ast.BasicLit)
				if !ok || (lit.Kind != token.INT && lit.Kind != token.FLOAT) {
					return true
				}
				for _, r := range allowed {
					if lit.Pos() >= r[0] && lit.End() <= r[1] {
						return true
					}
				}
				v := constant.MakeFromLiteral(lit.Value, lit.Kind, 0)
				if v.Kind() == constant.Int {
					if n, exact := constant.Int64Val(v); exact && (n == 0 || n == 1) {
						return true
					}
				}
				pass.Reportf(lit.Pos(), "number %s in sim/: put it in a sheet, or in a const marked structural if it is not tuning", lit.Value)
				return true
			})
		}
		return nil, nil
	},
}

func structuralRanges(f *ast.File) [][2]token.Pos {
	var out [][2]token.Pos
	marked := func(groups ...*ast.CommentGroup) bool {
		for _, g := range groups {
			if g != nil && strings.HasPrefix(strings.TrimSpace(g.Text()), "structural:") {
				return true
			}
		}
		return false
	}
	for _, d := range f.Decls {
		gd, ok := d.(*ast.GenDecl)
		if !ok || gd.Tok != token.CONST {
			continue
		}
		if marked(gd.Doc) {
			out = append(out, [2]token.Pos{gd.Pos(), gd.End()})
			continue
		}
		for _, s := range gd.Specs {
			vs := s.(*ast.ValueSpec)
			if marked(vs.Doc, vs.Comment) {
				out = append(out, [2]token.Pos{vs.Pos(), vs.End()})
			}
		}
	}
	return out
}

// Exhaustive is configured so a default case does not excuse a missing
// one. It checks the module's own enums; the standard library's kinds
// (reflect.Kind, token.Token) are switched over partially on purpose.
func Exhaustive() *analysis.Analyzer {
	a := exhaustive.Analyzer
	for _, kv := range [][2]string{
		{"d", "false"},
		{"typeonly", `^jams\.team/`},
	} {
		if err := a.Flags.Set(kv[0], kv[1]); err != nil {
			panic(err)
		}
	}
	return a
}

// Analyzers is everything simlint runs.
func Analyzers() []*analysis.Analyzer {
	return []*analysis.Analyzer{Imports, MapRange, NoFloat, NoGoroutine, NoLiterals, Exhaustive(), gochecksumtype.Analyzer}
}
