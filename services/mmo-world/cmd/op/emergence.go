package main

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"
	"text/tabwriter"

	"jams.team/mmo-world/api"
	"jams.team/mmo-world/api/client"
)

// GDD 13.5's healthy lines, as the dashboard's verdicts judge them.
const (
	healthyKinds      = "falls slowly, never 0"
	healthyPromotions = "at least 1 of each type per 500 active characters"
	healthyHeavy      = "more than half"
	healthyPairing    = "under 35% in every region"
)

// emergence prints the operator's emergence dashboard (GDD 13.5).
func emergence(ctx context.Context, c *client.HTTP, w io.Writer) error {
	d, err := c.OperatorEmergence(ctx)
	if err != nil {
		return err
	}
	return printEmergence(w, d)
}

func printEmergence(out io.Writer, d api.Emergence) error {
	w := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	fmt.Fprintf(w, "emergence: world day %d, season %d, %d active characters\n\n", d.Day, d.Season, d.Active)

	fmt.Fprintln(w, "measure\treading\thealthy\tverdict")
	fmt.Fprintf(w, "new kinds per active character a week\t%s\t%s\t%s\n", kindsReading(d.KindsPerMille), healthyKinds, verdict(d.KindsHealthy))
	fmt.Fprintf(w, "promotions this season\t%s\t%s\t%s\n", promotionsReading(d), healthyPromotions, verdict(d.PromotionsHealthy))
	fmt.Fprintf(w, "heavy facts with a player in their causes\t%s\t%s\t%s\n", heavyReading(d), healthyHeavy, verdict(d.HeavyHealthy))
	fmt.Fprintf(w, "share of wins by the most common pairing\t%s\t%s\t%s\n", pairingReading(d.Pairing), healthyPairing, verdict(d.PairingHealthy))

	if len(d.Pairing) > 0 {
		fmt.Fprintln(w, "\nregion\tmost common pairing\tshare")
		for _, p := range d.Pairing {
			fmt.Fprintf(w, "%s\t%s\t%d%%\n", p.Region, styleShown(p), p.Percent)
		}
	}

	fmt.Fprintf(w, "\npromotions this season\tcount\tneed %d\n", d.Need)
	for _, t := range d.Promotions {
		fmt.Fprintf(w, "%s\t%d\t%s\n", t.Type, t.Count, below(t.Count < d.Need))
	}

	if len(d.Traces) > 0 {
		fmt.Fprintln(w, "\ntrace\tstored")
		for _, t := range d.Traces {
			fmt.Fprintf(w, "%s\t%d\n", t.Type, t.Count)
		}
	}
	if err := w.Flush(); err != nil {
		return err
	}

	w = tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	fmt.Fprintf(w, "\nnewest promotions (%d)\n", len(d.Recent))
	if len(d.Recent) == 0 {
		fmt.Fprintln(w, "none yet")
	} else {
		fmt.Fprintln(w, "day\tid\tname\twhere\tdetail")
		for _, p := range d.Recent {
			fmt.Fprintf(w, "%d\t%s\t%s\t%s\t%s\n", p.Day, p.ID, p.Name, promotionWhere(p), promotionDetail(p))
		}
	}
	return w.Flush()
}

// below is a type's count against the season's need.
func below(under bool) string {
	if under {
		return "short"
	}
	return "ok"
}

func verdict(ok bool) string {
	if ok {
		return "ok"
	}
	return "UNHEALTHY"
}

// kindsReading is the weeks per mille, oldest first, the week in progress
// last (it is not judged until it closes).
func kindsReading(weeks []int64) string {
	if len(weeks) == 0 {
		return "no week yet"
	}
	parts := make([]string, len(weeks))
	for i, v := range weeks {
		parts[i] = strconv.FormatInt(v, 10)
	}
	return strings.Join(parts, " ") + " per 1,000 (oldest first)"
}

func promotionsReading(d api.Emergence) string {
	short := 0
	for _, t := range d.Promotions {
		if t.Count < d.Need {
			short++
		}
	}
	if short == 0 {
		return fmt.Sprintf("every type at %d or more", d.Need)
	}
	return fmt.Sprintf("%d of %d types under %d", short, len(d.Promotions), d.Need)
}

func heavyReading(d api.Emergence) string {
	if d.Heavy == 0 {
		return "no heavy facts yet"
	}
	return fmt.Sprintf("%d of %d (%d%%)", d.HeavyPlayer, d.Heavy, d.HeavyPlayer*100/d.Heavy)
}

// pairingReading is the region with the largest share.
func pairingReading(shares []api.RegionShare) string {
	if len(shares) == 0 {
		return "no wins with a pairing yet"
	}
	top := shares[0]
	for _, s := range shares[1:] {
		if s.Percent > top.Percent {
			top = s
		}
	}
	return fmt.Sprintf("%d%% (%s in %s)", top.Percent, styleShown(top), top.Region)
}

func styleShown(s api.RegionShare) string {
	if s.Name != "" {
		return s.Name + " (" + s.Style + ")"
	}
	return s.Style
}

func promotionWhere(p api.Promotion) string {
	var parts []string
	if p.Region != "" {
		parts = append(parts, p.Region)
	}
	if p.At != nil {
		parts = append(parts, fmt.Sprintf("%d,%d", p.At.Q, p.At.R))
	}
	if len(p.Places) > 0 {
		places := make([]string, len(p.Places))
		for i, n := range p.Places {
			places[i] = strconv.Itoa(n)
		}
		parts = append(parts, "places "+strings.Join(places, "–"))
	}
	if len(parts) == 0 {
		return "-"
	}
	return strings.Join(parts, " ")
}

func promotionDetail(p api.Promotion) string {
	parts := []string{p.Type}
	switch {
	case p.OfName != "":
		parts = append(parts, "of "+p.OfName)
	case p.Of != "":
		parts = append(parts, "of "+p.Of)
	}
	if p.Resists != "" {
		parts = append(parts, "resists "+p.Resists)
	}
	if p.Material != "" {
		parts = append(parts, "material "+p.Material)
	}
	return strings.Join(parts, ", ")
}
