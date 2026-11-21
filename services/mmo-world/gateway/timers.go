package gateway

import (
	"context"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"jams.team/mmo-world/api"
)

// Timers is the pick-window clock (GDD 7.5): when a party's beat or fork
// window runs out it sends party-window, and whoever has not chosen takes
// the cautious choice. It runs whether or not the Activity is served, so
// a party playing only in chat is timed too. Its timers are rebuilt from
// the host's open windows at start and at every notice, so a restart
// loses none.
type Timers struct {
	h     Host
	clock Clock
	log   *slog.Logger

	ctx    context.Context
	cancel context.CancelFunc
	idle   chan struct{}
	busy   sync.WaitGroup // windows being ended

	mu      sync.Mutex
	closed  bool
	windows map[string]*pickTimer // by shared encounter

	nmu     sync.Mutex
	settled *sync.Cond
	queued  int64
	handled int64
	wake    chan struct{}
}

// pickTimer is the timer that ends one window.
type pickTimer struct {
	w    api.OpenWindow
	stop func()
}

// StartTimers reads the windows open and sets their timers, then follows
// the world's changes; a nil clock is the real one.
func StartTimers(ctx context.Context, h Host, c Clock, log *slog.Logger) (*Timers, error) {
	if c == nil {
		c = wall{}
	}
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	t := &Timers{h: h, clock: c, log: log, idle: make(chan struct{}), windows: map[string]*pickTimer{}, wake: make(chan struct{}, 1)}
	t.settled = sync.NewCond(&t.nmu)
	t.ctx, t.cancel = context.WithCancel(context.Background())
	// Following first, so a window opened while the list is read is not
	// missed.
	h.Subscribe(t.changed)
	list, err := h.Windows(ctx)
	if err != nil {
		t.cancel()
		close(t.idle)
		return nil, err
	}
	t.set(list)
	go t.work()
	return t, nil
}

// Close stops every timer; call it before the world is released.
func (t *Timers) Close() {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return
	}
	t.closed = true
	for id, pt := range t.windows {
		pt.stop()
		delete(t.windows, id)
	}
	t.mu.Unlock()
	t.busy.Wait()
	t.cancel()
	<-t.idle
}

// changed is the host's notice, taken with the world held: a note and a
// wake, nothing more.
func (t *Timers) changed([]string) {
	if t.ctx.Err() != nil {
		return
	}
	t.nmu.Lock()
	t.queued++
	t.nmu.Unlock()
	select {
	case t.wake <- struct{}{}:
	default:
	}
}

func (t *Timers) work() {
	defer close(t.idle)
	for {
		select {
		case <-t.ctx.Done():
			return
		case <-t.wake:
		}
		t.nmu.Lock()
		upTo := t.queued
		t.nmu.Unlock()
		t.rebuild()
		t.nmu.Lock()
		t.handled = upTo
		t.settled.Broadcast()
		t.nmu.Unlock()
	}
}

// settle waits until every notice so far has been acted on.
func (t *Timers) settle() {
	t.nmu.Lock()
	defer t.nmu.Unlock()
	for t.handled != t.queued {
		t.settled.Wait()
	}
}

// rebuild sets the timers from the host's windows. A window a pick in
// chat opened is a write like any other, so every notice reads them, not
// only a tick's.
func (t *Timers) rebuild() {
	ctx, cancel := context.WithTimeout(t.ctx, hostWait)
	defer cancel()
	list, err := t.h.Windows(ctx)
	if err != nil {
		if t.ctx.Err() == nil {
			t.log.Error("pick windows: reading the windows open", "err", err.Error())
		}
		return
	}
	t.set(list)
}

// set keeps a timer for each window listed and none for any other.
func (t *Timers) set(list []api.OpenWindow) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return
	}
	open := map[string]bool{}
	for _, w := range list {
		open[w.Shared] = true
		if pt := t.windows[w.Shared]; pt != nil {
			if pt.w == w {
				continue
			}
			pt.stop()
		}
		t.arm(w, t.until(w.Due))
	}
	for id, pt := range t.windows {
		if !open[id] {
			pt.stop()
			delete(t.windows, id)
		}
	}
}

// until is how long until a window's due, and the slack after it that
// makes sure the host's clock has passed it too.
func (t *Timers) until(due int64) time.Duration {
	return max(0, time.UnixMilli(due).Sub(t.clock.Now())+expirySlack)
}

// arm sets a window's timer under the lock.
func (t *Timers) arm(w api.OpenWindow, wait time.Duration) {
	pt := &pickTimer{w: w}
	t.windows[w.Shared] = pt
	pt.stop = t.clock.AfterFunc(wait, func() { t.fire(pt) })
}

// again sets a window's timer once more, unless another has replaced it.
func (t *Timers) again(pt *pickTimer, w api.OpenWindow, wait time.Duration) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.closed && t.windows[pt.w.Shared] == pt {
		t.arm(w, wait)
	}
}

// done forgets a window's timer, unless another has replaced it.
func (t *Timers) done(pt *pickTimer) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.windows[pt.w.Shared] == pt {
		delete(t.windows, pt.w.Shared)
	}
}

// fire ends a window that ran out, after reading it again: a window that
// moved or closed meanwhile is followed, not ended.
func (t *Timers) fire(pt *pickTimer) {
	t.mu.Lock()
	current := !t.closed && t.windows[pt.w.Shared] == pt
	if current {
		t.busy.Add(1)
	}
	t.mu.Unlock()
	if !current {
		return
	}
	defer t.busy.Done()
	ctx, cancel := context.WithTimeout(t.ctx, hostWait)
	defer cancel()
	w, ok, err := t.h.Window(ctx, pt.w.Shared)
	if err != nil {
		t.log.Error("pick windows: reading a window", "shared", pt.w.Shared, "err", err.Error())
		t.again(pt, pt.w, retryWait)
		return
	}
	if !ok {
		t.done(pt)
		return
	}
	if w != pt.w || t.clock.Now().UnixMilli() < w.Due {
		t.again(pt, w, t.until(w.Due))
		return
	}
	req := api.ActionRequest{InteractionID: windowKey(w), CharacterID: w.Character, Kind: api.ActPartyWindow, Target: w.Shared}
	_, ref, err := t.h.Act(ctx, req, false)
	switch {
	case err != nil:
		t.log.Error("pick windows: ending a window", "shared", w.Shared, "err", err.Error())
		t.again(pt, w, retryWait)
	case ref == nil:
		t.done(pt)
	case ref.Code == api.CodeNotDue:
		t.again(pt, w, max(t.until(w.Due), retryWait))
	case ref.Code == api.CodeMachineArmed:
		// The window waits while the machine runs.
		t.again(pt, w, retryWait)
	default:
		t.log.Warn("pick windows: a window's end was refused", "shared", w.Shared, "code", ref.Code)
		t.done(pt)
	}
}

// windowKey is the idempotency key of the write that ends a window.
func windowKey(w api.OpenWindow) string {
	return "pw-" + w.Shared + "-" + strconv.FormatInt(w.Opened, 10)
}
