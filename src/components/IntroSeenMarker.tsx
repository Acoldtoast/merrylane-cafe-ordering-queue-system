"use client";

import { useEffect } from "react";
import { INTRO_SEEN_COOKIE, INTRO_SEEN_MAX_AGE } from "@/lib/introSeen";

export function IntroSeenMarker() {
  useEffect(() => {
    document.cookie = `${INTRO_SEEN_COOKIE}=1; Max-Age=${INTRO_SEEN_MAX_AGE}; Path=/; SameSite=Lax`;
  }, []);

  return null;
}
