export function StaffIdentityUpdateSuccess({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="staff-face-result verified staff-identity-update-success" role="status">
      <div className="staff-face-result-icon" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none">
          <path d="M12 24l8 8 16-17" />
        </svg>
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}
