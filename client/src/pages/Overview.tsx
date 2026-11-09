import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  QrCode,
  CalendarDays,
  Utensils,
  Plus,
  ScanLine,
} from "lucide-react";
import { useApi } from "../api";
import { useAuth } from "../context";
import type { Dashboard, Meal, Notice } from "../types";
import {
  dateLabel,
  today,
  addDays,
  money,
  timeLabel,
  titleCase,
  management,
} from "../lib";
import {
  Badge,
  Empty,
  Load,
  PageHead,
  SectionHead,
  Stat,
  TextLink,
} from "../components/ui";
export default function Overview() {
  const { user } = useAuth();
  const dashboard = useApi<Dashboard>("/dashboard");
  const notices = useApi<Notice[]>("/announcements");
  const meals = useApi<Meal[]>(
    user?.role === "STUDENT"
      ? `/meals?from=${today()}&to=${addDays(today(), 7)}`
      : null,
  );
  if (user?.role !== "STUDENT") return <OperationsHome />;
  const upcoming =
    meals.data?.filter(
      (meal) =>
        meal.status === "PUBLISHED" && Date.parse(meal.ends_at) > Date.now(),
    ) ?? [];
  const feature =
    upcoming.find((meal) => meal.meal_type === "LUNCH") ?? upcoming[0];
  const next = dashboard.data?.upcomingBookings?.[0];
  return (
    <div className="page-enter">
      <div className="edition-line">
        <span className="eyebrow">THE DAILY EDITION</span>
        <span>
          {dateLabel(today(), {
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </span>
      </div>
      <section className="cover-grid">
        <div className="cover-copy">
          <span className="eyebrow">
            HELLO, {user.name.split(" ")[0]?.toUpperCase()}.
          </span>
          <h1>
            Your place
            <br />
            at the table.
          </h1>
          <p>
            Good meals. Familiar faces.
            <br />
            One less thing to think about.
          </p>
          <Link className="button primary" to="/app/menu">
            See what’s cooking
            <ArrowUpRight size={18} />
          </Link>
          <div className="cover-index">
            <span>01 —</span>
            <span>
              THE MENU
              <br />
              MADE FOR YOUR DAY.
            </span>
          </div>
        </div>
        <Link
          to={feature ? `/app/menu?date=${feature.service_date}` : "/app/menu"}
          className="cover-photo"
        >
          <img
            src="/images/thali.png"
            alt="A freshly prepared vegetarian thali"
            fetchPriority="high"
          />
          <span className="cover-photo-label">
            FROM THE KITCHEN / SERVING SUGGESTION
          </span>
          <div className="cover-caption">
            <div>
              <span className="eyebrow">
                {feature
                  ? `${titleCase(feature.meal_type)} / ${dateLabel(feature.service_date)}`
                  : "THE CAMPUS TABLE"}
              </span>
              <h2>{feature?.title ?? "A little taste of home."}</h2>
            </div>
            <ArrowUpRight size={28} strokeWidth={1.2} />
          </div>
        </Link>
      </section>
      <Load query={dashboard}>
        <section className="stats-strip">
          <Stat
            label="ESTIMATED THIS MONTH"
            value={money(dashboard.data?.provisionalBillPaise)}
            note="Booked meals & extras · not invoiced yet"
          />
          <Stat
            label="UPCOMING MEALS"
            value={dashboard.data?.upcomingBookings?.length ?? 0}
            note="Your seats at the table"
          />
          <Stat
            label="UNPAID INVOICES"
            value={money(dashboard.data?.outstandingPaise)}
            note={
              dashboard.data?.paymentsMode === "FAKE"
                ? "Demo payment mode"
                : "Issued invoices awaiting payment"
            }
          />
          <Link to="/app/bookings" className="stat stat-link">
            <QrCode size={26} strokeWidth={1.25} />
            <span>
              Your meal pass
              <ArrowUpRight size={18} />
            </span>
          </Link>
        </section>
      </Load>
      <div className="editorial-columns">
        <section>
          <SectionHead title="Your next serving." number="02">
            <TextLink to="/app/bookings">All bookings</TextLink>
          </SectionHead>
          {next ? (
            <Link
              to={`/app/bookings?booking=${next.id}`}
              className="next-serving"
            >
              <div className="date-block">
                <strong>
                  {dateLabel(next.service_date, { day: "2-digit" })}
                </strong>
                <span>
                  {dateLabel(next.service_date, {
                    month: "short",
                  }).toUpperCase()}
                </span>
              </div>
              <div className="next-serving-main">
                <span className="eyebrow">
                  {titleCase(next.meal_type)} · {timeLabel(next.starts_at)}
                </span>
                <h3>{next.title}</h3>
                <p>{next.menu?.join(" · ")}</p>
              </div>
              <ArrowUpRight size={24} strokeWidth={1.2} />
            </Link>
          ) : (
            <Empty
              title="A seat is waiting."
              text="Choose a meal and make it yours."
            >
              <TextLink to="/app/menu">Explore the menu</TextLink>
            </Empty>
          )}
          <SectionHead title="The week, on a plate." number="03" />
          <Load query={meals}>
            <div className="meal-preview-grid">
              {upcoming.slice(0, 4).map((meal, index) => (
                <Link
                  to={`/app/menu?date=${meal.service_date}`}
                  className="meal-preview"
                  key={meal.id}
                >
                  <span className="eyebrow">
                    0{index + 1} / {dateLabel(meal.service_date)}
                  </span>
                  <h3>{titleCase(meal.meal_type)}</h3>
                  <p>{meal.menu.slice(0, 3).join(" · ")}</p>
                  <div>
                    <span>{money(meal.price_paise)}</span>
                    <ArrowUpRight size={16} />
                  </div>
                </Link>
              ))}
            </div>
            {!upcoming.length && (
              <Empty
                title="The next menu is on its way."
                text="Published meals will appear here."
              />
            )}
          </Load>
        </section>
        <aside className="editorial-rail">
          <SectionHead title="On the noticeboard." />
          <Load query={notices}>
            {notices.data?.slice(0, 3).map((notice) => (
              <article className="notice-story" key={notice.id}>
                <span className="eyebrow">
                  {notice.priority === "IMPORTANT"
                    ? "CAMPUS NOTE"
                    : "FROM THE MESS"}{" "}
                  · {dateLabel(notice.created_at)}
                </span>
                <h3>{notice.title}</h3>
                <p>{notice.body}</p>
              </article>
            ))}
            {!notices.data?.length && (
              <p className="muted small">All quiet at the mess.</p>
            )}
          </Load>
          <div className="rail-callout">
            <CalendarDays size={24} strokeWidth={1.2} />
            <h3>Heading home?</h3>
            <p>Let the kitchen know. Make room for less food waste.</p>
            <TextLink to="/app/leave">Plan your leave</TextLink>
          </div>
        </aside>
      </div>
    </div>
  );
}
function OperationsHome() {
  const { user } = useAuth();
  const q = useApi<Dashboard>("/dashboard");
  const d = q.data;
  const services = d?.services ?? [];
  const booked = services.reduce((n, meal) => n + meal.booked, 0);
  const attended = services.reduce((n, meal) => n + meal.attended, 0);
  const pct = booked ? Math.round((attended / booked) * 100) : 0;
  const filledSegments = Math.round((pct / 100) * 18);
  return (
    <div className="page-enter">
      <PageHead
        eyebrow="THE OPERATIONS EDITION"
        title="A well-run table."
        description={dateLabel(today(), {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      >
        <Link className="button primary" to="/app/attendance">
          <ScanLine size={17} />
          Open serving desk
        </Link>
      </PageHead>
      <Load query={q}>
        <div className="ops-cover">
          <div className="ops-cover-title">
            <div className="ops-card-head">
              <span className="eyebrow">TODAY IN THE MESS</span>
              <span className="ops-rate-pill">{pct}% served</span>
            </div>
            <strong>{booked.toLocaleString("en-IN")}</strong>
            <h2>
              Meals to make.
              <br />
              People to feed.
            </h2>
            <div className="ops-segment-bar" aria-hidden="true">
              {Array.from({ length: 18 }, (_, i) => (
                <span
                  key={i}
                  className={
                    i < Math.min(6, filledSegments)
                      ? "seg-dark"
                      : i < filledSegments
                        ? "seg-lime"
                        : "seg-empty"
                  }
                />
              ))}
            </div>
            <span className="small">
              {attended} served · {services.length} services
            </span>
          </div>
          <div className="service-schedule">
            {services.length ? (
              services.map((meal) => (
                <Link
                  to="/app/attendance"
                  className="service-schedule-row"
                  key={meal.id}
                >
                  <div>
                    <span className="eyebrow">
                      {timeLabel(meal.starts_at)}—{timeLabel(meal.ends_at)}
                    </span>
                    <h3>{titleCase(meal.meal_type)}</h3>
                  </div>
                  <div>
                    <strong>
                      {meal.attended}
                      <small> / {meal.booked}</small>
                    </strong>
                    <span className="small muted">served</span>
                  </div>
                  <ArrowUpRight size={20} />
                </Link>
              ))
            ) : (
              <Empty
                title="A quiet day at the kitchen."
                text="Publish a service to start planning."
              />
            )}
          </div>
        </div>
        <section className="stats-strip">
          <Stat
            label="OPEN CONVERSATIONS"
            value={d?.openComplaints ?? 0}
            note="Awaiting attention"
          />
          <Stat
            label="LOW-STOCK ITEMS"
            value={d?.lowStockItems?.length ?? 0}
            note="Check the pantry"
          />
          {management(user!.role) ? (
            <>
              <Stat
                label="LEAVE REQUESTS"
                value={d?.pendingLeaves ?? 0}
                note="Ready for review"
              />
              <Stat
                label="RESIDENTS"
                value={d?.activeResidents ?? 0}
                note="Active students"
              />
            </>
          ) : (
            <Stat
              label="ATTENDANCE"
              value={`${booked ? Math.round((attended / booked) * 100) : 0}%`}
              note="Of today's bookings"
            />
          )}
        </section>
        <div className="editorial-columns">
          <section>
            <SectionHead title="Keep things moving." number="01" />
            <div className="quick-actions">
              {[
                {
                  title: "The pantry",
                  text: "Stock, supplies and waste.",
                  to: "/app/kitchen",
                  icon: Utensils,
                },
                {
                  title: "Campus conversations",
                  text: "Listen. Resolve. Improve.",
                  to: "/app/community",
                  icon: ArrowRight,
                },
                ...(management(user!.role)
                  ? [
                      {
                        title: "Upcoming services",
                        text: "Build the next menu.",
                        to: "/app/menu",
                        icon: Plus,
                      },
                      {
                        title: "Leave requests",
                        text: "Keep headcounts in step.",
                        to: "/app/leave",
                        icon: CalendarDays,
                      },
                    ]
                  : []),
              ].map((action) => (
                <Link to={action.to} key={action.to}>
                  <action.icon size={24} strokeWidth={1.2} />
                  <div>
                    <h3>{action.title}</h3>
                    <p>{action.text}</p>
                  </div>
                  <ArrowUpRight size={20} />
                </Link>
              ))}
            </div>
          </section>
          <aside className="editorial-rail">
            <SectionHead title="Pantry watch." />
            {d?.lowStockItems?.map((item) => (
              <div className="story-row" key={item.id}>
                <strong>{item.name}</strong>
                <Badge status="LOW STOCK" />
              </div>
            ))}
            {!d?.lowStockItems?.length && (
              <Empty
                title="Stock looks good."
                text="Low-stock items will appear here."
              />
            )}
          </aside>
        </div>
      </Load>
    </div>
  );
}
