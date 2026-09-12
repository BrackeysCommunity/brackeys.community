import { AdminSkills } from "@/components/admin/AdminSkills";
import { AdminVocabulary } from "@/components/admin/AdminVocabulary";
import { UnderlineTabs } from "@/components/ui/underline-tabs";

export const TAXONOMY_PANES = ["skills", "roles"] as const;
export type TaxonomyPane = (typeof TAXONOMY_PANES)[number];

/**
 * The two controlled vocabularies in one section: the skills a profile can
 * carry (plus the request queue that grows them) and the roles a collab
 * post can hire for. Same manager underneath, same staff, one rail entry.
 */
export function AdminTaxonomy({
  pane,
  onPane,
  isAdmin,
  skillRequestCount,
}: {
  pane: TaxonomyPane;
  onPane: (next: TaxonomyPane) => void;
  isAdmin: boolean;
  skillRequestCount: number;
}) {
  const tabs = [
    { key: "skills", label: "SKILLS", count: skillRequestCount },
    { key: "roles", label: "COLLAB ROLES" },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <UnderlineTabs tabs={tabs} active={pane} onSelect={onPane} label="Vocabularies" />
      {pane === "skills" ? (
        <AdminSkills isAdmin={isAdmin} />
      ) : (
        <AdminVocabulary isAdmin={isAdmin} />
      )}
    </div>
  );
}
