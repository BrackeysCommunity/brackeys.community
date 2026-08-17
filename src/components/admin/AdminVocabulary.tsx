import { Add01Icon, Cancel01Icon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import {
  AdminEmpty,
  AdminSection,
  CategoryCombobox,
  Field,
  errText,
} from "@/components/admin/AdminUI";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { client, orpc } from "@/orpc/client";

type Kind = "roles" | "skills";
type VocabItem = { id: number; name: string; category: string | null; usageCount: number };

const UNCATEGORISED = "Uncategorised";

/** What a usage count means for each vocabulary, for the removal warning. */
const USAGE: Record<Kind, (n: number) => string> = {
  roles: (n) => `${n} post${n === 1 ? "" : "s"}`,
  skills: (n) => `${n} member${n === 1 ? "" : "s"}`,
};

/**
 * The collab-roles vocabulary. Skills live on the skills tab, next to the
 * requests that feed them.
 */
export function AdminVocabulary({ isAdmin }: { isAdmin: boolean }) {
  return (
    <VocabularyManager
      kind="roles"
      isAdmin={isAdmin}
      title="Collab roles"
      hint="The seats a collab post can hire for."
    />
  );
}

/**
 * Add / rename / remove for one controlled vocabulary. Adding and renaming
 * are staff; removing is admin-only (mirrors the endpoint gates — a removed
 * entry cascades off every post or profile that carried it).
 */
export function VocabularyManager({
  kind,
  isAdmin,
  title,
  hint,
  /** Stack the add form even on wide screens — for use inside a column. */
  stacked = false,
}: {
  kind: Kind;
  isAdmin: boolean;
  title: string;
  hint?: string;
  stacked?: boolean;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const vocab = useQuery(orpc.listVocabulary.queryOptions({}));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orpc.listVocabulary.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.listCollabRoles.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.listSkills.key() });
  };
  const onError = (err: unknown) => toast.error(errText(err));

  const add = useMutation({
    mutationFn: (input: { name: string; category: string | null }) =>
      kind === "roles"
        ? client.addCollabRole({ name: input.name, category: input.category ?? undefined })
        : client.createSkill({ name: input.name, category: input.category ?? undefined }),
    onSuccess: (_result, input) => {
      setName("");
      toast.success(`Added “${input.name}”.`);
      invalidate();
    },
    onError,
  });
  const rename = useMutation({
    mutationFn: (input: { id: number; name: string; category: string | null }) =>
      kind === "roles"
        ? client.updateCollabRole({
            roleId: input.id,
            name: input.name,
            category: input.category ?? undefined,
          })
        : client.updateSkill({
            skillId: input.id,
            name: input.name,
            category: input.category ?? undefined,
          }),
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: number) =>
      kind === "roles"
        ? client.removeCollabRole({ roleId: id })
        : client.deleteSkill({ skillId: id }),
    onSuccess: invalidate,
    onError,
  });

  const items: VocabItem[] = useMemo(
    () => (kind === "roles" ? (vocab.data?.roles ?? []) : (vocab.data?.skills ?? [])),
    [kind, vocab.data],
  );

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter((c): c is string => !!c))].sort(),
    [items],
  );

  const grouped = useMemo(() => {
    const map = new Map<string, VocabItem[]>();
    for (const item of items) {
      const key = item.category ?? UNCATEGORISED;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    // Uncategorised last — it's the leftovers bin, not a peer category.
    return [...map.entries()].sort(([a], [b]) =>
      a === UNCATEGORISED ? 1 : b === UNCATEGORISED ? -1 : a.localeCompare(b),
    );
  }, [items]);

  const trimmed = name.trim();
  const clash = useMemo(
    () => items.find((i) => i.name.toLowerCase() === trimmed.toLowerCase()) ?? null,
    [items, trimmed],
  );
  const canAdd = trimmed.length > 0 && !clash && !add.isPending;

  /** Quick-add: prefill the category and put the cursor where the typing goes. */
  const startAddTo = (groupName: string) => {
    setCategory(groupName === UNCATEGORISED ? "" : groupName);
    setEditingId(null);
    nameInputRef.current?.focus();
    nameInputRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <AdminSection title={title} count={vocab.isPending ? undefined : items.length} hint={hint}>
      <Well className="gap-3 p-4">
        <div className={cn("flex flex-col gap-2", !stacked && "sm:flex-row sm:items-end")}>
          <Field label="Name" htmlFor={`vocab-name-${kind}`} className="flex-1">
            <Input
              id={`vocab-name-${kind}`}
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "roles" ? "e.g. Narrative Designer" : "e.g. Godot"}
              maxLength={100}
              aria-invalid={clash != null}
            />
          </Field>
          <Field label="Category (optional)" htmlFor={`vocab-category-${kind}`} className="flex-1">
            <CategoryCombobox
              id={`vocab-category-${kind}`}
              value={category}
              onChange={setCategory}
              categories={categories}
              placeholder={kind === "roles" ? "e.g. Design" : "e.g. Programming"}
            />
          </Field>
          <Confirm
            title={`Add “${trimmed}”?`}
            message={
              category.trim()
                ? `It joins ${category.trim()} and becomes selectable by everyone.`
                : "It becomes selectable by everyone. You can give it a category later."
            }
            confirmText="Add"
            disabled={!canAdd}
            onConfirm={async () => {
              await add.mutateAsync({ name: trimmed, category: category.trim() || null });
            }}
          >
            <Button size="sm" disabled={!canAdd} className={stacked ? "self-start" : undefined}>
              <HugeiconsIcon icon={Add01Icon} strokeWidth={2} data-icon="inline-start" />
              Add {kind === "roles" ? "role" : "skill"}
            </Button>
          </Confirm>
        </div>
        {clash ? (
          <Text size="xs" variant="danger">
            “{clash.name}” is already in the list{clash.category ? ` under ${clash.category}` : ""}.
          </Text>
        ) : null}
      </Well>

      {vocab.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : items.length === 0 ? (
        <AdminEmpty>Nothing in this vocabulary yet.</AdminEmpty>
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map(([groupName, groupItems]) => (
            <Section
              key={groupName}
              size="mini"
              title={groupName}
              action={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => startAddTo(groupName)}
                  aria-label={`Add to ${groupName}`}
                  title={`Add to ${groupName}`}
                >
                  <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                </Button>
              }
            >
              <div className="flex flex-wrap gap-2">
                {groupItems.map((item) =>
                  editingId === item.id ? (
                    <EditRow
                      key={item.id}
                      item={item}
                      kind={kind}
                      categories={categories}
                      siblings={items}
                      busy={rename.isPending}
                      onCancel={() => setEditingId(null)}
                      onSave={(next) => rename.mutateAsync({ id: item.id, ...next })}
                    />
                  ) : (
                    <div
                      key={item.id}
                      className="group inline-flex items-center gap-1 rounded border border-border/60 bg-card/60 py-0.5 pr-1 pl-2"
                    >
                      <Text size="sm" className="font-medium">
                        {item.name}
                      </Text>
                      <Badge size="label" variant="ghost" className="text-muted-foreground">
                        {item.usageCount}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setEditingId(item.id)}
                        aria-label={`Rename ${item.name}`}
                      >
                        <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} />
                      </Button>
                      {isAdmin && (
                        <Confirm
                          title={`Remove “${item.name}”?`}
                          message={
                            item.usageCount > 0
                              ? `It disappears from the vocabulary and from the ${USAGE[kind](item.usageCount)} currently using it.`
                              : "It disappears from the vocabulary. Nothing is using it right now."
                          }
                          confirmText="Remove"
                          variant="destructive"
                          onConfirm={async () => {
                            await remove.mutateAsync(item.id);
                          }}
                        >
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={remove.isPending}
                            aria-label={`Remove ${item.name}`}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                          </Button>
                        </Confirm>
                      )}
                    </div>
                  ),
                )}
              </div>
            </Section>
          ))}
        </div>
      )}
    </AdminSection>
  );
}

/**
 * Inline rename. Both vocabularies are referenced by id, so a correction
 * propagates to every post and profile carrying the entry — which is why
 * this is worth having over delete-and-re-add.
 */
function EditRow({
  item,
  kind,
  categories,
  siblings,
  busy,
  onCancel,
  onSave,
}: {
  item: VocabItem;
  kind: Kind;
  categories: string[];
  siblings: VocabItem[];
  busy: boolean;
  onCancel: () => void;
  onSave: (next: { name: string; category: string | null }) => Promise<unknown>;
}) {
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category ?? "");

  const trimmed = name.trim();
  const clash = useMemo(
    () =>
      siblings.find((s) => s.id !== item.id && s.name.toLowerCase() === trimmed.toLowerCase()) ??
      null,
    [siblings, item.id, trimmed],
  );
  const changed = trimmed !== item.name || category.trim() !== (item.category ?? "");
  const canSave = trimmed.length > 0 && !clash && changed && !busy;

  return (
    <Well className="w-full gap-2 p-3">
      <div className="flex flex-col gap-2">
        <Field label="Name" htmlFor={`vocab-edit-name-${kind}-${item.id}`}>
          <Input
            id={`vocab-edit-name-${kind}-${item.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoFocus
            aria-invalid={clash != null}
          />
        </Field>
        <Field label="Category" htmlFor={`vocab-edit-cat-${kind}-${item.id}`}>
          <CategoryCombobox
            id={`vocab-edit-cat-${kind}-${item.id}`}
            value={category}
            onChange={setCategory}
            categories={categories}
          />
        </Field>
        <div className="flex items-center gap-2">
          <Confirm
            title={`Rename “${item.name}” to “${trimmed}”?`}
            message={
              item.usageCount > 0
                ? `Everything already using it follows the new name — ${USAGE[kind](item.usageCount)}.`
                : "Nothing is using it yet, so this only changes the catalogue."
            }
            confirmText="Save"
            disabled={!canSave}
            onConfirm={async () => {
              await onSave({ name: trimmed, category: category.trim() || null });
            }}
          >
            <Button size="xs" disabled={!canSave}>
              Save
            </Button>
          </Confirm>
          <Button variant="ghost" size="xs" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
      {clash ? (
        <Text size="xs" variant="danger">
          “{clash.name}” already exists.
        </Text>
      ) : null}
    </Well>
  );
}
