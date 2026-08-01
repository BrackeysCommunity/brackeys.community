import { createFileRoute } from "@tanstack/react-router";

import { JamCalendarView } from "@/components/jams/JamCalendarPage/views/JamCalendarView";

export const Route = createFileRoute("/jams/calendar")({ component: JamCalendarView });
