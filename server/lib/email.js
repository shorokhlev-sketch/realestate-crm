// E-mail уведомления через SMTP (nodemailer). Настройки в settings: smtp.host/port/user/pass/from/secure, notify_emails.
import nodemailer from 'nodemailer';
import { getSetting } from '../db.js';

export function smtpConfigured() { return !!getSetting('smtp.host'); }
function transport() {
  return nodemailer.createTransport({ host: getSetting('smtp.host'), port: Number(getSetting('smtp.port') || 587), secure: getSetting('smtp.secure') === '1',
    auth: getSetting('smtp.user') ? { user: getSetting('smtp.user'), pass: getSetting('smtp.pass') } : undefined, connectionTimeout: 8000 });
}
export async function sendMail(to, subject, text) {
  if (!smtpConfigured() || !to) return { ok: false, error: 'smtp not configured' };
  try { await transport().sendMail({ from: getSetting('smtp.from') || getSetting('smtp.user'), to, subject, text }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}
export async function verifySmtp() { if (!smtpConfigured()) return { ok: false, error: 'SMTP не настроен' }; try { await transport().verify(); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; } }
