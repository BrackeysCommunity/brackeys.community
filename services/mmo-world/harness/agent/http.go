package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"jams.team/mmo-world/api"
)

// HTTP is a Client over the world service's API: the scripted client the
// milestone proofs and every later load test drive.
type HTTP struct {
	Base, Token string
	C           *http.Client
}

func NewHTTP(base, token string) *HTTP {
	return &HTTP{Base: base, Token: token, C: &http.Client{Timeout: 30 * time.Second}}
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
	if err == nil && ref != nil {
		err = fmt.Errorf("options for %s: %s", id, ref.Message)
	}
	return out, err
}

// Health is the service's health.
func (h *HTTP) Health(ctx context.Context) (api.Health, error) {
	var out api.Health
	ref, err := h.Do(ctx, http.MethodGet, api.PathHealth, nil, &out)
	if err == nil && ref != nil {
		err = fmt.Errorf("health: %s", ref.Message)
	}
	return out, err
}
