const fetch = require('node-fetch');

// Netlify ላይ የምናስገባቸው ሚስጥራዊ ቁልፎች
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

// 🛑 የሚፈለገው የ Headers Block
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*', // ከየትኛውም ቦታ ጥሪ እንዲቀበል
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event, context) => {
    
    // 🚀 አዲስ የተጨመረው ብሎክ: የ OPTIONS ጥያቄዎችን ማስተናገድ (Preflight Request)
    // ሚኒ አፑ POST ከመላኩ በፊት የደህንነት ፍቃድ የሚጠይቅበት መንገድ ነው።
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200, 
            headers: CORS_HEADERS, // CORS Headers ይዞ ይመልሳል
            body: 'OK'
        };
    }

    // POST request ብቻ ነው የምንቀበለው
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers: CORS_HEADERS, 
            body: 'Method Not Allowed' 
        };
    }

    try {
        const body = JSON.parse(event.body);
        const message = body.message;
        const targetChatId = body.custom_chat_id ? body.custom_chat_id : ADMIN_ID;

        if (!message) {
            return { 
                statusCode: 400, 
                headers: CORS_HEADERS, 
                body: 'Message is empty' 
            };
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
                headers: CORS_HEADERS, // Headers ጨምር
                body: JSON.stringify({ success: true, result: data })
            };
        } else {
            console.error("Telegram Error:", data);
            return {
                statusCode: 400,
                headers: CORS_HEADERS, // Headers ጨምር
                body: JSON.stringify({ success: false, error: data.description })
            };
        }

    } catch (error) {
        console.error("Server Error:", error);
        return {
            statusCode: 500,
            headers: CORS_HEADERS, // Headers ጨምር
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
