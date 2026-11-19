package service

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Events sends product events to PostHog's batch endpoint. With no key it
// sends nothing; a full queue drops events rather than slow a tick.
type Events struct {
	host, key string
	client    *http.Client
	log       *slog.Logger
	mu        sync.RWMutex // guards closed against a Capture racing Close
	closed    bool
	queue     chan event
	done      chan struct{}
}

type event struct {
	Event      string         `json:"event"`
	DistinctID string         `json:"distinct_id"`
	Properties map[string]any `json:"properties"`
	Timestamp  time.Time      `json:"timestamp"`
}

// structural: queue and batch sizes, and how long a batch waits to fill.
const (
	eventQueue = 1024
	eventBatch = 100
	eventWait  = 5 * time.Second
)

// NewEvents sends to PostHog at host; an empty key sends nothing.
func NewEvents(host, key string, log *slog.Logger) *Events {
	e := &Events{host: strings.TrimRight(host, "/"), key: key, client: &http.Client{Timeout: 10 * time.Second}, log: log,
		queue: make(chan event, eventQueue), done: make(chan struct{})}
	if key == "" {
		close(e.done)
		return e
	}
	go e.run()
	return e
}

// Capture queues an event. Properties carry ids, never a Discord id.
// After Close it drops the event.
func (e *Events) Capture(name, distinct string, props map[string]any) {
	if e == nil || e.key == "" {
		return
	}
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.closed {
		return
	}
	select {
	case e.queue <- event{Event: name, DistinctID: distinct, Properties: props, Timestamp: time.Now().UTC()}:
	default:
	}
}

// Close sends what is queued and stops.
func (e *Events) Close() {
	if e == nil || e.key == "" {
		return
	}
	e.mu.Lock()
	if !e.closed {
		e.closed = true
		close(e.queue)
	}
	e.mu.Unlock()
	<-e.done
}

func (e *Events) run() {
	defer close(e.done)
	var batch []event
	timer := time.NewTimer(eventWait)
	flush := func() {
		if len(batch) > 0 {
			e.send(batch)
			batch = nil
		}
	}
	for {
		select {
		case ev, ok := <-e.queue:
			if !ok {
				flush()
				return
			}
			if batch = append(batch, ev); len(batch) >= eventBatch {
				flush()
			}
		case <-timer.C:
			flush()
			timer.Reset(eventWait)
		}
	}
}

func (e *Events) send(batch []event) {
	body, err := json.Marshal(map[string]any{"api_key": e.key, "batch": batch})
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), e.client.Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.host+"/batch/", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		e.log.Warn("posthog send failed", "err", err.Error(), "events", len(batch))
		return
	}
	_ = resp.Body.Close()
	if resp.StatusCode >= http.StatusBadRequest {
		e.log.Warn("posthog refused a batch", "status", resp.StatusCode, "events", len(batch))
	}
}
