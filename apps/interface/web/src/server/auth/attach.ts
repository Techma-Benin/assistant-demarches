import { getAuthConfig } from './config';

/** Moves the guest's conversations to the account. True when the Backend accepted (the guest token can go). */
export async function attachGuest(conversationId: string, guestToken: string, userToken: string): Promise<boolean> {
  try {
    const response = await fetch(new URL(`/v1/conversations/${conversationId}/attach`, getAuthConfig().backendUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${userToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ guestToken }),
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
