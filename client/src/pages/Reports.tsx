import { useState } from "react";
import { Download } from "lucide-react";
import { useApi } from "../api";
import {
  Empty,
  Load,
  PageHead,
  SectionHead,
  Stat,
  Tabs,
} from "../components/ui";
import { addDays, dateLabel, money, titleCase, today } from "../lib";
import type { FinancialReport, ServiceReport } from "../types";
export default function ReportsPage() {
  const [tab, setTab] = useState("service");
  const [from, setFrom] = useState(addDays(today(), -6));
  const [to, setTo] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const operations = useApi<{ services: ServiceReport[] }>(
    tab === "service" ? `/reports/operations?from=${from}&to=${to}` : null,
  );
  const financial = useApi<FinancialReport>(
    tab === "finance" ? `/reports/billing?month=${month}` : null,
  );
  const rows = operations.data?.services ?? [];
  const sum = (key: "booked" | "attended" | "waste_grams" | "feedback_count") =>
    rows.reduce((n, row) => n + (row[key] ?? 0), 0);
  const days = [...new Set(rows.map((row) => row.service_date))].map(
    (date) => ({
      date,
      booked: rows
        .filter((row) => row.service_date === date)
        .reduce((n, row) => n + row.booked, 0),
      attended: rows
        .filter((row) => row.service_date === date)
        .reduce((n, row) => n + row.attended, 0),
    }),
  );
  const max = Math.max(1, ...days.map((day) => day.booked));
  const f = financial.data;
  return (
    <div className="page-enter">
      <PageHead
        eyebrow="THE BIGGER PICTURE"
        title="Every meal adds up."
        description="A closer look at the way we serve."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "service", label: "Service & attendance" },
          { value: "finance", label: "Financial overview" },
        ]}
      />
      {tab === "service" ? (
        <>
          <div className="filter-line">
            <span className="eyebrow">SERVICE PERIOD</span>
            <div className="inline-controls">
              <label>
                From
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(event) =>
                    event.target.value && setFrom(event.target.value)
                  }
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={to}
                  min={from}
                  max={addDays(from, 92)}
                  onChange={(event) =>
                    event.target.value && setTo(event.target.value)
                  }
                />
              </label>
            </div>
          </div>
          <Load query={operations}>
            <section className="stats-strip">
              <Stat label="BOOKED" value={sum("booked")} />
              <Stat label="SERVED" value={sum("attended")} />
              <Stat
                label="RECORDED WASTE"
                value={`${(sum("waste_grams") / 1000).toLocaleString("en-IN")} kg`}
              />
              <Stat label="MEAL REVIEWS" value={sum("feedback_count")} />
            </section>
            {days.length ? (
              <>
                <SectionHead title="A rhythm of daily meals.">
                  <div className="chart-legend">
                    <span>Booked</span>
                    <span>Served</span>
                  </div>
                </SectionHead>
                <div
                  className="chart"
                  role="img"
                  aria-label="Daily bookings and attendance. Exact values are shown with each bar."
                >
                  {days.map((day) => (
                    <div className="chart-column" key={day.date}>
                      <div className="chart-bars">
                        <div
                          style={{ height: `${(day.booked / max) * 100}%` }}
                          title={`${day.booked} booked`}
                        />
                        <div
                          style={{ height: `${(day.attended / max) * 100}%` }}
                          title={`${day.attended} served`}
                        />
                      </div>
                      <strong>
                        {day.attended}
                        <small> / {day.booked}</small>
                      </strong>
                      <span>{dateLabel(day.date)}</span>
                    </div>
                  ))}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Service</th>
                        <th>Booked</th>
                        <th>Served</th>
                        <th>No-shows</th>
                        <th>Taste</th>
                        <th>Hygiene</th>
                        <th>Portion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            {titleCase(row.meal_type)}
                            <small className="cell-secondary">
                              {dateLabel(row.service_date)}
                            </small>
                          </td>
                          <td>{row.booked}</td>
                          <td>{row.attended}</td>
                          <td>{row.no_shows ?? "—"}</td>
                          <td>{row.taste_rating?.toFixed(1) ?? "—"}</td>
                          <td>{row.hygiene_rating?.toFixed(1) ?? "—"}</td>
                          <td>{row.portion_rating?.toFixed(1) ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <Empty
                title="No services in this period."
                text="Choose a different date range."
              />
            )}
          </Load>
        </>
      ) : (
        <>
          <div className="filter-line">
            <input
              aria-label="Reporting month"
              type="month"
              value={month}
              onChange={(event) =>
                event.target.value && setMonth(event.target.value)
              }
            />
            <a
              className="button outline"
              href={`/api/v1/reports/billing/export?month=${month}`}
              download
            >
              <Download size={16} />
              Export statements
            </a>
          </div>
          <Load query={financial}>
            {f && (
              <>
                <section className="stats-strip">
                  <Stat
                    label="ISSUED"
                    value={money(f.billedPaise)}
                    note={`${f.invoiceCount} invoices`}
                  />
                  <Stat
                    label="COLLECTED"
                    value={money(f.collectedForInvoicesPaise)}
                    note={
                      f.paymentsMode === "FAKE"
                        ? "Includes simulated payments"
                        : "For these invoices"
                    }
                  />
                  <Stat label="OUTSTANDING" value={money(f.outstandingPaise)} />
                  <Stat
                    label="PROCUREMENT"
                    value={money(f.procurementCostPaise)}
                  />
                </section>
                <div className="finance-note">
                  <span className="eyebrow">THE COLLECTION BREAKDOWN</span>
                  <h2>
                    Clear books.
                    <br />A clear picture.
                  </h2>
                  <dl className="detail-list">
                    <div>
                      <dt>Verified invoice collections</dt>
                      <dd>{money(f.verifiedCollectionsPaise)}</dd>
                    </div>
                    <div>
                      <dt>Simulated invoice collections</dt>
                      <dd>{money(f.simulatedCollectionsPaise)}</dd>
                    </div>
                    <div>
                      <dt>Real money received this month</dt>
                      <dd>{money(f.cashReceivedDuringMonthPaise)}</dd>
                    </div>
                    <div>
                      <dt>Simulated payments this month</dt>
                      <dd>{money(f.simulatedReceivedDuringMonthPaise)}</dd>
                    </div>
                  </dl>
                  {f.paymentsMode === "FAKE" && (
                    <p className="small muted">
                      Demo mode. Simulated payments move no real money.
                    </p>
                  )}
                </div>
              </>
            )}
          </Load>
        </>
      )}
    </div>
  );
}
