import { createHmac, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";
import { importPKCS8, SignJWT } from "jose";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const MAXIMUM_IMPORT_BYTES = 1024 * 1024;
const REPOSITORY_COMPONENT = /^[A-Za-z0-9_.-]{1,100}$/;
const ALLOWED_TEXT_EXTENSION = /\.(?:md|mdx|txt)$/i;

export interface GitHubAppConfiguration {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  privateKey: string;
  webhookSecret: string;
  slug: string;
}

export interface GitHubInstallation {
  id: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  suspended: boolean;
}

export interface GitHubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface GitHubTextFile {
  content: string;
  sha: string;
  htmlUrl: string;
  size: number;
}

export class GitHubAppUnavailableError extends Error {}
export class GitHubContentValidationError extends Error {}
export class GitHubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function optional(environment: NodeJS.ProcessEnv, name: string) {
  return environment[name]?.trim() || undefined;
}

export function loadGitHubAppConfiguration(environment: NodeJS.ProcessEnv) {
  const values = {
    clientId: optional(environment, "GITHUB_APP_CLIENT_ID"),
    clientSecret: optional(environment, "GITHUB_APP_CLIENT_SECRET"),
    callbackUrl: optional(environment, "GITHUB_APP_CALLBACK_URL"),
    privateKey: optional(environment, "GITHUB_APP_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
    webhookSecret: optional(environment, "GITHUB_APP_WEBHOOK_SECRET"),
    slug: optional(environment, "GITHUB_APP_SLUG"),
  };
  if (Object.values(values).every((value) => value === undefined)) return undefined;
  if (Object.values(values).some((value) => value === undefined)) {
    throw new Error("GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_APP_CALLBACK_URL, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_WEBHOOK_SECRET, and GITHUB_APP_SLUG must be configured together.");
  }
  const callback = new URL(values.callbackUrl!);
  const localCallback = callback.protocol === "http:" && ["127.0.0.1", "localhost"].includes(callback.hostname);
  if (callback.protocol !== "https:" && !localCallback) throw new Error("GITHUB_APP_CALLBACK_URL must use HTTPS outside localhost.");
  if (!/^[a-z0-9-]{1,100}$/.test(values.slug!)) throw new Error("GITHUB_APP_SLUG is invalid.");
  if (values.webhookSecret!.length < 8) throw new Error("GITHUB_APP_WEBHOOK_SECRET must be at least 8 characters.");
  return values as GitHubAppConfiguration;
}

export function verifyGitHubWebhookSignature(secret: string, payload: Uint8Array, signature?: string) {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(signature, "utf8");
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export interface GitHubAppApi {
  installationUrl(state: string): string;
  authorizeUserInstallation(code: string, installationId: number): Promise<GitHubInstallation>;
  getInstallation(installationId: number): Promise<GitHubInstallation>;
  listRepositories(installationId: number): Promise<GitHubRepository[]>;
  readTextFile(input: {
    installationId: number;
    owner: string;
    repository: string;
    path: string;
    ref?: string;
  }): Promise<GitHubTextFile>;
}

export class GitHubAppClient implements GitHubAppApi {
  constructor(
    private readonly configuration: GitHubAppConfiguration,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  installationUrl(state: string) {
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(state)) throw new GitHubContentValidationError("GitHub connection state is invalid.");
    return `https://github.com/apps/${encodeURIComponent(this.configuration.slug)}/installations/new?state=${encodeURIComponent(state)}`;
  }

  async authorizeUserInstallation(code: string, installationId: number) {
    validateInstallationId(installationId);
    if (!/^[A-Za-z0-9_-]{8,500}$/.test(code)) throw new GitHubContentValidationError("GitHub authorization code is invalid.");
    const tokenResponse = await this.fetcher("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.configuration.clientId,
        client_secret: this.configuration.clientSecret,
        code,
        redirect_uri: this.configuration.callbackUrl,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new GitHubApiError(`GitHub authorization failed with status ${tokenResponse.status}.`, tokenResponse.status);
    const tokenBody = await jsonObject(tokenResponse);
    const userToken = text(tokenBody.access_token, "user access token", 4096);
    const response = await this.request("/user/installations?per_page=100", userToken);
    const body = await jsonObject(response);
    if (!Array.isArray(body.installations)) throw new GitHubApiError("GitHub returned an invalid user installation list.", 502);
    const selected = body.installations.map((value) => object(value, "installation"))
      .find((installation) => installation.id === installationId);
    if (!selected) throw new GitHubContentValidationError("This GitHub user cannot administer the selected installation.");
    return installation(selected);
  }

  async getInstallation(installationId: number) {
    validateInstallationId(installationId);
    const response = await this.appRequest(`/app/installations/${installationId}`);
    const body = await jsonObject(response);
    return installation(body);
  }

  async listRepositories(installationId: number) {
    const token = await this.installationToken(installationId);
    const repositories: GitHubRepository[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const response = await this.installationRequest(`/installation/repositories?per_page=100&page=${page}`, token);
      const body = await jsonObject(response);
      if (!Array.isArray(body.repositories)) throw new GitHubApiError("GitHub returned an invalid repository list.", 502);
      const pageRepositories = body.repositories.map((value) => {
        const repository = object(value, "repository");
        const owner = object(repository.owner, "repository owner");
        return {
          id: positiveInteger(repository.id, "repository ID"),
          owner: repositoryComponent(owner.login, "repository owner"),
          name: repositoryComponent(repository.name, "repository name"),
          fullName: text(repository.full_name, "repository full name", 201),
          private: repository.private === true,
          defaultBranch: text(repository.default_branch, "default branch", 255),
        } satisfies GitHubRepository;
      });
      repositories.push(...pageRepositories);
      if (pageRepositories.length < 100) break;
    }
    return repositories;
  }

  async readTextFile(input: {
    installationId: number;
    owner: string;
    repository: string;
    path: string;
    ref?: string;
  }) {
    const owner = repositoryComponent(input.owner, "repository owner");
    const repository = repositoryComponent(input.repository, "repository name");
    const path = importPath(input.path);
    const reference = input.ref ? text(input.ref, "Git reference", 255) : undefined;
    const token = await this.installationToken(input.installationId, { owner, repository });
    const encodedPath = path.split("/").map(encodeURIComponent).join("%2F");
    const query = reference ? `?ref=${encodeURIComponent(reference)}` : "";
    const response = await this.installationRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}${query}`,
      token,
    );
    const body = await jsonObject(response);
    if (body.type !== "file" || body.encoding !== "base64") {
      throw new GitHubContentValidationError("The selected path must be one file.");
    }
    const declaredSize = positiveInteger(body.size, "file size", true);
    if (declaredSize > MAXIMUM_IMPORT_BYTES) {
      throw new GitHubContentValidationError("GitHub text imports must be at most 1 MB.");
    }
    const encoded = text(body.content, "encoded file content", Math.ceil(MAXIMUM_IMPORT_BYTES * 1.5));
    const decoded = Buffer.from(encoded.replace(/\s/g, ""), "base64");
    if (decoded.byteLength > MAXIMUM_IMPORT_BYTES) {
      throw new GitHubContentValidationError("GitHub text imports must be at most 1 MB.");
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
    } catch {
      throw new GitHubContentValidationError("The selected GitHub file must contain valid UTF-8 text.");
    }
    if (!content.trim()) throw new GitHubContentValidationError("The selected GitHub file is empty.");
    return {
      content,
      sha: text(body.sha, "blob SHA", 100),
      htmlUrl: httpsUrl(body.html_url, "GitHub file URL"),
      size: decoded.byteLength,
    } satisfies GitHubTextFile;
  }

  private async installationToken(installationId: number, repository?: { owner: string; repository: string }) {
    validateInstallationId(installationId);
    const response = await this.appRequest(`/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      body: JSON.stringify({
        permissions: { contents: "read", metadata: "read" },
        ...(repository ? { repositories: [repository.repository] } : {}),
      }),
      headers: { "content-type": "application/json" },
    });
    const body = await jsonObject(response);
    return text(body.token, "installation token", 4096);
  }

  private async appRequest(path: string, init: RequestInit = {}) {
    const jwt = await this.appJwt();
    return this.request(path, jwt, init);
  }

  private installationRequest(path: string, token: string) {
    return this.request(path, token);
  }

  private async request(path: string, token: string, init: RequestInit = {}) {
    const response = await this.fetcher(`${GITHUB_API}${path}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": `creator-agent/${this.configuration.slug}`,
        "x-github-api-version": GITHUB_API_VERSION,
        ...init.headers,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new GitHubApiError(`GitHub API request failed with status ${response.status}.`, response.status);
    return response;
  }

  private async appJwt() {
    const key = await importPKCS8(this.configuration.privateKey, "RS256");
    const now = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(this.configuration.clientId)
      .setIssuedAt(now - 60)
      .setExpirationTime(now + 9 * 60)
      .sign(key);
  }
}

function installation(body: Record<string, unknown>) {
  const account = object(body.account, "installation account");
  const type = account.type;
  if (type !== "User" && type !== "Organization") throw new GitHubApiError("GitHub returned an unsupported account type.", 502);
  return {
    id: positiveInteger(body.id, "installation ID"),
    accountLogin: repositoryComponent(account.login, "account login"),
    accountType: type,
    repositorySelection: body.repository_selection === "all" ? "all" : "selected",
    suspended: body.suspended_at !== null && body.suspended_at !== undefined,
  } satisfies GitHubInstallation;
}

function validateInstallationId(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new GitHubContentValidationError("GitHub installation ID is invalid.");
}

function repositoryComponent(value: unknown, label: string) {
  const result = text(value, label, 100);
  if (!REPOSITORY_COMPONENT.test(result)) throw new GitHubContentValidationError(`${label} is invalid.`);
  return result;
}

function importPath(value: string) {
  const path = text(value, "file path", 1024).replace(/\\/g, "/");
  const segments = path.split("/");
  if (path.startsWith("/") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new GitHubContentValidationError("GitHub file path is invalid.");
  }
  if (!ALLOWED_TEXT_EXTENSION.test(path)) {
    throw new GitHubContentValidationError("Only Markdown, MDX, and plain-text files can be imported.");
  }
  return path;
}

function object(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new GitHubApiError(`GitHub returned an invalid ${label}.`, 502);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new GitHubApiError(`GitHub returned an invalid ${label}.`, 502);
  }
  return value.trim();
}

function positiveInteger(value: unknown, label: string, allowZero = false) {
  if (!Number.isSafeInteger(value) || (allowZero ? Number(value) < 0 : Number(value) <= 0)) {
    throw new GitHubApiError(`GitHub returned an invalid ${label}.`, 502);
  }
  return Number(value);
}

function httpsUrl(value: unknown, label: string) {
  const result = text(value, label, 2048);
  const url = new URL(result);
  if (url.protocol !== "https:" || url.hostname !== "github.com") throw new GitHubApiError(`GitHub returned an invalid ${label}.`, 502);
  return url.toString();
}

async function jsonObject(response: Response) {
  try {
    return object(await response.json(), "response");
  } catch (error) {
    if (error instanceof GitHubApiError) throw error;
    throw new GitHubApiError("GitHub returned an invalid JSON response.", 502);
  }
}
