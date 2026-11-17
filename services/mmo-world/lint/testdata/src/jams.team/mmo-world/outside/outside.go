// Package outside is not under sim/, so only exhaustiveness applies.
package outside

import (
	"os"
	"time"
)

func Free(m map[string]int) float64 {
	go func() {}()
	for range m {
	}
	_ = os.Getenv("X")
	return float64(time.Now().Unix()) * 1.5
}
