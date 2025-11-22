const fetch = require('node-fetch');

// Netlify ላይ የምናስገባቸው ሚስጥራዊ ቁልፎች
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

exports.handler = async (event, context) => {
    // POST request ብቻ ነው የምንቀበለው
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const message = body.message;
        // ሰውዬው የራሱን ID ከላከ ወደ እሱ እንልካለን፣ ካልላከ ወደ አንተ (Admin) እንልካለን
        const targetChatId = body.custom_chat_id ? body.custom_chat_id : ADMIN_ID;

        if (!message) {
            return { statusCode: 400, body: 'Message is empty' };
        }

        // ወደ Telegram API መላክ
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

        if (response.ok) {
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, result: data })
            };
        } else {
            console.error("Telegram Error:", data);
            return {
                statusCode: 400,
                body: JSON.stringify({ success: false, error: data.description })
            };
        }

    } catch (error) {
        console.error("Server Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
