import { useCallback, useEffect, useState } from "react";
import {
  getHospitalDepartments,
  type Department,
  type FeedbackPayload,
  type FeedbackType,
} from "./api";

export type EmployeeIdentitySubmitFields = Pick<
  FeedbackPayload,
  "employeeName" | "employeeId" | "department" | "dateOfJoining" | "lastWorkingDay" | "feedbackType"
>;

function todayIso(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Who is giving feedback. Every type asks for name, employee ID and department;
 * new joiners and relievers also give their date of joining, and relievers their
 * last working day. For general feedback the date of joining is optional.
 */
export function useEmployeeIdentity(feedbackType: FeedbackType = "general") {
  const [employeeName, setEmployeeName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [lastWorkingDay, setLastWorkingDay] = useState("");
  const [hospitalDepartments, setHospitalDepartments] = useState<Department[]>([]);

  // General feedback only needs a department; name and employee ID are optional.
  const nameRequired = feedbackType !== "general";
  const idRequired = feedbackType !== "general";
  const joiningDateRequired = feedbackType !== "general";
  const lastWorkingDayRequired = feedbackType === "relieving";

  useEffect(() => {
    let cancelled = false;
    void getHospitalDepartments()
      .then((rows) => {
        if (!cancelled) setHospitalDepartments(rows);
      })
      .catch(() => {
        if (!cancelled) setHospitalDepartments([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resolvedEmployeeName = employeeName.trim();
  const nameReady = !nameRequired || Boolean(resolvedEmployeeName);
  const idReady = !idRequired || Boolean(employeeId.trim());
  const departmentReady = Boolean(department.trim());
  const joiningDateReady = !joiningDateRequired || Boolean(dateOfJoining);
  const lastWorkingDayReady = !lastWorkingDayRequired || Boolean(lastWorkingDay);

  const identityReady =
    nameReady && idReady && departmentReady && joiningDateReady && lastWorkingDayReady;

  const validateForSubmit = useCallback((): string | null => {
    if (nameRequired && !employeeName.trim()) return "Please enter your name.";
    if (idRequired && !employeeId.trim()) return "Please enter your employee ID.";
    if (!department.trim()) return "Please select your department.";
    if (joiningDateRequired && !dateOfJoining) return "Please enter your date of joining.";
    if (dateOfJoining && dateOfJoining > todayIso()) {
      return "Date of joining cannot be in the future.";
    }
    if (lastWorkingDayRequired) {
      if (!lastWorkingDay) return "Please enter your last working day.";
      if (dateOfJoining && lastWorkingDay < dateOfJoining) {
        return "Last working day cannot be before your date of joining.";
      }
    }
    return null;
  }, [
    dateOfJoining,
    department,
    employeeId,
    employeeName,
    idRequired,
    joiningDateRequired,
    lastWorkingDay,
    lastWorkingDayRequired,
    nameRequired,
  ]);

  const getSubmitFields = useCallback(
    (): EmployeeIdentitySubmitFields => ({
      employeeName: employeeName.trim(),
      employeeId: employeeId.trim(),
      department: department.trim() || undefined,
      feedbackType,
      dateOfJoining: dateOfJoining || undefined,
      lastWorkingDay: lastWorkingDayRequired ? lastWorkingDay || undefined : undefined,
    }),
    [
      dateOfJoining,
      department,
      employeeId,
      employeeName,
      feedbackType,
      lastWorkingDay,
      lastWorkingDayRequired,
    ]
  );

  const reset = useCallback(() => {
    setEmployeeName("");
    setEmployeeId("");
    setDepartment("");
    setDateOfJoining("");
    setLastWorkingDay("");
  }, []);

  return {
    feedbackType,
    employeeName,
    setEmployeeName,
    employeeId,
    setEmployeeId,
    department,
    setDepartment,
    dateOfJoining,
    setDateOfJoining,
    lastWorkingDay,
    setLastWorkingDay,
    hospitalDepartments,
    nameRequired,
    idRequired,
    joiningDateRequired,
    lastWorkingDayRequired,
    resolvedEmployeeName,
    nameReady,
    idReady,
    departmentReady,
    identityReady,
    validateForSubmit,
    getSubmitFields,
    reset,
  };
}

export type EmployeeIdentityState = ReturnType<typeof useEmployeeIdentity>;
