import { Well } from "@/components/ui/well";
import { authClient } from "@/lib/auth-client";

interface Segment {
  key: string;
  label: string;
  value: string;
  leadingDot?: boolean;
}

const MOCK_DEVS_ONLINE = 18_427;

function formatCount(n: number) {
  return n.toLocaleString("en-US");
}

function StatusDot() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5">
      <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />
      <span className="relative inline-block h-1.5 w-1.5 rounded-full bg-success" />
    </span>
  );
}

export function SystemStatusBar() {
  const { data: session } = authClient.useSession();
  const username = (session?.user?.name ?? "GUEST").toUpperCase();

  const segments: Segment[] = [
    { key: "status", label: "", value: "SYSTEM READY", leadingDot: true },
    { key: "version", label: "", value: `v${__APP_VERSION__}` },
    { key: "user", label: "WELCOME,", value: username },
    { key: "devs", label: "", value: `${formatCount(MOCK_DEVS_ONLINE)} DEVS ONLINE` },
  ];

  return (
    <Well notchOpts={{ size: 10 }}>
      <div className="mt-1 grid grid-cols-2 xl:grid-cols-4">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className="flex items-center gap-2 px-3 py-2 font-mono text-xs tracking-widest text-muted-foreground uppercase not-last:border-r not-last:border-muted/40"
          >
            {seg.leadingDot && <StatusDot />}
            {seg.label && <span>{seg.label}</span>}
            <span className={seg.label ? "text-foreground" : ""}>{seg.value}</span>
          </div>
        ))}
      </div>
    </Well>
  );
}
