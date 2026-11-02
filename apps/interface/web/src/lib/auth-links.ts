/** Link to the server-side login. `returnTo` must be a same-origin path; `conversationId` lets the callback attach the guest's conversations. */
export function loginHref(returnTo: string, conversationId?: string): string {
  const query = new URLSearchParams({ returnTo });
  if (conversationId) query.set('conversationId', conversationId);
  return `/auth/login?${query}`;
}
