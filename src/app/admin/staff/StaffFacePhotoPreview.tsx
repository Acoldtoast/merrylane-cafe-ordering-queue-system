"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

export function StaffFacePhotoPreview({ file, label }: { file: File; label: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === "string") setUrl(reader.result); };
    reader.readAsDataURL(file);
    return () => { reader.onload = null; reader.abort(); };
  }, [file]);
  if (!url) return null;
  return (
    <Image className="staff-identity-preview" src={url} alt={`${label} selected photo`} width={200} height={100} unoptimized />
  );
}
