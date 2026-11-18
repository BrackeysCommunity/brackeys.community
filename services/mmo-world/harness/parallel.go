package harness

import (
	"os"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
)

// workers is how many worlds run at once: SPIKE_WORKERS, or one per
// core. Each world holds a few hundred MB; lower it when memory is short.
func workers() int {
	if v, err := strconv.Atoi(os.Getenv("SPIKE_WORKERS")); err == nil && v > 0 {
		return v
	}
	return runtime.NumCPU()
}

// runParallel runs f for 0..n-1 on workers() goroutines and returns the
// first error; no new work is handed out once one has failed.
func runParallel(n int, f func(i int) error) error {
	var wg sync.WaitGroup
	var failed atomic.Bool
	var once sync.Once
	var first error
	next := make(chan int)
	for range workers() {
		wg.Go(func() {
			for i := range next {
				if err := f(i); err != nil {
					once.Do(func() { first = err })
					failed.Store(true)
				}
			}
		})
	}
	for i := 0; i < n && !failed.Load(); i++ {
		next <- i
	}
	close(next)
	wg.Wait()
	return first
}
