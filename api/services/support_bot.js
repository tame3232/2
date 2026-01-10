const fetch = require('node-fetch');
const admin = require('firebase-admin');

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
const SUPPORT_BOT_TOKEN = process.env.SUPPORT_BOT_TOKEN;
const ADMIN_ID = String(process.env.ADMIN_ID).trim();


exports.handler = async (event) => {
    try {
        if (!event.body) return { statusCode: 200, body: 'No body' };
        const body = JSON.parse(event.body);

        if (!body.message) return { statusCode: 200, body: 'OK' };

        const chatId = body.message.chat.id;
        const text = body.message.text;
        const messageId = body.message.message_id;

 if (text && text.startsWith('/start')) {
    const parts = text.split(' ');
    if (parts.length > 1) {
        const targetUserId = parts[1]; // ይህ ከሊንኩ የሚመጣው ID ነው

        try {
            
            let userData = null;
            
            // መንገድ A: በ Document ID መፈለግ (ቀጥታ)
            const docRef = await db.collection('users').doc(targetUserId).get();
            
            if (docRef.exists) {
                userData = docRef.data();
            } else {
                // መንገድ B: በውስጥ ባለው telegram_id ፊልድ መፈለግ (Auto-ID ለሆኑት)
                // በቁጥርም በጽሁፍም እንዲፈልግ ተደርጓል
                const querySnapshot = await db.collection('users')
                    .where('telegram_id', 'in', [targetUserId, Number(targetUserId)])
                    .limit(1)
                    .get();

                if (!querySnapshot.empty) {
                    userData = querySnapshot.docs[0].data();
                }
            }

            if (userData) {
                const d = userData;
                const adminReport = `📢 <b>አዲስ የድጋፍ ጥያቄ መጥቷል!</b>\n\n` +
                    `👤 <b>ስም:</b> ${d.first_name || 'ያልታወቀ'}\n` +
                    `🆔 <b>ID:</b> <code>${targetUserId}</code>\n` +
                    `💰 <b>Score:</b> ${(d.total_score || 0).toLocaleString()}\n` +
                    `👥 <b>Invites:</b> ${d.invite_count || 0}\n` +
                    `🚦 <b>ሁኔታ:</b> ${d.is_banned ? '🚫 Banned' : '✅ Active'}\n\n` +
                    `👉 ለመመለስ Reply ያድርጉ ወይም ይጠቀሙ:\n<code>/reply ${targetUserId} መልዕክት</code>`;

                await sendMessage(ADMIN_ID, adminReport);
            } else {
                // ተጠቃሚው ዳታቤዝ ውስጥ ካልተገኘ ለአድሚኑ ማሳወቅ
                await sendMessage(ADMIN_ID, `⚠️ ጥያቄ መጥቷል ግን ID <code>${targetUserId}</code> በዳታቤዝ ውስጥ አልተገኘም።`);
            }
        } catch (e) {
            console.error("Database Fetch Error:", e);
        }
    }
    const firstName = body.message.from.first_name || 'ተጠቃሚ';

await sendMessage(chatId, `👋 <b>ሰላም ${firstName}! ወደ Smart Airdrop የድጋፍ ማዕከል እንኳን መጡ።</b>\n\nጥያቄዎን ወይም ያጋጠመዎትን ችግር እዚህ ይጻፉ። የቴክኒክ ቡድናችን መረጃዎን አይቶ በፍጥነት ይመልስልዎታል።`);

    return { statusCode: 200 };
}

        // --- 2. አድሚኑ በእጅ መልስ ሲሰጥ (Manual Reply: /reply ID message) ---
        if (String(chatId) === String(ADMIN_ID) && text && text.startsWith('/reply')) {
            const parts = text.split(' ');
            if (parts.length >= 3) {
                const targetId = parts[1];
                const replyMsg = text.substring(text.indexOf(parts[2]));

                const success = await sendMessage(targetId, `👨‍💻 <b>ከድጋፍ ሰጪ ቡድን የተሰጠ ምላሽ:</b>\n\n${replyMsg}`);
                if (success) {
                    await sendMessage(ADMIN_ID, `✅ መልዕክቱ ለተጠቃሚ (ID: ${targetId}) ተልኳል።`);
                } else {
                    await sendMessage(ADMIN_ID, `❌ መልዕክቱ አልተላከም። ተጠቃሚው ቦቱን ዘግቶት ሊሆን ይችላል።`);
                }
            } else {
                await sendMessage(ADMIN_ID, "⚠️ <b>አጠቃቀም:</b>\n<code>/reply USER_ID መልዕክት</code>");
            }
            return { statusCode: 200 };
        }

        // --- 3. አድሚኑ በReply መልስ ሲሰጥ ---
        if (String(chatId) === String(ADMIN_ID) && body.message.reply_to_message) {
            const replyTo = body.message.reply_to_message;
            let targetId = null;

            // ከForwarded መልዕክት ID መፈለግ
            if (replyTo.forward_from) {
                targetId = replyTo.forward_from.id;
            } 
            // ካልሆነ ከጽሁፉ ውስጥ በRegex ፈልግ (ከሪፖርቱ ላይ)
            else if (replyTo.text) {
                const match = replyTo.text.match(/ID: (\d+)/);
                if (match) targetId = match[1];
            }

            if (targetId) {
                const success = await sendMessage(targetId, `👨‍💻 <b>ከድጋፍ ሰጪ ቡድን የተሰጠ ምላሽ:</b>\n\n${text}`);
                if (success) {
                    await sendMessage(ADMIN_ID, "✅ ምላሹ ደርሷል።");
                } else {
                    await sendMessage(ADMIN_ID, "❌ መላክ አልተቻለም።");
                }
            } else {
                await sendMessage(ADMIN_ID, "❌ የተጠቃሚውን ID ማግኘት አልቻልኩም። እባክዎ <code>/reply</code> ይጠቀሙ።");
            }
            return { statusCode: 200 };
        }

        // --- 4. ተጠቃሚው ጥያቄ ሲልክ ወደ አድሚን Forward ማድረግ ---
        if (String(chatId) !== String(ADMIN_ID)) {
            
            // ለመልዕክቱ የሚሆን ባዶ መያዣ
            let userInfoMsg = `⚠️ <b>መረጃ:</b> ስለ ID <code>${chatId}</code> መረጃ በዳታቤዝ አልተገኘም።`;
            let userData = null;

            try {
                // 1ኛ ሙከራ፡ በቀጥታ በ Document ID (Auto ID ወይም የተቀመጠበት ስም) መፈለግ
                const docRef = await db.collection('users').doc(String(chatId)).get();
                
                if (docRef.exists) {
                    userData = docRef.data();
                } else {
                    // 2ኛ ሙከራ፡ Document ID ካልተገኘ፣ በ 'telegram_id' field መፈለግ
                    // ማሳሰቢያ፡ አንዳንዴ ቁጥር (Number) አንዳንዴ ጽሁፍ (String) ሊሆን ስለሚችል በሁለቱም እንፈልጋለን
                    const querySnapshot = await db.collection('users')
                        .where('telegram_id', 'in', [chatId, Number(chatId), String(chatId)])
                        .limit(1)
                        .get();

                    if (!querySnapshot.empty) {
                        userData = querySnapshot.docs[0].data();
                    }
                }

                // መረጃው ከተገኘ መልዕክቱን ማዘጋጀት
                if (userData) {
                    const d = userData;
                     userInfoMsg = `📢 <b>አዲስ መልዕክት!</b>\n\n` +
                        `👤 <b>ስም:</b> ${d.first_name || 'ያልታወቀ'}\n` +
                        `🆔 <b>ID:</b> <code>${chatId}</code>\n` +
                        `💰 <b>Score:</b> ${(d.total_score || 0).toLocaleString()}\n` +
                        `👥 <b>Invites:</b> ${d.invite_count || 0}\n` +
                        `🚦 <b>ሁኔታ:</b> ${d.is_banned ? '🚫 Banned' : '✅ Active'}\n\n` +
                        `👉 ለመመለስ: <code>/reply ${chatId} መልዕክት</code>`;
                }

            } catch (err) {
                console.error("DB Fetch Error:", err);
                userInfoMsg = `⚠️ <b>Error:</b> ዳታቤዝ ለመፈተሽ ችግር አጋጥሟል (ID: ${chatId})`;
            }

            // 1. የተጠቃሚውን መረጃ ለአድሚኑ መላክ
            await sendMessage(ADMIN_ID, userInfoMsg);

            // 2. የተጠቃሚውን ኦሪጅናል መልዕክት Forward ማድረግ
            const forwardRes = await fetch(`https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/forwardMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: ADMIN_ID,
                    from_chat_id: chatId,
                    message_id: messageId
                })
            });
            
            // Forward ማድረግ ካልተቻለ (Privacy ምክንያት)
            const forwardData = await forwardRes.json();
            if (forwardData.ok && !forwardData.result.forward_from) {
                await sendMessage(ADMIN_ID, `ℹ️ <b>ማስታወሻ:</b> ተጠቃሚው Hidden Forwarding ስለሚጠቀም ቀጥታ Reply ማድረግ አይቻልም። እባክዎ ከላይ ያለውን ID ኮፒ አድርገው <code>/reply</code> ይጠቀሙ።`);
            }

           
          
      await sendMessage(chatId, `👋 ሰላም ${body.message.from.first_name || 'ተጠቃሚ'}! መልዕክትዎ ለድጋፍ ሰጪ ቡድናችን ደርሷል። በቅርቡ ምላሽ እንሰጥዎታለን።`);

            
            return { statusCode: 200 };
        }


        return { statusCode: 200 };
    } catch (error) {
        console.error("Global Error:", error);
        return { statusCode: 200 };
    }
};

async function sendMessage(id, msg) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${SUPPORT_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: id, text: msg, parse_mode: 'HTML' })
        });
        const data = await res.json();
        return data.ok;
    } catch (e) {
        return false;
    }
}

