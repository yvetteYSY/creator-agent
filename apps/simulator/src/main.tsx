import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CreatorAuthProvider, RequireAuthentication, resolveAuthConfiguration } from "./auth";
import { CreatorWorkspaceProvider, RequireCreatorWorkspace, resolveCreatorApiConfiguration } from "./creator-workspace";
import "./styles.css";

const authConfiguration = resolveAuthConfiguration({
  VITE_AUTH_MODE: import.meta.env.VITE_AUTH_MODE,
  VITE_AUTH0_DOMAIN: import.meta.env.VITE_AUTH0_DOMAIN,
  VITE_AUTH0_CLIENT_ID: import.meta.env.VITE_AUTH0_CLIENT_ID,
  VITE_AUTH0_AUDIENCE: import.meta.env.VITE_AUTH0_AUDIENCE,
}, import.meta.env.DEV);
const creatorApiConfiguration = resolveCreatorApiConfiguration({
  VITE_CREATOR_API_URL: import.meta.env.VITE_CREATOR_API_URL,
}, authConfiguration.mode, import.meta.env.DEV);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CreatorAuthProvider configuration={authConfiguration}>
      <RequireAuthentication>
        <CreatorWorkspaceProvider configuration={creatorApiConfiguration}>
          <RequireCreatorWorkspace>
            <App />
          </RequireCreatorWorkspace>
        </CreatorWorkspaceProvider>
      </RequireAuthentication>
    </CreatorAuthProvider>
  </StrictMode>,
);
