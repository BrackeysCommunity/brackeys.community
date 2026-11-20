// Package client is a typed client of the world service's API.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"jams.team/mmo-world/api"
)

// HTTP calls the world service's API.
type HTTP struct {
	Base, Token string
	C           *http.Client
	Poll        time.Duration // how often WaitHealth asks
}

// New is a client of the service at base, sending token.
func New(base, token string) *HTTP {
	return &HTTP{Base: base, Token: token, C: &http.Client{Timeout: 30 * time.Second}, Poll: defaultPoll}
}

// Do sends one request and decodes a 2xx body into out; any other status
// with a refusal body comes back as the refusal.
func (h *HTTP) Do(ctx context.Context, method, path string, in, out any) (*api.Refusal, error) {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, h.Base+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if h.Token != "" {
		req.Header.Set("Authorization", "Bearer "+h.Token)
	}
	resp, err := h.C.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= http.StatusInternalServerError {
		return nil, fmt.Errorf("%s %s: %d %s", method, path, resp.StatusCode, raw)
	}
	if resp.StatusCode >= http.StatusBadRequest {
		var ref api.Refusal
		if err := json.Unmarshal(raw, &ref); err != nil {
			return nil, fmt.Errorf("%s %s: %d %s", method, path, resp.StatusCode, raw)
		}
		return &ref, nil
	}
	if out != nil {
		return nil, json.Unmarshal(raw, out)
	}
	return nil, nil
}

func (h *HTTP) Act(ctx context.Context, req api.ActionRequest) (api.ActionReply, *api.Refusal, error) {
	var out api.ActionReply
	ref, err := h.Do(ctx, http.MethodPost, api.PathActions, req, &out)
	return out, ref, err
}

func (h *HTTP) Options(ctx context.Context, id string) (api.Options, error) {
	var out api.Options
	ref, err := h.Do(ctx, http.MethodGet, api.PathOptions+"?characterId="+url.QueryEscape(id), nil, &out)
	return out, Refused("options for "+id, ref, err)
}

// Guild is a character's /guild page.
func (h *HTTP) Guild(ctx context.Context, id string) (api.Guild, error) {
	var out api.Guild
	ref, err := h.Do(ctx, http.MethodGet, api.PathGuild+"?characterId="+url.QueryEscape(id), nil, &out)
	return out, Refused("guild of "+id, ref, err)
}

// Classes is a character's /classes page.
func (h *HTTP) Classes(ctx context.Context, id string) (api.Classes, error) {
	var out api.Classes
	ref, err := h.Do(ctx, http.MethodGet, api.PathClasses+"?characterId="+url.QueryEscape(id), nil, &out)
	return out, Refused("classes of "+id, ref, err)
}

// Health is the service's health.
func (h *HTTP) Health(ctx context.Context) (api.Health, error) {
	var out api.Health
	ref, err := h.Do(ctx, http.MethodGet, api.PathHealth, nil, &out)
	return out, Refused("health", ref, err)
}

// Refused turns a refusal into an error, for calls that expect none.
func Refused(what string, ref *api.Refusal, err error) error {
	if err == nil && ref != nil {
		err = fmt.Errorf("%s: %s: %s", what, ref.Code, ref.Message)
	}
	return err
}

// Operate sends an operator's correction, grant or ban.
func (h *HTTP) Operate(ctx context.Context, req api.OperatorRequest) (api.ActionReply, *api.Refusal, error) {
	var out api.ActionReply
	ref, err := h.Do(ctx, http.MethodPost, api.PathOperator, req, &out)
	return out, ref, err
}

// Character is a character as the world holds it, raw.
func (h *HTTP) Character(ctx context.Context, id string) (json.RawMessage, error) {
	var out json.RawMessage
	ref, err := h.Do(ctx, http.MethodGet, api.PathOperatorCharacter+"?id="+url.QueryEscape(id), nil, &out)
	return out, Refused("character", ref, err)
}

// Tile is a tile's stored state and baseline, raw.
func (h *HTTP) Tile(ctx context.Context, q, r int64) (json.RawMessage, error) {
	var out json.RawMessage
	path := api.PathOperatorTile + "?q=" + strconv.FormatInt(q, 10) + "&r=" + strconv.FormatInt(r, 10)
	ref, err := h.Do(ctx, http.MethodGet, path, nil, &out)
	return out, Refused("tile", ref, err)
}

func (h *HTTP) Audit(ctx context.Context) (api.Audit, error) {
	var out api.Audit
	ref, err := h.Do(ctx, http.MethodGet, api.PathOperatorAudit, nil, &out)
	return out, Refused("audit", ref, err)
}

// Economy is the faucet and the characters flagged for review.
func (h *HTTP) Economy(ctx context.Context) (api.Economy, error) {
	var out api.Economy
	ref, err := h.Do(ctx, http.MethodGet, api.PathOperatorEconomy, nil, &out)
	return out, Refused("economy", ref, err)
}

func (h *HTTP) Digest(ctx context.Context) (api.Digest, error) {
	var out api.Digest
	ref, err := h.Do(ctx, http.MethodGet, api.PathOperatorDigest, nil, &out)
	return out, Refused("digest", ref, err)
}

// Reset wipes a disposable world and founds it again.
func (h *HTTP) Reset(ctx context.Context, world string) (api.ResetReply, error) {
	var out api.ResetReply
	ref, err := h.Do(ctx, http.MethodPost, api.PathOperatorReset, api.ResetRequest{World: world}, &out)
	return out, Refused("reset", ref, err)
}

// SetClock sets a manual clock's due tick.
func (h *HTTP) SetClock(ctx context.Context, due int64) error {
	ref, err := h.Do(ctx, http.MethodPost, api.PathOperatorClock, api.ClockRequest{Due: due}, nil)
	return Refused("clock", ref, err)
}

// structural: how often WaitHealth asks unless told otherwise.
const defaultPoll = 100 * time.Millisecond

// Advance sets a manual clock's due tick and waits for the world to run it.
func (h *HTTP) Advance(ctx context.Context, due int64) error {
	if err := h.SetClock(ctx, due); err != nil {
		return err
	}
	return h.WaitTick(ctx, due)
}

// WaitTick waits until the world has run tick n, or ctx ends.
func (h *HTTP) WaitTick(ctx context.Context, n int64) error {
	if err := h.WaitHealth(ctx, func(hl api.Health, err error) bool { return err == nil && hl.Tick >= n }); err != nil {
		return fmt.Errorf("the world never reached tick %d: %w", n, err)
	}
	return nil
}

// WaitHealth asks for health until done holds of the answer, or ctx ends.
func (h *HTTP) WaitHealth(ctx context.Context, done func(api.Health, error) bool) error {
	for {
		if done(h.Health(ctx)) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(h.Poll):
		}
	}
}
