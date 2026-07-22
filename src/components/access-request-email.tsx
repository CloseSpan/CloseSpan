"use client";

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";

interface AccessRequestEmailProps {
  adminEmail: string;
  email: string;
  mailtoUrl: string;
}

const AUTO_OPEN_COOLDOWN_MS = 30_000;

export function AccessRequestEmail({
  adminEmail,
  email,
  mailtoUrl,
}: AccessRequestEmailProps) {
  const [attemptedOpen, setAttemptedOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storageKey = `closespan:access-request:${email}`;
      let shouldOpen = true;

      try {
        const lastOpenedAt = Number(window.sessionStorage.getItem(storageKey));
        const now = Date.now();
        shouldOpen = !lastOpenedAt || now - lastOpenedAt > AUTO_OPEN_COOLDOWN_MS;
        if (shouldOpen) window.sessionStorage.setItem(storageKey, String(now));
      } catch {
        // The manual link remains available when browser storage is disabled.
      }

      setAttemptedOpen(true);
      if (shouldOpen) window.location.assign(mailtoUrl);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [email, mailtoUrl]);

  return (
    <>
      <a className="btn primary login-request-access" href={mailtoUrl}>
        <Mail aria-hidden="true" size={17} />
        Open the prefilled access email
      </a>
      <p className="login-email-hint" aria-live="polite">
        {attemptedOpen
          ? `A prefilled message to ${adminEmail} should be open. If it did not open, use the button above.`
          : `Opening a prefilled message to ${adminEmail} now.`}
      </p>
    </>
  );
}
