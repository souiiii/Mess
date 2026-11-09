import { useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, Eye, EyeOff } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context";
import { api, queryClient, setCsrf } from "../api";
import { Brand, Button, ErrorBox } from "../components/ui";
import { dateLabel, today } from "../lib";
export function AuthPage() {
  const { user, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate("/app");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="boot-screen">
        <Brand />
        <span className="eyebrow">Setting your table</span>
      </div>
    );
  if (user) return <Navigate to="/app" replace />;
  return (
    <div className="auth-page">
      <header className="auth-masthead">
        <span className="eyebrow">IIIT BHUBANESWAR</span>
        <Brand />
        <span className="eyebrow desktop-only">THE CAMPUS TABLE</span>
      </header>
      <main className="auth-layout">
        <section className="auth-story">
          <div className="auth-story-copy">
            <span className="eyebrow">GOOD FOOD. SHARED EVERY DAY.</span>
            <h1>
              Life happens
              <br />
              around a table.
            </h1>
            <p>
              A little less planning.
              <br />A little more living.
            </p>
          </div>
          <div className="auth-photo">
            <img
              src="/images/thali.png"
              alt="An Odia thali with rice, dalma, chapati and seasonal vegetables"
            />
            <span className="photo-credit">
              A TASTE OF HOME / SERVING SUGGESTION
            </span>
          </div>
          <div className="auth-story-footer">
            <span>Made for our campus.</span>
            <span>Bhubaneswar, Odisha ↗</span>
          </div>
        </section>
        <section className="auth-form-panel">
          <span className="eyebrow">YOUR DAILY EDITION</span>
          <h2>
            Welcome
            <br />
            to the mess.
          </h2>
          <p>One place for every meal.</p>
          <form onSubmit={(event) => login(event)}>
            <label className="field">
              <span>Institute email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="you@iiit-bh.ac.in"
                maxLength={254}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <div className="password-field">
                <input
                  type={visible ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  placeholder="Your password"
                  maxLength={128}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>
            {error ? <ErrorBox error={error} /> : null}
            <Button type="submit" busy={busy} className="full-width">
              Take your seat
              <ArrowRight size={17} />
            </Button>
          </form>
          <p className="auth-help">
            Need an account or password reset?
            <br />
            Your mess administrator can help.
          </p>
          {import.meta.env.DEV && (
            <div className="demo-access">
              <span className="eyebrow">QUICK ROLE SELECT</span>
              <div>
                {["student", "staff", "manager", "admin"].map((role) => (
                  <button
                    type="button"
                    onClick={() => setEmail(`${role}@demo.iiit-bh.ac.in`)}
                    disabled={busy}
                    key={role}
                  >
                    {role}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
              <small>Fills demo email · enter your seeded password</small>
            </div>
          )}
          <div className="auth-date">
            {dateLabel(today(), {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
export function PasswordGate() {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (data.get("newPassword") !== data.get("confirm")) {
      setError(new Error("Your new passwords do not match."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password", "POST", {
        currentPassword: data.get("currentPassword"),
        newPassword: data.get("newPassword"),
      });
      setCsrf("");
      queryClient.clear();
      window.dispatchEvent(new Event("mess:session-expired"));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="password-gate">
      <Brand />
      <div className="password-card">
        <span className="eyebrow">A FRESH START</span>
        <h1>Make it yours.</h1>
        <p>Replace your temporary password to continue.</p>
        <form onSubmit={submit}>
          {[
            { name: "currentPassword", label: "Temporary password" },
            { name: "newPassword", label: "New password" },
            { name: "confirm", label: "Repeat new password" },
          ].map((field) => (
            <label className="field" key={field.name}>
              <span>{field.label}</span>
              <input
                name={field.name}
                type="password"
                autoComplete={
                  field.name === "currentPassword"
                    ? "current-password"
                    : "new-password"
                }
                required
                minLength={field.name === "currentPassword" ? 1 : 12}
                maxLength={128}
              />
            </label>
          ))}
          <small>12+ characters, with uppercase, lowercase and a number.</small>
          {error ? <ErrorBox error={error} /> : null}
          <Button busy={busy}>
            Set password
            <ArrowRight size={16} />
          </Button>
        </form>
        <button
          className="text-button"
          onClick={() => signOut().catch(setError)}
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}
