-- A ticket specification is the mutable preparation context for the next
-- coding attempt. Immutable artifacts created from it (Prompt Testing
-- verifications, approvals, and agent runs) keep their original profile
-- binding and remain protected by reject_execution_profile_binding_change().
--
-- Terminal retries first verify that no approval or run is active, then move
-- this preparation context to the currently active profile and branch head.
-- Migration 033 treated the preparation row like a historical artifact, which
-- prevented that safe retry with "an execution profile binding is immutable
-- once recorded".
DROP TRIGGER IF EXISTS ticket_specs_execution_profile_immutable
  ON engineering_ticket_specifications;
