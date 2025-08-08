import dotenv from 'dotenv';
dotenv.config();
import { ChatOpenAI } from '@langchain/openai';
import { Client, PrivateKey } from '@hashgraph/sdk';
import { HederaLangchainToolkit, AgentMode, coreHTSPlugin, coreAccountPlugin, coreConsensusPlugin, coreQueriesPlugin /* , coreSCSPlugin */ } from 'hedera-agent-kit';
import { z } from 'zod';
// --- Configure LLM for Gaia Node ---
const llm = new ChatOpenAI({
    configuration: {
        baseURL: process.env.GAIA_NODE_URL,
        apiKey: process.env.GAIA_API_KEY,
    },
    model: process.env.GAIA_MODEL_NAME,
    temperature: 0,
});

let privateKey;
try {
    privateKey = PrivateKey.fromStringECDSA(process.env.HEDERA_PRIVATE_KEY);
    console.log("Hedera private key loaded.");
} catch (ecdsaError) {
    console.error("Failed to load Hedera private key:", ecdsaError.message);
    process.exit(1);
}

const client = Client.forTestnet().setOperator(
    process.env.HEDERA_ACCOUNT_ID,
    privateKey,
);

let hederaAgentToolkit;
let tools = {};
try {
    console.log("Initializing HederaLangchainToolkit with plugins...");
    
    hederaAgentToolkit = new HederaLangchainToolkit({
        client,
        configuration: {
            plugins: [coreHTSPlugin, coreAccountPlugin, coreConsensusPlugin, coreQueriesPlugin /*, coreSCSPlugin */], // Load the plugins for the tools we need
            context: {
                mode: AgentMode.AUTONOMOUS,
            },
        },
    });
    console.log("HederaLangchainToolkit initialized with plugins.");

    const rawTools = hederaAgentToolkit.getTools();
    console.log(`Found ${rawTools.length} raw tools.`);
    console.log("Raw tool names:", rawTools.map(t => t.name)); // Log names to verify

    // Filter and map tools by name for easy access
    const validTools = rawTools.filter(tool => tool && typeof tool.name === 'string' && typeof tool.invoke === 'function');
    console.log(`Found ${validTools.length} valid tools.`);
    
    // --- CHANGED: Use the CORRECT tool names as defined by the plugins ---
    // You must check the actual names returned by the plugins. They might differ slightly.
    // Based on the TOOLS.md and common patterns, they are likely these:
    tools.createTopic = validTools.find(t => t.name === 'create_topic_tool'); // Check actual name
    tools.submitMessage = validTools.find(t => t.name === 'submit_topic_message_tool'); // Check actual name
    tools.getMessages = validTools.find(t => t.name === 'get_topic_messages_query_tool'); // Check actual name

    // --- DEBUG: Log the actual tool names found ---
    const foundToolNames = validTools.map(t => t.name);
    console.log("All valid tool names found:", foundToolNames);

    if (!tools.createTopic || !tools.submitMessage || !tools.getMessages) {
         console.error("Critical Error: Could not find required tools in Hedera Agent Kit.");
         console.error("Searched for: create_topic_tool, submit_topic_message_tool, get_topic_messages_query_tool");
         console.error("Found tools:", foundToolNames);
         throw new Error("Missing required Hedera tools for Approvr. Check tool names above.");
    } else {
        console.log("Required Hedera tools found and mapped successfully.");
        console.log("Create Topic Tool Name:", tools.createTopic.name);
        console.log("Submit Message Tool Name:", tools.submitMessage.name);
        console.log("Get Messages Tool Name:", tools.getMessages.name);
    }

} catch (initError) {
    console.error("Error initializing HederaLangchainToolkit or finding tools:", initError);
    console.error("Stack trace:", initError.stack);
    process.exit(1); // Critical failure, cannot proceed
}

/**
 * Creates a new Hedera Consensus Service topic for a proposal.
 * @param {string} proposalDescription A brief description of the proposal.
 * @param {Array<string>} approvers An array of Hedera Account IDs who can approve.
 * @param {number} threshold The minimum number of approvals needed.
 * @returns {Promise<{topicId: string, status: string, message?: string}>} Result object.
 */
export async function createProposal(proposalDescription, approvers, threshold) {
    try {
        console.log(`Creating proposal topic for: ${proposalDescription}`);
        // 1. Create Topic
        const topicResponse = await tools.createTopic.invoke({
             // The exact parameters depend on the tool's schema.
             // Commonly, it might just need a memo or be auto-generated.
             // Check the tool's schema or documentation.
             // For now, let's assume it just creates a topic.
             // We might need to add a memo like "Approvr Proposal: {description}"
             memo: `Approvr Proposal: ${proposalDescription.substring(0, 50)}...` // Truncate memo
        });
        
        console.log("Raw Create topic response type:", typeof topicResponse);
        console.log("Raw Create topic response (first 500 chars):", JSON.stringify(topicResponse).substring(0, 500)); 

        // 2. Extract Topic ID
        // --- FIXED: Handle potential JSON string response and parse correctly ---
        let topicId = null;
        let parsedResponse = null;

        // The Hedera Agent Kit tool might return a JSON string instead of an object.
        if (typeof topicResponse === 'string') {
            try {
                parsedResponse = JSON.parse(topicResponse);
                console.log("Successfully parsed topicResponse string to object.");
            } catch (parseError) {
                console.error("Failed to parse topicResponse string:", parseError.message);
                console.error("Raw response was:", topicResponse);
                throw new Error("Tool response was a string but could not be parsed as JSON.");
            }
        } else if (typeof topicResponse === 'object' && topicResponse !== null) {
            // If it's already an object, use it directly
            parsedResponse = topicResponse;
            console.log("topicResponse was already an object.");
        } else {
            console.error("Unexpected type for topicResponse:", typeof topicResponse, topicResponse);
            throw new Error("Tool response was neither a string nor a valid object.");
        }

        // Now, extract topicId from the correctly parsed object
        if (parsedResponse && typeof parsedResponse === 'object') {
            // Priority 1: Check if topicId string is directly inside a 'receipt' object (common for Hedera responses)
            if (parsedResponse.receipt && typeof parsedResponse.receipt === 'object' && typeof parsedResponse.receipt.topicId === 'string') {
                topicId = parsedResponse.receipt.topicId;
                console.log("Found topicId in receipt:", topicId);
            }
            // Priority 2: Check if topicId is a string directly on the top level response
            else if (typeof parsedResponse.topicId === 'string') {
                 topicId = parsedResponse.topicId;
                 console.log("Found topicId directly on response:", topicId);
            }
            // Priority 3: Check if topicId is an SDK object with .toString() on the top level
            else if (parsedResponse.topicId && typeof parsedResponse.topicId === 'object' && typeof parsedResponse.topicId.toString === 'function') {
                 try {
                     const potentialId = parsedResponse.topicId.toString();
                     if (potentialId && potentialId.includes('.')) { // Basic validation
                         topicId = potentialId;
                         console.log("Found and converted topicId object:", topicId);
                     } else {
                         console.warn("Converted topicId string doesn't look like a Hedera ID:", potentialId);
                     }
                 } catch (e) {
                     console.warn("Could not convert top-level topicId object to string:", e.message);
                 }
            }
            // Priority 4: Check if topicId is an SDK object with .toString() inside receipt
            else if (parsedResponse.receipt && typeof parsedResponse.receipt === 'object' && parsedResponse.receipt.topicId &&
                     typeof parsedResponse.receipt.topicId === 'object' && typeof parsedResponse.receipt.topicId.toString === 'function') {
                 try {
                     const potentialId = parsedResponse.receipt.topicId.toString();
                     if (potentialId && potentialId.includes('.')) { // Basic validation
                         topicId = potentialId;
                         console.log("Found and converted topicId object inside receipt:", topicId);
                     } else {
                         console.warn("Converted topicId string from receipt doesn't look like a Hedera ID:", potentialId);
                     }
                 } catch (e) {
                     console.warn("Could not convert receipt.topicId object to string:", e.message);
                 }
            }
        }

        if (!topicId) {
             console.error("Could not find topicId string in the parsed response structure:", JSON.stringify(parsedResponse, null, 2)); // Log full parsed object
             throw new Error(`Failed to extract Topic ID string from createTopic response. Response type was ${typeof topicResponse}. Check logs above.`);
        }
        // --- END FIX ---

        console.log(`✅ Proposal topic created successfully with ID: ${topicId}`);


        // 3. (Optional) Submit initial message with proposal details
        // This could include the description, list of approvers, threshold.
        // Format it in a way that's easy for `tallyApprovals` to parse later.
        const initialMessage = `Proposal: ${proposalDescription}\nApprovers: ${approvers.join(', ')}\nThreshold: ${threshold}`;
        await tools.submitMessage.invoke({
            topicId: topicId,
            message: initialMessage
        });
        console.log("Initial proposal details submitted to topic.");

        return { topicId, status: 'success', message: `Proposal created. Share this Topic ID: ${topicId}` };

    } catch (error) {
        console.error("Error in createProposal:", error);
        return { topicId: null, status: 'error', message: `Failed to create proposal: ${error.message}` };
    }
}

/**
 * Submits an approval message to the proposal topic.
 * @param {string} topicId The Hedera Consensus Service Topic ID.
 * @param {string} approverAccountId The Hedera Account ID of the approver.
 * @returns {Promise<{status: string, message?: string}>} Result object.
 */
export async function submitApproval(topicId, approverAccountId) {
    try {
        console.log(`Submitting approval for topic ${topicId} by ${approverAccountId}`);
        // 1. Format Approval Message
        // A simple, parseable format is key.
        const approvalMessage = `APPROVE:${approverAccountId}`; // Prefix makes parsing easier

        // 2. Submit Message
        const submitResponse = await tools.submitMessage.invoke({
            topicId: topicId,
            message: approvalMessage
        });
        console.log("Approval message submitted:", submitResponse);

        return { status: 'success', message: `Approval recorded for ${approverAccountId}.` };

    } catch (error) {
        console.error("Error in submitApproval:", error);
        return { status: 'error', message: `Failed to submit approval: ${error.message}` };
    }
}


/**
 * Tallys approvals for a given topic.
 * @param {string} topicId The Hedera Consensus Service Topic ID.
 * @param {Array<string>} approvers List of valid approver account IDs.
 * @param {number} threshold The minimum number of approvals needed.
 * @returns {Promise<{status: string, approvals: number, isApproved: boolean, message: string}>} Result object.
 */
export async function tallyApprovals(topicId, approvers, threshold) {
    try {
        console.log(`Tallying approvals for topic ${topicId}`);
        // 1. Get Topic Messages
        const messagesResponse = await tools.getMessages.invoke({
            topicId: topicId
            // Consider adding limit or time filters if needed for performance later
        });
        console.log("Messages fetched:", JSON.stringify(messagesResponse, null, 2)); // Log full response

        // 2. Extract Messages Array
        // --- FIXED: Robustly extract messages array ---
        let messages = [];
        // Handle potential string response, object response, or direct array
        let parsedMessagesResponse = messagesResponse;
        if (typeof messagesResponse === 'string') {
            try {
                parsedMessagesResponse = JSON.parse(messagesResponse);
            } catch (e) {
                console.error("Failed to parse messagesResponse string:", e);
                throw new Error("get_topic_messages_query_tool returned an unparsable string.");
            }
        }

        // The tool usually returns an object like { topicId: "...", messages: [...] }
        // But sometimes might return the array directly or nest it differently.
        // Prioritize finding an array.
        if (Array.isArray(parsedMessagesResponse)) {
            messages = parsedMessagesResponse;
        } else if (parsedMessagesResponse && typeof parsedMessagesResponse === 'object') {
            // Common structure: { topicId: "...", messages: [...] }
            if (Array.isArray(parsedMessagesResponse.messages)) {
                messages = parsedMessagesResponse.messages;
            }
            // Add checks for other potential structures if needed
            // else if (Array.isArray(parsedMessagesResponse.data)) { messages = parsedMessagesResponse.data; }
        }

        if (!Array.isArray(messages)) {
            console.error("Expected messages to be an array. Got:", typeof messages, messages);
            throw new Error("Fetched messages is not an array or could not be extracted as one.");
        }
        // --- END FIX ---

        // 3. Parse Messages and Count Approvals
        const validApprovals = new Set();

        // --- FIXED: Correctly access the 'message' content string ---
        for (const msgObj of messages) {
            // Ensure msgObj is an object and has a 'message' property that is a string
            if (msgObj && typeof msgObj === 'object' && typeof msgObj.message === 'string') {
                const messageContent = msgObj.message; // This is the actual text content
                console.log("Checking message content:", messageContent); // Debug log

                if (messageContent.startsWith("APPROVE:")) {
                    const accountId = messageContent.substring("APPROVE:".length).trim();
                    console.log("Found APPROVE prefix, extracted Account ID:", accountId); // Debug log
                    if (approvers.includes(accountId)) {
                        console.log("Account ID is valid approver, adding to set."); // Debug log
                        validApprovals.add(accountId);
                    } else {
                        console.warn(`Message from non-approved account ${accountId} ignored.`);
                    }
                }
                // Ignore other messages (like the initial proposal details)
            } else {
                 console.warn("Skipping non-object or message-less item in messages array:", msgObj);
            }
        }
        // --- END FIX ---

        const approvalCount = validApprovals.size;
        const isApproved = approvalCount >= threshold;

        console.log(`Tally result: ${approvalCount}/${threshold} approvals. Approved: ${isApproved}`);

        // let message = `Current tally: ${approvalCount}/${threshold} approvals.`;
        // if (isApproved) {
        //     message += ` Threshold met! Proposal is approved.`;
        // } else {
        //     const needed = threshold - approvalCount;
        //     message += ` Need ${needed} more approval(s).`;
        // }

        // return {
        //     status: 'success',
        //     approvals: approvalCount,
        //     isApproved: isApproved,
        //     message: message
        // };

        let message;
        if (isApproved) {
            // --- NEW/IMPROVED: Detailed "Approved" Message with Link and Better Description ---
            
            // 1. Find unique approvers who actually approved
            const uniqueApprovedList = Array.from(validApprovals).sort();

            // 2. Extract proposal description more robustly
            let proposalDescription = "Proposal details not found.";
            let foundApproversList = []; // Extract approvers from the proposal message for display
            let foundThreshold = "N/A";   // Extract threshold from the proposal message for display

            // Iterate through messages to find the initial proposal details message
            for (const msgObj of messages) {
                if (msgObj && typeof msgObj === 'object' && typeof msgObj.message === 'string') {
                    const content = msgObj.message;
                    // Check if this message contains the proposal details
                    if (content.startsWith("Proposal:")) {
                        // Split the message into lines for easier parsing
                        const lines = content.split('\n');
                        // First line: "Proposal: Approve spending 1 HBAR for marketing"
                        if (lines.length > 0) {
                            const descLine = lines[0];
                            const descMatch = descLine.match(/^Proposal:\s*(.+)$/);
                            if (descMatch && descMatch[1]) {
                                proposalDescription = descMatch[1].trim();
                            }
                        }
                        // Subsequent lines for Approvers and Threshold (if needed for display)
                        // You could parse these too, but we already have them from the function args.
                        // For display consistency, let's use the ones passed to the function.
                        foundApproversList = approvers; // Use the list passed to the function
                        foundThreshold = threshold.toString(); // Use the threshold passed to the function
                        break; // Stop after finding the first (should be only) proposal message
                    }
                }
            }

            // 3. Construct the message with link
            const hashscanTopicUrl = `https://hashscan.io/testnet/topic/${topicId}`;
            
            message = `✅ Proposal Approved!\n\n` +
                      `The required number of approvals (${approvalCount}/${foundThreshold}) has been reached for the proposal in topic \`${topicId}\`.\n\n` + // Use backticks for potential Markdown monospace
                      `Proposal Details:\n${proposalDescription}\n\n` +
                      `Approvers:\n`;
            
            // List all approvers and mark who approved
            for (const approver of foundApproversList.sort()) {
                const status = validApprovals.has(approver) ? "(approved)" : "(not approved)";
                message += `- ${approver} ${status}\n`;
            }
            
            message += `\nNext Steps:\n` +
                       `The action described in the proposal can now be executed manually by the relevant party, as consensus has been recorded on Hedera.\n` +
                       `🔗 View the immutable approval record on HashScan: ${hashscanTopicUrl}\n` + // Add the link
                       `The topic messages provide cryptographic proof of consensus.`;
            // --- END NEW/IMPROVED ---
        } else {
            // Standard tally message if not approved
            message = `Current tally: ${approvalCount}/${threshold} approvals.`;
            if (!isApproved) {
                const needed = threshold - approvalCount;
                message += ` Need ${needed} more approval(s).`;
            }
        }
        // --- END CHANGE ---

        console.log(`Tally result: ${approvalCount}/${threshold} approvals. Approved: ${isApproved}`);

        // Return the potentially detailed message
        return {
            status: 'success',
            approvals: approvalCount,
            isApproved: isApproved,
            message: message // Use the new detailed message
        };

    } catch (error) {
        console.error("Error in tallyApprovals:", error);
        return { status: 'error', approvals: 0, isApproved: false, message: `Failed to tally approvals: ${error.message}` };
    }
}

// --- Example Usage (for testing the functions directly) ---
/*
if (import.meta.url === `file://${process.argv[1]}`) {
    // Test createProposal
    createProposal("Send 100 HBAR to 0.0.recipient", ["0.0.approver1", "0.0.approver2"], 2)
        .then(result => console.log("Create Result:", result))
        .catch(console.error);
}
*/