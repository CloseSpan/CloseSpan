import {
  Bug,
  ChartNoAxesCombined,
  GitBranch,
  Github,
  Headset,
  MessageSquareMore,
  PanelsTopLeft,
  Play,
  PlugZap,
  Slack,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

const providerIcons: Record<
  string,
  { icon: LucideIcon; tone: string }
> = {
  int_webhook: { icon: Webhook, tone: "webhook" },
  int_zendesk: { icon: Headset, tone: "zendesk" },
  int_intercom: { icon: MessageSquareMore, tone: "intercom" },
  int_slack: { icon: Slack, tone: "slack" },
  int_discord: { icon: MessageSquareMore, tone: "discord" },
  int_app_store: { icon: PlugZap, tone: "apple" },
  int_play_store: { icon: Play, tone: "play-store" },
  int_github: { icon: Github, tone: "github" },
  int_jira: { icon: PanelsTopLeft, tone: "jira" },
  int_linear: { icon: GitBranch, tone: "linear" },
  int_sentry: { icon: Bug, tone: "sentry" },
  int_posthog: { icon: ChartNoAxesCombined, tone: "posthog" },
};

const brandMarks: Partial<Record<string, ReactNode>> = {
  int_app_store: (
    <svg viewBox="0 0 24 24" role="img" aria-label="App Store Connect">
      <rect width="24" height="24" rx="5.5" fill="#087CF0" />
      <g
        fill="none"
        stroke="#fff"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      >
        <path d="M8.05 16.6 12 5.9l3.95 10.7" />
        <path d="M6.45 14.25h11.1" />
      </g>
      <g fill="#fff">
        <circle cx="12" cy="5.9" r="1.45" />
        <circle cx="8.05" cy="16.6" r="1.45" />
        <circle cx="15.95" cy="16.6" r="1.45" />
        <circle cx="6.45" cy="14.25" r="1.05" />
        <circle cx="17.55" cy="14.25" r="1.05" />
      </g>
    </svg>
  ),
  int_slack: (
    <svg viewBox="0 0 24 24" role="img" aria-label="Slack">
      <rect x="3" y="9.5" width="8" height="5" rx="2.5" fill="#36C5F0" />
      <rect x="9.5" y="3" width="5" height="8" rx="2.5" fill="#2EB67D" />
      <rect x="13" y="9.5" width="8" height="5" rx="2.5" fill="#ECB22E" />
      <rect x="9.5" y="13" width="5" height="8" rx="2.5" fill="#E01E5A" />
    </svg>
  ),
  int_discord: (
    <svg viewBox="0 0 24 24" role="img" aria-label="Discord">
      <rect width="24" height="24" rx="6" fill="#5865F2" />
      <path d="M7.1 7.4c2.9-1.5 6.9-1.5 9.8 0 .9 1.4 1.6 3.6 1.7 5.7-1.3 1.7-2.9 2.8-4.5 3.4l-.8-1.1c.6-.2 1.1-.5 1.6-.8-1.9.9-3.9.9-5.8 0 .5.3 1 .6 1.6.8l-.8 1.1c-1.6-.6-3.2-1.7-4.5-3.4.1-2.1.8-4.3 1.7-5.7Z" fill="#fff" />
      <circle cx="9.4" cy="11.7" r="1" fill="#5865F2" />
      <circle cx="14.6" cy="11.7" r="1" fill="#5865F2" />
    </svg>
  ),
  int_play_store: (
    <svg viewBox="0 0 24 24" role="img" aria-label="Google Play">
      <path d="M4 3.8v16.4L13.7 12 4 3.8Z" fill="#00D6A0" />
      <path d="m4 3.8 11.8 6.3-2.1 1.9L4 3.8Z" fill="#00A7F7" />
      <path d="m4 20.2 11.8-6.3-2.1-1.9L4 20.2Z" fill="#FFCE00" />
      <path d="m15.8 10.1 3.4 1.8c.6.3.6.7 0 1l-3.4 1.8-2.1-2.7 2.1-1.9Z" fill="#FF3A44" />
    </svg>
  ),
  int_jira: (
    <svg viewBox="0 0 24 24" role="img" aria-label="Jira">
      <path d="M12 2 22 12 12 22 2 12 12 2Z" fill="#2684FF" />
      <path d="m12 7.2 4.8 4.8-4.8 4.8L7.2 12 12 7.2Z" fill="#fff" opacity=".95" />
      <path d="m12 9.8 2.2 2.2-2.2 2.2L9.8 12 12 9.8Z" fill="#0052CC" />
    </svg>
  ),
  int_intercom: (
    <svg viewBox="0 0 24 24" role="img" aria-label="Intercom">
      <rect x="3" y="3" width="18" height="18" rx="4" fill="#286EFA" />
      <path d="M7 8v6M10.3 7v8M13.7 7v8M17 8v6M7 17c3.2 2 6.8 2 10 0" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  int_zendesk: (
    <svg viewBox="0 0 24 24" role="img" aria-label="Zendesk">
      <path d="M4 4h8v8H4l8-8ZM12 12h8v8h-8l8-8Z" fill="#03363D" />
      <path d="M4 20h8c0-4.4-3.6-8-8-8v8ZM20 4h-8c0 4.4 3.6 8 8 8V4Z" fill="#78A300" />
    </svg>
  ),
  int_posthog: (
    <svg viewBox="0 0 24 24" role="img" aria-label="PostHog">
      <circle cx="12" cy="12" r="9" fill="#F9BD2B" />
      <path d="M7 14c2.8-1.9 7.2-1.9 10 0M8 8l2 2M16 8l-2 2" fill="none" stroke="#111827" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="9" cy="12" r="1" fill="#111827" /><circle cx="15" cy="12" r="1" fill="#111827" />
    </svg>
  ),
};

export function IntegrationProviderIcon({
  integrationId,
  size = 18,
  compact = false,
  className = "",
}: {
  integrationId: string;
  size?: number;
  compact?: boolean;
  className?: string;
}) {
  const provider = providerIcons[integrationId] ?? {
    icon: PlugZap,
    tone: "default",
  };
  const Icon = provider.icon;
  const brandMark = brandMarks[integrationId];

  return (
    <span
      className={`integration-provider-icon provider-${provider.tone}${
        compact ? " compact" : ""
      }${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {brandMark ? (
        <span className="integration-brand-mark">{brandMark}</span>
      ) : (
        <Icon size={size} strokeWidth={1.9} />
      )}
    </span>
  );
}
