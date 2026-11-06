import type { FocusEvent } from "react";
import { DepartmentSearchSelect } from "./DepartmentSearchSelect";
import type { EmployeeIdentityState } from "../lib/useEmployeeIdentity";

type EmployeeIdentitySectionProps = {
  identity: EmployeeIdentityState;
  primaryColor: string;
  compact?: boolean;
};

function todayIso(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Name, employee ID, department and dates — asked on every feedback type. */
export function EmployeeIdentitySection({
  identity,
  primaryColor,
  compact = false,
}: EmployeeIdentitySectionProps) {
  const inputClass =
    "w-full h-12 px-4 text-base text-gray-900 bg-white border border-gray-300 rounded-xl outline-none transition placeholder:text-gray-400 hover:border-gray-400";
  const fieldLabel = "mb-1.5 block text-sm font-medium text-gray-700";
  const required = (
    <span className="font-normal text-red-600" aria-hidden="true">
      {" "}
      *
    </span>
  );

  const focusHandlers = {
    onFocus: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.currentTarget.style.borderColor = primaryColor;
      e.currentTarget.style.boxShadow = `0 0 0 4px ${primaryColor}1A`;
    },
    onBlur: (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.currentTarget.style.borderColor = "";
      e.currentTarget.style.boxShadow = "none";
    },
  };

  const today = todayIso();

  return (
    <div className={compact ? "space-y-4" : "mb-4"}>
      <div className={compact ? "space-y-4" : "grid grid-cols-1 gap-4 md:grid-cols-2"}>
        <div>
          <label className={fieldLabel} htmlFor="efs-employee-name">
            {compact ? "Your name · உங்கள் பெயர்" : "Name"}
            {identity.nameRequired ? required : null}
          </label>
          <input
            id="efs-employee-name"
            type="text"
            autoComplete="name"
            maxLength={200}
            value={identity.employeeName}
            onChange={(e) => identity.setEmployeeName(e.target.value)}
            placeholder="Full name"
            className={inputClass}
            {...focusHandlers}
          />
        </div>

        <div>
          <label className={fieldLabel} htmlFor="efs-employee-id">
            Employee ID
            {identity.idRequired ? required : null}
          </label>
          <input
            id="efs-employee-id"
            type="text"
            autoComplete="off"
            maxLength={40}
            value={identity.employeeId}
            onChange={(e) => identity.setEmployeeId(e.target.value)}
            placeholder="e.g. EMP-1024"
            className={inputClass}
            {...focusHandlers}
          />
        </div>

        <div>
          <label className={fieldLabel}>
            Department
            {required}
          </label>
          {identity.hospitalDepartments.length > 0 ? (
            <DepartmentSearchSelect
              departments={identity.hospitalDepartments}
              value={identity.department}
              onChange={identity.setDepartment}
              placeholder="Select department"
            />
          ) : (
            <input
              type="text"
              value={identity.department}
              onChange={(e) => identity.setDepartment(e.target.value)}
              placeholder="Department"
              className={inputClass}
              {...focusHandlers}
            />
          )}
        </div>

        {/* General feedback does not ask for a date of joining. */}
        {identity.joiningDateRequired ? (
        <div>
          <label className={fieldLabel} htmlFor="efs-date-of-joining">
            Date of joining
            {required}
          </label>
          <input
            id="efs-date-of-joining"
            type="date"
            max={today}
            value={identity.dateOfJoining}
            onChange={(e) => identity.setDateOfJoining(e.target.value)}
            className={inputClass}
            {...focusHandlers}
          />
        </div>
        ) : null}

        {identity.lastWorkingDayRequired ? (
          <div>
            <label className={fieldLabel} htmlFor="efs-last-working-day">
              Last working day
              {required}
            </label>
            <input
              id="efs-last-working-day"
              type="date"
              min={identity.dateOfJoining || undefined}
              value={identity.lastWorkingDay}
              onChange={(e) => identity.setLastWorkingDay(e.target.value)}
              className={inputClass}
              {...focusHandlers}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
