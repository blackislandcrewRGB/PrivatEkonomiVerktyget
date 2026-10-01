import { useMemo } from "react";
import type { Category } from "../api";
import { openNewCategoryDialog } from "../categories";

const NEW = "__new__";

/**
 * Category picker grouped by main category. Value is a category id or null.
 * '+ Ny kategori…' opens a dialog and picks the new category (not in filters).
 */
export function CategorySelect({
  categories,
  value,
  onChange,
  className,
  emptyLabel = "– ingen kategori –",
  autoFocus,
  onBlur,
  includeTransfers = true,
  allowCreate = true,
}: {
  categories: Category[];
  value: number | null;
  onChange: (id: number | null) => void;
  className?: string;
  emptyLabel?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  includeTransfers?: boolean;
  allowCreate?: boolean;
}) {
  const groups = useMemo(() => {
    const tops = categories.filter((c) => c.parentId === null && (includeTransfers || !c.isTransfer));
    return tops.map((t) => ({ top: t, children: categories.filter((c) => c.parentId === t.id) }));
  }, [categories, includeTransfers]);

  return (
    <select
      className={className}
      value={value ?? ""}
      autoFocus={autoFocus}
      onBlur={onBlur}
      onChange={(e) => {
        if (e.target.value === NEW) {
          // The select may unmount (inline editing closes on blur); onChange still works.
          const current = value === null ? undefined : categories.find((c) => c.id === value);
          openNewCategoryDialog(current ? (current.parentId ?? current.id) : null).then((c) => c && onChange(c.id));
          return;
        }
        onChange(e.target.value === "" ? null : Number(e.target.value));
      }}
    >
      <option value="">{emptyLabel}</option>
      {groups.map(({ top, children }) => (
        <optgroup key={top.id} label={top.name}>
          <option value={top.id}>{top.name}</option>
          {children.map((c) => (
            <option key={c.id} value={c.id}>
              {top.name} › {c.name}
            </option>
          ))}
        </optgroup>
      ))}
      {allowCreate && <option value={NEW}>+ Ny kategori…</option>}
    </select>
  );
}

export function useCategoryPath(categories: Category[]) {
  return useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    return (id: number | null) => {
      if (id === null) return null;
      const c = byId.get(id);
      if (!c) return null;
      const p = c.parentId ? byId.get(c.parentId) : undefined;
      return p ? `${p.name} › ${c.name}` : c.name;
    };
  }, [categories]);
}
