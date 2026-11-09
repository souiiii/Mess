import { useState } from "react";
import { useNow } from "../hooks";
import { useSearchParams, Link } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { api, useApi } from "../api";
import { useAuth } from "../context";
import type { Meal, Policy } from "../types";
import {
  ActionForm,
  Badge,
  Button,
  Empty,
  Load,
  Modal,
  PageHead,
  Tabs,
  useAction,
  options,
  type Field,
} from "../components/ui";
import {
  addDays,
  dateLabel,
  istInput,
  istTimestamp,
  list,
  management,
  money,
  paise,
  timeLabel,
  titleCase,
  today,
} from "../lib";
export default function MenuPage() {
  const { user } = useAuth();
  const manage = management(user!.role);
  const [params, setParams] = useSearchParams();
  const dateParam = params.get("date") ?? "";
  const selected =
    /^\d{4}-\d{2}-\d{2}$/.test(dateParam) &&
    !Number.isNaN(Date.parse(dateParam)) &&
    new Date(dateParam).toISOString().slice(0, 10) === dateParam
      ? dateParam
      : today();
  const now = useNow();
  const [week, setWeek] = useState(selected);
  const [filter, setFilter] = useState("ALL");
  const [modal, setModal] = useState<{ type: string; meal?: Meal } | null>(
    null,
  );
  const q = useApi<Meal[]>(`/meals?from=${week}&to=${addDays(week, 6)}`);
  const policy = useApi<Policy>("/settings");
  const action = useAction();
  const dates = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const meals =
    q.data
      ?.filter(
        (meal) =>
          meal.service_date === selected &&
          (filter === "ALL" || ["VEG", "VEGAN"].includes(meal.dietary_type)),
      )
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at)) ?? [];
  const eligible = meals.filter(
    (meal) =>
      meal.status === "PUBLISHED" &&
      Date.parse(meal.cutoff_at) > now &&
      meal.available > 0 &&
      !["CONFIRMED", "ATTENDED"].includes(meal.my_booking_status ?? "") &&
      meal.service_date <=
        addDays(today(), policy.data?.booking_horizon_days ?? 14),
  );
  function chooseDate(date: string) {
    setParams({ date });
    if (date < week || date > addDays(week, 6)) setWeek(date);
  }
  return (
    <div className="page-enter">
      <PageHead
        eyebrow="THE KITCHEN’S DAILY EDITION"
        title={manage ? "Set the table." : "What’s cooking?"}
        description={
          manage
            ? "Thoughtful menus. A well-fed campus."
            : "Four small reasons to look forward to your day."
        }
      >
        {manage ? (
          <Button onClick={() => setModal({ type: "create" })}>
            <Plus size={16} />
            New service
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={!eligible.length}
            onClick={() => setModal({ type: "bulk" })}
          >
            Book the day
            <ArrowUpRight size={16} />
          </Button>
        )}
      </PageHead>
      <div className="date-toolbar">
        <div className="month-nav">
          <button
            className="icon-button"
            aria-label="Previous week"
            onClick={() => {
              const date = addDays(week, -7);
              setWeek(date);
              chooseDate(date);
            }}
          >
            <ChevronLeft size={19} />
          </button>
          <label className="date-picker-label">
            <span>
              {dateLabel(selected, { month: "long", year: "numeric" })}
            </span>
            <input
              aria-label="Choose menu date"
              type="date"
              value={selected}
              onChange={(event) => {
                if (event.target.value) chooseDate(event.target.value);
              }}
            />
          </label>
          <button
            className="icon-button"
            aria-label="Next week"
            onClick={() => {
              const date = addDays(week, 7);
              setWeek(date);
              chooseDate(date);
            }}
          >
            <ChevronRight size={19} />
          </button>
        </div>
        <span className="small muted">
          <Clock3 size={13} />
          All times IST
        </span>
      </div>
      <div className="week-strip">
        {dates.map((date) => (
          <button
            key={date}
            className={date === selected ? "selected" : ""}
            aria-pressed={date === selected}
            onClick={() => chooseDate(date)}
          >
            <span>{dateLabel(date, { weekday: "short" })}</span>
            <strong>{dateLabel(date, { day: "2-digit" })}</strong>
            <small>
              {date === today()
                ? "TODAY"
                : q.data?.some((meal) => meal.service_date === date)
                  ? "●"
                  : "—"}
            </small>
          </button>
        ))}
      </div>
      <div className="filter-line">
        <span className="eyebrow">
          {dateLabel(selected, {
            weekday: "long",
            day: "numeric",
            month: "short",
          })}{" "}
          / {meals.length} SERVICES
        </span>
        <Tabs
          options={[
            { value: "ALL", label: "All menus" },
            { value: "VEG", label: "Vegetarian" },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      <Load query={q}>
        {meals.length ? (
          <div className="menu-grid">
            {meals.map((meal, index) => {
              const booked = ["CONFIRMED", "ATTENDED"].includes(
                meal.my_booking_status ?? "",
              );
              const closed = now >= Date.parse(meal.cutoff_at);
              const beyond =
                meal.service_date >
                addDays(today(), policy.data?.booking_horizon_days ?? 14);
              return (
                <article
                  className={`menu-card ${meal.status === "CANCELLED" ? "cancelled" : ""}`}
                  key={meal.id}
                >
                  <div className="menu-card-top">
                    <span className="menu-number">0{index + 1}</span>
                    <Badge
                      status={
                        meal.status === "PUBLISHED"
                          ? meal.dietary_type
                          : meal.status
                      }
                    />
                  </div>
                  <h2>{titleCase(meal.meal_type)}</h2>
                  <span className="service-time">
                    {timeLabel(meal.starts_at)} — {timeLabel(meal.ends_at)}
                  </span>
                  <div className="menu-rule" />
                  <span className="eyebrow">{meal.title}</span>
                  <ul className="dish-list">
                    {meal.menu.map((dish, i) => (
                      <li key={i}>{dish}</li>
                    ))}
                  </ul>
                  {meal.allergens.length > 0 && (
                    <p className="allergen-note">
                      Contains {meal.allergens.join(", ").toLowerCase()}
                    </p>
                  )}
                  <div className="menu-card-bottom">
                    <div className="menu-price">
                      <strong>{money(meal.price_paise)}</strong>
                      <span>
                        {meal.status === "CANCELLED"
                          ? "Service cancelled"
                          : `${meal.available} seats available`}
                      </span>
                    </div>
                    {manage ? (
                      <div className="button-row">
                        {meal.status === "DRAFT" ? (
                          <>
                            <Button
                              variant="outline"
                              onClick={() => setModal({ type: "edit", meal })}
                            >
                              Edit
                            </Button>
                            <Button
                              busy={action.busy}
                              onClick={() =>
                                action.run(
                                  () =>
                                    api(`/meals/${meal.id}/publish`, "POST"),
                                  "Menu published.",
                                )
                              }
                            >
                              Publish
                            </Button>
                          </>
                        ) : meal.status === "PUBLISHED" &&
                          Date.parse(meal.starts_at) > now ? (
                          <>
                            <Button
                              variant="outline"
                              onClick={() => setModal({ type: "extra", meal })}
                            >
                              Add extra
                            </Button>
                            <button
                              className="text-button"
                              onClick={() => setModal({ type: "cancel", meal })}
                            >
                              Cancel service
                            </button>
                          </>
                        ) : (
                          <Badge status={meal.status} />
                        )}
                      </div>
                    ) : booked ? (
                      <Link
                        className="button outline full-width"
                        to={`/app/bookings?booking=${meal.my_booking_id}`}
                      >
                        <Check size={15} />
                        {meal.my_booking_status === "ATTENDED"
                          ? "Meal attended"
                          : "Your booking"}
                        <ArrowUpRight size={15} />
                      </Link>
                    ) : (
                      <Button
                        className="full-width"
                        disabled={
                          closed ||
                          beyond ||
                          meal.available < 1 ||
                          meal.status !== "PUBLISHED"
                        }
                        busy={action.busy}
                        onClick={() =>
                          action.run(
                            () => api("/bookings", "POST", { mealId: meal.id }),
                            `${titleCase(meal.meal_type)} booked.`,
                          )
                        }
                      >
                        {meal.status === "CANCELLED"
                          ? "Cancelled"
                          : closed
                            ? "Booking closed"
                            : beyond
                              ? "Opens closer to the date"
                              : meal.available < 1
                                ? "Fully booked"
                                : "Save my seat"}
                        {!closed && !beyond && meal.available > 0 && (
                          <Plus size={16} />
                        )}
                      </Button>
                    )}
                    <small className="cutoff">
                      {closed ? "Cutoff was" : "Book or cancel by"}{" "}
                      {dateLabel(meal.cutoff_at)} · {timeLabel(meal.cutoff_at)}
                    </small>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty
            title="The menu is still in the making."
            text="Try another date, or check back soon."
          >
            {manage && (
              <Button onClick={() => setModal({ type: "create" })}>
                Create a service
                <Plus size={16} />
              </Button>
            )}
          </Empty>
        )}
      </Load>
      <div className="bottom-note">
        <SlidersHorizontal size={15} />
        <span>
          Preferences and allergies live in your{" "}
          <Link to="/app/profile">profile</Link>. Please check each menu before
          booking.
        </span>
      </div>
      {modal?.type === "bulk" && (
        <Modal title="A day, taken care of." onClose={() => setModal(null)}>
          <div className="summary-list">
            {eligible.map((meal) => (
              <div key={meal.id}>
                <span>{titleCase(meal.meal_type)}</span>
                <strong>{money(meal.price_paise)}</strong>
              </div>
            ))}
            <div className="total">
              <span>Total</span>
              <strong>
                {money(
                  eligible.reduce((sum, meal) => sum + meal.price_paise, 0),
                )}
              </strong>
            </div>
          </div>
          <ActionForm
            fields={[]}
            submit="Confirm bookings"
            success="Your day is booked."
            onSubmit={() =>
              api("/bookings/bulk", "POST", {
                mealIds: eligible.map((meal) => meal.id),
              })
            }
            onDone={() => setModal(null)}
          />
        </Modal>
      )}
      {(modal?.type === "create" || modal?.type === "edit") && (
        <Modal
          title={modal.meal ? "Refine the menu." : "A new serving."}
          wide
          onClose={() => setModal(null)}
        >
          <MealForm
            meal={modal.meal}
            date={selected}
            onDone={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.type === "cancel" && (
        <Modal title="Cancel this service?" onClose={() => setModal(null)}>
          <p className="modal-copy">
            All reservations and extras for this service will be cancelled.
            Students won’t be charged.
          </p>
          <ActionForm
            fields={[
              { name: "reason", label: "Reason", type: "textarea", max: 500 },
            ]}
            onSubmit={(values) =>
              api(`/meals/${modal.meal!.id}/cancel`, "POST", values)
            }
            submit="Cancel service"
            success="Service cancelled."
            onDone={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.type === "extra" && (
        <Modal title="A little extra." onClose={() => setModal(null)}>
          <ActionForm
            fields={[
              { name: "name", label: "Extra name", max: 80 },
              {
                name: "price",
                label: "Price (₹)",
                type: "number",
                min: 0.01,
                step: ".01",
              },
              {
                name: "capacity",
                label: "Available portions",
                type: "number",
                min: 1,
                max: 10000,
              },
              {
                name: "allergens",
                label: "Allergens",
                required: false,
                placeholder: "Milk, wheat",
              },
            ]}
            onSubmit={(values) =>
              api(`/meals/${modal.meal!.id}/extras`, "POST", {
                name: values.name,
                pricePaise: paise(values.price!),
                capacity: Number(values.capacity),
                allergens: list(values.allergens ?? ""),
              })
            }
            onDone={() => setModal(null)}
            submit="Add to menu"
            success="Extra added."
          />
        </Modal>
      )}
    </div>
  );
}
function MealForm({
  meal,
  date,
  onDone,
}: {
  meal?: Meal;
  date: string;
  onDone: () => void;
}) {
  const day = date <= today() ? addDays(today(), 1) : date;
  const fields: Field[] = [
    {
      name: "serviceDate",
      label: "Service date",
      type: "date",
      value: meal?.service_date ?? day,
    },
    {
      name: "mealType",
      label: "Meal",
      options: options("BREAKFAST", "LUNCH", "SNACKS", "DINNER"),
      value: meal?.meal_type ?? "LUNCH",
    },
    {
      name: "title",
      label: "Menu title",
      value: meal?.title,
      full: true,
      max: 100,
      placeholder: "The Odia thali",
    },
    {
      name: "menu",
      label: "Dishes",
      type: "textarea",
      value: meal?.menu.join("\n"),
      help: "One dish per line.",
      max: 3000,
    },
    {
      name: "dietaryType",
      label: "Dietary type",
      options: options("VEG", "NON_VEG", "VEGAN", "MIXED"),
      value: meal?.dietary_type ?? "VEG",
    },
    {
      name: "allergens",
      label: "Allergens",
      value: meal?.allergens.join(", "),
      required: false,
      placeholder: "Milk, wheat",
    },
    {
      name: "price",
      label: "Meal price (₹)",
      type: "number",
      min: 0,
      step: ".01",
      value: meal ? meal.price_paise / 100 : 60,
    },
    {
      name: "capacity",
      label: "Capacity",
      type: "number",
      min: 1,
      max: 10000,
      value: meal?.capacity ?? 400,
    },
    {
      name: "startsAt",
      label: "Service starts (IST)",
      type: "datetime-local",
      value: meal ? istInput(meal.starts_at) : `${day}T12:00`,
    },
    {
      name: "endsAt",
      label: "Service ends (IST)",
      type: "datetime-local",
      value: meal ? istInput(meal.ends_at) : `${day}T14:00`,
    },
    {
      name: "cutoffAt",
      label: "Booking cutoff (IST)",
      type: "datetime-local",
      value: meal ? istInput(meal.cutoff_at) : `${day}T09:00`,
      full: true,
    },
  ];
  return (
    <ActionForm
      fields={fields}
      submit={meal ? "Save draft" : "Create draft"}
      success="Draft saved. Publish it when ready."
      onDone={onDone}
      onSubmit={(values) =>
        api(meal ? `/meals/${meal.id}` : "/meals", meal ? "PATCH" : "POST", {
          serviceDate: values.serviceDate,
          mealType: values.mealType,
          title: values.title,
          menu: list(values.menu!),
          allergens: list(values.allergens ?? ""),
          dietaryType: values.dietaryType,
          pricePaise: paise(values.price!),
          capacity: Number(values.capacity),
          startsAt: istTimestamp(values.startsAt!),
          endsAt: istTimestamp(values.endsAt!),
          cutoffAt: istTimestamp(values.cutoffAt!),
        })
      }
    />
  );
}
