   
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

        if (body.message && typeof body.message === 'string') {
            const targetId = body.custom_chat_id || ADMIN_ID;

            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: targetId,
                    text: body.message,
                    parse_mode: 'HTML'
                }),
            });
            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: true })
            };
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

        // --- 1. ans_ callbacks (ተጠቃሚው ሲመርጥ) ---
        if (isCallback && text && text.startsWith('ans_')) {
            const userAnswer = text.replace('ans_', '');
            const firstName = user.first_name || 'ወዳጄ';
            
            // ለተጠቃሚው ማረጋገጫ
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `✅ ሰላም ${firstName}፣ ምርጫህ "${userAnswer}" መሆኑን መዝግበናል!`,
                    parse_mode: 'HTML'
                }),
            });

            // ለአድሚን ማሳወቅ
            await sendToAdmin(`🗳 <b>አዲስ ምላሽ!</b>\n👤 ስም: ${firstName}\n🎯 የመረጠው: <b>${userAnswer}</b>`);

            // Loading ማጥፋት
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: callbackId }),
            });
            return { statusCode: 200, body: 'OK' };
        }

        if (isCallback && text === "check_and_share") {
    // 1. መጀመሪያ ተጠቃሚው በዳታቤዝ ውስጥ መኖሩን በሶስት መንገድ ያረጋግጣል
    let userDoc = await db.collection('users').doc(String(chatId)).get();
    let userExists = userDoc.exists;

    if (!userExists) {
        // በቁጥር (Number) መፈለግ
        const querySnapshot = await db.collection('users')
            .where('telegram_id', '==', Number(chatId)) 
            .limit(1)
            .get();
        
        if (!querySnapshot.empty) {
            userExists = true;
        } else {
            // በፅሁፍ (String) መፈለግ
            const querySnapshotStr = await db.collection('users')
                 .where('telegram_id', '==', String(chatId))
                 .limit(1)
                 .get();
            if (!querySnapshotStr.empty) userExists = true;
        }
    }

    // 2. ተጠቃሚው ካልተገኘ ማስጠንቀቂያ መስጠት
    if (!userExists) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                callback_query_id: callbackId, 
                text: "⚠️ ይቅርታ፣ መጀመሪያ play ወይም ይጫወቱ የምለው ተጭነው መመዝገብ አለብዎት!", 
                show_alert: true 
            }),
        });
    } else {
        // 3. ተጠቃሚው ከተገኘ ማራኪ የግብዣ መልዕክት ማዘጋጀት
        const botUsername = 'Smartgame21_bot'; 
        const refLink = `https://t.me/${botUsername}?start=${chatId}`;
        
        // ለጓደኛ ሲላክ የሚታይ ረጅም ፅሁፍ
        const shareText = `🔥 አዲስ የቴሌግራም Airdrop እንዳያመልጥዎ!\n\nየ Notcoin እና DOGS እድል አመለጠኝ ብለው ተቆጭተዋል? ይህ አዲስ ፕሮጀክት ገና ስለሆነ አሁኑኑ ይጀምሩ! 🚀\n👇 በዚህ ሊንክ ሲገቡ 1000 coin በነፃ ያገኛሉ!\n\n${refLink}\n\n⏳ ጊዜው ከማለቁ በፊት ቦታዎን ይያዙ!`;
        
        // የማጋሪያ ሊንክ (Share URL)
        const finalShareUrl = `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent("🔥 አዲስ የቴሌግራም Airdrop እንዳያመልጥዎ! አሁኑኑ ይጀምሩ!")}`;

        // 4. ለመልዕክቱ ምላሽ መስጠት
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: callbackId, text: "✅ ዝግጁ ነው!" }),
        });

        // 5. ዋናውን መልዕክት መላክ
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: `<b>የእርስዎ መጋበዣ መልዕክት ዝግጁ ነው!</b>\n\nከታች ያለውን ፅሁፍ ተጭነው ኮፒ በማድረግ ለጓደኞችዎ መላክ ይችላሉ፦\n\n<code>${shareText}</code>`,
                parse_mode: 'HTML',
                reply_markup: { 
                    inline_keyboard: [[{ text: "🚀 አሁኑኑ ለጓደኛ ላክ", url: finalShareUrl }]] 
                }
            }),
        });
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
                try {
                    // 1. የጠቅላላ ተጠቃሚዎች ብዛት (በጣም ፈጣኑ መንገድ)
                    const totalRes = await db.collection('users').count().get();
                    const totalUsers = totalRes.data().count;

                    // 2. የታገዱ ተጠቃሚዎች ብዛት
                    const bannedRes = await db.collection('users').where('is_banned', '==', true).count().get();
                    const bannedUsers = bannedRes.data().count;

                    // 3. ንቁ ተጠቃሚዎች (ከጠቅላላው የታገዱትን በመቀነስ)
                    const activeUsers = totalUsers - bannedUsers;

                    const msg = `📊 <b>የSmart Airdrop ስታቲስቲክስ:</b>\n\n` +
                        `👥 <b>ጠቅላላ ተጠቃሚዎች:</b> ${totalUsers.toLocaleString()}\n` +
                        `🚫 <b>የታገዱ ተጠቃሚዎች:</b> ${bannedUsers.toLocaleString()}\n` +
                        `✅ <b>ንቁ ተጠቃሚዎች:</b> ${activeUsers.toLocaleString()}`;

                    await sendToAdmin(msg);
                } catch (error) {
                    console.error("Stats Error:", error);
                    await sendToAdmin(`❌ ስታቲስቲክስ ለማምጣት ስህተት ተፈጥሯል: ${error.message}`);
                }
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

                    const inviteCount = userData.invite_count || 0;
              const rankRes = await db.collection('users')
           .where('total_score', '>', userData.total_score || 0)
          .count().get();
          const userRank = rankRes.data().count + 1;

                    
                   const name = userData.first_name || userData.username || 'ያልታወቀ';

                    const score = userData.total_score || 0;
                    const createdAt = userData.created_at ? userData.created_at.toDate().toLocaleString('en-GB') : 'ያልታወቀ';
                    const isBanned = userData.is_banned ? "🚫 የታገደ (Banned)" : "✅ ንቁ (Active)";
                    const invitedBy = userData.referrer_id || "በራሱ የመጣ";

                    const msg = `🔍 <b>የተጠቃሚ መረጃ:</b>\n\n` +
                        `👤 <b>ስም:</b> ${name}\n` +
                        `🆔 <b>ID:</b> <code>${targetIdString}</code>\n` +
                        `💰 <b>Score:</b> ${score.toLocaleString()}\n` +
                        `🏆 <b>ደረጃ:</b> #${userRank}\n` + 
                        `👥 <b>Invites:</b> ${inviteCount}\n` +
                        `📅 <b>የተመዘገበው:</b> ${createdAt}\n` +
                        `🚦 <b>ሁኔታ:</b> ${isBanned}\n` +
                        `🔗 <b>የጋበዘው:</b> <code>${invitedBy}</code>`;


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

      // ============================================================
            // 🔥 FIXED /mreply COMMAND (በትክክል የሚሰራው)
            // ============================================================
            if (text && text.startsWith('/mreply')) {
                // Regex በመጠቀም መልዕክቱን እና ID በትክክል መለየት
                // ቅርጽ: /mreply ID1,ID2 መልዕክት...
                const match = text.match(/^\/mreply\s+([\d,]+)\s+(.+)/s);
                
                if (!match) {
                    await sendToAdmin("⚠️ <b>አጠቃቀም:</b> `/mreply id1,id2 message`\n\nምሳሌ:\n`/mreply 12345,67890 ሰላም እንዴት ነህ? [አዎ]{yes} [አይ]{no}`");
                    return { statusCode: 200, body: 'Invalid syntax' };
                }

                const ids = match[1].split(',').map(id => id.trim());
                let msgContent = match[2];

                // አዝራሮችን (Buttons) ማዘጋጀት
                let inlineKeyboard = [];
                
                // ሀ. ሊንኮችን ማውጣት [Text](Link)
                const linkMatches = [...msgContent.matchAll(/\[(.*?)\]\((.*?)\)/g)];
                linkMatches.forEach(match => {
                    inlineKeyboard.push([{ text: match[1], url: match[2] }]);
                    msgContent = msgContent.replace(match[0], '');
                });

                // ለ. የድምጽ መስጫ አዝራሮችን ማውጣት [Text]{Callback}
                // ምሳሌ: [አዎ]{yes} [አይ]{no}
                const cbMatches = [...msgContent.matchAll(/\[(.*?)\]\{(.*?)\}/g)];
                if (cbMatches.length > 0) {
                    let cbRow = [];
                    cbMatches.forEach(match => {
                        // እዚህ ጋር 'ans_' የሚለውን በራሱ ይጨምርለታል
                        const cbData = match[2].startsWith('ans_') ? match[2] : `ans_${match[2]}`;
                        cbRow.push({ text: match[1], callback_data: cbData });
                        msgContent = msgContent.replace(match[0], '');
                    });
                    inlineKeyboard.push(cbRow);
                }

                msgContent = msgContent.trim();
                
                let successCount = 0;
                let failCount = 0;
                let errorReport = "";

                await sendToAdmin("⏳ መልዕክት በመላክ ላይ... እባክዎ ይጠብቁ።");

                for (const targetId of ids) {
                    try {
                        // ስም ከዳታቤዝ መፈለግ
                        let firstName = "ወዳጄ";
                        try {
                           const userDoc = await db.collection('users').doc(targetId).get();
                           if (userDoc.exists) {
                               firstName = userDoc.data().first_name || "ወዳጄ";
                           } else {
                               const qCheck = await db.collection('users').where('telegram_id', '==', Number(targetId)).limit(1).get();
                               if(!qCheck.empty) firstName = qCheck.docs[0].data().first_name || "ወዳጄ";
                           }
                        } catch (dbErr) { console.error("DB Ignore:", dbErr); }

                        // HTML Escape (ስም ውስጥ < > ካለ እንዳይበላሽ)
                        const safeName = firstName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                        const finalMsg = msgContent.replace(/{name}/g, safeName);

                        // መልዕክቱን መላክ
                        const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                chat_id: targetId,
                                text: `✉️ <b>Smart Airdrop:</b>\n\n${finalMsg}`,
                                parse_mode: 'HTML',
                                reply_markup: (inlineKeyboard && inlineKeyboard.length > 0)  ? { inline_keyboard: inlineKeyboard }  : undefined

                             
                            })
                        });

                        const resData = await res.json();

                        if (resData.ok) {
                            successCount++;
                        } else {
                            failCount++;
                            errorReport += `\n❌ <b>ID ${targetId}:</b> ${resData.description}`;
                        }

                    } catch (err) { 
                        failCount++;
                        errorReport += `\n❌ <b>ID ${targetId}:</b> Network Error`;
                    }
                }

                // ሪፖርት ለአድሚን
                let summary = `📊 <b>የስርጭት ሪፖርት:</b>\n\n` +
                              `✅ <b>የደረሳቸው:</b> ${successCount}\n` +
                              `🚫 <b>ያልደረሳቸው:</b> ${failCount}`;
                
                if (failCount > 0) {
                    summary += `\n\n<b>የስህተት ዝርዝር:</b>${errorReport}`;
                }

                await sendToAdmin(summary);
                return { statusCode: 200, body: 'OK' };
            }


        } // <--- 🔥 እዚህ ጋር ነው የጎደለው ቅንፍ የተጨመረው (Admin Block Closed) 🔥


if (text && text.startsWith('/start')) {
    const startArgs = text.split(' ');
    let rawReferrer = startArgs.length > 1 ? startArgs[1] : null;
    
    // 🛑 ማስተካከያ 1፡ referrerId ለ Mini App እንዲመች ንጹህ ID ብቻ መሆን አለበት
    // "በራሱ የመጣ" የሚለው ለሪፖርት ብቻ እንዲያገለግል እናደርጋለን
    let referrerIdForApp = (rawReferrer && /^\d+$/.test(rawReferrer) && String(rawReferrer) !== String(chatId)) ? rawReferrer : null;
    let referrerTextForAdmin = referrerIdForApp ? referrerIdForApp : (rawReferrer === String(chatId) ? "በራሱ የመጣ (Self)" : "በራሱ የመጣ");

    // 🔥 ማስተካከያ 2፡ ተጠቃሚው መኖሩን በሁለት መንገድ ማረጋገጥ (Document ID እና Field)
    let userExists = false;

    // 1. መጀመሪያ በ Document ID (ለአዲሶቹ)
    const directDoc = await db.collection('users').doc(String(chatId)).get();
    if (directDoc.exists) {
        userExists = true;
    } else {
        // 2. ካልተገኘ በ telegram_id field (ለድሮዎቹ በ auto-id ላሉት)
        const querySnap = await db.collection('users').where('telegram_id', '==', Number(chatId)).limit(1).get();
        if (!querySnap.empty) {
            userExists = true;
        } else {
            // እንደገና በ String ደግሞ መፈለግ (ለጥንቃቄ)
            const querySnapStr = await db.collection('users').where('telegram_id', '==', String(chatId)).limit(1).get();
            if (!querySnapStr.empty) userExists = true;
        }
    }

    // 🔥 ተጠቃሚው በፍጹም ካልተገኘ ብቻ (አዲስ ከሆነ) ሪፖርት ይላካል
    if (!userExists) {
        const newUserInfo = `🔔 <b>አዲስ ተጠቃሚ ተቀላቅሏል!</b>\n\n` +
            `👤 <b>ስም:</b> <a href="tg://user?id=${chatId}">${user.first_name || 'ያልታወቀ'}</a>\n` +        
            `🆔 <b>ID:</b> <code>${chatId}</code>\n` +
            `🔗 <b>Username:</b> ${user.username ? '@' + user.username : 'የለውም'}\n` +
            `🌍 <b>ቋንቋ:</b> ${user.language_code || 'ያልታወቀ'}\n` +
            `👥 <b>የጋባዥ ID:</b> <code>${referrerTextForAdmin}</code>\n` +
            `📅 <b>ቀን:</b> ${new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')} UTC`;

        await sendToAdmin(newUserInfo);
        
        // ጋባዥ ካለ ለጋባዡ መልዕክት ይላካል
        if (referrerIdForApp) {
            try {
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: referrerIdForApp,
                        text: `🔔 <b>አዲስ ሰው በእርሷ ሊንክ ገብቷል!</b>\n\n@${user.username || user.first_name} ወደ ጨዋታው (Play Now) ተጭኖ ሲገባ ወዲያውኑ እርሷ 500 Coins ያገኛሉ።`,
                        parse_mode: 'HTML'
                    }),
                });
            } catch (err) {
                console.error("Referrer notification failed:", err);
            }
        }
    }

    // Welcome Message ለሁሉም
    const welcome = `<b>እንኳን በደህና መጡ ወደ Smart Airdrop 🚀</b>\n\n💎 ይህ የሽልማት ዓለም ነው — የብዙዎች ዕድል እና የብቸኛዎች ግንባር!\nእያንዳንዱ ነጥብ ዕድል ነው፣ እያንዳንዱ ጨዋታ ተስፋ ነው 🎯\n🌟 ዛሬ የአንተ ቀን ነው — ጀምር እና አሸንፈው!\n\n🚀 ለመጀመር ከታች ያለውን አዝራር ይጫኑ።`;

    const miniAppUrl = "https://newsmartgame.netlify.app/";
 

    // ============================================================
    // 🔥 አዲስ የተጨመረ፡ MENU BUTTON DYNAMIC UPDATE 🔥
    // ተጠቃሚው በሪፈራል ከመጣ፣ የታችኛው Menu Button መረጃውን እንዲይዝ እናደርጋለን
    // ============================================================
    

    if (referrerIdForApp) {
        try {
            // ለዚህ ተጠቃሚ ብቻ የታችኛውን ቁልፍ እንቀይራለን
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setChatMenuButton`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    menu_button: {
                        type: "web_app",
                        text: "Play Now 🚀", // ቁልፉ ላይ የሚፃፈው
                        web_app: { 
                            // እዚህ ጋር ነው ምስጢሩ! መረጃውን ከሊንኩ ጋር አብረን እንልካለን
                            url: `${miniAppUrl}?tgWebAppStartParam=${referrerIdForApp}` 
                        }
                    }
                })
            });
        } catch (err) {
            console.error("Menu Button Update Failed:", err);
        }
    }
    // ============================================================

    

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
                    // 🛑 ማስተካከያ 3፡ እዚህ ጋር referrerIdForApp ብቻ ነው መላክ ያለበት (ጽሁፍ መሆን የለበትም)
                    [{ text: "🚀 Play Now ", web_app: { url: referrerIdForApp ? `${miniAppUrl}?tgWebAppStartParam=${referrerIdForApp}` : miniAppUrl } }]
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

// 🔥 ይሄ Function አዲሱ ኮድ ላይ ጠፍቶ ነበር፣ አሁን ተመልሷል 🔥
async function sendToAdmin(text) {
    if(!ADMIN_ID) return;
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: ADMIN_ID, text: text, parse_mode: 'HTML' }),
        });
    } catch (e) {
        console.error("Failed to send to admin:", e);
    }
   
}
