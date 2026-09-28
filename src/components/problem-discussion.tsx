"use client";

import { useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import { IssueConversation, type IssueConversationProps } from "./issue-conversation";
import styles from "./problem-discussion.module.css";

export function ProblemDiscussion(props: IssueConversationProps) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  return <section className={styles.discussion} aria-label="Discuss this issue">
    <button className="btn" type="button" disabled={voiceActive} aria-expanded={open} aria-controls="problem-discussion-panel"
      onClick={() => { setOpened(true); setOpen(!open); }}>
      <MessageSquare size={15} aria-hidden="true" /> Discuss this issue <ChevronDown size={14} aria-hidden="true" />
    </button>
    {voiceActive && <span className={styles.callHint} role="status">End the call to close this panel.</span>}
    {opened && <div id="problem-discussion-panel" className={styles.panel} hidden={!open}>
      <IssueConversation {...props} onVoiceActivityChange={setVoiceActive} />
    </div>}
  </section>;
}
