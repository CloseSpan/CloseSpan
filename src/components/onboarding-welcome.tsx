"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { ArrowRight, Building2, Play, LoaderCircle } from "lucide-react";
import { continueOnboardingAction, exploreDemoAction } from "@/app/onboarding/actions";
import styles from "./onboarding-welcome.module.css";

function ChoiceButton({ demo = false }: { demo?: boolean }) {
  const { pending } = useFormStatus();
  const Icon = demo ? Play : Building2;
  return (
    <button type="submit" className={styles.choice} disabled={pending}>
      <span className={styles.icon}><Icon size={21} aria-hidden="true" /></span>
      <span className={styles.copy}>
        <strong>{pending ? (demo ? "Opening demo…" : "Opening setup…") : demo ? "Explore demo" : "Set up my workspace"}</strong>
        <span>{demo ? "Sample feedback, issues, and results. No setup needed." : "Connect your repository and feedback sources."}</span>
      </span>
      {pending ? <LoaderCircle className="spin" size={19} aria-hidden="true" /> : <ArrowRight size={19} aria-hidden="true" />}
    </button>
  );
}

export function OnboardingWelcome() {
  const [state, demoAction] = useActionState(exploreDemoAction, { error: null });
  return (
    <section className={styles.welcome} aria-labelledby="onboarding-welcome-title">
      <h1 id="onboarding-welcome-title">Welcome to CloseSpan</h1>
      <p>See it in action, or start with your own workspace.</p>
      <div className={styles.choices}>
        <form action={demoAction}><ChoiceButton demo /></form>
        <form action={continueOnboardingAction}><ChoiceButton /></form>
      </div>
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      <p className={styles.note}>The demo is read-only. You can switch to setup anytime.</p>
      <Link className={styles.appearanceLink} href="/onboarding?step=appearance">Back to appearance</Link>
    </section>
  );
}

function SetupButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Opening setup…" : "Set up my workspace"}
      <ArrowRight size={14} aria-hidden="true" />
    </button>
  );
}

export function DemoWorkspaceBanner() {
  return (
    <aside className={styles.banner} aria-label="Demo workspace">
      <p><strong>Demo workspace</strong><span>Sample data · Read-only</span></p>
      <form action={continueOnboardingAction}><SetupButton /></form>
    </aside>
  );
}
