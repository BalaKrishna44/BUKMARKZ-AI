import { admin } from '@/lib/server';
import { sendEmail } from './email';
import { makePush } from './push';
import type { Channels, NotifyDb } from './notify';

export const alertDb = admin as unknown as NotifyDb & { from(t: string): any };
export const defaultChannels = (): Channels => ({ email: (a) => sendEmail(a), push: makePush(alertDb) });
