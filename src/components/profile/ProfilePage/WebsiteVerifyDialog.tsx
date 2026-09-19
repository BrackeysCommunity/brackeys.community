import { ArrowUpRight01Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Spinner } from "@/components/ui/spinner";
import { MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { formatDate } from "@/lib/format-date";
import { play } from "@/lib/sound";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";
import { STALE } from "@/orpc/public-procedures";

/**
 * The owner side of the PORTFOLIO row's VERIFIED badge: the token, both
 * placements, and a CHECK. A failed check names both halves, because
 * "didn't work" on a two-placement proof says nothing about which one the
 * member got wrong.
 *
 * `ResponsiveModal` like every other modal here — a drawer on a phone, and
 * a footer that is a pinned action row rather than a button floating under
 * the body. Nothing truncates the token: it is 64 characters, and one you
 * can copy but never read is impossible to compare against whatever you
 * actually pasted into a DNS panel.
 */
export function WebsiteVerifyDialog({
  open,
  onClose,
  onVerified,
}: {
  open: boolean;
  onClose: () => void;
  /** Invalidates the profile query so the row re-renders with the badge. */
  onVerified: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const qc = useQueryClient();

  const detailsKey = orpc.getWebsiteVerification.queryOptions({ input: {} }).queryKey;
  const { data: details, isLoading } = useQuery({
    ...orpc.getWebsiteVerification.queryOptions({ input: {} }),
    staleTime: STALE.viewer,
    enabled: open,
  });

  // Two intents, deliberately not one function: `finish` is the outcome
  // closing the modal, `dismiss` is the member doing it — and only the
  // latter is refused mid-check.
  const finish = () => {
    setFailure(null);
    onClose();
  };

  const check = useMutation({
    mutationFn: () => client.verifyWebsite({}),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: detailsKey });
      onVerified();
      if (!result.verified) {
        setFailure(result.reason);
        return;
      }
      setFailure(null);
      play("success");
      toast.success(`Verified ${result.host}`);
      finish();
    },
    onError: (err: Error) => setFailure(err.message || "The check couldn't run."),
  });

  const host = details?.host;
  const dismiss = () => {
    if (check.isPending) return;
    finish();
  };

  return (
    <ResponsiveModal
      open={open}
      onClose={dismiss}
      title="Verify your site"
      description="Place a token on your portfolio's host, then run the check."
      dividedHeader
      footer={
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-muted/40 p-4">
          <Button variant="outline" size="sm" onClick={dismiss} className="tracking-widest">
            CLOSE
          </Button>
          <Button
            size="sm"
            disabled={check.isPending || !host}
            onClick={() => check.mutate()}
            className="tracking-widest"
          >
            {check.isPending && <Spinner className="mr-1.5 size-3" />}
            {check.isPending ? "CHECKING…" : "CHECK"}
          </Button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-4" />
          </div>
        ) : details?.blockedReason ? (
          <Text size="sm" variant="muted">
            {details.blockedReason}
          </Text>
        ) : details ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <Text size="sm" variant="muted">
                Either placement on <span className="font-mono text-foreground">{host}</span> is
                enough.
              </Text>
              {details.verifiedAt ? (
                <Badge variant="success" size="label">
                  VERIFIED {formatDate(details.verifiedAt)}
                </Badge>
              ) : null}
            </div>

            <Placement
              index="01"
              title="DNS RECORD"
              copyValue={details.txtRecord}
              rows={[
                ["TYPE", "TXT"],
                [
                  "NAME",
                  details.recordName ?? details.host ?? "",
                  // Panels take the name relative to the zone; showing the
                  // full host next to it is how the member knows which is
                  // which without guessing.
                  details.recordName === details.host ? null : details.host,
                ],
                ["VALUE", details.txtRecord],
              ]}
              footer={
                details.dnsProvider ? (
                  <div className="flex items-center justify-between gap-2 border-t border-muted/40 pt-2">
                    <Text size="xs" variant="muted">
                      <span className="font-mono">{details.dnsProvider.zone}</span> uses{" "}
                      <span className="text-foreground">{details.dnsProvider.name}</span>
                    </Text>
                    {details.dnsProvider.url ? (
                      <Button
                        variant="outline"
                        size="xs"
                        className="tracking-widest"
                        nativeButton={false}
                        render={
                          <a
                            href={details.dnsProvider.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        }
                      >
                        OPEN DNS
                        <HugeiconsIcon icon={ArrowUpRight01Icon} size={12} />
                      </Button>
                    ) : null}
                  </div>
                ) : null
              }
            />
            <Placement
              index="02"
              title="OR A FILE"
              copyValue={details.token}
              rows={[
                ["URL", `https://${details.host}${details.wellKnownPath}`],
                ["BODY", details.token],
              ]}
            />

            {failure ? (
              <Text size="xs" className="text-destructive">
                {failure}
              </Text>
            ) : null}
            <Text size="xs" variant="muted">
              DNS can take a few minutes to propagate. VERIFIED means you control the host — not who
              you are.
            </Text>
          </>
        ) : null}
      </div>
    </ResponsiveModal>
  );
}

/**
 * One placement as a labelled readout: every field that has to be typed
 * into a DNS panel or a file, and one copy button for the value that
 * actually matters.
 */
function Placement({
  index,
  title,
  rows,
  copyValue,
  footer,
}: {
  index: string;
  title: string;
  /** `[field, value, hint?]` — the hint sits muted beside the value. */
  rows: Array<[string, string, (string | null)?]>;
  copyValue: string;
  /** Under the rows — where the DNS block points at the member's panel. */
  footer?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(copyValue);
    play("success");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Well className="gap-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <MicroLabel>
          {index} {title}
        </MicroLabel>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy ${title}`}
          tooltip={copied ? "Copied" : "Copy"}
          onClick={copy}
        >
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
        </Button>
      </div>
      <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([label, value, hint]) => (
          <div key={label} className="contents">
            <dt className="font-mono text-[10px] tracking-widest text-muted-foreground/60">
              {label}
            </dt>
            {/* `break-all`: a 64-character token has no break opportunities,
                and truncating it hides the half you'd compare by eye. */}
            <dd className="min-w-0 font-mono text-[11px] leading-relaxed break-all">
              {value}
              {hint ? <span className="ml-2 text-muted-foreground/60">{hint}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
      {footer}
    </Well>
  );
}
