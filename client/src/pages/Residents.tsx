import { useState } from "react";
import { ArrowUpRight, Plus, Search } from "lucide-react";
import { api, useApi } from "../api";
import { useAuth } from "../context";
import {
  ActionForm,
  Badge,
  Button,
  Empty,
  Load,
  Modal,
  PageHead,
  Pagination,
  options,
} from "../components/ui";
import { initials, titleCase, today } from "../lib";
import type { Page, User } from "../types";
export default function ResidentsPage() {
  const { user } = useAuth();
  const admin = user!.role === "ADMIN";
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("STUDENT");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<User | null>(null);
  const [create, setCreate] = useState(false);
  const [action, setAction] = useState("profile");
  const q = useApi<Page<User>>(
    `/users?role=${role}&search=${encodeURIComponent(search)}&page=${page}&limit=15`,
  );
  return (
    <div className="page-enter">
      <PageHead
        eyebrow="THE CAMPUS COMMUNITY"
        title="Faces at the table."
        description="The people who make this place home."
      >
        {admin && (
          <Button onClick={() => setCreate(true)}>
            <Plus size={17} />
            Add account
          </Button>
        )}
      </PageHead>
      <div className="filter-line">
        <label className="search-field">
          <Search size={18} />
          <input
            aria-label="Search residents"
            placeholder="Search by name, email or roll number"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          aria-label="Account role"
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setPage(1);
          }}
        >
          {options("STUDENT", "STAFF", "MANAGER", "ADMIN").map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}s
            </option>
          ))}
        </select>
      </div>
      <Load query={q}>
        {q.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Roll number</th>
                  <th>Residence</th>
                  <th>Status</th>
                  <th>Profile</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((person) => (
                  <tr key={person.id}>
                    <td>
                      <button
                        className="resident-name"
                        onClick={() => {
                          setSelected(person);
                          setAction("profile");
                        }}
                      >
                        <span className="avatar">{initials(person.name)}</span>
                        <span>
                          {person.name}
                          <small>{person.email}</small>
                        </span>
                      </button>
                    </td>
                    <td>{person.roll_number ?? "—"}</td>
                    <td>
                      {[person.hostel, person.room]
                        .filter(Boolean)
                        .join(" / ") || "—"}
                    </td>
                    <td>
                      <Badge status={person.active ? "ACTIVE" : "SUSPENDED"} />
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`View ${person.name}`}
                        onClick={() => {
                          setSelected(person);
                          setAction("profile");
                        }}
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
            title="No matching accounts."
            text="Try another name or role."
          />
        )}
        <Pagination data={q.data} onPage={setPage} />
      </Load>
      {create && (
        <Modal
          title="A new face at the table."
          onClose={() => setCreate(false)}
        >
          <CreateAccount onDone={() => setCreate(false)} />
        </Modal>
      )}
      {selected && (
        <Modal
          title={selected.name}
          eyebrow={`${titleCase(selected.role)} / ${selected.roll_number ?? "CAMPUS TEAM"}`}
          onClose={() => setSelected(null)}
        >
          {action === "profile" ? (
            <>
              <dl className="detail-list">
                <div>
                  <dt>Email</dt>
                  <dd>{selected.email}</dd>
                </div>
                <div>
                  <dt>Residence</dt>
                  <dd>
                    {[selected.hostel, selected.room]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                  </dd>
                </div>
                <div>
                  <dt>Diet</dt>
                  <dd>{titleCase(selected.dietary_preference)}</dd>
                </div>
                <div>
                  <dt>Allergies</dt>
                  <dd>{selected.allergies.join(", ") || "None recorded"}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>
                    <Badge status={selected.active ? "ACTIVE" : "SUSPENDED"} />
                  </dd>
                </div>
              </dl>
              {admin && selected.id !== user!.id && (
                <div className="button-row">
                  <Button variant="outline" onClick={() => setAction("access")}>
                    Manage access
                  </Button>
                  <Button variant="ghost" onClick={() => setAction("password")}>
                    Reset password
                  </Button>
                </div>
              )}
            </>
          ) : action === "access" ? (
            <ActionForm
              fields={[
                {
                  name: "role",
                  label: "Role",
                  value: selected.role,
                  options: options("STUDENT", "STAFF", "MANAGER", "ADMIN"),
                },
                {
                  name: "active",
                  label: "Account status",
                  value: String(Boolean(selected.active)),
                  options: [
                    { value: "true", label: "Active" },
                    { value: "false", label: "Suspended" },
                  ],
                },
              ]}
              submit="Update access"
              onDone={() => setSelected(null)}
              onSubmit={(values) =>
                api(`/users/${selected.id}/access`, "PATCH", {
                  role: values.role,
                  active: values.active === "true",
                })
              }
              success="Account access updated."
            />
          ) : (
            <>
              <p className="modal-copy">
                The resident will set a new password at their next sign-in.
                Existing sessions will end.
              </p>
              <ActionForm
                fields={[
                  {
                    name: "temporaryPassword",
                    label: "Temporary password",
                    type: "password",
                    min: 12,
                    max: 128,
                    full: true,
                    autoComplete: "new-password",
                    help: "12+ characters with uppercase, lowercase and a number.",
                  },
                ]}
                submit="Reset password"
                onDone={() => setSelected(null)}
                onSubmit={(values) =>
                  api(`/users/${selected.id}/reset-password`, "POST", values)
                }
                success="Temporary password set. Share it with the account holder securely."
              />
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
function CreateAccount({ onDone }: { onDone: () => void }) {
  const [role, setRole] = useState("STUDENT");
  return (
    <>
      <label className="field">
        <span>Account role</span>
        <select value={role} onChange={(event) => setRole(event.target.value)}>
          {options("STUDENT", "STAFF", "MANAGER", "ADMIN").map((item) => (
            <option value={item.value} key={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <ActionForm
        key={role}
        fields={[
          { name: "name", label: "Full name", max: 100 },
          { name: "email", label: "Email", type: "email" },
          {
            name: "password",
            label: "Temporary password",
            type: "password",
            full: true,
            min: 12,
            max: 128,
            autoComplete: "new-password",
            help: "12+ characters with uppercase, lowercase and a number.",
          },
          ...(role === "STUDENT"
            ? [
                { name: "rollNumber", label: "Roll number", max: 30 },
                {
                  name: "joinedOn",
                  label: "Joined on",
                  type: "date",
                  value: today(),
                },
                { name: "hostel", label: "Hostel", required: false },
                { name: "room", label: "Room", required: false },
              ]
            : []),
        ]}
        onSubmit={(values) =>
          api("/users", "POST", {
            ...Object.fromEntries(
              Object.entries(values).filter(([, value]) => value !== ""),
            ),
            role,
          })
        }
        onDone={onDone}
        submit="Create account"
        success="Account created. Share the temporary password securely."
      />
    </>
  );
}
