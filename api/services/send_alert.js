const fetch = require('node-fetch');
const admin = require('firebase-admin');
const fs = require('fs');
const FormData = require('form-data');

// 1. Firebase Initialization
if (!admin.apps.length) {
    let pKey = process.env.FIREBASE_PRIVATE_KEY;
    if (pKey) {
        pKey = pKey.replace(/\\n/g, '\n');
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

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: 'OK' };
    }

    try {
        if (!event.body) return { statusCode: 200, body: 'No body' };
        const body = JSON.parse(event.body);

        // --- ሁኔታ 1፡ ከ Mini App የሚመጣ መልዕክት ---
        if (body.message && !body.update_id) { 
            const targetId = body.custom_chat_id || ADMIN_ID;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: targetId, text: body.message, parse_mode: 'HTML' }),
            });
            return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
        }

        // --- ሁኔታ 2፡ የ Callback Query አያያዝ (Share ቁልፍ ሲነካ) ---
        if (body.callback_query) {
            const cb = body.callback_query;
            const cbId = cb.id;
            const cbChatId = cb.message.chat.id;
            const data = cb.data;

            if (data === "check_and_share") {
                const userDoc = await db.collection('users').doc(String(cbChatId)).get();

                if (!userDoc.exists) {
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            callback_query_id: cbId, 
                            text: "⚠️ ይቅርታ! መጀመሪያ 'Play Now' የሚለውን ተጭነው መመዝገብ አለብዎት።", 
                            show_alert: true 
                        }),
                    });
                } else {
                    const shareText = `🔥 አዲስ የቴሌግራም Airdrop እንዳያመልጥዎ!\n\nየ Notcoin እና DOGS እድል አመለጠኝ ብለው ተቆጭተዋል? ይህ አዲስ ፕሮጀክት ገና ስለሆነ አሁኑኑ ይጀምሩ! 🚀\n👇 በዚህ ሊንክ ሲገቡ 1000 coin በነፃ ያገኛሉ!\n\nhttps://t.me/Smartgame21_bot?start=${cbChatId}\n\n⏳ ጊዜው ከማለቁ በፊት ቦታዎን ይያዙ!`;
                    const shareUrl = `https://t.me/share/url?url=https://t.me/Smartgame21_bot?start=${cbChatId}&text=${encodeURIComponent("🔥 አዲስ የቴሌግራም Airdrop እንዳያመልጥዎ! 🚀")}`;
                    
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ callback_query_id: cbId, text: "✅ ዝግጁ ነው!" }),
                    });

                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            chat_id: cbChatId, 
                            text: `<b>የእርስዎ መጋበዣ መልዕክት ዝግጁ ነው!</b>\n\nከታች ያለውን መልዕክት Copy አድርገው ለጓደኞችዎ ይላኩ ወይም "ለጓደኛ ላክ" የሚለውን ይጠቀሙ፦\n\n<code>${shareText}</code>`,
                            parse_mode: 'HTML',
                            reply_markup: { inline_keyboard: [[{ text: "🚀 አሁኑኑ ለጓደኛ ላክ", url: shareUrl }]] }
                        }),
                    });
                }
            }
            return { statusCode: 200, body: 'OK' };
        }

        if (!body.message) return { statusCode: 200, body: 'OK' };

        const chatId = body.message.chat.id;
        const text = body.message.text;
        const user = body.message.from;

        // --- የአስተዳዳሪ (Admin) ተግባራት ---
        if (String(chatId) === String(ADMIN_ID)) {
            if (text === '/stats') {
                const snapshot = await db.collection('users').count().get();
                await sendToAdmin(`📊 <b>ጠቅላላ ተጠቃሚዎች:</b> ${snapshot.data().count}`);
                return { statusCode: 200, body: 'OK' };
            }

            if (text && text.startsWith('/check_user')) {
                const parts = text.split(' ');
                if (parts.length < 2) {
                    await sendToAdmin("⚠️ እባክዎ የUser ID ያስገቡ።\nምሳሌ: <code>/check_user 123456789</code>");
                    return { statusCode: 200, body: 'Missing ID' };
                }
                const targetId = parts[1].trim();
                try {
                    const userDoc = await db.collection('users').doc(targetId).get();
                    if (!userDoc.exists) {
                        await sendToAdmin("❌ ይህ ተጠቃሚ ዳታቤዝ ውስጥ የለም።");
                        return { statusCode: 200, body: 'User not found' };
                    }
                    const userData = userDoc.data();
                    const inviteSnapshot = await db.collection('users').where('referrer_id', '==', targetId).count().get();
                    const inviteCount = inviteSnapshot.data().count;
                    const msg = `🔍 <b>የተጠቃሚ መረጃ:</b>\n\n👤 <b>ስም:</b> ${userData.first_name}\n🆔 <b>ID:</b> <code>${targetId}</code>\n💰 <b>ጠቅላላ Score:</b> ${userData.total_score}\n👥 <b>የጋበዛቸው ሰዎች ብዛት:</b> ${inviteCount}`;
                    await sendToAdmin(msg);
                } catch (error) {
                    await sendToAdmin(`❌ Error: ${error.message}`);
                }
                return { statusCode: 200, body: 'OK' };
            }

            if (text === '/export') {
                const usersSnapshot = await db.collection('users').get();
                let userData = "Telegram ID, Username, Total Score, Invites, Referrer ID\n";
                usersSnapshot.forEach(doc => {
                    const d = doc.data();
                    userData += `${doc.id}, ${d.username || 'none'}, ${d.total_score || 0}, ${d.invite_count || 0}, ${d.referrer_id || 'none'}\n`;
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
                await sendToAdmin("✅ ስርጭቱ ለሁሉም ተጠቃሚዎች ተጠናቋል።");
                return { statusCode: 200, body: 'OK' };
            }

            if (text && text.startsWith('/mreply')) {
                const args = text.split(' ');
                if (args.length < 3) return { statusCode: 200, body: 'Missing args' };
                const ids = args[1].split(',');
                const msgContent = text.substring(text.indexOf(args[2]));
                for (const id of ids) {
                    const targetId = id.trim();
                    const userDoc = await db.collection('users').doc(targetId).get();
                    let finalMsg = msgContent;
                    if (userDoc.exists) finalMsg = msgContent.replace(/{name}/g, userDoc.data().first_name || 'ወዳጄ');
                    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: targetId, text: `✉️ <b>Smart Airdrop:</b>\n${finalMsg}`, parse_mode: 'HTML' })
                    });
                    const resData = await res.json();
                    await sendToAdmin(resData.ok ? `✅ ለ ${targetId} ደርሷል` : `❌ ለ ${targetId} አልደረሰም`);
                }
                return { statusCode: 200, body: 'OK' };
            }
        }

        // --- የ /start ስራ (የተስተካከለ Welcome መልዕክት) ---
        if (text && text.startsWith('/start')) {
            const welcome = `<b>እንኳን በደህና መጡ ወደ Smart Airdrop 🚀</b>\n\n💎 ይህ የሽልማት ዓለም ነው — የብዙዎች ዕድል እና የብቸኛዎች ግንባር!\nእያንዳንዱ ነጥብ ዕድል ነው፣ እያንዳንዱ ጨዋታ ተስፋ ነው 🎯\n🌟 ዛሬ የአንተ ቀን ነው — ጀምር እና አሸንፈው!\n\n🚀 ለመጀመር ከታች ያለውን አዝራር ይጫኑ።`;
            
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chat_id: chatId, 
                    text: welcome, 
                    parse_mode: 'HTML',
                    reply_markup: { 
                        inline_keyboard: [
                            [{ text: "🚀 Play Now ", web_app: { url: "https://newsmartgames.netlify.app/" } }],
                            [{ text: "🔗 Share (ጓደኞችን ይጋብዙ)", callback_data: "check_and_share" }],
                            [{ text: "📢 Official Channel", url: "https://t.me/Smart_Airdropss" }]
                        ] 
                    }
                }),
            });
            return { statusCode: 200, body: 'OK' };
        }

        return { statusCode: 200, body: 'OK' };
    } catch (e) {
        console.error("Error:", e.message);
        return { statusCode: 200, body: 'Error' };
    }
};

async function sendToAdmin(text) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_ID, text: text, parse_mode: 'HTML' }),
    });
}
