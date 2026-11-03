import React, { useEffect, useState } from "react";
import { Outlet, ScrollRestoration, useLocation, useNavigate } from "react-router";
import {
  Bot,
  Building2,
  ClipboardList,
  FileText,
  Inbox,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquareText,
  Settings,
  ShieldCheck,
  Ticket,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./ui/sheet";
import { getSession, logout } from "../lib/auth";
import { isUserFeedPath, employeeRoutes } from "../lib/employeeRoutes";
import feedbackLogo from "./image/hospital_logo.png";
import { HOSPITAL } from "../lib/hospital";
import {
  applyBrandingTheme,
  getBrandingSettings,
  loadBrandingSettings,
  onBrandingSettingsChange,
  useModuleEnabled,
  useTicketingEnabled,
} from "../lib/branding";
import { FeedbackOutboxStatus } from "./FeedbackOutboxStatus";
import { HodChangePasswordDialog } from "./HodChangePasswordDialog";
import { MOBILE_NETWORK_BAR_OFFSET_CLASS, NetworkStatusIndicator } from "./NetworkStatusIndicator";

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [branding, setBranding] = useState(() => getBrandingSettings());
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const { enabled: ticketingEnabled } = useTicketingEnabled();

  const session = getSession();
  const capabilities = session?.capabilities ?? [];
  const canManageRoles = capabilities.includes("roles.manage");
  // Any role that can reach the admin console — no longer just the literal "admin".
  const isAdmin =
    capabilities.includes("users.manage") ||
    capabilities.includes("roles.manage") ||
    capabilities.includes("departments.manage") ||
    capabilities.includes("services.manage") ||
    capabilities.includes("settings.manage") ||
    capabilities.includes("branding.manage");
  const isHod = session?.role === "hod";
  const canSeeDashboard = capabilities.includes("insights.view");
  const path = location.pathname;
  const isEmployeeKioskScreen = isUserFeedPath(path);
  const isStaffRoute =
    !isEmployeeKioskScreen &&
    (path.includes("staff") ||
    path.includes("dashboard") ||
    path.includes("management") ||
    path.includes("analytics") ||
    path.includes("ticket") ||
    path.includes("admin") ||
    path.startsWith("/insights") ||
    path.startsWith("/hod/"));
  const showHeaderActions = Boolean(session) && isStaffRoute;
  // The three analytics pages, in the admin shell (/admin…) or for staff, management and HODs (/insights…).
  const onDashboard = path === "/admin" || path === "/insights";
  const onFeedbackList = path.startsWith("/admin/feedback") || path.startsWith("/insights/feedback");
  const onReports = path === "/admin/reports" || path === "/insights/reports";

  const isAdminShell = isAdmin && path.startsWith("/admin");

  // The phone/tablet sidebar closes whenever the page changes.
  useEffect(() => {
    setNavOpen(false);
  }, [path]);

  useEffect(() => {
    applyBrandingTheme(branding);
  }, [branding]);

  useEffect(() => {
    void loadBrandingSettings();
    return onBrandingSettingsChange(() => {
      setBranding(getBrandingSettings());
    });
  }, []);

  const activePrimaryBackgroundStyle = {
    backgroundColor: branding.primaryColor,
    color: "#ffffff",
  };
  const appLogo = branding.logoDataUrl || feedbackLogo;

  const adminTabs = [
    { label: "Feedback", to: "/admin/feedback", active: onFeedbackList },
    { label: "Dashboard", to: "/admin", active: onDashboard },
    { label: "Reports", to: "/admin/reports", active: onReports },
    { label: "Users", to: "/admin/users", active: path === "/admin/users" },
    canManageRoles && { label: "Roles", to: "/admin/roles", active: path === "/admin/roles" },
    ticketingEnabled && {
      label: "Tickets",
      to: "/admin/tickets",
      active: path.startsWith("/admin/tickets"),
    },
    { label: "Bot Q&A", to: "/admin/bot-conversation", active: path === "/admin/bot-conversation" },
    { label: "Settings", to: "/admin/settings", active: path === "/admin/settings" },
  ].filter((tab): tab is { label: string; to: string; active: boolean } => Boolean(tab));

  const outlineButton = (active: boolean) =>
    `shrink-0 whitespace-nowrap px-4 py-2 rounded-lg border text-sm font-medium transition-all duration-200 ${
      active ? "border-primary text-primary bg-brand-50" : "border-gray-300 text-gray-700 hover:bg-gray-100"
    }`;
  const solidButton =
    "shrink-0 whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium text-white transition-all duration-200";

  const showSectionNav = !isEmployeeKioskScreen && showHeaderActions;

  // The same sections, with icons, for the phone/tablet sidebar.
  const navIcons: Record<string, LucideIcon> = {
    Dashboard: LayoutDashboard,
    Feedback: MessageSquareText,
    Reports: FileText,
    Departments: Building2,
    Services: Layers,
    Users,
    Roles: ShieldCheck,
    Tickets: Ticket,
    "Bot Q&A": Bot,
    Settings,
    "Employee View": ClipboardList,
    "Submit feedback": ClipboardList,
    "My queue": Inbox,
  };
  let drawerLinks: { label: string; to: string; active: boolean }[] = [];
  if (isAdminShell) {
    drawerLinks = adminTabs;
  } else if (isAdmin) {
    drawerLinks = [
      { label: "Dashboard", to: "/admin", active: false },
      { label: "Employee View", to: employeeRoutes.home, active: false },
    ];
  } else if (isHod) {
    drawerLinks = canSeeDashboard
      ? [
          { label: "Feedback", to: "/insights/feedback", active: onFeedbackList },
          { label: "Dashboard", to: "/insights", active: onDashboard },
          ...(ticketingEnabled ? [{ label: "My queue", to: "/dashboard", active: path === "/dashboard" }] : []),
        ]
      : [];
  } else {
    drawerLinks = [
      ...(canSeeDashboard
        ? [
            { label: "Feedback", to: "/insights/feedback", active: onFeedbackList },
            { label: "Dashboard", to: "/insights", active: onDashboard },
            { label: "Reports", to: "/insights/reports", active: onReports },
          ]
        : []),
      { label: "Submit feedback", to: employeeRoutes.home, active: false },
    ];
  }
  const hasDrawer = showSectionNav && drawerLinks.length > 0;
  const roleLabel: Record<string, string> = { superadmin: "Super admin", admin: "Admin", hod: "HOD", staff: "Staff" };

  let sectionNav: React.ReactNode = null;
  if (isAdminShell) {
    sectionNav = (
      <nav
        className="inline-flex flex-nowrap items-center gap-1 rounded-full border border-gray-200 bg-gray-100 p-1"
        role="tablist"
        aria-label="Admin sections"
      >
        {adminTabs.map((tab) => (
          <button
            key={tab.to}
            type="button"
            role="tab"
            aria-selected={tab.active}
            onClick={() => navigate(tab.to)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs sm:text-sm font-semibold transition-all ${
              tab.active ? "shadow-sm" : "text-gray-600 hover:bg-white/70 hover:text-gray-900"
            }`}
            style={tab.active ? activePrimaryBackgroundStyle : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    );
  } else if (isAdmin) {
    sectionNav = (
      <div className="flex flex-nowrap items-center gap-2">
        <button type="button" onClick={() => navigate("/admin")} className={solidButton} style={activePrimaryBackgroundStyle}>
          Dashboard
        </button>
        <button type="button" onClick={() => navigate(employeeRoutes.home)} className={outlineButton(false)}>
          Employee View
        </button>
      </div>
    );
  } else if (isHod) {
    sectionNav = canSeeDashboard ? (
      <div className="flex flex-nowrap items-center gap-2">
        <button
          type="button"
          onClick={() => navigate("/insights/feedback")}
          className={outlineButton(onFeedbackList)}
        >
          Feedback
        </button>
        <button type="button" onClick={() => navigate("/insights")} className={outlineButton(onDashboard)}>
          Dashboard
        </button>
        {ticketingEnabled ? (
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className={outlineButton(path === "/dashboard")}
          >
            My queue
          </button>
        ) : null}
      </div>
    ) : null;
  } else {
    sectionNav = (
      <div className="flex flex-nowrap items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(employeeRoutes.home)}
          className={solidButton}
          style={activePrimaryBackgroundStyle}
        >
          Submit feedback
        </button>
        {canSeeDashboard ? (
          <>
            <button
              type="button"
              onClick={() => navigate("/insights/feedback")}
              className={outlineButton(onFeedbackList)}
            >
              Feedback
            </button>
            <button type="button" onClick={() => navigate("/insights")} className={outlineButton(onDashboard)}>
              Dashboard
            </button>
            <button type="button" onClick={() => navigate("/insights/reports")} className={outlineButton(onReports)}>
              Reports
            </button>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen flex flex-col ${MOBILE_NETWORK_BAR_OFFSET_CLASS}`}
      style={{ backgroundColor: branding.pageBackgroundColor }}
    >
      {/* New pages open at the top; Back/Forward return to where you were. */}
      <ScrollRestoration />
      <NetworkStatusIndicator variant="mobile-fixed" />
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div
          aria-hidden="true"
          className="h-1 w-full"
          style={{
            background: `linear-gradient(90deg, ${branding.primaryColor} 0%, ${branding.primaryColor} 55%, ${branding.accentColor} 100%)`,
          }}
        />
        <div className="w-full max-w-[min(100%,1600px)] mx-auto px-3 sm:px-5 py-3 lg:py-4">
          {/*
            Brand, section nav and account actions share one wrapping row. Below 1536px (2xl) the
            section nav drops to its own full-width row and scrolls sideways if it still
            does not fit, so the header never pushes the page wider than the screen.
          */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
            <div className="order-1 flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
              {hasDrawer ? (
                <button
                  type="button"
                  onClick={() => setNavOpen(true)}
                  aria-label="Open menu"
                  aria-expanded={navOpen}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-gray-200 text-gray-700 transition hover:bg-gray-100 lg:hidden"
                >
                  <Menu size={20} />
                </button>
              ) : null}
              <img
                src={appLogo}
                alt={`${HOSPITAL.shortName} feedback system`}
                className="h-10 w-auto max-h-11 max-w-[min(140px,36vw)] shrink-0 object-contain sm:h-11 lg:h-12 lg:max-w-[180px]"
              />
              <div className="min-w-0">
                <h1 className="truncate text-base font-bold tracking-tight text-gray-900 sm:text-lg lg:text-xl">
                  <span className={showSectionNav ? "sm:hidden 2xl:inline" : "sm:hidden"}>
                    {HOSPITAL.shortName}
                  </span>
                  <span
                    className={showSectionNav ? "hidden sm:inline 2xl:hidden" : "hidden sm:inline"}
                  >
                    {HOSPITAL.name}
                  </span>
                </h1>
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8A6A10] sm:text-[11px]">
                  Employee Feedback System
                </p>
              </div>
            </div>
            {/* With the sidebar, password and logout live in it on phones and tablets. */}
            <div
              className={`order-2 shrink-0 items-center gap-2 2xl:order-3 ${hasDrawer ? "hidden lg:flex" : "flex"}`}
            >
              <NetworkStatusIndicator variant="inline" />
              {isHod && session ? (
                <button
                  type="button"
                  onClick={() => setChangePasswordOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-all duration-200 text-sm font-medium"
                >
                  <KeyRound className="h-4 w-4" />
                  <span className="hidden sm:inline">Change password</span>
                  <span className="sm:hidden">Password</span>
                </button>
              ) : null}
              {session ? (
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                  className="px-3 sm:px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-all duration-200 text-sm font-medium"
                >
                  Logout
                </button>
              ) : null}
            </div>
            {showSectionNav && sectionNav ? (
              <div
                className={`order-3 w-full min-w-0 2xl:order-2 2xl:w-auto ${hasDrawer ? "hidden lg:block" : ""}`}
              >
                <div className="overflow-x-auto [scrollbar-width:thin]">{sectionNav}</div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* Main Content — wider canvas so dashboards use horizontal space */}
      <main className="flex-1 w-full max-w-[min(100%,1600px)] mx-auto overflow-x-clip px-3 sm:px-5 py-6">
        {isEmployeeKioskScreen && <FeedbackOutboxStatus />}
        <Outlet />
      </main>

      {/* Phones and tablets: the section nav is a sidebar that slides in from the left. */}
      {hasDrawer ? (
        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent
            side="left"
            className="w-[280px] max-w-[85vw] gap-0 bg-white p-0 lg:hidden"
          >
            <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-4 pr-12">
              <img src={appLogo} alt="" className="h-10 w-auto max-w-[72px] shrink-0 object-contain" />
              <div className="min-w-0">
                <SheetTitle className="truncate text-base font-bold tracking-tight text-gray-900">
                  {HOSPITAL.shortName}
                </SheetTitle>
                <SheetDescription className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8A6A10]">
                  Employee Feedback System
                </SheetDescription>
              </div>
            </div>
            <nav aria-label="Sections" className="flex-1 overflow-y-auto p-3">
              <ul className="space-y-1">
                {drawerLinks.map(({ label, to, active }) => {
                  const Icon = navIcons[label] ?? LayoutDashboard;
                  return (
                    <li key={to}>
                      <button
                        type="button"
                        onClick={() => {
                          setNavOpen(false);
                          navigate(to);
                        }}
                        aria-current={active ? "page" : undefined}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors ${
                          active ? "shadow-sm" : "text-gray-700 hover:bg-gray-100"
                        }`}
                        style={active ? activePrimaryBackgroundStyle : undefined}
                      >
                        <Icon size={18} className={active ? "" : "text-gray-500"} />
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            {session ? (
              <div className="space-y-1 border-t border-gray-100 p-3">
                <p className="px-3 pb-1 text-xs text-gray-500">
                  Signed in as <span className="font-semibold text-gray-800">{session.username}</span>
                  {roleLabel[session.role] ? ` · ${roleLabel[session.role]}` : ""}
                </p>
                {isHod ? (
                  <button
                    type="button"
                    onClick={() => {
                      setNavOpen(false);
                      setChangePasswordOpen(true);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100"
                  >
                    <KeyRound size={18} className="text-gray-500" />
                    Change password
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setNavOpen(false);
                    logout();
                    navigate("/login");
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
                >
                  <LogOut size={18} />
                  Logout
                </button>
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
      ) : null}
      {isHod && session ? (
        <HodChangePasswordDialog
          open={changePasswordOpen}
          onOpenChange={setChangePasswordOpen}
          userId={session._id}
        />
      ) : null}
    </div>
  );
}

