"use client";

import Link from "next/link";
import { Icon } from "@/components/Icons";

interface SocialLink {
  name: "facebook" | "twitter" | "tiktok" | "instagram";
  url: string;
}

export function SocialMediaIcons({
  links,
  enabled = true,
}: {
  links: Record<string, string>;
  enabled?: boolean;
}) {
  const socialLinks: SocialLink[] = [
    { name: "facebook" as SocialLink["name"], url: links.facebook_url || "" },
    { name: "twitter" as SocialLink["name"], url: links.twitter_url || "" },
    { name: "tiktok" as SocialLink["name"], url: links.tiktok_url || "" },
    { name: "instagram" as SocialLink["name"], url: links.instagram_url || "" },
  ].filter((link) => Boolean(link.url));

  if (!enabled || socialLinks.length === 0) {
    return null;
  }

  return (
    <div className="brand-social">
      {socialLinks.map((link) => (
        <Link
          key={link.name}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="social-icon"
          aria-label={`Visit our ${link.name} page`}
        >
          <Icon
            name={link.name}
            size={16}
            className={`social-icon-glyph social-icon-glyph-${link.name}`}
          />
        </Link>
      ))}
    </div>
  );
}
