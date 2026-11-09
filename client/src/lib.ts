export const money = (paise = 0) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: paise % 100 ? 2 : 0,
  }).format(paise / 100);
export const today = () =>
  new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const dateLabel = (
  value: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    ...options,
  }).format(new Date(value.length === 10 ? `${value}T12:00:00+05:30` : value));
export const timeLabel = (value: string) =>
  dateLabel(value, { hour: "numeric", minute: "2-digit", hour12: true });
export const monthLabel = (value: string) =>
  dateLabel(`${value}-01`, { month: "long", year: "numeric" });
export const titleCase = (value: string) =>
  value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
export const management = (role: string) => ["ADMIN", "MANAGER"].includes(role);
export const list = (text: string) =>
  text
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
export const paise = (value: string) => Math.round(Number(value) * 100);
export const quantity = (value: number, unit: string) =>
  unit === "GRAM"
    ? `${(value / 1000).toLocaleString("en-IN")} kg`
    : unit === "MILLILITRE"
      ? `${(value / 1000).toLocaleString("en-IN")} L`
      : `${value.toLocaleString("en-IN")} pcs`;
export const istInput = (value: string) =>
  new Date(Date.parse(value) + 330 * 60000).toISOString().slice(0, 16);
export const istTimestamp = (value: string) =>
  new Date(`${value}:00+05:30`).toISOString();
export const rangePath = (from: string, to: string) => `from=${from}&to=${to}`;
