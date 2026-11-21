package gateway

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// structural: the most of a Discord answer that is read.
const maxDiscordBody = 64 << 10

// errRefused is Discord turning a sign-in down, as against not answering.
var errRefused = errors.New("gateway: Discord refused the sign-in")

// mint makes a session token for a Discord user: who, until when, and a
// signature under the gateway's own key. No table holds it; a restart
// makes a new key, and every client signs in again.
func (g *Gateway) mint(discord string) (string, int64) {
	expires := g.clock.Now().Add(sessionLife).Unix()
	payload := discord + "." + strconv.FormatInt(expires, 10)
	return base64.RawURLEncoding.EncodeToString(append([]byte(payload+"."), g.sign(payload)...)), expires
}

func (g *Gateway) sign(payload string) []byte {
	mac := hmac.New(sha256.New, g.key)
	mac.Write([]byte(payload))
	return mac.Sum(nil)
}

// verify reads a session token: the Discord user it was minted for and
// when it ends, or false for one that is forged, malformed or past.
func (g *Gateway) verify(token string) (discord string, expires int64, ok bool) {
	raw, err := base64.RawURLEncoding.DecodeString(token)
	cut := len(raw) - sha256.Size
	if err != nil || cut < 2 || raw[cut-1] != '.' {
		return "", 0, false
	}
	payload := string(raw[:cut-1])
	if !hmac.Equal(raw[cut:], g.sign(payload)) {
		return "", 0, false
	}
	dot := strings.LastIndexByte(payload, '.')
	if dot <= 0 {
		return "", 0, false
	}
	expires, err = strconv.ParseInt(payload[dot+1:], 10, 64)
	if err != nil || g.clock.Now().Unix() >= expires {
		return "", 0, false
	}
	return payload[:dot], expires, true
}

// exchange trades an authorize code for the id of the Discord user who
// signed in. The code, the secret and Discord's token never reach a log.
func (g *Gateway) exchange(ctx context.Context, code string) (string, error) {
	form := url.Values{"client_id": {g.cfg.AppID}, "client_secret": {g.cfg.ClientSecret}, "grant_type": {"authorization_code"}, "code": {code}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, g.discord+"/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	var granted struct {
		AccessToken string `json:"access_token"`
	}
	if err := g.ask(req, &granted); err != nil {
		return "", err
	}
	if granted.AccessToken == "" {
		return "", errRefused
	}
	req, err = http.NewRequestWithContext(ctx, http.MethodGet, g.discord+"/users/@me", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+granted.AccessToken)
	var me struct {
		ID string `json:"id"`
	}
	if err := g.ask(req, &me); err != nil {
		return "", err
	}
	if !named(me.ID) {
		return "", errors.New("gateway: Discord named no user")
	}
	return me.ID, nil
}

// ask sends one request to Discord and reads its JSON answer. An answer
// that turns the request down is errRefused; anything else that is not a
// plain success is Discord failing.
func (g *Gateway) ask(req *http.Request, into any) error {
	resp, err := g.client.Do(req)
	if err != nil {
		// The error names the URL, which carries no secret.
		return fmt.Errorf("gateway: Discord did not answer: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxDiscordBody))
	switch {
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= http.StatusInternalServerError:
		return fmt.Errorf("gateway: Discord answered %d", resp.StatusCode)
	case resp.StatusCode >= http.StatusBadRequest:
		return errRefused
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("gateway: Discord answered %d", resp.StatusCode)
	case err != nil:
		return err
	}
	return json.Unmarshal(body, into)
}
