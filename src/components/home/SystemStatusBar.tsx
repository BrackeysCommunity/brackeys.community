import { StatusStrip, type StatusSegment } from "@/components/common/StatusStrip";
import { authClient } from "@/lib/auth-client";

const MOCK_DEVS_ONLINE = 18_427;

function formatCount(n: number) {
  return n.toLocaleString("en-US");
}

export function SystemStatusBar() {
  const { data: session } = authClient.useSession();
  const username = (session?.user?.name ?? "GUEST").toUpperCase();

  const segments: StatusSegment[] = [
    { key: "status", value: "SYSTEM READY", leadingDot: true },
    { key: "version", value: `v${__APP_VERSION__}` },
    { key: "user", label: "WELCOME,", value: username },
    { key: "devs", value: `${formatCount(MOCK_DEVS_ONLINE)} DEVS ONLINE` },
  ];

  return <StatusStrip segments={segments} />;
}
