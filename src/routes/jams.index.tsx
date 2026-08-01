import { createFileRoute } from "@tanstack/react-router";

import { JamBoardView } from "@/components/jams/JamCalendarPage/views/JamBoardView";

export const Route = createFileRoute("/jams/")({ component: JamBoardView });
