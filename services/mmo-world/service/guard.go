package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"sync"
	"sync/atomic"

	"github.com/jackc/pgx/v5/pgxpool"

	"jams.team/mmo-world/store"
)

// Guard is the writer under the service's logs: a line that would carry
// a key in any of its text forms has it replaced before it is written,
// and is counted.
type Guard struct {
	mu      sync.Mutex
	w       io.Writer
	needles [][]byte
	Leaks   atomic.Int64
}

func NewGuard(w io.Writer) *Guard { return &Guard{w: w} }

// Arm sets the forms to look for, once the keys are known.
func (g *Guard) Arm(needles []string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.needles = g.needles[:0]
	for _, n := range needles {
		g.needles = append(g.needles, []byte(n))
	}
}

var redacted = []byte("[redacted]")

func (g *Guard) Write(p []byte) (int, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := p
	for _, n := range g.needles {
		if bytes.Contains(out, n) {
			out = bytes.ReplaceAll(out, n, redacted)
			g.Leaks.Add(1)
		}
	}
	if _, err := g.w.Write(out); err != nil {
		return 0, err
	}
	return len(p), nil
}

// CheckKeys is the start-up check that no key is in the database or the
// logs: it scans every mmo table for each needle, and proves the guard by
// writing a needle through a copy of it that writes nowhere.
func CheckKeys(ctx context.Context, pool *pgxpool.Pool, needles []string) error {
	hits, err := store.FindText(ctx, pool, needles)
	if err != nil {
		return err
	}
	if len(hits) > 0 {
		return fmt.Errorf("service: a key is in the database: %v", hits)
	}
	var sink bytes.Buffer
	probe := NewGuard(&sink)
	probe.Arm(needles)
	for _, n := range needles {
		if _, err := fmt.Fprintf(probe, "probe %s\n", n); err != nil {
			return err
		}
	}
	for _, n := range needles {
		if bytes.Contains(sink.Bytes(), []byte(n)) {
			return fmt.Errorf("service: the log guard let a key through")
		}
	}
	return nil
}
