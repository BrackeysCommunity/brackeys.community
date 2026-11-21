package gateway_test

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/gateway"
)

// structural: what the fake Discord knows.
const (
	testApp    = "1234567890"
	testSecret = "s3cret-of-the-application"
)

// fakeDiscord answers the two calls of the sign-in: a code for a token,
// and a token for the user it belongs to.
type fakeDiscord struct {
	mu    sync.Mutex
	codes map[string]string // code to Discord user
	forms []string
	srv   *httptest.Server
}

func newDiscord(t *testing.T, codes map[string]string) *fakeDiscord {
	d := &fakeDiscord{codes: codes}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth2/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		d.mu.Lock()
		d.forms = append(d.forms, r.PostForm.Encode())
		d.mu.Unlock()
		code := r.PostForm.Get("code")
		switch {
		case r.PostForm.Get("client_id") != testApp || r.PostForm.Get("client_secret") != testSecret || r.PostForm.Get("grant_type") != "authorization_code":
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = io.WriteString(w, `{"error":"invalid_client"}`)
		case code == "down":
			w.WriteHeader(http.StatusInternalServerError)
		case d.codes[code] == "":
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":"invalid_grant"}`)
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "tok-" + code, "token_type": "Bearer", "expires_in": 604800})
		}
	})
	mux.HandleFunc("GET /users/@me", func(w http.ResponseWriter, r *http.Request) {
		code, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer tok-")
		if !ok || d.codes[code] == "" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": d.codes[code], "username": "someone"})
	})
	d.srv = httptest.NewServer(mux)
	t.Cleanup(d.srv.Close)
	return d
}

// TestSignIn trades codes with a fake Discord: a good code maps the
// Discord user to their character and opens a socket; a refused code, a
// user with no character, an expired or forged session and the dev
// sign-in each get what the contract says, and no secret is logged.
func TestSignIn(t *testing.T) {
	w := newWorld(t)
	played := w.create("80351110224678912")
	discord := newDiscord(t, map[string]string{"good-code": "80351110224678912", "ghost-code": "999"})
	w.serve(func(c *gateway.Config) {
		c.Dev, c.AppID, c.ClientSecret, c.DiscordAPI = false, testApp, testSecret, discord.srv.URL+"/"
	})
	url := w.srv.URL + "/.proxy" + api.PathActivityToken

	var good api.TokenReply
	if status := post(t, url, api.TokenRequest{Code: "good-code"}, &good); status != http.StatusOK {
		t.Fatalf("a good code: %d", status)
	}
	if good.DiscordID != "80351110224678912" || good.CharacterID != played.C.ID || good.Session == "" ||
		good.Expires != w.clock.Now().Add(2*time.Hour).Unix() {
		t.Fatalf("a good code's session: %+v", good)
	}
	v := w.dial("/.proxy", nil)
	v.send(api.ClientMessage{T: "hello", Hello: &api.ClientHello{Session: good.Session, Instance: "i-1"}})
	if st := v.state(); st.Character.ID != played.C.ID || st.Context.Kind != "solo" || st.Context.ID != played.C.ID || st.Now != w.clock.Now().UnixMilli() {
		t.Fatalf("the signed-in viewer's state: %+v", st)
	}

	for _, tc := range []struct {
		name string
		body any
		want int
	}{
		{"a code Discord refuses", api.TokenRequest{Code: "stale-code"}, http.StatusUnauthorized},
		{"Discord failing", api.TokenRequest{Code: "down"}, http.StatusBadGateway},
		{"neither a code nor a name", api.TokenRequest{}, http.StatusBadRequest},
		{"both a code and a name", api.TokenRequest{Code: "good-code", Dev: "80351110224678912"}, http.StatusBadRequest},
		{"a field the request does not have", `{"code":"good-code","characterId":"c-1"}`, http.StatusBadRequest},
		{"no JSON", `code=good-code`, http.StatusBadRequest},
		{"a body past the cap", `{"code":"` + strings.Repeat("x", 5000) + `"}`, http.StatusBadRequest},
		{"dev sign-in where it is off", api.TokenRequest{Dev: "80351110224678912"}, http.StatusNotFound},
	} {
		if got := post(t, url, tc.body, nil); got != tc.want {
			t.Errorf("%s: %d, want %d", tc.name, got, tc.want)
		}
	}

	// A user with no character signs in, and is told so at the socket.
	var ghost api.TokenReply
	if status := post(t, url, api.TokenRequest{Code: "ghost-code"}, &ghost); status != http.StatusOK || ghost.DiscordID != "999" || ghost.CharacterID != "" || ghost.Session == "" {
		t.Fatalf("a user with no character: %d %+v", status, ghost)
	}
	v = w.dial("", nil)
	v.send(api.ClientMessage{T: "hello", Hello: &api.ClientHello{Session: ghost.Session, Instance: "i-1"}})
	if bye, code, reason := v.ended(); bye != "no-character" || code != 4001 || reason != "no-character" {
		t.Fatalf("a socket with no character: bye %q, close %d %q", bye, code, reason)
	}

	// A forged session: one bit off, another gateway's, and none at all.
	other := gateway.New(gateway.Config{Host: w, Dev: true, Clock: w.clock})
	t.Cleanup(other.Close)
	elsewhere := httptest.NewServer(other.Handler())
	t.Cleanup(elsewhere.Close)
	var foreign api.TokenReply
	post(t, elsewhere.URL+api.PathActivityToken, api.TokenRequest{Dev: "80351110224678912"}, &foreign)
	flipped := []byte(good.Session)
	flipped[len(flipped)-2] ^= 1
	for name, session := range map[string]string{"a flipped bit": string(flipped), "another gateway's": foreign.Session, "none": "", "not base64": "!!!"} {
		v = w.dial("", nil)
		v.send(api.ClientMessage{T: "hello", Hello: &api.ClientHello{Session: session, Instance: "i-1"}})
		if bye, _, _ := v.ended(); bye != "expired" {
			t.Errorf("a forged session (%s): bye %q", name, bye)
		}
	}

	// A session ends when its two hours do: a new socket is refused, and
	// the one opened with it is told to sign in again.
	open := w.dial("", nil)
	open.send(api.ClientMessage{T: "hello", Hello: &api.ClientHello{Session: good.Session, Instance: "i-2"}})
	open.state()
	w.clock.Advance(2*time.Hour - time.Second)
	open.quiet()
	w.clock.Advance(time.Second)
	if bye, _, _ := open.ended(); bye != "expired" {
		t.Fatalf("an open socket past its session: bye %q", bye)
	}
	v = w.dial("", nil)
	v.send(api.ClientMessage{T: "hello", Hello: &api.ClientHello{Session: good.Session, Instance: "i-1"}})
	if bye, _, _ := v.ended(); bye != "expired" {
		t.Fatalf("an expired session: bye %q", bye)
	}

	// Neither secret, code nor Discord's token reaches the log; the secret
	// went to Discord and nowhere else.
	logs := w.logs.String()
	for _, secret := range []string{testSecret, "good-code", "stale-code", "tok-", good.Session, ghost.Session} {
		if strings.Contains(logs, secret) {
			t.Errorf("the log holds %q:\n%s", secret, logs)
		}
	}
	discord.mu.Lock()
	defer discord.mu.Unlock()
	if len(discord.forms) != 4 || !strings.Contains(discord.forms[0], "client_secret="+testSecret) || !strings.Contains(discord.forms[0], "code=good-code") {
		t.Fatalf("what Discord was sent: %v", discord.forms)
	}
}

// TestSignInFlood stops trading codes with Discord past a few a second,
// and takes them again the second after.
func TestSignInFlood(t *testing.T) {
	w := newWorld(t)
	discord := newDiscord(t, map[string]string{"good-code": "999"})
	w.serve(func(c *gateway.Config) {
		c.Dev, c.AppID, c.ClientSecret, c.DiscordAPI = false, testApp, testSecret, discord.srv.URL
	})
	url := w.srv.URL + api.PathActivityToken
	sent := func() int {
		discord.mu.Lock()
		defer discord.mu.Unlock()
		return len(discord.forms)
	}
	var busy int
	for range 25 {
		if post(t, url, api.TokenRequest{Code: "stale-code"}, nil) == http.StatusTooManyRequests {
			busy++
		}
	}
	if reached := sent(); busy != 25-reached || reached == 0 || reached > 10 {
		t.Fatalf("of 25 codes in a second, %d were turned away and %d reached Discord", busy, reached)
	}
	w.clock.Advance(time.Second)
	if got := post(t, url, api.TokenRequest{Code: "good-code"}, nil); got != http.StatusOK {
		t.Fatalf("a code the second after a flood: %d", got)
	}
}

// TestDevSignIn names a Discord user outright where dev sign-in is on,
// and finds no Discord sign-in where none is set up.
func TestDevSignIn(t *testing.T) {
	w := newWorld(t)
	played := w.create("u-dev")
	w.serve(nil)
	url := w.srv.URL + api.PathActivityToken
	if got := w.signIn("u-dev"); got.DiscordID != "u-dev" || got.CharacterID != played.C.ID {
		t.Fatalf("dev sign-in: %+v", got)
	}
	if got := w.signIn("u-nobody"); got.CharacterID != "" || got.Session == "" {
		t.Fatalf("dev sign-in of a user with no character: %+v", got)
	}
	if got := post(t, url, api.TokenRequest{Dev: "no spaces"}, nil); got != http.StatusBadRequest {
		t.Fatalf("a name that is no Discord user: %d", got)
	}
	if got := post(t, url, api.TokenRequest{Code: "any-code"}, nil); got != http.StatusServiceUnavailable {
		t.Fatalf("a code where Discord is not set up: %d", got)
	}
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("reading the token path: %d", resp.StatusCode)
	}
}
