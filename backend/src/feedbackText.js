/**
 * Employee comments and remarks are stored separately; AI uses the combined text.
 */
export function combineFeedbackTextForAi(employeeComments, staffRemarks) {
  const employee = String(employeeComments || "").trim();
  const remark = String(staffRemarks || "").trim();
  if (!remark) return employee;
  if (!employee) return `[Remark] ${remark}`;
  return `${employee}\n\n[Remark] ${remark}`;
}
