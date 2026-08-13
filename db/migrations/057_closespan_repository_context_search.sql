ALTER TABLE repository_context_snapshots
  ALTER COLUMN provider SET DEFAULT 'closespan';

UPDATE repository_context_snapshots
   SET provider='closespan',updated_at=now()
 WHERE provider<>'closespan';

CREATE TABLE IF NOT EXISTS repository_context_files (
  context_id uuid NOT NULL REFERENCES repository_context_snapshots(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  path text NOT NULL,
  content_sha text NOT NULL,
  language text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size >= 0),
  line_count integer NOT NULL CHECK (line_count >= 0),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (context_id,path)
);

CREATE INDEX IF NOT EXISTS repository_context_files_org_context_idx
  ON repository_context_files(org_id,context_id,path);

CREATE TABLE IF NOT EXISTS repository_context_chunks (
  id uuid PRIMARY KEY,
  context_id uuid NOT NULL REFERENCES repository_context_snapshots(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  path text NOT NULL,
  language text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  start_line integer NOT NULL CHECK (start_line > 0),
  end_line integer NOT NULL CHECK (end_line >= start_line),
  content text NOT NULL,
  search_text text NOT NULL,
  declarations text[] NOT NULL DEFAULT '{}',
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig,coalesce(path,'')),'A') ||
    setweight(to_tsvector('simple'::regconfig,coalesce(search_text,'')),'B')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (context_id,path,ordinal)
);

CREATE INDEX IF NOT EXISTS repository_context_chunks_search_idx
  ON repository_context_chunks USING gin(search_vector);

CREATE INDEX IF NOT EXISTS repository_context_chunks_org_context_path_idx
  ON repository_context_chunks(org_id,context_id,path,ordinal);

CREATE INDEX IF NOT EXISTS repository_context_chunks_declarations_idx
  ON repository_context_chunks USING gin(declarations);
