import { HOSPITAL } from "./hospital.js";

/** Seed hospital departments . */
export const SEED_DEPARTMENTS = HOSPITAL.departments;

/** AI routing services — the same list `npm run seed` uses (src/hospital.js). */
export const SEED_ROUTING_SERVICES = HOSPITAL.services;

/** Builds mock feedback rows (department + service per row). */
export function buildSeedFeedback(departmentIds) {
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  const isoDaysAgo = (n) => daysAgo(n).slice(0, 10);

  return [
    {
      employeeName: "Meena R",
      employeeId: "EMP-2041",
      feedbackType: "new_joiner",
      dateOfJoining: isoDaysAgo(16),
      department: "Nursing Services",
      service: "Induction & Training",
      rating: 2,
      comments:
        "Q: Do you have the equipment and access needed to do your job?\nA: No — I still do not have a login for the ward software.\n\nQ: Red (Immediate blockers): List anything preventing you from being productive right now.\nA: No software login after two weeks.",
      status: "New",
      source: "employee",
      aiSentiment: "negative",
      aiUrgency: "high",
      aiSummary: "New joiner has no ward software access two weeks after joining.",
      ticketId: "TKT-FBK-2026-0043",
      feedbackIssues: [
        {
          department: "Nursing Services",
          recommendedService: "IT Support",
          issueSummary: "No software login after joining",
          suggestedAction: "Raise access request with IT today",
          ticketId: "TKT-FBK-2026-0043",
        },
      ],
      createdAt: daysAgo(1),
    },
    {
      employeeName: "Karthik S",
      employeeId: "EMP-2057",
      feedbackType: "new_joiner",
      dateOfJoining: isoDaysAgo(20),
      department: "Laboratory & Radiology",
      service: "Work Environment",
      rating: 5,
      comments: "Q: Do you feel welcomed and supported by your immediate colleagues?\nA: Yes — the team has been very helpful.",
      status: "New",
      source: "employee",
      aiSentiment: "positive",
      aiSummary: "Welcoming team; positive induction.",
      createdAt: daysAgo(3),
    },
    {
      employeeName: "Lakshmi P",
      employeeId: "EMP-1180",
      feedbackType: "relieving",
      dateOfJoining: isoDaysAgo(900),
      lastWorkingDay: isoDaysAgo(4),
      department: "Pharmacy",
      service: "Career Growth",
      rating: 2,
      comments:
        "Q: Which reason / factor from the list below made you leave the company?\nA: Career growth / promotion\n\nQ: What should have been changed so that you would have continued to work?\nA: A clear promotion path and recognition from the manager.",
      status: "In Progress",
      source: "employee",
      aiSentiment: "negative",
      aiUrgency: "medium",
      aiSummary: "Leaving over lack of promotion path and recognition.",
      ticketId: "TKT-FBK-2026-0042",
      createdAt: daysAgo(5),
    },
    {
      employeeName: "Arun V",
      employeeId: "EMP-0932",
      feedbackType: "relieving",
      dateOfJoining: isoDaysAgo(2100),
      lastWorkingDay: isoDaysAgo(10),
      department: "Administration",
      service: "Management & Supervision",
      rating: 4,
      comments: "Q: What do you like in the company?\nA: Supportive manager and stable working hours.",
      status: "Resolved",
      source: "employee",
      aiSentiment: "positive",
      aiSummary: "Left on good terms; praised manager and working hours.",
      createdAt: daysAgo(12),
    },
    {
      employeeName: "Divya M",
      employeeId: "EMP-1544",
      feedbackType: "general",
      department: "Housekeeping & Maintenance",
      service: "Facilities & Housing",
      rating: 2,
      comments: "The staff rest room on the second floor has no running water for several days.",
      status: "New",
      source: "employee",
      aiSentiment: "negative",
      aiUrgency: "medium",
      aiSummary: "Staff rest room without water for days.",
      createdAt: daysAgo(2),
    },
    {
      employeeName: "Suresh K",
      employeeId: "EMP-0711",
      feedbackType: "general",
      department: "Human Resources",
      service: "Salary & Benefits",
      rating: 4,
      comments: "Salary slips are now available on time. Thank you.",
      status: "Resolved",
      source: "employee",
      aiSentiment: "positive",
      aiSummary: "Appreciates on-time salary slips.",
      createdAt: daysAgo(20),
    },
  ].map((row) => ({
    ...row,
    updatedAt: row.createdAt,
    aiAnalyzedAt: row.aiSentiment ? row.createdAt : null,
    aiTopics: [],
    complaintSignature: `${String(row.department).toLowerCase()}|${String(row.service).toLowerCase()}|${String(row.comments).slice(0, 40).toLowerCase()}`,
  }));
}
