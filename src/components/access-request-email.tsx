import { Mail } from "lucide-react";

interface AccessRequestEmailProps {
  adminEmail: string;
  mailtoUrl: string;
}

export function AccessRequestEmail({
  adminEmail,
  mailtoUrl,
}: AccessRequestEmailProps) {
  return (
    <>
      <a className="btn primary login-request-access" href={mailtoUrl}>
        <Mail aria-hidden="true" size={17} />
        Email the founder
      </a>
      <p className="login-email-hint">
        Opens a prefilled message to {adminEmail}. You can add your question
        before sending it.
      </p>
    </>
  );
}
