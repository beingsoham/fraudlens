import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PencilLine, Search, UserPlus } from 'lucide-react';
import {
  PAGE_SIZE_OPTIONS,
  PERMISSION,
  ROLE_DESCRIPTIONS,
  USER_ROLES,
} from '@fraudlens/shared/constants';
import { createUserSchema, updateUserSchema } from '@fraudlens/shared/schemas';
import { TopBar } from '../components/layout/TopBar.jsx';
import { PageBody } from '../components/layout/PageBody.jsx';
import {
  Badge,
  Button,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Notice,
  Pagination,
  Panel,
  Select,
  SortableHeader,
} from '../components/ui/index.jsx';
import { useApi, useDebounced, useMutation } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { usersApi } from '../services/endpoints.js';
import { formatDateTime, formatNumber, formatRelative } from '../utils/format.js';

/**
 * User and role administration.
 *
 * Three things this page deliberately cannot do, because the API refuses them:
 * read a password back (no endpoint returns one), let an administrator change
 * their own role or deactivate themselves, or remove the last active
 * administrator. The UI explains each refusal rather than hiding the control and
 * leaving the user guessing.
 */
export function UsersPage() {
  const { can, user: currentUser } = useAuth();
  const canWrite = can(PERMISSION.USERS_WRITE);

  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [isActive, setIsActive] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);

  const debouncedSearch = useDebounced(search, 300);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy,
      sortDir,
      search: debouncedSearch || undefined,
      role: role || undefined,
      isActive: isActive || undefined,
    }),
    [page, pageSize, sortBy, sortDir, debouncedSearch, role, isActive],
  );

  const { data, meta, error, isLoading, refetch } = useApi(
    (options) => usersApi.list(params, options),
    [params],
  );

  useEffect(() => setPage(1), [debouncedSearch, role, isActive, pageSize]);

  const onSort = (field) => {
    if (sortBy === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  const afterWrite = (message) => {
    setNotice(message);
    setCreateOpen(false);
    setEditing(null);
    refetch();
  };

  return (
    <>
      <TopBar
        title="Users and roles"
        subtitle={meta ? `${formatNumber(meta.total)} accounts` : 'Loading…'}
        actions={
          canWrite ? (
            <Button variant="primary" className="text-xs" onClick={() => setCreateOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              New user
            </Button>
          ) : null
        }
      />

      <PageBody>
        {notice ? (
          <Notice tone="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Notice>
        ) : null}

        <Panel>
          <div className="grid grid-cols-1 gap-3 border-b border-line/70 px-5 py-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {USER_ROLES.map((roleName) => (
              <div
                key={roleName}
                className="rounded-lg border border-line bg-surface-2/70 px-3 py-2"
              >
                <p className="text-2xs font-semibold uppercase tracking-wider text-accent">
                  {roleName}
                </p>
                <p className="mt-0.5 text-2xs leading-relaxed text-fg-muted">
                  {ROLE_DESCRIPTIONS[roleName]}
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3.5">
            <div className="relative min-w-[220px] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-9"
                placeholder="Search by name or email…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search users"
              />
            </div>
            <Select
              className="w-40"
              value={role}
              onChange={(event) => setRole(event.target.value)}
              aria-label="Filter by role"
            >
              <option value="">All roles</option>
              {USER_ROLES.map((roleName) => (
                <option key={roleName} value={roleName}>
                  {roleName}
                </option>
              ))}
            </Select>
            <Select
              className="w-36"
              value={isActive}
              onChange={(event) => setIsActive(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="">Any status</option>
              <option value="true">Active</option>
              <option value="false">Deactivated</option>
            </Select>
            <Select
              className="w-24"
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value))}
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </Select>
          </div>

          {error ? (
            <div className="p-4">
              <ErrorBlock error={error} onRetry={refetch} />
            </div>
          ) : isLoading && !data ? (
            <LoadingBlock rows={6} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-head">
                    <tr>
                      <SortableHeader
                        field="name"
                        label="Name"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <SortableHeader
                        field="email"
                        label="Email"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <SortableHeader
                        field="role"
                        label="Role"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      <th scope="col" className="px-4 py-2.5">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right">
                        Activity
                      </th>
                      <th scope="col" className="px-4 py-2.5">
                        Last sign-in
                      </th>
                      <SortableHeader
                        field="createdAt"
                        label="Created"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={onSort}
                      />
                      {canWrite ? <th scope="col" className="px-4 py-2.5" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {data?.map((person) => (
                      <tr key={person.id} className="table-row">
                        <td className="px-4 py-2.5 text-xs text-fg">
                          {person.name}
                          {person.id === currentUser?.id ? (
                            <span className="ml-1.5 text-2xs text-accent">you</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-fg-muted">
                          {person.email}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge className="border border-accent/30 bg-accent/10 text-accent">
                            {person.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          {person.isActive ? (
                            <Badge className="border border-risk-low/30 bg-risk-low/10 text-risk-low">
                              Active
                            </Badge>
                          ) : (
                            <Badge className="border border-risk-high/30 bg-risk-high/10 text-risk-high">
                              Deactivated
                            </Badge>
                          )}
                        </td>
                        <td className="tabular px-4 py-2.5 text-right text-2xs text-fg-muted">
                          {formatNumber(person.activity?.assignedAlerts ?? 0)} alerts ·{' '}
                          {formatNumber(person.activity?.investigationNotes ?? 0)} notes
                        </td>
                        <td className="px-4 py-2.5 text-xs text-fg-muted">
                          {person.lastLoginAt ? formatRelative(person.lastLoginAt) : 'never'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-fg-muted">
                          {formatDateTime(person.createdAt)}
                        </td>
                        {canWrite ? (
                          <td className="px-4 py-2.5 text-right">
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-2xs"
                              onClick={() => setEditing(person)}
                            >
                              <PencilLine className="h-3 w-3" aria-hidden="true" />
                              Edit
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination meta={meta} onPageChange={setPage} />
            </>
          )}
        </Panel>

        <Notice tone="info">
          Passwords are stored only as bcrypt hashes and no endpoint in this application returns a
          password or a hash. An administrator can reset a password but never read one.
        </Notice>
      </PageBody>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={afterWrite}
      />
      <EditUserModal
        person={editing}
        isSelf={editing?.id === currentUser?.id}
        onClose={() => setEditing(null)}
        onUpdated={afterWrite}
      />
    </>
  );
}

function CreateUserModal({ open, onClose, onCreated }) {
  const create = useMutation((payload) => usersApi.create(payload));
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', password: '', role: 'VIEWER', isActive: true },
  });

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const onSubmit = async (values) => {
    try {
      const result = await create.mutate(values);
      onCreated(`User ${result.data.email} created with the ${result.data.role} role.`);
    } catch (error) {
      // Field-level errors from the API are mapped back onto the form inputs.
      for (const [field, message] of Object.entries(error.fieldErrors ?? {})) {
        setError(field, { message });
      }
      if (Object.keys(error.fieldErrors ?? {}).length === 0) {
        setError('root', { message: error.message });
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a user"
      description="The password is hashed with bcrypt before storage and can never be read back."
      footer={
        <>
          <Button variant="ghost" className="text-xs" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-user"
            variant="primary"
            className="text-xs"
            isLoading={isSubmitting || create.isPending}
          >
            Create user
          </Button>
        </>
      }
    >
      <form id="create-user" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {errors.root ? <Notice tone="error">{errors.root.message}</Notice> : null}

        <Field label="Full name" error={errors.name?.message} htmlFor="new-name">
          <Input id="new-name" {...register('name')} invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Email address" error={errors.email?.message} htmlFor="new-email">
          <Input
            id="new-email"
            type="email"
            {...register('email')}
            invalid={Boolean(errors.email)}
          />
        </Field>
        <Field
          label="Initial password"
          error={errors.password?.message}
          hint="At least 12 characters, with an upper-case letter, a lower-case letter and a digit."
          htmlFor="new-password"
        >
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            {...register('password')}
            invalid={Boolean(errors.password)}
          />
        </Field>
        <Field label="Role" error={errors.role?.message} htmlFor="new-role">
          <Select id="new-role" {...register('role')}>
            {USER_ROLES.map((roleName) => (
              <option key={roleName} value={roleName}>
                {roleName} — {ROLE_DESCRIPTIONS[roleName]}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

function EditUserModal({ person, isSelf, onClose, onUpdated }) {
  const update = useMutation((payload) => usersApi.update(person.id, payload));
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(updateUserSchema) });

  useEffect(() => {
    if (person) {
      reset({
        name: person.name,
        email: person.email,
        role: person.role,
        isActive: person.isActive,
      });
    }
  }, [person, reset]);

  if (!person) return null;

  const onSubmit = async (values) => {
    // Only send what actually changed, so an unchanged email does not trip the
    // uniqueness check and a blank password field is not sent as a reset.
    const payload = {};
    if (values.name !== person.name) payload.name = values.name;
    if (values.email !== person.email) payload.email = values.email;
    if (values.role !== person.role) payload.role = values.role;
    if (values.isActive !== person.isActive) payload.isActive = values.isActive;
    if (values.password) payload.password = values.password;

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    try {
      const result = await update.mutate(payload);
      onUpdated(`User ${result.data.email} updated.`);
    } catch (error) {
      for (const [field, message] of Object.entries(error.fieldErrors ?? {})) {
        setError(field, { message });
      }
      if (Object.keys(error.fieldErrors ?? {}).length === 0) {
        setError('root', { message: error.message });
      }
    }
  };

  return (
    <Modal
      open={Boolean(person)}
      onClose={onClose}
      title={`Edit ${person.name}`}
      description="Leave the password blank to keep the current one."
      footer={
        <>
          <Button variant="ghost" className="text-xs" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="edit-user"
            variant="primary"
            className="text-xs"
            isLoading={isSubmitting || update.isPending}
          >
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-user" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {errors.root ? <Notice tone="error">{errors.root.message}</Notice> : null}

        {isSelf ? (
          <Notice tone="warning">
            This is your own account. You cannot change your own role or deactivate yourself — ask
            another administrator. This prevents both an accidental lockout and a self-granted
            privilege escalation.
          </Notice>
        ) : null}

        <Field label="Full name" error={errors.name?.message} htmlFor="edit-name">
          <Input id="edit-name" {...register('name')} invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Email address" error={errors.email?.message} htmlFor="edit-email">
          <Input
            id="edit-email"
            type="email"
            {...register('email')}
            invalid={Boolean(errors.email)}
          />
        </Field>
        <Field label="Role" error={errors.role?.message} htmlFor="edit-role">
          <Select id="edit-role" {...register('role')} disabled={isSelf}>
            {USER_ROLES.map((roleName) => (
              <option key={roleName} value={roleName}>
                {roleName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Account status">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white/80 px-3 py-2">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-accent"
              {...register('isActive')}
              disabled={isSelf}
            />
            <span className="text-xs text-fg">
              Active — a deactivated account cannot sign in, and its live sessions stop working
              immediately
            </span>
          </label>
        </Field>
        <Field
          label="Reset password"
          error={errors.password?.message}
          hint="Leave blank to keep the current password. A new password is hashed and cannot be read back."
          htmlFor="edit-password"
        >
          <Input
            id="edit-password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••••••"
            {...register('password')}
            invalid={Boolean(errors.password)}
          />
        </Field>
      </form>
    </Modal>
  );
}
