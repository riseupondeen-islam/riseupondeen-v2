/** A published Sadaqah request (Firestore `content` document with type "sadaqah"). */
export interface SadaqahRequest {
  id?: string;
  type: 'sadaqah';
  title?: string;
  description?: string;
  verifiedDate?: string;
  upiId?: string;
  published?: boolean;
  fulfilled?: boolean;
}

/** Active requests: published and not yet marked fulfilled by the admin (same filter as before). */
export function activeSadaqahRequests(content: unknown): SadaqahRequest[] {
  const items = Array.isArray(content) ? (content as Array<Partial<SadaqahRequest> | null>) : [];
  return items.filter(
    (x): x is SadaqahRequest => !!x && x.type === 'sadaqah' && x.published === true && x.fulfilled !== true,
  );
}
