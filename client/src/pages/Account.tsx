import { useState } from "react";
import { api, useApi } from "../api";
import { useAuth } from "../context";
import {
  ActionForm,
  Empty,
  Load,
  PageHead,
  Pagination,
  SectionHead,
  Tabs,
  options,
} from "../components/ui";
import { dateLabel, initials, list, titleCase } from "../lib";
import type { Audit, Page, Policy } from "../types";
export function ProfilePage() {
  const { user, reload } = useAuth();
  return (
    <div className="page-enter">
      <PageHead eyebrow="YOUR CAMPUS IDENTITY" title="Make yourself at home." />
      <div className="profile-layout">
        <aside className="profile-card">
          <span className="avatar large">{initials(user!.name)}</span>
          <h2>{user!.name}</h2>
          <span className="eyebrow">{titleCase(user!.role)}</span>
          <p>{user!.email}</p>
          <p>{user!.roll_number}</p>
        </aside>
        <section>
          <SectionHead title="The essentials." />
          <ActionForm
            fields={[
              {
                name: "name",
                label: "Full name",
                value: user!.name,
                full: true,
                max: 100,
              },
              {
                name: "hostel",
                label: "Hostel",
                value: user!.hostel ?? "",
                required: false,
                max: 100,
              },
              {
                name: "room",
                label: "Room",
                value: user!.room ?? "",
                required: false,
                max: 30,
              },
              {
                name: "dietaryPreference",
                label: "Dietary preference",
                value: user!.dietary_preference,
                options: options("VEG", "NON_VEG", "VEGAN"),
                full: true,
              },
              {
                name: "allergies",
                label: "Food allergies",
                type: "textarea",
                required: false,
                value: user!.allergies.join(", "),
                help: "Separate allergies with commas. Always confirm ingredients with the kitchen.",
              },
            ]}
            onSubmit={async (values) => {
              await api("/users/me", "PATCH", {
                name: values.name,
                hostel: values.hostel || null,
                room: values.room || null,
                dietaryPreference: values.dietaryPreference,
                allergies: list(values.allergies!),
              });
              await reload();
            }}
            success="Your profile is up to date."
          />
          <SectionHead title="A little more security." />
          <ActionForm
            fields={[
              {
                name: "currentPassword",
                label: "Current password",
                type: "password",
                full: true,
                autoComplete: "current-password",
                max: 128,
              },
              {
                name: "newPassword",
                label: "New password",
                type: "password",
                full: true,
                min: 12,
                max: 128,
                autoComplete: "new-password",
                help: "12+ characters with uppercase, lowercase and a number.",
              },
              {
                name: "confirmPassword",
                label: "Confirm new password",
                type: "password",
                full: true,
                max: 128,
                autoComplete: "new-password",
              },
            ]}
            onSubmit={async (values) => {
              if (values.newPassword !== values.confirmPassword)
                throw new Error("The new passwords do not match.");
              await api("/auth/password", "POST", {
                currentPassword: values.currentPassword,
                newPassword: values.newPassword,
              });
              window.dispatchEvent(new Event("mess:session-expired"));
            }}
            success="Password updated. Sign in again to continue."
            submit="Change password"
          />
        </section>
      </div>
    </div>
  );
}
export function SettingsPage() {
  const [tab, setTab] = useState("policy");
  const [page, setPage] = useState(1);
  const q = useApi<Policy>("/settings");
  const audit = useApi<Page<Audit>>(
    tab === "audit" ? `/audit?page=${page}&limit=20` : null,
  );
  return (
    <div className="page-enter">
      <PageHead eyebrow="THE WAY WE RUN" title="A few ground rules." />
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "policy", label: "Mess policy" },
          { value: "audit", label: "Activity journal" },
        ]}
      />
      {tab === "policy" ? (
        <Load query={q}>
          {q.data && (
            <div className="settings-panel">
              <h2>A predictable routine.</h2>
              <p className="serif-copy">
                Give residents time to plan, and the kitchen time to prepare.
              </p>
              <ActionForm
                key={JSON.stringify(q.data)}
                fields={[
                  {
                    name: "bookingHorizonDays",
                    label: "Advance booking window",
                    type: "number",
                    min: 1,
                    max: 60,
                    value: q.data.booking_horizon_days,
                    full: true,
                    help: "Days ahead residents can reserve a meal.",
                  },
                  {
                    name: "minimumLeaveDays",
                    label: "Minimum leave duration",
                    type: "number",
                    min: 1,
                    max: 30,
                    value: q.data.minimum_leave_days,
                    full: true,
                    help: "Consecutive days required for a leave request.",
                  },
                  {
                    name: "feedbackWindowDays",
                    label: "Meal feedback window",
                    type: "number",
                    min: 1,
                    max: 30,
                    value: q.data.feedback_window_days,
                    full: true,
                    help: "Days after a meal that feedback remains open.",
                  },
                ]}
                onSubmit={(values) =>
                  api(
                    "/settings",
                    "PATCH",
                    Object.fromEntries(
                      Object.entries(values).map(([key, value]) => [
                        key,
                        Number(value),
                      ]),
                    ),
                  )
                }
                success="Mess policy updated."
              />
            </div>
          )}
        </Load>
      ) : (
        <Load query={audit}>
          <div className="audit-list">
            {audit.data?.items.map((entry) => (
              <details key={entry.id}>
                <summary>
                  <span className="eyebrow">
                    {dateLabel(entry.created_at, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <strong>{titleCase(entry.action)}</strong>
                  <span>{entry.actor_name ?? "System"}</span>
                </summary>
                <dl className="detail-list">
                  <div>
                    <dt>Record</dt>
                    <dd>
                      {titleCase(entry.entity_type)} · {entry.entity_id}
                    </dd>
                  </div>
                  {Object.entries(entry.details).map(([key, value]) => (
                    <div key={key}>
                      <dt>{titleCase(key.replace(/([A-Z])/g, " $1"))}</dt>
                      <dd>
                        {typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
          </div>
          {!audit.data?.items.length && (
            <Empty
              title="A fresh start."
              text="Account and mess activity will appear here."
            />
          )}
          <Pagination data={audit.data} onPage={setPage} />
        </Load>
      )}
    </div>
  );
}
