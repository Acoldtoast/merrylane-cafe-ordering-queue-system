import Link from "next/link";
import Image from "next/image";

interface BrandProps {
  href?: string;
  onDark?: boolean;
}

export function Brand({ href = "/", onDark = false }: BrandProps) {
  const inner = (
    <span className={`brand ${onDark ? "brand-on-dark" : ""}`}>
      <span className="brand-mark">
        <Image
          src={onDark ? "/merrylane-logo-white.png" : "/merrylane-logo-black.png"}
          alt="Merrylane Cafe"
          width={441}
          height={193}
          preload
        />
      </span>
    </span>
  );

  return href ? <Link href={href}>{inner}</Link> : inner;
}
