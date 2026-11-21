// Package envvar reads settings from the environment, for the service and
// the Activity's gateway alike.
package envvar

import (
	"fmt"
	"os"
	"strconv"
)

// Get reads a variable with a fallback.
func Get(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

// Number reads a whole-number variable with a fallback, within [lo, hi].
func Number(name, fallback string, lo, hi int64) (int64, error) {
	n, err := strconv.ParseInt(Get(name, fallback), 10, 64)
	if err != nil || n < lo || n > hi {
		return 0, fmt.Errorf("%s must be a whole number from %d to %d", name, lo, hi)
	}
	return n, nil
}
