import { createFileRoute } from "@tanstack/react-router";

import { JamArchiveView } from "@/components/jams/JamCalendarPage/views/JamArchiveView";

export const Route = createFileRoute("/jams/archive")({ component: JamArchiveView });
