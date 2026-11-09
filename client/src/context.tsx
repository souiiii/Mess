import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, queryClient, setCsrf } from "./api";
import type { User } from "./types";
import { X, Check, AlertCircle } from "lucide-react";
const AuthContext = createContext<{
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}>(null!);
export const useAuth = () => useContext(AuthContext);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  async function reload() {
    const data = await api<{ user: User; csrfToken: string }>("/auth/me");
    setCsrf(data.csrfToken);
    setUser(data.user);
  }
  useEffect(() => {
    reload()
      .catch(() => {})
      .finally(() => setLoading(false));
    const expire = () => {
      setUser(null);
      setCsrf("");
      queryClient.clear();
    };
    window.addEventListener("mess:session-expired", expire);
    return () => window.removeEventListener("mess:session-expired", expire);
  }, []);
  async function signIn(email: string, password: string) {
    const data = await api<{ user: User; csrfToken: string }>(
      "/auth/login",
      "POST",
      { email, password },
    );
    queryClient.clear();
    setCsrf(data.csrfToken);
    setUser(data.user);
    return data.user;
  }
  async function signOut() {
    await api("/auth/logout", "POST");
    setUser(null);
    setCsrf("");
    queryClient.clear();
  }
  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, reload }}>
      {children}
    </AuthContext.Provider>
  );
}
const ToastContext = createContext<(message: string, error?: boolean) => void>(
  () => {},
);
export const useToast = () => useContext(ToastContext);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  function notify(message: string, error = false) {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, error });
    timer.current = setTimeout(() => setToast(null), 6000);
  }
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-region" aria-live="polite">
        {toast && (
          <div className="toast">
            {toast.error ? <AlertCircle size={19} /> : <Check size={19} />}
            <span>{toast.message}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
