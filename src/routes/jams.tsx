import { createFileRoute } from "@tanstack/react-router";

import { JamsPageLayout } from "@/components/jams/JamCalendarPage";

export const Route = createFileRoute("/jams")({ component: JamsPageLayout });
