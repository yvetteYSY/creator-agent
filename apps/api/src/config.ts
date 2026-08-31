export interface ApiConfiguration {
  issuer: string;
  audience: string;
  databaseUrl: string;
  allowedOrigin: string;
  host: string;
  port: number;
}

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function loadApiConfiguration(environment: NodeJS.ProcessEnv): ApiConfiguration {
  const port = environment.API_PORT ?? environment.PORT ?? "4320";
  const parsedPort = Number.parseInt(port, 10);
  if (!/^\d+$/.test(port) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error("API_PORT must be a valid TCP port.");
  }
  const allowedOrigin = environment.API_ALLOWED_ORIGIN?.trim() ?? "http://127.0.0.1:4173";
  const host = environment.API_HOST?.trim() ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "0.0.0.0") {
    throw new Error("API_HOST must be 127.0.0.1 or 0.0.0.0.");
  }
  const origin = new URL(allowedOrigin);
  if (!/^https?:$/.test(origin.protocol) || origin.origin !== allowedOrigin) {
    throw new Error("API_ALLOWED_ORIGIN must be one exact HTTP(S) origin.");
  }
  return {
    issuer: required(environment, "AUTH0_ISSUER_BASE_URL"),
    audience: required(environment, "AUTH0_AUDIENCE"),
    databaseUrl: required(environment, "DATABASE_URL"),
    allowedOrigin,
    host,
    port: parsedPort,
  };
}
