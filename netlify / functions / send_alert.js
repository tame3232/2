// functions/send_alert.js
// 🛑 ይህ ኮድ Environment Variablesን በትክክል ማንበብ መቻሉን ያረጋግጣል!
// የ node-fetch dependency አይፈልግም!

exports.handler = async (event, context) => {
    
    // Environment Variablesን ለማንበብ ይሞክራል
    const BOT_TOKEN_READ = process.env.BOT_TOKEN ? 'READ' : 'NOT READ';
    const ADMIN_ID_READ = process.env.ADMIN_ID ? 'READ' : 'NOT READ';

    // 🛑 LOG የሚታይበት ቦታ
    console.log("--- Environment Variable Test Result ---");
    console.log("BOT_TOKEN Status:", BOT_TOKEN_READ);
    console.log("ADMIN_ID Status:", ADMIN_ID_READ);

    return {
        statusCode: 200,
        body: JSON.stringify({ status: "Test complete. Check Netlify Logs for result." }),
    };
};
