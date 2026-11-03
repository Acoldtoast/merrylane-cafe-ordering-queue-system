interface LoadingDotsProps {
  label: string;
}

export function LoadingDots({ label }: LoadingDotsProps) {
  return (
    <span className="loading-dots-label" role="status">
      <span>{label}</span>
      <span className="loading-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
