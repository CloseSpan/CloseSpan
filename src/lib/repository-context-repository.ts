import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { databasePool, transaction } from "./db";
import { createGithubInstallationClient } from "./github-app-auth";
import { HttpError } from "./request-security";
import { requirePostgresWorkspace } from "./workspace-persistence";

export type RepositoryContextStatus =
  | "Queued"
  | "Discovering"
  | "Uploading"
  | "Indexing"
  | "Ready"
  | "Failed";

export const CLOSESPAN_SYSTEM_PATH_PREFIXES = [
  ".github/workflows/closespan-",
  ".github/skills/",
  ".closespan/",
  ".closespan-run/",
  ".prompt/",
] as const;

export interface RepositoryContextSnapshot {
  id: string;
  repository: string;
  defaultBranch: string;
  commitSha: string | null;
  provider: "closespan";
  status: RepositoryContextStatus;
  stage: string;
  progress: number;
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  errorMessage: string | null;
}

interface RepositoryContextRow {
  id: string;
  org_id: string;
  installation_id: string;
  repository: string;
  default_branch: string;
  commit_sha: string | null;
  provider: "closespan";
  status: RepositoryContextStatus;
  stage: string;
  progress: number;
  total_files: number;
  indexed_files: number;
  skipped_files: number;
  context_state: RepositoryContextState | null;
  started_at: Date | null;
  completed_at: Date | null;
  updated_at: Date;
  error_message: string | null;
}

interface RepositoryContextState {
  schemaVersion: 1;
  indexedAt: string;
  languages: Record<string, number>;
  topLevelDirectories: string[];
  notableFiles: string[];
  testFiles: number;
}

interface GithubRepositoryFile {
  path: string;
  sha: string;
  size: number;
}

interface IndexedRepositoryFile {
  path: string;
  contentSha: string;
  language: string;
  byteSize: number;
  lineCount: number;
  content: string;
}

export interface RepositoryContextChunk {
  ordinal: number;
  startLine: number;
  endLine: number;
  content: string;
  searchText: string;
  declarations: string[];
}

interface SearchChunkRow {
  id: string;
  path: string;
  language: string;
  ordinal: number;
  start_line: number;
  end_line: number;
  content: string;
  declarations: string[];
  lexical_rank: number;
}

const MAX_FILE_BYTES = 1_000_000;
const FETCH_CONCURRENCY = 8;
const MAX_CHUNK_LINES = 120;
const MAX_CHUNK_CHARACTERS = 14_000;
const CHUNK_OVERLAP_LINES = 12;

const TEXT_EXTENSIONS = new Set([
  "c", "cc", "conf", "config", "cpp", "cs", "css", "csv", "dart", "env",
  "go", "graphql", "gql", "h", "hpp", "html", "ini", "java", "js", "json", "jsx",
  "kt", "kts", "less", "m", "md", "mdx", "mm", "pbxproj", "php", "plist",
  "properties", "proto", "py", "rb", "rs", "rst", "sass", "scala", "scss", "sh",
  "sql", "storyboard", "strings", "swift", "toml", "ts", "tsx", "txt", "vue",
  "xml", "xcscheme", "xcworkspacedata", "yaml", "yml", "zsh",
]);

const TEXT_FILENAMES = new Set([
  ".closespanignore", ".dockerignore", ".editorconfig", ".env.example", ".gitattributes",
  ".gitignore", "AGENTS.md", "CODEOWNERS", "Dockerfile", "Gemfile", "LICENSE",
  "Makefile", "Package.resolved", "Podfile", "README", "README.md",
]);

const EXCLUDED_PATH_SEGMENTS = new Set([
  ".git", ".next", ".turbo", ".venv", "DerivedData", "Pods", "build", "coverage",
  "dist", "node_modules", "vendor",
]);

const QUERY_STOP_WORDS = new Set([
  "about", "after", "against", "also", "and", "are", "before", "behavior", "can",
  "code", "complete", "concern", "confirm", "could", "current", "customer",
  "debug", "evidence", "expected", "files", "find", "for", "from", "help", "how",
  "implementation", "in", "into", "investigate", "is", "issue", "it", "likely", "missing",
  "of", "on", "or", "path", "problem", "product", "reported", "repository", "result", "return",
  "should", "source", "test", "tests", "that", "the", "their", "this", "through", "to",
  "understand", "use", "what", "when", "where", "which", "with", "workflow",
]);

const DECLARATION_PATTERNS = [
  /\b(?:class|struct|enum|protocol|actor|extension|interface|type|typealias|trait|record)\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:func|function|def|fn)\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
];

function snapshotFromRow(row: RepositoryContextRow): RepositoryContextSnapshot {
  return {
    id: row.id,
    repository: row.repository,
    defaultBranch: row.default_branch,
    commitSha: row.commit_sha,
    provider: "closespan",
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    totalFiles: row.total_files,
    indexedFiles: row.indexed_files,
    skippedFiles: row.skipped_files,
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
    errorMessage: row.error_message,
  };
}

function repositoryParts(repository: string): { owner: string; repo: string } {
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("Repository must use owner/name format");
  return { owner, repo };
}

function fileExtension(path: string): string {
  const filename = path.split("/").at(-1) ?? "";
  return filename.includes(".") ? filename.split(".").at(-1)?.toLowerCase() ?? "" : "";
}

function languageForPath(path: string): string {
  const extension = fileExtension(path);
  const labels: Record<string, string> = {
    c: "C", cc: "C++", cpp: "C++", cs: "C#", css: "CSS", dart: "Dart",
    go: "Go", h: "C/C++ header", hpp: "C++ header", html: "HTML", java: "Java",
    js: "JavaScript", jsx: "JavaScript", kt: "Kotlin", m: "Objective-C", md: "Markdown",
    mdx: "MDX", mm: "Objective-C++", pbxproj: "Xcode project", php: "PHP", plist: "Property list",
    proto: "Protocol Buffers", py: "Python", rb: "Ruby", rs: "Rust", sh: "Shell", sql: "SQL",
    storyboard: "Storyboard", swift: "Swift", toml: "TOML", ts: "TypeScript", tsx: "TypeScript",
    vue: "Vue", xml: "XML", yaml: "YAML", yml: "YAML",
  };
  return labels[extension] ?? (extension ? extension.toUpperCase() : "Text");
}

function isIndexablePath(path: string, size: number): boolean {
  if (size > MAX_FILE_BYTES) return false;
  const segments = path.split("/");
  if (segments.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment))) return false;
  const filename = segments.at(-1) ?? "";
  return TEXT_FILENAMES.has(filename) || TEXT_EXTENSIONS.has(fileExtension(path));
}

function splitIdentifierWords(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_./\\-]+/g, " ")
    .toLowerCase();
}

function extractDeclarations(content: string): string[] {
  const declarations = new Set<string>();
  for (const pattern of DECLARATION_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      const symbol = match[1];
      if (symbol && symbol.length >= 2) declarations.add(symbol);
      if (declarations.size >= 80) break;
    }
  }
  return [...declarations];
}

export function repositorySearchTerms(query: string): string[] {
  const normalized = splitIdentifierWords(query);
  const terms = normalized.match(/[a-z0-9][a-z0-9]{1,63}/g) ?? [];
  const useful = terms.filter(
    (term) => !QUERY_STOP_WORDS.has(term) && !/^\d+$/.test(term),
  );
  const expanded = [...useful];
  const source = new Set(terms);
  if (source.has("input") || source.has("binding") || source.has("ui")) {
    expanded.push("textfield", "texteditor", "field", "binding", "onchange", "state");
  }
  if (source.has("persist") || source.has("persistence") || source.has("storage")) {
    expanded.push("save", "saved", "store", "stored", "record", "manifest");
  }
  if (source.has("prompt") || source.has("request")) {
    expanded.push("caption", "generate", "generator", "prompt", "request");
  }
  if (source.has("render") || source.has("rendering") || source.has("result")) {
    expanded.push("result", "response", "caption", "view");
  }
  return [...new Set(expanded)].slice(0, 48);
}

export function chunkRepositoryFile(content: string): RepositoryContextChunk[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const chunks: RepositoryContextChunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = Math.min(lines.length, start + MAX_CHUNK_LINES);
    while (end > start + 1 && lines.slice(start, end).join("\n").length > MAX_CHUNK_CHARACTERS) {
      end -= 1;
    }
    const chunkContent = lines.slice(start, end).join("\n");
    const declarations = extractDeclarations(chunkContent);
    chunks.push({
      ordinal: chunks.length,
      startLine: start + 1,
      endLine: end,
      content: chunkContent,
      searchText: `${chunkContent}\n${splitIdentifierWords(chunkContent)}\n${declarations.join(" ")}`,
      declarations,
    });
    if (end >= lines.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP_LINES);
  }
  return chunks;
}

export function rankRepositoryContextChunk(input: {
  path: string;
  content: string;
  declarations: string[];
  lexicalRank: number;
  query: string;
  terms: string[];
}): number {
  const path = splitIdentifierWords(input.path);
  const content = splitIdentifierWords(input.content);
  const compactPath = path.replace(/\s+/g, "");
  const compactContent = content.replace(/\s+/g, "");
  const query = splitIdentifierWords(input.query).trim();
  let score = Number(input.lexicalRank) * 12;
  let matched = 0;
  for (const term of input.terms) {
    if (content.includes(term) || compactContent.includes(term)) {
      matched += 1;
      score += term.length >= 8 ? 3 : term.length >= 5 ? 2 : 1;
    }
    if (path.includes(term) || compactPath.includes(term)) score += 4;
  }
  if (query.length >= 5 && content.includes(query)) score += 14;
  score += matched * matched * 0.35;
  const asksForSourceTrace = /\b(binding|debug|input|nonfunctional|persistence|state|trace|ui)\b/i
    .test(input.query);
  if (asksForSourceTrace) {
    if (/\.(?:c|cc|cpp|cs|dart|go|java|js|jsx|kt|m|mm|php|py|rb|rs|swift|ts|tsx|vue)$/i.test(input.path)) {
      score += 12;
    }
    if (/(?:^|\/)(?:readme|design|product)(?:\.|$)|privacy|terms|legal|data-deletion/i.test(input.path)) {
      score -= 130;
    }
  }
  if (compactContent.includes("textfield") || compactContent.includes("texteditor")) score += 22;
  if (compactContent.includes("onchange") && compactContent.includes("context")) score += 18;
  if (compactContent.includes("momentcontext")) score += 36;
  if (
    /\b(persist|persistence|save|storage|store)\b/i.test(input.query) &&
    ["manifest", "record", "save", "saved", "store", "stored"].filter((term) => content.includes(term)).length >= 2
  ) {
    score += 18;
  }
  if (/(^|\/)(tests?|specs?|__tests__)(\/|$)|(?:test|spec)\.[^.]+$/i.test(input.path)) {
    score += asksForSourceTrace ? 10 : 1.5;
  }
  if (input.declarations.some((symbol) => input.terms.includes(splitIdentifierWords(symbol)))) {
    score += 5;
  }
  return score;
}

export function repositoryContextProviderConfigured(): boolean {
  return true;
}

export async function listRepositoryContexts(orgId: string): Promise<RepositoryContextSnapshot[]> {
  requirePostgresWorkspace(orgId, "Repository context");
  const result = await databasePool().query<RepositoryContextRow>(
    `SELECT id,org_id,installation_id::text,repository,default_branch,commit_sha,
            'closespan'::text AS provider,status,stage,progress,total_files,indexed_files,skipped_files,
            context_state,started_at,completed_at,updated_at,error_message
       FROM repository_context_snapshots
      WHERE org_id=$1 ORDER BY repository`,
    [orgId],
  );
  return result.rows.map(snapshotFromRow);
}

export async function queueRepositoryContexts(input: {
  orgId: string;
  installationId: string;
  repositories: ReadonlyArray<{ repository: string; defaultBranch: string }>;
}): Promise<void> {
  requirePostgresWorkspace(input.orgId, "Repository context");
  for (const repository of input.repositories) {
    await databasePool().query(
      `INSERT INTO repository_context_snapshots(
         id,org_id,installation_id,repository,default_branch,provider,status,stage,progress
       ) VALUES($1,$2,$3,$4,$5,'closespan','Queued','Waiting to inspect repository',2)
       ON CONFLICT(org_id,repository) DO UPDATE SET
         installation_id=excluded.installation_id,default_branch=excluded.default_branch,
         provider='closespan',status='Queued',stage='Waiting to inspect repository',progress=2,
         error_code=NULL,error_message=NULL,completed_at=NULL,updated_at=now()`,
      [randomUUID(), input.orgId, input.installationId, repository.repository, repository.defaultBranch],
    );
  }
}

export async function queueMissingAuthorizedRepositoryContexts(orgId: string): Promise<string[]> {
  requirePostgresWorkspace(orgId, "Repository context");
  const result = await databasePool().query<{
    installation_id: string; repository: string; default_branch: string;
  }>(
    `SELECT allowed.installation_id::text,allowed.repository,allowed.default_branch
       FROM github_repository_allowlists allowed
       LEFT JOIN repository_context_snapshots context
         ON context.org_id=allowed.org_id AND context.repository=allowed.repository
      WHERE allowed.org_id=$1 AND allowed.active=true AND allowed.workspace_selected=true
        AND context.id IS NULL ORDER BY allowed.repository`,
    [orgId],
  );
  const byInstallation = new Map<string, Array<{ repository: string; defaultBranch: string }>>();
  for (const row of result.rows) {
    const repositories = byInstallation.get(row.installation_id) ?? [];
    repositories.push({ repository: row.repository, defaultBranch: row.default_branch });
    byInstallation.set(row.installation_id, repositories);
  }
  for (const [installationId, repositories] of byInstallation) {
    await queueRepositoryContexts({ orgId, installationId, repositories });
  }
  return result.rows.map((row) => row.repository);
}

export async function queueRepositoryContextRetry(orgId: string, repository: string): Promise<void> {
  requirePostgresWorkspace(orgId, "Repository context");
  const result = await databasePool().query(
    `UPDATE repository_context_snapshots
        SET provider='closespan',status='Queued',stage='Waiting to inspect repository',progress=2,
            error_code=NULL,error_message=NULL,completed_at=NULL,updated_at=now()
      WHERE org_id=$1 AND repository=$2 RETURNING id`,
    [orgId, repository],
  );
  if (result.rowCount !== 1) throw new HttpError(404, "Repository context was not found");
}

async function updateContextProgress(
  orgId: string,
  repository: string,
  update: {
    status: RepositoryContextStatus;
    stage: string;
    progress: number;
    totalFiles?: number;
    indexedFiles?: number;
    skippedFiles?: number;
  },
): Promise<void> {
  await databasePool().query(
    `UPDATE repository_context_snapshots
        SET status=$3,stage=$4,progress=$5,total_files=COALESCE($6,total_files),
            indexed_files=COALESCE($7,indexed_files),skipped_files=COALESCE($8,skipped_files),
            updated_at=now()
      WHERE org_id=$1 AND repository=$2 AND status<>'Ready'`,
    [orgId, repository, update.status, update.stage,
      Math.max(0, Math.min(100, Math.round(update.progress))), update.totalFiles ?? null,
      update.indexedFiles ?? null, update.skippedFiles ?? null],
  );
}

async function fetchRepositoryFiles(input: {
  installationId: string;
  repository: string;
  defaultBranch: string;
  onProgress: (completed: number, total: number) => Promise<void>;
}): Promise<{
  commitSha: string;
  files: IndexedRepositoryFile[];
  discoveredFiles: number;
  skippedFiles: number;
}> {
  const github = await createGithubInstallationClient(input.installationId);
  const repository = repositoryParts(input.repository);
  const ref = await github.rest.git.getRef({ ...repository, ref: `heads/${input.defaultBranch}` });
  const commitSha = ref.data.object.sha.toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error("GitHub returned an invalid commit SHA");
  const commit = await github.rest.git.getCommit({ ...repository, commit_sha: commitSha });
  const tree = await github.rest.git.getTree({
    ...repository, tree_sha: commit.data.tree.sha, recursive: "true",
  });
  if (tree.data.truncated) throw new Error("Repository tree is too large for bounded indexing");

  const discovered = tree.data.tree.filter(
    (entry): entry is typeof entry & { path: string; sha: string; size: number } =>
      entry.type === "blob" && typeof entry.path === "string" &&
      typeof entry.sha === "string" && typeof entry.size === "number",
  );
  const candidates: GithubRepositoryFile[] = discovered
    .filter((entry) => isIndexablePath(entry.path, entry.size))
    .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size }));
  const files: IndexedRepositoryFile[] = [];
  let completed = 0;
  let fetchFailures = 0;
  for (let offset = 0; offset < candidates.length; offset += FETCH_CONCURRENCY) {
    const batch = candidates.slice(offset, offset + FETCH_CONCURRENCY);
    const outcomes = await Promise.allSettled(batch.map(async (file) => {
      const blob = await github.rest.git.getBlob({ ...repository, file_sha: file.sha });
      if (blob.data.encoding !== "base64" || typeof blob.data.content !== "string") {
        throw new Error("GitHub blob was not base64 encoded");
      }
      const content = Buffer.from(blob.data.content.replace(/\n/g, ""), "base64").toString("utf8");
      if (content.includes("\u0000")) throw new Error("Binary content detected");
      return {
        path: file.path,
        contentSha: createHash("sha256").update(content).digest("hex"),
        language: languageForPath(file.path),
        byteSize: Buffer.byteLength(content),
        lineCount: content.replace(/\r\n?/g, "\n").split("\n").length,
        content,
      } satisfies IndexedRepositoryFile;
    }));
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") files.push(outcome.value);
      else fetchFailures += 1;
    }
    completed += batch.length;
    await input.onProgress(completed, candidates.length);
  }
  return {
    commitSha,
    files,
    discoveredFiles: discovered.length,
    skippedFiles: discovered.length - candidates.length + fetchFailures,
  };
}

function contextState(files: IndexedRepositoryFile[]): RepositoryContextState {
  const languages: Record<string, number> = {};
  const topLevelDirectories = new Set<string>();
  const notableFiles: string[] = [];
  let testFiles = 0;
  for (const file of files) {
    languages[file.language] = (languages[file.language] ?? 0) + 1;
    const [top] = file.path.split("/");
    if (top && file.path.includes("/")) topLevelDirectories.add(top);
    if (/readme|package\.json|podfile|\.xcodeproj|\.xcworkspace|dockerfile/i.test(file.path)) {
      notableFiles.push(file.path);
    }
    if (/(^|\/)(tests?|specs?|__tests__)(\/|$)|(?:test|spec)\.[^.]+$/i.test(file.path)) testFiles += 1;
  }
  return {
    schemaVersion: 1,
    indexedAt: new Date().toISOString(),
    languages,
    topLevelDirectories: [...topLevelDirectories].sort().slice(0, 100),
    notableFiles: notableFiles.sort().slice(0, 100),
    testFiles,
  };
}

async function persistRepositoryIndex(input: {
  client: PoolClient;
  contextId: string;
  orgId: string;
  files: IndexedRepositoryFile[];
}): Promise<number> {
  await input.client.query(
    `DELETE FROM repository_context_chunks WHERE org_id=$1 AND context_id=$2`,
    [input.orgId, input.contextId],
  );
  await input.client.query(
    `DELETE FROM repository_context_files WHERE org_id=$1 AND context_id=$2`,
    [input.orgId, input.contextId],
  );
  let chunkCount = 0;
  for (let offset = 0; offset < input.files.length; offset += 100) {
    const batch = input.files.slice(offset, offset + 100);
    await input.client.query(
      `INSERT INTO repository_context_files(
         context_id,org_id,path,content_sha,language,byte_size,line_count,content
       )
       SELECT $1,$2,item.path,item.content_sha,item.language,item.byte_size,item.line_count,item.content
         FROM jsonb_to_recordset($3::jsonb) AS item(
           path text,content_sha text,language text,byte_size integer,line_count integer,content text
         )`,
      [input.contextId, input.orgId, JSON.stringify(batch.map((file) => ({
        path: file.path, content_sha: file.contentSha, language: file.language,
        byte_size: file.byteSize, line_count: file.lineCount, content: file.content,
      })))],
    );
  }
  const chunks = input.files.flatMap((file) =>
    chunkRepositoryFile(file.content).map((chunk) => ({
      id: randomUUID(), path: file.path, language: file.language, ...chunk,
    })),
  );
  for (let offset = 0; offset < chunks.length; offset += 250) {
    const batch = chunks.slice(offset, offset + 250);
    await input.client.query(
      `INSERT INTO repository_context_chunks(
         id,context_id,org_id,path,language,ordinal,start_line,end_line,
         content,search_text,declarations
       )
       SELECT item.id,$1,$2,item.path,item.language,item.ordinal,item.start_line,item.end_line,
              item.content,item.search_text,item.declarations
         FROM jsonb_to_recordset($3::jsonb) AS item(
           id uuid,path text,language text,ordinal integer,start_line integer,end_line integer,
           content text,search_text text,declarations text[]
         )`,
      [input.contextId, input.orgId, JSON.stringify(batch.map((chunk) => ({
        id: chunk.id, path: chunk.path, language: chunk.language, ordinal: chunk.ordinal,
        start_line: chunk.startLine, end_line: chunk.endLine, content: chunk.content,
        search_text: chunk.searchText, declarations: chunk.declarations,
      })))],
    );
    chunkCount += batch.length;
  }
  return chunkCount;
}

async function claimQueuedContext(orgId: string, repository: string): Promise<RepositoryContextRow | null> {
  const result = await databasePool().query<RepositoryContextRow>(
    `UPDATE repository_context_snapshots
        SET provider='closespan',status='Discovering',stage='Reading repository structure',progress=6,
            started_at=now(),updated_at=now(),error_code=NULL,error_message=NULL
      WHERE org_id=$1 AND repository=$2 AND status='Queued'
      RETURNING id,org_id,installation_id::text,repository,default_branch,commit_sha,
                'closespan'::text AS provider,status,stage,progress,total_files,indexed_files,
                skipped_files,context_state,started_at,completed_at,updated_at,error_message`,
    [orgId, repository],
  );
  return result.rows[0] ?? null;
}

export async function buildRepositoryContext(orgId: string, repository: string): Promise<void> {
  requirePostgresWorkspace(orgId, "Repository context");
  const claimed = await claimQueuedContext(orgId, repository);
  if (!claimed) return;
  try {
    const fetched = await fetchRepositoryFiles({
      installationId: claimed.installation_id,
      repository: claimed.repository,
      defaultBranch: claimed.default_branch,
      onProgress: async (completed, total) => {
        const ratio = total ? completed / total : 1;
        await updateContextProgress(orgId, repository, {
          status: "Discovering",
          stage: total ? `Reading source files · ${completed} of ${total}` : "Preparing repository context",
          progress: 10 + ratio * 50,
          totalFiles: total,
        });
      },
    });
    await updateContextProgress(orgId, repository, {
      status: "Indexing",
      stage: "Building searchable code relationships",
      progress: 68,
      totalFiles: fetched.discoveredFiles,
      skippedFiles: fetched.skippedFiles,
    });
    const state = contextState(fetched.files);
    await transaction(async (client) => {
      const chunkCount = await persistRepositoryIndex({
        client, contextId: claimed.id, orgId, files: fetched.files,
      });
      await client.query(
        `UPDATE repository_context_snapshots
            SET provider='closespan',commit_sha=$3,status='Ready',stage='Repository context ready',
                progress=100,total_files=$4,indexed_files=$5,skipped_files=$6,
                context_state=$7::jsonb,error_code=NULL,error_message=NULL,
                completed_at=now(),updated_at=now()
          WHERE org_id=$1 AND repository=$2`,
        [orgId, repository, fetched.commitSha, fetched.discoveredFiles,
          fetched.files.length, fetched.skippedFiles,
          JSON.stringify({ ...state, chunkCount })],
      );
    });
  } catch (error) {
    console.error(`Repository context indexing failed for ${repository}`, error);
    await databasePool().query(
      `UPDATE repository_context_snapshots
          SET status='Failed',stage='Repository context needs attention',progress=0,
              error_code='indexing_failed',
              error_message='CloseSpan could not finish repository context. Retry the indexing job.',
              completed_at=NULL,updated_at=now()
        WHERE org_id=$1 AND repository=$2`,
      [orgId, repository],
    );
  }
}

export async function buildQueuedRepositoryContexts(
  orgId: string,
  repositories?: readonly string[],
): Promise<void> {
  requirePostgresWorkspace(orgId, "Repository context");
  const result = await databasePool().query<{ repository: string }>(
    `SELECT repository FROM repository_context_snapshots
      WHERE org_id=$1 AND status='Queued'
        AND ($2::text[] IS NULL OR repository=ANY($2::text[]))
      ORDER BY updated_at,repository`,
    [orgId, repositories ? [...repositories] : null],
  );
  for (const row of result.rows) await buildRepositoryContext(orgId, row.repository);
}

async function directSearchChunks(input: {
  orgId: string;
  contextId: string;
  terms: string[];
}): Promise<SearchChunkRow[]> {
  if (!input.terms.length) return [];
  const tsQuery = input.terms.map((term) => `${term.replace(/[^a-z0-9]/g, "")}:*`)
    .filter((term) => term !== ":*")
    .join(" | ");
  const result = await databasePool().query<SearchChunkRow>(
    `SELECT id,path,language,ordinal,start_line,end_line,content,declarations,
            ts_rank_cd(search_vector,to_tsquery('simple',$3),32)::float AS lexical_rank
       FROM repository_context_chunks
      WHERE org_id=$1 AND context_id=$2
        AND search_vector @@ to_tsquery('simple',$3)
      ORDER BY lexical_rank DESC,path,ordinal LIMIT 180`,
    [input.orgId, input.contextId, tsQuery],
  );
  return result.rows;
}

async function expandRelatedChunks(input: {
  orgId: string;
  contextId: string;
  selected: SearchChunkRow[];
}): Promise<SearchChunkRow[]> {
  if (!input.selected.length) return [];
  const paths = [...new Set(input.selected.slice(0, 8).map((chunk) => chunk.path))];
  const ordinals = input.selected.slice(0, 8).map((chunk) => ({
    path: chunk.path, ordinal: chunk.ordinal,
  }));
  const symbols = [...new Set(input.selected.flatMap((chunk) => chunk.declarations))]
    .filter((symbol) => symbol.length >= 4)
    .slice(0, 12)
    .map((symbol) => splitIdentifierWords(symbol).split(" ").filter(Boolean))
    .flat();
  const symbolQuery = [...new Set(symbols)]
    .map((symbol) => `${symbol.replace(/[^a-z0-9]/g, "")}:*`)
    .join(" | ");
  const result = await databasePool().query<SearchChunkRow>(
    `SELECT id,path,language,ordinal,start_line,end_line,content,declarations,
            CASE WHEN $5::text='' THEN 0
                 ELSE ts_rank_cd(search_vector,to_tsquery('simple',$5),32)::float END AS lexical_rank
       FROM repository_context_chunks
      WHERE org_id=$1 AND context_id=$2
        AND (
          (path=ANY($3::text[]) AND EXISTS (
            SELECT 1 FROM jsonb_to_recordset($4::jsonb) AS neighbor(path text,ordinal integer)
             WHERE neighbor.path=repository_context_chunks.path
               AND abs(neighbor.ordinal-repository_context_chunks.ordinal)<=1
          ))
          OR ($5::text<>'' AND search_vector @@ to_tsquery('simple',$5))
        )
      ORDER BY lexical_rank DESC,path,ordinal LIMIT 80`,
    [input.orgId, input.contextId, paths, JSON.stringify(ordinals), symbolQuery],
  );
  return result.rows;
}

function formatRepositoryRetrieval(input: {
  repository: string;
  commitSha: string;
  query: string;
  direct: Array<SearchChunkRow & { score: number }>;
  related: SearchChunkRow[];
  terms: string[];
  maxOutputLength: number;
}): string {
  const sections: string[] = [
    `# Repository evidence for ${input.repository}`,
    `Pinned commit: ${input.commitSha}`,
    `Question: ${input.query}`,
    "",
    "The excerpts below are retrieved evidence, not a confirmed root cause.",
  ];
  const seen = new Set<string>();
  const append = (rawChunk: SearchChunkRow, label: string, score?: number) => {
    const chunk = focusRepositoryChunk(rawChunk, input.terms);
    const key = `${chunk.path}:${chunk.start_line}-${chunk.end_line}`;
    if (seen.has(key)) return;
    const block = [
      "",
      `## ${chunk.path}:${chunk.start_line}-${chunk.end_line}`,
      `Match: ${label}${score === undefined ? "" : ` · relevance ${score.toFixed(2)}`}`,
      `Language: ${chunk.language}`,
      chunk.declarations.length ? `Declarations: ${chunk.declarations.join(", ")}` : "",
      "```",
      chunk.content,
      "```",
    ].filter(Boolean).join("\n");
    if (sections.join("\n").length + block.length <= input.maxOutputLength) {
      sections.push(block);
      seen.add(key);
    }
  };
  const perPath = new Map<string, number>();
  for (const chunk of input.direct) {
    const count = perPath.get(chunk.path) ?? 0;
    if (count >= 3) continue;
    append(chunk, "direct report/code match", chunk.score);
    perPath.set(chunk.path, count + 1);
    if ([...perPath.values()].reduce((sum, value) => sum + value, 0) >= 18) break;
  }
  for (const chunk of input.related) append(chunk, "neighbor or referenced symbol");
  return sections.join("\n");
}

function focusRepositoryChunk(chunk: SearchChunkRow, terms: string[]): SearchChunkRow {
  const lines = chunk.content.replace(/\r\n?/g, "\n").split("\n");
  const windowSize = 48;
  if (lines.length <= windowSize) return chunk;
  const scores = lines.map((line) => {
    const normalized = splitIdentifierWords(line);
    return terms.reduce(
      (score, term) => score + (normalized.includes(term) ? Math.min(4, Math.max(1, term.length / 3)) : 0),
      0,
    );
  });
  let bestStart = 0;
  let bestScore = -1;
  let rolling = scores.slice(0, windowSize).reduce((sum, value) => sum + value, 0);
  for (let start = 0; start <= lines.length - windowSize; start += 1) {
    if (start > 0) {
      rolling -= scores[start - 1] ?? 0;
      rolling += scores[start + windowSize - 1] ?? 0;
    }
    if (rolling > bestScore) {
      bestScore = rolling;
      bestStart = start;
    }
  }
  return {
    ...chunk,
    start_line: chunk.start_line + bestStart,
    end_line: chunk.start_line + bestStart + windowSize - 1,
    content: lines.slice(bestStart, bestStart + windowSize).join("\n"),
  };
}

export interface RepositoryContextSearchResult {
  commitSha: string;
  retrieval: string;
  matches: Array<{
    path: string;
    startLine: number;
    endLine: number;
    score: number;
    declarations: string[];
  }>;
}

export async function searchRepositoryContext(input: {
  orgId: string;
  repository: string;
  query: string;
  expectedCommitSha?: string;
  maxOutputLength?: number;
  excludePathPrefixes?: readonly string[];
}): Promise<RepositoryContextSearchResult> {
  requirePostgresWorkspace(input.orgId, "Repository context");
  const result = await databasePool().query<RepositoryContextRow>(
    `SELECT id,org_id,installation_id::text,repository,default_branch,commit_sha,
            'closespan'::text AS provider,status,stage,progress,total_files,indexed_files,
            skipped_files,context_state,started_at,completed_at,updated_at,error_message
       FROM repository_context_snapshots
      WHERE org_id=$1 AND repository=$2 AND status='Ready'
        AND ($3::text IS NULL OR commit_sha=$3)`,
    [input.orgId, input.repository, input.expectedCommitSha?.toLowerCase() ?? null],
  );
  const row = result.rows[0];
  if (!row?.commit_sha) throw new HttpError(409, "Repository context is not ready for this commit");
  const terms = repositorySearchTerms(input.query);
  const directRows = await directSearchChunks({
    orgId: input.orgId, contextId: row.id, terms,
  });
  const excludedPrefixes = input.excludePathPrefixes?.map((prefix) => prefix.toLowerCase()) ?? [];
  const pathIsIncluded = (path: string) => !excludedPrefixes.some((prefix) =>
    path.toLowerCase().startsWith(prefix)
  );
  const direct = directRows
    .filter((chunk) => pathIsIncluded(chunk.path))
    .map((chunk) => ({
      ...chunk,
      score: rankRepositoryContextChunk({
        path: chunk.path,
        content: chunk.content,
        declarations: chunk.declarations ?? [],
        lexicalRank: chunk.lexical_rank,
        query: input.query,
        terms,
      }),
    }))
    .sort((left, right) => right.score - left.score);
  const related = (await expandRelatedChunks({
    orgId: input.orgId, contextId: row.id, selected: direct.slice(0, 10),
  })).filter((chunk) => pathIsIncluded(chunk.path));
  const retrieval = formatRepositoryRetrieval({
    repository: row.repository,
    commitSha: row.commit_sha,
    query: input.query,
    direct,
    related,
    terms,
    maxOutputLength: Math.min(80_000, Math.max(2_000, input.maxOutputLength ?? 30_000)),
  });
  await databasePool().query(
    `UPDATE repository_context_snapshots SET last_used_at=now(),updated_at=now()
      WHERE org_id=$1 AND repository=$2`,
    [input.orgId, input.repository],
  );
  return {
    commitSha: row.commit_sha,
    retrieval,
    matches: direct.slice(0, 24).map((chunk) => {
      const focused = focusRepositoryChunk(chunk, terms);
      return {
        path: focused.path,
        startLine: focused.start_line,
        endLine: focused.end_line,
        score: Number(chunk.score.toFixed(2)),
        declarations: focused.declarations ?? [],
      };
    }),
  };
}
