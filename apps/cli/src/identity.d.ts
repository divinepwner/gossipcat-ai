export declare function getUserId(projectRoot: string): string;
/** Normalize git remote URL to canonical form: hostname/owner/repo */
export declare function normalizeGitUrl(url: string): string | null;
export declare function getTeamUserId(email: string, teamSalt: string): string;
export declare function getGitEmail(): string | null;
export declare function getProjectId(projectRoot: string): string;
