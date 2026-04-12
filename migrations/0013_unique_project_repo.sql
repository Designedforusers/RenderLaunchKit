-- Prevent duplicate projects for the same GitHub repository.
-- Uses lower() for case-insensitive matching since GitHub treats
-- owner/repo as case-insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS projects_repo_owner_repo_name_unique_idx
  ON projects (lower(repo_owner), lower(repo_name));
