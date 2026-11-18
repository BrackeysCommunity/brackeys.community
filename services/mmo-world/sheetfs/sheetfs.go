// Package sheetfs reads the sheet files from disk; sim/sheets loads them.
package sheetfs

import (
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"

	"jams.team/mmo-world/sim/sheets"
)

// ModuleRoot finds services/mmo-world from the working directory or from
// this source file, so tests and the CLI agree.
func ModuleRoot() string {
	if wd, err := os.Getwd(); err == nil {
		for d := wd; d != filepath.Dir(d); d = filepath.Dir(d) {
			if b, err := os.ReadFile(filepath.Join(d, "go.mod")); err == nil && strings.Contains(string(b), "module jams.team/mmo-world") {
				return d
			}
		}
	}
	_, file, _, _ := runtime.Caller(0)
	return filepath.Dir(filepath.Dir(file))
}

// SheetDirs are where sheet files live under the module root.
var SheetDirs = []string{"sheets", "packs"}

// SchemaDir holds the generated schemas.
const SchemaDir = "sheets/schema"

// ReadSheetFiles returns every sheet file under the module root, sorted by
// path, skipping the schemas.
func ReadSheetFiles(root string) ([]sheets.File, error) {
	var out []sheets.File
	for _, dir := range SheetDirs {
		err := filepath.WalkDir(filepath.Join(root, dir), func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() && filepath.Join(root, SchemaDir) == p {
				return filepath.SkipDir
			}
			if d.IsDir() || !strings.HasSuffix(p, ".json") {
				return nil
			}
			b, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			rel, _ := filepath.Rel(root, p)
			out = append(out, sheets.File{Path: filepath.ToSlash(rel), Data: b})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	slices.SortFunc(out, func(a, b sheets.File) int { return strings.Compare(a.Path, b.Path) })
	return out, nil
}

// LoadBook reads and loads every sheet.
func LoadBook(root string) (*sheets.Book, error) {
	files, err := ReadSheetFiles(root)
	if err != nil {
		return nil, err
	}
	return sheets.Load(files)
}
