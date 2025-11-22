// functions/send_alert.js
// 🛑 ይህ ኮድ BOT_TOKEN እና ADMIN_IDን ከ Netlify Variables ያነባል!

const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

exports.handler = async (event, context) => {
    // 🛑 LOG 1: Functionው መጀመሩን ለማረጋገጥ!
    console.log("--- Netlify Alert Function Started ---");

    // 1. HTTP Method እና Body መኖሩን ማረጋገጥ
    if (event.httpMethod !== 'POST' || !event.body) {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { message } = JSON.parse(event.body);

        if (!message) {
            return { statusCode: 400, body: 'Missing message parameter.' };
        }

        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        // 2. ወደ ቴሌግራም API መላክ
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_ID,
                text: message,
                parse_mode: 'HTML' 
            }),
        });
        
        const data = await response.json();

        if (response.ok) {
            // 🛑 LOG 2: ስኬት መሆኑን መመዝገብ
            console.log("Telegram API Success:", data);
            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, telegram_response: data }),
            };
        } else {
            // 🛑 LOG 3: የቴሌግራም API ስህተትን ሙሉ በሙሉ መመዝገብ
            console.error("Telegram API Error Response:", data);
            
            // 3. የቴሌግራም API ስህተትን መያዝ
            return {
                statusCode: response.status,
                body: JSON.stringify({ success: false, error: data.description || 'Telegram API Error' }),
            };
        }

    } catch (error) {
        // 🛑 LOG 4: ያልተጠበቀ ስህተት መመዝገብ
        console.error("Function Execution Failed:", error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message || 'Internal Server Error' }),
        };
    }
};
