/**
 * Hospital identity for this deployment. Change these values to deploy for another hospital.
 * Keep in sync with frontend/src/app/lib/hospital.ts.
 */
export const HOSPITAL = {
  name: "Adhiparasakthi Hospitals",
  shortName: "APH",
  /** Tamil name with the locative suffix ("at the hospital"), used in the bot greeting. */
  nameTaLocative: "ஆதிபராசக்தி மருத்துவமனைகளில்",
  /** Default brand colours (admins can change them in Settings; "Reset" returns to these). */
  theme: {
    primaryColor: "#DC1A1F",
    accentColor: "#F7A014",
    pageBackgroundColor: "#FFF9F0",
  },
  /**
   * Departments seeded into a new database (`npm run seed`). Admins manage them afterwards.
   * Starter list only: edit it on the Departments screen to match the APH org chart.
   */
  departments: [
    { name: "General Medicine", description: "Medical wards and outpatient clinics" },
    { name: "General Surgery", description: "Surgical wards and operation theatres" },
    { name: "Obstetrics & Gynaecology", description: "Maternity and women's health" },
    { name: "Paediatrics", description: "Children's wards and clinics" },
    { name: "Emergency & Critical Care", description: "Casualty, ICU and emergency response" },
    { name: "Nursing Services", description: "Nursing staff across all wards" },
    { name: "Laboratory & Radiology", description: "Diagnostics and imaging" },
    { name: "Pharmacy", description: "Medicines and dispensing" },
    { name: "Administration", description: "Front office, records and general administration" },
    { name: "Human Resources", description: "Recruitment, payroll and employee welfare" },
    { name: "Housekeeping & Maintenance", description: "Cleaning, engineering and upkeep" },
    { name: "Academic & Training", description: "Teaching, induction and skill development" },
  ],
  /**
   * Employee-experience topics the AI routes each concern or compliment to (service analytics).
   * Seeded by `npm run seed` when missing; admins manage them on the Services screen.
   */
  services: [
    { name: "Induction & Training", description: "Orientation, mentoring and skill development" },
    { name: "Salary & Benefits", description: "Pay, allowances, incentives and statutory benefits" },
    { name: "Leave & Attendance", description: "Leave, shifts, rosters and attendance records" },
    { name: "Work Environment", description: "Team culture, workload and working conditions" },
    { name: "Management & Supervision", description: "Manager support, guidance and recognition" },
    { name: "Career Growth", description: "Promotion, transfers and learning opportunities" },
    { name: "Tools & Equipment", description: "Equipment, software access and supplies needed for the job" },
    { name: "Facilities & Housing", description: "Hostel, staff quarters, canteen and rest areas" },
    { name: "Transport", description: "Staff bus and commute" },
    { name: "Safety & Security", description: "Workplace safety, security and grievance handling" },
    { name: "IT Support", description: "Systems, logins and hospital software" },
  ],
};
