// Stub for next-auth and next-auth/* — not installed; email-only auth is used.
export function signIn() {}
export function signOut() {}
export function useSession() { return { data: null, status: 'unauthenticated' }; }
export function getSession() { return Promise.resolve(null); }
export function getToken() { return Promise.resolve(null); }
export function SessionProvider({ children }) { return children; }
export const auth = () => Promise.resolve(null);
export const handlers = { GET: () => {}, POST: () => {} };

// Default export stub for import NextAuth from 'next-auth'
function NextAuth() { return { GET: () => {}, POST: () => {} }; }
NextAuth.default = NextAuth;
export default NextAuth;
