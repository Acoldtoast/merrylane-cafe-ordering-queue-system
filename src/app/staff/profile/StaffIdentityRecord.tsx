import Image from "next/image";
import { staffIdExpirationWarning } from "@/lib/staffIdChecks";

export type StaffIdentity = {
  status: string;
  id_type: string | null;
  id_front: string;
  id_back: string | null;
  details: { name: string; number: string; birth_date: string; expiration_date?: string } | null;
};

function formatIdType(value: string | null) {
  const labels: Record<string, string> = {
    philsys: "PhilSys National ID",
    drivers_license: "Driver's license",
    passport: "Passport",
    postal: "Postal ID",
    voter: "Voter's ID",
    philhealth: "PhilHealth ID",
    other: "Other government ID",
  };
  return value ? labels[value] || value : "Not provided";
}

export function StaffIdentityRecord({ identity }: { identity: StaffIdentity | null }) {
  const expirationWarning = identity
    ? staffIdExpirationWarning(
        identity.details?.expiration_date ?? "",
        identity.id_type ?? ""
      )
    : null;
  const identityStatus = identity?.status === "verified"
    ? "Verified"
    : identity?.status === "awaiting_review"
      ? "Awaiting review"
      : identity?.status.replaceAll("_", " ") || "Not registered";

  return (
    <section className="staff-profile-identity" aria-labelledby="staff-profile-identity-title">
      <div className="staff-profile-identity-heading">
        <div>
          <span className="eyebrow">Identity record</span>
          <h3 id="staff-profile-identity-title">Registered ID</h3>
        </div>
        <span className={`badge ${identity ? (identity.status === "verified" ? "badge-green" : "badge-amber") : "badge-cream"}`}>
          {identityStatus}
        </span>
      </div>
      {identity ? (
        <>
          <div className="account-profile-details staff-profile-details">
            <div><span>ID type</span><strong>{formatIdType(identity.id_type)}</strong></div>
            <div><span>Name on ID</span><strong>{identity.details?.name || "Not provided"}</strong></div>
            <div><span>ID number</span><strong>{identity.details?.number || "Not provided"}</strong></div>
            <div><span>Date of birth</span><strong>{identity.details?.birth_date || "Not provided"}</strong></div>
            <div><span>Expiration date</span><strong>{identity.details?.expiration_date || "Not recorded"}</strong></div>
          </div>
          {expirationWarning && (
            <p className="staff-profile-identity-warning" role="alert">
              {expirationWarning === "expired"
                ? `This ID expired on ${identity.details?.expiration_date}. Contact an administrator to arrange a replacement.`
                : expirationWarning === "expires_soon"
                  ? `This ID expires on ${identity.details?.expiration_date}. Contact an administrator to arrange a replacement.`
                  : expirationWarning === "invalid"
                    ? "The expiration date on this ID record is invalid. Contact an administrator to review it."
                    : "This ID type requires an expiration date, but none is recorded. Contact an administrator to review it."}
            </p>
          )}
          <div className="staff-profile-id-images">
            <figure>
              <figcaption>Front of ID</figcaption>
              <Image className="staff-profile-id-image" src={identity.id_front} alt="Front of your registered ID" width={640} height={400} unoptimized />
            </figure>
            <figure>
              <figcaption>Back of ID</figcaption>
              {identity.id_back ? (
                <Image className="staff-profile-id-image" src={identity.id_back} alt="Back of your registered ID" width={640} height={400} unoptimized />
              ) : <p className="staff-profile-id-missing">No back image was provided.</p>}
            </figure>
          </div>
          <p className="staff-profile-identity-note">
            Your ID record is visible to you and authorized administrators. Automated checks do not confirm document authenticity.
          </p>
        </>
      ) : (
        <p className="staff-profile-id-missing">No ID has been registered to this account.</p>
      )}
    </section>
  );
}
