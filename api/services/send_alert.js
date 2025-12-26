const fetch = require('node-fetch');
const admin = require('firebase-admin');
const fs = require('fs');
const FormData = require('form-data');

// 1. Firebase Initialization
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
    });
}

const db = admin.firestore();
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

// CORS Headers
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
    // 🚀 ለ Mini App የሚሆን የ OPTIONS ፍቃድ
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: 'OK' };
    }

    try {
        const body = JSON.parse(event.body);

        // 🛠 ሁኔታ 1፡ መልዕክቱ የመጣው ከ Mini App ከሆነ (CORS Case)
        if (body.message && !body.update_id) { 
            const targetId = body.custom_chat_id || ADMIN_ID;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: targetId, text: body.message, parse_mode: 'HTML' }),
            });
            return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
        }

        // 🤖 ሁኔታ 2፡ መልዕክቱ የመጣው ከቴሌግራም ቦት ከሆነ (Bot Logic)
        if (!body.message) return { statusCode: 200, body: 'OK' };

        const chatId = body.message.chat.id;
        const text = body.message.text;
        const user = body.message.from;

        // --- የአስተዳዳሪ (Admin) ስራዎች ---
        if (String(chatId) === String(ADMIN_ID)) {
            if (text === '/stats') {
                const snapshot = await db.collection('users').count().get();
                await sendToAdmin(`📊 <b>ጠቅላላ ተጠቃሚዎች:</b> ${snapshot.data().count}`);
                return { statusCode: 200, body: 'OK' };
            }

            if (text === '/export') {
                const usersSnapshot = await db.collection('users').get();
                let userData = "ID, Name, Username\n";
                usersSnapshot.forEach(doc => {
                    const d = doc.data();
                    userData += `${doc.id}, ${d.first_name}, @${d.username || 'none'}\n`;
                });
                const filePath = '/tmp/users.csv';
                fs.writeFileSync(filePath, userData);
                const form = new FormData();
                form.append('chat_id', ADMIN_ID);
                form.append('document', fs.createReadStream(filePath));
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: form });
                return { statusCode: 200, body: 'OK' };
            }

            if (text && text.startsWith('/broadcast')) {
                const rawMsg = text.substring(text.indexOf(' ') + 1);
                const usersSnapshot = await db.collection('users').get();
                for (const doc of usersSnapshot.docs) {
                    const msg = rawMsg.replace(/{name}/g, doc.data().first_name || 'ወዳጄ');
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: doc.id, text: msg, parse_mode: 'HTML' })
                    });
                }
                await sendToAdmin("✅ ስርጭቱ ተጠናቋል።");
                return { statusCode: 200, body: 'OK' };
            }

            if (text && text.startsWith('/mreply')) {
                const args = text.split(' ');
                const ids = args[1].split(',');
                const rawMsg = text.substring(text.indexOf(args[2]));
                for (const id of ids) {
                    const userDoc = await db.collection('users').doc(id.trim()).get();
                    if (userDoc.exists) {
                        const msg = rawMsg.replace(/{name}/g, userDoc.data().first_name);
                        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: id.trim(), text: `✉️ <b>መልዕክት:</b>\n${msg}`, parse_mode: 'HTML' })
                        });
                        const resData = await res.json();
                        await sendToAdmin(resData.ok ? `✅ ለ ${id} ደርሷል` : `❌ ለ ${id} አልደረሰም`);
                    }
                }
                return { statusCode: 200, body: 'OK' };
            }
        }

        // --- የ /start ስራ ---
        if (text && text.startsWith('/start')) {
            const userRef = db.collection('users').doc(String(chatId));
            const doc = await userRef.get();
            if (!doc.exists) {
                await userRef.set({ first_name: user.first_name, username: user.username || 'none', joined_at: admin.firestore.FieldValue.serverTimestamp() });
                const count = (await db.collection('users').count().get()).data().count;
                await sendToAdmin(`🔔 <b>አዲስ ተጠቃሚ:</b> <a href="tg://user?id=${chatId}">${user.first_name}</a>\n📊 ጠቅላላ: ${count}`);
            }
            const welcome = `<b>እንኳን ወደ Smart Airdrop በደህና መጡ 🚀</b>\n\n💎 ይህ የሽልማት ዓለም ነው — የብዙዎች ዕድል እና የብቸኛዎች ግንባር!\n🌟 ዛሬ የአንተ ቀን ነው — ጀምር እና አሸንፈው!`;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: welcome, parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: "🚀 Play App", web_app: { url: "https://newsmartgames.netlify.app/" } }]] }
                }),
            });
        }

        return { statusCode: 200, body: 'OK' };
    } catch (e) {
        console.error(e);
        return { statusCode: 200, headers: CORS_HEADERS, body: 'OK' };
    }
};

async function sendToAdmin(text) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_ID, text: text, parse_mode: 'HTML' }),
    });
}
