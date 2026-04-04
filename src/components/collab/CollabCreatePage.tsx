import { useStore } from "@tanstack/react-store";
import { useEffect } from "react";
import { authStore } from "@/lib/auth-store";
import { collabStore, getWizardSteps, resetWizard } from "@/lib/collab-store";
import { usePageSidebar } from "@/lib/hooks/use-page-layout";
import { CollabCreateSidebar } from "./CollabCreateSidebar";

export function CollabCreatePage() {
  const { session } = useStore(authStore);
  const { wizard } = useStore(collabStore);

  usePageSidebar(<CollabCreateSidebar />);

  useEffect(() => {
    return () => resetWizard();
  }, []);

  const steps = getWizardSteps(wizard.draft);

  return (
    <>
      {/* Status bar */}
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{">"}</span>
        {"NEW POST"}
        <span className="mx-2 text-primary">{"//"}</span>
        {"STEP "}
        {wizard.step + 1}
        {" OF "}
        {steps.length}
        <span className="mx-2 text-primary">{"//"}</span>
        {"AGENT: "}
        <span className={session?.user ? "text-primary" : "text-destructive"}>
          {session?.user?.name?.toUpperCase() ?? "UNAUTHORIZED"}
        </span>
      </div>

      {/* Heading block */}
      <div className="flex flex-col justify-center">
        <h1 className="font-mono font-bold text-[clamp(2.5rem,5.5vw,7rem)] leading-[0.85] tracking-tighter text-foreground">
          NEW
          <br />
          <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary transition-colors duration-300">
            POST.
          </span>
        </h1>
        <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl">
          Create a collaboration post to find teammates, playtesters, or mentors for your project.
        </p>
      </div>

      {/* Step indicator */}
      <nav className="my-6 sm:mt-12 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {steps.map((step, i) => (
          <div
            key={step.id}
            className={`flex items-center gap-3 border-2 px-4 py-3 font-mono transition-all ${
              i === wizard.step
                ? "border-primary bg-primary/5 text-primary"
                : i < wizard.step
                  ? "border-green-500/40 bg-green-500/5 text-green-500"
                  : "border-muted bg-card text-muted-foreground"
            }`}
          >
            <span className="text-xs">{step.num}</span>
            <span className="text-xs font-bold tracking-widest uppercase">{step.label}</span>
          </div>
        ))}
      </nav>
    </>
  );
}
