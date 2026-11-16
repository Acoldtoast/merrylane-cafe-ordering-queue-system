"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icons";
import { LoadingDots } from "@/components/LoadingDots";
import { PortalPageSkeleton } from "@/components/PortalPageSkeleton";
import { SkeletonLine } from "@/components/PortalSkeletonPrimitives";
import { MAX_AUTOMATIC_EMAIL_ATTEMPTS } from "@/lib/emailRetryPolicy";
import { fetchPortalApi } from "@/lib/portalPrefetch";

type SettingsTab = "general" | "session" | "email" | "delivery";

type EmailCadence = "off" | "daily" | "weekly" | "monthly";

interface EmailSubscription {
  email: string;
  noStockAlerts: boolean;
  lowStockAlerts: boolean;
  salesCadence: EmailCadence;
  analyticsCadence: EmailCadence;
  reportSendTime: string;
}

interface EmailNotificationConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  fromName: string;
  fromEmail: string;
  subscriptions: EmailSubscription[];
}

interface SmtpCheckResult {
  ok: boolean;
  title?: string;
  fix?: string;
}

interface EmailDeliveryLogEntry {
  id: number;
  recipient_email: string | null;
  subject: string;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  manual_retries: number;
  last_error: {
    title: string;
    details: string | null;
    fix: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_EMAIL_CONFIG: EmailNotificationConfig = {
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: "",
  fromName: "Merrylane Cafe",
  fromEmail: "",
  subscriptions: [],
};

const EMPTY_EMAIL_SUBSCRIPTION: EmailSubscription = {
  email: "",
  noStockAlerts: false,
  lowStockAlerts: false,
  salesCadence: "off",
  analyticsCadence: "off",
  reportSendTime: "08:00",
};

interface AdminSettingsUser {
  id: number;
  name: string;
  username: string;
  role: "admin";
}

interface AdminSettingsProfileResponse {
  user: AdminSettingsUser;
  personal_email: string;
}

const ADMIN_IDLE_TIMEOUT_OPTIONS = [5, 10, 15, 30, 60];
const STAFF_IDLE_TIMEOUT_OPTIONS = [5, 10, 15, 30, 60, 0];

function formatDeliveryTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function AdminSettingsClient() {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [user, setUser] = useState<AdminSettingsUser | null>(null);
  const [name, setName] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");
  const [savedPersonalEmail, setSavedPersonalEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [idleTimeout, setIdleTimeout] = useState(5);
  const [staffIdleTimeout, setStaffIdleTimeout] = useState(15);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(true);
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const [backups, setBackups] = useState<
    { name: string; createdAt: string; size: number }[]
  >([]);
  const [backupBusy, setBackupBusy] = useState(false);
  const [staffIdleWarningMinutes, setStaffIdleWarningMinutes] = useState(10);
  const [staffIdleCountdownSeconds, setStaffIdleCountdownSeconds] = useState(60);
  const [savedSessionSettings, setSavedSessionSettings] = useState({
    idleTimeout: 5,
    staffIdleTimeout: 15,
    staffIdleWarningMinutes: 10,
    staffIdleCountdownSeconds: 60,
  });
  const [emailConfig, setEmailConfig] = useState(DEFAULT_EMAIL_CONFIG);
  const [savedEmailConfig, setSavedEmailConfig] = useState(DEFAULT_EMAIL_CONFIG);
  const [recipientDraft, setRecipientDraft] = useState<EmailSubscription | null>(null);
  const [editingRecipientEmail, setEditingRecipientEmail] = useState<string | null>(null);
  const [recipientError, setRecipientError] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpPasswordConfigured, setSmtpPasswordConfigured] = useState(false);
  const [smtpCheckResult, setSmtpCheckResult] = useState<SmtpCheckResult | null>(null);
  const [smtpNoticeVisible, setSmtpNoticeVisible] = useState(false);
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailSaving, setEmailSaving] = useState(false);
  const [smtpChecking, setSmtpChecking] = useState(false);
  const [deliveryLog, setDeliveryLog] = useState<EmailDeliveryLogEntry[]>([]);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryHasMore, setDeliveryHasMore] = useState(false);
  const [deliveryBefore, setDeliveryBefore] = useState<number | null>(null);
  const [deliveryError, setDeliveryError] = useState("");
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<number | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadEmailDeliveryLog = useCallback(
    async (before?: number, append = false) => {
      setDeliveryLoading(true);
      setDeliveryError("");
      try {
        const params = new URLSearchParams({ limit: "30" });
        if (before !== undefined) params.set("before", String(before));
        const response = await fetchPortalApi(
          `/api/admin/email-delivery?${params.toString()}`,
          { cache: "no-store" }
        );
        const data = (await response.json()) as {
          success?: boolean;
          error?: string;
          items?: EmailDeliveryLogEntry[];
          hasMore?: boolean;
          nextBefore?: number | null;
        };
        const items = data.items;
        if (!response.ok || !data.success || !Array.isArray(items)) {
          throw new Error(data.error || "Could not load the email delivery log.");
        }
        setDeliveryLog((current) =>
          append ? [...current, ...items] : items
        );
        setDeliveryHasMore(Boolean(data.hasMore));
        setDeliveryBefore(
          typeof data.nextBefore === "number" ? data.nextBefore : null
        );
      } catch (loadError: unknown) {
        setDeliveryError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load the email delivery log."
        );
      } finally {
        setDeliveryLoading(false);
      }
    },
    []
  );

  const retryEmailDelivery = async (id: number) => {
    setRetryingDeliveryId(id);
    setDeliveryError("");
    try {
      const response = await fetchPortalApi("/api/admin/email-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry", id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not queue the email for retry.");
      }
      setDeliveryLog((current) =>
        current.map((entry) =>
          entry.id === id
            ? {
                ...entry,
                status: "pending",
                attempts: 0,
                manual_retries: entry.manual_retries + 1,
              }
            : entry
        )
      );
      setNotice("Email queued for retry.");
    } catch (retryError: unknown) {
      setDeliveryError(
        retryError instanceof Error
          ? retryError.message
          : "Could not queue the email for retry."
      );
    } finally {
      setRetryingDeliveryId(null);
    }
  };

  useEffect(() => {
    if (!smtpNoticeVisible) return;
    const timer = window.setTimeout(() => setSmtpNoticeVisible(false), 60_000);
    return () => window.clearTimeout(timer);
  }, [smtpNoticeVisible]);

  useEffect(() => {
    let active = true;
    fetchPortalApi("/api/admin/email-settings", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not load email settings.");
        }
        if (!active) return;
        const config = data.config as EmailNotificationConfig;
        setEmailConfig(config);
        setSavedEmailConfig(config);
        setSmtpPasswordConfigured(Boolean(data.smtp_password_configured));
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load email settings."
          );
        }
      })
      .finally(() => {
        if (active) setEmailLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const emailSmtpDirty =
    JSON.stringify({
      smtpHost: emailConfig.smtpHost,
      smtpPort: emailConfig.smtpPort,
      smtpSecure: emailConfig.smtpSecure,
      smtpUser: emailConfig.smtpUser,
      fromName: emailConfig.fromName,
      fromEmail: emailConfig.fromEmail,
    }) !==
      JSON.stringify({
        smtpHost: savedEmailConfig.smtpHost,
        smtpPort: savedEmailConfig.smtpPort,
        smtpSecure: savedEmailConfig.smtpSecure,
        smtpUser: savedEmailConfig.smtpUser,
        fromName: savedEmailConfig.fromName,
        fromEmail: savedEmailConfig.fromEmail,
      }) || smtpPassword.length > 0;
  const emailRecipientsDirty =
    JSON.stringify(emailConfig.subscriptions) !==
    JSON.stringify(savedEmailConfig.subscriptions);
  const recipientDraftDirty =
    recipientDraft !== null &&
    (editingRecipientEmail === null ||
      JSON.stringify(recipientDraft) !==
        JSON.stringify(
          emailConfig.subscriptions.find(
            (subscription) => subscription.email === editingRecipientEmail
          )
        ));
  const generalSettingsDirty = Boolean(
    user &&
      (name !== user.name ||
        personalEmail !== savedPersonalEmail ||
        newPassword.length > 0)
  );
  const sessionSettingsDirty =
    JSON.stringify({
      idleTimeout,
      staffIdleTimeout,
      staffIdleWarningMinutes,
      staffIdleCountdownSeconds,
    }) !== JSON.stringify(savedSessionSettings);
  const smtpSetupIssues: string[] = [];
  if (!emailConfig.smtpHost.trim()) smtpSetupIssues.push("Enter the SMTP host.");
  if (!emailConfig.fromEmail.trim()) smtpSetupIssues.push("Enter the sender email address.");
  if (emailConfig.smtpUser.trim() && !smtpPasswordConfigured && !smtpPassword) {
    smtpSetupIssues.push("Enter and save the SMTP account password.");
  }
  const emailStatusLabel = emailLoading
    ? "Loading"
    : smtpChecking
    ? "Checking"
    : smtpCheckResult
      ? smtpCheckResult.ok
        ? "Connected"
        : "Connection failed"
      : emailSmtpDirty
        ? "Save SMTP changes"
        : smtpSetupIssues.length > 0
          ? "Needs setup"
          : "Not tested";
  const emailStatusTone = emailLoading
    ? "neutral"
    : smtpChecking
    ? "warning"
    : smtpCheckResult
      ? smtpCheckResult.ok
        ? "success"
        : "error"
      : emailSmtpDirty || smtpSetupIssues.length > 0
        ? "warning"
        : "neutral";

  useEffect(() => {
    let active = true;
    fetchPortalApi("/api/admin/settings", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Could not load admin settings.");
        }
        if (!active) return;
        const profile = data as AdminSettingsProfileResponse;
        setUser(profile.user);
        setName(profile.user.name);
        setPersonalEmail(profile.personal_email);
        setSavedPersonalEmail(profile.personal_email);
        const nextSessionSettings = {
          idleTimeout: ADMIN_IDLE_TIMEOUT_OPTIONS.includes(data.idle_timeout_minutes)
            ? data.idle_timeout_minutes
            : 5,
          staffIdleTimeout: STAFF_IDLE_TIMEOUT_OPTIONS.includes(
            data.staff_idle_timeout_minutes
          )
            ? data.staff_idle_timeout_minutes
            : 15,
          staffIdleWarningMinutes: Number.isFinite(data.staff_idle_warning_minutes)
            ? data.staff_idle_warning_minutes
            : 10,
          staffIdleCountdownSeconds: Number.isFinite(
            data.staff_idle_countdown_seconds
          )
            ? data.staff_idle_countdown_seconds
            : 60,
        };
        setIdleTimeout(nextSessionSettings.idleTimeout);
        setStaffIdleTimeout(nextSessionSettings.staffIdleTimeout);
        setStaffIdleWarningMinutes(nextSessionSettings.staffIdleWarningMinutes);
        setStaffIdleCountdownSeconds(
          nextSessionSettings.staffIdleCountdownSeconds
        );
        setSavedSessionSettings(nextSessionSettings);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load admin settings."
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const saveGeneral = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (newPassword && newPassword !== confirmPassword) {
      setError("The new password and confirmation do not match.");
      return;
    }
    if (newPassword && newPassword.trim().length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetchPortalApi("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          personal_email: personalEmail,
          ...(newPassword
            ? {
                current_password: currentPassword,
                new_password: newPassword,
              }
            : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not save account settings.");
      }
      const profile = data as AdminSettingsProfileResponse;
      const updatedUser = profile.user;
      setUser(updatedUser);
      setName(updatedUser.name);
      setPersonalEmail(profile.personal_email);
      setSavedPersonalEmail(profile.personal_email);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      window.dispatchEvent(
        new CustomEvent("portal-profile-updated", {
          detail: { name: updatedUser.name },
        })
      );
      setNotice("Your account settings have been saved.");
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save account settings."
      );
    } finally {
      setSaving(false);
    }
  };

  const saveSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetchPortalApi("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idle_timeout_minutes: idleTimeout,
          staff_idle_timeout_minutes: staffIdleTimeout,
          staff_idle_warning_minutes: staffIdleWarningMinutes,
          staff_idle_countdown_seconds: staffIdleCountdownSeconds,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Could not save session settings.");
      }
      setIdleTimeout(data.idle_timeout_minutes);
      setStaffIdleTimeout(data.staff_idle_timeout_minutes);
      setStaffIdleWarningMinutes(data.staff_idle_warning_minutes);
      setStaffIdleCountdownSeconds(data.staff_idle_countdown_seconds);
      setSavedSessionSettings({
        idleTimeout: data.idle_timeout_minutes,
        staffIdleTimeout: data.staff_idle_timeout_minutes,
        staffIdleWarningMinutes: data.staff_idle_warning_minutes,
        staffIdleCountdownSeconds: data.staff_idle_countdown_seconds,
      });
      localStorage.setItem(
        "merrylane:admin:idle-timeout-minutes",
        String(data.idle_timeout_minutes)
      );
      localStorage.setItem(
        "merrylane:staff:idle-timeout-minutes",
        String(data.staff_idle_timeout_minutes)
      );
      window.dispatchEvent(
        new CustomEvent("admin-idle-timeout-updated", {
          detail: { minutes: data.idle_timeout_minutes },
        })
      );
      window.dispatchEvent(
        new CustomEvent("staff-idle-timeout-updated", {
          detail: { minutes: data.staff_idle_timeout_minutes },
        })
      );
      window.dispatchEvent(
        new CustomEvent("staff-idle-warning-updated", {
          detail: { minutes: data.staff_idle_warning_minutes },
        })
      );
      window.dispatchEvent(
        new CustomEvent("staff-idle-countdown-updated", {
          detail: { seconds: data.staff_idle_countdown_seconds },
        })
      );
      setNotice("Your idle session timeout has been updated.");
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save session settings."
      );
    } finally {
      setSaving(false);
    }
  };

  const persistEmailSettings = async (section: "smtp" | "recipients") => {
    setError("");
    setNotice("");
    setEmailSaving(true);
    try {
      const response = await fetchPortalApi("/api/admin/email-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          section === "smtp"
            ? {
                section,
                smtp_host: emailConfig.smtpHost,
                smtp_port: Number(emailConfig.smtpPort),
                smtp_secure: emailConfig.smtpSecure,
                smtp_user: emailConfig.smtpUser,
                smtp_password: smtpPassword,
                from_name: emailConfig.fromName,
                from_email: emailConfig.fromEmail,
              }
            : {
                section,
                subscriptions: emailConfig.subscriptions,
              }
        ),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            (section === "smtp"
              ? "Could not save SMTP settings."
              : "Could not save email recipients.")
        );
      }
      const savedConfig = data.config as EmailNotificationConfig;
      if (section === "smtp") {
        const savedSmtp = {
          smtpHost: savedConfig.smtpHost,
          smtpPort: savedConfig.smtpPort,
          smtpSecure: savedConfig.smtpSecure,
          smtpUser: savedConfig.smtpUser,
          fromName: savedConfig.fromName,
          fromEmail: savedConfig.fromEmail,
        };
        setEmailConfig((current) => ({ ...current, ...savedSmtp }));
        setSavedEmailConfig((current) => ({ ...current, ...savedSmtp }));
        setSmtpPassword("");
        setSmtpPasswordConfigured(Boolean(data.smtp_password_configured));
      } else {
        setEmailConfig((current) => ({
          ...current,
          subscriptions: savedConfig.subscriptions,
        }));
        setSavedEmailConfig((current) => ({
          ...current,
          subscriptions: savedConfig.subscriptions,
        }));
        setNotice("Email recipients saved.");
      }
      return savedConfig;
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : section === "smtp"
            ? "Could not save SMTP settings."
            : "Could not save email recipients."
      );
      return null;
    } finally {
      setEmailSaving(false);
    }
  };

  const saveSmtpSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const savedConfig = await persistEmailSettings("smtp");
    if (savedConfig) {
      await runSmtpConnectionCheck();
    }
  };

  const saveRecipientSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await persistEmailSettings("recipients");
  };

  const runSmtpConnectionCheck = async () => {
    setError("");
    setNotice("");
    setSmtpNoticeVisible(false);
    if (smtpSetupIssues.length > 0) {
      setSmtpCheckResult({
        ok: false,
        title: smtpSetupIssues[0],
      });
      return;
    }
    setSmtpChecking(true);
    try {
      const response = await fetchPortalApi("/api/admin/email-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify" }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        const diagnosis =
          typeof data.diagnosis === "object" && data.diagnosis !== null
            ? (data.diagnosis as Omit<SmtpCheckResult, "ok">)
            : null;
        setSmtpCheckResult({
          ok: false,
          title: diagnosis?.title || data.error || "The SMTP connection could not be verified.",
          fix: diagnosis?.fix,
        });
        return;
      }
      setSmtpCheckResult({ ok: true });
      setSmtpNoticeVisible(true);
    } catch (testError: unknown) {
      setSmtpCheckResult({
        ok: false,
        title:
          testError instanceof Error
            ? testError.message
            : "The SMTP connection could not be verified.",
        fix: "Check your network connection and SMTP settings.",
      });
    } finally {
      setSmtpChecking(false);
    }
  };

  const updateEmailConfig = <K extends keyof EmailNotificationConfig>(
    key: K,
    value: EmailNotificationConfig[K]
  ) => {
    if (
      key === "smtpHost" ||
      key === "smtpPort" ||
      key === "smtpSecure" ||
      key === "smtpUser" ||
      key === "fromName" ||
      key === "fromEmail"
    ) {
      setSmtpNoticeVisible(false);
    }
    setEmailConfig((current) => ({ ...current, [key]: value }));
  };

  const applySmtpProvider = (host: string) => {
    setSmtpNoticeVisible(false);
    setEmailConfig((current) => ({
      ...current,
      smtpHost: host,
      smtpPort: 587,
      smtpSecure: false,
    }));
  };

  const beginAddRecipient = () => {
    setEditingRecipientEmail(null);
    setRecipientDraft({ ...EMPTY_EMAIL_SUBSCRIPTION });
    setRecipientError("");
  };

  const beginEditRecipient = (subscription: EmailSubscription) => {
    setEditingRecipientEmail(subscription.email);
    setRecipientDraft({ ...subscription });
    setRecipientError("");
  };

  const updateRecipientDraft = <K extends keyof EmailSubscription>(
    key: K,
    value: EmailSubscription[K]
  ) => {
    setRecipientDraft((current) =>
      current ? { ...current, [key]: value } : current
    );
  };

  const saveRecipientDraft = () => {
    if (!recipientDraft) return;
    const email = recipientDraft.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setRecipientError("Enter a valid email address.");
      return;
    }
    if (
      recipientDraft.salesCadence === "off" &&
      recipientDraft.analyticsCadence === "off" &&
      !recipientDraft.noStockAlerts &&
      !recipientDraft.lowStockAlerts
    ) {
      setRecipientError("Choose at least one notification for this email.");
      return;
    }

    const duplicate = emailConfig.subscriptions.some(
      (subscription) =>
        subscription.email !== editingRecipientEmail &&
        subscription.email.toLowerCase() === email
    );
    if (duplicate) {
      setRecipientError("That email address is already in the list.");
      return;
    }
    if (
      editingRecipientEmail === null &&
      emailConfig.subscriptions.length >= 20
    ) {
      setRecipientError("You can add up to 20 email addresses.");
      return;
    }

    const updatedSubscription = { ...recipientDraft, email };
    setEmailConfig((current) => ({
      ...current,
      subscriptions:
        editingRecipientEmail === null
          ? [...current.subscriptions, updatedSubscription]
          : current.subscriptions.map((subscription) =>
              subscription.email === editingRecipientEmail
                ? updatedSubscription
                : subscription
            ),
    }));
    setRecipientDraft(null);
    setEditingRecipientEmail(null);
    setRecipientError("");
    setNotice(
      editingRecipientEmail === null
        ? "Email added. Save recipients to keep this change."
        : "Email updated. Save recipients to keep this change."
    );
  };

  const cancelRecipientEdit = () => {
    setRecipientDraft(null);
    setEditingRecipientEmail(null);
    setRecipientError("");
  };

  const removeRecipient = (email: string) => {
    if (!window.confirm(`Remove ${email} from email notifications?`)) return;
    setEmailConfig((current) => ({
      ...current,
      subscriptions: current.subscriptions.filter(
        (subscription) => subscription.email !== email
      ),
    }));
    if (editingRecipientEmail === email) cancelRecipientEdit();
    setNotice(`${email} removed. Save recipients to keep this change.`);
  };

  if (loading) {
    return <PortalPageSkeleton area="admin" />;
  }

  return (
    <div className="admin-settings-page">
      <div className="admin-settings-tabs admin-tabs" role="tablist" aria-label="Admin settings">
        <button
          type="button"
          className={`admin-tab ${tab === "general" ? "active" : ""}`}
          role="tab"
          id="admin-settings-tab-general"
          aria-selected={tab === "general"}
          aria-controls="admin-settings-panel"
          onClick={() => {
            setTab("general");
            setError("");
            setNotice("");
          }}
        >
          General
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "session" ? "active" : ""}`}
          role="tab"
          id="admin-settings-tab-session"
          aria-selected={tab === "session"}
          aria-controls="admin-settings-panel"
          onClick={() => {
            setTab("session");
            setError("");
            setNotice("");
          }}
        >
          Session
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "email" ? "active" : ""}`}
          role="tab"
          id="admin-settings-tab-email"
          aria-selected={tab === "email"}
          aria-controls="admin-settings-panel"
          onClick={() => {
            setTab("email");
            setError("");
            setNotice("");
          }}
        >
          Email
        </button>
        <button
          type="button"
          className={`admin-tab ${tab === "delivery" ? "active" : ""}`}
          role="tab"
          id="admin-settings-tab-delivery"
          aria-selected={tab === "delivery"}
          aria-controls="admin-settings-panel"
          onClick={() => {
            setTab("delivery");
            setError("");
            setNotice("");
            void loadEmailDeliveryLog();
          }}
        >
          Delivery log
        </button>
      </div>

      {error && <div className="admin-settings-message error" role="alert">{error}</div>}
      {notice && <div className="admin-settings-message success" role="status">{notice}</div>}

      {!user ? (
        <section className="card admin-settings-card">
          <p>Admin account details are unavailable. Refresh the page and try again.</p>
        </section>
      ) : tab === "general" ? (
        <section
          className="card admin-settings-card"
          role="tabpanel"
          id="admin-settings-panel"
          aria-labelledby="admin-settings-tab-general"
        >
          <div className="admin-settings-heading">
            <span className="admin-settings-icon"><Icon name="user" size={20} /></span>
            <div>
              <h2>General</h2>
              <p>Update your administrator profile and password.</p>
            </div>
          </div>

          <form className="admin-settings-form" onSubmit={saveGeneral}>
            <div className="admin-settings-fields">
              <div className="field">
                <label className="label" htmlFor="admin-settings-name">Display name</label>
                <input
                  id="admin-settings-name"
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  required
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="admin-settings-login-username">Admin login username</label>
                <input
                  id="admin-settings-login-username"
                  className="input"
                  value={user.username}
                  autoComplete="username"
                  readOnly
                />
                <span className="tiny">
                  This username is for sign-in. Your personal email is separate and is not used as a login.
                </span>
              </div>
            </div>

            <div className="admin-settings-fields">
              <div className="field">
                <label className="label" htmlFor="admin-settings-personal-email">
                  Personal email
                </label>
                <input
                  id="admin-settings-personal-email"
                  className="input"
                  type="email"
                  value={personalEmail}
                  onChange={(event) => setPersonalEmail(event.target.value)}
                  autoComplete="email"
                  maxLength={254}
                  placeholder="you@example.com"
                  required
                />
                <span className="tiny">
                  All administrator notification emails and password recovery codes are sent here.
                </span>
              </div>
            </div>

            <div className="admin-settings-divider" />
            <div className="admin-settings-subheading">
              <div>
                <h3>Change password</h3>
                <p>Leave the new password blank if you do not want to change it.</p>
              </div>
              <Icon name="lock" size={19} />
            </div>
            <div className="admin-settings-fields">
              <div className="field">
                <label className="label" htmlFor="admin-current-password">Current password</label>
                <div className="password-input-control">
                  <input
                    id="admin-current-password"
                    className="input"
                    type={showCurrentPassword ? "text" : "password"}
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    autoComplete="current-password"
                    required={Boolean(newPassword)}
                  />
                  <button
                    type="button"
                    className="password-input-toggle"
                    aria-label={
                      showCurrentPassword
                        ? "Hide current password"
                        : "Show current password"
                    }
                    aria-pressed={showCurrentPassword}
                    onClick={() =>
                      setShowCurrentPassword((visible) => !visible)
                    }
                    disabled={saving}
                  >
                    <Icon
                      name={showCurrentPassword ? "eye-off" : "eye"}
                      size={18}
                    />
                  </button>
                </div>
              </div>
              <div className="field">
                <label className="label" htmlFor="admin-new-password">New password</label>
                <div className="password-input-control">
                  <input
                    id="admin-new-password"
                    className="input"
                    type={showNewPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={6}
                  />
                  <button
                    type="button"
                    className="password-input-toggle"
                    aria-label={
                      showNewPassword
                        ? "Hide new password"
                        : "Show new password"
                    }
                    aria-pressed={showNewPassword}
                    onClick={() => setShowNewPassword((visible) => !visible)}
                    disabled={saving}
                  >
                    <Icon
                      name={showNewPassword ? "eye-off" : "eye"}
                      size={18}
                    />
                  </button>
                </div>
                <span className="tiny">Use at least 6 characters.</span>
              </div>
              <div className="field">
                <label className="label" htmlFor="admin-confirm-password">Confirm new password</label>
                <div className="password-input-control">
                  <input
                    id="admin-confirm-password"
                    className="input"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={newPassword ? 6 : undefined}
                    required={Boolean(newPassword)}
                  />
                  <button
                    type="button"
                    className="password-input-toggle"
                    aria-label={
                      showConfirmPassword
                        ? "Hide password confirmation"
                        : "Show password confirmation"
                    }
                    aria-pressed={showConfirmPassword}
                    onClick={() =>
                      setShowConfirmPassword((visible) => !visible)
                    }
                    disabled={saving}
                  >
                    <Icon
                      name={showConfirmPassword ? "eye-off" : "eye"}
                      size={18}
                    />
                  </button>
                </div>
              </div>
            </div>
            <div className="admin-settings-actions">
              <span className="tiny">
                Your current password is only needed when changing your password.
              </span>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={saving || !generalSettingsDirty}
              >
                {saving ? <LoadingDots label="Saving account settings" /> : "Save changes"}
              </button>
            </div>
          </form>
        </section>
      ) : tab === "session" ? (
        <section
          className="card admin-settings-card"
          role="tabpanel"
          id="admin-settings-panel"
          aria-labelledby="admin-settings-tab-session"
        >
          <div className="admin-settings-heading">
            <span className="admin-settings-icon"><Icon name="clock" size={20} /></span>
            <div>
              <h2>Session</h2>
              <p>Set inactivity timeouts for admin and staff sessions.</p>
            </div>
          </div>
          <form className="admin-settings-form" onSubmit={saveSession}>
            <div className="admin-session-setting">
              <div>
                <h3>Admin session</h3>
                <p>Admin sessions sign out after this period of inactivity.</p>
              </div>
              <label className="admin-session-select" htmlFor="admin-idle-timeout">
                <span className="label">Admin idle timeout</span>
                <select
                  id="admin-idle-timeout"
                  className="input"
                  value={idleTimeout}
                  onChange={(event) => setIdleTimeout(Number(event.target.value))}
                >
                  {ADMIN_IDLE_TIMEOUT_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutes
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="admin-settings-session-note">
              <Icon name="info" size={17} />
              <span>
                Admin sessions sign out after{" "}
                <strong>{idleTimeout} minutes</strong> of inactivity.
              </span>
            </div>
            <div className="admin-settings-divider" />
            <div className="admin-session-setting">
              <div>
                <h3>Staff session</h3>
                <p>
                  {staffIdleTimeout === 0
                    ? "Never-lock sessions stay signed in while active. After shop closing, idle sessions are warned and auto signed out once past the closing idle threshold."
                    : "Staff sessions lock after the idle timeout. Active sessions stay signed in across midnight. After shop closing, idle sessions are warned and auto signed out once past the closing idle threshold."}
                </p>
              </div>
              <label className="admin-session-select" htmlFor="staff-idle-timeout">
                <span className="label">Staff idle timeout</span>
                <select
                  id="staff-idle-timeout"
                  className="input"
                  value={staffIdleTimeout}
                  onChange={(event) =>
                    setStaffIdleTimeout(Number(event.target.value))
                  }
                >
                  {STAFF_IDLE_TIMEOUT_OPTIONS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes === 0 ? "Never" : `${minutes} minutes`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="admin-session-setting">
              <div>
                <h3>Staff idle warning (past closing)</h3>
                <p>
                  When the shop is past closing time and a staff session is
                  idle, warn after this many minutes and auto sign out after
                  the countdown.
                </p>
              </div>
              <div className="admin-settings-row">
                <label className="admin-session-select" htmlFor="staff-idle-warning-minutes">
                  <span className="label">Warn after idle</span>
                  <input
                    id="staff-idle-warning-minutes"
                    type="number"
                    className="input"
                    min="1"
                    max="120"
                    value={staffIdleWarningMinutes}
                    onChange={(event) =>
                      setStaffIdleWarningMinutes(
                        Number(event.target.value) || 1
                      )
                    }
                  />
                  <span className="tiny">minutes</span>
                </label>
                <label className="admin-session-select" htmlFor="staff-idle-countdown-seconds">
                  <span className="label">Countdown before sign out</span>
                  <input
                    id="staff-idle-countdown-seconds"
                    type="number"
                    className="input"
                    min="10"
                    max="600"
                    value={staffIdleCountdownSeconds}
                    onChange={(event) =>
                      setStaffIdleCountdownSeconds(
                        Number(event.target.value) || 60
                      )
                    }
                  />
                  <span className="tiny">seconds</span>
                </label>
              </div>
            </div>
            <div className="admin-settings-session-note">
              <Icon name="info" size={17} />
              <span>
                {staffIdleTimeout === 0 ? (
                  "Never-lock sessions are still monitored. Active staff stay signed in across midnight; after closing time, inactive sessions are warned and signed out once past the closing idle threshold."
                ) : (
                  <>
                    Staff sessions lock after{" "}
                    <strong>{staffIdleTimeout} minutes</strong> of inactivity.
                    Active staff stay signed in across midnight. After shop
                    closing, idle sessions are warned and signed out once past
                    the closing idle threshold.
                  </>
                )}
              </span>
            </div>
            <div className="admin-settings-actions">
              <span className="tiny">Changes take effect immediately.</span>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={saving || !sessionSettingsDirty}
              >
                {saving ? <LoadingDots label="Saving session settings" /> : "Save session settings"}
              </button>
            </div>
          </form>
        </section>
      ) : tab === "email" ? (
        <section
          className="card admin-settings-card"
          role="tabpanel"
          id="admin-settings-panel"
          aria-labelledby="admin-settings-tab-email"
        >
          <div className="admin-settings-heading admin-email-heading">
            <span className="admin-settings-icon"><Icon name="mail" size={20} /></span>
            <div>
              <h2>Email delivery</h2>
              <p>SMTP server and recipient settings.</p>
            </div>
            <span
              className={`admin-email-status-pill ${emailStatusTone}`}
              role="status"
              aria-live="polite"
            >
              {emailStatusLabel}
            </span>
          </div>

          {emailLoading ? (
            <div
              className="admin-settings-form"
              role="status"
              aria-busy="true"
              aria-label="Loading email settings"
            >
              <div className="portal-skeleton-fields" aria-hidden="true">
                {[1, 2, 3, 4, 5].map((field) => (
                  <div className="portal-skeleton-field" key={field}>
                    <SkeletonLine size="short" />
                    <SkeletonLine size="search" />
                  </div>
                ))}
                <SkeletonLine size="button" />
              </div>
            </div>
          ) : (
            <div className="admin-settings-form">
              <form className="admin-email-section-form" onSubmit={saveSmtpSettings}>
              <div className="admin-settings-subheading">
                <div>
                  <h3>SMTP server</h3>
                </div>
                <Icon name="lock" size={19} />
              </div>
              <div className="admin-email-provider-presets" aria-label="SMTP provider presets">
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => applySmtpProvider("smtp.gmail.com")}
                >
                  Gmail
                </button>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => applySmtpProvider("smtp.office365.com")}
                >
                  Outlook / Microsoft 365
                </button>
              </div>
              <div className="admin-settings-fields">
                <div className="field">
                  <label className="label" htmlFor="email-smtp-host">SMTP host</label>
                  <input
                    id="email-smtp-host"
                    className="input"
                    value={emailConfig.smtpHost}
                    onChange={(event) => updateEmailConfig("smtpHost", event.target.value)}
                    placeholder="smtp.gmail.com"
                    autoComplete="url"
                    maxLength={253}
                    required
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="email-smtp-port">SMTP port</label>
                  <input
                    id="email-smtp-port"
                    className="input"
                    type="number"
                    min={1}
                    max={65535}
                    value={emailConfig.smtpPort}
                    onChange={(event) => updateEmailConfig("smtpPort", Number(event.target.value))}
                    inputMode="numeric"
                    required
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="email-smtp-user">SMTP username (account email)</label>
                  <input
                    id="email-smtp-user"
                    className="input"
                    value={emailConfig.smtpUser}
                    onChange={(event) => updateEmailConfig("smtpUser", event.target.value)}
                    placeholder="your-email@gmail.com"
                    autoComplete="username"
                    maxLength={254}
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="email-smtp-password">
                    SMTP password{smtpPasswordConfigured ? " · saved" : ""}
                  </label>
                  <input
                    id="email-smtp-password"
                    className="input"
                    type="password"
                    value={smtpPassword}
                    onChange={(event) => {
                      setSmtpPassword(event.target.value);
                      setSmtpNoticeVisible(false);
                    }}
                    autoComplete="new-password"
                    placeholder={
                      smtpPasswordConfigured
                        ? "Leave blank to keep the saved password"
                        : "Provider app password"
                    }
                    maxLength={500}
                    required={Boolean(
                      emailConfig.smtpUser.trim() && !smtpPasswordConfigured
                    )}
                  />
                </div>
                <label className="admin-email-check">
                  <input
                    type="checkbox"
                    checked={emailConfig.smtpSecure}
                    onChange={(event) => updateEmailConfig("smtpSecure", event.target.checked)}
                  />
                  <span>Use SSL/TLS connection (commonly port 465)</span>
                </label>
              </div>

              <div className="admin-settings-divider" />
              <div className="admin-settings-subheading">
                <div>
                  <h3>Sender</h3>
                </div>
                <Icon name="users" size={19} />
              </div>
              <div className="admin-settings-fields">
                <div className="field">
                  <label className="label" htmlFor="email-from-name">Sender name</label>
                  <input
                    id="email-from-name"
                    className="input"
                    value={emailConfig.fromName}
                    onChange={(event) => updateEmailConfig("fromName", event.target.value)}
                    maxLength={100}
                    required
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor="email-from-address">Sender email</label>
                  <input
                    id="email-from-address"
                    className="input"
                    type="email"
                    value={emailConfig.fromEmail}
                    onChange={(event) => updateEmailConfig("fromEmail", event.target.value)}
                    autoComplete="email"
                    maxLength={254}
                    required
                  />
                </div>
              </div>
              <details className="admin-email-guide">
                <summary>SMTP setup guide</summary>
                <div>
                  <p>
                    Gmail requires 2-Step Verification and an app password; your normal
                    Google account password will not work for SMTP.{" "}
                    <a
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Create a Google app password
                    </a>
                    .
                  </p>
                  <p>
                    For Outlook or Microsoft 365, use <code>smtp.office365.com</code> on
                    port 587. Your organization may need to enable authenticated SMTP.
                  </p>
                  <p>
                    The sender address must be the SMTP account address or an alias that
                    the provider has authorized.
                  </p>
                </div>
              </details>
              <div className="admin-settings-actions">
               <button
                 className="btn btn-outline"
                 type="button"
                 disabled={smtpChecking}
                 onClick={() => void runSmtpConnectionCheck()}
               >
                 {smtpChecking ? <LoadingDots label="Checking email" /> : "Check email status"}
               </button>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={
                    !emailSmtpDirty ||
                    emailSaving ||
                    smtpChecking
                  }
                >
                  {emailSaving ? <LoadingDots label="Saving SMTP settings" /> : "Save SMTP settings"}
                </button>
              </div>
              {smtpChecking && (
                <div
                  className="admin-email-connection-status warning"
                  role="status"
                  aria-live="polite"
                >
                  <strong>Checking SMTP connection...</strong>
                </div>
              )}
              {smtpCheckResult && !smtpCheckResult.ok && (
                <div
                  className="admin-email-connection-status error"
                  role="alert"
                  aria-live="assertive"
                >
                  <strong>{smtpCheckResult.title}</strong>
                  {smtpCheckResult.fix && <p>{smtpCheckResult.fix}</p>}
                </div>
              )}
              {smtpCheckResult?.ok && smtpNoticeVisible && (
                <div
                  className="admin-email-connection-status success"
                  role="status"
                  aria-live="polite"
                >
                  <strong>SMTP connection verified.</strong>
                </div>
              )}
              </form>
              <div className="admin-settings-divider" />
              <form
                className="admin-email-section-form"
                onSubmit={saveRecipientSettings}
              >
              <div className="admin-settings-subheading">
                <div>
                  <h3>Email recipients</h3>
                </div>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={beginAddRecipient}
                  disabled={
                    emailSaving ||
                    recipientDraft !== null ||
                    emailConfig.subscriptions.length >= 20
                  }
                >
                  Add email
                </button>
              </div>
              {emailConfig.subscriptions.length === 0 && (
                <div className="admin-email-empty">
                  No recipients yet. Add an email address to choose what it receives.
                </div>
              )}
              <div className="admin-email-recipient-list">
                {emailConfig.subscriptions.map((subscription) => (
                  <article
                    className="admin-email-recipient"
                    key={subscription.email}
                  >
                    <div className="admin-email-recipient-details">
                      <strong>{subscription.email}</strong>
                      <div className="admin-email-recipient-types">
                        {subscription.noStockAlerts && (
                          <span>Out-of-stock · immediate</span>
                        )}
                        {subscription.lowStockAlerts && (
                          <span>Low stock · immediate</span>
                        )}
                        {subscription.salesCadence !== "off" && (
                          <span>Sales · {subscription.salesCadence}</span>
                        )}
                        {subscription.analyticsCadence !== "off" && (
                          <span>Analytics · {subscription.analyticsCadence}</span>
                        )}
                        {(subscription.salesCadence !== "off" ||
                          subscription.analyticsCadence !== "off") && (
                          <span>Reports · {subscription.reportSendTime} Manila</span>
                        )}
                      </div>
                    </div>
                    <div className="admin-email-recipient-actions">
                      <button
                        className="btn btn-outline"
                        type="button"
                        onClick={() => beginEditRecipient(subscription)}
                        disabled={emailSaving || recipientDraft !== null}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-outline"
                        type="button"
                        onClick={() => removeRecipient(subscription.email)}
                        disabled={emailSaving || recipientDraft !== null}
                        aria-label={`Remove ${subscription.email}`}
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              {recipientDraft && (
                <div className="admin-email-recipient-editor">
                  <div className="admin-settings-subheading">
                    <div>
                      <h3>
                        {editingRecipientEmail === null
                          ? "Add email recipient"
                          : "Edit email recipient"}
                      </h3>
                      <p>Choose each report frequency and one shared Manila send time.</p>
                    </div>
                    <Icon name="bell" size={19} />
                  </div>
                  <div className="admin-settings-fields">
                    <div className="field admin-email-recipients">
                      <label className="label" htmlFor="email-recipient-address">
                        Email address
                      </label>
                      <input
                        id="email-recipient-address"
                        className="input"
                        type="email"
                        value={recipientDraft.email}
                        onChange={(event) =>
                          updateRecipientDraft("email", event.target.value)
                        }
                        placeholder="owner@example.com"
                        autoComplete="off"
                        maxLength={254}
                        autoFocus
                      />
                    </div>
                    <label className="admin-email-check">
                      <input
                        type="checkbox"
                        checked={recipientDraft.noStockAlerts}
                        onChange={(event) =>
                          updateRecipientDraft("noStockAlerts", event.target.checked)
                        }
                      />
                      <span>Out-of-stock alert · immediate</span>
                    </label>
                    <label className="admin-email-check">
                      <input
                        type="checkbox"
                        checked={recipientDraft.lowStockAlerts}
                        onChange={(event) =>
                          updateRecipientDraft("lowStockAlerts", event.target.checked)
                        }
                      />
                      <span>Low-stock alert · immediate</span>
                    </label>
                    <div className="admin-email-report-option">
                      <label className="admin-email-check">
                        <input
                          type="checkbox"
                          checked={recipientDraft.salesCadence !== "off"}
                          onChange={(event) =>
                            updateRecipientDraft(
                              "salesCadence",
                              event.target.checked ? "daily" : "off"
                            )
                          }
                        />
                        <span>Sales summary</span>
                      </label>
                      {recipientDraft.salesCadence !== "off" && (
                        <div className="admin-email-report-fields">
                          <div className="field">
                            <label
                              className="label"
                              htmlFor="email-recipient-sales-frequency"
                            >
                              Frequency
                            </label>
                            <select
                              id="email-recipient-sales-frequency"
                              className="input"
                              value={recipientDraft.salesCadence}
                              onChange={(event) =>
                                updateRecipientDraft(
                                  "salesCadence",
                                  event.target.value as EmailCadence
                                )
                              }
                            >
                              <option value="daily">Every day</option>
                              <option value="weekly">Every week</option>
                              <option value="monthly">Every month</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="admin-email-report-option">
                      <label className="admin-email-check">
                        <input
                          type="checkbox"
                          checked={recipientDraft.analyticsCadence !== "off"}
                          onChange={(event) =>
                            updateRecipientDraft(
                              "analyticsCadence",
                              event.target.checked ? "daily" : "off"
                            )
                          }
                        />
                        <span>Analytics report</span>
                      </label>
                      {recipientDraft.analyticsCadence !== "off" && (
                        <div className="admin-email-report-fields">
                          <div className="field">
                            <label
                              className="label"
                              htmlFor="email-recipient-analytics-frequency"
                            >
                              Frequency
                            </label>
                            <select
                              id="email-recipient-analytics-frequency"
                              className="input"
                              value={recipientDraft.analyticsCadence}
                              onChange={(event) =>
                                updateRecipientDraft(
                                  "analyticsCadence",
                                  event.target.value as EmailCadence
                                )
                              }
                            >
                              <option value="daily">Every day</option>
                              <option value="weekly">Every week</option>
                              <option value="monthly">Every month</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                    {(recipientDraft.salesCadence !== "off" ||
                      recipientDraft.analyticsCadence !== "off") && (
                      <div className="field admin-email-report-send-time">
                        <label
                          className="label"
                          htmlFor="email-recipient-report-time"
                        >
                          Report send time (Manila)
                        </label>
                        <input
                          id="email-recipient-report-time"
                          className="input"
                          type="time"
                          value={recipientDraft.reportSendTime}
                          onChange={(event) =>
                            updateRecipientDraft(
                              "reportSendTime",
                              event.target.value
                            )
                          }
                          required
                        />
                      </div>
                    )}
                  </div>
                  {recipientError && (
                    <div className="admin-settings-message error" role="alert">
                      {recipientError}
                    </div>
                  )}
                  <div className="admin-settings-actions">
                    <button
                      className="btn btn-outline"
                      type="button"
                      onClick={cancelRecipientEdit}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={saveRecipientDraft}
                      disabled={
                        emailSaving ||
                        (editingRecipientEmail !== null && !recipientDraftDirty)
                      }
                    >
                      {editingRecipientEmail === null
                        ? "Add recipient"
                        : "Save recipient"}
                    </button>
                  </div>
                </div>
              )}

              <div className="admin-settings-actions">
                <span className="tiny">
                  {emailRecipientsDirty ? "Unsaved changes" : ""}
                </span>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={
                    !emailRecipientsDirty ||
                    emailSaving ||
                    smtpChecking ||
                    recipientDraft !== null
                  }
                >
                  {emailSaving
                    ? <LoadingDots label="Saving email recipients" />
                    : "Save recipients"}
                </button>
              </div>
              </form>
            </div>
          )}
        </section>
      ) : (
        <section
          className="card admin-settings-card"
          role="tabpanel"
          id="admin-settings-panel"
          aria-labelledby="admin-settings-tab-delivery"
        >
          <div className="admin-settings-heading">
            <span className="admin-settings-icon">
              <Icon name="mail" size={20} />
            </span>
            <div>
              <h2>Email delivery log</h2>
              <p>
                Failed messages stop after {MAX_AUTOMATIC_EMAIL_ATTEMPTS} automatic attempts. Permanent
                SMTP errors stop immediately.
              </p>
            </div>
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => void loadEmailDeliveryLog()}
              disabled={deliveryLoading}
            >
              {deliveryLoading ? (
                <LoadingDots label="Refreshing delivery log" />
              ) : (
                "Refresh"
              )}
            </button>
          </div>

          {deliveryError && (
            <div className="admin-settings-message error" role="alert">
              {deliveryError}
            </div>
          )}

          {deliveryLoading && deliveryLog.length === 0 ? (
            <div className="admin-settings-session-note" role="status">
              <LoadingDots label="Loading email delivery log" />
            </div>
          ) : deliveryLog.length === 0 ? (
            <div className="admin-email-delivery-empty" role="status">
              No email deliveries have been recorded yet.
            </div>
          ) : (
            <div className="admin-email-delivery-list">
              {deliveryLog.map((entry) => (
                <article className="admin-email-delivery-item" key={entry.id}>
                  <div className="admin-email-delivery-head">
                    <div className="admin-email-delivery-title">
                      <h3>{entry.subject}</h3>
                      <p>{entry.recipient_email || "Recipient not recorded"}</p>
                    </div>
                    <span
                      className={`admin-email-delivery-status ${entry.status}`}
                    >
                      {entry.status}
                    </span>
                  </div>
                  <dl className="admin-email-delivery-meta">
                    <div>
                      <dt>Created</dt>
                      <dd>{formatDeliveryTimestamp(entry.created_at)}</dd>
                    </div>
                    <div>
                      <dt>Automatic attempts</dt>
                      <dd>
                        {entry.attempts} / {MAX_AUTOMATIC_EMAIL_ATTEMPTS}
                      </dd>
                    </div>
                    <div>
                      <dt>Manual retries</dt>
                      <dd>{entry.manual_retries}</dd>
                    </div>
                  </dl>
                  {entry.last_error && (
                    <div className="admin-email-delivery-error">
                      <strong>{entry.last_error.title}</strong>
                      {entry.last_error.details && (
                        <p>{entry.last_error.details}</p>
                      )}
                      {entry.last_error.fix && (
                        <small>{entry.last_error.fix}</small>
                      )}
                    </div>
                  )}
                  {entry.status === "failed" && (
                    <div className="admin-email-delivery-actions">
                      <button
                        className="btn btn-outline"
                        type="button"
                        onClick={() => void retryEmailDelivery(entry.id)}
                        disabled={retryingDeliveryId !== null}
                      >
                        {retryingDeliveryId === entry.id ? (
                          <LoadingDots label="Queueing email retry" />
                        ) : (
                          "Retry email"
                        )}
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}

          {deliveryHasMore && (
            <div className="admin-email-delivery-more">
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => {
                  if (deliveryBefore !== null) {
                    void loadEmailDeliveryLog(deliveryBefore, true);
                  }
                }}
                disabled={deliveryLoading || deliveryBefore === null}
              >
                {deliveryLoading ? (
                  <LoadingDots label="Loading older deliveries" />
                ) : (
                  "Load older deliveries"
                )}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
