import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import request from "supertest";
import App from "../src/App";
import { AuthProvider, ToastProvider } from "../src/context";
import { queryClient, setCsrf } from "../src/api";
import { fixture, password } from "../../server/test/helpers";
import { one } from "../../server/src/db";
let f: Awaited<ReturnType<typeof fixture>>;
let calls: { path: string; method: string; status: number }[];
let pending: Set<Promise<unknown>>;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T03:00:00.000Z"));
  f = await fixture();
  f.config.paymentsMode = "FAKE";
  calls = [];
  pending = new Set();
  queryClient.clear();
  setCsrf("");
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 0 } });
});
afterEach(async () => {
  cleanup();
  await Promise.allSettled([...pending]);
  queryClient.clear();
  f.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function mount(path: string, who = "student") {
  const agent = request.agent(f.app);
  await agent
    .post("/api/v1/auth/login")
    .send({ email: `${who}@example.edu`, password })
    .expect(200);
  vi.stubGlobal("fetch", (url: string, init: RequestInit = {}) => {
    const job = (async () => {
      const method = (init.method ?? "GET").toLowerCase();
      let req = (agent as any)[method](url);
      for (const [key, value] of Object.entries(init.headers ?? {}))
        req = req.set(key, value);
      if (init.body) req = req.send(JSON.parse(String(init.body)));
      const res = await req;
      calls.push({ path: url, method, status: res.status });
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { "Content-Type": "application/json" },
      });
    })();
    pending.add(job);
    job.finally(() => pending.delete(job));
    return job;
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}
async function dialog(title: string | RegExp) {
  return screen.findByRole("dialog", { name: title });
}
function failures() {
  return calls.filter((call) => call.status >= 400);
}
describe("React screens against the real Express API", () => {
  it("books a meal, opens its details, and cancels it without leaving a charge", async () => {
    const meal = f.meal();
    await mount("/app/menu?date=2026-11-08");
    await screen.findByRole("button", { name: "Save my seat" });
    click("Save my seat");
    await screen.findByRole("link", { name: "Your booking" });
    fireEvent.click(screen.getByRole("link", { name: "Your booking" }));
    const panel = await dialog("Lunch");
    await within(panel).findByText("Rice");
    click("Cancel booking");
    fill("Reason", "Going home for the day");
    click("Cancel my booking");
    await waitFor(() =>
      expect(
        one(f.db, "SELECT status FROM bookings WHERE meal_id=?", meal)?.status,
      ).toBe("CANCELLED"),
    );
    expect(failures()).toEqual([]);
  });
  it("handles failed and successful simulated payment attempts and refreshes the balance", async () => {
    f.setTime("2026-10-05T03:00:00.000Z");
    const meal = f.meal({
      date: "2026-10-06",
      starts: "2026-10-06T06:30:00.000Z",
      ends: "2026-10-06T08:30:00.000Z",
      cutoff: "2026-10-06T03:30:00.000Z",
    });
    const student = await f.login();
    await student.post("/bookings", { mealId: meal }).expect(201);
    f.setTime("2026-11-07T03:00:00.000Z");
    const manager = await f.login("manager");
    await manager
      .post("/invoices", {
        userId: f.ids.student,
        month: "2026-10",
        dueOn: "2026-11-15",
      })
      .expect(201);
    await mount("/app/billing");
    await screen.findByText("UNPAID INVOICES");
    await screen.findByText("Current month’s estimated bill");
    await screen.findByRole("button", { name: "October 2026" });
    click("October 2026");
    await screen.findByRole("button", { name: "Pay ₹60" });
    click("Pay ₹60");
    fill("Simulation outcome", "FAILURE");
    click("Simulate payment");
    await screen.findByText("Payment declined.");
    click("Back to statement");
    click("Pay ₹60");
    click("Simulate payment");
    await screen.findByText("Your simulated payment is recorded.");
    await waitFor(() =>
      expect(one(f.db, "SELECT sum(amount_paise) AS n FROM payments")?.n).toBe(
        6000,
      ),
    );
    expect(one(f.db, "SELECT count(*) AS n FROM payment_attempts")?.n).toBe(2);
    expect(failures()).toEqual([]);
  });
  it("creates a leave request and retains server validation errors in the dialog", async () => {
    await mount("/app/leave");
    await screen.findByRole("button", { name: "Plan a leave" });
    click("Plan a leave");
    fill("Reason", "Visiting family");
    fill("First day away", "2026-11-10");
    fill("Last day away", "2026-11-08");
    click("Request leave");
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog")).toBeTruthy();
    fill("Last day away", "2026-11-13");
    click("Request leave");
    await waitFor(() =>
      expect(one(f.db, "SELECT count(*) AS n FROM leave_requests")?.n).toBe(1),
    );
    await screen.findByText("Visiting family");
  });
  it("publishes a manager draft with IST service times", async () => {
    await mount("/app/menu?date=2026-11-08", "manager");
    await screen.findByRole("button", { name: "New service" });
    click("New service");
    fill("Menu title", "Sunday thali");
    fill("Dishes", "Rice\nDalma\nSalad");
    click("Create draft");
    await screen.findByRole("button", { name: "Publish" });
    click("Publish");
    await waitFor(() =>
      expect(
        one(
          f.db,
          "SELECT status FROM meal_services WHERE title=?",
          "Sunday thali",
        )?.status,
      ).toBe("PUBLISHED"),
    );
    expect(
      one(
        f.db,
        "SELECT starts_at FROM meal_services WHERE title=?",
        "Sunday thali",
      )?.starts_at,
    ).toBe("2026-11-08T06:30:00.000Z");
    expect(failures()).toEqual([]);
  });
  it("records a supplier delivery and updates the stock ledger", async () => {
    const manager = await f.login("manager");
    await manager
      .post("/suppliers", {
        name: "Campus supplier",
        contact: "Local warehouse",
      })
      .expect(201);
    await manager
      .post("/inventory", {
        name: "Rice",
        unit: "GRAM",
        lowStockThreshold: 5000,
      })
      .expect(201);
    await mount("/app/kitchen", "manager");
    await screen.findByRole("button", { name: "Rice" });
    click("Rice");
    await dialog("Rice");
    click("Record movement");
    fill(/Quantity/, "10000");
    fill("Total delivery cost (₹)", "450");
    await waitFor(() =>
      expect(
        screen.getByRole("option", { name: "Campus supplier" }),
      ).toBeTruthy(),
    );
    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: one(f.db, "SELECT id FROM suppliers")!.id },
    });
    fill("Delivery / receipt reference", "DEL-001");
    fill("Reason / kitchen note", "Weekly delivery");
    const panel = screen.getByRole("dialog");
    fireEvent.submit(panel.querySelector("form")!);
    await waitFor(() =>
      expect(one(f.db, "SELECT stock FROM inventory_items")?.stock).toBe(10000),
    );
    await screen.findByText("Stock ledger updated.");
    expect(failures()).toEqual([]);
  });
  it("accepts a live pass at the serving desk and protects manager routes from staff", async () => {
    const meal = f.meal();
    const student = await f.login();
    const booking = (await student.post("/bookings", { mealId: meal })).body
      .data;
    f.setTime("2026-11-08T06:31:00.000Z");
    vi.setSystemTime(new Date("2026-11-08T06:31:00.000Z"));
    const freshStudent = await f.login();
    const pass = (
      await freshStudent.post(`/bookings/${booking.id}/pass`).expect(200)
    ).body.data;
    await mount("/app/attendance", "staff");
    await screen.findByRole("heading", { name: "A warm welcome." });
    expect(screen.queryByRole("link", { name: "Billing" })).toBeNull();
    expect(screen.queryByRole("link", { name: "People" })).toBeNull();
    fill("Meal pass code", pass.token);
    click("Check in");
    await screen.findByText("PASS ACCEPTED");
    expect(
      one(f.db, "SELECT status FROM bookings WHERE id=?", booking.id)?.status,
    ).toBe("ATTENDED");
    expect(failures()).toEqual([]);
  });
  it("creates a private conversation and sends a reply", async () => {
    await mount("/app/community");
    await screen.findByRole("button", { name: "Start a conversation" });
    click("Start a conversation");
    fill("In a few words", "Lunch portions");
    fill("Tell us a little more", "Please provide more vegetables.");
    click("Send to the mess team");
    await screen.findByRole("button", { name: /Lunch portions/ });
    click(/Lunch portions/);
    await dialog("Lunch portions");
    await screen.findByLabelText("Your reply");
    fill("Your reply", "Thank you for listening.");
    click("Send reply");
    await waitFor(() =>
      expect(one(f.db, "SELECT count(*) AS n FROM complaint_replies")?.n).toBe(
        1,
      ),
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Your reply") as HTMLTextAreaElement).value,
      ).toBe(""),
    );
    expect(failures()).toEqual([]);
  });
  it("creates an account with a forced password change", async () => {
    await mount("/app/residents", "admin");
    await screen.findByRole("button", { name: "Add account" });
    click("Add account");
    fill("Full name", "New Resident");
    fill("Email", "resident@example.edu");
    fill("Temporary password", "CampusStart2026!");
    fill("Roll number", "B-NEW");
    click("Create account");
    await waitFor(() =>
      expect(
        one(
          f.db,
          "SELECT must_change_password FROM users WHERE email=?",
          "resident@example.edu",
        )?.must_change_password,
      ).toBe(1),
    );
    expect(failures()).toEqual([]);
  });
  it("updates dietary preferences and allergies", async () => {
    await mount("/app/profile");
    await screen.findByLabelText("Full name");
    fill("Dietary preference", "VEGAN");
    fill("Food allergies", "Milk, Peanuts");
    click("Save changes");
    await waitFor(() =>
      expect(
        one(
          f.db,
          "SELECT dietary_preference FROM users WHERE id=?",
          f.ids.student!,
        )?.dietary_preference,
      ).toBe("VEGAN"),
    );
    expect(
      JSON.parse(
        one(f.db, "SELECT allergies FROM users WHERE id=?", f.ids.student!)!
          .allergies,
      ),
    ).toEqual(["Milk", "Peanuts"]);
    expect(failures()).toEqual([]);
  });
  it("updates policy and shows the corresponding audit entry", async () => {
    await mount("/app/settings", "admin");
    await screen.findByLabelText("Advance booking window");
    fill("Advance booking window", "20");
    click("Save changes");
    await waitFor(() =>
      expect(
        one(f.db, "SELECT booking_horizon_days FROM settings")
          ?.booking_horizon_days,
      ).toBe(20),
    );
    click("Activity journal");
    await screen.findByText("Settings Changed");
    expect(failures()).toEqual([]);
  });
  it("redirects a student away from administration without requesting private data", async () => {
    await mount("/app/residents");
    await screen.findByRole("heading", { name: /Your place/ });
    expect(calls.some((call) => call.path.includes("/users?"))).toBe(false);
    expect(failures()).toEqual([]);
  });
  it("disables a meal after its booking cutoff", async () => {
    f.meal({
      date: "2026-11-07",
      starts: "2026-11-07T06:30:00.000Z",
      ends: "2026-11-07T08:30:00.000Z",
      cutoff: "2026-11-07T02:30:00.000Z",
    });
    await mount("/app/menu");
    const button = await screen.findByRole("button", {
      name: "Booking closed",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(failures()).toEqual([]);
  });
  it.each([
    ["/app", "student", "Your place"],
    ["/app", "manager", "A well-run table."],
    ["/app/reports", "manager", "Every meal adds up."],
    ["/app/residents", "admin", "Faces at the table."],
    ["/app/settings", "admin", "A few ground rules."],
    ["/app/profile", "student", "Make yourself at home."],
  ])(
    "loads %s as %s without API contract failures",
    async (path, role, heading) => {
      f.meal();
      await mount(path, role);
      await screen.findByRole("heading", { name: new RegExp(heading) });
      await waitFor(() =>
        expect(screen.queryByRole("status", { name: "Loading" })).toBeNull(),
      );
      expect(failures()).toEqual([]);
    },
  );
});
