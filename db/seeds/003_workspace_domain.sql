UPDATE accounts SET tier=CASE id WHEN 'acct_northstar' THEN 'Enterprise' WHEN 'acct_acme' THEN 'Enterprise' WHEN 'acct_atlas' THEN 'Growth' WHEN 'acct_apex' THEN 'Enterprise' WHEN 'acct_meridian' THEN 'Enterprise' WHEN 'acct_harbor' THEN 'Enterprise' ELSE 'Growth' END,
customer_since=CASE id WHEN 'acct_northstar' THEN 2021 WHEN 'acct_acme' THEN 2022 WHEN 'acct_atlas' THEN 2023 ELSE 2024 END,
churn_risk=CASE WHEN id IN ('acct_northstar','acct_acme','acct_apex','acct_meridian') THEN 'Elevated' ELSE 'Low' END WHERE org_id='org_northstar';

UPDATE product_problems SET impact_factors='[
 {"key":"frequency","label":"Frequency","value":76,"weight":20,"evidence":"3 reports from 3 accounts in 26 hours"},
 {"key":"severity","label":"Severity","value":85,"weight":20,"evidence":"Core reporting workflow is blocked"},
 {"key":"revenue","label":"Revenue","value":88,"weight":20,"evidence":"$394k ARR directly affected"},
 {"key":"churnRisk","label":"Churn risk","value":72,"weight":15,"evidence":"One renewal is due within 45 days"},
 {"key":"customerTier","label":"Customer tier","value":90,"weight":10,"evidence":"2 enterprise accounts affected"},
 {"key":"strategicAlignment","label":"Strategic alignment","value":65,"weight":5,"evidence":"Reliability is a Q3 product objective"},
 {"key":"sla","label":"SLA","value":80,"weight":5,"evidence":"Enterprise response window has 9h remaining"},
 {"key":"engineeringEffort","label":"Effort","value":62,"weight":5,"evidence":"Likely isolated worker and storage change"}
]'::jsonb WHERE org_id='org_northstar' AND id='prob_export';

INSERT INTO feedback_items(id,org_id,source,customer_name,account_tier,arr,type,severity,redacted,environment,confidence,observed_at,quote) VALUES
('fb_004','org_northstar','Survey','Luma Systems','Growth',124000,'Feature request','Low',false,'Web · v4.18.1',0.84,'Yesterday, 11:30','Please let us save a filtered dashboard view for our weekly review.'),
('fb_005','org_northstar','Email','Orbit Works','Growth',54000,'Usability','Medium',true,'Safari 17 · macOS · v4.18.2',0.71,'Mon, 14:22','I cannot tell whether inviting a teammate succeeded.')
ON CONFLICT (org_id,id) DO UPDATE SET customer_name=excluded.customer_name,arr=excluded.arr,confidence=excluded.confidence,updated_at=now();
INSERT INTO feedback_cluster_memberships(org_id,problem_id,feedback_id,similarity,explanation) VALUES
('org_northstar','prob_filters','fb_004',0.84,'Saved filtered dashboard view request'),('org_northstar','prob_invites','fb_005',0.71,'Invite confirmation usability issue') ON CONFLICT DO NOTHING;

INSERT INTO investigations(id,org_id,problem_id,title,status,hypothesis,confidence,assumptions,missing_information,proposed_action,recommended_tests,suspected_files) VALUES
('rec_001','org_northstar','prob_export','Large CSV export investigation','Ready for approval','The export worker marks jobs complete before the multipart object upload is finalized when the output crosses the buffered-write threshold.',0.68,
'["Reports began after v4.18.2","All three messages refer to the same export pipeline","Repository metadata is current"]','["Exact row count for fb_003","Object-storage request ID from one failed export"]','Create a simulated GitHub issue with evidence, reproduction guidance, suspected files, and an implementation plan.','["Boundary test at 9,999 / 10,000 / 10,001 rows","Assert upload finalization precedes completed state","Retry interrupted multipart upload"]','["services/exports/finalize.ts","workers/csv-export.ts","lib/object-storage.ts"]'),
('inv_sso','org_northstar','prob_sso','SAML role mapping','Running','Group synchronization may be serving cached role mappings.',0.54,'[]','["IdP event ID"]','Continue repository search.','[]','[]'),
('inv_filters','org_northstar','prob_filters','Saved filter regression','Queued','Saved-view serialization may omit advanced clauses.',0.41,'[]','["Saved view payload"]','Inspect view serializer.','[]','[]'),
('inv_invites','org_northstar','prob_invites','Invite confirmation','Needs context','The invitation response may not produce a visible success state.',0.38,'[]','["Screen recording"]','Request more context.','[]','[]')
ON CONFLICT (org_id,id) DO UPDATE SET status=excluded.status,hypothesis=excluded.hypothesis,confidence=excluded.confidence,updated_at=now();

INSERT INTO integrations(id,org_id,provider,category,connection_state,data_scope,permissions,display_order) VALUES
('int_zendesk','org_northstar','Zendesk','Feedback','Seeded sample','Seeded records','["read:tickets"]',1),('int_intercom','org_northstar','Intercom','Feedback','Not connected','None','[]',2),('int_slack','org_northstar','Slack','Feedback','Not connected','None','[]',3),('int_teams','org_northstar','Microsoft Teams','Feedback','Not connected','None','[]',4),('int_gmail','org_northstar','Gmail','Feedback','Not connected','None','[]',5),('int_jira','org_northstar','Jira','Engineering','Not connected','None','[]',6),('int_linear','org_northstar','Linear','Engineering','Not connected','None','[]',7),('int_github','org_northstar','GitHub','Engineering','Demo configured','Seeded repository metadata','["metadata:read"]',8),('int_salesforce','org_northstar','Salesforce','CRM','Not connected','None','[]',9),('int_hubspot','org_northstar','HubSpot','CRM','Not connected','None','[]',10),('int_sentry','org_northstar','Sentry','Observability','Not connected','None','[]',11),('int_datadog','org_northstar','Datadog','Observability','Not connected','None','[]',12),('int_posthog','org_northstar','PostHog','Analytics','Not connected','None','[]',13),('int_appstore','org_northstar','App Store','Reviews','Not connected','None','[]',14),('int_play','org_northstar','Google Play','Reviews','Not connected','None','[]',15)
ON CONFLICT (org_id,id) DO UPDATE SET category=excluded.category,connection_state=excluded.connection_state,data_scope=excluded.data_scope,permissions=excluded.permissions,display_order=excluded.display_order;

INSERT INTO workspace_settings(org_id,autonomy_level,pii_redaction,retention_days,priority_weights,monthly_model_budget,used_model_cost,hard_stop,plan_name,plan_price) VALUES
('org_northstar','Execute with approval',true,365,'{"frequency":20,"severity":20,"revenue":20,"churnRisk":15,"customerTier":10,"strategicAlignment":5,"sla":5,"engineeringEffort":5}',500,128,true,'Sandbox','$0')
ON CONFLICT (org_id) DO UPDATE SET autonomy_level=excluded.autonomy_level,pii_redaction=excluded.pii_redaction,retention_days=excluded.retention_days,priority_weights=excluded.priority_weights,monthly_model_budget=excluded.monthly_model_budget,used_model_cost=excluded.used_model_cost,hard_stop=excluded.hard_stop,plan_name=excluded.plan_name,plan_price=excluded.plan_price,updated_at=now();

INSERT INTO workspace_members(id,org_id,display_name,email,role,team) VALUES
('user_avery','org_northstar','Avery Chen','avery@example.com','Admin','Product'),('user_maya','org_northstar','Maya Patel','maya@example.com','Contributor','Data Experience'),('user_liam','org_northstar','Liam Brooks','liam@example.com','Contributor','Data Experience'),('user_sofia','org_northstar','Sofia Kim','sofia@example.com','Contributor','Data Experience'),('user_noah','org_northstar','Noah Williams','noah@example.com','Contributor','Data Experience'),('user_emma','org_northstar','Emma Davis','emma@example.com','Viewer','Support')
ON CONFLICT (org_id,id) DO UPDATE SET display_name=excluded.display_name,email=excluded.email,role=excluded.role,team=excluded.team;
