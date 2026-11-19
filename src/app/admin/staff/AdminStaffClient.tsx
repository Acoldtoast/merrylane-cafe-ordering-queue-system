"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { StaffFaceCamera } from "./StaffFaceCamera";
import { StaffFacePhotoPreview } from "./StaffFacePhotoPreview";
import { StaffExistingIdentity } from "./StaffExistingIdentity";
import { StaffFaceStatus } from "./StaffFaceStatus";
import { DutyTimePicker } from "./DutyTimePicker";
import {
  checkStaffIdBirthDate,
  checkStaffIdExpiration,
  checkStaffIdName,
  checkStaffIdNumber,
  isStaffIdentityScanVerified,
  staffIdRequiresExpirationDate,
} from "@/lib/staffIdChecks";
import { staffIdCheckLabel } from "@/lib/staffIdCheckLabels";
import { staffRegistrationDetailsReady } from "@/lib/staffRegistrationDetails";
import { useStaffIdDuplicateCheck } from "@/lib/useStaffIdDuplicateCheck";
import { Icon } from "@/components/Icons";
import { LoadingDots } from "@/components/LoadingDots";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { useFeedback } from "@/components/Feedback";
import { fetchPortalApi } from "@/lib/portalPrefetch";
import { usePolling } from "@/lib/usePolling";
import { clockTime, peso } from "@/lib/format";
import type { User } from "@/lib/types";
import {
  type AccountRole,
} from "@/lib/usernames";

type SensitiveAccountAction = "activate" | "deactivate" | "remove" | "reset-password";

type StaffDailyHistory = {
  attendance: {
    sessions: {
      id: number;
      login_at: string;
      logout_at: string | null;
      duty_minutes: number;
    }[];
    duty_minutes: number;
  };
  calendar: { date: string; sessions: number; duty_minutes: number }[];
  daySales: { amount: number; transactions: number };
  monthSummary: {
    duty_days: number;
    duty_minutes: number;
    staff_sales: number;
    staff_sales_transactions: number;
    cafe_sales: number;
    cafe_sales_transactions: number;
  };
  activity: {
    id: number;
    area: string;
    action: string;
    summary: string;
    created_at: string;
  }[];
  sales: { amount: number; transactions: number };
  onDutyToday: boolean;
};

type DutyHoursSelection = { start: string; end: string };

function todayInputDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function currentMonthInput(): string {
  return todayInputDate().slice(0, 7);
}

function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0).getDate();
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
  });
}

function dutyDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const hours = Math.floor(total / 60);
  const remainingMinutes = total % 60;
  return hours ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`;
}

function clockDuration(minutes: number): string {
  const totalHours = Math.floor(Math.max(0, minutes) / 60);
  const remainingMinutes = Math.max(0, minutes) % 60;
  return `${totalHours}h ${remainingMinutes}m`;
}

function parseDutyHours(value: string): DutyHoursSelection {
  const times = value.match(
    /(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)|(?:[01]?\d|2[0-3]):[0-5]\d/gi
  ) || [];
  const parsed = times.map((time) => {
    const twelveHour = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(time.trim());
    if (twelveHour) {
      const hour = Number(twelveHour[1]) % 12 + (twelveHour[3].toLowerCase() === "pm" ? 12 : 0);
      return `${String(hour).padStart(2, "0")}:${twelveHour[2] || "00"}`;
    }
    return time;
  });
  return { start: parsed[0] || "", end: parsed[1] || "" };
}

function formatDutyTime(value: string): string {
  const [rawHour, minute] = value.split(":");
  const hour = Number(rawHour);
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

function formatDutyHours(selection: DutyHoursSelection): string {
  if (!selection.start || !selection.end) return "";
  return `${formatDutyTime(selection.start)} – ${formatDutyTime(selection.end)}`;
}

function earliestStaffLogin(
  activity: StaffDailyHistory["activity"] | undefined
): string | null {
  let earliest: string | null = null;
  let earliestTimestamp = Number.POSITIVE_INFINITY;
  for (const entry of activity || []) {
    if (entry.action !== "auth.login") continue;
    const timestamp = Date.parse(entry.created_at.replace(" ", "T"));
    if (Number.isFinite(timestamp) && timestamp < earliestTimestamp) {
      earliest = entry.created_at;
      earliestTimestamp = timestamp;
    }
  }
  return earliest;
}

export function AdminStaffClient() {
  const pathname = usePathname();
  const feedback = useFeedback();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accountForm, setAccountForm] = useState<{
    name: string;
    email: string;
    contact_number: string;
    address: string;
    role: AccountRole;
    password: string;
  }>({
    name: "",
    email: "",
    contact_number: "",
    address: "",
    role: "staff",
    password: "",
  });
  const [accountDutyHours, setAccountDutyHours] = useState<DutyHoursSelection>({
    start: "",
    end: "",
  });
  const [accountAttempted, setAccountAttempted] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const createCloseRef = useRef<HTMLButtonElement>(null);
  const [identityFiles, setIdentityFiles] = useState<Record<string, File | null>>({});
  const [identityFormKey, setIdentityFormKey] = useState(0);
  const [identityType, setIdentityType] = useState("philsys");
  const [idScan, setIdScan] = useState<{ outcome?: string; detected_type?: string | null; name_evidence?: string; face_match?: string; verification_token?: string; error?: string } | null>(null);
  const [idScanning, setIdScanning] = useState(false);
  const [idPopupOpen, setIdPopupOpen] = useState(false);
  const [newIdReviewOpen, setNewIdReviewOpen] = useState(false);
  const [newIdDetails, setNewIdDetails] = useState({
    name: "",
    number: "",
    birth_date: "",
    expiration_date: "",
  });
  const [newIdDetailsReady, setNewIdDetailsReady] = useState(false);
  const newIdDuplicate = useStaffIdDuplicateCheck(
    identityType,
    newIdDetails.number,
    newIdReviewOpen || newIdDetailsReady
  );
  const identityTypeCheck =
    idScan?.outcome === "match" ||
    (identityType === "other" &&
      idScan?.outcome === "uncertain" &&
      newIdDetailsReady);
  const manualTypeReviewAvailable =
    identityType === "other" &&
    idScan?.outcome === "uncertain" &&
    idScan?.face_match === "matched" &&
    Boolean(idScan?.verification_token);
  const identityScanVerified =
    identityTypeCheck &&
    idScan?.face_match === "matched" &&
    Boolean(idScan?.verification_token);
  const idDetailsValid =
    checkStaffIdName(newIdDetails.name, accountForm.name) === "pass" &&
    checkStaffIdNumber(newIdDetails.number, identityType) === "pass" &&
    checkStaffIdBirthDate(newIdDetails.birth_date) === "pass" &&
    checkStaffIdExpiration(newIdDetails.expiration_date, identityType) === "pass";
  const canCreateStaffAccount =
    identityScanVerified &&
    newIdDetailsReady &&
    idDetailsValid &&
    newIdDuplicate === "unique";
  const accountDetailsReady = staffRegistrationDetailsReady(accountForm.name, accountForm.email, accountForm.contact_number, accountDutyHours.start, accountDutyHours.end);
  const [faceCameraOpen, setFaceCameraOpen] = useState(false);
  const [retakePose, setRetakePose] = useState<number | null>(null);
  const [guidedPoses, setGuidedPoses] = useState<Record<string, boolean>>({});
  const [createdCredentials, setCreatedCredentials] = useState<{ name: string; username: string; password: string } | null>(null);
  const [showCreatedPassword, setShowCreatedPassword] = useState(false);
  const [showAccountPassword, setShowAccountPassword] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [accountReason, setAccountReason] = useState("");
  const [accountConfirmationPassword, setAccountConfirmationPassword] = useState("");
  const [viewingProfile, setViewingProfile] = useState<User | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [editConfirmationOpen, setEditConfirmationOpen] = useState(false);
  const editConfirmationCancelRef = useRef<HTMLButtonElement>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    username: "",
    email: "",
    contact_number: "",
    address: "",
    role: "staff",
    password: "",
    is_active: true,
  });
  const [editDutyHours, setEditDutyHours] = useState<DutyHoursSelection>({
    start: "",
    end: "",
  });
  const [editBaseline, setEditBaseline] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editReason, setEditReason] = useState("");
  const [editConfirmationPassword, setEditConfirmationPassword] = useState("");
  const [accountAction, setAccountAction] = useState<{
    user: User;
    action: SensitiveAccountAction;
  } | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [actionConfirmationPassword, setActionConfirmationPassword] = useState("");
  const [actionNewPassword, setActionNewPassword] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const [profileDate, setProfileDate] = useState(todayInputDate);
  const [profileMonth, setProfileMonth] = useState(currentMonthInput);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [showDailyDetails, setShowDailyDetails] = useState(false);
  const [historyResult, setHistoryResult] = useState<{
    key: string;
    history?: StaffDailyHistory;
    error?: string;
  } | null>(null);
  const [attendanceCorrectionOpen, setAttendanceCorrectionOpen] = useState(false);
  const [attendanceCorrectionTime, setAttendanceCorrectionTime] = useState("");
  const [attendanceCorrectionReason, setAttendanceCorrectionReason] = useState("");

  const clearRegistration = useCallback(() => {
    setAccountForm({ name: "", email: "", contact_number: "", address: "", role: "staff", password: "" });
    setAccountDutyHours({ start: "", end: "" });
    setAccountReason("");
    setAccountConfirmationPassword("");
    setAccountAttempted(false);
    setShowAccountPassword(false);
    setIdentityFiles({});
    setGuidedPoses({});
    setRetakePose(null);
    setFaceCameraOpen(false);
    setIdentityType("philsys");
    setIdScan(null);
    setNewIdDetailsReady(false);
    setNewIdDetails({ name: "", number: "", birth_date: "", expiration_date: "" });
    setNewIdReviewOpen(false);
    setIdPopupOpen(false);
    setIdentityFormKey((key) => key + 1);
  }, []);

  useEffect(() => {
    if (!createOpen) return;
    const trigger = createTriggerRef.current;
    createCloseRef.current?.focus();
    return () => { trigger?.focus(); };
  }, [createOpen]);

  useEffect(() => {
    if (!createOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (creatingAccount || idScanning) return;
        if (faceCameraOpen) setFaceCameraOpen(false);
        else if (newIdReviewOpen) setNewIdReviewOpen(false);
        else if (idPopupOpen) setIdPopupOpen(false);
        else { clearRegistration(); setCreateOpen(false); }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [createOpen, creatingAccount, idScanning, faceCameraOpen, newIdReviewOpen, idPopupOpen, clearRegistration]);

  useEffect(() => {
    if (!editConfirmationOpen) return;
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    editConfirmationCancelRef.current?.focus();
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [editConfirmationOpen]);
  const [attendanceCorrectionPassword, setAttendanceCorrectionPassword] = useState("");
  const [savingAttendanceCorrection, setSavingAttendanceCorrection] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetchPortalApi("/api/users?role=staff", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Unable to load accounts.");
      }
      const loadedUsers = data.users as User[];
      setUsers(loadedUsers);
      setViewingProfile((current) =>
        current
          ? loadedUsers.find((user) => user.id === current.id) || null
          : null
      );
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to load accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

  usePolling(load, 15_000, {
    enabled: pathname === "/admin/staff",
    resources: ["accounts"],
  });

  const viewingProfileId = viewingProfile?.id;
  const historyKey = viewingProfileId
    ? `${viewingProfileId}:${profileMonth}:${profileDate}`
    : null;
  const matchingHistory =
    historyResult?.key === historyKey ? historyResult : null;
  const dailyHistory = matchingHistory?.history || null;
  const dailyHistoryError = matchingHistory?.error || "";
  const dailyHistoryLoading = Boolean(viewingProfileId && !matchingHistory);
  const matchingMonthHistory =
    historyResult?.key.startsWith(`${viewingProfileId}:${profileMonth}:`)
      ? historyResult.history
      : null;

  useEffect(() => {
    if (!viewingProfileId) return;
    let active = true;
    const key = `${viewingProfileId}:${profileMonth}:${profileDate}`;
    const url = `/api/admin/staff/${viewingProfileId}/attendance?date=${encodeURIComponent(
      profileDate
    )}&month=${encodeURIComponent(profileMonth)}`;
    void fetchPortalApi(url, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Unable to load daily staff history.");
        }
        if (active) setHistoryResult({ key, history: data as StaffDailyHistory });
      })
      .catch((err: unknown) => {
        if (active) {
          setHistoryResult({
            key,
            error: err instanceof Error ? err.message : "Unable to load daily staff history.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [viewingProfileId, profileDate, profileMonth, historyRevision]);

  useEffect(() => {
    if (!viewingProfileId) return;
    const refreshOnFocus = () => setHistoryRevision((revision) => revision + 1);
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, [viewingProfileId]);

  const openProfile = (user: User) => {
    const today = todayInputDate();
    setProfileDate(today);
    setProfileMonth(today.slice(0, 7));
    setShowDailyDetails(false);
    setAttendanceCorrectionOpen(false);
    setAttendanceCorrectionTime("");
    setAttendanceCorrectionReason("");
    setAttendanceCorrectionPassword("");
    setViewingProfile(user);
  };

  const clearAttendanceCorrection = () => {
    setAttendanceCorrectionOpen(false);
    setAttendanceCorrectionTime("");
    setAttendanceCorrectionReason("");
    setAttendanceCorrectionPassword("");
  };

  const moveProfileMonth = (offset: number) => {
    const [year, month] = profileMonth.split("-").map(Number);
    const nextMonth = new Date(year, month - 1 + offset, 1);
    const monthKey = `${nextMonth.getFullYear()}-${String(
      nextMonth.getMonth() + 1
    ).padStart(2, "0")}`;
    const day = Math.min(
      Number(profileDate.slice(8, 10)),
      daysInMonth(monthKey)
    );
    const candidate = `${monthKey}-${String(day).padStart(2, "0")}`;
    const createdDate = viewingProfile?.created_at?.slice(0, 10);
    const selectedDate =
      createdDate && candidate < createdDate
        ? createdDate
        : candidate > todayInputDate()
          ? todayInputDate()
          : candidate;
    setProfileMonth(monthKey);
    setProfileDate(selectedDate);
    clearAttendanceCorrection();
  };

  const createAccount = async () => {
    setAccountAttempted(true);
    if (!accountForm.name.trim() || (accountForm.role === "admin" && !accountForm.password.trim())) {
      feedback.warning("Some account details are missing", {
        message: "Add a name and, for administrators, a temporary password.",
      });
      return;
    }
    if ((accountForm.role === "staff" && !accountForm.email.trim()) || (accountForm.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountForm.email.trim()))) {
      feedback.warning("Check the personal email", {
        message: "Enter a valid recovery email for staff accounts.",
      });
      return;
    }
    if (accountForm.role === "staff" && !accountForm.contact_number.trim()) {
      feedback.warning("Contact number required", { message: "Enter the staff member’s contact number." });
      return;
    }
    if (accountForm.role === "staff" && (!accountDutyHours.start || !accountDutyHours.end)) {
      feedback.warning("Duty hours required", { message: "Choose both a start time and an end time." });
      return;
    }
    if (Boolean(accountDutyHours.start) !== Boolean(accountDutyHours.end)) {
      feedback.warning("Choose both schedule times", {
        message: "Select both a start time and an end time, or leave both blank.",
      });
      return;
    }
    if (accountDutyHours.start && accountDutyHours.end && accountDutyHours.end <= accountDutyHours.start) {
      feedback.warning("Check the duty hours", { message: "The end time must be later than the start time on the same day." });
      return;
    }
    if (accountForm.role === "staff") {
      const files = ["id_front", "face_front", "face_left", "face_right", ...(identityFiles.id_back ? ["id_back"] : [])].map((key) => identityFiles[key]);
      if (files.some((file) => !file || file.size > 2 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(file.type))) {
        feedback.warning("Identity images required", { message: "Choose an ID image and front, left and right face images. Each must be a JPEG or PNG under 2 MB." });
        return;
      }
      if (!canCreateStaffAccount) {
        feedback.warning("ID and face verification required", {
          message: "Scan the ID and face, review the name and ID number, and resolve the duplicate-ID check before creating this staff account.",
        });
        return;
      }
    }
    if (
      accountForm.role === "admin" &&
      (!accountReason.trim() || !accountConfirmationPassword)
    ) {
      feedback.warning("Administrator confirmation required", {
        message: "Add a reason and confirm your administrator password.",
      });
      return;
    }
    setCreatingAccount(true);
    setError("");
    const account = {
      ...accountForm,
      duty_hours: formatDutyHours(accountDutyHours),
      ...(accountForm.role === "admin"
        ? {
            reason: accountReason.trim(),
            confirmation_password: accountConfirmationPassword,
          }
        : {}),
    };
    let createdUsername = "";
    let createdPassword = account.password;
    const result = await feedback.run(
      async () => {
        const identity = account.role === "staff"
          ? { id_type: identityType, ...Object.fromEntries(await Promise.all(["id_front", "face_front", "face_left", "face_right", ...(identityFiles.id_back ? ["id_back"] : [])].map(async (key) => {
              const file = identityFiles[key]!;
              const image = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read image."));
                reader.onerror = () => reject(new Error("Could not read image."));
                reader.readAsDataURL(file);
              });
              return [key, image];
            }))) }
          : undefined;
        const response = await fetchPortalApi("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...account,
            identity,
            ...(account.role === "staff"
              ? {
                  identity_details: newIdDetails,
                  identity_details_reviewed: newIdDetailsReady,
                  identity_verification_token: idScan?.verification_token,
                }
              : {}),
          }),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not create account.");
        }
        if (typeof data.username !== "string") {
          throw new Error("The new account username could not be confirmed.");
        }
        createdUsername = data.username;
        if (account.role === "staff") {
          if (typeof data.temporary_password !== "string" || data.temporary_password.length !== 6) {
            throw new Error("Account created, but the temporary password could not be displayed. Reset it in staff management.");
          }
          createdPassword = data.temporary_password;
        }
        return data;
      },
      {
        loading: { title: "Creating the account…", message: "Giving them access to the portal." },
        success: () => ({
          eyebrow: "Account created",
          title: `${account.name} was added`,
          message: account.role === "staff" ? "Identity verified and saved." : "Share the username and temporary password with them.",
          details: [
            {
              label: "Username",
              value: createdUsername,
            },
            { label: "Email", value: account.email.toLowerCase().trim() || "Not set" },
            { label: "Role", value: account.role === "admin" ? "Admin" : "Staff" },
          ],
        }),
      }
    );
    if (result.ok) {
      setFaceCameraOpen(false);
      feedback.dismiss();
      setCreatedCredentials({ name: account.name, username: createdUsername, password: createdPassword });
      setShowCreatedPassword(true);
      setCreateOpen(false);
      clearRegistration();
      await load();
    }
    setCreatingAccount(false);
  };

  const scanId = async () => {
    const file = identityFiles.id_front;
    const face = identityFiles.face_front;
    if (!file || !face || !accountForm.name.trim()) {
      setIdScan({ error: "Enter the staff name and capture a front face photo before scanning." });
      return;
    }
    setIdScanning(true);
    setIdScan(null);
    try {
      const form = new FormData();
      form.set("image", file);
      form.set("type", identityType);
      form.set("face", face);
      form.set("name", accountForm.name.trim());
      const response = await fetch("/api/admin/staff/id-scan", { method: "POST", body: form });
      const data = await response.json();
      setIdScan(response.ok ? data : { error: data.error || "Could not scan the ID." });
      const manualTypeReviewRequired =
        identityType === "other" &&
        data.outcome === "uncertain" &&
        data.face_match === "matched";
      if (response.ok && (isStaffIdentityScanVerified(data.outcome, data.face_match) || manualTypeReviewRequired) && typeof data.verification_token === "string") {
        setNewIdDetails(data.suggestions ?? { name: "", number: "", birth_date: "", expiration_date: "" });
        setNewIdDetailsReady(false);
        setNewIdReviewOpen(true);
      }
    } catch {
      setIdScan({ error: "Could not scan the ID. Please try again." });
    } finally {
      setIdScanning(false);
    }
  };

  const openEdit = (user: User) => {
    setViewingProfile(null);
    setEditing(user);
    setEditConfirmationOpen(false);
    setEditReason("");
    setEditConfirmationPassword("");
    const nextEditForm = {
      name: user.name,
      username: user.username,
      email: user.email,
      contact_number: user.contact_number || "",
      address: user.address || "",
      role: user.role,
      password: "",
      is_active: user.is_active !== 0,
    };
    const nextDutyHours = parseDutyHours(user.duty_hours || "");
    setEditForm(nextEditForm);
    setEditDutyHours(nextDutyHours);
    setEditBaseline(
      JSON.stringify({ form: nextEditForm, dutyHours: nextDutyHours })
    );
  };

  const editHasChanges =
    editing !== null &&
    JSON.stringify({ form: editForm, dutyHours: editDutyHours }) !== editBaseline;

  const saveEdit = async () => {
    if (!editing) return;
    if (
      !editForm.name.trim() ||
      !editForm.username.trim()
    ) {
      feedback.warning("Name and username are required", {
        message: "Fill in the name and login username before saving.",
      });
      return;
    }
    if (
      editForm.username.trim().length > 80 ||
      /\s|@/.test(editForm.username.trim())
    ) {
      feedback.warning("Check the login username", {
        message: "Use up to 80 characters without spaces or an @ sign.",
      });
      return;
    }
    if (
      !editForm.email.trim() ||
      (editForm.email.trim().length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editForm.email.trim()))
    ) {
      feedback.warning("Check the personal email", {
        message: "Enter a valid recovery email address.",
      });
      return;
    }
    if (Boolean(editDutyHours.start) !== Boolean(editDutyHours.end)) {
      feedback.warning("Choose both schedule times", {
        message: "Select both a start time and an end time, or leave both blank.",
      });
      return;
    }
    if (editDutyHours.start && editDutyHours.end && editDutyHours.end <= editDutyHours.start) {
      feedback.warning("Check the duty hours", { message: "The end time must be later than the start time on the same day." });
      return;
    }
    const usernameChanged =
      editForm.username.trim().toLowerCase() !== editing.username.toLowerCase();
    const emailChanged =
      editForm.email.trim().toLowerCase() !== editing.email.toLowerCase();
    const highRiskChange =
      usernameChanged ||
      emailChanged ||
      editForm.role !== editing.role ||
      editForm.is_active !== (editing.is_active !== 0) ||
      Boolean(editForm.password.trim());
    if (editReason.trim().length < 3 || editReason.trim().length > 500) {
      feedback.warning("Confirmation required", {
        message: "Enter a reason of 3 to 500 characters. It will be recorded in the activity log.",
      });
      return;
    }
    if (highRiskChange && !editConfirmationPassword) {
      feedback.warning("Administrator confirmation required", {
        message: "Enter your administrator password to change login details, role, access, or password.",
      });
      return;
    }
    if (editForm.password.trim() && editForm.password.trim().length < 6) {
      feedback.warning("Password too short", {
        message: "Use at least 6 characters for the new password.",
      });
      return;
    }
    if (!editConfirmationOpen) {
      setEditConfirmationOpen(true);
      return;
    }
    setEditConfirmationOpen(false);
    setSavingEdit(true);
    setError("");
    const payload: Record<string, unknown> = {
      id: editing.id,
      name: editForm.name.trim(),
      username: editForm.username.trim(),
      email: editForm.email.trim(),
      contact_number: editForm.contact_number.trim(),
      address: editForm.address.trim(),
      duty_hours: formatDutyHours(editDutyHours),
      role: editForm.role,
      is_active: editForm.is_active,
      reason: editReason.trim(),
      ...(highRiskChange
        ? {
            confirmation_password: editConfirmationPassword,
          }
        : {}),
    };
    if (editForm.password.trim()) {
      payload.password = editForm.password.trim();
    }
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/users", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not update account.");
        }
        return data;
      },
      {
        loading: { title: "Updating account…", message: `Saving changes for ${editing.name}.` },
        success: () => ({
          eyebrow: "Account updated",
          title: `${editForm.name} updated`,
          message: editForm.password.trim()
            ? "Profile and password have been updated."
            : "Profile has been updated.",
        }),
      }
    );
    if (result.ok) {
      setEditing(null);
      setEditReason("");
      setEditConfirmationPassword("");
      await load();
    }
    setSavingEdit(false);
  };

  const openAccountAction = (
    user: User,
    action: SensitiveAccountAction
  ) => {
    setActionReason("");
    setActionConfirmationPassword("");
    setActionNewPassword("");
    setAccountAction({ user, action });
  };

  const closeAccountAction = () => {
    if (savingAction) return;
    setAccountAction(null);
    setActionReason("");
    setActionConfirmationPassword("");
    setActionNewPassword("");
  };

  const confirmAccountAction = async () => {
    if (!accountAction) return;
    if (actionReason.trim().length < 3 || !actionConfirmationPassword) {
      feedback.warning("Confirmation required", {
        message: "Enter a reason and your administrator password to continue.",
      });
      return;
    }
    if (
      accountAction.action === "reset-password" &&
      actionNewPassword.trim().length < 6
    ) {
      feedback.warning("Password too short", {
        message: "Use at least 6 characters for the new password.",
      });
      return;
    }

    const { user, action } = accountAction;
    const removing = action === "remove";
    const title =
      action === "remove"
        ? "Remove account"
        : action === "deactivate"
          ? "Deactivate account"
          : action === "activate"
            ? "Activate account"
            : "Reset password";
    const body: Record<string, unknown> = {
      id: user.id,
      reason: actionReason.trim(),
      confirmation_password: actionConfirmationPassword,
    };
    if (action === "activate" || action === "deactivate") {
      body.is_active = action === "activate";
    } else if (action === "reset-password") {
      body.password = actionNewPassword.trim();
    }

    setSavingAction(true);
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi("/api/users", {
          method: removing ? "DELETE" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || `Could not ${title.toLowerCase()}.`);
        }
        return data;
      },
      {
        loading: { title: `${title}…`, message: user.name },
        success: () => ({
          eyebrow: "Account action confirmed",
          title:
            action === "reset-password"
              ? `${user.name}'s password updated`
              : `${user.name} ${action === "remove" ? "removed" : `${action}d`}`,
          message:
            action === "remove"
              ? "They can no longer sign in. Past activity stays in the log."
              : action === "reset-password"
                ? "Share the new password with them privately."
                : action === "activate"
                  ? "They can sign in again."
                  : "They can no longer sign in until reactivated.",
        }),
      }
    );
    setSavingAction(false);
    if (result.ok) {
      setAccountAction(null);
      setActionReason("");
      setActionConfirmationPassword("");
      setActionNewPassword("");
      await load();
    }
  };

  const editRequiresConfirmation = Boolean(
    editing &&
      (editForm.username.trim().toLowerCase() !== editing.username.toLowerCase() ||
        editForm.email.trim().toLowerCase() !== editing.email.toLowerCase() ||
        editForm.role !== editing.role ||
        editForm.is_active !== (editing.is_active !== 0) ||
        editForm.password.trim())
  );
  const dailySessions = dailyHistory?.attendance.sessions || [];
  const calendarAttendance = new Map(
    (matchingMonthHistory?.calendar || []).map((day) => [day.date, day])
  );
  const monthDayCount = daysInMonth(profileMonth);
  const [calendarYear, calendarMonthNumber] = profileMonth.split("-").map(Number);
  const calendarOffset = new Date(calendarYear, calendarMonthNumber - 1, 1).getDay();
  const monthCells = Array.from(
    { length: Math.ceil((calendarOffset + monthDayCount) / 7) * 7 },
    (_, index) =>
      index < calendarOffset || index >= calendarOffset + monthDayCount
        ? null
        : index - calendarOffset + 1
  );
  const todayDate = todayInputDate();
  const createdDate = viewingProfile?.created_at?.slice(0, 10);
  const createdMonth = createdDate?.slice(0, 7) || "";
  const currentMonth = currentMonthInput();
  const firstDailyLogin =
    earliestStaffLogin(dailyHistory?.activity) ||
    dailySessions.find((session) => session.login_at)?.login_at;
  const isOnDuty =
    profileDate === todayDate && dailySessions.some((session) => !session.logout_at);
  const missingSignOut =
    profileDate < todayDate && dailySessions.some((session) => !session.logout_at);
  const lastDailyLogout = dailySessions
    .slice()
    .reverse()
    .find((session) => session.logout_at)?.logout_at;

  const correctMissingSignOut = async () => {
    if (!viewingProfile || !missingSignOut) return;
    if (
      !attendanceCorrectionTime ||
      attendanceCorrectionReason.trim().length < 3 ||
      !attendanceCorrectionPassword
    ) {
      feedback.warning("Confirmation required", {
        message: "Enter the sign-out time, a reason, and your administrator password.",
      });
      return;
    }

    setSavingAttendanceCorrection(true);
    const result = await feedback.run(
      async () => {
        const response = await fetchPortalApi(
          `/api/admin/staff/${viewingProfile.id}/attendance`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              date: profileDate,
              time: attendanceCorrectionTime,
              reason: attendanceCorrectionReason.trim(),
              confirmation_password: attendanceCorrectionPassword,
            }),
          }
        );
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not correct the sign-out.");
        }
        return data;
      },
      {
        loading: { title: "Recording sign-out…", message: "Saving the attendance correction." },
        success: () => ({
          eyebrow: "Attendance updated",
          title: "Missing sign-out recorded",
          message: `Sign-out for ${viewingProfile.name} was saved with your reason.`,
        }),
      }
    );
    setSavingAttendanceCorrection(false);
    if (result.ok) {
      setAttendanceCorrectionOpen(false);
      setAttendanceCorrectionTime("");
      setAttendanceCorrectionReason("");
      setAttendanceCorrectionPassword("");
      setHistoryRevision((revision) => revision + 1);
    }
  };

  if (loading) return <PortalPageSkeleton area="admin" />;

  return (
    <>
      {error && <div className="error-strip" style={{ marginBottom: 13 }}>{error}</div>}

      <div className="admin-staff-layout">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Team accounts</h2>
              <p>Staff accounts and their access details.</p>
            </div>
            <div className="staff-list-actions">
              <span className="badge badge-cream">{users.length}</span>
              <button ref={createTriggerRef} type="button" className="btn btn-primary" onClick={() => { setShowAccountPassword(false); setCreateOpen(true); }}>
                <Icon name="users" size={16} /> Register new staff
              </button>
            </div>
          </div>
          <div className="panel-body">
            <div className="account-list">
                {users.map((user) => (
                  <div className="account-row" key={user.id}>
                    <button
                      type="button"
                      className="account-profile-trigger"
                      onClick={() => openProfile(user)}
                      aria-label={`View profile for ${user.name}`}
                    >
                      <span className="avatar">
                        {user.name
                          .split(" ")
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <span className="account-info">
                        <strong>{user.name}</strong>
                        <span className="account-view-link">View profile</span>
                      </span>
                    </button>
                    <span className={`badge ${user.role === "admin" ? "badge-dark" : "badge-cream"}`}>
                      {user.role}
                    </span>
                    <span className={`badge ${user.is_active === 0 ? "badge-red" : "badge-green"}`}>
                      {user.is_active === 0 ? "Inactive" : "Active"}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {createOpen && (
        <div className="modal-backdrop">
        <section className="modal staff-create-panel" role="dialog" aria-modal="true" aria-labelledby="staff-create-title">
          <div className="panel-head">
            <div>
              <h2 id="staff-create-title">Add an account</h2>

            </div>
            <button ref={createCloseRef} type="button" className="staff-create-close" disabled={creatingAccount || idScanning} onClick={() => { clearRegistration(); setCreateOpen(false); }} aria-label="Close registration">
              <Icon name="x" />
            </button>
          </div>
          <div className="panel-body">
            <div className="staff-create-grid">
            <div className="invite-form staff-create-fields">
              <div className="field">
                <label className="label" htmlFor="acc-name">Full name (required)</label>
                <input
                  id="acc-name"
                  className="input"
                  value={accountForm.name}
                  required
                  aria-invalid={accountAttempted && !accountForm.name.trim()}
                  onChange={(event) =>
                    { setIdScan(null); setNewIdDetailsReady(false); setAccountForm((current) => ({ ...current, name: event.target.value })); }
                  }
                  placeholder="Juan Dela Cruz"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="acc-email">Recovery email {accountForm.role === "staff" ? "(required)" : "(optional)"}</label>
                <input
                  id="acc-email"
                  className="input"
                  type="email"
                  value={accountForm.email}
                  aria-invalid={accountAttempted && Boolean(accountForm.email.trim()) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountForm.email.trim())}
                  onChange={(event) =>
                    setAccountForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="juan@example.com"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="acc-contact-number">Contact number {accountForm.role === "staff" ? "(required)" : "(optional)"}</label>
                <input
                  id="acc-contact-number"
                  className="input"
                  type="tel"
                  required={accountForm.role === "staff"}
                  aria-invalid={accountAttempted && accountForm.role === "staff" && !accountForm.contact_number.trim()}
                  maxLength={40}
                  value={accountForm.contact_number}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      contact_number: event.target.value,
                    }))
                  }
                  placeholder="09xx xxx xxxx"
                />
              </div>
              <div className="field">
                <span className="label">Scheduled duty hours {accountForm.role === "staff" ? "(required)" : "(optional)"}</span>
                <div className="staff-duty-hours-inputs">
                  <div className="field">
                    <label className="label" htmlFor="acc-duty-start">Start time{accountForm.role === "staff" ? " (required)" : ""}</label>
                    <DutyTimePicker id="acc-duty-start" value={accountDutyHours.start} validate={(value) => accountDutyHours.end && value >= accountDutyHours.end ? "Start time must be earlier than end time." : null} onChange={(value) => setAccountDutyHours((current) => ({ ...current, start: value }))} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="acc-duty-end">End time{accountForm.role === "staff" ? " (required)" : ""}</label>
                    <DutyTimePicker id="acc-duty-end" value={accountDutyHours.end} validate={(value) => accountDutyHours.start && value <= accountDutyHours.start ? "End time must be later than start time." : null} onChange={(value) => setAccountDutyHours((current) => ({ ...current, end: value }))} />
                  </div>
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="acc-address">Address</label>
                <textarea
                  id="acc-address"
                  className="input"
                  rows={2}
                  maxLength={500}
                  value={accountForm.address}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      address: event.target.value,
                    }))
                  }
                  placeholder="Staff member’s address"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="acc-role">Role</label>
                <select
                  id="acc-role"
                  className="select"
                  value={accountForm.role}
                  onChange={(event) =>
                    setAccountForm((current) => ({
                      ...current,
                      role: event.target.value === "admin" ? "admin" : "staff",
                    }))
                  }
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              {accountForm.role === "admin" && (
                <div className="account-security-fields">
                  <p>
                    Creating an administrator account is a sensitive action.
                    Add a reason and confirm your password.
                  </p>
                  <div className="field">
                    <label className="label" htmlFor="admin-create-reason">Reason</label>
                    <textarea
                      id="admin-create-reason"
                      className="input"
                      value={accountReason}
                      onChange={(event) => setAccountReason(event.target.value)}
                      minLength={3}
                      maxLength={500}
                      required
                    />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="admin-create-password">Your administrator password</label>
                    <input
                      id="admin-create-password"
                      className="input"
                      type="password"
                      autoComplete="current-password"
                      value={accountConfirmationPassword}
                      onChange={(event) => setAccountConfirmationPassword(event.target.value)}
                      required
                    />
                  </div>
                </div>
              )}
              {accountForm.role === "admin" && <div className="field">
                <label className="label" htmlFor="acc-password">Temporary password (required)</label>
                <div className="password-input-control">
                  <input
                    id="acc-password"
                    className="input"
                    type={showAccountPassword ? "text" : "password"}
                    value={accountForm.password}
                    required
                    maxLength={128}
                    autoComplete="new-password"
                    aria-invalid={accountAttempted && !accountForm.password.trim()}
                    onChange={(event) =>
                      setAccountForm((current) => ({ ...current, password: event.target.value }))
                    }
                    placeholder="At least 6 characters"
                  />
                  <button
                    type="button"
                    className="password-input-toggle"
                    onClick={() => setShowAccountPassword((shown) => !shown)}
                    aria-label={showAccountPassword ? "Hide temporary password" : "Show temporary password"}
                    aria-pressed={showAccountPassword}
                  >
                    <Icon name={showAccountPassword ? "eye-off" : "eye"} size={16} />
                  </button>
                </div>
              </div>}
              {accountForm.role === "staff" && <p className="tiny">A temporary password will be generated and shown after the account is created.</p>}
              <button
                type="button"
                className="btn btn-primary"
                disabled={creatingAccount || (accountForm.role === "staff" && !canCreateStaffAccount)}
                onClick={createAccount}
              >
                {creatingAccount ? <LoadingDots label="Creating" /> : "Create account"}
              </button>
            </div>
            {accountForm.role === "staff" && (
              <section className="staff-identity-panel" key={identityFormKey} aria-labelledby="staff-identity-title">
                <span className="eyebrow" id="staff-identity-title">Identity registration</span>
                {!accountDetailsReady && <div className="staff-identity-blocker" role="status" id="identity-details-required">
                  <Icon name="lock" size={22} />
                  <strong>Complete the account details first</strong>
                  <p>Enter the staff member’s full name, recovery email, contact number, and valid duty hours to begin identity registration.</p>
                </div>}
                <fieldset className="staff-identity-fields" disabled={!accountDetailsReady} aria-describedby={!accountDetailsReady ? "identity-details-required" : undefined}>
                <div className="staff-identity-group">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => { setRetakePose(null); setFaceCameraOpen(true); }}>{identityFiles.face_front || identityFiles.face_left || identityFiles.face_right ? "Retake face" : "Register face"}</button>
                  <div className="staff-identity-poses">
                    {([
                      ["face_front", "Straight on"],
                      ["face_left", "Turn left"],
                      ["face_right", "Turn right"],
                    ] as const).map(([key, label], index) => (
                      <div className="staff-identity-upload" key={key}>
                        <span className={`staff-identity-step${guidedPoses[key] ? " is-passed" : ""}`} aria-label={guidedPoses[key] ? "Guided pose captured" : "Pose not checked"}>{guidedPoses[key] ? "✓" : index + 1}</span>
                        {identityFiles[key] && <StaffFacePhotoPreview file={identityFiles[key]!} label={label} />}
                        <strong>{label}</strong>
                        {identityFiles[key] ? (
                          <button type="button" className="btn btn-outline btn-sm" disabled={faceCameraOpen} onClick={() => { setRetakePose(index); setFaceCameraOpen(true); }}>Retake</button>
                        ) : (
                          <label className="staff-identity-id-upload">Upload photo
                            <input type="file" accept="image/jpeg,image/png" aria-label={`${label} face photo`} onChange={(event) => { const file = event.target.files?.[0] ?? null; setIdScan(null); setNewIdDetailsReady(false); setIdentityFiles((current) => ({ ...current, [key]: file })); setGuidedPoses((current) => ({ ...current, [key]: false })); }} />
                          </label>
                        )}
                        {identityFiles[key] && !guidedPoses[key] && <span>Pose not checked — retake with camera</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="staff-identity-group">
                  <h4>Staff ID</h4>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setIdPopupOpen(true)}>{identityFiles.id_front ? "Review ID images" : "Add ID images"}</button>
                </div>
                </fieldset>
              </section>
            )}
            </div>
          </div>
        </section>
        </div>
        )}
      </div>

      {createOpen && idPopupOpen && (
        <div className="modal-backdrop staff-face-popup-backdrop">
          <section className="modal staff-id-popup" role="dialog" aria-modal="true" aria-labelledby="staff-id-popup-title">
            <div className="modal-head">
              <div><span className="eyebrow">Identity registration</span><h2 id="staff-id-popup-title">Check ID{accountForm.name.trim() ? ` — ${accountForm.name.trim()}` : ""}</h2></div>
              <button type="button" disabled={idScanning} aria-label="Close ID check" onClick={() => setIdPopupOpen(false)}><Icon name="x" /></button>
            </div>
            <div className="modal-body staff-id-popup-body">
                  <label className="field">
                    <span className="label">Kind of ID</span>
                    <select className="select" value={identityType} disabled={idScanning} onChange={(event) => { setIdentityType(event.target.value); setIdScan(null); setNewIdDetailsReady(false); }}>
                      <option value="philsys">PhilSys National ID</option>
                      <option value="drivers_license">Driver’s license</option>
                      <option value="passport">Passport</option>
                      <option value="postal">Postal ID</option>
                      <option value="voter">Voter’s ID</option>
                      <option value="philhealth">PhilHealth ID</option>
                      <option value="other">Other government ID</option>
                    </select>
                  </label>
                  {([["id_front", "Front of the ID", "Required"], ["id_back", "Back of the ID", "Optional"]] as const).map(([key, label, requirement]) => (
                    <div className="staff-identity-id-side" key={key}>
                      <strong>{label}</strong> <span className="badge badge-cream">{requirement}</span>
                      <p>{key === "id_front" ? "Keep all four edges visible and the text clear." : "Add the back if available."}</p>
                      <div className="staff-id-side-content">
                        <div className="staff-id-preview">
                          {identityFiles[key] ? <StaffFacePhotoPreview file={identityFiles[key]!} label={label} /> : <span>Not captured</span>}
                        </div>
                        <div>
                      <p>{identityFiles[key]?.name || "No image selected"}</p>
                      <label className="staff-identity-id-upload">
                        <Icon name="card" size={18} /> Choose image
                        <input type="file" accept="image/jpeg,image/png" disabled={idScanning} aria-label={`${label} image`} onChange={(event) => { setIdScan(null); setNewIdDetailsReady(false); setIdentityFiles((current) => ({ ...current, [key]: event.target.files?.[0] ?? null })); }} />
                      </label>
                      {identityFiles[key] && <button type="button" className="btn btn-ghost btn-sm" disabled={idScanning} onClick={() => { setIdScan(null); setNewIdDetailsReady(false); setIdentityFiles((current) => ({ ...current, [key]: null })); }}>Remove</button>}
                        </div>
                      </div>
                    </div>
                  ))}
                  <p className="tiny">Scanning sends the ID to OCR.space and the ID and staff face photo to a third-party verification service. Obtain the staff member’s permission first.</p>
                  {idScan && <div className={`staff-id-scan-result ${idScan.error || !identityScanVerified ? "is-warning" : ""}`} role={idScan.error || !identityScanVerified ? "alert" : "status"}>
                    {idScan.error || (idScan.face_match === "rejected" ? "The face on this ID does not match the staff photo. Check the images and try again." : manualTypeReviewAvailable ? "Face comparison passed. OCR could not identify this ID type; compare it manually in the details review." : idScan.outcome !== "match" ? "The ID type could not be verified. Use a clearer image and scan again." : idScan.face_match !== "matched" ? "Face comparison is unavailable. Please try again." : "ID type and face matched. Review the ID details to enable account creation.")}
                  </div>}
                  <div className="staff-id-popup-actions">
                    <button type="button" className="btn btn-outline" disabled={idScanning} onClick={() => setIdPopupOpen(false)}>Done</button>
                    <button type="button" className="btn btn-primary" disabled={!identityFiles.id_front || idScanning} onClick={() => void scanId()}>{idScanning ? "Scanning ID…" : "Scan ID and face"}</button>
                  </div>
            </div>
          </section>
        </div>
      )}

      {createOpen && faceCameraOpen && (
        <div className="modal-backdrop staff-face-popup-backdrop">
          <section className="modal staff-face-popup" role="dialog" aria-modal="true" aria-label={retakePose === null ? "Register face" : "Retake face photo"}>
            <StaffFaceCamera initialStep={retakePose ?? 0} singlePose={retakePose !== null} completedPoses={Object.keys(guidedPoses).filter((key) => guidedPoses[key])} onClose={() => setFaceCameraOpen(false)} onCapture={(key, file) => { setIdScan(null); setNewIdDetailsReady(false); setIdentityFiles((current) => ({ ...current, [key]: file })); setGuidedPoses((current) => ({ ...current, [key]: true })); }} />
          </section>
        </div>
      )}

      {createOpen && newIdReviewOpen && (
        <div className="modal-backdrop staff-face-popup-backdrop" style={{ zIndex: 1101 }}>
          <section className="modal staff-id-popup" role="dialog" aria-modal="true" aria-label="Review ID details">
            <div className="modal-head"><h2>ID review — {accountForm.name}</h2><button type="button" onClick={() => setNewIdReviewOpen(false)} aria-label="Close ID review">×</button></div>
            <div className="modal-body staff-id-popup-body">
              <p>Awaiting review · {identityType.replaceAll("_", " ")}</p>
              <div className="staff-create-grid">{([["id_front", "Front of ID"], ["id_back", "Back of ID"]] as const).map(([key, label]) => <div className="staff-identity-id-side" key={key}><strong>{label}</strong>{identityFiles[key] ? <StaffFacePhotoPreview file={identityFiles[key]!} label={label} /> : <p>Not provided</p>}</div>)}</div>
              <div className="staff-identity-group">
                <h4>Review ID details</h4><p>Check OCR suggestions against the document and correct any mistakes. A date shown as required must be readable from the ID.</p>
                <label className="field"><span className="label">Name on ID (required)</span><input className="input" maxLength={120} value={newIdDetails.name} onChange={(e) => { setNewIdDetailsReady(false); setNewIdDetails((current) => ({ ...current, name: e.target.value })); }} /></label>
                <label className="field"><span className="label">ID number (required)</span><input className="input" maxLength={80} value={newIdDetails.number} onChange={(e) => { setNewIdDetailsReady(false); setNewIdDetails((current) => ({ ...current, number: e.target.value })); }} /></label>
                <label className="field"><span className="label">Date of birth (if shown)</span><input className="input" type="date" value={newIdDetails.birth_date} onChange={(e) => { setNewIdDetailsReady(false); setNewIdDetails((current) => ({ ...current, birth_date: e.target.value })); }} /></label>
                <label className="field"><span className="label">Expiration date{staffIdRequiresExpirationDate(identityType) ? " (required)" : " (if shown)"}</span><input className="input" type="date" required={staffIdRequiresExpirationDate(identityType)} value={newIdDetails.expiration_date} onChange={(e) => { setNewIdDetailsReady(false); setNewIdDetails((current) => ({ ...current, expiration_date: e.target.value })); }} /></label>
              </div>
              <div className="staff-identity-group">
                <h4>ID checks</h4>
                <p>Every check must pass before these details can be used to create the account.</p>
                <div className="staff-id-checks">
                  {[
                    ["ID type", idScan?.outcome === "match" || (identityType === "other" && idScan?.outcome === "uncertain" && newIdDetailsReady) ? staffIdCheckLabel("pass") : idScan?.outcome === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ["Details reviewed", newIdDetailsReady ? staffIdCheckLabel("pass") : staffIdCheckLabel("unknown")],
                    ["Face comparison", idScan?.face_match === "matched" ? staffIdCheckLabel("pass") : idScan?.face_match === "rejected" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ["Duplicate ID", newIdDuplicate === "checking" ? "Checking…" : staffIdCheckLabel(newIdDuplicate === "unique" ? "pass" : newIdDuplicate === "duplicate" ? "problem" : "unknown")],
                    ["Name on ID", checkStaffIdName(newIdDetails.name, accountForm.name) === "pass" ? staffIdCheckLabel("pass") : checkStaffIdName(newIdDetails.name, accountForm.name) === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ["Date of birth", checkStaffIdBirthDate(newIdDetails.birth_date) === "pass" ? staffIdCheckLabel("pass") : staffIdCheckLabel("problem")],
                    ["ID number format", checkStaffIdNumber(newIdDetails.number, identityType) === "pass" ? staffIdCheckLabel("pass") : checkStaffIdNumber(newIdDetails.number, identityType) === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                    ["Expiration date", checkStaffIdExpiration(newIdDetails.expiration_date, identityType) === "pass" ? staffIdCheckLabel("pass") : checkStaffIdExpiration(newIdDetails.expiration_date, identityType) === "mismatch" ? staffIdCheckLabel("problem") : staffIdCheckLabel("check")],
                  ].map(([label, status]) => <div className="staff-id-check" key={label}><strong>{label}</strong><span>{status}</span></div>)}
                </div>
                {newIdDuplicate === "duplicate" && <p className="field-error" role="alert">This ID number is already attached to another staff account.</p>}
                {identityType === "other" && <p>OCR could not identify this ID type. Compare the document manually; a detected mismatch cannot be overridden.</p>}
                <label className="field"><span><input type="checkbox" checked={newIdDetailsReady} onChange={(event) => setNewIdDetailsReady(event.target.checked)} /> I compared the ID type and details with the document, including the expiration date if present.</span></label>
                <p>Automated checks do not prove that the ID is authentic.</p>
              </div>
              <div className="staff-id-popup-actions"><button type="button" className="btn btn-outline" onClick={() => setNewIdReviewOpen(false)}>Back</button><button type="button" className="btn btn-primary" disabled={!identityScanVerified || !newIdDetailsReady || !idDetailsValid || newIdDuplicate !== "unique"} onClick={() => { setNewIdReviewOpen(false); setIdPopupOpen(false); }}>Use these details</button></div>
            </div>
          </section>
        </div>
      )}

      {createdCredentials && (
        <div className="modal-backdrop">
          <section className="modal staff-credentials-modal" role="dialog" aria-modal="true" aria-labelledby="staff-credentials-title">
            <div className="modal-head">
              <div><span className="eyebrow">Account created</span><h2 id="staff-credentials-title">Share sign-in details</h2></div>
              <button type="button" aria-label="Close credentials" onClick={() => setCreatedCredentials(null)}><Icon name="x" /></button>
            </div>
            <div className="modal-body">
              <p>Save these details for {createdCredentials.name} now. The password will not be shown again after you close this card.</p>
              <div className="field"><label className="label" htmlFor="created-username">Username</label><input id="created-username" className="input" readOnly value={createdCredentials.username} /></div>
              <div className="field"><label className="label" htmlFor="created-password">Temporary password</label><input id="created-password" className="input" type={showCreatedPassword ? "text" : "password"} readOnly value={createdCredentials.password} /><button type="button" className="btn btn-outline btn-sm" onClick={() => setShowCreatedPassword((shown) => !shown)}>{showCreatedPassword ? "Hide password" : "Show password"}</button></div>
              <p>Share these details privately. Staff can change their password in My profile.</p>
              <button type="button" className="btn btn-primary" onClick={() => setCreatedCredentials(null)}>Done</button>
            </div>
          </section>
        </div>
      )}

      {viewingProfile && (
        <div className="modal-backdrop">
          <section
            className="modal account-profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-profile-title"
          >
            <div className="modal-head account-profile-modal-head">
              <div className="account-profile-identity">
                <span className="avatar account-profile-avatar">
                  {viewingProfile.name
                    .split(" ")
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <div>
                  <span className="eyebrow">Team account</span>
                  <h2 id="account-profile-title">{viewingProfile.name}</h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingProfile(null)}
                aria-label="Close profile"
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body account-profile-body">
              <div
                className={`account-profile-sidebar${
                  showDailyDetails ? " is-showing-day-details" : ""
                }`}
              >
                <div className="account-profile-info">
                  <div className="account-profile-badges">
                    <span
                      className={`badge ${
                        viewingProfile.role === "admin" ? "badge-dark" : "badge-cream"
                      }`}
                    >
                      {viewingProfile.role === "admin" ? "Administrator" : "Staff"}
                    </span>
                    <span
                      className={`badge ${
                        viewingProfile.is_active === 0 ? "badge-red" : "badge-green"
                      }`}
                    >
                      {viewingProfile.is_active === 0 ? "Inactive" : "Active"}
                    </span>
                  </div>
                  <div className="account-profile-details">
                    <div>
                      <span>Login username</span>
                      <strong>{viewingProfile.username}</strong>
                    </div>
                    <div>
                      <span>Email address</span>
                      <strong>{viewingProfile.email || "Not set"}</strong>
                    </div>
                    <div>
                      <span>Contact number</span>
                      <strong>{viewingProfile.contact_number || "Not provided"}</strong>
                    </div>
                    <div>
                      <span>Scheduled duty hours</span>
                      <strong>{viewingProfile.duty_hours || "Not provided"}</strong>
                    </div>
                    <div>
                      <span>Address</span>
                      <strong>{viewingProfile.address || "Not provided"}</strong>
                    </div>
                    <div>
                      <span>Account created</span>
                      <strong>{viewingProfile.created_at || "Not available"}</strong>
                    </div>
                  </div>
                  {viewingProfile.role === "staff" && <StaffExistingIdentity key={`identity-${viewingProfile.id}`} userId={viewingProfile.id} name={viewingProfile.name} />}
                  {viewingProfile.role === "staff" && <StaffFaceStatus key={`face-status-${viewingProfile.id}`} userId={viewingProfile.id} />}
                  <div className="account-profile-actions">
                    <span className="eyebrow">Account actions</span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openEdit(viewingProfile)}
                    >
                      <Icon name="edit" size={16} />
                      Edit account
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => openAccountAction(viewingProfile, "reset-password")}
                    >
                      <Icon name="lock" size={16} />
                      Reset password
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() =>
                        openAccountAction(
                          viewingProfile,
                          viewingProfile.is_active === 0 ? "activate" : "deactivate"
                        )
                      }
                    >
                      <Icon
                        name={viewingProfile.is_active === 0 ? "check" : "x"}
                        size={16}
                      />
                      {viewingProfile.is_active === 0
                        ? "Activate account"
                        : "Deactivate account"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => openAccountAction(viewingProfile, "remove")}
                    >
                      <Icon name="trash" size={16} />
                      Remove account
                    </button>
                  </div>
                </div>
                <div
                  className="staff-day-details"
                  aria-hidden={!showDailyDetails}
                >
                  <div className="staff-day-details-head">
                    <button
                      type="button"
                      className="staff-day-details-back"
                      onClick={() => setShowDailyDetails(false)}
                      aria-label="Back to staff information"
                      title="Back to staff information"
                    >
                      <Icon name="chevron-left" size={17} />
                    </button>
                    <div>
                      <span className="eyebrow">Daily details</span>
                      <strong>{profileDate}</strong>
                    </div>
                  </div>
                  {dailyHistoryError ? (
                    <div className="error-strip" role="alert">
                      {dailyHistoryError}
                    </div>
                  ) : dailyHistoryLoading ? (
                    <div className="staff-history-loading">
                      <span className="spinner" /> Loading this day…
                    </div>
                  ) : dailyHistory ? (
                    <>
                      <div className="staff-history-metrics">
                        <div>
                          <span>Total duty</span>
                          <strong>{dutyDuration(dailyHistory.attendance.duty_minutes)}</strong>
                        </div>
                        <div>
                          <span>First sign in</span>
                          <strong>{firstDailyLogin ? clockTime(firstDailyLogin) : "—"}</strong>
                        </div>
                        <div>
                          <span>Last sign out</span>
                          <strong>
                            {isOnDuty
                              ? "Currently on duty"
                              : lastDailyLogout
                                ? clockTime(lastDailyLogout)
                                : "—"}
                          </strong>
                        </div>
                        <div>
                          <span>Sales by this staff</span>
                          <strong>{peso(dailyHistory.sales.amount)}</strong>
                          <small>{dailyHistory.sales.transactions} payment(s)</small>
                        </div>
                        <div>
                          <span>Total café sales</span>
                          <strong>{peso(dailyHistory.daySales.amount)}</strong>
                          <small>{dailyHistory.daySales.transactions} payment(s)</small>
                        </div>
                      </div>
                      <div className="staff-activity-timeline">
                        <div className="staff-activity-timeline-head">
                          <div>
                            <strong>Shift activity</strong>
                            <p>Actions recorded on {profileDate}</p>
                          </div>
                          <span>
                            {dailyHistory.activity.length}{" "}
                            {dailyHistory.activity.length === 1 ? "action" : "actions"}
                          </span>
                        </div>
                        {dailyHistory.activity.length ? (
                          <ol>
                            {dailyHistory.activity.map((entry) => (
                              <li key={entry.id}>
                                <time>{clockTime(entry.created_at)}</time>
                                <span className="staff-activity-marker" aria-hidden="true" />
                                <div>
                                  <div className="staff-activity-entry-labels">
                                    <span>{entry.area}</span>
                                    <small>{entry.action.replace(/[._]/g, " ")}</small>
                                  </div>
                                  <p>{entry.summary}</p>
                                </div>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p className="staff-activity-empty">
                            No staff actions were recorded for this date.
                          </p>
                        )}
                      </div>
                      {missingSignOut && (
                        <>
                          <div className="staff-attendance-warning" role="status">
                            Sign-out was not recorded for this day. The displayed duty time may be incomplete.
                            <button
                              type="button"
                              className="btn btn-outline staff-attendance-correct-button"
                              onClick={() => setAttendanceCorrectionOpen((open) => !open)}
                            >
                              {attendanceCorrectionOpen
                                ? "Cancel correction"
                                : "Record sign-out"}
                            </button>
                          </div>
                          {attendanceCorrectionOpen && (
                            <div className="staff-attendance-correction">
                              <p>
                                Enter the staff member&apos;s actual sign-out time.
                                This correction is recorded in the admin activity log.
                              </p>
                              <div className="field">
                                <label className="label" htmlFor="attendance-correction-time">
                                  Sign-out time
                                </label>
                                <input
                                  id="attendance-correction-time"
                                  className="input"
                                  type="time"
                                  value={attendanceCorrectionTime}
                                  onChange={(event) =>
                                    setAttendanceCorrectionTime(event.target.value)
                                  }
                                  required
                                />
                              </div>
                              <div className="field">
                                <label className="label" htmlFor="attendance-correction-reason">
                                  Reason
                                </label>
                                <textarea
                                  id="attendance-correction-reason"
                                  className="input"
                                  value={attendanceCorrectionReason}
                                  onChange={(event) =>
                                    setAttendanceCorrectionReason(event.target.value)
                                  }
                                  minLength={3}
                                  maxLength={500}
                                  required
                                />
                              </div>
                              <div className="field">
                                <label className="label" htmlFor="attendance-correction-password">
                                  Administrator password
                                </label>
                                <input
                                  id="attendance-correction-password"
                                  className="input"
                                  type="password"
                                  autoComplete="current-password"
                                  value={attendanceCorrectionPassword}
                                  onChange={(event) =>
                                    setAttendanceCorrectionPassword(event.target.value)
                                  }
                                  required
                                />
                              </div>
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => void correctMissingSignOut()}
                                disabled={savingAttendanceCorrection}
                              >
                                {savingAttendanceCorrection
                                  ? <LoadingDots label="Saving correction" />
                                  : "Confirm sign-out"}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                      <div className="staff-history-sessions">
                        {dailySessions.length ? (
                          dailySessions.map((session) => (
                            <div key={`${session.id}-${profileDate}`}>
                              <span>Daily attendance</span>
                              <strong>
                                {session.login_at
                                  ? clockTime(session.login_at)
                                  : "No sign-in time"}
                                {" – "}
                                {session.logout_at
                                  ? clockTime(session.logout_at)
                                  : "In progress"}
                              </strong>
                              <small>{dutyDuration(session.duty_minutes)}</small>
                            </div>
                          ))
                        ) : (
                          <p>No attendance recorded for this date.</p>
                        )}
                      </div>
                      <p className="staff-history-note">
                        Staff sales only include payments verified while this account was on duty.
                        Older payments without a recorded verifier are excluded.
                      </p>
                    </>
                  ) : null}
                </div>
              </div>
              <section className="staff-daily-history" aria-labelledby="staff-history-title">
                <div className="staff-daily-history-head">
                  <div>
                    <span className="eyebrow">Daily activity</span>
                    <h3 id="staff-history-title">Attendance &amp; sales</h3>
                  </div>
                  <button
                    type="button"
                    className="staff-history-refresh"
                    onClick={() => setHistoryRevision((revision) => revision + 1)}
                    aria-label="Refresh attendance and sales"
                    title="Refresh attendance and sales"
                  >
                    <Icon name="refresh" size={15} />
                    Refresh
                  </button>
                </div>
                {!matchingMonthHistory ? (
                  dailyHistoryError ? (
                    <div className="error-strip" role="alert">{dailyHistoryError}</div>
                  ) : (
                    <div className="staff-history-loading">
                      <span className="spinner" /> Loading calendar…
                    </div>
                  )
                ) : (
                  <>
                    <div className="staff-calendar" aria-label="Staff attendance calendar">
                      <div className="staff-calendar-toolbar">
                        <button
                          type="button"
                          className="staff-calendar-arrow"
                          onClick={() => moveProfileMonth(-1)}
                          disabled={Boolean(createdMonth && profileMonth <= createdMonth)}
                          aria-label="Previous month"
                        >
                          <Icon name="chevron-left" size={16} />
                        </button>
                        <strong>{monthLabel(profileMonth)}</strong>
                        <button
                          type="button"
                          className="staff-calendar-arrow"
                          onClick={() => moveProfileMonth(1)}
                          disabled={profileMonth >= currentMonth}
                          aria-label="Next month"
                        >
                          <Icon name="chevron-right" size={16} />
                        </button>
                      </div>
                      <div className="staff-calendar-grid staff-calendar-weekdays" aria-hidden="true">
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
                          <span key={weekday}>{weekday}</span>
                        ))}
                      </div>
                      <div className="staff-calendar-grid">
                        {monthCells.map((day, index) => {
                          if (day === null) {
                            return <span className="staff-calendar-empty" key={`empty-${index}`} />;
                          }
                          const date = `${profileMonth}-${String(day).padStart(2, "0")}`;
                          const attendance = calendarAttendance.get(date);
                          const onDutyToday =
                            date === todayDate && Boolean(matchingMonthHistory?.onDutyToday);
                          const disabled =
                            date > todayDate || Boolean(createdDate && date < createdDate);
                          return (
                            <button
                              type="button"
                              key={date}
                              className={`staff-calendar-day${
                                profileDate === date ? " is-selected" : ""
                              }${attendance ? " has-duty" : ""}`}
                              onClick={() => {
                                setProfileDate(date);
                                clearAttendanceCorrection();
                              }}
                              onDoubleClick={() => {
                                setProfileDate(date);
                                clearAttendanceCorrection();
                                setShowDailyDetails(true);
                              }}
                              disabled={disabled}
                              aria-pressed={profileDate === date}
                              aria-label={`${monthLabel(profileMonth).split(" ")[0]} ${day}${
                                attendance ? `, present ${dutyDuration(attendance.duty_minutes)}` : ""
                              }${onDutyToday ? ", currently on duty" : ""}`}
                              title={
                                [
                                  attendance
                                    ? `Present · ${dutyDuration(attendance.duty_minutes)}`
                                    : "",
                                  onDutyToday ? "Currently on duty" : "",
                                ]
                                  .filter(Boolean)
                                  .join(" · ") || undefined
                              }
                            >
                              <span>{day}</span>
                              {attendance && <i className="staff-calendar-dot" aria-hidden="true" />}
                              {onDutyToday && (
                                <span className="staff-calendar-pin" aria-hidden="true">
                                  <Icon name="map-pin" size={12} />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="staff-calendar-legend">
                        <span><i className="staff-calendar-dot" aria-hidden="true" /> Present</span>
                        {matchingMonthHistory?.onDutyToday && (
                          <span>
                            <Icon name="map-pin" size={11} />
                            On duty now
                          </span>
                        )}
                        <span>{profileDate}</span>
                      </div>
                      <p className="staff-calendar-hint">
                        Double-click a date to open its monthly summary and shift details.
                      </p>
                    </div>
                    {matchingMonthHistory && (
                      <div className="staff-month-summary">
                        <div className="staff-month-summary-head">
                          <div>
                            <span className="eyebrow">Monthly summary</span>
                            <strong>{monthLabel(profileMonth)}</strong>
                          </div>
                          <span>{matchingMonthHistory.monthSummary.duty_days} days on duty</span>
                        </div>
                        <div className="staff-month-summary-grid">
                          <div>
                            <span>Total duty time</span>
                            <strong>
                              {clockDuration(matchingMonthHistory.monthSummary.duty_minutes)}
                            </strong>
                          </div>
                          <div>
                            <span>Staff sales</span>
                            <strong>{peso(matchingMonthHistory.monthSummary.staff_sales)}</strong>
                            <small>
                              {matchingMonthHistory.monthSummary.staff_sales_transactions} payments
                            </small>
                          </div>
                          <div>
                            <span>Café sales</span>
                            <strong>{peso(matchingMonthHistory.monthSummary.cafe_sales)}</strong>
                            <small>
                              {matchingMonthHistory.monthSummary.cafe_sales_transactions} payments
                            </small>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          </section>
        </div>
      )}

      {accountAction && (
        <div className="modal-backdrop">
          <section
            className="modal account-action-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-action-title"
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">Sensitive account action</span>
                <h2 id="account-action-title">
                  {accountAction.action === "remove"
                    ? "Remove account"
                    : accountAction.action === "deactivate"
                      ? "Deactivate account"
                      : accountAction.action === "activate"
                        ? "Activate account"
                        : "Reset password"}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeAccountAction}
                aria-label="Close confirmation"
                disabled={savingAction}
              >
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              <p>
                Confirm this action for <strong>{accountAction.user.name}</strong>.
                A reason and your administrator password are required and will be
                recorded in the activity log.
              </p>
              {accountAction.action === "remove" && (
                <p className="account-action-warning">
                  This permanently removes the account. Past activity records
                  remain in the system.
                </p>
              )}
              <div className="field">
                <label className="label" htmlFor="account-action-reason">Reason</label>
                <textarea
                  id="account-action-reason"
                  className="input"
                  value={actionReason}
                  onChange={(event) => setActionReason(event.target.value)}
                  minLength={3}
                  maxLength={500}
                  required
                />
              </div>
              {accountAction.action === "reset-password" && (
                <div className="field">
                  <label className="label" htmlFor="account-action-new-password">New password</label>
                  <input
                    id="account-action-new-password"
                    className="input"
                    type="password"
                    autoComplete="new-password"
                    value={actionNewPassword}
                    onChange={(event) => setActionNewPassword(event.target.value)}
                    minLength={6}
                    required
                  />
                </div>
              )}
              <div className="field">
                <label className="label" htmlFor="account-action-admin-password">
                  Your administrator password
                </label>
                <input
                  id="account-action-admin-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={actionConfirmationPassword}
                  onChange={(event) => setActionConfirmationPassword(event.target.value)}
                  required
                />
              </div>
              <div className="flex-row" style={{ gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={closeAccountAction}
                  disabled={savingAction}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={accountAction.action === "remove" ? "btn btn-danger" : "btn btn-primary"}
                  onClick={() => void confirmAccountAction()}
                  disabled={savingAction}
                >
                  {savingAction ? <LoadingDots label="Confirming" /> : "Confirm action"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop">
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>Edit account</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label className="label" htmlFor="edit-name">Full name</label>
                <input
                  id="edit-name"
                  className="input"
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="edit-username">Login username</label>
                <input
                  id="edit-username"
                  className="input"
                  value={editForm.username}
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      username: event.target.value,
                    }))
                  }
                  autoComplete="username"
                  maxLength={80}
                  required
                />
                <span className="tiny">
                  This is the username the staff member uses to sign in.
                </span>
              </div>
              <div className="field">
                <label className="label" htmlFor="edit-email">Recovery email (required)</label>
                <input
                  id="edit-email"
                  className="input"
                  type="email"
                  value={editForm.email}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, email: event.target.value }))
                  }
                  autoComplete="email"
                  maxLength={254}
                  required
                />
                <span className="tiny">
                  Used for account contact and password recovery.
                </span>
              </div>
              <div className="field">
                <label className="label" htmlFor="edit-contact-number">Contact number</label>
                <input
                  id="edit-contact-number"
                  className="input"
                  type="tel"
                  maxLength={40}
                  value={editForm.contact_number}
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      contact_number: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <span className="label">Scheduled duty hours</span>
                <div className="staff-duty-hours-inputs">
                  <div className="field">
                    <label className="label" htmlFor="edit-duty-start">Start time</label>
                    <DutyTimePicker id="edit-duty-start" value={editDutyHours.start} validate={(value) => editDutyHours.end && value >= editDutyHours.end ? "Start time must be earlier than end time." : null} onChange={(value) => setEditDutyHours((current) => ({ ...current, start: value }))} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="edit-duty-end">End time</label>
                    <DutyTimePicker id="edit-duty-end" value={editDutyHours.end} validate={(value) => editDutyHours.start && value <= editDutyHours.start ? "End time must be later than start time." : null} onChange={(value) => setEditDutyHours((current) => ({ ...current, end: value }))} />
                  </div>
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="edit-address">Address</label>
                <textarea
                  id="edit-address"
                  className="input"
                  rows={2}
                  maxLength={500}
                  value={editForm.address}
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      address: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="edit-role">Role</label>
                <select
                  id="edit-role"
                  className="select"
                  value={editForm.role}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, role: event.target.value }))
                  }
                >
                  <option value="staff">Staff</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="edit-password">New password (optional)</label>
                <input
                  id="edit-password"
                  className="input"
                  type="text"
                  value={editForm.password}
                  onChange={(event) =>
                    setEditForm((current) => ({ ...current, password: event.target.value }))
                  }
                  placeholder="Leave blank to keep current password"
                />
              </div>
              <div className="field">
                <label className="checkline">
                  <input
                    type="checkbox"
                    checked={editForm.is_active}
                    onChange={(event) =>
                      setEditForm((current) => ({ ...current, is_active: event.target.checked }))
                    }
                  />
                  Account active
                </label>
              </div>
              <div className="account-security-fields" role="note">
                <p>
                  You are editing {editing.name}&apos;s staff account. Every change
                  requires a reason and is recorded in the activity log.
                </p>
                <div className="field">
                  <label className="label" htmlFor="edit-security-reason">Reason for this edit</label>
                  <textarea
                    id="edit-security-reason"
                    className="input"
                    value={editReason}
                    onChange={(event) => setEditReason(event.target.value)}
                    minLength={3}
                    maxLength={500}
                    required
                  />
                </div>
                {editRequiresConfirmation && (
                  <div className="field">
                    <label className="label" htmlFor="edit-confirmation-password">
                      Administrator password confirmation
                    </label>
                    <input
                      id="edit-confirmation-password"
                      className="input"
                      type="password"
                      autoComplete="current-password"
                      value={editConfirmationPassword}
                      onChange={(event) => setEditConfirmationPassword(event.target.value)}
                      required
                    />
                  </div>
                )}
              </div>
              <div className="flex-row" style={{ gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-outline" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={savingEdit || !editHasChanges}
                  onClick={saveEdit}
                >
                  {savingEdit ? <LoadingDots label="Saving" /> : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editConfirmationOpen && editing && (
        <div className="modal-backdrop">
          <section
            className="modal account-action-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-confirmation-title"
            aria-describedby="edit-confirmation-description"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setEditConfirmationOpen(false);
                return;
              }
              if (event.key !== "Tab") return;
              const focusable =
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), summary'
                );
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (!first) {
                event.preventDefault();
                editConfirmationCancelRef.current?.focus();
              } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">Review account change</span>
                <h2 id="edit-confirmation-title">Confirm changes</h2>
              </div>
            </div>
            <div className="modal-body">
              <p id="edit-confirmation-description">
                Save these changes to <strong>{editing.name}</strong>&apos;s staff
                account? Your reason will be recorded in the activity log.
              </p>
              <div className="account-security-fields">
                <strong>Reason</strong>
                <p>{editReason.trim()}</p>
              </div>
            </div>
            <div className="modal-foot">
              <button
                ref={editConfirmationCancelRef}
                type="button"
                className="btn btn-outline"
                onClick={() => setEditConfirmationOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savingEdit}
                onClick={() => void saveEdit()}
              >
                Confirm changes
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
