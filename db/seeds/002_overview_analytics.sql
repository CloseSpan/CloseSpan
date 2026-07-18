INSERT INTO product_problems(id,org_id,title,statement,summary,stage,severity,confidence,product_area,team,churn_risk,suspected_repository,suspected_files,impact_factors) VALUES
('prob_filters','org_northstar','Saved views lose advanced filters','Saved views do not retain advanced filters.','Customers must recreate advanced filters after reopening a saved view.','Detected','Medium',0.86,'Platform experience','Core Product',42,'acme/web-app','[]','[]'),
('prob_sso','org_northstar','SAML role mapping ignores group changes','Updated identity-provider groups do not refresh mapped roles.','Enterprise customers retain stale roles after SAML group changes.','In progress','Critical',0.94,'Platform experience','Identity Platform',81,'acme/identity-service','[]','[]'),
('prob_invites','org_northstar','Team invite confirmation is unclear','Invite completion lacks a clear confirmation state.','Administrators are uncertain whether team invitations were sent.','Planned','Low',0.78,'Platform experience','Core Product',24,'acme/web-app','[]','[]')
ON CONFLICT (org_id,id) DO UPDATE SET title=excluded.title,stage=excluded.stage,severity=excluded.severity,confidence=excluded.confidence,updated_at=now();

INSERT INTO accounts(id,org_id,name,arr) VALUES
('acct_northstar','org_northstar','Northstar Labs',184000),('acct_acme','org_northstar','Acme Health',142000),('acct_atlas','org_northstar','Atlas Cloud',68000),
('acct_luma','org_northstar','Luma Systems',124000),('acct_nova','org_northstar','Nova Commerce',92000),
('acct_apex','org_northstar','Apex Financial',220000),('acct_meridian','org_northstar','Meridian AI',168000),('acct_harbor','org_northstar','Harbor Security',126000),('acct_vertex','org_northstar','Vertex Systems',98000),
('acct_orbit','org_northstar','Orbit Works',54000),('acct_pulse','org_northstar','Pulse Studio',44000)
ON CONFLICT (org_id,id) DO UPDATE SET name=excluded.name,arr=excluded.arr,updated_at=now();

INSERT INTO problem_account_impacts(org_id,problem_id,account_id) VALUES
('org_northstar','prob_export','acct_northstar'),('org_northstar','prob_export','acct_acme'),('org_northstar','prob_export','acct_atlas'),
('org_northstar','prob_filters','acct_luma'),('org_northstar','prob_filters','acct_nova'),
('org_northstar','prob_sso','acct_apex'),('org_northstar','prob_sso','acct_meridian'),('org_northstar','prob_sso','acct_harbor'),('org_northstar','prob_sso','acct_vertex'),
('org_northstar','prob_invites','acct_orbit'),('org_northstar','prob_invites','acct_pulse') ON CONFLICT DO NOTHING;

INSERT INTO problem_period_metrics(org_id,problem_id,current_signals,previous_signals) VALUES
('org_northstar','prob_export',3,2),('org_northstar','prob_filters',7,5),('org_northstar','prob_sso',4,3),('org_northstar','prob_invites',12,13)
ON CONFLICT (org_id,problem_id) DO UPDATE SET current_signals=excluded.current_signals,previous_signals=excluded.previous_signals,updated_at=now();

INSERT INTO problem_confidence_evidence(org_id,problem_id,evidence_id,confidence) VALUES
('org_northstar','prob_export','ev_1',0.91),('org_northstar','prob_export','ev_2',0.94),('org_northstar','prob_export','ev_3',0.91),
('org_northstar','prob_filters','ev_1',0.82),('org_northstar','prob_filters','ev_2',0.86),('org_northstar','prob_filters','ev_3',0.90),
('org_northstar','prob_sso','ev_1',0.96),('org_northstar','prob_sso','ev_2',0.93),('org_northstar','prob_sso','ev_3',0.94),
('org_northstar','prob_invites','ev_1',0.76),('org_northstar','prob_invites','ev_2',0.80),('org_northstar','prob_invites','ev_3',0.78)
ON CONFLICT (org_id,problem_id,evidence_id) DO UPDATE SET confidence=excluded.confidence;

INSERT INTO weekly_signal_metrics(org_id,source,week_index,signal_count) VALUES
('org_northstar','Intercom',1,16),('org_northstar','Intercom',2,21),('org_northstar','Intercom',3,18),('org_northstar','Intercom',4,27),('org_northstar','Intercom',5,23),('org_northstar','Intercom',6,31),('org_northstar','Intercom',7,29),('org_northstar','Intercom',8,36),
('org_northstar','Zendesk',1,14),('org_northstar','Zendesk',2,18),('org_northstar','Zendesk',3,16),('org_northstar','Zendesk',4,22),('org_northstar','Zendesk',5,21),('org_northstar','Zendesk',6,28),('org_northstar','Zendesk',7,25),('org_northstar','Zendesk',8,32),
('org_northstar','Slack',1,7),('org_northstar','Slack',2,9),('org_northstar','Slack',3,8),('org_northstar','Slack',4,12),('org_northstar','Slack',5,11),('org_northstar','Slack',6,15),('org_northstar','Slack',7,13),('org_northstar','Slack',8,17),
('org_northstar','Surveys',1,5),('org_northstar','Surveys',2,7),('org_northstar','Surveys',3,6),('org_northstar','Surveys',4,7),('org_northstar','Surveys',5,7),('org_northstar','Surveys',6,9),('org_northstar','Surveys',7,9),('org_northstar','Surveys',8,9)
ON CONFLICT (org_id,source,week_index) DO UPDATE SET signal_count=excluded.signal_count;

INSERT INTO theme_period_metrics(org_id,theme,current_signals,previous_signals,rank) VALUES
('org_northstar','Export reliability',42,28,1),('org_northstar','SSO permissions',28,25,2),('org_northstar','Saved views',21,16,3),('org_northstar','Team onboarding',17,18,4)
ON CONFLICT (org_id,theme) DO UPDATE SET current_signals=excluded.current_signals,previous_signals=excluded.previous_signals,rank=excluded.rank;

INSERT INTO resolution_samples(id,org_id,comparison_period,duration_days) VALUES
('00000000-0000-4000-9000-000000000001','org_northstar','current',6.2),('00000000-0000-4000-9000-000000000002','org_northstar','current',7.9),('00000000-0000-4000-9000-000000000003','org_northstar','current',11.1),
('00000000-0000-4000-9000-000000000004','org_northstar','previous',9.1),('00000000-0000-4000-9000-000000000005','org_northstar','previous',9.6),('00000000-0000-4000-9000-000000000006','org_northstar','previous',10.1)
ON CONFLICT (id) DO UPDATE SET duration_days=excluded.duration_days;
