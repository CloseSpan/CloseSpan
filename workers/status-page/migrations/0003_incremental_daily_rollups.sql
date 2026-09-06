CREATE TRIGGER IF NOT EXISTS checks_daily_rollup_after_insert
AFTER INSERT ON checks
BEGIN
  INSERT INTO daily_rollups (
    service_id,
    day,
    total_checks,
    successful_checks,
    degraded_checks,
    failed_checks,
    maintenance_checks,
    worst_status,
    calculated_at
  ) VALUES (
    NEW.service_id,
    date(NEW.checked_at / 1000, 'unixepoch'),
    1,
    CASE WHEN NEW.succeeded = 1 AND NEW.maintenance_excluded = 0 THEN 1 ELSE 0 END,
    CASE WHEN NEW.status = 'degraded' AND NEW.succeeded = 1 AND NEW.maintenance_excluded = 0 THEN 1 ELSE 0 END,
    CASE WHEN NEW.succeeded = 0 AND NEW.maintenance_excluded = 0 THEN 1 ELSE 0 END,
    NEW.maintenance_excluded,
    CASE WHEN NEW.maintenance_excluded = 1 THEN 'maintenance' ELSE NEW.status END,
    NEW.checked_at
  )
  ON CONFLICT(service_id, day) DO UPDATE SET
    total_checks = daily_rollups.total_checks + 1,
    successful_checks = daily_rollups.successful_checks + excluded.successful_checks,
    degraded_checks = daily_rollups.degraded_checks + excluded.degraded_checks,
    failed_checks = daily_rollups.failed_checks + excluded.failed_checks,
    maintenance_checks = daily_rollups.maintenance_checks + excluded.maintenance_checks,
    worst_status = CASE
      WHEN daily_rollups.worst_status = 'major_outage' OR excluded.worst_status = 'major_outage' THEN 'major_outage'
      WHEN daily_rollups.worst_status = 'partial_outage' OR excluded.worst_status = 'partial_outage' THEN 'partial_outage'
      WHEN daily_rollups.worst_status = 'degraded' OR excluded.worst_status = 'degraded' THEN 'degraded'
      WHEN daily_rollups.worst_status = 'maintenance' OR excluded.worst_status = 'maintenance' THEN 'maintenance'
      ELSE 'operational'
    END,
    calculated_at = excluded.calculated_at;
END;
