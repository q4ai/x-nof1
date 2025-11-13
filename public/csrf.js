(() => {
  const CSRF_HEADER = "x-csrf-token";
  let csrfToken = null;
  let pendingStatusPromise = null;

  const originalFetch = window.fetch.bind(window);

  async function fetchStatus() {
    try {
      const response = await originalFetch("/api/auth/status", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      if (data && typeof data.csrfToken === "string") {
        csrfToken = data.csrfToken;
      }
      if (data && !data.authenticated) {
        csrfToken = null;
      }
      return data;
    } catch (error) {
      console.warn("[csrf] 获取会话状态失败", error);
      return null;
    }
  }

  async function ensureToken() {
    if (csrfToken) {
      return csrfToken;
    }
    if (!pendingStatusPromise) {
      pendingStatusPromise = fetchStatus().finally(() => {
        pendingStatusPromise = null;
      });
    }
    await pendingStatusPromise;
    return csrfToken;
  }

  function setToken(token) {
    csrfToken = typeof token === "string" && token.length > 0 ? token : null;
  }

  function resetToken() {
    csrfToken = null;
  }

  window.fetch = async (input, init = {}) => {
    const finalInit = { ...init };
    const method = String(finalInit.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
    const needsCsrf = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";

    finalInit.credentials = finalInit.credentials || "same-origin";

    const headers = new Headers(finalInit.headers || (typeof input === "object" && input.headers) || undefined);

    if (needsCsrf) {
      const token = await ensureToken();
      if (token) {
        headers.set(CSRF_HEADER, token);
      }
    }

    finalInit.headers = headers;
    return originalFetch(input, finalInit);
  };

  window.csrfManager = {
    ensureToken,
    setToken,
    resetToken,
    getToken: () => csrfToken,
  };

  document.addEventListener("DOMContentLoaded", () => {
    void ensureToken();
  });
})();
