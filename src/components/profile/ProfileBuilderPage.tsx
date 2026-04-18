import { Login01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { motion } from "framer-motion";
import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";
import { authStore } from "@/lib/auth-store";
import { useMagnetic } from "@/lib/hooks/use-cursor";

const springTransition = { type: "spring", stiffness: 1000, damping: 30, mass: 0.1 } as const;

function DiscordSignInCTA() {
  const { ref, position } = useMagnetic(0.2);
  return (
    <div className="my-6 sm:mt-12">
      <motion.div
        ref={ref as React.RefObject<HTMLDivElement>}
        data-magnetic
        data-cursor-corner-size="lg"
        data-cursor-padding-x="24"
        data-cursor-padding-y="24"
        animate={{ x: position.x, y: position.y }}
        transition={springTransition}
        className="pointer-events-auto relative z-10 inline-block"
      >
        <button
          type="button"
          onClick={() => authClient.signIn.social({ provider: "discord" })}
          className="group flex h-24 min-w-[280px] flex-col justify-between border-2 border-primary bg-card p-4 text-left transition-all duration-100 hover:-translate-y-1 hover:bg-background hover:shadow-[4px_4px_0px_var(--color-primary)] active:translate-y-0 active:shadow-none"
        >
          <div className="flex justify-between">
            <span className="font-mono text-xs text-primary">AUTHENTICATE</span>
            <HugeiconsIcon icon={Login01Icon} size={20} className="text-primary" />
          </div>
          <div className="font-mono text-2xl leading-none font-bold tracking-tight whitespace-pre-line text-primary">
            {"SIGN IN\nW/ DISCORD"}
          </div>
        </button>
      </motion.div>
      <p className="mt-4 font-mono text-xs tracking-wider text-muted-foreground">
        {"> SIGN IN TO VIEW AND EDIT YOUR PROFILE"}
      </p>
    </div>
  );
}

export function ProfileBuilderPage() {
  const { session, isPending } = useStore(authStore);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && session?.user?.id) {
      navigate({ to: "/profile/$userId", params: { userId: session.user.id }, replace: true });
    }
  }, [isPending, session?.user?.id, navigate]);

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="animate-pulse font-mono text-xs tracking-widest text-muted-foreground uppercase">
          Authenticating...
        </span>
      </div>
    );
  }

  if (session?.user) {
    return (
      <div className="flex items-center justify-center py-24">
        <span className="animate-pulse font-mono text-xs tracking-widest text-muted-foreground uppercase">
          Redirecting to your profile...
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{">"}</span>
        AUTHENTICATION REQUIRED
      </div>

      <div className="flex flex-col justify-center">
        <h1 className="font-mono text-[clamp(2.5rem,5.5vw,7rem)] leading-[0.85] font-bold tracking-tighter text-foreground">
          DEV
          <br />
          <span className="text-transparent transition-colors duration-300 [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary">
            PROFILE.
          </span>
        </h1>
        <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl">
          Your developer identity in the Brackeys network. Sign in with Discord to view and edit
          your profile.
        </p>
      </div>

      <DiscordSignInCTA />
    </>
  );
}
