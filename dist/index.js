import express from "express";
import chatRoutes from "./routes/chatRoutes.js";
import cors from "cors";
const app = express();
app.options("*", cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const PORT = process.env.PORT || 3026;
const allowedOrigins = [
    "http://localhost:5173",
    "https://ultim-admin-dashboard.web.app",
    "https://ultim-admin-dashboard.firebaseapp.com",
    "https://dashboard.ultim.pro",
    "https://ultim.pro",
    "https://trasnferchat-1336.twil.io/transferChat",
    "https://trasnferchat-1336.twil.io",
    "https://ultim.pro/dashboard/carestream/chat-carestream",
];
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        }
        else {
            callback(new Error("Not allowed by CORS"));
        }
    },
}));
app.options("*", cors());
app.use("/", chatRoutes);
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
