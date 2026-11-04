/**
 * Relieving letter wording. THIS IS A TEMPORARY DRAFT: replace the text below with the final letter.
 * Nothing else in the app needs to change.
 *
 * Placeholders (filled in from what the employee entered):
 *   {{name}}  {{employeeId}}  {{department}}  {{dateOfJoining}}  {{lastWorkingDay}}  {{date}}  {{hospital}}
 * {{date}} is the day the letter is viewed. Dates print like "10 November 2026".
 */
export const RELIEVING_LETTER_TEMPLATE = {
  /** Shown as a banner across the top of the letter and as a watermark. The letter is for viewing only. */
  draftNotice: "DRAFT, for viewing only. Please get the approved copy from HR.",
  /** The large word printed faintly across the page. */
  watermark: "DRAFT",
  /** Heading shown above the letter body. */
  title: "Relieving Letter",
  /** Small line under the hospital name in the letter head. */
  department: "Human Resources",
  /** The table of details under the address block: label and value. */
  details: [
    { label: "Employee ID", value: "{{employeeId}}" },
    { label: "Department", value: "{{department}}" },
    { label: "Date of joining", value: "{{dateOfJoining}}" },
    { label: "Last working day", value: "{{lastWorkingDay}}" },
  ],
  /** Opening line of the letter. */
  greeting: "Dear {{name}},",
  /** Body paragraphs, in order. */
  paragraphs: [
    "This is to certify that you were employed with {{hospital}} in the {{department}} department from {{dateOfJoining}} to {{lastWorkingDay}}.",
    "You are relieved from your duties with effect from the close of working hours on {{lastWorkingDay}}, on completion of your exit interview and the other relieving formalities.",
    "On behalf of the Management, we thank you for your valuable contribution and wish you every success in your future endeavours.",
  ],
  /** Closing and signature block, one line each. */
  closing: ["Yours sincerely,"],
  signature: ["Authorised Signatory", "Human Resources", "{{hospital}}"],
  /** Small print at the bottom of the page. */
  footerNote:
    "This draft is shown for viewing only after the exit interview. The approved and signed copy is issued by Human Resources.",
};
