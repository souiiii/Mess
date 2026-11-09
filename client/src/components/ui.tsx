import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  X,
  AlertCircle,
  Inbox,
} from "lucide-react";
import { Link } from "react-router-dom";
import { ApiError, refresh } from "../api";
import { useToast } from "../context";
import type { Page } from "../types";
import { titleCase } from "../lib";
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      to="/app"
      className={`wordmark ${light ? "light" : ""}`}
      aria-label="The Mess home"
    >
      <span className="wordmark-the">THE</span>
      <span>
        MESS<span className="wordmark-period">.</span>
      </span>
    </Link>
  );
}
export function Button({
  children,
  busy,
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  variant?: "primary" | "outline" | "ghost";
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${className}`}
      aria-busy={busy || undefined}
    >
      {busy ? <LoaderCircle className="spin" size={16} /> : null}
      {children}
    </button>
  );
}
export function TextLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowUpRight size={16} />
    </Link>
  );
}
export function PageHead({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && <p className="serif-copy">{description}</p>}
      </div>
      {children && <div className="head-actions">{children}</div>}
    </header>
  );
}
export function SectionHead({
  title,
  children,
  number,
}: {
  title: string;
  children?: ReactNode;
  number?: string;
}) {
  return (
    <div className="section-head">
      <h2>
        {number && <span className="section-number">{number}</span>}
        {title}
      </h2>
      {children}
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${["PUBLISHED", "CONFIRMED", "ATTENDED", "APPROVED", "PAID", "SUCCESS", "FULFILLED", "RESOLVED", "ACTIVE"].includes(status) ? "solid" : ""}`}
    >
      {["ATTENDED", "PAID", "APPROVED", "SUCCESS"].includes(status) && (
        <Check size={10} />
      )}
      {titleCase(status)}
    </span>
  );
}
export function Empty({
  title,
  text,
  children,
}: {
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Inbox size={28} strokeWidth={1} />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
export function ErrorBox({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={17} />
      <div>
        <strong>
          {error instanceof Error ? error.message : "Something went wrong."}
        </strong>
        {error instanceof ApiError && error.details.length > 0 && (
          <ul>
            {error.details.map((detail, i) => (
              <li key={i}>
                {titleCase(detail.path.replace(/([A-Z])/g, " $1"))}:{" "}
                {detail.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      {retry && (
        <button
          className="icon-button"
          aria-label="Retry loading"
          onClick={retry}
        >
          <RefreshCw size={16} />
        </button>
      )}
    </div>
  );
}
export function Load({
  query,
  children,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => unknown;
  };
  children: ReactNode;
}) {
  if (query.isPending)
    return (
      <div className="skeleton-grid" aria-label="Loading" role="status">
        <span />
        <span />
        <span />
      </div>
    );
  if (query.isError)
    return <ErrorBox error={query.error} retry={() => query.refetch()} />;
  return <>{children}</>;
}
export function Modal({
  title,
  eyebrow = "THE MESS /",
  onClose,
  children,
  wide = false,
  busy = false,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby={label}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !ref.current?.querySelector("fieldset:disabled"))
          onClose();
      }}
      onClick={(event) => {
        if (
          event.target === ref.current &&
          !busy &&
          !ref.current?.querySelector("fieldset:disabled")
        )
          onClose();
      }}
    >
      <div className="modal-inner">
        <header>
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={label}>{title}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close dialog"
            onClick={() => {
              if (!ref.current?.querySelector("fieldset:disabled")) onClose();
            }}
            disabled={busy}
          >
            <X size={22} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export interface Field {
  name: string;
  label: string;
  type?: string;
  value?: string | number;
  placeholder?: string;
  required?: boolean;
  min?: string | number;
  max?: string | number;
  step?: string;
  options?: { value: string; label: string }[];
  help?: string;
  full?: boolean;
  pattern?: string;
  autoComplete?: string;
}
export function Fields({ fields }: { fields: Field[] }) {
  return (
    <div className="form-grid">
      {fields.map((field) => (
        <label
          className={`field ${field.full || field.type === "textarea" ? "full" : ""}`}
          key={field.name}
        >
          <span>
            {field.label}
            {field.required === false && <small>Optional</small>}
          </span>
          {field.options ? (
            <select
              aria-label={field.label}
              name={field.name}
              defaultValue={field.value ?? ""}
              required={field.required !== false}
            >
              {field.options.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.type === "textarea" ? (
            <textarea
              aria-label={field.label}
              name={field.name}
              defaultValue={field.value}
              placeholder={field.placeholder}
              required={field.required !== false}
              maxLength={Number(field.max ?? 5000)}
              rows={4}
            />
          ) : (
            <input
              aria-label={field.label}
              minLength={
                field.type === "password" ? Number(field.min ?? 1) : undefined
              }
              name={field.name}
              type={field.type ?? "text"}
              defaultValue={field.value}
              placeholder={field.placeholder}
              required={field.required !== false}
              min={field.min}
              max={field.max}
              step={field.step}
              maxLength={
                ["number", "date", "month", "datetime-local"].includes(
                  field.type ?? "",
                )
                  ? undefined
                  : Number(field.max ?? 254)
              }
              pattern={field.pattern}
              autoComplete={field.autoComplete}
            />
          )}
          {field.help && <small>{field.help}</small>}
        </label>
      ))}
    </div>
  );
}
export function ActionForm({
  fields,
  onSubmit,
  onDone,
  submit = "Save changes",
  success = "Saved.",
  children,
}: {
  fields: Field[];
  onSubmit: (values: Record<string, string>) => Promise<unknown>;
  onDone?: () => void;
  submit?: string;
  success?: string;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toast = useToast();
  const lock = useRef(false);
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const values = Object.fromEntries(
      new FormData(event.currentTarget),
    ) as Record<string, string>;
    try {
      await onSubmit(values);
      await refresh();
      toast(success);
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={handle} className="action-form">
      <fieldset disabled={busy}>
        <Fields fields={fields} />
        {children}
        {error ? <ErrorBox error={error} /> : null}
        <div className="form-footer">
          <Button type="submit" busy={busy}>
            {submit}
            <ArrowRight size={16} />
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const lock = useRef(false);
  return {
    busy,
    run: async (
      task: () => Promise<unknown>,
      success: string,
      done?: () => void,
    ) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      try {
        await task();
        await refresh();
        toast(success);
        done?.();
      } catch (error) {
        toast(
          error instanceof Error ? error.message : "The action failed.",
          true,
        );
      } finally {
        setBusy(false);
        lock.current = false;
      }
    },
  };
}
export function useIdempotency() {
  const keys = useRef(new Map<string, string>());
  const next = (body: object) => {
    const value = JSON.stringify(body);
    if (!keys.current.has(value)) keys.current.set(value, crypto.randomUUID());
    return keys.current.get(value)!;
  };
  return Object.assign(next, {
    reset: (body: object) => keys.current.delete(JSON.stringify(body)),
  });
}
export function Pagination({
  data,
  onPage,
}: {
  data?: Pick<Page<unknown>, "page" | "limit" | "total">;
  onPage: (page: number) => void;
}) {
  if (!data || data.total <= data.limit) return null;
  const pages = Math.ceil(data.total / data.limit);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span>
        {(data.page - 1) * data.limit + 1}–
        {Math.min(data.page * data.limit, data.total)} of {data.total}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Previous page"
          disabled={data.page <= 1}
          onClick={() => onPage(data.page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          {data.page} / {pages}
        </span>
        <button
          className="icon-button"
          aria-label="Next page"
          disabled={data.page >= pages}
          onClick={() => onPage(data.page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </nav>
  );
}
export function Tabs({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="tabs" role="group" aria-label="View filter">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          key={option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
export function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
export function Back({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="back-link">
      <ArrowLeft size={14} />
      {children}
    </Link>
  );
}
export const options = (...values: string[]) =>
  values.map((value) => ({ value, label: titleCase(value) }));
