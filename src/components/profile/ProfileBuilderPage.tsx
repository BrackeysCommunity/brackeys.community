import { Login01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { motion } from "framer-motion";

import { signInWithDiscord } from "@/lib/auth-client";
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
          onClick={() => signInWithDiscord()}
          className="group flex h-24 min-w-[280px] flex-col justify-between border-2 border-primary bg-card p-4 text-left transition-all duration-100 hover:-translate-y-1 hover:bg-background hover:shadow-[4px_4px_0px_var(--color-primary)] active:translate-y-0 active:shadow-none"
        >
          <div className="flex justify-between">
            <span className="text-xs text-primary">AUTHENTICATE</span>
            <HugeiconsIcon icon={Login01Icon} size={20} className="text-primary" />
          </div>
          <div className="font-display text-2xl leading-none font-bold tracking-tight whitespace-pre-line text-primary">
            {"SIGN IN\nW/ DISCORD"}
          </div>
        </button>
      </motion.div>
      <p className="mt-4 text-xs tracking-wider text-muted-foreground">
        {"> SIGN IN TO VIEW AND EDIT YOUR PROFILE"}
      </p>
    </div>
  );
}

/**
 * The signed-out `/profile` landing — sign-in CTA only. `ProfileIndex`
 * owns the session read and the hop to `/profile/$userId`, so this
 * renders only once the viewer is known to be anonymous.
 */
export function ProfileBuilderPage() {
  return (
    <>
      <div className="mb-4 flex items-center gap-2 text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{">"}</span>
        AUTHENTICATION REQUIRED
      </div>

      <div className="flex flex-col justify-center">
        <h1 className="font-display text-[clamp(2.5rem,5.5vw,7rem)] leading-[0.85] font-bold tracking-tighter text-foreground">
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
