ALTER TABLE application_access_logs DROP CONSTRAINT application_access_logs_operation_check;
ALTER TABLE application_access_logs ADD CONSTRAINT application_access_logs_operation_check CHECK(operation IN ('profile','credentials','avatar'));
