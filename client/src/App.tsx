import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  ArrowUpRight,
  BarChart3,
  CalendarCheck,
  CalendarOff,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  Receipt,
  ScanLine,
  Settings,
  Sparkles,
  UserCircle2,
  Users,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth, useToast } from "./context";
import { Brand, Button, Empty } from "./components/ui";
import { dateLabel, initials, today } from "./lib";
import { AuthPage, PasswordGate } from "./pages/Auth";
import type { Role } from "./types";
const Overview = lazy(() => import("./pages/Overview"));
const MenuPage = lazy(() => import("./pages/Menu"));
const Bookings = lazy(() => import("./pages/Bookings"));
const Billing = lazy(() => import("./pages/Billing"));
const Leave = lazy(() => import("./pages/Leave"));
const Community = lazy(() => import("./pages/Community"));
const Kitchen = lazy(() => import("./pages/Kitchen"));
const Attendance = lazy(() => import("./pages/Attendance"));
const Residents = lazy(() => import("./pages/Residents"));
const Reports = lazy(() => import("./pages/Reports"));
const Profile = lazy(() =>
  import("./pages/Account").then((module) => ({ default: module.ProfilePage })),
);
const Policy = lazy(() =>
  import("./pages/Account").then((module) => ({
    default: module.SettingsPage,
  })),
);
const managers: Role[] = ["MANAGER", "ADMIN"];
const team: Role[] = ["STAFF", ...managers];
function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth();
  return roles.includes(user!.role) ? children : <Navigate to="/app" replace />;
}
function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}
const navIcons: Record<string, LucideIcon> = {
  "": LayoutDashboard,
  menu: UtensilsCrossed,
  bookings: CalendarCheck,
  billing: Receipt,
  leave: CalendarOff,
  community: MessageSquare,
  attendance: ScanLine,
  kitchen: Package,
  residents: Users,
  reports: BarChart3,
};
function Shell() {
  const { user, loading, signOut } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (loading)
    return (
      <div className="boot-state">
        <Brand />
        <span className="eyebrow">SETTING YOUR TABLE</span>
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (user.must_change_password) return <PasswordGate />;
  const links =
    user.role === "STUDENT"
      ? [
          ["", "Today"],
          ["menu", "The menu"],
          ["bookings", "My bookings"],
          ["billing", "Statements"],
          ["leave", "Time away"],
          ["community", "Noticeboard"],
        ]
      : [
          ["", "Overview"],
          ...(managers.includes(user.role) ? [["menu", "The menu"]] : []),
          ["attendance", "Serving desk"],
          ["kitchen", "The kitchen"],
          ...(managers.includes(user.role)
            ? [
                ["residents", "People"],
                ["billing", "Billing"],
                ["leave", "Leave"],
                ["reports", "Reports"],
              ]
            : []),
          ["community", "Community"],
        ];
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="masthead">
        <div className="masthead-main">
          <div className="masthead-brand">
            <Brand />
            <div className="masthead-meta">
              <strong>IIIT BHUBANESWAR</strong>
              <span>CAMPUS DINING</span>
            </div>
          </div>
          <div className="masthead-date">
            <span className="status-dot" aria-hidden="true" />
            <span>
              {dateLabel(today(), {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
          <div className="account-actions">
            <Link className="account-link" to="/app/profile">
              <span className="avatar">{initials(user.name)}</span>
              <span className="account-name">
                {user.name.split(" ")[0]}
                <small>{user.role.toLowerCase()}</small>
              </span>
            </Link>
            {user.role === "ADMIN" && (
              <Link
                to="/app/settings"
                className="icon-button"
                aria-label="Mess settings"
              >
                <Settings size={18} />
              </Link>
            )}
            <button
              className="icon-button"
              aria-label="Sign out"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await signOut();
                } catch (error) {
                  toast(
                    error instanceof Error
                      ? error.message
                      : "Unable to sign out.",
                    true,
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <LogOut size={18} />
            </button>
            <button
              className="icon-button mobile-toggle"
              aria-label={open ? "Close navigation" : "Open navigation"}
              aria-expanded={open}
              aria-controls="main-navigation"
              onClick={() => setOpen(!open)}
            >
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>
      {!online && (
        <div className="offline-banner" role="status">
          You’re offline. Reconnect to update your mess account.
        </div>
      )}
      <div className="workspace-grid">
        <aside className={`sidebar-card ${open ? "open" : ""}`}>
          <span className="sidebar-section-label">Menu</span>
          <nav
            className={`main-nav ${open ? "open" : ""}`}
            id="main-navigation"
            aria-label="Main navigation"
          >
            {links.map(([path = "", label]) => {
              const Icon = navIcons[path] ?? LayoutDashboard;
              return (
                <NavLink
                  key={path}
                  to={path ? `/app/${path}` : "/app"}
                  end={!path}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              );
            })}
          </nav>
          <span className="sidebar-section-label">Account</span>
          <div className="sidebar-secondary-nav">
            <NavLink to="/app/profile">
              <UserCircle2 size={17} aria-hidden="true" />
              <span>Profile & preferences</span>
            </NavLink>
          </div>
          <div className="sidebar-promo">
            <div className="sidebar-promo-icon" aria-hidden="true">
              <Sparkles size={16} />
            </div>
            <strong>Fresh Campus Dining</strong>
            <p>
              Daily menus, instant QR passes, and transparent monthly statements
              for IIIT Bhubaneswar.
            </p>
            <Link className="sidebar-promo-btn" to="/app/community">
              Share feedback
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </aside>
        <div className="workspace-main">
          <main id="main" className="main-content" tabIndex={-1}>
            <Suspense
              fallback={
                <div
                  className="skeleton-grid"
                  role="status"
                  aria-label="Loading page"
                >
                  <span />
                  <span />
                  <span />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </main>
          <footer className="site-footer">
            <div>
              <Brand />
              <p>
                Nutritious campus dining, transparent billing, and zero-waste
                kitchen operations.
              </p>
            </div>
            <div>
              <span className="eyebrow">IIIT BHUBANESWAR</span>
              <p>
                Gothapatna, Malipada
                <br />
                Bhubaneswar, Odisha 751003
              </p>
            </div>
            <div className="footer-end">
              <span className="eyebrow">CAMPUS DINING PORTAL</span>
              <span>
                {dateLabel(today(), { year: "numeric" })} · ALL TIMES IST
              </span>
              <Link to="/app/community">
                Have something to share?
                <ArrowUpRight size={15} />
              </Link>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
export default function App() {
  return (
    <>
      <ScrollReset />
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/app" element={<Shell />}>
          <Route index element={<Overview />} />
          <Route
            path="menu"
            element={
              <Guard roles={["STUDENT", ...managers]}>
                <MenuPage />
              </Guard>
            }
          />
          <Route
            path="bookings"
            element={
              <Guard roles={["STUDENT"]}>
                <Bookings />
              </Guard>
            }
          />
          <Route
            path="billing"
            element={
              <Guard roles={["STUDENT", ...managers]}>
                <Billing />
              </Guard>
            }
          />
          <Route
            path="leave"
            element={
              <Guard roles={["STUDENT", ...managers]}>
                <Leave />
              </Guard>
            }
          />
          <Route path="community" element={<Community />} />
          <Route
            path="kitchen"
            element={
              <Guard roles={team}>
                <Kitchen />
              </Guard>
            }
          />
          <Route
            path="attendance"
            element={
              <Guard roles={team}>
                <Attendance />
              </Guard>
            }
          />
          <Route
            path="residents"
            element={
              <Guard roles={managers}>
                <Residents />
              </Guard>
            }
          />
          <Route
            path="reports"
            element={
              <Guard roles={managers}>
                <Reports />
              </Guard>
            }
          />
          <Route path="profile" element={<Profile />} />
          <Route
            path="settings"
            element={
              <Guard roles={["ADMIN"]}>
                <Policy />
              </Guard>
            }
          />
          <Route
            path="*"
            element={
              <Empty
                title="This table is empty."
                text="The page you’re looking for isn’t here."
              >
                <Link className="button primary" to="/app">
                  Back to today
                </Link>
              </Empty>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </>
  );
}
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="fatal-state">
        <Brand />
        <h1>Let’s reset the table.</h1>
        <p>This page couldn’t load. Your saved changes are safe.</p>
        <Button onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
