// Command simlint runs the sim's rules: banned imports, no map range, no
// floats, no goroutines, no tuning literals, and exhaustive switches over
// enums and sealed interfaces. Run it as `go run ./cmd/simlint ./...`.
package main

import (
	"golang.org/x/tools/go/analysis/multichecker"

	"jams.team/mmo-world/lint"
)

func main() { multichecker.Main(lint.Analyzers()...) }
