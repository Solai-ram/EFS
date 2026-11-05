import { createBrowserRouter, Navigate } from "react-router";
import { Layout } from "./components/Layout";
import { LoginPage } from "./components/LoginPage";
import {
  AdminGuard,
  RequireCapability,
  StaffGuard,
} from "./components/RouteGuards";

/**
 * Only the shell, the guards and the landing route are bundled eagerly. Every
 * screen below is fetched on first navigation, so a employee opening the kiosk no
 * longer downloads the admin console, the Recharts dashboards or the xlsx
 * exporter before anything renders.
 */

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      // Employees land on the welcome page; staff sign in at /admin (the admin guard shows the form).
      { index: true, element: <Navigate to="/welcome" replace /> },
      { path: "login", element: <Navigate to="/admin" replace /> },

      {
        path: "welcome",
        lazy: async () => ({ Component: (await import("./components/Welcome")).Welcome }),
      },
      {
        path: "feedback/give",
        lazy: async () => ({
          Component: (await import("./components/FeedbackForm")).FeedbackForm,
        }),
      },
      // The AI voice guide is only for new joiner and relieving feedback now (inside the form).
      { path: "feedback/bot", element: <Navigate to="/feedback/general" replace /> },
      { path: "feedback/review", element: <Navigate to="/feedback/give" replace /> },
      {
        path: "feedback",
        lazy: async () => ({
          Component: (await import("./components/FeedbackMode")).FeedbackMode,
        }),
      },
      {
        path: "feedback/general",
        lazy: async () => ({
          Component: (await import("./components/GeneralFeedbackMode")).GeneralFeedbackMode,
        }),
      },
      {
        path: "paper-upload",
        lazy: async () => ({
          Component: (await import("./components/PaperUpload")).PaperUpload,
        }),
      },
      {
        path: "thank-you",
        lazy: async () => ({ Component: (await import("./components/ThankYou")).ThankYou }),
      },
      { path: "feedback-mode", element: <Navigate to="/feedback" replace /> },
      { path: "feedback-form", element: <Navigate to="/feedback/give" replace /> },
      { path: "voice-feedback", element: <Navigate to="/feedback/give?mode=voice" replace /> },
      { path: "bot-feedback", element: <Navigate to="/feedback/bot" replace /> },

      { path: "userfeed", element: <Navigate to="/welcome" replace /> },
      { path: "userfeed/mode", element: <Navigate to="/feedback" replace /> },
      { path: "userfeed/give", element: <Navigate to="/feedback/give" replace /> },
      { path: "userfeed/bot", element: <Navigate to="/feedback/bot" replace /> },
      { path: "userfeed/paper", element: <Navigate to="/paper-upload" replace /> },
      { path: "userfeed/thank-you", element: <Navigate to="/thank-you" replace /> },

      {
        Component: StaffGuard,
        children: [
          // The old HOD / staff queue is gone: Admins work from the admin console.
          { path: "staff", element: <Navigate to="/admin" replace /> },
          { path: "dashboard", element: <Navigate to="/admin" replace /> },
          // HODs used to land here; the Dashboard now limits their data to their departments.
          { path: "hod/overview", element: <Navigate to="/insights" replace /> },
          {
            // Pathless layout route: gates the Dashboard, Feedback and Reports on insights.view.
            element: <RequireCapability anyOf={["insights.view"]} />,
            children: [
              {
                path: "insights",
                lazy: async () => {
                  const { DashboardPage } = await import("./components/dashboard/DashboardPage");
                  return { Component: () => <DashboardPage feedbackPath="/insights/feedback" /> };
                },
              },
              {
                path: "insights/feedback",
                lazy: async () => {
                  const { FeedbackListPage } = await import("./components/FeedbackListPage");
                  return { Component: () => <FeedbackListPage basePath="/insights/feedback" /> };
                },
              },
              {
                path: "insights/feedback/delete",
                lazy: async () => {
                  const { FeedbackListPage } = await import("./components/FeedbackListPage");
                  return { Component: () => <FeedbackListPage basePath="/insights/feedback" /> };
                },
              },
              {
                path: "insights/reports",
                lazy: async () => ({
                  Component: (await import("./components/insights/SummaryReportRoute")).SummaryReportRoute,
                }),
              },
              { path: "management", element: <Navigate to="/insights" replace /> },
              { path: "management/*", element: <Navigate to="/insights" replace /> },
            ],
          },
          { path: "analytics", element: <Navigate to="/insights" replace /> },
          {
            path: "workflow",
            lazy: async () => ({
              Component: (await import("./components/WorkflowDiagram")).WorkflowDiagram,
            }),
          },
        ],
      },
      {
        Component: AdminGuard,
        children: [
          { path: "admin/management-overview", element: <Navigate to="/admin" replace /> },
          { path: "admin/management-overview/*", element: <Navigate to="/admin" replace /> },
          { path: "admin/insights", element: <Navigate to="/admin" replace /> },
          { path: "admin/analytics", element: <Navigate to="/admin" replace /> },
          {
            path: "admin/feedback",
            lazy: async () => {
              const { FeedbackListPage } = await import("./components/FeedbackListPage");
              return { Component: () => <FeedbackListPage basePath="/admin/feedback" /> };
            },
          },
          {
            path: "admin/feedback/delete",
            lazy: async () => {
              const { FeedbackListPage } = await import("./components/FeedbackListPage");
              return { Component: () => <FeedbackListPage basePath="/admin/feedback" /> };
            },
          },
          {
            path: "admin/reports",
            lazy: async () => ({
              Component: (await import("./components/insights/SummaryReportRoute")).SummaryReportRoute,
            }),
          },
          {
            path: "admin/users",
            lazy: async () => ({
              Component: (await import("./components/AdminUsersPage")).AdminUsersPage,
            }),
          },
          {
            path: "admin/roles",
            lazy: async () => ({
              Component: (await import("./components/AdminRolesPage")).AdminRolesPage,
            }),
          },
          {
            path: "admin/audit",
            lazy: async () => ({
              Component: (await import("./components/AdminAuditLogPage")).AdminAuditLogPage,
            }),
          },
          { path: "admin/usercreation", element: <Navigate to="/admin/users" replace /> },
          { path: "usercreation", element: <Navigate to="/admin/users" replace /> },
          { path: "manage/access", element: <Navigate to="/admin/users" replace /> },
          { path: "admin/tickets", element: <Navigate to="/admin/feedback" replace /> },
          {
            path: "admin/settings",
            lazy: async () => ({
              Component: (await import("./components/AdminSettingsPage")).AdminSettingsPage,
            }),
          },
          {
            path: "admin/bot-conversation",
            lazy: async () => ({
              Component: (await import("./components/AdminBotConversationPage"))
                .AdminBotConversationPage,
            }),
          },
          {
            path: "admin",
            lazy: async () => {
                  const { DashboardPage } = await import("./components/dashboard/DashboardPage");
                  return { Component: () => <DashboardPage feedbackPath="/admin/feedback" /> };
                },
          },
          { path: "admin/delete", element: <Navigate to="/admin/feedback/delete" replace /> },
        ],
      },
    ],
  },
]);
