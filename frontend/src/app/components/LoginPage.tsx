import { FormEvent, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { login } from "../lib/auth";
import feedbackLogo from "./image/hospital_logo.png";
import { HOSPITAL } from "../lib/hospital";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = (location.state as { from?: string } | null)?.from;

  /**
   * Land the user on the first screen their capabilities actually allow. Keyed
   * off capabilities rather than role names, so Super Admin and Management (and
   * any future role) route correctly without another branch here.
   */
  function continueAfterLogin(capabilities: string[], role?: string) {
    if (capabilities.includes("roles.manage") || capabilities.includes("users.manage")) {
      navigate("/admin", { replace: true });
      return;
    }
    // Staff, management and HODs share the Dashboard; a HOD's data is limited on the server.
    if (capabilities.includes("insights.view")) {
      navigate(nextPath || "/insights", { replace: true });
      return;
    }
    if (capabilities.includes("feedback.read.assigned")) {
      navigate(nextPath || "/dashboard", { replace: true });
      return;
    }
    if (capabilities.includes("feedback.read.all")) {
      navigate(nextPath || "/dashboard", { replace: true });
      return;
    }
    navigate(nextPath || "/feedback", { replace: true });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const session = await login(username, password);

    if (!session) {
      setError("Invalid username or password.");
      return;
    }

    continueAfterLogin(session.capabilities ?? [], session.role);
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md overflow-hidden bg-white rounded-3xl shadow-xl border border-gray-200/70">
        <div aria-hidden="true" className="h-1.5 bg-gradient-to-r from-primary via-primary to-brand-gold" />
        <div className="p-8 sm:p-10">
        <div className="flex justify-center mb-6">
          <img
            src={feedbackLogo}
            alt={`${HOSPITAL.shortName} feedback system`}
            className="h-32 sm:h-40 w-auto max-w-[min(100%,300px)] object-contain"
          />
        </div>
        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A6A10] mb-2">
          Employee Feedback System
        </p>
        <h2 className="text-2xl sm:text-[1.7rem] font-bold leading-tight text-gray-900 mb-3 text-center">{HOSPITAL.name}</h2>
        <div aria-hidden="true" className="mx-auto mb-4 h-0.5 w-12 rounded-full bg-brand-gold" />
        <p className="text-sm text-gray-500 mb-7 text-center">
          Login as Admin, Staff, or HOD to manage feedback.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin / staff / hod"
              className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-xl transition focus:bg-white focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-300 rounded-xl transition focus:bg-white focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 px-3 text-gray-500 hover:text-gray-700"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <button
            type="submit"
            className="w-full py-3 mt-2 bg-primary text-white font-semibold rounded-xl shadow-md shadow-primary/20 hover:bg-primary-hover focus:outline-none focus:ring-4 focus:ring-primary/25 transition-colors"
          >
            Login
          </button>
        </form>
        </div>
      </div>
    </div>
  );
}
