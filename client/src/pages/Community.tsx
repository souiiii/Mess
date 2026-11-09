import { useState } from "react";
import { ArrowUpRight, MessageSquare, Plus, Star, Trash2 } from "lucide-react";
import { api, useApi } from "../api";
import { useAuth } from "../context";
import type { Complaint, Feedback, Notice, Page, User } from "../types";
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
  options,
} from "../components/ui";
import {
  addDays,
  dateLabel,
  istTimestamp,
  management,
  titleCase,
  today,
} from "../lib";
export default function CommunityPage() {
  const { user } = useAuth();
  const manage = management(user!.role);
  const [tab, setTab] = useState("notices");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: string; id?: string } | null>(
    null,
  );
  const notices = useApi<Notice[]>("/announcements");
  const complaints = useApi<Page<Complaint>>(
    tab === "conversations"
      ? `/complaints?page=${page}&limit=12${status === "ALL" ? "" : `&status=${status}`}`
      : null,
  );
  const feedback = useApi<Page<Feedback>>(
    tab === "feedback" ? `/feedback?page=${page}&limit=12` : null,
  );
  return (
    <div className="page-enter">
      <PageHead
        eyebrow="A BETTER MESS STARTS WITH A CONVERSATION"
        title="Around the table."
        description="Campus notes. Honest feedback. A listening ear."
      >
        {tab === "notices" && manage ? (
          <Button onClick={() => setModal({ type: "notice" })}>
            <Plus size={16} />
            Post a notice
          </Button>
        ) : (
          <Button onClick={() => setModal({ type: "complaint" })}>
            <MessageSquare size={16} />
            Start a conversation
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
          { value: "notices", label: "Noticeboard" },
          {
            value: "conversations",
            label:
              user?.role === "STUDENT" ? "My conversations" : "Conversations",
          },
          {
            value: "feedback",
            label: manage ? "Meal feedback" : "My feedback",
          },
        ]}
      />
      {tab === "notices" && (
        <Load query={notices}>
          {notices.data?.length ? (
            <div className="notice-grid">
              {notices.data.map((notice, index) => (
                <article
                  className={`notice-card ${index === 0 ? "featured" : ""}`}
                  key={notice.id}
                >
                  <div className="notice-card-meta">
                    <span className="eyebrow">
                      {notice.priority === "IMPORTANT"
                        ? "IMPORTANT /"
                        : "CAMPUS NOTE /"}{" "}
                      {dateLabel(notice.created_at)}
                    </span>
                    {manage && (
                      <button
                        className="icon-button"
                        aria-label={`Withdraw ${notice.title}`}
                        onClick={() =>
                          setModal({ type: "deleteNotice", id: notice.id })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  <h2>{notice.title}</h2>
                  <p>{notice.body}</p>
                  <div className="notice-byline">
                    <span>{notice.author_name ?? "The mess office"}</span>
                    <span>Until {dateLabel(notice.expires_at)}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              title="A quiet noticeboard."
              text="Updates from the mess office will appear here."
            />
          )}
        </Load>
      )}
      {tab === "conversations" && (
        <>
          <div className="filter-line">
            <span className="eyebrow">PRIVATE BETWEEN YOU & THE MESS TEAM</span>
            <select
              aria-label="Filter conversations"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              {["ALL", "OPEN", "IN_PROGRESS", "RESOLVED"].map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </div>
          <Load query={complaints}>
            {complaints.data?.items.length ? (
              <div className="conversation-list">
                {complaints.data.items.map((complaint) => (
                  <button
                    className="conversation-row"
                    onClick={() =>
                      setModal({ type: "thread", id: complaint.id })
                    }
                    key={complaint.id}
                  >
                    <span className="conversation-category">
                      {titleCase(complaint.category)}
                    </span>
                    <div>
                      <h3>{complaint.subject}</h3>
                      <span className="small muted">
                        {dateLabel(complaint.updated_at)}
                      </span>
                    </div>
                    <Badge status={complaint.status} />
                    <ArrowUpRight size={20} />
                  </button>
                ))}
              </div>
            ) : (
              <Empty
                title="We’re here to listen."
                text="Something on your mind? Start a private conversation."
              />
            )}
            <Pagination data={complaints.data} onPage={setPage} />
          </Load>
        </>
      )}
      {tab === "feedback" && (
        <Load query={feedback}>
          <div className="feedback-grid">
            {feedback.data?.items.map((item) => (
              <article className="feedback-card" key={item.id}>
                <span className="eyebrow">
                  {item.service_date && dateLabel(item.service_date)} /{" "}
                  {item.meal_type && titleCase(item.meal_type)}
                </span>
                <h3>{item.title}</h3>
                <div className="feedback-scores">
                  {[
                    ["Taste", item.taste],
                    ["Hygiene", item.hygiene],
                    ["Portion", item.portion],
                  ].map(([label, value]) => (
                    <span key={label}>
                      <Star size={12} fill="currentColor" />
                      {value}
                      <small>{label}</small>
                    </span>
                  ))}
                </div>
                {item.comment && <p className="serif-copy">“{item.comment}”</p>}
              </article>
            ))}
          </div>
          {!feedback.data?.items.length && (
            <Empty
              title="Every opinion counts."
              text={
                manage
                  ? "Feedback from attended meals will appear here."
                  : "Rate a meal from its booking after you’ve attended."
              }
            />
          )}
          <Pagination data={feedback.data} onPage={setPage} />
        </Load>
      )}
      {modal?.type === "notice" && (
        <Modal title="A note to the campus." onClose={() => setModal(null)}>
          <ActionForm
            fields={[
              { name: "title", label: "Headline", full: true, max: 150 },
              {
                name: "body",
                label: "Your notice",
                type: "textarea",
                max: 5000,
              },
              {
                name: "priority",
                label: "Priority",
                options: options("NORMAL", "IMPORTANT"),
              },
              {
                name: "expiresAt",
                label: "Visible until (IST)",
                type: "datetime-local",
                value: `${addDays(today(), 7)}T23:59`,
              },
            ]}
            submit="Publish notice"
            success="Notice published."
            onDone={() => setModal(null)}
            onSubmit={(values) =>
              api("/announcements", "POST", {
                ...values,
                expiresAt: istTimestamp(values.expiresAt!),
              })
            }
          />
        </Modal>
      )}
      {modal?.type === "deleteNotice" && (
        <Modal title="Take this notice down?" onClose={() => setModal(null)}>
          <ActionForm
            fields={[]}
            submit="Withdraw notice"
            success="Notice withdrawn."
            onDone={() => setModal(null)}
            onSubmit={() => api(`/announcements/${modal.id}`, "DELETE")}
          />
        </Modal>
      )}
      {modal?.type === "complaint" && (
        <Modal title="What’s on your mind?" onClose={() => setModal(null)}>
          <ActionForm
            fields={[
              {
                name: "category",
                label: "About",
                options: options(
                  "FOOD",
                  "HYGIENE",
                  "SERVICE",
                  "BILLING",
                  "OTHER",
                ),
                full: true,
              },
              {
                name: "subject",
                label: "In a few words",
                full: true,
                max: 150,
              },
              {
                name: "description",
                label: "Tell us a little more",
                type: "textarea",
                max: 5000,
              },
            ]}
            submit="Send to the mess team"
            success="Your conversation has been opened."
            onDone={() => {
              setModal(null);
              setTab("conversations");
            }}
            onSubmit={(values) => api("/complaints", "POST", values)}
          />
        </Modal>
      )}
      {modal?.type === "thread" && (
        <Thread id={modal.id!} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
function Thread({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useAuth();
  const q = useApi<Complaint>(`/complaints/${id}`);
  const [mode, setMode] = useState("reply");
  const [replyVersion, setReplyVersion] = useState(0);
  const staff = useApi<Page<User>>(
    management(user!.role) ? "/users?role=STAFF&active=true&limit=100" : null,
  );
  const managers = useApi<Page<User>>(
    management(user!.role) ? "/users?role=MANAGER&active=true&limit=100" : null,
  );
  const c = q.data;
  const canManage = user!.role !== "STUDENT";
  const assignees = [
    ...(staff.data?.items ?? []),
    ...(managers.data?.items ?? []),
    user!,
  ].filter(
    (item, index, all) =>
      all.findIndex((other) => other.id === item.id) === index &&
      (c?.category !== "BILLING" || management(item.role)),
  );
  return (
    <Modal
      title={c?.subject ?? "Conversation"}
      eyebrow={
        c
          ? `${titleCase(c.category)} / ${dateLabel(c.created_at)}`
          : "CAMPUS CONVERSATIONS"
      }
      wide
      onClose={onClose}
    >
      <Load query={q}>
        {c && (
          <>
            <div className="thread-original">
              <Badge status={c.status} />
              <p>{c.description}</p>
            </div>
            <div className="thread-replies">
              {c.replies?.map((reply) => (
                <article key={reply.id}>
                  <div>
                    <strong>{reply.author_name}</strong>
                    <span className="eyebrow">
                      {titleCase(reply.author_role)} ·{" "}
                      {dateLabel(reply.created_at)}
                    </span>
                  </div>
                  <p>{reply.message}</p>
                </article>
              ))}
            </div>
            {canManage && (
              <Tabs
                value={mode}
                onChange={setMode}
                options={[
                  { value: "reply", label: "Reply" },
                  { value: "manage", label: "Status & assignment" },
                ]}
              />
            )}
            {mode === "manage" && canManage ? (
              <ActionForm
                fields={[
                  {
                    name: "status",
                    label: "Status",
                    options: options("OPEN", "IN_PROGRESS", "RESOLVED"),
                    value: c.status,
                  },
                  {
                    name: "assignedTo",
                    label: "Assign to",
                    options: [
                      { value: "", label: "Unassigned" },
                      ...assignees.map((item) => ({
                        value: item.id,
                        label: item.name,
                      })),
                    ],
                    value: c.assigned_to ?? "",
                    required: false,
                  },
                  {
                    name: "note",
                    label: "Update for the resident",
                    type: "textarea",
                    max: 2000,
                  },
                ]}
                submit="Update conversation"
                success="Conversation updated."
                onSubmit={(values) =>
                  api(`/complaints/${id}/status`, "PATCH", {
                    ...values,
                    assignedTo: values.assignedTo || null,
                  })
                }
              />
            ) : c.status !== "RESOLVED" ? (
              <ActionForm
                key={replyVersion}
                onDone={() => setReplyVersion((value) => value + 1)}
                fields={[
                  {
                    name: "message",
                    label: "Your reply",
                    type: "textarea",
                    max: 5000,
                  },
                ]}
                submit="Send reply"
                success="Reply sent."
                onSubmit={(values) =>
                  api(`/complaints/${id}/replies`, "POST", values)
                }
              />
            ) : c.user_id === user!.id ? (
              <details className="extras-details">
                <summary>Still need help? Reopen this conversation.</summary>
                <ActionForm
                  fields={[
                    {
                      name: "reason",
                      label: "What still needs attention?",
                      type: "textarea",
                      max: 2000,
                    },
                  ]}
                  submit="Reopen conversation"
                  success="Conversation reopened."
                  onSubmit={(values) =>
                    api(`/complaints/${id}/reopen`, "POST", values)
                  }
                />
              </details>
            ) : (
              <p className="fine-print">This conversation is resolved.</p>
            )}
          </>
        )}
      </Load>
    </Modal>
  );
}
