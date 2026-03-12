-- Create n8n role if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'n8n') THEN
    CREATE ROLE n8n LOGIN PASSWORD 'JELENPIVO2#3@';
  END IF;
END $$;

-- Create n8n database
CREATE DATABASE n8n OWNER n8n;
GRANT ALL PRIVILEGES ON DATABASE n8n TO n8n;

-- Future apps go here:
-- CREATE ROLE events LOGIN PASSWORD '...';
-- CREATE DATABASE events OWNER events;
