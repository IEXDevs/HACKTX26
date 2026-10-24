-- Apply only to Tiger Data / PostgreSQL with TimescaleDB installed.
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('execution_metrics', by_range('time'), if_not_exists => true, migrate_data => true);
