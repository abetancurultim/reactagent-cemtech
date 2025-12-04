import dotenv from "dotenv";
dotenv.config();
console.log(process.env.CHAT_HISTORY_TABLE);
console.log(process.env.MESSAGES_TABLE);
export const TABLES = {
    CHAT_HISTORY: process.env.CHAT_HISTORY_TABLE || "chat_history",
    MESSAGES: process.env.MESSAGES_TABLE || "messages",
};
