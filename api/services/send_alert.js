Const fetch = require('node-fetch');
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

        // --- ሁኔታ 1፡ ከ Mini App የሚመጣ መልዕክት (ውጤት መመዝገብ ወዘተ) ---
        // Mini App ጥገና ላይ ከሆነም እንዲሰራ ከተፈለገ ይህንን ከጥገናው logic በላይ ያድርጉት።
        // ካልተፈለገ ግን ከታች ወዳለው logic ማውረድ ይቻላል። ለጊዜው እዚህ ይሁን።
        if (body.message && !body.update_id) { 
            const targetId = body.custom_chat_id || ADMIN_ID;
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: targetId, text: body.message, parse_mode: 'HTML' }),
            });
            return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify({ success: true }) };
        }

        // መደበኛ የቴሌግራም መልዕክት ወይም Callback
        if (!body.message && !body.callback_query) return { statusCode: 200, body: 'OK' };

        // መረጃዎችን ማውጣት
        let chatId, text, user, isCallback = false, callbackId = null;

        if (body.callback_query) {
            isCallback = true;
            chatId = body.callback_query.message.chat.id;
            text = body.callback_query.data;
            user = body.callback_query.from;
            callbackId = body.callback_query.id;
        } else {
            chatId = body.message.chat.id;
            text = body.message.text;
            user = body.message.from;
        }

        // ============================================================
        // 🔥 MAINTENANCE CHECK (የጥገና ማጣሪያ)
        // ============================================================
        
        // 1. የቅንብር መረጃ ከ Database ማምጣት
        const configDoc = await db.collection('settings').doc('bot_config').get();
        const isMaintenance = configDoc.exists ? configDoc.data().maintenance_mode : false;

        // 2. ጥገና ላይ ከሆነ እና ተጠቃሚው Admin ካልሆነ
        if (isMaintenance && String(chatId) !== String(ADMIN_ID)) {
            const maintenanceMsg = "🚧 <b>ቦቱ ለጊዜው በጥገና ላይ ነው!</b>\n\nእባክዎ ትንሽ ቆይተው ይመለሱ። አዳዲስ ነገሮችን እየጨመርን ነው። 🚀";
            
            if (isCallback) {
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callback_query_id: callbackId, text: "ቦቱ በጥገና ላይ ነው!", show_alert: true }),
                });
            } else {
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text: maintenanceMsg, parse_mode: 'HTML' }),
                });
            }
            return { statusCode: 200, body: 'Maintenance Mode' };
        }
        // ============================================================


        // --- ሁኔታ 2፡ የ Callback Query አያያዝ ---
        if (isCallback) {
            if (text === "check_and_share") {
                const userDoc = await db.collection('users').doc(String(chatId)).get();

                if (!userDoc.exists) {
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            callback_query_id: callbackId, 
                            text: "⚠️ ይቅርታ! መጀመሪያ 'Play Now' የሚለውን ተጭነው መመዝገብ አለብዎት።", 
                            show_alert: true 
                        }),
                    });
                } else {
                    const shareText = `🔥 አዲስ የቴሌግራም Airdrop እንዳያመልጥዎ!\n\nየ Notcoin እና DOGS እድል አመለጠኝ ብለው ተቆጭተዋል? ይህ አዲስ ፕሮጀክት ገና ስለሆነ አሁኑኑ ይጀምሩ! 🚀\n👇 በዚህ ሊንክ ሲገቡ 1000 coin በነፃ ያገኛሉ!\n\nhttps://t.me/Smartgame21_bot?start=${chatId}\n\n⏳ ጊዜው ከማለቁ በፊት ቦታዎን ይያዙ!`;
                    const shareUrl = `https://t.me/share/url?url=https://t.me/Smartgame21_bot?start=${chatId}&text=${encodeURIComponent("​🔥 አዲስ የቴሌግራም Airdrop እንዳያመልጥዎ!...")}`;
                    
                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ callback_query_id: callbackId, text: "✅ ዝግጁ ነው!" }),
                    });

                    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            chat_id: chatId, 
                            text: `<b> ይህ የእርስዎ መጋበዣ መልዕክት ነው!</b>\n\nለጓደኞችዎ ይላኩ \n\n<code>${shareText}</code>`,
                            parse_mode: 'HTML',
                            reply_markup: { inline_keyboard: [[{ text: "🚀 አሁኑኑ ለጓደኛ ላክ", url: shareUrl }]] }
                        }),
                    });
                }
            }
            return { statusCode: 200, body: 'OK' };
        }


        // --- የአስተዳዳሪ (Admin) ተግባራት ---
        if (String(chatId) === String(ADMIN_ID)) {
            
            // 🔧 Maintenance ማዘዣዎች
            if (text === '/maintenance on') {
                await db.collection('settings').doc('bot_config').set({ maintenance_mode: true }, { merge: true });
                await sendToAdmin("🔴 <b>Maintenance Mode ON!</b>\n\nቦቱ ለተጠቃሚዎች ተዘግቷል። ለእርስዎ ግን ይሰራል::");
                return { statusCode: 200, body: 'OK' };
            }

            if (text === '/maintenance off') {
                await db.collection('settings').doc('bot_config').set({ maintenance_mode: false }, { merge: true });
                await sendToAdmin("🟢 <b>Maintenance Mode OFF!</b>\n\nቦቱ ወደ መደበኛ ስራ ተመልሷል።");
                return { statusCode: 200, body: 'OK' };
            }

            if (text === '/stats') {
                const snapshot = await db.collection('users').get();
                await sendToAdmin(`📊 <b>ጠቅላላ ተጠቃሚዎች:</b> ${snapshot.size}`);
                return { statusCode: 200, body: 'OK' };
            }

            if (text && text.startsWith('/check_user')) {
                const parts = text.split(' ');
                if (parts.length < 2) {
                    await sendToAdmin("⚠️ እባክዎ የUser ID ያስገቡ።\nምሳሌ: <code>/check_user 123456789</code>");
                    return { statusCode: 200, body: 'Missing ID' };
                }

                const targetIdString = parts[1].trim();
                const targetIdNumber = Number(targetIdString);

                try {
                    let userData = null;
                    let userDocId = null;

                    let userDoc = await db.collection('users').doc(targetIdString).get();

                    if (userDoc.exists) {
                        userData = userDoc.data();
                        userDocId = userDoc.id;
                    } else {
                        let querySnapshot = await db.collection('users').where('telegram_id', '==', targetIdNumber).limit(1).get();
                        
                        if (querySnapshot.empty) {
                             querySnapshot = await db.collection('users').where('telegram_id', '==', targetIdString).limit(1).get();
                        }

                        if (!querySnapshot.empty) {
                            const docFound = querySnapshot.docs[0];
                            userData = docFound.data();
                            userDocId = docFound.id;
                        }
                    }

                    if (!userData) {
                        await sendToAdmin(`❌ ይህ ተጠቃሚ (ID: ${targetIdString}) ዳታቤዝ ውስጥ የለም።`);
                        return { statusCode: 200, body: 'User not found' };
                    }

                    const inviteSnapshot = await db.collection('users').where('referrer_id', '==', String(targetIdString)).get();
                    const inviteCount = inviteSnapshot.size;

                    const name = userData.username || userData.first_name || 'ያልታወቀ';
                    const score = userData.total_score || 0;
                    
                    const msg = `🔍 <b>የተጠቃሚ መረጃ:</b>\n\n` +
                                `👤 <b>ስም:</b> ${name}\n` +
                                `🆔 <b>ID:</b> <code>${targetIdString}</code>\n` +
                                `💰 <b>Score:</b> ${score.toLocaleString()}\n` +
                                `👥 <b>Invites:</b> ${inviteCount}`;

                    await sendToAdmin(msg);

                } catch (error) {
                    console.error(error);
                    await sendToAdmin(`❌ የፍለጋ ስህተት: ${error.message}`);
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
                const msgStartIndex = text.indexOf(args[2]);
                const msgContent = text.substring(msgStartIndex);

                for (const id of ids) {
                    const targetId = id.trim();
                    let userData = null;

                    try {
                        const userDoc = await db.collection('users').doc(targetId).get();
                        
                        if (userDoc.exists) {
                            userData = userDoc.data();
                        } else {
                            let qSnapshot = await db.collection('users').where('telegram_id', '==', Number(targetId)).limit(1).get();
                            if (qSnapshot.empty) {
                                qSnapshot = await db.collection('users').where('telegram_id', '==', String(targetId)).limit(1).get();
                            }
                            if (!qSnapshot.empty) {
                                userData = qSnapshot.docs[0].data();
                            }
                        }

                        let finalMsg = msgContent;
                        let userName = 'ወዳጄ'; 

                        if (userData) {
                            userName = userData.username || userData.first_name || userData.name || 'ወዳጄ';
                        }

                        finalMsg = finalMsg.replace(/{name}/g, userName);

                        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                chat_id: targetId, 
                                text: `✉️ <b>Smart Airdrop:</b>\n${finalMsg}`, 
                                parse_mode: 'HTML' 
                            })
                        });
                        const resData = await res.json();
                         if (!resData.ok) {
                            await sendToAdmin(`❌ ለ ${targetId} አልደረሰም: ${resData.description}`);
                         }

                    } catch (err) {
                        console.error(`Error sending to ${targetId}:`, err);
                    }
                }
                
                await sendToAdmin(`✅ መልዕክት መላክ ተጠናቋል።`);
                return { statusCode: 200, body: 'OK' };
            }
        } // <--- የAdmin Logic መዝጊያ

        if (text && text.startsWith('/start')) {
    const startArgs = text.split(' ');
    let referrerId = startArgs.length > 1 ? startArgs[1] : "በራሱ የመጣ";

    // ተጠቃሚው ራሱን እንዳይጋብዝ መከላከል
    if (String(referrerId) === String(chatId)) {
        referrerId = "በራሱ የመጣ (Self-referral)";
    }

    const newUserInfo = `🔔 <b>አዲስ ተጠቃሚ ተቀላቅሏል!</b>\n\n` +
                        `👤 <b>ስም:</b> ${user.first_name || 'ያልታወቀ'}\n` +
                        `🆔 <b>ID:</b> <code>${chatId}</code>\n` +
                        `🔗 <b>Username:</b> ${user.username ? '@' + user.username : 'የለውም'}\n` +
                        `🌍 <b>ቋንቋ:</b> ${user.language_code || 'ያልታወቀ'}\n` +
                        `👥 <b>የጋባዥ ID:</b> <code>${referrerId}</code>\n` +
                        `📅 <b>ቀን:</b> ${new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')} UTC`;
    
    // ለአድሚን መላክ
    await sendToAdmin(newUserInfo);
        // 🔥 አዲስ፡ ለጋባዡ (Referrer) መልዕክት መላክ
    if (referrerId && String(referrerId) !== String(chatId) && referrerId !== "በራሱ የመጣ") {
        try {
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    chat_id: referrerId, 
                    text: `🎉 <b>አዲስ ጓደኛ ተቀላቅሏል!</b>\n\n@${user.username || user.first_name} የእርስዎን ግብዣ ተቀብሎ በመጀመሩ 500 Coins አግኝተዋል። 🚀\n\nጓደኞችዎን መጋበዝዎን ይቀጥሉ!`, 
                    parse_mode: 'HTML' 
                }),
            });
        } catch (err) {
            console.error("Referrer notification failed:", err);
        }
    }

    
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
                            [{ text: "📢 Official Channel", url: "https://t.me/Smart_Airdropss" }],
                            [{ text: "🔗 Share (ጓደኞችን ይጋብዙ)", callback_data: "check_and_share" }],
                            [{ text: "🚀 Play Now ", web_app: { url: "https://newsmartgames.netlify.app/" } }]
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
