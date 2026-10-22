import { MicroLabel, Text } from "@/components/ui/typography";

import type { FinishedImportReport } from "./import-flow";

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col">
      <Text as="span" size="lg" bold>
        {value.toLocaleString("en")}
      </Text>
      <MicroLabel as="span">{label}</MicroLabel>
    </div>
  );
}

/**
 * What an import did, shown once when it finishes: what came in, and every
 * file left out or renamed, with why. Nothing is dropped silently.
 */
export function ImportReport({ report }: { report: FinishedImportReport }) {
  const cards = report.canvases.reduce((sum, c) => sum + c.nodes, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        <Count label="CANVASES" value={report.canvases.length} />
        <Count label="CARDS" value={cards} />
        <Count label="NOTES" value={report.notesAttached + report.textCards} />
        <Count label="UPLOADED" value={report.imagesUploaded} />
        <Count label="REUSED" value={report.imagesReused} />
      </div>
      {report.repairs.length ? (
        <section className="flex flex-col gap-1.5">
          <MicroLabel>RENAMED</MicroLabel>
          <ul className="flex flex-col gap-1">
            {report.repairs.map((repair, i) => (
              <li key={i} className="text-xs">
                <Text as="span" size="xs" ellipsis>
                  {repair.from} → {repair.to}
                </Text>
                <Text as="span" size="xs" variant="muted">
                  {" "}
                  {repair.reason}
                </Text>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {report.skipped.length ? (
        <section className="flex flex-col gap-1.5">
          <MicroLabel>LEFT OUT ({report.skipped.length.toLocaleString("en")})</MicroLabel>
          <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
            {report.skipped.map((line, i) => (
              <li key={i} className="flex flex-col">
                <Text as="span" size="xs" bold ellipsis>
                  {line.path}
                </Text>
                <Text as="span" size="xs" variant="muted">
                  {line.reason}
                  {line.canvas ? ` On ${line.canvas}.` : ""}
                </Text>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <Text as="p" size="xs" variant="muted">
          Everything came in.
        </Text>
      )}
    </div>
  );
}
