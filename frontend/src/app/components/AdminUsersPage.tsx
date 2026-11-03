import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Stethoscope,
  Trash2,
  UserCog,
  UserPlus,
  Users as UsersIcon,
  Wand2,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import {
  createUser,
  deleteUser,
  getHospitalDepartments,
  getRoles,
  getServices,
  getUsers,
  updateUser,
  type Department,
  type RoleRow,
  type ServiceCatalogItem,
  type UserRow,
} from "../lib/api";
import type { UserRole } from "../lib/auth";

const FIELD_CLASS =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-primary focus:ring-4 focus:ring-brand-500/10";

const LABEL_CLASS = "mb-1.5 block text-[13px] font-medium text-gray-700";

/** Per-role tint. Muted on purpose — the table should read as data, not confetti. */
const ROLE_TONES: Record<string, string> = {
  superadmin: "bg-violet-50 text-violet-700 ring-violet-100",
  management: "bg-sky-50 text-sky-700 ring-sky-100",
  admin: "bg-blue-50 text-blue-700 ring-blue-100",
  hod: "bg-amber-50 text-amber-700 ring-amber-100",
  staff: "bg-emerald-50 text-emerald-700 ring-emerald-100",
};

function roleTone(role: string): string {
  return ROLE_TONES[role] || "bg-gray-50 text-gray-600 ring-gray-200";
}

function RoleBadge({ role, label }: { role: string; label?: string }) {
  // Registry labels are already cased; only the raw key fallback needs it, and
  // `capitalize` would title-case a multi-word label.
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${
        label ? "" : "capitalize"
      } ${roleTone(role)}`}
    >
      {label || role}
    </span>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-gray-50 px-2 py-1 text-xs text-gray-600 ring-1 ring-inset ring-gray-200/70">
      {children}
    </span>
  );
}

function StatTile({
  icon,
  label,
  value,
  gradient,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  gradient: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-3 rounded-xl bg-gradient-to-br p-3 text-left sm:p-4 text-white shadow-sm transition ${gradient} ${
        active ? "ring-4 ring-offset-2 ring-gray-900/20" : "opacity-90 hover:opacity-100"
      }`}
    >
      <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/15 sm:grid">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold leading-none">{value}</span>
        <span className="mt-1 block text-xs leading-tight opacity-90 sm:truncate">{label}</span>
      </span>
    </button>
  );
}

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

/** Fallback role list when the roles API is unavailable. */
const FALLBACK_ROLES = [
  { key: "staff", label: "Staff", description: "Submits feedback for employees and views the dashboard." },
  { key: "hod", label: "HOD (Head of Department)", description: "Sees feedback for the departments and services they own." },
  { key: "admin", label: "Admin", description: "Manages users, settings and all feedback." },
];

const ROLE_ICONS: Record<string, typeof UsersIcon> = {
  staff: UserCog,
  hod: Stethoscope,
  admin: ShieldCheck,
  superadmin: ShieldCheck,
};

/** A readable random password (no look-alike characters such as 0/O or 1/l). */
function generatePassword(length = 10): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

function MappingChecklist({
  title,
  items,
  selectedIds,
  onChange,
  emptyLabel,
}: {
  title: string;
  items: Array<{ _id: string; name: string }>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  emptyLabel: string;
}) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.name.toLowerCase().includes(query));
  }, [items, filter]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-gray-700">{title}</span>
        {selectedIds.length > 0 ? (
          <span className="rounded-md bg-primary px-1.5 py-0.5 text-[11px] font-medium text-white">
            {selectedIds.length}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-500">
          {emptyLabel}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <div className="relative border-b border-gray-100">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              size={14}
            />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={`Filter ${title.toLowerCase()}…`}
              aria-label={`Filter ${title}`}
              className="w-full bg-white py-2 pl-8 pr-3 text-sm outline-none placeholder:text-gray-400"
            />
          </div>
          <div className="max-h-56 overflow-y-auto">
            {visible.length === 0 ? (
              <p className="px-3 py-4 text-sm text-gray-500">No match.</p>
            ) : (
              visible.map((item) => {
                const checked = selectedIds.includes(item._id);
                return (
                  <label
                    key={item._id}
                    className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm transition ${
                      checked ? "bg-gray-50" : "hover:bg-gray-50/70"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onChange(toggleId(selectedIds, item._id))}
                      className="h-4 w-4 shrink-0 rounded border-gray-300 accent-primary"
                    />
                    <span className={checked ? "font-medium text-gray-900" : "text-gray-600"}>
                      {item.name}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function hodMappingLabels(user: UserRow): { departments: string[]; services: string[] } {
  const departments =
    user.hodDepartments?.map((row) => row.name) ||
    (user.departmentId && typeof user.departmentId === "object" && "name" in user.departmentId
      ? [user.departmentId.name]
      : []);
  const services =
    user.hodServices?.map((row) => row.name) ||
    (user.serviceId && typeof user.serviceId === "object" && "name" in user.serviceId
      ? [user.serviceId.name]
      : []);
  return { departments, services };
}

function staffDepartmentName(user: UserRow): string {
  return user.departmentId && typeof user.departmentId === "object" && "name" in user.departmentId
    ? (user.departmentId as { name: string }).name
    : "";
}

/**
 * The chips a row shows, by role. Staff carry a single department; HODs carry
 * their department and service mappings. Both are deduped — hodMappingLabels
 * falls back to departmentId.name, so a HOD holding a legacy departmentId would
 * otherwise render the same name twice (and collide on the React key).
 */
function mappingChips(user: UserRow): string[] {
  const mappings = hodMappingLabels(user);
  const names =
    user.role === "staff"
      ? [staffDepartmentName(user)]
      : user.role === "hod"
        ? [...mappings.departments, ...mappings.services]
        : [];
  return [...new Set(names.filter(Boolean))];
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>("staff");
  // Roles are data now, so the picker is driven by the registry rather than a
  // hardcoded list — a role added in the RBAC screen shows up here.
  const [roleOptions, setRoleOptions] = useState<RoleRow[]>([]);

  useEffect(() => {
    void getRoles()
      .then((data) => setRoleOptions(data.roles))
      .catch(() => setRoleOptions([]));
  }, []);
  const [departmentId, setDepartmentId] = useState("");
  const [hodDepartmentIds, setHodDepartmentIds] = useState<string[]>([]);
  const [hodServiceIds, setHodServiceIds] = useState<string[]>([]);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const roleLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const option of roleOptions) map[option.key] = option.label;
    return map;
  }, [roleOptions]);

  const counts = useMemo(() => {
    const byRole: Record<string, number> = {};
    for (const user of users) byRole[user.role] = (byRole[user.role] || 0) + 1;
    return {
      total: users.length,
      privileged: (byRole.superadmin || 0) + (byRole.admin || 0) + (byRole.management || 0),
      hod: byRole.hod || 0,
      staff: byRole.staff || 0,
    };
  }, [users]);

  /**
   * Search spans everything a row displays — username, the role as both key and
   * label, and every mapping chip — so looking up "cardiology" finds the row the
   * same way reading it would. The role tiles narrow the same list.
   */
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter === "privileged") {
        if (!["superadmin", "admin", "management"].includes(user.role)) return false;
      } else if (roleFilter !== "all" && user.role !== roleFilter) {
        return false;
      }
      if (!query) return true;
      const mappings = hodMappingLabels(user);
      return [
        user.username,
        user.role,
        roleLabels[user.role] || "",
        staffDepartmentName(user),
        ...mappings.departments,
        ...mappings.services,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [users, search, roleFilter, roleLabels]);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const [u, d, s] = await Promise.all([getUsers(), getHospitalDepartments(), getServices()]);
      setUsers(u);
      setDepartments(d);
      setServices(s);
    } catch {
      setError("Could not load data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setRole("staff");
    setDepartmentId("");
    setHodDepartmentIds([]);
    setHodServiceIds([]);
    setEditingUserId(null);
  }

  function openCreate() {
    resetForm();
    setError(null);
    setSheetOpen(true);
  }

  function startEdit(user: UserRow) {
    setEditingUserId(user._id);
    setUsername(user.username);
    setPassword("");
    setShowPassword(false);
    setRole(user.role);

    if (user.role === "staff") {
      const userDept =
        user.departmentId && typeof user.departmentId === "object" && "_id" in user.departmentId
          ? user.departmentId._id
          : "";
      setDepartmentId(userDept);
      setHodDepartmentIds([]);
      setHodServiceIds([]);
    } else if (user.role === "hod") {
      setDepartmentId("");
      setHodDepartmentIds(user.hodDepartments?.map((row) => row._id) || []);
      setHodServiceIds(user.hodServices?.map((row) => row._id) || []);
    } else {
      setDepartmentId("");
      setHodDepartmentIds([]);
      setHodServiceIds([]);
    }
    setError(null);
    setSheetOpen(true);
  }

  /** Closing by any route — X, overlay, Escape — must not strand form state. */
  function onSheetOpenChange(open: boolean) {
    setSheetOpen(open);
    if (!open) {
      resetForm();
      setError(null);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (role === "staff" && !departmentId) {
      setError("Department is required for staff accounts.");
      return;
    }
    if (role === "hod" && hodDepartmentIds.length === 0 && hodServiceIds.length === 0) {
      setError("Select at least one department or service for this HOD.");
      return;
    }

    const payload = {
      username: username.trim(),
      role,
      ...(role === "staff"
        ? { departmentId }
        : role === "hod"
          ? {
              departmentIds: hodDepartmentIds,
              serviceIds: hodServiceIds,
            }
          : {}),
    };

    try {
      setError(null);
      setSaving(true);
      if (editingUserId) {
        await updateUser(editingUserId, {
          ...payload,
          ...(password.trim() ? { password } : {}),
        });
      } else {
        await createUser({
          ...payload,
          password,
        });
      }
      resetForm();
      setSheetOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteUser(userId: string) {
    if (!confirm("Delete this user?")) return;
    try {
      setError(null);
      await deleteUser(userId);
      if (editingUserId === userId) {
        resetForm();
        setSheetOpen(false);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  function onRoleChange(nextRole: UserRole) {
    setRole(nextRole);
    if (nextRole !== "hod") {
      setHodDepartmentIds([]);
      setHodServiceIds([]);
    }
    if (nextRole !== "staff") {
      setDepartmentId("");
    }
    if (nextRole === "admin") {
      setHodDepartmentIds([]);
      setHodServiceIds([]);
    }
  }

  const isFiltering = search.trim().length > 0 || roleFilter !== "all";

  return (
    <div className="w-full pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Users</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage admin, staff and HOD accounts, and the departments they own.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-primary-hover focus:outline-none focus:ring-4 focus:ring-brand-500/20"
        >
          <Plus size={16} />
          Add user
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          icon={<UsersIcon size={17} />}
          label="All accounts"
          value={counts.total}
          gradient="from-primary to-brand-800"
          active={roleFilter === "all"}
          onClick={() => setRoleFilter("all")}
        />
        <StatTile
          icon={<ShieldCheck size={17} />}
          label="Admin & management"
          value={counts.privileged}
          gradient="from-violet-600 to-violet-800"
          active={roleFilter === "privileged"}
          onClick={() => setRoleFilter("privileged")}
        />
        <StatTile
          icon={<Stethoscope size={17} />}
          label="Heads of department"
          value={counts.hod}
          gradient="from-amber-500 to-amber-600"
          active={roleFilter === "hod"}
          onClick={() => setRoleFilter("hod")}
        />
        <StatTile
          icon={<UserCog size={17} />}
          label="Staff"
          value={counts.staff}
          gradient="from-emerald-500 to-emerald-700"
          active={roleFilter === "staff"}
          onClick={() => setRoleFilter("staff")}
        />
      </div>

      {error && !sheetOpen ? (
        <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 shrink-0" size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200/80 bg-white">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="relative sm:w-80">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              size={15}
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, role or department…"
              aria-label="Search users"
              className={`${FIELD_CLASS} py-2 pl-9 ${search ? "pr-9" : ""}`}
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-0 top-0 grid h-full w-9 place-items-center text-gray-400 transition hover:text-gray-700"
              >
                <X size={15} />
              </button>
            ) : null}
          </div>
          <p className="text-xs text-gray-500">
            {loading
              ? "Loading…"
              : isFiltering
                ? `${filteredUsers.length} of ${users.length} accounts`
                : `${users.length} accounts`}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-16 text-sm text-gray-500">
            <Loader2 className="animate-spin" size={16} />
            Loading users…
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-16 text-center">
            <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-gray-50 text-gray-400">
              {users.length === 0 ? <UsersIcon size={20} /> : <Search size={20} />}
            </div>
            <p className="text-sm font-medium text-gray-800">
              {users.length === 0 ? "No users yet" : "No matching users"}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
              {users.length === 0
                ? "Create the first account to get started."
                : "Try a different search term, or clear the filters."}
            </p>
            {users.length === 0 ? (
              <button
                type="button"
                onClick={openCreate}
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-hover"
              >
                <Plus size={15} />
                Add user
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setRoleFilter("all");
                }}
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <X size={15} />
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
          {/* Phones: one card per account; the table takes over from tablet width. */}
          <ul className="divide-y divide-gray-100 md:hidden">
            {filteredUsers.map((u) => {
              const allMappings = mappingChips(u);
              return (
                <li key={u._id} className="flex items-start gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-mono text-sm font-medium text-gray-900">{u.username}</span>
                      <RoleBadge role={u.role} label={roleLabels[u.role]} />
                    </div>
                    {allMappings.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {allMappings.map((name) => (
                          <Chip key={name}>{name}</Chip>
                        ))}
                      </div>
                    ) : u.role === "hod" ? (
                      <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <AlertCircle size={12} />
                        No mappings
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(u)}
                    aria-label={`Edit ${u.username}`}
                    className="grid h-10 w-10 place-items-center rounded-lg text-gray-500 transition hover:bg-brand-50 hover:text-primary"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDeleteUser(u._id)}
                    aria-label={`Delete ${u.username}`}
                    className="grid h-10 w-10 place-items-center rounded-lg text-gray-500 transition hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                </li>
              );
            })}
          </ul>
          <div className="relative hidden overflow-x-auto md:block">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                    User
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                    Role
                  </th>
                  <th className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                    Departments &amp; services
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const allMappings = mappingChips(u);
                  return (
                    <tr
                      key={u._id}
                      className="group border-b border-gray-100 transition last:border-b-0 hover:bg-gray-50/60"
                    >
                      <td className="px-4 py-3 align-middle">
                        <span className="font-mono text-sm font-medium text-gray-900">
                          {u.username}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <RoleBadge role={u.role} label={roleLabels[u.role]} />
                      </td>
                      <td className="px-4 py-3 align-middle">
                        {allMappings.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {allMappings.map((name) => (
                              <Chip key={name}>{name}</Chip>
                            ))}
                          </div>
                        ) : u.role === "hod" ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                            <AlertCircle size={12} />
                            No mappings
                          </span>
                        ) : (
                          <span className="text-sm text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center justify-end gap-1 opacity-60 transition group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => startEdit(u)}
                            aria-label={`Edit ${u.username}`}
                            className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 transition hover:bg-brand-50 hover:text-primary"
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void onDeleteUser(u._id)}
                            aria-label={`Delete ${u.username}`}
                            className="grid h-8 w-8 place-items-center rounded-lg text-gray-500 transition hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
        <SheetContent className="w-full gap-0 bg-gray-50 p-0 sm:max-w-md">
          <SheetHeader className="gap-0 border-b border-gray-100 bg-white px-5 py-5 pr-14">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-primary">
                {editingUserId ? <UserCog size={20} /> : <UserPlus size={20} />}
              </span>
              <div className="min-w-0">
                <SheetTitle className="text-lg font-semibold text-gray-900">
                  {editingUserId ? "Edit user" : "Add user"}
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-sm text-gray-500">
                  {editingUserId
                    ? "Update the role or mappings. Leave the password blank to keep it."
                    : "The account can sign in as soon as it is created."}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <form onSubmit={onSubmit} autoComplete="off" className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sign-in</h3>
                <div>
                  <label htmlFor="user-username" className={LABEL_CLASS}>
                    Username <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="user-username"
                    name="pfs-account-id"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    className={`${FIELD_CLASS} font-mono`}
                    placeholder="e.g. drpriya"
                  />
                  <p className="mt-1.5 text-xs text-gray-500">Lowercase, no spaces. Used to sign in.</p>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label htmlFor="user-password" className="text-[13px] font-medium text-gray-700">
                      Password {editingUserId ? null : <span className="text-red-500">*</span>}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setPassword(generatePassword());
                        setShowPassword(true);
                      }}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-primary transition hover:bg-brand-50"
                    >
                      <Wand2 size={12} />
                      Generate
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="user-password"
                      name="pfs-account-secret"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required={!editingUserId}
                      minLength={editingUserId ? undefined : 6}
                      autoComplete="new-password"
                      data-1p-ignore
                      data-lpignore="true"
                      className={`${FIELD_CLASS} pr-11 ${showPassword ? "font-mono" : ""}`}
                      placeholder={editingUserId ? "Leave blank to keep current" : "At least 6 characters"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 grid w-11 place-items-center text-gray-400 transition hover:text-gray-700"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {showPassword && password ? (
                    <p className="mt-1.5 text-xs text-gray-500">Share this password with the user securely.</p>
                  ) : null}
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Role</h3>
                <div role="radiogroup" aria-label="Role" className="space-y-2">
                  {(roleOptions.length ? roleOptions : FALLBACK_ROLES).map((r) => {
                    const selected = role === r.key;
                    const RoleIcon = ROLE_ICONS[r.key] ?? UsersIcon;
                    return (
                      <label
                        key={r.key}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                          selected
                            ? "border-primary bg-brand-50/60 ring-1 ring-primary"
                            : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="user-role"
                          value={r.key}
                          checked={selected}
                          onChange={() => onRoleChange(r.key as UserRole)}
                          className="sr-only"
                        />
                        <span
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                            selected ? "bg-primary text-white" : "bg-gray-100 text-gray-500"
                          }`}
                        >
                          <RoleIcon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-gray-900">{r.label}</span>
                          {r.description ? (
                            <span className="mt-0.5 block text-xs leading-relaxed text-gray-500">
                              {r.description}
                            </span>
                          ) : null}
                        </span>
                        <span
                          aria-hidden
                          className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${
                            selected ? "border-primary" : "border-gray-300"
                          }`}
                        >
                          {selected ? <span className="h-1.5 w-1.5 rounded-full bg-primary" /> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>

              {role === "staff" ? (
                <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Department <span className="text-red-500">*</span>
                    </h3>
                    <p className="mt-1 text-xs text-gray-500">The department this staff member works in.</p>
                  </div>
                  <div className="relative">
                    <select
                      value={departmentId}
                      onChange={(e) => setDepartmentId(e.target.value)}
                      required
                      aria-label="Department"
                      className={`${FIELD_CLASS} cursor-pointer appearance-none pr-10`}
                    >
                      <option value="">Select a department</option>
                      {departments.map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      aria-hidden
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                  </div>
                </section>
              ) : null}

              {role === "hod" ? (
                <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                  <div className="flex items-start gap-2.5">
                    <Building2 className="mt-0.5 shrink-0 text-gray-400" size={16} />
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Owns</h3>
                      <p className="mt-1 text-xs leading-relaxed text-gray-500">
                        Feedback for every department and service ticked here appears on this HOD&rsquo;s
                        dashboard.
                      </p>
                    </div>
                  </div>
                  <MappingChecklist
                    title="Departments"
                    items={departments}
                    selectedIds={hodDepartmentIds}
                    onChange={setHodDepartmentIds}
                    emptyLabel="No departments in the catalog yet."
                  />
                  <MappingChecklist
                    title="Services"
                    items={services}
                    selectedIds={hodServiceIds}
                    onChange={setHodServiceIds}
                    emptyLabel="No routing services in the catalog yet."
                  />
                </section>
              ) : null}

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 shrink-0" size={16} />
                  <span>{error}</span>
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-gray-200 bg-white px-4 py-3.5 sm:justify-end sm:px-5">
              <button
                type="button"
                onClick={() => onSheetOpenChange(false)}
                className="flex-1 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:flex-none"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                {saving ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
                {editingUserId ? "Save changes" : "Create user"}
              </button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
