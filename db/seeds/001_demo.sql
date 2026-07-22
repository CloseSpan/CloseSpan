INSERT INTO organizations(id,name) VALUES ('org_northstar','CloseSpan Demo')
ON CONFLICT (id) DO UPDATE SET name=excluded.name, updated_at=now();
INSERT INTO product_problems(id,org_id,title,statement,summary,stage,severity,confidence,product_area,team,churn_risk,suspected_repository,suspected_files,impact_factors)
VALUES ('prob_export','org_northstar','Large CSV exports produce empty files','Customers exporting datasets above approximately 10,000 rows receive an empty or zero-byte CSV despite a successful completion state.','Three customers across two paid tiers reported the same failure after release 4.18.2. Small exports remain healthy, suggesting a size-dependent regression in asynchronous export finalization.','Needs review','High',0.92,'Analytics exports','Data Experience',72,'acme/analytics-api','["services/exports/finalize.ts","workers/csv-export.ts","lib/object-storage.ts"]','[]') ON CONFLICT (org_id,id) DO NOTHING;
INSERT INTO approval_requests(id,org_id,problem_id,recommendation_id,action,reason,confidence,systems,data_shared,reversible,risk,status)
VALUES ('apr_001','org_northstar','prob_export','rec_001','Create GitHub issue in acme/analytics-api','Three corroborating reports indicate a release-linked regression affecting $394k ARR.',0.68,'["GitHub (simulated)"]','["Redacted customer quotes","Environment metadata","Repository file paths"]',true,'Low','Pending') ON CONFLICT (org_id,id) DO NOTHING;
INSERT INTO workspaces(id,org_id,name,primary_problem_id,primary_approval_id) VALUES ('ws_demo','org_northstar','Demo workspace','prob_export','apr_001') ON CONFLICT (org_id) DO NOTHING;
INSERT INTO feedback_items(id,org_id,source,customer_name,account_tier,arr,type,severity,redacted,environment,confidence,observed_at,quote) VALUES
('fb_001','org_northstar','Intercom','Northstar Labs','Enterprise',184000,'Bug','High',true,'Chrome 126 · macOS · v4.18.2',0.96,'Today, 09:42','CSV exports with more than 10k rows finish, but the download is blank. [email redacted]'),
('fb_002','org_northstar','Zendesk','Acme Health','Enterprise',142000,'Bug','High',true,'Edge 126 · Windows 11 · v4.18.2',0.93,'Today, 08:17','Our quarterly export says complete, then gives us a zero-byte file.'),
('fb_003','org_northstar','Slack','Atlas Cloud','Growth',68000,'Bug','Medium',true,'Chrome 125 · macOS · v4.18.2',0.89,'Yesterday, 16:08','Large report download is empty again. Small exports work.') ON CONFLICT (org_id,id) DO NOTHING;
INSERT INTO feedback_cluster_memberships(org_id,problem_id,feedback_id,similarity,explanation) VALUES
('org_northstar','prob_export','fb_001',0.91,'Same failure mode, export size threshold, and release context'),
('org_northstar','prob_export','fb_002',0.94,'Zero-byte output matches the canonical problem'),
('org_northstar','prob_export','fb_003',0.89,'Large exports fail while small exports succeed') ON CONFLICT DO NOTHING;
INSERT INTO audit_events(id,org_id,actor_id,actor_name,action,entity_type,entity_id,trace_id) VALUES
('00000000-0000-4000-8000-000000000001','org_northstar','agent_classification','Classification agent','Classified fb_001 as a high-severity bug (96% confidence)','ProductProblem','prob_export','seed-classification'),
('00000000-0000-4000-8000-000000000002','org_northstar','agent_clustering','Clustering agent','Associated fb_001 with this problem; evidence similarity 0.91','ProductProblem','prob_export','seed-clustering'),
('00000000-0000-4000-8000-000000000003','org_northstar','agent_investigation','Investigation agent','Prepared a code-aware recommendation for human review','ApprovalRequest','apr_001','seed-investigation') ON CONFLICT DO NOTHING;
