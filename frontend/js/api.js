import { API_BASE_URL } from "./config.js";

export class ApiError extends Error {
  constructor(status, detail) {
    super(detail || `Error HTTP ${status}`);
    this.status = status;
  }
}

let token = null;

export const setToken = (nuevoToken) => {
  token = nuevoToken;
};

export const clearToken = () => {
  token = null;
};

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });

  const body = response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(response.status, body && body.detail ? body.detail : null);
  }

  return body;
}

export const api = {
  get: (path) => request(path),
  post: (path, data) => request(path, { method: "POST", body: JSON.stringify(data) }),
  patch: (path, data) => request(path, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (path) => request(path, { method: "DELETE" }),
};
