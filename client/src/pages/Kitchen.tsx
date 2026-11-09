import { useState } from "react";
import { ArrowUpRight, Plus, Package, Scale } from "lucide-react";
import { api, useApi } from "../api";
import { useAuth } from "../context";
import type { Item, Movement, Page, ServiceReport, Supplier } from "../types";
import {
  ActionForm,
  Badge,
  Button,
  Empty,
  Load,
  Modal,
  PageHead,
  Pagination,
  Tabs,
  useIdempotency,
  options,
  type Field,
} from "../components/ui";
import {
  addDays,
  dateLabel,
  management,
  money,
  paise,
  quantity,
  titleCase,
  today,
} from "../lib";
export default function KitchenPage() {
  const { user } = useAuth();
  const manage = management(user!.role);
  const [tab, setTab] = useState("stock");
  const [wasteFrom, setWasteFrom] = useState(addDays(today(), -7));
  const [wasteTo, setWasteTo] = useState(today());
  const [low, setLow] = useState(false);
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{
    type: string;
    item?: Item;
    service?: ServiceReport;
  } | null>(null);
  const stock = useApi<Page<Item>>(
    tab === "stock" ? `/inventory?page=${page}&limit=15&lowStock=${low}` : null,
  );
  const suppliers = useApi<Page<Supplier>>(
    tab === "suppliers" ? `/suppliers?page=${page}&limit=15` : null,
  );
  const waste = useApi<{ services: ServiceReport[] }>(
    tab === "waste"
      ? `/reports/operations?from=${wasteFrom}&to=${wasteTo}`
      : null,
  );
  return (
    <div className="page-enter">
      <PageHead
        eyebrow="BEHIND EVERY GOOD MEAL"
        title="Inside the kitchen."
        description="A thoughtful pantry. A little less waste."
      >
        {manage && tab !== "waste" && (
          <Button
            onClick={() =>
              setModal({ type: tab === "stock" ? "item" : "supplier" })
            }
          >
            <Plus size={16} />
            {tab === "stock" ? "Add stock item" : "Add supplier"}
          </Button>
        )}
      </PageHead>
      <Tabs
        value={tab}
        onChange={(value) => {
          setTab(value);
          setPage(1);
        }}
        options={[
          { value: "stock", label: "The pantry" },
          { value: "waste", label: "Food waste" },
          ...(manage ? [{ value: "suppliers", label: "Suppliers" }] : []),
        ]}
      />
      {tab === "stock" && (
        <>
          <div className="filter-line">
            <span className="eyebrow">CURRENT STOCK</span>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={low}
                onChange={(event) => {
                  setLow(event.target.checked);
                  setPage(1);
                }}
              />
              Low stock only
            </label>
          </div>
          <Load query={stock}>
            {stock.data?.items.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th>On hand</th>
                      <th>Reorder at</th>
                      <th>Status</th>
                      <th>Ledger</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stock.data.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <button
                            className="table-link"
                            onClick={() => setModal({ type: "ledger", item })}
                          >
                            {item.name}
                          </button>
                        </td>
                        <td className="stock-number">
                          {quantity(item.stock, item.unit)}
                        </td>
                        <td>{quantity(item.low_stock_threshold, item.unit)}</td>
                        <td>
                          <Badge
                            status={item.low_stock ? "LOW STOCK" : "IN STOCK"}
                          />
                        </td>
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Open ${item.name} ledger`}
                            onClick={() => setModal({ type: "ledger", item })}
                          >
                            <ArrowUpRight size={20} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                title={
                  low
                    ? "The pantry is in good shape."
                    : "Start with the essentials."
                }
                text={
                  low
                    ? "No ingredients are below their threshold."
                    : "Add ingredients, then record their first delivery."
                }
              />
            )}
            <Pagination data={stock.data} onPage={setPage} />
          </Load>
        </>
      )}
      {tab === "suppliers" && (
        <Load query={suppliers}>
          <div className="supplier-grid">
            {suppliers.data?.items.map((supplier) => (
              <article key={supplier.id}>
                <Package size={25} strokeWidth={1.2} />
                <h3>{supplier.name}</h3>
                <p>{supplier.contact}</p>
              </article>
            ))}
          </div>
          {!suppliers.data?.items.length && (
            <Empty
              title="Good meals start with good suppliers."
              text="Keep your supplier contacts here."
            />
          )}
          <Pagination data={suppliers.data} onPage={setPage} />
        </Load>
      )}
      {tab === "waste" && (
        <>
          <div className="waste-heading">
            <Scale size={40} strokeWidth={1} />
            <div>
              <h2>Make every portion count.</h2>
              <p>Completed services</p>
            </div>
          </div>
          <div className="filter-line">
            <span className="eyebrow">SERVICE PERIOD</span>
            <div className="inline-controls">
              <label>
                From
                <input
                  type="date"
                  value={wasteFrom}
                  max={wasteTo}
                  onChange={(event) =>
                    event.target.value && setWasteFrom(event.target.value)
                  }
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={wasteTo}
                  min={wasteFrom}
                  max={today()}
                  onChange={(event) =>
                    event.target.value && setWasteTo(event.target.value)
                  }
                />
              </label>
            </div>
          </div>
          <Load query={waste}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Served</th>
                    <th>Prepared</th>
                    <th>Left over</th>
                    <th>Waste</th>
                    <th>Record</th>
                  </tr>
                </thead>
                <tbody>
                  {waste.data?.services
                    .filter(
                      (service) => Date.parse(service.ends_at) <= Date.now(),
                    )
                    .map((service) => (
                      <tr key={service.id}>
                        <td>
                          {titleCase(service.meal_type)}
                          <small className="cell-secondary">
                            {dateLabel(service.service_date)}
                          </small>
                        </td>
                        <td>{service.attended}</td>
                        <td>{service.prepared_portions ?? "—"}</td>
                        <td>{service.leftover_portions ?? "—"}</td>
                        <td>
                          {service.waste_grams === null
                            ? "—"
                            : quantity(service.waste_grams, "GRAM")}
                        </td>
                        <td>
                          {service.waste_grams === null ? (
                            <Button
                              variant="outline"
                              onClick={() =>
                                setModal({ type: "waste", service })
                              }
                            >
                              Record
                            </Button>
                          ) : (
                            <Badge status="RECORDED" />
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!waste.data?.services.some(
              (service) => Date.parse(service.ends_at) <= Date.now(),
            ) && (
              <Empty
                title="No completed services to record."
                text="Return after the next service ends."
              />
            )}
          </Load>
        </>
      )}
      {modal?.type === "item" && (
        <Modal title="Room in the pantry." onClose={() => setModal(null)}>
          <ActionForm
            fields={[
              { name: "name", label: "Ingredient", full: true, max: 100 },
              {
                name: "unit",
                label: "Base unit",
                options: [
                  { value: "GRAM", label: "Grams" },
                  { value: "MILLILITRE", label: "Millilitres" },
                  { value: "PIECE", label: "Pieces" },
                ],
              },
              {
                name: "lowStockThreshold",
                label: "Reorder threshold (base units)",
                type: "number",
                min: 0,
                max: 100000000,
                value: 0,
              },
            ]}
            submit="Add ingredient"
            success="Ingredient added."
            onDone={() => setModal(null)}
            onSubmit={(values) =>
              api("/inventory", "POST", {
                ...values,
                lowStockThreshold: Number(values.lowStockThreshold),
              })
            }
          />
        </Modal>
      )}
      {modal?.type === "supplier" && (
        <Modal title="A new connection." onClose={() => setModal(null)}>
          <ActionForm
            fields={[
              { name: "name", label: "Supplier name", full: true, max: 100 },
              {
                name: "contact",
                label: "Contact details",
                type: "textarea",
                max: 300,
              },
            ]}
            submit="Add supplier"
            success="Supplier added."
            onDone={() => setModal(null)}
            onSubmit={(values) => api("/suppliers", "POST", values)}
          />
        </Modal>
      )}
      {modal?.type === "ledger" && (
        <StockLedger item={modal.item!} onClose={() => setModal(null)} />
      )}
      {modal?.type === "waste" && (
        <Modal title="After the last serving." onClose={() => setModal(null)}>
          <p className="modal-copy">
            {titleCase(modal.service!.meal_type)} ·{" "}
            {dateLabel(modal.service!.service_date)} · {modal.service!.attended}{" "}
            served
          </p>
          <ActionForm
            fields={[
              {
                name: "preparedPortions",
                label: "Portions prepared",
                type: "number",
                min: modal.service!.attended,
                max: 10000,
                value: modal.service!.booked,
              },
              {
                name: "leftoverPortions",
                label: "Portions left over",
                type: "number",
                min: 0,
                max: 10000,
                value: 0,
              },
              {
                name: "wasteGrams",
                label: "Measured waste (grams)",
                type: "number",
                min: 0,
                max: 100000000,
                value: 0,
              },
              {
                name: "note",
                label: "Kitchen note",
                type: "textarea",
                max: 1000,
              },
            ]}
            submit="Save waste record"
            success="Food waste recorded."
            onDone={() => setModal(null)}
            onSubmit={(values) =>
              api(`/meals/${modal.service!.id}/waste`, "POST", {
                preparedPortions: Number(values.preparedPortions),
                leftoverPortions: Number(values.leftoverPortions),
                wasteGrams: Number(values.wasteGrams),
                note: values.note,
              })
            }
          />
        </Modal>
      )}
    </div>
  );
}
function StockLedger({ item, onClose }: { item: Item; onClose: () => void }) {
  const { user } = useAuth();
  const manage = management(user!.role);
  const [view, setView] = useState("history");
  const [kind, setKind] = useState(manage ? "RECEIVE" : "CONSUME");
  const [page, setPage] = useState(1);
  const [current, setCurrent] = useState(item);
  const q = useApi<Page<Movement>>(
    `/inventory/${item.id}/movements?page=${page}&limit=10`,
  );
  const suppliers = useApi<Page<Supplier>>(
    manage && view === "movement" ? "/suppliers?limit=100" : null,
  );
  const key = useIdempotency();
  const fields: Field[] = [
    {
      name: "quantity",
      label: `Quantity (${titleCase(item.unit)}s)`,
      type: "number",
      min: kind === "ADJUST" ? -100000000 : 1,
      max: 100000000,
      help:
        kind === "ADJUST"
          ? "Use a signed amount to correct the count."
          : "Enter a positive amount.",
    },
    ...(kind === "RECEIVE"
      ? [
          {
            name: "cost",
            label: "Total delivery cost (₹)",
            type: "number",
            min: 0,
            step: ".01",
          },
          {
            name: "supplierId",
            label: "Supplier",
            options: [
              { value: "", label: "Choose supplier" },
              ...(suppliers.data?.items ?? []).map((supplier) => ({
                value: supplier.id,
                label: supplier.name,
              })),
            ],
          },
          {
            name: "reference",
            label: "Delivery / receipt reference",
            max: 100,
          },
        ]
      : []),
    {
      name: "reason",
      label: "Reason / kitchen note",
      type: "textarea",
      max: 1000,
    },
  ];
  return (
    <Modal
      title={item.name}
      eyebrow={`THE STOCK LEDGER / ${quantity(current.stock, current.unit)} ON HAND`}
      wide
      onClose={onClose}
    >
      <Tabs
        value={view}
        onChange={setView}
        options={[
          { value: "history", label: "Movement history" },
          { value: "movement", label: "Record movement" },
          ...(manage ? [{ value: "threshold", label: "Stock alert" }] : []),
        ]}
      />
      {view === "history" ? (
        <Load query={q}>
          {q.data?.items.map((movement) => (
            <div className="movement-row" key={movement.id}>
              <div>
                <Badge status={movement.kind} />
                <span className="small muted">
                  {dateLabel(movement.created_at)}
                </span>
              </div>
              <p>
                {movement.reason}
                {movement.supplier_name && (
                  <small>
                    {movement.supplier_name} · {movement.reference}
                  </small>
                )}
              </p>
              <strong>
                {movement.quantity > 0 ? "+" : ""}
                {quantity(movement.quantity, item.unit)}
                {movement.total_cost_paise !== undefined &&
                  movement.total_cost_paise > 0 && (
                    <small>{money(movement.total_cost_paise)}</small>
                  )}
              </strong>
            </div>
          ))}
          {!q.data?.items.length && (
            <Empty title="The first delivery is still to come." />
          )}
          <Pagination data={q.data} onPage={setPage} />
        </Load>
      ) : view === "threshold" ? (
        <ActionForm
          fields={[
            {
              name: "lowStockThreshold",
              label: `Reorder at (${titleCase(item.unit)}s)`,
              type: "number",
              min: 0,
              max: 100000000,
              value: current.low_stock_threshold,
              full: true,
            },
          ]}
          onSubmit={async (values) => {
            setCurrent(
              await api(`/inventory/${item.id}`, "PATCH", {
                lowStockThreshold: Number(values.lowStockThreshold),
              }),
            );
          }}
          success="Stock alert updated."
        />
      ) : (
        <>
          <label className="field">
            <span>Movement type</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
            >
              {(manage
                ? ["RECEIVE", "CONSUME", "WASTE", "ADJUST"]
                : ["CONSUME", "WASTE"]
              ).map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </label>
          <ActionForm
            key={kind}
            fields={fields}
            submit="Record movement"
            success="Stock ledger updated."
            onDone={() => setView("history")}
            onSubmit={async (values) => {
              const body = {
                kind,
                quantity: ["CONSUME", "WASTE"].includes(kind)
                  ? -Number(values.quantity)
                  : Number(values.quantity),
                reason: values.reason,
                ...(kind === "RECEIVE"
                  ? {
                      supplierId: values.supplierId,
                      reference: values.reference,
                      totalCostPaise: paise(values.cost!),
                    }
                  : {}),
              };
              const result = await api<{ item: Item }>(
                `/inventory/${item.id}/movements`,
                "POST",
                { ...body, idempotencyKey: key(body) },
              );
              key.reset(body);
              setCurrent(result.item);
            }}
          />
        </>
      )}
    </Modal>
  );
}
