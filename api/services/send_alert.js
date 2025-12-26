const fetch = require('node-fetch');
const admin = require('firebase-admin');
const fs = require('fs');
const FormData = require('form-data');

// 1. Firebase Initialization (በጥንቃቄ የተስተካከለ)
if (!admin.apps.length) {
    let pKey = process.env.FIREBASE_PRIVATE_KEY;
    
    if (pKey) {
        // Netlify ላይ የሚገባው \n ወደ እውነተኛ Newline እንዲቀየር
        pKey = pKey.replace(/\\n/g, '\n');
        // በስህተት ጥቅሶች (Quotes) ገብተው ከሆነ እንዲጠፉ
        if (pKey.startsWith('"') && pKey.endsWith('"')) {
            pKey = pKey.substring(1, pKey.length - 1);
        }
    }

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: pKey,
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
    // 🚀 OPTIONS Method handle ለማድረግ
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: 'OK' };
    }

    try {
        if (!event.body) return { statusCode: 200, body: 'No body' };
        const body = JSON.parse(event.body);

        // 🛠 ሁኔታ 1፡ መልዕክቱ የመጣው ከ Mini App ከሆነ
        if (body.message && !body.update_id) { 
            const targetId = body.custom_chat_id || ADMIN_ID;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: targetId, text: body.message, parse_mode: 'HTML' }),
            });
            return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
        }

        // 🤖 ሁኔታ 2፡ መልዕክቱ የመጣው ከቴሌግራም ቦት ከሆነ
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

            // BROADCAST: /broadcast መልዕክት
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

            // MREPLY: /mreply id,id2 መልዕክት
            if (text && text.startsWith('/mreply')) {
                const args = text.split(' ');
                if(args.length < 3) return { statusCode: 200, body: 'Missing args' };
                const ids = args[1].split(',');
                const msgStartIndex = text.indexOf(args[2]);
                const rawMsg = text.substring(msgStartIndex);
                
                for (const id of ids) {
                    const cleanId = id.trim();
                    const userDoc = await db.collection('users').doc(cleanId).get();
                    if (userDoc.exists) {
                        const msg = rawMsg.replace(/{name}/g, userDoc.data().first_name);
                        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chat_id: cleanId, text: `✉️ <b>መልዕክት:</b>\n${msg}`, parse_mode: 'HTML' })
                        });
                        const resData = await res.json();
                        await sendToAdmin(resData.ok ? `✅ ለ ${cleanId} ደርሷል` : `❌ ለ ${cleanId} አልደረሰም`);
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
                await userRef.set({ 
                    first_name: user.first_name, 
                    username: user.username || 'none', 
                    joined_at: admin.firestore.FieldValue.serverTimestamp() 
                });
                const countSnap = await db.collection('users').count().get();
                await sendToAdmin(`🔔 <b>አዲስ ተጠቃሚ:</b> <a href="tg://user?id=${chatId}">${user.first_name}</a>\n📊 ጠቅላላ: ${countSnap.data().count}`);
            }
            const welcome = `<b>እንኳን ወደ Smart Airdrop በደህና መጡ 🚀</b>\n\n💎 ይህ የሽልማት ዓለም ነው!\n🌟 ዛሬ የአንተ ቀን ነው — ጀምር እና አሸንፈው!`;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chat_id: chatId, 
                    text: welcome, 
                    parse_mode: 'HTML',
                    reply_markup: { 
                        inline_keyboard: [[{ text: "🚀 Play App", web_app: { url: "https://newsmartgames.netlify.app/" } }]] 
                    }
                }),
            });
        }

        return { statusCode: 200, body: 'OK' };
    } catch (e) {
        console.error("Error path:", e.message);
        return { statusCode: 200, headers: CORS_HEADERS, body: 'Error occurred' };
    }
};

async function sendToAdmin(text) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_ID, text: text, parse_mode: 'HTML' }),
    });
}
