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


        // ============================================================
        // 🚨 ከሚኒ አፑ የሚመጡ የችግር መልዕክቶችን ለአድሚን ማድረሻ (Error Handler)
        // ============================================================
        if (body.type === 'miniapp_error') {
            const errorDetails = body.error || 'ያልታወቀ ስህተት';
            const userDetails = body.user_id ? `\n👤 <b>የተጠቃሚ ID:</b> <code>${body.user_id}</code>` : '';
            const pageDetails = body.page ? `\n📍 <b>የተከሰተበት ገጽ:</b> ${body.page}` : '';

            const alertMsg = `⚠️ <b>Mini App Error Alert!</b>\n\n` +
                             `❌ <b>ችግር:</b> <code>${errorDetails}</code>` + 
                             `${pageDetails}${userDetails}\n` +
                             `📅 <b>ጊዜ:</b> ${new Date().toLocaleString()}`;

            await sendToAdmin(alertMsg);
            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: true, message: 'Error logged to admin' })
            };
        }

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
                text = body.message.text || "";

            user = body.message.from;
        }


        // ==========================================
        // 👥 MULTI-ADMIN (ተባባሪ አድሚን ማረጋገጫ)
        // ==========================================
        let isAdmin = (String(chatId) === String(ADMIN_ID));
        if (!isAdmin) {
            try {
                const adminCheck = await db.collection('settings').doc('co_admins').get();
                if (adminCheck.exists && adminCheck.data().admin_ids) {
                    isAdmin = adminCheck.data().admin_ids.includes(String(chatId));
                }
            } catch (e) { console.error("Admin check error:", e); }
        }

        // ============================================================
        // 🔥 MAINTENANCE CHECK (የጥገና ማጣሪያ)
        // ============================================================

        // 1. የቅንብር መረጃ ከ Database ማምጣት
        const configDoc = await db.collection('settings').doc('bot_config').get();
        const isMaintenance = configDoc.exists ? configDoc.data().maintenance_mode : false;

        // 2. ጥገና ላይ ከሆነ እና ተጠቃሚው Admin ካልሆነ
    if (isMaintenance && !isAdmin) {

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
        
if (isAdmin) {

       // 📢 1. ALERT ALL - በሚኒ አፑ ላይ አስቸኳይ ብቅ የሚል ማስታወቂያ (ለሁሉም ወይም ለተወሰነ ሰው በ ID)
if (text && text.startsWith('/alert_all ')) {
    const rawContent = text.substring(text.indexOf(' ') + 1).trim();
    const parts = rawContent.split(' ');
    
    let targetUser = "all"; // በዲፎልት ለሁሉም ነው
    let remainingText = rawContent;

    // 🔍 የመጀመሪያው ቃል የተጠቃሚ ID (ቁጥር) መሆኑን መፈተሽ
    if (/^\d+$/.test(parts[0])) {
        targetUser = parts[0]; // የሰውየው የቴሌግราม ID ይሆናል
        remainingText = parts.slice(1).join(' ').trim(); // የቀረው ፅሁፍ ይሆናል
    }

    let mediaUrl = "";
    let alertMessage = remainingText;

    // 🔗 ምስል ወይም ቪዲዮ ሊንክ ካለ ለይቶ መውሰጃ
    if (remainingText.startsWith('http://') || remainingText.startsWith('https://')) {
        const mediaParts = remainingText.split(' ');
        mediaUrl = mediaParts[0];
        alertMessage = mediaParts.slice(1).join(' ').trim();
    }

    // 💾 Firebase ላይ መረጃውን መጫን
    await db.collection('settings').doc('popup_alert').set({
        message: alertMessage,
        image_url: mediaUrl,
        target: targetUser, // 🎯 "all" ወይም የተጠቃሚው "ID" እዚህ ይቀመጣል
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        is_active: true
    }, { merge: true });

    let successMsg = `📢 <b>የአስቸኳይ ማስታወቂያ ስርጭት ተጭኗል!</b>\n\n`;
    successMsg += `🎯 <b>ለማን:</b> ${targetUser === "all" ? "ለሁሉም ተጠቃሚዎች 👥" : `ለተጠቃሚ ID: <code>${targetUser}</code> 👤`}\n`;
    successMsg += `📝 <b>መልዕክት:</b> "${alertMessage}"`;
    if (mediaUrl) successMsg += `\n🖼 <b>የሚዲያ ሊንክ:</b> ${mediaUrl}`;
    
    await sendToAdmin(successMsg, chatId);
    return { statusCode: 200, body: 'OK' };
}

// 📢 ALERT OFF - ማስታወቂያውን ለማጥፋት
else if (text === '/alert_off') {
    await db.collection('settings').doc('popup_alert').set({ is_active: false }, { merge: true });
    await sendToAdmin(`📴 የPopup ማስታወቂያው በተሳካ ሁኔታ እንዲጠፋ ተደርጓል።`, chatId);
    return { statusCode: 200, body: 'OK' };
}

 // ዋና አድሚን ብቻ ተባባሪ መሾም/መሻር እንዲችል
            if (text && text.startsWith('/add_admin ') && String(chatId) === String(ADMIN_ID)) {
                const newAdminId = text.split(' ')[1].trim();
                await db.collection('settings').doc('co_admins').set({
                    admin_ids: admin.firestore.FieldValue.arrayUnion(newAdminId)
                }, { merge: true });
                await sendToAdmin(`✅ አዲስ አድሚን (ID: <code>${newAdminId}</code>) በተሳካ ሁኔታ ተሹሟል።`, chatId);
                return { statusCode: 200, body: 'OK' };
            }

            if (text && text.startsWith('/remove_admin ') && String(chatId) === String(ADMIN_ID)) {
                const oldAdminId = text.split(' ')[1].trim();
                await db.collection('settings').doc('co_admins').set({
                    admin_ids: admin.firestore.FieldValue.arrayRemove(oldAdminId)
                }, { merge: true });
                await sendToAdmin(`🚫 አድሚን (ID: <code>${oldAdminId}</code>) ከስልጣን ተነስቷል።`, chatId);
                return { statusCode: 200, body: 'OK' };
            }

            // 🔧 Maintenance ማዘዣዎች
            if (text === '/maintenance on') {
                await db.collection('settings').doc('bot_config').set({ maintenance_mode: true }, { merge: true });
                await sendToAdmin("🔴 <b>Maintenance Mode ON!</b>\n\nቦቱ ለተጠቃሚዎች ተዘግቷል። ለእርስዎ ግን ይሰራል::", chatId);
                return { statusCode: 200, body: 'OK' };
            }

            if (text === '/maintenance off') {
                await db.collection('settings').doc('bot_config').set({ maintenance_mode: false }, { merge: true });
                await sendToAdmin("🟢 <b>Maintenance Mode OFF!</b>\n\nቦቱ ወደ መደበኛ ስራ ተመልሷል።", chatId);
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

                    await sendToAdmin(msg,chatId);
              

                } catch (error) {
                    console.error("Stats Error:", error);
                    await sendToAdmin(`❌ ስታቲስቲክስ ለማምጣት ስህተት ተፈጥሯል: ${error.message}`, chatId);
              
                }
                return { statusCode: 200, body: 'OK' };
            }

if (text === '/banned_list') {
    try {
        // በዳታቤዝ ውስጥ 'is_banned' እውነት (true) የሆኑትን ብቻ መፈለግ
        const querySnapshot = await db.collection('users')
            .where('is_banned', '==', true)
            .get();

        if (querySnapshot.empty) {
            await sendToAdmin("✅ <b>እስካሁን የታገደ (Banned) ተጠቃሚ የለም።</b>",chatId);
            return { statusCode: 200, body: 'No banned users' };
        }

        let msg = `🚫 <b>የታገዱ ተጠቃሚዎች ዝርዝር (ጠቅላላ: ${querySnapshot.size}):</b>\n\n`;
        let counter = 1;

        querySnapshot.forEach(doc => {
            const uData = doc.data();
            const name = uData.first_name || uData.username || 'ያልታወቀ';
            msg += `${counter}. 👤 <b>${name}</b> | 🆔 <code>${doc.id}</code>\n`;
            counter++;
        });

       
    await sendToAdmin(msg, chatId);

    
    } catch (error) {
        console.error("Banned List Error:", error);
        await sendToAdmin(`❌ ዝርዝሩን ለማምጣት ስህተት ተፈጥሯል: ${error.message}`, chatId);
    }



    return { statusCode: 200, body: 'OK' };
}
            // ==========================================
            // 1. TOP 10 INVITERS (የጋባዦች ደረጃ)
            // ==========================================
            if (text === '/top_inviters') {
                try {
                    const snapshot = await db.collection('users').orderBy('invite_count', 'desc').limit(10).get();
                    if (snapshot.empty) {
                        await sendToAdmin("⚠️ ማንም ሰው እስካሁን አልጋበዘም።",chatId);
                        return { statusCode: 200, body: 'OK' };
                    }
                    
                    let msg = "🏆 <b>ከፍተኛ ሰው የጋበዙ (Top 10):</b>\n\n";
                    let rank = 1;
                    snapshot.forEach(doc => {
                        const d = doc.data();
                        const name = d.first_name || 'ያልታወቀ';
                        const uname = d.username ? `@${d.username}` : 'የለውም';
                        const invites = d.invite_count || 0;
                        msg += `${rank}. <b>${name}</b> (${uname})\n └ ID: <code>${doc.id}</code> | 👥 ጋበዘ: <b>${invites}</b>\n\n`;
                        rank++;
                    });
                   await sendToAdmin(msg, chatId);
                } catch (err) {
                    await sendToAdmin(`❌ ስህተት: ${err.message}`,chatId);
                }
                return { statusCode: 200, body: 'OK' };
            }

            // ==========================================
            // 4. USER HISTORY (የተጠቃሚ ታሪክ)
            // ==========================================
            if (text && text.startsWith('/user_history')) {
                const targetId = text.split(' ')[1]?.trim();
                if (!targetId) {
                    await sendToAdmin("⚠️ አጠቃቀም: `/user_history [ID]`", chatId);
                    return { statusCode: 200, body: 'Missing ID' };
                }

                try {
                    const userDoc = await db.collection('users').doc(targetId).get();
                    if (!userDoc.exists) {
                        
await sendToAdmin(`❌ ተጠቃሚ (ID: ${targetId}) አልተገኘም።`, chatId);

                        return { statusCode: 200, body: 'Not found' };
                    }
                    
                    const d = userDoc.data();
                    const name = d.first_name || 'ያልታወቀ';
                    const created = d.created_at ? d.created_at.toDate().toLocaleString('en-GB') : 'ያልተመዘገበ';
                    const score = d.total_score || 0;
                    const isKyc = d.kyc_status || 'አልተላከም'; // KYC ካለህ
                    const lastActive = d.last_active ? d.last_active.toDate().toLocaleString('en-GB') : 'መረጃ የለም';

                    const msg = `🕒 <b>የተጠቃሚ ታሪክ ማጠቃለያ:</b>\n\n` +
                        `👤 <b>ስም:</b> ${name} (<code>${targetId}</code>)\n` +
                        `📅 <b>የተመዘገበበት:</b> ${created}\n` +
                        `💰 <b>ያለው ኮይን:</b> ${score.toLocaleString()}\n` +
                        `🔒 <b>የ KYC ሁኔታ:</b> ${isKyc}\n` +
                        `🎮 <b>ለመጨረሻ ጊዜ የታየው:</b> ${lastActive}`;
                    
                    await sendToAdmin(msg,chatId);
                } catch (err) {
                    await sendToAdmin(`❌ ስህተት ተፈጥሯል: ${err.message}`,chatId);
                }
                return { statusCode: 200, body: 'OK' };
            }

            if (text && text.startsWith('/check_user')) {
                const parts = text.split(' ');
                if (parts.length < 2) {
                    await sendToAdmin("⚠️ እባክዎ የUser ID ያስገቡ።\nምሳሌ: <code>/check_user 123456789</code>",chatId);
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
                        await sendToAdmin(`❌ ይህ ተጠቃሚ (ID: ${targetIdString}) ዳታቤዝ ውስጥ የለም።`,chatId);
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


                    await sendToAdmin(msg, chatId);

                } catch (error) {
                    console.error(error);
                    await sendToAdmin(`❌ የፍለጋ ስህተት: ${error.message}`,chatId);
                }
                return { statusCode: 200, body: 'OK' };
            }


if (text && text.startsWith('/invites')) {
    const parts = text.split(' ');
    if (parts.length < 2) {
        await sendToAdmin("⚠️ እባክዎ የUser ID ያስገቡ።\nምሳሌ: <code>/invites 123456789</code>",chatId);
        return { statusCode: 200, body: 'Missing ID' };
    }

    const targetIdString = parts[1].trim();

    try {
        // በ referrer_id ፊልድ ውስጥ የዚህን ሰው ID የያዙትን ተጠቃሚዎች በሙሉ መፈለግ
        const querySnapshot = await db.collection('users')
            .where('referrer_id', '==', targetIdString)
            .get();

        if (querySnapshot.empty) {
            await sendToAdmin(`👥 <b>ID: ${targetIdString}</b> እስካሁን ማንም ሰው አልጋበዘም።`,chatId);
            return { statusCode: 200, body: 'No invites found' };
        }

        let inviteList = `👥 <b>የ ID <code>${targetIdString}</code> የግብዣ ዝርዝር (ጠቅላላ: ${querySnapshot.size}):</b>\n\n`;
        let counter = 1;

        querySnapshot.forEach(doc => {
            const uData = doc.data();
            const uName = uData.first_name || uData.username || 'ያልታወቀ';
            const uScore = uData.total_score || 0;
            
            inviteList += `${counter}. 👤 <b>${uName}</b> (ID: <code>${doc.id}</code>) - 💰 ${uScore.toLocaleString()} Coins\n`;
            counter++;
        });

        // መልዕክቱ በጣም ረጅም ከሆነ ቴሌግራም እንዳይከለክለው ቁርጥራጭ አድርጎ መላክ
        if (inviteList.length > 4000) {
            inviteList = inviteList.substring(0, 3900) + "\n\n... እና ሌሎችም (ዝርዝሩ በጣም ረጅም ነው)";
        }

        await sendToAdmin(inviteList,chatId);

    } catch (error) {
        console.error("Invites Error:", error);
        await sendToAdmin(`❌ ዝርዝሩን ለማምጣት ስህተት ተፈጥሯል: ${error.message}`,chatId);
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
                form.append('chat_id',  chatId);
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
                await sendToAdmin("✅ ስርጭቱ ለሁሉም ተጠቃሚዎች ተጠናቋል።",chatId);
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
                    await sendToAdmin("⚠️ <b>አጠቃቀም:</b> `/mreply id1,id2 message`\n\nምሳሌ:\n`/mreply 12345,67890 ሰላም እንዴት ነህ? [አዎ]{yes} [አይ]{no}`",chatId);
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

                await sendToAdmin("⏳ መልዕክት በመላክ ላይ... እባክዎ ይጠብቁ።",chatId);

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

                await sendToAdmin(summary,chatId);
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
        
        // ==========================================
        // 2. SYSTEM LOGS / ERROR ALERT
        // ==========================================
        if (ADMIN_ID) {
            const errorMsg = `⚠️ <b>System Error Alert!</b>\n\n<b>ችግር:</b> <code>${e.message}</code>\n<b>የተፈጠረበት ቦታ:</b> Main Webhook Handler`;
            try {
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: ADMIN_ID, text: errorMsg, parse_mode: 'HTML' })
                });
            } catch (alertErr) {
                console.error("Alert delivery failed:", alertErr);
            }
        }
        
        return { statusCode: 200, body: 'Error' };
    }
};



// 🔥 ይሄ Function አዲሱ ኮድ ላይ ጠፍቶ ነበር፣ አሁን ተመልሷል 🔥

async function sendToAdmin(text, targetId = ADMIN_ID) {
    if(!targetId) return;
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: targetId, text: text, parse_mode: 'HTML' }),
        });
    } catch (e) {
        console.error("Failed to send to admin:", e);
    }
}
