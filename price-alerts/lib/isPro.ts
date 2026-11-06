/** Is this user on a paid plan? Uses effective_plan() from migration 016 (service role). `undefined` = could not tell, and callers must then NOT monetize. */
export async function getIsPro(userId: string, db: { rpc(fn: string, a?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }> }): Promise<boolean | undefined> {
  try {
    const { data, error } = await db.rpc('effective_plan', { p_user: userId });
    if (error || typeof data !== 'string') return undefined;
    return data === 'pro' || data === 'team';
  } catch { return undefined; }
}
