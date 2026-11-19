package service_test

import (
	"io"
	"net/url"
	"testing"

	"jams.team/mmo-world/api"
)

func TestMarketOverHTTP(t *testing.T) {
	r := start(t, io.Discard)
	rep, ref, err := r.cli.Act(t.Context(), api.ActionRequest{InteractionID: "start", DiscordID: "trader", Kind: api.ActCreate, Option: api.StartHook})
	if err != nil || ref != nil {
		t.Fatal(ref, err)
	}
	id := rep.Character.ID
	query := "?characterId=" + url.QueryEscape(id)
	m := readSolo[api.Market](t, r, api.PathMarket+query, 200)
	if len(m.Orders) == 0 || len(m.Exchange) == 0 || m.Book.Material == "" || m.Banner == "" || m.Limit == 0 {
		t.Fatalf("market %+v", m)
	}
	o := m.Orders[0]
	if o.Wanted <= 0 || o.Yours != o.Price {
		t.Fatalf("a faction order at neutral standing: %+v", o)
	}
	// A bid with no coin is refused; the refusal names why.
	_, ref, err = r.cli.Act(t.Context(), api.ActionRequest{InteractionID: "bid", CharacterID: id, Version: rep.Character.Version, Kind: api.ActBid,
		Material: m.Book.Material, Units: 1, Price: 5})
	if err != nil || ref == nil {
		t.Fatalf("a bid without coin went through: %v %v", ref, err)
	}
	if h := readSolo[api.Refusal](t, r, api.PathHistory+query+"&material=nothing", 422); h.Code != api.CodeNotHere {
		t.Fatal(h)
	}
	if f := readSolo[api.Forum](t, r, api.PathForum, 200); len(f.Posts) == 0 || f.Posts[0].Banner == "" {
		t.Fatalf("forum %+v", f)
	}
	if e, err := r.op.Economy(t.Context()); err != nil || e.Active != 1 || e.Rate == 0 {
		t.Fatalf("economy %+v: %v", e, err)
	}
}
