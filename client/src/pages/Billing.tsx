import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  Download,
  Plus,
  Receipt,
  X,
  ArrowLeft,
} from "lucide-react";
import { api, useApi } from "../api";
import { useAuth } from "../context";
import type {
  Attempt,
  Dashboard,
  Invoice,
  Page,
  Preview,
  User,
} from "../types";
import {
  ActionForm,
  Badge,
  Button,
  Empty,
  Load,
  Modal,
  PageHead,
  Pagination,
  Stat,
  Tabs,
  useIdempotency,
} from "../components/ui";
import {
  addDays,
  dateLabel,
  management,
  money,
  monthLabel,
  paise,
  today,
} from "../lib";
export default function BillingPage() {
  const { user } = useAuth();
  const manage = management(user!.role);
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [issue, setIssue] = useState(false);
  const q = useApi<Page<Invoice>>(
    `/invoices?page=${page}&limit=15${month ? `&month=${month}` : ""}`,
  );
  const dash = useApi<Dashboard>("/dashboard");
  const preview = useApi<Preview>(
    !manage ? `/billing/preview?month=${today().slice(0, 7)}` : null,
  );
  return (
    <div className="page-enter">
      <PageHead
        eyebrow="CLEAR NUMBERS. NO SURPRISES."
        title={manage ? "The accounts." : "Every meal, accounted for."}
        description={
          manage
            ? "One clear view of the mess ledger."
            : "Your monthly table, in numbers."
        }
      >
        {manage && (
          <Button onClick={() => setIssue(true)}>
            <Plus size={16} />
            Issue invoices
          </Button>
        )}
      </PageHead>
      {!manage && (
        <Load query={dash}>
          <Load query={preview}>
            <div className="billing-cover">
              <div className="billing-cover-main">
                <span className="eyebrow">OUTSTANDING BALANCE</span>
                <strong>{money(dash.data?.outstandingPaise)}</strong>
                <span>
                  {dash.data?.paymentsMode === "FAKE"
                    ? "Demo checkout · no real money moves"
                    : "Settled through the mess office"}
                </span>
              </div>
              <div>
                <span className="eyebrow">
                  {monthLabel(today().slice(0, 7))}
                </span>
                <h2>
                  A month
                  <br />
                  in the making.
                </h2>
                <div className="statement-preview">
                  <span>Booked meals & extras</span>
                  <strong>{money(preview.data?.totalPaise)}</strong>
                </div>
                <p className="small muted">
                  Your final statement arrives after the month closes.
                </p>
              </div>
            </div>
          </Load>
        </Load>
      )}
      <div className="filter-line">
        <span className="eyebrow">
          {manage ? "INVOICE LEDGER" : "YOUR STATEMENTS"}
        </span>
        <div className="toolbar-controls">
          <label className="compact-field">
            <span>Month</span>
            <input
              type="month"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setPage(1);
              }}
            />
          </label>
          {month && (
            <button className="text-button" onClick={() => setMonth("")}>
              Clear
            </button>
          )}
          {manage && (
            <a
              className="button outline"
              href={`/api/v1/reports/billing/export?month=${month || today().slice(0, 7)}`}
            >
              <Download size={14} />
              Export CSV
            </a>
          )}
        </div>
      </div>
      <Load query={q}>
        {q.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Statement</th>
                  {manage && <th>Resident</th>}
                  <th>Amount</th>
                  <th>Remaining</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th>
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <button
                        className="table-link"
                        onClick={() => setSelected(invoice.id)}
                      >
                        {monthLabel(invoice.month)}
                      </button>
                      <small className="cell-secondary">
                        #{invoice.id.slice(0, 8).toUpperCase()}
                      </small>
                    </td>
                    {manage && (
                      <td>
                        {invoice.name}
                        <small className="cell-secondary">
                          {invoice.roll_number}
                        </small>
                      </td>
                    )}
                    <td>{money(invoice.total_paise)}</td>
                    <td>
                      <strong>{money(invoice.outstanding_paise)}</strong>
                    </td>
                    <td>{dateLabel(invoice.due_on)}</td>
                    <td>
                      <Badge status={invoice.status} />
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`View ${monthLabel(invoice.month)} statement${invoice.name ? ` for ${invoice.name}` : ""}`}
                        onClick={() => setSelected(invoice.id)}
                      >
                        <ArrowUpRight size={19} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="A clean slate."
            text="Issued monthly statements will appear here."
          />
        )}
        <Pagination data={q.data} onPage={setPage} />
      </Load>
      {selected && (
        <InvoiceDialog id={selected} onClose={() => setSelected(null)} />
      )}
      {issue && (
        <Modal wide title="Close the month." onClose={() => setIssue(false)}>
          <IssueForm done={() => setIssue(false)} />
        </Modal>
      )}
    </div>
  );
}
function IssueForm({ done }: { done: () => void }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const q = useApi<Page<User>>(
    `/users?role=STUDENT&limit=10&page=${page}&search=${encodeURIComponent(search)}`,
  );
  const last = new Date(`${today().slice(0, 7)}-01T12:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() - 1);
  return (
    <>
      <label className="field">
        <span>Find residents</span>
        <input
          placeholder="Name, roll number or email"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </label>
      <Load query={q}>
        <div className="selection-list">
          {q.data?.items.map((resident) => (
            <label key={resident.id}>
              <input
                type="checkbox"
                checked={!!selected[resident.id]}
                onChange={(event) => {
                  const next = { ...selected };
                  if (event.target.checked) next[resident.id] = resident.name;
                  else delete next[resident.id];
                  setSelected(next);
                }}
              />
              <span>
                {resident.name}
                <small>{resident.roll_number}</small>
              </span>
            </label>
          ))}
        </div>
        <Pagination data={q.data} onPage={setPage} />
      </Load>
      <p className="small">
        {Object.keys(selected).length} selected{" "}
        <button className="text-button" onClick={() => setSelected({})}>
          Clear selection
        </button>
      </p>
      <ActionForm
        fields={[
          {
            name: "month",
            label: "Billing month",
            type: "month",
            value: last.toISOString().slice(0, 7),
            max: last.toISOString().slice(0, 7),
          },
          {
            name: "dueOn",
            label: "Due date",
            type: "date",
            value: addDays(today(), 7),
            min: today(),
          },
        ]}
        submit="Issue statements"
        success="Statements issued."
        onDone={done}
        onSubmit={(values) => {
          const userIds = Object.keys(selected);
          if (!userIds.length || userIds.length > 100)
            return Promise.reject(
              new Error("Select between 1 and 100 residents."),
            );
          return api("/invoices/bulk", "POST", { ...values, userIds });
        }}
      />
    </>
  );
}
function InvoiceDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useAuth();
  const q = useApi<Invoice>(`/invoices/${id}`);
  const [attemptPage, setAttemptPage] = useState(1);
  const attempts = useApi<Page<Attempt>>(
    `/invoices/${id}/payment-attempts?limit=10&page=${attemptPage}`,
  );
  const [view, setView] = useState("statement");
  const [checkout, setCheckout] = useState(false);
  const [result, setResult] = useState<{
    attempt: Attempt;
    invoice: Invoice;
  } | null>(null);
  const key = useIdempotency();
  const invoice = q.data;
  const mayPay =
    invoice &&
    user?.role === "STUDENT" &&
    user.id === invoice.user_id &&
    invoice.payments_mode === "FAKE";
  return (
    <Modal
      title={
        checkout
          ? result
            ? result.attempt.outcome === "SUCCESS"
              ? "All taken care of."
              : "Let’s try that again."
            : "Settle your table."
          : invoice
            ? monthLabel(invoice.month)
            : "Your statement"
      }
      eyebrow={
        checkout ? "DEMO CHECKOUT / NO REAL MONEY" : "THE MONTHLY STATEMENT"
      }
      wide={!checkout}
      onClose={onClose}
    >
      <Load query={q}>
        {invoice &&
          (checkout ? (
            result ? (
              <div className="payment-result">
                {result.attempt.outcome === "SUCCESS" ? (
                  <Check size={48} strokeWidth={1} />
                ) : (
                  <X size={48} strokeWidth={1} />
                )}
                <h3>
                  {result.attempt.outcome === "SUCCESS"
                    ? money(result.attempt.amount_paise)
                    : "Payment declined."}
                </h3>
                <p>
                  {result.attempt.outcome === "SUCCESS"
                    ? "Your simulated payment is recorded."
                    : "This was a simulated decline. Your balance is unchanged."}
                </p>
                <span className="eyebrow">
                  REMAINING {money(result.invoice.outstanding_paise)}
                </span>
                <Button
                  onClick={() => {
                    setCheckout(false);
                    setResult(null);
                  }}
                >
                  Back to statement
                  <ArrowRightIcon />
                </Button>
              </div>
            ) : (
              <>
                <div className="checkout-total">
                  <span className="eyebrow">BALANCE DUE</span>
                  <strong>{money(invoice.outstanding_paise)}</strong>
                </div>
                <ActionForm
                  fields={[
                    {
                      name: "amount",
                      label: "Amount (₹)",
                      type: "number",
                      value: invoice.outstanding_paise / 100,
                      min: 0.01,
                      max: invoice.outstanding_paise / 100,
                      step: ".01",
                    },
                    {
                      name: "outcome",
                      label: "Simulation outcome",
                      value: "SUCCESS",
                      options: [
                        { value: "SUCCESS", label: "Successful payment" },
                        { value: "FAILURE", label: "Declined payment" },
                      ],
                    },
                  ]}
                  submit="Simulate payment"
                  success="Simulation complete."
                  onSubmit={async (values) => {
                    const body = {
                      amountPaise: paise(values.amount!),
                      outcome: values.outcome,
                    };
                    const response = await api<{
                      attempt: Attempt;
                      invoice: Invoice;
                    }>(`/invoices/${id}/fake-payment`, "POST", {
                      ...body,
                      idempotencyKey: key(body),
                    });
                    key.reset(body);
                    setResult(response);
                  }}
                />
                <button
                  className="text-button"
                  onClick={() => setCheckout(false)}
                >
                  <ArrowLeft size={13} />
                  Back to statement
                </button>
              </>
            )
          ) : (
            <>
              <div className="invoice-top">
                <div>
                  <span className="eyebrow">
                    STATEMENT #{invoice.id.slice(0, 8).toUpperCase()}
                  </span>
                  <p>
                    Issued {dateLabel(invoice.issued_at)} · Due{" "}
                    {dateLabel(invoice.due_on)}
                  </p>
                </div>
                <Badge status={invoice.status} />
              </div>
              <div className="invoice-totals">
                <Stat label="TOTAL" value={money(invoice.total_paise)} />
                <Stat label="PAID" value={money(invoice.paid_paise)} />
                <Stat
                  label="REMAINING"
                  value={money(invoice.outstanding_paise)}
                />
              </div>
              <Tabs
                value={view}
                onChange={setView}
                options={[
                  { value: "statement", label: "Line items" },
                  { value: "payments", label: "Payments" },
                  { value: "attempts", label: "Attempts" },
                ]}
              />
              {view === "statement" ? (
                <div className="invoice-lines">
                  {invoice.lines?.map((line) => (
                    <div key={line.id}>
                      <span>
                        {line.description}
                        <small>
                          {line.quantity} × {money(line.unit_price_paise)}
                        </small>
                      </span>
                      <strong>
                        {money(line.quantity * line.unit_price_paise)}
                      </strong>
                    </div>
                  ))}
                  {!invoice.lines?.length && (
                    <p className="muted">No charges this month.</p>
                  )}
                </div>
              ) : view === "payments" ? (
                <div className="invoice-lines">
                  {invoice.payments?.map((payment) => (
                    <div key={payment.id}>
                      <span>
                        {payment.method === "FAKE"
                          ? "Simulated payment"
                          : payment.method}
                        <small>
                          {dateLabel(payment.created_at)} · {payment.reference}
                        </small>
                      </span>
                      <strong>{money(payment.amount_paise)}</strong>
                    </div>
                  ))}
                  {!invoice.payments?.length && (
                    <Empty title="No payments yet." />
                  )}
                </div>
              ) : (
                <Load query={attempts}>
                  {attempts.data?.items.map((attempt) => (
                    <div className="story-row" key={attempt.id}>
                      <span>{dateLabel(attempt.created_at)}</span>
                      <strong>{money(attempt.amount_paise)}</strong>
                      <Badge status={attempt.outcome} />
                    </div>
                  ))}
                  {!attempts.data?.items.length && (
                    <Empty title="No payment attempts." />
                  )}
                  <Pagination data={attempts.data} onPage={setAttemptPage} />
                </Load>
              )}
              {invoice.outstanding_paise > 0 && mayPay && (
                <Button
                  className="full-width"
                  onClick={() => setCheckout(true)}
                >
                  Pay {money(invoice.outstanding_paise)}
                  <ArrowUpRight size={16} />
                </Button>
              )}
              {invoice.outstanding_paise > 0 &&
                management(user!.role) &&
                invoice.payments_mode === "MANUAL" && (
                  <details className="extras-details">
                    <summary>Record a verified payment +</summary>
                    <ActionForm
                      fields={[
                        {
                          name: "amount",
                          label: "Amount (₹)",
                          type: "number",
                          min: 0.01,
                          max: invoice.outstanding_paise / 100,
                          step: ".01",
                        },
                        {
                          name: "method",
                          label: "Method",
                          options: ["CASH", "UPI", "BANK_TRANSFER"].map(
                            (value) => ({
                              value,
                              label: value.replace("_", " "),
                            }),
                          ),
                        },
                        {
                          name: "reference",
                          label: "Receipt / transaction reference",
                          full: true,
                          max: 100,
                        },
                      ]}
                      submit="Record payment"
                      onSubmit={(values) => {
                        const body = {
                          amountPaise: paise(values.amount!),
                          method: values.method,
                          reference: values.reference,
                        };
                        return api(`/invoices/${id}/payments`, "POST", {
                          ...body,
                          idempotencyKey: key(body),
                        });
                      }}
                    />
                  </details>
                )}
              {invoice.payments_mode === "FAKE" && (
                <p className="fine-print">
                  <Receipt size={13} />
                  Demo payments only. No money is collected.
                </p>
              )}
            </>
          ))}
      </Load>
    </Modal>
  );
}
function ArrowRightIcon() {
  return <ArrowUpRight size={16} />;
}
