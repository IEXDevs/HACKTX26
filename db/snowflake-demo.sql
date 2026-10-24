-- Execute in the configured Snowflake database/schema. SYNTHETIC, not real people.
-- Grant the connector role SELECT on this view only. Do not grant arbitrary table writes.
CREATE TABLE IF NOT EXISTS RELAY_ORG_HISTORY_DEMO (
 WORKSPACE_ID VARCHAR, ENTRY_ID VARCHAR, KIND VARCHAR, TITLE VARCHAR,
 DETAIL VARCHAR, SOURCE_URL VARCHAR, OPTED_IN BOOLEAN
);
INSERT INTO RELAY_ORG_HISTORY_DEMO
SELECT 'hacktx-demo','demo-history-1','history','SYNTHETIC: previous community welcome',
 'Demo event: short welcomes and small-group introductions worked well. Confirm capacity and all-in quotes.',NULL,FALSE
WHERE NOT EXISTS (SELECT 1 FROM RELAY_ORG_HISTORY_DEMO WHERE ENTRY_ID='demo-history-1');
INSERT INTO RELAY_ORG_HISTORY_DEMO
SELECT 'hacktx-demo','demo-preferences-1','preference','SYNTHETIC: opted-in preference aggregate',
 'Demo opted-in preferences: step-free access, vegetarian food, quiet area, and clear arrival instructions. No real participant records.',NULL,TRUE
WHERE NOT EXISTS (SELECT 1 FROM RELAY_ORG_HISTORY_DEMO WHERE ENTRY_ID='demo-preferences-1');
CREATE OR REPLACE VIEW RELAY_ORG_CONTEXT AS
 SELECT WORKSPACE_ID, ENTRY_ID, KIND, TITLE, DETAIL, SOURCE_URL, OPTED_IN
 FROM RELAY_ORG_HISTORY_DEMO
 WHERE KIND='history' OR (KIND='preference' AND OPTED_IN=TRUE);
