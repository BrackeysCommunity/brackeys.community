package service

import "sync"

// bounded is a map that keeps at most keep entries, oldest dropped first.
type bounded[K comparable, V any] struct {
	mu    sync.Mutex
	keep  int
	m     map[K]V
	order []K
}

func (b *bounded[K, V]) get(k K) (V, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	v, ok := b.m[k]
	return v, ok
}

// add puts v under k unless k is held; it reports whether k was new.
func (b *bounded[K, V]) add(k K, v V) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.m == nil {
		b.m = map[K]V{}
	}
	if _, ok := b.m[k]; ok {
		return false
	}
	keep := b.keep
	if keep == 0 {
		keep = mediaKept
	}
	b.m[k] = v
	b.order = append(b.order, k)
	if len(b.order) > keep {
		delete(b.m, b.order[0])
		b.order = b.order[1:]
	}
	return true
}
