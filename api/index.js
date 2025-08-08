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

const welcomeAndHelpMessage = `
Welcome to Approvr\! Your Multi-Signature Helper on Hedera.

Approvr helps you coordinate multi-party approvals for transactions or decisions using Hedera Consensus Service topics. It ensures transparency and immutability by storing approval records on-chain.

---

How to Use:

1.  Start a New Proposal:
    /create <description> | <approver1, approver2,...> | <threshold>
    - Description: A brief summary of what you're proposing (e.g., "Send 100 HBAR to 0.0.xyz").
    - Approvers: Comma-separated list of Hedera Account IDs (e.g., 0.0.abc,0.0.def).
    - Threshold: Minimum number of approvals needed (e.g., 2).

    Example:
    /create Send 100 HBAR to 0.0.recipient | 0.0.approver1,0.0.approver2,0.0.approver3 | 2

2.  Approve a Proposal:
    /approve <topic_id>
    - Topic ID: The unique identifier for the proposal topic.

    Example:
    /approve 0.0.123456

3.  Check Proposal Status:
    /tally <topic_id> | <approver1, approver2,...> | <threshold>
    - Topic ID: The unique identifier for the proposal topic.
    - Approvers: Same comma-separated list of approvers used when creating the proposal.
    - Threshold: Minimum number of approvals required.

    Example:
    /tally 0.0.123456 | 0.0.approver1,0.0.approver2,0.0.approver3 | 2

4.  Get Help:
    /help
    - Displays this help message.

---

Sample Workflow:

1.  Create a Proposal:
    /create Send 100 HBAR to 0.0.recipient | 0.0.approver1,0.0.approver2,0.0.approver3 | 2
    You'll receive a response like:
    "Proposal created successfully! Topic ID: 0.0.123456. Share this Topic ID with approvers."

2.  Approve a Proposal:
    As an approver, send:
    /approve 0.0.123456
    You'll see:
    "Approval recorded for 0.0.approver1."

3.  Check Proposal Status:
    To check if enough approvals have been received:
    /tally 0.0.123456 | 0.0.approver1,0.0.approver2,0.0.approver3 | 2
    You might see:
    "Current tally: 1/2 approvals. Need 1 more approval(s)."

---

Important Notes:
- Topic ID: Keep track of the Topic ID for each proposal.
- Approvers: Ensure all approvers know their Hedera Account ID.
- Threshold: Set a reasonable threshold for consensus.
`;


bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id.toString();

    console.log(`New user started chat: ${userId} (${ctx.from.username || 'No Username'})`);

    // Check if user is already linked
    const userLinkData = userData.get(userId);
    let welcomeMessage = `Welcome to Approvr\\! Your Multi\\-Signature Helper on Hedera\\.\n\n`;

    if (userLinkData && userLinkData.hederaAccountId) {
        welcomeMessage += `✅ You are linked to Hedera account: \`${userLinkData.hederaAccountId}\`\n\n`;
        welcomeMessage += `You can now participate in proposals\\.\n`;
    } else {
        welcomeMessage += `🔐 To participate in proposals, you need to link your Hedera account\\.\n`;
        welcomeMessage += `Please use the command: /linkaccount \\<your\\_hedera\\_account\\_id\\>\n`;
        welcomeMessage += `Example: \`/linkaccount 0.0.12345\`\n\n`;
    }

    welcomeMessage += `\\-\\-\\-\n`;
    welcomeMessage += `Use /help to see all available commands\\.`;

    await ctx.reply(welcomeMessage, { parse_mode: 'MarkdownV2' });
});

bot.help((ctx) => {
    ctx.reply(welcomeAndHelpMessage, { parse_mode: 'Markdown' }); // Use Markdown for basic formatting
});

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
    const chatId = ctx.chat.id.toString();
    const userId = ctx.from.id;
    const args = ctx.message.text.substring('/create'.length).trim();

    if (!args) {
        return ctx.reply("Please provide proposal details. Format: /create <description> | <approver1,approver2,...> | <threshold>");
    }

    // Simple parsing: description | approver1,approver2 | threshold
    const parts = args.split(' | ');
    if (parts.length !== 3) {
        return ctx.reply("Invalid format. Please use: /create <description> | <approver1,approver2,...> | <threshold>");
    }

    const description = parts[0].trim();
    const approvers = parts[1].split(',').map(id => id.trim()).filter(id => id); // Split, trim, filter empty
    const thresholdStr = parts[2].trim();
    const threshold = parseInt(thresholdStr, 10);

    if (isNaN(threshold) || threshold <= 0 || threshold > approvers.length) {
         return ctx.reply("Invalid threshold. It must be a number between 1 and the number of approvers.");
    }

    await ctx.sendChatAction('typing');
    try {
        const result = await createProposal(description, approvers, threshold);
        await ctx.reply(result.message || "Proposal creation process completed.");
    } catch (error) {
        console.error(`Error creating proposal for chat ${chatId}:`, error);
        await ctx.reply("Sorry, failed to create the proposal. Please check the format and try again.");
    }
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
    const chatId = ctx.chat.id.toString();
    const userId = ctx.from.id;
    const args = ctx.message.text.substring('/tally'.length).trim();

    if (!args) {
        return ctx.reply("Please provide tally details. Format: /tally <topic_id> | <approver1,approver2,...> | <threshold>");
    }

    const parts = args.split(' | ');
    if (parts.length !== 3) {
        return ctx.reply("Invalid format. Please use: /tally <topic_id> | <approver1,approver2,...> | <threshold>");
    }

    const topicId = parts[0].trim();
    const approvers = parts[1].split(',').map(id => id.trim()).filter(id => id);
    const thresholdStr = parts[2].trim();
    const threshold = parseInt(thresholdStr, 10);

    if (isNaN(threshold) || threshold <= 0 || threshold > approvers.length) {
         return ctx.reply("Invalid threshold for tally. It must be a number between 1 and the number of approvers provided.");
    }

    await ctx.sendChatAction('typing');
    try {
        const result = await tallyApprovals(topicId, approvers, threshold);
        await ctx.reply(result.message || "Tally process completed.");
    } catch (error) {
        console.error(`Error tallying approvals for chat ${chatId}:`, error);
        await ctx.reply("Sorry, failed to tally approvals. Please check the Topic ID and details, and try again.");
    }
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