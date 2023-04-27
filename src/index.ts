import { setTimeout } from "node:timers/promises";
import { ofetch } from "ofetch";

import fs from "node:fs";
import md5 from "md5";
import path from "path";
import WebSocket from "ws";

import type { AvailableBot, ChannelData, ChatOfBotDisplayName, Conversation, DeletionState, Model } from "./types";
import EventEmitter from "node:events";

function extractFormKey(html: string) {
	const scriptRegex = /<script>if\(.+\)throw new Error;(.+)<\/script>/;
	const scriptText = html.match(scriptRegex)?.[1];
	const keyRegex = /var .="([0-9a-f]+)",/;
	const keyText = scriptText!.match(keyRegex)?.[1];
	const cipherRegex = /.\[(\d+)\]=.\[(\d+)\]/g;
	const cipherPairs = Array.from(scriptText!.matchAll(cipherRegex));

	const formKeyList = new Array(cipherPairs.length).fill("");
	for (const pair of cipherPairs) {
		const [formKeyIndex, keyIndex] = pair.slice(1).map(Number);
		formKeyList[formKeyIndex] = keyText![keyIndex];
	}
	const formKey = formKeyList.join("");

	return formKey as string;
}

class Poe extends EventEmitter {
	private __urls = {
		request: "https://poe.com/api/gql_POST",
		receive: "https://poe.com/api/receive_POST",
		home: "https://poe.com",
		settings: "https://poe.com/api/settings"
	};
	private __headers: Record<string, any> = {
		// https://github.com/ading2210/poe-api#setting-a-custom-user-agent
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/112.0",
		Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
		"Accept-Encoding": "gzip, deflate, br",
		"Accept-Language": "en-US,en;q=0.5",
		Dnt: "1",
		Te: "trailers",
		"Upgrade-Insecure-Requests": "1",

		// default
		Referrer: "https://poe.com/",
		Origin: "https://poe.com",
		Host: "poe.com",
		"Sec-Fetch-Dest": "empty",
		"Sec-Fetch-Mode": "cors",
		"Sec-Fetch-Site": "same-origin",
		Connection: "keep-alive"
	};

	private __ws_domain = `tch${Math.floor(Math.random() * 1e6)}`;
	private __is_ready = false;
	private __formkey?: string;
	private __channel_data?: ChannelData;
	private __ws?: WebSocket;
	private __queries = new Map<string, string>();
	private __bots = new Map<string, ChatOfBotDisplayName>();

	/**
	 * @see: https://github.com/ading2210/poe-api#finding-your-token
	 * @param token your "**p-b**" cookie
	 */
	constructor(token: string) {
		super();

		this.__headers.Cookie = "p-b=" + token + "; Domain=poe.com";
		this.load_queries();
	}

	private load_queries() {
		const folder_path = path.join(__dirname, "..", "..", "graphql");
		const files = fs.readdirSync(folder_path);
		for (const filename of files) {
			const ext = path.extname(filename);
			if (ext !== ".graphql") continue;

			const query_name = path.basename(filename, ext);
			try {
				const query = fs.readFileSync(path.join(folder_path, filename), "utf-8");
				this.__queries.set(query_name, query);
			} catch (error: any) {
				console.warn(`Failed to load query '${query_name}': ${error.message}`);
			}
		}
	}

	get ready() {
		return this.__is_ready;
	}

	get bots() {
		let bots = new Map<string, { nickname: string; displayName: string; deletionState: DeletionState }>();

		for (const bot of [...this.__bots.values()]) {
			const { nickname, displayName, deletionState } = bot.defaultBotObject;
			bots.set(nickname, { nickname, displayName, deletionState });
		}

		return bots;
	}

	async initialize(): Promise<void> {
		// Fetch the home page and extract the form key and next data
		const html = await ofetch(this.__urls.home, {
			headers: this.__headers,
			parseResponse: (str) => str
		});
		const json_regex = /<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/;
		const json_text = json_regex.exec(html)?.[1] ?? "";
		const next_data = JSON.parse(json_text);
		this.__formkey = extractFormKey(html);

		const available_bots = next_data.props?.pageProps?.payload?.viewer?.availableBots as AvailableBot[];

		// Check if the token is valid
		if (!available_bots) throw new Error("Invalid token.");

		// Fetch the channel data from the settings page
		const settings = await ofetch<{ tchannelData: ChannelData }>(this.__urls.settings, {
			headers: this.__headers,
			parseResponse: JSON.parse
		});
		this.__channel_data = settings.tchannelData;

		// Fetch the chat data for each available bot
		for (const bot of available_bots.filter((bot) => bot.deletionState === "not_deleted")) {
			const url = `https://poe.com/_next/data/${next_data.buildId}/${bot.displayName}.json`;
			let chat_data: ChatOfBotDisplayName | undefined;

			while (!chat_data) {
				try {
					const data = await ofetch(url, {
						headers: this.__headers,
						parseResponse: JSON.parse
					});
					chat_data = data.pageProps.payload.chatOfBotDisplayName as ChatOfBotDisplayName;
					this.__bots.set(chat_data.defaultBotObject.nickname, chat_data);
				} catch (error) {
					// console.warn(`Failed to fetch chat data for bot '${bot.displayName}'. Retrying in 5 seconds...`);
					await setTimeout(5000);
				}
			}
		}

		await this.connect_ws();
		await this.subscribe();

		this.emit("ready");
	}

	async destroy(): Promise<void> {
		await this.disconnect_ws();

		delete this.__formkey;
		delete this.__channel_data;
		delete this.__ws;

		this.emit("exit");
	}

	private async connect_ws(): Promise<void> {
		if (!this.__channel_data) throw new Error("Channel data is empty.");
		const query = `min_seq=${this.__channel_data.minSeq}&channel=${this.__channel_data.channel}&hash=${this.__channel_data.channelHash}`;
		const url = `wss://${this.__ws_domain}.tch.${this.__channel_data.baseHost}/up/${this.__channel_data.boxName}/updates?${query}`;

		try {
			const headers = { "User-Agent": this.__headers["User-Agent"] };
			const ws = new WebSocket(url, { headers, rejectUnauthorized: false });

			ws.on("open", () => {
				this.__is_ready = true;
			});

			ws.on("close", () => {
				this.__is_ready = false;
			});

			ws.on("error", async () => {
				await this.disconnect_ws();
				await this.connect_ws();
			});

			while (!this.__is_ready) await setTimeout(10);
			this.__ws = ws;
		} catch (error) {
			await this.disconnect_ws();
			return await this.connect_ws();
		}
	}

	private async disconnect_ws() {
		this.__ws?.close();
		while (this.__is_ready) await setTimeout(10);
	}

	private async request(queryName: string, variables: Record<string, any>, queryDisplayName?: string) {
		const query = this.__queries.get(queryName);
		if (!query) throw new Error(`Query '${queryName}' not found.`);
		if (!this.__channel_data) throw new Error("Channel data is empty.");
		if (!this.__formkey) throw new Error("Formkey is empty.");

		let result: Record<string, any> | undefined;
		const payload = { query, variables };
		if (queryDisplayName) (payload as any)["queryName"] = queryDisplayName;

		while (!result) {
			try {
				const headers = {
					"poe-formkey": this.__formkey ?? "",
					"poe-tchannel": this.__channel_data?.channel ?? "",
					"poe-tag-id": md5(JSON.stringify(payload) + this.__formkey + "WpuLMiXEKKE98j56k"),
					...this.__headers
				};

				const response = await ofetch<Record<string, any>>(this.__urls.request, {
					method: "POST",
					body: payload,
					headers
				});
				if (response.data) result = response;
				else {
					// console.warn(`Query '${queryName}' returned an error. Retrying in 5 seconds...`);
					await setTimeout(5000);
				}
			} catch (error) {
				// console.warn(`Query '${queryName}' failed. Retrying in 5 seconds...`);
				await setTimeout(5000);
			}
		}

		return result;
	}

	async subscribe() {
		await this.request(
			"SubscriptionsMutation",
			{
				subscriptions: [
					{
						subscriptionName: "messageAdded",
						query: this.__queries.get("MessageAddedSubscription")
					},
					{
						subscriptionName: "viewerStateUpdated",
						query: this.__queries.get("ViewerStateUpdatedSubscription")
					},
					{
						subscriptionName: "viewerMessageLimitUpdated",
						query: this.__queries.get("ViewerMessageLimitUpdatedSubscription")
					}
				]
			},
			"subscriptionsMutation"
		);
	}

	async ask(chat_bot: Model, message: string | Conversation[], with_chat_break = false): Promise<string> {
		// Wait for the bot to be ready before sending the message
		if (!this.__is_ready) await this.connect_ws();

		// Send the message to the chat_bot
		const chat_bot_info = this.__bots.get(chat_bot);
		if (!chat_bot_info) throw new Error(`Bot '${chat_bot}' not found`);

		let resolveFunc: (value: string) => void;
		let rejectFunc: (reason?: any) => void;
		const promise = new Promise<string>((resolve, reject) => {
			resolveFunc = resolve;
			rejectFunc = reject;
		});

		const on_message = (e: MessageEvent) => {
			const data = JSON.parse(e.data.toString());
			// Return early if the data does not contain any messages
			if (!Array.isArray(data.messages)) return;

			for (const message_str of data.messages) {
				const message_data = JSON.parse(message_str);

				// Skip messages that are not subscription updates
				if (message_data.message_type !== "subscriptionUpdate") continue;

				const message = message_data.payload?.data?.messageAdded;
				// Skip messages that do not contain a messageAdded payload
				if (!message) rejectFunc(new Error("Message Added is null"));

				if (message?.author !== "human" && message?.state === "complete") {
					resolveFunc(message.text);
					//@ts-ignore
					this.__ws!.removeEventListener("message", on_message);
				}
			}
		};

		//@ts-ignore
		this.__ws!.addEventListener("message", on_message);

		const get_prompt = (conversation: Conversation[]) => {
			let prompt = "";
			const prompt_settings = [];

			for (const convo of conversation) {
				if (convo.role === "system") prompt_settings.push(convo.content.trim());
			}

			prompt += "**Prompt Settings**:\n\n";
			prompt += prompt_settings.join("\n\n") + "\n\n";

			prompt += "\n\n**Conversation History**:\n\n";
			for (let convo of conversation.filter((c) => c.role !== "user" || c === conversation[conversation.length - 1])) {
				switch (convo.role) {
					case "model":
						if (!convo.name) convo.name = this.bots.get(chat_bot)?.displayName ?? "No name";
						prompt += `[${convo.name} - AI Model]: ${convo.content.trim()}\n\n`;
						break;
					case "user":
						if (!convo.name) convo.name = "No name";
						prompt += `[${convo.name} - User]: ${convo.content.trim()}\n\n`;
						break;
				}
			}

			prompt += "\n\n**Latest User Message**:\n\n";
			const latest = conversation.filter((convo) => convo.role === "user").pop();
			if (latest) prompt += latest.content.trim() + "\n\n";

			prompt += "\n\n**Latest AI Model Response**:\n\n";

			return prompt.trim();
		};

		this.request("AddHumanMessageMutation", {
			bot: chat_bot,
			query: typeof message === "object" ? get_prompt(message) : message,
			chatId: chat_bot_info.chatId,
			source: null,
			withChatBreak: with_chat_break
		}).then((message_data) => {
			if (!message_data.data?.messageCreateWithStatus?.messageLimit?.canSend) rejectFunc(new Error("Cannot send."));
		});

		return promise;
	}

	async history(chat_bot: Model, count = 25, cursor = null) {
		try {
			const bot_id = this.__bots.get(chat_bot)?.id;
			if (!bot_id) throw new Error(`Bot '${chat_bot}' not found`);

			const result = await this.request("ChatListPaginationQuery", {
				count,
				cursor,
				id: bot_id
			});

			const messages = result?.data?.node?.messagesConnection?.edges;
			if (!messages) throw new Error("No messages found in result");

			return messages;
		} catch (error) {
			return null;
		}
	}

	async delete(...message_ids: (number | number[])[]) {
		try {
			// Flatten the array of arrays and ensure each item is an integer
			const ids = message_ids
				.flat()
				.map((id) => parseInt(String(id)))
				.filter((id) => !isNaN(id));

			// If no valid message IDs are provided, return null
			if (ids.length === 0) {
				return null;
			}

			const result = await this.request("DeleteMessageMutation", {
				messageIds: ids
			});

			return result;
		} catch (error) {
			return null;
		}
	}

	async purge(chat_bot: Model, count: number = -1) {
		if (!this.__bots.has(chat_bot)) throw new Error(`Bot '${chat_bot}' not found`);

		try {
			console.info(`Purging messages from ${chat_bot}`);

			// Set up a loop to delete messages in batches of 50
			let last_messages = (await this.history(chat_bot, 50)).reverse();
			while (last_messages.length) {
				const message_ids = [];

				// Build an array of message IDs to delete
				for (const message of last_messages) {
					if (count === 0) break;
					count--;

					const message_id = message?.node?.messageId;
					if (message_id) message_ids.push(parseInt(message_id));
				}

				// Delete the messages
				await this.delete(message_ids);

				// If we've reached the message count limit, stop deleting messages
				if (count === 0) {
					// console.info(`Deleted ${message_ids.length} messages`);
					return;
				}

				// Get the next batch of messages to delete
				last_messages = (await this.history(chat_bot, 50)).reverse();
			}

			// console.info('No more messages left to delete.');
			return;
		} catch (error) {
			return;
		}
	}
}

export { Poe };
