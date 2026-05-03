"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupInvalidTokens = exports.sendDailyPrayerNotifications = void 0;
const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");
admin.initializeApp();
const db = admin.firestore();
exports.sendDailyPrayerNotifications = functions.pubsub
    .schedule('0 0 * * *')
    .timeZone('Europe/London')
    .onRun(async (_context) => {
    try {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const dateKey = tomorrow.toISOString().split('T')[0];
        const monthId = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}`;
        const scheduleDoc = await db.doc(`schedules/${monthId}`).get();
        if (!scheduleDoc.exists) {
            console.log('No schedule found for', monthId);
            return null;
        }
        const scheduleData = scheduleDoc.data();
        const daySchedule = scheduleData.days.find(d => {
            const dDate = new Date(d.dateStr);
            return dDate.toISOString().split('T')[0] === dateKey;
        });
        if (!daySchedule) {
            console.log('No schedule found for', dateKey);
            return null;
        }
        const usersSnapshot = await db.collection('users').where('fcmToken', '!=', null).get();
        const isFriday = tomorrow.getDay() === 5;
        const notifications = [];
        for (const prayer of daySchedule.prayers) {
            const displayName = (prayer.name === 'Dhuhr' && isFriday) ? 'Jumu\'ah' : prayer.name;
            notifications.push({
                notification: {
                    title: `${displayName} Athan`,
                    body: `The ${displayName} prayer Athan is starting now`,
                },
                data: {
                    type: 'athan',
                    prayerName: displayName,
                    time: prayer.athan,
                },
                android: {
                    notification: {
                        channelId: 'prayer_notifications',
                        priority: 'high',
                        defaultSound: true,
                        defaultVibrateTimings: true,
                    },
                },
            });
            notifications.push({
                notification: {
                    title: `${displayName} Iqama`,
                    body: `The ${displayName} prayer Iqama is starting now`,
                },
                data: {
                    type: 'iqama',
                    prayerName: displayName,
                    time: prayer.iqama,
                },
                android: {
                    notification: {
                        channelId: 'prayer_notifications',
                        priority: 'high',
                        defaultSound: true,
                        defaultVibrateTimings: true,
                    },
                },
            });
        }
        const tokens = [];
        usersSnapshot.forEach((userDoc) => {
            const token = userDoc.data().fcmToken;
            if (token)
                tokens.push(token);
        });
        if (tokens.length === 0) {
            console.log('No FCM tokens found');
            return null;
        }
        const messaging = admin.messaging();
        for (const token of tokens) {
            for (const notification of notifications) {
                try {
                    await messaging.send({
                        ...notification,
                        token,
                    });
                }
                catch (error) {
                    console.error('Error sending to token:', token, error);
                }
            }
        }
        console.log(`Sent ${notifications.length * tokens.length} notifications to ${tokens.length} users`);
        return null;
    }
    catch (error) {
        console.error('Error in scheduled function:', error);
        return null;
    }
});
exports.cleanupInvalidTokens = functions.pubsub
    .schedule('0 6 * * 0')
    .timeZone('Europe/London')
    .onRun(async () => {
    try {
        const usersSnapshot = await db.collection('users').where('fcmToken', '!=', null).get();
        const messaging = admin.messaging();
        const batch = db.batch();
        let cleanedCount = 0;
        for (const doc of usersSnapshot.docs) {
            const token = doc.data().fcmToken;
            try {
                await messaging.send({ token, notification: { title: 'test', body: 'cleanup check' } }, true);
            }
            catch {
                batch.update(doc.ref, { fcmToken: admin.firestore.FieldValue.delete() });
                cleanedCount++;
            }
        }
        await batch.commit();
        console.log(`Cleaned up ${cleanedCount} invalid tokens`);
        return null;
    }
    catch (error) {
        console.error('Error cleaning up tokens:', error);
        return null;
    }
});
//# sourceMappingURL=index.js.map