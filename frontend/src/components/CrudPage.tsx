import { useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { IconEdit, IconPlus, IconSearch, IconTrash } from "./Icons";
import Modal from "./Modal";
import { Alert, EmptyState, PageHeader, Spinner, useApi, useToast } from "./ui";

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "number" | "bool" | "list" | "select" | "textarea";
  options?: { value: string | number; label: string }[];
  required?: boolean;
  placeholder?: string;
  hint?: string;
  full?: boolean;
}

export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface Props<T extends { id: number }> {
  entity: string;
  title: string;
  subtitle?: ReactNode;
  fields: FieldDef[];
  columns: Column<T>[];
  defaults: Partial<T>;
  filter?: (row: T) => boolean;
  searchText?: (row: T) => string;
  addLabel?: string;
  canAdd?: boolean;
  intro?: ReactNode;
  deleteLabel?: (row: T) => string;
}

type Draft = Record<string, unknown>;

function toDraft(fields: FieldDef[], row: Draft): Draft {
  const d: Draft = {};
  for (const f of fields) {
    const v = row[f.key];
    d[f.key] = f.type === "list" ? ((v as string[] | undefined) ?? []).join(", ") : v ?? (f.type === "bool" ? false : f.type === "number" ? 0 : "");
  }
  return d;
}

function fromDraft(fields: FieldDef[], d: Draft): Draft {
  const out: Draft = {};
  for (const f of fields) {
    const v = d[f.key];
    if (f.type === "list")
      out[f.key] = String(v ?? "")
        .split(/[,，\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    else if (f.type === "number") out[f.key] = Number(v) || 0;
    else if (f.type === "select" && typeof f.options?.[0]?.value === "number") out[f.key] = Number(v);
    else out[f.key] = v;
  }
  return out;
}

export default function CrudPage<T extends { id: number }>(props: Props<T>) {
  const { entity, title, subtitle, fields, columns, defaults, filter, searchText, canAdd = true, intro } = props;
  const { data, loading, error, reload } = useApi<T[]>(`/api/data/${entity}`);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id: number | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<T | null>(null);
  const toast = useToast();

  const rows = useMemo(() => {
    let r = (data ?? []).filter((x) => (filter ? filter(x) : true));
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      r = r.filter((x) => (searchText ? searchText(x) : JSON.stringify(x)).toLowerCase().includes(needle));
    }
    return r;
  }, [data, filter, q, searchText]);

  const missingRequired = editing ? fields.some((f) => f.required && !String(editing.draft[f.key] ?? "").trim()) : false;

  async function save() {
    if (!editing) return;
    setSaving(true);
    setFormError("");
    try {
      const body = fromDraft(fields, editing.draft);
      if (editing.id === null) await api.post(`/api/data/${entity}`, body);
      else await api.put(`/api/data/${entity}/${editing.id}`, body);
      setEditing(null);
      toast.ok("บันทึกแล้ว");
      reload();
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: T) {
    try {
      await api.del(`/api/data/${entity}/${row.id}`);
      toast.ok("ลบแล้ว");
      setConfirmDelete(null);
      reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          canAdd && (
            <button type="button" className="btn btn-primary" onClick={() => setEditing({ id: null, draft: toDraft(fields, defaults as Draft) })}>
              <IconPlus /> {props.addLabel ?? "เพิ่มรายการ"}
            </button>
          )
        }
      />
      {intro}
      <div className="card p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div className="relative w-full sm:max-w-xs">
            <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="ค้นหา…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหา" />
          </div>
          <span className="text-sm text-slate-500 tabular-nums">{rows.length} รายการ</span>
        </div>
        {loading && <Spinner />}
        {error && (
          <div className="p-4">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="p-4">
            <EmptyState title="ยังไม่มีข้อมูล">นำเข้าข้อมูลจากไฟล์ หรือกดปุ่มเพิ่มรายการ</EmptyState>
          </div>
        )}
        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                  <th className="w-24 text-right">
                    <span className="sr-only">จัดการ</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    {columns.map((c) => (
                      <td key={c.key} className={c.className}>
                        {c.render ? c.render(row) : String((row as unknown as Draft)[c.key] ?? "")}
                      </td>
                    ))}
                    <td className="text-right whitespace-nowrap">
                      <button
                        type="button"
                        className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
                        onClick={() => setEditing({ id: row.id, draft: toDraft(fields, row as unknown as Draft) })}
                        aria-label="แก้ไข"
                      >
                        <IconEdit />
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600"
                        onClick={() => setConfirmDelete(row)}
                        aria-label="ลบ"
                      >
                        <IconTrash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={editing !== null}
        title={editing?.id === null ? `เพิ่ม${title}` : `แก้ไข${title}`}
        onClose={() => setEditing(null)}
        wide={fields.length > 6}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>
              ยกเลิก
            </button>
            <button type="button" className="btn btn-primary" disabled={saving || missingRequired} onClick={save}>
              {saving ? "กำลังบันทึก…" : "บันทึก"}
            </button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <FieldInput
                key={f.key}
                def={f}
                value={editing.draft[f.key]}
                onChange={(v) => setEditing((e) => (e ? { ...e, draft: { ...e.draft, [f.key]: v } } : e))}
              />
            ))}
            {formError && (
              <p role="alert" className="text-sm text-red-600 sm:col-span-2">
                {formError}
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={confirmDelete !== null}
        title="ยืนยันการลบ"
        onClose={() => setConfirmDelete(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
              ยกเลิก
            </button>
            <button type="button" className="btn btn-danger" onClick={() => confirmDelete && remove(confirmDelete)}>
              ลบ
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          ต้องการลบ <span className="font-semibold text-slate-800">{confirmDelete && (props.deleteLabel?.(confirmDelete) ?? `#${confirmDelete.id}`)}</span>{" "}
          ใช่หรือไม่ การลบไม่มีผลกับตารางสอนที่จัดไปแล้ว แต่จะมีผลเมื่อจัดตารางใหม่
        </p>
      </Modal>
      {toast.node}
    </div>
  );
}

function FieldInput({ def, value, onChange }: { def: FieldDef; value: unknown; onChange: (v: unknown) => void }) {
  const wrap = def.full || def.type === "textarea" ? "sm:col-span-2" : "";
  if (def.type === "bool") {
    return (
      <label className={`flex min-h-10 cursor-pointer items-center gap-2.5 self-end rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 ${wrap}`}>
        <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {def.label}
      </label>
    );
  }
  return (
    <label className={`block ${wrap}`}>
      <span className="label">
        {def.label}
        {def.required && <span className="text-red-500"> *</span>}
      </span>
      {def.type === "select" ? (
        <select className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : def.type === "textarea" ? (
        <textarea className="input min-h-20" value={String(value ?? "")} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          className="input"
          type={def.type === "number" ? "number" : "text"}
          inputMode={def.type === "number" ? "numeric" : undefined}
          value={String(value ?? "")}
          placeholder={def.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {def.hint && <span className="mt-1 block text-xs text-slate-400">{def.hint}</span>}
    </label>
  );
}
