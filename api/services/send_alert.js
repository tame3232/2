const fetch = require('node-fetch');

// Netlify Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
// የእርስዎ የNetlify ሳይት ሊንክ (Mini App Link) እዚህ ያስገቡ
const WEB_APP_URL = "https://newsmartgames.netlify.app/"; 

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event, context) => {
    
    // 1. Handle Preflight Options
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: 'OK' };
    }

    // 2. Only Allow POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);

        // ============================================================
        // ክፍል 1: የቴሌግራም Webhook (ለ /start ትዕዛዝ ምላሽ መስጫ)
        // ============================================================
        if (body.message && body.message.text) {
            const chatId = body.message.chat.id;
            const text = body.message.text;

            if (text === '/start') {
                const welcomeMsg = "እንኳን በደህና መጡ ወደ Smart Airdrop 🚀
💎 ይህ የሽልማት ዓለም ነው — የብዙዎች ዕድል እና የብቸኛዎች ግንባር!
እያንዳንዱ ነጥብ ዕድል ነው፣ እያንዳንዱ ጨዋታ ተስፋ ነው 🎯
🌟 ዛሬ የአንተ ቀን ነው — ጀምር እና አሸንፈው!
⬇️
 🚀\n\n ለመጀመር ከታች ያለውን አዝራር ይጫኑ።";
                
                // መልዕክቱን እና አዝራሩን መላክ
                await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: welcomeMsg,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[
                                { 
                                    text: "🚀 Start App", 
                                    web_app: { url: WEB_APP_URL } 
                                }
                            ]]
                        }
                    }),
                });

                return { statusCode: 200, body: 'OK' };
            }
        }

        // ============================================================
        // ክፍል 2: ከሚኒ አፑ ወደ አድሚን መልዕክት መላኪያ (የድሮው ኮድ)
        // ============================================================
        
        // ይህ የሚሠራው ከላይ ያለው የቴሌግራም logic ካልተነካ ብቻ ነው
        const message = body.message;
        // custom_chat_id ከሌለ ወደ Admin ይላኩ
        const targetChatId = body.custom_chat_id ? body.custom_chat_id : ADMIN_ID; 

        if (message && !body.update_id) { // update_id የሌለው ከሆነ (ማለትም ከቴሌግራም ያልመጣ)
             const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
             const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: targetChatId,
                    text: message,
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

        // ምንም ካልሆነ (Just return OK to keep Telegram happy)
        return { statusCode: 200, headers: CORS_HEADERS, body: 'OK' };

    } catch (error) {
        console.error("Server Error:", error);
        return {
            statusCode: 500,
            headers: CORS_HEADERS,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
