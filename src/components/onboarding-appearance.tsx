"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { completeOnboardingAppearanceAction } from "@/app/onboarding/actions";
import { AppearanceOptions } from "@/components/appearance-settings";
import {
  applyAccentColor,
  applyColorThemePreference,
  resolveAccentColor,
  resolveColorTheme,
} from "@/lib/color-theme-client";
import styles from "./onboarding-welcome.module.css";

function ContinueButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn primary" type="submit" disabled={pending}>
      {pending ? "Continuing…" : "Continue"}
      {pending ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <ArrowRight size={16} aria-hidden="true" />}
    </button>
  );
}

export function OnboardingAppearance() {
  const [state, action] = useActionState(completeOnboardingAppearanceAction, { error: null });
  return (
    <section className={styles.welcome} aria-labelledby="onboarding-appearance-title">
      <h1 id="onboarding-appearance-title">How should CloseSpan look?</h1>
      <form
        className={styles.appearanceForm}
        action={action}
        onSubmit={() => {
          // Also save the defaults when the user continues without changing a radio.
          applyColorThemePreference(resolveColorTheme(), { persist: true, animate: false });
          applyAccentColor(resolveAccentColor(), { persist: true });
        }}
      >
        <AppearanceOptions includeSystem={false} />
        {state.error && <p className={styles.error} role="alert">{state.error}</p>}
        <div className={styles.appearanceFooter}>
          <p>Change this anytime in Settings.</p>
          <ContinueButton />
        </div>
      </form>
    </section>
  );
}
