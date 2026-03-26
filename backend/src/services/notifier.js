const webpush = require('web-push');
const memory = require('./memory');

let isConfigured = false;

function configurePush() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

  if (!publicKey || !privateKey) {
    isConfigured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  isConfigured = true;
  return true;
}

function getPushConfig() {
  const nadirAlert = require('./nadirAlert');
  return {
    enabled: isConfigured,
    publicKey: isConfigured ? process.env.VAPID_PUBLIC_KEY : null,
    ...nadirAlert.getNadirAlertConfigForClient()
  };
}

async function sendPushToAll(payload) {
  if (!isConfigured) return { sent: 0, failed: 0 };
  const subscriptions = await memory.getPushSubscriptions();
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent += 1;
      } catch (err) {
        failed += 1;
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await memory.removePushSubscription(sub.endpoint);
        }
      }
    })
  );

  return { sent, failed };
}

module.exports = { configurePush, getPushConfig, sendPushToAll };
