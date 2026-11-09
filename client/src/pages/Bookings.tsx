import { useEffect, useState } from "react";
import { useNow } from "../hooks";
import { Link, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowUpRight,
  QrCode,
  RefreshCw,
  Star,
  Clock3,
  Check,
} from "lucide-react";
import { api, useApi } from "../api";
import { useAuth } from "../context";
import type { Booking, Meal, Page, Policy } from "../types";
import {
  ActionForm,
  Badge,
  Button,
  Empty,
  ErrorBox,
  Load,
  Modal,
  PageHead,
  Pagination,
  Tabs,
  useAction,
} from "../components/ui";
import { addDays, dateLabel, money, timeLabel, titleCase, today } from "../lib";
export default function BookingsPage() {
  const [view, setView] = useState("upcoming");
  const [page, setPage] = useState(1);
  const [params, setParams] = useSearchParams();
  const from =
    view === "upcoming"
      ? today()
      : addDays(today(), view === "cancelled" ? -30 : -90);
  const to = view === "history" ? today() : addDays(today(), 60);
  const q = useApi<Page<Booking>>(
    `/bookings?from=${from}&to=${to}&page=${page}&limit=12${view === "cancelled" ? "&status=CANCELLED" : view === "upcoming" ? "&status=CONFIRMED" : ""}`,
  );
  return (
    <div className="page-enter">
      <PageHead
        eyebrow="YOUR SEAT IS SAVED"
        title="Meals, made yours."
        description="Every booking. Every little extra."
      >
        <Link className="button outline" to="/app/menu">
          Explore menu
          <ArrowUpRight size={16} />
        </Link>
      </PageHead>
      <div className="filter-line">
        <Tabs
          value={view}
          onChange={(value) => {
            setView(value);
            setPage(1);
          }}
          options={[
            { value: "upcoming", label: "Upcoming" },
            { value: "history", label: "Recent history" },
            { value: "cancelled", label: "Cancelled" },
          ]}
        />
        <span className="eyebrow">{q.data?.total ?? "—"} BOOKINGS</span>
      </div>
      <Load query={q}>
        {q.data?.items.length ? (
          <div className="booking-list">
            {q.data.items.map((booking) => (
              <button
                className="booking-row"
                key={booking.id}
                onClick={() => setParams({ booking: booking.id })}
              >
                <div className="date-block">
                  <strong>
                    {dateLabel(booking.service_date, { day: "2-digit" })}
                  </strong>
                  <span>
                    {dateLabel(booking.service_date, { month: "short" })}
                  </span>
                </div>
                <div className="booking-title">
                  <span className="eyebrow">
                    {titleCase(booking.meal_type)} ·{" "}
                    {timeLabel(booking.starts_at)}
                  </span>
                  <h2>{booking.title}</h2>
                </div>
                <Badge status={booking.status} />
                <strong className="booking-price">
                  {money(booking.price_paise)}
                </strong>
                <ArrowUpRight size={22} strokeWidth={1.3} />
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title={
              view === "upcoming"
                ? "Your next meal starts here."
                : "Nothing on this page yet."
            }
            text={
              view === "upcoming"
                ? "Choose something good from the menu."
                : "Your recent bookings will appear here."
            }
          >
            <Link className="button primary" to="/app/menu">
              Find a meal
              <ArrowUpRight size={16} />
            </Link>
          </Empty>
        )}
        <Pagination data={q.data} onPage={setPage} />
      </Load>
      {params.get("booking") && (
        <BookingDialog
          id={params.get("booking")!}
          onClose={() => setParams({})}
        />
      )}
    </div>
  );
}
export function BookingDialog({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const q = useApi<Booking>(`/bookings/${id}`);
  const policy = useApi<Policy>("/settings");
  const [mode, setMode] = useState("details");
  const [pass, setPass] = useState<{ token: string; expiresAt: string } | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const [remaining, setRemaining] = useState(0);
  const action = useAction();
  const now = useNow();
  const b = q.data;
  const meal = b?.meal;
  const available = useApi<Meal[]>(
    meal ? `/meals?from=${meal.service_date}&to=${meal.service_date}` : null,
  );
  useEffect(() => {
    if (!pass) return;
    const tick = () =>
      setRemaining(
        Math.max(
          0,
          Math.ceil((Date.parse(pass.expiresAt) - Date.now()) / 1000),
        ),
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [pass]);
  useEffect(() => {
    if (!pass) return;
    const timer = setInterval(() => q.refetch(), 5000);
    return () => clearInterval(timer);
  }, [pass, q.refetch]);
  const canCancel =
    b?.status === "CONFIRMED" && !!meal && Date.parse(meal.cutoff_at) > now;
  const canPass =
    b?.status === "CONFIRMED" &&
    !!meal &&
    now >= Date.parse(meal.starts_at) - 15 * 60000 &&
    now < Date.parse(meal.ends_at);
  const canRate =
    b?.status === "ATTENDED" &&
    !!meal &&
    now <=
      Date.parse(meal.ends_at) +
        (policy.data?.feedback_window_days ?? 7) * 86400000;
  return (
    <Modal
      title={
        mode === "cancel"
          ? "A change of plans?"
          : mode === "feedback"
            ? "How was your meal?"
            : meal
              ? titleCase(meal.meal_type)
              : "Your booking"
      }
      eyebrow={
        meal ? `${dateLabel(meal.service_date)} / ${meal.title}` : "YOUR TABLE"
      }
      onClose={onClose}
    >
      <Load query={q}>
        {b && meal && (
          <>
            {mode === "details" ? (
              <>
                <div className="booking-detail-meta">
                  <Badge status={b.status} />
                  <span>
                    {timeLabel(meal.starts_at)}—{timeLabel(meal.ends_at)}
                  </span>
                  <strong>{money(b.price_paise)}</strong>
                </div>
                {b.status === "ATTENDED" && pass ? (
                  <div className="pass-success">
                    <Check size={38} strokeWidth={1.2} />
                    <h3>You’re checked in.</h3>
                    <p>Enjoy your meal.</p>
                  </div>
                ) : pass ? (
                  <div className="meal-pass">
                    {remaining > 0 ? (
                      <QRCodeSVG
                        value={pass.token}
                        size={220}
                        level="M"
                        marginSize={3}
                        title="Single-use meal pass"
                      />
                    ) : (
                      <div className="expired-pass">
                        <QrCode size={60} strokeWidth={1} />
                        <h3>This pass has expired.</h3>
                      </div>
                    )}
                    <span className="eyebrow">
                      {remaining > 0
                        ? `VALID FOR ${remaining}s`
                        : "REFRESH TO CONTINUE"}
                    </span>
                    <p>Show this at the serving desk.</p>
                    {remaining > 0 && (
                      <details className="pass-code">
                        <summary>Use a pass code instead</summary>
                        <input
                          aria-label="Current meal pass code"
                          readOnly
                          value={pass.token}
                          onFocus={(event) => event.target.select()}
                        />
                        <small>
                          Select and copy this code for the serving desk.
                        </small>
                      </details>
                    )}
                    <Button
                      variant="outline"
                      busy={action.busy}
                      onClick={() =>
                        action.run(async () => {
                          setPass(await api(`/bookings/${id}/pass`, "POST"));
                        }, "Pass refreshed.")
                      }
                    >
                      <RefreshCw size={14} />
                      Refresh pass
                    </Button>
                  </div>
                ) : (
                  <>
                    <ul className="detail-menu">
                      {meal.menu.map((dish, i) => (
                        <li key={i}>{dish}</li>
                      ))}
                    </ul>
                    {canPass && (
                      <Button
                        className="full-width"
                        busy={action.busy}
                        onClick={() =>
                          action.run(async () => {
                            setPass(await api(`/bookings/${id}/pass`, "POST"));
                          }, "Your meal pass is ready.")
                        }
                      >
                        <QrCode size={18} />
                        Open meal pass
                      </Button>
                    )}
                    {b.status === "CONFIRMED" && !canPass && (
                      <p className="fine-print">
                        <Clock3 size={14} />
                        {now >= Date.parse(meal.ends_at)
                          ? "This service has ended."
                          : "Your pass opens 15 minutes before service."}
                      </p>
                    )}
                  </>
                )}
                {b.extras
                  ?.filter((extra) => extra.status !== "CANCELLED")
                  .map((extra) => (
                    <div className="story-row" key={extra.id}>
                      <span>
                        {extra.quantity} × {extra.name}
                      </span>
                      <span>
                        {money(extra.quantity * extra.unit_price_paise)}
                      </span>
                      {canCancel && (
                        <button
                          className="text-button"
                          disabled={action.busy}
                          onClick={() =>
                            action.run(
                              () =>
                                api(`/extra-orders/${extra.id}/cancel`, "POST"),
                              "Extra cancelled.",
                            )
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                {canCancel &&
                  (available.data?.find((item) => item.id === meal.id)?.extras
                    .length ?? 0) > 0 && (
                    <details className="extras-details">
                      <summary>Add a little extra +</summary>
                      {available.data
                        ?.find((item) => item.id === meal.id)
                        ?.extras.map((extra) => (
                          <form
                            className="extra-order-row"
                            key={extra.id}
                            onSubmit={(event) => {
                              event.preventDefault();
                              const data = new FormData(event.currentTarget);
                              action.run(
                                () =>
                                  api(`/bookings/${id}/extras`, "POST", {
                                    extraId: extra.id,
                                    quantity: Number(data.get("quantity")),
                                  }),
                                "Extra added.",
                              );
                            }}
                          >
                            <div>
                              <strong>{extra.name}</strong>
                              <small>
                                {money(extra.price_paise)} · {extra.available}{" "}
                                left
                              </small>
                              {extra.allergens.length > 0 && (
                                <small>
                                  Contains {extra.allergens.join(", ")}
                                </small>
                              )}
                            </div>
                            <input
                              type="number"
                              aria-label={`Quantity of ${extra.name}`}
                              name="quantity"
                              defaultValue={1}
                              min={1}
                              max={Math.min(10, extra.available)}
                              disabled={extra.available < 1}
                            />
                            <Button
                              variant="outline"
                              type="submit"
                              busy={action.busy}
                              disabled={extra.available < 1}
                            >
                              Add
                            </Button>
                          </form>
                        ))}
                    </details>
                  )}
                {b.cancellation_reason && (
                  <p className="fine-print">{b.cancellation_reason}</p>
                )}
                <div className="dialog-actions">
                  {canCancel && (
                    <button
                      className="text-button"
                      onClick={() => setMode("cancel")}
                    >
                      Cancel booking
                    </button>
                  )}
                  {canRate && (
                    <Button
                      variant="outline"
                      onClick={() => setMode("feedback")}
                    >
                      <Star size={15} />
                      Rate this meal
                    </Button>
                  )}
                </div>
              </>
            ) : mode === "cancel" ? (
              <>
                <p className="modal-copy">
                  Your meal and extras will be cancelled, and their charges
                  removed.
                </p>
                <ActionForm
                  fields={[
                    {
                      name: "reason",
                      label: "Reason",
                      type: "textarea",
                      max: 500,
                    },
                  ]}
                  submit="Cancel my booking"
                  success="Booking cancelled."
                  onSubmit={(values) =>
                    api(`/bookings/${id}/cancel`, "POST", values)
                  }
                  onDone={() => setMode("details")}
                />
              </>
            ) : (
              <FeedbackForm bookingId={id} done={() => setMode("details")} />
            )}
          </>
        )}
      </Load>
      {error ? <ErrorBox error={error} /> : null}
    </Modal>
  );
}
function FeedbackForm({
  bookingId,
  done,
}: {
  bookingId: string;
  done: () => void;
}) {
  const [ratings, setRatings] = useState({ taste: 0, hygiene: 0, portion: 0 });
  return (
    <ActionForm
      fields={[
        {
          name: "comment",
          label: "Anything else?",
          type: "textarea",
          required: false,
          max: 2000,
          placeholder: "A thought for the kitchen…",
        },
      ]}
      submit="Send feedback"
      success="Thank you. Your feedback is with the kitchen."
      onDone={done}
      onSubmit={(values) => {
        if (Object.values(ratings).some((value) => value === 0))
          return Promise.reject(
            new Error("Please rate taste, hygiene and portion size."),
          );
        return api("/feedback", "POST", {
          bookingId,
          ...ratings,
          comment: values.comment ?? "",
        });
      }}
    >
      <div className="ratings">
        {Object.entries(ratings).map(([name, value]) => (
          <div key={name}>
            <span>{titleCase(name)}</span>
            <div role="group" aria-label={`${name} rating`}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  aria-label={`${star} out of 5 for ${name}`}
                  aria-pressed={star === value}
                  key={star}
                  onClick={() => setRatings({ ...ratings, [name]: star })}
                >
                  <Star
                    size={25}
                    strokeWidth={1.25}
                    fill={star <= value ? "currentColor" : "none"}
                  />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ActionForm>
  );
}
