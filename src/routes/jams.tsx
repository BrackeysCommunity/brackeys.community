import { createFileRoute } from "@tanstack/react-router";

import { JamCalendarPage } from "@/components/jams/JamCalendarPage";

export const Route = createFileRoute("/jams")({ component: JamCalendarPage });
