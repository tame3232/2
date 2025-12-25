const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const WEB_APP_URL = "https://newsmartgames.netlify.app/";

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event, context) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: 'OK' };
    }

    try {
        const body = JSON.parse(event.body);

        if (body.message && body.message.text) {
            const chatId = body.message.chat.id;
            const text = body.message.text;
            const user = body.message.from;

            // 1. ለአንድ ሰው መርጦ መልዕክት መላኪያ (Reply System)
            if (String(chatId) === String(ADMIN_ID) && text.startsWith('/reply')) {
                const args = text.split(' ');
                if (args.length < 3) {
                    await sendToAdmin("⚠️ ትክክለኛ አጠቃቀም፡\n<code>/reply [ID] [መልዕክት]</code>");
                    return { statusCode: 200, body: 'OK' };
                }

                const targetId = args[1];
                const replyMsg = text.substring(text.indexOf(args[2]));

                const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: targetId,
                        text: `<b>ከአስተዳዳሪው የተላከ መልዕክት፡</b>\n\n${replyMsg}`,
                        parse_mode: 'HTML'
                    }),
                });

                const result = await response.json();

                if (result.ok) {
                    await sendToAdmin(`✅ መልዕክቱ ለተጠቃሚው (ID: ${targetId}) በትክክል ደርሷል።`);
                } else {
                    await sendToAdmin(`❌ መልዕክቱ አልተላከም። ምክንያት፡ ${result.description}`);
                }
                
                return { statusCode: 200, body: 'OK' };
            }

            // 2. የ /start ትዕዛዝ
            if (text.startsWith('/start')) {
                // ለተጠቃሚው ሰላምታ
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: `<b>እንኳን በደህና መጡ! 🚀</b>\n\nለመጀመር ከታች ያለውን አዝራር ይጫኑ።`,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[{ text: "🚀 Start App", web_app: { url: WEB_APP_URL } }]]
                        }
                    }),
                });

                // ለአንተ (Admin) የሚላክ ዝርዝር መረጃ
                const adminNotice = `🔔 <b>አዲስ ተጠቃሚ ገብቷል!</b>\n\n` +
                                   `👤 ስም: ${user.first_name} ${user.last_name || ''}\n` +
                                   `🆔 ID: <code>${chatId}</code>\n` +
                                   `🔗 User: @${user.username || 'የሌለው'}\n\n` +
                                   `💬 ለመመለስ ይህን ይጫኑ፡\n<code>/reply ${chatId} </code>`;

                await sendToAdmin(adminNotice);
                return { statusCode: 200, body: 'OK' };
            }
        }

        return { statusCode: 200, body: 'OK' };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

// ለአስተዳዳሪው መልዕክት መላኪያ አጋዥ ተግባር
async function sendToAdmin(text) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: ADMIN_ID,
            text: text,
            parse_mode: 'HTML'
        }),
    });
}
