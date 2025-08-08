import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import crypto from 'crypto';

// Import your agent functions
import { createProposal, tallyApprovals, submitApproval } from '../approvr-agent.js';

dotenv.config();

// --- Basic Setup ---
const app = express();
app.use(bodyParser.json());

const __filename = fileURLToPath(import.meta.url);
// Vercel handles paths differently, so we need to be careful
const __dirname = path.dirname(path.dirname(__filename)); // Go up one level from /api

// --- In-Memory Storage (IMPORTANT CAVEAT - see below) ---
// Note: In a stateless serverless environment, this data will be lost on every new invocation.
// This is okay for a quick demo, but for production, you need an external database (Vercel KV, Redis, etc.)
const userData = new Map();
const userStates = new Map(); // You can likely remove this as /submitsig is gone
const serverUserData = new Map();

// --- Telegraf Bot Setup (Webhook Method) ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// --- Bot Command Handlers (Copied from telegram-bot.js) ---
// All your bot.command(...) and bot.start(...) handlers go here.
// I've included the simulated linkaccount for you.

bot.command('linkaccount', async (ctx) => {
    const userId = ctx.from.id;
    const hederaAccountId = ctx.message.text.substring('/linkaccount'.length).trim();

    if (!hederaAccountId || !hederaAccountId.startsWith("0.0.")) {
        return ctx.reply("❌ Please provide a valid Hedera Account ID starting with '0.0.'.", { parse_mode: 'MarkdownV2' });
    }
    
    console.log(`Simulating link for user ${userId} to account ${hederaAccountId}`);
    // Store link directly
    userData.set(userId, { hederaAccountId, linkedAt: new Date().toISOString() });
    serverUserData.set(userId.toString(), { verifiedHederaAccountId: hederaAccountId });

    await ctx.reply(`✅ Simulated successful verification for \`${hederaAccountId}\`\\. Link established for demo purposes\\.`, { parse_mode: 'MarkdownV2' });
});

bot.command('create', async (ctx) => {
    // ... copy the full /create command logic here ...
});

bot.command('approve', async (ctx) => {
    const userId = ctx.from.id;
    const topicId = ctx.message.text.substring('/approve'.length).trim();
    // IMPORTANT: Your Vercel deployment URL
    const VERCEL_URL = process.env.VERCEL_URL; 
    
    if (!topicId.startsWith("0.0.")) {
        return ctx.reply("❌ Invalid Topic ID.");
    }
    const userLinkData = userData.get(userId);
    if (!userLinkData) {
        return ctx.reply("❌ Please link your account first using `/linkaccount`.");
    }
    const miniAppUrl = `https://${VERCEL_URL}/approve?topic_id=${topicId}&user_account=${userLinkData.hederaAccountId}`;

    await ctx.reply(`Please confirm your approval for topic \`${topicId}\` using the Mini App.`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: "🔐 Approve in Mini App", web_app: { url: miniAppUrl } }]]
        }
    });
});

bot.command('tally', async (ctx) => {
    // ... copy the full /tally command logic here ...
});

// --- API Endpoints ---

// 1. Webhook Endpoint for Telegram
// This is where Telegram sends updates. The `POST` method is important.
app.post('/api/webhook', async (req, res) => {
    try {
        await bot.handleUpdate(req.body, res);
    } catch (err) {
        console.error("Error handling update:", err);
    }
});

// 2. Your existing API endpoints for the Mini App
app.post('/api/approve', async (req, res) => {
    const { telegramUserId, topicId } = req.body;
    if (!telegramUserId || !topicId) {
        return res.status(400).json({ error: "Missing data." });
    }

    // Use server's map (with the serverless caveat in mind)
    const linkData = serverUserData.get(telegramUserId.toString());
    if (!linkData || !linkData.verifiedHederaAccountId) {
        return res.status(401).json({ error: "User not linked or link not found in this instance." });
    }

    console.log(`🚀 Processing approval for Topic ${topicId} by VERIFIED user ${telegramUserId} (${linkData.verifiedHederaAccountId})`);
    try {
        const result = await submitApproval(topicId, linkData.verifiedHederaAccountId);
        res.json({ success: result.status === 'success', message: result.message });
    } catch (error) {
        res.status(500).json({ error: "An internal error occurred." });
    }
});

// --- Serve Static Files ---
// This serves your public directory for the Mini App.
app.use(express.static(path.join(__dirname, 'public')));
app.get('/approve', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'approve.html'));
});
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Vercel Export ---
// This exports the Express app for Vercel to use.
export default app;