package service

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"jams.team/mmo-world/api"
)

// structural: the tick ring keeps the last ticks' timings, a little over
// four weeks of production ticks and three and a half hours of local ones.
const tickRingSize = 4096

// tickRing is the last ticks' timings in memory, for load reads and the
// operator; nothing about it is stored.
type tickRing struct {
	mu   sync.Mutex
	buf  [tickRingSize]api.TickTime
	next int // where the next timing goes
	n    int // how many the ring holds
}

func (r *tickRing) add(t api.TickTime) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buf[r.next] = t
	r.next = (r.next + 1) % tickRingSize
	r.n = min(r.n+1, tickRingSize)
}

// after is the timings of ticks after tick, oldest first.
func (r *tickRing) after(tick int64) []api.TickTime {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []api.TickTime{}
	for i := range r.n {
		t := r.buf[(r.next-r.n+i+tickRingSize)%tickRingSize]
		if t.Tick > tick {
			out = append(out, t)
		}
	}
	return out
}

// operatorTicks is the ring's timings after a tick, with the tick they are
// read against.
func (s *Server) operatorTicks(w http.ResponseWriter, r *http.Request) {
	after := int64(-1)
	if q := r.URL.Query().Get("after"); q != "" {
		n, err := strconv.ParseInt(q, 10, 64)
		if err != nil {
			refuse(w, http.StatusBadRequest, api.Refusal{Code: api.CodeBadJSON, Message: "after is a tick"})
			return
		}
		after = n
	}
	reply(w, http.StatusOK, api.TickTimes{TickMs: (time.Duration(s.cfg.TickSeconds) * time.Second).Milliseconds(), Ticks: s.ticks.after(after)})
}
