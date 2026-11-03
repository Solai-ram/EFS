import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  User,
  Building2,
  AlertCircle,
  Save,
  MessageSquare,
  CheckCircle,
  Mic,
} from "lucide-react";
import {
  assignFeedbackTicket,
  CrossDepartmentAssignmentError,
  deleteFeedback,
  getFeedbackById,
  getHospitalDepartments,
  getServices,
  getUsers,
  resolveUploadUrl,
  type FeedbackItem,
  type UserRow,
  updateFeedbackStatus,
} from "../lib/api";
import { BotConversationFeedbackSection } from "./BotConversationFeedbackSection";
import { VoiceAudioPlayer } from "./VoiceAudioPlayer";
import { displayOptionalLabel } from "../lib/fieldSanitize";
import {
  displaySentimentForItem,
  effectiveFeedbackMode,
  feedbackModeLabel,
} from "../lib/feedbackDisplay";
import { getSession } from "../lib/auth";
import {
  defaultHodForTicket,
  hodLabelForSelect,
  hodScopeForUser,
  sortHodAssignees,
  visibleToHod,
} from "../lib/hodRouting";
import { ticketDepartment, ticketService } from "../lib/ticketFilters";
import { feedbackTypeLabel } from "../lib/feedbackTypes";
import { QuestionnaireAnswersList } from "./QuestionnaireAnswersList";

function feedbackSourceLabel(source: string | undefined): string {
  if (source === "staff") return "Employee (collected at desk)";
  if (source === "ai") return "AI channel";
  return "Employee";
}

export function TicketDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [ticket, setTicket] = useState<FeedbackItem | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Awaited<ReturnType<typeof getHospitalDepartments>>>([]);
  const [services, setServices] = useState<Awaited<ReturnType<typeof getServices>>>([]);
  const assignSuggestDone = useRef<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [status, setStatus] = useState<FeedbackItem["status"]>("New");
  const [resolutionNote, setResolutionNote] = useState("");
  const [capaRootCause, setCapaRootCause] = useState("");
  const [capaCorrectiveAction, setCapaCorrectiveAction] = useState("");
  const [capaPreventiveAction, setCapaPreventiveAction] = useState("");
  const [capaTargetDate, setCapaTargetDate] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const session = getSession();
  const isAdmin = session?.role === "admin";
  const isHod = session?.role === "hod";
  const canUpdateStatus = isHod;
  const showDeleteAction = location.pathname.includes("/delete");
  // Decision-rail quick actions scroll+focus here rather than duplicating the
  // CAPA form -- Resolve still goes through the same required fields below.
  const resolveSectionRef = useRef<HTMLDivElement | null>(null);
  const resolutionNoteRef = useRef<HTMLTextAreaElement | null>(null);

  /** CAPA is mandatory to close a ticket — target date stays optional. */
  const isCapaComplete = Boolean(
    capaRootCause.trim() && capaCorrectiveAction.trim() && capaPreventiveAction.trim()
  );
  const capaChanged =
    capaRootCause.trim() !== (ticket?.capa?.rootCause || "").trim() ||
    capaCorrectiveAction.trim() !== (ticket?.capa?.correctiveAction || "").trim() ||
    capaPreventiveAction.trim() !== (ticket?.capa?.preventiveAction || "").trim() ||
    capaTargetDate.trim() !== (ticket?.capa?.targetDate || "").trim();

  useEffect(() => {
    if (!isAdmin) return;
    void Promise.all([getUsers(), getHospitalDepartments(), getServices()])
      .then(([userRows, deptRows, serviceRows]) => {
        setUsers(userRows.filter((u) => u.role === "hod"));
        setDepartments(deptRows);
        setServices(serviceRows);
      })
      .catch(() => {
        setUsers([]);
        setDepartments([]);
        setServices([]);
      });
  }, [isAdmin]);

  const canViewTicket = useMemo(() => {
    if (!isHod || !ticket || !session?._id) return true;
    return visibleToHod(ticket, session._id);
  }, [isHod, ticket, session?._id]);

  const hodUsers = users;

  const defaultHodId = useMemo(
    () => defaultHodForTicket(ticket, departments, services, hodUsers),
    [hodUsers, ticket, departments, services]
  );

  const hodAssignees = useMemo(
    () => sortHodAssignees(hodUsers, ticket, defaultHodId, departments, services),
    [hodUsers, ticket, defaultHodId, departments, services]
  );

  const currentAssigneeIsHod = useMemo(() => {
    if (!ticket?.assignedToUserId) return true;
    return hodUsers.some((h) => h._id === ticket.assignedToUserId);
  }, [ticket, hodUsers]);

  const defaultHodUser = useMemo(
    () => hodAssignees.find((u) => u._id === defaultHodId) ?? null,
    [hodAssignees, defaultHodId]
  );

  useEffect(() => {
    async function loadTicket() {
      if (!id) {
        setError("Missing ticket id");
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);
        const row = await getFeedbackById(id);
        setTicket(row);
        setStatus(row.status);
        setResolutionNote(row.resolutionNote || "");
        setCapaRootCause(row.capa?.rootCause || "");
        setCapaCorrectiveAction(row.capa?.correctiveAction || "");
        setCapaPreventiveAction(row.capa?.preventiveAction || "");
        setCapaTargetDate(row.capa?.targetDate || "");
        const assignedId = row.assignedToUserId || "";
        setAssigneeId(assignedId);
        assignSuggestDone.current = null;
      } catch {
        setError("Could not load ticket details.");
      } finally {
        setIsLoading(false);
      }
    }
    void loadTicket();
  }, [id]);

  useEffect(() => {
    if (!ticket || !isAdmin || ticket.assignedToUserId) return;
    if (assignSuggestDone.current === ticket._id) return;
    if (!defaultHodId) {
      assignSuggestDone.current = ticket._id;
      return;
    }
    setAssigneeId(defaultHodId);
    assignSuggestDone.current = ticket._id;
  }, [ticket, isAdmin, defaultHodId]);

  async function handleAssign(userId: string | null) {
    if (!ticket) return;
    try {
      setIsSaving(true);
      setError(null);
      let updated;
      try {
        updated = await assignFeedbackTicket(ticket._id, userId);
      } catch (err) {
        // The head does not own this ticket's department. That is allowed —
        // service complaints route this way — but it must be deliberate.
        if (err instanceof CrossDepartmentAssignmentError) {
          if (!window.confirm(err.message)) {
            return;
          }
          updated = await assignFeedbackTicket(ticket._id, userId, {
            confirmCrossDepartment: true,
          });
        } else {
          throw err;
        }
      }
      setTicket(updated);
      setAssigneeId(updated.assignedToUserId || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update assignment.");
    } finally {
      setIsSaving(false);
    }
  }

  /** One click, no CAPA -- the fast path off "New" for the 8,832 tickets that
   *  have never been touched. Resolving still requires the full CAPA form. */
  async function handleAcknowledge() {
    if (!ticket) return;
    try {
      setIsSaving(true);
      setError(null);
      const updated = await updateFeedbackStatus(ticket._id, "In Progress");
      setTicket(updated);
      setStatus(updated.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update status.");
    } finally {
      setIsSaving(false);
    }
  }

  function focusResolveSection() {
    setStatus("Resolved");
    resolveSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => resolutionNoteRef.current?.focus(), 350);
  }

  async function handleSave() {
    if (!ticket || !id) return;
    if (status === "Resolved" && !resolutionNote.trim()) {
      setError("Please add a resolution comment before marking this ticket Resolved.");
      return;
    }
    if (status === "Resolved" && !isCapaComplete) {
      setError("Please complete the CAPA (root cause, corrective and preventive action) before resolving.");
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      const updated = await updateFeedbackStatus(ticket._id, status, {
        ...(status === "Resolved"
          ? {
              resolutionNote: resolutionNote.trim(),
              capa: {
                rootCause: capaRootCause.trim(),
                correctiveAction: capaCorrectiveAction.trim(),
                preventiveAction: capaPreventiveAction.trim(),
                targetDate: capaTargetDate.trim(),
                writtenByUserId: session?._id ?? null,
                writtenByUsername: session?.username ?? "",
              },
            }
          : {}),
      });
      setTicket(updated);
      setResolutionNote(updated.resolutionNote || resolutionNote.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update ticket status.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!ticket) return;
    const confirmed = window.confirm(
      `Delete ticket ${ticket.ticketId || ticket._id}? This action cannot be undone.`
    );
    if (!confirmed) return;
    try {
      setError(null);
      await deleteFeedback(ticket._id);
      navigate(isAdmin ? "/admin/tickets/delete" : "/dashboard");
    } catch {
      setError("Could not delete ticket.");
    }
  }

  const createdAt = ticket ? new Date(ticket.createdAt) : null;
  const rowSentiment = ticket ? displaySentimentForItem(ticket) : null;
  const sentimentNegative = rowSentiment === "negative";
  const sentimentPositive = rowSentiment === "positive";
  const sentimentNeutral = rowSentiment === "neutral";
  const noAiSentiment = ticket && !ticket.aiSentiment;
  const fallbackAiSummary = ticket
    ? noAiSentiment
      ? "AI sentiment is not available yet. Review the comment text and employee rating, then follow your local escalation policy."
      : sentimentNegative
        ? "AI detected negative tone in the comments. Recommended: follow up with the employee and assign a department owner."
        : "Monitor trends and close the ticket once reviewed."
    : "";
  const aiSummary = ticket?.aiSummary?.trim() || fallbackAiSummary;

  const voiceAudioSrc = resolveUploadUrl(ticket?.voiceRecordingUrl ?? null);
  const [voiceAudioVisible, setVoiceAudioVisible] = useState(true);
  useEffect(() => {
    setVoiceAudioVisible(true);
  }, [ticket?._id, voiceAudioSrc]);
  const displayMode = ticket ? effectiveFeedbackMode(ticket) : "standard";
  const botAnswers = ticket?.botConversationAnswers ?? [];
  const hasBotConversation =
    (displayMode === "bot" || botAnswers.length > 0) && botAnswers.length > 0;
  const hasVoiceCapture = Boolean(voiceAudioSrc);
  const speechToTextText = ticket?.comments?.trim() || "";
  const botGroupNote =
    ticket?.isSplitChild && hasBotConversation
      ? "Full bot conversation for this employee (all questions). This ticket covers one service from that session."
      : ticket?.botVoiceSourceFeedbackId && hasBotConversation
        ? "Voice Q&A loaded from the linked bot submission for this employee."
        : null;

  const isAssignedToHod = Boolean(
    ticket?.assignedToUserId &&
      ticket?.assignedToUsername?.trim() &&
      (isAdmin ? currentAssigneeIsHod : true)
  );
  const assignedAtLabel = ticket?.assignedAt
    ? new Date(ticket.assignedAt).toLocaleString()
    : isAssignedToHod
      ? "Assigned"
      : "Pending";

  const timelineItems = useMemo(() => {
    if (!ticket) return [];
    return [
      {
        event: "Feedback Submitted",
        status: "completed" as const,
        time: createdAt?.toLocaleString() || "-",
      },
      {
        event: "Ticket Created",
        status: "completed" as const,
        time: createdAt?.toLocaleString() || "-",
      },
      {
        event: isAssignedToHod
          ? `Assigned to HOD · ${ticket.assignedToUsername?.trim()}`
          : "Assigned to HOD",
        status: isAssignedToHod ? ("completed" as const) : ("pending" as const),
        time: isAssignedToHod
          ? assignedAtLabel
          : !currentAssigneeIsHod && ticket.assignedToUserId
            ? "Invalid assignee — reassign to HOD"
            : "Pending",
      },
      {
        event: "In Progress",
        status:
          ticket.status === "In Progress" || ticket.status === "Resolved"
            ? ("completed" as const)
            : ("pending" as const),
        time:
          ticket.status === "In Progress" || ticket.status === "Resolved"
            ? "Updated"
            : "Pending",
      },
      {
        event: "Resolved",
        status: ticket.status === "Resolved" ? ("completed" as const) : ("pending" as const),
        time: ticket.status === "Resolved" ? "Updated" : "Pending",
      },
    ];
  }, [ticket, createdAt, isAssignedToHod, assignedAtLabel, currentAssigneeIsHod]);

  const daysOpen = createdAt
    ? Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000))
    : null;
  const isHighUrgency = ticket?.aiUrgency === "high";

  const assignButtonLabel = !assigneeId
    ? ticket?.assignedToUserId
      ? "Unassign"
      : "Unassigned"
    : !ticket?.assignedToUserId
      ? "Assign"
      : assigneeId !== ticket.assignedToUserId
        ? "Reassign to HOD"
        : "Current HOD";

  return (
    <div className="max-w-5xl mx-auto">
      {/* Back Button */}
      <button
        onClick={() => navigate(isAdmin ? "/admin/tickets" : "/dashboard")}
        className="flex items-center gap-2 text-gray-600 hover:text-brand-600 mb-6 text-lg"
      >
        <ArrowLeft size={20} />
        {isAdmin ? "Back to Ticket Management" : "Back to Dashboard"}
      </button>

      {isLoading ? (
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm text-gray-600">
          Loading ticket details...
        </div>
      ) : error ? (
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm text-red-600">
          {error}
        </div>
      ) : !ticket ? (
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm text-gray-600">
          Ticket not found.
        </div>
      ) : !canViewTicket ? (
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm text-red-600">
          You do not have access to this ticket. It has not been assigned to you.
        </div>
      ) : (
        <>

      {/* Header */}
      <div className="bg-white rounded-xl p-6 mb-6 border border-gray-200 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-3xl font-semibold text-gray-800 mb-2">
              Ticket {ticket.ticketId || ticket._id}
            </h2>
            <div className="flex flex-wrap gap-3">
              <span
                className={`px-4 py-2 rounded-full text-sm font-bold text-white ${
                  sentimentNegative
                    ? "bg-[#E5533D]"
                    : sentimentPositive
                      ? "bg-[#2FBF71]"
                      : sentimentNeutral
                        ? "bg-[#F4A261]"
                        : "bg-gray-500"
                }`}
              >
                {rowSentiment ? `AI sentiment: ${rowSentiment}` : "AI sentiment: pending"}
              </span>
              <span className="px-4 py-2 rounded-full text-sm font-bold bg-[#A39A91] text-white">
                Rating: {ticket.rating}/5
              </span>
              {(ticket.rating ?? 0) <= 2 && (
                <span className="px-4 py-2 rounded-full text-sm font-bold bg-[#E5533D] text-white">
                  Low satisfaction score
                </span>
              )}
            </div>
          </div>
          <div className="text-right text-sm text-gray-600">
            <p>{createdAt?.toLocaleDateString()}</p>
            <p>{createdAt?.toLocaleTimeString()}</p>
          </div>
        </div>
      </div>

      {/* Decision rail -- status, assignment and the three actions in one
          glance, pinned above the two-column detail so reaching them never
          requires scrolling past the read-only sections below. */}
      <div
        className={`rounded-xl p-4 sm:p-5 mb-6 border shadow-sm flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${
          isHighUrgency
            ? "bg-red-50 border-red-200"
            : sentimentNegative
              ? "bg-amber-50 border-amber-200"
              : "bg-white border-gray-200"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {isHighUrgency ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-600 text-white">
              <AlertCircle size={12} /> High urgency
            </span>
          ) : null}
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
              ticket.status === "Resolved"
                ? "bg-emerald-100 text-emerald-800"
                : ticket.status === "In Progress"
                  ? "bg-blue-100 text-blue-800"
                  : "bg-gray-100 text-gray-700"
            }`}
          >
            {ticket.status}
          </span>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
              isAssignedToHod ? "bg-gray-100 text-gray-700" : "bg-amber-100 text-amber-800"
            }`}
          >
            {isAssignedToHod ? `Assigned · ${ticket.assignedToUsername}` : "Unassigned"}
          </span>
          {daysOpen !== null ? (
            <span className="text-xs text-gray-500">
              {daysOpen === 0 ? "Opened today" : `${daysOpen} day${daysOpen === 1 ? "" : "s"} open`}
            </span>
          ) : null}
        </div>

        {isAdmin || isHod ? (
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && !ticket.assignedToUserId && defaultHodUser ? (
              <button
                type="button"
                onClick={() => void handleAssign(defaultHodUser._id)}
                disabled={isSaving}
                className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-primary text-white disabled:opacity-50"
              >
                Assign to {defaultHodUser.username}
              </button>
            ) : null}
            {isHod && ticket.status === "New" ? (
              <button
                type="button"
                onClick={() => void handleAcknowledge()}
                disabled={isSaving}
                className="px-3.5 py-2 rounded-lg text-sm font-semibold border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Acknowledge
              </button>
            ) : null}
            {isHod && ticket.status !== "Resolved" ? (
              <button
                type="button"
                onClick={focusResolveSection}
                className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-[#2FBF71] text-white"
              >
                Resolve
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Employee Info & Feedback */}
        <div className="lg:col-span-2 space-y-6">
          {/* Employee Information */}
          <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <User size={24} className="text-brand-600" />
              Employee Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600 mb-1">Name</p>
                <p className="text-base font-semibold text-gray-800">{ticket.employeeName}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Source</p>
                <p className="text-base font-semibold text-gray-800">
                  {feedbackSourceLabel(ticket.source)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Submitted via</p>
                <p className="text-base font-semibold text-gray-800">{feedbackModeLabel[displayMode]}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Employee ID</p>
                <p className="text-base font-semibold text-gray-800">{ticket.employeeId?.trim() || "—"}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Feedback type</p>
                <p className="text-base font-semibold text-gray-800">
                  {feedbackTypeLabel(ticket.feedbackType)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Department</p>
                <p className="text-base font-semibold text-gray-800">
                  {displayOptionalLabel(ticket.department)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600 mb-1">Recommended service</p>
                <p className="text-base font-semibold text-gray-800">
                  {displayOptionalLabel(ticket.service)}
                </p>
              </div>
              {ticket.suggestedAction?.trim() ? (
                <div className="col-span-2">
                  <p className="text-sm text-gray-600 mb-1">Suggested action</p>
                  <p className="text-base font-semibold text-gray-800">{ticket.suggestedAction}</p>
                </div>
              ) : null}
              <div>
                <p className="text-sm text-gray-600 mb-1">Date of joining</p>
                <p className="text-base font-semibold text-gray-800">{ticket.dateOfJoining?.trim() || "—"}</p>
              </div>
              {ticket.lastWorkingDay?.trim() ? (
                <div>
                  <p className="text-sm text-gray-600 mb-1">Last working day</p>
                  <p className="text-base font-semibold text-gray-800">{ticket.lastWorkingDay}</p>
                </div>
              ) : null}
              <div>
                <p className="text-sm text-gray-600 mb-1">Current Status</p>
                <p className="text-base font-semibold text-gray-800">{ticket.status}</p>
              </div>
            </div>
          </div>

          {/* AI Analysis (OpenRouter when configured on API) */}
          <div className="bg-gradient-to-r from-purple-50 to-brand-50 rounded-xl p-6 border-2 border-primary shadow-sm">
            <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <AlertCircle size={24} className="text-primary" />
              AI Sentiment Analysis
            </h3>
            {(ticket.aiSentiment || ticket.aiUrgency) && (
              <div className="flex flex-wrap gap-2 mb-4">
                {rowSentiment && (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-white border border-primary text-primary capitalize">
                    {rowSentiment}
                  </span>
                )}
                {ticket.aiUrgency && (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-white border border-[#F4A261] text-[#92400e] capitalize">
                    Urgency: {ticket.aiUrgency}
                  </span>
                )}
              </div>
            )}
            <p className="text-gray-700 leading-relaxed font-medium">{aiSummary}</p>
            {ticket.aiTopics && ticket.aiTopics.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {ticket.aiTopics.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-1 rounded-md text-xs bg-white/80 border border-gray-200 text-gray-700"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Feedback — speech-to-text + voice audio */}
          <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <MessageSquare size={24} className="text-green-600" />
              Employee Feedback
            </h3>

            {ticket.answers?.length ? (
              <QuestionnaireAnswersList answers={ticket.answers} />
            ) : hasBotConversation ? (
              <BotConversationFeedbackSection
                answers={botAnswers}
                combinedSessionUrl={ticket.voiceRecordingUrl}
                fullTranscript={speechToTextText}
                groupNote={botGroupNote}
              />
            ) : (
              <div className="space-y-5">
                {(displayMode === "voice" || speechToTextText) && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                      Speech-to-text {displayMode === "voice" ? "(Sarvam — converted from voice)" : ""}
                    </p>
                    <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {speechToTextText || "No transcript stored."}
                    </p>
                  </div>
                )}

                {hasVoiceCapture && voiceAudioVisible ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                      <Mic size={14} />
                      Voice audio (what the employee spoke)
                    </p>
                    <VoiceAudioPlayer
                      src={voiceAudioSrc!}
                      onUnavailable={() => setVoiceAudioVisible(false)}
                    />
                  </div>
                ) : null}

                {!speechToTextText && !hasVoiceCapture ? (
                  <p className="text-gray-700 leading-relaxed">No comment provided.</p>
                ) : null}
              </div>
            )}

          </div>

          {ticket.staffRemarks?.trim() ? (
            <div className="bg-amber-50 rounded-xl p-6 border border-amber-200 shadow-sm">
              <h3 className="text-lg font-semibold text-amber-900 mb-2">Staff remarks</h3>
              <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{ticket.staffRemarks.trim()}</p>
            </div>
          ) : null}

          {ticket.resolutionNote?.trim() ? (
            <div className="bg-emerald-50 rounded-xl p-6 border border-emerald-200 shadow-sm">
              <h3 className="text-lg font-semibold text-emerald-900 mb-2">HOD resolution comment</h3>
              <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                {ticket.resolutionNote.trim()}
              </p>
              {ticket.resolutionNoteAt ? (
                <p className="text-xs text-emerald-800/80 mt-2">
                  Saved {new Date(ticket.resolutionNoteAt).toLocaleString()}
                  {ticket.assignedToUsername?.trim()
                    ? ` · ${ticket.assignedToUsername.trim()}`
                    : ""}
                </p>
              ) : null}
            </div>
          ) : null}

          {ticket.capa?.writtenAt ? (
            <div className="bg-violet-50 rounded-xl p-6 border border-violet-200 shadow-sm">
              <h3 className="text-lg font-semibold text-violet-900 mb-3">
                CAPA — corrective &amp; preventive action
              </h3>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-violet-800/70">
                    Root cause
                  </dt>
                  <dd className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                    {ticket.capa.rootCause || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-violet-800/70">
                    Corrective action
                  </dt>
                  <dd className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                    {ticket.capa.correctiveAction || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-violet-800/70">
                    Preventive action
                  </dt>
                  <dd className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                    {ticket.capa.preventiveAction || "—"}
                  </dd>
                </div>
                {ticket.capa.targetDate ? (
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wider text-violet-800/70">
                      Target completion
                    </dt>
                    <dd className="text-gray-800">{ticket.capa.targetDate}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="text-xs text-violet-800/80 mt-3">
                Written by {ticket.capa.writtenByUsername || "unknown"} on{" "}
                {new Date(ticket.capa.writtenAt).toLocaleString()}
              </p>
            </div>
          ) : null}

          {ticket.feedbackIssues && ticket.feedbackIssues.length > 0 && (
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
              <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Building2 size={24} className="text-brand-600" />
                Categorized issues
                {ticket.feedbackIssues.length > 1 ? (
                  <span className="text-sm font-normal text-gray-500">
                    ({ticket.feedbackIssues.length} departments / services)
                  </span>
                ) : null}
              </h3>
              <div className="space-y-4">
                {ticket.feedbackIssues.map((issue, idx) => (
                  <div
                    key={`${issue.department}-${issue.recommendedService}-${idx}`}
                    className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-gray-500 mb-0.5">Department</p>
                        <p className="font-semibold text-gray-800">
                          {displayOptionalLabel(issue.department)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500 mb-0.5">Recommended service</p>
                        <p className="font-semibold text-gray-800">
                          {displayOptionalLabel(issue.recommendedService)}
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-gray-500 mb-0.5">Issue summary</p>
                        <p className="text-gray-800">{issue.issueSummary || "—"}</p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-gray-500 mb-0.5">Suggested action</p>
                        <p className="text-gray-800">{issue.suggestedAction || "—"}</p>
                      </div>
                      {issue.ticketId ? (
                        <div>
                          <p className="text-gray-500 mb-0.5">Ticket</p>
                          <p className="font-mono font-semibold text-gray-800">{issue.ticketId}</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* Right Column - Actions */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            {isAdmin ? (
              <>
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Assign to HOD</h3>
                {!ticket.assignedToUserId && defaultHodUser ? (
                  <p className="text-xs text-emerald-700 mb-3">
                    Recommended HOD
                    {ticketDepartment(ticket) ? ` for ${ticketDepartment(ticket)}` : ""}
                    {ticketService(ticket) ? ` / ${ticketService(ticket)}` : ""}:{" "}
                    <span className="font-semibold">{defaultHodUser.username}</span>
                    {" — "}pre-selected below. Click Assign to confirm.
                  </p>
                ) : !ticket.assignedToUserId && (ticketDepartment(ticket) || ticketService(ticket)) ? (
                  <p className="text-xs text-amber-700 mb-3">
                    No mapped HOD for{" "}
                    <span className="font-semibold">
                      {[ticketDepartment(ticket), ticketService(ticket)].filter(Boolean).join(" / ")}
                    </span>
                    . Map one in Admin → Users (or Departments/Services), or pick any HOD below.
                  </p>
                ) : null}
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {ticket.assignedToUserId ? "Reassign to another HOD" : "Select HOD"}
                </label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none mb-3"
                >
                  <option value="">Unassigned</option>
                  {hodAssignees.map((u) => (
                    <option key={u._id} value={u._id}>
                      {hodLabelForSelect(u)}
                      {u._id === defaultHodId ? " · Recommended" : ""}
                    </option>
                  ))}
                </select>
                {hodAssignees.length === 0 ? (
                  <p className="text-xs text-amber-700 mb-3">
                    No HOD users yet. Create one under Admin → Users.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleAssign(assigneeId || null)}
                  disabled={isSaving || assigneeId === (ticket.assignedToUserId || "")}
                  className="w-full bg-primary text-white py-2.5 rounded-lg font-semibold text-sm disabled:opacity-50"
                >
                  {isSaving ? "Saving…" : assignButtonLabel}
                </button>
              </>
            ) : null}

            <div className={isAdmin ? "mt-6 pt-6 border-t border-gray-100" : ""}>
              <h3 className="text-lg font-bold text-gray-800 mb-4">Timeline</h3>
              <div className="space-y-4">
                {timelineItems.map((item, index) => (
                  <div key={index} className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                        item.status === "completed" ? "bg-[#2FBF71]" : "bg-gray-300"
                      }`}
                    >
                      {item.status === "completed" ? (
                        <CheckCircle size={18} className="text-white" />
                      ) : (
                        <div className="w-2.5 h-2.5 bg-white rounded-full" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`font-semibold text-sm ${
                          item.status === "completed" ? "text-gray-800" : "text-gray-400"
                        }`}
                      >
                        {item.event}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isAdmin && showDeleteAction && (
            <div className="bg-white rounded-xl p-6 border border-red-200 shadow-sm">
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="w-full px-4 py-3 bg-red-700 text-white rounded-lg hover:bg-red-800 transition-colors text-sm font-bold"
              >
                Delete Ticket
              </button>
            </div>
          )}

          {canUpdateStatus && (
          <div ref={resolveSectionRef} className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Update Status</h3>
            {isHod ? (
              <p className="text-sm text-gray-600 mb-4">
                Update progress after you review this ticket. Resolving requires a comment for admin.
              </p>
            ) : null}
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as FeedbackItem["status"])}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none mb-4"
            >
              <option value="New">New</option>
              <option value="In Progress">In Progress</option>
              <option value="Resolved">Resolved</option>
            </select>

            {status === "Resolved" ? (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Resolution comment <span className="text-red-600">*</span>
                </label>
                <textarea
                  ref={resolutionNoteRef}
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  rows={4}
                  required
                  placeholder="Describe what was done / how this was resolved…"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none resize-y"
                />
                <p className="text-xs text-gray-500 mt-1">This comment is visible to admin.</p>
              </div>
            ) : null}

            {status === "Resolved" ? (
              <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
                <h4 className="text-sm font-semibold text-violet-900">
                  CAPA <span className="text-red-600">*</span>
                </h4>
                <p className="text-xs text-violet-800/80 mt-0.5 mb-3">
                  Corrective and preventive action. Required to close the ticket and reported on
                  the management dashboard.
                </p>

                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Root cause <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      value={capaRootCause}
                      onChange={(e) => setCapaRootCause(e.target.value)}
                      rows={2}
                      required
                      placeholder="Why did this happen?"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-200 outline-none resize-y"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Corrective action <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      value={capaCorrectiveAction}
                      onChange={(e) => setCapaCorrectiveAction(e.target.value)}
                      rows={2}
                      required
                      placeholder="What was done to fix this specific issue?"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-200 outline-none resize-y"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Preventive action <span className="text-red-600">*</span>
                    </label>
                    <textarea
                      value={capaPreventiveAction}
                      onChange={(e) => setCapaPreventiveAction(e.target.value)}
                      rows={2}
                      required
                      placeholder="What will stop it from happening again?"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-200 outline-none resize-y"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Target completion date
                    </label>
                    <input
                      type="date"
                      value={capaTargetDate}
                      onChange={(e) => setCapaTargetDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-200 outline-none"
                    />
                    <p className="text-xs text-gray-500 mt-1">Optional.</p>
                  </div>
                </div>

                {ticket.capa?.writtenAt ? (
                  <p className="text-xs text-violet-800 mt-3">
                    CAPA recorded by {ticket.capa.writtenByUsername || "unknown"} on{" "}
                    {new Date(ticket.capa.writtenAt).toLocaleString()}.
                  </p>
                ) : null}
              </div>
            ) : null}

            <button
              onClick={handleSave}
              disabled={
                isSaving ||
                (status === ticket.status &&
                  (status !== "Resolved" ||
                    (resolutionNote.trim() === (ticket.resolutionNote || "").trim() &&
                      !capaChanged))) ||
                (status === "Resolved" && (!resolutionNote.trim() || !isCapaComplete))
              }
              className="w-full bg-[#2FBF71] text-white py-3 rounded-lg font-bold shadow-lg hover:bg-[#28a962] hover:shadow-xl hover:scale-[1.02] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:hover:scale-100"
            >
              <Save size={20} />
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
          )}

        </div>
      </div>
      </>
      )}
    </div>
  );
}
