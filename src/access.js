import { isLidUser, isPnUser, jidNormalizedUser } from 'baileys';

const numberOf = (jid) => jidNormalizedUser(jid).split('@')[0];

/**
 * Decides who sent a message and whether the bot may answer.
 * Returns null for groups, strangers and the owner's chats with other people.
 */
export async function authorize({ key, me, allowed, resolveLid = async () => null }) {
  const chat = key.remoteJid;
  if (!chat || !me?.id || key.participant || !(isPnUser(chat) || isLidUser(chat))) return null;

  const normalized = jidNormalizedUser(chat);
  const isSelf = normalized === jidNormalizedUser(me.id) || (me.lid && normalized === jidNormalizedUser(me.lid));

  if (key.fromMe) return isSelf ? { user: numberOf(me.id), chat, self: true } : null;

  const phone = [chat, key.remoteJidAlt].find((jid) => isPnUser(jid)) ?? await resolveLid(chat);
  if (!phone || !allowed.has(numberOf(phone))) return null;
  return { user: numberOf(phone), chat, self: false };
}
