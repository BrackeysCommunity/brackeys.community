package gateway

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"jams.team/mmo-world/api"
)

// TestSlowSocket fills a socket's queue with nothing draining it: eight
// frames may wait, and the ninth closes the socket as slow.
func TestSlowSocket(t *testing.T) {
	made := make(chan *conn, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		c := &conn{ws: ws, out: make(chan frame, maxBehind), done: make(chan struct{})}
		made <- c
		<-c.done
	}))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	client, resp, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = client.CloseNow() }()
	c := <-made
	for i := range maxBehind {
		c.send(api.ServerMessage{T: api.FramePong, Seq: int64(i)})
	}
	if c.closing.Load() {
		t.Fatalf("a socket %d frames behind was dropped", maxBehind)
	}
	c.send(api.ServerMessage{T: api.FramePong, Seq: maxBehind})
	if !c.closing.Load() {
		t.Fatalf("a socket more than %d frames behind was kept", maxBehind)
	}
	_, _, err = client.Read(ctx)
	var ce websocket.CloseError
	if !errors.As(err, &ce) || ce.Code != closeBye || ce.Reason != api.ByeSlow {
		t.Fatalf("the slow socket ended with %v", err)
	}
	// Nothing more is queued for a socket on its way out.
	c.send(api.ServerMessage{T: api.FramePong})
	if len(c.out) != maxBehind {
		t.Fatalf("%d frames queued after the socket was dropped", len(c.out))
	}
}
