# **Approvr: On-Chain Consensus via Telegram**

Approvr is a proof-of-concept system that harnesses the power of the Hedera Consensus Service (HCS) and AI agents to facilitate multi-party approvals directly through a Telegram bot. It provides a transparent, immutable, and verifiable way to record group decisions on-chain.

<img width="1187" height="963" alt="image" src="https://github.com/user-attachments/assets/b07ec0aa-057a-4e26-ba38-a2f699ffb230" />
<img width="1184" height="1335" alt="image" src="https://github.com/user-attachments/assets/e96e1aa8-f875-40a9-b845-9068763a05a0" />

Demo Video: https://youtu.be/vy8UhlWIcDQ

**HashScan Links: **

[https://hashscan.io/testnet/topic/0.0.6533923](https://hashscan.io/testnet/topic/0.0.6533923)
[https://hashscan.io/testnet/topic/0.0.6533004](https://hashscan.io/testnet/topic/0.0.6533004)

## **Project Description**

In many collaborative environments, from small teams to DAOs, reaching and recording consensus on decisions (like payments or protocol changes) is often a messy process handled through informal chat messages. This lacks security, auditability, and a single source of truth.

Approvr solves this by providing a simple command-line interface within Telegram. Users can create formal proposals, define who needs to approve them, and set a minimum approval threshold. Every approval is then submitted as a distinct, signed message to a unique topic on the Hedera Consensus Service, creating an unchangeable public record of the decision-making process.

This project utilizes the **Hedera Agent Kit**, leveraging an AI model (via Gaia Node) as a reasoning engine to interact with the Hedera network, demonstrating a modern, agentic approach to blockchain interactions.

## **Core Features**

*   **Simple Telegram Interface:** Interact with the Hedera network using intuitive commands (`/create`, `/approve`, `/tally`) without leaving your chat app.
*   **Agent-Powered Hedera Interactions:** Utilizes the `hedera-agent-kit` and a Gaia Node LLM to abstract away the complexities of Hedera transactions.
*   **On-Chain Proposals:** Each proposal creates a new, dedicated topic on the Hedera Consensus Service.
*   **Immutable Approvals:** Every approval is a permanent message on HCS, providing a cryptographic audit trail.
*   **Transparent Tallying:** Anyone with the topic details can independently verify the status of a proposal.
*   **Mini App Ready:** Includes a pre-built Express web server (`server.js`) designed to serve a Telegram Mini App for more advanced user interactions in the future.

## **How It Works: Architecture**

The project is composed of three main components:

1.  **`telegram-bot.js`**: The main user-facing application. It's a Telegraf-based bot that listens for user commands. It parses user input and calls the appropriate functions in the `approvr-agent.js` to execute tasks. For this version, it runs on a simple long-polling mechanism.

2.  **`approvr-agent.js`**: The core logic engine. This file initializes the `hedera-agent-kit` with the Hedera client and the Gaia Node LLM configuration. It exposes high-level functions (`createProposal`, `submitApproval`, `tallyApprovals`) that translate simple inputs into agent-driven actions on the Hedera network.

3.  **`server.js`**: An Express.js web server designed for future expansion. It currently serves a placeholder `public` directory and includes API endpoints (`/api/approve`, `/api/link-account`) intended to be used by a Telegram Mini App for secure, UI-based approvals.

## **Technology Stack**

*   **Telegram Bot:** Telegraf.js
*   **Hedera Interaction:** Hedera Agent Kit, Langchain.js, Hedera SDK
*   **AI Backend:** Gaia Node (or any OpenAI-compatible endpoint)
*   **Web Server:** Node.js, Express.js
*   **Core Libraries:** `dotenv`, `@langchain/openai`, `zod`

## **Getting Started**

### **Prerequisites**

*   Node.js (v18 or higher)
*   A Telegram Bot Token obtained from the BotFather.
*   A Hedera Testnet Account (Account ID and ECDSA Private Key).
*   Access to a Gaia Node or another OpenAI-compatible API endpoint (URL and API Key).

### **Configuration**

1.  Clone the repository.
2.  Create a file named `.env` in the root of the project.
3.  Copy and paste the following, filling in your own credentials:

    ```env
    # Your Telegram Bot Token
    TELEGRAM_BOT_TOKEN=your_telegram_bot_token

    # Your Hedera Testnet Credentials
    HEDERA_ACCOUNT_ID=0.0.xxxxxx
    HEDERA_PRIVATE_KEY=your_hedera_ecdsa_private_key

    # Your AI Model/LLM Endpoint Credentials
    GAIA_NODE_URL=https://your_gaia_node_url/v1
    GAIA_API_KEY=your_gaia_api_key
    GAIA_MODEL_NAME=gpt-4
    ```

### **Installation & Running**

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **Start the Telegram Bot:**
    ```bash
    node telegram-bot.js
    ```3.  **(Optional) Start the Web Server for Mini App development:**
    ```bash
    node server.js
    ```

Your Telegram bot should now be running and responding to commands.

## **Usage**

### **Creating a Proposal**

To begin, define what needs to be approved, who can approve it, and the required number of approvals.

*   **Command:** `/create <description> | <approver1,approver2,...> | <threshold>`
*   **Example:**
    ```
    /create Spend 100 HBAR on marketing | 0.0.123,0.0.456,0.0.789 | 2
    ```
The bot will use the agent to create a new topic on HCS and reply with its unique Topic ID.

### **Approving a Proposal**

To cast a vote of approval for an existing proposal.

*   **Command:** `/approve <topic_id>`
*   **Example:** `/approve 0.0.555444`

*Note: In this version of the code, the approving account is simplified and hardcoded to the `HEDERA_ACCOUNT_ID` set in your `.env` file. See "Next Steps" for planned enhancements.*

### **Tallying a Proposal**

Check the current status of any proposal at any time.

*   **Command:** `/tally <topic_id> | <approver_list> | <threshold>`
*   **Example:**
    ```
    /tally 0.0.555444 | 0.0.123,0.0.456,0.0.789 | 2
    ```
The bot will query the topic messages, count the unique valid approvals, and report back whether the consensus threshold has been met, including a link to HashScan for verification.

## **Vision and Next Steps**

Approvr is currently a powerful proof-of-concept. The vision is to evolve it from a simple decision-recording tool into a robust engine for decentralized autonomous operations.

### **The Vision: From Verifiable Decisions to Automated Actions**

The future of Approvr is to close the loop between consensus and execution. Once a proposal is approved on-chain, the system should be able to automatically trigger the proposed action. This turns Approvr into a true automation primitive for DAOs and decentralized teams, enabling workflows like:
*   **Automated Treasury Payments:** An approved proposal to "Pay Contributor X 500 HBAR" automatically triggers a multi-sig transaction.
*   **Trustless Protocol Upgrades:** An approved proposal to "Update parameter Y" automatically calls the corresponding function on a smart contract.
*   **Cross-chain Actions:** An approved proposal triggers a workflow through a bridging or interoperability protocol.

### **Immediate Next Steps**

To build towards this vision, the following steps are planned:

1.  **Implement Secure Account Linking:** Replace the current simplified approval mechanism with a full cryptographic challenge-response flow. The bot will require users to sign a unique message to prove ownership of their Hedera account, securely linking it to their Telegram ID.

2.  **Fully Integrate the Telegram Mini App:** Wire the `/approve` command to open the secure web app served by `server.js`. This will provide a superior user interface for reviewing proposal details and confirming approvals, especially for complex transactions.

3.  **Optimize for Serverless Deployment:** Refactor `telegram-bot.js` to use a **webhook** instead of long polling. This will allow the entire application to be deployed efficiently on serverless platforms like Vercel or Netlify, dramatically improving scalability and reliability.

4.  **Persistent Storage:** Move state management from in-memory Maps to a persistent database solution (e.g., Vercel KV, Redis, or a traditional SQL database) to reliably store user-account links and proposal metadata.

5.  **Direct SDK Optimization:** For performance-critical paths like transaction submission, bypass the LLM reasoning step in the agent kit and use the Hedera SDK directly. This will prevent potential timeouts (e.g., `TRANSACTION_EXPIRED` errors) in a serverless environment and improve response times.

6.  **Proactive Notifications:** Enhance the bot to automatically notify all required approvers when a new proposal is created that needs their attention.
