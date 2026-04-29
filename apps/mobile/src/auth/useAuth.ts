import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { clearTokens, loadTokens, saveTokens, type StoredTokens } from "./tokenStorage";
import { decodeAccessTokenClaims, type DecodedAccessClaims } from "./jwt";
import { shouldRestoreStoredSession } from "./sessionRestore";

WebBrowser.maybeCompleteAuthSession();

type Auth0Settings = {
  domain: string;
  clientId: string;
  audience: string;
};

export type AuthStatus = "bootstrapping" | "anonymous" | "authenticating" | "authenticated" | "error";

export type AuthState = {
  status: AuthStatus;
  accessToken?: string;
  claims?: DecodedAccessClaims;
  error?: string;
  redirectUri: string;
  signIn: () => Promise<void>;
  signUp: () => Promise<void>;
  signOut: () => Promise<void>;
};

export function useAuth(settings: Auth0Settings): AuthState {
  const [status, setStatus] = useState<AuthStatus>("bootstrapping");
  const [tokens, setTokens] = useState<StoredTokens | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const discovery = useMemo(
    () => ({
      authorizationEndpoint: `https://${settings.domain}/authorize`,
      tokenEndpoint: `https://${settings.domain}/oauth/token`,
      revocationEndpoint: `https://${settings.domain}/oauth/revoke`
    }),
    [settings.domain]
  );

  const redirectUri = useMemo(() => {
    if (Platform.OS === "web") {
      return AuthSession.makeRedirectUri({ scheme: "crewcue", path: "auth" });
    }
    // With a dev client + Metro, `executionEnvironment` is often `storeClient`, so
    // `makeRedirectUri({ scheme, path })` resolves via `Linking.createURL` to `exp://…`.
    // Auth0 must see the fixed native scheme from `app.json` (`crewcue`).
    return "crewcue://auth";
  }, []);

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: settings.clientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ["openid", "profile", "email", "offline_access"],
      usePKCE: true,
      extraParams: {
        audience: settings.audience
      }
    },
    discovery
  );

  const [signupRequest, signupResponse, promptSignupAsync] = AuthSession.useAuthRequest(
    {
      clientId: settings.clientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: ["openid", "profile", "email", "offline_access"],
      usePKCE: true,
      extraParams: {
        audience: settings.audience,
        screen_hint: "signup"
      }
    },
    discovery
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadTokens();
      if (cancelled) return;
      if (shouldRestoreStoredSession(stored)) {
        setTokens(stored);
        setStatus("authenticated");
      } else {
        await clearTokens();
        setStatus("anonymous");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAuthResponse = useCallback(
    (nextResponse: AuthSession.AuthSessionResult | null, activeRequest: AuthSession.AuthRequest | null) => {
      if (!nextResponse) return;
      if (nextResponse.type === "success") {
        void (async () => {
          try {
            const code = nextResponse.params.code;
            if (!code) {
              throw new Error("Missing authorization code");
            }
            const tokenResponse = await AuthSession.exchangeCodeAsync(
              {
                clientId: settings.clientId,
                code,
                redirectUri,
                extraParams: {
                  code_verifier: activeRequest?.codeVerifier ?? ""
                }
              },
              discovery
            );
            const newTokens: StoredTokens = {
              accessToken: tokenResponse.accessToken
            };
            if (tokenResponse.refreshToken) newTokens.refreshToken = tokenResponse.refreshToken;
            if (tokenResponse.idToken) newTokens.idToken = tokenResponse.idToken;
            if (typeof tokenResponse.expiresIn === "number") {
              newTokens.expiresAtMs = Date.now() + tokenResponse.expiresIn * 1000;
            }
            await saveTokens(newTokens);
            setTokens(newTokens);
            setStatus("authenticated");
            setError(undefined);
          } catch (err) {
            const message = err instanceof Error ? err.message : "Token exchange failed";
            setError(message);
            setStatus("error");
          }
        })();
      } else if (nextResponse.type === "error") {
        setError(nextResponse.error?.message ?? "Auth0 returned an error");
        setStatus("error");
      } else if (nextResponse.type === "cancel" || nextResponse.type === "dismiss") {
        setStatus("anonymous");
      }
    },
    [discovery, redirectUri, settings.clientId]
  );

  useEffect(() => {
    handleAuthResponse(response, request);
  }, [handleAuthResponse, request, response]);

  useEffect(() => {
    handleAuthResponse(signupResponse, signupRequest);
  }, [handleAuthResponse, signupRequest, signupResponse]);

  const signIn = useCallback(async () => {
    setError(undefined);
    if (!request) {
      setStatus("anonymous");
      setError("Login is still initializing. Please try again in a moment.");
      return;
    }
    setStatus("authenticating");
    try {
      await promptAsync();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open login";
      setError(message);
      setStatus("error");
    }
  }, [promptAsync, request]);

  const signUp = useCallback(async () => {
    setError(undefined);
    if (!signupRequest) {
      setStatus("anonymous");
      setError("Sign-up is still initializing. Please try again in a moment.");
      return;
    }
    setStatus("authenticating");
    try {
      await promptSignupAsync();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to open sign-up";
      setError(message);
      setStatus("error");
    }
  }, [promptSignupAsync, signupRequest]);

  const signOut = useCallback(async () => {
    await clearTokens();
    setTokens(undefined);
    setError(undefined);
    setStatus("anonymous");
    try {
      await WebBrowser.openAuthSessionAsync(
        `https://${settings.domain}/v2/logout?client_id=${encodeURIComponent(
          settings.clientId
        )}&returnTo=${encodeURIComponent(redirectUri)}`,
        redirectUri
      );
    } catch {
      /* best effort */
    }
  }, [settings.domain, settings.clientId, redirectUri]);

  const claims = tokens?.accessToken ? decodeAccessTokenClaims(tokens.accessToken) : undefined;

  const state: AuthState = {
    status,
    redirectUri,
    signIn,
    signUp,
    signOut
  };
  if (tokens?.accessToken) state.accessToken = tokens.accessToken;
  if (claims) state.claims = claims;
  if (error) state.error = error;
  return state;
}
