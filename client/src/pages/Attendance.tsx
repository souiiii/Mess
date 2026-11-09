import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { Camera, Check, ScanLine, Square } from "lucide-react";
import { api, refresh, useApi } from "../api";
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  Load,
  PageHead,
  Pagination,
} from "../components/ui";
import { dateLabel, titleCase, today } from "../lib";
import type { Booking, Meal, Page } from "../types";
interface Scan {
  student: { name: string; rollNumber: string; hostel: string };
  meal: { type: string; date: string };
  extras: { name: string; quantity: number }[];
  attendedAt: string;
}
export default function AttendancePage() {
  const [date, setDate] = useState(today());
  const [meal, setMeal] = useState("");
  const [page, setPage] = useState(1);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<Scan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const lock = useRef(false);
  const meals = useApi<Meal[]>(`/meals?from=${date}&to=${date}`);
  const roster = useApi<Page<Booking>>(
    `/bookings?from=${date}&to=${date}&page=${page}&limit=15${meal ? `&mealId=${meal}` : ""}`,
  );
  async function scan(value: string) {
    if (lock.current) return;
    lock.current = true;
    controls.current?.stop();
    setCamera(false);
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api<Scan>("/attendance/scan", "POST", { token: value.trim() }),
      );
      setToken("");
      await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  useEffect(() => {
    if (!camera) return;
    let stopped = false;
    const reader = new BrowserQRCodeReader();
    reader
      .decodeFromVideoDevice(undefined, video.current!, (value) => {
        if (value && !stopped) {
          stopped = true;
          void scan(value.getText());
        }
      })
      .then((handle) => {
        if (stopped) handle.stop();
        else controls.current = handle;
      })
      .catch((err) => {
        if (!stopped) {
          setError(
            new Error(
              err.name === "NotAllowedError"
                ? "Camera access was denied. Allow access or enter the pass code below."
                : "Camera unavailable. Connect a camera or enter the pass code below.",
            ),
          );
          setCamera(false);
        }
      });
    return () => {
      stopped = true;
      controls.current?.stop();
      controls.current = null;
    };
  }, [camera]);
  return (
    <div className="page-enter">
      <PageHead
        eyebrow="THE SERVING DESK"
        title="A warm welcome."
        description="One scan. One serving."
      />
      <div className="scanner-layout">
        <section className="scanner-stage">
          {result ? (
            <div className="scan-success">
              <span className="success-mark">
                <Check size={38} strokeWidth={1.2} />
              </span>
              <span className="eyebrow">PASS ACCEPTED</span>
              <h2>{result.student.name}</h2>
              <p>
                {result.student.rollNumber} ·{" "}
                {result.student.hostel || "Campus resident"}
              </p>
              <div className="scan-meal">
                {titleCase(result.meal.type)} · {dateLabel(result.meal.date)}
              </div>
              {result.extras.map((extra) => (
                <div className="story-row" key={extra.name}>
                  <span>{extra.name}</span>
                  <strong>× {extra.quantity}</strong>
                </div>
              ))}
              <Button
                onClick={() => {
                  setResult(null);
                  setCamera(true);
                }}
              >
                Scan next pass
                <ScanLine size={17} />
              </Button>
            </div>
          ) : (
            <>
              <div className={`camera-window ${camera ? "running" : ""}`}>
                <video
                  ref={video}
                  muted
                  playsInline
                  aria-label="Meal pass camera"
                />
                {!camera && (
                  <div className="camera-placeholder">
                    <ScanLine size={64} strokeWidth={0.75} />
                    <h2>Ready when you are.</h2>
                    <p>Hold a resident’s meal pass up to the camera.</p>
                  </div>
                )}
                {camera && <div className="scan-frame" />}
              </div>
              <div className="camera-controls">
                <span className="eyebrow">
                  {camera ? "CAMERA IS LIVE" : "MEAL PASS SCANNER"}
                </span>
                <Button
                  busy={busy}
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setCamera(!camera);
                  }}
                >
                  {camera ? <Square size={15} /> : <Camera size={17} />}
                  {camera ? "Stop camera" : "Start camera"}
                </Button>
              </div>
            </>
          )}
        </section>
        <aside className="scanner-aside">
          <span className="eyebrow">A LITTLE BACKUP</span>
          <h2>Have the code?</h2>
          <p className="serif-copy">
            Enter the resident’s current pass code if the camera can’t read it.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setResult(null);
              void scan(token);
            }}
          >
            <label className="field">
              <span>Meal pass code</span>
              <textarea
                required
                minLength={20}
                maxLength={500}
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste the pass code"
                rows={3}
              />
            </label>
            <Button type="submit" busy={busy}>
              Check in
              <Check size={16} />
            </Button>
          </form>
          <p className="small muted">
            Passes expire after two minutes. Each pass can be used once.
          </p>
          {error ? <ErrorBox error={error} /> : null}
        </aside>
      </div>
      <div className="section-head">
        <h2>The service list.</h2>
        <div className="inline-controls">
          <input
            aria-label="Service date"
            type="date"
            value={date}
            onChange={(event) => {
              if (event.target.value) {
                setDate(event.target.value);
                setMeal("");
                setPage(1);
              }
            }}
          />
          <select
            aria-label="Service"
            value={meal}
            onChange={(event) => {
              setMeal(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All services</option>
            {meals.data?.map((item) => (
              <option value={item.id} key={item.id}>
                {titleCase(item.meal_type)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Load query={roster}>
        {roster.data?.items.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Resident</th>
                  <th>Roll number</th>
                  <th>Meal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {roster.data.items.map((booking) => (
                  <tr key={booking.id}>
                    <td>{booking.name}</td>
                    <td>{booking.roll_number}</td>
                    <td>{titleCase(booking.meal_type)}</td>
                    <td>
                      <Badge status={booking.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No bookings for this service." />
        )}
        <Pagination data={roster.data} onPage={setPage} />
      </Load>
    </div>
  );
}
