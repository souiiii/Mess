import { useState } from "react";
import { ArrowUpRight, CalendarDays, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { api, useApi } from "../api";
import { useAuth } from "../context";
import type { Leave, Page, Policy } from "../types";
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
} from "../components/ui";
import { addDays, dateLabel, management, today } from "../lib";
export default function LeavePage() {
  const { user } = useAuth();
  const manage = management(user!.role);
  const [status, setStatus] = useState(manage ? "PENDING" : "ALL");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ type: string; leave?: Leave } | null>(
    null,
  );
  const q = useApi<Page<Leave>>(
    `/leaves?page=${page}&limit=12${status !== "ALL" ? `&status=${status}` : ""}`,
  );
  const policy = useApi<Policy>("/settings");
  return (
    <div className="page-enter">
      <PageHead
        eyebrow={
          manage
            ? "PLAN WITH THE RIGHT HEADCOUNT"
            : "LESS WASTE. MORE PEACE OF MIND."
        }
        title={manage ? "Away from the table." : "A little time away."}
        description={
          manage
            ? "Review leave before the kitchen starts preparing."
            : "Heading home? Let the kitchen know."
        }
      >
        {!manage && (
          <Button onClick={() => setModal({ type: "create" })}>
            <Plus size={16} />
            Plan a leave
          </Button>
        )}
      </PageHead>
      {!manage && (
        <div className="leave-intro">
          <div className="leave-symbol">
            <CalendarDays size={44} strokeWidth={1} />
          </div>
          <div>
            <span className="eyebrow">A SMALL HEADS-UP GOES A LONG WAY</span>
            <h2>
              Save the meals
              <br />
              you won’t be here for.
            </h2>
          </div>
          <div className="leave-rules">
            <p>
              <strong>{policy.data?.minimum_leave_days ?? 2} days</strong>{" "}
              minimum leave
            </p>
            <p>Request before your meal cutoffs.</p>
            <p>Approved leave cancels eligible bookings.</p>
          </div>
        </div>
      )}
      <div className="filter-line">
        <Tabs
          value={status}
          onChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={[
            { value: "ALL", label: "All requests" },
            { value: "PENDING", label: "Pending" },
            { value: "APPROVED", label: "Approved" },
            { value: "REJECTED", label: "Rejected" },
          ]}
        />
        <span className="eyebrow">{q.data?.total ?? 0} REQUESTS</span>
      </div>
      <Load query={q}>
        {q.data?.items.length ? (
          <div className="leave-list">
            {q.data.items.map((leave) => (
              <article key={leave.id} className="leave-row">
                <div className="leave-date">
                  <span className="eyebrow">
                    {dateLabel(leave.starts_on, {
                      month: "long",
                      year: "numeric",
                    })}
                  </span>
                  <h3>
                    {dateLabel(leave.starts_on, { day: "2-digit" })}
                    <span>—</span>
                    {dateLabel(leave.ends_on, {
                      day: "2-digit",
                      month: "short",
                    })}
                  </h3>
                </div>
                <div className="leave-description">
                  {manage && (
                    <strong>
                      {leave.name}{" "}
                      <span className="muted small">{leave.roll_number}</span>
                    </strong>
                  )}
                  <p>{leave.reason}</p>
                  {leave.review_note && (
                    <small className="muted">
                      Mess office: {leave.review_note}
                    </small>
                  )}
                </div>
                <div className="leave-actions">
                  <Badge status={leave.status} />
                  {manage && leave.status === "PENDING" && (
                    <Button
                      variant="outline"
                      onClick={() => setModal({ type: "review", leave })}
                    >
                      Review
                      <ArrowUpRight size={14} />
                    </Button>
                  )}
                  {!manage &&
                    ["PENDING", "APPROVED"].includes(leave.status) &&
                    leave.starts_on > today() && (
                      <button
                        className="text-button"
                        onClick={() => setModal({ type: "withdraw", leave })}
                      >
                        Withdraw
                      </button>
                    )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title={
              manage ? "You’re all caught up." : "No plans to be away yet."
            }
            text={
              manage
                ? "New leave requests will arrive here."
                : "Your leave requests will be kept here."
            }
          />
        )}
        <Pagination data={q.data} onPage={setPage} />
      </Load>
      {modal?.type === "create" && (
        <Modal title="Off for a while?" onClose={() => setModal(null)}>
          <ActionForm
            fields={[
              {
                name: "startsOn",
                label: "First day away",
                type: "date",
                value: addDays(today(), 1),
                min: addDays(today(), 1),
              },
              {
                name: "endsOn",
                label: "Last day away",
                type: "date",
                value: addDays(today(), policy.data?.minimum_leave_days ?? 2),
                min: addDays(today(), 1),
              },
              {
                name: "reason",
                label: "Reason",
                type: "textarea",
                placeholder: "Going home, an event, or something else…",
                max: 1000,
              },
            ]}
            submit="Request leave"
            success="Leave requested. Watch here for the decision."
            onDone={() => setModal(null)}
            onSubmit={(values) => api("/leaves", "POST", values)}
          />
        </Modal>
      )}
      {modal?.type === "review" && (
        <Modal title="Review this leave." onClose={() => setModal(null)}>
          <p className="modal-copy">
            {modal.leave!.name} · {dateLabel(modal.leave!.starts_on)}—
            {dateLabel(modal.leave!.ends_on)}
          </p>
          <blockquote>{modal.leave!.reason}</blockquote>
          <ActionForm
            fields={[
              {
                name: "decision",
                label: "Decision",
                options: [
                  { value: "APPROVED", label: "Approve" },
                  { value: "REJECTED", label: "Decline" },
                ],
                full: true,
              },
              {
                name: "note",
                label: "Note to the resident",
                type: "textarea",
                max: 1000,
              },
            ]}
            submit="Save decision"
            success="Leave decision saved."
            onDone={() => setModal(null)}
            onSubmit={(values) =>
              api(`/leaves/${modal.leave!.id}/review`, "POST", values)
            }
          />
        </Modal>
      )}
      {modal?.type === "withdraw" && (
        <Modal title="Back at the table?" onClose={() => setModal(null)}>
          <p className="modal-copy">
            Withdrawing this leave won’t restore cancelled meals. Book them
            again from the menu.
          </p>
          <ActionForm
            fields={[]}
            submit="Withdraw leave"
            success="Leave withdrawn. You can book meals again."
            onDone={() => setModal(null)}
            onSubmit={() => api(`/leaves/${modal.leave!.id}/withdraw`, "POST")}
          />
        </Modal>
      )}
    </div>
  );
}
