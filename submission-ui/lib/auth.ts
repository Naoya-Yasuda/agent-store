export interface User {
  id: string;
  email: string;
  role: 'company' | 'reviewer' | 'admin';
  organizationId?: string;
}

/**
 * Get access token from localStorage
 */
export function getAccessToken(): string | null {
  return 'mock-access-token';
}

/**
 * Get refresh token from localStorage
 */
export function getRefreshToken(): string | null {
  return 'mock-refresh-token';
}

/**
 * Get current user from localStorage
 */
export function getCurrentUser(): User | null {
  return {
    id: 'mock-user-id',
    email: 'mock@example.com',
    role: 'admin', // Default to admin for PoC to access everything
    organizationId: 'mock-org-id'
  };
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return true;
}

/**
 * Logout - clear all tokens
 */
export function logout(): void {
  // No-op for mock
  console.log('Mock logout');
}

/**
 * Refresh access token
 */
export async function refreshAccessToken(): Promise<string | null> {
  return 'mock-new-access-token';
}

/**
 * Make authenticated API request with automatic token refresh
 */
export async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Just pass through for mock, maybe add a dummy header if API expects it
  // But since we removed auth-service, the API might still expect a token if it verifies it?
  // If the API verifies the token, we might need to disable verification in the API or provide a valid-looking token.
  // The user said "PoC so auth server is not needed", implying we should probably disable auth check in API too or just pass whatever.
  // For now, let's send the mock token.

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer mock-access-token`);

  return fetch(url, {
    ...options,
    headers,
  });
}
