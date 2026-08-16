import { motion } from "framer-motion";

import { PageStack } from "@/components/ui/page-motion";
import { fadeUp } from "@/lib/motion";

import { JamArchiveTable } from "../JamArchiveTable";
import { useJamsPage } from "../jams-context";
import { JamsToolbar } from "../JamsToolbar";

/** `/jams/archive` — the server-paginated table of finished jams. */
export function JamArchiveView() {
  const { archive, archiveState, setArchiveState, compact } = useJamsPage();

  return (
    // The stack replaces what used to be a fragment, so it has to carry
    // the layout's own column gap to keep the spacing it had as siblings.
    <PageStack className={compact ? "flex flex-col gap-6" : "flex flex-col gap-8"}>
      <motion.div variants={fadeUp}>
        <JamsToolbar />
      </motion.div>
      <motion.div variants={fadeUp}>
        <JamArchiveTable data={archive} state={archiveState} onStateChange={setArchiveState} />
      </motion.div>
    </PageStack>
  );
}
