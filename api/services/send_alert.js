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

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);

        // 1. የቴሌግራም /start ትዕዛዝን ማስተናገድ
        if (body.message && body.message.text) {
            const chatId = body.message.chat.id;
            const text = body.message.text;

            if (text === '/start') {
                const welcomeMsg = `<b>እንኳን በደህና መጡ ወደ Smart Airdrop 🚀</b>\n\n` +
                                 `💎 ይህ የሽልማት ዓለም ነው — የብዙዎች ዕድል እና የብቸኛዎች ግንባር!\n` +
                                 `እያንዳንዱ ነጥብ ዕድል ነው፣ እያንዳንዱ ጨዋታ ተስፋ ነው 🎯\n` +
                                 `🌟 ዛሬ የአንተ ቀን ነው — ጀምር እና አሸንፈው!\n\n` +
                                 `🚀 ለመጀመር ከታች ያለውን አዝራር ይጫኑ።`;
                
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: welcomeMsg,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: "🚀 Start App", web_app: { url: WEB_APP_URL } }
                            ]]
                        }
                    }),
                });
                return { statusCode: 200, body: 'OK' };
            }
        }

        // 2. ከሚኒ አፑ የሚመጣ መልዕክት (Admin Alert)
        if (body.message && !body.update_id) {
            const targetChatId = body.custom_chat_id ? body.custom_chat_id : ADMIN_ID; 
             const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: targetChatId,
                    text: body.message,
                    parse_mode: 'HTML'
                }),
            });

            const data = await response.json();
            return {
                statusCode: 200,
                headers: CORS_HEADERS,
                body: JSON.stringify({ success: true, result: data })
            };
        }

        return { statusCode: 200, headers: CORS_HEADERS, body: 'OK' };

    } catch (error) {
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
